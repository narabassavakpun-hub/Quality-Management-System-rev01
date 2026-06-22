import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';

const QC_STATION_LABELS = {
  incoming: 'QC รับเข้า', plant1: 'QC โรง1', plant2: 'QC โรง2',
  plant4: 'QC โรง4', special: 'QC บานพิเศษ', calibration: 'QC Calibration',
  qc_admin: 'QC Admin', supervisor: 'QC Supervisor',
};

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtTime(dt) {
  if (!dt) return '';
  const d = new Date(dt.includes('Z') || dt.includes('+') ? dt : dt + 'Z');
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtWorkHours(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} ชม. ${m} น.` : `${m} น.`;
}

function LiveWorkTimer({ checkInAt }) {
  const [mins, setMins] = useState(null);
  useEffect(() => {
    function calc() {
      const inMs = new Date(checkInAt.includes('Z') ? checkInAt : checkInAt + 'Z').getTime();
      setMins(Math.round((Date.now() - inMs) / 60000));
    }
    calc();
    const t = setInterval(calc, 30000);
    return () => clearInterval(t);
  }, [checkInAt]);
  if (mins == null) return null;
  return <span>{fmtWorkHours(mins)}</span>;
}

export default function QCCheckIn() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [gpsState, setGpsState] = useState('idle'); // idle | loading | ok | outside | denied | error
  const [position, setPosition] = useState(null);
  const [gpsError, setGpsError] = useState('');
  const [mode, setMode] = useState('checkin'); // 'checkin' | 'checkout'

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['attendance-my-status'],
    queryFn: () => api.get('/attendance/my-status').then(r => r.data),
    staleTime: 0,
  });

  // Determine mode based on status
  useEffect(() => {
    if (!status) return;
    if (status.checked_in && !status.checked_out) setMode('checkout');
    else setMode('checkin');
  }, [status?.checked_in, status?.checked_out]);

  const checkIn = useMutation({
    mutationFn: ({ lat, lon }) => api.post('/attendance/check-in', { lat, lon }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance-my-status'] });
      qc.invalidateQueries({ queryKey: ['qc-attendance-today'] });
    },
  });

  const checkOut = useMutation({
    mutationFn: ({ lat, lon }) => api.post('/attendance/check-out', { lat, lon }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance-my-status'] });
      qc.invalidateQueries({ queryKey: ['qc-attendance-today'] });
    },
  });

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsState('error');
      setGpsError('Browser ไม่รองรับ Geolocation');
      return;
    }
    setGpsState('loading');
    setGpsError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        if (status?.geofence_configured && status.factory_lat && status.factory_lon) {
          const dist = haversine(lat, lon, status.factory_lat, status.factory_lon);
          setPosition({ lat, lon, dist: Math.round(dist) });
          setGpsState(dist <= status.factory_radius_m ? 'ok' : 'outside');
        } else {
          setPosition({ lat, lon, dist: null });
          setGpsState('ok');
        }
      },
      (err) => {
        setGpsState(err.code === 1 ? 'denied' : 'error');
        setGpsError(err.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, [status]);

  // Auto-request GPS on mount / on mode change
  useEffect(() => {
    if (status && !status.checked_out) requestLocation();
  }, [status?.checked_in, status?.checked_out]);

  const canAct = gpsState === 'ok' && !checkIn.isSuccess && !checkOut.isSuccess;

  const thaiDate = (() => {
    const now = new Date();
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear() + 543}`;
  })();

  const mutate    = mode === 'checkout' ? checkOut : checkIn;
  const isSuccess = mode === 'checkout' ? checkOut.isSuccess : checkIn.isSuccess;
  const isError   = mode === 'checkout' ? checkOut.isError   : checkIn.isError;
  const errMsg    = isError
    ? (mutate.error?.response?.data?.error || 'เกิดข้อผิดพลาด')
    : '';

  return (
    <div className="max-w-sm mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-5">
        <button onClick={() => navigate('/qc-attendance')} className="text-accent hover:underline flex items-center gap-1 text-small min-h-[44px]">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          กลับ
        </button>
        <div>
          <h1 className="text-h2 font-bold text-primary leading-tight">
            {mode === 'checkout' ? 'เช็คออกจากงาน' : 'เช็คชื่อเข้างาน'}
          </h1>
          <p className="text-small text-muted">{thaiDate}</p>
        </div>
      </div>

      {/* User card */}
      <div className="card p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white text-h2 font-bold flex-shrink-0">
            {user?.full_name?.charAt(0)?.toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="font-semibold text-text">{user?.full_name}</div>
            <div className="text-small text-muted">
              {user?.qc_station ? QC_STATION_LABELS[user.qc_station] || user.qc_station : 'ยังไม่ระบุสถานี'}
            </div>
          </div>
          {status?.shift_start && (
            <div className="text-right text-[11px] text-muted">
              <div>เริ่มงาน {status.shift_start}</div>
              <div>เลิกงาน {status.shift_end}</div>
            </div>
          )}
        </div>
      </div>

      {statusLoading ? (
        <div className="text-center text-muted py-10">กำลังโหลด...</div>
      ) : (
        <>
          {/* Already completed (checked in AND checked out) */}
          {status?.checked_in && status?.checked_out && !checkIn.isSuccess && !checkOut.isSuccess && (
            <div className="card p-6 text-center mb-4">
              <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3">
                <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="text-h3 font-bold text-accent mb-3">เสร็จสิ้นวันนี้</div>
              <div className="grid grid-cols-2 gap-3 text-left">
                <div className="bg-bg rounded-lg p-3">
                  <div className="text-[11px] text-muted mb-0.5">เข้างาน</div>
                  <div className="text-lg font-mono font-bold text-text">{fmtTime(status.check_in_at)}</div>
                  {(status.late_minutes || 0) > 0
                    ? <div className="text-[11px] text-warning mt-0.5">สาย {status.late_minutes} นาที</div>
                    : <div className="text-[11px] text-success mt-0.5">ตรงเวลา</div>}
                </div>
                <div className="bg-bg rounded-lg p-3">
                  <div className="text-[11px] text-muted mb-0.5">ออกงาน</div>
                  <div className="text-lg font-mono font-bold text-text">{fmtTime(status.check_out_at)}</div>
                  {status.work_minutes != null && (
                    <div className="text-[11px] text-muted mt-0.5">{fmtWorkHours(status.work_minutes)}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Active state (checked in, not checked out) — show summary + checkout button below */}
          {status?.checked_in && !status?.checked_out && !checkOut.isSuccess && (
            <div className="card p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-[11px] text-muted">เวลาเข้างาน</div>
                  <div className="text-2xl font-mono font-bold text-text">{fmtTime(status.check_in_at)}</div>
                </div>
                <div className="text-right">
                  {(status.late_minutes || 0) > 0 ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-100 text-orange-700 text-small font-semibold">
                      สาย {status.late_minutes} นาที
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-small font-semibold">
                      ตรงเวลา
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-small text-muted">
                <svg className="w-4 h-4 text-success animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="8" />
                </svg>
                กำลังทำงาน · <LiveWorkTimer checkInAt={status.check_in_at} />
              </div>
              {status.geofence_ok && (
                <div className="flex items-center gap-1 text-[11px] text-success mt-2">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  </svg>
                  ยืนยัน Geofence แล้ว
                </div>
              )}
            </div>
          )}

          {/* Success result after action */}
          {isSuccess && (
            <div className="card p-6 text-center mb-4">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="text-h3 font-bold text-success">
                {mode === 'checkout' ? 'เช็คออกสำเร็จ!' : 'เช็คชื่อสำเร็จ!'}
              </div>
              <div className="text-small text-muted mt-1">บันทึกเวลาเรียบร้อยแล้ว</div>
            </div>
          )}

          {/* GPS panel — shown when action is needed */}
          {!isSuccess && !(status?.checked_in && status?.checked_out) && (
            <div className="card p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-text">ตำแหน่ง GPS</span>
                <button
                  onClick={requestLocation}
                  disabled={gpsState === 'loading'}
                  className="text-small text-accent hover:underline disabled:opacity-40"
                >
                  {gpsState === 'loading' ? 'กำลังตรวจสอบ...' : 'รีเฟรช'}
                </button>
              </div>

              {gpsState === 'idle' && (
                <div className="text-small text-muted text-center py-2">กดปุ่มตรวจสอบตำแหน่ง</div>
              )}
              {gpsState === 'loading' && (
                <div className="flex items-center gap-2 text-small text-muted py-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  กำลังตรวจสอบตำแหน่ง...
                </div>
              )}
              {gpsState === 'ok' && (
                <div className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
                  <svg className="w-5 h-5 text-success flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  </svg>
                  <div>
                    <div className="font-medium text-success text-small">อยู่ในเขตโรงงาน</div>
                    {position?.dist !== null && (
                      <div className="text-[11px] text-green-700 mt-0.5">
                        ห่างจากศูนย์กลาง {position.dist} เมตร (รัศมี {status?.factory_radius_m} เมตร)
                      </div>
                    )}
                    {!status?.geofence_configured && (
                      <div className="text-[11px] text-muted mt-0.5">ยังไม่ได้ตั้งค่า Geofence — อนุญาตให้เช็คชื่อได้</div>
                    )}
                  </div>
                </div>
              )}
              {gpsState === 'outside' && (
                <div className="flex items-start gap-3 p-3 bg-red-50 rounded-lg">
                  <svg className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  <div>
                    <div className="font-medium text-danger text-small">อยู่นอกเขตโรงงาน</div>
                    <div className="text-[11px] text-red-700 mt-0.5">
                      ห่างจากศูนย์กลาง {position?.dist} เมตร (รัศมี {status?.factory_radius_m} เมตร)
                    </div>
                  </div>
                </div>
              )}
              {gpsState === 'denied' && (
                <div className="flex items-start gap-3 p-3 bg-orange-50 rounded-lg">
                  <svg className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <div className="font-medium text-warning text-small">ไม่อนุญาตเข้าถึง GPS</div>
                    <div className="text-[11px] text-muted mt-0.5">กรุณาอนุญาตการเข้าถึงตำแหน่งใน browser แล้วกดรีเฟรช</div>
                  </div>
                </div>
              )}
              {gpsState === 'error' && (
                <div className="text-small text-danger py-2">{gpsError || 'ไม่สามารถรับตำแหน่ง GPS'}</div>
              )}
            </div>
          )}

          {/* Action button */}
          {!isSuccess && !(status?.checked_in && status?.checked_out) && (
            <>
              <button
                onClick={() => position && mutate.mutate({ lat: position.lat, lon: position.lon })}
                disabled={!canAct || mutate.isPending}
                className={`w-full min-h-[56px] rounded-xl text-h3 font-bold transition-all shadow-sm
                  ${canAct
                    ? mode === 'checkout'
                      ? 'bg-accent text-white hover:opacity-90 active:scale-[0.98]'
                      : 'bg-primary text-white hover:opacity-90 active:scale-[0.98]'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
              >
                {mutate.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    กำลังบันทึก...
                  </span>
                ) : mode === 'checkout' ? 'เช็คออกจากงาน' : 'เช็คชื่อเข้างาน'}
              </button>

              {isError && (
                <div className="mt-3 p-3 bg-red-50 rounded-lg text-small text-danger text-center">
                  {errMsg}
                </div>
              )}

              {gpsState !== 'ok' && gpsState !== 'loading' && (
                <button
                  onClick={requestLocation}
                  className="w-full mt-3 min-h-[48px] border border-border rounded-xl text-body font-medium text-text hover:bg-bg"
                >
                  ตรวจสอบตำแหน่ง GPS
                </button>
              )}
            </>
          )}

          {/* Link to history */}
          <button
            onClick={() => navigate(`/qc-attendance/employee/${user.id}`)}
            className="w-full mt-4 text-small text-accent hover:underline text-center py-2"
          >
            ดูประวัติการเข้างานของฉัน →
          </button>
        </>
      )}
    </div>
  );
}
