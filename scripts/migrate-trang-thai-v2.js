// Script MIGRATE LẦN 2 (24/08/2026, theo Prompt_Ver_24.docx) — chuyển đổi TOÀN BỘ đơn đang mang
// trạng thái theo hệ CŨ (B1.1_..-B5.2_.., 1 cột TRANG_THAI_XUONG duy nhất) sang hệ MỚI (3 cột: TRANG_THAI_XUONG,
// TRANG_THAI_PHOI, TRANG_THAI_VE_FILE). Chạy đúng 1 lần rồi thôi, không phải job định kỳ.
//
// BẮT BUỘC LÀM TRƯỚC KHI CHẠY SCRIPT NÀY: thêm 2 cột mới "TRANG_THAI_PHOI" và "TRANG_THAI_VE_FILE"
// vào tab Don_Hang_ALL trên Google Sheet (script này chỉ GHI dữ liệu vào 2 cột đó, không tự tạo cột).
//
// CÁCH CHẠY (trên VPS, tại thư mục gốc dự án — nơi có node_modules và file .env):
//   node scripts/migrate-trang-thai-v2.js           -> chạy thử, CHỈ liệt kê, KHÔNG ghi gì vào Sheet
//   node scripts/migrate-trang-thai-v2.js --apply    -> ghi thật vào Sheet
//
// LUÔN chạy không có --apply trước để xem trước danh sách sẽ đổi, rồi mới chạy lại với --apply.

require('dotenv').config();
const orderService = require('../services/orderService');
const { updateCells } = require('../services/sheetsService');

// Mỗi trạng thái CŨ ánh xạ sang { TRANG_THAI_XUONG, TRANG_THAI_PHOI, TRANG_THAI_VE_FILE } MỚI.
// Xem giải thích đầy đủ từng dòng trong data/pipelineTinhTrang.js (phần đầu file).
const ANH_XA_CU_MOI = {
  'B1.2_HOLD_Chưa xác nhận':   { TRANG_THAI_XUONG: 'Chưa xác nhận',          TRANG_THAI_PHOI: 'Chưa lấy phôi', TRANG_THAI_VE_FILE: 'Chưa vẽ file' },
  'B1.1_Đơn đã xác nhận':      { TRANG_THAI_XUONG: 'Đã xác nhận',            TRANG_THAI_PHOI: 'Chưa lấy phôi', TRANG_THAI_VE_FILE: 'Chưa vẽ file' },
  'B2.2_Không có phôi':        { TRANG_THAI_XUONG: 'Đã xác nhận',            TRANG_THAI_PHOI: 'Chưa lấy phôi', TRANG_THAI_VE_FILE: 'Chưa vẽ file' },
  'B2.1_Đã có phôi':           { TRANG_THAI_XUONG: 'Đã xác nhận',            TRANG_THAI_PHOI: 'Đã lấy phôi',   TRANG_THAI_VE_FILE: 'Chưa vẽ file' },
  'B3.2_Chưa vẽ file':         { TRANG_THAI_XUONG: 'Đã xác nhận',            TRANG_THAI_PHOI: 'Đã lấy phôi',   TRANG_THAI_VE_FILE: 'Chưa vẽ file' },
  'B3.1_Đã vẽ file':           { TRANG_THAI_XUONG: 'ĐÃ SẴN SÀNG CHẠY MÁY',   TRANG_THAI_PHOI: 'Đã lấy phôi',   TRANG_THAI_VE_FILE: 'Đã vẽ file' },
  'B4.2_Đơn chưa sản xuất':    { TRANG_THAI_XUONG: 'ĐÃ SẴN SÀNG CHẠY MÁY',   TRANG_THAI_PHOI: 'Đã lấy phôi',   TRANG_THAI_VE_FILE: 'Đã vẽ file' },
  'B4.3_ĐƠN LỖI CẦN LÀM LẠI':  { TRANG_THAI_XUONG: 'LỖI SẢN XUẤT CẦN LÀM LẠI', TRANG_THAI_PHOI: 'Chưa lấy phôi', TRANG_THAI_VE_FILE: 'Chưa vẽ file' }, // làm lại từ đầu
  'B4.1_Đơn đã sản xuất':      { TRANG_THAI_XUONG: 'Đã sản xuất',            TRANG_THAI_PHOI: 'Đã lấy phôi',   TRANG_THAI_VE_FILE: 'Đã vẽ file' },
  'B5.2_Đơn chưa đóng gói':    { TRANG_THAI_XUONG: 'Đã sản xuất',            TRANG_THAI_PHOI: 'Đã lấy phôi',   TRANG_THAI_VE_FILE: 'Đã vẽ file' }, // "Chưa đóng gói" không còn tồn tại, gộp về "Đã sản xuất"
  'B5.1_Đơn đã đóng gói':      { TRANG_THAI_XUONG: 'Đã đóng gói',            TRANG_THAI_PHOI: 'Đã lấy phôi',   TRANG_THAI_VE_FILE: 'Đã vẽ file' },
  'SHIPPED_Đã gửi vận chuyển': { TRANG_THAI_XUONG: 'IN TRANSIT_Tracking đã hoạt động', TRANG_THAI_PHOI: 'Đã lấy phôi', TRANG_THAI_VE_FILE: 'Đã vẽ file' }, // SHIPPED không còn tồn tại, coi như đã bắt đầu vận chuyển (đã xác nhận với người dùng)
  'IN TRAINSIT_Tracking đã hoạt động': { TRANG_THAI_XUONG: 'IN TRANSIT_Tracking đã hoạt động', TRANG_THAI_PHOI: 'Đã lấy phôi', TRANG_THAI_VE_FILE: 'Đã vẽ file' }, // sửa lại đúng chính tả, bỏ chữ I thừa
  'DELIVERED_Đã giao hàng đến khách':  { TRANG_THAI_XUONG: 'DELIVERED_Đã giao đến khách', TRANG_THAI_PHOI: 'Đã lấy phôi', TRANG_THAI_VE_FILE: 'Đã vẽ file' },
  'CANCELLED_Đã hủy đơn':      { TRANG_THAI_XUONG: 'CANCELLED_Đã hủy',       TRANG_THAI_PHOI: 'Đã lấy phôi',   TRANG_THAI_VE_FILE: 'Đã vẽ file' },
  'REFUNDED_Hoàn đơn':         { TRANG_THAI_XUONG: 'REFUNDED_Hoàn đơn',      TRANG_THAI_PHOI: 'Đã lấy phôi',   TRANG_THAI_VE_FILE: 'Đã vẽ file' },
};

async function chay() {
  const apply = process.argv.includes('--apply');
  const { headers, rows } = await orderService.getAll({ fresh: true });

  if (!headers.includes('TRANG_THAI_PHOI') || !headers.includes('TRANG_THAI_VE_FILE')) {
    console.error('LỖI: Sheet chưa có cột "TRANG_THAI_PHOI" và/hoặc "TRANG_THAI_VE_FILE" trong tab Don_Hang_ALL.');
    console.error('Thêm 2 cột này vào Sheet trước, rồi chạy lại script.');
    process.exit(1);
  }

  const canDoi = rows.filter(r => ANH_XA_CU_MOI[r.TRANG_THAI_XUONG]);

  console.log(`Tổng số đơn: ${rows.length}. Số đơn mang trạng thái hệ CŨ cần đổi: ${canDoi.length}.`);
  if (canDoi.length === 0) {
    console.log('Không có đơn nào mang trạng thái hệ cũ — không cần làm gì thêm.');
    return;
  }

  const demTheoTrangThaiCu = {};
  canDoi.forEach(r => { demTheoTrangThaiCu[r.TRANG_THAI_XUONG] = (demTheoTrangThaiCu[r.TRANG_THAI_XUONG] || 0) + 1; });
  console.log('Chi tiết theo trạng thái cũ:');
  Object.entries(demTheoTrangThaiCu).forEach(([cu, soLuong]) => {
    const moi = ANH_XA_CU_MOI[cu];
    console.log(`  - "${cu}" (${soLuong} đơn) -> TRANG_THAI_XUONG="${moi.TRANG_THAI_XUONG}", PHOI="${moi.TRANG_THAI_PHOI}", VE_FILE="${moi.TRANG_THAI_VE_FILE}"`);
  });

  if (!apply) {
    console.log('\nĐây là CHẠY THỬ — chưa ghi gì vào Sheet. Chạy lại với --apply để ghi thật.');
    return;
  }

  console.log('\nĐang ghi vào Sheet...');
  let daGhi = 0;
  for (const r of canDoi) {
    const moi = ANH_XA_CU_MOI[r.TRANG_THAI_XUONG];
    await updateCells('Don_Hang_ALL', headers, r._row, {
      TRANG_THAI_XUONG: moi.TRANG_THAI_XUONG,
      TRANG_THAI_PHOI: moi.TRANG_THAI_PHOI,
      TRANG_THAI_VE_FILE: moi.TRANG_THAI_VE_FILE,
    });
    daGhi++;
    if (daGhi % 20 === 0) console.log(`  ...đã ghi ${daGhi}/${canDoi.length}`);
  }
  console.log(`Xong. Đã đổi ${daGhi} đơn sang hệ trạng thái mới.`);
}

chay().catch(err => {
  console.error('Lỗi khi migrate:', err.message);
  process.exit(1);
});
