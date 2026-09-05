// Script MIGRATE LẦN 3 (05/09/2026, theo yêu cầu người dùng) — đổi tên 2 giá trị TRANG_THAI_XUONG
// 'Chưa xác nhận'/'Đã xác nhận' thành 'Chưa in mã'/'Đã in mã' cho TOÀN BỘ đơn đang mang 1 trong 2 giá
// trị cũ này. CHỈ đổi TÊN GỌI — không đụng gì tới TRANG_THAI_PHOI/TRANG_THAI_VE_FILE hay bất kỳ logic
// nào khác (khác migrate-trang-thai-v2.js — lần đó tách 1 cột thành 3 cột, lần này chỉ đổi chữ trong
// đúng 1 cột TRANG_THAI_XUONG). Xem giải thích đầy đủ trong data/pipelineTinhTrang.js.
//
// CÁCH CHẠY (trên VPS, tại thư mục gốc dự án — nơi có node_modules và file .env):
//   node scripts/migrate-trang-thai-v3.js           -> chạy thử, CHỈ liệt kê, KHÔNG ghi gì vào Sheet
//   node scripts/migrate-trang-thai-v3.js --apply    -> ghi thật vào Sheet
//
// LUÔN chạy không có --apply trước để xem trước danh sách sẽ đổi, rồi mới chạy lại với --apply.
//
// SAU KHI CHẠY --apply XONG, còn 1 việc NẰM NGOÀI phạm vi code Node, phải tự làm: Apps Script (kênh
// tạo đơn mới) hiện đang set mặc định TRANG_THAI_XUONG='Chưa xác nhận' cho đơn vừa tạo — phải tự sửa
// lại thành 'Chưa in mã', không thì MỌI đơn tạo mới sau này vẫn mang tên cũ, không khớp với code đã
// đổi (dropdown lọc/chuyển trạng thái sẽ không có mục nào khớp đúng, badge sẽ hiện đúng chữ cũ nhưng
// không dùng được các quy tắc validate mới).

require('dotenv').config();
const orderService = require('../services/orderService');
const { updateCells } = require('../services/sheetsService');

const ANH_XA_CU_MOI = {
  'Chưa xác nhận': 'Chưa in mã',
  'Đã xác nhận': 'Đã in mã',
};

async function chay() {
  const apply = process.argv.includes('--apply');
  const { headers, rows } = await orderService.getAll({ fresh: true });

  const canDoi = rows.filter(r => ANH_XA_CU_MOI[r.TRANG_THAI_XUONG]);

  console.log(`Tổng số đơn: ${rows.length}. Số đơn mang tên trạng thái CŨ cần đổi: ${canDoi.length}.`);
  if (canDoi.length === 0) {
    console.log('Không có đơn nào mang tên cũ — không cần làm gì thêm.');
    return;
  }

  const demTheoTrangThaiCu = {};
  canDoi.forEach(r => { demTheoTrangThaiCu[r.TRANG_THAI_XUONG] = (demTheoTrangThaiCu[r.TRANG_THAI_XUONG] || 0) + 1; });
  console.log('Chi tiết theo tên cũ:');
  Object.entries(demTheoTrangThaiCu).forEach(([cu, soLuong]) => {
    console.log(`  - "${cu}" (${soLuong} đơn) -> "${ANH_XA_CU_MOI[cu]}"`);
  });

  if (!apply) {
    console.log('\nĐây là CHẠY THỬ — chưa ghi gì vào Sheet. Chạy lại với --apply để ghi thật.');
    return;
  }

  console.log('\nĐang ghi vào Sheet...');
  let daGhi = 0;
  for (const r of canDoi) {
    await updateCells('Don_Hang_ALL', headers, r._row, {
      TRANG_THAI_XUONG: ANH_XA_CU_MOI[r.TRANG_THAI_XUONG],
    });
    daGhi++;
    if (daGhi % 20 === 0) console.log(`  ...đã ghi ${daGhi}/${canDoi.length}`);
  }
  console.log(`Xong. Đã đổi tên trạng thái cho ${daGhi} đơn.`);
}

chay().catch(err => {
  console.error('Lỗi khi migrate:', err.message);
  process.exit(1);
});
