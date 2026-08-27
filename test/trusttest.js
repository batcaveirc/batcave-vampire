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

console.log(f?`\n${f} FAILED`:'\nALL PASS'); process.exit(f?1:0);
