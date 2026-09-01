const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const gkeService = require('../services/gkeService');
const { ghiLog } = require('../services/logService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// Ghi log không chặn phản hồi cho người dùng — giống hệt cách routes/qr.js đang làm.
function ghiKhongCho(promise) {
  promise.catch(err => console.error('[GKE] Lỗi ghi log nền:', err.message));
}

// Giá trị tạm ghi vào TRACKING_ID NGAY SAU KHI order/create/ thành công, TRƯỚC KHI thử lấy tem —
// đóng lại "khoảng hở" nguy hiểm: nếu không ghi gì cho tới lúc có tem thật, mà lấy tem lại thất bại
// (GKE cần thời gian generate tem, có thể chưa xong ngay — xem gkeService.layTemIn), quét lại đơn
// sẽ hiểu nhầm "chưa tạo đơn" và gọi order/create/ THÊM 1 LẦN, tạo ra 2 vận đơn thật trùng nhau bên
// GKE. Phát hiện qua test thật 01/09/2026. Giá trị này KHÔNG PHẢI mã vận đơn thật — nhân viên nhìn
// trong Sheet thấy giá trị này thì biết đơn đang chờ, không phải lỗi hiển thị.
const MA_DANG_CHO_TEM = 'DANG_CHO_GKE_TAO_TEM';

// Tab "Quét mã QR Tracking" (scan.html) — quét mã QR trên tem đã dán (chính là STT_Key), gọi GKE
// Logistics tạo vận đơn thật + lấy tem in, rồi TỰ ĐỘNG mở hộp thoại in ở trình duyệt (client lo,
// xem scan.html). Đơn phải đang đúng "Đã đóng gói" mới cho làm (quyết định cùng người dùng
// 31/08/2026). Mở cho CẢ 4 vai trò — không giới hạn gì thêm ngoài requireLogin ở trên.
router.post('/tracking/quet', async (req, res) => {
  const { sttKey } = req.body;
  const user = req.session.user;
  console.log(`[GKE] Quét tracking: sttKey=${sttKey}, nguoiDung=${user && user.ten}`);

  if (!sttKey) return res.status(400).json({ error: 'Thiếu mã đơn' });

  const { row } = await orderService.getByKey(sttKey, { fresh: true });
  if (!row) {
    console.log(`[GKE] Không tìm thấy đơn: ${sttKey}`);
    ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'GKE_QUET_LOI', sttKey, chiTiet: 'Không tìm thấy đơn' }));
    return res.status(404).json({ error: 'Không tìm thấy đơn hàng: ' + sttKey });
  }
  // Cho phép quét khi đang "Đã đóng gói" (lần đầu — sẽ tạo vận đơn + chuyển sang "ĐÃ DÁN TEM" ngay
  // dưới) HOẶC đã "ĐÃ DÁN TEM" từ trước (quét lại để in lại tem cũ, KHÔNG lùi trạng thái). Không cho
  // quét khi đã qua "IN TRANSIT"/"DELIVERED" trở đi — tem đã dán xong từ lâu, quét nhầm không nên
  // đụng vào đơn nữa.
  if (row.TINH_TRANG !== 'Đã đóng gói' && row.TINH_TRANG !== 'ĐÃ DÁN TEM') {
    console.log(`[GKE] Sai trạng thái: ${sttKey} đang ở "${row.TINH_TRANG}"`);
    ghiKhongCho(ghiLog({
      nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'GKE_QUET_SAI_TRANG_THAI', sttKey,
      chiTiet: { trangThaiHienTai: row.TINH_TRANG },
    }));
    return res.status(400).json({
      error: `Đơn đang ở "${row.TINH_TRANG}" — phải "Đã đóng gói" hoặc "ĐÃ DÁN TEM" mới tạo/in được vận đơn GKE.`,
    });
  }

  const chuaTungTaoDon = !row.TRACKING_ID; // trống hẳn = chưa từng gọi order/create/ lần nào
  const dangChoTuLanTruoc = row.TRACKING_ID === MA_DANG_CHO_TEM; // đã tạo đơn ở lượt trước, lần đó lấy tem chưa xong

  // Bước 1: tạo vận đơn GKE — CHỈ khi thực sự chưa từng tạo (trống hẳn). Nếu đang ở trạng thái
  // "chờ tem" từ lần quét trước, KHÔNG được gọi lại order/create/ — đơn thật đã tồn tại bên GKE rồi.
  if (chuaTungTaoDon) {
    try {
      await gkeService.taoDonGke(row);
    } catch (err) {
      console.error(`[GKE] Lỗi khi tạo vận đơn cho ${sttKey}:`, err.stack || err.message);
      ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'GKE_TAO_VAN_DON_LOI', sttKey, chiTiet: { loi: err.message } }));
      return res.status(502).json({ error: 'Không tạo được vận đơn GKE: ' + err.message });
    }

    // Tạo THÀNH CÔNG — ghi placeholder NGAY để khoá không tạo trùng, trước khi thử lấy tem.
    try {
      await orderService.update(sttKey, { TRACKING_ID: MA_DANG_CHO_TEM }, user);
    } catch (err) {
      console.error(`[GKE] Tạo vận đơn THÀNH CÔNG cho ${sttKey} nhưng LỖI khi ghi placeholder vào Sheet:`, err.stack || err.message);
      ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'GKE_GHI_SHEET_LOI', sttKey, chiTiet: { loi: err.message } }));
      return res.status(502).json({
        error: `Đã tạo vận đơn GKE thành công nhưng LỖI khi ghi vào Sheet: ${err.message} — `
          + `KHÔNG quét lại đơn này (sẽ tạo vận đơn trùng), báo IT kiểm tra Sheet trước.`,
      });
    }
  }

  // Bước 2: lấy tem — thử lại vài lần nếu GKE báo "chưa sẵn sàng" (chỉ áp dụng khi vừa tạo/đang chờ
  // từ trước, xem gkeService.layTemIn). Đơn đã có mã vận đơn thật rồi thì chỉ gọi 1 lần, không cần đợi.
  let ketQuaTem;
  try {
    ketQuaTem = await gkeService.layTemIn(row, { laLanDauSauKhiTao: chuaTungTaoDon || dangChoTuLanTruoc });
  } catch (err) {
    console.error(`[GKE] Lỗi khi lấy tem cho ${sttKey}:`, err.stack || err.message);
    ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'GKE_LAY_TEM_LOI', sttKey, chiTiet: { loi: err.message } }));
    return res.status(502).json({
      error: `Vận đơn GKE đã tồn tại nhưng CHƯA lấy được tem: ${err.message} — quét lại đơn này sau `
        + `để thử lấy tem tiếp (sẽ KHÔNG tạo vận đơn mới, đơn đang ở trạng thái chờ).`,
    });
  }

  // Lấy tem THÀNH CÔNG — ghi đúng mã vận đơn thật + hãng vận chuyển, thay cho placeholder (nếu có).
  // Luôn kèm TINH_TRANG='ĐÃ DÁN TEM' — vô hại khi ghi lại đúng giá trị cũ (trường hợp quét lại để in
  // lại tem, xem gate check ở trên và kiemTraCongAnhBatBuoc trong services/orderService.js).
  await orderService.update(sttKey, {
    TRACKING_ID: ketQuaTem.tracking_num,
    HANG_VAN_CHUYEN: ketQuaTem.delivery_carrier,
    TINH_TRANG: 'ĐÃ DÁN TEM',
  }, user);

  ghiKhongCho(ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro,
    hanhDong: chuaTungTaoDon ? 'GKE_TAO_VAN_DON' : 'GKE_IN_LAI_TEM',
    sttKey, chiTiet: { trackingNum: ketQuaTem.tracking_num, hangVanChuyen: ketQuaTem.delivery_carrier },
  }));

  console.log(`[GKE] Thành công: ${sttKey} — mã ${ketQuaTem.tracking_num}, hãng ${ketQuaTem.delivery_carrier}`);
  res.json({
    ok: true,
    // true nếu đây là lần ĐẦU TIÊN đơn này có tem thật (mới tạo ngay bây giờ, hoặc vừa hoàn tất lấy
    // tem đang chờ từ lượt quét trước) — false nếu chỉ đơn giản in lại tem đã có sẵn từ lâu.
    daTaoMoi: chuaTungTaoDon || dangChoTuLanTruoc,
    sttKey,
    trackingNum: ketQuaTem.tracking_num,
    hangVanChuyen: ketQuaTem.delivery_carrier,
    labelBase64: ketQuaTem.label_base64,
  });
});

module.exports = router;
