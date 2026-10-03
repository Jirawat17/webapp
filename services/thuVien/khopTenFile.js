// Khớp tên file/thư mục -> STT_Key cho upload tay (menu "Tìm ảnh", spec mục 7 — sửa 03/10/2026, giai đoạn 2).
// KHÔNG đoán: chỉ khớp khi 1 cụm token liền nhau trong tên trùng CHÍNH XÁC (không phân biệt hoa thường) 1 mã có thật.
//
// Vì sao so theo CỤM token (giữ nguyên dấu ngăn cách gốc) thay vì từng token: mã đơn có thể chứa dấu chấm/gạch (vd 9U121.2).
// Tách từng token thì "9U121.2.png" thành "9U121" + "2" -> không khớp được 9U121.2, tệ hơn là khớp NHẦM sang đơn 9U121.
// Nhiều mã cùng khớp mà chồng lên nhau ở cùng chỗ -> giữ mã DÀI hơn (9U121.2 chứa 9U121). Còn lại ≥ 2 mã -> không khớp.

const SO_TOKEN_TOI_DA_MOT_MA = 4; // mã đơn dài nhất thực tế ghép ~2-3 cụm (vd 9U121.2) — 4 là dư

// NFC trước khi so: tên file từ macOS là dạng NFD (chữ có dấu tách thành chữ + dấu) — không chuẩn hoá thì mã có chữ Việt
// có dấu không bao giờ khớp, và bộ tách token còn cắt đôi chữ tại dấu.
const chuanHoaMa = ma => String(ma).trim().normalize('NFC').toLowerCase();

// tapMa: Map<chữ thường, Set<mã gốc>> — dựng bằng taoTapMa(), thêm dần bằng themMa().
function themMa(tap, ma) {
  const goc = String(ma || '').trim();
  if (!goc) return;
  const k = chuanHoaMa(goc);
  if (!tap.has(k)) tap.set(k, new Set());
  tap.get(k).add(goc);
}
function taoTapMa(dsMa) {
  const tap = new Map();
  for (const ma of dsMa) themMa(tap, ma);
  return tap;
}

// Các mã khớp trong 1 tên (đã bỏ đuôi nếu là tên file) -> mảng mã gốc khác nhau (sau khi bỏ mã bị mã dài hơn chứa).
function maTrongTen(ten, tapMa) {
  const tokens = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m;
  while ((m = re.exec(ten))) tokens.push({ dau: m.index, cuoi: m.index + m[0].length });
  const khop = []; // { dau, cuoi, ma: Set }
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i; j < Math.min(tokens.length, i + SO_TOKEN_TOI_DA_MOT_MA); j++) {
      const cum = ten.slice(tokens[i].dau, tokens[j].cuoi).toLowerCase(); // ten đã NFC (khopSttKey)
      const ma = tapMa.get(cum);
      if (ma) khop.push({ dau: tokens[i].dau, cuoi: tokens[j].cuoi, ma });
    }
  }
  const conLai = khop.filter(a => !khop.some(b => b !== a && b.dau <= a.dau && b.cuoi >= a.cuoi && (b.cuoi - b.dau) > (a.cuoi - a.dau)));
  const dsMa = new Set();
  for (const k of conLai) for (const ma of k.ma) dsMa.add(ma);
  return [...dsMa];
}

// duongDan: đường dẫn tương đối như trình duyệt gửi ("ThuMuc/Con/10LH72.png") hoặc chỉ tên file.
// -> { ketQua: 'KHOP' | 'KHONG_KHOP' | 'NHIEU', sttKey?, theo?: 'TEN_FILE' | 'THU_MUC', ungVien: [] }
function khopSttKey(duongDan, tapMa) {
  const phan = String(duongDan || '').normalize('NFC').split(/[\\/]+/).filter(Boolean);
  if (!phan.length) return { ketQua: 'KHONG_KHOP', ungVien: [] };
  const tenFile = phan[phan.length - 1].replace(/\.[^.]*$/, ''); // bỏ đuôi (chỉ đuôi cuối cùng)
  const cacTang = [{ ten: tenFile, theo: 'TEN_FILE' }];
  for (let i = phan.length - 2; i >= 0; i--) cacTang.push({ ten: phan[i], theo: 'THU_MUC' }); // thư mục cha gần nhất trước
  for (const tang of cacTang) {
    const ungVien = maTrongTen(tang.ten, tapMa);
    if (ungVien.length === 1) return { ketQua: 'KHOP', sttKey: ungVien[0], theo: tang.theo, ungVien };
    if (ungVien.length > 1) return { ketQua: 'NHIEU', ungVien };
  }
  return { ketQua: 'KHONG_KHOP', ungVien: [] };
}

module.exports = { taoTapMa, themMa, chuanHoaMa, khopSttKey };
