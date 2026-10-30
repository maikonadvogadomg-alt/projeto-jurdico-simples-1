import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, real, jsonb, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const snippets = pgTable("snippets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull().default("Untitled"),
  html: text("html").notNull().default(""),
  css: text("css").notNull().default(""),
  js: text("js").notNull().default(""),
  mode: text("mode").notNull().default("html"),
});

export const customActions = pgTable("custom_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  label: text("label").notNull(),
  description: text("description").notNull().default(""),
  prompt: text("prompt").notNull(),
});

export const ementas = pgTable("ementas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  titulo: text("titulo").notNull(),
  categoria: text("categoria").notNull().default("Geral"),
  texto: text("texto").notNull(),
});

export const aiHistory = pgTable("ai_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  action: text("action").notNull(),
  inputPreview: text("input_preview").notNull().default(""),
  result: text("result").notNull(),
  model: text("model").default(""),
  provider: text("provider").default(""),
  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),
  estimatedCost: real("estimated_cost").default(0),
  chatHistory: jsonb("chat_history").$type<Array<{ role: string; content: string }>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const promptTemplates = pgTable("prompt_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  titulo: text("titulo").notNull(),
  categoria: text("categoria").notNull().default("Geral"),
  texto: text("texto").notNull(),
});

export const docTemplates = pgTable("doc_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  titulo: text("titulo").notNull(),
  categoria: text("categoria").notNull().default("Geral"),
  conteudo: text("conteudo").notNull(),
  docxBase64: text("docx_base64"),
  docxFilename: text("docx_filename"),
});

export const sharedPareceres = pgTable("shared_pareceres", {
  id: varchar("id").primaryKey(),
  html: text("html").notNull(),
  processo: text("processo").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const processosMonitorados = pgTable("processos_monitorados", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  numero: text("numero").notNull(),
  tribunal: text("tribunal").notNull(),
  apelido: text("apelido").notNull().default(""),
  classe: text("classe").notNull().default(""),
  orgaoJulgador: text("orgao_julgador").notNull().default(""),
  dataAjuizamento: text("data_ajuizamento").notNull().default(""),
  ultimaMovimentacao: text("ultima_movimentacao").notNull().default(""),
  ultimaMovimentacaoData: text("ultima_movimentacao_data").notNull().default(""),
  assuntos: text("assuntos").notNull().default(""),
  status: text("status").notNull().default("ativo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const tramitacaoPublicacoes = pgTable("tramitacao_publicacoes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  extId: text("ext_id").notNull().unique(),
  idempotencyKey: text("idempotency_key"),
  numeroProcesso: text("numero_processo").notNull().default(""),
  numeroProcessoMascara: text("numero_processo_mascara").notNull().default(""),
  tribunal: text("tribunal").notNull().default(""),
  orgao: text("orgao").notNull().default(""),
  classe: text("classe").notNull().default(""),
  texto: text("texto").notNull().default(""),
  disponibilizacaoDate: text("disponibilizacao_date").notNull().default(""),
  publicacaoDate: text("publicacao_date").notNull().default(""),
  inicioPrazoDate: text("inicio_prazo_date").notNull().default(""),
  linkTramitacao: text("link_tramitacao").notNull().default(""),
  linkTribunal: text("link_tribunal").notNull().default(""),
  destinatarios: text("destinatarios").notNull().default("[]"),
  advogados: text("advogados").notNull().default("[]"),
  lida: text("lida").notNull().default("nao"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const escritorios = pgTable("escritorios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  nome: text("nome").notNull(),
  cnpj: text("cnpj").notNull().default(""),
  oab: text("oab").notNull().default(""),
  endereco: text("endereco").notNull().default(""),
  telefone: text("telefone").notNull().default(""),
  email: text("email").notNull().default(""),
  logo: text("logo").default(""),
  configJson: jsonb("config_json").$type<Record<string, string>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const escritorioUsers = pgTable("escritorio_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  escritorioId: varchar("escritorio_id").notNull(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().default(""),
  passwordHash: text("password_hash").notNull(),
  nome: text("nome").notNull().default(""),
  role: text("role").notNull().default("advogado"), // admin | advogado | estagiario | secretaria
  oab: text("oab").notNull().default(""),
  ativo: text("ativo").notNull().default("sim"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const prazos = pgTable("prazos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  titulo: text("titulo").notNull(),
  descricao: text("descricao").notNull().default(""),
  numeroProcesso: text("numero_processo").notNull().default(""),
  tribunal: text("tribunal").notNull().default(""),
  dataVencimento: timestamp("data_vencimento").notNull(),
  tipo: text("tipo").notNull().default("prazo"), // prazo | audiencia | reuniao | pericia
  status: text("status").notNull().default("pendente"), // pendente | cumprido | vencido
  prioridade: text("prioridade").notNull().default("normal"), // baixa | normal | alta | urgente
  responsavel: text("responsavel").notNull().default(""),
  notificacaoEnviada: text("notificacao_enviada").notNull().default("nao"),
  antecedenciaHoras: integer("antecedencia_horas").notNull().default(24),
  userId: varchar("user_id"),
  escritorioId: varchar("escritorio_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const fcmTokens = pgTable("fcm_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: text("token").notNull().unique(),
  userId: varchar("user_id"),
  dispositivo: text("dispositivo").notNull().default("web"),
  ativo: text("ativo").notNull().default("sim"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const docsSincronizados = pgTable("docs_sincronizados", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  titulo: text("titulo").notNull(),
  conteudoHtml: text("conteudo_html").notNull().default(""),
  driveFileId: text("drive_file_id").default(""),
  driveUrl: text("drive_url").default(""),
  tipo: text("tipo").notNull().default("peticao"),
  numeroProcesso: text("numero_processo").notNull().default(""),
  userId: varchar("user_id"),
  escritorioId: varchar("escritorio_id"),
  syncStatus: text("sync_status").notNull().default("local"), // local | synced | conflict
  checksum: text("checksum").default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const assinaturasDigitais = pgTable("assinaturas_digitais", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  docId: varchar("doc_id"),
  docTitulo: text("doc_titulo").notNull().default(""),
  signatario: text("signatario").notNull(),
  cpf: text("cpf").notNull().default(""),
  oab: text("oab").notNull().default(""),
  provider: text("provider").notNull().default("birdid"), // birdid | vidaas | iti
  hashDocumento: text("hash_documento").notNull(),
  assinaturaBase64: text("assinatura_base64"),
  certificadoBase64: text("certificado_base64"),
  status: text("status").notNull().default("pendente"), // pendente | assinado | rejeitado | erro
  birdidToken: text("birdid_token"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const templateVarDefs = pgTable("template_var_defs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull(),
  variavel: text("variavel").notNull(), // ex: {{NOME_PARTE}}
  label: text("label").notNull(),       // ex: "Nome da Parte"
  tipo: text("tipo").notNull().default("texto"), // texto | data | numero | oab | cnpj
  defaultValue: text("default_value").notNull().default(""),
});

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull().default("Nova Conversa"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({ username: true, password: true });
export const insertSnippetSchema = createInsertSchema(snippets).pick({ title: true, html: true, css: true, js: true, mode: true });
export const insertCustomActionSchema = createInsertSchema(customActions).pick({ label: true, description: true, prompt: true });
export const insertEmentaSchema = createInsertSchema(ementas).pick({ titulo: true, categoria: true, texto: true });
export const insertAiHistorySchema = createInsertSchema(aiHistory).pick({ action: true, inputPreview: true, result: true, model: true, provider: true, inputTokens: true, outputTokens: true, estimatedCost: true, chatHistory: true });
export const insertPromptTemplateSchema = createInsertSchema(promptTemplates).pick({ titulo: true, categoria: true, texto: true });
export const insertDocTemplateSchema = createInsertSchema(docTemplates).pick({ titulo: true, categoria: true, conteudo: true, docxBase64: true, docxFilename: true });
export const insertProcessoMonitoradoSchema = createInsertSchema(processosMonitorados).pick({ numero: true, tribunal: true, apelido: true, classe: true, orgaoJulgador: true, dataAjuizamento: true, ultimaMovimentacao: true, ultimaMovimentacaoData: true, assuntos: true, status: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertSnippet = z.infer<typeof insertSnippetSchema>;
export type Snippet = typeof snippets.$inferSelect;
export type InsertCustomAction = z.infer<typeof insertCustomActionSchema>;
export type CustomAction = typeof customActions.$inferSelect;
export type InsertEmenta = z.infer<typeof insertEmentaSchema>;
export type Ementa = typeof ementas.$inferSelect;
export type InsertAiHistory = z.infer<typeof insertAiHistorySchema>;
export type AiHistory = typeof aiHistory.$inferSelect;
export type InsertPromptTemplate = z.infer<typeof insertPromptTemplateSchema>;
export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type InsertDocTemplate = z.infer<typeof insertDocTemplateSchema>;
export type DocTemplate = typeof docTemplates.$inferSelect;
export type SharedParecer = typeof sharedPareceres.$inferSelect;
export type InsertProcessoMonitorado = z.infer<typeof insertProcessoMonitoradoSchema>;
export type ProcessoMonitorado = typeof processosMonitorados.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
export type TramitacaoPublicacao = typeof tramitacaoPublicacoes.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
