const API = '/api';

async function apiFetch(url, options = {}) {
  const res = await fetch(API + url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Có lỗi xảy ra');
  return data;
}

// Dùng ở đầu mỗi trang cần đăng nhập — tự chuyển về trang login nếu chưa có session
async function requireLoginOrRedirect() {
  try {
    const user = await apiFetch('/auth/hien-tai');
    if (!user) { window.location.href = '/index.html'; return null; }
    return user;
  } catch (e) {
    window.location.href = '/index.html';
    return null;
  }
}

function dangXuat() {
  apiFetch('/auth/dang-xuat', { method: 'POST' }).then(() => window.location.href = '/index.html');
}

// Thanh điều hướng dùng chung cho mọi trang — link "Nhân viên" chỉ hiện với admin
function renderNav(user, active) {
  const links = [
    { href: '/orders.html', label: 'Đơn hàng', key: 'orders' },
    { href: '/scan.html', label: 'Quét QR', key: 'scan' },
    { href: '/dashboard.html', label: 'Thống kê', key: 'dashboard' },
  ];
  if (user.vaiTro === 'admin') links.push({ href: '/users.html', label: 'Nhân viên', key: 'users' });

  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.innerHTML = `
    <div class="nav-top">
      <span class="nav-user">👤 ${user.ten} (${user.vaiTro})</span>
      <button class="btn-link" onclick="dangXuat()">Đăng xuất</button>
    </div>
    <div class="nav-links">
      ${links.map(l => `<a href="${l.href}" class="${l.key === active ? 'active' : ''}">${l.label}</a>`).join('')}
    </div>`;
}
