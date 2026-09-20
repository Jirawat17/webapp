const trangThaiDbService = require('./trangThaiDbService');
const nhatKyDbService = require('./nhatKyDbService');
const donHangLoatDbService = require('./donHangLoatDbService');
const storageService = require('./storageService');

// Xoá TOÀN BỘ dữ liệu app đã theo dõi cho 1 đơn hàng — dùng cho nút "Xoá dữ liệu đơn hàng" (CHỈ
// superadmin, xem routes/orders.js POST /xoa-du-lieu-hang-loat), bổ sung 20/09/2026 theo yêu cầu
// người dùng. Xem docs/superpowers/specs/2026-09-20-xoa-du-lieu-don-hang-design.md.
//
// KHÔNG xoá được dòng "gốc" trên Google Sheets: Don_Hang_ALL là công thức QUERY(VSTACK(...)) SỐNG, ghép
// từ ~19 sheet RAW con (xem docs/superpowers/specs/2026-09-17-sua-loi-ghi-lech-dong-vstack-design.md) —
// không có cách truy ngược 1 STT_Key về đúng sheet RAW + dòng vật lý gốc của nó, và Sheets API app đang
// dùng (services/sheetsService.js) cũng chưa có chức năng xoá dòng nào cả. Đã xác nhận với người dùng:
// thay vì xoá thật, đặt cờ DA_XOA='TRUE' để orderService.js#getAll() lọc đơn này khỏi MỌI danh sách
// trong app vĩnh viễn — dòng RAW gốc vẫn nằm im trên Sheets (ngoài tầm với) nhưng với app coi như đã
// biến mất hoàn toàn.
//
// THỨ TỰ CÓ CHỦ ĐÍCH: đặt cờ DA_XOA SAU CÙNG, chỉ khi mọi bước xoá khác đã xong không lỗi. Nếu bước xoá
// ảnh MinIO (phụ thuộc mạng, dễ lỗi nhất trong toàn bộ hàm) ném lỗi, đơn VẪN hiện trong danh sách (chưa
// bị coi là đã xoá) để người dùng biết cần bấm xoá lại, thay vì biến mất khỏi app trong khi vẫn còn ảnh
// rác trên MinIO không ai dọn. Mọi bước đều idempotent (DELETE khớp 0 dòng, xoá thành viên nhóm không
// tồn tại, xoá object không tồn tại — đều coi là thành công, xem storageService.js#deleteObject) nên
// gọi lại nhiều lần trên cùng 1 đơn (vd sau khi thử lại vì lỗi mạng) luôn an toàn.
async function xoaDuLieuDon(sttKey) {
  const nhom = donHangLoatDbService.layNhomCuaDon(sttKey);
  if (nhom) donHangLoatDbService.xoaThanhVien(nhom.MaDonHangLoat, sttKey);

  nhatKyDbService.xoaLichSuHoatDongTheoDon(sttKey);
  nhatKyDbService.xoaNhatKyQuetHangLoatTheoDon(sttKey);
  nhatKyDbService.xoaLogsTrackingTheoDon(sttKey);

  const objectKeys = await storageService.listObjectKeys(`orders/${sttKey}/`);
  for (const key of objectKeys) await storageService.deleteObject(key);

  trangThaiDbService.ghiDe(sttKey, { ...trangThaiDbService.RONG_MAC_DINH, DA_XOA: 'TRUE' });
}

module.exports = { xoaDuLieuDon };
