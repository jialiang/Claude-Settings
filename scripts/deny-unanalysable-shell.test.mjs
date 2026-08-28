// Black-box tests for the PreToolUse guard: each case is fed through the script the
// same way the hook feeds it, so the JSON contract is covered along with the rules.
//
// Run with `node --test "C:/Users/Jia Liang/.claude/scripts/"`.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'

const GUARD = fileURLToPath(new URL('./deny-unanalysable-shell.mjs', import.meta.url))

function run(command, toolName = 'Bash') {
  const result = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ tool_name: toolName, tool_input: { command } }),
    encoding: 'utf8',
  })

  assert.equal(result.stderr, '', `guard wrote to stderr for ${command}`)
  if (!result.stdout.trim()) return { isDenied: false, reason: '' }

  const { hookSpecificOutput } = JSON.parse(result.stdout)
  assert.equal(hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(hookSpecificOutput.permissionDecision, 'deny')

  return { isDenied: true, reason: hookSpecificOutput.permissionDecisionReason }
}

function allows(name, command, toolName) {
  test(`allows ${name}`, () => {
    const { isDenied, reason } = run(command, toolName)
    assert.equal(isDenied, false, `denied ${command}\n${reason}`)
  })
}

function denies(name, command, expected, toolName) {
  test(`denies ${name}`, () => {
    const { isDenied, reason } = run(command, toolName)
    assert.equal(isDenied, true, `allowed ${command}`)
    assert.match(reason, expected)
  })
}

test('an empty payload is ignored', () => {
  const result = spawnSync(process.execPath, [GUARD], { input: '{}', encoding: 'utf8' })
  assert.equal(result.stdout.trim(), '')
})

test('malformed input never blocks the call', () => {
  const result = spawnSync(process.execPath, [GUARD], { input: 'not json', encoding: 'utf8' })
  assert.equal(result.stdout.trim(), '')
  assert.equal(result.status, 0)
})

allows('a read-only command', 'git -C "C:/Users/x/.claude" status')
allows('a single directory change', 'cd "C:/tmp"')
allows('an absolute delete', 'rm -rf "C:/tmp/build"')
allows('a home-relative delete', 'rm -rf ~/tmp/x')
allows('a null redirect', 'echo hi > /dev/null')
allows('a flag value that looks like a path', 'install -m 755 "/tmp/a" "/usr/local/bin/a"')
allows('a search whose pattern is not a write', 'grep -rn "foo" "C:/tmp"')
allows('a package install with no targets', 'npm install --save-dev prettier')

denies('a chained directory change', 'cd "C:/tmp" && ls', /rule 2/)
denies('a chained directory change at the end', 'mkdir "C:/tmp/a" && cd "C:/tmp/a"', /rule 2/)
denies('a relative delete', 'rm -rf build', /relative target `build`/)
denies('a relative redirect', 'echo hi > out.txt', /relative target `out\.txt`/)
denies('a variable in a delete', 'rm -rf "$HOME/tmp"', /a shell variable/)
denies('a heredoc write', 'cat > /abs/f <<EOF\nx\nEOF', /a heredoc/)
denies('a command substitution write', 'cp $(ls) /abs/dest', /a command substitution/)
denies('a relative tee through a pipe', 'ls "C:/tmp" | tee out.log', /relative target `out\.log`/)
denies('a relative write behind sudo', 'sudo rm -rf build', /relative target `build`/)

// Finding 1: `$(` used to double-count nesting, so nothing after it was ever split.
test('a substitution does not swallow the rest of the command', () => {
  assert.match(run('echo $(date) && rm -rf build').reason, /relative target `build`/)
  assert.match(run('echo $(date) && cd "C:/tmp" && ls').reason, /rule 2/)
  assert.match(run('echo $(date) $(whoami) && rm -rf build').reason, /relative target `build`/)
  assert.match(run('echo "$(date)" ; rm -rf build').reason, /relative target `build`/)
})

// Finding 2: a shell keyword or wrapper used to be read as the command itself.
denies('a delete inside a for loop', 'for f in "C:/a"/*; do rm -rf build; done', /`build`/)
denies('a delete inside an if branch', 'if [ -d build ]; then rm -rf build; fi', /`build`/)
denies('a delete behind env', 'env FOO=1 rm -rf build', /`build`/)
denies('a delete behind nohup', 'nohup rm -rf build', /`build`/)
denies('a delete behind time', 'time rm -rf build', /`build`/)

// Finding 3: `&>` and `>|` were not recognised as redirects.
denies('an ampersand redirect', 'echo hi &> out.log', /relative target `out\.log`/)
denies('an appending ampersand redirect', 'echo hi &>> out.log', /relative target `out\.log`/)
denies('a clobbering redirect', 'echo hi >| out.txt', /relative target `out\.txt`/)
denies('a numbered redirect', 'echo hi 2> err.log', /relative target `err\.log`/)
allows('a descriptor redirect', 'echo hi > "C:/tmp/out" 2>&1')

// Finding 4: PowerShell named parameters were read as positional paths.
const POWERSHELL = 'PowerShell'
allows('a typed New-Item', 'New-Item -ItemType Directory -Force -Path "C:/tmp/x"', POWERSHELL)
allows(
  'an encoded Set-Content',
  'Set-Content -Path "C:/t/a.txt" -Value "hi" -Encoding utf8',
  POWERSHELL,
)
allows('an encoded Out-File', 'Out-File -FilePath "C:/tmp/a.txt" -Encoding utf8', POWERSHELL)
allows('a named copy', 'Copy-Item -Path "C:/a" -Destination "C:/b" -Recurse', POWERSHELL)
allows('an appended line', 'Add-Content -Path "C:/tmp/a.txt" -Value "one"', POWERSHELL)
denies('a relative PowerShell delete', 'Remove-Item -Recurse -Force build', /`build`/, POWERSHELL)
denies('a relative named path', 'New-Item -ItemType File -Path out.txt', /`out\.txt`/, POWERSHELL)
denies('a relative destination', 'Copy-Item "C:/a" -Destination ./b', /`\.\/b`/, POWERSHELL)

// Finding 5: `$false` was read as a runtime variable.
allows('a suppressed confirmation', 'Remove-Item "C:/tmp/x" -Recurse -Confirm:$false', POWERSHELL)
allows('a boolean parameter', 'Set-Content "C:/tmp/a.txt" "x" -NoNewline:$true', POWERSHELL)
denies(
  'a real PowerShell variable',
  'Remove-Item -Path $target',
  /a PowerShell variable/,
  POWERSHELL,
)
denies(
  'an environment variable',
  'Remove-Item "$env:TEMP/x"',
  /an environment variable/,
  POWERSHELL,
)

// Finding 6: a trailing comment used to be read as a filename.
allows('a commented absolute delete', 'rm -rf "C:/tmp/x" # clean the build dir')
allows('a hash inside an argument', 'grep "#define" "C:/tmp/f"')
denies('a commented relative delete', 'rm -rf build # clean the build dir', /`build`/)

// Finding 7: sources were counted as write targets.
allows('a relative source', 'cp -r ./src "C:/tmp/dest"')
allows('a relative source for move', 'mv ./a.txt "C:/tmp/a.txt"')
allows('a target directory flag', 'cp -t "C:/tmp/dest" ./a ./b')
denies('a relative destination', 'cp -r "C:/tmp/src" ./dest', /relative target `\.\/dest`/)
denies('a relative move destination', 'mv ./a ./b', /relative target `\.\/b`/)
denies('every relative argument of a delete', 'rm -rf a b', /`a`[\s\S]*`b`/)

// Finding 8: a PowerShell backtick escape matched the POSIX substitution rule.
allows('escaped tabs in a value', 'Set-Content "C:/tmp/a.txt" "c1`tc2`tc3"', POWERSHELL)
denies('a real backtick substitution', 'rm -rf `cat list`', /a backtick command substitution/)

// Finding 9: the atomic escape used to match inside a quoted argument.
allows('an escaped atomic command', 'cd "C:/tmp" && ls # atomic: needs one shell')
denies('a quoted mention of the escape', 'echo "the # atomic escape" ; rm -rf build', /`build`/)
denies('a commit message naming the escape', 'git commit -m "# atomic" ; rm -rf build', /`build`/)

// Finding 10: the wording used to claim a variable was the thing being written.
test('the runtime-value message does not claim the variable is the target', () => {
  const { reason } = run('grep "$PATTERN" "C:/tmp/f" > "C:/tmp/out"')
  assert.match(reason, /writes to disk with a shell variable among its arguments/)
})
