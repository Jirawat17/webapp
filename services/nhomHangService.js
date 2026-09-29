// Nhóm hàng theo LOAI (29/09/2026, theo yêu cầu người dùng) — bộ lọc "Nhóm hàng" ở Danh sách đơn hàng.
// Chỉ TÍNH lúc lọc, không lưu cột, không đổi LOAI gốc. Loại/keyword lưu ở SQLite (caiDatDbService.js, bảng
// nhom_hang_loai — nạp sẵn danh sách mặc định services/nhomHangMacDinh.js), superadmin thêm/sửa/xoá ở Settings.
// So khớp NGUYÊN giá trị sau chuẩn hoá (chữ thường, bỏ dấu — gkeService.chuanHoa — rồi bỏ mọi ký tự không phải
// chữ/số): "T-Shirt" = "t shirt" = "tshirt"; KHÔNG so kiểu "chứa" ("sw" không được bắt "Swimwear"). Không khớp
// keyword nào (kể cả LOAI trống) -> "Chưa phân loại", không tự đoán nhóm. 1 keyword chỉ thuộc 1 loại (chặn khi lưu).
const caiDat = require('./caiDatDbService');
const { chuanHoa } = require('./gkeService');

const TEN_NHOM = { 1: 'QUẦN ÁO', 2: 'KHÔNG PHẢI QUẦN ÁO' };
const CHUA_PHAN_LOAI = 'CHUA';

const khoa = s => chuanHoa(s).replace(/[^a-z0-9]/g, '');
// Tách theo dấu phẩy HOẶC xuống dòng — ô keyword ở Settings là textarea, gõ Enter giữa 2 keyword không được gộp thành 1.
const tachTuKhoa = s => [...new Set(String(s ?? '').split(/[,\r\n]+/).map(x => x.trim()).filter(Boolean))];

// keyword đã chuẩn hoá -> { id loại, nhóm }. Dựng lại sau mỗi lần sửa ở Settings (lamMoi).
let _theoKhoa = null;
const _daTinh = new Map(); // LOAI gốc -> nhóm (chỉ vài chục giá trị khác nhau dù nhiều đơn)
function banDoKhoa() {
  if (_theoKhoa) return _theoKhoa;
  _theoKhoa = new Map();
  for (const l of caiDat.layDanhSachLoaiHang()) {
    for (const kw of tachTuKhoa(l.TuKhoa)) {
      const k = khoa(kw);
      if (!k) continue;
      // Trùng khác loại chỉ có thể do sửa thẳng DB (Settings chặn khi lưu) — không chọn bên nào: Chưa phân loại.
      const trung = _theoKhoa.has(k) && _theoKhoa.get(k)?.id !== l.id;
      if (trung) console.error(`[NhomHang] Keyword "${kw}" trùng giữa nhiều loại — tính là Chưa phân loại`);
      _theoKhoa.set(k, trung ? null : { id: l.id, nhom: l.Nhom });
    }
  }
  return _theoKhoa;
}
function lamMoi() { _theoKhoa = null; _daTinh.clear(); }

// -> '1' | '2' | 'CHUA'
function nhomHangCuaLoai(loai) {
  const goc = String(loai ?? '');
  if (!_daTinh.has(goc)) {
    const k = khoa(goc);
    _daTinh.set(goc, (k && banDoKhoa().get(k)?.nhom) || CHUA_PHAN_LOAI);
  }
  return _daTinh.get(goc);
}

// Kiểm tra 1 loại trước khi thêm/sửa (idDangSua = null khi thêm) -> dữ liệu đã chuẩn hoá, hoặc throw lỗi tiếng Việt.
function kiemTraLoai({ Ten, Nhom, TuKhoa }, idDangSua) {
  const ten = String(Ten ?? '').trim();
  const nhom = String(Nhom ?? '');
  const dsTuKhoa = tachTuKhoa(TuKhoa);
  if (!ten) throw new Error('Chưa nhập tên loại.');
  if (!TEN_NHOM[nhom]) throw new Error('Nhóm không hợp lệ — chỉ Nhóm 1 hoặc Nhóm 2.');
  if (!dsTuKhoa.length) throw new Error(`Loại "${ten}" chưa có keyword nào.`);
  const rong = dsTuKhoa.filter(kw => !khoa(kw));
  if (rong.length) throw new Error(`Keyword không có chữ/số nào: ${rong.map(kw => `"${kw}"`).join(', ')}.`);

  const cacLoaiKhac = caiDat.layDanhSachLoaiHang().filter(l => l.id !== Number(idDangSua));
  const trungTen = cacLoaiKhac.find(l => chuanHoa(l.Ten) === chuanHoa(ten));
  if (trungTen) throw new Error(`Đã có loại "${trungTen.Ten}".`);
  const cuaLoaiKhac = new Map();
  cacLoaiKhac.forEach(l => tachTuKhoa(l.TuKhoa).forEach(kw => { if (!cuaLoaiKhac.has(khoa(kw))) cuaLoaiKhac.set(khoa(kw), { kw, l }); }));
  const trung = dsTuKhoa.filter(kw => cuaLoaiKhac.has(khoa(kw))).map(kw => {
    const { kw: kwCu, l } = cuaLoaiKhac.get(khoa(kw));
    return `"${kw}" trùng "${kwCu}" của loại ${l.Ten} (Nhóm ${l.Nhom})`;
  });
  if (trung.length) throw new Error(`Keyword đã thuộc loại khác — mỗi keyword chỉ được thuộc 1 loại: ${trung.join('; ')}.`);
  return { Ten: ten, Nhom: nhom, TuKhoa: dsTuKhoa.join(', ') };
}

const timLoai = id => caiDat.layDanhSachLoaiHang().find(l => l.id === Number(id));

function themLoai(duLieu) {
  const hopLe = kiemTraLoai(duLieu, null);
  const id = caiDat.themLoaiHang(hopLe);
  lamMoi();
  return { id, ...hopLe };
}
function suaLoai(id, duLieu) {
  const truoc = timLoai(id);
  if (!truoc) throw new Error('Không tìm thấy loại cần sửa (có thể vừa bị xoá) — tải lại trang.');
  const hopLe = kiemTraLoai(duLieu, id);
  caiDat.suaLoaiHang(id, hopLe);
  lamMoi();
  return { truoc, sau: { id: Number(id), ...hopLe } };
}
function xoaLoai(id) {
  const truoc = timLoai(id);
  if (!truoc) throw new Error('Không tìm thấy loại cần xoá (có thể vừa bị xoá) — tải lại trang.');
  caiDat.xoaLoaiHang(id);
  lamMoi();
  return truoc;
}

module.exports = {
  TEN_NHOM, CHUA_PHAN_LOAI, nhomHangCuaLoai,
  layDanhSachLoai: caiDat.layDanhSachLoaiHang, themLoai, suaLoai, xoaLoai,
};
