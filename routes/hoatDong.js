const express = require('express');
const router = express.Router();
const { layHoatDongCuaToi, tinhChiTieuCongViec } = require('../services/logService');
const orderService = require('../services/orderService');
const taiKhoanService = require('../services/taiKhoanService');
const { requireLogin, laAdmin } = require('../middleware/auth');

router.use(requireLogin); // mọi vai trò đăng nhập đều xem được hoạt động của CHÍNH MÌNH

// Nhận thêm 'nguoiDung' từ client — CHỈ áp dụng khi người gọi là admin (bổ sung 09/09/2026, theo yêu
// cầu người dùng — admin cần dễ theo dõi hoạt động của BẤT KỲ ai). Validate đúng 1 tài khoản có thật
// đang hoạt động (tránh gõ nhầm tên im lặng trả về rỗng, tưởng nhầm "người này chưa làm gì"). Mọi vai
// trò khác vẫn bị khoá cứng về chính mình như thiết kế cũ — tránh 1 tài khoản xem được hoạt động tài
// khoản khác qua sửa query string.
router.get('/cua-toi', async (req, res) => {
  const { tuNgay, denNgay, nguoiDung } = req.query;
  const nguoiGoi = req.session.user;

  let nguoiXem = { ten: nguoiGoi.ten, vaiTro: nguoiGoi.vaiTro };
  let locDon = null;
  if (laAdmin(nguoiGoi.vaiTro) && nguoiDung) {
    // admin chỉ xem được nhân viên cùng Xưởng, và chỉ các việc trên đơn thuộc Xưởng mình (29/09/2026).
    const trongPhamVi = taiKhoanService.phamViNhanVien(nguoiGoi);
    const dsNhanVien = taiKhoanService.layTatCa();
    const nv = dsNhanVien.find(r => r.Ten === nguoiDung && String(r.KichHoat).toUpperCase() === 'TRUE' && trongPhamVi(r.Xuong));
    if (!nv) return res.status(400).json({ error: `"${nguoiDung}" không phải tài khoản đang hoạt động thuộc Xưởng của bạn` });
    nguoiXem = { ten: nv.Ten, vaiTro: nv.VaiTro };
    if (nv.Ten !== nguoiGoi.ten) locDon = orderService.phamViDon(nguoiGoi);
  }

  const ketQua = await layHoatDongCuaToi({ nguoiDung: nguoiXem.ten, tuNgay, denNgay, vaiTroNguoiXem: nguoiGoi.vaiTro, locDon });
  ketQua.nguoiXem = nguoiXem; // frontend dùng để hiện đúng tiêu đề + đúng nhóm chỉ tiêu công việc

  // Chỉ tiêu công việc theo vai trò (bổ sung 08/09/2026, xem
  // docs/superpowers/specs/2026-09-08-chi-tieu-hoat-dong-theo-vai-tro-design.md) — LUÔN tính đủ cả 3
  // nhóm (san_xuat/ve_file/nguoi_lay_phoi) bất kể vai trò người ĐANG ĐƯỢC XEM (nguoiXem.vaiTro) là gì
  // (rẻ, dữ liệu nguồn vốn đã có sẵn), public/hoat-dong.html tự chọn hiển thị đúng nhóm khớp
  // nguoiXem.vaiTro. slTheoStt (SO_LUONG hiện tại của đơn, đọc cache) đọc Ở ĐÂY (route, không phải
  // logService.js) để logService.js không phụ thuộc ngược orderService — xem tinhChiTieuCongViec()
  // trong logService.js.
  const { rows } = await orderService.getAll();
  const slTheoStt = new Map(rows.map(r => [r.STT_Key, Number(r.SO_LUONG) || 0]));
  ketQua.chiTieu = tinhChiTieuCongViec(ketQua, slTheoStt);

  res.json(ketQua);
});

module.exports = router;
