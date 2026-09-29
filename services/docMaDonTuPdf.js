// Đọc mã đơn (STT_Key) trong 1 file PDF (29/09/2026, theo yêu cầu người dùng) — nút "IN ĐƠN TỪ FILE PHÔI" ở Danh
// sách đơn hàng nhận file DSPhoiAoTongHop.pdf do chính hệ thống xuất, đọc các mã đơn trong đó để in DonCanIn.
// pdf-lib (đã có sẵn) lo phần cấu trúc/giải nén; ở đây tự giải mã chữ qua bảng ToUnicode của font — đủ cho PDF có lớp
// chữ (PDFKit, "Lưu PDF" của trình duyệt). File scan/ảnh chụp không có lớp chữ -> không đọc được mã nào.
// ponytail: bỏ qua chữ nằm trong Form XObject và font thiếu ToUnicode (ngoài mã 1 byte Latin) — thêm khi gặp file thật.
const { PDFDocument, PDFName, PDFDict, PDFArray, decodePDFRawStream } = require('pdf-lib');

// Mã đơn: <tháng 1-2 số><mã khách chữ cái><số thứ tự>[.n | ,n] — vd 9SON186, 10LH5, 9F13.1, 9F13,2.
const MAU_STT_KEY = /^\d{1,2}[A-Za-z]+\d+(?:[.,]\d+)?$/;
// Tách danh sách mã: dấu cách/xuống dòng, hoặc dấu phẩy NGĂN CÁCH 2 mã — không tách phẩy nằm TRONG mã DonNhieuAo
// ("9F13,1, 9F13,2" -> 2 mã). Trùng routes/orders.js#TACH_MA_DON.
const TACH_MA_DON = /\s*,\s*(?!\d+(?:[\s,]|$))|\s+/;

const hexSangChuoi = hex => {
  const s = hex.replace(/\s/g, '');
  let kq = '';
  for (let i = 0; i + 4 <= s.length; i += 4) kq += String.fromCharCode(parseInt(s.slice(i, i + 4), 16));
  return kq;
};

// ToUnicode CMap -> Map(mã hex chữ thường -> chuỗi Unicode). Hỗ trợ bfchar, bfrange (liên tiếp hoặc dạng mảng).
function docCMap(chu) {
  const bang = new Map();
  for (const [, khoi] of chu.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, nguon, dich] of khoi.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F\s]*)>/g)) bang.set(nguon.toLowerCase(), hexSangChuoi(dich));
  }
  for (const [, khoi] of chu.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, tu, den, dich] of khoi.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F\s]*>)/g)) {
      const a = parseInt(tu, 16), b = parseInt(den, 16), khoa = i => (a + i).toString(16).padStart(tu.length, '0');
      if (dich.startsWith('[')) {
        [...dich.matchAll(/<([0-9a-fA-F\s]*)>/g)].forEach((m, i) => { if (i <= b - a) bang.set(khoa(i), hexSangChuoi(m[1])); });
      } else {
        const goc = dich.replace(/[<>\s]/g, '');
        const dau = hexSangChuoi(goc.slice(0, -4)), cuoi = parseInt(goc.slice(-4), 16);
        for (let i = 0; i <= b - a; i++) bang.set(khoa(i), dau + String.fromCharCode(cuoi + i));
      }
    }
  }
  return bang;
}

// Tách 1 content stream (chuỗi latin1) thành token PDF: chuỗi (đã giải escape/hex, dạng byte), tên, số, toán tử, [ ].
function* tachToken(s) {
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === '(') {
      let sau = 1, j = i + 1, kq = '';
      const ESC = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
      while (j < n) {
        const d = s[j];
        if (d === '\\') {
          const e = s[j + 1];
          if (e in ESC) { kq += ESC[e]; j += 2; } else if (/[0-7]/.test(e)) {
            let bat = ''; j++;
            while (bat.length < 3 && /[0-7]/.test(s[j])) bat += s[j++];
            kq += String.fromCharCode(parseInt(bat, 8));
          } else j += 2;
          continue;
        }
        if (d === '(') sau++;
        else if (d === ')' && --sau === 0) break;
        kq += d; j++;
      }
      yield { loai: 'chuoi', gt: kq }; i = j + 1; continue;
    }
    if (s.startsWith('<<', i) || s.startsWith('>>', i)) { yield { loai: 'op', gt: s.slice(i, i + 2) }; i += 2; continue; }
    if (c === '<') {
      const j = s.indexOf('>', i);
      const hex = s.slice(i + 1, j < 0 ? n : j).replace(/\s/g, '');
      let kq = '';
      for (let k = 0; k < hex.length; k += 2) kq += String.fromCharCode(parseInt(hex.slice(k, k + 2).padEnd(2, '0'), 16));
      yield { loai: 'chuoi', gt: kq }; i = j < 0 ? n : j + 1; continue;
    }
    if (c === '[' || c === ']') { yield { loai: c }; i++; continue; }
    let j = i + 1;
    while (j < n && !/[\s()<>[\]{}/%]/.test(s[j])) j++;
    const gt = s.slice(i, j);
    // Ảnh nhúng thẳng (BI ... ID <dữ liệu nhị phân> EI) — bỏ qua phần dữ liệu, không coi là chữ.
    if (gt === 'ID') { const het = s.slice(j).search(/\sEI(\s|$)/); i = het < 0 ? n : j + het + 3; continue; }
    yield { loai: c === '/' ? 'ten' : (/[-+.\d]/.test(c) ? 'so' : 'op'), gt: c === '/' ? gt.slice(1) : gt };
    i = j;
  }
}

const docStream = st => Buffer.from(decodePDFRawStream(st).decode()).toString('latin1');

// -> mảng các dòng chữ (theo đúng thứ tự trong file, mọi trang).
async function docCacDongChu(buffer) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const dong = [];
  for (const trang of pdf.getPages()) {
    const fonts = new Map(); // tên font trong trang -> { haiByte, cmap }
    const dsFont = trang.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
    for (const [ten, giaTri] of dsFont ? dsFont.entries() : []) {
      const f = pdf.context.lookup(giaTri, PDFDict);
      const tu = f.lookup(PDFName.of('ToUnicode'));
      fonts.set(ten.asString().slice(1), {
        haiByte: f.lookup(PDFName.of('Subtype')) === PDFName.of('Type0'),
        cmap: tu ? docCMap(docStream(tu)) : new Map(),
      });
    }
    const noiDung = trang.node.Contents();
    const cacStream = !noiDung ? [] : noiDung instanceof PDFArray ? noiDung.asArray().map(r => pdf.context.lookup(r)) : [noiDung];

    let font = null, dongDangCo = '';
    const xuongDong = () => { if (dongDangCo.trim()) dong.push(dongDangCo); dongDangCo = ''; };
    const giaiMa = byte => {
      if (!font) return byte;
      let kq = '';
      const buoc = font.haiByte ? 2 : 1;
      for (let i = 0; i < byte.length; i += buoc) {
        const ma = [...byte.slice(i, i + buoc)].map(ch => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
        kq += font.cmap.get(ma) ?? (buoc === 1 ? byte[i] : '');
      }
      return kq;
    };
    const nganXep = [];
    for (const tk of tachToken(cacStream.map(docStream).join('\n'))) {
      if (tk.loai !== 'op') { nganXep.push(tk); continue; }
      const op = tk.gt;
      if (op === 'Tf') font = fonts.get(nganXep[nganXep.length - 2]?.gt) || null;
      else if (op === 'Tj' || op === "'" || op === '"') {
        if (op !== 'Tj') xuongDong();
        dongDangCo += giaiMa(nganXep[nganXep.length - 1]?.gt || '');
      } else if (op === 'TJ') {
        const batDau = nganXep.map(t => t.loai).lastIndexOf('[');
        for (const t of nganXep.slice(batDau + 1)) {
          if (t.loai === 'chuoi') dongDangCo += giaiMa(t.gt);
          else if (t.loai === 'so' && Number(t.gt) < -200) dongDangCo += ' '; // khoảng trắng dựng bằng dịch chữ
        }
      } else if (['Td', 'TD', 'T*', 'Tm', 'BT', 'ET'].includes(op)) xuongDong();
      nganXep.length = 0; // toán tử dùng xong toán hạng
    }
    xuongDong();
  }
  return dong;
}

// -> danh sách mã đơn (dạng giống STT_Key, theo thứ tự xuất hiện, không trùng). `laMaCoThat(ma)` (tuỳ chọn) nhận thêm
// cả token không đúng mẫu nhưng là mã đơn có thật trong hệ thống.
// CHỈ đọc trong BẢNG: bắt đầu sau dòng tiêu đề cột "STT_Key", bỏ dòng có dấu ":" (dòng tổng) — dòng thông tin lọc ở
// đầu file có thể chứa mã đơn KHÔNG nằm trong bảng (vd "Từ khoá tìm kiếm: 9SON1"), đọc vào sẽ in thừa đơn.
async function docMaDonTuPdf(buffer, laMaCoThat = () => false) {
  const daThay = new Set();
  let trongBang = false;
  for (const d of await docCacDongChu(buffer)) {
    if (!trongBang) { trongBang = /STT_Key/i.test(d); continue; }
    if (d.includes(':')) continue;
    for (const tk of d.trim().split(TACH_MA_DON)) {
      const ma = tk.replace(/^[,;:]+|[,;:]+$/g, '');
      if (ma && (MAU_STT_KEY.test(ma) || laMaCoThat(ma))) daThay.add(ma);
    }
  }
  return [...daThay];
}

module.exports = { docMaDonTuPdf, docCacDongChu };
