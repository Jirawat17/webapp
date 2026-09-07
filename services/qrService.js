const QRCode = require('qrcode');
const sharp = require('sharp');

// Khung đen dày = 8% kích thước QR gốc, mỗi cạnh — cộng thêm RA NGOÀI, không co mã QR thật lại. Mục
// đích: dễ nhận diện/quét hơn khi chụp ảnh (xem docs/superpowers/specs/2026-09-07-khung-den-qr-code-design.md).
const DO_DAY_KHUNG_TY_LE = 0.08;

// Giới hạn thời gian chờ vẽ khung — phát hiện thực tế (07/09/2026): nút "IN ĐƠN" bị TREO VÔ HẠN sau
// khi thêm bước vẽ khung bằng sharp, không hề có lỗi nào hiện ra. Vòng try/catch bình thường ở
// routes/reports.js (POST /don-can-in/bat-dau) không bắt được vì đây nhiều khả năng là lỗi TREO Ở
// TẦNG NATIVE (binding sharp/libvips không tương thích môi trường, vd Alpine/musl — rủi ro đã ghi
// nhận trước đây trong dự án) — 1 promise treo thật (không bao giờ resolve/reject) thì try/catch
// (chỉ bắt được reject) hoàn toàn vô dụng. Promise.race với hẹn giờ này đảm bảo LUÔN có kết quả sau
// tối đa 5 giây, dù sharp có treo thật sự hay không — vẽ khung chỉ là hoàn thiện thêm cho DỄ QUÉT
// HƠN, không phải điều kiện bắt buộc để in được đơn, nên thà mất khung còn hơn chặn đứng cả tính năng.
const GIOI_HAN_VE_KHUNG_MS = 5000;

// Tạo ảnh QR (PNG buffer) từ 1 chuỗi bất kỳ, có khung đen bao quanh — dùng để nhúng vào Excel/PDF.
// `qrcode` chỉ hỗ trợ "quiet zone" trắng (tham số margin), không có khung màu — vẽ thêm bằng sharp.
// LUÔN trả về được 1 mã QR hợp lệ (có khung nếu vẽ thành công trong thời gian cho phép, KHÔNG khung
// nếu lỗi/quá giờ) — không bao giờ khiến việc in đơn thất bại chỉ vì bước trang trí thêm này.
async function taoQRCodeBuffer(noiDung, kichThuoc = 300) {
  const qrGoc = await QRCode.toBuffer(String(noiDung), { width: kichThuoc, margin: 1, errorCorrectionLevel: 'M' });

  try {
    return await Promise.race([
      veKhungDen(qrGoc, kichThuoc),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Vẽ khung đen quá thời gian cho phép')), GIOI_HAN_VE_KHUNG_MS)),
    ]);
  } catch (err) {
    console.error('[QR] Không vẽ được khung đen quanh mã QR — dùng tạm mã QR KHÔNG khung để không chặn việc in:', err.message);
    return qrGoc;
  }
}

function veKhungDen(qrGoc, kichThuoc) {
  const doDayKhung = Math.round(kichThuoc * DO_DAY_KHUNG_TY_LE);
  return sharp(qrGoc)
    .extend({ top: doDayKhung, bottom: doDayKhung, left: doDayKhung, right: doDayKhung, background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png()
    .toBuffer();
}

// (kích thước có khung) / (kích thước QR gốc) — nơi ĐẶT ảnh này vào PDF (routes/reports.js
// veTheDonPdf) dùng tỉ lệ này để tính lại kích thước Ô HIỂN THỊ, sao cho phần QR THẬT bên trong vẫn
// to đúng bằng kích thước cũ (khung chỉ cộng thêm ra ngoài, không làm mã bị co lại). Nếu lần vẽ khung
// nào đó rơi vào nhánh lỗi ở trên (trả về qrGoc không khung), ô hiển thị vẫn to hơn 1 chút theo tỉ lệ
// này — mã QR sẽ có thêm khoảng trắng thừa quanh nó thay vì khung đen, VẪN quét bình thường, không hỏng gì.
const TY_LE_KICH_THUOC_CO_KHUNG = 1 + DO_DAY_KHUNG_TY_LE * 2;

module.exports = { taoQRCodeBuffer, TY_LE_KICH_THUOC_CO_KHUNG };
