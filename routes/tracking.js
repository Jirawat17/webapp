const express = require('express');
const router = express.Router();
const {
  layCauHinh, luuCauHinh, layDanhSachDonAutoTracking, layLogTracking, muaTrackingChoDon,
  inLabelChoDon, muaTrackingVaInLabelChoDon, capNhatTrangThaiTrackingChoDon,
  layCauHinhQuetTrangThai, luuCauHinhQuetTrangThai, SO_PHUT_QUET_TRANG_THAI_TOI_THIEU,
} = require('../services/trackingAutoService');
const {
  gopCacTemPdf, layDanhSachTaiKhoanGke, luuTaiKhoanGke, xoaTaiKhoanGke, ganTaiKhoanGkeChoXuong,
} = require('../services/gkeService');
const orderService = require('../services/orderService');
const sheetSellerService = require('../services/sheetSellerService');
const { requireLogin, requireExactRole } = require('../middleware/auth');

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

// Khoảng cách quét trạng thái tracking thật (bổ sung 21/09/2026, theo yêu cầu người dùng — cho chỉnh
// trực tiếp trên giao diện, xem trackingAutoService.js#layCauHinhQuetTrangThai để biết lý do KHÔNG
// đổi lịch cron trực tiếp theo giá trị này).
router.get('/cau-hinh-quet-trang-thai', (req, res) => {
  res.json(layCauHinhQuetTrangThai());
});

router.post('/cau-hinh-quet-trang-thai', (req, res) => {
  const soPhutQuet = Number(req.body.soPhutQuet);
  if (!Number.isFinite(soPhutQuet) || soPhutQuet < SO_PHUT_QUET_TRANG_THAI_TOI_THIEU) {
    return res.status(400).json({ error: `Khoảng cách quét (giờ + phút) phải từ ${SO_PHUT_QUET_TRANG_THAI_TOI_THIEU} phút trở lên.` });
  }
  luuCauHinhQuetTrangThai({ soPhutQuet });
  res.json({ ok: true });
});

router.get('/danh-sach', async (req, res) => {
  res.json(await layDanhSachDonAutoTracking(req.session.user));
});

// Tài khoản GKE theo Xưởng (bổ sung 27/09/2026, theo yêu cầu người dùng — thay cho /cau-hinh-gke, 1 bộ
// cấu hình chung cũ) — CHỈ superadmin, dùng ở settings.html. Có username/password API GKE THẬT nên giữ
// nguyên phạm vi superadmin như trước. Việc mua tracking/in label của các vai trò khác KHÔNG gọi qua
// đây — trackingAutoService.js tự lấy tài khoản đúng Xưởng của từng đơn trong process.
router.get('/tai-khoan-gke', requireExactRole('superadmin'), (req, res) => {
  res.json(layDanhSachTaiKhoanGke());
});
router.post('/tai-khoan-gke', requireExactRole('superadmin'), (req, res) => {
  try { res.json({ ok: true, id: luuTaiKhoanGke(null, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.put('/tai-khoan-gke/:id', requireExactRole('superadmin'), (req, res) => {
  try { res.json({ ok: true, id: luuTaiKhoanGke(req.params.id, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.delete('/tai-khoan-gke/:id', requireExactRole('superadmin'), (req, res) => {
  try { xoaTaiKhoanGke(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
// Gán (hoặc bỏ gán, taiKhoanId rỗng) tài khoản cho 1 Xưởng.
router.post('/gan-tai-khoan-gke', requireExactRole('superadmin'), (req, res) => {
  try { ganTaiKhoanGkeChoXuong(String(req.body.xuong || ''), req.body.taiKhoanId || ''); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ error: err.message }); }
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

  const thanhCong = [];
  const loi = [];
  // Đơn đã MUA TRACKING THẬT thành công nhưng KHÔNG ghi được sang Sheet Seller (bổ sung 21/09/2026; từ
  // 28/09/2026 qua services/sheetSellerService.js, không còn bỏ qua im lặng) — TÁCH RIÊNG khỏi `loi` (vốn
  // nghĩa là "không mua được tracking gì cả") vì tracking đã mua thành công, chỉ bước ghi sang Seller lỗi.
  const loiDaySheetKh = [];

  for (const sttKey of sttKeys) {
    try {
      // Chặn mua tracking cho đơn khác Xưởng (bổ sung 13/09/2026) — đọc qua cache, đủ dùng vì chỉ để
      // kiểm tra quyền, muaTrackingChoDon() bên dưới tự đọc thật riêng trước khi ghi.
      const { row } = await orderService.getByKey(sttKey);
      if (!row || !orderService.coQuyenTheoXuong(user, row)) {
        loi.push({ sttKey, lyDo: 'Không tìm thấy đơn hàng' });
        continue;
      }
      const ketQua = await muaTrackingChoDon(sttKey, user);
      if (!ketQua) { loi.push({ sttKey, lyDo: 'Đơn này đã có mã tracking thật rồi — không mua lại.' }); continue; }
      loiDaySheetKh.push(...(ketQua.loiSheetCon || [])); // đơn con DonNhieuAo chưa ghi được sang Sheet Seller
      if (ketQua.dungChung) {
        loi.push({ sttKey, lyDo: `Không mua — đơn DonNhieuAo dùng chung tracking ${ketQua.tracking_num} của ${ketQua.donMua} (đã gán).` });
        continue;
      }
      thanhCong.push(sttKey);
      if (ketQua.dayCheKhachHang && !ketQua.dayCheKhachHang.ok) {
        loiDaySheetKh.push({ sttKey, lyDo: ketQua.dayCheKhachHang.lyDo });
      }
    } catch (err) {
      if (!err.maLoi) console.error(`[TrackingThuCong] Lỗi mua tracking cho ${sttKey}:`, err.stack || err.message);
      loi.push({ sttKey, lyDo: err.message, maLoi: err.maLoi });
    }
  }

  res.json({ ok: true, thanhCong, loi, loiDaySheetKh });
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

  const thanhCong = [];
  const loi = [];
  const loiDaySheetKh = []; // "MUA TRACKING và IN LABEL": đã mua nhưng chưa ghi được sang Sheet Seller
  const cacLabelBase64 = [];

  for (const sttKey of sttKeys) {
    try {
      // Chặn in label cho đơn khác Xưởng (bổ sung 13/09/2026) — cùng lý do với /mua-thu-cong ở trên.
      const { row } = await orderService.getByKey(sttKey);
      if (!row || !orderService.coQuyenTheoXuong(user, row)) {
        loi.push({ sttKey, lyDo: 'Không tìm thấy đơn hàng' });
        continue;
      }
      const ketQua = await hamXuLy(sttKey, user);
      thanhCong.push(sttKey);
      if (ketQua && ketQua.dayCheKhachHang && !ketQua.dayCheKhachHang.ok) loiDaySheetKh.push({ sttKey, lyDo: ketQua.dayCheKhachHang.lyDo });
      if (ketQua && ketQua.loiSheetCon) loiDaySheetKh.push(...ketQua.loiSheetCon);
      if (ketQua && ketQua.label_base64) cacLabelBase64.push(ketQua.label_base64);
    } catch (err) {
      loi.push({ sttKey, lyDo: err.message, maLoi: err.maLoi });
    }
  }

  const labelBase64 = cacLabelBase64.length > 0 ? await gopCacTemPdf(cacLabelBase64) : null;
  res.json({ ok: true, thanhCong, loi, loiDaySheetKh, labelBase64 });
}

// "IN LABEL" — chỉ in lại tem cho đơn ĐÃ có tracking thật, không mua gì thêm. Dùng tại menu Đơn hàng
// (có thể chọn nhiều đơn), Đơn hàng chi tiết, hoặc ngay tại trang Tracking này (bổ sung 09/09/2026 lần 2).
router.post('/in-label', (req, res) => xuLyInLabelHangLoat(req, res, inLabelChoDon));

// "MUA TRACKING và IN LABEL" — 1 nút làm cả 2 việc, tự bỏ qua bước mua nếu đơn đã có tracking rồi (xem
// services/trackingAutoService.js#muaTrackingVaInLabelChoDon).
router.post('/mua-va-in-label', (req, res) => xuLyInLabelHangLoat(req, res, muaTrackingVaInLabelChoDon));

// Tra cứu/cập nhật trạng thái tracking THẬT thủ công (bổ sung 14/09/2026, theo yêu cầu người dùng — xem
// docs/superpowers/specs/2026-09-14-cap-nhat-trang-thai-tracking-design.md) — tương đương thủ công của
// lịch tự động mỗi 4 tiếng (services/trackingJob.js), CÙNG khuôn /mua-thu-cong: nhận sttKeys (mảng,
// dùng ô quét ở tracking.html luôn gửi đúng 1 phần tử), chặn khác Xưởng, lỗi 1 đơn rơi vào loi[] không
// dừng cả lượt. Trả THÊM trangThai/thoiGian/diaDiem cho mỗi đơn thành công (khác /mua-thu-cong chỉ cần
// biết có mua được hay không) — để giao diện hiện NGAY kết quả tra được, đúng yêu cầu "hiển thị kết quả
// luôn trong menu Tracking".
router.post('/cap-nhat-trang-thai-thu-cong', async (req, res) => {
  const { sttKeys } = req.body;
  const user = req.session.user;
  if (!Array.isArray(sttKeys) || sttKeys.length === 0) {
    return res.status(400).json({ error: 'Danh sách đơn trống' });
  }

  const thanhCong = [];
  const loi = [];
  const gomDelivered = []; // ô Delivered cần ghi sang Sheet Seller — ghi 1 lần sau vòng lặp (28/09/2026)

  for (const sttKey of sttKeys) {
    try {
      const { row } = await orderService.getByKey(sttKey);
      if (!row || !orderService.coQuyenTheoXuong(user, row)) {
        loi.push({ sttKey, lyDo: 'Không tìm thấy đơn hàng' });
        continue;
      }
      if (!row.TRACKING_ID) {
        loi.push({ sttKey, lyDo: 'Đơn chưa có mã tracking thật — chưa có gì để tra cứu.' });
        continue;
      }
      const ketQua = await capNhatTrangThaiTrackingChoDon(sttKey, { gomDelivered });
      if (!ketQua.ok) { loi.push({ sttKey, lyDo: ketQua.lyDo }); continue; }
      thanhCong.push({
        sttKey,
        trangThai: ketQua.suKien.track_name || ketQua.suKien.track_name_en || '',
        thoiGian: ketQua.suKien.actual_time || '',
        diaDiem: ketQua.suKien.location || '',
      });
    } catch (err) {
      console.error(`[TrackingThuCong] Lỗi tra cứu trạng thái tracking cho ${sttKey}:`, err.stack || err.message);
      loi.push({ sttKey, lyDo: err.message });
    }
  }

  const loiDaySheetKh = (await sheetSellerService.ghiHangLoat(gomDelivered, user))
    .filter(k => !k.ok).map(k => ({ sttKey: k.sttKey, lyDo: `Delivered: ${k.lyDo}` }));
  res.json({ ok: true, thanhCong, loi, loiDaySheetKh });
});

module.exports = router;
