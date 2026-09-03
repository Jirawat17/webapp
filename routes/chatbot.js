const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const khachHangService = require('../services/khachHangService');
const { ghiLog, layLichSuTheoDon, layHoatDongGanDay } = require('../services/logService');
const { readTab } = require('../services/sheetsService');
const { parseNgay } = require('../services/dateUtils');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

const LLM_URL = process.env.LLM_API_URL;
const LLM_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'gemini-2.5-flash-lite';
const LLM_MODEL_MANH = process.env.LLM_MODEL_MANH; // tuỳ chọn — model mạnh hơn cho câu hỏi phức tạp

// Giữ đúng quy ước quota cũ: câu hỏi có từ khoá "phân tích/tổng hợp..." mới dùng model mạnh hơn (nếu có cấu hình)
const TU_KHOA_PHUC_TAP = ['phân tích', 'tổng hợp', 'so sánh', 'dự đoán', 'đánh giá'];

// Tối đa số vòng "gọi công cụ rồi hỏi tiếp" — chặn vòng lặp vô hạn nếu model cứ liên tục gọi công cụ
const TOI_DA_VONG_LAP = 4;

// ============================================================
// MÔ TẢ PIPELINE — dùng trong system prompt để chatbot hiểu đúng ý nghĩa từng trạng thái.
// PHẢI khớp với data/pipelineTinhTrang.js — sửa pipeline thì nhớ sửa cả đoạn text này.
// ============================================================
const MO_TA_PIPELINE =
  'Từ 24/08/2026, hệ thống theo dõi tiến trình đơn hàng bằng 3 CỘT RIÊNG (không còn 1 cột duy nhất ' +
  'như trước): TRANG_THAI_XUONG (tiến trình chung), TRANG_THAI_PHOI (lấy phôi), TRANG_THAI_VE_FILE (vẽ file) ' +
  '— lấy phôi và vẽ file là 2 việc ĐỘC LẬP, làm song song, không phải làm tuần tự.\n\n' +
  'Giá trị TRANG_THAI_XUONG theo đúng thứ tự: Chưa xác nhận → Đã xác nhận → ĐÃ SẴN SÀNG CHẠY MÁY (hệ ' +
  'thống tự động chuyển sang trạng thái này khi TRANG_THAI_PHOI="Đã lấy phôi" VÀ TRANG_THAI_VE_FILE=' +
  '"Đã vẽ file" cùng lúc) → Đã sản xuất → Đã đóng gói → IN TRANSIT_Tracking đã hoạt động → ' +
  'DELIVERED_Đã giao đến khách. Nhánh rẽ: LỖI SẢN XUẤT CẦN LÀM LẠI (lỗi khi sản xuất, người phụ ' +
  'trách set tay, sau đó làm lại từ phôi/file), CANCELLED_Đã hủy, REFUNDED_Hoàn đơn (đơn dừng hẳn).\n\n' +
  'Giá trị TRANG_THAI_PHOI: "Chưa lấy phôi" hoặc "Đã lấy phôi". Giá trị TRANG_THAI_VE_FILE: ' +
  '"Chưa vẽ file" hoặc "Đã vẽ file".';

// Rút gọn 1 dòng đơn hàng thành các trường cần thiết cho câu trả lời — dùng chung cho mọi tool trả về đơn hàng
function lamGonDon(r) {
  return {
    ma: r.STT_Key,
    maDonSan: r.MA_DON_HANG_ORDERID,
    kh: r.TenKhachHang || r.MA_KHACH_HANG,
    sanPham: r.TieuDeSanPham || orderService.tieuDeSanPham(r),
    viTriTheu: (r.ViTriTheu || orderService.danhSachViTriTheu(r) || []).join(', '),
    sl: r.SO_LUONG,
    ngayLenDon: r.NGAY_LEN_DON,
    trangThai: r.TRANG_THAI_XUONG,
    hangVanChuyen: r.HANG_VAN_CHUYEN,
    maVanDon: r.TRACKING_ID,
    ghiChu: r.GHI_CHU,
  };
}

function locTheoNgay(list, tuNgay, denNgay) {
  if (!tuNgay && !denNgay) return list;
  return list.filter(r => {
    const ngay = parseNgay(r.NGAY_LEN_DON);
    if (!ngay) return false;
    if (tuNgay && ngay < parseNgay(tuNgay)) return false;
    if (denNgay && ngay > parseNgay(denNgay)) return false;
    return true;
  });
}

// ============================================================
// KHAI BÁO CÔNG CỤ (function calling, chuẩn OpenAI-compatible) — model tự quyết định gọi công cụ
// nào khi cần dữ liệu thật thay vì đoán/bịa. CHÍNH SÁCH PHÂN QUYỀN (cập nhật 24/08/2026, Prompt_Ver_24.docx
// — huỷ chính sách "mọi vai trò như Admin"): TOOLS_QUAN_LY chỉ gửi cho admin — không gửi định nghĩa
// 2 công cụ đó cho vai trò khác (model sẽ không biết chúng tồn tại); thucThiTool() vẫn kiểm tra
// quyền 1 lần nữa cho chắc, phòng trường hợp model tự bịa tên công cụ không có trong danh sách được cấp.
// ============================================================
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'tra_cuu_don_hang',
      description: 'Tra cứu đầy đủ chi tiết 1 đơn hàng theo đúng mã đơn (STT_Key). Dùng khi người hỏi nhắc tới 1 mã đơn cụ thể.',
      parameters: {
        type: 'object',
        properties: { maDon: { type: 'string', description: 'Mã đơn (STT_Key)' } },
        required: ['maDon'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tim_don_hang',
      description: 'Tìm danh sách đơn hàng theo điều kiện lọc, trong phạm vi đơn người hỏi được quyền xem. Trả về tối đa 20 đơn khớp gần nhất kèm tổng số khớp thật (nếu tổng số khớp lớn hơn 20, nói rõ cho người hỏi biết còn nhiều hơn).',
      parameters: {
        type: 'object',
        properties: {
          maKhachHang: { type: 'string', description: 'Mã hoặc tên khách hàng, khớp gần đúng' },
          trangThai: { type: 'string', description: 'Đúng 1 chuỗi trạng thái trong pipeline (xem mô tả pipeline)' },
          tuNgay: { type: 'string', description: 'YYYY-MM-DD' },
          denNgay: { type: 'string', description: 'YYYY-MM-DD' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'thong_ke_don_hang',
      description: 'Đếm số đơn theo nhóm (trạng thái / khách hàng / loại sản phẩm), trong phạm vi đơn người hỏi được quyền xem, lọc thêm được theo khoảng ngày.',
      parameters: {
        type: 'object',
        properties: {
          nhomTheo: { type: 'string', enum: ['trangThai', 'khachHang', 'loai'] },
          tuNgay: { type: 'string', description: 'YYYY-MM-DD' },
          denNgay: { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: ['nhomTheo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tra_cuu_khach_hang',
      description: 'Tìm thông tin khách hàng theo mã hoặc tên, khớp gần đúng.',
      parameters: {
        type: 'object',
        properties: { tuKhoa: { type: 'string' } },
        required: ['tuKhoa'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tra_cuu_lich_su_don',
      description: 'Xem lịch sử thay đổi trạng thái/hoạt động của 1 đơn hàng cụ thể theo mã đơn.',
      parameters: {
        type: 'object',
        properties: { maDon: { type: 'string' } },
        required: ['maDon'],
      },
    },
  },
];

const TOOLS_QUAN_LY = [
  {
    type: 'function',
    function: {
      name: 'tra_cuu_nhan_vien',
      description: 'Danh sách nhân viên và vai trò trong hệ thống.',
      parameters: {
        type: 'object',
        properties: { vaiTro: { type: 'string', description: 'Lọc theo đúng 1 vai trò, bỏ trống để lấy tất cả' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tra_cuu_lich_su_gan_day',
      description: 'Xem hoạt động gần đây trong toàn hệ thống (không giới hạn theo 1 đơn), lọc được theo người dùng hoặc loại hành động.',
      parameters: {
        type: 'object',
        properties: {
          nguoiDung: { type: 'string' },
          hanhDong: { type: 'string' },
          gioiHan: { type: 'number', description: 'Tối đa 50' },
        },
      },
    },
  },
];

// ctx = { user, duLieuTheoQuyen } — duLieuTheoQuyen là đơn hàng ĐÃ lọc theo vai trò + đã gán tên KH
async function thucThiTool(tenHam, thamSo, ctx) {
  switch (tenHam) {
    case 'tra_cuu_don_hang': {
      // Xem 1 đơn theo đúng mã — giống hệt trang chi tiết đơn (order.html), KHÔNG giới hạn theo vai
      // trò (chủ ý: ai có đúng mã đơn cũng xem được chi tiết đơn đó, đúng quy ước hiện có của app).
      const { row } = await orderService.getByKey(thamSo.maDon || '');
      if (!row) return { loi: `Không tìm thấy đơn có mã "${thamSo.maDon}"` };
      const [daGanTen] = await orderService.ganTenKhachHang([row]);
      return lamGonDon(daGanTen);
    }

    case 'tim_don_hang': {
      let list = ctx.duLieuTheoQuyen;
      if (thamSo.maKhachHang) {
        const tk = String(thamSo.maKhachHang).toLowerCase();
        list = list.filter(r => (r.MA_KHACH_HANG || '').toLowerCase().includes(tk) || (r.TenKhachHang || '').toLowerCase().includes(tk));
      }
      if (thamSo.trangThai) list = list.filter(r => r.TRANG_THAI_XUONG === thamSo.trangThai);
      list = locTheoNgay(list, thamSo.tuNgay, thamSo.denNgay);
      return { tongSoKhop: list.length, ketQua: list.slice(0, 20).map(lamGonDon) };
    }

    case 'thong_ke_don_hang': {
      let list = locTheoNgay(ctx.duLieuTheoQuyen, thamSo.tuNgay, thamSo.denNgay);
      const cotNhom = thamSo.nhomTheo === 'khachHang' ? 'TenKhachHang' : thamSo.nhomTheo === 'loai' ? 'LOAI' : 'TRANG_THAI_XUONG';
      const dem = {};
      list.forEach(r => { const v = r[cotNhom] || '(Trống)'; dem[v] = (dem[v] || 0) + 1; });
      return dem;
    }

    case 'tra_cuu_khach_hang': {
      const list = await khachHangService.layDanhSachKhachHang();
      const tk = String(thamSo.tuKhoa || '').toLowerCase();
      return list.filter(kh => kh.ma.toLowerCase().includes(tk) || kh.ten.toLowerCase().includes(tk)).slice(0, 15);
    }

    case 'tra_cuu_lich_su_don': {
      // Giống order.html — không giới hạn theo vai trò, cùng lý do như tra_cuu_don_hang ở trên.
      return await layLichSuTheoDon(thamSo.maDon || '');
    }

    case 'tra_cuu_nhan_vien': {
      // CHỈ admin — chính sách "mọi vai trò như Admin" đã bị huỷ (24/08/2026, Prompt_Ver_24.docx),
      // quay lại phân quyền theo vai trò. Không gửi định nghĩa công cụ này cho vai trò khác admin
      // (xem TOOLS_QUAN_LY phía dưới) — kiểm tra lại 1 lần nữa ở đây phòng model tự bịa tên công cụ.
      if (ctx.user.vaiTro !== 'admin') return { loi: 'Không có quyền tra cứu danh sách nhân viên.' };
      const { rows } = await readTab('NguoiDung');
      let list = rows.map(r => ({ ten: r.Ten, vaiTro: r.VaiTro, team: r.Team, kichHoat: r.KichHoat }));
      if (thamSo.vaiTro) list = list.filter(nv => nv.vaiTro === thamSo.vaiTro);
      return list;
    }

    case 'tra_cuu_lich_su_gan_day': {
      // CHỈ admin — cùng lý do như tra_cuu_nhan_vien ở trên.
      if (ctx.user.vaiTro !== 'admin') return { loi: 'Không có quyền tra cứu lịch sử hoạt động chung.' };
      return await layHoatDongGanDay(thamSo);
    }

    default:
      return { loi: 'Không có công cụ tên: ' + tenHam };
  }
}

router.post('/hoi', async (req, res) => {
  const { cauHoi, lichSuHoiThoai } = req.body;
  const user = req.session.user;

  if (!cauHoi || !cauHoi.trim()) return res.status(400).json({ error: 'Thiếu câu hỏi' });
  if (!LLM_URL || !LLM_KEY) {
    return res.status(500).json({ error: 'Chatbot chưa được cấu hình — thiếu LLM_API_URL hoặc LLM_API_KEY trong .env' });
  }

  const { rows } = await orderService.getAll();
  // Đơn hàng lấy được ở đây đã tự lọc đúng theo vai trò (san_xuat chỉ thấy đơn từ "ĐÃ SẴN SÀNG
  // CHẠY MÁY" trở đi — xem services/orderService.js, filterForRole).
  const duLieuTheoQuyen = await orderService.ganTenKhachHang(orderService.filterForRole(rows, user));

  // Thống kê nhanh tính sẵn (không tốn vòng gọi công cụ nào) — đủ trả lời các câu hỏi tổng quan ngay,
  // chỉ cần tra cứu thêm khi hỏi cụ thể (1 đơn, 1 khách hàng, lịch sử...).
  const thongKeNhanh = {};
  duLieuTheoQuyen.forEach(r => { const v = r.TRANG_THAI_XUONG || '(Trống)'; thongKeNhanh[v] = (thongKeNhanh[v] || 0) + 1; });

  const tools = user.vaiTro === 'admin' ? [...TOOLS, ...TOOLS_QUAN_LY] : TOOLS;

  const systemPrompt =
    'Bạn là trợ lý của xưởng thêu HanhPhuc99, trả lời bằng tiếng Việt, ngắn gọn, chính xác.\n\n' +
    'Người hỏi có vai trò: ' + user.vaiTro + '.\n\n' +
    MO_TA_PIPELINE + '\n\n' +
    'Thống kê nhanh số đơn theo trạng thái, trong phạm vi người hỏi được xem (đã tính sẵn, đủ dùng ' +
    'cho câu hỏi tổng quan, KHÔNG cần gọi công cụ để lấy lại số này):\n' + JSON.stringify(thongKeNhanh) + '\n\n' +
    'Khi cần thông tin CỤ THỂ hơn số liệu trên (tra 1 đơn theo mã, tìm theo khách hàng/khoảng ngày, ' +
    'xem lịch sử, tra khách hàng, tra nhân viên...), PHẢI gọi đúng công cụ tương ứng để lấy dữ liệu ' +
    'thật — KHÔNG được đoán hay bịa số liệu. Nếu không có công cụ phù hợp hoặc tra cứu xong vẫn không ' +
    'thấy, nói rõ với người hỏi là không tìm thấy/không có, đừng tự suy diễn.';

  let messages = [
    { role: 'system', content: systemPrompt },
    ...(Array.isArray(lichSuHoiThoai) ? lichSuHoiThoai.slice(-6) : []),
    { role: 'user', content: cauHoi },
  ];

  const dungModelManh = LLM_MODEL_MANH && TU_KHOA_PHUC_TAP.some(tk => cauHoi.toLowerCase().includes(tk));
  const model = dungModelManh ? LLM_MODEL_MANH : LLM_MODEL;
  const ctx = { user, duLieuTheoQuyen };

  async function goiLLM(dungCongCu) {
    const llmRes = await fetch(LLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_KEY}` },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 700,
        ...(dungCongCu ? { tools, tool_choice: 'auto' } : {}),
      }),
    });
    if (!llmRes.ok) {
      const chiTietLoi = await llmRes.text();
      throw new Error('Lỗi gọi LLM (' + llmRes.status + '): ' + chiTietLoi.slice(0, 200));
    }
    return llmRes.json();
  }

  let traLoi = null;
  let dungCongCuDuocKhong = true; // tắt hẳn nếu vòng đầu tiên báo lỗi — có thể do nhà cung cấp không hỗ trợ "tools"

  for (let vong = 0; vong < TOI_DA_VONG_LAP; vong++) {
    let data;
    try {
      data = await goiLLM(dungCongCuDuocKhong);
    } catch (err) {
      if (vong === 0 && dungCongCuDuocKhong) {
        // Thử lại 1 lần KHÔNG kèm "tools" — phòng trường hợp nhà cung cấp/model chưa hỗ trợ function
        // calling và trả lỗi ngay khi thấy field lạ, thay vì để cả tính năng chatbot sập hẳn.
        dungCongCuDuocKhong = false;
        data = await goiLLM(false);
      } else {
        throw err;
      }
    }

    const msg = data.choices?.[0]?.message;
    const toolCalls = dungCongCuDuocKhong ? msg?.tool_calls : null;

    if (!toolCalls || toolCalls.length === 0) {
      traLoi = msg?.content || 'Xin lỗi, tôi chưa có câu trả lời cho câu hỏi này.';
      break;
    }

    messages.push(msg);
    for (const call of toolCalls) {
      let ketQua;
      try {
        const thamSo = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        ketQua = await thucThiTool(call.function.name, thamSo, ctx);
      } catch (err) {
        ketQua = { loi: 'Lỗi khi tra cứu: ' + err.message };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(ketQua) });
    }
  }

  if (traLoi === null) {
    traLoi = 'Câu hỏi này cần tra cứu nhiều bước quá, tôi chưa trả lời được — thử hỏi cụ thể hơn nhé.';
  }

  await ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'CHATBOT_HOI',
    chiTiet: { cauHoi, traLoi: traLoi.slice(0, 300) },
  });

  res.json({ traLoi });
});

module.exports = router;
