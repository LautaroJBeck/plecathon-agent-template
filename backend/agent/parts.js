/**
 * Turns the model's final text into contract parts (PRD B). Step 0 stub: the
 * shape A codes against (docs/prd, section 3.3). B replaces the body, never the signature.
 */

/** turnResults = [{ name, args, result }] for every tool call this turn, in order.
 *  Returns Part[] with at least one text part. */
export function toParts(text, session, turnResults) {
  return [{ kind: 'text', text: (text || '').trim() || 'Sorry, could you say that again?' }];
}
