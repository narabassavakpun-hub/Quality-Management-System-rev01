import React from 'react';
import { STATUS_LABELS } from '../../utils/rolePermissions';

export default function Badge({ status, className = '' }) {
  const config = STATUS_LABELS[status] || { label: status, color: 'bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-200' };
  return (
    <span className={`badge ${config.color} ${className}`}>
      {config.label}
    </span>
  );
}
