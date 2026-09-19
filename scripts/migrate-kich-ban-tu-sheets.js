// Script MIGRATE 1 LẦN (19/09/2026, theo yêu cầu người dùng) — copy toàn bộ "kịch bản" quét QR đang có
// trong tab Sheet "CauHinhKichBan" sang SQLite (services/kichBanDbService.js), xem
// docs/superpowers/specs/2026-09-19-kich-ban-sqlite-design.md.
//
// BẮT BUỘC chạy đúng 1 lần SAU khi deploy bản có tính năng này, TRƯỚC khi có ai cần quét QR — nếu
// quên, SQLite sẽ TRỐNG (mọi màn hình quét sẽ không còn kịch bản nào để chọn) cho tới khi chạy script
// này hoặc admin tự thêm lại qua trang Kịch bản quét mới.
//
// AN TOÀN CHẠY LẠI NHIỀU LẦN (idempotent) — khớp theo Ten_Kich_Ban: MẶC ĐỊNH bỏ qua kịch bản đã có
// trong SQLite (tránh mất chỉnh sửa đã làm qua trang quản lý mới sau lần migrate đầu). Dùng --force để
// ghi đè bằng giá trị hiện tại trong Sheets (giữ nguyên id cũ trong SQLite, chỉ cập nhật nội dung).
//
// CÁCH CHẠY (trên VPS, tại thư mục gốc dự án — nơi có node_modules, .env và service-account.json):
//   node scripts/migrate-kich-ban-tu-sheets.js            -> chạy thử, CHỈ liệt kê, KHÔNG ghi gì
//   node scripts/migrate-kich-ban-tu-sheets.js --apply     -> ghi thật vào SQLite
//   node scripts/migrate-kich-ban-tu-sheets.js --apply --force  -> ghi đè cả kịch bản đã có sẵn

require('dotenv').config();
const { readTab } = require('../services/sheetsService');
const kichBanDbService = require('../services/kichBanDbService');

const TAB = 'CauHinhKichBan';

async function chay() {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');

  const { rows } = await readTab(TAB).catch(() => ({ rows: [] }));
  const rowsHopLe = rows.filter(r => r.Ten_Kich_Ban && r.Trang_Thai_Sau);

  console.log(`Tổng số dòng trong Sheets: ${rows.length}. Hợp lệ (có Ten_Kich_Ban + Trang_Thai_Sau): ${rowsHopLe.length}.`);
  if (rows.length > rowsHopLe.length) {
    console.log(`  (${rows.length - rowsHopLe.length} dòng thiếu Ten_Kich_Ban hoặc Trang_Thai_Sau — bỏ qua, đúng cách app hiện đang lọc.)`);
  }
  if (rowsHopLe.length === 0) {
    console.log('Không có kịch bản hợp lệ nào để migrate.');
    return;
  }

  console.log('\nDanh sách kịch bản sẽ migrate:');
  rowsHopLe.forEach(r => {
    const daCo = kichBanDbService.layTheoTen(r.Ten_Kich_Ban);
    const trangThai = daCo ? (force ? '(đã có — sẽ GHI ĐÈ vì có --force)' : '(đã có — sẽ BỎ QUA)') : '(mới)';
    console.log(`  - ${r.Ten_Kich_Ban} ${trangThai}`);
  });

  if (!apply) {
    console.log('\nĐây là CHẠY THỬ — chưa ghi gì vào SQLite. Chạy lại với --apply để ghi thật.');
    return;
  }

  console.log('\nĐang ghi vào SQLite...');
  let daThem = 0, daCapNhat = 0, boQua = 0;
  for (const r of rowsHopLe) {
    const dong = {
      Ten_Kich_Ban: r.Ten_Kich_Ban, Trang_Thai_Yeu_Cau: r.Trang_Thai_Yeu_Cau || '',
      Trang_Thai_Sau: r.Trang_Thai_Sau, Cot: (r.Cot || '').trim(), Nguoi_Thuc_Hien: r.Nguoi_Thuc_Hien || '',
    };
    const daCo = kichBanDbService.layTheoTen(r.Ten_Kich_Ban);
    if (daCo) {
      if (!force) { boQua++; continue; }
      kichBanDbService.capNhat(daCo.id, dong);
      daCapNhat++;
    } else {
      kichBanDbService.themMoi(dong);
      daThem++;
    }
  }
  console.log(`Xong. Đã thêm ${daThem} kịch bản mới, cập nhật ${daCapNhat}, bỏ qua ${boQua} (đã có sẵn, dùng --force nếu muốn ghi đè).`);
}

chay().catch(err => {
  console.error('Lỗi khi migrate:', err.message);
  process.exit(1);
});
