// Kiểm thử Logs_UploadAnh (routes/nhatKyQuet.js + services/nhatKyDbService.js) — chạy: node scripts/kiem-tra-logs-upload-anh.js
// TỰ tạo CSDL tạm trong thư mục temp của hệ điều hành TRƯỚC mọi require (không bao giờ mở data/*.db).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
// Dọn thư mục tạm của các lần chạy TRƯỚC (Windows khoá file .db đang mở nên lần chạy hiện tại không tự xoá được của chính nó).
// Chỉ thư mục cũ hơn 10 phút — không xoá CSDL của 1 lần chạy khác đang chạy song song.
for (const ten of fs.readdirSync(os.tmpdir()).filter(t => t.startsWith('kiem-tra-logs-upload-anh-'))) {
  const duong = path.join(os.tmpdir(), ten);
  try { if (Date.now() - fs.statSync(duong).mtimeMs > 10 * 60000) fs.rmSync(duong, { recursive: true, force: true }); } catch (e) { /* đang dùng -> bỏ */ }
}
const TAM = fs.mkdtempSync(path.join(os.tmpdir(), 'kiem-tra-logs-upload-anh-'));
for (const [k, f] of Object.entries({ THU_VIEN_DB_PATH: 'tv', SQLITE_DB_PATH: 'tt', NHAT_KY_DB_PATH: 'nk', CAI_DAT_DB_PATH: 'cd',
  TAI_KHOAN_DB_PATH: 'tk', DON_HANG_LOAT_DB_PATH: 'dhl', KICH_BAN_DB_PATH: 'kb' })) process.env[k] = path.join(TAM, f + '.db');
process.env.SERVER_LOG_PATH = path.join(TAM, 'server.log');
const W = path.join(__dirname, '..');
require(W + '/services/logCapture'); // console.warn -> SERVER_LOG_PATH tạm (kiểm tra cảnh báo vượt giới hạn)
const express = require('express');
// Giả lập đơn cho route chụp ảnh / tra cứu (gắn TRƯỚC khi require route — qr.js lấy hàm logService lúc nạp).
const orderService = require(W + '/services/orderService');
const DON = { X1: { STT_Key: 'X1', TRANG_THAI_XUONG: 'ĐÃ SẴN SÀNG CHẠY MÁY' }, X2: { STT_Key: 'X2', TRANG_THAI_XUONG: 'Đang chạy máy' } };
orderService.getByKey = async k => ({ headers: [], row: DON[k] || null });
orderService.coQuyenTheoXuong = () => true;
require(W + '/services/logService').layLichSuTheoDon = async () => [];

(async () => {
  const app = express();
  app.use(express.json());
  let u = { ten: 'SX', vaiTro: 'superadmin' };
  app.use((req, res, next) => { req.session = { user: u }; next(); });
  app.use('/api/nhat-ky-quet', require(W + '/routes/nhatKyQuet'));
  app.use('/api/photos', require(W + '/routes/photos'));
  app.use('/api/qr', require(W + '/routes/qr'));
  const sv = app.listen(0);
  await new Promise(r => sv.once('listening', r));
  const B = `http://127.0.0.1:${sv.address().port}/api/nhat-ky-quet`;
  const gui = body => fetch(B, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  const xem = q => fetch(B + q).then(r => r.json());
  const tb = { os: 'iOS', osVer: '17.5', br: 'Safari', brVer: '17.5' };

  // ---- ghi + phân nhóm kết quả (kỹ thuật / sai đơn / quét lại) + trung bình từng chặng ----
  const r1 = await gui({ phienBanApp: '122', thietBi: tb, suKien: [
    { suKien: 'CHUP_ANH', ketQua: 'OK', tongMs: 9000, sttKey: 'A1', chiTiet: { msNen: 5000, msGui: 3000, msMayChu: 500 } },
    { suKien: 'CHUP_ANH', ketQua: 'LOI', tongMs: 1000, sttKey: 'A2', chiTiet: { msGuiVaCho: 900 } },
    { suKien: 'QUET_QR', ketQua: 'SAI_TRANG_THAI', sttKey: 'A3', chiTiet: { msKiemTra: 200, msTimMa: 1500 } },
    { suKien: 'QUET_LAI', ketQua: 'BO_NGANG', sttKey: 'A4' },
    { suKien: 'THOAT_GIUA_CHUNG', ketQua: 'BO_NGANG', sttKey: 'A5' },
    { suKien: 'XAC_NHAN_HANG_LOAT', ketQua: 'CO_DON_LOI' },
    { suKien: 'KHONG_HOP_LE', ketQua: 'OK' }, // loại sự kiện lạ -> bỏ
  ] });
  assert.ok(typeof r1.phienBanMoiNhat === 'string');
  const th = await xem('/tong-hop?nhom=thiet-bi');
  assert.strictEqual(th.length, 1); assert.strictEqual(th[0].nhom, 'iOS 17 · Safari 17');
  assert.deepStrictEqual([th[0].soLuot, th[0].soLoiKyThuat, th[0].soNghiepVu, th[0].soBoNgang], [6, 2, 2, 1]);
  assert.deepStrictEqual([th[0].tbChup, th[0].tbNen, th[0].tbGui, th[0].tbMayChu, th[0].tbKiemTra, th[0].tbTimMa], [9000, 5000, 3000, 500, 200, 1500]);
  assert.deepStrictEqual((await xem('?nhomKq=KY_THUAT')).ds.map(r => r.su_kien).sort(), ['CHUP_ANH', 'THOAT_GIUA_CHUNG']);
  assert.deepStrictEqual((await xem('?nhomKq=NGHIEP_VU')).ds.map(r => r.su_kien).sort(), ['QUET_QR', 'XAC_NHAN_HANG_LOAT']);
  assert.strictEqual((await xem('?chiCham=1')).ds.length, 1, 'chụp > 8 giây = chậm');
  assert.strictEqual((await xem('?suKien=QUET_LAI')).ds.length, 1);

  // ---- ảnh bị ghi "thoát" lúc trang tạm cất, quay lại tải xong -> CHỈ dòng THOAT tạm đó bị xoá (không đếm 2 lần) ----
  await gui({ thietBi: tb, suKien: [{ suKien: 'THOAT_GIUA_CHUNG', ketQua: 'BO_NGANG', sttKey: 'B1', chiTiet: { giaiDoan: 'gui' } }] }); // thoát THẬT
  await gui({ thietBi: tb, suKien: [{ suKien: 'THOAT_GIUA_CHUNG', ketQua: 'BO_NGANG', sttKey: 'B1', chiTiet: { tamCat: true } }] });
  await gui({ thietBi: tb, suKien: [{ suKien: 'CHUP_ANH', ketQua: 'OK', tongMs: 3000, sttKey: 'B1', chiTiet: { sauThoat: true } }] });
  const thoat = (await xem('?suKien=THOAT_GIUA_CHUNG')).ds;
  assert.deepStrictEqual(thoat.map(r => [r.stt_key, JSON.parse(r.chi_tiet).tamCat || false]), [['B1', false], ['A5', false]], 'chỉ xoá THOAT tạm của B1');
  await gui({ thietBi: tb, suKien: [{ suKien: 'CHUP_ANH', ketQua: 'OK', tongMs: 3000, sttKey: 'B1', chiTiet: { sauThoat: true } }] });
  assert.strictEqual((await xem('?suKien=THOAT_GIUA_CHUNG')).ds.length, 2, 'không còn THOAT tạm -> không xoá THOAT thật');

  // ---- chi_tiet quá dài vẫn lưu JSON hợp lệ; bảng tổng hợp không lỗi ----
  await gui({ thietBi: tb, suKien: [{ suKien: 'CHUP_ANH', ketQua: 'OK', tongMs: 2000, sttKey: 'C1', chiTiet: { msNen: 100, khongNen: 'x'.repeat(5000), rac: 'y'.repeat(5000) } }] });
  const c1 = (await xem('?suKien=CHUP_ANH')).ds.find(r => r.stt_key === 'C1');
  assert.ok(c1.chi_tiet.length <= 3000); assert.strictEqual(JSON.parse(c1.chi_tiet).msNen, 100);
  // trường lồng nhau quá lớn -> bỏ RIÊNG trường đó, giữ loại file / mạng / thời gian máy chủ
  await gui({ thietBi: tb, suKien: [{ suKien: 'CHUP_ANH', ketQua: 'OK', tongMs: 2000, sttKey: 'C2', chiTiet: { msNen: 7, loaiFile: 'image/heic', mang: { loai: '3g' },
    mayChu: { docDon: 1, minio: 2, ghi: 3, tong: 6 }, rac: Array.from({ length: 2000 }, (_, i) => i) } }] });
  const c2 = JSON.parse((await xem('?suKien=CHUP_ANH')).ds.find(r => r.stt_key === 'C2').chi_tiet);
  assert.deepStrictEqual([c2.msNen, c2.loaiFile, c2.mang.loai, c2.mayChu.tong, c2.rac, c2.catBot], [7, 'image/heic', '3g', 6, undefined, ['rac']]);
  // hàng nghìn trường nhỏ: rút gọn nhanh (không O(n²)), vẫn JSON hợp lệ <= 3000
  const nhieu = Object.fromEntries(Array.from({ length: 8000 }, (_, i) => ['k' + i, i]));
  const t0 = Date.now();
  await gui({ thietBi: tb, suKien: [{ suKien: 'CHUP_ANH', ketQua: 'OK', tongMs: 1, sttKey: 'C3', chiTiet: { msNen: 9, ...nhieu } }] });
  assert.ok(Date.now() - t0 < 1500, 'rút gọn 8000 trường phải nhanh: ' + (Date.now() - t0) + 'ms');
  const c3 = (await xem('?suKien=CHUP_ANH')).ds.find(r => r.stt_key === 'C3').chi_tiet;
  assert.ok(c3.length <= 3000 && Array.isArray(JSON.parse(c3).catBot));
  require(W + '/services/nhatKyDbService'); // dòng chi_tiet hỏng (ghi tay / dữ liệu cũ) cũng không làm hỏng tổng hợp
  new (require('better-sqlite3'))(process.env.NHAT_KY_DB_PATH).prepare(`INSERT INTO logs_upload_anh (luc, nguoi, su_kien, ket_qua, chi_tiet) VALUES ('2099-01-01', 'SX', 'CHUP_ANH', 'OK', '{"msNen":1')`).run();
  assert.strictEqual((await fetch(B + '/tong-hop')).status, 200, 'chi_tiet hỏng không làm lỗi bảng tổng hợp');

  // ---- cờ nghiepVu: máy chủ từ chối vì đơn không hợp lệ = nghiệp vụ; lỗi khác (thiếu dữ liệu, file không phải ảnh) = kỹ thuật ----
  const P = B.replace('/nhat-ky-quet', '');
  const postJson = (duong, body) => fetch(P + duong, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, ...(await r.json()) }));
  const rSai = await postJson('/photos/kiem-tra', { sttKey: 'X1', moc: 'da_san_xuat' });
  assert.deepStrictEqual([rSai.status, rSai.nghiepVu], [400, true], 'sai trạng thái = nghiệp vụ');
  const rKhong = await postJson('/photos/kiem-tra', { sttKey: 'KHONGCO', moc: 'da_san_xuat' });
  assert.deepStrictEqual([rKhong.status, rKhong.nghiepVu], [404, true], 'không tìm thấy = nghiệp vụ');
  const rMoc = await postJson('/photos/kiem-tra', { sttKey: 'X1', moc: 'moc-la' });
  assert.deepStrictEqual([rMoc.status, rMoc.nghiepVu], [400, undefined], 'mốc ảnh sai = kỹ thuật');
  const fd = new FormData(); fd.append('photo', new Blob(['khong phai anh'], { type: 'text/plain' }), 'a.txt'); fd.append('sttKey', 'X2'); fd.append('moc', 'da_san_xuat');
  const rFile = await fetch(P + '/photos/upload', { method: 'POST', body: fd }).then(async r => ({ status: r.status, ...(await r.json()) }));
  assert.deepStrictEqual([rFile.status, rFile.nghiepVu], [400, undefined], 'file không phải ảnh = kỹ thuật: ' + JSON.stringify(rFile));
  const rTra = await fetch(P + '/qr/tra-cuu/KHONGCO').then(async r => ({ status: r.status, ...(await r.json()) }));
  assert.deepStrictEqual([rTra.status, rTra.nghiepVu], [404, true], 'tra cứu không thấy = nghiệp vụ');

  // ---- giới hạn 600 sự kiện/người/phút ----
  u = { ten: 'Spam', vaiTro: 'san_xuat' };
  for (let i = 0; i < 25; i++) await gui({ suKien: Array(30).fill({ suKien: 'QUET_QR', ketQua: 'OK' }) });
  u = { ten: 'SX', vaiTro: 'superadmin' };
  assert.strictEqual((await xem('?nguoi=Spam&gioiHan=20000')).ds.length, 600);
  assert.ok(/Spam vượt 600 sự kiện\/phút/.test(fs.readFileSync(process.env.SERVER_LOG_PATH, 'utf8')), 'có cảnh báo vượt giới hạn trong log');

  // ---- chỉ superadmin xem ----
  u = { ten: 'Spam', vaiTro: 'admin' };
  assert.strictEqual((await fetch(B)).status, 403);
  assert.strictEqual((await fetch(B + '/tong-hop')).status, 403);

  sv.close();
  console.log('TẤT CẢ KIỂM THỬ LOGS_UPLOADANH ĐẠT');
  ketThuc(0);
})().catch(err => { console.error('THẤT BẠI:', err); ketThuc(1); });
// Dọn thư mục CSDL tạm (Linux xoá được ngay; Windows giữ file .db đang mở -> để lần chạy sau dọn).
function ketThuc(ma) {
  try { fs.rmSync(TAM, { recursive: true, force: true }); } catch (e) { /* bỏ */ }
  process.exit(ma);
}
