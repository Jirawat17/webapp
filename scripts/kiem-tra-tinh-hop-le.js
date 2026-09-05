// Script RÀ SOÁT (CHỈ ĐỌC, KHÔNG GHI GÌ) — quét toàn bộ đơn hàng hiện có trong Sheet, tìm những
// đơn đang mang tổ hợp TRANG_THAI_XUONG/TRANG_THAI_PHOI/TRANG_THAI_VE_FILE không hợp lý theo đúng 2 quy
// tắc mới thêm vào services/orderService.js (kiemTraTinhHopLy):
//   1. "Chưa in mã" mà đã "Đã lấy phôi" hoặc "Đã vẽ file"
//   2. Đã tới "ĐÃ SẴN SÀNG CHẠY MÁY" hoặc các bước sau đó mà phôi/file vẫn chưa xong
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

  if (don.TRANG_THAI_XUONG === 'Chưa in mã') {
    if (don.TRANG_THAI_PHOI === 'Đã lấy phôi') loi.push('Chưa in mã nhưng Đã lấy phôi');
    if (don.TRANG_THAI_VE_FILE === 'Đã vẽ file') loi.push('Chưa in mã nhưng Đã vẽ file');
  }

  const idx = chiSoTinhTrang(don.TRANG_THAI_XUONG);
  if (idx !== null && idx >= idxSanSang) {
    if (don.TRANG_THAI_PHOI !== 'Đã lấy phôi') loi.push(`Đang ở "${don.TRANG_THAI_XUONG}" nhưng phôi vẫn "${don.TRANG_THAI_PHOI || '(trống)'}"`);
    if (don.TRANG_THAI_VE_FILE !== 'Đã vẽ file') loi.push(`Đang ở "${don.TRANG_THAI_XUONG}" nhưng vẽ file vẫn "${don.TRANG_THAI_VE_FILE || '(trống)'}"`);
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
    console.log(`- ${don.STT_Key} (TRANG_THAI_XUONG="${don.TRANG_THAI_XUONG}", PHOI="${don.TRANG_THAI_PHOI}", VE_FILE="${don.TRANG_THAI_VE_FILE}")`);
    loi.forEach(l => console.log(`    · ${l}`));
  });

  console.log('\nSửa tay từng đơn ở trên (qua trang chi tiết đơn, khối "Sửa trạng thái thủ công") cho khớp đúng logic.');
}

chay().catch(err => {
  console.error('Lỗi khi rà soát:', err.message);
  process.exit(1);
});
