// Trust you can edit from IRC instead of from a write-only secret.
const { TrustList, effective, parseFlagRow, isEndOfList } = require('../trust.js');
let f=0; const c=(n,ok,d='')=>{if(!ok)f++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};
const mk=(chan='#batcave-trust',self='')=>{const sent=[],logs=[];
  return {sent,logs,t:new TrustList({channel:chan,self,send:l=>sent.push(l),log:(a,b)=>logs.push(a+' '+b)})};};

console.log('— reading an Atheme FLAGS listing —');
c('a numbered row is an entry', JSON.stringify(parseFlagRow('1     Vikram                 +AFORVefiorstv (FOUNDER)'))
  === JSON.stringify({who:'Vikram',flags:'+AFORVefiorstv'}));
c('the header is not', parseFlagRow('Entry Nickname/Host          Flags') === null);
c('the rule line is not', parseFlagRow('----- ---------------------- -----') === null);
c('the end line is recognised', isEndOfList('End of #batcave-trust FLAGS listing.'));

console.log('\n— a whole listing —');
let {t,sent} = mk();
t.refresh();
c('it asks ChanServ', sent[0] === 'PRIVMSG ChanServ :FLAGS #batcave-trust', sent[0]);
for (const l of [
  'Entry Nickname/Host          Flags',
  '----- ---------------------- -----',
  '1     Vikram                 +AFORVefiorstv (FOUNDER)',
  '2     *!*@*                  +V',
  '3     LiBu                   +Vo',
  '4     Ashish                 +o',
  '----- ---------------------- -----',
  'End of #batcave-trust FLAGS listing.',
]) t.absorb(l);
c('it read the names', t.has('vikram') && t.has('libu'), t.list().join(', '));
c('a hostmask entry is NOT a trusted name', !t.has('*!*@*') && t.size === 2,
  `got ${t.list().join(', ')} — *!*@* would trust the entire internet`);
c('somebody without the flag is not trusted', !t.has('ashish'), t.list().join(', '));
c('the listing is marked loaded', t.loaded === true);

console.log('\n— editing it —');
({t,sent} = mk());
t.add('Nessie');
c('add writes to ChanServ', sent.some(l=>/FLAGS #batcave-trust Nessie \+V/.test(l)), sent.join(' | '));
c('and takes effect immediately', t.has('nessie'));
t.remove('Nessie');
c('remove writes to ChanServ', sent.some(l=>/FLAGS #batcave-trust Nessie -V/.test(l)), sent.join(' | '));
c('and takes effect immediately', !t.has('nessie'));

console.log('\n— it must never silently strip the room of its regulars —');
const secret = new Set(['vikram','libu','almond']);
const untrust = new Set(['jailer']);
({t} = mk());
c('before ChanServ answers, the SECRET holds', effective(t, secret, untrust).size === 3,
  [...effective(t, secret, untrust)].join(', '));
({t} = mk(''));
c('with no trust channel at all, the secret holds', effective(t, secret, untrust).size === 3);
c('and UNTRUST still subtracts', !effective(t, secret, new Set(['libu'])).has('libu'));

({t} = mk());
t.refresh();
['1     Vikram                 +V', 'End of #batcave-trust FLAGS listing.'].forEach(l=>t.absorb(l));
c('once ChanServ HAS answered, it wins', effective(t, secret, untrust).size === 1,
  [...effective(t, secret, untrust)].join(', '));

console.log('\n— a refusal falls back rather than emptying the list —');
const bad = mk();
bad.t.refresh();
bad.t.absorb('You are not authorized to perform this operation.');
c('the listing is abandoned', bad.t.loading === false);
c('and NOT marked loaded, so the secret still holds', bad.t.loaded === false);
c('and it says why, with the remedy', bad.logs.some(l=>/WHITELIST secret/.test(l)), bad.logs.join(' | '));
c('so the room keeps its regulars', effective(bad.t, secret, untrust).size === 3);

console.log('\n— an EMPTY channel must not strip the room —');
// Registering the channel is step one of three. If handover happened on the
// first read, every regular would lose their standing between step one and
// step three — silently, because losing an exemption looks exactly like never
// having had one.
const {t:empty} = mk();
empty.refresh();
empty.absorb('End of #batcave-trust FLAGS listing.');
c('the listing IS marked read', empty.loaded === true);
c('but an empty one does not take over', effective(empty, secret, untrust).size === 3,
  [...effective(empty, secret, untrust)].join(', ')||'(everyone lost their standing)');
empty.add('Vikram');
c('and the moment somebody is in it, it does', effective(empty, secret, untrust).size === 1,
  [...effective(empty, secret, untrust)].join(', '));

console.log('\n— two lists, one channel —');
// The owner's idea, and the right one: the channel holds who IS trusted and
// who has FORFEITED it, in one readable place with an audit trail, instead of
// a server-side list plus a write-only secret that cannot be read back.
const two = mk();
two.t.refresh();
['1  Vikram  +AFORVefiorstv', '2  LiBu  +V', '3  JAILER  +b', '4  soul  +b',
 'End of #batcave-trust FLAGS listing.'].forEach(l => two.t.absorb(l));
c('trusted are read from +V', two.t.list().join(',') === 'libu,vikram', two.t.list().join(','));
c('denied are read from +b', two.t.deniedList().join(',') === 'jailer,soul', two.t.deniedList().join(','));

const eff = effective(two.t, new Set(['vikram','libu','jailer','soul','almond']), new Set());
c('denied beats trusted', !eff.has('jailer') && !eff.has('soul'), [...eff].join(','));
c('and the trusted survive', eff.has('vikram') && eff.has('libu'));

two.sent.length = 0;
two.t.deny('LiBu');
c('denying writes BOTH flags at once', two.sent[0].includes('-V+b'), two.sent[0]);
c('so the two lists cannot disagree', !two.t.has('libu') && two.t.isDenied('libu'));
two.sent.length = 0;
two.t.allow('LiBu');
c('allowing clears only the deny', two.sent[0].includes('-b'), two.sent[0]);
c('and does not silently re-trust them', !two.t.has('libu'), 'trust must be granted deliberately');


console.log('\n— a refused write must not be silent —');
// This is the bug that cost three attempts at `!!trust seed` with nothing
// stored and no reason given. ChanServ was refusing every write because
// Atheme only lets a non-founder hand out flags it HOLDS — the bot had +Af,
// so +f let it edit the list while every +V grant bounced. absorb() only
// examined notices while a LISTING was open, so the refusals fell through a
// branch that discarded them and the whole failure was invisible.
const r = mk('#batcave-trust', 'vlkram');
c('a refusal with no write pending is not ours', r.t.writeRefused('You are not authorized to perform this operation.') === null);
r.t.add('Nessie');
const why = r.t.writeRefused('You are not authorized to perform this operation.');
c('after a write, the refusal is caught', Boolean(why), String(why));
c('it names who we were writing', /Nessie/.test(why||''), String(why));
// After a BATCH, lastWriteWho is just the final name queued, so blaming it is
// wrong: "_risingphoenix_f is not registered" was reported as "(writing
// vlkram)". Take the name from ChanServ's own words, or name nobody.
const batch = mk('#batcave-trust', 'vlkram');
batch.t.add('Aadhya'); batch.t.add('Zoe'); batch.t.add('Vlkram');
const bw = batch.t.writeRefused('_risingphoenix_f is not registered.');
c('a refusal names whoever ChanServ named', /_risingphoenix_f/.test(bw||''), String(bw));
c('and never the last name in the batch', !/vlkram\x02\)/.test(bw||''), String(bw));
c('it explains the actual Atheme rule', /hand out flags I hold/.test(why||''), String(why));
c('and it gives the exact fix', /FLAGS #batcave-trust vlkram \+AfVb/.test(why||''), String(why));
r.t.add('Almond');
c('the ChanServ wording is caught too', Boolean(r.t.writeRefused('You may only manipulate flags you have.')));
c('ordinary ChanServ chatter is not', r.t.writeRefused('Vikram has been opped on #batcave.') === null);

console.log('\n— the bot must not read itself back —');
// Holding +V and +b is the PRICE of being able to grant them, so we appear in
// our own listing. Reading that back would put the bot in its own denied list.
const s = mk('#batcave-trust', 'vlkram');
s.t.refresh();
['1  Vampire  +AFORefiorstv', '2  Vlkram  +AfVb', '3  Nessie  +V', '4  JAILER  +b',
 'End of #batcave-trust FLAGS listing.'].forEach(l => s.t.absorb(l));
c('our own +V is not trust', !s.t.has('vlkram'), s.t.list().join(','));
c('our own +b is not a denial', !s.t.isDenied('vlkram'), s.t.deniedList().join(','));
c('everyone else still reads normally', s.t.has('nessie') && s.t.isDenied('jailer'));
c('and the founder, holding neither marker, is absent', !s.t.has('vampire'));


console.log('\n— the channel must not take over on our own entry alone —');
// The live failure, exactly. Granting the bot +V and +b so it could hand them
// out put ONE name in the channel: its own, in both lists. names.size was 1,
// so the channel took over from the WHITELIST secret, and then the deny
// removed the only name — leaving nobody trusted at all. `!!trust seed` then
// answered "Nothing to seed — the whitelist is empty", which was true and
// completely unhelpful, and every regular had quietly lost their standing.
const self = mk('#batcave-trust', 'vlkram');
self.t.refresh();
['1  Vampire  +AFORefiorstv', '2  Vlkram  +AVbf',
 'End of #batcave-trust FLAGS listing.'].forEach(l => self.t.absorb(l));
const secretList = new Set(['vikram', 'nessie', 'almond', 'libu']);
const kept = effective(self.t, secretList, new Set());
c('a channel holding only US is not ready', kept.size === secretList.size, [...kept].join(','));
c('so the secret still holds the room', kept.has('nessie') && kept.has('almond'));
c('and nobody is silently stripped', kept.size > 0);

// Same shape, on a build that has not yet learnt to skip its own account:
// the deny must still win, so the result is empty and the guard has to catch
// it rather than believing the channel is authoritative.
const raw = mk('#batcave-trust');   // no `self` — reads itself back
raw.t.refresh();
['1  Vlkram  +AVbf', 'End of #batcave-trust FLAGS listing.'].forEach(l => raw.t.absorb(l));
const kept2 = effective(raw.t, secretList, new Set());
c('a channel that yields nobody never takes over', kept2.size === secretList.size, [...kept2].join(','));

console.log('\n— but a real seeded channel does take over —');
const real = mk('#batcave-trust', 'vlkram');
real.t.refresh();
['1  Vampire  +AFORefiorstv', '2  Vlkram  +AVbf', '3  Nessie  +V', '4  Almond  +V',
 '5  JAILER  +b', 'End of #batcave-trust FLAGS listing.'].forEach(l => real.t.absorb(l));
const kept3 = effective(real.t, new Set(['vikram', 'jailer']), new Set());
c('the channel now wins over the secret', kept3.has('nessie') && kept3.has('almond'), [...kept3].join(','));
c('the secret-only name is dropped', !kept3.has('vikram'), 'channel is authoritative once real');
c('the denied stay denied', !kept3.has('jailer'));
c('and we are still not in our own list', !kept3.has('vlkram'));


console.log('\n— the cheap poll —');
// COUNT answers with a per-flag histogram in two lines where FLAGS costs a
// row per entry, so the list can be watched often and read in full rarely.
const q = mk('#batcave-trust', 'vlkram');
q.sent.length = 0;
q.t.poll();
c('it asks for a COUNT', q.sent[0] === 'PRIVMSG ChanServ :COUNT #batcave-trust', q.sent[0]);
const hist = (v, b) => `#batcave-trust: A:2 F:1 O:1 R:1 S:0 V:${v} b:${b} e:1 f:2 i:1 o:1`;
c('the first sample is not a change', q.t.countChanged(hist(19, 1)) === false);
c('the same numbers are not a change', q.t.countChanged(hist(19, 1)) === false);
c('a new trusted entry IS a change', q.t.countChanged(hist(20, 1)) === true);
c('a new denied entry IS a change', q.t.countChanged(hist(20, 2)) === true);
c('and settles again', q.t.countChanged(hist(20, 2)) === false);
c('the other COUNT line is ignored', q.t.countChanged('#batcave-trust: VOP: 0, HOP: 0, AOP: 0, SOP: 0, AKICK: 0, Other: 20') === false);
c('another channel is ignored', q.t.countChanged('#elsewhere: V:99 b:99') === false);
c('a poll never opens a listing', !q.t.loading, 'COUNT must not be mistaken for FLAGS');


console.log('\n— sitting in the store without being thrown out of it —');
// The channel expires after 365 days with nobody in it, so the bot should sit
// there. But it holds +b in order to be allowed to GRANT +b, and +b is
// "automatic kickban" — so joining without +e means ChanServ removes it from
// its own storage room.
const sit = mk('#batcave-trust', 'vlkram');
c('it will not join before reading the list', sit.t.canSit().ok === false, sit.t.canSit().why);
sit.t.refresh();
['1  Vampire  +AFORefiorstv', '2  Vlkram  +AVbf', '3  Nessie  +V',
 'End of #batcave-trust FLAGS listing.'].forEach(l => sit.t.absorb(l));
const noExempt = sit.t.canSit();
c('+b without +e is refused', noExempt.ok === false, noExempt.why);
c('and it names the exact fix', /\+e/.test(noExempt.why), noExempt.why);

const okc = mk('#batcave-trust', 'vlkram');
okc.t.refresh();
['1  Vlkram  +AVbefS', '2  Nessie  +V', 'End of #batcave-trust FLAGS listing.'].forEach(l => okc.t.absorb(l));
c('with +e it may sit', okc.t.canSit().ok === true, okc.t.canSit().why);
c('and it is still not in its own trust list', !okc.t.has('vlkram'));
c('nor its own denied list', !okc.t.isDenied('vlkram'));

const plain = mk('#batcave-trust', 'somebot');
plain.t.refresh();
['1  Nessie  +V', 'End of #batcave-trust FLAGS listing.'].forEach(l => plain.t.absorb(l));
c('holding no entry at all is safe', plain.t.canSit().ok === true, plain.t.canSit().why);


console.log('\n— hostmask entries, which is how the unregistered get stored —');
// Verified against the live server: "Flags +V were set on Carmilla!*@* in
// #batcave-trust." ChanServ keys on the ACCOUNT, so somebody who never
// registered cannot be stored by name — a mask is the only way, and it is why
// a 73-name whitelist became 18 entries.
const mk2 = mk('#batcave-trust', 'vlkram');
mk2.t.refresh();
['1  Vlkram  +ASVbef', '2  Nessie  +V', '3  Carmilla!*@*  +V',
 '4  *!*@some.isp.net  +V', '5  JAILER  +b', '6  *!*@bad.host  +b',
 'End of #batcave-trust FLAGS listing.'].forEach(l => mk2.t.absorb(l));
c('named accounts stay names', mk2.t.list().join(',') === 'nessie', mk2.t.list().join(','));
c('masks are kept apart from names', mk2.t.masks.size === 2, [...mk2.t.masks].join(','));
c('a mask is never treated as a name', !mk2.t.has('carmilla!*@*') && !mk2.t.has('*!*@some.isp.net'));
c('denied masks are separate too', mk2.t.denyMasks.size === 1, [...mk2.t.denyMasks].join(','));
c('and denied names still read', mk2.t.deniedList().join(',') === 'jailer');
c('our own row is still skipped', !mk2.t.has('vlkram') && !mk2.t.isDenied('vlkram'));

// The danger this separation exists to prevent.
const wild = mk('#batcave-trust', 'vlkram');
wild.t.refresh();
['1  *!*@*  +V', 'End of #batcave-trust FLAGS listing.'].forEach(l => wild.t.absorb(l));
c('a catch-all mask never becomes a trusted NAME', wild.t.size === 0, [...wild.t.list()].join(','));


console.log('\n— our own row, when the configured account name is wrong —');
// Live failure: NICKSERV_ACCOUNT did not match the account the server had us
// logged in as, so the bot did not recognise its own row and reported itself
// as a trusted regular — "Stored (19): …, vlkram". Identity has to come from
// the server (the 900 numeric), not from a secret that can simply be wrong.
const wrong = mk('#batcave-trust', 'dracula');   // configured wrongly
wrong.t.refresh();
['1  Vlkram  +ASVbef', '2  Nessie  +V', 'End of #batcave-trust FLAGS listing.'].forEach(l => wrong.t.absorb(l));
c('a wrong configured name lets us into our own list', wrong.t.has('vlkram'),
  'this is the bug, reproduced');

wrong.t.self = 'vlkram';                          // what the server actually said
wrong.t.refresh();
['1  Vlkram  +ASVbef', '2  Nessie  +V', 'End of #batcave-trust FLAGS listing.'].forEach(l => wrong.t.absorb(l));
c('correcting it from the server fixes the read', !wrong.t.has('vlkram'), wrong.t.list().join(','));
c('and the real regular is still there', wrong.t.has('nessie'));


console.log('\n— verifying against ChanServ, not against our own optimism —');
// The live failure: the seed said "Stored (71 by account, 0 by mask)" while
// ChanServ held 19. Two causes compounding —
//   add() updates the local set immediately, so reading it back compares our
//   optimism with itself and nothing ever looks missing; and the outbound
//   queue drains one line per 200ms, so a FLAGS request issued right after 73
//   writes sits BEHIND them and returns the state from before any of them.
const v = mk('#batcave-trust', 'vlkram');
v.t.refresh();
['1  Vlkram  +ASVbef', '2  Nessie  +V', 'End of #batcave-trust FLAGS listing.'].forEach(l => v.t.absorb(l));
c('one real name is held', v.t.list().join(',') === 'nessie', v.t.list().join(','));

v.t.add('Ghost');   // ChanServ will refuse this one
c('add() is optimistic, so it LOOKS stored', v.t.has('ghost'),
  'this optimism is what must never be used as verification');

let verified = false;
v.t.verify(2, () => { verified = true; });
c('verify does not fire immediately', verified === false, 'it must wait for the queue');

// Simulate the real listing arriving: Ghost is absent, because it was refused.
setTimeout(() => {
    v.t.absorb('1  Vlkram  +ASVbef');
    v.t.absorb('2  Nessie  +V');
    v.t.absorb('End of #batcave-trust FLAGS listing.');
}, 2200);

setTimeout(() => {
    c('verify eventually fires', verified === true, 'callback never ran');
    c('and the refused name is GONE from the verified view', !v.t.has('ghost'),
      v.t.list().join(','));
    c('so the mask pass can now see it is missing', v.t.list().join(',') === 'nessie');
    console.log(f ? `\n${f} FAILED` : '\nALL PASS');
    process.exit(f ? 1 : 0);
}, 6000);

