// Solicitation, learned from the rooms the recruiter invites FROM.
//
// The numbers that justify this file: across 2840 messages captured in
// #allindiachat.com, #DesiAdda and #chatsansar, 21% are adverts and almost
// none contain a swear word — every one of them passed the profanity filter.
// Across 441 messages from our OWN rooms, this flags zero.
const { solicits } = require('../solicit.js');
let f=0; const c=(n,ok,d='')=>{if(!ok)f++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};

console.log('— captured verbatim in #allindiachat.com —');
for (const m of [
  'Any female want to see n help me cum',
  'Any real delhi ncr female...who likes golden shower ping me',
  'M 23, my cam your voice',
  'Mallu f pic chat',
  '500 for 1 hour video call',
  'F of any age from India. Who wants to have fun',
  'Anyone F with small titties and tight hole',
  'Koi genuine gujju F NRI alone interested for chat',
  'Any women whos fantasy is to cuckold their husband',
]) c(`caught: ${m.slice(0,44)}`, solicits(m).level !== 'none', 'passes through');

console.log('\n— and the one that outranks everything else —');
const child = solicits('House wife s and little girls dm me');
c('a solicitation naming children is its own level', child.level === 'child', child.level);
c('and says so in the reason', child.why.includes('refers to minors'), child.why.join(', '));

console.log('\n— ORDINARY CHAT. A false positive here is worse than a miss —');
// Regulars were warned for typing "idiot" once. A filter that removes somebody
// for "anyone free for a video call?" would be the same mistake, larger.
for (const m of [
  'anyone free for a video call?',
  'any girls playing uno tonight',
  'kya koi ladki hai yahan',
  'vikram 25M here nice to meet you',
  'hunterrrrrr call me when youre free',
  'janvhii meet maverickspirit he also sings well',
  'i am looking for a good movie to watch',
  'almond you want to play a game',
  'my wife makes the best chai',
  'anyone want to chat about history',
  'my little girl started school today',
  'dm me the photo you took',
  'any of you guys free tonight',
  'the girls won the match',
  'call me sometime',
]) c(`left alone: ${m.slice(0,44)}`, solicits(m).level === 'none', `flagged as ${solicits(m).level}`);

console.log('\n— the guard that makes it narrow —');
c('no gender and no rate means no verdict, whatever else is present',
  solicits('anyone want to video call and chat and meet up for fun').level === 'none');
c('a rate needs no gender, because nothing innocent quotes one',
  solicits('2000 per hour, dm me').level !== 'none');
c('one signal is never enough', solicits('any girls here').level === 'none');


console.log('\n— a quantity is not a self-description —');
// Live: vergil was explaining that another user had abused him —
//   "Koi user aake gali diya mujhe tab mila / 10 m ke liye"
// which is Hinglish for "...for 10 minutes". It was read as age 10, male,
// plus a bare "m" gender target, scored 4, and got him kicked for
// advertising. He rejoined and asked what he had said.
for (const s of ['Koi user aake gali diya mujhe tab mila 10 m ke liye',
                 '10 m ke liye', 'wait 5 min', '30 m ago i said that',
                 'give me 2 min', 'ok 15 m', '2 f aur 3 m the party me'])
  c(`a duration is not an advert: ${s.slice(0, 34)}`, solicits(s).level === 'none');

// And the fix must not cost what the filter exists for. Stripping the
// quantity briefly broke this one, which is the real thing.
for (const s of ['24f pune looking for fun', 'M 23, my cam your voice',
                 'f 25 delhi cam show 500 for 1 hour'])
  c(`a real self-label still reads: ${s.slice(0, 32)}`, solicits(s).level !== 'none');

console.log(f?`\n${f} FAILED`:'\nALL PASS'); process.exit(f?1:0);
