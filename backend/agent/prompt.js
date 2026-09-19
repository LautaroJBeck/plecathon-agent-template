/**
 * The system prompt, rebuilt every turn (PRD A, A5): base rules, today's
 * date, the structured state summary, then B's extra section.
 */

import { extraPromptSection } from './extras.js';

// TODO(A5): the full rule set.
const BASE = `You are the PLEC Concierge. You find, explain and book venues and event services in Philadelphia, New York and Washington. Every fact you state comes from a tool result. Reply in 2-4 short sentences.`;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Today is Saturday, 2026-09-19. ..." in UTC, the sandbox's clock. */
export function todayLine(now = new Date()) {
  return `Today is ${WEEKDAYS[now.getUTCDay()]}, ${now.toISOString().slice(0, 10)}. Dates without a year are in 2026.`;
}

/** @param {{ state: object }} session */
export function systemPrompt(session) {
  return [BASE, todayLine(), extraPromptSection(session)].filter(Boolean).join('\n\n');
}
