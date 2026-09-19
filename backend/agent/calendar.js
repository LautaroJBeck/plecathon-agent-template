/**
 * "Add to calendar" for a booking (PRD B, B10): a Google Calendar template URL
 * and an RFC 5545 .ics file, built only from the sandbox booking object and its
 * listing, so the model never supplies the date or times. Every catalogue city
 * is on Eastern time, so the zone is fixed.
 */

const TZ = 'America/New_York';
const LIVE = new Set(['pending_payment', 'requested', 'confirmed']);
const TENTATIVE_NOTE = { pending_payment: '(tentative until paid)', requested: '(tentative until the host approves)' };
const REF = /^BK-\d+$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

// Standard US Eastern rules since 2007; clients use it to anchor the TZID times.
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', `TZID:${TZ}`,
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT',
  'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST',
  'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

/** True when the booking is live and has everything an event needs. */
export function isCalendarable(booking) {
  return Boolean(booking && REF.test(booking.ref ?? '') && LIVE.has(booking.status)
    && DATE.test(booking.date ?? '') && TIME.test(booking.startTime ?? '') && TIME.test(booking.endTime ?? ''));
}

/** Link parts for a booking, or [] when it is cancelled or incomplete. Labels stay neutral: the checks read them. */
export function calendarLinks(booking, listing) {
  if (!isCalendarable(booking)) return [];
  return [
    { kind: 'link', label: 'Add to Google Calendar', url: googleCalendarUrl(booking, listing) },
    { kind: 'link', label: 'Download calendar file (.ics)', url: `/api/bookings/${booking.ref}/calendar.ics` },
  ];
}

/** https://calendar.google.com template URL with local times and ctz, so Google applies Eastern time. */
export function googleCalendarUrl(booking, listing) {
  const e = event(booking, listing);
  const params = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${e.start}/${e.end}`, ctz: TZ, details: e.details });
  if (e.location) params.set('location', e.location);
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** One-event VCALENDAR; UID is the ref, so re-importing after a reschedule updates the event. */
export function toIcs(booking, listing, now = new Date()) {
  const e = event(booking, listing);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PLEC Concierge//Booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...VTIMEZONE,
    'BEGIN:VEVENT',
    `UID:${booking.ref}@plec`,
    `DTSTAMP:${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART;TZID=${TZ}:${e.start}`,
    `DTEND;TZID=${TZ}:${e.end}`,
    `SUMMARY:${escapeText(e.title)}`,
    `DESCRIPTION:${escapeText(e.details)}`,
    ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
    `STATUS:${booking.status === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

function event(booking, listing) {
  const stamp = (time) => `${booking.date.replace(/-/g, '')}T${time.replace(':', '')}00`;
  const name = booking.listingName || listing?.name || 'PLEC booking';
  const title = [`${name} (${booking.ref})`, TENTATIVE_NOTE[booking.status]].filter(Boolean).join(' ');
  const guests = booking.guestCount ? `${booking.guestCount} guests. ` : '';
  return {
    title,
    start: stamp(booking.startTime),
    end: stamp(booking.endTime),
    details: `${guests}PLEC booking ${booking.ref}.`,
    location: listing?.address || '',
  };
}

function escapeText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 3.1: lines of at most 75 octets, continued with a leading space. */
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    const limit = out.length ? 74 : 75;
    if (bytes + size > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += size;
  }
  out.push(cur);
  return out.join('\r\n ');
}
