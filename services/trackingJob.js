// Lịch quét tự động mua tracking — mẫu giống hệt services/canhBaoJob.js. Chạy mỗi 2 phút (KHÔNG
// phải 30 phút như cảnh báo) vì số phút chờ (x) do người dùng tự nhập ở trang "Tracking" có thể khá
// ngắn — quét dày hơn để độ trễ thực tế sát với x đã chọn hơn (lệch tối đa ~2 phút thay vì tối đa 30
// phút nếu dùng chung lịch với cảnh báo).
const cron = require('node-cron');
const { chayQuetTuDongMuaTracking, chayQuetTrangThaiNeuDenLuot } = require('./trackingAutoService');

async function chayKiemTraTracking() {
  try {
    const ketQua = await chayQuetTuDongMuaTracking();
    if (ketQua.daQuet && ketQua.soDonDaMua > 0) {
      console.log(`[TrackingTuDong] Đã tự động mua tracking cho ${ketQua.soDonDaMua}/${ketQua.tongSoDuDieuKien} đơn đủ điều kiện.`);
    }
  } catch (err) {
    console.error('[TrackingTuDong] Lỗi khi quét:', err.message);
  }
}

// Cập nhật trạng thái tracking THẬT (bổ sung 14/09/2026, theo yêu cầu người dùng — xem
// docs/superpowers/specs/2026-09-14-cap-nhat-trang-thai-tracking-design.md) — lịch tick CỐ ĐỊNH mỗi 5
// phút (KHÁC lịch mua tracking 2 phút ở trên vì trạng thái vận chuyển đổi chậm hơn nhiều), nhưng
// KHÔNG chạy lượt quét thật ở MỌI tick — chayQuetTrangThaiNeuDenLuot() tự so sánh với khoảng cách
// người dùng cấu hình trên giao diện Tracking (giờ+phút, mặc định 2 tiếng nếu chưa từng chỉnh) để
// quyết định có đến lượt hay chưa (bổ sung 21/09/2026, theo yêu cầu người dùng — cho chỉnh khoảng cách
// này trực tiếp trên UI thay vì sửa code/deploy lại; xem trackingAutoService.js#layCauHinhQuetTrangThai
// để biết vì sao KHÔNG đổi lịch cron trực tiếp theo cấu hình).
async function chayCapNhatTrangThaiTracking() {
  try {
    const ketQua = await chayQuetTrangThaiNeuDenLuot();
    if (ketQua.daChayLuotNay) {
      console.log(`[TrackingTuDong] Đã cập nhật trạng thái tracking cho ${ketQua.soDaCapNhat}/${ketQua.tongSoCoTracking} đơn có tracking (bỏ qua ${ketQua.soDaBoQuaDaXong} đơn đã giao xong).`);
    }
  } catch (err) {
    console.error('[TrackingTuDong] Lỗi khi cập nhật trạng thái tracking:', err.message);
  }
}

function batDauLichTracking() {
  cron.schedule('*/2 * * * *', chayKiemTraTracking);
  console.log('[TrackingTuDong] Đã bật lịch quét tự động mua tracking (mỗi 2 phút).');
  cron.schedule('*/5 * * * *', chayCapNhatTrangThaiTracking);
  console.log('[TrackingTuDong] Đã bật lịch kiểm tra đến lượt cập nhật trạng thái tracking (tick mỗi 5 phút — khoảng cách quét thật tự chỉnh được ở giao diện Tracking).');
}

module.exports = { batDauLichTracking, chayKiemTraTracking, chayCapNhatTrangThaiTracking };
