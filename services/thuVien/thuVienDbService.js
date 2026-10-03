const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { thoiGianVNISOString } = require('../dateUtils');

// ============================================================
// Thư viện thiết kế thêu — menu "Tìm ảnh" (03/10/2026). Thiết kế: docs/superpowers/specs/2026-10-03-thu-vien-tim-anh-design.md.
// DB riêng (không chung trang_thai_don.db) — thư viện tăng trưởng độc lập, xoá/khôi phục không ảnh hưởng đơn hàng.
// ============================================================
const DUONG_DAN_DB = process.env.THU_VIEN_DB_PATH || path.join(__dirname, '..', '..', 'data', 'thu_vien.db');
fs.mkdirSync(path.dirname(DUONG_DAN_DB), { recursive: true });

const db = new Database(DUONG_DAN_DB);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS tv_file (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loai TEXT NOT NULL,                       -- PNG / EMB
  stt_key TEXT NOT NULL,
  so_thu_tu INTEGER NOT NULL,               -- PNG: n trong <STT_Key>_<n>; EMB: số phiên bản
  la_ban_chinh INTEGER NOT NULL DEFAULT 1,
  object_key TEXT NOT NULL,
  ten_file_goc TEXT NOT NULL DEFAULT '',
  nguon TEXT NOT NULL,                      -- SHEET / EXCEL / UPLOAD
  url_goc TEXT NOT NULL DEFAULT '',
  drive_file_id TEXT NOT NULL DEFAULT '',
  sha256 TEXT NOT NULL,
  kich_thuoc INTEGER NOT NULL DEFAULT 0,
  dhash TEXT NOT NULL DEFAULT '',
  dhash_hinh_dang TEXT NOT NULL DEFAULT '',
  thumb_key TEXT NOT NULL DEFAULT '',
  nguoi_tai_len TEXT NOT NULL DEFAULT '',
  ngay_luu TEXT NOT NULL,
  trang_thai TEXT NOT NULL,                 -- DANG_LUU (tạm, đang ghi MinIO) / DANG_TINH (đã lưu, đang tính hash) / XONG / LOI_HASH
  ms_xu_ly INTEGER NOT NULL DEFAULT 0,
  UNIQUE (stt_key, loai, so_thu_tu),
  UNIQUE (stt_key, loai, sha256)
);
CREATE INDEX IF NOT EXISTS idx_tv_file_sha ON tv_file (sha256);

CREATE TABLE IF NOT EXISTS tv_hang_cho (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stt_key TEXT NOT NULL,
  url TEXT NOT NULL,
  nguon TEXT NOT NULL,                      -- SHEET / EXCEL (nguồn ĐẦU TIÊN thêm việc này)
  nguoi TEXT NOT NULL DEFAULT '',           -- người nhập Excel (rỗng với SHEET)
  uu_tien INTEGER NOT NULL DEFAULT 0,       -- 0 = Drive/MinIO/http, 1 = Gemini (chậm — chạy sau)
  trang_thai TEXT NOT NULL DEFAULT 'CHO',   -- CHO / DANG_CHAY / XONG / LOI (sẽ thử lại) / LOI_CUOI
  so_lan_thu INTEGER NOT NULL DEFAULT 0,
  thu_lai_luc INTEGER NOT NULL DEFAULT 0,   -- epoch ms
  loi_cuoi TEXT NOT NULL DEFAULT '',
  ghi_chu TEXT NOT NULL DEFAULT '',         -- file bị bỏ qua vĩnh viễn (sai định dạng, quá lớn...) — không phải lỗi để thử lại
  so_file INTEGER NOT NULL DEFAULT 0,
  tao_luc TEXT NOT NULL,
  cap_nhat_luc TEXT NOT NULL,
  UNIQUE (stt_key, url)
);
CREATE INDEX IF NOT EXISTS idx_tv_hang_cho_lay ON tv_hang_cho (trang_thai, uu_tien, id);

CREATE TABLE IF NOT EXISTS tv_lo_excel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ten_file TEXT NOT NULL,
  nguoi TEXT NOT NULL,
  tao_luc TEXT NOT NULL,
  tong_dong INTEGER NOT NULL,
  so_viec_moi INTEGER NOT NULL
);
-- Mỗi (dòng Excel, link) 1 bản ghi; dòng không có link hợp lệ: url = '' + ly_do, viec_id NULL. viec_id = việc trong
-- tv_hang_cho (có thể đã có từ lô trước/cron) — tra tiến độ/kết quả theo khoá số thay vì nối chuỗi (stt_key, url).
CREATE TABLE IF NOT EXISTS tv_lo_dong (
  lo_id INTEGER NOT NULL,
  dong INTEGER NOT NULL,
  stt_key TEXT NOT NULL,
  url TEXT NOT NULL,
  ly_do TEXT NOT NULL DEFAULT '',
  viec_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tv_lo_dong ON tv_lo_dong (lo_id, dong);

CREATE TABLE IF NOT EXISTS tv_cai_dat (khoa TEXT PRIMARY KEY, gia_tri TEXT NOT NULL DEFAULT '');

-- Quyết định của người vẽ khi xem 1 thiết kế cũ cho đơn mới (giai đoạn 2) — CHỈ ghi nhận, không đổi đơn hay file.
CREATE TABLE IF NOT EXISTS tv_quyet_dinh (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stt_key_moi TEXT NOT NULL,
  file_id INTEGER NOT NULL,
  quyet_dinh TEXT NOT NULL,                 -- DA_KIEM / TAI_SU_DUNG / VE_MOI
  ghi_chu TEXT NOT NULL DEFAULT '',
  nguoi TEXT NOT NULL,
  thoi_gian TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tv_quyet_dinh_don ON tv_quyet_dinh (stt_key_moi);

-- Giá trị DUONG_DAN_URL lần cuối cron đã thấy của từng đơn (giai đoạn 3) — chỉ đơn có giá trị đổi mới đưa link vào hàng chờ.
CREATE TABLE IF NOT EXISTS tv_nguon_don (stt_key TEXT PRIMARY KEY, gia_tri TEXT NOT NULL, lan_thay TEXT NOT NULL);

-- Cặp ảnh thật người dùng đánh giá để đo ngưỡng (giai đoạn 4). file_a < file_b (chuẩn hoá để 1 cặp chỉ 1 dòng).
CREATE TABLE IF NOT EXISTS tv_cap_danh_gia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_a INTEGER NOT NULL,
  file_b INTEGER NOT NULL,
  ket_luan TEXT NOT NULL,                   -- CUNG (cùng thiết kế) / KHAC (khác thiết kế)
  nguoi TEXT NOT NULL,
  thoi_gian TEXT NOT NULL,
  UNIQUE (file_a, file_b)
);
`);

// viec_id thêm sau bản đầu (03/10/2026, rà soát) — bảng tạo từ bản cũ chưa có cột: thêm + điền 1 lần (chạy lại vô hại).
if (!db.prepare(`PRAGMA table_info(tv_lo_dong)`).all().some(c => c.name === 'viec_id')) {
  db.exec(`ALTER TABLE tv_lo_dong ADD COLUMN viec_id INTEGER`);
}
db.exec(`UPDATE tv_lo_dong SET viec_id = (SELECT h.id FROM tv_hang_cho h WHERE h.stt_key = tv_lo_dong.stt_key AND h.url = tv_lo_dong.url)
  WHERE viec_id IS NULL AND url != ''`);

// ---------- cài đặt ----------
function layCaiDat(khoa) {
  const r = db.prepare(`SELECT gia_tri FROM tv_cai_dat WHERE khoa = ?`).get(khoa);
  return r ? r.gia_tri : '';
}
function datCaiDat(khoa, giaTri) {
  db.prepare(`INSERT INTO tv_cai_dat (khoa, gia_tri) VALUES (?, ?) ON CONFLICT(khoa) DO UPDATE SET gia_tri = excluded.gia_tri`).run(khoa, String(giaTri));
}

// ---------- hàng chờ ----------
const stmtThemViec = db.prepare(`INSERT OR IGNORE INTO tv_hang_cho (stt_key, url, nguon, nguoi, uu_tien, tao_luc, cap_nhat_luc)
  VALUES (@sttKey, @url, @nguon, @nguoi, @uuTien, @luc, @luc)`);
// -> số việc MỚI thực sự được thêm (việc trùng (stt_key, url) đã có thì bỏ qua).
const themNhieuViec = db.transaction(dsViec => {
  const luc = thoiGianVNISOString();
  let moi = 0;
  for (const v of dsViec) moi += stmtThemViec.run({ nguoi: '', ...v, luc }).changes;
  return moi;
});

function layViecKeTiep(bayGioMs) {
  return db.prepare(`SELECT * FROM tv_hang_cho WHERE trang_thai IN ('CHO', 'LOI') AND thu_lai_luc <= ?
    ORDER BY uu_tien, id LIMIT 1`).get(bayGioMs);
}

const COT_VIEC_SUA_DUOC = ['trang_thai', 'so_lan_thu', 'thu_lai_luc', 'loi_cuoi', 'ghi_chu', 'so_file'];
function capNhatViec(id, thayDoi) {
  const cot = Object.keys(thayDoi).filter(c => COT_VIEC_SUA_DUOC.includes(c));
  if (!cot.length) return;
  db.prepare(`UPDATE tv_hang_cho SET ${cot.map(c => `${c} = @${c}`).join(', ')}, cap_nhat_luc = @luc WHERE id = @id`)
    .run({ ...thayDoi, luc: thoiGianVNISOString(), id });
}

// Số link đã xong + tổng file các link đó đã lưu — để ước tính "ảnh/link" ở điểm dừng đo. CHỈ tính việc XONG: file của thư
// mục đang tải dở / việc lỗi giữa chừng mà tính vào tử số (chia cho số việc XONG) sẽ thổi phồng ước tính nhiều lần.
function thongKeViecXong() {
  return db.prepare(`SELECT COUNT(*) soLink, COALESCE(SUM(so_file), 0) soFile FROM tv_hang_cho WHERE trang_thai = 'XONG'`).get();
}

function demViecTheoTrangThai() {
  const kq = { CHO: 0, DANG_CHAY: 0, XONG: 0, LOI: 0, LOI_CUOI: 0 };
  for (const r of db.prepare(`SELECT trang_thai, COUNT(*) n FROM tv_hang_cho GROUP BY trang_thai`).all()) kq[r.trang_thai] = r.n;
  return kq;
}

// Đưa việc lỗi về hàng chờ, chạy ngay. ids rỗng/không truyền = mọi việc LOI/LOI_CUOI.
function thuLaiViec(ids) {
  tienDoLoDaXong.clear(); // việc LOI_CUOI quay lại hàng chờ -> lô "đã xong" có thể chạy lại
  const luc = thoiGianVNISOString();
  if (!ids) return db.prepare(`UPDATE tv_hang_cho SET trang_thai = 'CHO', so_lan_thu = 0, thu_lai_luc = 0, cap_nhat_luc = ?
    WHERE trang_thai IN ('LOI', 'LOI_CUOI')`).run(luc).changes;
  const stmt = db.prepare(`UPDATE tv_hang_cho SET trang_thai = 'CHO', so_lan_thu = 0, thu_lai_luc = 0, cap_nhat_luc = ?
    WHERE id = ? AND trang_thai IN ('LOI', 'LOI_CUOI')`);
  return db.transaction(() => ids.reduce((n, id) => n + stmt.run(luc, id).changes, 0))();
}

function dsViecLoi(gioiHan = 500) {
  return db.prepare(`SELECT id, stt_key, url, nguon, trang_thai, so_lan_thu, thu_lai_luc, loi_cuoi, cap_nhat_luc
    FROM tv_hang_cho WHERE trang_thai IN ('LOI', 'LOI_CUOI') ORDER BY trang_thai DESC, id LIMIT ?`).all(gioiHan);
}

// ---------- file ----------
function timFileTheoSha(sttKey, loai, sha256) {
  return db.prepare(`SELECT * FROM tv_file WHERE stt_key = ? AND loai = ? AND sha256 = ?`).get(sttKey, loai, sha256);
}
function daCoDriveFile(sttKey, driveFileId) {
  return !!db.prepare(`SELECT 1 FROM tv_file WHERE stt_key = ? AND drive_file_id = ? AND trang_thai != 'DANG_LUU'`).get(sttKey, driveFileId);
}
function thumbCuaSha(sha256) {
  const r = db.prepare(`SELECT thumb_key FROM tv_file WHERE sha256 = ? AND thumb_key != '' LIMIT 1`).get(sha256);
  return r ? r.thumb_key : '';
}

// Giữ chỗ số thứ tự + ghi bản ghi DANG_LUU trong CÙNG 1 transaction (better-sqlite3 đồng bộ — không có await chen giữa
// đọc MAX và INSERT). taoObjectKey(n) dựng key MinIO từ số vừa cấp. -> { id, soThuTu, objectKey }
const giuChoFile = db.transaction((thongTin, taoObjectKey) => {
  const { m } = db.prepare(`SELECT COALESCE(MAX(so_thu_tu), 0) m FROM tv_file WHERE stt_key = ? AND loai = ?`).get(thongTin.sttKey, thongTin.loai);
  const soThuTu = m + 1;
  const objectKey = taoObjectKey(soThuTu);
  const { lastInsertRowid } = db.prepare(`INSERT INTO tv_file (loai, stt_key, so_thu_tu, object_key, ten_file_goc, nguon, url_goc,
      drive_file_id, sha256, kich_thuoc, nguoi_tai_len, ngay_luu, trang_thai)
    VALUES (@loai, @sttKey, @soThuTu, @objectKey, @tenFileGoc, @nguon, @urlGoc, @driveFileId, @sha256, @kichThuoc, @nguoiTaiLen, @ngayLuu, 'DANG_LUU')`)
    .run({ tenFileGoc: '', urlGoc: '', driveFileId: '', nguoiTaiLen: '', ...thongTin, soThuTu, objectKey, ngayLuu: thoiGianVNISOString() });
  return { id: Number(lastInsertRowid), soThuTu, objectKey };
});

const COT_FILE_SUA_DUOC = ['dhash', 'dhash_hinh_dang', 'thumb_key', 'trang_thai', 'ms_xu_ly'];
// Phiên bản chỉ mục tìm kiếm (giai đoạn 2): tăng mỗi khi hash/trạng thái 1 file đổi — timKiemService.js dựng lại bộ nhớ
// đệm hash khi số này khác. Mọi ghi tv_file đều đi qua module này (cùng 1 tiến trình) nên đếm trong RAM là đủ.
// Kèm danh sách id đã đổi theo phiên bản để cập nhật DẦN (nhập lịch sử: mỗi giây 1 file mới — dựng lại cả chỉ mục 200.000
// file mất ~0,6 giây mỗi lần tìm, chặn cả app). Giữ tối đa SO_THAY_DOI_GIU_LAI thay đổi gần nhất; cũ hơn -> dựng lại toàn bộ.
let phienBanChiMuc = 0;
const thayDoiChiMuc = []; // [{ phienBan, id }] tăng dần
const SO_THAY_DOI_GIU_LAI = 20000;
const layPhienBanChiMuc = () => phienBanChiMuc;
// id các file đổi SAU phiên bản `tu`; null nếu không còn đủ lịch sử (nơi gọi dựng lại toàn bộ).
function layIdDoiSauPhienBan(tu) {
  if (tu === phienBanChiMuc) return [];
  if (!thayDoiChiMuc.length || thayDoiChiMuc[0].phienBan > tu + 1) return null;
  return [...new Set(thayDoiChiMuc.filter(x => x.phienBan > tu).map(x => x.id))];
}
function capNhatFile(id, thayDoi) {
  const cot = Object.keys(thayDoi).filter(c => COT_FILE_SUA_DUOC.includes(c));
  if (!cot.length) return;
  db.prepare(`UPDATE tv_file SET ${cot.map(c => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...thayDoi, id });
  if (cot.some(c => c !== 'ms_xu_ly' && c !== 'thumb_key')) {
    thayDoiChiMuc.push({ phienBan: ++phienBanChiMuc, id });
    if (thayDoiChiMuc.length > SO_THAY_DOI_GIU_LAI) thayDoiChiMuc.splice(0, thayDoiChiMuc.length - SO_THAY_DOI_GIU_LAI);
  }
}
function xoaFileDangLuu(id) {
  db.prepare(`DELETE FROM tv_file WHERE id = ? AND trang_thai = 'DANG_LUU'`).run(id);
}
function layFile(id) {
  return db.prepare(`SELECT * FROM tv_file WHERE id = ? AND trang_thai != 'DANG_LUU'`).get(id);
}
function dsFileLoiHash(gioiHan = 500) {
  return db.prepare(`SELECT id, stt_key, ten_file_goc, object_key, ngay_luu FROM tv_file WHERE trang_thai = 'LOI_HASH' ORDER BY id LIMIT ?`).all(gioiHan);
}
function dsFileMoiNhat(gioiHan = 12) {
  return db.prepare(`SELECT id, loai, stt_key, ten_file_goc, nguon, kich_thuoc, thumb_key, ngay_luu FROM tv_file
    WHERE trang_thai != 'DANG_LUU' ORDER BY id DESC LIMIT ?`).all(gioiHan);
}
function thongKeFile() {
  return db.prepare(`SELECT COUNT(*) soFile, COALESCE(SUM(kich_thuoc), 0) tongByte FROM tv_file WHERE trang_thai != 'DANG_LUU'`).get();
}
// Chỉ PNG do hàng chờ tải (Sheet/Excel) — để ước tính dung lượng NAS còn cần và điểm dừng đo: EMB (vài trăm KB) và file tải
// tay không phải thứ hàng chờ sẽ tải tiếp, tính vào làm lệch số MB/ảnh.
function thongKePngHangCho() {
  return db.prepare(`SELECT COUNT(*) soFile, COALESCE(SUM(kich_thuoc), 0) tongByte FROM tv_file
    WHERE loai = 'PNG' AND nguon IN ('SHEET', 'EXCEL') AND trang_thai != 'DANG_LUU'`).get();
}

// ---------- giai đoạn 2: tìm kiếm, tra theo đơn, EMB ----------
// Dữ liệu cho chỉ mục tìm kiếm: mọi PNG đã lưu (kể cả LOI_HASH — vẫn so được trùng file theo sha256).
function dsChiMucPng(ids) {
  const sql = `SELECT id, stt_key, sha256, dhash, dhash_hinh_dang FROM tv_file WHERE loai = 'PNG' AND trang_thai != 'DANG_LUU'`;
  if (!ids) return db.prepare(sql).all();
  const kq = [];
  for (let i = 0; i < ids.length; i += 500) { const lo = ids.slice(i, i + 500); kq.push(...db.prepare(`${sql} AND id IN (${lo.map(() => '?').join(',')})`).all(...lo)); }
  return kq;
}
const COT_HIEN_THI = `id, loai, stt_key, so_thu_tu, la_ban_chinh, ten_file_goc, nguon, url_goc, ngay_luu, nguoi_tai_len, kich_thuoc, thumb_key, object_key, trang_thai`;
function layFileTheoIds(ids) {
  if (!ids.length) return [];
  return db.prepare(`SELECT ${COT_HIEN_THI} FROM tv_file WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
}
function dsFileCuaDon(sttKey) {
  return db.prepare(`SELECT ${COT_HIEN_THI} FROM tv_file WHERE stt_key = ? AND trang_thai != 'DANG_LUU' ORDER BY loai DESC, so_thu_tu`).all(sttKey);
}
// EMB bản chính của nhiều đơn 1 lần -> Map stt_key -> { id, ten_file_goc, so_thu_tu, ngay_luu }.
function embChinhCuaCacDon(sttKeys) {
  const kq = new Map();
  const stmt = db.prepare(`SELECT id, stt_key, ten_file_goc, so_thu_tu, ngay_luu FROM tv_file
    WHERE stt_key = ? AND loai = 'EMB' AND trang_thai = 'XONG' ORDER BY la_ban_chinh DESC, so_thu_tu DESC LIMIT 1`);
  for (const k of new Set(sttKeys)) { const r = stmt.get(k); if (r) kq.set(k, r); }
  return kq;
}
function dsMaTrongThuVien() {
  return db.prepare(`SELECT DISTINCT stt_key FROM tv_file WHERE trang_thai != 'DANG_LUU'`).pluck().all();
}
function demViecChuaXongCuaDon(sttKey) {
  return db.prepare(`SELECT COUNT(*) FROM tv_hang_cho WHERE stt_key = ? AND trang_thai IN ('CHO', 'DANG_CHAY', 'LOI')`).pluck().get(sttKey);
}
// EMB vừa ghi MinIO xong -> XONG; bản chính = phiên bản SỐ LỚN NHẤT đã lưu xong, các bản khác là lịch sử (KHÔNG xoá bản nào).
// Không lấy "bản vừa lưu xong" làm bản chính: 2 lần tải lên chồng nhau (v3 chậm, v4 nhanh) thì v3 xong sau sẽ cướp bản chính,
// lệch với nơi hiển thị lấy số phiên bản lớn nhất.
const datBanChinhEmb = db.transaction((sttKey, id) => {
  db.prepare(`UPDATE tv_file SET trang_thai = 'XONG' WHERE id = ?`).run(id);
  db.prepare(`UPDATE tv_file SET la_ban_chinh = (id = (SELECT id FROM tv_file WHERE stt_key = @k AND loai = 'EMB' AND trang_thai = 'XONG'
      ORDER BY so_thu_tu DESC LIMIT 1)) WHERE stt_key = @k AND loai = 'EMB'`).run({ k: sttKey });
});
function themQuyetDinh({ sttKeyMoi, fileId, quyetDinh, ghiChu, nguoi }) {
  db.prepare(`INSERT INTO tv_quyet_dinh (stt_key_moi, file_id, quyet_dinh, ghi_chu, nguoi, thoi_gian) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(sttKeyMoi, fileId, quyetDinh, ghiChu || '', nguoi, thoiGianVNISOString());
}
function dsQuyetDinhCuaDon(sttKeyMoi) {
  return db.prepare(`SELECT q.*, f.stt_key AS stt_key_cu, f.so_thu_tu, f.loai FROM tv_quyet_dinh q LEFT JOIN tv_file f ON f.id = q.file_id
    WHERE q.stt_key_moi = ? ORDER BY q.id DESC`).all(sttKeyMoi);
}

// ---------- giai đoạn 3: tự động lấy link PNG từ Sheet ----------
function layNguonDon() {
  return new Map(db.prepare(`SELECT stt_key, gia_tri FROM tv_nguon_don`).all().map(r => [r.stt_key, r.gia_tri]));
}
const ghiNguonDon = db.transaction(ds => {
  const stmt = db.prepare(`INSERT INTO tv_nguon_don (stt_key, gia_tri, lan_thay) VALUES (?, ?, ?)
    ON CONFLICT(stt_key) DO UPDATE SET gia_tri = excluded.gia_tri, lan_thay = excluded.lan_thay`);
  const luc = thoiGianVNISOString();
  for (const d of ds) stmt.run(d.sttKey, d.giaTri, luc);
});

// ---------- giai đoạn 4: cặp ảnh đánh giá để đo ngưỡng ----------
const chuanCap = (a, b) => (a < b ? [a, b] : [b, a]);
function luuCapDanhGia({ fileA, fileB, ketLuan, nguoi }) {
  const [a, b] = chuanCap(fileA, fileB);
  db.prepare(`INSERT INTO tv_cap_danh_gia (file_a, file_b, ket_luan, nguoi, thoi_gian) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(file_a, file_b) DO UPDATE SET ket_luan = excluded.ket_luan, nguoi = excluded.nguoi, thoi_gian = excluded.thoi_gian`)
    .run(a, b, ketLuan, nguoi, thoiGianVNISOString());
}
// Mọi cặp đã đánh giá kèm hash HIỆN TẠI của 2 file (hash tính lại thì điểm đo theo hash mới).
function dsCapDanhGia() {
  return db.prepare(`SELECT c.id, c.file_a, c.file_b, c.ket_luan, c.nguoi, c.thoi_gian,
      a.stt_key stt_a, a.dhash dhash_a, a.dhash_hinh_dang hd_a, b.stt_key stt_b, b.dhash dhash_b, b.dhash_hinh_dang hd_b
    FROM tv_cap_danh_gia c JOIN tv_file a ON a.id = c.file_a JOIN tv_file b ON b.id = c.file_b ORDER BY c.id`).all();
}
function xoaCapDanhGia(id) {
  return db.prepare(`DELETE FROM tv_cap_danh_gia WHERE id = ?`).run(id).changes;
}
// 1 PNG ngẫu nhiên có đủ 2 hash (chọn theo id ngẫu nhiên — không ORDER BY RANDOM() cả bảng).
function layPngNgauNhien() {
  const { lo, hi } = db.prepare(`SELECT MIN(id) lo, MAX(id) hi FROM tv_file`).get();
  if (!hi) return null;
  const tu = lo + Math.floor(Math.random() * (hi - lo + 1));
  const sql = `SELECT id, stt_key, sha256, dhash, dhash_hinh_dang FROM tv_file WHERE loai = 'PNG' AND trang_thai = 'XONG' AND dhash != '' AND dhash_hinh_dang != ''`;
  return db.prepare(`${sql} AND id >= ? ORDER BY id LIMIT 1`).get(tu) || db.prepare(`${sql} ORDER BY id LIMIT 1`).get();
}

// ---------- giai đoạn 5: thống kê ----------
function thongKeTheoDon() {
  return db.prepare(`SELECT stt_key, SUM(loai = 'PNG') png, SUM(loai = 'EMB') emb, SUM(kich_thuoc) byte, SUM(trang_thai = 'LOI_HASH') loi_hash
    FROM tv_file WHERE trang_thai != 'DANG_LUU' GROUP BY stt_key`).all();
}
// Chỉ các (sha256, đơn) thuộc nội dung PNG có ở ≥ 2 đơn — lọc trong SQL theo chỉ mục sha, không đọc cả bảng ra JS.
function shaTrungNhieuDon() {
  return db.prepare(`SELECT sha256, stt_key FROM tv_file WHERE loai = 'PNG' AND trang_thai != 'DANG_LUU' AND sha256 IN (
      SELECT sha256 FROM tv_file WHERE loai = 'PNG' AND trang_thai != 'DANG_LUU' GROUP BY sha256 HAVING COUNT(DISTINCT stt_key) > 1)`).all();
}
// Việc CHƯA xong theo đơn (thống kê chỉ hiện chờ/lỗi — không đếm hàng trăm nghìn việc đã xong).
function viecChuaXongTheoDon() {
  return db.prepare(`SELECT stt_key, trang_thai, COUNT(*) n FROM tv_hang_cho WHERE trang_thai != 'XONG' GROUP BY stt_key, trang_thai`).all();
}

// Khởi động: việc đang chạy dở (server tắt giữa chừng) -> chạy lại; bản ghi DANG_LUU mồ côi -> xoá (object MinIO cùng
// key nếu đã lỡ ghi sẽ bị ghi đè khi số đó được cấp lại — đó là bản chưa từng hoàn tất, không phải file thư viện).
function donDepKhiKhoiDong() {
  db.prepare(`UPDATE tv_hang_cho SET trang_thai = 'CHO' WHERE trang_thai = 'DANG_CHAY'`).run();
  db.prepare(`DELETE FROM tv_file WHERE trang_thai = 'DANG_LUU'`).run();
  // Đang tính hash dở thì server tắt: file đã nằm trên MinIO -> LOI_HASH để hiện ở "Cần xử lý" (nút Tính lại).
  db.prepare(`UPDATE tv_file SET trang_thai = 'LOI_HASH' WHERE trang_thai = 'DANG_TINH'`).run();
}

// ---------- lô Excel ----------
// Lô Excel ghi theo TỪNG ĐỢT (03/10/2026, rà soát chống nghẽn — 1 giao dịch cho 150.000 dòng chặn luồng chính liên tục 1,2
// giây): nhapExcelService gọi taoLo -> themNhieuViec/themDongLo từng đợt (nhả luồng chính giữa các đợt) -> datSoViecMoiLo.
// Đứt giữa chừng thì lô thiếu dòng nhưng không hỏng gì: nhập lại cùng file tự bỏ qua việc đã có.
const loDangNhap = new Set(); // lô đang ghi dở (taoLo -> datSoViecMoiLo) — chưa đủ dòng, không được nhớ tiến độ
function taoLo({ tenFile, nguoi, tongDong }) {
  const { lastInsertRowid } = db.prepare(`INSERT INTO tv_lo_excel (ten_file, nguoi, tao_luc, tong_dong, so_viec_moi) VALUES (?, ?, ?, ?, 0)`)
    .run(tenFile, nguoi, thoiGianVNISOString(), tongDong);
  loDangNhap.add(Number(lastInsertRowid));
  return Number(lastInsertRowid);
}
const themDongLo = db.transaction((loId, dsDong) => {
  const stmt = db.prepare(`INSERT INTO tv_lo_dong (lo_id, dong, stt_key, url, ly_do, viec_id) VALUES (?, ?, ?, ?, ?, ?)`);
  const idViec = db.prepare(`SELECT id FROM tv_hang_cho WHERE stt_key = ? AND url = ?`).pluck();
  for (const d of dsDong) stmt.run(loId, d.dong, d.sttKey, d.url, d.lyDo || '', d.url ? idViec.get(d.sttKey, d.url) : null);
});
function datSoViecMoiLo(loId, soViecMoi) {
  db.prepare(`UPDATE tv_lo_excel SET so_viec_moi = ? WHERE id = ?`).run(soViecMoi, loId);
  loDangNhap.delete(loId);
}

// Tiến độ từng lô: đếm theo VIỆC (link) khác nhau — dòng Excel trùng (stt_key, url) không bị đếm 2 lần, số ảnh không cộng
// trùng; BO_QUA đếm theo DÒNG có lý do bỏ qua. Nối theo viec_id (khoá số) — rẻ hơn nối chuỗi khi lô lớn.
// Lô đã xong hẳn (không còn việc CHO / DANG_CHAY / LOI) không đổi nữa — trừ khi bấm "Thử lại" (thuLaiViec xoá bộ nhớ này):
// nhớ lại thay vì đếm lại mỗi 15 giây (đo 03/10/2026: lô 150.000 dòng ~60ms mỗi lần đếm, đếm mãi kể cả khi đã xong).
// ponytail: lô ĐANG chạy vẫn đếm lại mỗi lần gọi.
const tienDoLoDaXong = new Map(); // lo_id -> { tienDo, soFile }
function dsLoExcel(gioiHan = 20) {
  const dsLo = db.prepare(`SELECT * FROM tv_lo_excel ORDER BY id DESC LIMIT ?`).all(gioiHan);
  const stmtViec = db.prepare(`SELECT trang_thai, COUNT(*) n, COALESCE(SUM(so_file), 0) so_file FROM tv_hang_cho
    WHERE id IN (SELECT viec_id FROM tv_lo_dong WHERE lo_id = ? AND viec_id IS NOT NULL) GROUP BY trang_thai`);
  const stmtBoQua = db.prepare(`SELECT COUNT(DISTINCT dong) FROM tv_lo_dong WHERE lo_id = ? AND ly_do != ''`).pluck();
  return dsLo.map(lo => {
    if (tienDoLoDaXong.has(lo.id)) return { ...lo, ...tienDoLoDaXong.get(lo.id) };
    const tienDo = { CHO: 0, DANG_CHAY: 0, XONG: 0, LOI: 0, LOI_CUOI: 0, BO_QUA: stmtBoQua.get(lo.id) };
    let soFile = 0;
    for (const r of stmtViec.all(lo.id)) { tienDo[r.trang_thai] = r.n; soFile += r.so_file; }
    if (!tienDo.CHO && !tienDo.DANG_CHAY && !tienDo.LOI && !loDangNhap.has(lo.id)) tienDoLoDaXong.set(lo.id, { tienDo, soFile });
    return { ...lo, tienDo, soFile };
  });
}
function layLoExcel(loId) {
  return db.prepare(`SELECT * FROM tv_lo_excel WHERE id = ?`).get(loId);
}
// Kết quả lô theo TRANG (keyset theo (dong, rowid) — đúng thứ tự chỉ mục idx_tv_lo_dong, không phải sắp xếp lại): ghi file
// kết quả lô lớn từng trang, nhả luồng chính giữa các trang (xem nhapExcelService.js#guiFileKetQua).
function trangKetQuaLo(loId, sau = { dong: -1, rowid: -1 }, gioiHan = 2000) {
  return db.prepare(`SELECT d.rowid AS rowid_dong, d.dong, d.stt_key, d.url, d.ly_do, h.trang_thai, h.so_file, h.loi_cuoi, h.ghi_chu
    FROM tv_lo_dong d LEFT JOIN tv_hang_cho h ON h.id = d.viec_id
    WHERE d.lo_id = ? AND (d.dong, d.rowid) > (?, ?) ORDER BY d.dong, d.rowid LIMIT ?`).all(loId, sau.dong, sau.rowid, gioiHan);
}

module.exports = {
  DUONG_DAN_DB,
  layPhienBanChiMuc, layIdDoiSauPhienBan, dsChiMucPng, layFileTheoIds, dsFileCuaDon, embChinhCuaCacDon, dsMaTrongThuVien, demViecChuaXongCuaDon,
  datBanChinhEmb, themQuyetDinh, dsQuyetDinhCuaDon,
  layNguonDon, ghiNguonDon, luuCapDanhGia, dsCapDanhGia, xoaCapDanhGia, layPngNgauNhien,
  thongKeTheoDon, shaTrungNhieuDon, viecChuaXongTheoDon,
  layCaiDat, datCaiDat,
  themNhieuViec, layViecKeTiep, capNhatViec, thongKeViecXong, demViecTheoTrangThai, thuLaiViec, dsViecLoi,
  timFileTheoSha, daCoDriveFile, thumbCuaSha, giuChoFile, capNhatFile, xoaFileDangLuu, layFile, dsFileLoiHash, dsFileMoiNhat, thongKeFile, thongKePngHangCho,
  donDepKhiKhoiDong,
  taoLo, themDongLo, datSoViecMoiLo, dsLoExcel, layLoExcel, trangKetQuaLo,
};
