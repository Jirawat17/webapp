// Backup định kỳ cho TOÀN BỘ file SQLite app tự quản lý trong data/ (bổ sung 22/09/2026, theo yêu cầu
// người dùng) — trước đây KHÔNG có cơ chế backup nào: mất/hỏng volume data/ (xoá nhầm, lỗi đĩa, sự cố
// khi redeploy) là mất sạch tài khoản (tai_khoan.db), trạng thái đơn (trang_thai_don.db), lịch sử/log
// (nhat_ky.db), cấu hình tracking (cai_dat.db), dữ liệu Đơn hàng loạt (don_hang_loat.db), kịch bản
// (kich_ban.db) — không có gì phục hồi được từ Google Sheets (các bảng này không tồn tại bên đó).
//
// Ghi ra THƯ MỤC RIÊNG data-backups/ (KHÔNG phải data/backups/) — cố ý tách khỏi volume data/ hiện có
// (xem docker-compose.yml, mount thêm ./data-backups riêng): nếu chỉ ghi backup NẰM TRONG data/, mất
// nguyên volume đó (đúng kịch bản đáng lo nhất) sẽ mất luôn cả DB gốc LẪN mọi bản backup cùng lúc,
// không giải quyết được gì.
//
// Dùng API "online backup" chính thức của SQLite (Database#backup của better-sqlite3, an toàn khi DB
// nguồn đang có người đọc/ghi cùng lúc, không cần dừng app) — KHÔNG copy file .db thô bằng fs.copyFile
// (có thể chụp phải trạng thái nửa-ghi-dở nếu DB đang ở chế độ WAL, ra file backup hỏng/không nhất
// quán).
//
// ponytail: chỉ backup LOCAL (cùng máy chủ VPS) — chống được lỗi thao tác/xoá nhầm/hỏng volume data/,
// KHÔNG chống được hỏng cả ổ đĩa vật lý của VPS. Muốn chống luôn trường hợp đó thì cần đẩy thêm bản
// backup ra ngoài máy chủ (rclone lên cloud storage...) — cần biết trước muốn dùng dịch vụ nào.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const CAC_FILE_DB = ['trang_thai_don.db', 'nhat_ky.db', 'cai_dat.db', 'don_hang_loat.db', 'tai_khoan.db', 'kich_ban.db'];

const THU_MUC_DATA = path.join(__dirname, '..', 'data');
const THU_MUC_BACKUP = process.env.BACKUP_DIR || path.join(__dirname, '..', 'data-backups');
const SO_NGAY_GIU_LAI = 7; // backup mỗi giờ x 7 ngày = tối đa 168 bản/file — đủ dùng, không phình đĩa vô hạn

async function backupMotFile(tenFile) {
  const nguon = path.join(THU_MUC_DATA, tenFile);
  if (!fs.existsSync(nguon)) return; // tính năng tương ứng chưa từng dùng lần nào (chưa tạo file) — bỏ qua, không lỗi

  const tenKhongDuoi = tenFile.replace(/\.db$/, '');
  const thuMucCon = path.join(THU_MUC_BACKUP, tenKhongDuoi);
  fs.mkdirSync(thuMucCon, { recursive: true });

  const dau = new Date().toISOString().replace(/[:.]/g, '-');
  const dich = path.join(thuMucCon, `${tenKhongDuoi}-${dau}.db`);

  const db = new Database(nguon, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dich);
  } finally {
    db.close();
  }

  const bayGio = Date.now();
  for (const ten of fs.readdirSync(thuMucCon)) {
    const p = path.join(thuMucCon, ten);
    const tuoiNgay = (bayGio - fs.statSync(p).mtimeMs) / (24 * 60 * 60 * 1000);
    if (tuoiNgay > SO_NGAY_GIU_LAI) fs.unlinkSync(p);
  }
}

async function chayBackupDb() {
  for (const tenFile of CAC_FILE_DB) {
    try {
      await backupMotFile(tenFile);
    } catch (err) {
      console.error(`[Backup] Lỗi backup ${tenFile}:`, err.message);
    }
  }
}

function batDauLichBackup() {
  const cron = require('node-cron');
  cron.schedule('0 * * * *', chayBackupDb);
  console.log('[Backup] Đã bật lịch backup SQLite mỗi giờ vào ' + THU_MUC_BACKUP);
}

module.exports = { batDauLichBackup, chayBackupDb, THU_MUC_BACKUP };
