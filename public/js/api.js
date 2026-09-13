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
  return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// Ảnh CŨ (trước khi có MinIO) lưu thẳng link Drive/Gemini/HTTP thường trong Sheet — trình duyệt KHÔNG
// tải được link xem trước Drive hay trang chia sẻ Gemini làm <img src> trực tiếp (trả về trang HTML,
// không phải file ảnh thật), nên phải đi qua proxy server tự nhận diện + tải hộ đúng nguồn (xem
// routes/photos.js#GET /anh-ngoai, bổ sung 13/09/2026, theo yêu cầu người dùng). Ảnh MỚI (MinIO, dạng
// /api/photos/file/...) đã tự tải trực tiếp được — CHỈ vòng qua proxy khi KHÔNG PHẢI URL nội bộ đó,
// tránh tốn 1 lượt qua server vô ích với ảnh vốn đã tải thẳng được.
//
// Trả về DANH SÁCH (0-2 phần tử) URL <img src> cần dựng cho 1 ảnh đại diện — không phải 1 chuỗi đơn
// (đổi cùng ngày, theo yêu cầu người dùng: 1 số đơn dán link cả THƯ MỤC Drive chứa NHIỀU ảnh, vd đơn
// 9U115/9U121.2 — cần hiện tối đa 2 ảnh thay vì 1). Ảnh MinIO LUÔN đúng 1 (không có khái niệm "nhiều
// ảnh" cho MinIO) — trả mảng 1 phần tử. Ảnh khác LUÔN thử đủ 2 vị trí (?index=0/&index=1) qua proxy —
// vị trí không có ảnh thật (vd url chỉ có 1 ảnh, hoặc link thư mục chỉ có đúng 1 ảnh bên trong) sẽ tự
// 404 rồi tự "biến mất" nhờ onerror="this.remove()" ở nơi gọi, KHÔNG cần hỏi server trước "có bao
// nhiêu ảnh" mới quyết định vẽ mấy thẻ <img> — đơn giản hoá client. Dùng CHUNG cho mọi nơi hiển thị ảnh
// đại diện đơn (orders.html, order.html, my-orders.html, my-orders-ve-file.html).
function urlAnhHienThiList(rawUrl) {
  if (!rawUrl) return [];
  const duongDan = String(rawUrl).replace(/^https?:\/\/[^/]+/, ''); // bỏ host nếu URL là dạng tuyệt đối cùng gốc, cùng quy ước storageService.js#proxyUrlToObjectKey
  if (duongDan.startsWith('/api/photos/file/')) return [rawUrl];
  const goc = '/api/photos/anh-ngoai?url=' + encodeURIComponent(rawUrl);
  return [goc + '&index=0', goc + '&index=1'];
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
// Trang "chính" theo vai trò — dùng cho CẢ 2 nơi: nút bấm brand/logo trong renderNav() bên dưới (quay
// về trang chính khi đang ở nơi khác) LẪN chuyển hướng ngay sau khi đăng nhập (index.html) — gộp vào
// đúng 1 hàm dùng chung (bổ sung 12/09/2026, trước đó index.html tự lặp lại logic này riêng, có lúc
// quên nhánh nguoi_lay_phoi/san_xuat khiến 2 nơi lệch nhau — xem
// docs/superpowers/specs/2026-09-12-chan-nguoi-lay-phoi-xem-don-hang-design.md).
function trangChuTheoVaiTro(vaiTro) {
  if (vaiTro === 'nguoi_lay_phoi') return '/scan.html';
  if (vaiTro === 'san_xuat') return '/my-orders.html';
  return '/orders.html';
}

function renderNav(user, active) {
  let links;
  if (user.vaiTro === 'nguoi_lay_phoi') {
    links = [
      { href: '/scan.html', label: 'Quét QR', icon: 'navScan', key: 'scan' },
      { href: '/tai-san.html', label: 'SL Phôi', icon: 'navAssets', key: 'tai-san' },
      // Ngoại lệ thứ 3 cho nguoi_lay_phoi (sau Quét QR, SL Phôi) — xem lại hoạt động CHÍNH MÌNH
      // không phải xem đơn hàng nói chung nên không phá chính sách "chỉ thấy Quét QR" ban đầu.
      { href: '/hoat-dong.html', label: 'Lịch sử', icon: 'navActivity', key: 'hoat-dong' },
    ];
  } else if (user.vaiTro === 'san_xuat') {
    // Nhánh riêng cho san_xuat (bổ sung 08/09/2026, theo yêu cầu người dùng) — trước đây dùng chung
    // nhánh else bên dưới với admin/ve_file, chỉ chèn thêm "Đơn của tôi". Giờ san_xuat CHỈ thấy đúng
    // 5 menu (bớt Thống kê/SL Phôi/Trợ lý/Báo cáo — không phục vụ trực tiếp việc chạy máy hằng ngày),
    // và "Đơn của tôi" lên ĐẦU TIÊN (không còn đứng sau "Đơn hàng") vì đây là màn hình họ cần thấy
    // ngay khi vào — cũng là trang mặc định sau đăng nhập (xem trangChu bên dưới và index.html).
    links = [
      { href: '/my-orders.html', label: 'Chạy máy', icon: 'navMyOrders', key: 'my-orders' },
      { href: '/orders.html', label: 'Đơn hàng', icon: 'navOrders', key: 'orders' },
      { href: '/scan.html', label: 'Quét QR', icon: 'navScan', key: 'scan' },
      { href: '/hoat-dong.html', label: 'Lịch sử', icon: 'navActivity', key: 'hoat-dong' },
      { href: '/settings.html', label: 'Setting', icon: 'navSettings', key: 'settings' },
    ];
    // "Tracking" cho san_xuat (bổ sung 09/09/2026 lần 2, theo yêu cầu người dùng — mở toàn bộ trang
    // Tracking cho cả ve_file/san_xuat để dùng 2 nút "IN LABEL"/"MUA TRACKING và IN LABEL", xem
    // routes/tracking.js) — chèn ngay sau "Quét QR" (index 2), cùng vị trí tương đối với admin.
    links.splice(3, 0, { href: '/tracking.html', label: 'Tracking', icon: 'navTracking', key: 'tracking' });
  } else {
    links = [
      { href: '/orders.html', label: 'Đơn hàng', icon: 'navOrders', key: 'orders' },
      { href: '/scan.html', label: 'Quét QR', icon: 'navScan', key: 'scan' },
      { href: '/dashboard.html', label: 'TK', icon: 'navChart', key: 'dashboard' },
      { href: '/tai-san.html', label: 'SL Phôi', icon: 'navAssets', key: 'tai-san' },
      { href: '/chatbot.html', label: 'Trợ lý', icon: 'navSupport', key: 'chatbot' },
      { href: '/reports.html', label: 'Báo cáo', icon: 'navReports', key: 'reports' },
    ];
    // "Đơn của tôi" (bổ sung 31/08/2026) — CHỈ admin còn dùng nhánh này (san_xuat có nhánh riêng ở
    // trên từ 08/09/2026). Admin xem nhanh mọi đơn đang "Đang chạy máy" — routes/orders.js
    // (locDonDangChayMayTheoNguoiVanHanh) chỉ lọc theo NguoiVanHanh cho san_xuat, admin xem được hết.
    // Đổi nhãn "Đơn của tôi · <tên>" → "Chạy máy" và "Đơn của tôi (Vẽ file) · <tên>" → "Vẽ file"
    // (bổ sung 09/09/2026, theo yêu cầu người dùng — áp dụng cho MỌI vai trò dùng nhãn này, kể cả
    // san_xuat/ve_file ở các nhánh khác trong hàm, không chỉ riêng admin) — bỏ hẳn phần ghép tên
    // (+ escapeHtml(user.ten)) vì tên không còn xuất hiện trong nhãn nữa.
    if (user.vaiTro === 'admin') {
      // "Bảng điều khiển" (bổ sung 08/09/2026, xem
      // docs/superpowers/specs/2026-09-08-bang-dieu-khien-admin-design.md) — CHỈ admin, lên ĐẦU TIÊN
      // (khác "Thống kê" vẫn mở cho cả ve_file) vì là màn hình tổng quan nhanh, hợp lý để thấy ngay.
      links.splice(0, 0, { href: '/bang-dieu-khien.html', label: 'BĐK', icon: 'navChart', key: 'bang-dieu-khien' });
      links.splice(2, 0, { href: '/my-orders.html', label: 'Chạy máy', icon: 'navMyOrders', key: 'my-orders' });
      links.splice(3, 0, { href: '/my-orders-ve-file.html', label: 'Vẽ file', icon: 'navMyOrders', key: 'my-orders-ve-file' });
      // "Đơn hàng loạt" (bổ sung 13/09/2026, theo yêu cầu người dùng — LUÔN hiện, khác nút toolbar ẩn/
      // hiện theo vai trò trước đây ở orders.html) — đặt cạnh nhóm "Đơn hàng/Chạy máy/Vẽ file", TRƯỚC
      // Quét QR. Mảng lúc này: [BĐK, Đơn hàng, Chạy máy, Vẽ file, Quét QR, TK, SL Phôi, Trợ lý, Báo cáo]
      // (index 0-8) — chèn tại index 4 là đúng ngay sau "Vẽ file", trước "Quét QR".
      links.splice(4, 0, { href: '/don-hang-loat.html', label: 'Đơn hàng loạt', icon: 'navOrders', key: 'don-hang-loat' });
      // "Tracking" (bổ sung 09/09/2026, xem
      // docs/superpowers/specs/2026-09-09-tu-dong-mua-tracking-design.md) — quản lý bật/tắt + cấu hình
      // tự động mua tracking GKE, có thể phát sinh chi phí thật. Ban đầu CHỈ admin; mở thêm cho
      // ve_file/san_xuat từ 09/09/2026 lần 2 (theo yêu cầu người dùng, để dùng 2 nút "IN LABEL"/"MUA
      // TRACKING và IN LABEL") — người dùng đã cân nhắc và CHỌN mở toàn bộ trang, không chỉ riêng 2 nút
      // đó (xem routes/tracking.js). nguoi_lay_phoi vẫn KHÔNG có mục này (nhánh riêng ở trên, không đi
      // qua đây). Đặt GIỮA "Quét QR" và "TK" — sau khi chèn "Đơn hàng loạt" ở trên, Quét QR đã đẩy từ
      // index 4 lên 5, TK từ 5 lên 6, nên chèn TRƯỚC index 6 (đã tăng từ 5, đổi theo, xem 13/09/2026).
      links.splice(6, 0, { href: '/tracking.html', label: 'Tracking', icon: 'navTracking', key: 'tracking' });
      links.push({ href: '/users.html', label: 'Nhân viên', icon: 'navUsers', key: 'users' });
    }
    // "Đơn của tôi (Vẽ file)" (bổ sung 08/09/2026, theo yêu cầu người dùng — xem
    // docs/superpowers/specs/2026-09-08-don-cua-toi-ve-file-design.md) — ve_file. KHÔNG ẩn menu nào
    // khác, KHÔNG đổi trang mặc định sau đăng nhập của ve_file (khác hẳn cách làm cho san_xuat ở
    // trên) — ngoài phạm vi yêu cầu lần này.
    if (user.vaiTro === 've_file') {
      links.splice(1, 0, { href: '/my-orders-ve-file.html', label: 'Vẽ file', icon: 'navMyOrders', key: 'my-orders-ve-file' });
      // "Đơn hàng loạt" (bổ sung 13/09/2026, theo yêu cầu người dùng — LUÔN hiện) — ngay sau "Vẽ file",
      // trước "Quét QR", cùng vị trí tương đối với nhánh admin ở trên.
      links.splice(2, 0, { href: '/don-hang-loat.html', label: 'Đơn hàng loạt', icon: 'navOrders', key: 'don-hang-loat' });
      // "Tracking" cho ve_file (bổ sung 09/09/2026 lần 2, cùng lý do với nhánh san_xuat ở trên) — chèn
      // ngay sau "Quét QR". Mảng gốc (trước 2 splice 'Vẽ file'/'Đơn hàng loạt' ở trên) là [Đơn hàng,
      // Quét QR, TK, SL Phôi, Trợ lý, Báo cáo]; 2 splice đó đẩy Quét QR từ index 1 lên index 3 — chèn
      // Tracking vào index 4 là đúng ngay sau Quét QR, trước TK.
      links.splice(4, 0, { href: '/tracking.html', label: 'Tracking', icon: 'navTracking', key: 'tracking' });
    }
    links.push({ href: '/hoat-dong.html', label: 'Lịch sử', icon: 'navActivity', key: 'hoat-dong' });
    links.push({ href: '/settings.html', label: 'Setting', icon: 'navSettings', key: 'settings' });
  }

  const nav = document.getElementById('nav');
  if (!nav) return;

  const trangChu = trangChuTheoVaiTro(user.vaiTro);
  // Tên/vai trò + nút đăng xuất — 2 BẢN có chủ đích (bổ sung 09/09/2026, theo yêu cầu người dùng, tham
  // khảo layout 1 hàng của GKE Logistics): 1 bản trong .app-header (CHỈ hiện trên điện thoại — layout
  // di động giữ NGUYÊN, menu vẫn là icon dính đáy màn hình, không đụng), 1 bản trong .tab-links-user
  // (CHỈ hiện từ 768px trở lên, cùng hàng với menu, thay hẳn .app-header — .app-header ẩn ở desktop,
  // bỏ luôn brand "Xưởng Thêu" để tăng diện tích hiển thị). PHẢI dùng nhãn class khác nhau cho .header-
  // right (bản trong .app-header, ẩn/hiện theo chính .app-header) và .tab-links-user (bản trong
  // .tab-links, style.css tự bật/tắt riêng theo breakpoint) — gộp chung 1 class sẽ khiến CSS ẩn/hiện
  // NHẦM cả 2 bản cùng lúc thay vì đúng 1 bản theo màn hình.
  // Nút bật/tắt toàn màn hình (bổ sung 09/09/2026, theo yêu cầu người dùng — tiết kiệm diện tích hiển
  // thị). Đứng cạnh nút đăng xuất, đổi icon maximize/minimize + nhãn theo ĐÚNG trạng thái thật của
  // trình duyệt (nghe sự kiện fullscreenchange — xem toggleFullscreen()/capNhatNutFullscreen() bên
  // dưới) chứ không tự suy đoán, vì người dùng có thể thoát bằng phím Esc thay vì bấm lại nút này.
  const dangFullscreenLucVe = !!document.fullscreenElement;
  const noiDungNguoiDung = `
    <span class="nav-user">${escapeHtml(user.ten)} · ${escapeHtml(NHAN_VAI_TRO[user.vaiTro] || user.vaiTro)}</span>
    <button class="icon-btn btn-fullscreen" onclick="toggleFullscreen()" aria-label="${dangFullscreenLucVe ? 'Thoát toàn màn hình' : 'Toàn màn hình'}">${icon(dangFullscreenLucVe ? 'minimize' : 'maximize')}</button>
    <button class="icon-btn" onclick="dangXuat()" aria-label="Đăng xuất">${icon('logout')}</button>`;
  nav.innerHTML = `
    <header class="app-header">
      <a href="${trangChu}" class="brand">${icon('logo', { size: 26 })}<span>Xưởng Thêu</span></a>
      <div class="header-right">${noiDungNguoiDung}</div>
    </header>
    <nav class="tab-links" aria-label="Điều hướng chính">
      <div class="tab-links-menu">
        ${links.map(l => `
          <a href="${l.href}" class="${l.key === active ? 'active' : ''}">
            <span class="nav-icon-tile">${icon(l.icon, { size: 20 })}</span><span>${l.label}</span>
          </a>`).join('')}
      </div>
      <div class="header-right tab-links-user">${noiDungNguoiDung}</div>
    </nav>`;
  document.removeEventListener('fullscreenchange', capNhatNutFullscreen);
  document.addEventListener('fullscreenchange', capNhatNutFullscreen);
  document.removeEventListener('click', ghiNhoTruocKhiDieuHuong, true);
  document.addEventListener('click', ghiNhoTruocKhiDieuHuong, true);

  // Cố VÀO LẠI toàn màn hình ngay khi trang mới vừa tải, nếu lần trước đang toàn màn hình lúc bấm
  // sang trang này (bổ sung 09/09/2026, theo yêu cầu người dùng — trước đó bấm menu khác là thoát
  // hẳn). LƯU Ý QUAN TRỌNG: trình duyệt CHỈ cho requestFullscreen() thành công khi có "user
  // activation" thật (vừa có thao tác chuột/chạm), mà request này chạy TỰ ĐỘNG lúc tải trang — nhiều
  // khả năng trình duyệt sẽ TỪ CHỐI (đây là giới hạn bảo mật của chính trình duyệt, không phải lỗi
  // code). Cố hết sức + thất bại thì âm thầm bỏ qua (không báo lỗi làm phiền), xem ghi chú đầy đủ ở
  // docs/superpowers/specs/2026-09-09-duy-tri-fullscreen-qua-trang-design.md.
  let muonDuyTriFullscreen = false;
  try { muonDuyTriFullscreen = sessionStorage.getItem('duyTriToanManHinh') === '1'; } catch (e) { /* trình duyệt chặn sessionStorage */ }
  if (muonDuyTriFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {
      // Trình duyệt từ chối — xoá cờ luôn, tránh cố lại vô ích (và gọi API thất bại lặp lại không cần
      // thiết) ở những trang tiếp theo cho tới khi người dùng chủ động bấm nút vào lại.
      try { sessionStorage.removeItem('duyTriToanManHinh'); } catch (err) { /* bỏ qua */ }
    });
  }
}

// Bấm 1 link BẤT KỲ trong lúc đang toàn màn hình = sắp điều hướng sang trang khác — ghi nhớ Ý ĐỊNH
// "muốn duy trì toàn màn hình" vào sessionStorage (còn tới khi đóng tab, đủ cho việc đi lại giữa các
// trang) TRƯỚC KHI trang bắt đầu rời đi, và đánh dấu _vuaBamLinkKhiFullscreen để capNhatNutFullscreen()
// KHÔNG hiểu nhầm đây là 1 lượt thoát chủ động (giống bấm nút/phím Esc) rồi xoá mất cờ vừa ghi.
let _vuaBamLinkKhiFullscreen = false;
function ghiNhoTruocKhiDieuHuong(e) {
  if (!document.fullscreenElement) return;
  if (!e.target.closest('a[href]')) return;
  _vuaBamLinkKhiFullscreen = true;
  try { sessionStorage.setItem('duyTriToanManHinh', '1'); } catch (err) { /* bỏ qua */ }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen()
      .then(() => { try { sessionStorage.setItem('duyTriToanManHinh', '1'); } catch (e) { /* bỏ qua */ } })
      .catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

// Vẽ lại CẢ 2 bản nút (điện thoại trong .app-header, desktop trong .tab-links-user — xem renderNav())
// mỗi khi trạng thái toàn màn hình thật sự đổi, kể cả đổi do bấm Esc chứ không chỉ do bấm nút này.
function capNhatNutFullscreen() {
  const dangFullscreen = !!document.fullscreenElement;
  // Thoát KHÔNG phải do vừa bấm link điều hướng (bấm nút này, hoặc phím Esc) — coi là ý định thoát
  // THẬT, xoá cờ để KHÔNG tự vào lại toàn màn hình ở trang kế tiếp nữa.
  if (!dangFullscreen && !_vuaBamLinkKhiFullscreen) {
    try { sessionStorage.removeItem('duyTriToanManHinh'); } catch (e) { /* bỏ qua */ }
  }
  _vuaBamLinkKhiFullscreen = false;
  document.querySelectorAll('.btn-fullscreen').forEach(btn => {
    btn.innerHTML = icon(dangFullscreen ? 'minimize' : 'maximize');
    btn.setAttribute('aria-label', dangFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình');
  });
}

// Khối skeleton dùng khi đang tải dữ liệu — thay cho chữ "Đang tải..." khô khan
function skeletonList(soDong = 4) {
  return `<div class="skeleton-list">${'<div class="skeleton-card"></div>'.repeat(soDong)}</div>`;
}

function spinnerInline(chuThich = 'Đang xử lý...') {
  return `<span class="inline-loading">${icon('spinner', { className: 'icon-spin', size: 18 })} ${escapeHtml(chuThich)}</span>`;
}

// ============================================================
// IN LABEL/TEM PDF (GKE) — dùng chung cho orders.html/order.html/tracking.html (bổ sung 09/09/2026
// lần 2). scan.html có cơ chế in RIÊNG (inTemTuDong, base64ThanhBlob cục bộ trong file đó) vì gắn chặt
// với luồng camera/khởi động lại quét — KHÔNG đụng vào để tránh ảnh hưởng luồng đó, dù trùng lặp nhỏ.
// ============================================================

function base64ThanhBlob(base64, kieuMime) {
  const nhiPhan = atob(base64);
  const mang = new Uint8Array(nhiPhan.length);
  for (let i = 0; i < nhiPhan.length; i++) mang[i] = nhiPhan.charCodeAt(i);
  return new Blob([mang], { type: kieuMime });
}

// Mở 1 file PDF (tem/label GKE, base64) trong iframe ẩn rồi gọi hộp thoại in của trình duyệt — khổ
// giấy 100x150mm mặc định phụ thuộc máy in đang đặt mặc định trên máy tính đang mở trang này (giống
// hệt cơ chế ở scan.html#inTemTuDong), KHÔNG có cấu hình khổ giấy nào trong code vì PDF từ GKE vốn đã
// đúng khổ tem chuẩn. Trả về hàm goiIn() để gắn thêm vào 1 nút bấm thật — trên điện thoại, trình duyệt
// có thể CHẶN gọi in tự động ở đây vì đã có 1 nhịp chờ API (mất "user activation") giữa lúc bấm nút
// gốc và lúc có label để in; nút thật đảm bảo luôn mở được hộp thoại in trên mọi thiết bị.
function moHopThoaiInPdf(base64Pdf) {
  if (!base64Pdf) return null;
  let urlBlob;
  try {
    urlBlob = URL.createObjectURL(base64ThanhBlob(base64Pdf, 'application/pdf'));
  } catch (e) {
    console.error('[InLabel] Lỗi tạo file PDF để in:', e);
    return null;
  }

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.top = '-9999px';
  iframe.style.left = '-9999px';
  iframe.style.width = '800px';
  iframe.style.height = '1200px';
  iframe.style.border = '0';
  iframe.src = urlBlob;
  document.body.appendChild(iframe);

  let daGoi = false;
  function goiIn() {
    if (daGoi) return;
    daGoi = true;
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      console.error('[InLabel] Lỗi gọi in:', e);
    }
  }
  iframe.onload = () => setTimeout(goiIn, 300);
  return goiIn;
}

// ============================================================
// XỬ LÝ HÀNG LOẠT CÓ TIẾN ĐỘ — dùng chung cho quét QR hàng loạt (scan.html) và đổi trạng thái hàng
// loạt (orders.html). 2 API backend liên quan (/qr/kich-ban/:id/xac-nhan-hang-loat và
// /orders/chuyen-trang-thai-hang-loat) đều nhận mảng sttKeys và đã xử lý đúng với mảng CHỈ 1 phần tử,
// nên KHÔNG cần sửa gì ở server — chỉ đổi cách GỌI: thay vì gửi cả danh sách 1 lần rồi đợi xong mới
// biết kết quả (người vận hành không biết đang tới đâu, có bị treo hay không), giờ gọi TUẦN TỰ từng
// phần tử một để cập nhật số đếm ngay sau mỗi phần tử, đồng thời cho phép Hủy giữa chừng.
// ============================================================

// Vẽ 1 thanh tiến độ nhỏ ngay SAU phần tử `sauPhanTu` (thường là nút bấm vừa được disable), trả về
// {capNhat(hienTai,tong), xoa()} để bên gọi tự cập nhật/dọn dẹp. onHuy (tuỳ chọn) hiện thêm nút "Hủy".
function taoThanhTienDo(sauPhanTu, { onHuy } = {}) {
  const el = document.createElement('div');
  el.className = 'thanh-tien-do';
  el.innerHTML = `
    <div class="thanh-tien-do-track"><div class="thanh-tien-do-fill"></div></div>
    <span class="thanh-tien-do-nhan">0/0</span>
    ${onHuy ? '<button type="button" class="btn-huy-tien-do">Hủy</button>' : ''}
  `;
  sauPhanTu.insertAdjacentElement('afterend', el);
  if (onHuy) el.querySelector('.btn-huy-tien-do').addEventListener('click', onHuy);

  const fill = el.querySelector('.thanh-tien-do-fill');
  const nhan = el.querySelector('.thanh-tien-do-nhan');
  return {
    capNhat(hienTai, tong) {
      fill.style.width = (tong ? Math.round(hienTai / tong * 100) : 0) + '%';
      nhan.textContent = `${hienTai}/${tong}`;
    },
    xoa() { el.remove(); },
  };
}

// Chạy tuần tự xuLyMotPhanTu(phanTu) cho từng phần tử trong danhSach — DỪNG NGAY TRƯỚC phần tử kế
// tiếp nếu kiemTraHuy() trả true (không huỷ phần tử đang xử lý dở, nó vẫn hoàn tất bình thường).
// Gộp kết quả {thanhCong, loi} từ mỗi lần gọi — khớp đúng hình dạng mà 2 API trên đang trả về, nên
// code render kết quả cuối cùng ở scan.html/orders.html không cần đổi.
// Lỗi ở 1 phần tử (network hỏng, server lỗi...) KHÔNG làm dừng cả lô — chỉ phần tử đó rơi vào `loi`,
// các phần tử sau vẫn chạy tiếp (khác hành vi cũ: trước đây 1 request hỏng là mất trắng cả lô).
async function chayHangLoatCoTienDo(danhSach, xuLyMotPhanTu, { onTienDo, kiemTraHuy } = {}) {
  const thanhCong = [];
  const loi = [];
  let daHuy = false;

  for (let i = 0; i < danhSach.length; i++) {
    if (kiemTraHuy && kiemTraHuy()) { daHuy = true; break; }

    try {
      const kq = await xuLyMotPhanTu(danhSach[i]);
      if (kq && Array.isArray(kq.thanhCong)) thanhCong.push(...kq.thanhCong);
      if (kq && Array.isArray(kq.loi)) loi.push(...kq.loi);
    } catch (err) {
      loi.push({ sttKey: danhSach[i], lyDo: err.message });
    }

    if (onTienDo) onTienDo(i + 1, danhSach.length);
  }

  return { thanhCong, loi, daHuy };
}

// Bảng tra cứu CHÍNH XÁC (exact-match) — cập nhật 24/08/2026 theo hệ trạng thái mới (không còn tiền
// tố B[1-5].[12]_ nên không dùng được cách so khớp mẫu/chuỗi con cũ nữa). Cố tình dùng tra cứu CHÍNH
// XÁC thay vì includes()/regex — 2 lần trước đã dính lỗi thật vì so khớp chuỗi con (vd 'HUY' khớp
// nhầm vào giữa chữ 'CHUYỂN', 'TRANSIT' không khớp được 'TRAINSIT' do lệch 1 ký tự) — tra cứu chính
// xác loại bỏ hẳn nguy cơ đó.
const MAU_TRANG_THAI = {
  // TRANG_THAI_XUONG
  'Chưa in mã': 'trang-thai-warning',
  'Đã in mã': 'trang-thai-info',
  'ĐÃ SẴN SÀNG CHẠY MÁY': 'trang-thai-info',
  'Đang chạy máy': 'trang-thai-info',
  'Đã sản xuất': 'trang-thai-success',
  'LỖI SẢN XUẤT CẦN LÀM LẠI': 'trang-thai-danger',
  'ĐÃ DÁN TEM': 'trang-thai-success',
  'DELIVERED_Đã giao đến khách': 'trang-thai-success',
  'CANCELLED_Đã hủy': 'trang-thai-danger',
  'REFUNDED_Hoàn đơn': 'trang-thai-danger',
  // TRANG_THAI_PHOI
  'Chưa lấy phôi': 'trang-thai-warning',
  'Đã lấy phôi': 'trang-thai-success',
  // TRANG_THAI_VE_FILE
  'Chưa vẽ file': 'trang-thai-warning',
  'Đang vẽ file': 'trang-thai-info',
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
