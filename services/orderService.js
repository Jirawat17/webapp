const { readTab, readTabCached, updateCells } = require('./sheetsService');
const { layBanDoTenKhachHang } = require('./khachHangService');
const taiSanService = require('./taiSanService');
const { chiSoTinhTrang, TINH_TRANG_VALUES, TRANG_THAI_PHOI_VALUES, TRANG_THAI_VE_FILE_VALUES } = require('../data/pipelineTinhTrang');
const { thoiGianVNISOString } = require('./dateUtils');

const TAB = 'Don_Hang_ALL';
const KEY_COL = 'STT_Key';

// Mặc định đọc qua cache (nhanh, dữ liệu có thể cũ tối đa 10s) — dùng cho hiển thị/kiểm tra. Chỉ
// giúp các màn hình XEM (danh sách, dashboard, báo cáo) đỡ tốn quota khi nhiều người cùng xem —
// KHÔNG ảnh hưởng các thao tác GHI (update() luôn tự đọc fresh riêng, xem bên dưới).
// Truyền { fresh: true } để BẮT BUỘC đọc thật từ Google Sheets — LUÔN dùng trước khi ghi (update())
// để không bao giờ ghi nhầm dòng nếu vừa có ai thêm/xoá dòng khác ở nơi khác.
async function getAll({ fresh = false } = {}) {
  return fresh ? readTab(TAB) : readTabCached(TAB, 10000);
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
  if ('XUONG' in updates && updates.XUONG && !DANH_SACH_XUONG.includes(updates.XUONG)) {
    throw new Error(`Giá trị XUONG không hợp lệ: "${updates.XUONG}" — chỉ chấp nhận: ${DANH_SACH_XUONG.join(', ')}`);
  }
}

// Kiểm tra tính HỢP LÝ giữa 3 cột VỚI NHAU — không chỉ đúng giá trị từng cột riêng lẻ mà còn phải
// khớp logic pipeline. 2 quy tắc:
//   1. "Chưa in mã" thì KHÔNG THỂ đã có phôi/đã vẽ file (đơn còn chưa in mã thì chưa ai chuẩn bị
//      phôi/vẽ file cho đơn đó).
//   2. Đã tới "ĐÃ SẴN SÀNG CHẠY MÁY" hoặc các bước SAU đó trên đường chính (Đã sản xuất, Đã đóng
//      gói, ĐÃ DÁN TEM, DELIVERED) thì BẮT BUỘC phải có đủ CẢ phôi lẫn file — không tính LỖI SẢN
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

  if (tinhTrangMoi === 'Chưa in mã') {
    if (phoiMoi === 'Đã lấy phôi') {
      throw new Error('Không hợp lệ: đơn đang "Chưa in mã" thì chưa thể "Đã lấy phôi" — in mã đơn trước.');
    }
    // Đơn "Chưa in mã" bắt buộc vẽ file phải ĐÚNG "Chưa vẽ file" (không chỉ chặn riêng "Đã vẽ file")
    // — từ khi có thêm "Đang vẽ file" (08/09/2026), không ai được phép "đang vẽ" cho 1 đơn còn chưa
    // in mã, tức chưa ai chuẩn bị được gì để vẽ.
    if (veFileMoi !== 'Chưa vẽ file') {
      throw new Error(`Không hợp lệ: đơn đang "Chưa in mã" thì vẽ file phải đang "Chưa vẽ file" (đang là "${veFileMoi}") — in mã đơn trước.`);
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
// in mã (TRANG_THAI_XUONG chuyển từ 'Chưa in mã' sang 'Đã in mã') — đơn vừa in mã thì chưa ai
// kịp lấy phôi/vẽ file, nên đặt sẵn 2 cột này về "chưa" luôn, không phải set tay riêng. Không ghi đè
// nếu người gọi đã tự chỉ định 1 trong 2 cột này trong chính updates đó. Chỉ áp dụng đúng lượt
// chuyển 'Chưa in mã' -> 'Đã in mã' (không áp dụng khi TRANG_THAI_XUONG đang set lại 'Đã in mã'
// từ trạng thái khác, vd sau khi lỗi sản xuất).
function tinhPhoiVeFileTuDongKhiInMa(rowHienTai, updates) {
  if (updates.TRANG_THAI_XUONG !== 'Đã in mã' || rowHienTai.TRANG_THAI_XUONG !== 'Chưa in mã') return updates;

  const ketQua = { ...updates };
  if (!('TRANG_THAI_PHOI' in ketQua)) ketQua.TRANG_THAI_PHOI = 'Chưa lấy phôi';
  if (!('TRANG_THAI_VE_FILE' in ketQua)) ketQua.TRANG_THAI_VE_FILE = 'Chưa vẽ file';
  return ketQua;
}

// TỰ ĐỘNG chuyển TRANG_THAI_XUONG sang "ĐÃ SẴN SÀNG CHẠY MÁY" khi cả phôi lẫn file vẽ CÙNG xong — nhưng
// CHỈ áp dụng lần đầu (khi TRANG_THAI_XUONG đang là "Đã in mã"). Sau khi đơn bị lỗi rồi làm lại từ phôi/
// file, việc quay lại "ĐÃ SẴN SÀNG CHẠY MÁY" lần 2 KHÔNG tự động — người phụ trách phải tự set tay
// (đã xác nhận rõ với người dùng, xem data/pipelineTinhTrang.js). Hàm này không tự đổi TRANG_THAI_XUONG
// nếu người gọi đã tự chỉ định TRANG_THAI_XUONG trong chính updates đó — tôn trọng giá trị người dùng
// muốn set tay, không ghi đè.
function tinhTinhTrangTuDong(rowHienTai, updates) {
  if ('TRANG_THAI_XUONG' in updates) return updates; // người gọi đã tự set — không can thiệp

  const phoiMoi = updates.TRANG_THAI_PHOI ?? rowHienTai.TRANG_THAI_PHOI;
  const veFileMoi = updates.TRANG_THAI_VE_FILE ?? rowHienTai.TRANG_THAI_VE_FILE;
  const caPhoiVaFileXong = phoiMoi === 'Đã lấy phôi' && veFileMoi === 'Đã vẽ file';

  if (caPhoiVaFileXong && rowHienTai.TRANG_THAI_XUONG === 'Đã in mã') {
    return { ...updates, TRANG_THAI_XUONG: 'ĐÃ SẴN SÀNG CHẠY MÁY' };
  }
  return updates;
}

// "Đã sản xuất" và "ĐÃ DÁN TEM" chỉ được đặt qua đúng luồng đã xác nhận — CẢ 2 đều qua chụp ảnh QR
// (routes/photos.js, gọi update() với tuyChon.quaAnh = true): "Đã sản xuất" mốc da_san_xuat, "ĐÃ DÁN
// TEM" mốc da_dan_tem (đổi từ "Quét mã QR Tracking" gọi GKE thật sang thuần ảnh 09/09/2026 lần 4, theo
// yêu cầu người dùng — xem routes/photos.js). Chặn MỌI đường khác (ô "Sửa trạng thái thủ công" ở order.html, chuyển hàng loạt...)
// — bất kể đơn đang ở trạng thái nào trước đó. admin vẫn ghi đè được cả 2 giá trị (cần 1 lối thoát khi
// máy ảnh/QR hỏng) — đã xác nhận rõ với người dùng, chấp nhận rủi ro bị lạm dụng ở mức admin.
// (Bổ sung 09/09/2026 lần 3, XOÁ "Đã đóng gói" — xem data/pipelineTinhTrang.js): riêng "ĐÃ DÁN TEM",
// admin sửa tay KHÔNG được miễn trừ điều kiện trạng thái NGUỒN như "Đã sản xuất" — xem
// TRANG_THAI_NGUON_HOP_LE_CHO_DAN_TEM bên dưới, kiểm tra TRƯỚC cả nhánh admin, áp dụng cho MỌI người gọi.
// CHỈ chặn khi đây là 1 CHUYỂN ĐỔI THẬT (giá trị mới khác giá trị đang có) — ô "Sửa trạng thái thủ
// công" ở order.html luôn gửi cả 3 cột TRANG_THAI_XUONG/PHOI/VE_FILE cùng lúc kể cả khi người dùng chỉ định
// sửa 1 trong 2 cột kia, nên KHÔNG được chặn nhầm khi TRANG_THAI_XUONG gửi lên trùng với giá trị hiện tại.
const TRANG_THAI_BAT_BUOC_CHUP_ANH = ['Đã sản xuất', 'ĐÃ DÁN TEM'];

// Trạng thái NGUỒN hợp lệ để được set "ĐÃ DÁN TEM" — ÁP DỤNG CHO MỌI NGƯỜI GỌI, kể cả admin sửa tay
// (khác hẳn cơ chế quaAnh/admin-bypass ở kiemTraCongAnhBatBuoc, vốn miễn trừ hoàn toàn cho admin).
// Theo đúng yêu cầu người dùng: "Đã sản xuất" là nguồn hợp lệ duy nhất; tự cho phép giữ nguyên "ĐÃ DÁN
// TEM" (không coi là vi phạm) để không chặn lượt quét lại in tem/lưu lại đúng giá trị cũ.
const TRANG_THAI_NGUON_HOP_LE_CHO_DAN_TEM = ['Đã sản xuất', 'ĐÃ DÁN TEM'];

function kiemTraCongAnhBatBuoc(rowHienTai, updates, user, quaAnh) {
  if (!('TRANG_THAI_XUONG' in updates)) return;
  if (updates.TRANG_THAI_XUONG === rowHienTai.TRANG_THAI_XUONG) return; // gửi lại đúng giá trị cũ — không phải chuyển đổi

  if (updates.TRANG_THAI_XUONG === 'ĐÃ DÁN TEM') {
    if (!TRANG_THAI_NGUON_HOP_LE_CHO_DAN_TEM.includes(rowHienTai.TRANG_THAI_XUONG)) {
      throw new Error(`Không hợp lệ: đơn đang "${rowHienTai.TRANG_THAI_XUONG}" — phải đang "Đã sản xuất" mới chuyển sang "ĐÃ DÁN TEM" được.`);
    }
    // Bổ sung 09/09/2026 lần 5, theo yêu cầu người dùng: đơn CHƯA có thông tin Tracking (mã vận đơn
    // thật) thì KHÔNG được chuyển sang "ĐÃ DÁN TEM" — kể cả qua "Chụp ảnh ĐÃ DÁN TEM" (mục 12) lẫn admin
    // sửa tay, không có ngoại lệ, cùng tinh thần TRANG_THAI_NGUON_HOP_LE_CHO_DAN_TEM ở trên. Phải mua
    // tracking trước (nút "Mua Tracking"/"MUA TRACKING và IN LABEL") rồi mới chụp ảnh/đánh dấu được.
    // Lấy giá trị TRACKING_ID SAU KHI áp dụng updates này (nếu updates có tự set TRACKING_ID trong CÙNG
    // lượt gọi, dùng giá trị đó — hiện chưa có luồng nào làm vậy nhưng để đúng cho mọi trường hợp sau
    // này) — ?? rowHienTai.TRACKING_ID nếu updates không đụng tới cột này. Từ 12/09/2026 lần 14,
    // TRACKING_ID KHÔNG còn khi nào mang giá trị placeholder "chờ tem" nữa (chuyển hẳn sang cột TAM_THOI
    // — xem services/trackingAutoService.js) nên chỉ cần kiểm tra rỗng/không rỗng, không cần so khớp
    // hằng số placeholder ở đây nữa.
    const trackingSauKhiGhi = updates.TRACKING_ID ?? rowHienTai.TRACKING_ID;
    if (!trackingSauKhiGhi) {
      throw new Error('Không hợp lệ: đơn chưa có thông tin Tracking (mã vận đơn thật) — phải mua tracking trước khi chuyển sang "ĐÃ DÁN TEM".');
    }
  }

  if (quaAnh) return;
  if (user && user.vaiTro === 'admin') return;

  if (TRANG_THAI_BAT_BUOC_CHUP_ANH.includes(updates.TRANG_THAI_XUONG)) {
    throw new Error(
      `Chuyển sang "${updates.TRANG_THAI_XUONG}" bắt buộc phải chụp ảnh QR/quét QR Tracking ở trang Quét QR — vai trò này không set tay được.`
    );
  }
}

async function update(sttKey, updates, user, tuyChon = {}) {
  // tuyChon.donDaDoc cho phép truyền sẵn {headers, row} đã đọc fresh ngay trước đó (vd routes/qr.js
  // vừa getByKey({fresh:true}) để kiểm tra trạng thái trước khi quyết định có gọi update() hay
  // không) — bỏ qua việc đọc lại y hệt lần nữa. Không có gì ghi xen giữa 2 bước đó trong cùng 1 lượt
  // gọi nên vẫn giữ đúng nguyên tắc "đọc thật ngay trước khi ghi", chỉ gộp 2 lượt đọc thật liền nhau
  // thành 1 — quan trọng cho luồng quét QR hàng loạt (routes/qr.js xac-nhan-hang-loat), trước đây mỗi
  // mã quét tốn TỚI 2 lượt đọc toàn bộ tab Don_Hang_ALL (1 ở route, 1 ở đây) thay vì 1.
  const { headers, row } = tuyChon.donDaDoc || await getByKey(sttKey, { fresh: true }); // luôn đọc thật trước khi ghi
  if (!row) throw new Error('Không tìm thấy đơn hàng: ' + sttKey);

  kiemTraGiaTriHopLe(updates);
  kiemTraCongAnhBatBuoc(row, updates, user, tuyChon.quaAnh);

  const updatesSauInMa = tinhPhoiVeFileTuDongKhiInMa(row, updates);
  const updatesDaTinh = tinhTinhTrangTuDong(row, updatesSauInMa);

  // Ảnh mẫu đổi thì hash cũ (nếu Sheet đã có cột) không còn đúng nữa — xoá để lượt "Quét tìm đơn hàng
  // loạt" kế tiếp (routes/orders.js) tính lại, tránh nhóm hàng loạt sai lặng lẽ theo ảnh cũ đã không
  // còn tồn tại. Guard theo headers.includes(...) — vô hại với Sheet chưa thêm 2 cột này (xem
  // docs/superpowers/specs/2026-09-06-don-hang-loat-design.md mục 2).
  if (
    headers.includes('HASH_ANH_MAU') &&
    updatesDaTinh.DUONG_DAN_URL !== undefined &&
    updatesDaTinh.DUONG_DAN_URL !== row.DUONG_DAN_URL &&
    updatesDaTinh.HASH_ANH_MAU === undefined
  ) {
    updatesDaTinh.HASH_ANH_MAU = '';
    if (headers.includes('NHOM_HANG_LOAT')) updatesDaTinh.NHOM_HANG_LOAT = '';
  }

  // Đơn VỪA chuyển sang "Đang chạy máy" (từ 1 trạng thái KHÁC) — ghi lại AI đang vận hành thẳng vào
  // cột NGUOI_CHAY_MAY (thay cho dò lịch sử hoạt động như trước — xem
  // docs/superpowers/specs/2026-09-07-nguoi-chay-may-design.md). Áp dụng cho MỌI đường ghi đi qua
  // update() này — quét QR, đổi trạng thái hàng loạt, sửa tay 1 đơn.
  // Nếu người gọi đã TỰ truyền sẵn NGUOI_CHAY_MAY trong chính updates (nhánh admin chỉ định người
  // KHÁC chạy máy, xem routes/orders.js POST /chi-dinh-nguoi-chay-may) thì GIỮ NGUYÊN giá trị đó,
  // không ghi đè bằng người đang thao tác — ngược lại (ai đó tự đổi trạng thái đơn của chính họ) thì
  // tự stamp NGUOI_CHAY_MAY = người đang thao tác, đồng thời xoá ghi chú cũ (nếu có, từ lượt chạy
  // trước) vì đây là 1 lượt gán MỚI, không phải tiếp nối lượt cũ.
  if (
    headers.includes('NGUOI_CHAY_MAY') &&
    updatesDaTinh.TRANG_THAI_XUONG === 'Đang chạy máy' &&
    row.TRANG_THAI_XUONG !== 'Đang chạy máy' &&
    updatesDaTinh.NGUOI_CHAY_MAY === undefined
  ) {
    updatesDaTinh.NGUOI_CHAY_MAY = (user && user.ten) || '';
    if (headers.includes('GHI_CHU_CHAY_MAY')) updatesDaTinh.GHI_CHU_CHAY_MAY = '';
  }

  // Đơn VỪA chuyển sang "Đang vẽ file" (từ 1 giá trị KHÁC) — Y HỆT hook NGUOI_CHAY_MAY ở trên, áp
  // dụng cho vẽ file thay vì chạy máy (thêm 08/09/2026, xem
  // docs/superpowers/specs/2026-09-08-trang-thai-dang-ve-file-design.md). Nếu người gọi đã tự truyền
  // sẵn NGUOI_VE_FILE (nhánh admin chỉ định người KHÁC vẽ, routes/orders.js POST
  // /chi-dinh-nguoi-ve-file) thì giữ nguyên, không ghi đè bằng người đang thao tác.
  if (
    headers.includes('NGUOI_VE_FILE') &&
    updatesDaTinh.TRANG_THAI_VE_FILE === 'Đang vẽ file' &&
    row.TRANG_THAI_VE_FILE !== 'Đang vẽ file' &&
    updatesDaTinh.NGUOI_VE_FILE === undefined
  ) {
    updatesDaTinh.NGUOI_VE_FILE = (user && user.ten) || '';
    if (headers.includes('GHI_CHU_VE_FILE')) updatesDaTinh.GHI_CHU_VE_FILE = '';
  }

  // Đơn VỪA chuyển sang "Đã in mã" (từ 1 giá trị KHÁC) — ghi lại THỜI ĐIỂM này để job tự động mua
  // tracking (services/trackingAutoService.js) biết đơn đã "đủ tuổi" bao lâu, không phụ thuộc
  // ThoiGianCapNhatCuoi (bị ghi đè bởi MỌI lần sửa sau đó, không chỉ riêng lần chuyển "Đã in mã") —
  // bổ sung 09/09/2026, theo yêu cầu người dùng, cột THOI_GIAN_IN_MA người dùng đã tự thêm vào Sheet.
  if (
    headers.includes('THOI_GIAN_IN_MA') &&
    updatesDaTinh.TRANG_THAI_XUONG === 'Đã in mã' &&
    row.TRANG_THAI_XUONG !== 'Đã in mã'
  ) {
    updatesDaTinh.THOI_GIAN_IN_MA = thoiGianVNISOString();
  }

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
//   - admin: xem TOÀN BỘ đơn, không lọc gì.
//   - ve_file: xem mọi đơn (không lọc theo trạng thái) NHƯNG vẫn bị lọc theo Xưởng như mọi vai trò
//     khác (xem locTheoXuong bên dưới) — bổ sung 13/09/2026.
//   - san_xuat: CHỈ thấy đơn đã tới "ĐÃ SẴN SÀNG CHẠY MÁY" trở đi (kể cả trạng thái lỗi
//     "LỖI SẢN XUẤT CẦN LÀM LẠI"), không thấy đơn còn ở "Chưa in mã"/"Đã in mã". Đơn đã
//     CANCELLED/REFUNDED không nằm trong THU_TU_TINH_TRANG (nhánh rẽ) nên tự động bị loại — chỉ
//     admin/ve_file mới thấy đơn huỷ/hoàn, giữ đúng thói quen cũ (trước đây chỉ admin/quan_ly thấy).
//   - nguoi_lay_phoi: KHÔNG dùng route GET /orders (danh sách) — vai trò này chỉ có đúng 1 menu
//     "Quét mã QR" ở giao diện (xem public/js/api.js renderNav), không có trang danh sách đơn để
//     vào. Không cần lọc riêng ở đây.
function filterForRole(rows, user) {
  let list = rows;
  if (user.vaiTro === 'san_xuat') {
    const idxSanSang = chiSoTinhTrang('ĐÃ SẴN SÀNG CHẠY MÁY');
    list = list.filter(r => {
      if (r.TRANG_THAI_XUONG === 'LỖI SẢN XUẤT CẦN LÀM LẠI') return true;
      const idx = chiSoTinhTrang(r.TRANG_THAI_XUONG);
      return idx !== null && idx >= idxSanSang;
    });
  }
  return locTheoXuong(list, user);
}

// Phân loại đơn theo Xưởng (HANOI/BACNINH...) — bổ sung 13/09/2026, theo yêu cầu người dùng (cột
// XUONG tự thêm vào Don_Hang_ALL, cột Xuong tự thêm vào NguoiDung). admin luôn xem/thao tác được MỌI
// đơn bất kể Xưởng. Vai trò khác: CHỈ xem/thao tác được đơn CÙNG Xưởng với mình — thiếu Xưởng ở 1
// trong 2 bên (đơn chưa được admin gán XUONG, HOẶC người dùng chưa được gán Xuong) coi như KHÔNG có
// quyền (người dùng xác nhận: "chưa gán = ẩn với người thường", ưu tiên an toàn dữ liệu hơn tiện lợi
// trong giai đoạn mới triển khai chưa gán hết). Áp dụng CẢ cho việc XEM (danh sách/báo cáo/chatbot/
// dashboard — locTheoXuong) LẪN thao tác trên 1 đơn cụ thể (quét QR/chụp ảnh/sửa đơn — coQuyenTheoXuong,
// xem routes/orders.js, routes/qr.js, routes/photos.js, routes/tracking.js).
const DANH_SACH_XUONG = ['HANOI', 'BACNINH'];

function locTheoXuong(rows, user) {
  if (user.vaiTro === 'admin') return rows;
  if (!user.xuong) return [];
  return rows.filter(r => r.XUONG === user.xuong);
}

function coQuyenTheoXuong(user, row) {
  if (user.vaiTro === 'admin') return true;
  return !!user.xuong && !!row.XUONG && user.xuong === row.XUONG;
}

module.exports = {
  TAB, KEY_COL, getAll, getByKey, update, filterForRole, ganTenKhachHang, tieuDeSanPham, danhSachViTriTheu,
  DANH_SACH_XUONG, locTheoXuong, coQuyenTheoXuong,
};
