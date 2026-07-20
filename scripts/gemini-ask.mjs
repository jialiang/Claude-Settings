/**
 * Sends a prompt to Google Gemini (AI Studio API) and prints the reply to stdout.
 *
 * A user-level "second-opinion" bridge: Claude Code shells out to this to get an
 * independent take from Gemini on a review, an approach or a snippet — in any repo.
 * Each call is stateless — pass any prior context inside the prompt.
 *
 * Usage:
 *   node ~/.claude/scripts/gemini-ask.mjs "your prompt here"
 *   git diff | node ~/.claude/scripts/gemini-ask.mjs "Review this diff for bugs"
 *   node ~/.claude/scripts/gemini-ask.mjs --model gemini-2.5-pro "deep critique"
 *
 * Reads GEMINI_API_KEY (required) and GEMINI_MODEL (optional) from ~/.claude/.env
 * or the process environment. Stdin, when piped, is appended to the prompt as context.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const claudeDir = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv() {
  try {
    const raw = readFileSync(join(claudeDir, '.env'), 'utf8')

    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const eq = trimmed.indexOf('=')
      if (eq === -1) continue

      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (!(key in process.env)) process.env[key] = value
    }
  } catch {
    // No ~/.claude/.env — fall back to the process environment.
  }
}

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('')

  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
  })
}

function parseArgs(argv) {
  const args = [...argv]
  let model = null

  const flagIdx = args.findIndex((a) => a === '--model' || a === '-m')
  if (flagIdx !== -1) {
    model = args[flagIdx + 1]
    args.splice(flagIdx, 2)
  }

  return { model, prompt: args.join(' ').trim() }
}

async function main() {
  loadEnv()

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY is not set (add it to ~/.claude/.env).')
    process.exit(1)
  }

  const { model: modelFlag, prompt } = parseArgs(process.argv.slice(2))
  const model = modelFlag || process.env.GEMINI_MODEL || 'gemini-2.5-flash'

  const stdin = await readStdin()
  const fullPrompt = stdin ? `${prompt}\n\n--- CONTEXT ---\n${stdin}` : prompt

  if (!fullPrompt) {
    console.error('Error: no prompt provided. Pass it as an argument or pipe context via stdin.')
    process.exit(1)
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }] })
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`Gemini API error (${res.status} ${res.statusText}):\n${body}`)
    process.exit(1)
  }

  const json = await res.json()
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? ''

  if (!text) {
    console.error('Gemini returned no text. Full response:')
    console.error(JSON.stringify(json, null, 2))
    process.exit(1)
  }

  console.log(text)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
