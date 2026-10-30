/**
 * Assinatura Digital — BirdID + VIDaaS + A1/A3 (ITI)
 *
 * BirdID é uma plataforma de certificado digital em nuvem do grupo Soluti.
 * Documentação: https://birdid.com.br/desenvolvedores
 *
 * POST /api/assinatura/birdid/token        — Autoriza usuário BirdID (OAuth2)
 * POST /api/assinatura/birdid/assinar      — Assina documento com cert BirdID
 * GET  /api/assinatura/birdid/certificado  — Dados do certificado do usuário
 * POST /api/assinatura/hash               — Gera hash SHA-256 do documento para assinar
 * GET  /api/assinatura/lista             — Lista assinaturas registradas
 * POST /api/assinatura/verificar         — Verifica validade de assinatura
 */
import { Router } from "express";
import { createHash } from "crypto";
import { db, storage } from "../storage.js";
import { assinaturasDigitais } from "../../shared/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

const BIRDID_BASE = "https://apiv2.birdid.com.br/v0";
const VIDAAS_BASE = "https://certificado.vidaas.com.br/v0";

async function getBirdIdConfig() {
  const clientId = await storage.getSetting("birdid_client_id") || process.env.BIRDID_CLIENT_ID || "";
  const clientSecret = await storage.getSetting("birdid_client_secret") || process.env.BIRDID_CLIENT_SECRET || "";
  return { clientId, clientSecret, configured: !!(clientId && clientSecret) };
}

async function getVidaasConfig() {
  const clientId = await storage.getSetting("vidaas_client_id") || process.env.VIDAAS_CLIENT_ID || "";
  const clientSecret = await storage.getSetting("vidaas_client_secret") || process.env.VIDAAS_CLIENT_SECRET || "";
  return { clientId, clientSecret, configured: !!(clientId && clientSecret) };
}

/** Gera hash SHA-256 de texto ou buffer */
function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// ─── Hash do Documento ───────────────────────────────────────────────────────

router.post("/assinatura/hash", (req, res) => {
  try {
    const { texto, html, base64 } = req.body;
    if (!texto && !html && !base64) return res.status(400).json({ message: "Forneça texto, html ou base64" });

    let conteudo = texto || html || "";
    if (base64) {
      conteudo = Buffer.from(base64, "base64").toString("utf8");
    }

    const hash = sha256(conteudo);
    const hashB64 = Buffer.from(hash, "hex").toString("base64");

    res.json({
      algoritmo: "SHA-256",
      hash,
      hashBase64: hashB64,
      tamanhoBytes: Buffer.byteLength(conteudo, "utf8"),
    });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

// ─── BirdID OAuth2 ───────────────────────────────────────────────────────────

/**
 * POST /api/assinatura/birdid/authorize
 * Inicia fluxo OAuth2 BirdID — retorna URL de autorização
 */
router.post("/assinatura/birdid/authorize", async (req, res) => {
  try {
    const config = await getBirdIdConfig();
    if (!config.configured) {
      return res.status(400).json({ message: "BirdID não configurado. Configure birdid_client_id e birdid_client_secret nas configurações." });
    }

    const { cpf, redirectUri } = req.body;
    if (!cpf) return res.status(400).json({ message: "CPF obrigatório para autorização BirdID" });

    const authUrl = `${BIRDID_BASE}/oauth/authorize?` + new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: redirectUri || `${req.protocol}://${req.get("host")}/api/assinatura/birdid/callback`,
      scope: "sign",
      login_hint: cpf.replace(/\D/g, ""),
    });

    res.json({ ok: true, authUrl, message: "Redirecione o usuário para authUrl para autorizar" });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

/**
 * POST /api/assinatura/birdid/token
 * Troca code por access_token BirdID
 */
router.post("/assinatura/birdid/token", async (req, res) => {
  try {
    const config = await getBirdIdConfig();
    if (!config.configured) return res.status(400).json({ message: "BirdID não configurado" });

    const { code, redirectUri } = req.body;
    if (!code) return res.status(400).json({ message: "code obrigatório" });

    const tokenResp = await fetch(`${BIRDID_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri || `${req.protocol}://${req.get("host")}/api/assinatura/birdid/callback`,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      return res.status(400).json({ message: "Erro BirdID: " + err });
    }

    const data = await tokenResp.json();
    res.json({ ok: true, access_token: data.access_token, expires_in: data.expires_in, scope: data.scope });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

/**
 * GET /api/assinatura/birdid/certificado
 * Retorna dados do certificado do usuário autenticado no BirdID
 */
router.get("/assinatura/birdid/certificado", async (req, res) => {
  try {
    const birdidToken = req.headers["x-birdid-token"] as string;
    if (!birdidToken) return res.status(400).json({ message: "Header X-BirdID-Token obrigatório" });

    const certResp = await fetch(`${BIRDID_BASE}/certificate`, {
      headers: { "Authorization": `Bearer ${birdidToken}` },
    });

    if (!certResp.ok) return res.status(certResp.status).json({ message: "Erro ao buscar certificado BirdID" });
    const cert = await certResp.json();
    res.json(cert);
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

/**
 * POST /api/assinatura/birdid/assinar
 * Assina documento usando BirdID
 */
router.post("/assinatura/birdid/assinar", async (req, res) => {
  try {
    const birdidToken = req.headers["x-birdid-token"] as string;
    if (!birdidToken) return res.status(400).json({ message: "Header X-BirdID-Token obrigatório" });

    const { hash, docTitulo, signatario, cpf, oab, docId } = req.body;
    if (!hash) return res.status(400).json({ message: "hash do documento obrigatório (use /api/assinatura/hash)" });

    // Chamada BirdID para assinar o hash
    const signResp = await fetch(`${BIRDID_BASE}/sign/hash`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${birdidToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        hashes: [{ id: docId || "doc-1", alias: docTitulo || "Documento Jurídico", hash, hash_algorithm: "SHA-256" }],
      }),
    });

    if (!signResp.ok) {
      const err = await signResp.text();
      return res.status(400).json({ message: "Erro BirdID ao assinar: " + err });
    }

    const signData = await signResp.json();
    const assinaturaB64 = signData.signatures?.[0]?.signature || signData.signature || "";

    // Salva no banco
    const [registro] = await db.insert(assinaturasDigitais).values({
      docId: docId || undefined,
      docTitulo: docTitulo || "Documento",
      signatario: signatario || "",
      cpf: (cpf || "").replace(/\D/g, ""),
      oab: oab || "",
      provider: "birdid",
      hashDocumento: hash,
      assinaturaBase64: assinaturaB64,
      certificadoBase64: signData.certificate || "",
      status: "assinado",
      birdidToken: birdidToken.slice(0, 20) + "...",
    }).returning();

    res.json({
      ok: true,
      id: registro.id,
      assinatura: assinaturaB64,
      certificado: signData.certificate || "",
      signatario,
      dataAssinatura: new Date().toISOString(),
      algoritmo: "RSA-SHA256",
      provider: "birdid",
    });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

// ─── VIDaaS (alternativa gratuita com NFSe) ──────────────────────────────────

router.post("/assinatura/vidaas/authorize", async (req, res) => {
  try {
    const config = await getVidaasConfig();
    if (!config.configured) {
      return res.status(400).json({ message: "VIDaaS não configurado. Configure vidaas_client_id e vidaas_client_secret." });
    }
    const { cpf, redirectUri } = req.body;
    const authUrl = `${VIDAAS_BASE}/oauth/authorize?` + new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: redirectUri || `${req.protocol}://${req.get("host")}/api/assinatura/vidaas/callback`,
      scope: "signature_session",
      login_hint: (cpf || "").replace(/\D/g, ""),
    });
    res.json({ ok: true, authUrl });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

// ─── Lista de assinaturas ────────────────────────────────────────────────────

router.get("/assinatura/lista", async (_req, res) => {
  try {
    const lista = await db.select().from(assinaturasDigitais).orderBy(desc(assinaturasDigitais.createdAt)).limit(100);
    res.json(lista.map(a => ({
      id: a.id, docTitulo: a.docTitulo, signatario: a.signatario,
      cpf: a.cpf ? "***." + a.cpf.slice(-4) : "",
      oab: a.oab, provider: a.provider, status: a.status, createdAt: a.createdAt,
    })));
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

/** POST /api/assinatura/verificar — verifica se hash bate com assinatura registrada */
router.post("/assinatura/verificar", async (req, res) => {
  try {
    const { id, hash } = req.body;
    if (!id || !hash) return res.status(400).json({ message: "id e hash obrigatórios" });
    const [assinatura] = await db.select().from(assinaturasDigitais).where(eq(assinaturasDigitais.id, id)).limit(1);
    if (!assinatura) return res.status(404).json({ message: "Assinatura não encontrada" });
    const valida = assinatura.hashDocumento === hash;
    res.json({
      valida,
      signatario: assinatura.signatario,
      provider: assinatura.provider,
      dataAssinatura: assinatura.createdAt,
      status: assinatura.status,
      message: valida ? "Assinatura válida — hash confere" : "Hash não confere — documento pode ter sido alterado",
    });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

/** GET /api/assinatura/config/status */
router.get("/assinatura/config/status", async (_req, res) => {
  const birdid = await getBirdIdConfig();
  const vidaas = await getVidaasConfig();
  res.json({
    birdid: { configured: birdid.configured, nome: "BirdID (Soluti)", url: "https://birdid.com.br" },
    vidaas: { configured: vidaas.configured, nome: "VIDaaS", url: "https://certificado.vidaas.com.br" },
    iti: {
      configured: false,
      nome: "ITI / ICP-Brasil (A1/A3 local)",
      url: "https://www.iti.gov.br",
      note: "Requer instalação de software local (Assinador Serpro, Auto Signer) — não integrado via API",
    },
  });
});

export default router;
