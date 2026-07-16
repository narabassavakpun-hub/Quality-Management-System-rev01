import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import Button from '../../components/UI/Button';
import ImageUploadPair from '../../components/UI/ImageUploadPair';
import ToggleSwitch from '../../components/UI/ToggleSwitch';
import ConfirmDialog from '../../components/UI/ConfirmDialog';

// ─── Telegram Tab ───────────────────────────────────────────────────────────────
function TelegramTab() {
  const qc = useQueryClient();
  const [showToken, setShowToken] = useState(false);
  const [testMsg, setTestMsg]     = useState('');
  const [testErr, setTestErr]     = useState('');

  const { data = {}, isLoading } = useQuery({
    queryKey: ['settings-telegram'],
    queryFn: () => api.get('/admin/settings/telegram').then(r => r.data),
  });

  const [form, setForm] = useState(null);
  const current = form ?? {
    telegram_bot_token: data.telegram_bot_token || '',
    telegram_group_qc: data.telegram_group_qc || '',
    telegram_group_purchasing: data.telegram_group_purchasing || '',
    app_url: data.app_url || '',
  };
  const set = (k, v) => setForm(p => ({ ...(p ?? current), [k]: v }));

  const save = useMutation({
    mutationFn: (body) => api.post('/admin/settings/telegram', body),
    onSuccess: () => { qc.invalidateQueries(['settings-telegram']); setForm(null); },
  });

  const [testing, setTesting] = useState(false);
  async function handleTest() {
    setTestMsg(''); setTestErr('');
    setTesting(true);
    try {
      const r = await api.post('/admin/settings/telegram/test');
      setTestMsg(r.data.message || 'ส่งข้อความทดสอบสำเร็จ');
    } catch (e) {
      setTestErr(e?.response?.data?.error || 'ส่งไม่สำเร็จ');
    } finally {
      setTesting(false);
    }
  }

  if (isLoading) return <p className="text-muted text-small py-6 text-center">กำลังโหลด...</p>;

  return (
    <div className="max-w-lg space-y-5">
      <p className="text-small text-muted">
        ตั้งค่า Telegram Bot สำหรับส่งแจ้งเตือน — config เก็บใน Database ไม่ต้อง restart server
      </p>

      {/* Bot Token */}
      <div>
        <label className="label">Bot Token</label>
        <div className="flex gap-2">
          <input
            type={showToken ? 'text' : 'password'}
            className="input flex-1 font-mono text-small"
            value={current.telegram_bot_token}
            onChange={e => set('telegram_bot_token', e.target.value)}
            placeholder={data.telegram_bot_token_set ? 'ตั้งค่าไว้แล้ว — กรอกใหม่เพื่อเปลี่ยน' : '1234567890:ABCdef...'}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowToken(p => !p)}
            className="px-3 py-2 border border-border rounded-md text-small text-muted hover:text-text hover:bg-bg transition-colors min-h-[44px]"
          >
            {showToken ? 'ซ่อน' : 'แสดง'}
          </button>
        </div>
        <p className="text-[12px] text-muted mt-1">
          ได้จาก @BotFather บน Telegram{data.telegram_bot_token_set ? ' — เว้นว่างไว้เพื่อใช้ token เดิม' : ''}
        </p>
      </div>

      {/* QC Group */}
      <div>
        <label className="label">Chat ID — กลุ่ม QC</label>
        <input
          className="input font-mono"
          value={current.telegram_group_qc}
          onChange={e => set('telegram_group_qc', e.target.value)}
          placeholder="-100xxxxxxxxxx"
        />
        <p className="text-[12px] text-muted mt-1">รับ: บิลใหม่, NCR ทุกขั้น, UAI ขั้น QC, Delivery ทุก event</p>
      </div>

      {/* Purchasing Group */}
      <div>
        <label className="label">Chat ID — กลุ่มจัดซื้อ</label>
        <input
          className="input font-mono"
          value={current.telegram_group_purchasing}
          onChange={e => set('telegram_group_purchasing', e.target.value)}
          placeholder="-100xxxxxxxxxx"
        />
        <p className="text-[12px] text-muted mt-1">รับ: NCR ที่ต้องส่ง Supplier (พร้อม link), UAI ที่ต้องลงนาม</p>
      </div>

      {/* APP URL */}
      <div>
        <label className="label">APP URL</label>
        <input
          className="input"
          value={current.app_url}
          onChange={e => set('app_url', e.target.value)}
          placeholder="https://iqc.company.com"
        />
        <p className="text-[12px] text-muted mt-1">ใช้สร้าง link ส่ง Supplier เช่น {'{APP_URL}'}/supplier/ncr/{'{token}'}</p>
      </div>

      {save.error && (
        <div className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">
          {save.error?.response?.data?.error || 'บันทึกไม่สำเร็จ'}
        </div>
      )}

      <div className="flex gap-2 pt-2 flex-wrap">
        <Button onClick={() => save.mutate(current)} loading={save.isPending}>บันทึก</Button>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="btn-secondary min-h-[44px] px-4 disabled:opacity-50"
        >
          {testing ? 'กำลังทดสอบ...' : 'ทดสอบ Telegram'}
        </button>
      </div>

      {testMsg && <div className="text-success text-small bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded px-3 py-2">{testMsg}</div>}
      {testErr && <div className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">{testErr}</div>}
    </div>
  );
}

// ─── Email (SMTP) Tab ───────────────────────────────────────────────────────────
function EmailTab() {
  const qc = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [testTo, setTestTo]       = useState('');
  const [testMsg, setTestMsg]     = useState('');
  const [testErr, setTestErr]     = useState('');

  const { data = {}, isLoading } = useQuery({
    queryKey: ['settings-email'],
    queryFn: () => api.get('/admin/settings/email').then(r => r.data),
  });

  const [form, setForm] = useState(null);
  const current = form ?? {
    smtp_host: data.smtp_host || '',
    smtp_port: data.smtp_port || '587',
    smtp_secure: !!data.smtp_secure,
    smtp_user: data.smtp_user || '',
    smtp_password: '',
    smtp_from: data.smtp_from || '',
  };
  const set = (k, v) => setForm(p => ({ ...(p ?? current), [k]: v }));

  const save = useMutation({
    mutationFn: (body) => api.post('/admin/settings/email', body),
    onSuccess: () => { qc.invalidateQueries(['settings-email']); setForm(null); },
  });

  const [testing, setTesting] = useState(false);
  async function handleTest() {
    setTestMsg(''); setTestErr('');
    setTesting(true);
    try {
      const r = await api.post('/admin/settings/email/test', { to: testTo || undefined });
      setTestMsg(r.data.message || 'ส่งอีเมลทดสอบสำเร็จ');
    } catch (e) {
      setTestErr(e?.response?.data?.error || 'ส่งไม่สำเร็จ');
    } finally {
      setTesting(false);
    }
  }

  if (isLoading) return <p className="text-muted text-small py-6 text-center">กำลังโหลด...</p>;

  return (
    <div className="max-w-lg space-y-5">
      <p className="text-small text-muted">
        ตั้งค่า SMTP สำหรับส่งแจ้งเตือนอีเมล (เช่น COO รับทราบเอกสาร NCR) — config เก็บใน Database ไม่ต้อง restart server
      </p>

      <div>
        <label className="label">SMTP Host</label>
        <input
          className="input"
          value={current.smtp_host}
          onChange={e => set('smtp_host', e.target.value)}
          placeholder="smtp.gmail.com"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Port</label>
          <input
            className="input font-mono"
            value={current.smtp_port}
            onChange={e => set('smtp_port', e.target.value)}
            placeholder="587"
            inputMode="numeric"
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border px-3 mt-6">
          <label className="text-small text-muted">TLS/SSL</label>
          <ToggleSwitch active={current.smtp_secure} onClick={() => set('smtp_secure', !current.smtp_secure)} />
        </div>
      </div>

      <div>
        <label className="label">SMTP Username</label>
        <input
          className="input"
          value={current.smtp_user}
          onChange={e => set('smtp_user', e.target.value)}
          placeholder="notify@company.com"
        />
      </div>

      <div>
        <label className="label">SMTP Password</label>
        <div className="flex gap-2">
          <input
            type={showPassword ? 'text' : 'password'}
            className="input flex-1 font-mono text-small"
            value={current.smtp_password}
            onChange={e => set('smtp_password', e.target.value)}
            placeholder={data.smtp_password_set ? 'ตั้งค่าไว้แล้ว — กรอกใหม่เพื่อเปลี่ยน' : 'App password / SMTP password'}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowPassword(p => !p)}
            className="px-3 py-2 border border-border rounded-md text-small text-muted hover:text-text hover:bg-bg transition-colors min-h-[44px]"
          >
            {showPassword ? 'ซ่อน' : 'แสดง'}
          </button>
        </div>
        <p className="text-[12px] text-muted mt-1">
          {data.smtp_password_set ? 'เว้นว่างไว้เพื่อใช้รหัสผ่านเดิม' : 'ยังไม่ได้ตั้งค่า'}
        </p>
      </div>

      <div>
        <label className="label">From Address</label>
        <input
          className="input"
          value={current.smtp_from}
          onChange={e => set('smtp_from', e.target.value)}
          placeholder="เว้นว่าง = ใช้ SMTP Username"
        />
      </div>

      {save.error && (
        <div className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">
          {save.error?.response?.data?.error || 'บันทึกไม่สำเร็จ'}
        </div>
      )}

      <div className="flex gap-2 pt-2 flex-wrap">
        <Button onClick={() => save.mutate(current)} loading={save.isPending}>บันทึก</Button>
      </div>

      <div className="border-t border-border pt-4">
        <label className="label">ทดสอบส่งอีเมล</label>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            value={testTo}
            onChange={e => setTestTo(e.target.value)}
            placeholder="อีเมลผู้รับทดสอบ"
          />
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="btn-secondary min-h-[44px] px-4 disabled:opacity-50"
          >
            {testing ? 'กำลังทดสอบ...' : 'ทดสอบส่งอีเมล'}
          </button>
        </div>
      </div>

      {testMsg && <div className="text-success text-small bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded px-3 py-2">{testMsg}</div>}
      {testErr && <div className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">{testErr}</div>}
    </div>
  );
}

// ─── PDF Template Tab ───────────────────────────────────────────────────────────
function PdfTemplateTab() {
  const qc = useQueryClient();
  const [logoPreview, setLogoPreview] = useState(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoMsg, setLogoMsg] = useState('');

  const { data = {}, isLoading } = useQuery({
    queryKey: ['settings-pdf-template'],
    queryFn: () => api.get('/admin/settings/pdf-template').then(r => r.data),
  });

  const [form, setForm] = useState(null);
  const current = form ?? {
    company_name:      data.company_name      || '',
    company_address:   data.company_address   || '',
    ncr_img_cols:      data.ncr_img_cols      || '3',
    ncr_img_max_width: data.ncr_img_max_width || '180',
    uai_img_cols:      data.uai_img_cols      || '3',
    uai_img_max_height:       data.uai_img_max_height       || '160',
    uai_img_inbox_max_height: data.uai_img_inbox_max_height || '200',
  };
  const set = (k, v) => setForm(p => ({ ...(p ?? current), [k]: v }));

  const saveInfo = useMutation({
    mutationFn: (body) => api.post('/admin/settings/pdf-template', body),
    onSuccess: () => { qc.invalidateQueries(['settings-pdf-template']); setForm(null); },
  });

  async function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setLogoMsg('');
    setLogoPreview(URL.createObjectURL(file));
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const r = await api.post('/admin/settings/logo', fd);
      setLogoMsg('อัปโหลดโลโก้สำเร็จ');
      qc.invalidateQueries(['settings-pdf-template']);
    } catch (err) {
      setLogoMsg(err?.response?.data?.error || 'อัปโหลดไม่สำเร็จ');
      setLogoPreview(null);
    } finally {
      setLogoUploading(false);
    }
  }

  async function handleRemoveLogo() {
    setLogoMsg('');
    try {
      await api.delete('/admin/settings/logo');
      setLogoPreview(null);
      qc.invalidateQueries(['settings-pdf-template']);
      setLogoMsg('ลบโลโก้แล้ว');
    } catch {}
  }

  if (isLoading) return <p className="text-muted text-small py-6 text-center">กำลังโหลด...</p>;

  const displayLogo = logoPreview || (data.company_logo_url || null);

  return (
    <div className="space-y-6 max-w-xl">

      {/* ─ ส่วนที่ 1: ข้อมูลบริษัท ─ */}
      <section>
        <h3 className="text-small font-semibold text-muted uppercase tracking-wide mb-3">ข้อมูลบริษัท / หัวกระดาษ</h3>

        {/* Logo */}
        <div className="mb-4">
          <label className="label">โลโก้บริษัท</label>
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              {displayLogo ? (
                <div className="relative">
                  <img
                    src={displayLogo}
                    alt="logo"
                    className="h-16 w-40 object-contain border border-border rounded bg-bg p-1"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-danger text-white rounded-full text-[12px] font-bold flex items-center justify-center hover:bg-red-700 shadow"
                  >
                    X
                  </button>
                </div>
              ) : (
                <div className="h-16 w-40 border-2 border-dashed border-border rounded flex items-center justify-center text-muted text-small bg-bg">
                  ไม่มีโลโก้
                </div>
              )}
            </div>
            <div className="space-y-2">
              <ImageUploadPair multiple={false} disabled={logoUploading} onChange={handleLogoUpload} />
              <p className="text-[12px] text-muted">PNG, JPG — ขนาดสูงสุด 5MB</p>
              {logoMsg && <p className={`text-[12px] ${logoMsg.includes('สำเร็จ') || logoMsg.includes('ลบ') ? 'text-success' : 'text-danger'}`}>{logoMsg}</p>}
            </div>
          </div>
        </div>

        {/* Company Name */}
        <div className="mb-3">
          <label className="label">ชื่อบริษัท</label>
          <input
            className="input"
            value={current.company_name}
            onChange={e => set('company_name', e.target.value)}
            placeholder="เช่น บริษัท ABC จำกัด"
          />
        </div>

        {/* Company Address */}
        <div className="mb-4">
          <label className="label">ที่อยู่ / รายละเอียดเพิ่มเติม</label>
          <textarea
            className="input"
            rows={3}
            value={current.company_address}
            onChange={e => set('company_address', e.target.value)}
            placeholder="ที่อยู่, เบอร์โทร, อีเมล"
          />
        </div>

        {saveInfo.error && (
          <div className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2 mb-3">
            {saveInfo.error?.response?.data?.error || 'บันทึกไม่สำเร็จ'}
          </div>
        )}
        {saveInfo.isSuccess && (
          <div className="text-success text-small bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded px-3 py-2 mb-3">บันทึกสำเร็จ</div>
        )}
      </section>

      {/* ─ ส่วนที่ 2: Layout รูปภาพ NCR ─ */}
      <section className="border-t border-border pt-5">
        <h3 className="text-small font-semibold text-muted uppercase tracking-wide mb-3">การจัดวางรูปภาพ PDF — NCR</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">จำนวนคอลัมน์รูป</label>
            <select className="input" value={current.ncr_img_cols} onChange={e => set('ncr_img_cols', e.target.value)}>
              <option value="1">1 คอลัมน์ (รูปใหญ่)</option>
              <option value="2">2 คอลัมน์</option>
              <option value="3">3 คอลัมน์ (ค่าเริ่มต้น)</option>
              <option value="4">4 คอลัมน์ (รูปเล็ก)</option>
            </select>
          </div>
          <div>
            <label className="label">ความสูงสูงสุดของรูป (px)</label>
            <input
              type="number"
              className="input"
              min="80" max="400" step="10"
              value={current.ncr_img_max_width}
              onChange={e => set('ncr_img_max_width', e.target.value)}
            />
            <p className="text-[12px] text-muted mt-1">ปัจจุบัน: {current.ncr_img_max_width}px</p>
          </div>
        </div>
      </section>

      {/* ─ ส่วนที่ 3: Layout รูปภาพ UAI ─ */}
      <section className="border-t border-border pt-5">
        <h3 className="text-small font-semibold text-muted uppercase tracking-wide mb-3">การจัดวางรูปภาพ PDF — UAI</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">จำนวนคอลัมน์รูป (นอกกล่องข้อมูล)</label>
            <select className="input" value={current.uai_img_cols} onChange={e => set('uai_img_cols', e.target.value)}>
              <option value="1">1 คอลัมน์ (รูปใหญ่)</option>
              <option value="2">2 คอลัมน์</option>
              <option value="3">3 คอลัมน์ (ค่าเริ่มต้น)</option>
              <option value="4">4 คอลัมน์ (รูปเล็ก)</option>
            </select>
          </div>
          <div>
            <label className="label">ความสูงสูงสุดของรูป นอกกล่องข้อมูล — มากกว่า 1 รูป (px)</label>
            <input
              type="number"
              className="input"
              min="80" max="400" step="10"
              value={current.uai_img_max_height}
              onChange={e => set('uai_img_max_height', e.target.value)}
            />
            <p className="text-[12px] text-muted mt-1">ปัจจุบัน: {current.uai_img_max_height}px</p>
          </div>
          <div>
            <label className="label">ความสูงสูงสุดของรูป ในกล่องข้อมูล — กรณีมีรูปเดียว (px)</label>
            <input
              type="number"
              className="input"
              min="80" max="500" step="10"
              value={current.uai_img_inbox_max_height}
              onChange={e => set('uai_img_inbox_max_height', e.target.value)}
            />
            <p className="text-[12px] text-muted mt-1">ปัจจุบัน: {current.uai_img_inbox_max_height}px</p>
          </div>
        </div>
      </section>

      <div className="pt-2">
        <Button onClick={() => saveInfo.mutate(current)} loading={saveInfo.isPending}>
          บันทึกทั้งหมด
        </Button>
      </div>
    </div>
  );
}

// ─── Attendance Settings Tab ────────────────────────────────────────────────────
function AttendanceTab() {
  const qc = useQueryClient();
  const { data = {}, isLoading } = useQuery({
    queryKey: ['settings-attendance'],
    queryFn: () => api.get('/admin/settings/attendance').then(r => r.data),
  });

  const [form, setForm] = useState(null);
  const current = form ?? {
    shift_start_time:         data.shift_start_time         || '08:00',
    shift_end_time:           data.shift_end_time           || '17:00',
    shift_late_grace_minutes: data.shift_late_grace_minutes || '0',
  };
  const set = (k, v) => setForm(p => ({ ...(p ?? current), [k]: v }));

  const save = useMutation({
    mutationFn: (body) => api.post('/admin/settings/attendance', body),
    onSuccess: () => { qc.invalidateQueries(['settings-attendance']); setForm(null); },
  });

  if (isLoading) return <p className="text-muted text-small py-6 text-center">กำลังโหลด...</p>;

  const graceMin = parseInt(current.shift_late_grace_minutes) || 0;
  const lateTime = (() => {
    const [h, m] = current.shift_start_time.split(':').map(Number);
    const total = h * 60 + m + graceMin;
    return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
  })();

  return (
    <div className="max-w-lg space-y-5">
      <p className="text-small text-muted">
        กำหนดเวลาเข้า-ออกงาน — ใช้สำหรับคำนวณการมาสาย ในระบบ Time Attendance
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">เวลาเริ่มงาน</label>
          <input
            type="time"
            className="input font-mono"
            value={current.shift_start_time}
            onChange={e => set('shift_start_time', e.target.value)}
          />
          <p className="text-[12px] text-muted mt-1">เวลามาตรฐานของกะงาน</p>
        </div>
        <div>
          <label className="label">เวลาเลิกงาน</label>
          <input
            type="time"
            className="input font-mono"
            value={current.shift_end_time}
            onChange={e => set('shift_end_time', e.target.value)}
          />
          <p className="text-[12px] text-muted mt-1">ใช้แสดงบนหน้าเช็คชื่อ</p>
        </div>
      </div>

      <div>
        <label className="label">ระยะผ่อนผัน (นาที)</label>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            className="input font-mono w-28"
            min="0"
            max="60"
            value={current.shift_late_grace_minutes}
            onChange={e => set('shift_late_grace_minutes', e.target.value)}
          />
          <span className="text-small text-muted">นาที</span>
        </div>
        <p className="text-[12px] text-muted mt-1">
          นับว่า "สาย" เมื่อเช็คชื่อหลัง {lateTime} น.
          {graceMin > 0 ? ` (เปิดงาน ${current.shift_start_time} + ผ่อนผัน ${graceMin} นาที)` : ''}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-bg p-3 space-y-1">
        <p className="text-[12px] font-semibold text-text">ตัวอย่างการคำนวณ</p>
        <p className="text-[12px] text-muted">
          เช็คชื่อ {current.shift_start_time} น. → <span className="text-success font-medium">ตรงเวลา</span>
        </p>
        <p className="text-[12px] text-muted">
          เช็คชื่อ {lateTime} น. → <span className="text-success font-medium">ตรงเวลา (อยู่ในช่วงผ่อนผัน)</span>
        </p>
        <p className="text-[12px] text-muted">
          เช็คชื่อหลัง {lateTime} น. → <span className="text-warning font-medium">สาย (แสดงจำนวนนาที)</span>
        </p>
      </div>

      {save.error && (
        <div className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">
          {save.error?.response?.data?.error || 'บันทึกไม่สำเร็จ'}
        </div>
      )}
      {save.isSuccess && (
        <div className="text-success text-small bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded px-3 py-2">บันทึกสำเร็จ</div>
      )}

      <div className="pt-2">
        <Button onClick={() => save.mutate(current)} loading={save.isPending}>บันทึก</Button>
      </div>
    </div>
  );
}

// ─── Geofence Tab ───────────────────────────────────────────────────────────────
function GeofenceTab() {
  const qc = useQueryClient();

  const { data = {}, isLoading } = useQuery({
    queryKey: ['settings-geofence'],
    queryFn: () => api.get('/admin/settings/geofence').then(r => r.data),
  });

  const [form, setForm] = useState(null);
  const current = form ?? {
    factory_lat:      data.factory_lat      ?? '',
    factory_lon:      data.factory_lon      ?? '',
    factory_radius_m: data.factory_radius_m ?? '',
  };
  const set = (k, v) => setForm(p => ({ ...(p ?? current), [k]: v }));

  const save = useMutation({
    mutationFn: (body) => api.post('/admin/settings/geofence', body),
    onSuccess: () => { qc.invalidateQueries(['settings-geofence']); setForm(null); },
  });

  if (isLoading) return <p className="text-muted text-small py-6 text-center">กำลังโหลด...</p>;

  const lat = parseFloat(current.factory_lat);
  const lon = parseFloat(current.factory_lon);
  const hasCoords = !isNaN(lat) && !isNaN(lon);
  const mapsUrl = hasCoords
    ? `https://www.google.com/maps?q=${lat},${lon}`
    : null;

  return (
    <div className="max-w-lg space-y-5">
      <p className="text-small text-muted">
        กำหนดพิกัดโรงงานและรัศมีสำหรับตรวจสอบ Geofence — ใช้กับฟีเจอร์บันทึกส่งสินค้าและอื่น ๆ
      </p>

      {/* ละติจูด */}
      <div>
        <label className="label">ละติจูด (Latitude)</label>
        <input
          type="number"
          className="input font-mono"
          step="any"
          value={current.factory_lat}
          onChange={e => set('factory_lat', e.target.value)}
          placeholder="เช่น 13.756331"
        />
        <p className="text-[12px] text-muted mt-1">ค่าบวก = เหนือเส้นศูนย์สูตร (ประเทศไทย ~7–21)</p>
      </div>

      {/* ลองจิจูด */}
      <div>
        <label className="label">ลองจิจูด (Longitude)</label>
        <input
          type="number"
          className="input font-mono"
          step="any"
          value={current.factory_lon}
          onChange={e => set('factory_lon', e.target.value)}
          placeholder="เช่น 100.501762"
        />
        <p className="text-[12px] text-muted mt-1">ค่าบวก = ตะวันออกของ Meridian (ประเทศไทย ~97–106)</p>
      </div>

      {/* รัศมี */}
      <div>
        <label className="label">รัศมี (เมตร)</label>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            className="input font-mono flex-1"
            min="50"
            max="50000"
            step="50"
            value={current.factory_radius_m}
            onChange={e => set('factory_radius_m', e.target.value)}
            placeholder="เช่น 500"
          />
          <span className="text-small text-muted flex-shrink-0">เมตร</span>
        </div>
        <p className="text-[12px] text-muted mt-1">
          {current.factory_radius_m
            ? `= ${(parseFloat(current.factory_radius_m) / 1000).toFixed(2)} กิโลเมตร`
            : 'ระยะทางที่ยอมรับได้จากพิกัดโรงงาน'}
        </p>
      </div>

      {/* Preview link */}
      {hasCoords && (
        <div className="rounded-lg border border-border bg-bg p-3 flex items-center justify-between">
          <div>
            <p className="text-small font-medium text-text">พิกัดปัจจุบัน</p>
            <p className="font-mono text-[12px]text-muted mt-0.5">{lat.toFixed(6)}, {lon.toFixed(6)}</p>
          </div>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-small min-h-[40px] px-3 flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            ดูบน Google Maps
          </a>
        </div>
      )}

      {/* วิธีหาพิกัด */}
      <div className="rounded-lg border border-border bg-bg p-3 space-y-1">
        <p className="text-[12px] font-semibold text-text">วิธีหาพิกัดโรงงาน</p>
        <ol className="text-[12px] text-muted space-y-0.5 list-decimal list-inside">
          <li>เปิด Google Maps แล้วค้นหาตำแหน่งโรงงาน</li>
          <li>คลิกขวาที่จุดบนแผนที่ → เลือก "พิกัดอะไร?" หรือ "What's here?"</li>
          <li>คัดลอกเลขละติจูด ลองจิจูดที่แสดงขึ้นมา</li>
        </ol>
      </div>

      {save.error && (
        <div className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">
          {save.error?.response?.data?.error || 'บันทึกไม่สำเร็จ'}
        </div>
      )}
      {save.isSuccess && (
        <div className="text-success text-small bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded px-3 py-2">
          บันทึกสำเร็จ
        </div>
      )}

      <div className="pt-2">
        <Button
          onClick={() => save.mutate({
            factory_lat:      parseFloat(current.factory_lat)      || null,
            factory_lon:      parseFloat(current.factory_lon)      || null,
            factory_radius_m: parseInt(current.factory_radius_m)   || null,
          })}
          loading={save.isPending}
        >
          บันทึก
        </Button>
      </div>
    </div>
  );
}

// ─── General Tab ────────────────────────────────────────────────────────────────
function GeneralTab() {
  const qc = useQueryClient();
  const { data = {}, isLoading } = useQuery({
    queryKey: ['settings-general'],
    queryFn: () => api.get('/admin/system-settings/general').then(r => r.data),
  });

  const [form, setForm] = useState(null);
  const current = form ?? {
    system_name: data.system_name || '',
    ui_language: data.ui_language || 'th',
    timezone: data.timezone || 'Asia/Bangkok',
    session_timeout_minutes: data.session_timeout_minutes || '30',
    remember_login_enabled: data.remember_login_enabled ?? '1',
  };
  const set = (k, v) => setForm(p => ({ ...(p ?? current), [k]: v }));

  const save = useMutation({
    mutationFn: (body) => api.post('/admin/system-settings/general', body),
    onSuccess: () => { qc.invalidateQueries(['settings-general']); setForm(null); },
  });

  if (isLoading) return <p className="text-muted text-small py-6 text-center">กำลังโหลด...</p>;

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <label className="label">ชื่อระบบ</label>
        <input className="input" value={current.system_name} onChange={e => set('system_name', e.target.value)} placeholder="IQC System" />
      </div>
      <div>
        <label className="label">ภาษา</label>
        <select className="input" value={current.ui_language} onChange={e => set('ui_language', e.target.value)}>
          <option value="th">ไทย</option>
          <option value="en">English</option>
        </select>
      </div>
      <div>
        <label className="label">Timezone</label>
        <input className="input" value={current.timezone} onChange={e => set('timezone', e.target.value)} placeholder="Asia/Bangkok" />
      </div>
      <div>
        <label className="label">Session Timeout (นาที)</label>
        <input type="number" min="1" className="input" value={current.session_timeout_minutes} onChange={e => set('session_timeout_minutes', e.target.value)} />
        <p className="text-[12px] text-muted mt-1">ค่าอ้างอิง — idle timeout ที่บังคับใช้จริงตอนนี้คือ 30 นาที (ฝั่ง client)</p>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <label className="label mb-0">Remember Login</label>
          <p className="text-[12px] text-muted">อนุญาตให้ผู้ใช้ติ๊ก "จำชื่อผู้ใช้" ในหน้า login</p>
        </div>
        <ToggleSwitch active={current.remember_login_enabled === '1'} onClick={() => set('remember_login_enabled', current.remember_login_enabled === '1' ? '0' : '1')} />
      </div>

      {save.error && <div className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">{save.error?.response?.data?.error || 'บันทึกไม่สำเร็จ'}</div>}
      {save.isSuccess && <div className="text-success text-small bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded px-3 py-2">บันทึกสำเร็จ</div>}

      <div className="pt-2">
        <Button onClick={() => save.mutate(current)} loading={save.isPending}>บันทึก</Button>
      </div>
    </div>
  );
}

// ─── Authentication Tab ─────────────────────────────────────────────────────────
function AuthenticationTab() {
  const qc = useQueryClient();
  const [showSecret, setShowSecret] = useState(false);
  const { data = {}, isLoading } = useQuery({
    queryKey: ['settings-auth'],
    queryFn: () => api.get('/admin/system-settings/auth').then(r => r.data),
  });

  const [form, setForm] = useState(null);
  const current = form ?? {
    auth_mode: data.auth_mode || 'local',
    ad_enabled: !!data.ad_enabled,
    ad_gateway_url: data.ad_gateway_url || '',
    ad_app_id: data.ad_app_id || '',
    ad_secret_key: '',
    ad_domain: data.ad_domain || '',
    ad_use_ssl: data.ad_use_ssl ?? true,
    ad_timeout_ms: data.ad_timeout_ms || '5000',
    ad_retry_count: data.ad_retry_count || '1',
  };
  const set = (k, v) => setForm(p => ({ ...(p ?? current), [k]: v }));

  const save = useMutation({
    mutationFn: (body) => api.post('/admin/system-settings/auth', body),
    onSuccess: () => { qc.invalidateQueries(['settings-auth']); setForm(null); },
  });

  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [testErr, setTestErr] = useState('');
  async function handleTest() {
    setTestMsg(''); setTestErr(''); setTesting(true);
    try {
      const r = await api.post('/admin/system-settings/auth/test');
      setTestMsg(`เชื่อมต่อสำเร็จ (HTTP ${r.data.httpStatus}, ${r.data.responseTimeMs}ms) — ${r.data.message}`);
    } catch (e) {
      setTestErr(e?.response?.data?.error || 'เชื่อมต่อไม่สำเร็จ');
    } finally {
      setTesting(false);
    }
  }

  if (isLoading) return <p className="text-muted text-small py-6 text-center">กำลังโหลด...</p>;

  return (
    <div className="max-w-lg space-y-5">
      <p className="text-small text-muted">
        Active Directory เป็นระบบเสริมเท่านั้น — พนักงานที่ไม่ได้ผูก AD (ตั้งค่าที่หน้าผู้ใช้งาน) จะ login ด้วยระบบเดิม
        (Local) ได้ปกติเสมอ ไม่ว่าตั้งค่าด้านล่างนี้เป็นอะไรก็ตาม
      </p>

      <div>
        <label className="label">โหมด Authentication</label>
        <select className="input" value={current.auth_mode} onChange={e => set('auth_mode', e.target.value)}>
          <option value="local">Local</option>
          <option value="hybrid">Hybrid (Local + Active Directory)</option>
          <option value="ad_strict" disabled>Active Directory (บังคับทุกคน) — ไม่รองรับในรุ่นนี้</option>
          <option value="ldap" disabled>LDAP — เร็วๆ นี้</option>
          <option value="azure_ad" disabled>Azure AD — เร็วๆ นี้</option>
        </select>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <label className="label mb-0">เปิดใช้งาน Active Directory</label>
          <p className="text-[12px] text-muted">ปิดไว้ = ทุกคน login ด้วย Local (ผู้ใช้ที่ผูก AD จะ fallback ไปใช้รหัสผ่านที่ cache ไว้ล่าสุด)</p>
        </div>
        <ToggleSwitch active={current.ad_enabled} onClick={() => set('ad_enabled', !current.ad_enabled)} />
      </div>

      <div>
        <label className="label">AD Gateway URL</label>
        <input
          className="input font-mono"
          value={current.ad_gateway_url}
          onChange={e => set('ad_gateway_url', e.target.value)}
          placeholder="https://ad-gateway.company.local:3100/api/v2/login"
        />
      </div>

      <div>
        <label className="label">App ID</label>
        <input className="input font-mono" value={current.ad_app_id} onChange={e => set('ad_app_id', e.target.value)} />
      </div>

      <div>
        <label className="label">Secret Key</label>
        <div className="flex gap-2">
          <input
            type={showSecret ? 'text' : 'password'}
            className="input flex-1 font-mono text-small"
            value={current.ad_secret_key}
            onChange={e => set('ad_secret_key', e.target.value)}
            placeholder={data.ad_secret_key_set ? 'ตั้งค่าไว้แล้ว — กรอกใหม่เพื่อเปลี่ยน' : ''}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowSecret(p => !p)}
            className="px-3 py-2 border border-border rounded-md text-small text-muted hover:text-text hover:bg-bg transition-colors min-h-[44px]"
          >
            {showSecret ? 'ซ่อน' : 'แสดง'}
          </button>
        </div>
        <p className="text-[12px] text-muted mt-1">
          เข้ารหัสก่อนบันทึกในฐานข้อมูล{data.ad_secret_key_set ? ' — เว้นว่างไว้เพื่อใช้ค่าเดิม' : ''}
        </p>
      </div>

      <div>
        <label className="label">Domain</label>
        <input className="input" value={current.ad_domain} onChange={e => set('ad_domain', e.target.value)} />
      </div>

      <div className="flex items-center justify-between">
        <label className="label mb-0">Use SSL</label>
        <ToggleSwitch active={current.ad_use_ssl} onClick={() => set('ad_use_ssl', !current.ad_use_ssl)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Connection Timeout (ms)</label>
          <input type="number" min="1000" className="input" value={current.ad_timeout_ms} onChange={e => set('ad_timeout_ms', e.target.value)} />
        </div>
        <div>
          <label className="label">Retry</label>
          <input type="number" min="0" max="3" className="input" value={current.ad_retry_count} onChange={e => set('ad_retry_count', e.target.value)} />
        </div>
      </div>
      <p className="text-[12px] text-muted -mt-3">Retry ใช้เฉพาะตอนเชื่อมต่อ AD Gateway ไม่ได้ (network/timeout) — ไม่ retry ตอนรหัสผ่านผิด (กันเร่ง lockout ของ AD จริง)</p>

      {save.error && <div className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">{save.error?.response?.data?.error || 'บันทึกไม่สำเร็จ'}</div>}
      {save.isSuccess && <div className="text-success text-small bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded px-3 py-2">บันทึกสำเร็จ</div>}

      <div className="flex gap-2 pt-2 flex-wrap">
        <Button onClick={() => save.mutate(current)} loading={save.isPending}>บันทึก</Button>
        <button type="button" onClick={handleTest} disabled={testing} className="btn-secondary min-h-[44px] px-4 disabled:opacity-50">
          {testing ? 'กำลังทดสอบ...' : 'Test Connection'}
        </button>
      </div>

      {testMsg && (
        <div className="flex items-center gap-2 text-success text-small bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded px-3 py-2">
          <span className="inline-block w-2 h-2 rounded-full bg-success flex-shrink-0" />
          {testMsg}
        </div>
      )}
      {testErr && (
        <div className="flex items-center gap-2 text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">
          <span className="inline-block w-2 h-2 rounded-full bg-danger flex-shrink-0" />
          {testErr}
        </div>
      )}
    </div>
  );
}

// ─── Environment Tab ────────────────────────────────────────────────────────────
function EnvironmentPresetForm({ preset, onCancel, onSave, saving, error }) {
  const [form, setForm] = useState({
    id: preset.id,
    env_key: preset.env_key || '',
    label: preset.label || '',
    api_url: preset.api_url || '',
    ad_gateway_url: preset.ad_gateway_url || '',
    ad_domain: preset.ad_domain || '',
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="card space-y-3">
      <div>
        <label className="label">Key (เช่น development / uat / production / onpremise / cloud)</label>
        <input className="input font-mono" value={form.env_key} onChange={e => set('env_key', e.target.value)} />
      </div>
      <div>
        <label className="label">ชื่อแสดงผล</label>
        <input className="input" value={form.label} onChange={e => set('label', e.target.value)} />
      </div>
      <div>
        <label className="label">API URL</label>
        <input className="input font-mono" value={form.api_url} onChange={e => set('api_url', e.target.value)} placeholder="https://iqc.company.com" />
      </div>
      <div>
        <label className="label">AD Gateway URL</label>
        <input className="input font-mono" value={form.ad_gateway_url} onChange={e => set('ad_gateway_url', e.target.value)} />
      </div>
      <div>
        <label className="label">AD Domain</label>
        <input className="input" value={form.ad_domain} onChange={e => set('ad_domain', e.target.value)} />
      </div>
      {error && <div className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">{error?.response?.data?.error || 'บันทึกไม่สำเร็จ'}</div>}
      <div className="flex gap-2">
        <Button onClick={() => onSave(form)} loading={saving}>บันทึก</Button>
        <button type="button" className="btn-secondary min-h-[44px] px-4" onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  );
}

function EnvironmentTab() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ['environment-presets'],
    queryFn: () => api.get('/admin/system-settings/environments').then(r => r.data),
  });

  const [editing, setEditing] = useState(null);
  const [applyTarget, setApplyTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const save = useMutation({
    mutationFn: (body) => api.post('/admin/system-settings/environments', body),
    onSuccess: () => { qc.invalidateQueries(['environment-presets']); setEditing(null); },
  });
  const applyMut = useMutation({
    mutationFn: (id) => api.post(`/admin/system-settings/environments/${id}/apply`),
    onSuccess: () => {
      qc.invalidateQueries(['environment-presets']);
      qc.invalidateQueries(['settings-auth']);
      qc.invalidateQueries(['settings-general']);
      setApplyTarget(null);
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/admin/system-settings/environments/${id}`),
    onSuccess: () => { qc.invalidateQueries(['environment-presets']); setDeleteTarget(null); },
  });

  if (isLoading) return <p className="text-muted text-small py-6 text-center">กำลังโหลด...</p>;

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-small text-muted">
        Environment เป็น "preset" ที่เก็บค่า endpoint ไว้ล่วงหน้า — กด Apply เพื่อ copy ค่าเข้าระบบจริงทันที
        โดยไม่ต้อง restart หรือ deploy ใหม่
      </p>

      {data.length === 0 && <p className="text-muted text-small py-4">ยังไม่มี Environment preset</p>}

      {data.map(p => (
        <div key={p.id} className="card space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <span className="font-semibold text-text">{p.label}</span>{' '}
              <span className="text-muted text-small font-mono">({p.env_key})</span>
              {!!p.is_current && (
                <span className="ml-2 badge bg-green-100 dark:bg-green-900 text-success">กำลังใช้งานอยู่</span>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button type="button" className="btn-secondary min-h-[44px] px-3" onClick={() => setEditing(p)}>แก้ไข</button>
              <Button variant="secondary" onClick={() => setApplyTarget(p)}>Apply</Button>
              <button type="button" className="btn-secondary min-h-[44px] px-3 text-danger" onClick={() => setDeleteTarget(p)}>ลบ</button>
            </div>
          </div>
          <p className="text-[12px] text-muted font-mono">API: {p.api_url || '-'}</p>
          <p className="text-[12px] text-muted font-mono">AD Gateway: {p.ad_gateway_url || '-'}</p>
        </div>
      ))}

      {editing ? (
        <EnvironmentPresetForm
          preset={editing}
          onCancel={() => setEditing(null)}
          onSave={(body) => save.mutate(body)}
          saving={save.isPending}
          error={save.error}
        />
      ) : (
        <Button onClick={() => setEditing({})}>+ เพิ่ม Environment</Button>
      )}

      <ConfirmDialog
        open={!!applyTarget}
        onClose={() => setApplyTarget(null)}
        onConfirm={() => applyMut.mutate(applyTarget.id)}
        message={`ต้องการ Apply "${applyTarget?.label}" — ระบบจะเปลี่ยน API URL/AD Gateway URL ที่ใช้งานจริงทันที?`}
        confirmLabel="Apply"
        variant="warning"
        loading={applyMut.isPending}
        error={applyMut.error?.response?.data?.error}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMut.mutate(deleteTarget.id)}
        message={`ต้องการลบ preset "${deleteTarget?.label}"?`}
        confirmLabel="ลบ"
        variant="danger"
        loading={deleteMut.isPending}
        error={deleteMut.error?.response?.data?.error}
      />
    </div>
  );
}

// ─── Security Tab ───────────────────────────────────────────────────────────────
function SecurityTab() {
  const qc = useQueryClient();
  const { data = {}, isLoading } = useQuery({
    queryKey: ['settings-security'],
    queryFn: () => api.get('/admin/system-settings/security').then(r => r.data),
  });

  const [form, setForm] = useState(null);
  const current = form ?? {
    jwt_expiration_hours: data.jwt_expiration_hours || '8',
    refresh_token_enabled: data.refresh_token_enabled ?? '0',
    login_attempt_max: data.login_attempt_max || '5',
    lock_account_minutes: data.lock_account_minutes || '15',
    password_min_length: data.password_min_length || '8',
    password_require_complexity: data.password_require_complexity ?? '0',
  };
  const set = (k, v) => setForm(p => ({ ...(p ?? current), [k]: v }));

  const save = useMutation({
    mutationFn: (body) => api.post('/admin/system-settings/security', body),
    onSuccess: () => { qc.invalidateQueries(['settings-security']); setForm(null); },
  });

  if (isLoading) return <p className="text-muted text-small py-6 text-center">กำลังโหลด...</p>;

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <label className="label">JWT Expiration (ชั่วโมง)</label>
        <input type="number" min="1" className="input" value={current.jwt_expiration_hours} onChange={e => set('jwt_expiration_hours', e.target.value)} />
        <p className="text-[12px] text-muted mt-1">มีผลกับ session cookie ด้วย (ระยะเวลาเข้าสู่ระบบก่อนต้อง login ใหม่)</p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <label className="label mb-0">Refresh Token</label>
          <p className="text-[12px] text-muted">ยังไม่รองรับการทำงานจริงในรุ่นนี้ (สงวนไว้สำหรับอนาคต)</p>
        </div>
        <ToggleSwitch active={false} onClick={() => {}} title="ยังไม่รองรับในรุ่นนี้" />
      </div>

      <div>
        <label className="label">Login Attempt (ครั้ง ก่อนล็อกบัญชี)</label>
        <input type="number" min="1" className="input" value={current.login_attempt_max} onChange={e => set('login_attempt_max', e.target.value)} />
      </div>
      <div>
        <label className="label">Lock Account (นาที)</label>
        <input type="number" min="1" className="input" value={current.lock_account_minutes} onChange={e => set('lock_account_minutes', e.target.value)} />
      </div>
      <div>
        <label className="label">Password Policy — ความยาวขั้นต่ำ</label>
        <input type="number" min="6" className="input" value={current.password_min_length} onChange={e => set('password_min_length', e.target.value)} />
      </div>
      <div className="flex items-center justify-between">
        <label className="label mb-0">บังคับความซับซ้อนของรหัสผ่าน</label>
        <ToggleSwitch active={current.password_require_complexity === '1'} onClick={() => set('password_require_complexity', current.password_require_complexity === '1' ? '0' : '1')} />
      </div>

      {save.error && <div className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">{save.error?.response?.data?.error || 'บันทึกไม่สำเร็จ'}</div>}
      {save.isSuccess && <div className="text-success text-small bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded px-3 py-2">บันทึกสำเร็จ</div>}

      <div className="pt-2">
        <Button onClick={() => save.mutate(current)} loading={save.isPending}>บันทึก</Button>
      </div>
    </div>
  );
}

// ─── Advanced Tab ────────────────────────────────────────────────────────────────
function AdvancedTab() {
  const qc = useQueryClient();
  const { data = {}, isLoading } = useQuery({
    queryKey: ['settings-advanced'],
    queryFn: () => api.get('/admin/system-settings/advanced').then(r => r.data),
  });

  const [form, setForm] = useState(null);
  const current = form ?? {
    api_version: data.api_version || 'v1',
    debug_mode: data.debug_mode ?? '0',
    health_check_enabled: data.health_check_enabled ?? '1',
    custom_header_name: data.custom_header_name || '',
    custom_header_value: data.custom_header_value || '',
  };
  const set = (k, v) => setForm(p => ({ ...(p ?? current), [k]: v }));

  const save = useMutation({
    mutationFn: (body) => api.post('/admin/system-settings/advanced', body),
    onSuccess: () => { qc.invalidateQueries(['settings-advanced']); setForm(null); },
  });

  if (isLoading) return <p className="text-muted text-small py-6 text-center">กำลังโหลด...</p>;

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <label className="label">API Version</label>
        <input className="input font-mono" value={current.api_version} onChange={e => set('api_version', e.target.value)} />
      </div>
      <div className="flex items-center justify-between">
        <label className="label mb-0">Debug Mode</label>
        <ToggleSwitch active={current.debug_mode === '1'} onClick={() => set('debug_mode', current.debug_mode === '1' ? '0' : '1')} />
      </div>
      <div className="flex items-center justify-between">
        <label className="label mb-0">Health Check</label>
        <ToggleSwitch active={current.health_check_enabled === '1'} onClick={() => set('health_check_enabled', current.health_check_enabled === '1' ? '0' : '1')} />
      </div>
      <div>
        <label className="label">Custom Header — ชื่อ</label>
        <input className="input font-mono" value={current.custom_header_name} onChange={e => set('custom_header_name', e.target.value)} placeholder="X-Custom-Header" />
      </div>
      <div>
        <label className="label">Custom Header — ค่า</label>
        <input className="input font-mono" value={current.custom_header_value} onChange={e => set('custom_header_value', e.target.value)} />
        <p className="text-[12px] text-muted mt-1">ส่งไปพร้อมกับคำขอเรียก AD Gateway (ถ้ามีการตั้งค่าไว้)</p>
      </div>

      {save.error && <div className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">{save.error?.response?.data?.error || 'บันทึกไม่สำเร็จ'}</div>}
      {save.isSuccess && <div className="text-success text-small bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded px-3 py-2">บันทึกสำเร็จ</div>}

      <div className="pt-2">
        <Button onClick={() => save.mutate(current)} loading={save.isPending}>บันทึก</Button>
      </div>
    </div>
  );
}

// ─── Main Settings Page ─────────────────────────────────────────────────────────
const TABS = [
  { key: 'general',      label: 'ทั่วไป' },
  { key: 'authentication', label: 'Authentication' },
  { key: 'environment',  label: 'Environment' },
  { key: 'security',     label: 'Security' },
  { key: 'advanced',     label: 'Advanced' },
  { key: 'telegram',     label: 'Telegram' },
  { key: 'email',        label: 'Email' },
  { key: 'pdf-template', label: 'PDF Template' },
  { key: 'attendance',   label: 'เวลางาน' },
  { key: 'geofence',     label: 'Geofence' },
];

export default function AdminSettings() {
  const [activeTab, setActiveTab] = useState('general');

  return (
    <div>
      <h1 className="text-h2 font-bold text-text mb-6">ตั้งค่าระบบ</h1>

      {/* Tab bar */}
      <div className="flex border-b border-border mb-6 gap-1 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2.5 text-body font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'general'        && <GeneralTab />}
      {activeTab === 'authentication' && <AuthenticationTab />}
      {activeTab === 'environment'    && <EnvironmentTab />}
      {activeTab === 'security'       && <SecurityTab />}
      {activeTab === 'advanced'       && <AdvancedTab />}
      {activeTab === 'telegram'     && <TelegramTab />}
      {activeTab === 'email'       && <EmailTab />}
      {activeTab === 'pdf-template' && <PdfTemplateTab />}
      {activeTab === 'attendance'   && <AttendanceTab />}
      {activeTab === 'geofence'     && <GeofenceTab />}
    </div>
  );
}
