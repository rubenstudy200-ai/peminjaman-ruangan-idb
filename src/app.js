import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './api.js';
import { createSessionToken, randomToken, readSessionToken } from './security.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
export const DEFAULT_PUBLIC_DIR = resolve(__dirname, '..', 'public');
export const SESSION_COOKIE = 'idb_session';
export const SESSION_DAYS = 7;
const DEFAULT_SESSION_SECRET = 'idb-demo-session-secret-change-me';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function securityHeaders(extra = {}) {
  return {
    'Content-Security-Policy':
      "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...extra,
  };
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...securityHeaders(extraHeaders),
  });
  res.end(body);
}

function publicUser(row) {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    org: row.org,
  };
}

/**
 * Membuat handler HTTP yang dipakai bersama oleh server lokal (server.js)
 * maupun fungsi serverless Vercel (api/index.js).
 */
export function createApp({
  db,
  publicDir = DEFAULT_PUBLIC_DIR,
  secureCookies = false,
  sessionDays = SESSION_DAYS,
  sessionSecret = process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET,
} = {}) {
  if (!db) throw new Error('createApp membutuhkan instance database.');

  function loadSessionUser(token) {
    if (!token) return null;
    const claims = readSessionToken(token, sessionSecret);
    if (claims) {
      const row = db
        .prepare('SELECT id, name, email, role, org FROM users WHERE id = ? AND active = 1')
        .get(claims.userId);
      return row ? publicUser(row) : null;
    }
    // Kompatibilitas dengan sesi lama yang hanya tersimpan di tabel sessions.
    const row = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.org, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND u.active = 1`,
      )
      .get(token);
    if (!row) return null;
    if (Number(row.expires_at) < Date.now()) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return null;
    }
    return publicUser(row);
  }

  async function serveStatic(req, res, pathname) {
    const requested = pathname === '/' ? '/index.html' : pathname;
    let filePath = resolve(publicDir, `.${normalize(requested)}`);
    if (filePath !== publicDir && !filePath.startsWith(publicDir + sep)) {
      return false;
    }
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = join(filePath, 'index.html');
      const body = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': ['.html', '.css', '.js', '.webmanifest'].includes(extname(filePath).toLowerCase())
          ? 'no-cache'
          : 'public, max-age=3600',
        ...securityHeaders(),
      });
      res.end(body);
      return true;
    } catch {
      return false;
    }
  }

  return async function app(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (!['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      sendJson(res, 405, { error: 'Metode tidak diizinkan.' });
      return;
    }

    if (pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.origin;
        if (origin) {
          const host = req.headers.host;
          let originHost = '';
          try {
            originHost = new URL(origin).host;
          } catch {
            originHost = '';
          }
          if (!originHost || originHost !== host) {
            sendJson(res, 403, { error: 'Permintaan ditolak karena asal tidak dikenal.' });
            return;
          }
        }
      }

      const cookies = parseCookies(req.headers.cookie);
      const token = cookies[SESSION_COOKIE];
      const user = loadSessionUser(token);

      const ctx = {
        db,
        user,
        token,
        now: new Date(),
        ip: req.socket.remoteAddress || 'unknown',
        setSessionCookie(sessionToken) {
          const maxAge = sessionDays * 24 * 60 * 60;
          res.setHeader(
            'Set-Cookie',
            `${SESSION_COOKIE}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`,
          );
        },
        clearSessionCookie() {
          res.setHeader(
            'Set-Cookie',
            `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookies ? '; Secure' : ''}`,
          );
        },
      };

      try {
        const handled = await handleApi(req, res, url, ctx, {
          sendJson,
          randomToken,
          createSessionToken: (userId, expiresAt) =>
            createSessionToken(userId, expiresAt, sessionSecret),
          sessionDays,
        });
        if (!handled) sendJson(res, 404, { error: 'Endpoint tidak ditemukan.' });
      } catch (error) {
        console.error('[api]', error);
        if (!res.headersSent) {
          const status = Number(error.status) || 500;
          sendJson(res, status, {
            error:
              status === 413
                ? 'Data yang dikirim terlalu besar.'
                : status === 400
                  ? 'Format permintaan tidak valid.'
                  : 'Terjadi kesalahan pada server.',
          });
        }
      }
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const served = await serveStatic(req, res, pathname);
      if (served) return;
      const fallback = await serveStatic(req, res, '/');
      if (fallback) return;
    }

    sendJson(res, 404, { error: 'Halaman tidak ditemukan.' });
  };
}
