// PDF "THUÊ TEAM KHÁC" (bổ sung 28/09/2026, theo yêu cầu người dùng) — bàn giao đơn cho 1 team thêu bên ngoài: mỗi đơn
// ĐÚNG 1 trang A4 dọc gồm 10 trường chữ + TOÀN BỘ ảnh PNG (DUONG_DAN_URL) và Mockup (MOCKUP), mỗi ảnh kèm link gốc.
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

// Chỉ dùng ở trang đầu (danh sách đơn có thể dài nhiều trang) — trang đơn tự xếp vừa 1 trang, xem veDon.
function canCho(doc, cao) {
  if (doc.y + cao > DAY_TRANG) doc.addPage();
}

// ---------- Trang đơn: 1 đơn = ĐÚNG 1 trang A4 (28/09/2026, theo yêu cầu người dùng — trước đó ảnh cao tối đa 300pt
// xếp dọc, đơn 2+ ảnh tràn sang nhiều trang) ----------
// Bố cục: thanh tiêu đề → bảng thông tin (ô nhãn-trên-giá-trị, trường ngắn ghép chung hàng) → hộp "chỉ tham khảo" → link
// thư mục Drive (mỗi thư mục 1 lần) → LƯỚI ảnh lấp hết phần còn lại, số cột chọn sao cho tổng diện tích ảnh lớn nhất.
// Không vừa thì thu nhỏ chữ dần; mọi lệnh text trên trang đơn đều có `height` → PDFKit không bao giờ tự sinh trang mới.
const KHE = 8; // khoảng cách giữa các ô ảnh
const CAO_ANH_TOI_THIEU = 40;
const CAC_TI_LE_CHU = [1, 0.9, 0.8, 0.7, 0.6, 0.5];
const CAO_TIEU_DE_DON = 28;
const laLinkHttp = link => /^https?:\/\//i.test(link);

// Viết chữ từ doc.y, không vượt quá `day` — hết chỗ thì cắt bằng "…" (chỉ xảy ra khi phải ép vừa trang, xem veDon).
function vietGioiHan(doc, chu, x, rong, day, font, co, mau, them = {}) {
  const conLai = day - doc.y + 1;
  if (conLai < co) return;
  doc.font(font).fontSize(co).fillColor(mau).text(chu, x, doc.y, { width: rong, height: conLai, ellipsis: true, ...them });
}

const oTT = (nhan, giaTri, { dam = false, co = 10, nen = null } = {}) => ({ nhan, chu: String(giaTri ?? '').trim(), dam, co, nen });
function cacHangThongTin(don, ghiChuXuong) {
  return [
    [oTT('Mã đơn hàng (STT_Key)', don.STT_Key, { dam: true, co: 14, nen: MAU.nenXanh }), oTT('Tên khách hàng (TEN)', don.TEN, { dam: true, co: 13, nen: MAU.nenXanh })],
    [oTT('Ngày lên đơn', dinhDangNgay(don.NGAY_LEN_DON) || don.NGAY_LEN_DON), oTT('Số lượng', don.SO_LUONG, { dam: true }), oTT('Kích thước', don.KICH_THUOC), oTT('Màu sắc', don.MAU_SAC)],
    [oTT('Loại', don.LOAI), oTT('Vị trí thêu (VI_TRI_1)', don.VI_TRI_1)],
    [oTT('Ghi chú', don.GHI_CHU, { dam: true, co: 12, nen: MAU.nenVang })],
    [oTT('Ghi chú xưởng', ghiChuXuong, { dam: true, co: 11, nen: MAU.nenVang })],
  ];
}
function doHang(doc, hang, s) {
  const rong = RONG / hang.length - 10;
  return Math.max(...hang.map(o => {
    doc.font('NotoSans-Bold').fontSize(8 * s);
    const caoNhan = doc.heightOfString(o.nhan, { width: rong });
    doc.font(o.dam ? 'NotoSans-Bold' : 'NotoSans').fontSize(o.co * s);
    return 4 + caoNhan + 2 + doc.heightOfString(o.chu || '(không có)', { width: rong }) + 5;
  }));
}
function veHang(doc, hang, y, cao, s) {
  const rong = RONG / hang.length;
  hang.forEach((o, i) => {
    const x = LE + i * rong;
    if (o.nen) doc.rect(x, y, rong, cao).fill(o.nen);
    doc.rect(x, y, rong, cao).lineWidth(0.5).stroke(MAU.vien);
    doc.y = y + 4;
    vietGioiHan(doc, o.nhan, x + 5, rong - 10, y + cao, 'NotoSans-Bold', 8 * s, MAU.mo);
    doc.y += 2;
    vietGioiHan(doc, o.chu || '(không có)', x + 5, rong - 10, y + cao - 4, o.dam ? 'NotoSans-Bold' : 'NotoSans', o.co * s, o.chu ? MAU.chu : MAU.mo);
  });
}

// 1 mục lưới = 1 ảnh (hoặc 1 ô đỏ "KHÔNG CÓ ẢNH"): nhãn + [lỗi] + link gốc. doChuMuc đo ĐÚNG phần veChuMuc vẽ.
function doChuMuc(doc, m, rong, s) {
  doc.font('NotoSans-Bold').fontSize(9 * s);
  let cao = doc.heightOfString(m.nhan, { width: rong });
  if (m.a.loi) { doc.fontSize(10 * s); cao += doc.heightOfString(`KHÔNG CÓ ẢNH — ${m.a.loi}`, { width: rong }); }
  if (m.a.link) { doc.font('NotoSans').fontSize(CO_CHU_LINK * s); cao += doc.heightOfString(m.a.link, { width: rong }); }
  return cao;
}
function veChuMuc(doc, m, x, y, rong, day, s) {
  doc.y = y;
  vietGioiHan(doc, m.nhan, x, rong, day, 'NotoSans-Bold', 9 * s, m.a.loi ? MAU.do : MAU.chu);
  if (m.a.loi) vietGioiHan(doc, `KHÔNG CÓ ẢNH — ${m.a.loi}`, x, rong, day, 'NotoSans-Bold', 10 * s, MAU.do);
  if (m.a.link) vietGioiHan(doc, m.a.link, x, rong, day, 'NotoSans', CO_CHU_LINK * s, MAU.link, laLinkHttp(m.a.link) ? { link: m.a.link, underline: true } : {});
}

// Lưới `cot` cột: hàng CHỈ có ô đỏ cao vừa đủ chữ, các hàng có ảnh chia đều phần còn lại. `vua` = mọi ảnh còn cao
// ≥ CAO_ANH_TOI_THIEU và mọi ô đỏ đủ chỗ; `dienTich` = tổng diện tích ảnh (để so các số cột).
function thuLuoi(doc, dsMuc, caoVung, s, cot) {
  const rong = (RONG - (cot - 1) * KHE) / cot;
  const caoO = m => doChuMuc(doc, m, rong - 12, s) + 12; // ô đỏ
  const cacHang = [];
  for (let i = 0; i < dsMuc.length; i += cot) cacHang.push(dsMuc.slice(i, i + cot));
  const caoCoDinh = cacHang.map(h => (h.every(m => m.a.loi) ? Math.max(...h.map(caoO)) : 0));
  const soHangAnh = caoCoDinh.filter(c => !c).length;
  const caoHangAnh = soHangAnh && (caoVung - (cacHang.length - 1) * KHE - caoCoDinh.reduce((a, b) => a + b, 0)) / soHangAnh;
  const caoHang = caoCoDinh.map(c => c || caoHangAnh);
  let dienTich = 0;
  let vua = caoCoDinh.reduce((a, b) => a + b, 0) + (cacHang.length - 1) * KHE <= caoVung;
  for (const m of soHangAnh ? dsMuc : []) {
    if (m.a.loi) { vua = vua && caoO(m) <= caoHangAnh; continue; }
    const caoAnh = caoHangAnh - doChuMuc(doc, m, rong, s) - 4;
    vua = vua && caoAnh >= CAO_ANH_TOI_THIEU;
    const k = Math.min(rong / m.a.rong, Math.max(caoAnh, 0) / m.a.cao, 1);
    dienTich += m.a.rong * m.a.cao * k * k;
  }
  return { cot, rong, caoCacHang: caoHang, vua, dienTich };
}
// Thử 1..8 cột, lấy cách vừa trang có tổng diện tích ảnh lớn nhất. null nếu không cách nào vừa với cỡ chữ `s`.
function chonLuoi(doc, dsMuc, caoVung, s) {
  let tot = null;
  for (let cot = 1; cot <= Math.min(dsMuc.length, 8); cot++) {
    const l = thuLuoi(doc, dsMuc, caoVung, s, cot);
    if (l.vua && (!tot || l.dienTich > tot.dienTich)) tot = l;
  }
  return tot;
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
  const hangTT = cacHangThongTin(don, ghiChuXuong);
  const dsMuc = nhom.flatMap(g => g.anh.map((a, i) => ({ a, nhan: `${g.nhan} ${i + 1}/${g.anh.length}${a.ten ? ` — ${a.ten}` : ''}` })));
  const dsThuMuc = nhom.flatMap(g => [...new Set(g.anh.map(a => a.linkThuMuc).filter(Boolean))]
    .map(link => ({ nhan: `Thư mục Drive chứa ảnh ${g.nhan}:`, link })));

  const doBoCuc = s => {
    const caoHang = hangTT.map(h => doHang(doc, h, s));
    doc.font('NotoSans-Bold').fontSize(10 * s);
    const caoGhiChu = doc.heightOfString(GHI_CHU_THAM_KHAO, { width: RONG - 16 }) + 8;
    const caoThuMuc = dsThuMuc.reduce((t, d) => {
      doc.font('NotoSans-Bold').fontSize(8.5 * s);
      t += doc.heightOfString(d.nhan, { width: RONG });
      doc.font('NotoSans').fontSize(CO_CHU_LINK * s);
      return t + doc.heightOfString(d.link, { width: RONG });
    }, 0);
    const yLuoi = LE + CAO_TIEU_DE_DON + 4 + caoHang.reduce((a, b) => a + b, 0) + 6 + caoGhiChu + 6 + caoThuMuc + (caoThuMuc ? 6 : 0);
    return { s, caoHang, caoGhiChu, yLuoi, luoi: chonLuoi(doc, dsMuc, DAY_TRANG - yLuoi, s) };
  };
  let bo;
  for (const s of CAC_TI_LE_CHU) {
    bo = doBoCuc(s);
    if (bo.luoi) break;
  }
  if (!bo.luoi) {
    // ponytail: ép vừa 1 trang khi chữ nhỏ nhất vẫn không đủ chỗ (ghi chú dài hàng nghìn chữ / hàng chục ảnh) — bảng
    // thông tin tối đa ~45% trang, lưới vuông; phần chữ không còn chỗ bị cắt "…" (ảnh vẫn luôn được vẽ).
    // Chỉ thu hàng DÀI (ghi chú); hàng ngắn (Mã đơn, Tên, Size, Màu...) giữ nguyên để không mất chữ.
    const toiDa = (DAY_TRANG - LE) * 0.45;
    const tong = ds => ds.reduce((a, b) => a + b, 0);
    const tongHang = tong(bo.caoHang);
    if (tongHang > toiDa) {
      const laHangNgan = h => h <= 60;
      const caoNgan = tong(bo.caoHang.filter(laHangNgan));
      const tiLe = Math.max(toiDa - caoNgan, 0) / (tongHang - caoNgan);
      bo.caoHang = bo.caoHang.map(h => (laHangNgan(h) ? h : h * tiLe));
      bo.yLuoi -= tongHang - tong(bo.caoHang);
    }
    // Mọi hàng cao BẰNG NHAU, cộng lại đúng phần còn lại của trang (hàng chỉ có ô đỏ cũng không được cao hơn) — ô
    // đỏ/chữ trong ô bị cắt vừa ô, ảnh luôn còn chỗ (xem vòng vẽ bên dưới).
    const cot = Math.ceil(Math.sqrt(dsMuc.length));
    const soHang = Math.ceil(dsMuc.length / cot);
    const caoHang = Math.max((DAY_TRANG - bo.yLuoi - (soHang - 1) * KHE) / soHang, 12);
    bo.luoi = { cot, rong: (RONG - (cot - 1) * KHE) / cot, caoCacHang: Array(soHang).fill(caoHang) };
  }
  const { s, caoHang, caoGhiChu, yLuoi, luoi } = bo;

  doc.rect(LE, LE, RONG, CAO_TIEU_DE_DON).fill(MAU.chu);
  doc.y = LE + 5;
  vietGioiHan(doc, `ĐƠN ${thuTu}/${tong} · ${don.STT_Key}`, LE + 10, RONG - 20, LE + CAO_TIEU_DE_DON, 'NotoSans-Bold', 14, '#ffffff');
  let y = LE + CAO_TIEU_DE_DON + 4;
  hangTT.forEach((h, i) => { veHang(doc, h, y, caoHang[i], s); y += caoHang[i]; });
  y += 6;
  doc.rect(LE, y, RONG, caoGhiChu).lineWidth(1.5).fillAndStroke(MAU.nenVang, '#d97706');
  doc.y = y + 4;
  vietGioiHan(doc, GHI_CHU_THAM_KHAO, LE + 8, RONG - 16, y + caoGhiChu, 'NotoSans-Bold', 10 * s, '#92400e');
  doc.y = y + caoGhiChu + 6;
  for (const d of dsThuMuc) {
    vietGioiHan(doc, d.nhan, LE, RONG, yLuoi, 'NotoSans-Bold', 8.5 * s, MAU.mo);
    vietGioiHan(doc, d.link, LE, RONG, yLuoi, 'NotoSans', CO_CHU_LINK * s, MAU.link, { link: d.link, underline: true });
  }

  const yHang = luoi.caoCacHang.map((_, h) => yLuoi + luoi.caoCacHang.slice(0, h).reduce((a, b) => a + b + KHE, 0));
  dsMuc.forEach((m, i) => {
    const hang = Math.floor(i / luoi.cot);
    const [x, yO, caoO] = [LE + (i % luoi.cot) * (luoi.rong + KHE), yHang[hang], luoi.caoCacHang[hang]];
    if (m.a.loi) {
      const caoDo = Math.min(doChuMuc(doc, m, luoi.rong - 12, s) + 12, caoO);
      doc.rect(x, yO, luoi.rong, caoDo).lineWidth(1.5).fillAndStroke(MAU.nenDo, MAU.do);
      veChuMuc(doc, m, x + 6, yO + 6, luoi.rong - 12, yO + caoDo - 6, s);
      return;
    }
    const caoChu = Math.min(doChuMuc(doc, m, luoi.rong, s), caoO - 4 - Math.min(CAO_ANH_TOI_THIEU, caoO * 0.6));
    veChuMuc(doc, m, x, yO, luoi.rong, yO + caoChu, s);
    const caoAnh = Math.max(caoO - caoChu - 4, 1);
    const k = Math.min(luoi.rong / m.a.rong, caoAnh / m.a.cao, 1);
    const [rongAnh, caoAnhThat] = [m.a.rong * k, m.a.cao * k];
    const xAnh = x + (luoi.rong - rongAnh) / 2; // căn giữa trong ô
    doc.image(m.a.anh, xAnh, yO + caoChu + 4, { width: rongAnh, height: caoAnhThat });
    doc.rect(xAnh, yO + caoChu + 4, rongAnh, caoAnhThat).lineWidth(0.5).stroke(MAU.vien);
    m.a.anh = null; // đã nhúng vào PDF — nhả bộ nhớ
  });
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

module.exports = { taoPdfThueTeamKhac, tachLink, ghiChuXuongHienThi, chuanHoaAnh, GHI_CHU_THAM_KHAO }; // chuanHoaAnh: dùng lại ở services/qc/qcService.js (QC2)
