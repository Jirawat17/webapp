const { readTab } = require('./sheetsService');

const TAB = 'Khach_Hang';

// Trả về danh sách khách hàng {ma, ten, tinhTrang}
async function layDanhSachKhachHang() {
  const { rows } = await readTab(TAB);
  return rows
    .filter(r => r.MA_KHACH_HANG)
    .map(r => ({ ma: r.MA_KHACH_HANG, ten: r.TEN_KHACH_HANG || r.MA_KHACH_HANG, tinhTrang: r.TINH_TRANG || '' }));
}

// Map mã -> tên, dùng để gắn tên khách hàng thật vào từng đơn hàng (đơn chỉ lưu mã, không lưu tên)
async function layBanDoTenKhachHang() {
  const list = await layDanhSachKhachHang();
  const map = {};
  list.forEach(kh => { map[kh.ma] = kh.ten; });
  return map;
}

module.exports = { layDanhSachKhachHang, layBanDoTenKhachHang };
