// Cảnh báo Telegram QC gộp + tổng kết ngày (02/10/2026, theo yêu cầu người dùng) — cấu hình ở menu QC (khối Cảnh báo Telegram).
//  - FAIL và LỖI API: vẫn gửi NGAY từng tin (qcService#canhBaoTelegram).
//  - CAN_CHECK_LAI: GopCclPhut = 0 -> gửi ngay như cũ; > 0 -> qcService bỏ qua, lịch mỗi phút ở đây gom các dòng qc_log CAN_CHECK_LAI
//    có id > IdCclDaGui, đủ chu kỳ thì gửi 1 tin. Nguồn dữ liệu là qc_log (không có hàng đợi trong bộ nhớ) -> khởi động lại không mất.
//  - Tổng kết ngày: tới GioTongKet (giờ VN) mà hôm nay chưa gửi (NgayTongKetCuoi) -> gửi 1 tin tổng kết các lần QC trong ngày.
const cron = require('node-cron');
const caiDatDbService = require('../caiDatDbService');
const nhatKyDbService = require('../nhatKyDbService');
const telegramService = require('../telegramService');
const { thoiGianVNISOString } = require('../dateUtils');
const qcService = require('./qcService');

const SO_DON_TOI_DA_MOI_TIN = 30; // tin Telegram tối đa 4096 ký tự
const esc = s => String(s ?? '').slice(0, 120).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function gui(text) {
  const { chatId, botToken } = qcService.layTelegram();
  if (!chatId) return { ok: false, loi: 'Chưa có Chat ID' };
  return telegramService.guiTinNhan(chatId, text, botToken);
}

// Gửi gộp các CAN_CHECK_LAI chưa gửi. batBuoc = true: gửi ngay không chờ đủ chu kỳ (khi chuyển về chế độ gửi ngay).
async function guiGopCcl(bayGio = new Date(), batBuoc = false) {
  const ch = caiDatDbService.layTelegramQc();
  if (!ch.gopCclPhut && !batBuoc) return;
  // Đang gộp mà CHƯA có Chat ID (cảnh báo đang tắt): vẫn dời mốc đã xử lý — nhập Chat ID sau đó KHÔNG gửi dồn cả đống CCL cũ.
  if (!ch.chatId) {
    const max = nhatKyDbService.maxQcLogId();
    if (max > ch.idCclDaGui) caiDatDbService.datTelegramQc({ idCclDaGui: max, thoiGianGuiCclCuoi: bayGio.toISOString() });
    return;
  }
  if (!batBuoc && ch.thoiGianGuiCclCuoi && bayGio - new Date(ch.thoiGianGuiCclCuoi) < ch.gopCclPhut * 60000) return;
  const ds = nhatKyDbService.layCclSauId(ch.idCclDaGui);
  if (!ds.length) return;
  const dong = [`🟡 QC CẦN CHECK LẠI — ${ds.length} lần QC${ch.gopCclPhut ? ` (gộp mỗi ${ch.gopCclPhut} phút)` : ''}`];
  for (const d of ds.slice(0, SO_DON_TOI_DA_MOI_TIN)) {
    dong.push(`• <b>${esc(d.STT_Key)}</b> · ${esc(d.LoaiQc)}${d.CheDo === 'AUTO' ? ' · AUTO' : ''}${d.Diem !== '' ? ` · điểm ${esc(d.Diem)}` : ''} — ${esc(d.LyDoKetLuan || d.LyDo)}`);
  }
  if (ds.length > SO_DON_TOI_DA_MOI_TIN) dong.push(`… và ${ds.length - SO_DON_TOI_DA_MOI_TIN} lần khác — xem Log QC (lọc CAN_CHECK_LAI).`);
  const kq = await gui(dong.join('\n'));
  // Gửi lỗi -> giữ nguyên mốc, lượt sau gửi lại (không mất cảnh báo).
  if (kq && kq.ok) caiDatDbService.datTelegramQc({ idCclDaGui: ds[ds.length - 1].id, thoiGianGuiCclCuoi: bayGio.toISOString() });
  else console.error('[QC Telegram] Gửi gộp CAN_CHECK_LAI lỗi:', kq && kq.loi);
}

function taoTinTongKet(ngay) {
  const t = nhatKyDbService.tongKetQcNgay(ngay);
  const dong = [`📊 Tổng kết QC ngày ${ngay}`];
  if (!t.theoKetQua.length) dong.push('Không có lần QC nào.');
  for (const loai of Object.keys(qcService.LOAI_QC)) {
    const cua = t.theoKetQua.filter(d => d.LoaiQc === loai);
    if (!cua.length) continue;
    const dem = kq => cua.filter(d => d.KetQua === kq).reduce((s, d) => s + d.n, 0);
    const auto = cua.filter(d => d.CheDo === 'AUTO').reduce((s, d) => s + d.n, 0);
    dong.push(`<b>${loai}</b>: PASS ${dem('PASS')} · FAIL ${dem('FAIL')} · CẦN CHECK LẠI ${dem('CAN_CHECK_LAI')} · LỖI ${dem('LOI')} (AUTO ${auto})`);
  }
  dong.push(`Chưa đánh giá kết quả thực tế: ${t.chuaDanhGia} · Kinh nghiệm chờ xác nhận: ${t.kinhNghiemChoXacNhan}`);
  if (t.token.length) {
    const gia = Object.fromEntries(caiDatDbService.layGiaTokenQc().map(g => [g.Model, g]));
    let tien = 0;
    let thieuGia = false;
    for (const m of t.token) {
      const g = gia[m.Model];
      if (g) tien += (m.tokenVao * Number(g.GiaVao) + m.tokenRa * Number(g.GiaRa)) / 1e6;
      else thieuGia = true;
      dong.push(`Token ${esc(m.Model)}: input ${m.tokenVao.toLocaleString('vi-VN')} · output ${m.tokenRa.toLocaleString('vi-VN')}`);
    }
    dong.push(`Chi phí AI ước tính: $${tien.toFixed(2)}${thieuGia ? ' (chưa tính model chưa nhập giá)' : ''}`);
  }
  return dong.join('\n');
}

async function guiTongKetNeuDenGio(bayGio = new Date()) {
  const ch = caiDatDbService.layTelegramQc();
  if (!ch.chatId || !ch.gioTongKet) return;
  const vn = thoiGianVNISOString(bayGio);
  const ngay = vn.slice(0, 10);
  if (vn.slice(11, 16) < ch.gioTongKet || ch.ngayTongKetCuoi === ngay) return;
  const kq = await gui(taoTinTongKet(ngay));
  if (kq && kq.ok) caiDatDbService.datTelegramQc({ ngayTongKetCuoi: ngay });
  else console.error('[QC Telegram] Gửi tổng kết lỗi:', kq && kq.loi);
}

// Lưu cấu hình gộp/tổng kết (routes/qc.js). Chuyển gửi ngay -> gộp: chỉ gộp các lần QC từ bây giờ (đã gửi từng tin rồi).
// Chuyển gộp -> gửi ngay: gửi nốt phần đang chờ. Đặt giờ tổng kết đã qua trong hôm nay -> bắt đầu từ ngày mai.
async function luuCauHinhGop({ gopCclPhut, gioTongKet }, bayGio = new Date()) {
  const cu = caiDatDbService.layTelegramQc();
  if (cu.gopCclPhut && !gopCclPhut) await guiGopCcl(bayGio, true);
  const moi = { gopCclPhut, gioTongKet };
  if (!cu.gopCclPhut && gopCclPhut) Object.assign(moi, { idCclDaGui: nhatKyDbService.maxQcLogId(), thoiGianGuiCclCuoi: bayGio.toISOString() });
  const vn = thoiGianVNISOString(bayGio);
  if (gioTongKet && gioTongKet !== cu.gioTongKet && vn.slice(11, 16) >= gioTongKet) moi.ngayTongKetCuoi = vn.slice(0, 10);
  caiDatDbService.datTelegramQc(moi);
}

let dangChay = false;
async function chayLuot(bayGio = new Date()) {
  if (dangChay) return;
  dangChay = true;
  try {
    await guiGopCcl(bayGio);
    await guiTongKetNeuDenGio(bayGio);
  } catch (err) {
    console.error('[QC Telegram] Lỗi lượt gửi gộp/tổng kết:', err.message);
  } finally {
    dangChay = false;
  }
}

function batDauLichTelegramQc() {
  cron.schedule('* * * * *', () => { chayLuot(); });
  console.log('[QC Telegram] Đã bật lịch gửi gộp CẦN CHECK LẠI + tổng kết ngày (mỗi phút; cấu hình ở menu QC).');
}

module.exports = { guiGopCcl, guiTongKetNeuDenGio, taoTinTongKet, luuCauHinhGop, chayLuot, batDauLichTelegramQc };
