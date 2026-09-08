# Lọc/Sắp xếp đầy đủ cho cả 2 mục ở "Đơn của tôi" — thiết kế

**Ngày:** 2026-09-08
**Yêu cầu gốc:** Ở cả 2 mục "Đơn sẵn sàng chạy máy" và "Đơn đang chạy máy của tôi", bổ sung Lọc và
Sắp xếp theo đúng kiểu nút bấm "Lọc"/"Sắp xếp" thu gọn đang có ở trang Đơn hàng — cho cả admin lẫn
san_xuat.

## Quyết định đã chốt với người dùng

Bộ Lọc gồm 12 trường ở ảnh chụp trang Đơn hàng, nhưng **Phôi** và **Vẽ file** bị loại khỏi bản này —
ở cả 2 mục của "Đơn của tôi", đơn LUÔN đã ở trạng thái yêu cầu cả phôi lẫn file xong rồi (đơn "ĐÃ SẴN
SÀNG CHẠY MÁY" hoặc "Đang chạy máy" bắt buộc phải Đã lấy phôi + Đã vẽ file — xem `kiemTraTinhHopLy`
trong services/orderService.js), nên lọc theo 2 trường đó không có tác dụng gì. **Trạng thái** vẫn
giữ lại (theo đúng lựa chọn của người dùng) dù cũng chỉ có 1 giá trị cố định — giữ cho đủ bộ/đồng bộ
giao diện, giống cách đã làm với "Đang chạy máy" trước đây.

Bộ Lọc cuối cùng (như nhau cho cả 2 mục, phần Trạng thái khác giá trị cố định):
Trạng thái (cố định), Tìm theo tên đơn/mã KH, Từ ngày, Đến ngày, Mức cảnh báo, Loại, Kích thước, Màu
sắc, Hãng vận chuyển, Chỉ đơn hàng loạt.

Bộ Sắp xếp (như nhau cho cả 2 mục, đầy đủ 7 kiểu — mở rộng từ 3 kiểu đang có ở mục "Đang chạy máy của
tôi"): Ngày lên đơn (cũ nhất — mặc định / mới nhất), Mã đơn STT_Key (A-Z / Z-A), Mức cảnh báo, Số
lượng, Tên khách hàng.

## Không cần sửa backend

`GET /orders` đã hỗ trợ sẵn TẤT CẢ tham số cần dùng (`canhBao`, `loai`, `kichThuoc`, `mauSac`,
`hangVanChuyen`, `hangLoat`) và toàn bộ 7 kiểu sắp xếp (`canh_bao`, `so_luong`, `khach_hang`,
`ma_don`/`ma_don_desc` thêm ở lượt trước) — chỉ cần build đúng query string ở client, giống hệt cách
orders.html đang làm.

## Cấu trúc giao diện

Mỗi mục có CẶP nút "Lọc"/"Sắp xếp" ĐỘC LẬP riêng (không dùng chung 1 bộ điều khiển cho cả 2 mục, vì 2
danh sách dữ liệu khác nhau hoàn toàn) — tái dùng đúng class CSS `.panel-dieu-khien`/`.inline-form`/
`.truong` và cơ chế `batTatPanel()` (đóng panel còn lại khi mở 1 panel, toggle khi bấm lại đúng nút
đang mở) đang chứng minh hoạt động tốt ở orders.html, viết lại dạng tham số hoá theo tiền tố
(`'-ss'` cho "sẵn sàng", `''` cho "đang chạy máy của tôi" — giữ nguyên ID các trường đã có ở mục thứ 2
để không phải sửa lại chỗ khác, chỉ mục "sẵn sàng" dùng hậu tố `-ss` vì là trường mới hoàn toàn).

Ô lọc "Người sản xuất" (admin-only, đã có) chuyển vào bên trong panel "Lọc" mới của mục "Đang chạy máy
của tôi" thay vì đứng riêng ngoài như trước.

Vì code lọc/sắp xếp cho 2 mục gần như giống hệt nhau (~9 trường mỗi mục), viết chung 1 số hàm dùng lại
theo tham số thay vì chép 2 lần: `domLaiOChon()` (đã có), `capNhatCacBoLocDong(list, hauTo)`,
`capNhatNhanNutLoc(idBtn, cacOLoc, idHangLoat)`, `batTatPanel(tienTo, ten)`,
`ganSuKienLocSapXep(hauTo, taiLaiFn, boChonFn)`, `xoaCacOLoc(cacOLoc, hauTo)`.

## Hành vi giữ nguyên (không đổi so với hiện tại)

- "Xoá bộ lọc" KHÔNG đụng tới ô Sắp xếp (đúng quy ước orders.html đang dùng — Lọc và Sắp xếp là 2 mối
  quan tâm tách biệt, mỗi cái có nút xoá/mặc định riêng biểu thị bằng nhãn "(mặc định)" trên chính
  option đó).
- Đổi bất kỳ ô lọc nào ở mục "Đơn sẵn sàng chạy máy" thì bỏ chọn các đơn đang chọn (giống hệt orders.html
  — lọc có thể làm đơn đang chọn biến mất khỏi danh sách hiển thị); mục "Đang chạy máy của tôi" không
  có cơ chế chọn nhiều nên không cần.
