// Lịch quét tự động mua tracking — mẫu giống hệt services/canhBaoJob.js. Chạy mỗi 2 phút (KHÔNG
// phải 30 phút như cảnh báo) vì số phút chờ (x) do người dùng tự nhập ở trang "Tracking" có thể khá
// ngắn — quét dày hơn để độ trễ thực tế sát với x đã chọn hơn (lệch tối đa ~2 phút thay vì tối đa 30
// phút nếu dùng chung lịch với cảnh báo).
const cron = require('node-cron');
const { chayQuetTuDongMuaTracking } = require('./trackingAutoService');

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

function batDauLichTracking() {
  cron.schedule('*/2 * * * *', chayKiemTraTracking);
  console.log('[TrackingTuDong] Đã bật lịch quét tự động mua tracking (mỗi 2 phút).');
}

module.exports = { batDauLichTracking, chayKiemTraTracking };
