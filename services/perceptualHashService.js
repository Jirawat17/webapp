const sharp = require('sharp');

// dHash (difference hash) 64-bit — resize ảnh về lưới 9x8 pixel xám, so sánh độ sáng từng cặp pixel
// liền kề THEO HÀNG (9 pixel/hàng → 8 cặp so sánh/hàng × 8 hàng = 64 bit). Nhẹ, không cần mô hình AI,
// nhắm bắt được ảnh bị resize/đổi định dạng vẫn ra hash giống hệt hoặc gần giống (khác thuật toán băm
// nội dung như SHA-256 — chỉ cần đổi 1 byte là ra hash hoàn toàn khác). Xem
// docs/superpowers/specs/2026-09-06-don-hang-loat-design.md mục 3 để biết lý do chọn thuật toán này.
//
// QUAN TRỌNG — kernel 'nearest': đã tự kiểm thử bằng ảnh giả lập trước khi viết hàm này. Dùng kernel
// mặc định của sharp ('lanczos3', vốn "mượt" hơn) khiến CHỈ RIÊNG việc đổi định dạng PNG->JPEG (dù
// chất lượng 100%) đã đẩy khoảng cách Hamming lên ~20/64 bit — coi như khác hẳn thiết kế dù là đúng 1
// ảnh. Đổi sang 'nearest' (lấy đúng 1 pixel, không nội suy/làm mượt) giảm mức trôi này đáng kể — quan
// trọng với ảnh nét thẳng/khối màu phẳng kiểu thiết kế thêu, nơi nội suy mượt phá vỡ đúng cạnh sắc mà
// dHash dựa vào để so sánh. ĐỪNG đổi lại kernel mặc định mà không kiểm thử lại bằng ảnh giả lập trước.
const CHIEU_RONG_HASH = 9;
const CHIEU_CAO_HASH = 8;
const KERNEL_RESIZE = 'nearest';

// Mỗi ký tự hex ứng với 4 bit — bảng tra số bit "1" trong 1 nibble (0-15), dùng để đếm nhanh khoảng
// cách Hamming giữa 2 chuỗi hex mà không cần vòng lặp bit-by-bit.
const SO_BIT_1_TRONG_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

// Trả về chuỗi hex 16 ký tự (64 bit) hoặc null nếu ảnh lỗi/định dạng không đọc được (sharp ném lỗi
// với buffer rỗng, hỏng, hoặc không phải ảnh — bắt lỗi ở đây để nơi gọi không cần tự try/catch).
async function tinhHashAnh(buffer) {
  if (!buffer || buffer.length === 0) return null;

  try {
    const { data } = await sharp(buffer)
      .resize(CHIEU_RONG_HASH, CHIEU_CAO_HASH, { fit: 'fill', kernel: KERNEL_RESIZE })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let bit = '';
    for (let y = 0; y < CHIEU_CAO_HASH; y++) {
      for (let x = 0; x < CHIEU_RONG_HASH - 1; x++) {
        const trai = data[y * CHIEU_RONG_HASH + x];
        const phai = data[y * CHIEU_RONG_HASH + x + 1];
        bit += trai < phai ? '1' : '0';
      }
    }

    let hex = '';
    for (let i = 0; i < bit.length; i += 4) {
      hex += parseInt(bit.slice(i, i + 4), 2).toString(16);
    }
    return hex;
  } catch (err) {
    return null;
  }
}

// Khoảng cách Hamming (số bit khác nhau) giữa 2 hash — càng nhỏ càng giống nhau. Trả về Infinity nếu
// thiếu 1 trong 2 giá trị hoặc độ dài không khớp (không thể so sánh), để nơi gọi coi như "chắc chắn
// không cùng nhóm" thay vì so sánh sai.
function khoangCachHamming(hexA, hexB) {
  if (!hexA || !hexB || hexA.length !== hexB.length) return Infinity;

  let khoangCach = 0;
  for (let i = 0; i < hexA.length; i++) {
    const xor = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
    khoangCach += SO_BIT_1_TRONG_NIBBLE[xor];
  }
  return khoangCach;
}

module.exports = { tinhHashAnh, khoangCachHamming };
