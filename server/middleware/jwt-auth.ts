import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";

export function getJwtSecret(): string {
  return process.env.JWT_SECRET || process.env.SESSION_SECRET || "sk-juridico-jwt-secret-change-in-prod";
}

export interface JwtPayload {
  userId: string;
  username: string;
  escritorioId?: string;
  role: string;
  iat?: number;
  exp?: number;
}

export function signToken(payload: Omit<JwtPayload, "iat" | "exp">, expiresIn = "7d"): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn } as any);
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as JwtPayload;
  } catch {
    return null;
  }
}

export function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const cookie = (req.cookies as any)?.jwt_token;
  if (cookie) return cookie;
  return null;
}

/** Middleware: requer JWT válido. Popula req.user */
export function requireJwt(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ message: "Token JWT obrigatório" });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ message: "Token inválido ou expirado" });
  (req as any).user = payload;
  next();
}

/** Middleware: JWT opcional — popula req.user se presente, mas não bloqueia */
export function optionalJwt(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) (req as any).user = payload;
  }
  next();
}

/** Middleware: requer role admin */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user as JwtPayload | undefined;
  if (!user) return res.status(401).json({ message: "Autenticação necessária" });
  if (user.role !== "admin") return res.status(403).json({ message: "Acesso restrito a administradores" });
  next();
}
