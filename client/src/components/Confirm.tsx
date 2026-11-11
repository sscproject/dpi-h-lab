// Confirmation pop-up for actions that are hard to undo. With `typeToConfirm`, the person
// must type that text (e.g. the team code) before the action button works.

import { useId, useState } from 'react';
import { useContent } from '../content';
import { normalizeCode } from '../../../shared/codes';
import { Modal } from './Modal';

export function Confirm(props: {
  title: string;
  message: string;
  action: string;
  danger?: boolean;
  typeToConfirm?: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const { t } = useContent();
  const id = useId();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = !props.typeToConfirm || normalizeCode(typed) === normalizeCode(props.typeToConfirm);
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <p>{props.message}</p>
      {props.typeToConfirm && (
        <div className="f">
          <label className="lab" htmlFor={id}>{t('confirm.type', { text: props.typeToConfirm })}</label>
          <input id={id} className="mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={props.onClose}>{t('confirm.cancel')}</button>
        <button
          type="button"
          className={`btn primary${props.danger ? ' danger' : ''}`}
          disabled={!ok || busy}
          onClick={async () => { setBusy(true); try { await props.onConfirm(); props.onClose(); } finally { setBusy(false); } }}
        >
          {props.action}
        </button>
      </div>
    </Modal>
  );
}
