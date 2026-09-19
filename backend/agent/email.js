/**
 * Email drafts and sending (PRD B8). draft_email stores a plain-text draft and
 * returns a mailto: link. send_email sends that stored draft through Resend's
 * HTTP API, only when RESEND_API_KEY and EMAIL_FROM are set, and only after the
 * user said yes (it is in gatedExtraTools, so A's gate enforces that).
 */

const EMAIL = /^[^\s@,;?&<>"]+@[^\s@,;?&<>"]+\.[^\s@,;?&<>"]+$/;
const MAX_RECIPIENTS = 10;
const MAX_SUBJECT = 150;
const MAX_BODY = 2000;
const SEND_TIMEOUT_MS = 10_000;

export const sendingEnabled = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

const addresses = (to) => [to ?? []].flat().map((a) => String(a).trim()).filter(Boolean);
const sameRecipients = (a, b) => JSON.stringify(a.map((x) => x.toLowerCase()).sort()) === JSON.stringify(b.map((x) => x.toLowerCase()).sort());

/** Tool body for draft_email: { draft, mailtoUrl, sendingEnabled } or { error, message }. */
export function draftEmail(args, session) {
  const to = addresses(args.to);
  const subject = String(args.subject ?? '').trim();
  const body = String(args.body ?? '').trim();
  if (!to.length || to.length > MAX_RECIPIENTS || !to.every((a) => EMAIL.test(a))) {
    return { error: 'bad_recipients', message: `Give 1 to ${MAX_RECIPIENTS} valid email addresses.` };
  }
  if (!subject || subject.length > MAX_SUBJECT) return { error: 'bad_subject', message: `The subject must be 1 to ${MAX_SUBJECT} characters.` };
  if (body.length > MAX_BODY) return { error: 'bad_body', message: `The body must be at most ${MAX_BODY} characters.` };

  const draft = { to, subject, body };
  session.state.emailDraft = draft;
  const mailtoUrl = `mailto:${to.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return { draft, mailtoUrl, sendingEnabled: sendingEnabled() };
}

/** Tool body for send_email: sends the stored draft when the recipients and subject match it. */
export async function sendEmail(args, session) {
  const draft = session.state.emailDraft;
  if (!draft || String(args.subject ?? '').trim() !== draft.subject || !sameRecipients(addresses(args.to), draft.to)) {
    return { error: 'draft_mismatch', message: 'Draft the email first, then send exactly the drafted recipients and subject.' };
  }
  if (!sendingEnabled()) return { error: 'sending_disabled', message: 'Sending is off; offer the draft link instead.' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: draft.to, subject: draft.subject, text: draft.body }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const reply = await res.json().catch(() => ({}));
    if (!res.ok) return { error: 'send_failed', message: reply.message || `Resend answered HTTP ${res.status}.` };
    delete session.state.emailDraft; // a second "send it" must not send it twice
    return { sent: true, id: reply.id, to: draft.to };
  } catch (err) {
    return { error: 'send_failed', message: err?.name === 'TimeoutError' ? 'The email service timed out.' : err?.message ?? String(err) };
  }
}
