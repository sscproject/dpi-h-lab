// QR codes for the join and owner links: a pop-up with a large code, and a PNG download.

import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { useContent } from '../content';
import { Modal } from './Modal';

function matrix(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return { n, dark: (r: number, c: number) => qr.isDark(r, c) };
}

const QUIET = 4; // modules of white border, so phone cameras can find the code

/** Crisp, scalable QR code as SVG rects. Always dark on white so it scans in either theme. */
export function QrSvg({ text, size = 240, label }: { text: string; size?: number; label: string }) {
  const { n, dark } = useMemo(() => matrix(text), [text]);
  const total = n + QUIET * 2;
  const cells: string[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) cells.push(`M${c + QUIET} ${r + QUIET}h1v1h-1z`);
  return (
    <svg className="qr" role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${total} ${total}`} shapeRendering="crispEdges">
      <rect width={total} height={total} className="qr-bg" />
      <path d={cells.join('')} className="qr-fg" />
    </svg>
  );
}

/** Draws the code onto a canvas and saves it as a PNG. */
export function downloadQrPng(text: string, filename: string, scale = 12) {
  const { n, dark } = matrix(text);
  const total = n + QUIET * 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = total * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) ctx.fillRect((c + QUIET) * scale, (r + QUIET) * scale, scale, scale);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}

export function QrDialog({ text, title, filename, onClose }: { text: string; title: string; filename: string; onClose: () => void }) {
  const { t } = useContent();
  return (
    <Modal title={title} onClose={onClose}>
      <div className="qr-wrap"><QrSvg text={text} size={280} label={title} /></div>
      <p className="mono qr-text">{text}</p>
      <button type="button" className="btn primary" onClick={() => downloadQrPng(text, filename)}>{t('qr.download')}</button>
    </Modal>
  );
}
