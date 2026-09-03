const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const alertService = require('../services/alertService');
const scenarioService = require('../services/scenarioService');
const { parseNgay } = require('../services/dateUtils');
const { DANH_SACH_TRANG_THAI_BAO_CAO, TRANG_THAI_PHOI_VALUES, TRANG_THAI_VE_FILE_VALUES, khopGiaTriLoc } = require('../data/pipelineTinhTrang');
const { ghiLog, layLichSuTheoDon, layLichSuChuyenSangTrangThai } = require('../services/logService');
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
    loai, kichThuoc, mauSac, hangVanChuyen, canhBao, sapXep,
  } = req.query;
  if (trangThai) list = list.filter(r => khopGiaTriLoc(r.TRANG_THAI_XUONG, trangThai));
  if (trangThaiPhoi) list = list.filter(r => khopGiaTriLoc(r.TRANG_THAI_PHOI, trangThaiPhoi));
  if (trangThaiVeFile) list = list.filter(r => khopGiaTriLoc(r.TRANG_THAI_VE_FILE, trangThaiVeFile));
  if (loai) list = list.filter(r => r.LOAI === loai);
  if (kichThuoc) list = list.filter(r => r.KICH_THUOC === kichThuoc);
  if (mauSac) list = list.filter(r => r.MAU_SAC === mauSac);
  if (hangVanChuyen) list = list.filter(r => r.HANG_VAN_CHUYEN === hangVanChuyen);
  if (canhBao) list = list.filter(r => r.CanhBao === canhBao);
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

  let updated;
  try {
    updated = await orderService.update(req.params.sttKey, updates, user);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  await ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'CAP_NHAT_DON',
    sttKey: req.params.sttKey,
    chiTiet: {
      ...updates,
      ...(updated._daTuDongChuyenTinhTrang ? { tuDongChuyenTinhTrangSang: updated._tinhTrangTuDongMoi } : {}),
    },
  });
  res.json(updated);
});

module.exports = router;
