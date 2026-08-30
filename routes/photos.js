const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const orderService = require('../services/orderService');
const storageService = require('../services/storageService');
const { ghiLog } = require('../services/logService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// Mỗi "mốc nghiệp vụ" ghi URL vào đúng cột tương ứng trong Sheet.
// LƯU Ý: Sheet thật KHÔNG có cột Anh_Dong_Goi_URL/Anh_File_Theu_URL/Anh_Da_San_Xuat_URL (khác với
// bản thiết kế mẫu ban đầu) — muốn dùng các mốc "dong_goi"/"ve_file"/"da_san_xuat" cần tự thêm các
// cột này vào Don_Hang_ALL trước.
const COT_ANH_THEO_MOC = {
  dong_goi: 'Anh_Dong_Goi_URL',
  da_san_xuat: 'Anh_Da_San_Xuat_URL', // bổ sung 31/08/2026 — ảnh chụp ngay khi vừa chạy máy xong
  mau: 'DUONG_DAN_URL',
  mockup: 'MOCKUP',
  ve_file: 'Anh_File_Theu_URL', // bổ sung 26/08/2026 — ảnh file thêu do ve_file upload sau khi vẽ file xong, để san_xuat xem trước khi chọn chỉ
};

// 2 mốc dưới đây KHÔNG chỉ lưu ảnh — mỗi mốc CHÍNH LÀ 1 hành động "chụp ảnh bằng chứng kèm chuyển
// giai đoạn": tự động chuyển TINH_TRANG trong CÙNG 1 lần ghi với việc lưu URL ảnh. Yêu cầu đơn ĐANG
// ở đúng "yeuCau" trước khi chụp — kiemTraTinhHopLy() trong orderService.update() KHÔNG tự chặn việc
// này (không phải 1 trong 3 quy tắc của nó) nên phải tự kiểm tra ở đây. Mở cho CẢ 4 vai trò (không
// giới hạn gì thêm ngoài requireLogin ở trên) — dùng ở cả 2 tab "Chụp ảnh đã sản xuất"/"Chụp ảnh đóng
// gói" (scan.html) lẫn 2 nút tải ảnh đơn lẻ tương ứng (order.html, admin).
//   dong_goi     (bổ sung 26/08/2026) — "Ảnh đóng gói": Đã sản xuất -> Đã đóng gói
//   da_san_xuat  (bổ sung 31/08/2026) — "Ảnh đã sản xuất": Đang chạy máy -> Đã sản xuất
const MOC_TU_DONG_CHUYEN_TRANG_THAI = {
  dong_goi: { yeuCau: 'Đã sản xuất', chuyenSang: 'Đã đóng gói' },
  da_san_xuat: { yeuCau: 'Đang chạy máy', chuyenSang: 'Đã sản xuất' },
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
      error: `Đơn "${sttKey}" đang ở trạng thái "${row.TINH_TRANG}" — chỉ chụp ảnh được khi đơn đang ở "${chuyenTuDong.yeuCau}".`,
    });
  }

  // Chỉ nhận ảnh (giữ nguyên giới hạn 10MB của multer phía trên)
  if (!req.file.mimetype || !req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'File gửi lên không phải là ảnh' });
  }

  // Ảnh lưu trên MinIO theo cấu trúc orders/{sttKey}/{uuid}-{tenFile} — mỗi đơn 1 "folder" ảo.
  // Sheet chỉ lưu URL proxy ổn định qua API của app; ảnh gốc là object riêng tư + presign khi cần.
  const now = new Date();
  const tenFile = `${sttKey}_${moc}_${Date.now()}.jpg`;
  const objectKey = storageService.taoObjectKeyDonHang(sttKey, tenFile);

  let url;
  try {
    await storageService.uploadImageBuffer(req.file.buffer, objectKey, req.file.mimetype);
    url = storageService.objectKeyToProxyUrl(objectKey);
  } catch (err) {
    console.error('[MinIO] Upload ảnh thất bại:', err.message);
    return res.status(502).json({ error: 'Lưu ảnh lên kho lưu trữ thất bại — vui lòng thử lại' });
  }

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

// Proxy đọc ảnh từ MinIO — URL dạng /api/photos/file/orders/{sttKey}/{ten-file}.
// Ảnh là object riêng tư; chỉ user đã đăng nhập mới xem được (session cookie đi kèm
// tự động vì cùng origin). URL này ổn định, lưu lâu dài trong Sheet không lo hết hạn
// như presigned URL.
router.get('/file/*', async (req, res) => {
  const objectKey = decodeURIComponent(req.path.replace(/^\/file\//, ''));

  // Chỉ cho đọc object dưới prefix orders/ — tránh dùng endpoint này đọc tùy ý toàn bộ bucket
  if (!objectKey.startsWith('orders/') || objectKey.includes('..')) {
    return res.status(400).json({ error: 'Đường dẫn ảnh không hợp lệ' });
  }

  let result;
  try {
    result = await storageService.getObjectStream(objectKey);
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ error: 'Không tìm thấy ảnh' });
    }
    console.error('[MinIO] Đọc ảnh thất bại:', err.message);
    return res.status(502).json({ error: 'Đọc ảnh từ kho lưu trữ thất bại' });
  }

  res.setHeader('Content-Type', result.ContentType || 'application/octet-stream');
  if (result.ContentLength) res.setHeader('Content-Length', result.ContentLength);
  result.Body.pipe(res);
});

module.exports = router;
