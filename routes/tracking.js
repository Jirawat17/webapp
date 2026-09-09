const express = require('express');
const router = express.Router();
const {
  layCauHinh, luuCauHinh, layDanhSachDonAutoTracking, layLogTracking, muaTrackingChoDon,
  inLabelChoDon, muaTrackingVaInLabelChoDon,
} = require('../services/trackingAutoService');
const { layCauHinhGke, luuCauHinhGke, gopCacTemPdf } = require('../services/gkeService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// Mở cho admin/ve_file/san_xuat, CHỈ chặn nguoi_lay_phoi (bổ sung 09/09/2026 lần 2, theo yêu cầu người
// dùng — để 3 vai trò này dùng được 2 nút "IN LABEL"/"MUA TRACKING và IN LABEL" ngay tại trang này).
// Trước đó cả trang admin-only (đây là tính năng có thể phát sinh chi phí thật + có tài khoản API GKE
// thật) — người dùng đã cân nhắc và CHỌN mở luôn toàn trang thay vì chỉ mở riêng phần danh sách/2 nút
// mới, chấp nhận đánh đổi ve_file/san_xuat cũng xem/sửa được cấu hình GKE + bật/tắt tự động mua tracking.
function khongPhaiNguoiLayPhoi(req, res, next) {
  if (req.session.user.vaiTro === 'nguoi_lay_phoi') {
    return res.status(403).json({ error: 'Vai trò này không được dùng tính năng Tracking' });
  }
  next();
}
router.use(khongPhaiNguoiLayPhoi);

router.get('/cau-hinh', async (req, res) => {
  res.json(await layCauHinh());
});

router.post('/cau-hinh', async (req, res) => {
  const { bat, soPhutCho } = req.body;
  if (typeof bat !== 'boolean') return res.status(400).json({ error: 'Thiếu giá trị bật/tắt' });
  const soPhut = Number(soPhutCho);
  if (!Number.isFinite(soPhut) || soPhut <= 0) {
    return res.status(400).json({ error: 'Số phút chờ phải là số dương' });
  }
  await luuCauHinh({ bat, soPhutCho: soPhut });
  res.json({ ok: true });
});

router.get('/danh-sach', async (req, res) => {
  res.json(await layDanhSachDonAutoTracking());
});

// Cấu hình GKE (tài khoản API, thông tin người gửi, khai báo hải quan, cân nặng mặc định) — thêm
// 09/09/2026, theo yêu cầu người dùng đưa toàn bộ lên giao diện thay vì nằm cứng trong .env. Người
// dùng đã CHỦ ĐỘNG chọn đưa cả username/password API GKE lên giao diện (không giữ riêng trong .env
// như đề xuất ban đầu) — xem docs/superpowers/specs/2026-09-09-tu-dong-mua-tracking-design.md.
router.get('/cau-hinh-gke', async (req, res) => {
  res.json(await layCauHinhGke());
});

router.post('/cau-hinh-gke', async (req, res) => {
  await luuCauHinhGke(req.body || {});
  res.json({ ok: true });
});

router.get('/logs', (req, res) => {
  res.json(layLogTracking());
});

// Mua tracking THỦ CÔNG cho 1 hoặc nhiều đơn — bổ sung 09/09/2026, theo yêu cầu người dùng. Dùng
// CHUNG lõi muaTrackingChoDon() với job tự động (chống trùng vận đơn, không đổi TRANG_THAI_XUONG —
// xem services/trackingAutoService.js) — CHỈ khác ở chỗ truyền người dùng đang đăng nhập thật vào, để
// log/lịch sử ghi đúng người bấm.
//
// Nhận `sttKeys` (MẢNG, kể cả khi chỉ mua 1 đơn) + trả `{ok, thanhCong, loi}` — CÙNG khuôn với
// routes/orders.js POST /chi-dinh-nguoi-chay-may /chi-dinh-nguoi-ve-file, để dùng chung được hàm
// chayHangLoatCoTienDo()/taoThanhTienDo() (public/js/api.js) cho nút "Mua tracking" hàng loạt ở
// orders.html (bổ sung 09/09/2026) — nút đơn lẻ ở tracking.html/order.html gọi CÙNG route này với
// mảng 1 phần tử, không cần route riêng. Lỗi ở 1 đơn (không tìm thấy, đã có tracking, GKE từ chối...)
// rơi vào `loi[]` thay vì làm hỏng cả yêu cầu — khớp đúng "lỗi 1 đơn không dừng cả lượt" đã áp dụng ở
// job tự động.
router.post('/mua-thu-cong', async (req, res) => {
  const { sttKeys } = req.body;
  const user = req.session.user;
  if (!Array.isArray(sttKeys) || sttKeys.length === 0) {
    return res.status(400).json({ error: 'Danh sách đơn trống' });
  }

  const cauHinhGke = await layCauHinhGke();
  const thanhCong = [];
  const loi = [];

  for (const sttKey of sttKeys) {
    try {
      const ketQua = await muaTrackingChoDon(sttKey, cauHinhGke, user);
      if (!ketQua) { loi.push({ sttKey, lyDo: 'Đơn này đã có mã tracking thật rồi — không mua lại.' }); continue; }
      thanhCong.push(sttKey);
    } catch (err) {
      console.error(`[TrackingThuCong] Lỗi mua tracking cho ${sttKey}:`, err.stack || err.message);
      loi.push({ sttKey, lyDo: err.message });
    }
  }

  res.json({ ok: true, thanhCong, loi });
});

// Chạy 1 hàm xử lý (inLabelChoDon hoặc muaTrackingVaInLabelChoDon) cho từng đơn trong sttKeys — lỗi ở
// 1 đơn rơi vào loi[], KHÔNG dừng cả lượt (cùng khuôn /mua-thu-cong). Nhiều tem lấy về thành công sẽ
// được GHÉP thành 1 file PDF duy nhất (gopCacTemPdf) để trình duyệt chỉ cần mở 1 hộp thoại in — bổ
// sung 09/09/2026 lần 2, theo yêu cầu người dùng (chọn mua nhiều đơn cùng lúc ở menu Đơn hàng thì in
// gộp 1 lần thay vì mở lần lượt N hộp thoại in).
async function xuLyInLabelHangLoat(req, res, hamXuLy) {
  const { sttKeys } = req.body;
  const user = req.session.user;
  if (!Array.isArray(sttKeys) || sttKeys.length === 0) {
    return res.status(400).json({ error: 'Danh sách đơn trống' });
  }

  const cauHinhGke = await layCauHinhGke();
  const thanhCong = [];
  const loi = [];
  const cacLabelBase64 = [];

  for (const sttKey of sttKeys) {
    try {
      const ketQua = await hamXuLy(sttKey, cauHinhGke, user);
      thanhCong.push(sttKey);
      if (ketQua && ketQua.label_base64) cacLabelBase64.push(ketQua.label_base64);
    } catch (err) {
      loi.push({ sttKey, lyDo: err.message });
    }
  }

  const labelBase64 = cacLabelBase64.length > 0 ? await gopCacTemPdf(cacLabelBase64) : null;
  res.json({ ok: true, thanhCong, loi, labelBase64 });
}

// "IN LABEL" — chỉ in lại tem cho đơn ĐÃ có tracking thật, không mua gì thêm. Dùng tại menu Đơn hàng
// (có thể chọn nhiều đơn), Đơn hàng chi tiết, hoặc ngay tại trang Tracking này (bổ sung 09/09/2026 lần 2).
router.post('/in-label', (req, res) => xuLyInLabelHangLoat(req, res, inLabelChoDon));

// "MUA TRACKING và IN LABEL" — 1 nút làm cả 2 việc, tự bỏ qua bước mua nếu đơn đã có tracking rồi (xem
// services/trackingAutoService.js#muaTrackingVaInLabelChoDon).
router.post('/mua-va-in-label', (req, res) => xuLyInLabelHangLoat(req, res, muaTrackingVaInLabelChoDon));

module.exports = router;
