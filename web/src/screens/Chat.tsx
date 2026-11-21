import { useEffect, useRef, useState } from 'react';
import { Send, Smile, Zap } from 'lucide-react';
import { store } from '../lib/storage';
import { liveAvailable } from '../live/config';
import { EMOJIS, markSeen, SLEDGES, type ChatMsg } from '../live/chat';
import { Header, type Go } from '../components/ui';

/** The comp's banter: everyone in the comp, live. */
export function Chat({ go, compId }: { go: Go; compId: string }) {
  const comp = store.comp(compId);
  const me = store.settings().me;
  const [msgs, setMsgs] = useState<ChatMsg[] | null>(null);
  const [text, setText] = useState('');
  const [panel, setPanel] = useState<'none' | 'emoji' | 'sledge'>('none');
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!liveAvailable()) return;
    let unsub: (() => void) | undefined;
    let stop = false;
    import('../live/chat')
      .then(({ watchChat }) => watchChat(compId, (m) => !stop && setMsgs(m)))
      .then((u) => (stop ? u() : (unsub = u)))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      stop = true;
      unsub?.();
    };
  }, [compId]);

  useEffect(() => {
    if (!msgs?.length) return;
    markSeen(compId, msgs[msgs.length - 1].id);
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs, compId]);

  /** fromBox: sending what's typed (clear the box); otherwise a sledge (leave the box alone). */
  const send = async (t: string, fromBox = false) => {
    if (!t.trim() || sending) return;
    setSending(true);
    setErr(null);
    try {
      const { sendChat } = await import('../live/chat');
      await sendChat(compId, me.name, t);
      if (fromBox) setText((cur) => (cur === t ? '' : cur));
      setPanel('none');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  if (!comp) {
    return (
      <div className="screen">
        <Header title="Banter" onBack={() => go({ name: 'leaderboards' })} />
        <p className="content">Comp not found.</p>
      </div>
    );
  }

  return (
    <div className="screen chat-screen">
      <Header title={`${comp.name} · Banter`} onBack={() => go({ name: 'comp', id: compId })} />
      <div className="chat-list">
        {!liveAvailable() && <p className="muted center">Chat needs live sync, which isn't set up in this copy of the app.</p>}
        {liveAvailable() && msgs === null && !err && <p className="muted center">Loading the banter…</p>}
        {msgs?.length === 0 && (
          <div className="chat-empty">
            <div className="big-emoji">⛳🍻</div>
            <p>No banter yet. Get it started: tap ⚡ for a sledge.</p>
          </div>
        )}
        {msgs?.map((m, i) => {
          const prev = msgs[i - 1];
          const newDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
          const showName = !m.mine && (!prev || prev.name !== m.name || newDay || prev.auto);
          return (
            <div key={m.id}>
              {newDay && <div className="chat-day">{dayLabel(m.at)}</div>}
              {m.auto ? (
                <div className="chat-auto">{m.text}</div>
              ) : (
                <div className={`chat-msg ${m.mine ? 'mine' : ''} ${onlyEmoji(m.text) ? 'emoji-only' : ''}`}>
                  {showName && <div className="chat-name">{m.name}</div>}
                  <div className="chat-bubble">
                    {m.text}
                    <span className="chat-time">{new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div ref={end} />
      </div>

      <div className="chat-compose">
        {panel === 'emoji' && (
          <div className="chat-emojis">
            {EMOJIS.map((e) => (
              <button key={e} onClick={() => { setText((t) => t + e); input.current?.focus(); }} aria-label={e}>
                {e}
              </button>
            ))}
          </div>
        )}
        {panel === 'sledge' && (
          <div className="chat-sledges">
            {SLEDGES.map((s) => (
              <button key={s} className="chip" disabled={sending} onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {err && <p className="error small">{err}</p>}
        <form
          className="chat-bar"
          onSubmit={(e) => {
            e.preventDefault();
            send(text, true);
          }}
        >
          <button type="button" className={`icon-btn ${panel === 'sledge' ? 'on' : ''}`} onClick={() => setPanel(panel === 'sledge' ? 'none' : 'sledge')} aria-label="Sledges">
            <Zap />
          </button>
          <button type="button" className={`icon-btn ${panel === 'emoji' ? 'on' : ''}`} onClick={() => setPanel(panel === 'emoji' ? 'none' : 'emoji')} aria-label="Emojis">
            <Smile />
          </button>
          <input ref={input} className="grow" placeholder={`Stir the pot, ${me.name}…`} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
          <button className="icon-btn send" disabled={!text.trim() || sending || !liveAvailable()} aria-label="Send">
            <Send />
          </button>
        </form>
      </div>
    </div>
  );
}

function onlyEmoji(t: string) {
  return t.length <= 12 && !/[\p{L}\p{N}]/u.test(t);
}

function dayLabel(at: number) {
  const d = new Date(at);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}
