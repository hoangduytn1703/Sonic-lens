/**
 * NVIDIA NIM "integrate" API is not callable from a random browser origin (CORS).
 * Always use a same-origin path unless VITE_NVIDIA_NIM_CHAT_URL overrides it:
 * - vite dev: Vite proxies /nvidia-nim-api -> https://integrate.api.nvidia.com (see vite.config.ts)
 * - vite preview: same proxy under preview.proxy
 * - production: use `npm run serve:prod` (Express + proxy) or configure nginx/Caddy/Vercel
 *   to forward /nvidia-nim-api to https://integrate.api.nvidia.com
 *
 * Never default to https://integrate.api.nvidia.com in the client — that fails after deploy.
 */
export function getNvidiaNimChatCompletionsUrl(): string {
  const explicit = import.meta.env.VITE_NVIDIA_NIM_CHAT_URL as string | undefined;
  if (explicit?.trim()) {
    return explicit.trim();
  }
  return '/nvidia-nim-api/v1/chat/completions';
}
