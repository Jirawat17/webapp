// Tiến trình CON xử lý ảnh cho thư viện "Tìm ảnh" (03/10/2026, rà soát chống nghẽn) — chạy bằng child_process.fork từ
// xuLyService.js. Lý do tách riêng: sharp là thư viện native; khi nó treo ở tầng native (đã xảy ra THẬT 2 lần trên
// production, xem services/perceptualHashService.js), Promise.race timeout chỉ giúp nơi gọi thôi chờ — luồng xử lý bên
// dưới (libuv threadpool, mặc định chỉ 4 luồng, dùng CHUNG với đọc file/tra DNS của cả app) vẫn kẹt mãi; vài lần như
// vậy là cả server đứng. Ở tiến trình con, quá giờ thì tiến trình cha giết hẳn (SIGKILL) và tạo lại — không còn gì kẹt.
// KHÔNG require CSDL hay dịch vụ nào khác ở đây — chỉ sharp + hàm hash.
const sharp = require('sharp');
const { tinhHashAnh, tinhHashHinhDang, laHashSuyBien } = require('../perceptualHashService');

sharp.cache(false); // tiến trình sống lâu, xử lý hàng nghìn ảnh khác nhau — cache của libvips chỉ tốn RAM

const CANH_THUMB = 256;
const CANH_PHANG = 1024; // ảnh trong suốt thu nhỏ trước khi đặt lên nền (hash chỉ cần 17x16 — không mã hoá lại ảnh gốc 30MB)

// "% Ảnh" của thư viện: ảnh có kênh trong suốt được đặt lên nền TRẮNG trước khi tính. tinhHashAnh bỏ kênh alpha nên vùng trong
// suốt thành ĐEN: thiết kế chỉ đen thuần ra hash toàn 0 và mọi thiết kế chỉ đen "giống 100%" nhau (đo 03/10/2026). Nền trắng
// cũng là nền của ảnh chụp màn hình/JPEG khách gửi -> cùng thiết kế ra hash gần nhau. Đặt lên trắng mà vẫn suy biến (chỉ trắng
// thuần) -> đặt lên đen. tinhHashAnh giữ nguyên cho Đơn hàng loạt. Lỗi -> null (cùng hợp đồng với tinhHashAnh).
async function hashAnhThuVien(buf) {
  try {
    const { hasAlpha } = await sharp(buf).metadata();
    if (!hasAlpha) return tinhHashAnh(buf);
    let dau = null;
    for (const nen of ['#ffffff', '#000000']) {
      const phang = await sharp(buf).resize(CANH_PHANG, CANH_PHANG, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: nen }).png({ compressionLevel: 0 }).toBuffer();
      const h = await tinhHashAnh(phang);
      if (h && !laHashSuyBien(h)) return h;
      dau = dau || h;
    }
    return dau; // cả 2 nền đều suy biến (ảnh gần như 1 màu) — vẫn lưu, nơi so điểm tự bỏ qua hash suy biến
  } catch (err) {
    return null;
  }
}

process.on('disconnect', () => process.exit(0)); // server chính đã tắt/khởi động lại — không để tiến trình con mồ côi

process.on('message', async ({ id, buffer, khongThumb }) => {
  const buf = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  try {
    const dhash = await hashAnhThuVien(buf);
    const dhashHinhDang = await tinhHashHinhDang(buf);
    let thumb = null;
    if (!khongThumb) try {
      thumb = await sharp(buf).resize(CANH_THUMB, CANH_THUMB, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    } catch (err) {
      console.error('[ThuVien/worker] Không tạo được thumbnail:', err.message);
    }
    process.send({ id, dhash, dhashHinhDang, thumb });
  } catch (err) {
    process.send({ id, loi: err.message });
  }
});
