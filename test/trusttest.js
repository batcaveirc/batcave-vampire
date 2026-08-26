// Trust you can edit from IRC instead of from a write-only secret.
const { TrustList, effective, parseFlagRow, isEndOfList } = require('../trust.js');
let f=0; const c=(n,ok,d='')=>{if(!ok)f++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};
const mk=(chan='#batcave-trust')=>{const sent=[],logs=[];
  return {sent,logs,t:new TrustList({channel:chan,send:l=>sent.push(l),log:(a,b)=>logs.push(a+' '+b)})};};

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

console.log(f?`\n${f} FAILED`:'\nALL PASS'); process.exit(f?1:0);
