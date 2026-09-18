// "Đơn hàng loạt" (DHLXX) — dữ liệu CHÍNH THỨC do admin/ve_file chủ động xác nhận/quản lý, TÁCH BIỆT
// hoàn toàn với NHOM_HANG_LOAT (gợi ý tự động theo ảnh, xem services/perceptualHashService.js) — quét
// gợi ý lại bao nhiêu lần cũng không đụng tới dữ liệu ở đây. Xem đầy đủ thiết kế tại
// docs/superpowers/specs/2026-09-13-quan-ly-don-hang-loat-design.md (thiết kế gốc, Sheets) và
// docs/superpowers/specs/2026-09-19-don-hang-loat-sqlite-design.md (chuyển sang SQLite, 2 bảng
// nhom/thanh_vien + xoá thật, bổ sung 19/09/2026).
const orderService = require('./orderService');
const caiDatDbService = require('./caiDatDbService');
const donHangLoatDbService = require('./donHangLoatDbService');
const { ghiLog } = require('./logService');
const { thoiGianVNISOString } = require('./dateUtils');
const { laAdmin } = require('../middleware/auth');

// Ngưỡng tính theo SỐ BIT KHÁC NHAU tuyệt đối trên tổng 256 bit của hash hiện tại (bổ sung 15/09/2026,
// xem services/perceptualHashService.js — lưới hash tăng từ 64 lên 256 bit để phân biệt tốt hơn các
// thiết kế chữ ngắn khác nhau). NGUONG_TOI_DA/NGUONG_MAC_DINH nhân 4 theo đúng tỉ lệ so với lưới 64 bit
// cũ (32→128, 8→32) để giữ NGUYÊN Ý NGHĨA tương đối (vẫn "tối đa 50% khác nhau", vẫn mức mặc định
// ~12.5%) — ngưỡng CŨ đã lưu trong CaiDatHangLoat (vd '8' dưới thang 64 bit cũ) sẽ bị hiểu SAI theo
// thang mới (8/256 = 3% thay vì 8/64 = 12.5%, tức chặt hơn hẳn dự định ban đầu) — cần người dùng tự
// kiểm tra/đặt lại giá trị ngưỡng sau khi nâng cấp này nếu trước đó có đặt khác mặc định.
const NGUONG_MAC_DINH = 32;
const NGUONG_TOI_THIEU = 0;
const NGUONG_TOI_DA = 128;

// Đọc ngưỡng hiện tại — bảng SQLite cai_dat_hang_loat (bổ sung 19/09/2026, xem
// services/caiDatDbService.js). Chưa từng đặt lần nào (chưa migrate/chưa ai lưu) → dùng mặc định,
// KHÔNG chặn tính năng quét "Đơn hàng loạt" gợi ý (routes/orders.js).
async function layNguong() {
  const dong = caiDatDbService.layCaiDatHangLoat();
  if (!dong || dong.NGUONG_HAMMING === '' || dong.NGUONG_HAMMING === undefined) return NGUONG_MAC_DINH;
  const so = Number(dong.NGUONG_HAMMING);
  return Number.isFinite(so) ? so : NGUONG_MAC_DINH;
}

// Ghi ngưỡng mới.
async function datNguong(nguongMoi, user) {
  const so = Number(nguongMoi);
  if (!Number.isInteger(so) || so < NGUONG_TOI_THIEU || so > NGUONG_TOI_DA) {
    throw new Error(`Ngưỡng phải là số nguyên từ ${NGUONG_TOI_THIEU} đến ${NGUONG_TOI_DA}.`);
  }
  caiDatDbService.datCaiDatHangLoat(so);
  await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'DOI_NGUONG_HANG_LOAT', chiTiet: { nguong: so } });
}

// Bản NHẸ, tìm theo TỪ KHOÁ trong TÊN nhóm (không phân biệt hoa/thường, khớp chuỗi con — KHÔNG cần
// đúng nguyên tên) — dùng cho ô lọc "Đơn hàng loạt" ở Danh sách đơn hàng (routes/orders.js GET /,
// đổi từ lọc đúng mã sang tìm theo tên 13/09/2026, theo yêu cầu người dùng vì tên sắp tới sẽ dài hơn
// theo mẫu DHLXX_<mã đơn đầu>_<mô tả>). Gộp STT_Key của MỌI nhóm có tên khớp từ khoá, không chỉ 1
// nhóm — vd gõ "áo thun" khớp cả 2 nhóm khác nhau cùng có "áo thun" trong tên. KHÔNG tự lọc theo
// Xưởng ở đây — nơi gọi (GET /orders) đã tự lọc `list` theo Xưởng người xem TRƯỚC khi áp dụng bộ lọc
// này (đúng nguyên tắc đang dùng cho xuong=/uuTien= ngay phía trên), nên dù khớp phải nhóm có đơn
// ngoài Xưởng cũng chỉ khiến kết quả bị thu hẹp thêm, không lộ thêm dữ liệu.
async function layDanhSachSttKeyTheoTenNhom(tuKhoa) {
  const tuKhoaChuanHoa = String(tuKhoa || '').trim().toLowerCase();
  if (!tuKhoaChuanHoa) return new Set();
  const maNhomKhop = new Set(
    donHangLoatDbService.layTatCaNhom()
      .filter(n => String(n.TenNhom || '').toLowerCase().includes(tuKhoaChuanHoa))
      .map(n => n.MaDonHangLoat)
  );
  return new Set(
    donHangLoatDbService.layTatCaThanhVienVoiTenNhom()
      .filter(tv => maNhomKhop.has(tv.MaDonHangLoat))
      .map(tv => tv.STT_Key)
  );
}

// Liệt kê mọi "Đơn hàng loạt", kèm thông tin hiển thị của từng đơn (join với Don_Hang_ALL — bảng
// dhl_thanh_vien KHÔNG tự lưu lại ảnh/tên sản phẩm, tránh 2 nguồn sự thật lệch nhau khi đơn gốc đổi
// ảnh/tên).
async function layDanhSachNhom(user) {
  const thanhVien = donHangLoatDbService.layTatCaThanhVienVoiTenNhom();
  if (thanhVien.length === 0) return [];

  const { banDoTheoKey } = await orderService.getManyByKeys([...new Set(thanhVien.map(r => r.STT_Key))]);

  const theoNhom = new Map();
  for (const r of thanhVien) {
    const don = banDoTheoKey.get(r.STT_Key);
    if (!don) continue; // đơn đã bị xoá khỏi Don_Hang_ALL — bỏ qua, không vỡ trang
    if (!theoNhom.has(r.MaDonHangLoat)) {
      theoNhom.set(r.MaDonHangLoat, { maDonHangLoat: r.MaDonHangLoat, tenNhom: r.TenNhom, donHang: [] });
    }
    theoNhom.get(r.MaDonHangLoat).donHang.push({
      STT_Key: don.STT_Key,
      TieuDeSanPham: orderService.tieuDeSanPham(don),
      DUONG_DAN_URL: don.DUONG_DAN_URL || '',
      // MOCKUP — kèm theo để trang hiển thị (public/don-hang-loat.html) có thể hiện tạm ảnh Mockup
      // (gán nhãn rõ) cho đơn KHÔNG có PNG, đúng ảnh THẬT đã dùng để tính hash khi quét (bổ sung
      // 13/09/2026, theo yêu cầu người dùng — xem routes/orders.js#anhSoSanhCuaDon).
      MOCKUP: don.MOCKUP || '',
      XUONG: don.XUONG || '',
    });
  }

  let nhoms = [...theoNhom.values()];
  // admin xem hết; vai trò khác CHỈ xem nhóm mà MỌI đơn đều thuộc Xưởng mình — khác trang rà soát gợi
  // ý (chỉ đọc, có thể lọc bớt từng đơn), trang này có thao tác SỬA/XOÁ nên ẩn HẲN cả nhóm nếu có dù
  // chỉ 1 đơn ngoài Xưởng (an toàn hơn hiện thiếu — tránh sửa/xoá nhầm 1 nhóm tưởng đủ mà thực ra bị
  // ẩn bớt đơn, xem mục 2.1 spec — về lý thuyết không nên xảy ra vì đã chặn khác Xưởng lúc tạo/thêm,
  // đây là phòng hờ dữ liệu bị đổi Xưởng sau đó qua routes/orders.js POST /gan-xuong).
  if (!laAdmin(user.vaiTro)) {
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

  // CHẶN nếu có bất kỳ đơn nào đã thuộc 1 nhóm KHÁC (1 đơn chỉ được thuộc đúng 1 lô — bổ sung
  // 13/09/2026, theo yêu cầu người dùng). Chặn CẢ LÔ (không tạo 1 phần).
  const dangONhomKhac = sttKeyDuyNhat
    .map(sttKey => ({ sttKey, nhomKhac: donHangLoatDbService.layNhomCuaDon(sttKey) }))
    .filter(x => x.nhomKhac);
  if (dangONhomKhac.length > 0) {
    throw new Error(
      'Không thể tạo — các đơn sau đã thuộc 1 Đơn hàng loạt khác (1 đơn chỉ được thuộc đúng 1 lô): ' +
      dangONhomKhac.map(x => `${x.sttKey} (đang ở ${x.nhomKhac.MaDonHangLoat} — "${x.nhomKhac.TenNhom}")`).join('; ')
    );
  }

  const ngay = thoiGianVNISOString();
  const tenDaCat = tenNhom.trim();

  const maMoi = donHangLoatDbService.taoNhomMoi({
    tenNhom: tenDaCat, ngayXacNhan: ngay, nguoiXacNhan: user.ten, sttKeys: sttKeyDuyNhat,
  });

  await ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'XAC_NHAN_HANG_LOAT',
    chiTiet: { maDonHangLoat: maMoi, tenNhom: tenDaCat, sttKeys: sttKeyDuyNhat },
  });
  return maMoi;
}

// Thêm 1 HOẶC NHIỀU đơn vào nhóm cùng lúc (bổ sung 13/09/2026, theo yêu cầu người dùng — nút "THÊM VÀO
// ĐƠN HÀNG LOẠT" ở public/orders.html cho phép chọn nhiều đơn 1 lượt qua tick sẵn có, thay vì gõ tay
// từng mã ở public/don-hang-loat.html). KHÔNG dừng cả lô vì 1 vài đơn lỗi (đã có sẵn/không tồn tại/
// khác Xưởng) — trả {thanhCong, loi} như mọi thao tác hàng loạt khác trong app (xem routes/orders.js
// POST /danh-dau-uu-tien), phần hợp lệ vẫn được ghi.
async function themDonVaoNhom(maDonHangLoat, sttKeys, user) {
  const dsSttKeys = Array.isArray(sttKeys) ? sttKeys : [sttKeys]; // tương thích gọi với 1 chuỗi đơn lẻ
  if (dsSttKeys.length === 0 || dsSttKeys.some(k => typeof k !== 'string' || !k)) {
    throw new Error('Cần ít nhất 1 mã đơn hợp lệ.');
  }
  const sttKeyDuyNhat = [...new Set(dsSttKeys)];

  if (!donHangLoatDbService.layNhom(maDonHangLoat)) throw new Error(`Không tìm thấy Đơn hàng loạt: ${maDonHangLoat}`);
  const sttKeyDaCoSan = new Set(donHangLoatDbService.layThanhVienCuaNhom(maDonHangLoat));

  const { banDoTheoKey } = await orderService.getManyByKeys([...new Set([...sttKeyDuyNhat, ...sttKeyDaCoSan])]);
  const xuongNhom = (banDoTheoKey.get([...sttKeyDaCoSan][0]) || {}).XUONG;

  const thanhCong = [];
  const loi = [];
  const donCanGhi = [];
  for (const sttKey of sttKeyDuyNhat) {
    if (sttKeyDaCoSan.has(sttKey)) { loi.push({ sttKey, lyDo: 'Đã có trong nhóm này' }); continue; }
    const don = banDoTheoKey.get(sttKey);
    if (!don) { loi.push({ sttKey, lyDo: 'Không tìm thấy đơn hàng' }); continue; }
    if (!orderService.coQuyenTheoXuong(user, don)) { loi.push({ sttKey, lyDo: 'Không có quyền (khác Xưởng của bạn)' }); continue; }
    if (don.XUONG !== xuongNhom) { loi.push({ sttKey, lyDo: `Khác Xưởng với nhóm hiện có (${xuongNhom || 'chưa gán'})` }); continue; }
    // CHẶN — 1 đơn chỉ được thuộc đúng 1 Đơn hàng loạt (bổ sung 13/09/2026, theo yêu cầu người dùng).
    // Chỉ loại BỎ đúng đơn này khỏi lượt thêm (đẩy vào loi), KHÔNG chặn cả lô — khớp cách hàm này đã
    // xử lý 3 lý do lỗi khác ở trên (mỗi đơn tự đứng lỗi riêng, phần còn lại vẫn được thêm).
    const nhomKhac = donHangLoatDbService.layNhomCuaDon(sttKey);
    if (nhomKhac && nhomKhac.MaDonHangLoat !== maDonHangLoat) {
      loi.push({ sttKey, lyDo: `Đã thuộc Đơn hàng loạt khác (${nhomKhac.MaDonHangLoat} — "${nhomKhac.TenNhom}")` });
      continue;
    }
    donCanGhi.push(sttKey);
    thanhCong.push(sttKey);
  }

  if (donCanGhi.length > 0) {
    donHangLoatDbService.themThanhVien(maDonHangLoat, donCanGhi);
    await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'THEM_DON_HANG_LOAT', chiTiet: { maDonHangLoat, sttKeys: thanhCong } });
  }

  return { thanhCong, loi };
}

async function xoaDonKhoiNhom(maDonHangLoat, sttKey, user) {
  if (!donHangLoatDbService.layNhom(maDonHangLoat)) throw new Error(`Không tìm thấy Đơn hàng loạt: ${maDonHangLoat}`);
  const dangTrongNhom = donHangLoatDbService.layThanhVienCuaNhom(maDonHangLoat).includes(sttKey);
  if (!dangTrongNhom) throw new Error(`Đơn ${sttKey} không nằm trong nhóm ${maDonHangLoat}.`);

  donHangLoatDbService.xoaThanhVien(maDonHangLoat, sttKey);
  await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'XOA_DON_HANG_LOAT', sttKey, chiTiet: { maDonHangLoat } });
}

async function doiTenNhom(maDonHangLoat, tenMoi, user) {
  if (!tenMoi || typeof tenMoi !== 'string' || !tenMoi.trim()) {
    throw new Error('Tên nhóm không được để trống.');
  }
  if (!donHangLoatDbService.layNhom(maDonHangLoat)) throw new Error(`Không tìm thấy Đơn hàng loạt: ${maDonHangLoat}`);
  const tenDaCat = tenMoi.trim();

  donHangLoatDbService.doiTenNhom(maDonHangLoat, tenDaCat);
  await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'DOI_TEN_HANG_LOAT', chiTiet: { maDonHangLoat, tenMoi: tenDaCat } });
}

async function xoaNhom(maDonHangLoat, user) {
  if (!donHangLoatDbService.layNhom(maDonHangLoat)) throw new Error(`Không tìm thấy Đơn hàng loạt: ${maDonHangLoat}`);

  donHangLoatDbService.xoaNhom(maDonHangLoat);
  await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'XOA_NHOM_HANG_LOAT', chiTiet: { maDonHangLoat } });
}

module.exports = {
  layNguong, datNguong, layDanhSachNhom, layDanhSachSttKeyTheoTenNhom,
  xacNhanNhomMoi, themDonVaoNhom, xoaDonKhoiNhom, doiTenNhom, xoaNhom,
};
