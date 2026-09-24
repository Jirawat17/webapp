const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const orderService = require('../services/orderService');
const taiKhoanService = require('../services/taiKhoanService');
const trangThaiDbService = require('../services/trangThaiDbService');
const donHangLoatService = require('../services/donHangLoatService');
const taiSanService = require('../services/taiSanService');
const alertService = require('../services/alertService');
const scenarioService = require('../services/scenarioService');
const { parseNgay } = require('../services/dateUtils');
const { DANH_SACH_TRANG_THAI_BAO_CAO, TRANG_THAI_PHOI_VALUES, TRANG_THAI_VE_FILE_VALUES, khopGiaTriLoc } = require('../data/pipelineTinhTrang');
const { ghiLog, layLichSuTheoDon } = require('../services/logService');
const { taiDsAnh } = require('../services/anhNguonService');
const { tinhHashAnh, khoangCachHamming } = require('../services/perceptualHashService');
const { requireLogin, laAdmin, laSuperAdmin } = require('../middleware/auth');
const { xoaDuLieuDon } = require('../services/xoaDuLieuDonService');
const { layMauTheoXuong, datMauXuong, themXuong, xoaXuong, doiTenXuong } = require('../services/caiDatDbService');

router.use(requireLogin);

// nguoi_lay_phoi không có mục "Đơn hàng" trong menu (renderNav trong public/js/api.js) và không có
// trang nào của họ (scan.html/tai-san.html/hoat-dong.html) gọi tới API nào trong file này — chặn hẳn cả
// router ở đây, không chỉ dựa vào việc ẩn menu phía client (bổ sung 12/09/2026, theo yêu cầu người dùng
// sau khi phát hiện GET / và GET /:sttKey trước đó không lọc theo vai trò này, để lộ toàn bộ danh sách/
// chi tiết đơn hàng dù menu bị ẩn). Cùng khuôn router.use(khongPhaiNguoiLayPhoi) trong routes/tracking.js.
function khongPhaiNguoiLayPhoi(req, res, next) {
  if (req.session.user.vaiTro === 'nguoi_lay_phoi') {
    return res.status(403).json({ error: 'Vai trò này không được xem/sửa đơn hàng qua trang Đơn hàng — chỉ thao tác qua Quét QR.' });
  }
  next();
}
router.use(khongPhaiNguoiLayPhoi);

const TRANG_THAI_DANG_CHAY_MAY = 'Đang chạy máy';

// Gắn thêm các trường tính toán (không phải cột thật trong Sheet) để hiển thị — dùng chung cho list/detail
// "Người vận hành máy" (bổ sung 07/09/2026): đọc THẲNG cột NGUOI_CHAY_MAY (ghi trực tiếp bởi
// services/orderService.js update() — xem docs/superpowers/specs/2026-09-07-nguoi-chay-may-design.md)
// — TRƯỚC ĐÂY phải dò ngược LichSuHoatDong tìm lần gần nhất đơn chuyển sang "Đang chạy máy", giờ
// không cần nữa. Giữ nguyên tên trường JSON trả về là NguoiVanHanh (không đổi thành NguoiChayMay) để
// không phải sửa gì ở orders.html/my-orders.html/order.html đang đọc o.NguoiVanHanh.
// "Người vẽ file" (bổ sung 08/09/2026, cập nhật cùng ngày khi có trạng thái "Đang vẽ file" — xem
// docs/superpowers/specs/2026-09-08-trang-thai-dang-ve-file-design.md): đọc cột NGUOI_VE_FILE, giờ
// ĐÚNG KHUÔN NguoiVanHanh — chỉ trả về khi TRANG_THAI_VE_FILE đang là "Đang vẽ file". Đơn đã "Đã vẽ
// file" hoặc bị reset về "Chưa vẽ file" (vd sau lỗi sản xuất) sẽ không còn hiện "ai đang vẽ" ở đây
// nữa, dù cột thật trong Sheet vẫn giữ giá trị cũ làm dấu vết.
async function lamGiauDon(rows) {
  const daGanKH = await orderService.ganTenKhachHang(rows);
  return daGanKH.map(r => ({
    ...r,
    TieuDeSanPham: orderService.tieuDeSanPham(r),
    ViTriTheu: orderService.danhSachViTriTheu(r),
    CanhBao: alertService.tinhMucCanhBao(r),
    NguoiVanHanh: r.TRANG_THAI_XUONG === TRANG_THAI_DANG_CHAY_MAY ? (r.NGUOI_CHAY_MAY || null) : null,
    NguoiVeFile: r.TRANG_THAI_VE_FILE === 'Đang vẽ file' ? (r.NGUOI_VE_FILE || null) : null,
    DonUuTien: orderService.laUuTien(r),
  }));
}

// (bổ sung 26/08/2026, theo yêu cầu người dùng) Đơn "Đang chạy máy" chỉ hiện với ĐÚNG tài khoản
// san_xuat đang chạy nó — san_xuat KHÁC bị ẩn HOÀN TOÀN (cả danh sách lẫn trang chi tiết, coi như
// không tồn tại), không chỉ ẩn khỏi danh sách. CHỈ áp dụng cho san_xuat — admin/ve_file luôn thấy
// đầy đủ. Không xác định được người vận hành (vd sửa thẳng trên Sheet, log bị thiếu) thì vẫn cho
// TẤT CẢ san_xuat thấy (an toàn hơn, tránh thất lạc đơn) — order.html/orders.html tự hiển thị cảnh
// báo rõ ràng trong trường hợp này (xem NHAN_NGUOI_VAN_HANH_KHONG_RO ở phía client).
function locDonDangChayMayTheoNguoiVanHanh(rows, user) {
  if (user.vaiTro !== 'san_xuat') return rows;
  return rows.filter(r => {
    if (r.TRANG_THAI_XUONG !== TRANG_THAI_DANG_CHAY_MAY) return true;
    if (!r.NguoiVanHanh) return true; // không xác định được -> vẫn cho thấy
    return r.NguoiVanHanh === user.ten;
  });
}

// So sánh tăng dần theo NGAY_LEN_DON — dùng làm tiêu chí phụ (tie-break) cho mọi kiểu sắp xếp, để
// thứ tự trong 1 nhóm bằng nhau (vd cùng mức cảnh báo) vẫn ổn định và có ý nghĩa (đơn chờ lâu hơn lên trước).
function soSanhNgayTang(a, b) {
  return (parseNgay(a.NGAY_LEN_DON) || 0) - (parseNgay(b.NGAY_LEN_DON) || 0);
}

// Thứ tự mức cảnh báo khi sắp theo "canh_bao" — càng khẩn cấp càng lên đầu. Không nằm trong map coi
// như "không cảnh báo", xếp cuối cùng.
const MUC_CANH_BAO_THU_TU = { DO: 3, CAM: 2, VANG: 1 };

// So sánh theo "Đơn ưu tiên" (DonUuTien, gắn ở lamGiauDon()) — đơn ưu tiên luôn lên TRƯỚC đơn thường,
// bất kể đang sắp theo kiểu nào (bổ sung 13/09/2026, theo yêu cầu người dùng). Dùng làm tiêu chí ĐẦU
// TIÊN, đứng trước mọi kiểu sắp xếp khác — xem sapXepDon() bên dưới.
function soSanhUuTienTruoc(a, b) {
  return (b.DonUuTien ? 1 : 0) - (a.DonUuTien ? 1 : 0);
}

// Sắp xếp danh sách đơn theo lựa chọn của người dùng (nút "Sắp xếp" ở trang Đơn hàng) — mặc định
// (không truyền hoặc giá trị lạ) giữ đúng hành vi cũ: cũ nhất lên đầu theo NGAY_LEN_DON. Đơn "Đơn ưu
// tiên" luôn được gắn lên đầu TRƯỚC, kiểu sắp xếp đang chọn chỉ quyết định thứ tự BÊN TRONG từng nhóm
// (ưu tiên riêng, thường riêng) — xem soSanhUuTienTruoc() ở trên.
function sapXepDon(list, kieu) {
  const daSap = [...list];
  let soSanh;
  switch (kieu) {
    case 'ngay_cu_nhat':
      soSanh = soSanhNgayTang;
      break;
    case 'canh_bao':
      soSanh = (a, b) => {
        const chenhLech = (MUC_CANH_BAO_THU_TU[b.CanhBao] || 0) - (MUC_CANH_BAO_THU_TU[a.CanhBao] || 0);
        return chenhLech !== 0 ? chenhLech : soSanhNgayTang(a, b);
      };
      break;
    case 'so_luong':
      soSanh = (a, b) => {
        const chenhLech = (Number(b.SO_LUONG) || 0) - (Number(a.SO_LUONG) || 0);
        return chenhLech !== 0 ? chenhLech : soSanhNgayTang(a, b);
      };
      break;
    case 'khach_hang':
      soSanh = (a, b) => {
        const chenhLech = String(a.TenKhachHang || '').localeCompare(String(b.TenKhachHang || ''), 'vi');
        return chenhLech !== 0 ? chenhLech : soSanhNgayTang(a, b);
      };
      break;
    case 'ma_don':
      soSanh = (a, b) => {
        const chenhLech = String(a.STT_Key || '').localeCompare(String(b.STT_Key || ''), 'vi');
        return chenhLech !== 0 ? chenhLech : soSanhNgayTang(a, b);
      };
      break;
    case 'ma_don_desc':
      soSanh = (a, b) => {
        const chenhLech = String(b.STT_Key || '').localeCompare(String(a.STT_Key || ''), 'vi');
        return chenhLech !== 0 ? chenhLech : soSanhNgayTang(a, b);
      };
      break;
    default:
      soSanh = (a, b) => -soSanhNgayTang(a, b);
  }
  return daSap.sort((a, b) => {
    const chenhLechUuTien = soSanhUuTienTruoc(a, b);
    return chenhLechUuTien !== 0 ? chenhLechUuTien : soSanh(a, b);
  });
}

// Danh sách đơn hàng — tự lọc theo vai trò, có thể lọc thêm qua query string
router.get('/', async (req, res) => {
  const { rows } = await orderService.getAll();
  let list = orderService.filterForRole(rows, req.session.user);

  // Gắn CanhBao/TenKhachHang SỚM (trước khi lọc/sắp xếp) — cần có CanhBao để lọc theo "canhBao" và
  // sắp theo "canh_bao" bên dưới; đọc dữ liệu để gắn không phụ thuộc số dòng còn lại sau lọc nên
  // gắn sớm hay muộn cũng cùng 1 chi phí, không tốn thêm gì.
  list = await lamGiauDon(list);

  const {
    trangThai, trangThaiPhoi, trangThaiVeFile, kh, tuNgay, denNgay,
    loai, kichThuoc, mauSac, hangVanChuyen, quocGiaTracking, tinhTrang, canhBao, xuong, uuTien, sapXep, hangLoat, nguoiVanHanh,
    canVeFile, nguoiVeFile, timDonHangLoat,
  } = req.query;
  if (trangThai) list = list.filter(r => khopGiaTriLoc(r.TRANG_THAI_XUONG, trangThai));
  if (trangThaiPhoi) list = list.filter(r => khopGiaTriLoc(r.TRANG_THAI_PHOI, trangThaiPhoi));
  if (trangThaiVeFile) list = list.filter(r => khopGiaTriLoc(r.TRANG_THAI_VE_FILE, trangThaiVeFile));
  // "Đơn của tôi" (admin) — lọc còn đúng 1 người sản xuất đang vận hành. NguoiVanHanh là trường TÍNH
  // TOÁN (gắn ở lamGiauDon() phía trên, không phải cột thật) nên phải lọc SAU khi đã gắn xong. An
  // toàn với san_xuat dù truyền tham số này: locDonDangChayMayTheoNguoiVanHanh() luôn chạy SAU CÙNG,
  // vẫn giới hạn san_xuat chỉ thấy đơn "Đang chạy máy" của chính họ bất kể nguoiVanHanh là gì.
  if (nguoiVanHanh) list = list.filter(r => r.NguoiVanHanh === nguoiVanHanh);
  // "Đơn của tôi (Vẽ file)" — cần vẽ file = Chưa vẽ file VÀ chưa tới lượt (khác "Chưa in mã"), gồm cả
  // đơn LỖI SẢN XUẤT CẦN LÀM LẠI (bị reset về Chưa vẽ file nhưng KHÔNG quay lại "Đã in mã" — xem
  // docs/superpowers/specs/2026-09-08-don-cua-toi-ve-file-design.md). Không so khớp được bằng
  // khopGiaTriLoc (cần loại trừ 1 giá trị, không phải so khớp đúng 1 giá trị) nên thêm cờ riêng, đúng
  // tiền lệ hangLoat=1 bên dưới. Không cần cờ "chưa ai nhận" riêng nữa (đã bỏ, xem
  // docs/superpowers/specs/2026-09-08-trang-thai-dang-ve-file-design.md) — từ khi có "Đang vẽ file",
  // "Chưa vẽ file" tự nó đã luôn đúng nghĩa "chưa ai nhận".
  if (canVeFile) list = list.filter(r => r.TRANG_THAI_VE_FILE === 'Chưa vẽ file' && r.TRANG_THAI_XUONG !== 'Chưa in mã');
  if (nguoiVeFile) list = list.filter(r => r.NguoiVeFile === nguoiVeFile);
  if (loai) list = list.filter(r => r.LOAI === loai);
  if (kichThuoc) list = list.filter(r => r.KICH_THUOC === kichThuoc);
  if (mauSac) list = list.filter(r => r.MAU_SAC === mauSac);
  if (hangVanChuyen) list = list.filter(r => r.HANG_VAN_CHUYEN === hangVanChuyen);
  // QUOC_GIA_TRACKING/TINH_TRANG (bổ sung 18/09/2026, theo yêu cầu người dùng) — cả 2 đều là cột RAW
  // (đọc thẳng từ Sheet, xem services/orderService.js), cùng khuôn lọc CHÍNH XÁC CHUỖI với loai/
  // kichThuoc/mauSac/hangVanChuyen ở trên.
  if (quocGiaTracking) list = list.filter(r => r.QUOC_GIA_TRACKING === quocGiaTracking);
  if (tinhTrang) list = list.filter(r => r.TINH_TRANG === tinhTrang);
  if (canhBao) list = list.filter(r => r.CanhBao === canhBao);
  // Lọc theo Xưởng/Ưu tiên (bổ sung 13/09/2026, theo yêu cầu người dùng — chỉ hiện ô lọc này ở giao
  // diện cho admin, xem public/orders.html) — KHÔNG cần chặn riêng ở đây cho vai trò khác: san_xuat/
  // ve_file đã bị filterForRole/locTheoXuong lọc CÒN ĐÚNG 1 Xưởng của họ từ dòng 141 (TRƯỚC bộ lọc
  // này), nên dù lỡ tự truyền xuong=X qua URL cũng chỉ có thể thu hẹp thêm (hoặc về rỗng), không lộ
  // thêm dữ liệu nào ngoài phạm vi đã được phép xem. DON_UU_TIEN vốn đã hiển thị công khai cho mọi vai
  // trò (viền đỏ + badge, xem lamGiauDon()) nên lọc theo nó cũng không lộ thông tin gì mới.
  // '__CHUA_GAN__' — lọc riêng đơn CHƯA được gán Xưởng (không phải 1 giá trị Xưởng thật).
  if (xuong) list = list.filter(r => (xuong === '__CHUA_GAN__' ? !r.XUONG : r.XUONG === xuong));
  // uuTien: '1' = chỉ đơn ưu tiên, '0' = chỉ đơn thường (DonUuTien là field TÍNH TOÁN, gắn ở lamGiauDon()).
  if (uuTien === '1' || uuTien === '0') list = list.filter(r => r.DonUuTien === (uuTien === '1'));
  if (hangLoat) list = list.filter(r => !!r.NHOM_HANG_LOAT);
  // Tìm theo TÊN "Đơn hàng loạt" ĐÃ XÁC NHẬN (khác hangLoat= ở trên — đó là nhóm TỰ ĐỘNG đề xuất, xem
  // services/donHangLoatService.js) — đổi từ lọc đúng 1 mã sang tìm khớp chuỗi con trong tên
  // (13/09/2026, theo yêu cầu người dùng, vì tên sắp dài hơn theo mẫu DHLXX_<mã đơn đầu>_<mô tả>).
  // CHỈ đọc tab DonHangLoat khi thực sự có query này — tránh tốn thêm 1 lượt gọi Sheets API cho MỌI
  // lần tải danh sách đơn bình thường (route này gọi rất thường xuyên, khác hẳn GET /api/don-hang-loat
  // vốn chỉ gọi khi mở trang/panel lọc riêng).
  if (timDonHangLoat) {
    const sttKeyTrongNhom = await donHangLoatService.layDanhSachSttKeyTheoTenNhom(timDonHangLoat);
    list = list.filter(r => sttKeyTrongNhom.has(r.STT_Key));
  }
  if (kh) {
    const tuKhoa = kh.toLowerCase();
    list = list.filter(r =>
      (r.MA_KHACH_HANG || '').toLowerCase().includes(tuKhoa) ||
      (r.STT_Key || '').toLowerCase().includes(tuKhoa) ||
      // Cho tìm theo mã Tracking (cột RAW TRACKING_ID2 — khác TRACKING_ID app tự ghi) — bổ sung
      // 18/09/2026, theo yêu cầu người dùng.
      (r.TRACKING_ID2 || '').toLowerCase().includes(tuKhoa)
    );
  }
  if (tuNgay || denNgay) {
    list = list.filter(r => {
      const ngay = parseNgay(r.NGAY_LEN_DON);
      if (!ngay) return false;
      if (tuNgay && ngay < parseNgay(tuNgay)) return false;
      if (denNgay && ngay > parseNgay(denNgay)) return false;
      return true;
    });
  }

  list = sapXepDon(list, sapXep);
  list = locDonDangChayMayTheoNguoiVanHanh(list, req.session.user);
  res.json(orderService.anXuongNhieuDonVoiAdmin(list, req.session.user.vaiTro));
});

// Số liệu đếm nhanh cho Bảng điều khiển (bổ sung 22/09/2026, theo yêu cầu người dùng cải thiện hiệu
// năng) — trước đây public/bang-dieu-khien.html gọi GET / (TOÀN BỘ đơn, đủ mọi trường: ảnh, địa chỉ,
// tracking...) mỗi 60 giây CHỈ để đếm cảnh báo Vàng/Cam/Đỏ + số đơn đang chạy máy/vẽ file theo từng
// người — route riêng này tính sẵn 3 số liệu đó ở server, trả về gói tin NHỎ HƠN NHIỀU thay vì cả danh
// sách đơn. Đi qua ĐÚNG cùng pipeline lọc/tính toán với GET / (filterForRole -> lamGiauDon ->
// locDonDangChayMayTheoNguoiVanHanh) để không lệch số so với trước — CHỈ khác bước cuối (đếm thay vì
// trả nguyên list), không tự lặp lại logic lọc/tính CanhBao/NguoiVanHanh/NguoiVeFile ở đây.
router.get('/thong-ke-nhanh', async (req, res) => {
  const { rows } = await orderService.getAll();
  let list = orderService.filterForRole(rows, req.session.user);
  list = await lamGiauDon(list);
  list = locDonDangChayMayTheoNguoiVanHanh(list, req.session.user);

  const demCanhBao = { VANG: 0, CAM: 0, DO: 0 };
  const dangChayMay = {};
  const dangVeFile = {};
  for (const r of list) {
    if (r.CanhBao && demCanhBao[r.CanhBao] !== undefined) demCanhBao[r.CanhBao]++;
    if (r.NguoiVanHanh) dangChayMay[r.NguoiVanHanh] = (dangChayMay[r.NguoiVanHanh] || 0) + 1;
    if (r.NguoiVeFile) dangVeFile[r.NguoiVeFile] = (dangVeFile[r.NguoiVeFile] || 0) + 1;
  }
  res.json({ demCanhBao, dangChayMay, dangVeFile });
});

// Chuyển trạng thái HÀNG LOẠT cho nhiều đơn cùng lúc — chọn tự do bất kỳ trong 10 giá trị TRANG_THAI_XUONG,
// KHÔNG kiểm tra trạng thái hiện tại của từng đơn (khác với kịch bản quét QR — quyết định có chủ ý
// của người dùng, vì đây là công cụ sửa nhanh/sửa lỗi, không phải luồng vận hành theo pipeline).
// CHỈ đổi được TRANG_THAI_XUONG (không đổi TRANG_THAI_PHOI/TRANG_THAI_VE_FILE) — đủ dùng cho việc sửa
// nhanh/sửa lỗi ở cấp tiến trình chung, còn phôi/file sửa qua trang chi tiết đơn hoặc quét QR.
// Mở cho MỌI vai trò có quyền vào trang Đơn hàng (admin/ve_file toàn bộ, san_xuat theo phạm vi đã
// lọc), không theo giới hạn cột TRUONG_DUOC_SUA phía dưới (vốn chỉ áp dụng cho sửa từng đơn lẻ).
// Danh sách giá trị hợp lệ theo từng cột — dùng để validate tham số 'cot'/'trangThaiMoi' bên dưới
const GIA_TRI_HOP_LE_THEO_COT = {
  TRANG_THAI_XUONG: DANH_SACH_TRANG_THAI_BAO_CAO,
  TRANG_THAI_PHOI: TRANG_THAI_PHOI_VALUES,
  TRANG_THAI_VE_FILE: TRANG_THAI_VE_FILE_VALUES,
};

// Chạy `congViec(item)` cho MỌI phần tử trong `items`, THEO LÔ NHỎ SONG SONG (bổ sung 22/09/2026, theo
// yêu cầu người dùng cải thiện hiệu năng — trước đây các route "hàng loạt" dưới đây xử lý HOÀN TOÀN
// tuần tự từng đơn) — dùng chung cho các route ghi ĐỘC LẬP theo từng STT_Key trong file này, an toàn
// song song vì orderService.update() đã tự khoá theo từng đơn qua xepHangTheoDon() (2 đơn KHÁC nhau
// không bao giờ tranh chấp). KHÔNG dùng cho route chạm TRANG_THAI_PHOI (nhiều đơn CÙNG tổ hợp phôi ghi
// CHUNG 1 dòng tồn kho — xem gomThayDoiKho ở /chuyen-trang-thai-hang-loat, đã xử lý riêng bằng cách gộp
// thay đổi kho trước khi ghi, không thể song song hoá đơn giản như các route còn lại). `congViec` tự lo
// try/catch của chính nó (đẩy kết quả vào thanhCong/loi dùng chung ở nơi gọi) — hàm này chỉ lo chia lô.
const SO_SONG_SONG_HANG_LOAT = 10;
async function chayHangLoatSongSong(items, congViec) {
  for (let i = 0; i < items.length; i += SO_SONG_SONG_HANG_LOAT) {
    const lo = items.slice(i, i + SO_SONG_SONG_HANG_LOAT);
    await Promise.all(lo.map(congViec));
  }
}

// Chuyển hàng loạt — dùng CHUNG cho cả 3 cột trạng thái (TRANG_THAI_XUONG mặc định nếu không truyền
// 'cot', hoặc TRANG_THAI_PHOI/TRANG_THAI_VE_FILE — 2 nút bấm nhanh "Đã lấy phôi"/"Chưa lấy phôi"/
// "Đã vẽ file"/"Chưa vẽ file" ở trang Đơn hàng dùng chung route này, chỉ khác tham số 'cot').
// Mở cho MỌI vai trò có quyền vào trang Đơn hàng (admin/ve_file toàn bộ, san_xuat theo phạm vi đã
// lọc — đã xác nhận với người dùng là san_xuat cũng được dùng dù không phụ trách phôi/vẽ file).
// nguoi_lay_phoi đã bị chặn từ đầu file (router.use(khongPhaiNguoiLayPhoi)) — không cần kiểm tra lại
// riêng ở đây nữa (bỏ đoạn kiểm tra trùng lặp 12/09/2026 lần 2).
router.post('/chuyen-trang-thai-hang-loat', async (req, res) => {
  const { sttKeys, trangThaiMoi } = req.body;
  const cot = req.body.cot || 'TRANG_THAI_XUONG';
  const user = req.session.user;

  if (!Array.isArray(sttKeys) || sttKeys.length === 0) {
    return res.status(400).json({ error: 'Danh sách đơn trống' });
  }
  if (!trangThaiMoi || typeof trangThaiMoi !== 'string') {
    return res.status(400).json({ error: 'Thiếu trạng thái đích' });
  }
  if (!GIA_TRI_HOP_LE_THEO_COT[cot]) {
    return res.status(400).json({ error: 'Cột không hợp lệ: ' + cot });
  }
  if (!GIA_TRI_HOP_LE_THEO_COT[cot].includes(trangThaiMoi)) {
    return res.status(400).json({ error: 'Trạng thái đích không hợp lệ cho cột ' + cot });
  }

  const thanhCong = [];
  const loi = [];

  // Đọc TOÀN BỘ sheet ĐÚNG 1 LẦN cho cả lô (bổ sung 13/09/2026, xem orderService.js#getManyByKeys) —
  // trước đây mỗi đơn trong lô tự đọc thật riêng, N đơn = N lượt đọc toàn bộ sheet.
  const { headers, banDoTheoKey } = await orderService.getManyByKeys(sttKeys, { fresh: true });

  // Gộp thay đổi kho phôi cho cả lô (bổ sung 22/09/2026, theo yêu cầu người dùng cải thiện hiệu năng) —
  // CHỈ áp dụng khi cot=TRANG_THAI_PHOI (cột duy nhất kích hoạt trừ/hoàn kho, xem orderService.js#update).
  // Mảng này được orderService.update() TỰ ĐIỀN (không tự đoán lại điều kiện ở đây, xem comment ở đó) —
  // route chỉ cần flush ĐÚNG 1 LẦN sau vòng lặp thay vì N đơn tự ghi Sheets riêng lẻ.
  const gomThayDoiKho = cot === 'TRANG_THAI_PHOI' ? [] : null;

  // An toàn song song hoá (bổ sung 22/09/2026, theo yêu cầu người dùng cải thiện hiệu năng): trước đây
  // GIỮ tuần tự ở route này vì đơn CÙNG tổ hợp phôi ghi CHUNG 1 dòng tồn kho — giờ gomThayDoiKho ở trên
  // đã tách hẳn việc GHI SHEETS THẬT ra khỏi vòng lặp (chỉ push mảng trong bộ nhớ, flush 1 lần ở cuối),
  // nên phần còn lại trong vòng lặp (SQLite + kiểm tra quyền) không còn tranh chấp giữa các đơn nữa.
  await chayHangLoatSongSong(sttKeys, async (sttKey) => {
    try {
      const row = banDoTheoKey.get(sttKey);
      if (!row) {
        loi.push({ sttKey, lyDo: 'Không tìm thấy đơn hàng (có thể vừa bị xoá/sửa ở nơi khác)' });
        return;
      }
      if (!orderService.coQuyenTheoXuong(user, row)) {
        loi.push({ sttKey, lyDo: 'Không tìm thấy đơn hàng (có thể vừa bị xoá/sửa ở nơi khác)' });
        return;
      }

      const trangThaiCu = row[cot];
      const ketQuaUpdate = await orderService.update(sttKey, {
        [cot]: trangThaiMoi,
        NguoiCapNhatCuoi: user.ten,
        ThoiGianCapNhatCuoi: new Date().toISOString(),
      }, user, { donDaDoc: { headers, row }, gomThayDoiKho }); // đã đọc thật ở trên (cả lô), khỏi đọc lại lần nữa (xem orderService.update)

      thanhCong.push(sttKey);
      ghiLog({
        nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'CHUYEN_TRANG_THAI_HANG_LOAT',
        sttKey, chiTiet: {
          cot, tu: trangThaiCu, sang: trangThaiMoi,
          ...(ketQuaUpdate._daTuDongChuyenTinhTrang ? { tuDongChuyenTinhTrangSang: ketQuaUpdate._tinhTrangTuDongMoi } : {}),
        },
      }).catch(err => console.error('[Orders] Lỗi ghi log nền:', err.message));
    } catch (err) {
      loi.push({ sttKey, lyDo: err.message });
    }
  });

  if (gomThayDoiKho && gomThayDoiKho.length > 0) {
    try {
      await taiSanService.apDungThayDoiKhoHangLoat(gomThayDoiKho);
    } catch (err) {
      console.error('[Orders] Lỗi ghi gộp kho phôi hàng loạt:', err.message);
    }
  }

  res.json({ ok: true, thanhCong, loi });
});

// Admin CHỈ ĐỊNH người sản xuất chạy máy cho 1 lô đơn đã chọn (cơ chế 2 — khác cơ chế 1 là san_xuat
// tự đổi trạng thái đơn của mình qua chuyen-trang-thai-hang-loat/sửa tay/quét QR ở trên, tự động
// stamp NGUOI_CHAY_MAY qua orderService.update()). Chỉ admin — người sản xuất không tự chỉ định
// người khác được. Xem docs/superpowers/specs/2026-09-07-nguoi-chay-may-design.md.
router.post('/chi-dinh-nguoi-chay-may', async (req, res) => {
  const user = req.session.user;
  if (!laAdmin(user.vaiTro)) {
    return res.status(403).json({ error: 'Chỉ admin mới được chỉ định người chạy máy' });
  }

  const { sttKeys, nguoiSanXuat } = req.body;
  if (!Array.isArray(sttKeys) || sttKeys.length === 0) {
    return res.status(400).json({ error: 'Danh sách đơn trống' });
  }
  if (!nguoiSanXuat || typeof nguoiSanXuat !== 'string') {
    return res.status(400).json({ error: 'Thiếu người sản xuất được chỉ định' });
  }

  // Kiểm tra tên được chỉ định đúng là 1 tài khoản san_xuat đang hoạt động — tránh gõ nhầm tên (khác
  // hẳn nguy cơ chọn nhầm trong 1 dropdown có sẵn). Đọc thẳng SQLite (bổ sung 18/09/2026, xem
  // services/taiKhoanService.js) — không còn qua Google Sheets nữa.
  const dsNhanVien = taiKhoanService.layTatCa();
  const hopLe = dsNhanVien.some(r => r.Ten === nguoiSanXuat && r.VaiTro === 'san_xuat' && String(r.KichHoat).toUpperCase() === 'TRUE');
  if (!hopLe) {
    return res.status(400).json({ error: `"${nguoiSanXuat}" không phải tài khoản sản xuất đang hoạt động` });
  }

  const thanhCong = [];
  const loi = [];

  // Đọc TOÀN BỘ sheet ĐÚNG 1 LẦN cho cả lô (bổ sung 13/09/2026, xem orderService.js#getManyByKeys).
  const { headers, banDoTheoKey } = await orderService.getManyByKeys(sttKeys, { fresh: true });

  await chayHangLoatSongSong(sttKeys, async (sttKey) => {
    try {
      const row = banDoTheoKey.get(sttKey);
      if (!row) {
        loi.push({ sttKey, lyDo: 'Không tìm thấy đơn hàng (có thể vừa bị xoá/sửa ở nơi khác)' });
        return;
      }

      await orderService.update(sttKey, {
        TRANG_THAI_XUONG: 'Đang chạy máy',
        NGUOI_CHAY_MAY: nguoiSanXuat,
        GHI_CHU_CHAY_MAY: 'Admin chỉ định',
        NguoiCapNhatCuoi: user.ten,
        ThoiGianCapNhatCuoi: new Date().toISOString(),
      }, user, { donDaDoc: { headers, row } });

      thanhCong.push(sttKey);
      ghiLog({
        nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'CHI_DINH_NGUOI_CHAY_MAY',
        // sang (bổ sung 22/09/2026, theo yêu cầu người dùng) — trạng thái MỚI thật sự được set ở
        // orderService.update() ngay trên (TRANG_THAI_XUONG: 'Đang chạy máy'). Thiếu trường này khiến
        // layLichSuChuyenSangTrangThai() (services/logService.js) không nhận diện được lượt chuyển
        // trạng thái này dù đã whitelist đúng HanhDong — hàm đó đọc chiTiet.sang/chiTiet.TRANG_THAI_XUONG.
        sttKey, chiTiet: { nguoiDuocChiDinh: nguoiSanXuat, tuTrangThai: row.TRANG_THAI_XUONG, sang: 'Đang chạy máy' },
      }).catch(err => console.error('[Orders] Lỗi ghi log nền:', err.message));
    } catch (err) {
      loi.push({ sttKey, lyDo: err.message });
    }
  });

  res.json({ ok: true, thanhCong, loi });
});

// Admin CHỈ ĐỊNH người vẽ file cho 1 lô đơn đã chọn (cơ chế 2, sao chép đúng khuôn
// /chi-dinh-nguoi-chay-may) — chỉ admin. Cơ chế 1 (ve_file tự nhận) không cần route riêng nữa — từ
// khi có "Đang vẽ file" (08/09/2026, xem docs/superpowers/specs/2026-09-08-trang-thai-dang-ve-file-design.md),
// "Nhận vẽ file" chỉ là 1 lượt CHUYỂN TRẠNG THÁI như bao lượt khác, gọi thẳng route chung
// /chuyen-trang-thai-hang-loat (cot=TRANG_THAI_VE_FILE) — hook tự stamp NGUOI_VE_FILE đã có sẵn trong
// orderService.update() lo hết, đúng y hệt cách san_xuat tự nhận "Đang chạy máy".
router.post('/chi-dinh-nguoi-ve-file', async (req, res) => {
  const user = req.session.user;
  if (!laAdmin(user.vaiTro)) {
    return res.status(403).json({ error: 'Chỉ admin mới được chỉ định người vẽ file' });
  }

  const { sttKeys, nguoiVeFile } = req.body;
  if (!Array.isArray(sttKeys) || sttKeys.length === 0) {
    return res.status(400).json({ error: 'Danh sách đơn trống' });
  }
  if (!nguoiVeFile || typeof nguoiVeFile !== 'string') {
    return res.status(400).json({ error: 'Thiếu người vẽ file được chỉ định' });
  }

  const dsNhanVien = taiKhoanService.layTatCa();
  const hopLe = dsNhanVien.some(r => r.Ten === nguoiVeFile && r.VaiTro === 've_file' && String(r.KichHoat).toUpperCase() === 'TRUE');
  if (!hopLe) {
    return res.status(400).json({ error: `"${nguoiVeFile}" không phải tài khoản vẽ file đang hoạt động` });
  }

  const thanhCong = [];
  const loi = [];

  // Đọc TOÀN BỘ sheet ĐÚNG 1 LẦN cho cả lô (bổ sung 13/09/2026, xem orderService.js#getManyByKeys).
  const { headers, banDoTheoKey } = await orderService.getManyByKeys(sttKeys, { fresh: true });

  await chayHangLoatSongSong(sttKeys, async (sttKey) => {
    try {
      const row = banDoTheoKey.get(sttKey);
      if (!row) {
        loi.push({ sttKey, lyDo: 'Không tìm thấy đơn hàng (có thể vừa bị xoá/sửa ở nơi khác)' });
        return;
      }

      await orderService.update(sttKey, {
        TRANG_THAI_VE_FILE: 'Đang vẽ file',
        NGUOI_VE_FILE: nguoiVeFile,
        GHI_CHU_VE_FILE: 'Admin chỉ định',
        NguoiCapNhatCuoi: user.ten,
        ThoiGianCapNhatCuoi: new Date().toISOString(),
      }, user, { donDaDoc: { headers, row } });

      thanhCong.push(sttKey);
      ghiLog({
        nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'CHI_DINH_NGUOI_VE_FILE',
        // sang (bổ sung 22/09/2026, theo yêu cầu người dùng) — cùng lý do CHI_DINH_NGUOI_CHAY_MAY ở
        // trên: trạng thái MỚI thật sự set ở orderService.update() ngay trên (TRANG_THAI_VE_FILE:
        // 'Đang vẽ file').
        sttKey, chiTiet: { nguoiDuocChiDinh: nguoiVeFile, sang: 'Đang vẽ file' },
      }).catch(err => console.error('[Orders] Lỗi ghi log nền:', err.message));
    } catch (err) {
      loi.push({ sttKey, lyDo: err.message });
    }
  });

  res.json({ ok: true, thanhCong, loi });
});

// Màu nền thẻ đơn theo Xưởng (bổ sung 23/09/2026, theo yêu cầu người dùng — "mỗi Xưởng có thể có màu
// riêng để dễ phân biệt các đơn thuộc các xưởng khác nhau", thay cho 2 màu HN/BN hard-code cũ trong
// style.css). GET mở cho MỌI người đã đăng nhập (orders.html/my-orders.html/my-orders-ve-file.html đều
// cần đọc để tô màu thẻ — admin không có XUONG trong dữ liệu đơn nên tự nhiên không tô được gì, không
// cần chặn riêng, xem services/orderService.js#anXuongVoiAdmin). POST (đổi màu) CHỈ superadmin — cùng
// mức nhạy cảm với /gan-xuong ở dưới.
// Danh sách Xưởng (bổ sung 24/09/2026, theo yêu cầu người dùng — trước đây hằng số cố định trong code,
// giờ quản lý được qua Settings: thêm/đổi tên/xoá, xem services/caiDatDbService.js#layDanhSachXuong).
// GET mở cho MỌI người đã đăng nhập (orders.html/users.html đều cần đọc để đổ vào các ô chọn Xưởng) —
// cùng mức mở với /mau-xuong ở dưới. "ChuaGanXuong" giờ là 1 Xưởng BÌNH THƯỜNG trong danh sách này
// (theo yêu cầu người dùng) — KHÁC trạng thái "(chưa gán)" thật (XUONG rỗng), không nằm trong đây.
router.get('/danh-sach-xuong', (req, res) => {
  res.json(orderService.layDanhSachXuong());
});

router.post('/xuong', (req, res) => {
  const user = req.session.user;
  if (!laSuperAdmin(user.vaiTro)) {
    return res.status(403).json({ error: 'Chỉ superadmin mới được tạo Xưởng' });
  }
  const ten = String(req.body.ten || '').trim();
  if (!ten) return res.status(400).json({ error: 'Tên Xưởng không được để trống' });
  if (orderService.layDanhSachXuong().includes(ten)) {
    return res.status(400).json({ error: `Xưởng "${ten}" đã tồn tại` });
  }
  themXuong(ten);
  res.json({ ok: true });
});

// Đổi tên CASCADE sang mọi đơn/nhân viên đang mang tên cũ (đã xác nhận với người dùng — không cascade
// thì đơn/nhân viên "mất kết nối" với Xưởng ngay sau khi đổi tên, không còn khớp bộ lọc/phân quyền theo
// Xưởng nữa) + màu đã cấu hình (doiTenXuong() ở caiDatDbService.js tự lo phần màu). 2 bảng đơn/nhân
// viên nằm ở 2 file SQLite RIÊNG (trang_thai_don.db, tai_khoan.db) nên phải tự gọi cả 2, không có cách
// nào 1 câu SQL xử lý chung được.
router.put('/xuong/:tenCu', (req, res) => {
  const user = req.session.user;
  if (!laSuperAdmin(user.vaiTro)) {
    return res.status(403).json({ error: 'Chỉ superadmin mới được đổi tên Xưởng' });
  }
  const tenCu = req.params.tenCu;
  const tenMoi = String(req.body.tenMoi || '').trim();
  const danhSach = orderService.layDanhSachXuong();
  if (!danhSach.includes(tenCu)) return res.status(404).json({ error: `Không tìm thấy Xưởng "${tenCu}"` });
  if (!tenMoi) return res.status(400).json({ error: 'Tên mới không được để trống' });
  if (tenMoi !== tenCu && danhSach.includes(tenMoi)) {
    return res.status(400).json({ error: `Xưởng "${tenMoi}" đã tồn tại` });
  }

  doiTenXuong(tenCu, tenMoi);
  trangThaiDbService.doiTenXuongHangLoat(tenCu, tenMoi);
  taiKhoanService.doiTenXuongHangLoat(tenCu, tenMoi);
  res.json({ ok: true });
});

// Chặn xoá nếu còn đơn/nhân viên đang gán Xưởng này (đã xác nhận với người dùng — an toàn hơn xoá liều
// rồi để lại dữ liệu "mồ côi" không còn Xưởng nào khớp).
router.delete('/xuong/:ten', (req, res) => {
  const user = req.session.user;
  if (!laSuperAdmin(user.vaiTro)) {
    return res.status(403).json({ error: 'Chỉ superadmin mới được xoá Xưởng' });
  }
  const ten = req.params.ten;
  if (!orderService.layDanhSachXuong().includes(ten)) {
    return res.status(404).json({ error: `Không tìm thấy Xưởng "${ten}"` });
  }
  const soDon = trangThaiDbService.demTheoXuong(ten);
  const soNhanVien = taiKhoanService.demTheoXuong(ten);
  if (soDon > 0 || soNhanVien > 0) {
    return res.status(400).json({
      error: `Không thể xoá — còn ${soDon} đơn và ${soNhanVien} nhân viên đang gán Xưởng "${ten}". Hãy chuyển hết sang Xưởng khác trước.`,
    });
  }
  xoaXuong(ten);
  res.json({ ok: true });
});

router.get('/mau-xuong', (req, res) => {
  res.json(layMauTheoXuong());
});

router.post('/mau-xuong', (req, res) => {
  const user = req.session.user;
  if (!laSuperAdmin(user.vaiTro)) {
    return res.status(403).json({ error: 'Chỉ superadmin mới được đổi màu Xưởng' });
  }
  const { xuong, mau } = req.body;
  if (!orderService.layDanhSachXuong().includes(xuong)) {
    return res.status(400).json({ error: `Xưởng không hợp lệ: "${xuong}" — chỉ chấp nhận: ${orderService.layDanhSachXuong().join(', ')}` });
  }
  // mau = '' hợp lệ (bỏ màu, về lại nền mặc định) — chỉ chặn giá trị SAI định dạng, không chặn rỗng.
  if (mau && !/^#[0-9a-f]{6}$/i.test(mau)) {
    return res.status(400).json({ error: `Mã màu không hợp lệ: "${mau}" — cần dạng #rrggbb.` });
  }
  datMauXuong(xuong, mau || '');
  res.json({ ok: true });
});

// GÁN XƯỞNG (HN/BN...) cho 1 lô đơn đã chọn — bổ sung 13/09/2026, theo yêu cầu người
// dùng (phân loại đơn theo xưởng vật lý, mỗi xưởng chỉ thành viên cùng Xưởng mới xem/thao tác được —
// xem services/orderService.js#locTheoXuong/coQuyenTheoXuong). CHỈ superadmin (thu hẹp từ admin+
// superadmin xuống CHỈ superadmin — bổ sung 18/09/2026, theo yêu cầu người dùng: admin không còn được
// thấy/thao tác thông tin Xưởng của đơn hàng nữa, xem orderService.js#anXuongVoiAdmin) — cùng khuôn
// /chi-dinh-nguoi-chay-may/-ve-file (chọn hàng loạt ở trang Đơn hàng), KHÔNG có điều khiển riêng ở
// trang chi tiết 1 đơn (đã xác nhận với người dùng). Không kiểm tra coQuyenTheoXuong ở đây — superadmin
// luôn được xem/gán MỌI đơn bất kể Xưởng hiện tại (cùng quyền admin trước đây, qua laAdmin()).
router.post('/gan-xuong', async (req, res) => {
  const user = req.session.user;
  if (!laSuperAdmin(user.vaiTro)) {
    return res.status(403).json({ error: 'Chỉ superadmin mới được gán Xưởng cho đơn' });
  }

  const { sttKeys, xuong } = req.body;
  if (!Array.isArray(sttKeys) || sttKeys.length === 0) {
    return res.status(400).json({ error: 'Danh sách đơn trống' });
  }
  // xuong = '' hợp lệ (gỡ gán, đưa đơn về "chưa có xưởng") — chỉ chặn giá trị SAI, không chặn rỗng.
  if (xuong && !orderService.layDanhSachXuong().includes(xuong)) {
    return res.status(400).json({ error: `Xưởng không hợp lệ: "${xuong}" — chỉ chấp nhận: ${orderService.layDanhSachXuong().join(', ')}` });
  }

  const thanhCong = [];
  const loi = [];

  // Đọc TOÀN BỘ sheet ĐÚNG 1 LẦN cho cả lô (bổ sung 13/09/2026, xem orderService.js#getManyByKeys).
  const { headers, banDoTheoKey } = await orderService.getManyByKeys(sttKeys, { fresh: true });

  await chayHangLoatSongSong(sttKeys, async (sttKey) => {
    try {
      const row = banDoTheoKey.get(sttKey);
      if (!row) {
        loi.push({ sttKey, lyDo: 'Không tìm thấy đơn hàng (có thể vừa bị xoá/sửa ở nơi khác)' });
        return;
      }

      await orderService.update(sttKey, {
        XUONG: xuong || '',
        NguoiCapNhatCuoi: user.ten,
        ThoiGianCapNhatCuoi: new Date().toISOString(),
      }, user, { donDaDoc: { headers, row } });

      thanhCong.push(sttKey);
      ghiLog({
        nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'GAN_XUONG',
        sttKey, chiTiet: { tuXuong: row.XUONG || '', sangXuong: xuong || '' },
      }).catch(err => console.error('[Orders] Lỗi ghi log nền:', err.message));
    } catch (err) {
      loi.push({ sttKey, lyDo: err.message });
    }
  });

  res.json({ ok: true, thanhCong, loi });
});

// Admin/ve_file ĐÁNH DẤU hoặc BỎ ĐÁNH DẤU "Đơn ưu tiên" cho 1 lô đơn — bổ sung 13/09/2026, theo yêu
// cầu người dùng (đơn ưu tiên hiện lên đầu danh sách + có viền đỏ nổi bật quanh tên, xem sapXepDon() ở
// trên và public/orders.html). Dùng CHUNG route này cho CẢ 2 nơi bấm: nút bật/tắt nhanh trên từng thẻ
// (gọi với đúng 1 phần tử trong sttKeys) VÀ khối chọn hàng loạt ở thanh hành động — cùng khuôn gọi tuần
// tự từng đơn qua chayHangLoatCoTienDo() như apDungGanXuong(). RỘNG HƠN /gan-xuong (admin-only): ở đây
// CẢ admin LẪN ve_file đều được phép (đã xác nhận với người dùng — "Đơn ưu tiên" là việc phân loại độ
// khẩn cấp công việc, không phải phân chia xưởng vật lý như XUONG).
router.post('/danh-dau-uu-tien', async (req, res) => {
  const user = req.session.user;
  if (!laAdmin(user.vaiTro) && user.vaiTro !== 've_file') {
    return res.status(403).json({ error: 'Chỉ admin/người vẽ file mới được đánh dấu Đơn ưu tiên' });
  }

  const { sttKeys, uuTien } = req.body;
  if (!Array.isArray(sttKeys) || sttKeys.length === 0) {
    return res.status(400).json({ error: 'Danh sách đơn trống' });
  }
  if (typeof uuTien !== 'boolean') {
    return res.status(400).json({ error: 'Thiếu giá trị uuTien (true/false)' });
  }
  const giaTriMoi = uuTien ? 'TRUE' : 'FALSE';

  const thanhCong = [];
  const loi = [];

  // Đọc TOÀN BỘ sheet ĐÚNG 1 LẦN cho cả lô (xem orderService.js#getManyByKeys).
  const { headers, banDoTheoKey } = await orderService.getManyByKeys(sttKeys, { fresh: true });

  await chayHangLoatSongSong(sttKeys, async (sttKey) => {
    try {
      const row = banDoTheoKey.get(sttKey);
      if (!row) {
        loi.push({ sttKey, lyDo: 'Không tìm thấy đơn hàng (có thể vừa bị xoá/sửa ở nơi khác)' });
        return;
      }
      if (!orderService.coQuyenTheoXuong(user, row)) {
        loi.push({ sttKey, lyDo: 'Không tìm thấy đơn hàng (có thể vừa bị xoá/sửa ở nơi khác)' });
        return;
      }

      await orderService.update(sttKey, {
        DON_UU_TIEN: giaTriMoi,
        NguoiCapNhatCuoi: user.ten,
        ThoiGianCapNhatCuoi: new Date().toISOString(),
      }, user, { donDaDoc: { headers, row } });

      thanhCong.push(sttKey);
      ghiLog({
        nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'DANH_DAU_UU_TIEN',
        sttKey, chiTiet: { uuTien },
      }).catch(err => console.error('[Orders] Lỗi ghi log nền:', err.message));
    } catch (err) {
      loi.push({ sttKey, lyDo: err.message });
    }
  });

  res.json({ ok: true, thanhCong, loi });
});

// Mật khẩu xác nhận riêng cho 2 thao tác PHÁ HUỶ/KHÔI PHỤC dữ liệu đơn hàng (bổ sung 24/09/2026, theo
// yêu cầu người dùng) — CHỈ là 1 lớp xác nhận CHỦ ĐÍCH thêm (đứng SAU laSuperAdmin(), vốn đã là lớp
// phân quyền thật qua session), không phải mật khẩu tài khoản: mục đích là chặn bấm nhầm/dùng ẩu khi
// phiên superadmin đang mở sẵn (vd người khác mượn máy), không phải để chống truy cập trái phép — vẫn
// hardcode CỐ Ý (không cần cấu hình được ở Settings, người dùng không yêu cầu). Kiểm tra Ở SERVER (không
// chỉ client) để không thể lách qua bằng cách gọi thẳng API.
const MAT_KHAU_THAO_TAC_DU_LIEU_DON = '2511';

// "Xoá dữ liệu đơn hàng" (bổ sung 20/09/2026, theo yêu cầu người dùng) — CHỈ superadmin (laSuperAdmin(),
// KHÁC mọi bulk action khác trong file này vốn cho cả admin qua laAdmin()) vì đây là thao tác PHÁ HUỶ
// VĨNH VIỄN, không thể hoàn tác — cùng khuôn chặt chẽ nhất đã dùng cho POST /gan-xuong ở trên. Xem
// services/xoaDuLieuDonService.js để biết CHÍNH XÁC những gì bị xoá và lý do KHÔNG xoá được dòng "gốc"
// trên Sheets (chỉ ẩn vĩnh viễn qua cờ DA_XOA).
//
// Ghi ĐÚNG 1 dòng log audit cho CẢ LÔ, STT_Key để TRỐNG (khác mọi route khác trong file này luôn ghi
// log RIÊNG từng đơn) — log riêng từng đơn với STT_Key trùng đơn vừa xoá sẽ tự mâu thuẫn: chính dòng
// log đó là "dữ liệu liên quan tới đơn" chưa kịp xoá. Ghi 1 dòng chung, liệt kê danh sách trong ChiTiet,
// để dòng audit này sống sót vĩnh viễn trong Lịch sử hệ thống, không bị xoá bởi bất kỳ đơn nào trong đó.
router.post('/xoa-du-lieu-hang-loat', async (req, res) => {
  const user = req.session.user;
  if (!laSuperAdmin(user.vaiTro)) {
    return res.status(403).json({ error: 'Chỉ superadmin mới được xoá dữ liệu đơn hàng' });
  }
  if (req.body.matKhau !== MAT_KHAU_THAO_TAC_DU_LIEU_DON) {
    return res.status(403).json({ error: 'Sai mật khẩu xác nhận — không xoá gì cả.' });
  }

  const { sttKeys } = req.body;
  if (!Array.isArray(sttKeys) || sttKeys.length === 0) {
    return res.status(400).json({ error: 'Danh sách đơn trống' });
  }

  const { banDoTheoKey } = await orderService.getManyByKeys(sttKeys, { fresh: true });

  const thanhCong = [];
  const loi = [];
  for (const sttKey of sttKeys) {
    if (!banDoTheoKey.get(sttKey)) {
      loi.push({ sttKey, lyDo: 'Không tìm thấy đơn hàng (có thể đã bị xoá dữ liệu ở nơi khác)' });
      continue;
    }
    try {
      await xoaDuLieuDon(sttKey);
      thanhCong.push(sttKey);
    } catch (err) {
      loi.push({ sttKey, lyDo: err.message });
    }
  }

  if (thanhCong.length > 0) {
    ghiLog({
      nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'XOA_DU_LIEU_DON_HANG',
      sttKey: '', chiTiet: { sttKeys: thanhCong, soLuong: thanhCong.length },
    }).catch(err => console.error('[Orders] Lỗi ghi log nền:', err.message));
  }

  res.json({ ok: true, thanhCong, loi });
});

// "Khôi phục đơn đã xoá dữ liệu" (bổ sung 24/09/2026, theo yêu cầu người dùng) — bản web của
// scripts/khoi-phuc-don-da-xoa.js (vẫn giữ nguyên, dùng được từ VPS không cần trình duyệt): CHỈ xoá cờ
// DA_XOA, dữ liệu app đã xoá thật trước đó (lịch sử, ảnh, tư cách nhóm...) KHÔNG khôi phục lại được —
// xem đúng chú thích ở script CLI. Nhận danh sách STT_Key CỤ THỂ (không có nút "khôi phục tất cả") —
// theo yêu cầu người dùng, để luôn chủ động chọn đúng đơn cần khôi phục, tránh khôi phục nhầm đơn đã
// xoá có chủ đích khác. CHỈ superadmin + đúng mật khẩu xác nhận, cùng khuôn với /xoa-du-lieu-hang-loat.
router.post('/khoi-phuc-du-lieu-hang-loat', async (req, res) => {
  const user = req.session.user;
  if (!laSuperAdmin(user.vaiTro)) {
    return res.status(403).json({ error: 'Chỉ superadmin mới được khôi phục dữ liệu đơn hàng' });
  }
  if (req.body.matKhau !== MAT_KHAU_THAO_TAC_DU_LIEU_DON) {
    return res.status(403).json({ error: 'Sai mật khẩu xác nhận — không khôi phục gì cả.' });
  }

  const { sttKeys } = req.body;
  if (!Array.isArray(sttKeys) || sttKeys.length === 0) {
    return res.status(400).json({ error: 'Danh sách đơn trống' });
  }

  const thanhCong = [];
  const loi = [];
  for (const sttKey of sttKeys) {
    const dong = trangThaiDbService.layTheoKey(sttKey);
    if (dong.DA_XOA !== 'TRUE') {
      loi.push({ sttKey, lyDo: 'Đơn này không bị ẩn do "Xoá dữ liệu đơn" — không có gì để khôi phục' });
      continue;
    }
    trangThaiDbService.ghiDe(sttKey, { DA_XOA: '' });
    thanhCong.push(sttKey);
  }

  // Ghi 1 dòng log audit chung cho cả lô — cùng lý do đã ghi ở /xoa-du-lieu-hang-loat (dòng audit phải
  // sống sót độc lập, không gắn STT_Key nào trong danh sách vừa khôi phục).
  if (thanhCong.length > 0) {
    ghiLog({
      nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'KHOI_PHUC_DU_LIEU_DON_HANG',
      sttKey: '', chiTiet: { sttKeys: thanhCong, soLuong: thanhCong.length },
    }).catch(err => console.error('[Orders] Lỗi ghi log nền:', err.message));
  }

  res.json({ ok: true, thanhCong, loi });
});

// Những kịch bản (trong CauHinhKichBan) có thể áp dụng cho trạng thái hiện tại của đơn —
// dùng để hiện nút "Chuyển sang..." trên trang chi tiết mà không cần quét QR
// So khớp đúng CỘT mà từng kịch bản thao tác (Cot trong CauHinhKichBan — TRANG_THAI_XUONG hoặc
// TRANG_THAI_PHOI hoặc TRANG_THAI_VE_FILE), không chỉ so với TRANG_THAI_XUONG như bản cũ (trước 24/08/2026,
// lúc đó mọi kịch bản đều chỉ thao tác trên đúng 1 cột TRANG_THAI_XUONG nên không cần phân biệt). Đồng
// thời chỉ hiện kịch bản mà VAI TRÒ đang xem được phép dùng (Nguoi_Thuc_Hien) — tránh hiện nút rồi
// bấm vào bị từ chối (qr.js cũng chặn lại lần nữa ở phía server, đây chỉ là để giao diện đỡ rối).
async function layKichBanKeTiep(row, user) {
  const list = await scenarioService.layDanhSachKichBan();
  return list.filter(s =>
    (!s.requireStatus || s.requireStatus === row[s.column]) &&
    (laAdmin(user.vaiTro) || !s.allowedRoles || s.allowedRoles.includes(user.vaiTro))
  );
}

router.get('/:sttKey', async (req, res) => {
  const { row } = await orderService.getByKey(req.params.sttKey);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

  const user = req.session.user;
  // Chặn xem đơn KHÁC Xưởng — coi như không tồn tại, cùng cách san_xuat KHÁC người vận hành bị ẩn bên
  // dưới (không lộ thông tin đơn thuộc xưởng khác, kể cả việc xác nhận đơn đó CÓ tồn tại).
  if (!orderService.coQuyenTheoXuong(user, row)) {
    return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
  }

  const [lichSu, [donDaLamGiau], kichBanKeTiep] = await Promise.all([
    layLichSuTheoDon(req.params.sttKey),
    lamGiauDon([row]),
    layKichBanKeTiep(row, user),
  ]);

  // Ẩn hoàn toàn (404) nếu là san_xuat KHÁC người đang vận hành đơn "Đang chạy máy" — xem
  // locDonDangChayMayTheoNguoiVanHanh phía trên.
  if (user.vaiTro === 'san_xuat' && row.TRANG_THAI_XUONG === TRANG_THAI_DANG_CHAY_MAY &&
      donDaLamGiau.NguoiVanHanh && donDaLamGiau.NguoiVanHanh !== user.ten) {
    return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
  }

  res.json(orderService.anXuongVoiAdmin({ ...donDaLamGiau, lichSu, kichBanKeTiep }, user.vaiTro));
});

// CHÍNH SÁCH PHÂN QUYỀN (cập nhật 26/08/2026 — nguoi_lay_phoi KHÔNG được set tay bất kỳ trường nào
// của bất kỳ đơn nào nữa, kể cả GHI_CHU; trước đó có cho sửa riêng GHI_CHU nhưng đã bỏ):
//   - admin, ve_file: không có trong danh sách dưới đây = sửa được MỌI trường (trừ TRUONG_CAM_SUA).
//   - san_xuat: chỉ sửa được 3 cột trạng thái + ghi chú — theo đúng mô tả "lỗi thì set tay, làm lại
//     thì cũng set tay" (san_xuat là người phát hiện lỗi sản xuất, cần tự set TRANG_THAI_XUONG sang lỗi,
//     và tự set lại cả 2 cột phôi/file về "chưa" khi cần làm lại — không phải đợi nguoi_lay_phoi/
//     ve_file làm hộ từng bước).
//   - nguoi_lay_phoi: mảng rỗng = không sửa được trường nào qua route này (chỉ được thao tác qua
//     quét QR đúng kịch bản của mình — xem routes/qr.js).
const TRUONG_DUOC_SUA = {
  san_xuat: ['GHI_CHU', 'TRANG_THAI_XUONG', 'TRANG_THAI_PHOI', 'TRANG_THAI_VE_FILE'],
  nguoi_lay_phoi: [],
};

// Không bao giờ cho phép sửa qua các cột này — khóa chính, field nội bộ, hoặc trường chỉ tính toán để hiển thị.
// XUONG (bổ sung 13/09/2026) cũng bị cấm ở ĐÂY — bắt buộc gán qua đúng 1 đường POST /gan-xuong
// (admin-only, hàng loạt ở trang Đơn hàng), không cho lách qua form sửa 1 đơn (kể cả admin/ve_file).
// DON_UU_TIEN (bổ sung 13/09/2026) cùng lý do — bắt buộc qua POST /danh-dau-uu-tien (admin/ve_file,
// nút bật/tắt nhanh trên thẻ hoặc chọn hàng loạt), không cho lách qua form sửa 1 đơn.
// DA_XOA (bổ sung 20/09/2026, phát hiện qua rà soát bảo mật) — PHẢI cấm ở đây, cùng lý do XUONG/
// DON_UU_TIEN: đây là cờ CHỈ superadmin được set (qua POST /xoa-du-lieu-hang-loat, xem
// services/xoaDuLieuDonService.js) — thiếu nó ở đây, admin/ve_file (không có allowlist TRUONG_DUOC_SUA
// riêng) có thể set thẳng DA_XOA=TRUE qua route sửa 1 đơn này, ẩn vĩnh viễn đơn khỏi app mà KHÔNG dọn
// dẹp log/nhóm Đơn hàng loạt/ảnh MinIO và KHÔNG có log audit — lách hoàn toàn giới hạn "chỉ superadmin".
const TRUONG_CAM_SUA = ['STT_Key', '_row', 'NguoiCapNhatCuoi', 'ThoiGianCapNhatCuoi', 'TenKhachHang', 'TieuDeSanPham', 'ViTriTheu', 'CanhBao', 'XUONG', 'DON_UU_TIEN', 'DA_XOA'];

router.put('/:sttKey', async (req, res) => {
  const user = req.session.user;
  const allowed = TRUONG_DUOC_SUA[user.vaiTro]; // undefined cho admin/ve_file = sửa hết (trừ TRUONG_CAM_SUA)
  let updates = req.body;

  if (allowed) {
    updates = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
  }
  updates = Object.fromEntries(Object.entries(updates).filter(([k]) => !TRUONG_CAM_SUA.includes(k)));

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Không có trường nào được phép sửa với vai trò này' });
  }

  updates.NguoiCapNhatCuoi = user.ten;
  updates.ThoiGianCapNhatCuoi = new Date().toISOString();

  // Đọc thật TRƯỚC khi ghi (không phải thêm 1 lượt đọc — truyền qua donDaDoc bên dưới để
  // orderService.update() dùng lại đúng lượt đọc này, không đọc lại lần nữa) — cần biết giá trị CŨ
  // của 3 cột trạng thái để ghi log đủ chi tiết {tu, sang} như quét QR/sửa hàng loạt đang có, thay vì
  // chỉ ghi mỗi giá trị mới (xem docs/superpowers/specs/2026-09-07-mo-rong-log-hoat-dong-design.md).
  const { headers, row } = await orderService.getByKey(req.params.sttKey, { fresh: true });
  if (!row) return res.status(404).json({ error: 'Không tìm thấy đơn hàng: ' + req.params.sttKey });
  // Chặn sửa đơn KHÁC Xưởng (bổ sung 13/09/2026) — coi như không tồn tại, cùng cách GET /:sttKey ở trên.
  if (!orderService.coQuyenTheoXuong(user, row)) {
    return res.status(404).json({ error: 'Không tìm thấy đơn hàng: ' + req.params.sttKey });
  }

  let updated;
  try {
    updated = await orderService.update(req.params.sttKey, updates, user, { donDaDoc: { headers, row } });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const truocKhiSua = {};
  Object.keys(GIA_TRI_HOP_LE_THEO_COT).forEach(cot => {
    if (updates[cot] !== undefined && updates[cot] !== row[cot]) truocKhiSua[cot] = row[cot] || '';
  });

  await ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'CAP_NHAT_DON',
    sttKey: req.params.sttKey,
    chiTiet: {
      ...updates,
      ...(Object.keys(truocKhiSua).length ? { _truocKhiSua: truocKhiSua } : {}),
      ...(updated._daTuDongChuyenTinhTrang ? { tuDongChuyenTinhTrangSang: updated._tinhTrangTuDongMoi } : {}),
    },
  });
  res.json(updated);
});

// ============================================================
// "ĐƠN HÀNG LOẠT" — quét đơn thiếu HASH_ANH_MAU TRONG PHẠM VI ĐƠN ĐANG CHỌN (tick) trên trang, tính
// perceptual hash (dHash) cho ảnh mẫu (DUONG_DAN_URL), rồi gom nhóm các đơn có ảnh mẫu giống/gần
// giống nhau (khoảng cách Hamming nhỏ) vào cùng 1 mã NHOM_HANG_LOAT — CHỈ so khớp nội bộ trong lô
// đang chọn, không đụng đơn ngoài lựa chọn. Chạy THỦ CÔNG khi người dùng bấm nút "QUÉT TÌM ĐƠN HÀNG
// LOẠT" ở public/orders.html — KHÔNG có lịch chạy nền tự động. Dùng đúng mô hình "job chạy nền + hỏi
// tiến độ + có nút Dừng" đã có ở routes/reports.js (_congViecInDon) cho "IN ĐƠN ĐANG CHỌN", chỉ khác
// domain. Xem thiết kế đầy đủ ở docs/superpowers/specs/2026-09-06-don-hang-loat-design.md và
// docs/superpowers/specs/2026-09-06-quet-hang-loat-theo-lua-chon-design.md (giới hạn theo lựa chọn).
// ============================================================

const _congViecHangLoat = new Map(); // jobId -> { tongSo, daXong, trangThai, daHuy, loi, ketQua, capNhatLucNao }
const THOI_GIAN_GIU_JOB_HANG_LOAT_MS = 15 * 60 * 1000;

function donDepJobHangLoatCu() {
  const gioiHan = Date.now() - THOI_GIAN_GIU_JOB_HANG_LOAT_MS;
  for (const [id, job] of _congViecHangLoat) {
    if (job.capNhatLucNao < gioiHan) _congViecHangLoat.delete(id);
  }
}

// Ảnh dùng để tính hash so khớp "Đơn hàng loạt" — ƯU TIÊN ảnh mẫu PNG (DUONG_DAN_URL, đúng đối tượng
// cần so khớp "cùng thiết kế thêu"), CHỈ dùng ảnh Mockup khi đơn KHÔNG có PNG (bổ sung 13/09/2026,
// theo yêu cầu người dùng — trước đó đơn thiếu PNG bị bỏ qua hoàn toàn, không tính được hash).
function anhSoSanhCuaDon(don) {
  return don.DUONG_DAN_URL || don.MOCKUP || '';
}

// Gộp nhóm kiểu "complete-linkage" (bổ sung 15/09/2026, THAY Union-Find/single-linkage cũ — xem
// docs/superpowers/specs/2026-09-15-gop-nhom-complete-linkage-design.md) — 1 đơn CHỈ được thêm vào 1
// nhóm đang xây nếu nó nằm trong ngưỡng Hamming với MỌI thành viên đã có trong nhóm đó, không chỉ 1
// người. Union-Find cũ chỉ cần 1 CHUỖI liên kết bắc cầu (A gần B, B gần C) là gộp cả A-C dù A-C khác
// hẳn nhau ("chaining") — xác nhận đúng nguyên nhân khiến nhiều cụm nhỏ ĐÚNG (nhiều thiết kế giống hệt
// nhau) vẫn bị nối chuỗi qua vài cặp "gần đúng biên" thành 1 nhóm khổng lồ lẫn lộn, dù đã sửa cả 2 lỗi
// hash trước đó (.trim(), tăng lưới 256 bit) — dữ liệu thật người dùng gửi cho thấy rõ nhiều cụm nhỏ
// rành mạch bên trong 1 nhóm lớn bị gộp nhầm, không phải toàn bộ ngẫu nhiên giống nhau.
// Tham lam theo thứ tự mảng — không tối ưu toàn cục (kết quả có thể phụ thuộc thứ tự duyệt) nhưng đủ
// dùng cho gợi ý sơ bộ (người dùng luôn tự xác nhận lại trước khi đưa vào Đơn hàng loạt chính thức,
// xem "Nhóm hệ thống đề xuất" ở don-hang-loat.html) — ưu tiên KHÔNG BAO GIỜ gộp nhầm hơn là gộp tối ưu.
function gomNhomCompleteLinkage(coHash, nguong) {
  const theoNhom = new Map(); // "index bắt đầu nhóm" -> [đơn...] — cùng hình dạng Map cũ để code dưới không cần đổi
  const daXep = new Array(coHash.length).fill(false);
  for (let i = 0; i < coHash.length; i++) {
    if (daXep[i]) continue;
    const idxTrongNhom = [i];
    for (let j = i + 1; j < coHash.length; j++) {
      if (daXep[j]) continue;
      const ganHetThayVi = idxTrongNhom.every(k =>
        khoangCachHamming(coHash[k].HASH_ANH_MAU, coHash[j].HASH_ANH_MAU) <= nguong);
      if (ganHetThayVi) idxTrongNhom.push(j);
    }
    if (idxTrongNhom.length >= 2) idxTrongNhom.forEach(idx => { daXep[idx] = true; });
    theoNhom.set(i, idxTrongNhom.map(idx => coHash[idx]));
  }
  return theoNhom;
}

// Tính lại NHOM_HANG_LOAT — CHỈ trong phạm vi đơn nằm trong `sttKeySet` (lô đơn người dùng đang chọn
// lúc bấm quét, xem docs/superpowers/specs/2026-09-06-quet-hang-loat-theo-lua-chon-design.md). Đơn
// ngoài `sttKeySet` — dù đã có HASH_ANH_MAU — hoàn toàn không được đọc để so khớp, không bị đụng tới.
// 1 đơn cũ đã có hash từ trước NẰM TRONG sttKeySet vẫn cần được xét lại vì 1 đơn MỚI vừa hash xong
// trong cùng lô có thể khớp với nó. Chỉ ghi lại Sheet những đơn có mã nhóm THAY ĐỔI so với hiện tại.
// `nguong` đọc 1 LẦN DUY NHẤT ở đầu route (POST /quet-hang-loat/bat-dau) trước khi job chạy nền, giữ
// nguyên suốt cả job — không đọc lại giữa chừng dù ai đó đổi ngưỡng lúc job đang chạy (nhất quán với
// cách sttKeySet/rows cũng chỉ chụp 1 lần, xem services/donHangLoatService.js#layNguong để đổi).
async function tinhLaiNhomHangLoat(sttKeySet, nguong) {
  // {fresh:true} — bước gộp nhóm này có thể chạy sau khi vòng lặp tính hash phía trên đã kéo dài, cần
  // dữ liệu HASH_ANH_MAU/NHOM_HANG_LOAT mới nhất (SQLite, không dính cache 10 giây của Sheets) để so
  // khớp đúng. Ghi bên dưới đi thẳng qua trangThaiDbService theo STT_Key — không còn cần biết số dòng
  // vật lý nữa (bỏ hẳn layLaiSoDongMoiNhat/_row, xem
  // docs/superpowers/specs/2026-09-18-chuyen-cot-app-ghi-sang-sqlite-design.md).
  const { rows: tatCaDon } = await orderService.getAll({ fresh: true });
  const coHash = tatCaDon.filter(d => sttKeySet.has(d.STT_Key) && d.HASH_ANH_MAU);
  const theoNhom = gomNhomCompleteLinkage(coHash, nguong);

  const maNhomTheoSttKey = new Map(); // STT_Key -> mã nhóm (chỉ chứa đơn thuộc component ≥ 2 đơn)
  // Mã nhóm cũ ĐÃ bị 1 cụm khác nhận trong CHÍNH lượt quét này rồi (bổ sung 15/09/2026 lần 3, theo
  // phản hồi thực tế: sau khi đổi sang complete-linkage, 1 nhóm sai cũ (vd "9COM18" 107 đơn) tách ĐÚNG
  // thành nhiều cụm nhỏ nội bộ (Bridesmaid riêng, Hocus Pocus riêng...) nhưng MỌI thành viên của TẤT
  // CẢ các cụm đó vẫn đang mang chung ĐÚNG 1 mã nhóm cũ "9COM18" — logic "nhập vào mã cũ" bên dưới nhặt
  // lại mã đó cho MỌI cụm, vô tình gán CHUNG 1 mã cho nhiều cụm thật sự khác nhau, khiến giao diện
  // (nhóm theo đúng giá trị NHOM_HANG_LOAT) hiển thị lại y hệt 1 nhóm khổng lồ như cũ dù việc TÁCH nhóm
  // ở tầng thuật toán đã đúng. Chỉ cụm ĐẦU TIÊN (theo thứ tự xử lý) có mã cũ đó mới được giữ lại; cụm
  // nào tới sau thấy mã cũ đã bị nhận thì phải tự lấy mã MỚI (STT_Key nhỏ nhất trong cụm) thay vì tranh
  // nhau 1 mã.
  const maCuDaNhan = new Set();
  let soNhomTimThay = 0;
  for (const dsDonTrongNhom of theoNhom.values()) {
    if (dsDonTrongNhom.length < 2) continue; // component chỉ 1 đơn — giữ nguyên mã nhóm hiện có, xem bên dưới
    soNhomTimThay++;
    // Nếu trong component đã có sẵn ≥1 mã nhóm cũ CHƯA bị cụm nào khác trong lượt này nhận — NHẬP vào
    // mã cũ đó (nhỏ nhất nếu có nhiều mã khác nhau) thay vì tạo mã mới, để không "tách" đơn ra khỏi
    // nhóm cũ nó vẫn đang thuộc về. Hết mã cũ khả dụng (đã bị nhận hết, hoặc chưa từng có) thì tạo mã
    // mới từ STT_Key nhỏ nhất trong cụm.
    const cacMaCu = dsDonTrongNhom.map(d => d.NHOM_HANG_LOAT).filter(Boolean).filter(ma => !maCuDaNhan.has(ma)).sort((a, b) => a.localeCompare(b, 'vi'));
    const maNhom = cacMaCu[0] || dsDonTrongNhom.map(d => d.STT_Key).sort()[0];
    maCuDaNhan.add(maNhom);
    dsDonTrongNhom.forEach(d => maNhomTheoSttKey.set(d.STT_Key, maNhom));
  }

  // Mã nhóm CŨ -> TOÀN BỘ STT_Key đang mang mã đó, TRÊN CẢ SHEET (không chỉ trong lô) — bổ sung
  // 15/09/2026, theo phản hồi thực tế: "Quét lại DHL" (buocLai) tính hash MỚI đúng (đã sửa 2 lần, xem
  // docs/superpowers/specs/2026-09-1{4,5}-*.md) nhưng KHÔNG BAO GIỜ xoá được mã nhóm CŨ sai — nhánh
  // "không khớp ai trong lô -> giữ nguyên mã cũ" phía dưới (viết ra để an toàn khi lô chỉ là 1 PHẦN của
  // nhóm) vô tình làm nhóm sai từ thuật toán CŨ tồn tại VĨNH VIỄN dù thuật toán đã sửa đúng: mỗi lần
  // quét lại, đơn đúng ra phải tách nhóm lại "không khớp ai trong lô" (ĐÚNG, vì thuật toán mới nhận ra
  // nó khác hẳn) rồi bị giữ nguyên mã cũ (SAI). Chỉ AN TOÀN để XOÁ khi TOÀN BỘ thành viên nhóm cũ đó
  // đều nằm trong lô đang quét lại lần này (đã được xét lại ĐẦY ĐỦ, không phải 1 phần) — còn nếu có ai
  // ngoài lô chưa xét thì vẫn giữ nguyên như cũ, đúng tinh thần bảo vệ ban đầu.
  const thanhVienNhomCu = new Map();
  for (const don of tatCaDon) {
    if (!don.NHOM_HANG_LOAT) continue;
    if (!thanhVienNhomCu.has(don.NHOM_HANG_LOAT)) thanhVienNhomCu.set(don.NHOM_HANG_LOAT, []);
    thanhVienNhomCu.get(don.NHOM_HANG_LOAT).push(don.STT_Key);
  }

  let soDonTrongNhom = 0;
  for (const don of tatCaDon) {
    if (!sttKeySet.has(don.STT_Key)) continue; // ngoài lô đang chọn — không đọc/so/ghi
    if (!maNhomTheoSttKey.has(don.STT_Key)) {
      // Không khớp ai khác trong lô lần này VÀ có hash để so (mới thật sự được xét) — xoá mã nhóm cũ
      // NẾU đã xét lại đủ toàn bộ nhóm đó (xem giải thích thanhVienNhomCu ở trên); ngược lại (còn ai
      // ngoài lô chưa xét, hoặc đơn này chưa từng tính được hash) thì giữ nguyên mã nhóm hiện tại —
      // TUYỆT ĐỐI không đoán khi chưa đủ bằng chứng.
      if (don.NHOM_HANG_LOAT && don.HASH_ANH_MAU) {
        const thanhVien = thanhVienNhomCu.get(don.NHOM_HANG_LOAT) || [];
        if (thanhVien.every(stt => sttKeySet.has(stt))) {
          trangThaiDbService.ghiDe(don.STT_Key, { NHOM_HANG_LOAT: '' });
          continue;
        }
      }
      if (don.NHOM_HANG_LOAT) soDonTrongNhom++;
      continue;
    }
    const maNhomMoi = maNhomTheoSttKey.get(don.STT_Key);
    soDonTrongNhom++;
    if ((don.NHOM_HANG_LOAT || '') !== maNhomMoi) {
      trangThaiDbService.ghiDe(don.STT_Key, { NHOM_HANG_LOAT: maNhomMoi });
    }
  }

  return { soNhomTimThay, soDonTrongNhom };
}

router.post('/quet-hang-loat/bat-dau', async (req, res) => {
  // Chỉ quét/gộp nhóm trong phạm vi đơn đang được chọn (tick) trên trang — xem
  // docs/superpowers/specs/2026-09-06-quet-hang-loat-theo-lua-chon-design.md.
  const user = req.session.user;
  if (!laAdmin(user.vaiTro) && user.vaiTro !== 've_file') {
    return res.status(403).json({ error: 'Chỉ admin/người vẽ file mới được quét đơn hàng loạt' });
  }
  const { sttKeys, buocLai } = req.body;
  if (!Array.isArray(sttKeys) || sttKeys.length === 0 || sttKeys.some(k => typeof k !== 'string')) {
    return res.status(400).json({ error: 'Thiếu danh sách đơn đang chọn (sttKeys) — hãy chọn ít nhất 1 đơn trước khi quét.' });
  }
  const sttKeySet = new Set(sttKeys);

  donDepJobHangLoatCu();

  // Chặn chạy 2 lượt quét cùng lúc (double-click, 2 tab, 2 người cùng bấm) — job này GHI vào Sheet
  // (khác job in PDF ở routes/reports.js chỉ tạo buffer tạm), nên 2 lượt chồng nhau vừa lãng phí tải
  // lại ảnh trùng, vừa có thể ghi đè NHOM_HANG_LOAT lộn xộn nếu lượt cũ (snapshot cũ hơn) ghi SAU lượt
  // mới.
  for (const job of _congViecHangLoat.values()) {
    if (job.trangThai === 'dang_chay') {
      return res.status(409).json({ error: 'Đang có 1 lượt quét đơn hàng loạt khác đang chạy — vui lòng đợi lượt đó xong trước khi quét lại.' });
    }
  }

  // Đặt chỗ (đăng ký job) NGAY, ĐỒNG BỘ, TRƯỚC bất kỳ await nào — nếu đăng ký job sau lượt đọc Sheet
  // bên dưới (có await, nhường CPU) thì 2 request đến gần như cùng lúc vẫn có thể CÙNG lọt qua vòng
  // kiểm tra ở trên trước khi request nào kịp đăng ký, vô hiệu hoá đúng mục đích chặn ở trên. Đăng ký
  // trước, biết tongSo sau (điền vào job.tongSo khi đã đọc xong Sheet).
  const jobId = crypto.randomUUID();
  const job = {
    tongSo: 0, daXong: 0, trangThai: 'dang_chay', daHuy: false,
    loi: null, ketQua: null, capNhatLucNao: Date.now(),
  };
  _congViecHangLoat.set(jobId, job);

  // Job đã đăng ký (đồng bộ) TRƯỚC dòng await này để đóng khe hở race (xem commit trước) — nghĩa là
  // nếu chính lệnh đọc Sheet dưới đây lỗi (vd Google Sheets API tạm trục trặc), phải tự dọn job "ma"
  // vừa đăng ký, nếu không nó sẽ kẹt mãi ở 'dang_chay' và chặn MỌI lượt quét sau đó qua vòng kiểm tra
  // ở đầu route này (tới tận khi hết hạn dọn job 15 phút) dù thực ra không có job nào đang chạy thật.
  let rows;
  try {
    ({ rows } = await orderService.getAll({ fresh: true }));
  } catch (err) {
    _congViecHangLoat.delete(jobId);
    throw err;
  }
  // HASH_ANH_MAU/NHOM_HANG_LOAT giờ ở SQLite (schema tạo sẵn lúc khởi động, xem trangThaiDbService.js)
  // — LUÔN có sẵn, bỏ kiểm tra headers.includes(...) cũ (từng cần vì 2 cột này có thể chưa được thêm
  // vào Sheet).
  // Loại khỏi lô những mã KHÔNG thuộc Xưởng của người gọi (bổ sung 13/09/2026) — phòng request bị chỉnh
  // tay gửi thẳng sttKeys ngoài Xưởng (giao diện Đơn hàng đã tự lọc theo Xưởng nên bình thường không
  // xảy ra). admin không bị lọc gì.
  for (const sttKey of [...sttKeySet]) {
    const don = rows.find(r => r.STT_Key === sttKey);
    if (!don || !orderService.coQuyenTheoXuong(user, don)) sttKeySet.delete(sttKey);
  }
  if (sttKeySet.size === 0) {
    _congViecHangLoat.delete(jobId);
    return res.status(400).json({ error: 'Không còn đơn nào hợp lệ trong lô đã chọn (có thể không thuộc Xưởng của bạn).' });
  }

  // buocLai=true (nút "QUÉT LẠI ĐƠN ĐANG CHỌN", bổ sung 13/09/2026, theo yêu cầu người dùng — sau khi
  // đổi ngưỡng muốn tính lại hash cho ĐÚNG các đơn đang chọn, không chỉ đơn còn thiếu hash) — bỏ điều
  // kiện "!d.HASH_ANH_MAU", tính lại hash cho MỌI đơn có ảnh trong lô đang chọn, ghi đè hash cũ.
  // anhSoSanhCuaDon(d) — có ảnh PNG hoặc (nếu thiếu PNG) ảnh Mockup đều tính được, xem ghi chú hàm đó.
  const donThieuHash = rows.filter(d => sttKeySet.has(d.STT_Key) && anhSoSanhCuaDon(d) && (buocLai || !d.HASH_ANH_MAU));
  job.tongSo = donThieuHash.length;
  const nguong = await donHangLoatService.layNguong(); // chụp 1 lần, dùng suốt job — xem ghi chú ở tinhLaiNhomHangLoat

  res.json({ jobId, tongSo: donThieuHash.length });

  // Xử lý THẬT chạy nền sau khi đã trả response — KHÔNG await ở trên.
  (async () => {
    try {
      let soTinhDuocHash = 0;
      // Đơn KHÔNG tính được hash (bổ sung 13/09/2026, theo yêu cầu người dùng — trước đây thông báo
      // cuối chỉ đếm số lượng, không nói rõ đơn nào/vì sao) — 2 nguyên nhân phân biệt được ngay tại
      // đây, không cần sửa services/anhNguonService.js (vốn CỐ Ý nuốt lỗi chi tiết, chỉ log console,
      // dùng chung cho cả in PDF ở routes/reports.js — đổi cấu trúc trả về sẽ ảnh hưởng chỗ đó):
      //   1. taiDsAnh() trả mảng RỖNG — không tải được ảnh (link chết/hết quyền truy cập/quá thời gian).
      //   2. Có ảnh nhưng tinhHashAnh() trả null — sharp không đọc được (ảnh lỗi/định dạng lạ).
      const donLoiHash = [];
      // Xử lý theo LÔ NHỎ song song (bổ sung 22/09/2026, theo yêu cầu người dùng cải thiện hiệu năng) —
      // trước đây tuần tự HOÀN TOÀN từng đơn 1 (mỗi đơn tải ảnh + tính hash, timeout tới 15-20s nếu
      // link lỗi/chậm — xem anhNguonService.js/storageService.js/driveService.js), lô vài trăm đơn có
      // thể mất hàng chục phút. SO_SONG_SONG_TINH_HASH giới hạn số đơn tải+tính hash ĐỒNG THỜI — nhanh
      // hơn hẳn tuần tự nhưng không tạo hàng trăm request cùng lúc tới MinIO/Drive/Gemini (tránh làm
      // nghẽn nguồn ảnh ngoài, nhất là link Drive vốn đã chậm hơn MinIO nội bộ).
      const SO_SONG_SONG_TINH_HASH = 6;
      for (let i = 0; i < donThieuHash.length; i += SO_SONG_SONG_TINH_HASH) {
        if (job.daHuy) break;
        const lo = donThieuHash.slice(i, i + SO_SONG_SONG_TINH_HASH);
        await Promise.all(lo.map(async don => {
          const dsMau = await taiDsAnh(anhSoSanhCuaDon(don));
          const hash = dsMau[0] ? await tinhHashAnh(dsMau[0]) : null;
          if (hash) {
            // Ghi theo STT_Key (SQLite, xem trangThaiDbService.js) — không còn cần đọc lại Sheet để tra
            // số dòng vật lý trước khi ghi (bỏ hẳn cơ chế layLaiSoDongMoiNhat cũ, xem
            // docs/superpowers/specs/2026-09-18-chuyen-cot-app-ghi-sang-sqlite-design.md): SQLite ghi
            // đúng đơn dù Don_Hang_ALL xáo trộn dòng bất cứ lúc nào trong lúc vòng lặp này chạy (có thể
            // kéo dài nhiều phút cho lô lớn).
            trangThaiDbService.ghiDe(don.STT_Key, { HASH_ANH_MAU: hash });
            soTinhDuocHash++;
          } else {
            donLoiHash.push({
              sttKey: don.STT_Key,
              lyDo: dsMau.length === 0
                ? 'Không tải được ảnh (link lỗi, hết quyền truy cập, hoặc quá thời gian chờ)'
                : 'Tải được ảnh nhưng không tính được hash (có thể ảnh lỗi hoặc định dạng không đọc được)',
            });
          }

          // job.daXong++/donLoiHash.push/soTinhDuocHash++ AN TOÀN dù chạy trong map() song song — JS
          // đơn luồng, mỗi câu lệnh gán/++ chạy TRỌN VẸN không bị xen ngang bởi callback khác (không có
          // race condition kiểu đa luồng thật, dù nhiều Promise cùng "chạy" đan xen qua await).
          job.daXong++;
          job.capNhatLucNao = Date.now();
        }));
      }

      // Luôn tính lại nhóm SAU vòng lặp trên, kể cả khi bị hủy giữa chừng — tận dụng các hash đã tính
      // được thay vì bỏ phí, và cũng để bắt các thay đổi khác (đơn bị xoá ảnh mẫu chẳng hạn — xem
      // services/orderService.js) kể cả khi không có đơn nào mới cần tính hash ở vòng lặp trên.
      const { soNhomTimThay, soDonTrongNhom } = await tinhLaiNhomHangLoat(sttKeySet, nguong);

      job.ketQua = { soDaQuet: job.daXong, soTinhDuocHash, soNhomTimThay, soDonTrongNhom, donLoiHash };
      job.trangThai = job.daHuy ? 'huy' : 'xong';
      // Hoạt động chạy nền, không phải 1 lần bấm-1 kết quả tức thời như các hành động khác — ghi log
      // SAU KHI job xong (thành công hoặc bị dừng giữa chừng) vì lúc đó mới có đủ số liệu kết quả.
      // Không gắn sttKey đơn lẻ (thao tác trên cả lô, không phải 1 đơn).
      ghiLog({
        nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_HANG_LOAT',
        chiTiet: { soDonDaChon: sttKeySet.size, daHuy: job.daHuy, ...job.ketQua },
      }).catch(err => console.error('[Orders] Lỗi ghi log nền:', err.message));
    } catch (err) {
      console.error('[Orders] Lỗi quét đơn hàng loạt (chạy nền):', err.message);
      job.trangThai = 'loi';
      job.loi = err.message;
      ghiLog({
        nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_HANG_LOAT_LOI',
        chiTiet: { soDonDaChon: sttKeySet.size, loi: err.message },
      }).catch(err2 => console.error('[Orders] Lỗi ghi log nền:', err2.message));
    }
    job.capNhatLucNao = Date.now();
  })();
});

router.get('/quet-hang-loat/tien-do/:jobId', (req, res) => {
  const job = _congViecHangLoat.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Không tìm thấy tiến trình (có thể đã hết hạn)' });
  res.json({ tongSo: job.tongSo, daXong: job.daXong, trangThai: job.trangThai, loi: job.loi, ketQua: job.ketQua });
});

// Nút "DỪNG" ở public/orders.html gọi route này — chỉ đặt cờ 'daHuy', KHÔNG xoá job ngay (job vẫn
// đang chạy nền, cần tự đọc cờ này rồi mới dừng đúng chỗ — xem router.post('/quet-hang-loat/bat-dau')).
router.post('/quet-hang-loat/huy/:jobId', (req, res) => {
  const job = _congViecHangLoat.get(req.params.jobId);
  if (job && job.trangThai === 'dang_chay') job.daHuy = true;
  res.json({ ok: true });
});

module.exports = router;
