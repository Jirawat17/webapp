# Tách "quét QR xác định đơn" khỏi "chụp ảnh bằng chứng" (Chụp ảnh đã sản xuất/đóng gói)

## Bối cảnh

"Chụp ảnh đã sản xuất"/"Chụp ảnh đóng gói" (`public/scan.html`, mode `photo_san_xuat`/`photo_dong_goi`)
hiện dùng ĐÚNG 1 tấm ảnh cho CẢ 2 việc: vừa là bằng chứng (ảnh sản phẩm) vừa phải TỰ ĐỌC ĐƯỢC mã QR
trong đó (`html5-qrcode.scanFile()`, giải mã ẢNH TĨNH, chỉ 1 lần thử) để biết đơn nào. Người dùng
báo thực tế: tỉ lệ đọc thất bại cao ("không đọc được, chụp lại"), dù quét QR SỐNG (nhiều khung
hình/giây, tự lấy nét) rất nhạy. Đã thống nhất: **tách thành 2 bước** — quét QR sống để xác định đơn
trước, sau đó mới chụp ảnh (ảnh không cần đọc được nữa vì đơn đã biết).

## Luồng mới

```
[Đang quét] --quét QR OK + đơn đủ điều kiện--> [Sẵn sàng chụp] --chụp ảnh--> upload --> [Đang quét] (tự lặp lại)
     |--quét QR nhưng đơn KHÔNG đủ điều kiện/không tìm thấy--> báo lỗi, VẪN Ở [Đang quét]
[Sẵn sàng chụp] --bấm "Quét lại"--> [Đang quét] (không upload gì)
[Sẵn sàng chụp] --chụp ảnh nhưng upload lỗi--> báo lỗi, VẪN Ở [Sẵn sàng chụp] (đơn đã biết, chụp lại ngay không cần quét lại)
```

## Thay đổi

### 1. `routes/photos.js` — endpoint mới `POST /photos/kiem-tra`

Kiểm tra ĐỦ ĐIỀU KIỆN chụp ảnh cho 1 đơn (KHÔNG cần file ảnh) — dùng ngay sau khi quét QR, TRƯỚC khi
mở camera chụp, để tránh lãng phí 1 lần chụp cho đơn không hợp lệ. Tách riêng khỏi `GET
/orders/:sttKey` (route đó có áp thêm 1 lớp ẩn đơn "Đang chạy máy" của người san_xuat KHÁC —
`locDonDangChayMayTheoNguoiVanHanh` — không áp dụng cho tính năng chụp ảnh này, vốn mở cho CẢ 4 vai
trò không phân biệt ai đang vận hành máy). Dùng lại ĐÚNG logic kiểm tra đã có ở `POST /upload` (dòng
50-64), chỉ bỏ phần upload file thật:

```js
router.post('/kiem-tra', async (req, res) => {
  const { sttKey, moc } = req.body;
  const cotAnh = COT_ANH_THEO_MOC[moc];
  if (!cotAnh) return res.status(400).json({ error: 'Mốc ảnh không hợp lệ: ' + moc });

  const { headers, row } = await orderService.getByKey(sttKey, { fresh: true });
  if (!row) return res.status(404).json({ error: 'Không tìm thấy đơn hàng: ' + sttKey });
  if (!headers.includes(cotAnh)) {
    return res.status(400).json({ error: `Sheet chưa có cột '${cotAnh}'...` });
  }
  const chuyenTuDong = MOC_TU_DONG_CHUYEN_TRANG_THAI[moc];
  if (chuyenTuDong && row.TRANG_THAI_XUONG !== chuyenTuDong.yeuCau) {
    return res.status(400).json({ error: `Đơn "${sttKey}" đang ở trạng thái "${row.TRANG_THAI_XUONG}"...` });
  }

  res.json({ tieuDe: orderService.tieuDeSanPham(row), tenKhachHang: (await orderService.ganTenKhachHang([row]))[0].TenKhachHang });
});
```

`POST /upload` GIỮ NGUYÊN 100% (vẫn tự kiểm tra lại đầy đủ, phòng vệ 2 lớp — đơn có thể đổi trạng
thái giữa lúc kiểm tra và lúc chụp/tải ảnh xong).

### 2. `public/scan.html` — 2 trạng thái con cho mode `photo_san_xuat`/`photo_dong_goi`

Biến mới `donDaXacDinhChoAnh` (null = đang ở trạng thái "Đang quét"; có giá trị `{sttKey, tieuDe,
tenKhachHang}` = đang ở trạng thái "Sẵn sàng chụp"). Reset về `null` mỗi khi ĐỔI SANG mode này hoặc
đổi giữa 2 tab con (San xuất ↔ Đóng gói) — không giữ trạng thái cũ sang ngữ cảnh khác.

**Trạng thái "Đang quét"**: hiện lại khối camera SỐNG (giống hệt UI "Quét kịch bản" — `camera-wrap`,
dùng CHUNG `dieuChinhCamera()`/`batDauCamera()` đã có, thêm 1 nhánh `cameraCanChay = 'photo_scan'` →
`batDauCamera(xuLyQuetDeXacDinhDon)`), có dòng mô tả "Quét mã QR để xác định đơn cần [chụp ảnh đã sản
xuất/đóng gói]". Quét được mã → gọi `POST /photos/kiem-tra`:
  - Hợp lệ → lưu vào `donDaXacDinhChoAnh`, dừng camera, chuyển sang trạng thái "Sẵn sàng chụp"
    (`capNhatManHinh()`), phát âm OK.
  - Không hợp lệ/không tìm thấy → `hienThiToastAnh('loi', ...)` + phát âm lỗi, **VẪN Ở trạng thái
    "Đang quét"** (camera tiếp tục chạy, không cần thao tác gì thêm để thử mã khác).

**Trạng thái "Sẵn sàng chụp"**: hiện tên đơn + khách hàng đã xác định (to, rõ — giống khối "Kết quả
vừa quét" đã làm cho Quét kịch bản), nút "Chụp ảnh" (mở camera qua `input-chup-anh` như cũ) + nút phụ
"Quét lại" (quay về trạng thái "Đang quét", không upload gì). Chụp ảnh xong → upload thẳng
`POST /photos/upload` với `sttKey` đã biết sẵn — KHÔNG còn gọi `scannerFile.scanFile()` nữa.
  - Upload OK → reset `donDaXacDinhChoAnh = null`, tự quay lại trạng thái "Đang quét" (camera tự khởi
    động lại) để tiếp tục lô tiếp theo — giữ đúng nhịp "quét → chụp → quét → chụp" liên tục.
  - Upload lỗi (server từ chối/mất mạng) → báo lỗi, **VẪN Ở trạng thái "Sẵn sàng chụp"** (đơn đã biết
    sẵn, cho chụp lại ngay không cần quét lại từ đầu).

### 3. Không đổi

- `POST /photos/upload`, cơ chế lưu MinIO, tự động chuyển trạng thái khi upload — y nguyên.
- Danh sách "Đã chụp" (`renderDsDaChup`, `themDongDaChup`) — vẫn ghi nhận kết quả cuối cùng
  (thành công/lỗi) như cũ, không đổi hiển thị.
- Áp dụng ĐỒNG THỜI cho cả `photo_san_xuat` VÀ `photo_dong_goi` (dùng chung code, chỉ khác
  `CAU_HINH_ANH[mode]`) — cùng gặp đúng vấn đề, cùng cách sửa.
