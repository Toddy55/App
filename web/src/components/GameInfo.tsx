import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { GAME_HELP } from '../lib/gameHelp';

/** The little ⓘ on a format or game: tap for how to play it and how it's scored. */
export function GameInfo({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const help = GAME_HELP[id];
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  if (!help) return null;
  return (
    <>
      <button
        type="button"
        className="info-dot"
        aria-label={`How ${help.title} works`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        i
      </button>
      {open &&
        createPortal(
          <div className="info-sheet-bg" onClick={() => setOpen(false)}>
            <div className="info-sheet" role="dialog" aria-label={help.title} onClick={(e) => e.stopPropagation()}>
              <div className="info-sheet-head">
                <strong>{help.title}</strong>
                <button type="button" className="icon-btn small" onClick={() => setOpen(false)} aria-label="Close">
                  <X />
                </button>
              </div>
              <p className="muted small">Players: {help.players}</p>
              <h4>How to play</h4>
              <ul>
                {help.play.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <h4>How it's scored</h4>
              <ul>
                {help.scoring.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              {help.example && (
                <p className="info-eg">
                  <strong>Example:</strong> {help.example}
                </p>
              )}
              {help.tip && <p className="small">💡 {help.tip}</p>}
              <button type="button" className="btn primary block" onClick={() => setOpen(false)}>
                Got it
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
