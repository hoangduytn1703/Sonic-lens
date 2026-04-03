/**
 * Production static server: serves Vite `dist/` and proxies /nvidia-nim-api -> integrate.api.nvidia.com
 * (same behavior as Vite dev server). Run after `npm run build`:
 *   npm run serve:prod
 * Or set PORT=8080 npm run serve:prod
 */
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, '..', 'dist');

const app = express();
const PORT = Number(process.env.PORT || 4173);

app.use(
  '/nvidia-nim-api',
  createProxyMiddleware({
    target: 'https://integrate.api.nvidia.com',
    changeOrigin: true,
    pathRewrite: { '^/nvidia-nim-api': '' },
    secure: true,
  }),
);

app.use(express.static(dist));

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/nvidia-nim-api')) return next();
  const indexHtml = path.join(dist, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    res.status(500).type('text/plain').send('Missing dist/. Run npm run build first.');
    return;
  }
  res.sendFile(indexHtml);
});

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`Sonic Lens: http://0.0.0.0:${PORT} (static + NVIDIA NIM proxy)`);
});
