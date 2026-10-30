/**
 * 🔧 compat.ts — rotas que a TELA do 1.7 chama e que o servidor do 1.7 não tinha
 * (achadas pelo 🧭 Mapa de Rotas do Mini SK, 28/10). Trazidas da versão
 * consertada que funcionava (Jurídico COMPLETO / Mini SK, 20/10).
 *
 *  - /processos            → o Painel de Processos chama assim; o servidor só tinha
 *                             /processos-monitorados. Agora os dois nomes funcionam.
 *  - /djen/config (GET/PUT), /djen/gerar-token, /djen/clientes, /djen/publicacoes,
 *    /djen/execucoes, /djen/executar  → o Robô DJEN inteiro.
 *  - /tramitacao/sync-publicacoes → o botão "buscar publicações" da Tramitação.
 *
 * Tudo guardado pelo "storage" do próprio jurídico (banco, ou o arquivo local
 * quando não há banco) — sem tabela nova.
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { storage } from "../storage.js";
import { insertProcessoMonitoradoSchema } from "../../shared/db";

const router = Router();

// ── guardar listas como JSON nas configurações do próprio app ────────────────
async function lerLista<T = any>(chave: string): Promise<T[]> {
  try { const v = await storage.getSetting(chave); const l = v ? JSON.parse(v) : []; return Array.isArray(l) ? l : []; } catch { return []; }
}
async function gravarLista(chave: string, lista: any[]) { await storage.setSetting(chave, JSON.stringify(lista)); }

// ═════════════ /processos (= /processos-monitorados) ═════════════
router.get("/processos", async (_req, res) => {
  try { res.json(await storage.getProcessosMonitorados()); } catch (e: any) { res.status(500).json({ message: "Erro ao buscar processos: " + e.message }); }
});
router.get("/processos/:id", async (req, res) => {
  try {
    const p = (await storage.getProcessosMonitorados()).find((x: any) => String(x.id) === req.params.id);
    if (!p) return res.status(404).json({ message: "Processo não encontrado" });
    res.json(p);
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});
router.post("/processos", async (req, res) => {
  try {
    const parsed = insertProcessoMonitoradoSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Dados inválidos: " + parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ") });
    res.status(201).json(await storage.createProcessoMonitorado(parsed.data));
  } catch (e: any) { res.status(500).json({ message: "Erro ao criar processo: " + e.message }); }
});
router.patch("/processos/:id", async (req, res) => {
  try {
    const p = await storage.updateProcessoMonitorado(req.params.id, req.body);
    if (!p) return res.status(404).json({ message: "Processo não encontrado" });
    res.json(p);
  } catch (e: any) { res.status(500).json({ message: "Erro ao atualizar processo: " + e.message }); }
});
router.delete("/processos/:id", async (req, res) => {
  try { await storage.deleteProcessoMonitorado(req.params.id); res.status(204).send(); } catch (e: any) { res.status(500).json({ message: "Erro ao excluir processo: " + e.message }); }
});

// ═════════════ Robô DJEN ═════════════
interface DjenConfig {
  djenToken: string; pdpjPemKey: string; advogadoCpf: string; advogadoNome: string;
  jwtIssuer: string; jwtAudience: string; emailLogin: string; emailSenha: string;
  imapServer: string; salvarDrive: boolean; pastaDriveId: string; maxPaginas: number;
}
const PADRAO: DjenConfig = {
  djenToken: "", pdpjPemKey: "", advogadoCpf: "", advogadoNome: "", jwtIssuer: "pdpj-br",
  jwtAudience: "https://comunicaapi.pje.jus.br", emailLogin: "", emailSenha: "", imapServer: "imap.gmail.com",
  salvarDrive: false, pastaDriveId: "", maxPaginas: 5,
};
async function getDjenConfig(): Promise<DjenConfig> {
  try {
    const v = await storage.getSetting("djen_config");
    const cfg = v ? { ...PADRAO, ...JSON.parse(v) } : { ...PADRAO };
    if (!cfg.djenToken) cfg.djenToken = ((await storage.getSetting("djen_token")) || "").trim(); // token da versão antiga
    return cfg;
  } catch { return { ...PADRAO }; }
}
async function saveDjenConfig(c: DjenConfig) { await storage.setSetting("djen_config", JSON.stringify(c)); }

function gerarTokenJwt(config: DjenConfig): string {
  const pem = config.pdpjPemKey.replace(/\\n/g, "\n").trim();
  const cpf = config.advogadoCpf.replace(/\D/g, "");
  if (cpf.length !== 11) throw new Error("CPF inválido — deve ter 11 dígitos");
  const agora = Math.floor(Date.now() / 1000);
  const payload: Record<string, any> = { sub: cpf, iss: config.jwtIssuer || "pdpj-br", aud: config.jwtAudience || "https://comunicaapi.pje.jus.br", iat: agora, exp: agora + 3600, jti: `djen-${agora}` };
  if (config.advogadoNome) payload.name = config.advogadoNome;
  try { return jwt.sign(payload, pem, { algorithm: "RS256" }) as string; }
  catch (e: any) { throw new Error(`Erro ao gerar JWT: ${e.message}`); }
}
async function obterToken(c: DjenConfig) { if (c.djenToken) return c.djenToken; if (c.pdpjPemKey && c.advogadoCpf) return gerarTokenJwt(c); return ""; }

const DJEN_URL = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";
async function buscarPublicacoesDJEN(token: string, maxPaginas: number): Promise<any[]> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const todas: any[] = [];
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const resp = await fetch(`${DJEN_URL}?pagina=${pagina}&itensPorPagina=20`, { headers, signal: AbortSignal.timeout(15000) });
    if (resp.status === 401) throw new Error("Token inválido ou expirado (401)");
    if (resp.status === 403) throw new Error("IP bloqueado ou chave não registrada no PDPJ (403)");
    if (!resp.ok) throw new Error(`Erro HTTP ${resp.status}`);
    const dados: any = await resp.json();
    const itens = dados.comunicacoes || dados.data || dados;
    const lista = Array.isArray(itens) ? itens : Object.values(itens as object);
    if (!lista.length) break;
    todas.push(...lista);
    const total = parseInt(dados.total || dados.totalItens || "0");
    if (total && todas.length >= total) break;
  }
  return todas;
}
const DATA_RE = /(\d{2}\/\d{2}\/\d{4})/;
const CONECTIVOS = /(?:e|a|até|ao|com\s+término\s+em|com\s+término)/i;
const PADROES = [
  new RegExp(`entre\\s+os\\s+dias\\s+${DATA_RE.source}\\s+${CONECTIVOS.source}\\s+${DATA_RE.source}`, "i"),
  new RegExp(`per[íi]odo\\s+de\\s+${DATA_RE.source}\\s+${CONECTIVOS.source}\\s+${DATA_RE.source}`, "i"),
  new RegExp(`julgamento\\s+(?:virtual\\s+)?de\\s+${DATA_RE.source}\\s+${CONECTIVOS.source}\\s+${DATA_RE.source}`, "i"),
  new RegExp(`de\\s+${DATA_RE.source}\\s+${CONECTIVOS.source}\\s+${DATA_RE.source}`, "i"),
];
const parseData = (t: string) => { const [d, m, a] = t.split("/").map(Number); const x = new Date(a, m - 1, d); return isNaN(x.getTime()) ? null : x; };
const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
function extrairDadosSessao(texto: string) {
  for (const p of PADROES) {
    const m = p.exec(texto); if (!m) continue;
    const i = parseData(m[1]), f = parseData(m[2]); if (!i || !f) continue;
    return { inicio: fmt(i), fim: fmt(f), prazoOral: `${fmt(new Date(i.getTime() - 48 * 3600 * 1000))} às 23:59` };
  }
  return null;
}
const normalizarProcesso = (n: string) => String(n || "").replace(/\s+/g, "").trim();
function dadosSimulados() {
  return [
    { numeroProcesso: "6002755-35.2024.4.06.3819", texto: "JULGAMENTO VIRTUAL. Processo nº 6002755-35.2024.4.06.3819. O julgamento ocorrerá de forma virtual entre os dias 26/11/2025 e 02/12/2025. Assunto: Aposentadoria por Tempo de Contribuição.", linkDocumento: "" },
    { numeroProcesso: "0001234-56.2023.8.21.0001", texto: "PAUTA VIRTUAL. Processo nº 0001234-56.2023.8.21.0001. Sessão virtual de julgamento designada para o período de 10/12/2025 a 17/12/2025. Recurso de apelação.", linkDocumento: "" },
  ];
}

router.get("/djen/config", async (_req, res) => {
  try {
    const c = await getDjenConfig();
    res.json({ ...c, emailSenha: c.emailSenha ? "••••••••" : "", pdpjPemKey: c.pdpjPemKey ? "••• (configurada)" : "", configured: !!(c.djenToken || c.pdpjPemKey), masked: c.djenToken ? c.djenToken.substring(0, 8) + "..." : "" });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});
router.put("/djen/config", async (req, res) => {
  try {
    const atual = await getDjenConfig(); const b = (req.body || {}) as Record<string, any>;
    const novo: DjenConfig = { ...atual, ...b,
      emailSenha: b.emailSenha === "••••••••" ? atual.emailSenha : (b.emailSenha || ""),
      pdpjPemKey: String(b.pdpjPemKey || "").startsWith("•••") ? atual.pdpjPemKey : (b.pdpjPemKey || ""),
      maxPaginas: Number(b.maxPaginas || atual.maxPaginas || 5) };
    await saveDjenConfig(novo);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});
router.post("/djen/gerar-token", async (req, res, next) => {
  // o jeito antigo (e-mail + senha) continua no extra.ts
  if (req.body && req.body.email && req.body.password) return next();
  try {
    const c = await getDjenConfig();
    if (!c.pdpjPemKey || !c.advogadoCpf) return res.status(400).json({ message: "Configure a chave PEM e o CPF antes de gerar o token." });
    res.json({ token: gerarTokenJwt(c) });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});
router.get("/djen/clientes", async (_req, res) => {
  try { res.json((await lerLista("djen_clientes")).sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)))); } catch (e: any) { res.status(500).json({ message: e.message }); }
});
router.post("/djen/clientes", async (req, res) => {
  try {
    const { nomeCompleto, email, tratamento, nomeCaso, numeroProcesso } = req.body || {};
    if (!nomeCompleto || !numeroProcesso) return res.status(400).json({ message: "Nome e número do processo são obrigatórios" });
    const novo = { id: randomUUID(), nomeCompleto, email: email || "", tratamento: tratamento || `Prezado(a) ${String(nomeCompleto).split(" ")[0]}`, nomeCaso: nomeCaso || "", numeroProcesso, createdAt: new Date().toISOString() };
    const l = await lerLista("djen_clientes"); l.push(novo); await gravarLista("djen_clientes", l);
    res.status(201).json(novo);
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});
router.delete("/djen/clientes/:id", async (req, res) => {
  try { await gravarLista("djen_clientes", (await lerLista("djen_clientes")).filter((c: any) => c.id !== req.params.id)); res.json({ ok: true }); } catch (e: any) { res.status(500).json({ message: e.message }); }
});
router.get("/djen/publicacoes", async (_req, res) => {
  try { res.json((await lerLista("djen_publicacoes")).slice(0, 200)); } catch (e: any) { res.status(500).json({ message: e.message }); }
});
router.get("/djen/execucoes", async (_req, res) => {
  try { res.json((await lerLista("djen_execucoes")).slice(0, 50)); } catch (e: any) { res.status(500).json({ message: e.message }); }
});
router.post("/djen/executar", async (_req, res) => {
  const execId = randomUUID(); const logs: string[] = []; const stats = { total: 0, processadas: 0, comErro: 0, ignoradas: 0 };
  const addLog = (m: string) => logs.push(`[${new Date().toLocaleTimeString("pt-BR")}] ${m}`);
  const salvarExec = async (status: string) => { const l = (await lerLista("djen_execucoes")).filter((x: any) => x.id !== execId); l.unshift({ id: execId, status, totalPublicacoes: String(stats.total), processadas: String(stats.processadas), comErro: String(stats.comErro), ignoradas: String(stats.ignoradas), log: logs.join("\n"), createdAt: new Date().toISOString() }); await gravarLista("djen_execucoes", l.slice(0, 50)); };
  try {
    const config = await getDjenConfig(); addLog("Configuração carregada");
    const token = await obterToken(config);
    let publicacoes: any[];
    if (!token) { addLog("⚠️  Sem token — usando dados de demonstração"); publicacoes = dadosSimulados(); }
    else { addLog("🔑 Token obtido, consultando DJEN..."); publicacoes = await buscarPublicacoesDJEN(token, config.maxPaginas || 5); addLog(`📦 ${publicacoes.length} publicação(ões) encontrada(s)`); }
    stats.total = publicacoes.length;
    const clientes = await lerLista("djen_clientes");
    const mapa = new Map<string, any>(); for (const c of clientes) mapa.set(normalizarProcesso(c.numeroProcesso), c);
    addLog(`👥 ${clientes.length} cliente(s) cadastrado(s)`);
    const pubs = await lerLista("djen_publicacoes");
    for (const pub of publicacoes) {
      const numProc = pub.numeroProcesso || pub.numero_processo || ""; const texto = pub.texto || pub.conteudo || ""; const link = pub.linkDocumento || pub.link || "";
      addLog(`📋 Processando: ${numProc}`);
      const sessao = extrairDadosSessao(texto);
      if (!sessao) { addLog("   ℹ️  Sem sessão identificada — ignorado"); stats.ignoradas++; continue; }
      addLog(`   📅 Sessão: ${sessao.inicio} → ${sessao.fim}`);
      const cliente = mapa.get(normalizarProcesso(numProc));
      pubs.unshift({ id: randomUUID(), execucaoId: execId, numeroProcesso: numProc, texto: String(texto).substring(0, 2000), inicioSessao: sessao.inicio, fimSessao: sessao.fim, prazoOral: sessao.prazoOral, linkDocumento: link, clienteId: cliente?.id || "", clienteNome: cliente?.nomeCompleto || "", emailStatus: "nao_enviado", createdAt: new Date().toISOString() });
      if (cliente) { addLog(`   👤 Cliente: ${cliente.nomeCompleto} (${cliente.email})`); stats.processadas++; } else { addLog("   ⚠️  Cliente não encontrado na lista"); stats.ignoradas++; }
    }
    await gravarLista("djen_publicacoes", pubs.slice(0, 500));
    await salvarExec("concluido");
    res.json({ execucaoId: execId, sucesso: true, mensagem: `Concluído: ${stats.processadas} processadas, ${stats.comErro} com erro, ${stats.ignoradas} ignoradas`, estatisticas: stats, log: logs });
  } catch (e: any) {
    addLog(`❌ Erro: ${e.message}`);
    try { await salvarExec("erro"); } catch {}
    res.json({ execucaoId: execId, sucesso: false, mensagem: `Erro: ${e.message}`, estatisticas: stats, log: logs });
  }
});

// ═════════════ Tramitação → buscar publicações ═════════════
const TRAMITACAO_BASE = "https://planilha.tramitacaointeligente.com.br/api/v1";
router.post("/tramitacao/sync-publicacoes", async (_req, res) => {
  try {
    const token = await storage.getSetting("tramitacao_token");
    if (!token) return res.status(400).json({ message: "Token do Tramitação Inteligente não configurado. Vá em Configurações e salve seu token." });
    let raw: any[] = [], ok = false;
    for (const ep of ["/publications?per_page=50&page=1", "/publicacoes?per_page=50&page=1"]) {
      try {
        const r = await fetch(`${TRAMITACAO_BASE}${ep}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
        if (r.ok) { const d: any = await r.json(); raw = Array.isArray(d) ? d : Array.isArray(d?.publications) ? d.publications : Array.isArray(d?.publicacoes) ? d.publicacoes : Array.isArray(d?.data) ? d.data : []; ok = true; break; }
      } catch { /* tenta o próximo */ }
    }
    if (!ok) return res.json({ publicacoes: await storage.getTramitacaoPublicacoes(200), synced: 0, source: "local", warning: "Não foi possível conectar à API do Tramitação Inteligente. Mostrando publicações locais recebidas via webhook." });
    let n = 0;
    for (const pub of raw) {
      try {
        await storage.upsertTramitacaoPublicacao({
          extId: String(pub.id || pub.ext_id || Math.random()), idempotencyKey: pub.idempotency_key || "",
          numeroProcesso: pub.numero_processo || pub.process_number || "", numeroProcessoMascara: pub.numero_processo_com_mascara || pub.numero_processo || "",
          tribunal: pub.siglaTribunal || pub.tribunal || pub.court || "", orgao: pub.nomeOrgao || pub.orgao || pub.organ || "", classe: pub.nomeClasse || pub.classe || pub.class || "",
          texto: pub.texto || pub.text || pub.content || "", disponibilizacaoDate: pub.disponibilizacao_date || pub.available_date || "",
          publicacaoDate: pub.publication_date || pub.published_at || "", inicioPrazoDate: pub.inicio_do_prazo_date || pub.deadline_start || "",
          linkTramitacao: pub.link_tramitacao || pub.link || "", linkTribunal: pub.link_tribunal || pub.tribunal_link || "",
          destinatarios: JSON.stringify(pub.destinatarios || pub.recipients || []), advogados: JSON.stringify(pub.destinatario_advogados || pub.lawyers || []),
        } as any);
        n++;
      } catch { /* pula o que vier estranho */ }
    }
    res.json({ publicacoes: await storage.getTramitacaoPublicacoes(200), synced: n, source: "api" });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

export default router;
