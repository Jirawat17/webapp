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
  // SoPhutQuetTrangThai (bổ sung 21/09/2026, theo yêu cầu người dùng — cho chỉnh khoảng cách quét
  // trạng thái tracking thật trên giao diện, theo giờ+phút cộng dồn, cùng khuôn SoPhutCho ở trên) +
  // ThoiDiemQuetTrangThaiGanNhat (bookkeeping NỘI BỘ của job, KHÔNG hiện trên form cấu hình — xem
  // services/trackingAutoService.js#chayQuetTrangThaiNeuDenLuot) — dùng CHUNG 1 dòng/1 bảng cho gọn,
  // đúng tinh thần "cau_hinh_tracking gộp mọi thứ liên quan tới tracking" đã có sẵn.
  'SoPhutQuetTrangThai', 'ThoiDiemQuetTrangThaiGanNhat',
];
db.exec(`CREATE TABLE IF NOT EXISTS cau_hinh_tracking (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ${CAC_COT_CAU_HINH_TRACKING.map(c => `${c} TEXT NOT NULL DEFAULT ''`).join(',\n  ')}
)`);

// Tự thêm cột MỚI vào bảng ĐÃ TỒN TẠI (bổ sung 21/09/2026, cùng lý do/khuôn với
// trangThaiDbService.js#CAC_COT — CREATE TABLE IF NOT EXISTS ở trên là NO-OP nếu bảng đã tồn tại từ
// trước, KHÔNG tự thêm cột mới. Thiếu bước này, thêm SoPhutQuetTrangThai/ThoiDiemQuetTrangThaiGanNhat
// vào mảng trên mà chưa xoá+tạo lại DB thật trên VPS sẽ khiến layCauHinhTracking() lỗi "no such column"
// ngay khi deploy — hỏng LUÔN CẢ cấu hình GKE hiện có (username/password...) vì SELECT chung 1 câu.
const cacCotCauHinhTrackingHienCo = new Set(db.prepare(`PRAGMA table_info(cau_hinh_tracking)`).all().map(c => c.name));
for (const cot of CAC_COT_CAU_HINH_TRACKING) {
  if (!cacCotCauHinhTrackingHienCo.has(cot)) {
    db.exec(`ALTER TABLE cau_hinh_tracking ADD COLUMN ${cot} TEXT NOT NULL DEFAULT ''`);
  }
}

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

// ---------- CaiDatCanhBao — ngưỡng số ngày cho 3 mức cảnh báo (Vàng/Cam/Đỏ) ----------
// Bổ sung 23/09/2026, theo yêu cầu người dùng, xem services/alertService.js#tinhMucCanhBao — trước đây
// hard-code 3/5/7, giờ superadmin chỉnh được ở settings.html. Rỗng ('') = chưa cấu hình → dùng đúng mặc
// định 3/5/7 cũ (xem tinhMucCanhBao), KHÔNG đổi hành vi hiện có cho tới khi superadmin chủ động lưu.
db.exec(`CREATE TABLE IF NOT EXISTS cai_dat_canh_bao (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  NGUONG_VANG TEXT NOT NULL DEFAULT '',
  NGUONG_CAM TEXT NOT NULL DEFAULT '',
  NGUONG_DO TEXT NOT NULL DEFAULT ''
)`);

function layCaiDatCanhBao() {
  return db.prepare(`SELECT NGUONG_VANG, NGUONG_CAM, NGUONG_DO FROM cai_dat_canh_bao WHERE id = 1`).get()
    || { NGUONG_VANG: '', NGUONG_CAM: '', NGUONG_DO: '' };
}
function datCaiDatCanhBao({ NGUONG_VANG, NGUONG_CAM, NGUONG_DO }) {
  db.prepare(`
    INSERT INTO cai_dat_canh_bao (id, NGUONG_VANG, NGUONG_CAM, NGUONG_DO) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET NGUONG_VANG = excluded.NGUONG_VANG, NGUONG_CAM = excluded.NGUONG_CAM, NGUONG_DO = excluded.NGUONG_DO
  `).run(String(NGUONG_VANG), String(NGUONG_CAM), String(NGUONG_DO));
}

// ---------- CaiDatNenAnh — chất lượng nén JPEG + cạnh dài tối đa, riêng cho 2 chế độ chụp ảnh ở
// scan.html (Chụp ảnh đã sản xuất / Chụp ảnh ĐÃ DÁN TEM) ----------
// Bổ sung 23/09/2026, theo yêu cầu người dùng, xem public/js/api.js#nenAnhTruocKhiTaiLen — trước đây
// hard-code 0.8/1600px cho MỌI nơi gọi (kể cả order.html). Rỗng = chưa cấu hình → dùng đúng mặc định
// 80%/1600px cũ. order.html KHÔNG đọc bảng này, không bị ảnh hưởng khi superadmin đổi giá trị.
db.exec(`CREATE TABLE IF NOT EXISTS cai_dat_nen_anh (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ChatLuongJpeg TEXT NOT NULL DEFAULT '',
  CanhDaiToiDa TEXT NOT NULL DEFAULT ''
)`);

function layCaiDatNenAnh() {
  return db.prepare(`SELECT ChatLuongJpeg, CanhDaiToiDa FROM cai_dat_nen_anh WHERE id = 1`).get()
    || { ChatLuongJpeg: '', CanhDaiToiDa: '' };
}
function datCaiDatNenAnh({ ChatLuongJpeg, CanhDaiToiDa }) {
  db.prepare(`
    INSERT INTO cai_dat_nen_anh (id, ChatLuongJpeg, CanhDaiToiDa) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET ChatLuongJpeg = excluded.ChatLuongJpeg, CanhDaiToiDa = excluded.CanhDaiToiDa
  `).run(String(ChatLuongJpeg), String(CanhDaiToiDa));
}

// ---------- CaiDatMauXuong — màu nền thẻ đơn theo Xưởng (bổ sung 23/09/2026, theo yêu cầu người dùng —
// "mỗi Xưởng có thể có màu riêng để dễ phân biệt các đơn thuộc các xưởng khác nhau"). KHÁC 3 bảng trên
// (đúng 1 dòng cố định) — đây là bảng nhiều dòng, 1 dòng/1 giá trị Xưởng (khớp orderService.js#
// DANH_SACH_XUONG, có thể thêm/bớt Xưởng mà không cần đổi schema). Trước đây 2 màu HN/BN hard-code
// trong style.css (.order-card.xuong-hn/xuong-bn) — giờ superadmin tự chọn qua settings.html, KHÔNG
// còn giới hạn đúng 2 màu cố định.
db.exec(`CREATE TABLE IF NOT EXISTS cai_dat_mau_xuong (
  Xuong TEXT PRIMARY KEY,
  Mau TEXT NOT NULL DEFAULT ''
)`);

function layMauTheoXuong() {
  const rows = db.prepare(`SELECT Xuong, Mau FROM cai_dat_mau_xuong`).all();
  return Object.fromEntries(rows.map(r => [r.Xuong, r.Mau]));
}
function datMauXuong(xuong, mau) {
  db.prepare(`
    INSERT INTO cai_dat_mau_xuong (Xuong, Mau) VALUES (?, ?)
    ON CONFLICT(Xuong) DO UPDATE SET Mau = excluded.Mau
  `).run(xuong, mau);
}

// ---------- DanhSachXuong — danh sách CÁC Xưởng (bổ sung 24/09/2026, theo yêu cầu người dùng) — trước
// đây DANH_SACH_XUONG cố định trong code (services/orderService.js), lặp lại thủ công ở 2 nơi khác
// (public/orders.html, public/users.html, mỗi nơi tự ghi chú "PHẢI khớp") — giờ quản lý được qua
// Settings (thêm/đổi tên/xoá, xem routes/orders.js POST|PUT|DELETE /xuong). Seed sẵn 3 giá trị CŨ nếu
// bảng còn trống — deploy lần đầu không mất khả năng gán những giá trị đơn/nhân viên hiện có đang mang.
// "ChuaGanXuong" giờ là 1 Xưởng BÌNH THƯỜNG trong danh sách này (đổi tên/xoá/chọn màu được như mọi
// Xưởng khác, theo yêu cầu người dùng) — KHÁC hẳn trạng thái "(chưa gán)" THẬT (XUONG rỗng), vốn KHÔNG
// nằm trong danh sách này và luôn giữ nền mặc định (xem public/js/api.js#lopVaStyleXuong).
db.exec(`CREATE TABLE IF NOT EXISTS danh_sach_xuong (
  Ten TEXT PRIMARY KEY
)`);
if (db.prepare(`SELECT COUNT(*) AS c FROM danh_sach_xuong`).get().c === 0) {
  const cauChen = db.prepare(`INSERT INTO danh_sach_xuong (Ten) VALUES (?)`);
  ['HN', 'BN', 'ChuaGanXuong'].forEach(ten => cauChen.run(ten));
}

// KHÔNG ORDER BY theo chữ cái — giữ thứ tự chèn (rowid) để Xưởng mới tạo luôn nối cuối danh sách,
// không nhảy lung tung giữa các Xưởng cũ mỗi khi thêm 1 Xưởng mới.
function layDanhSachXuong() {
  return db.prepare(`SELECT Ten FROM danh_sach_xuong ORDER BY rowid`).all().map(r => r.Ten);
}
// Nơi gọi (routes/orders.js) tự kiểm tra trùng tên/rỗng trước khi gọi — hàm này không tự validate lại,
// cùng quy ước các hàm ghi khác trong file này (themMoi() của taiKhoanService.js cũng vậy).
function themXuong(ten) {
  db.prepare(`INSERT INTO danh_sach_xuong (Ten) VALUES (?)`).run(ten);
}
// Xoá luôn màu đã cấu hình cho Xưởng này (nếu có) — tránh để lại dòng mồ côi trong cai_dat_mau_xuong
// không còn Xưởng nào tham chiếu tới. Nơi gọi tự kiểm tra KHÔNG còn đơn/nhân viên nào đang gán Xưởng
// này trước khi gọi hàm này (xem routes/orders.js DELETE /xuong/:ten).
function xoaXuong(ten) {
  db.prepare(`DELETE FROM danh_sach_xuong WHERE Ten = ?`).run(ten);
  db.prepare(`DELETE FROM cai_dat_mau_xuong WHERE Xuong = ?`).run(ten);
}
// Đổi tên CẢ Ở ĐÂY lẫn màu đã gán (giữ màu gắn liền với đúng Xưởng, không "mất màu" khi đổi tên) —
// nơi gọi (routes/orders.js) chịu trách nhiệm cascade sang trang_thai_don.XUONG/nguoi_dung.Xuong
// (2 file DB SQLite khác, tách biệt khỏi file cai_dat.db này).
function doiTenXuong(tenCu, tenMoi) {
  db.prepare(`UPDATE danh_sach_xuong SET Ten = ? WHERE Ten = ?`).run(tenMoi, tenCu);
  db.prepare(`UPDATE cai_dat_mau_xuong SET Xuong = ? WHERE Xuong = ?`).run(tenMoi, tenCu);
}

module.exports = {
  layCaiDatHangLoat, datCaiDatHangLoat,
  layCauHinhTracking, datCauHinhTracking, CAC_COT_CAU_HINH_TRACKING,
  layCaiDatCanhBao, datCaiDatCanhBao,
  layCaiDatNenAnh, datCaiDatNenAnh,
  layMauTheoXuong, datMauXuong,
  layDanhSachXuong, themXuong, xoaXuong, doiTenXuong,
};
