// Y20 "Báo lỗi app" (11/10/2026, theo yêu cầu người dùng — spec 2026-10-04-21-tinh-nang-design.md mục 20).
// Mọi vai trò gửi được (tối đa 20 báo lỗi/người/ngày, ảnh PNG/JPEG <= 5MB theo magic bytes, lưu MinIO bao-loi/<năm-tháng>/<id>.<đuôi>).
// CHỈ superadmin xem danh sách, xem ảnh, đổi trạng thái/ghi chú (trang Logs). Báo lỗi mới gửi Telegram vận hành nếu đã cấu hình.
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { requireLogin, requireExactRole } = require('../middleware/auth');
const nhatKy = require('../services/nhatKyDbService');
const storageService = require('../services/storageService');
const { nhanDangKieuAnh } = require('../services/anhNguonService');
const { thoiGianVNISOString } = require('../services/dateUtils');
const { guiTinVanHanh } = require('../services/vanHanhService');

router.use(requireLogin);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fieldSize: 200 * 1024 } });
const SO_BAO_LOI_TOI_DA_MOI_NGAY = 20;
const TRANG_THAI = ['MOI', 'DANG_XU_LY', 'DA_XONG'];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

router.post('/', upload.single('anh'), async (req, res) => {
  const user = req.session.user;
  const moTa = String(req.body?.moTa || '').trim().slice(0, 4000);
  if (!moTa) return res.status(400).json({ error: 'Hãy mô tả lỗi gặp phải.' });
  const luc = thoiGianVNISOString();
  if (nhatKy.demBaoLoiTu(user.ten, luc.slice(0, 10)) >= SO_BAO_LOI_TOI_DA_MOI_NGAY) {
    return res.status(429).json({ error: `Bạn đã gửi ${SO_BAO_LOI_TOI_DA_MOI_NGAY} báo lỗi hôm nay — báo trực tiếp cho quản lý nếu còn lỗi khác.` });
  }
  const kieu = req.file ? nhanDangKieuAnh(req.file.buffer) : null;
  if (req.file && !kieu) return res.status(400).json({ error: 'Ảnh chỉ nhận PNG hoặc JPEG.' });
  let t = {};
  try { t = JSON.parse(req.body?.thongTin || '{}') || {}; } catch (e) { /* thông tin kèm hỏng -> bỏ */ }
  // Chỉ giữ các trường biết trước, mỗi trường có trần (tổng < ~40KB) — lưu JSON luôn hợp lệ, không cắt ngang chuỗi JSON như trước.
  const s = (v, n) => String(v ?? '').slice(0, n);
  const ds = (v, n, chon) => (Array.isArray(v) ? v.slice(-n) : []).map(x => chon(x || {}));
  const thongTin = {
    trang: s(t.trang, 500), gio: s(t.gio, 40), trinhDuyet: s(t.trinhDuyet, 500), manHinh: s(t.manHinh, 200),
    loiJs: ds(t.loiJs, 20, x => ({ luc: s(x.luc, 40), loi: s(x.loi, 1000), noi: s(x.noi, 300) })),
    loiApi: ds(t.loiApi, 10, x => ({ luc: s(x.luc, 40), url: s(x.url, 300), ma: s(x.ma, 10), loi: s(x.loi, 300) })),
  };
  const trang = thongTin.trang;
  const id = nhatKy.themBaoLoi({ luc, nguoi: user.ten, vaiTro: user.vaiTro, trang, moTa, thongTin: JSON.stringify(thongTin) });
  let loiAnh = '';
  if (req.file) {
    const key = `bao-loi/${luc.slice(0, 7)}/${id}.${kieu === 'image/png' ? 'png' : 'jpg'}`;
    try { await storageService.uploadImageBuffer(req.file.buffer, key, kieu); nhatKy.ganAnhBaoLoi(id, key); } catch (err) { loiAnh = 'Không lưu được ảnh: ' + err.message; }
  }
  guiTinVanHanh(`🐞 <b>Báo lỗi app #${id}</b> · ${esc(user.ten)} (${esc(user.vaiTro)})\nTrang: ${esc(trang || '?')}\n${esc(moTa.slice(0, 800))}\nXem: Logs → Báo lỗi từ nhân viên`);
  res.json({ ok: true, id, loiAnh });
});

router.get('/cua-toi', (req, res) => {
  res.json(nhatKy.dsBaoLoi({ nguoi: req.session.user.ten, gioiHan: 10 }).map(b => ({ id: b.id, luc: b.luc, moTa: b.mo_ta, trangThai: b.trang_thai, ghiChu: b.ghi_chu_xu_ly })));
});

router.get('/', requireExactRole('superadmin'), (req, res) => {
  const trangThai = TRANG_THAI.includes(req.query.trangThai) ? req.query.trangThai : '';
  res.json(nhatKy.dsBaoLoi({ trangThai, gioiHan: 300 }).map(b => {
    let thongTin = {};
    try { thongTin = JSON.parse(b.thong_tin); } catch (e) { /* bỏ */ }
    return { id: b.id, luc: b.luc, nguoi: b.nguoi, vaiTro: b.vai_tro, trang: b.trang, moTa: b.mo_ta, coAnh: !!b.anh_key, thongTin, trangThai: b.trang_thai, ghiChu: b.ghi_chu_xu_ly };
  }));
});

router.get('/:id/anh', requireExactRole('superadmin'), async (req, res) => {
  const b = nhatKy.layBaoLoi(Number(req.params.id));
  if (!b || !b.anh_key) return res.status(404).json({ error: 'Không có ảnh' });
  try {
    const buf = await storageService.getObjectBuffer(b.anh_key);
    res.set('Content-Type', b.anh_key.endsWith('.png') ? 'image/png' : 'image/jpeg').set('Cache-Control', 'private, max-age=3600').send(buf);
  } catch (err) {
    res.status(404).json({ error: 'Không đọc được ảnh: ' + err.message });
  }
});

router.post('/:id', requireExactRole('superadmin'), (req, res) => {
  const b = nhatKy.layBaoLoi(Number(req.params.id));
  if (!b) return res.status(404).json({ error: 'Không tìm thấy báo lỗi' });
  const trangThai = String(req.body?.trangThai || '');
  if (!TRANG_THAI.includes(trangThai)) return res.status(400).json({ error: 'Trạng thái không hợp lệ' });
  nhatKy.capNhatBaoLoi(b.id, { trangThai, ghiChu: String(req.body?.ghiChu || '').slice(0, 2000) });
  res.json({ ok: true });
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const thongDiep = { LIMIT_FILE_SIZE: 'Ảnh quá lớn (tối đa 5MB).', LIMIT_FIELD_VALUE: 'Nội dung báo lỗi quá dài — rút gọn mô tả (tối đa 4000 ký tự) hoặc tải lại trang rồi gửi lại.' }[err.code];
    return res.status(400).json({ error: thongDiep || 'Không gửi được báo lỗi: ' + err.message });
  }
  next(err);
});

module.exports = router;
