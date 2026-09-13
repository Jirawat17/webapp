# Trang rà soát "Đơn hàng loạt" (đánh giá độ chính xác gộp nhóm tự động)

## 1. Bối cảnh

Người dùng đang dự tính xây tính năng lớn hơn: admin/ve_file chủ động chọn đơn, xác nhận thành "đơn
hàng loạt" với mã SKU tuần tự `DHLXX` (DHL01, DHL02...), lưu vào tab Sheet mới `DonHangLoat`, và muốn
hệ thống TỰ ĐỘNG ĐỀ XUẤT nhóm ứng viên (dựa trên ảnh PNG giống nhau) để họ chọn nhanh hơn.

Rà soát cho thấy hệ thống **đã có sẵn** phần lõi cho việc "đề xuất tự động" — tính năng "Quét tìm đơn
hàng loạt" (06/09/2026, xem `docs/superpowers/specs/2026-09-06-don-hang-loat-design.md`): perceptual
hash (dHash) ảnh `DUONG_DAN_URL`, gộp nhóm theo khoảng cách Hamming ≤ `NGUONG_HAMMING` (=8), lưu vào cột
`NHOM_HANG_LOAT`. Nhưng ngưỡng này **chưa từng được kiểm chứng bằng dữ liệu thật** kể từ lúc tạo — người
dùng xác nhận chưa tự kiểm tra kết quả quét thực tế lần nào.

**Quyết định**: trước khi thiết kế tiếp hệ thống `DHLXX`/`DonHangLoat` (việc lớn), làm TRƯỚC 1 việc nhỏ,
độc lập: 1 trang web cho phép người dùng **tự mắt xem lại** các nhóm đã gộp (ảnh PNG thật, cỡ lớn, đặt
cạnh nhau) để đánh giá xem thuật toán hiện tại chính xác tới đâu — làm bằng chứng quyết định bước tiếp
theo (giữ nguyên ngưỡng, chỉnh ngưỡng, hay cần thuật toán khác).

## 2. Phạm vi (CHỈ làm việc này, KHÔNG làm hệ thống DHLXX ở lần này)

- Trang MỚI `public/rasoat-hang-loat.html` — chỉ ĐỌC, không sửa gì.
- Liệt kê MỌI nhóm đang có `NHOM_HANG_LOAT` khác rỗng (dữ liệu đã tính sẵn từ lần quét gần nhất — trang
  này KHÔNG tự quét lại).
- Sắp theo **số đơn trong nhóm giảm dần** (nhóm to xem trước).
- Mỗi nhóm 1 khối: mã nhóm + số đơn, rồi ảnh PNG (`DUONG_DAN_URL`, ảnh ĐẦU TIÊN nếu là link thư mục —
  đúng ảnh đã được dùng để tính hash, xem `taiAnhChoDon`) của TỪNG đơn trong nhóm, hiển thị to (160px),
  đặt cạnh nhau, kèm mã đơn/tên sản phẩm. KHÔNG dùng ảnh Mockup (theo yêu cầu rõ của người dùng).
- Bấm vào 1 ảnh mở trang chi tiết đơn đó ở tab mới (kiểm tra nhanh nếu nghi ngờ).
- Quyền xem: admin + ve_file (khớp phạm vi vai trò người dùng nêu cho hệ thống lớn hơn). Lọc theo Xưởng
  như mọi trang khác (`locTheoXuong` — ve_file chỉ thấy nhóm gồm đơn thuộc Xưởng mình, admin thấy hết).
- Thêm 1 nút "RÀ SOÁT ĐƠN HÀNG LOẠT" ở thanh công cụ `public/orders.html` (cạnh nút "QUÉT TÌM ĐƠN HÀNG
  LOẠT" đang ẩn) để vào trang mới — CHỈ hiện cho admin/ve_file, không tự sửa/hiện lại nút quét đang ẩn
  (giữ nguyên quyết định "TẠM ẨN" trước đó của người dùng 07/09/2026).

## 3. KHÔNG làm ở lần này (để dành, tuỳ kết quả đánh giá)

- Không thêm nút "gỡ đơn khỏi nhóm"/"gộp 2 nhóm" hay bất kỳ hành động SỬA nào trên trang này — thuần
  xem để đánh giá.
- Không tự phát hiện đơn bị BỎ SÓT (2 đơn thực sự giống nhau nhưng không được gộp — vì ngưỡng quá chặt
  hoặc hash lỗi thời) — việc này cần so mọi cặp đơn, tốn hơn nhiều so với chỉ hiển thị nhóm ĐÃ có sẵn.
  Nếu sau khi xem thấy nghi ngờ sót, dùng tạm script CLI đã có (`scripts/rasoat-hang-loat.js`, nhận vào
  danh sách mã đơn cụ thể) hoặc bàn thêm bước kế tiếp.
- Không tự động quét lại — nếu dữ liệu `NHOM_HANG_LOAT` đang cũ/trống (nút quét đã bị ẩn từ 07/09), cần
  tự bấm quét lại thủ công (đang ẩn, có thể hiện lại tạm thời qua code nếu cần) trước khi trang này có
  gì để xem.
- Chưa quyết định `NGUONG_HAMMING` có cần đổi hay không — đó là bước SAU KHI xem kết quả trang này.

## 4. Backend — `routes/orders.js`

Route mới `GET /orders/rasoat-hang-loat`, đặt sau `POST /quet-hang-loat/huy/:jobId`:

```js
router.get('/rasoat-hang-loat', async (req, res) => {
  const user = req.session.user;
  if (user.vaiTro !== 'admin' && user.vaiTro !== 've_file') {
    return res.status(403).json({ error: 'Chỉ admin/người vẽ file mới được rà soát đơn hàng loạt' });
  }

  const { rows } = await orderService.getAll();
  const daLoc = orderService.locTheoXuong(rows, user);

  const theoNhom = new Map();
  for (const r of daLoc) {
    if (!r.NHOM_HANG_LOAT) continue;
    if (!theoNhom.has(r.NHOM_HANG_LOAT)) theoNhom.set(r.NHOM_HANG_LOAT, []);
    theoNhom.get(r.NHOM_HANG_LOAT).push({
      STT_Key: r.STT_Key,
      TieuDeSanPham: orderService.tieuDeSanPham(r),
      DUONG_DAN_URL: r.DUONG_DAN_URL || '',
    });
  }

  const nhoms = [...theoNhom.entries()]
    .map(([maNhom, donHang]) => ({ maNhom, donHang }))
    .sort((a, b) => b.donHang.length - a.donHang.length);

  res.json({ nhoms });
});
```

Dùng `getAll()` (đọc qua cache, đúng quy ước "màn hình XEM" — không cần fresh). `locTheoXuong` là hàm
CÓ SẴN (`services/orderService.js`), tái sử dụng nguyên logic phân quyền Xưởng đã dùng khắp nơi khác.

## 5. Frontend — `public/rasoat-hang-loat.html` (trang mới)

Cấu trúc tối giản: `renderNav(user, 'orders')` (không thêm mục menu riêng, tránh làm dày thêm thanh
điều hướng vốn đã khá nhiều mục — trang này là công cụ chẩn đoán phụ, không phải màn hình dùng hằng
ngày), chặn quyền theo đúng khuôn `public/users.html` (`user.vaiTro !== 'admin' && !== 've_file'` →
thay `.page` bằng thông báo "Bạn không có quyền truy cập trang này."), rồi gọi
`GET /orders/rasoat-hang-loat`, render từng nhóm với ảnh qua `urlAnhHienThiList(don.DUONG_DAN_URL)[0]`
(chỉ lấy ảnh ĐẦU TIÊN — đúng ảnh được dùng để tính hash, không cần cả 2 ảnh như thẻ đơn hàng loạt kiểu
"nhiều ảnh trong 1 thư mục" ở trang Đơn hàng).

CSS mới (`public/css/style.css`): `.khoi-nhom-hang-loat`, `.luoi-anh-nhom` (flex-wrap), `.the-anh-nhom`
(khối 160×160, bo góc, viền, đổi màu viền khi hover — link mở trang chi tiết đơn ở tab mới).

## 6. Điểm vào — `public/orders.html`

Thêm nút "RÀ SOÁT ĐƠN HÀNG LOẠT" (`onclick="location.href='/rasoat-hang-loat.html'"`) trong khối JS
hiện có `if (user.vaiTro === 'admin' || user.vaiTro === 've_file') { ... }` (khối đang bật nút lọc
Xưởng/Ưu tiên) — hiện `style.display=''` cho nút này, KHÔNG đụng gì tới `btn-quet-hang-loat` đang ẩn.

## 7. Kiểm thử

- `GET /orders/rasoat-hang-loat` (module thật): admin/ve_file xem được, san_xuat/nguoi_lay_phoi bị 403;
  nhóm sắp đúng theo số đơn giảm dần; đơn không có `NHOM_HANG_LOAT` không xuất hiện; ve_file chỉ thấy
  nhóm/đơn thuộc Xưởng mình (đơn khác Xưởng trong CÙNG 1 nhóm logic bị loại khỏi kết quả trả về của họ
  — do `locTheoXuong` lọc TRƯỚC khi gom nhóm).
- Trình duyệt thật (mock dựng từ đúng code trang mới, không gõ lại): danh sách nhóm hiển thị đúng ảnh,
  đúng thứ tự, bấm vào ảnh mở đúng link chi tiết đơn.
