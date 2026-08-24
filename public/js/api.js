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
    { href: '/reports.html', label: 'Báo cáo', icon: 'download', key: 'reports' },
  ];
  if (user.vaiTro === 'admin') {
    links.push({ href: '/users.html', label: 'Nhân viên', icon: 'users', key: 'users' });
  }
  links.push({ href: '/settings.html', label: 'Thiết lập', icon: 'settings', key: 'settings' });

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
// Cập nhật theo pipeline mới (24/08/2026): mỗi giai đoạn B1-B5 giờ có cặp .1_ (đã xong, xanh) và
// .2_ (chưa xong, vàng); B4.3_ĐƠN LỖI CẦN LÀM LẠI xếp cùng nhóm màu đỏ với hủy/hoàn đơn.
function lopTrangThai(tinhTrang) {
  const s = String(tinhTrang || '').toUpperCase();
  if (s.includes('CANCELLED') || s.includes('HUY') || s.includes('REFUND') || s.includes('LỖI')) return 'trang-thai-danger';
  if (s.includes('SHIPPED') || s.includes('DELIVERED') || s.includes('TRANSIT')) return 'trang-thai-success';
  if (/^B[1-5]\.1_/.test(s)) return 'trang-thai-success';
  if (/^B[1-5]\.2_/.test(s)) return 'trang-thai-warning';
  return 'trang-thai-info'; // giá trị chưa biết
}

// Google Sheets trả về cột NGAY_LEN_DON dạng chuỗi DD/MM/YYYY (vd "23/08/2026") — new Date(chuoi)
// mặc định của trình duyệt đọc SAI định dạng này (Invalid Date nếu ngày > 12, đọc nhầm đảo ngược
// tháng/ngày nếu ngày ≤ 12). Bản JS này khớp với services/dateUtils.js phía server để hiển thị
// đúng và nhất quán ở mọi nơi trên giao diện.
function parseNgay(giaTri) {
  if (!giaTri) return null;
  if (giaTri instanceof Date) return isNaN(giaTri) ? null : giaTri;

  const chuoi = String(giaTri).trim();

  let m = chuoi.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isNaN(d) ? null : d;
  }

  m = chuoi.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d) ? null : d;
  }

  const thu = new Date(chuoi);
  return isNaN(thu) ? null : thu;
}

function dinhDangNgay(giaTri) {
  const d = parseNgay(giaTri);
  return d ? d.toLocaleDateString('vi-VN') : '';
}

// Hiệu ứng gợn sóng khi bấm các nút chính — áp dụng tự động cho MỌI trang (chỉ cần nạp api.js),
// không cần sửa từng trang riêng. Chỉ dùng transform/opacity, tự dọn dẹp phần tử sau khi chạy xong,
// tôn trọng cài đặt "giảm chuyển động" của người dùng.
document.addEventListener('click', (e) => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const nut = e.target.closest('.btn-hanh-dong, .btn-ten, .btn-xac-nhan-nhom, .kich-ban-btn, .btn-dung-quet, .mau-swatch, .btn-tiep-tuc-quet');
  if (!nut || nut.disabled) return;

  const vung = nut.getBoundingClientRect();
  const gon = document.createElement('span');
  gon.className = 'gon-song';
  const kichThuoc = Math.max(vung.width, vung.height) * 1.3;
  gon.style.width = gon.style.height = kichThuoc + 'px';
  gon.style.left = (e.clientX - vung.left - kichThuoc / 2) + 'px';
  gon.style.top = (e.clientY - vung.top - kichThuoc / 2) + 'px';
  nut.appendChild(gon);
  gon.addEventListener('animationend', () => gon.remove());
});
