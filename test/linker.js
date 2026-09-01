// A parser is not a linker.
//
// `node --check` validates syntax and does NOT resolve identifiers, so a call
// to a function whose definition landed nowhere passes it happily and crashes
// at the moment that line first runs. When the call sits inside a setInterval,
// "the moment that line first runs" is ninety seconds after the bot connects —
// so the process starts, joins every room, looks completely healthy, and then
// dies. It did exactly that, in a loop, for half an hour.
//
// This walks each file with a real character scanner (comments and string
// bodies removed, `${...}` interpolations kept, since those hold calls too),
// collects every definition, and asserts that everything CALLED exists.
const fs = require('fs');
const path = require('path');

function strip(src) {
    let out = '', i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i], d = src[i + 1];
        if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && d === '*') {
            i += 2; let nl = '';
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') nl += '\n'; i++; }
            i += 2; out += nl; continue;
        }
        if (c === '"' || c === "'") {
            const q = c; i++;
            while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
            i++; out += '""'; continue;
        }
        if (c === '`') {
            i++; let nl = '';
            while (i < n && src[i] !== '`') {
                if (src[i] === '\\') { i += 2; continue; }
                if (src[i] === '\n') nl += '\n';
                if (src[i] === '$' && src[i + 1] === '{') {          // keep interpolations
                    // Scan them RECURSIVELY. An interpolation can hold its own
                    // strings and nested templates, and copying it raw leaks
                    // their prose into the source as fake call sites.
                    let depth = 1, inner = ''; i += 2;
                    while (i < n && depth) {
                        if (src[i] === '{') depth++;
                        else if (src[i] === '}') depth--;
                        if (depth) inner += src[i];
                        i++;
                    }
                    out += ' ' + strip(inner) + ' '; continue;
                }
                i++;
            }
            i++; out += '""' + nl; continue;
        }
        // A regex literal, distinguished from division by what precedes it.
        if (c === '/') {
            const prev = out.replace(/\s+$/, '').slice(-1);
            if (prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev)) {
                i++;
                while (i < n && src[i] !== '/') {
                    if (src[i] === '\\') i++;
                    else if (src[i] === '[') { while (i < n && src[i] !== ']') { if (src[i] === '\\') i++; i++; } }
                    i++;
                }
                i++; while (i < n && /[a-z]/.test(src[i])) i++;
                out += ' 0 '; continue;
            }
        }
        out += c; i++;
    }
    return out;
}

const KEYWORDS = new Set(['if','for','while','switch','catch','return','typeof','function','new','do',
    'else','try','throw','case','delete','void','instanceof','yield','await','async','in','of','with','super','this','import']);
const GLOBALS = new Set([...Object.getOwnPropertyNames(globalThis),
    'require','module','exports','__dirname','__filename','process','console','Buffer',
    'setTimeout','setInterval','clearTimeout','clearInterval','setImmediate','structuredClone','fetch','queueMicrotask']);

function check(file) {
    const raw = fs.readFileSync(file, 'utf8');
    const src = strip(raw);
    const defined = new Set();
    const add = (n) => { if (/^[A-Za-z_$][\w$]*$/.test(n)) defined.add(n); };

    for (const m of src.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
    for (const m of src.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
    for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
    for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
    for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g))
        for (const piece of m[1].split(',')) add(piece.split(':').pop().split('=')[0].trim());
    // Parameter lists, and single-identifier arrow parameters.
    for (const m of src.matchAll(/(?:\bfunction\s*\*?\s*[\w$]*\s*|\)\s*=>|(?<=[=(,]\s*))\(([^()]{0,600})\)\s*(?:=>|\{)/g))
        for (const piece of m[1].split(',')) add(piece.trim().replace(/^\.\.\./, '').split(/[\s=:]/)[0]);
    for (const m of src.matchAll(/(?:^|[=(,:[]|=>|\breturn\b)\s*([A-Za-z_$][\w$]*)\s*=>/g)) add(m[1]);
    for (const m of src.matchAll(/(?:^|[\s;{},])(?:async\s+|get\s+|set\s+|\*\s*)?([A-Za-z_$][\w$]*)\s*\(([^()]{0,600})\)\s*\{/gm)) { add(m[1]); }
    for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*\(([^()]{0,600})\)\s*\{/g))
        for (const piece of m[2].split(',')) add(piece.trim().replace(/^\.\.\./, '').split(/[\s=:]/)[0]);

    const missing = [];
    for (const m of src.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = m[1];
        if (KEYWORDS.has(name) || GLOBALS.has(name) || defined.has(name)) continue;
        if (missing.some((x) => x.name === name)) continue;
        missing.push({ name, line: src.slice(0, m.index).split('\n').length });
    }
    return missing;
}

let bad = 0;
const files = process.argv.slice(2).length ? process.argv.slice(2)
    : fs.readdirSync(path.join(__dirname, '..')).filter((f) => f.endsWith('.js'));
for (const f of files) {
    const full = path.isAbsolute(f) ? f : path.join(__dirname, '..', f);
    const missing = check(full);
    if (missing.length) {
        bad += missing.length;
        for (const m of missing) console.log(`FAIL ${path.basename(full)}:${m.line}  ${m.name}() is called but never defined`);
    } else {
        console.log(`ok   ${path.basename(full)}`);
    }
}
console.log(bad ? `\n${bad} unresolved call(s) — this crashes the moment that line runs` : '\nALL PASS — every called name resolves');
process.exit(bad ? 1 : 0);
