// Cấu hình các kịch bản quét QR hàng loạt.
// Muốn thêm/sửa kịch bản mới: chỉnh mảng này, KHÔNG cần sửa routes/qr.js
//
// id            : mã định danh kịch bản (dùng trong URL)
// label         : tên hiển thị trên app
// allowedRoles  : những vai trò được dùng kịch bản này (admin luôn được dùng mọi kịch bản)
// requireStatus : đơn phải đang ở trạng thái này thì quét mới hợp lệ (bỏ trống nếu không cần kiểm tra)
// setStatus     : trạng thái mới sau khi quét thành công
// setFields     : các cột khác cần cập nhật kèm theo — dùng '__TODAY__' để tự điền ngày hôm nay

module.exports = [
  {
    id: 'xong_san_xuat',
    label: 'Sản xuất xong → chuyển Đóng gói',
    allowedRoles: ['san_xuat'],
    requireStatus: 'SAN_XUAT',
    setStatus: 'DONG_GOI',
  },
  {
    id: 'xac_nhan_ship',
    label: 'Xác nhận đã ship',
    allowedRoles: ['dong_goi'],
    requireStatus: 'DONG_GOI',
    setStatus: 'SHIPPED',
    setFields: { Ngay_Ship: '__TODAY__' },
  },
];
