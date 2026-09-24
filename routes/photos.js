const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const sharp = require('sharp');
const orderService = require('../services/orderService');
const storageService = require('../services/storageService');
const { taiDsAnh } = require('../services/anhNguonService');
const { ghiLog } = require('../services/logService');
const { requireLogin, requireExactRole } = require('../middleware/auth');
const { layCaiDatNenAnh, datCaiDatNenAnh } = require('../services/caiDatDbService');

router.use(requireLogin);

// Cấu hình nén ảnh cho 2 chế độ chụp ảnh ở scan.html (bổ sung 23/09/2026, theo yêu cầu người dùng — xem
// public/js/api.js#nenAnhTruocKhiTaiLen). GET mở cho MỌI vai trò đã đăng nhập (ai chụp ảnh ở scan.html
// cũng cần đọc được để nén đúng cấu hình, không chỉ superadmin); POST (đổi giá trị) CHỈ superadmin.
// Rỗng '' = chưa cấu hình → trả nguyên giá trị rỗng, client tự áp mặc định 80%/1600px (xem
// nenAnhTruocKhiTaiLen — tuyChon.chatLuongJpeg/canhDaiToiDa falsy thì dùng hằng số mặc định).
router.get('/cau-hinh-nen', (req, res) => {
  res.json(layCaiDatNenAnh());
});

router.post('/cau-hinh-nen', requireExactRole('superadmin'), (req, res) => {
  const chatLuong = Number(req.body.ChatLuongJpeg);
  const canhDai = Number(req.body.CanhDaiToiDa);
  if (!Number.isInteger(chatLuong) || chatLuong < 10 || chatLuong > 100) {
    return res.status(400).json({ error: 'Chất lượng JPEG phải là số nguyên 10-100.' });
  }
  if (!Number.isInteger(canhDai) || canhDai < 400 || canhDai > 4000) {
    return res.status(400).json({ error: 'Cạnh dài tối đa phải là số nguyên 400-4000.' });
  }
  datCaiDatNenAnh({ ChatLuongJpeg: chatLuong, CanhDaiToiDa: canhDai });
  res.json({ ok: true });
});

// Mỗi "mốc nghiệp vụ" ghi URL vào đúng cột tương ứng — cả 3 cột dưới đây giờ ở SQLite (schema tạo sẵn
// lúc khởi động, xem services/trangThaiDbService.js), luôn có sẵn.
// Mốc "dong_goi" (Ảnh đóng gói, Anh_Dong_Goi_URL) ĐÃ XOÁ 09/09/2026 lần 3 cùng lúc xoá trạng thái "Đã
// đóng gói" (theo yêu cầu người dùng — xem data/pipelineTinhTrang.js).
// Mốc "mau"/"mockup" (ghi DUONG_DAN_URL/MOCKUP) ĐÃ XOÁ 18/09/2026 — 2 cột này giờ thuộc vùng công thức
// sống A:AM của Don_Hang_ALL (người dùng tự cấu trúc lại Sheet), app không còn ghi được vào đó nữa; từ
// giờ 2 ảnh này CHỈ nhập tay ở sheet RAW lúc lên đơn, app chỉ đọc không ghi (theo yêu cầu người dùng,
// xem docs/superpowers/specs/2026-09-18-chuyen-cot-app-ghi-sang-sqlite-design.md).
// Mốc "da_dan_tem" (bổ sung 09/09/2026 lần 4, theo yêu cầu người dùng) — THAY THẾ chế độ "Quét mã QR
// Tracking" cũ (gọi GKE thật, đã xoá — xem public/scan.html) bằng xác nhận thuần ảnh: "Đã sản xuất" ->
// "ĐÃ DÁN TEM", KHÔNG gọi GKE, KHÔNG tạo mã tracking thật. Cơ chế GKE (Mua Tracking, IN LABEL, trang
// Tracking) vẫn giữ nguyên, hoàn toàn tách biệt khỏi mốc này.
const COT_ANH_THEO_MOC = {
  da_san_xuat: 'Anh_Da_San_Xuat_URL', // bổ sung 31/08/2026 — ảnh chụp ngay khi vừa chạy máy xong
  da_dan_tem: 'Anh_Da_Dan_Tem_URL', // bổ sung 09/09/2026 lần 4 — ảnh xác nhận đã dán tem lên kiện hàng
  ve_file: 'Anh_File_Theu_URL', // bổ sung 26/08/2026 — ảnh file thêu do ve_file upload sau khi vẽ file xong, để san_xuat xem trước khi chọn chỉ
  // ve_file_2 (bổ sung 24/09/2026, theo yêu cầu người dùng — không phải đơn nào cũng cần 2 ảnh file
  // thêu) — ô/nút tải ĐỘC LẬP với ve_file ở trên, cùng cơ chế ghi đè khi tải lại, chỉ khác cột lưu.
  ve_file_2: 'Anh_File_Theu_URL_2',
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

  const { row } = await orderService.getByKey(sttKey, { fresh: true });
  // Đơn khác Xưởng coi như không tồn tại (bổ sung 13/09/2026).
  if (!row || !orderService.coQuyenTheoXuong(user, row)) return res.status(404).json({ error: 'Không tìm thấy đơn hàng: ' + sttKey });

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
  const tBatDau = Date.now(); // bổ sung 23/09/2026, theo yêu cầu người dùng — đo thời gian từng bước để
  // biết chính xác khâu nào chậm nếu người dùng vẫn báo "upload lâu" sau các lần sửa trước, thay vì
  // phải đoán tiếp không có bằng chứng thật từ máy chủ đang chạy.
  const { sttKey, moc } = req.body;
  const user = req.session.user;

  if (!req.file) return res.status(400).json({ error: 'Thiếu file ảnh' });
  if (!sttKey) return res.status(400).json({ error: 'Thiếu mã đơn hàng' });

  const cotAnh = COT_ANH_THEO_MOC[moc];
  if (!cotAnh) return res.status(400).json({ error: 'Mốc ảnh không hợp lệ: ' + moc });

  // Đọc QUA CACHE (bổ sung 22/09/2026, theo yêu cầu người dùng cải thiện tốc độ — trước đây fresh:true
  // ở đây, đọc lại TOÀN BỘ tab Don_Hang_ALL (công thức QUERY/VSTACK sống, Google phải tính lại mỗi lần
  // đọc tươi) ngay sau khi /kiem-tra (route trên) VỪA đọc tươi đúng dữ liệu này vài giây trước — tốn
  // thêm ~1-3s cho MỌI lượt chụp ảnh dù dữ liệu gần như chắc chắn chưa đổi). Cache 10s (readTabCached
  // mặc định của getAll) gần như luôn "nóng" nhờ /kiem-tra vừa chạy — cùng mức đánh đổi độ mới đã áp
  // dụng và được chấp nhận cho thao tác hàng loạt (xem orderService.js#getManyByKeys). AN TOÀN vì các
  // cột QUYẾT ĐỊNH đúng/sai khi ghi (TRANG_THAI_XUONG, TRACKING_ID...) đều là cột SQLite, được
  // capNhatThat() tự đọc LẠI bản mới nhất ngay trước khi ghi thật (xem services/orderService.js) —
  // không phụ thuộc độ mới của lượt đọc Sheets ở đây.
  //
  // ttlMs: 30000 (bổ sung 23/09/2026, theo yêu cầu người dùng tiếp tục cải thiện tốc độ) — TTL mặc định
  // 10s của getAll() giả định /kiem-tra vừa chạy fresh CHỈ vài giây trước, nhưng thực tế người quét còn
  // phải mở camera, canh góc, chụp — có thể vượt 10s, khiến cache lại "nguội" và /upload vẫn phải đọc
  // tươi như trước khi sửa. Nới lên 30s cho riêng nơi gọi này — cùng mức đánh đổi độ mới đã chấp nhận
  // cho thao tác hàng loạt (orderService.js#getManyByKeys), chỉ dài hơn một chút.
  // LƯU Ý: cache này DÙNG CHUNG cho mọi nơi đọc tab Don_Hang_ALL — nếu ĐÚNG LÚC lượt đọc của /upload là
  // lượt "đổ đầy lại" cache (còn hết hạn), các trang khác (danh sách, dashboard...) đọc ngay sau đó
  // trong cửa sổ 30s này cũng tạm thời thấy dữ liệu cũ hơn 10s thường lệ — chấp nhận được vì hiếm khi
  // trúng đúng thời điểm, và các trang đó vốn đã chấp nhận vài giây cũ.
  const { headers, row } = await orderService.getByKey(sttKey, { ttlMs: 30000 });
  const tSauDocDon = Date.now();
  // Đơn khác Xưởng coi như không tồn tại (bổ sung 13/09/2026).
  if (!row || !orderService.coQuyenTheoXuong(user, row)) return res.status(404).json({ error: 'Không tìm thấy đơn hàng: ' + sttKey });

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
    console.error(`[MinIO] Upload ảnh thất bại sau ${Date.now() - tSauDocDon}ms:`, err.message);
    return res.status(502).json({ error: 'Lưu ảnh lên kho lưu trữ thất bại — vui lòng thử lại' });
  }
  const tSauMinio = Date.now();

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

  ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'UPLOAD_ANH',
    sttKey, chiTiet: { moc, url, ...(chuyenTuDong ? { tu: chuyenTuDong.yeuCau, sang: chuyenTuDong.chuyenSang } : {}) },
  }).catch(err => console.error('[Photos] Lỗi ghi log nền:', err.message));

  console.log(
    `[Photos] Upload ${sttKey}/${moc}: đọc đơn ${tSauDocDon - tBatDau}ms, MinIO ${tSauMinio - tSauDocDon}ms, ` +
    `ghi cập nhật ${Date.now() - tSauMinio}ms, TỔNG ${Date.now() - tBatDau}ms, ảnh ${(req.file.size / 1024).toFixed(0)}KB`
  );
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
// vẫn "sống" bình thường. Dùng LẠI ĐÚNG services/anhNguonService.js#taiDsAnh() đã có sẵn cho tính năng
// IN ĐƠN (PDF) — xử lý được Drive FILE, Drive THƯ MỤC (nhiều ảnh), Gemini, MinIO, HTTP thường trong
// CÙNG 1 hàm, không viết lại logic nhận diện nguồn ảnh ở đây. KHÔNG ghi lại URL đã resolve vào Sheet
// (theo yêu cầu người dùng — Sheet là dữ liệu gốc, không sửa qua đường này) — chỉ cache TRONG BỘ NHỚ
// TIẾN TRÌNH để đỡ gọi lại Drive API/dựng lại trang Gemini mỗi lần có người xem lại ĐÚNG 1 nguồn ảnh đó
// (tránh lặp lại vấn đề tốn quota như từng gặp với Google Sheets API).
//
// HIỂN THỊ TỐI ĐA 2 ẢNH/ĐƠN (bổ sung cùng ngày, theo yêu cầu người dùng — 1 số đơn dán link cả THƯ MỤC
// Drive chứa nhiều ảnh, vd đơn 9U115/9U121.2): client luôn thử tải CẢ 2 vị trí ?index=0 và ?index=1 của
// CÙNG 1 url (xem public/js/api.js#urlAnhHienThiList) — vị trí không có ảnh thật sẽ tự 404, trình duyệt
// tự ẩn thẻ <img> đó qua onerror="this.remove()", không cần server báo trước "có bao nhiêu ảnh".
// ============================================================
const SO_ANH_TOI_DA_MOI_DON = 2;
const _cacheAnhNgoai = new Map(); // khoa (url+chieuRong) -> { danhSachAnh: [{buffer,contentType}], luuLucNao } — Map giữ thứ tự chèn, dùng làm LRU
const _dangTaiAnhNgoai = new Map(); // khoa -> Promise<danhSachAnh> — gộp các lượt gọi TRÙNG khoá đến CÙNG LÚC (2 thẻ <img> index=0/1 của cùng 1 đơn tải gần như đồng thời) thành ĐÚNG 1 lượt tải thật, tránh gọi 2 lần Drive API cho cùng 1 thư mục — cùng kỹ thuật gopYeuCauTrung() đã có ở services/sheetsService.js.
const THOI_GIAN_GIU_CACHE_ANH_NGOAI_MS = 6 * 60 * 60 * 1000; // 6 giờ — ảnh cũ hiếm khi đổi nội dung, đủ dài để giảm tải Drive/Gemini
const SO_URL_TOI_DA_TRONG_CACHE = 100; // giới hạn bộ nhớ — loại khoá LÂU KHÔNG AI XEM LẠI nhất khi vượt ngưỡng

// Khoá cache GỘP url + chiều rộng resize (bổ sung 21/09/2026, theo yêu cầu người dùng — cho hiển thị
// nhiều cỡ khác nhau, xem CAC_CHIEU_RONG_HOP_LE bên dưới) — CÙNG 1 url ở 2 cỡ khác nhau PHẢI là 2 mục
// cache riêng biệt (bytes đã resize khác nhau), không thể tiếp tục dùng thẳng url làm khoá như trước.
function khoaCacheAnhNgoai(url, chieuRong) {
  return chieuRong + '::' + url;
}

function layTuCacheAnhNgoai(khoa) {
  const daCache = _cacheAnhNgoai.get(khoa);
  if (!daCache) return null;
  if (Date.now() - daCache.luuLucNao > THOI_GIAN_GIU_CACHE_ANH_NGOAI_MS) {
    _cacheAnhNgoai.delete(khoa);
    return null;
  }
  // Xoá rồi set lại — đưa key này lên CUỐI thứ tự chèn của Map, đúng ngữ nghĩa "vừa dùng gần nhất" cho LRU.
  _cacheAnhNgoai.delete(khoa);
  _cacheAnhNgoai.set(khoa, daCache);
  return daCache.danhSachAnh;
}

function luuVaoCacheAnhNgoai(khoa, danhSachAnh) {
  _cacheAnhNgoai.delete(khoa);
  _cacheAnhNgoai.set(khoa, { danhSachAnh, luuLucNao: Date.now() });
  while (_cacheAnhNgoai.size > SO_URL_TOI_DA_TRONG_CACHE) {
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

// Resize + nén ảnh GỐC thành bản HIỂN THỊ nhẹ hơn (bổ sung 21/09/2026, theo yêu cầu người dùng — ảnh
// gốc từ link thư mục Drive/MinIO/URL thường tải nguyên bản (thường vài MB/ảnh) trong khi khung hiển
// thị thực tế chỉ tối đa ~320px (.anh-mau) hoặc 132px (thẻ đơn), khiến điện thoại/iPad tải rất chậm ở
// xưởng). CHỈ resize bản NẰM TRONG CACHE HIỂN THỊ này — taiDsAnh() gốc (dùng cho in PDF/so khớp ảnh
// hàng loạt, xem routes/orders.js, routes/reports.js, scripts/rasoat-hang-loat.js) KHÔNG bị đụng, vẫn
// đọc đúng ảnh gốc như cũ. Dùng sharp (đã là dependency sẵn có, đang chạy ổn định cho perceptualHashService.js
// — không phải thư viện mới). Lỗi decode (buffer hỏng/không phải ảnh) thì dùng nguyên bản gốc, không
// làm mất ảnh chỉ vì nén thất bại.
//
// 2 CỠ (bổ sung cùng ngày, theo yêu cầu người dùng cải thiện tốc độ Danh sách đơn hàng) — PHẢI khớp
// ĐÚNG CHIEU_RONG_ANH_THU_NHO/CHIEU_RONG_ANH_CHI_TIET trong public/js/api.js#urlAnhHienThiList(): 320
// (thẻ đơn/lưới nhỏ) và 1000 (trang Chi tiết đơn, giữ nguyên mức cũ). Whitelist CỨNG thay vì nhận `w`
// tuỳ ý từ client — tránh bị lợi dụng tạo vô số mục cache khác nhau (mỗi giá trị `w` lạ là 1 khoá cache
// mới, có thể làm phình bộ nhớ) và tránh sharp phải resize theo kích thước không kiểm soát được.
const CAC_CHIEU_RONG_HOP_LE = [320, 1000];
const CHIEU_RONG_MAC_DINH = 1000;
function chuanHoaChieuRong(giaTriTho) {
  const gt = Number(giaTriTho);
  return CAC_CHIEU_RONG_HOP_LE.includes(gt) ? gt : CHIEU_RONG_MAC_DINH;
}

const CHAT_LUONG_JPEG_HIEN_THI = 80;
async function nenAnhHienThi(buffer, chieuRong) {
  try {
    return await sharp(buffer)
      .resize(chieuRong, chieuRong, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: CHAT_LUONG_JPEG_HIEN_THI })
      .toBuffer();
  } catch (err) {
    console.error('[Ảnh ngoài] Không nén được ảnh, dùng bản gốc:', err.message);
    return null;
  }
}

// Tải (có cache + gộp yêu cầu trùng lúc) danh sách TỐI ĐA SO_ANH_TOI_DA_MOI_DON ảnh cho 1 url — dùng
// chung cho mọi index của CÙNG url+chieuRong (chia sẻ đúng 1 lượt tải thật, xem _dangTaiAnhNgoai ở trên).
async function layDanhSachAnhCoCache(url, chieuRong) {
  const khoa = khoaCacheAnhNgoai(url, chieuRong);
  const daCache = layTuCacheAnhNgoai(khoa);
  if (daCache) return daCache;

  const dangTai = _dangTaiAnhNgoai.get(khoa);
  if (dangTai) return dangTai;

  const promise = (async () => {
    let buffers;
    try {
      buffers = await taiDsAnh(url, { gioiHan: SO_ANH_TOI_DA_MOI_DON });
    } catch (err) {
      console.error('[Ảnh ngoài] Lỗi tải ảnh:', url, '-', err.message);
      buffers = [];
    }
    const danhSachAnh = await Promise.all(buffers.slice(0, SO_ANH_TOI_DA_MOI_DON).map(async buffer => {
      const nen = await nenAnhHienThi(buffer, chieuRong);
      return nen ? { buffer: nen, contentType: 'image/jpeg' } : { buffer, contentType: nhanDangContentTypeAnh(buffer) };
    }));
    luuVaoCacheAnhNgoai(khoa, danhSachAnh);
    return danhSachAnh;
  })();
  _dangTaiAnhNgoai.set(khoa, promise);
  try {
    return await promise;
  } finally {
    _dangTaiAnhNgoai.delete(khoa);
  }
}

router.get('/anh-ngoai', async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(String(url))) {
    return res.status(400).json({ error: 'Thiếu hoặc sai định dạng tham số url' });
  }
  const index = req.query.index === '1' ? 1 : 0; // chỉ đúng 2 giá trị hợp lệ (SO_ANH_TOI_DA_MOI_DON=2) — giá trị khác coi như 0
  const chieuRong = chuanHoaChieuRong(req.query.w);

  const danhSachAnh = await layDanhSachAnhCoCache(url, chieuRong);
  const anh = danhSachAnh[index];
  if (!anh) {
    return res.status(404).json({ error: 'Không có ảnh ở vị trí này' });
  }

  res.setHeader('Content-Type', anh.contentType);
  // private (không cache ở proxy/CDN trung gian, ảnh có thể riêng tư) + max-age 1 giờ ở TRÌNH DUYỆT —
  // giảm thêm request lặp lại tới CHÍNH server này (ngoài cache trong bộ nhớ tiến trình ở trên) khi
  // cùng 1 người dùng xem lại danh sách đơn nhiều lần trong phiên làm việc.
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.end(anh.buffer);
});

module.exports = router;
