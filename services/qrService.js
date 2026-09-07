const QRCode = require('qrcode');

// Tạo ảnh QR (PNG buffer) từ 1 chuỗi bất kỳ — dùng để nhúng vào Excel/PDF. Viền trắng + khung đen
// quanh mã (xem docs/superpowers/specs/2026-09-07-khung-den-qr-code-design.md) được vẽ RIÊNG bằng
// PDFKit (vector, ngay tại routes/reports.js veTheDonPdf()) — KHÔNG raster hoá qua sharp nữa.
//
// LỊCH SỬ (07/09/2026): bản đầu dùng sharp().extend() để vẽ viền/khung trực tiếp vào buffer PNG này.
// Thực tế trên production: sharp bị TREO/CHẬM ở tầng native (nghi binding không tương thích môi
// trường, xem lịch sử trong spec) khiến "IN ĐƠN" từ treo vô hạn đến "chạy được nhưng rất chậm" (mỗi
// mã QR tốn thêm tới vài giây qua 2 lượt raster hoá). Chuyển hẳn sang vẽ viền/khung bằng hình chữ
// nhật PDFKit thuần JS — không phụ thuộc binary native nào, luôn nhanh, không có gì để "treo".
async function taoQRCodeBuffer(noiDung, kichThuoc = 300) {
  return QRCode.toBuffer(String(noiDung), { width: kichThuoc, margin: 1, errorCorrectionLevel: 'M' });
}

module.exports = { taoQRCodeBuffer };
