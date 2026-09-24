'use strict';
// Run every suite in this directory.
//
// These lived in a scratch directory for a long time, which meant that after
// each session they were gone and the next change re-broke something the
// previous one had already proved. A test you cannot re-run is a test you only
// ran once.
//
//   node test/run.js            everything
//   node test/run.js uno        only suites whose name contains "uno"
//
// A suite passes by exiting 0 and fails by exiting non-zero. Suites that open
// real sockets are included: they bind to localhost only and are the only
// things here that prove the bot's WIRING rather than its arithmetic.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const filter = process.argv[2] || '';
// Shared fixtures, not suites: they are required BY the suites and do nothing
// on their own. Running them looked like a failure for no reason at all.
const HELPERS = new Set(['run.js', 'groqfun.js', 'groqstub.js']);

const suites = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js') && !HELPERS.has(f))
    .filter((f) => !filter || f.includes(filter))
    .sort();

let passed = 0;
const failed = [];
const flaky = [];

function attempt(f) {
    try {
        execFileSync(process.execPath, [path.join(dir, f)], { cwd: dir, stdio: 'pipe', timeout: 200000 });
        return null;                          // null means it passed
    } catch (e) {
        return String(e.stdout || '') + String(e.stderr || '');
    }
}

for (const f of suites) {
    process.stdout.write(`  ${f.padEnd(24)}`);
    let out = attempt(f);
    if (out !== null) {
        // ONE failure proves nothing here, and pretending otherwise wasted a
        // whole session.
        //
        // The socket suites start a real server, drive the bot through it, then
        // wait a FIXED number of milliseconds before asserting. Run 79 node
        // processes back to back on a 16 GB machine and some of those waits
        // expire before the bot answers, so a perfectly good suite reports
        // "the bot sent no MODE at all" — a timing expiry wearing the costume
        // of a behaviour failure.
        //
        // It is not theoretical: one run failed lockdowntest/ordersocket/
        // shazamlive/stalltest, the next failed a DIFFERENT four
        // (autotrust/blockedip/everycommand/lockdowntest), and every single one
        // of the eight passed when run on its own. A suite whose failures move
        // around between runs cannot tell a regression from noise, which is the
        // one job it has.
        //
        // So give a failure one clear run before believing it. Passes on the
        // retry => it was starved, and we say so rather than hiding it. Fails
        // twice => it is real.
        out = attempt(f);
        if (out === null) {
            flaky.push(f);
            passed += 1;
            console.log('ok (slow — passed on retry)');
            continue;
        }
    }
    if (out === null) {
        console.log('ok');
        passed += 1;
    } else {
        console.log('FAIL');
        failed.push({ f, out });
    }
}

console.log(`\n  ${passed} passed, ${failed.length} failed`);
if (flaky.length) {
    console.log(`  ${flaky.length} needed a retry (starved, not broken): ${flaky.join(', ')}`);
}
for (const { f, out } of failed) {
    console.log(`\n──── ${f} ────`);
    const lines = out.split('\n');
    const hits = lines.filter((l) => /FAIL|Error|error/i.test(l)).slice(0, 8);
    // A suite killed by the 200s timeout prints nothing matching that filter, so
    // the report showed a header and then nothing at all — twice in one run. A
    // failure that will not say what happened is barely better than no test, and
    // "silence is a failure result" is the rule this project keeps relearning.
    // Fall back to the tail of whatever it DID say, and name the timeout when it
    // said nothing whatsoever.
    console.log(hits.length
        ? hits.join('\n')
        : (lines.filter((l) => l.trim()).slice(-8).join('\n')
            || '(no output at all — killed by the 200s timeout)'));
}
process.exit(failed.length ? 1 : 0);
