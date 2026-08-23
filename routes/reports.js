const express = require('express');
const router = express.Router();
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const orderService = require('../services/orderService');
const { layDanhSachKhachHang } = require('../services/khachHangService');
const { parseNgay, dinhDangNgay } = require('../services/dateUtils');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin); // mọi vai trò đăng nhập đều dùng được trang Báo cáo

const FONT_REGULAR = path.join(__dirname, '..', 'fonts', 'NotoSans-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'fonts', 'NotoSans-Bold.ttf');

// Trạng thái duy nhất kích hoạt mẫu "Thông tin cho Tracking" (2 sheet/2 bảng) — khớp chính xác
// với chuỗi trong data/pipelineTinhTrang.js. Mọi trạng thái khác (kể cả không chọn gì) dùng mẫu
// "Danh sách phôi áo tổng hợp" làm mặc định, vì mẫu đó có TINH_TRANG + NGAY_LEN_DON phù hợp với
// bất kỳ giai đoạn nào — còn mẫu Tracking cần MA_VAN_DON_ID (mã vận đơn), chỉ có ý nghĩa khi đơn
// đã gần tới lúc ship.
const TRANG_THAI_TRACKING = 'B5_Đã sản xuất';

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

// 2 bộ cột đúng theo mẫu Excel người dùng cung cấp — dùng tên cột THẬT trong Sheet (không dịch
// sang tiếng Việt thân thiện), vì đây là mẫu xuất để in/đối chiếu trực tiếp với dữ liệu gốc.
const COT_PHOI_AO = [
  { header: 'STT_Key', key: 'STT_Key', width: 14 },
  { header: 'MA_CODE_STT', key: 'MA_CODE_STT', width: 14 },
  { header: 'TINH_TRANG', key: 'TINH_TRANG', width: 24 },
  { header: 'NGAY_LEN_DON', key: 'NGAY_LEN_DON', width: 14, laNgay: true },
  { header: 'LOAI', key: 'LOAI', width: 12 },
  { header: 'KICH_THUOC', key: 'KICH_THUOC', width: 12 },
  { header: 'MAU_SAC', key: 'MAU_SAC', width: 18 },
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

function dongThongTinLoc(query, kieu) {
  const { tuNgay, denNgay, khachHang, trangThai } = query;
  const khHienThi = khachHang || 'Tất cả khách hàng';
  const ttHienThi = trangThai || 'Tất cả trạng thái';
  if (kieu === 'tracking') {
    return `Khoảng thời gian: ${tuNgay || '(không giới hạn)'} ${denNgay || '(không giới hạn)'} · Khách hàng: ${khHienThi} · Trạng thái: ${ttHienThi}`;
  }
  return `Khoảng thời gian: Từ ngày ${tuNgay || '(không giới hạn)'} đến ngày ${denNgay || '(không giới hạn)'} · Khách hàng: ${khHienThi} · Trạng thái: ${ttHienThi}`;
}

// Danh sách khách hàng — dùng để đổ vào dropdown lọc ở giao diện (trả cả mã lẫn tên hiển thị)
router.get('/khach-hang', async (req, res) => {
  const list = await layDanhSachKhachHang();
  res.json(list);
});

// Danh sách trạng thái ĐANG CÓ THẬT trong phạm vi (ngày + khách hàng) đã chọn, kèm số lượng —
// dùng để đổ vào dropdown "Trạng thái" mỗi khi người dùng đổi ngày/khách hàng ở giao diện.
router.get('/trang-thai-theo-loc', async (req, res) => {
  const { tuNgay, denNgay, khachHang } = req.query;
  const { rows } = await orderService.getAll();
  const list = locDon(rows, { tuNgay, denNgay, khachHang });

  const dem = {};
  list.forEach(r => {
    const t = r.TINH_TRANG || '(Trống)';
    dem[t] = (dem[t] || 0) + 1;
  });

  const ketQua = Object.entries(dem)
    .map(([trangThai, soDon]) => ({ trangThai, soDon }))
    .sort((a, b) => b.soDon - a.soDon);

  res.json({ tongSoDon: list.length, trangThai: ketQua });
});

async function layDonDaLoc(query) {
  const { rows } = await orderService.getAll();
  return locDon(rows, query);
}

// ============================================================
// EXCEL
// ============================================================
function veSheetExcel(wb, tenSheet, tieuDe, dongThongTin, cot, list) {
  const sheet = wb.addWorksheet(tenSheet);
  cot.forEach((c, i) => { sheet.getColumn(i + 1).width = c.width; });

  sheet.mergeCells(1, 1, 1, cot.length);
  sheet.getCell(1, 1).value = tieuDe;
  sheet.getCell(1, 1).font = { bold: true, size: 13 };

  sheet.mergeCells(2, 1, 2, cot.length);
  sheet.getCell(2, 1).value = dongThongTin;
  sheet.getCell(2, 1).font = { italic: true, size: 10, color: { argb: 'FF52525B' } };

  sheet.addRow([]);

  const dongHeader = sheet.addRow(cot.map(c => c.header));
  dongHeader.font = { bold: true };
  dongHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

  list.forEach(r => {
    const dong = sheet.addRow(cot.map(c => (c.laNgay ? parseNgay(r[c.key]) : (r[c.key] ?? ''))));
    cot.forEach((c, i) => { if (c.laNgay) dong.getCell(i + 1).numFmt = 'dd/mm/yyyy'; });
  });

  sheet.addRow([]);
  const dongTong = sheet.addRow([`Tổng số đơn: ${list.length}`]);
  dongTong.font = { bold: true };
}

router.get('/excel', async (req, res) => {
  const list = await layDonDaLoc(req.query);
  const laTracking = req.query.trangThai === TRANG_THAI_TRACKING;

  const wb = new ExcelJS.Workbook();
  const tenFile = laTracking ? 'ThongTinChoTracking' : 'DSPhoiAoTongHop';

  if (laTracking) {
    veSheetExcel(wb, 'ThongTinChoTracking', 'TỔNG HỢP THÔNG TIN ĐƠN HÀNG CHO TRACKING',
      dongThongTinLoc(req.query, 'tracking'), COT_TRACKING, list);
  }
  veSheetExcel(wb, 'DSPhoiAoTongHop', 'TỔNG HỢP DANH SÁCH PHÔI ÁO CẦN CHUẨN BỊ',
    dongThongTinLoc(req.query, 'phoi_ao'), COT_PHOI_AO, list);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${tenFile}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ============================================================
// PDF
// ============================================================
function veBangPdf(doc, tieuDe, dongThongTin, cot, list, canTrangMoi) {
  if (canTrangMoi) doc.addPage();

  doc.font('NotoSans-Bold').fontSize(15).text(tieuDe, { align: 'center' });
  doc.moveDown(0.3);
  doc.font('NotoSans').fontSize(9.5).text(dongThongTin, { align: 'center' });
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
  list.forEach(r => veHang(cot.map(c => (c.laNgay ? dinhDangNgay(r[c.key]) : r[c.key]))));

  y += 10;
  if (y > doc.page.height - doc.page.margins.bottom - 20) { doc.addPage(); y = doc.page.margins.top; }
  doc.font('NotoSans-Bold').fontSize(10).text(`Tổng số đơn: ${list.length}`, startX, y);
}

router.get('/pdf', async (req, res) => {
  const list = await layDonDaLoc(req.query);
  const laTracking = req.query.trangThai === TRANG_THAI_TRACKING;
  const tenFile = laTracking ? 'ThongTinChoTracking' : 'DSPhoiAoTongHop';

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${tenFile}.pdf"`);

  const doc = new PDFDocument({ margin: 24, size: 'A4', layout: 'landscape' });
  doc.registerFont('NotoSans', FONT_REGULAR);
  doc.registerFont('NotoSans-Bold', FONT_BOLD);
  doc.pipe(res);

  if (laTracking) {
    veBangPdf(doc, 'TỔNG HỢP THÔNG TIN ĐƠN HÀNG CHO TRACKING', dongThongTinLoc(req.query, 'tracking'), COT_TRACKING, list, false);
    veBangPdf(doc, 'TỔNG HỢP DANH SÁCH PHÔI ÁO CẦN CHUẨN BỊ', dongThongTinLoc(req.query, 'phoi_ao'), COT_PHOI_AO, list, true);
  } else {
    veBangPdf(doc, 'TỔNG HỢP DANH SÁCH PHÔI ÁO CẦN CHUẨN BỊ', dongThongTinLoc(req.query, 'phoi_ao'), COT_PHOI_AO, list, false);
  }

  doc.end();
});

module.exports = router;
