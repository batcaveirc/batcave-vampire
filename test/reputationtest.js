// Trust that follows behaviour. Losing it is immediate; earning it leans on
// what the NETWORK remembers, because this process restarts every forty
// minutes and has never seen three days of anything.
const { Reputation } = require('../reputation.js');
let f=0; const c=(n,ok,d='')=>{if(!ok)f++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};
const DAY = 86400000;

console.log('— losing it —');
let R = new Reputation({ maxStrikes: 3 });
c('severe language forfeits at once', R.forfeits('JAILER','severe') !== '');
c('starting a fight forfeits at once', R.forfeits('JAILER','feud') !== '');
c('and it says why', /fight with another regular/.test(R.forfeits('JAILER','feud')));
c('one warning does not', R.forfeits('x','strikes') === '');
R.offended('x'); R.offended('x');
c('nor two', R.forfeits('x','strikes') === '');
R.offended('x');
c('three does', R.forfeits('x','strikes') !== '', `strikes=${R.strikes('x')}`);

console.log('\n— earning it —');
R = new Reputation({ minAccountDays: 30, minMessages: 40 });
const old = Date.now() - 90*DAY;
const isNew = Date.now() - 3*DAY;
for (let i=0;i<50;i++) R.spoke('Nessie');
c('a long-registered, talkative, unwarned regular earns it',
  R.earns('Nessie', {account:'Nessie', registeredAt: old}) !== '',
  R.earns('Nessie', {account:'Nessie', registeredAt: old}));
c('and the reason is specific',
  /90 days registered as Nessie, 50 messages/.test(R.earns('Nessie',{account:'Nessie',registeredAt:old})));

console.log('\n— and the ways it must NOT be earned —');
c('not while unregistered', R.earns('Nessie', {account:'', registeredAt: old}) === '',
  'trust on a name nobody owns is trust handed to whoever takes it next');
c('not on a three-day-old account', R.earns('Nessie', {account:'N', registeredAt: isNew}) === '');
c('not by idling silently', R.earns('Quiet', {account:'Q', registeredAt: old}) === '',
  `only ${R.messages('Quiet')} messages`);
R.offended('Nessie');
c('not with a warning on the record today',
  R.earns('Nessie', {account:'Nessie', registeredAt: old}) === '', 'one strike must disqualify');
R.clear('Nessie');
for (let i=0;i<50;i++) R.spoke('Nessie');
c('and a moderator clearing it restores the path',
  R.earns('Nessie', {account:'Nessie', registeredAt: old}) !== '');

console.log('\n— farming the promotion —');
R = new Reputation({ minAccountDays: 30, minMessages: 40 });
for (let i=0;i<500;i++) R.spoke('raider');
c('500 messages from a brand new account earns nothing',
  R.earns('raider', {account:'raider', registeredAt: Date.now() - 1*DAY}) === '',
  'the account age is the part that cannot be rushed');

console.log(f?`\n${f} FAILED`:'\nALL PASS'); process.exit(f?1:0);
