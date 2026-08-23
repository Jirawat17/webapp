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
async function layDanhSachKichBan() {
  const { rows } = await readTabCached(TAB, 60000);
  return rows
    .filter(r => r.Ten_Kich_Ban && r.Trang_Thai_Sau)
    .map(r => ({
      id: slugHoa(r.Ten_Kich_Ban),
      label: r.Ten_Kich_Ban,
      requireStatus: r.Trang_Thai_Yeu_Cau || null,
      setStatus: r.Trang_Thai_Sau,
    }));
}

async function timKichBanTheoId(scenarioId) {
  const list = await layDanhSachKichBan();
  return list.find(s => s.id === scenarioId) || null;
}

module.exports = { layDanhSachKichBan, timKichBanTheoId, slugHoa };
