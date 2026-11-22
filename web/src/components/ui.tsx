import type { Format } from '../types';
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

export type Route =
  | { name: 'home' }
  | { name: 'courses'; pick?: boolean }
  | { name: 'course'; id: string }
  | { name: 'siri' }
  | { name: 'move'; data: string }
  | { name: 'syncJoin'; key: string }
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
  | { name: 'joinComp'; data: string; to?: string }
  | { name: 'chat'; compId: string }
  | { name: 'friendJoin'; data: string; to?: string }
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

/** The Shotmate mark: a shot tracer arcing up to the ball. */
export function ShotmateMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="8 8 50 46" fill="none">
      <path d="M14 49 C 18 22, 34 12, 47 17" stroke="#c6f432" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="48.5" cy="17.8" r="6" fill="#ffffff" />
      <circle cx="14" cy="49" r="3" fill="#c6f432" />
    </svg>
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
          <ShotmateMark />
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
