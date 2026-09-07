const QRCode = require('qrcode');
const sharp = require('sharp');

// Viền TRẮNG (quiet zone bổ sung) rồi mới tới khung ĐEN, cả 2 cộng thêm RA NGOÀI mã QR gốc — không co
// mã QR thật lại. Tính theo % kích thước QR gốc (không theo số module như tham số `margin` của thư
// viện qrcode) để độ dày viền LUÔN nhất quán về mặt hình ảnh dù mã đơn (STT_Key) dài ngắn khác nhau
// (STT_Key dài hơn -> QR version cao hơn -> nhiều module hơn -> margin tính theo module sẽ cho ra viền
// mỏng/dày khác nhau giữa các đơn nếu chỉ dựa vào đó).
// Viền trắng ĐỦ DÀY (không chỉ mấy px mỏng dính) là điểm mấu chốt cho tốc độ nhận diện: máy quét cần
// 1 vùng sáng liền mạch quanh mã để định vị nhanh 3 góc vuông tìm kiếm (finder pattern) — khung đen
// đặt sát ngay rìa mã (không có vùng đệm) dễ làm máy quét mất nhiều thời gian dò/đôi khi không nhận
// ra ranh giới mã ở đâu. Xem docs/superpowers/specs/2026-09-07-khung-den-qr-code-design.md.
const DO_DAY_VIEN_TRANG_TY_LE = 0.10;
const DO_DAY_KHUNG_DEN_TY_LE = 0.08;

// Giới hạn thời gian chờ vẽ viền/khung — phát hiện thực tế (07/09/2026): nút "IN ĐƠN" bị TREO VÔ HẠN
// sau khi thêm bước vẽ khung bằng sharp, không hề có lỗi nào hiện ra. Vòng try/catch bình thường ở
// routes/reports.js (POST /don-can-in/bat-dau) không bắt được vì đây nhiều khả năng là lỗi TREO Ở
// TẦNG NATIVE (binding sharp/libvips không tương thích môi trường, vd Alpine/musl — rủi ro đã ghi
// nhận trước đây trong dự án) — 1 promise treo thật (không bao giờ resolve/reject) thì try/catch
// (chỉ bắt được reject) hoàn toàn vô dụng. Promise.race với hẹn giờ này đảm bảo LUÔN có kết quả sau
// tối đa 5 giây, dù sharp có treo thật sự hay không — vẽ viền/khung chỉ là hoàn thiện thêm cho DỄ
// QUÉT HƠN, không phải điều kiện bắt buộc để in được đơn, nên thà mất viền/khung còn hơn chặn đứng
// cả tính năng.
const GIOI_HAN_VE_MS = 5000;

// Tạo ảnh QR (PNG buffer) từ 1 chuỗi bất kỳ, có viền trắng + khung đen bao quanh — dùng để nhúng vào
// Excel/PDF. LUÔN trả về được 1 mã QR hợp lệ (có đủ viền/khung nếu vẽ xong trong thời gian cho phép,
// KHÔNG có nếu lỗi/quá giờ) — không bao giờ khiến việc in đơn thất bại chỉ vì bước trang trí thêm này.
async function taoQRCodeBuffer(noiDung, kichThuoc = 300) {
  const qrGoc = await QRCode.toBuffer(String(noiDung), { width: kichThuoc, margin: 1, errorCorrectionLevel: 'M' });

  try {
    return await Promise.race([
      veVienTrangVaKhungDen(qrGoc, kichThuoc),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Vẽ viền/khung quá thời gian cho phép')), GIOI_HAN_VE_MS)),
    ]);
  } catch (err) {
    console.error('[QR] Không vẽ được viền trắng/khung đen quanh mã QR — dùng tạm mã QR KHÔNG viền/khung để không chặn việc in:', err.message);
    return qrGoc;
  }
}

// 2 bước TÁCH RIÊNG (không chained chung 1 pipeline sharp) — sharp không hỗ trợ gọi extend() 2 lần
// trên cùng 1 pipeline (các thao tác thuộc nhóm resize, trong đó có extend, chỉ áp dụng được 1 lần
// mỗi pipeline). Bước 1 tạo buffer trung gian đã có viền trắng, bước 2 mở buffer đó ra vẽ tiếp khung đen.
async function veVienTrangVaKhungDen(qrGoc, kichThuoc) {
  const doDayVienTrang = Math.round(kichThuoc * DO_DAY_VIEN_TRANG_TY_LE);
  const coVienTrang = await sharp(qrGoc)
    .extend({ top: doDayVienTrang, bottom: doDayVienTrang, left: doDayVienTrang, right: doDayVienTrang, background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();

  const doDayKhungDen = Math.round(kichThuoc * DO_DAY_KHUNG_DEN_TY_LE);
  return sharp(coVienTrang)
    .extend({ top: doDayKhungDen, bottom: doDayKhungDen, left: doDayKhungDen, right: doDayKhungDen, background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png()
    .toBuffer();
}

// (kích thước có viền trắng + khung đen) / (kích thước QR gốc) — nơi ĐẶT ảnh này vào PDF
// (routes/reports.js veTheDonPdf) dùng tỉ lệ này để tính lại kích thước Ô HIỂN THỊ, sao cho phần QR
// THẬT bên trong vẫn to đúng bằng kích thước cũ (viền/khung chỉ cộng thêm ra ngoài, không làm mã bị
// co lại). Nếu lần vẽ nào đó rơi vào nhánh lỗi ở trên (trả về qrGoc gốc), ô hiển thị vẫn to hơn theo
// tỉ lệ này — mã QR sẽ có thêm khoảng trắng thừa quanh nó thay vì viền/khung, VẪN quét bình thường.
const TY_LE_KICH_THUOC_CO_KHUNG = 1 + (DO_DAY_VIEN_TRANG_TY_LE + DO_DAY_KHUNG_DEN_TY_LE) * 2;

module.exports = { taoQRCodeBuffer, TY_LE_KICH_THUOC_CO_KHUNG };
