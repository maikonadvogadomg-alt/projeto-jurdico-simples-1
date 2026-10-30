/**
 * PJe — Processo Judicial Eletrônico
 * Consulta de processos via API pública e WebService SOAP
 *
 * GET /api/pje/consulta/:numero     — Consulta processo por número CNJ
 * POST /api/pje/consulta            — Busca por parâmetros
 * GET /api/pje/movimentos/:numero   — Movimentos do processo
 * GET /api/pje/config/status        — Status da configuração
 */
import { Router } from "express";
import { storage } from "../storage.js";

const router = Router();

// Tribunais PJe com endpoints conhecidos (REST onde disponível, SOAP como fallback)
const PJE_ENDPOINTS: Record<string, { nome: string; restUrl?: string; soapUrl?: string; tipo: string }> = {
  TJPE: { nome: "TJ Pernambuco", restUrl: "https://pje.tjpe.jus.br/1g/api", tipo: "pje" },
  TJMA: { nome: "TJ Maranhão", restUrl: "https://pje.tjma.jus.br/pje/api", tipo: "pje" },
  TJBA: { nome: "TJ Bahia", restUrl: "https://pje.tjba.jus.br/pje/api", tipo: "pje" },
  TJCE: { nome: "TJ Ceará", restUrl: "https://pje.tjce.jus.br/pje/api", tipo: "pje" },
  TJAL: { nome: "TJ Alagoas", restUrl: "https://pje.tjal.jus.br/pje/api", tipo: "pje" },
  TJRN: { nome: "TJ Rio Grande do Norte", restUrl: "https://pje.tjrn.jus.br/pje/api", tipo: "pje" },
  TJPB: { nome: "TJ Paraíba", restUrl: "https://pje.tjpb.jus.br/pje/api", tipo: "pje" },
  TJSE: { nome: "TJ Sergipe", restUrl: "https://pje.tjse.jus.br/pje/api", tipo: "pje" },
  TJPI: { nome: "TJ Piauí", restUrl: "https://pje.tjpi.jus.br/pje/api", tipo: "pje" },
  TJTO: { nome: "TJ Tocantins", restUrl: "https://pje.tjto.jus.br/pje/api", tipo: "pje" },
  TJAM: { nome: "TJ Amazonas", restUrl: "https://pje.tjam.jus.br/pje/api", tipo: "pje" },
  TJPA: { nome: "TJ Pará", restUrl: "https://pje.tjpa.jus.br/pje/api", tipo: "pje" },
  TJAC: { nome: "TJ Acre", restUrl: "https://pje.tjac.jus.br/pje/api", tipo: "pje" },
  TJAP: { nome: "TJ Amapá", restUrl: "https://pje.tjap.jus.br/pje/api", tipo: "pje" },
  TJRO: { nome: "TJ Rondônia", restUrl: "https://pje.tjro.jus.br/pje/api", tipo: "pje" },
  TJRR: { nome: "TJ Roraima", restUrl: "https://pje.tjrr.jus.br/pje/api", tipo: "pje" },
  TRF1: { nome: "TRF 1ª Região", restUrl: "https://eproc.trf1.jus.br/eproc/api", tipo: "eproc" },
  TRF3: { nome: "TRF 3ª Região", restUrl: "https://pje.trf3.jus.br/pje/api", tipo: "pje" },
  TRF5: { nome: "TRF 5ª Região", restUrl: "https://pje.trf5.jus.br/pje/api", tipo: "pje" },
};

/** Detecta o tribunal pelo número CNJ: NNNNNNN-DD.AAAA.J.TT.OOOO */
function detectarTribunal(numero: string): string {
  const m = numero.match(/\d{7}-\d{2}\.\d{4}\.(\d)\.(\d{2})\.\d{4}/);
  if (!m) return "";
  const justica = m[1];
  const tribunal = m[2];
  if (justica === "8") return `TJ${stateCode(tribunal)}`;
  if (justica === "4") return `TRF${trf(tribunal)}`;
  if (justica === "5") return "TST";
  return "";
}

function stateCode(code: string): string {
  const map: Record<string, string> = {
    "01": "AC","02": "AL","03": "AM","04": "AP","05": "BA","06": "CE","07": "DF",
    "08": "ES","09": "GO","10": "MA","11": "MT","12": "MS","13": "MG","14": "PA",
    "15": "PB","16": "PR","17": "PE","18": "PI","19": "RJ","20": "RN","21": "RS",
    "22": "RO","23": "RR","24": "SC","25": "SP","26": "SE","27": "TO",
  };
  return map[code] || code;
}

function trf(code: string): string {
  const map: Record<string, string> = { "01":"1","02":"2","03":"3","04":"4","05":"5","06":"6" };
  return map[code] || code;
}

/** Consulta via DataJud CNJ (fallback universal) */
async function consultarDataJud(numero: string, tribunal: string): Promise<any> {
  const chave = await storage.getSetting("datajud_api_key") || process.env.DATAJUD_API_KEY || "";
  const index = tribunal ? `processo_${tribunal.toLowerCase().replace("tj", "tjrs")}` : "processo_stj";

  const resp = await fetch(`https://api-publica.datajud.cnj.jus.br/${index}/_search`, {
    method: "POST",
    headers: {
      "Authorization": `APIKey ${chave}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: { match: { "numeroProcesso": numero } },
      size: 1,
    }),
  });

  if (!resp.ok) throw new Error(`DataJud HTTP ${resp.status}`);
  const data = await resp.json();
  return data.hits?.hits?.[0]?._source || null;
}

/** GET /api/pje/consulta/:numero */
router.get("/pje/consulta/:numero", async (req, res) => {
  try {
    const numero = req.params.numero.replace(/[^\d.-]/g, "");
    const tribunalDetectado = detectarTribunal(numero);
    const tribunal = (req.query.tribunal as string || tribunalDetectado).toUpperCase();

    let resultado: any = null;
    let fonte = "datajud";

    // Tenta PJe REST direto primeiro (se tribunal tem endpoint)
    const endpoint = PJE_ENDPOINTS[tribunal];
    if (endpoint?.restUrl) {
      try {
        const pjeResp = await fetch(
          `${endpoint.restUrl}/processos?numeroProcesso=${encodeURIComponent(numero)}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (pjeResp.ok) {
          const pjeData = await pjeResp.json();
          if (pjeData?.content?.length > 0 || pjeData?.processo) {
            resultado = pjeData.content?.[0] || pjeData.processo;
            fonte = "pje_direto";
          }
        }
      } catch {}
    }

    // Fallback para DataJud CNJ
    if (!resultado) {
      resultado = await consultarDataJud(numero, tribunal);
      fonte = "datajud";
    }

    if (!resultado) {
      return res.status(404).json({
        message: "Processo não encontrado",
        numero, tribunal: tribunal || tribunalDetectado,
        sugestao: "Verifique se o número está no formato CNJ (NNNNNNN-DD.AAAA.J.TT.OOOO)",
      });
    }

    res.json({ ok: true, numero, tribunal, fonte, processo: resultado });
  } catch (e: any) {
    res.status(500).json({ message: "Erro na consulta PJe: " + e.message });
  }
});

/** POST /api/pje/consulta — busca por parâmetros */
router.post("/pje/consulta", async (req, res) => {
  try {
    const { numero, nomeParte, cpfCnpj, tribunal, classe } = req.body;
    if (!numero && !nomeParte && !cpfCnpj) {
      return res.status(400).json({ message: "Informe pelo menos: numero, nomeParte ou cpfCnpj" });
    }

    const chave = await storage.getSetting("datajud_api_key") || process.env.DATAJUD_API_KEY || "";
    if (!chave) {
      return res.status(400).json({ message: "Chave DataJud CNJ não configurada. Configure nas configurações." });
    }

    const tribunalNorm = (tribunal || "stj").toLowerCase().replace("tj", "tjsp");
    const index = `processo_${tribunalNorm}`;

    const should: any[] = [];
    if (numero) should.push({ match: { "numeroProcesso": numero } });
    if (nomeParte) should.push({ match: { "partes.nome": { query: nomeParte, operator: "and" } } });
    if (cpfCnpj) should.push({ match: { "partes.documento": cpfCnpj.replace(/\D/g, "") } });
    if (classe) should.push({ match: { "classe.nome": classe } });

    const resp = await fetch(`https://api-publica.datajud.cnj.jus.br/${index}/_search`, {
      method: "POST",
      headers: { "Authorization": `APIKey ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: { bool: { should, minimum_should_match: 1 } },
        size: 20,
        sort: [{ "dataAjuizamento": { order: "desc" } }],
      }),
    });

    if (!resp.ok) throw new Error(`DataJud ${resp.status}`);
    const data = await resp.json();
    const processos = data.hits?.hits?.map((h: any) => h._source) || [];

    res.json({ ok: true, total: data.hits?.total?.value || 0, processos });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

/** GET /api/pje/movimentos/:numero */
router.get("/pje/movimentos/:numero", async (req, res) => {
  try {
    const numero = req.params.numero.replace(/[^\d.-]/g, "");
    const tribunal = detectarTribunal(numero);
    const processo = await consultarDataJud(numero, tribunal);

    if (!processo) return res.status(404).json({ message: "Processo não encontrado" });

    const movimentos = (processo.movimentos || []).sort((a: any, b: any) =>
      new Date(b.dataHora || b.data || 0).getTime() - new Date(a.dataHora || a.data || 0).getTime()
    );

    res.json({ ok: true, numero, tribunal, totalMovimentos: movimentos.length, movimentos });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

/** GET /api/pje/tribunais — lista tribunais disponíveis */
router.get("/pje/tribunais", (_req, res) => {
  res.json(Object.entries(PJE_ENDPOINTS).map(([id, t]) => ({
    id, nome: t.nome, tipo: t.tipo, disponivel: true,
  })));
});

/** GET /api/pje/config/status */
router.get("/pje/config/status", async (_req, res) => {
  const datajudKey = await storage.getSetting("datajud_api_key");
  res.json({
    datajud: { configurado: !!datajudKey, descricao: "API pública CNJ — acesso a todos os tribunais" },
    pjeAtivo: true,
    tribunaisDisponiveis: Object.keys(PJE_ENDPOINTS).length,
    modoOperacao: "REST via DataJud CNJ + consulta direta PJe quando disponível",
  });
});

export default router;
