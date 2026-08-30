'use strict';
// Solicitation, which a word list cannot see.
//
// Vampire sat in #allindiachat.com for a few hours and the finding was not
// what anyone expected: that room barely swears. What it does is advertise —
//
//   "Any female want to see n help me cum"
//   "Any real delhi ncr female...who likes golden shower ping me"
//   "M 23, my cam your voice"
//   "Mallu f pic chat"
//   "500 for 1 hour video call"
//   "House wife s and little girls dm me"
//
// Every one of those passed straight through the profanity filter, because
// almost none of it is profanity. It is a SHAPE: somebody looking, a gender to
// look for, and a medium to do it in. That shape is what this reads.
//
// THE FALSE POSITIVE IS THE WHOLE PROBLEM. "anyone free for a video call?" is
// an ordinary sentence in an ordinary room, and a filter that removes people
// for saying it is worse than no filter — the owner has already had regulars
// warned for typing "idiot". So the rule is deliberately narrow:
//
//   a TARGET (a gender being sought) must be present, plus TWO more distinct
//   signals — or a PRICE, which needs no target because nothing innocent
//   quotes an hourly rate in a chatroom.
//
// Checked against 436 real messages from #batcave: see the tests.

// Someone looking for someone.
const SEEK = /\b(any|anyone|any1|koi|looking|look|want|wants|wanted|need|needs|dm|pm|ping|inbox|hmu|msg|message|available|free)\b/i;

// The gender being sought. A bare "f" or "m" counts — it is how these adverts
// are written — but only as a standalone token, never inside a word.
// A bare "m" or "f" counts — it is how these adverts are written — but NOT
// when a number is sitting in front of it. "10 m", "2 f" and "30 m" are
// quantities in Hinglish, and reading them as a gender being sought is what
// turned "for 10 minutes" into a solicitation.
const TARGET_WORDS = /\b(female|females|girl|girls|ladki|ladkiya|woman|women|lady|ladies|aunty|aunti|bhabhi|wife|wifes|milf|male|males|guy|guys|boy|boys|couple|couples)\b/i;
const BARE_MARK = /(^|[^a-z0-9])(?<!\d\s)[mf](?![a-z0-9])/i;
const TARGET = {
    test(t) {
        const s = String(t || '');
        if (TARGET_WORDS.test(s)) return true;
        // Strip "<digits> m/f" first, then look for a standalone marker.
        return BARE_MARK.test(s.replace(/\b\d{1,3}\s?[mf]\b/gi, ' '));
    },
};

// What is being offered or asked for.
const MEDIA = /\b(cam|cams|webcam|pic|pics|photo|photos|video|videos|vid|vids|snap|selfie|nude|nudes)\b/i;
// "dm me" is both the asking and the offer, which is why it counts twice and
// why leaving it out of here let "House wife s and little girls dm me" score
// only two and pass.
const CONTACT = /\b(chat|chatting|call|calling|meet|meetup|meeting|host|hosting|session|service|services|fun|fun2|enjoy|company|dm|pm|inbox|hmu|whatsapp|telegram|snap|snapchat)\b/i;

// Unambiguous. Present alongside the rest, this is not a misreading.
const EXPLICIT = /\b(cum|cumming|sex|sexy|sexting|porn|horny|nude|naked|boobs|titties|tits|dick|cock|pussy|bbc|blowjob|suck|fuck|fucking|jerk|jerking|masturbat\w*|golden\s*shower|cuckold|cuck|threesome|hookup|escort|paid|payment)\b/i;

// "23 M", "M23", "f 25" — how these adverts introduce themselves.
// An age has to be a plausible age, and must not be a QUANTITY.
//
// "10 m ke liye" — Hinglish for "for 10 minutes" — was read as "age 10, male"
// and, with a bare "m" also counting as a gender sought, scored 4 and got the
// speaker kicked for advertising. He was explaining that somebody had abused
// him. Two separate mistakes in one short phrase:
//
//   - 10 is not an age anybody advertises; adults in these rooms write 18-69
//   - a number followed by a unit is a duration, not a self-description
const NOT_AN_AGE = /(min|mins|minute|hour|hr|hrs|day|days|week|month|year|saal|baje|rupee|rs|km|kg|ke\s+liye)/i;
const AGE_GENDER_RE = /(\b(1[89]|[2-6]\d)\s?[mf]\b|\b[mf]\s?(1[89]|[2-6]\d)\b)/i;
const AGE_GENDER = {
    test(t) {
        const m = AGE_GENDER_RE.exec(String(t || ''));
        if (!m) return false;
        // What follows the match — "10 m ke liye", "25 m ago".
        const after = String(t).slice(m.index + m[0].length, m.index + m[0].length + 12);
        return !NOT_AN_AGE.test(after);
    },
};

// A rate. Nothing innocent quotes one in a chatroom.
const PRICE = /(\b\d{3,5}\s*(rs|rupees|inr|\/-)?\s*(for|per|\/)\s*\d*\s*(hr|hour|hours|min|mins|night|session)\b|\b(rs|inr|₹)\s*\d{3,5}\b|\bper\s+(hour|hr|night|session)\b)/i;

// Children. This is not a matter of degree — if this fires alongside anything
// else, it is the most serious thing the bot will ever see in a room.
const CHILD = /\b(little\s+(girl|girls|boy|boys)|young\s+(girl|girls|boy|boys)|school\s*girl|school\s*boy|teen|teens|teenage|minor|minors|underage|jailbait|loli|lolita|\d{1,2}\s*(yo|yr|yrs)\b)/i;

/**
 * Read a message for solicitation.
 *
 * @param {string} text
 * @returns {{level:'none'|'solicit'|'child', score:number, why:string[]}}
 */
function solicits(text) {
    const t = String(text || '');
    const why = [];
    let score = 0;

    const target = TARGET.test(t);
    const price = PRICE.test(t);
    if (target) { score += 1; why.push('gender sought'); }
    if (SEEK.test(t)) { score += 1; why.push('seeking'); }
    if (MEDIA.test(t)) { score += 1; why.push('photos/cam'); }
    if (CONTACT.test(t)) { score += 1; why.push('meet/chat offer'); }
    if (EXPLICIT.test(t)) { score += 2; why.push('explicit'); }
    if (AGE_GENDER.test(t)) { score += 2; why.push('age/gender advert'); }
    if (price) { score += 2; why.push('a rate'); }

    // A target, or a price. Without one of the two this is ordinary
    // conversation: "anyone free for a video call?" names nobody and quotes
    // nothing, and removing somebody for it would be exactly the overreach
    // this file exists to avoid.
    // An age-and-gender self-label IS a target — "24f pune looking for fun"
    // names its own half and needs no separate gender word. Stripping the
    // quantity to fix "10 m ke liye" removed that, and the fix has to not cost
    // the thing the filter is actually for.
    const selfLabel = AGE_GENDER.test(t);
    if (!target && !price && !selfLabel) return { level: 'none', score: 0, why: [] };
    // A bar of 3 when the ONLY evidence of a target is the person's own
    // age-and-gender label, because that is also how people introduce
    // themselves: "vikram 25M here nice to meet you" is a hello, and
    // "24f pune looking for fun" is an advert. Both mention an age and a
    // medium; only one of them is offering something. So when nobody is being
    // sought by name and no rate is quoted, it takes one more signal.
    const bar = (!target && !price && selfLabel) ? 4 : 3;
    if (score < bar) return { level: 'none', score, why: [] };

    // Children turn a solicitation into the worst thing in the room. Checked
    // only once the message already reads as solicitation, so "my little girl
    // started school today" — a parent, in an ordinary sentence — is never
    // touched by it.
    if (CHILD.test(t)) return { level: 'child', score, why: [...why, 'refers to minors'] };
    return { level: 'solicit', score, why };
}

module.exports = { solicits, SEEK, TARGET, MEDIA, CONTACT, EXPLICIT, AGE_GENDER, PRICE, CHILD };
