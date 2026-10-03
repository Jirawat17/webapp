const db = require('./thuVienDbService');
const { laHashSuyBien } = require('../perceptualHashService');

// ============================================================
// Tìm thiết kế giống/tương tự trong thư viện "Tìm ảnh" (giai đoạn 2, spec mục 9).
// Chỉ mục hash giữ trong RAM dạng Uint32Array (8 số 32 bit / hash 256 bit) + đếm bit bằng phép toán bit — so 200.000 file
// trong vài chục ms. Dựng lại khi thuVienDbService.layPhienBanChiMuc() đổi (có file mới / hash đổi).
// Chưa có ngưỡng (giai đoạn 4 người dùng chọn từ số đo thật) -> KHÔNG gán nhãn "giống/tương tự": chỉ "Trùng file" (sha256
// bằng nhau, chắc chắn) + danh sách sắp theo điểm, kèm 2 con số % Ảnh và % Hình dạng.
// ============================================================
const SO_TU = 8; // 256 bit = 8 x 32 bit
const SO_KET_QUA_TOI_DA = 200;

let cache = null;
const SUC_CHUA_BAN_DAU = 1024;

// Hash suy biến (gần như hằng số — ảnh 1 màu / 1 khối đặc) coi như KHÔNG có: so với nó thì ảnh nào cũng "giống 100%".
function hexVaoMang(hex, mang, viTri) {
  if (!hex || hex.length !== SO_TU * 8 || laHashSuyBien(hex)) return false;
  for (let i = 0; i < SO_TU; i++) mang[viTri + i] = parseInt(hex.substr(i * 8, 8), 16) >>> 0;
  return true;
}

function demBit(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function taoCacheRong(sucChua) {
  return {
    phienBan: 0, n: 0, sucChua, viTriTheoId: new Map(),
    id: new Int32Array(sucChua), stt: [], sha: [],
    h1: new Uint32Array(sucChua * SO_TU), h2: new Uint32Array(sucChua * SO_TU), co1: new Uint8Array(sucChua), co2: new Uint8Array(sucChua),
  };
}
function moRong(c) { // gấp đôi sức chứa, chép dữ liệu cũ sang
  const m = taoCacheRong(c.sucChua * 2);
  Object.assign(m, { phienBan: c.phienBan, n: c.n, viTriTheoId: c.viTriTheoId, stt: c.stt, sha: c.sha });
  m.id.set(c.id); m.h1.set(c.h1); m.h2.set(c.h2); m.co1.set(c.co1); m.co2.set(c.co2);
  return m;
}
function ghiDong(c, r) { // thêm mới hoặc ghi đè (hash vừa tính lại) theo id
  let i = c.viTriTheoId.get(r.id);
  if (i === undefined) {
    if (c.n === c.sucChua) c = moRong(c);
    i = c.n++;
    c.viTriTheoId.set(r.id, i);
  }
  c.id[i] = r.id; c.stt[i] = r.stt_key; c.sha[i] = r.sha256;
  c.co1[i] = hexVaoMang(r.dhash, c.h1, i * SO_TU) ? 1 : 0;
  c.co2[i] = hexVaoMang(r.dhash_hinh_dang, c.h2, i * SO_TU) ? 1 : 0;
  return c;
}
// Lần đầu (hoặc mất dấu thay đổi) dựng toàn bộ; sau đó chỉ đọc thêm các file vừa đổi (file mới / hash tính lại).
function layCache() {
  const phienBan = db.layPhienBanChiMuc();
  if (cache && cache.phienBan === phienBan) return cache;
  const idDoi = cache ? db.layIdDoiSauPhienBan(cache.phienBan) : null;
  let c;
  if (idDoi) {
    c = cache;
    for (const r of db.dsChiMucPng(idDoi)) c = ghiDong(c, r);
  } else {
    const ds = db.dsChiMucPng();
    c = taoCacheRong(Math.max(SUC_CHUA_BAN_DAU, Math.ceil(ds.length * 1.25)));
    for (const r of ds) c = ghiDong(c, r);
  }
  c.phienBan = phienBan;
  cache = c;
  return c;
}

const khoangCach = (mang, viTri, q) => {
  let d = 0;
  for (let k = 0; k < SO_TU; k++) d += demBit((mang[viTri + k] ^ q[k]) >>> 0);
  return d;
};
const phanTram = d => Math.round((1 - d / 256) * 1000) / 10;

// mau: [{ sha256, dhash, dhashHinhDang, nhan }] — 1 ảnh (tìm theo ảnh tải lên) hoặc mọi PNG của 1 đơn (tìm theo mã);
// mỗi file trong thư viện lấy điểm CAO NHẤT so với các mẫu, ghi lại mẫu nào giống nhất (soVoi).
// boQuaStt: Set mã đơn không đưa vào kết quả (chính đơn đang tra). duocXem(stt): lọc quyền theo Xưởng — gọi LẦN LƯỢT theo
// điểm từ cao xuống, dừng khi đủ kết quả (không gọi cho cả thư viện).
// -> { ketQua: [{ id, stt_key, trungFile, phanTramAnh, phanTramHinhDang, diem, soVoi }], tongSoSanh, ms }
function timTuongTu({ mau, boQuaStt = new Set(), duocXem = () => true, gioiHan = SO_KET_QUA_TOI_DA }) {
  const batDau = Date.now();
  const c = layCache();
  const dsMau = mau.map(m => {
    const q1 = new Uint32Array(SO_TU), q2 = new Uint32Array(SO_TU);
    return { sha: m.sha256 || '', nhan: m.nhan || '', q1, q2, co1: hexVaoMang(m.dhash, q1, 0), co2: hexVaoMang(m.dhashHinhDang, q2, 0) };
  });
  // điểm theo phần nghìn (0..1000) để xếp theo "thùng" — không cần sắp xếp cả thư viện
  const diem = new Int16Array(c.n).fill(-1);
  const p1 = new Float64Array(c.n).fill(-1), p2 = new Float64Array(c.n).fill(-1);
  const trung = new Uint8Array(c.n), soVoi = new Int16Array(c.n);
  const thung = new Int32Array(1003); // 1001 = trùng file (luôn đứng đầu); 1002 luôn 0 (chặn trên cho dau[] bên dưới)
  let tongSoSanh = 0;
  for (let i = 0; i < c.n; i++) {
    if (boQuaStt.has(c.stt[i])) continue;
    tongSoSanh++;
    let tot = -1;
    for (let j = 0; j < dsMau.length; j++) {
      const m = dsMau[j];
      const a = m.co1 && c.co1[i] ? phanTram(khoangCach(c.h1, i * SO_TU, m.q1)) : -1;
      const b = m.co2 && c.co2[i] ? phanTram(khoangCach(c.h2, i * SO_TU, m.q2)) : -1;
      const t = m.sha && m.sha === c.sha[i] ? 1001 : Math.round(Math.max(a, b) * 10);
      if (t > tot) { tot = t; p1[i] = a; p2[i] = b; soVoi[i] = j; trung[i] = t === 1001 ? 1 : 0; }
    }
    if (tot < 0) continue;
    diem[i] = tot;
    thung[tot]++;
  }
  // Xếp chỉ số theo thùng (sắp kiểu đếm, 1 lượt O(n)) — trước đây mỗi thùng quét lại cả thư viện: kết quả rải trên 200 thùng
  // = 200 lượt x 200.000 file.
  const dau = new Int32Array(1003); // dau[t] = vị trí đầu thùng t trong thuTu (thùng điểm cao đứng trước)
  for (let t = 1001; t >= 0; t--) dau[t] = dau[t + 1] + thung[t + 1];
  const thuTu = new Int32Array(dau[0] + thung[0]);
  const ghi = dau.slice();
  for (let i = 0; i < c.n; i++) if (diem[i] >= 0) thuTu[ghi[diem[i]]++] = i;
  // Duyệt từ thùng điểm cao xuống, lọc quyền, dừng khi đủ gioiHan.
  const ketQua = [];
  for (let t = 1001; t >= 0 && ketQua.length < gioiHan; t--) {
    if (!thung[t]) continue;
    const trongThung = Array.from(thuTu.subarray(dau[t], dau[t] + thung[t]));
    trongThung.sort((x, y) => Math.max(p1[y], p2[y]) - Math.max(p1[x], p2[x]) || Math.min(p1[y], p2[y]) - Math.min(p1[x], p2[x]));
    for (const i of trongThung) {
      if (ketQua.length >= gioiHan) break;
      if (!duocXem(c.stt[i])) continue;
      ketQua.push({
        id: c.id[i], stt_key: c.stt[i], trungFile: !!trung[i],
        phanTramAnh: p1[i] < 0 ? null : p1[i], phanTramHinhDang: p2[i] < 0 ? null : p2[i],
        diem: trung[i] ? 100 : t / 10, soVoi: dsMau[soVoi[i]].nhan,
      });
    }
  }
  return { ketQua, tongSoSanh, ms: Date.now() - batDau };
}

module.exports = { timTuongTu };
