export const WITA_TIMEZONE = 'Asia/Makassar';
export const STATUS = {
  PENDING: 'menunggu',
  APPROVED: 'disetujui',
  REJECTED: 'ditolak',
  CANCELLED: 'dibatalkan',
};
export const STATUS_LABEL = {
  menunggu: 'Menunggu persetujuan',
  disetujui: 'Disetujui',
  ditolak: 'Ditolak',
  dibatalkan: 'Dibatalkan',
};
export const BLOCKING_STATUSES = [STATUS.PENDING, STATUS.APPROVED];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidDate(value) {
  if (!DATE_RE.test(value || '')) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidTime(value) {
  return TIME_RE.test(value || '');
}

export function timeToMin(value) {
  if (!isValidTime(value)) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function minToTime(min) {
  const safe = Math.max(0, Math.min(24 * 60, Math.round(min)));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function diffDays(from, to) {
  const a = Date.UTC(...from.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  const b = Date.UTC(...to.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  return Math.round((b - a) / 86400000);
}

export function nowWITA() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WITA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const pick = (type) => parts.find((p) => p.type === type)?.value;
  const hour = pick('hour') === '24' ? '00' : pick('hour');
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    time: `${hour}:${pick('minute')}`,
    minutes: Number(hour) * 60 + Number(pick('minute')),
  };
}

export function todayWITA() {
  return nowWITA().date;
}

export function formatDateID(dateStr, options = {}) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'UTC',
    weekday: options.weekday || 'long',
    day: 'numeric',
    month: options.month || 'long',
    year: options.year || 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    minNoticeDays: Number(map.min_notice_days ?? 2),
    maxAdvanceDays: Number(map.max_advance_days ?? 30),
    operationalOpen: map.operational_open ?? '07:00',
    operationalClose: map.operational_close ?? '21:00',
  };
}

export function saveSettings(db, payload) {
  const minNoticeDays = clampInt(payload.minNoticeDays, 0, 30);
  const maxAdvanceDays = clampInt(payload.maxAdvanceDays, 1, 365);
  if (minNoticeDays === null || maxAdvanceDays === null || maxAdvanceDays < minNoticeDays + 1) {
    return { error: 'Batas hari tidak valid. Ajukan maksimal harus lebih besar dari minimal.' };
  }
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  db.exec('BEGIN IMMEDIATE');
  try {
    upsert.run('min_notice_days', String(minNoticeDays));
    upsert.run('max_advance_days', String(maxAdvanceDays));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { settings: getSettings(db) };
}

function clampInt(value, min, max) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) return null;
  return num;
}

export function roomEvents(db, roomId, date) {
  const bookings = db
    .prepare(
      `SELECT id, start_min, end_min, status, activity, participants, org
       FROM bookings
       WHERE room_id = ? AND date = ? AND status IN ('menunggu', 'disetujui')`,
    )
    .all(roomId, date);
  const blocks = db
    .prepare(
      `SELECT id, start_min, end_min, reason
       FROM blocks WHERE room_id = ? AND date = ?`,
    )
    .all(roomId, date);
  return { bookings, blocks };
}

export function findConflict(db, { roomId, date, startMin, endMin, ignoreBookingId = null }) {
  const bookings = db
    .prepare(
      `SELECT id, start_min, end_min, status, activity
       FROM bookings
       WHERE room_id = ? AND date = ? AND status IN ('menunggu', 'disetujui')`,
    )
    .all(roomId, date);
  for (const booking of bookings) {
    if (ignoreBookingId && booking.id === ignoreBookingId) continue;
    if (rangesOverlap(startMin, endMin, booking.start_min, booking.end_min)) {
      return { type: 'booking', booking };
    }
  }
  const blocks = db
    .prepare('SELECT id, start_min, end_min, reason FROM blocks WHERE room_id = ? AND date = ?')
    .all(roomId, date);
  for (const block of blocks) {
    if (rangesOverlap(startMin, endMin, block.start_min, block.end_min)) {
      return { type: 'block', block };
    }
  }
  return null;
}

export function hourCells(db, room, date) {
  const openMin = timeToMin(room.open_time) ?? 7 * 60;
  const closeMin = timeToMin(room.close_time) ?? 21 * 60;
  const { bookings, blocks } = roomEvents(db, room.id, date);
  const cells = [];
  for (let start = openMin; start < closeMin; start += 60) {
    const end = Math.min(start + 60, closeMin);
    const block = blocks.find((b) => rangesOverlap(start, end, b.start_min, b.end_min));
    const approved = bookings.find(
      (b) => b.status === 'disetujui' && rangesOverlap(start, end, b.start_min, b.end_min),
    );
    const pending = bookings.find(
      (b) => b.status === 'menunggu' && rangesOverlap(start, end, b.start_min, b.end_min),
    );
    let state = 'tersedia';
    if (block) state = 'diblokir';
    else if (approved) state = 'terisi';
    else if (pending) state = 'menunggu';
    cells.push({
      start: minToTime(start),
      end: minToTime(end),
      state,
      label:
        state === 'terisi'
          ? approved.activity
          : state === 'diblokir'
            ? block.reason
            : state === 'menunggu'
              ? 'Menunggu persetujuan'
              : 'Tersedia',
    });
  }
  return cells;
}

export function roomAvailability(db, date, filters = {}) {
  const where = ['active = 1'];
  const params = [];
  if (filters.category) {
    where.push('category = ?');
    params.push(filters.category);
  }
  if (filters.capacity) {
    where.push('capacity >= ?');
    params.push(Number(filters.capacity));
  }
  if (filters.q) {
    where.push('(LOWER(name) LIKE ? OR LOWER(building) LIKE ? OR LOWER(facilities) LIKE ?)');
    const q = `%${String(filters.q).toLowerCase()}%`;
    params.push(q, q, q);
  }
  if (filters.facility) {
    where.push('LOWER(facilities) LIKE ?');
    params.push(`%${String(filters.facility).toLowerCase()}%`);
  }
  const rooms = db
    .prepare(`SELECT * FROM rooms WHERE ${where.join(' AND ')} ORDER BY building, floor, name`)
    .all(...params);
  return rooms.map((room) => ({
    ...room,
    facilities: safeJson(room.facilities),
    cells: hourCells(db, room, date),
  }));
}

export function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

export function validateBooking(db, payload, user) {
  const settings = getSettings(db);
  const errors = {};
  const room = db
    .prepare('SELECT * FROM rooms WHERE id = ? AND active = 1')
    .get(Number(payload.roomId));
  if (!room) errors.roomId = 'Pilih ruangan yang masih aktif.';

  const date = String(payload.date || '');
  if (!isValidDate(date)) {
    errors.date = 'Pilih tanggal yang valid.';
  } else {
    const today = todayWITA();
    const diff = diffDays(today, date);
    if (diff < settings.minNoticeDays) {
      errors.date = `Pengajuan paling lambat ${settings.minNoticeDays} hari sebelum kegiatan.`;
    } else if (diff > settings.maxAdvanceDays) {
      errors.date = `Pengajuan paling awal ${settings.maxAdvanceDays} hari sebelum kegiatan.`;
    }
  }

  const startMin = timeToMin(payload.start);
  const endMin = timeToMin(payload.end);
  if (startMin === null) errors.start = 'Isi jam mulai.';
  if (endMin === null) errors.end = 'Isi jam selesai.';
  if (startMin !== null && endMin !== null && endMin <= startMin) {
    errors.end = 'Jam selesai harus setelah jam mulai.';
  }

  if (room && startMin !== null && endMin !== null) {
    const openMin = timeToMin(room.open_time);
    const closeMin = timeToMin(room.close_time);
    if (startMin < openMin || endMin > closeMin) {
      errors.start = `Ruangan dapat dipakai ${room.open_time}–${room.close_time} WITA.`;
    }
    const duration = endMin - startMin;
    if (duration > room.max_duration_minutes) {
      errors.end = `Durasi maksimum ruangan ini ${room.max_duration_minutes / 60} jam.`;
    }
    if (duration < 30) {
      errors.end = 'Durasi minimum 30 menit.';
    }
  }

  const participants = Number(payload.participants);
  if (!Number.isInteger(participants) || participants < 1) {
    errors.participants = 'Isi jumlah peserta minimal 1 orang.';
  } else if (room && participants > room.capacity) {
    errors.participants = `Kapasitas ruangan ini ${room.capacity} orang.`;
  }

  const activity = String(payload.activity || '').trim();
  if (activity.length < 3) errors.activity = 'Isi nama kegiatan minimal 3 karakter.';
  if (activity.length > 120) errors.activity = 'Nama kegiatan maksimal 120 karakter.';

  const purpose = String(payload.purpose || '').trim();
  if (purpose.length < 5) errors.purpose = 'Jelaskan keperluan minimal 5 karakter.';
  if (purpose.length > 600) errors.purpose = 'Keperluan maksimal 600 karakter.';

  const org = String(payload.org || '').trim();
  if (org.length > 120) errors.org = 'Nama organisasi maksimal 120 karakter.';

  if (!user || !user.id) errors.auth = 'Sesi berakhir. Silakan masuk kembali.';

  if (Object.keys(errors).length > 0) return { errors };

  const conflict = findConflict(db, {
    roomId: room.id,
    date,
    startMin,
    endMin,
  });

  if (conflict) {
    return {
      errors: {
        time:
          conflict.type === 'block'
            ? `Jadwal bertabrakan dengan blokir: ${conflict.block.reason}.`
            : 'Jadwal bertabrakan dengan peminjaman lain.',
      },
      conflict,
      suggestions: buildSuggestions(db, {
        room,
        date,
        startMin,
        endMin,
        participants,
      }),
    };
  }

  return { room, date, startMin, endMin, participants, activity, purpose, org };
}

export function buildSuggestions(db, { room, date, startMin, endMin, participants }) {
  const duration = endMin - startMin;
  const { bookings, blocks } = roomEvents(db, room.id, date);
  const events = [
    ...bookings.map((b) => ({ start: b.start_min, end: b.end_min })),
    ...blocks.map((b) => ({ start: b.start_min, end: b.end_min })),
  ];
  const openMin = timeToMin(room.open_time);
  const closeMin = timeToMin(room.close_time);
  const alternateTimes = [];
  for (let candidate = openMin; candidate + duration <= closeMin; candidate += 30) {
    const blocked = events.some((e) => rangesOverlap(candidate, candidate + duration, e.start, e.end));
    if (!blocked) {
      alternateTimes.push({ start: minToTime(candidate), end: minToTime(candidate + duration) });
      if (alternateTimes.length >= 3) break;
    }
  }
  const otherRooms = db
    .prepare('SELECT * FROM rooms WHERE active = 1 AND id != ? AND capacity >= ? ORDER BY capacity ASC')
    .all(room.id, participants || 1);
  const alternateRooms = [];
  for (const other of otherRooms) {
    if (findConflict(db, { roomId: other.id, date, startMin, endMin })) continue;
    alternateRooms.push({ id: other.id, name: other.name, building: other.building, capacity: other.capacity });
    if (alternateRooms.length >= 3) break;
  }
  return { alternateTimes, alternateRooms };
}

export function activeBookingWhere(status) {
  return status ? 'status = ?' : "status IN ('menunggu','disetujui')";
}

export function bookingWithRoomQuery(whereClause, order = 'b.date DESC, b.start_min DESC') {
  return `SELECT b.*, r.name AS room_name, r.building, r.floor, r.capacity, r.category,
                 u.name AS user_name, u.email AS user_email, u.role AS user_role, u.org AS user_org
          FROM bookings b
          JOIN rooms r ON r.id = b.room_id
          JOIN users u ON u.id = b.user_id
          WHERE ${whereClause}
          ORDER BY ${order}`;
}
