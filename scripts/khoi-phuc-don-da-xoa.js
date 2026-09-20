// Script KHÔI PHỤC 1 hoặc nhiều đơn đã bấm "Xoá dữ liệu đơn hàng" (bổ sung 20/09/2026, theo yêu cầu
// người dùng — xem services/xoaDuLieuDonService.js, routes/orders.js POST /xoa-du-lieu-hang-loat).
//
// CHỈ dùng được khi dòng "gốc" của đơn đó VẪN CÒN trên Google Sheets (Don_Hang_ALL/RAW) — nút "Xoá dữ
// liệu đơn" KHÔNG đụng gì tới Sheets, chỉ xoá dữ liệu app tự theo dõi (trạng thái/tracking/hash/ảnh,
// lịch sử hoạt động, log tracking, tư cách nhóm Đơn hàng loạt) và đặt cờ DA_XOA để ẩn đơn khỏi mọi danh
// sách trong app. Script này CHỈ xoá cờ DA_XOA — dữ liệu app đã xoá (lịch sử, ảnh, nhóm...) KHÔNG thể
// khôi phục lại được, đơn sẽ hiện lại với dữ liệu Sheets nguyên vẹn nhưng trạng thái app HOÀN TOÀN
// TRẮNG (chưa in mã/chưa lấy phôi/chưa vẽ file/chưa tracking...), không phải đúng trạng thái trước khi
// bị xoá.
//
// Nếu dòng gốc trên Sheets CŨNG đã bị xoá — script này KHÔNG giúp được gì, phải nhập lại đơn từ đầu qua
// đúng quy trình lên đơn bình thường (STT_Key có ra lại y hệt hay không tuỳ cách Sheet RAW sinh mã).
//
// AN TOÀN CHẠY LẠI NHIỀU LẦN (idempotent) — chạy trên đơn đã khôi phục rồi hoặc đơn chưa từng bị xoá
// đều không gây hại gì (chỉ là no-op, tự báo "không có gì để khôi phục").
//
// CÁCH CHẠY (trên VPS, tại thư mục gốc dự án — nơi có node_modules, .env và service-account.json):
//   node scripts/khoi-phuc-don-da-xoa.js STT001 STT002         -> chạy thử, CHỈ liệt kê, KHÔNG ghi gì
//   node scripts/khoi-phuc-don-da-xoa.js STT001 STT002 --apply -> ghi thật, xoá cờ DA_XOA

require('dotenv').config();
const trangThaiDbService = require('../services/trangThaiDbService');

async function chay() {
  const apply = process.argv.includes('--apply');
  const sttKeys = process.argv.slice(2).filter(a => !a.startsWith('--'));

  if (sttKeys.length === 0) {
    console.log('Cần truyền ít nhất 1 mã STT_Key. Ví dụ: node scripts/khoi-phuc-don-da-xoa.js STT001 STT002 [--apply]');
    return;
  }

  console.log('Trạng thái hiện tại:');
  const canKhoiPhuc = [];
  for (const sttKey of sttKeys) {
    const dong = trangThaiDbService.layTheoKey(sttKey);
    if (dong.DA_XOA === 'TRUE') {
      console.log(`  - ${sttKey}: ĐANG bị ẩn (đã bấm "Xoá dữ liệu đơn")`);
      canKhoiPhuc.push(sttKey);
    } else {
      console.log(`  - ${sttKey}: KHÔNG bị ẩn — không có gì để khôi phục, bỏ qua`);
    }
  }

  if (canKhoiPhuc.length === 0) {
    console.log('\nKhông có đơn nào cần khôi phục.');
    return;
  }

  if (!apply) {
    console.log(`\nĐây là CHẠY THỬ — chưa ghi gì. Chạy lại với --apply để khôi phục thật ${canKhoiPhuc.length} đơn ở trên.`);
    return;
  }

  for (const sttKey of canKhoiPhuc) {
    trangThaiDbService.ghiDe(sttKey, { DA_XOA: '' });
  }
  console.log(`\nXong. Đã khôi phục ${canKhoiPhuc.length} đơn: ${canKhoiPhuc.join(', ')}.`);
  console.log('LƯU Ý: đơn hiện lại với dữ liệu Sheets nguyên vẹn, nhưng trạng thái app (đã lấy phôi/vẽ file/tracking...) hoàn toàn TRẮNG — dữ liệu app cũ đã xoá thật trước đó, không thể khôi phục.');
}

chay().catch(err => {
  console.error('Lỗi khi khôi phục:', err.message);
  process.exit(1);
});
