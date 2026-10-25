import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './db.js';
import { router as authRouter, loadUser } from './auth.js';
import { router as profileRouter, UPLOAD_DIR } from './profile.js';
import { router as activityRouter, runJobs } from './activities.js';
import { router as consentRouter } from './consent.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));
  app.use(loadUser);

  // Public settings the browser needs (Supabase keys here are the public "anon" ones).
  app.get('/api/config', (_req, res) => res.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    devCodes: process.env.DEV_SHOW_CODES === '1',
  }));
  app.use('/api/auth', authRouter);
  app.use('/api', consentRouter);
  app.use('/api', profileRouter);
  app.use('/api', activityRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
  app.use(express.static(path.join(root, 'public')));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(root, 'public', 'index.html')));

  // Errors: expected ones carry a status and a message meant for the member.
  app.use((err, _req, res, _next) => {
    if (err.name === 'MulterError') err.status = 400;
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong. Try again.' : err.message, ...(status < 500 && err.code ? { code: err.code } : {}) });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrate();
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => console.log(`MeetSpot running at http://localhost:${port}`));
  setInterval(() => runJobs().catch((e) => console.error('jobs', e)), 30_000);
}
