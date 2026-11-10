import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 4319;
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let tempDir;
let raniCookie = '';
let sintaCookie = '';
let adminCookie = '';
let createdBookingId = null;
let manageRoomId = null;

function todayWITA() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

async function request(path, { method = 'GET', cookie, body, origin = BASE } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { response, data };
}

async function login(email, password = 'idb12345') {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie');
  const cookie = setCookie ? setCookie.split(';')[0] : '';
  return { response, data, cookie, setCookie };
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'ruang-idb-test-'));
  const dbPath = join(tempDir, 'test.sqlite');
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk) => console.error('[server]', chunk.toString().trim()));
  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'server harus siap untuk tes');
});

after(async () => {
  if (child) {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      child.once('exit', resolve);
      setTimeout(resolve, 2000);
    });
  }
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test('login, cookie sesi, dan pembatasan admin', async () => {
  const wrong = await login('rani@idb.ac.id', 'salah-total');
  assert.equal(wrong.response.status, 401);

  const rani = await login('rani@idb.ac.id');
  assert.equal(rani.response.status, 200);
  assert.equal(rani.data.user.role, 'mahasiswa');
  assert.match(rani.setCookie, /HttpOnly/i);
  assert.match(rani.setCookie, /SameSite=Strict/i);
  raniCookie = rani.cookie;

  const me = await request('/api/me', { cookie: raniCookie });
  assert.equal(me.data.user.email, 'rani@idb.ac.id');

  const forbidden = await request('/api/admin/overview', { cookie: raniCookie });
  assert.equal(forbidden.response.status, 403);

  const crossOrigin = await request('/api/bookings', {
    method: 'POST',
    cookie: raniCookie,
    origin: 'https://penyerang.example',
    body: {},
  });
  assert.equal(crossOrigin.response.status, 403);
});

test('katalog ketersediaan dan validasi pengajuan', async () => {
  const date = addDays(todayWITA(), 20);
  const rooms = await request(`/api/rooms?date=${date}`, { cookie: raniCookie });
  assert.equal(rooms.response.status, 200);
  assert.equal(rooms.data.rooms.length, 8);
  assert.ok(rooms.data.rooms.every((room) => Array.isArray(room.cells)));
  assert.ok(rooms.data.rooms[0].cells.length > 0);

  const payload = {
    roomId: 1,
    date,
    start: '09:00',
    end: '11:00',
    activity: 'Rapat Uji Integrasi',
    purpose: 'Menguji alur pengajuan dari formulir hingga surat izin.',
    participants: 20,
    org: 'UKM Seni Rupa',
  };
  const created = await request('/api/bookings', {
    method: 'POST',
    cookie: raniCookie,
    body: payload,
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.data.booking.status, 'menunggu');
  assert.match(created.data.booking.code, /^IDB-\d{4}-\d{4}$/);
  createdBookingId = created.data.booking.id;

  const duplicate = await request('/api/bookings', {
    method: 'POST',
    cookie: raniCookie,
    body: { ...payload, start: '10:00', end: '12:00' },
  });
  assert.equal(duplicate.response.status, 409);
  assert.ok(duplicate.data.suggestions);
  assert.ok(duplicate.data.suggestions.alternateTimes.length > 0);
  assert.ok(duplicate.data.suggestions.alternateRooms.length > 0);

  const tooSoon = await request('/api/bookings', {
    method: 'POST',
    cookie: raniCookie,
    body: { ...payload, roomId: 2, date: addDays(todayWITA(), 1) },
  });
  assert.equal(tooSoon.response.status, 422);
  assert.ok(tooSoon.data.errors.date);

  const tooMany = await request('/api/bookings', {
    method: 'POST',
    cookie: raniCookie,
    body: { ...payload, roomId: 2, participants: 999, date: addDays(todayWITA(), 21) },
  });
  assert.equal(tooMany.response.status, 422);
  assert.ok(tooMany.data.errors.participants);
});

test('admin menyetujui, menolak dengan alasan, dan email tercatat', async () => {
  const admin = await login('dimas@idb.ac.id');
  assert.equal(admin.response.status, 200);
  adminCookie = admin.cookie;

  const withoutReason = await request('/api/admin/bookings/2/decision', {
    method: 'POST',
    cookie: adminCookie,
    body: { decision: 'ditolak' },
  });
  assert.equal(withoutReason.response.status, 422);
  assert.ok(withoutReason.data.errors.reason);

  const approve = await request(`/api/admin/bookings/${createdBookingId}/decision`, {
    method: 'POST',
    cookie: adminCookie,
    body: { decision: 'disetujui' },
  });
  assert.equal(approve.response.status, 200);
  assert.equal(approve.data.booking.status, 'disetujui');
  assert.equal(approve.data.booking.decided_by_name, 'Dimas Saputra');

  const emails = await request('/api/admin/emails', { cookie: adminCookie });
  assert.ok(emails.data.emails.some((email) => email.subject.includes('disetujui')));

  const again = await request(`/api/admin/bookings/${createdBookingId}/decision`, {
    method: 'POST',
    cookie: adminCookie,
    body: { decision: 'ditolak', reason: 'Sudah diproses.' },
  });
  assert.equal(again.response.status, 409);
});

test('pemohon membatalkan pengajuan dan slot terbuka kembali', async () => {
  const date = addDays(todayWITA(), 22);
  const created = await request('/api/bookings', {
    method: 'POST',
    cookie: raniCookie,
    body: {
      roomId: 7,
      date,
      start: '10:00',
      end: '12:00',
      activity: 'Latihan Pameran',
      purpose: 'Latihan tata letak karya sebelum pameran dibuka.',
      participants: 15,
    },
  });
  assert.equal(created.response.status, 201);

  const cancelled = await request(`/api/bookings/${created.data.booking.id}/cancel`, {
    method: 'POST',
    cookie: raniCookie,
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.data.booking.status, 'dibatalkan');

  const rooms = await request(`/api/rooms?date=${date}`, { cookie: raniCookie });
  const gallery = rooms.data.rooms.find((room) => room.id === 7);
  const cell = gallery.cells.find((c) => c.start === '10:00');
  assert.equal(cell.state, 'tersedia');
});

test('dua pemohon bersamaan: hanya satu yang berhasil', async () => {
  const sinta = await login('sinta@idb.ac.id');
  assert.equal(sinta.response.status, 200);
  sintaCookie = sinta.cookie;

  const date = addDays(todayWITA(), 23);
  const payload = {
    roomId: 8,
    date,
    start: '09:00',
    end: '10:00',
    activity: 'Uji Konkurensi',
    purpose: 'Dua pengguna mengirim pengajuan pada slot yang sama secara bersamaan.',
    participants: 10,
  };
  const [first, second] = await Promise.all([
    request('/api/bookings', { method: 'POST', cookie: raniCookie, body: payload }),
    request('/api/bookings', { method: 'POST', cookie: sintaCookie, body: payload }),
  ]);
  const statuses = [first.response.status, second.response.status].sort();
  assert.deepEqual(statuses, [201, 409]);
});

test('blokir jadwal mencegah pengajuan baru', async () => {
  const date = addDays(todayWITA(), 24);
  const block = await request('/api/admin/blocks', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      roomId: 2,
      date,
      start: '09:00',
      end: '11:00',
      reason: 'Perkuliahan tetap',
    },
  });
  assert.equal(block.response.status, 201);

  const booking = await request('/api/bookings', {
    method: 'POST',
    cookie: raniCookie,
    body: {
      roomId: 2,
      date,
      start: '10:00',
      end: '11:00',
      activity: 'Kegiatan Saat Blokir',
      purpose: 'Memastikan jadwal kuliah tetap tidak bisa digeser.',
      participants: 10,
    },
  });
  assert.equal(booking.response.status, 409);

  const deleted = await request(`/api/admin/blocks/${block.data.block.id}`, {
    method: 'DELETE',
    cookie: adminCookie,
  });
  assert.equal(deleted.response.status, 200);
});

test('admin mengelola ruangan dan ruangan nonaktif hilang dari katalog', async () => {
  const created = await request('/api/admin/rooms', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: 'Ruang Uji Kolaborasi',
      building: 'Gedung D',
      floor: 'Lantai 1',
      category: 'serbaguna',
      capacity: 24,
      openTime: '08:00',
      closeTime: '17:00',
      maxDurationMinutes: 120,
      facilities: 'AC, Papan tulis',
      description: 'Ruangan untuk pengujian otomatis.',
    },
  });
  assert.equal(created.response.status, 201);
  manageRoomId = created.data.room.id;

  const deactivated = await request(`/api/admin/rooms/${manageRoomId}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { active: false },
  });
  assert.equal(deactivated.response.status, 200);
  assert.equal(deactivated.data.room.active, 0);

  const catalog = await request(`/api/rooms?date=${addDays(todayWITA(), 20)}`, {
    cookie: raniCookie,
  });
  assert.equal(catalog.data.rooms.some((room) => room.id === manageRoomId), false);
});

test('pengaturan minimal notice dihormati lalu dikembalikan', async () => {
  const updated = await request('/api/admin/settings', {
    method: 'PUT',
    cookie: adminCookie,
    body: { minNoticeDays: 5, maxAdvanceDays: 30 },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.settings.minNoticeDays, 5);

  const tooSoon = await request('/api/bookings', {
    method: 'POST',
    cookie: raniCookie,
    body: {
      roomId: 3,
      date: addDays(todayWITA(), 3),
      start: '09:00',
      end: '10:00',
      activity: 'Uji Aturan Baru',
      purpose: 'Memastikan pengaturan minimal hari langsung berlaku.',
      participants: 5,
    },
  });
  assert.equal(tooSoon.response.status, 422);

  const reset = await request('/api/admin/settings', {
    method: 'PUT',
    cookie: adminCookie,
    body: { minNoticeDays: 2, maxAdvanceDays: 30 },
  });
  assert.equal(reset.response.status, 200);
});
