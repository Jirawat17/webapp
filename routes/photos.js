const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const orderService = require('../services/orderService');
const driveService = require('../services/driveService');
const { ghiLog } = require('../services/logService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// Mỗi "mốc nghiệp vụ" ghi URL vào đúng cột tương ứng trong Sheet
const COT_ANH_THEO_MOC = {
  dong_goi: 'Anh_Dong_Goi_URL',
  mau: 'URL_Hinh_Anh',
  mockup: 'URL_Mockup',
};

// Vì mã đơn đã lấy từ bước quét QR ngay trước đó trong cùng luồng thao tác (sttKey gửi kèm trong
// form), KHÔNG cần AI đọc ảnh để nhận diện mã — nhanh hơn, không tốn quota Gemini, chính xác 100%.
router.post('/upload', upload.single('photo'), async (req, res) => {
  const { sttKey, moc } = req.body;
  const user = req.session.user;

  if (!req.file) return res.status(400).json({ error: 'Thiếu file ảnh' });
  if (!sttKey) return res.status(400).json({ error: 'Thiếu mã đơn hàng' });

  const cotAnh = COT_ANH_THEO_MOC[moc];
  if (!cotAnh) return res.status(400).json({ error: 'Mốc ảnh không hợp lệ: ' + moc });

  const { row } = await orderService.getByKey(sttKey);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy đơn hàng: ' + sttKey });

  // Folder theo ngày, format YYYY-MM-DD để sắp xếp đúng thứ tự trên Drive
  const now = new Date();
  const tenThuMuc = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const folderId = await driveService.getOrCreateFolder(tenThuMuc);

  const tenFile = `${sttKey}_${moc}_${Date.now()}.jpg`;
  const url = await driveService.uploadImageBuffer(req.file.buffer, tenFile, folderId, req.file.mimetype);

  const updates = { [cotAnh]: url, NguoiCapNhatCuoi: user.ten, ThoiGianCapNhatCuoi: new Date().toISOString() };
  if (moc === 'dong_goi') {
    updates.Ngay_Ship = now.toLocaleDateString('vi-VN');
  }
  const updated = await orderService.update(sttKey, updates);

  await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'UPLOAD_ANH', sttKey, chiTiet: { moc, url } });
  res.json({ ok: true, url, don: updated });
});

module.exports = router;
