const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const alertService = require('../services/alertService');
const scenarioService = require('../services/scenarioService');
const { layBanDoTenKhachHang } = require('../services/khachHangService');
const { ghiLog, layLichSuTheoDon, ghiNhatKyQuetHangLoat } = require('../services/logService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// Ghi log không chặn phản hồi cho người dùng — việc ghi nhật ký chỉ phục vụ truy vết/thống kê sau
// này, không ảnh hưởng tới kết quả trả về, nên không cần bắt nhân viên chờ ghi xong mới thấy phản hồi.
// Lỗi ghi log (nếu có) chỉ log ra console server, không làm hỏng trải nghiệm quét.
function ghiKhongCho(promise) {
  promise.catch(err => console.error('[QR] Lỗi ghi log nền:', err.message));
}

// Kịch bản này người đang đăng nhập có được phép dùng không — allowedRoles=null nghĩa là mở cho mọi
// vai trò (xem services/scenarioService.js, cột Nguoi_Thuc_Hien trong CauHinhKichBan). admin LUÔN
// được phép dùng mọi kịch bản bất kể Nguoi_Thuc_Hien ghi gì — admin là superuser, không cần liệt kê
// riêng trong từng dòng Sheet.
function duocPhepDungKichBan(scenario, user) {
  return user.vaiTro === 'admin' || !scenario.allowedRoles || scenario.allowedRoles.includes(user.vaiTro);
}

// "Van an toàn" chung (bổ sung 26/08/2026, theo Prompt_Ver_25.docx): trước đây mỗi kịch bản chỉ tự
// kiểm tra ĐÚNG cột nó nhắm tới (scenario.requireStatus), không quan tâm TRANG_THAI_XUONG tổng của đơn là
// gì. Về mặt dữ liệu không nguy hiểm (tinhTinhTrangTuDong() chỉ tự đồng bộ khi TRANG_THAI_XUONG đang
// "Đã in mã" nên đơn đã kết thúc sẽ không bị kéo lung tung), nhưng vẫn có thể tạo tình huống lạ —
// vd đánh dấu "đã lấy phôi" cho 1 đơn đã bị huỷ. Chặn CHUNG mọi kịch bản khi đơn đang ở 1 trong 3
// trạng thái kết thúc — áp dụng cho MỌI vai trò kể cả admin (đây là lớp chống quét nhầm bằng máy
// quét/camera, không phải giới hạn quyền hạn; admin muốn sửa đơn đã kết thúc thì vào sửa tay ở
// trang chi tiết đơn, nơi đã có quyền ghi đè riêng — xem kiemTraTinhHopLy trong services/orderService.js).
const TRANG_THAI_KET_THUC = ['CANCELLED_Đã hủy', 'REFUNDED_Hoàn đơn', 'DELIVERED_Đã giao đến khách'];
function donDaKetThuc(row) {
  return TRANG_THAI_KET_THUC.includes(row.TRANG_THAI_XUONG);
}

async function lamGiauDon(row) {
  const [daGanKH] = await orderService.ganTenKhachHang([row]);
  return { ...daGanKH, TieuDeSanPham: orderService.tieuDeSanPham(row), CanhBao: alertService.tinhMucCanhBao(row) };
}

// Quét đơn lẻ để tra cứu — CHỈ đọc thông tin, không đổi trạng thái gì cả
router.get('/tra-cuu/:sttKey', async (req, res) => {
  const { sttKey } = req.params;
  const user = req.session.user;

  const [{ row }, lichSu] = await Promise.all([
    orderService.getByKey(sttKey),
    layLichSuTheoDon(sttKey),
  ]);

  if (!row) {
    ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_TRA_CUU_LOI', sttKey, chiTiet: 'Không tìm thấy đơn' }));
    return res.status(404).json({ error: 'Không tìm thấy đơn hàng với mã: ' + sttKey });
  }

  ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_TRA_CUU', sttKey }));
  res.json({ ...(await lamGiauDon(row)), lichSu });
});

// Danh sách kịch bản — đọc trực tiếp từ tab CauHinhKichBan, KHÔNG hardcode trong code.
// Sửa/thêm kịch bản chỉ cần sửa trực tiếp trên Sheet. Chỉ trả về kịch bản mà vai trò đang đăng nhập
// được phép dùng (cột Nguoi_Thuc_Hien) — không hiện lựa chọn mà người dùng bấm vào sẽ bị từ chối.
router.get('/kich-ban', async (req, res) => {
  const list = await scenarioService.layDanhSachKichBan();
  res.json(list.filter(s => duocPhepDungKichBan(s, req.session.user)));
});

// Quét đơn lẻ, ghi ngay lập tức — dùng cho nút "Chuyển sang..." thủ công ở trang chi tiết đơn,
// KHÔNG dùng trong màn hình camera hàng loạt (xem 2 route kiem-tra/xac-nhan-hang-loat bên dưới).
router.post('/kich-ban/:scenarioId/quet', async (req, res) => {
  const { sttKey } = req.body;
  const user = req.session.user;
  const scenario = await scenarioService.timKichBanTheoId(req.params.scenarioId);

  if (!scenario) return res.status(404).json({ error: 'Không tìm thấy kịch bản (có thể đã bị xoá khỏi tab CauHinhKichBan)' });
  if (!duocPhepDungKichBan(scenario, user)) return res.status(403).json({ error: 'Vai trò của bạn không được dùng kịch bản này' });
  if (!sttKey) return res.status(400).json({ error: 'Thiếu mã đơn hàng' });

  // Đọc THẬT (bỏ qua cache) vì đây là bước quyết định có ghi hay không — phải chắc chắn mới nhất
  const { headers, row } = await orderService.getByKey(sttKey, { fresh: true });
  if (!row) {
    ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_LOI', sttKey, chiTiet: { scenario: scenario.label, loi: 'Không tìm thấy đơn' } }));
    return res.status(404).json({ error: 'Không tìm thấy đơn hàng với mã: ' + sttKey });
  }

  // Kịch bản thao tác trên ĐÚNG cột đã khai báo (Cot trong CauHinhKichBan) — mặc định TRANG_THAI_XUONG
  // nếu không khai báo, giữ tương thích ngược với kịch bản cũ.
  const giaTriHienTai = row[scenario.column];

  if (donDaKetThuc(row)) {
    ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_CHAN_DON_KET_THUC', sttKey, chiTiet: { scenario: scenario.label, tinhTrang: row.TRANG_THAI_XUONG } }));
    ghiKhongCho(ghiNhatKyQuetHangLoat({
      nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
      trangThaiCu: row.TRANG_THAI_XUONG, trangThaiMoi: '', ketQua: 'LOI_DON_DA_KET_THUC',
      ghiChu: `Đơn đã ở trạng thái kết thúc "${row.TRANG_THAI_XUONG}"`,
    }));
    return res.status(400).json({ error: `Đơn đã ở trạng thái kết thúc "${row.TRANG_THAI_XUONG}" — không thể dùng kịch bản quét nào nữa cho đơn này.` });
  }

  if (scenario.requireStatus && giaTriHienTai !== scenario.requireStatus) {
    ghiKhongCho(ghiLog({
      nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_SAI_TRANG_THAI',
      sttKey, chiTiet: { scenario: scenario.label, cot: scenario.column, trangThaiHienTai: giaTriHienTai, trangThaiCanCo: scenario.requireStatus },
    }));
    ghiKhongCho(ghiNhatKyQuetHangLoat({
      nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
      trangThaiCu: giaTriHienTai, trangThaiMoi: '', ketQua: 'LOI_SAI_TRANG_THAI',
      ghiChu: `Cần đang ở '${scenario.requireStatus}' (cột ${scenario.column}) nhưng đơn đang ở '${giaTriHienTai}'`,
    }));
    return res.status(400).json({
      error: `Đơn đang ở '${giaTriHienTai}' (cột ${scenario.column}), cần đang ở '${scenario.requireStatus}' để dùng kịch bản này`,
    });
  }

  let updated;
  try {
    updated = await orderService.update(sttKey, {
      [scenario.column]: scenario.setStatus,
      NguoiCapNhatCuoi: user.ten,
      ThoiGianCapNhatCuoi: new Date().toISOString(),
    }, user, { donDaDoc: { headers, row } }); // đã đọc thật ở trên, khỏi đọc lại lần nữa (xem orderService.update)
  } catch (err) {
    // Đơn ĐÚNG trạng thái cột này yêu cầu, nhưng đổi xong sẽ xung đột với 1 trong 2 cột còn lại
    // (vd đơn đang "Chưa in mã" mà quét "lấy phôi" — TRANG_THAI_PHOI đúng "Chưa lấy phôi" nên
    // qua được kiểm tra requireStatus ở trên, nhưng orderService.update() chặn lại vì TRANG_THAI_XUONG
    // vẫn "Chưa in mã", chưa hợp lý để đánh dấu đã có phôi). admin vẫn có thể gặp lỗi này nếu
    // dữ liệu THỰC SỰ mâu thuẫn ở cột khác — override chỉ áp dụng cho 2 quy tắc trong
    // kiemTraTinhHopLy(), không tắt hẳn kiểm tra.
    ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_LOI', sttKey, chiTiet: { scenario: scenario.label, cot: scenario.column, loi: err.message } }));
    ghiKhongCho(ghiNhatKyQuetHangLoat({
      nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
      trangThaiCu: giaTriHienTai, trangThaiMoi: '', ketQua: 'LOI_KHONG_HOP_LY', ghiChu: err.message,
    }));
    return res.status(400).json({ error: err.message });
  }

  ghiKhongCho(ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KICH_BAN',
    sttKey, chiTiet: {
      scenario: scenario.label, cot: scenario.column, tu: giaTriHienTai, sang: scenario.setStatus,
      ...(updated._daTuDongChuyenTinhTrang ? { tuDongChuyenTinhTrangSang: updated._tinhTrangTuDongMoi } : {}),
    },
  }));
  ghiKhongCho(ghiNhatKyQuetHangLoat({
    nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
    trangThaiCu: giaTriHienTai, trangThaiMoi: scenario.setStatus, ketQua: 'THANH_CONG',
  }));

  res.json({ ok: true, don: await lamGiauDon(updated) });
});

// ============================================================
// LUỒNG QUÉT HÀNG LOẠT: quét = CHỈ kiểm tra (không ghi Sheet) → xem lại theo 3 nhóm → xác nhận hàng loạt
//
// TỐI ƯU TỐC ĐỘ (quan trọng cho camera quét liên tục):
// - scenario + đơn hàng được đọc SONG SONG (Promise.all) thay vì tuần tự.
// - Cả 2 đều đọc qua cache (readTabCached trong orderService/scenarioService) — không gọi mạng
//   tới Google Sheets ở phần lớn các lượt quét trong cùng 1 phiên (chỉ cách nhau vài giây).
// - Ghi log KHÔNG chờ (fire-and-forget) — nhân viên thấy kết quả ngay, log chạy nền phía sau.
// Độ an toàn KHÔNG đổi: bước xác nhận hàng loạt bên dưới luôn đọc THẬT (fresh) trước khi ghi.
// ============================================================

router.post('/kich-ban/:scenarioId/kiem-tra', async (req, res) => {
  const { sttKey } = req.body;
  const user = req.session.user;

  if (!sttKey) return res.status(400).json({ error: 'Thiếu mã đơn hàng' });

  const [scenario, { row }, banDoKhachHang] = await Promise.all([
    scenarioService.timKichBanTheoId(req.params.scenarioId),
    orderService.getByKey(sttKey), // qua cache — nhanh, đủ an toàn vì bước xác nhận sẽ đọc thật lại
    layBanDoTenKhachHang(), // gộp vào cùng lượt song song, không đợi xong scenario/order mới bắt đầu
  ]);

  if (!scenario) return res.status(404).json({ error: 'Không tìm thấy kịch bản' });
  if (!duocPhepDungKichBan(scenario, user)) return res.status(403).json({ error: 'Vai trò của bạn không được dùng kịch bản này' });

  if (!row) {
    ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KIEM_TRA_KHONG_TIM_THAY', sttKey, chiTiet: { scenario: scenario.label } }));
    ghiKhongCho(ghiNhatKyQuetHangLoat({
      nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
      trangThaiCu: '', trangThaiMoi: '', ketQua: 'KIEM_TRA_KHONG_TIM_THAY', ghiChu: 'Không tìm thấy mã trong Sheet',
    }));
    return res.json({ nhom: 'KHONG_TIM_THAY', sttKey, lyDo: 'Không tìm thấy đơn hàng với mã này trong Sheet' });
  }

  const tieuDe = orderService.tieuDeSanPham(row);
  const tenKhachHang = banDoKhachHang[row.MA_KHACH_HANG] || row.MA_KHACH_HANG || '';
  const giaTriHienTai = row[scenario.column];

  if (donDaKetThuc(row)) {
    const lyDo = `Đơn đã ở trạng thái kết thúc "${row.TRANG_THAI_XUONG}" — không thể dùng kịch bản quét nào nữa`;
    ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KIEM_TRA_CHAN_DON_KET_THUC', sttKey, chiTiet: { scenario: scenario.label, tinhTrang: row.TRANG_THAI_XUONG } }));
    ghiKhongCho(ghiNhatKyQuetHangLoat({
      nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
      trangThaiCu: row.TRANG_THAI_XUONG, trangThaiMoi: '', ketQua: 'LOI_DON_DA_KET_THUC', ghiChu: lyDo,
    }));
    // Dùng lại nhóm SAI_TRANG_THAI có sẵn (đã có đủ styling/đếm/xem-lại ở scan.html) thay vì tạo
    // nhóm mới — về bản chất đây cũng là "đơn không ở đúng trạng thái mà kịch bản này cần".
    return res.json({ nhom: 'SAI_TRANG_THAI', sttKey, tieuDe, tenKhachHang, trangThaiHienTai: row.TRANG_THAI_XUONG, trangThaiYeuCau: scenario.requireStatus, lyDo });
  }

  if (scenario.requireStatus && giaTriHienTai !== scenario.requireStatus) {
    const lyDo = `Đang ở '${giaTriHienTai}' (cột ${scenario.column}), kịch bản này yêu cầu đang ở '${scenario.requireStatus}'`;
    ghiKhongCho(ghiLog({
      nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KIEM_TRA_SAI_TRANG_THAI',
      sttKey, chiTiet: { scenario: scenario.label, cot: scenario.column, trangThaiHienTai: giaTriHienTai, trangThaiCanCo: scenario.requireStatus },
    }));
    ghiKhongCho(ghiNhatKyQuetHangLoat({
      nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
      trangThaiCu: giaTriHienTai, trangThaiMoi: '', ketQua: 'KIEM_TRA_SAI_TRANG_THAI', ghiChu: lyDo,
    }));
    return res.json({ nhom: 'SAI_TRANG_THAI', sttKey, tieuDe, tenKhachHang, trangThaiHienTai: giaTriHienTai, trangThaiYeuCau: scenario.requireStatus, lyDo });
  }

  ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KIEM_TRA_OK', sttKey, chiTiet: { scenario: scenario.label, cot: scenario.column, seChuyenSang: scenario.setStatus } }));
  ghiKhongCho(ghiNhatKyQuetHangLoat({
    nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
    trangThaiCu: giaTriHienTai, trangThaiMoi: scenario.setStatus, ketQua: 'KIEM_TRA_OK',
  }));
  res.json({ nhom: 'OK', sttKey, tieuDe, tenKhachHang, trangThaiHienTai: giaTriHienTai, trangThaiSau: scenario.setStatus });
});

// Xác nhận cập nhật hàng loạt — chỉ gọi cho các mã đã kiểm tra OK ở bước quét.
// QUAN TRỌNG: đọc THẬT (fresh, bỏ qua cache) trước khi quyết định ghi — đây là bước chống ghi đè
// khi dữ liệu đã đổi giữa lúc quét (kiem-tra, dùng cache cho nhanh) và lúc xác nhận thật sự.
// Mã nào không còn hợp lệ trả về trong "loi", KHÔNG âm thầm bỏ qua.
router.post('/kich-ban/:scenarioId/xac-nhan-hang-loat', async (req, res) => {
  const { sttKeys } = req.body;
  const user = req.session.user;
  const scenario = await scenarioService.timKichBanTheoId(req.params.scenarioId);

  if (!scenario) return res.status(404).json({ error: 'Không tìm thấy kịch bản' });
  if (!duocPhepDungKichBan(scenario, user)) return res.status(403).json({ error: 'Vai trò của bạn không được dùng kịch bản này' });
  if (!Array.isArray(sttKeys) || sttKeys.length === 0) return res.status(400).json({ error: 'Danh sách mã trống' });

  const thanhCong = [];
  const loi = [];

  for (const sttKey of sttKeys) {
    try {
      const { headers, row } = await orderService.getByKey(sttKey, { fresh: true }); // BẮT BUỘC đọc thật ở đây
      const giaTriHienTai = row ? row[scenario.column] : null;

      if (!row) {
        loi.push({ sttKey, lyDo: 'Không còn tìm thấy đơn hàng (có thể vừa bị xoá/sửa ở nơi khác)' });
        ghiKhongCho(ghiNhatKyQuetHangLoat({ nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey, trangThaiCu: '', trangThaiMoi: '', ketQua: 'LOI_XAC_NHAN', ghiChu: 'Không tìm thấy khi xác nhận' }));
        continue;
      }
      if (donDaKetThuc(row)) {
        loi.push({ sttKey, lyDo: `Đơn đã ở trạng thái kết thúc "${row.TRANG_THAI_XUONG}" — không thể xác nhận` });
        ghiKhongCho(ghiNhatKyQuetHangLoat({ nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey, trangThaiCu: row.TRANG_THAI_XUONG, trangThaiMoi: '', ketQua: 'LOI_DON_DA_KET_THUC', ghiChu: 'Đơn đã ở trạng thái kết thúc, chuyển sang trạng thái này ở giữa lúc quét và lúc xác nhận' }));
        continue;
      }
      if (scenario.requireStatus && giaTriHienTai !== scenario.requireStatus) {
        loi.push({ sttKey, lyDo: `Trạng thái đã đổi thành '${giaTriHienTai}' trước khi kịp xác nhận` });
        ghiKhongCho(ghiNhatKyQuetHangLoat({ nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey, trangThaiCu: giaTriHienTai, trangThaiMoi: '', ketQua: 'LOI_XAC_NHAN', ghiChu: 'Trạng thái đã đổi trước khi xác nhận' }));
        continue;
      }

      const ketQuaUpdate = await orderService.update(sttKey, {
        [scenario.column]: scenario.setStatus,
        NguoiCapNhatCuoi: user.ten,
        ThoiGianCapNhatCuoi: new Date().toISOString(),
      }, user, { donDaDoc: { headers, row } }); // đã đọc thật ở trên, khỏi đọc lại lần nữa — mỗi mã quét trong lượt
      // xác nhận hàng loạt trước đây tốn 2 lượt đọc toàn bộ tab Don_Hang_ALL, nay chỉ còn 1

      thanhCong.push(sttKey);
      ghiKhongCho(ghiLog({
        nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KICH_BAN_HANG_LOAT',
        sttKey, chiTiet: {
          scenario: scenario.label, cot: scenario.column, tu: giaTriHienTai, sang: scenario.setStatus,
          ...(ketQuaUpdate._daTuDongChuyenTinhTrang ? { tuDongChuyenTinhTrangSang: ketQuaUpdate._tinhTrangTuDongMoi } : {}),
        },
      }));
      ghiKhongCho(ghiNhatKyQuetHangLoat({ nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey, trangThaiCu: giaTriHienTai, trangThaiMoi: scenario.setStatus, ketQua: 'THANH_CONG' }));
    } catch (err) {
      loi.push({ sttKey, lyDo: err.message });
    }
  }

  res.json({ ok: true, thanhCong, loi });
});

module.exports = router;
