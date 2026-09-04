const express = require('express');
const router = express.Router();
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const orderService = require('../services/orderService');
const { layDanhSachKhachHang, layBanDoTenKhachHang } = require('../services/khachHangService');
const { layLichSuChuyenSangTrangThai } = require('../services/logService');
const { readTabCached } = require('../services/sheetsService');
const { parseNgay, dinhDangNgay, dinhDangNgayGioVN, dinhDangNgayGioNgan } = require('../services/dateUtils');
const { taoQRCodeBuffer } = require('../services/qrService');
const { taiAnhTuLinkDrive, layFileIdTuLinkDrive, layDsAnhTrongThuMucDrive } = require('../services/driveService');
const { laLinkChiaSeGemini, taiAnhTuTrangGemini } = require('../services/trangWebService');
const storageService = require('../services/storageService');
const { DANH_SACH_TRANG_THAI_BAO_CAO, GIA_TRI_LOC_TRONG, khopGiaTriLoc } = require('../data/pipelineTinhTrang');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin); // mọi vai trò đăng nhập đều dùng được trang Báo cáo

const FONT_REGULAR = path.join(__dirname, '..', 'fonts', 'NotoSans-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'fonts', 'NotoSans-Bold.ttf');

// 3 mẫu xuất RIÊNG — 3 nút in nhanh ở trang Đơn hàng LUÔN gửi kèm đúng các ô lọc đang hiển thị trên
// trang (trạng thái, phôi, vẽ file, ngày, từ khoá...). Cả 3 mẫu ('phoi_ao_gop', 'don_can_in',
// 'tracking') giờ dùng CHUNG ĐÚNG 1 cách lọc — layDonDaLoc() chỉ còn gọi locDon(rows, query), không
// còn ép thêm điều kiện riêng nào cho từng mẫu nữa (CẬP NHẬT 04/09/2026, theo yêu cầu người dùng —
// trước đó 'phoi_ao_gop'/'tracking' có mặc định riêng khi không lọc gì, nhưng người dùng muốn LUÔN
// in đúng 100% theo bộ lọc đang hiển thị, kể cả khi không lọc gì thì in TOÀN BỘ đơn). 'mau' giờ CHỈ
// còn quyết định ĐỊNH DẠNG file xuất (cột, tiêu đề, nhóm — xem xayDungBaoCaoDangBang()/veTheDonPdf()),
// không còn ảnh hưởng gì tới việc đơn nào được đưa vào danh sách in nữa.
const TRANG_THAI_TRACKING = 'Đã đóng gói'; // chỉ còn dùng để TỰ SUY mẫu 'tracking' khi không truyền 'mau' (xem xacDinhMau)

function locDon(rows, { stt, sttKeys, tuNgay, denNgay, khachHang, trangThai, trangThaiPhoi, trangThaiVeFile, tuKhoa }) {
  // 'stt' — dùng riêng cho nút "IN ĐƠN" ở trang chi tiết 1 đơn (order.html): khớp CHÍNH XÁC theo
  // STT_Key, bỏ qua mọi điều kiện lọc khác kể cả yêu cầu phải có ngày lên đơn hợp lệ ở nhánh dưới.
  // Không dùng lại 'tuKhoa' (so khớp CHUỖI CON) vì có thể khớp nhầm sang đơn khác có STT_Key
  // chứa STT_Key này làm chuỗi con (vd "DH100" nằm trong "DH1000").
  if (stt) return rows.filter(r => r.STT_Key === stt);

  // 'sttKeys' — dùng cho nút "IN ĐƠN ĐANG CHỌN" ở trang Đơn hàng: khớp CHÍNH XÁC theo danh sách
  // STT_Key đã tick chọn, bỏ qua MỌI bộ lọc khác đang hiển thị trên trang (giống tinh thần của 'stt'
  // ở trên, chỉ khác là nhiều đơn thay vì 1).
  if (sttKeys && sttKeys.length > 0) {
    const set = new Set(sttKeys);
    return rows.filter(r => set.has(r.STT_Key));
  }

  return rows.filter(r => {
    const ngay = parseNgay(r.NGAY_LEN_DON);
    if (!ngay) return false;
    if (tuNgay && ngay < parseNgay(tuNgay)) return false;
    if (denNgay && ngay > parseNgay(denNgay)) return false;
    if (khachHang && r.MA_KHACH_HANG !== khachHang) return false;
    if (trangThai && !khopGiaTriLoc(r.TRANG_THAI_XUONG, trangThai)) return false;
    if (trangThaiPhoi && !khopGiaTriLoc(r.TRANG_THAI_PHOI, trangThaiPhoi)) return false;
    if (trangThaiVeFile && !khopGiaTriLoc(r.TRANG_THAI_VE_FILE, trangThaiVeFile)) return false;
    if (tuKhoa) {
      const tk = tuKhoa.toLowerCase();
      const khop = (r.MA_KHACH_HANG || '').toLowerCase().includes(tk) || (r.STT_Key || '').toLowerCase().includes(tk);
      if (!khop) return false;
    }
    return true;
  });
}

// Chọn mẫu file xuất. Ưu tiên tham số 'mau' nếu có (nút in nhanh ở trang Đơn hàng ép cứng đúng mẫu).
// Không có 'mau' thì chỉ còn suy được mẫu 'tracking' theo TRANG_THAI_XUONG như cũ — 'phoi_ao_gop' và
// 'don_can_in' không còn suy tự động được nữa (xem chú thích ở khai báo hằng số phía trên).
function xacDinhMau(query) {
  const { mau, trangThai } = query;
  if (mau === 'don_can_in' || mau === 'phoi_ao_gop' || mau === 'tracking') return mau;
  if (trangThai === TRANG_THAI_TRACKING) return 'tracking';
  return 'chi_tiet';
}

async function layDonDaLoc(query) {
  const { rows } = await orderService.getAll();
  return locDon(rows, query);
}

function dongThongTinLoc(query, kieu) {
  const { tuNgay, denNgay, khachHang, trangThai, tuKhoa } = query;
  const khHienThi = khachHang || 'Tất cả khách hàng';
  const ttHienThi = trangThai === GIA_TRI_LOC_TRONG ? '(Trống)' : (trangThai || 'Tất cả trạng thái');
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
    const t = r.TRANG_THAI_XUONG || '(Trống)';
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
// sau 1 thời gian sẽ không còn ở trạng thái này nữa. KHÔNG thể đếm bằng cách lọc TRANG_THAI_XUONG hiện tại
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

  const { rows: nhanVien } = await readTabCached('NguoiDung', 30000);
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
    rows.filter(r => r.TRANG_THAI_XUONG === 'REFUNDED_Hoàn đơn')
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
// THỐNG KÊ THỜI GIAN CHẠY MÁY (Đang chạy máy -> Đã sản xuất)
// ============================================================
const TRANG_THAI_BAT_DAU_CHAY_MAY = 'Đang chạy máy';

// Định dạng số mili-giây thành chuỗi dễ đọc kiểu "1 ngày 3 giờ 20 phút" — bỏ đơn vị bằng 0, luôn
// hiện ít nhất 1 đơn vị (vd "0 phút" nếu chưa tới 1 phút).
function dinhDangThoiLuong(ms) {
  if (ms === null || ms === undefined || isNaN(ms)) return '';
  const tongPhut = Math.max(0, Math.round(ms / 60000));
  const ngay = Math.floor(tongPhut / 1440);
  const gio = Math.floor((tongPhut % 1440) / 60);
  const phut = tongPhut % 60;
  const phan = [];
  if (ngay > 0) phan.push(`${ngay} ngày`);
  if (gio > 0) phan.push(`${gio} giờ`);
  if (phut > 0 || phan.length === 0) phan.push(`${phut} phút`);
  return phan.join(' ');
}

// Ghép mỗi lần chuyển sang "Đang chạy máy" (điểm bắt đầu) với lần chuyển sang "Đã sản xuất" KẾ TIẾP
// ngay sau đó của CÙNG 1 đơn (điểm kết thúc) — không phải lần gần nhất, vì 1 đơn có thể chạy máy
// nhiều lần nếu bị lỗi rồi làm lại (mỗi lần chạy máy hoàn chỉnh là 1 dòng riêng trong kết quả).
// 2 trường hợp CỐ Ý bỏ qua (đã xác nhận với người dùng — chỉ tính lần chạy đã xong):
//   - "Đang chạy máy" chưa có "Đã sản xuất" theo sau (đơn còn đang chạy dở, hoặc bị chuyển sang lỗi
//     sản xuất thay vì hoàn thành bình thường).
//   - "Đã sản xuất" không tìm được điểm bắt đầu tương ứng — dữ liệu cũ trước 26/08/2026 (lúc chưa
//     bắt buộc phải qua "Đang chạy máy" mới được "Đã sản xuất", xem orderService.kiemTraTinhHopLy
//     quy tắc 3) có thể rơi vào trường hợp này. Không suy đoán thời lượng cho các trường hợp này.
async function layThoiGianChayMayTheoDon() {
  const [dsBatDau, dsKetThuc] = await Promise.all([
    layLichSuChuyenSangTrangThai(TRANG_THAI_BAT_DAU_CHAY_MAY),
    layLichSuChuyenSangTrangThai(TINH_TRANG_SAN_XUAT),
  ]);

  const theoDon = {};
  dsBatDau.forEach(e => (theoDon[e.sttKey] = theoDon[e.sttKey] || []).push({ ...e, loai: 'BAT_DAU' }));
  dsKetThuc.forEach(e => (theoDon[e.sttKey] = theoDon[e.sttKey] || []).push({ ...e, loai: 'KET_THUC' }));

  const lanChay = [];
  Object.entries(theoDon).forEach(([sttKey, events]) => {
    events.sort((a, b) => new Date(a.thoiGian) - new Date(b.thoiGian));
    let dangCho = null; // lần "Đang chạy máy" đang chờ ghép với "Đã sản xuất" kế tiếp
    for (const ev of events) {
      if (ev.loai === 'BAT_DAU') {
        // Nếu đang có 1 BẮT ĐẦU chưa khớp được KẾT THÚC nào (chạy dở/bị chuyển sang lỗi giữa
        // chừng) thì bỏ nó, thay bằng lần BẮT ĐẦU mới nhất này — chỉ tính lần chạy có đủ cặp.
        dangCho = ev;
      } else if (ev.loai === 'KET_THUC' && dangCho) {
        const soMs = new Date(ev.thoiGian) - new Date(dangCho.thoiGian);
        if (soMs > 0) {
          lanChay.push({
            sttKey, nguoiVanHanh: dangCho.nguoiDung || '(Không rõ)',
            batDau: dangCho.thoiGian, ketThuc: ev.thoiGian, soMs,
          });
        }
        dangCho = null;
      }
    }
  });

  return lanChay;
}

router.get('/thoi-gian-chay-may', async (req, res) => {
  const { tuNgay, denNgay } = req.query;

  // Lọc theo NGÀY BẮT ĐẦU chạy máy (không phải ngày lên đơn) — đúng ý nghĩa "trong khoảng thời gian
  // này xưởng chạy máy như thế nào".
  const tatCaLanChay = await layThoiGianChayMayTheoDon();
  const lanChay = tatCaLanChay.filter(l => {
    const d = new Date(l.batDau);
    if (isNaN(d)) return false;
    if (tuNgay && d < new Date(tuNgay + 'T00:00:00')) return false;
    if (denNgay && d > new Date(denNgay + 'T23:59:59')) return false;
    return true;
  });

  const { rows: donHang } = await orderService.getAll();
  const banDoDon = {};
  donHang.forEach(r => { banDoDon[r.STT_Key] = r; });
  const banDoTenKH = await layBanDoTenKhachHang();

  const theoNguoiVanHanh = {}, theoLoai = {}, theoTuan = {};
  let tongMs = 0;

  const chiTiet = lanChay.map(l => {
    const don = banDoDon[l.sttKey];
    const loai = (don && don.LOAI) || '(Không rõ loại)';
    const d = new Date(l.batDau);
    const nhanTuan = `${d.getFullYear()}-T${String(soTuanTrongNam(d)).padStart(2, '0')}`;

    tongMs += l.soMs;

    if (!theoNguoiVanHanh[l.nguoiVanHanh]) theoNguoiVanHanh[l.nguoiVanHanh] = { soLan: 0, tongMs: 0 };
    theoNguoiVanHanh[l.nguoiVanHanh].soLan++;
    theoNguoiVanHanh[l.nguoiVanHanh].tongMs += l.soMs;

    if (!theoLoai[loai]) theoLoai[loai] = { soLan: 0, tongMs: 0 };
    theoLoai[loai].soLan++;
    theoLoai[loai].tongMs += l.soMs;

    if (!theoTuan[nhanTuan]) theoTuan[nhanTuan] = { soLan: 0, tongMs: 0 };
    theoTuan[nhanTuan].soLan++;
    theoTuan[nhanTuan].tongMs += l.soMs;

    return {
      sttKey: l.sttKey,
      khachHang: don ? (banDoTenKH[don.MA_KHACH_HANG] || don.MA_KHACH_HANG || '') : '',
      loai,
      nguoiVanHanh: l.nguoiVanHanh,
      batDau: dinhDangNgayGioNgan(l.batDau),
      ketThuc: dinhDangNgayGioNgan(l.ketThuc),
      thoiLuong: dinhDangThoiLuong(l.soMs),
      soMs: l.soMs,
    };
  }).sort((a, b) => b.soMs - a.soMs); // lâu nhất lên đầu — dễ thấy đơn bất thường ngay

  const gomNhom = (obj) => Object.fromEntries(
    Object.entries(obj)
      .sort((a, b) => b[1].soLan - a[1].soLan)
      .map(([k, v]) => [k, { soLan: v.soLan, trungBinh: dinhDangThoiLuong(v.tongMs / v.soLan) }])
  );

  res.json({
    tongSoLanChay: lanChay.length,
    trungBinhChung: lanChay.length ? dinhDangThoiLuong(tongMs / lanChay.length) : '',
    theoNguoiVanHanh: gomNhom(theoNguoiVanHanh),
    theoLoai: gomNhom(theoLoai),
    theoTuan: gomNhom(theoTuan),
    chiTiet: chiTiet.slice(0, 200),
  });
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

// Tải ảnh trực tiếp qua HTTP(S) thường — dùng khi URL KHÔNG phải MinIO proxy VÀ KHÔNG nhận diện
// được là link Google Drive (cập nhật 04/09/2026, theo yêu cầu người dùng, xác nhận qua dữ liệu thật
// — rất nhiều đơn dán thẳng link ảnh tham khảo từ nơi khác, vd Etsy, thay vì Drive/MinIO — trước đây
// những link này KHÔNG có đường lấy nào cả nên luôn hiện "Không tải được ảnh" dù link vẫn truy cập
// công khai bình thường). Giới hạn 15s tránh treo cả file in nếu 1 ảnh chậm/chết; chỉ nhận http(s)
// (chặn file://, ftp://... phòng URL lạ/gõ nhầm trong Sheet).
// Đọc thẳng 1 URL bằng module http(s) GỐC của Node — CỐ Ý không dùng fetch() ở đây: fetch() (undici)
// từ chối đọc luôn nếu tổng độ dài HTTP header vượt quá giới hạn mặc định (gặp thật với
// gemini.google.com — header ~25KB, fetch() ném lỗi HeadersOverflowError ngay cả trước khi đọc được
// nội dung). maxHeaderSize nâng lên ở đây tránh đúng lỗi này. Tự theo redirect (301/302/303/307/308)
// vì http(s).get() KHÔNG tự làm như fetch() — tối đa 5 lần, đủ dùng thực tế, tránh lặp vô hạn.
function taiUrlTho(url, soLanChuyenHuongConLai = 5) {
  return new Promise((resolve) => {
    const mod = String(url).startsWith('http://') ? http : https;
    const yeuCau = mod.get(url, {
      maxHeaderSize: 65536 * 4, // 256KB — dư sức so với ~25KB thực tế gặp phải, vẫn có giới hạn để tránh phản hồi bất thường
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }, // 1 số site chặn request không có User-Agint hợp lệ
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && soLanChuyenHuongConLai > 0) {
        res.resume();
        return resolve(taiUrlTho(new URL(res.headers.location, url).toString(), soLanChuyenHuongConLai - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }

      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    yeuCau.on('timeout', () => yeuCau.destroy());
    yeuCau.on('error', (err) => {
      console.error('[Ảnh ngoài] Không tải được:', url, '-', err.message);
      resolve(null);
    });
  });
}

async function taiAnhTuUrlThuong(url) {
  if (!url || !/^https?:\/\//i.test(String(url))) return null;
  return taiUrlTho(url);
}

// Ảnh mới nằm trên MinIO (URL proxy nội bộ); ảnh cũ có thể là link Google Drive, link chia sẻ Gemini
// (trang dựng bằng JS, cần trình duyệt ảo — xem services/trangWebService.js), hoặc link ảnh công
// khai từ nơi khác — thử lần lượt các nguồn để báo cáo PDF mất ít ảnh nhất có thể.
async function taiAnh(url) {
  const objectKey = storageService.proxyUrlToObjectKey(url);
  if (objectKey) {
    try {
      const result = await storageService.getObjectStream(objectKey);
      const chunks = [];
      for await (const chunk of result.Body) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch (err) {
      console.error('[MinIO] Không tải được ảnh:', url, '-', err.message);
      return null;
    }
  }

  if (layFileIdTuLinkDrive(url)) return taiAnhTuLinkDrive(url);

  if (laLinkChiaSeGemini(url)) return taiAnhTuTrangGemini(url);

  return taiAnhTuUrlThuong(url);
}

// Lấy TẤT CẢ ảnh của 1 URL — thường chỉ có 1 ảnh (link file/MinIO/HTTP thường), NHƯNG nếu url là link
// THƯ MỤC Drive thì lấy hết mọi ảnh bên trong (bổ sung 04/09/2026, theo yêu cầu người dùng). Luôn trả
// về MẢNG (có thể rỗng), để nơi gọi xử lý đồng nhất dù 1 hay nhiều ảnh.
async function taiDsAnh(url) {
  const dsThuMuc = await layDsAnhTrongThuMucDrive(url);
  if (dsThuMuc !== null) return dsThuMuc; // đúng là link thư mục (kể cả khi rỗng) — không thử nguồn khác nữa

  const mot = await taiAnh(url);
  return mot ? [mot] : [];
}

async function taiAnhChoDon(don) {
  const [qr, dsMau, dsMockup] = await Promise.all([
    taoQRCodeBuffer(don.STT_Key || '', 300),
    taiDsAnh(don.DUONG_DAN_URL),
    taiDsAnh(don.MOCKUP),
  ]);

  // Ảnh ĐẦU TIÊN (theo tên file nếu là thư mục) dùng cho đúng 2 ô ảnh cố định của thẻ chính — giữ
  // nguyên bố cục thẻ như trước, không đổi gì khi url chỉ trỏ tới đúng 1 ảnh (trường hợp thường gặp).
  const mauChinh = dsMau[0] || null;
  const mockupChinh = dsMockup[0] || null;
  const dinhDangMau = nhanDangDinhDangAnh(mauChinh);
  const dinhDangMockup = nhanDangDinhDangAnh(mockupChinh);

  // Ảnh DƯ (thư mục có nhiều hơn 1 ảnh) — KHÔNG vẽ vào thẻ chính (không đủ chỗ), gộp lại in bổ sung ở
  // trang riêng cuối file (xem veTrangAnhDuPdf) — chỉ giữ ảnh đúng định dạng PNG/JPEG nhận diện được.
  const anhDu = [...dsMau.slice(1), ...dsMockup.slice(1)].filter(buf => nhanDangDinhDangAnh(buf));

  return {
    qr,
    mau: dinhDangMau ? mauChinh : null,
    mockup: dinhDangMockup ? mockupChinh : null,
    mauDinhDang: dinhDangMau,
    mockupDinhDang: dinhDangMockup,
    anhDu,
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
  const viTri = don.VI_TRI_1 || '';
  doc.font('NotoSans-Bold').fontSize(9).text('Vị trí thêu: ', infoX, yInfo, { continued: true, width: infoRong });
  doc.font('NotoSans').text(viTri || '—');
  yInfo += 13;
  doc.font('NotoSans').fontSize(9).text(`SL: ${don.SO_LUONG ?? ''} · Áo/đơn: ${don.SO_LUONG_AO_TREN_DON ?? ''}`, infoX, yInfo, { width: infoRong });
  yInfo += 13;
  doc.font('NotoSans').fontSize(9).text(`Ngày: ${dinhDangNgay(don.NGAY_LEN_DON)}`, infoX, yInfo, { width: infoRong });
  if (don.GHI_CHU) {
    yInfo += 13;
    // In đậm + cỡ chữ lớn hẳn (15, so với 9 của các dòng khác) để nổi bật, dễ nhìn hơn hẳn — theo
    // đúng yêu cầu người dùng. Giới hạn CHIỀU CAO còn lại tới trước dòng chú thích cuối trang
    // (dongNguoiXuat, vẽ bởi veTrangDonCanInPdf) + ellipsis: true để pdfkit tự cắt bớt nếu ghi chú
    // quá dài, tuyệt đối không vẽ đè/tràn lên dòng chú thích đó dù cỡ chữ đã tăng nhiều.
    const CO_CHU_GHI_CHU = 15;
    const yGioiHanDuoi = offsetY + caoThe - leTrong;
    const chieuCaoConLai = yGioiHanDuoi - yInfo;
    if (chieuCaoConLai >= CO_CHU_GHI_CHU) {
      doc.font('NotoSans-Bold').fontSize(CO_CHU_GHI_CHU)
        .text(`Ghi chú: ${don.GHI_CHU}`, infoX, yInfo, { width: infoRong, height: chieuCaoConLai, ellipsis: true });
    }
  }
}

// Trang phụ gộp ẢNH DƯ (đơn có link THƯ MỤC Drive chứa nhiều hơn 1 ảnh — ảnh đầu đã dùng cho thẻ
// chính, các ảnh còn lại không có chỗ trên thẻ 100x150mm nên in bổ sung ở đây) — bổ sung 04/09/2026,
// theo yêu cầu người dùng. Khổ A4 dọc bình thường (khác khổ thẻ chính) để đủ chỗ xếp lưới nhiều ảnh,
// mỗi ảnh ghi rõ mã đơn (STT_Key) bên dưới để dễ đối chiếu lại đúng đơn nào. KHÔNG thêm trang nào nếu
// không có ảnh dư nào cả (trường hợp thường gặp — mỗi url chỉ trỏ đúng 1 ảnh).
function veTrangAnhDuPdf(doc, danhSachAnhDu) {
  if (danhSachAnhDu.length === 0) return;

  const soCot = 3;
  const le = 24;
  const khoangCach = 10;
  const caoNhan = 14;

  function trangGomMoi() {
    doc.addPage({ size: 'A4', margin: le });
    return { rongTrang: doc.page.width, caoTrang: doc.page.height };
  }

  let { rongTrang, caoTrang } = trangGomMoi();
  const rongO = (rongTrang - le * 2 - khoangCach * (soCot - 1)) / soCot;
  const caoO = rongO + caoNhan + khoangCach;

  doc.font('NotoSans-Bold').fontSize(12)
    .text('ẢNH BỔ SUNG TỪ THƯ MỤC (ngoài ảnh chính đã in trên thẻ)', le, le);

  let x = le;
  let y = le + 26;

  danhSachAnhDu.forEach((item, i) => {
    if (y + caoO > caoTrang - le) {
      ({ rongTrang, caoTrang } = trangGomMoi());
      x = le; y = le;
    }
    try {
      doc.image(item.buffer, x, y, { fit: [rongO, rongO] });
    } catch (e) {
      veOTrongPdf(doc, x, y, rongO, 'Lỗi ảnh');
    }
    doc.font('NotoSans').fontSize(8).fillColor('#374151')
      .text(item.sttKey, x, y + rongO + 2, { width: rongO, align: 'center' });
    doc.fillColor('#000000');

    x += rongO + khoangCach;
    if ((i + 1) % soCot === 0) { x = le; y += caoO; }
  });
}

// onTienDo (tuỳ chọn) — gọi lại SAU MỖI đơn đã xử lý xong (đã tải ảnh xong), dùng để báo tiến độ ra
// ngoài cho luồng tạo file chạy nền + polling (xem router.post('/don-can-in/bat-dau') bên dưới).
// kiemTraHuy (tuỳ chọn) — gọi TRƯỚC MỖI đơn, trả true thì dừng ngay (không xử lý tiếp các đơn còn
// lại) — cùng cơ chế 'kiemTraHuy' đã dùng ở chayHangLoatCoTienDo() bên public/js/api.js: đơn đang xử
// lý dở vẫn hoàn tất bình thường, chỉ không bắt đầu đơn kế tiếp.
async function veTrangDonCanInPdf(doc, list, dongNguoiXuat, onTienDo, kiemTraHuy) {
  const rong = mmToPt(KHO_GIAY_MM.rong);
  const cao = mmToPt(KHO_GIAY_MM.cao);
  const caoFooter = 9;
  // 1 đơn 1 trang — ảnh to hơn hẳn, dễ đối chiếu khi dán lên áo (trước đây 2 đơn/trang, ảnh nhỏ)
  const caoThe = cao - caoFooter;

  const anhDuTatCa = []; // gộp ảnh dư từ MỌI đơn trong lượt in này, in bổ sung 1 lần ở cuối

  for (let i = 0; i < list.length; i++) {
    if (kiemTraHuy && kiemTraHuy()) break;
    if (i > 0) doc.addPage({ size: [rong, cao], margin: 0 });

    const anh = await taiAnhChoDon(list[i]);
    veTheDonPdf(doc, list[i], anh, 0, caoThe);

    doc.font('NotoSans').fontSize(5).fillColor('#9ca3af')
      .text(dongNguoiXuat, 4, cao - caoFooter + 1, { width: rong - 8, align: 'center' });
    doc.fillColor('#000000');

    anh.anhDu.forEach(buffer => anhDuTatCa.push({ sttKey: list[i].STT_Key || '', buffer }));
    if (onTienDo) onTienDo();
  }

  veTrangAnhDuPdf(doc, anhDuTatCa);
}

// onTienDo/kiemTraHuy (tuỳ chọn) — xem chú thích ở veTrangDonCanInPdf(), cùng mục đích.
async function veSheetDonCanInExcel(wb, list, dongThongTin, dongNguoiXuat, onTienDo, kiemTraHuy) {
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
    if (kiemTraHuy && kiemTraHuy()) break;
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

    const viTri = don.VI_TRI_1 || '';
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
    if (onTienDo) onTienDo();
  }
}

const COT_PHOI_AO_CHI_TIET = [
  { header: 'STT_Key', key: 'STT_Key', width: 14 },
  { header: 'MA_CODE_STT', key: 'MA_CODE_STT', width: 14 },
  { header: 'TRANG_THAI_XUONG', key: 'TRANG_THAI_XUONG', width: 24 },
  { header: 'NGAY_LEN_DON', key: 'NGAY_LEN_DON', width: 14, laNgay: true },
  { header: 'LOAI', key: 'LOAI', width: 12 },
  { header: 'KICH_THUOC', key: 'KICH_THUOC', width: 12 },
  { header: 'MAU_SAC', key: 'MAU_SAC', width: 18 },
];

const COT_PHOI_AO_GOP = [
  // KHÔNG đánh dấu laNgay — cột này có thể chứa NHIỀU ngày gộp lại (xem gomNhomPhoiAo), đã được
  // định dạng sẵn thành chuỗi hiển thị, không phải 1 giá trị ngày đơn để tự format nữa.
  { header: 'NGAY_LEN_DON', key: 'NGAY_LEN_DON', width: 26 },
  { header: 'LOAI', key: 'LOAI', width: 12 },
  { header: 'KICH_THUOC', key: 'KICH_THUOC', width: 12 },
  { header: 'MAU_SAC', key: 'MAU_SAC', width: 18 },
  { header: 'SO_LUONG', key: 'SO_LUONG', width: 10 },
];

const COT_TRACKING = [
  { header: 'STT_Key', key: 'STT_Key', width: 14 },
  { header: 'MA_CODE_STT', key: 'MA_CODE_STT', width: 14 },
  { header: 'MA_KHACH_HANG', key: 'MA_KHACH_HANG', width: 16 },
  { header: 'TRACKING_ID', key: 'TRACKING_ID', width: 18 },
  { header: 'QUOC_GIA', key: 'QUOC_GIA', width: 12 },
  { header: 'LOAI', key: 'LOAI', width: 12 },
  { header: 'SO_LUONG', key: 'SO_LUONG', width: 10 },
];

// Chuẩn hoá LOAI/KICH_THUOC/MAU_SAC để gộp nhóm ở gomNhomPhoiAo() KHÔNG phân biệt hoa/thường (vd
// "SWEAT"/"Sweat"/"sweat" tính là CÙNG 1 dòng, không tách lẻ vì lỗi gõ hoa/thường) — cắt khoảng
// trắng thừa 2 đầu, luôn IN HOA để hiển thị đồng nhất trong file PDF/Excel xuất ra, bất kể dữ liệu
// gốc trên Sheet viết kiểu gì. Không sửa dữ liệu gốc trên Sheet, chỉ chuẩn hoá lúc gộp/hiển thị.
function chuanHoaPhoiAo(str) {
  return String(str || '').trim().toUpperCase();
}

// Thứ tự cỡ áo CHUẨN, nhỏ -> lớn (xác nhận với người dùng 04/09/2026) — dùng để sắp cột KICH_THUOC ở
// danh sách phôi áo theo đúng cỡ, không phải theo bảng chữ cái (bảng chữ cái sẽ ra sai thứ tự, vd
// "L" đứng trước "M" trước "S" trước "XL"). Giá trị KHÔNG khớp danh sách này (gõ sai/lạ, hiếm gặp)
// bị ĐẨY XUỐNG CUỐI — sau mọi cỡ hợp lệ — rồi tự sắp với nhau theo bảng chữ cái (xem soSanhKichThuoc).
const THU_TU_KICH_THUOC = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];

function soSanhKichThuoc(a, b) {
  const idxA = THU_TU_KICH_THUOC.indexOf(a);
  const idxB = THU_TU_KICH_THUOC.indexOf(b);
  if (idxA !== -1 && idxB !== -1) return idxA - idxB;
  if (idxA !== -1) return -1;
  if (idxB !== -1) return 1;
  return a.localeCompare(b, 'vi');
}

// Gộp TẤT CẢ đơn khớp LOAI+KICH_THUOC+MAU_SAC vào 1 dòng DUY NHẤT, KHÔNG phân biệt ngày lên đơn khác
// nhau (cập nhật 04/09/2026, theo yêu cầu người dùng — trước đó còn gộp riêng theo từng ngày, cùng
// loại/kích/màu nhưng khác ngày bị tách thành nhiều dòng). Cột NGAY_LEN_DON của dòng gộp liệt kê ĐẦY
// ĐỦ mọi ngày khác nhau có góp mặt trong nhóm đó, mỗi ngày chỉ hiện 1 lần (nhiều đơn cùng ngày không
// lặp lại), sắp theo thời gian tăng dần, cách nhau bằng dấu phẩy.
function gomNhomPhoiAo(list) {
  const nhom = new Map();
  list.forEach(r => {
    const loai = chuanHoaPhoiAo(r.LOAI);
    const kichThuoc = chuanHoaPhoiAo(r.KICH_THUOC);
    const mauSac = chuanHoaPhoiAo(r.MAU_SAC);
    const khoa = [loai, kichThuoc, mauSac].join('|');
    if (!nhom.has(khoa)) {
      nhom.set(khoa, { cacNgay: new Map(), LOAI: loai, KICH_THUOC: kichThuoc, MAU_SAC: mauSac, SO_LUONG: 0 });
    }
    const n = nhom.get(khoa);
    n.SO_LUONG += Number(r.SO_LUONG) || 0;

    const ngay = parseNgay(r.NGAY_LEN_DON);
    if (ngay) {
      const khoaNgay = `${ngay.getFullYear()}-${ngay.getMonth()}-${ngay.getDate()}`; // để loại trùng ngày, không dùng làm khoá gộp nhóm nữa
      if (!n.cacNgay.has(khoaNgay)) n.cacNgay.set(khoaNgay, ngay);
    }
  });

  const ketQua = Array.from(nhom.values()).map(n => ({
    LOAI: n.LOAI, KICH_THUOC: n.KICH_THUOC, MAU_SAC: n.MAU_SAC, SO_LUONG: n.SO_LUONG,
    NGAY_LEN_DON: Array.from(n.cacNgay.values()).sort((a, b) => a - b).map(d => dinhDangNgay(d)).join(', '),
  }));

  // Sắp theo thứ tự ưu tiên giảm dần: LOAI -> KICH_THUOC (theo cỡ nhỏ -> lớn, xem THU_TU_KICH_THUOC,
  // KHÔNG phải theo bảng chữ cái) -> MAU_SAC -> SO_LUONG (theo yêu cầu người dùng 04/09/2026) — cùng
  // LOAI đứng gần nhau, trong cùng LOAI thì cỡ nhỏ đứng trước cỡ lớn..., SO_LUONG chỉ để phân định
  // khi 3 cột trên đã giống hệt nhau (không còn xảy ra nữa vì giờ chỉ có đúng 1 dòng cho mỗi tổ hợp
  // LOAI+KICH_THUOC+MAU_SAC, nhưng vẫn giữ lại cho chắc).
  return ketQua.sort((a, b) =>
    a.LOAI.localeCompare(b.LOAI, 'vi') ||
    soSanhKichThuoc(a.KICH_THUOC, b.KICH_THUOC) ||
    a.MAU_SAC.localeCompare(b.MAU_SAC, 'vi') ||
    b.SO_LUONG - a.SO_LUONG
  );
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
        viTri: don.VI_TRI_1 || '',
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

// ============================================================
// TẠO FILE "IN ĐƠN" CÓ TIẾN ĐỘ — chạy nền + client hỏi tiến độ định kỳ (polling), bổ sung 04/09/2026
// theo yêu cầu người dùng. Khác với luồng quét QR/đổi trạng thái hàng loạt (chayHangLoatCoTienDo
// trong public/js/api.js — tách được thành nhiều lệnh gọi API độc lập từ trình duyệt), tạo file
// PDF/Excel là 1 tiến trình LIÊN TỤC ngay trên server (build 1 file duy nhất, không tách nhỏ được từ
// phía trình duyệt) nên phải dùng mô hình: server tạo "công việc" (job) chạy nền, trả về jobId ngay;
// client hỏi lại tiến độ mỗi vài trăm ms tới khi xong rồi mới tải file về qua 1 URL riêng.
// CHỈ áp dụng cho mẫu 'don_can_in' (IN ĐƠN) — đây là mẫu DUY NHẤT phải tải ảnh từng đơn một
// (taiAnhChoDon) nên mới chậm; 'phoi_ao_gop'/'tracking' không đụng ảnh, đã đủ nhanh, vẫn dùng
// nguyên route /pdf và /excel ở trên như cũ.
// ============================================================
const _congViecInDon = new Map(); // jobId -> { tongSo, daXong, trangThai: 'dang_chay'|'xong'|'huy'|'loi', daHuy, buffer, contentType, tenFile, loi, capNhatLucNao }
const THOI_GIAN_GIU_JOB_MS = 15 * 60 * 1000; // dọn job cũ hơn 15 phút — phòng người dùng bỏ dở không tải về, tránh rò rỉ bộ nhớ

function donDepJobCu() {
  const gioiHan = Date.now() - THOI_GIAN_GIU_JOB_MS;
  for (const [id, job] of _congViecInDon) {
    if (job.capNhatLucNao < gioiHan) _congViecInDon.delete(id);
  }
}

router.post('/don-can-in/bat-dau', async (req, res) => {
  donDepJobCu();

  const dinhDang = req.body.dinhDang === 'excel' ? 'excel' : 'pdf';
  const list = await layDonDaLoc(req.body);

  const jobId = crypto.randomUUID();
  const job = {
    tongSo: list.length, daXong: 0, trangThai: 'dang_chay', daHuy: false,
    buffer: null, contentType: null, tenFile: null, loi: null,
    capNhatLucNao: Date.now(),
  };
  _congViecInDon.set(jobId, job);

  res.json({ jobId, tongSo: list.length });

  // Xử lý THẬT chạy nền sau khi đã trả response — KHÔNG await ở trên.
  (async () => {
    try {
      const onTienDo = () => { job.daXong += 1; job.capNhatLucNao = Date.now(); };
      const kiemTraHuy = () => job.daHuy;
      const tenNguoiDung = req.session.user.ten;

      if (dinhDang === 'excel') {
        const wb = new ExcelJS.Workbook();
        await veSheetDonCanInExcel(wb, list, dongThongTinLoc(req.body, 'phoi_ao'), dongNguoiXuatChuoi(tenNguoiDung), onTienDo, kiemTraHuy);
        if (!job.daHuy) {
          job.buffer = Buffer.from(await wb.xlsx.writeBuffer());
          job.contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          job.tenFile = `DonCanIn_${ngayChoTenFile(req.body)}.xlsx`;
        }
      } else {
        const rong = mmToPt(KHO_GIAY_MM.rong);
        const cao = mmToPt(KHO_GIAY_MM.cao);
        const doc = new PDFDocument({ size: [rong, cao], margin: 0 });
        doc.registerFont('NotoSans', FONT_REGULAR);
        doc.registerFont('NotoSans-Bold', FONT_BOLD);

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        const daGhiXong = new Promise(resolve => doc.on('end', resolve));

        if (list.length === 0) {
          doc.font('NotoSans').fontSize(9).text('Không có đơn nào khớp bộ lọc.', 10, 10);
        } else {
          await veTrangDonCanInPdf(doc, list, dongNguoiXuatChuoi(tenNguoiDung), onTienDo, kiemTraHuy);
        }
        // Vẫn phải đóng doc dù đã bị hủy giữa chừng — nếu không, sự kiện 'end' không bao giờ bắn,
        // 'daGhiXong' treo mãi, job không bao giờ cập nhật xong trạng thái.
        doc.end();
        await daGhiXong;

        if (!job.daHuy) {
          job.buffer = Buffer.concat(chunks);
          job.contentType = 'application/pdf';
          job.tenFile = `DonCanIn_${ngayChoTenFile(req.body)}.pdf`;
        }
      }
      job.trangThai = job.daHuy ? 'huy' : 'xong';
    } catch (err) {
      console.error('[Reports] Lỗi tạo file IN ĐƠN (chạy nền):', err.message);
      job.trangThai = 'loi';
      job.loi = err.message;
    }
    job.capNhatLucNao = Date.now();
  })();
});

router.get('/don-can-in/tien-do/:jobId', (req, res) => {
  const job = _congViecInDon.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Không tìm thấy tiến trình (có thể đã hết hạn)' });
  res.json({ tongSo: job.tongSo, daXong: job.daXong, trangThai: job.trangThai, loi: job.loi });
});

// Nút "DỪNG" ở public/orders.html gọi route này — chỉ đặt cờ 'daHuy', KHÔNG xoá job ngay (job vẫn
// đang chạy nền, cần tự đọc cờ này ở kiemTraHuy() rồi mới dừng đúng chỗ — xem router.post('/bat-dau')).
router.post('/don-can-in/huy/:jobId', (req, res) => {
  const job = _congViecInDon.get(req.params.jobId);
  if (job && job.trangThai === 'dang_chay') job.daHuy = true;
  res.json({ ok: true });
});

router.get('/don-can-in/tai-ve/:jobId', (req, res) => {
  const job = _congViecInDon.get(req.params.jobId);
  if (!job || job.trangThai !== 'xong') {
    return res.status(404).json({ error: 'File chưa sẵn sàng hoặc đã hết hạn' });
  }
  res.setHeader('Content-Type', job.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${job.tenFile}"`);
  res.send(job.buffer);
  _congViecInDon.delete(req.params.jobId); // đã tải về xong, dọn ngay không cần đợi hết hạn
});

module.exports = router;
