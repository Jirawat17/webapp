// Script MIGRATE 1 LẦN — đổi TINH_TRANG của các đơn hiện có trong Don_Hang_ALL sang tên trạng
// thái mới theo pipeline mới (So_do_logic.pdf, áp dụng 24/08/2026). Chạy đúng 1 lần rồi thôi,
// không phải job chạy định kỳ.
//
// CÁCH CHẠY (trên VPS, tại thư mục gốc dự án — nơi có node_modules và file .env):
//   node scripts/migrate-trang-thai.js           -> chạy thử, CHỈ liệt kê, KHÔNG ghi gì vào Sheet
//   node scripts/migrate-trang-thai.js --apply    -> ghi thật vào Sheet
//
// LUÔN chạy không có --apply trước để xem trước danh sách sẽ đổi, rồi mới chạy lại với --apply.

require('dotenv').config();
const orderService = require('../services/orderService');
const { updateCells } = require('../services/sheetsService');

const ANH_XA_CU_MOI = {
  'B0_Chờ xác nhận': 'B1.2_HOLD_Chưa xác nhận',
  'B1_Đã in': 'B1.1_Đơn đã xác nhận',
  'B2_Đã lấy phôi': 'B2.1_Đã có phôi',
  'B3_Đã đủ Phôi và File Vẽ': 'B3.1_Đã vẽ file',
  'B4_Đang sản xuất': 'B4.1_Đơn đã sản xuất',
  'B5_Đã sản xuất': 'B5.1_Đơn đã đóng gói',
  'ĐƠN LỖI CẦN LÀM LẠI': 'B4.3_ĐƠN LỖI CẦN LÀM LẠI',
};

async function chay() {
  const apply = process.argv.includes('--apply');
  const { headers, rows } = await orderService.getAll({ fresh: true });

  const canDoi = rows.filter(r => ANH_XA_CU_MOI[r.TINH_TRANG]);

  console.log(`Tổng số đơn: ${rows.length}. Số đơn cần đổi trạng thái: ${canDoi.length}.`);
  if (canDoi.length === 0) {
    console.log('Không có đơn nào mang trạng thái cũ — không cần làm gì thêm.');
    return;
  }

  const demTheoTrangThaiCu = {};
  canDoi.forEach(r => { demTheoTrangThaiCu[r.TINH_TRANG] = (demTheoTrangThaiCu[r.TINH_TRANG] || 0) + 1; });
  console.log('Chi tiết theo trạng thái cũ:');
  Object.entries(demTheoTrangThaiCu).forEach(([cu, soLuong]) => {
    console.log(`  - "${cu}" -> "${ANH_XA_CU_MOI[cu]}"  (${soLuong} đơn)`);
  });

  if (!apply) {
    console.log('\nĐây là CHẠY THỬ — chưa ghi gì vào Sheet. Chạy lại với --apply để ghi thật.');
    return;
  }

  console.log('\nĐang ghi vào Sheet...');
  let daGhi = 0;
  for (const r of canDoi) {
    await updateCells('Don_Hang_ALL', headers, r._row, { TINH_TRANG: ANH_XA_CU_MOI[r.TINH_TRANG] });
    daGhi++;
    if (daGhi % 20 === 0) console.log(`  ...đã ghi ${daGhi}/${canDoi.length}`);
  }
  console.log(`Xong. Đã đổi trạng thái cho ${daGhi} đơn.`);
}

chay().catch(err => {
  console.error('Lỗi khi migrate:', err.message);
  process.exit(1);
});
