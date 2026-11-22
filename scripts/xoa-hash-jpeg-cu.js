// Script 1 lần: xóa dhash của file JPEG cũ trong tv_file.
//
// Lý do: trước khi có rule "chỉ hash PNG", các file JPEG (ảnh vải/texture/mockup từ
// thư mục Drive) đã được tính hash và lưu vào DB. Hash này gây kết quả sai khi
// "Tìm ảnh tương tự" (nhiều đơn có cùng ảnh vải → bị xếp là trùng thiết kế).
//
// Script này:
//   1. Tìm tất cả file XONG có object_key kết thúc bằng .jpg (= JPEG, do luuMotFile
//      đặt extension theo magic bytes qua DUOI_THEO_KIEU).
//   2. Xóa dhash + dhash_hinh_dang của những file đó → chúng vẫn còn trong MinIO
//      (hiển thị được) nhưng không tham gia tìm ảnh tương tự nữa.
//
// Chạy: node scripts/xoa-hash-jpeg-cu.js [--thuc-su]
//   Mặc định: dry-run, chỉ in ra danh sách, KHÔNG sửa DB.
//   --thuc-su : thực sự cập nhật DB.
//
// Yêu cầu: set THU_VIEN_DB_PATH trước khi chạy (hoặc để mặc định data/thu_vien.db).

'use strict';
const path = require('path');
const Database = require('better-sqlite3');

const DUONG_DAN_DB = process.env.THU_VIEN_DB_PATH || path.join(__dirname, '..', 'data', 'thu_vien.db');
const THUC_SU = process.argv.includes('--thuc-su');

const db = new Database(DUONG_DAN_DB, { readonly: !THUC_SU });
if (THUC_SU) db.pragma('journal_mode = WAL');

const ds = db.prepare(`
  SELECT id, stt_key, ten_file_goc, object_key, kich_thuoc, dhash
  FROM tv_file
  WHERE trang_thai = 'XONG'
    AND object_key LIKE '%.jpg'
    AND dhash IS NOT NULL AND dhash != ''
  ORDER BY id
`).all();

console.log(`\n=== Xóa hash JPEG cũ ${THUC_SU ? '[THỰC SỰ]' : '[DRY-RUN — thêm --thuc-su để thực sự sửa]'} ===`);
console.log(`DB: ${DUONG_DAN_DB}`);
console.log(`Tìm thấy: ${ds.length} file JPEG có hash\n`);

if (!ds.length) { console.log('Không có file nào cần xử lý.'); process.exit(0); }

// In ra danh sách (tối đa 50 dòng đầu để không làm ngập terminal)
const hienThi = ds.slice(0, 50);
for (const f of hienThi) {
  console.log(`  id=${f.id}  ${f.stt_key.padEnd(14)}  ${(f.ten_file_goc || '').slice(0, 40).padEnd(40)}  ${((f.kich_thuoc || 0) / 1024).toFixed(0)}KB`);
}
if (ds.length > 50) console.log(`  ... và ${ds.length - 50} file nữa`);

if (!THUC_SU) {
  console.log(`\nDry-run xong. Chạy lại với --thuc-su để xóa hash của ${ds.length} file trên.`);
  process.exit(0);
}

// Thực sự cập nhật
const stmt = db.prepare(`UPDATE tv_file SET dhash = '', dhash_hinh_dang = '' WHERE id = ?`);
const cap = db.transaction(() => { for (const f of ds) stmt.run(f.id); });
cap();

console.log(`\nĐã xóa hash của ${ds.length} file JPEG. Các file này vẫn còn trong MinIO (hiển thị được) nhưng không tham gia tìm ảnh tương tự nữa.`);
