import http from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.js';
import { createDatabase } from './src/db.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const db = createDatabase(process.env.DB_PATH || join(__dirname, 'data', 'idb.sqlite'));
const app = createApp({
  db,
  secureCookies: process.env.HTTPS === '1' || process.env.VERCEL === '1',
});

const server = http.createServer(app);
server.listen(PORT, HOST, () => {
  console.log(`Ruang IDB berjalan di http://${HOST}:${PORT}`);
});
