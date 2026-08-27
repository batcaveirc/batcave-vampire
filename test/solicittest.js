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

console.log(f?`\n${f} FAILED`:'\nALL PASS'); process.exit(f?1:0);
