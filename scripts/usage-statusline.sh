#!/bin/bash
# Renders the Claude Code statusline and persists rate_limits so the
# usage-context hook can inject limit awareness into the model's context.

input=$(cat)
state_file="$HOME/.claude/usage-state.json"

rl=$(printf '%s' "$input" | jq -c '.rate_limits // empty' 2>/dev/null)
if [ -n "$rl" ] && [ "$rl" != "null" ]; then
  printf '%s' "$rl" | jq --argjson ts "$(date +%s)" '. + {captured_at: $ts}' > "$state_file" 2>/dev/null
fi

model=$(printf '%s' "$input" | jq -r '.model.display_name // "Claude"')
dir=$(basename "$(printf '%s' "$input" | jq -r '.workspace.current_dir // .cwd // "~"')")

fmt_reset() {
  local mins=$(( ($1 - $(date +%s)) / 60 ))
  [ "$mins" -lt 0 ] && mins=0
  if [ "$mins" -ge 60 ]; then
    echo "$((mins / 60))h$((mins % 60))m"
  else
    echo "${mins}m"
  fi
}

usage=""
if [ -f "$state_file" ]; then
  p5=$(jq -r '.five_hour.used_percentage // -1 | floor' "$state_file" 2>/dev/null)
  r5=$(jq -r '.five_hour.resets_at // 0 | floor' "$state_file" 2>/dev/null)
  p7=$(jq -r '.seven_day.used_percentage // -1 | floor' "$state_file" 2>/dev/null)
  r7=$(jq -r '.seven_day.resets_at // 0 | floor' "$state_file" 2>/dev/null)

  [ "${p5:--1}" -ge 0 ] && usage="$usage | 5h: ${p5}% (resets $(fmt_reset "$r5"))"
  [ "${p7:--1}" -ge 0 ] && usage="$usage | 7d: ${p7}% (resets $(fmt_reset "$r7"))"
fi

echo "$model | $dir$usage"
