'use strict';
// Simple party games, hosted in the games room (#batcave-games) — separate from
// findit.js, which is one specific multi-room game. These are the small,
// single-room ones ported from the Vampire bot: a number guess to start, with
// hangman and scramble to follow on the same shape.
//
// Two entry points, mirroring findit's:
//   handle(nick, chan, cmd, args)  — an !! command (starts/stops a game)
//   onMessage(nick, chan, text)    — a plain line, checked as a guess while a
//                                    game is live in the games room
//
// A game command used OUTSIDE the games room does not start a game there and
// then talk to an empty room — it INVITES the caller to the games room, because
// that is where games belong (the owner's call). The room is invite-only in
// practice, so the invite is how you actually get in.

const GAME_ROOM = (process.env.FINDIT_ROOM || '#batcave-games').trim();

function norm(s) { return String(s || '').toLowerCase(); }

class Games {
    constructor(bot) {
        this.bot = bot;
        this.room = GAME_ROOM;
        // Per-room state so a game is scoped to the room it runs in.
        this.numguess = new Map();   // chan -> { answer, tries, by }
    }

    isGameChannel(c) { return norm(c) === norm(this.room); }

    say(msg) { this.bot.say(this.room, msg); }

    /** An !! command. Returns true if we handled it. */
    handle(nick, chan, cmd, args) {
        if (cmd === 'endgame' || cmd === 'endguess') {
            if (!this.isGameChannel(chan)) return false;
            if (!this.stop(chan)) this.say('No game is running.');
            return true;
        }
        if (cmd !== 'numguess' && cmd !== 'guessnumber') return false;

        // Not in the games room: send them there instead of starting a game in
        // the wrong place.
        if (!this.isGameChannel(chan)) {
            this.bot.send(`INVITE ${nick} ${this.room}`);
            this.bot.notice(nick, `Games are in ${this.room} — I've invited you. Run it there.`);
            return true;
        }

        const key = norm(chan);
        if (this.numguess.has(key)) {
            this.say(`A number game is already running — guess between 1 and 100.`);
            return true;
        }
        const answer = 1 + Math.floor(Math.random() * 100);
        this.numguess.set(key, { answer, tries: 0, by: nick });
        this.say(`\x02Number guess!\x03 I'm thinking of a number from 1 to 100. `
            + `Type your guesses — I'll say higher or lower. \x02!!endgame\x03 to stop.`);
        return true;
    }

    /** Stop whatever game is running in this room. */
    stop(chan) {
        const key = norm(chan);
        if (this.numguess.has(key)) {
            const { answer } = this.numguess.get(key);
            this.numguess.delete(key);
            this.say(`Game over — the number was \x02${answer}\x02.`);
            return true;
        }
        return false;
    }

    /** A plain room line, checked as a guess. Returns true if it was a guess we
     *  consumed (so the caller can stop processing it as chat). */
    onMessage(nick, chan, text) {
        if (!this.isGameChannel(chan)) return false;
        const key = norm(chan);
        const g = this.numguess.get(key);
        if (!g) return false;
        const m = String(text).trim().match(/^(\d{1,3})$/);
        if (!m) return false;                 // not a bare number — leave it as chat
        const guess = parseInt(m[1], 10);
        if (guess < 1 || guess > 100) return false;
        g.tries += 1;
        if (guess === g.answer) {
            this.numguess.delete(key);
            this.say(`\x02${nick}\x02 got it — ${g.answer}! (${g.tries} guesses)`);
        } else {
            this.say(`${guess}? ${guess < g.answer ? 'Higher' : 'Lower'}.`);
        }
        return true;
    }
}

module.exports = { Games };
