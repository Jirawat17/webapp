const { readTabCached } = require('./sheetsService');

const TAB = 'CauHinhKichBan';

// Biến "Ten_Kich_Ban" thành id ngắn gọn dùng trong URL — bỏ dấu, thay khoảng trắng bằng gạch dưới
function slugHoa(str) {
  return String(str)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

// Đọc toàn bộ kịch bản từ Sheet — sửa/thêm kịch bản chỉ cần sửa tab CauHinhKichBan, không cần sửa code.
// Dùng cache 60s vì bảng này gần như không đổi trong lúc đang thao tác — tránh đọc lại qua mạng mỗi lần quét.
//
// CẬP NHẬT 24/08/2026 (theo Prompt_Ver_24.docx): thêm 2 cột mới trong CauHinhKichBan —
//   Cot            — TÊN CỘT mà kịch bản này thao tác (TINH_TRANG / TRANG_THAI_PHOI / TRANG_THAI_VE_FILE).
//                    Để trống thì mặc định là TINH_TRANG (giữ tương thích ngược với kịch bản cũ).
//   Nguoi_Thuc_Hien — danh sách vai trò được PHÉP dùng kịch bản này, phân cách bởi dấu phẩy (vd
//                    "nguoi_lay_phoi, ve_file"). Để trống = mở cho MỌI vai trò (không giới hạn).
async function layDanhSachKichBan() {
  const { rows } = await readTabCached(TAB, 60000);
  return rows
    .filter(r => r.Ten_Kich_Ban && r.Trang_Thai_Sau)
    .map(r => ({
      id: slugHoa(r.Ten_Kich_Ban),
      label: r.Ten_Kich_Ban,
      column: (r.Cot || 'TINH_TRANG').trim(),
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
