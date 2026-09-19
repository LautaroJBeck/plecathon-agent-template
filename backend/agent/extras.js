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

/** Extra system-prompt text (tag protocol, extra scope, photo/location context). May be ''. */
export function extraPromptSection(session) {
  return '';
}
