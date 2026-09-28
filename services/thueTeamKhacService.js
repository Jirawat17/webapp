// PDF "THUÊ TEAM KHÁC" (bổ sung 28/09/2026, theo yêu cầu người dùng) — bàn giao đơn cho 1 team thêu bên ngoài: mỗi đơn
// 1 phần riêng (A4 dọc) gồm 10 trường chữ + TOÀN BỘ ảnh PNG (DUONG_DAN_URL) và Mockup (MOCKUP), mỗi ảnh kèm link gốc.
// "Tuyệt đối không thiếu ảnh": ô trống, link hỏng, thư mục rỗng, file không phải ảnh... đều thành 1 mục LỖI — ô đỏ
// ngay tại chỗ ảnh + danh sách đỏ ở trang đầu + trả về cho giao diện (hộp đỏ). Không bao giờ bỏ qua lặng lẽ.
// Ảnh thu nhỏ bằng sharp (giữ tỷ lệ) + nền đen cho PNG trong suốt — cùng cách ảnh đang hiển thị trong app
// (routes/photos.js#nenAnhHienThi, chạy ổn trên production). Route: routes/reports.js POST /thue-team-khac/bat-dau.
const path = require('path');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const { taiAnh } = require('./anhNguonService');
const { layChiTietAnhThuMucDrive, taiFileDriveTheoId } = require('./driveService');
const { dinhDangNgay } = require('./dateUtils');
const nhatKyDbService = require('./nhatKyDbService');

const FONT_REGULAR = path.join(__dirname, '..', 'fonts', 'NotoSans-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'fonts', 'NotoSans-Bold.ttf');
const GHI_CHU_THAM_KHAO = 'Ảnh trên đây chỉ tham khảo, hãy vào link để xem ảnh chi tiết.';
const NGUON_ANH = [{ cot: 'DUONG_DAN_URL', nhan: 'PNG' }, { cot: 'MOCKUP', nhan: 'Mockup' }];
const CANH_DAI_TOI_DA = 1400; // px — đủ nét để tham khảo khi in A4, file không quá nặng
const THOI_GIAN_XU_LY_ANH_MS = 30000;
// ponytail: giới hạn RAM — chỉ ~4 ảnh GỐC (vài MB/ảnh) nằm trong bộ nhớ cùng lúc khi đọc thư mục Drive; ảnh đã thu nhỏ
// (~200KB) vẫn giữ tới khi dựng xong PDF, nên xuất vài trăm ảnh 1 lượt tốn cỡ vài chục-trăm MB — chia lượt nếu VPS yếu.
const SO_ANH_XU_LY_CUNG_LUC = 4;
const TIEU_DE = 'THÔNG TIN ĐƠN HÀNG';
const CO_CHU_LINK = 10.5;

// Mọi link http(s) trong 1 ô — 1 ô có thể chứa nhiều link (xuống dòng/dấu cách/dấu phẩy ngăn cách).
function tachLink(giaTriO) {
  return (String(giaTriO || '').match(/https?:\/\/\S+/gi) || []).map(l => l.replace(/[,;]+$/, ''));
}

// Ghi chú xưởng ĐANG HIỂN THỊ — cùng quy tắc với public/order.html#trangThaiGhiChuXuong: bản trong app chỉ thắng bản
// Sheet Seller khi lần ghi sang Sheet gần nhất bị lỗi, hoặc vừa ghi thành công < 15 phút (Sheet chưa kịp cập nhật).
function ghiChuXuongHienThi(don) {
  const noiBo = don.GHI_CHU_XUONG_NOI_BO || '';
  const sheet = don.GHI_CHU_XUONG || '';
  if (noiBo === sheet) return sheet;
  const gan = nhatKyDbService.layDongBoGanNhat(don.STT_Key, 'GHI_CHU');
  if (!gan) return sheet;
  if (gan.KetQua === 'LOI' || Date.now() - new Date(gan.ThoiGian).getTime() < 15 * 60 * 1000) return noiBo;
  return sheet;
}

// Thu nhỏ (giữ tỷ lệ, không phóng to) + nền đen cho vùng trong suốt + JPEG — nhận mọi định dạng sharp đọc được
// (PNG/JPEG/WEBP/GIF/SVG...). Throw nếu không phải ảnh/ảnh hỏng. Promise.race: sharp kẹt thì không treo cả file.
async function chuanHoaAnh(buffer) {
  const xuLy = sharp(buffer)
    .rotate() // xoay theo EXIF (ảnh chụp điện thoại) — khớp với ảnh khi mở link gốc
    .resize(CANH_DAI_TOI_DA, CANH_DAI_TOI_DA, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#000000' })
    .jpeg({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  let hen;
  try {
    const { data, info } = await Promise.race([
      xuLy,
      new Promise((_, reject) => { hen = setTimeout(() => reject(new Error('xử lý ảnh quá thời gian chờ')), THOI_GIAN_XU_LY_ANH_MS); }),
    ]);
    return { anh: data, rong: info.width, cao: info.height };
  } finally {
    clearTimeout(hen);
  }
}

async function xuLyAnh(moTa, buffer) {
  if (!buffer || !buffer.length) return { ...moTa, loi: 'Không tải được ảnh (link hỏng, chưa chia sẻ quyền xem, hoặc quá thời gian chờ)' };
  try {
    return { ...moTa, ...(await chuanHoaAnh(buffer)) };
  } catch (err) {
    return { ...moTa, loi: `File tải về không đọc được như ảnh (${err.message})` };
  }
}

// 1 link -> [ảnh]: link thư mục Drive -> MỌI ảnh trong thư mục (link riêng từng ảnh + link thư mục); link khác -> 1 ảnh.
async function taiMotLink(link) {
  try {
    const thuMuc = await layChiTietAnhThuMucDrive(link);
    if (thuMuc) {
      if (thuMuc.length === 0) return [{ link, loi: 'Thư mục Drive không có ảnh nào' }];
      const ketQua = [];
      for (let i = 0; i < thuMuc.length; i += SO_ANH_XU_LY_CUNG_LUC) {
        ketQua.push(...await Promise.all(thuMuc.slice(i, i + SO_ANH_XU_LY_CUNG_LUC).map(async f =>
          xuLyAnh({ link: f.link, linkThuMuc: link, ten: f.ten }, await taiFileDriveTheoId(f.id)))));
      }
      return ketQua;
    }
    return [await xuLyAnh({ link }, await taiAnh(link))];
  } catch (err) {
    return [{ link, loi: `Không đọc được link (${err.message})` }];
  }
}

// -> [{ nhan: 'PNG'|'Mockup', anh: [{ link, linkThuMuc?, ten?, anh?, rong?, cao?, loi? }] }]
async function taiAnhCuaDon(don) {
  const ketQua = [];
  for (const { cot, nhan } of NGUON_ANH) {
    const giaTriO = String(don[cot] || '').trim();
    const links = tachLink(giaTriO);
    const anh = [];
    if (!giaTriO) anh.push({ link: '', loi: `Đơn không có link ${nhan} (ô ${cot} trống)` });
    else if (links.length === 0) anh.push({ link: giaTriO, loi: `Ô ${cot} không chứa link http(s) hợp lệ` });
    for (const link of links) anh.push(...await taiMotLink(link));
    ketQua.push({ nhan, anh });
  }
  return ketQua;
}

// ---------- Vẽ PDF ----------
const KHO = [595.28, 841.89]; // A4 dọc (pt)
const LE = 36;
const RONG = KHO[0] - 2 * LE;
const DAY_TRANG = KHO[1] - LE - 14; // chừa chỗ footer
const MAU = { chu: '#111827', mo: '#6b7280', vien: '#d1d5db', do: '#b91c1c', nenDo: '#fee2e2', nenVang: '#fef3c7', nenXanh: '#e0f2fe', link: '#1d4ed8' };

function canCho(doc, cao, tieuDeTiep) {
  if (doc.y + cao <= DAY_TRANG) return;
  doc.addPage();
  if (tieuDeTiep) {
    doc.font('NotoSans-Bold').fontSize(9).fillColor(MAU.mo).text(tieuDeTiep, LE, LE, { width: RONG });
    doc.moveDown(0.4);
  }
}

// 1 dòng bảng thông tin — nhãn trái, giá trị phải, KHÔNG cắt chữ (cao theo nội dung; dài hơn 1 trang thì để PDFKit tự
// chảy sang trang sau, bỏ nền màu).
function veDongThongTin(doc, nhan, giaTri, { noiBat = false, nen = null, coChu = 10 } = {}, tieuDeTiep) {
  const rongNhan = 140;
  const rongGiaTri = RONG - rongNhan - 12;
  const chu = String(giaTri ?? '').trim();
  const font = noiBat ? 'NotoSans-Bold' : 'NotoSans';
  doc.font(font).fontSize(coChu);
  const cao = Math.max(doc.heightOfString(chu || '—', { width: rongGiaTri }), 12) + 10;
  if (cao > DAY_TRANG - LE - 20) { // dài hơn cả 1 trang: in liền mạch, không nền
    doc.font('NotoSans-Bold').fontSize(9).fillColor(MAU.mo).text(nhan, LE, doc.y);
    doc.font(font).fontSize(coChu).fillColor(MAU.chu).text(chu, LE, doc.y, { width: RONG });
    doc.moveDown(0.5);
    return;
  }
  canCho(doc, cao, tieuDeTiep);
  const y = doc.y;
  if (nen) doc.rect(LE, y, RONG, cao).fill(nen);
  doc.moveTo(LE, y + cao).lineTo(LE + RONG, y + cao).lineWidth(0.5).stroke(MAU.vien);
  doc.font('NotoSans-Bold').fontSize(9).fillColor(MAU.mo).text(nhan, LE + 6, y + 6, { width: rongNhan - 6 });
  doc.font(font).fontSize(coChu).fillColor(chu ? MAU.chu : MAU.mo).text(chu || '(không có)', LE + rongNhan + 6, y + 5, { width: rongGiaTri });
  doc.x = LE;
  doc.y = y + cao;
}

const laLinkHttp = link => /^https?:\/\//i.test(link);
function veLink(doc, link, x, rong) {
  doc.font('NotoSans').fontSize(CO_CHU_LINK).fillColor(MAU.link)
    .text(link, x, doc.y, { width: rong, link: laLinkHttp(link) ? link : null, underline: laLinkHttp(link) });
}
// Link ảnh (+ "Nằm trong thư mục:" + link thư mục) — doCaoLink đo ĐÚNG phần veCacLink vẽ.
function doCaoLink(doc, a, rong) {
  doc.font('NotoSans').fontSize(CO_CHU_LINK);
  let cao = a.link ? doc.heightOfString(a.link, { width: rong }) : 0;
  if (a.linkThuMuc) {
    cao += doc.heightOfString(a.linkThuMuc, { width: rong });
    doc.fontSize(9);
    cao += doc.heightOfString('Nằm trong thư mục:', { width: rong });
  }
  return cao;
}
function veCacLink(doc, a, x, rong, mauNhan) {
  if (a.link) veLink(doc, a.link, x, rong);
  if (a.linkThuMuc) {
    doc.font('NotoSans').fontSize(9).fillColor(mauNhan).text('Nằm trong thư mục:', x, doc.y, { width: rong });
    veLink(doc, a.linkThuMuc, x, rong);
  }
}

const CAO_ANH_TOI_DA = 300; // pt — vừa 2 ảnh/trang A4

// Chiều cao cả khối 1 ảnh (nhãn + link + ảnh, hoặc ô đỏ) — để quyết định ngắt trang TRƯỚC khi vẽ (ảnh không bao giờ bị cắt đôi).
function doKhoiAnh(doc, a) {
  const caoLink = doCaoLink(doc, a, a.loi ? RONG - 16 : RONG); // ô đỏ thụt lề 8pt mỗi bên
  if (a.loi) {
    doc.font('NotoSans-Bold').fontSize(10);
    return { caoLink, cao: 18 + doc.heightOfString(`KHÔNG CÓ ẢNH — ${a.loi}`, { width: RONG - 16 }) + caoLink + 16 };
  }
  const tiLe = Math.min(RONG / a.rong, CAO_ANH_TOI_DA / a.cao, 1);
  return { caoLink, rongAnh: a.rong * tiLe, caoAnh: a.cao * tiLe, cao: 16 + caoLink + 6 + a.cao * tiLe + 12 };
}

function veMotAnh(doc, a, nhanAnh, tieuDeTiep) {
  const { cao, rongAnh, caoAnh } = doKhoiAnh(doc, a);
  if (a.loi) {
    canCho(doc, cao, tieuDeTiep);
    const y = doc.y;
    doc.rect(LE, y, RONG, cao).lineWidth(1.5).fillAndStroke(MAU.nenDo, MAU.do);
    doc.font('NotoSans-Bold').fontSize(9).fillColor(MAU.do).text(nhanAnh, LE + 8, y + 6, { width: RONG - 16 });
    doc.font('NotoSans-Bold').fontSize(10).fillColor(MAU.do).text(`KHÔNG CÓ ẢNH — ${a.loi}`, LE + 8, doc.y, { width: RONG - 16 });
    veCacLink(doc, a, LE + 8, RONG - 16, MAU.do);
    doc.x = LE;
    doc.y = y + cao + 10;
    return;
  }
  canCho(doc, cao, tieuDeTiep);
  doc.font('NotoSans-Bold').fontSize(9).fillColor(MAU.chu).text(nhanAnh + (a.ten ? ` — ${a.ten}` : ''), LE, doc.y, { width: RONG });
  veCacLink(doc, a, LE, RONG, MAU.mo);
  const y = doc.y + 4;
  doc.image(a.anh, LE, y, { width: rongAnh, height: caoAnh });
  a.anh = null; // đã nhúng vào PDF — nhả bộ nhớ
  doc.rect(LE, y, rongAnh, caoAnh).lineWidth(0.5).stroke(MAU.vien);
  doc.x = LE;
  doc.y = y + caoAnh + 14;
}

function veHopGhiChuThamKhao(doc) {
  doc.font('NotoSans-Bold').fontSize(11);
  const cao = doc.heightOfString(GHI_CHU_THAM_KHAO, { width: RONG - 20 }) + 14;
  canCho(doc, cao);
  const y = doc.y;
  doc.rect(LE, y, RONG, cao).lineWidth(1.5).fillAndStroke(MAU.nenVang, '#d97706');
  doc.fillColor('#92400e').text(GHI_CHU_THAM_KHAO, LE + 10, y + 7, { width: RONG - 20 });
  doc.x = LE;
  doc.y = y + cao + 10;
}

function veTrangDau(doc, dsDon, { thoiGianXuat, nguoiXuat, dsLoi, tongAnh }) {
  doc.font('NotoSans-Bold').fontSize(18).fillColor(MAU.chu).text(TIEU_DE, LE, LE, { width: RONG, align: 'center' });
  doc.font('NotoSans').fontSize(10).fillColor(MAU.mo)
    .text(`Xuất lúc ${thoiGianXuat} (GMT+7) · Người trích xuất thông tin: ${nguoiXuat} · ${dsDon.length} đơn · ${tongAnh} ảnh`, { width: RONG, align: 'center' });
  doc.moveDown(0.8);
  veHopGhiChuThamKhao(doc);

  if (dsLoi.length) {
    doc.font('NotoSans').fontSize(CO_CHU_LINK);
    const dong = dsLoi.map(l => `• ${l.sttKey} — ${l.nhan}: ${l.loi}${l.link ? `\n   ${l.link}` : ''}`).join('\n');
    const tieuDe = `THIẾU ${dsLoi.length} ẢNH — TÀI LIỆU CHƯA ĐẦY ĐỦ`;
    const cao = doc.heightOfString(dong, { width: RONG - 20 }) + 38;
    if (cao <= DAY_TRANG - doc.y) {
      const y = doc.y;
      doc.rect(LE, y, RONG, cao).lineWidth(2).fillAndStroke(MAU.nenDo, MAU.do);
      doc.font('NotoSans-Bold').fontSize(13).fillColor(MAU.do).text(tieuDe, LE + 10, y + 8, { width: RONG - 20 });
      doc.font('NotoSans').fontSize(CO_CHU_LINK).fillColor(MAU.do).text(dong, LE + 10, doc.y + 2, { width: RONG - 20 });
      doc.x = LE;
      doc.y = y + cao + 10;
    } else { // danh sách quá dài: không khung, để chữ tự chảy sang trang sau
      doc.font('NotoSans-Bold').fontSize(13).fillColor(MAU.do).text(tieuDe, LE, doc.y, { width: RONG });
      doc.font('NotoSans').fontSize(CO_CHU_LINK).fillColor(MAU.do).text(dong, LE, doc.y, { width: RONG });
      doc.moveDown(0.8);
    }
  }

  doc.font('NotoSans-Bold').fontSize(11).fillColor(MAU.chu).text('Danh sách đơn', LE, doc.y);
  doc.moveDown(0.3);
  dsDon.forEach(({ don, nhom }, i) => {
    const dem = nhom.map(g => `${g.anh.filter(a => !a.loi).length} ${g.nhan}`).join(', ');
    const soLoi = nhom.reduce((s, g) => s + g.anh.filter(a => a.loi).length, 0);
    canCho(doc, 16);
    doc.font('NotoSans-Bold').fontSize(9.5).fillColor(MAU.chu).text(`${i + 1}. ${don.STT_Key}`, LE, doc.y, { width: RONG, continued: true })
      .font('NotoSans').fillColor(MAU.mo).text(`  ·  ${don.TEN || '(không tên)'}  ·  ${dem}`, { continued: soLoi > 0 });
    if (soLoi) doc.font('NotoSans-Bold').fillColor(MAU.do).text(`  ·  THIẾU ${soLoi} ẢNH`);
  });
}

function veDon(doc, { don, nhom, ghiChuXuong }, thuTu, tong) {
  doc.addPage();
  const tieuDeTiep = `ĐƠN ${thuTu}/${tong} · ${don.STT_Key} (tiếp)`;
  const y = doc.y;
  doc.rect(LE, y, RONG, 30).fill(MAU.chu);
  doc.font('NotoSans-Bold').fontSize(15).fillColor('#ffffff').text(`ĐƠN ${thuTu}/${tong} · ${don.STT_Key}`, LE + 10, y + 6, { width: RONG - 20 });
  doc.x = LE;
  doc.y = y + 36;

  veDongThongTin(doc, 'Mã đơn hàng (STT_Key)', don.STT_Key, { noiBat: true, nen: MAU.nenXanh, coChu: 14 }, tieuDeTiep);
  veDongThongTin(doc, 'Tên khách hàng (TEN)', don.TEN, { noiBat: true, nen: MAU.nenXanh, coChu: 13 }, tieuDeTiep);
  veDongThongTin(doc, 'Ngày lên đơn', dinhDangNgay(don.NGAY_LEN_DON) || don.NGAY_LEN_DON, {}, tieuDeTiep);
  veDongThongTin(doc, 'Số lượng', don.SO_LUONG, { noiBat: true }, tieuDeTiep);
  veDongThongTin(doc, 'Loại', don.LOAI, {}, tieuDeTiep);
  veDongThongTin(doc, 'Kích thước', don.KICH_THUOC, {}, tieuDeTiep);
  veDongThongTin(doc, 'Màu sắc', don.MAU_SAC, {}, tieuDeTiep);
  veDongThongTin(doc, 'Vị trí thêu (VI_TRI_1)', don.VI_TRI_1, {}, tieuDeTiep);
  veDongThongTin(doc, 'Ghi chú', don.GHI_CHU, { noiBat: true, nen: MAU.nenVang, coChu: 12 }, tieuDeTiep);
  veDongThongTin(doc, 'Ghi chú xưởng', ghiChuXuong, { noiBat: true, nen: MAU.nenVang, coChu: 11 }, tieuDeTiep);
  doc.moveDown(0.8);
  veHopGhiChuThamKhao(doc);

  for (const g of nhom) {
    canCho(doc, 24 + doKhoiAnh(doc, g.anh[0]).cao, tieuDeTiep); // tiêu đề nhóm không nằm lẻ cuối trang
    doc.font('NotoSans-Bold').fontSize(12).fillColor(MAU.chu).text(`ẢNH ${g.nhan.toUpperCase()} (${g.anh.length})`, LE, doc.y, { width: RONG });
    doc.moveDown(0.3);
    g.anh.forEach((a, i) => veMotAnh(doc, a, `${g.nhan} ${i + 1}/${g.anh.length}`, tieuDeTiep));
  }
}

// dsDonGoc: đơn theo ĐÚNG thứ tự cần in. onTienDo() sau mỗi đơn tải xong ảnh; kiemTraHuy() true -> dừng (trả null).
// -> { buffer, dsLoi: [{ sttKey, nhan, link, loi }], tongAnh } | null (đã huỷ)
async function taoPdfThueTeamKhac(dsDonGoc, { thoiGianXuat, nguoiXuat, onTienDo, kiemTraHuy } = {}) {
  const dsDon = [];
  for (const don of dsDonGoc) {
    if (kiemTraHuy && kiemTraHuy()) return null;
    dsDon.push({ don, nhom: await taiAnhCuaDon(don), ghiChuXuong: ghiChuXuongHienThi(don) });
    if (onTienDo) onTienDo();
  }
  const dsLoi = dsDon.flatMap(({ don, nhom }) => nhom.flatMap(g => g.anh.filter(a => a.loi).map(a => ({ sttKey: don.STT_Key, nhan: g.nhan, link: a.link, loi: a.loi }))));
  const tongAnh = dsDon.reduce((s, d) => s + d.nhom.reduce((t, g) => t + g.anh.filter(a => !a.loi).length, 0), 0);

  const doc = new PDFDocument({ size: KHO, margins: { top: LE, bottom: LE, left: LE, right: LE }, bufferPages: true, info: { Title: TIEU_DE } });
  doc.registerFont('NotoSans', FONT_REGULAR);
  doc.registerFont('NotoSans-Bold', FONT_BOLD);
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const xong = new Promise(resolve => doc.on('end', resolve));

  veTrangDau(doc, dsDon, { thoiGianXuat, nguoiXuat, dsLoi, tongAnh });
  dsDon.forEach((d, i) => veDon(doc, d, i + 1, dsDon.length));

  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // viết footer sát đáy không tự sinh trang mới
    doc.font('NotoSans').fontSize(7.5).fillColor(MAU.mo)
      .text(`${TIEU_DE} · xuất lúc ${thoiGianXuat} · trang ${i + 1}/${count}`, LE, KHO[1] - LE + 8, { width: RONG, align: 'center', lineBreak: false });
  }
  doc.end();
  await xong;
  return { buffer: Buffer.concat(chunks), dsLoi, tongAnh };
}

module.exports = { taoPdfThueTeamKhac, tachLink, ghiChuXuongHienThi, GHI_CHU_THAM_KHAO };
