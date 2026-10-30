import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { createGzip } from "zlib";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { applyLocalConfigToEnv } from "./local-config.js";
import { checkDbAndInitStorage } from "./storage.js";
import { ligarCacador } from "./cacador-erros.js"; // 🐞 anota os erros do servidor (com o motivo) — 28/10

applyLocalConfigToEnv();

const app: Express = express();

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  }),
);

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));

// ── Gzip compression (manual, sem pacote) ────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const accept = req.headers["accept-encoding"] || "";
  // Não comprimir SSE nem binários — apenas JSON
  const skip = req.path.includes("/stream") || req.path.includes("/tts") || req.path.includes("/export");
  if (!accept.includes("gzip") || skip) return next();

  const origJson = res.json.bind(res);
  res.json = (body: any) => {
    const str = JSON.stringify(body);
    if (str.length < 1024) return origJson(body); // não comprime respostas pequenas
    const buf = Buffer.from(str, "utf8");
    const gz = require("zlib").gzipSync(buf, { level: 6 });
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Length", gz.length);
    res.end(gz);
    return res;
  };
  next();
});

// Confia em proxy reverso (nginx, traefik, etc.) — necessário para rate-limit por IP real
app.set("trust proxy", 1);

// ── Rate Limiting ─────────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 60_000,        // 1 minuto
  max: 300,                // 300 req/min por IP (geral)
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Muitas requisições. Tente novamente em 1 minuto." },
  skip: (req) => req.path === "/health" || req.path === "/api/health",
});

const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,                 // 30 req/min para IA (evita abuso de custo)
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Limite de requisições de IA atingido. Aguarde 1 minuto." },
});

app.use("/api", generalLimiter);
app.use("/api/ai", aiLimiter);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ extended: true, limit: "200mb" }));
app.use(cookieParser());

// ── Session ───────────────────────────────────────────────────────────────────
const sessionSecret = process.env.SESSION_SECRET || "juridico-secret-2025";

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
  }),
);

// ── DB Init ───────────────────────────────────────────────────────────────────
checkDbAndInitStorage().catch(() => {});

// ── Routes ────────────────────────────────────────────────────────────────────
ligarCacador(app); // 🐞 GET /api/_erros (o botão 🐞 da tela mostra junto)
app.use("/api", router);

// ── 28/10: o próprio servidor também entrega a TELA (depois do "npm run build") ──
// Assim basta UM programa: abra http://localhost:8080
{
  const pastaTela = process.env.PASTA_TELA || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
  if (fs.existsSync(path.join(pastaTela, "index.html"))) {
    app.use(express.static(pastaTela, { index: false }));
    app.get(/^(?!\/api\/).*/, (_req: Request, res: Response) => res.sendFile(path.join(pastaTela, "index.html")));
    console.log("[tela] servindo a tela de " + pastaTela);
  }
}

export default app;
