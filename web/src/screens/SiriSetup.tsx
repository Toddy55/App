import { useEffect, useState } from 'react';
import { Copy, Mic } from 'lucide-react';
import { Card, Header, type Go } from '../components/ui';
import { liveAvailable } from '../live/config';
import { markUrl, myMarkKey } from '../live/siriChannel';
import { pushIdTime } from '../lib/siriMarks';

/** Set up "Hey Siri, mark shot": a two-step iPhone Shortcut that posts where you're standing. */
export function SiriSetup({ go }: { go: Go }) {
  const [url] = useState(() => markUrl());
  const [copied, setCopied] = useState(false);
  const [last, setLast] = useState<number | null>(null);
  const [test, setTest] = useState<'idle' | 'sending' | 'ok' | 'off' | 'fail'>('idle');

  // Show when the last mark arrived, so you can see your Shortcut working
  useEffect(() => {
    if (!liveAvailable() || !url) return;
    let unsub: (() => void) | undefined;
    let stop = false;
    import('../live/live')
      .then(({ watchMarks }) =>
        watchMarks(myMarkKey(), (raw) => {
          const ts = Object.keys(raw ?? {}).map((k) => pushIdTime(k) ?? 0);
          setLast(ts.length ? Math.max(...ts) : null);
        }),
      )
      .then((u) => (stop ? u() : (unsub = u)))
      .catch(() => undefined);
    return () => {
      stop = true;
      unsub?.();
    };
  }, [url]);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      prompt('Copy this web address:', url);
    }
  };

  // Same as what the Shortcut does (a spot in the ocean, so it never lands on a hole)
  const sendTest = async () => {
    if (!url) return;
    setTest('sending');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: 0, lon: 0 }) });
      setTest(res.ok ? 'ok' : res.status === 401 || res.status === 403 ? 'off' : 'fail');
    } catch {
      setTest('fail');
    }
  };

  const isIphone = /iPhone|iPad|iPod/.test(navigator.userAgent);

  return (
    <div className="screen">
      <Header title="Hey Siri, mark shot" onBack={() => history.back()} />
      <div className="content">
        <Card className="join-hero">
          <div className="eyebrow">
            <Mic /> Hands-free shot tracking
          </div>
          <h2>Phone stays in your pocket</h2>
          <p className="small">
            Before each shot, say <strong>"Hey Siri, mark shot"</strong>. Siri asks <strong>"Which club?"</strong>, you say <strong>"seven iron"</strong> (or "driver", "sand wedge", "56"…), and it saves where you're standing with that club. Next time you open the round, the shots drop into the right holes on the map and into your club distances.
          </p>
          <p className="muted small">Works with AirPods and Apple Watch too. Set it up once, about 2 minutes.</p>
        </Card>

        {!liveAvailable() || !url ? (
          <p className="warn small">Live sync isn't set up in this copy of the app, so Siri marks can't be sent.</p>
        ) : (
          <>
            <Card title="1. Copy your private address">
              <p className="small">This is where Siri sends your spot. It's unique to this phone, so keep it to yourself.</p>
              <code className="siri-url">{url}</code>
              <button className="btn primary block" onClick={copy}>
                <Copy /> {copied ? 'Copied ✓' : 'Copy address'}
              </button>
            </Card>

            <Card title="2. Make the Shortcut (iPhone)">
              <ol className="steps">
                <li>
                  Open the <strong>Shortcuts</strong> app and tap <strong>+</strong>.
                </li>
                <li>
                  Tap <strong>Add Action</strong>, search <strong>Get Current Location</strong> and tap it.
                </li>
                <li>
                  Search <strong>Ask for Input</strong> and tap it. Tap <strong>Prompt</strong> and type <strong>Which club?</strong>
                </li>
                <li>
                  Search <strong>Get Contents of URL</strong> and tap it. Tap the blue <strong>URL</strong> and paste your address.
                </li>
                <li>
                  Tap the <strong>›</strong> arrow on that action. Set <strong>Method</strong> to <strong>POST</strong> and <strong>Request Body</strong> to <strong>JSON</strong>.
                </li>
                <li>
                  Tap <strong>Add new field → Number</strong>. Key: <code>lat</code>. For the value, tap <strong>Select Variable</strong>, tap <strong>Current Location</strong>, then tap it again and pick <strong>Latitude</strong>.
                </li>
                <li>
                  Add another <strong>Number</strong> field. Key: <code>lon</code>, value <strong>Current Location → Longitude</strong>.
                </li>
                <li>
                  Add a <strong>Text</strong> field. Key: <code>club</code>, value <strong>Select Variable → Provided Input</strong>.
                </li>
                <li>
                  Tap the name at the top, choose <strong>Rename</strong> and call it <strong>Mark shot</strong>. Tap <strong>Done</strong>.
                </li>
                <li>
                  Say <strong>"Hey Siri, mark shot"</strong>. Siri asks "Which club?": say <strong>"seven iron"</strong>. The first time, Siri also asks to use your location and to send to the web address: choose <strong>Always Allow</strong>. Don't want the club question? Leave out the Ask for Input step and the club field, and pick clubs in the app later.
                </li>
              </ol>
              {!isIphone && <p className="muted small">On Android, Google Assistant can't send your spot like this yet, so use the "Mark shot from here" button instead.</p>}
            </Card>

            <Card title="3. Check it's working">
              <p className="small">
                {last ? (
                  <>
                    ✅ Last mark arrived <strong>{new Date(last).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</strong>.
                  </>
                ) : (
                  'No marks yet. Say "Hey Siri, mark shot" and watch this update.'
                )}
              </p>
              <button className="btn block" disabled={test === 'sending'} onClick={sendTest}>
                {test === 'sending' ? 'Sending…' : 'Send a test mark from this phone'}
              </button>
              {test === 'ok' && <p className="ok small">Test went through. The app's side is ready, so it's down to the Shortcut.</p>}
              {test === 'off' && <p className="warn small">The server isn't accepting Siri marks yet. The app owner needs to switch them on (a one-off rule change in Firebase).</p>}
              {test === 'fail' && <p className="warn small">Couldn't reach the server. Check your signal and try again.</p>}
            </Card>

            <button className="btn block" onClick={() => go({ name: 'home' })}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
