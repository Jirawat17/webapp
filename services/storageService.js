const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

// Storage backend S3-compatible (MinIO trên Zima NAS). Dùng AWS SDK thay vì MinIO SDK
// để sau này có thể chuyển sang AWS S3 / R2 / Wasabi... mà không phải sửa business logic.
const s3 = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT,
  region: process.env.MINIO_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY,
  },
  forcePathStyle: process.env.MINIO_FORCE_PATH_STYLE !== 'false',
});

const BUCKET = process.env.MINIO_BUCKET;
const PRESIGNED_EXPIRES = parseInt(process.env.MINIO_PRESIGNED_URL_EXPIRES, 10) || 3600;

// Prefix cố định cho ảnh đơn hàng — mọi ảnh đều nằm dưới orders/{sttKey}/...
const ORDERS_PREFIX = 'orders/';

function requireConfig() {
  if (!process.env.MINIO_ENDPOINT || !process.env.MINIO_ACCESS_KEY || !process.env.MINIO_SECRET_KEY || !BUCKET) {
    throw new Error('Thiếu cấu hình MINIO_ENDPOINT / MINIO_ACCESS_KEY / MINIO_SECRET_KEY / MINIO_BUCKET trong .env');
  }
}

function taoObjectKeyDonHang(sttKey, tenFileGoc) {
  const ext = (tenFileGoc.match(/\.[^.]+$/) || ['.jpg'])[0];
  const base = String(tenFileGoc).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  // UUID đứng đầu để đảm bảo key duy nhất — tên file gốc giữ lại chỉ để dễ nhận diện trên MinIO console.
  return `${ORDERS_PREFIX}${sttKey}/${crypto.randomUUID()}-${base}${ext}`;
}

// S3Client mặc định KHÔNG có timeout nào áp dụng cho send() hay đọc body — nếu MinIO (tự host trên
// NAS) chậm/đứng kết nối giữa chừng, promise treo VÔ THỜI HẠN, không throw, không resolve (bổ sung
// 17/09/2026, xem docs/superpowers/specs/2026-09-17-sua-loi-treo-quet-hang-loat-design.md, ban đầu chỉ
// áp dụng cho chiều ĐỌC — getObjectBuffer() bên dưới; bổ sung 22/09/2026 cho CẢ chiều GHI/upload ở
// uploadImageBuffer() ngay dưới đây, trước đó bị bỏ sót nên 1 lần MinIO nghẽn khi upload ảnh chụp QR là
// treo vô thời hạn, không có cách nào tự phục hồi). Đồng bộ mức với anhNguonService.js#taiUrlTho (15s
// cho URL thường) + chút biên cho ảnh thiết kế có thể nặng.
const THOI_GIAN_CHO_TOI_DA_MS = 20000;

/**
 * Upload buffer ảnh (từ multer memoryStorage) lên MinIO.
 * Trả về object key duy nhất.
 */
async function uploadImageBuffer(buffer, objectKey, contentType = 'image/jpeg') {
  requireConfig();
  if (!buffer || !buffer.length) throw new Error('Buffer ảnh rỗng');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), THOI_GIAN_CHO_TOI_DA_MS);
  try {
    await s3.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: objectKey, Body: buffer, ContentType: contentType }),
      { abortSignal: controller.signal }
    );
  } finally {
    clearTimeout(timer);
  }

  return objectKey;
}

/**
 * Phát 1 object MinIO thẳng ra HTTP response — dùng chung cho mọi route xem file (routes/photos.js, routes/notes.js,
 * routes/thuVien.js). Thay cho getObjectStream() + .pipe(res) trước đây (03/10/2026, phát hiện khi rà soát code):
 * - .pipe() KHÔNG chuyển lỗi/kết thúc: NAS/MinIO ngắt kết nối giữa chừng -> response của người xem KHÔNG BAO GIỜ đóng
 *   (đã đo 03/10/2026: sau 4 giây người xem vẫn chờ, socket treo mãi). pipeline() huỷ luôn response khi nguồn lỗi.
 * - getObjectStream() không có timeout (S3Client mặc định chờ vô hạn, xem ghi chú THOI_GIAN_CHO_TOI_DA_MS bên trên):
 *   giờ chờ MinIO trả header tối đa timeoutMs, và trong lúc truyền, quá timeoutMs không nhận thêm byte nào thì huỷ.
 * Lỗi TRƯỚC khi gửi header -> throw (nơi gọi trả 404/502 như cũ, NoSuchKey vẫn giữ nguyên err.name). Lỗi SAU khi đã gửi
 * header (đứt giữa chừng, người xem tự đóng trang) -> chỉ log + huỷ response, không throw.
 */
async function guiObjectQuaHttp(res, objectKey, { headers = {}, timeoutMs = THOI_GIAN_CHO_TOI_DA_MS } = {}) {
  requireConfig();
  const controller = new AbortController();
  let body = null;
  const timer = setTimeout(() => {
    controller.abort();
    if (body) body.destroy(new Error(`MinIO không gửi thêm dữ liệu trong ${timeoutMs}ms`));
  }, timeoutMs);
  let result;
  try {
    result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: objectKey }), { abortSignal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
  body = result.Body;
  res.setHeader('Content-Type', result.ContentType || 'application/octet-stream');
  if (result.ContentLength) res.setHeader('Content-Length', result.ContentLength);
  for (const [ten, giaTri] of Object.entries(headers)) res.setHeader(ten, giaTri);
  body.on('data', () => timer.refresh());
  try {
    await pipeline(body, res);
  } catch (err) {
    if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('[MinIO] Truyền file bị gián đoạn:', objectKey, '-', err.message);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tải TOÀN BỘ nội dung 1 object MinIO thành Buffer, có giới hạn thời gian chờ — khác guiObjectQuaHttp
 * (trả thẳng stream để pipe() thẳng cho response HTTP ở routes/photos.js, KHÔNG đổi hàm đó để không
 * ảnh hưởng luồng xem ảnh đang chạy tốt). Dùng cho chỗ cần Buffer đầy đủ trước khi xử lý tiếp (vd tính
 * hash ảnh trong vòng lặp quét hàng loạt hàng trăm đơn) — 1 lần treo ở đây là kẹt cả lô. Dùng
 * AbortController tự huỷ sau timeoutMs, bọc CẢ 2 giai đoạn (gửi yêu cầu + đọc xong body) trong cùng 1
 * hạn chót — huỷ thật sự (đóng kết nối), không chỉ ngừng chờ.
 */
// Object có thật trên MinIO không (HEAD — không tải nội dung). true/false; lỗi khác "không tồn tại" (mạng, MinIO treo) -> throw.
async function tonTaiObject(objectKey, { timeoutMs = THOI_GIAN_CHO_TOI_DA_MS } = {}) {
  requireConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: objectKey }), { abortSignal: controller.signal });
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.name === 'NoSuchKey' || (err.$metadata && err.$metadata.httpStatusCode === 404)) return false;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function getObjectBuffer(objectKey, { timeoutMs = THOI_GIAN_CHO_TOI_DA_MS } = {}) {
  requireConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: objectKey }),
      { abortSignal: controller.signal }
    );
    const chunks = [];
    for await (const chunk of result.Body) chunks.push(chunk);
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * URL tạm (presigned) để đọc ảnh riêng tư — mặc định hết hạn sau 3600s.
 */
async function taoPresignedUrl(objectKey, expiresIn = PRESIGNED_EXPIRES) {
  requireConfig();
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: objectKey }), { expiresIn });
}

/**
 * Xoá 1 object. Xoá idempotent: object không tồn tại vẫn coi như thành công.
 */
async function deleteObject(objectKey) {
  requireConfig();
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: objectKey }));
}

/**
 * Liệt kê object keys theo prefix (dùng cho orders/{sttKey}/...).
 */
async function listObjectKeys(prefix) {
  requireConfig();
  const keys = [];
  let token;
  do {
    const result = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const obj of result.Contents || []) keys.push(obj.Key);
    token = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

// URL ổn định lưu trong Sheet: proxy qua API của app (kèm login session) —
// không phụ thuộc presigned URL có hạn, frontend dùng như một URL ảnh bình thường.
const PROXY_URL_PREFIX = '/api/photos/file/';

function objectKeyToProxyUrl(objectKey) {
  return PROXY_URL_PREFIX + objectKey;
}

function proxyUrlToObjectKey(url) {
  if (!url) return null;
  // Chấp nhận cả URL tuyệt đối cùng host (http://host/api/photos/file/...)
  const path = String(url).replace(/^https?:\/\/[^/]+/, '');
  return path.startsWith(PROXY_URL_PREFIX) ? path.slice(PROXY_URL_PREFIX.length) : null;
}

module.exports = {
  taoObjectKeyDonHang,
  uploadImageBuffer,
  guiObjectQuaHttp,
  getObjectBuffer,
  tonTaiObject,
  taoPresignedUrl,
  deleteObject,
  listObjectKeys,
  objectKeyToProxyUrl,
  proxyUrlToObjectKey,
};
