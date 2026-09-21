// Lịch quét tự động mua tracking — mẫu giống hệt services/canhBaoJob.js. Chạy mỗi 2 phút (KHÔNG
// phải 30 phút như cảnh báo) vì số phút chờ (x) do người dùng tự nhập ở trang "Tracking" có thể khá
// ngắn — quét dày hơn để độ trễ thực tế sát với x đã chọn hơn (lệch tối đa ~2 phút thay vì tối đa 30
// phút nếu dùng chung lịch với cảnh báo).
const cron = require('node-cron');
const { chayQuetTuDongMuaTracking, chayQuetCapNhatTrangThaiTracking } = require('./trackingAutoService');

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
// docs/superpowers/specs/2026-09-14-cap-nhat-trang-thai-tracking-design.md) — lịch RIÊNG, thưa hơn hẳn
// (mỗi 2 tiếng, rút từ 4 tiếng ngày 21/09/2026 theo yêu cầu người dùng — thấy được cập nhật sớm hơn;
// đơn đã giao xong tự động bị loại khỏi lượt quét, xem daGiaoThanhCongGke() trong trackingAutoService.js,
// nên rút ngắn không làm tăng vô hạn số lượt gọi GKE) so với lịch mua tracking (2 phút) vì trạng thái
// vận chuyển đổi chậm hơn nhiều so với việc cần mua tracking đúng lúc.
async function chayCapNhatTrangThaiTracking() {
  try {
    const ketQua = await chayQuetCapNhatTrangThaiTracking();
    console.log(`[TrackingTuDong] Đã cập nhật trạng thái tracking cho ${ketQua.soDaCapNhat}/${ketQua.tongSoCoTracking} đơn có tracking (bỏ qua ${ketQua.soDaBoQuaDaXong} đơn đã giao xong).`);
  } catch (err) {
    console.error('[TrackingTuDong] Lỗi khi cập nhật trạng thái tracking:', err.message);
  }
}

function batDauLichTracking() {
  cron.schedule('*/2 * * * *', chayKiemTraTracking);
  console.log('[TrackingTuDong] Đã bật lịch quét tự động mua tracking (mỗi 2 phút).');
  cron.schedule('0 */2 * * *', chayCapNhatTrangThaiTracking);
  console.log('[TrackingTuDong] Đã bật lịch cập nhật trạng thái tracking thật (mỗi 2 tiếng).');
}

module.exports = { batDauLichTracking, chayKiemTraTracking, chayCapNhatTrangThaiTracking };
