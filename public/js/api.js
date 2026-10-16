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
  let res;
  try {
    res = await fetch(API + url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (e) {
    if (!(e && e.name === 'AbortError')) _baoLoiMangTuApi(); // lỗi mạng (không có mã HTTP) -> chấm báo mạng đo lại ngay
    throw e;
  }
  // 200 mà nội dung KHÔNG phải JSON (14/10/2026): wifi có trang đăng nhập chặn giữa / trang kiểm tra của Cloudflare trả HTML mã 200 —
  // trước đây thành {} và nơi gọi tưởng thành công (vd tải ảnh báo ✅ dù ảnh chưa tới máy chủ). Coi như lỗi mạng (không có status).
  let data;
  try { data = await res.json(); } catch (e) {
    if (res.ok) throw new Error('Máy chủ trả về dữ liệu không đọc được (mạng có thể đang bị chặn bởi trang đăng nhập wifi) — chưa lưu gì.');
    data = {};
  }
  if (!res.ok) {
    if (url !== '/bao-loi') _ghiVaoDs(_loiApiGanDay, { url: String(url).slice(0, 300), ma: res.status, loi: String(data.error || '').slice(0, 300) }, 10);
    // status + nghiepVu (máy chủ đánh dấu đơn không hợp lệ): nơi gọi phân biệt từ chối nghiệp vụ với lỗi kỹ thuật (Logs_UploadAnh)
    throw Object.assign(new Error(data.error || (res.status >= 500 ? `Máy chủ lỗi ${res.status}` : 'Có lỗi xảy ra')),
      { status: res.status, nghiepVu: !!data.nghiepVu, duLieu: data });
  }
  return data;
}

// ============================================================
// TỐC ĐỘ MẠNG TỚI MÁY CHỦ (16/10/2026, theo yêu cầu người dùng — mọi trang đã đăng nhập):
//  - Chấm trên thanh menu: trình duyệt gọi POST /api/ping (máy chủ trả ngay, không đọc Sheet/DB) mỗi 30 giây khi tab đang hiện, đo
//    thời gian khứ hồi. 🟢 < 300ms · 🟡 300ms–1s · 🔴 > 1s / mất kết nối. Bấm chấm -> khung chi tiết (độ trễ, loại mạng, tải ảnh lần trước).
//  - Dải cảnh báo đầu trang: mất kết nối (đỏ) / mạng yếu 3 lần đo liền > 1s (vàng, gợi ý dùng Wi-Fi xưởng). Hết lỗi thì tự ẩn.
//  - Lưu log chi tiết: mỗi lần đo được gửi kèm lượt ping KẾ TIẾP (không tốn thêm request); rời trang thì gửi nốt bằng sendBeacon.
//    Máy chủ lưu bảng do_mang (routes/doMang.js) -> báo cáo Telegram hằng ngày (dòng tóm tắt + file CSV chi tiết).
//  - Lượt gọi API thật lỗi MẠNG (không có mã HTTP) -> đo lại ngay để chấm đổi màu sớm (không chờ 30 giây).
// Loại mạng / Mbps chỉ Chrome Android báo; iPhone/iPad chỉ có độ trễ đo thật.
// ============================================================
const MANG = { CHU_KY_MS: 30000, HAN_MS: 10000, NGUONG_XANH: 300, NGUONG_VANG: 1000, SO_LAN_YEU_CANH_BAO: 3 };
const _mang = { daBat: false, dangDo: false, lanDoCuoi: 0, ganDay: [], hangDoi: [], soLanYeuLienTiep: 0, lanKetNoiDuocCuoi: 0, anhGanNhat: null, daAnDai: '' };
const thongTinMangTrinhDuyet = () => { const c = navigator.connection; return c ? { loai: c.effectiveType || '', mbps: c.downlink ?? null, rtt: c.rtt ?? null } : {}; };
const chuMs = ms => (ms == null ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1).replace('.', ',')}s`);
let _thietBiMangSan = null; // Promise thông tin thiết bị (layThietBiLog) — lấy 1 lần

function trangThaiMang() {
  const cuoi = _mang.ganDay[_mang.ganDay.length - 1];
  if (!cuoi) return { mau: 'xam', chu: '…', moTa: 'Đang đo…' };
  if (cuoi.ms == null) return { mau: 'do', chu: 'mất', moTa: `Mất kết nối tới máy chủ (${cuoi.loi || 'lỗi mạng'})` };
  if (cuoi.ms < MANG.NGUONG_XANH) return { mau: 'xanh', chu: chuMs(cuoi.ms), moTa: 'Mạng tốt' };
  if (cuoi.ms <= MANG.NGUONG_VANG) return { mau: 'vang', chu: chuMs(cuoi.ms), moTa: 'Mạng hơi chậm' };
  return { mau: 'do', chu: chuMs(cuoi.ms), moTa: 'Mạng rất chậm' };
}
const MAU_CHAM = { xanh: '#16a34a', vang: '#d97706', do: '#dc2626', xam: '#9ca3af' };

function capNhatHienThiMang() {
  const tt = trangThaiMang();
  document.querySelectorAll('.cham-mang').forEach(el => {
    el.querySelector('.cham-mang-cham').style.background = MAU_CHAM[tt.mau];
    const chu = el.querySelector('.cham-mang-chu');
    if (chu) chu.textContent = tt.chu;
    el.title = `Kết nối tới máy chủ: ${tt.moTa}${tt.chu !== 'mất' && tt.chu !== '…' ? ' — ' + tt.chu : ''}. Bấm để xem chi tiết.`;
  });
  // Dải cảnh báo: mất kết nối / mạng yếu kéo dài. Người dùng bấm × -> ẩn tới khi trạng thái đổi sang loại khác.
  const cuoi = _mang.ganDay[_mang.ganDay.length - 1];
  const loai = !cuoi ? '' : cuoi.ms == null ? 'mat' : _mang.soLanYeuLienTiep >= MANG.SO_LAN_YEU_CANH_BAO ? 'yeu' : '';
  if (loai !== _mang.daAnDai.split('|')[0]) _mang.daAnDai = '';
  let dai = document.getElementById('dai-canh-bao-mang');
  // Dải nằm cố định trên đầu -> đẩy nội dung trang xuống đúng bằng chiều cao dải (không che thanh menu), ẩn dải thì trả lại.
  const datDem = () => { document.body.style.paddingTop = dai && dai.isConnected ? `${dai.offsetTop + dai.offsetHeight}px` : ''; };
  if (!loai || _mang.daAnDai) { if (dai) { dai.remove(); datDem(); } }
  else {
    if (!dai) {
      dai = document.createElement('div');
      dai.id = 'dai-canh-bao-mang';
      dai.setAttribute('role', 'status');
      dai.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:1999;padding:8px 40px 8px 12px;font-weight:600;font-size:14px;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.15)';
      document.body.appendChild(dai);
    }
    const mat = loai === 'mat';
    const banMoi = document.getElementById('thanh-ban-moi'); // thanh "Có bản mới" (scan.html) cũng cố định trên đầu -> xếp dải mạng ngay dưới
    dai.style.top = banMoi ? `${banMoi.offsetHeight}px` : '0';
    dai.style.background = mat ? 'var(--color-danger-bg, #fee2e2)' : 'var(--color-warning-bg, #fef3c7)';
    dai.style.color = mat ? 'var(--color-danger-text, #991b1b)' : 'var(--color-warning-text, #92400e)';
    dai.innerHTML = (mat ? '📵 Mất kết nối tới máy chủ — kiểm tra Wi-Fi / 4G. Thao tác lúc này sẽ lỗi cho tới khi có mạng lại.'
      : `🐢 Mạng đang yếu (độ trễ ~${escapeHtml(chuMs(cuoi.ms))}) — nên kết nối Wi-Fi xưởng để thao tác nhanh hơn.`)
      + '<button type="button" aria-label="Ẩn" style="position:absolute;right:8px;top:4px;border:0;background:none;font-size:20px;cursor:pointer;color:inherit">×</button>';
    dai.querySelector('button').onclick = () => { _mang.daAnDai = loai + '|an'; dai.remove(); datDem(); };
    datDem();
  }
  if (document.getElementById('khung-chi-tiet-mang')) veKhungChiTietMang();
}

function veKhungChiTietMang() {
  const khung = document.getElementById('khung-chi-tiet-mang');
  if (!khung) return;
  const tt = trangThaiMang();
  const coSo = _mang.ganDay.filter(d => d.ms != null).map(d => d.ms);
  const tb = coSo.length ? Math.round(coSo.reduce((a, b) => a + b, 0) / coSo.length) : null;
  const tdt = thongTinMangTrinhDuyet();
  const a = _mang.anhGanNhat;
  const dong = [
    `<b style="color:${MAU_CHAM[tt.mau]}">● ${escapeHtml(tt.moTa)}</b>`,
    `Lần đo gần nhất: <b>${escapeHtml(chuMs((_mang.ganDay[_mang.ganDay.length - 1] || {}).ms))}</b>`,
    `Trung bình ${coSo.length} lần gần đây: ${escapeHtml(chuMs(tb))}`,
    tdt.loai ? `Loại mạng (trình duyệt báo): ${escapeHtml(tdt.loai)}${tdt.mbps != null ? ` · ~${escapeHtml(String(tdt.mbps))} Mbps` : ''}` : 'Loại mạng: máy này không cho biết',
    a ? `Ảnh tải gần nhất (${escapeHtml(new Date(a.luc).toTimeString().slice(0, 5))}): gửi ${escapeHtml(chuMs(a.msGui))} · ${a.kb}KB${a.kbps ? ` · ${a.kbps} KB/s` : ''}` : '',
    _mang.lanKetNoiDuocCuoi ? `Kết nối được lần cuối: ${escapeHtml(new Date(_mang.lanKetNoiDuocCuoi).toTimeString().slice(0, 8))}` : '',
    `<span style="color:var(--color-text-muted)">🟢 &lt; ${MANG.NGUONG_XANH}ms · 🟡 đến ${chuMs(MANG.NGUONG_VANG)} · 🔴 chậm hơn / mất mạng. Đo mỗi ${MANG.CHU_KY_MS / 1000} giây.</span>`,
  ].filter(Boolean);
  khung.innerHTML = dong.join('<br>') + '<div style="margin-top:8px;text-align:right"><button type="button" class="btn-hanh-dong phu" id="nut-do-mang-lai">Đo lại ngay</button></div>';
  khung.querySelector('#nut-do-mang-lai').onclick = e => { e.stopPropagation(); doMangMotLan(true); };
}
function moChiTietMang(ev) {
  ev.stopPropagation();
  let khung = document.getElementById('khung-chi-tiet-mang');
  if (khung) { khung.remove(); return; }
  khung = document.createElement('div');
  khung.id = 'khung-chi-tiet-mang';
  khung.style.cssText = 'position:fixed;top:56px;right:8px;z-index:2100;max-width:min(360px,calc(100vw - 16px));padding:12px;border-radius:10px;'
    + 'background:var(--color-surface,#fff);color:var(--color-text,#111);border:1px solid var(--color-border,#ddd);box-shadow:0 6px 20px rgba(0,0,0,.18);font-size:14px;line-height:1.6';
  khung.onclick = e => e.stopPropagation();
  document.body.appendChild(khung);
  veKhungChiTietMang();
  setTimeout(() => document.addEventListener('click', () => khung.remove(), { once: true }), 0);
}

// Trang Quét QR báo mỗi lần tải ảnh xong (msGui: phần gửi qua mạng, kb: dung lượng sau nén) — hiện trong khung chi tiết + dòng
// "Ảnh vừa tải" trên trang quét (phần tử #toc-do-anh-gan-nhat nếu trang có).
function baoTocDoTaiAnh({ msGui, kb, kbps }) {
  _mang.anhGanNhat = { luc: Date.now(), msGui, kb, kbps };
  const el = document.getElementById('toc-do-anh-gan-nhat');
  if (el) {
    el.style.display = '';
    el.textContent = `Ảnh vừa tải (${new Date().toTimeString().slice(0, 5)}): gửi ${chuMs(msGui)} · ${kb}KB${kbps ? ` · ${kbps} KB/s` : ''}`
      + (msGui > 10000 ? ' — chậm, nên kết nối Wi-Fi xưởng' : '');
  }
  veKhungChiTietMang();
}

// Gửi 1 lô số đo lên /api/ping, hạn 10 giây (AbortController + setTimeout — AbortSignal.timeout không có trên iOS < 16; treo mà không có
// hạn thì lượt gửi kẹt mãi). Dùng chung cho lượt đo và lượt gửi riêng hàng chờ. -> Response (ném lỗi mạng / quá hạn như fetch).
async function guiDoMang(ds) {
  const huy = new AbortController();
  const hen = setTimeout(() => huy.abort(), MANG.HAN_MS);
  try {
    return await fetch(API + '/ping', {
      method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thietBi: _mang.thietBi || {}, ds: ds.map(d => ({ ...d, cachMs: Date.now() - d.t, t: undefined })) }),
      signal: huy.signal,
    });
  } finally {
    clearTimeout(hen);
  }
}
// Mỗi lần đo ghi kèm TÊN người đang dùng trang (máy chủ chỉ lưu nếu khớp người của phiên gửi lên — máy dùng chung: số đo lúc Tú hết phiên
// không bị ghi sang tên Chang vừa đăng nhập ở tab khác).
function themSoDoMang(d) {
  _mang.hangDoi.push({ t: Date.now(), trang: location.pathname, nguoi: (window.__nguoiDung || {}).ten || '', ...d });
  if (_mang.hangDoi.length > 200) _mang.hangDoi.splice(0, _mang.hangDoi.length - 200);
}

// 1 lần đo. Gửi KÈM các lần đo trước còn chờ (log chi tiết); gửi lỗi thì giữ lại cho lần sau (tối đa 200 lần đo).
async function doMangMotLan(batBuoc = false) {
  if (_mang.dangDo || (document.hidden && !batBuoc)) return;
  _mang.dangDo = true;
  _mang.lanDoCuoi = Date.now();
  if (!_thietBiMangSan) _thietBiMangSan = layThietBiLog().catch(() => ({}));
  _mang.thietBi = await Promise.race([_thietBiMangSan, new Promise(r => setTimeout(() => r({}), 1500))]);
  // Lượt đo chỉ mang tối đa 5 lần đo trước (vài trăm byte) — sau khi mất mạng lâu, hàng chờ lớn được gửi RIÊNG sau lượt đo (guiHangDoiMang),
  // để thời gian đo không bị cộng thêm thời gian đẩy cả lô lên (số đo cao giả ngay lúc vừa có mạng lại).
  const goi = !_mang.dangGuiHangDoi && _mang.hangDoi.length <= 5 ? _mang.hangDoi.splice(0) : [];
  const tdt = thongTinMangTrinhDuyet();
  const t0 = performance.now();
  let ms = null, loi = '';
  try {
    const res = await guiDoMang(goi);
    ms = Math.round(performance.now() - t0);
    if (!res.ok && res.status >= 500) { loi = `máy chủ lỗi ${res.status}`; ms = null; }
    if (ms != null) _mang.lanKetNoiDuocCuoi = Date.now();
    // 401 (hết phiên): máy chủ KHÔNG lưu khi chưa đăng nhập -> giữ lại số đo, gửi khi đăng nhập lại (tối đa 200 lần đo); rời trang lúc
    // này thì cất vào localStorage thay vì sendBeacon (xem pagehide).
    _mang.hetPhien = res.status === 401;
    if (ms == null || _mang.hetPhien) _mang.hangDoi.unshift(...goi);
    else if (_mang.hangDoi.length) guiHangDoiMang();
  } catch (e) {
    loi = navigator.onLine === false ? 'không có mạng' : (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) ? `quá ${MANG.HAN_MS / 1000} giây` : 'lỗi mạng';
    _mang.hangDoi.unshift(...goi);
  }
  themSoDoMang({ ms, loi, loai: tdt.loai || '', mbps: tdt.mbps ?? null, rtt: tdt.rtt ?? null });
  _mang.ganDay.push({ ms, loi });
  if (_mang.ganDay.length > 10) _mang.ganDay.shift();
  _mang.soLanYeuLienTiep = ms != null && ms > MANG.NGUONG_VANG ? _mang.soLanYeuLienTiep + 1 : 0;
  _mang.dangDo = false;
  capNhatHienThiMang();
}

// Gửi riêng hàng chờ số đo lớn (sau khi mất mạng lâu) — KHÔNG tính thời gian. Mỗi lúc chỉ 1 lượt (lượt đo không lấy hàng chờ khi đang
// gửi); lỗi / hết phiên / quá hạn thì trả lại hàng chờ — số đo không bị "treo" ngoài hàng chờ.
async function guiHangDoiMang() {
  if (_mang.dangGuiHangDoi) return;
  const goi = _mang.hangDoi.splice(0, 100);
  if (!goi.length) return;
  _mang.dangGuiHangDoi = true;
  try {
    const res = await guiDoMang(goi);
    if (!res.ok) _mang.hangDoi.unshift(...goi);
  } catch (e) {
    _mang.hangDoi.unshift(...goi);
  } finally {
    _mang.dangGuiHangDoi = false;
  }
}

// Hết phiên rồi rời trang (vd sáng ra bấm thao tác -> bị chuyển sang trang đăng nhập): sendBeacon không biết máy chủ trả 401 -> số đo mất.
// Cất vào localStorage, đăng nhập lại (trang có menu kế tiếp) thì lấy ra gửi tiếp — CHỈ số đo của đúng người đó.
const KHOA_DO_MANG_CHO = 'doMangChoGui';
function catSoDoMangChoDangNhap() {
  try {
    const cu = JSON.parse(localStorage.getItem(KHOA_DO_MANG_CHO) || '[]');
    localStorage.setItem(KHOA_DO_MANG_CHO, JSON.stringify(cu.concat(_mang.hangDoi.splice(0)).slice(-200)));
  } catch (e) { /* bị chặn / đầy -> bỏ */ }
}
function layLaiSoDoMangDaCat() {
  try {
    const ds = JSON.parse(localStorage.getItem(KHOA_DO_MANG_CHO) || '[]');
    localStorage.removeItem(KHOA_DO_MANG_CHO);
    const ten = (window.__nguoiDung || {}).ten || '';
    _mang.hangDoi.unshift(...ds.filter(d => d && d.nguoi === ten).slice(-200));
  } catch (e) { /* hỏng -> bỏ */ }
}

function batDauDoMang() {
  if (_mang.daBat) { capNhatHienThiMang(); return; } // renderNav gọi lại -> chỉ vẽ lại chấm
  _mang.daBat = true;
  layLaiSoDoMangDaCat();
  doMangMotLan();
  setInterval(() => doMangMotLan(), MANG.CHU_KY_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - _mang.lanDoCuoi > 10000) doMangMotLan(); });
  addEventListener('online', () => doMangMotLan(true));
  addEventListener('offline', () => {
    _mang.ganDay.push({ ms: null, loi: 'không có mạng' });
    themSoDoMang({ ms: null, loi: 'không có mạng', ...thongTinMangTrinhDuyet() });
    capNhatHienThiMang();
  });
  // Rời trang: gửi nốt các lần đo chưa gửi (không đo thêm). Đang hết phiên / máy không có sendBeacon -> cất localStorage.
  addEventListener('pagehide', () => {
    if (!_mang.hangDoi.length) return;
    if (_mang.hetPhien || !navigator.sendBeacon) { catSoDoMangChoDangNhap(); return; }
    const ds = _mang.hangDoi.splice(0).map(d => ({ ...d, cachMs: Date.now() - d.t, t: undefined }));
    try { navigator.sendBeacon(API + '/ping', new Blob([JSON.stringify({ ds, thietBi: _mang.thietBi || {} })], { type: 'application/json' })); } catch (e) { /* bỏ */ }
  });
}
// Lượt gọi API thật lỗi mạng -> đo lại ngay (tối đa 1 lần / 5 giây).
function _baoLoiMangTuApi() {
  if (_mang.daBat && Date.now() - _mang.lanDoCuoi > 5000) doMangMotLan(true);
}

// Hệ điều hành / trình duyệt / đời máy (chuyển từ scan.html 16/10/2026 — dùng chung cho Logs_UploadAnh và log đo mạng mọi trang).
// User-Agent của Chrome Android đã bị "đóng băng" (Android 10; K) -> hỏi thêm Client Hints (chỉ Chrome/Edge/Samsung có). iPhone không
// cho biết đời máy; Safari iOS mới có thể không báo đúng số iOS.
async function layThietBiLog() {
  const ua = navigator.userAgent;
  const khop = (re, i = 1) => (ua.match(re) || [])[i] || '';
  let os = 'Khác', osVer = '', br = 'Khác', brVer = '', may = '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    os = /iPhone|iPod/.test(ua) ? 'iOS' : 'iPadOS';
    osVer = khop(/OS (\d+[_.]\d+)/).replace('_', '.') || khop(/Version\/(\d+(\.\d+)?)/);
  } else if (/Android/.test(ua)) { os = 'Android'; osVer = khop(/Android (\d+(\.\d+)?)/); may = khop(/Android [^;)]+; ([^;)]+?)(?: Build[^;)]*)?\)/); }
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux|CrOS/.test(ua)) os = 'Linux';
  const TRINH_DUYET = [[/EdgA?\/(\d+(\.\d+)?)/, 'Edge'], [/SamsungBrowser\/(\d+(\.\d+)?)/, 'Samsung Internet'], [/(?:OPR|OPT)\/(\d+(\.\d+)?)/, 'Opera'],
    [/Zalo[^\/]*\/(\d+(\.\d+)?)/i, 'Zalo'], [/FBAV\/(\d+(\.\d+)?)/, 'Facebook'], [/CriOS\/(\d+(\.\d+)?)/, 'Chrome'], [/FxiOS\/(\d+(\.\d+)?)/, 'Firefox'],
    [/Firefox\/(\d+(\.\d+)?)/, 'Firefox'], [/Chrome\/(\d+(\.\d+)?)/, 'Chrome'], [/Version\/(\d+(\.\d+)?).*Safari/, 'Safari']];
  for (const [re, ten] of TRINH_DUYET) { const m = ua.match(re); if (m) { br = ten; brVer = m[1]; break; } }
  try {
    const h = await navigator.userAgentData?.getHighEntropyValues?.(['platformVersion', 'model', 'fullVersionList']);
    if (h) {
      if (os === 'Android' && h.platformVersion) osVer = h.platformVersion.split('.').slice(0, 2).join('.');
      if (h.model) may = h.model;
      const b = (h.fullVersionList || []).find(x => !/Not|Chromium/i.test(x.brand));
      if (b && br === 'Chrome') brVer = b.version.split('.').slice(0, 2).join('.');
    }
  } catch (e) { /* trình duyệt không cho -> dùng User-Agent */ }
  if (may === 'K') may = '';
  return { os, osVer, br, brVer, may, ram: navigator.deviceMemory || null, cpu: navigator.hardwareConcurrency || null,
    manHinh: `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`,
    standalone: !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true };
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
  window.__nguoiDung = user; // để các hàm dùng chung biết vai trò người đang xem (vd nút "Bỏ qua" chỉ superadmin)

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
  // Chấm báo mạng (16/10/2026): điện thoại chỉ chấm (header chật), máy tính chấm + số ms. Bấm -> khung chi tiết.
  const chamMang = coChu => `<span class="cham-mang" role="button" tabindex="0" onclick="moChiTietMang(event)" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;flex-shrink:0;font-size:12px;padding:4px">`
    + `<span class="cham-mang-cham" style="width:10px;height:10px;border-radius:50%;background:#9ca3af;display:inline-block"></span>${coChu ? '<span class="cham-mang-chu">…</span>' : ''}</span>`;
  const noiDungNguoiDung = coChuBaoLoi => `
    ${chamMang(coChuBaoLoi)}
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
  batDauDoMang();
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
    <a href="/api/thu-vien/file/${Number(g.embId)}?tai=1">${icon('download', { size: 14 })} Tải về/Download EMB</a>
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

// "Bỏ qua" cảnh báo đơn chuyển mua tracking thủ công (11/10/2026, theo yêu cầu người dùng) — CHỈ superadmin (server kiểm lại). Dùng ở khung
// cảnh báo của Danh sách đơn hàng và trang Tracking; mỗi trang tự có taiCanhBaoThuCong() để vẽ lại sau khi bấm.
function htmlNutBoQuaCanhBao(sttKey) {
  if (!window.__nguoiDung || window.__nguoiDung.vaiTro !== 'superadmin') return '';
  return `<button type="button" class="btn-hanh-dong phu" style="padding:4px 10px;font-size:0.82rem" title="Không hiện đơn này ở khung cảnh báo nữa (vẫn mua tay được; hiện lại ở Chi tiết đơn)"
    onclick='boQuaCanhBaoThuCong(this, ${escapeHtml(JSON.stringify(sttKey))}, true)'>Bỏ qua</button>`;
}
async function boQuaCanhBaoThuCong(nut, sttKey, boQua) {
  if (boQua && !confirm(`Bỏ qua cảnh báo mua tracking thủ công của đơn ${sttKey}? Đơn sẽ không hiện ở khung cảnh báo nữa (hiện lại được ở Chi tiết đơn).`)) return;
  nut.disabled = true;
  try {
    await apiFetch('/tracking/bo-qua-canh-bao', { method: 'POST', body: JSON.stringify({ sttKey, boQua }) });
    if (typeof taiCanhBaoThuCong === 'function' && boQua) await taiCanhBaoThuCong();
    else location.reload();
  } catch (e) { alert('Lỗi: ' + e.message); nut.disabled = false; }
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
// Giá trị là ảnh của app (/api/photos/file/..., vd thay ảnh đã sản xuất 14/10/2026) -> link "Mở ảnh cũ/mới" thay cho đường dẫn dài
// (chỉ đúng tiền tố đường dẫn nội bộ này mới thành link — không biến chữ bất kỳ thành href).
function giaTriLichSu(v, nhanAnh) {
  return /^\/api\/photos\/file\/[^\s"'<>]+$/.test(v) ? `<a href="${escapeHtml(v)}" target="_blank" rel="noopener">${nhanAnh}</a>` : escapeHtml(v);
}
function htmlThayDoiLichSu(thayDoi) {
  if (!thayDoi || !thayDoi.length) return '';
  return `<ul class="lich-su-thay-doi">${thayDoi.map(t =>
    `<li>${escapeHtml(t.nhan)}: ${t.tu !== null ? `${giaTriLichSu(t.tu, 'Mở ảnh cũ')} → ` : ''}<strong>${giaTriLichSu(t.sang, 'Mở ảnh mới')}</strong></li>`).join('')}</ul>`;
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
          onclick="dayLaiSheetSeller([{ sttKey: this.dataset.stt, loai: this.dataset.loai }], this)">Đẩy lại</button>
          <button type="button" class="btn-hanh-dong phu" data-stt="${escapeHtml(d.STT_Key)}" data-loai="${escapeHtml(d.Loai)}"
          onclick="boQuaLoiSheetSeller(this.dataset.stt, this.dataset.loai, this)">Bỏ qua</button></td>` : ''}
      </tr>`).join('')}
    </table></div>`;
}
let _taiLaiSauDayLai = null; // trang đăng ký hàm vẽ lại (datTaiLaiSauDayLai)
// "Bỏ qua" 1 lỗi ghi Sheet Seller (14/10/2026, theo yêu cầu người dùng — chỉ superadmin): ẩn khỏi danh sách lỗi đang chờ và khỏi
// "Đẩy lại tất cả"; đơn đó ghi lỗi lần mới thì hiện lại (routes/dongBoSheetSeller.js POST /bo-qua).
async function boQuaLoiSheetSeller(sttKey, loai, btn) {
  if (!confirm(`Bỏ qua lỗi ghi Sheet Seller của đơn ${sttKey} (${NHAN_LOAI_SHEET_SELLER[loai] || loai})? Lỗi này sẽ không hiện ở đây nữa — nếu đơn lại ghi lỗi lần mới thì hiện lại.`)) return;
  btn.disabled = true;
  try {
    await apiFetch('/dong-bo-sheet-seller/bo-qua', { method: 'POST', body: JSON.stringify({ sttKey, loai }) });
    if (_taiLaiSauDayLai) await _taiLaiSauDayLai();
  } catch (e) {
    alert('Lỗi: ' + e.message);
    btn.disabled = false;
  }
}
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
// tuyChon.thongSo (12/10/2026, Logs_UploadAnh ở scan.html): object RIÊNG của lượt gọi, hàm điền kích thước gốc/sau nén, thời gian
// giải mã / vẽ / xuất JPEG và lý do không nén (khongNen). Không dùng biến toàn cục: scan.html nén ngầm nhiều ảnh CHỒNG nhau.
// Giải mã ảnh để nén (14/10/2026, theo Logs_UploadAnh 13/10: 84% ảnh KHÔNG nén được — Safari iOS/iPadOS 15 báo "Type error",
// Samsung A05 báo "The source image could not be decoded" ở createImageBitmap(file, ...), nên gửi nguyên ảnh 2–3MB, có lượt 54–128s).
// Thử createImageBitmap trước (nhanh, tự xoay theo EXIF); lỗi thì giải mã bằng thẻ <img> — Safari 13.4+/Chrome 81+ tự xoay theo
// EXIF cả khi vẽ <img> lên canvas. Cả 2 cách đều lỗi -> ném lỗi gộp cả 2 lý do (nơi gọi gửi ảnh gốc như cũ, log ghi rõ lý do).
// ts.cachGiaiMa = 'bitmap' | 'img' (+ ts.loiBitmap) để Logs_UploadAnh biết đường nào đã dùng trên từng loại máy.
// Ma trận vẽ cho cờ xoay EXIF 5–8 (ảnh gốc nằm ngang, cần xoay 90° để đứng) — (w, h) là kích thước canvas ĐÍCH đã đúng chiều.
const MA_TRAN_XOAY_EXIF = {
  2: w => [-1, 0, 0, 1, w, 0], // lật ngang
  3: (w, h) => [-1, 0, 0, -1, w, h], // xoay 180°
  4: (w, h) => [1, 0, 0, -1, 0, h], // lật dọc
  5: () => [0, 1, 1, 0, 0, 0],
  6: w => [0, 1, -1, 0, w, 0],
  7: (w, h) => [0, -1, -1, 0, w, h],
  8: (w, h) => [0, -1, 1, 0, 0, h],
};
// Trình duyệt có TỰ xoay ảnh theo EXIF khi vẽ <img> lên canvas không — DÒ 1 LẦN bằng đúng thao tác dùng thật (không đoán theo kích
// thước: ảnh vuông rộng = cao, và cờ 2–4 không đổi kích thước). Ảnh mẫu 16×8 nửa TRÁI đỏ, nửa phải xanh, gắn cờ xoay 6 (xoay 90° chiều
// kim đồng hồ): trình duyệt có xoay -> vẽ ra 8×16, cả nửa TRÊN đỏ; không xoay -> 16×8, nửa PHẢI xanh. Lấy mẫu ở GÓC TRÊN BÊN PHẢI (xa
// ranh đỏ/xanh bị nén nhoè): đỏ = có xoay, xanh = không. Dò lỗi BẤT KỲ bước nào (kể cả toBlob) hoặc quá 3 giây (trang đang ẩn có thể
// hoãn toBlob) -> lượt đó coi như CÓ xoay (mọi trình duyệt hiện hành đều xoay) — không bao giờ để bước dò làm hỏng hay treo việc nén.
// CHỈ nhớ kết quả dò THẬT: hết giờ thì lượt dò vẫn chạy tiếp và tự lưu khi xong (ảnh sau dùng được); lỗi thì ảnh sau dò lại.
// Lượt dò TREO hẳn (trình duyệt không bao giờ gọi lại toBlob/onload): sau lần hết giờ đầu, các ảnh sau dùng NGAY mặc định, không chờ thêm
// 3 giây mỗi ảnh; treo quá 30 giây thì bỏ lượt đó, ảnh kế tiếp dò lại từ đầu. Dò LỖI (vd trình duyệt chặn đọc điểm ảnh canvas) thì
// 30 giây sau mới dò lại — máy lỗi cố định không phải chạy lại cả lượt dò cho từng ảnh.
// ts.doXoay (Logs_UploadAnh): 'that' = kết quả dò thật | 'loi' (lượt dò này lỗi) | 'loi-nho' (lỗi trong 30 giây trước, không dò)
// | 'het-gio' = đang dùng mặc định "có xoay".
let _trinhDuyetXoayExif = null; // true/false — kết quả dò thật
let _dangDoXoayExif = null; // { hua, batDau, daHetGio } — lượt dò đang chạy; các ảnh nén chồng nhau dùng chung, không dò chồng
let _loiDoXoayLuc = -Infinity; // performance.now() lúc lượt dò gần nhất bị LỖI
async function trinhDuyetTuXoayExif(ts = {}) {
  if (_trinhDuyetXoayExif !== null) { ts.doXoay = 'that'; return _trinhDuyetXoayExif; }
  if (performance.now() - _loiDoXoayLuc < 30000) { ts.doXoay = 'loi-nho'; return true; } // lỗi đã nhớ, ảnh này không dò
  if (_dangDoXoayExif && performance.now() - _dangDoXoayExif.batDau > 30000) _dangDoXoayExif = null; // treo quá lâu -> dò lại
  if (_dangDoXoayExif && _dangDoXoayExif.daHetGio) { ts.doXoay = 'het-gio'; return true; }
  if (!_dangDoXoayExif) {
    const moi = { batDau: performance.now(), daHetGio: false };
    moi.hua = doTrinhDuyetXoayExif()
      .then(kq => { _trinhDuyetXoayExif = kq; return { kq, cach: 'that' }; },
        () => { if (_dangDoXoayExif === moi) _loiDoXoayLuc = performance.now(); return { kq: true, cach: 'loi' }; }) // lượt đã bỏ: không chặn lượt mới
      .finally(() => { if (_dangDoXoayExif === moi) _dangDoXoayExif = null; }); // lượt cũ đã bị bỏ thì không xoá lượt mới
    _dangDoXoayExif = moi;
  }
  const luot = _dangDoXoayExif;
  let hen;
  const { kq, cach } = await Promise.race([
    luot.hua,
    new Promise(r => { hen = setTimeout(() => { luot.daHetGio = true; r({ kq: true, cach: 'het-gio' }); }, 3000); }),
  ]);
  clearTimeout(hen);
  ts.doXoay = cach;
  return kq;
}
async function doTrinhDuyetXoayExif() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 8;
  const g = c.getContext('2d');
  g.fillStyle = '#f00'; g.fillRect(0, 0, 8, 8);
  g.fillStyle = '#00f'; g.fillRect(8, 0, 8, 8);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 1));
  if (!blob) throw new Error('toBlob rỗng');
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  const app1 = [0xFF, 0xE1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01,
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  const url = URL.createObjectURL(new Blob([jpeg.slice(0, 2), new Uint8Array(app1), jpeg.slice(2)], { type: 'image/jpeg' }));
  try {
    const img = await new Promise((xong, loi) => { const a = new Image(); a.onload = () => xong(a); a.onerror = loi; a.src = url; });
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const gg = cv.getContext('2d'); gg.drawImage(img, 0, 0);
    const [r, , b] = gg.getImageData(cv.width - 3, 2, 1, 1).data; // góc trên bên phải
    return r > b;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Đọc cờ xoay EXIF (thẻ 0x0112) trong khối APP1 đầu file JPEG — chỉ đọc tối đa 256KB đầu. -> 1..8, hoặc null (không phải JPEG /
// không có EXIF / không có thẻ xoay / cấu trúc lạ).
async function docHuongExif(file) {
  const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
  if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
  for (let i = 2; i + 4 <= v.byteLength && v.getUint8(i) === 0xFF;) {
    const ma = v.getUint8(i + 1);
    if (ma === 0xDA) return null; // tới dữ liệu ảnh (SOS) — không có EXIF phía trước
    if (ma === 0xE1 && i + 18 <= v.byteLength && v.getUint32(i + 4) === 0x45786966) { // "Exif"
      const goc = i + 10, le = v.getUint16(goc) === 0x4949;
      const ifd = goc + v.getUint32(goc + 4, le);
      const soMuc = ifd + 2 <= v.byteLength ? v.getUint16(ifd, le) : 0;
      for (let k = 0; k < soMuc && ifd + 14 + k * 12 <= v.byteLength; k++) {
        const o = ifd + 2 + k * 12;
        if (v.getUint16(o, le) === 0x0112) return v.getUint16(o + 8, le);
      }
      return null;
    }
    i += 2 + v.getUint16(i + 2);
  }
  return null;
}

async function giaiMaAnhDeNen(file, ts) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    ts.cachGiaiMa = 'bitmap';
    return bitmap;
  } catch (loiBitmap) {
    ts.loiBitmap = String(loiBitmap && loiBitmap.message || loiBitmap).slice(0, 120);
  }
  const url = URL.createObjectURL(file);
  try {
    // onload, KHÔNG dùng img.decode(): thử trên Chrome, decode() không xong khi trang đang ẩn (document.hidden — vd đang ở app camera
    // của máy) còn onload vẫn chạy. Quá 20 giây thì bỏ, gửi ảnh gốc — nén không bao giờ được chặn việc gửi ảnh.
    const img = await new Promise((xong, loi) => {
      const anh = new Image();
      const hen = setTimeout(() => loi(new Error('giải mã quá 20 giây')), 20000);
      anh.onload = () => { clearTimeout(hen); xong(anh); };
      anh.onerror = () => { clearTimeout(hen); loi(new Error('trình duyệt không đọc được ảnh')); };
      anh.src = url;
    });
    ts.cachGiaiMa = 'img';
    // Chiều xoay EXIF: trình duyệt KHÔNG tự xoay khi vẽ (dò 1 lần — trinhDuyetTuXoayExif) và ảnh có cờ 2–8 -> app tự xoay/lật khi vẽ.
    // Không đọc được EXIF (không phải JPEG, EXIF lạ) -> vẽ như thường.
    const huong = await docHuongExif(file).catch(() => null);
    const tuXoay = MA_TRAN_XOAY_EXIF[huong] && !(await trinhDuyetTuXoayExif(ts)) ? huong : 0;
    ts.huongExif = huong;
    if (tuXoay) ts.tuXoayExif = true;
    const doiChieu = tuXoay >= 5; // xoay 90°: ảnh gốc nằm ngang -> đứng (đổi rộng/cao)
    const [rong, cao] = doiChieu ? [img.naturalHeight, img.naturalWidth] : [img.naturalWidth, img.naturalHeight];
    // Cùng "hình dạng" ImageBitmap mà nơi gọi dùng: width/height (đã đúng chiều), ve() vẽ đúng chiều, close() giải phóng blob URL.
    return {
      width: rong, height: cao,
      ve: (ctx, w, h) => {
        if (tuXoay) ctx.setTransform(...MA_TRAN_XOAY_EXIF[tuXoay](w, h));
        ctx.drawImage(img, 0, 0, doiChieu ? h : w, doiChieu ? w : h);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      },
      close: () => URL.revokeObjectURL(url),
    };
  } catch (loiImg) {
    URL.revokeObjectURL(url);
    // 16 byte đầu file (hex) để biết file THẬT là gì khi cả 2 cách đều không đọc được: "ffd8ff..." = JPEG; "66747970" ("ftyp") từ byte
    // thứ 4 = HEIF/HEIC/AVIF (4 byte sau là nhãn: heic, heix, mif1, msf1, avif...) — nghi Samsung A05 lưu HEIC dưới tên .jpg (Logs 14/10).
    // Đọc quá 1 giây thì bỏ (null) — không để bước ghi log chặn việc gửi ảnh gốc.
    let hen;
    ts.dauFile = await Promise.race([
      file.slice(0, 16).arrayBuffer().then(b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''), () => null),
      new Promise(r => { hen = setTimeout(() => r(null), 1000); }),
    ]);
    clearTimeout(hen);
    throw new Error(`${ts.loiBitmap} | <img>: ${String(loiImg && loiImg.message || loiImg).slice(0, 120)}`);
  }
}

// Ảnh HEIC/HEIF (14/10/2026, Logs_UploadAnh: Samsung A05 bật "Ảnh hiệu suất cao" -> ảnh HEIC mang tên .jpg): trình duyệt Android/máy tính
// không đọc được -> không nén được (gửi nguyên vài MB) và người xem trên Chrome / QC có thể không mở được ảnh. Nhận ra qua 16 byte đầu
// (ts.dauFile, chỉ ghi khi KHÔNG giải mã được): "ftyp" từ byte thứ 4. Chỉ CẢNH BÁO để người dùng tắt cài đặt — ảnh vẫn được gửi như cũ.
const laAnhHeif = dauFile => typeof dauFile === 'string' && dauFile.slice(8, 16) === '66747970';
const CANH_BAO_ANH_HEIF = 'Máy này đang chụp ảnh dạng HEIC (HEIF): app KHÔNG nén được (gửi rất chậm) và nhiều máy tính KHÔNG XEM ĐƯỢC ảnh này.\n'
  + 'Cách sửa (làm 1 lần): mở ứng dụng Camera → Cài đặt (bánh răng) → Tùy chọn ảnh nâng cao → TẮT "Ảnh hiệu suất cao" (Samsung).\n'
  + 'Ảnh vừa chụp vẫn được gửi lên bình thường.';
// Trang Chi tiết đơn: admin hay tải file từ máy tính (vd ảnh HEIC chép từ iPhone) — không phải lúc nào cũng là camera Samsung.
const CANH_BAO_FILE_HEIF = 'File ảnh này là dạng HEIC (HEIF): app KHÔNG nén được và nhiều máy tính / Chrome KHÔNG XEM ĐƯỢC ảnh này.\n'
  + 'Nên chuyển ảnh sang JPG trước khi tải (hoặc tắt chế độ HEIC/"Ảnh hiệu suất cao" trên máy đã chụp).\n'
  + 'Ảnh này vẫn được tải lên như bình thường.';

async function nenAnhTruocKhiTaiLen(file, tuyChon = {}) {
  const canhDaiToiDa = tuyChon.canhDaiToiDa || CANH_DAI_NHAT_TOI_DA_KHI_NEN_ANH;
  const chatLuongJpeg = tuyChon.chatLuongJpeg || CHAT_LUONG_JPEG_KHI_NEN_ANH;
  const ts = tuyChon.thongSo || {};
  const khongNen = lyDo => { lyDoKhongNenGanNhat = lyDo; ts.khongNen = lyDo; return file; };
  lyDoKhongNenGanNhat = null;
  if (!file || !file.type || !file.type.startsWith('image/')) return khongNen('Không phải file ảnh');
  if (file.size <= BO_QUA_NEN_NEU_DA_NHO_HON) return khongNen('Ảnh đã nhỏ sẵn (bỏ qua)');
  try {
    const t0 = performance.now();
    const bitmap = await giaiMaAnhDeNen(file, ts);
    const t1 = performance.now();
    const tyLe = Math.min(1, canhDaiToiDa / Math.max(bitmap.width, bitmap.height));
    const rong = Math.round(bitmap.width * tyLe);
    const cao = Math.round(bitmap.height * tyLe);

    const canvas = document.createElement('canvas');
    canvas.width = rong;
    canvas.height = cao;
    const ctx = canvas.getContext('2d');
    if (bitmap.ve) bitmap.ve(ctx, rong, cao); else ctx.drawImage(bitmap, 0, 0, rong, cao);
    const t2 = performance.now();
    Object.assign(ts, { rongGoc: bitmap.width, caoGoc: bitmap.height, rong, cao, msGiaiMa: Math.round(t1 - t0), msVe: Math.round(t2 - t1) });
    bitmap.close();

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', chatLuongJpeg));
    ts.msXuat = Math.round(performance.now() - t2);
    if (!blob) return khongNen('canvas.toBlob() trả về rỗng');
    if (blob.size >= file.size) return khongNen(`Nén không hiệu quả (${(blob.size/1024).toFixed(0)}KB >= gốc)`);

    const tenFileMoi = String(file.name || 'anh').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], tenFileMoi, { type: 'image/jpeg' });
  } catch (e) {
    console.error('[Nén ảnh] Lỗi khi nén, dùng ảnh gốc:', e.message);
    return khongNen('Lỗi: ' + e.message);
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
