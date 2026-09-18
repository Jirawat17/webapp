const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// ============================================================
// Lưu các cột APP TỰ GHI của Don_Hang_ALL (trạng thái, hash ảnh, nhóm hàng loạt, tracking...) — TÁCH
// KHỎI Google Sheets, ghi theo SQLite bằng SQLite thay vì số dòng vật lý (bổ sung 18/09/2026, xem
// docs/superpowers/specs/2026-09-18-chuyen-cot-app-ghi-sang-sqlite-design.md).
//
// ROOT CAUSE (đã xác nhận với người dùng — xem
// docs/superpowers/specs/2026-09-17-sua-loi-ghi-lech-dong-vstack-design.md): cột "gốc" của Don_Hang_ALL
// (STT_Key, tên khách, link ảnh...) là công thức QUERY(VSTACK(...)) SỐNG, ghép từ ~19 sheet con — vị
// trí DÒNG VẬT LÝ của 1 đơn có thể đổi bất cứ lúc nào công thức tính lại, kể cả không ai đụng trực tiếp
// vào Don_Hang_ALL. Trước đây các cột app tự ghi (TRANG_THAI_XUONG, HASH_ANH_MAU...) là cột TĨNH nằm
// CHUNG sheet đó — dù app ghi ĐÚNG dòng tại thời điểm ghi (đã sửa 17/09/2026), dữ liệu ĐÃ ghi đúng vẫn
// có thể bị "lạc chủ" SAU ĐÓ nếu dòng xáo trộn (Sheets không có khái niệm "ô này thuộc đơn nào", chỉ có
// số dòng vật lý). Chuyển hẳn sang SQLite, ghi theo KHOÁ (stt_key) — không còn khái niệm "dòng vật lý"
// nên xoá được toàn bộ lớp rủi ro này, không chỉ tại thời điểm ghi mà cả VỀ SAU.
//
// Toàn bộ cột dưới đây đã xác nhận với người dùng là CHỈ app ghi — không cột nào nằm trong vùng công
// thức sống (A:AM của Don_Hang_ALL sau khi người dùng cấu trúc lại Sheet 18/09/2026). DUONG_DAN_URL/
// MOCKUP KHÔNG có trong danh sách này dù trước đây app có ghi (routes/photos.js mốc 'mau'/'mockup') —
// 2 mốc đó đã bị xoá hẳn (người dùng chọn: 2 ảnh này từ giờ CHỈ nhập tay ở sheet RAW lúc lên đơn, app
// chỉ đọc không ghi nữa).
const CAC_COT = [
  'TRANG_THAI_PHOI', 'TRANG_THAI_VE_FILE', 'QUOC_GIA', 'MA_CODE_STT', 'MA_KHACH_HANG', 'NGUOI_VAN_HANH',
  'Anh_File_Theu_URL', 'Anh_Da_San_Xuat_URL', 'TRONG_LUONG', 'TRANG_THAI_XUONG', 'Anh_Da_Dan_Tem_URL',
  'NGUOI_VE_FILE', 'GHI_CHU_VE_FILE', 'NGUOI_CHAY_MAY', 'GHI_CHU_CHAY_MAY', 'HASH_ANH_MAU', 'NHOM_HANG_LOAT',
  'AUTO_TRACKING', 'THOI_GIAN_IN_MA', 'IN_LABEL', 'THOI_GIAN_IN_LABEL', 'DON_UU_TIEN', 'TAM_THOI',
  'HANG_VAN_CHUYEN', 'TRACKING_ID', 'TRANG_THAI_TRACKING', 'THOI_GIAN_CAP_NHAT_TRACKING', 'KHACH_HANG',
  'XUONG', 'NguoiCapNhatCuoi', 'ThoiGianCapNhatCuoi',
  // CanhBaoDaGui: không nằm trong danh sách 31 cột người dùng liệt kê (có thể chỉ là sót khi liệt kê) —
  // nhưng rà code xác nhận đây CŨNG là cột app tự ghi (services/canhBaoJob.js, cờ chống spam Telegram),
  // không thuộc RAW/A:AM lẫn AN:BR người dùng mô tả. Xếp vào đây theo đúng tiêu chí "app tự ghi" đã
  // thống nhất — nếu không đúng ý người dùng, dễ dàng bỏ khỏi danh sách này sau.
  'CanhBaoDaGui',
];

const DUONG_DAN_DB = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'data', 'trang_thai_don.db');

fs.mkdirSync(path.dirname(DUONG_DAN_DB), { recursive: true });

const db = new Database(DUONG_DAN_DB);
db.pragma('journal_mode = WAL');

db.exec(`CREATE TABLE IF NOT EXISTS trang_thai_don (
  stt_key TEXT PRIMARY KEY,
  ${CAC_COT.map(c => `${c} TEXT NOT NULL DEFAULT ''`).join(',\n  ')}
)`);

// Object rỗng mặc định cho STT_Key chưa từng có dòng nào trong DB (đơn mới) — TRẢ VỀ DẠNG GIỐNG HỆT 1
// dòng SQLite thật (mọi cột = '') để nơi gọi (orderService.js#getAll) gộp vào row Sheets mà không cần
// phân biệt "có/chưa có trong DB" — đúng hành vi hiện tại của Sheets (ô trống = '', không phải undefined).
const RONG_MAC_DINH = Object.freeze(Object.fromEntries(CAC_COT.map(c => [c, ''])));

function chuanHoaKey(sttKey) {
  return String(sttKey).trim();
}

// CHỈ SELECT đúng CAC_COT (không SELECT *) — tránh lẫn cột khoá kỹ thuật `stt_key` (chữ thường) vào
// object trả về, nơi gọi (orderService.js) gộp thẳng object này vào row Sheets nên không được lẫn field lạ.
const DS_COT_SELECT = CAC_COT.join(', ');

const cauLayTheoKey = db.prepare(`SELECT ${DS_COT_SELECT} FROM trang_thai_don WHERE stt_key = ?`);
function layTheoKey(sttKey) {
  const row = cauLayTheoKey.get(chuanHoaKey(sttKey));
  return row ? { ...RONG_MAC_DINH, ...row } : { ...RONG_MAC_DINH };
}

// Toàn bộ dòng trong DB, kèm stt_key riêng để làm khoá Map — dùng cho orderService.js#getAll() gộp vào
// TOÀN BỘ Don_Hang_ALL đọc từ Sheets. Đọc cả bảng mỗi lần gọi (không lọc theo danh sách key) — SQLite
// đọc vài trăm nghìn dòng ngắn vẫn ở mức mili-giây, không đáng lo ở quy mô đơn hàng của 1 xưởng.
const cauLayTatCa = db.prepare(`SELECT stt_key, ${DS_COT_SELECT} FROM trang_thai_don`);
function layTatCa() {
  const ketQua = new Map();
  for (const { stt_key, ...conLai } of cauLayTatCa.iterate()) ketQua.set(stt_key, conLai);
  return ketQua;
}

// Ghi đè MỘT PHẦN (chỉ các cột thực sự có trong `updates`, đúng ngữ nghĩa updateCells cũ) — UPSERT
// theo stt_key, không quan tâm dòng đã tồn tại trong DB hay chưa (đơn mới tự động INSERT).
function ghiDe(sttKey, updates) {
  const key = chuanHoaKey(sttKey);
  const cot = Object.keys(updates).filter(c => CAC_COT.includes(c));
  if (cot.length === 0) return; // updates chỉ đụng cột KHÔNG thuộc bảng này (vd cột RAW) — không có gì để ghi ở đây

  const giaTri = cot.map(c => (updates[c] === undefined || updates[c] === null) ? '' : String(updates[c]));
  db.prepare(`
    INSERT INTO trang_thai_don (stt_key, ${cot.join(', ')})
    VALUES (?, ${cot.map(() => '?').join(', ')})
    ON CONFLICT(stt_key) DO UPDATE SET ${cot.map(c => `${c} = excluded.${c}`).join(', ')}
  `).run(key, ...giaTri);
}

module.exports = { CAC_COT, RONG_MAC_DINH, layTheoKey, layTatCa, ghiDe };
