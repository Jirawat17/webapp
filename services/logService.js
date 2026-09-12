const { readTabCached, getHeadersCached, appendRow } = require('./sheetsService');
const { thoiGianVNISOString } = require('./dateUtils');

const TAB = 'LichSuHoatDong';

// Ghi 1 dòng log — luôn ghi lại AI làm, vai trò gì, lúc nào, làm gì, trên đơn nào.
// Dùng getHeadersCached (chỉ đọc dòng 1) thay vì đọc cả tab — tab nhật ký này ngày càng dài theo
// thời gian sử dụng, đọc cả tab chỉ để lấy header sẽ ngày càng chậm dần nếu không tối ưu chỗ này.
async function ghiLog({ nguoiDung, vaiTro, hanhDong, sttKey = '', chiTiet = '' }) {
  const headers = await getHeadersCached(TAB);
  await appendRow(TAB, headers, {
    ThoiGian: thoiGianVNISOString(),
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
    Thoi_Gian: thoiGianVNISOString(),
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
// 4 loại hành động có thể đổi TRANG_THAI_XUONG (QUET_KICH_BAN, QUET_KICH_BAN_HANG_LOAT,
// CHUYEN_TRANG_THAI_HANG_LOAT ghi {tu, sang}; CAP_NHAT_DON ghi nguyên object các trường đã sửa, có
// thể có TRANG_THAI_XUONG). Dùng để dựng báo cáo tỷ lệ lỗi B4.3_ĐƠN LỖI CẦN LÀM LẠI — KHÔNG thể lấy từ
// TRANG_THAI_XUONG hiện tại của đơn vì B4.3 là trạng thái thoáng qua (đơn sẽ được xác nhận làm lại và quay
// về B1.1 sau đó), phải tính từ lịch sử mới đủ.
//
// LƯU Ý QUAN TRỌNG: cho phép truyền MẢNG tên trạng thái (không chỉ 1 chuỗi) — vì khi đổi tên pipeline
// (vd "ĐƠN LỖI CẦN LÀM LẠI" cũ -> "B4.3_ĐƠN LỖI CẦN LÀM LẠI" mới), các dòng lịch sử ĐÃ GHI TỪ TRƯỚC
// vẫn giữ nguyên TÊN CŨ vĩnh viễn (script migrate chỉ đổi TRANG_THAI_XUONG hiện tại của đơn trong Sheet,
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
    const sang = chiTiet && (chiTiet.sang || chiTiet.TRANG_THAI_XUONG);
    if (dsTrangThaiDich.includes(sang)) {
      ketQua.push({ sttKey: r.STT_Key, nguoiDung: r.NguoiDung, thoiGian: r.ThoiGian });
    }
  }
  return ketQua;
}

// ============================================================
// "HOẠT ĐỘNG CỦA TÔI" — trang tự đối soát cuối ngày/tuần cho từng người dùng (đặc biệt hữu ích
// cho san_xuat/nguoi_lay_phoi). Gồm 4 nhóm, đã thống nhất với người dùng phạm vi tính từng nhóm:
//   - "quét": CHỈ tính lượt quét QR THÀNH CÔNG (đã thật sự đổi trạng thái) — không tính lượt quét
//     lỗi/sai trạng thái (QUET_LOI, QUET_SAI_TRANG_THAI...) hay lượt "kiểm tra" trước khi xác nhận
//     (QUET_KIEM_TRA_*), vì đó chỉa là dò/xem trước, chưa ghi gì vào đơn.
//   - "doiTrangThai": GỘP mọi nguồn khiến 1 trong 3 cột trạng thái (TRANG_THAI_XUONG/TRANG_THAI_PHOI/
//     TRANG_THAI_VE_FILE) đổi giá trị — quét QR (đơn lẻ + hàng loạt), sửa hàng loạt ở trang Đơn
//     hàng, và sửa tay từng đơn ở trang Chi tiết đơn.
//   - "uploadAnh": mọi lần UPLOAD_ANH (routes/photos.js).
//   - "quetBiTuChoi" (bổ sung 12/09/2026, theo yêu cầu người dùng — trước đây các lượt quét "Sai
//     trạng thái"/"Không tìm thấy" hoàn toàn KHÔNG xuất hiện ở tab Lịch sử, dù đã được ghi log đầy đủ,
//     khiến người dùng không đối soát lại được ai đã quét nhầm đơn nào): các lượt "kiểm tra" (quét
//     kịch bản, TRƯỚC bước xác nhận hàng loạt) bị từ chối vì sai trạng thái hoặc không tìm thấy đơn —
//     KHÔNG tính vào "quét" (không đổi gì thật cả) nhưng vẫn cần hiện ra để người dùng biết mình vừa
//     quét nhầm/quét hỏng đơn nào.
// LƯU Ý: nhánh CAP_NHAT_DON (sửa tay) chỉ có sẵn giá trị MỚI trong ChiTiet (là nguyên `updates` gửi
// lên), KHÔNG có giá trị CŨ trước khi sửa (log không lưu lại state trước đó) — khác với quét QR/sửa
// hàng loạt vốn có sẵn cả {tu, sang}. Vì vậy mục "sửa tay" trong kết quả trả về chỉ hiện "sang", để
// trống "tu" — nơi gọi (routes/hoatDong.js) tự hiển thị phù hợp, không suy đoán giá trị cũ.
const HANH_DONG_QUET_THANH_CONG = ['QUET_KICH_BAN', 'QUET_KICH_BAN_HANG_LOAT'];
const HANH_DONG_QUET_BI_TU_CHOI = ['QUET_KIEM_TRA_SAI_TRANG_THAI', 'QUET_KIEM_TRA_CHAN_DON_KET_THUC', 'QUET_KIEM_TRA_KHONG_TIM_THAY'];
const COT_TRANG_THAI_CUA_DON = ['TRANG_THAI_XUONG', 'TRANG_THAI_PHOI', 'TRANG_THAI_VE_FILE'];

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
  const quetBiTuChoi = [];
  // Bổ sung 08/09/2026 (xem docs/superpowers/specs/2026-09-08-chi-tieu-hoat-dong-theo-vai-tro-design.md)
  // — dùng để tính chỉ tiêu "tổng số lượng phôi đã lấy" cho nguoi_lay_phoi ở routes/hoatDong.js. Log
  // này (services/taiSanService.js truKhoTheoDon) đã ghi sẵn ĐÚNG số lượng phôi trừ kho theo từng đơn
  // — chính xác hơn hẳn so với suy luận từ SO_LUONG (đơn vị) của đơn hàng.
  const truKhoPhoi = [];

  for (const r of cuaToi) {
    let chiTiet;
    try { chiTiet = JSON.parse(r.ChiTiet); } catch (e) { chiTiet = {}; }
    if (!chiTiet || typeof chiTiet !== 'object') chiTiet = {};

    if (HANH_DONG_QUET_THANH_CONG.includes(r.HanhDong)) {
      const cot = chiTiet.cot || 'TRANG_THAI_XUONG';
      quet.push({ sttKey: r.STT_Key, thoiGian: r.ThoiGian, kichBan: chiTiet.scenario || '', cot, tu: chiTiet.tu || '', sang: chiTiet.sang || '' });
      doiTrangThai.push({ sttKey: r.STT_Key, thoiGian: r.ThoiGian, nguon: 'Quét QR', cot, tu: chiTiet.tu || '', sang: chiTiet.sang || '' });
      continue;
    }
    if (HANH_DONG_QUET_BI_TU_CHOI.includes(r.HanhDong)) {
      quetBiTuChoi.push({
        sttKey: r.STT_Key, thoiGian: r.ThoiGian, kichBan: chiTiet.scenario || '',
        nhom: r.HanhDong === 'QUET_KIEM_TRA_KHONG_TIM_THAY' ? 'KHONG_TIM_THAY' : 'SAI_TRANG_THAI',
        lyDo: chiTiet.lyDo || '',
      });
      continue;
    }
    if (r.HanhDong === 'CHUYEN_TRANG_THAI_HANG_LOAT') {
      doiTrangThai.push({ sttKey: r.STT_Key, thoiGian: r.ThoiGian, nguon: 'Sửa hàng loạt', cot: chiTiet.cot || 'TRANG_THAI_XUONG', tu: chiTiet.tu || '', sang: chiTiet.sang || '' });
      continue;
    }
    if (r.HanhDong === 'CAP_NHAT_DON') {
      // _truocKhiSua (bổ sung 07/09/2026, xem routes/orders.js PUT /:sttKey) chứa giá trị TRƯỚC khi
      // sửa cho từng cột trạng thái thực sự đổi — log CŨ (ghi trước ngày này) không có trường này,
      // vẫn ra tu:'' như trước giờ (tương thích ngược hoàn toàn).
      const truoc = (chiTiet._truocKhiSua && typeof chiTiet._truocKhiSua === 'object') ? chiTiet._truocKhiSua : {};
      COT_TRANG_THAI_CUA_DON.filter(cot => chiTiet[cot] !== undefined).forEach(cot => {
        doiTrangThai.push({ sttKey: r.STT_Key, thoiGian: r.ThoiGian, nguon: 'Sửa tay', cot, tu: truoc[cot] || '', sang: chiTiet[cot] });
      });
      continue;
    }
    if (r.HanhDong === 'UPLOAD_ANH') {
      uploadAnh.push({ sttKey: r.STT_Key, thoiGian: r.ThoiGian, moc: chiTiet.moc || '', tuDongChuyenSang: chiTiet.sang || '' });
      continue;
    }
    if (r.HanhDong === 'TRU_KHO_PHOI_TU_DON') {
      truKhoPhoi.push({ sttKey: r.STT_Key, thoiGian: r.ThoiGian, soLuong: Number(chiTiet.soLuong) || 0, loai: chiTiet.loai || '', kichThuoc: chiTiet.kichThuoc || '', mauSac: chiTiet.mauSac || '' });
    }
  }

  const moiNhatTruoc = (a, b) => new Date(b.thoiGian) - new Date(a.thoiGian);
  quet.sort(moiNhatTruoc);
  doiTrangThai.sort(moiNhatTruoc);
  uploadAnh.sort(moiNhatTruoc);
  truKhoPhoi.sort(moiNhatTruoc);
  quetBiTuChoi.sort(moiNhatTruoc);

  return {
    tongSoQuet: quet.length,
    tongSoDoiTrangThai: doiTrangThai.length,
    tongSoUpload: uploadAnh.length,
    tongSoQuetBiTuChoi: quetBiTuChoi.length,
    tongSoLuongPhoiDaLay: truKhoPhoi.reduce((tong, x) => tong + x.soLuong, 0),
    quet, doiTrangThai, uploadAnh, truKhoPhoi, quetBiTuChoi,
  };
}

// Đếm số ĐƠN DUY NHẤT khớp điều kiện trong 1 mảng log (Set theo STT_Key) — tránh đếm trùng 1 đơn
// nhiều lần nếu có nhiều lượt ghi log cho cùng đơn trong cùng khoảng thời gian (vd vẽ lại file sau
// khi bị lỗi sản xuất cần làm lại).
function demSoDonDuyNhat(list, dieuKien) {
  return new Set(list.filter(dieuKien).map(x => x.sttKey)).size;
}

function tongSoLuongTheoDon(list, dieuKien, slTheoStt) {
  const cacStt = new Set(list.filter(dieuKien).map(x => x.sttKey));
  return [...cacStt].reduce((tong, stt) => tong + (slTheoStt.get(stt) || 0), 0);
}

// Chỉ tiêu công việc theo vai trò (bổ sung 08/09/2026, xem
// docs/superpowers/specs/2026-09-08-chi-tieu-hoat-dong-theo-vai-tro-design.md) — dùng chung cho CẢ
// "Hoạt động của tôi" (routes/hoatDong.js, 1 người) LẪN báo cáo "Hiệu suất theo người" (routes/reports.js,
// nhiều người — xem docs/superpowers/specs/2026-09-08-hieu-suat-theo-nguoi-design.md). Nhận `hoatDong`
// đúng hình dạng trả về từ layHoatDongCuaToi() (hoặc bucket tương đương tự dựng cho từng người ở
// reports.js) + `slTheoStt` (Map STT_Key -> SO_LUONG, bên gọi tự đọc orderService.getAll() rồi truyền
// vào) — KHÔNG tự đọc orderService ở đây để logService.js không phụ thuộc ngược orderService.
function tinhChiTieuCongViec(hoatDong, slTheoStt) {
  const laDaSanXuat = x => x.moc === 'da_san_xuat';
  const laDongGoi = x => x.moc === 'dong_goi';
  const laDaLayPhoi = x => x.cot === 'TRANG_THAI_PHOI' && x.sang === 'Đã lấy phôi';
  const laDaVeFile = x => x.cot === 'TRANG_THAI_VE_FILE' && x.sang === 'Đã vẽ file';

  return {
    soDonDaChayMay: demSoDonDuyNhat(hoatDong.uploadAnh, laDaSanXuat),
    tongSlDaChayMay: tongSoLuongTheoDon(hoatDong.uploadAnh, laDaSanXuat, slTheoStt),
    soFileDaVe: demSoDonDuyNhat(hoatDong.doiTrangThai, laDaVeFile),
    tongSlDaVe: tongSoLuongTheoDon(hoatDong.doiTrangThai, laDaVeFile, slTheoStt),
    soDonDaLayPhoi: demSoDonDuyNhat(hoatDong.doiTrangThai, laDaLayPhoi),
    tongSlPhoiDaLay: hoatDong.tongSoLuongPhoiDaLay || 0,
    soDonDaDongGoi: demSoDonDuyNhat(hoatDong.uploadAnh, laDongGoi),
    tongSlDaDongGoi: tongSoLuongTheoDon(hoatDong.uploadAnh, laDongGoi, slTheoStt),
  };
}

module.exports = {
  ghiLog, layLichSuTheoDon, ghiNhatKyQuetHangLoat, layHoatDongGanDay, layLichSuChuyenSangTrangThai,
  layHoatDongCuaToi, tinhChiTieuCongViec, trongKhoangThoiGian,
};
