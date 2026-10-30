/**
 * Prazos processuais + Push Notifications FCM
 * GET    /api/prazos              — Lista prazos
 * POST   /api/prazos              — Cria prazo
 * PUT    /api/prazos/:id          — Atualiza prazo
 * DELETE /api/prazos/:id          — Remove prazo
 * PUT    /api/prazos/:id/status   — Marca como cumprido/vencido
 * POST   /api/prazos/fcm/token    — Salva token FCM do dispositivo
 * DELETE /api/prazos/fcm/token    — Remove token FCM
 * POST   /api/prazos/fcm/test     — Envia notificação de teste
 * GET    /api/prazos/alertas      — Lista prazos vencendo nas próximas 48h
 */
import { Router } from "express";
import { db, storage } from "../storage.js";
import { prazos as prazosTable, fcmTokens } from "../../shared/db";
import { eq, and, lte, gte, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

const router = Router();

// ─── Helpers FCM ─────────────────────────────────────────────────────────────

async function getFcmConfig(): Promise<{ projectId: string; serverKey: string } | null> {
  const projectId = await storage.getSetting("fcm_project_id") || process.env.FCM_PROJECT_ID || "";
  const serverKey = await storage.getSetting("fcm_server_key") || process.env.FCM_SERVER_KEY || "";
  if (!projectId || !serverKey) return null;
  return { projectId, serverKey };
}

/**
 * Envia notificação FCM via Legacy HTTP API
 * Para FCM v1 API, use OAuth2 bearer token (service account).
 * Aqui implementamos a API legada (Server Key) que é mais simples de configurar.
 */
async function sendFcmNotification(token: string, title: string, body: string, data?: Record<string, string>) {
  const config = await getFcmConfig();
  if (!config) throw new Error("FCM não configurado. Configure fcm_server_key nas configurações.");

  const payload = {
    to: token,
    notification: { title, body, click_action: "FLUTTER_NOTIFICATION_CLICK" },
    data: data || {},
    android: { priority: "HIGH", notification: { channel_id: "prazos_processuais", priority: "high" } },
    apns: { headers: { "apns-priority": "10" }, payload: { aps: { alert: { title, body }, sound: "default", badge: 1 } } },
  };

  const resp = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: { "Authorization": `key=${config.serverKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) throw new Error(`FCM HTTP ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function sendFcmToAll(title: string, body: string, data?: Record<string, string>) {
  const tokens = await db.select().from(fcmTokens).where(eq(fcmTokens.ativo, "sim"));
  const results = await Promise.allSettled(
    tokens.map(t => sendFcmNotification(t.token, title, body, data))
  );
  return { total: tokens.length, ok: results.filter(r => r.status === "fulfilled").length };
}

// ─── CRUD Prazos ─────────────────────────────────────────────────────────────

router.get("/prazos", async (req, res) => {
  try {
    const lista = await db.select().from(prazosTable).orderBy(desc(prazosTable.dataVencimento));
    res.json(lista);
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

router.get("/prazos/alertas", async (_req, res) => {
  try {
    const agora = new Date();
    const em48h = new Date(agora.getTime() + 48 * 3600 * 1000);
    const lista = await db.select().from(prazosTable)
      .where(and(
        gte(prazosTable.dataVencimento, agora),
        lte(prazosTable.dataVencimento, em48h),
        eq(prazosTable.status, "pendente")
      ))
      .orderBy(prazosTable.dataVencimento);
    res.json(lista);
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

router.post("/prazos", async (req, res) => {
  try {
    const { titulo, descricao, numeroProcesso, tribunal, dataVencimento, tipo, prioridade, responsavel, antecedenciaHoras } = req.body;
    if (!titulo || !dataVencimento) return res.status(400).json({ message: "titulo e dataVencimento obrigatórios" });

    const [prazo] = await db.insert(prazosTable).values({
      titulo: titulo.trim().slice(0, 500),
      descricao: (descricao || "").trim().slice(0, 2000),
      numeroProcesso: (numeroProcesso || "").trim(),
      tribunal: (tribunal || "").trim(),
      dataVencimento: new Date(dataVencimento),
      tipo: tipo || "prazo",
      prioridade: prioridade || "normal",
      responsavel: (responsavel || "").trim(),
      antecedenciaHoras: Number(antecedenciaHoras) || 24,
      status: "pendente",
    }).returning();

    // Envia notificação FCM se prazo urgente (menos de 24h)
    const horasAteVencimento = (prazo.dataVencimento.getTime() - Date.now()) / 3600000;
    if (horasAteVencimento <= 24 && horasAteVencimento > 0) {
      sendFcmToAll(
        `⚠️ Prazo urgente: ${prazo.titulo}`,
        `Vence em ${Math.ceil(horasAteVencimento)}h — ${prazo.numeroProcesso || "Sem nº processo"}`,
        { prazoId: prazo.id, tipo: "prazo_urgente" }
      ).catch(() => {});
    }

    res.json(prazo);
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

router.put("/prazos/:id", async (req, res) => {
  try {
    const { titulo, descricao, numeroProcesso, tribunal, dataVencimento, tipo, prioridade, responsavel, antecedenciaHoras } = req.body;
    const updates: any = {};
    if (titulo) updates.titulo = titulo.trim().slice(0, 500);
    if (descricao !== undefined) updates.descricao = descricao.trim().slice(0, 2000);
    if (numeroProcesso !== undefined) updates.numeroProcesso = numeroProcesso.trim();
    if (tribunal !== undefined) updates.tribunal = tribunal.trim();
    if (dataVencimento) updates.dataVencimento = new Date(dataVencimento);
    if (tipo) updates.tipo = tipo;
    if (prioridade) updates.prioridade = prioridade;
    if (responsavel !== undefined) updates.responsavel = responsavel.trim();
    if (antecedenciaHoras !== undefined) updates.antecedenciaHoras = Number(antecedenciaHoras);

    const [updated] = await db.update(prazosTable).set(updates).where(eq(prazosTable.id, req.params.id)).returning();
    if (!updated) return res.status(404).json({ message: "Prazo não encontrado" });
    res.json(updated);
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

router.put("/prazos/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!["pendente", "cumprido", "vencido"].includes(status)) {
      return res.status(400).json({ message: "Status inválido" });
    }
    const [updated] = await db.update(prazosTable).set({ status }).where(eq(prazosTable.id, req.params.id)).returning();
    if (!updated) return res.status(404).json({ message: "Prazo não encontrado" });
    res.json(updated);
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

router.delete("/prazos/:id", async (req, res) => {
  try {
    await db.delete(prazosTable).where(eq(prazosTable.id, req.params.id));
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

// ─── FCM Token management ─────────────────────────────────────────────────────

router.post("/prazos/fcm/token", async (req, res) => {
  try {
    const { token, dispositivo } = req.body;
    if (!token || typeof token !== "string") return res.status(400).json({ message: "token obrigatório" });

    await db.insert(fcmTokens).values({
      token: token.trim(),
      dispositivo: (dispositivo || "web").trim(),
      ativo: "sim",
    }).onConflictDoUpdate({ target: fcmTokens.token, set: { ativo: "sim" } });

    res.json({ ok: true, message: "Token FCM registrado" });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

router.delete("/prazos/fcm/token", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "token obrigatório" });
    await db.update(fcmTokens).set({ ativo: "nao" }).where(eq(fcmTokens.token, token));
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

router.post("/prazos/fcm/test", async (req, res) => {
  try {
    const { token } = req.body;
    if (token) {
      await sendFcmNotification(token, "🔔 Teste SK Jurídico", "Push notifications configurado com sucesso!", { tipo: "teste" });
      res.json({ ok: true, message: "Notificação enviada ao token específico" });
    } else {
      const result = await sendFcmToAll("🔔 Teste SK Jurídico", "Push notifications funcionando!", { tipo: "teste" });
      res.json({ ok: true, ...result });
    }
  } catch (e: any) { res.status(400).json({ message: e.message }); }
});

// ─── Scheduler: verificar prazos e notificar ─────────────────────────────────
// Roda a cada 30 minutos para verificar prazos próximos do vencimento

async function checkPrazosAndNotify() {
  try {
    const agora = new Date();
    const prazosParaNotificar = await db.select().from(prazosTable)
      .where(and(eq(prazosTable.status, "pendente"), eq(prazosTable.notificacaoEnviada, "nao")));

    for (const prazo of prazosParaNotificar) {
      const horasAteVencimento = (prazo.dataVencimento.getTime() - agora.getTime()) / 3600000;
      const antecedencia = prazo.antecedenciaHoras || 24;

      if (horasAteVencimento > 0 && horasAteVencimento <= antecedencia) {
        // Envia notificação
        const titulo = horasAteVencimento <= 2
          ? `🚨 URGENTE: ${prazo.titulo}`
          : `⚠️ Prazo se aproximando: ${prazo.titulo}`;
        const corpo = `Vence em ${Math.ceil(horasAteVencimento)}h — ${prazo.numeroProcesso || prazo.tribunal || "Processo sem número"}`;

        sendFcmToAll(titulo, corpo, { prazoId: prazo.id, tipo: "prazo_alerta" }).catch(() => {});
        await db.update(prazosTable).set({ notificacaoEnviada: "sim" }).where(eq(prazosTable.id, prazo.id));
      } else if (horasAteVencimento <= 0) {
        // Marca como vencido
        await db.update(prazosTable).set({ status: "vencido" }).where(eq(prazosTable.id, prazo.id));
        sendFcmToAll(`❌ Prazo vencido: ${prazo.titulo}`, prazo.numeroProcesso || prazo.responsavel || "", { prazoId: prazo.id, tipo: "prazo_vencido" }).catch(() => {});
      }
    }
  } catch {}
}

// Inicia o scheduler (30 min)
setInterval(checkPrazosAndNotify, 30 * 60 * 1000);

export default router;
