import { defineConfig, loadEnv } from 'vite';

/**
 * Dev/proxy plugin for the HotPepper Gourmet API (Recruit Web Service).
 *
 * The official API does not send CORS headers, so the browser cannot call it
 * directly. We expose a same-origin endpoint `/api/hotpepper` that injects the
 * API key (kept server-side, never shipped to the client) and forwards the
 * request. In production this same contract should be served by a serverless
 * function — see README.
 */
function hotpepperProxy(env) {
  const KEY = env.HOTPEPPER_API_KEY || '';
  const BASE = 'https://webservice.recruit.co.jp/hotpepper/gourmet/v1/';
  return {
    name: 'hotpepper-proxy',
    configureServer(server) {
      server.middlewares.use('/api/hotpepper', async (req, res) => {
        try {
          if (!KEY) {
            res.statusCode = 501;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'HOTPEPPER_API_KEY is not set in .env' }));
            return;
          }
          const url = new URL(req.url, 'http://localhost');
          const params = new URLSearchParams(url.search);
          params.set('key', KEY);
          params.set('format', 'json');
          const upstream = await fetch(`${BASE}?${params.toString()}`);
          const body = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(body);
        } catch (err) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    // GitHub Pages serves this project site under /Map/. Dev stays at root.
    base: command === 'build' ? '/Map/' : '/',
    plugins: [hotpepperProxy(env)],
    server: { host: true, port: 5173 },
    build: { target: 'es2020' },
  };
});
