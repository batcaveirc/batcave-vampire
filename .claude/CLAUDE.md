# Project skills — Dracula (IRC bot, JS)

This bot runs live on GitHub Actions in front of real users. The cost of a
regression is users leaving. Prefer verification over speed.

## Default toolkit for THIS project

**Before implementing anything (even a "small fix"):**
- `brainstorming` — explore intent before touching code; the IRC environment
  has subtle interactions (pacer, rotation, flood guard) that bite
- `writing-plans` — multi-step changes always get a written plan first
- `codebase-design` — before deepening a module or adding a new verb (::saw,
  ::act, ::mem), think about the seam

**While implementing:**
- `tdd` / `test-driven-development` — write/extend tests in `test/` BEFORE
  changing `action-bot.js`. Each new behavior gets a must-pass + must-not-pass
  pair, like the existing nick filter + recruittarget tests
- `systematic-debugging` / `diagnosing-bugs` — the field-debugging.md ritual
  pairs with these. Read a real log first; one decisive probe beats five
  edits.
- `using-git-worktrees` — never debug a running bot in the live tree; spawn
  a worktree so the deploy you're not ready to ship stays isolated
- `worktree` (hidorakai) — concrete setup for a new branch worktree.
  Trigger: "set up a worktree for the <feature>" / "work on <branch> in
  isolation". It copies `.env`, installs node_modules, so you can be
  running `node test/run.js` in a side branch while the main tree still
  holds the deployed state

**Before claiming done:**
- `verification-before-completion` — mandatory before any "ok, pushed":
  - `node --check action-bot.js`
  - `node test/helpcoverage.js`
  - `node test/teamwork.js`
  - `node test/everycommand.js` (slow; 54 cmds × 2 rooms)
  - watch the deploy run in_progress past 3 min (blocked-IP cutoff)
- `unlazy` — explicitly gated acceptance checks for substantial work. For a
  one-line fix skip; for "add a new ::verb" or "touch the pacer", use it.
- `requesting-code-review` — ask the subagent to review before pushing

## Project-specific rituals the skills won't know

**Deploy ritual** — the test chain + the ~3min connect watch is the whole
difference between "pushed" and "working". The hotfix pattern established
2026-10-06: push → `gh run view <id> --json status` loop until past the
refusal window; a bot that "went live" at 1 minute hasn't gone live.

**Pacer awareness** — any new feature that sends to the server (`::` verb,
NOTICE, PRIVMSG) must have a rate check at DESIGN time. The Carfax RecvQ
drop proved HybridIRC enforces ~10 lines/sec. Rate-limit template is
`trustBroadcastOk()` (20/60s token bucket).

**Local-only secrets** — this repo pushes to GitHub as `t62852659-maker`
(pseudonymous). Nothing with the owner's real name or private details lands
on GitHub. If writing docs/comments, keep it technical.

## Prefer-NOT skills for this project

- `prototype` — don't throwaway-prototype; this bot is live. Experiments
  go in `scratchpad/`, not production code
- `pr-polish`/`pr-review` — pushes go to main, no PR workflow here (the
  repo lives behind a pseudonymous account; PR workflow would expose that)
