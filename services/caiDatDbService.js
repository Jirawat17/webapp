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
// luuCauHinh chỉ đụng BatTuDongMuaTracking/SoPhutCho; 14 cột Gke* bên dưới là cấu hình GKE CŨ (từ 27/09/2026 chỉ còn đọc 1 lần để chuyển sang bảng tai_khoan_gke, xem cuối file) — trước đó gkeService.js chỉ
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
  // DaChuyenTaiKhoanGke (bổ sung 27/09/2026) — cờ 'TRUE' sau khi đã chuyển 14 cột Gke* ở trên sang
  // bảng tai_khoan_gke (xem gkeService.js#chuyenCauHinhCuSangTaiKhoan) — 14 cột Gke* giữ nguyên làm bản
  // lưu, KHÔNG còn nơi nào đọc nữa.
  'DaChuyenTaiKhoanGke',
  // SoGioSauInMa (30/09/2026, theo yêu cầu người dùng) — tự mua thêm khi đơn đã "Đã in mã" đủ X giờ (mặc định 48,
  // xem trackingAutoService.js#thoiDiemDenHan). MocApDungTheoInMa — lần khởi động ĐẦU TIÊN có tính năng này (ghi
  // bên dưới): CHỈ đơn chuyển "Đã in mã" từ mốc này trở đi mới áp dụng, đơn in mã trước đó không bị mua hàng loạt.
  'SoGioSauInMa', 'MocApDungTheoInMa',
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
if (!(layCauHinhTracking() || {}).MocApDungTheoInMa) datCauHinhTracking({ MocApDungTheoInMa: new Date().toISOString() });

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
  db.prepare(`DELETE FROM team_xuong_mac_dinh WHERE Xuong = ?`).run(ten);
}
// Đổi tên CẢ Ở ĐÂY lẫn màu đã gán (giữ màu gắn liền với đúng Xưởng, không "mất màu" khi đổi tên) —
// nơi gọi (routes/orders.js) chịu trách nhiệm cascade sang trang_thai_don.XUONG/nguoi_dung.Xuong
// (2 file DB SQLite khác, tách biệt khỏi file cai_dat.db này).
function doiTenXuong(tenCu, tenMoi) {
  db.prepare(`UPDATE danh_sach_xuong SET Ten = ? WHERE Ten = ?`).run(tenMoi, tenCu);
  db.prepare(`UPDATE cai_dat_mau_xuong SET Xuong = ? WHERE Xuong = ?`).run(tenMoi, tenCu);
  db.prepare(`UPDATE team_xuong_mac_dinh SET Xuong = ? WHERE Xuong = ?`).run(tenMoi, tenCu);
}

// ---------- Team -> Xưởng mặc định (bổ sung 27/09/2026, theo yêu cầu người dùng) ----------
// Team = chữ cái trong STT_Key (9TRA471 / 10TRA5332sdafn -> TRA, xem donNhieuAoService.js#layTeam). Đơn đang "chưa
// gán" (XUONG rỗng) thuộc Team có cấu hình được tự gán lúc đọc — xem orderService.js#tuGanXuongTheoTeam.
// Đổi tên/xoá Xưởng (2 hàm trên) tự mang theo/xoá cấu hình tương ứng.
db.exec(`CREATE TABLE IF NOT EXISTS team_xuong_mac_dinh (
  Team TEXT PRIMARY KEY,
  Xuong TEXT NOT NULL
)`);
// { TEAM: 'Xưởng' }
function layTeamXuongMacDinh() {
  return Object.fromEntries(db.prepare(`SELECT Team, Xuong FROM team_xuong_mac_dinh`).all().map(r => [r.Team, r.Xuong]));
}
// xuong rỗng = bỏ cấu hình của Team đó.
function ganTeamXuongMacDinh(team, xuong) {
  if (!xuong) db.prepare(`DELETE FROM team_xuong_mac_dinh WHERE Team = ?`).run(team);
  else db.prepare(`INSERT INTO team_xuong_mac_dinh (Team, Xuong) VALUES (?, ?) ON CONFLICT(Team) DO UPDATE SET Xuong = excluded.Xuong`).run(team, xuong);
}

// ---------- Tài khoản GKE theo Xưởng (bổ sung 27/09/2026, theo yêu cầu người dùng) ----------
// Mỗi tài khoản đủ 14 trường cấu hình (cùng tên cột Gke* với cau_hinh_tracking cũ). Tài khoản gán cho
// Xưởng lưu ở cột TaiKhoanGke NGAY TRONG danh_sach_xuong — đổi tên/xoá Xưởng (doiTenXuong/xoaXuong ở
// trên) tự mang theo/xoá luôn việc gán, không cần cascade riêng.
const CAC_COT_TAI_KHOAN_GKE = ['Ten', ...CAC_COT_CAU_HINH_TRACKING.filter(c => c.startsWith('Gke') || c === 'CanNangMoiAoKg')];
db.exec(`CREATE TABLE IF NOT EXISTS tai_khoan_gke (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ${CAC_COT_TAI_KHOAN_GKE.map(c => `${c} TEXT NOT NULL DEFAULT ''`).join(', ')}
)`);
if (!db.prepare(`PRAGMA table_info(danh_sach_xuong)`).all().some(c => c.name === 'TaiKhoanGke')) {
  db.exec(`ALTER TABLE danh_sach_xuong ADD COLUMN TaiKhoanGke TEXT NOT NULL DEFAULT ''`);
}

function layDanhSachTaiKhoanGke() {
  return db.prepare(`SELECT id, ${CAC_COT_TAI_KHOAN_GKE.join(', ')} FROM tai_khoan_gke ORDER BY id`).all();
}
function layTaiKhoanGke(id) {
  return db.prepare(`SELECT id, ${CAC_COT_TAI_KHOAN_GKE.join(', ')} FROM tai_khoan_gke WHERE id = ?`).get(Number(id)) || null;
}
function ghiTaiKhoanGke(id, giaTri) {
  const cot = CAC_COT_TAI_KHOAN_GKE.filter(c => giaTri[c] !== undefined);
  const vals = cot.map(c => String(giaTri[c] ?? ''));
  if (id) {
    if (cot.length) db.prepare(`UPDATE tai_khoan_gke SET ${cot.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...vals, Number(id));
    return Number(id);
  }
  return Number(db.prepare(`INSERT INTO tai_khoan_gke (${cot.join(', ')}) VALUES (${cot.map(() => '?').join(', ')})`).run(...vals).lastInsertRowid);
}
function xoaTaiKhoanGke(id) {
  db.prepare(`DELETE FROM tai_khoan_gke WHERE id = ?`).run(Number(id));
}
// { Xuong: 'id tài khoản' } — chỉ các Xưởng đã gán.
function layGanTaiKhoanGke() {
  return Object.fromEntries(db.prepare(`SELECT Ten, TaiKhoanGke FROM danh_sach_xuong WHERE TaiKhoanGke != ''`).all().map(r => [r.Ten, r.TaiKhoanGke]));
}
function ganTaiKhoanGkeChoXuong(xuong, id) {
  db.prepare(`UPDATE danh_sach_xuong SET TaiKhoanGke = ? WHERE Ten = ?`).run(id ? String(id) : '', xuong);
}

// Nhóm hàng theo LOAI (29/09/2026, theo yêu cầu người dùng — sửa ở Settings thay vì trong code): mỗi dòng 1 loại
// (Tshirt, HoodieKID...), Nhom '1' Quần áo / '2' Không phải quần áo, TuKhoa phân cách dấu phẩy. Kiểm tra hợp lệ/trùng
// ở services/nhomHangService.js. Bảng VỪA tạo -> nạp danh sách mặc định (services/nhomHangMacDinh.js) đúng 1 lần, CÙNG
// transaction với lệnh tạo bảng (nạp lỗi = chưa có bảng, lần khởi động sau thử lại). Xoá hết loại sau đó KHÔNG tự nạp
// lại. Danh sách mặc định KHÔNG đặt trong data/: thư mục đó là volume Docker (./data:/app/data) và bị .gitignore.
db.transaction(() => {
  const bangMoi = !db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'nhom_hang_loai'`).get();
  db.exec(`CREATE TABLE IF NOT EXISTS nhom_hang_loai (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    Ten TEXT NOT NULL UNIQUE,
    Nhom TEXT NOT NULL,
    TuKhoa TEXT NOT NULL DEFAULT ''
  )`);
  if (!bangMoi) return;
  for (const [Nhom, dsLoai] of Object.entries(require('./nhomHangMacDinh'))) {
    for (const [Ten, TuKhoa] of Object.entries(dsLoai)) themLoaiHang({ Ten, Nhom, TuKhoa });
  }
})();
function layDanhSachLoaiHang() {
  return db.prepare(`SELECT id, Ten, Nhom, TuKhoa FROM nhom_hang_loai ORDER BY Nhom, id`).all();
}
function themLoaiHang({ Ten, Nhom, TuKhoa }) {
  return Number(db.prepare(`INSERT INTO nhom_hang_loai (Ten, Nhom, TuKhoa) VALUES (?, ?, ?)`).run(Ten, Nhom, TuKhoa).lastInsertRowid);
}
function suaLoaiHang(id, { Ten, Nhom, TuKhoa }) {
  db.prepare(`UPDATE nhom_hang_loai SET Ten = ?, Nhom = ?, TuKhoa = ? WHERE id = ?`).run(Ten, Nhom, TuKhoa, Number(id));
}
function xoaLoaiHang(id) {
  db.prepare(`DELETE FROM nhom_hang_loai WHERE id = ?`).run(Number(id));
}
// Nhóm của đơn có LOAI TRỐNG (30/09/2026, theo yêu cầu người dùng) — '' Chưa phân loại (mặc định) / '1' / '2'.
db.exec(`CREATE TABLE IF NOT EXISTS cai_dat_nhom_hang (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  NhomLoaiTrong TEXT NOT NULL DEFAULT ''
)`);
function layNhomLoaiTrong() {
  return (db.prepare(`SELECT NhomLoaiTrong FROM cai_dat_nhom_hang WHERE id = 1`).get() || {}).NhomLoaiTrong || '';
}
function datNhomLoaiTrong(nhom) {
  db.prepare(`INSERT INTO cai_dat_nhom_hang (id, NhomLoaiTrong) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET NhomLoaiTrong = excluded.NhomLoaiTrong`).run(nhom);
}

// ---------- AI QC (30/09/2026, theo yêu cầu người dùng) — API key + model riêng cho QC1/QC2/QC3 (services/qc/qcService.js) ----------
// Key lưu nguyên văn (cùng cách mật khẩu GKE ở trên, người dùng đã đồng ý); routes/qc.js chỉ trả dạng che ra giao diện.
db.exec(`CREATE TABLE IF NOT EXISTS qc_cau_hinh (
  Loai TEXT PRIMARY KEY,
  ApiKey TEXT NOT NULL DEFAULT '',
  Model TEXT NOT NULL DEFAULT ''
)`);
// Claude (01/10/2026, theo yêu cầu người dùng): mỗi QC chọn NhaCungCap ('gemini' | 'claude'); key/model Gemini giữ ở
// ApiKey/Model cũ, Claude ở ApiKeyClaude/ModelClaude — lưu song song, đổi qua lại không mất key bên kia.
// Ngưỡng kết luận riêng từng QC (01/10/2026): NguongPass / NguongFail (score 0–100) + NguongCcl (độ chắc chắn tối thiểu, %).
// Trống = mặc định trong services/qc/qcService.js#NGUONG_MAC_DINH.
// ApiKeyVertex/ModelVertex (01/10/2026): Gemini qua Agent Platform / Vertex AI — lưu song song như Claude.
// AutoBat ('TRUE'/'') / AutoGio / AutoPhut (02/10/2026): Tự động quét QC riêng từng QC (services/qc/qcAutoService.js).
const COT_QC = ['NhaCungCap', 'ApiKey', 'Model', 'ApiKeyClaude', 'ModelClaude', 'ApiKeyVertex', 'ModelVertex', 'NguongPass', 'NguongFail', 'NguongCcl', 'AutoBat', 'AutoGio', 'AutoPhut'];
const cotQcDaCo = db.prepare(`PRAGMA table_info(qc_cau_hinh)`).all().map(c => c.name);
for (const cot of COT_QC) if (!cotQcDaCo.includes(cot)) db.exec(`ALTER TABLE qc_cau_hinh ADD COLUMN ${cot} TEXT NOT NULL DEFAULT ''`);
// { QC1: { NhaCungCap, ApiKey, Model, ApiKeyClaude, ModelClaude }, ... } — loại chưa lưu lần nào không có trong kết quả.
function layCauHinhQc() {
  return Object.fromEntries(db.prepare(`SELECT Loai, ${COT_QC.join(', ')} FROM qc_cau_hinh`).all().map(({ Loai, ...r }) => [Loai, r]));
}
// Ghi 1 phần: trường undefined giữ nguyên giá trị cũ.
function datCauHinhQc(loai, thayDoi) {
  const cu = layCauHinhQc()[loai] || {};
  const moi = COT_QC.map(c => (thayDoi[c] === undefined ? cu[c] || '' : thayDoi[c]));
  db.prepare(`INSERT INTO qc_cau_hinh (Loai, ${COT_QC.join(', ')}) VALUES (?, ${COT_QC.map(() => '?').join(', ')})
    ON CONFLICT(Loai) DO UPDATE SET ${COT_QC.map(c => `${c} = excluded.${c}`).join(', ')}`).run(loai, ...moi);
}

// Cảnh báo Telegram cho AI QC (01/10/2026): 1 Chat ID chung cho cả 3 QC, bot dùng TELEGRAM_BOT_TOKEN sẵn có. Trống = tắt.
db.exec(`CREATE TABLE IF NOT EXISTS qc_canh_bao_telegram (id INTEGER PRIMARY KEY CHECK (id = 1), ChatId TEXT NOT NULL DEFAULT '')`);
// BotToken (01/10/2026): nhập ở menu QC, CHỈ dùng cho cảnh báo QC; trống = dùng TELEGRAM_BOT_TOKEN trong .env.
if (!db.prepare(`PRAGMA table_info(qc_canh_bao_telegram)`).all().some(c => c.name === 'BotToken')) {
  db.exec(`ALTER TABLE qc_canh_bao_telegram ADD COLUMN BotToken TEXT NOT NULL DEFAULT ''`);
}
// Gộp cảnh báo (02/10/2026): GopCclPhut = chu kỳ gửi gộp CAN_CHECK_LAI (phút, 0 = gửi ngay từng tin như cũ); GioTongKet = "HH:MM"
// gửi tin tổng kết ngày ('' = tắt); NgayTongKetCuoi = ngày (YYYY-MM-DD, giờ VN) đã gửi tổng kết — chống gửi trùng.
// IdCclDaGui = id qc_log CAN_CHECK_LAI lớn nhất đã gửi gộp; ThoiGianGuiCclCuoi = ISO lần gửi gộp gần nhất (services/qc/qcTelegramService.js).
for (const [cot, md] of [['GopCclPhut', '0'], ['GioTongKet', ''], ['NgayTongKetCuoi', ''], ['IdCclDaGui', '0'], ['ThoiGianGuiCclCuoi', '']]) {
  if (!db.prepare(`PRAGMA table_info(qc_canh_bao_telegram)`).all().some(c => c.name === cot)) {
    db.exec(`ALTER TABLE qc_canh_bao_telegram ADD COLUMN ${cot} TEXT NOT NULL DEFAULT '${md}'`);
  }
}
function layTelegramQc() {
  const r = db.prepare(`SELECT * FROM qc_canh_bao_telegram WHERE id = 1`).get() || {};
  return { chatId: r.ChatId || '', botToken: r.BotToken || '', gopCclPhut: Number(r.GopCclPhut) || 0, gioTongKet: r.GioTongKet || '', ngayTongKetCuoi: r.NgayTongKetCuoi || '',
    idCclDaGui: Number(r.IdCclDaGui) || 0, thoiGianGuiCclCuoi: r.ThoiGianGuiCclCuoi || '' };
}
// Ghi 1 phần: trường undefined giữ nguyên.
const COT_TELEGRAM = { chatId: 'ChatId', botToken: 'BotToken', gopCclPhut: 'GopCclPhut', gioTongKet: 'GioTongKet', ngayTongKetCuoi: 'NgayTongKetCuoi', idCclDaGui: 'IdCclDaGui', thoiGianGuiCclCuoi: 'ThoiGianGuiCclCuoi' };
function datTelegramQc(moi) {
  const gop = { ...layTelegramQc(), ...Object.fromEntries(Object.entries(moi).filter(([, v]) => v !== undefined)) };
  const cot = Object.values(COT_TELEGRAM);
  db.prepare(`INSERT INTO qc_canh_bao_telegram (id, ${cot.join(', ')}) VALUES (1, ${cot.map(() => '?').join(', ')})
    ON CONFLICT(id) DO UPDATE SET ${cot.map(c => `${c} = excluded.${c}`).join(', ')}`).run(...Object.keys(COT_TELEGRAM).map(k => String(gop[k])));
}

// Prompt AI QC sửa được (02/10/2026, theo yêu cầu người dùng — menu QC, CHỈ superadmin). Mỗi lần Lưu = 1 phiên bản mới (không sửa/xoá
// phiên bản cũ); qc_prompt_dang_dung trỏ phiên bản đang dùng của từng QC — không có dòng / PhienBanId 0 = mẫu MẶC ĐỊNH trong code
// (qcService.js#MAU_PROMPT_MAC_DINH).
db.exec(`CREATE TABLE IF NOT EXISTS qc_prompt_phien_ban (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  LoaiQc TEXT NOT NULL DEFAULT '',
  NoiDung TEXT NOT NULL DEFAULT '',
  GhiChu TEXT NOT NULL DEFAULT '',
  NguoiTao TEXT NOT NULL DEFAULT '',
  ThoiGian TEXT NOT NULL DEFAULT ''
)`);
db.exec(`CREATE TABLE IF NOT EXISTS qc_prompt_dang_dung (LoaiQc TEXT PRIMARY KEY, PhienBanId INTEGER NOT NULL DEFAULT 0)`);
const layPhienBanPromptQc = id => db.prepare(`SELECT * FROM qc_prompt_phien_ban WHERE id = ?`).get(id) || null;
// -> phiên bản đang dùng (đủ cột) hoặc null = mặc định.
function layPromptDangDungQc(loai) {
  const r = db.prepare(`SELECT PhienBanId FROM qc_prompt_dang_dung WHERE LoaiQc = ?`).get(loai);
  return r && r.PhienBanId ? layPhienBanPromptQc(r.PhienBanId) : null;
}
const datPromptDangDungQc = (loai, phienBanId) => db.prepare(`INSERT INTO qc_prompt_dang_dung (LoaiQc, PhienBanId) VALUES (?, ?)
  ON CONFLICT(LoaiQc) DO UPDATE SET PhienBanId = excluded.PhienBanId`).run(loai, phienBanId || 0);
// Thêm phiên bản + dùng ngay, trong 1 giao dịch. -> id
const luuPhienBanPromptQc = db.transaction((loai, noiDung, ghiChu, nguoi, thoiGian) => {
  const id = Number(db.prepare(`INSERT INTO qc_prompt_phien_ban (LoaiQc, NoiDung, GhiChu, NguoiTao, ThoiGian) VALUES (?, ?, ?, ?, ?)`)
    .run(loai, noiDung, ghiChu, nguoi, thoiGian).lastInsertRowid);
  datPromptDangDungQc(loai, id);
  return id;
});
const layLichSuPromptQc = loai => db.prepare(`SELECT id, GhiChu, NguoiTao, ThoiGian, length(NoiDung) AS DoDai FROM qc_prompt_phien_ban WHERE LoaiQc = ? ORDER BY id DESC LIMIT 100`).all(loai);

// Giá token AI (02/10/2026) — superadmin nhập ở menu QC, USD / 1 triệu token; KHÔNG có giá mặc định (không tự đoán giá).
// Chi phí = ước tính theo giá ĐANG lưu (nhập giá sau vẫn tính lại được cho các lần QC cũ).
db.exec(`CREATE TABLE IF NOT EXISTS qc_gia_token (Model TEXT PRIMARY KEY, GiaVao TEXT NOT NULL DEFAULT '', GiaRa TEXT NOT NULL DEFAULT '')`);
const layGiaTokenQc = () => db.prepare(`SELECT Model, GiaVao, GiaRa FROM qc_gia_token ORDER BY Model`).all();
// ds: [{ model, giaVao, giaRa }] — giá trống cả 2 = xoá dòng. Ghi trong 1 transaction.
const datGiaTokenQc = ds => db.transaction(() => {
  for (const { model, giaVao, giaRa } of ds) {
    if (giaVao === '' && giaRa === '') db.prepare(`DELETE FROM qc_gia_token WHERE Model = ?`).run(model);
    else db.prepare(`INSERT INTO qc_gia_token (Model, GiaVao, GiaRa) VALUES (?, ?, ?) ON CONFLICT(Model) DO UPDATE SET GiaVao = excluded.GiaVao, GiaRa = excluded.GiaRa`).run(model, giaVao, giaRa);
  }
})();

// Mốc áp dụng Tự động quét QC (02/10/2026): lần khởi động ĐẦU TIÊN có tính năng — chỉ auto QC đơn chuyển trạng thái từ
// mốc này trở đi (người dùng chốt: không QC hàng loạt đơn cũ). Ghi 1 lần, không đổi về sau.
db.exec(`CREATE TABLE IF NOT EXISTS qc_auto_moc (id INTEGER PRIMARY KEY CHECK (id = 1), MocApDung TEXT NOT NULL DEFAULT '')`);
db.prepare(`INSERT OR IGNORE INTO qc_auto_moc (id, MocApDung) VALUES (1, ?)`).run(new Date().toISOString());
const layMocApDungAutoQc = () => (db.prepare(`SELECT MocApDung FROM qc_auto_moc WHERE id = 1`).get() || {}).MocApDung || '';

// AdminAI (03/10/2026, theo yêu cầu người dùng): toàn bộ cài đặt (bật/tắt luật, ngưỡng, giờ báo cáo, lịch phân tích...) lưu 1 JSON —
// services/adminAi/caiDat.js kiểm tra/giải nghĩa. MocApDung = lần khởi động ĐẦU TIÊN có AdminAI (ghi 1 lần): băm ảnh từ mốc - 30 ngày.
// Cấu hình AI riêng của AdminAI dùng chung bảng qc_cau_hinh với Loai = 'ADMIN_AI' (cùng cột nhà cung cấp/key/model như QC).
db.exec(`CREATE TABLE IF NOT EXISTS admin_ai_cai_dat (id INTEGER PRIMARY KEY CHECK (id = 1), Json TEXT NOT NULL DEFAULT '{}', MocApDung TEXT NOT NULL DEFAULT '')`);
db.prepare(`INSERT OR IGNORE INTO admin_ai_cai_dat (id, Json, MocApDung) VALUES (1, '{}', ?)`).run(new Date().toISOString());
const layCaiDatAdminAi = () => JSON.parse((db.prepare(`SELECT Json FROM admin_ai_cai_dat WHERE id = 1`).get() || {}).Json || '{}');
// Ghi đè các khoá cấp 1 có trong `moi` (giữ nguyên khoá khác).
const datCaiDatAdminAi = moi => db.prepare(`UPDATE admin_ai_cai_dat SET Json = ? WHERE id = 1`).run(JSON.stringify({ ...layCaiDatAdminAi(), ...moi }));
const layMocApDungAdminAi = () => (db.prepare(`SELECT MocApDung FROM admin_ai_cai_dat WHERE id = 1`).get() || {}).MocApDung || '';

module.exports = {
  layCaiDatAdminAi, datCaiDatAdminAi, layMocApDungAdminAi,
  layCauHinhQc, datCauHinhQc, layMocApDungAutoQc, layTelegramQc, datTelegramQc, layGiaTokenQc, datGiaTokenQc,
  layPhienBanPromptQc, layPromptDangDungQc, datPromptDangDungQc, luuPhienBanPromptQc, layLichSuPromptQc,
  CAC_COT_TAI_KHOAN_GKE, layDanhSachTaiKhoanGke, layTaiKhoanGke, ghiTaiKhoanGke, xoaTaiKhoanGke,
  layGanTaiKhoanGke, ganTaiKhoanGkeChoXuong,
  layCaiDatHangLoat, datCaiDatHangLoat,
  layCauHinhTracking, datCauHinhTracking, CAC_COT_CAU_HINH_TRACKING,
  layCaiDatCanhBao, datCaiDatCanhBao,
  layCaiDatNenAnh, datCaiDatNenAnh,
  layMauTheoXuong, datMauXuong,
  layDanhSachXuong, themXuong, xoaXuong, doiTenXuong,
  layTeamXuongMacDinh, ganTeamXuongMacDinh,
  layDanhSachLoaiHang, themLoaiHang, suaLoaiHang, xoaLoaiHang,
  layNhomLoaiTrong, datNhomLoaiTrong,
};
