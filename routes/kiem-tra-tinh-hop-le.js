// Script RÀ SOÁT (CHỈ ĐỌC, KHÔNG GHI GÌ) — quét toàn bộ đơn hàng hiện có trong Sheet, tìm những
// đơn đang mang tổ hợp TINH_TRANG/TRANG_THAI_PHOI/TRANG_THAI_VE_FILE không hợp lý theo đúng logic
// mới thêm vào services/orderService.js (kiemTraTinhHopLy + tinhTinhTrangTuDong):
//   1. "Chưa xác nhận" mà đã "Đã lấy phôi" hoặc "Đã vẽ file"
//   2. Đã tới "ĐÃ SẴN SÀNG CHẠY MÁY" hoặc các bước sau đó mà phôi/file vẫn chưa xong
//   3. (bổ sung 26/08/2026) Phôi + file đều đã xong nhưng vẫn đang kẹt ở "Đã xác nhận" — lẽ ra
//      phải tự động nhảy lên "ĐÃ SẴN SÀNG CHẠY MÁY"
//
// Quy tắc mới chỉ chặn được lỗi phát sinh TỪ NAY VỀ SAU (khi ai đó sửa dữ liệu qua app) — không tự
// sửa được dữ liệu CŨ đã lỡ sai từ trước khi có script này. Chạy script này 1 lần để biết chính xác
// có bao nhiêu đơn cũ đang sai, rồi tự quyết định sửa tay từng đơn cho đúng.
//
// CÁCH CHẠY: node scripts/kiem-tra-tinh-hop-le.js
// (Không có tham số --apply vì script này KHÔNG BAO GIỜ ghi gì vào Sheet — chỉ in ra danh sách.)

require('dotenv').config();
const orderService = require('../services/orderService');
const { chiSoTinhTrang } = require('../data/pipelineTinhTrang');

const idxSanSang = chiSoTinhTrang('ĐÃ SẴN SÀNG CHẠY MÁY');

function timLoi(don) {
  const loi = [];

  if (don.TINH_TRANG === 'Chưa xác nhận') {
    if (don.TRANG_THAI_PHOI === 'Đã lấy phôi') loi.push('Chưa xác nhận nhưng Đã lấy phôi');
    if (don.TRANG_THAI_VE_FILE === 'Đã vẽ file') loi.push('Chưa xác nhận nhưng Đã vẽ file');
  }

  const idx = chiSoTinhTrang(don.TINH_TRANG);
  if (idx !== null && idx >= idxSanSang) {
    if (don.TRANG_THAI_PHOI !== 'Đã lấy phôi') loi.push(`Đang ở "${don.TINH_TRANG}" nhưng phôi vẫn "${don.TRANG_THAI_PHOI || '(trống)'}"`);
    if (don.TRANG_THAI_VE_FILE !== 'Đã vẽ file') loi.push(`Đang ở "${don.TINH_TRANG}" nhưng vẽ file vẫn "${don.TRANG_THAI_VE_FILE || '(trống)'}"`);
  }

  // Chiều NGƯỢC LẠI (bổ sung 26/08/2026, theo Prompt_Ver_25.docx mục 4): phôi + file đều đã xong,
  // đơn đang "Đã xác nhận" — lẽ ra tinhTinhTrangTuDong() (services/orderService.js) phải TỰ nhảy
  // TINH_TRANG lên "ĐÃ SẴN SÀNG CHẠY MÁY" ngay khi đủ cả 2 điều kiện, nhưng vì lý do gì đó (sửa tay
  // đồng thời cả 3 cột trong cùng 1 lần ghi — tự động hoá chủ động bỏ qua khi người gọi đã tự set
  // TINH_TRANG, dữ liệu cũ từ trước khi có logic tự động, hoặc sửa thẳng trên Sheet không qua app)
  // mà bị kẹt lại ở "Đã xác nhận". Chỉ tính đúng trạng thái "Đã xác nhận" (không tính "Chưa xác
  // nhận" — tổ hợp đó đã bị bắt ở quy tắc đầu tiên phía trên rồi, tính thêm ở đây sẽ bị trùng lặp).
  if (don.TINH_TRANG === 'Đã xác nhận' && don.TRANG_THAI_PHOI === 'Đã lấy phôi' && don.TRANG_THAI_VE_FILE === 'Đã vẽ file') {
    loi.push('Phôi và file đều đã xong nhưng TINH_TRANG vẫn đang "Đã xác nhận" (lẽ ra phải tự nhảy lên "ĐÃ SẴN SÀNG CHẠY MÁY")');
  }

  return loi;
}

async function chay() {
  const { rows } = await orderService.getAll({ fresh: true });

  const donLoi = rows
    .map(don => ({ don, loi: timLoi(don) }))
    .filter(x => x.loi.length > 0);

  console.log(`Tổng số đơn: ${rows.length}. Số đơn có tổ hợp trạng thái KHÔNG hợp lý: ${donLoi.length}.\n`);

  if (donLoi.length === 0) {
    console.log('Không có đơn nào sai — dữ liệu hiện tại nhất quán.');
    return;
  }

  donLoi.forEach(({ don, loi }) => {
    console.log(`- ${don.STT_Key} (TINH_TRANG="${don.TINH_TRANG}", PHOI="${don.TRANG_THAI_PHOI}", VE_FILE="${don.TRANG_THAI_VE_FILE}")`);
    loi.forEach(l => console.log(`    · ${l}`));
  });

  console.log('\nSửa tay từng đơn ở trên (qua trang chi tiết đơn, khối "Sửa trạng thái thủ công") cho khớp đúng logic.');
}

chay().catch(err => {
  console.error('Lỗi khi rà soát:', err.message);
  process.exit(1);
});
