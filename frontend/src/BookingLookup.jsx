import { useState } from 'react';
import { api, money, prettyDate } from './api.js';
import { Icon, Modal } from './ui.jsx';

// The wording the hidden suite checks for: unpaid is not confirmed, requested is not approved.
const STATUS = {
  pending_payment: ['warn', 'Awaiting payment', 'The slot is held. It confirms once the guest pays the checkout link.'],
  requested: ['warn', 'Requested', 'The host still has to approve. Nothing to pay yet.'],
  confirmed: ['ok', 'Confirmed', 'Paid or approved. You are all set.'],
  cancelled: ['bad', 'Cancelled', 'This booking was cancelled and its slot released.'],
};

/** Look a booking up by reference (read-only); changes go through the Concierge, which confirms first. */
export function BookingLookup({ onClose, onAsk }) {
  const [ref, setRef] = useState('');
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function lookup(e) {
    e.preventDefault();
    setBusy(true); setError(null); setBooking(null);
    try { setBooking(await api.booking(ref)); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const b = booking;
  const [tone, label, meaning] = b ? STATUS[b.status] ?? ['', b.status, ''] : [];
  const ask = (text) => { onClose(); onAsk(text); };

  return (
    <Modal label="Manage a booking" onClose={onClose}>
      <div className="pad">
        <p className="eyebrow">Manage booking</p>
        <h2>Check a reservation</h2>
        <p className="muted">Enter the reference from your confirmation, like BK-1001.</p>
        <form className="lookup" onSubmit={lookup}>
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="BK-1001" aria-label="Booking reference" autoFocus />
          <button className="btn dark" disabled={!/^bk-\d+$/i.test(ref.trim()) || busy}>{busy ? 'Looking…' : 'Look up'}</button>
        </form>
        {error && <p className="error">{error}</p>}
        {b && (
          <div className="booking">
            <div className="booking-head">
              <div><strong>{b.ref}</strong><span>{b.listingName}</span></div>
              <span className={`status ${tone}`}>{label}</span>
            </div>
            <p className="muted">{meaning}</p>
            <dl className="facts">
              <div><dt>When</dt><dd>{prettyDate(b.date)}, {b.startTime} to {b.endTime}</dd></div>
              <div><dt>Guests</dt><dd>{b.guestCount}</dd></div>
              <div><dt>Guest</dt><dd>{b.guestName}</dd></div>
              <div><dt>Total</dt><dd>{money(b.totalCents)}</dd></div>
              {b.refundCents != null && <div><dt>Refund</dt><dd>{money(b.refundCents)}</dd></div>}
            </dl>
            {b.status === 'pending_payment' && b.payment?.url && (
              <a className="btn brand wide" href={b.payment.url} target="_blank" rel="noreferrer">
                <Icon name="shield" /> Complete payment ({money(b.payment.amountCents)})
              </a>
            )}
            {b.status !== 'cancelled' && (
              <div className="booking-actions">
                <button className="btn ghost" onClick={() => ask(`I'd like to reschedule booking ${b.ref}.`)}>Reschedule with the Concierge</button>
                <button className="btn ghost" onClick={() => ask(`I'd like to cancel booking ${b.ref}.`)}>Cancel with the Concierge</button>
                {b.status === 'pending_payment' && (
                  <button className="btn ghost" onClick={() => ask(`Can you send me a new payment link for ${b.ref}?`)}>New payment link</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
