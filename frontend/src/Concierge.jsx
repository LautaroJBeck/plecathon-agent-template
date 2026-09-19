import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

// Same keys as public/chat.html, so both pages share one conversation.
const KEY_SESSION = 'plec.sessionId';
const KEY_LOG = 'plec.log';
const TURN_TIMEOUT_MS = 45_000;

export const SUGGESTIONS = [
  'I need a rooftop in Philadelphia for 40 people',
  'Find me a DJ and a caterer for 120 guests in Philadelphia',
  'How much is The Foundry at Fishtown for 40 guests next Saturday, 6 to 10pm?',
  '¿Tienen salones en Washington para 30 personas?',
];

// localStorage can throw (private windows, blocked storage); the chat must work without it.
const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* ignore */ } };
const readLog = () => { try { return JSON.parse(read(KEY_LOG) || '[]'); } catch { return []; } };

/** The conversation with the agent: entries are { role: 'user'|'agent'|'note', part, failed?, retryText? }. */
export function useConcierge() {
  const [sessionId, setSessionId] = useState(() => read(KEY_SESSION) || crypto.randomUUID());
  const [entries, setEntries] = useState(readLog);
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);
  const busy = useRef(false);

  useEffect(() => write(KEY_SESSION, sessionId), [sessionId]);
  useEffect(() => write(KEY_LOG, JSON.stringify(entries.slice(-200))), [entries]);

  async function send(raw) {
    const text = (raw ?? '').trim();
    setOpen(true);
    if (!text || busy.current) return;
    busy.current = true;
    setSending(true);
    const mine = { role: 'user', part: { kind: 'text', text } };
    setEntries((all) => [...all.filter((e) => !(e.role === 'note' && e.retryText === text)), mine]);
    try {
      const res = await fetch('/agent/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, text }),
        signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
      const parts = Array.isArray(body.parts) ? body.parts : [];
      if (parts.length === 0) throw new Error('The agent returned no parts');
      setEntries((all) => [...all, ...parts.map((part) => ({ role: 'agent', part }))]);
    } catch (err) {
      const why = err?.name === 'TimeoutError' ? `No reply in ${TURN_TIMEOUT_MS / 1000}s` : err?.message || String(err);
      setEntries((all) => [
        ...all.map((e) => (e === mine ? { ...e, failed: true } : e)),
        { role: 'note', part: { kind: 'text', text: `Not delivered: ${why}.` }, retryText: text },
      ]);
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  async function reset() {
    // The reset route is optional in the contract; a fresh sessionId is a fresh conversation regardless.
    fetch('/agent/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }).catch(() => {});
    setSessionId(crypto.randomUUID());
    setEntries([]);
  }

  return { entries, sending, open, setOpen, send, reset };
}

// Only http(s) and mailto links from the agent are rendered as links: its text can be steered by host-written data.
const safe = (url) => (/^(https?:\/\/|mailto:)/i.test(url ?? '') ? url : undefined);
const external = (url) => ({ href: safe(url), target: '_blank', rel: 'noreferrer' });

function Part({ part }) {
  switch (part?.kind) {
    case 'text':
      return <div className="bubble">{part.text}</div>;
    case 'card': {
      const Tag = safe(part.url) ? 'a' : 'div';
      const photo = Array.isArray(part.photoUrls) ? part.photoUrls[0] : null;
      return (
        <Tag className="chat-card" {...(safe(part.url) ? external(part.url) : {})}>
          {photo && <img src={photo} alt={part.title} loading="lazy" />}
          <div className="chat-card-body">
            <strong>{part.title}</strong>
            {part.subtitle && <span>{part.subtitle}</span>}
            {safe(part.url) && <em>View details <Icon name="out" size={13} /></em>}
          </div>
        </Tag>
      );
    }
    case 'link': {
      const pay = /\/pay\//.test(part.url ?? '');
      return (
        <a className={`pill ${pay ? 'pay' : ''}`} {...external(part.url)}>
          {pay && <Icon name="shield" size={15} />} {part.label} <Icon name="out" size={14} />
        </a>
      );
    }
    case 'image':
      return (
        <figure className="chat-photo">
          <img src={part.url} alt={part.caption || 'Photo from the assistant'} loading="lazy" />
          {part.caption && <figcaption>{part.caption}</figcaption>}
        </figure>
      );
    default:
      return <div className="bubble muted">[{part?.kind ?? 'unknown'} part]</div>;
  }
}

function Avatar() {
  return (
    <span className="avatar">
      <img src="/emblem.svg" alt="" />
      <i className="online" aria-hidden="true" />
    </span>
  );
}

export function ConciergeDock({ concierge: c }) {
  const [draft, setDraft] = useState('');
  const log = useRef(null);
  const input = useRef(null);

  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); }, [c.entries, c.sending, c.open]);
  useEffect(() => { if (c.open) input.current?.focus(); }, [c.open]);
  useEffect(() => {
    if (!c.open) return;
    const onKey = (e) => e.key === 'Escape' && !document.querySelector('.overlay') && c.setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [c.open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!c.open) return null;

  function submit(e) {
    e?.preventDefault();
    if (!draft.trim() || c.sending) return;
    c.send(draft);
    setDraft('');
  }

  return (
    <aside className="dock" aria-label="Chat with the PLEC assistant">
      <header className="dock-head">
        <Avatar />
        <div className="dock-title">
          <strong>PLEC Concierge</strong>
          <span>AI booking assistant, replies in seconds</span>
        </div>
        <button className="icon-btn" onClick={c.reset} title="Start over" aria-label="Start a new conversation"><Icon name="refresh" /></button>
        <button className="icon-btn" onClick={() => c.setOpen(false)} aria-label="Minimize chat"><Icon name="minus" /></button>
      </header>

      <div className="dock-log" ref={log} aria-live="polite">
        <div className="row agent">
          <div className="bubble">
            Hi! I'm the PLEC assistant. I can find venues, DJs, buses and more, check availability, and price things out. What are you planning?
          </div>
        </div>
        {c.entries.length === 0 && (
          <div className="chips welcome">
            {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => c.send(s)}>{s}</button>)}
          </div>
        )}
        {c.entries.map((entry, i) =>
          entry.role === 'note' ? (
            <div key={i} className="note">
              {entry.part.text} {entry.retryText && <button onClick={() => c.send(entry.retryText)}>Retry</button>}
            </div>
          ) : (
            <div key={i} className={`row ${entry.role} ${entry.failed ? 'failed' : ''}`}><Part part={entry.part} /></div>
          ),
        )}
        {c.sending && (
          <div className="row agent">
            <div className="typing" role="status" aria-label="The assistant is typing"><i /><i /><i /></div>
          </div>
        )}
      </div>

      <form className="composer" onSubmit={submit}>
        <textarea
          ref={input}
          rows={1}
          value={draft}
          placeholder="Ask about venues, DJs, buses..."
          aria-label="Message the PLEC assistant"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && submit(e)}
        />
        <button className="send" disabled={!draft.trim() || c.sending} aria-label="Send message"><Icon name="up" /></button>
      </form>
      <p className="fine">AI assistant. It can make mistakes. Nothing is booked until you say yes.</p>
    </aside>
  );
}

/** The two ways in when the dock is closed: the "Ask PLEC" pill and the promo card, as on plec-it.com. */
export function Launchers({ concierge: c }) {
  const [promo, setPromo] = useState(true);
  if (c.open) return null;
  return (
    <>
      <button className="ask-pill" onClick={() => c.setOpen(true)} aria-label="Open PLEC Concierge">
        <span className="ask-dot"><Icon name="chat" size={18} /></span> Ask PLEC
        {c.entries.length > 0 && <span className="ask-count">{c.entries.filter((e) => e.role === 'agent').length}</span>}
      </button>
      {promo && (
        <div className="promo" role="complementary">
          <button className="promo-x" onClick={() => setPromo(false)} aria-label="Collapse concierge card"><Icon name="x" size={16} /></button>
          <span className="promo-tag"><Icon name="sparkle" size={13} /> PLEC Concierge</span>
          <strong>Need help planning your event?</strong>
          <p>Tell our AI concierge what you're celebrating. It finds the venue, prices it to the cent, and books it when you say yes.</p>
          <button className="btn white" onClick={() => c.setOpen(true)}>Plan my event</button>
        </div>
      )}
    </>
  );
}
