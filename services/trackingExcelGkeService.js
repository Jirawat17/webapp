// Xuất Excel MUA TRACKING THỦ CÔNG theo mẫu GKE (02/10/2026, theo yêu cầu người dùng) — menu Tracking.
// Mẫu: assets/gke/mau-len-don-gke.xlsx (bản sao "File lên đơn mẫu.xlsx" người dùng cung cấp). Người dùng chốt:
//   - Chỉ giữ sheet "bản mẫu" (4 dòng đầu không được xoá, 24 cột, dữ liệu từ dòng 5); xoá 3 sheet còn lại.
//   - street = DIA_CHI_TEN_DUONG (dòng 1), address = DIA_CHI_TEN_DUONG_2 (dòng 2) — dòng 2 trống thì để trống + cảnh báo.
//   - Mỗi tài khoản GKE 1 file (service_code / khai báo hải quan theo đúng tài khoản của đơn).
//   - Thiếu SĐT -> "0000000000", thiếu Bang/Tỉnh -> để trống (GIỐNG API) + cảnh báo.
// Dữ liệu lấy GIỐNG HỆT luồng mua qua API (trackingAutoService.js#_muaTrackingChoDonThat): dữ liệu sửa tay ở hộp đỏ, mã quốc gia
// ISO (UK -> GB), cân nặng (DonNhieuAo = tổng cả nhóm), cấu hình GKE theo Xưởng. CHỈ ĐỌC — không đổi trạng thái/dữ liệu đơn nào,
// không gửi gì sang GKE.
const path = require('path');
const ExcelJS = require('exceljs');
const orderService = require('./orderService');
const gkeService = require('./gkeService');
const donNhieuAoService = require('./donNhieuAoService');
const trackingAutoService = require('./trackingAutoService');

const DUONG_DAN_MAU = path.join(__dirname, '..', 'assets', 'gke', 'mau-len-don-gke.xlsx');
const TEN_SHEET = 'bản mẫu';
const DONG_DU_LIEU_DAU = 5;
const SO_DON_TOI_DA = 500;
const SDT_MAC_DINH = '0000000000'; // = gkeService SDT_MAC_DINH_KHI_THIEU
const TRANG_THAI_KHONG_CAN_MUA = ['CANCELLED_Đã hủy', 'REFUNDED_Hoàn đơn', 'DELIVERED_Đã giao đến khách'];
// Cột theo mã trường dòng 4 của sheet "bản mẫu" — ghi theo TÊN mã trường (tra cột lúc xuất), không giả định vị trí.
const COT = ['customer_order_num', 'service_code', 'consignee_info.full_name', 'consignee_info.phone', 'consignee_info.email',
  'consignee_info.country', 'consignee_info.postcode', 'consignee_info.province', 'consignee_info.city', 'consignee_info.street',
  'consignee_info.address', 'parcel_list.weight', 'export_declared', 'export_price', 'export_price_currency', 'import_declared',
  'import_hscode', 'import_price', 'import_price_currency', 'qty'];

// "9A1, 9A2\n9A3" -> ['9A1','9A2','9A3'] (bỏ trùng, giữ thứ tự).
const tachMaDon = chuoi => [...new Set(String(chuoi || '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean))];

// 1 đơn -> { sttKey, hopLe, lyDo[], canhBao[], taiKhoan: { id, ten }, duLieu: { mã trường: giá trị } }
function kiemTraDon(row, rows) {
  const lyDo = [], canhBao = [];
  const kq = { sttKey: row.STT_Key, hopLe: false, lyDo, canhBao, taiKhoan: null, duLieu: null, loiGanNhat: row.TU_MUA_LOI_GAN_NHAT || '' };
  if (TRANG_THAI_KHONG_CAN_MUA.includes(row.TRANG_THAI_XUONG)) lyDo.push(`Đơn đang "${row.TRANG_THAI_XUONG}" — không cần mua tracking.`);
  if (row.TRACKING_ID) lyDo.push(`Đã có mã tracking ${row.TRACKING_ID} — không mua lại.`);
  // TAM_THOI = "đang chờ tem": vận đơn ĐÃ tạo bên GKE (lỗi ở bước lấy tem) — upload Excel sẽ trùng customer_order_num / tạo vận đơn thứ 2.
  if (row.TAM_THOI) lyDo.push('Vận đơn ĐÃ được tạo trên GKE (đang chờ tem) — dùng IN LABEL để lấy tem, KHÔNG tạo lại bằng Excel.');
  const nhom = donNhieuAoService.layNhomCuaDon(row.STT_Key, rows);
  if (nhom && nhom.loiChan.length) lyDo.push(`Nhóm DonNhieuAo ${nhom.goc} lỗi dữ liệu: ${nhom.loiChan.join(' ')}`);
  if (nhom && nhom.donMua.STT_Key !== row.STT_Key) lyDo.push(`Thuộc nhóm DonNhieuAo ${nhom.goc} — chỉ xuất đơn ${nhom.donMua.STT_Key} (cả nhóm dùng chung 1 tracking).`);
  if (lyDo.length) return kq;

  const rowGke = trackingAutoService.apDungThongTinGke(row, []); // dữ liệu sửa tay ở hộp đỏ (nếu có), giống API
  if (!gkeService.duocMuaTrackingTheoQuocGia(rowGke)) lyDo.push(`Chỉ xuất đơn giao tới US hoặc UK — quốc gia "${rowGke.DIA_CHI_NUOC || '(trống)'}".`);
  let cauHinh = null;
  try { cauHinh = gkeService.layCauHinhGkeChoDon(row); } catch (e) { lyDo.push(e.message.replace(/^\[[^\]]*\]\s*/, '')); }
  if (cauHinh) {
    const thieuCh = [['serviceCode', 'Mã dịch vụ (service code)'], ['customsDeclaredPrice', 'Giá khai báo'], ['customsItemName', 'Tên hàng khai báo'], ['customsCurrency', 'Loại tiền khai báo']]
      .filter(([k]) => !cauHinh[k]).map(([, n]) => n);
    if (thieuCh.length) lyDo.push(`Tài khoản GKE "${cauHinh.ten}" thiếu cấu hình: ${thieuCh.join(', ')} — cập nhật ở Settings.`);
  }
  const thieu = [['TEN', 'Tên người nhận'], ['MA_ZIPCODE', 'ZIP code'], ['DIA_CHI_TEN_TP', 'Thành phố'], ['DIA_CHI_TEN_DUONG', 'Địa chỉ (dòng 1)']]
    .filter(([k]) => !String(rowGke[k] || '').trim()).map(([, n]) => n);
  if (thieu.length) lyDo.push(`Thiếu: ${thieu.join(', ')}.`);
  if (lyDo.length) return kq;

  let maQg;
  try { maQg = gkeService.maQuocGia(rowGke.DIA_CHI_NUOC); } catch (e) { lyDo.push(e.message); return kq; }
  const s = k => String(rowGke[k] || '').trim();
  let canNang = gkeService.tinhCanNangKg(rowGke, cauHinh);
  let soLuong = Number(row.SO_LUONG) || 1;
  if (nhom) {
    // Cân nặng VÀ số lượng khai báo cùng tính trên cả nhóm (đơn chưa huỷ) — 1 kiện chứa hàng của mọi đơn trong nhóm.
    const conLai = nhom.thanhVien.filter(r => r.TRANG_THAI_XUONG !== donNhieuAoService.TRANG_THAI_HUY);
    canNang = conLai.reduce((t, r) => t + gkeService.tinhCanNangKg(r, cauHinh), 0);
    soLuong = conLai.reduce((t, r) => t + (Number(r.SO_LUONG) || 1), 0);
    canhBao.push(`Nhóm DonNhieuAo ${nhom.goc}: 1 tracking cho cả nhóm, cân nặng tổng ${canNang} kg, số lượng tổng ${soLuong}.`);
  }
  const sdt = s('SDT') || SDT_MAC_DINH;
  if (!s('SDT')) canhBao.push(`Thiếu SĐT — điền "${SDT_MAC_DINH}" (giống mua qua API).`);
  if (!s('DIA_CHI_BANG')) canhBao.push('Thiếu Bang/Tỉnh — để trống (cột bắt buộc, GKE có thể từ chối).');
  if (!s('DIA_CHI_TEN_DUONG_2')) canhBao.push('Địa chỉ 2 trống — cột bắt buộc trong mẫu, GKE có thể từ chối.');
  const zip = s('MA_ZIPCODE');
  if (maQg === 'US' && !/^\d{5}(-?\d{4})?$/.test(zip)) canhBao.push(`ZIP "${zip}" không đúng dạng ZIP Mỹ (5 số hoặc ZIP+4) — kiểm tra lại (có thể lệch cột).`);
  if (maQg === 'US' && /^\d{5}-?\d{4}$/.test(zip)) canhBao.push(`ZIP+4 "${zip}" — GKE từng từ chối ZIP+4; cân nhắc sửa thành 5 số ở "Sửa dữ liệu gửi GKE".`);
  if (maQg === 'GB' && !/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(zip)) canhBao.push(`Postcode "${zip}" không giống dạng postcode UK — kiểm tra lại.`);
  if (/\bP\.?\s*O\.?\s*BOX\b/i.test(`${s('DIA_CHI_TEN_DUONG')} ${s('DIA_CHI_TEN_DUONG_2')}`)) canhBao.push('Địa chỉ có PO Box — GKE từng báo "Po Box not supported". Không tự sửa địa chỉ khách.');
  if (Object.keys(trackingAutoService.docThongTinGke(row)).length) canhBao.push('Đang dùng dữ liệu SỬA TAY gửi GKE (hộp đỏ).');

  kq.hopLe = true;
  kq.taiKhoan = { id: String(cauHinh.id), ten: cauHinh.ten || `#${cauHinh.id}` };
  const gia = Number(cauHinh.customsDeclaredPrice);
  kq.duLieu = {
    customer_order_num: row.STT_Key, service_code: cauHinh.serviceCode,
    'consignee_info.full_name': s('TEN'), 'consignee_info.phone': sdt, 'consignee_info.email': '',
    'consignee_info.country': maQg, 'consignee_info.postcode': zip, 'consignee_info.province': s('DIA_CHI_BANG'),
    'consignee_info.city': s('DIA_CHI_TEN_TP'), 'consignee_info.street': s('DIA_CHI_TEN_DUONG'), 'consignee_info.address': s('DIA_CHI_TEN_DUONG_2'),
    'parcel_list.weight': canNang,
    export_declared: cauHinh.customsItemName, export_price: gia, export_price_currency: cauHinh.customsCurrency,
    import_declared: cauHinh.customsItemName, import_hscode: cauHinh.customsHsCode || '', import_price: gia, import_price_currency: cauHinh.customsCurrency,
    qty: soLuong,
  };
  return kq;
}

// Kiểm tra danh sách mã (trong phạm vi Xưởng của người dùng). -> { tong, hopLe[], biLoai[], khongTimThay[] }
async function kiemTra(sttKeys, user) {
  const ma = tachMaDon(Array.isArray(sttKeys) ? sttKeys.join('\n') : sttKeys);
  if (!ma.length) throw Object.assign(new Error('Chưa có mã đơn nào.'), { status: 400 });
  if (ma.length > SO_DON_TOI_DA) throw Object.assign(new Error(`Tối đa ${SO_DON_TOI_DA} đơn mỗi lần.`), { status: 400 });
  const { rows } = await orderService.getAll({ fresh: true });
  const duocThay = new Map(orderService.locTheoXuong(rows, user).map(r => [r.STT_Key, r]));
  const kq = { tong: ma.length, hopLe: [], biLoai: [], khongTimThay: [] };
  for (const m of ma) {
    const row = duocThay.get(m);
    if (!row) { kq.khongTimThay.push(m); continue; } // không có / ngoài Xưởng người dùng — cùng 1 thông báo
    const d = kiemTraDon(row, rows);
    (d.hopLe ? kq.hopLe : kq.biLoai).push(d);
  }
  return kq;
}

// Đơn chuyển MUA THỦ CÔNG (danh sách gợi ý để chọn) — kèm kết quả kiểm tra sẵn.
async function danhSachGoiY(user) {
  const ds = await trackingAutoService.layDonChuyenThuCong(user);
  if (!ds.length) return [];
  const { rows } = await orderService.getAll();
  const theoMa = new Map(rows.map(r => [r.STT_Key, r]));
  return ds.map(d => {
    const r = theoMa.get(d.sttKey);
    const k = r ? kiemTraDon(r, rows) : { hopLe: false, lyDo: ['Không tìm thấy đơn.'], canhBao: [] };
    return { sttKey: d.sttKey, quocGia: r ? r.DIA_CHI_NUOC || '' : '', ten: r ? r.TEN || '' : '',
      diaChi: r ? [r.DIA_CHI_TEN_DUONG, r.DIA_CHI_TEN_DUONG_2, r.DIA_CHI_TEN_TP, r.DIA_CHI_BANG, r.MA_ZIPCODE].filter(Boolean).join(', ') : '',
      ngayLenDon: r ? r.NGAY_LEN_DON || '' : '', soLanThu: d.soLanThu, lyDoLoi: d.lyDo, thoiGianThu: d.thoiGianThu,
      xuatDuoc: k.hopLe, lyDoKhongXuat: k.lyDo, canhBao: k.canhBao };
  });
}

// Tạo file cho 1 tài khoản GKE: KIỂM TRA LẠI ở server (không tin dữ liệu trình duyệt gửi lên). -> { buffer, tenFile, soDon }
async function taoFile(sttKeys, taiKhoanId, user, bayGio = new Date()) {
  const kq = await kiemTra(sttKeys, user);
  const don = kq.hopLe.filter(d => d.taiKhoan.id === String(taiKhoanId));
  if (!don.length) throw Object.assign(new Error('Không có đơn hợp lệ nào của tài khoản GKE này để xuất.'), { status: 400 });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(DUONG_DAN_MAU);
  const ws = wb.getWorksheet(TEN_SHEET);
  if (!ws) throw new Error(`File mẫu GKE thiếu sheet "${TEN_SHEET}".`);
  for (const khac of wb.worksheets.filter(w => w.id !== ws.id)) wb.removeWorksheet(khac.id);
  // Vị trí cột theo mã trường dòng 4 — thiếu mã nào thì báo lỗi, không đoán.
  const viTri = {};
  ws.getRow(4).eachCell((c, i) => { viTri[String(c.value || '').trim()] = i; });
  const thieuCot = COT.filter(k => !viTri[k]);
  if (thieuCot.length) throw new Error(`File mẫu GKE thiếu cột: ${thieuCot.join(', ')}.`);
  // Xoá trắng các dòng ví dụ ("Mã order"...) từ dòng 5 — spliceRows() của exceljs KHÔNG xoá được dòng ở sheet này (đã thử).
  for (let r = DONG_DU_LIEU_DAU; r <= ws.rowCount; r++) ws.getRow(r).eachCell({ includeEmpty: true }, c => { c.value = null; });
  don.forEach((d, i) => {
    const hang = ws.getRow(DONG_DU_LIEU_DAU + i);
    for (const k of COT) {
      const v = d.duLieu[k];
      // Số chỉ cho cân nặng / giá / số lượng; còn lại (ZIP, SĐT, HS...) ghi CHUỖI để Excel không bỏ số 0 đầu / đổi dạng số.
      hang.getCell(viTri[k]).value = typeof v === 'number' ? v : String(v ?? '');
      if (typeof v !== 'number') hang.getCell(viTri[k]).numFmt = '@';
    }
    hang.commit();
  });
  const vn = new Date(bayGio.getTime() + 7 * 3600000).toISOString(); // giờ VN
  const tenTk = d0 => String(d0.taiKhoan.ten).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || `TK${d0.taiKhoan.id}`;
  const tenFile = `GKE_Manual_Tracking_${vn.slice(0, 10).replace(/-/g, '')}_${vn.slice(11, 13)}${vn.slice(14, 16)}_${tenTk(don[0])}.xlsx`;
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), tenFile, soDon: don.length, cacMa: don.map(d => d.sttKey) };
}

module.exports = { tachMaDon, kiemTraDon, kiemTra, danhSachGoiY, taoFile, COT, DUONG_DAN_MAU };
