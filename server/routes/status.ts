/**
 * Status e Health Check Estendido
 * GET /api/status           — Status completo de todos os serviços
 * GET /api/health           — Health check simples (200 OK)
 * GET /api/status/ia        — Status de todos os provedores de IA
 * GET /api/status/banco     — Status detalhado do banco de dados
 * GET /api/status/integracoes — Status de integrações externas
 */
import { Router } from "express";
import { db, storage } from "../storage.js";
import { sql } from "drizzle-orm";
import { appSettings } from "../../shared/db";

const router = Router();

const START_TIME = Date.now();

function uptimeFormatted(): string {
  const ms = Date.now() - START_TIME;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}h ${m}m ${s}s`;
}

async function checkProvider(key: string, testFn: () => Promise<boolean>): Promise<{ configurado: boolean; online: boolean | null }> {
  const configured = !!key;
  if (!configured) return { configurado: false, online: null };
  try {
    const online = await testFn();
    return { configurado: true, online };
  } catch {
    return { configurado: true, online: false };
  }
}

/** GET /api/health — health check simples para load balancer / Uptime Robot */
router.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: uptimeFormatted(),
    version: process.env.npm_package_version || "1.4.0",
  });
});

/** GET /api/status — status completo */
router.get("/status", async (_req, res) => {
  try {
    const mem = process.memoryUsage();
    const memMb = Math.round(mem.rss / 1024 / 1024);

    // Verifica banco
    let dbOk = false;
    let dbLatencyMs = 0;
    try {
      const t0 = Date.now();
      await db.execute(sql`SELECT 1`);
      dbLatencyMs = Date.now() - t0;
      dbOk = true;
    } catch {}

    // Chaves de IA configuradas
    const [gemini, openai, anthropic, groq, perplexity, openrouter, xai, together, mistral, datajud, visionKey, birdid, fcmKey, driveToken] = await Promise.all([
      storage.getSetting("gemini_api_key"),
      storage.getSetting("openai_api_key"),
      storage.getSetting("anthropic_api_key"),
      storage.getSetting("groq_api_key"),
      storage.getSetting("perplexity_api_key"),
      storage.getSetting("openrouter_api_key"),
      storage.getSetting("xai_api_key"),
      storage.getSetting("together_api_key"),
      storage.getSetting("mistral_api_key"),
      storage.getSetting("datajud_api_key"),
      storage.getSetting("google_vision_api_key"),
      storage.getSetting("birdid_client_id"),
      storage.getSetting("fcm_server_key"),
      storage.getSetting("google_drive_access_token"),
    ]);

    // Conta tabelas
    let numTabelas = 0;
    try {
      const r = await db.execute(sql`SELECT count(*) FROM information_schema.tables WHERE table_schema='public'`);
      numTabelas = Number((r.rows?.[0] as any)?.count || 0);
    } catch {}

    res.json({
      status: dbOk ? "operational" : "degraded",
      timestamp: new Date().toISOString(),
      versao: "1.4.0",
      uptime: uptimeFormatted(),
      memoria: { usadaMB: memMb, limiteMB: 512 },
      node: process.version,
      banco: {
        status: dbOk ? "conectado" : "desconectado",
        latencyMs: dbLatencyMs,
        tabelas: numTabelas,
        url: process.env.DATABASE_URL ? "postgresql://***" : "memory",
      },
      ia: {
        gemini: { configurado: !!gemini },
        openai: { configurado: !!openai },
        anthropic: { configurado: !!anthropic },
        groq: { configurado: !!groq },
        perplexity: { configurado: !!perplexity },
        openrouter: { configurado: !!openrouter },
        xai: { configurado: !!xai },
        together: { configurado: !!together },
        mistral: { configurado: !!mistral },
      },
      integracoes: {
        datajud: { configurado: !!datajud, descricao: "DataJud CNJ — 60+ tribunais" },
        googleVision: { configurado: !!visionKey, descricao: "OCR de imagens" },
        googleDrive: { configurado: !!driveToken, descricao: "Sincronização de documentos" },
        birdid: { configurado: !!birdid, descricao: "Assinatura digital BirdID" },
        fcm: { configurado: !!fcmKey, descricao: "Push notifications Firebase" },
      },
    });
  } catch (e: any) {
    res.status(500).json({ status: "error", message: e.message });
  }
});

/** GET /api/status/ia — testa provedores de IA */
router.get("/status/ia", async (_req, res) => {
  const provedores = [
    { id: "gemini", nome: "Google Gemini", key: await storage.getSetting("gemini_api_key") },
    { id: "openai", nome: "OpenAI", key: await storage.getSetting("openai_api_key") },
    { id: "anthropic", nome: "Anthropic (Claude)", key: await storage.getSetting("anthropic_api_key") },
    { id: "groq", nome: "Groq", key: await storage.getSetting("groq_api_key") },
    { id: "perplexity", nome: "Perplexity", key: await storage.getSetting("perplexity_api_key") },
    { id: "openrouter", nome: "OpenRouter", key: await storage.getSetting("openrouter_api_key") },
    { id: "xai", nome: "xAI (Grok)", key: await storage.getSetting("xai_api_key") },
  ];

  res.json(provedores.map(p => ({
    id: p.id,
    nome: p.nome,
    configurado: !!p.key,
    prefixo: p.key ? p.key.slice(0, 8) + "..." : null,
  })));
});

/** GET /api/status/banco */
router.get("/status/banco", async (_req, res) => {
  try {
    const t0 = Date.now();
    await db.execute(sql`SELECT 1`);
    const latency = Date.now() - t0;

    const tabelasResult = await db.execute(sql`
      SELECT table_name, 
             pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) as tamanho
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const versaoResult = await db.execute(sql`SELECT version()`);

    res.json({
      status: "conectado",
      latencyMs: latency,
      versao: (versaoResult.rows?.[0] as any)?.version?.split(" ").slice(0, 2).join(" ") || "PostgreSQL",
      tabelas: (tabelasResult.rows || []).map((r: any) => ({ nome: r.table_name, tamanho: r.tamanho })),
    });
  } catch (e: any) {
    res.json({ status: "desconectado", erro: e.message });
  }
});

/** GET /api/status/integracoes */
router.get("/status/integracoes", async (_req, res) => {
  const checks = await Promise.allSettled([
    fetch("https://api-publica.datajud.cnj.jus.br/", { signal: AbortSignal.timeout(5000) }),
    fetch("https://apiv2.birdid.com.br/", { signal: AbortSignal.timeout(5000) }),
    fetch("https://www.googleapis.com/", { signal: AbortSignal.timeout(5000) }),
    fetch("https://fcm.googleapis.com/", { signal: AbortSignal.timeout(5000) }),
  ]);

  const [datajud, birdid, google, fcm] = checks.map(r =>
    r.status === "fulfilled" && [200, 401, 403, 404].includes(r.value.status)
  );

  res.json({
    datajud: { online: datajud, nome: "DataJud CNJ", url: "api-publica.datajud.cnj.jus.br" },
    birdid: { online: birdid, nome: "BirdID (Soluti)", url: "apiv2.birdid.com.br" },
    googleApis: { online: google, nome: "Google APIs (Drive, Vision)", url: "googleapis.com" },
    fcm: { online: fcm, nome: "Firebase Cloud Messaging", url: "fcm.googleapis.com" },
    checkedAt: new Date().toISOString(),
  });
});

export default router;
