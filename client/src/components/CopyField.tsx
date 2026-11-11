// A read-only link or code with Copy, and optionally Show QR / Download QR.

import { useState } from 'react';
import { useContent } from '../content';
import { downloadQrPng, QrDialog } from './Qr';

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the text is on screen to select */
    }
  };
  return { copied, copy };
}

export function CopyField({ id, label, value, qrTitle, qrFile }: { id: string; label: string; value: string; qrTitle?: string; qrFile?: string }) {
  const { t } = useContent();
  const { copied, copy } = useCopy();
  const [qrOpen, setQrOpen] = useState(false);
  return (
    <div className="f">
      <label className="lab" htmlFor={id}>{label}</label>
      <div className="copyrow">
        <input id={id} readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn small" onClick={() => copy(value)}>
          <span aria-live="polite">{copied ? t('copy.copied') : t('copy.copy')}</span>
        </button>
      </div>
      {qrTitle && qrFile && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn small" aria-haspopup="dialog" onClick={() => setQrOpen(true)}>{t('qr.show')}</button>
            <button type="button" className="btn small" onClick={() => downloadQrPng(value, qrFile)}>{t('qr.download')}</button>
          </div>
          {qrOpen && <QrDialog text={value} title={qrTitle} filename={qrFile} onClose={() => setQrOpen(false)} />}
        </>
      )}
    </div>
  );
}
