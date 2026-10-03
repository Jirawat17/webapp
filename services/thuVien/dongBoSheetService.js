const cron = require('node-cron');
const db = require('./thuVienDbService');
const xuLy = require('./xuLyService');
const orderService = require('../orderService');
const { thoiGianVNISOString } = require('../dateUtils');

// ============================================================
// Giai đoạn 3 thư viện "Tìm ảnh" (spec mục 10): mỗi 10 phút so DUONG_DAN_URL của từng đơn (Don_Hang_ALL, qua getAll có
// cache sẵn) với giá trị lần trước (tv_nguon_don) — đơn nào đổi thì đưa các link vào hàng chờ (nguồn SHEET). Link cũ bị
// đổi/xoá: file đã lưu giữ nguyên; việc đang chờ của link cũ cũng giữ nguyên (spec không yêu cầu huỷ — và DUONG_DAN_URL là
// cột công thức sống: Sheet lỗi tạm thời ra ô rỗng/#REF! mà huỷ theo thì mất việc hàng loạt).
// TẮT theo mặc định (khoá 'tu_dong_sheet'): lần quét đầu đưa link của TOÀN BỘ đơn trong Sheet vào hàng chờ — superadmin tự
// bật khi đã sẵn sàng dung lượng NAS.
// ============================================================
const KHOA_BAT = 'tu_dong_sheet';
const KHOA_LAN_QUET = 'lan_quet_sheet';
const THOI_GIAN_CHO_SHEET_MS = 2 * 60000; // getAll treo (Sheets chậm) không được giữ cờ đang chạy mãi
const SO_DONG_MOI_DOT = 5000;

let dangChay = false;
const nhaLuong = () => new Promise(r => setImmediate(r));

const dangBat = () => db.layCaiDat(KHOA_BAT) === '1';
const dangQuet = () => dangChay;
function datBat(bat) { db.datCaiDat(KHOA_BAT, bat ? '1' : '0'); }
function layLanQuet() {
  try { return JSON.parse(db.layCaiDat(KHOA_LAN_QUET) || 'null'); } catch (e) { return null; }
}

// -> kết quả lần quét (cũng lưu vào tv_cai_dat để menu hiện), hoặc { boQua } nếu không chạy.
async function quetSheet({ bamTay = false } = {}) {
  if (!bamTay && !dangBat()) return { boQua: 'TAT' };
  if (dangChay) return { boQua: 'DANG_CHAY' };
  dangChay = true;
  const batDau = Date.now();
  let kq;
  try {
    let henGio;
    const { rows } = await Promise.race([
      orderService.getAll(),
      new Promise((_, reject) => { henGio = setTimeout(() => reject(new Error(`Đọc Sheet quá ${THOI_GIAN_CHO_SHEET_MS / 60000} phút`)), THOI_GIAN_CHO_SHEET_MS); }),
    ]).finally(() => clearTimeout(henGio));
    const daThay = db.layNguonDon();
    // 1 mã nằm ở nhiều dòng: gộp DUONG_DAN_URL mọi dòng rồi mới so — so từng dòng thì giá trị "đã thấy" nhảy qua lại giữa các
    // dòng, lượt quét nào cũng coi là đổi. Mã chỉ 1 dòng: giá trị y như trước (không làm mọi đơn bị coi là đổi sau khi sửa).
    const theoMa = new Map();
    for (const r of rows) {
      const sttKey = String(r.STT_Key || '').trim();
      if (!sttKey) continue;
      if (!theoMa.has(sttKey)) theoMa.set(sttKey, []);
      theoMa.get(sttKey).push(String(r.DUONG_DAN_URL || '').trim());
    }
    const dsViec = [], dsNguon = [];
    for (const [sttKey, cacO] of theoMa) {
      const giaTri = cacO.filter(Boolean).join('\n');
      if (daThay.get(sttKey) === giaTri) continue;
      for (const url of new Set(xuLy.tachLink(giaTri).filter(xuLy.laLink))) dsViec.push({ sttKey, url, nguon: 'SHEET', uuTien: xuLy.uuTienCuaLink(url) });
      dsNguon.push({ sttKey, giaTri });
    }
    // Việc vào hàng chờ TRƯỚC, ghi "đã thấy" SAU: đứt giữa chừng thì lần sau quét lại (thêm việc là INSERT OR IGNORE — không trùng).
    let soViecMoi = 0;
    for (let i = 0; i < dsViec.length; i += SO_DONG_MOI_DOT) { soViecMoi += db.themNhieuViec(dsViec.slice(i, i + SO_DONG_MOI_DOT)); await nhaLuong(); }
    for (let i = 0; i < dsNguon.length; i += SO_DONG_MOI_DOT) { db.ghiNguonDon(dsNguon.slice(i, i + SO_DONG_MOI_DOT)); await nhaLuong(); }
    kq = { luc: thoiGianVNISOString(), bamTay, soDon: rows.length, soDonDoi: dsNguon.length, soLink: dsViec.length, soViecMoi, ms: Date.now() - batDau };
    if (soViecMoi || dsNguon.length) console.log(`[ThuVien] Quét Sheet: ${rows.length} đơn, ${dsNguon.length} đơn đổi DUONG_DAN_URL, ${soViecMoi} link mới vào hàng chờ (${kq.ms}ms).`);
    if (soViecMoi) xuLy.chayMotLuot().catch(err => console.error('[ThuVien] Vòng xử lý lỗi:', err.message));
  } catch (err) {
    console.error('[ThuVien] Quét Sheet lỗi:', err.message);
    kq = { luc: thoiGianVNISOString(), bamTay, loi: err.message, ms: Date.now() - batDau };
  } finally {
    dangChay = false;
  }
  db.datCaiDat(KHOA_LAN_QUET, JSON.stringify(kq));
  return kq;
}

function batDauLichQuetSheet() {
  cron.schedule('*/10 * * * *', () => { quetSheet().catch(err => console.error('[ThuVien] Quét Sheet lỗi:', err.message)); });
  console.log(`[ThuVien] Lịch quét DUONG_DAN_URL mỗi 10 phút — đang ${dangBat() ? 'BẬT' : 'TẮT'} (bật/tắt ở menu Tìm ảnh).`);
}

module.exports = { quetSheet, batDauLichQuetSheet, dangBat, dangQuet, datBat, layLanQuet };
