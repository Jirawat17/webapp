const cron = require('node-cron');
const orderService = require('./orderService');
const alertService = require('./alertService');
const telegramService = require('./telegramService');
const { updateCells } = require('./sheetsService');

// Thứ tự tăng dần — chỉ gửi Telegram khi mức MỚI cao hơn mức ĐÃ GỬI trước đó, tránh spam mỗi 30 phút
const MUC_THU_TU = { VANG: 1, CAM: 2, DO: 3 };

async function chayKiemTraCanhBao() {
  try {
    const { headers, rows } = await orderService.getAll();
    let soCanhBaoDaGui = 0;

    for (const don of rows) {
      const mucMoi = alertService.tinhMucCanhBao(don);
      const mucDaGui = don.CanhBaoDaGui || '';

      if (mucMoi && MUC_THU_TU[mucMoi] > (MUC_THU_TU[mucDaGui] || 0)) {
        await telegramService.guiCanhBao(mucMoi, don);
        await updateCells(orderService.TAB, headers, don._row, { CanhBaoDaGui: mucMoi });
        soCanhBaoDaGui++;
      } else if (!mucMoi && mucDaGui) {
        // Đơn đã xong / bị huỷ → xoá cờ để nếu dòng này được tái sử dụng cho đơn khác thì không dính cờ cũ
        await updateCells(orderService.TAB, headers, don._row, { CanhBaoDaGui: '' });
      }

      if (alertService.sapDenHanShip(don) && String(don.NhacShipDaGui).toUpperCase() !== 'TRUE') {
        await telegramService.guiCanhBao('NHAC_SHIP', don);
        await updateCells(orderService.TAB, headers, don._row, { NhacShipDaGui: 'TRUE' });
        soCanhBaoDaGui++;
      }
    }

    console.log(`[CanhBao] Kiểm tra xong lúc ${new Date().toLocaleString('vi-VN')} — đã gửi ${soCanhBaoDaGui} cảnh báo.`);
  } catch (err) {
    console.error('[CanhBao] Lỗi khi chạy kiểm tra:', err.message);
  }
}

function batDauLichCanhBao() {
  // Mỗi 30 phút — đủ nhanh để không bỏ lỡ, không quá dày để tránh vượt quota Google Sheets API
  cron.schedule('*/30 * * * *', chayKiemTraCanhBao);
  console.log('[CanhBao] Đã bật lịch kiểm tra cảnh báo (mỗi 30 phút).');
}

module.exports = { batDauLichCanhBao, chayKiemTraCanhBao };
