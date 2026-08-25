// The clone attack: a regular's name wearing filth.
const fs=require('fs');
const src=fs.readFileSync('../action-bot.js','utf8');
const fn = src.match(/function clonesARegular\(nick\)[\s\S]*?\n}/)[0];
const norm = (s)=>s.toLowerCase().replace(/[^a-z0-9\s]/g,'');
const whitelist = new Set(['nessie','almond','hunterrrrrr','aaloo_khaoge','libu','pooja']);
const severeWords = new Set();
const badwords = new Set(['nangi','randi','chut','gandu','bhabhi']);
// Anyone actually seen speaking here recently now counts as a regular worth
// protecting, not only the whitelist — NangiPoojaBhabhi went unrecognised
// because the whitelist is a list of PRIVILEGES, not a list of members.
const seenUsers = { aloo: Date.now(), telugu_m23: Date.now() - 40*3600*1000 };
const f = new Function('normalize','whitelist','severeWords','badwords','seenUsers',
          fn + '; return clonesARegular;')
          (norm, whitelist, severeWords, badwords, seenUsers);

let fails=0; const c=(n,ok,d='')=>{if(!ok)fails++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};

const hit = f('NessieNangiBhabhi');
c('the real attack nick is caught', hit && hit.who === 'nessie', JSON.stringify(hit));
c('and names the word that flagged it', hit && ['nangi','bhabhi'].includes(hit.word), JSON.stringify(hit));
c('variant with separators still caught', !!f('Nessie_Nangi_Bhabhi'));
c('another regular targeted', !!f('pooja-randi'));

console.log('\n— a regular who is not on the whitelist is still protected —');
c('someone seen speaking here today counts', !!f('aloo_randi'), JSON.stringify(f('aloo_randi')));
c('and it names them', (f('aloo_randi')||{}).who === 'aloo', JSON.stringify(f('aloo_randi')));
c('someone last seen two days ago does not', !f('telugu_m23_randi'),
  JSON.stringify(f('telugu_m23_randi')));

console.log('\n— must NOT fire —');
c('the regular themselves',            f('Nessie') === null);
c('the regular going away',            f('Nessie|away') === null, JSON.stringify(f('Nessie|away')));
c('the regular with an underscore',    f('Nessie_afk') === null, JSON.stringify(f('Nessie_afk')));
c('a filthy nick targeting NOBODY',    f('randiXYZ') === null, JSON.stringify(f('randiXYZ')));
c('an ordinary stranger',              f('shobhit567') === null);
c('a short name is not matched loosely', f('libuXnangi') !== null);
console.log(fails?`\n${fails} FAILED`:'\nALL PASS');
process.exit(fails?1:0);
