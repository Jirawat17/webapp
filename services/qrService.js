const QRCode = require('qrcode');
const sharp = require('sharp');

// Khung đen dày = 8% kích thước QR gốc, mỗi cạnh — cộng thêm RA NGOÀI, không co mã QR thật lại. Mục
// đích: dễ nhận diện/quét hơn khi chụp ảnh (xem docs/superpowers/specs/2026-09-07-khung-den-qr-code-design.md).
const DO_DAY_KHUNG_TY_LE = 0.08;

// Tạo ảnh QR (PNG buffer) từ 1 chuỗi bất kỳ, có khung đen bao quanh — dùng để nhúng vào Excel/PDF.
// `qrcode` chỉ hỗ trợ "quiet zone" trắng (tham số margin), không có khung màu — vẽ thêm bằng sharp.
async function taoQRCodeBuffer(noiDung, kichThuoc = 300) {
  const qrGoc = await QRCode.toBuffer(String(noiDung), { width: kichThuoc, margin: 1, errorCorrectionLevel: 'M' });
  const doDayKhung = Math.round(kichThuoc * DO_DAY_KHUNG_TY_LE);
  return sharp(qrGoc)
    .extend({ top: doDayKhung, bottom: doDayKhung, left: doDayKhung, right: doDayKhung, background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png()
    .toBuffer();
}

// (kích thước có khung) / (kích thước QR gốc) — nơi ĐẶT ảnh này vào PDF (routes/reports.js
// veTheDonPdf) dùng tỉ lệ này để tính lại kích thước Ô HIỂN THỊ, sao cho phần QR THẬT bên trong vẫn
// to đúng bằng kích thước cũ (khung chỉ cộng thêm ra ngoài, không làm mã bị co lại).
const TY_LE_KICH_THUOC_CO_KHUNG = 1 + DO_DAY_KHUNG_TY_LE * 2;

module.exports = { taoQRCodeBuffer, TY_LE_KICH_THUOC_CO_KHUNG };
