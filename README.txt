CẬP NHẬT LỚN: đổi toàn bộ pipeline TINH_TRANG theo sơ đồ logic mới (So_do_logic.pdf)
======================================================================================

QUAN TRỌNG — ĐƯỜNG DẪN TRONG ZIP LÀ GIẢ ĐỊNH:
Suy từ require() trong chính các file (vd routes/reports.js gọi
require('../services/orderService') => routes/ ngang hàng với services/, data/,
middleware/). Đối chiếu lại với cấu trúc thật của bạn trước khi copy đè.

DANH SÁCH FILE TRONG ZIP:
- data/pipelineTinhTrang.js     -> viết lại HOÀN TOÀN theo pipeline mới
- services/orderService.js      -> viết lại filterForRole theo giai đoạn mới
- services/alertService.js      -> viết lại mốc cảnh báo Vàng/Cam/Đỏ theo giai đoạn mới
- routes/orders.js               -> (không đổi so với lần trước — tìm kiếm + lọc ngày)
- routes/reports.js              -> đổi 3 hằng số trạng thái sang tên mới
- public/orders.html            -> danh sách 16 trạng thái mới cho dropdown chuyển trạng thái
- public/reports.html           -> sửa đoạn mô tả nhắc tên trạng thái cũ
- public/js/api.js              -> sửa lopTrangThai() (tô màu badge) theo pipeline mới
- public/js/icons.js            -> (không đổi so với lần trước)
- public/css/style.css          -> (không đổi so với lần trước)
- scripts/migrate-trang-thai.js -> SCRIPT CHẠY 1 LẦN để đổi TINH_TRANG của đơn cũ trong Sheet

======================================================================================
1. PIPELINE MỚI VÀ BẢNG ÁNH XẠ DỮ LIỆU CŨ -> MỚI
======================================================================================

Trạng thái CŨ                          -> Trạng thái MỚI
B0_Chờ xác nhận                        -> B1.2_HOLD_Chưa xác nhận
B1_Đã in                               -> B1.1_Đơn đã xác nhận
B2_Đã lấy phôi                         -> B2.1_Đã có phôi
B3_Đã đủ Phôi và File Vẽ               -> B3.1_Đã vẽ file
B4_Đang sản xuất                       -> B4.1_Đơn đã sản xuất
B5_Đã sản xuất                         -> B5.1_Đơn đã đóng gói
ĐƠN LỖI CẦN LÀM LẠI                   -> B4.3_ĐƠN LỖI CẦN LÀM LẠI
SHIPPED / IN TRANSIT / DELIVERED / CANCELLED / REFUNDED -> giữ nguyên

Trạng thái MỚI hoàn toàn (chưa từng có trong dữ liệu cũ, phát sinh khi hệ thống mới
chạy thật): B2.2_Không có phôi, B3.2_Chưa vẽ file, B4.2_Đơn chưa sản xuất,
B5.2_Đơn chưa đóng gói.

Logic: mỗi giai đoạn 1-5 có 1 cặp trạng thái XONG/CHƯA XONG. Riêng giai đoạn 4 (sản
xuất) có thêm nhánh lỗi B4.3 — khi sản xuất phát hiện lỗi, đơn DỪNG LẠI ở B4.3 (không
tự động nhảy tiếp), chờ một thao tác riêng "Xác nhận đã làm lại" (mở cho MỌI vai trò)
để chuyển hẳn về B1.1_Đơn đã xác nhận, coi như làm lại từ đầu (lấy phôi mới, vẽ lại
file, sản xuất lại).

======================================================================================
2. CẬP NHẬT TAB "CauHinhKichBan" TRÊN GOOGLE SHEET (bắt buộc, đây là dữ liệu không nằm
   trong code — bạn cần tự sửa trực tiếp trên Sheet)
======================================================================================

Xoá các dòng cũ có Trạng_Thai_Yeu_Cau/Trạng_Thái_Sau dùng tên trạng thái B0-B5 cũ,
thay bằng các dòng sau (cột: Ten_Kich_Ban, Trang_Thai_Yeu_Cau, Trang_Thai_Sau):

Ten_Kich_Ban                     | Trang_Thai_Yeu_Cau            | Trang_Thai_Sau
----------------------------------|--------------------------------|--------------------------------
Xác nhận đơn                     | B1.2_HOLD_Chưa xác nhận        | B1.1_Đơn đã xác nhận
Đã có phôi                       | B1.1_Đơn đã xác nhận           | B2.1_Đã có phôi
Không có phôi                    | B1.1_Đơn đã xác nhận           | B2.2_Không có phôi
Đã tìm được phôi                 | B2.2_Không có phôi             | B2.1_Đã có phôi
Đã vẽ file                       | B2.1_Đã có phôi                | B3.1_Đã vẽ file
Chưa vẽ file                     | B2.1_Đã có phôi                | B3.2_Chưa vẽ file
Đã vẽ xong file                  | B3.2_Chưa vẽ file              | B3.1_Đã vẽ file
Đã sản xuất                      | B3.1_Đã vẽ file                | B4.1_Đơn đã sản xuất
Chưa sản xuất                    | B3.1_Đã vẽ file                | B4.2_Đơn chưa sản xuất
Sản xuất lỗi cần làm lại         | B3.1_Đã vẽ file                | B4.3_ĐƠN LỖI CẦN LÀM LẠI
Đã sản xuất xong (đơn đang chờ)  | B4.2_Đơn chưa sản xuất         | B4.1_Đơn đã sản xuất
Xác nhận đã làm lại              | B4.3_ĐƠN LỖI CẦN LÀM LẠI       | B1.1_Đơn đã xác nhận
Đã đóng gói                      | B4.1_Đơn đã sản xuất           | B5.1_Đơn đã đóng gói
Chưa đóng gói                    | B4.1_Đơn đã sản xuất           | B5.2_Đơn chưa đóng gói
Đã đóng gói xong                 | B5.2_Đơn chưa đóng gói         | B5.1_Đơn đã đóng gói
Xác nhận đã ship                 | B5.1_Đơn đã đóng gói           | SHIPPED_Đã gửi vận chuyển

Ghi chú: hệ thống hiện KHÔNG giới hạn kịch bản theo vai trò ở tầng code (mọi vai trò
đăng nhập đều dùng được mọi kịch bản) — đúng với yêu cầu "mọi vai trò đều xác nhận
được". Nếu sau này muốn giới hạn vai trò cho từng kịch bản, cần bổ sung thêm cột
"Vai_Tro_Duoc_Dung" vào tab này và sửa services/scenarioService.js — hiện chưa làm vì
không nằm trong yêu cầu lần này.

======================================================================================
3. ĐƠN MỚI TẠO RA — TRẠNG THÁI MẶC ĐỊNH
======================================================================================

Đơn mới khi nhập vào Sheet (qua Apps Script/kênh bán hàng, KHÔNG qua code Node trong
zip này) cần có TINH_TRANG mặc định = "B1.2_HOLD_Chưa xác nhận" (tương đương "B0_Chờ
xác nhận" cũ). Nhớ sửa lại nơi tạo đơn mới (Apps Script) cho khớp.

======================================================================================
4. THỨ TỰ TRIỂN KHAI ĐỀ XUẤT
======================================================================================

1. Sửa tab CauHinhKichBan theo bảng ở mục 2.
2. Copy các file .js/.html trong zip này đè vào đúng vị trí trên VPS.
3. Chạy thử migrate (KHÔNG ghi gì, chỉ xem trước):
     node scripts/migrate-trang-thai.js
   Kiểm tra số lượng đơn từng trạng thái cũ hiển thị ra có khớp thực tế không.
4. Chạy thật để ghi vào Sheet:
     node scripts/migrate-trang-thai.js --apply
5. Restart server Node (pm2 restart ... hoặc systemctl restart ...) để nạp code mới.
6. Kiểm tra lại: trang Đơn hàng hiển thị đúng badge màu, mỗi vai trò thấy đúng đơn của
   mình, quét QR theo kịch bản mới hoạt động đúng, cảnh báo Vàng/Cam/Đỏ vẫn tính đúng.

======================================================================================
5. CÁC CHỖ ĐÃ SỬA / LOGIC MỚI, CHI TIẾT
======================================================================================

- data/pipelineTinhTrang.js: thay hẳn mảng tuyến tính THU_TU_TINH_TRANG bằng
  GIAI_DOAN_CUA_TRANG_THAI (mỗi trạng thái gắn 1 giai đoạn 1-5 + cờ xong/chưa xong) và
  hàm chuaXongGiaiDoan(tinhTrang, moc). Trạng thái lạ/rỗng hoặc đã ship/đã giao/đã huỷ
  (không nằm trong 5 giai đoạn) mặc định trả về "chưa xong" — an toàn cho việc tính
  cảnh báo, nhưng nơi cần biết "đã QUA giai đoạn sản xuất" (vai trò dong_goi) phải cộng
  thêm điều kiện riêng cho TRANG_THAI_DA_SHIP/TRANG_THAI_KET_THUC (đã làm trong
  orderService.js).

- services/orderService.js (filterForRole): chuan_bi_phoi thấy đơn chưa có phôi (GĐ2
  chưa xong); ve_file thấy đơn chưa vẽ xong file (GĐ3 chưa xong); san_xuat thấy đơn đã
  vẽ xong file trở đi tới trước khi ship; dong_goi thấy đơn đã sản xuất xong trở đi,
  gồm cả đã ship/đã giao (giữ đúng thói quen cũ, đóng gói theo dõi tới lúc giao xong).

- services/alertService.js (tinhMucCanhBao): mốc Vàng đổi từ "chưa tới B2_Đã lấy
  phôi(cũ)" sang "chưa xong giai đoạn 2 (chưa có phôi)"; mốc Cam từ "chưa tới
  B4_Đang sản xuất(cũ)" sang "chưa xong giai đoạn 4 (chưa sản xuất xong)"; mốc Đỏ giữ
  nguyên ý nghĩa "chưa ship".

- public/js/api.js (lopTrangThai — tô màu badge trạng thái): đuôi "X.1_" (đã xong) =
  xanh, đuôi "X.2_" (chưa xong) = vàng, "LỖI" = đỏ (cùng nhóm với huỷ/hoàn đơn). Trước
  đây tô theo tiền tố B2/B3 (vàng) và B4/B5 (xanh) kiểu tuyến tính — không còn đúng vì
  giờ B4.2/B4.3 (chưa xong/lỗi) cũng bắt đầu bằng "B4" nhưng KHÔNG được tô xanh.

- routes/reports.js: 3 hằng số chọn mẫu in đổi theo bảng ánh xạ ở mục 1 (không đổi
  logic khác).

======================================================================================
SAU KHI COPY FILE, NHỚ:
======================================================================================
- public/js/api.js, public/js/icons.js, public/css/style.css dùng chung cho MỌI trang.
  Bump version ?v=... ở TẤT CẢ các trang .html còn lại (index, dashboard, chatbot,
  settings, order, users, scan...) cho khớp: api.js -> ?v=20260824b (đổi lopTrangThai
  ảnh hưởng cả badge ở order.html), icons.js/style.css giữ nguyên version đợt trước
  nếu bạn đã bump rồi.

======================================================================================
6. ĐỢT CẬP NHẬT MỚI (rà soát logic + giao diện + dark theme)
======================================================================================

FILE THÊM/SỬA MỚI TRONG ĐỢT NÀY:
- services/telegramService.js  -> SỬA LỖI: tin nhắn cảnh báo dùng sai tên cột
- services/canhBaoJob.js        -> gán tên khách hàng thật trước khi gửi Telegram
- public/js/theme.js            -> thêm logic dark theme (bật/tắt thủ công)
- public/css/style.css          -> thêm bảng màu dark theme + tinh chỉnh UI chung
- public/settings.html          -> thêm công tắc bật/tắt "Chế độ tối"
- public/js/icons.js            -> thêm icon moon/sun cho công tắc dark theme

6.1. LỖI ĐÃ SỬA (rà soát logic):
services/telegramService.js đọc nhầm tên cột khi gửi tin Telegram cảnh báo Vàng/Cam/Đỏ
— dùng "Ten_San_Pham", "Ten_KH", "Trang_Thai", "Ngay_Dat" trong khi Sheet thật không có
các cột này (tên thật: LOAI/KICH_THUOC/MAU_SAC, MA_KHACH_HANG, TINH_TRANG, NGAY_LEN_DON).
Hậu quả: các dòng Sản phẩm/Khách hàng/Trạng thái/Ngày đặt trong tin Telegram từ trước
tới giờ đều rỗng. Đã sửa lại đúng tên cột, và canhBaoJob.js giờ gán sẵn tên khách hàng
thật (không chỉ mã) trước khi gửi.

Hai điểm khác PHÁT HIỆN nhưng CHƯA sửa (cần bạn xác nhận có phải đổi không):
- dashboard.js hiển thị thống kê TOÀN BỘ đơn hàng cho MỌI vai trò đăng nhập (không lọc
  theo filterForRole như trang Đơn hàng) — có thể là chủ ý (ai cũng xem được tổng quan),
  nhưng nếu muốn giới hạn theo vai trò thì cần sửa thêm.
- services/telegramService.js có cấu hình "NHAC_SHIP" (nhắc ship) nhưng không có chỗ nào
  trong code gọi tới — có thể là tính năng dự kiến làm nhưng chưa hoàn thiện, không phải
  lỗi, giữ nguyên không xoá theo nguyên tắc không tự xoá code có sẵn.

6.2. DARK THEME:
Vào trang Cài đặt sẽ thấy công tắc "Chế độ tối" phía trên bảng chọn màu chủ đạo — bật/
tắt thủ công, lưu riêng theo từng máy/trình duyệt (giống cách lưu màu chủ đạo hiện có),
KHÔNG tự động theo hệ điều hành. Áp dụng ngay lập tức cho toàn bộ ứng dụng vì mọi màu
trong style.css đều đã dùng CSS variable — bật/tắt 1 nút là đổi hết, không cần sửa từng
trang. 2 chỗ màu viết cứng (không dùng token) đã được override riêng cho nền tối: màu
cam của cảnh báo mức Cam, và hiệu ứng shimmer của khung xám khi đang tải (skeleton).

QUAN TRỌNG: public/js/theme.js được nạp ở TẤT CẢ các trang (kể cả những trang không có
trong zip lần này) — phải bump version ?v=... của theme.js ở MỌI trang .html thì dark
theme mới hoạt động đồng nhất trên toàn hệ thống (không chỉ riêng orders.html/settings.html
trong zip này). Bump thành ?v=20260824a.

6.3. LÀM MỚI GIAO DIỆN:
Phạm vi đợt này: nút bấm có gradient nhẹ + nhấc lên khi hover, thẻ đơn/thẻ in/bảng có
bóng đổ mượt hơn khi tương tác (thẻ đơn giờ có bóng đổ sâu hơn + ảnh mockup zoom nhẹ khi
hover), thanh điều hướng trên cùng có hiệu ứng mờ kính (backdrop blur) nhẹ, chuyển đổi
màu mượt khi đổi theme (sáng/tối hoặc đổi màu chủ đạo) thay vì đổi phắt. KHÔNG vẽ lại bố
cục/cấu trúc HTML của từng trang (rủi ro cao, tốn thời gian không cần thiết cho 1 lượt) —
nếu muốn thiết kế lại bố cục cụ thể của 1 trang nào đó (vd trang chi tiết đơn, trang quét
QR), nói rõ trang đó để làm riêng.

======================================================================================
7. RÀ SOÁT LẦN 2 — MÔ PHỎNG LOGIC BẰNG NODE, PHÁT HIỆN VÀ SỬA THÊM 2 LỖI THẬT
======================================================================================

Sau khi viết xong pipeline mới, mình đã chạy thử filterForRole() và tinhMucCanhBao() với
Node cho ĐỦ CẢ 16 trạng thái để xem từng vai trò/mốc cảnh báo có ra đúng kết quả không
(không chỉ đọc code bằng mắt). Nhờ vậy phát hiện thêm 2 lỗi thật, đã sửa:

7.1. services/orderService.js (filterForRole) — LỖI: chuan_bi_phoi và ve_file bị lộ nhìn
thấy cả đơn đã SHIPPED/IN TRANSIT/DELIVERED/CANCELLED/REFUNDED (đáng lẽ những đơn này
không còn liên quan gì tới việc nhặt phôi/vẽ file nữa). Nguyên nhân: hàm chuaXongGiaiDoan()
coi mọi trạng thái "lạ" (không nằm trong 5 giai đoạn sản xuất, gồm cả đã ship/đã giao) là
"chưa xong" — thiết kế này đúng cho mục đích tính cảnh báo (an toàn, không bỏ sót), nhưng
lại vô tình khiến 2 vai trò trên nhìn thấy nhầm đơn đã hoàn tất từ lâu. Đã thêm điều kiện
loại trừ rõ ràng (daRoiKhoiSanXuat) cho cả 2 vai trò.

7.2. services/alertService.js (tinhMucCanhBao) — LỖI: đơn đã SHIPPED vẫn bị tính cảnh báo
mức Cam (dù mức Đỏ đã đúng là không tính cho đơn đã ship). Cùng nguyên nhân gốc như lỗi
7.1. Đã thêm điều kiện "chưa ship" vào cả 2 mốc Vàng và Cam (trước đó chỉ mốc Đỏ có điều
kiện này).

Cả 2 lỗi đều đã viết lại thành bài test nhỏ chạy bằng `node -e "..."` với đủ 16 trạng thái
và nhiều mốc số ngày khác nhau, kết quả khớp 100% với kỳ vọng sau khi sửa.

Ngoài ra dọn thêm vài chỗ nhỏ: 2 đoạn comment bị lặp/lỗi thời trong routes/reports.js và
routes/orders.js (nói "12 trạng thái" trong khi giờ là 16, và nhắc tên trạng thái cũ), và
gộp 2 khối CSS ".btn-hanh-dong" bị viết tách rời (1 khối gốc + 1 khối gradient mới thêm)
lại thành 1 — trước khi gộp, phần gradient bị mất khi hover do khối sau ghi đè "background"
của khối trước, giờ hover giữ đúng hiệu ứng gradient + sáng nhẹ như thiết kế.

======================================================================================
8. RÀ SOÁT LẦN 3 — MỞ RỘNG SANG CÁC TRANG CHƯA XEM, PHÁT HIỆN THÊM 3 VẤN ĐỀ
======================================================================================

FILE THÊM MỚI TRONG ĐỢT NÀY:
- public/dashboard.html -> sửa màu chữ/lưới biểu đồ Chart.js theo dark theme

Lần này mình đọc thêm các file trước đó chưa xem kỹ (driveService.js, dashboard.html,
order.html, scan.html, users.html, chatbot.html, index.html, canhBao.js) và soi lại toàn
bộ style.css tìm màu viết cứng còn sót. Phát hiện 3 vấn đề:

8.1. dashboard.html — Chart.js vẽ bằng <canvas>, KHÔNG tự đọc CSS variable của trang. Khi
bật Chế độ tối, nền thẻ biểu đồ đổi đúng (dùng var(--color-surface)) nhưng CHỮ tiêu đề/
chú thích/lưới của biểu đồ vẫn giữ màu tối mặc định của thư viện — khó đọc trên nền tối.
Đã sửa: đọc dangCheDoToi() để set Chart.defaults.color/borderColor phù hợp trước khi vẽ
biểu đồ. (Đã bump version style.css/theme.js/icons.js/api.js trong dashboard.html cho
khớp bản mới nhất — trang này trước đó chưa nằm trong các đợt sửa nên vẫn trỏ bản cũ.)

8.2. LỖI DO CHÍNH ĐỢT DARK THEME TRƯỚC GÂY RA (public/css/style.css) — vòng nhấp nháy đỏ
của badge cảnh báo Đỏ (nhipCanhBao) chỉ có 1 phiên bản màu, hợp nền sáng nhưng chìm vào
nền badge rất tối trong dark theme. Thêm phiên bản riêng cho dark theme SÁNG hơn để còn
nhìn thấy nhấp nháy. Việc này lại kéo theo 1 lỗi CSS specificity: selector có tiền tố
"[data-theme="dark"]" có độ đặc hiệu cao hơn ".badge-canh-bao.do" thường, nên NẾU chỉ thêm
mà không sửa khối "giảm chuyển động" (prefers-reduced-motion), thì bật cả dark theme lẫn
giảm chuyển động cùng lúc → animation vẫn chạy, sai ý người dùng đã bật. Đã sửa bằng cách
liệt kê tường minh cả 2 biến thể trong khối giảm chuyển động.

8.3. LỖI CÓ SẴN TỪ TRƯỚC (không phải do các đợt sửa gần đây, nhưng đúng phạm vi "rà soát
toàn bộ") — hiệu ứng shimmer của khung skeleton loading (khi đang tải danh sách) chưa từng
bị tắt khi người dùng bật "giảm chuyển động" trong hệ điều hành/trình duyệt. Đã thêm vào
khối prefers-reduced-motion.

8.4. KHÔNG KIỂM TRA ĐƯỢC (nói rõ để bạn biết phạm vi rà soát): chatbot.js (frontend) gọi
API "/chatbot/hoi", nhưng file xử lý phía backend cho route này (routes/chatbot.js hoặc
tương đương) KHÔNG có trong danh sách file project mình được cấp — không audit được liệu
system prompt gửi cho Gemini có mô tả pipeline CŨ (B0-B5) hay không. Nếu prompt đó có nhắc
tên trạng thái, cần tự kiểm tra và cập nhật riêng theo pipeline mới.

Không phát hiện thêm lỗi nào ở: users.js/users.html (không đụng gì tới TINH_TRANG), scan.html
(đọc kịch bản hoàn toàn từ Sheet, không hardcode tên trạng thái), driveService.js, canhBao.js,
index.html.

======================================================================================
9. NÂNG CẤP CHATBOT — function calling, sửa pipeline cũ, mở rộng phạm vi dữ liệu
======================================================================================

FILE THÊM/SỬA MỚI TRONG ĐỢT NÀY:
- routes/chatbot.js       -> viết lại hoàn toàn (xử lý POST /chatbot/hoi)
- services/logService.js  -> thêm hàm layHoatDongGanDay() (tra lịch sử hoạt động chung)

9.1. LỖI ĐÃ SỬA: system prompt cũ của chatbot mô tả ĐÚNG pipeline CŨ (B0_Chờ xác nhận →
B1_Đã in → B2_Đã lấy phôi → B3_Đã đủ Phôi và File Vẽ → B4_Đang sản xuất → B5_Đã sản xuất) —
sai hoàn toàn kể từ khi đổi sang pipeline mới (16 trạng thái, mục 1 ở trên). Đây chính là
lỗ hổng mình đã nêu ở mục 8.4 lần rà soát trước nhưng chưa có file để sửa. Đã viết lại đúng
theo pipeline mới.

9.2. GIỚI HẠN CŨ ĐÃ BỎ: code cũ nạp cứng tối đa 200 đơn (rows.slice(0, 200)) vào MỌI câu hỏi,
dù câu hỏi có cần hay không — nếu xưởng có hơn 200 đơn đang hiển thị theo vai trò, chatbot
âm thầm KHÔNG thấy phần còn lại, có thể trả lời sai số liệu mà không biết là thiếu dữ liệu.
Đã bỏ hẳn cách nạp cứng này.

9.3. CÁCH LÀM MỚI — function calling: chatbot giờ chỉ nhận sẵn 1 bảng thống kê nhanh (đếm đơn
theo trạng thái, trong phạm vi vai trò được xem) ngay trong system prompt — đủ trả lời câu hỏi
tổng quan mà không tốn lượt gọi nào. Khi cần chi tiết hơn, model TỰ GỌI đúng công cụ tương ứng
để lấy dữ liệu thật thay vì đoán:
  - tra_cuu_don_hang(maDon) — xem 1 đơn cụ thể
  - tim_don_hang(maKhachHang?, trangThai?, tuNgay?, denNgay?) — tìm/lọc danh sách đơn
  - thong_ke_don_hang(nhomTheo, tuNgay?, denNgay?) — đếm theo trạng thái/khách hàng/loại
  - tra_cuu_khach_hang(tuKhoa) — tìm khách hàng theo mã/tên
  - tra_cuu_lich_su_don(maDon) — lịch sử 1 đơn cụ thể
  - tra_cuu_nhan_vien(vaiTro?) — CHỈ admin/quan_ly (không gửi định nghĩa công cụ này cho vai
    trò khác — model không biết công cụ tồn tại; có thêm 1 lớp kiểm tra quyền runtime cho chắc)
  - tra_cuu_lich_su_gan_day(nguoiDung?, hanhDong?, gioiHan?) — CHỈ admin/quan_ly

9.4. PHÂN QUYỀN DỮ LIỆU — giữ nguyên đúng quy ước bảo mật đã có trong code cũ (comment gốc:
"Chatbot chỉ trả lời trong phạm vi đơn mà vai trò của user được thấy"): tim_don_hang và
thong_ke_don_hang áp dụng filterForRole() y hệt trang Đơn hàng. Riêng tra_cuu_don_hang và
tra_cuu_lich_su_don (tra theo ĐÚNG 1 mã đơn cụ thể) thì KHÔNG giới hạn theo vai trò — vì đây
là hành vi đã có sẵn từ trước ở trang chi tiết đơn (order.html): ai có đúng mã đơn cũng xem
được, route GET /orders/:sttKey hiện tại cũng không lọc theo vai trò. Mình giữ nguyên đúng
quy ước cũ này cho nhất quán, không tự ý thắt chặt hay nới lỏng thêm.

QUYẾT ĐỊNH CẦN BẠN XÁC NHẬN LẠI: câu trả lời trước bạn chọn "Tất cả: đơn hàng, khách hàng,
NHÂN VIÊN, lịch sử hoạt động" — nhưng route quản lý nhân viên hiện tại (users.js) chỉ cho
đúng admin dùng (không phải quan_ly). Mình đã áp dụng y hệt ranh giới đó cho 2 công cụ
tra_cuu_nhan_vien/tra_cuu_lich_su_gan_day (mở cho cả admin lẫn quan_ly, chặt hơn 1 chút so
với chỉ admin của trang Users, vì quan_ly nghe hợp lý cũng cần xem được). Nếu bạn muốn MỌI
vai trò đều tra được nhân viên/lịch sử qua chatbot, nói lại để mình bỏ giới hạn này.

9.5. AN TOÀN KHI NHÀ CUNG CẤP LLM KHÔNG HỖ TRỢ FUNCTION CALLING: mình không có cách gọi thử
thật endpoint llm.wokushop.com từ môi trường hiện tại (domain không nằm trong danh sách mạng
được phép truy cập), nên KHÔNG chắc chắn 100% wokushop có hỗ trợ đúng tham số "tools" theo
chuẩn OpenAI hay không cho model gemini-2.5-flash-lite, dù mô tả là "OpenAI-compatible" — nhà
cung cấp có thể lờ đi tham số lạ, hoặc báo lỗi thẳng. Để không làm sập cả tính năng chatbot
nếu điều đó xảy ra, code có cơ chế: gọi lần đầu KÈM tools — nếu lỗi, tự động gọi lại 1 lần
KHÔNG kèm tools (quay về kiểu hỏi-đáp thường như bản cũ, vẫn có bảng thống kê nhanh trong system
prompt nên vẫn trả lời được câu hỏi tổng quan). BẮT BUỘC TEST THỰC TẾ sau khi deploy: hỏi thử
1 câu cần tra cứu cụ thể (vd "đơn DH00123 đang ở đâu") xem chatbot có gọi đúng công cụ và trả
lời chính xác không, hay chỉ đang rơi vào nhánh dự phòng không dùng tools.

Vòng lặp gọi công cụ giới hạn tối đa 4 lượt (tránh model gọi công cụ liên tục không dừng) — đã
test bằng mô phỏng, dừng đúng và trả lời dự phòng hợp lý khi chạm giới hạn, không treo request.

======================================================================================
10. GIAO DIỆN ĐỘNG + BÁO CÁO TỶ LỆ LỖI SẢN XUẤT
======================================================================================

FILE THÊM/SỬA MỚI TRONG ĐỢT NÀY:
- public/js/chatbot.js     -> icon động khi chờ trả lời + nút Gửi có icon xoay
- public/chatbot.html      -> thêm id cho nút Gửi, bump version asset dùng chung
- public/orders.html       -> ô trạng thái rỗng có icon nổi, 3 nút in nhanh có icon xoay khi tải
- public/css/style.css     -> CSS cho các hiệu ứng trên + khối thống kê lỗi dạng thanh ngang
- routes/reports.js        -> thêm route GET /reports/thong-ke-loi
- services/logService.js   -> thêm layLichSuChuyenSangTrangThai() (dùng chung, không chỉ B4.3)
- public/reports.html      -> thêm khu vực "Thống kê tỷ lệ lỗi sản xuất"

10.1. GIAO DIỆN ĐỘNG: phát hiện CSS đã có sẵn hạ tầng animation (.icon-spin, @keyframes troiNhe)
nhưng gần như KHÔNG được dùng ở đâu trong code (chỉ troiNhe dùng đúng 1 chỗ ở logo trang đăng
nhập) — tận dụng lại thay vì tạo mới, ít rủi ro hơn. Áp dụng vào 3 chỗ có giá trị thực tế nhất
(không làm tràn lan animation không cần thiết khắp nơi):
  - Chatbot: "Đang trả lời..." (chữ tĩnh) -> 3 chấm nhấp nhô; nút Gửi có icon xoay khi chờ.
  - 3 nút in nhanh (trang Đơn hàng): trước đây bấm xong KHÔNG có phản hồi gì trong lúc chờ tạo
    file (vài giây) — giờ hiện icon xoay + khoá nút, tránh bấm nhiều lần liên tiếp.
  - Trạng thái "không có đơn nào khớp bộ lọc": đổi từ dòng chữ đơn thuần sang icon nổi nhẹ + text,
    dùng chung được (.trang-thai-rong) cho các trang khác sau này.
Toàn bộ animation mới đều đã thêm vào khối prefers-reduced-motion để tắt khi người dùng bật cài
đặt đó (đúng nguyên tắc đã áp dụng nhất quán từ các đợt sửa trước).

10.2. BÁO CÁO TỶ LỆ LỖI SẢN XUẤT — điểm quan trọng nhất về mặt DỮ LIỆU: B4.3_ĐƠN LỖI CẦN LÀM
LẠI là trạng thái THOÁNG QUA (đơn lỗi được xác nhận làm lại sẽ quay về B1.1 ngay sau đó), nên
KHÔNG thể đếm bằng cách lọc TINH_TRANG hiện tại của Don_Hang_ALL — hầu hết đơn từng lỗi trong
quá khứ giờ đã không còn ở B4.3 nữa (đã làm lại, thậm chí đã ship). Phải tính từ LỊCH SỬ
(LichSuHoatDong): mỗi lần có đơn được CHUYỂN SANG B4.3 (qua quét QR đơn/hàng loạt, chuyển trạng
thái hàng loạt, hoặc sửa đơn thủ công — quét đủ cả 4 loại hành động có thể đổi TINH_TRANG) tính
là 1 lần lỗi.

Đơn hàng KHÔNG lưu trực tiếp "team sản xuất" — suy ra bằng cách tra NGƯỜI đã bấm chuyển đơn sang
B4.3 (từ lịch sử), rồi tra Team của người đó trong tab NguoiDung. Nếu không tra được (log bị xoá,
hoặc trạng thái bị đổi trực tiếp trên Sheet không qua app) thì xếp vào nhóm "Không xác định" —
không bỏ sót, không gộp nhầm.

Đặt trong trang Báo cáo (không phải Dashboard) vì lý do thực tế: routes/reports.js mình có toàn
quyền chỉnh sửa (đã sửa nhiều lần), còn file backend xử lý /dashboard/thong-ke KHÔNG có trong
project (giống tình huống thiếu file chatbot backend trước đây) — không có để sửa. Nếu muốn thêm
biểu đồ này vào Dashboard sau này, cần gửi thêm file đó.

BẮT ĐƯỢC 2 LỖI TRƯỚC KHI GIAO (mô phỏng bằng node -e với dữ liệu giả trước khi đóng gói):
- dinhDangNgayGioVN() cần nhận vào Date object, không phải chuỗi ISO thô — gọi sai sẽ ra lỗi
  "Invalid time value". Đã sửa: bọc new Date(...) trước khi gọi.
- Sắp xếp danh sách chi tiết theo chuỗi ĐÃ ĐỊNH DẠNG "DD/MM/YYYY HH:MM" cho ra thứ tự SAI (vd
  "05/09" bị xếp trước "20/08" vì so sánh ký tự, không phải so sánh ngày thật). Đã sửa: sắp xếp
  theo chuỗi ISO gốc TRƯỚC, định dạng hiển thị SAU.

Không dùng thư viện chart mới — vẽ 3 nhóm thống kê (theo loại/theo team/theo tuần) bằng thanh
ngang CSS thuần (đã test logic gộp nhóm bằng mô phỏng, ra đúng kết quả).

======================================================================================
12. PHÂN QUYỀN — CHỈ ADMIN QUẢN LÝ TÀI KHOẢN, MỌI VAI TRÒ KHÁC NHƯ ADMIN
======================================================================================

FILE THÊM/SỬA MỚI TRONG ĐỢT NÀY:
- services/orderService.js  -> filterForRole() không còn lọc theo vai trò
- routes/orders.js          -> TRUONG_DUOC_SUA để trống, mọi vai trò sửa được mọi trường đơn
- public/order.html         -> bỏ giới hạn "chỉ dong_goi/admin" ở khu tải ảnh đóng gói
- routes/chatbot.js         -> mở 2 công cụ tra nhân viên/lịch sử chung cho mọi vai trò

CHÍNH SÁCH MỚI (đã xác nhận qua các câu hỏi trước khi code): mọi tài khoản đã đăng nhập có quyền
xem/sửa dữ liệu GIỐNG HỆT admin. Giới hạn DUY NHẤT còn lại trong toàn hệ thống: chỉ admin mới được
Thêm/Sửa/Khóa/Hủy khóa TÀI KHOẢN người dùng khác (routes/users.js — không đổi gì, đã đúng sẵn từ
trước, quan_ly cũng không vào được trang này, chỉ đúng 1 mình admin).

12.1. RÀ SOÁT TOÀN BỘ CODE để tìm đúng những chỗ có phân quyền thật (không đoán) — chỉ có 4 chỗ:
  1. services/orderService.js (filterForRole) — quyết định mỗi vai trò thấy đơn nào trong danh sách.
  2. routes/orders.js (TRUONG_DUOC_SUA) — quyết định mỗi vai trò sửa được cột nào của 1 đơn.
  3. public/order.html — ẩn/hiện khu tải "ảnh đóng gói" theo vai trò (dong_goi/admin).
  4. routes/chatbot.js (TOOLS_QUAN_LY) — 2 công cụ tra nhân viên + lịch sử hoạt động chung chỉ cho
     admin/quan_ly.
  routes/photos.js, routes/qr.js, routes/reports.js, routes/dashboard.js (nếu có) — RÀ SOÁT KỸ,
  không có giới hạn theo vai trò nào cả (vaiTro chỉ dùng để GHI LOG ai làm, không dùng để chặn) —
  không cần sửa gì ở các file đó.

12.2. CÁC THAY ĐỔI CỤ THỂ:
  - filterForRole(rows, user) giờ chỉ return rows, không lọc gì nữa. Giữ lại hàm (không xóa hẳn +
    sửa mọi nơi gọi) để dễ khôi phục sau này nếu cần — chỉ cần sửa đúng 1 chỗ.
  - TRUONG_DUOC_SUA đổi thành {} — trước đây ve_file/chuan_bi_phoi chỉ sửa được GHI_CHU,
    san_xuat/dong_goi chỉ sửa được vài cột cụ thể; giờ mọi vai trò sửa được MỌI cột (trừ
    TRUONG_CAM_SUA — khóa chính và trường tính toán, không đổi, không ai sửa được kể cả admin).
  - order.html: khu vực "Chụp ảnh đóng gói" trước đây chỉ dong_goi/admin thấy, giờ mọi vai trò thấy.
  - chatbot.js: 2 công cụ tra_cuu_nhan_vien và tra_cuu_lich_su_gan_day mở cho mọi vai trò (đây là
    XEM dữ liệu, không phải Thêm/Sửa/Khóa/Hủy khóa tài khoản — không thuộc phạm vi giới hạn admin
    theo đúng yêu cầu). Mô tả công cụ gửi cho LLM cũng sửa lại, bỏ dòng "CHỈ dùng được cho
    admin/quản lý" cũ để LLM không hiểu nhầm giới hạn không còn tồn tại.

12.3. DỌN CODE THỪA (import/hàm không còn ai gọi sau khi bỏ lọc theo vai trò, tự phát hiện và xóa
theo đúng nguyên tắc không để lại code rác do chính thay đổi của mình gây ra):
  - services/orderService.js: xóa hàm daRoiKhoiSanXuat() và import chuaXongGiaiDoan/
    TRANG_THAI_DA_SHIP/TRANG_THAI_KET_THUC từ data/pipelineTinhTrang.js (chỉ dùng trong
    filterForRole cũ, giờ không còn ai gọi).
  - routes/chatbot.js: xóa hằng số VAI_TRO_QUAN_LY và biến laQuanLy (không còn dùng để phân biệt
    quyền dùng công cụ nữa).

12.4. ĐÃ TỰ MÔ PHỎNG BẰNG NODE trước khi giao: filterForRole trả về đủ số đơn cho cả 6 vai trò;
TRUONG_DUOC_SUA cho phép mọi vai trò sửa GHI_CHU/TINH_TRANG/HANG_VAN_CHUYEN như nhau, và vẫn chặn
đúng STT_Key (trường cấm sửa) — không có vai trò nào bị sót hay được ưu tiên nhầm.

12.5. KHÔNG ĐỔI: routes/users.js (chỉ admin quản lý tài khoản, đã đúng sẵn), data/pipelineTinhTrang.js,
cơ chế quét QR theo kịch bản (vốn đã mở cho mọi vai trò từ trước, không có gì phải sửa).

======================================================================================
13. SỬA LỖI THỐNG KÊ LỖI + XÓA XUẤT BÁO CÁO + ĐỔI TÊN 3 NÚT IN NHANH
======================================================================================

FILE THÊM/SỬA MỚI TRONG ĐỢT NÀY:
- services/logService.js  -> layLichSuChuyenSangTrangThai() nhận mảng tên trạng thái
- routes/reports.js       -> TRANG_THAI_LOI là mảng gồm cả tên cũ lẫn tên mới
- public/reports.html     -> xóa hẳn phần "Xuất báo cáo", chỉ còn "Thống kê tỷ lệ lỗi sản xuất"
- public/orders.html      -> đổi tên 3 nút in nhanh

13.1. SỬA LỖI: thống kê tỷ lệ lỗi sản xuất luôn báo 0 lỗi dù thực tế có đơn bị lỗi. Nguyên nhân xác
định qua hỏi lại triệu chứng cụ thể rồi đối chiếu code: ở đợt đổi pipeline trước, tên trạng thái lỗi
đổi từ "ĐƠN LỖI CẦN LÀM LẠI" (cũ) sang "B4.3_ĐƠN LỖI CẦN LÀM LẠI" (mới). Script migrate-trang-thai.js
CHỈ đổi TINH_TRANG hiện tại của đơn trong Sheet Don_Hang_ALL — KHÔNG (và không thể) sửa lại các dòng
LỊCH SỬ đã ghi sẵn trong tab LichSuHoatDong từ trước khi đổi pipeline. Báo cáo thống kê lỗi lại tính
hoàn toàn dựa trên lịch sử (bắt buộc, xem lại lý do ở mục 10.2), nên so khớp đúng 1 tên mới sẽ bỏ sót
mọi lần lỗi xảy ra TRƯỚC thời điểm đổi pipeline — nếu toàn bộ lỗi thực tế của xưởng đều xảy ra trước
mốc đó (nhiều khả năng đúng vậy, vì pipeline mới chỉ vừa đổi gần đây), báo cáo sẽ báo 0 hoàn toàn.

Đã sửa: layLichSuChuyenSangTrangThai() giờ nhận vào 1 CHUỖI hoặc MẢNG các tên trạng thái cần so khớp
(thay vì chỉ 1 chuỗi cố định), và routes/reports.js truyền vào cả 2 tên (cũ + mới). Đã tự mô phỏng
bằng Node với 3 dòng log giả (1 dòng tên cũ, 2 dòng tên mới qua 2 đường ghi log khác nhau) — tìm thấy
đúng cả 3, không sót dòng nào.

Nếu sau này còn đổi tên bất kỳ trạng thái nào khác, cùng cách này áp dụng được: mọi báo cáo dựa trên
LỊCH SỬ (không phải trạng thái hiện tại) đều cần liệt kê đủ các tên cũ từng dùng, không chỉ tên mới
nhất.

13.2. XÓA PHẦN "XUẤT BÁO CÁO": theo đúng yêu cầu, đã xóa hẳn khối chọn khoảng ngày/khách hàng/trạng
thái + 3 nút Xem trước/Xuất Excel/Xuất PDF khỏi trang Báo cáo, cùng toàn bộ JS chỉ phục vụ khối đó
(xemTruoc, xuatBaoCao, taiDanhSachTrangThai, layThamSoLoc, layThamSoLocDayDu, an_KhuXemTruoc). Trang
Báo cáo giờ chỉ còn đúng 1 phần: Thống kê tỷ lệ lỗi sản xuất.

KHÔNG xóa 3 route backend /reports/xem-truoc, /reports/excel, /reports/khach-hang, /reports/trang-thai-theo-loc
— dù không còn UI nào gọi tới, nhưng route /reports/pdf (dùng chung code) vẫn đang được 3 nút in nhanh
ở trang Đơn hàng gọi trực tiếp, và yêu cầu chỉ nói xóa PHẦN GIAO DIỆN ("tại menu Báo cáo"), không nói
xóa hẳn khả năng xuất Excel/xem trước phía server. Nếu muốn xóa luôn các route không còn dùng tới ở
backend, nói rõ để mình dọn tiếp — hiện tại chúng không gây hại gì (chỉ là code không còn đường gọi
tới từ giao diện).

13.3. ĐỔI TÊN 3 NÚT (chỉ đổi chữ hiển thị, KHÔNG đổi tham số "mau" gửi lên server nên hành vi giữ
nguyên 100%):
  - "IN DANH SÁCH PHÔI ÁO"                          -> "IN DANH SÁCH PHÔI"
  - "IN ĐƠN ÁO"                                      -> "IN ĐƠN"
  - "IN DANH SÁCH ÁO ĐÃ SẢN XUẤT CHO TRACKING"       -> "IN DANH SÁCH ĐÃ SẢN XUẤT"







