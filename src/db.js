import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hashPassword } from './security.js';
import { addDays, todayWITA } from './domain.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('mahasiswa','dosen','staf','admin')),
  org TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  building TEXT NOT NULL,
  floor TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('kelas','studio','lab','rapat','aula','galeri','serbaguna')),
  facilities TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  open_time TEXT NOT NULL DEFAULT '07:00',
  close_time TEXT NOT NULL DEFAULT '21:00',
  max_duration_minutes INTEGER NOT NULL DEFAULT 240,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  activity TEXT NOT NULL,
  purpose TEXT NOT NULL,
  participants INTEGER NOT NULL,
  org TEXT,
  status TEXT NOT NULL CHECK (status IN ('menunggu','disetujui','ditolak','dibatalkan')),
  rejection_reason TEXT,
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (end_min > start_min)
);

CREATE INDEX IF NOT EXISTS idx_bookings_room_date ON bookings(room_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);

CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK (end_min > start_min)
);

CREATE INDEX IF NOT EXISTS idx_blocks_room_date ON blocks(room_id, date);

CREATE TABLE IF NOT EXISTS email_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  booking_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const ROOMS = [
  {
    name: 'Ruang Kelas 2.1',
    building: 'Gedung A',
    floor: 'Lantai 2',
    capacity: 40,
    category: 'kelas',
    facilities: ['AC', 'Proyektor', 'Papan tulis', 'Stopkontak'],
    description: 'Ruang kelas reguler dengan tata letak U yang dapat diubah menjadi teater.',
    open: '07:00',
    close: '21:00',
    maxDuration: 240,
  },
  {
    name: 'Ruang Kelas 3.2',
    building: 'Gedung A',
    floor: 'Lantai 3',
    capacity: 36,
    category: 'kelas',
    facilities: ['AC', 'Proyektor', 'Papan tulis'],
    description: 'Kelas pagi dengan jendela besar menghadap taman kampus.',
    open: '07:00',
    close: '18:00',
    maxDuration: 240,
  },
  {
    name: 'Studio Desain DKV',
    building: 'Gedung B',
    floor: 'Lantai 2',
    capacity: 30,
    category: 'studio',
    facilities: ['AC', 'Meja gambar', 'Proyektor', 'Sound system'],
    description: 'Studio terbuka untuk kerja gambar, kritik karya, dan workshop visual.',
    open: '08:00',
    close: '21:00',
    maxDuration: 300,
  },
  {
    name: 'Laboratorium Komputer 1',
    building: 'Gedung C',
    floor: 'Lantai 1',
    capacity: 35,
    category: 'lab',
    facilities: ['AC', '30 PC', 'Proyektor', 'Internet kabel'],
    description: 'Lab dengan 30 unit komputer untuk kelas perangkat lunak dan desain digital.',
    open: '08:00',
    close: '20:00',
    maxDuration: 240,
  },
  {
    name: 'Ruang Rapat Senat',
    building: 'Gedung A',
    floor: 'Lantai 3',
    capacity: 16,
    category: 'rapat',
    facilities: ['AC', 'TV', 'Video conference', 'Papan tulis'],
    description: 'Ruang rapat formal dengan meja bundar dan perangkat rapat daring.',
    open: '08:00',
    close: '18:00',
    maxDuration: 180,
  },
  {
    name: 'Aula Utama',
    building: 'Gedung A',
    floor: 'Lantai 1',
    capacity: 200,
    category: 'aula',
    facilities: ['AC', 'Panggung', 'Sound system', 'Proyektor', 'Kursi lipat'],
    description: 'Aula serbaguna untuk acara kampus, pameran besar, dan wisuda.',
    open: '07:00',
    close: '22:00',
    maxDuration: 480,
  },
  {
    name: 'Galeri Nusa',
    building: 'Gedung B',
    floor: 'Lantai 1',
    capacity: 80,
    category: 'galeri',
    facilities: ['AC', 'Partisi', 'Lighting pameran', 'Stopkontak'],
    description: 'Galeri untuk pameran karya mahasiswa dan dosen dengan pencahayaan fleksibel.',
    open: '09:00',
    close: '21:00',
    maxDuration: 360,
  },
  {
    name: 'Ruang Serbaguna',
    building: 'Gedung C',
    floor: 'Lantai 2',
    capacity: 60,
    category: 'serbaguna',
    facilities: ['AC', 'Sound system', 'Kursi lipat', 'Proyektor'],
    description: 'Ruang fleksibel untuk latihan UKM, seminar kecil, dan kegiatan komunitas.',
    open: '08:00',
    close: '21:00',
    maxDuration: 300,
  },
];

function insertBooking(db, booking) {
  const info = db
    .prepare(
      `INSERT INTO bookings
       (user_id, room_id, date, start_min, end_min, activity, purpose, participants, org, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
    .run(
      booking.userId,
      booking.roomId,
      booking.date,
      booking.startMin,
      booking.endMin,
      booking.activity,
      booking.purpose,
      booking.participants,
      booking.org || null,
      booking.status,
    );
  const code = `IDB-${booking.date.slice(2, 4)}${booking.date.slice(5, 7)}-${String(info.lastInsertRowid).padStart(4, '0')}`;
  db.prepare('UPDATE bookings SET code = ? WHERE id = ?').run(code, info.lastInsertRowid);
  return info.lastInsertRowid;
}

function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS total FROM users').get().total;
  if (count > 0) return;

  const password = hashPassword('idb12345');
  const insertUser = db.prepare(
    `INSERT INTO users (name, email, password_hash, role, org, created_at) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  );
  const users = [
    ['Rani Pradnyani', 'rani@idb.ac.id', 'mahasiswa', 'UKM Seni Rupa'],
    ['Sinta Maharani', 'sinta@idb.ac.id', 'dosen', 'Program Studi Manajemen Bisnis'],
    ['Dimas Saputra', 'dimas@idb.ac.id', 'admin', 'Sarana Prasarana'],
    ['Gede Arta', 'gede@idb.ac.id', 'staf', 'Kemahasiswaan'],
  ];
  const userIds = {};
  for (const [name, email, role, org] of users) {
    const info = insertUser.run(name, email, password, role, org);
    userIds[email] = Number(info.lastInsertRowid);
  }

  const insertRoom = db.prepare(
    `INSERT INTO rooms
     (name, building, floor, capacity, category, facilities, description, open_time, close_time, max_duration_minutes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  );
  const roomIds = [];
  for (const room of ROOMS) {
    const info = insertRoom.run(
      room.name,
      room.building,
      room.floor,
      room.capacity,
      room.category,
      JSON.stringify(room.facilities),
      room.description,
      room.open,
      room.close,
      room.maxDuration,
    );
    roomIds.push(Number(info.lastInsertRowid));
  }

  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('min_notice_days', '2');
  insertSetting.run('max_advance_days', '30');

  const today = todayWITA();
  const d = (offset) => addDays(today, offset);
  const adminId = userIds['dimas@idb.ac.id'];

  insertBooking(db, {
    userId: userIds['rani@idb.ac.id'],
    roomId: roomIds[0],
    date: d(3),
    startMin: 9 * 60,
    endMin: 11 * 60,
    activity: 'Rapat Panitia Pameran Nusa',
    purpose: 'Koordinasi pembagian tugas dan jadwal pameran akhir semester.',
    participants: 18,
    org: 'UKM Seni Rupa',
    status: 'disetujui',
  });
  insertBooking(db, {
    userId: userIds['sinta@idb.ac.id'],
    roomId: roomIds[3],
    date: d(2),
    startMin: 13 * 60,
    endMin: 16 * 60,
    activity: 'Pelatihan Adobe Illustrator',
    purpose: 'Kelas pengganti mata kuliah Desain Digital untuk mahasiswa semester 3.',
    participants: 30,
    org: 'Program Studi Desain Komunikasi Visual',
    status: 'menunggu',
  });
  insertBooking(db, {
    userId: userIds['rani@idb.ac.id'],
    roomId: roomIds[5],
    date: d(6),
    startMin: 10 * 60,
    endMin: 14 * 60,
    activity: 'Pameran Karya Mahasiswa',
    purpose: 'Pameran terbuka karya mahasiswa DKV, termasuk pemasangan dan pembongkaran ringan.',
    participants: 120,
    org: 'UKM Seni Rupa',
    status: 'menunggu',
  });
  insertBooking(db, {
    userId: userIds['gede@idb.ac.id'],
    roomId: roomIds[4],
    date: d(4),
    startMin: 10 * 60,
    endMin: 12 * 60,
    activity: 'Rapat Koordinasi Kemahasiswaan',
    purpose: 'Koordinasi bulanan kegiatan kemahasiswaan dan anggaran UKM.',
    participants: 12,
    org: 'Bagian Kemahasiswaan',
    status: 'disetujui',
  });
  insertBooking(db, {
    userId: userIds['sinta@idb.ac.id'],
    roomId: roomIds[2],
    date: d(5),
    startMin: 8 * 60,
    endMin: 12 * 60,
    activity: 'Workshop Tipografi Eksperimental',
    purpose: 'Workshop terbuka untuk mahasiswa dengan narasumber praktisi tipografi.',
    participants: 25,
    org: 'Program Studi Desain Komunikasi Visual',
    status: 'disetujui',
  });

  const insertBlock = db.prepare(
    `INSERT INTO blocks (room_id, date, start_min, end_min, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  );
  insertBlock.run(roomIds[0], d(1), 7 * 60, 9 * 60, 'Perkuliahan tetap — Manajemen Warna', adminId);
  insertBlock.run(roomIds[5], d(2), 7 * 60, 12 * 60, 'Perawatan panggung dan tata suara', adminId);
  insertBlock.run(roomIds[1], d(3), 15 * 60, 17 * 60, 'Rapat dosen tetap', adminId);
  insertBlock.run(roomIds[2], d(4), 17 * 60, 19 * 60, 'Perawatan pencahayaan studio', adminId);
}

export function createDatabase(path = 'data/idb.sqlite') {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec(SCHEMA);
  seed(db);
  return db;
}
