import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { StatusBadge, STATUS_CFG, fmtTime } from './index';

const DownloadIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
  </svg>
);

// ====== Attachment display ======
function AttachmentItem({ att }) {
  const url = `/uploads/issue-talk/${att.file_path}`;
  const isImage = att.mime_type?.startsWith('image/');
  const isVideo = att.mime_type?.startsWith('video/');
  const isPdf = att.mime_type === 'application/pdf';

  if (isImage) {
    return (
      <div className="relative group inline-block">
        <a href={url} target="_blank" rel="noreferrer" className="block">
          <img
            src={url}
            alt={att.original_name}
            className="max-h-48 max-w-full rounded-lg border border-border object-cover cursor-pointer hover:brightness-90 transition-all"
          />
        </a>
        <a
          href={url}
          download={att.original_name}
          className="absolute top-1.5 right-1.5 bg-black/60 text-white p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
          title="ดาวน์โหลดรูปภาพ"
        >
          <DownloadIcon />
        </a>
      </div>
    );
  }
  if (isVideo) {
    return (
      <div className="flex flex-col gap-1">
        <video
          src={url}
          controls
          className="max-h-48 max-w-full rounded-lg border border-border"
        />
        <a
          href={url}
          download={att.original_name}
          className="inline-flex items-center gap-1.5 text-small text-accent hover:underline self-start"
        >
          <DownloadIcon />
          ดาวน์โหลดวีดีโอ
        </a>
      </div>
    );
  }
  return (
    <a
      href={url}
      download={att.original_name}
      className="inline-flex items-center gap-2 px-3 py-2 bg-bg border border-border rounded-lg text-small text-accent hover:bg-border/50 transition-colors"
    >
      {isPdf ? (
        <svg className="w-4 h-4 flex-shrink-0 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      ) : (
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
        </svg>
      )}
      <span className="truncate max-w-[180px]">{att.original_name}</span>
      <DownloadIcon />
    </a>
  );
}

// ====== Add participants modal ======
function AddParticipantsModal({ issueId, existingIds, onClose }) {
  const [selected, setSelected] = useState([]);
  const qc = useQueryClient();

  const { data: users = [] } = useQuery({
    queryKey: ['issue-talk-users'],
    queryFn: () => api.get('/issue-talk/users').then(r => r.data),
    staleTime: 60000,
  });

  const available = users.filter(u => !existingIds.includes(u.id));

  const add = useMutation({
    mutationFn: () => api.patch(`/issue-talk/${issueId}/participants`, { user_ids: selected }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-talk', String(issueId)] });
      onClose();
    },
  });

  const ROLE_LABEL = {
    admin: 'Admin', qc_staff: 'QC Staff', qc_supervisor: 'หัวหน้า QC',
    qc_manager: 'QC Manager', qmr: 'QMR', purchasing: 'จัดซื้อ',
    cco: 'CCO', cmo: 'CMO', cpo: 'CPO', production_manager: 'ผจก.ผลิต',
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-xl w-full max-w-sm shadow-xl flex flex-col max-h-[70vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <h3 className="font-semibold text-h3 text-primary">เพิ่มผู้เข้าร่วม</h3>
          <button onClick={onClose} className="text-muted hover:text-text w-8 h-8 flex items-center justify-center text-xl">×</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {available.length === 0 ? (
            <div className="p-4 text-small text-muted text-center">ไม่มีผู้ใช้งานอื่นที่สามารถเพิ่มได้</div>
          ) : available.map(u => (
            <label key={u.id} className="flex items-center gap-2 cursor-pointer hover:bg-bg px-4 py-2.5 border-b border-border last:border-0">
              <input
                type="checkbox"
                checked={selected.includes(u.id)}
                onChange={() => setSelected(p => p.includes(u.id) ? p.filter(id => id !== u.id) : [...p, u.id])}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-body text-text flex-1">{u.full_name}</span>
              <span className="text-small text-muted">{ROLE_LABEL[u.role] || u.role}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-border flex-shrink-0">
          <button onClick={onClose} className="btn-secondary flex-1 min-h-[44px]">ยกเลิก</button>
          <button
            onClick={() => add.mutate()}
            disabled={!selected.length || add.isPending}
            className="btn-primary flex-1 min-h-[44px] disabled:opacity-50"
          >
            {add.isPending ? 'กำลังเพิ่ม...' : `เพิ่ม ${selected.length > 0 ? selected.length + ' คน' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ====== Message bubble ======
function MessageBubble({ msg, isOwn, readCount = 0, totalOthers = 1 }) {
  return (
    <div className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'} mb-4`}>
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-small font-bold flex-shrink-0
        ${isOwn ? 'bg-primary' : 'bg-accent'}`}>
        {msg.user_name?.charAt(0).toUpperCase()}
      </div>

      <div className={`max-w-[75%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        {/* Name + time */}
        <div className={`flex items-center gap-2 text-small text-muted ${isOwn ? 'flex-row-reverse' : ''}`}>
          <span className="font-medium text-text">{msg.user_name}</span>
          <span>{fmtTime(msg.created_at)}</span>
        </div>

        {/* Message body */}
        {msg.body && (
          <div className={`px-3 py-2 rounded-2xl text-body leading-relaxed whitespace-pre-wrap
            ${isOwn
              ? 'bg-primary text-white rounded-tr-sm'
              : 'bg-bg border border-border text-text rounded-tl-sm'
            }`}>
            {msg.body}
          </div>
        )}

        {/* Attachments */}
        {msg.attachments?.length > 0 && (
          <div className="flex flex-col gap-2 mt-1">
            {msg.attachments.map(att => (
              <AttachmentItem key={att.id} att={att} />
            ))}
          </div>
        )}

        {/* Read receipt — only on own messages with at least 1 reader */}
        {isOwn && readCount > 0 && (
          <span className="text-[10px] text-muted flex items-center gap-0.5 mt-0.5">
            <svg className="w-3 h-3 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            {totalOthers === 1 ? 'อ่านแล้ว' : `อ่านแล้ว ${readCount} คน`}
          </span>
        )}
      </div>
    </div>
  );
}

// ====== Main Detail page ======
export default function IssueTalkDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [messagesEnd, setMessagesEnd] = useState(null);

  const [replyBody, setReplyBody] = useState('');
  const [replyFiles, setReplyFiles] = useState([]);
  const [showAddPart, setShowAddPart] = useState(false);
  const [statusDropOpen, setStatusDropOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { data: issue, isLoading, isError } = useQuery({
    queryKey: ['issue-talk', id],
    queryFn: () => api.get(`/issue-talk/${id}`).then(r => r.data),
    staleTime: 0,
    refetchInterval: 3000, // real-time polling ทุก 3 วินาที
  });

  // Lock <main> scroll — chat page manages its own scroll
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    const prev = { overflowY: main.style.overflowY, padding: main.style.padding, paddingBottom: main.style.paddingBottom };
    main.style.overflowY = 'hidden';
    main.style.padding = '0';
    return () => {
      main.style.overflowY = prev.overflowY;
      main.style.padding = prev.padding;
      main.style.paddingBottom = prev.paddingBottom;
    };
  }, []);

  // Scroll to bottom when messages load or new message arrives
  useEffect(() => {
    if (issue?.messages?.length && messagesEnd) {
      messagesEnd.scrollIntoView({ behavior: 'smooth' });
    }
  }, [issue?.messages?.length, messagesEnd]);

  // Clear sidebar unread badge when this room is opened/updated
  useEffect(() => {
    if (!issue?.id) return;
    qc.invalidateQueries({ queryKey: ['issue-talk-unread'] });
    qc.invalidateQueries({ queryKey: ['issue-talks'] });
  }, [issue?.id, issue?.messages?.length]);

  const sendReply = useMutation({
    mutationFn: (fd) => api.post(`/issue-talk/${id}/messages`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => setUploadProgress(Math.round((e.loaded * 100) / (e.total || 1))),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-talk', id] });
      qc.invalidateQueries({ queryKey: ['issue-talks'] });
      setReplyBody('');
      setReplyFiles([]);
      setUploadProgress(0);
    },
    onError: () => setUploadProgress(0),
  });

  const updateStatus = useMutation({
    mutationFn: (status) => api.patch(`/issue-talk/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-talk', id] });
      qc.invalidateQueries({ queryKey: ['issue-talks'] });
      setStatusDropOpen(false);
    },
  });

  const deleteIssue = useMutation({
    mutationFn: () => api.delete(`/issue-talk/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-talks'] });
      navigate('/issue-talk');
    },
  });

  function handleSend() {
    if (!replyBody.trim() && !replyFiles.length) return;
    const fd = new FormData();
    fd.append('body', replyBody.trim());
    for (const f of replyFiles) fd.append('files', f);
    sendReply.mutate(fd);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleFileChange(e) {
    const selected = Array.from(e.target.files || []);
    if (selected.length > 0) setReplyFiles(prev => [...prev, ...selected]);
    e.target.value = '';
  }

  function removeReplyFile(i) {
    setReplyFiles(p => p.filter((_, j) => j !== i));
  }

  if (isLoading) return <div className="text-center text-muted py-10">กำลังโหลด...</div>;
  if (isError || !issue) return (
    <div className="text-center text-muted py-10">
      <div className="mb-2">ไม่พบข้อมูลหรือไม่มีสิทธิ์เข้าถึง</div>
      <button onClick={() => navigate('/issue-talk')} className="text-accent hover:underline text-small">กลับรายการ</button>
    </div>
  );

  const allParticipantIds = [issue.created_by, ...issue.participants.map(p => p.id)];
  const isClosed = issue.status === 'closed';

  // Compute read counts per message (for "อ่านแล้ว X คน" indicator)
  const reads = issue.reads || [];
  const otherMemberIds = allParticipantIds.filter(uid => uid !== user?.id);
  const totalOthers = otherMemberIds.length;
  const readsMap = Object.fromEntries(reads.map(r => [r.user_id, r.last_read_message_id]));

  // ── 3-zone chat layout ──────────────────────────────────────────────────────
  //  [header — flex-shrink-0]
  //  [messages — flex-1 min-h-0 overflow-y-auto]
  //  [reply — flex-shrink-0]
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">

      {/* ── ZONE 1: Header (locked, no scroll) ── */}
      <div className="flex-shrink-0 bg-bg border-b border-border px-4 pt-2 pb-2">
        <div className="max-w-2xl mx-auto flex items-start gap-2">
          <button
            onClick={() => navigate('/issue-talk')}
            className="flex items-center gap-1 text-accent text-small hover:underline min-h-[44px] flex-shrink-0 pr-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            กลับ
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <StatusBadge status={issue.status} />
              {issue.is_creator && isClosed && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-small text-danger hover:underline flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  ลบห้อง
                </button>
              )}
              {issue.is_creator && !isClosed && (
                <div className="relative">
                  <button
                    onClick={() => setStatusDropOpen(p => !p)}
                    className="text-small text-accent hover:underline flex items-center gap-1"
                  >
                    เปลี่ยนสถานะ
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {statusDropOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setStatusDropOpen(false)} />
                      <div className="absolute left-0 top-full mt-1 w-40 bg-surface border border-border rounded-lg shadow-lg z-20 overflow-hidden">
                        {Object.entries(STATUS_CFG).map(([val, cfg]) => (
                          <button
                            key={val}
                            onClick={() => updateStatus.mutate(val)}
                            disabled={val === issue.status || updateStatus.isPending}
                            className={`w-full text-left px-3 py-2 text-small hover:bg-bg disabled:opacity-40 flex items-center gap-2
                              ${val === issue.status ? 'font-medium' : ''}`}
                          >
                            <span className={`inline-block w-2 h-2 rounded-full ${cfg.cls.replace('text-','bg-').split(' ')[0]}`} />
                            {cfg.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-start gap-2 flex-wrap">
              <span className="bg-primary/10 text-primary font-bold px-2.5 py-0.5 rounded-lg leading-snug text-h3">
                {issue.title}
              </span>
              {issue.supplier && (
                <span className="inline-flex items-center gap-1 bg-cyan-50 dark:bg-cyan-900 border border-cyan-200 dark:border-cyan-700 text-cyan-800 dark:text-cyan-200 text-small px-2.5 py-0.5 rounded-lg font-medium flex-shrink-0 mt-0.5">
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  {issue.supplier.code ? `[${issue.supplier.code}] ` : ''}{issue.supplier.name}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── ZONE 2: Messages (scrollable) ── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-3">

          {/* Participants bar */}
          <div className="card px-4 py-2.5 mb-3 flex items-center gap-2 flex-wrap">
            <span className="text-small text-muted">ผู้เข้าร่วม:</span>
            <span className="inline-flex items-center gap-1 bg-primary/10 text-primary text-small font-medium px-2 py-0.5 rounded-full">
              {issue.creator.full_name}
              <span className="text-muted font-normal">(ผู้สร้าง)</span>
            </span>
            {issue.participants.map(p => (
              <span key={p.id} className="inline-flex items-center bg-bg border border-border text-small text-text px-2 py-0.5 rounded-full">
                {p.full_name}
              </span>
            ))}
            {issue.is_creator && !isClosed && (
              <button
                onClick={() => setShowAddPart(true)}
                className="text-small text-accent hover:underline flex items-center gap-1 ml-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                เพิ่ม
              </button>
            )}
            <span className="ml-auto text-small text-muted">{fmtTime(issue.created_at)}</span>
          </div>

          {/* Opening post */}
          {(issue.body || issue.opening_attachments?.length > 0) && (
            <div className="card px-4 py-3 mb-4 border-l-4 border-primary">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-small font-bold flex-shrink-0">
                  {issue.creator.full_name?.charAt(0).toUpperCase()}
                </div>
                <span className="text-small font-medium text-text">{issue.creator.full_name}</span>
                <span className="text-small text-muted ml-auto">{fmtTime(issue.created_at)}</span>
              </div>
              {issue.body && (
                <p className="text-body text-text whitespace-pre-wrap mb-2 leading-relaxed">{issue.body}</p>
              )}
              {issue.opening_attachments?.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {issue.opening_attachments.map(att => (
                    <AttachmentItem key={att.id} att={att} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          {issue.messages.length === 0 ? (
            <div className="text-center text-muted text-small py-6 border-t border-border">
              ยังไม่มีข้อความ — เป็นคนแรกที่ตอบกลับ
            </div>
          ) : (
            <div>
              <div className="text-small text-muted text-center mb-4">— {issue.messages.length} ข้อความ —</div>
              {issue.messages.map(msg => {
                const isOwn = msg.user_id === user?.id;
                const readCount = isOwn
                  ? otherMemberIds.filter(uid => (readsMap[uid] ?? 0) >= msg.id).length
                  : 0;
                return (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    isOwn={isOwn}
                    readCount={readCount}
                    totalOthers={totalOthers}
                  />
                );
              })}
            </div>
          )}
          <div ref={setMessagesEnd} />
        </div>
      </div>

      {/* ── ZONE 3: Reply form (locked at bottom) ── */}
      <div className="flex-shrink-0 bg-surface border-t border-border pb-20 lg:pb-0">
        <div className="max-w-2xl mx-auto px-4 py-3">
          {isClosed ? (
            <div className="text-center text-muted text-small py-1">
              การสนทนานี้ถูกปิดแล้ว — ไม่สามารถตอบกลับได้
            </div>
          ) : (
            <div>
              <div className="flex gap-2 items-end">
                <label
                  htmlFor="reply-file-input"
                  className="text-muted hover:text-accent flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg hover:bg-bg cursor-pointer"
                  title="แนบไฟล์ (รูป/วีดีโอ/PDF)"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </label>
                <input
                  type="file"
                  id="reply-file-input"
                  multiple
                  className="sr-only"
                  accept="image/*,video/mp4,video/quicktime,video/webm,.pdf"
                  onChange={handleFileChange}
                />
                <textarea
                  className="input flex-1 resize-none min-h-[44px] max-h-32 py-2.5"
                  rows={1}
                  value={replyBody}
                  onChange={e => setReplyBody(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="ตอบกลับ... (Enter ส่ง, Shift+Enter ขึ้นบรรทัด)"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={(!replyBody.trim() && !replyFiles.length) || sendReply.isPending}
                  className="btn-primary flex-shrink-0 w-10 h-10 p-0 flex items-center justify-center disabled:opacity-50"
                >
                  {sendReply.isPending ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </button>
              </div>

              {replyFiles.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border">
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {replyFiles.map((f, i) => (
                      <div key={i} className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 bg-bg border border-border rounded px-2 py-1 text-small">
                          <svg className="w-3.5 h-3.5 text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          <span className="text-text max-w-[140px] truncate">{f.name}</span>
                          {!sendReply.isPending && (
                            <button type="button" onClick={() => removeReplyFile(i)} className="text-danger hover:opacity-80 ml-0.5 text-base leading-none">×</button>
                          )}
                        </div>
                        {sendReply.isPending && (
                          <div className="h-1 bg-border rounded-full overflow-hidden w-full">
                            <div className="h-full bg-primary transition-all duration-150 rounded-full" style={{ width: `${uploadProgress}%` }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {sendReply.isPending && uploadProgress > 0 && (
                    <p className="text-[10px] text-muted text-right">{uploadProgress}%</p>
                  )}
                </div>
              )}

              {sendReply.isError && (
                <p className="text-small text-danger mt-1">
                  {sendReply.error?.response?.data?.error || 'เกิดข้อผิดพลาดในการส่ง'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {showAddPart && (
        <AddParticipantsModal
          issueId={id}
          existingIds={allParticipantIds}
          onClose={() => setShowAddPart(false)}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl w-full max-w-sm shadow-xl p-5">
            <h3 className="font-semibold text-h3 text-text mb-2">ลบห้องสนทนา</h3>
            <p className="text-body text-muted mb-1">
              ยืนยันลบ "<span className="font-medium text-text">{issue.title}</span>"?
            </p>
            <p className="text-small text-danger mb-4">ข้อมูลและไฟล์แนบทั้งหมดจะถูกลบถาวร ไม่สามารถย้อนกลับได้</p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteIssue.isPending}
                className="btn-secondary flex-1 min-h-[44px]"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => deleteIssue.mutate()}
                disabled={deleteIssue.isPending}
                className="flex-1 min-h-[44px] bg-danger text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleteIssue.isPending ? 'กำลังลบ...' : 'ลบห้องสนทนา'}
              </button>
            </div>
            {deleteIssue.isError && (
              <p className="text-small text-danger mt-2 text-center">
                {deleteIssue.error?.response?.data?.error || 'เกิดข้อผิดพลาด'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
