const ExcelJS = require('exceljs');
const db = require('./thuVienDbService');
const { laLink, tachLink, uuTienCuaLink } = require('./xuLyService');

// Nhập Excel đơn cũ (03/10/2026, spec mục 12) — file xuất từ Sheet, đọc đúng 2 cột tiêu đề STT_Key + DUONG_DAN_URL
// (trim, không phân biệt hoa thường), các cột khác bỏ qua. Tìm ở MỌI sheet trong file, 10 dòng đầu mỗi sheet.
const COT_KHOA = 'stt_key';
const COT_LINK = 'duong_dan_url';
const SO_DONG_DO_TIEU_DE = 10;
const SO_DONG_MOI_DOT = 5000; // mỗi đợt ghi SQLite ~40ms — app vẫn phục vụ request khác trong lúc nhập file lớn

// Giá trị ô -> chuỗi. Link: ưu tiên địa chỉ thật của hyperlink (ô hiển thị chữ khác link).
function chuoiO(o, layHyperlink) {
  const v = o.value;
  if (v === null || v === undefined) return '';
  if (typeof v !== 'object') return String(v).trim();
  if (v instanceof Date) return v.toISOString();
  if (layHyperlink && v.hyperlink) return String(v.hyperlink).trim();
  if (layHyperlink && v.formula) { // =HYPERLINK("url"; "chữ") — giá trị hiển thị chỉ là chữ, link nằm trong công thức
    const m = String(v.formula).match(/HYPERLINK\(\s*"([^"]+)"/i);
    if (m) return m[1].trim();
  }
  if (v.richText) return v.richText.map(r => r.text).join('').trim();
  if (v.text !== undefined) return String(typeof v.text === 'object' && v.text.richText ? v.text.richText.map(r => r.text).join('') : v.text).trim();
  if (v.result !== undefined) return String(v.result).trim();
  return '';
}

// -> { dsDong: [{ dong, sttKey, url, lyDo }], dsViec: [{ sttKey, url, nguon, nguoi, uuTien }], tongDong, tenSheet }
async function docExcel(buffer, nguoi) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch (err) { throw new Error('Không đọc được file Excel (.xlsx): ' + err.message); }

  for (const ws of wb.worksheets) {
    for (let r = 1; r <= Math.min(SO_DONG_DO_TIEU_DE, ws.rowCount); r++) {
      let cotKhoa = 0, cotLink = 0;
      ws.getRow(r).eachCell((o, c) => {
        const ten = chuoiO(o, false).toLowerCase();
        if (ten === COT_KHOA) cotKhoa = c;
        if (ten === COT_LINK) cotLink = c;
      });
      if (!cotKhoa || !cotLink) continue;

      const dsDong = [], dsViec = [];
      let tongDong = 0;
      for (let i = r + 1; i <= ws.rowCount; i++) {
        const row = ws.getRow(i);
        const sttKey = chuoiO(row.getCell(cotKhoa), false);
        const giaTriLink = chuoiO(row.getCell(cotLink), true);
        if (!sttKey && !giaTriLink) continue; // dòng trống hẳn — không tính
        tongDong++;
        if (!sttKey) { dsDong.push({ dong: i, sttKey: '', url: '', lyDo: 'Thiếu STT_Key' }); continue; }
        if (!giaTriLink) { dsDong.push({ dong: i, sttKey, url: '', lyDo: 'Không có link PNG' }); continue; }
        // Ô có link thì chỉ lấy các link (chữ mô tả đi kèm bỏ qua); ô không có link nào -> 1 dòng lý do cho cả ô.
        const links = tachLink(giaTriLink).filter(laLink);
        if (!links.length) { dsDong.push({ dong: i, sttKey, url: '', lyDo: `Không phải link: ${giaTriLink.slice(0, 100)}` }); continue; }
        for (const url of links) {
          dsDong.push({ dong: i, sttKey, url, lyDo: '' });
          dsViec.push({ sttKey, url, nguon: 'EXCEL', nguoi, uuTien: uuTienCuaLink(url) });
        }
      }
      return { dsDong, dsViec, tongDong, tenSheet: ws.name };
    }
  }
  throw new Error('Không tìm thấy dòng tiêu đề có đủ 2 cột STT_Key và DUONG_DAN_URL (xét 10 dòng đầu của mọi sheet).');
}

async function nhapExcel(buffer, tenFile, nguoi) {
  const { dsDong, dsViec: dsViecTho, tongDong, tenSheet } = await docExcel(buffer, nguoi);
  if (!tongDong) throw new Error(`Sheet "${tenSheet}" không có dòng dữ liệu nào dưới tiêu đề.`);
  // Cùng (STT_Key, link) lặp ở nhiều dòng trong 1 file = 1 việc — bỏ trùng TRƯỚC khi đếm, để "đã có từ trước" chỉ đếm link
  // thật sự có sẵn trong hàng chờ từ lần nhập/cron trước, không lẫn dòng lặp trong chính file này.
  const dsViec = [...new Map(dsViecTho.map(v => [v.sttKey + '\n' + v.url, v])).values()];
  // Ghi từng đợt, nhả luồng chính giữa các đợt (xem thuVienDbService.js#taoLo). Việc phải vào hàng chờ TRƯỚC dòng lô (dòng
  // lô tra viec_id của việc).
  const loId = db.taoLo({ tenFile, nguoi, tongDong });
  const nhaLuong = () => new Promise(r => setImmediate(r));
  let soViecMoi = 0;
  for (let i = 0; i < dsViec.length; i += SO_DONG_MOI_DOT) { soViecMoi += db.themNhieuViec(dsViec.slice(i, i + SO_DONG_MOI_DOT)); await nhaLuong(); }
  for (let i = 0; i < dsDong.length; i += SO_DONG_MOI_DOT) { db.themDongLo(loId, dsDong.slice(i, i + SO_DONG_MOI_DOT)); await nhaLuong(); }
  db.datSoViecMoiLo(loId, soViecMoi);
  return {
    loId, tenSheet, tongDong, soLink: dsViec.length, soViecMoi,
    soViecDaCo: dsViec.length - soViecMoi,
    soDongBoQua: new Set(dsDong.filter(d => d.lyDo).map(d => d.dong)).size,
  };
}

const NHAN_TRANG_THAI = {
  CHO: 'Đang chờ', DANG_CHAY: 'Đang tải', XONG: 'Thành công', LOI: 'Lỗi — sẽ tự thử lại', LOI_CUOI: 'Lỗi',
};

// Ghi file kết quả .xlsx THẲNG ra stream (response) theo từng trang 2.000 dòng, nhả luồng chính giữa các trang
// (03/10/2026, rà soát chống nghẽn — đo bản cũ dựng cả workbook trong RAM: lô 180.000 dòng mất 4,6 giây, RSS 2GB, chặn luồng
// chính LIÊN TỤC 3,5 giây = cả app đứng hình). Bản ghi luồng của exceljs (WorkbookWriter) khác bản ĐỌC luồng bị lỗi.
const SO_DONG_MOI_TRANG = 2000;
async function guiFileKetQua(loId, stream) {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true });
  const ws = wb.addWorksheet('Ket qua');
  ws.columns = [
    { header: 'Dòng', key: 'dong', width: 8 },
    { header: 'STT_Key', key: 'stt', width: 16 },
    { header: 'Link', key: 'url', width: 60 },
    { header: 'Trạng thái', key: 'tt', width: 22 },
    { header: 'Số ảnh đã lưu', key: 'so', width: 14 },
    { header: 'Lý do / ghi chú', key: 'ly', width: 80 },
  ];
  ws.getRow(1).font = { bold: true };
  let sau;
  for (;;) {
    const trang = db.trangKetQuaLo(loId, sau, SO_DONG_MOI_TRANG);
    for (const d of trang) {
      const tt = d.ly_do ? 'Bỏ qua' : NHAN_TRANG_THAI[d.trang_thai] || d.trang_thai || '';
      const lyDo = d.ly_do || [d.loi_cuoi, d.ghi_chu].filter(Boolean).join(' | ')
        || (d.trang_thai === 'XONG' && !d.so_file ? 'Ảnh đã có sẵn trong thư viện (trùng file)' : '');
      ws.addRow({ dong: d.dong, stt: d.stt_key, url: d.url, tt, so: d.ly_do ? '' : d.so_file || 0, ly: lyDo }).commit();
    }
    if (trang.length < SO_DONG_MOI_TRANG) break;
    const cuoi = trang[trang.length - 1];
    sau = { dong: cuoi.dong, rowid: cuoi.rowid_dong };
    await new Promise(r => setImmediate(r)); // nhả luồng chính cho request khác
  }
  ws.commit();
  await wb.commit();
}

module.exports = { docExcel, nhapExcel, guiFileKetQua };
