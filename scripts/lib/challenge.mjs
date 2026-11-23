// Recognises bot-check pages (Cloudflare and similar) that stand in for the real one.

// Page titles these checks show while they decide whether to let a visitor through.
const CHALLENGE_TITLES = [
  'Just a moment',
  'Attention Required',
  'Checking your browser',
  'One moment, please',
]

export const isChallengeTitle = title =>
  CHALLENGE_TITLES.some(prefix => title.trim().startsWith(prefix))

// Cloudflare's challenge script defines this variable. Ordinary pages served
// through Cloudflare don't, so it is safe to look for in raw HTML.
export const hasChallengeScript = html => html.includes('_cf_chl_opt')
