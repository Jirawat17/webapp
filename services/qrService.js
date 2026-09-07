const QRCode = require('qrcode');

// QR "version" CỐ ĐỊNH (không để thư viện tự chọn theo độ dài chuỗi) — đảm bảo LƯỚI MODULE CỐ ĐỊNH
// (version 1 = 21x21 module) cho MỌI đơn, bất kể STT_Key dài ngắn khác nhau, để căn khớp CHÍNH XÁC
// với số nguyên chấm in của máy in nhiệt 203 DPI đang dùng (xem KICH_THUOC_QR_CHUAN_DPI_MM bên dưới)
// — lưới module đổi tuỳ chuỗi (nếu để thư viện tự chọn version) thì không thể căn cố định 1 lần.
// Sức chứa version 1, chế độ alphanumeric (0-9, A-Z, space, $%*+-./:), mức sửa lỗi M: 20 ký tự — thừa
// nhiều so với STT_Key dài nhất thực tế (~7 ký tự, đã xác nhận với người dùng 07/09/2026).
const QR_VERSION = 1;
const QR_SO_MODULE = 21; // số module DỮ LIỆU thật của version 1 (chưa tính quiet zone)

// Tạo ảnh QR (PNG buffer) từ 1 chuỗi bất kỳ — dùng để nhúng vào Excel/PDF. Viền trắng + khung đen
// quanh mã (xem docs/superpowers/specs/2026-09-07-khung-den-qr-code-design.md) được vẽ RIÊNG bằng
// PDFKit (vector, ngay tại routes/reports.js veTheDonPdf()) — KHÔNG raster hoá qua sharp nữa.
// `margin: 0` vì viền trắng thật đã vẽ riêng bằng PDFKit — không cần thêm quiet zone bên trong ảnh QR.
//
// LỊCH SỬ (07/09/2026): bản đầu dùng sharp().extend() để vẽ viền/khung trực tiếp vào buffer PNG này.
// Thực tế trên production: sharp bị TREO/CHẬM ở tầng native (nghi binding không tương thích môi
// trường, xem lịch sử trong spec) khiến "IN ĐƠN" từ treo vô hạn đến "chạy được nhưng rất chậm" (mỗi
// mã QR tốn thêm tới vài giây qua 2 lượt raster hoá). Chuyển hẳn sang vẽ viền/khung bằng hình chữ
// nhật PDFKit thuần JS — không phụ thuộc binary native nào, luôn nhanh, không có gì để "treo".
async function taoQRCodeBuffer(noiDung, kichThuoc = 300) {
  try {
    return await QRCode.toBuffer(String(noiDung), { width: kichThuoc, margin: 0, errorCorrectionLevel: 'M', version: QR_VERSION });
  } catch (err) {
    // Chuỗi vượt sức chứa version 1 (không nên xảy ra với dữ liệu thực tế — STT_Key dài nhất mới ~7
    // ký tự, dưới xa mức 20 — nhưng TUYỆT ĐỐI không được để lỗi này chặn đứng việc in đơn). Để thư
    // viện TỰ CHỌN version phù hợp — mất lợi ích căn khớp chấm in chính xác cho riêng mã này, vẫn in
    // được bình thường.
    console.error(`[QR] "${noiDung}" vượt sức chứa QR version ${QR_VERSION} — dùng version tự động:`, err.message);
    return QRCode.toBuffer(String(noiDung), { width: kichThuoc, margin: 0, errorCorrectionLevel: 'M' });
  }
}

// Kích thước VẬT LÝ (mm) để in mã QR sao cho mỗi module khớp ĐÚNG SỐ NGUYÊN chấm in — tránh module bị
// lệch/mờ biên do làm tròn không đều (vd 26mm cũ / 21 module ≈ 9.9 chấm/module ở 203 DPI, không phải
// số nguyên). 203 DPI = máy in nhiệt khổ tem 100x150mm đang dùng (xác nhận với người dùng 07/09/2026)
// — đổi máy in khác DPI thì sửa lại DPI_MAY_IN này. 10 chấm/module x 21 module = 210 chấm, chia hết,
// không lệch module nào. ≈ 26.28mm — gần với 26mm cũ, không đổi nhiều bố cục thẻ in.
const DPI_MAY_IN = 203;
const SO_CHAM_MOI_MODULE = 10;
const KICH_THUOC_QR_CHUAN_DPI_MM = (QR_SO_MODULE * SO_CHAM_MOI_MODULE / DPI_MAY_IN) * 25.4;

module.exports = { taoQRCodeBuffer, KICH_THUOC_QR_CHUAN_DPI_MM };
