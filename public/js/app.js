const API = '/api';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];


/* =========================
   API
========================= */

async function api(path, { method = 'GET', body } = {}) {
  const token = localStorage.getItem('fixai_token');

  const headers = {
    'Content-Type': 'application/json'
  };

  if (token) {
    headers['Authorization'] = 'Bearer ' + token;
  }

  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({
    ok: false,
    msg: 'Server error'
  }));

  if (!res.ok) {
    throw new Error(data.msg || 'Request failed');
  }

  return data;
}


/* =========================
   AUTHENTICATION
========================= */

function authUser() {
  try {
    return JSON.parse(localStorage.getItem('fixai_user'));
  } catch (e) {
    return null;
  }
}

function requireAuth(roles) {
  const u = authUser();

  if (!u) {
    location.href = '/';
    return null;
  }

  if (roles && !roles.includes(u.role)) {
    location.href = '/';
    return null;
  }

  return u;
}

function logout() {
  localStorage.removeItem('fixai_token');
  localStorage.removeItem('fixai_user');
  location.href = '/';
}

function logoutBtn() {
  logout();
}


/* =========================
   HELPERS
========================= */

function esc(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c])
  );
}

function fmt(ts) {
  return new Date(ts).toLocaleString();
}


/* =========================
   STATUS
========================= */

function statusPill(s) {
  const m = {
    pending: [
      'Pending',
      '#fdf3e3',
      '#d97706'
    ],

    applied: [
      'Applied',
      '#eaf1ff',
      '#2563eb'
    ],

    assigned: [
      'Assigned',
      '#eaf1ff',
      '#2563eb'
    ],

    in_progress: [
      'In Progress',
      '#eaf1ff',
      '#2563eb'
    ],

    completed: [
      'Completed',
      '#e7f8ee',
      '#16a34a'
    ],

    paid: [
      'Paid',
      '#e7f8ee',
      '#16a34a'
    ]
  };

  const [
    label,
    background,
    foreground
  ] = m[s] || [
    s,
    'var(--gray-soft)',
    'var(--muted)'
  ];

  return `
    <span
      class="pill"
      style="background:${background};color:${foreground}"
    >
      ${label}
    </span>
  `;
}


/* =========================
   RATINGS
========================= */

function stars(r) {
  if (r == null) return '—';

  let result = '';

  for (let i = 1; i <= 5; i++) {
    result += i <= Math.round(r)
      ? '⭐'
      : '☆';
  }

  return result + ' (' + r + ')';
}


/* =========================
   TOAST
========================= */

function toast(msg, type = 'ok') {
  const t = document.createElement('div');

  t.className =
    'toast ' +
    (type === 'err' ? 'err' : 'ok');

  t.textContent = msg;

  document.body.appendChild(t);

  setTimeout(() => {
    t.remove();
  }, 3500);
}


/* =========================
   MODAL
========================= */

function openModal(html) {
  const modalBody = $('#modal-body');
  const modal = $('#modal');

  if (!modalBody || !modal) return;

  modalBody.innerHTML = html;
  modal.classList.add('show');
}

function closeModal() {
  const modal = $('#modal');

  if (modal) {
    modal.classList.remove('show');
  }
}

if ($('#modal')) {
  $('#modal').addEventListener('click', e => {
    if (e.target.id === 'modal') {
      closeModal();
    }
  });
}


/* =========================
   IMAGE FILE HANDLING
========================= */

function fileToDataURL(file, cb) {
  const reader = new FileReader();

  reader.onload = e => {
    const img = new Image();

    img.onload = () => {
      const max = 800;

      let w = img.width;
      let h = img.height;

      if (w > max) {
        h = Math.round(h * max / w);
        w = max;
      }

      const cv = document.createElement('canvas');

      cv.width = w;
      cv.height = h;

      cv.getContext('2d').drawImage(
        img,
        0,
        0,
        w,
        h
      );

      cb(
        cv.toDataURL(
          'image/jpeg',
          0.7
        )
      );
    };

    img.src = e.target.result;
  };

  reader.readAsDataURL(file);
}


/* =========================
   NOTIFICATIONS
========================= */

async function loadNotifications() {
  try {
    const d = await api('/notifications');

    const unread = d.notifications.filter(
      n => !n.read
    ).length;

    const el = $('#bellCount');

    if (el) {
      el.textContent = unread;

      el.style.display = unread
        ? 'inline-block'
        : 'none';
    }

    const items =
      d.notifications
        .map(
          n => `
            <div class="notif-item">
              ${esc(n.text)}
              <b>${fmt(n.created_at)}</b>
            </div>
          `
        )
        .join('') ||
      '<div class="muted">No notifications yet.</div>';

    openModal(`
      <h3>🔔 Notifications</h3>

      ${items}

      <div style="margin-top:16px">
        <button
          class="btn"
          onclick="closeModal()"
        >
          Close
        </button>
      </div>
    `);

    await api(
      '/notifications/read',
      {
        method: 'POST'
      }
    );

  } catch (e) {
    toast(
      '❌ ' + e.message,
      'err'
    );
  }
}


/* =========================
   THEME
========================= */

function toggleTheme() {
  const currentTheme =
    document.documentElement.dataset.theme;

  const newTheme =
    currentTheme === 'dark'
      ? 'light'
      : 'dark';

  document.documentElement.dataset.theme =
    newTheme;

  localStorage.setItem(
    'fixai_theme',
    newTheme
  );

  const themeBtn = $('#themeBtn');

  if (themeBtn) {
    themeBtn.textContent =
      newTheme === 'dark'
        ? '☀️'
        : '🌙';
  }
}


/* =========================
   DASHBOARD NAVIGATION
========================= */

function goPanel(id) {
  $$('.panel').forEach(panel => {
    panel.classList.remove('show');
  });

  const targetPanel = $('#panel-' + id);

  if (targetPanel) {
    targetPanel.classList.add('show');
  }

  $$('.sidebar .nav-item').forEach(navItem => {
    navItem.classList.toggle(
      'active',
      navItem.dataset.panel === id
    );
  });
}


/* =========================
   INITIALIZATION
========================= */

document.addEventListener(
  'DOMContentLoaded',
  () => {

    /* Load saved theme */

    const savedTheme =
      localStorage.getItem('fixai_theme') ||
      'light';

    document.documentElement.dataset.theme =
      savedTheme;

    const themeBtn = $('#themeBtn');

    if (themeBtn) {
      themeBtn.textContent =
        savedTheme === 'dark'
          ? '☀️'
          : '🌙';
    }

  }
);