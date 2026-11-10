// Regression test for CVE-2023-26127 (command injection in `n158 init`).
// Uses a fake `npm` on PATH (a shell script on POSIX, npm.cmd on Windows), so nothing is
// installed and no network is used.
// Run: node test/cli-injection.test.js
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var childProcess = require('child_process');

var IS_WINDOWS = process.platform === 'win32';
var ROOT = path.join(__dirname, '..');
var BIN = path.join(ROOT, 'bin/index.js');
var SEED = path.join(ROOT, 'src/seed');
var initProject = require('../src/cli/initProject');

var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'n158-cli-test-'));
var fakeBin = path.join(tmp, 'fakebin');
var work = path.join(tmp, 'work');
var npmLog = path.join(tmp, 'npm-calls.log');
fs.mkdirSync(fakeBin);
fs.mkdirSync(work);

// The fake npm appends "<args>|<cwd>" to npmLog and exits with the given code.
function writeFakeNpm (exitCode) {
    if (IS_WINDOWS) {
        // Delayed expansion (!CD!) so a cwd containing & | ^ % is printed, not parsed.
        fs.writeFileSync(path.join(fakeBin, 'npm.cmd'), [
            '@echo off',
            'setlocal EnableDelayedExpansion',
            '>>"' + npmLog + '" echo(%*^|!CD!',
            'exit /b ' + exitCode,
            ''
        ].join('\r\n'));
    } else {
        fs.writeFileSync(path.join(fakeBin, 'npm'),
            '#!/bin/sh\nprintf "%s|%s\\n" "$*" "$(pwd)" >> "' + npmLog + '"\nexit ' + exitCode + '\n',
            { mode: 0o755 });
    }
}
function npmCalls () {
    if (!fs.existsSync(npmLog)) return [];
    return fs.readFileSync(npmLog, 'utf8').split(/\r?\n/).filter(Boolean).map(function (l) {
        var i = l.indexOf('|');
        return { args: l.slice(0, i).trim(), cwd: l.slice(i + 1) };
    });
}
function samePath (a, b) {
    var ra = fs.realpathSync.native(a);
    var rb = fs.realpathSync.native(b);
    return IS_WINDOWS ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}
// Recursively look for a file/dir name anywhere under tmp (payloads may create it in any cwd).
function findUnderTmp (name) {
    var found = [];
    (function walk (dir) {
        fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
            var p = path.join(dir, e.name);
            if (e.name === name) found.push(p);
            if (e.isDirectory()) walk(p);
        });
    })(tmp);
    return found;
}
function reset () {
    if (fs.existsSync(npmLog)) fs.unlinkSync(npmLog);
}
var ENV = Object.assign({}, process.env);
var PATH_KEY = Object.keys(ENV).filter(function (k) { return k.toUpperCase() === 'PATH'; })[0] || 'PATH';
ENV[PATH_KEY] = fakeBin + path.delimiter + ENV[PATH_KEY];
function cli (args) {
    return childProcess.spawnSync(process.execPath, [BIN].concat(args), { cwd: work, env: ENV, encoding: 'utf8' });
}

var passed = 0;
function test (name, fn) {
    reset();
    try {
        fn();
        passed++;
        console.log('ok - ' + name);
    } catch (err) {
        console.log('not ok - ' + name);
        console.log(err.stack);
        process.exitCode = 1;
    }
}

// Payloads that would create a marker if the target path ever reached a shell. Each is a
// valid single directory name on its platform (Windows names can't contain \ / : * ? " < > |).
var PAYLOADS = IS_WINDOWS ? [
    ['cmd command chaining (&)', 'x & mkdir PWNED_AMP & rem', 'PWNED_AMP'],
    ['cmd conditional chaining (&&)', 'y && mkdir PWNED_AND && rem', 'PWNED_AND'],
    ['cmd variable expansion (%VAR%)', 'z %COMSPEC% !OS! ^&mkdir PWNED_VAR', 'PWNED_VAR']
] : [
    ['quote breakout (\'; cmd; \')', "x'; mkdir PWNED_QUOTE; echo '", 'PWNED_QUOTE'],
    ['command substitution ($() and backticks)', 'y$(mkdir PWNED_SUBST)`mkdir PWNED_TICK`', 'PWNED_SUBST'],
    ['command chaining (&& ;)', 'z && mkdir PWNED_AND ; mkdir PWNED_SEMI', 'PWNED_AND']
];

writeFakeNpm(0);
var originalPath = process.env[PATH_KEY];
process.env[PATH_KEY] = ENV[PATH_KEY]; // initProject() is also called in-process below
var originalCwd = process.cwd();
process.chdir(work); // a payload that did run would create its marker (relative mkdir) under tmp

PAYLOADS.forEach(function (p) {
    test('payload is NOT executed: ' + p[0], function () {
        var evil = path.join(work, p[1]);
        initProject(SEED, evil);
        assert.deepStrictEqual(findUnderTmp(p[2]), [], 'payload ran');
        if (p[2] === 'PWNED_SUBST') assert.deepStrictEqual(findUnderTmp('PWNED_TICK'), [], 'payload ran');
        if (p[2] === 'PWNED_AND' && !IS_WINDOWS) assert.deepStrictEqual(findUnderTmp('PWNED_SEMI'), [], 'payload ran');
        var calls = npmCalls();
        assert.deepStrictEqual(calls.map(function (c) { return c.args; }), ['install', 'start']);
        // The payload reached npm only as a literal directory (its cwd), never as a command.
        calls.forEach(function (c) { assert.ok(samePath(c.cwd, evil), 'cwd was ' + c.cwd); });
    });
});

test('initProject refuses an existing target', function () {
    var existing = path.join(work, 'already-there');
    fs.mkdirSync(existing);
    assert.throws(function () { initProject(SEED, existing); }, /already exists/);
    assert.deepStrictEqual(npmCalls(), []);
});

process.env[PATH_KEY] = originalPath;
process.chdir(originalCwd);

[
    ['injection in --name', ['init', '--name', IS_WINDOWS ? 'x & mkdir PWNED_CLI' : "x'; mkdir PWNED_CLI; '"]],
    ['path traversal', ['init', '--name', '../escape']],
    ['backslash traversal', ['init', '--name', '..\\escape2']],
    ['absolute path', ['init', '--name', path.join(tmp, 'abs')]],
    ['dot', ['init', '--name', '.']],
    ['missing --name value', ['init', '--name']],
    ['no --name', ['init']]
].forEach(function (c) {
    test('cli rejects ' + c[0], function () {
        var r = cli(c[1]);
        assert.strictEqual(r.status, 1, r.stdout + r.stderr);
        assert.deepStrictEqual(npmCalls(), [], 'npm must not run');
    });
});

test('nothing was created outside the work dir', function () {
    ['PWNED_CLI', 'escape', 'escape2', 'abs'].forEach(function (f) {
        assert.deepStrictEqual(findUnderTmp(f), [], f + ' exists');
    });
});

test('cli creates a project for a valid name (--name x and --name=x)', function () {
    var r1 = cli(['init', '--name', 'myproject']);
    var r2 = cli(['init', '--name=other-proj_1.0']);
    assert.strictEqual(r1.status, 0, r1.stdout + r1.stderr);
    assert.strictEqual(r2.status, 0, r2.stdout + r2.stderr);
    assert.ok(fs.existsSync(path.join(work, 'myproject/package.json')));
    assert.ok(fs.existsSync(path.join(work, 'other-proj_1.0/package.json')));
    assert.deepStrictEqual(npmCalls().map(function (c) { return c.args + '@' + path.basename(c.cwd); }),
        ['install@myproject', 'start@myproject', 'install@other-proj_1.0', 'start@other-proj_1.0']);
});

test('cli refuses an existing project dir', function () {
    var r = cli(['init', '--name', 'myproject']);
    assert.strictEqual(r.status, 1);
    assert.ok(/already exists/.test(r.stdout), r.stdout);
});

test('cli propagates an npm install failure and does not start', function () {
    writeFakeNpm(3);
    var r = cli(['init', '--name', 'failing']);
    assert.strictEqual(r.status, 3, r.stdout + r.stderr);
    assert.deepStrictEqual(npmCalls().map(function (c) { return c.args; }), ['install']);
    writeFakeNpm(0);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
