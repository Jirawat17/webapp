# Khung đen quanh mã QR trong file in (IN ĐƠN)

## Bối cảnh

Mã QR trong file xuất chỉ xuất hiện ở đúng 1 nơi: mẫu "IN ĐƠN" (`don_can_in`,
`services/qrService.js` → `taiAnhChoDon()` → `veTheDonPdf()` trong `routes/reports.js`), dùng
CHUNG 1 buffer ảnh PNG cho cả bản PDF (thẻ dán 100x150mm) lẫn bản Excel (nhúng ảnh cố định
110x110px). Thư viện `qrcode` chỉ hỗ trợ "quiet zone" (viền trắng) quanh mã qua tham số `margin`,
không có khung màu — cần vẽ thêm bằng `sharp` (đã có sẵn trong dự án từ tính năng đối chiếu ảnh
hàng loạt, không cần cài mới).

Mục tiêu: thêm khung đen quanh mã QR để dễ nhận diện/quét hơn khi chụp ảnh — khung CỘNG THÊM ra
ngoài, bản thân mã QR (phần thực sự quét được) giữ nguyên kích thước, không bị co lại (đã xác nhận
với người dùng).

## Thay đổi

### 1. `services/qrService.js` — thêm khung đen vào chính buffer ảnh

```js
const QRCode = require('qrcode');
const sharp = require('sharp');

const DO_DAY_KHUNG_TY_LE = 0.08; // khung đen dày = 8% kích thước QR gốc, mỗi cạnh

async function taoQRCodeBuffer(noiDung, kichThuoc = 300) {
  const qrGoc = await QRCode.toBuffer(String(noiDung), { width: kichThuoc, margin: 1, errorCorrectionLevel: 'M' });
  const doDayKhung = Math.round(kichThuoc * DO_DAY_KHUNG_TY_LE);
  return sharp(qrGoc)
    .extend({ top: doDayKhung, bottom: doDayKhung, left: doDayKhung, right: doDayKhung, background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png()
    .toBuffer();
}

// (kích thước có khung) / (kích thước QR gốc) — dùng để tính lại kích thước Ô HIỂN THỊ khi đặt ảnh
// đã có khung vào PDF, để phần QR THẬT bên trong vẫn to đúng bằng kích thước cũ (khung chỉ cộng
// thêm ra ngoài) — xem routes/reports.js veTheDonPdf().
const TY_LE_KICH_THUOC_CO_KHUNG = 1 + DO_DAY_KHUNG_TY_LE * 2;

module.exports = { taoQRCodeBuffer, TY_LE_KICH_THUOC_CO_KHUNG };
```

Vì cả PDF (`doc.image(anh.qr, x0, qrY, { width, height })`) lẫn Excel (`sheet.addImage(id, { ext: { width: 110, height: 110 } })`) đều SCALE nguyên ảnh vào 1 ô kích thước cố định (không quan tâm ảnh gốc bao nhiêu pixel), thêm khung ngay tại nguồn sinh ảnh này áp dụng tự động cho CẢ 2 nơi, không cần sửa gì thêm ở phần vẽ Excel.

### 2. `routes/reports.js` — `veTheDonPdf()`: to ô QR ra tương ứng, giữ mã QR thật bằng kích thước cũ

```js
const qrKichThuoc = mmToPt(26) * TY_LE_KICH_THUOC_CO_KHUNG; // ô to hơn ~16% để chứa khung, mã QR bên trong vẫn ~26mm thật
```

`infoX`/`infoRong` (cột thông tin bên phải QR) đã tính dựa trên biến `qrKichThuoc` này nên tự động
dịch theo, không cần sửa thêm. Đã kiểm tra: ô QR to thêm ~4mm (26mm → ~30mm) trên thẻ cao 150mm —
không ảnh hưởng bố cục các phần tử khác (ảnh mẫu/mockup phía trên, ghi chú phía dưới cột thông tin
đều tính theo `y`/`yInfo` độc lập, không có gì giả định cứng khoảng cách dưới QR).

## Không đổi

- Bố cục Excel (`ext: { width: 110, height: 110 }`) — khung tự động xuất hiện, không cần sửa code.
- Ngưỡng/thuật toán perceptual hash, mọi nơi khác dùng `sharp` — không đụng gì.
- Không áp dụng cho mẫu "IN DANH SÁCH PHÔI" (`phoi_ao_gop`) — mẫu đó không có QR.
