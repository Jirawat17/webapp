// Script MIGRATE LẦN 4 (09/09/2026 lần 3, theo yêu cầu người dùng) — XOÁ trạng thái "Đã đóng gói"
// khỏi hệ thống. "Đã sản xuất" giờ đi THẲNG sang "ĐÃ DÁN TEM" (qua quét mã QR Tracking hoặc admin
// sửa tay) — không còn bước "Đã đóng gói" trung gian nữa. Xem đầy đủ lý do ở
// data/pipelineTinhTrang.js và mục 10 trong docs/superpowers/specs/2026-09-09-tu-dong-mua-tracking-design.md.
//
// Đơn nào ĐANG mang TRANG_THAI_XUONG="Đã đóng gói" (giá trị này giờ không còn hợp lệ trong code — mọi
// lượt ghi mới sẽ bị từ chối) được chuyển VỀ "Đã sản xuất" — vì các đơn này CHƯA chắc đã có mã tracking
// GKE thật (trước đây "Đã đóng gói" không đòi hỏi phải có tracking, chỉ là xác nhận đã đóng gói bằng
// ảnh), nên lùi về "Đã sản xuất" để người phụ trách quét lại mã QR Tracking tạo vận đơn GKE thật, đưa
// đơn sang thẳng "ĐÃ DÁN TEM" — ĐÚNG luồng mới. Không tự đoán chuyển thẳng sang "ĐÃ DÁN TEM" vì không
// chắc đơn nào đã thực sự có tracking (script này CHỈ đổi TRANG_THAI_XUONG, không đụng TRACKING_ID —
// đơn đã có sẵn TRACKING_ID thật từ trước, nếu có, vẫn giữ nguyên, chỉ chưa được đánh dấu "ĐÃ DÁN TEM").
//
// Chạy đúng 1 lần rồi thôi, không phải job định kỳ.
//
// CÁCH CHẠY (trên VPS, tại thư mục gốc dự án — nơi có node_modules và file .env):
//   node scripts/migrate-trang-thai-v4.js           -> chạy thử, CHỈ liệt kê, KHÔNG ghi gì vào Sheet
//   node scripts/migrate-trang-thai-v4.js --apply    -> ghi thật vào Sheet
//
// LUÔN chạy không có --apply trước để xem trước danh sách sẽ đổi, rồi mới chạy lại với --apply.

require('dotenv').config();
const orderService = require('../services/orderService');
const { updateCells } = require('../services/sheetsService');

const TRANG_THAI_CU = 'Đã đóng gói';
const TRANG_THAI_MOI = 'Đã sản xuất';

async function chay() {
  const apply = process.argv.includes('--apply');
  const { headers, rows } = await orderService.getAll({ fresh: true });

  const canDoi = rows.filter(r => r.TRANG_THAI_XUONG === TRANG_THAI_CU);

  console.log(`Tổng số đơn: ${rows.length}. Số đơn đang ở "${TRANG_THAI_CU}" cần đổi: ${canDoi.length}.`);
  if (canDoi.length === 0) {
    console.log('Không có đơn nào đang ở "Đã đóng gói" — không cần làm gì thêm.');
    return;
  }

  console.log('Danh sách đơn sẽ đổi:');
  canDoi.forEach(r => {
    const ghiChuTracking = r.TRACKING_ID ? ` (đã có TRACKING_ID="${r.TRACKING_ID}" — vẫn giữ nguyên, chỉ đổi TRANG_THAI_XUONG)` : '';
    console.log(`  - ${r.STT_Key}${ghiChuTracking}`);
  });

  if (!apply) {
    console.log(`\nSẽ đổi TRANG_THAI_XUONG: "${TRANG_THAI_CU}" -> "${TRANG_THAI_MOI}" cho ${canDoi.length} đơn trên.`);
    console.log('Đây là CHẠY THỬ — chưa ghi gì vào Sheet. Chạy lại với --apply để ghi thật.');
    return;
  }

  console.log('\nĐang ghi vào Sheet...');
  let daGhi = 0;
  for (const r of canDoi) {
    await updateCells('Don_Hang_ALL', headers, r._row, { TRANG_THAI_XUONG: TRANG_THAI_MOI });
    daGhi++;
  }
  console.log(`Xong. Đã đổi ${daGhi} đơn từ "${TRANG_THAI_CU}" sang "${TRANG_THAI_MOI}".`);
  console.log('Nhắc: những đơn này cần được quét lại mã QR Tracking để tạo vận đơn GKE thật và chuyển sang "ĐÃ DÁN TEM".');
}

chay().catch(err => {
  console.error('Lỗi khi migrate:', err.message);
  process.exit(1);
});
