// superadmin (bổ sung 18/09/2026, theo yêu cầu người dùng) — có MỌI quyền admin đang có. Giữ
// superadmin là giá trị THẬT SỰ khác 'admin' (không gộp/alias vào session) — log hoạt động vẫn phân
// biệt được ai làm gì, và dễ tách quyền riêng cho superadmin sau này nếu cần. Nhưng MỌI chỗ trong
// toàn app kiểm tra "chỉ admin mới được..." PHẢI dùng laAdmin()/VAI_TRO_ADMIN này thay vì so sánh
// thẳng chuỗi 'admin', để không bao giờ thiếu sót — đã rà và sửa toàn bộ các chỗ đó theo đúng quy ước
// này (routes/services/trang html), xem lịch sử git ngày 18/09/2026.
const VAI_TRO_ADMIN = ['admin', 'superadmin'];
function laAdmin(vaiTro) {
  return VAI_TRO_ADMIN.includes(vaiTro);
}

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Chưa đăng nhập' });
  next();
}

// admin/superadmin luôn được phép làm mọi thao tác, không cần liệt kê riêng trong từng route
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Chưa đăng nhập' });
    if (laAdmin(req.session.user.vaiTro)) return next();
    if (!roles.includes(req.session.user.vaiTro)) {
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này' });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole, laAdmin, VAI_TRO_ADMIN };
