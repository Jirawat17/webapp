// B2 (11/10/2026, theo yêu cầu người dùng — spec 2026-10-04-21-tinh-nang-design.md mục 4): ảnh thiết kế cho PDF "IN ĐƠN" và
// "Thuê team khác" đọc từ thư viện Tìm ảnh (MinIO trong LAN) thay vì tải lại Drive/Gemini từng đơn.
// CHỈ dùng khi MỌI link hiện tại của DUONG_DAN_URL đều đã có file trong thư viện — thiếu link nào (chưa tải xong, link lỗi,
// seller vừa đổi link) thì trả null để nơi gọi tải như cũ, tránh in nửa ảnh mới nửa ảnh cũ. File của link cũ và file tải tay
// (không có url_goc) bị loại. Quá SO_FILE_TOI_DA file cũng trả null (đọc kiểu cũ đủ mọi ảnh).
const db = require('./thuVienDbService');
const { tachLink, laLink } = require('./xuLyService');
const { getObjectBuffer } = require('../storageService');

const SO_FILE_TOI_DA = 6;

// -> [{ buffer, urlGoc, driveFileId, ten }] theo đúng thứ tự tải (thư mục Drive: theo tên file), hoặc null.
async function layAnhThietKeTuThuVien(don) {
  try {
    const links = [...new Set(tachLink(don.DUONG_DAN_URL).filter(laLink))];
    if (!links.length) return null;
    const png = db.dsFileCuaDon(String(don.STT_Key || '').trim())
      .filter(f => f.loai === 'PNG' && links.includes(f.url_goc))
      .sort((a, b) => a.so_thu_tu - b.so_thu_tu);
    if (!png.length || png.length > SO_FILE_TOI_DA || links.some(l => !png.some(f => f.url_goc === l))) return null;
    const buffers = await Promise.all(png.map(f => getObjectBuffer(f.object_key)));
    if (buffers.some(b => !b || !b.length)) return null;
    return png.map((f, i) => ({ buffer: buffers[i], urlGoc: f.url_goc, driveFileId: f.drive_file_id || '', ten: f.ten_file_goc || '' }));
  } catch (err) {
    console.error(`[IN ĐƠN] Thư viện lỗi với đơn ${don.STT_Key}, tải ảnh kiểu cũ:`, err.message);
    return null;
  }
}

module.exports = { layAnhThietKeTuThuVien };
