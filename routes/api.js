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
// CHÍNH SÁCH PHÂN QUYỀN (24/08/2026): nguoi_lay_phoi chỉ nhìn thấy DUY NHẤT menu "Quét mã QR" — ẩn
// hết mọi menu khác (kể cả Cài đặt và Trợ lý, đã xác nhận rõ với người dùng). Nút Đăng xuất ở góc
// trên vẫn luôn hiện cho mọi vai trò (không phải 1 "menu" theo nghĩa điều hướng trang).
// Icon menu dùng bộ 'nav*' riêng trong icons.js (navOrders, navScan...) — bọc trong
// <span class="nav-icon-tile"> để Chế độ Tối vẽ thêm khối bo góc phát sáng quanh icon (xem style.css);
// Chế độ Sáng không style .nav-icon-tile nên nhìn như trước, không đổi gì.
function renderNav(user, active) {
  let links;
  if (user.vaiTro === 'nguoi_lay_phoi') {
    links = [{ href: '/scan.html', label: 'Quét QR', icon: 'navScan', key: 'scan' }];
  } else {
    links = [
      { href: '/orders.html', label: 'Đơn hàng', icon: 'navOrders', key: 'orders' },
      { href: '/scan.html', label: 'Quét QR', icon: 'navScan', key: 'scan' },
      { href: '/dashboard.html', label: 'Thống kê', icon: 'navChart', key: 'dashboard' },
      { href: '/hoat-dong-cua-toi.html', label: 'Hoạt động', icon: 'navHistory', key: 'hoatdong' },
      { href: '/chatbot.html', label: 'Trợ lý', icon: 'navSupport', key: 'chatbot' },
      { href: '/reports.html', label: 'Báo cáo', icon: 'navReports', key: 'reports' },
    ];
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
          <span class="nav-icon-tile">${icon(l.icon, { size: 20 })}${l.key === 'orders' ? '<span id=\"nav-badge-cho-xac-nhan\" class=\"nav-badge\" style=\"display:none\"></span>' : ''}</span><span>${l.label}</span>
        </a>`).join('')}
    </nav>`;

  // Badge số đơn "Chưa xác nhận" trên icon "Đơn hàng" — chỉ admin/ve_file mới thấy được các đơn này
  // (san_xuat/nguoi_lay_phoi không nhìn thấy trạng thái "Chưa xác nhận" nên API sẽ luôn trả về 0 cho
  // họ, không cần lọc riêng ở đây). Không chặn hiển thị nav để chờ — badge tự cập nhật khi có dữ liệu.
  if (user.vaiTro === 'admin' || user.vaiTro === 've_file') {
    apiFetch('/orders/dem-cho-xac-nhan').then(({ soLuong }) => {
      const badge = document.getElementById('nav-badge-cho-xac-nhan');
      if (!badge || !soLuong) return;
      badge.textContent = soLuong > 99 ? '99+' : soLuong;
      badge.style.display = '';
    }).catch(() => {});
  }
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

// Lightbox phóng to ảnh — dùng chung mọi trang (order-card, ảnh mẫu/mockup ở trang chi tiết đơn).
// Chỉ tạo 1 overlay DÙNG CHUNG duy nhất trên trang, tái sử dụng cho mọi lần bấm ảnh.
// Toast/snackbar trong app — thay cho alert() của trình duyệt (chặn thao tác, xấu trên mobile) cho
// các thông báo NGẮN, tự biến mất. Dùng chung mọi trang (thêm 27/08/2026).
function toast(thongDiep, loai = 'info', thoiGianMs = 3500) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${loai}`;
  el.textContent = thongDiep;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('hien'));
  setTimeout(() => {
    el.classList.remove('hien');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, thoiGianMs);
}

// Hộp thoại xác nhận trong app — thay cho confirm() của trình duyệt (chặn thao tác, không tuỳ biến
// được). Trả về Promise<boolean> để dùng với await giống confirm() cũ.
function xacNhanHanhDong(thongDiep, nhanDongY = 'Đồng ý', nhanHuy = 'Huỷ') {
  return new Promise((resolve) => {
    const overlay = layHoacTaoOverlayThongBao();
    overlay.innerHTML = `
      <div class="xac-nhan-box">
        <p>${escapeHtml(thongDiep)}</p>
        <div class="xac-nhan-nut-hang">
          <button class="btn-hanh-dong phu" id="xac-nhan-nut-huy">${escapeHtml(nhanHuy)}</button>
          <button class="btn-hanh-dong" id="xac-nhan-nut-dong-y">${escapeHtml(nhanDongY)}</button>
        </div>
      </div>`;
    overlay.style.display = 'flex';
    const dong = (ketQua) => { overlay.style.display = 'none'; resolve(ketQua); };
    document.getElementById('xac-nhan-nut-huy').onclick = () => dong(false);
    document.getElementById('xac-nhan-nut-dong-y').onclick = () => dong(true);
    overlay.onclick = (e) => { if (e.target === overlay) dong(false); };
  });
}

// Hộp thoại thông báo CHI TIẾT, không tự biến mất — dùng khi nội dung dài/nhiều dòng (vd danh sách
// lỗi khi cập nhật hàng loạt), không hợp để làm toast (toast chỉ hợp thông báo ngắn, tự mất).
function hienThongBaoChiTiet(tieuDe, cacDong) {
  const overlay = layHoacTaoOverlayThongBao();
  overlay.innerHTML = `
    <div class="xac-nhan-box">
      <strong>${escapeHtml(tieuDe)}</strong>
      <div style="max-height:50vh;overflow-y:auto;font-size:0.88rem;white-space:pre-line">${escapeHtml(cacDong.join('\n'))}</div>
      <div class="xac-nhan-nut-hang">
        <button class="btn-hanh-dong" id="xac-nhan-nut-dong">Đóng</button>
      </div>
    </div>`;
  overlay.style.display = 'flex';
  const dong = () => { overlay.style.display = 'none'; };
  document.getElementById('xac-nhan-nut-dong').onclick = dong;
  overlay.onclick = (e) => { if (e.target === overlay) dong(); };
}

function layHoacTaoOverlayThongBao() {
  let overlay = document.getElementById('xac-nhan-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'xac-nhan-overlay';
    overlay.className = 'xac-nhan-overlay';
    document.body.appendChild(overlay);
  }
  return overlay;
}

// Khối lỗi tải dữ liệu CÓ NÚT "Thử lại" ngay tại chỗ — thay vì bắt người dùng reload cả trang khi
// mất mạng/API lỗi tạm thời (thêm 27/08/2026). 'tenHamThuLai' là TÊN (chuỗi) của 1 hàm global
// KHÔNG cần tham số để tải lại đúng dữ liệu đó (vd 'taiDon', 'taiChiTiet').
// Gợi ý nhỏ hiện 1 LẦN DUY NHẤT cạnh 1 phần tử (thêm 27/08/2026) — dùng cho tính năng mới ra mắt (vd
// tab "Đơn của tôi", nút "Bộ lọc") để nhân viên biết tính năng tồn tại, không cần ai giải thích
// miệng. Nhớ theo trình duyệt/thiết bị (localStorage) qua 'idGoiY' — đã đóng/hết giờ thì không hiện
// lại nữa trên đúng thiết bị đó.
function goiYMotLan(idPhanTu, idGoiY, noiDung) {
  const KEY = 'xuongTheu_daXemGoiY_' + idGoiY;
  if (localStorage.getItem(KEY)) return;
  const target = document.getElementById(idPhanTu);
  if (!target) return;

  const box = document.createElement('div');
  box.className = 'goi-y-mot-lan';
  box.innerHTML = `<span>${escapeHtml(noiDung)}</span><button type="button" aria-label="Đóng gợi ý">&times;</button>`;
  const kieuTinhCu = getComputedStyle(target).position;
  if (kieuTinhCu === 'static') target.style.position = 'relative';
  target.appendChild(box);

  const dong = () => { localStorage.setItem(KEY, '1'); box.remove(); };
  box.querySelector('button').onclick = (e) => { e.stopPropagation(); dong(); };
  setTimeout(dong, 8000); // tự ẩn sau 8s nếu không ai bấm — không chặn thao tác của người dùng
}

function khoiLoiTaiLai(thongDiep, tenHamThuLai) {
  return `<div class="khoi-loi-tai-lai">
    <p>${icon('alert')} ${escapeHtml(thongDiep)}</p>
    <button type="button" class="btn-hanh-dong phu" onclick="${tenHamThuLai}()">${icon('undo', { size: 16 })} Thử lại</button>
  </div>`;
}

// Ảnh lỗi/chưa có — thay ảnh vỡ bằng khung SVG "Không có ảnh" giữ NGUYÊN kích thước gốc (thêm
// 27/08/2026) — trước đây this.remove() làm mất luôn khoảng trống, lệch layout. Dùng data URI thay
// vì đổi hẳn sang <div> để giữ nguyên mọi CSS (kích thước, object-fit...) đã áp cho thẻ <img> gốc.
const ANH_LOI_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect width="100" height="100" fill="#d4d4d8"/>' +
  '<text x="50" y="54" font-size="11" text-anchor="middle" fill="#71717a" font-family="sans-serif">Không có ảnh</text>' +
  '</svg>'
);
function anhLoi(imgEl) {
  imgEl.onerror = null; // tránh lặp vô hạn nếu chính data URI cũng lỗi — không nên xảy ra nhưng phòng hờ
  imgEl.src = ANH_LOI_SVG;
  imgEl.classList.add('anh-khong-co');
}

// Nén ảnh phía trình duyệt TRƯỚC khi upload (thêm 27/08/2026) — giảm dung lượng đáng kể, quan trọng
// nếu mạng xưởng yếu. Giới hạn cạnh dài nhất về maxKichThuoc, xuất JPEG chất lượng vừa phải. Nếu vì
// lý do gì đó không nén được (ảnh hỏng, trình duyệt không hỗ trợ canvas...), NÊN để nơi gọi tự bắt
// lỗi và fallback về ảnh gốc — không chặn hẳn việc upload chỉ vì bước nén thất bại.
function neniAnh(file, maxKichThuoc = 1600, chatLuong = 0.8) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { resolve(file); return; } // không phải ảnh — bỏ qua bước nén
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxKichThuoc || height > maxKichThuoc) {
        const tiLe = maxKichThuoc / Math.max(width, height);
        width = Math.round(width * tiLe);
        height = Math.round(height * tiLe);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => { blob ? resolve(blob) : reject(new Error('Không nén được ảnh')); }, 'image/jpeg', chatLuong);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh')); };
    img.src = url;
  });
}

// Upload CÓ TIẾN ĐỘ % — fetch() không hỗ trợ theo dõi tiến độ gửi lên, phải dùng XMLHttpRequest.
function taiLenCoTienDo(url, formData, onTienDo) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onTienDo) onTienDo(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch (e) { data = {}; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'Có lỗi xảy ra'));
    };
    xhr.onerror = () => reject(new Error('Lỗi kết nối mạng'));
    xhr.send(formData);
  });
}

function moLightbox(src) {
  if (!src) return;
  let overlay = document.getElementById('lightbox-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'lightbox-overlay';
    overlay.className = 'lightbox-overlay';
    overlay.onclick = () => { overlay.style.display = 'none'; };
    overlay.innerHTML = '<img id="lightbox-img" src="" alt="Ảnh phóng to">';
    document.body.appendChild(overlay);
  }
  document.getElementById('lightbox-img').src = src;
  overlay.style.display = 'flex';
}

// Nhãn tiếng Việt cho các mã HanhDong ghi trong LichSuHoatDong (services/logService.js) — dùng
// chung cho timeline trang chi tiết đơn (order.html) và trang Hoạt động của tôi
// (hoat-dong-cua-toi.html), tránh lặp lại định nghĩa ở 2 nơi.
const NHAN_HANH_DONG = {
  QUET_TRA_CUU: 'Quét tra cứu',
  QUET_TRA_CUU_LOI: 'Quét tra cứu (không tìm thấy)',
  QUET_KICH_BAN: 'Quét chuyển trạng thái',
  QUET_KICH_BAN_HANG_LOAT: 'Quét chuyển trạng thái (hàng loạt)',
  QUET_LOI: 'Quét lỗi',
  QUET_SAI_TRANG_THAI: 'Quét sai trạng thái',
  QUET_KIEM_TRA_OK: 'Kiểm tra quét — hợp lệ',
  QUET_KIEM_TRA_SAI_TRANG_THAI: 'Kiểm tra quét — sai trạng thái',
  QUET_KIEM_TRA_KHONG_TIM_THAY: 'Kiểm tra quét — không tìm thấy đơn',
  CAP_NHAT_DON: 'Sửa đơn hàng',
  CHUYEN_TRANG_THAI_HANG_LOAT: 'Chuyển trạng thái (hàng loạt)',
  UPLOAD_ANH: 'Upload ảnh',
};
function nhanHanhDong(ma) { return NHAN_HANH_DONG[ma] || ma; }

// Phím tắt toàn app (thêm 27/08/2026): "/" focus vào ô tìm kiếm chính (đánh dấu bằng thuộc tính
// data-shortcut-search — hiện chỉ orders.html có), "Esc" đóng lightbox/modal đang mở. Bỏ qua khi
// đang gõ trong 1 ô nhập liệu khác (không "cướp" phím / hay Esc của người dùng đang gõ chữ có ký tự
// này, dù hiếm). Với hộp thoại xác nhận (xacNhanHanhDong), Esc bấm HỘ nút "Huỷ" — không chỉ ẩn đi —
// để Promise đang chờ được resolve(false) đúng cách, tránh treo lời gọi await mãi mãi.
document.addEventListener('keydown', (e) => {
  const dangGoOFormNhap = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

  if (e.key === '/' && !dangGoOFormNhap) {
    const oTimKiem = document.querySelector('[data-shortcut-search]');
    if (oTimKiem) { e.preventDefault(); oTimKiem.focus(); }
    return;
  }

  if (e.key === 'Escape') {
    const lb = document.getElementById('lightbox-overlay');
    if (lb && lb.style.display === 'flex') lb.style.display = 'none';

    const tem = document.getElementById('tem-preview-overlay');
    if (tem && tem.style.display === 'flex') tem.style.display = 'none';

    const xn = document.getElementById('xac-nhan-overlay');
    if (xn && xn.style.display === 'flex') {
      const nutHuy = document.getElementById('xac-nhan-nut-huy');
      const nutDong = document.getElementById('xac-nhan-nut-dong');
      (nutHuy || nutDong)?.click();
    }
  }
});

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
