/**
 * --- Google Gemini in this app (three different touchpoints) ---
 *
 * 1) Native audio transcription (`services/gemini.ts`): {@link GEMINI_NATIVE_AUDIO_MODEL}
 *    — Google GenAI `generateContent` with audio inline; NOT the same as NIM.
 *
 * 2) Text-only structuring + final summary: {@link getGeminiTextModel}
 *    — env `GEMINI_TEXT_MODEL` (Vite-injected), default gemini-2.0-flash.
 *
 * 3) NVIDIA NIM does NOT call Google Gemini API. NIM uses `integrate.api.nvidia.com`
 *    with OpenAI-style chat. For a Google-family model on NIM, use Gemma (e.g.
 *    google/gemma-2-27b-it), not gemini-* strings.
 */

/** Multimodal: audio in → JSON transcript+summary. Separate from GEMINI_TEXT_MODEL. */
export const GEMINI_NATIVE_AUDIO_MODEL = 'gemini-2.5-flash' as const;

/**
 * Gemini model id for text-only calls (hybrid structuring, final summary).
 * Set GEMINI_TEXT_MODEL in .env to override (e.g. gemini-2.5-flash, gemini-1.5-pro).
 * Injected by Vite; defaults to gemini-2.0-flash.
 */
export function getGeminiTextModel(): string {
  const m = process.env.GEMINI_TEXT_MODEL;
  return typeof m === 'string' && m.trim() ? m.trim() : 'gemini-2.0-flash';
}
