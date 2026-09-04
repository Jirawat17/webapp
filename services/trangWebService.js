const puppeteer = require('puppeteer-core');

// ============================================================
// Lấy ảnh từ các trang CHIA SẺ dựng bằng JavaScript (vd link chia sẻ chat Gemini) — bổ sung
// 04/09/2026, theo yêu cầu người dùng. Khác hẳn ảnh từ Drive/MinIO/URL ảnh trực tiếp (đọc thẳng
// bytes qua HTTP là xong): các trang này chỉ hiện ảnh THẬT sau khi trình duyệt chạy xong JavaScript,
// và ảnh thường nằm ở dạng "blob:" URL — chỉ tồn tại trong đúng phiên trình duyệt đang render trang
// đó, không thể tải qua 1 lệnh gọi HTTP thường từ server. Phải dùng TRÌNH DUYỆT ẢO (Puppeteer) mở
// trang, đợi ảnh hiện ra, rồi đọc lại đúng pixel đã hiển thị qua <canvas> (canvas.drawImage rồi xuất
// PNG) — đọc qua canvas vì gọi thẳng fetch(blobUrl) trong trang bị chặn (đã kiểm chứng thực tế, có
// thể do CSP của trang), còn canvas thì đọc được vì ảnh đã tải/giải mã xong trong bộ nhớ trình duyệt.
//
// CHẠY TRÊN DOCKER (Alpine, xem Dockerfile): dùng puppeteer-core (không tự tải Chromium riêng, nhẹ
// hơn nhiều so với gói 'puppeteer' đầy đủ — bản Chromium mà 'puppeteer' tự tải VỀ KHÔNG CHẠY ĐƯỢC
// trên Alpine vì khác thư viện hệ thống musl/glibc) — trỏ tới Chromium cài qua apk, đường dẫn khai
// báo ở biến môi trường PUPPETEER_EXECUTABLE_PATH (Dockerfile tự set sẵn). Máy dev không phải Alpine
// (vd Windows) cần tự set biến này trỏ tới Chrome/Edge cài sẵn nếu muốn test luồng này ở máy local.
// ============================================================

const DUONG_DAN_CHROMIUM = process.env.PUPPETEER_EXECUTABLE_PATH;

// Trình duyệt ảo dùng CHUNG, khởi tạo 1 LẦN rồi giữ sống suốt vòng đời server — mở/đóng cả 1 trình
// duyệt Chromium cho MỖI ảnh sẽ rất chậm (vài giây khởi động riêng phần này), mỗi lượt trích ảnh chỉ
// mở/đóng 1 TAB (page) riêng trong trình duyệt dùng chung này.
let _trinhDuyetDungChung = null;

async function layTrinhDuyet() {
  if (_trinhDuyetDungChung && _trinhDuyetDungChung.connected) return _trinhDuyetDungChung;

  if (!DUONG_DAN_CHROMIUM) {
    throw new Error('Thiếu PUPPETEER_EXECUTABLE_PATH trong .env — cần trỏ tới đường dẫn Chromium/Chrome đã cài');
  }

  _trinhDuyetDungChung = await puppeteer.launch({
    executablePath: DUONG_DAN_CHROMIUM,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  return _trinhDuyetDungChung;
}

// Nhận diện link chia sẻ Gemini — cả link rút gọn (share.gemini.google) lẫn link đầy đủ sau khi
// chuyển hướng (gemini.google.com/share/...).
function laLinkChiaSeGemini(url) {
  if (!url) return false;
  return /^https:\/\/(share\.gemini\.google\/|gemini\.google\.com\/share\/)/i.test(String(url));
}

// Đợi trang có ít nhất 1 ảnh ĐỦ LỚN (loại icon/logo nhỏ) VÀ đã load xong hẳn (img.complete) — chỉ
// dựa vào waitUntil: 'networkidle2' khi goto() đôi khi mạng đã rảnh nhưng ảnh vẫn chưa giải mã xong
// (gặp thật khi test — chạy đơn lẻ thì luôn được nhưng chạy liên tiếp nhiều trang thì thỉnh thoảng
// trượt), nên đợi thêm bước này cho chắc trước khi đọc qua canvas.
async function doiAnhSanSang(trang) {
  await trang.waitForFunction(
    () => [...document.querySelectorAll('img')].some(img => img.complete && img.naturalWidth > 200 && img.naturalHeight > 200),
    { timeout: 8000 }
  ).catch(() => {}); // hết giờ vẫn thử đọc — có thể ảnh vừa kịp xong ngay lúc đó, để bước đọc canvas tự quyết định thành/bại
}

// Đọc ảnh LỚN NHẤT trên trang (loại icon/logo nhỏ) qua canvas — trả về data URL hoặc null.
async function docAnhQuaCanvas(trang) {
  return trang.evaluate(() => {
    const anh = [...document.querySelectorAll('img')]
      .filter(img => img.complete && img.naturalWidth > 200 && img.naturalHeight > 200)
      .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight))[0];
    if (!anh) return null;

    const canvas = document.createElement('canvas');
    canvas.width = anh.naturalWidth;
    canvas.height = anh.naturalHeight;
    canvas.getContext('2d').drawImage(anh, 0, 0);
    return canvas.toDataURL('image/png');
  });
}

// Mở trang bằng trình duyệt ảo, đợi ảnh chính hiện ra, đọc lại qua canvas. Trả về Buffer PNG, hoặc
// null nếu lỗi/không tìm thấy ảnh nào đủ lớn. Thử lại 1 lần (mở trang mới hoàn toàn) nếu lần đầu
// không ra ảnh — đã gặp thật lúc test: đơn lẻ luôn được, nhưng thỉnh thoảng trượt khi mở nhiều trang
// Gemini liên tiếp (rất có thể do phía Google tạm chậm/giới hạn), thử lại thường qua ngay.
async function taiAnhTuTrangGemini(url, soLanThuLaiConLai = 1) {
  let trang;
  try {
    const trinhDuyet = await layTrinhDuyet();
    trang = await trinhDuyet.newPage();
    await trang.setViewport({ width: 1280, height: 900 });
    await trang.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    await doiAnhSanSang(trang);

    const dataUrl = await docAnhQuaCanvas(trang);
    if (!dataUrl) {
      if (soLanThuLaiConLai > 0) return taiAnhTuTrangGemini(url, soLanThuLaiConLai - 1);
      return null;
    }
    return Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
  } catch (err) {
    console.error('[Gemini] Không lấy được ảnh:', url, '-', err.message);
    if (soLanThuLaiConLai > 0) return taiAnhTuTrangGemini(url, soLanThuLaiConLai - 1);
    return null;
  } finally {
    if (trang) await trang.close().catch(() => {});
  }
}

module.exports = { laLinkChiaSeGemini, taiAnhTuTrangGemini };
