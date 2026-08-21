function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Chưa đăng nhập' });
  next();
}

// admin luôn được phép làm mọi thao tác, không cần liệt kê riêng trong từng route
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Chưa đăng nhập' });
    if (req.session.user.vaiTro === 'admin') return next();
    if (!roles.includes(req.session.user.vaiTro)) {
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này' });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole };
