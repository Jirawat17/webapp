const { readTab, readTabCached, updateCells } = require('./sheetsService');
const { layBanDoTenKhachHang } = require('./khachHangService');
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
  if ('TINH_TRANG' in updates && !TINH_TRANG_VALUES.includes(updates.TINH_TRANG)) {
    throw new Error(`Giá trị TINH_TRANG không hợp lệ: "${updates.TINH_TRANG}"`);
  }
  if ('TRANG_THAI_PHOI' in updates && !TRANG_THAI_PHOI_VALUES.includes(updates.TRANG_THAI_PHOI)) {
    throw new Error(`Giá trị TRANG_THAI_PHOI không hợp lệ: "${updates.TRANG_THAI_PHOI}"`);
  }
  if ('TRANG_THAI_VE_FILE' in updates && !TRANG_THAI_VE_FILE_VALUES.includes(updates.TRANG_THAI_VE_FILE)) {
    throw new Error(`Giá trị TRANG_THAI_VE_FILE không hợp lệ: "${updates.TRANG_THAI_VE_FILE}"`);
  }
}

// Kiểm tra tính HỢP LÝ giữa 3 cột VỚI NHAU — không chỉ đúng giá trị từng cột riêng lẻ mà còn phải
// khớp logic pipeline. 3 quy tắc:
//   1. "Chưa xác nhận" thì KHÔNG THỂ đã có phôi/đã vẽ file (đơn còn chưa được khách xác nhận thì
//      chưa ai chuẩn bị phôi/vẽ file cho đơn đó).
//   2. Đã tới "ĐÃ SẴN SÀNG CHẠY MÁY" hoặc các bước SAU đó trên đường chính (Đã sản xuất, Đã đóng
//      gói, IN TRANSIT, DELIVERED) thì BẮT BUỘC phải có đủ CẢ phôi lẫn file — không tính LỖI SẢN
//      XUẤT CẦN LÀM LẠI/CANCELLED/REFUNDED (nhánh rẽ, không nằm trong THU_TU_TINH_TRANG nên
//      chiSoTinhTrang trả về null, CỐ Ý bỏ qua quy tắc này — lúc lỗi cần được phép reset phôi/file
//      về "chưa" để làm lại từ đầu, xem tinhTinhTrangTuDong ở trên và README).
//   3. (bổ sung 26/08/2026) PHẢI đi qua "Đang chạy máy" trước khi tới "Đã sản xuất" — không cho
//      nhảy cóc thẳng từ "ĐÃ SẴN SÀNG CHẠY MÁY" (hay bất kỳ trạng thái nào khác) sang "Đã sản xuất".
// Chỉ kiểm tra khi updates THỰC SỰ đụng tới 1 trong 3 cột — sửa các trường khác (GHI_CHU, HANG_VAN_
// CHUYEN...) không bao giờ bị chặn bởi hàm này, kể cả khi dữ liệu cũ của đơn đó lỡ đã sai từ trước.
//
// ADMIN OVERRIDE (bổ sung 26/08/2026, theo Prompt_Ver_25.docx — trước đó CẢ ADMIN cũng bị 2 quy tắc
// này chặn tuyệt đối, không có lối thoát nào để sửa những trường hợp ngoại lệ/dữ liệu cũ bị lệch,
// vd cần set tay 1 đơn "Chưa xác nhận" thành "Đã lấy phôi" trước, hoặc cho đơn ĐÃ SẴN SÀNG CHẠY MÁY
// quay lại "Chưa lấy phôi"/"Chưa vẽ file" để làm lại). admin là superuser, được BỎ QUA hoàn toàn cả
// 3 quy tắc; các vai trò khác vẫn bị chặn như cũ.
function kiemTraTinhHopLy(rowHienTai, updates, user) {
  if (user && user.vaiTro === 'admin') return;

  const dungChamPipeline = 'TINH_TRANG' in updates || 'TRANG_THAI_PHOI' in updates || 'TRANG_THAI_VE_FILE' in updates;
  if (!dungChamPipeline) return;

  const tinhTrangMoi = updates.TINH_TRANG ?? rowHienTai.TINH_TRANG;
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

  // Quy tắc 3: dùng updates.TINH_TRANG (KHÔNG dùng tinhTrangMoi ở trên) — chỉ kiểm tra khi updates
  // THỰC SỰ yêu cầu đổi TINH_TRANG thành "Đã sản xuất"; tránh báo nhầm khi đơn ĐÃ SẴN đang ở "Đã
  // sản xuất" từ trước và người dùng chỉ sửa GHI_CHU/phôi/file mà không đụng gì tới TINH_TRANG.
  // ÁP DỤNG CHO CẢ quét QR (đã xác nhận với người dùng) — kịch bản "chuyển sang Đã sản xuất" trong
  // tab CauHinhKichBan trên Google Sheet cần đổi lại requireStatus từ "ĐÃ SẴN SÀNG CHẠY MÁY" thành
  // "Đang chạy máy", nếu không mọi lượt quét kịch bản đó sẽ báo lỗi từ nay trở đi.
  if (updates.TINH_TRANG === 'Đã sản xuất' && rowHienTai.TINH_TRANG !== 'Đang chạy máy') {
    throw new Error(`Không hợp lệ: phải chuyển đơn sang "Đang chạy máy" trước, chưa thể chuyển thẳng từ "${rowHienTai.TINH_TRANG}" sang "Đã sản xuất".`);
  }
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

async function update(sttKey, updates, user) {
  const { headers, row } = await getByKey(sttKey, { fresh: true }); // luôn đọc thật trước khi ghi
  if (!row) throw new Error('Không tìm thấy đơn hàng: ' + sttKey);

  kiemTraGiaTriHopLe(updates);

  const updatesDaTinh = tinhTinhTrangTuDong(row, updates);
  kiemTraTinhHopLy(row, updatesDaTinh, user); // kiểm tra SAU khi đã tính tự động, để không báo nhầm khi chính việc tự động hoá làm cho tổ hợp trở nên hợp lệ

  await updateCells(TAB, headers, row._row, updatesDaTinh); // tự xoá cache của tab sau khi ghi (xem sheetsService)

  // true nếu tinhTinhTrangTuDong() VỪA TỰ thêm TINH_TRANG vào updates (người gọi không hề yêu cầu
  // sửa TINH_TRANG) — bổ sung 26/08/2026 theo Prompt_Ver_25.docx: trước đây log ở orders.js/qr.js
  // chỉ ghi đúng cột người dùng vừa sửa tay (vd TRANG_THAI_PHOI), không hề nhắc rằng TINH_TRANG cũng
  // vừa tự nhảy theo, khiến xem lại lịch sử 1 đơn sau này khó hiểu vì sao trạng thái tổng đổi mà
  // không có dòng nào giải thích. Trả thêm 2 trường "_" để nơi gọi (routes/orders.js, routes/qr.js)
  // biết mà ghi thêm chi tiết vào dòng log của chính hành động đó.
  const daTuDongChuyenTinhTrang = !('TINH_TRANG' in updates) && 'TINH_TRANG' in updatesDaTinh;

  return {
    ...row, ...updatesDaTinh,
    _daTuDongChuyenTinhTrang: daTuDongChuyenTinhTrang,
    _tinhTrangTuDongMoi: daTuDongChuyenTinhTrang ? updatesDaTinh.TINH_TRANG : null,
  };
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
