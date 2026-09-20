const { readTabCached } = require('./sheetsService');

const TAB = 'Khach_Hang';

// Trả về danh sách khách hàng {ma, ten, tinhTrang} — cache 60s vì bảng khách hàng rất ít khi đổi
async function layDanhSachKhachHang() {
  const { rows } = await readTabCached(TAB, 60000);
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

// Thông tin Sheet RIÊNG của 1 khách hàng — dùng để đẩy tracking sang sau khi mua GKE (bổ sung
// 21/09/2026, theo yêu cầu người dùng, xem services/customerSheetService.js). 2 cột MỚI người dùng tự
// thêm tay vào tab Khach_Hang: SHEET_ID_KHACH_HANG (spreadsheet ID của khách) + TEN_TAB_KHACH_HANG (tên
// tab đích — MỖI khách hàng có thể đặt tên tab khác nhau, không cố định). App CHỈ ĐỌC, không bao giờ
// ghi vào tab Khach_Hang này. Khách hàng chưa điền đủ CẢ 2 cột -> trả về null, nơi gọi tự BỎ QUA việc
// đẩy tracking cho khách đó (KHÔNG coi là lỗi — đa số khách hàng sẽ chưa cấu hình tính năng này).
async function layThongTinSheetKhachHang(maKhachHang) {
  const { rows } = await readTabCached(TAB, 60000);
  const dong = rows.find(r => r.MA_KHACH_HANG === maKhachHang);
  if (!dong || !dong.SHEET_ID_KHACH_HANG || !dong.TEN_TAB_KHACH_HANG) return null;
  return { spreadsheetId: dong.SHEET_ID_KHACH_HANG, tenTab: dong.TEN_TAB_KHACH_HANG };
}

module.exports = { layDanhSachKhachHang, layBanDoTenKhachHang, layThongTinSheetKhachHang };
