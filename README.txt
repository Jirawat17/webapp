CẬP NHẬT LỚN: PIPELINE 3 CỘT TRẠNG THÁI + 4 VAI TRÒ (theo Prompt_Ver_24.docx, 24/08/2026)
=============================================================================================

Đây là thay đổi lớn nhất từ đầu dự án — thay thế HOÀN TOÀN mô hình pipeline 1 cột (16 trạng thái
B1.1-B5.2) đã làm trước đó bằng mô hình 3 CỘT trạng thái, và đổi từ 6 vai trò xuống còn 4 vai trò.

QUAN TRỌNG — ĐƯỜNG DẪN TRONG ZIP LÀ GIẢ ĐỊNH, đối chiếu lại với cấu trúc thật của bạn trước khi
copy đè (xem giải thích ở các zip trước — vẫn áp dụng y hệt).

=============================================================================================
0. VIỆC PHẢI LÀM TRÊN GOOGLE SHEET TRƯỚC KHI DEPLOY CODE (bắt buộc, code sẽ lỗi nếu thiếu)
=============================================================================================

0.1. Tab Don_Hang_ALL — THÊM 2 CỘT MỚI:
     - TRANG_THAI_PHOI      (giá trị: "Chưa lấy phôi" hoặc "Đã lấy phôi")
     - TRANG_THAI_VE_FILE   (giá trị: "Chưa vẽ file" hoặc "Đã vẽ file")
     Chạy scripts/migrate-trang-thai-v2.js sau khi thêm cột để tự điền dữ liệu cho đơn cũ (mục 4).

0.2. Tab NguoiDung — SỬA LẠI CỘT VaiTro CHO TỪNG NHÂN VIÊN:
     - Ai đang là "quan_ly"        -> đổi thành "admin"
     - Ai đang là "chuan_bi_phoi"  -> đổi thành "nguoi_lay_phoi"
     - Ai đang là "dong_goi"       -> đổi thành "nguoi_lay_phoi"
     - "admin", "ve_file", "san_xuat" giữ nguyên tên, không đổi.
     (users.html trong zip đã sửa dropdown Thêm nhân viên theo đúng 4 vai trò mới, nhưng nhân viên
     ĐÃ CÓ SẴN trong Sheet từ trước thì phải tự sửa tay dòng VaiTro tương ứng, code không tự đổi
     được vì không biết dịch "quan_ly cũ" thành "admin" hay giữ nguyên là quyết định của bạn.)

0.3. Tab CauHinhKichBan — THÊM 2 CỘT MỚI + SỬA LẠI TOÀN BỘ CÁC DÒNG:
     - Cot             — TÊN CỘT mà dòng kịch bản đó thao tác: TINH_TRANG / TRANG_THAI_PHOI /
                          TRANG_THAI_VE_FILE. Để trống thì mặc định TINH_TRANG.
     - Nguoi_Thuc_Hien  — danh sách vai trò được dùng, phân cách dấu phẩy (vd "nguoi_lay_phoi, ve_file").
                          Để trống = mở cho mọi vai trò. admin LUÔN được dùng mọi kịch bản bất kể cột
                          này ghi gì (admin là superuser).

     Xoá hết các dòng kịch bản CŨ (dùng tên trạng thái B1.1-B5.2), thay bằng đúng 3 dòng theo
     Prompt_Ver_24.docx:

     Ten_Kich_Ban                                          | Cot                | Trang_Thai_Yeu_Cau | Trang_Thai_Sau      | Nguoi_Thuc_Hien
     -------------------------------------------------------|--------------------|--------------------|--------------------|-----------------------
     Quét mã để chuyển từ CHƯA LẤY PHÔI sang ĐÃ LẤY PHÔI    | TRANG_THAI_PHOI    | Chưa lấy phôi      | Đã lấy phôi         | nguoi_lay_phoi, ve_file
     Quét mã để chuyển từ ĐÃ SẴN SÀNG CHẠY MÁY sang ĐÃ SẢN XUẤT | TINH_TRANG     | ĐÃ SẴN SÀNG CHẠY MÁY | Đã sản xuất       | san_xuat
     Quét mã để chuyển từ ĐÃ SẢN XUẤT sang ĐÃ ĐÓNG GÓI      | TINH_TRANG         | Đã sản xuất        | Đã đóng gói         | nguoi_lay_phoi

     LƯU Ý QUAN TRỌNG — các việc KHÔNG có kịch bản quét QR (set tay, đã xác nhận với bạn):
     - "Chưa xác nhận" -> "Đã xác nhận": set tay (ve_file hoặc admin).
     - "Chưa vẽ file" -> "Đã vẽ file": set tay (ve_file), KHÔNG qua quét QR.
     - Vào/ra khỏi "LỖI SẢN XUẤT CẦN LÀM LẠI": set tay (san_xuat hoặc admin) — cả lúc set lỗi lẫn
       lúc làm lại đều set tay, KHÔNG tự động, KHÔNG qua kịch bản quét QR.
     Những việc set tay này giờ làm được qua khối "Sửa trạng thái thủ công" mới ở trang chi tiết
     đơn (order.html) — xem mục 3.4.

0.4. NGUỒN TẠO ĐƠN MỚI (Apps Script/kênh bán hàng) — sửa giá trị mặc định khi tạo 1 đơn mới:
     - TINH_TRANG = "Chưa xác nhận"
     - TRANG_THAI_PHOI = "Chưa lấy phôi"
     - TRANG_THAI_VE_FILE = "Chưa vẽ file"
     (Nằm ngoài phạm vi code Node trong zip này — không sửa được từ đây, bạn cần tự cập nhật Apps
     Script tạo đơn.)

=============================================================================================
1. MÔ HÌNH PIPELINE MỚI — 3 CỘT TRẠNG THÁI, KHÔNG CÒN TUYẾN TÍNH B1-B5
=============================================================================================

Lấy phôi và vẽ file giờ là 2 việc ĐỘC LẬP, làm SONG SONG (không bắt buộc phải có phôi trước mới vẽ
file như bản cũ). Mỗi việc có 1 cột trạng thái riêng:

  TINH_TRANG (tiến trình chung — 10 giá trị theo đúng thứ tự):
    Chưa xác nhận -> Đã xác nhận -> ĐÃ SẴN SÀNG CHẠY MÁY -> Đã sản xuất -> Đã đóng gói ->
    IN TRANSIT_Tracking đã hoạt động -> DELIVERED_Đã giao đến khách
    (nhánh rẽ, không nằm trên đường chính: LỖI SẢN XUẤT CẦN LÀM LẠI, CANCELLED_Đã hủy, REFUNDED_Hoàn đơn)

  TRANG_THAI_PHOI: "Chưa lấy phôi" | "Đã lấy phôi"
  TRANG_THAI_VE_FILE: "Chưa vẽ file" | "Đã vẽ file"

"ĐÃ SẴN SÀNG CHẠY MÁY" LÀ TRẠNG THÁI TỰ ĐỘNG: hệ thống tự đặt TINH_TRANG sang giá trị này ngay khi
TRANG_THAI_PHOI="Đã lấy phôi" VÀ TRANG_THAI_VE_FILE="Đã vẽ file" CÙNG LÚC — NHƯNG CHỈ áp dụng khi
TINH_TRANG đang là "Đã xác nhận" (lần đầu). Sau khi lỗi rồi làm lại từ phôi/file, việc quay lại
"ĐÃ SẴN SÀNG CHẠY MÁY" lần 2 KHÔNG tự động — phải set tay (đã xác nhận rõ với bạn). Logic này nằm
trong services/orderService.js, hàm update() — áp dụng cho MỌI đường ghi dữ liệu (quét QR, sửa tay,
chuyển hàng loạt) vì tất cả đều đi qua hàm này.

=============================================================================================
2. VAI TRÒ — 4 VAI TRÒ (từ 6 vai trò cũ)
=============================================================================================

- admin: toàn quyền — xem mọi đơn, sửa mọi trường, quản lý tài khoản, dùng mọi kịch bản QR bất kể
  Nguoi_Thuc_Hien ghi gì. Đây là quyền DUY NHẤT khác biệt hẳn với các vai trò khác — quản lý tài
  khoản (Thêm/Sửa/Khóa/Hủy khóa) CHỈ admin làm được, không vai trò nào khác được.
- ve_file: xem VÀ sửa được MỌI đơn (giống admin về mặt dữ liệu đơn hàng), xem được (không sửa
  được) trang quản lý người dùng, không quản lý được tài khoản.
- san_xuat: CHỈ thấy đơn từ "ĐÃ SẴN SÀNG CHẠY MÁY" trở đi (gồm cả "LỖI SẢN XUẤT CẦN LÀM LẠI"),
  không thấy đơn còn ở "Chưa xác nhận"/"Đã xác nhận". Không thấy đơn CANCELLED/REFUNDED (giữ đúng
  thói quen cũ — chỉ admin/ve_file thấy đơn huỷ/hoàn, vì quan_ly đã bị xoá). Chỉ sửa được
  GHI_CHU/TINH_TRANG/TRANG_THAI_PHOI/TRANG_THAI_VE_FILE (đủ để tự set lỗi và tự set lại khi làm lại).
- nguoi_lay_phoi: gộp từ chuan_bi_phoi + dong_goi cũ — lo cả lấy phôi lẫn đóng gói. CHỈ NHÌN THẤY
  DUY NHẤT MENU "Quét mã QR" — mọi menu khác (Đơn hàng, Dashboard, Báo cáo, Cài đặt, Trợ lý, Nhân
  viên) đều bị ẨN (đã xác nhận rõ với bạn: ẩn TẤT CẢ). Không có trang danh sách/chi tiết đơn để vào,
  chỉ thao tác qua quét QR.

LƯU Ý VỀ GIỚI HẠN: việc ẩn menu chỉ là giới hạn GIAO DIỆN (frontend) — route backend GET /orders
(danh sách đơn) hiện KHÔNG chặn riêng cho nguoi_lay_phoi, chỉ đơn giản là họ không có đường vào
trang đó qua menu bình thường. Nếu ai đó tự gõ đúng URL /orders.html, trang vẫn tải được (dù không
có trong menu). Nếu muốn khoá cứng luôn ở tầng server, nói thêm để mình bổ sung.

=============================================================================================
3. CHI TIẾT TỪNG FILE ĐÃ SỬA
=============================================================================================

3.1. data/pipelineTinhTrang.js — viết lại HOÀN TOÀN. TINH_TRANG_VALUES/TRANG_THAI_PHOI_VALUES/
TRANG_THAI_VE_FILE_VALUES, THU_TU_TINH_TRANG (dùng để biết "đơn đã qua mốc X hay chưa" — không gồm
LỖI/CANCELLED/REFUNDED vì đó là nhánh rẽ), chiSoTinhTrang() thay cho chuaXongGiaiDoan() cũ.

3.2. services/orderService.js:
   - filterForRole(): san_xuat lọc theo THU_TU_TINH_TRANG (xem mục 2); admin/ve_file xem hết.
   - update(): THÊM MỚI logic tự động "ĐÃ SẴN SÀNG CHẠY MÁY" (xem mục 1) — đã tự mô phỏng 6 tình
     huống bằng Node trước khi giao, bao gồm 2 case dễ sai nhất (không tự động sau khi làm lại từ
     lỗi; không ghi đè khi người dùng tự chỉ định TINH_TRANG).

3.3. services/scenarioService.js: đọc thêm cột Cot (mặc định TINH_TRANG nếu để trống) và
Nguoi_Thuc_Hien (mảng vai trò, null = mở cho mọi vai trò) từ tab CauHinhKichBan.

3.4. routes/qr.js: TOÀN BỘ logic trước đây hardcode so khớp/ghi vào đúng cột TINH_TRANG — giờ dùng
scenario.column (đọc từ Cot) để so khớp VÀ ghi đúng cột kịch bản đó thao tác. Thêm hàm
duocPhepDungKichBan() chặn theo Nguoi_Thuc_Hien (admin luôn được phép). Áp dụng cho cả 2 luồng quét
(đơn lẻ và hàng loạt).

3.5. routes/orders.js:
   - TRUONG_DUOC_SUA: ve_file/admin không giới hạn (sửa hết); san_xuat chỉ sửa được
     GHI_CHU/TINH_TRANG/TRANG_THAI_PHOI/TRANG_THAI_VE_FILE; nguoi_lay_phoi chỉ GHI_CHU (thực tế
     không dùng vì không có trang để sửa tay).
   - layKichBanKeTiep(): SỬA LỖI — trước đây chỉ so khớp với TINH_TRANG bất kể kịch bản thao tác
     cột nào (sẽ không bao giờ hiện đúng nút cho kịch bản thao tác TRANG_THAI_PHOI). Giờ so khớp
     đúng row[scenario.column], và lọc luôn theo Nguoi_Thuc_Hien (admin luôn thấy hết).
   - Danh sách 10 giá trị TINH_TRANG cho nút "Chuyển đến trạng thái" hàng loạt (không đổi được
     TRANG_THAI_PHOI/VE_FILE hàng loạt — sửa qua trang chi tiết đơn hoặc quét QR).

3.6. services/alertService.js: viết lại tinhMucCanhBao() dùng chiSoTinhTrang() thay chuaXongGiaiDoan()
đã xoá. Mốc Vàng = chưa đạt "ĐÃ SẴN SÀNG CHẠY MÁY", mốc Cam = chưa đạt "Đã sản xuất", mốc Đỏ = chưa
ship. Đã tự mô phỏng 15 tình huống, khớp đúng 15/15 (gồm cả case LỖI SẢN XUẤT CẦN LÀM LẠI ở các mốc
ngày khác nhau).

3.7. routes/reports.js:
   - TRANG_THAI_TRACKING = 'Đã đóng gói' (theo tên mới).
   - VẤN ĐỀ PHÁT SINH: 2 mẫu "IN DANH SÁCH PHÔI" và "IN ĐƠN" trước đây suy trạng thái qua TINH_TRANG
     — giờ phôi đã tách thành cột riêng, KHÔNG còn suy được qua TINH_TRANG nữa. Đã sửa: locDon()
     nhận thêm tham số trangThaiPhoi/trangThaiVeFile lọc riêng theo 2 cột mới; xacDinhMau() bỏ hẳn
     khả năng tự suy 2 mẫu này qua TINH_TRANG (chỉ còn ép được qua tham số "mau" — do nút in nhanh
     gửi lên).
   - TRANG_THAI_LOI: thêm bí danh thứ 3 "LỖI SẢN XUẤT CẦN LÀM LẠI" (giờ có ĐỦ 3 tên gọi qua 3 đời
     pipeline: "ĐƠN LỖI CẦN LÀM LẠI" gốc -> "B4.3_ĐƠN LỖI CẦN LÀM LẠI" -> "LỖI SẢN XUẤT CẦN LÀM LẠI"
     — không thì lỗi phát sinh từ giờ trở đi lại bị bỏ sót giống lỗi đã sửa tuần trước).

3.8. public/js/api.js:
   - renderNav(): nguoi_lay_phoi chỉ thấy menu Quét QR; logo header trỏ về /scan.html thay vì
     /orders.html cho vai trò này.
   - NHAN_VAI_TRO: cập nhật đúng 4 vai trò.
   - lopTrangThai(): VIẾT LẠI HẲN bằng bảng tra cứu CHÍNH XÁC (exact-match) thay vì so khớp chuỗi
     con/regex — vì tên trạng thái mới không còn theo khuôn B[1-5].[12]_ nữa, VÀ để tránh lặp lại
     đúng 2 lỗi thật đã gặp trước đây (chuỗi con khớp nhầm, lệch chính tả 1 ký tự).

3.9. public/orders.html: danh sách 10 trạng thái mới cho dropdown; thêm badge phôi/vẽ file trên thẻ
đơn (chỉ hiện khi đơn còn ở "Chưa xác nhận"/"Đã xác nhận" — hết ý nghĩa theo dõi sau khi đã "sẵn
sàng chạy máy"); 2 nút in nhanh "IN DANH SÁCH PHÔI"/"IN ĐƠN" giờ ép lọc theo TRANG_THAI_PHOI thay vì
dùng ô lọc trạng thái chung (ô đó chỉ lọc được TINH_TRANG).

3.10. public/order.html:
   - Thêm badge phôi/vẽ file.
   - THÊM MỚI khối "Sửa trạng thái thủ công" — 3 dropdown riêng cho TINH_TRANG/PHOI/VE_FILE. Đây là
     phần BẮT BUỘC PHẢI CÓ vì việc set "LỖI SẢN XUẤT CẦN LÀM LẠI" và làm lại sau đó đều là set tay,
     không qua kịch bản quét QR nào cả (theo đúng mô tả trong Prompt_Ver_24.docx).
   - Khu vực "Chụp ảnh đóng gói": trước đây hiện cho dong_goi/admin, giờ dong_goi không còn tồn tại
     nên chỉ còn hiện cho admin (nguoi_lay_phoi giờ đảm nhiệm việc đóng gói nhưng không có trang
     này để vào — chỉ thao tác qua quét QR).

3.11. public/users.html: dropdown "Vai trò" khi thêm nhân viên mới cập nhật đúng 4 lựa chọn.

3.12. routes/chatbot.js:
   - MO_TA_PIPELINE (system prompt gửi cho LLM) viết lại hoàn toàn theo mô hình 3 cột mới — trước
     đó vẫn đang mô tả pipeline CŨ (B1.1-B5.2), sẽ khiến chatbot trả lời sai hoàn toàn về ý nghĩa
     trạng thái nếu không sửa.
   - Khôi phục giới hạn "chỉ admin" cho 2 công cụ tra_cuu_nhan_vien/tra_cuu_lich_su_gan_day — ở đợt
     trước mình đã mở 2 công cụ này cho mọi vai trò theo đúng chính sách "mọi vai trò như Admin" lúc
     đó, nhưng chính sách đó ĐÃ BỊ HUỶ theo yêu cầu lần này, nên khôi phục lại giới hạn ban đầu
     (quan_ly đã bị xoá nên giờ chỉ còn đúng "admin", không phải danh sách 2 vai trò như trước).

3.13. scripts/migrate-trang-thai-v2.js (MỚI): script chạy 1 lần, đổi TOÀN BỘ 16 giá trị TINH_TRANG
hệ CŨ sang bộ 3 giá trị (TINH_TRANG, TRANG_THAI_PHOI, TRANG_THAI_VE_FILE) hệ MỚI. Bảng ánh xạ đầy đủ
nằm trong chính file này VÀ trong comment đầu data/pipelineTinhTrang.js. Đã tự mô phỏng, xác nhận cả
16 giá trị mới đều hợp lệ theo đúng danh sách trong pipelineTinhTrang.js.

  ĐIỂM CẦN LƯU Ý RIÊNG (đã xác nhận với bạn):
  - "SHIPPED_Đã gửi vận chuyển" (không còn tồn tại trong hệ mới) -> chuyển thành
    "IN TRANSIT_Tracking đã hoạt động" (coi như đã bắt đầu vận chuyển).
  - "B4.3_ĐƠN LỖI CẦN LÀM LẠI" -> "LỖI SẢN XUẤT CẦN LÀM LẠI" + RESET cả TRANG_THAI_PHOI VÀ
    TRANG_THAI_VE_FILE về "Chưa..." (đúng tinh thần "làm lại từ đầu").
  - "B5.2_Đơn chưa đóng gói" (trạng thái "chưa đóng gói" không còn tồn tại riêng trong hệ mới) ->
    gộp về "Đã sản xuất" (coi như đang chờ đóng gói, giai đoạn trước đó).

CÁCH CHẠY: y hệt script migrate lần 1 — chạy KHÔNG có --apply trước để xem trước, rồi mới --apply.

=============================================================================================
4. THỨ TỰ TRIỂN KHAI
=============================================================================================

1. Thêm 2 cột TRANG_THAI_PHOI/TRANG_THAI_VE_FILE vào Don_Hang_ALL (mục 0.1).
2. Sửa VaiTro cho nhân viên hiện có trong tab NguoiDung (mục 0.2).
3. Sửa tab CauHinhKichBan — thêm cột Cot/Nguoi_Thuc_Hien, thay 3 dòng kịch bản mới (mục 0.3).
4. Copy toàn bộ file trong zip đè vào đúng vị trí.
5. Chạy thử: node scripts/migrate-trang-thai-v2.js (không --apply, xem trước).
6. Chạy thật: node scripts/migrate-trang-thai-v2.js --apply.
7. Sửa Apps Script tạo đơn mới theo mục 0.4.
8. Restart server Node.
9. Kiểm tra lại: mỗi vai trò đăng nhập đúng thấy đúng menu/đơn theo mô tả ở mục 2; thử quét QR đủ
   3 kịch bản; thử set tay trạng thái lỗi rồi làm lại ở trang chi tiết đơn; kiểm tra badge màu đúng
   trên toàn bộ trạng thái mới.

=============================================================================================
5. THÊM 2 DROPDOWN LỌC THEO PHÔI/VẼ FILE (đợt cập nhật này) + XÁC NHẬN Prompt_Ver_25.docx
=============================================================================================

Prompt_Ver_25.docx nội dung GIỐNG HỆT Prompt_Ver_24.docx đã code ở đợt trước (cùng danh sách trạng
thái, cùng 4 vai trò, cùng logic tự động, cùng 3 dòng kịch bản) — không có gì mới, không cần hỏi
thêm câu nào.

Đã thêm 2 dropdown lọc mới ở trang Đơn hàng, đặt ngay cạnh ô lọc trạng thái hiện có:
- "Lọc theo phôi" — Tất cả / Chưa lấy phôi / Đã lấy phôi (lọc theo TRANG_THAI_PHOI)
- "Lọc theo vẽ file" — Tất cả / Chưa vẽ file / Đã vẽ file (lọc theo TRANG_THAI_VE_FILE)

Kết hợp được với mọi bộ lọc khác (trạng thái chung, tìm kiếm, khoảng ngày) theo kiểu AND — chọn
càng nhiều bộ lọc thì kết quả càng thu hẹp, giống hệt cách các bộ lọc cũ hoạt động.

File sửa: routes/orders.js (GET /orders nhận thêm 2 tham số trangThaiPhoi/trangThaiVeFile),
public/orders.html (2 dropdown mới + cập nhật taiDon()/inNhanh() để đưa 2 bộ lọc này vào mọi truy
vấn liên quan, kể cả nút in nhanh "IN DANH SÁCH ĐÃ SẢN XUẤT" khi không bị ép cứng mẫu khác).

=============================================================================================
6. 4 NÚT BẤM NHANH ĐÁNH DẤU PHÔI/VẼ FILE HÀNG LOẠT (đợt cập nhật này)
=============================================================================================

Trước đây muốn đổi TRANG_THAI_PHOI/TRANG_THAI_VE_FILE hàng loạt phải quét QR (nguoi_lay_phoi/
ve_file) hoặc mở từng đơn sửa tay (ve_file/san_xuat/admin) — bất tiện khi ve_file cần xử lý nhiều
đơn cùng lúc ngồi tại bàn (không phải lúc nào cũng thao tác được qua quét QR). Đã thêm 4 nút bấm
nhanh ngay cạnh nút "Áp dụng" (công cụ chuyển trạng thái hàng loạt sẵn có): "Đã lấy phôi", "Chưa
lấy phôi", "Đã vẽ file", "Chưa vẽ file" — dùng chung cơ chế chọn nhiều đơn (tick chọn) đã có, không
cần mở dropdown chọn giá trị vì mỗi nút đã cố định đúng 1 giá trị.

QUYẾT ĐỊNH ĐÃ XÁC NHẬN VỚI BẠN:
- Có cả 2 chiều (đánh dấu "đã xong" LẪN chuyển ngược lại "chưa xong") — phòng trường hợp lỡ đánh
  dấu nhầm hàng loạt.
- san_xuat cũng dùng được (dù không phụ trách phôi/vẽ file theo mô tả vai trò, để linh hoạt hỗ trợ
  khi cần) — thực ra không cần thêm code riêng cho việc này: san_xuat đã có sẵn quyền sửa 2 cột này
  từ đợt trước (phục vụ việc set lại phôi/file khi làm lại sau lỗi), và route bulk-update vốn đã mở
  cho MỌI vai trò vào được trang Đơn hàng — nên tự động bao gồm san_xuat mà không cần sửa gì thêm.
- nguoi_lay_phoi KHÔNG dùng được 4 nút này (không có trang Đơn hàng để vào) — vẫn dùng Quét mã QR
  như trước, đúng thiết kế ban đầu (họ làm việc physically trong xưởng, quét mã tại chỗ hợp lý hơn).

CÁCH LÀM: mở rộng route backend /orders/chuyen-trang-thai-hang-loat SẴN CÓ (không viết route mới)
— thêm tham số "cot" (mặc định TINH_TRANG nếu không truyền, giữ tương thích ngược với nút "Áp dụng"
chuyển TINH_TRANG cũ), validate đúng giá trị theo đúng cột. Tận dụng lại toàn bộ logic đọc thật
trước khi ghi, xử lý lỗi từng đơn, ghi log — không phải viết trùng.

File sửa: routes/orders.js (mở rộng route bulk-update, thêm bảng GIA_TRI_HOP_LE_THEO_COT để
validate theo đúng cột), public/orders.html (4 nút mới + hàm apDungNhanh()), public/css/style.css
(style cho vạch phân tách + 4 nút nhỏ hơn).

=============================================================================================
7. RÀ SOÁT LOGIC — 2 LỖ HỔNG THẬT TÌM ĐƯỢC + ĐỀ XUẤT THÊM
=============================================================================================

FILE THÊM/SỬA MỚI:
- services/orderService.js  -> thêm kiemTraGiaTriHopLe() + kiemTraTinhHopLy(), gọi trong update()
- routes/orders.js           -> bọc try/catch quanh orderService.update() ở route sửa 1 đơn
- routes/qr.js                -> bọc try/catch quanh orderService.update() ở route quét đơn lẻ
- public/order.html           -> cảnh báo trực tiếp trên giao diện TRƯỚC khi lưu (mục 7.3)
- scripts/kiem-tra-tinh-hop-le.js (MỚI) -> rà soát dữ liệu CŨ, chỉ đọc không sửa gì

7.1. LỖ HỔNG 1 (đúng ví dụ bạn nêu) — KHÔNG có gì ngăn tổ hợp vô lý giữa 3 cột trạng thái. Đã thêm
kiemTraTinhHopLy() vào orderService.update() — điểm ghi dữ liệu DUY NHẤT mọi đường (sửa tay, quét
QR, chuyển hàng loạt, 4 nút bấm nhanh) đều đi qua — nên chỉ cần sửa 1 chỗ là chặn được ở MỌI nơi.
2 quy tắc:
  1. "Chưa xác nhận" thì KHÔNG THỂ đã "Đã lấy phôi" hoặc "Đã vẽ file".
  2. Đã tới "ĐÃ SẴN SÀNG CHẠY MÁY" hoặc các bước SAU đó (Đã sản xuất, Đã đóng gói, IN TRANSIT,
     DELIVERED) thì BẮT BUỘC phải có đủ CẢ phôi lẫn file — không áp dụng cho LỖI SẢN XUẤT CẦN LÀM
     LẠI/CANCELLED/REFUNDED (cố ý bỏ qua, vì lúc lỗi cần được phép reset phôi/file về "chưa" để làm
     lại từ đầu, và đơn có thể bị huỷ/hoàn ở bất kỳ giai đoạn nào).
Chỉ kiểm tra khi có ĐỤNG tới 1 trong 3 cột — sửa GHI_CHU/HANG_VAN_CHUYEN... trên 1 đơn mà dữ liệu cũ
lỡ đã sai từ trước KHÔNG bị chặn (tránh khoá cứng những đơn cũ chỉ vì muốn sửa 1 trường không liên
quan). Đã tự mô phỏng 9 tình huống trước khi giao, gồm cả các case dễ báo sai nhất (tương tác với
logic tự động ĐÃ SẴN SÀNG CHẠY MÁY, luồng làm lại sau lỗi, sửa GHI_CHU trên dữ liệu cũ đã sai sẵn) —
khớp đúng cả 9/9.

7.2. LỖ HỔNG 2 (tìm thêm trong lúc rà soát, không phải ví dụ bạn nêu) — route PUT /orders/:sttKey
(sửa 1 đơn) từ trước tới giờ KHÔNG kiểm tra giá trị hợp lệ cho TINH_TRANG/TRANG_THAI_PHOI/
TRANG_THAI_VE_FILE — có thể ghi bất kỳ chuỗi nào (gõ sai chính tả, dán nhầm) thẳng vào Sheet. Route
chuyển hàng loạt đã có kiểm tra riêng từ trước, nhưng route sửa 1 đơn thì chưa từng có. Đã thêm
kiemTraGiaTriHopLe() cùng chỗ (orderService.update()) nên tự động vá cho route này luôn, không cần
sửa riêng.

HỆ QUẢ CẦN LƯU Ý: cả 2 kiểm tra trên giờ có thể THROW lỗi ở orderService.update() — 2 route trước
đây KHÔNG bọc try/catch quanh lời gọi này (route sửa 1 đơn, route quét QR đơn lẻ) sẽ khiến lỗi không
được báo rõ ràng cho người dùng. Đã bọc try/catch bổ sung ở cả 2 chỗ, trả về đúng
{error: "..."} để giao diện hiện được thông báo rõ ràng thay vì lỗi chung chung hoặc trang trắng.
2 route còn lại (chuyển hàng loạt, quét QR hàng loạt) đã có try/catch từ trước, không cần sửa.

7.3. CẢI THIỆN GIAO DIỆN ĂN THEO (public/order.html) — thêm cảnh báo NGAY khi người dùng đổi 1
trong 3 dropdown ở khối "Sửa trạng thái thủ công", trước khi bấm Lưu, thay vì để bấm xong mới biết
bị từ chối. Nút Lưu tự khoá lại khi đang có tổ hợp không hợp lệ. Đây CHỈ là gợi ý giao diện (dùng
lại đúng 2 quy tắc viết bằng JS thuần, không gọi API) — không phải chốt bảo mật, server vẫn luôn
kiểm tra lại đầy đủ dù ai đó có sửa JS trên trình duyệt để bỏ qua cảnh báo này. Đã tự đối chiếu bằng
cách chạy vét cạn cả 40 tổ hợp có thể (10 giá trị TINH_TRANG × 2 phôi × 2 vẽ file) giữa logic client
và server — khớp 100%, không có trường hợp nào lệch nhau.

7.4. scripts/kiem-tra-tinh-hop-le.js (MỚI, CHỈ ĐỌC — không có --apply, không bao giờ ghi gì): 2
kiểm tra mới chỉ chặn được lỗi PHÁT SINH TỪ NAY VỀ SAU, không tự sửa được dữ liệu cũ đã lỡ sai từ
trước (nếu có). Chạy script này 1 lần để biết chính xác có bao nhiêu đơn cũ đang sai, rồi tự sửa
tay từng đơn cho đúng (không tự động sửa hộ, vì không biết ý người dùng thật sự muốn đơn đó ở trạng
thái nào cho đúng). Cách chạy: node scripts/kiem-tra-tinh-hop-le.js — đã tự mô phỏng với 4 đơn giả
(2 đúng, 2 sai), tìm đúng chính xác 2 đơn sai.

7.5. ĐỀ XUẤT THÊM (CHƯA LÀM, cần bạn xác nhận trước nếu muốn triển khai):
  - Bắt buộc cột HANG_VAN_CHUYEN/MA_VAN_DON_ID phải có giá trị trước khi cho phép chuyển TINH_TRANG
    sang IN TRANSIT_Tracking đã hoạt động — hiện chưa có ràng buộc này, 1 đơn có thể "đang vận
    chuyển" mà không có mã vận đơn nào. Chưa làm vì không chắc chắn 100% đây luôn là bắt buộc về mặt
    nghiệp vụ (có thể mã vận đơn được điền sau qua tích hợp API vận chuyển).
  - Cảnh báo tương tự (client-side, không chặn cứng) cho công cụ "Chuyển trạng thái hàng loạt" và 4
    nút bấm nhanh ở trang Đơn hàng — hiện các công cụ đó CHỈ báo lỗi SAU khi bấm Áp dụng (server trả
    về danh sách lỗi rõ ràng theo từng đơn, không phải không có phản hồi, nhưng chưa cảnh báo TRƯỚC
    khi bấm như đã làm ở trang chi tiết đơn).
  - Thêm 1 báo cáo/thẻ nhỏ ở Dashboard đếm số đơn "dữ liệu cũ chưa hợp lệ" (chạy sẵn logic của
    kiem-tra-tinh-hop-le.js), để không cần vào console chạy script tay mỗi lần muốn kiểm tra.



