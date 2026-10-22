const orderService = require('./orderService');
const logService = require('./logService');
const nhatKyDbService = require('./nhatKyDbService');
const { TRANG_THAI_KET_THUC, TRANG_THAI_DA_SHIP } = require('../data/pipelineTinhTrang');
const donNhieuAoService = require('./donNhieuAoService');

// Trung tâm hành động (bổ sung 14/09/2026, xem
// docs/superpowers/specs/2026-09-14-trung-tam-hanh-dong-design.md) — gom 4 loại "việc cần xử lý" cho
// admin, tất cả tính trực tiếp từ dữ liệu/hàm ĐÃ CÓ (không thêm cột Sheet mới nào).
//
// CẬP NHẬT 18/09/2026, theo yêu cầu người dùng: đổi thứ tự hiển thị + đổi bộ 4 mục — bỏ hẳn "Đơn cảnh
// báo trễ hạn" (mức DO/CAM/VÀNG, alertService), thay bằng "Đơn LỖI SẢN XUẤT CẦN LÀM LẠI"; nới 2 mốc
// thời gian 12h/24h lên cùng 48h. Thứ tự hiển thị THẬT do public/trung-tam-hanh-dong.html quyết định
// (thứ tự field trả về ở đây không ảnh hưởng) — sửa cả 2 nơi cho khớp.
const GIO_TINH_HUY_GAN_DAY = 48;
const GIO_TINH_LOI_TRACKING_GAN_DAY = 48;

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

// Đơn "LỖI SẢN XUẤT CẦN LÀM LẠI" — cần ai đó chủ động lấy lại phôi/vẽ lại file trước khi đưa lại vào
// dây chuyền (bổ sung 18/09/2026, theo yêu cầu người dùng, thay cho mục "Đơn cảnh báo trễ hạn" cũ).
// Kèm trạng thái phôi/vẽ file hiện tại — hữu ích để biết đơn đã được reset lại chưa hay còn nguyên như
// lúc lỗi.
function layDonLoiSanXuat(rows) {
  return rows
    .filter(don => don.TRANG_THAI_XUONG === 'LỖI SẢN XUẤT CẦN LÀM LẠI')
    .map(don => ({ sttKey: don.STT_Key, trangThaiPhoi: don.TRANG_THAI_PHOI, trangThaiVeFile: don.TRANG_THAI_VE_FILE }));
}

// "Chưa xử lý" = ưu tiên NHƯNG chưa xong việc (chưa ship/chưa ở trạng thái kết thúc) — cùng 2 mốc
// alertService đang dùng để biết đơn nào không cần cảnh báo nữa (xem mục 3, spec doc).
// Ngày lên đơn dạng ngắn "15/10" ('' nếu không đọc được) — dùng chung các mục của Trung tâm hành động (22/10/2026, theo yêu cầu người dùng).
function ngayLenDonNgan(r) {
  const ngay = r && require('./dateUtils').parseNgay(r.NGAY_LEN_DON);
  return ngay ? `${ngay.getDate()}/${ngay.getMonth() + 1}` : '';
}

function layDonUuTienChuaXuLy(rows) {
  return rows
    .filter(don => orderService.laUuTien(don)
      && !TRANG_THAI_KET_THUC.includes(don.TRANG_THAI_XUONG)
      && !TRANG_THAI_DA_SHIP.includes(don.TRANG_THAI_XUONG))
    .map(don => ({ sttKey: don.STT_Key, trangThai: don.TRANG_THAI_XUONG, ngayLenDon: ngayLenDonNgan(don) }));
}
// "Đã xử lý" (22/10/2026, theo yêu cầu người dùng): ẩn đơn ưu tiên trong lúc đơn còn ở ĐÚNG trạng thái lúc bấm; trạng thái đổi mà đơn vẫn
// ưu tiên, chưa xong -> hiện lại (cùng cơ chế các mục "Đã xử lý" khác — vanHanhService.locDaXuLy, loại UU_TIEN).
const khoaUuTien = d => d.sttKey;
const giaTriUuTien = d => d.trangThai || '';
// tatCa: MỌI đơn (chưa lọc Xưởng) — để dọn bản ghi "Đã xử lý" của đơn đã xong / hết ưu tiên (bảng không phình mãi); hiển thị lọc theo phạm vi.
function layDonUuTienCanHien(tatCa, trongPhamVi) {
  const { locDaXuLy } = require('./vanHanhService');
  const tatCaUuTien = layDonUuTienChuaXuLy(tatCa);
  require('./nhatKyDbService').donDaXuLyKhongConDung('UU_TIEN', new Set(tatCaUuTien.map(khoaUuTien)));
  return locDaXuLy('UU_TIEN', tatCaUuTien.filter(d => trongPhamVi(d.sttKey)), khoaUuTien, giaTriUuTien)
    .map(d => ({ ...d, khoa: khoaUuTien(d), giaTri: giaTriUuTien(d) }));
}

// Đọc bảng SQLite logs_tracking (bổ sung 19/09/2026, xem services/nhatKyDbService.js) — bọc try/catch
// RIÊNG, lỗi đọc trả mảng rỗng, KHÔNG throw, không làm hỏng 3 mục còn lại của trung tâm hành động.
async function layLoiTrackingGanDay() {
  try {
    const rows = nhatKyDbService.layTatCaLogsTracking();
    return rows
      .filter(r => r.KetQua === 'Lỗi' && trongVongGio(r.ThoiGian, GIO_TINH_LOI_TRACKING_GAN_DAY))
      .map(r => ({ sttKey: r.STT_Key, thoiGian: r.ThoiGian, chiTiet: r.ChiTiet || '' }))
      .sort((a, b) => new Date(b.thoiGian) - new Date(a.thoiGian));
  } catch (err) {
    console.error('[TrungTamHanhDong] Lỗi đọc log tracking:', err.message);
    return [];
  }
}

// DonNhieuAo (bổ sung 26/09/2026): nhóm vừa bị huỷ (48 giờ, theo cùng danh sách huyGanDay) mà đơn ".1"
// ĐÃ mua tracking — hệ thống không tự huỷ vận đơn bên GKE, cần làm tay. Tự biến mất sau 48 giờ.
function layNhomHuyConTracking(rows, huyGanDay) {
  const vuaHuy = new Set(huyGanDay.map(d => d.sttKey));
  const ketQua = [];
  const daXet = new Set();
  for (const nhom of donNhieuAoService.xayDungBanDoNhom(rows).values()) {
    if (daXet.has(nhom.khoa)) continue;
    daXet.add(nhom.khoa);
    const d = nhom.donMua;
    // Chỉ khi CẢ nhóm đã huỷ — .1 huỷ riêng thì các đơn còn lại vẫn dùng tracking này, không phải huỷ vận đơn.
    const caNhomDaHuy = nhom.thanhVien.every(r => r.TRANG_THAI_XUONG === donNhieuAoService.TRANG_THAI_HUY);
    if (d && d.TRACKING_ID && caNhomDaHuy && nhom.thanhVien.some(r => vuaHuy.has(r.STT_Key))) {
      ketQua.push({ sttKey: d.STT_Key, goc: nhom.goc, trackingId: d.TRACKING_ID });
    }
  }
  return ketQua;
}

// Phạm vi Xưởng (29/09/2026, theo yêu cầu người dùng — admin chỉ thấy Xưởng mình phụ trách): mục tính từ đơn chỉ
// xét đơn trong phạm vi; mục tính từ log chỉ giữ dòng có đơn trong phạm vi; nhóm DonNhieuAo chỉ hiện khi MỌI đơn
// của nhóm trong phạm vi (cùng quy tắc Đơn hàng loạt). superadmin thấy tất cả.
async function layTrungTamHanhDong(user) {
  const { rows: tatCa } = await orderService.getAll();
  const rows = orderService.locTheoXuong(tatCa, user);
  const laSuperAdmin = require('../middleware/auth').laSuperAdmin(user.vaiTro);
  const trongPhamVi = orderService.phamViDon(user);
  const [huyTatCa, loiTrackingTatCa] = await Promise.all([layDonHuyGanDay(), layLoiTrackingGanDay()]);
  const [huyGanDay, loiTrackingGke] = [huyTatCa, loiTrackingTatCa].map(ds => ds.filter(d => trongPhamVi(d.sttKey)));
  return {
    ...layDonNhieuAoCanXuLy(tatCa, huyTatCa, trongPhamVi),
    huyGanDay,
    loiSanXuat: layDonLoiSanXuat(rows),
    uuTienChuaXuLy: layDonUuTienCanHien(tatCa, trongPhamVi),
    loiTrackingGke,
    // Chưa ghi được sang Sheet Seller (28/09/2026) — lần ghi gần nhất theo (đơn, loại) đang lỗi; Đẩy lại chỉ superadmin.
    loiSheetSeller: require('./nhatKyDbService').layLoiDongBoDangCho().filter(d => trongPhamVi(d.STT_Key)),
    // Y6 / L2 (11/10/2026): bỏ mục đã đánh dấu "Đã xử lý" với đúng giá trị hiện tại (C2).
    ...layCanhBaoVanHanh(rows),
    // ĐƠN CẦN CHECK (14/10/2026) — CHỈ superadmin; admin không nhận trường này.
    ...(laSuperAdmin ? { donCanCheck: await ganThongTinDonCanCheck(require('./nhatKyDbService').layDonCanCheck(false), tatCa) } : {}),
  };
}

// "DonNhieuAo cần xử lý" (17/10/2026, theo yêu cầu người dùng): mỗi dòng (lỗi dữ liệu nhóm / nhóm đã huỷ còn vận đơn GKE) có khoá + giá trị
// cho nút "Đã xử lý" (loại DON_NHIEU_AO, routes/actionCenter.js). Ẩn tới khi lỗi của nhóm ĐỔI (thêm/bớt đơn, đổi OrderID, lỗi khác; nhóm huỷ:
// đổi mã vận đơn) — người dùng chốt. Khoá bắt đầu bằng 1 mã đơn của nhóm (route kiểm tra phạm vi Xưởng theo mã đó).
// Kèm từng đơn: ngày lên đơn (d/m) + mức cảnh báo trễ hạn (DO/CAM/VANG như Danh sách đơn); mucCanhBao của dòng = mức cao nhất trong nhóm.
const THU_TU_MUC = { VANG: 1, CAM: 2, DO: 3 };
// huyTatCa: đơn huỷ 48 giờ CHƯA lọc phạm vi — dọn bản ghi "Đã xử lý" phải xét mọi nhóm, không chỉ nhóm người đang xem thấy.
function layDonNhieuAoCanXuLy(tatCa, huyTatCa, trongPhamVi) {
  const { locDaXuLy } = require('./vanHanhService');
  const { tinhMucCanhBao, layCauHinhCanhBao } = require('./alertService');
  const cauHinhCanhBao = layCauHinhCanhBao();
  const theoKey = new Map(tatCa.map(r => [r.STT_Key, r]));
  const thongTinDon = sttKey => {
    const r = theoKey.get(sttKey);
    return { sttKey, ngayLenDon: ngayLenDonNgan(r), mucCanhBao: r ? tinhMucCanhBao(r, cauHinhCanhBao) : null };
  };
  const ganDon = (d, sttKeys) => {
    const don = sttKeys.map(thongTinDon);
    const mucCanhBao = don.map(x => x.mucCanhBao).filter(Boolean).sort((a, b) => THU_TU_MUC[b] - THU_TU_MUC[a])[0] || null;
    return { ...d, don, mucCanhBao };
  };
  // Khoá có cả OrderID: 1 nhóm có thể ra 2 dòng cùng gốc + cùng mã đầu (lỗi riêng của nhóm, và "cùng gốc nhưng khác OrderID") — chung khoá
  // thì bấm "Đã xử lý" dòng này ghi đè bản ghi của dòng kia (INSERT OR REPLACE theo loai + khoa), không bao giờ ẩn được cả hai.
  const loi = donNhieuAoService.danhSachLoiDuLieu(tatCa)
    .map(n => ({ ...n, laHuy: false, khoa: `${n.sttKeys[0]}|LOI|${n.goc}|${n.orderId}`, giaTri: `${[...n.sttKeys].sort().join(',')}|${n.orderId}|${n.loi.join(' ')}` }));
  const huy = layNhomHuyConTracking(tatCa, huyTatCa)
    .map(n => ({ ...n, laHuy: true, khoa: `${n.sttKey}|HUY|${n.goc}`, giaTri: String(n.trackingId) }));
  const tatCaDong = [...loi, ...huy];
  // Dọn bản ghi "Đã xử lý" của nhóm không còn lỗi / đã đổi khoá (bảng không phình mãi) — xét TOÀN BỘ nhóm, trước khi lọc phạm vi.
  require('./nhatKyDbService').donDaXuLyKhongConDung('DON_NHIEU_AO', new Set(tatCaDong.map(d => d.khoa)));
  const conHien = locDaXuLy('DON_NHIEU_AO', tatCaDong, d => d.khoa, d => d.giaTri) // 1 lượt đọc "Đã xử lý" cho cả 2 loại dòng
    .filter(d => (d.laHuy ? trongPhamVi(d.sttKey) : d.sttKeys.every(trongPhamVi)));
  return {
    loiDonNhieuAo: conHien.filter(d => !d.laHuy).map(n => ganDon(n, n.sttKeys)),
    nhomHuyConTracking: conHien.filter(d => d.laHuy).map(n => ganDon(n, [n.sttKey])),
  };
}

// Thông tin đơn ĐANG CÓ (không lưu bản chụp) cho từng mã trong ghi chú cần check — đơn không còn thì tonTai = false.
async function ganThongTinDonCanCheck(dsGhiChu, tatCa) {
  const theoKey = new Map(tatCa.map(r => [r.STT_Key, r]));
  const canGan = [...new Set(dsGhiChu.flatMap(g => g.stt_keys))].map(k => theoKey.get(k)).filter(Boolean);
  const tenKhach = new Map((await orderService.ganTenKhachHang(canGan)).map(r => [r.STT_Key, r.TenKhachHang || '']));
  return dsGhiChu.map(g => ({ ...g, don: g.stt_keys.map(k => {
    const r = theoKey.get(k);
    return r ? { sttKey: k, tonTai: true, tieuDe: orderService.tieuDeSanPham(r), tenKhachHang: tenKhach.get(k) || '', trangThai: r.TRANG_THAI_XUONG || '', xuong: r.XUONG || '' }
      : { sttKey: k, tonTai: false };
  }) }));
}

function layCanhBaoVanHanh(rows) {
  const vanHanh = require('./vanHanhService');
  const { daGiaoThanhCongGke } = require('./trackingAutoService');
  const cauHinh = vanHanh.layCauHinh();
  // mucCanhBao (14/10/2026, theo yêu cầu người dùng): mức cảnh báo trễ hạn của đơn (DO/CAM/VANG/null — cùng mức ở Danh sách đơn,
  // services/alertService.js) để admin thấy ngay đơn nhận lâu nào đang trễ nặng; giữ nguyên thứ tự (người dùng chốt).
  const { tinhMucCanhBao, layCauHinhCanhBao } = require('./alertService');
  const cauHinhCanhBao = layCauHinhCanhBao();
  const theoKey = new Map(rows.map(r => [r.STT_Key, r]));
  return {
    nhanQuaLau: vanHanh.locDaXuLy('NHAN_LAU', vanHanh.donDangNhan(rows, cauHinh.y6).filter(vanHanh.canNhac), vanHanh.khoaY6, vanHanh.giaTriY6)
      .map(d => ({ ...d, khoa: vanHanh.khoaY6(d), giaTri: vanHanh.giaTriY6(d), mucCanhBao: tinhMucCanhBao(theoKey.get(d.sttKey), cauHinhCanhBao), ngayLenDon: ngayLenDonNgan(theoKey.get(d.sttKey)) })),
    vanChuyenBatThuong: vanHanh.locDaXuLy('VAN_CHUYEN',
      vanHanh.vanChuyenBatThuong(rows, cauHinh.l2, r => daGiaoThanhCongGke(r.MA_NODE_TRACKING, r.MA_TRANG_THAI_NODE_TRACKING)), vanHanh.khoaL2, vanHanh.giaTriL2)
      .map(d => ({ ...d, khoa: vanHanh.khoaL2(d), giaTri: vanHanh.giaTriL2(d), ngayLenDon: ngayLenDonNgan(theoKey.get(d.sttKey)) })),
    nguongNhan: cauHinh.y6,
  };
}

module.exports = { layTrungTamHanhDong, ganThongTinDonCanCheck };
