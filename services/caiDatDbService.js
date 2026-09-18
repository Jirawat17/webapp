const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// ============================================================
// 2 tab Sheet dạng CẤU HÌNH (đúng 1 dòng duy nhất, KHÔNG tăng trưởng theo thời gian) chuyển sang
// SQLite — bổ sung 19/09/2026, theo yêu cầu người dùng, Giai đoạn 2/3, xem
// docs/superpowers/specs/2026-09-19-cai-dat-sqlite-design.md. KHÁC Giai đoạn 1 (3 tab log, bắt đầu
// trắng) — đây là dữ liệu ĐANG SỐNG (ngưỡng gộp ảnh đang dùng, tài khoản/cấu hình GKE đang chạy thật)
// nên BẮT BUỘC phải migrate giá trị hiện có (xem scripts/migrate-cai-dat-tu-sheets.js), không thể bắt
// đầu trắng như 3 tab log.
//
// Mỗi bảng CHỈ ĐÚNG 1 DÒNG — ép bằng PRIMARY KEY cố định id=1 (CHECK id=1), UPSERT theo id thay vì tìm
// dòng như Sheets cũ (readTab rồi kiểm tra rows[0] có tồn tại không).
const DUONG_DAN_DB = process.env.CAI_DAT_DB_PATH || path.join(__dirname, '..', 'data', 'cai_dat.db');

fs.mkdirSync(path.dirname(DUONG_DAN_DB), { recursive: true });

const db = new Database(DUONG_DAN_DB);
db.pragma('journal_mode = WAL');

// ---------- CaiDatHangLoat — ngưỡng Hamming cho gợi ý gộp "Đơn hàng loạt" ----------
db.exec(`CREATE TABLE IF NOT EXISTS cai_dat_hang_loat (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  NGUONG_HAMMING TEXT NOT NULL DEFAULT ''
)`);

function layCaiDatHangLoat() {
  return db.prepare(`SELECT NGUONG_HAMMING FROM cai_dat_hang_loat WHERE id = 1`).get();
}
function datCaiDatHangLoat(nguongHamming) {
  db.prepare(`
    INSERT INTO cai_dat_hang_loat (id, NGUONG_HAMMING) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET NGUONG_HAMMING = excluded.NGUONG_HAMMING
  `).run(String(nguongHamming));
}

// ---------- CauHinhTracking — bật/tắt tự động mua tracking + toàn bộ cấu hình GKE ----------
// Gộp CHUNG 1 bảng (đúng như Sheets cũ gộp chung 1 tab/1 dòng) — trackingAutoService.js#layCauHinh/
// luuCauHinh chỉ đụng BatTuDongMuaTracking/SoPhutCho; gkeService.js#layCauHinhGke/luuCauHinhGke chỉ
// đụng 14 cột Gke* — 2 nơi ghi ĐỘC LẬP lên CÙNG 1 dòng, giữ nguyên qua UPSERT ghi 1 phần (giống
// trangThaiDbService.js#ghiDe), không phải nơi nào ghi cũng phải biết đủ mọi cột.
const CAC_COT_CAU_HINH_TRACKING = [
  'BatTuDongMuaTracking', 'SoPhutCho',
  'GkeUsername', 'GkePassword', 'GkeServiceCode', 'GkeShipperName', 'GkeShipperPhone',
  'GkeShipperAddress', 'GkeShipperCity', 'GkeShipperProvince', 'GkeShipperPostcode',
  'GkeCustomsItemName', 'GkeCustomsHsCode', 'GkeCustomsDeclaredPrice', 'GkeCustomsCurrency',
  'CanNangMoiAoKg',
];
db.exec(`CREATE TABLE IF NOT EXISTS cau_hinh_tracking (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ${CAC_COT_CAU_HINH_TRACKING.map(c => `${c} TEXT NOT NULL DEFAULT ''`).join(',\n  ')}
)`);

function layCauHinhTracking() {
  return db.prepare(`SELECT ${CAC_COT_CAU_HINH_TRACKING.join(', ')} FROM cau_hinh_tracking WHERE id = 1`).get();
}
function datCauHinhTracking(updates) {
  const cot = Object.keys(updates).filter(c => CAC_COT_CAU_HINH_TRACKING.includes(c));
  if (cot.length === 0) return;
  const giaTri = cot.map(c => (updates[c] === undefined || updates[c] === null) ? '' : String(updates[c]));
  db.prepare(`
    INSERT INTO cau_hinh_tracking (id, ${cot.join(', ')}) VALUES (1, ${cot.map(() => '?').join(', ')})
    ON CONFLICT(id) DO UPDATE SET ${cot.map(c => `${c} = excluded.${c}`).join(', ')}
  `).run(...giaTri);
}

module.exports = {
  layCaiDatHangLoat, datCaiDatHangLoat,
  layCauHinhTracking, datCauHinhTracking, CAC_COT_CAU_HINH_TRACKING,
};
