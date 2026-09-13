const http = require('http');
const https = require('https');
const { taiAnhTuLinkDrive, layFileIdTuLinkDrive, layDsAnhTrongThuMucDrive } = require('./driveService');
const { laLinkChiaSeGemini, taiAnhTuTrangGemini } = require('./trangWebService');
const storageService = require('./storageService');

// Tải ảnh trực tiếp qua HTTP(S) thường — dùng khi URL KHÔNG phải MinIO proxy VÀ KHÔNG nhận diện
// được là link Google Drive (cập nhật 04/09/2026, theo yêu cầu người dùng, xác nhận qua dữ liệu thật
// — rất nhiều đơn dán thẳng link ảnh tham khảo từ nơi khác, vd Etsy, thay vì Drive/MinIO — trước đây
// những link này KHÔNG có đường lấy nào cả nên luôn hiện "Không tải được ảnh" dù link vẫn truy cập
// công khai bình thường). Giới hạn 15s tránh treo cả file in nếu 1 ảnh chậm/chết; chỉ nhận http(s)
// (chặn file://, ftp://... phòng URL lạ/gõ nhầm trong Sheet).
// Đọc thẳng 1 URL bằng module http(s) GỐC của Node — CỐ Ý không dùng fetch() ở đây: fetch() (undici)
// từ chối đọc luôn nếu tổng độ dài HTTP header vượt quá giới hạn mặc định (gặp thật với
// gemini.google.com — header ~25KB, fetch() ném lỗi HeadersOverflowError ngay cả trước khi đọc được
// nội dung). maxHeaderSize nâng lên ở đây tránh đúng lỗi này. Tự theo redirect (301/302/303/307/308)
// vì http(s).get() KHÔNG tự làm như fetch() — tối đa 5 lần, đủ dùng thực tế, tránh lặp vô hạn.
function taiUrlTho(url, soLanChuyenHuongConLai = 5) {
  return new Promise((resolve) => {
    const mod = String(url).startsWith('http://') ? http : https;
    const yeuCau = mod.get(url, {
      maxHeaderSize: 65536 * 4, // 256KB — dư sức so với ~25KB thực tế gặp phải, vẫn có giới hạn để tránh phản hồi bất thường
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }, // 1 số site chặn request không có User-Agint hợp lệ
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && soLanChuyenHuongConLai > 0) {
        res.resume();
        return resolve(taiUrlTho(new URL(res.headers.location, url).toString(), soLanChuyenHuongConLai - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }

      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    yeuCau.on('timeout', () => yeuCau.destroy());
    yeuCau.on('error', (err) => {
      console.error('[Ảnh ngoài] Không tải được:', url, '-', err.message);
      resolve(null);
    });
  });
}

async function taiAnhTuUrlThuong(url) {
  if (!url || !/^https?:\/\//i.test(String(url))) return null;
  return taiUrlTho(url);
}

// Ảnh mới nằm trên MinIO (URL proxy nội bộ); ảnh cũ có thể là link Google Drive, link chia sẻ Gemini
// (trang dựng bằng JS, cần trình duyệt ảo — xem services/trangWebService.js), hoặc link ảnh công
// khai từ nơi khác — thử lần lượt các nguồn để báo cáo PDF mất ít ảnh nhất có thể.
async function taiAnh(url) {
  const objectKey = storageService.proxyUrlToObjectKey(url);
  if (objectKey) {
    try {
      const result = await storageService.getObjectStream(objectKey);
      const chunks = [];
      for await (const chunk of result.Body) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch (err) {
      console.error('[MinIO] Không tải được ảnh:', url, '-', err.message);
      return null;
    }
  }

  if (layFileIdTuLinkDrive(url)) return taiAnhTuLinkDrive(url);

  if (laLinkChiaSeGemini(url)) return taiAnhTuTrangGemini(url);

  return taiAnhTuUrlThuong(url);
}

// Lấy TẤT CẢ ảnh của 1 URL — thường chỉ có 1 ảnh (link file/MinIO/HTTP thường), NHƯNG nếu url là link
// THƯ MỤC Drive thì lấy hết mọi ảnh bên trong (bổ sung 04/09/2026, theo yêu cầu người dùng). Luôn trả
// về MẢNG (có thể rỗng), để nơi gọi xử lý đồng nhất dù 1 hay nhiều ảnh.
// `tuyChon.gioiHan` (bổ sung 13/09/2026) — xem giải thích ở driveService.js#layDsAnhTrongThuMucDrive;
// không ảnh hưởng nhánh link file/MinIO/HTTP thường (luôn tối đa 1 ảnh, gioiHan >= 1 nên vô hại).
async function taiDsAnh(url, tuyChon = {}) {
  const dsThuMuc = await layDsAnhTrongThuMucDrive(url, tuyChon);
  if (dsThuMuc !== null) return dsThuMuc; // đúng là link thư mục (kể cả khi rỗng) — không thử nguồn khác nữa

  const mot = await taiAnh(url);
  return mot ? [mot] : [];
}

module.exports = { taiUrlTho, taiAnhTuUrlThuong, taiAnh, taiDsAnh };
