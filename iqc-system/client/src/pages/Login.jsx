import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/UI/Button';
import WindowMark from '../components/Brand/WindowMark';
import logoWindowAsia from '../assets/logo-window-asia.png';

const REMEMBER_KEY = 'iqc_remembered_username';

const CHECKLIST = [
  'วัสดุคุณภาพสูง มาตรฐานสากล',
  'ติดตั้งโดยทีมงานมืออาชีพ',
  'บริการหลังการขาย ใส่ใจทุกขั้นตอน',
];

const FEATURES = [
  {
    label: 'ปลอดภัย',
    sub: 'แข็งแรง ทนทาน ปกป้องบ้านของคุณ',
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />,
  },
  {
    label: 'เก็บเสียง',
    sub: 'เงียบสงบ เป็นส่วนตัวในทุกพื้นที่',
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />,
  },
  {
    label: 'กันความร้อน',
    sub: 'ช่วยลดอุณหภูมิ ประหยัดพลังงาน',
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />,
  },
  {
    label: 'กันน้ำ 100%',
    sub: 'หมดกังวลเรื่องรั่วซึม แม้ในวันฝนตกหนัก',
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3.5S6 9 6 14a6 6 0 0012 0c0-5-6-10.5-6-10.5z" />,
  },
];

function FeatureIcon({ label, sub, icon }) {
  return (
    <div className="flex flex-col items-center text-center gap-1.5">
      <div className="w-10 h-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">{icon}</svg>
      </div>
      <div className="text-white text-small font-medium">{label}</div>
      <div className="text-white/50 text-[11px] leading-tight hidden lg:block">{sub}</div>
    </div>
  );
}

function EyeIcon({ open }) {
  return open ? (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  ) : (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  // ล็อกไม่ให้หน้า login เลื่อนขึ้นลงได้ — ทั้งมือถือและเดสก์ท็อป (ป้องกัน bounce/scroll เวลา content สูงกว่า viewport)
  useEffect(() => {
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, []);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | success
  const [showPw, setShowPw] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [notice] = useState(() => {
    const n = sessionStorage.getItem('login_notice');
    if (n) sessionStorage.removeItem('login_notice');
    return n || '';
  });

  useEffect(() => {
    const saved = localStorage.getItem(REMEMBER_KEY);
    if (saved) {
      setUsername(saved);
      setRememberMe(true);
    }
  }, []);

  // ปุ่มหลัก = provider เลือกอัตโนมัติจาก account (cache-first, fallback AD ถ้าเปิดใช้งาน)
  // ปุ่ม "Internal AP System" = forceAdGateway:true บังคับเช็คกับ AD Gateway จริงตรงๆ ข้าม local cache เสมอ
  // (ใช้ยืนยันว่ารหัสผ่าน AD ปัจจุบันถูกต้องจริง ไม่ใช่ผ่านเพราะ cache เดิมที่อาจไม่ใช่รหัส AD ล่าสุด)
  async function performLogin(opts = {}) {
    setError('');
    // ปุ่ม "Internal AP System" อยู่นอก <form> จึงไม่ได้ native required-validation แบบปุ่มหลัก — เช็คเองแทน
    if (!username || !password) {
      setError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
      return;
    }
    setStatus('loading');
    try {
      await login(username, password, opts);
      if (rememberMe) localStorage.setItem(REMEMBER_KEY, username);
      else localStorage.removeItem(REMEMBER_KEY);
      setStatus('success');
      setTimeout(() => navigate('/', { replace: true }), 450);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
      setStatus('idle');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    await performLogin();
  }

  return (
    <div
      className="h-screen flex bg-bg overflow-hidden overscroll-none"
      style={{ height: 'min(100dvh, 100svh)' }}
    >
      {/* ── Left brand panel — desktop only ── */}
      <div className="hidden lg:flex lg:w-[46%] relative brand-gradient animate-gradientPan flex-col justify-between p-8 xl:p-10 overflow-hidden">
        {/* decorative mullion grid */}
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 63px, white 64px), repeating-linear-gradient(90deg, transparent, transparent 63px, white 64px)',
          }}
        />
        {/* floating glow blobs — respect prefers-reduced-motion */}
        <motion.div
          className="absolute -top-16 -right-16 w-72 h-72 rounded-full bg-accent-glow/20 blur-3xl"
          animate={reduceMotion ? { opacity: 0.7 } : { opacity: [0.5, 0.9, 0.5] }}
          transition={{ duration: 7, repeat: reduceMotion ? 0 : Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-0 left-0 w-96 h-96 rounded-full bg-white/5 blur-3xl"
          animate={reduceMotion ? { y: 0 } : { y: [0, -20, 0] }}
          transition={{ duration: 10, repeat: reduceMotion ? 0 : Infinity, ease: 'easeInOut' }}
        />

        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="relative z-10">
          <div className="flex items-center gap-3">
            <img src={logoWindowAsia} alt="Window Asia" className="w-14 h-14 rounded-full shadow-lg" />
            <div>
              <div className="text-white font-bold text-h1 leading-tight">Window Asia</div>
              <div className="text-white/70 text-small">ประตูหน้าต่าง Alu/uPVC คุณภาพสูง</div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="relative z-10"
        >
          <h2 className="text-white text-h1 font-bold leading-snug mb-3">
            ความปลอดภัยที่คุณวางใจ<br />ดีไซน์ที่คุณเลือกได้
          </h2>
          <ul className="space-y-2 mb-5">
            {CHECKLIST.map(item => (
              <li key={item} className="flex items-center gap-2.5 text-white/90 text-body">
                <span className="w-5 h-5 rounded-full bg-accent-glow/25 border border-accent-glow/50 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                {item}
              </li>
            ))}
          </ul>

          <div className="glass-panel rounded-xl p-3 flex items-center gap-3 mb-5">
            <div className="w-11 h-11 rounded-full bg-accent-glow/20 border border-accent-glow/40 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <div className="text-white font-semibold text-body">รับประกันตลอดอายุการใช้งาน</div>
              <div className="text-white/60 text-small">มั่นใจในคุณภาพ ดูแลคุณตลอดไป</div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {FEATURES.map(f => <FeatureIcon key={f.label} {...f} />)}
          </div>
        </motion.div>

        <div className="relative z-10 text-white/40 text-[11px]">
          © {new Date().getFullYear()} Window Asia. All rights reserved.
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex items-center justify-center p-3 sm:p-8 relative overflow-hidden">
        {/* mobile-only compact brand header */}
        <div className="lg:hidden absolute top-2 sm:top-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
          <img src={logoWindowAsia} alt="Window Asia" className="w-7 h-7 sm:w-9 sm:h-9 rounded-full" />
          <span className="font-bold text-primary text-h3">Window Asia</span>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="w-full max-w-sm mt-8 sm:mt-14 lg:mt-0"
        >
          <div className="glass-card rounded-2xl p-4 sm:p-6 lg:p-8 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-accent to-accent-glow" />

            <div className="text-center mb-3 sm:mb-4 lg:mb-6">
              <h1 className="text-h1 font-bold text-primary">ยินดีต้อนรับ</h1>
              <p className="text-muted text-body mt-1">
                เข้าสู่ระบบ <span className="text-accent font-medium">Window Asia QMS</span>
              </p>
            </div>

            <div className="hidden sm:flex justify-center mb-4 lg:mb-6">
              <WindowMark size={96} />
            </div>

            <form onSubmit={handleSubmit} className="space-y-2 sm:space-y-3 lg:space-y-4">
              <div>
                <label className="label">ชื่อผู้ใช้งาน</label>
                <div className="relative">
                  <span className="absolute left-3 top-0 h-full flex items-center text-muted">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    className="input pl-10"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    autoComplete="username"
                    autoFocus
                    required
                  />
                </div>
              </div>

              <div>
                <label className="label">รหัสผ่าน</label>
                <div className="relative">
                  <span className="absolute left-3 top-0 h-full flex items-center text-muted">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </span>
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="input pl-10 pr-11"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(p => !p)}
                    className="absolute right-0 top-0 h-full px-3 flex items-center text-muted hover:text-accent transition-colors"
                    tabIndex={-1}
                    title={showPw ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  >
                    <EyeIcon open={showPw} />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-small">
                <label className="flex items-center gap-2 text-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    className="rounded border-border text-accent focus:ring-accent-glow"
                  />
                  จดจำฉัน
                </label>
                <div className="relative">
                  <button type="button" onClick={() => setForgotOpen(p => !p)} className="text-accent hover:underline">
                    ลืมรหัสผ่าน?
                  </button>
                  <AnimatePresence>
                    {forgotOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className="absolute right-0 top-full mt-2 w-56 bg-surface border border-border rounded-lg shadow-elevated p-3 z-20 text-left"
                      >
                        <p className="text-text text-small">กรุณาติดต่อผู้ดูแลระบบ (Admin) เพื่อรีเซ็ตรหัสผ่านให้คุณ</p>
                        <button type="button" onClick={() => setForgotOpen(false)} className="mt-2 text-accent text-small hover:underline">
                          รับทราบ
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <AnimatePresence>
                {notice && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="text-warning text-small bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 px-3 py-2 rounded">
                    {notice}
                  </motion.div>
                )}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, x: 0 }}
                    animate={{ opacity: 1, x: [0, -6, 6, -4, 4, 0] }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4 }}
                    className="text-danger text-small bg-red-50 dark:bg-red-900 px-3 py-2 rounded"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              <Button type="submit" className="w-full" loading={status === 'loading'}>
                {status === 'success' ? (
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    สำเร็จ
                  </span>
                ) : 'เข้าสู่ระบบ'}
              </Button>
            </form>

            <div className="flex items-center gap-3 my-3 sm:my-4 lg:my-6">
              <div className="flex-1 h-px bg-border" />
              <span className="text-muted text-small">หรือเข้าสู่ระบบด้วย</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => performLogin({ forceAdGateway: true })}
                disabled={status === 'loading'}
                title="บังคับตรวจสอบกับ Active Directory โดยตรง (ข้ามรหัสผ่านที่ cache ไว้) — ใช้ได้เฉพาะบัญชีที่เปิด Active Directory ไว้"
                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-border bg-surface hover:bg-bg hover:border-accent/40 transition-colors min-h-[52px] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-surface disabled:hover:border-border"
              >
                <span className="w-9 h-9 rounded-lg bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </span>
                <span className="flex-1 text-left min-w-0">
                  <span className="block text-body font-medium text-text">Internal AP System</span>
                  <span className="block text-[11px] text-muted truncate">ยืนยันตัวตนผ่าน Active Directory</span>
                </span>
              </button>

              <button
                type="button"
                disabled
                title="อยู่ระหว่างเชื่อมต่อ Microsoft 365 SSO — เร็วๆ นี้"
                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-border bg-surface min-h-[52px] opacity-60 cursor-not-allowed"
              >
                <span className="w-9 h-9 rounded-lg bg-bg flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5" viewBox="0 0 23 23"><path fill="#f35325" d="M1 1h10v10H1z" /><path fill="#81bc06" d="M12 1h10v10H12z" /><path fill="#05a6f0" d="M1 12h10v10H1z" /><path fill="#ffba08" d="M12 12h10v10H12z" /></svg>
                </span>
                <span className="flex-1 text-left min-w-0">
                  <span className="block text-body font-medium text-text">Microsoft</span>
                  <span className="block text-[11px] text-muted truncate">Microsoft 365 SSO</span>
                </span>
                <span className="badge bg-bg text-muted flex-shrink-0 whitespace-nowrap">เร็วๆ นี้</span>
              </button>
            </div>

            <p className="text-center text-muted text-small mt-3 sm:mt-4 lg:mt-6">
              ยังไม่มีบัญชี? <span className="text-text">กรุณาติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์เข้าใช้งาน</span>
            </p>
          </div>

          <p className="lg:hidden text-center text-muted text-[11px] mt-2 sm:mt-4">
            © {new Date().getFullYear()} Window Asia. All rights reserved.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
