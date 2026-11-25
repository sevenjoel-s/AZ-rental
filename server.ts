import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createAdminRouter } from './src/server/adminRoutes.ts';
import { runMigrations, seedReferenceData } from './src/server/db.ts';
import {
  CHAT_MEDIA_DIR,
  PUBLIC_IMAGES_DIR,
  PUBLIC_VIDEOS_DIR,
  safeResolveInside,
  seedStarterListingsIfEmpty,
} from './src/server/media.ts';
import { attachWebSocketServer } from './src/server/realtime.ts';
import { createApiRouter } from './src/server/routes.ts';

export async function createApp(): Promise<express.Express> {
  runMigrations();
  seedReferenceData();
  await seedStarterListingsIfEmpty();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Securely serve watermarked public images & chat media with path confinement
  app.get('/media/images/:file', (req, res) => {
    const safePath = safeResolveInside(PUBLIC_IMAGES_DIR, req.params.file);
    if (!safePath || !fs.existsSync(safePath)) {
      res.status(404).end();
      return;
    }
    res.sendFile(safePath);
  });

  app.get('/media/chat/:file', (req, res) => {
    const safePath = safeResolveInside(CHAT_MEDIA_DIR, req.params.file);
    if (!safePath || !fs.existsSync(safePath)) {
      res.status(404).end();
      return;
    }
    res.sendFile(safePath);
  });

  // Stream video with HTTP Range support
  app.get('/media/videos/:file', (req, res) => {
    const safePath = safeResolveInside(PUBLIC_VIDEOS_DIR, req.params.file);
    if (!safePath || !fs.existsSync(safePath)) {
      res.status(404).end();
      return;
    }
    const stat = fs.statSync(safePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const ext = path.extname(safePath).toLowerCase();
    const contentType = ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : 'video/mp4';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      });
      fs.createReadStream(safePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
      });
      fs.createReadStream(safePath).pipe(res);
    }
  });

  app.use('/api/admin', createAdminRouter());
  app.use('/api', createApiRouter());

  return app;
}

async function startServer() {
  const app = await createApp();
  const httpServer = http.createServer(app);
  attachWebSocketServer(httpServer);

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
        ws: {
          server: httpServer,
          path: '/vite-ws',
        },
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`AZ RENTAL server running at http://0.0.0.0:${PORT}`);
  });
}

if (process.env.VITEST !== 'true') {
  startServer().catch((err) => {
    console.error('Failed to start AZ RENTAL server:', err);
    process.exit(1);
  });
}
