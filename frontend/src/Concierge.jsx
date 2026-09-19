import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

// Same keys as public/chat.html, so both pages share one conversation.
const KEY_SESSION = 'plec.sessionId';
const KEY_LOG = 'plec.log';
const TURN_TIMEOUT_MS = 45_000;
const PHOTO_TEXT = "Here's the vibe I'm going for.";
const PHOTO_MAX_SIDE = 1024;

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
// The user's own photos stay out of the saved log: they would blow the storage quota, and images are never kept.
const isPhoto = (e) => e.role === 'user' && e.part.kind === 'image';

/** The first image file in a FileList (paste or drop), if any. */
export const imageIn = (items) => [...(items ?? [])].find((f) => f.type?.startsWith('image/'));

/** Any image file -> { mediaType: 'image/jpeg', data } at most 1024px on its longest side, JPEG quality 0.8. */
export async function downscale(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs would turn black as JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.8);
  return { mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1), url };
}

/** The conversation with the agent: entries are { role: 'user'|'agent'|'note', part, failed?, retryText? }. */
export function useConcierge() {
  const [sessionId, setSessionId] = useState(() => read(KEY_SESSION) || crypto.randomUUID());
  const [entries, setEntries] = useState(readLog);
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);
  const [locationOn, setLocationOn] = useState(null); // null until the browser answers
  const busy = useRef(false);
  const where = useRef(null);

  // Asked once, when the chat first opens. Kept in memory only and sent with every message.
  useEffect(() => {
    if (!open || locationOn !== null) return;
    if (!navigator.geolocation) return setLocationOn(false);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { where.current = { lat: coords.latitude, lng: coords.longitude }; setLocationOn(true); },
      () => setLocationOn(false),
      { timeout: 8000, maximumAge: 10 * 60 * 1000 },
    );
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => write(KEY_SESSION, sessionId), [sessionId]);
  useEffect(() => write(KEY_LOG, JSON.stringify(entries.filter((e) => !isPhoto(e)).slice(-200))), [entries]);

  /** photo, when given, is downscale()'s result; it rides along with this one message only. */
  async function send(raw, photo) {
    const text = (raw ?? '').trim() || (photo ? PHOTO_TEXT : '');
    setOpen(true);
    if (!text || busy.current) return;
    busy.current = true;
    setSending(true);
    const mine = { role: 'user', part: { kind: 'text', text } };
    const shown = photo ? [{ role: 'user', part: { kind: 'image', url: photo.url } }, mine] : [mine];
    setEntries((all) => [...all.filter((e) => !(e.role === 'note' && e.retryText === text)), ...shown]);
    try {
      const image = photo && { mediaType: photo.mediaType, data: photo.data };
      const res = await fetch('/agent/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, text, ...(image && { image }), ...(where.current && { location: where.current }) }),
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

  return { entries, sending, open, setOpen, send, reset, locationOn };
}

// Only http(s), mailto and our own /api/ links (the .ics download) are rendered: agent text can be steered by host-written data.
const safe = (url) => (/^(https?:\/\/|mailto:|\/api\/)/i.test(url ?? '') ? url : undefined);
const external = (url) => ({ href: safe(url), target: '_blank', rel: 'noreferrer' });

/** onOpen(listingId) opens the full listing page; cards without a listingId fall back to their map link. */
function Part({ part, onOpen }) {
  switch (part?.kind) {
    case 'text':
      return <div className="bubble">{part.text}</div>;
    case 'card': {
      const opens = onOpen && typeof part.listingId === 'string';
      const Tag = opens ? 'button' : safe(part.url) ? 'a' : 'div';
      const props = opens ? { type: 'button', onClick: () => onOpen(part.listingId) } : safe(part.url) ? external(part.url) : {};
      const photo = Array.isArray(part.photoUrls) ? part.photoUrls[0] : null;
      return (
        <Tag className="chat-card" {...props}>
          {photo && <img src={photo} alt={part.title} loading="lazy" />}
          <div className="chat-card-body">
            <strong>{part.title}</strong>
            {part.subtitle && <span>{part.subtitle}</span>}
            {opens ? <em>View details <Icon name="arrow" size={13} /></em>
              : safe(part.url) && <em>View details <Icon name="out" size={13} /></em>}
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
          <img src={part.url} alt={part.caption || 'Photo'} loading="lazy" />
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

export function ConciergeDock({ concierge: c, onOpen }) {
  const [draft, setDraft] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const log = useRef(null);
  const input = useRef(null);
  const picker = useRef(null);

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
    if ((!draft.trim() && !photo) || c.sending) return;
    c.send(draft, photo);
    setDraft('');
    setPhoto(null);
  }

  async function attach(file) {
    if (!file?.type?.startsWith('image/')) return;
    setPhotoError('');
    try {
      setPhoto(await downscale(file));
    } catch {
      setPhotoError("Couldn't open that image. Try a JPEG or PNG.");
    }
  }

  return (
    <aside
      className="dock"
      aria-label="Chat with the PLEC assistant"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { const f = imageIn(e.dataTransfer?.files); if (f) { e.preventDefault(); attach(f); } }}
    >
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
            <div key={i} className={`row ${entry.role} ${entry.failed ? 'failed' : ''}`}><Part part={entry.part} onOpen={onOpen} /></div>
          ),
        )}
        {c.sending && (
          <div className="row agent">
            <div className="typing" role="status" aria-label="The assistant is typing"><i /><i /><i /></div>
          </div>
        )}
      </div>

      {(photo || photoError) && (
        <div className="attached">
          {photo && <img src={photo.url} alt="Photo to send" />}
          {photo && <button type="button" className="attached-x" onClick={() => setPhoto(null)} aria-label="Remove photo"><Icon name="x" size={14} /></button>}
          {photoError && <span>{photoError}</span>}
        </div>
      )}
      <form className="composer" onSubmit={submit}>
        <input ref={picker} type="file" accept="image/*" hidden onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="attach" onClick={() => picker.current?.click()} aria-label="Attach a photo of the vibe you want" title="Attach a photo">
          <Icon name="image" />
        </button>
        <textarea
          ref={input}
          rows={1}
          value={draft}
          placeholder="Ask about venues, DJs, buses..."
          aria-label="Message the PLEC assistant"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && submit(e)}
          onPaste={(e) => { const f = imageIn(e.clipboardData?.files); if (f) { e.preventDefault(); attach(f); } }}
        />
        <button className="send" disabled={(!draft.trim() && !photo) || c.sending} aria-label="Send message"><Icon name="up" /></button>
      </form>
      <p className="fine">
        {c.locationOn !== null && <>{c.locationOn ? '📍 Using your location' : 'Location off'} · </>}
        AI assistant. It can make mistakes. Nothing is booked until you say yes.
      </p>
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
