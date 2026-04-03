/**
 * Cloudflare Pages Function: proxy same-origin /nvidia-nim-api/* -> https://integrate.api.nvidia.com/*
 * The browser cannot call integrate.api.nvidia.com directly (CORS). Vite dev uses server.proxy;
 * static deploys (Pages, many CDNs) need this edge proxy so NVIDIA NIM chat completions work.
 */
export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);
  const suffix = url.pathname.replace(/^\/nvidia-nim-api/, '') || '/';
  const target = new URL(suffix + url.search, 'https://integrate.api.nvidia.com');

  const headers = new Headers(request.headers);
  headers.delete('host');

  return fetch(target.toString(), {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
  });
}
