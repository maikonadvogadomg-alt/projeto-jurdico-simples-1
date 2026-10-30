import { Router } from "express";
import multer from "multer";
import mammoth from "mammoth";
import path from "path";
import { decode } from "html-entities";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanHtml(html: string): string {
  let text = html;
  text = text.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, "");
  text = text.replace(/<\/(p|div|li|tr|blockquote|pre|section|article|header|footer|h[1-6]|td|th)\s*>/gi, "\n");
  text = text.replace(/<(br\s*\/?)>/gi, "\n");
  text = text.replace(/<(p|div|li|tr|h[1-6])[^>]*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = decode(text);
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.split("\n").map(l => l.trim()).join("\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/** Extrai texto de RTF sem biblioteca externa */
function extractRtf(buffer: Buffer): string {
  let rtf = buffer.toString("latin1");
  // Remove RTF controles e deixa apenas o texto
  rtf = rtf.replace(/\\fonttbl[^}]*}/gi, "");
  rtf = rtf.replace(/\\colortbl[^}]*}/gi, "");
  rtf = rtf.replace(/\\stylesheet[^}]*}/gi, "");
  rtf = rtf.replace(/\\info[^}]*}/gi, "");
  rtf = rtf.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
    const code = parseInt(hex, 16);
    // Windows-1252 → Unicode mapa básico
    if (code === 0xe7) return "ç"; if (code === 0xc7) return "Ç";
    if (code === 0xe3) return "ã"; if (code === 0xc3) return "Ã";
    if (code === 0xe9) return "é"; if (code === 0xc9) return "É";
    if (code === 0xea) return "ê"; if (code === 0xca) return "Ê";
    if (code === 0xe1) return "á"; if (code === 0xc1) return "Á";
    if (code === 0xe0) return "à"; if (code === 0xc0) return "À";
    if (code === 0xf5) return "õ"; if (code === 0xd5) return "Õ";
    if (code === 0xf3) return "ó"; if (code === 0xd3) return "Ó";
    if (code === 0xfa) return "ú"; if (code === 0xda) return "Ú";
    if (code === 0xed) return "í"; if (code === 0xcd) return "Í";
    if (code === 0xfc) return "ü"; if (code === 0xdc) return "Ü";
    return "";
  });
  rtf = rtf.replace(/\\par\b/gi, "\n");
  rtf = rtf.replace(/\\line\b/gi, "\n");
  rtf = rtf.replace(/\\tab\b/gi, "\t");
  rtf = rtf.replace(/\\[a-z]+\d*\s?/gi, "");
  rtf = rtf.replace(/[{}\\]/g, "");
  rtf = rtf.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  rtf = rtf.replace(/\n{4,}/g, "\n\n\n");
  return rtf.trim();
}

/** Extrai texto de ODT (OpenDocument) descomprimindo o content.xml */
async function extractOdt(buffer: Buffer): Promise<string> {
  const AdmZip = (await import("adm-zip" as any)).default;
  try {
    const zip = new AdmZip(buffer);
    const entry = zip.getEntry("content.xml");
    if (!entry) return "";
    const xml = zip.readAsText(entry);
    return cleanHtml(xml);
  } catch {
    return "";
  }
}

/** Extrai texto de EPUB descomprimindo e lendo arquivos HTML */
async function extractEpub(buffer: Buffer): Promise<string> {
  try {
    const AdmZip = (await import("adm-zip" as any)).default;
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().filter((e: any) =>
      /\.(html|htm|xhtml)$/i.test(e.entryName)
    );
    const texts: string[] = [];
    for (const entry of entries.slice(0, 30)) {
      const html = zip.readAsText(entry);
      const t = cleanHtml(html);
      if (t.length > 50) texts.push(t);
    }
    return texts.join("\n\n");
  } catch {
    return "";
  }
}

/** OCR de imagem via Google Vision API */
async function ocrImageWithVision(buffer: Buffer, mimeType: string, apiKey: string): Promise<string> {
  const base64 = buffer.toString("base64");
  const body = {
    requests: [{
      image: { content: base64 },
      features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
      imageContext: { languageHints: ["pt", "pt-BR", "es", "en"] },
    }],
  };
  const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Google Vision: HTTP ${r.status}`);
  const data = await r.json() as any;
  const text = data?.responses?.[0]?.fullTextAnnotation?.text || "";
  return text.trim();
}

let _pdfjsWorkerSrcSet = false;
async function extractTextFromPDF(buffer: Buffer, maxPages = 500): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!_pdfjsWorkerSrcSet) {
    const { pathToFileURL } = await import("url");
    const { createRequire } = await import("module");
    const req = createRequire(import.meta.url);
    const workerPath = req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    _pdfjsWorkerSrcSet = true;
  }

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdfDocument = await loadingTask.promise;
  const numPages = Math.min(pdfDocument.numPages, maxPages);
  const pages: string[] = [];
  let emptyPages = 0;

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDocument.getPage(i);
    const textContent = await page.getTextContent();
    const items = textContent.items as any[];
    let pageText = "";
    let lastY: number | null = null;
    for (const item of items) {
      if (!("str" in item)) continue;
      const y = item.transform?.[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) pageText += "\n";
      pageText += item.str;
      if (item.hasEOL) pageText += "\n";
      lastY = y;
    }
    const trimmed = pageText.trim();
    if (trimmed.length < 10) {
      emptyPages++;
    } else {
      pages.push(trimmed);
    }
  }

  const result = pages.join("\n\n");
  // Se muitas páginas vazias → provável PDF escaneado (imagem)
  const isScanned = emptyPages > numPages * 0.6;
  return result + (isScanned && numPages > 1 ? "\n\n[AVISO: PDF pode conter páginas escaneadas. Use OCR para melhor resultado.]" : "");
}

// ── /api/upload/extract-text ──────────────────────────────────────────────────
router.post("/upload/extract-text", upload.array("files", 20), async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);
    if (!files || files.length === 0) {
      return res.status(400).json({ message: "Nenhum arquivo enviado" });
    }

    // Carrega chave do Google Vision se disponível (para OCR de imagens)
    const { storage: storageModule } = await import("../storage.js");
    const visionKey = (await storageModule.getSetting("google_vision_api_key") || "").trim();

    let combinedText = "";

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
      const mime = file.mimetype || "";
      let extractedText = "";

      try {
        // ── Imagens → OCR ──────────────────────────────────────────────────
        const isImage = ["jpg", "jpeg", "png", "gif", "webp", "tiff", "tif", "bmp", "heic"].includes(ext)
          || mime.startsWith("image/");

        // ── Áudio/Vídeo → indica para usar transcrição ────────────────────
        const isAudio = ["mp3", "wav", "m4a", "ogg", "opus", "flac", "aac", "wma"].includes(ext) || mime.startsWith("audio/");
        const isVideo = ["mp4", "mov", "avi", "mkv", "wmv", "flv", "3gp", "m4v"].includes(ext) || mime.startsWith("video/");

        if (isImage) {
          if (visionKey) {
            extractedText = await ocrImageWithVision(file.buffer, mime || `image/${ext}`, visionKey);
            if (!extractedText) {
              try {
                extractedText = await ocrImageWithVision(file.buffer, "image/jpeg", visionKey);
              } catch {}
            }
            if (!extractedText) extractedText = "[Imagem sem texto detectável pelo OCR]";
          } else {
            // Tenta OCR local com Tesseract.js (sem chave de API)
            try {
              const { createWorker } = await import("tesseract.js" as any);
              const worker = await (createWorker as any)(["por", "eng"]);
              const { data } = await worker.recognize(file.buffer);
              await worker.terminate();
              extractedText = (data?.text ?? "").trim();
              if (extractedText.length < 5) extractedText = "";
              if (extractedText) {
                extractedText = `[OCR local — Tesseract.js]\n\n${extractedText}`;
              }
            } catch {
              // Tesseract não disponível — usa fallback de instrução
            }

            if (!extractedText) {
              const sizKB = Math.round(file.buffer.length / 1024);
              const imgMeta = `Formato: ${ext.toUpperCase() || "imagem"} | Tamanho: ${sizKB} KB`;
              extractedText = [
                `[IMAGEM: ${file.originalname}]`,
                `[${imgMeta}]`,
                ``,
                `Para extrair texto desta imagem (OCR), você tem 3 opções:`,
                `1. Configure a Google Vision API Key em Configurações → OCR (mais preciso)`,
                `2. Instale tesseract.js no servidor para OCR gratuito local (npm install tesseract.js)`,
                `3. Abra a imagem no Google Lens (lens.google.com) e copie o texto`,
              ].join("\n");
            }
          }
        } else if (isAudio || isVideo) {
          const tipoLabel = isAudio ? "Áudio" : "Vídeo";
          const sizMB = (file.buffer.length / (1024 * 1024)).toFixed(1);
          const durationHint = parseFloat(sizMB) > 25 ? " (arquivo longo — pode demorar alguns minutos)" : "";
          extractedText = [
            `[${tipoLabel.toUpperCase()}: ${file.originalname} — ${sizMB} MB${durationHint}]`,
            ``,
            `📌 Este arquivo foi recebido mas requer transcrição para extrair o texto.`,
            ``,
            `Como transcrever:`,
            `1. Use o botão "🎙 Transcrever Áudio" (ícone de microfone) na barra de ferramentas da tela principal`,
            `2. Selecione o mesmo arquivo novamente`,
            `3. Aguarde a transcrição automática via Whisper (OpenAI/Groq)`,
            ``,
            `Provedores compatíveis com transcrição:`,
            `• OpenAI Whisper — chave sk-... (mais preciso, custo mínimo)`,
            `• Groq Whisper — chave gsk_... (gratuito, ultrarrápido)`,
            `• Custom OpenAI-compatible — qualquer API com /audio/transcriptions`,
            ``,
            `Configure sua chave em Configurações → Chaves de API.`,
          ].join("\n");

        // ── PDF ──────────────────────────────────────────────────────────
        } else if (ext === "pdf" || mime === "application/pdf") {
          extractedText = await extractTextFromPDF(file.buffer);
          // Se PDF parece escaneado e temos Vision, tenta OCR na primeira página
          if (extractedText.includes("[AVISO: PDF pode conter páginas escaneadas") && visionKey) {
            try {
              // Renderiza a primeira página como imagem via pdfjs e faz OCR
              // (simplificado: apenas avisa e sugere)
              extractedText += "\n\n[Dica: Para PDFs escaneados, abra o PDF, selecione todo o texto (Ctrl+A) e cole aqui, ou use uma ferramenta de OCR como o Adobe Acrobat]";
            } catch {}
          }

        // ── DOCX ─────────────────────────────────────────────────────────
        } else if (["docx", "doc"].includes(ext) || mime.includes("wordprocessingml") || mime === "application/msword") {
          try {
            const result = await mammoth.extractRawText({ buffer: file.buffer });
            extractedText = result.value;
            if (!extractedText && ext === "doc") {
              extractedText = "[Formato .doc antigo: limitações na extração. Salve como .docx para melhor resultado]";
            }
          } catch {
            extractedText = "[Erro ao ler DOCX. O arquivo pode estar corrompido ou protegido]";
          }

        // ── HTML / HTM ───────────────────────────────────────────────────
        } else if (["html", "htm"].includes(ext) || mime.includes("html")) {
          extractedText = cleanHtml(file.buffer.toString("utf-8"));

        // ── XML ──────────────────────────────────────────────────────────
        } else if (ext === "xml" || mime.includes("xml")) {
          extractedText = cleanHtml(file.buffer.toString("utf-8"));

        // ── RTF ──────────────────────────────────────────────────────────
        } else if (ext === "rtf" || mime === "application/rtf" || mime === "text/rtf") {
          extractedText = extractRtf(file.buffer);

        // ── ODT (OpenDocument Text) ───────────────────────────────────────
        } else if (ext === "odt" || mime === "application/vnd.oasis.opendocument.text") {
          extractedText = await extractOdt(file.buffer);

        // ── EPUB ─────────────────────────────────────────────────────────
        } else if (ext === "epub" || mime === "application/epub+zip") {
          extractedText = await extractEpub(file.buffer);

        // ── CSV ──────────────────────────────────────────────────────────
        } else if (ext === "csv" || mime === "text/csv") {
          extractedText = file.buffer.toString("utf-8");

        // ── TXT / texto simples ──────────────────────────────────────────
        } else if (["txt", "md", "log", "json", "js", "ts", "py"].includes(ext) || mime.startsWith("text/") || ext === "") {
          // Detecta encoding (básico: UTF-8 ou Latin-1)
          try {
            extractedText = file.buffer.toString("utf-8");
            // Verifica se é válido UTF-8 (heurística: não deve ter muitos caracteres de substituição)
            if ((extractedText.match(/\uFFFD/g) || []).length > 10) {
              extractedText = file.buffer.toString("latin1");
            }
          } catch {
            extractedText = file.buffer.toString("latin1");
          }

        } else {
          // Tenta como texto UTF-8 (funciona para .csv, .log, etc.)
          try {
            const raw = file.buffer.toString("utf-8");
            if (raw.length > 0 && !raw.includes("\x00")) {
              extractedText = raw;
            } else {
              extractedText = `[Formato não suportado: .${ext || mime}]\n[Formatos aceitos: PDF, DOCX, DOC, TXT, HTML, XML, RTF, ODT, EPUB, CSV, imagens (com Vision API), áudio/vídeo (via transcrição)]`;
            }
          } catch {
            extractedText = `[Formato não reconhecido: .${ext || mime}]`;
          }
        }
      } catch (err: any) {
        extractedText = `[Erro ao processar ${file.originalname}: ${err?.message?.substring(0, 100) || "erro desconhecido"}]`;
      }

      if (extractedText && extractedText.trim().length > 0) {
        combinedText += (combinedText ? "\n\n---\n\n" : "") + extractedText;
      }
    }

    if (!combinedText || combinedText.trim().length < 5) {
      return res.status(422).json({
        message: "Não foi possível extrair conteúdo dos arquivos. Verifique se o arquivo não está vazio ou protegido.",
      });
    }

    combinedText = combinedText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    combinedText = combinedText.replace(/\n{4,}/g, "\n\n\n").trim();

    return res.json({ text: combinedText, chars: combinedText.length });
  } catch (error: any) {
    return res.status(500).json({ message: `Erro ao processar arquivo: ${error.message || "erro desconhecido"}` });
  }
});

// Alias path /api/extract-text (legado)
router.post("/extract-text", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Arquivo não enviado" });
  const { originalname, buffer, mimetype } = req.file;
  const ext = path.extname(originalname).toLowerCase().replace(".", "");
  let text = "";
  try {
    if (["txt", "md"].includes(ext) || mimetype === "text/plain") {
      text = buffer.toString("utf-8");
    } else if (ext === "pdf" || mimetype === "application/pdf") {
      text = await extractTextFromPDF(buffer);
    } else if (["docx", "doc"].includes(ext)) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (["html", "htm"].includes(ext) || mimetype.includes("html")) {
      text = cleanHtml(buffer.toString("utf-8"));
    } else if (ext === "xml" || mimetype.includes("xml")) {
      text = cleanHtml(buffer.toString("utf-8"));
    } else if (ext === "rtf" || mimetype.includes("rtf")) {
      text = extractRtf(buffer);
    } else if (ext === "odt") {
      text = await extractOdt(buffer);
    } else if (ext === "epub") {
      text = await extractEpub(buffer);
    } else {
      try { text = buffer.toString("utf-8"); } catch { return res.status(400).json({ message: `Formato não suportado: .${ext}` }); }
    }
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
    if (!text || text.length < 5) return res.status(422).json({ message: "Não foi possível extrair texto do arquivo." });
    return res.json({ text, chars: text.length, filename: originalname });
  } catch (error: any) {
    return res.status(500).json({ message: `Erro ao processar arquivo: ${error.message || "erro desconhecido"}` });
  }
});

// /api/import/url
router.post("/import/url", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") return res.status(400).json({ message: "URL inválida" });
    let parsedUrl: URL;
    try { parsedUrl = new URL(url); } catch { return res.status(400).json({ message: "URL mal formada" }); }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) return res.status(400).json({ message: "Apenas URLs http/https são permitidas" });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
      });
    } finally { clearTimeout(timeout); }

    if (!response.ok) return res.status(502).json({ message: `Site retornou erro ${response.status}` });

    const contentType = response.headers.get("content-type") || "";
    let text = "";

    if (contentType.includes("application/pdf")) {
      const buf = Buffer.from(await response.arrayBuffer());
      text = await extractTextFromPDF(buf);
    } else {
      const html = await response.text();
      text = cleanHtml(html);
    }

    if (text.length < 50) return res.status(422).json({ message: "Não foi possível extrair texto desta página" });
    return res.json({ text: text.substring(0, 100000), length: text.length, url });
  } catch (err: any) {
    if (err?.name === "AbortError") return res.status(504).json({ message: "Tempo limite excedido ao acessar o link" });
    return res.status(500).json({ message: "Erro ao buscar o link" });
  }
});

// Alias legado
router.post("/import-url", async (req, res) => {
  req.url = "/import/url";
  (router as any).handle(req, res, () => {});
});

// /api/upload/transcribe — áudio/vídeo via Whisper
router.post("/upload/transcribe", upload.array("files", 5), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ message: "Nenhum arquivo enviado" });
    }

    const { storage: storageModule } = await import("../storage.js");
    const dbKey = (await storageModule.getSetting("demo_api_key") || await storageModule.getSetting("openai_api_key") || "").trim();
    const dbUrl = (await storageModule.getSetting("demo_api_url") || "").trim();

    if (!dbKey) {
      return res.status(400).json({ message: "Configure uma chave OpenAI ou Custom em Configurações para transcrever áudio/vídeo." });
    }

    const OpenAI = (await import("openai")).default;
    const fs = await import("fs");
    const os = await import("os");
    const pathMod = await import("path");
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    const apiUrl = dbUrl ? dbUrl.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "") : "https://api.openai.com/v1";
    const isGroq = apiUrl.includes("groq.com");
    const whisperModel = isGroq ? "whisper-large-v3" : "whisper-1";
    const client = new OpenAI({ apiKey: dbKey, baseURL: apiUrl });

    const results: { filename: string; text: string; error?: string }[] = [];
    const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), "transcribe-"));

    for (const file of files) {
      const ext = pathMod.extname(file.originalname).toLowerCase().replace(".", "") || "bin";
      const isAudio = ["mp3", "wav", "m4a", "ogg", "oga", "opus", "ptt", "flac", "aac", "wma", "webm"].includes(ext) || file.mimetype.startsWith("audio/");
      const isVideo = ["mp4", "mov", "avi", "mkv", "wmv", "flv", "3gp", "m4v"].includes(ext) || file.mimetype.startsWith("video/");
      const needsConversion = isVideo || ["ogg", "oga", "opus", "ptt", "wma", "webm", "flac", "aac"].includes(ext);

      if (!isAudio && !isVideo) {
        results.push({ filename: file.originalname, text: "", error: `Formato não suportado para transcrição: .${ext}` });
        continue;
      }

      const safeExt = ext.replace(/[^a-z0-9]/g, "") || "bin";
      const timestamp = Date.now();
      const inputPath = pathMod.join(tmpDir, `input_${timestamp}.${safeExt}`);
      let audioPath = inputPath;

      try {
        fs.writeFileSync(inputPath, file.buffer);

        if (needsConversion) {
          audioPath = pathMod.join(tmpDir, `audio_${timestamp}.mp3`);
          try {
            await execFileAsync("ffmpeg", ["-i", inputPath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", "-y", audioPath], { timeout: 180000 });
          } catch {
            // tenta sem conversão
            audioPath = inputPath;
          }
        }

        const transcription = await client.audio.transcriptions.create({
          model: whisperModel,
          file: fs.createReadStream(audioPath),
          response_format: "json",
          language: "pt",
        });

        const text = typeof transcription === "string" ? transcription : (transcription as any).text || "";
        if (!text.trim()) {
          results.push({ filename: file.originalname, text: "", error: "Áudio sem fala detectável ou muito baixo" });
        } else {
          results.push({ filename: file.originalname, text: text.trim() });
        }
      } catch (e: any) {
        results.push({ filename: file.originalname, text: "", error: `Erro na transcrição: ${e.message?.substring(0, 100)}` });
      } finally {
        try { fs.unlinkSync(inputPath); } catch {}
        if (audioPath !== inputPath) { try { fs.unlinkSync(audioPath); } catch {} }
      }
    }

    try { fs.rmdirSync(tmpDir); } catch {}
    res.json({ results });
  } catch (error: any) {
    res.status(500).json({ message: "Erro ao transcrever arquivo" });
  }
});

// /api/upload/ocr — OCR direto para imagens
router.post("/upload/ocr", upload.array("files", 10), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ message: "Nenhum arquivo enviado" });
    }

    const { storage: storageModule } = await import("../storage.js");
    const visionKey = (await storageModule.getSetting("google_vision_api_key") || "").trim();

    // OCR funciona com Google Vision ou Tesseract.js local (sem chave)
    const hasTesseract = await import("tesseract.js" as any).then(() => true).catch(() => false);

    const results: { filename: string; text: string; error?: string }[] = [];

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
      const isImage = ["jpg", "jpeg", "png", "gif", "webp", "tiff", "tif", "bmp"].includes(ext) || file.mimetype.startsWith("image/");
      const isPdf = ext === "pdf" || file.mimetype === "application/pdf";

      if (!isImage && !isPdf) {
        results.push({ filename: file.originalname, text: "", error: "Apenas imagens e PDFs são aceitos para OCR" });
        continue;
      }

      try {
        if (isImage) {
          let text = "";
          if (visionKey) {
            text = await ocrImageWithVision(file.buffer, file.mimetype || `image/${ext}`, visionKey);
          } else if (hasTesseract) {
            try {
              const { createWorker } = await import("tesseract.js" as any);
              const worker = await (createWorker as any)(["por", "eng"]);
              const { data } = await worker.recognize(file.buffer);
              await worker.terminate();
              text = (data?.text ?? "").trim();
            } catch {}
          }
          results.push({ filename: file.originalname, text: text || "[Sem texto detectável na imagem]" });
        } else {
          // PDF: extrai texto normal primeiro
          const text = await extractTextFromPDF(file.buffer, 10);
          results.push({ filename: file.originalname, text: text || "[PDF sem texto extraível]" });
        }
      } catch (e: any) {
        results.push({ filename: file.originalname, text: "", error: e.message?.substring(0, 100) });
      }
    }

    const combined = results.filter(r => r.text).map(r => r.text).join("\n\n---\n\n");
    res.json({ results, combined, chars: combined.length });
  } catch (error: any) {
    res.status(500).json({ message: "Erro no OCR" });
  }
});

export default router;
