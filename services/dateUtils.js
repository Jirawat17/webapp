// Google Sheets API trả về các cột ngày (vd NGAY_LEN_DON) dưới dạng CHUỖI THEO ĐỊNH DẠNG HIỂN THỊ
// của ô trong Sheet — đã xác nhận với người dùng là kiểu Việt Nam "DD/MM/YYYY" (vd "23/08/2026").
//
// `new Date(chuoi)` mặc định của JavaScript đọc SAI hoàn toàn định dạng này:
//   - Ngày > 12 (vd "23/08/2026")  → Invalid Date (không đọc được gì cả)
//   - Ngày ≤ 12 (vd "05/08/2026")  → đọc NHẦM đảo ngược tháng/ngày (hiểu thành 8 tháng 5 thay vì
//                                     đúng ra là 5 tháng 8) — sai âm thầm, không báo lỗi gì
//
// Đây là lỗi gốc ảnh hưởng RỘNG: bộ lọc báo cáo, cảnh báo Vàng/Cam/Đỏ, sắp xếp đơn theo ngày,
// biểu đồ "theo tuần", và cả hiển thị ngày trên trang đơn hàng — TẤT CẢ chỗ nào đọc NGAY_LEN_DON
// đều phải dùng hàm này thay vì gọi thẳng new Date(...).
function parseNgay(giaTri) {
  if (!giaTri) return null;
  if (giaTri instanceof Date) return isNaN(giaTri) ? null : giaTri;

  const chuoi = String(giaTri).trim();

  // DD/MM/YYYY hoặc DD-MM-YYYY (định dạng Google Sheets trả về cho cột ngày kiểu Việt Nam)
  let m = chuoi.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    const ngay = Number(m[1]), thang = Number(m[2]), nam = Number(m[3]);
    const d = new Date(nam, thang - 1, ngay);
    return isNaN(d) ? null : d;
  }

  // ISO chuẩn: 2026-08-23 (vd giá trị từ <input type="date">) hoặc có kèm giờ
  m = chuoi.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d) ? null : d;
  }

  // Trường hợp còn lại — thử cách mặc định của JS làm phương án cuối cùng
  const thu = new Date(chuoi);
  return isNaN(thu) ? null : thu;
}

// Định dạng lại thành DD/MM/YYYY để hiển thị — dùng khi cần in ra chuỗi ngày nhất quán
function dinhDangNgay(giaTri) {
  const d = parseNgay(giaTri);
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// Ngày+giờ ngắn gọn theo đúng yêu cầu: "24-08 23:48:34" (DD-MM HH:mm:ss) — không có năm, đủ ngắn
// để đặt trong dòng log/lịch sử mà không chiếm quá nhiều chỗ. Dùng cho timeline lịch sử thay đổi,
// cột "Thời gian" trong bảng báo cáo. Nhận vào ISO string (từ Sheet) hoặc Date object.
function dinhDangNgayGioNgan(d) {
  const obj = d instanceof Date ? d : new Date(d);
  if (isNaN(obj)) return '';
  const phan = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(obj);
  const lay = (type) => phan.find(p => p.type === type)?.value || '00';
  return `${lay('day')}-${lay('month')} ${lay('hour')}:${lay('minute')}:${lay('second')}`;
}

// Ngày+giờ đầy đủ cho footer báo cáo ("Người thực hiện... lúc 23:48 24/08/2026") — vẫn giữ đủ
// năm để truy vết báo cáo cũ.
function dinhDangNgayGioVN(d = new Date()) {
  const obj = d instanceof Date ? d : new Date(d);
  if (isNaN(obj)) return '';
  const phan = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(obj);
  const lay = (type) => phan.find(p => p.type === type)?.value || '';
  return `${lay('day')}/${lay('month')}/${lay('year')} ${lay('hour')}:${lay('minute')}`;
}

module.exports = { parseNgay, dinhDangNgay, dinhDangNgayGioVN, dinhDangNgayGioNgan };
