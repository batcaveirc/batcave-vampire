// !!find uses nicksOnHost as its index. The owner caught this live
// 2026-10-07: `!!find lu5.qq5.149.45.IP` returned "nobody on that host"
// even though the bot had seen jiya18f speak 11 min earlier.
//
// Root cause: rememberHost stored the host as-is (with HybridIRC's ".IP"
// uppercase suffix), while !!find lower-cased the query before comparing.
// The fix: lower-case at STORAGE so both ends match regardless of what
// case the server emitted.
//
// This test slice-extracts rememberHost from action-bot.js and checks the
// end-to-end behaviour: capture a speaker's full user@host, query the host
// in multiple cases, every one must find the nick.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');

function slice(name) {
    const re = new RegExp(`function ${name}\\(([^)]*?)\\)\\s*\\{`);
    const start = src.search(re);
    if (start < 0) throw new Error(`cannot find ${name}`);
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    throw new Error('unbalanced');
}

const script = `
    const nicksOnHost = new Map();
    const watch = { rememberHost() {} };    // stub
    ${slice('rememberHost')}
    ({ rememberHost, nicksOnHost });
`;
const api = vm.runInNewContext(script, {});

let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

// The exact userhost format HybridIRC emitted for jiya18f (uppercase IP).
api.rememberHost('jiya18f', 'webchat@lu5.qq5.149.45.IP');

// All of these are the SAME host; !!find lowercases its argument, so a
// lowercase query must match a storage emitted in any case.
const queries = [
    'lu5.qq5.149.45.ip',             // what !!find built from any input
    'lu5.qq5.149.45.IP',             // what the user typed verbatim
    'LU5.QQ5.149.45.IP',             // all-upper, just in case
];
for (const raw of queries) {
    const q = raw.split('@').pop().toLowerCase().trim();
    const hits = [];
    for (const [host, nicks] of api.nicksOnHost) {
        if (host === q || host.endsWith(`.${q}`) || host.endsWith(q)) {
            for (const n of nicks) hits.push(n);
        }
    }
    c(`!!find "${raw}" finds jiya18f`, hits.includes('jiya18f'),
      `nicksOnHost=${JSON.stringify([...api.nicksOnHost])}`);
}

// Full-mask input: !!find jiya18f!webchat@lu5.qq5.149.45.IP
{
    const q = 'jiya18f!webchat@lu5.qq5.149.45.IP'.split('@').pop().toLowerCase().trim();
    let hit = false;
    for (const [host, nicks] of api.nicksOnHost) {
        if (host === q) { for (const n of nicks) if (n === 'jiya18f') hit = true; }
    }
    c('full-mask !!find also works (split("@").pop())', hit);
}

// A different host must NOT match.
api.rememberHost('other', 'webchat@aaa.bbb.ccc.ddd.ip');
{
    const q = 'lu5.qq5.149.45.ip';
    const hits = [];
    for (const [host, nicks] of api.nicksOnHost) {
        if (host === q) for (const n of nicks) hits.push(n);
    }
    c('unrelated host is NOT matched', !hits.includes('other'));
}

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
