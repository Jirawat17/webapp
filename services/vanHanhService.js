// Cảnh báo vận hành (11/10/2026, theo yêu cầu người dùng — spec 2026-10-04-21-tinh-nang-design.md mục C2, C3, 9 L2, 18 Y6, 20 Y20).
//   Y6 — đơn đã nhận ("Đang vẽ file" / "Đang chạy máy") quá lâu.
//   L2 — vận chuyển bất thường: R1 mua tracking quá N ngày mà GKE chưa có sự kiện; R2 TRANG_THAI_TRACKING không đổi quá N ngày;
//        R3 TRANG_THAI_TRACKING nằm trong danh sách superadmin tự tích (KHÔNG cài sẵn mã GKE nào).
//   C3 — 1 chat Telegram vận hành (Settings, superadmin); trống = không gửi. Y6 + L2: 1 tin tổng hợp 8 giờ sáng; Y20: gửi ngay.
// Quy tắc là hàm THUẦN (đầu vào: dòng đơn + cấu hình + giờ hiện tại) — kiểm thử bằng scripts/kiem-tra-canh-bao.js.
const cron = require('node-cron');
const caiDat = require('./caiDatDbService');
const nhatKy = require('./nhatKyDbService');

const MAC_DINH = {
  TELEGRAM_CHAT: '',
  Y6_BAT_VE: '1', Y6_GIO_VE: '24', Y6_BAT_CHAY: '1', Y6_GIO_CHAY: '12',
  L2_BAT_R1: '1', L2_NGAY_R1: '3', L2_BAT_R2: '1', L2_NGAY_R2: '7', L2_BAT_R3: '1', L2_TRANG_THAI_R3: '[]',
};
function layCauHinh() {
  const luu = caiDat.layCaiDatVanHanh();
  const g = k => (luu[k] === undefined || luu[k] === '' ? MAC_DINH[k] : luu[k]);
  let r3 = [];
  try { r3 = JSON.parse(g('L2_TRANG_THAI_R3')); } catch (e) { /* hỏng -> rỗng */ }
  return {
    telegramChat: g('TELEGRAM_CHAT'),
    y6: { batVe: g('Y6_BAT_VE') === '1', gioVe: Number(g('Y6_GIO_VE')), batChay: g('Y6_BAT_CHAY') === '1', gioChay: Number(g('Y6_GIO_CHAY')) },
    l2: {
      batR1: g('L2_BAT_R1') === '1', ngayR1: Number(g('L2_NGAY_R1')),
      batR2: g('L2_BAT_R2') === '1', ngayR2: Number(g('L2_NGAY_R2')),
      batR3: g('L2_BAT_R3') === '1', trangThaiR3: Array.isArray(r3) ? r3.map(String) : [],
    },
  };
}

const gioTu = (iso, bayGio) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? (bayGio - t) / 3600000 : null; };

// ---------- Y6 ----------
const { TRANG_THAI_KET_THUC: TRANG_THAI_DA_KET_THUC } = require('../data/pipelineTinhTrang'); // huỷ / hoàn / đã giao — danh sách dùng chung
// -> [{ sttKey, loai: 'VE_FILE'|'CHAY_MAY', nguoi, luc, soGio, quaHan, khongRo }] cho MỌI đơn đang được nhận (bỏ đơn đã huỷ/hoàn/giao —
// đơn huỷ giữa lúc đang vẽ vẫn giữ "Đang vẽ file"). soGio null = không rõ lúc nhận (nhận trước khi có nhật ký): khongRo = true, KHÔNG
// tính là quá giờ (không biết đã bao lâu) — Trung tâm hành động / Telegram vẫn liệt kê riêng để admin xem.
function donDangNhan(rows, y6, bayGio = Date.now()) {
  const kq = [];
  const them = (r, loai, nguoi, luc, bat, gio) => {
    const soGio = gioTu(luc, bayGio);
    kq.push({ sttKey: r.STT_Key, loai, nguoi: nguoi || '', luc: luc || '', soGio, quaHan: bat && soGio !== null && soGio >= gio, khongRo: bat && soGio === null });
  };
  for (const r of rows) {
    if (TRANG_THAI_DA_KET_THUC.includes(r.TRANG_THAI_XUONG)) continue;
    if (r.TRANG_THAI_VE_FILE === 'Đang vẽ file') them(r, 'VE_FILE', r.NGUOI_VE_FILE, r.THOI_GIAN_NHAN_VE_FILE, y6.batVe, y6.gioVe);
    if (r.TRANG_THAI_XUONG === 'Đang chạy máy') them(r, 'CHAY_MAY', r.NGUOI_CHAY_MAY, r.THOI_GIAN_NHAN_CHAY_MAY, y6.batChay, y6.gioChay);
  }
  // Quá giờ lên đầu, nhận lâu nhất trước; không rõ lúc nhận xuống cuối — Telegram chỉ in 30 dòng, đơn quá giờ thật không bị đẩy khuất.
  return kq.sort((a, b) => (b.quaHan - a.quaHan) || ((b.soGio ?? -1) - (a.soGio ?? -1)));
}
const canNhac = d => d.quaHan || d.khongRo;
// Khoá/giá trị "đã xử lý" (C2): nhận lại (mốc nhận đổi) -> nhắc hiện lại.
const khoaY6 = d => `${d.sttKey}|${d.loai}`;
const giaTriY6 = d => d.luc || 'KHONG_RO';

// ---------- L2 ----------
const TRANG_THAI_KHONG_XET_L2 = TRANG_THAI_DA_KET_THUC;
// daGiao(row): đã giao xong theo GKE (trackingAutoService.daGiaoThanhCongGke) — truyền vào để module này không kéo GKE theo.
function vanChuyenBatThuong(rows, l2, daGiao, bayGio = Date.now()) {
  const kq = [];
  for (const r of rows) {
    // Đơn dùng chung tracking (DonNhieuAo) xét theo đơn mua — tránh báo trùng 1 kiện nhiều lần.
    // Tracking do Seller cung cấp (NGUON_TRACKING 'SELLER', 11/10/2026): không xét — người dùng chốt, tránh báo sai "chưa được quét nhận".
    if (!r.TRACKING_ID || r.TRACKING_CHUNG_CUA || r.NGUON_TRACKING === 'SELLER' || TRANG_THAI_KHONG_XET_L2.includes(r.TRANG_THAI_XUONG) || daGiao(r)) continue;
    const tt = String(r.TRANG_THAI_TRACKING || '').trim();
    const quyTac = [];
    const ngayMua = gioTu(r.THOI_GIAN_MUA_TRACKING, bayGio);
    const ngayDung = gioTu(r.THOI_GIAN_DOI_TRANG_THAI_TRACKING, bayGio);
    if (l2.batR1 && !tt && ngayMua !== null && ngayMua / 24 >= l2.ngayR1) quyTac.push({ ma: 'R1', soNgay: Math.floor(ngayMua / 24) });
    if (l2.batR2 && tt && ngayDung !== null && ngayDung / 24 >= l2.ngayR2) quyTac.push({ ma: 'R2', soNgay: Math.floor(ngayDung / 24) });
    if (l2.batR3 && tt && l2.trangThaiR3.includes(tt)) quyTac.push({ ma: 'R3', soNgay: ngayDung === null ? null : Math.floor(ngayDung / 24) });
    if (quyTac.length) kq.push({ sttKey: r.STT_Key, trackingId: r.TRACKING_ID, trangThai: tt, quyTac });
  }
  return kq;
}
const khoaL2 = d => d.sttKey;
const giaTriL2 = d => d.trangThai || '(trống)';

// Bỏ mục đã đánh dấu "Đã xử lý" với ĐÚNG giá trị hiện tại (giá trị đổi -> hiện lại).
function locDaXuLy(loai, ds, khoa, giaTri) {
  const da = nhatKy.layDaXuLy(loai);
  return ds.filter(d => { const x = da.get(khoa(d)); return !x || x.gia_tri !== giaTri(d); });
}

// ---------- Telegram (C3) ----------
function guiTinVanHanh(text) {
  const chat = layCauHinh().telegramChat;
  if (!chat) return Promise.resolve({ ok: false, loi: 'Chưa cấu hình chat Telegram vận hành' });
  return require('./telegramService').guiTinNhan(chat, text).catch(err => {
    console.error('[VanHanh] Gửi Telegram lỗi:', err.message);
    return { ok: false, loi: err.message };
  });
}

const NHAN_Y6 = { VE_FILE: 'đang vẽ file', CHAY_MAY: 'đang chạy máy' };
const NHAN_L2 = { R1: 'chưa được quét nhận', R2: 'đứng yên', R3: 'trạng thái bất thường' };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function guiTongHopHangNgay() {
  try {
    const cauHinh = layCauHinh();
    if (!cauHinh.telegramChat) return;
    const { rows } = await require('./orderService').getAll();
    const { daGiaoThanhCongGke } = require('./trackingAutoService');
    const y6 = locDaXuLy('NHAN_LAU', donDangNhan(rows, cauHinh.y6).filter(canNhac), khoaY6, giaTriY6);
    const l2 = locDaXuLy('VAN_CHUYEN', vanChuyenBatThuong(rows, cauHinh.l2, r => daGiaoThanhCongGke(r.MA_NODE_TRACKING, r.MA_TRANG_THAI_NODE_TRACKING)), khoaL2, giaTriL2);
    if (!y6.length && !l2.length) return;
    const dong = [];
    if (y6.length) {
      const soKhongRo = y6.filter(d => d.khongRo).length, soQua = y6.length - soKhongRo;
      dong.push(soQua ? `<b>Đơn nhận quá lâu: ${soQua}</b>${soKhongRo ? ` · không rõ lúc nhận: ${soKhongRo}` : ''}` : `<b>Đơn đang nhận, không rõ lúc nhận: ${soKhongRo}</b>`);
      y6.slice(0, 30).forEach(d => dong.push(`• ${esc(d.sttKey)} ${NHAN_Y6[d.loai]} · ${esc(d.nguoi || '?')} · ${d.soGio === null ? 'không rõ lúc nhận' : Math.floor(d.soGio) + ' giờ'}`));
      if (y6.length > 30) dong.push(`… và ${y6.length - 30} đơn khác`);
    }
    if (l2.length) {
      dong.push(`<b>Vận chuyển bất thường: ${l2.length}</b>`);
      l2.slice(0, 30).forEach(d => dong.push(`• ${esc(d.sttKey)} · ${esc(d.trackingId)} · ${d.quyTac.map(q => NHAN_L2[q.ma] + (q.soNgay !== null ? ` ${q.soNgay} ngày` : '')).join(', ')}${d.trangThai ? ' · ' + esc(d.trangThai) : ''}`));
      if (l2.length > 30) dong.push(`… và ${l2.length - 30} đơn khác`);
    }
    dong.push('Chi tiết: Trung tâm hành động.');
    await guiTinVanHanh(dong.join('\n'));
  } catch (err) {
    console.error('[VanHanh] Tổng hợp hằng ngày lỗi:', err.message);
  }
}
function batDauLichVanHanh() {
  cron.schedule('0 8 * * *', guiTongHopHangNgay, { timezone: 'Asia/Ho_Chi_Minh' });
  console.log('[VanHanh] Đã bật lịch tổng hợp Telegram vận hành (8 giờ sáng mỗi ngày).');
}

module.exports = {
  MAC_DINH, layCauHinh, donDangNhan, canNhac, vanChuyenBatThuong, locDaXuLy, khoaY6, giaTriY6, khoaL2, giaTriL2,
  guiTinVanHanh, guiTongHopHangNgay, batDauLichVanHanh,
};
