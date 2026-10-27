// fetch của Node chỉ báo "fetch failed" — nguyên nhân thật (ECONNRESET, UND_ERR_SOCKET "other side closed", ENOTFOUND, lỗi chứng chỉ...) nằm
// trong err.cause (28/10/2026: lỗi tạo đơn KL chỉ hiện "fetch failed"). Dùng cho lỗi mạng KL / HPW (klService, hpwService).
function moTaLoiMang(err) {
  const c = err && err.cause;
  const chiTiet = c ? [c.code, c.message].filter(Boolean).join(' ') : '';
  return chiTiet && chiTiet !== err.message ? `${err.message} (${chiTiet})` : err.message;
}

module.exports = { moTaLoiMang };
