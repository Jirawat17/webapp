const API = '/api';

const NHAN_VAI_TRO = {
  admin: 'Admin',
  quan_ly: 'Quản lý',
  ve_file: 'Vẽ file',
  chuan_bi_phoi: 'Chuẩn bị phôi',
  san_xuat: 'Sản xuất',
  dong_goi: 'Đóng gói',
};

// Luôn escape dữ liệu lấy từ Sheet trước khi chèn vào innerHTML — dữ liệu này do khách hàng /
// nhân viên nhập từ nhiều nguồn khác nhau, không được tin tưởng tuyệt đối.
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

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

// Thanh điều hướng dùng chung: header trên cùng (logo + tên NV + đăng xuất) + nav link —
// nav link tự chuyển thành bottom tab bar trên điện thoại, top nav trên tablet/desktop (xem style.css)
function renderNav(user, active) {
  const links = [
    { href: '/orders.html', label: 'Đơn hàng', icon: 'orders', key: 'orders' },
    { href: '/scan.html', label: 'Quét QR', icon: 'scan', key: 'scan' },
    { href: '/dashboard.html', label: 'Thống kê', icon: 'chart', key: 'dashboard' },
    { href: '/chatbot.html', label: 'Trợ lý', icon: 'chat', key: 'chatbot' },
  ];
  if (user.vaiTro === 'admin' || user.vaiTro === 'quan_ly') {
    links.push({ href: '/reports.html', label: 'Báo cáo', icon: 'download', key: 'reports' });
  }
  if (user.vaiTro === 'admin') {
    links.push({ href: '/users.html', label: 'Nhân viên', icon: 'users', key: 'users' });
  }

  const nav = document.getElementById('nav');
  if (!nav) return;

  nav.innerHTML = `
    <header class="app-header">
      <a href="/orders.html" class="brand">${icon('logo', { size: 26 })}<span>Xưởng Thêu</span></a>
      <div class="header-right">
        <span class="nav-user">${escapeHtml(user.ten)} · ${escapeHtml(NHAN_VAI_TRO[user.vaiTro] || user.vaiTro)}</span>
        <button class="icon-btn" onclick="dangXuat()" aria-label="Đăng xuất">${icon('logout')}</button>
      </div>
    </header>
    <nav class="tab-links" aria-label="Điều hướng chính">
      ${links.map(l => `
        <a href="${l.href}" class="${l.key === active ? 'active' : ''}">
          ${icon(l.icon)}<span>${l.label}</span>
        </a>`).join('')}
    </nav>`;
}

// Khối skeleton dùng khi đang tải dữ liệu — thay cho chữ "Đang tải..." khô khan
function skeletonList(soDong = 4) {
  return `<div class="skeleton-list">${'<div class="skeleton-card"></div>'.repeat(soDong)}</div>`;
}

function spinnerInline(chuThich = 'Đang xử lý...') {
  return `<span class="inline-loading">${icon('spinner', { className: 'icon-spin', size: 18 })} ${escapeHtml(chuThich)}</span>`;
}

// TINH_TRANG là chuỗi tự do lấy từ Sheet (không phải enum cố định) — tô màu badge theo từ khoá
// thay vì theo từng giá trị chính xác, để không vỡ khi Sheet có thêm trạng thái mới.
function lopTrangThai(tinhTrang) {
  const s = String(tinhTrang || '').toUpperCase();
  if (s.includes('CANCELLED') || s.includes('HUY') || s.includes('REFUND')) return 'trang-thai-danger';
  if (s.includes('SHIPPED') || s.includes('DELIVERED') || s.includes('TRANSIT') || s.startsWith('B4') || s.startsWith('B5')) return 'trang-thai-success';
  if (s.startsWith('B2') || s.startsWith('B3')) return 'trang-thai-warning';
  return 'trang-thai-info'; // B0, B1, hoặc giá trị chưa biết
}
