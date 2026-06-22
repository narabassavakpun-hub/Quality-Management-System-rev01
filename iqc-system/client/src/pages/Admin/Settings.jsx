import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import Button from '../../components/UI/Button';

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
        <p className="text-[11px] text-muted mt-1">
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
        <p className="text-[11px] text-muted mt-1">รับ: บิลใหม่, NCR ทุกขั้น, UAI ขั้น QC, Delivery ทุก event</p>
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
        <p className="text-[11px] text-muted mt-1">รับ: NCR ที่ต้องส่ง Supplier (พร้อม link), UAI ที่ต้องลงนาม</p>
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
        <p className="text-[11px] text-muted mt-1">ใช้สร้าง link ส่ง Supplier เช่น {'{APP_URL}'}/supplier/ncr/{'{token}'}</p>
      </div>

      {save.error && (
        <div className="text-danger text-small bg-red-50 border border-red-200 rounded px-3 py-2">
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

      {testMsg && <div className="text-success text-small bg-green-50 border border-green-200 rounded px-3 py-2">{testMsg}</div>}
      {testErr && <div className="text-danger text-small bg-red-50 border border-red-200 rounded px-3 py-2">{testErr}</div>}
    </div>
  );
}

// ─── PDF Template Tab ───────────────────────────────────────────────────────────
function PdfTemplateTab() {
  const qc = useQueryClient();
  const logoInputRef = useRef();
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
    uai_img_max_width: data.uai_img_max_width || '160',
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
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-danger text-white rounded-full text-[10px] font-bold flex items-center justify-center hover:bg-red-700"
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
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={logoUploading}
                className="btn-secondary text-small min-h-[40px] px-3 disabled:opacity-50"
              >
                {logoUploading ? 'กำลังอัปโหลด...' : displayLogo ? 'เปลี่ยนโลโก้' : 'อัปโหลดโลโก้'}
              </button>
              <p className="text-[11px] text-muted">PNG, JPG — ขนาดสูงสุด 5MB</p>
              {logoMsg && <p className={`text-[11px] ${logoMsg.includes('สำเร็จ') || logoMsg.includes('ลบ') ? 'text-success' : 'text-danger'}`}>{logoMsg}</p>}
            </div>
          </div>
          <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
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
          <div className="text-danger text-small bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
            {saveInfo.error?.response?.data?.error || 'บันทึกไม่สำเร็จ'}
          </div>
        )}
        {saveInfo.isSuccess && (
          <div className="text-success text-small bg-green-50 border border-green-200 rounded px-3 py-2 mb-3">บันทึกสำเร็จ</div>
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
            <p className="text-[11px] text-muted mt-1">ปัจจุบัน: {current.ncr_img_max_width}px</p>
          </div>
        </div>
      </section>

      {/* ─ ส่วนที่ 3: Layout รูปภาพ UAI ─ */}
      <section className="border-t border-border pt-5">
        <h3 className="text-small font-semibold text-muted uppercase tracking-wide mb-3">การจัดวางรูปภาพ PDF — UAI</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">จำนวนคอลัมน์รูป</label>
            <select className="input" value={current.uai_img_cols} onChange={e => set('uai_img_cols', e.target.value)}>
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
              value={current.uai_img_max_width}
              onChange={e => set('uai_img_max_width', e.target.value)}
            />
            <p className="text-[11px] text-muted mt-1">ปัจจุบัน: {current.uai_img_max_width}px</p>
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
          <p className="text-[11px] text-muted mt-1">เวลามาตรฐานของกะงาน</p>
        </div>
        <div>
          <label className="label">เวลาเลิกงาน</label>
          <input
            type="time"
            className="input font-mono"
            value={current.shift_end_time}
            onChange={e => set('shift_end_time', e.target.value)}
          />
          <p className="text-[11px] text-muted mt-1">ใช้แสดงบนหน้าเช็คชื่อ</p>
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
        <p className="text-[11px] text-muted mt-1">
          นับว่า "สาย" เมื่อเช็คชื่อหลัง {lateTime} น.
          {graceMin > 0 ? ` (เปิดงาน ${current.shift_start_time} + ผ่อนผัน ${graceMin} นาที)` : ''}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-bg p-3 space-y-1">
        <p className="text-[11px] font-semibold text-text">ตัวอย่างการคำนวณ</p>
        <p className="text-[11px] text-muted">
          เช็คชื่อ {current.shift_start_time} น. → <span className="text-success font-medium">ตรงเวลา</span>
        </p>
        <p className="text-[11px] text-muted">
          เช็คชื่อ {lateTime} น. → <span className="text-success font-medium">ตรงเวลา (อยู่ในช่วงผ่อนผัน)</span>
        </p>
        <p className="text-[11px] text-muted">
          เช็คชื่อหลัง {lateTime} น. → <span className="text-warning font-medium">สาย (แสดงจำนวนนาที)</span>
        </p>
      </div>

      {save.error && (
        <div className="text-danger text-small bg-red-50 border border-red-200 rounded px-3 py-2">
          {save.error?.response?.data?.error || 'บันทึกไม่สำเร็จ'}
        </div>
      )}
      {save.isSuccess && (
        <div className="text-success text-small bg-green-50 border border-green-200 rounded px-3 py-2">บันทึกสำเร็จ</div>
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
        <p className="text-[11px] text-muted mt-1">ค่าบวก = เหนือเส้นศูนย์สูตร (ประเทศไทย ~7–21)</p>
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
        <p className="text-[11px] text-muted mt-1">ค่าบวก = ตะวันออกของ Meridian (ประเทศไทย ~97–106)</p>
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
        <p className="text-[11px] text-muted mt-1">
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
            <p className="font-mono text-[11px] text-muted mt-0.5">{lat.toFixed(6)}, {lon.toFixed(6)}</p>
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
        <p className="text-[11px] font-semibold text-text">วิธีหาพิกัดโรงงาน</p>
        <ol className="text-[11px] text-muted space-y-0.5 list-decimal list-inside">
          <li>เปิด Google Maps แล้วค้นหาตำแหน่งโรงงาน</li>
          <li>คลิกขวาที่จุดบนแผนที่ → เลือก "พิกัดอะไร?" หรือ "What's here?"</li>
          <li>คัดลอกเลขละติจูด ลองจิจูดที่แสดงขึ้นมา</li>
        </ol>
      </div>

      {save.error && (
        <div className="text-danger text-small bg-red-50 border border-red-200 rounded px-3 py-2">
          {save.error?.response?.data?.error || 'บันทึกไม่สำเร็จ'}
        </div>
      )}
      {save.isSuccess && (
        <div className="text-success text-small bg-green-50 border border-green-200 rounded px-3 py-2">
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

// ─── Main Settings Page ─────────────────────────────────────────────────────────
const TABS = [
  { key: 'telegram',     label: 'Telegram' },
  { key: 'pdf-template', label: 'PDF Template' },
  { key: 'attendance',   label: 'เวลางาน' },
  { key: 'geofence',     label: 'Geofence' },
];

export default function AdminSettings() {
  const [activeTab, setActiveTab] = useState('telegram');

  return (
    <div>
      <h1 className="text-h2 font-bold text-text mb-6">ตั้งค่าระบบ</h1>

      {/* Tab bar */}
      <div className="flex border-b border-border mb-6 gap-1">
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
      {activeTab === 'telegram'     && <TelegramTab />}
      {activeTab === 'pdf-template' && <PdfTemplateTab />}
      {activeTab === 'attendance'   && <AttendanceTab />}
      {activeTab === 'geofence'     && <GeofenceTab />}
    </div>
  );
}
