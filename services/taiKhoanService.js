const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// ============================================================
// Quản lý TOÀN BỘ tài khoản (nhân viên) qua SQLite thay vì Google Sheets (tab NguoiDung) — bổ sung
// 18/09/2026, theo yêu cầu người dùng: không cần mở Sheet để quản lý tài khoản nữa, mọi thông tin lấy
// từ đây. Cùng khuôn `services/trangThaiDbService.js` (bảng riêng, tự tạo schema lúc khởi động, UPSERT
// theo khoá — ở đây khoá là Ten, đúng cách routes/users.js/routes/auth.js đã dùng Ten làm định danh
// DUY NHẤT từ trước, xem docs/superpowers/specs/2026-09-18-tai-khoan-sqlite-design.md).
//
// Đặt RIÊNG file .db khác trang_thai_don.db (khác hẳn mối quan tâm — tài khoản/đăng nhập, không phải
// trạng thái đơn hàng) — cùng nằm trong thư mục data/ đã được mount volume sẵn (docker-compose.yml),
// không cần đổi gì thêm ở hạ tầng.
const DUONG_DAN_DB = process.env.TAI_KHOAN_DB_PATH || path.join(__dirname, '..', 'data', 'tai_khoan.db');

fs.mkdirSync(path.dirname(DUONG_DAN_DB), { recursive: true });

const db = new Database(DUONG_DAN_DB);
db.pragma('journal_mode = WAL');

db.exec(`CREATE TABLE IF NOT EXISTS nguoi_dung (
  Ten TEXT PRIMARY KEY,
  VaiTro TEXT NOT NULL DEFAULT '',
  Team TEXT NOT NULL DEFAULT '',
  Xuong TEXT NOT NULL DEFAULT '',
  KichHoat TEXT NOT NULL DEFAULT '',
  MatKhau TEXT NOT NULL DEFAULT '',
  HienThiDangNhap TEXT NOT NULL DEFAULT ''
)`);

// Team KHÔNG còn ở đây nữa (bổ sung 23/09/2026, theo yêu cầu người dùng — không dùng dữ liệu này nữa,
// xem routes/reports.js đã bỏ luôn phần gom nhóm "Theo Team"). Cột Team vẫn còn trong CREATE TABLE ở
// trên (dữ liệu cũ nếu có không bị mất) nhưng không đọc/ghi qua CAC_COT nữa — ALTER TABLE DROP COLUMN
// không cần thiết, chỉ thêm rủi ro cho lợi ích không đáng.
const CAC_COT = ['VaiTro', 'Xuong', 'KichHoat', 'MatKhau', 'HienThiDangNhap'];
const DS_COT_SELECT = ['Ten', ...CAC_COT].join(', ');

// CHƯA migrate dữ liệu cũ lúc app khởi động (khác trangThaiDbService — ở đó "trắng trạng thái" chấp
// nhận được, ở ĐÂY KHÔNG: bảng trắng = KHÔNG ai đăng nhập được). Cảnh báo TO, KHÓ BỎ SÓT ngay khi có
// ai thử đọc bảng lúc còn trống — xem cảnhBaoNeuChuaMigrate() bên dưới, gọi 1 lần lúc server khởi
// động (server.js) VÀ mỗi lần layTatCa() thấy bảng vẫn trống (phòng trường hợp không xem log lúc
// khởi động). Cách migrate: chạy `node scripts/migrate-nguoi-dung-tu-sheets.js --apply` MỘT LẦN sau khi
// deploy bản này, TRƯỚC khi ai cần đăng nhập lại — xem script đó để biết chi tiết.
function canhBaoNeuChuaMigrate() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM nguoi_dung').get();
  if (c > 0) return;
  console.error('='.repeat(78));
  console.error('[TaiKhoanService] CẢNH BÁO: Bảng tài khoản SQLite (nguoi_dung) đang TRỐNG.');
  console.error('KHÔNG AI đăng nhập được cho tới khi chạy migrate 1 lần từ Google Sheets:');
  console.error('  node scripts/migrate-nguoi-dung-tu-sheets.js --apply');
  console.error('(Chạy KHÔNG có --apply trước để xem trước danh sách sẽ migrate.)');
  console.error('='.repeat(78));
}
canhBaoNeuChuaMigrate();

// KHÔNG ORDER BY — giữ thứ tự chèn (rowid ngầm định, gần giống thứ tự thêm dòng cũ trong Sheets) thay
// vì sắp chữ, tránh đổi bất ngờ thứ tự hiển thị ở bảng Quản lý nhân viên (public/users.html) so với
// trước khi chuyển sang SQLite.
const cauLayTatCa = db.prepare(`SELECT ${DS_COT_SELECT} FROM nguoi_dung`);
function layTatCa() {
  canhBaoNeuChuaMigrate();
  return cauLayTatCa.all();
}

const cauLayTheoTen = db.prepare(`SELECT ${DS_COT_SELECT} FROM nguoi_dung WHERE Ten = ?`);
function layTheoTen(ten) {
  return cauLayTheoTen.get(String(ten)) || null;
}

// Thêm tài khoản MỚI — throw nếu Ten đã tồn tại (giữ đúng hành vi cũ "Tên này đã tồn tại" ở
// routes/users.js, nơi gọi tự kiểm tra qua layTheoTen() trước khi gọi hàm này).
const cauThemMoi = db.prepare(`
  INSERT INTO nguoi_dung (Ten, ${CAC_COT.join(', ')}) VALUES (?, ${CAC_COT.map(() => '?').join(', ')})
`);
function themMoi(taiKhoan) {
  const ten = String(taiKhoan.Ten).trim();
  cauThemMoi.run(ten, ...CAC_COT.map(c => (taiKhoan[c] === undefined || taiKhoan[c] === null) ? '' : String(taiKhoan[c])));
}

// Cập nhật MỘT PHẦN (chỉ cột thực sự có trong `updates`) cho tài khoản ĐÃ TỒN TẠI — nơi gọi
// (routes/users.js PUT /:ten) tự kiểm tra layTheoTen() trước, trả 404 nếu chưa có, nên hàm này không
// cần tự tạo mới nếu thiếu (khác ghiDe() của trangThaiDbService — orderService tạo đơn mới tự do).
function capNhat(ten, updates) {
  const cot = Object.keys(updates).filter(c => CAC_COT.includes(c));
  if (cot.length === 0) return;
  const giaTri = cot.map(c => (updates[c] === undefined || updates[c] === null) ? '' : String(updates[c]));
  db.prepare(`UPDATE nguoi_dung SET ${cot.map(c => `${c} = ?`).join(', ')} WHERE Ten = ?`).run(...giaTri, String(ten));
}

// Đổi Ten (khoá chính) — nơi gọi tự kiểm tra tên mới chưa trùng ai trước khi gọi hàm này.
// ponytail: KHÔNG cascade sang các chỗ khác đang lưu Ten dạng chuỗi tự do (NguoiVanHanh/NguoiVeFile/
// NguoiChayMay trên đơn, NguoiDung trong log...) — các bản ghi CŨ vẫn hiện tên cũ, chỉ đăng nhập/bảng
// nhân viên theo tên mới. Nâng cấp nếu cần: cập nhật hàng loạt các cột đó khi đổi tên.
function doiTen(tenCu, tenMoi) {
  db.prepare(`UPDATE nguoi_dung SET Ten = ? WHERE Ten = ?`).run(String(tenMoi).trim(), String(tenCu));
}

module.exports = { CAC_COT, layTatCa, layTheoTen, themMoi, capNhat, doiTen };
