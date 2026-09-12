# "Đơn ưu tiên" (Priority Order)

Theo yêu cầu người dùng: đánh dấu 1 số đơn là "Đơn ưu tiên" để admin/người vẽ file tập trung xử lý
trước. Người dùng đã tự thêm cột `DON_UU_TIEN` vào `Don_Hang_ALL`. Yêu cầu gốc:

> Tính năng phân loại/đánh dấu đơn là "Đơn ưu tiên"... hãy cập nhật code cho phép admin/nguoi_ve_file
> được phép chọn các đơn ưu tiên. Đơn ưu tiên này sẽ được hiển thị lên trên đầu trong danh sách đơn hàng
> và hãy chỉnh giao diện hiển thị để nổi bật hơn các đơn thông thường (Ví dụ: 1 vòng tròn đỏ xung quanh
> tên các đơn này).

## 1. Xác nhận trước khi code

Rà soát trước cho thấy 2/3 điểm có thể tự quyết định từ tiền lệ sẵn có trong app, chỉ còn đúng 1 điểm
cần hỏi:

1. **Hiệu ứng nổi bật** — dùng LẠI đúng kỹ thuật `nhipCanhBao`/`nhipCanhBao Toi` (viền đỏ nhấp nháy)
   đã có sẵn ở mức cảnh báo Đỏ (`badge-canh-bao.do`) — đúng ví dụ "vòng tròn đỏ" người dùng nêu, không
   cần hỏi.
2. **Lan toả thứ tự ưu tiên** — sửa `sapXepDon()` (điểm sắp xếp DUY NHẤT của `GET /orders`) là đủ để
   mọi trang đọc danh sách này (`orders.html`, `my-orders.html`, `my-orders-ve-file.html`) tự động nhận
   đúng thứ tự mới, không cần sửa riêng từng trang — không cần hỏi.
3. **Nơi bấm đánh dấu ưu tiên** (CẦN hỏi — `DANH_DAU_IN`, ứng viên tiền lệ gần nhất, hoá ra chỉ hiển
   thị, chưa từng có UI bật/tắt nào để soi theo): hỏi 3 lựa chọn (nút nhanh trên thẻ / chọn hàng loạt /
   cả 2) — người dùng chọn **cả 2** (khuyến nghị).

## 2. Thiết kế dữ liệu

- `Don_Hang_ALL.DON_UU_TIEN` — giá trị `'TRUE'` / `'FALSE'` (không dùng rỗng/không rỗng như
  `DANH_DAU_IN` cũ) — đúng quy ước `KichHoat`/`BatTuDongMuaTracking` đang dùng trong app, so khớp qua
  `services/orderService.js#laUuTien(row)`:
  ```js
  function laUuTien(row) {
    return String(row.DON_UU_TIEN || '').toUpperCase() === 'TRUE';
  }
  ```
  Chọn giá trị tường minh `'FALSE'` (không cho phép rỗng) khi ghi — tránh lẫn lộn giữa "chưa từng đụng
  tới" (rỗng, đơn cũ trước khi có tính năng) và "đã từng bật rồi tắt lại" (rỗng cũng được, nhưng ghi rõ
  `'FALSE'` cho nhất quán với input `uuTien:false` từ client). `kiemTraGiaTriHopLe()` (điểm ghi chung
  trong `update()`) chặn mọi giá trị khác `'TRUE'`/`'FALSE'`.
- `routes/orders.js#lamGiauDon()` gắn thêm field tính toán `DonUuTien` (boolean, cùng khuôn
  `CanhBao`/`NguoiVanHanh`) — mọi nơi đọc danh sách/chi tiết đơn (client lẫn `sapXepDon()`) dùng field
  này, không tự parse `DON_UU_TIEN` thô lại nhiều lần.

## 3. Sắp xếp — luôn nổi lên đầu bất kể đang sắp theo kiểu gì

`sapXepDon(list, kieu)` tách thành 2 tầng: chọn **comparator phụ** theo `kieu` như cũ (không đổi logic
từng nhánh), rồi bọc ngoài bởi 1 so sánh ưu tiên làm tiêu chí **chính**:

```js
function soSanhUuTienTruoc(a, b) {
  return (b.DonUuTien ? 1 : 0) - (a.DonUuTien ? 1 : 0);
}
// ...
return daSap.sort((a, b) => {
  const chenhLechUuTien = soSanhUuTienTruoc(a, b);
  return chenhLechUuTien !== 0 ? chenhLechUuTien : soSanh(a, b);
});
```

Đơn ưu tiên luôn thành 1 nhóm ở đầu; bên trong mỗi nhóm (ưu tiên riêng, thường riêng) vẫn sắp theo đúng
kiểu người dùng đang chọn (ngày, cảnh báo, số lượng...). Áp dụng cho MỌI kiểu, kể cả mặc định.

## 4. Ghi — `POST /orders/danh-dau-uu-tien` (MỚI)

Cùng khuôn `/gan-xuong` (nhận mảng `sttKeys`, đọc 1 lần qua `getManyByKeys()`, trả `{thanhCong, loi}`),
nhưng **rộng hơn**: cho phép CẢ `admin` LẪN `ve_file` (không chỉ admin) — vì đây là phân loại độ khẩn
cấp công việc, không phải phân chia xưởng vật lý như `XUONG`. Vẫn giữ `coQuyenTheoXuong()` (Xưởng nào
biết Xưởng đó, kể cả ve_file). Route sửa 1 đơn dùng chung (`PUT /orders/:sttKey`) **CẤM** sửa
`DON_UU_TIEN` (thêm vào `TRUONG_CAM_SUA`, đúng cách `XUONG` bị chặn) — bắt buộc đi qua đúng 1 đường ghi
này, dùng chung cho cả 2 nơi bấm ở mục 5.

## 5. Giao diện — `public/orders.html`

- **Nút nhanh trên từng thẻ**: icon ngôi sao cạnh checkbox (chỉ admin/ve_file thấy), bấm là gọi ngay
  `POST /danh-dau-uu-tien` với `sttKeys` 1 phần tử — không cần tick chọn trước, không `confirm()` (đúng
  tinh thần "nút nhanh"). Sao rỗng/xám khi chưa ưu tiên, sao đặc/đỏ khi đã ưu tiên.
- **Chọn hàng loạt**: khối `#khoi-uu-tien` trong thanh hành động — 2 nút "Đánh dấu Ưu tiên"/"Bỏ Ưu
  tiên" (không dùng `<select>`+Áp dụng như Gán Xưởng vì chỉ có đúng 2 lựa chọn — cùng khuôn 2 nút "Đã
  lấy phôi"/"Chưa lấy phôi"). Hiện cho CẢ admin lẫn ve_file (khác khối Gán Xưởng admin-only).
- Cả 2 đường đều gọi chung `POST /orders/danh-dau-uu-tien`, tuần tự từng đơn qua
  `chayHangLoatCoTienDo()`/`taoThanhTienDo()` khi hàng loạt.
- Viền đỏ nhấp nháy (`.uu-tien`, tái dùng `nhipCanhBao`/`nhipCanhBaoToi`) áp cho `.tieu-de-the`, badge
  "⭐ Ưu tiên" thêm ĐẦU `.badge-row`.

**Lỗi CSS phát hiện lúc kiểm thử bằng trình duyệt thật**: `.order-card .tieu-de-the` (2 lớp, đặc trưng
cao hơn) đè mất `display:inline-block` của `.uu-tien` (1 lớp đứng riêng) — viền kéo dài hết bề ngang thẻ
thay vì ôm sát chữ. Sửa bằng 1 luật chọn riêng `.order-card .tieu-de-the.uu-tien { display:inline-block }`
đủ đặc trưng để thắng, không đụng gì tới `.uu-tien` đứng riêng ở nơi khác (`<h2>` trang chi tiết).

## 6. Phạm vi hiển thị (đọc) — mở rộng hợp lý ngoài yêu cầu gốc

Yêu cầu gốc chỉ nói "danh sách đơn hàng" (`orders.html`) — nhưng viền đỏ + badge được áp dụng THÊM
(chỉ hiển thị, không có nút bấm) ở những nơi hiển thị cùng 1 thẻ đơn/tên đơn, để tránh cảm giác "biến
mất" khi rời trang Đơn hàng:

- `public/my-orders.html` (2 danh sách của san_xuat) và `public/my-orders-ve-file.html` (2 danh sách
  của ve_file) — thêm viền + badge, KHÔNG thêm nút bấm (san_xuat không có quyền; ve_file bấm ở
  `orders.html`, giữ đúng 1 nơi ghi duy nhất theo mục 4).
- `public/order.html` (trang chi tiết) — thêm viền quanh `<h2>` tên đơn + badge "Đơn ưu tiên" trong
  badge-row (đọc, không sửa) — không thêm nút bấm (giữ nguyên tiền lệ Gán Xưởng: hành động phân loại
  hàng loạt chỉ có ở `orders.html`).

## 7. Kiểm thử

- `services/orderService.js`: `laUuTien()` (rỗng/TRUE/FALSE/không phân biệt hoa-thường), `update()`
  chấp nhận đúng `TRUE`/`FALSE`, từ chối giá trị rác và chuỗi rỗng.
- `routes/orders.js GET /`: cả 7 kiểu sắp xếp (mặc định + 6 kiểu khác) đều giữ đúng 2 đơn ưu tiên ở 2 vị
  trí đầu; mọi đơn có field `DonUuTien` kiểu boolean.
- `POST /orders/danh-dau-uu-tien`: admin/ve_file thành công, ve_file bị chặn đúng theo Xưởng (đơn khác
  Xưởng rơi vào lỗi "không tìm thấy"), san_xuat bị 403, validate `sttKeys`/`uuTien`, đúng 1 lượt đọc
  toàn bộ sheet cho cả lô (theo convention `getManyByKeys` đã thống nhất trước đó).
- `PUT /orders/:sttKey`: gửi `DON_UU_TIEN` bị lọc bỏ hoàn toàn (kể cả kèm trường khác) — không có cách
  nào lách qua đường ghi chính.
- Trình duyệt thật (mock page dựng từ đúng code thật của `orders.html`, không gõ lại): xác nhận viền ôm
  sát tên (không kéo dài hết thẻ) ở viewport rộng, badge/nút hiện đúng theo `DonUuTien`, bấm nút nhanh
  không điều hướng sang trang chi tiết (`event.stopPropagation()`), gọi đúng API, và danh sách tự vẽ lại
  đúng trạng thái mới.

Không có regression: chạy lại toàn bộ bộ test cũ của tính năng Xưởng + gộp lượt đọc hàng loạt (63 kịch
bản) — 100% vẫn pass.
