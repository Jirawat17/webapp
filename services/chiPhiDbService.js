const Database = require('better-sqlite3');
const path = require('path');

const DUONG_DAN_DB = process.env.CHI_PHI_DB_PATH || path.join(__dirname, '..', 'data', 'chi_phi.db');

const db = new Database(DUONG_DAN_DB);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS chi_phi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ten TEXT NOT NULL,
    so_tien REAL NOT NULL,
    loai TEXT NOT NULL DEFAULT 'Khác',
    thang TEXT NOT NULL,
    ghi_chu TEXT NOT NULL DEFAULT '',
    ngay_tao TEXT NOT NULL
  )
`);

const layTheoThang = thang => db.prepare('SELECT * FROM chi_phi WHERE thang = ? ORDER BY id DESC').all(thang);

const them = ({ ten, so_tien, loai, thang, ghi_chu, ngay_tao }) =>
  db.prepare('INSERT INTO chi_phi (ten, so_tien, loai, thang, ghi_chu, ngay_tao) VALUES (?,?,?,?,?,?)').run(ten, so_tien, loai, thang, ghi_chu, ngay_tao);

const capNhat = ({ id, ten, so_tien, loai, thang, ghi_chu }) =>
  db.prepare('UPDATE chi_phi SET ten=?, so_tien=?, loai=?, thang=?, ghi_chu=? WHERE id=?').run(ten, so_tien, loai, thang, ghi_chu, id);

const xoa = id => db.prepare('DELETE FROM chi_phi WHERE id=?').run(id);

const layMot = id => db.prepare('SELECT * FROM chi_phi WHERE id=?').get(id);

module.exports = { layTheoThang, them, capNhat, xoa, layMot };
