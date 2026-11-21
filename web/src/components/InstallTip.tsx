import { useState } from 'react';

/** Shows how to add the app to the home screen, until it's installed or dismissed. */
export function InstallTip() {
  const nav = navigator as Navigator & { standalone?: boolean };
  const installed = nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('gtg.installTipHidden') === '1';
    } catch {
      return false;
    }
  });
  if (installed || hidden) return null;
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem('gtg.installTipHidden', '1');
    } catch {
      /* ignore */
    }
  };
  return (
    <section className="card install-tip">
      <div className="row between">
        <strong>📲 Put Fairway Coach on your home screen</strong>
        <button className="icon-btn small" aria-label="Hide" onClick={hide}>
          ✕
        </button>
      </div>
      {ios ? (
        <ol>
          <li>Open this page in <strong>Safari</strong></li>
          <li>Tap the <strong>Share</strong> button (square with an arrow)</li>
          <li>Scroll down, tap <strong>Add to Home Screen</strong>, then <strong>Add</strong></li>
        </ol>
      ) : (
        <ol>
          <li>Open this page in <strong>Chrome</strong></li>
          <li>Tap the <strong>⋮</strong> menu</li>
          <li>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>)</li>
        </ol>
      )}
      <p className="muted small">It then opens full screen like any other app and works with no reception on the course.</p>
    </section>
  );
}
