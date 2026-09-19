const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// ============================================================
// "Kịch bản" quét QR (CauHinhKichBan) chuyển từ Google Sheets sang SQLite — bổ sung 19/09/2026, theo
// yêu cầu người dùng, xem docs/superpowers/specs/2026-09-19-kich-ban-sqlite-design.md.
//
// KHÁC 3 tab đã chuyển trước đó (nhật ký/cấu hình đơn dòng/Đơn hàng loạt) — tab này trước giờ được
// quản lý HOÀN TOÀN bằng cách sửa tay trong Google Sheet (không có trang web nào để thêm/sửa). Người
// dùng chọn xây hẳn 1 trang quản lý mới trong app (routes/kichBan.js, public/kich-ban.html) thay cho
// việc sửa Sheet — bảng này vì vậy có schema CRUD thật (id tự tăng, Ten_Kich_Ban là khoá DUY NHẤT để
// khớp đúng cách slugHoa() ở services/scenarioService.js đang định danh 1 kịch bản theo tên).
const DUONG_DAN_DB = process.env.KICH_BAN_DB_PATH || path.join(__dirname, '..', 'data', 'kich_ban.db');

fs.mkdirSync(path.dirname(DUONG_DAN_DB), { recursive: true });

const db = new Database(DUONG_DAN_DB);
db.pragma('journal_mode = WAL');

db.exec(`CREATE TABLE IF NOT EXISTS cau_hinh_kich_ban (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  Ten_Kich_Ban TEXT NOT NULL UNIQUE,
  Trang_Thai_Yeu_Cau TEXT NOT NULL DEFAULT '',
  Trang_Thai_Sau TEXT NOT NULL DEFAULT '',
  Cot TEXT NOT NULL DEFAULT '',
  Nguoi_Thuc_Hien TEXT NOT NULL DEFAULT ''
)`);

const CAC_COT = ['Ten_Kich_Ban', 'Trang_Thai_Yeu_Cau', 'Trang_Thai_Sau', 'Cot', 'Nguoi_Thuc_Hien'];

function layTatCa() {
  return db.prepare(`SELECT id, ${CAC_COT.join(', ')} FROM cau_hinh_kich_ban ORDER BY id`).all();
}

function layTheoId(id) {
  return db.prepare(`SELECT id, ${CAC_COT.join(', ')} FROM cau_hinh_kich_ban WHERE id = ?`).get(id);
}

function layTheoTen(tenKichBan) {
  return db.prepare(`SELECT id, ${CAC_COT.join(', ')} FROM cau_hinh_kich_ban WHERE Ten_Kich_Ban = ?`).get(tenKichBan);
}

// throw lỗi SQLite thô (UNIQUE constraint) nếu trùng Ten_Kich_Ban — nơi gọi (routes/kichBan.js) tự bắt
// và dịch thành thông báo thân thiện.
function themMoi(dong) {
  const ketQua = db.prepare(`
    INSERT INTO cau_hinh_kich_ban (${CAC_COT.join(', ')}) VALUES (${CAC_COT.map(c => '@' + c).join(', ')})
  `).run(dong);
  return ketQua.lastInsertRowid;
}

function capNhat(id, updates) {
  const cot = Object.keys(updates).filter(c => CAC_COT.includes(c));
  if (cot.length === 0) return;
  const giaTri = cot.map(c => (updates[c] === undefined || updates[c] === null) ? '' : String(updates[c]));
  db.prepare(`UPDATE cau_hinh_kich_ban SET ${cot.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...giaTri, id);
}

function xoa(id) {
  db.prepare(`DELETE FROM cau_hinh_kich_ban WHERE id = ?`).run(id);
}

module.exports = { layTatCa, layTheoId, layTheoTen, themMoi, capNhat, xoa };
