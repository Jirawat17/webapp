const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const orderService = require('../services/orderService');
const driveService = require('../services/driveService');
const { ghiLog } = require('../services/logService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// Mỗi "mốc nghiệp vụ" ghi URL vào đúng cột tương ứng trong Sheet.
// LƯU Ý: Sheet thật KHÔNG có cột Anh_Dong_Goi_URL/Anh_File_Theu_URL (khác với bản thiết kế mẫu ban
// đầu) — muốn dùng 2 mốc "dong_goi"/"ve_file" cần tự thêm 2 cột này vào Don_Hang_ALL trước.
const COT_ANH_THEO_MOC = {
  dong_goi: 'Anh_Dong_Goi_URL',
  mau: 'DUONG_DAN_URL',
  mockup: 'MOCKUP',
  ve_file: 'Anh_File_Theu_URL', // bổ sung 26/08/2026 — ảnh file thêu do ve_file upload sau khi vẽ file xong, để san_xuat xem trước khi chọn chỉ
};

// Mốc "dong_goi" (bổ sung 26/08/2026, theo yêu cầu người dùng) giờ KHÔNG chỉ lưu ảnh — nó CHÍNH LÀ
// hành động "chụp ảnh hoàn thành trước khi đóng gói": tự động chuyển TINH_TRANG trong CÙNG 1 lần ghi
// với việc lưu URL ảnh. Yêu cầu đơn ĐANG ở đúng "yeuCau" trước khi chụp — kiemTraTinhHopLy() trong
// orderService.update() KHÔNG tự chặn việc này (không phải 1 trong 3 quy tắc của nó) nên phải tự
// kiểm tra ở đây. Mở cho CẢ 4 vai trò (không giới hạn gì thêm ngoài requireLogin ở trên) — dùng ở cả
// màn "Chụp ảnh hoàn thành hàng loạt" (scan.html) lẫn nút tải ảnh đơn lẻ (order.html, admin).
const MOC_TU_DONG_CHUYEN_TRANG_THAI = {
  dong_goi: { yeuCau: 'Đã sản xuất', chuyenSang: 'Đã đóng gói' },
};

// Vì mã đơn đã lấy từ bước quét QR ngay trước đó trong cùng luồng thao tác (sttKey gửi kèm trong
// form), KHÔNG cần AI đọc ảnh để nhận diện mã — nhanh hơn, không tốn quota Gemini, chính xác 100%.
// (Với màn "Chụp ảnh hoàn thành hàng loạt", việc đọc mã QR trong ảnh diễn ra ở TRÌNH DUYỆT bằng
// html5-qrcode.scanFile() trước khi gọi API này — server luôn nhận sttKey đã giải mã sẵn, không tự
// đọc ảnh.)
router.post('/upload', upload.single('photo'), async (req, res) => {
  const { sttKey, moc } = req.body;
  const user = req.session.user;

  if (!req.file) return res.status(400).json({ error: 'Thiếu file ảnh' });
  if (!sttKey) return res.status(400).json({ error: 'Thiếu mã đơn hàng' });

  const cotAnh = COT_ANH_THEO_MOC[moc];
  if (!cotAnh) return res.status(400).json({ error: 'Mốc ảnh không hợp lệ: ' + moc });

  const { headers, row } = await orderService.getByKey(sttKey, { fresh: true }); // fresh: mốc dong_goi kiểm tra TINH_TRANG ngay dưới đây, không được dùng bản cache cũ
  if (!row) return res.status(404).json({ error: 'Không tìm thấy đơn hàng: ' + sttKey });
  if (!headers.includes(cotAnh)) {
    return res.status(400).json({ error: `Sheet chưa có cột '${cotAnh}' — cần thêm cột này vào Don_Hang_ALL trước khi dùng mốc ảnh "${moc}"` });
  }

  const chuyenTuDong = MOC_TU_DONG_CHUYEN_TRANG_THAI[moc];
  if (chuyenTuDong && row.TINH_TRANG !== chuyenTuDong.yeuCau) {
    return res.status(400).json({
      error: `Đơn "${sttKey}" đang ở trạng thái "${row.TINH_TRANG}" — chỉ chụp ảnh hoàn thành được khi đơn đang ở "${chuyenTuDong.yeuCau}".`,
    });
  }

  // Folder theo ngày, format YYYY-MM-DD để sắp xếp đúng thứ tự trên Drive
  const now = new Date();
  const tenThuMuc = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const folderId = await driveService.getOrCreateFolder(tenThuMuc);

  const tenFile = `${sttKey}_${moc}_${Date.now()}.jpg`;
  const url = await driveService.uploadImageBuffer(req.file.buffer, tenFile, folderId, req.file.mimetype);

  const updates = { [cotAnh]: url, NguoiCapNhatCuoi: user.ten, ThoiGianCapNhatCuoi: now.toISOString() };
  if (chuyenTuDong) updates.TINH_TRANG = chuyenTuDong.chuyenSang;

  let updated;
  try {
    updated = await orderService.update(sttKey, updates, user);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  await ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'UPLOAD_ANH',
    sttKey, chiTiet: { moc, url, ...(chuyenTuDong ? { tu: chuyenTuDong.yeuCau, sang: chuyenTuDong.chuyenSang } : {}) },
  });
  res.json({ ok: true, url, don: updated });
});

module.exports = router;
