const { readTab, readTabCached, updateCells } = require('./sheetsService');
const { layBanDoTenKhachHang } = require('./khachHangService');
const { chuaXongGiaiDoan, TRANG_THAI_DA_SHIP, TRANG_THAI_KET_THUC } = require('../data/pipelineTinhTrang');

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

// true nếu đơn đã ra khỏi phạm vi 5 giai đoạn sản xuất (đã ship/đã giao/đã huỷ/đã hoàn). Dùng để
// loại các đơn này khỏi màn hình chuan_bi_phoi/ve_file — chuaXongGiaiDoan() coi trạng thái lạ/đã
// ship là "chưa xong" (an toàn cho việc tính cảnh báo), nhưng ở ĐÂY ý nghĩa cần NGƯỢC LẠI: đơn đã
// ship rồi thì không còn liên quan gì tới người nhặt phôi/vẽ file nữa — nếu không loại riêng, các
// đơn này sẽ bị lọt vào danh sách của 2 vai trò đó (lỗi thật đã xảy ra, đã kiểm tra lại bằng cách
// mô phỏng filterForRole với đủ 16 trạng thái).
function daRoiKhoiSanXuat(tinhTrang) {
  return TRANG_THAI_DA_SHIP.includes(tinhTrang) || TRANG_THAI_KET_THUC.includes(tinhTrang);
}

// Mỗi vai trò chỉ thấy đúng phần việc của mình, dựa trên giai đoạn hiện tại trong pipeline mới:
// GĐ1 xác nhận -> GĐ2 lấy phôi -> GĐ3 vẽ file -> GĐ4 sản xuất -> GĐ5 đóng gói -> (ship...)
// Sửa data/pipelineTinhTrang.js nếu quy trình thực tế thay đổi.
function filterForRole(rows, user) {
  switch (user.vaiTro) {
    case 'chuan_bi_phoi': // lo phần lấy phôi — quan tâm đơn CHƯA có phôi (GĐ2 chưa xong), trừ đơn đã ship/huỷ/hoàn
      return rows.filter(r => chuaXongGiaiDoan(r.TINH_TRANG, 2) && !daRoiKhoiSanXuat(r.TINH_TRANG));
    case 've_file': // lo phần vẽ file — quan tâm đơn CHƯA vẽ xong file (GĐ3 chưa xong), trừ đơn đã ship/huỷ/hoàn
      return rows.filter(r => chuaXongGiaiDoan(r.TINH_TRANG, 3) && !daRoiKhoiSanXuat(r.TINH_TRANG));
    case 'san_xuat': // đơn đã đủ điều kiện sản xuất (đã vẽ xong file, GĐ3 xong) trở đi, tới trước khi ship —
      // LƯU Ý: !chuaXongGiaiDoan(...,3) một mình đã tự loại đơn ship/huỷ/hoàn (nhờ tác dụng phụ của
      // "trạng thái lạ = chưa xong"), nhưng vẫn viết tường minh !daRoiKhoiSanXuat() ở đây để không
      // phải suy luận qua hiệu ứng phụ mới hiểu đúng — tránh lặp lại đúng kiểu lỗi ở 2 vai trò trên.
      return rows.filter(r => !chuaXongGiaiDoan(r.TINH_TRANG, 3) && !daRoiKhoiSanXuat(r.TINH_TRANG));
    case 'dong_goi': // đơn đã sản xuất xong (GĐ4 xong) trở đi, gồm cả đã ship/đã giao (để tiện theo dõi
      // tới lúc giao xong) — nhưng KHÔNG gồm đã huỷ/đã hoàn (TRANG_THAI_DA_SHIP không chứa 2 trạng
      // thái đó, xem data/pipelineTinhTrang.js).
      return rows.filter(r => !chuaXongGiaiDoan(r.TINH_TRANG, 4) || TRANG_THAI_DA_SHIP.includes(r.TINH_TRANG));
    default: // admin, quan_ly — xem tất cả
      return rows;
  }
}

module.exports = { TAB, KEY_COL, getAll, getByKey, update, filterForRole, ganTenKhachHang, tieuDeSanPham, danhSachViTriTheu };
