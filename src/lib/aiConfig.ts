// AI provider selection and API keys: localStorage + optional Supabase row for cross-device sync.
// Gemini always uses process.env.GEMINI_API_KEY from the environment (unchanged).

import { isSupabaseConfigured, supabase } from './supabase';

export type AIProvider = 'gemini' | 'nvidiaNim' | 'openai' | 'groq' | 'claude';

// Priority: Gemini first; NVIDIA NIM; then Groq, OpenAI, Claude
export const PROVIDER_PRIORITY: AIProvider[] = ['gemini', 'nvidiaNim', 'groq', 'openai', 'claude'];

export interface AIConfig {
  provider: AIProvider;
  enableMultiModel: boolean;
  openaiApiKey: string;
  groqApiKey: string;
  claudeApiKey: string;
  /** NVIDIA NIM API key */
  nvidiaNimApiKey: string;
  /** NIM chat model id (e.g. google/gemma-2-27b-it, meta/llama-3.3-70b-instruct) */
  nvidiaNimModel: string;
  /** Custom multi-model fallback order (drag-reorder in Admin). Normalized on read. */
  providerPriorityOrder?: AIProvider[];
  /** Providers temporarily turned off in Admin (still keep API keys). */
  disabledProviders?: AIProvider[];
}

const STORAGE_KEY = 'sonic_lens_ai_config';

/** Supabase table: see supabase_ai_app_config.sql */
export const AI_APP_CONFIG_TABLE = 'ai_app_config';
export const AI_APP_CONFIG_ROW_ID = 'default';

export const AI_CONFIG_SYNC_EVENT = 'sonic-lens-ai-config-loaded';

const DEFAULT_CONFIG: AIConfig = {
  provider: 'gemini',
  enableMultiModel: false,
  openaiApiKey: '',
  groqApiKey: '',
  claudeApiKey: '',
  nvidiaNimApiKey: '',
  /** Google Gemma on NIM (not Gemini API). Closest "Google-like" option on integrate.api.nvidia.com */
  nvidiaNimModel: 'google/gemma-2-27b-it',
  disabledProviders: [],
};

const ALL_PROVIDERS: AIProvider[] = ['gemini', 'nvidiaNim', 'groq', 'openai', 'claude'];

function normalizeDisabledProviders(raw: unknown): AIProvider[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is AIProvider => typeof x === 'string' && ALL_PROVIDERS.includes(x as AIProvider));
}

/** Merge plain object into a full AIConfig (used for localStorage + Supabase JSON). */
export function configFromPlainObject(raw: Record<string, unknown>): AIConfig {
  delete raw.zenApiKey;
  delete raw.zenModelId;
  const validProviders: AIProvider[] = ['gemini', 'nvidiaNim', 'groq', 'openai', 'claude'];
  if (typeof raw.provider !== 'string' || !validProviders.includes(raw.provider as AIProvider)) {
    raw.provider = 'gemini';
  }
  const merged = { ...DEFAULT_CONFIG, ...raw } as AIConfig;
  merged.disabledProviders = normalizeDisabledProviders(merged.disabledProviders);
  return merged;
}

/** Persist full config to localStorage only (no remote write). */
export function saveAIConfigToLocalStorage(full: AIConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(full));
  } catch {
    /* ignore quota */
  }
}

export function getAIConfig(): AIConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      return configFromPlainObject(parsed);
    }
  } catch {
    // ignore parse errors, return defaults
  }
  return { ...DEFAULT_CONFIG };
}

/** Merge partial into current, save locally, then upsert to Supabase (best-effort). */
export function saveAIConfig(config: Partial<AIConfig>): void {
  const current = getAIConfig();
  const next = { ...current, ...config } as AIConfig;
  saveAIConfigToLocalStorage(next);
  void upsertAIConfigRemote(next);
}

/** Same as saveAIConfig but await remote; use from Admin to surface errors. */
export async function saveAIConfigAndWaitRemote(config: Partial<AIConfig>): Promise<{ ok: boolean; error?: string }> {
  const current = getAIConfig();
  const next = { ...current, ...config } as AIConfig;
  saveAIConfigToLocalStorage(next);
  return upsertAIConfigRemote(next);
}

async function upsertAIConfigRemote(full: AIConfig): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) {
    return { ok: true };
  }
  const { error } = await supabase.from(AI_APP_CONFIG_TABLE).upsert(
    {
      id: AI_APP_CONFIG_ROW_ID,
      config: full as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) {
    console.error('[aiConfig] Supabase upsert failed:', error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Load shared config from Supabase into localStorage.
 * Call once after app unlocks. Returns true if a remote row was applied.
 */
export async function syncAIConfigFromSupabase(): Promise<boolean> {
  if (!isSupabaseConfigured) {
    return false;
  }
  const { data, error } = await supabase
    .from(AI_APP_CONFIG_TABLE)
    .select('config')
    .eq('id', AI_APP_CONFIG_ROW_ID)
    .maybeSingle();

  if (error) {
    console.warn('[aiConfig] Supabase fetch failed:', error.message);
    return false;
  }

  const blob = data?.config;
  if (blob == null || typeof blob !== 'object' || Array.isArray(blob)) {
    return false;
  }

  const next = configFromPlainObject(blob as Record<string, unknown>);
  saveAIConfigToLocalStorage(next);
  return true;
}

/** Ensure order contains every provider exactly once */
export function normalizeProviderPriority(order: unknown): AIProvider[] {
  if (!Array.isArray(order)) return [...PROVIDER_PRIORITY];
  const seen = new Set<AIProvider>();
  const out: AIProvider[] = [];
  for (const x of order) {
    if (typeof x === 'string' && ALL_PROVIDERS.includes(x as AIProvider) && !seen.has(x as AIProvider)) {
      seen.add(x as AIProvider);
      out.push(x as AIProvider);
    }
  }
  for (const p of ALL_PROVIDERS) {
    if (!seen.has(p)) out.push(p);
  }
  return out;
}

/** Effective multi-model chain (saved order or default) */
export function getProviderPriority(config?: AIConfig): AIProvider[] {
  const c = config || getAIConfig();
  return normalizeProviderPriority(c.providerPriorityOrder);
}

/** True if provider is not soft-disabled in Admin (independent of API keys). */
export function isProviderEnabled(provider: AIProvider, config?: AIConfig): boolean {
  const c = config || getAIConfig();
  const off = c.disabledProviders ?? [];
  return !off.includes(provider);
}

/** Key/env present (ignores Admin on/off toggle). For labels in settings UI. */
export function providerHasCredentials(provider: AIProvider, config?: AIConfig): boolean {
  const c = config || getAIConfig();
  return hasProviderCredentials(provider, c);
}

function hasProviderCredentials(provider: AIProvider, config: AIConfig): boolean {
  switch (provider) {
    case 'gemini': return !!process.env.GEMINI_API_KEY;
    case 'nvidiaNim': return !!config.nvidiaNimApiKey?.trim();
    case 'openai': return !!config.openaiApiKey?.trim();
    case 'groq': return !!config.groqApiKey?.trim();
    case 'claude': return !!config.claudeApiKey?.trim() && (!!config.groqApiKey?.trim() || !!config.openaiApiKey?.trim());
    default: return false;
  }
}

/** Credentials configured AND provider not paused in Admin */
export function isProviderAvailable(provider: AIProvider, config?: AIConfig): boolean {
  const c = config || getAIConfig();
  if (!isProviderEnabled(provider, c)) return false;
  return hasProviderCredentials(provider, c);
}

export const OPENAI_API_KEYS_URL = 'https://platform.openai.com/api-keys';
export const GEMINI_API_KEYS_URL = 'https://aistudio.google.com/app/apikey';
export const GROQ_API_KEYS_URL = 'https://console.groq.com/keys';
export const CLAUDE_API_KEYS_URL = 'https://console.anthropic.com/settings/keys';
export const NVIDIA_NIM_EXPLORE_URL = 'https://build.nvidia.com/';
