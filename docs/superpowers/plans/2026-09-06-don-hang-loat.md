# Đơn Hàng Loạt (Perceptual Hash) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect orders that share the same (or a re-exported/resized) embroidery design image and group them into a "ĐƠN HÀNG LOẠT" group via a perceptual hash (dHash) of the design image (`DUONG_DAN_URL`), triggered manually from a new button on `public/orders.html`, with the result exposed as a new "Chỉ đơn hàng loạt" filter.

**Architecture:** Pure additive backend feature (2 new service modules + 3 new job routes + 1 filter) plus a small, behavior-preserving refactor (extracting existing image-fetch helpers out of `routes/reports.js` into a shared service so the new job can reuse them) and a UI addition (1 button + 1 checkbox filter) on `public/orders.html`. No database — state lives in 2 new Google Sheet columns. No cron — the whole scan is user-triggered, using the same "background job + progress polling + cancel" pattern already proven in `routes/reports.js` for "IN ĐƠN ĐANG CHỌN".

**Tech Stack:** Node/Express backend, Google Sheets as the datastore (`services/sheetsService.js`), `sharp` (new dependency) for image decoding/resizing, vanilla JS frontend (`public/orders.html`, no framework).

**Spec:** `docs/superpowers/specs/2026-09-06-don-hang-loat-design.md`

**Testing note:** This codebase has no automated test suite (no test runner in `package.json`). Every verification step below is either a manual `node -e`/`node --check` sanity check, a throwaway script run in the scratchpad-style manner (never committed), or a careful code-reading trace — matching how every other feature in this codebase is verified. Live browser end-to-end testing is NOT possible in a sandboxed dev environment without real Google Sheets credentials — if that's the case for you too, say so explicitly rather than claiming a live check happened.

**Known open question the user must resolve before this feature is trustworthy in production:** the Hamming-distance threshold (`NGUONG_HAMMING`, starting at 8) was picked from testing with synthetic shapes, not the shop's real embroidery designs — same-design and different-design distances overlapped in that test. Task 5 is where this constant lives; flag to the user after implementation that they should watch the first real scan's results and adjust the constant if it over- or under-groups.

---

## Task 1: Add `sharp` dependency and verify it works on both this OS and the project's Docker (Alpine) target

**Files:**
- Modify: `package.json`
- Modify: `Dockerfile` — no content change needed, just used to verify

- [ ] **Step 1: Add the dependency**

Add `"sharp": "^0.33.5"` to the `"dependencies"` object in `package.json` (alphabetical position — after `"qrcode"` is fine since the list isn't strictly alphabetical already, just add it anywhere in the dependencies object, e.g. right after `"puppeteer-core"`).

- [ ] **Step 2: Install and sanity-check on this machine**

```bash
npm install
node -e "const sharp = require('sharp'); console.log('sharp OK, version:', sharp.versions.sharp)"
```

Expected: prints a version string, no error.

- [ ] **Step 3: Verify the Docker (Alpine/musl) build still works with `sharp` added**

The project's `Dockerfile` uses `node:20-alpine` (musl libc). `sharp` ships prebuilt binaries for `linuxmusl-x64`, but this must be confirmed, not assumed — the project has a documented history of exactly this kind of native-binary/Alpine mismatch (see `Dockerfile:5-9` comment about Puppeteer/Chromium). Build the image (do NOT run/deploy it, just confirm the build succeeds and `sharp` loads inside the container):

```bash
docker build -t xuong-theu-webapp-sharp-test .
docker run --rm xuong-theu-webapp-sharp-test node -e "const sharp = require('sharp'); console.log('sharp OK in alpine, version:', sharp.versions.sharp)"
```

Expected: the build completes, and the run command prints the version with no error.

If this fails (e.g. `sharp` can't find its native binding on Alpine), STOP and report back — this is a foundational risk for the whole feature (flagged in the spec) and needs a decision (e.g. pinning a different `sharp` version, or adding a system package) before continuing to later tasks.

- [ ] **Step 4: Clean up the test image**

```bash
docker rmi xuong-theu-webapp-sharp-test
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
build: add sharp dependency for perceptual-hash image decoding

Verified it builds and loads correctly on the project's Alpine-based
Docker image, not just the host OS, given this project's prior history
of native-binary issues on musl libc (Puppeteer/Chromium).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `services/perceptualHashService.js` — dHash + Hamming distance

**Files:**
- Create: `services/perceptualHashService.js`

- [ ] **Step 1: Write the file**

```js
const sharp = require('sharp');

// dHash (difference hash) 64-bit — resize ảnh về lưới 9x8 pixel xám, so sánh độ sáng từng cặp pixel
// liền kề THEO HÀNG (9 pixel/hàng → 8 cặp so sánh/hàng × 8 hàng = 64 bit). Nhẹ, không cần mô hình AI,
// nhắm bắt được ảnh bị resize/đổi định dạng vẫn ra hash giống hệt hoặc gần giống (khác thuật toán băm
// nội dung như SHA-256 — chỉ cần đổi 1 byte là ra hash hoàn toàn khác). Xem
// docs/superpowers/specs/2026-09-06-don-hang-loat-design.md mục 3 để biết lý do chọn thuật toán này.
//
// QUAN TRỌNG — kernel 'nearest': đã tự kiểm thử bằng ảnh giả lập trước khi viết hàm này. Dùng kernel
// mặc định của sharp ('lanczos3', vốn "mượt" hơn) khiến CHỈ RIÊNG việc đổi định dạng PNG->JPEG (dù
// chất lượng 100%) đã đẩy khoảng cách Hamming lên ~20/64 bit — coi như khác hẳn thiết kế dù là đúng 1
// ảnh. Đổi sang 'nearest' (lấy đúng 1 pixel, không nội suy/làm mượt) giảm mức trôi này đáng kể — quan
// trọng với ảnh nét thẳng/khối màu phẳng kiểu thiết kế thêu, nơi nội suy mượt phá vỡ đúng cạnh sắc mà
// dHash dựa vào để so sánh. ĐỪNG đổi lại kernel mặc định mà không kiểm thử lại bằng ảnh giả lập trước.
const CHIEU_RONG_HASH = 9;
const CHIEU_CAO_HASH = 8;
const KERNEL_RESIZE = 'nearest';

// Mỗi ký tự hex ứng với 4 bit — bảng tra số bit "1" trong 1 nibble (0-15), dùng để đếm nhanh khoảng
// cách Hamming giữa 2 chuỗi hex mà không cần vòng lặp bit-by-bit.
const SO_BIT_1_TRONG_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

// Trả về chuỗi hex 16 ký tự (64 bit) hoặc null nếu ảnh lỗi/định dạng không đọc được (sharp ném lỗi
// với buffer rỗng, hỏng, hoặc không phải ảnh — bắt lỗi ở đây để nơi gọi không cần tự try/catch).
async function tinhHashAnh(buffer) {
  if (!buffer || buffer.length === 0) return null;

  try {
    const { data } = await sharp(buffer)
      .resize(CHIEU_RONG_HASH, CHIEU_CAO_HASH, { fit: 'fill', kernel: KERNEL_RESIZE })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let bit = '';
    for (let y = 0; y < CHIEU_CAO_HASH; y++) {
      for (let x = 0; x < CHIEU_RONG_HASH - 1; x++) {
        const trai = data[y * CHIEU_RONG_HASH + x];
        const phai = data[y * CHIEU_RONG_HASH + x + 1];
        bit += trai < phai ? '1' : '0';
      }
    }

    let hex = '';
    for (let i = 0; i < bit.length; i += 4) {
      hex += parseInt(bit.slice(i, i + 4), 2).toString(16);
    }
    return hex;
  } catch (err) {
    return null;
  }
}

// Khoảng cách Hamming (số bit khác nhau) giữa 2 hash — càng nhỏ càng giống nhau. Trả về Infinity nếu
// thiếu 1 trong 2 giá trị hoặc độ dài không khớp (không thể so sánh), để nơi gọi coi như "chắc chắn
// không cùng nhóm" thay vì so sánh sai.
function khoangCachHamming(hexA, hexB) {
  if (!hexA || !hexB || hexA.length !== hexB.length) return Infinity;

  let khoangCach = 0;
  for (let i = 0; i < hexA.length; i++) {
    const xor = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
    khoangCach += SO_BIT_1_TRONG_NIBBLE[xor];
  }
  return khoangCach;
}

module.exports = { tinhHashAnh, khoangCachHamming };
```

- [ ] **Step 2: Verify with a throwaway script (do not commit this script)**

Create a temporary file (anywhere outside the repo, e.g. your OS temp dir) named `verify-hash.js`:

```js
const path = require('path');
const { tinhHashAnh, khoangCachHamming } = require('/absolute/path/to/webapp/services/perceptualHashService');
const sharp = require('sharp');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="80" fill="#e63946"/><circle cx="100" cy="140" r="50" fill="#1d3557"/></svg>`;
const svgKhac = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><polygon points="100,20 180,180 20,180" fill="#8338ec"/></svg>`;

async function main() {
  const goc = await sharp(Buffer.from(svg)).png().toBuffer();
  const jpegQ100 = await sharp(Buffer.from(svg)).jpeg({ quality: 100 }).toBuffer();
  const resizedLon = await sharp(Buffer.from(svg)).resize(600, 600).png().toBuffer();
  const khacThietKe = await sharp(Buffer.from(svgKhac)).png().toBuffer();

  const hGoc = await tinhHashAnh(goc);
  const hJpeg = await tinhHashAnh(jpegQ100);
  const hResize = await tinhHashAnh(resizedLon);
  const hKhac = await tinhHashAnh(khacThietKe);

  console.log('goc vs jpeg (cung thiet ke, doi dinh dang):', khoangCachHamming(hGoc, hJpeg));
  console.log('goc vs resize (cung thiet ke, doi kich thuoc):', khoangCachHamming(hGoc, hResize));
  console.log('goc vs khac thiet ke:', khoangCachHamming(hGoc, hKhac));
  console.log('tinhHashAnh(null):', await tinhHashAnh(null));
  console.log('tinhHashAnh(buffer rac):', await tinhHashAnh(Buffer.from('khong-phai-anh')));
  console.log('khoangCachHamming(null, hGoc):', khoangCachHamming(null, hGoc));
}
main();
```

Replace the require path with the actual absolute path to `services/perceptualHashService.js` in your checkout. Run it:

```bash
node verify-hash.js
```

Expected (based on prior testing during design — exact numbers may vary slightly by `sharp` version, that's fine):
- "goc vs jpeg" and "goc vs resize" (same design, different format/size) should each print a number roughly in the 0–11 range.
- "goc vs khac thiet ke" (different design) should print a number — it may or may not be clearly higher than the same-design numbers (this exact ambiguity is why Task 5's `NGUONG_HAMMING` is flagged as needing real-data tuning — don't be alarmed if the separation isn't clean here).
- `tinhHashAnh(null)` and `tinhHashAnh(buffer rác)` must both print `null` (no thrown error).
- `khoangCachHamming(null, hGoc)` must print `Infinity`.

Delete the throwaway script when done.

- [ ] **Step 3: Commit**

```bash
git add services/perceptualHashService.js
git commit -m "$(cat <<'EOF'
feat: add perceptual hash (dHash) service for design-image comparison

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extract image-fetching helpers into `services/anhNguonService.js`

**Why:** `routes/reports.js` has 4 private functions (`taiUrlTho`, `taiAnhTuUrlThuong`, `taiAnh`, `taiDsAnh`) that resolve an image URL from any of MinIO/Google Drive file/Google Drive folder/Gemini share link/plain HTTP URL into a `Buffer`. The new "quét hàng loạt" job (Task 5) needs the exact same resolution logic to fetch each order's design image before hashing it. Moving these 4 functions into a shared service lets both `routes/reports.js` and the new job use them without duplicating ~65 lines of logic.

**Files:**
- Create: `services/anhNguonService.js`
- Modify: `routes/reports.js:1-19` (imports) and `routes/reports.js` (delete the 4 extracted functions, currently between the `nhanDangDinhDangAnh` function and `taiAnhChoDon`)

- [ ] **Step 1: Create the new service file with the extracted functions, verbatim**

```js
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
async function taiDsAnh(url) {
  const dsThuMuc = await layDsAnhTrongThuMucDrive(url);
  if (dsThuMuc !== null) return dsThuMuc; // đúng là link thư mục (kể cả khi rỗng) — không thử nguồn khác nữa

  const mot = await taiAnh(url);
  return mot ? [mot] : [];
}

module.exports = { taiUrlTho, taiAnhTuUrlThuong, taiAnh, taiDsAnh };
```

- [ ] **Step 2: Update `routes/reports.js` imports**

Find:

```js
const https = require('https');
const http = require('http');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const orderService = require('../services/orderService');
const { layDanhSachKhachHang, layBanDoTenKhachHang } = require('../services/khachHangService');
const { layLichSuChuyenSangTrangThai } = require('../services/logService');
const { readTabCached } = require('../services/sheetsService');
const { parseNgay, dinhDangNgay, dinhDangNgayGioVN, dinhDangNgayGioNgan } = require('../services/dateUtils');
const { taoQRCodeBuffer } = require('../services/qrService');
const { taiAnhTuLinkDrive, layFileIdTuLinkDrive, layDsAnhTrongThuMucDrive } = require('../services/driveService');
const { laLinkChiaSeGemini, taiAnhTuTrangGemini } = require('../services/trangWebService');
const storageService = require('../services/storageService');
const { DANH_SACH_TRANG_THAI_BAO_CAO, GIA_TRI_LOC_TRONG, khopGiaTriLoc } = require('../data/pipelineTinhTrang');
```

Replace with:

```js
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const orderService = require('../services/orderService');
const { layDanhSachKhachHang, layBanDoTenKhachHang } = require('../services/khachHangService');
const { layLichSuChuyenSangTrangThai } = require('../services/logService');
const { readTabCached } = require('../services/sheetsService');
const { parseNgay, dinhDangNgay, dinhDangNgayGioVN, dinhDangNgayGioNgan } = require('../services/dateUtils');
const { taoQRCodeBuffer } = require('../services/qrService');
const { taiDsAnh } = require('../services/anhNguonService');
const { DANH_SACH_TRANG_THAI_BAO_CAO, GIA_TRI_LOC_TRONG, khopGiaTriLoc } = require('../data/pipelineTinhTrang');
```

(Removed `https`, `http`, the `driveService`/`trangWebService`/`storageService` imports, and `taiAnh`/`taiAnhTuUrlThuong`/`taiUrlTho` from what's imported — `routes/reports.js` only ever calls `taiDsAnh` directly outside the block being deleted in Step 3. Double-check this is true in your checkout with `grep -n "taiAnh(\|taiUrlTho(\|taiAnhTuUrlThuong(\|storageService\.\|http\.\|https\." routes/reports.js` before deleting — every match should be inside the block you're about to delete in Step 3.)

- [ ] **Step 3: Delete the 4 extracted functions from `routes/reports.js`**

Find this whole block (it sits between the `nhanDangDinhDangAnh` function and the `taiAnhChoDon` function):

```js
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
async function taiDsAnh(url) {
  const dsThuMuc = await layDsAnhTrongThuMucDrive(url);
  if (dsThuMuc !== null) return dsThuMuc; // đúng là link thư mục (kể cả khi rỗng) — không thử nguồn khác nữa

  const mot = await taiAnh(url);
  return mot ? [mot] : [];
}

async function taiAnhChoDon(don) {
```

Replace with just:

```js
async function taiAnhChoDon(don) {
```

(This deletes the 4 functions and their leading comments entirely, leaving `taiAnhChoDon` — which still calls `taiDsAnh`, now resolved via the new import from Step 2 — untouched.)

- [ ] **Step 2: Verify both files load without errors**

```bash
node --check routes/reports.js
node --check services/anhNguonService.js
node -e "require('./services/anhNguonService.js'); console.log('anhNguonService OK')"
node -e "require('./routes/reports.js'); console.log('reports.js OK')"
```

Expected: all 4 commands succeed with no errors (the `require()` checks catch missing-import/reference mistakes that `--check` alone wouldn't).

- [ ] **Step 3: Confirm the diff is a pure move (no behavior change)**

```bash
git diff routes/reports.js
```

Read it top to bottom — it should show ONLY: the import block simplification, and the 4-function block replaced by nothing (just the `taiAnhChoDon` line remaining). No other line in `routes/reports.js` should change. This matters because there's no automated test to catch a regression in the existing PDF/report generation features that depend on `taiAnhChoDon`.

- [ ] **Step 4: Commit**

```bash
git add services/anhNguonService.js routes/reports.js
git commit -m "$(cat <<'EOF'
refactor: extract multi-source image fetching into anhNguonService

Moves taiUrlTho/taiAnhTuUrlThuong/taiAnh/taiDsAnh out of routes/reports.js
(where they were private) into a shared service, so the upcoming batch-
order hashing job can reuse the same MinIO/Drive/Gemini/plain-URL
resolution logic instead of duplicating it. Pure move, no behavior change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Invalidate stale hash when the design image changes

**Files:**
- Modify: `services/orderService.js` — function `update()` (currently around line 140)

- [ ] **Step 1: Add the invalidation logic**

Find:

```js
  const updatesSauInMa = tinhPhoiVeFileTuDongKhiInMa(row, updates);
  const updatesDaTinh = tinhTinhTrangTuDong(row, updatesSauInMa);
  kiemTraTinhHopLy(row, updatesDaTinh); // kiểm tra SAU khi đã tính tự động, để không báo nhầm khi chính việc tự động hoá làm cho tổ hợp trở nên hợp lệ
```

Replace with:

```js
  const updatesSauInMa = tinhPhoiVeFileTuDongKhiInMa(row, updates);
  const updatesDaTinh = tinhTinhTrangTuDong(row, updatesSauInMa);

  // Ảnh mẫu đổi thì hash cũ (nếu Sheet đã có cột) không còn đúng nữa — xoá để lượt "Quét tìm đơn hàng
  // loạt" kế tiếp (routes/orders.js) tính lại, tránh nhóm hàng loạt sai lặng lẽ theo ảnh cũ đã không
  // còn tồn tại. Guard theo headers.includes(...) — vô hại với Sheet chưa thêm 2 cột này (xem
  // docs/superpowers/specs/2026-09-06-don-hang-loat-design.md mục 2).
  if (
    headers.includes('HASH_ANH_MAU') &&
    updatesDaTinh.DUONG_DAN_URL !== undefined &&
    updatesDaTinh.DUONG_DAN_URL !== row.DUONG_DAN_URL &&
    updatesDaTinh.HASH_ANH_MAU === undefined
  ) {
    updatesDaTinh.HASH_ANH_MAU = '';
    if (headers.includes('NHOM_HANG_LOAT')) updatesDaTinh.NHOM_HANG_LOAT = '';
  }

  kiemTraTinhHopLy(row, updatesDaTinh); // kiểm tra SAU khi đã tính tự động, để không báo nhầm khi chính việc tự động hoá làm cho tổ hợp trở nên hợp lệ
```

- [ ] **Step 2: Verify with a throwaway script**

This function reads from Google Sheets (`getByKey`), so it can't be unit-tested standalone without real credentials. Instead, verify by reading the diff carefully and confirming the guard logic:

```bash
node --check services/orderService.js
node -e "require('./services/orderService.js'); console.log('orderService OK')"
```

Then re-read the new block and confirm by hand:
- If `headers` (the real Sheet's column list) does NOT include `'HASH_ANH_MAU'`, the whole `if` is skipped — no behavior change for shops that haven't added the new column yet.
- If `updates` (the caller's requested changes) doesn't touch `DUONG_DAN_URL` at all, `updatesDaTinh.DUONG_DAN_URL` is `undefined`, so the condition is false — no behavior change for any update unrelated to the design image (which is the vast majority of calls to this function, e.g. status changes, phôi/vẽ file toggles).
- If a caller explicitly sets `HASH_ANH_MAU` itself in the same update (e.g. the batch-hash job from Task 5, which writes `HASH_ANH_MAU` directly via `updateCells`, not through this `update()` function, so this scenario is theoretical/defensive) — the guard `updatesDaTinh.HASH_ANH_MAU === undefined` prevents this code from stomping on that caller's explicit value.

- [ ] **Step 3: Commit**

```bash
git add services/orderService.js
git commit -m "$(cat <<'EOF'
fix: clear stale design-image hash when DUONG_DAN_URL changes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: "Quét tìm đơn hàng loạt" job routes + filter in `routes/orders.js`

**Files:**
- Modify: `routes/orders.js` (imports at top, `GET /` handler, new routes appended before `module.exports = router;`)

- [ ] **Step 1: Add new imports**

Find the top of the file:

```js
const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const alertService = require('../services/alertService');
const scenarioService = require('../services/scenarioService');
const { parseNgay } = require('../services/dateUtils');
const { DANH_SACH_TRANG_THAI_BAO_CAO, TRANG_THAI_PHOI_VALUES, TRANG_THAI_VE_FILE_VALUES, khopGiaTriLoc } = require('../data/pipelineTinhTrang');
const { ghiLog, layLichSuTheoDon, layLichSuChuyenSangTrangThai } = require('../services/logService');
const { requireLogin } = require('../middleware/auth');
```

Replace with:

```js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const orderService = require('../services/orderService');
const alertService = require('../services/alertService');
const scenarioService = require('../services/scenarioService');
const { parseNgay } = require('../services/dateUtils');
const { DANH_SACH_TRANG_THAI_BAO_CAO, TRANG_THAI_PHOI_VALUES, TRANG_THAI_VE_FILE_VALUES, khopGiaTriLoc } = require('../data/pipelineTinhTrang');
const { ghiLog, layLichSuTheoDon, layLichSuChuyenSangTrangThai } = require('../services/logService');
const { updateCells } = require('../services/sheetsService');
const { taiDsAnh } = require('../services/anhNguonService');
const { tinhHashAnh, khoangCachHamming } = require('../services/perceptualHashService');
const { requireLogin } = require('../middleware/auth');
```

- [ ] **Step 2: Add the `hangLoat` filter to `GET /`**

Find:

```js
  const {
    trangThai, trangThaiPhoi, trangThaiVeFile, kh, tuNgay, denNgay,
    loai, kichThuoc, mauSac, hangVanChuyen, canhBao, sapXep,
  } = req.query;
  if (trangThai) list = list.filter(r => khopGiaTriLoc(r.TRANG_THAI_XUONG, trangThai));
  if (trangThaiPhoi) list = list.filter(r => khopGiaTriLoc(r.TRANG_THAI_PHOI, trangThaiPhoi));
  if (trangThaiVeFile) list = list.filter(r => khopGiaTriLoc(r.TRANG_THAI_VE_FILE, trangThaiVeFile));
  if (loai) list = list.filter(r => r.LOAI === loai);
  if (kichThuoc) list = list.filter(r => r.KICH_THUOC === kichThuoc);
  if (mauSac) list = list.filter(r => r.MAU_SAC === mauSac);
  if (hangVanChuyen) list = list.filter(r => r.HANG_VAN_CHUYEN === hangVanChuyen);
  if (canhBao) list = list.filter(r => r.CanhBao === canhBao);
```

Replace with:

```js
  const {
    trangThai, trangThaiPhoi, trangThaiVeFile, kh, tuNgay, denNgay,
    loai, kichThuoc, mauSac, hangVanChuyen, canhBao, sapXep, hangLoat,
  } = req.query;
  if (trangThai) list = list.filter(r => khopGiaTriLoc(r.TRANG_THAI_XUONG, trangThai));
  if (trangThaiPhoi) list = list.filter(r => khopGiaTriLoc(r.TRANG_THAI_PHOI, trangThaiPhoi));
  if (trangThaiVeFile) list = list.filter(r => khopGiaTriLoc(r.TRANG_THAI_VE_FILE, trangThaiVeFile));
  if (loai) list = list.filter(r => r.LOAI === loai);
  if (kichThuoc) list = list.filter(r => r.KICH_THUOC === kichThuoc);
  if (mauSac) list = list.filter(r => r.MAU_SAC === mauSac);
  if (hangVanChuyen) list = list.filter(r => r.HANG_VAN_CHUYEN === hangVanChuyen);
  if (canhBao) list = list.filter(r => r.CanhBao === canhBao);
  if (hangLoat) list = list.filter(r => !!r.NHOM_HANG_LOAT);
```

- [ ] **Step 3: Add the job routes at the end of the file**

Find the very end of the file:

```js
  await ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'CAP_NHAT_DON',
    sttKey: req.params.sttKey,
    chiTiet: {
      ...updates,
      ...(updated._daTuDongChuyenTinhTrang ? { tuDongChuyenTinhTrangSang: updated._tinhTrangTuDongMoi } : {}),
    },
  });
  res.json(updated);
});

module.exports = router;
```

Replace with:

```js
  await ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'CAP_NHAT_DON',
    sttKey: req.params.sttKey,
    chiTiet: {
      ...updates,
      ...(updated._daTuDongChuyenTinhTrang ? { tuDongChuyenTinhTrangSang: updated._tinhTrangTuDongMoi } : {}),
    },
  });
  res.json(updated);
});

// ============================================================
// "ĐƠN HÀNG LOẠT" — quét toàn bộ đơn thiếu HASH_ANH_MAU, tính perceptual hash (dHash) cho ảnh mẫu
// (DUONG_DAN_URL), rồi gom nhóm các đơn có ảnh mẫu giống/gần giống nhau (khoảng cách Hamming nhỏ)
// vào cùng 1 mã NHOM_HANG_LOAT. Chạy THỦ CÔNG khi người dùng bấm nút "QUÉT TÌM ĐƠN HÀNG LOẠT" ở
// public/orders.html — KHÔNG có lịch chạy nền tự động. Dùng đúng mô hình "job chạy nền + hỏi tiến độ
// + có nút Dừng" đã có ở routes/reports.js (_congViecInDon) cho "IN ĐƠN ĐANG CHỌN", chỉ khác domain.
// Xem thiết kế đầy đủ ở docs/superpowers/specs/2026-09-06-don-hang-loat-design.md.
// ============================================================

// ≤ 8/64 bit khác nhau coi là cùng thiết kế — mốc KHỞI ĐIỂM, CHƯA được xác nhận bằng dữ liệu thật
// (chỉ kiểm thử bằng ảnh giả lập lúc thiết kế tính năng, xem services/perceptualHashService.js và
// spec mục 3). BẮT BUỘC xem lại kết quả nhóm thực tế sau lần quét đầu và chỉnh lại nếu nhóm sai/thiếu.
const NGUONG_HAMMING = 8;

const _congViecHangLoat = new Map(); // jobId -> { tongSo, daXong, trangThai, daHuy, loi, ketQua, capNhatLucNao }
const THOI_GIAN_GIU_JOB_HANG_LOAT_MS = 15 * 60 * 1000;

function donDepJobHangLoatCu() {
  const gioiHan = Date.now() - THOI_GIAN_GIU_JOB_HANG_LOAT_MS;
  for (const [id, job] of _congViecHangLoat) {
    if (job.capNhatLucNao < gioiHan) _congViecHangLoat.delete(id);
  }
}

// Union-Find (Disjoint Set Union) đơn giản — dùng để gom các đơn có hash gần nhau (khoảng cách
// Hamming ≤ NGUONG_HAMMING) thành từng nhóm liên thông, thay vì chỉ so khớp CHÍNH XÁC từng cặp.
function taoDSU(n) {
  const cha = Array.from({ length: n }, (_, i) => i);
  function tim(x) { return cha[x] === x ? x : (cha[x] = tim(cha[x])); }
  function hop(a, b) { const ra = tim(a), rb = tim(b); if (ra !== rb) cha[ra] = rb; }
  return { tim, hop };
}

// Tính lại NHOM_HANG_LOAT cho TOÀN BỘ đơn đang có HASH_ANH_MAU (không chỉ các đơn vừa hash xong) — 1
// đơn cũ đã có hash từ trước vẫn cần được xét lại vì 1 đơn MỚI vừa hash xong có thể khớp với nó. Chỉ
// ghi lại Sheet những đơn có mã nhóm THAY ĐỔI so với hiện tại (kể cả ghi '' để xoá mã nhóm cũ không
// còn đúng) — tránh ghi thừa hàng trăm ô không đổi mỗi lần quét.
async function tinhLaiNhomHangLoat(headers) {
  const { rows: tatCaDon } = await orderService.getAll();
  const coHash = tatCaDon.filter(d => d.HASH_ANH_MAU);

  const dsu = taoDSU(coHash.length);
  for (let i = 0; i < coHash.length; i++) {
    for (let j = i + 1; j < coHash.length; j++) {
      if (khoangCachHamming(coHash[i].HASH_ANH_MAU, coHash[j].HASH_ANH_MAU) <= NGUONG_HAMMING) {
        dsu.hop(i, j);
      }
    }
  }

  const theoNhom = new Map(); // root -> [đơn...]
  coHash.forEach((don, i) => {
    const root = dsu.tim(i);
    if (!theoNhom.has(root)) theoNhom.set(root, []);
    theoNhom.get(root).push(don);
  });

  const maNhomTheoSttKey = new Map(); // STT_Key -> mã nhóm (chỉ chứa đơn thuộc nhóm ≥ 2 đơn)
  let soNhomTimThay = 0;
  for (const dsDonTrongNhom of theoNhom.values()) {
    if (dsDonTrongNhom.length < 2) continue;
    soNhomTimThay++;
    const maNhom = dsDonTrongNhom.map(d => d.STT_Key).sort()[0];
    dsDonTrongNhom.forEach(d => maNhomTheoSttKey.set(d.STT_Key, maNhom));
  }

  let soDonTrongNhom = 0;
  for (const don of tatCaDon) {
    const maNhomMoi = maNhomTheoSttKey.get(don.STT_Key) || '';
    if (maNhomMoi) soDonTrongNhom++;
    if ((don.NHOM_HANG_LOAT || '') !== maNhomMoi) {
      await updateCells(orderService.TAB, headers, don._row, { NHOM_HANG_LOAT: maNhomMoi });
    }
  }

  return { soNhomTimThay, soDonTrongNhom };
}

router.post('/quet-hang-loat/bat-dau', async (req, res) => {
  donDepJobHangLoatCu();

  const { headers, rows } = await orderService.getAll({ fresh: true });
  if (!headers.includes('HASH_ANH_MAU') || !headers.includes('NHOM_HANG_LOAT')) {
    return res.status(400).json({ error: 'Sheet chưa có đủ 2 cột HASH_ANH_MAU/NHOM_HANG_LOAT — cần thêm vào Don_Hang_ALL trước khi dùng tính năng "Đơn hàng loạt"' });
  }

  const donThieuHash = rows.filter(d => d.DUONG_DAN_URL && !d.HASH_ANH_MAU);

  const jobId = crypto.randomUUID();
  const job = {
    tongSo: donThieuHash.length, daXong: 0, trangThai: 'dang_chay', daHuy: false,
    loi: null, ketQua: null, capNhatLucNao: Date.now(),
  };
  _congViecHangLoat.set(jobId, job);

  res.json({ jobId, tongSo: donThieuHash.length });

  // Xử lý THẬT chạy nền sau khi đã trả response — KHÔNG await ở trên.
  (async () => {
    try {
      let soTinhDuocHash = 0;
      for (const don of donThieuHash) {
        if (job.daHuy) break;

        const dsMau = await taiDsAnh(don.DUONG_DAN_URL);
        const hash = dsMau[0] ? await tinhHashAnh(dsMau[0]) : null;
        if (hash) {
          await updateCells(orderService.TAB, headers, don._row, { HASH_ANH_MAU: hash });
          soTinhDuocHash++;
        }

        job.daXong++;
        job.capNhatLucNao = Date.now();
      }

      // Luôn tính lại nhóm SAU vòng lặp trên, kể cả khi bị hủy giữa chừng — tận dụng các hash đã tính
      // được thay vì bỏ phí, và cũng để bắt các thay đổi khác (đơn bị xoá ảnh mẫu chẳng hạn — xem
      // services/orderService.js) kể cả khi không có đơn nào mới cần tính hash ở vòng lặp trên.
      const { soNhomTimThay, soDonTrongNhom } = await tinhLaiNhomHangLoat(headers);

      job.ketQua = { soDaQuet: job.daXong, soTinhDuocHash, soNhomTimThay, soDonTrongNhom };
      job.trangThai = job.daHuy ? 'huy' : 'xong';
    } catch (err) {
      console.error('[Orders] Lỗi quét đơn hàng loạt (chạy nền):', err.message);
      job.trangThai = 'loi';
      job.loi = err.message;
    }
    job.capNhatLucNao = Date.now();
  })();
});

router.get('/quet-hang-loat/tien-do/:jobId', (req, res) => {
  const job = _congViecHangLoat.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Không tìm thấy tiến trình (có thể đã hết hạn)' });
  res.json({ tongSo: job.tongSo, daXong: job.daXong, trangThai: job.trangThai, loi: job.loi, ketQua: job.ketQua });
});

// Nút "DỪNG" ở public/orders.html gọi route này — chỉ đặt cờ 'daHuy', KHÔNG xoá job ngay (job vẫn
// đang chạy nền, cần tự đọc cờ này rồi mới dừng đúng chỗ — xem router.post('/quet-hang-loat/bat-dau')).
router.post('/quet-hang-loat/huy/:jobId', (req, res) => {
  const job = _congViecHangLoat.get(req.params.jobId);
  if (job && job.trangThai === 'dang_chay') job.daHuy = true;
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 4: Verify the file loads and has no syntax errors**

```bash
node --check routes/orders.js
node -e "require('./routes/orders.js'); console.log('orders.js OK')"
```

Expected: both succeed with no error. The `require()` check is important here — it will catch typos in the new imports (`updateCells`, `taiDsAnh`, `tinhHashAnh`, `khoangCachHamming`) that `--check` alone (syntax-only) would miss.

- [ ] **Step 5: Trace through the job lifecycle by reading the code (no live Sheets access available)**

Confirm by re-reading the code you just wrote:
- If the Sheet is missing either new column, `bat-dau` returns a 400 with a clear message and never creates a job — no job leaks into `_congViecHangLoat` for a request that fails validation.
- If `donThieuHash.length === 0` (nothing to hash), the `for` loop body never runs, but `tinhLaiNhomHangLoat` still runs and the job still reaches `trangThai: 'xong'` with a `ketQua` — a client polling this job will NOT hang waiting for a `daXong` that never moves, since `tongSo` is also `0` and the job transitions to `'xong'` immediately after the (empty) loop.
- If `job.daHuy` becomes true mid-loop (via the `huy` route), the loop `break`s but `tinhLaiNhomHangLoat` still runs on whatever was hashed so far, and `job.trangThai` ends as `'huy'` (not `'xong'`) — the client can distinguish "completed" from "stopped early" while still getting a real `ketQua`.
- If `taiDsAnh` throws (network error not caught internally) or `tinhHashAnh` throws (it shouldn't — it has its own try/catch — but confirm this by re-reading Task 2's file), the whole outer `try` in the IIFE catches it, setting `trangThai: 'loi'` — the loop does NOT silently die leaving the job stuck at `'dang_chay'` forever.
- If `updateCells` throws (e.g. Sheets API transient error) for one order's hash write, that also propagates to the same outer catch — meaning ONE flaky write currently aborts the WHOLE remaining scan rather than just skipping that order. This matches the existing codebase's general pattern for these background jobs (`routes/reports.js`'s PDF job has the same "any error kills the whole job" shape) — not a regression to fix here, just confirm it's an accepted, consistent tradeoff and not something introduced by this task alone.

- [ ] **Step 6: Commit**

```bash
git add routes/orders.js
git commit -m "$(cat <<'EOF'
feat: add manual "quét tìm đơn hàng loạt" job and hangLoat filter

Scans orders missing a design-image hash, computes it, then regroups
ALL hashed orders by Hamming-distance clustering into NHOM_HANG_LOAT.
Runs only when triggered (no cron), using the same background-job +
progress-polling + cancel shape already used for PDF export jobs.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: UI — toolbar button, filter checkbox, and client-side job handling

**Files:**
- Modify: `public/orders.html` (toolbar button, filter panel, startup script, `taiDon()`, `xoaTatCaLoc()`, new `quetDonHangLoat()` function)
- Modify: `public/css/style.css` (small addition so the new checkbox filter renders correctly, not as a bordered/padded box like a text input)

- [ ] **Step 1: Add the toolbar button**

Find:

```html
  <div class="thanh-cong-cu-danh-sach">
    <button type="button" class="btn-hanh-dong phu" id="btn-mo-loc" onclick="batTatPanel('panel-loc')"></button>
    <button type="button" class="btn-hanh-dong phu" id="btn-mo-sap-xep" onclick="batTatPanel('panel-sap-xep')"></button>
    <button type="button" class="btn-hanh-dong phu" id="btn-in-phoi-ao" onclick="inPhoiDangChon(this)"></button>
    <button type="button" class="btn-hanh-dong phu" id="btn-in-don-dang-chon" onclick="inDonDangChon(this)"></button>
    <button type="button" class="btn-hanh-dong phu" id="btn-in-ma-phoi-don" onclick="inMaPhoiDonDangChon(this)"></button>
  </div>
```

Replace with:

```html
  <div class="thanh-cong-cu-danh-sach">
    <button type="button" class="btn-hanh-dong phu" id="btn-mo-loc" onclick="batTatPanel('panel-loc')"></button>
    <button type="button" class="btn-hanh-dong phu" id="btn-mo-sap-xep" onclick="batTatPanel('panel-sap-xep')"></button>
    <button type="button" class="btn-hanh-dong phu" id="btn-in-phoi-ao" onclick="inPhoiDangChon(this)"></button>
    <button type="button" class="btn-hanh-dong phu" id="btn-in-don-dang-chon" onclick="inDonDangChon(this)"></button>
    <button type="button" class="btn-hanh-dong phu" id="btn-in-ma-phoi-don" onclick="inMaPhoiDonDangChon(this)"></button>
    <button type="button" class="btn-hanh-dong phu" id="btn-quet-hang-loat" onclick="quetDonHangLoat(this)"></button>
  </div>
```

(If your checkout's `orders.html` doesn't have `btn-in-ma-phoi-don` yet because Tasks from an earlier plan haven't landed, just add `btn-quet-hang-loat` as the last button in this same `.thanh-cong-cu-danh-sach` div, after whatever buttons are already there.)

- [ ] **Step 2: Add the filter checkbox to the Lọc panel**

Find the "Mức cảnh báo" field inside `#panel-loc .inline-form` (or any `.truong` block in that panel — insert right after it):

```html
      <div class="truong">
        <label for="loc-canh-bao">Mức cảnh báo</label>
        <select id="loc-canh-bao">
          <option value="">Tất cả mức cảnh báo</option>
          <option value="VANG">Vàng · 3 ngày</option>
          <option value="CAM">Cam · 5 ngày</option>
          <option value="DO">Đỏ · 7 ngày</option>
        </select>
      </div>
```

Replace with:

```html
      <div class="truong">
        <label for="loc-canh-bao">Mức cảnh báo</label>
        <select id="loc-canh-bao">
          <option value="">Tất cả mức cảnh báo</option>
          <option value="VANG">Vàng · 3 ngày</option>
          <option value="CAM">Cam · 5 ngày</option>
          <option value="DO">Đỏ · 7 ngày</option>
        </select>
      </div>
      <label class="chon-tat-ca-hang truong-hang-loat" for="loc-hang-loat">
        <input type="checkbox" id="loc-hang-loat">
        Chỉ đơn hàng loạt
      </label>
```

(This label is a direct child of `.inline-form`, a sibling of the `.truong` divs — NOT itself a `.truong` — reusing the existing `.chon-tat-ca-hang` look, which is already styled as a row-flex label+checkbox elsewhere on this same page for "Chọn tất cả đơn đang hiển thị".)

- [ ] **Step 3: Add the small CSS override**

Find in `public/css/style.css`:

```css
.chon-tat-ca-hang {
  display: flex; align-items: center; gap: 8px; margin-bottom: var(--space-3);
  font-size: 0.9rem; font-weight: 600; color: var(--color-text-muted); cursor: pointer;
}
.chon-tat-ca-hang input { width: 20px; height: 20px; accent-color: var(--color-primary); cursor: pointer; }
```

Replace with:

```css
.chon-tat-ca-hang {
  display: flex; align-items: center; gap: 8px; margin-bottom: var(--space-3);
  font-size: 0.9rem; font-weight: 600; color: var(--color-text-muted); cursor: pointer;
}
.chon-tat-ca-hang input { width: 20px; height: 20px; accent-color: var(--color-primary); cursor: pointer; }

/* Tái dùng .chon-tat-ca-hang cho ô lọc "Chỉ đơn hàng loạt" trong #panel-loc (public/orders.html) —
   khi đặt trực tiếp trong .inline-form (không bọc trong .truong), input[type=checkbox] vẫn bị dính
   style của ".inline-form input" (padding/border/min-height dành cho ô nhập text) — reset lại đúng 3
   thuộc tính đó, giữ nguyên width/height/accent-color/cursor đã có ở .chon-tat-ca-hang input. */
.truong-hang-loat { margin-bottom: 0; }
.truong-hang-loat input { padding: 0; border: none; min-height: auto; }
```

- [ ] **Step 4: Label the button in the startup script**

Find:

```js
  document.getElementById('btn-in-phoi-ao').innerHTML = icon('printer') + ' IN DANH SÁCH PHÔI CỦA ĐƠN ĐANG CHỌN';
  document.getElementById('btn-in-don-dang-chon').innerHTML = icon('printer') + ' IN ĐƠN ĐANG CHỌN';
```

Replace with:

```js
  document.getElementById('btn-in-phoi-ao').innerHTML = icon('printer') + ' IN DANH SÁCH PHÔI CỦA ĐƠN ĐANG CHỌN';
  document.getElementById('btn-in-don-dang-chon').innerHTML = icon('printer') + ' IN ĐƠN ĐANG CHỌN';
  document.getElementById('btn-quet-hang-loat').innerHTML = icon('scan') + ' QUÉT TÌM ĐƠN HÀNG LOẠT';
```

(If `btn-in-ma-phoi-don`'s own label-setting block from an earlier plan is present in your checkout, add the `btn-quet-hang-loat` line right after it instead — order among these label assignments doesn't matter, they're independent.)

- [ ] **Step 5: Wire the checkbox's `onchange` and reset behavior**

Find (in the same startup script, near the other filter `.onchange` wiring):

```js
  document.getElementById('loc-canh-bao').onchange = () => { boChonTatCaDon(); taiDon(); };
```

Replace with:

```js
  document.getElementById('loc-canh-bao').onchange = () => { boChonTatCaDon(); taiDon(); };
  document.getElementById('loc-hang-loat').onchange = () => { boChonTatCaDon(); taiDon(); };
```

Find:

```js
function xoaTatCaLoc() {
  CAC_O_LOC.forEach(id => { document.getElementById(id).value = ''; });
  boChonTatCaDon();
  taiDon();
}
```

Replace with:

```js
function xoaTatCaLoc() {
  CAC_O_LOC.forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('loc-hang-loat').checked = false; // checkbox — .value không tự bỏ tick, phải set .checked riêng
  boChonTatCaDon();
  taiDon();
}
```

(Do NOT add `'loc-hang-loat'` to the `CAC_O_LOC` array itself — that array's consumers assume `.value = ''` resets the field, which does nothing for a checkbox.)

- [ ] **Step 6: Read the checkbox and send it in `taiDon()`**

Find:

```js
  const canhBao = document.getElementById('loc-canh-bao').value;
```

Replace with:

```js
  const canhBao = document.getElementById('loc-canh-bao').value;
  const hangLoat = document.getElementById('loc-hang-loat').checked;
```

Find:

```js
  if (canhBao) qs.set('canhBao', canhBao);
```

Replace with:

```js
  if (canhBao) qs.set('canhBao', canhBao);
  if (hangLoat) qs.set('hangLoat', '1');
```

- [ ] **Step 7: Add the `quetDonHangLoat()` function**

Add this function anywhere among the other button-handler functions in the same `<script>` block (e.g. right after `inPhoiDangChon` or at the end of the script, before `</script>`):

```js
// Nút "QUÉT TÌM ĐƠN HÀNG LOẠT" — quét TOÀN BỘ đơn (không phụ thuộc donDaChonSet/bộ lọc đang áp dụng)
// đang thiếu HASH_ANH_MAU, tính hash cho ảnh mẫu, rồi gộp nhóm lại. Chạy nền + hỏi tiến độ + có nút
// Dừng, cùng khuôn mẫu với inDonHangLoatCoTienDo() ở trên — chỉ khác domain (ảnh/hash thay vì PDF).
async function quetDonHangLoat(nut) {
  if (!confirm('Quét toàn bộ đơn để tìm và gộp nhóm "Đơn hàng loạt"? Có thể mất vài phút nếu nhiều đơn chưa từng được quét.')) return;

  const nhanGoc = nut.innerHTML;
  nut.disabled = true;
  nut.innerHTML = icon('spinner', { className: 'icon-spin', size: 18 }) + ' Đang bắt đầu...';

  let ketQuaBatDau;
  try {
    ketQuaBatDau = await apiFetch('/orders/quet-hang-loat/bat-dau', { method: 'POST' });
  } catch (e) {
    alert('Lỗi: ' + e.message);
    nut.disabled = false; nut.innerHTML = nhanGoc;
    return;
  }

  const { jobId, tongSo } = ketQuaBatDau;
  const thanhTienDo = taoThanhTienDo(nut, {
    onHuy: () => { apiFetch(`/orders/quet-hang-loat/huy/${jobId}`, { method: 'POST' }).catch(() => {}); },
  });
  thanhTienDo.capNhat(0, tongSo);

  try {
    let tienDo;
    do {
      await new Promise(r => setTimeout(r, 700));
      tienDo = await apiFetch(`/orders/quet-hang-loat/tien-do/${jobId}`);
      thanhTienDo.capNhat(tienDo.daXong, tienDo.tongSo);
      if (tienDo.trangThai === 'loi') throw new Error(tienDo.loi || 'Quét thất bại');
    } while (tienDo.trangThai !== 'xong' && tienDo.trangThai !== 'huy');

    const kq = tienDo.ketQua;
    const tienToDaDung = tienDo.trangThai === 'huy' ? 'Đã dừng giữa chừng. ' : '';
    alert(
      `${tienToDaDung}Đã quét ${kq.soDaQuet}/${tongSo} đơn, tính được hash cho ${kq.soTinhDuocHash} đơn.\n` +
      `Tìm thấy ${kq.soNhomTimThay} nhóm hàng loạt (tổng cộng ${kq.soDonTrongNhom} đơn thuộc 1 nhóm nào đó).`
    );
  } catch (e) {
    alert('Lỗi: ' + e.message);
  } finally {
    thanhTienDo.xoa();
    nut.disabled = false;
    nut.innerHTML = nhanGoc;
  }

  await taiDon();
}
```

- [ ] **Step 8: Verify the inline script still has valid syntax**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/orders.html', 'utf8');
const matches = [...html.matchAll(/<script(?:\s+src=\"[^\"]*\")?[^>]*>([\s\S]*?)<\/script>/g)];
const inline = matches.filter(m => m[1].trim().length > 0).map(m => m[1]).join('\n');
require('fs').writeFileSync(require('os').tmpdir() + '/orders-inline-check.js', inline);
"
node --check "$(node -e "console.log(require('os').tmpdir())")/orders-inline-check.js"
```

Expected: no syntax error. (This extracts just the inline `<script>` content to a temp file and runs Node's parser over it — the same technique used to verify `scan.html` in an earlier feature on this project.)

- [ ] **Step 9: Note the limits of what you can verify here**

This project's dev environment cannot log in (Google Sheets service-account credentials are a non-functional placeholder in sandboxed/CI-like environments — confirmed true in at least one prior session on this project). If that's also true for you: do NOT claim a live browser check happened. State plainly that the checkbox's visual layout (Step 3's CSS) and the full click-through flow (confirm dialog → progress bar → cancel → final alert → filter actually narrowing the list) are unverified beyond code-reading, and should be checked once by a human with real Sheets access before relying on this feature day-to-day.

If you DO have working credentials in your environment, actually do the manual check: start the dev server (`.claude/launch.json`, config `webapp`, port 3000), log in as any role, go to Đơn hàng, confirm the new button and checkbox render without visual glitches, click "QUÉT TÌM ĐƠN HÀNG LOẠT", and confirm the progress bar, cancel button, and final alert all behave as designed. If the Sheet doesn't have the 2 new columns yet, confirm the button surfaces the "Sheet chưa có đủ 2 cột..." error clearly instead of a generic failure.

- [ ] **Step 10: Commit**

```bash
git add public/orders.html public/css/style.css
git commit -m "$(cat <<'EOF'
feat: add "quét tìm đơn hàng loạt" button and batch-order filter to UI

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final review pass

- [ ] **Step 1: Re-read the full diff against the spec**

The spec was last revised in commit `9d48e51` ("docs: correct dHash kernel/threshold in batch-order spec based on testing"). Diff everything since then, excluding the docs folder itself:

```bash
git diff --stat 9d48e51..HEAD -- . ':!docs'
git diff 9d48e51..HEAD -- . ':!docs'
```

Confirm every point in the spec is covered: 2 new service modules, the `routes/reports.js` refactor, the hash-invalidation in `orderService.update()`, the 3 job routes + filter in `routes/orders.js`, and the UI button/checkbox/CSS in `public/orders.html`/`style.css`.

- [ ] **Step 2: Confirm no other file changed**

```bash
git diff --stat 9d48e51..HEAD
```

Expected file list: `package.json`, `package-lock.json`, `services/perceptualHashService.js` (new), `services/anhNguonService.js` (new), `routes/reports.js`, `services/orderService.js`, `routes/orders.js`, `public/orders.html`, `public/css/style.css`. Nothing else (the spec file itself, `docs/superpowers/specs/2026-09-06-don-hang-loat-design.md`, was already committed at `9d48e51` — it should show 0 further changes here).

- [ ] **Step 3: Re-run the full-file syntax/load checks together**

```bash
node --check routes/orders.js
node --check routes/reports.js
node --check services/orderService.js
node --check services/anhNguonService.js
node --check services/perceptualHashService.js
node -e "require('./server.js'); console.log('server.js loaded OK (routes wired without throwing)')"
```

The last command is the strongest check available without live Sheets credentials — `server.js` requires every route file at startup, so if any import is missing or misspelled anywhere across this whole feature, this will throw immediately. (It will likely then hang trying to actually start listening/connect to Google APIs — that's fine, Ctrl+C or let the Bash tool's timeout kill it once you see "loaded OK" or an error printed; the goal is just to catch load-time errors, not to fully boot the server.)

- [ ] **Step 4: Flag the two known follow-ups to the user in your final summary**

Don't silently close this out — explicitly tell the user:
1. The Google Sheet needs 2 new columns added to `Don_Hang_ALL` (`HASH_ANH_MAU`, `NHOM_HANG_LOAT`) before this feature does anything — the button will show a clear error until then.
2. `NGUONG_HAMMING` (currently `8`, in `routes/orders.js`) was picked from synthetic-image testing, not their real designs — they should run the scan once, look at what got grouped, and ask for that constant to be adjusted if groups look wrong (too aggressive or missing obvious matches).
