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

module.exports = {
  ghiLichSuHoatDong, layTatCaLichSuHoatDong, xoaLichSuHoatDongTheoDon,
  ghiNhatKyQuetHangLoat, xoaNhatKyQuetHangLoatTheoDon,
  ghiLogsTracking, layTatCaLogsTracking, xoaLogsTrackingTheoDon,
};
