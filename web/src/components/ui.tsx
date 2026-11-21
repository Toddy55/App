import type { Format } from '../types';
import type { ReactNode } from 'react';
import { ChevronLeft, Flag } from 'lucide-react';

export type Route =
  | { name: 'home' }
  | { name: 'courses'; pick?: boolean }
  | { name: 'course'; id: string }
  | { name: 'setup'; courseId?: string; liveCode?: string; format?: Format; holes?: number[]; compIds?: string[] }
  | { name: 'play'; roundId: string }
  | { name: 'summary'; roundId: string }
  | { name: 'stats' }
  | { name: 'settings' }
  | { name: 'friends' }
  | { name: 'friend'; id: string }
  | { name: 'leaderboards' }
  | { name: 'comp'; id: string }
  | { name: 'compEdit'; id?: string }
  | { name: 'import'; data: string }
  | { name: 'joinComp'; data: string }
  | { name: 'live'; code: string }
  | { name: 'tracer' }
  | { name: 'livetracer' };

export type Go = (r: Route) => void;

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 20,
  label,
  big,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
  big?: boolean;
}) {
  const v = value ?? 0;
  return (
    <div className={`stepper ${big ? 'big' : ''}`}>
      {label && <span className="stepper-label">{label}</span>}
      <button type="button" aria-label={`decrease ${label ?? ''}`} onClick={() => onChange(Math.max(min, v - 1))}>
        −
      </button>
      <span className={`stepper-value ${value == null ? 'unset' : ''}`}>{value ?? '–'}</span>
      <button type="button" aria-label={`increase ${label ?? ''}`} onClick={() => onChange(Math.min(max, v + 1))}>
        +
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="topbar">
      {onBack ? (
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <ChevronLeft />
        </button>
      ) : (
        <span className="logo-mark" aria-hidden>
          <Flag />
        </span>
      )}
      <h1>{title}</h1>
      <div className="topbar-right">{right}</div>
    </header>
  );
}

export function Card({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && <h2 className="card-title">{title}</h2>}
      {children}
    </section>
  );
}

export function scoreClass(gross: number | undefined, par: number) {
  if (gross == null) return '';
  const d = gross - par;
  if (d <= -2) return 'eagle';
  if (d === -1) return 'birdie';
  if (d === 0) return 'par';
  if (d === 1) return 'bogey';
  return 'double';
}
