/**
 * NVIDIA NIM "integrate" API is usually not callable from a browser origin
 * because of CORS. Mitigations:
 * - Local dev: Vite proxies /nvidia-nim-api -> https://integrate.api.nvidia.com
 * - Production: set VITE_NVIDIA_NIM_CHAT_URL to a same-origin path that your
 *   server or edge function proxies to integrate.api.nvidia.com, or call NIM from a backend.
 */
export function getNvidiaNimChatCompletionsUrl(): string {
  const explicit = import.meta.env.VITE_NVIDIA_NIM_CHAT_URL as string | undefined;
  if (explicit?.trim()) {
    return explicit.trim();
  }
  if (import.meta.env.DEV) {
    return '/nvidia-nim-api/v1/chat/completions';
  }
  return 'https://integrate.api.nvidia.com/v1/chat/completions';
}
