// Notes (02/10/2026, theo yêu cầu người dùng) — ghi chép kinh nghiệm xử lý vấn đề: tiêu đề + nội dung (văn bản thường) + thẻ +
// ảnh đính kèm (MinIO, prefix notes/). CHỈ superadmin — chặn ở đây cho MỌI route, kể cả xem ảnh. Import .txt/.md: mỗi file 1 note.
// Dữ liệu: bảng notes (services/nhatKyDbService.js).
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { requireLogin, requireExactRole } = require('../middleware/auth');
const nhatKyDbService = require('../services/nhatKyDbService');
const storageService = require('../services/storageService');
const { thoiGianVNISOString } = require('../services/dateUtils');

router.use(requireLogin, requireExactRole('superadmin'));

const TIEN_TO_ANH = 'notes/';
const ANH_TOI_DA_MOI_NOTE = 30;
const uploadAnh = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const uploadFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 20 } });
const loi = (res, thongBao, status = 400) => res.status(status).json({ error: thongBao });

// Thẻ: chuỗi "a, b" hoặc mảng -> tối đa 10 thẻ, mỗi thẻ <= 40 ký tự, không dấu phẩy, bỏ trùng (không phân biệt hoa thường).
function docThe(v) {
  const ds = (Array.isArray(v) ? v : String(v || '').split(',')).map(t => String(t).replace(/,/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const kq = [];
  for (const t of ds) if (!kq.some(x => x.toLowerCase() === t.toLowerCase())) kq.push(t);
  return kq;
}
// -> { note } hoặc { loi }
function kiemTraNote(body) {
  const tieuDe = String((body && body.tieuDe) || '').trim();
  const noiDung = String((body && body.noiDung) || '').replace(/\r\n/g, '\n');
  const the = docThe(body && body.the);
  if (!tieuDe) return { loi: 'Chưa nhập tiêu đề.' };
  if (tieuDe.length > 200) return { loi: 'Tiêu đề tối đa 200 ký tự.' };
  if (noiDung.length > 50000) return { loi: 'Nội dung tối đa 50.000 ký tự.' };
  if (the.length > 10) return { loi: 'Tối đa 10 thẻ.' };
  if (the.some(t => t.length > 40)) return { loi: 'Mỗi thẻ tối đa 40 ký tự.' };
  return { note: { tieuDe, noiDung, the } };
}

router.get('/', (req, res) => {
  res.json(nhatKyDbService.layDanhSachNote({ tuKhoa: String(req.query.tuKhoa || '').trim(), the: String(req.query.the || '').trim() }));
});
router.get('/the', (req, res) => res.json(nhatKyDbService.layTatCaTheNote()));

router.post('/', (req, res) => {
  const { note, loi: l } = kiemTraNote(req.body);
  if (l) return loi(res, l);
  res.json({ ok: true, id: nhatKyDbService.taoNote(note, req.session.user.ten, thoiGianVNISOString()) });
});
router.put('/:id', (req, res) => {
  const { note, loi: l } = kiemTraNote(req.body);
  if (l) return loi(res, l);
  if (!nhatKyDbService.suaNote(Number(req.params.id), note, req.session.user.ten, thoiGianVNISOString())) return loi(res, 'Không tìm thấy note.', 404);
  res.json({ ok: true });
});
// Xoá note + ảnh của note trên MinIO (ảnh xoá lỗi chỉ ghi log — note vẫn xoá).
router.delete('/:id', async (req, res) => {
  const note = nhatKyDbService.layNote(Number(req.params.id));
  if (!note) return loi(res, 'Không tìm thấy note.', 404);
  nhatKyDbService.xoaNote(note.id);
  for (const key of note.Anh) {
    await storageService.deleteObject(key).catch(err => console.error('[Notes] Không xoá được ảnh', key, err.message));
  }
  res.json({ ok: true });
});

// Ảnh đính kèm: field "anh" (1 ảnh/lượt, <= 10MB, JPEG/PNG/WEBP/GIF).
router.post('/:id/anh', uploadAnh.single('anh'), async (req, res) => {
  const note = nhatKyDbService.layNote(Number(req.params.id));
  if (!note) return loi(res, 'Không tìm thấy note.', 404);
  if (!req.file) return loi(res, 'Chưa chọn ảnh.');
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(req.file.mimetype)) return loi(res, 'Chỉ nhận ảnh JPEG, PNG, WEBP hoặc GIF.');
  if (note.Anh.length >= ANH_TOI_DA_MOI_NOTE) return loi(res, `Mỗi note tối đa ${ANH_TOI_DA_MOI_NOTE} ảnh.`);
  const duoi = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[req.file.mimetype];
  const key = `${TIEN_TO_ANH}${note.id}/${crypto.randomUUID()}${duoi}`;
  try {
    await storageService.uploadImageBuffer(req.file.buffer, key, req.file.mimetype);
  } catch (err) {
    console.error('[Notes] Upload ảnh lỗi:', err.message);
    return loi(res, 'Không tải được ảnh lên kho lưu trữ: ' + err.message, 502);
  }
  // Đọc lại note SAU khi upload xong (tránh mất ảnh khi tải nhiều ảnh song song).
  const moi = nhatKyDbService.layNote(note.id);
  if (!moi) { await storageService.deleteObject(key).catch(() => {}); return loi(res, 'Note đã bị xoá.', 404); }
  nhatKyDbService.datAnhNote(note.id, [...moi.Anh, key]);
  res.json({ ok: true, key });
});
// body: { key }
router.delete('/:id/anh', async (req, res) => {
  const note = nhatKyDbService.layNote(Number(req.params.id));
  if (!note) return loi(res, 'Không tìm thấy note.', 404);
  const key = String((req.body && req.body.key) || '');
  if (!note.Anh.includes(key)) return loi(res, 'Ảnh không thuộc note này.', 404);
  nhatKyDbService.datAnhNote(note.id, note.Anh.filter(k => k !== key));
  await storageService.deleteObject(key).catch(err => console.error('[Notes] Không xoá được ảnh', key, err.message));
  res.json({ ok: true });
});
// Xem ảnh: /api/notes/anh/notes/{id}/{uuid}.jpg — chỉ prefix notes/.
router.get('/anh/*', async (req, res) => {
  const key = decodeURIComponent(req.path.replace(/^\/anh\//, ''));
  if (!key.startsWith(TIEN_TO_ANH) || key.includes('..')) return loi(res, 'Đường dẫn ảnh không hợp lệ.');
  try {
    // guiObjectQuaHttp (03/10/2026): có timeout + đóng đúng kết nối khi MinIO đứt/treo giữa chừng (.pipe() cũ để người xem chờ mãi).
    await storageService.guiObjectQuaHttp(res, key, { headers: { 'Cache-Control': 'private, max-age=3600' } });
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return loi(res, 'Không tìm thấy ảnh.', 404);
    console.error('[Notes] Đọc ảnh lỗi:', err.message);
    return loi(res, 'Đọc ảnh từ kho lưu trữ thất bại.', 502);
  }
});

// Import .txt / .md: field "files" (tối đa 20 file, mỗi file <= 1MB, UTF-8). Mỗi file -> 1 note (tiêu đề = tên file bỏ đuôi),
// body.the: thẻ gắn cho mọi note import. File sai định dạng/rỗng/không phải văn bản -> bỏ qua, báo lý do; file hợp lệ vẫn nhập.
router.post('/import', uploadFile.array('files', 20), (req, res) => {
  const files = req.files || [];
  if (!files.length) return loi(res, 'Chưa chọn file.');
  const the = docThe(req.body && req.body.the);
  const kq = { daNhap: [], boQua: [] };
  for (const f of files) {
    // multer đọc tên file theo latin1 — đổi lại UTF-8 để giữ tiếng Việt.
    const ten = Buffer.from(f.originalname, 'latin1').toString('utf8');
    if (!/\.(txt|md)$/i.test(ten)) { kq.boQua.push({ ten, lyDo: 'Chỉ nhận .txt hoặc .md' }); continue; }
    const vanBan = f.buffer.toString('utf8').replace(/^﻿/, '');
    if (vanBan.includes('\u0000') || vanBan.includes('�')) { kq.boQua.push({ ten, lyDo: 'Không phải văn bản UTF-8' }); continue; }
    if (!vanBan.trim()) { kq.boQua.push({ ten, lyDo: 'File rỗng' }); continue; }
    const { note, loi: l } = kiemTraNote({ tieuDe: ten.replace(/\.(txt|md)$/i, '').slice(0, 200), noiDung: vanBan, the });
    if (l) { kq.boQua.push({ ten, lyDo: l }); continue; }
    kq.daNhap.push({ ten, id: nhatKyDbService.taoNote(note, req.session.user.ten, thoiGianVNISOString()) });
  }
  res.json(kq);
});

// Lỗi multer (file quá lớn / quá nhiều file) -> 400 dễ hiểu.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return loi(res, err.code === 'LIMIT_FILE_SIZE' ? 'File quá lớn (ảnh tối đa 10MB, file .txt/.md tối đa 1MB).' : err.code === 'LIMIT_FILE_COUNT' ? 'Quá nhiều file (tối đa 20).' : err.message);
  }
  next(err);
});

module.exports = router;
