const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const orderService = require('../services/orderService');
const storageService = require('../services/storageService');
const { taiAnh } = require('../services/anhNguonService');
const { ghiLog } = require('../services/logService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// Mỗi "mốc nghiệp vụ" ghi URL vào đúng cột tương ứng trong Sheet.
// LƯU Ý: Sheet thật KHÔNG có cột Anh_File_Theu_URL/Anh_Da_San_Xuat_URL/Anh_Da_Dan_Tem_URL (khác với
// bản thiết kế mẫu ban đầu) — muốn dùng các mốc "ve_file"/"da_san_xuat"/"da_dan_tem" cần tự thêm các
// cột này vào Don_Hang_ALL trước.
// Mốc "dong_goi" (Ảnh đóng gói, Anh_Dong_Goi_URL) ĐÃ XOÁ 09/09/2026 lần 3 cùng lúc xoá trạng thái "Đã
// đóng gói" (theo yêu cầu người dùng — xem data/pipelineTinhTrang.js).
// Mốc "da_dan_tem" (bổ sung 09/09/2026 lần 4, theo yêu cầu người dùng) — THAY THẾ chế độ "Quét mã QR
// Tracking" cũ (gọi GKE thật, đã xoá — xem public/scan.html) bằng xác nhận thuần ảnh: "Đã sản xuất" ->
// "ĐÃ DÁN TEM", KHÔNG gọi GKE, KHÔNG tạo mã tracking thật. Cơ chế GKE (Mua Tracking, IN LABEL, trang
// Tracking) vẫn giữ nguyên, hoàn toàn tách biệt khỏi mốc này.
const COT_ANH_THEO_MOC = {
  da_san_xuat: 'Anh_Da_San_Xuat_URL', // bổ sung 31/08/2026 — ảnh chụp ngay khi vừa chạy máy xong
  da_dan_tem: 'Anh_Da_Dan_Tem_URL', // bổ sung 09/09/2026 lần 4 — ảnh xác nhận đã dán tem lên kiện hàng
  mau: 'DUONG_DAN_URL',
  mockup: 'MOCKUP',
  ve_file: 'Anh_File_Theu_URL', // bổ sung 26/08/2026 — ảnh file thêu do ve_file upload sau khi vẽ file xong, để san_xuat xem trước khi chọn chỉ
};

// Mốc dưới đây KHÔNG chỉ lưu ảnh — CHÍNH LÀ 1 hành động "chụp ảnh bằng chứng kèm chuyển giai đoạn": tự
// động chuyển TRANG_THAI_XUONG trong CÙNG 1 lần ghi với việc lưu URL ảnh. Yêu cầu đơn ĐANG ở đúng
// "yeuCau" trước khi chụp — kiemTraTinhHopLy() trong orderService.update() KHÔNG tự chặn việc này
// (không phải 1 trong 3 quy tắc của nó) nên phải tự kiểm tra ở đây. Mở cho CẢ 4 vai trò (không giới
// hạn gì thêm ngoài requireLogin ở trên) — dùng ở cả 2 tab "Chụp ảnh đã sản xuất"/"Chụp ảnh ĐÃ DÁN TEM"
// (scan.html) lẫn nút tải ảnh đơn lẻ tương ứng (order.html, admin).
//   da_san_xuat  (bổ sung 31/08/2026) — "Ảnh đã sản xuất": Đang chạy máy -> Đã sản xuất
//   da_dan_tem   (bổ sung 09/09/2026 lần 4) — "Ảnh ĐÃ DÁN TEM": Đã sản xuất -> ĐÃ DÁN TEM
const MOC_TU_DONG_CHUYEN_TRANG_THAI = {
  da_san_xuat: { yeuCau: 'Đang chạy máy', chuyenSang: 'Đã sản xuất' },
  da_dan_tem: { yeuCau: 'Đã sản xuất', chuyenSang: 'ĐÃ DÁN TEM' },
};

// Bổ sung 09/09/2026 lần 5, theo yêu cầu người dùng: đơn CHƯA có thông tin Tracking thật thì không
// được chuyển sang "ĐÃ DÁN TEM" — dù orderService.update() (gọi ở /upload bên dưới) đã tự chặn việc
// GHI rồi, kiểm tra sớm ở CẢ /kiem-tra lẫn /upload để không lãng phí 1 lần chụp ảnh/tải ảnh lên cho đơn
// chắc chắn sẽ bị từ chối. Từ 12/09/2026 lần 14, TRACKING_ID không còn khi nào mang giá trị placeholder
// "chờ tem" nữa (chuyển hẳn sang cột TAM_THOI, xem services/trackingAutoService.js) nên chỉ cần kiểm
// tra rỗng/không rỗng.
function thieuTrackingThat(row) {
  return !row.TRACKING_ID;
}

// Kiểm tra ĐỦ ĐIỀU KIỆN chụp ảnh cho 1 đơn — KHÔNG cần file ảnh. Dùng NGAY SAU khi quét QR sống để
// xác định đơn (public/scan.html, mode photo_san_xuat/photo_da_dan_tem — xem
// docs/superpowers/specs/2026-09-07-tach-quet-chup-anh-design.md), TRƯỚC KHI mở camera chụp thật —
// tránh lãng phí 1 lần chụp cho đơn không hợp lệ (sai trạng thái/không tồn tại).
// CỐ Ý không dùng GET /orders/:sttKey — route đó ẩn hẳn (404) đơn "Đang chạy máy" của san_xuat KHÁC
// (locDonDangChayMayTheoNguoiVanHanh), không áp dụng ở đây vì tính năng chụp ảnh mở cho CẢ 4 vai trò,
// không phân biệt ai đang vận hành máy — dùng lại ĐÚNG logic kiểm tra của POST /upload bên dưới
// (trừ phần lưu file), giữ 2 nơi nhất quán.
router.post('/kiem-tra', async (req, res) => {
  const { sttKey, moc } = req.body;
  const user = req.session.user;
  if (!sttKey) return res.status(400).json({ error: 'Thiếu mã đơn hàng' });

  const cotAnh = COT_ANH_THEO_MOC[moc];
  if (!cotAnh) return res.status(400).json({ error: 'Mốc ảnh không hợp lệ: ' + moc });

  const { headers, row } = await orderService.getByKey(sttKey, { fresh: true });
  // Đơn khác Xưởng coi như không tồn tại (bổ sung 13/09/2026).
  if (!row || !orderService.coQuyenTheoXuong(user, row)) return res.status(404).json({ error: 'Không tìm thấy đơn hàng: ' + sttKey });
  if (!headers.includes(cotAnh)) {
    return res.status(400).json({ error: `Sheet chưa có cột '${cotAnh}' — cần thêm cột này vào Don_Hang_ALL trước khi dùng mốc ảnh "${moc}"` });
  }

  const chuyenTuDong = MOC_TU_DONG_CHUYEN_TRANG_THAI[moc];
  if (chuyenTuDong && row.TRANG_THAI_XUONG !== chuyenTuDong.yeuCau) {
    return res.status(400).json({
      error: `Đơn "${sttKey}" đang ở trạng thái "${row.TRANG_THAI_XUONG}" — chỉ chụp ảnh được khi đơn đang ở "${chuyenTuDong.yeuCau}".`,
    });
  }
  if (chuyenTuDong && chuyenTuDong.chuyenSang === 'ĐÃ DÁN TEM' && thieuTrackingThat(row)) {
    return res.status(400).json({
      error: `Đơn "${sttKey}" chưa có thông tin Tracking (mã vận đơn thật) — phải mua tracking trước khi chuyển sang "ĐÃ DÁN TEM".`,
    });
  }

  const [daGanKH] = await orderService.ganTenKhachHang([row]);
  res.json({ sttKey: row.STT_Key, tieuDe: orderService.tieuDeSanPham(row), tenKhachHang: daGanKH.TenKhachHang });
});

// Vì mã đơn đã lấy từ bước quét QR ngay trước đó trong cùng luồng thao tác (sttKey gửi kèm trong
// form), KHÔNG cần AI đọc ảnh để nhận diện mã — nhanh hơn, không tốn quota Gemini, chính xác 100%.
router.post('/upload', upload.single('photo'), async (req, res) => {
  const { sttKey, moc } = req.body;
  const user = req.session.user;

  if (!req.file) return res.status(400).json({ error: 'Thiếu file ảnh' });
  if (!sttKey) return res.status(400).json({ error: 'Thiếu mã đơn hàng' });

  const cotAnh = COT_ANH_THEO_MOC[moc];
  if (!cotAnh) return res.status(400).json({ error: 'Mốc ảnh không hợp lệ: ' + moc });

  const { headers, row } = await orderService.getByKey(sttKey, { fresh: true }); // fresh: mốc da_san_xuat kiểm tra TRANG_THAI_XUONG ngay dưới đây, không được dùng bản cache cũ
  // Đơn khác Xưởng coi như không tồn tại (bổ sung 13/09/2026).
  if (!row || !orderService.coQuyenTheoXuong(user, row)) return res.status(404).json({ error: 'Không tìm thấy đơn hàng: ' + sttKey });
  if (!headers.includes(cotAnh)) {
    return res.status(400).json({ error: `Sheet chưa có cột '${cotAnh}' — cần thêm cột này vào Don_Hang_ALL trước khi dùng mốc ảnh "${moc}"` });
  }

  const chuyenTuDong = MOC_TU_DONG_CHUYEN_TRANG_THAI[moc];
  if (chuyenTuDong && row.TRANG_THAI_XUONG !== chuyenTuDong.yeuCau) {
    return res.status(400).json({
      error: `Đơn "${sttKey}" đang ở trạng thái "${row.TRANG_THAI_XUONG}" — chỉ chụp ảnh được khi đơn đang ở "${chuyenTuDong.yeuCau}".`,
    });
  }
  if (chuyenTuDong && chuyenTuDong.chuyenSang === 'ĐÃ DÁN TEM' && thieuTrackingThat(row)) {
    return res.status(400).json({
      error: `Đơn "${sttKey}" chưa có thông tin Tracking (mã vận đơn thật) — phải mua tracking trước khi chuyển sang "ĐÃ DÁN TEM".`,
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
  if (chuyenTuDong) updates.TRANG_THAI_XUONG = chuyenTuDong.chuyenSang;

  let updated;
  try {
    // quaAnh: true — cho phép đặt thẳng TRANG_THAI_XUONG="Đã sản xuất" ở đây, vì đây CHÍNH LÀ luồng
    // chụp ảnh QR hợp lệ mà orderService.update() bắt buộc phải đi qua cho trạng thái này (xem
    // kiemTraCongAnhBatBuoc trong orderService.js).
    // headers/row đã đọc thật ở trên (dòng 53), khỏi đọc lại lần nữa (xem orderService.update)
    updated = await orderService.update(sttKey, updates, user, { quaAnh: true, donDaDoc: { headers, row } });
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

// ============================================================
// PROXY ẢNH NGOÀI (Drive/Gemini/link công khai khác) — bổ sung 13/09/2026, theo yêu cầu người dùng.
// Ảnh CŨ (trước khi có MinIO) lưu thẳng link Drive/Gemini/HTTP thường trong Sheet — trình duyệt KHÔNG
// tải được link xem trước Drive (trả về trang HTML, không phải file ảnh) hay link chia sẻ Gemini (cần
// trình duyệt ảo render) làm <img src> trực tiếp, nên các đơn này không hiện được ảnh đại diện dù link
// vẫn "sống" bình thường. Dùng LẠI ĐÚNG services/anhNguonService.js#taiAnh() đã có sẵn cho tính năng
// IN ĐƠN (PDF) — xử lý được Drive/Gemini/MinIO/HTTP thường trong CÙNG 1 hàm, không viết lại logic nhận
// diện nguồn ảnh ở đây. KHÔNG ghi lại URL đã resolve vào Sheet (theo yêu cầu người dùng — Sheet là dữ
// liệu gốc, không sửa qua đường này) — chỉ cache TRONG BỘ NHỚ TIẾN TRÌNH để đỡ gọi lại Drive API/dựng
// lại trang Gemini mỗi lần có người xem lại ĐÚNG 1 ảnh đó (tránh lặp lại vấn đề tốn quota như từng gặp
// với Google Sheets API).
// ============================================================
const _cacheAnhNgoai = new Map(); // url -> { buffer, contentType, luuLucNao } — Map giữ thứ tự chèn, dùng làm LRU (xem layTuCacheAnhNgoai/luuVaoCacheAnhNgoai)
const THOI_GIAN_GIU_CACHE_ANH_NGOAI_MS = 6 * 60 * 60 * 1000; // 6 giờ — ảnh cũ hiếm khi đổi nội dung, đủ dài để giảm tải Drive/Gemini
const SO_ANH_TOI_DA_TRONG_CACHE = 100; // giới hạn bộ nhớ — loại ảnh LÂU KHÔNG AI XEM LẠI nhất khi vượt ngưỡng

function layTuCacheAnhNgoai(url) {
  const daCache = _cacheAnhNgoai.get(url);
  if (!daCache) return null;
  if (Date.now() - daCache.luuLucNao > THOI_GIAN_GIU_CACHE_ANH_NGOAI_MS) {
    _cacheAnhNgoai.delete(url);
    return null;
  }
  // Xoá rồi set lại — đưa key này lên CUỐI thứ tự chèn của Map, đúng ngữ nghĩa "vừa dùng gần nhất" cho LRU.
  _cacheAnhNgoai.delete(url);
  _cacheAnhNgoai.set(url, daCache);
  return daCache;
}

function luuVaoCacheAnhNgoai(url, buffer, contentType) {
  _cacheAnhNgoai.delete(url);
  _cacheAnhNgoai.set(url, { buffer, contentType, luuLucNao: Date.now() });
  while (_cacheAnhNgoai.size > SO_ANH_TOI_DA_TRONG_CACHE) {
    _cacheAnhNgoai.delete(_cacheAnhNgoai.keys().next().value); // key đầu tiên = lâu không được dùng lại nhất
  }
}

// Nhận diện Content-Type qua magic bytes — cùng kỹ thuật routes/reports.js#nhanDangDinhDangAnh() dùng
// cho PDF, viết riêng 1 bản ở đây (khác định dạng trả về: Content-Type thật thay vì mã ngắn 'png'/'jpeg')
// để không phải export/import chéo giữa 2 route học không liên quan tới nhau.
function nhanDangContentTypeAnh(buffer) {
  if (buffer && buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer && buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  return 'application/octet-stream';
}

router.get('/anh-ngoai', async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(String(url))) {
    return res.status(400).json({ error: 'Thiếu hoặc sai định dạng tham số url' });
  }

  const daCache = layTuCacheAnhNgoai(url);
  if (daCache) {
    res.setHeader('Content-Type', daCache.contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.end(daCache.buffer);
  }

  let buffer;
  try {
    buffer = await taiAnh(url);
  } catch (err) {
    console.error('[Ảnh ngoài] Lỗi tải ảnh:', url, '-', err.message);
    buffer = null;
  }
  if (!buffer) {
    return res.status(502).json({ error: 'Không tải được ảnh từ nguồn gốc' });
  }

  const contentType = nhanDangContentTypeAnh(buffer);
  luuVaoCacheAnhNgoai(url, buffer, contentType);

  res.setHeader('Content-Type', contentType);
  // private (không cache ở proxy/CDN trung gian, ảnh có thể riêng tư) + max-age 1 giờ ở TRÌNH DUYỆT —
  // giảm thêm request lặp lại tới CHÍNH server này (ngoài cache trong bộ nhớ tiến trình ở trên) khi
  // cùng 1 người dùng xem lại danh sách đơn nhiều lần trong phiên làm việc.
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.end(buffer);
});

module.exports = router;
