const { readTab, readTabCached, appendRow, updateCells } = require('./sheetsService');
const { ghiLog } = require('./logService');
const { thoiGianVNISOString } = require('./dateUtils');

// 2 TAB MỚI TRONG SHEET (phải tự tạo tay trên Google Sheet trước khi dùng tính năng này):
//   Ton_Kho_Phoi   — cột: LOAI | KICH_THUOC | MAU_SAC | TON_HIEN_TAI — mỗi dòng là 1 TỔ HỢP phôi
//                    (khớp đúng cả 3: loại áo + kích thước + màu sắc), TON_HIEN_TAI là số tồn hiện
//                    tại, CÓ THỂ ÂM (âm = báo hiệu thiếu phôi, cần nhập thêm — xem truKhoTheoDon).
//   LichSuNhapPhoi — cột: ThoiGian | LOAI | KICH_THUOC | MAU_SAC | SoLuongNhap | NguoiNhap | GhiChu
//                    — mỗi dòng là 1 lần nhập kho (lô hàng), CỘNG DỒN vào Ton_Kho_Phoi, không sửa/xoá.
const TAB_TON_KHO = 'Ton_Kho_Phoi';
const TAB_LICH_SU_NHAP = 'LichSuNhapPhoi';

// Chuẩn hoá để SO SÁNH (không đụng tới dữ liệu gốc lưu trong Sheet) — cắt khoảng trắng 2 đầu, gộp
// khoảng trắng lặp ở giữa, và không phân biệt hoa/thường, để "Đen"/"đen"/"ĐEN" hay "Sweat"/"SWEAT"
// được coi là cùng 1 loại phôi. CHỈ chuẩn hoá hoa/thường trong CÙNG 1 ngôn ngữ — không ánh xạ đồng
// nghĩa khác ngôn ngữ (vd "Đen"/"Black") vì dễ gộp nhầm 2 loại phôi thực sự khác nhau (đã xác nhận
// rõ với người dùng, cố ý KHÔNG làm mức này).
function chuan(str) {
  return String(str || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Xếp hàng theo TỔ HỢP phôi (bổ sung 22/09/2026, theo yêu cầu người dùng) — cùng khuôn với
// orderService.js#xepHangTheoDon. truKhoTheoDon/hoanKhoTheoDon (bên dưới) đều tự đọc TON_HIEN_TAI rồi
// tính tonMoi = cũ ± soLuong trước khi ghi — 2 đơn khác nhau nhưng CÙNG 1 tổ hợp phôi được quét gần
// như đồng thời (2 người quét song song "Đã lấy phôi" cho 2 đơn cùng mẫu) đều đọc cùng 1 giá trị cũ rồi
// ghi đè lẫn nhau, làm MẤT 1 lượt trừ kho thật (lost update) — chỉ khác nguồn gốc so với race đã sửa ở
// orderService.js#xepHangTheoDon (đó là race giữa 2 lượt update() CÙNG 1 ĐƠN; đây là race giữa 2 ĐƠN
// KHÁC NHAU nhưng CHUNG 1 dòng tồn kho). Khoá theo tổ hợp phôi (không khoá toàn cục) — phôi khác nhau
// vẫn trừ/hoàn kho song song bình thường. apDungThayDoiKhoHangLoat() (hàng loạt) không cần khoá này vì
// đã tự gộp+ghi 1 lần duy nhất cho cả lô, không có 2 lượt đọc-ghi rời nhau.
const _hangDoiTheoToHopPhoi = new Map(); // khoá tổ hợp -> Promise của lượt trừ/hoàn kho gần nhất đang xếp hàng
function xepHangTheoToHopPhoi(khoa, congViec) {
  const hangCho = (_hangDoiTheoToHopPhoi.get(khoa) || Promise.resolve()).catch(() => {});
  const luotNay = hangCho.then(congViec);
  _hangDoiTheoToHopPhoi.set(khoa, luotNay);
  luotNay.catch(() => {}).finally(() => {
    if (_hangDoiTheoToHopPhoi.get(khoa) === luotNay) _hangDoiTheoToHopPhoi.delete(khoa);
  });
  return luotNay;
}

// Khớp đúng CẢ 3 thông tin loại/kích thước/màu sắc — đây là "mã định danh" của 1 loại phôi, không
// có cột mã riêng nào khác để tra theo.
function khopLoaiPhoi(dong, loai, kichThuoc, mauSac) {
  return chuan(dong.LOAI) === chuan(loai) &&
    chuan(dong.KICH_THUOC) === chuan(kichThuoc) &&
    chuan(dong.MAU_SAC) === chuan(mauSac);
}

async function layTonKho() {
  const { rows } = await readTabCached(TAB_TON_KHO, 5000);
  return rows.map(r => ({ ...r, TON_HIEN_TAI: Number(r.TON_HIEN_TAI) || 0 }));
}

async function layLichSuNhap({ gioiHan = 50 } = {}) {
  const { rows } = await readTabCached(TAB_LICH_SU_NHAP, 5000);
  return rows
    .sort((a, b) => new Date(b.ThoiGian) - new Date(a.ThoiGian))
    .slice(0, Math.min(Number(gioiHan) || 50, 200));
}

// Nhập kho 1 lô phôi mới — cộng dồn vào tồn hiện tại (tạo dòng tồn kho mới bắt đầu từ 0 nếu đây là
// lần đầu tiên nhập loại phôi này), đồng thời lưu lại lịch sử để tra cứu/đối chiếu sau này.
async function nhapKho({ loai, kichThuoc, mauSac, soLuong, nguoiNhap, vaiTro, ghiChu = '' }) {
  const { headers, rows } = await readTab(TAB_TON_KHO); // đọc thật trước khi ghi, tránh ghi nhầm dòng
  const dong = rows.find(r => khopLoaiPhoi(r, loai, kichThuoc, mauSac));

  if (dong) {
    const tonMoi = (Number(dong.TON_HIEN_TAI) || 0) + soLuong;
    await updateCells(TAB_TON_KHO, headers, dong._row, { TON_HIEN_TAI: tonMoi });
  } else {
    await appendRow(TAB_TON_KHO, headers, { LOAI: loai, KICH_THUOC: kichThuoc, MAU_SAC: mauSac, TON_HIEN_TAI: soLuong });
  }

  const { headers: headersLichSu } = await readTab(TAB_LICH_SU_NHAP);
  await appendRow(TAB_LICH_SU_NHAP, headersLichSu, {
    ThoiGian: thoiGianVNISOString(),
    LOAI: loai, KICH_THUOC: kichThuoc, MAU_SAC: mauSac,
    SoLuongNhap: soLuong, NguoiNhap: nguoiNhap, GhiChu: ghiChu,
  });

  // Ghi thêm vào log trung tâm (LichSuHoatDong) — trước đây CHỈ có ở LichSuNhapPhoi riêng, không hiện
  // trong "Hoạt động của tôi"/công cụ tra cứu hoạt động chung của admin (xem
  // docs/superpowers/specs/2026-09-07-mo-rong-log-hoat-dong-design.md). Giữ nguyên LichSuNhapPhoi ở
  // trên — tab đó vẫn là nguồn dữ liệu cho trang Quản lý tài sản, không thay thế.
  ghiLog({
    nguoiDung: nguoiNhap, vaiTro: vaiTro || '-', hanhDong: 'NHAP_KHO_PHOI',
    chiTiet: { loai, kichThuoc, mauSac, soLuong, ghiChu },
  }).catch(err => console.error('[TaiSan] Lỗi ghi log nền:', err.message));
}

// TỰ ĐỘNG trừ kho khi 1 đơn được đánh dấu "Đã lấy phôi" (gọi từ orderService.update() — xem ở đó).
// Trừ đúng theo SO_LUONG của đơn, khớp loại phôi theo LOAI+KICH_THUOC+MAU_SAC. CHO PHÉP tồn xuống ÂM
// (đã xác nhận với người dùng) — không chặn thao tác lấy phôi thực tế, số âm chính là tín hiệu "thiếu
// phôi, cần nhập thêm" hiển thị trên trang Quản lý tài sản. Nếu chưa từng có dòng tồn kho cho tổ hợp
// này (chưa từng nhập kho loại đó) thì TỰ TẠO dòng mới bắt đầu từ 0 rồi trừ xuống âm luôn — không báo
// lỗi chặn đơn (cũng đã xác nhận với người dùng).
// Chuyển NGƯỢC lại "Chưa lấy phôi" giờ ĐƯỢC hoàn kho — xem hoanKhoTheoDon() ngay dưới đây (sửa
// 20/09/2026, phát hiện qua rà soát bảo mật: trước đây chỉ trừ 1 chiều, khiến chu trình "Đã lấy phôi ->
// Chưa lấy phôi -> Đã lấy phôi" trừ kho 2 lần cho đúng 1 lượt lấy phôi thật).
function truKhoTheoDon(donHang, user) {
  const khoa = `${chuan(donHang.LOAI)}|${chuan(donHang.KICH_THUOC)}|${chuan(donHang.MAU_SAC)}`;
  return xepHangTheoToHopPhoi(khoa, () => truKhoTheoDonThat(donHang, user));
}

async function truKhoTheoDonThat(donHang, user) {
  const soLuong = Number(donHang.SO_LUONG);
  if (!soLuong || soLuong <= 0) return; // thiếu/sai dữ liệu số lượng trên đơn — bỏ qua, không chặn đơn

  // Đọc qua cache (không cần fresh) — tồn kho phôi CHỈ mang tính theo dõi (xem chú thích ở trên và
  // orderService.update()), không phải điều kiện chặn thao tác lấy phôi thực tế, nên lệch vài giây
  // không gây hại. Đổi từ readTab (luôn fresh) sang cache ngắn để giảm tải: hàm này chạy kèm MỌI lượt
  // quét "Đã lấy phôi", kể cả trong vòng lặp xác nhận hàng loạt.
  const { headers, rows } = await readTabCached(TAB_TON_KHO, 5000);
  const dong = rows.find(r => khopLoaiPhoi(r, donHang.LOAI, donHang.KICH_THUOC, donHang.MAU_SAC));

  if (dong) {
    const tonMoi = (Number(dong.TON_HIEN_TAI) || 0) - soLuong;
    await updateCells(TAB_TON_KHO, headers, dong._row, { TON_HIEN_TAI: tonMoi });
  } else {
    await appendRow(TAB_TON_KHO, headers, {
      LOAI: donHang.LOAI || '', KICH_THUOC: donHang.KICH_THUOC || '', MAU_SAC: donHang.MAU_SAC || '',
      TON_HIEN_TAI: -soLuong,
    });
  }

  ghiLog({
    nguoiDung: (user && user.ten) || 'Hệ thống', vaiTro: (user && user.vaiTro) || '-',
    hanhDong: 'TRU_KHO_PHOI_TU_DON', sttKey: donHang.STT_Key,
    chiTiet: { loai: donHang.LOAI, kichThuoc: donHang.KICH_THUOC, mauSac: donHang.MAU_SAC, soLuong },
  }).catch(err => console.error('[TaiSan] Lỗi ghi log nền:', err.message));
}

// HOÀN kho khi đơn bị chuyển NGƯỢC LẠI từ "Đã lấy phôi" sang trạng thái khác (bổ sung 20/09/2026, phát
// hiện qua rà soát bảo mật) — đối xứng hoàn toàn với truKhoTheoDon() ở trên, cộng lại ĐÚNG SO_LUONG đã
// trừ trước đó, khớp loại phôi theo LOAI+KICH_THUOC+MAU_SAC. Thiếu hàm này khiến chu trình "Đã lấy
// phôi -> Chưa lấy phôi -> Đã lấy phôi" (sửa nhầm, bấm nhầm nút quick-toggle 2 lần...) trừ kho 2 LẦN
// cho đúng 1 lượt lấy phôi thật ngoài đời — xem orderService.js#update() nơi gọi hàm này.
function hoanKhoTheoDon(donHang, user) {
  const khoa = `${chuan(donHang.LOAI)}|${chuan(donHang.KICH_THUOC)}|${chuan(donHang.MAU_SAC)}`;
  return xepHangTheoToHopPhoi(khoa, () => hoanKhoTheoDonThat(donHang, user));
}

async function hoanKhoTheoDonThat(donHang, user) {
  const soLuong = Number(donHang.SO_LUONG);
  if (!soLuong || soLuong <= 0) return; // thiếu/sai dữ liệu số lượng trên đơn — bỏ qua, không chặn đơn

  const { headers, rows } = await readTabCached(TAB_TON_KHO, 5000);
  const dong = rows.find(r => khopLoaiPhoi(r, donHang.LOAI, donHang.KICH_THUOC, donHang.MAU_SAC));

  if (dong) {
    const tonMoi = (Number(dong.TON_HIEN_TAI) || 0) + soLuong;
    await updateCells(TAB_TON_KHO, headers, dong._row, { TON_HIEN_TAI: tonMoi });
  } else {
    await appendRow(TAB_TON_KHO, headers, {
      LOAI: donHang.LOAI || '', KICH_THUOC: donHang.KICH_THUOC || '', MAU_SAC: donHang.MAU_SAC || '',
      TON_HIEN_TAI: soLuong,
    });
  }

  ghiLog({
    nguoiDung: (user && user.ten) || 'Hệ thống', vaiTro: (user && user.vaiTro) || '-',
    hanhDong: 'HOAN_KHO_PHOI_TU_DON', sttKey: donHang.STT_Key,
    chiTiet: { loai: donHang.LOAI, kichThuoc: donHang.KICH_THUOC, mauSac: donHang.MAU_SAC, soLuong },
  }).catch(err => console.error('[TaiSan] Lỗi ghi log nền:', err.message));
}

// Áp dụng NHIỀU thay đổi tồn kho CÙNG LÚC, gộp theo tổ hợp LOAI+KICH_THUOC+MAU_SAC TRƯỚC khi đọc/ghi
// Sheets (bổ sung 22/09/2026, theo yêu cầu người dùng cải thiện hiệu năng) — dùng cho thao tác HÀNG
// LOẠT (vd "Lấy phôi hàng loạt" qua routes/orders.js POST /chuyen-trang-thai-hang-loat, cot=
// TRANG_THAI_PHOI): trước đây MỖI đơn trong lô tự gọi truKhoTheoDon/hoanKhoTheoDon riêng — N đơn CÙNG 1
// tổ hợp phôi (rất phổ biến, các đơn cùng mẫu thường đi theo lô) = N lượt đọc+ghi Sheets tuần tự cho
// ĐÚNG 1 dòng tồn kho, thậm chí có nguy cơ lệch số nếu chạy song song (đọc cùng giá trị cũ, ghi đè lẫn
// nhau — đây là lý do KHÔNG thể sửa bằng cách đơn giản chạy song song vòng lặp cũ). Gộp theo tổ hợp rồi
// CHỈ đọc 1 lần + ghi ĐÚNG 1 lần/tổ hợp (thường ít hơn hẳn N) giải quyết cả 2 vấn đề cùng lúc — tốc độ
// VÀ đúng số liệu.
// `danhSachThayDoi`: mảng { sttKey, loai, kichThuoc, mauSac, soLuong, user } — soLuong ÂM = trừ kho
// (lấy phôi), DƯƠNG = hoàn kho. Người gọi (orderService.js#capNhatThat qua tuỳ chọn `gomThayDoiKho`) đã
// tự lọc chỉ những đơn THẬT SỰ chuyển trạng thái (đúng logic tinhTinhTrangTuDong hiện có, không lặp lại
// ở đây) và đã bỏ qua SO_LUONG không hợp lệ — hàm này chỉ lo phần gộp + ghi Sheets.
async function apDungThayDoiKhoHangLoat(danhSachThayDoi) {
  if (danhSachThayDoi.length === 0) return;

  const gopTheoToHop = new Map(); // "loai|kichThuoc|mauSac" (đã chuẩn hoá) -> { loai, kichThuoc, mauSac, tongSoLuong }
  for (const { loai, kichThuoc, mauSac, soLuong } of danhSachThayDoi) {
    const khoa = `${chuan(loai)}|${chuan(kichThuoc)}|${chuan(mauSac)}`;
    const hienCo = gopTheoToHop.get(khoa);
    if (hienCo) hienCo.tongSoLuong += soLuong;
    else gopTheoToHop.set(khoa, { loai, kichThuoc, mauSac, tongSoLuong: soLuong });
  }

  const { headers, rows } = await readTab(TAB_TON_KHO); // đọc thật ĐÚNG 1 LẦN cho cả lô, không phải N lần
  for (const { loai, kichThuoc, mauSac, tongSoLuong } of gopTheoToHop.values()) {
    if (!tongSoLuong) continue; // trừ+hoàn triệt tiêu lẫn nhau trong CÙNG lô (hiếm nhưng có thể) — không cần ghi gì
    const dong = rows.find(r => khopLoaiPhoi(r, loai, kichThuoc, mauSac));
    if (dong) {
      const tonMoi = (Number(dong.TON_HIEN_TAI) || 0) + tongSoLuong;
      await updateCells(TAB_TON_KHO, headers, dong._row, { TON_HIEN_TAI: tonMoi });
    } else {
      await appendRow(TAB_TON_KHO, headers, {
        LOAI: loai || '', KICH_THUOC: kichThuoc || '', MAU_SAC: mauSac || '', TON_HIEN_TAI: tongSoLuong,
      });
    }
  }

  // Log CHI TIẾT TỪNG ĐƠN (không gộp) — giữ đúng khả năng tra "đơn nào gây thay đổi kho nào" như trước,
  // chỉ gộp phần GHI SHEETS thật (tốn thời gian) ở trên, không gộp phần audit log (rẻ, chạy nền).
  for (const { sttKey, loai, kichThuoc, mauSac, soLuong, user } of danhSachThayDoi) {
    ghiLog({
      nguoiDung: (user && user.ten) || 'Hệ thống', vaiTro: (user && user.vaiTro) || '-',
      hanhDong: soLuong < 0 ? 'TRU_KHO_PHOI_TU_DON' : 'HOAN_KHO_PHOI_TU_DON', sttKey,
      chiTiet: { loai, kichThuoc, mauSac, soLuong: Math.abs(soLuong) },
    }).catch(err => console.error('[TaiSan] Lỗi ghi log nền:', err.message));
  }
}

module.exports = { layTonKho, layLichSuNhap, nhapKho, truKhoTheoDon, hoanKhoTheoDon, apDungThayDoiKhoHangLoat };
