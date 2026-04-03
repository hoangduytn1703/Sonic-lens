// Shared instructions for the JSON "summary" field across Gemini + hybrid / OpenAI / Groq / Claude pipelines.

export const AI_SUMMARY_FIELD_RULES_EN = `
SUMMARY FIELD (Vietnamese text inside JSON string "summary"):
- This is an EXECUTIVE brief, NOT a second transcript. Do NOT retell the conversation sentence by sentence.
- HARD LIMIT: at most 12 short lines of bullets across the whole summary (excluding section headers).
- Use this exact outline with Markdown-style headers and newlines (\\n) between lines:

## Tổng quan
<exactly one sentence, max 25 words: what this recording is about>

## Điểm chính
- <one concrete point per line, max ~15 words>
- <3 to 7 bullets only>

## Quyết định / Việc cần làm
- <items or a single line "Không có." if none>

## Từ khóa
<comma-separated, max 8 terms>

- No long paragraphs under any section. No quoted dialogue blocks. Skip minor small talk.
`.trim();
