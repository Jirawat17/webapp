const kichBanDbService = require('./kichBanDbService');

// Biến "Ten_Kich_Ban" thành id ngắn gọn dùng trong URL — bỏ dấu, thay khoảng trắng bằng gạch dưới
function slugHoa(str) {
  return String(str)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

// Đọc toàn bộ kịch bản — bảng SQLite cau_hinh_kich_ban (bổ sung 19/09/2026, xem
// services/kichBanDbService.js, docs/superpowers/specs/2026-09-19-kich-ban-sqlite-design.md). Trước
// đây đọc trực tiếp từ tab Sheet CauHinhKichBan (sửa/thêm kịch bản chỉ cần sửa Sheet, không cần sửa
// code) — giờ quản lý qua trang riêng public/kich-ban.html (routes/kichBan.js), không cần sửa code ở
// đây nữa. Không còn cần cache 60s — SQLite đọc tại chỗ, không tốn round-trip mạng như Sheets.
//
// CẬP NHẬT 24/08/2026 (theo Prompt_Ver_24.docx): 2 cột Cot/Nguoi_Thuc_Hien —
//   Cot            — TÊN CỘT mà kịch bản này thao tác (TRANG_THAI_XUONG / TRANG_THAI_PHOI / TRANG_THAI_VE_FILE).
//                    Để trống thì mặc định là TRANG_THAI_XUONG (giữ tương thích ngược với kịch bản cũ).
//   Nguoi_Thuc_Hien — danh sách vai trò được PHÉP dùng kịch bản này, phân cách bởi dấu phẩy (vd
//                    "nguoi_lay_phoi, ve_file"). Để trống = mở cho MỌI vai trò (không giới hạn).
async function layDanhSachKichBan() {
  const rows = kichBanDbService.layTatCa();
  return rows
    .filter(r => r.Ten_Kich_Ban && r.Trang_Thai_Sau)
    .map(r => ({
      id: slugHoa(r.Ten_Kich_Ban),
      label: r.Ten_Kich_Ban,
      column: (r.Cot || 'TRANG_THAI_XUONG').trim(),
      requireStatus: r.Trang_Thai_Yeu_Cau || null,
      setStatus: r.Trang_Thai_Sau,
      allowedRoles: r.Nguoi_Thuc_Hien
        ? r.Nguoi_Thuc_Hien.split(',').map(s => s.trim()).filter(Boolean)
        : null, // null = mở cho mọi vai trò
    }));
}

async function timKichBanTheoId(scenarioId) {
  const list = await layDanhSachKichBan();
  return list.find(s => s.id === scenarioId) || null;
}

module.exports = { layDanhSachKichBan, timKichBanTheoId, slugHoa };
