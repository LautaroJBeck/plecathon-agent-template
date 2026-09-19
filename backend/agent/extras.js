/**
 * Extra tools and prompt text (PRD B). Step 0 stub: the shape A codes against
 * (docs/prd, section 3.3). B replaces the bodies, never the signatures.
 */

export const extraTools = []; // OpenAI-style function tools, same shape as plec.js `tools`
export const gatedExtraTools = []; // names of extra tools that need a user "yes" (A's gate enforces it)

/** ctx = { session, userText }. Never throws; on failure returns { error, message }. */
export async function callExtraTool(name, args, ctx) {
  return { error: 'unknown_tool', message: `No tool named ${name}.` };
}

const TAG_PROTOCOL = `Showing listings: to show listings, end your reply with a line "CARDS: id1, id2" using ids from tool results only (at most 6, best first). Cards are numbered in that order and carry the name, category, capacity and price, so keep your text short and don't repeat those details. When the user refers to a number ("I like 1 and 3"), it is the position in your last CARDS line. For photos of a listing, add a line "PHOTOS: id". For a map, fetch the listing with get_listing and add "MAP: id". Never write image URLs or markdown images yourself.`;

/** Extra system-prompt text (tag protocol, extra scope, photo/location context). May be ''. */
export function extraPromptSection(session) {
  return TAG_PROTOCOL;
}
