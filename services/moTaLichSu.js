// Mô tả lịch sử DỄ ĐỌC cho mọi HanhDong (bổ sung 27/09/2026, theo yêu cầu người dùng) — dùng CHUNG cho
// Chi tiết đơn (routes/orders.js GET /:sttKey) và menu "Lịch sử" (routes/hoatDong.js), để 2 nơi luôn viết
// giống nhau. Module THUẦN: nhận 1 dòng lich_su_hoat_dong, trả:
//   { moTa: 'gán đơn vào Xưởng BN', thayDoi: [{ nhan, tu, sang }], mo: bool }
// - moTa: vế hành động, KHÔNG gồm tên người làm (giao diện tự ghép "Nguyễn Văn A — ...").
// - thayDoi: từng giá trị "trước -> sau"; tu === null = log cũ không lưu giá trị trước (KHÔNG suy đoán).
// - mo: lượt quét chỉ để xem / bị từ chối / lỗi — không đổi gì ở đơn, giao diện hiện mờ.
// anXuong = người xem là admin -> ẩn MỌI tên Xưởng (cùng quy tắc orderService.js#anXuongVoiAdmin).

const NHAN_COT = {
  TRANG_THAI_XUONG: 'Trạng thái chung', TRANG_THAI_PHOI: 'Phôi', TRANG_THAI_VE_FILE: 'Vẽ file',
  GHI_CHU: 'Ghi chú', GHI_CHU_XUONG: 'Ghi chú xưởng', GHI_CHU_XUONG_NOI_BO: 'Ghi chú xưởng (bản trong app)', GHI_CHU_VE_FILE: 'Ghi chú vẽ file', GHI_CHU_CHAY_MAY: 'Ghi chú chạy máy',
  NGUOI_CHAY_MAY: 'Người chạy máy', NGUOI_VE_FILE: 'Người vẽ file', NGUOI_VAN_HANH: 'Người vận hành',
  TRACKING_ID: 'Mã tracking', HANG_VAN_CHUYEN: 'Hãng vận chuyển', TRANG_THAI_TRACKING: 'Trạng thái vận chuyển',
  TRONG_LUONG: 'Trọng lượng', AUTO_TRACKING: 'Tự mua tracking', IN_LABEL: 'Đã in label', TAM_THOI: 'Chờ tem GKE',
  XUONG: 'Xưởng', DON_UU_TIEN: 'Ưu tiên', QUOC_GIA: 'Quốc gia', KHACH_HANG: 'Khách hàng',
  Ten_Kich_Ban: 'Tên kịch bản', Cot: 'Cột', Trang_Thai_Yeu_Cau: 'Trạng thái yêu cầu', Trang_Thai_Sau: 'Trạng thái sau',
  Nguoi_Thuc_Hien: 'Người thực hiện',
};
const NHAN_MOC_ANH = {
  da_san_xuat: 'ĐÃ SẢN XUẤT', da_dan_tem: 'ĐÃ DÁN TEM',
  ve_file: 'file thêu', ve_file_2: 'file thêu thứ 2', ve_file_3: 'file thêu thứ 3',
};
const NHAN_LOAI_SHEET = { GHI_CHU: 'ghi chú xưởng', TRACKING: 'tracking', DELIVERED: 'Delivered' };
const HANH_DONG_MO = new Set([
  'QUET_TRA_CUU', 'QUET_TRA_CUU_LOI', 'QUET_LOI', 'QUET_SAI_TRANG_THAI', 'QUET_CHAN_DON_KET_THUC',
  'QUET_KIEM_TRA_OK', 'QUET_KIEM_TRA_SAI_TRANG_THAI', 'QUET_KIEM_TRA_KHONG_TIM_THAY', 'QUET_KIEM_TRA_CHAN_DON_KET_THUC',
]);
const LA_HE_THONG = ten => /^Hệ thống/.test(ten || '');
const COT_TRANG_THAI = ['TRANG_THAI_XUONG', 'TRANG_THAI_PHOI', 'TRANG_THAI_VE_FILE'];

const nhanCot = cot => NHAN_COT[cot] || cot;
const gt = v => (v === undefined || v === null || v === '' ? '(trống)' : String(v));
// tu === undefined -> null (không rõ, log cũ); còn lại hiển thị "(trống)" cho rỗng.
const doi = (nhan, tu, sang) => ({ nhan, tu: tu === undefined ? null : gt(tu), sang: gt(sang) });
const xuongHoacChuaGan = x => x || '(chưa gán)';
const phoi = c => [c.loai, c.kichThuoc, c.mauSac].filter(Boolean).join(' ');
const soDon = c => (Array.isArray(c.sttKeys) ? c.sttKeys.length : (c.soLuong || 0));

function docChiTiet(chuoi) {
  try {
    const v = JSON.parse(chuoi);
    return v && typeof v === 'object' ? v : { _chu: String(v) };
  } catch (e) {
    return chuoi ? { _chu: String(chuoi) } : {};
  }
}

// Trạng thái tự chuyển kèm theo (vd "Đã in mã" -> "ĐÃ SẴN SÀNG CHẠY MÁY" khi phôi + file cùng xong).
const tuChuyen = c => (c.tuDongChuyenTinhTrangSang ? [doi('Trạng thái chung (tự chuyển)', undefined, c.tuDongChuyenTinhTrangSang)] : []);
// { cot: { tu, sang } } -> thayDoi (thayDoiKem của nút superadmin, thayDoi của sửa kịch bản).
const tuBangThayDoi = bang => Object.entries(bang || {}).map(([cot, v]) => doi(nhanCot(cot), v.tu, v.sang));

function moTaLichSu(dong, { anXuong = false } = {}) {
  const c = docChiTiet(dong.ChiTiet);
  const hd = dong.HanhDong;
  const kq = (moTa, thayDoi = []) => ({ moTa, thayDoi, mo: HANH_DONG_MO.has(hd) });

  switch (hd) {
    case 'QUET_KICH_BAN':
    case 'QUET_KICH_BAN_HANG_LOAT':
      return kq(`quét "${c.scenario || '?'}"${hd === 'QUET_KICH_BAN_HANG_LOAT' ? ' (xác nhận hàng loạt)' : ''}`,
        [doi(nhanCot(c.cot || 'TRANG_THAI_XUONG'), c.tu, c.sang), ...tuChuyen(c)]);
    case 'CHUYEN_TRANG_THAI_HANG_LOAT': {
      const moTa = c.superadminBoQuaRangBuoc ? 'chuyển trạng thái thủ công SUPERADMIN (bỏ qua ràng buộc)'
        : c.lyDo ? c.lyDo
        : 'đổi trạng thái (hàng loạt)';
      return kq(moTa, [doi(nhanCot(c.cot || 'TRANG_THAI_XUONG'), c.tu, c.sang), ...tuBangThayDoi(c.thayDoiKem), ...tuChuyen(c)]);
    }
    case 'CAP_NHAT_DON': {
      const coTruoc = c._truocKhiSua && typeof c._truocKhiSua === 'object';
      const truoc = coTruoc ? c._truocKhiSua : {};
      const thayDoi = Object.keys(c)
        .filter(k => !k.startsWith('_') && !['tuDongChuyenTinhTrangSang', 'NguoiCapNhatCuoi', 'ThoiGianCapNhatCuoi'].includes(k))
        .filter(k => !(anXuong && k === 'XUONG'))
        // Log cũ (07/09-27/09/2026): _truocKhiSua chỉ có cột trạng thái ĐÃ ĐỔI -> cột trạng thái vắng mặt là không đổi.
        .filter(k => !(coTruoc && COT_TRANG_THAI.includes(k) && !(k in truoc)))
        .map(k => doi(nhanCot(k), truoc[k], c[k]));
      return kq('sửa đơn', [...thayDoi, ...tuChuyen(c)]);
    }
    case 'UPLOAD_ANH':
      return kq(`tải ảnh ${NHAN_MOC_ANH[c.moc] || c.moc || ''}`.trim(), c.sang ? [doi('Trạng thái chung', c.tu, c.sang)] : []);
    case 'GAN_XUONG': {
      const tuDong = LA_HE_THONG(dong.NguoiDung);
      const lyDo = c.lyDo ? ` (${c.lyDo})` : '';
      if (anXuong) return kq(`${tuDong ? 'tự ' : ''}${c.sangXuong ? 'gán Xưởng cho đơn' : 'gỡ Xưởng của đơn'}${lyDo}`);
      const moTa = c.sangXuong ? `${tuDong ? 'tự ' : ''}gán đơn vào Xưởng ${c.sangXuong}${lyDo}` : `gỡ đơn khỏi Xưởng ${c.tuXuong || '?'}${lyDo}`;
      return kq(moTa, [doi('Xưởng', xuongHoacChuaGan(c.tuXuong), xuongHoacChuaGan(c.sangXuong))]);
    }
    case 'CHI_DINH_NGUOI_CHAY_MAY':
      return kq(`chỉ định ${c.nguoiDuocChiDinh || '?'} chạy máy`,
        [doi('Người chạy máy', c.nguoiCu, c.nguoiDuocChiDinh), doi('Trạng thái chung', c.tuTrangThai, c.sang)]);
    case 'CHI_DINH_NGUOI_VE_FILE':
      return kq(`chỉ định ${c.nguoiDuocChiDinh || '?'} vẽ file`,
        [doi('Người vẽ file', c.nguoiCu, c.nguoiDuocChiDinh), doi('Vẽ file', c.tuTrangThai, c.sang)]);
    case 'DANH_DAU_UU_TIEN':
      return kq(c.uuTien ? 'đánh dấu đơn ưu tiên' : 'bỏ đánh dấu ưu tiên',
        [doi('Ưu tiên', c.truoc === undefined ? undefined : (c.truoc ? 'Có' : 'Không'), c.uuTien ? 'Có' : 'Không')]);
    case 'MUA_TRACKING_THU_CONG':
    case 'TU_DONG_MUA_TRACKING':
      return kq(`${hd === 'TU_DONG_MUA_TRACKING' ? 'tự động ' : ''}mua tracking GKE`,
        [doi('Mã tracking', undefined, c.trackingNum), doi('Hãng vận chuyển', undefined, c.hangVanChuyen)]);
    case 'IN_LABEL':
      return kq(`in label${c.trackingNum ? ` (tracking ${c.trackingNum})` : ''}`);
    case 'DUNG_CHUNG_TRACKING':
      return kq(`gán tracking chung của đơn ${c.donMua || '?'} (nhóm DonNhieuAo ${c.nhom || '?'})`,
        [doi('Mã tracking', undefined, c.trackingNum), doi('Hãng vận chuyển', undefined, c.hangVanChuyen)]);
    case 'TRU_KHO_PHOI_TU_DON':
      return kq(`trừ kho ${Math.abs(Number(c.soLuong) || 0)} phôi ${phoi(c)}`.trim());
    case 'HOAN_KHO_PHOI_TU_DON':
      return kq(`hoàn kho ${Math.abs(Number(c.soLuong) || 0)} phôi ${phoi(c)}`.trim());
    case 'NHAP_KHO_PHOI':
      return kq(`nhập kho ${c.soLuong ?? '?'} phôi ${phoi(c)}${c.ghiChu ? ` — ${c.ghiChu}` : ''}`);
    case 'XAC_NHAN_HANG_LOAT':
      return kq(`tạo Đơn hàng loạt ${c.maDonHangLoat || ''}${c.tenNhom ? ` "${c.tenNhom}"` : ''} (${soDon(c)} đơn)`);
    case 'THEM_DON_HANG_LOAT':
      return kq(`thêm ${soDon(c)} đơn vào Đơn hàng loạt ${c.maDonHangLoat || ''}`);
    case 'XOA_DON_HANG_LOAT':
      return kq(`bỏ đơn khỏi Đơn hàng loạt ${c.maDonHangLoat || ''}`);
    case 'XOA_NHOM_HANG_LOAT':
      return kq(`xoá Đơn hàng loạt ${c.maDonHangLoat || ''}${c.tenNhom ? ` "${c.tenNhom}"` : ''}`);
    case 'DOI_TEN_HANG_LOAT':
      return kq(`đổi tên Đơn hàng loạt ${c.maDonHangLoat || ''}`, [doi('Tên nhóm', c.tenCu, c.tenMoi)]);
    case 'DOI_NGUONG_HANG_LOAT':
      return kq('đổi ngưỡng so ảnh Đơn hàng loạt', [doi('Ngưỡng', c.nguongCu, c.nguong)]);
    case 'XOA_DU_LIEU_DON_HANG':
      return kq(`xoá dữ liệu ${soDon(c)} đơn`);
    case 'KHOI_PHUC_DU_LIEU_DON_HANG':
      return kq(`khôi phục dữ liệu ${soDon(c)} đơn`);
    case 'QUET_TRA_CUU':
      return kq('quét xem đơn');
    case 'QUET_TRA_CUU_LOI':
      return kq('quét xem — không tìm thấy đơn');
    case 'QUET_LOI':
      return kq(`quét "${c.scenario || '?'}" lỗi — ${c.loi || c._chu || 'không rõ'}`);
    case 'QUET_SAI_TRANG_THAI':
    case 'QUET_KIEM_TRA_SAI_TRANG_THAI':
      return kq(`quét ${hd === 'QUET_KIEM_TRA_SAI_TRANG_THAI' ? 'kiểm tra ' : ''}"${c.scenario || '?'}" bị từ chối — ${nhanCot(c.cot)} đang "${c.trangThaiHienTai || ''}", cần "${c.trangThaiCanCo || ''}"`);
    case 'QUET_CHAN_DON_KET_THUC':
    case 'QUET_KIEM_TRA_CHAN_DON_KET_THUC':
      return kq(`quét ${hd === 'QUET_KIEM_TRA_CHAN_DON_KET_THUC' ? 'kiểm tra ' : ''}"${c.scenario || '?'}" bị chặn — đơn đã ở "${c.tinhTrang || ''}"`);
    case 'QUET_KIEM_TRA_KHONG_TIM_THAY':
      return kq(`quét kiểm tra "${c.scenario || '?'}" — ${c.lyDo || 'không tìm thấy đơn'}`);
    case 'QUET_KIEM_TRA_OK':
      return kq(`quét kiểm tra "${c.scenario || '?'}" — hợp lệ, sẽ chuyển ${nhanCot(c.cot)} sang "${c.seChuyenSang || ''}"`);
    case 'QUET_HANG_LOAT':
      return kq(`quét so ảnh hàng loạt ${c.soDonDaChon ?? '?'} đơn${c.daHuy ? ' (đã huỷ giữa chừng)' : ''}`);
    case 'QUET_HANG_LOAT_LOI':
      return kq(`quét so ảnh hàng loạt ${c.soDonDaChon ?? '?'} đơn — lỗi: ${c.loi || ''}`);
    case 'THEM_KICH_BAN':
      return kq(`thêm kịch bản "${c.tenKichBan || ''}"`);
    case 'SUA_KICH_BAN':
      return kq(`sửa kịch bản "${c.tenKichBan || ''}"`, tuBangThayDoi(c.thayDoi));
    case 'XOA_KICH_BAN':
      return kq(`xoá kịch bản "${c.tenKichBan || ''}"`);
    case 'CAU_HINH_TEAM_XUONG':
      if (anXuong) return kq(`đổi Xưởng mặc định của Team ${c.team || ''}`);
      return kq(`đặt Xưởng mặc định cho Team ${c.team || ''}`, [doi('Xưởng', c.tu === undefined ? undefined : (c.tu || '(không tự gán)'), c.xuong || '(không tự gán)')]);
    case 'CAU_HINH_NHOM_HANG': {
      const tenNhom = n => (n ? `Nhóm ${n}` : undefined);
      if (c.thaoTac === 'them') return kq(`thêm loại "${c.ten || ''}" vào Nhóm ${c.nhom || '?'} (Nhóm hàng)`, [doi('Keyword', undefined, c.tuKhoa || '')]);
      if (c.thaoTac === 'xoa') return kq(`xoá loại "${c.ten || ''}" khỏi Nhóm ${c.nhom || '?'} (Nhóm hàng)`, [doi('Keyword', c.tuKhoa || '', undefined)]);
      const t = c.truoc || {};
      return kq(`sửa loại "${c.ten || ''}" (Nhóm hàng)`, [
        t.ten !== c.ten && doi('Tên loại', t.ten, c.ten),
        t.nhom !== c.nhom && doi('Nhóm', tenNhom(t.nhom), tenNhom(c.nhom)),
        t.tuKhoa !== c.tuKhoa && doi('Keyword', t.tuKhoa, c.tuKhoa),
      ].filter(Boolean));
    }
    case 'SUA_GHI_CHU_XUONG': {
      const sh = c.sheet || {};
      const ketQuaSheet = sh.ketQua === 'OK'
        ? `đã ghi vào Sheet Seller (tab "${sh.tab}", dòng ${sh.dong})`
        : `CHƯA ghi được vào Sheet Seller — ${sh.lyDo || 'không rõ lý do'}`;
      return kq(`sửa ghi chú xưởng — ${ketQuaSheet}`, [doi('Ghi chú xưởng', c.tu, c.sang)]);
    }
    case 'XUAT_PDF_THUE_TEAM_KHAC':
      return kq(`xuất PDF THUÊ TEAM KHÁC (${c.tenFile || '?'}${c.soDon > 1 ? `, cùng ${c.soDon} đơn` : ''})${c.soAnhLoi ? ` — THIẾU ${c.soAnhLoi} ẢNH` : ''}`,
        (c.anhLoi || []).map(l => doi('Ảnh thiếu', undefined, l)));
    case 'GHI_SHEET_SELLER': {
      const nhan = NHAN_LOAI_SHEET[c.loai] || c.loai || '';
      if (c.ketQua === 'OK') return kq(`ghi ${nhan} vào Sheet Seller (tab "${c.tab}", dòng ${c.dong})`, tuBangThayDoi(c.thayDoi));
      return kq(`ghi ${nhan} vào Sheet Seller THẤT BẠI — ${c.lyDo || 'không rõ lý do'}`,
        Object.entries(c.giaTri || {}).map(([cot, v]) => doi(nhanCot(cot), undefined, v)));
    }
    case 'DANG_NHAP':
      return kq('đăng nhập');
    case 'CHATBOT_HOI':
      return kq(`hỏi trợ lý: "${String(c.cauHoi || '').slice(0, 120)}"`);
    default:
      // Hành động chưa có câu mô tả riêng: tên mã dễ đọc + nguyên chi tiết đã lưu (không mất thông tin).
      return kq(`${String(hd || '').toLowerCase().replace(/_/g, ' ')}${c._chu ? ` — ${c._chu}` : ''}`,
        Object.entries(c).filter(([k]) => k !== '_chu').map(([k, v]) => doi(nhanCot(k), undefined, typeof v === 'object' ? JSON.stringify(v) : v)));
  }
}

module.exports = { moTaLichSu, docChiTiet };
