'use strict';
// Fun commands for Dracula.
//
// Deliberately Groq-free: the AI quota is spent on moderation and runs out, and
// a joke bot that says "I'm rate limited" is not a joke bot. Everything here is
// local tables, so it works at 3am on an exhausted key.
//
// Two rules keep it from becoming noise:
//   - cooldowns, per nick and per channel, so nobody can wall the room with it
//   - silent in game channels, where !!commands mean something else

const COOLDOWN_NICK_MS = 15000;
const COOLDOWN_CHAN_MS = 4000;
const AMBIENT_GAP_MS = 10 * 60 * 1000;   // at most one unprompted quip per 10 min
const AMBIENT_CHANCE = 0.3;

// Colour codes, kept short. \x0304 = red, \x0306 = purple, \x03 = reset.
const RED = '\x0304';
const PURPLE = '\x0306';
const OFF = '\x03';

const BITES = Object.freeze([
    '{t} tastes of cold coffee and regret. 🦇',
    'sinks fangs into {t}... and immediately regrets it. Too much chai in the blood.',
    'bites {t}. {t} does not even look up from the keyboard.',
    'goes for {t}\'s neck, misses, headbutts a wall. Nobody saw that.',
    '{t} bites back. The vampire is filing a complaint.',
    'drinks from {t} and gets hiccups for four hundred years.',
    'bites {t}. Verdict: 6/10, needs salt.',
    'floats toward {t} dramatically, trips over the cape.',
    '{t} is now 3% vampire. The paperwork is enormous.',
    'refuses to bite {t}. Garlic. Everywhere. Have some self respect.',
]);

const SLAPS = Object.freeze([
    'slaps {t} with a wet bat. 🦇',
    'slaps {t} around a bit with a large trout. Tradition is tradition.',
    'slaps {t} with 400 years of unpaid rent.',
    'throws a coffin at {t}. It is lighter than it looks.',
    'slaps {t}. {t} thanks him. This is a strange room.',
    'winds up to slap {t}, gets distracted by the moon.',
]);

const EIGHTBALL = Object.freeze([
    'The bats say yes. The bats are usually drunk.',
    'No. And I say that with love.',
    'Ask again when the moon is out and I am less bored.',
    'Absolutely. Catastrophically. Yes.',
    'My crystal ball is buffering.',
    'It is written in the stars. The stars are wrong a lot.',
    'Haan bhai, obviously.',
    'Nahi. Sorry.',
    'I have seen the future and honestly it is mostly Tuesdays.',
    'Yes, but you will regret it in a fun way.',
    'The coffin says maybe. The coffin has trust issues.',
    'Do not make me answer that in front of everyone.',
]);

const FORTUNES = Object.freeze([
    'You will meet a tall dark stranger. It is me. I am right here.',
    'Something good happens Thursday. Do not ask me what, I am a bat not a calendar.',
    'Your next idea is brilliant. Your next three are not. Choose carefully.',
    'A message you are avoiding will not get less awkward.',
    'You will lose something small and find something smaller.',
    'Tonight: excellent. Tomorrow morning: legally distinct from excellent.',
    'Someone in this room is thinking about you. Statistically, someone always is.',
    'The stars align. Sadly they align into the shape of a shrug.',
    'Drink water. Four centuries of wisdom and that is genuinely the best I have.',
]);

const VIBES = Object.freeze([
    'The room reads: mildly cursed, in a good way.',
    'Vibe check: everyone is pretending to work. Including me.',
    'This channel smells like old wifi and ambition.',
    'The bats are calm. Suspiciously calm.',
    'Energy: two people arguing, six people watching, one asleep.',
    'The crypt is cozy tonight.',
    'Something is about to happen. Or nothing. Fifty fifty.',
    'Room temperature: haunted.',
]);

const TOMBSTONES = Object.freeze([
    'Here lies {t}. Typed too fast, thought too slow.',
    'RIP {t}. Loved by many, muted by one.',
    'Here lies {t}, who said "one more message" at 4am.',
    '{t}, gone but still in my logs. Forever. 🦇',
    'RIP {t}. Cause of death: the group chat.',
]);

// A vampire being personally insulted by the concept of morning is the joke that
// keeps giving, so this is the one thing the bot says unprompted.
const MORNING = Object.freeze([
    'Good morning is a threat and you know it.',
    'Morning? In THIS economy? In THIS sunlight?',
    'gm. I am typing this from inside a coffin, under a blanket, in the dark.',
    'The sun is out so I am legally required to be dramatic about it.',
]);
const NIGHT = Object.freeze([
    'Good night. Sleep well. Lock the window. No reason.',
    'gn! The rest of us are just getting started. 🦇',
    'Sleep. I will watch the room. That is not creepy, that is my job.',
    'Night. If you hear wings, ignore it.',
]);

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Stable hash: !!ship gives the same couple the same number forever, which is
// funnier than a re-roll and stops people spamming it for a better score.
function hashPct(a, b) {
    const s = [a.toLowerCase(), b.toLowerCase()].sort().join('&');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 101;
}

function shipVerdict(pct) {
    if (pct >= 95) return 'the prophecy is real. 🩸';
    if (pct >= 80) return 'genuinely worrying levels of chemistry.';
    if (pct >= 60) return 'promising. Keep the coffin warm.';
    if (pct >= 40) return 'it could work on a Tuesday.';
    if (pct >= 20) return 'the bats are looking away politely.';
    return 'no. The stars said no twice.';
}

class Fun {
    /**
     * @param {{say:Function, send:Function, nick:string}} bot
     * @param {(chan:string)=>boolean} isGameChannel  fun stays out of game rooms
     */
    constructor(bot, isGameChannel) {
        this.bot = bot;
        this.isGameChannel = isGameChannel || (() => false);
        this.enabled = true;
        this.lastByNick = new Map();     // nick(lower) -> ts
        this.lastByChan = new Map();     // chan(lower)  -> ts
        this.lastAmbient = new Map();    // chan(lower)  -> ts
    }

    /** An action ("/me ..."), which is how IRC does slapstick. */
    action(chan, text) { this.bot.send(`PRIVMSG ${chan} :\x01ACTION ${text}\x01`); }

    cooldownOk(chan, nick) {
        const now = Date.now();
        const n = nick.toLowerCase();
        const c = (chan || '').toLowerCase();
        if (now - (this.lastByNick.get(n) || 0) < COOLDOWN_NICK_MS) return false;
        if (now - (this.lastByChan.get(c) || 0) < COOLDOWN_CHAN_MS) return false;
        this.lastByNick.set(n, now);
        this.lastByChan.set(c, now);
        return true;
    }

    /**
     * @returns {boolean} true if this was a fun command (handled or swallowed)
     */
    handle(nick, chan, cmd, args) {
        const commands = ['bite', '8ball', 'ship', 'slap', 'fortune', 'rip', 'vibe'];
        if (!commands.includes(cmd)) return false;
        if (!this.enabled || this.isGameChannel(chan)) return true;   // swallow, stay quiet
        if (!this.cooldownOk(chan, nick)) return true;

        // Default target is the caller, so "!!bite" alone still does something.
        const target = (args[0] || nick).replace(/[^\w\[\]\\`^{}|-]/g, '').slice(0, 30) || nick;
        const self = this.bot.nick;

        switch (cmd) {
            case 'bite':
                this.action(chan, pick(BITES).split('{t}').join(target));
                return true;
            case 'slap':
                if (target.toLowerCase() === self.toLowerCase()) {
                    this.action(chan, `catches ${nick}'s hand mid-slap. Four hundred years of reflexes, my friend.`);
                    return true;
                }
                this.action(chan, pick(SLAPS).split('{t}').join(target));
                return true;
            case '8ball': {
                if (!args.length) { this.bot.say(chan, `${nick}: ask me something first. ${PURPLE}!!8ball will it rain${OFF}`); return true; }
                this.bot.say(chan, `🎱 ${nick}: ${pick(EIGHTBALL)}`);
                return true;
            }
            case 'ship': {
                const a = args[0] ? target : nick;
                const b = (args[1] || '').replace(/[^\w\[\]\\`^{}|-]/g, '').slice(0, 30);
                if (!b) { this.bot.say(chan, `${nick}: ${PURPLE}!!ship <nick> <nick>${OFF} — I need two victims.`); return true; }
                const pct = hashPct(a, b);
                this.bot.say(chan, `${RED}${a} + ${b}${OFF} — ${pct}% — ${shipVerdict(pct)}`);
                return true;
            }
            case 'fortune':
                this.bot.say(chan, `${PURPLE}🔮 ${nick}:${OFF} ${pick(FORTUNES)}`);
                return true;
            case 'rip':
                this.bot.say(chan, `🪦 ${pick(TOMBSTONES).split('{t}').join(target)}`);
                return true;
            case 'vibe':
                this.bot.say(chan, `🦇 ${pick(VIBES)}`);
                return true;
            default:
                return false;
        }
    }

    /**
     * Unprompted quips. Rare on purpose — a bot that talks over people stops
     * being funny fast, so this fires at most once every AMBIENT_GAP_MS per
     * channel and only for greetings, which are already small talk.
     */
    ambient(chan, nick, message) {
        if (!this.enabled || this.isGameChannel(chan)) return;
        const now = Date.now();
        const c = (chan || '').toLowerCase();
        if (now - (this.lastAmbient.get(c) || 0) < AMBIENT_GAP_MS) return;

        const t = message.toLowerCase();
        const isMorning = /\b(good\s*morning|gm|gud\s*mrng|subah)\b/.test(t);
        const isNight = /\b(good\s*night|gn|gud\s*night|shubh\s*ratri)\b/.test(t);
        if (!isMorning && !isNight) return;
        if (Math.random() > AMBIENT_CHANCE) return;

        this.lastAmbient.set(c, now);
        this.bot.say(chan, pick(isMorning ? MORNING : NIGHT));
    }
}

module.exports = { Fun, hashPct };
