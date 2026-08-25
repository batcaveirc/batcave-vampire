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
for (const f of suites) {
    process.stdout.write(`  ${f.padEnd(24)}`);
    try {
        execFileSync(process.execPath, [path.join(dir, f)], { cwd: dir, stdio: 'pipe', timeout: 200000 });
        console.log('ok');
        passed += 1;
    } catch (e) {
        console.log('FAIL');
        failed.push({ f, out: String(e.stdout || '') + String(e.stderr || '') });
    }
}

console.log(`\n  ${passed} passed, ${failed.length} failed`);
for (const { f, out } of failed) {
    console.log(`\n──── ${f} ────`);
    console.log(out.split('\n').filter((l) => /FAIL|Error|error/i.test(l)).slice(0, 8).join('\n'));
}
process.exit(failed.length ? 1 : 0);
