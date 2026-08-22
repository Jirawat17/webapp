const express = require('express');
const router = express.Router();
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const orderService = require('../services/orderService');
const { requireLogin, requireRole } = require('../middleware/auth');

router.use(requireLogin);
router.use(requireRole('quan_ly'));

const FONT_REGULAR = path.join(__dirname, '..', 'fonts', 'NotoSans-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'fonts', 'NotoSans-Bold.ttf');

function locDon(rows, { tuNgay, denNgay, khachHang }) {
  return rows.filter(r => {
    if (!r.Ngay_Dat) return false;
    const ngay = new Date(r.Ngay_Dat);
    if (isNaN(ngay)) return false;
    if (tuNgay && ngay < new Date(tuNgay)) return false;
    if (denNgay && ngay > new Date(denNgay)) return false;
    if (khachHang && r.Ten_KH !== khachHang) return false;
    return true;
  });
}

const COT_BAO_CAO = [
  { header: 'Mã đơn', key: 'STT_Key', width: 16 },
  { header: 'Khách hàng', key: 'Ten_KH', width: 20 },
  { header: 'Sản phẩm', key: 'Ten_San_Pham', width: 24 },
  { header: 'Số lượng', key: 'So_Luong', width: 10 },
  { header: 'Ngày đặt', key: 'Ngay_Dat', width: 12 },
  { header: 'Deadline', key: 'Ngay_Giao_Du_Kien', width: 12 },
  { header: 'Trạng thái', key: 'Trang_Thai', width: 16 },
  { header: 'Team', key: 'Team_San_Xuat', width: 14 },
  { header: 'Ngày ship', key: 'Ngay_Ship', width: 12 },
];

// Danh sách khách hàng duy nhất — dùng để đổ vào dropdown lọc ở giao diện
router.get('/khach-hang', async (req, res) => {
  const { rows } = await orderService.getAll();
  const list = [...new Set(rows.map(r => r.Ten_KH).filter(Boolean))].sort();
  res.json(list);
});

router.get('/excel', async (req, res) => {
  const { rows } = await orderService.getAll();
  const list = locDon(rows, req.query);

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Báo cáo đơn hàng');
  sheet.columns = COT_BAO_CAO;
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  list.forEach(r => sheet.addRow(r));

  sheet.addRow({});
  const dongTong = sheet.addRow({ STT_Key: `Tổng số đơn: ${list.length}` });
  dongTong.font = { bold: true };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="bao-cao-don-hang.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

router.get('/pdf', async (req, res) => {
  const { rows } = await orderService.getAll();
  const list = locDon(rows, req.query);
  const { tuNgay, denNgay, khachHang } = req.query;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="bao-cao-don-hang.pdf"');

  const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
  doc.registerFont('NotoSans', FONT_REGULAR);
  doc.registerFont('NotoSans-Bold', FONT_BOLD);
  doc.pipe(res);

  doc.font('NotoSans-Bold').fontSize(16).text('Báo cáo đơn hàng — Xưởng Thêu', { align: 'center' });
  doc.moveDown(0.3);
  doc.font('NotoSans').fontSize(10).text(
    `Khoảng thời gian: ${tuNgay || '(không giới hạn)'} → ${denNgay || '(không giới hạn)'}` +
    (khachHang ? ` · Khách hàng: ${khachHang}` : ''),
    { align: 'center' }
  );
  doc.moveDown(1);

  const startX = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = usableWidth / COT_BAO_CAO.length;
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

  veHang(COT_BAO_CAO.map(c => c.header), true);
  list.forEach(r => veHang(COT_BAO_CAO.map(c => r[c.key])));

  y += 10;
  if (y > doc.page.height - doc.page.margins.bottom - 20) { doc.addPage(); y = doc.page.margins.top; }
  doc.font('NotoSans-Bold').fontSize(10).text(`Tổng số đơn: ${list.length}`, startX, y);

  doc.end();
});

module.exports = router;
