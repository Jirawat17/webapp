// Script MIGRATE 1 LẦN (19/09/2026, theo yêu cầu người dùng) — copy giá trị ĐANG DÙNG của 2 tab cấu
// hình (CaiDatHangLoat, CauHinhTracking) từ Google Sheets sang SQLite (services/caiDatDbService.js),
// Giai đoạn 2/3 của việc chuyển 6 tab sang SQLite — xem
// docs/superpowers/specs/2026-09-19-cai-dat-sqlite-design.md.
//
// KHÁC 3 tab log (Giai đoạn 1, bắt đầu trắng) — đây là dữ liệu ĐANG SỐNG (ngưỡng gộp ảnh, tài khoản/
// cấu hình GKE đang chạy thật). BẮT BUỘC chạy đúng 1 lần SAU khi deploy bản có tính năng này, TRƯỚC
// khi có ai cần dùng lại tính năng "Đơn hàng loạt" hoặc tự động mua tracking GKE — nếu quên, 2 bảng
// SQLite sẽ TRỐNG (ngưỡng về mặc định, tài khoản GKE mất hết) cho tới khi chạy script này hoặc admin
// tự nhập lại qua giao diện.
//
// AN TOÀN CHẠY LẠI NHIỀU LẦN (idempotent) — MẶC ĐỊNH bỏ qua bảng nào SQLite đã có dữ liệu (không ghi
// đè, tránh mất giá trị đã đổi qua giao diện sau lần migrate đầu). Dùng --force để ghi đè bằng giá trị
// hiện tại trong Sheets (hiếm khi cần — chỉ khi thật sự muốn đồng bộ lại từ Sheets).
//
// CÁCH CHẠY (trên VPS, tại thư mục gốc dự án — nơi có node_modules, .env và service-account.json):
//   node scripts/migrate-cai-dat-tu-sheets.js            -> chạy thử, CHỈ liệt kê, KHÔNG ghi gì
//   node scripts/migrate-cai-dat-tu-sheets.js --apply     -> ghi thật vào SQLite
//   node scripts/migrate-cai-dat-tu-sheets.js --apply --force  -> ghi đè cả bảng đã có dữ liệu

require('dotenv').config();
const { readTab } = require('../services/sheetsService');
const caiDatDbService = require('../services/caiDatDbService');

async function chay() {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');

  // ---------- CaiDatHangLoat ----------
  console.log('== CaiDatHangLoat (ngưỡng Hamming) ==');
  const { rows: rowsNguong } = await readTab('CaiDatHangLoat').catch(() => ({ rows: [] }));
  const dongNguong = rowsNguong[0];
  const daCoNguong = !!caiDatDbService.layCaiDatHangLoat();

  if (!dongNguong) {
    console.log('  Sheets chưa có dòng nào — không có gì để migrate.');
  } else if (daCoNguong && !force) {
    console.log('  SQLite đã có dữ liệu — bỏ qua (dùng --force nếu muốn ghi đè).');
  } else {
    console.log(`  Sẽ ${apply ? 'ghi' : '(chạy thử) ghi'} NGUONG_HAMMING = "${dongNguong.NGUONG_HAMMING || ''}"`);
    if (apply) caiDatDbService.datCaiDatHangLoat(dongNguong.NGUONG_HAMMING || '');
  }

  // ---------- CauHinhTracking ----------
  console.log('\n== CauHinhTracking (bật/tắt tự động mua tracking + cấu hình GKE) ==');
  const { rows: rowsCauHinh } = await readTab('CauHinhTracking').catch(() => ({ rows: [] }));
  const dongCauHinh = rowsCauHinh[0];
  const daCoCauHinh = !!caiDatDbService.layCauHinhTracking();

  if (!dongCauHinh) {
    console.log('  Sheets chưa có dòng nào — không có gì để migrate.');
  } else if (daCoCauHinh && !force) {
    console.log('  SQLite đã có dữ liệu — bỏ qua (dùng --force nếu muốn ghi đè).');
  } else {
    const giaTri = {};
    caiDatDbService.CAC_COT_CAU_HINH_TRACKING.forEach(c => { giaTri[c] = dongCauHinh[c] || ''; });
    console.log(`  Sẽ ${apply ? 'ghi' : '(chạy thử) ghi'}:`, {
      ...giaTri,
      GkePassword: giaTri.GkePassword ? '(có giá trị, ẩn không in ra)' : '(trống)',
    });
    if (apply) caiDatDbService.datCauHinhTracking(giaTri);
  }

  if (!apply) {
    console.log('\nĐây là CHẠY THỬ — chưa ghi gì vào SQLite. Chạy lại với --apply để ghi thật.');
  } else {
    console.log('\nXong.');
  }
}

chay().catch(err => {
  console.error('Lỗi khi migrate:', err.message);
  process.exit(1);
});
