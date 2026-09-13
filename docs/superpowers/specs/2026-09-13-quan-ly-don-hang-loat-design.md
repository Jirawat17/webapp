# Quản lý "Đơn hàng loạt" (DHLXX) — xác nhận, sửa, ngưỡng cấu hình, menu riêng, lọc

## 1. Bối cảnh

Đã có sẵn (xem `docs/superpowers/specs/2026-09-06-don-hang-loat-design.md` và
`docs/superpowers/specs/2026-09-13-rasoat-hang-loat-review-design.md`):

- Tự động đề xuất nhóm đơn giống thiết kế (perceptual hash ảnh mẫu, cột `NHOM_HANG_LOAT` trên
  `Don_Hang_ALL`, ngưỡng `NGUONG_HAMMING` hard-code = 8).
- Trang `rasoat-hang-loat.html` — chỉ xem, đánh giá độ chính xác đề xuất.

Người dùng đã tự đánh giá: **độ chính xác khá tốt**. Bước tiếp theo — hệ thống chính thức
"Đơn hàng loạt" (đã dự tính từ đầu, xem mục Bối cảnh của spec 13/09 review): admin/ve_file chọn đơn,
xác nhận thành lô có mã `DHLXX` riêng, quản lý (thêm/xoá đơn, đổi tên) độc lập với phần tự động đề
xuất, cộng thêm ngưỡng có thể tự chỉnh và 1 bộ lọc riêng ở Danh sách đơn hàng.

Đã hỏi và chốt 2 điểm rẽ nhánh quan trọng với người dùng:

1. **Ngưỡng**: chỉ **1 giá trị** dùng để so khớp (thay `NGUONG_HAMMING` hard-code) — "giới hạn
   dưới/trên" chỉ là **khoảng cho phép nhập** (chặn số phi lý), không phải 2 ngưỡng riêng.
2. **Quan hệ dữ liệu**: nhóm tự động đề xuất (`NHOM_HANG_LOAT`) và "Đơn hàng loạt" đã xác nhận
   (`DHLXX`) **tách biệt hoàn toàn** — quét lại bao nhiêu lần cũng không đụng tới nhóm đã xác nhận.

## 2. Dữ liệu — 2 tab Sheet mới (người dùng tự tạo trước khi dùng, đúng quy ước hiện có)

### 2.1. `DonHangLoat` — 1 dòng = 1 đơn thuộc 1 nhóm (phẳng, giống triết lý `Don_Hang_ALL`)

Cột: `MaDonHangLoat` (DHL01, DHL02…) · `TenNhom` · `STT_Key` · `NgayXacNhan` · `NguoiXacNhan` ·
`DaXoa` (`TRUE`/`FALSE`, đúng quy ước `DON_UU_TIEN`/`KichHoat` đang dùng).

**Vì sao có cột `DaXoa` thay vì xoá dòng thật**: rà soát `services/sheetsService.js` xác nhận hệ
thống **chưa có sẵn hàm xoá dòng Sheet nào** (chỉ có `appendRow`/`updateCells`) — mọi tính năng khác
trong app đều theo triết lý "không xoá thật, chỉ đổi trạng thái" (đơn CANCELLED/REFUNDED thay vì xoá
đơn). "Xoá đơn khỏi nhóm"/"xoá cả nhóm" = set `DaXoa = TRUE` cho (các) dòng liên quan, mọi chỗ ĐỌC
đều lọc bỏ `DaXoa = TRUE`. Muốn dọn hẳn dòng rác thì tự xoá tay trong Sheet — không khác gì cách vận
hành các cột trạng thái khác hiện có.

Mã `DHLXX` sinh tự động: quét toàn bộ `MaDonHangLoat` hiện có (kể cả dòng đã `DaXoa`, để không cấp
trùng số), lấy số lớn nhất + 1, đệm 2 chữ số (tự nới 3 chữ số khi vượt 99).

**Ràng buộc Xưởng**: mọi đơn trong cùng 1 `MaDonHangLoat` phải cùng `XUONG` — 1 lô sản xuất là 1
xưởng vật lý. Xác nhận/thêm đơn khác Xưởng với các đơn đã có trong nhóm → báo lỗi, không cho.
ve_file chỉ xem/thao tác được nhóm có đơn thuộc Xưởng mình (dùng lại `locTheoXuong`), admin xem hết.

### 2.2. `CaiDatHangLoat` — cấu hình ngưỡng, đúng khuôn mẫu `CauHinhTracking` đã có

Cột: `NGUONG_HAMMING` — đúng 1 dòng dữ liệu. Đọc/ghi theo đúng mẫu
`services/trackingAutoService.js#layCauHinh/luuCauHinh` đã chứng minh hoạt động tốt: đọc lỗi (chưa
tạo tab) → coi như dùng giá trị mặc định (8), KHÔNG chặn tính năng quét; ghi mà tab chưa tồn tại →
báo lỗi rõ ràng yêu cầu tạo tab trước.

Giới hạn nhập khi lưu: số nguyên **0–32** (hash 64-bit; > 32 gần như gộp mọi thứ, không còn ý nghĩa
lọc — chặn phi lý, không phải công thức thống kê).

## 3. Backend

### 3.1. `services/donHangLoatService.js` (mới)

- `layNguong()` / `datNguong(nguong)` — theo mẫu 2.2.
- `layDanhSachNhom(user)` — đọc `DonHangLoat`, lọc `DaXoa != TRUE`, lọc Xưởng qua danh sách đơn thật
  (join `orderService.getManyByKeys`), gom theo `MaDonHangLoat`, trả về kèm thông tin hiển thị mỗi
  đơn (`STT_Key`, `TieuDeSanPham`, `DUONG_DAN_URL`, `XUONG`).
- `xacNhanNhomMoi({ sttKeys, tenNhom }, user)` — validate ≥1 đơn, mọi đơn tồn tại + cùng Xưởng (và
  đúng quyền Xưởng của người gọi) → sinh mã mới → `appendRow` từng dòng.
- `themDonVaoNhom(maDonHangLoat, sttKey, user)` — validate đơn tồn tại, cùng Xưởng với nhóm, chưa là
  thành viên đang hoạt động của nhóm này → `appendRow`.
- `xoaDonKhoiNhom(maDonHangLoat, sttKey, user)` — `updateCells` dòng khớp `MaDonHangLoat + STT_Key`
  đang hoạt động → `DaXoa = TRUE`.
- `doiTenNhom(maDonHangLoat, tenMoi, user)` — `updateCells TenNhom` cho mọi dòng đang hoạt động cùng
  mã.
- `xoaNhom(maDonHangLoat, user)` — `updateCells DaXoa = TRUE` cho mọi dòng đang hoạt động cùng mã.
- Mọi hàm ghi đều gọi `ghiLog` (hành động `XAC_NHAN_HANG_LOAT`/`THEM_DON_HANG_LOAT`/
  `XOA_DON_HANG_LOAT`/`DOI_TEN_HANG_LOAT`/`XOA_NHOM_HANG_LOAT`/`DOI_NGUONG_HANG_LOAT`), đúng quy ước
  ghi log của mọi thao tác ghi khác trong app.

### 3.2. `routes/donHangLoat.js` (mới) — mount `/api/don-hang-loat` trong `server.js`

`router.use(requireLogin)` rồi chặn `admin`/`ve_file` ở đầu router (áp dụng chung cho MỌI route bên
dưới bằng 1 middleware nội bộ, thay vì lặp lại kiểm tra ở từng route — toàn bộ tính năng này chỉ dành
2 vai trò này). Thứ tự đăng ký (rút kinh nghiệm từ lỗi route `/rasoat-hang-loat` bị `/:sttKey` nuốt
mất vừa sửa): mọi path có tham số (`:maDonHangLoat`) đặt **sau** các path cố định (`/goi-y`,
`/nguong`) — dù ở đây method/số đoạn khác nhau nên thực ra không va nhau, vẫn giữ thói quen này cho
chắc và dễ đọc.

- `GET /goi-y` — chuyển nguyên logic cũ của `GET /orders/rasoat-hang-loat` sang đây.
- `GET /nguong`, `PUT /nguong` (body `{nguong}`).
- `GET /` — `layDanhSachNhom`.
- `POST /` — `xacNhanNhomMoi` (body `{sttKeys, tenNhom}`).
- `POST /:maDonHangLoat/them-don` (body `{sttKey}`), `DELETE /:maDonHangLoat/don/:sttKey`,
  `PUT /:maDonHangLoat/ten` (body `{tenNhom}`), `DELETE /:maDonHangLoat`.

### 3.3. `routes/orders.js`

- Xoá `GET /rasoat-hang-loat` (chuyển sang 3.2).
- `NGUONG_HAMMING` hard-code → đọc `donHangLoatService.layNguong()` ngay đầu
  `POST /quet-hang-loat/bat-dau` (1 lần/lượt quét, không đọc lại trong vòng lặp so khớp).
- Filter mới `GET /`: query `donHangLoat=<MaDonHangLoat>` — CHỈ đọc tab `DonHangLoat` khi có query
  này (tránh tốn quota Sheets cho mỗi lần tải danh sách đơn bình thường), lọc `list` theo tập
  `STT_Key` thuộc mã đó.

## 4. Frontend

### 4.1. `public/don-hang-loat.html` (thay hẳn `rasoat-hang-loat.html`, xoá file cũ)

- Ô cấu hình ngưỡng (số, 0–32) + nút Lưu.
- Khối "Nhóm hệ thống đề xuất" — tái dùng nguyên phần hiển thị ảnh của trang cũ, thêm nút **"Xác
  nhận thành Đơn hàng loạt"** mỗi nhóm → `prompt()` xin tên → `POST /`.
- Khối "Đơn hàng loạt đã xác nhận" — mỗi nhóm: mã + tên (nút sửa tên → `prompt()` → `PUT .../ten`),
  danh sách đơn kèm nút xoá từng đơn (`DELETE .../don/:sttKey`, có `confirm()`), ô nhập mã + nút
  "Thêm đơn" (`POST .../them-don`), nút "Xoá cả nhóm" (`confirm()` → `DELETE`).
- Nút "Tạo nhóm mới" (ngoài luồng đề xuất) → 2 `prompt()` liên tiếp (tên nhóm, mã đơn đầu tiên) →
  `POST /` với 1 phần tử `sttKeys`.
- Quyền + lọc Xưởng: giữ nguyên khuôn `rasoat-hang-loat.html` cũ.

### 4.2. Menu — `public/js/api.js` `renderNav()`

Thêm mục **"Đơn hàng loạt"** (icon `package`, đã dùng cho nút toolbar cũ) — LUÔN hiện cho admin/
ve_file (không qua nút ẩn/hiện nữa), chèn ngay sau "Đơn hàng" ở cả 2 nhánh (admin trong `else`, ve_file
trong khối `if (user.vaiTro === 've_file')`).

### 4.3. `public/orders.html`

- Bỏ nút "RÀ SOÁT ĐƠN HÀNG LOẠT" + wiring liên quan (trang đích không còn tồn tại riêng, đã có mục
  menu cố định). Giữ nguyên nút "QUÉT TÌM ĐƠN HÀNG LOẠT" (vẫn cần chọn đơn ngay tại danh sách).
- Thêm dropdown lọc **"Đơn hàng loạt"** trong `#panel-loc` — nạp danh sách `{MaDonHangLoat, TenNhom}`
  từ `GET /api/don-hang-loat` lúc tải trang, gửi `?donHangLoat=` khi chọn.

### 4.4. CSS + cache-bust

Mở rộng `.khoi-nhom-hang-loat`/`.luoi-anh-nhom`/`.the-anh-nhom` sẵn có cho phần "đã xác nhận" (thêm
nút nhỏ trong khối). Bump `?v=85` → `?v=86` toàn bộ `public/` (đổi `api.js`/`style.css`).

## 5. Không làm ở lần này

- Không hiện badge "thuộc nhóm nào" trên từng thẻ đơn ở Danh sách đơn hàng — chỉ có bộ lọc.
- Không cho ghép đơn khác Xưởng vào cùng 1 Đơn hàng loạt.
- Không tự động gộp/đối chiếu lại với nhóm đề xuất sau khi đã xác nhận — tách biệt hoàn toàn.
- Không thêm cơ chế xoá dòng Sheet thật — dùng `DaXoa` như mọi cột trạng thái khác trong app.

## 6. Kiểm thử

- `services/donHangLoatService.js`: sinh mã tăng dần đúng (kể cả có dòng đã xoá), validate khác
  Xưởng bị chặn (xác nhận + thêm đơn), xoá/đổi tên chỉ tác động dòng `DaXoa=FALSE`, `layNguong` an
  toàn khi tab chưa tồn tại.
- `routes/donHangLoat.js`: quyền admin/ve_file (403 vai trò khác), dựng Express thật (theo đúng
  phương pháp mới rút ra từ lỗi route `/rasoat-hang-loat` trước) xác nhận không route nào nuốt route
  khác.
- `routes/orders.js`: filter `donHangLoat=` đúng tập đơn, KHÔNG gọi đọc tab `DonHangLoat` khi không
  truyền query này (kiểm bằng đếm số lần gọi mock); quét hàng loạt dùng đúng ngưỡng từ
  `CaiDatHangLoat` thay vì hard-code.
- Hồi quy: chạy lại toàn bộ bộ test liên quan `routes/orders.js` đã có trong session.
