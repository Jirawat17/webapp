// "Đơn hàng loạt" (DHLXX) — dữ liệu CHÍNH THỨC do admin/ve_file chủ động xác nhận/quản lý, TÁCH BIỆT
// hoàn toàn với NHOM_HANG_LOAT (gợi ý tự động theo ảnh, xem services/perceptualHashService.js) — quét
// gợi ý lại bao nhiêu lần cũng không đụng tới dữ liệu ở đây. Xem đầy đủ thiết kế tại
// docs/superpowers/specs/2026-09-13-quan-ly-don-hang-loat-design.md.
const { readTab, readTabCached, appendRow, appendRows, updateCells, updateCellsManyRows } = require('./sheetsService');
const orderService = require('./orderService');
const { ghiLog } = require('./logService');
const { thoiGianVNISOString } = require('./dateUtils');

const TAB = 'DonHangLoat';
const TAB_CAU_HINH = 'CaiDatHangLoat';
const NGUONG_MAC_DINH = 8;
const NGUONG_TOI_THIEU = 0;
const NGUONG_TOI_DA = 32;

function dongDangHoatDong(r) {
  return String(r.DaXoa || '').toUpperCase() !== 'TRUE';
}

// Đọc ngưỡng hiện tại — tab CaiDatHangLoat do người dùng tự tạo trước (1 cột NGUONG_HAMMING, đúng 1
// dòng dữ liệu). Đúng khuôn mẫu đã chứng minh hoạt động tốt của
// services/trackingAutoService.js#layCauHinh: CHƯA tạo tab/chưa có dòng nào → coi như dùng mặc định,
// KHÔNG chặn tính năng quét "Đơn hàng loạt" gợi ý (routes/orders.js).
async function layNguong() {
  try {
    const { rows } = await readTabCached(TAB_CAU_HINH, 60000);
    const dong = rows[0];
    if (!dong || dong.NGUONG_HAMMING === '' || dong.NGUONG_HAMMING === undefined) return NGUONG_MAC_DINH;
    const so = Number(dong.NGUONG_HAMMING);
    return Number.isFinite(so) ? so : NGUONG_MAC_DINH;
  } catch (e) {
    console.error('[DonHangLoat] Không đọc được cấu hình ngưỡng (có thể chưa tạo tab CaiDatHangLoat):', e.message);
    return NGUONG_MAC_DINH;
  }
}

// Ghi ngưỡng mới — KHÁC layNguong(), ở đây báo lỗi rõ ràng nếu tab chưa tồn tại (người dùng đang chủ
// động muốn lưu, không thể âm thầm bỏ qua như lúc đọc để phục vụ quét).
async function datNguong(nguongMoi, user) {
  const so = Number(nguongMoi);
  if (!Number.isInteger(so) || so < NGUONG_TOI_THIEU || so > NGUONG_TOI_DA) {
    throw new Error(`Ngưỡng phải là số nguyên từ ${NGUONG_TOI_THIEU} đến ${NGUONG_TOI_DA}.`);
  }
  const { headers, rows } = await readTab(TAB_CAU_HINH).catch(() => {
    throw new Error(`Chưa tìm thấy tab '${TAB_CAU_HINH}' trong Google Sheet — hãy tạo tab này với 1 cột NGUONG_HAMMING trước.`);
  });

  if (rows[0]) {
    await updateCells(TAB_CAU_HINH, headers, rows[0]._row, { NGUONG_HAMMING: so });
  } else {
    await appendRow(TAB_CAU_HINH, headers, { NGUONG_HAMMING: so });
  }
  await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'DOI_NGUONG_HANG_LOAT', chiTiet: { nguong: so } });
}

// Mã DHLXX tăng dần — quét CẢ dòng đã DaXoa để không bao giờ cấp trùng số cũ.
function sinhMaMoi(rows) {
  let soLonNhat = 0;
  for (const r of rows) {
    const khop = /^DHL(\d+)$/.exec(r.MaDonHangLoat || '');
    if (khop) soLonNhat = Math.max(soLonNhat, Number(khop[1]));
  }
  return 'DHL' + String(soLonNhat + 1).padStart(2, '0');
}

// Bản NHẸ, chỉ trả về tập STT_Key thuộc 1 mã nhóm — dùng cho bộ lọc "Đơn hàng loạt" ở Danh sách đơn
// hàng (routes/orders.js GET /), không cần join thông tin hiển thị như layDanhSachNhom(). KHÔNG tự
// lọc theo Xưởng ở đây — nơi gọi (GET /orders) đã tự lọc `list` theo Xưởng người xem TRƯỚC khi áp
// dụng bộ lọc này (đúng nguyên tắc đang dùng cho xuong=/uuTien= ngay phía trên), nên dù lỡ truyền mã
// nhóm ngoài Xưởng cũng chỉ khiến kết quả rỗng, không lộ thêm dữ liệu.
async function layDanhSachSttKeyTheoNhom(maDonHangLoat) {
  try {
    const { rows } = await readTabCached(TAB, 5000);
    return new Set(rows.filter(r => r.MaDonHangLoat === maDonHangLoat && dongDangHoatDong(r)).map(r => r.STT_Key));
  } catch (e) {
    console.error('[DonHangLoat] Không đọc được tab DonHangLoat (có thể chưa tạo):', e.message);
    return new Set();
  }
}

// Liệt kê mọi "Đơn hàng loạt" đang hoạt động (bỏ dòng DaXoa=TRUE), kèm thông tin hiển thị của từng
// đơn (join với Don_Hang_ALL — tab DonHangLoat KHÔNG tự lưu lại ảnh/tên sản phẩm, tránh 2 nguồn sự
// thật lệch nhau khi đơn gốc đổi ảnh/tên).
async function layDanhSachNhom(user) {
  let rows;
  try {
    ({ rows } = await readTabCached(TAB, 5000));
  } catch (e) {
    console.error('[DonHangLoat] Không đọc được tab DonHangLoat (có thể chưa tạo):', e.message);
    return [];
  }

  const dangHoatDong = rows.filter(dongDangHoatDong);
  if (dangHoatDong.length === 0) return [];

  const { banDoTheoKey } = await orderService.getManyByKeys([...new Set(dangHoatDong.map(r => r.STT_Key))]);

  const theoNhom = new Map();
  for (const r of dangHoatDong) {
    const don = banDoTheoKey.get(r.STT_Key);
    if (!don) continue; // đơn đã bị xoá khỏi Don_Hang_ALL — bỏ qua, không vỡ trang
    if (!theoNhom.has(r.MaDonHangLoat)) {
      theoNhom.set(r.MaDonHangLoat, { maDonHangLoat: r.MaDonHangLoat, tenNhom: r.TenNhom, donHang: [] });
    }
    theoNhom.get(r.MaDonHangLoat).donHang.push({
      STT_Key: don.STT_Key,
      TieuDeSanPham: orderService.tieuDeSanPham(don),
      DUONG_DAN_URL: don.DUONG_DAN_URL || '',
      XUONG: don.XUONG || '',
    });
  }

  let nhoms = [...theoNhom.values()];
  // admin xem hết; vai trò khác CHỈ xem nhóm mà MỌI đơn đều thuộc Xưởng mình — khác trang rà soát gợi
  // ý (chỉ đọc, có thể lọc bớt từng đơn), trang này có thao tác SỬA/XOÁ nên ẩn HẲN cả nhóm nếu có dù
  // chỉ 1 đơn ngoài Xưởng (an toàn hơn hiện thiếu — tránh sửa/xoá nhầm 1 nhóm tưởng đủ mà thực ra bị
  // ẩn bớt đơn, xem mục 2.1 spec — về lý thuyết không nên xảy ra vì đã chặn khác Xưởng lúc tạo/thêm,
  // đây là phòng hờ dữ liệu bị đổi Xưởng sau đó qua routes/orders.js POST /gan-xuong).
  if (user.vaiTro !== 'admin') {
    nhoms = user.xuong ? nhoms.filter(n => n.donHang.every(d => d.XUONG === user.xuong)) : [];
  }
  return nhoms.sort((a, b) => a.maDonHangLoat.localeCompare(b.maDonHangLoat));
}

// Kiểm tra + trả về danh sách đơn thật ứng với sttKeys — dùng chung cho xác nhận nhóm mới/thêm đơn.
// Chặn: đơn không tồn tại, người gọi không có quyền Xưởng với đơn đó (coQuyenTheoXuong).
async function layDonDaKiemTraQuyen(sttKeys, user) {
  const { banDoTheoKey } = await orderService.getManyByKeys(sttKeys);
  return sttKeys.map(k => {
    const don = banDoTheoKey.get(k);
    if (!don) throw new Error(`Không tìm thấy đơn hàng: ${k}`);
    if (!orderService.coQuyenTheoXuong(user, don)) throw new Error(`Không có quyền với đơn ${k} (khác Xưởng).`);
    return don;
  });
}

async function docTabGhi() {
  return readTab(TAB).catch(() => {
    throw new Error(
      `Chưa tìm thấy tab '${TAB}' trong Google Sheet — hãy tạo tab này với các cột MaDonHangLoat, ` +
      'TenNhom, STT_Key, NgayXacNhan, NguoiXacNhan, DaXoa trước.'
    );
  });
}

// Tạo "Đơn hàng loạt" mới từ 1 danh sách đơn cụ thể (dù đến từ việc "xác nhận" 1 nhóm gợi ý hay tự
// tay chọn/nhập mã — như nhau ở đây, phía route/frontend tự quyết định lấy sttKeys từ đâu).
async function xacNhanNhomMoi({ sttKeys, tenNhom }, user) {
  if (!Array.isArray(sttKeys) || sttKeys.length === 0 || sttKeys.some(k => typeof k !== 'string' || !k)) {
    throw new Error('Cần ít nhất 1 mã đơn hợp lệ để tạo Đơn hàng loạt.');
  }
  if (!tenNhom || typeof tenNhom !== 'string' || !tenNhom.trim()) {
    throw new Error('Cần đặt tên cho Đơn hàng loạt.');
  }

  const sttKeyDuyNhat = [...new Set(sttKeys)];
  const donList = await layDonDaKiemTraQuyen(sttKeyDuyNhat, user);

  const xuongDauTien = donList[0].XUONG;
  if (!xuongDauTien || donList.some(d => d.XUONG !== xuongDauTien)) {
    throw new Error('Mọi đơn trong 1 Đơn hàng loạt phải cùng Xưởng.');
  }

  const { headers, rows } = await docTabGhi();
  const maMoi = sinhMaMoi(rows);
  const ngay = thoiGianVNISOString();
  const tenDaCat = tenNhom.trim();

  await appendRows(TAB, headers, donList.map(don => ({
    MaDonHangLoat: maMoi, TenNhom: tenDaCat, STT_Key: don.STT_Key,
    NgayXacNhan: ngay, NguoiXacNhan: user.ten, DaXoa: 'FALSE',
  })));

  await ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'XAC_NHAN_HANG_LOAT',
    chiTiet: { maDonHangLoat: maMoi, tenNhom: tenDaCat, sttKeys: sttKeyDuyNhat },
  });
  return maMoi;
}

// Lấy các dòng ĐANG HOẠT ĐỘNG của đúng 1 mã nhóm — dùng chung cho thêm/xoá đơn, đổi tên, xoá nhóm.
async function layDongCuaNhom(maDonHangLoat, headers, rows) {
  const dong = rows.filter(r => r.MaDonHangLoat === maDonHangLoat && dongDangHoatDong(r));
  if (dong.length === 0) throw new Error(`Không tìm thấy Đơn hàng loạt: ${maDonHangLoat}`);
  return dong;
}

async function themDonVaoNhom(maDonHangLoat, sttKey, user) {
  const { headers, rows } = await docTabGhi();
  const dongHienCo = await layDongCuaNhom(maDonHangLoat, headers, rows);

  if (dongHienCo.some(r => r.STT_Key === sttKey)) {
    throw new Error(`Đơn ${sttKey} đã có trong nhóm này.`);
  }
  const [don] = await layDonDaKiemTraQuyen([sttKey], user);

  const { banDoTheoKey } = await orderService.getManyByKeys(dongHienCo.map(r => r.STT_Key));
  const xuongNhom = (banDoTheoKey.get(dongHienCo[0].STT_Key) || {}).XUONG;
  if (don.XUONG !== xuongNhom) {
    throw new Error(`Đơn ${sttKey} khác Xưởng với các đơn hiện có trong nhóm (${xuongNhom || 'chưa gán'}).`);
  }

  await appendRow(TAB, headers, {
    MaDonHangLoat: maDonHangLoat, TenNhom: dongHienCo[0].TenNhom, STT_Key: sttKey,
    NgayXacNhan: thoiGianVNISOString(), NguoiXacNhan: user.ten, DaXoa: 'FALSE',
  });
  await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'THEM_DON_HANG_LOAT', sttKey, chiTiet: { maDonHangLoat } });
}

async function xoaDonKhoiNhom(maDonHangLoat, sttKey, user) {
  const { headers, rows } = await docTabGhi();
  const dongHienCo = await layDongCuaNhom(maDonHangLoat, headers, rows);
  const dong = dongHienCo.find(r => r.STT_Key === sttKey);
  if (!dong) throw new Error(`Đơn ${sttKey} không nằm trong nhóm ${maDonHangLoat}.`);

  await updateCells(TAB, headers, dong._row, { DaXoa: 'TRUE' });
  await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'XOA_DON_HANG_LOAT', sttKey, chiTiet: { maDonHangLoat } });
}

async function doiTenNhom(maDonHangLoat, tenMoi, user) {
  if (!tenMoi || typeof tenMoi !== 'string' || !tenMoi.trim()) {
    throw new Error('Tên nhóm không được để trống.');
  }
  const { headers, rows } = await docTabGhi();
  const dongHienCo = await layDongCuaNhom(maDonHangLoat, headers, rows);
  const tenDaCat = tenMoi.trim();

  await updateCellsManyRows(TAB, headers, dongHienCo.map(r => ({ rowNumber: r._row, updates: { TenNhom: tenDaCat } })));
  await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'DOI_TEN_HANG_LOAT', chiTiet: { maDonHangLoat, tenMoi: tenDaCat } });
}

async function xoaNhom(maDonHangLoat, user) {
  const { headers, rows } = await docTabGhi();
  const dongHienCo = await layDongCuaNhom(maDonHangLoat, headers, rows);

  await updateCellsManyRows(TAB, headers, dongHienCo.map(r => ({ rowNumber: r._row, updates: { DaXoa: 'TRUE' } })));
  await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'XOA_NHOM_HANG_LOAT', chiTiet: { maDonHangLoat } });
}

module.exports = {
  layNguong, datNguong, layDanhSachNhom, layDanhSachSttKeyTheoNhom,
  xacNhanNhomMoi, themDonVaoNhom, xoaDonKhoiNhom, doiTenNhom, xoaNhom,
};
