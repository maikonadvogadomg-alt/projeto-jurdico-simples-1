// ⚖️ npm run dev — liga o SK Jurídico inteiro com UM comando:
//   o SERVIDOR (8080) e a TELA (5173), juntos. Abra http://localhost:5173
//   Sem banco, salva no arquivo sk-juridico-local-data.json (aqui na pasta).
import { spawn } from "child_process";
const WIN = process.platform === "win32";
const ligar = (nome, cor, cmd, env) => {
  const p = spawn(cmd, { shell: true, env: { ...process.env, ...env } });
  const pre = `\x1b[${cor}m[${nome}]\x1b[0m `;
  const escrever = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => console.log(pre + l));
  p.stdout.on("data", escrever); p.stderr.on("data", escrever);
  p.on("close", (c) => console.log(pre + "parou (código " + c + ")"));
  return p;
};
console.log("⚖️  Ligando o SK Jurídico… servidor na 8080, tela na 5173 → abra http://localhost:5173  (Ctrl+C para parar)");
const srv = ligar("servidor", 33, "npm run servidor", { PORT: "8080", LOCAL_MODE: "1", NODE_ENV: "development" });
const tela = ligar("tela", 36, "npm run tela", { API_URL: "http://127.0.0.1:8080" });
const parar = () => { for (const p of [srv, tela]) try { WIN ? spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"]) : p.kill(); } catch {} setTimeout(() => process.exit(0), 300); };
process.on("SIGINT", parar); process.on("SIGTERM", parar);
