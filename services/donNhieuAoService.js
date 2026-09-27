// DonNhieuAo (bổ sung 26/09/2026, theo yêu cầu người dùng) — nhiều đơn riêng biệt CÙNG OrderID sàn TMĐT,
// giao chung 1 địa chỉ, dùng CHUNG 1 tracking. Nhận diện TỰ ĐỘNG lúc đọc (không lưu nhóm ở đâu cả):
//   - Nhóm = cùng Team (chữ cái trong STT_Key) + cùng MA_DON_HANG_ORDERID (không trống), >= 2 đơn.
//   - STT_Key = <tháng><team><số thứ tự>[.n | ,n] — vd 9F13.1, 9F13,2. ".1" là đơn DUY NHẤT được mua
//     tracking cho cả nhóm, các đơn còn lại dùng chung (tracking sao xuống, đánh dấu TRACKING_CHUNG_CUA).
//   - Hậu tố + địa chỉ dùng để KIỂM TRA CHÉO — lệch thì báo lỗi ở Trung tâm hành động.
// Module THUẦN (không require service nào) — orderService/trackingAutoService/actionCenterService đều
// dùng được mà không vướng vòng require.

const { chiSoTinhTrang } = require('../data/pipelineTinhTrang');

const MAU_STT = /^(\d{1,2})([A-Za-z]+)(\d+)(?:[.,](\d+))?$/;

function phanTichStt(sttKey) {
  const m = MAU_STT.exec(String(sttKey || '').trim());
  if (!m) return null;
  return { team: m[2].toUpperCase(), goc: `${m[1]}${m[2].toUpperCase()}${m[3]}`, thuTu: m[4] ? Number(m[4]) : null };
}

function khoaNhom(row) {
  const p = phanTichStt(row.STT_Key);
  const orderId = String(row.MA_DON_HANG_ORDERID || '').trim();
  return p && orderId ? `${p.team}|${orderId}` : null;
}

const TRANG_THAI_HUY = 'CANCELLED_Đã hủy';
const COT_DIA_CHI = ['TEN', 'DIA_CHI_TEN_DUONG', 'TEN_DIA_CHI', 'DIA_CHI_TEN_TP', 'DIA_CHI_BANG', 'MA_ZIPCODE', 'DIA_CHI_NUOC'];
const daSanXuat = r => { const i = chiSoTinhTrang(r.TRANG_THAI_XUONG); return i !== null && i >= chiSoTinhTrang('Đã sản xuất'); };
const conHieuLuc = r => r.TRANG_THAI_XUONG !== TRANG_THAI_HUY;
// Điều kiện IN LABEL cho nhóm: MỌI đơn chưa huỷ đều đã tới "Đã sản xuất" trở đi (1 kiện gửi đủ áo).
function cacDonChuaSanXuat(nhom) {
  return nhom.thanhVien.filter(r => conHieuLuc(r) && !daSanXuat(r));
}
const chuanHoa = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
const vanTayDiaChi = r => COT_DIA_CHI.map(c => chuanHoa(r[c])).join('|');

// Lỗi CHẶN mua tracking cho cả nhóm (còn lại chỉ là cảnh báo): không xác định được đơn .1 duy nhất,
// hoặc khác địa chỉ (mua 1 tem cho 1 địa chỉ trong khi có đơn phải đi địa chỉ khác = gửi sai hàng).
function lapNhom(khoa, thanhVien) {
  const p = r => phanTichStt(r.STT_Key);
  const sapXep = [...thanhVien].sort((a, b) => (p(a).thuTu ?? 1e9) - (p(b).thuTu ?? 1e9) || a.STT_Key.localeCompare(b.STT_Key));
  const cacDonMot = sapXep.filter(r => p(r).thuTu === 1);
  const loiChan = [];
  const canhBao = [];

  if (cacDonMot.length === 0) loiChan.push('Chưa có đơn ".1" — không xác định được đơn mua tracking cho nhóm.');
  if (cacDonMot.length > 1) loiChan.push(`Nhiều đơn cùng là ".1": ${cacDonMot.map(r => r.STT_Key).join(', ')}.`);
  if (new Set(sapXep.map(vanTayDiaChi)).size > 1) loiChan.push('Các đơn trong nhóm KHÁC địa chỉ giao hàng.');

  const thieuHauTo = sapXep.filter(r => p(r).thuTu === null);
  if (thieuHauTo.length) canhBao.push(`Cùng OrderID nhưng thiếu hậu tố ".n": ${thieuHauTo.map(r => r.STT_Key).join(', ')}.`);
  const cacGoc = new Set(sapXep.filter(r => p(r).thuTu !== null).map(r => p(r).goc));
  if (cacGoc.size > 1) canhBao.push(`STT_Key khác gốc trong cùng nhóm: ${[...cacGoc].join(', ')}.`);
  const demThuTu = {};
  sapXep.forEach(r => { const t = p(r).thuTu; if (t !== null) demThuTu[t] = (demThuTu[t] || 0) + 1; });
  const trung = Object.keys(demThuTu).filter(t => demThuTu[t] > 1 && t !== '1');
  if (trung.length) canhBao.push(`Trùng số thứ tự: ${trung.map(t => '.' + t).join(', ')}.`);
  const lonNhat = Math.max(0, ...Object.keys(demThuTu).map(Number));
  const thieu = [];
  for (let i = 1; i <= lonNhat; i++) if (!demThuTu[i]) thieu.push('.' + i);
  if (thieu.length) canhBao.push(`Thiếu số thứ tự: ${thieu.join(', ')}.`);

  const dsHieuLuc = sapXep.filter(conHieuLuc);
  const donMot = cacDonMot.length === 1 ? cacDonMot[0] : null;
  // .1 bị huỷ RIÊNG (nút superadmin — huỷ thường luôn huỷ cả nhóm) khi CHƯA tạo vận đơn -> đơn chưa huỷ nhỏ
  // nhất mua thay cho cả nhóm (bổ sung 27/09/2026, theo yêu cầu người dùng — đơn đã huỷ không được mua
  // tracking). .1 đã mua rồi mới huỷ -> vẫn là đơn mua (cả nhóm giữ tracking đó), chỉ đổi đơn bấm in label.
  let donMua = donMot;
  if (donMot && !conHieuLuc(donMot) && !donMot.TRACKING_ID && dsHieuLuc.length) {
    if (donMot.TAM_THOI) loiChan.push(`Đơn ${donMot.STT_Key} bị huỷ khi vận đơn GKE đang chờ tem — đưa ${donMot.STT_Key} về trạng thái chưa huỷ để hệ thống lấy nốt tem cho nhóm.`);
    else donMua = dsHieuLuc[0];
  }
  // Đơn bấm IN LABEL cho cả nhóm (tem luôn lấy theo vận đơn của donMua): donMua, trừ khi donMua đã huỷ.
  const donIn = donMua && !conHieuLuc(donMua) && dsHieuLuc.length ? dsHieuLuc[0] : donMua;
  const trackingRieng = sapXep.filter(r => r.TRACKING_ID && !r.TRACKING_CHUNG_CUA && r !== donMua);
  if (trackingRieng.length) {
    canhBao.push(`Đơn con đã có tracking RIÊNG (mua trùng): ${trackingRieng.map(r => `${r.STT_Key} (${r.TRACKING_ID})`).join(', ')} — kiểm tra huỷ vận đơn thừa bên GKE.`);
  }

  if (donMua && !donMua.TRACKING_ID && dsHieuLuc.length && dsHieuLuc.every(daSanXuat)) {
    canhBao.push(`Cả nhóm đã sản xuất xong nhưng ${donMua.STT_Key} chưa có tracking.`);
  }

  return {
    khoa,
    orderId: khoa.split('|').slice(1).join('|'),
    thanhVien: sapXep,
    donMua,
    donIn,
    goc: donMua ? p(donMua).goc : p(sapXep[0]).goc,
    loiChan,
    canhBao,
  };
}

// Map STT_Key -> nhóm (chỉ đơn THUỘC nhóm >= 2 đơn mới có mặt). Gọi 1 lần cho cả tập rows.
function xayDungBanDoNhom(rows) {
  const theoKhoa = new Map();
  for (const r of rows) {
    const k = khoaNhom(r);
    if (!k) continue;
    if (!theoKhoa.has(k)) theoKhoa.set(k, []);
    theoKhoa.get(k).push(r);
  }
  const banDo = new Map();
  for (const [k, ds] of theoKhoa) {
    if (ds.length < 2) continue;
    const nhom = lapNhom(k, ds);
    ds.forEach(r => banDo.set(r.STT_Key, nhom));
  }
  return banDo;
}

function layNhomCuaDon(sttKey, rows) {
  return xayDungBanDoNhom(rows).get(sttKey) || null;
}

// Thông tin gọn gắn vào mỗi đơn trả về giao diện (orders.html/order.html).
function tomTatChoDon(sttKey, nhom) {
  if (!nhom) return null;
  const viTri = nhom.thanhVien.findIndex(r => r.STT_Key === sttKey) + 1;
  return {
    goc: nhom.goc,
    orderId: nhom.orderId,
    viTri,
    tong: nhom.thanhVien.length,
    laDonMua: !!nhom.donMua && nhom.donMua.STT_Key === sttKey,
    donMua: nhom.donMua ? nhom.donMua.STT_Key : null,
    laDonIn: !!nhom.donIn && nhom.donIn.STT_Key === sttKey,
    donIn: nhom.donIn ? nhom.donIn.STT_Key : null,
    loiChan: nhom.loiChan,
    canhBao: nhom.canhBao,
    thanhVien: nhom.thanhVien.map(r => ({
      sttKey: r.STT_Key, trangThai: r.TRANG_THAI_XUONG || '', trackingId: r.TRACKING_ID || '',
    })),
  };
}

// Lỗi dữ liệu cho TOÀN BỘ đơn — dùng cho Trung tâm hành động. Gồm cả lỗi của từng nhóm (lỗi chặn +
// cảnh báo) lẫn 2 trường hợp KHÔNG tự tạo được nhóm: đơn mang hậu tố của 1 gốc nhưng OrderID khác/trống.
function danhSachLoiDuLieu(rows) {
  const banDo = xayDungBanDoNhom(rows);
  const ketQua = [];
  const daXet = new Set();
  for (const nhom of banDo.values()) {
    if (daXet.has(nhom.khoa)) continue;
    daXet.add(nhom.khoa);
    const loi = [...nhom.loiChan, ...nhom.canhBao];
    if (loi.length) ketQua.push({ goc: nhom.goc, orderId: nhom.orderId, sttKeys: nhom.thanhVien.map(r => r.STT_Key), loi });
  }

  // Cùng gốc (vd 9F13.x) nhưng rơi vào nhiều khoá nhóm/không có OrderID — nhiều khả năng gõ nhầm OrderID.
  const theoGoc = new Map();
  for (const r of rows) {
    const p = phanTichStt(r.STT_Key);
    if (!p || p.thuTu === null) continue;
    if (!theoGoc.has(p.goc)) theoGoc.set(p.goc, []);
    theoGoc.get(p.goc).push(r);
  }
  for (const [goc, ds] of theoGoc) {
    if (ds.length < 2) continue;
    const cacOrderId = new Set(ds.map(r => String(r.MA_DON_HANG_ORDERID || '').trim() || '(trống)'));
    if (cacOrderId.size > 1) {
      ketQua.push({
        goc, orderId: [...cacOrderId].join(' / '), sttKeys: ds.map(r => r.STT_Key),
        loi: [`Cùng gốc ${goc} nhưng khác OrderID: ${ds.map(r => `${r.STT_Key}=${String(r.MA_DON_HANG_ORDERID || '').trim() || '(trống)'}`).join(', ')}.`],
      });
    }
  }
  return ketQua;
}

module.exports = {
  TRANG_THAI_HUY, cacDonChuaSanXuat, phanTichStt, khoaNhom, xayDungBanDoNhom, layNhomCuaDon, tomTatChoDon, danhSachLoiDuLieu,
};
