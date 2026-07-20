#!/bin/bash
# Injects rate-limit usage into the model's context when a usage band is
# crossed, so long autonomous workflows can checkpoint before hitting limits.
# Reads the state file written by usage-statusline.sh.

input=$(cat)
event=$(printf '%s' "$input" | jq -r '.hook_event_name // "PostToolUse"')
session=$(printf '%s' "$input" | jq -r '.session_id // "unknown"')

state_file="$HOME/.claude/usage-state.json"
[ -f "$state_file" ] || exit 0

now=$(date +%s)
captured=$(jq -r '.captured_at // 0' "$state_file")
[ $((now - captured)) -gt 3600 ] && exit 0

p5=$(jq -r '.five_hour.used_percentage // -1 | floor' "$state_file")
r5=$(jq -r '.five_hour.resets_at // 0 | floor' "$state_file")
p7=$(jq -r '.seven_day.used_percentage // -1 | floor' "$state_file")
r7=$(jq -r '.seven_day.resets_at // 0 | floor' "$state_file")

# Bands: silent below 70% (5h) / 80% (7d), then one injection per 5% step.
band5=0; [ "$p5" -ge 70 ] && band5=$(( p5 / 5 * 5 ))
band7=0; [ "$p7" -ge 80 ] && band7=$(( p7 / 5 * 5 ))
[ "$band5" -eq 0 ] && [ "$band7" -eq 0 ] && exit 0

throttle_file="${TMPDIR:-/tmp}/claude-usage-band-$session"
prev=$(cat "$throttle_file" 2>/dev/null)
key="$band5-$band7"
[ "$key" = "$prev" ] && exit 0
echo "$key" > "$throttle_file"

fmt_reset() {
  local mins=$(( ($1 - now) / 60 ))
  [ "$mins" -lt 0 ] && mins=0
  if [ "$mins" -ge 60 ]; then
    echo "$((mins / 60))h $((mins % 60))m"
  else
    echo "${mins}m"
  fi
}

msg="Rate-limit status: 5-hour window ${p5}% used (resets in $(fmt_reset "$r5")), weekly limit ${p7}% used (resets in $(fmt_reset "$r7"))."

if [ "$p5" -ge 90 ] || [ "$p7" -ge 95 ]; then
  msg="$msg Usage is nearly exhausted. Checkpoint NOW: commit or save all progress, write a summary of remaining steps to a file so work can resume after the reset, then inform the user instead of starting anything new."
elif [ "$p5" -ge 80 ] || [ "$p7" -ge 85 ]; then
  msg="$msg Approaching the limit: prefer finishing and saving current work over starting new large subtasks, and checkpoint progress at the next natural boundary."
fi

jq -n --arg event "$event" --arg ctx "$msg" \
  '{hookSpecificOutput: {hookEventName: $event, additionalContext: $ctx}}'
