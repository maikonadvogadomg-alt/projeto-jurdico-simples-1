/**
 * Auth JWT — Autenticação multi-usuário com JWT
 * POST /api/auth/escritorio/registro — Cria escritório + admin
 * POST /api/auth/escritorio/login   — Login com username/senha → JWT
 * POST /api/auth/escritorio/usuario — Adiciona usuário ao escritório (admin only)
 * GET  /api/auth/escritorio/perfil  — Perfil do usuário logado
 * PUT  /api/auth/escritorio/perfil  — Atualiza perfil
 * POST /api/auth/escritorio/refresh — Renova token JWT
 * GET  /api/auth/escritorio/usuarios — Lista usuários do escritório
 */
import { Router } from "express";
import { createHash, scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { db } from "../storage.js";
import { escritorios, escritorioUsers } from "../../shared/db";
import { eq, and } from "drizzle-orm";
import { signToken, requireJwt, requireAdmin, type JwtPayload } from "../middleware/jwt-auth.js";

const router = Router();
const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [hash, salt] = stored.split(".");
  if (!hash || !salt) return false;
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  const storedBuf = Buffer.from(hash, "hex");
  return buf.length === storedBuf.length && timingSafeEqual(buf, storedBuf);
}

function sanitize(s: string) { return (s || "").trim().slice(0, 200); }

/** POST /api/auth/escritorio/registro */
router.post("/auth/escritorio/registro", async (req, res) => {
  try {
    const { nome, cnpj, oab, email, telefone, adminUsername, adminPassword, adminNome } = req.body;
    if (!nome || !adminUsername || !adminPassword) {
      return res.status(400).json({ message: "nome, adminUsername e adminPassword são obrigatórios" });
    }
    if (adminPassword.length < 8) {
      return res.status(400).json({ message: "Senha deve ter pelo menos 8 caracteres" });
    }

    // Verifica se username já existe
    const existing = await db.select().from(escritorioUsers).where(eq(escritorioUsers.username, sanitize(adminUsername))).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ message: "Username já em uso" });
    }

    // Cria escritório
    const [escritorio] = await db.insert(escritorios).values({
      nome: sanitize(nome),
      cnpj: sanitize(cnpj || ""),
      oab: sanitize(oab || ""),
      email: sanitize(email || ""),
      telefone: sanitize(telefone || ""),
    }).returning();

    // Cria admin
    const passwordHash = await hashPassword(adminPassword);
    const [usuario] = await db.insert(escritorioUsers).values({
      escritorioId: escritorio.id,
      username: sanitize(adminUsername),
      email: sanitize(email || ""),
      passwordHash,
      nome: sanitize(adminNome || adminUsername),
      role: "admin",
    }).returning();

    const token = signToken({ userId: usuario.id, username: usuario.username, escritorioId: escritorio.id, role: "admin" });
    res.cookie("jwt_token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 3600 * 1000 });

    res.json({
      ok: true,
      token,
      escritorio: { id: escritorio.id, nome: escritorio.nome },
      usuario: { id: usuario.id, username: usuario.username, role: usuario.role, nome: usuario.nome },
    });
  } catch (e: any) { res.status(500).json({ message: "Erro ao registrar: " + e.message }); }
});

/** POST /api/auth/escritorio/login */
router.post("/auth/escritorio/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "username e password obrigatórios" });

    const [usuario] = await db.select().from(escritorioUsers)
      .where(and(eq(escritorioUsers.username, sanitize(username)), eq(escritorioUsers.ativo, "sim")))
      .limit(1);

    if (!usuario) return res.status(401).json({ message: "Usuário não encontrado ou inativo" });

    const ok = await verifyPassword(password, usuario.passwordHash);
    if (!ok) return res.status(401).json({ message: "Senha incorreta" });

    const [escritorio] = await db.select().from(escritorios).where(eq(escritorios.id, usuario.escritorioId)).limit(1);

    const token = signToken({
      userId: usuario.id,
      username: usuario.username,
      escritorioId: usuario.escritorioId,
      role: usuario.role,
    });

    res.cookie("jwt_token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 3600 * 1000 });

    res.json({
      ok: true,
      token,
      escritorio: escritorio ? { id: escritorio.id, nome: escritorio.nome } : null,
      usuario: { id: usuario.id, username: usuario.username, role: usuario.role, nome: usuario.nome, oab: usuario.oab },
    });
  } catch (e: any) { res.status(500).json({ message: "Erro no login: " + e.message }); }
});

/** POST /api/auth/escritorio/refresh */
router.post("/auth/escritorio/refresh", requireJwt, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  const token = signToken({ userId: user.userId, username: user.username, escritorioId: user.escritorioId, role: user.role });
  res.cookie("jwt_token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 3600 * 1000 });
  res.json({ ok: true, token });
});

/** POST /api/auth/escritorio/logout */
router.post("/auth/escritorio/logout", (_req, res) => {
  res.clearCookie("jwt_token");
  res.json({ ok: true });
});

/** GET /api/auth/escritorio/perfil */
router.get("/auth/escritorio/perfil", requireJwt, async (req, res) => {
  try {
    const user = (req as any).user as JwtPayload;
    const [usuario] = await db.select().from(escritorioUsers).where(eq(escritorioUsers.id, user.userId)).limit(1);
    if (!usuario) return res.status(404).json({ message: "Usuário não encontrado" });
    const [escritorio] = await db.select().from(escritorios).where(eq(escritorios.id, usuario.escritorioId)).limit(1);
    res.json({
      id: usuario.id, username: usuario.username, nome: usuario.nome,
      email: usuario.email, oab: usuario.oab, role: usuario.role,
      escritorio: escritorio ? { id: escritorio.id, nome: escritorio.nome, cnpj: escritorio.cnpj, oab: escritorio.oab } : null,
    });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

/** PUT /api/auth/escritorio/perfil */
router.put("/auth/escritorio/perfil", requireJwt, async (req, res) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { nome, email, oab, newPassword, currentPassword } = req.body;
    const [usuario] = await db.select().from(escritorioUsers).where(eq(escritorioUsers.id, user.userId)).limit(1);
    if (!usuario) return res.status(404).json({ message: "Usuário não encontrado" });

    const updates: any = {};
    if (nome) updates.nome = sanitize(nome);
    if (email) updates.email = sanitize(email);
    if (oab) updates.oab = sanitize(oab);
    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ message: "Senha atual obrigatória" });
      const ok = await verifyPassword(currentPassword, usuario.passwordHash);
      if (!ok) return res.status(401).json({ message: "Senha atual incorreta" });
      if (newPassword.length < 8) return res.status(400).json({ message: "Nova senha mínimo 8 caracteres" });
      updates.passwordHash = await hashPassword(newPassword);
    }
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db.update(escritorioUsers).set(updates).where(eq(escritorioUsers.id, user.userId));
    }
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

/** GET /api/auth/escritorio/usuarios */
router.get("/auth/escritorio/usuarios", requireJwt, async (req, res) => {
  try {
    const user = (req as any).user as JwtPayload;
    if (!user.escritorioId) return res.json([]);
    const lista = await db.select({
      id: escritorioUsers.id, username: escritorioUsers.username,
      nome: escritorioUsers.nome, email: escritorioUsers.email,
      oab: escritorioUsers.oab, role: escritorioUsers.role, ativo: escritorioUsers.ativo,
      createdAt: escritorioUsers.createdAt,
    }).from(escritorioUsers).where(eq(escritorioUsers.escritorioId, user.escritorioId));
    res.json(lista);
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

/** POST /api/auth/escritorio/usuario — admin only */
router.post("/auth/escritorio/usuario", requireJwt, requireAdmin, async (req, res) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { username, password, nome, email, oab, role } = req.body;
    if (!username || !password) return res.status(400).json({ message: "username e password obrigatórios" });
    if (password.length < 8) return res.status(400).json({ message: "Senha mínimo 8 caracteres" });
    const existing = await db.select().from(escritorioUsers).where(eq(escritorioUsers.username, sanitize(username))).limit(1);
    if (existing.length > 0) return res.status(409).json({ message: "Username já em uso" });
    const passwordHash = await hashPassword(password);
    const [novo] = await db.insert(escritorioUsers).values({
      escritorioId: user.escritorioId!,
      username: sanitize(username), passwordHash,
      nome: sanitize(nome || username),
      email: sanitize(email || ""),
      oab: sanitize(oab || ""),
      role: ["admin","advogado","estagiario","secretaria"].includes(role) ? role : "advogado",
    }).returning();
    res.json({ ok: true, id: novo.id, username: novo.username, role: novo.role });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

/** DELETE /api/auth/escritorio/usuario/:id — admin only */
router.delete("/auth/escritorio/usuario/:id", requireJwt, requireAdmin, async (req, res) => {
  try {
    const user = (req as any).user as JwtPayload;
    if (req.params.id === user.userId) return res.status(400).json({ message: "Não pode desativar a própria conta" });
    await db.update(escritorioUsers).set({ ativo: "nao" }).where(eq(escritorioUsers.id, req.params.id));
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

/** GET /api/auth/escritorio/check — verifica se JWT é válido sem redirecionar */
router.get("/auth/escritorio/check", requireJwt, (req, res) => {
  const user = (req as any).user as JwtPayload;
  res.json({ authenticated: true, user: { userId: user.userId, username: user.username, role: user.role, escritorioId: user.escritorioId } });
});

export default router;
