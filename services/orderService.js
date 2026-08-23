const { readTab, readTabCached, updateCells } = require('./sheetsService');
const { layBanDoTenKhachHang } = require('./khachHangService');
const { chiSoGiaiDoan } = require('../data/pipelineTinhTrang');

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

// Không có cột "tên sản phẩm" riêng — ghép từ LOAI + KICH_THUOC + MAU_SAC cho dễ nhận diện trên danh sách
function tieuDeSanPham(don) {
  const phan = [don.LOAI, don.KICH_THUOC, don.MAU_SAC].filter(Boolean);
  return phan.length ? phan.join(' · ') : (don.MA_DON_HANG_ORDERID || don.STT_Key || '');
}

// Vị trí thêu — gộp 3 cột VI_TRI_1/2/3, bỏ ô trống
function danhSachViTriTheu(don) {
  return [don.VI_TRI_1, don.VI_TRI_2, don.VI_TRI_3].filter(Boolean);
}

// Mỗi vai trò chỉ thấy đúng phần việc của mình, dựa trên vị trí hiện tại trong pipeline TINH_TRANG thật:
// B0 (chờ xác nhận) → B1 (đã in) → B2 (đã lấy phôi) → B3 (đủ phôi+file) → B4 (đang sx) → B5 (đã sx) → SHIPPED...
// Sửa data/pipelineTinhTrang.js nếu quy trình thực tế thay đổi.
function filterForRole(rows, user) {
  const chiSo = (r) => chiSoGiaiDoan(r.TINH_TRANG);
  const idxB2 = chiSoGiaiDoan('B2_Đã lấy phôi');
  const idxB3 = chiSoGiaiDoan('B3_Đã đủ Phôi và File Vẽ');
  const idxB5 = chiSoGiaiDoan('B5_Đã sản xuất');
  const idxShipped = chiSoGiaiDoan('SHIPPED_Đã gửi vận chuyển');

  switch (user.vaiTro) {
    case 'chuan_bi_phoi': // tương đương NguoiLayPhoi — lo phần lấy phôi, quan tâm đơn CHƯA tới B2
      return rows.filter(r => chiSo(r) === null || chiSo(r) < idxB2);
    case 've_file': // lo phần vẽ file, quan tâm đơn CHƯA tới B3 (đủ phôi + file)
      return rows.filter(r => chiSo(r) === null || chiSo(r) < idxB3);
    case 'san_xuat': // đơn đã đủ điều kiện sản xuất: từ B3 đến B5, chưa ship
      return rows.filter(r => chiSo(r) !== null && chiSo(r) >= idxB3 && chiSo(r) < idxShipped);
    case 'dong_goi': // đơn đã sản xuất xong, sắp/đang ship
      return rows.filter(r => chiSo(r) !== null && chiSo(r) >= idxB5);
    default: // admin, quan_ly — xem tất cả
      return rows;
  }
}

module.exports = { TAB, KEY_COL, getAll, getByKey, update, filterForRole, ganTenKhachHang, tieuDeSanPham, danhSachViTriTheu };
