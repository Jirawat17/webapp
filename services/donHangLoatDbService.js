const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// ============================================================
// "Đơn hàng loạt" (DHLXX) chuyển từ Google Sheets sang SQLite — Giai đoạn 3/3 (cuối) của việc chuyển 6
// tab sang SQLite, bổ sung 19/09/2026, theo yêu cầu người dùng. Xem
// docs/superpowers/specs/2026-09-19-don-hang-loat-sqlite-design.md.
//
// TÁI THIẾT KẾ (người dùng chọn, khác Giai đoạn 1/2 chỉ copy nguyên schema cũ): tách 2 bảng — dhl_nhom
// (metadata nhóm, 1 dòng/nhóm) + dhl_thanh_vien (STT_Key nào thuộc nhóm nào, 1 dòng/đơn) — thay vì 1
// bảng phẳng lặp lại TenNhom/NgayXacNhan/NguoiXacNhan trên MỌI dòng thành viên như Sheets cũ. XOÁ THẬT
// (DELETE) thay cho cờ DaXoa='TRUE' — Sheets cũ dùng cờ vì sheetsService.js không có API xoá dòng;
// SQLite xoá thật được nên không cần "xoá giả" nữa.
//
// STT_Key là PRIMARY KEY của dhl_thanh_vien — TỰ ĐỘNG đảm bảo đúng ràng buộc nghiệp vụ "1 đơn chỉ
// thuộc đúng 1 Đơn hàng loạt" ở tầng schema (trước đây donHangLoatService.js#timNhomKhacDangGiu() phải
// tự quét toàn bộ rows để kiểm tra, giờ chỉ cần 1 lượt tra theo khoá chính).
//
// Mã DHLXX vẫn phải TĂNG DẦN, KHÔNG BAO GIỜ TÁI SỬ DỤNG số cũ dù nhóm đó đã bị xoá thật (đúng bảo đảm
// cũ — Sheets cũ giữ được bảo đảm này nhờ dòng DaXoa vẫn CÒN VẬT LÝ để quét MAX(); SQLite xoá thật thì
// KHÔNG còn dòng để quét lại nữa) — dùng bảng đếm riêng dhl_bo_dem, tăng dần độc lập với việc
// xoá/không xoá nhóm.
const DUONG_DAN_DB = process.env.DON_HANG_LOAT_DB_PATH || path.join(__dirname, '..', 'data', 'don_hang_loat.db');

fs.mkdirSync(path.dirname(DUONG_DAN_DB), { recursive: true });

const db = new Database(DUONG_DAN_DB);
db.pragma('journal_mode = WAL');

db.exec(`CREATE TABLE IF NOT EXISTS dhl_nhom (
  MaDonHangLoat TEXT PRIMARY KEY,
  TenNhom TEXT NOT NULL DEFAULT '',
  NgayXacNhan TEXT NOT NULL DEFAULT '',
  NguoiXacNhan TEXT NOT NULL DEFAULT ''
)`);
db.exec(`CREATE TABLE IF NOT EXISTS dhl_thanh_vien (
  STT_Key TEXT PRIMARY KEY,
  MaDonHangLoat TEXT NOT NULL
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_dhl_thanh_vien_ma_nhom ON dhl_thanh_vien(MaDonHangLoat)`);
db.exec(`CREATE TABLE IF NOT EXISTS dhl_bo_dem (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  so_lon_nhat INTEGER NOT NULL DEFAULT 0
)`);

// ---------- Đọc ----------
const cauLayTatCaNhom = db.prepare(`SELECT MaDonHangLoat, TenNhom, NgayXacNhan, NguoiXacNhan FROM dhl_nhom`);
function layTatCaNhom() {
  return cauLayTatCaNhom.all();
}

function layNhom(maDonHangLoat) {
  return db.prepare(`SELECT MaDonHangLoat, TenNhom, NgayXacNhan, NguoiXacNhan FROM dhl_nhom WHERE MaDonHangLoat = ?`).get(maDonHangLoat);
}

function layThanhVienCuaNhom(maDonHangLoat) {
  return db.prepare(`SELECT STT_Key FROM dhl_thanh_vien WHERE MaDonHangLoat = ?`).all(maDonHangLoat).map(r => r.STT_Key);
}

// Nhóm (nếu có) đang giữ 1 đơn — thay thế timNhomKhacDangGiu() cũ (trước đây phải tự quét toàn bộ rows,
// giờ tra thẳng theo khoá chính STT_Key). Trả kèm TenNhom để dựng thông báo lỗi ("đang ở DHL01 — Tên nhóm").
function layNhomCuaDon(sttKey) {
  return db.prepare(`
    SELECT tv.MaDonHangLoat, n.TenNhom FROM dhl_thanh_vien tv
    JOIN dhl_nhom n ON n.MaDonHangLoat = tv.MaDonHangLoat
    WHERE tv.STT_Key = ?
  `).get(sttKey);
}

// Bản JOIN phẳng (STT_Key, MaDonHangLoat, TenNhom) — thay thế trực tiếp cho "rows đang hoạt động" cũ,
// dùng cho donHangLoatService.js#layDanhSachNhom (không cần NgayXacNhan/NguoiXacNhan).
const cauLayTatCaThanhVienVoiTenNhom = db.prepare(`
  SELECT tv.STT_Key, tv.MaDonHangLoat, n.TenNhom FROM dhl_thanh_vien tv
  JOIN dhl_nhom n ON n.MaDonHangLoat = tv.MaDonHangLoat
`);
function layTatCaThanhVienVoiTenNhom() {
  return cauLayTatCaThanhVienVoiTenNhom.all();
}

// ---------- Ghi ----------

// Tạo nhóm mới + toàn bộ thành viên ban đầu trong CÙNG 1 giao dịch (atomic — hoặc ghi đủ cả nhóm lẫn
// thành viên, hoặc không ghi gì nếu có lỗi giữa chừng, vd trùng STT_Key đã thuộc nhóm khác lọt qua
// kiểm tra ở tầng service do race hiếm gặp). Tự sinh mã DHLXX kế tiếp qua dhl_bo_dem — KHÔNG dùng lại
// số cũ dù đã có nhóm bị xoá trước đó.
const trxTaoNhomMoi = db.transaction((tenNhom, ngayXacNhan, nguoiXacNhan, sttKeys) => {
  const dem = db.prepare(`
    INSERT INTO dhl_bo_dem (id, so_lon_nhat) VALUES (1, 1)
    ON CONFLICT(id) DO UPDATE SET so_lon_nhat = so_lon_nhat + 1
    RETURNING so_lon_nhat
  `).get();
  const maMoi = 'DHL' + String(dem.so_lon_nhat).padStart(2, '0');

  db.prepare(`INSERT INTO dhl_nhom (MaDonHangLoat, TenNhom, NgayXacNhan, NguoiXacNhan) VALUES (?, ?, ?, ?)`)
    .run(maMoi, tenNhom, ngayXacNhan, nguoiXacNhan);
  const cauThemThanhVien = db.prepare(`INSERT INTO dhl_thanh_vien (STT_Key, MaDonHangLoat) VALUES (?, ?)`);
  for (const sttKey of sttKeys) cauThemThanhVien.run(sttKey, maMoi);

  return maMoi;
});
function taoNhomMoi({ tenNhom, ngayXacNhan, nguoiXacNhan, sttKeys }) {
  return trxTaoNhomMoi(tenNhom, ngayXacNhan, nguoiXacNhan, sttKeys);
}

function themThanhVien(maDonHangLoat, sttKeys) {
  const cau = db.prepare(`INSERT INTO dhl_thanh_vien (STT_Key, MaDonHangLoat) VALUES (?, ?)`);
  const trx = db.transaction((ds) => { for (const sttKey of ds) cau.run(sttKey, maDonHangLoat); });
  trx(sttKeys);
}

// Xoá 1 thành viên — nếu đó là thành viên CUỐI CÙNG của nhóm, xoá LUÔN cả nhóm (dọn dẹp, tránh nhóm
// rỗng tồn tại vô thời hạn — đúng tinh thần hành vi cũ: nhóm mà mọi dòng đã DaXoa coi như "không tồn
// tại" nữa, xem donHangLoatService.js#layDongCuaNhom cũ).
const trxXoaThanhVien = db.transaction((maDonHangLoat, sttKey) => {
  db.prepare(`DELETE FROM dhl_thanh_vien WHERE STT_Key = ? AND MaDonHangLoat = ?`).run(sttKey, maDonHangLoat);
  const { con } = db.prepare(`SELECT COUNT(*) AS con FROM dhl_thanh_vien WHERE MaDonHangLoat = ?`).get(maDonHangLoat);
  if (con === 0) db.prepare(`DELETE FROM dhl_nhom WHERE MaDonHangLoat = ?`).run(maDonHangLoat);
});
function xoaThanhVien(maDonHangLoat, sttKey) {
  trxXoaThanhVien(maDonHangLoat, sttKey);
}

function doiTenNhom(maDonHangLoat, tenMoi) {
  db.prepare(`UPDATE dhl_nhom SET TenNhom = ? WHERE MaDonHangLoat = ?`).run(tenMoi, maDonHangLoat);
}

const trxXoaNhom = db.transaction((maDonHangLoat) => {
  db.prepare(`DELETE FROM dhl_thanh_vien WHERE MaDonHangLoat = ?`).run(maDonHangLoat);
  db.prepare(`DELETE FROM dhl_nhom WHERE MaDonHangLoat = ?`).run(maDonHangLoat);
});
function xoaNhom(maDonHangLoat) {
  trxXoaNhom(maDonHangLoat);
}

// Dùng riêng cho migrate script — nạp 1 nhóm ĐÃ CÓ SẴN mã (từ Sheets) thay vì tự sinh mã mới, và cập
// nhật dhl_bo_dem để không tái sử dụng số đó về sau (kể cả với nhóm KHÔNG migrate vì đã bị xoá mềm
// trong Sheets — xem scripts/migrate-don-hang-loat-tu-sheets.js).
const trxNapNhomTuMigrate = db.transaction((maDonHangLoat, tenNhom, ngayXacNhan, nguoiXacNhan, sttKeys) => {
  db.prepare(`INSERT OR IGNORE INTO dhl_nhom (MaDonHangLoat, TenNhom, NgayXacNhan, NguoiXacNhan) VALUES (?, ?, ?, ?)`)
    .run(maDonHangLoat, tenNhom, ngayXacNhan, nguoiXacNhan);
  const cauThemThanhVien = db.prepare(`INSERT OR IGNORE INTO dhl_thanh_vien (STT_Key, MaDonHangLoat) VALUES (?, ?)`);
  for (const sttKey of sttKeys) cauThemThanhVien.run(sttKey, maDonHangLoat);
});
function napNhomTuMigrate(maDonHangLoat, tenNhom, ngayXacNhan, nguoiXacNhan, sttKeys) {
  trxNapNhomTuMigrate(maDonHangLoat, tenNhom, ngayXacNhan, nguoiXacNhan, sttKeys);
}
function datSoLonNhatBoDem(so) {
  db.prepare(`
    INSERT INTO dhl_bo_dem (id, so_lon_nhat) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET so_lon_nhat = MAX(so_lon_nhat, excluded.so_lon_nhat)
  `).run(so);
}

module.exports = {
  layTatCaNhom, layNhom, layThanhVienCuaNhom, layNhomCuaDon, layTatCaThanhVienVoiTenNhom,
  taoNhomMoi, themThanhVien, xoaThanhVien, doiTenNhom, xoaNhom,
  napNhomTuMigrate, datSoLonNhatBoDem,
};
