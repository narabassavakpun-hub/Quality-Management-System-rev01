// ===== เทมเพลตอีเมลแจ้ง COO — เนื้อหาเดียวกับกล่อง "ข้อมูล NCR" บนหน้าจอ (S128) =====
const DISPOSITION_LABELS = {
  return: 'ส่งคืน Supplier (Return)',
  rework: 'แก้ไข (Rework)',
  uai: 'ยอมรับใช้พิเศษ (UAI)',
  scrap: 'ทำลาย (Scrap)',
  re_inspect: 'ตรวจซ้ำ (Re-inspect)',
};

const RETURN_NOTE_TH = 'ตีกลับสินค้า 100% เนื่องจากไม่ผ่านมาตรฐานการสุ่มตรวจ';
const RETURN_NOTE_EN = '100% product return — failed the sampling inspection standard';

// อีเมล HTML ต้อง escape เอง (mail client ไม่มี CSP/React ช่วยกัน XSS เหมือนหน้าเว็บ)
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildNcrInfoHtml(ncr, items) {
  const itemsHtml = items.map((item) => `
    <div style="border:1px solid #D1D5DB;border-radius:8px;overflow:hidden;margin-bottom:12px;">
      <div style="background:#FEF2F2;padding:10px 14px;">
        <div style="font-weight:600;font-size:14px;color:#1F2937;">
          ${esc(item.item_name)}${item.product_code ? ` <span style="color:#6B7280;font-weight:400;">(${esc(item.product_code)})</span>` : ''}
        </div>
        <div style="font-size:12px;color:#6B7280;margin-top:4px;">
          รับเข้า: <b>${esc(item.qty_received)}</b> &nbsp; สุ่มตรวจ: <b>${esc(item.qty_sampled)}</b> &nbsp;
          ไม่ผ่าน: <b style="color:#DC2626;">${esc(item.qty_failed)}</b>
        </div>
        ${item.defect_category_name ? `<div style="font-size:12px;color:#6B7280;margin-top:2px;">กลุ่มปัญหา: ${esc(item.defect_category_name)}</div>` : ''}
        ${item.defect_detail ? `<div style="font-size:12px;color:#6B7280;margin-top:2px;">รายละเอียด: ${esc(item.defect_detail)}${item.defect_detail_en ? ` / ${esc(item.defect_detail_en)}` : ''}</div>` : ''}
        ${(item.claim_value_thb || item.claim_value_usd) ? `<div style="font-size:12px;color:#1F2937;margin-top:4px;">มูลค่าสินค้าเคลม (THB): <b>${esc(item.claim_value_thb || '-')}</b> &nbsp; (USD): <b>${esc(item.claim_value_usd || '-')}</b></div>` : ''}
        ${ncr.disposition === 'return' ? `<div style="margin-top:6px;padding:6px 8px;border:1px solid #DC2626;background:#FEF2F2;color:#DC2626;font-weight:600;font-size:12px;border-radius:4px;">${RETURN_NOTE_TH}<br/>${RETURN_NOTE_EN}</div>` : ''}
      </div>
    </div>
  `).join('');

  const dispositionHtml = ncr.disposition ? `
    <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px 14px;margin-top:8px;">
      <div style="font-weight:600;color:#1A3A5C;font-size:13px;margin-bottom:4px;">ข้อมูลการจัดการของ QC Manager</div>
      <div style="font-size:12px;color:#1F2937;">การจัดการ: <b>${esc(DISPOSITION_LABELS[ncr.disposition] || ncr.disposition)}</b></div>
      ${ncr.disposition_note ? `<div style="font-size:12px;color:#1F2937;">หมายเหตุ: ${esc(ncr.disposition_note)}</div>` : ''}
      ${ncr.disposition_due_date ? `<div style="font-size:12px;color:#1F2937;">วันกำหนดดำเนินการ: ${esc(ncr.disposition_due_date)}</div>` : ''}
    </div>
  ` : '';

  return `
    <div style="font-family:sans-serif;max-width:640px;">
      <h2 style="color:#1A3A5C;">ข้อมูล NCR — ${esc(ncr.ncr_code)}</h2>
      <div style="font-size:13px;color:#1F2937;margin-bottom:12px;">
        <div>Invoice: <b>${esc(ncr.invoice_no)}</b> &nbsp; PO: <b>${esc(ncr.po_no)}</b></div>
        <div>ผู้ผลิต: <b>${esc(ncr.supplier_name)}</b></div>
      </div>
      <h3 style="color:#1F2937;font-size:14px;">รายการสินค้าในใบ NCR</h3>
      ${itemsHtml}
      ${dispositionHtml}
    </div>
  `;
}

// เวอร์ชัน plain text — ใช้ส่งต่อ Telegram ส่วนตัว (sendTelegram ส่งเฉพาะ plain text กัน HTML injection ตาม DEVMORE M6)
function buildNcrInfoText(ncr, items) {
  const lines = [`ข้อมูล NCR — ${ncr.ncr_code}`, `Invoice: ${ncr.invoice_no} / PO: ${ncr.po_no}`, `ผู้ผลิต: ${ncr.supplier_name}`, ''];
  for (const item of items) {
    lines.push(`- ${item.item_name}${item.product_code ? ` (${item.product_code})` : ''}`);
    lines.push(`  รับเข้า ${item.qty_received} / สุ่มตรวจ ${item.qty_sampled} / ไม่ผ่าน ${item.qty_failed}`);
    if (item.claim_value_thb || item.claim_value_usd) {
      lines.push(`  มูลค่าเคลม THB: ${item.claim_value_thb || '-'} / USD: ${item.claim_value_usd || '-'}`);
    }
    if (ncr.disposition === 'return') lines.push(`  ${RETURN_NOTE_TH} / ${RETURN_NOTE_EN}`);
  }
  if (ncr.disposition) {
    lines.push('', `การจัดการของ QC Manager: ${DISPOSITION_LABELS[ncr.disposition] || ncr.disposition}`);
    if (ncr.disposition_note) lines.push(`หมายเหตุ: ${ncr.disposition_note}`);
  }
  return lines.join('\n');
}

module.exports = { buildNcrInfoHtml, buildNcrInfoText };
