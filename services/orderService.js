const { readTab, readTabCached } = require('./sheetsService');
const trangThaiDbService = require('./trangThaiDbService');
const { layBanDoTenKhachHang } = require('./khachHangService');
const taiSanService = require('./taiSanService');
const { chiSoTinhTrang, TINH_TRANG_VALUES, TRANG_THAI_PHOI_VALUES, TRANG_THAI_VE_FILE_VALUES } = require('../data/pipelineTinhTrang');
const { thoiGianVNISOString } = require('./dateUtils');
const { laSuperAdmin } = require('../middleware/auth');
const { layDanhSachXuong, layTeamXuongMacDinh } = require('./caiDatDbService');
const donNhieuAoService = require('./donNhieuAoService');
const taiKhoanService = require('./taiKhoanService');
const TRANG_THAI_HUY = donNhieuAoService.TRANG_THAI_HUY;
const TRANG_THAI_DA_GUI_DI = ['ĐÃ DÁN TEM', 'DELIVERED_Đã giao đến khách'];
// LỌC TỔNG QUÁT (29/09/2026, theo yêu cầu người dùng) — 3 nhóm trạng thái do người dùng quy định, phủ ĐÚNG đủ 10 giá trị
// TINH_TRANG_VALUES (data/pipelineTinhTrang.js). Dùng chung: bộ lọc Danh sách đơn hàng (routes/orders.js) + bảng "Theo
// khách hàng" ở Thống kê (routes/dashboard.js). Thêm trạng thái mới vào hệ thống thì phải hỏi người dùng xếp vào nhóm nào.
const NHOM_LOC_TONG_QUAT = {
  DA_SAN_XUAT: ['Đã sản xuất', 'ĐÃ DÁN TEM'],
  CHUA_SAN_XUAT: ['Chưa in mã', 'Đã in mã', 'LỖI SẢN XUẤT CẦN LÀM LẠI', 'ĐÃ SẴN SÀNG CHẠY MÁY', 'Đang chạy máy'],
  GIAO_HOAN_HUY: ['DELIVERED_Đã giao đến khách', 'CANCELLED_Đã hủy', 'REFUNDED_Hoàn đơn'],
};

const TAB = 'Don_Hang_ALL';
const KEY_COL = 'STT_Key';

// Mặc định đọc qua cache (nhanh, dữ liệu có thể cũ tối đa 10s) — dùng cho hiển thị/kiểm tra. Chỉ
// giúp các màn hình XEM (danh sách, dashboard, báo cáo) đỡ tốn quota khi nhiều người cùng xem —
// KHÔNG ảnh hưởng các thao tác GHI (update() luôn tự đọc fresh riêng, xem bên dưới).
// Truyền { fresh: true } để BẮT BUỘC đọc thật từ Google Sheets — LUÔN dùng trước khi ghi (update())
// để không bao giờ ghi nhầm dòng nếu vừa có ai thêm/xoá dòng khác ở nơi khác.
//
// GỘP thêm các cột APP TỰ GHI từ SQLite (bổ sung 18/09/2026, xem
// docs/superpowers/specs/2026-09-18-chuyen-cot-app-ghi-sang-sqlite-design.md — THAY cho việc các cột
// này từng là cột tĩnh trong CHÍNH Don_Hang_ALL) theo STT_Key — KHÔNG theo số dòng vật lý, nên dữ liệu
// không còn thể "lạc chủ" dù Don_Hang_ALL (công thức QUERY/VSTACK sống, xem layTatCa ở trangThaiDbService)
// xáo trộn dòng bất cứ lúc nào. Đơn chưa từng có dòng trong SQLite (đơn mới) nhận toàn bộ giá trị rỗng —
// đúng hành vi cũ khi các cột này còn là ô trống trong Sheet.
async function getAll({ fresh = false, ttlMs = 10000 } = {}) {
  const { headers, rows } = fresh ? await readTab(TAB) : await readTabCached(TAB, ttlMs);
  const banDoTrangThai = trangThaiDbService.layTatCa();
  const rowsGop = rows
    // Lọc bỏ dòng KHÔNG có STT_Key (bổ sung 21/09/2026, theo yêu cầu người dùng) — Don_Hang_ALL là công
    // thức QUERY/VSTACK sống, có thể kéo theo cả dòng trống/dòng đệm từ các sheet RAW con (ảnh chụp
    // thực tế: mọi cột đều rỗng — "Lên đơn: —", "SL:", "Xưởng (chưa gán)"). STT_Key là khoá DUY NHẤT
    // mọi nơi trong app dùng để định danh 1 đơn (ghi trạng thái, quét QR, log, nhóm Đơn hàng loạt,
    // tracking...) — dòng không có khoá này không thể thao tác được gì, coi như rác dữ liệu ở BẤT KỲ
    // đâu đọc qua getAll(), không chỉ riêng trang Danh sách đơn hàng đang thấy lỗi.
    .filter(r => String(r[KEY_COL] || '').trim() !== '')
    .map(r => ({
      ...r,
      ...(banDoTrangThai.get(String(r[KEY_COL] || '').trim()) || trangThaiDbService.RONG_MAC_DINH),
    }))
    // Lọc bỏ đơn đã bấm "Xoá dữ liệu đơn hàng" (CHỈ superadmin, bổ sung 20/09/2026 — xem
    // services/xoaDuLieuDonService.js) — dòng RAW gốc trên Sheets vẫn còn (không xoá được, xem lý do
    // trong file trên) nhưng với TOÀN BỘ app (danh sách, dashboard, báo cáo...) coi như đã biến mất.
    .filter(r => r.DA_XOA !== 'TRUE');
  tuGanXuongTheoTeam(rowsGop);
  dongBoDaMuaTracking(rowsGop);
  dongBoCanhBaoTinhTrang(rowsGop);
  return { headers, rows: rowsGop };
}

// DA_MUA_TRACKING (29/09/2026, quy tắc đã xác nhận với người dùng):
//   YES = chính đơn này mua tracking qua hệ thống (TRACKING_ID có, KHÔNG phải bản sao DonNhieuAo), hoặc app
//         chưa mua nhưng Sheet Seller đã có mã (TRACKING_ID2 — Seller tự điền / đơn cũ).
//   NO  = còn lại, gồm: đơn con DonNhieuAo dùng chung tracking của đơn mua (TRACKING_CHUNG_CUA), đơn đang chờ
//         tem GKE (chưa có mã thật — TAM_THOI).
//   DonNhieuAo: đơn con có mã Seller nhưng app CHƯA sao tracking xuống vẫn YES (theo mã của chính nó) — sao xuống
//   rồi (TRACKING_CHUNG_CUA) thì NO. Nhóm không xác định được đơn ".1" cũng tính riêng từng đơn (có ghi chú, bên dưới).
function tinhDaMuaTracking(r) {
  const daMua = r.TRACKING_ID ? !r.TRACKING_CHUNG_CUA : !!String(r.TRACKING_ID2 || '').trim();
  return daMua ? 'YES' : 'NO';
}

// Lý do của giá trị DA_MUA_TRACKING — hiện ở Chi tiết đơn, và ở Danh sách đơn hàng cho đơn thuộc nhóm lỗi.
// `nhom`: nhóm DonNhieuAo của đơn (donNhieuAoService.xayDungBanDoNhom), null nếu đơn lẻ.
function lyDoDaMuaTracking(r, nhom) {
  let lyDo;
  if (r.TRACKING_ID && r.TRACKING_CHUNG_CUA) lyDo = `Dùng chung tracking của đơn ${r.TRACKING_CHUNG_CUA} (DonNhieuAo) — đơn này không mua riêng.`;
  else if (r.TRACKING_ID) lyDo = 'Đơn có mã tracking riêng trong hệ thống (TRACKING_ID).';
  else if (String(r.TRACKING_ID2 || '').trim()) lyDo = 'Theo mã tracking Seller điền trong Sheet (TRACKING_ID2) — hệ thống không mua.';
  else if (r.TAM_THOI) lyDo = 'Đã tạo vận đơn GKE nhưng đang chờ tem — chưa có mã tracking.';
  else lyDo = 'Chưa có mã tracking.';
  if (nhom && !nhom.donMua) {
    lyDo += ` Nhóm cùng OrderID ${nhom.orderId} chưa xác định được đơn ".1" (${nhom.loiChan.join(' ')}) nên mỗi đơn tính riêng theo mã của chính nó.`;
  }
  return lyDo;
}

// Ghi lại DA_MUA_TRACKING cho đơn nào đang lệch — cùng khuôn tuGanXuongTheoTeam: bắt được cả thay đổi phía Sheet
// Seller (TRACKING_ID2, app không có lượt ghi nào để móc vào) và tự điền cho đơn cũ ở lần đọc đầu sau deploy.
// Không ghi lịch sử: việc mua/sao tracking gốc đã có log riêng. Lỗi ghi không làm hỏng việc đọc — lượt sau thử lại.
function dongBoDaMuaTracking(rows) {
  const canGhi = new Map();
  for (const r of rows) {
    const giaTri = tinhDaMuaTracking(r);
    if (r.DA_MUA_TRACKING !== giaTri) canGhi.set(String(r[KEY_COL]).trim(), giaTri);
    r.DA_MUA_TRACKING = giaTri;
  }
  if (canGhi.size === 0) return;
  try {
    trangThaiDbService.ghiDeNhieu([...canGhi].map(([sttKey, giaTri]) => [sttKey, { DA_MUA_TRACKING: giaTri }]));
  } catch (err) {
    console.error('[Orders] Lỗi đồng bộ DA_MUA_TRACKING:', err.message);
  }
}

// Tự gán Xưởng theo Team (bổ sung 27/09/2026, theo yêu cầu người dùng): MỌI đơn đang "chưa gán" (XUONG
// rỗng) thuộc Team đã cấu hình ở Settings (caiDatDbService.js#layTeamXuongMacDinh) được ghi Xưởng đó vào
// SQLite ngay lúc đọc — đơn mới về từ Sheet có Xưởng ở lần đọc kế tiếp. Chỉ đụng đơn đang trống: đổi cấu
// hình KHÔNG chuyển đơn đã gán (đã xác nhận với người dùng). Team chưa cấu hình -> giữ nguyên "chưa gán".
// Đồng bộ hoàn toàn (không await) -> 2 lượt getAll() chạy song song không gán/ghi log trùng.
function tuGanXuongTheoTeam(rows) {
  const banDo = layTeamXuongMacDinh();
  if (Object.keys(banDo).length === 0) return;
  const donCanGan = [];
  const canGan = new Map(); // sttKey -> { xuong, team } — Sheet lỡ trùng STT_Key vẫn chỉ ghi/log 1 lần
  for (const r of rows) {
    if (r.XUONG) continue;
    const team = donNhieuAoService.layTeam(r[KEY_COL]);
    if (!team || !banDo[team]) continue;
    donCanGan.push([r, banDo[team]]);
    canGan.set(String(r[KEY_COL]).trim(), { xuong: banDo[team], team });
  }
  if (canGan.size === 0) return;
  // Lỗi ghi ở đây KHÔNG được làm hỏng việc đọc đơn của cả app — đơn giữ "chưa gán", lượt đọc sau thử lại.
  try {
    trangThaiDbService.ghiDeNhieu([...canGan].map(([sttKey, { xuong }]) => [sttKey, { XUONG: xuong }]));
  } catch (err) {
    console.error('[Orders] Lỗi tự gán Xưởng theo Team:', err.message);
    return;
  }
  donCanGan.forEach(([r, xuong]) => { r.XUONG = xuong; });
  try {
    require('./logService').ghiLogNhieu([...canGan].map(([sttKey, { xuong, team }]) => ({
      nguoiDung: 'Hệ thống', vaiTro: '', hanhDong: 'GAN_XUONG', sttKey,
      chiTiet: { tuXuong: '', sangXuong: xuong, lyDo: `Tự gán theo Team ${team}` },
    })));
  } catch (err) {
    console.error('[Orders] Lỗi ghi log tự gán Xưởng theo Team:', err.message);
  }
  console.log(`[Orders] Tự gán Xưởng theo Team cho ${canGan.size} đơn`);
}

async function getByKey(sttKey, opts) {
  const { headers, rows } = await getAll(opts);
  const row = rows.find(r => r[KEY_COL] === sttKey);
  return { headers, row };
}

// Đọc TOÀN BỘ sheet ĐÚNG 1 LẦN rồi tra theo danh sách sttKeys — dùng cho các thao tác HÀNG LOẠT
// (chuyển trạng thái, chỉ định người chạy máy/vẽ file, gán Xưởng, xác nhận quét hàng loạt, mua
// tracking/in label hàng loạt...). Trước đây mỗi đơn trong lô tự gọi getByKey(sttKey, {fresh:true})
// RIÊNG trong vòng lặp — chọn N đơn để thao tác hàng loạt là N lượt đọc TOÀN BỘ sheet (bất kể sheet có
// bao nhiêu dòng), dù mỗi lượt chỉ cần đúng 1 dòng trong đó — đây chính là nguyên nhân gây vượt quota
// Google Sheets API khi thao tác hàng loạt nhiều đơn cùng lúc (bổ sung 13/09/2026, theo yêu cầu người
// dùng sau khi thực tế gặp lỗi "tạm quá tải", xem thêm services/sheetsService.js#goiApiCoThuLai).
// ĐÁNH ĐỔI đã xác nhận với người dùng: dữ liệu của TỪNG đơn trong lô "cũ" tối đa bằng thời gian xử lý
// CẢ LÔ (thường vài giây, tuỳ số đơn) thay vì luôn tuyệt đối mới nhất ngay trước khi ghi từng đơn —
// chấp nhận được với quy mô đội hiện tại (rủi ro: nếu đúng lúc đang xử lý lô mà có người KHÁC sửa
// đúng 1 đơn nằm trong lô đó ở nơi khác, đơn đó dùng dữ liệu "cũ" vài giây thay vì mới nhất).
async function getManyByKeys(sttKeys, opts) {
  const { headers, rows } = await getAll(opts);
  const banDoTheoKey = new Map(rows.map(r => [r[KEY_COL], r]));
  return { headers, banDoTheoKey };
}

const idxSanSang = chiSoTinhTrang('ĐÃ SẴN SÀNG CHẠY MÁY');

// Kiểm tra GIÁ TRỊ hợp lệ cho từng cột riêng lẻ (đúng 1 trong các giá trị định nghĩa sẵn) — chặn
// việc ghi nhầm chuỗi rác/gõ sai chính tả. LƯU Ý: route PUT /orders/:sttKey (sửa 1 đơn) trước đây
// KHÔNG kiểm tra gì cả — có thể ghi bất kỳ chuỗi nào vào thẳng Sheet; route chuyển hàng loạt đã có
// kiểm tra riêng (GIA_TRI_HOP_LE_THEO_COT) nhưng đặt kiểm tra ở ĐÂY (update(), điểm ghi chung duy
// nhất) để CHẮC CHẮN áp dụng cho MỌI đường ghi, kể cả những chỗ lỡ quên tự kiểm tra.
function kiemTraGiaTriHopLe(updates) {
  if ('TRANG_THAI_XUONG' in updates && !TINH_TRANG_VALUES.includes(updates.TRANG_THAI_XUONG)) {
    throw new Error(`Giá trị TRANG_THAI_XUONG không hợp lệ: "${updates.TRANG_THAI_XUONG}"`);
  }
  if ('TRANG_THAI_PHOI' in updates && !TRANG_THAI_PHOI_VALUES.includes(updates.TRANG_THAI_PHOI)) {
    throw new Error(`Giá trị TRANG_THAI_PHOI không hợp lệ: "${updates.TRANG_THAI_PHOI}"`);
  }
  if ('TRANG_THAI_VE_FILE' in updates && !TRANG_THAI_VE_FILE_VALUES.includes(updates.TRANG_THAI_VE_FILE)) {
    throw new Error(`Giá trị TRANG_THAI_VE_FILE không hợp lệ: "${updates.TRANG_THAI_VE_FILE}"`);
  }
  if ('XUONG' in updates && updates.XUONG && !layDanhSachXuong().includes(updates.XUONG)) {
    throw new Error(`Giá trị XUONG không hợp lệ: "${updates.XUONG}" — chỉ chấp nhận: ${layDanhSachXuong().join(', ')}`);
  }
  if ('DON_UU_TIEN' in updates && !['TRUE', 'FALSE'].includes(updates.DON_UU_TIEN)) {
    throw new Error(`Giá trị DON_UU_TIEN không hợp lệ: "${updates.DON_UU_TIEN}" — chỉ chấp nhận TRUE hoặc FALSE.`);
  }
}

// Kiểm tra tính HỢP LÝ giữa 3 cột VỚI NHAU — không chỉ đúng giá trị từng cột riêng lẻ mà còn phải
// khớp logic pipeline. 2 quy tắc:
//   1. "Chưa in mã" thì KHÔNG THỂ lấy phôi (vẽ file được — độc lập với in mã từ 28/09/2026, xem bên dưới).
//   2. Đã tới "ĐÃ SẴN SÀNG CHẠY MÁY" hoặc các bước SAU đó trên đường chính (Đã sản xuất, Đã đóng
//      gói, ĐÃ DÁN TEM, DELIVERED) thì BẮT BUỘC phải có đủ CẢ phôi lẫn file — không tính LỖI SẢN
//      XUẤT CẦN LÀM LẠI/CANCELLED/REFUNDED (nhánh rẽ, không nằm trong THU_TU_TINH_TRANG nên
//      chiSoTinhTrang trả về null, CỐ Ý bỏ qua quy tắc này — lúc lỗi cần được phép reset phôi/file
//      về "chưa" để làm lại từ đầu, xem tinhTinhTrangTuDong ở trên và README).
// Chỉ kiểm tra khi updates THỰC SỰ đụng tới 1 trong 3 cột — sửa các trường khác (GHI_CHU, HANG_VAN_
// CHUYEN...) không bao giờ bị chặn bởi hàm này, kể cả khi dữ liệu cũ của đơn đó lỡ đã sai từ trước.
function kiemTraTinhHopLy(rowHienTai, updates) {
  const dungChamPipeline = 'TRANG_THAI_XUONG' in updates || 'TRANG_THAI_PHOI' in updates || 'TRANG_THAI_VE_FILE' in updates;
  if (!dungChamPipeline) return;

  const tinhTrangMoi = updates.TRANG_THAI_XUONG ?? rowHienTai.TRANG_THAI_XUONG;
  const phoiMoi = updates.TRANG_THAI_PHOI ?? rowHienTai.TRANG_THAI_PHOI;
  const veFileMoi = updates.TRANG_THAI_VE_FILE ?? rowHienTai.TRANG_THAI_VE_FILE;

  // Lấy phôi PHỤ THUỘC in mã (phải có mã in ra để nhận diện đúng phôi) — vẽ file thì ĐỘC LẬP với in mã (28/09/2026,
  // theo yêu cầu người dùng: bỏ quy tắc cũ "Chưa in mã thì vẽ file phải Chưa vẽ file"). Chỉ chặn khi CHÍNH lần ghi
  // này tạo ra tổ hợp "Chưa in mã + Đã lấy phôi" (lấy phôi mới, hoặc đưa đơn đã có phôi về "Chưa in mã") — đơn cũ
  // lỡ lấy phôi trước khi in mã (18/09-28/09, trạng thái chung còn trống nên quy tắc không chạy) vẫn cập nhật vẽ
  // file / in mã bình thường, không bị kẹt (đã xác nhận với người dùng: giữ nguyên, cho làm tiếp).
  if (tinhTrangMoi === 'Chưa in mã' && phoiMoi === 'Đã lấy phôi') {
    const vuaLayPhoi = updates.TRANG_THAI_PHOI === 'Đã lấy phôi' && rowHienTai.TRANG_THAI_PHOI !== 'Đã lấy phôi';
    const vuaVeChuaInMa = updates.TRANG_THAI_XUONG === 'Chưa in mã' && rowHienTai.TRANG_THAI_XUONG !== 'Chưa in mã';
    if (vuaLayPhoi || vuaVeChuaInMa) {
      throw new Error('Không hợp lệ: đơn đang "Chưa in mã" thì chưa thể "Đã lấy phôi" — in mã đơn trước.');
    }
  }

  const idx = chiSoTinhTrang(tinhTrangMoi);
  if (idx !== null && idx >= idxSanSang) {
    if (phoiMoi !== 'Đã lấy phôi') {
      throw new Error(`Không hợp lệ: đơn đang/sắp ở "${tinhTrangMoi}" nhưng phôi vẫn "${phoiMoi}" — phải có đủ phôi mới tới được giai đoạn này.`);
    }
    if (veFileMoi !== 'Đã vẽ file') {
      throw new Error(`Không hợp lệ: đơn đang/sắp ở "${tinhTrangMoi}" nhưng file vẽ vẫn "${veFileMoi}" — phải vẽ xong file mới tới được giai đoạn này.`);
    }
  }
}

// TỰ ĐỘNG điền TRANG_THAI_PHOI = 'Chưa lấy phôi' và TRANG_THAI_VE_FILE = 'Chưa vẽ file' khi đơn được
// in mã (TRANG_THAI_XUONG chuyển từ 'Chưa in mã' sang 'Đã in mã') — đơn vừa in mã thì chưa ai
// kịp lấy phôi/vẽ file, nên đặt sẵn 2 cột này về "chưa" luôn, không phải set tay riêng. Không ghi đè
// nếu người gọi đã tự chỉ định 1 trong 2 cột này trong chính updates đó. Chỉ áp dụng đúng lượt
// chuyển 'Chưa in mã' -> 'Đã in mã' (không áp dụng khi TRANG_THAI_XUONG đang set lại 'Đã in mã'
// từ trạng thái khác, vd sau khi lỗi sản xuất).
function tinhPhoiVeFileTuDongKhiInMa(rowHienTai, updates) {
  if (updates.TRANG_THAI_XUONG !== 'Đã in mã' || rowHienTai.TRANG_THAI_XUONG !== 'Chưa in mã') return updates;

  // GIỮ tiến độ đã có (sửa 28/09/2026): từ 18/09 tới 28/09 đơn mới mang TRANG_THAI_XUONG '' nên được lấy phôi/vẽ
  // file TRƯỚC khi in mã — đặt cứng "Chưa..." ở đây sẽ xoá mất tiến độ đó (và hoàn kho phôi) lúc bấm in mã. Đơn đúng
  // quy trình vốn đang "Chưa..." nên kết quả không đổi.
  const ketQua = { ...updates };
  if (!('TRANG_THAI_PHOI' in ketQua)) ketQua.TRANG_THAI_PHOI = rowHienTai.TRANG_THAI_PHOI || 'Chưa lấy phôi';
  if (!('TRANG_THAI_VE_FILE' in ketQua)) ketQua.TRANG_THAI_VE_FILE = rowHienTai.TRANG_THAI_VE_FILE || 'Chưa vẽ file';
  return ketQua;
}

// TỰ ĐỘNG chuyển TRANG_THAI_XUONG sang "ĐÃ SẴN SÀNG CHẠY MÁY" khi cả phôi lẫn file vẽ CÙNG xong — nhưng
// CHỈ áp dụng lần đầu (khi TRANG_THAI_XUONG đang là "Đã in mã"). Sau khi đơn bị lỗi rồi làm lại từ phôi/
// file, việc quay lại "ĐÃ SẴN SÀNG CHẠY MÁY" lần 2 KHÔNG tự động — người phụ trách phải tự set tay
// (đã xác nhận rõ với người dùng, xem data/pipelineTinhTrang.js). Hàm này không tự đổi TRANG_THAI_XUONG
// nếu người gọi đã tự chỉ định TRANG_THAI_XUONG trong chính updates đó — tôn trọng giá trị người dùng
// muốn set tay, không ghi đè.
// Sửa 25/09/2026, theo yêu cầu người dùng: (1) TRANG_THAI_XUONG gửi lên TRÙNG giá trị đang có KHÔNG còn
// tính là "tự set" — ô "Sửa trạng thái thủ công" ở order.html luôn gửi cả 3 cột, trước đây khiến đơn
// kẹt ở "Đã in mã" dù đã đủ phôi + file; (2) người gọi CHỦ ĐỘNG đặt về "Đã in mã" (vd từ LỖI SẢN XUẤT)
// mà phôi + file đều đã xong cũng tự chuyển tiếp sang "ĐÃ SẴN SÀNG CHẠY MÁY" luôn.
function tinhTinhTrangTuDong(rowHienTai, updates) {
  const tinhTrangDich = updates.TRANG_THAI_XUONG ?? rowHienTai.TRANG_THAI_XUONG;
  if (tinhTrangDich !== 'Đã in mã') return updates;

  const phoiMoi = updates.TRANG_THAI_PHOI ?? rowHienTai.TRANG_THAI_PHOI;
  const veFileMoi = updates.TRANG_THAI_VE_FILE ?? rowHienTai.TRANG_THAI_VE_FILE;
  const caPhoiVaFileXong = phoiMoi === 'Đã lấy phôi' && veFileMoi === 'Đã vẽ file';

  if (caPhoiVaFileXong) {
    return { ...updates, TRANG_THAI_XUONG: 'ĐÃ SẴN SÀNG CHẠY MÁY' };
  }
  return updates;
}

// "Đã sản xuất" và "ĐÃ DÁN TEM" chỉ được đặt qua đúng luồng đã xác nhận — CẢ 2 đều qua chụp ảnh QR
// (routes/photos.js, gọi update() với tuyChon.quaAnh = true): "Đã sản xuất" mốc da_san_xuat, "ĐÃ DÁN
// TEM" mốc da_dan_tem (đổi từ "Quét mã QR Tracking" gọi GKE thật sang thuần ảnh 09/09/2026 lần 4, theo
// yêu cầu người dùng — xem routes/photos.js). Chặn MỌI đường khác (ô "Sửa trạng thái thủ công" ở order.html, chuyển hàng loạt...)
// — bất kể đơn đang ở trạng thái nào trước đó. Từ 03/10/2026 CHỈ superadmin còn ghi đè được cả 2 giá trị
// (lối thoát khi máy ảnh/QR hỏng); admin phải chụp ảnh như các vai trò khác (theo yêu cầu người dùng).
// (Bổ sung 09/09/2026 lần 3, XOÁ "Đã đóng gói" — xem data/pipelineTinhTrang.js): riêng "ĐÃ DÁN TEM",
// admin sửa tay KHÔNG được miễn trừ điều kiện trạng thái NGUỒN như "Đã sản xuất" — xem
// TRANG_THAI_NGUON_HOP_LE_CHO_DAN_TEM bên dưới, kiểm tra TRƯỚC cả nhánh admin, áp dụng cho MỌI người gọi.
// CHỈ chặn khi đây là 1 CHUYỂN ĐỔI THẬT (giá trị mới khác giá trị đang có) — ô "Sửa trạng thái thủ
// công" ở order.html luôn gửi cả 3 cột TRANG_THAI_XUONG/PHOI/VE_FILE cùng lúc kể cả khi người dùng chỉ định
// sửa 1 trong 2 cột kia, nên KHÔNG được chặn nhầm khi TRANG_THAI_XUONG gửi lên trùng với giá trị hiện tại.
const TRANG_THAI_BAT_BUOC_CHUP_ANH = ['Đã sản xuất', 'ĐÃ DÁN TEM'];

// Trạng thái NGUỒN hợp lệ để được set "ĐÃ DÁN TEM" — ÁP DỤNG CHO MỌI NGƯỜI GỌI, kể cả admin sửa tay
// (khác hẳn cơ chế quaAnh/admin-bypass ở kiemTraCongAnhBatBuoc, vốn miễn trừ hoàn toàn cho admin).
// Theo đúng yêu cầu người dùng: "Đã sản xuất" là nguồn hợp lệ duy nhất; tự cho phép giữ nguyên "ĐÃ DÁN
// TEM" (không coi là vi phạm) để không chặn lượt quét lại in tem/lưu lại đúng giá trị cũ.
const TRANG_THAI_NGUON_HOP_LE_CHO_DAN_TEM = ['Đã sản xuất', 'ĐÃ DÁN TEM'];

function kiemTraCongAnhBatBuoc(rowHienTai, updates, user, quaAnh) {
  if (!('TRANG_THAI_XUONG' in updates)) return;
  if (updates.TRANG_THAI_XUONG === rowHienTai.TRANG_THAI_XUONG) return; // gửi lại đúng giá trị cũ — không phải chuyển đổi

  if (updates.TRANG_THAI_XUONG === 'ĐÃ DÁN TEM') {
    if (!TRANG_THAI_NGUON_HOP_LE_CHO_DAN_TEM.includes(rowHienTai.TRANG_THAI_XUONG)) {
      throw new Error(`Không hợp lệ: đơn đang "${rowHienTai.TRANG_THAI_XUONG}" — phải đang "Đã sản xuất" mới chuyển sang "ĐÃ DÁN TEM" được.`);
    }
    // Bổ sung 09/09/2026 lần 5, theo yêu cầu người dùng: đơn CHƯA có thông tin Tracking (mã vận đơn
    // thật) thì KHÔNG được chuyển sang "ĐÃ DÁN TEM" — kể cả qua "Chụp ảnh ĐÃ DÁN TEM" (mục 12) lẫn admin
    // sửa tay, không có ngoại lệ, cùng tinh thần TRANG_THAI_NGUON_HOP_LE_CHO_DAN_TEM ở trên. Phải mua
    // tracking trước (nút "Mua Tracking"/"MUA TRACKING và IN LABEL") rồi mới chụp ảnh/đánh dấu được.
    // Lấy giá trị TRACKING_ID SAU KHI áp dụng updates này (nếu updates có tự set TRACKING_ID trong CÙNG
    // lượt gọi, dùng giá trị đó — hiện chưa có luồng nào làm vậy nhưng để đúng cho mọi trường hợp sau
    // này) — ?? rowHienTai.TRACKING_ID nếu updates không đụng tới cột này. Từ 12/09/2026 lần 14,
    // TRACKING_ID KHÔNG còn khi nào mang giá trị placeholder "chờ tem" nữa (chuyển hẳn sang cột TAM_THOI
    // — xem services/trackingAutoService.js) nên chỉ cần kiểm tra rỗng/không rỗng, không cần so khớp
    // hằng số placeholder ở đây nữa.
    const trackingSauKhiGhi = updates.TRACKING_ID ?? rowHienTai.TRACKING_ID;
    if (!trackingSauKhiGhi) {
      throw new Error('Không hợp lệ: đơn chưa có thông tin Tracking (mã vận đơn thật) — phải mua tracking trước khi chuyển sang "ĐÃ DÁN TEM".');
    }
  }

  if (quaAnh) return;
  // 03/10/2026, theo yêu cầu người dùng: CHỈ superadmin còn được set tay — admin phải đi đúng luồng chụp ảnh
  // (ảnh đã sản xuất -> "Đã sản xuất", ảnh dán tem -> "ĐÃ DÁN TEM"). Đơn cũ đang ở 2 trạng thái này không bị
  // ảnh hưởng (chỉ chặn CHUYỂN ĐỔI mới, không kiểm tra ảnh của đơn đã nằm sẵn ở đó).
  if (user && laSuperAdmin(user.vaiTro)) return;

  if (TRANG_THAI_BAT_BUOC_CHUP_ANH.includes(updates.TRANG_THAI_XUONG)) {
    throw new Error(
      `Chuyển sang "${updates.TRANG_THAI_XUONG}" bắt buộc phải chụp ảnh QR/quét QR Tracking ở trang Quét QR — vai trò này không set tay được.`
    );
  }
}

// Xếp hàng theo STT_Key (bổ sung 20/09/2026, phát hiện qua rà soát bảo mật) — 2 lượt gọi update() cho
// CÙNG 1 đơn gần như đồng thời (vd 2 người quét song song "lấy phôi"/"vẽ file" — đúng tinh thần 2 việc
// ĐỘC LẬP chạy song song mà data/pipelineTinhTrang.js mô tả) đều tự đọc "row" TRƯỚC khi lượt còn lại
// kịp ghi xong, nên mỗi lượt tự tính tinhTinhTrangTuDong() dựa trên dữ liệu CŨ của trường bên kia — có
// thể bỏ lỡ hẳn việc tự chuyển "ĐÃ SẴN SÀNG CHẠY MÁY" dù cả 2 việc thật ra đã xong cùng lúc. KHOÁ THEO
// TỪNG ĐƠN (không khoá toàn cục — các đơn khác nhau vẫn chạy song song bình thường, không chậm đi) qua
// nối chuỗi Promise: lượt gọi SAU luôn đợi lượt gọi TRƯỚC (cùng STT_Key) ghi xong rồi mới bắt đầu đọc
// "row" của chính nó, nên luôn thấy đúng kết quả mới nhất của lượt trước.
const _hangDoiTheoDon = new Map(); // sttKey -> Promise của lượt update() gần nhất đang xếp hàng
function xepHangTheoDon(sttKey, congViec) {
  const hangCho = (_hangDoiTheoDon.get(sttKey) || Promise.resolve()).catch(() => {}); // lượt trước lỗi cũng không chặn lượt sau
  const luotNay = hangCho.then(congViec);
  _hangDoiTheoDon.set(sttKey, luotNay);
  luotNay.catch(() => {}).finally(() => {
    // Chỉ tự dọn nếu vẫn là lượt MỚI NHẤT cho key này — nếu đã có lượt khác xếp hàng sau, để nguyên.
    if (_hangDoiTheoDon.get(sttKey) === luotNay) _hangDoiTheoDon.delete(sttKey);
  });
  return luotNay;
}

async function update(sttKey, updates, user, tuyChon = {}) {
  return xepHangTheoDon(sttKey, () => capNhatThat(sttKey, updates, user, tuyChon));
}

async function capNhatThat(sttKey, updates, user, tuyChon) {
  // tuyChon.donDaDoc cho phép truyền sẵn {headers, row} đã đọc fresh ngay trước đó (vd routes/qr.js
  // vừa getByKey({fresh:true}) để kiểm tra trạng thái trước khi quyết định có gọi update() hay
  // không) — bỏ qua việc đọc lại y hệt lần nữa (đỡ tốn quota Sheets, đặc biệt cho luồng quét QR hàng
  // loạt, trước đây mỗi mã quét tốn TỚI 2 lượt đọc toàn bộ tab Don_Hang_ALL thay vì 1).
  const { row: rowDaDoc } = tuyChon.donDaDoc || await getByKey(sttKey, { fresh: true }); // luôn đọc thật trước khi ghi
  if (!rowDaDoc) throw new Error('Không tìm thấy đơn hàng: ' + sttKey);

  // Đè lại đúng các cột trạng thái app-ghi (trangThaiDbService — KHÔNG phải cột từ Sheets) bằng bản
  // MỚI NHẤT tại thời điểm ĐÃ VÀO ĐẾN LƯỢT (sau xepHangTheoDon() ở trên) — bổ sung 20/09/2026, cùng
  // đợt sửa với lock ở trên. rowDaDoc (nếu qua donDaDoc) có thể đã được đọc TỪ TRƯỚC KHI xếp hàng —
  // dữ liệu Sheets bên trong (tên khách, sản phẩm...) vẫn đáng tin (đó là lý do donDaDoc tồn tại — để
  // đỡ đọc lại Sheets), nhưng các cột trạng thái cần MỚI NHẤT để tinhTinhTrangTuDong() bên dưới không
  // bỏ lỡ auto-transition khi 2 lượt cập nhật (vd lấy phôi + vẽ file) cho CÙNG đơn xếp hàng sát nhau —
  // đọc lại đây RẺ (SQLite tại chỗ, không tốn quota Sheets như getByKey({fresh:true})) nên luôn làm.
  const row = { ...rowDaDoc, ...trangThaiDbService.layTheoKey(sttKey) };

  // tuyChon.yeuCauDangLa ({ COT: 'giá trị' }, bổ sung 28/09/2026 — nút lớn ở Chi tiết đơn): chỉ ghi nếu đơn VẪN
  // đang đúng giá trị đó, kiểm tra TRONG lượt khoá theo đơn — người khác vừa đổi thì báo lỗi, không ghi đè.
  for (const [cot, giaTri] of Object.entries(tuyChon.yeuCauDangLa || {})) {
    if ((row[cot] || '') !== giaTri) {
      throw new Error(`Đơn đang "${row[cot] || '(trống)'}", không còn "${giaTri}" — có người vừa đổi trạng thái, tải lại trang để xem.`);
    }
  }

  // tuyChon.boQuaRangBuoc (bổ sung 25/09/2026) — CHỈ route POST /orders/chuyen-trang-thai-superadmin
  // truyền (superadmin, đã kiểm tra quyền ở route): bỏ qua cổng ảnh bắt buộc, điều kiện nguồn/tracking
  // của "ĐÃ DÁN TEM", tự chuyển trạng thái và kiểm tra tính hợp lý — đặt ĐÚNG trạng thái được chọn.
  const boQua = tuyChon.boQuaRangBuoc === true;

  kiemTraGiaTriHopLe(updates);
  if (!boQua) kiemTraCongAnhBatBuoc(row, updates, user, tuyChon.quaAnh);

  const updatesSauInMa = tinhPhoiVeFileTuDongKhiInMa(row, updates);
  const updatesDaTinh = boQua ? updatesSauInMa : tinhTinhTrangTuDong(row, updatesSauInMa);

  // Ảnh mẫu đổi thì hash cũ không còn đúng nữa — xoá để lượt "Quét tìm đơn hàng loạt" kế tiếp
  // (routes/orders.js) tính lại, tránh nhóm hàng loạt sai lặng lẽ theo ảnh cũ đã không còn tồn tại.
  // HASH_ANH_MAU/NHOM_HANG_LOAT giờ ở SQLite (xem trangThaiDbService.js), LUÔN có sẵn trong schema —
  // bỏ guard headers.includes(...) cũ (từng cần vì 2 cột này có thể chưa được thêm vào Sheet).
  if (
    updatesDaTinh.DUONG_DAN_URL !== undefined &&
    updatesDaTinh.DUONG_DAN_URL !== row.DUONG_DAN_URL &&
    updatesDaTinh.HASH_ANH_MAU === undefined
  ) {
    updatesDaTinh.HASH_ANH_MAU = '';
    updatesDaTinh.NHOM_HANG_LOAT = '';
  }

  // Đơn VỪA chuyển sang "Đang chạy máy" (từ 1 trạng thái KHÁC) — ghi lại AI đang vận hành thẳng vào
  // cột NGUOI_CHAY_MAY (thay cho dò lịch sử hoạt động như trước — xem
  // docs/superpowers/specs/2026-09-07-nguoi-chay-may-design.md). Áp dụng cho MỌI đường ghi đi qua
  // update() này — quét QR, đổi trạng thái hàng loạt, sửa tay 1 đơn.
  // Nếu người gọi đã TỰ truyền sẵn NGUOI_CHAY_MAY trong chính updates (nhánh admin chỉ định người
  // KHÁC chạy máy, xem routes/orders.js POST /chi-dinh-nguoi-chay-may) thì GIỮ NGUYÊN giá trị đó,
  // không ghi đè bằng người đang thao tác — ngược lại (ai đó tự đổi trạng thái đơn của chính họ) thì
  // tự stamp NGUOI_CHAY_MAY = người đang thao tác, đồng thời xoá ghi chú cũ (nếu có, từ lượt chạy
  // trước) vì đây là 1 lượt gán MỚI, không phải tiếp nối lượt cũ.
  if (
    updatesDaTinh.TRANG_THAI_XUONG === 'Đang chạy máy' &&
    row.TRANG_THAI_XUONG !== 'Đang chạy máy' &&
    updatesDaTinh.NGUOI_CHAY_MAY === undefined
  ) {
    updatesDaTinh.NGUOI_CHAY_MAY = (user && user.ten) || '';
    updatesDaTinh.GHI_CHU_CHAY_MAY = '';
  }

  // Đơn VỪA chuyển sang "Đang vẽ file" (từ 1 giá trị KHÁC) — Y HỆT hook NGUOI_CHAY_MAY ở trên, áp
  // dụng cho vẽ file thay vì chạy máy (thêm 08/09/2026, xem
  // docs/superpowers/specs/2026-09-08-trang-thai-dang-ve-file-design.md). Nếu người gọi đã tự truyền
  // sẵn NGUOI_VE_FILE (nhánh admin chỉ định người KHÁC vẽ, routes/orders.js POST
  // /chi-dinh-nguoi-ve-file) thì giữ nguyên, không ghi đè bằng người đang thao tác.
  if (
    updatesDaTinh.TRANG_THAI_VE_FILE === 'Đang vẽ file' &&
    row.TRANG_THAI_VE_FILE !== 'Đang vẽ file' &&
    updatesDaTinh.NGUOI_VE_FILE === undefined
  ) {
    updatesDaTinh.NGUOI_VE_FILE = (user && user.ten) || '';
    updatesDaTinh.GHI_CHU_VE_FILE = '';
  }

  // Đơn VỪA chuyển sang "Đã in mã" (từ 1 giá trị KHÁC) — ghi lại THỜI ĐIỂM này (bổ sung 09/09/2026). Từng là
  // mốc tính giờ của job tự động mua tracking; từ 29/09/2026 job dùng THOI_GIAN_SAN_XUAT bên dưới, mốc này chỉ
  // còn lưu để tra cứu.
  if (
    updatesDaTinh.TRANG_THAI_XUONG === 'Đã in mã' &&
    row.TRANG_THAI_XUONG !== 'Đã in mã'
  ) {
    updatesDaTinh.THOI_GIAN_IN_MA = thoiGianVNISOString();
  }
  // Tương tự cho "Đã sản xuất" (29/09/2026, theo yêu cầu người dùng) — mốc tính giờ chờ TỰ ĐỘNG MUA TRACKING.
  // Mọi đường chuyển sang "Đã sản xuất" (chụp ảnh đã sản xuất, sửa tay, nút superadmin) đều qua đây.
  if (
    updatesDaTinh.TRANG_THAI_XUONG === 'Đã sản xuất' &&
    row.TRANG_THAI_XUONG !== 'Đã sản xuất'
  ) {
    updatesDaTinh.THOI_GIAN_SAN_XUAT = thoiGianVNISOString();
  }
  // Mốc Tự động quét QC (02/10/2026): QC1 tính từ lúc vẽ file xong, QC3 từ lúc ĐÃ DÁN TEM (QC2 dùng THOI_GIAN_SAN_XUAT ở trên).
  if (updatesDaTinh.TRANG_THAI_VE_FILE === 'Đã vẽ file' && row.TRANG_THAI_VE_FILE !== 'Đã vẽ file') {
    updatesDaTinh.THOI_GIAN_VE_FILE = thoiGianVNISOString();
  }
  if (updatesDaTinh.TRANG_THAI_XUONG === 'ĐÃ DÁN TEM' && row.TRANG_THAI_XUONG !== 'ĐÃ DÁN TEM') {
    updatesDaTinh.THOI_GIAN_DAN_TEM = thoiGianVNISOString();
  }

  // DonNhieuAo — huỷ 1 đơn = huỷ CẢ nhóm (bổ sung 26/09/2026, theo yêu cầu người dùng). Chặn nếu trong
  // nhóm đã có đơn gửi đi (ĐÃ DÁN TEM/DELIVERED). Nút superadmin (boQua) KHÔNG áp dụng: đổi đúng các đơn
  // được nhập, không chặn, không kéo theo. getAll() đọc cache Sheets nhưng cột trạng thái luôn mới (SQLite).
  const donHuyTheoNhom = [];
  if (!boQua && updatesDaTinh.TRANG_THAI_XUONG === TRANG_THAI_HUY && row.TRANG_THAI_XUONG !== TRANG_THAI_HUY) {
    const nhom = donNhieuAoService.layNhomCuaDon(sttKey, (await getAll()).rows);
    const cacDonKhac = nhom ? nhom.thanhVien.filter(r => r.STT_Key !== sttKey) : [];
    const daGui = cacDonKhac.filter(r => TRANG_THAI_DA_GUI_DI.includes(r.TRANG_THAI_XUONG));
    if (daGui.length) {
      throw new Error(`Không huỷ được: đơn thuộc nhóm DonNhieuAo ${nhom.goc}, huỷ 1 đơn là huỷ cả nhóm, nhưng đã có đơn gửi đi: ${daGui.map(r => `${r.STT_Key} (${r.TRANG_THAI_XUONG})`).join(', ')}. Superadmin dùng nút CHUYỂN TRẠNG THÁI THỦ CÔNG SUPERADMIN nếu vẫn cần huỷ.`);
    }
    cacDonKhac.filter(r => r.TRANG_THAI_XUONG !== TRANG_THAI_HUY)
      .forEach(r => donHuyTheoNhom.push({ sttKey: r.STT_Key, tu: r.TRANG_THAI_XUONG, goc: nhom.goc }));
  }

  if (!boQua) kiemTraTinhHopLy(row, updatesDaTinh); // kiểm tra SAU khi đã tính tự động, để không báo nhầm khi chính việc tự động hoá làm cho tổ hợp trở nên hợp lệ

  // DA_MUA_TRACKING ghi CÙNG lượt với TRACKING_ID/TRACKING_CHUNG_CUA (mua, sao DonNhieuAo, sửa tay) — không phải đợi
  // lượt getAll() kế tiếp. Không nhận giá trị truyền vào: luôn tính lại từ dữ liệu sau khi ghi.
  delete updatesDaTinh.DA_MUA_TRACKING;
  const daMuaTracking = tinhDaMuaTracking({ ...row, ...updatesDaTinh });
  if (daMuaTracking !== row.DA_MUA_TRACKING) updatesDaTinh.DA_MUA_TRACKING = daMuaTracking;

  // Ghi theo STT_Key (khoá), không phải số dòng vật lý — xem trangThaiDbService.js. Không còn khái
  // niệm "đọc lại số dòng mới nhất trước khi ghi cả lô" nữa (bỏ hẳn layLaiSoDongMoiNhat/soDongMoiNhat,
  // xem docs/superpowers/specs/2026-09-18-chuyen-cot-app-ghi-sang-sqlite-design.md) — SQLite ghi đúng
  // đơn dù Don_Hang_ALL xáo trộn dòng bất cứ lúc nào trước/trong/sau khi hàm này chạy.
  trangThaiDbService.ghiDe(sttKey, updatesDaTinh, { nguoi: user && user.ten });

  // Ghi THẲNG SQLite (không qua update()) cho các đơn cùng nhóm — gọi update() lồng ở đây có thể TREO nếu
  // 2 đơn cùng nhóm được huỷ song song (mỗi lượt đợi lượt kia trong hàng đợi theo đơn). Huỷ không có tác
  // dụng phụ nào khác cần update() (không đụng kho phôi/người chạy máy...).
  if (donHuyTheoNhom.length) {
    const { ghiLog } = require('./logService');
    for (const d of donHuyTheoNhom) {
      trangThaiDbService.ghiDe(d.sttKey, { TRANG_THAI_XUONG: TRANG_THAI_HUY, NguoiCapNhatCuoi: (user && user.ten) || '', ThoiGianCapNhatCuoi: new Date().toISOString() });
      ghiLog({
        nguoiDung: (user && user.ten) || '', vaiTro: (user && user.vaiTro) || '', hanhDong: 'CHUYEN_TRANG_THAI_HANG_LOAT', sttKey: d.sttKey,
        chiTiet: { cot: 'TRANG_THAI_XUONG', tu: d.tu, sang: TRANG_THAI_HUY, lyDo: `Huỷ theo nhóm DonNhieuAo ${d.goc} (do huỷ ${sttKey})` },
      }).catch(err => console.error('[Orders] Lỗi ghi log huỷ theo nhóm:', err.message));
    }
  }

  // Trừ kho phôi (tab Ton_Kho_Phoi) khi đơn VỪA chuyển sang "Đã lấy phôi" — không hoàn kho khi chuyển
  // ngược lại (xem taiSanService.truKhoTheoDon). Chạy SAU khi ghi Sheet đơn hàng đã thành công; lỗi ở
  // đây (vd chưa tạo tab Ton_Kho_Phoi) chỉ log ra console, KHÔNG được làm hỏng việc cập nhật đơn hàng
  // — kho phôi chỉ mang tính theo dõi, không phải điều kiện chặn thao tác lấy phôi thực tế.
  //
  // `tuyChon.gomThayDoiKho` (mảng, bổ sung 22/09/2026, theo yêu cầu người dùng cải thiện hiệu năng) —
  // cho thao tác HÀNG LOẠT (routes/orders.js POST /chuyen-trang-thai-hang-loat) GOM thay đổi kho lại
  // thay vì ghi Sheets NGAY tại đây: N đơn CÙNG 1 tổ hợp phôi trong 1 lô sẽ chỉ cần đọc+ghi Sheets ĐÚNG
  // 1 lần (xem taiSanService.js#apDungThayDoiKhoHangLoat), thay vì N lượt tuần tự — VÀ tránh luôn nguy
  // cơ lệch số nếu N đơn cùng tổ hợp từng bị chạy song song (đọc cùng giá trị cũ, ghi đè lẫn nhau).
  // Logic QUYẾT ĐỊNH có nên trừ/hoàn kho hay không GIỮ NGUYÊN Y HỆT ở đây (dựa trên updatesDaTinh/row đã
  // tính đầy đủ auto-transition phía trên) — route gọi hàng loạt KHÔNG tự đoán lại điều kiện này, chỉ
  // nhận kết quả đã gom rồi tự flush 1 lần sau vòng lặp, tránh 2 nơi có thể lệch nhau về sau.
  const soLuongDon = Number(row.SO_LUONG);
  const soLuongHopLe = soLuongDon > 0;
  if (updatesDaTinh.TRANG_THAI_PHOI === 'Đã lấy phôi' && row.TRANG_THAI_PHOI !== 'Đã lấy phôi') {
    if (tuyChon.gomThayDoiKho) {
      if (soLuongHopLe) tuyChon.gomThayDoiKho.push({ sttKey, loai: row.LOAI, kichThuoc: row.KICH_THUOC, mauSac: row.MAU_SAC, soLuong: -soLuongDon, user });
    } else {
      try {
        await taiSanService.truKhoTheoDon(row, user);
      } catch (err) {
        console.error('[Orders] Lỗi trừ kho phôi:', err.message);
      }
    }
  }
  // Chuyển NGƯỢC lại khỏi "Đã lấy phôi" — HOÀN kho đối xứng (bổ sung 20/09/2026, phát hiện qua rà soát
  // bảo mật, xem taiSanService.js#hoanKhoTheoDon) — thiếu bước này khiến "Đã lấy phôi -> Chưa lấy phôi
  // -> Đã lấy phôi" trừ kho 2 lần cho đúng 1 lượt lấy phôi thật.
  if (updatesDaTinh.TRANG_THAI_PHOI !== undefined && updatesDaTinh.TRANG_THAI_PHOI !== 'Đã lấy phôi' && row.TRANG_THAI_PHOI === 'Đã lấy phôi') {
    if (tuyChon.gomThayDoiKho) {
      if (soLuongHopLe) tuyChon.gomThayDoiKho.push({ sttKey, loai: row.LOAI, kichThuoc: row.KICH_THUOC, mauSac: row.MAU_SAC, soLuong: soLuongDon, user });
    } else {
      try {
        await taiSanService.hoanKhoTheoDon(row, user);
      } catch (err) {
        console.error('[Orders] Lỗi hoàn kho phôi:', err.message);
      }
    }
  }

  return { ...row, ...updatesDaTinh, _huyTheoNhom: donHuyTheoNhom.map(d => d.sttKey) };
}

// Đơn chỉ lưu MA_KHACH_HANG (mã) — gắn thêm tên khách hàng thật để hiển thị, không sửa dữ liệu gốc
async function ganTenKhachHang(rows) {
  const banDo = await layBanDoTenKhachHang();
  return rows.map(r => ({ ...r, TenKhachHang: banDo[r.MA_KHACH_HANG] || r.MA_KHACH_HANG || '' }));
}

// Không có cột "tên sản phẩm" riêng — ghép STT_Key (mã đơn, để dễ nhận diện ngay) + LOAI + KICH_THUOC
// + MAU_SAC. Dùng dấu "·" để nhất quán với cách hiển thị các cụm ghép khác trong toàn app.
function tieuDeSanPham(don) {
  const phanSanPham = [don.LOAI, don.KICH_THUOC, don.MAU_SAC].filter(Boolean);
  const phan = [don.STT_Key, ...phanSanPham].filter(Boolean);
  return phan.length ? phan.join(' · ') : (don.MA_DON_HANG_ORDERID || '');
}

// Vị trí thêu
function danhSachViTriTheu(don) {
  return [don.VI_TRI_1].filter(Boolean);
}

// CHÍNH SÁCH PHÂN QUYỀN (cập nhật 24/08/2026, theo Prompt_Ver_24.docx — HUỶ chính sách "mọi vai trò
// như Admin" trước đó): hệ thống giờ có 4 vai trò (admin, nguoi_lay_phoi, ve_file, san_xuat —
// quan_ly bị xoá hẳn, dong_goi gộp vào nguoi_lay_phoi).
//   - admin: xem TOÀN BỘ đơn, không lọc gì.
//   - ve_file: xem mọi đơn (không lọc theo trạng thái) NHƯNG vẫn bị lọc theo Xưởng như mọi vai trò
//     khác (xem locTheoXuong bên dưới) — bổ sung 13/09/2026.
//   - san_xuat: CHỈ thấy đơn đã tới "ĐÃ SẴN SÀNG CHẠY MÁY" trở đi (kể cả trạng thái lỗi
//     "LỖI SẢN XUẤT CẦN LÀM LẠI"), không thấy đơn còn ở "Chưa in mã"/"Đã in mã". Đơn đã
//     CANCELLED/REFUNDED không nằm trong THU_TU_TINH_TRANG (nhánh rẽ) nên tự động bị loại — chỉ
//     admin/ve_file mới thấy đơn huỷ/hoàn, giữ đúng thói quen cũ (trước đây chỉ admin/quan_ly thấy).
//   - nguoi_lay_phoi: KHÔNG dùng route GET /orders (danh sách) — vai trò này chỉ có đúng 1 menu
//     "Quét mã QR" ở giao diện (xem public/js/api.js renderNav), không có trang danh sách đơn để
//     vào. Không cần lọc riêng ở đây.
function filterForRole(rows, user) {
  let list = rows;
  if (user.vaiTro === 'san_xuat') {
    const idxSanSang = chiSoTinhTrang('ĐÃ SẴN SÀNG CHẠY MÁY');
    list = list.filter(r => {
      if (r.TRANG_THAI_XUONG === 'LỖI SẢN XUẤT CẦN LÀM LẠI') return true;
      const idx = chiSoTinhTrang(r.TRANG_THAI_XUONG);
      return idx !== null && idx >= idxSanSang;
    });
  }
  return locTheoXuong(list, user);
}

// Phân loại đơn theo Xưởng (HN/BN...) — bổ sung 13/09/2026, theo yêu cầu người dùng (cột
// XUONG tự thêm vào Don_Hang_ALL, cột Xuong tự thêm vào NguoiDung). CHỈ superadmin luôn xem/thao tác
// được MỌI đơn bất kể Xưởng (thu hẹp từ admin+superadmin xuống CHỈ superadmin, 21/09/2026, theo yêu
// cầu người dùng — ĐỔI so với trước: admin GIỜ bị lọc theo Xưởng y hệt ve_file/san_xuat). Mọi vai trò
// còn lại (kể cả admin): CHỈ xem/thao tác được đơn CÙNG Xưởng với mình — thiếu Xưởng ở 1 trong 2 bên
// (đơn chưa được gán XUONG, HOẶC người dùng chưa được gán Xuong) coi như KHÔNG có quyền (người dùng xác
// nhận: "chưa gán = ẩn với người thường", ưu tiên an toàn dữ liệu hơn tiện lợi trong giai đoạn mới
// triển khai chưa gán hết). Áp dụng CẢ cho việc XEM (danh sách/báo cáo/chatbot/dashboard —
// locTheoXuong) LẪN thao tác trên 1 đơn cụ thể (quét QR/chụp ảnh/sửa đơn — coQuyenTheoXuong, xem
// routes/orders.js, routes/qr.js, routes/photos.js, routes/tracking.js).
// Đổi tên 13/09/2026, theo yêu cầu người dùng: HANOI/BACNINH -> HN/BN. CHỈ đổi danh sách hợp lệ ở
// code — dữ liệu CŨ đã có sẵn trong Sheet (cột XUONG ở Don_Hang_ALL, cột Xuong ở NguoiDung) vẫn còn
// giá trị "HANOI"/"BACNINH" cũ cho tới khi tự sửa tay trong Sheet; so khớp ở locTheoXuong là CHÍNH
// XÁC CHUỖI nên đơn/người dùng còn mang giá trị cũ sẽ bị coi như "khác Xưởng" (không thấy nhau) với
// mọi người đã được gán "HN"/"BN" mới, cho tới khi migrate xong dữ liệu cũ.
// KHÔNG còn là hằng số cố định (bổ sung 24/09/2026, theo yêu cầu người dùng — quản lý Thêm/Đổi tên/Xoá
// Xưởng qua Settings) — danh sách giờ đọc TƯƠI mỗi lần từ SQLite (services/caiDatDbService.js), lấy
// nguyên `layDanhSachXuong` làm export CHÍNH của module này để mọi nơi gọi orderService.layDanhSachXuong()
// luôn thấy đúng danh sách MỚI NHẤT (đổi tại Settings có hiệu lực ngay, không cần khởi động lại server).

// Nhân viên thuộc được nhiều Xưởng (27/09/2026) — xem đơn của MỌI Xưởng mình thuộc, đọc Xưởng hiện tại
// từ DB mỗi lần (taiKhoanService.js#cacXuongCuaNguoiDung).
// Áp dụng cho MỌI vai trò trừ superadmin, KỂ CẢ admin (admin chỉ thấy các Xưởng được phân công — 29/09/2026 xác nhận
// áp dụng cho mọi menu).
function locTheoXuong(rows, user) {
  if (laSuperAdmin(user.vaiTro)) return rows;
  const cacXuong = taiKhoanService.cacXuongCuaNguoiDung(user);
  if (cacXuong.length === 0) return [];
  return rows.filter(r => r.XUONG && cacXuong.includes(r.XUONG));
}

function coQuyenTheoXuong(user, row) {
  if (laSuperAdmin(user.vaiTro)) return true;
  return !!row.XUONG && taiKhoanService.cacXuongCuaNguoiDung(user).includes(row.XUONG);
}

// Phạm vi Xưởng theo MÃ ĐƠN (29/09/2026, theo yêu cầu người dùng — "admin chỉ thấy Xưởng mình phụ trách" ở MỌI
// menu): dùng lọc log/nhật ký/lỗi/ảnh chỉ có STT_Key. Đọc Xưởng của đơn từ SQLite (không đọc Sheets), đọc Xưởng
// người xem 1 lần cho cả danh sách. superadmin thấy tất cả; đơn chưa gán Xưởng/không rõ -> không thấy.
function phamViDon(user) {
  if (laSuperAdmin(user.vaiTro)) return () => true;
  const cacXuong = taiKhoanService.cacXuongCuaNguoiDung(user);
  const daXet = new Map(); // log lặp lại cùng 1 đơn rất nhiều lần — mỗi mã chỉ đọc SQLite 1 lần
  return sttKey => {
    if (!sttKey) return false;
    if (!daXet.has(sttKey)) daXet.set(sttKey, cacXuong.includes(trangThaiDbService.layTheoKey(sttKey).XUONG));
    return daXet.get(sttKey);
  };
}

// "Đơn ưu tiên" (bổ sung 13/09/2026, theo yêu cầu người dùng — cột DON_UU_TIEN người dùng tự thêm vào
// Don_Hang_ALL). CHỈ admin/ve_file được đánh dấu — xem routes/orders.js POST /danh-dau-uu-tien (route
// ghi DUY NHẤT) và TRUONG_CAM_SUA (chặn sửa qua PUT /:sttKey, cùng cách XUONG bị chặn — 1 trường chỉ có
// đúng 1 đường ghi). Giá trị lưu 'TRUE'/'FALSE' (đúng quy ước KichHoat/BatTuDongMuaTracking đang dùng
// trong app), so khớp không phân biệt hoa/thường để an toàn nếu có ai sửa tay trong Sheet.
function laUuTien(row) {
  return String(row.DON_UU_TIEN || '').toUpperCase() === 'TRUE';
}

// Đơn cảnh báo theo TINH_TRANG của khách (07/10/2026, theo yêu cầu người dùng) — CHỈ dựa vào cột RAW TINH_TRANG của Sheet, ĐỘC LẬP
// với trạng thái sản xuất TRANG_THAI_XUONG (không đổi/không đọc nó). -> 'HOLD' | 'CANCELLED' | 'REFUNDED' | null.
// HOLD: đúng quy tắc laDonHold. CANCELLED/REFUNDED: bỏ dấu cách 2 đầu, không phân biệt hoa/thường, khớp cả giá trị BẮT ĐẦU bằng mã
// (vd "CANCELLED_Đã hủy" nếu Sheet có ghi kiểu đó). App không bao giờ ghi cột này.
function loaiTinhTrangDacBiet(row) {
  if (laDonHold(row)) return 'HOLD';
  const v = String(row.TINH_TRANG || '').trim().toUpperCase();
  if (v.startsWith('CANCELLED')) return 'CANCELLED';
  if (v.startsWith('REFUNDED')) return 'REFUNDED';
  return null;
}

// Cảnh báo TINH_TRANG tối đa 21 ngày (07/10/2026, theo yêu cầu người dùng). Mốc = lúc app PHÁT HIỆN loại cảnh báo (mỗi lần đọc Sheet,
// kể cả từ tác vụ định kỳ) — đổi sang loại cảnh báo KHÁC (HOLD -> CANCELLED) hoặc về bình thường rồi cảnh báo lại thì TÍNH LẠI 21 ngày.
// Lần đầu triển khai: đơn đang sẵn cảnh báo -> mốc rất cũ = coi như đã hết hạn. Chỉ ghi SQLite khi đổi (cùng cách DA_MUA_TRACKING).
const CANH_BAO_TT_SO_NGAY = 21;
const MOC_CANH_BAO_DA_HET_HAN = '2000-01-01T00:00:00.000Z';
function dongBoCanhBaoTinhTrang(rows) {
  const khoiTao = !trangThaiDbService.daKhoiTaoCanhBaoTinhTrang();
  const bayGio = new Date().toISOString();
  // Gộp theo mã đơn TRƯỚC (Sheet có thể có 2 dòng cùng STT_Key — chúng dùng chung 1 bản ghi SQLite): mã có ít nhất 1 dòng cảnh báo ->
  // lấy loại của dòng cảnh báo ĐẦU TIÊN; ghi tối đa 1 lần/mã. Không gộp thì 2 dòng ghi đè nhau mỗi lần đọc, mốc 21 ngày đặt lại mãi.
  const theoMa = new Map();
  for (const r of rows) {
    const ma = String(r[KEY_COL]).trim();
    const loai = loaiTinhTrangDacBiet(r) || '';
    if (!theoMa.has(ma)) theoMa.set(ma, { loai, dong: [r] });
    else {
      const m = theoMa.get(ma);
      m.dong.push(r);
      if (!m.loai && loai) m.loai = loai;
    }
  }
  const canGhi = [];
  for (const [ma, { loai, dong }] of theoMa) {
    if ((dong[0].CANH_BAO_TT_LOAI || '') === loai) continue;
    const tu = loai ? (khoiTao ? MOC_CANH_BAO_DA_HET_HAN : bayGio) : '';
    canGhi.push([ma, { CANH_BAO_TT_LOAI: loai, CANH_BAO_TT_TU: tu }]);
    dong.forEach(r => { r.CANH_BAO_TT_LOAI = loai; r.CANH_BAO_TT_TU = tu; });
  }
  if (canGhi.length === 0 && !khoiTao) return;
  try {
    trangThaiDbService.ghiCanhBaoTinhTrang(canGhi, khoiTao);
  } catch (err) {
    console.error('[Orders] Lỗi đồng bộ cảnh báo TINH_TRANG:', err.message);
  }
}
// Loại cảnh báo CÒN HẠN (null nếu không cảnh báo hoặc đã quá 21 ngày kể từ lúc phát hiện) — dùng cho nền vàng/vòng đỏ/đẩy lên đầu.
function canhBaoTinhTrangConHan(row, bayGio = Date.now()) {
  const loai = loaiTinhTrangDacBiet(row);
  if (!loai || row.CANH_BAO_TT_LOAI !== loai) return null;
  const tu = Date.parse(row.CANH_BAO_TT_TU || '');
  return tu && bayGio - tu < CANH_BAO_TT_SO_NGAY * 86400000 ? loai : null;
}

// Số mũi chỉ (07/10/2026, theo yêu cầu người dùng) — NƠI DUY NHẤT đọc số mũi của 1 đơn (danh sách, bộ lọc, Chi tiết đơn dùng chung).
// Nguồn: ô GhiChuTinhGia (Sheet); vừa lưu trong app < 30 phút mà Sheet chưa kịp đổi (IMPORTRANGE trễ) -> bản trong app
// SO_MUI_CHI_NOI_BO. Chỉ nhận ô có ĐÚNG 1 số: "50000", "50.000", "50,000" (ngăn hàng nghìn), "50000 mũi". Nội dung khác
// ("thêu 2 mặt 50000", "12.5") -> KHONG_DOC, không đoán. -> { trangThai: 'CHUA'|'CO'|'KHONG_DOC', so: number|null, nguyenVan }
const SO_MUI_CHO_SHEET_MS = 30 * 60 * 1000;
const MAU_SO_MUI = /^(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:mũi)?$/i;
function docSoMuiChi(row, bayGio = Date.now()) {
  const sheet = String(row.GhiChuTinhGia || '').trim();
  const luc = Date.parse(row.SO_MUI_CHI_LUC || '');
  const app = String(row.SO_MUI_CHI_NOI_BO || '').trim();
  const nguyenVan = (luc && bayGio - luc < SO_MUI_CHO_SHEET_MS && sheet !== app) ? app : sheet;
  if (!nguyenVan) return { trangThai: 'CHUA', so: null, nguyenVan };
  const m = MAU_SO_MUI.exec(nguyenVan.normalize('NFC'));
  if (!m) return { trangThai: 'KHONG_DOC', so: null, nguyenVan };
  return { trangThai: 'CO', so: Number(m[1].replace(/[.,]/g, '')), nguyenVan };
}

// Tra mã đơn GÕ TAY (05/10/2026, theo yêu cầu người dùng — seller lên đơn gõ lẫn dấu "." và "," trong mã, vd 10SON10.1 /
// 10SON10,1): không phân biệt hoa/thường, coi "," = ".", bỏ dấu cách 2 đầu. Gõ đúng y mã nào thì lấy mã đó; không thì
// chỉ nhận khi khớp ĐÚNG 1 đơn — khớp nhiều đơn thì trả danh sách để báo lỗi, KHÔNG tự chọn. `rows` phải được lọc phạm
// vi Xưởng trước (không lộ đơn Xưởng khác). Dùng ở: ô "Nhập mã đơn" Chi tiết đơn (routes/orders.js GET /tra-ma) + ô
// nhập mã kịch bản "Cho nhập mã tay" (routes/qr.js kiem-tra). Quét camera vẫn khớp chính xác (mã QR in từ mã gốc).
function chuanHoaMaGoTay(ma) {
  return String(ma || '').trim().toLowerCase().replace(/,/g, '.');
}
function timDonTheoMaGoTay(rows, ma) {
  const nhap = String(ma || '').trim();
  const dung = rows.find(r => r[KEY_COL] === nhap);
  if (dung) return { row: dung };
  const khoa = chuanHoaMaGoTay(nhap);
  const khop = rows.filter(r => r[KEY_COL] && chuanHoaMaGoTay(r[KEY_COL]) === khoa);
  if (khop.length === 1) return { row: khop[0] };
  return { row: null, cacMaKhop: khop.map(r => r[KEY_COL]) };
}

// Đơn "HOLD-Chờ xác nhận" (05/10/2026, theo yêu cầu người dùng) — theo cột RAW TINH_TRANG của Sheet. CHỈ để hiển thị (vòng
// đỏ + nhãn ở danh sách/chi tiết đơn, xem public/css/style.css .vong-hold), không chặn thao tác nào. So khớp ĐÚNG chuỗi,
// chỉ bỏ dấu cách 2 đầu; NFC để chữ Việt gõ dựng sẵn hay tổ hợp đều khớp.
const TINH_TRANG_HOLD = 'HOLD-Chờ xác nhận'.normalize('NFC');
function laDonHold(row) {
  return String(row.TINH_TRANG || '').trim().normalize('NFC') === TINH_TRANG_HOLD;
}

// Sửa 1 lần lúc khởi động (bổ sung 25/09/2026, theo yêu cầu người dùng) — các đơn đã KẸT ở "Đã in mã"
// dù đủ phôi + file (do lỗi cũ ở tinhTinhTrangTuDong, xem trên) được chuyển sang "ĐÃ SẴN SÀNG CHẠY MÁY".
// Chỉ đọc/ghi SQLite (3 cột này đều ở trangThaiDbService), không tốn quota Sheets. Chạy lại mỗi lần
// khởi động vô hại — sau lần đầu không còn đơn nào khớp.
function suaDonKetSanSang() {
  const { ghiLog } = require('./logService');
  const ketQua = [];
  for (const [sttKey, r] of trangThaiDbService.layTatCa()) {
    if (r.DA_XOA === 'TRUE') continue;
    if (r.TRANG_THAI_XUONG !== 'Đã in mã' || r.TRANG_THAI_PHOI !== 'Đã lấy phôi' || r.TRANG_THAI_VE_FILE !== 'Đã vẽ file') continue;
    trangThaiDbService.ghiDe(sttKey, { TRANG_THAI_XUONG: 'ĐÃ SẴN SÀNG CHẠY MÁY', NguoiCapNhatCuoi: 'Hệ thống', ThoiGianCapNhatCuoi: new Date().toISOString() });
    ghiLog({ nguoiDung: 'Hệ thống', vaiTro: '', hanhDong: 'CHUYEN_TRANG_THAI_HANG_LOAT', sttKey, chiTiet: { cot: 'TRANG_THAI_XUONG', tu: 'Đã in mã', sang: 'ĐÃ SẴN SÀNG CHẠY MÁY', lyDo: 'Sửa đơn kẹt lúc khởi động' } });
    ketQua.push(sttKey);
  }
  if (ketQua.length) console.log(`[Orders] Đã tự chuyển ${ketQua.length} đơn kẹt sang ĐÃ SẴN SÀNG CHẠY MÁY: ${ketQua.join(', ')}`);
  return ketQua;
}

// 4 cột theo dõi TỰ ĐỘNG mua tracking (30/09/2026, trackingAutoService.js#ghiNhanLanThuTuDong) — CHỈ vai trò có menu Tracking
// được thấy (yêu cầu người dùng: chặn cả ở API). Gỡ khỏi dữ liệu đơn trả về cho vai trò khác (routes/orders.js, routes/qr.js).
// + THONG_TIN_GKE_CHO_DON_LOI (01/10/2026): dữ liệu sửa tay gửi GKE — cùng nhóm, cùng quyền xem.
const COT_THEO_DOI_MUA_TRACKING = ['TU_MUA_SO_LAN_THU', 'TU_MUA_CHE_DO', 'TU_MUA_LOI_GAN_NHAT', 'TU_MUA_THOI_GIAN_THU', 'THONG_TIN_GKE_CHO_DON_LOI'];
const VAI_TRO_MENU_TRACKING = ['admin', 'superadmin', 've_file'];
function anCotTheoDoiMuaTracking(row, user) {
  if (user && VAI_TRO_MENU_TRACKING.includes(user.vaiTro)) return row;
  const r = { ...row };
  COT_THEO_DOI_MUA_TRACKING.forEach(c => delete r[c]);
  return r;
}

module.exports = {
  VAI_TRO_MENU_TRACKING, anCotTheoDoiMuaTracking,
  suaDonKetSanSang,
  TAB, KEY_COL, getAll, getByKey, getManyByKeys, update, filterForRole, ganTenKhachHang, tieuDeSanPham, danhSachViTriTheu,
  layDanhSachXuong, locTheoXuong, coQuyenTheoXuong, phamViDon, laUuTien, laDonHold, loaiTinhTrangDacBiet, canhBaoTinhTrangConHan, timDonTheoMaGoTay, docSoMuiChi, lyDoDaMuaTracking, NHOM_LOC_TONG_QUAT,
};
