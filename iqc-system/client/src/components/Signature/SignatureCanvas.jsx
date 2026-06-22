import React, { useRef } from 'react';
import SigCanvas from 'react-signature-canvas';
import Button from '../UI/Button';

export default function SignatureCanvas({ onConfirm, disabled = false }) {
  const sigRef = useRef(null);

  function handleConfirm() {
    if (!sigRef.current || sigRef.current.isEmpty()) return;
    const dataURL = sigRef.current.getTrimmedCanvas().toDataURL('image/png');
    onConfirm(dataURL);
  }

  function handleClear() {
    sigRef.current?.clear();
  }

  return (
    <div className="space-y-2">
      <div className={`border-2 rounded-lg overflow-hidden ${disabled ? 'border-border bg-bg' : 'border-success'}`}>
        {disabled ? (
          <div className="h-32 flex items-center justify-center text-muted text-small">รอขั้นก่อนหน้า</div>
        ) : (
          <SigCanvas
            ref={sigRef}
            canvasProps={{ className: 'w-full', height: 128, style: { touchAction: 'none' } }}
            backgroundColor="white"
          />
        )}
      </div>
      {!disabled && (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleClear} className="text-small py-1.5">ล้าง</Button>
          <Button variant="success" size="sm" onClick={handleConfirm} className="text-small py-1.5">ยืนยันลายเซ็น</Button>
        </div>
      )}
    </div>
  );
}
