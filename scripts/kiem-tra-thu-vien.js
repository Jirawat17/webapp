// Kiểm thử thư viện "Tìm ảnh" (docs/superpowers/specs/2026-10-03-thu-vien-tim-anh-design.md) — chạy: node scripts/kiem-tra-thu-vien.js
// TỰ tạo CSDL tạm trong thư mục temp của hệ điều hành TRƯỚC mọi require (không bao giờ mở data/*.db); Drive/HTTP giả lập
// trong bộ nhớ; MinIO giả là 1 server HTTP cục bộ (127.0.0.1) — không gọi dịch vụ thật nào.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const TAM = fs.mkdtempSync(path.join(os.tmpdir(), 'kiem-tra-thu-vien-'));
for (const [k, f] of Object.entries({ THU_VIEN_DB_PATH: 'tv', SQLITE_DB_PATH: 'tt', NHAT_KY_DB_PATH: 'nk', CAI_DAT_DB_PATH: 'cd',
  TAI_KHOAN_DB_PATH: 'tk', DON_HANG_LOAT_DB_PATH: 'dhl', KICH_BAN_DB_PATH: 'kb' })) process.env[k] = path.join(TAM, f + '.db');
const CONG_MINIO = 39000 + Math.floor(Math.random() * 900);
Object.assign(process.env, { MINIO_ENDPOINT: `http://127.0.0.1:${CONG_MINIO}`, MINIO_ACCESS_KEY: 'test', MINIO_SECRET_KEY: 'test', MINIO_BUCKET: 'tb' });
// Bộ canh treo: 300ms cho nhanh (chỉ có tác dụng khi test GỌI kiemTraKet() — không có setInterval trong test).
process.env.THU_VIEN_NGUONG_KET_MS = '300';
// Lỗi stream lọt ra ngoài (nếu có) -> test FAIL rõ ràng thay vì im lặng.
process.on('uncaughtException', err => { console.error('THẤT BẠI — uncaughtException:', err); process.exit(1); });
const W = path.join(__dirname, '..');
const sharp = require('sharp');
const ExcelJS = require('exceljs');

// ---- giả lập kho + nguồn ảnh (PHẢI gắn trước khi require xuLyService vì nó destructure lúc load) ----
const kho = new Map();
let minioLoiKey = null; // key sẽ lỗi 1 lần
let minioHong = false;  // MinIO "sập" hẳn — mọi lần ghi đều lỗi
const storage = require(W + '/services/storageService');
const guiObjectQuaHttpThat = storage.guiObjectQuaHttp; // giữ bản thật để thử với MinIO giả ở cuối
storage.uploadImageBuffer = async (buf, key, ct) => {
  if (minioHong) throw new Error('connect ECONNREFUSED 10.0.0.5:9000');
  if (minioLoiKey && key.includes(minioLoiKey)) { minioLoiKey = null; throw new Error('MinIO giả lập lỗi'); }
  kho.set(key, { buf, ct }); return key;
};
storage.getObjectBuffer = async key => { if (!kho.has(key)) throw new Error('NoSuchKey'); return kho.get(key).buf; };

const anh = {}; // url -> buffer | null
const thuMuc = {}; // folderId -> [{id, ten, buf, mimeType?, kichThuoc?}]
const fileDrive = {}, metaDrive = {}; // id -> buffer / { ten, mimeType, kichThuoc }
const daTaiDrive = []; // id các file Drive đã thực sự tải (để chứng minh PSD không bị tải)
const anhNguon = require(W + '/services/anhNguonService');
const taiUrlThoThat = anhNguon.taiUrlTho;
anhNguon.taiAnh = async url => (url in anh ? anh[url] : null);
const drive = require(W + '/services/driveService');
drive.layChiTietAnhThuMucDrive = async url => {
  const id = drive.layFolderIdTuLinkDrive(url);
  if (!thuMuc[id]) throw new Error('Drive giả lập: không liệt kê được thư mục');
  return thuMuc[id].map(f => ({ id: f.id, ten: f.ten, link: '', mimeType: f.mimeType || '', kichThuoc: f.kichThuoc || null }));
};
drive.layThongTinFileDrive = async id => { if (!metaDrive[id]) throw new Error('File not found: ' + id); return metaDrive[id]; };
drive.taiFileDriveTheoId = async id => {
  daTaiDrive.push(id);
  if (fileDrive[id]) return fileDrive[id];
  for (const ds of Object.values(thuMuc)) { const f = ds.find(x => x.id === id); if (f) return f.buf; }
  return null;
};

const db = require(W + '/services/thuVien/thuVienDbService');
const xuLy = require(W + '/services/thuVien/xuLyService');
const { nhapExcel, guiFileKetQua } = require(W + '/services/thuVien/nhapExcelService');
const { Writable } = require('stream');
// File kết quả giờ ghi LUỒNG ra stream — gom lại thành Buffer để đọc kiểm tra.
const layFileKetQua = async loId => {
  const ch = [];
  await guiFileKetQua(loId, new Writable({ write(c, e, cb) { ch.push(c); cb(); } }));
  return Buffer.concat(ch);
};

const taoPng = async (hat, w = 120) => sharp({ create: { width: w, height: w, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}"><text x="10" y="70" font-size="40">${hat}</text><rect x="${hat % 40}" y="${Math.floor(hat / 40) % 40}" width="20" height="20"/></svg>`) }])
  .png().toBuffer();

(async () => {
  // ---- tên key MinIO: đơn ánh, mã thường giữ nguyên ----
  assert.strictEqual(xuLy.lamSachKey('10LH72'), '10LH72');
  assert.strictEqual(xuLy.lamSachKey('9U121.2'), '9U121.2');
  const cacKey = ['9U121.2', '9U121_2', '9A 1', '9A~201', '9A/1', 'Đơn~1'].map(xuLy.lamSachKey);
  assert.strictEqual(new Set(cacKey).size, cacKey.length, 'mã khác nhau phải ra key khác nhau: ' + cacKey.join(' | '));
  assert(cacKey.every(k => /^[A-Za-z0-9_.~-]+$/.test(k)), 'key chỉ gồm ký tự an toàn');

  const A = await taoPng(1), B = await taoPng(2), C = await taoPng(3), D = await taoPng(4);
  const GIF = Buffer.from('GIF89a........');
  anh['https://ok.test/a.png'] = A;
  anh['https://ok.test/a-ban-sao.png'] = A;             // cùng nội dung với a.png -> TRÙNG cho cùng đơn
  metaDrive.FILEX = { ten: 'texas-final.png', mimeType: 'image/png', kichThuoc: B.length }; fileDrive.FILEX = B;
  anh['https://ok.test/c.png'] = C;
  anh['https://ok.test/la-gif.png'] = GIF;               // sai định dạng -> bỏ qua vĩnh viễn, không thử lại
  anh['https://gemini.google.com/share/abc'] = D;        // ưu tiên thấp
  thuMuc['FOLD1'] = [
    { id: 'f1', ten: 'mat-truoc.png', buf: C, mimeType: 'image/png' },
    { id: 'f2', ten: 'mat-sau.png', buf: D, mimeType: 'image/png' },
    { id: 'f3', ten: 'x.gif', buf: GIF, mimeType: 'image/gif' },
    { id: 'f4', ten: 'thiet-ke.psd', buf: null, mimeType: 'image/vnd.adobe.photoshop', kichThuoc: 400 * 1048576 },
    { id: 'f5', ten: 'scan-lon.png', buf: null, mimeType: 'image/png', kichThuoc: 45 * 1048576 },
  ];
  // 'https://dead.test/x.png' không có -> lỗi tạm thời

  // ---- Excel: tiêu đề ở dòng 2, cột lạ, hyperlink, nhiều link 1 ô ----
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Trang trống').getCell('A1').value = 'không có gì';
  const ws = wb.addWorksheet('Don_Hang_ALL');
  ws.addRow(['Xuất từ Sheet']);
  ws.addRow(['Ghi chú', 'stt_key ', 'DUONG_DAN_URL', 'MOCKUP']);
  ws.addRow(['', '9AAA1', 'https://ok.test/a.png', 'https://ok.test/mockup.png']);
  ws.addRow(['', '9AAA1', { text: 'Ảnh 2', hyperlink: 'https://ok.test/a-ban-sao.png' }]);
  ws.addRow(['', '9BBB2', 'https://drive.google.com/file/d/FILEX/view\nhttps://ok.test/c.png']);
  ws.addRow(['', '9CCC3', 'https://drive.google.com/drive/folders/FOLD1?usp=sharing']);
  ws.addRow(['', '9DDD4', 'https://dead.test/x.png']);
  ws.addRow(['', '9EEE5', 'https://ok.test/la-gif.png']);
  ws.addRow(['', '9FFF6', 'https://gemini.google.com/share/abc']);
  ws.addRow(['', '', 'https://ok.test/khong-ma.png']);
  ws.addRow(['', '9GGG7', '']);
  ws.addRow(['', '9HHH8', 'xem trong zalo']);
  ws.addRow([]);
  ws.addRow(['', '9AAA1', 'https://ok.test/a.png']); // trùng dòng 3
  const buf = Buffer.from(await wb.xlsx.writeBuffer());

  const kq1 = await nhapExcel(buf, 'test.xlsx', 'Tester');
  console.log('Nhập lần 1:', kq1);
  assert.strictEqual(kq1.tenSheet, 'Don_Hang_ALL');
  assert.strictEqual(kq1.tongDong, 11);
  assert.strictEqual(kq1.soLink, 8);          // a, a-ban-sao, FILEX, c, FOLD1, dead, gif, gemini (dòng 14 trùng dòng 3)
  assert.strictEqual(kq1.soViecMoi, 8);
  assert.strictEqual(kq1.soViecDaCo, 0, 'dòng lặp trong cùng file không được báo là "đã có từ trước"');
  assert.strictEqual(kq1.soDongBoQua, 3);     // thiếu mã, thiếu link, không phải link
  const kq2 = await nhapExcel(buf, 'test.xlsx', 'Tester');
  assert.strictEqual(kq2.soViecMoi, 0, 'nhập lại không được thêm việc mới');
  assert.strictEqual(kq2.soViecDaCo, 8);

  // ---- chạy hàng chờ (MinIO lỗi 1 lần ở 9BBB2_1 -> việc FILEX lỗi tạm thời) ----
  minioLoiKey = '9BBB2/9BBB2_1';
  await xuLy.chayMotLuot();
  const tt = db.demViecTheoTrangThai();
  console.log('Sau lượt 1:', tt);
  assert.strictEqual(tt.CHO, 0);
  assert.strictEqual(tt.LOI, 2, 'dead + FILEX (MinIO lỗi) phải ở LOI chờ thử lại');
  assert(!daTaiDrive.includes('f4') && !daTaiDrive.includes('f5') && !daTaiDrive.includes('f3'), 'PSD/GIF/file >30MB không được tải: ' + daTaiDrive);

  const rows = require('better-sqlite3')(process.env.THU_VIEN_DB_PATH).prepare('SELECT * FROM tv_file ORDER BY id').all();
  console.table(rows.map(r => ({ stt: r.stt_key, n: r.so_thu_tu, key: r.object_key, ten: r.ten_file_goc, tt: r.trang_thai, dh: r.dhash.length, hd: r.dhash_hinh_dang.length, th: !!r.thumb_key })));
  const keys = rows.map(r => r.object_key);
  assert(keys.includes('thu-vien/9AAA1/9AAA1_1.png'));
  assert(!keys.includes('thu-vien/9AAA1/9AAA1_2.png'), 'a-ban-sao trùng nội dung không được lưu thành _2');
  assert(keys.includes('thu-vien/9CCC3/9CCC3_1.png') && keys.includes('thu-vien/9CCC3/9CCC3_2.png'), 'thư mục Drive -> _1, _2');
  assert(keys.includes('thu-vien/9BBB2/9BBB2_1.png'), 'c.png của 9BBB2 lấy số 1 vì FILEX lỗi MinIO đã nhả số');
  assert(keys.includes('thu-vien/9FFF6/9FFF6_1.png'), 'gemini vẫn được xử lý');
  assert(rows.every(r => r.trang_thai === 'XONG' && r.dhash.length === 64 && r.dhash_hinh_dang.length === 64 && r.thumb_key));
  assert(kho.has(rows[0].thumb_key) && kho.get(rows[0].thumb_key).ct === 'image/webp');
  // thumbnail dùng chung theo sha: C có ở 9BBB2 và 9CCC3
  const thumbC = rows.filter(r => r.sha256 === rows.find(x => x.object_key === 'thu-vien/9BBB2/9BBB2_1.png').sha256).map(r => r.thumb_key);
  assert.strictEqual(new Set(thumbC).size, 1, 'cùng nội dung -> 1 thumbnail');
  const viecLoi = db.dsViecLoi();
  assert(viecLoi.every(x => x.so_lan_thu === 1 && x.thu_lai_luc > Date.now() + 4 * 60000), 'lịch thử lại lần 1 = 5 phút');

  // ---- thử lại ngay: FILEX lần này MinIO ổn -> XONG, lấy số 2, giữ tên gốc từ Drive; dead vẫn lỗi ----
  db.thuLaiViec(viecLoi.map(x => x.id));
  await xuLy.chayMotLuot();
  const db2 = require('better-sqlite3')(process.env.THU_VIEN_DB_PATH);
  const filex = db2.prepare(`SELECT * FROM tv_file WHERE object_key = 'thu-vien/9BBB2/9BBB2_2.png'`).get();
  assert(filex, 'FILEX lưu thành _2 sau khi thử lại');
  assert.strictEqual(filex.ten_file_goc, 'texas-final.png', 'link file Drive phải giữ tên gốc');
  // dead: thử lại đủ 5 lần (dùng hết lịch 5' -> 8 giờ) rồi mới LOI_CUOI ở lần lỗi thứ 6
  // (lần lỗi 1 đã hẹn 5 phút — kiểm ở trên; 4 lần kế tiếp phải hẹn 20, 60, 180, 480 phút; lần thứ 6 -> LOI_CUOI)
  const lichDaHen = [];
  for (let i = 0; i < 5; i++) {
    db2.prepare(`UPDATE tv_hang_cho SET thu_lai_luc = 0 WHERE url = 'https://dead.test/x.png'`).run();
    const t = Date.now();
    await xuLy.chayMotLuot();
    const v = db2.prepare(`SELECT * FROM tv_hang_cho WHERE url = 'https://dead.test/x.png'`).get();
    if (v.trang_thai === 'LOI') lichDaHen.push(Math.round((v.thu_lai_luc - t) / 60000));
  }
  const dead = db2.prepare(`SELECT * FROM tv_hang_cho WHERE url = 'https://dead.test/x.png'`).get();
  assert.strictEqual(dead.trang_thai, 'LOI_CUOI'); assert.strictEqual(dead.so_lan_thu, 6);
  console.log('Lịch thử lại đã hẹn (phút):', lichDaHen);
  assert.deepStrictEqual(lichDaHen, [20, 60, 180, 480]);
  const gif = db2.prepare(`SELECT * FROM tv_hang_cho WHERE url = 'https://ok.test/la-gif.png'`).get();
  assert.strictEqual(gif.trang_thai, 'XONG'); assert(/PNG\/JPEG/.test(gif.ghi_chu), 'gif: ghi chú bỏ qua, không phải lỗi');
  const fold = db2.prepare(`SELECT * FROM tv_hang_cho WHERE url LIKE '%FOLD1%'`).get();
  assert.strictEqual(fold.trang_thai, 'XONG', 'PSD trong thư mục không được làm cả việc lỗi');
  assert.strictEqual(fold.so_file, 2);
  assert(/x\.gif/.test(fold.ghi_chu) && /thiet-ke\.psd/.test(fold.ghi_chu) && /scan-lon\.png: quá 30MB/.test(fold.ghi_chu), fold.ghi_chu);

  // ---- link file Drive là PSD / quá lớn / không có quyền ----
  metaDrive.PSD1 = { ten: 'goc.psd', mimeType: 'image/vnd.adobe.photoshop', kichThuoc: 300 * 1048576 };
  db.themNhieuViec([{ sttKey: '9PSD', url: 'https://drive.google.com/file/d/PSD1/view', nguon: 'EXCEL', uuTien: 0 },
    { sttKey: '9KHONGQUYEN', url: 'https://drive.google.com/file/d/KHONGCO/view', nguon: 'EXCEL', uuTien: 0 }]);
  await xuLy.chayMotLuot();
  const psd = db2.prepare(`SELECT * FROM tv_hang_cho WHERE stt_key = '9PSD'`).get();
  assert.strictEqual(psd.trang_thai, 'XONG'); assert(/goc\.psd: không phải PNG\/JPEG/.test(psd.ghi_chu)); assert(!daTaiDrive.includes('PSD1'));
  const kq = db2.prepare(`SELECT * FROM tv_hang_cho WHERE stt_key = '9KHONGQUYEN'`).get();
  assert.strictEqual(kq.trang_thai, 'LOI'); assert(/File not found/.test(kq.loi_cuoi), 'lý do của Google phải hiện ra: ' + kq.loi_cuoi);

  // ---- tiến độ lô: dòng trùng không đếm 2 lần ----
  const lo1 = db.dsLoExcel().find(l => l.id === kq1.loId);
  const tongViec = lo1.tienDo.CHO + lo1.tienDo.DANG_CHAY + lo1.tienDo.XONG + lo1.tienDo.LOI + lo1.tienDo.LOI_CUOI;
  assert.strictEqual(tongViec, 8, 'lô 1 có 8 link khác nhau');
  assert.strictEqual(lo1.tienDo.BO_QUA, 3);
  const soFileThat = db2.prepare(`SELECT SUM(so_file) n FROM tv_hang_cho WHERE id IN (SELECT viec_id FROM tv_lo_dong WHERE lo_id = ?)`).get(kq1.loId).n;
  assert.strictEqual(lo1.soFile, soFileThat, 'ảnh đã lưu không cộng trùng dòng lặp');
  // lô đã xong hẳn: nhớ tiến độ (không đếm lại mỗi 15 giây); bấm "Thử lại" 1 việc LOI_CUOI của lô -> đếm lại, thấy việc quay về CHO
  const viecLo1 = db2.prepare(`SELECT viec_id FROM tv_lo_dong WHERE lo_id = ? AND viec_id IS NOT NULL`).pluck().all(kq1.loId);
  const ttGoc = db2.prepare(`SELECT id, trang_thai FROM tv_hang_cho WHERE id IN (${viecLo1.join(',')})`).all();
  db2.prepare(`UPDATE tv_hang_cho SET trang_thai = 'LOI_CUOI' WHERE id IN (${viecLo1.join(',')}) AND trang_thai IN ('CHO', 'LOI', 'DANG_CHAY')`).run();
  const daXong = db.dsLoExcel().find(l => l.id === kq1.loId);
  assert(!daXong.tienDo.CHO && !daXong.tienDo.LOI && daXong.tienDo.LOI_CUOI >= 1, JSON.stringify(daXong.tienDo));
  db2.prepare(`UPDATE tv_hang_cho SET trang_thai = 'XONG' WHERE id = ?`).run(viecLo1[0]); // đổi ngầm (không qua thuLaiViec) ...
  assert.deepStrictEqual(db.dsLoExcel().find(l => l.id === kq1.loId).tienDo, daXong.tienDo, '... lô đã xong dùng tiến độ đã nhớ');
  const idLoiCuoi = db2.prepare(`SELECT id FROM tv_hang_cho WHERE id IN (${viecLo1.join(',')}) AND trang_thai = 'LOI_CUOI'`).pluck().get();
  assert.strictEqual(db.thuLaiViec([idLoiCuoi]), 1);
  assert(db.dsLoExcel().find(l => l.id === kq1.loId).tienDo.CHO >= 1, 'Thử lại -> lô đếm lại');
  const capNhatTt = db2.prepare(`UPDATE tv_hang_cho SET trang_thai = ? WHERE id = ?`);
  for (const r of ttGoc) capNhatTt.run(r.trang_thai, r.id); // trả lại trạng thái cũ cho các phần sau
  db.thuLaiViec([]); // xoá bộ nhớ tiến độ lô

  // ---- chạy lại toàn bộ việc đã xong (giả lập cron/nhập lại): không thêm file ----
  const truoc = db.thongKeFile().soFile;
  db2.prepare(`UPDATE tv_hang_cho SET trang_thai = 'CHO' WHERE trang_thai = 'XONG'`).run();
  await xuLy.chayMotLuot();
  assert.strictEqual(db.thongKeFile().soFile, truoc, 'chạy lại không tạo bản ghi trùng');

  // ---- file kết quả Excel ----
  const kqWb = new ExcelJS.Workbook(); await kqWb.xlsx.load(await layFileKetQua(kq1.loId));
  const dongKq = []; kqWb.worksheets[0].eachRow((r, i) => { if (i > 1) dongKq.push(r.values.slice(1)); });
  console.table(dongKq.map(r => ({ dong: r[0], stt: r[1], tt: r[3], so: r[4], ly: String(r[5] || '').slice(0, 60) })));
  assert(dongKq.some(r => r[1] === '9DDD4' && r[3] === 'Lỗi'));
  assert(dongKq.some(r => !r[1] && r[3] === 'Bỏ qua' && /Thiếu STT_Key/.test(r[5]))); // ghi luồng: ô rỗng = ô trống thật
  assert.strictEqual(dongKq.filter(r => r[1] === '9HHH8').length, 1, 'ô chữ thường -> đúng 1 dòng bỏ qua');
  assert(dongKq.some(r => r[1] === '9AAA1' && /trùng file/.test(r[5] || '')), 'a-ban-sao: thành công nhưng trùng');

  // ---- điểm dừng đo: thêm thư mục 220 ảnh khác nhau -> dừng ở đúng 200 file ----
  thuMuc['FOLDBIG'] = [];
  for (let i = 0; i < 220; i++) thuMuc['FOLDBIG'].push({ id: 'b' + i, ten: `b${i}.png`, buf: await taoPng(1000 + i, 64), mimeType: 'image/png' });
  db.themNhieuViec([{ sttKey: '9BIG', url: 'https://drive.google.com/drive/folders/FOLDBIG', nguon: 'EXCEL', uuTien: 0 }]);
  db.themNhieuViec([{ sttKey: '9SAU', url: 'https://ok.test/c.png', nguon: 'EXCEL', uuTien: 0 }]);
  const t0 = Date.now();
  await xuLy.chayMotLuot();
  const tk = db.thongKeFile();
  console.log('Sau thư mục lớn:', tk, 'tạm dừng =', xuLy.dangTamDung(), 'ms =', Date.now() - t0);
  assert.strictEqual(xuLy.dangTamDung(), true, 'phải tự tạm dừng');
  assert.strictEqual(tk.soFile, 200, 'dừng đúng ở file thứ 200, kể cả giữa 1 thư mục lớn');
  assert.strictEqual(db2.prepare(`SELECT trang_thai FROM tv_hang_cho WHERE stt_key = '9BIG'`).get().trang_thai, 'CHO', 'thư mục dở dang quay về CHO');
  assert.strictEqual(db.layCaiDat('da_qua_diem_do'), '1');
  assert.strictEqual(db.layCaiDat('dung_tai_diem_do'), '1', 'cờ hiện thông báo điểm dừng đo');
  assert.strictEqual(db2.prepare(`SELECT trang_thai FROM tv_hang_cho WHERE stt_key = '9SAU'`).get().trang_thai, 'CHO', 'việc sau điểm dừng chưa chạy');
  // ước tính ảnh/link chỉ tính việc XONG — thư mục đang dở (~180 file) không được thổi phồng con số
  const xong = db.thongKeViecXong();
  console.log('Ảnh/link (chỉ việc XONG):', (xong.soFile / xong.soLink).toFixed(2), '— bản cũ sẽ ra', (tk.soFile / xong.soLink).toFixed(2));
  assert(xong.soFile / xong.soLink < 2, 'ảnh/link phải phản ánh các link đã xong');
  // chạy tiếp -> xong hết, điểm dừng không lặp lại, thông báo điểm dừng tắt
  xuLy.datTamDung(false);
  assert.strictEqual(db.layCaiDat('dung_tai_diem_do'), '0');
  await xuLy.chayMotLuot();
  assert.strictEqual(xuLy.dangTamDung(), false);
  assert.strictEqual(db2.prepare(`SELECT trang_thai FROM tv_hang_cho WHERE stt_key = '9SAU'`).get().trang_thai, 'XONG');
  assert.strictEqual(db2.prepare(`SELECT COUNT(*) n FROM tv_file WHERE stt_key = '9BIG'`).get().n, 220);
  xuLy.datTamDung(true); // tạm dừng TAY về sau -> không được hiện lại thông báo điểm dừng đo
  assert.strictEqual(db.layCaiDat('dung_tai_diem_do'), '0');
  xuLy.datTamDung(false);

  // ---- khởi động lại giữa chừng: DANG_CHAY -> CHO, DANG_LUU mồ côi bị xoá ----
  db2.prepare(`UPDATE tv_hang_cho SET trang_thai = 'DANG_CHAY' WHERE stt_key = '9SAU'`).run();
  db2.prepare(`INSERT INTO tv_file (loai, stt_key, so_thu_tu, object_key, nguon, sha256, ngay_luu, trang_thai) VALUES ('PNG','9ZZZ',1,'k','EXCEL','x','t','DANG_LUU')`).run();
  db2.prepare(`INSERT INTO tv_file (loai, stt_key, so_thu_tu, object_key, nguon, sha256, ngay_luu, trang_thai) VALUES ('PNG','9DTINH',1,'k2','EXCEL','y','t','DANG_TINH')`).run();
  assert.strictEqual(db.dsFileLoiHash().some(f => f.stt_key === '9DTINH'), false, 'file đang tính hash dở KHÔNG được tính là lỗi');
  db.donDepKhiKhoiDong();
  assert.strictEqual(db2.prepare(`SELECT trang_thai FROM tv_hang_cho WHERE stt_key = '9SAU'`).get().trang_thai, 'CHO');
  assert(!db2.prepare(`SELECT 1 FROM tv_file WHERE stt_key = '9ZZZ'`).get());
  assert.strictEqual(db2.prepare(`SELECT trang_thai FROM tv_file WHERE stt_key = '9DTINH'`).get().trang_thai, 'LOI_HASH', 'tắt giữa lúc tính hash -> LOI_HASH để Tính lại');
  db2.prepare(`DELETE FROM tv_file WHERE stt_key = '9DTINH'`).run();
  await xuLy.chayMotLuot();

  // ---- lỗi bất thường ngoài xuLyViec: vẫn dừng ở LOI_CUOI, không thử lại vô hạn ----
  db.themNhieuViec([{ sttKey: '9BUG', url: 'https://ok.test/bug.png', nguon: 'EXCEL', uuTien: 0 }]);
  const capNhatGoc = db.capNhatViec;
  db.capNhatViec = (id, thayDoi) => {
    const v = db2.prepare(`SELECT stt_key FROM tv_hang_cho WHERE id = ?`).get(id);
    if (v.stt_key === '9BUG' && thayDoi.trang_thai === 'DANG_CHAY') throw new Error('lỗi giả lập ngoài dự kiến');
    return capNhatGoc(id, thayDoi);
  };
  for (let i = 0; i < 8; i++) { db2.prepare(`UPDATE tv_hang_cho SET thu_lai_luc = 0 WHERE stt_key = '9BUG'`).run(); await xuLy.chayMotLuot(); }
  db.capNhatViec = capNhatGoc;
  const bug = db2.prepare(`SELECT * FROM tv_hang_cho WHERE stt_key = '9BUG'`).get();
  assert.strictEqual(bug.trang_thai, 'LOI_CUOI'); assert.strictEqual(bug.so_lan_thu, 6);

  // ---- bộ canh treo: 1 link treo vĩnh viễn không được làm đứng cả hàng chờ ----
  let thaTreo;
  anh['https://ok.test/treo.png'] = new Promise(r => { thaTreo = r; }); // taiAnh giả trả promise không bao giờ xong (cho tới khi thả)
  anh['https://ok.test/sau-treo.png'] = await taoPng(8001);
  db.themNhieuViec([{ sttKey: '9TREO', url: 'https://ok.test/treo.png', nguon: 'EXCEL', uuTien: 0 }]);
  const luotTreo = xuLy.chayMotLuot(); // KHÔNG await — lượt này kẹt ở taiAnh
  await new Promise(r => setTimeout(r, 450));
  assert.strictEqual(xuLy.kiemTraKet(), true, 'bộ canh phải phát hiện treo');
  const treo = db2.prepare(`SELECT * FROM tv_hang_cho WHERE stt_key = '9TREO'`).get();
  assert.strictEqual(treo.trang_thai, 'LOI'); assert(/Treo quá/.test(treo.loi_cuoi), treo.loi_cuoi);
  db.themNhieuViec([{ sttKey: '9SAUTREO', url: 'https://ok.test/sau-treo.png', nguon: 'EXCEL', uuTien: 0 }]);
  await xuLy.chayMotLuot(); // lượt mới phải chạy được ngay, không bị lượt treo chặn
  assert.strictEqual(db2.prepare(`SELECT trang_thai FROM tv_hang_cho WHERE stt_key = '9SAUTREO'`).get().trang_thai, 'XONG');
  thaTreo(await taoPng(8002)); // lượt treo "sống lại": file vẫn lưu (file thật) nhưng KHÔNG được ghi đè trạng thái việc
  await luotTreo;
  assert.strictEqual(db2.prepare(`SELECT trang_thai FROM tv_hang_cho WHERE stt_key = '9TREO'`).get().trang_thai, 'LOI', 'lượt bị bỏ rơi không được ghi đè');

  // ---- MinIO sập: 5 link liên tiếp lỗi hệ thống -> tự tạm dừng, không đốt hết hàng chờ ----
  for (let i = 0; i < 7; i++) { anh[`https://ok.test/sap${i}.png`] = await taoPng(8100 + i); }
  db.themNhieuViec(Array.from({ length: 7 }, (_, i) => ({ sttKey: '9SAP' + i, url: `https://ok.test/sap${i}.png`, nguon: 'EXCEL', uuTien: 0 })));
  minioHong = true;
  await xuLy.chayMotLuot();
  assert.strictEqual(xuLy.dangTamDung(), true, 'phải tự tạm dừng');
  assert(/lỗi hệ thống/.test(db.layCaiDat('ly_do_tam_dung')), db.layCaiDat('ly_do_tam_dung'));
  const conCho = db2.prepare(`SELECT COUNT(*) n FROM tv_hang_cho WHERE stt_key LIKE '9SAP%' AND trang_thai = 'CHO'`).get().n;
  assert.strictEqual(conCho, 2, 'chỉ 5 link bị đánh lỗi, 2 link còn lại vẫn chờ');
  minioHong = false;
  xuLy.datTamDung(false);
  assert.strictEqual(db.layCaiDat('ly_do_tam_dung'), '', 'Chạy tiếp xoá lý do tự dừng');
  await xuLy.chayMotLuot();
  assert.strictEqual(db2.prepare(`SELECT COUNT(*) n FROM tv_hang_cho WHERE stt_key LIKE '9SAP%' AND trang_thai = 'XONG'`).get().n, 2);

  // ---- tiến trình con xử lý ảnh quá giờ: bị giết + tạo lại, file LOI_HASH, 5 file liên tiếp -> tự tạm dừng ----
  // (chạy ở tiến trình node riêng với THU_VIEN_XU_LY_ANH_MS=1 để mọi lần xử lý ảnh đều "quá giờ")
  const phu = require('child_process').spawnSync(process.execPath, ['-e', `
    const path = require('path'), fs = require('fs'), os = require('os');
    const T = fs.mkdtempSync(path.join(os.tmpdir(), 'kttv-con-'));
    for (const [k, f] of Object.entries({ THU_VIEN_DB_PATH: 'tv', SQLITE_DB_PATH: 'tt', NHAT_KY_DB_PATH: 'nk', CAI_DAT_DB_PATH: 'cd', TAI_KHOAN_DB_PATH: 'tk', DON_HANG_LOAT_DB_PATH: 'dhl', KICH_BAN_DB_PATH: 'kb' })) process.env[k] = path.join(T, f + '.db');
    process.env.THU_VIEN_XU_LY_ANH_MS = '1';
    const W = ${JSON.stringify(W)};
    const storage = require(W + '/services/storageService'); storage.uploadImageBuffer = async (b, k) => k;
    const xuLy = require(W + '/services/thuVien/xuLyService'); const db = require(W + '/services/thuVien/thuVienDbService');
    require('sharp')({ create: { width: 50, height: 50, channels: 3, background: '#f00' } }).png().toBuffer().then(async png => {
      const kq = [];
      // demLoiLienTiep: true = gọi từ hàng chờ (xuLyViec)
      for (let i = 0; i < 6; i++) { const b = Buffer.concat([png, Buffer.from([i])]); kq.push((await xuLy.luuMotFile({ buffer: b, sttKey: 'K' + i, nguon: 'EXCEL', demLoiLienTiep: true })).ketQua); }
      const raw = require('better-sqlite3')(process.env.THU_VIEN_DB_PATH);
      const tamDung = xuLy.dangTamDung(), lyDo = db.layCaiDat('ly_do_tam_dung');
      // tải lên tay (mặc định) lỗi hash liên tiếp: KHÔNG được làm tự tạm dừng hàng chờ
      xuLy.datTamDung(false);
      for (let i = 0; i < 6; i++) await xuLy.luuMotFile({ buffer: Buffer.concat([png, Buffer.from([50 + i])]), sttKey: 'T' + i, nguon: 'UPLOAD' });
      console.log(JSON.stringify({ kq, loiHash: raw.prepare("SELECT COUNT(*) n FROM tv_file WHERE trang_thai = 'LOI_HASH' AND nguon = 'EXCEL'").get().n, tamDung, lyDo, tamDungSauTaiTay: xuLy.dangTamDung() }));
      process.exit(0);
    });`], { encoding: 'utf8', timeout: 60000 });
  const dongKqPhu = (phu.stdout || '').trim().split('\n').pop();
  console.log('Tiến trình con quá giờ:', dongKqPhu, (phu.stderr || '').split('\n').filter(l => /dừng hẳn/.test(l)).length, 'lần giết');
  const kqPhu = JSON.parse(dongKqPhu);
  assert.deepStrictEqual(kqPhu.kq, Array(6).fill('DA_LUU'), 'file vẫn được lưu dù xử lý ảnh lỗi — không treo');
  assert.strictEqual(kqPhu.loiHash, 6);
  assert.strictEqual(kqPhu.tamDung, true); assert(/hash\/thumbnail/.test(kqPhu.lyDo), kqPhu.lyDo);
  assert.strictEqual(kqPhu.tamDungSauTaiTay, false, 'file tải tay lỗi hash không được làm tự tạm dừng hàng chờ');
  assert((phu.stderr || '').includes('dừng hẳn tiến trình con'), 'phải giết tiến trình con khi quá giờ');

  // ---- tính lại file LOI_HASH ----
  const f1 = db2.prepare(`SELECT id FROM tv_file WHERE object_key = 'thu-vien/9AAA1/9AAA1_1.png'`).get().id;
  db2.prepare(`UPDATE tv_file SET trang_thai = 'LOI_HASH', dhash = '' WHERE id = ?`).run(f1);
  assert.strictEqual(await xuLy.tinhLaiFile(f1), 'XONG');

  // ---- công thức HYPERLINK, dấu phẩy dính cuối, %xx sai định dạng, mã đơn có dấu chấm ----
  anh['https://ok.test/hl.png'] = await taoPng(7001);
  anh['https://ok.test/p1.png'] = await taoPng(7002);
  anh['https://ok.test/p2.png'] = await taoPng(7003);
  anh['https://ok.test/sai%E0%A4.png'] = await taoPng(7004);
  anh['https://ok.test/cham.png'] = await taoPng(7005);
  anh['https://ok.test/gach.png'] = await taoPng(7006);
  const wb3 = new ExcelJS.Workbook(); const ws3 = wb3.addWorksheet('S');
  ws3.addRow(['STT_Key', 'DUONG_DAN_URL']);
  ws3.addRow(['9HL1', { formula: 'HYPERLINK("https://ok.test/hl.png","Xem ảnh")', result: 'Xem ảnh' }]);
  ws3.addRow(['9PH2', 'https://ok.test/p1.png, https://ok.test/p2.png;']);
  ws3.addRow(['9PC3', 'https://ok.test/sai%E0%A4.png']);
  ws3.addRow(['9U121.2', 'https://ok.test/cham.png']);
  ws3.addRow(['9U121_2', 'https://ok.test/gach.png']);
  const kq3 = await nhapExcel(Buffer.from(await wb3.xlsx.writeBuffer()), 't3.xlsx', 'Tester');
  assert.strictEqual(kq3.soLink, 6); assert.strictEqual(kq3.soDongBoQua, 0);
  await xuLy.chayMotLuot();
  for (const [stt, n] of [['9HL1', 1], ['9PH2', 2], ['9PC3', 1], ['9U121.2', 1], ['9U121_2', 1]]) {
    assert.strictEqual(db2.prepare(`SELECT COUNT(*) n FROM tv_file WHERE stt_key = ?`).get(stt).n, n, stt);
  }
  assert.strictEqual(db2.prepare(`SELECT ten_file_goc t FROM tv_file WHERE stt_key = '9PC3'`).get().t, 'sai%E0%A4.png');
  const keyCham = db2.prepare(`SELECT object_key k FROM tv_file WHERE stt_key = '9U121.2'`).get().k;
  const keyGach = db2.prepare(`SELECT object_key k FROM tv_file WHERE stt_key = '9U121_2'`).get().k;
  assert.notStrictEqual(keyCham, keyGach, 'không được dùng chung key MinIO');
  assert(kho.get(keyCham).buf.equals(anh['https://ok.test/cham.png']) && kho.get(keyGach).buf.equals(anh['https://ok.test/gach.png']), 'không file nào bị ghi đè');

  // ================= GIAI ĐOẠN 2 =================
  // ---- khớp tên file -> STT_Key (spec mục 7, đã sửa: so theo cụm token, mã dài hơn thắng) ----
  const { taoTapMa, themMa, khopSttKey } = require(W + '/services/thuVien/khopTenFile');
  const tapMa = taoTapMa(['10LH72', '9U121', '9U121.2', '9AB', '9ab', '10LH7', 'Đơn1', '11XY3']);
  for (const [dd, kqMong, maMong] of [['10LH72.png', 'KHOP', '10LH72'], ['10LH72_2.png', 'KHOP', '10LH72'], ['10LH72 (1).png', 'KHOP', '10LH72'],
    ['10LH72-mat-truoc.png', 'KHOP', '10LH72'], ['A/10LH72/design.png', 'KHOP', '10LH72'], ['Design10LH72.png', 'KHONG_KHOP'], ['9U121.2.png', 'KHOP', '9U121.2'],
    ['9U121_mat.png', 'KHOP', '9U121'], ['10LH72 va 11XY3.png', 'NHIEU'], ['9ab.emb', 'NHIEU'], ['10lh72.PNG', 'KHOP', '10LH72'], ['đơn1.png', 'KHOP', 'Đơn1'],
    ['Goc/11XY3/con/abc.png', 'KHOP', '11XY3'], ['Goc/abc.png', 'KHONG_KHOP'], ['10LH7.png', 'KHOP', '10LH7']]) {
    const r = khopSttKey(dd, tapMa);
    assert.strictEqual(r.ketQua, kqMong, `${dd}: ${JSON.stringify(r)}`);
    if (maMong) assert.strictEqual(r.sttKey, maMong, dd);
  }
  // tên file từ macOS là NFD (chữ + dấu tách rời); mã trong Sheet cũng có thể NFD — chuẩn hoá NFC cả 2 phía
  assert.strictEqual(khopSttKey('Đơn1'.normalize('NFD') + '_mat.png', tapMa).sttKey, 'Đơn1', 'tên file NFD vẫn khớp');
  assert.strictEqual(khopSttKey('Thư mục/ĐƠN2.png', taoTapMa(['Đơn2'.normalize('NFD')])).ketQua, 'KHOP', 'mã NFD vẫn khớp tên NFC');
  themMa(tapMa, 'MOI77');
  assert.strictEqual(khopSttKey('moi77.png', tapMa).sttKey, 'MOI77', 'mã thêm dần khớp được ngay');

  // ---- tìm kiếm: hash thật (tiến trình con) trên ảnh giả lập ----
  const { timTuongTu } = require(W + '/services/thuVien/timKiemService');
  const thietKe = (chu, mau, nen) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">${nen ? `<rect width="100%" height="100%" fill="${nen}"/>` : ''}
    <circle cx="450" cy="250" r="90" fill="none" stroke="${mau}" stroke-width="22"/><text x="450" y="520" font-family="Arial Black" font-size="140" text-anchor="middle" fill="${mau}">${chu}</text></svg>`)).png().toBuffer();
  const anhGoc = await thietKe('ALABAMA', '#1b1b1b');
  const cungTkNenTrang = await thietKe('ALABAMA', '#c8102e', '#ffffff');
  const khac = await thietKe('INDIANA', '#1b1b1b');
  for (const [stt, b] of [['TKGOC', anhGoc], ['TKTRANG', cungTkNenTrang], ['TKKHAC', khac]]) assert.strictEqual((await xuLy.luuMotFile({ buffer: b, sttKey: stt, nguon: 'UPLOAD' })).ketQua, 'DA_LUU');
  const hGoc = await xuLy.tinhHashAnhTam(anhGoc);
  const tim = timTuongTu({ mau: [{ ...hGoc, nhan: 'q' }], gioiHan: 100000 }); // so cả thư viện thử (có ~500 ảnh nhỏ giả lập)
  const vt = stt => tim.ketQua.findIndex(r => r.stt_key === stt);
  const r0 = tim.ketQua[vt('TKGOC')], rT = tim.ketQua[vt('TKTRANG')], rK = tim.ketQua[vt('TKKHAC')];
  console.log('Tìm theo ảnh gốc:', { anhGoc: r0, nenTrang: rT, khac: rK, ms: tim.ms });
  assert.strictEqual(tim.ketQua[0].stt_key, 'TKGOC'); assert.strictEqual(r0.trungFile, true, 'giống hệt từng byte -> Trùng file đứng đầu');
  assert(rT.phanTramHinhDang > rK.phanTramHinhDang, 'cùng thiết kế khác màu/nền phải giống hình dạng hơn thiết kế khác');
  assert(vt('TKTRANG') < vt('TKKHAC'), 'cùng thiết kế xếp trên thiết kế khác');
  // ---- hash suy biến / chấm lạc (rà soát 03/10/2026) ----
  const { laHashSuyBien, khoangCachHamming: kcHash } = require(W + '/services/perceptualHashService');
  const ptHash = (a, b) => (1 - kcHash(a, b) / 256) * 100;
  assert(laHashSuyBien('0'.repeat(64)) && laHashSuyBien('f'.repeat(64)) && !laHashSuyBien(hGoc.dhash) && !laHashSuyBien(hGoc.dhashHinhDang));
  // chỉ đen thuần / trắng thuần trên nền trong suốt: % Ảnh phải là hash thật (bản cũ: chỉ đen -> toàn 0, mọi thiết kế "giống 100%")
  const [denTexas, denOhio, trangTexas] = [await xuLy.tinhHashAnhTam(await thietKe('TEXAS', '#000000')), await xuLy.tinhHashAnhTam(await thietKe('OHIO', '#000000')),
    await xuLy.tinhHashAnhTam(await thietKe('TEXAS', '#ffffff'))];
  console.log('Chỉ đen thuần TEXAS vs OHIO: % Ảnh', ptHash(denTexas.dhash, denOhio.dhash).toFixed(1), '| chỉ trắng thuần suy biến?', laHashSuyBien(trangTexas.dhash));
  assert(!laHashSuyBien(denTexas.dhash) && !laHashSuyBien(trangTexas.dhash), 'chỉ đen/trắng thuần trên nền trong suốt vẫn có hash % Ảnh thật');
  assert(ptHash(denTexas.dhash, denOhio.dhash) < 95, 'TEXAS và OHIO chỉ đen không được "giống 100%"');
  // tấm nền đặc bo góc (vài điểm trong suốt): bản cũ mọi thiết kế ra cùng 1 hash hình dạng
  const tamNen = noi => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" rx="40" fill="#ffffff"/>${noi}</svg>`)).png().toBuffer();
  const [nenTexas, nenTron] = [await xuLy.tinhHashAnhTam(await tamNen('<text x="300" y="330" font-family="Arial Black" font-size="110" text-anchor="middle" fill="#000">TEXAS</text>')),
    await xuLy.tinhHashAnhTam(await tamNen('<circle cx="300" cy="300" r="180" fill="#c00"/>'))];
  console.log('Tấm nền bo góc TEXAS vs hình tròn: % Hình dạng', ptHash(nenTexas.dhashHinhDang, nenTron.dhashHinhDang).toFixed(1));
  assert(ptHash(nenTexas.dhashHinhDang, nenTron.dhashHinhDang) < 80, 'thiết kế khác trên tấm nền bo góc không được "cùng hình dạng"');
  // 1 chấm lạc 4px ở góc không được làm hỏng hash hình dạng (bản cũ: còn 66%, thấp hơn thiết kế khác)
  const coCham = await sharp(await thietKe('ALABAMA', '#1b1b1b')).composite([{ input: { create: { width: 4, height: 4, channels: 4, background: '#1b1b1b' } }, left: 2, top: 2 }]).png().toBuffer();
  const hCham = await xuLy.tinhHashAnhTam(coCham);
  console.log('Chấm lạc 4px ở góc: % Hình dạng so bản gốc', ptHash(hCham.dhashHinhDang, hGoc.dhashHinhDang).toFixed(1));
  assert(ptHash(hCham.dhashHinhDang, hGoc.dhashHinhDang) >= 95, 'chấm lạc ở góc không được làm hỏng hash hình dạng');
  // tìm kiếm bỏ qua hash suy biến (so với nó ảnh nào cũng "giống 100%")
  assert.strictEqual(timTuongTu({ mau: [{ sha256: '', dhash: '0'.repeat(64), dhashHinhDang: '0'.repeat(64) }], gioiHan: 100000 }).ketQua.length, 0);
  for (let i = 1; i < tim.ketQua.length; i++) assert(tim.ketQua[i - 1].diem >= tim.ketQua[i].diem, 'kết quả xếp điểm giảm dần');
  assert.deepStrictEqual(timTuongTu({ mau: [{ ...hGoc, nhan: 'q' }], gioiHan: 25 }).ketQua.map(r => r.id), tim.ketQua.slice(0, 25).map(r => r.id),
    'giới hạn N = đúng N kết quả đầu của danh sách đầy đủ');
  // tra theo đơn: bỏ chính đơn đó; lọc quyền
  const timDon = timTuongTu({ mau: [{ ...hGoc, nhan: 'TKGOC_1.png' }], boQuaStt: new Set(['TKGOC']), duocXem: st => st !== 'TKKHAC' });
  assert(!timDon.ketQua.some(r => r.stt_key === 'TKGOC' || r.stt_key === 'TKKHAC'), 'bỏ chính đơn đang tra + đơn ngoài phạm vi');
  // file mới lưu sau đó phải tìm thấy ngay (chỉ mục cập nhật dần)
  assert.strictEqual((await xuLy.luuMotFile({ buffer: Buffer.concat([anhGoc]), sttKey: 'TKSAU', nguon: 'UPLOAD' })).ketQua, 'DA_LUU');
  assert(timTuongTu({ mau: [{ ...hGoc, nhan: 'q' }] }).ketQua.some(r => r.stt_key === 'TKSAU' && r.trungFile), 'file vừa lưu phải có trong kết quả');

  // ---- lưu trùng cùng lúc (upload tay + hàng chờ): 1 bản lưu, 1 bản trùng ----
  const dong2 = await taoPng(9001);
  const haiLan = await Promise.all([xuLy.luuMotFile({ buffer: dong2, sttKey: 'CUNGLUC', nguon: 'UPLOAD' }), xuLy.luuMotFile({ buffer: dong2, sttKey: 'CUNGLUC', nguon: 'EXCEL' })]);
  assert.deepStrictEqual(haiLan.map(k => k.ketQua).sort(), ['DA_LUU', 'TRUNG']);

  // ---- EMB: mỗi phiên bản 1 object riêng, bản mới là bản chính, trùng nội dung -> TRUNG ----
  const emb = n => Buffer.from(`EMB-gia-lap-${n}`);
  for (let n = 1; n <= 3; n++) assert.strictEqual((await xuLy.luuEmb({ buffer: emb(n), sttKey: '9U121.2', tenFileGoc: `thiet-ke-${n}.emb`, nguoiTaiLen: 'Ve' })).ketQua, 'DA_LUU');
  assert.strictEqual((await xuLy.luuEmb({ buffer: emb(2), sttKey: '9U121.2' })).ketQua, 'TRUNG');
  assert.strictEqual((await xuLy.luuEmb({ buffer: Buffer.alloc(0), sttKey: '9U121.2' })).ketQua, 'BO_QUA');
  const dsEmb = db2.prepare(`SELECT so_thu_tu, la_ban_chinh, object_key, trang_thai FROM tv_file WHERE stt_key = '9U121.2' AND loai = 'EMB' ORDER BY so_thu_tu`).all();
  console.table(dsEmb);
  assert.deepStrictEqual(dsEmb.map(e => e.object_key), ['thu-vien/9U121.2/9U121.2_v1.emb', 'thu-vien/9U121.2/9U121.2_v2.emb', 'thu-vien/9U121.2/9U121.2_v3.emb']);
  assert.deepStrictEqual(dsEmb.map(e => e.la_ban_chinh), [0, 0, 1]);
  assert(dsEmb.every(e => e.trang_thai === 'XONG') && dsEmb.every(e => kho.has(e.object_key)), 'cả 3 bản đều còn trên MinIO');
  assert.strictEqual(db.embChinhCuaCacDon(['9U121.2']).get('9U121.2').so_thu_tu, 3);
  // 2 lần tải EMB chồng nhau, bản số nhỏ ghi MinIO chậm hơn: bản chính vẫn là phiên bản số lớn nhất (không bị bản xong sau cướp)
  const upGoc = storage.uploadImageBuffer;
  storage.uploadImageBuffer = async (buf, key, ct) => { if (key.endsWith('EMBDUA_v1.emb')) await new Promise(r => setTimeout(r, 300)); return upGoc(buf, key, ct); };
  const pV1 = xuLy.luuEmb({ buffer: emb('dua-1'), sttKey: 'EMBDUA' });
  await new Promise(r => setTimeout(r, 30));
  await Promise.all([pV1, xuLy.luuEmb({ buffer: emb('dua-2'), sttKey: 'EMBDUA' })]);
  storage.uploadImageBuffer = upGoc;
  assert.deepStrictEqual(db2.prepare(`SELECT la_ban_chinh FROM tv_file WHERE stt_key = 'EMBDUA' ORDER BY so_thu_tu`).pluck().all(), [0, 1],
    'bản chính = v2 dù v1 lưu xong sau');

  // ---- quyết định: chỉ ghi nhận ----
  const fCu = db2.prepare(`SELECT id FROM tv_file WHERE stt_key = 'TKTRANG'`).pluck().get();
  db.themQuyetDinh({ sttKeyMoi: 'TKGOC', fileId: fCu, quyetDinh: 'TAI_SU_DUNG', ghiChu: 'đổi màu chỉ', nguoi: 'Ve' });
  const qd = db.dsQuyetDinhCuaDon('TKGOC');
  assert.strictEqual(qd.length, 1); assert.strictEqual(qd[0].stt_key_cu, 'TKTRANG'); assert.strictEqual(qd[0].quyet_dinh, 'TAI_SU_DUNG');

  // ================= GIAI ĐOẠN 3: tự động lấy link PNG từ Sheet =================
  const orderService = require(W + '/services/orderService');
  let rowsSheet = [];
  orderService.getAll = async () => ({ headers: ['STT_Key', 'DUONG_DAN_URL'], rows: rowsSheet });
  const dongBo = require(W + '/services/thuVien/dongBoSheetService');
  xuLy.datTamDung(true); // giữ hàng chờ đứng yên để đếm việc cho rõ
  rowsSheet = [
    { STT_Key: 'SH1', DUONG_DAN_URL: 'https://ok.test/sh1.png' },
    { STT_Key: 'SH2', DUONG_DAN_URL: 'https://drive.google.com/file/d/SH2A/view\nhttps://ok.test/sh2b.png' },
    { STT_Key: 'SH3', DUONG_DAN_URL: '' },
    { STT_Key: 'SH4', DUONG_DAN_URL: 'xem trong zalo' },
    { STT_Key: '', DUONG_DAN_URL: 'https://ok.test/khong-ma.png' },
  ];
  assert.strictEqual(dongBo.dangBat(), false, 'mặc định TẮT');
  assert.deepStrictEqual(await dongBo.quetSheet(), { boQua: 'TAT' }, 'đang tắt thì cron không chạy');
  const q1 = await dongBo.quetSheet({ bamTay: true });
  console.log('Quét Sheet lần 1:', q1);
  assert.strictEqual(q1.soDon, 5); assert.strictEqual(q1.soDonDoi, 4); assert.strictEqual(q1.soViecMoi, 3);
  const q2 = await dongBo.quetSheet({ bamTay: true });
  assert.strictEqual(q2.soDonDoi, 0); assert.strictEqual(q2.soViecMoi, 0, 'không đổi gì thì không thêm việc');
  rowsSheet[0] = { STT_Key: 'SH1', DUONG_DAN_URL: 'https://ok.test/sh1-moi.png' };
  rowsSheet[3] = { STT_Key: 'SH4', DUONG_DAN_URL: 'https://ok.test/sh4.png' };
  const q3 = await dongBo.quetSheet({ bamTay: true });
  assert.strictEqual(q3.soDonDoi, 2); assert.strictEqual(q3.soViecMoi, 2);
  const viecSH1 = db2.prepare(`SELECT url, nguon FROM tv_hang_cho WHERE stt_key = 'SH1' ORDER BY id`).all();
  assert.deepStrictEqual(viecSH1.map(v => v.url), ['https://ok.test/sh1.png', 'https://ok.test/sh1-moi.png'], 'link cũ vẫn giữ, link mới thêm vào');
  assert(viecSH1.every(v => v.nguon === 'SHEET'));
  // 1 mã nằm ở 2 dòng: gộp link cả 2 dòng; quét lại KHÔNG coi là đổi (bản cũ: giá trị "đã thấy" nhảy qua lại mỗi lượt)
  rowsSheet.push({ STT_Key: 'SH5', DUONG_DAN_URL: 'https://ok.test/sh5a.png' }, { STT_Key: 'SH5', DUONG_DAN_URL: 'https://ok.test/sh5b.png' });
  const q4 = await dongBo.quetSheet({ bamTay: true });
  assert.strictEqual(q4.soDonDoi, 1); assert.strictEqual(q4.soViecMoi, 2, 'link của cả 2 dòng');
  assert.strictEqual((await dongBo.quetSheet({ bamTay: true })).soDonDoi, 0, 'mã trùng dòng không bị coi là đổi mỗi lượt');
  rowsSheet.splice(-2);
  dongBo.datBat(true);
  assert.strictEqual((await dongBo.quetSheet()).soDonDoi, 0, 'bật rồi thì cron chạy (không có gì đổi)');
  // Sheets treo: không được giữ cờ đang chạy mãi (hạn 2 phút thu nhỏ còn 200ms trong test)
  orderService.getAll = () => new Promise(() => {});
  const stGoc2 = global.setTimeout;
  global.setTimeout = (fn, ms, ...a) => stGoc2(fn, ms === 120000 ? 200 : ms, ...a);
  const pTreo = dongBo.quetSheet({ bamTay: true });
  assert.strictEqual(dongBo.dangQuet(), true, 'đang quét');
  const qTreo = await pTreo;
  global.setTimeout = stGoc2;
  assert(/quá/.test(qTreo.loi || ''), JSON.stringify(qTreo));
  assert.strictEqual(dongBo.dangQuet(), false, 'hết hạn chờ thì nhả cờ đang quét');
  orderService.getAll = async () => ({ headers: [], rows: rowsSheet });
  assert.strictEqual((await dongBo.quetSheet({ bamTay: true })).soDonDoi, 0, 'sau lần treo vẫn quét lại được');
  assert(dongBo.layLanQuet() && dongBo.layLanQuet().soDon === 5);
  dongBo.datBat(false);
  db2.prepare(`DELETE FROM tv_hang_cho WHERE nguon = 'SHEET'`).run(); // dọn để không lẫn các phần sau
  xuLy.datTamDung(false);

  // ================= GIAI ĐOẠN 4: đo ngưỡng trên cặp đã đánh giá =================
  const nguongService = require(W + '/services/thuVien/nguongService');
  const TU = ['ALPHA', 'BRAVO', 'DELTA', 'GAMMA', 'KILO', 'LIMA', 'OSCAR', 'ROMEO', 'TANGO', 'ZULU'];
  const idTk = {};
  for (const tu of TU) {
    for (const [bt, mau, nen] of [['a', '#1b1b1b', null], ['b', '#0a7d33', '#f4e9c9']]) {
      const k = await xuLy.luuMotFile({ buffer: await thietKe(tu, mau, nen), sttKey: `NG_${tu}_${bt}`, nguon: 'UPLOAD' });
      idTk[`${tu}_${bt}`] = k.id;
    }
  }
  assert.strictEqual(nguongService.layNguong(), null, 'chưa chọn ngưỡng');
  assert.strictEqual(nguongService.goiYNguong(null).goiY.length, 0, 'chưa đủ cặp thì chưa gợi ý');
  for (const tu of TU) db.luuCapDanhGia({ fileA: idTk[`${tu}_a`], fileB: idTk[`${tu}_b`], ketLuan: 'CUNG', nguoi: 'Ve' });
  for (let i = 0; i < TU.length; i++) {
    for (const j of [1, 2, 3]) db.luuCapDanhGia({ fileA: idTk[`${TU[i]}_a`], fileB: idTk[`${TU[(i + j) % TU.length]}_${j % 2 ? 'b' : 'a'}`], ketLuan: 'KHAC', nguoi: 'Ve' });
  }
  db.luuCapDanhGia({ fileA: idTk.ALPHA_b, fileB: idTk.ALPHA_a, ketLuan: 'CUNG', nguoi: 'Ve2' }); // cùng cặp đảo thứ tự -> ghi đè, không thêm dòng
  assert.strictEqual(nguongService.goiYNguong(null).goiY.length, 0, 'không bấm "Tính gợi ý" thì không chạy lưới');
  const gy = nguongService.goiYNguong(null, { tinhLuoi: true });
  console.log('Gợi ý ngưỡng:', { soCap: gy.soCap, soCung: gy.soCung, soKhac: gy.soKhac, goiY: gy.goiY.map(g => ({ ma: g.ma, anh: g.anh, hd: g.hinhDang, xt: g.xemTay, giongSai: g.giongSai, boSot: g.boSot, xemTay: g.canXemTay })) });
  console.log('Phân bố % Hình dạng — cùng:', gy.phanBo[1].cung.join(', '), '| khác (5 cao nhất):', gy.phanBo[1].khac.slice(-5).join(', '));
  assert.strictEqual(gy.soCap, 40); assert.strictEqual(gy.soCung, 10); assert.strictEqual(gy.soKhac, 30);
  assert.strictEqual(gy.goiY.length >= 2, true);
  const anToan = gy.goiY.find(g => g.ma === 'AN_TOAN');
  assert.strictEqual(anToan.giongSai, 0, 'hướng an toàn: không cặp khác nào lọt nhóm giống');
  // kiểm tra hợp lệ + thử bộ tự nhập
  assert(nguongService.kiemTraNguong({ anh: 95, hinhDang: 90, xemTay: 92 }), 'xem tay > ngưỡng khác -> lỗi');
  assert(nguongService.kiemTraNguong({ anh: 101, hinhDang: 90, xemTay: 80 }), 'ngoài 50..100 -> lỗi');
  assert.throws(() => nguongService.goiYNguong({ anh: 40, hinhDang: 90, xemTay: 80 }), /50 đến 100/);
  const thu = nguongService.goiYNguong({ anh: anToan.anh, hinhDang: anToan.hinhDang, xemTay: anToan.xemTay }).thu;
  assert.strictEqual(thu.giongSai, anToan.giongSai);
  // danhGiaBoNguong (mảng số, không gọi phanNhom) phải đếm y như xếp nhóm từng cặp bằng phanNhom
  const { khoangCachHamming } = require(W + '/services/perceptualHashService');
  const pt = (a, b) => { const d = khoangCachHamming(a, b); return Number.isFinite(d) ? Math.round((1 - d / 256) * 1000) / 10 : null; };
  for (const n of [{ anh: 90, hinhDang: 85, xemTay: 70 }, { anh: 99, hinhDang: 97, xemTay: 96 }, { anh: 80, hinhDang: 95, xemTay: 50 }]) {
    const dem = { giongDung: 0, giongSai: 0, xemTayCung: 0, xemTayKhac: 0, boSot: 0, thapDung: 0 };
    for (const c of db.dsCapDanhGia()) {
      const r = { trungFile: false, phanTramAnh: pt(c.dhash_a, c.dhash_b), phanTramHinhDang: pt(c.hd_a, c.hd_b) };
      if (r.phanTramAnh === null && r.phanTramHinhDang === null) continue;
      const nhom = nguongService.phanNhom(r, n), cung = c.ket_luan === 'CUNG';
      dem[nhom === 'ANH_GIONG' || nhom === 'CUNG_HINH_DANG' ? (cung ? 'giongDung' : 'giongSai') : nhom === 'CAN_XEM_TAY' ? (cung ? 'xemTayCung' : 'xemTayKhac') : (cung ? 'boSot' : 'thapDung')]++;
    }
    const m = nguongService.goiYNguong(n).thu;
    for (const k of Object.keys(dem)) assert.strictEqual(m[k], dem[k], `${JSON.stringify(n)} ${k}`);
  }
  // lưu -> kết quả tìm kiếm được gắn nhóm
  nguongService.luuNguong({ anh: anToan.anh, hinhDang: anToan.hinhDang, xemTay: anToan.xemTay });
  const ng = nguongService.layNguong();
  const hAlpha = await xuLy.tinhHashAnhTam(await thietKe('ALPHA', '#1b1b1b'));
  const kqAlpha = timTuongTu({ mau: [{ ...hAlpha, nhan: 'q' }], gioiHan: 100000 });
  const nhomCua = stt => nguongService.phanNhom(kqAlpha.ketQua.find(r => r.stt_key === stt), ng);
  console.log('Nhóm khi tìm ALPHA:', { ALPHA_a: nhomCua('NG_ALPHA_a'), ALPHA_b: nhomCua('NG_ALPHA_b'), BRAVO_a: nhomCua('NG_BRAVO_a'), ZULU_b: nhomCua('NG_ZULU_b') });
  assert.strictEqual(nhomCua('NG_ALPHA_a'), 'TRUNG_FILE');
  assert(['ANH_GIONG', 'CUNG_HINH_DANG'].includes(nhomCua('NG_ALPHA_b')), 'biến thể đổi màu/nền phải vào nhóm giống');
  assert(['DIEM_THAP', 'CAN_XEM_TAY'].includes(nhomCua('NG_BRAVO_a')), 'thiết kế khác không được vào nhóm giống');
  // chọn cặp mới để đánh giá: khác đơn, chưa đánh giá
  for (let i = 0; i < 5; i++) {
    const cap = nguongService.layCapMoi();
    assert(cap && cap.a.stt_key !== cap.b.stt_key, 'cặp mới phải là 2 đơn khác nhau');
    const [x, y] = [Math.min(cap.a.id, cap.b.id), Math.max(cap.a.id, cap.b.id)];
    assert(!db.dsCapDanhGia().some(c => c.file_a === x && c.file_b === y), 'không lấy lại cặp đã đánh giá');
    db.luuCapDanhGia({ fileA: cap.a.id, fileB: cap.b.id, ketLuan: 'KHAC', nguoi: 'test' });
  }
  // admin chỉ thấy 1 phần nhỏ thư viện (NG_* ~4%) — vẫn phải chọn được cặp, và cả 2 ảnh trong phạm vi
  const trongPhamVi = st => st.startsWith('NG_');
  const tyLe = db2.prepare(`SELECT AVG(substr(stt_key, 1, 3) = 'NG_') FROM tv_file WHERE loai = 'PNG' AND trang_thai = 'XONG' AND dhash != '' AND dhash_hinh_dang != ''`).pluck().get();
  console.log(`Cặp cho admin: phạm vi chiếm ${(tyLe * 100).toFixed(1)}% số PNG có hash`);
  for (let i = 0; i < 3; i++) {
    const cap = nguongService.layCapMoi(trongPhamVi);
    assert(cap && trongPhamVi(cap.a.stt_key) && trongPhamVi(cap.b.stt_key), 'cặp cho admin phải nằm trong phạm vi: ' + JSON.stringify(cap));
    db.luuCapDanhGia({ fileA: cap.a.id, fileB: cap.b.id, ketLuan: 'KHAC', nguoi: 'test' });
  }
  nguongService.xoaNguong();
  assert.strictEqual(nguongService.layNguong(), null);

  // ================= GIAI ĐOẠN 5: thống kê =================
  const { thongKeThuVien } = require(W + '/services/thuVien/thongKeService');
  assert.strictEqual((await xuLy.luuEmb({ buffer: Buffer.from('chi-co-emb'), sttKey: 'EMBONLY' })).ketQua, 'DA_LUU');
  const tkTv = await thongKeThuVien({ maSheet: new Set(['TKGOC', 'KHONGCOPNG', 'EMBONLY']) });
  console.log('Thống kê:', { soDon: tkTv.soDon, soPng: tkTv.soPng, soEmbPhienBan: tkTv.soEmbPhienBan, soDonCoEmb: tkTv.soDonCoEmb, pngChuaEmb: tkTv.pngChuaEmb.so, embChuaPng: tkTv.embChuaPng.mau,
    sheetChuaCoPng: tkTv.sheetChuaCoPng.mau, khongConTrongSheet: tkTv.khongConTrongSheet.so, trung: tkTv.trungNoiDung.soNhom, viec: tkTv.viec, ms: tkTv.ms });
  const soDonThat = db2.prepare(`SELECT COUNT(DISTINCT stt_key) n FROM tv_file WHERE trang_thai != 'DANG_LUU'`).get().n;
  assert.strictEqual(tkTv.soDon, soDonThat);
  assert.strictEqual(tkTv.soPng, db2.prepare(`SELECT COUNT(*) n FROM tv_file WHERE loai = 'PNG' AND trang_thai != 'DANG_LUU'`).get().n);
  assert.strictEqual(tkTv.soEmbPhienBan, db2.prepare(`SELECT COUNT(*) n FROM tv_file WHERE loai = 'EMB' AND trang_thai != 'DANG_LUU'`).get().n);
  assert(tkTv.embChuaPng.mau.includes('EMBONLY') && !tkTv.embChuaPng.mau.includes('9U121.2'), 'EMBONLY có EMB chưa PNG; 9U121.2 có cả 2');
  assert(tkTv.pngChuaEmb.mau.includes('CUNGLUC'));
  assert.deepStrictEqual(tkTv.sheetChuaCoPng.mau, ['KHONGCOPNG', 'EMBONLY'], 'đơn trong Sheet chưa có PNG');
  assert.strictEqual(tkTv.khongConTrongSheet.so, soDonThat - 2, 'mọi đơn trừ TKGOC và EMBONLY không có trong Sheet giả');
  assert(tkTv.trungNoiDung.mau.some(nhom => nhom.includes('TKGOC') && nhom.includes('TKSAU')), 'TKGOC và TKSAU cùng nội dung');
  const tkAdmin = await thongKeThuVien({ duocXem: ma => ma !== 'TKSAU', maSheet: null });
  assert(!tkAdmin.trungNoiDung.mau.some(nhom => nhom.includes('TKSAU')), 'đơn ngoài phạm vi không được tính');
  assert.strictEqual(tkAdmin.sheetChuaCoPng, null); assert.strictEqual(tkAdmin.khongConTrongSheet, null);
  assert.strictEqual(tkAdmin.soDon, soDonThat - 1);

  // ================= ROUTE /api/thu-vien (app Express nhỏ, phiên đăng nhập giả superadmin) =================
  const express = require('express');
  const app = express();
  app.use(express.json());
  let nguoiDungApi = { ten: 'SA', vaiTro: 'superadmin' };
  app.use((req, res, next) => { req.session = { user: nguoiDungApi }; next(); });
  app.use('/api/thu-vien', require(W + '/routes/thuVien'));
  const svApp = app.listen(0);
  await new Promise(r => svApp.once('listening', r));
  const api = async (duong, opt = {}) => {
    const t = Date.now();
    const r = await fetch(`http://127.0.0.1:${svApp.address().port}/api/thu-vien${duong}`, opt);
    return { status: r.status, body: await r.json(), ms: Date.now() - t };
  };
  const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const formFile = (buf, ten, truong = {}) => {
    const fd = new FormData();
    fd.append('file', new Blob([buf]), ten);
    for (const [k, v] of Object.entries(truong)) fd.append(k, v);
    return { method: 'POST', body: fd };
  };
  const pngRt = await thietKe('ROUTE', '#334455');
  const stGoc3 = global.setTimeout, nowGoc = Date.now;
  const treoSheet = () => { orderService.getAll = () => new Promise(() => {}); global.setTimeout = (fn, ms, ...a) => stGoc3(fn, ms === 15000 ? 200 : ms, ...a); };
  const moSheet = () => { orderService.getAll = async () => ({ headers: [], rows: rowsSheet }); global.setTimeout = stGoc3; };
  const tuaGio = giay => { const lech = giay * 1000; Date.now = () => nowGoc() + lech; }; // bỏ qua cache 30 giây của layTapMa
  rowsSheet = [{ STT_Key: 'SH1', DUONG_DAN_URL: '' }, { STT_Key: 'Ab9', DUONG_DAN_URL: '' }];
  // (1)+(7) Sheet treo ngay lần đầu: không treo theo, mã gõ tay chưa biết -> báo "không đọc được Sheet" (không phải "không có trong Sheet")
  treoSheet();
  const rCold = await api('/upload', formFile(pngRt, 'khong-ro.png', { sttKeyGoTay: 'RTMOI1' }));
  moSheet();
  assert.strictEqual(rCold.status, 400); assert(/Không đọc được Sheet/.test(rCold.body.error), rCold.body.error);
  assert(rCold.ms < 3000, 'Sheet treo -> trả lời sau hạn chờ, không treo theo');
  // (6) mã gõ tay khác hoa/thường -> lưu vào đúng mã có thật
  tuaGio(31);
  const rHoa = await api('/upload', formFile(pngRt, 'khong-ro.png', { sttKeyGoTay: 'ab9' }));
  assert.strictEqual(rHoa.body.ketQua, 'DA_LUU', JSON.stringify(rHoa)); assert.strictEqual(rHoa.body.sttKey, 'Ab9');
  const rLa = await api('/upload', formFile(Buffer.concat([pngRt, Buffer.from([0])]), 'khong-ro2.png', { sttKeyGoTay: 'RTMOI1' }));
  assert.strictEqual(rLa.status, 400); assert(/không có trong Sheet/.test(rLa.body.error), rLa.body.error);
  const rLaOk = await api('/upload', formFile(Buffer.concat([pngRt, Buffer.from([0])]), 'khong-ro2.png', { sttKeyGoTay: 'RTMOI1', xacNhanNgoaiSheet: '1' }));
  assert.strictEqual(rLaOk.body.ketQua, 'DA_LUU'); assert.strictEqual(rLaOk.body.sttKey, 'RTMOI1');
  // (2) mã vừa lưu khớp được ngay trong cùng 30 giây (thêm dần, không dựng lại cả tập)
  const rXt = await api('/xem-truoc', json({ files: [{ ten: 'rtmoi1_mat-sau.png' }, { ten: 'SH1.png' }] }));
  assert.deepStrictEqual(rXt.body.ketQua.map(k => [k.trangThai, k.sttKey]), [['KHOP', 'RTMOI1'], ['KHOP', 'SH1']]);
  // (1) Sheet treo khi đã có danh sách cũ -> dùng tạm danh sách cũ
  tuaGio(62); treoSheet();
  const rCu = await api('/xem-truoc', json({ files: [{ ten: 'sh1.png' }] }));
  moSheet();
  assert.strictEqual(rCu.body.khongDocDuocSheet, false); assert.strictEqual(rCu.body.ketQua[0].sttKey, 'SH1'); assert(rCu.ms < 3000);
  // (7) danh sách cũ phải được báo (lúc đọc được), mã lạ báo theo danh sách cũ
  assert.strictEqual(typeof rCu.body.sheetCuLuc, 'number', 'đang dùng danh sách Sheet cũ thì phải báo'); assert.strictEqual(rXt.body.sheetCuLuc, null);
  const rLaCu = await api('/upload', formFile(pngRt, 'khong-ro3.png', { sttKeyGoTay: 'RTMOI2' }));
  assert(/đọc từ Sheet lúc/.test(rLaCu.body.error), rLaCu.body.error);
  tuaGio(93); // Sheet đọc lại được (moSheet) — hết hạn 30 giây để dựng lại danh sách mới
  // (4) tra theo mã / ghi quyết định với mã gõ khác hoa/thường -> mã thật
  const rTra = await api('/don/sh1');
  assert.strictEqual(rTra.status, 200); assert.strictEqual(rTra.body.sttKey, 'SH1');
  const rQd = await api('/quyet-dinh', json({ sttKeyMoi: 'ab9', fileId: rLaOk.body.id, quyetDinh: 'DA_KIEM' }));
  assert.strictEqual(rQd.status, 200); assert(db.dsQuyetDinhCuaDon('Ab9').length === 1 && !db.dsQuyetDinhCuaDon('ab9').length, 'quyết định ghi theo mã thật');
  // (3)(6)(11) admin Xưởng HN: phạm vi 1 truy vấn; Cần xử lý lọc Xưởng trước khi lấy 500 dòng; không lộ mã Xưởng khác
  require(W + '/services/taiKhoanService').themMoi({ Ten: 'AdHN', VaiTro: 'admin', Xuong: 'HN', KichHoat: 'TRUE', MatKhau: '', HienThiDangNhap: 'TRUE' });
  const ttDb = require(W + '/services/trangThaiDbService');
  ttDb.ghiDe('SH1', { XUONG: 'HN' }, { nguoi: 'test' }); ttDb.ghiDe('Ab9', { XUONG: 'BN' }, { nguoi: 'test' });
  nguoiDungApi = { ten: 'AdHN', vaiTro: 'admin' };
  assert.strictEqual((await api('/don/SH1')).status, 200); assert.strictEqual((await api('/don/ab9')).status, 404);
  const rXtAd = await api('/xem-truoc', json({ files: [{ ten: 'Ab9.png' }, { ten: 'SH1 Ab9.png' }] }));
  assert.deepStrictEqual(rXtAd.body.ketQua.map(k => [k.trangThai, k.sttKey, k.ungVien]), [['KHONG_QUYEN', undefined, undefined], ['NHIEU', undefined, ['SH1']]],
    'không gửi về mã đơn của Xưởng khác: ' + JSON.stringify(rXtAd.body.ketQua));
  const themLoi = db2.prepare(`INSERT INTO tv_hang_cho (stt_key, url, nguon, trang_thai, loi_cuoi, tao_luc, cap_nhat_luc) VALUES (?, ?, 'EXCEL', 'LOI_CUOI', 'x', 'x', 'x')`);
  db2.transaction(() => { for (let i = 0; i < 600; i++) themLoi.run('Ab9', `https://loi.test/bn${i}`); themLoi.run('SH1', 'https://loi.test/hn'); })();
  const cxlAd = (await api('/can-xu-ly')).body;
  assert.deepStrictEqual(cxlAd.viecLoi.map(v => v.url), ['https://loi.test/hn'], '600 lỗi của Xưởng khác không được che lỗi của HN');
  db2.prepare(`DELETE FROM tv_hang_cho WHERE url LIKE 'https://loi.test/%'`).run();
  nguoiDungApi = { ten: 'SA', vaiTro: 'superadmin' };
  // (13) EMB từ chi tiết đơn: mã lạ phải xác nhận; khác hoa/thường -> mã thật
  const rEmbLa = await api('/emb/RTKHONGCO', formFile(Buffer.from('emb-route-1'), 'a.emb'));
  assert.strictEqual(rEmbLa.body.ketQua, 'CAN_XAC_NHAN', JSON.stringify(rEmbLa.body));
  assert.strictEqual(db.dsFileCuaDon('RTKHONGCO').length, 0, 'chưa xác nhận thì chưa lưu');
  assert.strictEqual((await api('/emb/RTKHONGCO', formFile(Buffer.from('emb-route-1'), 'a.emb', { xacNhanNgoaiSheet: '1' }))).body.ketQua, 'DA_LUU');
  const rEmbHoa = await api('/emb/AB9', formFile(Buffer.from('emb-route-2'), 'b.emb'));
  assert.strictEqual(rEmbHoa.body.ketQua, 'DA_LUU'); assert.strictEqual(rEmbHoa.body.sttKey, 'Ab9');
  // (3)+(14) Quét ngay: công tắc TẮT phải xác nhận; trả lời ngay, quét chạy nền; đang quét thì 409
  assert.strictEqual(dongBo.dangBat(), false);
  const rQ0 = await api('/tu-dong-sheet/quet-ngay', json({}));
  assert.strictEqual(rQ0.status, 400); assert(/cần xác nhận/.test(rQ0.body.error));
  orderService.getAll = () => new Promise(r => stGoc3(() => r({ headers: [], rows: rowsSheet }), 500));
  const rQ = await api('/tu-dong-sheet/quet-ngay', json({ xacNhanKhiTat: true }));
  assert.deepStrictEqual(rQ.body, { batDau: true }); assert(rQ.ms < 400, 'trả lời trước khi đọc xong Sheet');
  assert.strictEqual((await api('/hang-cho')).body.tuDongSheet.dangQuet, true);
  assert.strictEqual((await api('/tu-dong-sheet/quet-ngay', json({ xacNhanKhiTat: true }))).status, 409);
  while (dongBo.dangQuet()) await new Promise(r => stGoc3(r, 50));
  const hcSau = (await api('/hang-cho')).body.tuDongSheet;
  assert.strictEqual(hcSau.dangQuet, false); assert.strictEqual(hcSau.lanQuet.bamTay, true); assert(!hcSau.lanQuet.loi, JSON.stringify(hcSau.lanQuet));
  // (9) ước tính dung lượng chỉ theo PNG do hàng chờ tải (không tính EMB / file tải tay)
  const hcSo = (await api('/hang-cho')).body;
  assert.strictEqual(hcSo.soPngHangCho, db2.prepare(`SELECT COUNT(*) FROM tv_file WHERE loai = 'PNG' AND nguon IN ('SHEET', 'EXCEL') AND trang_thai != 'DANG_LUU'`).pluck().get());
  assert(hcSo.soPngHangCho < hcSo.soFile, 'thư viện có cả EMB/file tải tay');
  moSheet();
  // (5) gợi ý ngưỡng: lưới chỉ chạy khi có tinh=1
  assert.strictEqual((await api('/nguong/goi-y')).body.goiY.length, 0);
  assert((await api('/nguong/goi-y?tinh=1')).body.goiY.length >= 2);
  Date.now = nowGoc;
  svApp.close();

  // ---- taiUrlTho: trần 50MB + đứt giữa chừng không sập/treo (server HTTP cục bộ; DNS chặn SSRF được giả lập thành IP công khai) ----
  require('dns').promises.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const ngoai = http.createServer((req, res) => {
    if (req.url === '/ok') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(A); }
    if (req.url === '/lon-header') { res.writeHead(200, { 'Content-Length': 60 * 1048576 }); return res.write(Buffer.alloc(1024)); }
    if (req.url === '/lon-stream') { res.writeHead(200); const k = Buffer.alloc(1048576); let n = 0; const ghi = () => { while (n < 55 && res.write(k)) n++; if (n < 55) res.once('drain', ghi); else res.end(); }; return ghi(); }
    if (req.url.startsWith('/chuyen')) { const n = Number(req.url.slice(7)) || 0; res.writeHead(302, { Location: n < 4 ? `/chuyen${n + 1}` : '/nho-giot' }); return res.end(); }
    if (req.url === '/nho-giot') { res.writeHead(200); const iv = setInterval(() => res.write('x'), 100); return res.on('close', () => clearInterval(iv)); }
    if (req.url === '/dut') { res.writeHead(200, { 'Content-Length': 100000 }); res.write(Buffer.alloc(1000)); return setTimeout(() => req.socket.destroy(), 50); }
    res.writeHead(404); res.end();
  }).listen(0);
  await new Promise(r => ngoai.once('listening', r));
  const goc = `http://localhost:${ngoai.address().port}`;
  assert((await taiUrlThoThat(goc + '/ok')).equals(A));
  // nhỏ giọt 1 byte/100ms — timeout im lặng 15s không bao giờ kích hoạt; hạn TỔNG (60s, thu nhỏ còn 300ms trong test) phải cắt
  const stGoc = global.setTimeout;
  global.setTimeout = (fn, ms, ...a) => stGoc(fn, ms > 59000 && ms <= 60000 ? 300 : ms, ...a); // hạn còn lại ~60 giây
  const tNho = Date.now();
  const nhoGiot = await taiUrlThoThat(goc + '/nho-giot');
  global.setTimeout = stGoc;
  assert.strictEqual(nhoGiot, null); assert(Date.now() - tNho < 3000, 'nhỏ giọt phải bị cắt theo hạn tổng');
  // hạn tổng tính cho CẢ chuỗi chuyển hướng (bản cũ đặt lại hạn ở mỗi lần chuyển: 5 lần chuyển = 6 phút)
  const tChuyen = Date.now();
  assert.strictEqual(await taiUrlThoThat(goc + '/chuyen', 5, Date.now() + 400), null);
  assert(Date.now() - tChuyen < 2000, 'chuỗi 5 lần chuyển hướng tới link nhỏ giọt phải dừng theo hạn tổng: ' + (Date.now() - tChuyen) + 'ms');
  assert.strictEqual(await taiUrlThoThat(goc + '/lon-header'), null, 'Content-Length > 50MB -> bỏ ngay');
  assert.strictEqual(await taiUrlThoThat(goc + '/lon-stream'), null, 'không có Content-Length, vượt 50MB khi đang tải -> bỏ');
  assert.strictEqual(await taiUrlThoThat(goc + '/dut'), null, 'đứt giữa chừng -> null, không sập, không treo');
  ngoai.close();

  // ---- guiObjectQuaHttp với MinIO giả: ok / không có / đứt giữa chừng / treo giữa chừng / không trả header ----
  const minio = http.createServer((req, res) => {
    const key = decodeURIComponent(req.url.split('?')[0].replace(/^\/tb\//, ''));
    if (key === 'ok.png') { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': 3 }); return res.end('XYZ'); }
    if (key === 'dut.png') { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': 100000 }); res.write(Buffer.alloc(1000)); return setTimeout(() => req.socket.destroy(), 50); }
    if (key === 'treo.png') { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': 100000 }); return res.write(Buffer.alloc(10)); }
    if (key === 'cham.png') return; // không bao giờ trả lời
    res.writeHead(404, { 'Content-Type': 'application/xml' });
    res.end('<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>khong co</Message><Key>' + key + '</Key></Error>');
  }).listen(CONG_MINIO);
  await new Promise(r => minio.once('listening', r));
  const proxy = http.createServer(async (req, res) => {
    try {
      await guiObjectQuaHttpThat(res, req.url.slice(1), { timeoutMs: 400 });
    } catch (err) {
      res.statusCode = err.name === 'NoSuchKey' ? 404 : 502;
      res.end(err.name);
    }
  }).listen(0);
  await new Promise(r => proxy.once('listening', r));
  const goi = key => new Promise(resolve => {
    const t = Date.now();
    http.get(`http://127.0.0.1:${proxy.address().port}/${key}`, r => {
      const ch = []; r.on('data', c => ch.push(c));
      r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(ch).toString(), ms: Date.now() - t }));
      r.on('error', () => resolve({ status: r.statusCode, dut: true, ms: Date.now() - t }));
    }).on('error', e => resolve({ loi: e.code, ms: Date.now() - t }));
  });
  const kqOk = await goi('ok.png'), kqKhong = await goi('khong-co.png'), kqDut = await goi('dut.png'), kqTreo = await goi('treo.png'), kqCham = await goi('cham.png');
  console.log('MinIO giả:', { kqOk, kqKhong, kqDut, kqTreo, kqCham });
  assert.strictEqual(kqOk.status, 200); assert.strictEqual(kqOk.body, 'XYZ');
  assert.strictEqual(kqKhong.status, 404);
  assert((kqDut.dut || kqDut.loi || kqDut.body.length < 100000) && kqDut.ms < 3000, 'đứt giữa chừng: người xem nhận kết nối đóng ngay (bản cũ treo mãi)');
  assert((kqTreo.dut || kqTreo.loi || kqTreo.body.length < 100000) && kqTreo.ms < 3000, 'treo giữa chừng: tự huỷ sau timeout');
  assert.strictEqual(kqCham.status, 502); assert(kqCham.ms < 3000, 'MinIO không trả header: tự huỷ sau timeout, trả 502');
  minio.close(); proxy.close();

  console.log('\nTẤT CẢ KIỂM THỬ THƯ VIỆN TÌM ẢNH ĐẠT');
  process.exit(0);
})().catch(err => { console.error('THẤT BẠI:', err); process.exit(1); });
