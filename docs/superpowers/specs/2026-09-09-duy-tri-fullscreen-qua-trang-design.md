# Duy trì toàn màn hình qua điều hướng trang — thiết kế

**Ngày:** 2026-09-09
**Yêu cầu gốc:** Nút toàn màn hình đã hoạt động, nhưng bấm sang 1 menu khác (vd "Đơn hàng") thì hệ
thống tự thoát toàn màn hình — chỉ muốn thoát khi bấm lại đúng nút đó.

## Giới hạn THẬT của trình duyệt — không phải lỗi code

Trạng thái toàn màn hình (`document.fullscreenElement`) gắn liền với ĐÚNG 1 document — khi điều hướng
sang trang khác (app này là multi-page thật, mỗi menu là 1 file .html riêng, KHÔNG phải SPA), trình
duyệt HỦY document cũ và tải document HOÀN TOÀN MỚI, nên tự thoát toàn màn hình là hành vi chuẩn của
mọi trình duyệt, không sửa được ở tầng code trang web.

Khó hơn nữa: `requestFullscreen()` CHỈ được trình duyệt cho phép khi có "user activation" thật (vừa có
thao tác chuột/chạm trực tiếp) — gọi tự động ngay lúc tải trang (không phải trong sự kiện click) rất
có khả năng bị TỪ CHỐI, đây là giới hạn bảo mật cố ý của trình duyệt (chống web tự ý chiếm toàn màn
hình không cho người dùng biết), không phải điều có thể "sửa" bằng code.

**Không chọn hướng chuyển app sang SPA** (chặn link, tự fetch + thay nội dung bằng JS để document
không bao giờ thật sự tải lại) — đây là hướng DUY NHẤT đảm bảo giữ được fullscreen 100%, nhưng là thay
đổi kiến trúc rất lớn (viết lại cách mọi trang khởi tạo, dọn dẹp code cũ khi chuyển trang, rủi ro rò rỉ
listener/timer...) — vượt xa phạm vi "sửa nút toàn màn hình", không làm.

## Hướng đã làm — cố gắng hết sức (best-effort), không hứa hẹn quá mức

Vẫn nạp lại đúng ý người dùng khi trình duyệt cho phép: ghi nhớ Ý ĐỊNH "muốn toàn màn hình" vào
`sessionStorage` (còn tới khi đóng tab), rồi trang MỚI tự thử `requestFullscreen()` lại ngay khi tải —
thành công thì người dùng không nhận ra có gì thay đổi; thất bại thì âm thầm bỏ qua (không có gì để
báo lỗi — người dùng vẫn thấy đúng nút "Toàn màn hình" như bình thường, bấm lại là được).

- `toggleFullscreen()` — bấm vào fullscreen thành công thì ghi `sessionStorage.duyTriToanManHinh = '1'`.
- `ghiNhoTruocKhiDieuHuong(e)` — listener bắt SỰ KIỆN CLICK Ở TẦNG DOCUMENT (capture phase, bắt được
  MỌI link `<a href>` trên trang, không chỉ riêng menu), CHỈ khi đang thật sự fullscreen lúc bấm: giữ
  nguyên cờ sessionStorage (thực ra không đổi gì, chỉ để chắc chắn) + đánh dấu biến
  `_vuaBamLinkKhiFullscreen = true`.
- `capNhatNutFullscreen()` (chạy mỗi khi `fullscreenchange` bắn ra thật) — nếu vừa CHUYỂN sang KHÔNG
  fullscreen và KHÔNG phải do vừa bấm link (`_vuaBamLinkKhiFullscreen` vẫn false — tức do bấm nút này
  hoặc phím Esc) thì mới xoá cờ sessionStorage. Nhờ vậy phân biệt đúng "thoát vì điều hướng" (giữ cờ)
  và "thoát chủ động" (xoá cờ) mà không phụ thuộc thứ tự sự kiện không chắc chắn lúc unload trang.
- `renderNav()` (chạy đầu mỗi trang) — đọc cờ, nếu còn `'1'` và trang hiện chưa fullscreen thì thử
  `requestFullscreen()` ngay; thất bại (`.catch()`) thì xoá cờ luôn — tránh cố gọi lại vô ích (và báo
  lỗi console không cần thiết) ở các trang tiếp theo cho tới khi người dùng chủ động bấm nút lại.

## Đã kiểm tra — mô phỏng đầy đủ cả 2 khả năng của trình duyệt thật

Sandbox này không có trình duyệt thật với thao tác chuột thật để kiểm chứng "trình duyệt có thực sự
cho phép request lại hay không" — nên đã tự mô phỏng CẢ 2 khả năng bằng cách thay `document.
fullscreenElement`/`requestFullscreen()`/`exitFullscreen()` bằng bản giả lập điều khiển được, gọi
thẳng các hàm thật (`toggleFullscreen()`, `ghiNhoTruocKhiDieuHuong()`, `renderNav()`,
`capNhatNutFullscreen()`) qua Browser pane:

- Bấm nút vào fullscreen → cờ + icon đúng.
- Mô phỏng bấm 1 link menu lúc đang fullscreen → cờ giữ nguyên, đánh dấu đúng.
- Mô phỏng trang mới tải lại, trình duyệt CHO PHÉP request lại → tự vào lại fullscreen, icon đúng.
- Mô phỏng trang mới tải lại, trình duyệt TỪ CHỐI (kịch bản THỰC TẾ nhiều khả năng gặp nhất) → thoát êm,
  xoá cờ, icon về đúng "Toàn màn hình", không lỗi console.
- Mô phỏng thoát bằng phím Esc (không qua bấm link) → xoá cờ đúng, không cố vào lại ở trang sau.

**Cần người dùng tự xác nhận sau khi rebuild**: hành vi thật trên trình duyệt thật (đặc biệt là kịch
bản trình duyệt CÓ CHO PHÉP request lại hay không) chỉ có thể biết chắc khi thử tay — nếu trình duyệt
người dùng dùng vẫn từ chối (nhiều khả năng với Chrome/Edge theo đúng chính sách bảo mật chuẩn), trải
nghiệm sẽ là: bấm sang trang khác vẫn thoát toàn màn hình như cũ (không tệ hơn hiện tại), chỉ khác là
không còn cố gắng liên tục vô ích — lúc đó cần bấm lại nút 1 lần cho mỗi trang muốn xem toàn màn hình.
