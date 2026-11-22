const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { layCaiDatCanhBaoUuTien } = require('../services/caiDatDbService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin); // GET /: mọi tài khoản đã đăng nhập đều thấy ticker

router.get('/', async (req, res) => {
  const user = req.session.user;
  const caiDat = layCaiDatCanhBaoUuTien();
  const t1Ms = Math.max(0, parseFloat(caiDat.T1_Gio) || 12) * 3600000;
  const t2Ms = Math.max(0, parseFloat(caiDat.T2_Gio) || 24) * 3600000;

  const { rows } = await orderService.getAll();
  const loc = orderService.locTheoXuong(rows, user);
  const now = Date.now();

  const donUuTien = loc
    .filter(r => orderService.laUuTien(r))
    .map(r => {
      const item = { ma: r.STT_Key, sl: r.SO_LUONG || '' };
      if (!item.ma) return null;

      const tsDanh = r.THOI_GIAN_DANH_UU_TIEN ? new Date(r.THOI_GIAN_DANH_UU_TIEN).getTime() : 0;
      // Chỉ kiểm tra T1/T2 nếu có timestamp đánh dấu và đơn chưa đạt "Đã sản xuất"
      if (tsDanh && !r.THOI_GIAN_SAN_XUAT) {
        const elapsed = now - tsDanh;
        if (elapsed >= t2Ms) {
          item.cap = 2;
          item.thongBao = `Thông báo lần 2 - Đơn hàng ${r.STT_Key} là đơn ưu tiên, hãy chạy đơn này sớm nhất, nếu thiếu phôi hoặc thiếu vải đắp hoặc thiếu file thì nhắn lại nhóm chung Zalo ngay.`;
        } else if (elapsed >= t1Ms) {
          item.cap = 1;
          item.thongBao = `Thông báo lần 1 - Đơn hàng ${r.STT_Key} là đơn ưu tiên, hãy chạy đơn này sớm nhất, nếu thiếu phôi hoặc thiếu vải đắp hoặc thiếu file thì nhắn lại nhóm chung Zalo ngay.`;
        }
      }
      return item;
    })
    .filter(Boolean);

  res.json({ donUuTien });
});

module.exports = router;
