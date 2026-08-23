const QRCode = require('qrcode');

// Tạo ảnh QR (PNG buffer) từ 1 chuỗi bất kỳ — dùng để nhúng vào Excel/PDF.
async function taoQRCodeBuffer(noiDung, kichThuoc = 300) {
  return QRCode.toBuffer(String(noiDung), { width: kichThuoc, margin: 1, errorCorrectionLevel: 'M' });
}

module.exports = { taoQRCodeBuffer };
