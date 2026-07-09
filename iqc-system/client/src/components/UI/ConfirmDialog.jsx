import React from 'react';
import Modal from './Modal';
import Button from './Button';

export default function ConfirmDialog({ open, onClose, onConfirm, title = 'ยืนยัน', message, confirmLabel = 'ยืนยัน', variant = 'danger', loading = false, error = '' }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-body text-text mb-4">{message}</p>
      {error && <p className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2 mb-4">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={onClose} disabled={loading}>ยกเลิก</Button>
        <Button variant={variant} onClick={onConfirm} loading={loading} disabled={!!error}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}
