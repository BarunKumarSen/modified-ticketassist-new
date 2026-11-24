import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { openDatabase } from './src/db/sqlite.ts';
import { createApiApp } from './server/app.ts';

function getCliArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag && args[i + 1] && !args[i + 1].startsWith('--')) {
      return args[i + 1];
    }
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return undefined;
}

function isDevEnvironment(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.NODE_ENV === 'development') return true;
  // When NODE_ENV is unset, check if we're in an AI Studio dev container or if dist/index.html is missing
  const hasDist = fs.existsSync(path.resolve(process.cwd(), 'dist', 'index.html'));
  return !hasDist;
}

/**
 * Port resolution order:
 *   1. --port CLI arg (used by local dev / explicit overrides)
 *   2. In AI Studio dev containers behind nginx on :8080, ignore inherited PORT=8080 and bind 3000
 *   3. PORT env var in production / Cloud Run
 *   4. 3000 fallback
 */
function resolvePort(): number {
  const cli = getCliArg('--port');
  if (cli) {
    const n = Number(cli);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const env = process.env.PORT;
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) {
      if (!isDevEnvironment() || n !== 8080) {
        return n;
      }
    }
  }
  return 3000;
}

function resolveHost(): string {
  return getCliArg('--host') || process.env.HOST || '0.0.0.0';
}

/**
 * DB path resolution order:
 *   1. DB_PATH / DATABASE_PATH env var (explicit override)
 *   2. ./data/assetos.db whenever the project data directory is writable
 *   3. /tmp/assetos.db fallback if running on a read-only container filesystem
 */
function resolveDbPath(): string {
  const explicit = process.env.DB_PATH || process.env.DATABASE_PATH;
  if (explicit) return explicit;

  const projectDataDir = path.resolve(process.cwd(), 'data');
  const projectDbPath = path.join(projectDataDir, 'assetos.db');
  try {
    fs.mkdirSync(projectDataDir, { recursive: true });
    fs.accessSync(projectDataDir, fs.constants.W_OK);
    if (fs.existsSync(projectDbPath)) {
      fs.accessSync(projectDbPath, fs.constants.W_OK);
    }
    return projectDbPath;
  } catch {
    return path.resolve('/tmp', 'assetos.db');
  }
}

async function startServer() {
  const PORT = resolvePort();
  const HOST = resolveHost();
  const DB_PATH = resolveDbPath();

  console.log(
    `[AssetOS] boot · NODE_ENV=${process.env.NODE_ENV ?? '(unset)'} · PORT=${PORT} · HOST=${HOST} · DB_PATH=${DB_PATH}`
  );

  // Fail fast and loudly if the database can't be opened.
  let db: ReturnType<typeof openDatabase>;
  try {
    db = openDatabase(DB_PATH);
    console.log('[AssetOS] database ready.');
  } catch (err) {
    console.error('[AssetOS] Failed to open database at', DB_PATH, '→', err);
    throw err;
  }

  const app = createApiApp(db, { enableBackgroundWorker: true });
  const httpServer = http.createServer(app);

  // Use Vite dev middleware in development; serve pre-built static dist/ in production.
  const distDir = path.resolve(process.cwd(), 'dist');
  const hasBuiltAssets = fs.existsSync(path.join(distDir, 'index.html'));
  const useVite = isDevEnvironment() || !hasBuiltAssets;

  if (useVite) {
    console.log('[AssetOS] starting Vite dev middleware.');
    const { createServer: createViteServer } = await import('vite');
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        ...(disableHmr ? { hmr: false, watch: null } : {}),
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    console.log(`[AssetOS] serving static build from ${distDir}`);
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run `npm run build` first.');
      }
    });
  }

  // Await listen() so we crash loudly on EADDRINUSE / EACCES instead of
  // silently failing to bind, and so Cloud Run sees the port open ASAP.
  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      console.error('[AssetOS] httpServer.listen error:', err);
      reject(err);
    };
    httpServer.once('error', onError);
    httpServer.listen(PORT, HOST, () => {
      httpServer.off('error', onError);
      console.log(`[AssetOS] listening on http://${HOST}:${PORT}`);
      resolve();
    });
  });

  // Graceful shutdown — Cloud Run sends SIGTERM before killing the container.
  const shutdown = (signal: string) => {
    console.log(`[AssetOS] received ${signal}, shutting down…`);
    httpServer.close((closeErr) => {
      if (closeErr) console.error('[AssetOS] error during http close:', closeErr);
      try { db.close?.(); } catch { /* ignore */ }
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[AssetOS] forced exit after 10s.');
      process.exit(1);
    }, 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('uncaughtException', (err) => {
  console.error('[AssetOS] uncaughtException:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[AssetOS] unhandledRejection:', err);
});

startServer().catch((err) => {
  console.error('Failed to start AssetOS server:', err);
  process.exit(1);
});