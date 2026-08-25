// The clone attack: a regular's name wearing filth.
const fs=require('fs');
const src=fs.readFileSync('../action-bot.js','utf8');
const fn = src.match(/function clonesARegular\(nick\)[\s\S]*?\n}/)[0];
const norm = (s)=>s.toLowerCase().replace(/[^a-z0-9\s]/g,'');
const whitelist = new Set(['nessie','almond','hunterrrrrr','aaloo_khaoge','libu','pooja']);
const severeWords = new Set();
const badwords = new Set(['nangi','randi','chut','gandu','bhabhi']);
const f = new Function('normalize','whitelist','severeWords','badwords', fn + '; return clonesARegular;')
          (norm, whitelist, severeWords, badwords);

let fails=0; const c=(n,ok,d='')=>{if(!ok)fails++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};

const hit = f('NessieNangiBhabhi');
c('the real attack nick is caught', hit && hit.who === 'nessie', JSON.stringify(hit));
c('and names the word that flagged it', hit && ['nangi','bhabhi'].includes(hit.word), JSON.stringify(hit));
c('variant with separators still caught', !!f('Nessie_Nangi_Bhabhi'));
c('another regular targeted', !!f('pooja-randi'));

console.log('\n— must NOT fire —');
c('the regular themselves',            f('Nessie') === null);
c('the regular going away',            f('Nessie|away') === null, JSON.stringify(f('Nessie|away')));
c('the regular with an underscore',    f('Nessie_afk') === null, JSON.stringify(f('Nessie_afk')));
c('a filthy nick targeting NOBODY',    f('randiXYZ') === null, JSON.stringify(f('randiXYZ')));
c('an ordinary stranger',              f('shobhit567') === null);
c('a short name is not matched loosely', f('libuXnangi') !== null);
console.log(fails?`\n${fails} FAILED`:'\nALL PASS');
process.exit(fails?1:0);
