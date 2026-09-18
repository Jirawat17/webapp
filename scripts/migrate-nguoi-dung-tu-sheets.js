// Script MIGRATE 1 LẦN (18/09/2026, theo yêu cầu người dùng) — copy toàn bộ tài khoản đang có trong
// tab "NguoiDung" của Google Sheets sang bảng SQLite mới (services/taiKhoanService.js), để từ nay quản
// lý tài khoản hoàn toàn qua SQLite, không cần mở Sheet nữa (xem
// docs/superpowers/specs/2026-09-18-tai-khoan-sqlite-design.md).
//
// BẮT BUỘC chạy đúng 1 lần SAU khi deploy bản có tính năng này, TRƯỚC khi có ai cần đăng nhập lại —
// nếu quên, routes/auth.js/routes/users.js sẽ đọc bảng SQLite TRỐNG (KHÔNG tự đọc lại Sheets), nghĩa là
// KHÔNG AI đăng nhập được cho tới khi chạy script này (xem cảnh báo tự in ra ở
// services/taiKhoanService.js#canhBaoNeuChuaMigrate nếu quên).
//
// AN TOÀN CHẠY LẠI NHIỀU LẦN (idempotent) — tài khoản đã có trong SQLite (theo Ten) sẽ được BỎ QUA,
// không ghi đè, không tạo trùng — chỉ thêm tài khoản MỚI có trong Sheets mà SQLite chưa có.
//
// CÁCH CHẠY (trên VPS, tại thư mục gốc dự án — nơi có node_modules, .env và service-account.json):
//   node scripts/migrate-nguoi-dung-tu-sheets.js           -> chạy thử, CHỈ liệt kê, KHÔNG ghi gì
//   node scripts/migrate-nguoi-dung-tu-sheets.js --apply    -> ghi thật vào SQLite
//
// LUÔN chạy không có --apply trước để xem trước danh sách sẽ migrate, rồi mới chạy lại với --apply.

require('dotenv').config();
const { readTab } = require('../services/sheetsService');
const taiKhoanService = require('../services/taiKhoanService');

const TAB = 'NguoiDung';

async function chay() {
  const apply = process.argv.includes('--apply');
  const { rows } = await readTab(TAB);

  const daCoTrongSqlite = new Set(taiKhoanService.layTatCa().map(r => r.Ten));
  const canMigrate = rows.filter(r => r.Ten && !daCoTrongSqlite.has(r.Ten));
  const boQuaDaCo = rows.filter(r => r.Ten && daCoTrongSqlite.has(r.Ten));

  console.log(`Tổng số tài khoản trong Sheets: ${rows.length}.`);
  console.log(`Đã có sẵn trong SQLite (bỏ qua, không ghi đè): ${boQuaDaCo.length}.`);
  console.log(`Cần migrate: ${canMigrate.length}.`);
  if (canMigrate.length === 0) {
    console.log('Không có tài khoản nào cần migrate — SQLite đã có đủ.');
    return;
  }

  console.log('\nDanh sách tài khoản sẽ migrate:');
  canMigrate.forEach(r => {
    console.log(`  - ${r.Ten} (VaiTro=${r.VaiTro || '(trống)'}, Xuong=${r.Xuong || '(chưa gán)'}, ${r.MatKhau ? 'đã có mật khẩu' : 'CHƯA có mật khẩu'})`);
  });

  if (!apply) {
    console.log(`\nSẽ thêm ${canMigrate.length} tài khoản trên vào SQLite. Đây là CHẠY THỬ — chưa ghi gì. Chạy lại với --apply để ghi thật.`);
    return;
  }

  console.log('\nĐang ghi vào SQLite...');
  let daGhi = 0;
  for (const r of canMigrate) {
    taiKhoanService.themMoi({
      Ten: r.Ten, VaiTro: r.VaiTro || '', Team: r.Team || '', Xuong: r.Xuong || '',
      KichHoat: r.KichHoat || '', MatKhau: r.MatKhau || '', HienThiDangNhap: r.HienThiDangNhap || '',
    });
    daGhi++;
  }
  console.log(`Xong. Đã migrate ${daGhi}/${canMigrate.length} tài khoản vào SQLite.`);
  console.log('Từ giờ routes/auth.js và routes/users.js đọc/ghi thẳng SQLite, không đụng Sheets nữa.');
}

chay().catch(err => {
  console.error('Lỗi khi migrate:', err.message);
  process.exit(1);
});
