/**
 * SK Jurídico — FileStorage: armazenamento local em arquivo JSON
 *
 * Ativado automaticamente quando DATABASE_URL não está configurado
 * ou quando ELECTRON_MODE=1 ou LOCAL_MODE=1.
 *
 * Persiste todos os dados em ./sk-juridico-local-data.json — sem PostgreSQL,
 * sem Docker, sem nenhuma dependência externa.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { IStorage } from "./storage.js";
import type {
  User, InsertUser, Snippet, InsertSnippet,
  CustomAction, InsertCustomAction, Ementa, InsertEmenta,
  AiHistory, InsertAiHistory, PromptTemplate, InsertPromptTemplate,
  DocTemplate, InsertDocTemplate, SharedParecer,
  ProcessoMonitorado, InsertProcessoMonitorado,
  AppSetting, TramitacaoPublicacao,
} from "../shared/db";
import { getLocalConfig, setLocalConfig, isAiKey, type LocalConfig } from "./local-config.js";

// ── Localização do arquivo de dados ──────────────────────────────────────────

function getDataFilePath(): string {
  // Electron: usa a pasta de dados do app
  if (process.env.ELECTRON_DATA_PATH) {
    return path.join(process.env.ELECTRON_DATA_PATH, "sk-juridico-local-data.json");
  }
  // Fallback: mesmo diretório do processo
  return path.resolve(process.env.LOCAL_DATA_FILE || "./sk-juridico-local-data.json");
}

// ── Estrutura dos dados persistidos ──────────────────────────────────────────

interface LocalData {
  users: User[];
  snippets: Snippet[];
  customActions: CustomAction[];
  ementas: Ementa[];
  aiHistory: AiHistory[];
  promptTemplates: PromptTemplate[];
  docTemplates: DocTemplate[];
  sharedPareceres: SharedParecer[];
  processosMonitorados: ProcessoMonitorado[];
  settings: Record<string, string>;
  tramitacaoPublicacoes: TramitacaoPublicacao[];
}

const EMPTY_DATA: LocalData = {
  users: [],
  snippets: [],
  customActions: [],
  ementas: [],
  aiHistory: [],
  promptTemplates: [],
  docTemplates: [],
  sharedPareceres: [],
  processosMonitorados: [],
  settings: {},
  tramitacaoPublicacoes: [],
};

// ── Classe FileStorage ────────────────────────────────────────────────────────

export class FileStorage implements IStorage {
  private data: LocalData;
  private filePath: string;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.filePath = getDataFilePath();
    this.data = this._load();
    console.log(`[FileStorage] Dados em: ${this.filePath}`);
  }

  private _load(): LocalData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        return { ...EMPTY_DATA, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.warn(`[FileStorage] Erro ao carregar dados: ${e}. Iniciando com dados vazios.`);
    }
    return { ...EMPTY_DATA };
  }

  private _scheduleSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this._save(), 200);
  }

  private _save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
    } catch (e) {
      console.error(`[FileStorage] Erro ao salvar: ${e}`);
    }
  }

  private _now(): string {
    return new Date().toISOString();
  }

  // ── Users ───────────────────────────────────────────────────────────────────
  async getUser(id: string) { return this.data.users.find(u => u.id === id); }
  async getUserByUsername(username: string) { return this.data.users.find(u => u.username === username); }
  async createUser(user: InsertUser): Promise<User> {
    const u: User = { id: randomUUID(), ...user };
    this.data.users.push(u);
    this._scheduleSave();
    return u;
  }

  // ── Snippets ────────────────────────────────────────────────────────────────
  async getSnippets() { return [...this.data.snippets]; }
  async getSnippet(id: string) { return this.data.snippets.find(s => s.id === id); }
  async createSnippet(snippet: InsertSnippet): Promise<Snippet> {
    const s: Snippet = { id: randomUUID(), title: "Untitled", html: "", css: "", js: "", mode: "html", ...snippet };
    this.data.snippets.push(s);
    this._scheduleSave();
    return s;
  }
  async updateSnippetTitle(id: string, title: string) {
    const s = this.data.snippets.find(x => x.id === id);
    if (s) { s.title = title; this._scheduleSave(); }
    return s;
  }
  async deleteSnippet(id: string) {
    this.data.snippets = this.data.snippets.filter(s => s.id !== id);
    this._scheduleSave();
  }

  // ── Custom Actions ──────────────────────────────────────────────────────────
  async getCustomActions() { return [...this.data.customActions]; }
  async getCustomAction(id: string) { return this.data.customActions.find(a => a.id === id); }
  async createCustomAction(action: InsertCustomAction): Promise<CustomAction> {
    const a: CustomAction = { id: randomUUID(), description: "", ...action };
    this.data.customActions.push(a);
    this._scheduleSave();
    return a;
  }
  async updateCustomAction(id: string, action: InsertCustomAction) {
    const idx = this.data.customActions.findIndex(a => a.id === id);
    if (idx === -1) return undefined;
    this.data.customActions[idx] = { ...this.data.customActions[idx], ...action };
    this._scheduleSave();
    return this.data.customActions[idx];
  }
  async deleteCustomAction(id: string) {
    this.data.customActions = this.data.customActions.filter(a => a.id !== id);
    this._scheduleSave();
  }

  // ── Ementas ─────────────────────────────────────────────────────────────────
  async getEmentas() { return [...this.data.ementas]; }
  async getEmenta(id: string) { return this.data.ementas.find(e => e.id === id); }
  async createEmenta(ementa: InsertEmenta): Promise<Ementa> {
    const e: Ementa = { id: randomUUID(), categoria: "Geral", ...ementa };
    this.data.ementas.push(e);
    this._scheduleSave();
    return e;
  }
  async updateEmenta(id: string, ementa: InsertEmenta) {
    const idx = this.data.ementas.findIndex(e => e.id === id);
    if (idx === -1) return undefined;
    this.data.ementas[idx] = { ...this.data.ementas[idx], ...ementa };
    this._scheduleSave();
    return this.data.ementas[idx];
  }
  async deleteEmenta(id: string) {
    this.data.ementas = this.data.ementas.filter(e => e.id !== id);
    this._scheduleSave();
  }

  // ── AI History ──────────────────────────────────────────────────────────────
  async getAiHistory() {
    return [...this.data.aiHistory].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  async createAiHistory(entry: InsertAiHistory): Promise<AiHistory> {
    const h: AiHistory = {
      id: randomUUID(), action: "", inputPreview: "", result: "",
      model: "", provider: "", inputTokens: 0, outputTokens: 0, estimatedCost: 0,
      chatHistory: null, createdAt: new Date(),
      ...entry,
    };
    this.data.aiHistory.unshift(h);
    if (this.data.aiHistory.length > 500) this.data.aiHistory = this.data.aiHistory.slice(0, 500);
    this._scheduleSave();
    return h;
  }
  async deleteAiHistory(id: string) {
    this.data.aiHistory = this.data.aiHistory.filter(h => h.id !== id);
    this._scheduleSave();
  }
  async clearAiHistory() {
    this.data.aiHistory = [];
    this._scheduleSave();
  }

  // ── Prompt Templates ────────────────────────────────────────────────────────
  async getPromptTemplates() { return [...this.data.promptTemplates]; }
  async getPromptTemplate(id: string) { return this.data.promptTemplates.find(t => t.id === id); }
  async createPromptTemplate(template: InsertPromptTemplate): Promise<PromptTemplate> {
    const t: PromptTemplate = { id: randomUUID(), categoria: "Geral", ...template };
    this.data.promptTemplates.push(t);
    this._scheduleSave();
    return t;
  }
  async updatePromptTemplate(id: string, template: InsertPromptTemplate) {
    const idx = this.data.promptTemplates.findIndex(t => t.id === id);
    if (idx === -1) return undefined;
    this.data.promptTemplates[idx] = { ...this.data.promptTemplates[idx], ...template };
    this._scheduleSave();
    return this.data.promptTemplates[idx];
  }
  async deletePromptTemplate(id: string) {
    this.data.promptTemplates = this.data.promptTemplates.filter(t => t.id !== id);
    this._scheduleSave();
  }

  // ── Doc Templates ───────────────────────────────────────────────────────────
  async getDocTemplates() { return [...this.data.docTemplates]; }
  async getDocTemplate(id: string) { return this.data.docTemplates.find(t => t.id === id); }
  async createDocTemplate(template: InsertDocTemplate): Promise<DocTemplate> {
    const t: DocTemplate = {
      id: randomUUID(), categoria: "Geral", docxBase64: null, docxFilename: null, ...template,
    };
    this.data.docTemplates.push(t);
    this._scheduleSave();
    return t;
  }
  async updateDocTemplate(id: string, template: InsertDocTemplate) {
    const idx = this.data.docTemplates.findIndex(t => t.id === id);
    if (idx === -1) return undefined;
    this.data.docTemplates[idx] = { ...this.data.docTemplates[idx], ...template };
    this._scheduleSave();
    return this.data.docTemplates[idx];
  }
  async deleteDocTemplate(id: string) {
    this.data.docTemplates = this.data.docTemplates.filter(t => t.id !== id);
    this._scheduleSave();
  }

  // ── Shared Pareceres ────────────────────────────────────────────────────────
  async getSharedParecer(id: string) { return this.data.sharedPareceres.find(p => p.id === id); }
  async createSharedParecer(id: string, html: string, processo: string): Promise<SharedParecer> {
    const p: SharedParecer = { id, html, processo, createdAt: new Date() };
    this.data.sharedPareceres.push(p);
    this._scheduleSave();
    return p;
  }

  // ── Processos Monitorados ───────────────────────────────────────────────────
  async getProcessosMonitorados() { return [...this.data.processosMonitorados]; }
  async createProcessoMonitorado(p: InsertProcessoMonitorado): Promise<ProcessoMonitorado> {
    const pm: ProcessoMonitorado = {
      id: randomUUID(), apelido: "", classe: "", orgaoJulgador: "",
      dataAjuizamento: "", ultimaMovimentacao: "", ultimaMovimentacaoData: "",
      assuntos: "", status: "ativo", createdAt: new Date(), updatedAt: new Date(),
      ...p,
    };
    this.data.processosMonitorados.push(pm);
    this._scheduleSave();
    return pm;
  }
  async updateProcessoMonitorado(id: string, data: Partial<InsertProcessoMonitorado>) {
    const idx = this.data.processosMonitorados.findIndex(p => p.id === id);
    if (idx === -1) return undefined;
    this.data.processosMonitorados[idx] = { ...this.data.processosMonitorados[idx], ...data, updatedAt: new Date() };
    this._scheduleSave();
    return this.data.processosMonitorados[idx];
  }
  async deleteProcessoMonitorado(id: string) {
    this.data.processosMonitorados = this.data.processosMonitorados.filter(p => p.id !== id);
    this._scheduleSave();
  }

  // ── Settings ────────────────────────────────────────────────────────────────
  async getSetting(key: string): Promise<string | null> {
    if (isAiKey(key)) {
      // 🔧 28/10: antes chamava getLocalConfig() sem a chave e quebrava ("Cannot read … of null")
      return getLocalConfig(key as keyof LocalConfig) ?? null;
    }
    return this.data.settings[key] ?? null;
  }
  async setSetting(key: string, value: string): Promise<void> {
    if (isAiKey(key)) {
      // 🔧 28/10: antes mandava o objeto inteiro no lugar da chave e a chave de IA não era salva
      setLocalConfig(key as keyof LocalConfig, value);
    } else {
      this.data.settings[key] = value;
      this._scheduleSave();
    }
  }

  // ── Tramitação ──────────────────────────────────────────────────────────────
  async getTramitacaoPublicacoes(limit = 100) {
    return [...this.data.tramitacaoPublicacoes]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }
  async upsertTramitacaoPublicacao(data: Omit<TramitacaoPublicacao, 'id' | 'lida' | 'createdAt'>): Promise<TramitacaoPublicacao> {
    const existing = this.data.tramitacaoPublicacoes.find(p => p.extId === data.extId);
    if (existing) {
      Object.assign(existing, data);
      this._scheduleSave();
      return existing;
    }
    const p: TramitacaoPublicacao = { id: randomUUID(), lida: "nao", createdAt: new Date(), ...data };
    this.data.tramitacaoPublicacoes.unshift(p);
    if (this.data.tramitacaoPublicacoes.length > 1000) {
      this.data.tramitacaoPublicacoes = this.data.tramitacaoPublicacoes.slice(0, 1000);
    }
    this._scheduleSave();
    return p;
  }
  async markPublicacaoLida(id: string, lida: string) {
    const p = this.data.tramitacaoPublicacoes.find(x => x.id === id);
    if (p) { p.lida = lida; this._scheduleSave(); }
  }
}
