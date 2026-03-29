// Transcription router - delegates to Gemini, OpenAI, Groq, or Claude based on user config.
// Supports multi-model fallback: tries providers in priority order, skips on failure.
// HYBRID MODE (multi-model): Whisper STT (free) -> Gemini text-only (saves ~80% tokens)
// gemini.ts is NOT modified - this file wraps it.

import { transcribeAudio as transcribeWithGemini } from './gemini';
import { GoogleGenAI } from "@google/genai";
import { getAIConfig, isProviderAvailable, PROVIDER_PRIORITY, type AIProvider } from '../lib/aiConfig';

// Shared prompt for structuring transcript (used by OpenAI, Groq, Claude)
const STRUCTURING_SYSTEM_PROMPT = `You are a professional meeting transcript specialist.
Given raw transcript text (primarily Vietnamese), structure it into speaker-diarized JSON.
Identify different speakers, guess gender (Nam/Nu/Khong ro), assign timestamps from 00:00.
Return ONLY valid JSON:
{
  "transcript": [
    { "speaker": "Speaker 1", "gender": "Nam/Nu/Khong ro", "text": "...", "timestamp": "mm:ss", "isUncertain": false }
  ],
  "summary": "Brief summary in Vietnamese."
}`;

// Helper: convert base64 audio to Blob + determine extension
function audioBase64ToBlob(base64Audio: string, mimeType: string) {
  const byteCharacters = atob(base64Audio);
  const byteArray = new Uint8Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteArray[i] = byteCharacters.charCodeAt(i);
  }

  let ext = 'webm';
  if (mimeType.includes('wav')) ext = 'wav';
  else if (mimeType.includes('mp4')) ext = 'mp4';
  else if (mimeType.includes('mpeg')) ext = 'mp3';
  else if (mimeType.includes('m4a') || mimeType.includes('x-m4a')) ext = 'm4a';

  const blob = new Blob([byteArray], { type: mimeType });
  return { blob, ext };
}

// ──────────────────────────────────────────────
// WHISPER STT (Speech-to-Text only, no structuring)
// Priority: Groq (free) > OpenAI (paid)
// Returns raw text string
// ──────────────────────────────────────────────
async function whisperSTT(base64Audio: string, mimeType: string): Promise<{ text: string; sttProvider: string }> {
  const config = getAIConfig();
  const { blob: audioBlob, ext } = audioBase64ToBlob(base64Audio, mimeType);

  // Try Groq Whisper first (free)
  if (config.groqApiKey && !disabledProviders.has('groq')) {
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, `audio.${ext}`);
      formData.append('model', 'whisper-large-v3');
      formData.append('response_format', 'verbose_json');
      formData.append('language', 'vi');

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.groqApiKey}` },
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        console.log('[Hybrid] STT completed via Groq Whisper');
        
        // Extract raw text with timestamps: [mm:ss] text
        let formattedText = data.text || '';
        if (data.segments) {
          formattedText = data.segments.map((s: any) => {
            const m = Math.floor(s.start / 60);
            const sec = Math.floor(s.start % 60);
            const ts = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
            return `[${ts}] ${s.text}`;
          }).join('\n');
        }
        
        return { text: formattedText, sttProvider: 'groq-whisper' };
      }

      const errData = await res.json().catch(() => ({}));
      const errMsg = errData?.error?.message || res.statusText;
      console.warn('[Hybrid] Groq Whisper failed:', errMsg);
      if (shouldDisableProvider(errMsg)) {
        disabledProviders.add('groq');
        console.warn('[Hybrid] Groq BLACKLISTED for STT');
      }
    } catch (err: any) {
      console.warn('[Hybrid] Groq Whisper error:', err.message);
    }
  }

  // Fallback: OpenAI Whisper (paid)
  if (config.openaiApiKey && !disabledProviders.has('openai')) {
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, `audio.${ext}`);
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'verbose_json');
      formData.append('language', 'vi');

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.openaiApiKey}` },
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        console.log('[Hybrid] STT completed via OpenAI Whisper');
        
        // Extract raw text with timestamps: [mm:ss] text
        let formattedText = data.text || '';
        if (data.segments) {
          formattedText = data.segments.map((s: any) => {
            const m = Math.floor(s.start / 60);
            const sec = Math.floor(s.start % 60);
            const ts = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
            return `[${ts}] ${s.text}`;
          }).join('\n');
        }

        return { text: formattedText, sttProvider: 'openai-whisper' };
      }

      const errData = await res.json().catch(() => ({}));
      console.warn('[Hybrid] OpenAI Whisper failed:', errData?.error?.message || res.statusText);
    } catch (err: any) {
      console.warn('[Hybrid] OpenAI Whisper error:', err.message);
    }
  }

  throw new Error('No Whisper STT service available. Need Groq or OpenAI key.');
}

// ──────────────────────────────────────────────
// GEMINI TEXT-ONLY STRUCTURING (no audio, saves ~80% tokens)
// Uses gemini-2.5-flash for text structuring only (20 RPD free tier)
// ──────────────────────────────────────────────
async function structureWithGemini(rawText: string): Promise<any> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY in environment.');
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

  const prompt = `Ban la mot chuyen gia ghi chep bien ban cuoc hop chuyen nghiep.
Hay phan tich doan van ban duoi day (da duoc Whisper STT chuyen tu giong noi sang chu kem timestamp [mm:ss]) va cau truc lai thanh JSON.

YEU CAU:
1. Phan biet cac nguoi noi khac nhau (Speaker 1, Speaker 2...).
2. Doan gioi tinh cua nguoi noi (Nam/Nu/Khong ro).
3. Ghi nhan chinh xac noi dung hoi thoai.
4. GIU NGUYEN CHINH XAC TIMESTAMP [mm:ss] tu input vao field "timestamp". Khong duoc tu y thay doi thoi gian.
5. Danh dau "isUncertain": true cho nhung doan khong ro rang.
6. Tom tat ngan gon cac y chinh.

Dinh dang ket qua tra ve BAT BUOC la JSON:
{
  "transcript": [
    { "speaker": "Tên người nói", "gender": "Nam/Nữ/Không rõ", "text": "...", "timestamp": "mm:ss", "isUncertain": false }
  ],
  "summary": "Tóm tắt ngắn gọn nội dung."
}

NOI DUNG CAN PHAN TICH:
${rawText}`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ parts: [{ text: prompt }] }],
    config: { responseMimeType: "application/json" }
  });

  const text = response.text;
  console.log('[Hybrid] Gemini text structuring completed (no audio sent, ~80% token savings)');
  return JSON.parse(text);
}

// ──────────────────────────────────────────────
// HYBRID PIPELINE: Whisper STT (free) -> LLM text structuring (cheap)
// ──────────────────────────────────────────────
async function transcribeHybrid(base64Audio: string, mimeType: string): Promise<any> {
  // Step 1: Free STT via Whisper
  const { text: rawText, sttProvider } = await whisperSTT(base64Audio, mimeType);

  if (!rawText.trim()) {
    return {
      transcript: [{ speaker: 'System', gender: 'Khong ro', text: '[No speech detected]', timestamp: '00:00', isUncertain: true }],
      summary: 'No content detected.',
      _usedProvider: `hybrid(${sttProvider}+none)`
    };
  }

  // Step 2: Structure text with LLMs (try in order: Gemini text > Groq Llama > OpenAI GPT > Claude)
  const config = getAIConfig();
  let result: any;
  let structureProvider = '';

  // Try Gemini text-only first (cheapest - only text, no audio tokens)
  if (process.env.GEMINI_API_KEY && !disabledProviders.has('gemini')) {
    try {
      result = await structureWithGemini(rawText);
      structureProvider = 'gemini-text';
    } catch (err: any) {
      console.warn('[Hybrid] Gemini text structuring failed:', err.message);
      if (shouldDisableProvider(err.message)) {
        disabledProviders.add('gemini');
      }
    }
  }

  // Fallback: Groq Llama (free)
  if (!result && config.groqApiKey && !disabledProviders.has('groq')) {
    try {
      const llmRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.groqApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: STRUCTURING_SYSTEM_PROMPT },
            { role: 'user', content: `Structure this transcript:\n\n${rawText}` },
          ],
        }),
      });
      if (llmRes.ok) {
        const data = await llmRes.json();
        result = JSON.parse(data.choices?.[0]?.message?.content || '{}');
        structureProvider = 'groq-llama';
      }
    } catch (err: any) {
      console.warn('[Hybrid] Groq LLM structuring failed:', err.message);
    }
  }

  // Fallback: OpenAI GPT (paid)
  if (!result && config.openaiApiKey) {
    try {
      const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.openaiApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: STRUCTURING_SYSTEM_PROMPT },
            { role: 'user', content: `Structure this transcript:\n\n${rawText}` },
          ],
        }),
      });
      if (gptRes.ok) {
        const data = await gptRes.json();
        result = JSON.parse(data.choices?.[0]?.message?.content || '{}');
        structureProvider = 'openai-gpt';
      }
    } catch (err: any) {
      console.warn('[Hybrid] OpenAI GPT structuring failed:', err.message);
    }
  }

  if (!result) {
    throw new Error('Hybrid pipeline failed: STT succeeded but no LLM available for structuring.');
  }

  console.log(`[Hybrid] Complete: ${sttProvider} -> ${structureProvider}`);
  return { ...result, _usedProvider: `hybrid(${sttProvider}+${structureProvider})` };
}

// ──────────────────────────────────────────────
// OPENAI: Whisper + GPT-4o-mini (standalone)
// ──────────────────────────────────────────────
async function transcribeWithOpenAI(base64Audio: string, mimeType: string, apiKey: string) {
  const { blob: audioBlob, ext } = audioBase64ToBlob(base64Audio, mimeType);

  const formData = new FormData();
  formData.append('file', audioBlob, `audio.${ext}`);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('language', 'vi');

  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!whisperRes.ok) {
    const err = await whisperRes.json().catch(() => ({}));
    throw new Error(`OpenAI Whisper error: ${err?.error?.message || whisperRes.statusText}`);
  }

  const whisperData = await whisperRes.json();
  const rawText = whisperData.text || '';

  const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: STRUCTURING_SYSTEM_PROMPT },
        { role: 'user', content: `Structure this transcript:\n\n${rawText}` },
      ],
    }),
  });

  if (!gptRes.ok) {
    const err = await gptRes.json().catch(() => ({}));
    throw new Error(`OpenAI GPT error: ${err?.error?.message || gptRes.statusText}`);
  }

  const gptData = await gptRes.json();
  const content = gptData.choices?.[0]?.message?.content || '{}';
  console.log('OpenAI transcription completed');
  return JSON.parse(content);
}

// ──────────────────────────────────────────────
// GROQ: Whisper Large v3 (free) + Llama 3.3 (free) (standalone)
// ──────────────────────────────────────────────
async function transcribeWithGroq(base64Audio: string, mimeType: string, apiKey: string) {
  const { blob: audioBlob, ext } = audioBase64ToBlob(base64Audio, mimeType);

  const formData = new FormData();
  formData.append('file', audioBlob, `audio.${ext}`);
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'verbose_json');
  formData.append('language', 'vi');

  const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!whisperRes.ok) {
    const err = await whisperRes.json().catch(() => ({}));
    throw new Error(`Groq Whisper error: ${err?.error?.message || whisperRes.statusText}`);
  }

  const whisperData = await whisperRes.json();
  const rawText = whisperData.text || '';

  const llmRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: STRUCTURING_SYSTEM_PROMPT },
        { role: 'user', content: `Structure this transcript:\n\n${rawText}` },
      ],
    }),
  });

  if (!llmRes.ok) {
    const err = await llmRes.json().catch(() => ({}));
    throw new Error(`Groq LLM error: ${err?.error?.message || llmRes.statusText}`);
  }

  const llmData = await llmRes.json();
  const content = llmData.choices?.[0]?.message?.content || '{}';
  console.log('Groq transcription completed');
  return JSON.parse(content);
}

// ──────────────────────────────────────────────
// CLAUDE: Whisper STT -> Claude structuring (standalone)
// ──────────────────────────────────────────────
async function transcribeWithClaude(base64Audio: string, mimeType: string, claudeApiKey: string) {
  const config = getAIConfig();
  let rawText = '';

  if (config.groqApiKey) {
    const { blob: audioBlob, ext } = audioBase64ToBlob(base64Audio, mimeType);
    const formData = new FormData();
    formData.append('file', audioBlob, `audio.${ext}`);
    formData.append('model', 'whisper-large-v3');
    formData.append('response_format', 'verbose_json');
    formData.append('language', 'vi');

    const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.groqApiKey}` },
      body: formData,
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.json().catch(() => ({}));
      throw new Error(`Groq Whisper (for Claude) error: ${err?.error?.message || whisperRes.statusText}`);
    }
    const whisperData = await whisperRes.json();
    rawText = whisperData.text || '';
  } else if (config.openaiApiKey) {
    const { blob: audioBlob, ext } = audioBase64ToBlob(base64Audio, mimeType);
    const formData = new FormData();
    formData.append('file', audioBlob, `audio.${ext}`);
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');
    formData.append('language', 'vi');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
      body: formData,
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.json().catch(() => ({}));
      throw new Error(`OpenAI Whisper (for Claude) error: ${err?.error?.message || whisperRes.statusText}`);
    }
    const whisperData = await whisperRes.json();
    rawText = whisperData.text || '';
  } else {
    throw new Error('Claude cannot process audio directly. Please add a Groq API Key (free) or OpenAI API Key.');
  }

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': claudeApiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: STRUCTURING_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `Structure this transcript:\n\n${rawText}` },
      ],
    }),
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.json().catch(() => ({}));
    throw new Error(`Claude API error: ${err?.error?.message || claudeRes.statusText}`);
  }

  const claudeData = await claudeRes.json();
  const content = claudeData.content?.[0]?.text || '{}';
  console.log('Claude transcription completed');
  return JSON.parse(content);
}

// ──────────────────────────────────────────────
// Execute transcription for a specific provider (standalone mode)
// ──────────────────────────────────────────────
async function runProvider(provider: AIProvider, base64Audio: string, mimeType: string): Promise<any> {
  const config = getAIConfig();

  switch (provider) {
    case 'gemini':
      return transcribeWithGemini(base64Audio, mimeType);

    case 'openai':
      if (!config.openaiApiKey) throw new Error('Missing OpenAI API Key.');
      return transcribeWithOpenAI(base64Audio, mimeType, config.openaiApiKey);

    case 'groq':
      if (!config.groqApiKey) throw new Error('Missing Groq API Key.');
      return transcribeWithGroq(base64Audio, mimeType, config.groqApiKey);

    case 'claude':
      if (!config.claudeApiKey) throw new Error('Missing Claude API Key.');
      return transcribeWithClaude(base64Audio, mimeType, config.claudeApiKey);

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ──────────────────────────────────────────────
// PROVIDER BLACKLIST (session-level)
// Tracks providers that hit rate limits, quota, or size errors.
// Once blacklisted, they are skipped for the rest of the session.
// Resets on page reload.
// ──────────────────────────────────────────────
const disabledProviders = new Set<AIProvider>();

const FATAL_ERROR_PATTERNS = [
  '429', 'rate limit', 'quota', 'resource_exhausted',
  'too large', 'request entity too large', 'payload too large',
  'content-length', 'exceeded',
];

function shouldDisableProvider(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase();
  return FATAL_ERROR_PATTERNS.some(pattern => lower.includes(pattern));
}

export function resetProviderBlacklist() {
  disabledProviders.clear();
  console.log('[Sonic Lens] Provider blacklist cleared.');
}

// ──────────────────────────────────────────────
// MAIN ENTRY POINT
// Multi-model ON  -> Priority 1: Gemini Native (Best quality) -> Fallback: Hybrid (Whisper + Gemini Text)
// Multi-model OFF -> Single provider (standalone, sends audio directly)
// ──────────────────────────────────────────────
export const transcribeAudio = async (base64Audio: string, mimeType: string) => {
  const config = getAIConfig();

  // ── Single model mode: use selected provider standalone ──
  if (!config.enableMultiModel) {
    console.log(`[Sonic Lens] Single model mode: using ${config.provider}`);
    const result = await runProvider(config.provider, base64Audio, mimeType);
    return { ...result, _usedProvider: config.provider };
  }

  // ── Multi model mode: Priority Logic ──
  console.log('[Sonic Lens] Multi-model mode: starting priority chain...');

  // Step 1: Try Gemini Native first (Best quality, uses more tokens)
  if (process.env.GEMINI_API_KEY && !disabledProviders.has('gemini')) {
    try {
      console.log('[Sonic Lens] Priority 1: Trying Gemini Native Audio...');
      const result = await transcribeWithGemini(base64Audio, mimeType);
      return { ...result, _usedProvider: 'gemini-native' };
    } catch (err: any) {
      const errorMsg = err?.message || '';
      console.warn('[Sonic Lens] Gemini Native failed:', errorMsg);
      if (shouldDisableProvider(errorMsg)) {
        disabledProviders.add('gemini');
        console.warn('[Sonic Lens] Gemini (Native) BLACKLISTED for this session.');
      }
      // Continue to hybrid fallback
    }
  }

  // Step 2: Try Hybrid Pipeline (Whisper STT + Gemini/LLM Text structuring)
  try {
    console.log('[Sonic Lens] Priority 2: Trying HYBRID pipeline (Whisper STT + Text Structuring)...');
    const result = await transcribeHybrid(base64Audio, mimeType);
    return result; // _usedProvider set inside transcribeHybrid
  } catch (err: any) {
    console.warn('[Sonic Lens] Hybrid pipeline failed, falling back to other standalone providers...');

    // Step 3: Final fallback to other standalone providers in priority order
    const availableProviders = PROVIDER_PRIORITY.filter(p =>
      p !== 'gemini' && isProviderAvailable(p, config) && !disabledProviders.has(p)
    );

    if (availableProviders.length === 0) {
      if (disabledProviders.size > 0) {
        console.log('[Sonic Lens] All providers failed/blacklisted. Resetting and retrying 1 last time...');
        disabledProviders.clear();
        const retryProviders = PROVIDER_PRIORITY.filter(p => isProviderAvailable(p, config));
        if (retryProviders.length > 0) {
          return transcribeWithStandaloneFallback(retryProviders, base64Audio, mimeType);
        }
      }
      throw new Error('No AI providers available. Check API keys in Admin.');
    }

    return transcribeWithStandaloneFallback(availableProviders, base64Audio, mimeType);
  }
};

// Standalone fallback: try providers one by one (sends audio directly)
async function transcribeWithStandaloneFallback(providers: AIProvider[], base64Audio: string, mimeType: string) {
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      console.log(`[Sonic Lens] Trying standalone provider: ${provider}...`);
      const result = await runProvider(provider, base64Audio, mimeType);
      console.log(`[Sonic Lens] Success with provider: ${provider}`);
      return { ...result, _usedProvider: provider };
    } catch (err: any) {
      const errorMsg = err?.message || 'Unknown error';
      console.warn(`[Sonic Lens] Provider ${provider} failed: ${errorMsg}`);
      errors.push(`${provider}: ${errorMsg}`);

      if (shouldDisableProvider(errorMsg)) {
        disabledProviders.add(provider);
        console.warn(`[Sonic Lens] Provider ${provider} BLACKLISTED (${errorMsg.substring(0, 60)}...)`);
      }
    }
  }

  throw new Error(
    `All AI providers failed.\n\n${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}\n\nPlease check your API keys or try again later.`
  );
}
