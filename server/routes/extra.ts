/**
 * Extra routes migrated from ZIP2/routes.ts
 * Covers: JWT, DataJud queries, Corporativo, PDPJ, CNJ, code/run, previdenciario,
 *         pesquisa/oab, djen, export/word, export/word-with-template, 
 *         doc-templates/upload-docx, tramitacao proxy, settings/:key
 */
import { Router } from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import mammoth from "mammoth";
import { storage } from "../storage.js";
import { Document, Paragraph, TextRun, Packer, AlignmentType } from "docx";
import { insertDocTemplateSchema } from "../../shared/db";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 },
});

// ── JWT ───────────────────────────────────────────────────────────────────────
router.post("/jwt/generate", async (req, res) => {
  const pemKey = process.env.PDPJ_PEM_PRIVATE_KEY;
  try {
    if (!pemKey) {
      return res.status(400).json({ message: "Chave PEM não configurada. Adicione PDPJ_PEM_PRIVATE_KEY nos segredos do projeto." });
    }
    const { cpf, tribunal, expiresInMinutes, nome, modo } = req.body;
    if (!cpf || typeof cpf !== "string" || cpf.replace(/\D/g, "").length !== 11) {
      return res.status(400).json({ message: "CPF inválido. Deve ter 11 dígitos." });
    }
    const cleanCpf = cpf.replace(/\D/g, "");
    const expMinutes = Math.min(Math.max(parseInt(expiresInMinutes) || 5, 1), 60);
    const validTribunals = ["TJMG","TJSP","TJRJ","TJRS","TJPR","TJSC","TJBA","TJPE","TJCE","TJGO","TJDF","TRT2","TRT3","TRF1","TRF3","CNJ"];
    const selectedTribunal = validTribunals.includes(tribunal) ? tribunal : "TJMG";
    const isPjud = modo === "pjud";
    const now = Math.floor(Date.now() / 1000);
    const payload: Record<string, any> = {
      sub: cleanCpf,
      iss: isPjud ? "pjud-client" : "pdpj-br",
      aud: isPjud ? "https://gateway.stg.cloud.pje.jus.br" : "https://gateway.stg.cloud.pje.jus.br",
      iat: now, exp: now + expMinutes * 60,
      jti: `${isPjud ? "pjud" : "pdpj"}-${Date.now()}`,
      tribunal: selectedTribunal, scope: "pdpj.read pdpj.write",
    };
    if (nome && typeof nome === "string" && nome.trim()) payload.name = nome.trim();

    let formattedKey = pemKey;
    if (formattedKey.includes("\\n")) formattedKey = formattedKey.replace(/\\n/g, "\n");
    if (!formattedKey.startsWith("-----BEGIN")) {
      formattedKey = `-----BEGIN PRIVATE KEY-----\n${formattedKey.replace(/\s+/g, "").replace(/(.{64})/g, "$1\n").trim()}\n-----END PRIVATE KEY-----`;
    }
    formattedKey = formattedKey.trim();

    const token = jwt.sign(payload, formattedKey, { algorithm: "RS256" });
    const expiresAt = new Date((now + expMinutes * 60) * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    res.json({ token, tokenType: "Bearer", expiresIn: expMinutes * 60, expiresAt, payload, header: `Authorization: Bearer ${token}` });
  } catch (error: any) {
    console.error("JWT generation error:", error);
    res.status(400).json({ message: "Erro ao gerar token JWT: " + (error.message || "erro desconhecido") });
  }
});

router.get("/jwt/status", (_req, res) => {
  res.json({ configured: !!process.env.PDPJ_PEM_PRIVATE_KEY });
});

// ── DataJud Consulta Específica ───────────────────────────────────────────────
const DATAJUD_API_KEY = process.env.DATAJUD_API_KEY || "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

const TRIBUNAL_ALIASES: Record<string, string> = {
  TJAC:"api_publica_tjac",TJAL:"api_publica_tjal",TJAM:"api_publica_tjam",TJAP:"api_publica_tjap",
  TJBA:"api_publica_tjba",TJCE:"api_publica_tjce",TJDFT:"api_publica_tjdft",TJES:"api_publica_tjes",
  TJGO:"api_publica_tjgo",TJMA:"api_publica_tjma",TJMG:"api_publica_tjmg",TJMS:"api_publica_tjms",
  TJMT:"api_publica_tjmt",TJPA:"api_publica_tjpa",TJPB:"api_publica_tjpb",TJPE:"api_publica_tjpe",
  TJPI:"api_publica_tjpi",TJPR:"api_publica_tjpr",TJRJ:"api_publica_tjrj",TJRN:"api_publica_tjrn",
  TJRO:"api_publica_tjro",TJRR:"api_publica_tjrr",TJRS:"api_publica_tjrs",TJSC:"api_publica_tjsc",
  TJSE:"api_publica_tjse",TJSP:"api_publica_tjsp",TJTO:"api_publica_tjto",
  TRF1:"api_publica_trf1",TRF2:"api_publica_trf2",TRF3:"api_publica_trf3",TRF4:"api_publica_trf4",TRF5:"api_publica_trf5",TRF6:"api_publica_trf6",
  TST:"api_publica_tst",STJ:"api_publica_stj",STF:"api_publica_stf",
  TRT1:"api_publica_trt1",TRT2:"api_publica_trt2",TRT3:"api_publica_trt3",TRT4:"api_publica_trt4",TRT5:"api_publica_trt5",
  TRT6:"api_publica_trt6",TRT7:"api_publica_trt7",TRT8:"api_publica_trt8",TRT9:"api_publica_trt9",TRT10:"api_publica_trt10",
  TRT11:"api_publica_trt11",TRT12:"api_publica_trt12",TRT13:"api_publica_trt13",TRT14:"api_publica_trt14",TRT15:"api_publica_trt15",
  TRT16:"api_publica_trt16",TRT17:"api_publica_trt17",TRT18:"api_publica_trt18",TRT19:"api_publica_trt19",TRT20:"api_publica_trt20",
  TRT21:"api_publica_trt21",TRT22:"api_publica_trt22",TRT23:"api_publica_trt23",TRT24:"api_publica_trt24",
};

function detectTribunalFromNumber(numero: string): string | null {
  const clean = numero.replace(/[.\-\s]/g, "");
  if (clean.length < 20) return null;
  const justica = clean.substring(13, 14);
  const segmento = clean.substring(14, 16);
  if (justica === "8") {
    const tjMap: Record<string,string> = {"01":"TJAC","02":"TJAL","03":"TJAP","04":"TJAM","05":"TJBA","06":"TJCE","07":"TJDFT","08":"TJES","09":"TJGO","10":"TJMA","11":"TJMT","12":"TJMS","13":"TJMG","14":"TJPA","15":"TJPB","16":"TJPE","17":"TJPI","18":"TJPR","19":"TJRJ","20":"TJRN","21":"TJRO","22":"TJRR","23":"TJRS","24":"TJSC","25":"TJSE","26":"TJSP","27":"TJTO"};
    return tjMap[segmento] || null;
  }
  if (justica === "4") { const m: Record<string,string> = {"01":"TRF1","02":"TRF2","03":"TRF3","04":"TRF4","05":"TRF5","06":"TRF6"}; return m[segmento] || null; }
  if (justica === "5") { const m: Record<string,string> = {"01":"TRT1","02":"TRT2","03":"TRT3","04":"TRT4","05":"TRT5","06":"TRT6","07":"TRT7","08":"TRT8","09":"TRT9","10":"TRT10","11":"TRT11","12":"TRT12","13":"TRT13","14":"TRT14","15":"TRT15","16":"TRT16","17":"TRT17","18":"TRT18","19":"TRT19","20":"TRT20","21":"TRT21","22":"TRT22","23":"TRT23","24":"TRT24"}; return m[segmento] || null; }
  return null;
}

router.get("/datajud/tribunais", (_req, res) => {
  const tribunais = Object.keys(TRIBUNAL_ALIASES).map(key => ({
    sigla: key,
    tipo: key.startsWith("TJ") ? "Estadual" : key.startsWith("TRF") ? "Federal" : key.startsWith("TRT") ? "Trabalhista" : "Superior",
  }));
  res.json(tribunais);
});

router.post("/datajud/consulta", async (req, res) => {
  try {
    const { numeroProcesso, tribunal } = req.body;
    if (!numeroProcesso || typeof numeroProcesso !== "string") return res.status(400).json({ message: "Número do processo é obrigatório" });
    const cleanNum = numeroProcesso.replace(/[.\-\s]/g, "");
    let selectedTribunal = tribunal as string;
    if (!selectedTribunal || !TRIBUNAL_ALIASES[selectedTribunal]) {
      const detected = detectTribunalFromNumber(cleanNum);
      if (detected) selectedTribunal = detected;
      else return res.status(400).json({ message: "Não foi possível detectar o tribunal. Selecione manualmente." });
    }
    const alias = TRIBUNAL_ALIASES[selectedTribunal];
    const url = `https://api-publica.datajud.cnj.jus.br/${alias}/_search`;
    const body = { query: { match: { numeroProcesso: cleanNum } }, size: 1 };
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `APIKey ${DATAJUD_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return res.status(502).json({ message: `Erro na API DataJud: ${response.status}` });
    const data = await response.json() as any;
    const hits = data?.hits?.hits || [];
    if (hits.length === 0) return res.json({ found: false, message: "Processo não encontrado no DataJud." });
    const processo = hits[0]._source;
    const movimentos = (processo.movimentos || []).sort((a: any, b: any) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime());
    res.json({
      found: true, tribunal: selectedTribunal,
      processo: {
        numero: processo.numeroProcesso, classe: processo.classe?.nome || "", classeCode: processo.classe?.codigo || "",
        sistema: processo.sistema?.nome || "", formato: processo.formato?.nome || "",
        orgaoJulgador: processo.orgaoJulgador?.nome || "", codigoOrgao: processo.orgaoJulgador?.codigo || "",
        municipio: processo.orgaoJulgador?.codigoMunicipioIBGE || "",
        dataAjuizamento: processo.dataAjuizamento || "", dataUltimaAtualizacao: processo.dataHoraUltimaAtualizacao || "",
        grau: processo.grau || "", nivelSigilo: processo.nivelSigilo || 0,
        assuntos: (processo.assuntos || []).map((a: any) => ({ nome: a.nome || "", codigo: a.codigo || "" })),
        movimentos: movimentos.map((m: any) => ({ dataHora: m.dataHora || "", nome: m.nome || "", codigo: m.codigo || "", complementos: m.complementosTabelados || [] })),
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: "Erro ao consultar DataJud: " + (error.message || "erro desconhecido") });
  }
});

router.post("/datajud/consulta-oab", async (req, res) => {
  try {
    const { oab, uf, tribunal } = req.body;
    if (!oab || typeof oab !== "string") return res.status(400).json({ message: "Número da OAB é obrigatório" });
    if (!tribunal || !TRIBUNAL_ALIASES[tribunal]) return res.status(400).json({ message: "Tribunal é obrigatório para busca por OAB" });
    const cleanOab = oab.replace(/\D/g, "");
    if (!cleanOab) return res.status(400).json({ message: "Número da OAB inválido" });
    const alias = TRIBUNAL_ALIASES[tribunal];
    const url = `https://api-publica.datajud.cnj.jus.br/${alias}/_search`;
    const cleanUf = (uf || "").toUpperCase().trim();
    const body = { query: { match: { "advogados.inscricao": cleanOab } }, size: 50, sort: [{ dataHoraUltimaAtualizacao: { order: "desc" } }] };
    let hits: any[] = [];
    try {
      const r = await fetch(url, { method: "POST", headers: { Authorization: `APIKey ${DATAJUD_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) { const d = await r.json() as any; hits = d?.hits?.hits || []; }
    } catch (e) { console.log("DataJud OAB query failed:", e); }

    if (hits.length === 0) return res.json({ found: false, processos: [], message: "A API pública do DataJud pode não disponibilizar dados de OAB para busca. Use a busca por número do processo." });
    const processos = hits.map((hit: any) => {
      const p = hit._source;
      const movs = (p.movimentos || []).sort((a: any, b: any) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime());
      return { numero: p.numeroProcesso || "", classe: p.classe?.nome || "", orgaoJulgador: p.orgaoJulgador?.nome || "", dataAjuizamento: p.dataAjuizamento || "", dataUltimaAtualizacao: p.dataHoraUltimaAtualizacao || "", grau: p.grau || "", assuntos: (p.assuntos || []).map((a: any) => ({ nome: a.nome || "", codigo: a.codigo || "" })), ultimaMovimentacao: movs.length > 0 ? movs[0].nome : "", ultimaMovimentacaoData: movs.length > 0 ? movs[0].dataHora : "", totalMovimentos: movs.length };
    });
    res.json({ found: true, total: hits.length, tribunal, processos });
  } catch (error: any) {
    res.status(500).json({ message: "Erro ao consultar DataJud por OAB: " + (error.message || "erro desconhecido") });
  }
});

// ── Corporativo Proxy ─────────────────────────────────────────────────────────
const CORPORATIVO_BASE = "https://gateway.cloud.pje.jus.br/corporativo-proxy/api/v1";

router.get("/corporativo/advogado/cpf/:cpf", async (req, res) => {
  try {
    const cpf = req.params.cpf.replace(/\D/g, "");
    if (cpf.length !== 11) return res.status(400).json({ message: "CPF inválido" });
    const r = await fetch(`${CORPORATIVO_BASE}/advogado/oab/${cpf}`, { headers: { Accept: "application/json" } });
    if (r.status === 204) return res.json({ found: false, data: [] });
    if (!r.ok) {
      let errMsg = `Erro na API: ${r.status}`;
      if (r.status === 403) errMsg = "API bloqueada - acesso apenas de IPs brasileiros";
      return res.status(r.status).json({ message: errMsg });
    }
    const data = await r.json();
    res.json({ found: true, data: Array.isArray(data) ? data : [data] });
  } catch (e: any) { res.status(500).json({ message: "Erro ao consultar API Corporativo: " + (e.message || "erro desconhecido") }); }
});

router.get("/corporativo/advogado/oab/:uf/:inscricao", async (req, res) => {
  try {
    const { uf, inscricao } = req.params;
    const r = await fetch(`${CORPORATIVO_BASE}/advogado/oab/${uf.toUpperCase()}/${inscricao.replace(/\D/g, "")}`, { headers: { Accept: "application/json" } });
    if (r.status === 204) return res.json({ found: false, data: null });
    if (!r.ok) {
      let errMsg = `Erro na API: ${r.status}`;
      if (r.status === 403) errMsg = "API bloqueada - acesso apenas de IPs brasileiros";
      return res.status(r.status).json({ message: errMsg });
    }
    const data = await r.json();
    res.json({ found: true, data });
  } catch (e: any) { res.status(500).json({ message: "Erro ao consultar API Corporativo: " + (e.message || "erro desconhecido") }); }
});

router.get("/corporativo/magistrados/:tribunal", async (req, res) => {
  try {
    const tribunal = req.params.tribunal.toUpperCase();
    const r = await fetch(`${CORPORATIVO_BASE}/magistrado?siglaTribunal=${tribunal}`, { headers: { Accept: "application/json" } });
    if (!r.ok) {
      let errMsg = `Erro na API: ${r.status}`;
      if (r.status === 403) errMsg = "API bloqueada - acesso apenas de IPs brasileiros";
      return res.status(r.status).json({ message: errMsg });
    }
    const data = await r.json();
    res.json({ found: true, data: Array.isArray(data) ? data : [] });
  } catch (e: any) { res.status(500).json({ message: "Erro ao consultar magistrados: " + (e.message || "erro desconhecido") }); }
});

// ── PDPJ ─────────────────────────────────────────────────────────────────────
const DOMICILIO_BASE_STG = "https://gateway.stg.cloud.pje.jus.br/domicilio-eletronico-hml";
const DOMICILIO_BASE_PROD = "https://domicilio-eletronico.pdpj.jus.br";

function formatPemKey(pemKey: string): string {
  let key = pemKey;
  if (key.includes("\\n")) key = key.replace(/\\n/g, "\n");
  if (!key.startsWith("-----BEGIN")) {
    key = `-----BEGIN PRIVATE KEY-----\n${key.replace(/\s+/g, "").replace(/(.{64})/g, "$1\n").trim()}\n-----END PRIVATE KEY-----`;
  }
  return key.trim();
}

function generatePdpjToken(cpf: string, modo: string, tribunal: string, expiresMinutes: number, ambiente: string): string | null {
  const pemKey = process.env.PDPJ_PEM_PRIVATE_KEY;
  if (!pemKey) return null;
  const formattedKey = formatPemKey(pemKey);
  const now = Math.floor(Date.now() / 1000);
  const isPjud = modo === "pjud";
  const isProd = ambiente === "producao";
  const payload: Record<string, any> = {
    sub: cpf, iss: isPjud ? "pjud-client" : "pdpj-br",
    aud: isProd ? "https://gateway.cloud.pje.jus.br" : "https://gateway.stg.cloud.pje.jus.br",
    iat: now, exp: now + expiresMinutes * 60,
    jti: `${isPjud ? "pjud" : "pdpj"}-${Date.now()}`, tribunal, scope: "pdpj.read pdpj.write",
  };
  return jwt.sign(payload, formattedKey, { algorithm: "RS256" });
}

async function pdpjFetch(url: string, token: string, cpf?: string): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${token}` };
  if (cpf) headers["On-behalf-Of"] = cpf.replace(/\D/g, "");
  return fetch(url, { headers });
}

router.get("/pdpj/status", (_req, res) => {
  res.json({ configured: !!process.env.PDPJ_PEM_PRIVATE_KEY });
});

router.post("/pdpj/test-connection", async (req, res) => {
  try {
    const { cpf, modo, tribunal, ambiente } = req.body;
    const cleanCpf = (cpf || "").replace(/\D/g, "");
    if (cleanCpf.length !== 11) return res.status(400).json({ message: "CPF inválido" });
    const token = generatePdpjToken(cleanCpf, modo || "pdpj", tribunal || "TJMG", 15, ambiente || "homologacao");
    if (!token) return res.status(400).json({ message: "Chave PEM não configurada" });
    const baseUrl = ambiente === "producao" ? DOMICILIO_BASE_PROD : DOMICILIO_BASE_STG;
    const r = await pdpjFetch(`${baseUrl}/api/v1/eu`, token, cleanCpf);
    if (r.ok) { const data = await r.json(); res.json({ connected: true, data, ambiente: ambiente || "homologacao" }); }
    else {
      let errMsg = `Status ${r.status}`;
      try { const t = await r.text(); if (t) errMsg = t; } catch {}
      if (r.status === 403) errMsg = "Acesso bloqueado - API restrita a IPs brasileiros";
      if (r.status === 401) errMsg = "Token não autorizado - verifique se a chave PEM está registrada no PDPJ";
      res.json({ connected: false, status: r.status, message: errMsg });
    }
  } catch (e: any) { res.json({ connected: false, message: "Erro de conexão: " + (e.message || "desconhecido") }); }
});

router.post("/pdpj/comunicacoes", async (req, res) => {
  try {
    const { cpf, modo, tribunal, ambiente, dataInicio, dataFim, pagina } = req.body;
    const cleanCpf = (cpf || "").replace(/\D/g, "");
    if (cleanCpf.length !== 11) return res.status(400).json({ message: "CPF inválido" });
    const token = generatePdpjToken(cleanCpf, modo || "pdpj", tribunal || "TJMG", 15, ambiente || "homologacao");
    if (!token) return res.status(400).json({ message: "Chave PEM não configurada" });
    const baseUrl = ambiente === "producao" ? DOMICILIO_BASE_PROD : DOMICILIO_BASE_STG;
    let url = `${baseUrl}/api/v1/comunicacoes-representantes?page=${pagina || 0}&size=20`;
    if (dataInicio) url += `&dataInicio=${dataInicio}`;
    if (dataFim) url += `&dataFim=${dataFim}`;
    const r = await pdpjFetch(url, token, cleanCpf);
    if (!r.ok) {
      let errMsg = `Erro ${r.status}`;
      if (r.status === 403) errMsg = "API restrita a IPs brasileiros";
      if (r.status === 401) errMsg = "Token não autorizado";
      return res.status(r.status).json({ message: errMsg });
    }
    res.json(await r.json());
  } catch (e: any) { res.status(500).json({ message: "Erro ao consultar comunicações: " + (e.message || "desconhecido") }); }
});

router.post("/pdpj/representados", async (req, res) => {
  try {
    const { cpf, modo, tribunal, ambiente, dataInicio, dataFim } = req.body;
    const cleanCpf = (cpf || "").replace(/\D/g, "");
    if (cleanCpf.length !== 11) return res.status(400).json({ message: "CPF inválido" });
    const token = generatePdpjToken(cleanCpf, modo || "pdpj", tribunal || "TJMG", 15, ambiente || "homologacao");
    if (!token) return res.status(400).json({ message: "Chave PEM não configurada" });
    const baseUrl = ambiente === "producao" ? DOMICILIO_BASE_PROD : DOMICILIO_BASE_STG;
    let url = `${baseUrl}/api/v1/representados`;
    const params: string[] = [];
    if (dataInicio) params.push(`dataInicio=${dataInicio}`);
    if (dataFim) params.push(`dataFim=${dataFim}`);
    if (params.length) url += `?${params.join("&")}`;
    const r = await pdpjFetch(url, token, cleanCpf);
    if (!r.ok) {
      let errMsg = `Erro ${r.status}`;
      if (r.status === 403) errMsg = "API restrita a IPs brasileiros";
      if (r.status === 401) errMsg = "Token não autorizado";
      return res.status(r.status).json({ message: errMsg });
    }
    res.json(await r.json());
  } catch (e: any) { res.status(500).json({ message: "Erro ao consultar representados: " + (e.message || "desconhecido") }); }
});

router.post("/pdpj/habilitacao", async (req, res) => {
  try {
    const { cpf, modo, tribunal, ambiente, documento } = req.body;
    const cleanCpf = (cpf || "").replace(/\D/g, "");
    if (cleanCpf.length !== 11) return res.status(400).json({ message: "CPF inválido" });
    const cleanDoc = (documento || "").replace(/\D/g, "");
    if (!cleanDoc || (cleanDoc.length !== 11 && cleanDoc.length !== 14)) return res.status(400).json({ message: "Documento (CPF ou CNPJ) inválido" });
    const token = generatePdpjToken(cleanCpf, modo || "pdpj", tribunal || "TJMG", 15, ambiente || "homologacao");
    if (!token) return res.status(400).json({ message: "Chave PEM não configurada" });
    const baseUrl = ambiente === "producao" ? DOMICILIO_BASE_PROD : DOMICILIO_BASE_STG;
    const r = await pdpjFetch(`${baseUrl}/api/v1/pessoas/${cleanDoc}/verificar-habilitacao`, token, cleanCpf);
    if (!r.ok) {
      let errMsg = `Erro ${r.status}`;
      if (r.status === 403) errMsg = "API restrita a IPs brasileiros";
      if (r.status === 401) errMsg = "Token não autorizado";
      return res.status(r.status).json({ message: errMsg });
    }
    res.json(await r.json());
  } catch (e: any) { res.status(500).json({ message: "Erro ao verificar habilitação: " + (e.message || "desconhecido") }); }
});

router.post("/pdpj/pessoa", async (req, res) => {
  try {
    const { cpf, modo, tribunal, ambiente, tipoPessoa, documento } = req.body;
    const cleanCpf = (cpf || "").replace(/\D/g, "");
    if (cleanCpf.length !== 11) return res.status(400).json({ message: "CPF inválido" });
    const token = generatePdpjToken(cleanCpf, modo || "pdpj", tribunal || "TJMG", 15, ambiente || "homologacao");
    if (!token) return res.status(400).json({ message: "Chave PEM não configurada" });
    const baseUrl = ambiente === "producao" ? DOMICILIO_BASE_PROD : DOMICILIO_BASE_STG;
    const cleanDoc = (documento || "").replace(/\D/g, "");
    const url = tipoPessoa === "juridica"
      ? `${baseUrl}/api/v1/pessoas-juridicas?cnpj=${cleanDoc}`
      : `${baseUrl}/api/v1/pessoas-fisicas-pdpj?cpf=${cleanDoc}`;
    const r = await pdpjFetch(url, token, cleanCpf);
    if (!r.ok) {
      let errMsg = `Erro ${r.status}`;
      if (r.status === 403) errMsg = "API restrita a IPs brasileiros";
      if (r.status === 401) errMsg = "Token não autorizado";
      return res.status(r.status).json({ message: errMsg });
    }
    res.json(await r.json());
  } catch (e: any) { res.status(500).json({ message: "Erro ao consultar pessoa: " + (e.message || "desconhecido") }); }
});

// ── CNJ Comunicações ──────────────────────────────────────────────────────────
const COMUNICAAPI_HML = "https://hcomunicaapi.cnj.jus.br/api/v1";
const COMUNICAAPI_PROD = "https://comunicaapi.pje.jus.br/api/v1";

router.post("/cnj/comunicacoes", async (req, res) => {
  try {
    const { numeroOab, ufOab, nomeAdvogado, nomeParte, numeroProcesso, dataDisponibilizacaoInicio, dataDisponibilizacaoFim, ambiente } = req.body;
    if (!numeroOab && !nomeAdvogado && !nomeParte && !numeroProcesso) {
      return res.status(400).json({ message: "Informe pelo menos um critério: OAB, nome do advogado, nome da parte ou número do processo." });
    }
    const baseUrl = ambiente === "producao" ? COMUNICAAPI_PROD : COMUNICAAPI_HML;
    const url = new URL(`${baseUrl}/comunicacao`);
    if (numeroOab) url.searchParams.append("numeroOab", numeroOab.toString().replace(/\D/g, ""));
    if (ufOab) url.searchParams.append("ufOab", ufOab.toUpperCase());
    if (nomeAdvogado) url.searchParams.append("nomeAdvogado", nomeAdvogado);
    if (nomeParte) url.searchParams.append("nomeParte", nomeParte);
    if (numeroProcesso) url.searchParams.append("numeroProcesso", numeroProcesso.replace(/[.\-\s]/g, ""));
    if (dataDisponibilizacaoInicio) url.searchParams.append("dataDisponibilizacaoInicio", dataDisponibilizacaoInicio);
    if (dataDisponibilizacaoFim) url.searchParams.append("dataDisponibilizacaoFim", dataDisponibilizacaoFim);

    const r = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      const isGeoBlocked = errText.includes("block access from your country") || errText.includes("CloudFront");
      if (isGeoBlocked && ambiente === "producao") return res.status(403).json({ message: "A API de produção do CNJ bloqueia acesso internacional. Use homologação.", geoBlocked: true });
      return res.status(r.status).json({ message: `Erro na API CNJ (${r.status}): ${errText.substring(0, 200)}` });
    }
    const data = await r.json() as any;
    const items = (data.items || []).map((item: any) => ({
      id: item.id, dataDisponibilizacao: item.data_disponibilizacao || item.datadisponibilizacao,
      tribunal: item.siglaTribunal, tipo: item.tipoComunicacao, orgao: item.nomeOrgao,
      processo: item.numeroprocessocommascara || item.numero_processo, classe: item.nomeClasse,
      texto: item.texto, link: item.link, meio: item.meiocompleto || item.meio, status: item.status,
      hash: item.hash, numeroComunicacao: item.numeroComunicacao,
      destinatarios: (item.destinatarios || []).map((d: any) => ({ nome: d.nome, polo: d.polo === "A" ? "Ativo" : d.polo === "P" ? "Passivo" : d.polo })),
      advogados: (item.destinatarioadvogados || []).map((da: any) => ({ nome: da.advogado?.nome, oab: da.advogado?.numero_oab, uf: da.advogado?.uf_oab })),
    }));
    res.json({ status: "success", total: data.count || items.length, items, fonte: "CNJ Comunicações Processuais", ambiente: ambiente === "producao" ? "Produção" : "Homologação" });
  } catch (e: any) { res.status(500).json({ message: "Erro ao consultar comunicações no CNJ: " + (e.message || "erro desconhecido") }); }
});

// ── Code Runner ───────────────────────────────────────────────────────────────
router.post("/code/run", async (req, res) => {
  try {
    const { code, language } = req.body as { code: string; language: string };
    if (!code || !code.trim()) return res.json({ output: "", error: "", executedCode: code || "" });

    const { execFile } = await import("child_process");
    const { writeFileSync, unlinkSync, mkdtempSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    if (language === "python") {
      const tmpDir = mkdtempSync(join(tmpdir(), "pyrun-"));
      const tmpFile = join(tmpDir, "script.py");
      writeFileSync(tmpFile, code, "utf-8");
      const result = await new Promise<{ output: string; error: string }>((resolve) => {
        // 28/10: no Windows o Python se chama "python" ou "py" (não "python3") — tenta os três
        const nomes = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
        const tentar = (i: number) => execFile(nomes[i], [tmpFile], { timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8" } }, (err, stdout, stderr) => {
          if (err && (err as any).code === "ENOENT" && i + 1 < nomes.length) return tentar(i + 1);
          try { unlinkSync(tmpFile); } catch {}
          if (err && (err as any).code === "ENOENT") resolve({ output: "", error: "O Python não está instalado neste computador (python.org). Dica: sem servidor, o Playground roda o Python dentro do próprio navegador." });
          else if (err && (err as any).killed) resolve({ output: "", error: "Tempo limite excedido (30s). Verifique loops infinitos." });
          else resolve({ output: stdout || "(sem saída — use print() para ver resultados)", error: stderr || "" });
        });
        tentar(0);
      });
      return res.json({ output: result.output, error: result.error, executedCode: code });
    }

    if (language === "javascript") {
      const tmpDir = mkdtempSync(join(tmpdir(), "jsrun-"));
      const tmpFile = join(tmpDir, "script.js");
      writeFileSync(tmpFile, code, "utf-8");
      const result = await new Promise<{ output: string; error: string }>((resolve) => {
        execFile("node", [tmpFile], { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
          try { unlinkSync(tmpFile); } catch {}
          if (err && (err as any).killed) resolve({ output: "", error: "Tempo limite excedido (30s)." });
          else resolve({ output: stdout || "(sem saída — use console.log() para ver resultados)", error: stderr || "" });
        });
      });
      return res.json({ output: result.output, error: result.error, executedCode: code });
    }

    res.status(400).json({ message: "Linguagem não suportada. Use python ou javascript." });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
});

// ── Previdenciário ────────────────────────────────────────────────────────────
router.post("/previdenciario/extrair", async (req, res) => {
  try {
    const { texto, tipo } = req.body as { texto: string; tipo: "cnis" | "carta" };
    if (!texto || !tipo) return res.status(400).json({ message: "texto e tipo são obrigatórios" });

    const promptCnis = `Você é especialista em documentos previdenciários brasileiros. Analise o texto do CNIS abaixo e retorne APENAS um JSON válido, sem markdown.
Formato:
{
  "dadosSegurado": { "nit": "", "cpf": "", "nome": "", "nascimento": "", "mae": "" },
  "periodosContribuicao": [{ "dataInicial": "DD/MM/YYYY", "dataFinal": "DD/MM/YYYY", "descricao": "nome empresa", "naturezaVinculo": "EMPREGADO|CONTRIBUINTE_INDIVIDUAL|BENEFICIO_INCAPACIDADE|NAO_INFORMADO", "contarCarencia": true }],
  "salarios": [{ "competencia": "MM/YYYY", "valor": 0.00 }]
}
TEXTO DO CNIS:\n${texto.slice(0, 12000)}`;

    const promptCarta = `Você é especialista em documentos previdenciários brasileiros. Analise o texto da Carta de Concessão do INSS abaixo e retorne APENAS um JSON válido, sem markdown.
Formato:
{
  "numeroBeneficio": "", "especie": "", "codigoEspecie": "", "dib": "DD/MM/YYYY", "dip": "DD/MM/YYYY",
  "rmi": 0.00, "salarioBeneficio": 0.00, "coeficiente": "",
  "segurado": { "nome": "", "cpf": "", "nit": "" }, "tempoContribuicao": "", "dataDespacho": "DD/MM/YYYY"
}
TEXTO DA CARTA:\n${texto.slice(0, 12000)}`;

    const prompt = tipo === "cnis" ? promptCnis : promptCarta;
    const prevKey = ((await storage.getSetting("demo_api_key")) || "").trim();
    const prevUrl = ((await storage.getSetting("demo_api_url")) || "").trim();
    const prevModel = ((await storage.getSetting("demo_api_model")) || "").trim();

    let rawResponse = "{}";
    if (prevKey && prevUrl) {
      const r = await fetch(`${prevUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${prevKey}` },
        body: JSON.stringify({ model: prevModel || "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], max_tokens: 8000, temperature: 0.1 }),
      });
      if (!r.ok) throw new Error(`Erro API: ${r.status}`);
      const prevJson = await r.json() as any;
      rawResponse = prevJson.choices?.[0]?.message?.content || "{}";
    } else if (prevKey && prevKey.startsWith("AIza")) {
      const { GoogleGenAI } = await import("@google/genai");
      const client = new GoogleGenAI({ apiKey: prevKey });
      const response = await client.models.generateContent({ model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: prompt }] }], config: { temperature: 0.1 } });
      rawResponse = response.text || "{}";
    } else {
      return res.status(400).json({ message: "Nenhuma chave de API configurada. Configure nas Configurações." });
    }

    const raw = rawResponse.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const data = JSON.parse(raw);
    res.json({ data, tipo });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
});

// ── Pesquisa OAB/Processo ─────────────────────────────────────────────────────
router.get("/pesquisa/oab", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const uf = String(req.query.uf || "").trim().toUpperCase();
    if (!q) return res.status(400).json({ message: "Parâmetro 'q' obrigatório" });
    const cleanNum = q.replace(/\D/g, "");
    const url = uf
      ? `${CORPORATIVO_BASE}/advogado/oab/${uf}/${cleanNum}`
      : `https://cna.oab.org.br/api/advogado/porNome/${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return res.json({ found: false, data: [], message: `API retornou ${r.status}` });
    const data = await r.json();
    res.json({ found: true, data: Array.isArray(data) ? data : [data] });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

router.get("/pesquisa/processo", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const tribunal = String(req.query.tribunal || "").trim().toUpperCase();
    if (!q) return res.status(400).json({ message: "Parâmetro 'q' obrigatório" });
    const cleanNum = q.replace(/[.\-\s]/g, "");
    let selectedTribunal = tribunal;
    if (!selectedTribunal || !TRIBUNAL_ALIASES[selectedTribunal]) {
      const detected = detectTribunalFromNumber(cleanNum);
      if (detected) selectedTribunal = detected;
      else return res.status(400).json({ message: "Tribunal não identificado. Informe o parâmetro 'tribunal'." });
    }
    const alias = TRIBUNAL_ALIASES[selectedTribunal];
    const r = await fetch(`https://api-publica.datajud.cnj.jus.br/${alias}/_search`, {
      method: "POST",
      headers: { Authorization: `APIKey ${DATAJUD_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { match: { numeroProcesso: cleanNum } }, size: 5 }),
    });
    if (!r.ok) return res.json({ found: false, data: [], message: `DataJud retornou ${r.status}` });
    const data = await r.json() as any;
    const hits = data?.hits?.hits || [];
    if (hits.length === 0) return res.json({ found: false, data: [], message: "Processo não encontrado" });
    res.json({ found: true, tribunal: selectedTribunal, data: hits.map((h: any) => h._source) });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

// ── DJEN (Robot DJe) ─────────────────────────────────────────────────────────
router.get("/djen/config", async (_req, res) => {
  try {
    const token = (await storage.getSetting("djen_token") || "").trim();
    const email = (await storage.getSetting("djen_email") || "").trim();
    res.json({ configured: !!token, hasEmail: !!email, masked: token ? token.substring(0, 8) + "..." : "" });
  } catch { res.json({ configured: false, hasEmail: false, masked: "" }); }
});

router.post("/djen/gerar-token", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email e senha são obrigatórios" });
    // DJEN login attempt via their API
    const r = await fetch("https://api.dje.tjmg.jus.br/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) return res.status(400).json({ message: `Erro de login DJEN (${r.status}). Verifique suas credenciais.` });
    const data = await r.json() as any;
    const token = data.token || data.access_token || "";
    if (token) {
      await storage.setSetting("djen_token", token);
      await storage.setSetting("djen_email", email);
    }
    res.json({ success: !!token, token: token ? token.substring(0, 8) + "..." : "" });
  } catch (e: any) {
    res.status(500).json({ message: "Erro ao gerar token DJEN: " + (e.message || "erro desconhecido") });
  }
});

// ── Export Word ───────────────────────────────────────────────────────────────
function parseInlineRuns(line: string, defaultBold = false): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /\*\*(.+?)\*\*|__(.+?)__|_(.+?)_|\*(.+?)\*/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: line.slice(lastIndex, match.index), size: 24, font: "Times New Roman", bold: defaultBold }));
    }
    const boldText = match[1] || match[2];
    const italicText = match[3] || match[4];
    if (boldText) runs.push(new TextRun({ text: boldText, bold: true, size: 24, font: "Times New Roman" }));
    else if (italicText) runs.push(new TextRun({ text: italicText, italics: true, size: 24, font: "Times New Roman", bold: defaultBold }));
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < line.length) runs.push(new TextRun({ text: line.slice(lastIndex), size: 24, font: "Times New Roman", bold: defaultBold }));
  if (runs.length === 0) runs.push(new TextRun({ text: line, size: 24, font: "Times New Roman", bold: defaultBold }));
  return runs;
}

router.post("/export/word", async (req, res) => {
  try {
    const { text, title } = req.body;
    if (!text) return res.status(400).json({ message: "Texto é obrigatório" });

    const paragraphs = text.split(/\n\n+/).filter((p: string) => p.trim());
    const docChildren: Paragraph[] = [];

    if (title) {
      docChildren.push(new Paragraph({
        children: [new TextRun({ text: title, bold: true, size: 28, font: "Times New Roman" })],
        alignment: AlignmentType.CENTER, spacing: { after: 400 },
      }));
    }

    for (const para of paragraphs) {
      const lines = para.split("\n");
      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        const isAllCaps = trimmed === trimmed.toUpperCase() && trimmed.length < 120 && trimmed.length > 3 && !/^\d/.test(trimmed) && !trimmed.includes("http");
        if (isAllCaps) {
          docChildren.push(new Paragraph({ children: [new TextRun({ text: trimmed.replace(/\*\*/g, ""), bold: true, size: 24, font: "Times New Roman" })], spacing: { before: 360, after: 200 }, alignment: AlignmentType.JUSTIFIED }));
          continue;
        }

        const bulletMatch = trimmed.match(/^[-*+]\s+(.+)$/);
        if (bulletMatch) {
          docChildren.push(new Paragraph({ children: parseInlineRuns(bulletMatch[1]), spacing: { after: 80 }, indent: { left: 720, hanging: 360 }, bullet: { level: 0 } }));
          continue;
        }

        docChildren.push(new Paragraph({ children: parseInlineRuns(trimmed), spacing: { after: 200, line: 360 }, alignment: AlignmentType.JUSTIFIED, indent: { firstLine: 2268 } }));
      }
      docChildren.push(new Paragraph({ children: [], spacing: { after: 120 } }));
    }

    const doc = new Document({
      sections: [{ properties: { page: { margin: { top: 1701, right: 1134, bottom: 1134, left: 1701 } } }, children: docChildren }],
    });
    const buffer = await Packer.toBuffer(doc);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${(title || "documento").replace(/[^a-zA-Z0-9\s-]/g, "")}.docx"`);
    res.send(buffer);
  } catch (e: any) { res.status(500).json({ message: "Erro ao exportar Word: " + e.message }); }
});

/** Converte HTML do TipTap em parágrafos DOCX com formatação ABNT */
function htmlToDocxParagraphs(html: string): Paragraph[] {
  const { JSDOM } = (() => {
    try { return require("jsdom"); } catch { return { JSDOM: null }; }
  })();

  const paragraphs: Paragraph[] = [];

  // Pré-processa HTML para extrair parágrafos estruturados
  const rawText = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#[0-9]+;/g, " ")
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n");

  const lines = rawText.split("\n");

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      paragraphs.push(new Paragraph({ children: [], spacing: { after: 120 } }));
      continue;
    }

    // Detecta títulos (caixa alta, curtos, sem números no início)
    const isTituloAbnt = trimmed === trimmed.toUpperCase()
      && trimmed.length > 3
      && trimmed.length < 150
      && !/^\d/.test(trimmed)
      && !trimmed.includes("http")
      && /[A-ZÁÉÍÓÚÃÕÂÊÔÇ]/.test(trimmed);

    // Detecta endereçamento (EXMO., EXCELENTÍSSIMO)
    const isEndereco = /^(EXMO|EXCELENTÍSSIMO|MERITÍSSIMO|ILUSTRÍSSIMO|SENHOR|SENHORA)\b/i.test(trimmed);

    // Detecta data/local (linha que começa com cidade ou data)
    const isDataLocal = /^\w+[\w\s]+,\s+\d{1,2}\s+de\s+\w+\s+de\s+\d{4}/i.test(trimmed)
      || /^\d{1,2}\/\d{1,2}\/\d{4}/.test(trimmed);

    // Detecta "Nestes termos" / "Pede deferimento"
    const isFecho = /^(nestes termos|pede deferimento|respeitosamente|atenciosamente|e.r.d.|termos em que)/i.test(trimmed);

    // Detecta citação longa (recuo especial)
    const isCitacao = /^[""]/.test(trimmed) || trimmed.length < 100 && trimmed.startsWith("EMENTA:");

    if (isTituloAbnt || isEndereco) {
      paragraphs.push(new Paragraph({
        children: parseInlineRuns(trimmed, true),
        alignment: AlignmentType.JUSTIFIED,
        spacing: { before: 280, after: 140, line: 360 },
        indent: { firstLine: 0 },
      }));
    } else if (isDataLocal) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: trimmed, size: 24, font: "Times New Roman" })],
        alignment: AlignmentType.RIGHT,
        spacing: { before: 360, after: 360, line: 360 },
        indent: { firstLine: 0 },
      }));
    } else if (isFecho) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: trimmed, size: 24, font: "Times New Roman" })],
        alignment: AlignmentType.JUSTIFIED,
        spacing: { before: 280, after: 140, line: 360 },
        indent: { firstLine: 0 },
      }));
    } else if (isCitacao) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: trimmed, size: 20, font: "Times New Roman", italics: true })],
        alignment: AlignmentType.JUSTIFIED,
        spacing: { before: 120, after: 120, line: 240 },
        indent: { left: 2268, firstLine: 0 },
      }));
    } else {
      // Parágrafo normal ABNT: justificado, recuo 4cm (2268 twips)
      paragraphs.push(new Paragraph({
        children: parseInlineRuns(trimmed),
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 0, line: 360 },
        indent: { firstLine: 2268 },
      }));
    }
  }

  return paragraphs;
}

/**
 * Substitui variáveis dinâmicas num template ou texto.
 * Suporta: {{NOME_PARTE}}, {{NOME_ADVOGADO}}, {{OAB}}, {{CPF}}, {{CNPJ}},
 *   {{NUMERO_PROCESSO}}, {{TRIBUNAL}}, {{VARA}}, {{CIDADE}}, {{ESTADO}},
 *   {{DATA_HOJE}}, {{DATA_EXTENSO}}, {{ANO}}, {{MES}}, {{VALOR_CAUSA}},
 *   {{CLASSE}}, {{ASSUNTO}}, {{EXEQUENTE}}, {{EXECUTADO}},
 *   {{AUTOR}}, {{REU}}, {{REQUERENTE}}, {{REQUERIDO}},
 *   {{NOME_ESCRITORIO}}, {{CNPJ_ESCRITORIO}}, {{OAB_ESCRITORIO}},
 * além de qualquer variável custom passada em `vars`.
 */
function substituiVariaveis(texto: string, vars: Record<string, string> = {}): string {
  if (!texto) return texto;
  const hoje = new Date();
  const meses = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const pad = (n: number) => String(n).padStart(2, "0");
  const dataHoje = `${pad(hoje.getDate())}/${pad(hoje.getMonth() + 1)}/${hoje.getFullYear()}`;
  const dataExtenso = `${hoje.getDate()} de ${meses[hoje.getMonth()]} de ${hoje.getFullYear()}`;

  const defaults: Record<string, string> = {
    DATA_HOJE: dataHoje,
    DATA_EXTENSO: dataExtenso,
    ANO: String(hoje.getFullYear()),
    MES: meses[hoje.getMonth()],
    MES_NUM: pad(hoje.getMonth() + 1),
    DIA: pad(hoje.getDate()),
  };

  // Merge: vars do request têm prioridade, defaults preenchem o restante
  const allVars = { ...defaults, ...vars };

  return texto.replace(/\{\{([A-Z_][A-Z0-9_]*)\}\}/g, (_match, key) => {
    return allVars[key] ?? _match; // mantém {{VAR}} se não encontrado
  });
}

/** POST /api/template/vars/preview — pré-visualiza com substituição */
router.post("/template/vars/preview", (req, res) => {
  const { texto, vars } = req.body;
  if (!texto) return res.status(400).json({ message: "texto obrigatório" });
  const resultado = substituiVariaveis(texto, vars || {});
  const variaveisEncontradas = [...texto.matchAll(/\{\{([A-Z_][A-Z0-9_]*)\}\}/g)].map(m => m[1]);
  const variaveisSubstituidas = variaveisEncontradas.filter(v => (vars || {})[v] || ["DATA_HOJE","DATA_EXTENSO","ANO","MES","MES_NUM","DIA"].includes(v));
  const variaveisPendentes = variaveisEncontradas.filter(v => !variaveisSubstituidas.includes(v));
  res.json({ resultado, variaveisEncontradas: [...new Set(variaveisEncontradas)], variaveisSubstituidas, variaveisPendentes });
});

/** GET /api/template/vars/lista — lista todas as variáveis disponíveis */
router.get("/template/vars/lista", (_req, res) => {
  res.json([
    { variavel: "{{NOME_PARTE}}", label: "Nome da Parte", categoria: "Partes" },
    { variavel: "{{NOME_ADVOGADO}}", label: "Nome do Advogado", categoria: "Advogado" },
    { variavel: "{{OAB}}", label: "OAB do Advogado", categoria: "Advogado" },
    { variavel: "{{CPF}}", label: "CPF da Parte", categoria: "Partes" },
    { variavel: "{{CNPJ}}", label: "CNPJ da Parte/Empresa", categoria: "Partes" },
    { variavel: "{{NUMERO_PROCESSO}}", label: "Número CNJ do Processo", categoria: "Processo" },
    { variavel: "{{TRIBUNAL}}", label: "Tribunal", categoria: "Processo" },
    { variavel: "{{VARA}}", label: "Vara/Câmara", categoria: "Processo" },
    { variavel: "{{CLASSE}}", label: "Classe Processual", categoria: "Processo" },
    { variavel: "{{ASSUNTO}}", label: "Assunto do Processo", categoria: "Processo" },
    { variavel: "{{AUTOR}}", label: "Autor", categoria: "Partes" },
    { variavel: "{{REU}}", label: "Réu", categoria: "Partes" },
    { variavel: "{{REQUERENTE}}", label: "Requerente", categoria: "Partes" },
    { variavel: "{{REQUERIDO}}", label: "Requerido", categoria: "Partes" },
    { variavel: "{{EXEQUENTE}}", label: "Exequente", categoria: "Partes" },
    { variavel: "{{EXECUTADO}}", label: "Executado", categoria: "Partes" },
    { variavel: "{{CIDADE}}", label: "Cidade", categoria: "Localização" },
    { variavel: "{{ESTADO}}", label: "Estado (UF)", categoria: "Localização" },
    { variavel: "{{VALOR_CAUSA}}", label: "Valor da Causa", categoria: "Financeiro" },
    { variavel: "{{DATA_HOJE}}", label: "Data de Hoje (DD/MM/AAAA)", categoria: "Data" },
    { variavel: "{{DATA_EXTENSO}}", label: "Data por Extenso", categoria: "Data" },
    { variavel: "{{ANO}}", label: "Ano Atual", categoria: "Data" },
    { variavel: "{{MES}}", label: "Mês Atual por Extenso", categoria: "Data" },
    { variavel: "{{NOME_ESCRITORIO}}", label: "Nome do Escritório", categoria: "Escritório" },
    { variavel: "{{CNPJ_ESCRITORIO}}", label: "CNPJ do Escritório", categoria: "Escritório" },
    { variavel: "{{OAB_ESCRITORIO}}", label: "OAB do Escritório", categoria: "Escritório" },
  ]);
});

router.post("/export/word-with-template", async (req, res) => {
  try {
    const { text, title, html, templateId, filename, vars } = req.body;
    if (!text && !html) return res.status(400).json({ message: "Texto é obrigatório" });

    const { HeadingLevel } = await import("docx");
    const docChildren: Paragraph[] = [];

    // ── Cabeçalho do template (se selecionado) ────────────────────────────────
    if (templateId) {
      try {
        const template = await storage.getDocTemplate(parseInt(templateId));
        if (template?.conteudo) {
          // Substitui variáveis no template header
          const templateComVars = substituiVariaveis(template.conteudo, vars || {});
          const headerText = templateComVars
            .replace(/\{\{CONTEUDO\}\}/gi, "")
            .replace(/\{\{.*?\}\}/gi, "")
            .trim();

          if (headerText) {
            const headerLines = headerText.split("\n").filter((l: string) => l.trim());
            for (const line of headerLines.slice(0, 20)) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              const isUpper = trimmed === trimmed.toUpperCase() && trimmed.length > 3;
              docChildren.push(new Paragraph({
                children: [new TextRun({ text: trimmed, bold: isUpper, size: 24, font: "Times New Roman" })],
                alignment: isUpper ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
                spacing: { after: 120, line: 360 },
                indent: { firstLine: 0 },
              }));
            }
            // Separador visual
            docChildren.push(new Paragraph({ children: [], spacing: { after: 360 } }));
          }
        }
      } catch {}
    }

    // ── Título do documento ───────────────────────────────────────────────────
    if (title) {
      docChildren.push(new Paragraph({
        children: [new TextRun({ text: title.toUpperCase(), bold: true, size: 26, font: "Times New Roman" })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400, line: 360 },
        indent: { firstLine: 0 },
      }));
    }

    // ── Conteúdo principal ────────────────────────────────────────────────────
    const inputHtml = html || (text ? text.replace(/\n/g, "<br>") : "");
    const contentParagraphs = htmlToDocxParagraphs(inputHtml);
    docChildren.push(...contentParagraphs);

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: "Times New Roman", size: 24 },
            paragraph: { spacing: { line: 360 }, alignment: AlignmentType.JUSTIFIED },
          },
        },
      },
      sections: [{
        properties: {
          page: {
            margin: {
              top: 1701,    // 3cm
              right: 1134,  // 2cm
              bottom: 1134, // 2cm
              left: 1701,   // 3cm
            },
          },
        },
        children: docChildren,
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const safeName = (filename || title || "documento").replace(/[^a-zA-Z0-9\s\-_çãõáéíóúàêôü]/gi, "").trim() || "documento";
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.docx"`);
    res.send(buffer);
  } catch (e: any) { res.status(500).json({ message: "Erro ao exportar Word: " + e.message }); }
});

// ── Doc Templates Upload DOCX ─────────────────────────────────────────────────
router.post("/doc-templates/upload-docx", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ message: "Nenhum arquivo enviado" });

    const titulo = req.body.titulo || file.originalname.replace(/\.docx$/i, "");
    const categoria = req.body.categoria || "Geral";
    const docxBase64 = file.buffer.toString("base64");

    let conteudo = "{{CONTEUDO}}";
    try {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      const preview = result.value.substring(0, 300);
      conteudo = preview + (result.value.length > 300 ? "..." : "") + "\n\n{{CONTEUDO}}";
    } catch {}

    const parsed = insertDocTemplateSchema.safeParse({ titulo, categoria, conteudo, docxBase64, docxFilename: file.originalname });
    if (!parsed.success) return res.status(400).json({ message: "Dados inválidos" });
    const template = await storage.createDocTemplate(parsed.data);
    res.status(201).json(template);
  } catch (e: any) {
    res.status(500).json({ message: "Erro ao importar template Word: " + e.message });
  }
});

// ── Tramitação Inteligente Proxy ──────────────────────────────────────────────
const TRAMITACAO_BASE = "https://planilha.tramitacaointeligente.com.br/api/v1";

async function tramFetch(path: string, method: string, token: string, body?: any) {
  return fetch(`${TRAMITACAO_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

router.get("/tramitacao/test", async (_req, res) => {
  try {
    const token = await storage.getSetting("tramitacao_token");
    if (!token) return res.json({ ok: false, message: "Token não configurado. Acesse Configurações e insira seu token." });
    if (/^\d+$/.test(token.trim())) return res.json({ ok: false, message: `O valor "${token}" parece ser um ID, não um token de API. Acesse planilha.tramitacaointeligente.com.br/api/chaves.` });
    const upstream = await tramFetch("/clientes?per_page=1", "GET", token);
    if (upstream.ok) return res.json({ ok: true, message: "Conexão OK! Token válido." });
    else if (upstream.status === 401) return res.json({ ok: false, message: "Token inválido ou expirado (401). Verifique em planilha.tramitacaointeligente.com.br/api/chaves." });
    else return res.json({ ok: false, message: `API retornou ${upstream.status}` });
  } catch (e: any) { res.json({ ok: false, message: e.message }); }
});

router.get("/tramitacao/clientes", async (req, res) => {
  try {
    const token = await storage.getSetting("tramitacao_token");
    if (!token) return res.status(400).json({ message: "Token do Tramitação Inteligente não configurado." });
    const qs = new URLSearchParams();
    if (req.query.page) qs.set("page", String(req.query.page));
    if (req.query.per_page) qs.set("per_page", String(req.query.per_page));
    const upstream = await tramFetch(`/clientes?${qs}`, "GET", token);
    res.status(upstream.status).json(await upstream.json());
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

router.post("/tramitacao/clientes", async (req, res) => {
  try {
    const token = await storage.getSetting("tramitacao_token");
    if (!token) return res.status(400).json({ message: "Token não configurado." });
    const upstream = await tramFetch("/clientes", "POST", token, req.body);
    res.status(upstream.status).json(await upstream.json());
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

router.get("/tramitacao/clientes/:id", async (req, res) => {
  try {
    const token = await storage.getSetting("tramitacao_token");
    if (!token) return res.status(400).json({ message: "Token não configurado." });
    const upstream = await tramFetch(`/clientes/${req.params.id}`, "GET", token);
    res.status(upstream.status).json(await upstream.json());
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

router.patch("/tramitacao/clientes/:id", async (req, res) => {
  try {
    const token = await storage.getSetting("tramitacao_token");
    if (!token) return res.status(400).json({ message: "Token não configurado." });
    const upstream = await tramFetch(`/clientes/${req.params.id}`, "PATCH", token, req.body);
    res.status(upstream.status).json(await upstream.json());
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

router.get("/tramitacao/usuarios", async (_req, res) => {
  try {
    const token = await storage.getSetting("tramitacao_token");
    if (!token) return res.status(400).json({ message: "Token não configurado." });
    const upstream = await tramFetch("/usuarios?per_page=100", "GET", token);
    res.status(upstream.status).json(await upstream.json());
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

router.get("/tramitacao/notas", async (req, res) => {
  try {
    const token = await storage.getSetting("tramitacao_token");
    if (!token) return res.status(400).json({ message: "Token não configurado." });
    const qs = new URLSearchParams();
    if (req.query.customer_id) qs.set("customer_id", String(req.query.customer_id));
    if (req.query.page) qs.set("page", String(req.query.page));
    if (req.query.per_page) qs.set("per_page", String(req.query.per_page));
    const upstream = await tramFetch(`/notas?${qs}`, "GET", token);
    res.status(upstream.status).json(await upstream.json());
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

router.post("/tramitacao/notas", async (req, res) => {
  try {
    const token = await storage.getSetting("tramitacao_token");
    if (!token) return res.status(400).json({ message: "Token não configurado." });
    const upstream = await tramFetch("/notas", "POST", token, req.body);
    res.status(upstream.status).json(await upstream.json());
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

router.delete("/tramitacao/notas/:id", async (req, res) => {
  try {
    const token = await storage.getSetting("tramitacao_token");
    if (!token) return res.status(400).json({ message: "Token não configurado." });
    const upstream = await tramFetch(`/notas/${req.params.id}`, "DELETE", token);
    res.status(upstream.status).json({ ok: upstream.status === 204 });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

// ── Download pacote v1.7.0 (MANUAL + configs) ─────────────────────────────────
router.get("/export/download-package", async (_req, res) => {
  try {
    const AdmZip = (await import("adm-zip" as any)).default;
    const zip = new AdmZip();

    // Inclui MANUAL.md
    const manualPath = new URL("../../../../../MANUAL.md", import.meta.url).pathname;
    try {
      const fs = await import("fs");
      const manual = fs.readFileSync(manualPath);
      zip.addFile("MANUAL.md", manual);
    } catch {}

    // Inclui capacitor.config.ts
    const capPath = new URL("../../../../../capacitor.config.ts", import.meta.url).pathname;
    try {
      const fs = await import("fs");
      const cap = fs.readFileSync(capPath);
      zip.addFile("capacitor.config.ts", cap);
    } catch {}

    // Instrução de deploy
    const deployMd = Buffer.from(`# Deploy — SK Jurídico IA v1.7.0

## Servidor próprio (VPS/Linux)
\`\`\`bash
git clone https://github.com/seu-usuario/sk-juridico.git
cd sk-juridico
cp .env.example .env
# Edite .env com DATABASE_URL e SESSION_SECRET
pnpm install
pnpm --filter @workspace/db run push
BASE_PATH=/api PORT=8080 pnpm --filter @workspace/api-server run build
# Inicia os dois serviços (use PM2 ou systemd)
PORT=8080 BASE_PATH=/api node artifacts/api-server/dist/index.mjs &
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/assistente-juridico run dev
\`\`\`

## APK Android (Capacitor)
\`\`\`bash
export SERVER_URL=https://seu-dominio.com.br
npx cap sync android
npx cap open android
# Android Studio → Build → Generate Signed APK
\`\`\`

## Desktop (Electron)
\`\`\`bash
cd artifacts/desktop
npm install
npm run start   # desenvolvimento
npm run build:win  # ou build:mac / build:linux
\`\`\`

## Docker
\`\`\`dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install -g pnpm && pnpm install && pnpm run build
ENV PORT=8080 BASE_PATH=/api NODE_ENV=production
CMD ["node", "artifacts/api-server/dist/index.mjs"]
\`\`\`
`, "utf-8");
    zip.addFile("DEPLOY.md", deployMd);

    const buffer = zip.toBuffer();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="sk-juridico-v1.7.0-package.zip"`);
    res.send(buffer);
  } catch (e: any) { res.status(500).json({ message: "Erro ao gerar pacote: " + e.message }); }
});

// ── Settings generic (:key) ───────────────────────────────────────────────────
router.get("/settings/:key", async (req, res) => {
  try {
    const value = await storage.getSetting(req.params.key);
    res.json({ value });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

router.put("/settings/:key", async (req, res) => {
  try {
    const { value } = req.body;
    if (typeof value !== "string") return res.status(400).json({ message: "value required" });
    await storage.setSetting(req.params.key, value);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

export default router;
