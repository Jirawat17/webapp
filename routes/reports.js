const express = require('express');
const router = express.Router();
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const orderService = require('../services/orderService');
const { layDanhSachKhachHang } = require('../services/khachHangService');
const { parseNgay, dinhDangNgay } = require('../services/dateUtils');
const { DANH_SACH_TRANG_THAI_BAO_CAO } = require('../data/pipelineTinhTrang');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin); // mọi vai trò đăng nhập đều dùng được trang Báo cáo

const FONT_REGULAR = path.join(__dirname, '..', 'fonts', 'NotoSans-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'fonts', 'NotoSans-Bold.ttf');

// 2 trạng thái có mẫu xuất RIÊNG — mọi trạng thái khác (kể cả không chọn gì) dùng mẫu mặc định
// (danh sách chi tiết từng đơn). Khớp chính xác chuỗi trong data/pipelineTinhTrang.js.
const TRANG_THAI_TRACKING = 'B5_Đã sản xuất';
const TRANG_THAI_GOP_PHOI_AO = 'B1_Đã in';

function locDon(rows, { tuNgay, denNgay, khachHang, trangThai }) {
  return rows.filter(r => {
    const ngay = parseNgay(r.NGAY_LEN_DON);
    if (!ngay) return false;
    if (tuNgay && ngay < parseNgay(tuNgay)) return false;
    if (denNgay && ngay > parseNgay(denNgay)) return false;
    if (khachHang && r.MA_KHACH_HANG !== khachHang) return false;
    if (trangThai && r.TINH_TRANG !== trangThai) return false;
    return true;
  });
}

// 3 bộ cột đúng theo mẫu Excel người dùng cung cấp — dùng tên cột THẬT trong Sheet.
const COT_PHOI_AO_CHI_TIET = [ // mặc định — 1 dòng / 1 đơn
  { header: 'STT_Key', key: 'STT_Key', width: 14 },
  { header: 'MA_CODE_STT', key: 'MA_CODE_STT', width: 14 },
  { header: 'TINH_TRANG', key: 'TINH_TRANG', width: 24 },
  { header: 'NGAY_LEN_DON', key: 'NGAY_LEN_DON', width: 14, laNgay: true },
  { header: 'LOAI', key: 'LOAI', width: 12 },
  { header: 'KICH_THUOC', key: 'KICH_THUOC', width: 12 },
  { header: 'MAU_SAC', key: 'MAU_SAC', width: 18 },
];

const COT_PHOI_AO_GOP = [ // B1_Đã in — đã gộp theo ngày+loại+kích thước+màu, không còn STT_Key
  { header: 'NGAY_LEN_DON', key: 'NGAY_LEN_DON', width: 14, laNgay: true },
  { header: 'LOAI', key: 'LOAI', width: 12 },
  { header: 'KICH_THUOC', key: 'KICH_THUOC', width: 12 },
  { header: 'MAU_SAC', key: 'MAU_SAC', width: 18 },
  { header: 'SO_LUONG', key: 'SO_LUONG', width: 10 },
];

const COT_TRACKING = [ // B5_Đã sản xuất
  { header: 'STT_Key', key: 'STT_Key', width: 14 },
  { header: 'MA_CODE_STT', key: 'MA_CODE_STT', width: 14 },
  { header: 'MA_KHACH_HANG', key: 'MA_KHACH_HANG', width: 16 },
  { header: 'MA_VAN_DON_ID', key: 'MA_VAN_DON_ID', width: 18 },
  { header: 'QUOC_GIA', key: 'QUOC_GIA', width: 12 },
  { header: 'LOAI', key: 'LOAI', width: 12 },
  { header: 'SO_LUONG', key: 'SO_LUONG', width: 10 },
];

// Gộp nhiều đơn CÙNG (ngày lên đơn + loại + kích thước + màu sắc) thành 1 dòng, cộng dồn số lượng.
// Đúng nguyên tắc trong file mẫu "Danh_sach_phoi_ao_Tong_hop.xlsx" — sắp theo số lượng giảm dần
// để nhóm cần chuẩn bị nhiều nhất lên đầu, dễ ưu tiên khi lấy phôi.
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

function dongThongTinLoc(query, kieu) {
  const { tuNgay, denNgay, khachHang, trangThai } = query;
  const khHienThi = khachHang || 'Tất cả khách hàng';
  const ttHienThi = trangThai || 'Tất cả trạng thái';
  if (kieu === 'tracking') {
    return `Khoảng thời gian: ${tuNgay || '(không giới hạn)'} ${denNgay || '(không giới hạn)'} · Khách hàng: ${khHienThi} · Trạng thái: ${ttHienThi}`;
  }
  return `Khoảng thời gian: Từ ngày ${tuNgay || '(không giới hạn)'} đến ngày ${denNgay || '(không giới hạn)'} · Khách hàng: ${khHienThi} · Trạng thái: ${ttHienThi}`;
}

function dinhDangNgayGio(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

// Hậu tố ngày cho tên file tải về — ưu tiên dùng ngày đang lọc (dễ phân biệt nhiều lần xuất khác
// ngày), nếu không lọc ngày thì dùng ngày thực xuất file.
function ngayChoTenFile(query) {
  const ddmmyyyy = (d) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  const tu = parseNgay(query.tuNgay);
  const den = parseNgay(query.denNgay);
  if (tu && den && tu.getTime() !== den.getTime()) return `${ddmmyyyy(tu)}_den_${ddmmyyyy(den)}`;
  if (tu) return ddmmyyyy(tu);
  return ddmmyyyy(new Date());
}

// ============================================================
// HÀM DÙNG CHUNG — xây dữ liệu báo cáo 1 LẦN, dùng lại y hệt cho Excel, PDF, và Xem trước.
// Tránh 3 nơi tự lặp logic rồi lệch nhau theo thời gian.
// ============================================================
function xayDungBaoCao(list, query, tenNguoiXuat) {
  const dongNguoiXuat = `Người xuất: ${tenNguoiXuat} · Thời gian xuất: ${dinhDangNgayGio(new Date())}`;
  const { trangThai } = query;

  if (trangThai === TRANG_THAI_TRACKING) {
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

  if (trangThai === TRANG_THAI_GOP_PHOI_AO) {
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

// Danh sách khách hàng — dùng để đổ vào dropdown lọc ở giao diện (trả cả mã lẫn tên hiển thị)
router.get('/khach-hang', async (req, res) => {
  const list = await layDanhSachKhachHang();
  res.json(list);
});

// Danh sách ĐẦY ĐỦ trạng thái (cố định theo pipeline, không chỉ những gì đang có trong dữ liệu) —
// kèm số lượng đơn thật khớp (ngày+khách hàng) đã chọn, 0 nếu trạng thái đó chưa có đơn nào.
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

async function layDonDaLoc(query) {
  const { rows } = await orderService.getAll();
  return locDon(rows, query);
}

// Xem trước — trả JSON để giao diện tự vẽ bảng, KHÔNG cần tải file mới xem được nội dung.
// Dùng chung hệt hàm xayDungBaoCao với Excel/PDF nên luôn khớp 100% với file thật sẽ tải về.
router.get('/xem-truoc', async (req, res) => {
  const list = await layDonDaLoc(req.query);
  const baoCao = xayDungBaoCao(list, req.query, req.session.user.ten);

  const ketQua = baoCao.bang.map(b => ({
    tieuDe: b.tieuDe,
    dongThongTin: b.dongThongTin,
    dongNguoiXuat: b.dongNguoiXuat,
    cot: b.cot.map(c => c.header),
    rows: b.rows.map(r => b.cot.map(c => (c.laNgay ? dinhDangNgay(r[c.key]) : (r[c.key] ?? '')))),
  }));

  res.json({ tenFileGoc: baoCao.tenFileGoc, bang: ketQua });
});

// ============================================================
// EXCEL
// ============================================================
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
  const baoCao = xayDungBaoCao(list, req.query, req.session.user.ten);

  const wb = new ExcelJS.Workbook();
  baoCao.bang.forEach(b => veSheetExcel(wb, b));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${baoCao.tenFileGoc}_${ngayChoTenFile(req.query)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ============================================================
// PDF
// ============================================================
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

  function veHang(values, dam) {
    doc.font(dam ? 'NotoSans-Bold' : 'NotoSans').fontSize(9);
    values.forEach((v, i) => {
      doc.text(String(v ?? ''), startX + i * colWidth, y, { width: colWidth - 4, ellipsis: true });
    });
    y += 16;
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
  const baoCao = xayDungBaoCao(list, req.query, req.session.user.ten);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${baoCao.tenFileGoc}_${ngayChoTenFile(req.query)}.pdf"`);

  const doc = new PDFDocument({ margin: 24, size: 'A4', layout: 'landscape' });
  doc.registerFont('NotoSans', FONT_REGULAR);
  doc.registerFont('NotoSans-Bold', FONT_BOLD);
  doc.pipe(res);

  baoCao.bang.forEach((b, i) => veBangPdf(doc, b, i > 0));

  doc.end();
});

module.exports = router;
