const API = '/api';

const NHAN_VAI_TRO = {
  admin: 'Admin',
  superadmin: 'Superadmin',
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

// Sao chép nhanh (04/10/2026, theo yêu cầu người dùng — mã đơn, địa chỉ, tracking). navigator.clipboard chỉ chạy trên
// https/localhost và có thể bị từ chối -> dùng ô chữ ẩn + execCommand('copy'). Báo kết quả ngay trên nút trong 2 giây.
async function saoChepNhanh(text, nut) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
    const o = document.createElement('textarea');
    o.value = text; o.setAttribute('readonly', ''); o.style.position = 'fixed'; o.style.opacity = '0';
    document.body.appendChild(o); o.select();
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    o.remove();
  }
  if (nut) {
    if (nut.dataset.nhanGoc === undefined) nut.dataset.nhanGoc = nut.innerHTML;
    nut.textContent = ok ? 'Đã sao chép' : 'Không sao chép được';
    clearTimeout(nut._henKhoiPhuc);
    nut._henKhoiPhuc = setTimeout(() => { nut.innerHTML = nut.dataset.nhanGoc; }, 2000);
  }
  return ok;
}
// Nút nhỏ sao chép 1 giá trị (đặt ngay sau giá trị đó). Giá trị nằm trong data-chep (đã escape), không ghép vào onclick.
function nutSaoChep(giaTri, nhan = 'Sao chép') {
  return `<button type="button" title="${escapeHtml(nhan)}" aria-label="${escapeHtml(nhan)}" data-chep="${escapeHtml(giaTri)}"
    onclick="event.stopPropagation(); saoChepNhanh(this.dataset.chep, this)"
    style="border:1px solid var(--color-border);background:transparent;border-radius:6px;padding:2px 6px;margin-left:6px;cursor:pointer;color:var(--color-text-muted);vertical-align:middle;line-height:1;font-size:0.78rem;font-family:inherit">${typeof icon === 'function' ? icon('copy', { size: 15 }) : 'Chép'}</button>`;
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
// ảnh" cho MinIO) — trả mảng 1 phần tử. Dùng CHUNG cho mọi nơi hiển thị ảnh đại diện đơn (orders.html,
// order.html, my-orders.html, my-orders-ve-file.html, don-hang-loat.html).
//
// CHỈ link THƯ MỤC Drive (xem services/driveService.js#layFolderIdTuLinkDrive) mới có thể có ảnh thứ
// 2 — link file đơn/URL thường/trang Gemini LUÔN đúng 1 ảnh (xem services/anhNguonService.js#taiAnh).
// Trước đây LUÔN thử cả ?index=0 lẫn &index=1 cho MỌI nguồn (bổ sung 21/09/2026, theo yêu cầu người
// dùng cải thiện tốc độ Danh sách đơn hàng — nhận diện được thư mục Drive rồi mới quyết định số ảnh
// cần thử, tránh 1 request 404 vô ích cho phần lớn đơn chỉ dán link 1 ảnh).
//
// `chieuRong` (bổ sung cùng ngày) — cạnh dài tối đa server resize về trước khi trả (xem
// routes/photos.js#CAC_CHIEU_RONG_HOP_LE, PHẢI khớp đúng 2 giá trị dưới đây). Mặc định dùng cỡ NHỎ
// (khớp khung ảnh 132-160px CSS ở thẻ đơn/lưới, x2 cho màn Retina) — nơi gọi duy nhất cần ảnh to hơn
// (trang Chi tiết đơn, khung .anh-mau tới 320px) tự truyền CHIEU_RONG_ANH_CHI_TIET.
const CHIEU_RONG_ANH_THU_NHO = 320;
const CHIEU_RONG_ANH_CHI_TIET = 1000;
function urlAnhHienThiList(rawUrl, chieuRong = CHIEU_RONG_ANH_THU_NHO) {
  if (!rawUrl) return [];
  const duongDan = String(rawUrl).replace(/^https?:\/\/[^/]+/, ''); // bỏ host nếu URL là dạng tuyệt đối cùng gốc, cùng quy ước storageService.js#proxyUrlToObjectKey
  if (duongDan.startsWith('/api/photos/file/')) return [rawUrl];
  const goc = '/api/photos/anh-ngoai?url=' + encodeURIComponent(rawUrl) + '&w=' + chieuRong;
  const laThuMucDrive = /\/folders\//.test(rawUrl);
  return laThuMucDrive ? [goc + '&index=0', goc + '&index=1'] : [goc + '&index=0'];
}

// Y20 (11/10/2026): ghi lại 20 lỗi JavaScript + 10 lần gọi API lỗi gần nhất kể từ lúc mở trang — gửi kèm khi nhân viên bấm "Báo lỗi".
const _loiJsGanDay = [], _loiApiGanDay = [];
const _ghiVaoDs = (ds, x, toiDa) => { ds.push({ luc: new Date().toISOString(), ...x }); if (ds.length > toiDa) ds.shift(); };
// Cắt ngắn từng dòng để 20 + 10 lỗi luôn nằm gọn trong giới hạn gửi báo lỗi (routes/baoLoi.js, 200KB).
addEventListener('error', e => _ghiVaoDs(_loiJsGanDay, { loi: String(e.message || 'Lỗi').slice(0, 1000), noi: `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}`.slice(0, 300) }, 20));
addEventListener('unhandledrejection', e => _ghiVaoDs(_loiJsGanDay, { loi: 'Promise: ' + String((e.reason && (e.reason.stack || e.reason.message)) || e.reason).slice(0, 500) }, 20));

async function apiFetch(url, options = {}) {
  const res = await fetch(API + url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (url !== '/bao-loi') _ghiVaoDs(_loiApiGanDay, { url: String(url).slice(0, 300), ma: res.status, loi: String(data.error || '').slice(0, 300) }, 10);
    throw new Error(data.error || 'Có lỗi xảy ra');
  }
  return data;
}

// Y20 "Báo lỗi app" (11/10/2026, theo yêu cầu người dùng): khung báo lỗi mở từ nút trên thanh menu (mọi vai trò). Mô tả bắt buộc; ảnh
// màn hình tuỳ chọn (dán Ctrl+V, chọn file, chụp trên điện thoại); tự gửi kèm trang, trình duyệt, cỡ màn hình, lỗi JS/API gần nhất.
let _anhBaoLoi = null;
const NHAN_TRANG_THAI_BAO_LOI = { MOI: 'Mới', DANG_XU_LY: 'Đang xử lý', DA_XONG: 'Đã xong' };
function moBaoLoi() {
  let hop = document.getElementById('hop-bao-loi');
  if (!hop) {
    hop = document.createElement('dialog');
    hop.id = 'hop-bao-loi';
    hop.style.cssText = 'width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);padding:16px;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);color:var(--color-text)';
    hop.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">Báo lỗi app</h3>
        <button type="button" class="btn-hanh-dong phu" onclick="document.getElementById('hop-bao-loi').close()">Đóng</button></div>
      <p style="margin:6px 0;color:var(--color-text-muted);font-size:0.85rem">Trang đang mở, trình duyệt và lỗi kỹ thuật gần nhất được gửi kèm tự động.</p>
      <label for="bao-loi-mo-ta" style="font-weight:700">Mô tả lỗi (bắt buộc)</label>
      <textarea id="bao-loi-mo-ta" rows="4" maxlength="4000" style="width:100%;margin:4px 0 8px" placeholder="Bạn đang làm gì thì gặp lỗi? Lỗi hiện ra thế nào?"></textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn-hanh-dong phu" onclick="document.getElementById('bao-loi-chon-anh').click()">Chọn ảnh</button>
        <button type="button" class="btn-hanh-dong phu" onclick="document.getElementById('bao-loi-chup-anh').click()">Chụp ảnh</button>
        <span style="font-size:0.85rem;color:var(--color-text-muted)">hoặc Ctrl+V để dán ảnh chụp màn hình</span>
        <input type="file" id="bao-loi-chon-anh" accept="image/png,image/jpeg" hidden onchange="datAnhBaoLoi(this.files[0]); this.value = ''">
        <input type="file" id="bao-loi-chup-anh" accept="image/*" capture="environment" hidden onchange="datAnhBaoLoi(this.files[0]); this.value = ''">
      </div>
      <div id="bao-loi-xem-anh" style="margin:8px 0"></div>
      <button type="button" class="btn-hanh-dong" id="bao-loi-gui" onclick="guiBaoLoi()">Gửi báo lỗi</button>
      <p id="bao-loi-thong-bao" role="status" style="margin:8px 0 0"></p>
      <h4 style="margin:16px 0 6px">Báo lỗi gần đây của bạn</h4>
      <div id="bao-loi-cua-toi" style="font-size:0.85rem"></div>`;
    hop.addEventListener('paste', e => {
      const anh = [...((e.clipboardData && e.clipboardData.files) || [])].find(f => /^image\//.test(f.type));
      if (anh) { e.preventDefault(); datAnhBaoLoi(anh); }
    });
    document.body.appendChild(hop);
  }
  document.getElementById('bao-loi-thong-bao').textContent = '';
  hop.showModal();
  taiBaoLoiCuaToi();
}
function datAnhBaoLoi(file) {
  const el = document.getElementById('bao-loi-xem-anh');
  _anhBaoLoi = file && /^image\/(png|jpeg)$/.test(file.type) ? file : null;
  if (file && !_anhBaoLoi) { el.innerHTML = '<span style="color:var(--color-danger-text)">Chỉ nhận ảnh PNG hoặc JPEG.</span>'; return; }
  if (_anhBaoLoi && _anhBaoLoi.size > 5 * 1024 * 1024) { _anhBaoLoi = null; el.innerHTML = '<span style="color:var(--color-danger-text)">Ảnh quá lớn (tối đa 5MB).</span>'; return; }
  el.innerHTML = _anhBaoLoi ? `<img src="${URL.createObjectURL(_anhBaoLoi)}" alt="" style="max-width:100%;max-height:200px;border-radius:6px;display:block">
    <button type="button" class="btn-hanh-dong phu" style="margin-top:4px" onclick="datAnhBaoLoi(null)">Bỏ ảnh</button>` : '';
}
async function guiBaoLoi() {
  const moTa = document.getElementById('bao-loi-mo-ta').value.trim();
  const tb = document.getElementById('bao-loi-thong-bao');
  if (!moTa) { tb.style.color = 'var(--color-danger-text)'; tb.textContent = 'Hãy mô tả lỗi trước khi gửi.'; return; }
  const nut = document.getElementById('bao-loi-gui');
  nut.disabled = true;
  const fd = new FormData();
  fd.append('moTa', moTa);
  // Kích thước luôn nhỏ (< ~40KB): từng lỗi đã cắt ngắn lúc ghi (_ghiVaoDs ở trên), server còn tự giới hạn từng trường (routes/baoLoi.js).
  fd.append('thongTin', JSON.stringify({
    trang: location.pathname + location.search, gio: new Date().toISOString(), trinhDuyet: navigator.userAgent,
    manHinh: `${innerWidth}x${innerHeight} (màn hình ${screen.width}x${screen.height}, tỉ lệ ${devicePixelRatio})`,
    loiJs: _loiJsGanDay, loiApi: _loiApiGanDay,
  }));
  if (_anhBaoLoi) fd.append('anh', _anhBaoLoi, _anhBaoLoi.name || 'anh.png');
  try {
    const kq = await apiFetch('/bao-loi', { method: 'POST', body: fd, headers: {} });
    tb.style.color = 'var(--color-success-text)';
    tb.textContent = `Đã gửi báo lỗi #${kq.id}. Cảm ơn bạn!${kq.loiAnh ? ' (' + kq.loiAnh + ')' : ''}`;
    document.getElementById('bao-loi-mo-ta').value = '';
    datAnhBaoLoi(null);
    taiBaoLoiCuaToi();
  } catch (e) {
    tb.style.color = 'var(--color-danger-text)';
    tb.textContent = 'Lỗi: ' + e.message;
  } finally {
    nut.disabled = false;
  }
}
async function taiBaoLoiCuaToi() {
  const el = document.getElementById('bao-loi-cua-toi');
  try {
    const ds = await apiFetch('/bao-loi/cua-toi');
    el.innerHTML = ds.length ? ds.map(b => `<div style="padding:6px 0;border-top:1px solid var(--color-border)">
        <b>#${b.id}</b> · ${escapeHtml(String(b.luc).slice(0, 16).replace('T', ' '))} · <b>${escapeHtml(NHAN_TRANG_THAI_BAO_LOI[b.trangThai] || b.trangThai)}</b>
        <div>${escapeHtml(b.moTa.slice(0, 200))}</div>${b.ghiChu ? `<div style="color:var(--color-text-muted)">Phản hồi: ${escapeHtml(b.ghiChu)}</div>` : ''}</div>`).join('')
      : '<span style="color:var(--color-text-muted)">Chưa có.</span>';
  } catch (e) { el.textContent = ''; }
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
// superadmin (bổ sung 18/09/2026, theo yêu cầu người dùng) — có MỌI quyền admin, kể cả ẨN/HIỆN menu.
// Hàm này CHỈ quyết định giao diện hiện gì — không phải lớp bảo vệ thật (chặn thật luôn nằm ở server,
// xem middleware/auth.js#laAdmin bản phía server, PHẢI sửa đồng bộ cả 2 nơi nếu đổi quy tắc này).
function laAdmin(vaiTro) {
  return vaiTro === 'admin' || vaiTro === 'superadmin';
}

// Phân biệt superadmin RIÊNG với admin (bổ sung 18/09/2026, theo yêu cầu người dùng) — dùng cho thông
// tin Xưởng của đơn hàng, nơi CHỈ superadmin được thấy/thao tác, admin KHÔNG (khác laAdmin() ở trên).
function laSuperAdmin(vaiTro) {
  return vaiTro === 'superadmin';
}

// Màu nền thẻ đơn theo Xưởng (bổ sung 23/09/2026, theo yêu cầu người dùng) — dùng chung bởi orders.html/
// my-orders.html/my-orders-ve-file.html, mỗi trang tự gọi 1 lần lúc vào trang rồi truyền kết quả vào
// lopVaStyleXuong() khi render từng thẻ. Rỗng/lỗi mạng → {} (an toàn, mọi thẻ về lại nền mặc định, y hệt
// hành vi "chưa cấu hình màu" — không chặn hiển thị danh sách chỉ vì lỗi tải màu).
async function taiMauTheoXuong() {
  try { return await apiFetch('/orders/mau-xuong'); } catch (e) { return {}; }
}
// o.XUONG rỗng/undefined (admin bị ẩn giá trị này, hoặc đơn/Xưởng chưa được gán màu) → không có class/
// style gì, giữ nguyên nền mặc định — đúng hành vi 2 màu hard-code cũ trước khi có tính năng này.
// Tiêu đề thẻ đơn 2 dòng (28/09/2026, theo yêu cầu người dùng — trước đây 1 dòng "Mã · Loại · Size · Màu" bị cắt "…"
// mất Size/Màu khi Loại dài): dòng 1 "Mã đơn · Loại" (vẫn 1 dòng, cắt "…"), dòng 2 "Size · Màu" in đậm, luôn hiện đủ.
// Dùng ở orders.html, my-orders.html, my-orders-ve-file.html.
function htmlTieuDeThe(o) {
  const ghep = (...ds) => ds.map(v => String(v ?? '').trim()).filter(Boolean).join(' · '); // ô chỉ có dấu cách = trống
  const dong1 = ghep(o.STT_Key, o.LOAI) || o.MA_DON_HANG_ORDERID || '';
  const dong2 = ghep(o.KICH_THUOC, o.MAU_SAC);
  return `<strong class="tieu-de-the ${o.DonUuTien ? 'uu-tien' : ''}">${escapeHtml(dong1)}</strong>` +
    (dong2 ? `<strong class="size-mau-the">${escapeHtml(dong2)}</strong>` : '');
}

// Nhãn đơn "HOLD-Chờ xác nhận" (05/10/2026, theo yêu cầu người dùng) — cờ DonHold do server tính (services/orderService.js
// #laDonHold, gắn ở routes/orders.js lamGiauDon, cùng chỗ DonUuTien). Vòng đỏ quanh thẻ/đầu trang chi tiết: style.css .vong-hold.
// Mở rộng 07/10/2026: cả CANCELLED / REFUNDED theo TINH_TRANG (cờ TinhTrangDacBiet do server tính) — nhãn ghi NGUYÊN VĂN giá trị
// TINH_TRANG trong Sheet (không phải trạng thái sản xuất CANCELLED_Đã hủy/REFUNDED_Hoàn đơn — 2 khái niệm độc lập).
// 21 ngày (07/10/2026): nhãn theo TinhTrangNhan (vẫn hiện sau khi hết hạn cảnh báo); còn hạn (TinhTrangDacBiet) -> đỏ, hết hạn -> vàng nhạt.
function nhanHold(o) {
  if (!o.TinhTrangNhan) return '';
  const chu = o.TinhTrangNhan === 'HOLD' ? 'HOLD-Chờ xác nhận' : String(o.TINH_TRANG || o.TinhTrangNhan).trim();
  const conHan = !!o.TinhTrangDacBiet;
  return `<span class="badge ${conHan ? 'trang-thai-danger' : 'trang-thai-warning'}" title="TINH_TRANG (khách cập nhật trên Sheet)${conHan ? '' : ' — đã hết 21 ngày cảnh báo'}">${icon('alert', { size: 14 })} ${escapeHtml(chu)}</span>`;
}

function lopVaStyleXuong(xuong, mauTheoXuong) {
  const mau = mauTheoXuong && mauTheoXuong[xuong];
  return mau ? { lop: 'co-mau-xuong', style: `--mau-xuong:${escapeHtml(mau)}` } : { lop: '', style: '' };
}

function trangChuTheoVaiTro(vaiTro) {
  if (vaiTro === 'nguoi_lay_phoi') return '/scan.html';
  if (vaiTro === 'san_xuat') return '/my-orders.html';
  // Đơn hàng là trang mặc định sau đăng nhập cho MỌI vai trò còn lại (bổ sung 21/09/2026, theo yêu cầu
  // người dùng) — kể cả admin/superadmin, THAY cho Trung tâm hành động trước đó (vẫn còn ở menu, chỉ
  // không phải trang vào đầu tiên nữa).
  return '/orders.html';
}

function renderNav(user, active) {
  let links;
  if (user.vaiTro === 'nguoi_lay_phoi') {
    // Thu hẹp xuống ĐÚNG 1 menu (bổ sung 23/09/2026, theo yêu cầu người dùng — bỏ nốt "SL Phôi", trước
    // đó là ngoại lệ duy nhất). CHỈ ẩn menu điều hướng, KHÔNG khoá route backend (routes/taiSan.js không
    // có requireRole riêng) — đúng quy ước đã áp dụng nhất quán trong hàm này.
    links = [
      { href: '/scan.html', label: 'Quét QR', icon: 'navScan', key: 'scan' },
    ];
  } else if (user.vaiTro === 'san_xuat') {
    // Thu hẹp xuống ĐÚNG 2 menu (bổ sung 23/09/2026, theo yêu cầu người dùng — bỏ nốt "Đơn hàng"/"Lịch
    // sử"). CHỈ ẩn menu điều hướng, KHÔNG khoá route backend (cùng quy ước như trên).
    links = [
      { href: '/my-orders.html', label: 'Chạy máy', icon: 'navMyOrders', key: 'my-orders' },
      { href: '/scan.html', label: 'Quét QR', icon: 'navScan', key: 'scan' },
    ];
  } else if (user.vaiTro === 've_file') {
    // Nhánh riêng cho ve_file (bổ sung 23/09/2026, theo yêu cầu người dùng) — trước đây dùng chung
    // nhánh else bên dưới với admin/superadmin (chèn thêm Vẽ file/Đơn hàng loạt/Tracking vào bộ menu
    // admin), giờ tách hẳn ra vì chỉ còn ĐÚNG 4 menu, không còn "thừa hưởng" gì từ nhánh admin nữa
    // (bỏ Đơn hàng loạt/TK/SL Phôi/Báo cáo/Lịch sử). CHỈ ẩn menu điều hướng, KHÔNG khoá route backend.
    links = [
      { href: '/orders.html', label: 'Đơn hàng', icon: 'navOrders', key: 'orders' },
      { href: '/my-orders-ve-file.html', label: 'Vẽ file', icon: 'navMyOrders', key: 'my-orders-ve-file' },
      { href: '/scan.html', label: 'Quét QR', icon: 'navScan', key: 'scan' },
      { href: '/tracking.html', label: 'Tracking', icon: 'navTracking', key: 'tracking' },
      // "Tìm ảnh" (03/10/2026, giai đoạn 2) — tìm thiết kế cũ + tải PNG/EMB lên thư viện.
      { href: '/tim-anh.html', label: 'Tìm ảnh', icon: 'camera', key: 'tim-anh' },
    ];
  } else {
    // Chỉ còn admin/superadmin đi qua nhánh này (nguoi_lay_phoi/san_xuat/ve_file đã tách nhánh riêng ở
    // trên, bổ sung 23/09/2026).
    links = [
      { href: '/orders.html', label: 'Đơn hàng', icon: 'navOrders', key: 'orders' },
      { href: '/scan.html', label: 'Quét QR', icon: 'navScan', key: 'scan' },
      { href: '/dashboard.html', label: 'TK', icon: 'navChart', key: 'dashboard' },
      { href: '/tai-san.html', label: 'SL Phôi', icon: 'navAssets', key: 'tai-san' },
      { href: '/reports.html', label: 'Báo cáo', icon: 'navReports', key: 'reports' },
    ];
    // "Đơn của tôi" (bổ sung 31/08/2026) — CHỈ admin còn dùng nhánh này (san_xuat có nhánh riêng ở
    // trên từ 08/09/2026). Admin xem nhanh mọi đơn đang "Đang chạy máy" — routes/orders.js
    // (locDonDangChayMayTheoNguoiVanHanh) chỉ lọc theo NguoiVanHanh cho san_xuat, admin xem được hết.
    // Đổi nhãn "Đơn của tôi · <tên>" → "Chạy máy" và "Đơn của tôi (Vẽ file) · <tên>" → "Vẽ file"
    // (bổ sung 09/09/2026, theo yêu cầu người dùng — áp dụng cho MỌI vai trò dùng nhãn này, kể cả
    // san_xuat/ve_file ở các nhánh khác trong hàm, không chỉ riêng admin) — bỏ hẳn phần ghép tên
    // (+ escapeHtml(user.ten)) vì tên không còn xuất hiện trong nhãn nữa.
    if (laAdmin(user.vaiTro)) {
      // "Bảng điều khiển" (bổ sung 08/09/2026, xem
      // docs/superpowers/specs/2026-09-08-bang-dieu-khien-admin-design.md) — CHỈ admin, lên ĐẦU TIÊN
      // (khác "Thống kê" vẫn mở cho cả ve_file) vì là màn hình tổng quan nhanh, hợp lý để thấy ngay.
      links.splice(0, 0, { href: '/bang-dieu-khien.html', label: 'BĐK', icon: 'navChart', key: 'bang-dieu-khien' });
      // "Trung tâm hành động" (bổ sung 14/09/2026, xem
      // docs/superpowers/specs/2026-09-14-trung-tam-hanh-dong-design.md) — CHỈ admin, giờ là trang
      // CHÍNH sau đăng nhập (xem trangChuTheoVaiTro ở trên) nên đứng TRƯỚC cả BĐK trong nav.
      links.splice(0, 0, { href: '/trung-tam-hanh-dong.html', label: 'Cần xử lý', icon: 'navAlert', key: 'trung-tam-hanh-dong' });
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
      // "Tìm ảnh" (03/10/2026) — thư viện thiết kế thêu PNG/EMB (docs/superpowers/specs/2026-10-03-thu-vien-tim-anh-design.md);
      // ve_file có mục riêng ở nhánh ve_file phía trên.
      links.push({ href: '/tim-anh.html', label: 'Tìm ảnh', icon: 'camera', key: 'tim-anh' });
      // "Kịch bản quét" (bổ sung 19/09/2026, theo yêu cầu người dùng — trang quản lý mới thay cho sửa
      // tay tab Sheet CauHinhKichBan cũ, xem routes/kichBan.js). Ảnh hưởng toàn bộ luồng quét QR hệ thống —
      // CHỈ superadmin từ 29/09/2026 (ẩn với admin theo yêu cầu người dùng; trang + API cũng chặn admin).
      if (user.vaiTro === 'superadmin') links.push({ href: '/kich-ban.html', label: 'Kịch bản quét', icon: 'navScan', key: 'kich-ban' });
    }
    // "Nhân viên" (bổ sung 18/09/2026, theo yêu cầu người dùng) — thu hẹp từ admin+superadmin xuống
    // CHỈ superadmin — KHÁC mọi nhánh khác trong hàm này (đều dùng laAdmin(), coi admin/superadmin
    // ngang quyền). admin không còn thấy menu này nữa, dù vẫn thấy mọi menu khác như trước.
    if (user.vaiTro === 'superadmin') {
      // "Trợ lý" ẨN khỏi menu (bổ sung 23/09/2026, theo yêu cầu người dùng — chưa dùng tới tính năng
      // này) — CHỈ ẩn nav, route /chatbot.html + API vẫn hoạt động bình thường nếu gõ thẳng URL, dễ bật
      // lại sau (đúng quy ước "ẩn menu, không khoá route" đã áp dụng nhất quán trong hàm này).
      // "QC" (bổ sung 30/09/2026, theo yêu cầu người dùng) — AI QC bằng Gemini, CHỈ superadmin (routes/qc.js cũng chặn).
      links.push({ href: '/qc.html', label: 'QC', icon: 'navReports', key: 'qc' });
      // "Notes" (bổ sung 02/10/2026, theo yêu cầu người dùng) — ghi chép kinh nghiệm, CHỈ superadmin (routes/notes.js cũng chặn).
      links.push({ href: '/notes.html', label: 'Notes', icon: 'file', key: 'notes' });
      links.push({ href: '/users.html', label: 'Nhân viên', icon: 'navUsers', key: 'users' });
      // "Logs" (bổ sung 23/09/2026, theo yêu cầu người dùng) — xem log console server, CHỈ superadmin
      // (cùng mức nhạy cảm với Nhân viên/Setting) — xem routes/logs.js + public/logs.html.
      links.push({ href: '/logs.html', label: 'Logs', icon: 'navLogs', key: 'logs' });
    }
    links.push({ href: '/hoat-dong.html', label: 'Lịch sử', icon: 'navActivity', key: 'hoat-dong' });
    // Setting (thu hẹp từ admin/ve_file/superadmin xuống CHỈ superadmin, bổ sung 23/09/2026, theo yêu
    // cầu người dùng — Settings giờ có thêm Cảnh báo tự động/Tỷ lệ nén ảnh, ảnh hưởng toàn hệ thống,
    // không còn chỉ là cài đặt giao diện cá nhân như trước). Chặn thật nằm ở settings.html (giống
    // users.html) + các route API — dòng dưới chỉ ẩn menu, không phải lớp bảo vệ.
    if (user.vaiTro === 'superadmin') {
      links.push({ href: '/settings.html', label: 'Setting', icon: 'navSettings', key: 'settings' });
    }
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
  // Y20: máy tính có chữ "Báo lỗi"; header điện thoại (.app-header) CHỈ icon — hàng tên + vai trò + Thoát đã gần kín bề ngang.
  const noiDungNguoiDung = coChuBaoLoi => `
    <span class="nav-user">${escapeHtml(user.ten)} · ${escapeHtml(NHAN_VAI_TRO[user.vaiTro] || user.vaiTro)}</span>
    <button class="icon-btn ${coChuBaoLoi ? 'icon-btn-nhan' : ''}" onclick="moBaoLoi()" title="Báo lỗi app" aria-label="Báo lỗi app">${icon('alert')}${coChuBaoLoi ? '<span>Báo lỗi</span>' : ''}</button>
    <button class="icon-btn icon-btn-nhan" onclick="dangXuat()">${icon('logout')}<span>Thoát</span></button>`;
  nav.innerHTML = `
    <header class="app-header">
      <a href="${trangChu}" class="brand">${icon('logo', { size: 26 })}<span>Xưởng Thêu</span></a>
      <div class="header-right">${noiDungNguoiDung(false)}</div>
    </header>
    <nav class="tab-links" aria-label="Điều hướng chính">
      <div class="tab-links-menu">
        ${links.map(l => `
          <a href="${l.href}" class="${l.key === active ? 'active' : ''}">
            <span class="nav-icon-tile">${icon(l.icon, { size: 20 })}</span><span>${l.label}</span>
          </a>`).join('')}
      </div>
      <div class="header-right tab-links-user">${noiDungNguoiDung(true)}</div>
    </nav>`;
  // Header điện thoại (11/10/2026): tên + vai trò dài thì cắt bằng "…" thay vì đẩy nút Báo lỗi/Thoát ra ngoài màn hình (trước đó
  // .nav-user không xuống dòng nên tên dài làm cả trang bị cuộn ngang). Đặt thẳng style — không đụng style.css dùng chung.
  const phaiHeader = nav.querySelector('.app-header .header-right');
  phaiHeader.style.minWidth = '0';
  Object.assign(phaiHeader.querySelector('.nav-user').style, { minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis' });
  nav.querySelector('.app-header .brand').style.flexShrink = '0';
  phaiHeader.querySelectorAll('button').forEach(b => { b.style.flexShrink = '0'; });
  canChoTenHeader();
  // Đo lại khi font Noto Sans (font-display: swap) tải xong và khi đổi cỡ/xoay màn hình — đăng ký 1 lần dù renderNav gọi nhiều lần.
  if (!window._daNgheCanChoTen) {
    window._daNgheCanChoTen = true;
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(canChoTenHeader);
    let hen;
    addEventListener('resize', () => { clearTimeout(hen); hen = setTimeout(canChoTenHeader, 150); });
  }
}
// Tên vẫn bị cắt -> ẩn chữ "Xưởng Thêu" cạnh logo (chỉ trang trí) để nhường chỗ cho tên — dùng chung máy vẫn biết ai đang đăng nhập.
// Hiện lại chữ trước rồi mới đo (màn rộng ra thì chữ quay lại). Máy tính .app-header ẩn (đo ra 0) nên không ẩn gì.
function canChoTenHeader() {
  const chuBrand = document.querySelector('#nav .app-header .brand > span');
  const ten = document.querySelector('#nav .app-header .nav-user');
  if (!chuBrand || !ten) return;
  chuBrand.style.display = '';
  if (ten.scrollWidth > ten.clientWidth) chuBrand.style.display = 'none';
}

// G1 (10/10/2026, theo yêu cầu người dùng): nhớ bộ lọc, sắp xếp, số thẻ đã "Xem thêm" và vị trí cuộn của 1 trang danh sách — RIÊNG
// từng tab (sessionStorage: 2 tab lọc khác nhau không đè nhau, tab mới = trống). Ghi lúc rời trang (pagehide — bấm vào chi tiết đơn,
// bấm menu, tải lại), nên "Xoá lọc" rồi rời trang thì lần sau cũng trống. Ô <select> có lựa chọn đổ theo dữ liệu (cacOChonDong) lưu
// KÈM danh sách lựa chọn: các trang chỉ đổ lại những ô này khi KHÔNG lọc gì, không lưu thì giá trị khôi phục không có lựa chọn để chọn.
// Không nhớ đơn đang tích chọn (người dùng chốt — tránh in/chuyển nhầm đơn chọn từ trước).
function nhoDanhSach(khoa, { cacO, cacOChonDong = [], laySo }) {
  const k = 'nhoDanhSach:' + khoa;
  let daLuu = null;
  try { daLuu = JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { /* bị chặn/hỏng -> như chưa lưu */ }
  try { if (daLuu) history.scrollRestoration = 'manual'; } catch (e) { /* trình duyệt cũ */ }
  const o = id => document.getElementById(id);
  addEventListener('pagehide', () => {
    try {
      sessionStorage.setItem(k, JSON.stringify({
        giaTri: Object.fromEntries(cacO.filter(o).map(id => [id, o(id).type === 'checkbox' ? o(id).checked : o(id).value])),
        luaChon: Object.fromEntries(cacOChonDong.filter(o).map(id => [id, [...o(id).options].map(x => [x.value, x.text])])),
        so: laySo(), cuon: scrollY,
      }));
    } catch (e) { /* bỏ qua */ }
  });
  return {
    // Gọi TRƯỚC lượt tải đầu (sau khi trang đã đổ các ô chọn cố định như Xưởng).
    khoiPhucO() {
      if (!daLuu) return;
      for (const [id, ds] of Object.entries(daLuu.luaChon || {})) {
        if (o(id)) o(id).innerHTML = ds.map(([v, t]) => `<option value="${escapeHtml(v)}">${escapeHtml(t)}</option>`).join('');
      }
      for (const [id, v] of Object.entries(daLuu.giaTri || {})) {
        if (!o(id)) continue;
        if (o(id).type === 'checkbox') o(id).checked = !!v; else o(id).value = v;
      }
    },
    // Gọi SAU lượt tải đầu: datSo(soDaLuu) mở lại đủ số thẻ, rồi cuộn về chỗ cũ. Chỉ chạy 1 lần.
    khoiPhucCuon(datSo) {
      if (!daLuu) return;
      const { so, cuon } = daLuu;
      daLuu = null;
      if (so) datSo(so);
      scrollTo(0, cuon || 0); // gọi ngay: datSo đã vẽ xong (đồng bộ), trình duyệt tự tính bố cục khi cuộn
    },
  };
}

// Link từ dữ liệu (Sheet Seller do seller nhập) đặt vào href (11/10/2026): CHỈ http(s) hoặc đường dẫn nội bộ "/..." — chặn
// `javascript:`/`data:`... (escapeHtml không chặn được, bấm vào là chạy mã trong phiên đăng nhập của nhân viên). Không hợp lệ -> ''.
function urlAnToan(u) {
  const s = String(u || '').trim();
  return /^https?:\/\//i.test(s) || /^\/(?!\/)/.test(s) ? s : '';
}
// <a> mở tab mới tới url (đã qua urlAnToan); url không hợp lệ -> chữ thường kèm gợi ý, KHÔNG bấm được. noiDung là HTML đã an toàn.
function linkAnToan(url, noiDung) {
  const an = urlAnToan(url);
  return an ? `<a href="${escapeHtml(an)}" target="_blank" rel="noopener">${noiDung}</a>`
    : `<span title="Link không hợp lệ (chỉ nhận link http/https)" style="color:var(--color-text-muted)">${noiDung} (link không hợp lệ)</span>`;
}

// A1 (11/10/2026): nhãn "Có EMB sẵn" — g = { sttKey, embId, nhom, phanTramAnh, phanTramHinhDang } từ POST /thu-vien/tom-tat-don.
// Điểm hiển thị đúng điểm đo (chỉ đổi dấu chấm thành phẩy). "So sánh" mở Tìm ảnh tra theo đơn đang vẽ.
function htmlGoiYEmb(sttKeyDangVe, g) {
  if (!g) return '';
  const pct = v => String(v).replace('.', ',') + '%';
  const muc = g.nhom === 'TRUNG_FILE' ? 'Trùng file' : g.nhom === 'ANH_GIONG' ? `Ảnh ${pct(g.phanTramAnh)}` : `Hình dạng ${pct(g.phanTramHinhDang)}`;
  return `<div class="badge-row" style="align-items:center" onclick="event.stopPropagation()">
    <span class="badge trang-thai-success" style="white-space:normal;height:auto;text-align:left">${icon('check', { size: 14 })} Có EMB sẵn: đơn ${escapeHtml(g.sttKey)} · ${escapeHtml(muc)}</span>
    <a href="/tim-anh.html?stt=${encodeURIComponent(sttKeyDangVe)}" target="_blank" rel="noopener">So sánh</a>
    <a href="/api/thu-vien/file/${Number(g.embId)}?tai=1">Tải EMB</a>
  </div>`;
}
// Gọi sau khi vẽ thẻ: lấy gợi ý cho các thẻ đang hiện, chèn vào .thong-tin của từng thẻ (thuocTinh = tên data-attribute mang mã).
async function chenGoiYEmbVaoThe(khung, thuocTinh) {
  const cacThe = [...khung.querySelectorAll(`[${thuocTinh}]`)];
  if (!cacThe.length) return;
  const keys = cacThe.map(t => t.getAttribute(thuocTinh));
  const kq = {};
  for (let i = 0; i < keys.length; i += 500) { // API nhận tối đa 500 mã/lần; lô lỗi thì bỏ riêng lô đó, các lô khác vẫn hiện
    try { Object.assign(kq, await apiFetch('/thu-vien/tom-tat-don', { method: 'POST', body: JSON.stringify({ keys: keys.slice(i, i + 500) }) })); } catch (e) { /* bỏ lô này */ }
  }
  for (const the of cacThe) {
    const k = the.getAttribute(thuocTinh);
    const noi = the.querySelector('.thong-tin');
    if (!kq[k] || !noi || !the.isConnected) continue;
    noi.querySelector('.goi-y-emb')?.remove();
    noi.insertAdjacentHTML('beforeend', `<div class="goi-y-emb">${htmlGoiYEmb(k, kq[k].goiY)}</div>`);
  }
}

// Y6 (11/10/2026): nhãn "Đã nhận X giờ" trên thẻ đơn đang vẽ/đang chạy (n = o.NhanLau.VE_FILE | CHAY_MAY) — cam khi quá ngưỡng.
function nhanDaNhan(n) {
  if (!n) return '';
  const chu = n.soGio === null ? 'Không rõ lúc nhận' : `Đã nhận ${Math.floor(n.soGio)} giờ`;
  return `<span class="badge ${n.quaHan ? 'trang-thai-warning' : 'trang-thai-info'}" title="${n.quaHan ? `Quá ${n.nguongGio} giờ` : ''}">${icon('navActivity', { size: 14 })} ${chu}</span>`;
}
// Dòng nhắc đầu mục cho CHÍNH người nhận: "Bạn có 2 đơn đang vẽ quá 24 giờ" (chèn đầu lưới thẻ).
function htmlNhacNhanLau(ds, loai, viec, tenToi) {
  const qua = ds.filter(o => o.NhanLau && o.NhanLau[loai] && o.NhanLau[loai].quaHan && o.NhanLau[loai].nguoi === tenToi);
  if (!qua.length) return '';
  return `<div style="grid-column:1/-1;padding:8px 12px;border-radius:var(--radius-md);background:var(--color-warning-bg);color:var(--color-warning-text);font-weight:700">
    ${icon('alert', { size: 16 })} Bạn có ${qua.length} đơn đang ${viec} quá ${qua[0].NhanLau[loai].nguongGio} giờ — làm tiếp hoặc báo quản lý để chuyển người khác.</div>`;
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

// Lịch sử (bổ sung 27/09/2026): danh sách "Nhãn: trước → sau" từ ThayDoi do server dựng (services/moTaLichSu.js).
// tu === null = log cũ không lưu giá trị trước -> chỉ hiện giá trị sau, không suy đoán.
function htmlThayDoiLichSu(thayDoi) {
  if (!thayDoi || !thayDoi.length) return '';
  return `<ul class="lich-su-thay-doi">${thayDoi.map(t =>
    `<li>${escapeHtml(t.nhan)}: ${t.tu !== null ? `${escapeHtml(t.tu)} → ` : ''}<strong>${escapeHtml(t.sang)}</strong></li>`).join('')}</ul>`;
}

// Đơn đã huỷ KHÔNG được mua tracking (bổ sung 27/09/2026, theo yêu cầu người dùng) — hộp đỏ lớn phủ
// màn hình, chỉ tắt khi bấm "Đã hiểu" (Promise xong lúc đó). Server trả lỗi maLoi 'DON_DA_HUY' ở
// /tracking/mua-thu-cong và /tracking/mua-va-in-label (services/trackingAutoService.js#chanMuaDonDaHuy).
const TRANG_THAI_DON_DA_HUY = 'CANCELLED_Đã hủy';
function hienThongBaoDonDaHuy(dsStt) {
  return hienHopDo({
    tieuDe: ['ĐƠN ĐÃ HỦY', '(KHÔNG MUA TRACKING)'],
    moTa: `${dsStt.length > 1 ? dsStt.length + ' đơn dưới đây đang' : 'Đơn này đang'} ở trạng thái "${TRANG_THAI_DON_DA_HUY}" nên hệ thống không mua tracking:`,
    ma: dsStt,
  });
}

// Hộp đỏ lớn dùng chung (28/09/2026) — tieuDe: các dòng tiêu đề; moTa: 1 câu; ma: mã đơn (in đậm đỏ);
// danhSach: các dòng chi tiết (vd "9LIEM12: lý do"). Chỉ tắt khi bấm "Đã hiểu"; Promise xong lúc đó.
function hienHopDo({ tieuDe = [], moTa = '', ma = [], danhSach = [] }) {
  return new Promise(xong => {
    const nen = document.createElement('div');
    nen.className = 'hop-don-da-huy';
    nen.setAttribute('role', 'alertdialog');
    nen.setAttribute('aria-modal', 'true');
    nen.innerHTML = `
      <div class="hop-don-da-huy__khung">
        <div class="hop-don-da-huy__tieu-de">${icon('alert', { size: 44 })}${tieuDe.map(t => `<div>${escapeHtml(t)}</div>`).join('')}</div>
        <div class="hop-don-da-huy__noi-dung">
          ${moTa ? `<p>${escapeHtml(moTa)}</p>` : ''}
          ${ma.length ? `<p class="hop-don-da-huy__ma">${ma.map(escapeHtml).join(', ')}</p>` : ''}
          ${danhSach.length ? `<ul class="hop-don-da-huy__ds">${danhSach.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` : ''}
          <button type="button" class="btn-hanh-dong">Đã hiểu</button>
        </div>
      </div>`;
    nen.querySelector('button').onclick = () => { nen.remove(); xong(); };
    document.body.appendChild(nen);
    nen.querySelector('button').focus();
  });
}

// Danh sách "Chưa ghi được sang Sheet Seller" (28/09/2026) — dùng CHUNG ở Trung tâm hành động và Settings.
// ds: từ /api/dong-bo-sheet-seller/loi-dang-cho (hoặc Trung tâm hành động .loiSheetSeller). choDayLai: chỉ
// superadmin (server cũng chặn). Sau khi đẩy lại, gọi taiLai() do trang truyền vào để vẽ lại.
const NHAN_LOAI_SHEET_SELLER = { GHI_CHU: 'Ghi chú xưởng', TRACKING: 'Tracking', DELIVERED: 'Delivered', SO_MUI: 'Số mũi chỉ' };
const tgNgan = iso => { const d = new Date(iso); return isNaN(d) ? String(iso || '') : d.toLocaleString('vi-VN'); };
function htmlLoiSheetSeller(ds, choDayLai) {
  if (!ds || !ds.length) return '<p style="color:var(--color-text-muted)">Không có lần ghi nào sang Sheet Seller đang lỗi.</p>';
  return `${choDayLai ? `<button type="button" class="btn-hanh-dong" onclick="dayLaiSheetSeller(null, this)">Đẩy lại tất cả (${ds.length})</button>` : ''}
    <div class="bang-cuon-ngang"><table class="info-table">
      <tr><th>Đơn</th><th>Loại</th><th>Nơi ghi</th><th>Giá trị định ghi</th><th>Lý do</th><th>Lần lỗi gần nhất</th>${choDayLai ? '<th></th>' : ''}</tr>
      ${ds.map(d => `<tr>
        <td><a href="/order.html?stt=${encodeURIComponent(d.STT_Key)}">${escapeHtml(d.STT_Key)}</a></td>
        <td>${escapeHtml(NHAN_LOAI_SHEET_SELLER[d.Loai] || d.Loai)}</td>
        <td>${d.Tab ? `tab "${escapeHtml(d.Tab)}"${d.Dong ? ` dòng ${escapeHtml(d.Dong)}` : ''}<br><small>${escapeHtml(d.SpreadsheetId)}</small>` : '—'}</td>
        <td>${escapeHtml(d.Cot)}: <strong>${escapeHtml(d.GiaTriSau)}</strong></td>
        <td style="color:var(--color-danger-text)">${escapeHtml(d.LyDo)}</td>
        <td>${escapeHtml(tgNgan(d.ThoiGian))}<br><small>${d.SoLanLoi} lần lỗi · ${escapeHtml(d.NguoiDung)}</small></td>
        ${choDayLai ? `<td><button type="button" class="btn-hanh-dong phu" data-stt="${escapeHtml(d.STT_Key)}" data-loai="${escapeHtml(d.Loai)}"
          onclick="dayLaiSheetSeller([{ sttKey: this.dataset.stt, loai: this.dataset.loai }], this)">Đẩy lại</button></td>` : ''}
      </tr>`).join('')}
    </table></div>`;
}
let _taiLaiSauDayLai = null; // trang đăng ký hàm vẽ lại (datTaiLaiSauDayLai)
function datTaiLaiSauDayLai(fn) { _taiLaiSauDayLai = fn; }
// items: [{ sttKey, loai }] hoặc null = đẩy lại TẤT CẢ lỗi đang chờ. Đẩy lại dùng giá trị HIỆN TẠI trong app.
async function dayLaiSheetSeller(items, btn) {
  const nhan = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Đang đẩy...';
  try {
    const kq = await apiFetch('/dong-bo-sheet-seller/day-lai', { method: 'POST', body: JSON.stringify(items ? { items } : { tatCa: true }) });
    const loi = kq.ketQua.filter(k => !k.ok);
    const ok = kq.ketQua.length - loi.length;
    if (loi.length) {
      await hienHopDo({
        tieuDe: ['ĐẨY LẠI CHƯA THÀNH CÔNG'], moTa: `Thành công ${ok}/${kq.ketQua.length}. Còn lỗi:`,
        danhSach: loi.map(k => `${k.sttKey} (${NHAN_LOAI_SHEET_SELLER[k.loai] || k.loai}): ${k.lyDo}`),
      });
    } else {
      alert(`Đã ghi lại sang Sheet Seller thành công ${ok} mục.`);
    }
  } catch (e) {
    alert('Lỗi: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = nhan;
  if (_taiLaiSauDayLai) await _taiLaiSauDayLai();
}

// Lỗi ghi sang Sheet Seller trả về từ server (loiDaySheetKh: [{ sttKey, lyDo }]) -> hộp đỏ (28/09/2026).
// Đơn đã nằm trong danh sách theo dõi (Trung tâm hành động / Settings) — superadmin bấm Đẩy lại sau khi sửa nguyên nhân.
function baoLoiSheetSeller(loiDaySheetKh, tieuDe = ['ĐÃ MUA TRACKING', 'NHƯNG CHƯA GHI ĐƯỢC SANG SHEET SELLER']) {
  if (!loiDaySheetKh || !loiDaySheetKh.length) return Promise.resolve();
  return hienHopDo({
    tieuDe,
    moTa: 'Đơn đã được đưa vào danh sách "Chưa ghi được sang Sheet Seller" ở Trung tâm hành động và Settings — sửa nguyên nhân rồi bấm Đẩy lại (superadmin).',
    danhSach: loiDaySheetKh.map(l => `${l.sttKey}: ${l.lyDo}`),
  });
}
// Tách lỗi "đơn đã huỷ" khỏi loi[] server trả về: hiện hộp đỏ cho các đơn đó, trả lại các lỗi còn lại.
async function tachVaBaoDonDaHuy(loi) {
  const daHuy = (loi || []).filter(l => l.maLoi === 'DON_DA_HUY');
  if (daHuy.length) await hienThongBaoDonDaHuy(daHuy.map(l => l.sttKey));
  return (loi || []).filter(l => l.maLoi !== 'DON_DA_HUY');
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

// Nén/resize ảnh NGAY TRÊN TRÌNH DUYỆT trước khi upload (bổ sung 21/09/2026, theo yêu cầu người dùng)
// — dùng chung cho public/scan.html (chụp ảnh Đã sản xuất/Đã dán tem) VÀ public/order.html (nút tải
// ảnh đơn lẻ, cùng gọi POST /api/photos/upload). Ảnh chụp thẳng từ camera điện thoại thường 3-10MB,
// server KHÔNG tự nén gì trước khi lưu (xem services/storageService.js#uploadImageBuffer — lưu nguyên
// buffer nhận được), nên bước tải lên chiếm phần lớn thời gian chờ trên mạng xưởng/di động không mạnh.
// Vẽ lại ảnh nhỏ hơn qua canvas rồi encode lại JPEG chất lượng vừa đủ nhìn — đủ dùng để xác nhận/đối
// chiếu, không phải ảnh in ấn nên không cần giữ nguyên độ phân giải camera gốc.
// createImageBitmap({imageOrientation:'from-image'}) tự áp dụng ĐÚNG chiều xoay EXIF — ảnh chụp DỌC từ
// điện thoại luôn có cờ xoay trong EXIF, vẽ thẳng qua thẻ <img>/canvas mà không xử lý sẽ ra ảnh bị xoay
// sai hướng. Được hỗ trợ ổn định trên Chrome/Safari mobile hiện tại.
// KHÔNG BAO GIỜ chặn luồng nếu nén lỗi (định dạng lạ, trình duyệt cũ, ảnh hỏng, canvas.toBlob thất
// bại...) — luôn trả về ảnh GỐC trong mọi trường hợp lỗi, để 1 tối ưu tốc độ không biến thành 1 lỗi mới
// chặn hẳn việc tải ảnh lên (quan trọng hơn tốc độ).
const CANH_DAI_NHAT_TOI_DA_KHI_NEN_ANH = 1600; // px — đủ nét để xem/đối chiếu trên màn hình
const CHAT_LUONG_JPEG_KHI_NEN_ANH = 0.8;
const BO_QUA_NEN_NEU_DA_NHO_HON = 400 * 1024; // 400KB — ảnh đã nhỏ sẵn thì khỏi nén lại tốn công vô ích

// Lý do lần GẦN NHẤT nenAnhTruocKhiTaiLen() KHÔNG nén được (null = lần đó nén thành công bình thường) —
// bổ sung 23/09/2026, theo yêu cầu người dùng: phát hiện qua thực tế 1 máy tính bảng nén ra ĐÚNG bằng
// kích thước gốc (0 byte thay đổi) — nghi ngờ createImageBitmap() lỗi/không hỗ trợ trên thiết bị đó
// nhưng lỗi chỉ in ra console (không xem được trên máy tính bảng/điện thoại không có devtools). Giữ 1
// biến side-channel ĐƠN GIẢN thay vì đổi kiểu trả về của hàm (order.html đang gọi hàm này, không nên
// đổi hợp đồng cũ) — nơi gọi nào cần biết lý do thì tự đọc biến này NGAY SAU KHI await xong.
let lyDoKhongNenGanNhat = null;

// tuyChon (bổ sung 23/09/2026, theo yêu cầu người dùng — menu Thiết lập/Tỷ lệ nén ảnh, CHỈ áp dụng cho
// 2 chế độ chụp ảnh ở scan.html) — cho phép override 2 hằng số mặc định ở trên theo cấu hình superadmin
// đã lưu. order.html gọi hàm này KHÔNG truyền tham số thứ 2 → giữ nguyên hành vi cũ (2 hằng số mặc định).
async function nenAnhTruocKhiTaiLen(file, tuyChon = {}) {
  const canhDaiToiDa = tuyChon.canhDaiToiDa || CANH_DAI_NHAT_TOI_DA_KHI_NEN_ANH;
  const chatLuongJpeg = tuyChon.chatLuongJpeg || CHAT_LUONG_JPEG_KHI_NEN_ANH;
  lyDoKhongNenGanNhat = null;
  if (!file || !file.type || !file.type.startsWith('image/')) { lyDoKhongNenGanNhat = 'Không phải file ảnh'; return file; }
  if (file.size <= BO_QUA_NEN_NEU_DA_NHO_HON) { lyDoKhongNenGanNhat = 'Ảnh đã nhỏ sẵn (bỏ qua)'; return file; }
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const tyLe = Math.min(1, canhDaiToiDa / Math.max(bitmap.width, bitmap.height));
    const rong = Math.round(bitmap.width * tyLe);
    const cao = Math.round(bitmap.height * tyLe);

    const canvas = document.createElement('canvas');
    canvas.width = rong;
    canvas.height = cao;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, rong, cao);
    bitmap.close();

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', chatLuongJpeg));
    if (!blob) { lyDoKhongNenGanNhat = 'canvas.toBlob() trả về rỗng'; return file; }
    if (blob.size >= file.size) { lyDoKhongNenGanNhat = `Nén không hiệu quả (${(blob.size/1024).toFixed(0)}KB >= gốc)`; return file; }

    const tenFileMoi = String(file.name || 'anh').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], tenFileMoi, { type: 'image/jpeg' });
  } catch (e) {
    lyDoKhongNenGanNhat = 'Lỗi: ' + e.message;
    console.error('[Nén ảnh] Lỗi khi nén, dùng ảnh gốc:', e.message);
    return file;
  }
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
  // loiDaySheetKh (bổ sung 21/09/2026, theo yêu cầu người dùng) — POST /tracking/mua-thu-cong trả
  // thêm mảng này (đơn mua tracking THÀNH CÔNG nhưng ghi sang Sheet Seller thất bại, xem
  // routes/tracking.js) — gộp CHUNG CHUNG như thanhCong/loi để dùng lại được, không ảnh hưởng các nơi
  // gọi khác không có field này (mảng rỗng, vô hại).
  const loiDaySheetKh = [];
  let daHuy = false;

  for (let i = 0; i < danhSach.length; i++) {
    if (kiemTraHuy && kiemTraHuy()) { daHuy = true; break; }

    try {
      const kq = await xuLyMotPhanTu(danhSach[i]);
      if (kq && Array.isArray(kq.thanhCong)) thanhCong.push(...kq.thanhCong);
      if (kq && Array.isArray(kq.loi)) loi.push(...kq.loi);
      if (kq && Array.isArray(kq.loiDaySheetKh)) loiDaySheetKh.push(...kq.loiDaySheetKh);
    } catch (err) {
      loi.push({ sttKey: danhSach[i], lyDo: err.message });
    }

    if (onTienDo) onTienDo(i + 1, danhSach.length);
  }

  return { thanhCong, loi, loiDaySheetKh, daHuy };
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
// Nhãn DonNhieuAo (bổ sung 26/09/2026) — `n` là NhomNhieuAo do routes/orders.js#lamGiauDon gắn vào đơn
// (xem services/donNhieuAoService.js#tomTatChoDon). Đỏ khi nhóm có lỗi dữ liệu, xanh cho đơn mua
// tracking, vàng cho đơn dùng chung.
function nhanNhomNhieuAo(n) {
  if (!n) return '';
  const coLoi = n.loiChan.length + n.canhBao.length > 0;
  const chu = `Nhóm ${n.goc} · ${n.viTri}/${n.tong} · ${n.laDonMua ? 'MUA TRACKING' : 'Dùng chung ' + (n.donMua || '?')}`;
  const lop = coLoi ? 'trang-thai-danger' : n.laDonMua ? 'trang-thai-info' : 'trang-thai-warning';
  const goiY = [`OrderID ${n.orderId}`, ...n.loiChan, ...n.canhBao].join('\n');
  return `<span class="badge ${lop}" title="${escapeHtml(goiY)}">${icon('package', { size: 14 })} ${escapeHtml(chu)}${coLoi ? ' · LỖI' : ''}</span>`;
}

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
