const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// ============================================================
// 3 tab Sheet dạng NHẬT KÝ (chỉ thêm dòng, không bao giờ sửa/xoá dòng cũ) chuyển sang SQLite — bổ
// sung 19/09/2026, theo yêu cầu người dùng, xem
// docs/superpowers/specs/2026-09-19-nhat-ky-sqlite-design.md. KHÁC hẳn lần chuyển Don_Hang_ALL
// (services/trangThaiDbService.js) — 3 tab này KHÔNG bị rủi ro "lệch dòng" (app là người ghi DUY NHẤT,
// không có công thức QUERY/VSTACK nào tính lại thứ tự dòng), chỉ đơn giản chuyển kho lưu để không cần
// mở Google Sheets quản lý. KHÔNG migrate dữ liệu cũ (theo đúng yêu cầu người dùng) — 3 bảng bắt đầu
// TRẮNG, chỉ ghi dữ liệu MỚI từ đây trở đi; dữ liệu cũ vẫn còn nguyên trong Sheet để tra cứu thủ công
// nếu cần, app chỉ ngừng đọc/ghi vào đó.
//
// Gộp CHUNG 1 file .db (khác 1 file/1 mối quan tâm như trang_thai_don.db/tai_khoan.db) vì cả 3 đều
// cùng LOẠI (log chỉ thêm dòng), KHÔNG có quan hệ/ràng buộc chéo nào giữa 3 bảng — gộp file chỉ để đỡ
// quản lý nhiều file nhỏ, không ảnh hưởng cách ly dữ liệu (mỗi bảng vẫn độc lập hoàn toàn).
const DUONG_DAN_DB = process.env.NHAT_KY_DB_PATH || path.join(__dirname, '..', 'data', 'nhat_ky.db');

fs.mkdirSync(path.dirname(DUONG_DAN_DB), { recursive: true });

const db = new Database(DUONG_DAN_DB);
db.pragma('journal_mode = WAL');

// ---------- LichSuHoatDong — nhật ký hoạt động chung (khối lượng lớn nhất trong 3 tab) ----------
db.exec(`CREATE TABLE IF NOT EXISTS lich_su_hoat_dong (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ThoiGian TEXT NOT NULL DEFAULT '',
  NguoiDung TEXT NOT NULL DEFAULT '',
  VaiTro TEXT NOT NULL DEFAULT '',
  HanhDong TEXT NOT NULL DEFAULT '',
  STT_Key TEXT NOT NULL DEFAULT '',
  ChiTiet TEXT NOT NULL DEFAULT ''
)`);
// Index đúng các cột logService.js đang lọc theo (STT_Key/NguoiDung/HanhDong) — xem layLichSuTheoDon/
// layHoatDongGanDay/layHoatDongCuaToi. Không index ThoiGian — mọi nơi đang lọc/sắp bằng JS sau khi lấy
// hết bảng (giữ NGUYÊN cách này, xem chú thích ở layTatCaLichSuHoatDong bên dưới).
db.exec(`CREATE INDEX IF NOT EXISTS idx_lshd_stt_key ON lich_su_hoat_dong(STT_Key)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_lshd_nguoi_dung ON lich_su_hoat_dong(NguoiDung)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_lshd_hanh_dong ON lich_su_hoat_dong(HanhDong)`);

const cauGhiLichSuHoatDong = db.prepare(`
  INSERT INTO lich_su_hoat_dong (ThoiGian, NguoiDung, VaiTro, HanhDong, STT_Key, ChiTiet)
  VALUES (@ThoiGian, @NguoiDung, @VaiTro, @HanhDong, @STT_Key, @ChiTiet)
`);
function ghiLichSuHoatDong(dong) {
  cauGhiLichSuHoatDong.run(dong);
}
// Nhiều dòng trong 1 giao dịch — ghi hàng nghìn dòng 1 lượt (vd tự gán Xưởng theo Team) không phải commit từng dòng.
const ghiNhieuLichSuHoatDong = db.transaction(dsDong => dsDong.forEach(d => cauGhiLichSuHoatDong.run(d)));

// Trả về TOÀN BỘ bảng — logService.js tự lọc/sắp bằng JS sau đó (y hệt cách readTabCached('LichSuHoatDong')
// trả về trước đây), giữ nguyên logic lọc phức tạp (parse ChiTiet JSON, nhiều điều kiện...) không phải
// viết lại thành SQL, giảm rủi ro đổi hành vi. Bảng chưa tới mức cần tối ưu lọc bằng SQL (xem đánh giá
// quy mô trong spec doc).
const cauLayTatCaLichSuHoatDong = db.prepare(`SELECT ThoiGian, NguoiDung, VaiTro, HanhDong, STT_Key, ChiTiet FROM lich_su_hoat_dong`);
function layTatCaLichSuHoatDong() {
  return cauLayTatCaLichSuHoatDong.all();
}

// Xoá SẠCH lịch sử của 1 đơn — dùng cho nút "Xoá dữ liệu đơn hàng" (CHỈ superadmin, bổ sung 20/09/2026,
// xem services/xoaDuLieuDonService.js). Idempotent — không khớp dòng nào vẫn coi là thành công.
const cauXoaLichSuHoatDongTheoDon = db.prepare(`DELETE FROM lich_su_hoat_dong WHERE STT_Key = ?`);
function xoaLichSuHoatDongTheoDon(sttKey) {
  cauXoaLichSuHoatDongTheoDon.run(sttKey);
}

// ---------- NhatKyQuetHangLoat — nhật ký quét QR (kịch bản), CHỈ GHI — không có nơi nào đọc lại ----------
db.exec(`CREATE TABLE IF NOT EXISTS nhat_ky_quet_hang_loat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  Thoi_Gian TEXT NOT NULL DEFAULT '',
  Nguoi_Quet TEXT NOT NULL DEFAULT '',
  Ten_Kich_Ban TEXT NOT NULL DEFAULT '',
  STT_Key TEXT NOT NULL DEFAULT '',
  Trang_Thai_Cu TEXT NOT NULL DEFAULT '',
  Trang_Thai_Moi TEXT NOT NULL DEFAULT '',
  Ket_Qua TEXT NOT NULL DEFAULT '',
  Ghi_Chu TEXT NOT NULL DEFAULT ''
)`);

const cauGhiNhatKyQuetHangLoat = db.prepare(`
  INSERT INTO nhat_ky_quet_hang_loat (Thoi_Gian, Nguoi_Quet, Ten_Kich_Ban, STT_Key, Trang_Thai_Cu, Trang_Thai_Moi, Ket_Qua, Ghi_Chu)
  VALUES (@Thoi_Gian, @Nguoi_Quet, @Ten_Kich_Ban, @STT_Key, @Trang_Thai_Cu, @Trang_Thai_Moi, @Ket_Qua, @Ghi_Chu)
`);
function ghiNhatKyQuetHangLoat(dong) {
  cauGhiNhatKyQuetHangLoat.run(dong);
}

// Xoá SẠCH nhật ký quét hàng loạt của 1 đơn — cùng lý do/khuôn xoaLichSuHoatDongTheoDon ở trên.
const cauXoaNhatKyQuetHangLoatTheoDon = db.prepare(`DELETE FROM nhat_ky_quet_hang_loat WHERE STT_Key = ?`);
function xoaNhatKyQuetHangLoatTheoDon(sttKey) {
  cauXoaNhatKyQuetHangLoatTheoDon.run(sttKey);
}

// ---------- LogsTracking — nhật ký chi tiết mua/kiểm tra tracking GKE ----------
db.exec(`CREATE TABLE IF NOT EXISTS logs_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ThoiGian TEXT NOT NULL DEFAULT '',
  STT_Key TEXT NOT NULL DEFAULT '',
  Nguon TEXT NOT NULL DEFAULT '',
  NguoiDung TEXT NOT NULL DEFAULT '',
  VaiTro TEXT NOT NULL DEFAULT '',
  KetQua TEXT NOT NULL DEFAULT '',
  TRACKING_ID TEXT NOT NULL DEFAULT '',
  HANG_VAN_CHUYEN TEXT NOT NULL DEFAULT '',
  ChiTiet TEXT NOT NULL DEFAULT ''
)`);

const cauGhiLogsTracking = db.prepare(`
  INSERT INTO logs_tracking (ThoiGian, STT_Key, Nguon, NguoiDung, VaiTro, KetQua, TRACKING_ID, HANG_VAN_CHUYEN, ChiTiet)
  VALUES (@ThoiGian, @STT_Key, @Nguon, @NguoiDung, @VaiTro, @KetQua, @TRACKING_ID, @HANG_VAN_CHUYEN, @ChiTiet)
`);
function ghiLogsTracking(dong) {
  cauGhiLogsTracking.run(dong);
}

const cauLayTatCaLogsTracking = db.prepare(`SELECT ThoiGian, STT_Key, Nguon, NguoiDung, VaiTro, KetQua, TRACKING_ID, HANG_VAN_CHUYEN, ChiTiet FROM logs_tracking`);
function layTatCaLogsTracking() {
  return cauLayTatCaLogsTracking.all();
}

// Xoá SẠCH log tracking của 1 đơn — cùng lý do/khuôn xoaLichSuHoatDongTheoDon ở trên.
const cauXoaLogsTrackingTheoDon = db.prepare(`DELETE FROM logs_tracking WHERE STT_Key = ?`);
function xoaLogsTrackingTheoDon(sttKey) {
  cauXoaLogsTrackingTheoDon.run(sttKey);
}

// ---------- Đồng bộ Sheet Seller (bổ sung 28/09/2026, theo yêu cầu người dùng) ----------
// MỌI lần app ghi vào Sheet của Seller (ghi chú xưởng / tracking / Delivered — services/sheetSellerService.js),
// cả thành công lẫn lỗi, kèm giá trị ô TRƯỚC -> SAU. "Lỗi đang chờ" = lần ghi GẦN NHẤT của cặp (STT_Key,
// Loai) có KetQua = 'LOI' (lần đẩy lại thành công sau đó tự đưa đơn ra khỏi danh sách).
db.exec(`CREATE TABLE IF NOT EXISTS dong_bo_sheet_seller (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ThoiGian TEXT NOT NULL DEFAULT '',
  NguoiDung TEXT NOT NULL DEFAULT '',
  STT_Key TEXT NOT NULL DEFAULT '',
  Loai TEXT NOT NULL DEFAULT '',
  SpreadsheetId TEXT NOT NULL DEFAULT '',
  Tab TEXT NOT NULL DEFAULT '',
  Dong TEXT NOT NULL DEFAULT '',
  Cot TEXT NOT NULL DEFAULT '',
  GiaTriTruoc TEXT NOT NULL DEFAULT '',
  GiaTriSau TEXT NOT NULL DEFAULT '',
  KetQua TEXT NOT NULL DEFAULT '',
  LyDo TEXT NOT NULL DEFAULT ''
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_dbss_stt_loai ON dong_bo_sheet_seller(STT_Key, Loai)`);
const COT_DONG_BO = ['ThoiGian', 'NguoiDung', 'STT_Key', 'Loai', 'SpreadsheetId', 'Tab', 'Dong', 'Cot', 'GiaTriTruoc', 'GiaTriSau', 'KetQua', 'LyDo'];
const cauGhiDongBo = db.prepare(`INSERT INTO dong_bo_sheet_seller (${COT_DONG_BO.join(', ')}) VALUES (${COT_DONG_BO.map(c => '@' + c).join(', ')})`);
const ghiNhieuDongBoSheetSeller = db.transaction(dsDong => dsDong.forEach(d =>
  cauGhiDongBo.run(Object.fromEntries(COT_DONG_BO.map(c => [c, d[c] === undefined || d[c] === null ? '' : String(d[c])])))));
// Mới nhất trước; loc: { loai, ketQua, sttKey, gioiHan }.
function layNhatKyDongBoSheetSeller({ loai, ketQua, sttKey, gioiHan = 300 } = {}) {
  const dk = [], ts = {};
  if (loai) { dk.push('Loai = @loai'); ts.loai = loai; }
  if (ketQua) { dk.push('KetQua = @ketQua'); ts.ketQua = ketQua; }
  if (sttKey) { dk.push('STT_Key = @sttKey'); ts.sttKey = sttKey; }
  return db.prepare(`SELECT * FROM dong_bo_sheet_seller ${dk.length ? 'WHERE ' + dk.join(' AND ') : ''} ORDER BY id DESC LIMIT ${Math.min(Number(gioiHan) || 300, 2000)}`).all(ts);
}
// Lần ghi gần nhất của mỗi (STT_Key, Loai) đang là LỖI, kèm số lần lỗi liên tiếp tới giờ.
function layLoiDongBoDangCho() {
  const moiNhat = db.prepare(`
    SELECT d.* FROM dong_bo_sheet_seller d
    JOIN (SELECT STT_Key, Loai, MAX(id) AS id FROM dong_bo_sheet_seller GROUP BY STT_Key, Loai) m ON m.id = d.id
    WHERE d.KetQua = 'LOI' ORDER BY d.id DESC`).all();
  const demLoi = db.prepare(`SELECT COUNT(*) AS c FROM dong_bo_sheet_seller WHERE STT_Key = ? AND Loai = ? AND KetQua = 'LOI'
    AND id > COALESCE((SELECT MAX(id) FROM dong_bo_sheet_seller WHERE STT_Key = ? AND Loai = ? AND KetQua = 'OK'), 0)`);
  return moiNhat.map(d => ({ ...d, SoLanLoi: demLoi.get(d.STT_Key, d.Loai, d.STT_Key, d.Loai).c }));
}
// Lần ghi GẦN NHẤT của 1 đơn theo 1 loại (vd ghi chú xưởng) — null nếu chưa từng ghi.
const cauDongBoGanNhat = db.prepare(`SELECT ThoiGian, KetQua, LyDo, GiaTriSau FROM dong_bo_sheet_seller WHERE STT_Key = ? AND Loai = ? ORDER BY id DESC LIMIT 1`);
function layDongBoGanNhat(sttKey, loai) {
  return cauDongBoGanNhat.get(sttKey, loai) || null;
}
const cauXoaDongBoTheoDon = db.prepare(`DELETE FROM dong_bo_sheet_seller WHERE STT_Key = ?`);
function xoaDongBoSheetSellerTheoDon(sttKey) {
  cauXoaDongBoTheoDon.run(sttKey);
}

// ---------- AI QC (30/09/2026, theo yêu cầu người dùng) — MỌI lần chạy QC1/QC2/QC3, kể cả lỗi API (services/qc/qcService.js) ----------
db.exec(`CREATE TABLE IF NOT EXISTS qc_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ThoiGian TEXT NOT NULL DEFAULT '',
  NguoiDung TEXT NOT NULL DEFAULT '',
  STT_Key TEXT NOT NULL DEFAULT '',
  LoaiQc TEXT NOT NULL DEFAULT '',
  Model TEXT NOT NULL DEFAULT '',
  AnhDaDung TEXT NOT NULL DEFAULT '',
  FileTheu TEXT NOT NULL DEFAULT '',
  DesignFile TEXT NOT NULL DEFAULT '',
  MockupFile TEXT NOT NULL DEFAULT '',
  KetQua TEXT NOT NULL DEFAULT '',
  DoTinCay TEXT NOT NULL DEFAULT '',
  LyDo TEXT NOT NULL DEFAULT '',
  ChiTiet TEXT NOT NULL DEFAULT '',
  LoiApi TEXT NOT NULL DEFAULT ''
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_qc_log_stt ON qc_log(STT_Key)`);
// Audit ngưỡng (01/10/2026): Diem (score AI), AiDeXuat (result AI đề xuất), NguongDaDung (JSON ngưỡng lúc chạy), LyDoKetLuan
// (vì sao hệ thống ra kết quả cuối KetQua).
const COT_QC_LOG_THEM = ['Diem', 'AiDeXuat', 'NguongDaDung', 'LyDoKetLuan'];
const cotQcLogDaCo = db.prepare(`PRAGMA table_info(qc_log)`).all().map(c => c.name);
for (const cot of COT_QC_LOG_THEM) if (!cotQcLogDaCo.includes(cot)) db.exec(`ALTER TABLE qc_log ADD COLUMN ${cot} TEXT NOT NULL DEFAULT ''`);
const COT_QC_LOG = ['ThoiGian', 'NguoiDung', 'STT_Key', 'LoaiQc', 'Model', 'AnhDaDung', 'FileTheu', 'DesignFile', 'MockupFile', 'KetQua', 'DoTinCay', 'LyDo', 'ChiTiet', 'LoiApi', ...COT_QC_LOG_THEM];
const cauGhiQcLog = db.prepare(`INSERT INTO qc_log (${COT_QC_LOG.join(', ')}) VALUES (${COT_QC_LOG.map(c => '@' + c).join(', ')})`);
function ghiQcLog(dong) {
  return Number(cauGhiQcLog.run(Object.fromEntries(COT_QC_LOG.map(c => [c, dong[c] === undefined || dong[c] === null ? '' : String(dong[c])]))).lastInsertRowid);
}
// Mới nhất trước; loc: { loaiQc, ketQua, sttKey, gioiHan }.
function layQcLog({ loaiQc, ketQua, sttKey, gioiHan = 200 } = {}) {
  const dk = [], ts = {};
  if (loaiQc) { dk.push('LoaiQc = @loaiQc'); ts.loaiQc = loaiQc; }
  if (ketQua) { dk.push('KetQua = @ketQua'); ts.ketQua = ketQua; }
  if (sttKey) { dk.push('STT_Key = @sttKey'); ts.sttKey = sttKey; }
  return db.prepare(`SELECT * FROM qc_log ${dk.length ? 'WHERE ' + dk.join(' AND ') : ''} ORDER BY id DESC LIMIT ${Math.min(Number(gioiHan) || 200, 1000)}`).all(ts);
}

module.exports = {
  ghiQcLog, layQcLog,
  ghiNhieuDongBoSheetSeller, layNhatKyDongBoSheetSeller, layLoiDongBoDangCho, layDongBoGanNhat, xoaDongBoSheetSellerTheoDon,
  ghiLichSuHoatDong, ghiNhieuLichSuHoatDong, layTatCaLichSuHoatDong, xoaLichSuHoatDongTheoDon,
  ghiNhatKyQuetHangLoat, xoaNhatKyQuetHangLoatTheoDon,
  ghiLogsTracking, layTatCaLogsTracking, xoaLogsTrackingTheoDon,
};
