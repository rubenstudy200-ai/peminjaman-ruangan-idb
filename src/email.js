import { formatDateID, minToTime, STATUS_LABEL } from './domain.js';

export function queueEmail(db, { to, subject, body, bookingId = null }) {
  const info = db
    .prepare(
      'INSERT INTO email_outbox (to_email, subject, body, booking_id, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(to, subject, body, bookingId, new Date().toISOString());
  console.log(`[email] ke ${to}: ${subject}`);
  return Number(info.lastInsertRowid);
}

export function bookingSummary(booking) {
  return [
    `Kode pengajuan : ${booking.code}`,
    `Ruangan         : ${booking.room_name || ''}`,
    `Tanggal         : ${formatDateID(booking.date)}`,
    `Waktu           : ${minToTime(booking.start_min)}–${minToTime(booking.end_min)} WITA`,
    `Kegiatan        : ${booking.activity}`,
  ].join('\n');
}

export function notifySubmitted(db, booking, user) {
  return queueEmail(db, {
    to: user.email,
    subject: `[Ruang IDB] Pengajuan ${booking.code} diterima`,
    body: `Halo ${user.name},\n\nPengajuan peminjaman ruangan Anda sudah kami terima dan akan diperiksa oleh admin sarana prasarana.\n\n${bookingSummary(booking)}\n\nStatus saat ini: ${STATUS_LABEL[booking.status]}.\nAnda dapat memantau status di halaman Pengajuan Saya.\n\nSalam,\nSistem Peminjaman Ruangan IDB Bali`,
    bookingId: booking.id,
  });
}

export function notifyDecision(db, booking, decision, reason) {
  const approved = decision === 'disetujui';
  return queueEmail(db, {
    to: booking.user_email,
    subject: `[Ruang IDB] Pengajuan ${booking.code} ${approved ? 'disetujui' : 'ditolak'}`,
    body: `Halo ${booking.user_name},\n\nPengajuan peminjaman ruangan Anda telah ${approved ? 'disetujui' : 'ditolak'}.\n\n${bookingSummary(booking)}\n\n${
      approved
        ? 'Silakan gunakan ruangan sesuai jadwal dan jaga kebersihan serta kondisi ruangan.'
        : `Alasan penolakan: ${reason}`
    }\n\nSalam,\nSistem Peminjaman Ruangan IDB Bali`,
    bookingId: booking.id,
  });
}

export function notifyCancelled(db, booking, actor) {
  const admins = db.prepare("SELECT email FROM users WHERE role = 'admin' AND active = 1").all();
  for (const admin of admins) {
    queueEmail(db, {
      to: admin.email,
      subject: `[Ruang IDB] Pembatalan ${booking.code}`,
      body: `Peminjaman berikut dibatalkan oleh ${actor.name}.\n\n${bookingSummary(booking)}\n\nSlot ruangan sudah dibuka kembali untuk pemohon lain.`,
      bookingId: booking.id,
    });
  }
  return queueEmail(db, {
    to: booking.user_email,
    subject: `[Ruang IDB] Pengajuan ${booking.code} dibatalkan`,
    body: `Halo ${booking.user_name},\n\nPeminjaman berikut telah dibatalkan dan slotnya dibuka kembali.\n\n${bookingSummary(booking)}\n\nSalam,\nSistem Peminjaman Ruangan IDB Bali`,
    bookingId: booking.id,
  });
}
