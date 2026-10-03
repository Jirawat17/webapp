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
// Tự động quét QC (02/10/2026): CheDo ('MANUAL' | 'AUTO'; dòng cũ trống = MANUAL), ThoiGianKetThuc, ThongTinAuto (JSON: trạng thái
// đơn, mốc chuyển trạng thái, thời gian chờ, lần thử, ảnh + thời điểm upload).
// Kinh nghiệm QC (02/10/2026): KinhNghiemDaDung = JSON [{ id, phamVi, noiDung }] — NGUYÊN VĂN kinh nghiệm đã đưa vào prompt lần
// đó (trống = không có), để truy vết kể cả khi kinh nghiệm bị sửa/ngừng dùng sau này.
// Chi phí AI (02/10/2026): TokenVao / TokenRa = số token API trả về cho lượt gọi AI (trống = không gọi AI / API không trả).
// PhienBanPrompt (02/10/2026): 'MAC_DINH' | id phiên bản prompt (cai_dat qc_prompt_phien_ban) | 'CHAY_THU'; dòng cũ trống = mặc định.
// CheDo 'TEST' = chạy thử prompt chưa lưu — KHÔNG tính vào Độ chính xác / Gợi ý ngưỡng / mẫu kiểm PASS / Telegram gộp / tổng kết.
const COT_QC_LOG_THEM = ['Diem', 'AiDeXuat', 'NguongDaDung', 'LyDoKetLuan', 'CheDo', 'ThoiGianKetThuc', 'ThongTinAuto', 'KinhNghiemDaDung', 'TokenVao', 'TokenRa', 'PhienBanPrompt'];
const cotQcLogDaCo = db.prepare(`PRAGMA table_info(qc_log)`).all().map(c => c.name);
// Đánh giá QC (02/10/2026, chỉ superadmin): kết quả THỰC TẾ do người xem gán (PASS/FAIL; trống = chưa đánh giá) — chỉ ghi nhận,
// KHÔNG đổi trạng thái đơn. Không nằm trong ghiQcLog (dòng mới luôn chưa đánh giá).
const COT_QC_DANH_GIA = ['DanhGiaThucTe', 'DanhGiaLyDo', 'DanhGiaNguoi', 'DanhGiaThoiGian'];
for (const cot of [...COT_QC_LOG_THEM, ...COT_QC_DANH_GIA]) if (!cotQcLogDaCo.includes(cot)) db.exec(`ALTER TABLE qc_log ADD COLUMN ${cot} TEXT NOT NULL DEFAULT ''`);
const COT_QC_LOG = ['ThoiGian', 'NguoiDung', 'STT_Key', 'LoaiQc', 'Model', 'AnhDaDung', 'FileTheu', 'DesignFile', 'MockupFile', 'KetQua', 'DoTinCay', 'LyDo', 'ChiTiet', 'LoiApi', ...COT_QC_LOG_THEM];
const cauGhiQcLog = db.prepare(`INSERT INTO qc_log (${COT_QC_LOG.join(', ')}) VALUES (${COT_QC_LOG.map(c => '@' + c).join(', ')})`);
function ghiQcLog(dong) {
  return Number(cauGhiQcLog.run(Object.fromEntries(COT_QC_LOG.map(c => [c, dong[c] === undefined || dong[c] === null ? '' : String(dong[c])]))).lastInsertRowid);
}
// ---- Tự động quét QC (02/10/2026): mỗi (đơn, loại QC) TỐI ĐA 1 lần auto — khoá chính (STT_Key, LoaiQc).
// TrangThai: DANG_CHAY (đã giành quyền, đang QC) | XONG (đã có kết quả PASS/FAIL/CAN_CHECK_LAI) | LOI (lỗi kỹ thuật, còn được thử
// lại nếu SoLanThu < tối đa và đủ khoảng cách). Giành quyền = 1 câu lệnh SQL nguyên tử (INSERT OR IGNORE / UPDATE có điều kiện)
// -> nhiều lượt/tiến trình cùng lúc chỉ 1 bên thắng, nhờ khoá ghi của SQLite.
db.exec(`CREATE TABLE IF NOT EXISTS qc_auto (
  STT_Key TEXT NOT NULL,
  LoaiQc TEXT NOT NULL,
  TrangThai TEXT NOT NULL DEFAULT '',
  SoLanThu INTEGER NOT NULL DEFAULT 0,
  LanThuCuoi TEXT NOT NULL DEFAULT '',
  KetQua TEXT NOT NULL DEFAULT '',
  QcLogId TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (STT_Key, LoaiQc)
)`);
// Lần đầu: chèn mới. Lần thử lại: chỉ khi đang LOI, SoLanThu < soLanToiDa và LanThuCuoi <= truocMoc (ISO). -> true nếu giành được.
function giuQuyenAutoQc(sttKey, loaiQc, { bayGio, truocMoc, soLanToiDa }) {
  const moi = db.prepare(`INSERT OR IGNORE INTO qc_auto (STT_Key, LoaiQc, TrangThai, SoLanThu, LanThuCuoi) VALUES (?, ?, 'DANG_CHAY', 1, ?)`).run(sttKey, loaiQc, bayGio);
  if (moi.changes === 1) return true;
  const thuLai = db.prepare(`UPDATE qc_auto SET TrangThai = 'DANG_CHAY', SoLanThu = SoLanThu + 1, LanThuCuoi = ?
    WHERE STT_Key = ? AND LoaiQc = ? AND TrangThai = 'LOI' AND SoLanThu < ? AND LanThuCuoi <= ?`).run(bayGio, sttKey, loaiQc, soLanToiDa, truocMoc);
  return thuLai.changes === 1;
}
function ketThucAutoQc(sttKey, loaiQc, { trangThai, ketQua = '', qcLogId = '' }) {
  db.prepare(`UPDATE qc_auto SET TrangThai = ?, KetQua = ?, QcLogId = ? WHERE STT_Key = ? AND LoaiQc = ?`).run(trangThai, ketQua, String(qcLogId), sttKey, loaiQc);
}
// { 'STT|QC1': row } — để lọc nhanh đơn đã auto.
function layTatCaAutoQc() {
  return new Map(db.prepare(`SELECT * FROM qc_auto`).all().map(r => [`${r.STT_Key}|${r.LoaiQc}`, r]));
}
// Khởi động lại khi đang QC dở (tiến trình chết giữa chừng) -> coi là 1 lần LOI (vẫn tính lần thử, không kẹt DANG_CHAY mãi).
function donDepAutoQcDangChay() {
  return db.prepare(`UPDATE qc_auto SET TrangThai = 'LOI', KetQua = 'Server khởi động lại khi đang QC' WHERE TrangThai = 'DANG_CHAY'`).run().changes;
}

// AI sai = AI kết luận PASS/FAIL khác thực tế (CAN_CHECK_LAI không tính đúng/sai; dòng LOI không đánh giá được).
const DK_AI_SAI = `DanhGiaThucTe != '' AND KetQua IN ('PASS','FAIL') AND KetQua != DanhGiaThucTe`;

// Mới nhất trước; loc: { loaiQc, ketQua, sttKey, danhGia: '' | 'CHUA' | 'SAI', gioiHan }.
function layQcLog({ loaiQc, ketQua, sttKey, danhGia, gioiHan = 200 } = {}) {
  const dk = [], ts = {};
  if (loaiQc) { dk.push('LoaiQc = @loaiQc'); ts.loaiQc = loaiQc; }
  if (ketQua) { dk.push('KetQua = @ketQua'); ts.ketQua = ketQua; }
  if (sttKey) { dk.push('STT_Key = @sttKey'); ts.sttKey = sttKey; }
  if (danhGia === 'CHUA') dk.push(`DanhGiaThucTe = '' AND KetQua != 'LOI'`);
  if (danhGia === 'SAI') dk.push(DK_AI_SAI);
  // Mẫu kiểm PASS (02/10/2026): cố định 10% lần QC PASS theo băm id (mở lại không đổi) — để phát hiện PASS sai, tránh chỉ đánh giá đơn lỗi.
  if (danhGia === 'MAU_PASS') dk.push(`CheDo != 'TEST' AND KetQua = 'PASS' AND DanhGiaThucTe = '' AND ((id * 2654435761) % 4294967296) % 100 < 10`);
  return db.prepare(`SELECT *, (SELECT k.id FROM qc_kinh_nghiem k WHERE k.QcLogId = qc_log.id) AS KinhNghiemId
    FROM qc_log ${dk.length ? 'WHERE ' + dk.join(' AND ') : ''} ORDER BY id DESC LIMIT ${Math.min(Number(gioiHan) || 200, 1000)}`).all(ts);
}
const layQcLogTheoId = id => db.prepare(`SELECT * FROM qc_log WHERE id = ?`).get(id);

// ---------- Kinh nghiệm QC (02/10/2026, chỉ superadmin) — giải thích của Superadmin về lỗi AI, TỐI ĐA 1 kinh nghiệm / 1 dòng qc_log.
// Chỉ kinh nghiệm DA_XAC_NHAN được đưa vào prompt (qcService#chonKinhNghiem). Không xoá — chỉ chuyển KHONG_SU_DUNG.
// KetQuaAi/DiemAi/LyDoAi/KetQuaDung = bản chụp lúc tạo. GiaTriPhamVi: STT_Key (DON_NAY) | LOAI của đơn gốc (LOAI_SAN_PHAM) | '' (TOAN_QC).
// HangMucSai, NguyenNhan: JSON mảng mã.
db.exec(`CREATE TABLE IF NOT EXISTS qc_kinh_nghiem (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  QcLogId INTEGER NOT NULL UNIQUE,
  STT_Key TEXT NOT NULL DEFAULT '',
  LoaiQc TEXT NOT NULL DEFAULT '',
  KetQuaAi TEXT NOT NULL DEFAULT '',
  DiemAi TEXT NOT NULL DEFAULT '',
  LyDoAi TEXT NOT NULL DEFAULT '',
  KetQuaDung TEXT NOT NULL DEFAULT '',
  AiSaiGi TEXT NOT NULL DEFAULT '',
  HangMucSai TEXT NOT NULL DEFAULT '[]',
  NguyenNhan TEXT NOT NULL DEFAULT '[]',
  NguyenNhanKhac TEXT NOT NULL DEFAULT '',
  KinhNghiem TEXT NOT NULL DEFAULT '',
  PhamVi TEXT NOT NULL DEFAULT '',
  GiaTriPhamVi TEXT NOT NULL DEFAULT '',
  TrangThai TEXT NOT NULL DEFAULT 'CHUA_XAC_NHAN',
  SoLanDung INTEGER NOT NULL DEFAULT 0,
  NguoiTao TEXT NOT NULL DEFAULT '',
  ThoiGianTao TEXT NOT NULL DEFAULT '',
  NguoiSua TEXT NOT NULL DEFAULT '',
  ThoiGianSua TEXT NOT NULL DEFAULT ''
)`);
const COT_KN_SUA = ['AiSaiGi', 'HangMucSai', 'NguyenNhan', 'NguyenNhanKhac', 'KinhNghiem', 'PhamVi', 'GiaTriPhamVi'];
function taoKinhNghiem(kn) {
  const cot = ['QcLogId', 'STT_Key', 'LoaiQc', 'KetQuaAi', 'DiemAi', 'LyDoAi', 'KetQuaDung', ...COT_KN_SUA, 'NguoiTao', 'ThoiGianTao'];
  return Number(db.prepare(`INSERT INTO qc_kinh_nghiem (${cot.join(', ')}) VALUES (${cot.map(c => '@' + c).join(', ')})`)
    .run(Object.fromEntries(cot.map(c => [c, kn[c] ?? '']))).lastInsertRowid);
}
// Sửa nội dung -> luôn về CHUA_XAC_NHAN (nội dung mới chưa được xác nhận thì chưa được dùng).
function suaKinhNghiem(id, kn, nguoi, thoiGian) {
  return db.prepare(`UPDATE qc_kinh_nghiem SET ${COT_KN_SUA.map(c => `${c} = @${c}`).join(', ')}, TrangThai = 'CHUA_XAC_NHAN',
    NguoiSua = @nguoi, ThoiGianSua = @thoiGian WHERE id = @id`).run({ ...Object.fromEntries(COT_KN_SUA.map(c => [c, kn[c] ?? ''])), id, nguoi, thoiGian }).changes;
}
function doiTrangThaiKinhNghiem(id, trangThai, nguoi, thoiGian) {
  return db.prepare(`UPDATE qc_kinh_nghiem SET TrangThai = ?, NguoiSua = ?, ThoiGianSua = ? WHERE id = ?`).run(trangThai, nguoi, thoiGian, id).changes;
}
const layKinhNghiemTheoId = id => db.prepare(`SELECT * FROM qc_kinh_nghiem WHERE id = ?`).get(id);
// loc: { loaiQc, trangThai, hangMuc, nguyenNhan, loaiSanPham, tuKhoa } — mới nhất trước.
function layDanhSachKinhNghiem({ loaiQc, trangThai, hangMuc, nguyenNhan, loaiSanPham, tuKhoa } = {}) {
  const dk = [], ts = {};
  if (loaiQc) { dk.push('LoaiQc = @loaiQc'); ts.loaiQc = loaiQc; }
  if (trangThai) { dk.push('TrangThai = @trangThai'); ts.trangThai = trangThai; }
  if (hangMuc) { dk.push(`HangMucSai LIKE @hangMuc`); ts.hangMuc = `%"${hangMuc}"%`; }
  if (nguyenNhan) { dk.push(`NguyenNhan LIKE @nguyenNhan`); ts.nguyenNhan = `%"${nguyenNhan}"%`; }
  if (loaiSanPham) { dk.push(`PhamVi = 'LOAI_SAN_PHAM' AND GiaTriPhamVi = @loaiSanPham COLLATE NOCASE`); ts.loaiSanPham = loaiSanPham; }
  if (tuKhoa) { dk.push(`(AiSaiGi || ' ' || KinhNghiem || ' ' || NguyenNhanKhac || ' ' || STT_Key) LIKE @tuKhoa`); ts.tuKhoa = `%${tuKhoa}%`; }
  return db.prepare(`SELECT * FROM qc_kinh_nghiem ${dk.length ? 'WHERE ' + dk.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`).all(ts);
}
// Ứng viên đưa vào prompt: DA_XAC_NHAN, cùng QC, phạm vi khớp đơn. Thứ tự: đơn này -> cùng loại SP -> toàn QC, mới nhất trước.
function layKinhNghiemApDung(loaiQc, sttKey, loaiSanPham) {
  return db.prepare(`SELECT * FROM qc_kinh_nghiem WHERE TrangThai = 'DA_XAC_NHAN' AND LoaiQc = @loaiQc AND (
      (PhamVi = 'DON_NAY' AND GiaTriPhamVi = @sttKey) OR
      (PhamVi = 'LOAI_SAN_PHAM' AND @loaiSp != '' AND GiaTriPhamVi = @loaiSp COLLATE NOCASE) OR
      PhamVi = 'TOAN_QC')
    ORDER BY CASE PhamVi WHEN 'DON_NAY' THEN 0 WHEN 'LOAI_SAN_PHAM' THEN 1 ELSE 2 END, id DESC`)
    .all({ loaiQc, sttKey, loaiSp: String(loaiSanPham || '').trim() });
}
const tangSoLanDungKinhNghiem = ids => { const st = db.prepare(`UPDATE qc_kinh_nghiem SET SoLanDung = SoLanDung + 1 WHERE id = ?`); db.transaction(() => ids.forEach(id => st.run(id)))(); };

// Token AI theo (kỳ, QC, model) — gom 'NGAY' (YYYY-MM-DD) | 'THANG' (YYYY-MM) theo ThoiGian giờ VN; chỉ lượt có số token.
function thongKeTokenQc(tuThoiGian = '', gom = 'NGAY') {
  const doDai = gom === 'THANG' ? 7 : 10;
  return db.prepare(`SELECT substr(ThoiGian, 1, ${doDai}) AS Ky, LoaiQc, Model, COUNT(*) AS soLan,
      SUM(CAST(TokenVao AS INTEGER)) AS tokenVao, SUM(CAST(TokenRa AS INTEGER)) AS tokenRa
    FROM qc_log WHERE TokenVao != '' AND ThoiGian >= @tu GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2, 3`).all({ tu: tuThoiGian });
}

// ---------- Notes (02/10/2026, theo yêu cầu người dùng — CHỈ superadmin, routes/notes.js) — ghi chép kinh nghiệm xử lý vấn đề.
// The: các thẻ cách nhau dấu phẩy, có ',' bao 2 đầu (",gke,zip,") để lọc đúng 1 thẻ bằng LIKE. Anh: JSON mảng object key MinIO (notes/...).
db.exec(`CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  TieuDe TEXT NOT NULL DEFAULT '',
  NoiDung TEXT NOT NULL DEFAULT '',
  The TEXT NOT NULL DEFAULT '',
  Anh TEXT NOT NULL DEFAULT '[]',
  NguoiTao TEXT NOT NULL DEFAULT '',
  ThoiGianTao TEXT NOT NULL DEFAULT '',
  NguoiSua TEXT NOT NULL DEFAULT '',
  ThoiGianSua TEXT NOT NULL DEFAULT ''
)`);
const theSangCot = ds => (ds.length ? `,${ds.join(',')},` : '');
const docNote = r => (r ? { ...r, The: r.The.split(',').filter(Boolean), Anh: JSON.parse(r.Anh || '[]') } : null);
const layNote = id => docNote(db.prepare(`SELECT * FROM notes WHERE id = ?`).get(id));
// loc: { tuKhoa, the } — mới sửa/tạo gần nhất trước.
function layDanhSachNote({ tuKhoa = '', the = '' } = {}) {
  const dk = [], ts = {};
  if (tuKhoa) { dk.push(`(TieuDe || ' ' || NoiDung || ' ' || The) LIKE @tuKhoa`); ts.tuKhoa = `%${tuKhoa}%`; }
  if (the) { dk.push(`The LIKE @the`); ts.the = `%,${the},%`; }
  return db.prepare(`SELECT * FROM notes ${dk.length ? 'WHERE ' + dk.join(' AND ') : ''} ORDER BY COALESCE(NULLIF(ThoiGianSua, ''), ThoiGianTao) DESC, id DESC LIMIT 500`).all(ts).map(docNote);
}
const layTatCaTheNote = () => [...new Set(db.prepare(`SELECT The FROM notes`).all().flatMap(r => r.The.split(',').filter(Boolean)))].sort();
function taoNote({ tieuDe, noiDung, the }, nguoi, thoiGian) {
  return Number(db.prepare(`INSERT INTO notes (TieuDe, NoiDung, The, NguoiTao, ThoiGianTao) VALUES (?, ?, ?, ?, ?)`)
    .run(tieuDe, noiDung, theSangCot(the), nguoi, thoiGian).lastInsertRowid);
}
const suaNote = (id, { tieuDe, noiDung, the }, nguoi, thoiGian) => db.prepare(`UPDATE notes SET TieuDe = ?, NoiDung = ?, The = ?, NguoiSua = ?, ThoiGianSua = ? WHERE id = ?`)
  .run(tieuDe, noiDung, theSangCot(the), nguoi, thoiGian, id).changes;
const datAnhNote = (id, anh) => db.prepare(`UPDATE notes SET Anh = ? WHERE id = ?`).run(JSON.stringify(anh), id).changes;
const xoaNote = id => db.prepare(`DELETE FROM notes WHERE id = ?`).run(id).changes;

// Gợi ý ngưỡng (02/10/2026): các lần QC đã đánh giá thực tế, có gọi AI (Model khác ''), không LỖI.
const layDongDaDanhGiaCoAi = loaiQc => db.prepare(`SELECT id, Model, ChiTiet, DanhGiaThucTe FROM qc_log
  WHERE LoaiQc = ? AND DanhGiaThucTe != '' AND KetQua != 'LOI' AND Model != '' AND CheDo != 'TEST'`).all(loaiQc);

// Cảnh báo Telegram gộp (02/10/2026, services/qc/qcTelegramService.js).
const maxQcLogId = () => db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM qc_log`).get().m;
const layCclSauId = id => db.prepare(`SELECT id, ThoiGian, STT_Key, LoaiQc, CheDo, Diem, LyDoKetLuan, LyDo FROM qc_log WHERE KetQua = 'CAN_CHECK_LAI' AND CheDo != 'TEST' AND id > ? ORDER BY id`).all(id);
// Tổng kết các lần QC có ThoiGian bắt đầu bằng ngay ('YYYY-MM-DD', giờ VN).
function tongKetQcNgay(ngay) {
  const dk = `substr(ThoiGian, 1, 10) = @ngay AND CheDo != 'TEST'`; // token/chi phí tính cả chạy thử (tốn tiền thật)
  const dkToken = `substr(ThoiGian, 1, 10) = @ngay`;
  return {
    theoKetQua: db.prepare(`SELECT LoaiQc, KetQua, CASE WHEN CheDo = 'AUTO' THEN 'AUTO' ELSE 'MANUAL' END AS CheDo, COUNT(*) AS n FROM qc_log WHERE ${dk} GROUP BY 1, 2, 3`).all({ ngay }),
    chuaDanhGia: db.prepare(`SELECT COUNT(*) AS n FROM qc_log WHERE ${dk} AND KetQua != 'LOI' AND DanhGiaThucTe = ''`).get({ ngay }).n,
    token: db.prepare(`SELECT Model, SUM(CAST(TokenVao AS INTEGER)) AS tokenVao, SUM(CAST(TokenRa AS INTEGER)) AS tokenRa FROM qc_log WHERE ${dkToken} AND TokenVao != '' GROUP BY Model`).all({ ngay }),
    kinhNghiemChoXacNhan: db.prepare(`SELECT COUNT(*) AS n FROM qc_kinh_nghiem WHERE TrangThai = 'CHUA_XAC_NHAN'`).get().n,
  };
}

// thucTe: 'PASS' | 'FAIL' | '' (bỏ đánh giá). Trả số dòng đã sửa (0 = không có dòng / dòng LOI).
function danhGiaQcLog(id, { thucTe, lyDo, nguoi, thoiGian }) {
  return db.prepare(`UPDATE qc_log SET DanhGiaThucTe = @thucTe, DanhGiaLyDo = @lyDo, DanhGiaNguoi = @nguoi, DanhGiaThoiGian = @thoiGian
    WHERE id = @id AND KetQua != 'LOI'`).run(thucTe ? { id, thucTe, lyDo, nguoi, thoiGian } : { id, thucTe: '', lyDo: '', nguoi: '', thoiGian: '' }).changes;
}

// Độ chính xác theo (LoaiQc, Model, CheDo) — chỉ dòng ĐÃ đánh giá, ThoiGian >= tuThoiGian (chuỗi ISO VN, '' = tất cả).
function thongKeDanhGiaQc(tuThoiGian = '') {
  return db.prepare(`SELECT LoaiQc, Model, CASE WHEN CheDo = 'AUTO' THEN 'AUTO' ELSE 'MANUAL' END AS CheDo,
      CASE WHEN KinhNghiemDaDung != '' THEN 'Có' ELSE 'Không' END AS CoKinhNghiem,
      CASE WHEN PhienBanPrompt IN ('', 'MAC_DINH') THEN 'Mặc định' ELSE '#' || PhienBanPrompt END AS PhienBanPrompt,
      COUNT(*) AS daDanhGia,
      SUM(KetQua IN ('PASS','FAIL') AND KetQua = DanhGiaThucTe) AS dung,
      SUM(KetQua = 'PASS' AND DanhGiaThucTe = 'FAIL') AS passSai,
      SUM(KetQua = 'FAIL' AND DanhGiaThucTe = 'PASS') AS failSai,
      SUM(KetQua = 'CAN_CHECK_LAI') AS canCheckLai
    FROM qc_log WHERE DanhGiaThucTe != '' AND CheDo != 'TEST' AND ThoiGian >= @tu
    GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 2, 3, 4, 5`).all({ tu: tuThoiGian });
}

module.exports = {
  layNote, layDanhSachNote, layTatCaTheNote, taoNote, suaNote, datAnhNote, xoaNote,
  ghiQcLog, layQcLog, layQcLogTheoId, danhGiaQcLog, thongKeDanhGiaQc, thongKeTokenQc, layDongDaDanhGiaCoAi, maxQcLogId, layCclSauId, tongKetQcNgay,
  taoKinhNghiem, suaKinhNghiem, doiTrangThaiKinhNghiem, layKinhNghiemTheoId, layDanhSachKinhNghiem, layKinhNghiemApDung, tangSoLanDungKinhNghiem, giuQuyenAutoQc, ketThucAutoQc, layTatCaAutoQc, donDepAutoQcDangChay,
  ghiNhieuDongBoSheetSeller, layNhatKyDongBoSheetSeller, layLoiDongBoDangCho, layDongBoGanNhat, xoaDongBoSheetSellerTheoDon,
  ghiLichSuHoatDong, ghiNhieuLichSuHoatDong, layTatCaLichSuHoatDong, xoaLichSuHoatDongTheoDon,
  ghiNhatKyQuetHangLoat, xoaNhatKyQuetHangLoatTheoDon,
  ghiLogsTracking, layTatCaLogsTracking, xoaLogsTrackingTheoDon,
};
