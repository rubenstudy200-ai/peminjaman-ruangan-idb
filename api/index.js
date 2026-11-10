import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

// Vercel: filesystem read-only, jadi SQLite ditaruh di /tmp (per instance).
// Cocok untuk mode demo; data akan kembali ke seed saat instance didaur ulang.
const DB_PATH = process.env.DB_PATH || join(tmpdir(), 'idb-demo.sqlite');

const globalKey = Symbol.for('ruang-idb.vercel');
if (!globalThis[globalKey]) {
  const db = createDatabase(DB_PATH);
  globalThis[globalKey] = createApp({ db, secureCookies: true });
}

export default globalThis[globalKey];
