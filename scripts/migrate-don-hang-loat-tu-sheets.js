// Script MIGRATE 1 LẦN (19/09/2026, theo yêu cầu người dùng) — copy các "Đơn hàng loạt" ĐANG HOẠT
// ĐỘNG (bỏ qua dòng đã DaXoa='TRUE' — đúng ngữ nghĩa "đã xoá thật" của thiết kế mới) từ Google Sheets
// sang SQLite (services/donHangLoatDbService.js, 2 bảng dhl_nhom/dhl_thanh_vien), Giai đoạn 3/3 —
// xem docs/superpowers/specs/2026-09-19-don-hang-loat-sqlite-design.md.
//
// BẮT BUỘC chạy đúng 1 lần SAU khi deploy bản có tính năng này, TRƯỚC khi ai cần dùng lại menu "Đơn
// hàng loạt" — nếu quên, SQLite sẽ TRỐNG (các nhóm hiện tại "biến mất" khỏi giao diện, dù dữ liệu gốc
// vẫn còn nguyên trong Sheets, có thể migrate lại bất cứ lúc nào).
//
// Cũng migrate SỐ DHL LỚN NHẤT đã dùng (quét CẢ dòng DaXoa — kể cả nhóm đã xoá vẫn không được cấp lại
// số cũ, đúng bảo đảm cũ) vào bộ đếm SQLite, để mã DHLXX tiếp theo được tạo mới không trùng bất kỳ mã
// nào đã từng dùng trong Sheets, kể cả mã của nhóm đã bị xoá.
//
// AN TOÀN CHẠY LẠI NHIỀU LẦN (idempotent) — MẶC ĐỊNH bỏ qua nhóm nào SQLite đã có (không ghi đè, tránh
// mất thay đổi đã làm qua giao diện sau lần migrate đầu — vd đổi tên nhóm, thêm/xoá thành viên). Dùng
// --force để nạp lại HẲN từ đầu (XOÁ SẠCH dữ liệu SQLite hiện có rồi nạp lại nguyên từ Sheets — chỉ
// dùng khi thật sự muốn bỏ mọi thay đổi đã làm qua giao diện sau lần migrate trước).
//
// CÁCH CHẠY (trên VPS, tại thư mục gốc dự án — nơi có node_modules, .env và service-account.json):
//   node scripts/migrate-don-hang-loat-tu-sheets.js            -> chạy thử, CHỈ liệt kê, KHÔNG ghi gì
//   node scripts/migrate-don-hang-loat-tu-sheets.js --apply     -> ghi thật vào SQLite
//   node scripts/migrate-don-hang-loat-tu-sheets.js --apply --force  -> xoá sạch SQLite rồi nạp lại

require('dotenv').config();
const { readTab } = require('../services/sheetsService');
const donHangLoatDbService = require('../services/donHangLoatDbService');

const TAB = 'DonHangLoat';

function dongDangHoatDong(r) {
  return String(r.DaXoa || '').toUpperCase() !== 'TRUE';
}

async function chay() {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');

  const { rows } = await readTab(TAB).catch(() => ({ rows: [] }));
  if (rows.length === 0) {
    console.log('Sheets chưa có dòng nào trong tab DonHangLoat — không có gì để migrate.');
    return;
  }

  // Số lớn nhất từng dùng — quét CẢ dòng đã DaXoa, để không bao giờ cấp trùng số cũ.
  let soLonNhatTungDung = 0;
  for (const r of rows) {
    const khop = /^DHL(\d+)$/.exec(r.MaDonHangLoat || '');
    if (khop) soLonNhatTungDung = Math.max(soLonNhatTungDung, Number(khop[1]));
  }

  const rowsHoatDong = rows.filter(dongDangHoatDong);
  const theoNhom = new Map();
  for (const r of rowsHoatDong) {
    if (!theoNhom.has(r.MaDonHangLoat)) {
      theoNhom.set(r.MaDonHangLoat, {
        MaDonHangLoat: r.MaDonHangLoat, TenNhom: r.TenNhom || '',
        NgayXacNhan: r.NgayXacNhan || '', NguoiXacNhan: r.NguoiXacNhan || '', sttKeys: [],
      });
    }
    theoNhom.get(r.MaDonHangLoat).sttKeys.push(r.STT_Key);
  }

  // Phòng hờ dữ liệu Sheets không nhất quán (1 STT_Key active ở NHIỀU nhóm khác nhau) — SQLite mới ép
  // 1 STT_Key chỉ thuộc đúng 1 nhóm (PRIMARY KEY), không migrate được nếu giữ nguyên vi phạm này. Báo
  // rõ và BỎ QUA đúng STT_Key đó khỏi nhóm xuất hiện SAU (giữ ở nhóm xuất hiện TRƯỚC) thay vì crash.
  const daGanChoNhom = new Map(); // STT_Key -> MaDonHangLoat đầu tiên gặp
  const boQuaTrungLap = [];
  for (const nhom of theoNhom.values()) {
    nhom.sttKeys = nhom.sttKeys.filter(sttKey => {
      if (!daGanChoNhom.has(sttKey)) { daGanChoNhom.set(sttKey, nhom.MaDonHangLoat); return true; }
      if (daGanChoNhom.get(sttKey) !== nhom.MaDonHangLoat) {
        boQuaTrungLap.push({ sttKey, giuONhom: daGanChoNhom.get(sttKey), boQuaKhoiNhom: nhom.MaDonHangLoat });
        return false;
      }
      return true; // trùng dòng y hệt trong cùng 1 nhóm (không nên xảy ra, vô hại nếu có)
    });
  }
  const nhomKhongRong = [...theoNhom.values()].filter(n => n.sttKeys.length > 0);

  console.log(`Tổng số dòng trong Sheets: ${rows.length}. Đang hoạt động (chưa DaXoa): ${rowsHoatDong.length}.`);
  console.log(`Số nhóm đang hoạt động: ${nhomKhongRong.length}. Số DHL lớn nhất từng dùng (kể cả đã xoá): ${soLonNhatTungDung}.`);
  if (boQuaTrungLap.length > 0) {
    console.log(`\nCẢNH BÁO — ${boQuaTrungLap.length} đơn xuất hiện ở NHIỀU nhóm cùng lúc trong Sheets (dữ liệu không nhất quán, SQLite mới không cho phép) — GIỮ Ở NHÓM XUẤT HIỆN TRƯỚC, bỏ qua ở nhóm sau:`);
    boQuaTrungLap.forEach(x => console.log(`  - ${x.sttKey}: giữ ở ${x.giuONhom}, bỏ qua ở ${x.boQuaKhoiNhom}`));
  }

  if (force && apply) {
    console.log('\n--force: nhóm nào SQLite đã có sẽ bị XOÁ SẠCH (cả metadata lẫn thành viên) rồi nạp lại nguyên từ Sheets.');
  }

  console.log('\nDanh sách nhóm sẽ migrate:');
  nhomKhongRong.forEach(n => console.log(`  - ${n.MaDonHangLoat} "${n.TenNhom}": ${n.sttKeys.length} đơn`));

  if (!apply) {
    console.log(`\nSẽ migrate ${nhomKhongRong.length} nhóm + đặt số đếm DHL = ${soLonNhatTungDung}. Đây là CHẠY THỬ — chưa ghi gì. Chạy lại với --apply để ghi thật.`);
    return;
  }

  console.log('\nĐang ghi vào SQLite...');
  let daGhi = 0, boQuaDaCo = 0;
  for (const nhom of nhomKhongRong) {
    const daCo = donHangLoatDbService.layNhom(nhom.MaDonHangLoat);
    if (daCo) {
      if (!force) { boQuaDaCo++; continue; }
      donHangLoatDbService.xoaNhom(nhom.MaDonHangLoat); // --force: xoá sạch trước khi nạp lại nguyên từ Sheets
    }
    donHangLoatDbService.napNhomTuMigrate(nhom.MaDonHangLoat, nhom.TenNhom, nhom.NgayXacNhan, nhom.NguoiXacNhan, nhom.sttKeys);
    daGhi++;
  }
  donHangLoatDbService.datSoLonNhatBoDem(soLonNhatTungDung);

  console.log(`Xong. Đã migrate ${daGhi} nhóm, bỏ qua ${boQuaDaCo} nhóm đã có sẵn trong SQLite (dùng --force nếu muốn nạp đè).`);
  console.log(`Số đếm DHL đã đặt thành ${soLonNhatTungDung} (mã tiếp theo sẽ là DHL${String(soLonNhatTungDung + 1).padStart(2, '0')}).`);
}

chay().catch(err => {
  console.error('Lỗi khi migrate:', err.message);
  process.exit(1);
});
