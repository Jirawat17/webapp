// Theo dõi nhân viên nào đang hoạt động (có request tới server) trong vài phút gần đây — dùng cho
// Bảng điều khiển admin ("ai đang đăng nhập ngay bây giờ"). Lưu trong bộ nhớ (Map), mất khi restart
// server — chấp nhận được, giống mô hình _lanSaiMatKhau ở routes/auth.js. KHÔNG đọc trực tiếp session
// store: cookie sống 30 ngày (server.js) và MemoryStore mặc định không tự dọn session hết hạn/đóng
// tab, nên sẽ hiện "ma" — người đã đăng nhập cả tháng trước nhưng không còn ở máy. "Lần cuối có
// request" phản ánh đúng hơn ai thực sự đang thao tác ngay lúc này.
const _lanHoatDongCuoi = new Map(); // ten -> { vaiTro, luc }

function ghiNhanHoatDong(user) {
  if (!user || !user.ten) return;
  _lanHoatDongCuoi.set(user.ten, { vaiTro: user.vaiTro, luc: Date.now() });
}

function layDangHoatDong(nguongPhut = 5) {
  const nguong = Date.now() - nguongPhut * 60 * 1000;
  const ketQua = [];
  for (const [ten, tt] of _lanHoatDongCuoi) {
    if (tt.luc >= nguong) ketQua.push({ ten, vaiTro: tt.vaiTro, lanCuoi: new Date(tt.luc).toISOString() });
  }
  return ketQua.sort((a, b) => new Date(b.lanCuoi) - new Date(a.lanCuoi));
}

module.exports = { ghiNhanHoatDong, layDangHoatDong };
