const express = require('express');
const router = express.Router();
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const orderService = require('../services/orderService');
const { layDanhSachKhachHang } = require('../services/khachHangService');
const { parseNgay, dinhDangNgay, dinhDangNgayGioVN } = require('../services/dateUtils');
const { taoQRCodeBuffer } = require('../services/qrService');
const { taiAnhTuLinkDrive } = require('../services/driveService');
const { DANH_SACH_TRANG_THAI_BAO_CAO } = require('../data/pipelineTinhTrang');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin); // mọi vai trò đăng nhập đều dùng được trang Báo cáo

const FONT_REGULAR = path.join(__dirname, '..', 'fonts', 'NotoSans-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'fonts', 'NotoSans-Bold.ttf');

// 3 trạng thái có mẫu xuất RIÊNG — mọi trạng thái khác (kể cả không chọn gì) dùng mẫu mặc định
// (danh sách chi tiết từng đơn). Khớp chính xác chuỗi trong data/pipelineTinhTrang.js.
const TRANG_THAI_TRACKING = 'B5_Đã sản xuất';
const TRANG_THAI_GOP_PHOI_AO = 'B1_Đã in';
const TRANG_THAI_DON_CAN_IN = 'B2_Đã lấy phôi';

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

async function layDonDaLoc(query) {
  const { rows } = await orderService.getAll();
  return locDon(rows, query);
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

// ============================================================
// MẪU "ĐƠN CẦN IN" (B2_Đã lấy phôi) — mỗi đơn 1 thẻ có QR + 2 ảnh thật, khổ giấy 100x150mm
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
  const leTrong = 6;
  const x0 = leTrong;
  const rongTrong = rong - leTrong * 2;
  let y = offsetY + leTrong;

  doc.font('NotoSans-Bold').fontSize(11).text(don.STT_Key || '', x0, y, { width: rongTrong });
  y += 14;
  doc.font('NotoSans').fontSize(8.5).text(`${don.LOAI || ''} · ${don.KICH_THUOC || ''} · ${don.MAU_SAC || ''}`, x0, y, { width: rongTrong });
  y += 13;

  // QR chiếm phần lớn không gian còn lại — ưu tiên "to rõ" theo yêu cầu, tận dụng hết chiều cao thẻ
  const qrKichThuoc = mmToPt(42);
  const qrX = x0;
  const qrY = y;
  if (anh.qr) doc.image(anh.qr, qrX, qrY, { width: qrKichThuoc, height: qrKichThuoc });
  else veOTrongPdf(doc, qrX, qrY, qrKichThuoc, 'Không có QR');

  const anhKichThuoc = mmToPt(20); // 2 ảnh xếp chồng + khoảng cách phải khớp chiều cao QR, tránh chồng lên chữ bên dưới
  const anhX = qrX + qrKichThuoc + 6;
  const anhY1 = qrY;
  if (anh.mau) {
    try { doc.image(anh.mau, anhX, anhY1, { fit: [anhKichThuoc, anhKichThuoc] }); }
    catch (e) { veOTrongPdf(doc, anhX, anhY1, anhKichThuoc, 'Không tải được ảnh mẫu'); }
  } else {
    veOTrongPdf(doc, anhX, anhY1, anhKichThuoc, 'Không tải được ảnh mẫu');
  }

  const anhY2 = anhY1 + anhKichThuoc + 6;
  if (anh.mockup) {
    try { doc.image(anh.mockup, anhX, anhY2, { fit: [anhKichThuoc, anhKichThuoc] }); }
    catch (e) { veOTrongPdf(doc, anhX, anhY2, anhKichThuoc, 'Không tải được ảnh mockup'); }
  } else {
    veOTrongPdf(doc, anhX, anhY2, anhKichThuoc, 'Không tải được ảnh mockup');
  }

  // Chiều cao thật của khối ảnh = phần cao hơn giữa QR và 2 ảnh xếp chồng — tránh chữ bên dưới
  // đè lên ảnh nếu 1 trong 2 khối cao hơn khối còn lại (lỗi đã xảy ra khi kích thước lệch nhau).
  const chieuCaoKhoiAnh = Math.max(qrKichThuoc, anhKichThuoc * 2 + 6);
  y = qrY + chieuCaoKhoiAnh + 8;

  const viTri = [don.VI_TRI_1, don.VI_TRI_2, don.VI_TRI_3].filter(Boolean).join(' · ');
  doc.font('NotoSans-Bold').fontSize(7.5).text('Vị trí thêu: ', x0, y, { continued: true, width: rongTrong });
  doc.font('NotoSans').text(viTri || '—');
  y += 11;
  doc.font('NotoSans').fontSize(7.5).text(`SL: ${don.SO_LUONG ?? ''} · SL áo/đơn: ${don.SO_LUONG_AO_TREN_DON ?? ''} · Ngày: ${dinhDangNgay(don.NGAY_LEN_DON)}`, x0, y, { width: rongTrong });
  y += 11;
  if (don.GHI_CHU) {
    doc.font('NotoSans-Bold').fontSize(7.5).text('Ghi chú: ', x0, y, { continued: true, width: rongTrong });
    doc.font('NotoSans').text(String(don.GHI_CHU), { width: rongTrong });
  }
}

async function veTrangDonCanInPdf(doc, list, dongNguoiXuat) {
  const rong = mmToPt(KHO_GIAY_MM.rong);
  const cao = mmToPt(KHO_GIAY_MM.cao);
  const caoFooter = 9;
  const caoThe = (cao - caoFooter) / 2;

  for (let i = 0; i < list.length; i += 2) {
    if (i > 0) doc.addPage({ size: [rong, cao], margin: 0 });

    const anh1 = await taiAnhChoDon(list[i]);
    veTheDonPdf(doc, list[i], anh1, 0, caoThe);

    doc.dash(2, { space: 2 }).moveTo(0, caoThe).lineTo(rong, caoThe).stroke('#9ca3af');
    doc.undash();

    if (list[i + 1]) {
      const anh2 = await taiAnhChoDon(list[i + 1]);
      veTheDonPdf(doc, list[i + 1], anh2, caoThe, caoThe);
    }

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

router.get('/xem-truoc', async (req, res) => {
  const list = await layDonDaLoc(req.query);

  if (req.query.trangThai === TRANG_THAI_DON_CAN_IN) {
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

  if (req.query.trangThai === TRANG_THAI_DON_CAN_IN) {
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

  if (req.query.trangThai === TRANG_THAI_DON_CAN_IN) {
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
