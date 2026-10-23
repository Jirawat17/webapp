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
  // "Bỏ qua" (14/10/2026, theo yêu cầu người dùng — Trung tâm hành động): ẩn đúng LẦN lỗi đã bỏ qua (gia_tri = id dòng lỗi); đơn đó ghi
  // lỗi lần MỚI (id mới) thì hiện lại. Bị bỏ qua thì cũng không nằm trong "Đẩy lại tất cả". Nhật ký đầy đủ vẫn ở Settings.
  const boQua = layDaXuLy('SHEET_SELLER');
  return moiNhat.filter(d => (boQua.get(`${d.STT_Key}|${d.Loai}`) || {}).gia_tri !== String(d.id))
    .map(d => ({ ...d, SoLanLoi: demLoi.get(d.STT_Key, d.Loai, d.STT_Key, d.Loai).c }));
}
// Mã đơn có lần ghi SỐ MŨI CHỈ gần nhất đang LỖI (cùng nghĩa layLoiDongBoDangCho: lỗi đã "Bỏ qua" không tính) — routes/orders.js#lamGiauDon
// gọi ở MỌI lượt danh sách/chi tiết đơn nên chỉ 1 truy vấn, không đếm số lần lỗi (16/10/2026).
const cauSoMuiLoiMoiNhat = db.prepare(`
  SELECT d.id, d.STT_Key FROM dong_bo_sheet_seller d
  JOIN (SELECT STT_Key, MAX(id) AS id FROM dong_bo_sheet_seller WHERE Loai = 'SO_MUI' GROUP BY STT_Key) m ON m.id = d.id
  WHERE d.KetQua = 'LOI'`);
function dsKeySoMuiLoiDangCho() {
  const boQua = layDaXuLy('SHEET_SELLER');
  return new Set(cauSoMuiLoiMoiNhat.all().filter(d => (boQua.get(`${d.STT_Key}|SO_MUI`) || {}).gia_tri !== String(d.id)).map(d => d.STT_Key));
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

// ---------- C2 (11/10/2026): cảnh báo đã đánh dấu "Đã xử lý" ở Trung tâm hành động. 1 dòng/(loại, khoá) — đánh dấu lại thì ghi đè.
// gia_tri = giá trị dữ liệu LÚC đánh dấu; dữ liệu đổi (khác gia_tri) thì cảnh báo hiện lại (services/vanHanhService.js#locDaXuLy).
db.exec(`CREATE TABLE IF NOT EXISTS canh_bao_da_xu_ly (
  loai TEXT NOT NULL, khoa TEXT NOT NULL, gia_tri TEXT NOT NULL DEFAULT '', nguoi TEXT NOT NULL DEFAULT '', luc TEXT NOT NULL,
  ghi_chu TEXT NOT NULL DEFAULT '', PRIMARY KEY (loai, khoa)
)`);
function danhDauDaXuLy({ loai, khoa, giaTri, nguoi, luc, ghiChu = '' }) {
  db.prepare(`INSERT OR REPLACE INTO canh_bao_da_xu_ly (loai, khoa, gia_tri, nguoi, luc, ghi_chu) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(loai, khoa, String(giaTri ?? ''), nguoi || '', luc, ghiChu || '');
}
// Xoá các lần "Đã xử lý" của 1 loại mà khoá KHÔNG còn trong danh sách hiện tại (17/10/2026 — DonNhieuAo: nhóm hết lỗi / đổi khoá thì bản
// ghi cũ không bao giờ dùng lại). dsKhoaConDung: Set khoá đang có (tính trên TOÀN BỘ đơn, không theo phạm vi Xưởng của người xem). -> số đã xoá
function donDaXuLyKhongConDung(loai, dsKhoaConDung) {
  const cauXoa = db.prepare(`DELETE FROM canh_bao_da_xu_ly WHERE loai = ? AND khoa = ?`);
  let n = 0;
  for (const khoa of layDaXuLy(loai).keys()) if (!dsKhoaConDung.has(khoa)) n += cauXoa.run(loai, khoa).changes;
  return n;
}
function layDaXuLy(loai) {
  return new Map(db.prepare(`SELECT * FROM canh_bao_da_xu_ly WHERE loai = ?`).all(loai).map(r => [r.khoa, r]));
}

// ---------- ĐƠN CẦN CHECK (14/10/2026, theo yêu cầu người dùng — Trung tâm hành động, CHỈ superadmin): ghi chú nhanh 1 hay nhiều đơn
// cần kiểm tra cho các superadmin khác xem. stt_keys = JSON mảng mã đơn. "Đã check" thì rời danh sách nhưng vẫn lưu (xem lại được).
db.exec(`CREATE TABLE IF NOT EXISTS don_can_check (
  id INTEGER PRIMARY KEY AUTOINCREMENT, stt_keys TEXT NOT NULL DEFAULT '[]', noi_dung TEXT NOT NULL, ghi_chu TEXT NOT NULL DEFAULT '',
  nguoi_tao TEXT NOT NULL, luc_tao TEXT NOT NULL, nguoi_sua TEXT NOT NULL DEFAULT '', luc_sua TEXT NOT NULL DEFAULT '',
  da_check INTEGER NOT NULL DEFAULT 0, nguoi_check TEXT NOT NULL DEFAULT '', luc_check TEXT NOT NULL DEFAULT '', ket_qua_check TEXT NOT NULL DEFAULT ''
)`);
const docDonCanCheck = r => {
  let dsMa = [];
  try { dsMa = JSON.parse(r.stt_keys); } catch (e) { /* hỏng -> rỗng */ }
  return { ...r, stt_keys: Array.isArray(dsMa) ? dsMa : [] };
};
function themDonCanCheck({ sttKeys, noiDung, ghiChu, nguoi, luc }) {
  return db.prepare(`INSERT INTO don_can_check (stt_keys, noi_dung, ghi_chu, nguoi_tao, luc_tao) VALUES (?, ?, ?, ?, ?)`)
    .run(JSON.stringify(sttKeys), noiDung, ghiChu || '', nguoi, luc).lastInsertRowid;
}
// Chỉ sửa / check ghi chú CHƯA check — trả số dòng đã đổi (0 = không có hoặc đã check).
function suaDonCanCheck(id, { sttKeys, noiDung, ghiChu, nguoi, luc }) {
  return db.prepare(`UPDATE don_can_check SET stt_keys = ?, noi_dung = ?, ghi_chu = ?, nguoi_sua = ?, luc_sua = ? WHERE id = ? AND da_check = 0`)
    .run(JSON.stringify(sttKeys), noiDung, ghiChu || '', nguoi, luc, id).changes;
}
function danhDauDaCheck(id, { nguoi, luc, ketQua }) {
  return db.prepare(`UPDATE don_can_check SET da_check = 1, nguoi_check = ?, luc_check = ?, ket_qua_check = ? WHERE id = ? AND da_check = 0`)
    .run(nguoi, luc, ketQua || '', id).changes;
}
// daCheck false: đang chờ (mới nhất trước); true: đã check gần nhất trước, tối đa gioiHan dòng.
function layDonCanCheck(daCheck = false, gioiHan = 200) {
  return db.prepare(`SELECT * FROM don_can_check WHERE da_check = ? ORDER BY ${daCheck ? 'luc_check DESC, id DESC' : 'id DESC'} LIMIT ?`)
    .all(daCheck ? 1 : 0, gioiHan).map(docDonCanCheck);
}

// ---------- Y20 (11/10/2026): báo lỗi app từ nhân viên. thong_tin = JSON (trang, trình duyệt, màn hình, lỗi JS, lỗi API).
db.exec(`CREATE TABLE IF NOT EXISTS bao_loi_app (
  id INTEGER PRIMARY KEY AUTOINCREMENT, luc TEXT NOT NULL, nguoi TEXT NOT NULL, vai_tro TEXT NOT NULL DEFAULT '', trang TEXT NOT NULL DEFAULT '',
  mo_ta TEXT NOT NULL, anh_key TEXT NOT NULL DEFAULT '', thong_tin TEXT NOT NULL DEFAULT '{}',
  trang_thai TEXT NOT NULL DEFAULT 'MOI', ghi_chu_xu_ly TEXT NOT NULL DEFAULT ''
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_bao_loi_nguoi ON bao_loi_app(nguoi, luc)`);
function themBaoLoi(b) {
  return Number(db.prepare(`INSERT INTO bao_loi_app (luc, nguoi, vai_tro, trang, mo_ta, thong_tin) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(b.luc, b.nguoi, b.vaiTro || '', b.trang || '', b.moTa, b.thongTin || '{}').lastInsertRowid);
}
function ganAnhBaoLoi(id, anhKey) { db.prepare(`UPDATE bao_loi_app SET anh_key = ? WHERE id = ?`).run(anhKey, id); }
function demBaoLoiTu(nguoi, tuLuc) { return db.prepare(`SELECT COUNT(*) FROM bao_loi_app WHERE nguoi = ? AND luc >= ?`).pluck().get(nguoi, tuLuc); }
function layBaoLoi(id) { return db.prepare(`SELECT * FROM bao_loi_app WHERE id = ?`).get(id); }
function dsBaoLoi({ nguoi, trangThai, gioiHan = 200 } = {}) {
  const dk = [], ts = [];
  if (nguoi) { dk.push('nguoi = ?'); ts.push(nguoi); }
  if (trangThai) { dk.push('trang_thai = ?'); ts.push(trangThai); }
  return db.prepare(`SELECT * FROM bao_loi_app ${dk.length ? 'WHERE ' + dk.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...ts, gioiHan);
}
function capNhatBaoLoi(id, { trangThai, ghiChu }) {
  db.prepare(`UPDATE bao_loi_app SET trang_thai = ?, ghi_chu_xu_ly = ? WHERE id = ?`).run(trangThai, ghiChu || '', id);
}

// ---------- Logs_UploadAnh (12/10/2026): mọi thao tác ở menu Quét QR + thiết bị/phiên bản app (routes/nhatKyQuet.js). Giữ 90 ngày.
db.exec(`CREATE TABLE IF NOT EXISTS logs_upload_anh (
  id INTEGER PRIMARY KEY AUTOINCREMENT, luc TEXT NOT NULL, nguoi TEXT NOT NULL, vai_tro TEXT NOT NULL DEFAULT '', xuong TEXT NOT NULL DEFAULT '',
  su_kien TEXT NOT NULL, che_do TEXT NOT NULL DEFAULT '', stt_key TEXT NOT NULL DEFAULT '', ket_qua TEXT NOT NULL DEFAULT '', loi TEXT NOT NULL DEFAULT '',
  tong_ms INTEGER, cham INTEGER NOT NULL DEFAULT 0, chi_tiet TEXT NOT NULL DEFAULT '{}',
  he_dieu_hanh TEXT NOT NULL DEFAULT '', trinh_duyet TEXT NOT NULL DEFAULT '', may TEXT NOT NULL DEFAULT '', phien_ban_app TEXT NOT NULL DEFAULT '',
  thong_tin TEXT NOT NULL DEFAULT '{}'
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_upload_anh_luc ON logs_upload_anh(luc)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_upload_anh_thoat ON logs_upload_anh(su_kien, nguoi, stt_key)`);
// chi_tiet hỏng (dữ liệu cũ/ghi tay) không được làm hỏng truy vấn json_extract của cả bảng tổng hợp
const SQL_CT = `CASE WHEN json_valid(chi_tiet) THEN chi_tiet ELSE '{}' END`;
const SO_NGAY_GIU_LOGS_UPLOAD_ANH = 90;
let lanDonLogsUploadAnh = 0;
const ghiNhieuLogsUploadAnh = db.transaction(ds => {
  const st = db.prepare(`INSERT INTO logs_upload_anh (luc, nguoi, vai_tro, xuong, su_kien, che_do, stt_key, ket_qua, loi, tong_ms, cham, chi_tiet,
      he_dieu_hanh, trinh_duyet, may, phien_ban_app, thong_tin)
    VALUES (@luc, @nguoi, @vaiTro, @xuong, @suKien, @cheDo, @sttKey, @ketQua, @loi, @tongMs, @cham, @chiTiet, @heDieuHanh, @trinhDuyet, @may, @phienBanApp, @thongTin)`);
  // Ảnh đã bị ghi "thoát giữa chừng" lúc trang tạm cất, rồi người dùng quay lại và ảnh tải xong (chi_tiet.sauThoat) -> xoá dòng THOAT
  // gần nhất của đúng người + đơn đó, để 1 ảnh không bị đếm cả "thoát" lẫn "chụp" (scan.html#pagehide).
  // CHỈ dòng THOAT tạm (chi_tiet.tamCat — ghi lúc trang bị cất) trong 6 giờ gần đây: không xoá nhầm 1 lượt thoát THẬT của hôm trước.
  const xoaThoat = db.prepare(`DELETE FROM logs_upload_anh WHERE id = (SELECT id FROM logs_upload_anh
    WHERE su_kien = 'THOAT_GIUA_CHUNG' AND nguoi = ? AND stt_key = ? AND luc >= ? AND json_extract(${SQL_CT}, '$.tamCat') = 1
    ORDER BY id DESC LIMIT 1)`);
  const moc6Gio = new Date(Date.now() + 7 * 3600000 - 6 * 3600000).toISOString().slice(0, 19); // giờ VN, so chuỗi với luc (...+07:00)
  for (const d of ds) {
    if (d.suKien === 'CHUP_ANH' && /"sauThoat":true/.test(d.chiTiet)) xoaThoat.run(d.nguoi, d.sttKey, moc6Gio);
    st.run(d);
  }
  // Dọn dòng cũ hơn 90 ngày — tối đa 1 lần/giờ (không cần job riêng). So chuỗi được: luc luôn dạng ...+07:00.
  if (Date.now() - lanDonLogsUploadAnh > 3600 * 1000) {
    lanDonLogsUploadAnh = Date.now();
    const moc = new Date(Date.now() - SO_NGAY_GIU_LOGS_UPLOAD_ANH * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
    db.prepare(`DELETE FROM logs_upload_anh WHERE luc < ?`).run(moc);
  }
});
// Nhóm kết quả (12/10/2026, rà soát): KY_THUAT = lỗi kỹ thuật (mạng/máy chủ/camera, ảnh chưa tải xong đã thoát) — phần dùng để so
// máy/trình duyệt; NGHIEP_VU = máy chạy đúng nhưng đơn không hợp lệ (sai trạng thái, không tìm thấy, trùng); BO_NGANG = người dùng
// bấm Quét lại sau khi đã xác định đơn. SQL dưới đây là NƠI DUY NHẤT định nghĩa nhóm (danh sách trả kèm cột nhom_kq).
const SQL_NHOM_KQ = `CASE WHEN ket_qua = 'LOI' OR su_kien = 'THOAT_GIUA_CHUNG' THEN 'KY_THUAT'
  WHEN ket_qua IN ('SAI_TRANG_THAI', 'KHONG_TIM_THAY', 'TRUNG', 'CO_DON_LOI') THEN 'NGHIEP_VU' WHEN ket_qua = 'BO_NGANG' THEN 'BO_NGANG' ELSE '' END`;
// Lọc: tu/den = 'YYYY-MM-DD' (ngày VN, đến hết ngày "den"); nguoi khớp chính xác; nhomKq = KY_THUAT/NGHIEP_VU/BO_NGANG; chiCham = lượt chụp chậm.
function dieuKienLogsUploadAnh({ tu, den, tuLuc, nguoi, suKien, nhomKq, chiCham } = {}) {
  const dk = [], ts = [];
  if (tuLuc) { dk.push('luc >= ?'); ts.push(String(tuLuc)); } // mốc giờ VN đầy đủ (thoiGianVNISOString) — báo cáo logs 24 giờ (baoCaoLogService.js)
  if (/^\d{4}-\d{2}-\d{2}$/.test(tu || '')) { dk.push('luc >= ?'); ts.push(tu); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(den || '')) { dk.push('luc < ?'); ts.push(den + 'T99'); }
  if (nguoi) { dk.push('nguoi = ?'); ts.push(nguoi); }
  if (suKien) { dk.push('su_kien = ?'); ts.push(suKien); }
  if (['KY_THUAT', 'NGHIEP_VU', 'BO_NGANG'].includes(nhomKq)) { dk.push(`(${SQL_NHOM_KQ}) = ?`); ts.push(nhomKq); }
  if (chiCham) dk.push('cham = 1');
  return { where: dk.length ? 'WHERE ' + dk.join(' AND ') : '', ts };
}
function dsLogsUploadAnh(loc = {}) {
  const { where, ts } = dieuKienLogsUploadAnh(loc);
  return db.prepare(`SELECT *, ${SQL_NHOM_KQ} AS nhom_kq FROM logs_upload_anh ${where} ORDER BY id DESC LIMIT ?`).all(...ts, loc.gioiHan || 500);
}
// Nguồn cho bảng tổng hợp: chỉ các cột cần + số đo rút bằng json_extract (không JSON.parse từng dòng ở Node), duyệt từng dòng
// (không nạp cả khoảng ngày vào bộ nhớ, không cắt bớt dòng cũ).
function duyetTongHopLogsUploadAnh(loc = {}) {
  const { where, ts } = dieuKienLogsUploadAnh(loc);
  // json_valid chỉ tính 1 lần/dòng (cột ct của truy vấn con). "LIMIT -1 OFFSET 0" chặn SQLite gộp truy vấn con vào truy vấn ngoài
  // (gộp thì biểu thức ct bị chép lại vào từng json_extract) mà vẫn duyệt từng dòng, không dựng bảng tạm.
  return db.prepare(`SELECT nguoi, he_dieu_hanh, trinh_duyet, may, su_kien, ket_qua, tong_ms, nhom_kq,
      json_extract(ct, '$.msNen') ms_nen, json_extract(ct, '$.msGui') ms_gui, json_extract(ct, '$.msMayChu') ms_may_chu,
      json_extract(ct, '$.msKiemTra') ms_kiem_tra, json_extract(ct, '$.msTimMa') ms_tim_ma
    FROM (SELECT nguoi, he_dieu_hanh, trinh_duyet, may, su_kien, ket_qua, tong_ms, ${SQL_NHOM_KQ} AS nhom_kq, ${SQL_CT} AS ct
      FROM logs_upload_anh ${where} LIMIT -1 OFFSET 0)`).iterate(...ts); // chỉ các cột cần (không kéo loi/thong_tin qua truy vấn con)
}

// ---------- Số đo cho báo cáo hằng ngày / hằng tuần (16/10/2026) — services/baoCaoVanHanhService.js ----------
// Thời gian máy chủ xử lý MỌI lượt của vài thao tác chính (logCapture.js#ghiLuotApi chọn thao tác) — để có số giữa / 90% từng thao tác,
// so với hôm trước. Log server chỉ ghi lượt CHẬM/lỗi nên không tính được số này. Giữ 35 ngày (baoCaoLogService dọn mỗi ngày).
db.exec(`CREATE TABLE IF NOT EXISTS thoi_gian_api (
  id INTEGER PRIMARY KEY AUTOINCREMENT, luc TEXT NOT NULL, thao_tac TEXT NOT NULL, ms INTEGER NOT NULL, ma INTEGER NOT NULL
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_thoi_gian_api_luc ON thoi_gian_api(luc)`);
const cauGhiThoiGianApi = db.prepare(`INSERT INTO thoi_gian_api (luc, thao_tac, ms, ma) VALUES (?, ?, ?, ?)`);
const ghiThoiGianApi = (luc, thaoTac, ms, ma) => cauGhiThoiGianApi.run(luc, thaoTac, ms, ma);
// tuLuc/denLuc: chuỗi giờ VN đầy đủ (thoiGianVNISOString) — so chuỗi cùng định dạng.
const layThoiGianApi = (tuLuc, denLuc) => db.prepare(`SELECT thao_tac, ms, ma FROM thoi_gian_api WHERE luc >= ? AND luc < ?`).all(tuLuc, denLuc);
const xoaThoiGianApiTruoc = luc => db.prepare(`DELETE FROM thoi_gian_api WHERE luc < ?`).run(luc).changes;
const layDoLogsUploadAnh = (tuLuc, denLuc) => db.prepare(`SELECT su_kien, ket_qua, tong_ms FROM logs_upload_anh WHERE luc >= ? AND luc < ?`).all(tuLuc, denLuc);
// Đo mạng từ trình duyệt (16/10/2026) — routes/doMang.js: mỗi dòng = 1 lần đo (ms trống = không kết nối được, loi = lý do). Giữ 35 ngày.
db.exec(`CREATE TABLE IF NOT EXISTS do_mang (
  id INTEGER PRIMARY KEY AUTOINCREMENT, luc TEXT NOT NULL, nguoi TEXT NOT NULL DEFAULT '', vai_tro TEXT NOT NULL DEFAULT '', xuong TEXT NOT NULL DEFAULT '',
  trang TEXT NOT NULL DEFAULT '', ms INTEGER, loi TEXT NOT NULL DEFAULT '', loai_mang TEXT NOT NULL DEFAULT '', mbps REAL, rtt INTEGER,
  he_dieu_hanh TEXT NOT NULL DEFAULT '', trinh_duyet TEXT NOT NULL DEFAULT '', may TEXT NOT NULL DEFAULT ''
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_do_mang_luc ON do_mang(luc)`);
// Tách đoạn (17/10/2026, public/js/api.js#doMangMotLan): ms_cf = 1 vòng Máy -> Cloudflare; ms_cf_may_chu = Cloudflare <-> máy chủ (ước lượng);
// ms_app = máy chủ xử lý; ms_xep_hang = chờ trong trình duyệt; ms_ket_noi = mở kết nối mới; colo = trạm Cloudflare (HAN/SGN/SIN...).
const COT_DO_MANG_DOAN = { ms_cf: 'INTEGER', ms_cf_may_chu: 'INTEGER', ms_app: 'INTEGER', ms_xep_hang: 'INTEGER', ms_ket_noi: 'INTEGER', colo: "TEXT NOT NULL DEFAULT ''" };
// 21/10/2026: nha_mang = nhà mạng tra từ IP trên máy chủ (services/nhaMangService.js — KHÔNG lưu IP); kieu_ket_noi = trình duyệt báo
// wifi / cellular (di động) / ethernet... (chỉ Chrome Android) — khác loai_mang ("4g" chỉ là MỨC tốc độ ước lượng, Wi-Fi nhanh cũng báo "4g").
COT_DO_MANG_DOAN.nha_mang = "TEXT NOT NULL DEFAULT ''";
COT_DO_MANG_DOAN.kieu_ket_noi = "TEXT NOT NULL DEFAULT ''";
const cotDoMangDaCo = db.prepare(`PRAGMA table_info(do_mang)`).all().map(c => c.name);
for (const [cot, kieu] of Object.entries(COT_DO_MANG_DOAN)) if (!cotDoMangDaCo.includes(cot)) db.exec(`ALTER TABLE do_mang ADD COLUMN ${cot} ${kieu}`);
const ghiNhieuDoMang = db.transaction(ds => {
  const st = db.prepare(`INSERT INTO do_mang (luc, nguoi, vai_tro, xuong, trang, ms, loi, loai_mang, mbps, rtt, he_dieu_hanh, trinh_duyet, may,
      ms_cf, ms_cf_may_chu, ms_app, ms_xep_hang, ms_ket_noi, colo, nha_mang, kieu_ket_noi)
    VALUES (@luc, @nguoi, @vaiTro, @xuong, @trang, @ms, @loi, @loaiMang, @mbps, @rtt, @heDieuHanh, @trinhDuyet, @may,
      @msCF, @msCFMayChu, @msApp, @msXepHang, @msKetNoi, @colo, @nhaMang, @kieuKetNoi)`);
  for (const d of ds) st.run({ msCF: null, msCFMayChu: null, msApp: null, msXepHang: null, msKetNoi: null, colo: '', nhaMang: '', kieuKetNoi: '', ...d });
});
// Máy chủ tự đo mỗi phút (17/10/2026, services/doMangMayChuService.js) — VPS -> Cloudflare -> (vòng lại) máy chủ, độc lập người dùng.
db.exec(`CREATE TABLE IF NOT EXISTS do_mang_may_chu (
  id INTEGER PRIMARY KEY AUTOINCREMENT, luc TEXT NOT NULL, colo TEXT NOT NULL DEFAULT '',
  ms_dns INTEGER, ms_tcp INTEGER, ms_tls INTEGER, ms_cf INTEGER, ms_cf_may_chu INTEGER, ms_app INTEGER, loi TEXT NOT NULL DEFAULT ''
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_do_mang_may_chu_luc ON do_mang_may_chu(luc)`);
// 21/10/2026 (doMangMayChuService.js): kết nối TCP tới đích trong nước / quốc tế không qua Cloudflare + CPU / lưu lượng mạng của máy chủ.
// duong_di (23/10/2026): 'cloudflare' | 'thang' (tên miền để DNS only — không đo đoạn Cloudflare) | '' (dòng cũ / không tra được DNS).
const COT_MAY_CHU_THEM = { ms_tcp_trong_nuoc: 'INTEGER', ms_tcp_quoc_te: 'INTEGER', tai_cpu: 'REAL', cpu_ban: 'INTEGER', cpu_steal: 'REAL',
  mang_vao_kbs: 'INTEGER', mang_ra_kbs: 'INTEGER', duong_di: "TEXT NOT NULL DEFAULT ''" };
const cotMayChuDaCo = db.prepare(`PRAGMA table_info(do_mang_may_chu)`).all().map(c => c.name);
for (const [cot, kieu] of Object.entries(COT_MAY_CHU_THEM)) if (!cotMayChuDaCo.includes(cot)) db.exec(`ALTER TABLE do_mang_may_chu ADD COLUMN ${cot} ${kieu}`);
const cauGhiDoMangMayChu = db.prepare(`INSERT INTO do_mang_may_chu (luc, colo, ms_dns, ms_tcp, ms_tls, ms_cf, ms_cf_may_chu, ms_app, loi,
    ms_tcp_trong_nuoc, ms_tcp_quoc_te, tai_cpu, cpu_ban, cpu_steal, mang_vao_kbs, mang_ra_kbs, duong_di)
  VALUES (@luc, @colo, @msDns, @msTcp, @msTls, @msCF, @msCFMayChu, @msApp, @loi,
    @msTcpTrongNuoc, @msTcpQuocTe, @taiCpu, @cpuBan, @cpuSteal, @mangVaoKbs, @mangRaKbs, @duongDi)`);
const ghiDoMangMayChu = d => cauGhiDoMangMayChu.run({ colo: '', msDns: null, msTcp: null, msTls: null, msCF: null, msCFMayChu: null, msApp: null, loi: '',
  msTcpTrongNuoc: null, msTcpQuocTe: null, taiCpu: null, cpuBan: null, cpuSteal: null, mangVaoKbs: null, mangRaKbs: null, duongDi: '', ...d });
const layDoMangMayChu = (tuLuc, denLuc) => db.prepare(`SELECT * FROM do_mang_may_chu WHERE luc >= ? AND luc < ? ORDER BY luc`).all(tuLuc, denLuc);
const xoaDoMangMayChuTruoc = luc => db.prepare(`DELETE FROM do_mang_may_chu WHERE luc < ?`).run(luc).changes;
const layDoMang = (tuLuc, denLuc) => db.prepare(`SELECT * FROM do_mang WHERE luc >= ? AND luc < ? ORDER BY luc`).all(tuLuc, denLuc);
const xoaDoMangTruoc = luc => db.prepare(`DELETE FROM do_mang WHERE luc < ?`).run(luc).changes;
// Đo TỐC ĐỘ đường truyền (22/10/2026, theo yêu cầu người dùng — máy chủ ở nhà Hà Nội, điện thoại ở xưởng HN/BN, 2 đường mạng khác nhau: cần
// biết đường nào nghẽn). Cả 2 nguồn đo tới CÙNG 1 đích (speed.cloudflare.com, không qua máy chủ app) để so được cùng giờ:
//   nguon 'may_chu'    — Zima tự tải xuống + tải lên 1MB mỗi 15 phút (doMangMayChuService.js) = sức chứa đường mạng nhà
//   nguon 'dien_thoai' — điện thoại ở trang Quét tải lên 256KB mỗi 10 phút (api.js) = sức chứa chiều lên của đường mạng xưởng
// huong: 'len' / 'xuong'; kb = dung lượng; ms = thời gian truyền; kbs = kb / giây; ms_rtt = 1 vòng tới Cloudflare ngay trước đó (điện thoại).
db.exec(`CREATE TABLE IF NOT EXISTS do_toc_do (
  id INTEGER PRIMARY KEY AUTOINCREMENT, luc TEXT NOT NULL, nguon TEXT NOT NULL DEFAULT '', huong TEXT NOT NULL DEFAULT '',
  kb INTEGER, ms INTEGER, kbs INTEGER, ms_rtt INTEGER, colo TEXT NOT NULL DEFAULT '', nha_mang TEXT NOT NULL DEFAULT '',
  kieu_ket_noi TEXT NOT NULL DEFAULT '', nguoi TEXT NOT NULL DEFAULT '', xuong TEXT NOT NULL DEFAULT '', may TEXT NOT NULL DEFAULT '',
  loi TEXT NOT NULL DEFAULT ''
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_do_toc_do_luc ON do_toc_do(luc)`);
const cauGhiTocDo = db.prepare(`INSERT INTO do_toc_do (luc, nguon, huong, kb, ms, kbs, ms_rtt, colo, nha_mang, kieu_ket_noi, nguoi, xuong, may, loi)
  VALUES (@luc, @nguon, @huong, @kb, @ms, @kbs, @msRtt, @colo, @nhaMang, @kieuKetNoi, @nguoi, @xuong, @may, @loi)`);
const ghiNhieuTocDo = db.transaction(ds => {
  for (const d of ds) cauGhiTocDo.run({ kb: null, ms: null, kbs: null, msRtt: null, colo: '', nhaMang: '', kieuKetNoi: '', nguoi: '', xuong: '', may: '', loi: '', ...d });
});
const layTocDo = (tuLuc, denLuc) => db.prepare(`SELECT * FROM do_toc_do WHERE luc >= ? AND luc < ? ORDER BY luc`).all(tuLuc, denLuc);
const xoaTocDoTruoc = luc => db.prepare(`DELETE FROM do_toc_do WHERE luc < ?`).run(luc).changes;
const layQcLogTrongKhoang = (tuLuc, denLuc) => db.prepare(`SELECT STT_Key, LoaiQc, KetQua FROM qc_log WHERE ThoiGian >= ? AND ThoiGian < ? AND CheDo != 'TEST'`).all(tuLuc, denLuc);

module.exports = {
  ghiThoiGianApi, layThoiGianApi, xoaThoiGianApiTruoc, layDoLogsUploadAnh, layQcLogTrongKhoang, ghiNhieuDoMang, layDoMang, xoaDoMangTruoc, ghiDoMangMayChu, layDoMangMayChu, xoaDoMangMayChuTruoc,
  ghiNhieuTocDo, layTocDo, xoaTocDoTruoc,
  ghiNhieuLogsUploadAnh, dsLogsUploadAnh, duyetTongHopLogsUploadAnh, danhDauDaXuLy, layDaXuLy, donDaXuLyKhongConDung, themDonCanCheck, suaDonCanCheck, danhDauDaCheck, layDonCanCheck, themBaoLoi, ganAnhBaoLoi, demBaoLoiTu, layBaoLoi, dsBaoLoi, capNhatBaoLoi,
  layNote, layDanhSachNote, layTatCaTheNote, taoNote, suaNote, datAnhNote, xoaNote,
  ghiQcLog, layQcLog, layQcLogTheoId, danhGiaQcLog, thongKeDanhGiaQc, thongKeTokenQc, layDongDaDanhGiaCoAi, maxQcLogId, layCclSauId, tongKetQcNgay,
  taoKinhNghiem, suaKinhNghiem, doiTrangThaiKinhNghiem, layKinhNghiemTheoId, layDanhSachKinhNghiem, layKinhNghiemApDung, tangSoLanDungKinhNghiem, giuQuyenAutoQc, ketThucAutoQc, layTatCaAutoQc, donDepAutoQcDangChay,
  ghiNhieuDongBoSheetSeller, layNhatKyDongBoSheetSeller, layLoiDongBoDangCho, dsKeySoMuiLoiDangCho, layDongBoGanNhat, xoaDongBoSheetSellerTheoDon,
  ghiLichSuHoatDong, ghiNhieuLichSuHoatDong, layTatCaLichSuHoatDong, xoaLichSuHoatDongTheoDon,
  ghiNhatKyQuetHangLoat, xoaNhatKyQuetHangLoatTheoDon,
  ghiLogsTracking, layTatCaLogsTracking, xoaLogsTrackingTheoDon,
};
