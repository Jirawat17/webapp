# Trung tâm hành động (Action Control Center) cho admin

## 1. Mục tiêu

Theo yêu cầu người dùng: 1 trang admin đăng nhập vào là thấy NGAY danh sách các hành động quan trọng
cần xử lý, thay vì phải tự đi tìm (vào Đơn hàng lọc tay, hoặc soi số liệu thống kê ở Bảng điều khiển
mà không biết CỤ THỂ đơn nào). Khác BĐK (Bảng điều khiển — thống kê/biểu đồ tổng quan), trang này là
danh sách HÀNH ĐỘNG, mỗi dòng bấm vào là nhảy thẳng tới đơn/màn hình liên quan để xử lý.

## 2. Rà soát trước khi thiết kế

Đã rà: 3/4 loại mục tái dùng HOÀN TOÀN dữ liệu/hàm đã có, không cần thêm dữ liệu mới:

| Loại | Nguồn | Ghi chú |
|---|---|---|
| Đơn cảnh báo trễ hạn (Vàng/Cam/Đỏ) | `alertService.tinhMucCanhBao(don)` (đã dùng ở `canhBaoJob.js`) | Tính trực tiếp trên `orderService.getAll()`, không cần bảng làm giàu riêng |
| Đơn ưu tiên chưa xử lý | `orderService.laUuTien(row)` (tính năng Đơn ưu tiên, 8b68490) | Khái niệm "chưa xử lý" chưa có sẵn — tự định nghĩa (xem mục 3) |
| Đơn mới HỦY trong 12h | `logService.layLichSuChuyenSangTrangThai('CANCELLED_Đã hủy')` — hàm ĐÃ CÓ, ĐÃ export nhưng CHƯA từng được gọi ở đâu trong code | Chỉ cần lọc lại theo `thoiGian` |
| Lỗi tự động mua tracking GKE | Tab Sheet `LogsTracking` (`trackingAutoService.js`) | **CHƯA có hàm đọc lại tab này** (tự ghi chú "Không có consumer nào đọc lại") — cần viết mới. Phụ thuộc người dùng đã tạo tab này trong Sheet thật; nếu chưa tạo, mục này luôn trống (không lỗi, không chặn 3 mục còn lại) |

## 3. Định nghĩa tự chốt (đã trao đổi với người dùng ở bước brainstorm)

- **"Đơn ưu tiên chưa xử lý"** = `laUuTien(don) === true` VÀ đơn CHƯA ở trạng thái thuộc
  `TRANG_THAI_KET_THUC` hoặc `TRANG_THAI_DA_SHIP` (2 hằng số đã có ở `data/pipelineTinhTrang.js`,
  cùng cách `alertService` đang dùng để biết "đơn đã xong việc, không cần cảnh báo nữa").
- **Cửa sổ thời gian**: "mới hủy" = trong 12 giờ gần đây (người dùng chỉ định rõ). "Lỗi tracking GKE
  gần đây" = trong 24 giờ gần đây (KHÔNG được người dùng chỉ định — tự chọn gấp đôi mốc 12h vì đây là
  lỗi hệ thống cần xử lý trong ngày, không cấp bách bằng 1 đơn vừa bị huỷ; dễ chỉnh nếu cần).
- **Không có trạng thái "đã xem/đã xử lý"** ở bản đầu tiên — danh sách luôn phản ánh đúng dữ liệu SỐNG
  hiện tại; đơn hết cảnh báo/được ship thì tự biến mất khỏi danh sách, không cần thao tác "đánh dấu đã
  đọc" riêng. Đơn giản hoá tối đa cho bản đầu tiên — bổ sung sau nếu thực tế dùng thấy thiếu.

## 4. Thiết kế backend

### `services/actionCenterService.js` (MỚI)

Hàm chính `layTrungTamHanhDong()` — gọi song song 2 nguồn cần đọc riêng (lịch sử HỦY, log lỗi
tracking) cùng lúc với đọc danh sách đơn, trả về đúng 4 nhóm:

```js
{
  huyGanDay: [{ sttKey, nguoiDung, thoiGian }],                         // mới nhất trước
  canhBao: { DO: [...], CAM: [...], VANG: [...] },                       // mỗi phần tử {sttKey, trangThai, soNgay}, soNgay giảm dần
  uuTienChuaXuLy: [{ sttKey, trangThai }],
  loiTrackingGke: [{ sttKey, thoiGian, chiTiet }],                       // mới nhất trước
}
```

Đọc `LogsTracking` bọc try/catch riêng — lỗi đọc (tab chưa tạo, mạng lỗi) trả mảng rỗng, KHÔNG throw,
KHÔNG làm hỏng 3 mục còn lại (cùng triết lý phòng thủ đã dùng khi GHI tab này ở `trackingAutoService.js`).

### `routes/actionCenter.js` (MỚI)

`GET /danh-sach` — CHỈ admin (`requireRole()` không tham số — theo đúng logic middleware hiện có,
admin luôn qua, vai trò khác không nằm trong danh sách rỗng nên luôn bị chặn 403). Gọi
`layTrungTamHanhDong()`, trả JSON. Đăng ký ở `server.js`: `app.use('/api/trung-tam-hanh-dong', ...)`.

## 5. Thiết kế frontend

### `public/trung-tam-hanh-dong.html` (MỚI)

Trang nhẹ, KHÔNG kèm chart/canvas nào (khác hẳn BĐK) — tải nhanh vì là trang đầu tiên admin thấy sau
đăng nhập. Theo đúng Chế độ Sáng/Tối bình thường của trang (khác BĐK cố tình luôn tối kiểu HUD).

4 khối theo thứ tự ưu tiên: Cảnh báo trễ hạn → Đơn ưu tiên chưa xử lý → Mới hủy (12h) → Lỗi tracking
GKE (24h). Mỗi khối: tiêu đề kèm số đếm, rỗng thì hiện "Không có gì cần xử lý — tốt!", có dữ liệu thì
liệt kê từng dòng bấm vào nhảy thẳng `/order.html?stt=<sttKey>` (riêng lỗi tracking GKE thêm link phụ
sang `/tracking.html`). Khối cảnh báo trễ hạn dùng LẠI nguyên class `.badge-canh-bao.vang/cam/do` đã
có sẵn trong `style.css` (cùng ngôn ngữ hình ảnh với badge cảnh báo ở thẻ đơn hàng, kể cả hiệu ứng
nhấp nháy ở mức Đỏ) — không viết CSS màu sắc mới. Có link sang BĐK để xem thống kê sâu hơn.

### Điều hướng

- `public/js/api.js#trangChuTheoVaiTro('admin')` → `/trung-tam-hanh-dong.html` (trang chính mới sau
  đăng nhập, THAY `/orders.html` — CHỈ đổi cho admin, các vai trò khác không đụng tới vì đang match
  nhánh riêng hoặc rơi vào cùng `return '/orders.html'` mặc định — thêm nhánh admin RIÊNG trước dòng
  mặc định, không sửa dòng mặc định đó).
- `renderNav()` nhánh admin: chèn "Cần xử lý" LÊN TRƯỚC "BĐK" (vị trí 0) — đây giờ là màn hình đầu
  tiên nên hợp lý đứng đầu nav. Icon mới `navAlert` (thêm vào `icons.js`, trùng path với icon `alert`
  đã có — theo đúng quy ước các icon `nav*` khác đều là bản trùng tên của icon gốc).

## 6. Không làm (cố ý, cho bản đầu tiên)

- Không thêm trạng thái "đã xem/đã xử lý" riêng từng admin (xem mục 3).
- Không đổi quyền truy cập của các route/endpoint SẴN CÓ (vd `/api/dashboard/thong-ke` hiện không tự
  chặn theo vai trò ở backend, chỉ ẩn ở nav) — ngoài phạm vi yêu cầu lần này, không tự ý sửa.
- Không giới hạn/phân trang dữ liệu đọc từ `LichSuHoatDong`/`LogsTracking` — dùng nguyên
  `readTabCached` như các nơi khác đang dùng, không tối ưu thêm cho tính năng này.

## 7. Đã kiểm tra

(Điền sau khi code + test xong.)
