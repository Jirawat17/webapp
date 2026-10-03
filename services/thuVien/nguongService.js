const db = require('./thuVienDbService');
const { timTuongTu } = require('./timKiemService');
const { khoangCachHamming, laHashSuyBien } = require('../perceptualHashService');

// ============================================================
// Giai đoạn 4 thư viện "Tìm ảnh" (spec mục 9 + 19): ngưỡng nhóm kết quả do NGƯỜI DÙNG chọn từ số đo trên ảnh THẬT — không
// có ngưỡng mặc định. Người vẽ file đánh giá cặp ảnh lấy từ thư viện (Cùng thiết kế / Khác thiết kế); superadmin xem gợi ý
// (cùng cách menu QC gợi ý ngưỡng: lưới thử, 3 hướng đánh đổi, tự quyết), thử, lưu.
// Bộ ngưỡng { anh, hinhDang, xemTay } (% , 50..100):
//   Trùng file (sha256)  >  Ảnh giống (% Ảnh ≥ anh)  >  Cùng hình dạng (% Hình dạng ≥ hinhDang)
//   >  Cần xem tay (điểm cao nhất của 2 cột ≥ xemTay)  >  Điểm thấp.
// ============================================================
const KHOA = { anh: 'nguong_anh', hinhDang: 'nguong_hinh_dang', xemTay: 'nguong_xem_tay' };
const SO_CAP_TOI_THIEU = 30;        // đủ cặp mới gợi ý (giống tinh thần GOI_Y_SO_DONG_TOI_THIEU của QC)
const SO_CAP_TOI_THIEU_MOI_LOAI = 5; // phải có cả cặp Cùng lẫn Khác
// Dải điểm để chọn cặp đánh giá — lấy đều các dải (ưu tiên dải đang ít cặp nhất) để ngưỡng đo được ở cả vùng ranh giới.
const DAI_DIEM = [[97, 100.01], [92, 97], [87, 92], [82, 87], [75, 82], [0, 75]];

// Cùng quy tắc với timKiemService: hash suy biến không có điểm (không đo ngưỡng trên điểm "giống 100%" giả).
const phanTram = (a, b) => {
  if (laHashSuyBien(a) || laHashSuyBien(b)) return null;
  const d = khoangCachHamming(a, b);
  return Number.isFinite(d) ? Math.round((1 - d / 256) * 1000) / 10 : null;
};

function layNguong() {
  const n = {};
  for (const [k, khoa] of Object.entries(KHOA)) {
    const v = db.layCaiDat(khoa);
    if (v === '') return null; // chưa chọn đủ -> coi như chưa có ngưỡng
    n[k] = Number(v);
  }
  return n;
}

function kiemTraNguong(n) {
  if (!n || typeof n !== 'object') return 'Thiếu bộ ngưỡng.';
  for (const k of Object.keys(KHOA)) {
    const v = n[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 50 || v > 100) return `Ngưỡng ${k} phải là số từ 50 đến 100.`;
  }
  if (n.xemTay > Math.min(n.anh, n.hinhDang)) return 'Ngưỡng "Cần xem tay" phải nhỏ hơn hoặc bằng 2 ngưỡng còn lại.';
  return '';
}
function luuNguong(n) {
  for (const [k, khoa] of Object.entries(KHOA)) db.datCaiDat(khoa, String(n[k]));
}
function xoaNguong() {
  for (const khoa of Object.values(KHOA)) db.datCaiDat(khoa, '');
}

// 1 kết quả tìm kiếm -> mã nhóm (null nếu chưa có ngưỡng).
function phanNhom(r, n) {
  if (r.trungFile) return 'TRUNG_FILE';
  if (!n) return null;
  if (r.phanTramAnh !== null && r.phanTramAnh >= n.anh) return 'ANH_GIONG';
  if (r.phanTramHinhDang !== null && r.phanTramHinhDang >= n.hinhDang) return 'CUNG_HINH_DANG';
  if (Math.max(r.phanTramAnh ?? -1, r.phanTramHinhDang ?? -1) >= n.xemTay) return 'CAN_XEM_TAY';
  return 'DIEM_THAP';
}

// Cặp đã đánh giá + điểm theo hash hiện tại. Cặp thiếu hash (file đang LOI_HASH) bị bỏ ra.
function capDaDo() {
  return db.dsCapDanhGia().map(c => ({
    ...c, phanTramAnh: phanTram(c.dhash_a, c.dhash_b), phanTramHinhDang: phanTram(c.hd_a, c.hd_b),
  })).filter(c => c.phanTramAnh !== null || c.phanTramHinhDang !== null);
}

// Cặp đã đo -> mảng số: lưới gợi ý thử vài nghìn bộ ngưỡng x mọi cặp, không tạo object cho từng lần xếp nhóm 1 cặp.
// Thiếu điểm = -1 (mọi ngưỡng ≥ 50 nên -1 không bao giờ qua — đúng như phanNhom bỏ qua cột null).
function dongGoiCap(dsCap) {
  const n = dsCap.length, anh = new Float64Array(n), hd = new Float64Array(n), cung = new Uint8Array(n);
  dsCap.forEach((c, i) => { anh[i] = c.phanTramAnh ?? -1; hd[i] = c.phanTramHinhDang ?? -1; cung[i] = c.ket_luan === 'CUNG' ? 1 : 0; });
  return { n, anh, hd, cung };
}

// Áp 1 bộ ngưỡng lên các cặp đã đánh giá (đã đóng gói). Cùng thứ tự nhóm với phanNhom. "Giống" = Ảnh giống hoặc Cùng hình dạng.
function danhGiaBoNguong(goi, n) {
  const m = { ...n, giongDung: 0, giongSai: 0, xemTayCung: 0, xemTayKhac: 0, boSot: 0, thapDung: 0 };
  for (let i = 0; i < goi.n; i++) {
    const a = goi.anh[i], h = goi.hd[i], cung = goi.cung[i];
    if (a >= n.anh || h >= n.hinhDang) cung ? m.giongDung++ : m.giongSai++;
    else if (a >= n.xemTay || h >= n.xemTay) cung ? m.xemTayCung++ : m.xemTayKhac++;
    else cung ? m.boSot++ : m.thapDung++;
  }
  m.canXemTay = m.xemTayCung + m.xemTayKhac;
  return m;
}

// Gợi ý — cùng cách QC: thử lưới, 3 hướng đánh đổi, hoà thì gần ngưỡng đang dùng nhất. Người dùng tự quyết.
// Lưới CHỈ tính khi bấm "Tính gợi ý" (tinhLuoi) — mở trang / Thử bộ ngưỡng / lưu chỉ cần số cặp, phân bố, bộ đang dùng.
// ponytail: lưới bước 1% cho anh/hinhDang (80..100) x bước 2% cho xemTay (~5.000 bộ) x mọi cặp — tuyến tính theo số cặp.
function goiYNguong(thu, { tinhLuoi = false } = {}) {
  const dsCap = capDaDo();
  const goi = dongGoiCap(dsCap);
  const soCung = dsCap.filter(c => c.ket_luan === 'CUNG').length;
  const soKhac = dsCap.length - soCung;
  const hienTai = layNguong();
  const kq = {
    soCap: dsCap.length, soCung, soKhac, toiThieu: SO_CAP_TOI_THIEU, toiThieuMoiLoai: SO_CAP_TOI_THIEU_MOI_LOAI,
    hienTai: hienTai && dsCap.length ? danhGiaBoNguong(goi, hienTai) : hienTai, thu: null, goiY: [],
    // Phân bố điểm theo kết luận — để superadmin tự nhìn 2 nhóm có tách nhau không (quyết định có cần mức AI hay không).
    phanBo: ['phanTramAnh', 'phanTramHinhDang'].map(cot => ({
      cot,
      cung: dsCap.filter(c => c.ket_luan === 'CUNG' && c[cot] !== null).map(c => c[cot]).sort((a, b) => a - b),
      khac: dsCap.filter(c => c.ket_luan === 'KHAC' && c[cot] !== null).map(c => c[cot]).sort((a, b) => a - b),
    })),
  };
  if (thu) {
    const loi = kiemTraNguong(thu);
    if (loi) { const e = new Error(loi); e.nghiepVu = true; throw e; }
    kq.thu = danhGiaBoNguong(goi, thu);
  }
  if (!tinhLuoi || dsCap.length < SO_CAP_TOI_THIEU || soCung < SO_CAP_TOI_THIEU_MOI_LOAI || soKhac < SO_CAP_TOI_THIEU_MOI_LOAI) return kq;
  const cacBo = [];
  for (let anh = 80; anh <= 100; anh++) {
    for (let hinhDang = 80; hinhDang <= 100; hinhDang++) {
      for (let xemTay = 50; xemTay <= Math.min(anh, hinhDang); xemTay += 2) cacBo.push(danhGiaBoNguong(goi, { anh, hinhDang, xemTay }));
    }
  }
  const goc = hienTai || { anh: 100, hinhDang: 100, xemTay: 100 };
  const lech = m => Math.abs(m.anh - goc.anh) + Math.abs(m.hinhDang - goc.hinhDang) + Math.abs(m.xemTay - goc.xemTay);
  const tot = (ds, ...tieuChi) => { // bộ tốt nhất theo thứ tự tiêu chí (1 lượt, không sắp cả lưới); hoà thì bộ gặp trước
    const sau = (a, b) => tieuChi.reduce((r, f) => r || f(a) - f(b), 0) || lech(a) - lech(b);
    return ds.reduce((best, m) => (!best || sau(m, best) < 0 ? m : best), null);
  };
  const huong = [
    ['AN_TOAN', 'Ít "giống" sai nhất (cặp KHÁC thiết kế lọt vào nhóm giống), rồi ít bỏ sót, rồi ít phải xem tay',
      tot(cacBo, m => m.giongSai, m => m.boSot, m => m.canXemTay)],
    ['IT_BO_SOT', 'Ít bỏ sót nhất (cặp CÙNG thiết kế rơi xuống "Điểm thấp"), rồi ít "giống" sai, rồi ít xem tay',
      tot(cacBo, m => m.boSot, m => m.giongSai, m => m.canXemTay)],
    ['IT_XEM_TAY', 'Ít phải xem tay nhất mà "giống" sai và bỏ sót đều bằng 0 (nếu có bộ như vậy)',
      tot(cacBo.filter(m => m.giongSai === 0 && m.boSot === 0), m => m.canXemTay)],
  ];
  kq.goiY = huong.filter(([, , m]) => m).map(([ma, moTa, m]) => ({ ma, moTa, ...m }));
  return kq;
}

// 1 PNG ngẫu nhiên trong phạm vi được xem. Rút nhiều lần (mỗi lần 1 truy vấn theo khoá chính + 1 lần tra Xưởng, vài chục µs):
// admin chỉ thấy Xưởng mình — rút 12 lần như trước thì Xưởng nhỏ gần như không bao giờ trúng. Xưởng chiếm 5% thư viện thì
// 300 lần rút trượt hết với xác suất ~2/10 triệu.
// ponytail: rút ngẫu nhiên cả thư viện rồi lọc; Xưởng < 1% thư viện thì đổi sang rút từ danh sách mã của Xưởng.
const SO_LAN_RUT_TOI_DA = 300;
function rutPngDuocXem(duocXem) {
  for (let lan = 0; lan < SO_LAN_RUT_TOI_DA; lan++) {
    const f = db.layPngNgauNhien();
    if (!f) return null;
    if (duocXem(f.stt_key)) return f;
  }
  return null;
}

// 1 cặp ảnh thật chưa đánh giá, chọn ở dải điểm đang ít cặp nhất. duocXem: lọc theo Xưởng (admin).
// -> { a: { id, stt_key }, b: { id, stt_key }, phanTramAnh, phanTramHinhDang } hoặc null nếu không tìm được.
function layCapMoi(duocXem = () => true) {
  const daCo = db.dsCapDanhGia();
  const daDanhGia = new Set(daCo.map(c => `${c.file_a}-${c.file_b}`));
  const demDai = DAI_DIEM.map(() => 0);
  for (const c of capDaDo()) {
    const diem = Math.max(c.phanTramAnh ?? -1, c.phanTramHinhDang ?? -1);
    const i = DAI_DIEM.findIndex(([lo, hi]) => diem >= lo && diem < hi);
    if (i >= 0) demDai[i]++;
  }
  const thuTuDai = DAI_DIEM.map((d, i) => i).sort((x, y) => demDai[x] - demDai[y]);
  const chuaDanhGia = (x, y) => !daDanhGia.has(`${Math.min(x, y)}-${Math.max(x, y)}`);
  // Dải thấp nhất đang thiếu cặp: 200 kết quả gần nhất của 1 ảnh (thư viện lớn) toàn điểm cao -> ghép 2 ảnh ngẫu nhiên.
  if (DAI_DIEM[thuTuDai[0]][0] === 0) {
    for (let lan = 0; lan < 12; lan++) {
      const a = rutPngDuocXem(duocXem), b = rutPngDuocXem(duocXem);
      if (!a || !b) break;
      if (a.stt_key === b.stt_key || !chuaDanhGia(a.id, b.id)) continue;
      const pA = phanTram(a.dhash, b.dhash), pH = phanTram(a.dhash_hinh_dang, b.dhash_hinh_dang);
      if (Math.max(pA ?? -1, pH ?? -1) < DAI_DIEM[thuTuDai[0]][1]) {
        return { a: { id: a.id, stt_key: a.stt_key }, b: { id: b.id, stt_key: b.stt_key }, phanTramAnh: pA, phanTramHinhDang: pH, dai: DAI_DIEM[thuTuDai[0]] };
      }
    }
  }
  for (let lan = 0; lan < 12; lan++) {
    const mau = rutPngDuocXem(duocXem);
    if (!mau) return null;
    const tim = timTuongTu({ mau: [{ sha256: mau.sha256, dhash: mau.dhash, dhashHinhDang: mau.dhash_hinh_dang }], boQuaStt: new Set([mau.stt_key]), duocXem });
    for (const iDai of thuTuDai) {
      const [lo, hi] = DAI_DIEM[iDai];
      const ung = tim.ketQua.find(r => !r.trungFile && r.diem >= lo && r.diem < hi && chuaDanhGia(mau.id, r.id));
      if (ung) return { a: { id: mau.id, stt_key: mau.stt_key }, b: { id: ung.id, stt_key: ung.stt_key }, phanTramAnh: ung.phanTramAnh, phanTramHinhDang: ung.phanTramHinhDang, dai: DAI_DIEM[iDai] };
    }
  }
  return null;
}

module.exports = { layNguong, kiemTraNguong, luuNguong, xoaNguong, phanNhom, goiYNguong, layCapMoi };
