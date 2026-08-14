'use strict';
/**
 * findit.js — a hidden-traitor game ("Findit") for an IRC channel.
 *
 * The design leans on what a chatroom actually gives you: being in a channel IS
 * being in a room, and the member list IS your line of sight. Every rule below
 * follows from that rather than from copying a game built around a map.
 *
 * No AI is used anywhere. Roles, tasks, kills, sabotage and voting are all
 * deterministic, so the game is unaffected if the Groq key ever goes away.
 */

const ROOMS = ['Cafeteria', 'Reactor', 'Electrical', 'MedBay', 'Oxygen', 'Navigation'];
const CRITICAL = new Set(['reactor', 'oxygen']);   // breaking these starts a countdown
const GHOSTS = 'Ghosts';

const num = (name, dflt) => parseInt(process.env[name] || String(dflt), 10);
const LOBBY_SECS = num('FINDIT_LOBBY_SECS', 90);
const GRACE_SECS = num('FINDIT_GRACE_SECS', 60);      // no kills at the very start
const KILL_COOLDOWN = num('FINDIT_KILL_CD', 45) * 1000;
const BREAK_COOLDOWN = num('FINDIT_BREAK_CD', 90) * 1000;
const CRITICAL_SECS = num('FINDIT_CRITICAL_SECS', 90);
const DISCUSS_SECS = num('FINDIT_DISCUSS_SECS', 90);
const VOTE_SECS = num('FINDIT_VOTE_SECS', 45);
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 12;
const TASKS_EACH = 3;
const GAME_COOLDOWN = num('FINDIT_GAME_CD_MIN', 10) * 60 * 1000;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const chanKeyOf = (c) => (c || '').toLowerCase();
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const code = (n = 5) => Array.from({ length: n }, () => pick(CODE_CHARS.split(''))).join('');

const DEATHS = [
    'was found cold in the dark.',
    'never made it to the next shift.',
    'is not answering the comms.',
    'left only a smear on the bulkhead.',
];

class FindIt {
    constructor(bot) {
        this.bot = bot;
        this.reset();
        this.lastGameEnded = 0;
    }

    reset() {
        this.active = false;
        this.phase = 'idle';          // idle | lobby | running | voting
        this.id = null;
        this.room = null;             // the public channel the game is hosted in
        this.players = new Map();     // nick(lower) -> player
        this.bodies = new Map();      // roomKey -> [nick]
        this.broken = null;           // { room, critical, at }
        this.votes = new Map();       // voter(lower) -> target(lower) | 'skip'
        this.tasksDone = 0;
        this.tasksTotal = 0;
        this.startedAt = 0;
        this.lastBreak = 0;
        this.clearTimers();
    }

    clearTimers() {
        for (const t of (this.timers || [])) clearTimeout(t);
        this.timers = [];
    }
    later(fn, ms) { this.timers.push(setTimeout(fn, ms)); }

    // ── channel naming ───────────────────────────────────────────────────
    chan(room) { return `#${room}-${this.id}`; }
    /** Every channel this game owns, for moderation exemption and cleanup. */
    isGameChannel(c) {
        if (!this.id) return false;
        return new RegExp(`^#(${[...ROOMS, GHOSTS].join('|')})-${this.id}$`, 'i').test(c || '');
    }
    /** Which compartment a channel is, or '' if it isn't one. */
    roomOf(c) {
        const m = (c || '').match(/^#([A-Za-z]+)-(\d+)$/);
        return (m && String(m[2]) === String(this.id)) ? m[1].toLowerCase() : '';
    }

    // ── helpers ──────────────────────────────────────────────────────────
    p(nick) { return this.players.get((nick || '').toLowerCase()); }
    living() { return [...this.players.values()].filter((x) => x.alive); }
    aliens() { return this.living().filter((x) => x.alien); }
    crew() { return this.living().filter((x) => !x.alien); }
    say(msg) { this.bot.say(this.room, msg); }
    tell(nick, msg) { this.bot.notice(nick, msg); }

    /** Who is currently inside a compartment, players only. */
    occupants(roomKey) {
        return this.living().filter((x) => x.room === roomKey);
    }

    // ── lobby ────────────────────────────────────────────────────────────
    open(nick, chan) {
        if (this.active) { this.say('A game is already running. !!endgame to stop it.'); return; }
        const since = Date.now() - this.lastGameEnded;
        if (this.lastGameEnded && since < GAME_COOLDOWN) {
            this.bot.say(chan, `The ship is still being cleaned — try again in `
                + `${Math.ceil((GAME_COOLDOWN - since) / 60000)}m.`);
            return;
        }
        this.reset();
        this.active = true;
        this.phase = 'lobby';
        this.id = 1000 + rnd(9000);
        this.room = chan;

        // Creating a channel makes us its operator, which is how we get to run it.
        // One JOIN for all of them: seven separate lines is a burst the outbound
        // queue then has to drip out, which delays the whole game start.
        this.bot.send(`JOIN ${[...ROOMS, GHOSTS].map((r) => this.chan(r)).join(',')}`);
        for (const r of [...ROOMS, GHOSTS]) {
            this.bot.send(`MODE ${this.chan(r)} +is`);   // invite-only + secret
        }

        this.say(`\x0304🚀 FINDIT\x03 — the ship \x02${this.id}\x02 is boarding. `
            + `Type \x02!!join\x02 to come aboard (${LOBBY_SECS}s). `
            + `${MIN_PLAYERS}-${MAX_PLAYERS} crew. One of you will not be crew.`);
        this.say('House rule: \x02no private messages until the round ends\x02 — '
            + 'the bot cannot see them, so this one is on your honour.');
        this.later(() => { if (this.phase === 'lobby') this.start(nick); }, LOBBY_SECS * 1000);
    }

    join(nick, host) {
        if (this.phase !== 'lobby') return;
        const k = nick.toLowerCase();
        if (this.players.has(k)) { this.tell(nick, 'You are already aboard.'); return; }
        if (this.players.size >= MAX_PLAYERS) { this.tell(nick, 'The ship is full.'); return; }

        // One host, one seat: stops somebody playing themselves on two nicks.
        const hostPart = (h) => String(h || '').split('@').pop().toLowerCase();
        if (host) {
            for (const p of this.players.values()) {
                if (p.host && hostPart(p.host) === hostPart(host)) {
                    this.tell(nick, 'Someone from your connection is already playing.');
                    return;
                }
            }
        }
        this.players.set(k, {
            nick, host: host || '', alive: true, alien: false,
            tasks: [], room: '', meetingUsed: false, lastKill: 0,
        });
        this.say(`\x0303${nick}\x03 boards the ship. (${this.players.size} aboard)`);
    }

    // ── start ────────────────────────────────────────────────────────────
    start(byNick) {
        if (this.phase !== 'lobby') return;
        if (this.players.size < MIN_PLAYERS) {
            this.say(`Not enough crew (${this.players.size}/${MIN_PLAYERS}). The launch is scrubbed.`);
            this.end(null, 'not enough players');
            return;
        }
        this.phase = 'running';
        this.startedAt = Date.now();

        const all = [...this.players.values()];
        const alienCount = all.length >= 10 ? 2 : 1;
        for (let i = 0; i < alienCount; i++) {
            const candidates = all.filter((x) => !x.alien);
            pick(candidates).alien = true;
        }

        // Tasks. The alien gets a list of the same shape so !!tasks looks normal.
        const work = ROOMS.filter((r) => r !== 'Cafeteria');
        for (const p of all) {
            const shuffled = [...work].sort(() => Math.random() - 0.5);
            p.tasks = shuffled.slice(0, TASKS_EACH).map((r) => ({ room: r.toLowerCase(), done: false }));
            if (!p.alien) this.tasksTotal += TASKS_EACH;
        }

        this.say(`\x0304The airlock seals.\x03 ${all.length} aboard, `
            + `\x02${alienCount}\x02 of you are not crew. Check your private notice. `
            + `No kills for the first ${GRACE_SECS}s. `
            + 'Move \x02!!go <room>\x02 · work \x02!!fix\x02 · \x02!!report\x02 a body · '
            + '\x02!!meeting\x02 to call everyone back.');
        this.updateBoard();

        for (const p of all) {
            const list = p.tasks.map((t) => t.room).join(', ');
            if (p.alien) {
                const mates = this.aliens().filter((x) => x.nick !== p.nick).map((x) => x.nick);
                this.tell(p.nick, `\x0304You are the ALIEN.\x03 Cover tasks: ${list} `
                    + '(!!fix looks real but never counts). \x02!!kill <nick>\x02 only when ALONE '
                    + `with them · \x02!!break <room>\x02 to sabotage.`
                    + (mates.length ? ` Fellow alien: ${mates.join(', ')}` : ''));
            } else {
                this.tell(p.nick, `\x0303You are CREW.\x03 Tasks: ${list}. `
                    + '\x02!!go <room>\x02 to move, \x02!!fix\x02 to work.');
            }
            this.invite(p.nick, 'cafeteria');
        }

    }

    // ── movement ─────────────────────────────────────────────────────────
    invite(nick, roomKey) {
        this.bot.send(`INVITE ${nick} ${this.chan(this.roomName(roomKey))}`);
    }
    roomName(key) {
        return ROOMS.find((r) => r.toLowerCase() === key) || 'Cafeteria';
    }

    go(nick, arg) {
        const p = this.p(nick);
        if (!p || !p.alive || this.phase !== 'running') return;
        const key = (arg || '').toLowerCase();
        if (!ROOMS.some((r) => r.toLowerCase() === key)) {
            this.tell(nick, `Rooms: ${ROOMS.join(', ')}`);
            return;
        }
        if (p.room === key) { this.tell(nick, 'You are already there.'); return; }
        this.invite(nick, key);
        this.tell(nick, `Invited to ${this.roomName(key)} — join it and you are there.`);
    }

    /** A player entered one of our compartments. */
    onJoin(nick, chan) {
        const roomKey = this.roomOf(chan);
        if (!roomKey || roomKey === GHOSTS.toLowerCase()) return;
        const p = this.p(nick);
        if (!p || !p.alive) return;

        // Position must be unambiguous, or being "alone" means nothing. Remove
        // them from wherever they were.
        if (p.room && p.room !== roomKey) {
            this.bot.send(`KICK ${this.chan(this.roomName(p.room))} ${nick} :moving to ${this.roomName(roomKey)}`);
        }
        p.room = roomKey;

        const found = this.bodies.get(roomKey) || [];
        if (found.length) {
            this.tell(nick, `\x0304You find ${found.join(' and ')} dead here.\x03 `
                + '\x02!!report\x02 to call it in — or say nothing.');
        }
        if (this.broken && this.broken.room === roomKey) {
            this.tell(nick, `This compartment is \x0304BROKEN\x03 — type \x02!!fix\x02 to repair it.`);
        }
    }

    onPart(nick, chan) {
        const roomKey = this.roomOf(chan);
        const p = this.p(nick);
        if (p && roomKey && p.room === roomKey) p.room = '';
    }

    /** Nick changes would otherwise lose the player entirely. */
    onNick(oldNick, newNick) {
        const k = oldNick.toLowerCase();
        const p = this.players.get(k);
        if (!p) return;
        this.players.delete(k);
        p.nick = newNick;
        this.players.set(newNick.toLowerCase(), p);
        for (const [room, list] of this.bodies) {
            this.bodies.set(room, list.map((n) => (n.toLowerCase() === k ? newNick : n)));
        }
    }

    onQuit(nick) {
        const p = this.p(nick);
        if (!p || !this.active) return;
        if (p.alive) {
            p.alive = false;
            this.say(`\x0314${p.nick} has left the ship.\x03`);
            this.releaseTasks(p);
            this.checkWin();
        }
    }

    // ── tasks ────────────────────────────────────────────────────────────
    fix(nick, chan, arg) {
        const p = this.p(nick);
        if (!p || !p.alive || this.phase !== 'running') return;
        const roomKey = this.roomOf(chan);
        if (!roomKey) { this.tell(nick, 'Do that inside a compartment.'); return; }

        // Repairing sabotage takes priority over personal tasks.
        if (this.broken && this.broken.room === roomKey) {
            this.repair(nick);
            return;
        }

        const task = p.tasks.find((t) => t.room === roomKey && !t.done);
        if (!task) { this.tell(nick, 'Nothing here for you to do.'); return; }

        if (!arg) {
            task.code = code();
            this.tell(nick, `Enter the panel code: \x02!!fix ${task.code}\x02`);
            return;
        }
        if (!task.code || arg.toUpperCase() !== task.code) {
            this.tell(nick, 'Wrong code. \x02!!fix\x02 to try again.');
            return;
        }
        task.done = true;
        task.code = null;

        // The alien's work never counts, but it looks identical in the room.
        if (!p.alien) {
            this.tasksDone += 1;
            this.updateBoard();
        }
        this.bot.say(chan, `${nick} completes a repair.`);
        this.tell(nick, `Done. ${p.tasks.filter((t) => !t.done).length} left.`);
        if (!p.alien) this.checkWin();
    }

    releaseTasks(p) {
        if (p.alien) return;
        const left = p.tasks.filter((t) => !t.done).length;
        this.tasksTotal = Math.max(this.tasksDone, this.tasksTotal - left);
        this.updateBoard();
    }

    updateBoard() {
        if (!this.active) return;
        this.bot.send(`TOPIC ${this.room} :Findit ${this.id} · Tasks `
            + `${this.tasksDone}/${this.tasksTotal} · ${this.living().length} alive`);
    }

    // ── killing ──────────────────────────────────────────────────────────
    kill(nick, chan, targetNick) {
        const killer = this.p(nick);
        if (!killer || !killer.alive || !killer.alien || this.phase !== 'running') return;
        const roomKey = this.roomOf(chan);
        if (!roomKey) { this.tell(nick, 'Kill from inside a compartment.'); return; }

        if (Date.now() - this.startedAt < GRACE_SECS * 1000) {
            this.tell(nick, 'Too early — the crew are still all watching each other.');
            return;
        }
        if (Date.now() - killer.lastKill < KILL_COOLDOWN) {
            this.tell(nick, `Not yet. ${Math.ceil((KILL_COOLDOWN - (Date.now() - killer.lastKill)) / 1000)}s.`);
            return;
        }
        const victim = this.p(targetNick);
        if (!victim || !victim.alive || victim.alien) { this.tell(nick, 'Not a valid target.'); return; }
        if (victim.room !== roomKey) { this.tell(nick, 'They are not in here with you.'); return; }

        // The rule the medium forces: everyone in a channel is visible, so a kill
        // in front of witnesses would name the alien instantly.
        const here = this.occupants(roomKey);
        if (here.length !== 2) {
            this.tell(nick, `You are not alone with them — ${here.length} people are here.`);
            return;
        }

        killer.lastKill = Date.now();
        victim.alive = false;
        victim.room = '';
        this.bodies.set(roomKey, [...(this.bodies.get(roomKey) || []), victim.nick]);
        this.releaseTasks(victim);
        this.toGhost(victim.nick, roomKey);
        this.tell(victim.nick, `\x0304You are dead.\x03 ${pick(DEATHS)} `
            + 'Talk in the ghost room — and stay silent among the living.');
        this.tell(nick, `Done. ${victim.nick} is down in ${this.roomName(roomKey)}.`);
        this.checkWin();
    }

    toGhost(nick, fromRoom) {
        if (fromRoom) this.bot.send(`KICK ${this.chan(this.roomName(fromRoom))} ${nick} :...`);
        this.bot.send(`INVITE ${nick} ${this.chan(GHOSTS)}`);
        // Quiet, not moderated: +q affects only this player, so the rest of the
        // room is untouched and nothing is left broken if the bot restarts.
        this.bot.send(`MODE ${this.room} +q ${nick}!*@*`);
        this.updateBoard();
    }

    // ── sabotage ─────────────────────────────────────────────────────────
    break_(nick, arg) {
        const p = this.p(nick);
        if (!p || !p.alive || !p.alien || this.phase !== 'running') return;
        if (this.broken) { this.tell(nick, 'Something is already broken.'); return; }
        if (Date.now() - this.lastBreak < BREAK_COOLDOWN) {
            this.tell(nick, `Systems still resetting — ${Math.ceil((BREAK_COOLDOWN - (Date.now() - this.lastBreak)) / 1000)}s.`);
            return;
        }
        const key = (arg || '').toLowerCase();
        if (!ROOMS.some((r) => r.toLowerCase() === key) || key === 'cafeteria') {
            this.tell(nick, `Break one of: ${ROOMS.filter((r) => r !== 'Cafeteria').join(', ')}`);
            return;
        }
        this.lastBreak = Date.now();
        const critical = CRITICAL.has(key);
        this.broken = { room: key, critical, at: Date.now() };

        // Marked in state and in the topic — NOT +m, which would silence the very
        // people who have to type !!fix in there.
        this.bot.send(`TOPIC ${this.chan(this.roomName(key))} :⚠ BROKEN — someone type !!fix`);
        this.say(`\x0304⚠ ${this.roomName(key)} has been sabotaged!\x03 `
            + (critical
                ? `Repair it within ${CRITICAL_SECS}s or the ship is lost.`
                : 'Tasks there are blocked until it is repaired.'));

        if (critical) {
            this.later(() => {
                if (this.broken && this.broken.room === key) this.end('aliens', `${this.roomName(key)} was never repaired`);
            }, CRITICAL_SECS * 1000);
        }
    }

    repair(nick) {
        if (!this.broken) return;
        const room = this.broken.room;
        this.broken = null;
        this.bot.send(`TOPIC ${this.chan(this.roomName(room))} :${this.roomName(room)}`);
        this.say(`\x0303${nick} repaired ${this.roomName(room)}.\x03`);
    }

    // ── meetings and voting ──────────────────────────────────────────────
    report(nick, chan) {
        const p = this.p(nick);
        if (!p || !p.alive || this.phase !== 'running') return;
        const roomKey = this.roomOf(chan);
        const found = this.bodies.get(roomKey) || [];
        if (!found.length) { this.tell(nick, 'There is no body here.'); return; }
        this.bodies.delete(roomKey);
        this.meeting(nick, `${found.join(' and ')} found dead in ${this.roomName(roomKey)}`);
    }

    emergency(nick) {
        const p = this.p(nick);
        if (!p || !p.alive || this.phase !== 'running') return;
        if (p.meetingUsed) { this.tell(nick, 'You have already called one this game.'); return; }
        p.meetingUsed = true;
        this.meeting(nick, 'called an emergency meeting');
    }

    meeting(caller, reason) {
        this.phase = 'voting';
        this.votes.clear();

        // Everyone back to the main room: clear the compartments.
        for (const p of this.living()) {
            if (p.room) this.bot.send(`KICK ${this.chan(this.roomName(p.room))} ${p.nick} :meeting`);
            p.room = '';
        }
        this.say(`\x0304🔔 ${caller} ${reason}.\x03 Everyone to ${this.room}. `
            + `${DISCUSS_SECS}s to talk, then voting.`);
        this.say(`Alive: ${this.living().map((x) => x.nick).join(', ')}`);

        this.later(() => {
            if (this.phase !== 'voting') return;
            this.say(`\x0304Voting is open\x03 for ${VOTE_SECS}s — \x02!!vote <nick>\x02 or \x02!!vote skip\x02. `
                + 'Votes stay hidden until the count.');
            this.later(() => this.tally(), VOTE_SECS * 1000);
        }, DISCUSS_SECS * 1000);
    }

    vote(nick, arg) {
        const p = this.p(nick);
        if (!p || !p.alive || this.phase !== 'voting') return;
        const t = (arg || '').toLowerCase();
        if (t === 'skip') { this.votes.set(nick.toLowerCase(), 'skip'); this.tell(nick, 'Vote recorded: skip.'); return; }
        const target = this.p(t);
        if (!target || !target.alive) { this.tell(nick, 'Not someone you can vote for.'); return; }
        this.votes.set(nick.toLowerCase(), t);
        this.tell(nick, `Vote recorded: ${target.nick}.`);
        if (this.votes.size >= this.living().length) this.tally();
    }

    tally() {
        if (this.phase !== 'voting') return;
        const counts = new Map();
        for (const v of this.votes.values()) counts.set(v, (counts.get(v) || 0) + 1);

        let top = null, tie = false;
        for (const [who, n] of counts) {
            if (!top || n > counts.get(top)) { top = who; tie = false; }
            else if (n === counts.get(top)) tie = true;
        }
        const lines = [...counts.entries()]
            .map(([who, n]) => `${who === 'skip' ? 'skip' : (this.p(who) || {}).nick || who}: ${n}`)
            .join(' · ');
        this.say(`\x02Votes\x03 — ${lines || 'nobody voted'}`);

        this.phase = 'running';
        if (!top || top === 'skip' || tie) {
            this.say('No one is ejected.');
            this.checkWin();
            return;
        }
        const out = this.p(top);
        out.alive = false;
        this.releaseTasks(out);
        this.toGhost(out.nick, out.room);
        this.say(`\x0304${out.nick} is ejected.\x03 They were `
            + `\x02${out.alien ? 'the ALIEN' : 'crew'}\x02.`);
        this.checkWin();
    }

    // ── win conditions ───────────────────────────────────────────────────
    checkWin() {
        if (!this.active || this.phase === 'lobby') return;
        if (this.tasksTotal > 0 && this.tasksDone >= this.tasksTotal) { this.end('crew', 'every task was finished'); return; }
        if (!this.aliens().length) { this.end('crew', 'the alien is gone'); return; }
        if (this.aliens().length >= this.crew().length) { this.end('aliens', 'the aliens outnumber the crew'); return; }
    }

    end(winner, reason) {
        if (!this.active) return;
        const aliens = [...this.players.values()].filter((x) => x.alien).map((x) => x.nick);
        if (winner) {
            this.say(`\x0304=== ${winner === 'crew' ? 'CREW WIN' : 'ALIENS WIN'} ===\x03 ${reason}.`);
            if (aliens.length) this.say(`The alien${aliens.length > 1 ? 's were' : ' was'}: \x02${aliens.join(', ')}\x02`);
        }
        this.cleanup();
        this.lastGameEnded = Date.now();
        this.reset();
    }

    /** Undo everything we did to the room — quiets especially. */
    cleanup() {
        for (const p of this.players.values()) {
            this.bot.send(`MODE ${this.room} -q ${p.nick}!*@*`);
        }
        if (this.room) this.bot.send(`TOPIC ${this.room} :`);
        for (const r of [...ROOMS, GHOSTS]) this.bot.send(`PART ${this.chan(r)} :game over`);
    }

    /**
     * A crashed game would otherwise leave channels behind and, worse, players
     * quieted with nothing left to clear them. Called on connect.
     */
    sweep(joinedChannels) {
        for (const c of joinedChannels) {
            if (/^#(Cafeteria|Reactor|Electrical|MedBay|Oxygen|Navigation|Ghosts)-\d+$/i.test(c)) {
                this.bot.send(`PART ${c} :stale game`);
            }
        }
    }

    // ── surviving a disconnect ───────────────────────────────────────────
    /**
     * Two very different failures, so two answers:
     *
     *  - The SOCKET drops but the process lives (ping timeout, netsplit — the
     *    common case). Game state is still in memory, so the round can carry on:
     *    rejoin the ship, re-invite everyone to where they were, resume.
     *  - The PROCESS restarts (GitHub's 6h job handoff). Memory is gone and the
     *    round cannot be recovered, so the job is to fail cleanly and loudly
     *    rather than leave people muted with a half-built ship around them.
     */
    onDisconnect() {
        if (!this.active) return;
        this.droppedAt = Date.now();
        this.clearTimers();          // do not let a vote tally while we are away
    }

    /** Called once we are registered again, in the same process. */
    onReconnect() {
        if (!this.active) return;
        const away = Date.now() - (this.droppedAt || Date.now());
        this.droppedAt = 0;

        // Away long enough that players have wandered off — end it honestly.
        if (away > 3 * 60 * 1000) {
            this.say('\x0304The ship lost power for too long.\x03 This round is void — '
                + 'nobody wins. Quiets and rooms have been cleared.');
            this.end(null, 'connection lost');
            return;
        }

        this.bot.send(`JOIN ${[...ROOMS, GHOSTS].map((r) => this.chan(r)).join(',')}`);
        for (const r of [...ROOMS, GHOSTS]) this.bot.send(`MODE ${this.chan(r)} +is`);

        // Put everyone back where they were standing.
        for (const p of this.players.values()) {
            if (!p.alive) { this.bot.send(`INVITE ${p.nick} ${this.chan(GHOSTS)}`); continue; }
            // Anyone not yet in a compartment goes back to Cafeteria rather than
            // being left outside the ship with no way in.
            this.invite(p.nick, p.room || 'cafeteria');
        }
        this.say(`\x0303Reconnected — the round continues.\x03 `
            + `${this.living().length} alive, tasks ${this.tasksDone}/${this.tasksTotal}. `
            + 'You may need to rejoin your compartment.');
        this.updateBoard();

        // A vote that was in flight cannot be trusted after a blackout.
        if (this.phase === 'voting') {
            this.phase = 'running';
            this.votes.clear();
            this.say('The vote was interrupted and has been cancelled.');
        }
    }

    /**
     * Cold start: the process restarted, so any round is unrecoverable. We
     * cannot know who was quieted (that state died with the old process), so
     * ask the server for the quiet list and clear the nick-shaped masks we set.
     */
    coldStart(gameRoom) {
        if (!gameRoom) return;
        this.bot.send(`MODE ${gameRoom} +q`);      // ask for the list; replies are handled below
        this.pendingQuietSweep = gameRoom.toLowerCase();
    }

    /** A quiet-list entry from the server during a cold-start sweep. */
    onQuietEntry(chan, mask) {
        if (!this.pendingQuietSweep || chanKeyOf(chan) !== this.pendingQuietSweep) return;
        // Only ever remove the exact shape this game sets: "nick!*@*".
        if (/^[^!]+!\*@\*$/.test(mask)) this.bot.send(`MODE ${chan} -q ${mask}`);
    }
    endQuietSweep() { this.pendingQuietSweep = null; }

    // ── command router ───────────────────────────────────────────────────
    /** Returns true when the command belonged to the game. */
    handle(nick, chan, cmd, args, host) {
        // These two must work before a game exists, or nothing can ever start.
        if (cmd === 'findit') { this.open(nick, chan); return true; }
        if (cmd === 'endgame') {
            if (this.active) { this.end(null, 'stopped'); this.bot.say(chan, 'Game stopped.'); }
            return true;
        }

        const inGame = this.isGameChannel(chan);
        const inRoom = this.room && chan.toLowerCase() === this.room.toLowerCase();
        if (!this.active || (!inGame && !inRoom)) return false;

        switch (cmd) {
            case 'join':
                if (this.phase === 'lobby' && !args.length) { this.join(nick, host); return true; }
                return false;                       // fall through to the admin !!join #room
            case 'start': this.start(nick); return true;
            case 'go': this.go(nick, args[0]); return true;
            case 'fix': this.fix(nick, chan, args[0]); return true;
            case 'kill': this.kill(nick, chan, args[0]); return true;
            case 'break': this.break_(nick, args[0]); return true;
            case 'report': this.report(nick, chan); return true;
            case 'meeting': this.emergency(nick); return true;
            case 'vote': this.vote(nick, args[0]); return true;
            case 'tasks': {
                const p = this.p(nick);
                if (p) {
                    const left = p.tasks.filter((t) => !t.done).map((t) => this.roomName(t.room));
                    this.tell(nick, left.length ? `Remaining: ${left.join(', ')}` : 'All your tasks are done.');
                }
                return true;
            }
            case 'players':
                if (this.active) this.say(`Alive: ${this.living().map((x) => x.nick).join(', ') || 'nobody'}`);
                return true;
            default: return false;
        }
    }
}

module.exports = { FindIt, ROOMS };
