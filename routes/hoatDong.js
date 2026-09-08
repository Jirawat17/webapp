const express = require('express');
const router = express.Router();
const { layHoatDongCuaToi, tinhChiTieuCongViec } = require('../services/logService');
const orderService = require('../services/orderService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin); // mọi vai trò đăng nhập đều xem được hoạt động của CHÍNH MÌNH

// Không nhận tham số 'nguoiDung' từ client — luôn lấy đúng người đang đăng nhập (req.session.user),
// tránh việc 1 tài khoản xem được hoạt động của tài khoản khác qua sửa query string.
router.get('/cua-toi', async (req, res) => {
  const { tuNgay, denNgay } = req.query;
  const ketQua = await layHoatDongCuaToi({ nguoiDung: req.session.user.ten, tuNgay, denNgay });

  // Chỉ tiêu công việc theo vai trò (bổ sung 08/09/2026, xem
  // docs/superpowers/specs/2026-09-08-chi-tieu-hoat-dong-theo-vai-tro-design.md) — LUÔN tính đủ cả 3
  // nhóm (san_xuat/ve_file/nguoi_lay_phoi) bất kể vai trò người xem là gì (rẻ, dữ liệu nguồn vốn đã
  // có sẵn), public/hoat-dong.html tự chọn hiển thị đúng nhóm khớp user.vaiTro. slTheoStt (SO_LUONG
  // hiện tại của đơn, đọc cache) đọc Ở ĐÂY (route, không phải logService.js) để logService.js không
  // phụ thuộc ngược orderService — xem tinhChiTieuCongViec() trong logService.js.
  const { rows } = await orderService.getAll();
  const slTheoStt = new Map(rows.map(r => [r.STT_Key, Number(r.SO_LUONG) || 0]));
  ketQua.chiTieu = tinhChiTieuCongViec(ketQua, slTheoStt);

  res.json(ketQua);
});

module.exports = router;
