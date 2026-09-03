const { readTab, readTabCached, updateCells } = require('./sheetsService');
const { layBanDoTenKhachHang } = require('./khachHangService');
const taiSanService = require('./taiSanService');
const { chiSoTinhTrang, TINH_TRANG_VALUES, TRANG_THAI_PHOI_VALUES, TRANG_THAI_VE_FILE_VALUES } = require('../data/pipelineTinhTrang');

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

const idxSanSang = chiSoTinhTrang('ĐÃ SẴN SÀNG CHẠY MÁY');

// Kiểm tra GIÁ TRỊ hợp lệ cho từng cột riêng lẻ (đúng 1 trong các giá trị định nghĩa sẵn) — chặn
// việc ghi nhầm chuỗi rác/gõ sai chính tả. LƯU Ý: route PUT /orders/:sttKey (sửa 1 đơn) trước đây
// KHÔNG kiểm tra gì cả — có thể ghi bất kỳ chuỗi nào vào thẳng Sheet; route chuyển hàng loạt đã có
// kiểm tra riêng (GIA_TRI_HOP_LE_THEO_COT) nhưng đặt kiểm tra ở ĐÂY (update(), điểm ghi chung duy
// nhất) để CHẮC CHẮN áp dụng cho MỌI đường ghi, kể cả những chỗ lỡ quên tự kiểm tra.
function kiemTraGiaTriHopLe(updates) {
  if ('TRANG_THAI_XUONG' in updates && !TINH_TRANG_VALUES.includes(updates.TRANG_THAI_XUONG)) {
    throw new Error(`Giá trị TRANG_THAI_XUONG không hợp lệ: "${updates.TRANG_THAI_XUONG}"`);
  }
  if ('TRANG_THAI_PHOI' in updates && !TRANG_THAI_PHOI_VALUES.includes(updates.TRANG_THAI_PHOI)) {
    throw new Error(`Giá trị TRANG_THAI_PHOI không hợp lệ: "${updates.TRANG_THAI_PHOI}"`);
  }
  if ('TRANG_THAI_VE_FILE' in updates && !TRANG_THAI_VE_FILE_VALUES.includes(updates.TRANG_THAI_VE_FILE)) {
    throw new Error(`Giá trị TRANG_THAI_VE_FILE không hợp lệ: "${updates.TRANG_THAI_VE_FILE}"`);
  }
}

// Kiểm tra tính HỢP LÝ giữa 3 cột VỚI NHAU — không chỉ đúng giá trị từng cột riêng lẻ mà còn phải
// khớp logic pipeline. 2 quy tắc:
//   1. "Chưa xác nhận" thì KHÔNG THỂ đã có phôi/đã vẽ file (đơn còn chưa được khách xác nhận thì
//      chưa ai chuẩn bị phôi/vẽ file cho đơn đó).
//   2. Đã tới "ĐÃ SẴN SÀNG CHẠY MÁY" hoặc các bước SAU đó trên đường chính (Đã sản xuất, Đã đóng
//      gói, IN TRANSIT, DELIVERED) thì BẮT BUỘC phải có đủ CẢ phôi lẫn file — không tính LỖI SẢN
//      XUẤT CẦN LÀM LẠI/CANCELLED/REFUNDED (nhánh rẽ, không nằm trong THU_TU_TINH_TRANG nên
//      chiSoTinhTrang trả về null, CỐ Ý bỏ qua quy tắc này — lúc lỗi cần được phép reset phôi/file
//      về "chưa" để làm lại từ đầu, xem tinhTinhTrangTuDong ở trên và README).
// Chỉ kiểm tra khi updates THỰC SỰ đụng tới 1 trong 3 cột — sửa các trường khác (GHI_CHU, HANG_VAN_
// CHUYEN...) không bao giờ bị chặn bởi hàm này, kể cả khi dữ liệu cũ của đơn đó lỡ đã sai từ trước.
function kiemTraTinhHopLy(rowHienTai, updates) {
  const dungChamPipeline = 'TRANG_THAI_XUONG' in updates || 'TRANG_THAI_PHOI' in updates || 'TRANG_THAI_VE_FILE' in updates;
  if (!dungChamPipeline) return;

  const tinhTrangMoi = updates.TRANG_THAI_XUONG ?? rowHienTai.TRANG_THAI_XUONG;
  const phoiMoi = updates.TRANG_THAI_PHOI ?? rowHienTai.TRANG_THAI_PHOI;
  const veFileMoi = updates.TRANG_THAI_VE_FILE ?? rowHienTai.TRANG_THAI_VE_FILE;

  if (tinhTrangMoi === 'Chưa xác nhận') {
    if (phoiMoi === 'Đã lấy phôi') {
      throw new Error('Không hợp lệ: đơn đang "Chưa xác nhận" thì chưa thể "Đã lấy phôi" — xác nhận đơn trước.');
    }
    if (veFileMoi === 'Đã vẽ file') {
      throw new Error('Không hợp lệ: đơn đang "Chưa xác nhận" thì chưa thể "Đã vẽ file" — xác nhận đơn trước.');
    }
  }

  const idx = chiSoTinhTrang(tinhTrangMoi);
  if (idx !== null && idx >= idxSanSang) {
    if (phoiMoi !== 'Đã lấy phôi') {
      throw new Error(`Không hợp lệ: đơn đang/sắp ở "${tinhTrangMoi}" nhưng phôi vẫn "${phoiMoi}" — phải có đủ phôi mới tới được giai đoạn này.`);
    }
    if (veFileMoi !== 'Đã vẽ file') {
      throw new Error(`Không hợp lệ: đơn đang/sắp ở "${tinhTrangMoi}" nhưng file vẽ vẫn "${veFileMoi}" — phải vẽ xong file mới tới được giai đoạn này.`);
    }
  }
}

// TỰ ĐỘNG điền TRANG_THAI_PHOI = 'Chưa lấy phôi' và TRANG_THAI_VE_FILE = 'Chưa vẽ file' khi đơn được
// xác nhận (TRANG_THAI_XUONG chuyển từ 'Chưa xác nhận' sang 'Đã xác nhận') — đơn vừa xác nhận thì chưa ai
// kịp lấy phôi/vẽ file, nên đặt sẵn 2 cột này về "chưa" luôn, không phải set tay riêng. Không ghi đè
// nếu người gọi đã tự chỉ định 1 trong 2 cột này trong chính updates đó. Chỉ áp dụng đúng lượt
// chuyển 'Chưa xác nhận' -> 'Đã xác nhận' (không áp dụng khi TRANG_THAI_XUONG đang set lại 'Đã xác nhận'
// từ trạng thái khác, vd sau khi lỗi sản xuất).
function tinhPhoiVeFileTuDongKhiXacNhan(rowHienTai, updates) {
  if (updates.TRANG_THAI_XUONG !== 'Đã xác nhận' || rowHienTai.TRANG_THAI_XUONG !== 'Chưa xác nhận') return updates;

  const ketQua = { ...updates };
  if (!('TRANG_THAI_PHOI' in ketQua)) ketQua.TRANG_THAI_PHOI = 'Chưa lấy phôi';
  if (!('TRANG_THAI_VE_FILE' in ketQua)) ketQua.TRANG_THAI_VE_FILE = 'Chưa vẽ file';
  return ketQua;
}

// TỰ ĐỘNG chuyển TRANG_THAI_XUONG sang "ĐÃ SẴN SÀNG CHẠY MÁY" khi cả phôi lẫn file vẽ CÙNG xong — nhưng
// CHỈ áp dụng lần đầu (khi TRANG_THAI_XUONG đang là "Đã xác nhận"). Sau khi đơn bị lỗi rồi làm lại từ phôi/
// file, việc quay lại "ĐÃ SẴN SÀNG CHẠY MÁY" lần 2 KHÔNG tự động — người phụ trách phải tự set tay
// (đã xác nhận rõ với người dùng, xem data/pipelineTinhTrang.js). Hàm này không tự đổi TRANG_THAI_XUONG
// nếu người gọi đã tự chỉ định TRANG_THAI_XUONG trong chính updates đó — tôn trọng giá trị người dùng
// muốn set tay, không ghi đè.
function tinhTinhTrangTuDong(rowHienTai, updates) {
  if ('TRANG_THAI_XUONG' in updates) return updates; // người gọi đã tự set — không can thiệp

  const phoiMoi = updates.TRANG_THAI_PHOI ?? rowHienTai.TRANG_THAI_PHOI;
  const veFileMoi = updates.TRANG_THAI_VE_FILE ?? rowHienTai.TRANG_THAI_VE_FILE;
  const caPhoiVaFileXong = phoiMoi === 'Đã lấy phôi' && veFileMoi === 'Đã vẽ file';

  if (caPhoiVaFileXong && rowHienTai.TRANG_THAI_XUONG === 'Đã xác nhận') {
    return { ...updates, TRANG_THAI_XUONG: 'ĐÃ SẴN SÀNG CHẠY MÁY' };
  }
  return updates;
}

// "Đã sản xuất" và "Đã đóng gói" chỉ được đặt qua đúng luồng chụp ảnh QR (routes/photos.js — mốc
// da_san_xuat/dong_goi, gọi update() với tuyChon.quaAnh = true). Chặn MỌI đường khác (ô "Sửa trạng
// thái thủ công" ở order.html, kịch bản quét chung trong CauHinhKichBan nếu còn sót cấu hình cũ,
// chuyển hàng loạt...) — bất kể đơn đang ở trạng thái nào trước đó, không chỉ riêng 2 cặp chuyển tiếp
// "chuẩn". admin vẫn ghi đè được (cần 1 lối thoát khi máy ảnh hỏng/QR không đọc được) — đã xác nhận
// rõ với người dùng, chấp nhận rủi ro bị lạm dụng ở mức admin.
// CHỈ chặn khi đây là 1 CHUYỂN ĐỔI THẬT (giá trị mới khác giá trị đang có) — ô "Sửa trạng thái thủ
// công" ở order.html luôn gửi cả 3 cột TRANG_THAI_XUONG/PHOI/VE_FILE cùng lúc kể cả khi người dùng chỉ định
// sửa 1 trong 2 cột kia, nên KHÔNG được chặn nhầm khi TRANG_THAI_XUONG gửi lên trùng với giá trị hiện tại.
const TRANG_THAI_BAT_BUOC_CHUP_ANH = ['Đã sản xuất', 'Đã đóng gói'];

function kiemTraCongAnhBatBuoc(rowHienTai, updates, user, quaAnh) {
  if (!('TRANG_THAI_XUONG' in updates)) return;
  if (updates.TRANG_THAI_XUONG === rowHienTai.TRANG_THAI_XUONG) return; // gửi lại đúng giá trị cũ — không phải chuyển đổi
  if (quaAnh) return;
  if (user && user.vaiTro === 'admin') return;

  if (TRANG_THAI_BAT_BUOC_CHUP_ANH.includes(updates.TRANG_THAI_XUONG)) {
    throw new Error(
      `Chuyển sang "${updates.TRANG_THAI_XUONG}" bắt buộc phải chụp ảnh QR ở trang Quét QR — vai trò này không set tay được.`
    );
  }
}

async function update(sttKey, updates, user, tuyChon = {}) {
  const { headers, row } = await getByKey(sttKey, { fresh: true }); // luôn đọc thật trước khi ghi
  if (!row) throw new Error('Không tìm thấy đơn hàng: ' + sttKey);

  kiemTraGiaTriHopLe(updates);
  kiemTraCongAnhBatBuoc(row, updates, user, tuyChon.quaAnh);

  const updatesSauXacNhan = tinhPhoiVeFileTuDongKhiXacNhan(row, updates);
  const updatesDaTinh = tinhTinhTrangTuDong(row, updatesSauXacNhan);
  kiemTraTinhHopLy(row, updatesDaTinh); // kiểm tra SAU khi đã tính tự động, để không báo nhầm khi chính việc tự động hoá làm cho tổ hợp trở nên hợp lệ

  await updateCells(TAB, headers, row._row, updatesDaTinh); // tự xoá cache của tab sau khi ghi (xem sheetsService)

  // Trừ kho phôi (tab Ton_Kho_Phoi) khi đơn VỪA chuyển sang "Đã lấy phôi" — không hoàn kho khi chuyển
  // ngược lại (xem taiSanService.truKhoTheoDon). Chạy SAU khi ghi Sheet đơn hàng đã thành công; lỗi ở
  // đây (vd chưa tạo tab Ton_Kho_Phoi) chỉ log ra console, KHÔNG được làm hỏng việc cập nhật đơn hàng
  // — kho phôi chỉ mang tính theo dõi, không phải điều kiện chặn thao tác lấy phôi thực tế.
  if (updatesDaTinh.TRANG_THAI_PHOI === 'Đã lấy phôi' && row.TRANG_THAI_PHOI !== 'Đã lấy phôi') {
    try {
      await taiSanService.truKhoTheoDon(row, user);
    } catch (err) {
      console.error('[Orders] Lỗi trừ kho phôi:', err.message);
    }
  }

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

// Vị trí thêu
function danhSachViTriTheu(don) {
  return [don.VI_TRI_1].filter(Boolean);
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
      if (r.TRANG_THAI_XUONG === 'LỖI SẢN XUẤT CẦN LÀM LẠI') return true;
      const idx = chiSoTinhTrang(r.TRANG_THAI_XUONG);
      return idx !== null && idx >= idxSanSang;
    });
  }
  return rows; // admin, ve_file — xem tất cả
}

module.exports = { TAB, KEY_COL, getAll, getByKey, update, filterForRole, ganTenKhachHang, tieuDeSanPham, danhSachViTriTheu };
