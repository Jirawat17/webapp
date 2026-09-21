// Lịch quét tự động mua tracking — mẫu giống hệt services/canhBaoJob.js. Chạy mỗi 2 phút (KHÔNG
// phải 30 phút như cảnh báo) vì số phút chờ (x) do người dùng tự nhập ở trang "Tracking" có thể khá
// ngắn — quét dày hơn để độ trễ thực tế sát với x đã chọn hơn (lệch tối đa ~2 phút thay vì tối đa 30
// phút nếu dùng chung lịch với cảnh báo).
const cron = require('node-cron');
const { chayQuetTuDongMuaTracking, chayQuetTrangThaiNeuDenLuot } = require('./trackingAutoService');

// Chặn 2 lượt chồng nhau (bổ sung 22/09/2026, theo yêu cầu người dùng cải thiện hiệu năng) — lịch chạy
// mỗi 2 phút, mỗi đơn đủ điều kiện gọi GKE thật (tạo vận đơn/lấy tem, có thể mất vài giây/đơn, xem
// services/gkeService.js). Nếu 1 lượt xử lý nhiều đơn cùng lúc kéo dài quá 2 phút, tick kế tiếp trước
// đây sẽ chạy CHỒNG lên lượt đang xử lý — cùng 1 đơn "đủ điều kiện" có thể bị 2 lượt cùng cố mua
// tracking, rủi ro tạo trùng vận đơn thật bên GKE (dù goiApi() đã tự nhận diện "đã tồn tại" code 301,
// vẫn tốn 1 lượt gọi thừa + có khoảng hở trước khi kịp nhận diện). Bỏ qua tick này thay vì xếp hàng —
// lượt sau (2 phút nữa) sẽ tự quét lại đúng đơn đó nếu vẫn còn đủ điều kiện.
let dangChayKiemTraTracking = false;
async function chayKiemTraTracking() {
  if (dangChayKiemTraTracking) {
    console.log('[TrackingTuDong] Bỏ qua lượt quét mua tracking này — lượt trước vẫn đang chạy.');
    return;
  }
  dangChayKiemTraTracking = true;
  try {
    const ketQua = await chayQuetTuDongMuaTracking();
    if (ketQua.daQuet && ketQua.soDonDaMua > 0) {
      console.log(`[TrackingTuDong] Đã tự động mua tracking cho ${ketQua.soDonDaMua}/${ketQua.tongSoDuDieuKien} đơn đủ điều kiện.`);
    }
  } catch (err) {
    console.error('[TrackingTuDong] Lỗi khi quét:', err.message);
  } finally {
    dangChayKiemTraTracking = false;
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
// Cùng lý do chặn chồng lượt như chayKiemTraTracking() ở trên — tick mỗi 5 phút, 1 lượt "đến hạn" xử lý
// nhiều đơn có thể kéo dài hơn 5 phút (dù đã song song hoá ở nơi khác, vẫn tuần tự gọi GKE ở đây).
let dangChayCapNhatTrangThaiTracking = false;
async function chayCapNhatTrangThaiTracking() {
  if (dangChayCapNhatTrangThaiTracking) {
    console.log('[TrackingTuDong] Bỏ qua tick này — lượt cập nhật trạng thái tracking trước vẫn đang chạy.');
    return;
  }
  dangChayCapNhatTrangThaiTracking = true;
  try {
    const ketQua = await chayQuetTrangThaiNeuDenLuot();
    if (ketQua.daChayLuotNay) {
      console.log(`[TrackingTuDong] Đã cập nhật trạng thái tracking cho ${ketQua.soDaCapNhat}/${ketQua.tongSoCoTracking} đơn có tracking (bỏ qua ${ketQua.soDaBoQuaDaXong} đơn đã giao xong).`);
    }
  } catch (err) {
    console.error('[TrackingTuDong] Lỗi khi cập nhật trạng thái tracking:', err.message);
  } finally {
    dangChayCapNhatTrangThaiTracking = false;
  }
}

function batDauLichTracking() {
  cron.schedule('*/2 * * * *', chayKiemTraTracking);
  console.log('[TrackingTuDong] Đã bật lịch quét tự động mua tracking (mỗi 2 phút).');
  cron.schedule('*/5 * * * *', chayCapNhatTrangThaiTracking);
  console.log('[TrackingTuDong] Đã bật lịch kiểm tra đến lượt cập nhật trạng thái tracking (tick mỗi 5 phút — khoảng cách quét thật tự chỉnh được ở giao diện Tracking).');
}

module.exports = { batDauLichTracking, chayKiemTraTracking, chayCapNhatTrangThaiTracking };
