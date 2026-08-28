const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

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

/**
 * Upload buffer ảnh (từ multer memoryStorage) lên MinIO.
 * Trả về object key duy nhất.
 */
async function uploadImageBuffer(buffer, objectKey, contentType = 'image/jpeg') {
  requireConfig();
  if (!buffer || !buffer.length) throw new Error('Buffer ảnh rỗng');

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: objectKey,
    Body: buffer,
    ContentType: contentType,
  }));

  return objectKey;
}

/**
 * Lấy stream ảnh từ MinIO theo object key. Ném lỗi NoSuchKey nếu không tồn tại.
 */
async function getObjectStream(objectKey) {
  requireConfig();
  return s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: objectKey }));
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
  getObjectStream,
  taoPresignedUrl,
  deleteObject,
  listObjectKeys,
  objectKeyToProxyUrl,
  proxyUrlToObjectKey,
};
