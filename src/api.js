import {
  STATUS,
  bookingWithRoomQuery,
  buildSuggestions,
  findConflict,
  getSettings,
  isValidDate,
  isValidTime,
  minToTime,
  nowWITA,
  roomAvailability,
  saveSettings,
  timeToMin,
  todayWITA,
  validateBooking,
} from './domain.js';
import { hashPassword, verifyPassword } from './security.js';
import {
  notifyCancelled,
  notifyDecision,
  notifySubmitted,
  queueEmail,
} from './email.js';

const categories = new Set(['kelas', 'studio', 'lab', 'rapat', 'aula', 'galeri', 'serbaguna']);
const loginAttempts = new Map();
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Body terlalu besar.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolvePromise({});
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Format JSON tidak valid.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function audit(db, userId, action, entity, entityId, detail) {
  db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(userId ?? null, action, entity, entityId ?? null, detail ?? null, new Date().toISOString());
}

function fetchBooking(db, id) {
  return db
    .prepare(
      `SELECT b.*, r.name AS room_name, r.building, r.floor, r.capacity, r.category,
              r.facilities, r.open_time, r.close_time,
              u.name AS user_name, u.email AS user_email, u.role AS user_role, u.org AS user_org,
              d.name AS decided_by_name
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       JOIN users u ON u.id = b.user_id
       LEFT JOIN users d ON d.id = b.decided_by
       WHERE b.id = ?`,
    )
    .get(id);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    org: user.org,
  };
}

function roomPayload(payload, existing = null) {
  const errors = {};
  const name = text(payload.name, 80);
  const building = text(payload.building, 60);
  const floor = text(payload.floor, 40);
  const category = text(payload.category, 20);
  const capacity = Number(payload.capacity);
  const openTime = text(payload.openTime, 5);
  const closeTime = text(payload.closeTime, 5);
  const maxDuration = Number(payload.maxDurationMinutes);
  const description = text(payload.description, 500);
  let facilities = payload.facilities;
  if (typeof facilities === 'string') {
    facilities = facilities.split(',').map((f) => f.trim()).filter(Boolean);
  }
  if (!Array.isArray(facilities)) facilities = [];
  facilities = facilities.map((f) => text(f, 40)).filter(Boolean).slice(0, 12);

  if (name.length < 3) errors.name = 'Nama ruangan minimal 3 karakter.';
  if (!building) errors.building = 'Isi nama gedung.';
  if (!floor) errors.floor = 'Isi lantai.';
  if (!categories.has(category)) errors.category = 'Pilih kategori ruangan.';
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) {
    errors.capacity = 'Kapasitas harus 1â€“1000 orang.';
  }
  if (!isValidTime(openTime) || !isValidTime(closeTime) || timeToMin(openTime) >= timeToMin(closeTime)) {
    errors.openTime = 'Jam operasional tidak valid.';
  }
  if (
    !Number.isInteger(maxDuration) ||
    maxDuration < 30 ||
    maxDuration > 720 ||
    maxDuration % 30 !== 0
  ) {
    errors.maxDurationMinutes = 'Durasi maksimum harus 30â€“720 menit (kelipatan 30).';
  }
  if (Object.keys(errors).length > 0) return { errors };

  return {
    values: {
      name,
      building,
      floor,
      category,
      capacity,
      openTime,
      closeTime,
      maxDuration,
      description,
      facilities,
      active: existing ? (payload.active === undefined ? existing.active : payload.active ? 1 : 0) : 1,
    },
  };
}

function insertRoom(db, values) {
  return Number(
    db
      .prepare(
        `INSERT INTO rooms
         (name, building, floor, capacity, category, facilities, description, open_time, close_time, max_duration_minutes, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        values.name,
        values.building,
        values.floor,
        values.capacity,
        values.category,
        JSON.stringify(values.facilities),
        values.description,
        values.openTime,
        values.closeTime,
        values.maxDuration,
        values.active,
        new Date().toISOString(),
      ).lastInsertRowid,
  );
}

function updateRoom(db, id, values) {
  db.prepare(
    `UPDATE rooms SET name = ?, building = ?, floor = ?, capacity = ?, category = ?, facilities = ?,
       description = ?, open_time = ?, close_time = ?, max_duration_minutes = ?, active = ?
     WHERE id = ?`,
  ).run(
    values.name,
    values.building,
    values.floor,
    values.capacity,
    values.category,
    JSON.stringify(values.facilities),
    values.description,
    values.openTime,
    values.closeTime,
    values.maxDuration,
    values.active,
    id,
  );
}

export async function handleApi(req, res, url, ctx, deps) {
  const { db, user } = ctx;
  const { sendJson, randomToken } = deps;
  const pathname = url.pathname;
  const parts = pathname.split('/').filter(Boolean);
  const method = req.method;

  if (pathname === '/api/health' && method === 'GET') {
    sendJson(res, 200, { ok: true, time: new Date().toISOString() });
    return true;
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readBody(req);
    const email = text(body.email, 120).toLowerCase();
    const password = String(body.password ?? '');
    const key = `${ctx.ip}|${email}`;
    const now = Date.now();
    const attempt = loginAttempts.get(key);
    if (attempt && attempt.reset > now && attempt.count >= 8) {
      sendJson(res, 429, {
        error: 'Terlalu banyak percobaan masuk. Tunggu 15 menit lalu coba lagi.',
      });
      return true;
    }
    if (!attempt || attempt.reset <= now) {
      loginAttempts.set(key, { count: 0, reset: now + 15 * 60 * 1000 });
    }
    const account = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
    const passwordValid = verifyPassword(password, account?.password_hash || DUMMY_HASH);
    if (!account || !passwordValid) {
      const current = loginAttempts.get(key);
      current.count += 1;
      sendJson(res, 401, { error: 'Email atau kata sandi tidak sesuai.' });
      return true;
    }
    loginAttempts.delete(key);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    const expiresAt = now + deps.sessionDays * 24 * 60 * 60 * 1000;
    const token = deps.createSessionToken
      ? deps.createSessionToken(account.id, expiresAt)
      : randomToken(32);
    db.prepare(
      'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    ).run(token, account.id, expiresAt, new Date(now).toISOString());
    ctx.setSessionCookie(token);
    audit(db, account.id, 'login', 'user', account.id, null);
    sendJson(res, 200, { user: publicUser(account) });
    return true;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    if (ctx.token) db.prepare('DELETE FROM sessions WHERE token = ?').run(ctx.token);
    ctx.clearSessionCookie();
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/me' && method === 'GET') {
    sendJson(res, 200, { user: user ? publicUser(user) : null });
    return true;
  }

  if (!user) {
    sendJson(res, 401, { error: 'Silakan masuk dengan akun kampus IDB.' });
    return true;
  }

  if (pathname.startsWith('/api/admin/') && user.role !== 'admin') {
    sendJson(res, 403, {
      error: 'Halaman ini hanya untuk admin sarana prasarana.',
    });
    return true;
  }

  if (pathname === '/api/rooms' && method === 'GET') {
    const date = url.searchParams.get('date') || todayWITA();
    if (!isValidDate(date)) {
      sendJson(res, 400, { error: 'Tanggal tidak valid.' });
      return true;
    }
    const settings = getSettings(db);
    const rooms = roomAvailability(db, date, {
      category: url.searchParams.get('category') || '',
      capacity: url.searchParams.get('capacity') || '',
      q: url.searchParams.get('q') || '',
      facility: url.searchParams.get('facility') || '',
    });
    sendJson(res, 200, {
      date,
      settings: {
        minNoticeDays: settings.minNoticeDays,
        maxAdvanceDays: settings.maxAdvanceDays,
      },
      rooms,
    });
    return true;
  }

  if (parts[1] === 'rooms' && parts[2] && method === 'GET') {
    const roomId = Number(parts[2]);
    const date = url.searchParams.get('date') || todayWITA();
    if (!isValidDate(date)) {
      sendJson(res, 400, { error: 'Tanggal tidak valid.' });
      return true;
    }
    const room = db.prepare('SELECT * FROM rooms WHERE id = ? AND active = 1').get(roomId);
    if (!room) {
      sendJson(res, 404, { error: 'Ruangan tidak ditemukan.' });
      return true;
    }
    const cells = roomAvailability(db, date).find((r) => r.id === roomId)?.cells || [];
    sendJson(res, 200, {
      room: { ...room, facilities: JSON.parse(room.facilities || '[]') },
      date,
      cells,
    });
    return true;
  }

  if (pathname === '/api/bookings' && method === 'POST') {
    const body = await readBody(req);
    const result = validateBooking(
      db,
      {
        roomId: body.roomId,
        date: body.date,
        start: body.start,
        end: body.end,
        activity: body.activity,
        purpose: body.purpose,
        participants: body.participants,
        org: body.org,
      },
      user,
    );
    if (result.errors) {
      sendJson(res, result.conflict ? 409 : 422, {
        error: result.conflict ? 'Jadwal yang dipilih sudah terisi.' : 'Periksa kembali isian Anda.',
        errors: result.errors,
        suggestions: result.suggestions || null,
      });
      return true;
    }

    let bookingId;
    db.exec('BEGIN IMMEDIATE');
    try {
      const conflict = findConflict(db, {
        roomId: result.room.id,
        date: result.date,
        startMin: result.startMin,
        endMin: result.endMin,
      });
      if (conflict) {
        db.exec('ROLLBACK');
        sendJson(res, 409, {
          error: 'Jadwal baru saja diambil orang lain. Pilih waktu lain.',
          suggestions: buildSuggestions(db, {
            room: result.room,
            date: result.date,
            startMin: result.startMin,
            endMin: result.endMin,
            participants: result.participants,
          }),
        });
        return true;
      }
      const info = db
        .prepare(
          `INSERT INTO bookings
           (user_id, room_id, date, start_min, end_min, activity, purpose, participants, org, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'menunggu', ?)`,
        )
        .run(
          user.id,
          result.room.id,
          result.date,
          result.startMin,
          result.endMin,
          result.activity,
          result.purpose,
          result.participants,
          result.org || null,
          new Date().toISOString(),
        );
      bookingId = Number(info.lastInsertRowid);
      const code = `IDB-${result.date.slice(2, 4)}${result.date.slice(5, 7)}-${String(bookingId).padStart(4, '0')}`;
      db.prepare('UPDATE bookings SET code = ? WHERE id = ?').run(code, bookingId);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    const booking = fetchBooking(db, bookingId);
    notifySubmitted(db, booking, user);
    audit(db, user.id, 'create', 'booking', bookingId, booking.code);
    sendJson(res, 201, { booking: publicBooking(booking) });
    return true;
  }

  if (pathname === '/api/bookings/mine' && method === 'GET') {
    const status = url.searchParams.get('status');
    const allowed = new Set(Object.values(STATUS));
    const clauses = ['b.user_id = ?'];
    const params = [user.id];
    if (status && allowed.has(status)) {
      clauses.push('b.status = ?');
      params.push(status);
    }
    const rows = db
      .prepare(bookingWithRoomQuery(clauses.join(' AND ')))
      .all(...params);
    sendJson(res, 200, { bookings: rows.map(publicBooking) });
    return true;
  }

  if (parts[1] === 'bookings' && parts[2] && parts[3] === 'cancel' && method === 'POST') {
    const id = Number(parts[2]);
    const booking = fetchBooking(db, id);
    if (!booking) {
      sendJson(res, 404, { error: 'Pengajuan tidak ditemukan.' });
      return true;
    }
    if (booking.user_id !== user.id && user.role !== 'admin') {
      sendJson(res, 403, { error: 'Anda tidak berhak membatalkan pengajuan ini.' });
      return true;
    }
    if (![STATUS.PENDING, STATUS.APPROVED].includes(booking.status)) {
      sendJson(res, 409, { error: 'Pengajuan ini sudah tidak aktif.' });
      return true;
    }
    const now = nowWITA();
    if (
      booking.date < now.date ||
      (booking.date === now.date && booking.start_min <= now.minutes)
    ) {
      sendJson(res, 409, {
        error: 'Peminjaman sudah dimulai atau sudah lewat, jadi tidak bisa dibatalkan.',
      });
      return true;
    }
    db.prepare(
      "UPDATE bookings SET status = 'dibatalkan', cancelled_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), id);
    const updated = fetchBooking(db, id);
    notifyCancelled(db, updated, user);
    audit(db, user.id, 'cancel', 'booking', id, updated.code);
    sendJson(res, 200, { booking: publicBooking(updated) });
    return true;
  }

  if (parts[1] === 'bookings' && parts[2] && method === 'GET') {
    const id = Number(parts[2]);
    const booking = fetchBooking(db, id);
    if (!booking) {
      sendJson(res, 404, { error: 'Pengajuan tidak ditemukan.' });
      return true;
    }
    if (booking.user_id !== user.id && user.role !== 'admin') {
      sendJson(res, 403, { error: 'Anda tidak berhak melihat pengajuan ini.' });
      return true;
    }
    sendJson(res, 200, { booking: publicBooking(booking) });
    return true;
  }

  if (pathname === '/api/admin/overview' && method === 'GET' && user.role === 'admin') {
    const today = todayWITA();
    const pending = db
      .prepare(bookingWithRoomQuery("b.status = 'menunggu'", 'b.created_at ASC'))
      .all()
      .map(publicBooking);
    const todayRows = db
      .prepare(bookingWithRoomQuery("b.date = ? AND b.status = 'disetujui'", 'b.start_min ASC'))
      .all(today)
      .map(publicBooking);
    const totalRooms = db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE active = 1').get().n;
    const monthPrefix = today.slice(0, 7);
    const monthCount = db
      .prepare("SELECT COUNT(*) AS n FROM bookings WHERE date LIKE ? AND status != 'dibatalkan'")
      .get(`${monthPrefix}%`).n;
    const approvedMonth = db
      .prepare("SELECT COUNT(*) AS n FROM bookings WHERE date LIKE ? AND status = 'disetujui'")
      .get(`${monthPrefix}%`).n;
    sendJson(res, 200, {
      today,
      stats: {
        pending: pending.length,
        todayApproved: todayRows.length,
        totalRooms,
        monthCount,
        approvedMonth,
      },
      pending: pending.slice(0, 20),
      todayBookings: todayRows,
    });
    return true;
  }

  if (pathname === '/api/admin/bookings' && method === 'GET' && user.role === 'admin') {
    const clauses = [];
    const params = [];
    const status = url.searchParams.get('status');
    if (status && Object.values(STATUS).includes(status)) {
      clauses.push('b.status = ?');
      params.push(status);
    }
    const date = url.searchParams.get('date');
    if (date && isValidDate(date)) {
      clauses.push('b.date = ?');
      params.push(date);
    }
    const roomId = Number(url.searchParams.get('roomId'));
    if (roomId) {
      clauses.push('b.room_id = ?');
      params.push(roomId);
    }
    const where = clauses.length ? clauses.join(' AND ') : '1 = 1';
    const rows = db
      .prepare(`${bookingWithRoomQuery(where)} LIMIT 300`)
      .all(...params);
    sendJson(res, 200, { bookings: rows.map(publicBooking) });
    return true;
  }

  if (
    parts[1] === 'admin' &&
    parts[2] === 'bookings' &&
    parts[3] &&
    parts[4] === 'decision' &&
    method === 'POST' &&
    user.role === 'admin'
  ) {
    const id = Number(parts[3]);
    const body = await readBody(req);
    const decision = String(body.decision || '');
    const reason = text(body.reason, 500);
    if (!['disetujui', 'ditolak'].includes(decision)) {
      sendJson(res, 422, { error: 'Keputusan tidak valid.' });
      return true;
    }
    if (decision === 'ditolak' && reason.length < 5) {
      sendJson(res, 422, {
        error: 'Alasan penolakan wajib diisi minimal 5 karakter.',
        errors: { reason: 'Alasan penolakan wajib diisi minimal 5 karakter.' },
      });
      return true;
    }
    const booking = fetchBooking(db, id);
    if (!booking) {
      sendJson(res, 404, { error: 'Pengajuan tidak ditemukan.' });
      return true;
    }
    if (booking.status !== STATUS.PENDING) {
      sendJson(res, 409, { error: 'Pengajuan ini sudah diproses sebelumnya.' });
      return true;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      if (decision === 'disetujui') {
        const conflict = findConflict(db, {
          roomId: booking.room_id,
          date: booking.date,
          startMin: booking.start_min,
          endMin: booking.end_min,
          ignoreBookingId: booking.id,
        });
        if (conflict) {
          db.exec('ROLLBACK');
          sendJson(res, 409, {
            error: 'Tidak bisa disetujui karena slot kini bertabrakan dengan jadwal lain.',
          });
          return true;
        }
      }
      db.prepare(
        'UPDATE bookings SET status = ?, rejection_reason = ?, decided_by = ?, decided_at = ? WHERE id = ?',
      ).run(
        decision,
        decision === 'ditolak' ? reason : null,
        user.id,
        new Date().toISOString(),
        id,
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const updated = fetchBooking(db, id);
    notifyDecision(db, updated, decision, reason);
    audit(db, user.id, decision === 'disetujui' ? 'approve' : 'reject', 'booking', id, reason || null);
    sendJson(res, 200, { booking: publicBooking(updated) });
    return true;
  }

  if (pathname === '/api/admin/rooms' && method === 'GET' && user.role === 'admin') {
    const rooms = db
      .prepare('SELECT * FROM rooms ORDER BY active DESC, building, floor, name')
      .all()
      .map((room) => ({ ...room, facilities: JSON.parse(room.facilities || '[]') }));
    sendJson(res, 200, { rooms });
    return true;
  }

  if (pathname === '/api/admin/rooms' && method === 'POST' && user.role === 'admin') {
    const body = await readBody(req);
    const result = roomPayload(body);
    if (result.errors) {
      sendJson(res, 422, { error: 'Periksa kembali isian ruangan.', errors: result.errors });
      return true;
    }
    const id = insertRoom(db, result.values);
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    audit(db, user.id, 'create', 'room', id, room.name);
    sendJson(res, 201, { room: { ...room, facilities: JSON.parse(room.facilities) } });
    return true;
  }

  if (parts[1] === 'admin' && parts[2] === 'rooms' && parts[3] && method === 'PATCH' && user.role === 'admin') {
    const id = Number(parts[3]);
    const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    if (!existing) {
      sendJson(res, 404, { error: 'Ruangan tidak ditemukan.' });
      return true;
    }
    const body = await readBody(req);
    const merged = {
      name: body.name ?? existing.name,
      building: body.building ?? existing.building,
      floor: body.floor ?? existing.floor,
      category: body.category ?? existing.category,
      capacity: body.capacity ?? existing.capacity,
      openTime: body.openTime ?? existing.open_time,
      closeTime: body.closeTime ?? existing.close_time,
      maxDurationMinutes: body.maxDurationMinutes ?? existing.max_duration_minutes,
      description: body.description ?? existing.description,
      facilities: body.facilities ?? JSON.parse(existing.facilities || '[]'),
      active: body.active ?? Boolean(existing.active),
    };
    const result = roomPayload(merged, existing);
    if (result.errors) {
      sendJson(res, 422, { error: 'Periksa kembali isian ruangan.', errors: result.errors });
      return true;
    }
    updateRoom(db, id, result.values);
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    audit(db, user.id, 'update', 'room', id, room.name);
    sendJson(res, 200, { room: { ...room, facilities: JSON.parse(room.facilities) } });
    return true;
  }

  if (pathname === '/api/admin/blocks' && method === 'GET' && user.role === 'admin') {
    const date = url.searchParams.get('date');
    const clauses = [];
    const params = [];
    if (date && isValidDate(date)) {
      clauses.push('bl.date = ?');
      params.push(date);
    }
    const where = clauses.length ? clauses.join(' AND ') : '1 = 1';
    const blocks = db
      .prepare(
        `SELECT bl.*, r.name AS room_name, r.building FROM blocks bl
         JOIN rooms r ON r.id = bl.room_id
         WHERE ${where} ORDER BY bl.date ASC, bl.start_min ASC LIMIT 200`,
      )
      .all(...params);
    sendJson(res, 200, { blocks });
    return true;
  }

  if (pathname === '/api/admin/blocks' && method === 'POST' && user.role === 'admin') {
    const body = await readBody(req);
    const roomId = Number(body.roomId);
    const date = text(body.date, 10);
    const start = text(body.start, 5);
    const end = text(body.end, 5);
    const reason = text(body.reason, 160);
    const errors = {};
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
    if (!room) errors.roomId = 'Pilih ruangan.';
    if (!isValidDate(date)) errors.date = 'Pilih tanggal yang valid.';
    const startMin = timeToMin(start);
    const endMin = timeToMin(end);
    if (startMin === null) errors.start = 'Isi jam mulai.';
    if (endMin === null || (startMin !== null && endMin <= startMin)) {
      errors.end = 'Jam selesai harus setelah jam mulai.';
    }
    if (reason.length < 3) errors.reason = 'Isi alasan blokir minimal 3 karakter.';
    if (Object.keys(errors).length) {
      sendJson(res, 422, { error: 'Periksa kembali isian blokir.', errors });
      return true;
    }
    const conflict = findConflict(db, { roomId, date, startMin, endMin });
    if (conflict) {
      sendJson(res, 409, {
        error:
          conflict.type === 'block'
            ? 'Jam tersebut sudah diblokir sebelumnya.'
            : 'Jam tersebut sudah dipakai peminjaman lain. Tolak atau batalkan pengajuan itu terlebih dahulu.',
      });
      return true;
    }
    const info = db
      .prepare(
        'INSERT INTO blocks (room_id, date, start_min, end_min, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(roomId, date, startMin, endMin, reason, user.id, new Date().toISOString());
    audit(db, user.id, 'create', 'block', Number(info.lastInsertRowid), reason);
    const block = db
      .prepare(
        `SELECT bl.*, r.name AS room_name, r.building FROM blocks bl
         JOIN rooms r ON r.id = bl.room_id WHERE bl.id = ?`,
      )
      .get(Number(info.lastInsertRowid));
    sendJson(res, 201, { block });
    return true;
  }

  if (parts[1] === 'admin' && parts[2] === 'blocks' && parts[3] && method === 'DELETE' && user.role === 'admin') {
    const id = Number(parts[3]);
    const info = db.prepare('DELETE FROM blocks WHERE id = ?').run(id);
    if (info.changes === 0) {
      sendJson(res, 404, { error: 'Blokir tidak ditemukan.' });
      return true;
    }
    audit(db, user.id, 'delete', 'block', id, null);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/admin/settings' && method === 'GET' && user.role === 'admin') {
    sendJson(res, 200, { settings: getSettings(db) });
    return true;
  }

  if (pathname === '/api/admin/settings' && method === 'PUT' && user.role === 'admin') {
    const body = await readBody(req);
    const result = saveSettings(db, body);
    if (result.error) {
      sendJson(res, 422, { error: result.error });
      return true;
    }
    audit(db, user.id, 'update', 'settings', null, JSON.stringify(result.settings));
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === '/api/admin/emails' && method === 'GET' && user.role === 'admin') {
    const emails = db
      .prepare('SELECT * FROM email_outbox ORDER BY id DESC LIMIT 100')
      .all();
    sendJson(res, 200, { emails });
    return true;
  }

  if (pathname === '/api/admin/today' && method === 'GET' && user.role === 'admin') {
    const date = todayWITA();
    const bookings = db
      .prepare(
        bookingWithRoomQuery("b.date = ? AND b.status IN ('disetujui','menunggu')", 'b.start_min ASC'),
      )
      .all(date)
      .map(publicBooking);
    sendJson(res, 200, { date, bookings });
    return true;
  }

  if (pathname === '/api/admin/test-email' && method === 'POST' && user.role === 'admin') {
    queueEmail(db, {
      to: user.email,
      subject: '[Ruang IDB] Uji notifikasi email',
      body: 'Ini adalah email uji dari Sistem Peminjaman Ruangan IDB Bali. Pada tahap MVP, email dicatat di outbox dan dapat diperiksa admin melalui panel Log Email.',
    });
    sendJson(res, 201, { ok: true });
    return true;
  }

  return false;
}

function publicBooking(row) {
  return {
    ...row,
    facilities: row.facilities ? JSON.parse(row.facilities) : [],
    status_label: {
      menunggu: 'Menunggu persetujuan',
      disetujui: 'Disetujui',
      ditolak: 'Ditolak',
      dibatalkan: 'Dibatalkan',
    }[row.status],
    start: minToTime(row.start_min),
    end: minToTime(row.end_min),
  };
}
