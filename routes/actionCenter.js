const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
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
  if (!['NHAN_LAU', 'VAN_CHUYEN'].includes(loai) || !khoa) return res.status(400).json({ error: 'Thiếu loại/khoá cảnh báo' });
  const sttKey = String(khoa).split('|')[0];
  if (!require('../services/orderService').phamViDon(req.session.user)(sttKey)) return res.status(404).json({ error: 'Không tìm thấy đơn' });
  require('../services/nhatKyDbService').danhDauDaXuLy({
    loai, khoa: String(khoa), giaTri: String(giaTri ?? ''), nguoi: req.session.user.ten,
    luc: require('../services/dateUtils').thoiGianVNISOString(), ghiChu: String(ghiChu || '').slice(0, 500),
  });
  res.json({ ok: true });
});

module.exports = router;
