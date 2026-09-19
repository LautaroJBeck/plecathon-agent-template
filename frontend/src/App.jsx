import { useEffect, useState } from 'react';
import { api, defaultRequest, money, prettyDate, useApi } from './api.js';
import { BookingLookup } from './BookingLookup.jsx';
import { ConciergeDock, Launchers, SUGGESTIONS, downscale, imageIn, useConcierge } from './Concierge.jsx';
import { ListingModal, ListingRow, Results } from './Listings.jsx';
import { Icon } from './ui.jsx';

const ROWS = [
  { title: 'Handpicked venues in Philadelphia', subtitle: 'Historic spaces & modern lofts in the city of brotherly love', filters: { city: 'Philadelphia', kind: 'venue', limit: 10 } },
  { title: 'Top spaces in New York', subtitle: 'Lofts, rooftops and galleries across the boroughs', filters: { city: 'New York', kind: 'venue', limit: 10 } },
  { title: 'For your next event in Washington', subtitle: 'Townhouses, jazz lounges & capital halls', filters: { city: 'Washington', kind: 'venue', limit: 10 } },
  { title: 'Spotlight services', subtitle: 'Trusted pros to bring your event together', filters: { kind: 'service', limit: 10 } },
];

const SERVICES = [
  ['caterer', '🍽️', 'Caterer'], ['dj', '🎧', 'DJ'], ['photographer', '📸', 'Photographer'], ['videographer', '🎬', 'Videographer'],
  ['photo booth', '🖼️', 'Photo booth'], ['bartender', '🍸', 'Bartender'], ['cleaning', '🧹', 'Cleaning'], ['entertainer', '🎭', 'Entertainer'],
  ['rentals', '🪑', 'Equipment rental'], ['security', '🛡️', 'Security'], ['transportation', '🚌', 'Chartered bus & shuttle'], ['band', '🎵', 'Musician'],
  ['florist', '💐', 'Florist'], ['decor', '🎈', 'Decorator'], ['planner', '📋', 'Event planner'], ['av', '💡', 'AV & lighting'],
  ['bakery', '🎂', 'Bakery'], ['mc', '🎤', 'MC & host'], ['experience', '🍹', 'Experiences'],
];

const HERO_LISTING = 'foundry-fishtown';

function Logo({ white }) {
  return <img className="logo" src={white ? '/logo-white.svg' : '/logo.svg'} alt="PLEC" />;
}

function Header({ kind, onKind, onSearch, onManage, onAsk }) {
  const [q, setQ] = useState('');
  return (
    <header className="topbar">
      <a href="/" aria-label="PLEC home"><Logo /></a>
      <div className="topbar-center">
        <div className="seg">
          {[['venue', '🏛️', 'Venues'], ['service', '🎧', 'Services']].map(([k, icon, label]) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => onKind(k)}><span>{icon}</span>{label}</button>
          ))}
        </div>
        <form className="searchbar" onSubmit={(e) => { e.preventDefault(); onSearch(q.trim()); }}>
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Try "rooftop" or "Fishtown"' aria-label="Search venues and services" />
          <button className="search-go" aria-label="Search"><Icon name="search" size={16} /></button>
        </form>
      </div>
      <nav className="topbar-right">
        <button className="btn brand-outline" onClick={onAsk}><Icon name="sparkle" size={16} /> <span>Ask Concierge</span></button>
        <button className="navlink" onClick={onManage}>Manage booking</button>
        <a className="navlink hide-sm" href="https://plec-it.com/" target="_blank" rel="noreferrer">Become a Host</a>
        <button className="icon-btn hide-sm" aria-label="Account"><Icon name="user" size={20} /></button>
      </nav>
    </header>
  );
}

/** The Concierge, front and center: type here and the chat dock opens with the answer. */
function Hero({ onAsk, onOpen }) {
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const photos = useApi(() => api.search({ city: 'Philadelphia', kind: 'venue', limit: 10 }), 'hero-photos');
  const live = useApi(async () => {
    const l = await api.listing(HERO_LISTING);
    const req = defaultRequest(l);
    return { l, req, quote: await api.quote({ listingId: l.id, ...req }) };
  }, 'hero-quote');
  const pics = photos.data?.results.slice(0, 3) ?? [];

  async function attach(file) {
    setPhotoError('');
    try { setPhoto(await downscale(file)); } catch { setPhotoError("Couldn't open that image. Try a JPEG or PNG."); }
  }
  function submit(e) {
    e.preventDefault();
    if (!text.trim() && !photo) return;
    onAsk(text, photo);
    setText('');
    setPhoto(null);
  }
  const takeImage = (files, e) => { const f = imageIn(files); if (f) { e.preventDefault(); attach(f); } };

  return (
    <section className="hero">
      <div className="hero-copy">
        <span className="hero-tag"><Icon name="sparkle" size={14} /> New · PLEC Concierge</span>
        <h1>Plan the whole event in <em>one conversation.</em></h1>
        <p>Tell the Concierge what you're celebrating. It searches live availability across Philadelphia, New York and Washington, quotes to the cent, and books it when you say yes.</p>
        <form className="hero-ask" onSubmit={submit} onDragOver={(e) => e.preventDefault()} onDrop={(e) => takeImage(e.dataTransfer?.files, e)}>
          <Icon name="sparkle" size={20} className="hero-ask-icon" />
          {photo && (
            <span className="hero-photo">
              <img src={photo.url} alt="Photo to send" />
              <button type="button" className="attached-x" onClick={() => setPhoto(null)} aria-label="Remove photo"><Icon name="x" size={12} /></button>
            </span>
          )}
          <input value={text} onChange={(e) => setText(e.target.value)} onPaste={(e) => takeImage(e.clipboardData?.files, e)}
            placeholder={photo ? 'Add a few words, or just press Ask' : 'A rooftop birthday for 40 in Philly next month… or paste a photo'} aria-label="Ask the PLEC Concierge" />
          <button className="btn brand" disabled={!text.trim() && !photo}>Ask <Icon name="arrow" size={16} /></button>
        </form>
        {photoError && <p className="error">{photoError}</p>}
        <div className="chips">
          {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => onAsk(s)}>{s}</button>)}
        </div>
      </div>

      <div className="hero-art" aria-hidden={pics.length === 0}>
        {pics.map((l, i) => (
          <button key={l.id} className={`hero-pic p${i}`} onClick={() => onOpen(l.id)} aria-label={l.name}>
            <img src={l.photoUrls[0]} alt="" />
            <span>{l.name}</span>
          </button>
        ))}
        {live.data && (
          <button className="live-quote" onClick={() => onOpen(live.data.l.id)}>
            <span className="live-dot">Live quote</span>
            <strong>{live.data.l.name}</strong>
            <span>{prettyDate(live.data.req.date)} · {live.data.req.startTime}–{live.data.req.endTime} · {live.data.req.guestCount} guests</span>
            <b>{money(live.data.quote.totalCents)} <small>all in</small></b>
          </button>
        )}
      </div>
    </section>
  );
}

function ShuttleBanner({ onBrowse, onAsk }) {
  return (
    <section className="banner dark" style={{ backgroundImage: 'linear-gradient(90deg, rgba(20,20,20,.92) 35%, rgba(20,20,20,.2)), url(https://picsum.photos/seed/plec-shuttle/1600/500)' }}>
      <p className="eyebrow light"><Icon name="bus" size={14} /> Chartered bus & shuttle</p>
      <h2>Need to move a group? Book a shuttle.</h2>
      <p>Door-to-door group transport, priced by the hour, booked alongside your venue.</p>
      <div className="banner-actions">
        <button className="btn brand" onClick={onBrowse}>Explore shuttles <Icon name="arrow" size={16} /></button>
        <button className="btn glass" onClick={() => onAsk('I need a shuttle for 25 guests in Philadelphia. What would it cost?')}>Get a quote from the Concierge</button>
      </div>
    </section>
  );
}

function BookingBar({ onManage }) {
  return (
    <section className="signbar">
      <span className="signbar-icon"><Icon name="ticket" /></span>
      <div>
        <strong>Already booked?</strong>
        <p>Look up any reservation by its BK- reference, check its status, and finish payment.</p>
      </div>
      <button className="btn brand" onClick={onManage}>Manage booking</button>
    </section>
  );
}

function ServicesGrid({ onPick }) {
  return (
    <section className="services">
      <h2>Discover services for your event</h2>
      <p>Browse top service categories and book trusted pros in a few clicks.</p>
      <div className="service-grid">
        {SERVICES.map(([category, icon, label]) => (
          <button key={category} onClick={() => onPick(category, label)}><span>{icon}</span>{label}</button>
        ))}
      </div>
    </section>
  );
}

function HostBanner() {
  return (
    <section className="host" style={{ backgroundImage: 'url(https://picsum.photos/seed/plec-host-river/1600/700)' }}>
      <div className="host-card">
        <h2>List your venue confidently with <Logo /></h2>
        <p>With live support, quick listing signup, and verified guests, hosting on PLEC helps you grow your premier revenue stream: private events!</p>
        <a className="btn brand" href="https://plec-it.com/" target="_blank" rel="noreferrer">List your venue</a>
      </div>
    </section>
  );
}

function Why({ onStart }) {
  const features = [
    ['shield', 'Transparent pricing', 'No hidden fees, ever'],
    ['bolt', 'Instant booking', 'Reserve in minutes'],
    ['clock', '24/7 Concierge', 'An assistant that never sleeps'],
  ];
  const steps = [
    ['Tell it your plan', 'City, date and headcount, in plain words and in any language.'],
    ['Get exact quotes', 'Live availability and pricing to the cent, straight from PLEC. No guesses.'],
    ['Say yes, then pay', 'Nothing is booked until you confirm. You pay through a secure checkout link.'],
  ];
  return (
    <section className="why" style={{ backgroundImage: 'linear-gradient(90deg, rgba(28,16,12,.94) 45%, rgba(28,16,12,.45)), url(https://picsum.photos/seed/plec-celebrate/1600/900)' }}>
      <p className="eyebrow light">Why customers love <Logo white /></p>
      <h2>Book with confidence, celebrate with ease</h2>
      <div className="features">
        {features.map(([icon, title, sub]) => (
          <div key={title}><span className="feature-icon"><Icon name={icon} /></span><div><strong>{title}</strong><span>{sub}</span></div></div>
        ))}
      </div>
      <hr />
      <p className="eyebrow light">How the Concierge works</p>
      <div className="steps">
        {steps.map(([title, text], i) => (
          <div key={title} className="step"><span className="step-n">{i + 1}</span><strong>{title}</strong><p>{text}</p></div>
        ))}
      </div>
      <button className="btn brand" onClick={onStart}><Icon name="sparkle" /> Start planning</button>
    </section>
  );
}

function Footer({ onBrowse, onManage, onAsk }) {
  return (
    <footer className="footer">
      <div className="footer-cols">
        <div><Logo /><p>Making celebrations unforgettable.</p></div>
        <div><strong>Explore</strong>{['Philadelphia', 'New York', 'Washington'].map((c) => <button key={c} onClick={() => onBrowse(c)}>Venues in {c}</button>)}</div>
        <div><strong>Support</strong><button onClick={onManage}>Manage booking</button><button onClick={onAsk}>Ask the Concierge</button></div>
        <div><strong>Hosting</strong><a href="https://plec-it.com/" target="_blank" rel="noreferrer">List your venue</a><a href="https://plec-it.com/" target="_blank" rel="noreferrer">plec-it.com</a></div>
      </div>
      <p className="fine">Plecathon build. Listings and bookings run against PLEC's hackathon sandbox; no real money moves.</p>
    </footer>
  );
}

export default function App() {
  const concierge = useConcierge();
  const [kind, setKind] = useState('venue');
  const [search, setSearch] = useState(null);
  const [listingId, setListingId] = useState(null);
  const [managing, setManaging] = useState(false);

  useEffect(() => { if (search) document.getElementById('browse')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [search]);

  const ask = (text, photo) => { setListingId(null); concierge.send(text, photo); };
  const browse = (patch) => setSearch({ kind, ...patch });
  const onKind = (k) => { setKind(k); setSearch(search ? { ...search, kind: k, category: undefined } : { kind: k }); };

  return (
    <>
      <Header kind={kind} onKind={onKind} onSearch={(q) => browse({ q: q || undefined })} onManage={() => setManaging(true)} onAsk={() => concierge.setOpen(true)} />
      <main>
        <Hero onAsk={ask} onOpen={setListingId} />
        <div id="browse">
          {search
            ? <Results search={search} setSearch={setSearch} onOpen={setListingId} onAsk={ask} />
            : ROWS.map((r) => <ListingRow key={r.title} {...r} onOpen={setListingId} onMore={() => setSearch({ ...r.filters, limit: undefined, title: r.title })} />)}
        </div>
        <ShuttleBanner onBrowse={() => setSearch({ kind: 'service', category: 'transportation', title: 'Chartered bus & shuttle' })} onAsk={ask} />
        <BookingBar onManage={() => setManaging(true)} />
        <ServicesGrid onPick={(category, label) => setSearch({ kind: 'service', category, title: label })} />
        <HostBanner />
        <Why onStart={() => concierge.setOpen(true)} />
        <Footer onBrowse={(city) => setSearch({ kind: 'venue', city, title: `Venues in ${city}` })} onManage={() => setManaging(true)} onAsk={() => concierge.setOpen(true)} />
      </main>
      {listingId && <ListingModal id={listingId} onClose={() => setListingId(null)} onAsk={ask} />}
      {managing && <BookingLookup onClose={() => setManaging(false)} onAsk={ask} />}
      <ConciergeDock concierge={concierge} onOpen={setListingId} />
      <Launchers concierge={concierge} />
    </>
  );
}
