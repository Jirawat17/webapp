const API = '/api';

const NHAN_VAI_TRO = {
  admin: 'Admin',
  nguoi_lay_phoi: 'Người lấy phôi',
  ve_file: 'Vẽ file',
  san_xuat: 'Sản xuất',
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
// CHÍNH SÁCH PHÂN QUYỀN (24/08/2026, sửa 31/08/2026): nguoi_lay_phoi chỉ nhìn thấy 2 menu "Quét mã
// QR" và "SL Phôi" — ẩn hết mọi menu khác (kể cả Cài đặt và Trợ lý, đã xác nhận rõ với người dùng).
// "SL Phôi" là NGOẠI LỆ được thêm riêng (31/08/2026, theo yêu cầu người dùng) vì đây chính là vai trò
// trực tiếp lấy phôi ngoài đời — cần xem tồn kho + tự nhập kho, xem routes/taiSan.js. Nút Đăng xuất
// ở góc trên vẫn luôn hiện cho mọi vai trò (không phải 1 "menu" theo nghĩa điều hướng trang).
// Icon menu dùng bộ 'nav*' riêng trong icons.js (navOrders, navScan...) — bọc trong
// <span class="nav-icon-tile"> để Chế độ Tối vẽ thêm khối bo góc phát sáng quanh icon (xem style.css);
// Chế độ Sáng không style .nav-icon-tile nên nhìn như trước, không đổi gì.
function renderNav(user, active) {
  let links;
  if (user.vaiTro === 'nguoi_lay_phoi') {
    links = [
      { href: '/scan.html', label: 'Quét QR', icon: 'navScan', key: 'scan' },
      { href: '/tai-san.html', label: 'SL Phôi', icon: 'navAssets', key: 'tai-san' },
    ];
  } else {
    links = [
      { href: '/orders.html', label: 'Đơn hàng', icon: 'navOrders', key: 'orders' },
      { href: '/scan.html', label: 'Quét QR', icon: 'navScan', key: 'scan' },
      { href: '/dashboard.html', label: 'Thống kê', icon: 'navChart', key: 'dashboard' },
      { href: '/tai-san.html', label: 'SL Phôi', icon: 'navAssets', key: 'tai-san' },
      { href: '/chatbot.html', label: 'Trợ lý', icon: 'navSupport', key: 'chatbot' },
      { href: '/reports.html', label: 'Báo cáo', icon: 'navReports', key: 'reports' },
    ];
    // "Đơn của tôi" (bổ sung 31/08/2026, theo yêu cầu người dùng) — chỉ san_xuat mới có khái niệm
    // "đơn tôi đang chạy máy", nên chèn ngay sau "Đơn hàng" thay vì thêm cho mọi vai trò.
    if (user.vaiTro === 'san_xuat') {
      links.splice(1, 0, { href: '/my-orders.html', label: 'Đơn của tôi', icon: 'navMyOrders', key: 'my-orders' });
    }
    if (user.vaiTro === 'admin') {
      links.push({ href: '/users.html', label: 'Nhân viên', icon: 'navUsers', key: 'users' });
    }
    links.push({ href: '/settings.html', label: 'Thiết lập', icon: 'navSettings', key: 'settings' });
  }

  const nav = document.getElementById('nav');
  if (!nav) return;

  const trangChu = user.vaiTro === 'nguoi_lay_phoi' ? '/scan.html' : '/orders.html';
  nav.innerHTML = `
    <header class="app-header">
      <a href="${trangChu}" class="brand">${icon('logo', { size: 26 })}<span>Xưởng Thêu</span></a>
      <div class="header-right">
        <span class="nav-user">${escapeHtml(user.ten)} · ${escapeHtml(NHAN_VAI_TRO[user.vaiTro] || user.vaiTro)}</span>
        <button class="icon-btn" onclick="dangXuat()" aria-label="Đăng xuất">${icon('logout')}</button>
      </div>
    </header>
    <nav class="tab-links" aria-label="Điều hướng chính">
      ${links.map(l => `
        <a href="${l.href}" class="${l.key === active ? 'active' : ''}">
          <span class="nav-icon-tile">${icon(l.icon, { size: 20 })}</span><span>${l.label}</span>
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

// Bảng tra cứu CHÍNH XÁC (exact-match) — cập nhật 24/08/2026 theo hệ trạng thái mới (không còn tiền
// tố B[1-5].[12]_ nên không dùng được cách so khớp mẫu/chuỗi con cũ nữa). Cố tình dùng tra cứu CHÍNH
// XÁC thay vì includes()/regex — 2 lần trước đã dính lỗi thật vì so khớp chuỗi con (vd 'HUY' khớp
// nhầm vào giữa chữ 'CHUYỂN', 'TRANSIT' không khớp được 'TRAINSIT' do lệch 1 ký tự) — tra cứu chính
// xác loại bỏ hẳn nguy cơ đó.
const MAU_TRANG_THAI = {
  // TINH_TRANG
  'Chưa xác nhận': 'trang-thai-warning',
  'Đã xác nhận': 'trang-thai-info',
  'ĐÃ SẴN SÀNG CHẠY MÁY': 'trang-thai-info',
  'Đang chạy máy': 'trang-thai-info',
  'Đã sản xuất': 'trang-thai-success',
  'LỖI SẢN XUẤT CẦN LÀM LẠI': 'trang-thai-danger',
  'Đã đóng gói': 'trang-thai-success',
  'IN TRANSIT_Tracking đã hoạt động': 'trang-thai-success',
  'DELIVERED_Đã giao đến khách': 'trang-thai-success',
  'CANCELLED_Đã hủy': 'trang-thai-danger',
  'REFUNDED_Hoàn đơn': 'trang-thai-danger',
  // TRANG_THAI_PHOI
  'Chưa lấy phôi': 'trang-thai-warning',
  'Đã lấy phôi': 'trang-thai-success',
  // TRANG_THAI_VE_FILE
  'Chưa vẽ file': 'trang-thai-warning',
  'Đã vẽ file': 'trang-thai-success',
};
function lopTrangThai(tinhTrang) {
  return MAU_TRANG_THAI[tinhTrang] || 'trang-thai-info'; // giá trị lạ/chưa biết
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
