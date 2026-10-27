// Trang "Sức khoẻ hệ thống" (24/10/2026, theo yêu cầu người dùng — tab đầu của menu Logs, CHỈ superadmin): gom 1 màn hình các thông tin
// đang nằm rải ở Logs / Settings / Tìm ảnh. Chỉ ĐỌC. Mỗi mục: muc = 'tot' | 'chu-y' | 'loi' | 'thong-tin' + vài dòng chữ thường.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { thoiGianVNISOString } = require('./dateUtils');

const MOT_GIO_MS = 3600 * 1000;
const vn = ms => thoiGianVNISOString(new Date(ms));
const boHtml = s => String(s).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const phanVi = (ds, p) => { if (!ds.length) return null; const s = [...ds].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const giay = ms => (ms == null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')}s`);
const pt = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const thoiGianTruoc = ms => (ms < MOT_GIO_MS ? `${Math.round(ms / 60000)} phút` : ms < 48 * MOT_GIO_MS ? `${Math.round(ms / MOT_GIO_MS)} giờ` : `${Math.round(ms / 86400000)} ngày`);
// 1 mục lỗi không làm hỏng cả trang.
const anToan = (ten, fn) => { try { return fn(); } catch (err) { return { ten, muc: 'loi', dong: ['Không đọc được: ' + err.message] }; } };

function mayChu() {
  const pb = require('./phienBanService');
  const ram = process.memoryUsage().rss / 1048576;
  const cpu = os.cpus().length, tai = os.loadavg();
  const dong = [`Phiên bản: ${pb.moTa}`, `RAM app ${Math.round(ram)} MB · RAM máy trống ${Math.round(os.freemem() / 1048576)}/${Math.round(os.totalmem() / 1048576)} MB`,
    `Tải CPU (1/5/15 phút): ${tai.map(t => t.toFixed(2)).join(' / ')} trên ${cpu} nhân`];
  let muc = tai[1] > cpu ? 'chu-y' : 'tot';
  try {
    const d = fs.statfsSync(path.join(__dirname, '..', 'data'));
    const trong = d.bavail * d.bsize, tong = d.blocks * d.bsize, tyLe = pt(trong, tong);
    dong.push(`Đĩa (thư mục data): trống ${(trong / 1073741824).toFixed(1)} / ${(tong / 1073741824).toFixed(1)} GB (${tyLe}%)`);
    if (tyLe < 5) muc = 'loi'; else if (tyLe < 15) muc = 'chu-y';
  } catch (e) { dong.push('Đĩa: không đọc được'); }
  return { ten: 'Máy chủ', muc, dong };
}

function saoLuu(ms) {
  const { THU_MUC_BACKUP } = require('./backupDbService');
  let moiNhat = 0, soBan = 0;
  for (const con of fs.existsSync(THU_MUC_BACKUP) ? fs.readdirSync(THU_MUC_BACKUP) : []) {
    const p = path.join(THU_MUC_BACKUP, con);
    if (!fs.statSync(p).isDirectory()) continue;
    for (const f of fs.readdirSync(p)) { soBan++; moiNhat = Math.max(moiNhat, fs.statSync(path.join(p, f)).mtimeMs); }
  }
  if (!moiNhat) return { ten: 'Sao lưu dữ liệu', muc: 'loi', dong: ['Chưa có bản sao lưu nào.'] };
  const cach = ms - moiNhat;
  return { ten: 'Sao lưu dữ liệu', muc: cach > 3 * MOT_GIO_MS ? 'loi' : cach > 1.5 * MOT_GIO_MS ? 'chu-y' : 'tot',
    dong: [`Bản gần nhất: ${thoiGianTruoc(cach)} trước (${vn(moiNhat).slice(0, 16).replace('T', ' ')}) · đang giữ ${soBan} bản (sao lưu mỗi giờ, giữ 7 ngày)`] };
}

function mang(ms) {
  const dong = require('./baoCaoVanHanhService').thongKeMangMayChu(ms).dong.map(boHtml);
  return { ten: 'Mạng máy chủ (24 giờ)', muc: 'thong-tin', dong: dong.length ? dong : ['Chưa có số đo.'] };
}

function taiAnh(ms) {
  const nk = require('./nhatKyDbService');
  const ds = nk.dsQuetVaChupTrongKhoang(vn(ms - 24 * MOT_GIO_MS), vn(ms));
  const ok = ds.filter(d => d.su_kien === 'CHUP_ANH' && d.ket_qua === 'OK');
  const loi = ds.filter(d => (d.su_kien === 'CHUP_ANH' && d.ket_qua === 'LOI') || d.su_kien === 'THOAT_GIUA_CHUNG').length; // gồm ảnh bỏ dở
  const cham = ok.filter(d => d.cham).length, msOk = ok.map(d => d.tong_ms).filter(v => v != null);
  const quet = ds.filter(d => d.su_kien === 'QUET_QR' && !d.lap_bi_chan), sai = quet.filter(d => nk.phanLoaiLoiQuet(d.ket_qua, d.loi) === 'SAI_TRANG_THAI').length; // bỏ dòng tổng đọc lặp
  const lap = ds.reduce((s, d) => s + (Number(d.lap_bi_chan) || 0), 0);
  const tyLoi = pt(loi, ok.length + loi);
  return { ten: 'Quét QR / tải ảnh (24 giờ)', muc: tyLoi > 10 ? 'loi' : tyLoi > 3 || pt(cham, ok.length) > 20 ? 'chu-y' : 'tot', dong: [
    `${ok.length} ảnh tải xong · giữa ${giay(phanVi(msOk, 0.5))} · 90% ≤ ${giay(phanVi(msOk, 0.9))} · chậm (>8s) ${pt(cham, ok.length)}% · lỗi / bỏ dở ${loi} (${tyLoi}%)`,
    `${quet.length} lần quét QR · sai trạng thái ${sai}${quet.some(d => d.man_do) ? ` · hiện màn đỏ ${quet.filter(d => d.man_do).length} lần` : ''}`
      + (lap ? ` · để camera đọc lặp mã vừa lỗi ${lap} lần` : ''),
  ] };
}

function hangChoThuVien() {
  const db = require('./thuVien/thuVienDbService');
  const v = db.demViecTheoTrangThai();
  const tamDung = db.layCaiDat('hang_cho_tam_dung') === '1';
  return { ten: 'Hàng chờ tải ảnh thư viện (Tìm ảnh)', muc: tamDung || v.LOI_CUOI ? 'chu-y' : 'tot', dong: [
    `Chờ ${v.CHO} · đang chạy ${v.DANG_CHAY} · lỗi đang thử lại ${v.LOI} · lỗi hẳn ${v.LOI_CUOI} · xong ${v.XONG}`,
    ...(tamDung ? [`Đang TẠM DỪNG${db.layCaiDat('ly_do_tam_dung') ? ': ' + db.layCaiDat('ly_do_tam_dung') : ''}`] : []),
  ] };
}

// Nhãn giống trang Tracking (public/tracking.html#NHAN_TRANG_THAI). CAN_XEM = đơn tự động KHÔNG mua được tới khi có người xử lý.
const NHAN_TRACKING = { DA_MUA: 'đã mua', DANG_CHO_TEM: 'chờ tem GKE', DANG_TAO_DON_KL: 'đang mua KL', DANG_MUA_HPW: 'đang mua HPW',
  DEN_HAN_CHO_XU_LY: 'đến hạn chờ xử lý', DANG_CHO: 'chờ đủ giờ', CHO_DON_MUA_NHOM: 'chờ đơn .1 mua', DON_CON_CHUA_GHEP_NHOM: 'đơn con chưa ghép nhóm',
  LOI_NHOM: 'lỗi dữ liệu DonNhieuAo', DA_HUY: 'đã huỷ', CHUYEN_THU_CONG: 'chuyển MUA THỦ CÔNG', KHONG_TU_MUA_DUOC: 'không hãng nào tự mua được' };
// KHONG_TU_MUA_DUOC (28/10/2026) không nằm ở đây: gồm cả đơn ngoài phạm vi quốc gia / tắt hết tự mua (bình thường) — chỉ đơn có canXuLy
// (kẹt: hãng đã chọn bị tắt, thiếu tài khoản / SKU, hết tiền...) mới làm thẻ "chú ý" (trackingAutoService#chonHangTuMua).
const CAN_XEM = ['CHUYEN_THU_CONG', 'LOI_NHOM', 'DON_CON_CHUA_GHEP_NHOM'];
async function trackingGke() {
  const dsTk = require('./gkeService').tomTatTaiKhoanGke();
  const ds = await require('./trackingAutoService').layDanhSachDonAutoTracking({ vaiTro: 'superadmin', ten: 'Hệ thống (Sức khoẻ)' });
  const dem = {};
  ds.forEach(d => { dem[d.trangThai] = (dem[d.trangThai] || 0) + 1; });
  const dong = dsTk.map(t => `GKE "${t.ten}"${t.xuong.length ? ` (Xưởng ${t.xuong.join(', ')})` : ''}: `
    + (t.hetTienLuc ? `HẾT TIỀN từ ${vn(Date.parse(t.hetTienLuc)).slice(0, 16).replace('T', ' ')} — tự mua đang dừng`
      : t.soDu != null ? `số dư ước tính ${t.soDu}${t.conKhoangDon != null ? ` (≈ ${t.conKhoangDon} đơn)` : ''}${t.duoiMucBao ? ' — DƯỚI MỨC BÁO' : ''}` : 'chưa theo dõi số dư'));
  const soKet = ds.filter(d => d.canXuLy).length;
  dong.push(`Tự động mua tracking: ${Object.entries(dem).map(([k, n]) => `${NHAN_TRACKING[k] || k} ${n}`).join(' · ') || 'không có đơn nào'}`
    + (soKet ? ` — ${soKet} đơn kẹt cần xử lý (xem lý do ở trang Tracking)` : ''));
  return { ten: 'Tracking / tài khoản GKE', muc: dsTk.some(t => t.hetTienLuc) ? 'loi' : dsTk.some(t => t.duoiMucBao) || soKet || CAN_XEM.some(k => dem[k]) ? 'chu-y' : 'tot', dong };
}

function telegram() {
  const vanHanh = require('./vanHanhService').layCauHinh().telegramChat;
  const baoCao = require('./baoCaoLogService').layCauHinh().chat;
  const ai = require('./telegramAiService').trangThai();
  const sang = require('./baoCaoLogService').cauHinhSang();
  return { ten: 'Telegram', muc: !vanHanh || ai.loi ? 'chu-y' : 'tot', dong: [
    `Nhóm Vận hành (cảnh báo GKE hết tiền, đơn kẹt...): ${vanHanh ? 'đã cài' : 'CHƯA CÀI — cảnh báo sẽ không tới ai'}`,
    `Báo cáo logs hằng ngày / tuần: ${baoCao ? 'đã cài' : 'chưa cài'}`,
    `Bot Trợ lý AI: ${!ai.coToken ? 'chưa có bot' : ai.loi ? 'LỖI — ' + ai.loi : ai.daLienKet ? `đã liên kết (${ai.appUser})` : 'chưa liên kết'}`
      + ` · tóm tắt sáng ${sang.bat ? 'bật lúc ' + sang.gio : 'tắt'}`,
  ] };
}

function loiServer(ms) {
  const tu = new Date(ms - 24 * MOT_GIO_MS).toISOString();
  const ds = require('./logCapture').docDongTu(ms - 24 * MOT_GIO_MS)
    .filter(d => /^\[[^\]]+\] \[(ERROR|FATAL)\]/.test(d) && d.slice(1, 25) >= tu);
  const sap = ds.filter(d => d.includes('[FATAL]')).length;
  // Dòng ERROR có cả lỗi nghiệp vụ thường ngày (GKE từ chối đơn...) — không có ngưỡng nào đúng cho mọi ngày: chỉ báo đỏ khi app bị sập,
  // còn lại để thông tin (xem số + 5 dòng gần nhất).
  return { ten: 'Lỗi trong log máy chủ (24 giờ)', muc: sap ? 'loi' : 'thong-tin', dong: [
    `${ds.length} dòng lỗi${sap ? ` · app bị sập ${sap} lần` : ''}${ds.length ? ' — 5 dòng gần nhất:' : ''}`,
    ...ds.slice(-5).map(d => d.replace(/^\[([^\]]+)\]/, (g, iso) => `[${vn(Date.parse(iso)).slice(11, 19)}]`).slice(0, 300)),
  ] };
}

async function laySucKhoe(ms = Date.now()) {
  const muc = [
    anToan('Máy chủ', mayChu), anToan('Sao lưu dữ liệu', () => saoLuu(ms)), anToan('Telegram', telegram),
    await trackingGke().catch(err => ({ ten: 'Tracking / tài khoản GKE', muc: 'loi', dong: ['Không đọc được: ' + err.message] })),
    anToan('Quét QR / tải ảnh (24 giờ)', () => taiAnh(ms)), anToan('Mạng máy chủ (24 giờ)', () => mang(ms)),
    anToan('Hàng chờ tải ảnh thư viện', hangChoThuVien), anToan('Lỗi trong log máy chủ (24 giờ)', () => loiServer(ms)),
  ];
  return { luc: vn(ms).slice(0, 19).replace('T', ' '), muc };
}

module.exports = { laySucKhoe };
