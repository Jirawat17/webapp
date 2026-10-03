const db = require('./thuVienDbService');

// Giai đoạn 5 thư viện "Tìm ảnh" (spec mục 19): khối thống kê đơn giản cho người quản lý — biết dữ liệu còn thiếu/trùng ở đâu.
// Chỉ tính khi bấm (không chạy nền, không tự tính khi mở trang). duocXem lọc theo Xưởng (admin); maSheet null = không đọc
// được Sheet -> các mục cần Sheet để trống, các mục khác vẫn có.
// Chống nghẽn (đo 200.000 file: bản đầu chặn luồng chính ~1,5 giây liền): nhóm trùng lọc trong SQL, chỉ đếm việc chưa xong,
// các vòng lặp lớn nhả luồng chính mỗi 20.000 mục (admin còn tra Xưởng từng mã).
const SO_MAU = 50; // mỗi mục kèm tối đa 50 mã mẫu để bấm tra ngay
const MOI_DOT = 20000;
const nhaLuong = () => new Promise(r => setImmediate(r));

async function thongKeThuVien({ duocXem = () => true, maSheet = null } = {}) {
  const batDau = Date.now();
  const kq = {
    soDon: 0, soPng: 0, soEmbPhienBan: 0, soDonCoPng: 0, soDonCoEmb: 0, tongByte: 0, soFileLoiHash: 0,
    pngChuaEmb: { so: 0, mau: [] }, embChuaPng: { so: 0, mau: [] },
    khongConTrongSheet: maSheet ? { so: 0, mau: [] } : null,
    sheetChuaCoPng: maSheet ? { so: 0, mau: [] } : null,
    trungNoiDung: { soNhom: 0, soFile: 0, mau: [] },
    viec: { CHO: 0, DANG_CHAY: 0, LOI: 0, LOI_CUOI: 0 },
  };
  const them = (muc, ma) => { muc.so++; if (muc.mau.length < SO_MAU) muc.mau.push(ma); };

  const dsDon = db.thongKeTheoDon();
  await nhaLuong();
  const donCoPng = new Set();
  let dem = 0;
  for (const d of dsDon) {
    if (++dem % MOI_DOT === 0) await nhaLuong();
    if (!duocXem(d.stt_key)) continue;
    kq.soDon++;
    kq.soPng += d.png; kq.soEmbPhienBan += d.emb; kq.tongByte += d.byte || 0; kq.soFileLoiHash += d.loi_hash;
    if (d.png) { kq.soDonCoPng++; donCoPng.add(d.stt_key); }
    if (d.emb) kq.soDonCoEmb++;
    if (d.png && !d.emb) them(kq.pngChuaEmb, d.stt_key);
    if (d.emb && !d.png) them(kq.embChuaPng, d.stt_key);
    if (maSheet && !maSheet.has(d.stt_key)) them(kq.khongConTrongSheet, d.stt_key);
  }
  if (maSheet) {
    dem = 0;
    for (const ma of maSheet) {
      if (++dem % MOI_DOT === 0) await nhaLuong();
      if (!donCoPng.has(ma) && duocXem(ma)) them(kq.sheetChuaCoPng, ma);
    }
  }
  await nhaLuong();

  // Cùng 1 nội dung PNG (sha256) có ở ≥ 2 đơn — thường là khách đặt lại đúng mẫu cũ (không phải lỗi, là ứng viên tái sử dụng).
  const donTheoSha = new Map();
  for (const { sha256, stt_key } of db.shaTrungNhieuDon()) {
    if (!duocXem(stt_key)) continue;
    if (!donTheoSha.has(sha256)) donTheoSha.set(sha256, new Set());
    donTheoSha.get(sha256).add(stt_key);
  }
  for (const dsMa of donTheoSha.values()) {
    if (dsMa.size < 2) continue; // lọc theo Xưởng có thể làm nhóm chỉ còn 1 đơn
    kq.trungNoiDung.soNhom++;
    kq.trungNoiDung.soFile += dsMa.size; // 1 đơn không lưu được 2 PNG cùng sha256 (UNIQUE) -> số đơn = số file
    if (kq.trungNoiDung.mau.length < SO_MAU) kq.trungNoiDung.mau.push([...dsMa]);
  }
  await nhaLuong();
  for (const v of db.viecChuaXongTheoDon()) if (duocXem(v.stt_key)) kq.viec[v.trang_thai] = (kq.viec[v.trang_thai] || 0) + v.n;
  kq.ms = Date.now() - batDau;
  return kq;
}

module.exports = { thongKeThuVien };
