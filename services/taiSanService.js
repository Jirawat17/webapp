const { readTab, readTabCached, appendRow, updateCells } = require('./sheetsService');
const { ghiLog } = require('./logService');

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
async function nhapKho({ loai, kichThuoc, mauSac, soLuong, nguoiNhap, ghiChu = '' }) {
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
    ThoiGian: new Date().toISOString(),
    LOAI: loai, KICH_THUOC: kichThuoc, MAU_SAC: mauSac,
    SoLuongNhap: soLuong, NguoiNhap: nguoiNhap, GhiChu: ghiChu,
  });
}

// TỰ ĐỘNG trừ kho khi 1 đơn được đánh dấu "Đã lấy phôi" (gọi từ orderService.update() — xem ở đó).
// Trừ đúng theo SO_LUONG của đơn, khớp loại phôi theo LOAI+KICH_THUOC+MAU_SAC. CHO PHÉP tồn xuống ÂM
// (đã xác nhận với người dùng) — không chặn thao tác lấy phôi thực tế, số âm chính là tín hiệu "thiếu
// phôi, cần nhập thêm" hiển thị trên trang Quản lý tài sản. Nếu chưa từng có dòng tồn kho cho tổ hợp
// này (chưa từng nhập kho loại đó) thì TỰ TẠO dòng mới bắt đầu từ 0 rồi trừ xuống âm luôn — không báo
// lỗi chặn đơn (cũng đã xác nhận với người dùng).
// KHÔNG hoàn kho khi đơn bị chuyển NGƯỢC lại "Chưa lấy phôi" — chỉ trừ 1 chiều, cố ý đơn giản hoá.
async function truKhoTheoDon(donHang, user) {
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

module.exports = { layTonKho, layLichSuNhap, nhapKho, truKhoTheoDon };
