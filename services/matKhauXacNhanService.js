// Mật khẩu xác nhận cho thao tác nhạy cảm của superadmin (23/10/2026, theo yêu cầu người dùng — đặt / đổi ngay trên Settings, không sửa
// .env). Chỉ là lớp chống bấm nhầm / dùng ẩu khi phiên superadmin đang mở sẵn, đứng SAU kiểm tra vai trò. Người dùng chốt:
//  - 2 mật khẩu riêng: GIO_NGHI (lưu / mở tạm Giờ nghỉ theo Xưởng), DU_LIEU_DON (xoá / khôi phục dữ liệu đơn);
//  - chưa đổi lần nào = mặc định 2511 (như trước, không gián đoạn sau deploy); đổi phải nhập đúng mật khẩu hiện tại;
//  - lưu dạng hash scrypt + salt (caiDatDbService#mat_khau_xac_nhan), không bao giờ trả lại bản rõ.
const crypto = require('crypto');
const caiDat = require('./caiDatDbService');
const { thoiGianVNISOString } = require('./dateUtils');

const LOAI = {
  GIO_NGHI: 'Lưu / mở tạm Giờ nghỉ theo Xưởng',
  DU_LIEU_DON: 'Xoá / khôi phục dữ liệu đơn hàng',
};
const MAC_DINH = '2511';

function bamMatKhau(mk) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(mk), salt, 32).toString('hex')}`;
}
function khopHash(mk, hash) {
  const [salt, h] = String(hash).split(':');
  if (!salt || !h) return false;
  const a = crypto.scryptSync(String(mk), salt, 32), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function dung(khoa, mk) {
  if (!LOAI[khoa]) return false;
  const dong = caiDat.layMatKhauXacNhan(khoa);
  return dong ? khopHash(mk ?? '', dong.Hash) : String(mk ?? '') === MAC_DINH;
}

// Danh sách cho Settings — không có mật khẩu, chỉ cho biết đã đổi chưa.
function layDanhSach() {
  return Object.entries(LOAI).map(([khoa, ten]) => {
    const d = caiDat.layMatKhauXacNhan(khoa);
    return { khoa, ten, daDoi: !!d, capNhatBoi: d ? d.CapNhatBoi : '', capNhatLuc: d ? d.CapNhatLuc : '' };
  });
}

function doiMatKhau(khoa, cu, moi, nguoi) {
  if (!LOAI[khoa]) throw new Error('Loại mật khẩu không hợp lệ');
  if (!dung(khoa, cu)) throw new Error('Mật khẩu hiện tại không đúng — chưa đổi.');
  const m = String(moi ?? '');
  if (m.length < 4 || m.length > 64) throw new Error('Mật khẩu mới phải có 4 – 64 ký tự');
  if (/\s/.test(m)) throw new Error('Mật khẩu mới không được có khoảng trắng');
  caiDat.datMatKhauXacNhan(khoa, bamMatKhau(m), nguoi, thoiGianVNISOString());
}

module.exports = { LOAI, dung, layDanhSach, doiMatKhau };
