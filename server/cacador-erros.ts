/* =========================================================================
   🐞 Caçador de erros — lado do SERVIDOR (só observa; não muda o funcionamento)
   - guarda os últimos erros do servidor (com a ROTA e o MOTIVO de verdade)
   - também grava em erros-servidor.log (na pasta de onde o servidor roda)
   - GET /api/_erros → a tela (botão 🐞) mostra junto com os erros dela
   Chaves e senhas são escondidas antes de guardar.
   ========================================================================= */
import { AsyncLocalStorage } from "async_hooks";
import fs from "fs";
import path from "path";
import type { Express, Request, Response, NextFunction } from "express";

type Erro = { quando: string; rota: string; msg: string };
const lista: Erro[] = [];
const MAX = 200;
const rotaAtual = new AsyncLocalStorage<string>();
const ARQUIVO = path.join(process.cwd(), "erros-servidor.log");

function esconder(t: string): string {
  return t
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, "AIza…(escondida)")
    .replace(/\b(sk-(?:ant-|or-|proj-)?)[A-Za-z0-9_\-]{12,}/g, "$1…(escondida)")
    .replace(/\b(gsk_|pplx-|xai-|ghp_|github_pat_)[A-Za-z0-9_\-]{10,}/g, "$1…(escondida)")
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]{12,}/gi, "$1…(escondida)")
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, "$1…(escondida)@");
}
function texto(x: unknown): string {
  if (x instanceof Error) return x.name + ": " + x.message + (x.stack ? "\n" + x.stack.split("\n").slice(1, 5).join("\n") : "");
  if (typeof x === "object") { try { return JSON.stringify(x); } catch { return String(x); } }
  return String(x);
}
export function anotarErro(msg: string, rota?: string) {
  const e: Erro = { quando: new Date().toLocaleString("pt-BR"), rota: rota || rotaAtual.getStore() || "(fora de uma rota)", msg: esconder(msg).slice(0, 3000) };
  lista.push(e); if (lista.length > MAX) lista.shift();
  try { fs.appendFileSync(ARQUIVO, `[${e.quando}] ${e.rota}\n${e.msg}\n\n`); } catch {}
}

// tudo que o servidor escrever como erro (console.error) é anotado, com a rota em que aconteceu
const origErro = console.error.bind(console);
console.error = (...args: unknown[]) => { try { anotarErro(args.map(texto).join(" ")); } catch {} origErro(...args); };
process.on("uncaughtException", (e) => { anotarErro("Erro não tratado: " + texto(e)); origErro(e); });
process.on("unhandledRejection", (e) => { anotarErro("Promessa sem tratamento: " + texto(e)); origErro(e); });

export function ligarCacador(app: Express) {
  // lembra em qual rota cada erro aconteceu
  app.use((req: Request, _res: Response, next: NextFunction) => rotaAtual.run(req.method + " " + req.originalUrl.split("?")[0], next));
  // respostas de erro (400, 404, 500…) também são anotadas, com a mensagem
  app.use((req: Request, res: Response, next: NextFunction) => {
    const json = res.json.bind(res);
    res.json = (corpo: any) => {
      if (res.statusCode >= 400 && req.originalUrl.startsWith("/api/") && !req.originalUrl.startsWith("/api/_erros")) {
        anotarErro("Respondeu " + res.statusCode + ": " + texto(corpo), req.method + " " + req.originalUrl.split("?")[0]);
      }
      return json(corpo);
    };
    next();
  });
  app.get("/api/_erros", (_req: Request, res: Response) => res.json({ erros: lista.slice(), arquivo: ARQUIVO }));
  app.delete("/api/_erros", (_req: Request, res: Response) => { lista.length = 0; res.json({ ok: true }); });
}
