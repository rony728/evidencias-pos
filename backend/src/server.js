import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import pool from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const app = createApp({ database: pool });
const certPath = process.env.TLS_CERT_PATH;
const keyPath = process.env.TLS_KEY_PATH;
const useTls = Boolean(certPath && keyPath);
const server = useTls
  ? https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app)
  : http.createServer(app);

server.listen(port, host, () => {
  console.log(`Evidencias POS API escuchando en ${useTls ? 'https' : 'http'}://${host}:${port}`);
});

async function shutdown(signal) {
  console.log(`Cerrando API por ${signal}...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
