# !!Findit — a hidden-traitor game built for a chatroom

Design for review. **Nothing built or pushed yet.**

Host room: `#🅱🅰🆃🅲🅰🆅🅴`. New module `findit.js` wired into `action-bot.js`.

## The idea it is built on

Among Us works because you can see who is near you and nothing else. A chatroom
already has that: **being in a channel is being in a room, and `/names` is your
line of sight.** So the rules below are written around channel membership rather
than copied from a game with a map and a movement stick.

Three consequences shape everything:

- **You always know exactly who is in the room with you.** That is *more*
  information than Among Us gives, so the kill rule has to account for it.
- **Everything is either public (channel), private (NOTICE) or positional
  (which channel you are in).** There is no third channel of information.
- **Nothing is real-time.** Every action is a command, so timers must be
  generous and every deadline is announced.

## Server limits

| Limit | Value | Consequence |
|---|---|---|
| `CHANLIMIT` | `#:20` | Dracula is in 2 rooms already → 6 compartments + ghost room is comfortable |
| `PREFIX` | `(Yov)!@+` | Only `@`/`+` exist; Dracula is op in every room it creates |
| `CHANNELLEN` | 60 | `#Electrical-4821` fits easily |

## The ship

Created fresh per game, numbered so games never collide:

```
#Cafeteria-4821    meeting point, everyone starts here
#Reactor-4821      #Electrical-4821    #MedBay-4821
#Oxygen-4821       #Navigation-4821
#Ghosts-4821       the dead only
```

All are `+i` (invite-only) and `+s` (secret): nobody wanders in, and they do not
appear in `/list`. Dracula parts everything at the end and the channels vanish.

## The rules, written for chat

### Killing — you must be alone with them

**The alien can only kill when the compartment contains exactly two people: the
alien and the victim.** This is the rule the medium demands. In a chatroom every
occupant is visible, so a kill in front of witnesses would identify the alien
instantly and the game would be over.

That single rule creates the whole game: the alien has to catch someone alone,
and crewmates learn to travel in pairs. Being alone becomes a real risk, and
"who did you see alone with them?" becomes the core question at a meeting.

- 45-second cooldown between kills.
- The victim is told privately, then removed to the ghost room.
- **Nothing is announced publicly.** The body stays in that compartment.

### Bodies — found by walking in

The body sits in the compartment where it happened. Anyone already there, or who
joins afterwards, gets a private NOTICE: *"You find NICK's body here."* They then
choose whether to `!!report` — or stay quiet, which is itself a tell.

### `!!break` — sabotage, alien only

`!!break <room>` disables a compartment. In a chatroom "broken" should be
something you can *see*, so Dracula sets the channel **`+m` (moderated)**:
nobody can speak in that room until it is repaired. Tasks there are blocked.

- The break is announced shipwide, but **not who caused it**.
- Any crewmate goes to that room and types `!!fix` to repair it (`-m`).
- 90-second cooldown, and only one break at a time.
- **Critical break** (Reactor or Oxygen): if not repaired within 90 seconds, the
  aliens win. This is the alien's clock and the reason crew must split up —
  which is exactly when they become killable.

The alien can also break a room to empty it, or to strand someone alone.

### Ghosts — their own room, and they stay dead

When you die you are invited to `#Ghosts-4821` (`+i +s`), where the dead talk
freely with no living player able to read it.

- Dracula sets `+q` on you in the game room and compartments, so a ghost cannot
  influence the living even by accident.
- **Ghosts do not do tasks.** In Among Us they can, but here a ghost would have
  to be *present in a channel* to do one, and the living would see them standing
  there. Removing tasks is the version that fits the medium.
- A dead player's remaining tasks are removed from the total, so the crew's
  task-win stays reachable.

### Movement

`!!go <room>` in the game room. Dracula removes you from your current
compartment and invites you to the new one, so **moving is a single action for
the player** — otherwise six rooms means constant manual `/join` and `/part`,
which is miserable on a phone.

### Tasks

Each crewmate gets 3 tasks tied to specific compartments. `!!fix` in the right
room starts a 15-second micro-challenge: repeat a code, put wire colours in
order, unscramble a word.

**The alien gets a fake list of the same shape.** Their `!!tasks` looks normal
and their `!!fix` looks identical in public — it simply never counts.

### Meetings and voting

`!!report` (on a body) or `!!meeting` (once per player per game) pulls everyone
back to Cafeteria.

- 90 seconds of discussion, then 45 seconds of voting.
- `!!vote <nick>` or `!!vote skip`. Majority ejects; a tie skips.
- Votes are private until the reveal, so nobody can pile on late.
- Ghosts cannot vote or speak.

### Winning

- **Crew** — all tasks completed, or the alien is ejected.
- **Aliens** — aliens equal or outnumber the living crew, or a critical break
  runs out.

## Moderation while a game runs

- Auto-moderation is suspended in the game room and every compartment, so nobody
  is kicked mid-round by mistake.
- `!!mod on|off` is a separate master switch, usable any time.
- Two things stay on: **severe words** (slurs/hate) and **kick protection** for
  whitelisted users. Neither is a "kicked by mistake" risk.

## Still open

1. **Who can start a game?** Anyone, or admins only — a game starting in the
   middle of a serious conversation is the risk.
2. **Player count.** Suggest 4-12, with a second alien from 10 players up.
3. **A restart ends a game.** GitHub caps a run at ~6h and state is in memory. A
   round is ~15 minutes, so it will rarely bite, but it can.
4. **Confirm the kill rule.** Everything above rests on "alien and victim alone
   in the compartment". If you want kills possible in front of others, the game
   needs a different shape and I would want to rethink it with you.

---

# Review — what breaks, what's missing, what's free

## Things in the current bot that would break the game (verified in code)

1. **Raid guard would lock every compartment.** 6-12 players joining a new
   channel within seconds is exactly its trigger, so it would set `+i` and stop
   the game dead. Game channels must be exempt.
2. **`+m` for a "broken" room makes repair impossible.** A moderated channel
   silences everyone, so nobody can type `!!fix` in the room they are supposed
   to be fixing. Either repair from the game room (`!!fix reactor`), or Dracula
   voices whoever walks into a broken room. **This is a hard contradiction in
   my own design above and has to change.**
3. **Auto-voice fires in every opped channel.** Whitelisted players would get
   `+v` in all six compartments — MODE spam, and worse, in a broken (`+m`) room
   the whitelisted could still talk while everyone else could not. Disable it in
   game channels.
4. **No send rate-limiting anywhere.** `send()` writes straight to the socket.
   A 12-player start is ~12 role NOTICEs + 36 task lines + invites in one burst;
   InspIRCd will kill the connection for flooding. Needs an outbound queue at
   roughly 2 lines/second.
5. **A nick change mid-game breaks everything.** `NICK` is only tracked for the
   bot itself, so a player renaming would lose their tasks, their alive/dead
   state and their position. Must follow player `NICK` events.
6. **A crashed game leaves people muted.** Ghosts get `+q` in the VIP room; if
   the bot restarts mid-game that mute persists server-side with nothing to
   clear it. Needs cleanup on game end *and* a sweep on startup.

## Missing from the design

- **Task progress board.** Among Us lives on the task bar. Without a public
  "Tasks 7/15" the crew never feels the clock, and the alien never feels
  pressure to sabotage.
- **Alien disconnects.** Currently undefined. Simplest: crew wins.
- **Player reconnects.** Rejoining should re-invite them to where they were.
- **`!!players`** — who is alive, from anywhere.
- **First-minute kill protection**, so the game does not end 20 seconds in.

## Free wins the medium hands us

- **Channel topic as a live HUD.** Set the compartment topic to `BROKEN —
  repair needed` and the game room topic to `Tasks 7/15 · 6 alive · meeting in
  40s`. A persistent status board that costs nothing and survives scrollback.
- **`+m` plus voice for meetings.** During a vote, moderate the game room and
  voice only the living. The dead then *cannot* speak, enforced by the server
  rather than the honour system. This is the right place for `+m` — not for
  broken rooms.
- **Host-based alt detection.** `hostOf` already maps nick → user@host, so two
  nicks from one host can be blocked from joining the same game.
- **Registered-only games.** `accountOf` already knows who is identified to
  NickServ (via WHOX), so throwaway alts can be excluded in one line.
- **Groq for flavour.** Death lines, room descriptions and alien taunts, on a
  model already wired up with key failover. Cheap, and it makes the ship feel
  like a place.

---

# FINAL — decisions locked

**No AI anywhere.** The game is pure deterministic logic: roles, tasks, kills,
sabotage, meetings and voting need no model. Flavour text comes from static
lists. If Groq disappears entirely, the game is untouched, and moderation falls
back to the 60-word filter which is the layer doing most of the work anyway.

| Question | Decision | Why |
|---|---|---|
| Broken room | **Not `+m`.** Marked broken in state, channel topic shows `⚠ BROKEN`, repaired by `!!fix` inside it | `+m` silences the very people who must type `!!fix` |
| `+m` | Used **only during a vote**, voicing the living | Server-enforced silence for the dead at the one moment it matters |
| Raid guard | **Off in game channels** | 12 players joining at once is precisely its trigger |
| Auto-voice | **Off in game channels** | MODE spam, and it would privilege whitelisted players |
| Strict nicks / autoban | **Off in game channels** | No moderation inside the game, as you asked |
| Outbound flood | **Queue at ~2 lines/sec** | A 12-player start bursts ~50 lines; the server would drop us |
| Nick changes | **Tracked per player** | Otherwise a rename loses tasks, position and alive state |
| Cleanup | On game end **and** on bot startup | A crashed game must never leave someone muted |
| Kill rule | Alien and victim **alone** in a compartment | The medium shows everyone present; the whole game hangs on this |
| First 60s | **No kills** | Stops a round ending twenty seconds in |
| Players | 4-12, second alien at 10+ | |
| Who starts | Anyone, one game at a time, 10-minute cooldown; admins `!!endgame` | Keeps it fun without letting it interrupt constantly |
| Meeting room | `#🅱🅰🆃🅲🅰🆅🅴` | Discussion happens where the room already talks |
| Task board | Game room topic: `Tasks 7/15 · 6 alive` | Free persistent HUD |
| Alts | Two nicks from one host cannot both join | `hostOf` already knows |

## Cheating by private message — the honest position

**It cannot be prevented.** Two users PMing each other never touches the bot;
IRC gives no way to see or block that, and the bot deliberately does not read
DMs. Any claim to stop it would be false.

What is actually available:

- **The dead are the real risk** — a ghost telling a living friend who the alien
  is ends the round. The ghost room exists partly to satisfy that urge in a
  place that does no damage.
- **Announce the rule at game start.** "No private messages until the round
  ends." Most people follow a stated rule; the ones who do not are a social
  problem, not a technical one.
- **Alt detection is free** — one host cannot hold two seats in a game.
- **Keep rounds short.** A 15-minute round gives little room to coordinate
  privately, and the task clock rewards playing over scheming.
- **`!!endgame`** — an admin can void a round that was obviously spoiled.

Design so cheating is *unrewarding* rather than pretending it is impossible:
the crew's main win condition is finishing tasks, which no amount of DMing does
for them.
