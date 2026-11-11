// Worksheet controls bound to a field path. Text autosaves debounced (FR-R1);
// choices save immediately. All are read-only when the group is closed.

import { useEffect, useId, useState, type ReactNode } from 'react';
import { fieldSpec, setValues } from '../../../shared/worksheet';
import { useWs } from '../worksheet/WorksheetContext';
import { useContent } from '../content';
import { InfoButton } from './Info';

const TEXT_DEBOUNCE_MS = 400;

export function TextField(props: {
  path: string;
  label: ReactNode;
  infoId?: string;
  help?: string;
  placeholder?: string;
  multiline?: boolean;
  labelHidden?: boolean;
}) {
  const ws = useWs();
  const { t } = useContent();
  const id = useId();
  const [showTheirs, setShowTheirs] = useState(false);
  const notice = ws.notices[props.path];
  const helpId = `${id}-help`;
  const stored = typeof ws.values[props.path] === 'string' ? (ws.values[props.path] as string) : '';
  const [draft, setDraft] = useState(stored);
  const [focused, setFocused] = useState(false);
  const spec = fieldSpec(props.path);
  const max = spec?.kind === 'text' ? spec.max : undefined;

  // Follow the stored value unless this person is typing in the field.
  useEffect(() => { if (!focused) setDraft(stored); }, [stored, focused]);

  const onChange = (v: string) => {
    setDraft(v);
    ws.set(props.path, v === '' ? null : v, TEXT_DEBOUNCE_MS);
  };
  const common = {
    id,
    value: draft,
    maxLength: max,
    readOnly: ws.readOnly,
    placeholder: props.placeholder,
    'aria-describedby': props.help ? helpId : undefined,
    onFocus: () => { setFocused(true); ws.startEditing(props.path); },
    onBlur: (e: { relatedTarget: EventTarget | null; currentTarget: HTMLElement }) => {
      // Moving to the notice's own buttons is not leaving the field.
      if (e.relatedTarget instanceof Node && e.currentTarget.parentElement?.contains(e.relatedTarget)) return;
      setFocused(false);
      setShowTheirs(false);
      ws.stopEditing(props.path);
    },
    onChange: (e: { target: { value: string } }) => {
      // Typing means editing, even if no focus event arrived (e.g. the window was not focused).
      if (!focused) { setFocused(true); ws.startEditing(props.path); }
      onChange(e.target.value);
    },
  };
  return (
    <div className="f">
      <span className={`lab${props.labelHidden ? ' sr-only' : ''}`}>
        <label htmlFor={id}>{props.label}</label>
        {props.infoId && <InfoButton id={props.infoId} />}
      </span>
      {props.help && <small id={helpId}>{props.help}</small>}
      {props.multiline ? <textarea {...common} rows={3} /> : <input type="text" {...common} />}
      {max && focused && draft.length > max * 0.8 && <span className="count" aria-live="polite">{[...draft].length}/{max}</span>}
      {notice && (
        <div className="notice" role="status">
          <span>{t('remote.updated', { name: ws.authorName(notice.by) })}</span>
          <button type="button" className="btn link" onClick={() => setShowTheirs((v) => !v)} aria-expanded={showTheirs}>
            {showTheirs ? t('remote.hide') : t('remote.show')}
          </button>
          {showTheirs && (
            <>
              <p className="theirs">{typeof notice.value === 'string' && notice.value ? notice.value : t('sum.none')}</p>
              <span className="row" style={{ gap: 8 }}>
                <button type="button" className="btn small" onClick={() => { setDraft(typeof notice.value === 'string' ? notice.value : ''); ws.resolveNotice(props.path, true); setShowTheirs(false); setFocused(false); ws.stopEditing(props.path, false); }}>{t('remote.use')}</button>
                <button type="button" className="btn small" onClick={() => { ws.resolveNotice(props.path, false); setShowTheirs(false); setFocused(false); ws.stopEditing(props.path, false); }}>{t('remote.keep')}</button>
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export interface ChoiceOption {
  value: string;
  label: ReactNode;
  /** Accessible text when the visible label is abbreviated (e.g. "E" → "Exists"). */
  srLabel?: string;
  className?: string;
}

/** Single-choice chip group. Choosing the selected option again clears it. `withInfo` adds each option's ⓘ. */
export function ChoiceChips({ path, options, groupLabel, withInfo }: { path: string; options: ChoiceOption[]; groupLabel: string; withInfo?: boolean }) {
  const ws = useWs();
  const current = ws.values[path];
  return (
    <span className="chips" role="group" aria-label={groupLabel}>
      {options.map((o) => (
        <span key={o.value} className="chipwrap">
        <button
          key={o.value}
          type="button"
          className={`chip ${o.className ?? ''}`}
          aria-pressed={current === o.value}
          disabled={ws.readOnly}
          onClick={() => ws.set(path, current === o.value ? null : o.value)}
        >
          {o.label}
          {o.srLabel && <span className="sr-only"> {o.srLabel}</span>}
        </button>
        {withInfo && <InfoButton id={o.value} />}
        </span>
      ))}
    </span>
  );
}

/**
 * Several-at-once choice (e.g. implementation scope: national and regional), stored as one
 * comma-separated value in the options' order.
 */
export function MultiChoiceChips({ path, options, groupLabel }: { path: string; options: ChoiceOption[]; groupLabel: string }) {
  const ws = useWs();
  const current = setValues(ws.values[path]);
  const toggle = (v: string) => {
    const next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v];
    const ordered = options.map((o) => o.value).filter((x) => next.includes(x));
    ws.set(path, ordered.length ? ordered.join(',') : null);
  };
  return (
    <span className="chips" role="group" aria-label={groupLabel}>
      {options.map((o) => (
        <span key={o.value} className="chipwrap">
          <button type="button" className={`chip ${o.className ?? ''}`} aria-pressed={current.includes(o.value)} disabled={ws.readOnly} onClick={() => toggle(o.value)}>
            {o.label}
          </button>
        </span>
      ))}
    </span>
  );
}

/**
 * On/off chip. `rememberOff` stores an explicit false when unticked, so a default that ticks
 * it automatically (e.g. standards marked Exists) does not tick it again.
 */
export function ToggleChip({ path, label, infoId, rememberOff }: { path: string; label: string; infoId?: string; rememberOff?: boolean }) {
  const ws = useWs();
  const on = ws.values[path] === true;
  return (
    <span className="row" style={{ gap: 2 }}>
      <button type="button" className="chip" aria-pressed={on} disabled={ws.readOnly} onClick={() => ws.set(path, on ? (rememberOff ? false : null) : true)}>
        {label}
      </button>
      {infoId && <InfoButton id={infoId} />}
    </span>
  );
}
