import { useEffect, useRef, useState } from 'react';
import { dmy, parseDmy } from '../dates';
import Icon from './Icon';

interface Props {
  /** YYYY-MM-DD, or '' for empty. */
  value: string;
  onChange: (iso: string) => void;
  max?: string;
  required?: boolean;
  /** Shown when empty (default dd/mm/yyyy). */
  placeholder?: string;
  className?: string;
  /** Small, borderless (inline in a list). */
  compact?: boolean;
  'aria-label'?: string;
}

/**
 * A date box that always reads day/month/year, whatever the browser's language.
 * Type it (26/07/2026) or pick it from the calendar button, which opens the browser's own picker.
 */
export default function DateInput({ value, onChange, max, required, placeholder, className = '', compact = false, ...rest }: Props) {
  const [text, setText] = useState(value ? dmy(value) : '');
  const [bad, setBad] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(value ? dmy(value) : '');
    setBad(false);
  }, [value]);

  function commit() {
    if (!text.trim()) {
      setBad(!!required);
      if (!required) onChange('');
      return;
    }
    const iso = parseDmy(text);
    if (!iso || (max && iso > max)) return setBad(true);
    setBad(false);
    if (iso !== value) onChange(iso);
    else setText(dmy(iso));
  }

  const box = compact
    ? 'w-[6.5rem] rounded bg-transparent px-1 text-xs text-muted outline-none hover:bg-raised focus:bg-raised'
    : 'input pr-10';

  return (
    <div className={`relative ${compact ? 'inline-flex items-center' : ''} ${className}`}>
      <input
        className={`${box} tabular-nums ${bad ? (compact ? 'text-red-400' : 'border-red-500/60') : ''}`}
        placeholder={placeholder ?? 'dd/mm/yyyy'}
        inputMode="numeric"
        value={text}
        required={required}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        aria-invalid={bad}
        aria-label={rest['aria-label']}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => picker.current?.showPicker?.()}
        className={compact ? 'ml-0.5 rounded p-0.5 text-muted hover:text-fg' : 'absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-fg'}
        aria-label="Pick from calendar"
        title="Pick from calendar"
      >
        <Icon name="calendar" className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </button>
      {/* The browser's calendar, opened by the button; its own text box is never shown. */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0"
        value={value}
        max={max}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      />
    </div>
  );
}
