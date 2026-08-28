#!/usr/bin/env node
// PreToolUse guard for the Bash and PowerShell tools.
//
// The permission classifier can only judge a command whose targets are visible in the
// text. Anything resolved at runtime (a chained `cd`, a relative path, a shell variable)
// leaves it unjudgeable, so the call falls through to a manual approval prompt. Denying
// it here hands the reason back to Claude, which rewrites it within the same turn.
// The rules mirror the "Shell commands" section of ~/.claude/CLAUDE.md.
//
// Where a rule is ambiguous the guard stays quiet. Missing a command costs one approval
// prompt, which is what would have happened without the guard; denying a correct command
// costs a call that has to be fought around instead.

import { homedir } from 'node:os'

const ATOMIC_ESCAPE = /(^|\s)#\s*atomic\b/i

// One line per shell family (POSIX, then PowerShell), which the formatter would
// otherwise flatten to one name per line.
// prettier-ignore
const DIRECTORY_CHANGERS = new Set([
  'cd', 'chdir', 'pushd', 'popd',
  'set-location', 'sl', 'push-location', 'pop-location',
])

// The three ways a command treats the arguments that are not flags. Commands not listed
// here write to every one of them.
// prettier-ignore
const WRITES_TO_LAST_ARGUMENT = new Set([
  'cp', 'mv', 'ln', 'install',
  'move', 'copy', 'move-item', 'copy-item',
])

// `Set-Content "C:/a.txt" "hello"` binds its second argument to `-Value`, so only the
// first one names a file. Reading the rest as paths denies every literal it is given.
// prettier-ignore
const WRITES_TO_FIRST_ARGUMENT = new Set([
  'new-item', 'set-content', 'add-content', 'out-file',
])

// Every command that writes, listed POSIX, cmd, then PowerShell, with the two sets
// above folded in so a name can never appear in one and be missed by the other.
// `Rename-Item` is deliberately absent: its `-NewName` is a bare name that PowerShell
// refuses to read as a path, so it can never write outside its own directory.
// prettier-ignore
const FILE_MUTATORS = new Set([
  'rm', 'rmdir', 'mkdir', 'touch', 'tee',
  'del', 'erase', 'rd', 'md',
  'remove-item',
  ...WRITES_TO_LAST_ARGUMENT, ...WRITES_TO_FIRST_ARGUMENT,
])

// Words that stand in front of the real command: shell keywords, `sudo` and the
// wrappers that run another command unchanged. Without these the word after them is
// mistaken for the command, and the mutator behind it is never inspected.
// prettier-ignore
const COMMAND_PREFIXES = new Set([
  'sudo', 'command', 'builtin', 'exec', 'env', 'nohup', 'time', 'nice', 'stdbuf',
  'do', 'then', 'else', 'elif', '!', '{',
])

// Sinks that name no real path, so a relative-looking target here resolves nowhere.
// prettier-ignore
const SAFE_TARGETS = new Set([
  '/dev/null', '/dev/stdout', '/dev/stderr',
  'nul', 'nul:', '$null',
])

// `2>&1` and `>&2` point one descriptor at another, so they name no file.
const REDIRECT_TO_DESCRIPTOR = /^\d?>>?&\d?-?$/

// `>`, `2>>`, `&>` and `>|`. The capture holds the target when it is attached, as in
// `2>err.log`, and is empty when the target is the token that follows. `>>?` is greedy,
// so `>>` cannot read as `>` writing to a file named `>`.
const REDIRECT = /^(?:\d+|&)?>>?\|?(.*)$/

// Ordered: the specific forms have to be tried before the bare `$name` catch-all.
// prettier-ignore
const POSIX_RUNTIME_VALUES = [
  [/\$\(/, 'a command substitution `$(...)`'],
  [/`[^`]*`/, 'a backtick command substitution'],
  [/<\(/, 'a process substitution `<(...)`'],
  [/<</, 'a heredoc'],
  [/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/, 'a shell variable'],
]

// PowerShell has no backtick substitution (backtick is its escape character) and no
// heredoc. `$null`, `$true` and `$false` are literals, not lookups, so `-Confirm:$false`
// stays readable: it is the form the PowerShell tool asks for on destructive cmdlets.
// prettier-ignore
const POWERSHELL_RUNTIME_VALUES = [
  [/\$\(/, 'a subexpression `$(...)`'],
  [/@['"]/, 'a here-string'],
  [/\$env:/i, 'an environment variable'],
  [/\$\{?(?!null\b|true\b|false\b)[A-Za-z_][A-Za-z0-9_]*\}?/, 'a PowerShell variable'],
]

// PowerShell binds `-Parameter Value`, so a bare token after a parameter is that
// parameter's value rather than a path. Only these parameters name something on disk.
const POWERSHELL_SOURCE_PARAMETERS = new Set(['path', 'literalpath', 'itempath'])
const POWERSHELL_DESTINATION_PARAMETERS = new Set(['destination', 'filepath', 'outfile'])

// Parameters that take no value, so the token after them is a plain argument again.
// prettier-ignore
const POWERSHELL_SWITCHES = new Set([
  'recurse', 'force', 'confirm', 'whatif', 'passthru', 'append', 'nonewline',
  'noclobber', 'wait', 'quiet', 'resolve', 'followsymlink', 'container',
  'verbose', 'debug', 'usetransaction', 'asplaintext', 'nonewwindow',
])

// Moves the destination out of the positional list, as in `cp -t /dest a b`.
const POSIX_DESTINATION_FLAGS = new Set(['-t', '--target-directory'])

// Splits a command line into the pieces the shell runs separately, dropping each
// `# comment` (which both shells start at the beginning of a word) and handing the
// comment text back on its own. Quotes and `$(...)` hide their contents from both jobs:
// a `#` inside an argument does not start a comment, and a separator inside a
// substitution does not end a command. Reading the `# atomic` escape from the returned
// comment alone stops a quoted mention of it from switching the guard off.
function splitCommandLine(command, isPowerShell) {
  // A lone `&` backgrounds a command in POSIX, but in PowerShell it is the call
  // operator that runs the executable named next to it.
  const separators = isPowerShell ? ';|\n' : ';|&\n'

  const segments = []
  let current = ''
  let comments = ''
  let quote = ''
  let depth = 0
  let isComment = false

  for (let index = 0; index < command.length; index++) {
    const character = command[index]
    const pair = command.slice(index, index + 2)

    // The newline that ends a comment still has to reach the separator check below.
    if (isComment) {
      if (character !== '\n') {
        comments += character
        continue
      }

      isComment = false
    }

    if (quote) {
      current += character
      if (character === quote) quote = ''
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      current += character
      continue
    }

    if (character === '#' && (index === 0 || /\s/.test(command[index - 1]))) {
      isComment = true
      comments += character
      continue
    }

    // Both characters are consumed here. Letting the `(` fall through to the next
    // iteration would count the same substitution twice, and the extra depth would
    // never come back off, so every later separator would look nested.
    if (pair === '$(' || pair === '@(') {
      depth++
      current += pair
      index++
      continue
    }

    if (depth > 0 && character === '(') {
      depth++
      current += character
      continue
    }

    if (depth > 0 && character === ')') {
      depth--
      current += character
      continue
    }

    if (character === '\\' && /[\s;|&]/.test(command[index + 1] ?? '')) {
      current += character + command[index + 1]
      index++
      continue
    }

    if (depth === 0 && (pair === '&&' || pair === '||')) {
      segments.push(current)
      current = ''
      index++
      continue
    }

    // `2>&1`, `&>log` and `>|log` are redirections, not the background `&` or the pipe
    // that would otherwise end the command here.
    const isRedirectOperator =
      (character === '&' && (command[index + 1] === '>' || current.endsWith('>'))) ||
      (character === '|' && current.endsWith('>'))

    if (depth === 0 && !isRedirectOperator && separators.includes(character)) {
      segments.push(current)
      current = ''
      continue
    }

    current += character
  }

  segments.push(current)

  return { segments: segments.map(segment => segment.trim()).filter(Boolean), comments }
}

function tokenize(segment) {
  const tokens = []
  let raw = ''
  let quote = ''

  const flush = () => {
    if (!raw) return
    tokens.push({ raw, value: raw.replace(/['"]/g, '') })
    raw = ''
  }

  for (let index = 0; index < segment.length; index++) {
    const character = segment[index]

    if (quote) {
      raw += character
      if (character === quote) quote = ''
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      raw += character
      continue
    }

    // A backslash escapes whitespace only: `My\ Project` has to stay one word on macOS,
    // while the separators in `C:\Users\x` have to survive as literal characters. A
    // backslash before a newline is a line continuation, so both characters vanish.
    if (character === '\\' && /\s/.test(segment[index + 1] ?? '')) {
      if (segment[index + 1] !== '\n') raw += segment[index + 1]
      index++
      continue
    }

    if (/\s/.test(character)) {
      flush()
      continue
    }

    raw += character
  }

  flush()
  return tokens
}

// Pulls the redirect targets out of a segment and returns the tokens that are left, so
// the argument readers below see nothing but the command and its arguments.
function extractRedirects(tokens) {
  const targets = []
  const rest = []

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]

    if (REDIRECT_TO_DESCRIPTOR.test(token.raw)) continue

    const redirect = token.raw.match(REDIRECT)

    if (!redirect) {
      rest.push(token)
      continue
    }

    if (redirect[1]) targets.push(redirect[1].replace(/['"]/g, ''))
    else if (tokens[index + 1]) targets.push(tokens[++index].value)
  }

  return { targets, rest }
}

function bareName(value) {
  return value.split(/[\\/]/).pop().toLowerCase()
}

// Skips `VAR=value` prefixes and the wrapper words in COMMAND_PREFIXES, then reduces
// `/usr/bin/rm` to `rm`. The index it lands on is what separates the command from its
// arguments, so it is returned too.
function findCommand(tokens) {
  let index = 0

  while (tokens[index]) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index].raw)) {
      index++
      continue
    }

    if (COMMAND_PREFIXES.has(bareName(tokens[index].value))) {
      index++
      continue
    }

    break
  }

  return { word: tokens[index] ? bareName(tokens[index].value) : '', index }
}

function isAbsolute(value) {
  return /^([\\/]|~[\\/]?$|~[\\/]|[A-Za-z]:[\\/])/.test(value)
}

function splitAttachedValue(raw) {
  const equals = raw.indexOf('=')
  if (!raw.startsWith('-') || equals < 0) return [raw, undefined]

  return [raw.slice(0, equals), raw.slice(equals + 1).replace(/['"]/g, '')]
}

function readPosixArguments(tokens, commandIndex) {
  const destinations = []
  const positionals = []

  for (let index = commandIndex + 1; index < tokens.length; index++) {
    const { raw, value } = tokens[index]
    const [flag, attached] = splitAttachedValue(raw)

    if (POSIX_DESTINATION_FLAGS.has(flag)) {
      if (attached !== undefined) destinations.push(attached)
      else if (tokens[index + 1]) destinations.push(tokens[++index].value)
      continue
    }

    // A bare number is a flag value such as the mode in `install -m 755`, never a path.
    if (raw.startsWith('-') || /^\d+$/.test(value)) continue

    positionals.push(value)
  }

  return { sources: [], destinations, positionals }
}

function readPowerShellArguments(tokens, commandIndex) {
  const sources = []
  const destinations = []
  const positionals = []

  for (let index = commandIndex + 1; index < tokens.length; index++) {
    const { raw, value } = tokens[index]

    if (raw === '-' || raw === '--' || raw === '--%') continue

    const parameter = raw.match(/^-{1,2}([A-Za-z][A-Za-z0-9]*)(:)?/)

    if (!parameter) {
      positionals.push(value)
      continue
    }

    // `-Confirm:$false` carries its value in the same token and a switch takes none, so
    // in both cases the token after it is positional again. An unrecognised parameter is
    // assumed to take a value: swallowing an argument only ever costs an approval
    // prompt, while reading `-Encoding utf8` as a path denies a correct command.
    const name = parameter[1].toLowerCase()
    if (parameter[2] || POWERSHELL_SWITCHES.has(name)) continue

    const next = tokens[++index]
    if (!next) break

    if (POWERSHELL_SOURCE_PARAMETERS.has(name)) sources.push(next.value)
    else if (POWERSHELL_DESTINATION_PARAMETERS.has(name)) destinations.push(next.value)
  }

  return { sources, destinations, positionals }
}

// Everything the segment writes through its arguments. Read sources are left out: a
// relative path that is only read cannot escape an allowed directory, and rule 3 asks
// for absolute write and delete targets.
function collectArgumentTargets(tokens, commandIndex, word, isPowerShell) {
  const { sources, destinations, positionals } = isPowerShell
    ? readPowerShellArguments(tokens, commandIndex)
    : readPosixArguments(tokens, commandIndex)

  const named = [...sources, ...destinations]

  if (WRITES_TO_FIRST_ARGUMENT.has(word)) return [...named, ...positionals.slice(0, 1)]
  if (!WRITES_TO_LAST_ARGUMENT.has(word)) return [...named, ...positionals]
  if (destinations.length > 0) return destinations

  return positionals.length > 1 ? positionals.slice(-1) : []
}

function stripSingleQuoted(segment) {
  return segment.replace(/'[^']*'/g, "''")
}

function findViolations(segments, isPowerShell) {
  const runtimeValues = isPowerShell ? POWERSHELL_RUNTIME_VALUES : POSIX_RUNTIME_VALUES
  const isChained = segments.length > 1
  const violations = []

  for (const segment of segments) {
    const { targets: redirectTargets, rest } = extractRedirects(tokenize(segment))
    const { word, index: commandIndex } = findCommand(rest)
    const shown = segment.replace(/\s+/g, ' ')

    if (isChained && DIRECTORY_CHANGERS.has(word)) {
      const message =
        `\`${shown}\` chains a directory change into another command, so ` +
        `every later path resolves against a directory only known at runtime (rule 2). ` +
        `The working directory persists between calls: drop the \`cd\` and use absolute ` +
        `paths, or a tool flag such as \`git -C "<absolute path>"\`.`

      violations.push(message)
      continue
    }

    const isMutator = FILE_MUTATORS.has(word)
    const argumentTargets = isMutator
      ? collectArgumentTargets(rest, commandIndex, word, isPowerShell)
      : []

    const targets = [...redirectTargets, ...argumentTargets]
    if (!isMutator && targets.length === 0) continue

    const expandable = stripSingleQuoted(segment)

    for (const [pattern, description] of runtimeValues) {
      if (!pattern.test(expandable)) continue

      const message =
        `\`${shown}\` writes to disk with ${description} among its ` +
        `arguments, whose value does not exist until the command runs (rule 4). Inline ` +
        `the literal path, or use the Write tool if you are producing file contents.`

      violations.push(message)
      break
    }

    for (const target of targets) {
      if (isAbsolute(target) || SAFE_TARGETS.has(target.toLowerCase())) continue
      if (runtimeValues.some(([pattern]) => pattern.test(target))) continue

      const example = `${homedir().replace(/\\/g, '/')}/.../${target.replace(/^\.\//, '')}`

      const message =
        `\`${shown}\` writes to the relative target \`${target}\`, which ` +
        `resolves against an unknown working directory (rule 3). Spell it out in full, ` +
        `e.g. \`"${example}"\`.`

      violations.push(message)
    }
  }

  return violations
}

function readStdin() {
  return new Promise(resolve => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(''))
  })
}

// Any failure here stays silent: a broken guard must not block the tool call.
try {
  const input = JSON.parse(await readStdin())
  const isPowerShell = input?.tool_name === 'PowerShell'

  const { segments, comments } = splitCommandLine(input?.tool_input?.command ?? '', isPowerShell)
  const violations = ATOMIC_ESCAPE.test(comments) ? [] : findViolations(segments, isPowerShell)

  if (violations.length > 0) {
    const reason =
      'Blocked before the permission check: this command cannot be judged ' +
      'statically, so it would stall on a manual approval prompt.\n\n' +
      violations
        .slice(0, 5)
        .map((text, index) => `${index + 1}. ${text}`)
        .join('\n\n') +
      '\n\nRewrite it as standalone calls with absolute, literal paths and run it again. ' +
      'If it genuinely has to stay atomic, append `# atomic` to the command and say why.'

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      }),
    )
  }
} catch {}
