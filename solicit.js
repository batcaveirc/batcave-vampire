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
const TARGET = /\b(female|females|f|girl|girls|ladki|ladkiya|woman|women|lady|ladies|aunty|aunti|bhabhi|wife|wifes|milf|male|males|m|guy|guys|boy|boys|couple|couples)\b/i;

// What is being offered or asked for.
const MEDIA = /\b(cam|cams|webcam|pic|pics|photo|photos|video|videos|vid|vids|snap|selfie|nude|nudes)\b/i;
// "dm me" is both the asking and the offer, which is why it counts twice and
// why leaving it out of here let "House wife s and little girls dm me" score
// only two and pass.
const CONTACT = /\b(chat|chatting|call|calling|meet|meetup|meeting|host|hosting|session|service|services|fun|fun2|enjoy|company|dm|pm|inbox|hmu|whatsapp|telegram|snap|snapchat)\b/i;

// Unambiguous. Present alongside the rest, this is not a misreading.
const EXPLICIT = /\b(cum|cumming|sex|sexy|sexting|porn|horny|nude|naked|boobs|titties|tits|dick|cock|pussy|bbc|blowjob|suck|fuck|fucking|jerk|jerking|masturbat\w*|golden\s*shower|cuckold|cuck|threesome|hookup|escort|paid|payment)\b/i;

// "23 M", "M23", "f 25" — how these adverts introduce themselves.
const AGE_GENDER = /(\b\d{2}\s?[mf]\b|\b[mf]\s?\d{2}\b)/i;

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
    if (!target && !price) return { level: 'none', score: 0, why: [] };
    if (score < 3) return { level: 'none', score, why: [] };

    // Children turn a solicitation into the worst thing in the room. Checked
    // only once the message already reads as solicitation, so "my little girl
    // started school today" — a parent, in an ordinary sentence — is never
    // touched by it.
    if (CHILD.test(t)) return { level: 'child', score, why: [...why, 'refers to minors'] };
    return { level: 'solicit', score, why };
}

module.exports = { solicits, SEEK, TARGET, MEDIA, CONTACT, EXPLICIT, AGE_GENDER, PRICE, CHILD };
