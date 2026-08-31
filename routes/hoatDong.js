const express = require('express');
const router = express.Router();
const { layHoatDongCuaToi } = require('../services/logService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin); // mọi vai trò đăng nhập đều xem được hoạt động của CHÍNH MÌNH

// Không nhận tham số 'nguoiDung' từ client — luôn lấy đúng người đang đăng nhập (req.session.user),
// tránh việc 1 tài khoản xem được hoạt động của tài khoản khác qua sửa query string.
router.get('/cua-toi', async (req, res) => {
  const { tuNgay, denNgay } = req.query;
  const ketQua = await layHoatDongCuaToi({ nguoiDung: req.session.user.ten, tuNgay, denNgay });
  res.json(ketQua);
});

module.exports = router;
