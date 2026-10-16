// Phiên đăng nhập lưu SQLite (16/10/2026, theo yêu cầu người dùng) — thay MemoryStore mặc định của express-session: trước đây mỗi lần
// máy chủ khởi động lại (deploy, container tự restart — log 15–16/10 có 3 lần) MỌI người bị đăng xuất. Bảng `phien` nằm trong CSDL tài
// khoản (TAI_KHOAN_DB_PATH, cùng kết nối với taiKhoanService). Đi kèm: middleware/auth.js#kiemTraLaiTaiKhoan đọc lại tài khoản mỗi lượt
// (phiên giờ sống qua restart nên không còn "vô tình" đá người bị xoá/khoá ra).
const session = require('express-session');
const { db } = require('./taiKhoanService');

db.exec(`CREATE TABLE IF NOT EXISTS phien (
  sid TEXT PRIMARY KEY,
  du_lieu TEXT NOT NULL,
  het_han INTEGER NOT NULL
)`);

const MOT_GIO_MS = 3600 * 1000;
const hetHanCua = s => {
  const ms = s && s.cookie && s.cookie.expires ? new Date(s.cookie.expires).getTime() : NaN;
  return Number.isFinite(ms) ? ms : Date.now() + 24 * MOT_GIO_MS;
};
const cauLay = db.prepare('SELECT du_lieu, het_han FROM phien WHERE sid = ?');
const cauGhi = db.prepare(`INSERT INTO phien (sid, du_lieu, het_han) VALUES (?, ?, ?)
  ON CONFLICT(sid) DO UPDATE SET du_lieu = excluded.du_lieu, het_han = excluded.het_han`);
const cauXoa = db.prepare('DELETE FROM phien WHERE sid = ?');
// touch() chạy ở MỌI lượt chưa đổi phiên -> chỉ ghi khi hạn mới xa hơn hạn đang lưu > 1 giờ (khỏi 1 lượt ghi đĩa mỗi request).
const cauGiaHan = db.prepare('UPDATE phien SET het_han = ? WHERE sid = ? AND het_han < ?');
const cauDon = db.prepare('DELETE FROM phien WHERE het_han < ?');

class PhienSqliteStore extends session.Store {
  get(sid, cb) {
    try {
      const r = cauLay.get(sid);
      if (!r) return cb(null, null);
      if (r.het_han < Date.now()) { cauXoa.run(sid); return cb(null, null); }
      cb(null, JSON.parse(r.du_lieu));
    } catch (err) { cb(err); }
  }

  set(sid, s, cb = () => {}) {
    try { cauGhi.run(sid, JSON.stringify(s), hetHanCua(s)); cb(null); } catch (err) { cb(err); }
  }

  destroy(sid, cb = () => {}) {
    try { cauXoa.run(sid); cb(null); } catch (err) { cb(err); }
  }

  touch(sid, s, cb = () => {}) {
    try { const h = hetHanCua(s); cauGiaHan.run(h, sid, h - MOT_GIO_MS); cb(null); } catch (err) { cb(err); }
  }
}

// Xoá phiên hết hạn — server.js gọi lúc khởi động + mỗi 6 giờ.
function donPhienHetHan() {
  try {
    const n = cauDon.run(Date.now()).changes;
    if (n) console.log(`[Phien] Đã xoá ${n} phiên đăng nhập hết hạn.`);
  } catch (err) {
    console.error('[Phien] Lỗi xoá phiên hết hạn:', err.message);
  }
}

module.exports = { PhienSqliteStore, donPhienHetHan };
