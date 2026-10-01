// Sửa dữ liệu gửi GKE cho đơn đã chuyển MUA THỦ CÔNG (01/10/2026, theo yêu cầu người dùng) — dùng chung cho hộp đỏ ở
// tracking.html và orders.html. Dữ liệu: d.thongTinGke = [{ truong, nhan, goc, sua }] (routes/tracking.js GET /canh-bao-thu-cong).
// Lưu vào SQLite (cột THONG_TIN_GKE_CHO_DON_LOI), CHỈ dùng khi gửi GKE, KHÔNG ghi Google Sheet.
// Trang dùng file này phải có sẵn hàm toàn cục taiCanhBaoThuCong() để vẽ lại hộp đỏ sau khi lưu/xoá.

function htmlSuaThongTinGke(d) {
  const ds = d.thongTinGke || [];
  if (!ds.length) return '';
  const id = 'sua-gke-' + d.sttKey.replace(/[^A-Za-z0-9_-]/g, '_');
  const dangSua = ds.filter(t => t.sua);
  return `
    <div style="flex-basis:100%;margin:2px 0 4px;padding:8px 10px;background:var(--color-surface);color:var(--color-text);border-radius:6px;font-size:0.85rem">
      ${dangSua.map(t => `
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
          <span>Đang dùng khi gửi GKE: <strong>${escapeHtml(t.nhan)} = ${escapeHtml(t.sua)}</strong> <span style="color:var(--color-text-muted)">(gốc: ${escapeHtml(t.goc || '(trống)')})</span></span>
          <button type="button" class="btn-hanh-dong phu nguy-hiem" style="padding:3px 8px;font-size:0.78rem"
            data-stt="${escapeHtml(d.sttKey)}" data-truong="${escapeHtml(t.truong)}" data-nhan="${escapeHtml(t.nhan)}"
            onclick="xoaThongTinGke(this)">Xoá</button>
        </div>`).join('')}
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <label for="${id}-truong" style="font-weight:600">Sửa dữ liệu gửi GKE:</label>
        <select id="${id}-truong" onchange="hienGocThongTinGke('${id}')">${ds.map(t => `<option value="${escapeHtml(t.truong)}" data-goc="${escapeHtml(t.goc)}">${escapeHtml(t.nhan)}</option>`).join('')}</select>
        <input id="${id}-gia-tri" placeholder="Giá trị mới" maxlength="200" style="min-width:0;flex:1 1 140px;max-width:260px">
        <button type="button" class="btn-hanh-dong phu" style="padding:3px 10px;font-size:0.8rem" data-stt="${escapeHtml(d.sttKey)}" onclick="luuThongTinGke(this, '${id}')">Lưu</button>
        <span id="${id}-goc" style="color:var(--color-text-muted)">Gốc: ${escapeHtml(ds[0].goc || '(trống)')}</span>
      </div>
      <div style="color:var(--color-text-muted);margin-top:4px">Chỉ dùng khi mua tracking GKE — Google Sheet giữ nguyên. Lưu xong bấm "Mua ngay" hoặc "Cho tự động thử lại".</div>
    </div>`;
}

function hienGocThongTinGke(id) {
  const o = document.getElementById(id + '-truong');
  document.getElementById(id + '-goc').textContent = 'Gốc: ' + (o.selectedOptions[0].dataset.goc || '(trống)');
}

async function guiThongTinGke(btn, sttKey, truong, giaTri) {
  btn.disabled = true;
  try {
    await apiFetch('/tracking/thong-tin-gke', { method: 'POST', body: JSON.stringify({ sttKey, truong, giaTri }) });
    await taiCanhBaoThuCong();
  } catch (e) {
    alert('Không lưu được: ' + e.message);
    btn.disabled = false;
  }
}

function luuThongTinGke(btn, id) {
  const o = document.getElementById(id + '-truong');
  const giaTri = document.getElementById(id + '-gia-tri').value.trim();
  if (!giaTri) { alert('Nhập giá trị mới trước khi lưu.'); return; }
  const nhan = o.selectedOptions[0].textContent;
  if (!confirm(`Đơn ${btn.dataset.stt}: dùng ${nhan} = "${giaTri}" khi gửi GKE?\n(Gốc: ${o.selectedOptions[0].dataset.goc || '(trống)'} — Google Sheet giữ nguyên.)`)) return;
  guiThongTinGke(btn, btn.dataset.stt, o.value, giaTri);
}

function xoaThongTinGke(btn) {
  if (!confirm(`Đơn ${btn.dataset.stt}: xoá giá trị sửa tay của ${btn.dataset.nhan}, quay về dữ liệu gốc khi gửi GKE?`)) return;
  guiThongTinGke(btn, btn.dataset.stt, btn.dataset.truong, null);
}
