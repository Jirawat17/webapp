const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const sharp = require('sharp');
const orderService = require('../services/orderService');
const storageService = require('../services/storageService');
const { taiDsAnh, nhanDangKieuAnh } = require('../services/anhNguonService');
const { ghiLog } = require('../services/logService');
const { requireLogin, requireExactRole, laAdmin } = require('../middleware/auth');
const { layCaiDatNenAnh, datCaiDatNenAnh } = require('../services/caiDatDbService');
const { thoiGianVNISOString } = require('../services/dateUtils');
const trangThaiDbService = require('../services/trangThaiDbService');
const nhatKyDb = require('../services/nhatKyDbService');
const { traNhaMang } = require('../services/nhaMangService');
// Trạng thái MỚI NHẤT (SQLite) — kèm vào lỗi 400 khi orderService.update từ chối giữa chừng (trạng thái vừa đổi ngay giữa bước kiểm tra và
// lúc ghi), để trang gọi nhận ra đơn đã sang trạng thái khác giống nhánh kiểm tra trước (14/10/2026).
const trangThaiMoiNhat = sttKey => trangThaiDbService.layTheoKey(sttKey).TRANG_THAI_XUONG || undefined;

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
  // ve_file_2/_3 (bổ sung 24/09/2026, theo yêu cầu người dùng — không phải đơn nào cũng cần 2-3 ảnh
  // file thêu) — mỗi ô/nút tải ĐỘC LẬP với nhau, cùng cơ chế ghi đè khi tải lại, chỉ khác cột lưu.
  ve_file_2: 'Anh_File_Theu_URL_2',
  ve_file_3: 'Anh_File_Theu_URL_3',
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

// ẢNH ĐÃ SẢN XUẤT — TỐI ĐA 2 ẢNH/ĐƠN (14/10/2026, theo yêu cầu người dùng). Đơn chỉ chuyển "Đã sản xuất" khi chụp XONG CẢ LƯỢT:
//   - ảnh 1 (viTri 1): ghi Anh_Da_San_Xuat_URL, XOÁ ảnh 2 cũ (nếu có), đóng dấu THOI_GIAN_ANH_SAN_XUAT; xong=0 -> đơn vẫn "Đang chạy máy".
//   - ảnh 2 (viTri 2): chỉ khi đã có ảnh 1 CỦA LƯỢT NÀY; ghi Anh_Da_San_Xuat_URL_2.
//   - xong: gửi kèm ảnh (xong=1 — mặc định, giữ đúng hành vi cũ 1 ảnh) hoặc POST /hoan-tat-san-xuat (nút "Xong" / quét đơn tiếp theo).
// "Ảnh 1 của lượt này" = có ảnh 1, đóng dấu SAU lúc đơn vào "Đang chạy máy" lần gần nhất (MOC_VAO_TRANG_THAI) — ảnh của lượt
// chạy máy TRƯỚC (đơn làm lại sau lỗi) không tính, chụp lại từ ảnh 1 như mới (người dùng chốt: quét lại đơn đang chụp dở thì GIỮ
// ảnh 1, cho chụp tiếp). Ảnh cũ chưa có dấu thời gian (trước 14/10/2026) cũng không tính.
const SO_ANH_SAN_XUAT_TOI_DA = 2;
const TRANG_THAI_DUOC_THAY_ANH_SX = 'Đã sản xuất';
const THAY_ANH_2_TRONG_MS = 10 * 60 * 1000; // ảnh 2 gửi ngay sau ảnh 1 (trang Chi tiết đơn) — 10 phút đủ cho mạng chậm // admin thay ảnh đã sản xuất (POST /upload thay=1) — người dùng chốt: chỉ trạng thái này
function soAnhSanXuatLuotNay(row) {
  if (row.TRANG_THAI_XUONG !== 'Đang chạy máy' || !row.Anh_Da_San_Xuat_URL || !row.THOI_GIAN_ANH_SAN_XUAT) return 0;
  let vaoLuc = '';
  try { vaoLuc = (JSON.parse(row.MOC_VAO_TRANG_THAI || '{}') || {})['Đang chạy máy'] || ''; } catch (e) { /* hỏng -> coi như không rõ */ }
  if (vaoLuc && row.THOI_GIAN_ANH_SAN_XUAT < vaoLuc) return 0; // cùng định dạng thoiGianVNISOString -> so chuỗi được
  return row.Anh_Da_San_Xuat_URL_2 ? 2 : 1;
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
  if (!row || !orderService.coQuyenTheoXuong(user, row)) return res.status(404).json({ error: 'Không tìm thấy đơn hàng: ' + sttKey, nghiepVu: true });

  const chuyenTuDong = MOC_TU_DONG_CHUYEN_TRANG_THAI[moc];
  if (chuyenTuDong && row.TRANG_THAI_XUONG !== chuyenTuDong.yeuCau) {
    return res.status(400).json({
      error: `Đơn "${sttKey}" đang ở trạng thái "${row.TRANG_THAI_XUONG}" — chỉ chụp ảnh được khi đơn đang ở "${chuyenTuDong.yeuCau}".`, nghiepVu: true,
      trangThaiHienTai: row.TRANG_THAI_XUONG, // scan.html: = trạng thái đích khi gửi lại ảnh -> lần gửi trước đã lưu (mất phản hồi)
    });
  }
  if (chuyenTuDong && chuyenTuDong.chuyenSang === 'ĐÃ DÁN TEM' && thieuTrackingThat(row)) {
    return res.status(400).json({
      error: `Đơn "${sttKey}" chưa có thông tin Tracking (mã vận đơn thật) — phải mua tracking trước khi chuyển sang "ĐÃ DÁN TEM".`, nghiepVu: true,
    });
  }

  const [daGanKH] = await orderService.ganTenKhachHang([row]);
  const nhomNhieuAo = chuyenTuDong ? await orderService.canhBaoNhomKhiQuet(row, chuyenTuDong.chuyenSang) : null; // F1
  res.json({ sttKey: row.STT_Key, tieuDe: orderService.tieuDeSanPham(row), tenKhachHang: daGanKH.TenKhachHang, nhomNhieuAo,
    ...(moc === 'da_san_xuat' ? { soAnhLuotNay: soAnhSanXuatLuotNay(row) } : {}) });
});

// Vì mã đơn đã lấy từ bước quét QR ngay trước đó trong cùng luồng thao tác (sttKey gửi kèm trong
// form), KHÔNG cần AI đọc ảnh để nhận diện mã — nhanh hơn, không tốn quota Gemini, chính xác 100%.
router.post('/upload', upload.single('photo'), async (req, res) => {
  // Thời gian NHẬN HẾT ảnh (22/10/2026): từ lúc request vào app (server.js#_tVaoUpload, chưa đọc dữ liệu) tới khi multer đọc xong ảnh.
  const msNhan = req._tVaoUpload ? Math.round(performance.now() - req._tVaoUpload) : null;
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
  if (!row || !orderService.coQuyenTheoXuong(user, row)) return res.status(404).json({ error: 'Không tìm thấy đơn hàng: ' + sttKey, nghiepVu: true });

  const chuyenTuDong = MOC_TU_DONG_CHUYEN_TRANG_THAI[moc];
  // THAY ảnh đã sản xuất (14/10/2026, theo yêu cầu người dùng — chỉ trang Chi tiết đơn): admin/superadmin, đơn ĐANG "Đã sản xuất". Thay cả
  // lượt (ảnh 1 xoá ảnh 2 cũ), KHÔNG đổi trạng thái / THOI_GIAN_SAN_XUAT (mốc tự mua tracking), không tự chạy lại QC2; link cũ ghi trong
  // lịch sử đơn (urlCu).
  const thayAnh = moc === 'da_san_xuat' && req.body.thay === '1';
  if (thayAnh && !laAdmin(user.vaiTro)) return res.status(403).json({ error: 'Chỉ admin được thay ảnh đã sản xuất' });
  if (thayAnh && row.TRANG_THAI_XUONG !== TRANG_THAI_DUOC_THAY_ANH_SX) {
    return res.status(400).json({ error: `Đơn "${sttKey}" đang ở trạng thái "${row.TRANG_THAI_XUONG}" — chỉ thay ảnh đã sản xuất được khi đơn đang ở "${TRANG_THAI_DUOC_THAY_ANH_SX}".`,
      nghiepVu: true, trangThaiHienTai: row.TRANG_THAI_XUONG });
  }
  if (!thayAnh && chuyenTuDong && row.TRANG_THAI_XUONG !== chuyenTuDong.yeuCau) {
    return res.status(400).json({
      error: `Đơn "${sttKey}" đang ở trạng thái "${row.TRANG_THAI_XUONG}" — chỉ chụp ảnh được khi đơn đang ở "${chuyenTuDong.yeuCau}".`, nghiepVu: true,
      trangThaiHienTai: row.TRANG_THAI_XUONG, // scan.html: = trạng thái đích khi gửi lại ảnh -> lần gửi trước đã lưu (mất phản hồi)
    });
  }
  if (chuyenTuDong && chuyenTuDong.chuyenSang === 'ĐÃ DÁN TEM' && thieuTrackingThat(row)) {
    return res.status(400).json({
      error: `Đơn "${sttKey}" chưa có thông tin Tracking (mã vận đơn thật) — phải mua tracking trước khi chuyển sang "ĐÃ DÁN TEM".`, nghiepVu: true,
    });
  }

  // Chỉ nhận ảnh (giữ nguyên giới hạn 10MB của multer phía trên)
  if (!req.file.mimetype || !req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'File gửi lên không phải là ảnh' });
  }

  // Ảnh đã sản xuất 1/2 + có chuyển trạng thái luôn không (xem soAnhSanXuatLuotNay). Không gửi -> ảnh 1 + chuyển luôn (hành vi cũ).
  const viTri = req.body.viTri === '2' ? 2 : 1;
  const xong = req.body.xong !== '0' && !thayAnh; // thay ảnh: không bao giờ đổi trạng thái
  if (moc !== 'da_san_xuat' && (viTri !== 1 || req.body.xong === '0')) return res.status(400).json({ error: 'Mốc ảnh này chỉ có 1 ảnh' });
  // Ảnh 2 phải thuộc đúng lượt có ảnh 1. Thay ảnh: ảnh 1 MỚI đã lưu sau lúc đơn sang "Đã sản xuất" (THOI_GIAN_ANH_SAN_XUAT > THOI_GIAN_SAN_XUAT)
  // và VỪA lưu (trong THAY_ANH_2_TRONG_MS) — thay cả lượt, không cho thay riêng ảnh 2 về sau.
  const vuaThayAnh1 = r => (r.THOI_GIAN_ANH_SAN_XUAT || '') > (r.THOI_GIAN_SAN_XUAT || '')
    && Date.now() - Date.parse(r.THOI_GIAN_ANH_SAN_XUAT) <= THAY_ANH_2_TRONG_MS;
  const loiAnh2 = r => (viTri !== 2 ? null
    : thayAnh ? (vuaThayAnh1(r) ? null : `Đơn "${sttKey}": thay ảnh 2 phải đi cùng ảnh 1 mới — chọn lại cả 2 ảnh.`)
    : soAnhSanXuatLuotNay(r) < 1 ? `Đơn "${sttKey}" chưa có ảnh đã sản xuất thứ 1 của lượt chụp này — chụp ảnh 1 trước.` : null);
  if (moc === 'da_san_xuat' && loiAnh2(row)) return res.status(400).json({ error: loiAnh2(row), nghiepVu: true });

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
  if (moc === 'da_san_xuat') {
    if (viTri === 2) { delete updates[cotAnh]; updates.Anh_Da_San_Xuat_URL_2 = url; }
    else { updates.Anh_Da_San_Xuat_URL_2 = ''; updates.THOI_GIAN_ANH_SAN_XUAT = thoiGianVNISOString(); } // ảnh 1 = bắt đầu lượt mới
  }
  if (chuyenTuDong && xong) updates.TRANG_THAI_XUONG = chuyenTuDong.chuyenSang;

  let updated;
  try {
    // quaAnh: true — cho phép đặt thẳng TRANG_THAI_XUONG="Đã sản xuất" ở đây, vì đây CHÍNH LÀ luồng
    // chụp ảnh QR hợp lệ mà orderService.update() bắt buộc phải đi qua cho trạng thái này (xem
    // kiemTraCongAnhBatBuoc trong orderService.js).
    // headers/row đã đọc thật ở trên (dòng 53), khỏi đọc lại lần nữa (xem orderService.update)
    // Ảnh đã sản xuất: kiểm tra LẠI trong lượt khoá theo đơn (trạng thái + ảnh 1 của lượt) — ảnh 1 và ảnh 2 có thể tới sát nhau.
    updated = await orderService.update(sttKey, updates, user, {
      quaAnh: true, donDaDoc: { headers, row },
      ...(moc === 'da_san_xuat' ? { yeuCauDangLa: { TRANG_THAI_XUONG: thayAnh ? TRANG_THAI_DUOC_THAY_ANH_SX : chuyenTuDong.yeuCau }, kiemTraDon: loiAnh2 } : {}),
    });
  } catch (err) {
    // orderService.update từ chối = dữ liệu đơn không cho đổi (vd trạng thái vừa đổi ở nơi khác) -> nghiệp vụ, xem Logs_UploadAnh.
    return res.status(400).json({ error: err.message, nghiepVu: true, ...(chuyenTuDong ? { trangThaiHienTai: trangThaiMoiNhat(sttKey) } : {}) });
  }

  ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'UPLOAD_ANH',
    sttKey, chiTiet: { moc, url, ...(viTri === 2 ? { viTri } : {}),
      ...(thayAnh ? { thayAnh: true, urlCu: row[viTri === 2 ? 'Anh_Da_San_Xuat_URL_2' : 'Anh_Da_San_Xuat_URL'] || '',
        ...(viTri === 1 && row.Anh_Da_San_Xuat_URL_2 ? { urlCu2: row.Anh_Da_San_Xuat_URL_2 } : {}) } : {}),
      ...(chuyenTuDong && xong ? { tu: chuyenTuDong.yeuCau, sang: chuyenTuDong.chuyenSang } : {}) },
  }).catch(err => console.error('[Photos] Lỗi ghi log nền:', err.message));

  console.log(
    `[Photos] Upload ${sttKey}/${moc}: đọc đơn ${tSauDocDon - tBatDau}ms, MinIO ${tSauMinio - tSauDocDon}ms, ` +
    `ghi cập nhật ${Date.now() - tSauMinio}ms, TỔNG ${Date.now() - tBatDau}ms, ảnh ${(req.file.size / 1024).toFixed(0)}KB`
    + (msNhan != null ? `, nhận ảnh ${msNhan}ms${msNhan > 0 ? ` (${Math.round(req.file.size / 1024 / (msNhan / 1000))} KB/s)` : ''}` : '')
  );
  // thoiGian (12/10/2026, Logs_UploadAnh): mốc máy chủ trả về để trang Quét QR tách "gửi qua mạng" = tổng phía máy − máy chủ.
  // Lưu thời gian nhận ảnh vào do_toc_do (nguon 'nhan_anh') NGAY ở máy chủ — không phụ thuộc log điện thoại gửi sau (lượt chậm hay mất log
  // đó nhất); báo cáo so theo giờ với tốc độ máy chủ / điện thoại đo tới Cloudflare. Lỗi ghi không ảnh hưởng việc upload.
  if (msNhan != null) {
    try {
      const kb = Math.round(req.file.size / 1024);
      nhatKyDb.ghiNhieuTocDo([{
        luc: thoiGianVNISOString(), nguon: 'nhan_anh', huong: 'len', kb, ms: msNhan, kbs: msNhan > 0 ? Math.round(kb / (msNhan / 1000)) : null,
        nhaMang: traNhaMang(req.headers['cf-connecting-ip'] || req.socket.remoteAddress).slice(0, 60),
        nguoi: String(user.ten || '').slice(0, 60), xuong: String(user.xuong || '').slice(0, 60), loi: '',
      }]);
    } catch (err) { console.error('[Photos] Lỗi lưu thời gian nhận ảnh:', err.message); }
  }
  // nhan (22/10/2026): thời gian máy chủ nhận hết ảnh — KHÔNG cộng vào tong (tong vẫn chỉ là phần xử lý, trang Quét QR trừ ra như cũ).
  res.json({ ok: true, url, don: updated, thoiGian: { docDon: tSauDocDon - tBatDau, minio: tSauMinio - tSauDocDon, ghi: Date.now() - tSauMinio, tong: Date.now() - tBatDau, nhan: msNhan } });
});

// "Xong đơn này" (14/10/2026) — chụp xong lượt ảnh đã sản xuất mà không gửi kèm ảnh cuối: nút Xong ở scan.html, hoặc tự gọi khi quét
// sang đơn tiếp theo. Cần đơn đang "Đang chạy máy" và đã có ảnh 1 của lượt này (xem soAnhSanXuatLuotNay).
router.post('/hoan-tat-san-xuat', async (req, res) => {
  const { sttKey } = req.body;
  const user = req.session.user;
  if (!sttKey) return res.status(400).json({ error: 'Thiếu mã đơn hàng' });
  const { yeuCau, chuyenSang } = MOC_TU_DONG_CHUYEN_TRANG_THAI.da_san_xuat;
  const { headers, row } = await orderService.getByKey(sttKey, { ttlMs: 30000 }); // cột SQLite luôn mới, xem /upload
  if (!row || !orderService.coQuyenTheoXuong(user, row)) return res.status(404).json({ error: 'Không tìm thấy đơn hàng: ' + sttKey, nghiepVu: true });
  if (row.TRANG_THAI_XUONG !== yeuCau) {
    return res.status(400).json({ error: `Đơn "${sttKey}" đang ở trạng thái "${row.TRANG_THAI_XUONG}" — không còn ở "${yeuCau}".`, nghiepVu: true,
      trangThaiHienTai: row.TRANG_THAI_XUONG });
  }
  const loiChuaCoAnh = r => (soAnhSanXuatLuotNay(r) < 1 ? `Đơn "${sttKey}" chưa có ảnh đã sản xuất của lượt chụp này — chụp ảnh trước khi bấm Xong.` : null);
  if (loiChuaCoAnh(row)) return res.status(400).json({ error: loiChuaCoAnh(row), nghiepVu: true });

  let updated;
  try {
    updated = await orderService.update(sttKey, { TRANG_THAI_XUONG: chuyenSang, NguoiCapNhatCuoi: user.ten, ThoiGianCapNhatCuoi: new Date().toISOString() },
      user, { quaAnh: true, donDaDoc: { headers, row }, yeuCauDangLa: { TRANG_THAI_XUONG: yeuCau }, kiemTraDon: loiChuaCoAnh });
  } catch (err) {
    return res.status(400).json({ error: err.message, nghiepVu: true, trangThaiHienTai: trangThaiMoiNhat(sttKey) });
  }
  // Cùng HanhDong UPLOAD_ANH (moc da_san_xuat, tu/sang) như khi ảnh tự chuyển trạng thái — báo cáo / lịch sử / chỉ tiêu đọc y như cũ.
  ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'UPLOAD_ANH',
    sttKey, chiTiet: { moc: 'da_san_xuat', hoanTat: true, soAnh: soAnhSanXuatLuotNay(row), tu: yeuCau, sang: chuyenSang },
  }).catch(err => console.error('[Photos] Lỗi ghi log nền:', err.message));
  res.json({ ok: true, don: updated });
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
  // Tem GKE lưu sẵn (tem-gke_<tracking>.pdf, 16/10/2026 — trackingAutoService#khoaTemDaLuu) nằm chung thư mục đơn để "Xoá dữ liệu đơn"
  // xoá luôn, nhưng KHÔNG mở qua đây: tem có tên/địa chỉ/SĐT khách — chỉ lấy qua IN LABEL (có kiểm tra quyền).
  if (/\/tem-(gke|kl)_[^/]*$/.test(objectKey)) return res.status(404).json({ error: 'Không tìm thấy ảnh' }); // + tem KL (22/10/2026)
  // Ảnh của đơn ngoài Xưởng người xem -> coi như không có (29/09/2026, admin chỉ thấy Xưởng mình phụ trách).
  // Key dạng orders/{sttKey}/{uuid}-{tên} (storageService.js#taoObjectKeyDonHang).
  if (!orderService.phamViDon(req.session.user)(objectKey.split('/')[1])) {
    return res.status(404).json({ error: 'Không tìm thấy ảnh' });
  }

  // guiObjectQuaHttp (03/10/2026): có timeout + đóng đúng kết nối khi MinIO đứt/treo giữa chừng (.pipe() cũ để người xem chờ mãi).
  try {
    await storageService.guiObjectQuaHttp(res, objectKey);
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ error: 'Không tìm thấy ảnh' });
    }
    console.error('[MinIO] Đọc ảnh thất bại:', err.message);
    return res.status(502).json({ error: 'Đọc ảnh từ kho lưu trữ thất bại' });
  }
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

// Content-Type qua magic bytes — dùng chung anhNguonService.js#nhanDangKieuAnh (03/10/2026, thay bản viết riêng ở đây).
const nhanDangContentTypeAnh = buffer => nhanDangKieuAnh(buffer) || 'application/octet-stream';

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
