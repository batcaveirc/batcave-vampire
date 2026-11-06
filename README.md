# BatCave Vampire — IRC bot

A lightweight, **IRC-only** version of the BatCave "Vampire" bot, built to run on an
ephemeral host (GitHub Actions, a small VM, or a phone). No Discord bridge, no database,
**no secrets in the code** — everything comes from environment variables / GitHub Secrets.

## What it does
- Connects to IRC, identifies with NickServ, joins the channel, auto-rejoins on kick.
- Vampire persona: dynamic mood per reply; replies when mentioned (optional Groq AI, canned lines otherwise).
- Emotes & fun: `!hug !slap !bite !kiss !pat !boop !poke !flirt !roast · !8ball !roll !flip !rps !choose !fortune !joke`.
- Utility: `!ping !uptime !seen !time !rules !help`.
- Moderation: bad-word filter (warn → kick at 3), plus admin `!say !kick !ban !warn !warnings !topic`.
- Natural-language admin: mention the bot with "mute the room", "op Nick", "kick Nick", "set topic …".
- Idle company: when the room goes quiet with people in it, notices ONE quiet regular by name (never a generic "anyone here?").
- `!!shoot`: a nick goes up as the target, the room types **shoot**, and a miss costs somebody a minute out of the channel.
- Handles `SIGTERM` for a clean quit when the host stops the job.

## Deploy on GitHub Actions (free)
1. This repo must stay **public** — public repos get unlimited free Action minutes (private repos only get ~2,000/month ≈ 33 h).
2. **Settings → Secrets and variables → Actions → New repository secret.** Add:

   | Secret | Example | Required |
   |---|---|---|
   | `IRC_SERVER` | `irc.hybridirc.com` | ✔ |
   | `IRC_PORT` | `6667` | ✔ |
   | `IRC_NICK` | `Vampire` | ✔ |
   | `IRC_CHANNEL` | `#batcave` | ✔ |
   | `NICKSERV_PASS` | *(your NickServ password)* | ✔ |
   | `OWNERS` | `yournick` (comma-sep, lowercase) | ✔ |
   | `ADMINS` | `mod1,mod2` | optional |
   | `NICKSERV_ACCOUNT` | account if ≠ nick | optional |
   | `IRC_TLS` | `true` (and set port `6697`) | optional |
   | `GROQ_API_KEY` | for real AI replies | optional |
   | `BADWORDS` | comma-sep words to auto-moderate | optional |

3. **Actions** tab → enable workflows.
4. It starts within ~5 minutes (or run it now via **Actions → BatCave Vampire Bot → Run workflow**).

## Uptime reality
GitHub caps each job at 6 hours. The workflow runs one instance at a time and hands off to a
fresh run at ~5.8 h, so expect a short (seconds-to-minutes) gap roughly every 6 hours. Scheduled
runs can also be delayed under GitHub load. For rock-solid 24/7, a tiny always-on host (VM/phone)
is steadier — this Actions setup is the zero-cost option.

## Run locally
```bash
npm install
IRC_NICK=Vampire IRC_CHANNEL='#batcave' NICKSERV_PASS=... OWNERS=yournick node action-bot.js
```

## Tests
```bash
npm run check            # node --check action-bot.js
npm run test:parallel    # all 94 suites, 8 at a time, ~4 minutes
npm test                 # the same suites one after another (slow)
```
The `Tests` workflow runs `check` and `test:parallel` on every push and pull
request. Suites that open sockets bind to localhost only. A failing suite may
be starved rather than broken on a loaded machine — `test/run.js` gives it one
retry and says so when that is what happened.

## Shooting game

`!!shoot` puts a nick up as the target; typing **shoot** fires. The target drops
or dodges, and a miss nominates one random person who is then removed for as
long as it takes to rejoin, with "you lost a game you were not playing".

Every removal goes through the same `kickUser()` path as `!!kick`, so it carries
the ops check, the once-per-person guard and the parting notice. On top of that
owners, admins, whitelisted regulars, protected masks and the bot fleet are never
chosen, nobody is chosen twice in a day, and there are at most two removals an
hour, six minutes apart.

The mercy window is real: the victim is announced and `!!shoot spare <nick>`
cancels it before it lands. `!!shootstats` prints the board and `!!endshoot`
stops the game (moderators). `SHOOT_KICK_ON=off` keeps the game and drops the
kick entirely — the right setting for a room where nobody agreed to be removed
for a joke.

| Secret | Default | |
|---|---|---|
| `SHOOT_ON` | `on` | the whole game |
| `SHOOT_KICK_ON` | `on` | the removal on a miss |
| `SHOOT_ROUND_SECS` | `20` | how long a target stays up |
| `SHOOT_DODGE_CHANCE` | `0.35` | how often the target slips |
| `SHOOT_KICK_GRACE_SECS` | `12` | window to spare somebody |
| `SHOOT_KICK_PER_HOUR` | `2` | hard cap on removals |

## Security
Secrets live only in GitHub Secrets (encrypted, injected at runtime) or your local env — never in
this code. This is an IRC-only build: it contains no Discord bridge and relays no private traffic.
