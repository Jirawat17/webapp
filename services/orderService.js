const { readTab, readTabCached, updateCells } = require('./sheetsService');
const { layBanDoTenKhachHang } = require('./khachHangService');

const TAB = 'Don_Hang_ALL';
const KEY_COL = 'STT_Key';

// Mặc định đọc qua cache (nhanh, dữ liệu có thể cũ tối đa vài giây) — dùng cho hiển thị/kiểm tra.
// Truyền { fresh: true } để BẮT BUỘC đọc thật từ Google Sheets — LUÔN dùng trước khi ghi (update())
// để không bao giờ ghi nhầm dòng nếu vừa có ai thêm/xoá dòng khác ở nơi khác.
async function getAll({ fresh = false } = {}) {
  return fresh ? readTab(TAB) : readTabCached(TAB, 5000);
}

async function getByKey(sttKey, opts) {
  const { headers, rows } = await getAll(opts);
  const row = rows.find(r => r[KEY_COL] === sttKey);
  return { headers, row };
}

async function update(sttKey, updates) {
  const { headers, row } = await getByKey(sttKey, { fresh: true }); // luôn đọc thật trước khi ghi
  if (!row) throw new Error('Không tìm thấy đơn hàng: ' + sttKey);
  await updateCells(TAB, headers, row._row, updates); // tự xoá cache của tab sau khi ghi (xem sheetsService)
  return { ...row, ...updates };
}

// Đơn chỉ lưu MA_KHACH_HANG (mã) — gắn thêm tên khách hàng thật để hiển thị, không sửa dữ liệu gốc
async function ganTenKhachHang(rows) {
  const banDo = await layBanDoTenKhachHang();
  return rows.map(r => ({ ...r, TenKhachHang: banDo[r.MA_KHACH_HANG] || r.MA_KHACH_HANG || '' }));
}

// Không có cột "tên sản phẩm" riêng — ghép STT_Key (mã đơn, để dễ nhận diện ngay) + LOAI + KICH_THUOC
// + MAU_SAC. Dùng dấu "·" để nhất quán với cách hiển thị các cụm ghép khác trong toàn app.
function tieuDeSanPham(don) {
  const phanSanPham = [don.LOAI, don.KICH_THUOC, don.MAU_SAC].filter(Boolean);
  const phan = [don.STT_Key, ...phanSanPham].filter(Boolean);
  return phan.length ? phan.join(' · ') : (don.MA_DON_HANG_ORDERID || '');
}

// Vị trí thêu — gộp 3 cột VI_TRI_1/2/3, bỏ ô trống
function danhSachViTriTheu(don) {
  return [don.VI_TRI_1, don.VI_TRI_2, don.VI_TRI_3].filter(Boolean);
}

// CHÍNH SÁCH PHÂN QUYỀN (cập nhật): mọi tài khoản đã đăng nhập đều xem được TOÀN BỘ đơn hàng, giống
// hệt admin — không còn phân biệt theo vai trò như trước (chuan_bi_phoi/ve_file/san_xuat/dong_goi
// từng chỉ thấy đúng phần việc của mình). Giới hạn DUY NHẤT còn lại trong toàn hệ thống là: chỉ admin
// mới Thêm/Sửa/Khóa/Hủy khóa được TÀI KHOẢN người dùng khác (xem routes/users.js, không liên quan gì
// tới file này). Giữ lại hàm này (thay vì xóa hẳn + sửa mọi nơi gọi tới) để nếu sau này cần khôi phục
// lọc theo vai trò thì chỉ cần sửa đúng 1 chỗ.
function filterForRole(rows, user) {
  return rows;
}

module.exports = { TAB, KEY_COL, getAll, getByKey, update, filterForRole, ganTenKhachHang, tieuDeSanPham, danhSachViTriTheu };
