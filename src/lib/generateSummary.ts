import { getAIConfig, getProviderPriority, isProviderAvailable, type AIProvider } from './aiConfig';
import { GoogleGenAI } from '@google/genai';
import { AI_SUMMARY_FIELD_RULES_EN } from './aiSummaryPrompt';
import { getGeminiTextModel } from './geminiTextModel';
import { getNvidiaNimChatCompletionsUrl } from './nvidiaNimEndpoint';
import type { TranscriptItem } from '../types';

// Generate summary from completed transcript using available AI providers
export async function generateFinalSummary(
  transcript: TranscriptItem[]
): Promise<string> {
  // Minimum threshold: at least 3 transcript items (even short conversations deserve summary)
  if (!transcript || transcript.length < 3) {
    console.log('[generateFinalSummary] Transcript too short, skipping summary');
    return '';
  }

  // Check total word count (at least ~20 words for meaningful content)
  const totalWords = transcript.reduce((sum, item) => sum + item.text.split(/\s+/).filter(Boolean).length, 0);
  if (totalWords < 20) {
    console.log(`[generateFinalSummary] Only ${totalWords} words, skipping summary`);
    return '';
  }

  // Format transcript as text for AI
  const transcriptText = transcript
    .map((item) => `[${item.timestamp}] ${item.speaker}: ${item.text}`)
    .join('\n');

  const config = getAIConfig();
  const prompt = `You are a professional meeting note-taker. Analyze the following transcript and provide an executive summary in Vietnamese.

${AI_SUMMARY_FIELD_RULES_EN}

IMPORTANT: This is a COMPLETE conversation transcript. Provide a HOLISTIC summary covering the entire discussion, NOT per-segment summaries.

TRANSCRIPT:
${transcriptText}

Return ONLY the summary text (Vietnamese, using ## headers and - bullets as specified). Do NOT wrap in JSON.`;

  const providers: AIProvider[] = [...getProviderPriority(config)];

  for (const provider of providers) {
    if (!isProviderAvailable(provider)) continue;

    try {
      console.log(`[generateFinalSummary] Trying ${provider}...`);

      if (provider === 'gemini') {
        if (!process.env.GEMINI_API_KEY) {
          console.warn('[generateFinalSummary] Gemini API key not found');
          continue;
        }
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: getGeminiTextModel(),
          contents: [{ parts: [{ text: prompt }] }],
        });
        const summary = response.text?.trim() || '';
        if (summary) {
          console.log(`[generateFinalSummary] Success with ${provider}`);
          return summary;
        }
      } else if (provider === 'nvidiaNim') {
        const model = config.nvidiaNimModel?.trim() || 'google/gemma-2-27b-it';
        const response = await fetch(getNvidiaNimChatCompletionsUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.nvidiaNimApiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
          }),
        });
        const data = await response.json();
        const summary = data.choices?.[0]?.message?.content?.trim() || '';
        if (summary) {
          console.log(`[generateFinalSummary] Success with ${provider}`);
          return summary;
        }
      } else if (provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.openaiApiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
          }),
        });
        const data = await response.json();
        const summary = data.choices?.[0]?.message?.content?.trim() || '';
        if (summary) {
          console.log(`[generateFinalSummary] Success with ${provider}`);
          return summary;
        }
      } else if (provider === 'groq') {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.groqApiKey}`,
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
          }),
        });
        const data = await response.json();
        const summary = data.choices?.[0]?.message?.content?.trim() || '';
        if (summary) {
          console.log(`[generateFinalSummary] Success with ${provider}`);
          return summary;
        }
      } else if (provider === 'claude') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.claudeApiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 2048,
            temperature: 0.3,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        const data = await response.json();
        const summary = data.content?.[0]?.text?.trim() || '';
        if (summary) {
          console.log(`[generateFinalSummary] Success with ${provider}`);
          return summary;
        }
      }
    } catch (err) {
      console.warn(`[generateFinalSummary] ${provider} failed:`, err);
      continue;
    }
  }

  console.error('[generateFinalSummary] All providers failed');
  return '';
}
