# Nhận đơn "ĐÃ SẴN SÀNG CHẠY MÁY" tại "Đơn của tôi" — thiết kế

**Ngày:** 2026-09-08
**Yêu cầu gốc:** Với vai trò admin và san_xuat, tại "Đơn của tôi" cho phép chọn nhiều đơn rồi bấm 1
nút mới "Chuyển các đơn đã chọn từ ĐÃ SẴN SÀNG CHẠY MÁY sang Đang chạy máy" để chuyển trạng thái các
đơn đã chọn.

## Vì sao không cần hỏi thêm trước khi code

Rà lại code hiện có cho thấy mọi mảnh cần thiết đã tồn tại sẵn, không còn điểm mơ hồ thật sự:

- `my-orders.html` vốn đã CHỈ hiện trong menu cho đúng 2 vai trò admin/san_xuat (`public/js/api.js`,
  dòng ~78) — khớp thẳng phạm vi yêu cầu, không cần thêm kiểm tra vai trò nào khác.
- san_xuat vốn đã thấy TOÀN BỘ đơn "ĐÃ SẴN SÀNG CHẠY MÁY" (không giới hạn theo người, vì trạng thái
  này CHƯA có khái niệm "của ai" — `services/orderService.js`, `filterForRole`) — đúng ý "hàng chờ
  chung để ai cũng chọn được".
- Route `POST /orders/chuyen-trang-thai-hang-loat` (đã có từ trước) NHẬN sẵn `sttKeys` + `trangThaiMoi`,
  đọc THẬT (fresh) từng đơn ngay trước khi ghi, và gọi `orderService.update()` — hàm này:
  - tự chặn chuyển sang "Đang chạy máy" nếu phôi/file chưa xong (`kiemTraTinhHopLy`) — không thể lỡ
    tay nhảy cóc bỏ qua bước phôi/vẽ file dù route không kiểm tra riêng trạng thái TỪ đâu chuyển tới;
  - tự STAMP `NGUOI_CHAY_MAY = người đang thao tác` đúng ngay khi chuyển sang "Đang chạy máy" từ 1
    trạng thái khác (hook có sẵn từ tính năng NGUOI_CHAY_MAY, xem
    docs/superpowers/specs/2026-09-07-nguoi-chay-may-design.md) — áp dụng cho CẢ admin lẫn san_xuat
    (đúng ý: bấm bằng tài khoản nào thì NGUOI_CHAY_MAY ghi tên tài khoản đó, giống hệt ý nghĩa "Đơn
    CỦA TÔI").
  - **Kết luận: không cần route mới, không cần sửa `orderService.js`** — chỉ cần gọi lại route có sẵn
    từ giao diện mới.
- `public/js/api.js` đã có sẵn `chayHangLoatCoTienDo()` + `taoThanhTienDo()` — cơ chế gọi tuần tự
  từng đơn kèm thanh tiến độ + cho hủy giữa chừng, đang dùng ở `orders.html` cho đúng route này — tái
  dùng y hệt, không viết lại.

## Vì sao thêm 1 SECTION riêng (không tái dùng ô lọc "Trạng thái" vừa khoá)

Tính năng lọc/sắp xếp vừa thêm (xem 2026-09-08-loc-sap-xep-don-cua-toi-design.md) CHỦ Ý khoá phần
danh sách hiện tại vào đúng "Đang chạy máy" theo lựa chọn của người dùng. Yêu cầu lần này cần hiện
thêm đơn "ĐÃ SẴN SÀNG CHẠY MÁY" để chọn — đổi ô lọc đó thành bộ chuyển-đổi 2 trạng thái sẽ làm người
dùng dễ quên đang xem "hàng chờ nhận" hay "việc đang làm". Chọn phương án rõ ràng hơn: thêm 1 mục
riêng, độc lập, luôn hiện đồng thời với mục "Đang chạy máy của tôi" hiện có:

1. **"Đơn sẵn sàng chạy máy"** (mới) — danh sách toàn bộ đơn "ĐÃ SẴN SÀNG CHẠY MÁY" (không lọc/sắp
   xếp riêng, không cần vì đây là hàng chờ để nhận việc, không phải nơi theo dõi lâu dài) — có
   checkbox từng đơn + "Chọn tất cả" + nút "Chuyển các đơn đã chọn từ ĐÃ SẴN SÀNG CHẠY MÁY sang Đang
   chạy máy" (chỉ hiện khi đã chọn ≥1 đơn, giống thanh hành động ở orders.html).
2. **"Đơn đang chạy máy của tôi"** (đã có, KHÔNG đổi) — nguyên trạng phần lọc/sắp xếp vừa thêm.

Sau khi chuyển thành công, tải lại CẢ 2 danh sách (đơn vừa chuyển biến mất khỏi mục 1, xuất hiện ở
mục 2 nếu người vừa bấm nhìn thấy được đơn đó ở "Đang chạy máy của tôi").

## Rủi ro tranh chấp (2 người cùng chọn 1 đơn) — chấp nhận như hiện trạng

`update()` đọc thật ngay trước khi ghi nên KHÔNG bao giờ ghi đè nhầm NGUOI_CHAY_MAY của người đã
nhận trước (điều kiện stamp yêu cầu trạng thái NGAY TRƯỚC LÚC GHI khác "Đang chạy máy"). Nhưng nếu 2
người cùng bấm gần như đồng thời, người bấm SAU vẫn nhận phản hồi "thành công" dù NGUOI_CHAY_MAY thực
tế vẫn là người bấm trước — cùng cách hàng loạt hiện có (`/chuyen-trang-thai-hang-loat`) đã hoạt động
với các trạng thái khác từ trước, không phải rủi ro mới do tính năng này gây ra, không xử lý thêm.
