// Sửa các mốc thời gian đã ghi sai dạng "YYYY-MM-DDT24:mm..." (14/10/2026). Lỗi gốc ở services/dateUtils.js#thoiGianVNISOString (đã sửa):
// ICU của production ghi giờ 00 thành "24" nhưng GIỮ ĐÚNG NGÀY — "2026-10-13T24:29:50" thực tế là 00:29:50 sáng 13/10. new Date() đọc
// chuỗi đó ra Invalid Date (lọc theo ngày, sắp xếp, tính hạn tự mua tracking... bỏ sót các mốc rơi vào 0h–1h sáng).
// Sửa = thay "T24:" thành "T00:" (cùng ngày) trong MỌI cột chữ của MỌI bảng ở các file SQLite của app, kể cả mốc nằm trong JSON (ChiTiet...).
// KHÔNG đụng Google Sheet (các tab nhật ký trên Sheet nếu có mốc "T24" phải sửa tay).
//
// CÁCH CHẠY (trên VPS, trong container — file DB ở data/ hoặc theo biến *_DB_PATH như app):
//   node scripts/sua-gio-24.js            -> CHỈ LIỆT KÊ: số ô sai theo từng file/bảng/cột + vài ví dụ, KHÔNG ghi gì
//   node scripts/sua-gio-24.js --apply    -> ghi. Nên chạy ngay sau mốc backup hằng giờ (data-backups/), vào giờ vắng.
// Chạy được khi app đang chạy: đọc không chặn app (WAL); ghi theo LÔ NHỎ (200 ô / giao dịch) nên mỗi lần chỉ giữ khoá ghi rất ngắn —
// lượt ghi log của app chen vào giữa các lô, không phải chờ cả file.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA = path.join(__dirname, '..', 'data');
const CAC_DB = [
  ['SQLITE_DB_PATH', 'trang_thai_don.db'], ['NHAT_KY_DB_PATH', 'nhat_ky.db'], ['CAI_DAT_DB_PATH', 'cai_dat.db'],
  ['DON_HANG_LOAT_DB_PATH', 'don_hang_loat.db'], ['TAI_KHOAN_DB_PATH', 'tai_khoan.db'], ['KICH_BAN_DB_PATH', 'kich_ban.db'],
  ['THU_VIEN_DB_PATH', 'thu_vien.db'],
].map(([bien, ten]) => process.env[bien] || path.join(DATA, ten));

const MAU = /(\d{4}-\d{2}-\d{2})T24:(?=\d{2})/g;
const sua = s => s.replace(MAU, '$1T00:');
const ghiThat = process.argv.includes('--apply');

let tongO = 0;
for (const file of CAC_DB) {
  if (!fs.existsSync(file)) { console.log(`(bỏ qua — không có) ${file}`); continue; }
  const db = new Database(file, { readonly: !ghiThat, fileMustExist: true });
  db.pragma('busy_timeout = 15000'); // app đang ghi -> chờ tới lượt thay vì báo lỗi ngay
  const canSua = []; // [bang, cot, rowid, giaTriMoi, giaTriCu]
  const bang = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).pluck().all();
  for (const b of bang) {
    const q = `"${b.replace(/"/g, '""')}"`;
    let coRowid = true;
    try { db.prepare(`SELECT rowid FROM ${q} LIMIT 1`).get(); } catch (e) { coRowid = false; }
    if (!coRowid) { console.log(`  (bỏ qua bảng WITHOUT ROWID) ${b}`); continue; }
    for (const { name: c } of db.prepare(`PRAGMA table_info(${q})`).all()) {
      const qc = `"${c.replace(/"/g, '""')}"`;
      const dong = db.prepare(`SELECT rowid AS r, ${qc} AS v FROM ${q} WHERE typeof(${qc}) = 'text' AND ${qc} LIKE '%T24:%'`).all()
        .filter(x => { MAU.lastIndex = 0; return MAU.test(x.v); });
      if (!dong.length) continue;
      console.log(`${path.basename(file)} · ${b}.${c}: ${dong.length} ô — vd: ${dong.slice(0, 2).map(x => JSON.stringify(String(x.v).slice(0, 80))).join(' | ')}`);
      dong.forEach(x => canSua.push([q, qc, x.r, sua(x.v), x.v]));
    }
  }
  tongO += canSua.length;
  if (ghiThat && canSua.length) {
    // Chỉ ghi khi ô VẪN là giá trị đã đọc — app có thể vừa cập nhật ô đó giữa lúc quét và lúc ghi (không ghi đè dữ liệu mới bằng bản cũ).
    const cau = new Map(); // "bảng|cột" -> câu UPDATE đã prepare
    let daSua = 0;
    const ghiLo = db.transaction(lo => lo.forEach(([q, qc, r, moi, cu]) => {
      if (!cau.has(q + '|' + qc)) cau.set(q + '|' + qc, db.prepare(`UPDATE ${q} SET ${qc} = ? WHERE rowid = ? AND ${qc} = ?`));
      daSua += cau.get(q + '|' + qc).run(moi, r, cu).changes;
    }));
    for (let k = 0; k < canSua.length; k += 200) ghiLo(canSua.slice(k, k + 200));
    console.log(`  -> ĐÃ SỬA ${daSua}/${canSua.length} ô trong ${path.basename(file)}${daSua < canSua.length ? ' (ô còn lại vừa được app đổi — chạy lại script để xét lại)' : ''}`);
    tongO -= canSua.length - daSua; // tổng cuối chỉ đếm ô đã sửa thật
  }
  db.close();
}
console.log(ghiThat ? `Xong — đã sửa ${tongO} ô.` : `Tổng ${tongO} ô cần sửa. CHƯA GHI GÌ — chạy lại với --apply để sửa.`);
