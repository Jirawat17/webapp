const { readTab, readTabCached, updateCells } = require('./sheetsService');
const { layBanDoTenKhachHang } = require('./khachHangService');
const { chiSoTinhTrang } = require('../data/pipelineTinhTrang');

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

// TỰ ĐỘNG chuyển TINH_TRANG sang "ĐÃ SẴN SÀNG CHẠY MÁY" khi cả phôi lẫn file vẽ CÙNG xong — nhưng
// CHỈ áp dụng lần đầu (khi TINH_TRANG đang là "Đã xác nhận"). Sau khi đơn bị lỗi rồi làm lại từ phôi/
// file, việc quay lại "ĐÃ SẴN SÀNG CHẠY MÁY" lần 2 KHÔNG tự động — người phụ trách phải tự set tay
// (đã xác nhận rõ với người dùng, xem data/pipelineTinhTrang.js). Hàm này không tự đổi TINH_TRANG
// nếu người gọi đã tự chỉ định TINH_TRANG trong chính updates đó — tôn trọng giá trị người dùng
// muốn set tay, không ghi đè.
function tinhTinhTrangTuDong(rowHienTai, updates) {
  if ('TINH_TRANG' in updates) return updates; // người gọi đã tự set — không can thiệp

  const phoiMoi = updates.TRANG_THAI_PHOI ?? rowHienTai.TRANG_THAI_PHOI;
  const veFileMoi = updates.TRANG_THAI_VE_FILE ?? rowHienTai.TRANG_THAI_VE_FILE;
  const caPhoiVaFileXong = phoiMoi === 'Đã lấy phôi' && veFileMoi === 'Đã vẽ file';

  if (caPhoiVaFileXong && rowHienTai.TINH_TRANG === 'Đã xác nhận') {
    return { ...updates, TINH_TRANG: 'ĐÃ SẴN SÀNG CHẠY MÁY' };
  }
  return updates;
}

async function update(sttKey, updates) {
  const { headers, row } = await getByKey(sttKey, { fresh: true }); // luôn đọc thật trước khi ghi
  if (!row) throw new Error('Không tìm thấy đơn hàng: ' + sttKey);

  const updatesDaTinh = tinhTinhTrangTuDong(row, updates);

  await updateCells(TAB, headers, row._row, updatesDaTinh); // tự xoá cache của tab sau khi ghi (xem sheetsService)
  return { ...row, ...updatesDaTinh };
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

// CHÍNH SÁCH PHÂN QUYỀN (cập nhật 24/08/2026, theo Prompt_Ver_24.docx — HUỶ chính sách "mọi vai trò
// như Admin" trước đó): hệ thống giờ có 4 vai trò (admin, nguoi_lay_phoi, ve_file, san_xuat —
// quan_ly bị xoá hẳn, dong_goi gộp vào nguoi_lay_phoi).
//   - admin, ve_file: xem TOÀN BỘ đơn, không lọc gì.
//   - san_xuat: CHỈ thấy đơn đã tới "ĐÃ SẴN SÀNG CHẠY MÁY" trở đi (kể cả trạng thái lỗi
//     "LỖI SẢN XUẤT CẦN LÀM LẠI"), không thấy đơn còn ở "Chưa xác nhận"/"Đã xác nhận". Đơn đã
//     CANCELLED/REFUNDED không nằm trong THU_TU_TINH_TRANG (nhánh rẽ) nên tự động bị loại — chỉ
//     admin/ve_file mới thấy đơn huỷ/hoàn, giữ đúng thói quen cũ (trước đây chỉ admin/quan_ly thấy).
//   - nguoi_lay_phoi: KHÔNG dùng route GET /orders (danh sách) — vai trò này chỉ có đúng 1 menu
//     "Quét mã QR" ở giao diện (xem public/js/api.js renderNav), không có trang danh sách đơn để
//     vào. Không cần lọc riêng ở đây.
function filterForRole(rows, user) {
  if (user.vaiTro === 'san_xuat') {
    const idxSanSang = chiSoTinhTrang('ĐÃ SẴN SÀNG CHẠY MÁY');
    return rows.filter(r => {
      if (r.TINH_TRANG === 'LỖI SẢN XUẤT CẦN LÀM LẠI') return true;
      const idx = chiSoTinhTrang(r.TINH_TRANG);
      return idx !== null && idx >= idxSanSang;
    });
  }
  return rows; // admin, ve_file — xem tất cả
}

module.exports = { TAB, KEY_COL, getAll, getByKey, update, filterForRole, ganTenKhachHang, tieuDeSanPham, danhSachViTriTheu };
