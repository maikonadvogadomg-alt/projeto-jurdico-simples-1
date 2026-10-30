/**
 * Google Drive Sync — Sincronização completa de documentos
 * 
 * POST /api/drive/upload           — Upload documento para Drive
 * GET  /api/drive/listar           — Lista arquivos na pasta configurada
 * GET  /api/drive/download/:fileId — Baixa conteúdo do arquivo
 * DELETE /api/drive/arquivo/:fileId — Remove arquivo do Drive
 * POST /api/drive/sync/push        — Sincroniza documento local → Drive
 * POST /api/drive/sync/pull        — Baixa atualizações do Drive → local
 * GET  /api/drive/sync/status      — Status de sincronização
 * POST /api/drive/oauth/refresh    — Atualiza access token com refresh token
 * GET  /api/drive/config/status    — Status da configuração OAuth
 */
import { Router } from "express";
import { createHash } from "crypto";
import { db, storage } from "../storage.js";
import { docsSincronizados } from "../../shared/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

// ─── Config helpers ──────────────────────────────────────────────────────────

async function getDriveConfig() {
  const accessToken = await storage.getSetting("google_drive_access_token") || process.env.GOOGLE_DRIVE_ACCESS_TOKEN || "";
  const refreshToken = await storage.getSetting("google_drive_refresh_token") || process.env.GOOGLE_DRIVE_REFRESH_TOKEN || "";
  const folderId = await storage.getSetting("google_drive_folder_id") || process.env.GOOGLE_DRIVE_FOLDER_ID || "";
  const clientId = await storage.getSetting("google_oauth_client_id") || process.env.GOOGLE_OAUTH_CLIENT_ID || "";
  const clientSecret = await storage.getSetting("google_oauth_client_secret") || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
  return { accessToken, refreshToken, folderId, clientId, clientSecret };
}

/** Atualiza access_token usando refresh_token */
async function refreshAccessToken(): Promise<string | null> {
  const config = await getDriveConfig();
  if (!config.refreshToken || !config.clientId || !config.clientSecret) return null;

  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!resp.ok) return null;
  const data = await resp.json();
  if (data.access_token) {
    await storage.setSetting("google_drive_access_token", data.access_token);
    return data.access_token;
  }
  return null;
}

/** Faz requisição autenticada ao Drive, com refresh automático em 401 */
async function driveRequest(url: string, options: RequestInit = {}): Promise<Response> {
  const config = await getDriveConfig();
  let token = config.accessToken;
  if (!token) throw new Error("Google Drive não configurado. Configure o access token nas configurações.");

  const headers = { ...options.headers as any, "Authorization": `Bearer ${token}` };
  let resp = await fetch(url, { ...options, headers });

  // Tenta renovar token se expirou
  if (resp.status === 401 && config.refreshToken) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      resp = await fetch(url, { ...options, headers });
    }
  }

  return resp;
}

// ─── Upload ──────────────────────────────────────────────────────────────────

router.post("/drive/upload", async (req, res) => {
  try {
    const { titulo, conteudoHtml, tipo, numeroProcesso, mimeType } = req.body;
    if (!conteudoHtml && !req.body.base64) {
      return res.status(400).json({ message: "conteudoHtml ou base64 obrigatório" });
    }

    const config = await getDriveConfig();
    if (!config.accessToken) return res.status(400).json({ message: "Google Drive não configurado" });

    const nomeArquivo = `${titulo || "Documento"} — ${new Date().toLocaleDateString("pt-BR")}.${mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx" : "html"}`;
    const conteudo = req.body.base64
      ? Buffer.from(req.body.base64, "base64")
      : Buffer.from(conteudoHtml, "utf-8");
    const contentType = mimeType || "text/html; charset=utf-8";

    // Metadados do arquivo
    const metadata = {
      name: nomeArquivo,
      parents: config.folderId ? [config.folderId] : [],
      description: `Processo: ${numeroProcesso || ""} | Tipo: ${tipo || "documento"} | SK Jurídico`,
    };

    // Upload multipart
    const boundary = "---sk_juridico_boundary_" + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
      conteudo,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const resp = await driveRequest(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink,createdTime`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}`, "Content-Length": body.length.toString() },
      body,
    });

    if (!resp.ok) {
      const err = await resp.text();
      return res.status(resp.status).json({ message: "Erro no upload Drive: " + err });
    }

    const fileData = await resp.json();
    const checksum = createHash("sha256").update(conteudoHtml || "").digest("hex").slice(0, 16);

    // Salva no banco local
    const [doc] = await db.insert(docsSincronizados).values({
      titulo: titulo || "Documento",
      conteudoHtml: conteudoHtml || "",
      driveFileId: fileData.id,
      driveUrl: fileData.webViewLink || "",
      tipo: tipo || "peticao",
      numeroProcesso: numeroProcesso || "",
      syncStatus: "synced",
      checksum,
    }).returning();

    res.json({
      ok: true,
      fileId: fileData.id,
      nome: fileData.name,
      url: fileData.webViewLink,
      docId: doc.id,
      createdTime: fileData.createdTime,
    });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

// ─── Listar arquivos ─────────────────────────────────────────────────────────

router.get("/drive/listar", async (req, res) => {
  try {
    const config = await getDriveConfig();
    if (!config.accessToken) return res.status(400).json({ message: "Google Drive não configurado" });

    const query = config.folderId
      ? `'${config.folderId}' in parents and trashed=false`
      : "trashed=false";

    const pageSize = Math.min(Number(req.query.limit) || 50, 100);
    const resp = await driveRequest(
      `${DRIVE_API}/files?q=${encodeURIComponent(query)}&pageSize=${pageSize}&fields=files(id,name,webViewLink,mimeType,modifiedTime,size)&orderBy=modifiedTime desc`
    );

    if (!resp.ok) return res.status(resp.status).json({ message: "Erro ao listar arquivos Drive" });
    const data = await resp.json();
    res.json({ ok: true, files: data.files || [], total: (data.files || []).length });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

// ─── Download ────────────────────────────────────────────────────────────────

router.get("/drive/download/:fileId", async (req, res) => {
  try {
    const resp = await driveRequest(`${DRIVE_API}/files/${req.params.fileId}?alt=media`);
    if (!resp.ok) return res.status(resp.status).json({ message: "Erro ao baixar arquivo Drive" });
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.setHeader("Content-Type", resp.headers.get("content-type") || "application/octet-stream");
    res.send(buffer);
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

// ─── Delete ──────────────────────────────────────────────────────────────────

router.delete("/drive/arquivo/:fileId", async (req, res) => {
  try {
    const resp = await driveRequest(`${DRIVE_API}/files/${req.params.fileId}`, { method: "DELETE" });
    if (!resp.ok && resp.status !== 204) return res.status(resp.status).json({ message: "Erro ao remover arquivo" });
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

// ─── Sync push (local → Drive) ───────────────────────────────────────────────

router.post("/drive/sync/push", async (req, res) => {
  try {
    const { docId, titulo, conteudoHtml, tipo, numeroProcesso } = req.body;
    const config = await getDriveConfig();
    if (!config.accessToken) return res.status(400).json({ message: "Google Drive não configurado" });

    // Verifica se já existe no Drive
    let docExistente = docId
      ? (await db.select().from(docsSincronizados).where(eq(docsSincronizados.id, docId)).limit(1))[0]
      : null;

    const checksum = createHash("sha256").update(conteudoHtml || "").digest("hex").slice(0, 16);

    if (docExistente?.driveFileId) {
      // Atualiza arquivo existente
      const conteudo = Buffer.from(conteudoHtml, "utf-8");
      const resp = await driveRequest(`${DRIVE_UPLOAD}/files/${docExistente.driveFileId}?uploadType=media`, {
        method: "PATCH",
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: conteudo,
      });
      if (!resp.ok) return res.status(resp.status).json({ message: "Erro ao atualizar no Drive" });
      await db.update(docsSincronizados).set({ syncStatus: "synced", checksum, updatedAt: new Date() }).where(eq(docsSincronizados.id, docId!));
      return res.json({ ok: true, action: "updated", fileId: docExistente.driveFileId, driveUrl: docExistente.driveUrl });
    }

    // Cria novo arquivo
    const uploadResult = await fetch(`${req.protocol}://${req.get("host")}/api/drive/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: req.headers.cookie || "" },
      body: JSON.stringify({ titulo, conteudoHtml, tipo, numeroProcesso }),
    });
    const result = await uploadResult.json();
    res.json({ ok: true, action: "created", ...result });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

// ─── OAuth2 refresh manual ───────────────────────────────────────────────────

router.post("/drive/oauth/refresh", async (req, res) => {
  try {
    const newToken = await refreshAccessToken();
    if (!newToken) return res.status(400).json({ message: "Não foi possível renovar. Configure refresh_token, client_id e client_secret." });
    res.json({ ok: true, message: "Access token renovado com sucesso" });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

/** GET /api/drive/sync/status */
router.get("/drive/sync/status", async (_req, res) => {
  try {
    const docs = await db.select().from(docsSincronizados).orderBy(desc(docsSincronizados.updatedAt)).limit(20);
    const total = docs.length;
    const synced = docs.filter(d => d.syncStatus === "synced").length;
    const local = docs.filter(d => d.syncStatus === "local").length;
    const conflict = docs.filter(d => d.syncStatus === "conflict").length;
    res.json({ ok: true, total, synced, local, conflict, documentos: docs });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

/** GET /api/drive/config/status */
router.get("/drive/config/status", async (_req, res) => {
  const config = await getDriveConfig();
  res.json({
    configurado: !!config.accessToken,
    temRefreshToken: !!config.refreshToken,
    temPasta: !!config.folderId,
    temClientId: !!config.clientId,
    temClientSecret: !!config.clientSecret,
    instrucoes: config.accessToken ? null : "Configure google_drive_access_token nas configurações. Para renovação automática, adicione também google_drive_refresh_token, google_oauth_client_id e google_oauth_client_secret.",
  });
});

export default router;
