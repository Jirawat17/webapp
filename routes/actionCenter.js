const express = require('express');
const router = express.Router();
const { requireRole, requireExactRole } = require('../middleware/auth');
const { layTrungTamHanhDong } = require('../services/actionCenterService');

// requireRole() không tham số — CHỈ admin (middleware/auth.js: admin luôn qua, vai trò khác phải nằm
// trong danh sách truyền vào mới qua, danh sách rỗng nên luôn bị chặn 403).
router.get('/danh-sach', requireRole(), async (req, res) => {
  try {
    const ketQua = await layTrungTamHanhDong(req.session.user);
    res.json(ketQua);
  } catch (err) {
    console.error('[TrungTamHanhDong] Lỗi lấy danh sách:', err.stack || err.message);
    res.status(500).json({ error: 'Lỗi lấy danh sách hành động cần xử lý' });
  }
});

// C2 (11/10/2026): đánh dấu "Đã xử lý" cho 1 cảnh báo Y6 (NHAN_LAU) / L2 (VAN_CHUYEN). giaTri = giá trị đang thấy lúc bấm — dữ liệu
// đổi tiếp thì cảnh báo hiện lại. Kiểm phạm vi Xưởng theo mã đơn (khoá bắt đầu bằng mã đơn).
router.post('/da-xu-ly', requireRole(), (req, res) => {
  const { loai, khoa, giaTri, ghiChu } = req.body || {};
  // DON_NHIEU_AO (17/10/2026): "DonNhieuAo cần xử lý" — services/actionCenterService.js#layDonNhieuAoCanXuLy.
  // UU_TIEN (22/10/2026): "Đơn ưu tiên chưa xử lý" — khoá = mã đơn, giá trị = trạng thái lúc bấm (actionCenterService#layDonUuTienCanHien).
  if (!['NHAN_LAU', 'VAN_CHUYEN', 'DON_NHIEU_AO', 'UU_TIEN'].includes(loai) || !khoa) return res.status(400).json({ error: 'Thiếu loại/khoá cảnh báo' });
  const sttKey = String(khoa).split('|')[0];
  if (!require('../services/orderService').phamViDon(req.session.user)(sttKey)) return res.status(404).json({ error: 'Không tìm thấy đơn' });
  require('../services/nhatKyDbService').danhDauDaXuLy({
    loai, khoa: String(khoa), giaTri: String(giaTri ?? ''), nguoi: req.session.user.ten,
    luc: require('../services/dateUtils').thoiGianVNISOString(), ghiChu: String(ghiChu || '').slice(0, 500),
  });
  res.json({ ok: true });
});

// ---------- ĐƠN CẦN CHECK (14/10/2026, theo yêu cầu người dùng) — CHỈ superadmin: ghi chú nhanh 1 hay nhiều đơn cần kiểm tra cho các
// superadmin khác xem ngay ở Trung tâm hành động. Mỗi mã đơn phải tồn tại; "Đã check" thì rời danh sách, vẫn lưu.
const nhatKyDbService = require('../services/nhatKyDbService');
const orderService = require('../services/orderService');
const { thoiGianVNISOString } = require('../services/dateUtils');
const SO_MA_TOI_DA = 30;

// body -> { sttKeys, noiDung, ghiChu } đã làm sạch, hoặc { loi }.
async function docGhiChuCanCheck(body) {
  const b = body || {};
  const noiDung = String(b.noiDung || '').trim().slice(0, 3000);
  const ghiChu = String(b.ghiChu || '').trim().slice(0, 3000);
  if (!noiDung) return { loi: 'Chưa nhập nội dung cần kiểm tra.' };
  const { rows } = await orderService.getAll();
  const coDon = new Set(rows.map(r => r.STT_Key));
  // Mã đơn có thể chứa dấu phẩy (vd "9G13,2") nên không tách theo phẩy; người dùng gõ "A1,B2" mà "A1,B2" không phải 1 mã nhưng từng phần
  // đều là mã có thật -> tách ra.
  const sttKeys = [...new Set((Array.isArray(b.sttKeys) ? b.sttKeys : []).map(k => String(k).trim()).filter(Boolean)
    .flatMap(k => (coDon.has(k) || !k.includes(',') || !k.split(',').every(p => coDon.has(p.trim())) ? [k] : k.split(',').map(p => p.trim()))))];
  if (!sttKeys.length) return { loi: 'Nhập ít nhất 1 mã đơn.' };
  if (sttKeys.length > SO_MA_TOI_DA) return { loi: `Tối đa ${SO_MA_TOI_DA} mã đơn cho 1 ghi chú.` };
  const khongCo = sttKeys.filter(k => !coDon.has(k));
  if (khongCo.length) return { loi: `Không tìm thấy đơn: ${khongCo.join(', ')}` };
  return { sttKeys, noiDung, ghiChu };
}

router.get('/don-can-check', requireExactRole('superadmin'), async (req, res) => {
  const daCheck = req.query.daCheck === '1';
  const { rows } = await orderService.getAll();
  res.json(await require('../services/actionCenterService').ganThongTinDonCanCheck(nhatKyDbService.layDonCanCheck(daCheck, daCheck ? 100 : 200), rows));
});

router.post('/don-can-check', requireExactRole('superadmin'), async (req, res) => {
  const g = await docGhiChuCanCheck(req.body);
  if (g.loi) return res.status(400).json({ error: g.loi });
  const id = nhatKyDbService.themDonCanCheck({ ...g, nguoi: req.session.user.ten, luc: thoiGianVNISOString() });
  res.json({ ok: true, id });
});

router.put('/don-can-check/:id', requireExactRole('superadmin'), async (req, res) => {
  const g = await docGhiChuCanCheck(req.body);
  if (g.loi) return res.status(400).json({ error: g.loi });
  const doi = nhatKyDbService.suaDonCanCheck(Number(req.params.id), { ...g, nguoi: req.session.user.ten, luc: thoiGianVNISOString() });
  if (!doi) return res.status(404).json({ error: 'Ghi chú không còn (đã có người bấm Đã check).' });
  res.json({ ok: true });
});

router.post('/don-can-check/:id/da-check', requireExactRole('superadmin'), (req, res) => {
  const ketQua = String((req.body || {}).ketQua || '').trim().slice(0, 3000);
  const doi = nhatKyDbService.danhDauDaCheck(Number(req.params.id), { nguoi: req.session.user.ten, luc: thoiGianVNISOString(), ketQua });
  if (!doi) return res.status(404).json({ error: 'Ghi chú không còn (đã có người bấm Đã check).' });
  res.json({ ok: true });
});

module.exports = router;
