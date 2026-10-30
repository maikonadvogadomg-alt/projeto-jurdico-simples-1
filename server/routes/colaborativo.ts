/**
 * SK Jurídico v1.6.0 — Modo Colaborativo (SSE + REST)
 *
 * Permite que múltiplos advogados editem o mesmo documento em tempo real.
 * Usa Server-Sent Events (SSE) para push de atualizações sem WebSocket.
 *
 * Rotas:
 *   GET  /api/collab/rooms               — lista salas ativas
 *   POST /api/collab/rooms               — cria sala
 *   GET  /api/collab/rooms/:id           — estado atual da sala
 *   POST /api/collab/rooms/:id/join      — entrar na sala
 *   POST /api/collab/rooms/:id/update    — enviar atualização do documento
 *   POST /api/collab/rooms/:id/cursor    — atualizar posição do cursor
 *   GET  /api/collab/rooms/:id/events    — SSE stream de eventos
 *   DELETE /api/collab/rooms/:id/leave   — sair da sala
 */

import { Router, type Response } from "express";
import { randomUUID } from "crypto";

const router = Router();

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface CollabUser {
  id: string;
  name: string;
  color: string;
  cursor?: { from: number; to: number };
  joinedAt: Date;
  lastSeen: Date;
}

interface CollabRoom {
  id: string;
  name: string;
  doc: string;
  version: number;
  users: Map<string, CollabUser>;
  history: Array<{ userId: string; userName: string; html: string; ts: Date; version: number }>;
  createdAt: Date;
  updatedAt: Date;
}

type SSEClient = { userId: string; res: Response };

// ── Estado em memória ─────────────────────────────────────────────────────────

const rooms = new Map<string, CollabRoom>();
const sseClients = new Map<string, SSEClient[]>(); // roomId → clients

const USER_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#6366f1",
];

// Limpeza de salas inativas (>2h sem atualização)
setInterval(() => {
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
  for (const [id, room] of rooms) {
    if (room.updatedAt < cutoff && room.users.size === 0) {
      rooms.delete(id);
      sseClients.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ── Helpers SSE ───────────────────────────────────────────────────────────────

function broadcast(roomId: string, event: string, data: unknown, exceptUserId?: string) {
  const clients = sseClients.get(roomId) || [];
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (client.userId === exceptUserId) continue;
    try { client.res.write(payload); } catch {}
  }
}

function roomToPublic(room: CollabRoom) {
  return {
    id: room.id,
    name: room.name,
    version: room.version,
    userCount: room.users.size,
    users: [...room.users.values()].map(u => ({
      id: u.id, name: u.name, color: u.color, cursor: u.cursor,
    })),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}

// ── GET /api/collab/rooms ─────────────────────────────────────────────────────
router.get("/collab/rooms", (_req, res) => {
  const list = [...rooms.values()].map(r => ({
    id: r.id,
    name: r.name,
    version: r.version,
    userCount: r.users.size,
    updatedAt: r.updatedAt,
  }));
  res.json(list);
});

// ── POST /api/collab/rooms ────────────────────────────────────────────────────
router.post("/collab/rooms", (req, res) => {
  const { name = "Novo documento", doc = "" } = req.body || {};
  const id = randomUUID().slice(0, 8);
  const room: CollabRoom = {
    id, name, doc, version: 1,
    users: new Map(),
    history: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  rooms.set(id, room);
  sseClients.set(id, []);
  res.status(201).json({ id, name, version: 1 });
});

// ── GET /api/collab/rooms/:id ─────────────────────────────────────────────────
router.get("/collab/rooms/:id", (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: "Sala não encontrada" });
  res.json({ ...roomToPublic(room), doc: room.doc });
});

// ── POST /api/collab/rooms/:id/join ──────────────────────────────────────────
router.post("/collab/rooms/:id/join", (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: "Sala não encontrada" });

  const { name = "Advogado" } = req.body || {};
  const userId = randomUUID().slice(0, 8);
  const color = USER_COLORS[room.users.size % USER_COLORS.length];

  const user: CollabUser = { id: userId, name, color, joinedAt: new Date(), lastSeen: new Date() };
  room.users.set(userId, user);

  broadcast(room.id, "user-joined", { userId, userName: name, color }, userId);

  res.json({ userId, color, doc: room.doc, version: room.version, roomName: room.name });
});

// ── POST /api/collab/rooms/:id/update ────────────────────────────────────────
router.post("/collab/rooms/:id/update", (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: "Sala não encontrada" });

  const { userId, html } = req.body || {};
  if (!userId || html === undefined) return res.status(400).json({ error: "userId e html são obrigatórios" });

  const user = room.users.get(userId);
  if (!user) return res.status(403).json({ error: "Usuário não está na sala" });

  room.doc = html;
  room.version++;
  room.updatedAt = new Date();
  user.lastSeen = new Date();

  // Salva no histórico (últimas 50 versões)
  room.history.unshift({ userId, userName: user.name, html, ts: new Date(), version: room.version });
  if (room.history.length > 50) room.history.pop();

  // Broadcast para outros usuários
  broadcast(room.id, "doc-updated", {
    userId, userName: user.name, html, version: room.version,
  }, userId);

  res.json({ version: room.version });
});

// ── POST /api/collab/rooms/:id/cursor ────────────────────────────────────────
router.post("/collab/rooms/:id/cursor", (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: "Sala não encontrada" });

  const { userId, from, to } = req.body || {};
  const user = room.users.get(userId);
  if (!user) return res.status(403).json({ error: "Usuário não está na sala" });

  user.cursor = { from, to };
  user.lastSeen = new Date();

  broadcast(room.id, "cursor-moved", { userId, userName: user.name, color: user.color, from, to }, userId);

  res.json({ ok: true });
});

// ── GET /api/collab/rooms/:id/events (SSE) ───────────────────────────────────
router.get("/collab/rooms/:id/events", (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) {
    res.status(404).end();
    return;
  }

  const userId = (req.query.userId as string) || "anonymous";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Envia estado inicial
  res.write(`event: init\ndata: ${JSON.stringify({
    version: room.version,
    doc: room.doc,
    users: [...room.users.values()].map(u => ({ id: u.id, name: u.name, color: u.color })),
  })}\n\n`);

  // Registra cliente SSE
  const clients = sseClients.get(room.id) || [];
  clients.push({ userId, res });
  sseClients.set(room.id, clients);

  // Heartbeat a cada 20s para manter conexão
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat\n\n`); } catch { clearInterval(heartbeat); }
  }, 20_000);

  // Limpeza ao desconectar
  req.on("close", () => {
    clearInterval(heartbeat);
    const c = sseClients.get(room.id) || [];
    sseClients.set(room.id, c.filter(x => x.res !== res));

    // Notifica saída
    const user = room.users.get(userId);
    if (user) {
      broadcast(room.id, "user-left", { userId, userName: user.name });
      room.users.delete(userId);
    }
  });
});

// ── GET /api/collab/rooms/:id/history ────────────────────────────────────────
router.get("/collab/rooms/:id/history", (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: "Sala não encontrada" });
  res.json(room.history.map(h => ({ userId: h.userId, userName: h.userName, ts: h.ts, version: h.version })));
});

// ── DELETE /api/collab/rooms/:id/leave ───────────────────────────────────────
router.delete("/collab/rooms/:id/leave", (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: "Sala não encontrada" });

  const { userId } = req.body || {};
  if (userId) {
    const user = room.users.get(userId);
    if (user) {
      broadcast(room.id, "user-left", { userId, userName: user.name });
      room.users.delete(userId);
    }
  }
  res.json({ ok: true });
});

export default router;
