// Manages AI provider selection and API keys stored in localStorage.
// Gemini always uses process.env.GEMINI_API_KEY from the environment (unchanged).
// Other provider keys are entered manually and stored here.

export type AIProvider = 'gemini' | 'openai' | 'groq' | 'claude';

// Priority order for multi-model fallback
export const PROVIDER_PRIORITY: AIProvider[] = ['gemini', 'groq', 'openai', 'claude'];

export interface AIConfig {
  provider: AIProvider;
  enableMultiModel: boolean;
  openaiApiKey: string;
  groqApiKey: string;
  claudeApiKey: string;
}

const STORAGE_KEY = 'sonic_lens_ai_config';

const DEFAULT_CONFIG: AIConfig = {
  provider: 'gemini',
  enableMultiModel: false,
  openaiApiKey: '',
  groqApiKey: '',
  claudeApiKey: '',
};

export function getAIConfig(): AIConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    }
  } catch {
    // ignore parse errors, return defaults
  }
  return { ...DEFAULT_CONFIG };
}

export function saveAIConfig(config: Partial<AIConfig>): void {
  const current = getAIConfig();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...config }));
}

// Check if a provider has valid credentials configured
export function isProviderAvailable(provider: AIProvider, config?: AIConfig): boolean {
  const c = config || getAIConfig();
  switch (provider) {
    case 'gemini': return !!process.env.GEMINI_API_KEY;
    case 'openai': return !!c.openaiApiKey;
    case 'groq': return !!c.groqApiKey;
    case 'claude': return !!c.claudeApiKey && (!!c.groqApiKey || !!c.openaiApiKey);
    default: return false;
  }
}

export const OPENAI_API_KEYS_URL = 'https://platform.openai.com/api-keys';
export const GEMINI_API_KEYS_URL = 'https://aistudio.google.com/app/apikey';
export const GROQ_API_KEYS_URL = 'https://console.groq.com/keys';
export const CLAUDE_API_KEYS_URL = 'https://console.anthropic.com/settings/keys';
