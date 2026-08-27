const express = require('express');
const router = express.Router();
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const orderService = require('../services/orderService');
const { layDanhSachKhachHang } = require('../services/khachHangService');
const { layLichSuChuyenSangTrangThai } = require('../services/logService');
const { readTab } = require('../services/sheetsService');
const { parseNgay, dinhDangNgay, dinhDangNgayGioVN, dinhDangNgayGioNgan } = require('../services/dateUtils');
const { taoQRCodeBuffer } = require('../services/qrService');
const { taiAnhTuLinkDrive } = require('../services/driveService');
const { DANH_SACH_TRANG_THAI_BAO_CAO } = require('../data/pipelineTinhTrang');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin); // mọi vai trò đăng nhập đều dùng được trang Báo cáo

const FONT_REGULAR = path.join(__dirname, '..', 'fonts', 'NotoSans-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'fonts', 'NotoSans-Bold.ttf');

// 3 mẫu xuất RIÊNG — cập nhật 26/08/2026: 3 nút in nhanh ở trang Đơn hàng giờ LUÔN gửi kèm đúng các
// ô lọc đang hiển thị trên trang (trạng thái, phôi, vẽ file, ngày, từ khoá) — không còn ép cứng
// trangThaiPhoi ở phía client nữa. Mỗi mẫu chỉ còn ép thêm ĐIỀU KIỆN TRẠNG THÁI RIÊNG của mình
// (AND với các ô lọc đã gửi lên — có thể ra danh sách rỗng nếu người dùng đang lọc trạng thái khác
// trên trang), áp dụng trong layDonDaLoc():
//   - 'phoi_ao_gop' (IN DANH SÁCH PHÔI): TRANG_THAI_PHOI = Chưa lấy phôi VÀ TINH_TRANG thuộc
//     {Đã xác nhận, LỖI SẢN XUẤT CẦN LÀM LẠI} (đơn lỗi làm lại cũng cần lấy lại phôi).
//   - 'don_can_in' (IN ĐƠN): không ép trạng thái nào thêm — in đúng theo mọi trạng thái đang lọc.
//   - 'tracking' (IN DANH SÁCH ĐÃ SẢN XUẤT): TINH_TRANG = Đã đóng gói.
const TRANG_THAI_TRACKING = 'Đã đóng gói';
const TRANG_THAI_PHOI_CAN_CHUAN_BI = 'Chưa lấy phôi';
const TINH_TRANG_CAN_PHOI = ['Đã xác nhận', 'LỖI SẢN XUẤT CẦN LÀM LẠI'];

function locDon(rows, { tuNgay, denNgay, khachHang, trangThai, trangThaiPhoi, trangThaiVeFile, tuKhoa }) {
  return rows.filter(r => {
    const ngay = parseNgay(r.NGAY_LEN_DON);
    if (!ngay) return false;
    if (tuNgay && ngay < parseNgay(tuNgay)) return false;
    if (denNgay && ngay > parseNgay(denNgay)) return false;
    if (khachHang && r.MA_KHACH_HANG !== khachHang) return false;
    if (trangThai && r.TINH_TRANG !== trangThai) return false;
    if (trangThaiPhoi && r.TRANG_THAI_PHOI !== trangThaiPhoi) return false;
    if (trangThaiVeFile && r.TRANG_THAI_VE_FILE !== trangThaiVeFile) return false;
    if (tuKhoa) {
      const tk = tuKhoa.toLowerCase();
      const khop = (r.MA_KHACH_HANG || '').toLowerCase().includes(tk) || (r.STT_Key || '').toLowerCase().includes(tk);
      if (!khop) return false;
    }
    return true;
  });
}

// Chọn mẫu file xuất. Ưu tiên tham số 'mau' nếu có (nút in nhanh ở trang Đơn hàng ép cứng đúng mẫu).
// Không có 'mau' thì chỉ còn suy được mẫu 'tracking' theo TINH_TRANG như cũ — 'phoi_ao_gop' và
// 'don_can_in' không còn suy tự động được nữa (xem chú thích ở khai báo hằng số phía trên).
function xacDinhMau(query) {
  const { mau, trangThai } = query;
  if (mau === 'don_can_in' || mau === 'phoi_ao_gop' || mau === 'tracking') return mau;
  if (trangThai === TRANG_THAI_TRACKING) return 'tracking';
  return 'chi_tiet';
}

async function layDonDaLoc(query) {
  const { rows } = await orderService.getAll();
  const list = locDon(rows, query);
  const mau = xacDinhMau(query);
  if (mau === 'phoi_ao_gop') {
    return list.filter(r => r.TRANG_THAI_PHOI === TRANG_THAI_PHOI_CAN_CHUAN_BI && TINH_TRANG_CAN_PHOI.includes(r.TINH_TRANG));
  }
  if (mau === 'tracking') {
    return list.filter(r => r.TINH_TRANG === TRANG_THAI_TRACKING);
  }
  return list;
}

function dongThongTinLoc(query, kieu) {
  const { tuNgay, denNgay, khachHang, trangThai, tuKhoa } = query;
  const khHienThi = khachHang || 'Tất cả khách hàng';
  const ttHienThi = trangThai || 'Tất cả trạng thái';
  const dongTuKhoa = tuKhoa ? ` · Từ khoá tìm kiếm: ${tuKhoa}` : '';
  if (kieu === 'tracking') {
    return `Khoảng thời gian: ${tuNgay || '(không giới hạn)'} ${denNgay || '(không giới hạn)'} · Khách hàng: ${khHienThi} · Trạng thái: ${ttHienThi}${dongTuKhoa}`;
  }
  return `Khoảng thời gian: Từ ngày ${tuNgay || '(không giới hạn)'} đến ngày ${denNgay || '(không giới hạn)'} · Khách hàng: ${khHienThi} · Trạng thái: ${ttHienThi}${dongTuKhoa}`;
}

function dongNguoiXuatChuoi(tenNguoiXuat) {
  return `Người thực hiện trích xuất thông tin: ${tenNguoiXuat} · Thời gian trích xuất thông tin: ${dinhDangNgayGioVN()}`;
}

// Hậu tố ngày cho tên file tải về — ưu tiên dùng ngày đang lọc, không thì dùng ngày thực xuất file.
function ngayChoTenFile(query) {
  const ddmmyyyy = (d) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  const tu = parseNgay(query.tuNgay);
  const den = parseNgay(query.denNgay);
  if (tu && den && tu.getTime() !== den.getTime()) return `${ddmmyyyy(tu)}_den_${ddmmyyyy(den)}`;
  if (tu) return ddmmyyyy(tu);
  return ddmmyyyy(new Date());
}

router.get('/khach-hang', async (req, res) => {
  const list = await layDanhSachKhachHang();
  res.json(list);
});

router.get('/trang-thai-theo-loc', async (req, res) => {
  const { tuNgay, denNgay, khachHang } = req.query;
  const { rows } = await orderService.getAll();
  const list = locDon(rows, { tuNgay, denNgay, khachHang });

  const dem = {};
  list.forEach(r => {
    const t = r.TINH_TRANG || '(Trống)';
    dem[t] = (dem[t] || 0) + 1;
  });

  const ketQua = DANH_SACH_TRANG_THAI_BAO_CAO.map(trangThai => ({ trangThai, soDon: dem[trangThai] || 0 }));

  res.json({ tongSoDon: list.length, trangThai: ketQua });
});

// Tên trạng thái lỗi HIỆN TẠI, cộng thêm tên CŨ trước khi đổi pipeline (xem data/pipelineTinhTrang.js
// — script migrate không sửa lại lịch sử cũ, nên vẫn cần so khớp cả 2 tên mới không bỏ sót lỗi cũ).
// Tên trạng thái lỗi qua 3 thế hệ đặt tên (cũ nhất trước, mới nhất sau) — script migrate không sửa
// lại lịch sử cũ nên vẫn cần so khớp đủ cả 3 mới không bỏ sót lỗi xảy ra ở các bản pipeline trước.
const TRANG_THAI_LOI = ['ĐƠN LỖI CẦN LÀM LẠI', 'B4.3_ĐƠN LỖI CẦN LÀM LẠI', 'LỖI SẢN XUẤT CẦN LÀM LẠI'];

// Tên trạng thái "Đã sản xuất" hiện tại + tên cũ (xem data/pipelineTinhTrang.js), dùng để tra
// "người sản xuất" từ lịch sử — dùng chung cho cả bảng lỗi sản xuất và bảng hoàn đơn.
const TINH_TRANG_SAN_XUAT = ['Đã sản xuất', 'B4.1_Đơn đã sản xuất', 'B5.2_Đơn chưa đóng gói'];
const KHONG_XAC_DINH_NGUOI_SAN_XUAT = 'Không xác định do đã sửa trên GGSheet không qua app';

// "Người sản xuất": đơn hàng không lưu trực tiếp trường này — tra LỊCH SỬ (LichSuHoatDong) tìm lần
// GẦN NHẤT đơn được chuyển sang "Đã sản xuất" TÍNH ĐẾN HIỆN TẠI (không phân biệt theo từng lần lỗi
// nếu đơn lỗi rồi sản xuất lại nhiều lần — lấy đơn giản 1 lần gần nhất chung cho mọi mục đích hiển
// thị). Không tìm được (log bị xoá, hoặc sửa trực tiếp trên Sheet không qua app) thì trả về null —
// nơi gọi tự thay bằng KHONG_XAC_DINH_NGUOI_SAN_XUAT.
async function layNguoiSanXuatTheoDon() {
  const lanSanXuat = await layLichSuChuyenSangTrangThai(TINH_TRANG_SAN_XUAT);
  const ketQua = {};
  for (const l of lanSanXuat) {
    const hienTai = ketQua[l.sttKey];
    if (!hienTai || new Date(l.thoiGian) > new Date(hienTai.thoiGian)) ketQua[l.sttKey] = l;
  }
  return ketQua;
}

// Số tuần trong năm theo lịch — dùng thống nhất với cách tính "theo tuần" đã có ở Dashboard
function soTuanTrongNam(d) {
  const dauNam = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - dauNam) / 86400000 + dauNam.getDay() + 1) / 7);
}

// Thống kê tỷ lệ lỗi sản xuất (LỖI SẢN XUẤT CẦN LÀM LẠI) theo loại sản phẩm / team sản xuất / tuần.
// LƯU Ý QUAN TRỌNG: đây là trạng thái THOÁNG QUA — đơn lỗi được set tay làm lại từ phôi/file, nên
// sau 1 thời gian sẽ không còn ở trạng thái này nữa. KHÔNG thể đếm bằng cách lọc TINH_TRANG hiện tại
// (hầu hết đơn từng lỗi trong quá khứ giờ đã không còn ở trạng thái lỗi nữa). Phải tính từ LỊCH SỬ
// (mỗi lần có đơn được CHUYỂN SANG trạng thái lỗi tính là 1 lần lỗi, dù sau đó đã được làm lại hay chưa).
// Đơn hàng không lưu "team sản xuất" trực tiếp — suy ra team bằng cách tra NGƯỜI đã bấm chuyển đơn
// sang trạng thái lỗi (lấy từ lịch sử) rồi tra Team của người đó trong tab NguoiDung. Nếu không tìm
// được (vd log bị xoá, hoặc trạng thái bị đổi trực tiếp trên Sheet không qua app) thì xếp vào "Không xác định".
// "Người sản xuất" (khác với "Người chuyển" — người bấm chuyển đơn SANG trạng thái lỗi): người đã
// thực hiện lần "Đã sản xuất" gần nhất của đơn đó — cho biết vấn đề chất lượng là ở khâu sản xuất nào.
router.get('/thong-ke-loi', async (req, res) => {
  const { tuNgay, denNgay } = req.query;

  const lanLoi = await layLichSuChuyenSangTrangThai(TRANG_THAI_LOI);
  const locTheoNgay = lanLoi.filter(l => {
    const d = new Date(l.thoiGian);
    if (isNaN(d)) return false;
    if (tuNgay && d < new Date(tuNgay + 'T00:00:00')) return false;
    if (denNgay && d > new Date(denNgay + 'T23:59:59')) return false;
    return true;
  });

  const { rows: donHang } = await orderService.getAll();
  const banDoDon = {};
  donHang.forEach(r => { banDoDon[r.STT_Key] = r; });

  const { rows: nhanVien } = await readTab('NguoiDung');
  const banDoTeam = {};
  nhanVien.forEach(nv => { banDoTeam[nv.Ten] = nv.Team || 'Không rõ team'; });

  const nguoiSanXuatTheoDon = await layNguoiSanXuatTheoDon();

  const theoLoai = {}, theoTeam = {}, theoTuan = {};
  const chiTiet = [];
  const locTheoNgaySapXep = [...locTheoNgay].sort((a, b) => (a.thoiGian < b.thoiGian ? 1 : -1)); // sắp theo chuỗi ISO gốc — mới nhất trước
  for (const l of locTheoNgaySapXep) {
    const don = banDoDon[l.sttKey];
    const loai = (don && don.LOAI) || '(Không rõ loại)';
    const team = banDoTeam[l.nguoiDung] || 'Không xác định';
    const d = new Date(l.thoiGian);
    const nhanTuan = `${d.getFullYear()}-T${String(soTuanTrongNam(d)).padStart(2, '0')}`;

    theoLoai[loai] = (theoLoai[loai] || 0) + 1;
    theoTeam[team] = (theoTeam[team] || 0) + 1;
    theoTuan[nhanTuan] = (theoTuan[nhanTuan] || 0) + 1;

    chiTiet.push({
      sttKey: l.sttKey, loai, team, nguoiDung: l.nguoiDung || '(Không rõ)',
      thoiGian: dinhDangNgayGioNgan(d), khachHang: don ? (don.MA_KHACH_HANG || '') : '',
      nguoiSanXuat: (nguoiSanXuatTheoDon[l.sttKey] && nguoiSanXuatTheoDon[l.sttKey].nguoiDung) || KHONG_XAC_DINH_NGUOI_SAN_XUAT,
    });
  }

  res.json({
    tongSoLoi: locTheoNgay.length,
    theoLoai, theoTeam, theoTuan,
    chiTiet: chiTiet.slice(0, 200),
  });
});

// Thống kê đơn HOÀN (REFUNDED_Hoàn đơn) — danh sách từ trạng thái HIỆN TẠI (khác với lỗi sản xuất:
// REFUNDED là trạng thái CUỐI CÙNG, đơn giữ nguyên ở đó mãi nên không cần tra lịch sử). Tổng hợp
// theo khách hàng/loại sản phẩm/tuần, kèm GHI_CHU của từng đơn để xem nguyên nhân hoàn.
router.get('/thong-ke-hoan-don', async (req, res) => {
  const { tuNgay, denNgay } = req.query;
  const { rows } = await orderService.getAll();
  const dsDonHoan = await orderService.ganTenKhachHang(
    rows.filter(r => r.TINH_TRANG === 'REFUNDED_Hoàn đơn')
  );

  const locTheoNgay = dsDonHoan.filter(r => {
    const ngay = parseNgay(r.NGAY_LEN_DON);
    if (!ngay) return false;
    if (tuNgay && ngay < parseNgay(tuNgay)) return false;
    if (denNgay && ngay > parseNgay(denNgay)) return false;
    return true;
  });

  const nguoiSanXuatTheoDon = await layNguoiSanXuatTheoDon();

  const theoKhachHang = {}, theoLoai = {}, theoTuan = {};
  const chiTiet = [];

  for (const don of [...locTheoNgay].sort((a, b) => {
    const da = parseNgay(a.NGAY_LEN_DON), db = parseNgay(b.NGAY_LEN_DON);
    return (db || 0) - (da || 0); // mới nhất trước
  })) {
    const kh = don.TenKhachHang || don.MA_KHACH_HANG || '(Không rõ)';
    const loai = don.LOAI || '(Không rõ loại)';
    const ngay = parseNgay(don.NGAY_LEN_DON);
    const nhanTuan = ngay ? `${ngay.getFullYear()}-T${String(soTuanTrongNam(ngay)).padStart(2, '0')}` : '(Không rõ)';

    theoKhachHang[kh] = (theoKhachHang[kh] || 0) + 1;
    theoLoai[loai] = (theoLoai[loai] || 0) + 1;
    theoTuan[nhanTuan] = (theoTuan[nhanTuan] || 0) + 1;

    chiTiet.push({
      sttKey: don.STT_Key,
      khachHang: kh,
      loai,
      kichThuoc: don.KICH_THUOC || '',
      mauSac: don.MAU_SAC || '',
      ngayLenDon: dinhDangNgay(don.NGAY_LEN_DON),
      ghiChu: don.GHI_CHU || '(Không có ghi chú)',
      nguoiSanXuat: (nguoiSanXuatTheoDon[don.STT_Key] && nguoiSanXuatTheoDon[don.STT_Key].nguoiDung) || KHONG_XAC_DINH_NGUOI_SAN_XUAT,
    });
  }

  res.json({ tongSoHoan: locTheoNgay.length, theoKhachHang, theoLoai, theoTuan, chiTiet });
});

// ============================================================
// MẪU "ĐƠN CẦN IN" (TRANG_THAI_PHOI = 'Đã lấy phôi') — mỗi đơn 1 thẻ có QR + 2 ảnh thật, khổ giấy 100x150mm
// (bằng khổ tem in phổ biến), 2 đơn/trang để đỡ tốn giấy khi in.
// ============================================================
const MM_TO_PT = 2.834645669;
function mmToPt(mm) { return mm * MM_TO_PT; }
const KHO_GIAY_MM = { rong: 100, cao: 150 };

function nhanDangDinhDangAnh(buffer) {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpeg';
  return null;
}

async function taiAnhChoDon(don) {
  const [qr, mauRaw, mockupRaw] = await Promise.all([
    taoQRCodeBuffer(don.STT_Key || '', 300),
    taiAnhTuLinkDrive(don.DUONG_DAN_URL),
    taiAnhTuLinkDrive(don.MOCKUP),
  ]);
  const dinhDangMau = nhanDangDinhDangAnh(mauRaw);
  const dinhDangMockup = nhanDangDinhDangAnh(mockupRaw);
  return {
    qr,
    mau: dinhDangMau ? mauRaw : null,
    mockup: dinhDangMockup ? mockupRaw : null,
    mauDinhDang: dinhDangMau,
    mockupDinhDang: dinhDangMockup,
  };
}

function veOTrongPdf(doc, x, y, kichThuoc, chuThich) {
  doc.rect(x, y, kichThuoc, kichThuoc).stroke('#d1d5db');
  doc.font('NotoSans').fontSize(5).fillColor('#9ca3af')
    .text(chuThich, x + 2, y + kichThuoc / 2 - 6, { width: kichThuoc - 4, align: 'center' });
  doc.fillColor('#000000');
}

function veTheDonPdf(doc, don, anh, offsetY, caoThe) {
  const rong = mmToPt(KHO_GIAY_MM.rong);
  const leTrong = 5;
  const x0 = leTrong;
  const rongTrong = rong - leTrong * 2;
  let y = offsetY + leTrong;

  // Dòng tiêu đề — cỡ chữ lớn hơn để dễ nhìn khi dán lên áo
  doc.font('NotoSans-Bold').fontSize(13).text(don.STT_Key || '', x0, y, { width: rongTrong });
  y += 18;
  doc.font('NotoSans').fontSize(10).text(`${don.LOAI || ''} · ${don.KICH_THUOC || ''} · ${don.MAU_SAC || ''}`, x0, y, { width: rongTrong });
  y += 14;

  // KHỐI ẢNH (ưu tiên): 2 ảnh to xếp cạnh nhau, chiếm hết chiều ngang thẻ — to gấp đôi bố cục cũ
  const khoangCachAnh = 4;
  const anhKichThuoc = (rongTrong - khoangCachAnh) / 2; // mỗi ảnh ~65mm — to gần gấp đôi khổ thẻ, hết chiều rộng
  const anhY = y;
  // Ảnh mẫu (bên trái)
  if (anh.mau) {
    try { doc.image(anh.mau, x0, anhY, { fit: [anhKichThuoc, anhKichThuoc] }); }
    catch (e) { veOTrongPdf(doc, x0, anhY, anhKichThuoc, 'Không tải được ảnh mẫu'); }
  } else {
    veOTrongPdf(doc, x0, anhY, anhKichThuoc, 'Không có ảnh mẫu');
  }
  // Ảnh mockup (bên phải)
  const anhX2 = x0 + anhKichThuoc + khoangCachAnh;
  if (anh.mockup) {
    try { doc.image(anh.mockup, anhX2, anhY, { fit: [anhKichThuoc, anhKichThuoc] }); }
    catch (e) { veOTrongPdf(doc, anhX2, anhY, anhKichThuoc, 'Không tải được ảnh mockup'); }
  } else {
    veOTrongPdf(doc, anhX2, anhY, anhKichThuoc, 'Không có ảnh mockup');
  }
  y = anhY + anhKichThuoc + 6;

  // KHỐI DƯỚI: QR nhỏ (24mm, vẫn đủ quét bằng điện thoại/máy QR) + thông tin bên phải
  const qrKichThuoc = mmToPt(26); // 26mm — đủ quét bằng điện thoại/máy QR
  const qrY = y;
  if (anh.qr) doc.image(anh.qr, x0, qrY, { width: qrKichThuoc, height: qrKichThuoc });
  else veOTrongPdf(doc, x0, qrY, qrKichThuoc, 'Không có QR');

  const infoX = x0 + qrKichThuoc + 5;
  const infoRong = rongTrong - qrKichThuoc - 5;
  let yInfo = qrY;
  const viTri = [don.VI_TRI_1, don.VI_TRI_2, don.VI_TRI_3].filter(Boolean).join(' · ');
  doc.font('NotoSans-Bold').fontSize(9).text('Vị trí thêu: ', infoX, yInfo, { continued: true, width: infoRong });
  doc.font('NotoSans').text(viTri || '—');
  yInfo += 13;
  doc.font('NotoSans').fontSize(9).text(`SL: ${don.SO_LUONG ?? ''} · Áo/đơn: ${don.SO_LUONG_AO_TREN_DON ?? ''}`, infoX, yInfo, { width: infoRong });
  yInfo += 13;
  doc.font('NotoSans').fontSize(9).text(`Ngày: ${dinhDangNgay(don.NGAY_LEN_DON)}`, infoX, yInfo, { width: infoRong });
  if (don.GHI_CHU) {
    yInfo += 13;
    doc.font('NotoSans-Bold').fontSize(9).text('Ghi chú: ', infoX, yInfo, { continued: true, width: infoRong });
    doc.font('NotoSans').text(String(don.GHI_CHU), { width: infoRong });
  }
}

async function veTrangDonCanInPdf(doc, list, dongNguoiXuat) {
  const rong = mmToPt(KHO_GIAY_MM.rong);
  const cao = mmToPt(KHO_GIAY_MM.cao);
  const caoFooter = 9;
  // 1 đơn 1 trang — ảnh to hơn hẳn, dễ đối chiếu khi dán lên áo (trước đây 2 đơn/trang, ảnh nhỏ)
  const caoThe = cao - caoFooter;

  for (let i = 0; i < list.length; i++) {
    if (i > 0) doc.addPage({ size: [rong, cao], margin: 0 });

    const anh = await taiAnhChoDon(list[i]);
    veTheDonPdf(doc, list[i], anh, 0, caoThe);

    doc.font('NotoSans').fontSize(5).fillColor('#9ca3af')
      .text(dongNguoiXuat, 4, cao - caoFooter + 1, { width: rong - 8, align: 'center' });
    doc.fillColor('#000000');
  }
}

async function veSheetDonCanInExcel(wb, list, dongThongTin, dongNguoiXuat) {
  const sheet = wb.addWorksheet('DonCanIn');
  [16, 16, 16, 16, 16, 16].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  sheet.mergeCells(1, 1, 1, 6);
  sheet.getCell(1, 1).value = 'PHIẾU THÔNG TIN ĐƠN CẦN IN';
  sheet.getCell(1, 1).font = { bold: true, size: 13 };

  sheet.mergeCells(2, 1, 2, 6);
  sheet.getCell(2, 1).value = dongThongTin;
  sheet.getCell(2, 1).font = { italic: true, size: 10, color: { argb: 'FF52525B' } };

  sheet.mergeCells(3, 1, 3, 6);
  sheet.getCell(3, 1).value = dongNguoiXuat;
  sheet.getCell(3, 1).font = { italic: true, size: 9, color: { argb: 'FF9CA3AF' } };

  let hang = 5;

  if (list.length === 0) {
    sheet.getCell(hang, 1).value = 'Không có đơn nào khớp bộ lọc.';
    return;
  }

  for (const don of list) {
    const anh = await taiAnhChoDon(don);

    sheet.mergeCells(hang, 1, hang, 6);
    sheet.getCell(hang, 1).value = `Mã đơn: ${don.STT_Key || ''}`;
    sheet.getCell(hang, 1).font = { bold: true, size: 12 };
    hang += 1;

    sheet.mergeCells(hang, 1, hang, 6);
    sheet.getCell(hang, 1).value = `${don.LOAI || ''} · ${don.KICH_THUOC || ''} · ${don.MAU_SAC || ''} · Ngày lên đơn: ${dinhDangNgay(don.NGAY_LEN_DON)}`;
    hang += 1;

    const hangAnh = hang;
    for (let i = 0; i < 7; i++) sheet.getRow(hang + i).height = 16;

    if (anh.qr) {
      const id = wb.addImage({ buffer: anh.qr, extension: 'png' });
      sheet.addImage(id, { tl: { col: 0, row: hangAnh - 1 }, ext: { width: 110, height: 110 } });
    }
    if (anh.mau) {
      const id = wb.addImage({ buffer: anh.mau, extension: anh.mauDinhDang });
      sheet.addImage(id, { tl: { col: 2, row: hangAnh - 1 }, ext: { width: 110, height: 110 } });
    } else {
      sheet.getCell(hangAnh, 3).value = 'Không tải được ảnh mẫu';
    }
    if (anh.mockup) {
      const id = wb.addImage({ buffer: anh.mockup, extension: anh.mockupDinhDang });
      sheet.addImage(id, { tl: { col: 4, row: hangAnh - 1 }, ext: { width: 110, height: 110 } });
    } else {
      sheet.getCell(hangAnh, 5).value = 'Không tải được ảnh mockup';
    }
    hang += 7;

    const viTri = [don.VI_TRI_1, don.VI_TRI_2, don.VI_TRI_3].filter(Boolean).join(' · ');
    sheet.mergeCells(hang, 1, hang, 6);
    sheet.getCell(hang, 1).value = `Vị trí thêu: ${viTri || '—'}`;
    hang += 1;

    sheet.mergeCells(hang, 1, hang, 6);
    sheet.getCell(hang, 1).value = `Số lượng: ${don.SO_LUONG ?? ''} · SL áo/đơn: ${don.SO_LUONG_AO_TREN_DON ?? ''}`;
    hang += 1;

    if (don.GHI_CHU) {
      sheet.mergeCells(hang, 1, hang, 6);
      sheet.getCell(hang, 1).value = `Ghi chú: ${don.GHI_CHU}`;
      hang += 1;
    }

    hang += 2;
  }
}

const COT_PHOI_AO_CHI_TIET = [
  { header: 'STT_Key', key: 'STT_Key', width: 14 },
  { header: 'MA_CODE_STT', key: 'MA_CODE_STT', width: 14 },
  { header: 'TINH_TRANG', key: 'TINH_TRANG', width: 24 },
  { header: 'NGAY_LEN_DON', key: 'NGAY_LEN_DON', width: 14, laNgay: true },
  { header: 'LOAI', key: 'LOAI', width: 12 },
  { header: 'KICH_THUOC', key: 'KICH_THUOC', width: 12 },
  { header: 'MAU_SAC', key: 'MAU_SAC', width: 18 },
];

const COT_PHOI_AO_GOP = [
  { header: 'NGAY_LEN_DON', key: 'NGAY_LEN_DON', width: 14, laNgay: true },
  { header: 'LOAI', key: 'LOAI', width: 12 },
  { header: 'KICH_THUOC', key: 'KICH_THUOC', width: 12 },
  { header: 'MAU_SAC', key: 'MAU_SAC', width: 18 },
  { header: 'SO_LUONG', key: 'SO_LUONG', width: 10 },
];

const COT_TRACKING = [
  { header: 'STT_Key', key: 'STT_Key', width: 14 },
  { header: 'MA_CODE_STT', key: 'MA_CODE_STT', width: 14 },
  { header: 'MA_KHACH_HANG', key: 'MA_KHACH_HANG', width: 16 },
  { header: 'MA_VAN_DON_ID', key: 'MA_VAN_DON_ID', width: 18 },
  { header: 'QUOC_GIA', key: 'QUOC_GIA', width: 12 },
  { header: 'LOAI', key: 'LOAI', width: 12 },
  { header: 'SO_LUONG', key: 'SO_LUONG', width: 10 },
];

function gomNhomPhoiAo(list) {
  const nhom = new Map();
  list.forEach(r => {
    const ngay = parseNgay(r.NGAY_LEN_DON);
    const khoaNgay = ngay ? `${ngay.getFullYear()}-${ngay.getMonth()}-${ngay.getDate()}` : '';
    const khoa = [khoaNgay, r.LOAI || '', r.KICH_THUOC || '', r.MAU_SAC || ''].join('|');
    if (!nhom.has(khoa)) {
      nhom.set(khoa, { NGAY_LEN_DON: r.NGAY_LEN_DON, LOAI: r.LOAI, KICH_THUOC: r.KICH_THUOC, MAU_SAC: r.MAU_SAC, SO_LUONG: 0 });
    }
    nhom.get(khoa).SO_LUONG += Number(r.SO_LUONG) || 0;
  });
  return Array.from(nhom.values()).sort((a, b) => b.SO_LUONG - a.SO_LUONG);
}

function xayDungBaoCaoDangBang(list, query, tenNguoiXuat) {
  const dongNguoiXuat = dongNguoiXuatChuoi(tenNguoiXuat);
  const mau = xacDinhMau(query);

  if (mau === 'tracking') {
    return {
      tenFileGoc: 'ThongTinChoTracking',
      bang: [{
        tenSheet: 'ThongTinChoTracking',
        tieuDe: 'TỔNG HỢP THÔNG TIN ĐƠN HÀNG CHO TRACKING',
        dongThongTin: dongThongTinLoc(query, 'tracking'),
        dongNguoiXuat,
        cot: COT_TRACKING,
        rows: list,
      }],
    };
  }

  if (mau === 'phoi_ao_gop') {
    return {
      tenFileGoc: 'DSPhoiAoTongHop',
      bang: [{
        tenSheet: 'DSPhoiAoTongHop',
        tieuDe: 'TỔNG HỢP DANH SÁCH PHÔI ÁO CẦN CHUẨN BỊ',
        dongThongTin: dongThongTinLoc(query, 'phoi_ao'),
        dongNguoiXuat,
        cot: COT_PHOI_AO_GOP,
        rows: gomNhomPhoiAo(list),
      }],
    };
  }

  return {
    tenFileGoc: 'DSPhoiAoTongHop',
    bang: [{
      tenSheet: 'DSPhoiAoTongHop',
      tieuDe: 'TỔNG HỢP DANH SÁCH PHÔI ÁO CẦN CHUẨN BỊ',
      dongThongTin: dongThongTinLoc(query, 'phoi_ao'),
      dongNguoiXuat,
      cot: COT_PHOI_AO_CHI_TIET,
      rows: list,
    }],
  };
}

router.get('/xem-truoc', async (req, res) => {
  const list = await layDonDaLoc(req.query);

  if (xacDinhMau(req.query) === 'don_can_in') {
    const dongNguoiXuat = dongNguoiXuatChuoi(req.session.user.ten);
    const the = [];
    for (const don of list) {
      const anh = await taiAnhChoDon(don);
      the.push({
        sttKey: don.STT_Key,
        dongTom: `${don.LOAI || ''} · ${don.KICH_THUOC || ''} · ${don.MAU_SAC || ''}`,
        viTri: [don.VI_TRI_1, don.VI_TRI_2, don.VI_TRI_3].filter(Boolean).join(' · '),
        soLuong: don.SO_LUONG,
        soLuongAoTrenDon: don.SO_LUONG_AO_TREN_DON,
        ngayLenDon: dinhDangNgay(don.NGAY_LEN_DON),
        ghiChu: don.GHI_CHU || '',
        qr: anh.qr ? `data:image/png;base64,${anh.qr.toString('base64')}` : null,
        mau: anh.mau ? `data:image/${anh.mauDinhDang};base64,${anh.mau.toString('base64')}` : null,
        mockup: anh.mockup ? `data:image/${anh.mockupDinhDang};base64,${anh.mockup.toString('base64')}` : null,
      });
    }
    return res.json({ kieu: 'don_can_in', dongThongTin: dongThongTinLoc(req.query, 'phoi_ao'), dongNguoiXuat, the });
  }

  const baoCao = xayDungBaoCaoDangBang(list, req.query, req.session.user.ten);
  const ketQua = baoCao.bang.map(b => ({
    tieuDe: b.tieuDe,
    dongThongTin: b.dongThongTin,
    dongNguoiXuat: b.dongNguoiXuat,
    cot: b.cot.map(c => c.header),
    rows: b.rows.map(r => b.cot.map(c => (c.laNgay ? dinhDangNgay(r[c.key]) : (r[c.key] ?? '')))),
  }));
  res.json({ kieu: 'bang', tenFileGoc: baoCao.tenFileGoc, bang: ketQua });
});

function veSheetExcel(wb, bang) {
  const { tenSheet, tieuDe, dongThongTin, dongNguoiXuat, cot, rows } = bang;
  const sheet = wb.addWorksheet(tenSheet);
  cot.forEach((c, i) => { sheet.getColumn(i + 1).width = c.width; });

  sheet.mergeCells(1, 1, 1, cot.length);
  sheet.getCell(1, 1).value = tieuDe;
  sheet.getCell(1, 1).font = { bold: true, size: 13 };

  sheet.mergeCells(2, 1, 2, cot.length);
  sheet.getCell(2, 1).value = dongThongTin;
  sheet.getCell(2, 1).font = { italic: true, size: 10, color: { argb: 'FF52525B' } };

  sheet.mergeCells(3, 1, 3, cot.length);
  sheet.getCell(3, 1).value = dongNguoiXuat;
  sheet.getCell(3, 1).font = { italic: true, size: 9, color: { argb: 'FF9CA3AF' } };

  sheet.addRow([]);

  const dongHeader = sheet.addRow(cot.map(c => c.header));
  dongHeader.font = { bold: true };
  dongHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

  rows.forEach(r => {
    const dong = sheet.addRow(cot.map(c => (c.laNgay ? parseNgay(r[c.key]) : (r[c.key] ?? ''))));
    cot.forEach((c, i) => { if (c.laNgay) dong.getCell(i + 1).numFmt = 'dd/mm/yyyy'; });
  });

  sheet.addRow([]);
  const dongTong = sheet.addRow([`Tổng số dòng: ${rows.length}`]);
  dongTong.font = { bold: true };
}

router.get('/excel', async (req, res) => {
  const list = await layDonDaLoc(req.query);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  const wb = new ExcelJS.Workbook();

  if (xacDinhMau(req.query) === 'don_can_in') {
    await veSheetDonCanInExcel(wb, list, dongThongTinLoc(req.query, 'phoi_ao'), dongNguoiXuatChuoi(req.session.user.ten));
    res.setHeader('Content-Disposition', `attachment; filename="DonCanIn_${ngayChoTenFile(req.query)}.xlsx"`);
  } else {
    const baoCao = xayDungBaoCaoDangBang(list, req.query, req.session.user.ten);
    baoCao.bang.forEach(b => veSheetExcel(wb, b));
    res.setHeader('Content-Disposition', `attachment; filename="${baoCao.tenFileGoc}_${ngayChoTenFile(req.query)}.xlsx"`);
  }

  await wb.xlsx.write(res);
  res.end();
});

function veBangPdf(doc, bang, canTrangMoi) {
  const { tieuDe, dongThongTin, dongNguoiXuat, cot, rows } = bang;
  if (canTrangMoi) doc.addPage();

  doc.font('NotoSans-Bold').fontSize(15).text(tieuDe, { align: 'center' });
  doc.moveDown(0.3);
  doc.font('NotoSans').fontSize(9.5).text(dongThongTin, { align: 'center' });
  doc.moveDown(0.15);
  doc.font('NotoSans').fontSize(8).fillColor('#6b7280').text(dongNguoiXuat, { align: 'center' });
  doc.fillColor('#000000');
  doc.moveDown(1);

  const startX = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = usableWidth / cot.length;
  let y = doc.y;
  const caoHang = 16;

  function veDuongKeNgang(yHang) {
    doc.moveTo(startX, yHang + caoHang - 4).lineTo(startX + usableWidth, yHang + caoHang - 4)
      .lineWidth(0.5).strokeColor('#e5e7eb').stroke();
    doc.strokeColor('#000000');
  }

  function veHang(values, dam) {
    doc.font(dam ? 'NotoSans-Bold' : 'NotoSans').fontSize(9);
    values.forEach((v, i) => {
      doc.text(String(v ?? ''), startX + i * colWidth, y, { width: colWidth - 4, ellipsis: true });
    });
    veDuongKeNgang(y);
    y += caoHang;
    if (y > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      y = doc.page.margins.top;
    }
  }

  veHang(cot.map(c => c.header), true);
  rows.forEach(r => veHang(cot.map(c => (c.laNgay ? dinhDangNgay(r[c.key]) : r[c.key]))));

  y += 10;
  if (y > doc.page.height - doc.page.margins.bottom - 20) { doc.addPage(); y = doc.page.margins.top; }
  doc.font('NotoSans-Bold').fontSize(10).text(`Tổng số dòng: ${rows.length}`, startX, y);
}

router.get('/pdf', async (req, res) => {
  const list = await layDonDaLoc(req.query);

  res.setHeader('Content-Type', 'application/pdf');

  if (xacDinhMau(req.query) === 'don_can_in') {
    res.setHeader('Content-Disposition', `attachment; filename="DonCanIn_${ngayChoTenFile(req.query)}.pdf"`);

    const rong = mmToPt(KHO_GIAY_MM.rong);
    const cao = mmToPt(KHO_GIAY_MM.cao);
    const doc = new PDFDocument({ size: [rong, cao], margin: 0 });
    doc.registerFont('NotoSans', FONT_REGULAR);
    doc.registerFont('NotoSans-Bold', FONT_BOLD);
    doc.pipe(res);

    if (list.length === 0) {
      doc.font('NotoSans').fontSize(9).text('Không có đơn nào khớp bộ lọc.', 10, 10);
    } else {
      await veTrangDonCanInPdf(doc, list, dongNguoiXuatChuoi(req.session.user.ten));
    }
    doc.end();
    return;
  }

  const baoCao = xayDungBaoCaoDangBang(list, req.query, req.session.user.ten);
  res.setHeader('Content-Disposition', `attachment; filename="${baoCao.tenFileGoc}_${ngayChoTenFile(req.query)}.pdf"`);

  const doc = new PDFDocument({ margin: 24, size: 'A4', layout: 'landscape' });
  doc.registerFont('NotoSans', FONT_REGULAR);
  doc.registerFont('NotoSans-Bold', FONT_BOLD);
  doc.pipe(res);

  baoCao.bang.forEach((b, i) => veBangPdf(doc, b, i > 0));

  doc.end();
});

module.exports = router;
