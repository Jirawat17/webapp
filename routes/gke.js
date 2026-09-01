const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const gkeService = require('../services/gkeService');
const { ghiLog } = require('../services/logService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// Ghi log không chặn phản hồi cho người dùng — giống hệt cách routes/qr.js đang làm.
function ghiKhongCho(promise) {
  promise.catch(err => console.error('[GKE] Lỗi ghi log nền:', err.message));
}

// Tab "Quét mã QR Tracking" (scan.html) — quét mã QR trên tem đã dán (chính là STT_Key), gọi GKE
// Logistics tạo vận đơn thật + lấy tem in, rồi TỰ ĐỘNG mở hộp thoại in ở trình duyệt (client lo,
// xem scan.html). Đơn phải đang đúng "Đã đóng gói" mới cho làm (quyết định cùng người dùng
// 31/08/2026). Mở cho CẢ 4 vai trò — không giới hạn gì thêm ngoài requireLogin ở trên.
router.post('/tracking/quet', async (req, res) => {
  const { sttKey } = req.body;
  const user = req.session.user;

  if (!sttKey) return res.status(400).json({ error: 'Thiếu mã đơn' });

  const { row } = await orderService.getByKey(sttKey, { fresh: true });
  if (!row) {
    ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'GKE_QUET_LOI', sttKey, chiTiet: 'Không tìm thấy đơn' }));
    return res.status(404).json({ error: 'Không tìm thấy đơn hàng: ' + sttKey });
  }
  if (row.TINH_TRANG !== 'Đã đóng gói') {
    ghiKhongCho(ghiLog({
      nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'GKE_QUET_SAI_TRANG_THAI', sttKey,
      chiTiet: { trangThaiHienTai: row.TINH_TRANG },
    }));
    return res.status(400).json({
      error: `Đơn đang ở "${row.TINH_TRANG}" — phải "Đã đóng gói" mới tạo/in được vận đơn GKE.`,
    });
  }

  // Đơn đã có mã vận đơn từ trước (đã quét tab này rồi) thì KHÔNG tạo đơn GKE mới — chỉ in lại
  // đúng tem cũ (xem gkeService.taoDonVaLayTem). Tính trước ở đây để biết log/ghi Sheet đúng nhánh.
  const daCoTruoc = !!row.MA_VAN_DON_ID;

  let ketQuaTem;
  try {
    ketQuaTem = await gkeService.taoDonVaLayTem(row);
  } catch (err) {
    // Lỗi gọi GKE KHÔNG chặn màn quét — trả lỗi rõ ràng để client hiện toast, nhân viên quét lại
    // đơn này sau, các đơn khác vẫn quét bình thường (quyết định cùng người dùng 31/08/2026).
    ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'GKE_TAO_VAN_DON_LOI', sttKey, chiTiet: { loi: err.message } }));
    return res.status(502).json({ error: 'Không tạo/in được vận đơn GKE: ' + err.message });
  }

  if (!daCoTruoc) {
    await orderService.update(sttKey, {
      MA_VAN_DON_ID: ketQuaTem.tracking_num,
      HANG_VAN_CHUYEN: ketQuaTem.delivery_carrier,
    }, user);
  }

  ghiKhongCho(ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro,
    hanhDong: daCoTruoc ? 'GKE_IN_LAI_TEM' : 'GKE_TAO_VAN_DON',
    sttKey, chiTiet: { trackingNum: ketQuaTem.tracking_num, hangVanChuyen: ketQuaTem.delivery_carrier },
  }));

  res.json({
    ok: true,
    daTaoMoi: !daCoTruoc,
    sttKey,
    trackingNum: ketQuaTem.tracking_num,
    hangVanChuyen: ketQuaTem.delivery_carrier,
    labelBase64: ketQuaTem.label_base64,
  });
});

module.exports = router;
