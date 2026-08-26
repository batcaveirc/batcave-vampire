// Two regulars fighting: nudge first, then devoice with the INSTIGATOR serving
// longer. And the thing that prompted it — "stupid" and "idiot" must stop being
// punishable, because in this room they are how friends talk.
const { Feuds, severityOf, aimedAt, LIGHT } = require('../feud.js');
let f=0; const c=(n,ok,d='')=>{if(!ok)f++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};
const lists = { severe: new Set(['slur1','rape']), heavy: new Set(['bkl','bsdk','fuck','randi','stupid','idiot']) };
const here = ['soul','JAILER','Vikram','Almond'];
const present = (n) => here.some(x=>x.toLowerCase()===n.toLowerCase());

console.log('— light words are NOT abuse here —');
c('"stupid" alone is light', severityOf('you are stupid', lists) === 'light', severityOf('you are stupid', lists));
c('"idiot" alone is light', severityOf('what an idiot', lists) === 'light');
c('"pagal" is light', severityOf('tu pagal hai', lists) === 'light');
c('even though the filter lists them as badwords',
  lists.heavy.has('stupid') && lists.heavy.has('idiot'));
c('but three at once is a pile-on', severityOf('you stupid dumb idiot', lists) === 'heavy',
  severityOf('you stupid dumb idiot', lists));
c('a real slur is severe', severityOf('you rape', lists) === 'severe');
c('an acronym on the list is heavy', severityOf('soul bkl', lists) === 'heavy');
c('ordinary chat is nothing', severityOf('kidda almond', lists) === 'none');

console.log('\n— aimed at somebody, or just shouting —');
c('a name first is aimed', aimedAt('soul bkl tu nahi bachega', present) === 'soul');
c('a name last is aimed too', aimedAt('tu bachega nahi soul', present) === 'soul');
c('nobody named is not aimed', aimedAt('this game is rubbish', present) === '');

console.log('\n— the ladder —');
let F = new Feuds({ devoiceMin: 2, instigatorBonus: 3 });
const line = (from, to, sev, t) => F.see('#batcave', from, 'x', { severity: sev, target: to, now: t });
let t = 1000;
c('one heavy line at somebody does nothing yet', line('JAILER','soul','heavy',t+=1000) === null);
c('a one-sided tirade is NOT a feud', line('JAILER','soul','heavy',t+=1000) === null,
  'the ordinary ladder handles one person being unpleasant');
const r1 = line('soul','JAILER','heavy',t+=1000);
c('once BOTH are in it, a nudge fires', r1 && r1.action === 'nudge', JSON.stringify(r1));
c('and it names the instigator first', r1 && r1.a === 'JAILER', JSON.stringify(r1));

console.log('\n— ignore the nudge and it escalates —');
c('one more line is still just a warning', line('JAILER','soul','heavy',t+=1000) === null);
const r2 = line('soul','JAILER','heavy',t+=1000);
c('the second one devoices them', r2 && r2.action === 'devoice', JSON.stringify(r2));
c('the INSTIGATOR serves longer', r2 && r2.instigatorMin > r2.otherMin,
  r2 ? `${r2.instigator} ${r2.instigatorMin}m vs ${r2.other} ${r2.otherMin}m` : 'nothing');
c('and it is JAILER who started it', r2 && r2.instigator === 'JAILER', JSON.stringify(r2));
c('5 minutes vs 2', r2 && r2.instigatorMin === 5 && r2.otherMin === 2);

console.log('\n— what must never trigger it —');
F = new Feuds();
c('light words never start a feud',
  F.see('#batcave','JAILER','x',{severity:'light',target:'soul'}) === null &&
  F.see('#batcave','soul','x',{severity:'light',target:'JAILER'}) === null &&
  F.see('#batcave','JAILER','x',{severity:'light',target:'soul'}) === null);
c('and no state is even kept for them', F.size === 0, String(F.size));
c('swearing at nobody is not a feud',
  F.see('#batcave','JAILER','x',{severity:'heavy',target:''}) === null);
c('swearing at yourself is not a feud',
  F.see('#batcave','JAILER','x',{severity:'heavy',target:'JAILER'}) === null);

console.log('\n— it forgets —');
F = new Feuds({ windowMs: 5000 });
F.see('#batcave','a','x',{severity:'heavy',target:'b',now:1000});
F.see('#batcave','b','x',{severity:'heavy',target:'a',now:2000});
const stale = F.see('#batcave','a','x',{severity:'heavy',target:'b',now:100000});
c('an argument an hour later is a NEW argument', stale === null, JSON.stringify(stale));

console.log(f?`\n${f} FAILED`:'\nALL PASS'); process.exit(f?1:0);
