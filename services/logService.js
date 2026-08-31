const { readTabCached, getHeadersCached, appendRow } = require('./sheetsService');

const TAB = 'LichSuHoatDong';

// Ghi 1 dòng log — luôn ghi lại AI làm, vai trò gì, lúc nào, làm gì, trên đơn nào.
// Dùng getHeadersCached (chỉ đọc dòng 1) thay vì đọc cả tab — tab nhật ký này ngày càng dài theo
// thời gian sử dụng, đọc cả tab chỉ để lấy header sẽ ngày càng chậm dần nếu không tối ưu chỗ này.
async function ghiLog({ nguoiDung, vaiTro, hanhDong, sttKey = '', chiTiet = '' }) {
  const headers = await getHeadersCached(TAB);
  await appendRow(TAB, headers, {
    ThoiGian: new Date().toISOString(),
    NguoiDung: nguoiDung,
    VaiTro: vaiTro,
    HanhDong: hanhDong,
    STT_Key: sttKey,
    ChiTiet: typeof chiTiet === 'string' ? chiTiet : JSON.stringify(chiTiet),
  });
}

// Lấy lịch sử của 1 đơn hàng, sắp theo thời gian tăng dần (dùng cho timeline chi tiết đơn).
// Cache ngắn (5s) — chỉ để tránh đọc lại ngay lập tức khi cùng lúc có nhiều yêu cầu, không ảnh hưởng độ mới.
async function layLichSuTheoDon(sttKey) {
  const { rows } = await readTabCached(TAB, 5000);
  return rows
    .filter(r => r.STT_Key === sttKey)
    .sort((a, b) => new Date(a.ThoiGian) - new Date(b.ThoiGian));
}

// Ghi vào tab NhatKyQuetHangLoat có sẵn trong Sheet (đúng schema cũ: Thoi_Gian, Nguoi_Quet, Ten_Kich_Ban,
// STT_Key, Trang_Thai_Cu, Trang_Thai_Moi, Ket_Qua, Ghi_Chu) — để tương thích các báo cáo/luồng cũ đã dựa vào tab này
async function ghiNhatKyQuetHangLoat({ nguoiQuet, tenKichBan, sttKey, trangThaiCu, trangThaiMoi, ketQua, ghiChu = '' }) {
  const TAB_QUET = 'NhatKyQuetHangLoat';
  const headers = await getHeadersCached(TAB_QUET);
  await appendRow(TAB_QUET, headers, {
    Thoi_Gian: new Date().toISOString(),
    Nguoi_Quet: nguoiQuet,
    Ten_Kich_Ban: tenKichBan,
    STT_Key: sttKey,
    Trang_Thai_Cu: trangThaiCu,
    Trang_Thai_Moi: trangThaiMoi,
    Ket_Qua: ketQua,
    Ghi_Chu: ghiChu,
  });
}

// Lấy N hoạt động gần nhất trong toàn hệ thống, lọc tuỳ chọn theo người dùng/loại hành động —
// dùng cho chatbot (tool tra_cuu_lich_su_gan_day, chỉ mở cho admin/quan_ly, xem routes/chatbot.js).
// gioiHan chặn trần 50 để không dội quá nhiều dữ liệu vào 1 câu trả lời.
async function layHoatDongGanDay({ nguoiDung, hanhDong, gioiHan = 20 } = {}) {
  const { rows } = await readTabCached(TAB, 5000);
  let list = rows;
  if (nguoiDung) list = list.filter(r => r.NguoiDung === nguoiDung);
  if (hanhDong) list = list.filter(r => r.HanhDong === hanhDong);
  return list
    .sort((a, b) => new Date(b.ThoiGian) - new Date(a.ThoiGian))
    .slice(0, Math.min(Number(gioiHan) || 20, 50));
}

// Tìm mọi lần có đơn được chuyển SANG đúng 1 (hoặc nhiều — truyền mảng) trạng thái cụ thể — quét cả
// 4 loại hành động có thể đổi TINH_TRANG (QUET_KICH_BAN, QUET_KICH_BAN_HANG_LOAT,
// CHUYEN_TRANG_THAI_HANG_LOAT ghi {tu, sang}; CAP_NHAT_DON ghi nguyên object các trường đã sửa, có
// thể có TINH_TRANG). Dùng để dựng báo cáo tỷ lệ lỗi B4.3_ĐƠN LỖI CẦN LÀM LẠI — KHÔNG thể lấy từ
// TINH_TRANG hiện tại của đơn vì B4.3 là trạng thái thoáng qua (đơn sẽ được xác nhận làm lại và quay
// về B1.1 sau đó), phải tính từ lịch sử mới đủ.
//
// LƯU Ý QUAN TRỌNG: cho phép truyền MẢNG tên trạng thái (không chỉ 1 chuỗi) — vì khi đổi tên pipeline
// (vd "ĐƠN LỖI CẦN LÀM LẠI" cũ -> "B4.3_ĐƠN LỖI CẦN LÀM LẠI" mới), các dòng lịch sử ĐÃ GHI TỪ TRƯỚC
// vẫn giữ nguyên TÊN CŨ vĩnh viễn (script migrate chỉ đổi TINH_TRANG hiện tại của đơn trong Sheet,
// không sửa lại lịch sử cũ) — nếu chỉ so khớp đúng 1 tên mới, mọi lần lỗi xảy ra TRƯỚC khi đổi
// pipeline sẽ bị bỏ sót hoàn toàn, khiến báo cáo báo thiếu/báo 0 dù thực tế có lỗi (lỗi thật đã xảy
// ra, xem routes/reports.js — TRANG_THAI_LOI giờ truyền cả tên cũ lẫn tên mới).
const HANH_DONG_CO_THE_DOI_TRANG_THAI = ['QUET_KICH_BAN', 'QUET_KICH_BAN_HANG_LOAT', 'CHUYEN_TRANG_THAI_HANG_LOAT', 'CAP_NHAT_DON'];

async function layLichSuChuyenSangTrangThai(trangThaiDich) {
  const dsTrangThaiDich = Array.isArray(trangThaiDich) ? trangThaiDich : [trangThaiDich];
  const { rows } = await readTabCached(TAB, 5000);
  const ketQua = [];
  for (const r of rows) {
    if (!HANH_DONG_CO_THE_DOI_TRANG_THAI.includes(r.HanhDong)) continue;
    let chiTiet;
    try { chiTiet = JSON.parse(r.ChiTiet); } catch (e) { continue; } // ChiTiet không phải JSON hợp lệ — bỏ qua dòng này
    const sang = chiTiet && (chiTiet.sang || chiTiet.TINH_TRANG);
    if (dsTrangThaiDich.includes(sang)) {
      ketQua.push({ sttKey: r.STT_Key, nguoiDung: r.NguoiDung, thoiGian: r.ThoiGian });
    }
  }
  return ketQua;
}

// ============================================================
// "HOẠT ĐỘNG CỦA TÔI" — trang tự đối soát cuối ngày/tuần cho từng người dùng (đặc biệt hữu ích
// cho san_xuat/nguoi_lay_phoi). Gồm 3 nhóm, đã thống nhất với người dùng phạm vi tính từng nhóm:
//   - "quét": CHỈ tính lượt quét QR THÀNH CÔNG (đã thật sự đổi trạng thái) — không tính lượt quét
//     lỗi/sai trạng thái (QUET_LOI, QUET_SAI_TRANG_THAI...) hay lượt "kiểm tra" trước khi xác nhận
//     (QUET_KIEM_TRA_*), vì đó chỉa là dò/xem trước, chưa ghi gì vào đơn.
//   - "doiTrangThai": GỘP mọi nguồn khiến 1 trong 3 cột trạng thái (TINH_TRANG/TRANG_THAI_PHOI/
//     TRANG_THAI_VE_FILE) đổi giá trị — quét QR (đơn lẻ + hàng loạt), sửa hàng loạt ở trang Đơn
//     hàng, và sửa tay từng đơn ở trang Chi tiết đơn.
//   - "uploadAnh": mọi lần UPLOAD_ANH (routes/photos.js).
// LƯU Ý: nhánh CAP_NHAT_DON (sửa tay) chỉ có sẵn giá trị MỚI trong ChiTiet (là nguyên `updates` gửi
// lên), KHÔNG có giá trị CŨ trước khi sửa (log không lưu lại state trước đó) — khác với quét QR/sửa
// hàng loạt vốn có sẵn cả {tu, sang}. Vì vậy mục "sửa tay" trong kết quả trả về chỉ hiện "sang", để
// trống "tu" — nơi gọi (routes/hoatDong.js) tự hiển thị phù hợp, không suy đoán giá trị cũ.
const HANH_DONG_QUET_THANH_CONG = ['QUET_KICH_BAN', 'QUET_KICH_BAN_HANG_LOAT'];
const COT_TRANG_THAI_CUA_DON = ['TINH_TRANG', 'TRANG_THAI_PHOI', 'TRANG_THAI_VE_FILE'];

function trongKhoangThoiGian(isoThoiGian, tuNgay, denNgay) {
  const d = new Date(isoThoiGian);
  if (isNaN(d)) return false;
  if (tuNgay && d < new Date(`${tuNgay}T00:00:00`)) return false;
  if (denNgay && d > new Date(`${denNgay}T23:59:59`)) return false;
  return true;
}

async function layHoatDongCuaToi({ nguoiDung, tuNgay, denNgay }) {
  const { rows } = await readTabCached(TAB, 5000);
  const cuaToi = rows.filter(r => r.NguoiDung === nguoiDung && trongKhoangThoiGian(r.ThoiGian, tuNgay, denNgay));

  const quet = [];
  const doiTrangThai = [];
  const uploadAnh = [];

  for (const r of cuaToi) {
    let chiTiet;
    try { chiTiet = JSON.parse(r.ChiTiet); } catch (e) { chiTiet = {}; }
    if (!chiTiet || typeof chiTiet !== 'object') chiTiet = {};

    if (HANH_DONG_QUET_THANH_CONG.includes(r.HanhDong)) {
      const cot = chiTiet.cot || 'TINH_TRANG';
      quet.push({ sttKey: r.STT_Key, thoiGian: r.ThoiGian, kichBan: chiTiet.scenario || '', cot, tu: chiTiet.tu || '', sang: chiTiet.sang || '' });
      doiTrangThai.push({ sttKey: r.STT_Key, thoiGian: r.ThoiGian, nguon: 'Quét QR', cot, tu: chiTiet.tu || '', sang: chiTiet.sang || '' });
      continue;
    }
    if (r.HanhDong === 'CHUYEN_TRANG_THAI_HANG_LOAT') {
      doiTrangThai.push({ sttKey: r.STT_Key, thoiGian: r.ThoiGian, nguon: 'Sửa hàng loạt', cot: chiTiet.cot || 'TINH_TRANG', tu: chiTiet.tu || '', sang: chiTiet.sang || '' });
      continue;
    }
    if (r.HanhDong === 'CAP_NHAT_DON') {
      COT_TRANG_THAI_CUA_DON.filter(cot => chiTiet[cot] !== undefined).forEach(cot => {
        doiTrangThai.push({ sttKey: r.STT_Key, thoiGian: r.ThoiGian, nguon: 'Sửa tay', cot, tu: '', sang: chiTiet[cot] });
      });
      continue;
    }
    if (r.HanhDong === 'UPLOAD_ANH') {
      uploadAnh.push({ sttKey: r.STT_Key, thoiGian: r.ThoiGian, moc: chiTiet.moc || '', tuDongChuyenSang: chiTiet.sang || '' });
    }
  }

  const moiNhatTruoc = (a, b) => new Date(b.thoiGian) - new Date(a.thoiGian);
  quet.sort(moiNhatTruoc);
  doiTrangThai.sort(moiNhatTruoc);
  uploadAnh.sort(moiNhatTruoc);

  return {
    tongSoQuet: quet.length,
    tongSoDoiTrangThai: doiTrangThai.length,
    tongSoUpload: uploadAnh.length,
    quet, doiTrangThai, uploadAnh,
  };
}

module.exports = { ghiLog, layLichSuTheoDon, ghiNhatKyQuetHangLoat, layHoatDongGanDay, layLichSuChuyenSangTrangThai, layHoatDongCuaToi };
