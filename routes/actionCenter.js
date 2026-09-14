const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const { layTrungTamHanhDong } = require('../services/actionCenterService');

// requireRole() không tham số — CHỈ admin (middleware/auth.js: admin luôn qua, vai trò khác phải nằm
// trong danh sách truyền vào mới qua, danh sách rỗng nên luôn bị chặn 403).
router.get('/danh-sach', requireRole(), async (req, res) => {
  try {
    const ketQua = await layTrungTamHanhDong();
    res.json(ketQua);
  } catch (err) {
    console.error('[TrungTamHanhDong] Lỗi lấy danh sách:', err.stack || err.message);
    res.status(500).json({ error: 'Lỗi lấy danh sách hành động cần xử lý' });
  }
});

module.exports = router;
