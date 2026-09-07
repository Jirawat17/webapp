const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const orderService = require('../services/orderService');
const alertService = require('../services/alertService');
const scenarioService = require('../services/scenarioService');
const { parseNgay } = require('../services/dateUtils');
const { DANH_SACH_TRANG_THAI_BAO_CAO, TRANG_THAI_PHOI_VALUES, TRANG_THAI_VE_FILE_VALUES, khopGiaTriLoc } = require('../data/pipelineTinhTrang');
const { ghiLog, layLichSuTheoDon, layLichSuChuyenSangTrangThai } = require('../services/logService');
const { updateCells } = require('../services/sheetsService');
const { taiDsAnh } = require('../services/anhNguonService');
const { tinhHashAnh, khoangCachHamming } = require('../services/perceptualHashService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

const TRANG_THAI_DANG_CHAY_MAY = 'Đang chạy máy';

// "Người vận hành máy": đơn không lưu trực tiếp trường này — tra LỊCH SỬ (LichSuHoatDong) tìm lần
// GẦN NHẤT đơn được chuyển sang "Đang chạy máy" (chính xác hơn dùng NguoiCapNhatCuoi, vì trường đó
// bị ghi đè bởi BẤT KỲ lần sửa nào sau đó, kể cả chỉ sửa Ghi chú). Chỉ cần tính khi có ít nhất 1 đơn
// đang ở trạng thái này, tránh đọc lịch sử không cần thiết ở các trang không liên quan.
async function layNguoiVanHanhTheoDon() {
  const lanChuyen = await layLichSuChuyenSangTrangThai(TRANG_THAI_DANG_CHAY_MAY);
  const ketQua = {};
  for (const l of lanChuyen) {
    const hienTai = ketQua[l.sttKey];
    if (!hienTai || new Date(l.thoiGian) > new Date(hienTai.thoiGian)) ketQua[l.sttKey] = l;
  }
  return ketQua;
}

// Gắn thêm các trường tính toán (không phải cột thật trong Sheet) để hiển thị — dùng chung cho list/detail
async function lamGiauDon(rows) {
  const daGanKH = await orderService.ganTenKhachHang(rows);
  const canNguoiVanHanh = daGanKH.some(r => r.TRANG_THAI_XUONG === TRANG_THAI_DANG_CHAY_MAY);
  const nguoiVanHanhTheoDon = canNguoiVanHanh ? await layNguoiVanHanhTheoDon() : {};
  return daGanKH.map(r => ({
    ...r,
    TieuDeSanPham: orderService.tieuDeSanPham(r),
    ViTriTheu: orderService.danhSachViTriTheu(r),
    CanhBao: alertService.tinhMucCanhBao(r),
    NguoiVanHanh: r.TRANG_THAI_XUONG === TRANG_THAI_DANG_CHAY_MAY
      ? ((nguoiVanHanhTheoDon[r.STT_Key] && nguoiVanHanhTheoDon[r.STT_Key].nguoiDung) || null)
      : null,
  }));
}

// (bổ sung 26/08/2026, theo yêu cầu người dùng) Đơn "Đang chạy máy" chỉ hiện với ĐÚNG tài khoản
// san_xuat đang chạy nó — san_xuat KHÁC bị ẩn HOÀN TOÀN (cả danh sách lẫn trang chi tiết, coi như
// không tồn tại), không chỉ ẩn khỏi danh sách. CHỈ áp dụng cho san_xuat — admin/ve_file luôn thấy
// đầy đủ. Không xác định được người vận hành (vd sửa thẳng trên Sheet, log bị thiếu) thì vẫn cho
// TẤT CẢ san_xuat thấy (an toàn hơn, tránh thất lạc đơn) — order.html/orders.html tự hiển thị cảnh
// báo rõ ràng trong trường hợp này (xem NHAN_NGUOI_VAN_HANH_KHONG_RO ở phía client).
function locDonDangChayMayTheoNguoiVanHanh(rows, user) {
  if (user.vaiTro !== 'san_xuat') return rows;
  return rows.filter(r => {
    if (r.TRANG_THAI_XUONG !== TRANG_THAI_DANG_CHAY_MAY) return true;
    if (!r.NguoiVanHanh) return true; // không xác định được -> vẫn cho thấy
    return r.NguoiVanHanh === user.ten;
  });
}

// So sánh tăng dần theo NGAY_LEN_DON — dùng làm tiêu chí phụ (tie-break) cho mọi kiểu sắp xếp, để
// thứ tự trong 1 nhóm bằng nhau (vd cùng mức cảnh báo) vẫn ổn định và có ý nghĩa (đơn chờ lâu hơn lên trước).
function soSanhNgayTang(a, b) {
  return (parseNgay(a.NGAY_LEN_DON) || 0) - (parseNgay(b.NGAY_LEN_DON) || 0);
}

// Thứ tự mức cảnh báo khi sắp theo "canh_bao" — càng khẩn cấp càng lên đầu. Không nằm trong map coi
// như "không cảnh báo", xếp cuối cùng.
const MUC_CANH_BAO_THU_TU = { DO: 3, CAM: 2, VANG: 1 };

// Sắp xếp danh sách đơn theo lựa chọn của người dùng (nút "Sắp xếp" ở trang Đơn hàng) — mặc định
// (không truyền hoặc giá trị lạ) giữ đúng hành vi cũ: cũ nhất lên đầu theo NGAY_LEN_DON.
function sapXepDon(list, kieu) {
  const daSap = [...list];
  switch (kieu) {
    case 'ngay_cu_nhat':
      return daSap.sort(soSanhNgayTang);
    case 'canh_bao':
      return daSap.sort((a, b) => {
        const chenhLech = (MUC_CANH_BAO_THU_TU[b.CanhBao] || 0) - (MUC_CANH_BAO_THU_TU[a.CanhBao] || 0);
        return chenhLech !== 0 ? chenhLech : soSanhNgayTang(a, b);
      });
    case 'so_luong':
      return daSap.sort((a, b) => {
        const chenhLech = (Number(b.SO_LUONG) || 0) - (Number(a.SO_LUONG) || 0);
        return chenhLech !== 0 ? chenhLech : soSanhNgayTang(a, b);
      });
    case 'khach_hang':
      return daSap.sort((a, b) => {
        const chenhLech = String(a.TenKhachHang || '').localeCompare(String(b.TenKhachHang || ''), 'vi');
        return chenhLech !== 0 ? chenhLech : soSanhNgayTang(a, b);
      });
    default:
      return daSap.sort((a, b) => -soSanhNgayTang(a, b));
  }
}

// Danh sách đơn hàng — tự lọc theo vai trò, có thể lọc thêm qua query string
router.get('/', async (req, res) => {
  const { rows } = await orderService.getAll();
  let list = orderService.filterForRole(rows, req.session.user);

  // Gắn CanhBao/TenKhachHang SỚM (trước khi lọc/sắp xếp) — cần có CanhBao để lọc theo "canhBao" và
  // sắp theo "canh_bao" bên dưới; đọc dữ liệu để gắn không phụ thuộc số dòng còn lại sau lọc nên
  // gắn sớm hay muộn cũng cùng 1 chi phí, không tốn thêm gì.
  list = await lamGiauDon(list);

  const {
    trangThai, trangThaiPhoi, trangThaiVeFile, kh, tuNgay, denNgay,
    loai, kichThuoc, mauSac, hangVanChuyen, canhBao, sapXep, hangLoat, nguoiVanHanh,
  } = req.query;
  if (trangThai) list = list.filter(r => khopGiaTriLoc(r.TRANG_THAI_XUONG, trangThai));
  if (trangThaiPhoi) list = list.filter(r => khopGiaTriLoc(r.TRANG_THAI_PHOI, trangThaiPhoi));
  if (trangThaiVeFile) list = list.filter(r => khopGiaTriLoc(r.TRANG_THAI_VE_FILE, trangThaiVeFile));
  // "Đơn của tôi" (admin) — lọc còn đúng 1 người sản xuất đang vận hành. NguoiVanHanh là trường TÍNH
  // TOÁN (gắn ở lamGiauDon() phía trên, không phải cột thật) nên phải lọc SAU khi đã gắn xong. An
  // toàn với san_xuat dù truyền tham số này: locDonDangChayMayTheoNguoiVanHanh() luôn chạy SAU CÙNG,
  // vẫn giới hạn san_xuat chỉ thấy đơn "Đang chạy máy" của chính họ bất kể nguoiVanHanh là gì.
  if (nguoiVanHanh) list = list.filter(r => r.NguoiVanHanh === nguoiVanHanh);
  if (loai) list = list.filter(r => r.LOAI === loai);
  if (kichThuoc) list = list.filter(r => r.KICH_THUOC === kichThuoc);
  if (mauSac) list = list.filter(r => r.MAU_SAC === mauSac);
  if (hangVanChuyen) list = list.filter(r => r.HANG_VAN_CHUYEN === hangVanChuyen);
  if (canhBao) list = list.filter(r => r.CanhBao === canhBao);
  if (hangLoat) list = list.filter(r => !!r.NHOM_HANG_LOAT);
  if (kh) {
    const tuKhoa = kh.toLowerCase();
    list = list.filter(r =>
      (r.MA_KHACH_HANG || '').toLowerCase().includes(tuKhoa) ||
      (r.STT_Key || '').toLowerCase().includes(tuKhoa)
    );
  }
  if (tuNgay || denNgay) {
    list = list.filter(r => {
      const ngay = parseNgay(r.NGAY_LEN_DON);
      if (!ngay) return false;
      if (tuNgay && ngay < parseNgay(tuNgay)) return false;
      if (denNgay && ngay > parseNgay(denNgay)) return false;
      return true;
    });
  }

  list = sapXepDon(list, sapXep);
  list = locDonDangChayMayTheoNguoiVanHanh(list, req.session.user);
  res.json(list);
});

// Chuyển trạng thái HÀNG LOẠT cho nhiều đơn cùng lúc — chọn tự do bất kỳ trong 10 giá trị TRANG_THAI_XUONG,
// KHÔNG kiểm tra trạng thái hiện tại của từng đơn (khác với kịch bản quét QR — quyết định có chủ ý
// của người dùng, vì đây là công cụ sửa nhanh/sửa lỗi, không phải luồng vận hành theo pipeline).
// CHỈ đổi được TRANG_THAI_XUONG (không đổi TRANG_THAI_PHOI/TRANG_THAI_VE_FILE) — đủ dùng cho việc sửa
// nhanh/sửa lỗi ở cấp tiến trình chung, còn phôi/file sửa qua trang chi tiết đơn hoặc quét QR.
// Mở cho MỌI vai trò có quyền vào trang Đơn hàng (admin/ve_file toàn bộ, san_xuat theo phạm vi đã
// lọc), không theo giới hạn cột TRUONG_DUOC_SUA phía dưới (vốn chỉ áp dụng cho sửa từng đơn lẻ).
// Danh sách giá trị hợp lệ theo từng cột — dùng để validate tham số 'cot'/'trangThaiMoi' bên dưới
const GIA_TRI_HOP_LE_THEO_COT = {
  TRANG_THAI_XUONG: DANH_SACH_TRANG_THAI_BAO_CAO,
  TRANG_THAI_PHOI: TRANG_THAI_PHOI_VALUES,
  TRANG_THAI_VE_FILE: TRANG_THAI_VE_FILE_VALUES,
};

// Chuyển hàng loạt — dùng CHUNG cho cả 3 cột trạng thái (TRANG_THAI_XUONG mặc định nếu không truyền
// 'cot', hoặc TRANG_THAI_PHOI/TRANG_THAI_VE_FILE — 2 nút bấm nhanh "Đã lấy phôi"/"Chưa lấy phôi"/
// "Đã vẽ file"/"Chưa vẽ file" ở trang Đơn hàng dùng chung route này, chỉ khác tham số 'cot').
// Mở cho MỌI vai trò có quyền vào trang Đơn hàng (admin/ve_file toàn bộ, san_xuat theo phạm vi đã
// lọc — đã xác nhận với người dùng là san_xuat cũng được dùng dù không phụ trách phôi/vẽ file).
// nguoi_lay_phoi KHÔNG được set tay bất kỳ đơn nào (chỉ được thao tác qua quét QR đúng kịch bản của
// mình) — chặn cứng ở đây, không chỉ dựa vào việc ẩn menu phía client.
router.post('/chuyen-trang-thai-hang-loat', async (req, res) => {
  const { sttKeys, trangThaiMoi } = req.body;
  const cot = req.body.cot || 'TRANG_THAI_XUONG';
  const user = req.session.user;

  if (user.vaiTro === 'nguoi_lay_phoi') {
    return res.status(403).json({ error: 'Vai trò này không được phép sửa trạng thái đơn hàng bằng tay' });
  }
  if (!Array.isArray(sttKeys) || sttKeys.length === 0) {
    return res.status(400).json({ error: 'Danh sách đơn trống' });
  }
  if (!trangThaiMoi || typeof trangThaiMoi !== 'string') {
    return res.status(400).json({ error: 'Thiếu trạng thái đích' });
  }
  if (!GIA_TRI_HOP_LE_THEO_COT[cot]) {
    return res.status(400).json({ error: 'Cột không hợp lệ: ' + cot });
  }
  if (!GIA_TRI_HOP_LE_THEO_COT[cot].includes(trangThaiMoi)) {
    return res.status(400).json({ error: 'Trạng thái đích không hợp lệ cho cột ' + cot });
  }

  const thanhCong = [];
  const loi = [];

  for (const sttKey of sttKeys) {
    try {
      const { headers, row } = await orderService.getByKey(sttKey, { fresh: true });
      if (!row) {
        loi.push({ sttKey, lyDo: 'Không tìm thấy đơn hàng (có thể vừa bị xoá/sửa ở nơi khác)' });
        continue;
      }

      const trangThaiCu = row[cot];
      const ketQuaUpdate = await orderService.update(sttKey, {
        [cot]: trangThaiMoi,
        NguoiCapNhatCuoi: user.ten,
        ThoiGianCapNhatCuoi: new Date().toISOString(),
      }, user, { donDaDoc: { headers, row } }); // đã đọc thật ở trên, khỏi đọc lại lần nữa (xem orderService.update)

      thanhCong.push(sttKey);
      ghiLog({
        nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'CHUYEN_TRANG_THAI_HANG_LOAT',
        sttKey, chiTiet: {
          cot, tu: trangThaiCu, sang: trangThaiMoi,
          ...(ketQuaUpdate._daTuDongChuyenTinhTrang ? { tuDongChuyenTinhTrangSang: ketQuaUpdate._tinhTrangTuDongMoi } : {}),
        },
      }).catch(err => console.error('[Orders] Lỗi ghi log nền:', err.message));
    } catch (err) {
      loi.push({ sttKey, lyDo: err.message });
    }
  }

  res.json({ ok: true, thanhCong, loi });
});

// Những kịch bản (trong CauHinhKichBan) có thể áp dụng cho trạng thái hiện tại của đơn —
// dùng để hiện nút "Chuyển sang..." trên trang chi tiết mà không cần quét QR
// So khớp đúng CỘT mà từng kịch bản thao tác (Cot trong CauHinhKichBan — TRANG_THAI_XUONG hoặc
// TRANG_THAI_PHOI hoặc TRANG_THAI_VE_FILE), không chỉ so với TRANG_THAI_XUONG như bản cũ (trước 24/08/2026,
// lúc đó mọi kịch bản đều chỉ thao tác trên đúng 1 cột TRANG_THAI_XUONG nên không cần phân biệt). Đồng
// thời chỉ hiện kịch bản mà VAI TRÒ đang xem được phép dùng (Nguoi_Thuc_Hien) — tránh hiện nút rồi
// bấm vào bị từ chối (qr.js cũng chặn lại lần nữa ở phía server, đây chỉ là để giao diện đỡ rối).
async function layKichBanKeTiep(row, user) {
  const list = await scenarioService.layDanhSachKichBan();
  return list.filter(s =>
    (!s.requireStatus || s.requireStatus === row[s.column]) &&
    (user.vaiTro === 'admin' || !s.allowedRoles || s.allowedRoles.includes(user.vaiTro))
  );
}

router.get('/:sttKey', async (req, res) => {
  const { row } = await orderService.getByKey(req.params.sttKey);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

  const user = req.session.user;
  const [lichSu, [donDaLamGiau], kichBanKeTiep] = await Promise.all([
    layLichSuTheoDon(req.params.sttKey),
    lamGiauDon([row]),
    layKichBanKeTiep(row, user),
  ]);

  // Ẩn hoàn toàn (404) nếu là san_xuat KHÁC người đang vận hành đơn "Đang chạy máy" — xem
  // locDonDangChayMayTheoNguoiVanHanh phía trên.
  if (user.vaiTro === 'san_xuat' && row.TRANG_THAI_XUONG === TRANG_THAI_DANG_CHAY_MAY &&
      donDaLamGiau.NguoiVanHanh && donDaLamGiau.NguoiVanHanh !== user.ten) {
    return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
  }

  res.json({ ...donDaLamGiau, lichSu, kichBanKeTiep });
});

// CHÍNH SÁCH PHÂN QUYỀN (cập nhật 26/08/2026 — nguoi_lay_phoi KHÔNG được set tay bất kỳ trường nào
// của bất kỳ đơn nào nữa, kể cả GHI_CHU; trước đó có cho sửa riêng GHI_CHU nhưng đã bỏ):
//   - admin, ve_file: không có trong danh sách dưới đây = sửa được MỌI trường (trừ TRUONG_CAM_SUA).
//   - san_xuat: chỉ sửa được 3 cột trạng thái + ghi chú — theo đúng mô tả "lỗi thì set tay, làm lại
//     thì cũng set tay" (san_xuat là người phát hiện lỗi sản xuất, cần tự set TRANG_THAI_XUONG sang lỗi,
//     và tự set lại cả 2 cột phôi/file về "chưa" khi cần làm lại — không phải đợi nguoi_lay_phoi/
//     ve_file làm hộ từng bước).
//   - nguoi_lay_phoi: mảng rỗng = không sửa được trường nào qua route này (chỉ được thao tác qua
//     quét QR đúng kịch bản của mình — xem routes/qr.js).
const TRUONG_DUOC_SUA = {
  san_xuat: ['GHI_CHU', 'TRANG_THAI_XUONG', 'TRANG_THAI_PHOI', 'TRANG_THAI_VE_FILE'],
  nguoi_lay_phoi: [],
};

// Không bao giờ cho phép sửa qua các cột này — khóa chính, field nội bộ, hoặc trường chỉ tính toán để hiển thị
const TRUONG_CAM_SUA = ['STT_Key', '_row', 'NguoiCapNhatCuoi', 'ThoiGianCapNhatCuoi', 'TenKhachHang', 'TieuDeSanPham', 'ViTriTheu', 'CanhBao'];

router.put('/:sttKey', async (req, res) => {
  const user = req.session.user;
  const allowed = TRUONG_DUOC_SUA[user.vaiTro]; // undefined cho admin/ve_file = sửa hết (trừ TRUONG_CAM_SUA)
  let updates = req.body;

  if (allowed) {
    updates = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
  }
  updates = Object.fromEntries(Object.entries(updates).filter(([k]) => !TRUONG_CAM_SUA.includes(k)));

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Không có trường nào được phép sửa với vai trò này' });
  }

  updates.NguoiCapNhatCuoi = user.ten;
  updates.ThoiGianCapNhatCuoi = new Date().toISOString();

  // Đọc thật TRƯỚC khi ghi (không phải thêm 1 lượt đọc — truyền qua donDaDoc bên dưới để
  // orderService.update() dùng lại đúng lượt đọc này, không đọc lại lần nữa) — cần biết giá trị CŨ
  // của 3 cột trạng thái để ghi log đủ chi tiết {tu, sang} như quét QR/sửa hàng loạt đang có, thay vì
  // chỉ ghi mỗi giá trị mới (xem docs/superpowers/specs/2026-09-07-mo-rong-log-hoat-dong-design.md).
  const { headers, row } = await orderService.getByKey(req.params.sttKey, { fresh: true });
  if (!row) return res.status(404).json({ error: 'Không tìm thấy đơn hàng: ' + req.params.sttKey });

  let updated;
  try {
    updated = await orderService.update(req.params.sttKey, updates, user, { donDaDoc: { headers, row } });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const truocKhiSua = {};
  Object.keys(GIA_TRI_HOP_LE_THEO_COT).forEach(cot => {
    if (updates[cot] !== undefined && updates[cot] !== row[cot]) truocKhiSua[cot] = row[cot] || '';
  });

  await ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'CAP_NHAT_DON',
    sttKey: req.params.sttKey,
    chiTiet: {
      ...updates,
      ...(Object.keys(truocKhiSua).length ? { _truocKhiSua: truocKhiSua } : {}),
      ...(updated._daTuDongChuyenTinhTrang ? { tuDongChuyenTinhTrangSang: updated._tinhTrangTuDongMoi } : {}),
    },
  });
  res.json(updated);
});

// ============================================================
// "ĐƠN HÀNG LOẠT" — quét đơn thiếu HASH_ANH_MAU TRONG PHẠM VI ĐƠN ĐANG CHỌN (tick) trên trang, tính
// perceptual hash (dHash) cho ảnh mẫu (DUONG_DAN_URL), rồi gom nhóm các đơn có ảnh mẫu giống/gần
// giống nhau (khoảng cách Hamming nhỏ) vào cùng 1 mã NHOM_HANG_LOAT — CHỈ so khớp nội bộ trong lô
// đang chọn, không đụng đơn ngoài lựa chọn. Chạy THỦ CÔNG khi người dùng bấm nút "QUÉT TÌM ĐƠN HÀNG
// LOẠT" ở public/orders.html — KHÔNG có lịch chạy nền tự động. Dùng đúng mô hình "job chạy nền + hỏi
// tiến độ + có nút Dừng" đã có ở routes/reports.js (_congViecInDon) cho "IN ĐƠN ĐANG CHỌN", chỉ khác
// domain. Xem thiết kế đầy đủ ở docs/superpowers/specs/2026-09-06-don-hang-loat-design.md và
// docs/superpowers/specs/2026-09-06-quet-hang-loat-theo-lua-chon-design.md (giới hạn theo lựa chọn).
// ============================================================

// ≤ 8/64 bit khác nhau coi là cùng thiết kế — mốc KHỞI ĐIỂM, CHƯA được xác nhận bằng dữ liệu thật
// (chỉ kiểm thử bằng ảnh giả lập lúc thiết kế tính năng, xem services/perceptualHashService.js và
// spec mục 3). BẮT BUỘC xem lại kết quả nhóm thực tế sau lần quét đầu và chỉnh lại nếu nhóm sai/thiếu.
const NGUONG_HAMMING = 8;

const _congViecHangLoat = new Map(); // jobId -> { tongSo, daXong, trangThai, daHuy, loi, ketQua, capNhatLucNao }
const THOI_GIAN_GIU_JOB_HANG_LOAT_MS = 15 * 60 * 1000;

function donDepJobHangLoatCu() {
  const gioiHan = Date.now() - THOI_GIAN_GIU_JOB_HANG_LOAT_MS;
  for (const [id, job] of _congViecHangLoat) {
    if (job.capNhatLucNao < gioiHan) _congViecHangLoat.delete(id);
  }
}

// Union-Find (Disjoint Set Union) đơn giản — dùng để gom các đơn có hash gần nhau (khoảng cách
// Hamming ≤ NGUONG_HAMMING) thành từng nhóm liên thông, thay vì chỉ so khớp CHÍNH XÁC từng cặp.
function taoDSU(n) {
  const cha = Array.from({ length: n }, (_, i) => i);
  function tim(x) { return cha[x] === x ? x : (cha[x] = tim(cha[x])); }
  function hop(a, b) { const ra = tim(a), rb = tim(b); if (ra !== rb) cha[ra] = rb; }
  return { tim, hop };
}

// Tính lại NHOM_HANG_LOAT — CHỈ trong phạm vi đơn nằm trong `sttKeySet` (lô đơn người dùng đang chọn
// lúc bấm quét, xem docs/superpowers/specs/2026-09-06-quet-hang-loat-theo-lua-chon-design.md). Đơn
// ngoài `sttKeySet` — dù đã có HASH_ANH_MAU — hoàn toàn không được đọc để so khớp, không bị đụng tới.
// 1 đơn cũ đã có hash từ trước NẰM TRONG sttKeySet vẫn cần được xét lại vì 1 đơn MỚI vừa hash xong
// trong cùng lô có thể khớp với nó. Chỉ ghi lại Sheet những đơn có mã nhóm THAY ĐỔI so với hiện tại.
async function tinhLaiNhomHangLoat(sttKeySet) {
  // Đọc lại CẢ headers lẫn rows ở đây (không nhận headers truyền vào từ lúc job bắt đầu) — bước gộp
  // nhóm này có thể chạy sau khi vòng lặp tính hash phía trên đã kéo dài, cấu trúc cột trong Sheet có
  // thể đã đổi trong lúc đó; ghi bằng headers cũ có thể ghi nhầm cột (xem quy ước tương tự ở
  // services/orderService.js update() — luôn đọc thật ngay trước khi ghi).
  const { headers, rows: tatCaDon } = await orderService.getAll();
  const coHash = tatCaDon.filter(d => sttKeySet.has(d.STT_Key) && d.HASH_ANH_MAU);

  const dsu = taoDSU(coHash.length);
  for (let i = 0; i < coHash.length; i++) {
    for (let j = i + 1; j < coHash.length; j++) {
      if (khoangCachHamming(coHash[i].HASH_ANH_MAU, coHash[j].HASH_ANH_MAU) <= NGUONG_HAMMING) {
        dsu.hop(i, j);
      }
    }
  }

  const theoNhom = new Map(); // root -> [đơn...]
  coHash.forEach((don, i) => {
    const root = dsu.tim(i);
    if (!theoNhom.has(root)) theoNhom.set(root, []);
    theoNhom.get(root).push(don);
  });

  const maNhomTheoSttKey = new Map(); // STT_Key -> mã nhóm (chỉ chứa đơn thuộc component ≥ 2 đơn)
  let soNhomTimThay = 0;
  for (const dsDonTrongNhom of theoNhom.values()) {
    if (dsDonTrongNhom.length < 2) continue; // component chỉ 1 đơn — giữ nguyên mã nhóm hiện có, xem bên dưới
    soNhomTimThay++;
    // Nếu trong component đã có sẵn ≥1 mã nhóm cũ (đơn từng được gộp nhóm ở lần quét trước, có thể
    // với đơn KHÔNG nằm trong lô đang chọn) — NHẬP vào nhóm cũ đó (mã nhỏ nhất nếu có nhiều mã khác
    // nhau) thay vì tạo mã mới, để không "tách" đơn ra khỏi nhóm cũ nó vẫn đang thuộc về.
    const cacMaCu = dsDonTrongNhom.map(d => d.NHOM_HANG_LOAT).filter(Boolean).sort((a, b) => a.localeCompare(b, 'vi'));
    const maNhom = cacMaCu[0] || dsDonTrongNhom.map(d => d.STT_Key).sort()[0];
    dsDonTrongNhom.forEach(d => maNhomTheoSttKey.set(d.STT_Key, maNhom));
  }

  let soDonTrongNhom = 0;
  for (const don of tatCaDon) {
    if (!sttKeySet.has(don.STT_Key)) continue; // ngoài lô đang chọn — không đọc/so/ghi
    // Đơn KHÔNG khớp ai khác trong lô lần này (không có trong maNhomTheoSttKey) — giữ nguyên mã nhóm
    // hiện tại (có thể nó vẫn thực sự trùng thiết kế với 1 đơn ngoài lô ta không kiểm tra lại lần
    // này), TUYỆT ĐỐI không suy ra maNhomMoi = '' rồi xoá mất mã nhóm cũ.
    if (!maNhomTheoSttKey.has(don.STT_Key)) {
      if (don.NHOM_HANG_LOAT) soDonTrongNhom++;
      continue;
    }
    const maNhomMoi = maNhomTheoSttKey.get(don.STT_Key);
    soDonTrongNhom++;
    if ((don.NHOM_HANG_LOAT || '') !== maNhomMoi) {
      await updateCells(orderService.TAB, headers, don._row, { NHOM_HANG_LOAT: maNhomMoi });
    }
  }

  return { soNhomTimThay, soDonTrongNhom };
}

router.post('/quet-hang-loat/bat-dau', async (req, res) => {
  // Chỉ quét/gộp nhóm trong phạm vi đơn đang được chọn (tick) trên trang — xem
  // docs/superpowers/specs/2026-09-06-quet-hang-loat-theo-lua-chon-design.md.
  const user = req.session.user;
  const { sttKeys } = req.body;
  if (!Array.isArray(sttKeys) || sttKeys.length === 0 || sttKeys.some(k => typeof k !== 'string')) {
    return res.status(400).json({ error: 'Thiếu danh sách đơn đang chọn (sttKeys) — hãy chọn ít nhất 1 đơn trước khi quét.' });
  }
  const sttKeySet = new Set(sttKeys);

  donDepJobHangLoatCu();

  // Chặn chạy 2 lượt quét cùng lúc (double-click, 2 tab, 2 người cùng bấm) — job này GHI vào Sheet
  // (khác job in PDF ở routes/reports.js chỉ tạo buffer tạm), nên 2 lượt chồng nhau vừa lãng phí tải
  // lại ảnh trùng, vừa có thể ghi đè NHOM_HANG_LOAT lộn xộn nếu lượt cũ (snapshot cũ hơn) ghi SAU lượt
  // mới.
  for (const job of _congViecHangLoat.values()) {
    if (job.trangThai === 'dang_chay') {
      return res.status(409).json({ error: 'Đang có 1 lượt quét đơn hàng loạt khác đang chạy — vui lòng đợi lượt đó xong trước khi quét lại.' });
    }
  }

  // Đặt chỗ (đăng ký job) NGAY, ĐỒNG BỘ, TRƯỚC bất kỳ await nào — nếu đăng ký job sau lượt đọc Sheet
  // bên dưới (có await, nhường CPU) thì 2 request đến gần như cùng lúc vẫn có thể CÙNG lọt qua vòng
  // kiểm tra ở trên trước khi request nào kịp đăng ký, vô hiệu hoá đúng mục đích chặn ở trên. Đăng ký
  // trước, biết tongSo sau (điền vào job.tongSo khi đã đọc xong Sheet).
  const jobId = crypto.randomUUID();
  const job = {
    tongSo: 0, daXong: 0, trangThai: 'dang_chay', daHuy: false,
    loi: null, ketQua: null, capNhatLucNao: Date.now(),
  };
  _congViecHangLoat.set(jobId, job);

  // Job đã đăng ký (đồng bộ) TRƯỚC dòng await này để đóng khe hở race (xem commit trước) — nghĩa là
  // nếu chính lệnh đọc Sheet dưới đây lỗi (vd Google Sheets API tạm trục trặc), phải tự dọn job "ma"
  // vừa đăng ký, nếu không nó sẽ kẹt mãi ở 'dang_chay' và chặn MỌI lượt quét sau đó qua vòng kiểm tra
  // ở đầu route này (tới tận khi hết hạn dọn job 15 phút) dù thực ra không có job nào đang chạy thật.
  let headers, rows;
  try {
    ({ headers, rows } = await orderService.getAll({ fresh: true }));
  } catch (err) {
    _congViecHangLoat.delete(jobId);
    throw err;
  }
  if (!headers.includes('HASH_ANH_MAU') || !headers.includes('NHOM_HANG_LOAT')) {
    _congViecHangLoat.delete(jobId); // bỏ chỗ đã đặt — không có job thật nào chạy, tránh job "ma" kẹt ở trạng thái dang_chay mãi
    return res.status(400).json({ error: 'Sheet chưa có đủ 2 cột HASH_ANH_MAU/NHOM_HANG_LOAT — cần thêm vào Don_Hang_ALL trước khi dùng tính năng "Đơn hàng loạt"' });
  }

  const donThieuHash = rows.filter(d => sttKeySet.has(d.STT_Key) && d.DUONG_DAN_URL && !d.HASH_ANH_MAU);
  job.tongSo = donThieuHash.length;

  res.json({ jobId, tongSo: donThieuHash.length });

  // Xử lý THẬT chạy nền sau khi đã trả response — KHÔNG await ở trên.
  (async () => {
    try {
      let soTinhDuocHash = 0;
      for (const don of donThieuHash) {
        if (job.daHuy) break;

        const dsMau = await taiDsAnh(don.DUONG_DAN_URL);
        const hash = dsMau[0] ? await tinhHashAnh(dsMau[0]) : null;
        if (hash) {
          // Đọc lại headers ngay trước khi ghi (không dùng `headers` chụp từ đầu job) — vòng lặp này
          // có thể chạy nhiều phút cho lô lớn, cấu trúc cột trong Sheet có thể đổi giữa chừng (đặc
          // biệt dễ xảy ra ở lần dùng đầu tiên — người dùng vừa tự thêm 2 cột HASH_ANH_MAU/
          // NHOM_HANG_LOAT xong là bấm quét ngay). orderService.getAll() (không truyền fresh) dùng
          // cache 10 giây (services/sheetsService.js readTabCached) nên gần như miễn phí, không phải
          // 1 lượt gọi mạng mới cho mỗi đơn — cùng quy ước "đọc thật ngay trước khi ghi" đã áp dụng ở
          // tinhLaiNhomHangLoat() bên dưới và services/orderService.js update().
          const { headers: headersHienTai } = await orderService.getAll();
          await updateCells(orderService.TAB, headersHienTai, don._row, { HASH_ANH_MAU: hash });
          soTinhDuocHash++;
        }

        job.daXong++;
        job.capNhatLucNao = Date.now();
      }

      // Luôn tính lại nhóm SAU vòng lặp trên, kể cả khi bị hủy giữa chừng — tận dụng các hash đã tính
      // được thay vì bỏ phí, và cũng để bắt các thay đổi khác (đơn bị xoá ảnh mẫu chẳng hạn — xem
      // services/orderService.js) kể cả khi không có đơn nào mới cần tính hash ở vòng lặp trên.
      const { soNhomTimThay, soDonTrongNhom } = await tinhLaiNhomHangLoat(sttKeySet);

      job.ketQua = { soDaQuet: job.daXong, soTinhDuocHash, soNhomTimThay, soDonTrongNhom };
      job.trangThai = job.daHuy ? 'huy' : 'xong';
      // Hoạt động chạy nền, không phải 1 lần bấm-1 kết quả tức thời như các hành động khác — ghi log
      // SAU KHI job xong (thành công hoặc bị dừng giữa chừng) vì lúc đó mới có đủ số liệu kết quả.
      // Không gắn sttKey đơn lẻ (thao tác trên cả lô, không phải 1 đơn).
      ghiLog({
        nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_HANG_LOAT',
        chiTiet: { soDonDaChon: sttKeySet.size, daHuy: job.daHuy, ...job.ketQua },
      }).catch(err => console.error('[Orders] Lỗi ghi log nền:', err.message));
    } catch (err) {
      console.error('[Orders] Lỗi quét đơn hàng loạt (chạy nền):', err.message);
      job.trangThai = 'loi';
      job.loi = err.message;
      ghiLog({
        nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_HANG_LOAT_LOI',
        chiTiet: { soDonDaChon: sttKeySet.size, loi: err.message },
      }).catch(err2 => console.error('[Orders] Lỗi ghi log nền:', err2.message));
    }
    job.capNhatLucNao = Date.now();
  })();
});

router.get('/quet-hang-loat/tien-do/:jobId', (req, res) => {
  const job = _congViecHangLoat.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Không tìm thấy tiến trình (có thể đã hết hạn)' });
  res.json({ tongSo: job.tongSo, daXong: job.daXong, trangThai: job.trangThai, loi: job.loi, ketQua: job.ketQua });
});

// Nút "DỪNG" ở public/orders.html gọi route này — chỉ đặt cờ 'daHuy', KHÔNG xoá job ngay (job vẫn
// đang chạy nền, cần tự đọc cờ này rồi mới dừng đúng chỗ — xem router.post('/quet-hang-loat/bat-dau')).
router.post('/quet-hang-loat/huy/:jobId', (req, res) => {
  const job = _congViecHangLoat.get(req.params.jobId);
  if (job && job.trangThai === 'dang_chay') job.daHuy = true;
  res.json({ ok: true });
});

module.exports = router;
