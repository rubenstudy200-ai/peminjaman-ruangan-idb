const app = document.getElementById('app');
const header = document.getElementById('site-header');
const footer = document.getElementById('site-footer');
const userChip = document.getElementById('user-chip');
const navAdmin = document.getElementById('nav-admin');
const toastRegion = document.getElementById('toast-region');
const dialogRoot = document.getElementById('dialog-root');

const CATEGORY_LABEL = {
  kelas: 'Ruang kelas',
  studio: 'Studio',
  lab: 'Laboratorium',
  rapat: 'Ruang rapat',
  aula: 'Aula',
  galeri: 'Galeri',
  serbaguna: 'Serbaguna',
};

const ROOM_PHOTOS = {
  aula: '/assets/rooms/aula.jpg',
  kelas: '/assets/rooms/ruang-kelas.jpg',
  serbaguna: '/assets/rooms/serbaguna.jpg',
  lab: '/assets/rooms/lab-komputer.jpg',
  rapat: '/assets/rooms/ruang-rapat.jpg',
  studio: '/assets/rooms/studio-foto.jpg',
  galeri: '/assets/rooms/galeri.jpg',
};

function roomPhoto(room) {
  return ROOM_PHOTOS[room.category] || null;
}

const ROLE_LABEL = {
  mahasiswa: 'Mahasiswa',
  dosen: 'Dosen',
  staf: 'Staf',
  admin: 'Admin sarana prasarana',
};

const STATUS_LABEL = {
  menunggu: 'Menunggu persetujuan',
  disetujui: 'Disetujui',
  ditolak: 'Ditolak',
  dibatalkan: 'Dibatalkan',
};

const state = {
  user: null,
  settings: { minNoticeDays: 2, maxAdvanceDays: 30 },
  availability: null,
  intended: null,
  adminRooms: null,
  currentPath: undefined,
};

let viewToken = 0;
let availabilitySeq = 0;

class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || 'Terjadi kesalahan. Coba lagi.');
    this.status = status;
    this.data = data || {};
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, {
      error: 'Tidak dapat terhubung ke server. Periksa koneksi Anda lalu coba lagi.',
    });
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function fmtDate(dateStr, { weekday = 'long', month = 'long', year = 'numeric' } = {}) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const options = {
    timeZone: 'UTC',
    day: 'numeric',
    month,
    year: year === null ? undefined : year,
  };
  if (weekday !== null) options.weekday = weekday;
  return new Intl.DateTimeFormat('id-ID', options).format(new Date(Date.UTC(y, m - 1, d)));
}

function dateParts(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return {
    dow: new Intl.DateTimeFormat('id-ID', { weekday: 'short', timeZone: 'UTC' }).format(dt),
    day: String(d),
    month: new Intl.DateTimeFormat('id-ID', { month: 'short', timeZone: 'UTC' }).format(dt),
  };
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Makassar',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function timeLabel(value) {
  return String(value || '').replace(':', '.');
}

function statusChip(status) {
  return `<span class="status status-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/masuk';
  const [path, qs] = raw.split('?');
  return {
    path: path || '/masuk',
    query: new URLSearchParams(qs || ''),
  };
}

let route = parseHash();

function queryString(query) {
  const s = query.toString();
  return s ? `?${s}` : '';
}

function navigate(path, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const next = `#${path}${queryString(query)}`;
  if (window.location.hash === next) {
    route = parseHash();
    render();
    return;
  }
  window.location.hash = next;
}

function setUrlQuery(query) {
  const next = `#${route.path}${queryString(query)}`;
  if (window.location.hash !== next) {
    history.replaceState(null, '', next);
    route = parseHash();
  }
}

function toast(message, type = 'success') {
  if (type !== 'error') {
    toastRegion.querySelectorAll('.toast-success').forEach((el) => el.remove());
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span class="toast-message">${esc(message)}</span><button class="toast-close" type="button" aria-label="Tutup notifikasi">&times;</button>`;
  const close = () => el.remove();
  el.querySelector('.toast-close').addEventListener('click', close);
  toastRegion.appendChild(el);
  if (type !== 'error') {
    setTimeout(close, 5000);
  }
}

function skeletonList(rows = 3) {
  return Array.from({ length: rows })
    .map(
      () => `<div class="skeleton-row">
        <div><div class="skeleton skeleton-line w-60"></div><div class="skeleton skeleton-line w-40"></div><div class="skeleton skeleton-line w-60"></div></div>
        <div><div class="skeleton skeleton-block"></div><div class="skeleton skeleton-line w-40 mt-2xs"></div></div>
      </div>`,
    )
    .join('');
}

function linkFieldError(form, field) {
  if (!form) return;
  const target = form.querySelector(`[data-error-for="${field}"]`);
  if (!target) return;
  if (!target.id) target.id = `${form.id || 'form'}-${field}-error`;
  const input = form.elements[field];
  if (!input) return;
  const ids = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  if (!ids.includes(target.id)) ids.push(target.id);
  input.setAttribute('aria-describedby', ids.join(' '));
}

function errorPanel(message, actionLabel = 'Coba lagi', action = 'retry') {
  return `<div class="error-state" role="alert">
    <p>${esc(message)}</p>
    <button class="btn btn-ghost" type="button" data-action="${esc(action)}">${esc(actionLabel)}</button>
  </div>`;
}

function emptyState({ title, body, actionLabel, action, actionAttrs = '', headingLevel = 3 }) {
  return `<div class="empty-state">
    <span class="empty-mark" aria-hidden="true"></span>
    <h${headingLevel}>${esc(title)}</h${headingLevel}>
    <p>${esc(body)}</p>
    ${actionLabel ? `<button class="btn btn-primary" type="button" data-action="${esc(action)}" ${actionAttrs}>${esc(actionLabel)}</button>` : ''}
  </div>`;
}

function openDialog({ title, sub, body, footer, wide = false, onMount }) {
  const dialog = document.createElement('dialog');
  dialog.className = wide ? 'modal modal-wide' : 'modal';
  dialog.innerHTML = `
    <div class="modal-head">
      <div>
        <h2 class="modal-title" id="dialog-title">${esc(title)}</h2>
        ${sub ? `<p class="modal-sub">${esc(sub)}</p>` : ''}
      </div>
      <button class="icon-close" type="button" aria-label="Tutup" data-close>&times;</button>
    </div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot"><div class="modal-actions">${footer}</div></div>` : ''}
  `;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  dialogRoot.appendChild(dialog);
  dialog.showModal();
  document.body.classList.add('has-dialog');

  const close = () => dialog.close();
  dialog.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', close));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('has-dialog');
  });
  if (onMount) onMount(dialog, close);
  return dialog;
}

function confirmDialog({ title, message, confirmLabel, destructive = false, cancelLabel = 'Batal' }) {
  return new Promise((resolve) => {
    let resolved = false;
    const dialog = openDialog({
      title,
      body: `<p>${esc(message)}</p>`,
      footer: `<button class="btn btn-ghost" type="button" data-close>${esc(cancelLabel)}</button>
               <button class="btn ${destructive ? 'btn-danger' : 'btn-primary'}" type="button" data-confirm>${esc(confirmLabel)}</button>`,
      onMount(d, close) {
        d.querySelector('[data-confirm]').addEventListener('click', () => {
          resolved = true;
          close();
          resolve(true);
        });
        d.addEventListener('close', () => {
          if (!resolved) resolve(false);
        });
      },
    });
    dialog.querySelector('[data-close]').focus();
  });
}

function groupCells(cells) {
  const segments = [];
  for (const cell of cells) {
    const last = segments[segments.length - 1];
    if (last && last.state === cell.state && last.label === cell.label) {
      last.end = cell.end;
    } else {
      segments.push({ start: cell.start, end: cell.end, state: cell.state, label: cell.label });
    }
  }
  return segments;
}

function timelineHtml(cells, roomName) {
  const summary = groupCells(cells)
    .map((s) => `${s.state} pukul ${timeLabel(s.start)} sampai ${timeLabel(s.end)}`)
    .join(', ');
  return `<div class="timeline-hours">${cells
    .map((cell) => `<span>${esc(cell.start.slice(0, 2))}</span>`)
    .join('')}</div>
    <div class="timeline-cells" role="img" aria-label="Ketersediaan ${esc(roomName)}: ${esc(summary)}">
      ${cells
        .map(
          (cell) =>
            `<span class="cell cell-${cell.state}" title="${esc(`${timeLabel(cell.start)}–${timeLabel(cell.end)} · ${cell.label}`)}"></span>`,
        )
        .join('')}
    </div>`;
}

function roomEventsHtml(cells) {
  const segments = groupCells(cells).filter((s) => s.state !== 'tersedia');
  if (segments.length === 0) {
    return `<div class="events-line"><span>Seluruh jam operasional masih kosong.</span></div>`;
  }
  return `<div class="events-line">${segments
    .slice(0, 4)
    .map((s) => {
      const text =
        s.state === 'menunggu'
          ? 'Menunggu persetujuan'
          : s.state === 'diblokir'
            ? s.label
            : s.label;
      return `<span><span class="time">${esc(timeLabel(s.start))}–${esc(timeLabel(s.end))}</span> ${esc(text)}</span>`;
    })
    .join('')}${segments.length > 4 ? `<span>+${segments.length - 4} jadwal lain</span>` : ''}</div>`;
}

function firstAvailable(cells) {
  const cell = cells.find((c) => c.state === 'tersedia');
  if (!cell) return null;
  const endMin = Number(cell.start.slice(0, 2)) * 60 + Number(cell.start.slice(3, 5)) + 60;
  const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  return { start: cell.start, end: cell.end > end ? end : cell.end };
}

function renderUserArea() {
  if (!state.user) {
    userChip.innerHTML = '';
    navAdmin.hidden = true;
    return;
  }
  userChip.innerHTML = `<span><strong>${esc(state.user.name)}</strong><br /><span class="role">${esc(
    ROLE_LABEL[state.user.role] || state.user.role,
  )}</span></span>`;
  navAdmin.hidden = state.user.role !== 'admin';
}

function setActiveNav(path) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    const key = link.dataset.nav;
    const active =
      (key === 'ketersediaan' && path === '/ketersediaan') ||
      (key === 'pengajuan' && path.startsWith('/pengajuan')) ||
      (key === 'admin' && path.startsWith('/admin'));
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

async function init() {
  try {
    const data = await api('/me');
    state.user = data.user;
  } catch {
    state.user = null;
  }
  window.addEventListener('hashchange', () => {
    route = parseHash();
    render();
  });
  document.getElementById('logout-btn').addEventListener('click', logout);
  const skipLink = document.querySelector('.skip-link');
  if (skipLink) {
    skipLink.addEventListener('click', (event) => {
      event.preventDefault();
      app.focus();
    });
  }
  document.addEventListener('click', handleGlobalClick);
  registerServiceWorker();
  render();
}

async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
  state.user = null;
  state.availability = null;
  state.adminRooms = null;
  navigate('/masuk');
  toast('Anda sudah keluar.', 'success');
}

function pageTitle(path) {
  if (path === '/masuk') return 'Masuk — Ruang IDB';
  if (path === '/ketersediaan') return 'Ketersediaan Ruangan — Ruang IDB';
  if (path === '/pengajuan') return 'Pengajuan Saya — Ruang IDB';
  if (path.startsWith('/pengajuan/')) return 'Surat Izin — Ruang IDB';
  if (path.startsWith('/admin')) return 'Panel Admin — Ruang IDB';
  return 'Ruang IDB — Peminjaman Ruangan Kampus';
}

function render() {
  viewToken += 1;
  const token = viewToken;
  document.querySelectorAll('dialog.modal[open]').forEach((dialog) => dialog.close());
  route = parseHash();
  const pathChanged = state.currentPath !== undefined && state.currentPath !== route.path;
  state.currentPath = route.path;
  document.title = pageTitle(route.path);
  if (pathChanged) {
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  }
  const isLoggedIn = Boolean(state.user);
  header.hidden = !isLoggedIn;
  footer.hidden = !isLoggedIn;
  setActiveNav(route.path);
  renderUserArea();

  if (!isLoggedIn) {
    if (route.path !== '/masuk') state.intended = route.path;
    renderLogin(token);
    return;
  }

  if (route.path === '/' || route.path === '/masuk') {
    navigate('/ketersediaan');
    return;
  }

  if (route.path === '/ketersediaan') {
    renderAvailability(token);
    return;
  }

  if (route.path === '/pengajuan') {
    renderMyBookings(token);
    return;
  }

  if (route.path.startsWith('/pengajuan/')) {
    const id = Number(route.path.split('/')[2]);
    renderBookingDetail(token, id);
    return;
  }

  if (route.path === '/admin' || route.path.startsWith('/admin/')) {
    if (state.user.role !== 'admin') {
      app.innerHTML = `<div class="page page-narrow">
        <p class="eyebrow">Akses terbatas</p>
        <h1 class="page-title">Halaman ini untuk admin sarana prasarana.</h1>
        <p class="page-lede">Akun Anda (${esc(ROLE_LABEL[state.user.role] || state.user.role)}) tidak memiliki akses ke panel admin. Hubungi bagian sarana prasarana bila Anda memerlukan bantuan.</p>
        <div class="surat-actions"><a class="btn btn-primary" href="#/ketersediaan">Kembali ke ketersediaan</a></div>
      </div>`;
      return;
    }
    const tab = route.path.split('/')[2] || '';
    renderAdmin(token, tab);
    return;
  }

  app.innerHTML = `<div class="page page-narrow">
    <p class="eyebrow">Halaman tidak ditemukan</p>
    <h1 class="page-title">Alamat ini tidak ada.</h1>
    <p class="page-lede">Mungkin tautannya sudah berubah. Kembali ke halaman ketersediaan untuk melihat ruang yang kosong.</p>
    <div class="surat-actions"><a class="btn btn-primary" href="#/ketersediaan">Buka ketersediaan ruangan</a></div>
  </div>`;
}

/* ---------------- Login ---------------- */

function loginVideoFigure(extraClass = '') {
  return `<figure class="login-video ${extraClass}">
    <div class="login-video-frame">
      <button class="video-facade" type="button" data-action="load-video" data-video="cZCgsSb2cEk" aria-label="Putar video: Virtual tour kampus IDB Bali">
        <img src="/assets/video-thumb.jpg" alt="" width="480" height="360" />
        <span class="video-play" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
        </span>
      </button>
    </div>
    <figcaption>
      <span>Kenali IDB Bali</span>
      <a href="https://www.youtube.com/watch?v=cZCgsSb2cEk" target="_blank" rel="noopener noreferrer">Tonton di YouTube ↗</a>
    </figcaption>
  </figure>`;
}

function mountLoginVideo(figure, { autoplay = false } = {}) {
  if (!figure) return;
  const frame = figure.querySelector('.login-video-frame');
  if (!frame) return;
  const videoId = figure.querySelector('[data-video]')?.dataset.video || 'cZCgsSb2cEk';
  const id = encodeURIComponent(videoId);
  const params = autoplay ? 'autoplay=1&mute=1&playsinline=1&rel=0' : 'autoplay=1&rel=0';
  frame.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?${params}" title="Video Institut Desain dan Bisnis Bali" allow="autoplay; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}

function renderLogin(token) {
  app.innerHTML = `
    <div class="login-shell">
      <aside class="login-aside">
        <div class="login-aside-mark" aria-hidden="true"><img src="/assets/idb-mark.png" alt="" /></div>
        <div class="login-brand">
          <img class="brand-logo" src="/assets/idb-mark.png" alt="" width="34" height="34" />
          <span class="brand-text"><span class="brand-name">Ruang IDB</span><span class="brand-sub">Institut Desain dan Bisnis Bali</span></span>
        </div>
        <div class="login-aside-body">
          <p class="login-quote">Ruang yang tepat,<br />tanpa harus <em>bolak-balik</em> bertanya.</p>
          ${loginVideoFigure('login-video--aside')}
        </div>
        <p class="login-aside-foot">Satu tempat untuk melihat ruang kosong, mengajukan peminjaman, dan memantau persetujuan sivitas akademika IDB Bali.</p>
      </aside>
      <div class="login-main">
        <div class="login-card">
          <div class="login-mobile-brand">
            <img class="brand-logo" src="/assets/idb-mark.png" alt="" width="30" height="30" />
            <span class="brand-text"><span class="brand-name">Ruang IDB</span><span class="brand-sub">Institut Desain dan Bisnis Bali</span></span>
          </div>
          <p class="eyebrow">Masuk</p>
          <h1 class="page-title">Gunakan akun kampus IDB.</h1>
          <p class="page-lede text-sm">Hanya sivitas akademika IDB Bali yang dapat meminjam ruangan.</p>
          <form class="login-form" id="login-form" novalidate>
            <div id="login-error"></div>
            <div class="field">
              <label for="login-email">Email kampus</label>
              <input id="login-email" name="email" type="email" inputmode="email" autocomplete="username" placeholder="nama@idb.ac.id" required />
              <span class="field-hint">Contoh: rani@idb.ac.id</span>
            </div>
            <div class="field">
              <label for="login-password">Kata sandi</label>
              <input id="login-password" name="password" type="password" autocomplete="current-password" required minlength="6" />
            </div>
            <button class="btn btn-primary btn-block" type="submit" id="login-submit">Masuk ke Ruang IDB</button>
          </form>
          <details class="demo-accounts">
            <summary>Akun demo untuk mencoba</summary>
            <div class="demo-list">
              <button type="button" data-action="login-demo" data-email="rani@idb.ac.id" data-password="idb12345"><span><strong>Rani</strong> — mahasiswa / UKM</span><span>Pemohon</span></button>
              <button type="button" data-action="login-demo" data-email="sinta@idb.ac.id" data-password="idb12345"><span><strong>Bu Sinta</strong> — dosen</span><span>Pemohon</span></button>
              <button type="button" data-action="login-demo" data-email="dimas@idb.ac.id" data-password="idb12345"><span><strong>Pak Dimas</strong> — sarana prasarana</span><span>Admin</span></button>
            </div>
            <p class="small mt-2xs">Kata sandi semua akun demo: <strong>idb12345</strong></p>
          </details>
          ${loginVideoFigure('login-video--mobile')}
        </div>
      </div>
    </div>
  `;

  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submit = document.getElementById('login-submit');
    const errorBox = document.getElementById('login-error');
    errorBox.innerHTML = '';
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: {
          email: form.email.value,
          password: form.password.value,
        },
      });
      if (token !== viewToken) return;
      state.user = data.user;
      const intended = state.intended && state.intended !== '/masuk' ? state.intended : '/ketersediaan';
      state.intended = null;
      toast(`Selamat datang, ${data.user.name}.`);
      navigate(intended);
    } catch (error) {
      errorBox.innerHTML = `<div class="form-error" role="alert">${esc(error.message)}</div>`;
      form.password.focus();
    } finally {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
    }
  });

  const wide = window.matchMedia('(min-width: 961px)').matches;
  mountLoginVideo(document.querySelector(wide ? '.login-video--aside' : '.login-video--mobile'), {
    autoplay: true,
  });
}

/* ---------------- Availability ---------------- */

function currentAvailabilityDate() {
  const qDate = route.query.get('date');
  if (qDate && /^\d{4}-\d{2}-\d{2}$/.test(qDate)) return qDate;
  return addDays(todayStr(), state.settings.minNoticeDays);
}

function renderAvailability(token) {
  const today = todayStr();
  const minDate = addDays(today, state.settings.minNoticeDays);
  const maxDate = addDays(today, state.settings.maxAdvanceDays);
  const requestedDate = currentAvailabilityDate();
  const date = requestedDate < minDate ? minDate : requestedDate > maxDate ? maxDate : requestedDate;
  const span = Math.max(
    0,
    Math.round((Date.parse(`${maxDate}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86400000),
  );
  const days = Array.from({ length: span + 1 }, (_, i) => addDays(today, i));
  const query = route.query;
  const filters = {
    q: query.get('q') || '',
    category: query.get('category') || '',
    capacity: query.get('capacity') || '',
    facility: query.get('facility') || '',
  };

  const dateButtons = days
    .map((d) => {
      const p = dateParts(d);
      const disabled = d < minDate || d > maxDate;
      return `<button class="date-btn ${d === date ? 'is-active' : ''}" type="button" data-action="pick-date" data-date="${d}" aria-pressed="${d === date}" aria-label="${esc(fmtDate(d))}" ${disabled ? 'disabled' : ''}>
        <span class="date-dow">${esc(p.dow)}</span>
        <span class="date-num">${esc(p.day)}</span>
        <span class="date-month">${esc(p.month)}</span>
      </button>`;
    })
    .join('');

  const gallery = [
    { label: 'Perpustakaan', src: '/assets/rooms/perpustakaan.jpg' },
    { label: 'Ruang kelas', src: '/assets/rooms/ruang-kelas.jpg' },
    { label: 'Aula', src: '/assets/rooms/aula.jpg' },
    { label: 'Ruang serbaguna', src: '/assets/rooms/serbaguna.jpg' },
    { label: 'Lab komputer', src: '/assets/rooms/lab-komputer.jpg' },
    { label: 'Lab iMac', src: '/assets/rooms/lab-imac.jpg' },
    { label: 'Ruang rapat', src: '/assets/rooms/ruang-rapat.jpg' },
    { label: 'Studio foto', src: '/assets/rooms/studio-foto.jpg' },
    { label: 'Galeri', src: '/assets/rooms/galeri.jpg' },
  ];

  app.innerHTML = `
    <div class="availability-page">
      <section class="app-hero" aria-labelledby="app-hero-title">
        <div class="app-hero-inner">
          <div class="app-hero-copy">
            <p class="eyebrow">Sistem peminjaman ruangan · IDB Bali</p>
            <h1 class="app-hero-title" id="app-hero-title">Ruang kampus,<br />tanpa <span class="accent-word">bentrok</span>.</h1>
            <p class="app-hero-lede">Lihat ruang yang kosong, ajukan peminjaman, dan pantau persetujuan dalam satu tempat. Dibuat untuk mahasiswa, dosen, dan staf Institut Desain dan Bisnis Bali.</p>
            <div class="hero-actions">
              <button class="btn btn-primary" type="button" data-action="scroll-schedule">Lihat ketersediaan <span aria-hidden="true">↓</span></button>
              <a class="text-link" href="#/pengajuan">Riwayat pengajuan</a>
            </div>
            <p class="hero-note">Ajukan paling lambat ${state.settings.minNoticeDays} hari sebelum kegiatan · Tanggal dan jam dalam WITA</p>
          </div>
          <div class="app-hero-brand">
            <img class="app-hero-mark" src="/assets/idb-mark.png" alt="Logo Institut Desain dan Bisnis Bali" width="260" height="260" />
            <p class="app-hero-caption"><strong>Institut Desain &amp; Bisnis Bali</strong><span>Empowering People to be Creative</span></p>
          </div>
        </div>
      </section>

      <div class="page">
        <section class="schedule" id="schedule" aria-labelledby="schedule-title">
          <div class="availability-head">
            <div>
              <p class="eyebrow">Ketersediaan ruangan</p>
              <h2 class="schedule-title" id="schedule-title">Pilih tanggal, lalu ruang.</h2>
              <p class="schedule-lede">Cari ruang kosong, ajukan peminjaman, dan pantau statusnya.</p>
            </div>
            <div class="head-note">
              <strong id="head-note-date">${esc(fmtDate(date, { weekday: 'long', month: 'long' }))}</strong>
              <span id="head-note-count">Memuat ketersediaan…</span>
            </div>
          </div>

          <div class="date-strip-wrap">
        <div class="date-strip" role="group" aria-label="Pilih tanggal">${dateButtons}</div>
      </div>

      <form class="filters" id="filter-form" role="search" aria-label="Saring ruangan">
        <div class="field search-field">
          <label for="filter-q">Cari ruangan</label>
          <input id="filter-q" name="q" type="search" placeholder="Nama ruangan, gedung, fasilitas" value="${esc(filters.q)}" />
        </div>
        <div class="field">
          <label for="filter-category">Kategori</label>
          <select id="filter-category" name="category">
            <option value="">Semua</option>
            ${Object.entries(CATEGORY_LABEL)
              .map(([value, label]) => `<option value="${value}" ${filters.category === value ? 'selected' : ''}>${esc(label)}</option>`)
              .join('')}
          </select>
        </div>
        <div class="field">
          <label for="filter-capacity">Kapasitas</label>
          <select id="filter-capacity" name="capacity">
            <option value="">Semua</option>
            ${[16, 30, 50, 100, 150]
              .map((n) => `<option value="${n}" ${filters.capacity === String(n) ? 'selected' : ''}>≥ ${n} orang</option>`)
              .join('')}
          </select>
        </div>
        <div class="field">
          <label for="filter-facility">Fasilitas</label>
          <select id="filter-facility" name="facility">
            <option value="">Semua</option>
            ${['Proyektor', 'AC', 'Sound system', 'Panggung']
              .map((f) => `<option value="${f}" ${filters.facility === f ? 'selected' : ''}>${f}</option>`)
              .join('')}
          </select>
        </div>
        <button class="btn btn-quiet filter-reset" type="button" data-action="clear-filters">Bersihkan saringan</button>
      </form>

      <div class="legend" role="group" aria-label="Legenda warna">
        <span class="legend-item"><span class="legend-swatch swatch-tersedia"></span> Tersedia</span>
        <span class="legend-item"><span class="legend-swatch swatch-menunggu"></span> Menunggu persetujuan</span>
        <span class="legend-item"><span class="legend-swatch swatch-terisi"></span> Terisi</span>
        <span class="legend-item"><span class="legend-swatch swatch-diblokir"></span> Diblokir</span>
      </div>

      <div id="room-results" aria-live="polite">${skeletonList(3)}</div>

        <section class="campus-gallery" aria-labelledby="gallery-title">
          <p class="eyebrow">Fasilitas kampus</p>
          <h2 class="schedule-title" id="gallery-title">Beberapa ruang di IDB Bali.</h2>
          <div class="campus-gallery-grid">
            ${gallery
              .map(
                (item) => `<figure class="campus-photo">
                  <img src="${item.src}" alt="${esc(item.label)} IDB Bali" loading="lazy" width="400" height="300" />
                  <figcaption>${esc(item.label)}</figcaption>
                </figure>`,
              )
              .join('')}
          </div>
        </section>
        </section>
      </div>
    </div>
  `;

  setupAvailabilityFilters(token, date);
  loadAvailability(token, date);
}

function setupAvailabilityFilters(token, date) {
  const form = document.getElementById('filter-form');
  let debounce;
  const apply = () => {
    const query = new URLSearchParams();
    query.set('date', date);
    const q = form.q.value.trim();
    if (q) query.set('q', q);
    if (form.category.value) query.set('category', form.category.value);
    if (form.capacity.value) query.set('capacity', form.capacity.value);
    if (form.facility.value) query.set('facility', form.facility.value);
    setUrlQuery(query);
    loadAvailability(token, date);
  };
  form.q.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(apply, 250);
  });
  form.category.addEventListener('change', apply);
  form.capacity.addEventListener('change', apply);
  form.facility.addEventListener('change', apply);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    apply();
  });
}

async function loadAvailability(token, date) {
  const results = document.getElementById('room-results');
  if (!results) return;
  const seq = ++availabilitySeq;
  results.setAttribute('aria-busy', 'true');
  const params = new URLSearchParams({ date });
  const q = route.query;
  for (const key of ['q', 'category', 'capacity', 'facility']) {
    const value = q.get(key);
    if (value) params.set(key, value);
  }
  try {
    const data = await api(`/rooms?${params.toString()}`);
    if (token !== viewToken || seq !== availabilitySeq) return;
    state.settings = data.settings;
    state.availability = { date: data.date, rooms: data.rooms };
    const note = document.getElementById('head-note-count');
    if (note) {
      const totalFree = data.rooms.reduce(
        (sum, room) => sum + room.cells.filter((c) => c.state === 'tersedia').length,
        0,
      );
      note.textContent = `${data.rooms.length} ruangan · ${totalFree} jam kosong`;
    }
    results.innerHTML = renderRoomList(data.rooms);
  } catch (error) {
    if (token !== viewToken || seq !== availabilitySeq) return;
    results.innerHTML = errorPanel(error.message, 'Coba lagi', 'retry-rooms');
  } finally {
    if (token === viewToken && seq === availabilitySeq) results.removeAttribute('aria-busy');
  }
}

function renderRoomList(rooms) {
  if (rooms.length === 0) {
    return emptyState({
      title: 'Tidak ada ruangan yang cocok',
      body: 'Coba longgarkan saringan — misalnya kapasitas lebih kecil atau fasilitas lain — atau pilih tanggal berbeda.',
      actionLabel: 'Bersihkan saringan',
      action: 'clear-filters',
      headingLevel: 2,
    });
  }
  return `<div class="room-list">${rooms
    .map((room) => {
      const free = room.cells.filter((c) => c.state === 'tersedia').length;
      const slot = firstAvailable(room.cells);
      const photo = roomPhoto(room);
      const facilities = (room.facilities || []).slice(0, 5).map((f) => esc(f)).join(' · ');
      return `<article class="room-row">
        <div class="room-photo${photo ? '' : ' room-photo--empty'}">
          ${photo ? `<img src="${photo}" alt="Foto ${esc(room.name)}" loading="lazy" width="400" height="300" />` : ''}
        </div>
        <div class="room-id">
          <p class="eyebrow">${esc(CATEGORY_LABEL[room.category] || room.category)} · ${esc(room.building)} ${esc(room.floor)}</p>
          <h2 class="room-name">${esc(room.name)}</h2>
          <p class="room-meta">${room.capacity} orang<span class="dot">·</span>${esc(room.open_time)}–${esc(room.close_time)} WITA</p>
          ${facilities ? `<p class="facility-line">${facilities}</p>` : ''}
          <div class="room-actions">
            <button class="btn btn-primary btn-sm" type="button" data-action="open-booking" data-room="${room.id}" data-date="${esc(state.availability.date)}" data-start="${slot ? esc(slot.start) : ''}" data-end="${slot ? esc(slot.end) : ''}" aria-label="Ajukan peminjaman ${esc(room.name)}">Ajukan peminjaman</button>
            <button class="btn btn-ghost btn-sm" type="button" data-action="room-detail" data-room="${room.id}" aria-label="Lihat detail ${esc(room.name)}">Lihat detail</button>
          </div>
        </div>
        <div class="room-schedule">
          ${timelineHtml(room.cells, room.name)}
          <div class="timeline-caption">
            <span>${esc(room.open_time)}–${esc(room.close_time)} WITA</span>
            <span>${free} dari ${room.cells.length} jam kosong</span>
          </div>
          ${roomEventsHtml(room.cells)}
        </div>
      </article>`;
    })
    .join('')}</div>`;
}

/* ---------------- Booking dialog ---------------- */

async function openBookingDialog({ roomId, date, start, end }) {
  const today = todayStr();
  const minDate = addDays(today, state.settings.minNoticeDays);
  const maxDate = addDays(today, state.settings.maxAdvanceDays);
  let bookingDate = date && date >= minDate && date <= maxDate ? date : minDate;
  let currentRoomId = Number(roomId) || null;
  let startTime = start || '09:00';
  let endTime = end || addHour(startTime);
  if (endTime <= startTime) endTime = addHour(startTime);

  const dialog = openDialog({
    title: 'Ajukan peminjaman',
    sub: 'Pilih ruang, isi keperluan, lalu kirim. Admin akan memeriksa pengajuan Anda.',
    wide: true,
    body: `
      <form id="booking-form" class="form-grid" novalidate>
        <div id="booking-error" role="alert" tabindex="-1"></div>
        <div id="booking-suggestions"></div>
        <div id="booking-summary"></div>
        <div class="form-row">
          <div class="field">
            <label for="bk-room">Ruangan</label>
            <select id="bk-room" name="roomId" required aria-describedby="bk-room-hint"></select>
            <span class="field-hint" id="bk-room-hint"></span>
            <span class="field-error" data-error-for="roomId"></span>
          </div>
          <div class="field">
            <label for="bk-date">Tanggal kegiatan</label>
            <input id="bk-date" name="date" type="date" required min="${minDate}" max="${maxDate}" value="${bookingDate}" aria-describedby="bk-date-hint" />
            <span class="field-hint" id="bk-date-hint">Antara ${esc(fmtDate(minDate, { weekday: null, month: 'short' }))} dan ${esc(fmtDate(maxDate, { weekday: null, month: 'short' }))}.</span>
            <span class="field-error" data-error-for="date"></span>
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="bk-start">Jam mulai (WITA)</label>
            <input id="bk-start" name="start" type="time" required step="1800" value="${startTime}" />
            <span class="field-error" data-error-for="start"></span>
          </div>
          <div class="field">
            <label for="bk-end">Jam selesai (WITA)</label>
            <input id="bk-end" name="end" type="time" required step="1800" value="${endTime}" />
            <span class="field-error" data-error-for="end"></span>
          </div>
        </div>
        <div id="booking-availability" class="mini-timeline" aria-live="polite"></div>
        <div class="form-row">
          <div class="field">
            <label for="bk-activity">Nama kegiatan</label>
            <input id="bk-activity" name="activity" type="text" maxlength="120" required placeholder="Contoh: Rapat panitia pameran" />
            <span class="field-error" data-error-for="activity"></span>
          </div>
          <div class="field">
            <label for="bk-participants">Jumlah peserta</label>
            <input id="bk-participants" name="participants" type="number" inputmode="numeric" min="1" max="1000" step="1" required value="10" />
            <span class="field-error" data-error-for="participants"></span>
          </div>
        </div>
        <div class="field">
          <label for="bk-org">Organisasi / UKM <span class="muted">(opsional)</span></label>
          <input id="bk-org" name="org" type="text" maxlength="120" value="${esc(state.user.org || '')}" />
          <span class="field-error" data-error-for="org"></span>
        </div>
        <div class="field">
          <label for="bk-purpose">Keperluan</label>
          <textarea id="bk-purpose" name="purpose" maxlength="600" required placeholder="Jelaskan singkat kegiatan dan kebutuhan ruangannya."></textarea>
          <span class="field-error" data-error-for="purpose"></span>
        </div>
        <div class="notice">Pengajuan yang sudah disetujui dapat dibatalkan sendiri sebelum waktu mulai. Mohon jaga kebersihan dan kondisi ruangan.</div>
      </form>
    `,
    footer: `
      <button class="btn btn-ghost" type="button" data-close>Batal</button>
      <button class="btn btn-primary" type="submit" form="booking-form" id="booking-submit">Kirim pengajuan</button>
    `,
  });

  const form = dialog.querySelector('#booking-form');
  const roomSelect = form.querySelector('#bk-room');
  const dateInput = form.querySelector('#bk-date');
  const startInput = form.querySelector('#bk-start');
  const endInput = form.querySelector('#bk-end');
  const summary = dialog.querySelector('#booking-summary');
  const availabilityBox = dialog.querySelector('#booking-availability');
  const errorBox = dialog.querySelector('#booking-error');
  const suggestionsBox = dialog.querySelector('#booking-suggestions');
  const submit = dialog.querySelector('#booking-submit');
  let rooms = [];
  let roomMap = new Map();
  let requestSeq = 0;

  function addHour(time) {
    const [h, m] = time.split(':').map(Number);
    const total = Math.min(23 * 60 + 59, h * 60 + m + 60);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  function selectedRoom() {
    return roomMap.get(Number(roomSelect.value));
  }

  function updateRoomHint() {
    const room = selectedRoom();
    if (!room) {
      availabilityBox.innerHTML = '';
      return;
    }
    dialog.querySelector('#bk-room-hint').textContent = `${room.open_time}–${room.close_time} WITA · maks ${room.max_duration_minutes / 60} jam · kapasitas ${room.capacity} orang`;
    const cells = room.cells || [];
    const free = cells.filter((c) => c.state === 'tersedia').length;
    availabilityBox.innerHTML = `${timelineHtml(cells, room.name)}
      <p class="field-hint mt-2xs">${free} dari ${cells.length} jam masih kosong pada tanggal ini.</p>`;
    form.querySelector('#bk-participants').max = String(room.capacity);
  }

  async function loadRooms() {
    const seq = ++requestSeq;
    availabilityBox.innerHTML = '<span class="field-hint">Memuat ketersediaan…</span>';
    try {
      const data = await api(`/rooms?date=${encodeURIComponent(bookingDate)}`);
      if (seq !== requestSeq) return;
      state.settings = data.settings;
      rooms = data.rooms.filter((room) => room.id);
      roomMap = new Map(rooms.map((room) => [room.id, room]));
      const keep = rooms.some((room) => room.id === currentRoomId) ? currentRoomId : rooms[0]?.id;
      roomSelect.innerHTML = rooms
        .map(
          (room) =>
            `<option value="${room.id}" ${room.id === keep ? 'selected' : ''}>${esc(room.name)} — ${esc(room.building)}, ${room.capacity} orang</option>`,
        )
        .join('');
      currentRoomId = keep;
      updateRoomHint();
      dateInput.min = addDays(today, data.settings.minNoticeDays);
      dateInput.max = addDays(today, data.settings.maxAdvanceDays);
    } catch (error) {
      availabilityBox.innerHTML = `<div class="form-error" role="alert">${esc(error.message)}</div>`;
    }
  }

  function clearErrors() {
    errorBox.innerHTML = '';
    suggestionsBox.innerHTML = '';
    form.querySelectorAll('[data-error-for]').forEach((el) => (el.textContent = ''));
    form.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
  }

  function showError(error) {
    const data = error.data || {};
    errorBox.innerHTML = `<div class="form-error" role="alert">${esc(data.error || error.message)}</div>`;
    if (data.errors) {
      for (const [field, message] of Object.entries(data.errors)) {
        const target = form.querySelector(`[data-error-for="${field}"]`);
        if (target) target.textContent = message;
        const input = form.elements[field];
        if (input) input.setAttribute('aria-invalid', 'true');
        linkFieldError(form, field);
      }
    }
    if (data.suggestions) {
      const { alternateTimes = [], alternateRooms = [] } = data.suggestions;
      const timeButtons = alternateTimes
        .map(
          (slot) =>
            `<button class="suggestion-btn" type="button" data-action="suggest-time" data-start="${esc(slot.start)}" data-end="${esc(slot.end)}">${esc(timeLabel(slot.start))}–${esc(timeLabel(slot.end))} WITA</button>`,
        )
        .join('');
      const roomButtons = alternateRooms
        .map(
          (room) =>
            `<button class="suggestion-btn" type="button" data-action="suggest-room" data-room="${room.id}">${esc(room.name)} · ${esc(room.building)} · ${room.capacity} orang</button>`,
        )
        .join('');
      if (timeButtons || roomButtons) {
        suggestionsBox.innerHTML = `<div class="suggestions">
          <h4>Pilihan lain yang masih kosong</h4>
          ${timeButtons ? `<p class="field-hint">Jam lain di ruangan ini:</p><div class="inline-actions">${timeButtons}</div>` : ''}
          ${roomButtons ? `<p class="field-hint mt-2xs">Ruangan lain pada jam yang sama:</p><div class="inline-actions">${roomButtons}</div>` : ''}
        </div>`;
      }
    }
    const first = form.querySelector('[aria-invalid="true"]');
    if (first) {
      first.focus();
    } else {
      errorBox.focus({ preventScroll: true });
      errorBox.scrollIntoView({ block: 'nearest' });
    }
  }

  roomSelect.addEventListener('change', () => {
    currentRoomId = Number(roomSelect.value);
    updateRoomHint();
  });
  dateInput.addEventListener('change', () => {
    bookingDate = dateInput.value;
    loadRooms();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    const errors = {};
    if (!roomSelect.value) errors.roomId = 'Pilih ruangan yang ingin dipinjam.';
    if (!dateInput.value) errors.date = 'Pilih tanggal kegiatan.';
    if (!startInput.value) errors.start = 'Isi jam mulai.';
    if (!endInput.value) errors.end = 'Isi jam selesai.';
    if (!form.activity.value.trim()) errors.activity = 'Isi nama kegiatan.';
    const participants = Number(form.participants.value);
    if (!form.participants.value || !Number.isInteger(participants) || participants < 1) {
      errors.participants = 'Isi jumlah peserta minimal 1 orang.';
    }
    if (!form.purpose.value.trim()) errors.purpose = 'Isi keperluan kegiatan.';
    if (Object.keys(errors).length > 0) {
      showError(new ApiError(422, { error: 'Lengkapi isian yang ditandai sebelum mengirim.', errors }));
      return;
    }
    if (endInput.value <= startInput.value) {
      showError(new ApiError(422, { errors: { end: 'Jam selesai harus setelah jam mulai.' } }));
      endInput.focus();
      return;
    }
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    try {
      const data = await api('/bookings', {
        method: 'POST',
        body: {
          roomId: Number(roomSelect.value),
          date: dateInput.value,
          start: startInput.value,
          end: endInput.value,
          activity: form.activity.value,
          participants: Number(form.participants.value),
          org: form.org.value,
          purpose: form.purpose.value,
        },
      });
      dialog.close();
      toast('Pengajuan terkirim. Admin akan memeriksa dan mengirim email keputusan.');
      navigate(`/pengajuan/${data.booking.id}`, { baru: 1 });
    } catch (error) {
      showError(error);
    } finally {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
    }
  });

  dialog.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'suggest-time') {
      startInput.value = btn.dataset.start;
      endInput.value = btn.dataset.end;
      startInput.focus();
    }
    if (btn.dataset.action === 'suggest-room') {
      currentRoomId = Number(btn.dataset.room);
      roomSelect.value = String(currentRoomId);
      updateRoomHint();
      roomSelect.focus();
    }
  });

  await loadRooms();
  const first = form.querySelector('select, input');
  if (first) first.focus();
}

/* ---------------- Room detail ---------------- */

async function openRoomDetail(roomId) {
  const cached = state.availability?.rooms?.find((room) => room.id === Number(roomId));
  let room = cached;
  let date = state.availability?.date || currentAvailabilityDate();
  if (!room) {
    try {
      const data = await api(`/rooms/${roomId}?date=${date}`);
      room = { ...data.room, cells: data.cells };
      date = data.date;
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
  }
  const free = room.cells.filter((c) => c.state === 'tersedia').length;
  const slot = firstAvailable(room.cells);
  const photo = roomPhoto(room);
  openDialog({
    title: room.name,
    sub: `${CATEGORY_LABEL[room.category] || room.category} · ${room.building}, ${room.floor}`,
    wide: true,
    body: `
      ${photo ? `<img class="room-detail-photo" src="${photo}" alt="Foto ${esc(room.name)}" width="880" height="360" />` : ''}
      <p>${esc(room.description || '')}</p>
      <div class="room-facts">
        <span><strong>${room.capacity}</strong> orang</span>
        <span><strong>${esc(room.open_time)}–${esc(room.close_time)}</strong> WITA</span>
        <span>Durasi maks <strong>${room.max_duration_minutes / 60} jam</strong></span>
      </div>
      <p class="field-hint mt-s">Fasilitas: ${(room.facilities || []).map((f) => esc(f)).join(' · ') || '—'}</p>
      <div class="panel">
        <div class="section-head"><h3 class="section-title section-title-sm">Jadwal ${esc(fmtDate(date, { weekday: 'long', month: 'long' }))}</h3><span class="field-hint">${free} jam kosong</span></div>
        ${timelineHtml(room.cells, room.name)}
        <div class="timeline-caption"><span>${esc(room.open_time)}–${esc(room.close_time)} WITA</span><span>Klik Ajukan untuk memilih jam</span></div>
        ${roomEventsHtml(room.cells)}
      </div>
    `,
    footer: `<button class="btn btn-ghost" type="button" data-close>Tutup</button>
             <button class="btn btn-primary" type="button" data-action="open-booking" data-room="${room.id}" data-date="${esc(date)}" data-start="${slot ? esc(slot.start) : ''}" data-end="${slot ? esc(slot.end) : ''}" aria-label="Ajukan peminjaman ${esc(room.name)}">Ajukan peminjaman</button>`,
  });
}

/* ---------------- My bookings ---------------- */

function renderMyBookings(token) {
  const status = route.query.get('status') || '';
  const tabs = [
    ['', 'Semua'],
    ['menunggu', 'Menunggu'],
    ['disetujui', 'Disetujui'],
    ['ditolak', 'Ditolak'],
    ['dibatalkan', 'Dibatalkan'],
  ];
  app.innerHTML = `
    <div class="page">
      <p class="eyebrow">Riwayat</p>
      <h1 class="page-title">Pengajuan saya.</h1>
      <p class="page-lede">Semua pengajuan dan statusnya ada di sini. Setiap keputusan admin juga dikirim ke email kampus Anda.</p>
      <nav class="tabs tabs-spaced" aria-label="Saring status pengajuan">
        ${tabs
          .map(
            ([value, label]) =>
              `<a class="tab-link ${status === value ? 'is-active' : ''}" href="#/pengajuan${value ? `?status=${value}` : ''}" ${status === value ? 'aria-current="page"' : ''}>${label}</a>`,
          )
          .join('')}
      </nav>
      <div id="my-results" aria-live="polite">${skeletonList(2)}</div>
    </div>
  `;
  loadMyBookings(token, status);
}

async function loadMyBookings(token, status) {
  const box = document.getElementById('my-results');
  try {
    const data = await api(`/bookings/mine${status ? `?status=${encodeURIComponent(status)}` : ''}`);
    if (token !== viewToken) return;
    if (data.bookings.length === 0) {
      box.innerHTML = status
        ? emptyState({
            title: `Tidak ada pengajuan berstatus ${STATUS_LABEL[status]?.toLowerCase() || status}`,
            body: 'Coba lihat semua pengajuan, atau mulai pengajuan baru dari halaman ketersediaan.',
            actionLabel: 'Lihat semua pengajuan',
            action: 'clear-status',
            headingLevel: 2,
          })
        : emptyState({
            title: 'Belum ada pengajuan',
            body: 'Mulai dengan melihat ruang yang kosong. Pengajuan hanya butuh tiga langkah: pilih ruang, isi keperluan, kirim.',
            actionLabel: 'Cari ruang kosong',
            action: 'go-availability',
            headingLevel: 2,
          });
      return;
    }
    box.innerHTML = `<div class="ticket-list">${data.bookings
      .map(
        (b) => `<article class="ticket">
          <div>
            <p class="ticket-code">${esc(b.code)} · <span class="muted">diajukan ${esc(fmtDateTime(b.created_at))} WITA</span></p>
            <h2 class="ticket-title">${esc(b.activity)}</h2>
            <p class="ticket-meta">${esc(b.room_name)} <span class="muted">· ${esc(b.building)}</span> · ${esc(fmtDate(b.date))} · ${esc(timeLabel(b.start))}–${esc(timeLabel(b.end))} WITA</p>
          </div>
          <div class="ticket-actions">
            ${statusChip(b.status)}
            <a class="btn btn-ghost btn-sm" href="#/pengajuan/${b.id}" aria-label="Lihat surat ${esc(b.code)}">Lihat surat</a>
            ${['menunggu', 'disetujui'].includes(b.status)
              ? `<button class="btn btn-danger-outline btn-sm" type="button" data-action="cancel-booking" data-id="${b.id}" data-room="${esc(b.room_name)}" data-date="${esc(b.date)}" data-time="${esc(timeLabel(b.start))}–${esc(timeLabel(b.end))}" aria-label="Batalkan ${esc(b.code)}">Batalkan</button>`
              : ''}
          </div>
        </article>`,
      )
      .join('')}</div>`;
  } catch (error) {
    if (token !== viewToken) return;
    box.innerHTML = errorPanel(error.message, 'Coba lagi', 'retry-my');
  }
}

/* ---------------- Booking detail / Surat ---------------- */

function renderBookingDetail(token, id) {
  app.innerHTML = `<div class="page page-narrow"><div class="boot"><span class="boot-mark" aria-hidden="true"></span><p>Memuat surat izin…</p></div></div>`;
  loadBookingDetail(token, id);
}

async function loadBookingDetail(token, id) {
  try {
    const data = await api(`/bookings/${id}`);
    if (token !== viewToken) return;
    const booking = data.booking;
    const isOwner = booking.user_id === state.user.id;
    document.title = `Surat Izin ${booking.code} — Ruang IDB`;
    app.innerHTML = suratHtml(booking, { isOwner });
    if (booking.status === 'menunggu' && state.user.role === 'admin') {
      document.getElementById('admin-decision').hidden = false;
    }
  } catch (error) {
    if (token !== viewToken) return;
    app.innerHTML = `<div class="page page-narrow">
      <p class="eyebrow">Surat izin</p>
      <h1 class="page-title">Tidak dapat membuka pengajuan.</h1>
      ${errorPanel(error.message, 'Kembali ke riwayat', 'go-my')}
    </div>`;
  }
}

function suratHtml(b, { isOwner }) {
  const canCancel =
    ['menunggu', 'disetujui'].includes(b.status) && (isOwner || state.user.role === 'admin');
  const stampClass =
    b.status === 'disetujui'
      ? 'stamp-disetujui'
      : b.status === 'menunggu'
        ? 'stamp-menunggu'
        : b.status === 'ditolak'
          ? 'stamp-ditolak'
          : 'stamp-dibatalkan';
  const stampText = STATUS_LABEL[b.status] || b.status;
  return `
    <div class="page page-narrow surat-wrap">
      <div class="inline-actions justify-between">
        <a class="btn btn-quiet btn-sm" href="#/pengajuan">← Riwayat pengajuan</a>
        ${statusChip(b.status)}
      </div>
      <article class="surat" aria-labelledby="surat-title">
        <div class="weave" aria-hidden="true"></div>
        <div class="surat-top">
          <div class="surat-brand">Institut Desain dan Bisnis Bali<br />Bagian Sarana Prasarana</div>
          <div class="surat-code">Kode pengajuan<strong>${esc(b.code)}</strong></div>
        </div>
        <div class="surat-stamp" aria-hidden="true">
          <span class="stamp ${stampClass}">${esc(stampText)}<span class="stamp-small">Sarana Prasarana IDB</span></span>
        </div>
        <h1 class="surat-title" id="surat-title">Surat Izin Pemakaian Ruangan</h1>
        <p class="surat-sub">Diajukan ${esc(fmtDateTime(b.created_at))} WITA melalui Ruang IDB</p>

        <div class="surat-grid">
          <div class="surat-field">
            <span class="field-label">Ruangan</span>
            <span class="field-value large">${esc(b.room_name)}</span>
          </div>
          <div class="surat-field">
            <span class="field-label">Lokasi</span>
            <span class="field-value">${esc(b.building)}, ${esc(b.floor)}</span>
          </div>
          <div class="surat-field">
            <span class="field-label">Tanggal</span>
            <span class="field-value">${esc(fmtDate(b.date))}</span>
          </div>
          <div class="surat-field">
            <span class="field-label">Waktu</span>
            <span class="field-value">${esc(timeLabel(b.start))}–${esc(timeLabel(b.end))} WITA</span>
          </div>
          <div class="surat-field">
            <span class="field-label">Nama kegiatan</span>
            <span class="field-value">${esc(b.activity)}</span>
          </div>
          <div class="surat-field">
            <span class="field-label">Jumlah peserta</span>
            <span class="field-value">${b.participants} orang <span class="muted text-sm">(kapasitas ${b.capacity})</span></span>
          </div>
          <div class="surat-field">
            <span class="field-label">Pemohon</span>
            <span class="field-value">${esc(b.user_name)}</span>
          </div>
          <div class="surat-field">
            <span class="field-label">Organisasi</span>
            <span class="field-value">${esc(b.org || b.user_org || '—')}</span>
          </div>
        </div>

        <div class="surat-purpose">
          <span class="field-label">Keperluan</span>
          <p>${esc(b.purpose)}</p>
        </div>

        ${b.status === 'ditolak' && b.rejection_reason ? `<div class="rejection-note"><strong>Alasan penolakan:</strong> ${esc(b.rejection_reason)}</div>` : ''}
        ${b.decided_by_name ? `<p class="small muted mt-s">Diputuskan oleh ${esc(b.decided_by_name)} pada ${esc(fmtDateTime(b.decided_at))} WITA.</p>` : ''}

        <div class="surat-foot">
          <div>
            <p><strong>Ruang IDB</strong> · Sistem Peminjaman Ruangan</p>
            <p>${b.status === 'disetujui' ? 'Dokumen ini sah tanpa tanda tangan basah selama status disetujui.' : b.status === 'menunggu' ? 'Dokumen ini bukan izin final sampai status disetujui oleh admin.' : 'Dokumen ini tidak lagi berlaku sebagai izin pemakaian ruangan.'}</p>
          </div>
          <div class="sign">
            <p>Denpasar, ${esc(fmtDate(todayStr(), { weekday: null, month: 'long' }))}</p>
            <p class="mt-s">Sarana Prasarana IDB Bali</p>
          </div>
        </div>
      </article>

      <div class="surat-actions">
        <button class="btn btn-primary" type="button" data-action="print">Cetak surat</button>
        ${canCancel ? `<button class="btn btn-danger-outline" type="button" data-action="cancel-booking" data-id="${b.id}" data-room="${esc(b.room_name)}" data-date="${esc(b.date)}" data-time="${esc(timeLabel(b.start))}–${esc(timeLabel(b.end))}" aria-label="Batalkan peminjaman ${esc(b.code)}">Batalkan peminjaman</button>` : ''}
      </div>

      ${state.user.role === 'admin' ? `
        <div class="decision-box" id="admin-decision" ${b.status === 'menunggu' ? '' : 'hidden'}>
          <h3>Keputusan admin</h3>
          <p class="small muted">Periksa bentrok, kapasitas, dan aturan ruangan sebelum memutuskan. Penolakan wajib disertai alasan.</p>
          <div class="inline-actions">
            <button class="btn btn-primary" type="button" data-action="admin-approve" data-id="${b.id}" data-activity="${esc(b.activity)}" data-room="${esc(b.room_name)}" data-date="${esc(b.date)}" data-time="${esc(timeLabel(b.start))}–${esc(timeLabel(b.end))}" aria-label="Setujui ${esc(b.code)} — ${esc(b.activity)}">Setujui pengajuan</button>
            <button class="btn btn-ghost" type="button" data-action="admin-reject" data-id="${b.id}" aria-label="Tolak ${esc(b.code)} — ${esc(b.activity)}">Tolak dengan alasan</button>
          </div>
        </div>` : ''}
    </div>
  `;
}

/* ---------------- Admin ---------------- */

function renderAdmin(token, tab) {
  const tabs = [
    ['', 'Ringkasan'],
    ['jadwal', 'Jadwal'],
    ['ruangan', 'Ruangan'],
    ['blokir', 'Blokir jadwal'],
    ['pengaturan', 'Pengaturan'],
    ['email', 'Log email'],
  ];
  app.innerHTML = `
    <div class="page">
      <div class="admin-head">
        <div>
          <p class="eyebrow">Panel admin · Sarana Prasarana</p>
          <h1 class="page-title">Satu tempat untuk seluruh ruangan.</h1>
        </div>
        <p class="field-hint maxw-28ch">Semua waktu dalam WITA. Keputusan dikirim ke email pemohon secara otomatis.</p>
      </div>
      <nav class="tabs tabs-spaced" aria-label="Bagian admin">
        ${tabs
          .map(
            ([value, label]) =>
              `<a class="tab-link ${tab === value ? 'is-active' : ''}" href="#/admin${value ? `/${value}` : ''}" ${tab === value ? 'aria-current="page"' : ''}>${label}</a>`,
          )
          .join('')}
      </nav>
      <div id="admin-content" aria-live="polite">
        <div class="boot"><span class="boot-mark" aria-hidden="true"></span><p>Memuat panel…</p></div>
      </div>
    </div>
  `;
  if (tab === '') loadAdminOverview(token);
  else if (tab === 'jadwal') loadAdminSchedule(token);
  else if (tab === 'ruangan') loadAdminRooms(token);
  else if (tab === 'blokir') loadAdminBlocks(token);
  else if (tab === 'pengaturan') loadAdminSettings(token);
  else if (tab === 'email') loadAdminEmails(token);
  else {
    document.getElementById('admin-content').innerHTML = emptyState({
      title: 'Bagian tidak dikenal',
      body: 'Pilih salah satu tab di atas.',
      actionLabel: 'Kembali ke ringkasan',
      action: 'go-admin',
    });
  }
}

async function loadAdminOverview(token) {
  const box = document.getElementById('admin-content');
  try {
    const data = await api('/admin/overview');
    if (token !== viewToken) return;
    box.innerHTML = `
      <div class="stats">
        <div><div class="stat-number">${data.stats.pending}</div><div class="stat-label">Menunggu keputusan</div></div>
        <div><div class="stat-number">${data.stats.todayApproved}</div><div class="stat-label">Disetujui hari ini</div></div>
        <div><div class="stat-number">${data.stats.totalRooms}</div><div class="stat-label">Ruangan aktif</div></div>
        <div><div class="stat-number">${data.stats.approvedMonth}</div><div class="stat-label">Disetujui bulan ini</div></div>
      </div>

      <section class="panel">
        <div class="section-head">
          <h2 class="section-title">Menunggu keputusan</h2>
          <span class="field-hint">${data.pending.length ? 'Proses dalam 2 hari kerja' : ''}</span>
        </div>
        ${data.pending.length === 0
          ? emptyState({ title: 'Semua pengajuan sudah diproses', body: 'Tidak ada pengajuan yang menunggu. Pengajuan baru akan muncul di sini dan dikirim ke email Anda.' })
          : `<div class="queue">${data.pending
              .map(
                (b) => `<article class="queue-item">
                  <div>
                    <p class="ticket-code">${esc(b.code)} · ${esc(fmtDateTime(b.created_at))} WITA</p>
                    <h3 class="queue-title">${esc(b.activity)}</h3>
                    <p class="queue-meta">${esc(b.room_name)} · ${esc(fmtDate(b.date))} · ${esc(timeLabel(b.start))}–${esc(timeLabel(b.end))} WITA · ${b.participants} orang</p>
                    <p class="queue-meta">${esc(b.user_name)} (${esc(ROLE_LABEL[b.user_role] || b.user_role)})${b.org ? ` · ${esc(b.org)}` : ''}</p>
                    <p class="queue-purpose">${esc(b.purpose)}</p>
                  </div>
                  <div class="queue-actions">
                    <a class="btn btn-ghost btn-sm" href="#/pengajuan/${b.id}" aria-label="Lihat detail ${esc(b.code)} — ${esc(b.activity)}">Lihat detail</a>
                    <button class="btn btn-primary btn-sm" type="button" data-action="admin-approve" data-id="${b.id}" data-activity="${esc(b.activity)}" data-room="${esc(b.room_name)}" data-date="${esc(b.date)}" data-time="${esc(timeLabel(b.start))}–${esc(timeLabel(b.end))}" aria-label="Setujui ${esc(b.code)} — ${esc(b.activity)}">Setujui</button>
                    <button class="btn btn-ghost btn-sm" type="button" data-action="admin-reject" data-id="${b.id}" aria-label="Tolak ${esc(b.code)} — ${esc(b.activity)}">Tolak</button>
                  </div>
                </article>`,
              )
              .join('')}</div>`}
      </section>

      <section class="panel">
        <div class="section-head">
          <h2 class="section-title">Jadwal hari ini</h2>
          <span class="field-hint">${esc(fmtDate(data.today, { weekday: 'long', month: 'long' }))}</span>
        </div>
        ${data.todayBookings.length === 0
          ? `<p class="muted">Belum ada peminjaman disetujui untuk hari ini.</p>`
          : `<div class="table-wrap" tabindex="0" role="region" aria-label="Jadwal hari ini"><table class="data">
              <thead><tr><th>Waktu</th><th>Ruangan</th><th>Kegiatan</th><th>Pemohon</th><th>Kode</th></tr></thead>
              <tbody>${data.todayBookings
                .map(
                  (b) => `<tr>
                    <td data-label="Waktu">${esc(timeLabel(b.start))}–${esc(timeLabel(b.end))}</td>
                    <td data-label="Ruangan">${esc(b.room_name)}</td>
                    <td data-label="Kegiatan">${esc(b.activity)}</td>
                    <td data-label="Pemohon">${esc(b.user_name)}</td>
                    <td data-label="Kode"><a class="table-link" href="#/pengajuan/${b.id}">${esc(b.code)}</a></td>
                  </tr>`,
                )
                .join('')}</tbody>
            </table></div>`}
      </section>
    `;
  } catch (error) {
    if (token !== viewToken) return;
    box.innerHTML = errorPanel(error.message, 'Coba lagi', 'retry-admin');
  }
}

async function loadAdminSchedule(token) {
  const box = document.getElementById('admin-content');
  let rooms = state.adminRooms;
  try {
    if (!rooms) {
      const roomData = await api('/admin/rooms');
      if (token !== viewToken) return;
      rooms = roomData.rooms;
      state.adminRooms = rooms;
    }
    box.innerHTML = `
      <form class="filters" id="schedule-filter">
        <div class="field"><label for="sf-date">Tanggal</label><input id="sf-date" name="date" type="date" value="${esc(route.query.get('date') || '')}" /></div>
        <div class="field"><label for="sf-status">Status</label><select id="sf-status" name="status">
          <option value="">Semua status</option>
          ${Object.entries(STATUS_LABEL).map(([v, l]) => `<option value="${v}" ${route.query.get('status') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        </select></div>
        <div class="field"><label for="sf-room">Ruangan</label><select id="sf-room" name="room">
          <option value="">Semua ruangan</option>
          ${rooms.map((r) => `<option value="${r.id}" ${route.query.get('room') === String(r.id) ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
        </select></div>
        <button class="btn btn-quiet" type="button" data-action="clear-schedule">Bersihkan</button>
      </form>
      <div id="schedule-results">${skeletonList(2)}</div>
    `;
    const form = document.getElementById('schedule-filter');
    const apply = () => {
      const query = new URLSearchParams();
      if (form.date.value) query.set('date', form.date.value);
      if (form.status.value) query.set('status', form.status.value);
      if (form.room.value) query.set('room', form.room.value);
      setUrlQuery(query);
      loadScheduleRows(token);
    };
    form.date.addEventListener('change', apply);
    form.status.addEventListener('change', apply);
    form.room.addEventListener('change', apply);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      apply();
    });
    loadScheduleRows(token);
  } catch (error) {
    if (token !== viewToken) return;
    box.innerHTML = errorPanel(error.message, 'Coba lagi', 'retry-admin');
  }
}

async function loadScheduleRows(token) {
  const box = document.getElementById('schedule-results');
  if (!box) return;
  const params = new URLSearchParams();
  if (route.query.get('date')) params.set('date', route.query.get('date'));
  if (route.query.get('status')) params.set('status', route.query.get('status'));
  if (route.query.get('room')) params.set('roomId', route.query.get('room'));
  try {
    const data = await api(`/admin/bookings?${params.toString()}`);
    if (token !== viewToken) return;
    if (data.bookings.length === 0) {
      box.innerHTML = emptyState({
        title: 'Tidak ada jadwal pada saringan ini',
        body: 'Ubah tanggal, status, atau ruangan untuk melihat jadwal lain.',
        actionLabel: 'Bersihkan saringan',
        action: 'clear-schedule',
      });
      return;
    }
    box.innerHTML = `<div class="table-wrap mt-s" tabindex="0" role="region" aria-label="Jadwal peminjaman"><table class="data">
      <thead><tr><th>Waktu</th><th>Ruangan</th><th>Kegiatan</th><th>Pemohon</th><th>Status</th><th>Kode</th></tr></thead>
      <tbody>${data.bookings
        .map(
          (b) => `<tr>
            <td data-label="Waktu">${esc(fmtDate(b.date, { weekday: 'short', month: 'short' }))}<br />${esc(timeLabel(b.start))}–${esc(timeLabel(b.end))}</td>
            <td data-label="Ruangan">${esc(b.room_name)}<br /><span class="muted">${esc(b.building)}</span></td>
            <td data-label="Kegiatan">${esc(b.activity)}</td>
            <td data-label="Pemohon">${esc(b.user_name)}</td>
            <td data-label="Status">${statusChip(b.status)}</td>
            <td data-label="Kode"><a class="table-link" href="#/pengajuan/${b.id}">${esc(b.code)}</a></td>
          </tr>`,
        )
        .join('')}</tbody>
    </table></div>`;
  } catch (error) {
    if (token !== viewToken) return;
    box.innerHTML = errorPanel(error.message, 'Coba lagi', 'retry-schedule');
  }
}

async function loadAdminRooms(token) {
  const box = document.getElementById('admin-content');
  try {
    const data = await api('/admin/rooms');
    if (token !== viewToken) return;
    state.adminRooms = data.rooms;
    box.innerHTML = `
      <div class="section-head mt-s">
        <h2 class="section-title">Katalog ruangan</h2>
        <button class="btn btn-primary btn-sm" type="button" data-action="add-room">Tambah ruangan</button>
      </div>
      <div class="admin-list">${data.rooms
        .map(
          (room) => `<div class="admin-row">
            <div>
              <p class="room-meta">${esc(CATEGORY_LABEL[room.category] || room.category)} · ${esc(room.building)} ${esc(room.floor)}</p>
              <h3 class="queue-title">${esc(room.name)}</h3>
              <p class="queue-meta">${room.capacity} orang · ${esc(room.open_time)}–${esc(room.close_time)} WITA · maks ${room.max_duration_minutes / 60} jam</p>
              <p class="queue-meta muted">${(room.facilities || []).map((f) => esc(f)).join(' · ') || 'Belum ada fasilitas tercatat'}</p>
            </div>
            <div class="inline-actions">
              <span class="badge-role">${room.active ? 'Aktif' : 'Nonaktif'}</span>
              <button class="btn btn-ghost btn-sm" type="button" data-action="edit-room" data-id="${room.id}" aria-label="Ubah ${esc(room.name)}">Ubah</button>
              <button class="btn btn-quiet btn-sm" type="button" data-action="toggle-room" data-id="${room.id}" data-active="${room.active ? '1' : '0'}" aria-label="${room.active ? 'Nonaktifkan' : 'Aktifkan'} ${esc(room.name)}">${room.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
            </div>
          </div>`,
        )
        .join('')}</div>
    `;
  } catch (error) {
    if (token !== viewToken) return;
    box.innerHTML = errorPanel(error.message, 'Coba lagi', 'retry-admin');
  }
}

function openRoomForm(room = null) {
  const isEdit = Boolean(room);
  openDialog({
    title: isEdit ? 'Ubah ruangan' : 'Tambah ruangan',
    sub: 'Perubahan langsung berlaku pada katalog dan formulir pengajuan.',
    wide: true,
    body: `
      <form class="form-grid" id="room-form" novalidate>
        <div class="form-row">
          <div class="field"><label for="rm-name">Nama ruangan</label><input id="rm-name" name="name" type="text" maxlength="80" required value="${esc(room?.name || '')}" /><span class="field-error" data-error-for="name"></span></div>
          <div class="field"><label for="rm-category">Kategori</label><select id="rm-category" name="category" required>
            ${Object.entries(CATEGORY_LABEL).map(([v, l]) => `<option value="${v}" ${room?.category === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select><span class="field-error" data-error-for="category"></span></div>
        </div>
        <div class="form-row">
          <div class="field"><label for="rm-building">Gedung</label><input id="rm-building" name="building" type="text" maxlength="60" required value="${esc(room?.building || '')}" /><span class="field-error" data-error-for="building"></span></div>
          <div class="field"><label for="rm-floor">Lantai</label><input id="rm-floor" name="floor" type="text" maxlength="40" required value="${esc(room?.floor || '')}" /><span class="field-error" data-error-for="floor"></span></div>
        </div>
        <div class="form-row">
          <div class="field"><label for="rm-capacity">Kapasitas (orang)</label><input id="rm-capacity" name="capacity" type="number" min="1" max="1000" required value="${room?.capacity ?? 30}" /><span class="field-error" data-error-for="capacity"></span></div>
          <div class="field"><label for="rm-max">Durasi maksimum (menit)</label><input id="rm-max" name="maxDurationMinutes" type="number" min="30" max="720" step="30" required value="${room?.max_duration_minutes ?? 240}" /><span class="field-error" data-error-for="maxDurationMinutes"></span></div>
        </div>
        <div class="form-row">
          <div class="field"><label for="rm-open">Jam buka</label><input id="rm-open" name="openTime" type="time" required step="1800" value="${esc(room?.open_time || '07:00')}" /><span class="field-error" data-error-for="openTime"></span></div>
          <div class="field"><label for="rm-close">Jam tutup</label><input id="rm-close" name="closeTime" type="time" required step="1800" value="${esc(room?.close_time || '21:00')}" /><span class="field-error" data-error-for="closeTime"></span></div>
        </div>
        <div class="field"><label for="rm-facilities">Fasilitas (pisahkan dengan koma)</label><input id="rm-facilities" name="facilities" type="text" value="${esc((room?.facilities || []).join(', '))}" placeholder="AC, Proyektor, Papan tulis" /></div>
        <div class="field"><label for="rm-description">Deskripsi singkat</label><textarea id="rm-description" name="description" maxlength="500">${esc(room?.description || '')}</textarea></div>
        ${isEdit ? `<label class="checkbox-row"><input type="checkbox" name="active" ${room.active ? 'checked' : ''} /> Ruangan aktif dan dapat dipinjam</label>` : ''}
        <div id="room-error" role="alert"></div>
      </form>
    `,
    footer: `<button class="btn btn-ghost" type="button" data-close>Batal</button><button class="btn btn-primary" type="submit" form="room-form" id="room-submit">${isEdit ? 'Simpan perubahan' : 'Tambah ruangan'}</button>`,
    onMount(dialog) {
      const form = dialog.querySelector('#room-form');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        dialog.querySelectorAll('[data-error-for]').forEach((el) => (el.textContent = ''));
        dialog.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
        dialog.querySelector('#room-error').innerHTML = '';
        if (!form.reportValidity()) return;
        const body = {
          name: form.name.value,
          category: form.category.value,
          building: form.building.value,
          floor: form.floor.value,
          capacity: Number(form.capacity.value),
          maxDurationMinutes: Number(form.maxDurationMinutes.value),
          openTime: form.openTime.value,
          closeTime: form.closeTime.value,
          facilities: form.facilities.value,
          description: form.description.value,
        };
        if (isEdit) body.active = form.active.checked;
        const submit = dialog.querySelector('#room-submit');
        submit.disabled = true;
        submit.setAttribute('aria-busy', 'true');
        try {
          await api(isEdit ? `/admin/rooms/${room.id}` : '/admin/rooms', {
            method: isEdit ? 'PATCH' : 'POST',
            body,
          });
          dialog.close();
          state.adminRooms = null;
          state.availability = null;
          toast(isEdit ? 'Ruangan diperbarui.' : 'Ruangan baru ditambahkan.');
          render();
        } catch (error) {
          const errors = error.data?.errors || {};
          for (const [field, message] of Object.entries(errors)) {
            const el = dialog.querySelector(`[data-error-for="${field}"]`);
            if (el) el.textContent = message;
            const input = form.elements[field];
            if (input) input.setAttribute('aria-invalid', 'true');
            linkFieldError(form, field);
          }
          dialog.querySelector('#room-error').innerHTML = `<div class="form-error" role="alert">${esc(error.message)}</div>`;
        } finally {
          submit.disabled = false;
          submit.removeAttribute('aria-busy');
        }
      });
    },
  });
}

async function loadAdminBlocks(token) {
  const box = document.getElementById('admin-content');
  try {
    const [roomData, blockData] = await Promise.all([api('/admin/rooms'), api('/admin/blocks')]);
    if (token !== viewToken) return;
    const rooms = roomData.rooms;
    const today = todayStr();
    box.innerHTML = `
      <section class="panel">
        <div class="section-head"><h2 class="section-title">Blokir jadwal ruangan</h2><span class="field-hint">Untuk perkuliahan tetap, libur, atau perawatan.</span></div>
        <form class="form-grid admin-form" id="block-form" novalidate>
          <div class="form-row">
            <div class="field"><label for="bl-room">Ruangan</label><select id="bl-room" name="roomId" required>${rooms.filter((r) => r.active).map((r) => `<option value="${r.id}">${esc(r.name)} — ${esc(r.building)}</option>`).join('')}</select><span class="field-error" data-error-for="roomId"></span></div>
            <div class="field"><label for="bl-date">Tanggal</label><input id="bl-date" name="date" type="date" required value="${today}" /><span class="field-error" data-error-for="date"></span></div>
          </div>
          <div class="form-row">
            <div class="field"><label for="bl-start">Jam mulai</label><input id="bl-start" name="start" type="time" required step="1800" value="07:00" /><span class="field-error" data-error-for="start"></span></div>
            <div class="field"><label for="bl-end">Jam selesai</label><input id="bl-end" name="end" type="time" required step="1800" value="09:00" /><span class="field-error" data-error-for="end"></span></div>
          </div>
          <div class="field"><label for="bl-reason">Alasan</label><input id="bl-reason" name="reason" type="text" maxlength="160" required placeholder="Contoh: Perkuliahan tetap — Manajemen Warna" /><span class="field-error" data-error-for="reason"></span></div>
          <div id="block-error" role="alert"></div>
          <div><button class="btn btn-primary" type="submit" id="block-submit">Blokir jadwal</button></div>
        </form>
      </section>
      <section class="panel">
        <div class="section-head"><h2 class="section-title">Daftar blokir</h2><span class="field-hint">${blockData.blocks.length} jadwal diblokir</span></div>
        ${blockData.blocks.length === 0
          ? `<p class="muted">Belum ada jadwal yang diblokir.</p>`
          : `<div class="admin-list">${blockData.blocks
              .map(
                (bl) => `<div class="admin-row">
                  <div>
                    <p class="room-meta">${esc(fmtDate(bl.date, { weekday: 'long', month: 'long' }))} · ${esc(timeLabel(String(Math.floor(bl.start_min / 60)).padStart(2, '0') + ':' + String(bl.start_min % 60).padStart(2, '0')))}–${esc(timeLabel(String(Math.floor(bl.end_min / 60)).padStart(2, '0') + ':' + String(bl.end_min % 60).padStart(2, '0')))} WITA</p>
                    <h3 class="queue-title section-title-sm">${esc(bl.room_name)}</h3>
                    <p class="queue-meta">${esc(bl.reason)}</p>
                  </div>
                  <button class="btn btn-quiet btn-sm" type="button" data-action="delete-block" data-id="${bl.id}" data-room="${esc(bl.room_name)}" aria-label="Hapus blokir ${esc(bl.room_name)}, ${esc(fmtDate(bl.date))}">Hapus</button>
                </div>`,
              )
              .join('')}</div>`}
      </section>
    `;
    const form = document.getElementById('block-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      form.querySelectorAll('[data-error-for]').forEach((el) => (el.textContent = ''));
      document.getElementById('block-error').innerHTML = '';
      if (!form.reportValidity()) return;
      const submit = document.getElementById('block-submit');
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
      try {
        await api('/admin/blocks', {
          method: 'POST',
          body: {
            roomId: Number(form.roomId.value),
            date: form.date.value,
            start: form.start.value,
            end: form.end.value,
            reason: form.reason.value,
          },
        });
        toast('Jadwal ruangan diblokir.');
        render();
      } catch (error) {
        const errors = error.data?.errors || {};
        for (const [field, message] of Object.entries(errors)) {
          const el = form.querySelector(`[data-error-for="${field}"]`);
          if (el) el.textContent = message;
          linkFieldError(form, field);
        }
        document.getElementById('block-error').innerHTML = `<div class="form-error" role="alert">${esc(error.message)}</div>`;
      } finally {
        submit.disabled = false;
        submit.removeAttribute('aria-busy');
      }
    });
  } catch (error) {
    if (token !== viewToken) return;
    box.innerHTML = errorPanel(error.message, 'Coba lagi', 'retry-admin');
  }
}

async function loadAdminSettings(token) {
  const box = document.getElementById('admin-content');
  try {
    const data = await api('/admin/settings');
    if (token !== viewToken) return;
    box.innerHTML = `
      <section class="panel">
        <div class="section-head"><h2 class="section-title">Aturan pengajuan</h2><span class="field-hint">Berlaku untuk seluruh ruangan.</span></div>
        <form class="form-grid admin-form" id="settings-form">
          <div class="form-row">
            <div class="field">
              <label for="st-min">Minimal pengajuan sebelum kegiatan (hari)</label>
              <input id="st-min" name="minNoticeDays" type="number" min="0" max="30" required value="${data.settings.minNoticeDays}" />
              <span class="field-hint">Atur batas H-2: pengajuan paling lambat 2 hari sebelum kegiatan. Isi 0 jika pengajuan hari yang sama masih diizinkan.</span>
            </div>
            <div class="field">
              <label for="st-max">Maksimal pengajuan ke depan (hari)</label>
              <input id="st-max" name="maxAdvanceDays" type="number" min="1" max="365" required value="${data.settings.maxAdvanceDays}" />
              <span class="field-hint">Batas paling jauh ke depan; 30 berarti pemohon dapat memesan hingga 30 hari ke depan.</span>
            </div>
          </div>
          <div id="settings-error" role="alert"></div>
          <div><button class="btn btn-primary" type="submit">Simpan pengaturan</button></div>
        </form>
      </section>
      <section class="panel">
        <h2 class="section-title section-title-sm">Aturan tetap sistem</h2>
        <ul class="rules-list">
          <li>Satu ruangan tidak boleh memiliki dua peminjaman yang tumpang tindih. Slot menunggu dan disetujui sama-sama menahan jadwal.</li>
          <li>Durasi maksimum mengikuti pengaturan per ruangan; jam operasional juga per ruangan.</li>
          <li>Penolakan wajib disertai alasan dan dikirim ke email pemohon.</li>
          <li>Pemohon dapat membatalkan pengajuan sendiri sebelum waktu mulai; slot langsung terbuka.</li>
        </ul>
      </section>
    `;
    const form = document.getElementById('settings-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      document.getElementById('settings-error').innerHTML = '';
      try {
        const result = await api('/admin/settings', {
          method: 'PUT',
          body: {
            minNoticeDays: Number(form.minNoticeDays.value),
            maxAdvanceDays: Number(form.maxAdvanceDays.value),
          },
        });
        state.settings = result.settings;
        toast('Pengaturan pengajuan disimpan.');
      } catch (error) {
        document.getElementById('settings-error').innerHTML = `<div class="form-error" role="alert">${esc(error.message)}</div>`;
      }
    });
  } catch (error) {
    if (token !== viewToken) return;
    box.innerHTML = errorPanel(error.message, 'Coba lagi', 'retry-admin');
  }
}

async function loadAdminEmails(token) {
  const box = document.getElementById('admin-content');
  try {
    const data = await api('/admin/emails');
    if (token !== viewToken) return;
    box.innerHTML = `
      <section class="panel">
        <div class="section-head">
          <h2 class="section-title">Log email keluar</h2>
          <button class="btn btn-ghost btn-sm" type="button" data-action="test-email">Kirim email uji</button>
        </div>
        <p class="field-hint mb-s">Pada MVP ini pengiriman email disimulasikan dan dicatat di outbox. Integrasi SMTP/SSO kampus disiapkan pada tahap berikutnya.</p>
        ${data.emails.length === 0
          ? emptyState({ title: 'Belum ada email', body: 'Email keputusan akan tercatat di sini setelah admin memproses pengajuan.' })
          : data.emails
              .map(
                (email) => `<article class="email-item">
                  <div class="email-head">
                    <span class="email-subject">${esc(email.subject)}</span>
                    <span class="email-meta">${esc(fmtDateTime(email.created_at))} WITA</span>
                  </div>
                  <p class="email-meta">Kepada: ${esc(email.to_email)}</p>
                  <pre class="email-body">${esc(email.body)}</pre>
                </article>`,
              )
              .join('')}
      </section>
    `;
  } catch (error) {
    if (token !== viewToken) return;
    box.innerHTML = errorPanel(error.message, 'Coba lagi', 'retry-admin');
  }
}

/* ---------------- Actions ---------------- */

async function handleGlobalClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  if (action === 'scroll-landing') {
    event.preventDefault();
    const section = document.getElementById(target.dataset.target);
    if (section) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      section.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
    return;
  }

  if (action === 'scroll-schedule') {
    const section = document.getElementById('schedule');
    if (section) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      section.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
    return;
  }

  if (action === 'pick-date') {
    const query = new URLSearchParams(route.query);
    query.set('date', target.dataset.date);
    navigate('/ketersediaan', Object.fromEntries(query.entries()));
    return;
  }

  if (action === 'clear-filters') {
    navigate('/ketersediaan', { date: currentAvailabilityDate() });
    return;
  }

  if (action === 'go-availability') {
    navigate('/ketersediaan');
    return;
  }

  if (action === 'go-my') {
    navigate('/pengajuan');
    return;
  }

  if (action === 'go-admin') {
    navigate('/admin');
    return;
  }

  if (action === 'clear-status') {
    navigate('/pengajuan');
    return;
  }

  if (action === 'clear-schedule') {
    navigate('/admin/jadwal');
    return;
  }

  if (action === 'retry-rooms') {
    loadAvailability(viewToken, currentAvailabilityDate());
    return;
  }

  if (action === 'retry-my') {
    loadMyBookings(viewToken, route.query.get('status') || '');
    return;
  }

  if (action === 'retry-admin') {
    renderAdmin(viewToken, route.path.split('/')[2] || '');
    return;
  }

  if (action === 'retry-schedule') {
    loadScheduleRows(viewToken);
    return;
  }

  if (action === 'open-booking') {
    openBookingDialog({
      roomId: target.dataset.room,
      date: target.dataset.date,
      start: target.dataset.start,
      end: target.dataset.end,
    });
    return;
  }

  if (action === 'room-detail') {
    openRoomDetail(Number(target.dataset.room));
    return;
  }

  if (action === 'load-video') {
    mountLoginVideo(target.closest('.login-video'));
    return;
  }

  if (action === 'login-demo') {
    document.getElementById('login-email').value = target.dataset.email;
    document.getElementById('login-password').value = target.dataset.password;
    document.getElementById('login-password').focus();
    return;
  }

  if (action === 'print') {
    window.print();
    return;
  }

  if (action === 'cancel-booking') {
    await cancelBooking(target.dataset.id, {
      room: target.dataset.room,
      date: target.dataset.date,
      time: target.dataset.time,
    });
    return;
  }

  if (action === 'admin-approve') {
    const activity = target.dataset.activity || 'Pengajuan ini';
    const room = target.dataset.room || '';
    const date = target.dataset.date ? fmtDate(target.dataset.date) : '';
    const time = target.dataset.time ? `${target.dataset.time} WITA` : '';
    const detail = [room, date, time].filter(Boolean).join(' · ');
    const ok = await confirmDialog({
      title: 'Setujui pengajuan?',
      message: `${activity}${detail ? ` — ${detail}` : ''}. Email persetujuan akan langsung dikirim ke pemohon.`,
      confirmLabel: 'Ya, setujui',
    });
    if (!ok) return;
    await decideBooking(Number(target.dataset.id), 'disetujui', '');
    return;
  }

  if (action === 'admin-reject') {
    openRejectDialog(Number(target.dataset.id));
    return;
  }

  if (action === 'add-room') {
    openRoomForm(null);
    return;
  }

  if (action === 'edit-room') {
    const room = state.adminRooms?.find((r) => r.id === Number(target.dataset.id));
    if (room) openRoomForm(room);
    return;
  }

  if (action === 'toggle-room') {
    const id = Number(target.dataset.id);
    const active = target.dataset.active === '1';
    const room = state.adminRooms?.find((r) => r.id === id);
    const ok = await confirmDialog({
      title: active ? 'Nonaktifkan ruangan?' : 'Aktifkan ruangan?',
      message: active
        ? `${room?.name || 'Ruangan'} tidak akan muncul di katalog. Peminjaman yang sudah ada tetap berlaku.`
        : `${room?.name || 'Ruangan'} akan muncul kembali di katalog dan dapat diajukan.`,
      confirmLabel: active ? 'Ya, nonaktifkan' : 'Ya, aktifkan',
      destructive: active,
    });
    if (!ok) return;
    try {
      await api(`/admin/rooms/${id}`, { method: 'PATCH', body: { active: !active } });
      state.adminRooms = null;
      state.availability = null;
      toast(active ? 'Ruangan dinonaktifkan.' : 'Ruangan diaktifkan.');
      render();
    } catch (error) {
      toast(error.message, 'error');
    }
    return;
  }

  if (action === 'delete-block') {
    const ok = await confirmDialog({
      title: 'Hapus blokir jadwal?',
      message: `Blokir pada ${target.dataset.room || 'ruangan ini'} akan dihapus dan jam tersebut kembali tersedia.`,
      confirmLabel: 'Hapus blokir',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/admin/blocks/${target.dataset.id}`, { method: 'DELETE' });
      toast('Blokir jadwal dihapus.');
      render();
    } catch (error) {
      toast(error.message, 'error');
    }
    return;
  }

  if (action === 'test-email') {
    target.disabled = true;
    try {
      await api('/admin/test-email', { method: 'POST' });
      toast('Email uji dicatat di outbox.');
      render();
    } catch (error) {
      toast(error.message, 'error');
      target.disabled = false;
    }
  }
}

async function cancelBooking(id, info) {
  const ok = await confirmDialog({
    title: 'Batalkan peminjaman?',
    message: `${info.room}, ${fmtDate(info.date)} pukul ${info.time} WITA. Slot akan langsung dibuka untuk pemohon lain dan admin menerima pemberitahuan.`,
    confirmLabel: 'Ya, batalkan',
    destructive: true,
  });
  if (!ok) return;
  try {
    await api(`/bookings/${id}/cancel`, { method: 'POST' });
    toast('Peminjaman dibatalkan. Slot sudah dibuka kembali.');
    render();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function decideBooking(id, decision, reason) {
  const button = document.querySelector(`[data-action="admin-approve"][data-id="${id}"]`);
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  try {
    await api(`/admin/bookings/${id}/decision`, {
      method: 'POST',
      body: { decision, reason },
    });
    toast(decision === 'disetujui' ? 'Pengajuan disetujui. Email dikirim ke pemohon.' : 'Pengajuan ditolak. Email dikirim ke pemohon.');
    render();
  } catch (error) {
    toast(error.message, 'error');
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }
}

function openRejectDialog(id) {
  openDialog({
    title: 'Tolak pengajuan',
    sub: 'Alasan akan dikirim ke email pemohon, jadi tulis dengan jelas dan solutif.',
    body: `
      <form class="form-grid" id="reject-form" novalidate>
        <div class="field">
          <label for="reject-reason">Alasan penolakan</label>
          <textarea id="reject-reason" name="reason" maxlength="500" required placeholder="Contoh: Ruangan sedang dipakai untuk ujian pada jam tersebut. Silakan pilih jam 15.00–17.00."></textarea>
          <span class="field-hint">Minimal 5 karakter.</span>
          <span class="field-error" data-error-for="reason"></span>
        </div>
        <div id="reject-error" role="alert"></div>
      </form>
    `,
    footer: `<button class="btn btn-ghost" type="button" data-close>Batal</button><button class="btn btn-danger" type="submit" form="reject-form" id="reject-submit">Tolak pengajuan</button>`,
    onMount(dialog, close) {
      const form = dialog.querySelector('#reject-form');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        if (form.reason.value.trim().length < 5) {
          dialog.querySelector('[data-error-for="reason"]').textContent = 'Minimal 5 karakter.';
          linkFieldError(form, 'reason');
          form.reason.focus();
          return;
        }
        const submit = dialog.querySelector('#reject-submit');
        submit.disabled = true;
        submit.setAttribute('aria-busy', 'true');
        try {
          await api(`/admin/bookings/${id}/decision`, {
            method: 'POST',
            body: { decision: 'ditolak', reason: form.reason.value },
          });
          close();
          toast('Pengajuan ditolak. Email dikirim ke pemohon.');
          render();
        } catch (error) {
          dialog.querySelector('#reject-error').innerHTML = `<div class="form-error" role="alert">${esc(error.message)}</div>`;
          submit.disabled = false;
          submit.removeAttribute('aria-busy');
        }
      });
    },
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init();
