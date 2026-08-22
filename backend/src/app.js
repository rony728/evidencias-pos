import express from 'express';
import cors from 'cors';
import { createTicketsRouter } from './routes/tickets.js';
import { createImagesRouter } from './routes/imagenes.js';
import { createSyncRouter } from './routes/sync.js';
import { errorHandler, notFound } from './middleware/errors.js';

function allowedOrigins(value) {
  return String(value || 'https://rony728.github.io').split(',').map((item) => item.trim()).filter(Boolean);
}

export function createApp({ database, env = process.env }) {
  const app = express();
  const origins = allowedOrigins(env.CORS_ORIGIN);
  app.disable('x-powered-by');
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) return callback(null, true);
      return callback(Object.assign(new Error('Origen no autorizado por CORS.'), { status: 403 }));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', async (req, res, next) => {
    try {
      await database.query('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch (error) { next(Object.assign(error, { status: 503 })); }
  });

  app.use('/api/tickets', createTicketsRouter(database));
  app.use('/api', createImagesRouter(database));
  app.use('/api/sync', createSyncRouter(database));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
