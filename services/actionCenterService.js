const orderService = require('./orderService');
const alertService = require('./alertService');
const logService = require('./logService');
const { readTabCached } = require('./sheetsService');
const { TRANG_THAI_KET_THUC, TRANG_THAI_DA_SHIP } = require('../data/pipelineTinhTrang');

// Trung tâm hành động (bổ sung 14/09/2026, xem
// docs/superpowers/specs/2026-09-14-trung-tam-hanh-dong-design.md) — gom 4 loại "việc cần xử lý" cho
// admin, tất cả tính trực tiếp từ dữ liệu/hàm ĐÃ CÓ (không thêm cột Sheet mới nào).
const TAB_LOGS_TRACKING = 'LogsTracking'; // trùng tên tab với trackingAutoService.js
const GIO_TINH_HUY_GAN_DAY = 12;
const GIO_TINH_LOI_TRACKING_GAN_DAY = 24;

function trongVongGio(thoiGianStr, soGio) {
  const t = new Date(thoiGianStr);
  if (isNaN(t.getTime())) return false;
  return Date.now() - t.getTime() <= soGio * 3600 * 1000;
}

async function layDonHuyGanDay() {
  const ds = await logService.layLichSuChuyenSangTrangThai('CANCELLED_Đã hủy');
  return ds
    .filter(d => trongVongGio(d.thoiGian, GIO_TINH_HUY_GAN_DAY))
    .sort((a, b) => new Date(b.thoiGian) - new Date(a.thoiGian));
}

function layDonCanhBao(rows) {
  const ketQua = { DO: [], CAM: [], VANG: [] };
  for (const don of rows) {
    const muc = alertService.tinhMucCanhBao(don);
    if (muc) {
      ketQua[muc].push({ sttKey: don.STT_Key, trangThai: don.TRANG_THAI_XUONG, soNgay: alertService.soNgayTu(don.NGAY_LEN_DON) });
    }
  }
  Object.values(ketQua).forEach(ds => ds.sort((a, b) => b.soNgay - a.soNgay));
  return ketQua;
}

// "Chưa xử lý" = ưu tiên NHƯNG chưa xong việc (chưa ship/chưa ở trạng thái kết thúc) — cùng 2 mốc
// alertService đang dùng để biết đơn nào không cần cảnh báo nữa (xem mục 3, spec doc).
function layDonUuTienChuaXuLy(rows) {
  return rows
    .filter(don => orderService.laUuTien(don)
      && !TRANG_THAI_KET_THUC.includes(don.TRANG_THAI_XUONG)
      && !TRANG_THAI_DA_SHIP.includes(don.TRANG_THAI_XUONG))
    .map(don => ({ sttKey: don.STT_Key, trangThai: don.TRANG_THAI_XUONG }));
}

// Đọc tab LogsTracking (tự tạo tay, xem trackingAutoService.js) — bọc try/catch RIÊNG, lỗi đọc (tab
// chưa tạo, mạng lỗi) trả mảng rỗng, KHÔNG throw, không làm hỏng 3 mục còn lại của trung tâm hành động.
async function layLoiTrackingGanDay() {
  try {
    const { rows } = await readTabCached(TAB_LOGS_TRACKING, 15000);
    return rows
      .filter(r => r.KetQua === 'Lỗi' && trongVongGio(r.ThoiGian, GIO_TINH_LOI_TRACKING_GAN_DAY))
      .map(r => ({ sttKey: r.STT_Key, thoiGian: r.ThoiGian, chiTiet: r.ChiTiet || '' }))
      .sort((a, b) => new Date(b.thoiGian) - new Date(a.thoiGian));
  } catch (err) {
    console.error('[TrungTamHanhDong] Lỗi đọc tab LogsTracking (có thể chưa tạo tab):', err.message);
    return [];
  }
}

async function layTrungTamHanhDong() {
  const { rows } = await orderService.getAll();
  const [huyGanDay, loiTrackingGke] = await Promise.all([layDonHuyGanDay(), layLoiTrackingGanDay()]);
  return {
    huyGanDay,
    canhBao: layDonCanhBao(rows),
    uuTienChuaXuLy: layDonUuTienChuaXuLy(rows),
    loiTrackingGke,
  };
}

module.exports = { layTrungTamHanhDong };
