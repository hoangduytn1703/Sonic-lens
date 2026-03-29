// Transcription router - delegates to Gemini, OpenAI, Groq, or Claude based on user config.
// Supports multi-model fallback: tries providers in priority order, skips on failure.
// gemini.ts is NOT modified - this file wraps it.

import { transcribeAudio as transcribeWithGemini } from './gemini';
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
// OPENAI: Whisper + GPT-4o-mini
// ──────────────────────────────────────────────
async function transcribeWithOpenAI(base64Audio: string, mimeType: string, apiKey: string) {
  const { blob: audioBlob, ext } = audioBase64ToBlob(base64Audio, mimeType);

  const formData = new FormData();
  formData.append('file', audioBlob, `audio.${ext}`);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('language', 'vi');

  // Step 1: Whisper transcription
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

  // Step 2: GPT-4o-mini to structure transcript
  const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
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
// GROQ: Whisper Large v3 (free) + Llama 3 (free)
// Groq API is OpenAI-compatible, only the base URL differs.
// ──────────────────────────────────────────────
async function transcribeWithGroq(base64Audio: string, mimeType: string, apiKey: string) {
  const { blob: audioBlob, ext } = audioBase64ToBlob(base64Audio, mimeType);

  const formData = new FormData();
  formData.append('file', audioBlob, `audio.${ext}`);
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'verbose_json');
  formData.append('language', 'vi');

  // Step 1: Groq Whisper transcription
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

  // Step 2: Llama 3.3 70B to structure transcript into JSON
  const llmRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
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
// CLAUDE: Anthropic Messages API
// Claude does not have a native audio API, so we use Groq Whisper (if key exists)
// or OpenAI Whisper as a fallback for STT, then Claude for structuring.
// If no Whisper key is available, we send audio as base64 to Claude directly
// (Claude 3.5 Sonnet supports multimodal but NOT audio - so we need a Whisper step).
// For simplicity: we require a Groq key (free) for the Whisper step.
// ──────────────────────────────────────────────
async function transcribeWithClaude(base64Audio: string, mimeType: string, claudeApiKey: string) {
  const config = getAIConfig();

  // Claude cannot process audio directly. We need a Whisper service for STT.
  // Priority: Groq (free) > OpenAI (paid)
  let rawText = '';

  if (config.groqApiKey) {
    // Use Groq Whisper (free) for speech-to-text
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
    // Fallback: use OpenAI Whisper
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
    throw new Error(
      'Claude cannot process audio directly. Please add a Groq API Key (free) or OpenAI API Key in Admin > API Settings for speech-to-text.'
    );
  }

  // Step 2: Claude to structure transcript
  // Note: Anthropic API requires a CORS proxy or server-side call in production.
  // For local/dev, this will work if the browser extensions allow it or via proxy.
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
// Execute transcription for a specific provider
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
// MAIN ENTRY POINT
// Multi-model: tries providers in priority order, falls back on failure.
// Single-model: uses the selected provider only.
// ──────────────────────────────────────────────
export const transcribeAudio = async (base64Audio: string, mimeType: string) => {
  const config = getAIConfig();

  // ── Single model mode ──
  if (!config.enableMultiModel) {
    console.log(`[Sonic Lens] Single model mode: using ${config.provider}`);
    return runProvider(config.provider, base64Audio, mimeType);
  }

  // ── Multi model mode ──
  // Filter to only available providers (have valid keys configured)
  const availableProviders = PROVIDER_PRIORITY.filter(p => isProviderAvailable(p, config));

  if (availableProviders.length === 0) {
    throw new Error('No AI providers available. Please configure at least one API key in Admin > API Settings.');
  }

  console.log(`[Sonic Lens] Multi-model mode enabled. Available providers: ${availableProviders.join(' -> ')}`);

  const errors: string[] = [];

  for (const provider of availableProviders) {
    try {
      console.log(`[Sonic Lens] Trying provider: ${provider}...`);
      const result = await runProvider(provider, base64Audio, mimeType);
      console.log(`[Sonic Lens] Success with provider: ${provider}`);
      return result;
    } catch (err: any) {
      const errorMsg = err?.message || 'Unknown error';
      console.warn(`[Sonic Lens] Provider ${provider} failed: ${errorMsg}`);
      errors.push(`${provider}: ${errorMsg}`);
      // Continue to next provider
    }
  }

  // All providers failed
  throw new Error(
    `All AI providers failed.\n\n${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}\n\nPlease check your API keys or try again later.`
  );
};
