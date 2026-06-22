import React from 'react';
import Modal from './Modal';
import Button from './Button';

export default function ConfirmDialog({ open, onClose, onConfirm, title = 'ยืนยัน', message, confirmLabel = 'ยืนยัน', variant = 'danger', loading = false }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-body text-text mb-6">{message}</p>
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={onClose} disabled={loading}>ยกเลิก</Button>
        <Button variant={variant} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}
