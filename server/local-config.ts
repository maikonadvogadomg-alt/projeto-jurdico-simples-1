import fs from "fs";
import path from "path";

const CONFIG_FILE = path.join(process.cwd(), "config.local.json");

export type LocalConfig = {
  database_url?: string;
  gemini_api_key?: string;
  openai_api_key?: string;
  groq_api_key?: string;
  perplexity_api_key?: string;
  anthropic_api_key?: string;
  mistral_api_key?: string;
  cohere_api_key?: string;
  openrouter_api_key?: string;
  together_api_key?: string;
  xai_api_key?: string;
  demo_api_key?: string;
  demo_api_url?: string;
  demo_api_model?: string;
  app_password?: string;
  session_secret?: string;
  datajud_api_key?: string;
  custom_api_key?: string;
  custom_model?: string;
  custom_base_url?: string;
  google_drive_folder_id?: string;
  google_drive_access_token?: string;
  google_drive_client_id?: string;
  google_drive_client_secret?: string;
  esaj_login?: string;
  esaj_password?: string;
  projudi_login?: string;
  projudi_password?: string;
  seeu_login?: string;
  seeu_password?: string;
  eproc_login?: string;
  eproc_password?: string;
  pjud_login?: string;
  pjud_password?: string;
  word_template_header?: string;
  ocr_provider?: string;
  google_vision_api_key?: string;
  // v1.4.0 — FCM Push Notifications
  fcm_server_key?: string;
  fcm_project_id?: string;
  fcm_vapid_key?: string;
  // v1.4.0 — BirdID (Soluti) Digital Signature
  birdid_client_id?: string;
  birdid_client_secret?: string;
  // v1.4.0 — VIDaaS Digital Signature
  vidaas_client_id?: string;
  vidaas_client_secret?: string;
  // v1.4.0 — JWT Auth
  jwt_secret?: string;
  // v1.4.0 — Drive OAuth2 full flow
  google_drive_refresh_token?: string;
  google_oauth_client_id?: string;
  google_oauth_client_secret?: string;
};

export const ALL_CONFIG_KEYS: (keyof LocalConfig)[] = [
  "database_url", "gemini_api_key", "openai_api_key", "groq_api_key",
  "perplexity_api_key", "anthropic_api_key", "mistral_api_key", "cohere_api_key",
  "openrouter_api_key", "together_api_key", "xai_api_key",
  "demo_api_key", "demo_api_url", "demo_api_model",
  "app_password", "session_secret", "datajud_api_key",
  "custom_api_key", "custom_model", "custom_base_url",
  "google_drive_folder_id", "google_drive_access_token",
  "google_drive_client_id", "google_drive_client_secret",
  "esaj_login", "esaj_password", "projudi_login", "projudi_password",
  "seeu_login", "seeu_password", "eproc_login", "eproc_password",
  "pjud_login", "pjud_password",
  "word_template_header", "ocr_provider", "google_vision_api_key",
  // v1.4.0
  "fcm_server_key", "fcm_project_id", "fcm_vapid_key",
  "birdid_client_id", "birdid_client_secret",
  "vidaas_client_id", "vidaas_client_secret",
  "jwt_secret",
  "google_drive_refresh_token", "google_oauth_client_id", "google_oauth_client_secret",
];

// Mapeamento de prefixo de chave → campo de configuração (auto-detect)
const KEY_PREFIX_MAP: Array<{ prefix: string; field: keyof LocalConfig; label: string; baseUrl?: string }> = [
  { prefix: "AIza",        field: "gemini_api_key",      label: "Google Gemini",     baseUrl: "" },
  { prefix: "sk-ant-",     field: "anthropic_api_key",   label: "Anthropic Claude",  baseUrl: "https://api.anthropic.com/v1" },
  { prefix: "sk-or-",      field: "openrouter_api_key",  label: "OpenRouter",        baseUrl: "https://openrouter.ai/api/v1" },
  { prefix: "sk-proj-",    field: "openai_api_key",      label: "OpenAI",            baseUrl: "https://api.openai.com/v1" },
  { prefix: "sk-",         field: "openai_api_key",      label: "OpenAI",            baseUrl: "https://api.openai.com/v1" },
  { prefix: "gsk_",        field: "groq_api_key",        label: "Groq",              baseUrl: "https://api.groq.com/openai/v1" },
  { prefix: "pplx-",       field: "perplexity_api_key",  label: "Perplexity",        baseUrl: "https://api.perplexity.ai" },
  { prefix: "xai-",        field: "xai_api_key",         label: "xAI (Grok)",        baseUrl: "https://api.x.ai/v1" },
  { prefix: "together-",   field: "together_api_key",    label: "Together AI",       baseUrl: "https://api.together.xyz/v1" },
  { prefix: "mistral",     field: "mistral_api_key",     label: "Mistral",           baseUrl: "https://api.mistral.ai/v1" },
  { prefix: "cohere-",     field: "cohere_api_key",      label: "Cohere",            baseUrl: "https://api.cohere.ai/v1" },
  { prefix: "cDZH",        field: "datajud_api_key",     label: "DataJud CNJ",       baseUrl: "" },
  { prefix: "ApiKey ",     field: "datajud_api_key",     label: "DataJud CNJ",       baseUrl: "" },
];

/** Detecta automaticamente qual provedor uma chave pertence pelo seu prefixo */
export function detectKeyProvider(key: string): {
  field: keyof LocalConfig;
  label: string;
  baseUrl?: string;
} | null {
  const trimmed = key.trim();
  for (const entry of KEY_PREFIX_MAP) {
    if (trimmed.startsWith(entry.prefix)) {
      return { field: entry.field, label: entry.label, baseUrl: entry.baseUrl };
    }
  }
  return null;
}

/** Rota/URL base padrão para cada provedor de IA */
export const PROVIDER_BASE_URLS: Record<keyof LocalConfig, string> = {
  gemini_api_key: "https://generativelanguage.googleapis.com/v1beta",
  openai_api_key: "https://api.openai.com/v1",
  anthropic_api_key: "https://api.anthropic.com/v1",
  groq_api_key: "https://api.groq.com/openai/v1",
  perplexity_api_key: "https://api.perplexity.ai",
  mistral_api_key: "https://api.mistral.ai/v1",
  cohere_api_key: "https://api.cohere.ai/v1",
  openrouter_api_key: "https://openrouter.ai/api/v1",
  together_api_key: "https://api.together.xyz/v1",
  xai_api_key: "https://api.x.ai/v1",
  datajud_api_key: "https://api-publica.datajud.cnj.jus.br",
  google_drive_access_token: "https://www.googleapis.com/drive/v3",
  google_vision_api_key: "https://vision.googleapis.com/v1",
} as any;

export function readLocalConfig(): LocalConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {}
  return {};
}

export function writeLocalConfig(config: LocalConfig): void {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (e) {
    console.warn("[local-config] Erro ao salvar config:", e);
  }
}

export function getLocalConfig(key: keyof LocalConfig): string | null {
  return readLocalConfig()[key] || null;
}

export function setLocalConfig(key: keyof LocalConfig, value: string): void {
  const config = readLocalConfig();
  (config as any)[key] = value;
  writeLocalConfig(config);
}

export function isConfigKey(key: string): key is keyof LocalConfig {
  return ALL_CONFIG_KEYS.includes(key as keyof LocalConfig);
}

export function applyLocalConfigToEnv(): void {
  const cfg = readLocalConfig();
  if (cfg.database_url) process.env.DATABASE_URL = cfg.database_url;
  if (cfg.app_password) process.env.APP_PASSWORD = cfg.app_password;
  if (cfg.session_secret) process.env.SESSION_SECRET = cfg.session_secret;
  if (cfg.datajud_api_key) process.env.DATAJUD_API_KEY = cfg.datajud_api_key;
  if (cfg.google_drive_access_token) process.env.GOOGLE_DRIVE_TOKEN = cfg.google_drive_access_token;
  if (cfg.google_drive_folder_id) process.env.GOOGLE_DRIVE_FOLDER_ID = cfg.google_drive_folder_id;
}

// Alias para compatibilidade
export const isAiKey = isConfigKey;
