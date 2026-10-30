import { Router } from "express";
import { storage } from "../storage.js";

const router = Router();

// Mapa completo de todos os tribunais brasileiros → índice DataJud
const TRIBUNAL_MAP: Record<string, string> = {
  // Superiores
  STF: "stf", STJ: "stj", TST: "tst", TSE: "tse", STM: "stm",
  // Federais
  TRF1: "trf1", TRF2: "trf2", TRF3: "trf3", TRF4: "trf4", TRF5: "trf5", TRF6: "trf6",
  // Trabalhistas
  TRT1: "trt1", TRT2: "trt2", TRT3: "trt3", TRT4: "trt4", TRT5: "trt5",
  TRT6: "trt6", TRT7: "trt7", TRT8: "trt8", TRT9: "trt9", TRT10: "trt10",
  TRT11: "trt11", TRT12: "trt12", TRT13: "trt13", TRT14: "trt14", TRT15: "trt15",
  TRT16: "trt16", TRT17: "trt17", TRT18: "trt18", TRT19: "trt19", TRT20: "trt20",
  TRT21: "trt21", TRT22: "trt22", TRT23: "trt23", TRT24: "trt24",
  // Estaduais
  TJAC: "tjac", TJAL: "tjal", TJAM: "tjam", TJAP: "tjap", TJBA: "tjba",
  TJCE: "tjce", TJDFT: "tjdft", TJES: "tjes", TJGO: "tjgo", TJMA: "tjma",
  TJMG: "tjmg", TJMS: "tjms", TJMT: "tjmt", TJPA: "tjpa", TJPB: "tjpb",
  TJPE: "tjpe", TJPI: "tjpi", TJPR: "tjpr", TJRJ: "tjrj", TJRN: "tjrn",
  TJRO: "tjro", TJRR: "tjrr", TJRS: "tjrs", TJSC: "tjsc", TJSE: "tjse",
  TJSP: "tjsp", TJTO: "tjto",
  // Militares
  TJMMG: "tjmmg", TJMRS: "tjmrs", TJMSP: "tjmsp",
};

// Lista de todos os tribunais disponíveis
router.get("/jurisprudencia/tribunais", (_req, res) => {
  const list = Object.keys(TRIBUNAL_MAP).map(sigla => ({
    sigla,
    indice: `api_publica_${TRIBUNAL_MAP[sigla]}`,
    tipo: sigla.startsWith("TJ") ? "Estadual"
      : sigla.startsWith("TRF") ? "Federal"
      : sigla.startsWith("TRT") ? "Trabalhista"
      : "Superior",
  }));
  res.json({ tribunais: list });
});

// Busca principal — DataJud CNJ (sem IA)
router.post("/jurisprudencia/buscar", async (req, res) => {
  try {
    const {
      q,
      tribunais,
      apiKey: clientKey,
      tamanho = 10,
      pagina = 1,
      dataInicio,
      dataFim,
      classe,
      assunto,
    } = req.body as {
      q: string;
      tribunais: string[];
      apiKey?: string;
      tamanho?: number;
      pagina?: number;
      dataInicio?: string;
      dataFim?: string;
      classe?: string;
      assunto?: string;
    };

    if (!q?.trim()) return res.status(400).json({ message: "Termo de busca obrigatório" });

    const rawKey = (clientKey?.trim()) || (await storage.getSetting("datajud_api_key")) || "";
    if (!rawKey) {
      return res.status(400).json({
        message: "Chave DataJud não configurada. Acesse Configurações → Chaves de API e insira sua chave CNJ (datajud-wiki.cnj.jus.br).",
      });
    }
    const DATAJUD_KEY = rawKey.startsWith("ApiKey ") ? rawKey : `ApiKey ${rawKey}`;

    const tribunaisList = Array.isArray(tribunais) && tribunais.length > 0 ? tribunais : [];
    const indices = tribunaisList.length > 0
      ? tribunaisList.map(t => `api_publica_${TRIBUNAL_MAP[t] || t.toLowerCase()}`)
      : ["api_publica_stj", "api_publica_stf", "api_publica_trf1", "api_publica_trf4"];

    const from = Math.max(0, (pagina - 1)) * Math.min(tamanho, 20);
    const size = Math.min(tamanho, 20);

    // Constrói filtros de data se fornecidos
    const rangeFilters: any[] = [];
    if (dataInicio || dataFim) {
      const rangeObj: any = {};
      if (dataInicio) rangeObj.gte = dataInicio.replace(/\//g, "").replace(/-/g, "");
      if (dataFim) rangeObj.lte = dataFim.replace(/\//g, "").replace(/-/g, "");
      rangeFilters.push({ range: { dataAjuizamento: rangeObj } });
    }

    // Filtros de classe/assunto
    const termFilters: any[] = [];
    if (classe?.trim()) {
      termFilters.push({ match: { "classe.nome": { query: classe.trim(), boost: 2 } } });
    }
    if (assunto?.trim()) {
      termFilters.push({ match: { "assuntos.nome": { query: assunto.trim(), boost: 2 } } });
    }

    const payload = {
      from,
      size,
      query: {
        bool: {
          must: [
            {
              bool: {
                should: [
                  { match: { ementa: { query: q, boost: 8, operator: "and" } } },
                  { match_phrase: { ementa: { query: q, boost: 12, slop: 2 } } },
                  { match: { ementa: { query: q, boost: 5 } } },
                  { match: { "assuntos.nome": { query: q, boost: 3 } } },
                  { match: { "classe.nome": { query: q, boost: 2 } } },
                  { match: { "orgaoJulgador.nome": { query: q, boost: 1 } } },
                ],
                minimum_should_match: 1,
              },
            },
            ...termFilters,
          ],
          filter: rangeFilters,
        },
      },
      sort: [{ _score: { order: "desc" } }, { dataAjuizamento: { order: "desc" } }],
      highlight: {
        fields: {
          ementa: { fragment_size: 300, number_of_fragments: 2 },
        },
      },
    };

    const allResults: any[] = [];
    const errorMessages: string[] = [];
    let totalHits = 0;
    let totalErrors = 0;

    // Busca em paralelo em todos os tribunais selecionados
    const fetchPromises = indices.map(async (idx) => {
      try {
        const url = `https://api-publica.datajud.cnj.jus.br/${idx}/_search`;
        const cnjRes = await fetch(url, {
          method: "POST",
          headers: { Authorization: DATAJUD_KEY, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(12000),
        });
        if (!cnjRes.ok) {
          errorMessages.push(`${idx.replace("api_publica_", "").toUpperCase()}: HTTP ${cnjRes.status}`);
          totalErrors++;
          return;
        }
        const data = await cnjRes.json() as any;
        totalHits += data?.hits?.total?.value || 0;

        for (const hit of data?.hits?.hits || []) {
          const s = hit._source || {};
          const numProc = s.numeroProcesso || "";
          const formatted = numProc.length === 20
            ? `${numProc.slice(0, 7)}-${numProc.slice(7, 9)}.${numProc.slice(9, 13)}.${numProc.slice(13, 14)}.${numProc.slice(14, 16)}.${numProc.slice(16)}`
            : numProc;
          const assuntos = (s.assuntos || []).map((a: any) => a.nome).filter(Boolean).join(", ");
          const ultimoMov = (s.movimentos || []).slice(-1)[0];
          const orgao = s.orgaoJulgador?.nome || ultimoMov?.orgaoJulgador?.nome || "";
          const dataMov = s.dataAjuizamento
            ? (() => {
                const d = s.dataAjuizamento;
                return `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}`;
              })()
            : ultimoMov?.dataHora
              ? new Date(ultimoMov.dataHora).toLocaleDateString("pt-BR")
              : "Não informado";

          const highlightedEmenta = hit.highlight?.ementa?.[0] || s.ementa || assuntos || "Sem ementa disponível";

          allResults.push({
            tribunal: s.tribunal || idx.replace("api_publica_", "").toUpperCase(),
            tipo: s.classe?.nome || "Processo",
            processo: formatted,
            relator: orgao,
            data: dataMov,
            ementa: s.ementa || assuntos || "Sem ementa disponível",
            ementaHighlight: highlightedEmenta,
            assuntos: assuntos || "",
            score: hit._score || 0,
            url: numProc
              ? `https://jurisprudencia.cnj.jus.br/pesquisa-unificada?numero=${numProc}`
              : null,
          });
        }
      } catch (err: any) {
        totalErrors++;
        errorMessages.push(`${idx.replace("api_publica_", "").toUpperCase()}: ${err.message?.substring(0, 80)}`);
      }
    });

    await Promise.all(fetchPromises);

    // Ordena por relevância
    allResults.sort((a, b) => (b.score || 0) - (a.score || 0));

    if (allResults.length === 0 && totalErrors === indices.length) {
      return res.status(503).json({
        message: `DataJud temporariamente indisponível. Detalhes: ${errorMessages.join("; ")}`,
      });
    }

    res.json({
      results: allResults.slice(0, 50),
      total: totalHits || allResults.length,
      pagina,
      warnings:
        totalErrors > 0 && allResults.length > 0
          ? [`Alguns tribunais não responderam: ${errorMessages.join("; ")}`]
          : undefined,
    });
  } catch (e: any) {
    res.status(500).json({ message: "Falha na comunicação com o DataJud. Verifique sua conexão." });
  }
});

// Busca por número de processo específico
router.post("/jurisprudencia/processo", async (req, res) => {
  try {
    const { numero, apiKey: clientKey } = req.body as { numero: string; apiKey?: string };
    if (!numero?.trim()) return res.status(400).json({ message: "Número do processo obrigatório" });

    const rawKey = (clientKey?.trim()) || (await storage.getSetting("datajud_api_key")) || "";
    if (!rawKey) return res.status(400).json({ message: "Chave DataJud não configurada" });
    const DATAJUD_KEY = rawKey.startsWith("ApiKey ") ? rawKey : `ApiKey ${rawKey}`;

    const clean = numero.replace(/[.\-\s]/g, "");

    // Detecta tribunal pelo número (CNJ NNNNNNN-DD.AAAA.J.TT.OOOO)
    let tribunalIdx = "api_publica_stj"; // fallback
    if (clean.length === 20) {
      const j = clean[13];
      const tt = clean.slice(14, 16);
      const map: Record<string, Record<string, string>> = {
        "8": { "01": "tjac", "02": "tjal", "03": "tjap", "04": "tjam", "05": "tjba", "06": "tjce", "07": "tjdft", "08": "tjes", "09": "tjgo", "10": "tjma", "11": "tjmt", "12": "tjms", "13": "tjmg", "14": "tjpa", "15": "tjpb", "16": "tjpe", "17": "tjpi", "18": "tjpr", "19": "tjrj", "20": "tjrn", "21": "tjro", "22": "tjrr", "23": "tjrs", "24": "tjsc", "25": "tjse", "26": "tjsp", "27": "tjto" },
        "4": { "01": "trf1", "02": "trf2", "03": "trf3", "04": "trf4", "05": "trf5", "06": "trf6" },
        "5": { "01": "trt1", "02": "trt2", "03": "trt3", "04": "trt4", "05": "trt5", "06": "trt6", "07": "trt7", "08": "trt8", "09": "trt9", "10": "trt10", "11": "trt11", "12": "trt12", "13": "trt13", "14": "trt14", "15": "trt15", "16": "trt16", "17": "trt17", "18": "trt18", "19": "trt19", "20": "trt20", "21": "trt21", "22": "trt22", "23": "trt23", "24": "trt24" },
        "6": { "00": "stj" }, "1": { "00": "stf" },
      };
      const trib = map[j]?.[tt];
      if (trib) tribunalIdx = `api_publica_${trib}`;
    }

    const payload = {
      size: 5,
      query: { term: { numeroProcesso: clean } },
    };

    const url = `https://api-publica.datajud.cnj.jus.br/${tribunalIdx}/_search`;
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: DATAJUD_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!r.ok) return res.status(502).json({ message: `DataJud retornou ${r.status}` });
    const data = await r.json() as any;
    const hits = (data?.hits?.hits || []).map((h: any) => h._source);
    res.json({ results: hits, tribunal: tribunalIdx });
  } catch (e: any) {
    res.status(500).json({ message: "Erro ao consultar processo" });
  }
});

// Busca por jurisprudência usando IA (complementar)
router.post("/jurisprudencia/buscar-ia", async (req, res) => {
  try {
    const { q, contexto, modelo = "economico" } = req.body as {
      q: string;
      contexto?: string;
      modelo?: string;
    };
    if (!q?.trim()) return res.status(400).json({ message: "Termo de busca obrigatório" });

    const userGeminiKey = (await storage.getSetting("gemini_api_key") || "").trim();
    const openaiKey = (await storage.getSetting("openai_api_key") || "").trim();
    const demoKey = (await storage.getSetting("demo_api_key") || "").trim();
    const demoUrl = (await storage.getSetting("demo_api_url") || "").trim();
    const demoModel = (await storage.getSetting("demo_api_model") || "").trim();

    const geminiKey = userGeminiKey;

    if (!geminiKey && !openaiKey && !demoKey) {
      return res.status(400).json({ message: "Configure uma chave de IA (Gemini, OpenAI ou Custom) em Configurações" });
    }

    const systemPrompt = `Você é um especialista em jurisprudência brasileira. O usuário está pesquisando sobre: "${q}".
Forneça:
1. Principais teses jurisprudenciais aplicáveis
2. Tribunais que se posicionam sobre o tema (STJ, STF, TRTs, TJs relevantes)
3. Ementa sintética de casos paradigmáticos (com indicação do tribunal/processo se souber)
4. Súmulas aplicáveis (se houver)
5. Recomendação de termos de busca no DataJud para encontrar mais casos${contexto ? `\n\nContexto adicional do caso: ${contexto}` : ""}

Seja preciso e cite fontes quando possível.`;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    if (geminiKey) {
      const { GoogleGenAI } = await import("@google/genai");
      const clientOpts: any = { apiKey: geminiKey };
      const genai = new GoogleGenAI(clientOpts);
      const mdl = modelo === "premium" ? "gemini-2.5-pro" : "gemini-2.5-flash";
      const stream = await genai.models.generateContentStream({
        model: mdl,
        contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
      });
      for await (const chunk of stream) {
        const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (text) res.write(`data: ${JSON.stringify({ type: "chunk", content: text })}\n\n`);
      }
    } else {
      const OpenAI = (await import("openai")).default;
      const apiUrl = demoUrl ? demoUrl.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "") : "https://api.openai.com/v1";
      const client = new OpenAI({ apiKey: demoKey || openaiKey, baseURL: apiUrl });
      const mdl = demoModel || (openaiKey ? "gpt-4o-mini" : "gpt-4o-mini");
      const stream = await client.chat.completions.create({
        model: mdl,
        messages: [{ role: "user", content: systemPrompt }],
        stream: true,
      });
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || "";
        if (text) res.write(`data: ${JSON.stringify({ type: "chunk", content: text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (e: any) {
    res.write(`data: ${JSON.stringify({ type: "error", message: e.message || "Erro na IA" })}\n\n`);
    res.end();
  }
});

export default router;
