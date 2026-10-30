/**
 * Integrações com sistemas jurídicos externos:
 * e-SAJ, PROJUDI, SEEU, Eproc, PJud, PDPJ, CNJ Unificado
 *
 * Cada sistema requer credenciais configuradas pelo usuário.
 * As credenciais são armazenadas via storage.setSetting() — nunca em env vars.
 */
import { Router } from "express";
import { storage } from "../storage.js";
import { getLocalConfig, setLocalConfig } from "../local-config.js";

const router = Router();

// ── Status de todas as integrações ───────────────────────────────────────────
router.get("/integracoes/status", async (_req, res) => {
  try {
    const [esajLogin, projudiLogin, seeuLogin, eprocLogin, pjudLogin] = await Promise.all([
      storage.getSetting("esaj_login"),
      storage.getSetting("projudi_login"),
      storage.getSetting("seeu_login"),
      storage.getSetting("eproc_login"),
      storage.getSetting("pjud_login"),
    ]);

    const integracoes = [
      {
        id: "esaj",
        nome: "e-SAJ (TJSP/TJBA/TJSC/TJCE)",
        descricao: "Sistema de automação da Justiça Estadual (TJ-SP, TJ-BA, TJ-SC, TJ-CE)",
        configurado: !!esajLogin,
        url: "https://esaj.tjsp.jus.br",
        manual: "https://esaj.tjsp.jus.br/esaj/portal.do",
        campos: [
          { key: "esaj_login", label: "CPF/Login", tipo: "text", mascara: "CPF" },
          { key: "esaj_password", label: "Senha", tipo: "password" },
          { key: "esaj_tribunal", label: "Tribunal (ex: tjsp, tjba)", tipo: "text" },
        ],
      },
      {
        id: "projudi",
        nome: "PROJUDI (TJ-GO, TJ-PR, TJ-AM e outros)",
        descricao: "Processo Judicial Digital — tribunais estaduais que usam o PROJUDI",
        configurado: !!projudiLogin,
        url: "https://projudi.tjgo.jus.br",
        manual: "https://projudi.tjgo.jus.br/helpOnLine",
        campos: [
          { key: "projudi_login", label: "CPF/Login OAB", tipo: "text" },
          { key: "projudi_password", label: "Senha", tipo: "password" },
          { key: "projudi_tribunal", label: "Tribunal (ex: tjgo, tjpr)", tipo: "text" },
        ],
      },
      {
        id: "seeu",
        nome: "SEEU (Execução Penal Unificada)",
        descricao: "Sistema Eletrônico de Execução Unificada — Departamento Penitenciário Nacional",
        configurado: !!seeuLogin,
        url: "https://seeu.mj.gov.br",
        manual: "https://seeu.mj.gov.br/ajuda",
        campos: [
          { key: "seeu_login", label: "CPF do Advogado", tipo: "text" },
          { key: "seeu_password", label: "Senha SEEU", tipo: "password" },
        ],
      },
      {
        id: "eproc",
        nome: "eProc (TRFs e Tribunais Federais)",
        descricao: "Sistema do TRF4, TRF5 e outros tribunais federais",
        configurado: !!eprocLogin,
        url: "https://eproc.trf4.jus.br",
        manual: "https://eproc.trf4.jus.br/eproc/help",
        campos: [
          { key: "eproc_login", label: "CPF/Login", tipo: "text" },
          { key: "eproc_password", label: "Senha", tipo: "password" },
          { key: "eproc_tribunal", label: "Tribunal (ex: trf4, trf5)", tipo: "text" },
        ],
      },
      {
        id: "pjud",
        nome: "PJud (STJ — Processo Judicial Eletrônico)",
        descricao: "Sistema do Superior Tribunal de Justiça",
        configurado: !!pjudLogin,
        url: "https://processo.stj.jus.br",
        manual: "https://processo.stj.jus.br/processo/pesquisa",
        campos: [
          { key: "pjud_login", label: "CPF/Número OAB", tipo: "text" },
          { key: "pjud_password", label: "Senha", tipo: "password" },
        ],
      },
    ];

    res.json({ integracoes });
  } catch (e: any) {
    res.status(500).json({ message: "Erro ao buscar status das integrações" });
  }
});

// ── Salvar credenciais de uma integração ──────────────────────────────────────
router.post("/integracoes/credenciais", async (req, res) => {
  try {
    const { sistema, campos } = req.body as {
      sistema: string;
      campos: Record<string, string>;
    };

    if (!sistema || !campos) {
      return res.status(400).json({ message: "sistema e campos são obrigatórios" });
    }

    const sistemasValidos = ["esaj", "projudi", "seeu", "eproc", "pjud"];
    if (!sistemasValidos.includes(sistema)) {
      return res.status(400).json({ message: `Sistema inválido: ${sistema}` });
    }

    for (const [key, value] of Object.entries(campos)) {
      if (typeof value === "string" && key.startsWith(sistema)) {
        await storage.setSetting(key, value);
      }
    }

    res.json({ ok: true, message: `Credenciais do ${sistema.toUpperCase()} salvas com sucesso` });
  } catch (e: any) {
    res.status(500).json({ message: "Erro ao salvar credenciais" });
  }
});

// ── Limpar credenciais de uma integração ──────────────────────────────────────
router.delete("/integracoes/credenciais/:sistema", async (req, res) => {
  try {
    const { sistema } = req.params;
    const prefixKeys: Record<string, string[]> = {
      esaj: ["esaj_login", "esaj_password", "esaj_tribunal", "esaj_token"],
      projudi: ["projudi_login", "projudi_password", "projudi_tribunal", "projudi_token"],
      seeu: ["seeu_login", "seeu_password", "seeu_token"],
      eproc: ["eproc_login", "eproc_password", "eproc_tribunal", "eproc_token"],
      pjud: ["pjud_login", "pjud_password", "pjud_token"],
    };

    const keys = prefixKeys[sistema];
    if (!keys) return res.status(400).json({ message: "Sistema inválido" });

    for (const key of keys) {
      await storage.setSetting(key, "");
    }

    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ message: "Erro ao limpar credenciais" });
  }
});

// ── e-SAJ: consulta de processo ───────────────────────────────────────────────
router.post("/integracoes/esaj/consulta", async (req, res) => {
  try {
    const { numeroProcesso, tribunal = "tjsp" } = req.body as { numeroProcesso: string; tribunal?: string };
    if (!numeroProcesso) return res.status(400).json({ message: "Número do processo obrigatório" });

    // Limpa número para formato sem pontuação
    const clean = numeroProcesso.replace(/[.\-\s]/g, "");

    // e-SAJ fornece consulta pública sem autenticação para andamentos
    const tribunalUrls: Record<string, string> = {
      tjsp: "https://esaj.tjsp.jus.br/cgi/show.do?processo.codigo=",
      tjba: "https://esaj.tjba.jus.br/cgi/show.do?processo.codigo=",
      tjsc: "https://esaj.tjsc.jus.br/cgi/show.do?processo.codigo=",
      tjce: "https://esaj.tjce.jus.br/cgi/show.do?processo.codigo=",
    };

    const baseUrl = tribunalUrls[tribunal.toLowerCase()] || tribunalUrls.tjsp;

    res.json({
      ok: true,
      url: `${baseUrl}${clean}`,
      numeroProcesso: clean,
      tribunal: tribunal.toUpperCase(),
      message: "Abra a URL para consultar o processo no e-SAJ",
      consultaPublica: `https://esaj.${tribunal.toLowerCase()}.jus.br/cpopg/search.do?numeroDigitoAnoUnificado=${clean.slice(0, 7)}-${clean.slice(7, 9)}.${clean.slice(9, 13)}&foroNumeroUnificado=${clean.slice(16)}&dadosConsulta.localPesquisa.cdLocal=-1&dadosConsulta.tipoNuProcesso=UNIFICADO`,
    });
  } catch (e: any) {
    res.status(500).json({ message: "Erro ao consultar e-SAJ" });
  }
});

// ── PROJUDI: link de consulta ─────────────────────────────────────────────────
router.post("/integracoes/projudi/consulta", async (req, res) => {
  try {
    const { numeroProcesso, tribunal = "tjgo" } = req.body as { numeroProcesso: string; tribunal?: string };
    if (!numeroProcesso) return res.status(400).json({ message: "Número do processo obrigatório" });

    const tribunalUrls: Record<string, string> = {
      tjgo: "https://projudi.tjgo.jus.br/BuscaProcesso",
      tjpr: "https://projudi.tjpr.jus.br/projudi",
      tjam: "https://projudi.tjam.jus.br/projudi",
    };

    const url = tribunalUrls[tribunal.toLowerCase()] || tribunalUrls.tjgo;
    res.json({
      ok: true,
      url,
      numeroProcesso,
      tribunal: tribunal.toUpperCase(),
      message: "Acesse o PROJUDI e pesquise o processo",
    });
  } catch (e: any) {
    res.status(500).json({ message: "Erro ao consultar PROJUDI" });
  }
});

// ── eProc: link de consulta ───────────────────────────────────────────────────
router.post("/integracoes/eproc/consulta", async (req, res) => {
  try {
    const { numeroProcesso, tribunal = "trf4" } = req.body as { numeroProcesso: string; tribunal?: string };
    if (!numeroProcesso) return res.status(400).json({ message: "Número do processo obrigatório" });

    const tribunalUrls: Record<string, string> = {
      trf4: "https://eproc.trf4.jus.br/eproc",
      trf5: "https://eproc.trf5.jus.br/eproc",
    };

    const url = tribunalUrls[tribunal.toLowerCase()] || tribunalUrls.trf4;
    res.json({
      ok: true,
      url: `${url}/externo_controlador.php?acao=processo_consultar&num_processo=${encodeURIComponent(numeroProcesso)}`,
      numeroProcesso,
      tribunal: tribunal.toUpperCase(),
    });
  } catch (e: any) {
    res.status(500).json({ message: "Erro ao consultar eProc" });
  }
});

// ── PJud STJ: consulta pública ────────────────────────────────────────────────
router.post("/integracoes/pjud/consulta", async (req, res) => {
  try {
    const { numeroProcesso } = req.body as { numeroProcesso: string };
    if (!numeroProcesso) return res.status(400).json({ message: "Número do processo obrigatório" });

    const clean = numeroProcesso.replace(/[.\-\s]/g, "");
    res.json({
      ok: true,
      url: `https://processo.stj.jus.br/processo/pesquisa/?tipoPesquisa=tipoPesquisaNumeroRegistro&termo=${encodeURIComponent(numeroProcesso)}`,
      numeroProcesso: clean,
      tribunal: "STJ",
    });
  } catch (e: any) {
    res.status(500).json({ message: "Erro ao consultar PJud" });
  }
});

// ── Auto-detect chave por prefixo ─────────────────────────────────────────────
router.post("/settings/key-detect", async (req, res) => {
  try {
    const { key } = req.body as { key: string };
    if (!key || typeof key !== "string") {
      return res.status(400).json({ detected: false, message: "Chave inválida" });
    }

    const { detectKeyProvider } = await import("../local-config.js");
    const detected = detectKeyProvider(key.trim());

    if (!detected) {
      return res.json({
        detected: false,
        message: "Prefixo não reconhecido. Configure manualmente o campo correto.",
        sugestao: "Verifique se copiou a chave completa com seu prefixo (sk-, AIza..., gsk_, pplx-, etc.)",
      });
    }

    res.json({
      detected: true,
      field: detected.field,
      label: detected.label,
      baseUrl: detected.baseUrl || null,
      message: `Chave reconhecida como: ${detected.label}`,
    });
  } catch (e: any) {
    res.status(500).json({ detected: false, message: e.message });
  }
});

// ── Listar todos os sistemas judiciais disponíveis ────────────────────────────
router.get("/integracoes/sistemas", (_req, res) => {
  res.json({
    sistemas: [
      { id: "esaj",    nome: "e-SAJ",    tipo: "Estadual",  tribunais: ["TJSP","TJBA","TJSC","TJCE","TJAL","TJAC","TJAP","TJAM","TJPA","TJPI","TJRN","TJSE"], url: "https://esaj.tjsp.jus.br" },
      { id: "projudi", nome: "PROJUDI",  tipo: "Estadual",  tribunais: ["TJGO","TJPR","TJAM","TJAC","TJRR","TJRO","TJTO","TJAP","TJMA"], url: "https://projudi.tjgo.jus.br" },
      { id: "seeu",    nome: "SEEU",     tipo: "Federal",   tribunais: ["DEPEN","TJs (execução penal)"], url: "https://seeu.mj.gov.br" },
      { id: "eproc",   nome: "eProc",    tipo: "Federal",   tribunais: ["TRF4","TRF5","TRF3","JFPR","JFSC","JFRS"], url: "https://eproc.trf4.jus.br" },
      { id: "pjud",    nome: "PJud",     tipo: "Superior",  tribunais: ["STJ"], url: "https://processo.stj.jus.br" },
      { id: "pdpj",    nome: "PDPJ",     tipo: "Nacional",  tribunais: ["CNJ","PJe","Diversos"], url: "https://gateway.cloud.pje.jus.br" },
      { id: "datajud", nome: "DataJud",  tipo: "Nacional",  tribunais: ["Todos"], url: "https://datajud.cnj.jus.br" },
    ],
  });
});

// ── Busca direta STF (jurisprudência pública) ─────────────────────────────────
router.post("/integracoes/stf/buscar", async (req, res) => {
  const { q, pagina = 1 } = req.body as { q: string; pagina?: number };
  if (!q) return res.status(400).json({ message: "Informe o termo de busca" });

  try {
    const page = Math.max(1, pagina);
    const apiUrl = `https://jurisprudencia.stf.jus.br/api/search/search?query=${encodeURIComponent(q)}&page=${page}&pageSize=10&sort=score&sortDirection=desc`;
    const r = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SKJuridico/1.3)",
        Accept: "application/json",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!r.ok) throw new Error(`STF API retornou ${r.status}`);
    const data = await r.json() as any;
    const total = data?.hits?.total?.value ?? 0;
    const hits = (data?.hits?.hits ?? []) as any[];

    const results = hits.map((h: any) => {
      const s = h._source ?? {};
      return {
        id: h._id,
        tribunal: "STF",
        classe: s.classeProcessual?.descricao ?? s.classe ?? "",
        numero: s.numeroProcesso ?? s.processo ?? h._id,
        relator: s.ministroRelator ?? s.relator ?? "",
        data: s.dataPublicacaoDOU ?? s.dataJulgamento ?? "",
        ementa: (s.ementa ?? s.ementaTextual ?? "").slice(0, 800),
        score: h._score ?? 0,
        url: `https://jurisprudencia.stf.jus.br/pages/search/resultado/${h._id}/detalhe`,
      };
    });

    res.json({ results, total, pagina: page, sistema: "STF" });
  } catch (err: any) {
    // Fallback: retorna link de busca
    res.json({
      results: [],
      total: 0,
      fallbackUrl: `https://jurisprudencia.stf.jus.br/pages/search?query=${encodeURIComponent(q)}`,
      error: err.message?.slice(0, 120),
      sistema: "STF",
    });
  }
});

// ── Busca direta STJ (jurisprudência pública) ─────────────────────────────────
router.post("/integracoes/stj/buscar", async (req, res) => {
  const { q, pagina = 1 } = req.body as { q: string; pagina?: number };
  if (!q) return res.status(400).json({ message: "Informe o termo de busca" });

  try {
    const from = (Math.max(1, pagina) - 1) * 10;
    // API ElasticSearch pública do STJ
    const apiUrl = "https://scon.stj.jus.br/SCON/SearchBRS?b=ACOR&tipo_visualizacao=RESUMO&livre=" +
      encodeURIComponent(q) + `&operador=E&thesaurus=JURIDICO&p=true&l=10&i=${from + 1}`;

    const r = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SKJuridico/1.3)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });

    const html = await r.text();

    // Parser de resultado HTML do SCON
    const results: any[] = [];
    const itemRe = /<div[^>]*class="[^"]*resultado[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    const docRe = /PROCESSO:\s*([\w\s.-]+?)(?:\r|\n|<)/i;
    const relRe = /RELATOR[^:]*:\s*([^\r\n<]+)/i;
    const dataRe = /DATA[^:]*:\s*([\d/]+)/i;
    const ementaRe = /<p[^>]*class="[^"]*ementa[^"]*"[^>]*>([\s\S]*?)<\/p>/i;

    let m;
    while ((m = itemRe.exec(html)) && results.length < 10) {
      const block = m[1];
      const texto = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const doc = (block.match(docRe) || texto.match(docRe))?.[1]?.trim() ?? "";
      const rel = (block.match(relRe) || texto.match(relRe))?.[1]?.trim() ?? "";
      const dat = (block.match(dataRe) || texto.match(dataRe))?.[1]?.trim() ?? "";
      const ementaM = block.match(ementaRe);
      const ementa = ementaM
        ? ementaM[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600)
        : texto.slice(0, 500);
      if (ementa.length > 30) {
        results.push({ tribunal: "STJ", numero: doc, relator: rel, data: dat, ementa, score: 1 });
      }
    }

    res.json({
      results,
      total: results.length,
      pagina,
      fallbackUrl: `https://scon.stj.jus.br/SCON/pesquisar.jsp?b=ACOR&livre=${encodeURIComponent(q)}`,
      sistema: "STJ",
    });
  } catch (err: any) {
    res.json({
      results: [],
      total: 0,
      fallbackUrl: `https://scon.stj.jus.br/SCON/pesquisar.jsp?b=ACOR&livre=${encodeURIComponent(q)}`,
      error: err.message?.slice(0, 120),
      sistema: "STJ",
    });
  }
});

// ── Consulta TJSP processo (acesso público) ───────────────────────────────────
router.post("/integracoes/tjsp/processo", async (req, res) => {
  const { numero } = req.body as { numero: string };
  if (!numero) return res.status(400).json({ message: "Informe o número do processo" });

  // Número CNJ: NNNNNNN-DD.AAAA.8.26.OOOO
  const clean = numero.replace(/[.\-\s/]/g, "");
  const formatted = clean.length >= 20
    ? `${clean.slice(0,7)}-${clean.slice(7,9)}.${clean.slice(9,13)}.${clean.slice(13,14)}.${clean.slice(14,16)}.${clean.slice(16)}`
    : numero;

  const urlPublica = `https://esaj.tjsp.jus.br/cpopg/show.do?processo.numero=${encodeURIComponent(formatted)}&conversationId=&cbPesquisa=NUMPROC&dadosConsulta.tipoNuProcesso=UNIFICADO&dadosConsulta.valorConsulta=`;

  try {
    const r = await fetch(urlPublica, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SKJuridico/1.3)",
        Accept: "text/html",
        "Accept-Language": "pt-BR,pt;q=0.9",
        Referer: "https://esaj.tjsp.jus.br/cpopg/open.do",
      },
      signal: AbortSignal.timeout(15000),
    });

    const html = await r.text();
    const ex = (re: RegExp) => { const m = html.match(re); return m?.[1]?.replace(/<[^>]+>/g,"").trim() ?? null; };

    const classe   = ex(/Classe:\s*<[^>]+>([^<]+)/i) ?? ex(/classeTitulo[^>]*>([^<]+)</i);
    const vara     = ex(/Vara:\s*<[^>]+>([^<]+)/i)   ?? ex(/varaDescricao[^>]*>([^<]+)</i);
    const juiz     = ex(/Juiz[^:]*:\s*<[^>]+>([^<]+)/i);
    const valor    = ex(/Valor[^:]*:\s*<[^>]+>([^<]+)/i);
    const situacao = ex(/Situa[^:]*:\s*<[^>]+>([^<]+)/i);

    // Movimentações
    const movs: string[] = [];
    const movRe = /(\d{2}\/\d{2}\/\d{4})[^<]*<[^>]*>[^<]{10,200}/g;
    let mv;
    while ((mv = movRe.exec(html)) && movs.length < 10) {
      const t = mv[0].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
      if (t.length > 15) movs.push(t);
    }

    res.json({
      sistema: "TJSP",
      numero: formatted,
      classe, vara, juiz, valor, situacao,
      movimentacoes: movs,
      urlConsulta: urlPublica,
    });
  } catch (err: any) {
    res.json({
      sistema: "TJSP",
      numero: formatted,
      urlConsulta: urlPublica,
      error: err.message?.slice(0, 120),
    });
  }
});

// ── Busca TST (jurisprudência pública) ────────────────────────────────────────
router.post("/integracoes/tst/buscar", async (req, res) => {
  const { q } = req.body as { q: string };
  if (!q) return res.status(400).json({ message: "Informe o termo de busca" });

  const fallbackUrl = `https://jurisprudencia.tst.jus.br/#query=${encodeURIComponent(q)}`;

  try {
    const apiUrl = `https://jurisprudencia.tst.jus.br/api/rest/search/query?query=${encodeURIComponent(q)}&maxSize=10&startRecord=1`;
    const r = await fetch(apiUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SKJuridico/1.3)", Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });

    if (!r.ok) throw new Error(`TST API: HTTP ${r.status}`);
    const data = await r.json() as any;
    const hits = (data?.hits?.hits ?? data?.items ?? []) as any[];

    const results = hits.slice(0, 10).map((h: any) => {
      const s = h._source ?? h ?? {};
      return {
        tribunal: "TST",
        numero: s.numeroProcesso ?? s.num_processo ?? "",
        relator: s.orgaoJulgador?.nome ?? s.relator ?? "",
        data: s.dataPublicacao ?? s.data_publicacao ?? "",
        ementa: (s.ementa ?? s.ementa_textual ?? "").slice(0, 600),
      };
    });

    res.json({ results, total: results.length, fallbackUrl, sistema: "TST" });
  } catch (err: any) {
    res.json({ results: [], total: 0, fallbackUrl, error: err.message?.slice(0, 120), sistema: "TST" });
  }
});

export default router;
