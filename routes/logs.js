const express = require('express');
const router = express.Router();
const { requireLogin, requireExactRole } = require('../middleware/auth');
const { docDongCuoi } = require('../services/logCapture');

// CHỈ superadmin (bổ sung 23/09/2026, theo yêu cầu người dùng) — log server có thể chứa thông tin nhạy
// cảm (lỗi kèm dữ liệu đơn hàng, mã lỗi API bên thứ 3...), cùng mức nhạy cảm với Settings/Nhân viên.
// Trả JSON (không phải text/plain) — apiFetch() dùng chung toàn app luôn gọi res.json(), trả text thô
// sẽ khiến apiFetch() lỗi parse JSON và mất trắng nội dung (xem public/js/api.js#apiFetch).
router.get('/', requireLogin, requireExactRole('superadmin'), (req, res) => {
  const soDong = Math.min(Number(req.query.soDong) || 500, 5000);
  res.json({ text: docDongCuoi(soDong) });
});

module.exports = router;
