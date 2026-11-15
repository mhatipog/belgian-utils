#!/usr/bin/env node
// Packs the library, installs the tarball into an empty project and uses it the way a consumer would.
// Fails on files that should not ship and on imports that only work inside this repository.
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const npm = (args, cwd) => execFileSync('npm', args, {cwd, encoding: "utf8", shell: process.platform === "win32"});
const dir = mkdtempSync(join(tmpdir(), 'belgian-utils-pack-'));
try {
  const [info] = JSON.parse(npm(['pack', '--json', '--pack-destination', dir], root));
  const files = info.files.map(f => f.path);
  const unexpected = files.filter(f => !/^(src\/|README\.md$|LICENSE$|package\.json$)/.test(f));
  if (unexpected.length) throw new Error('unexpected files in the package: ' + unexpected.join(', '));
  for (const must of ['LICENSE', 'src/vendor/JSVAT-NEXT-LICENSE.txt', 'src/data/be-banks.json'])
    if (!files.includes(must)) throw new Error('missing from the package: ' + must);
  if (info.unpackedSize > 1_000_000) throw new Error('package grew past 1 MB unpacked: ' + info.unpackedSize);

  const app = join(dir, 'app');
  execFileSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(app)})`]);
  writeFileSync(join(app, 'package.json'), JSON.stringify({name: 'consumer', private: true, type: 'module'}));
  npm(['install', '--no-audit', '--no-fund', '--omit=dev', join(dir, info.filename)], app);
  writeFileSync(join(app, 'use.mjs'), `
import assert from 'node:assert/strict';
import {parseEuVat, parseEnterprise, parseIban, makeOgm, parseOgm, parseCoda} from 'belgian-utils';
import pkg from 'belgian-utils/package.json' with {type: 'json'};
assert.equal(parseEuVat('BE 0417.497.106').valid, true);
assert.equal(parseEuVat('PL1234567890').valid, false);
assert.equal(parseEnterprise('0417497106').valid, true);
assert.equal(parseIban('BE68 5390 0754 7034').valid, true);
assert.equal(parseOgm(makeOgm('1234567890')).valid, true);
const coda = parseCoda(${JSON.stringify((await import('../samples/coda.js')).default)});
assert.ok(coda && JSON.stringify(coda).includes('INV-2026-0042'));
console.log(JSON.stringify({ok: true, installed: pkg.name + '@' + pkg.version}));
`);
  process.stdout.write(execFileSync(process.execPath, ['use.mjs'], {cwd: app, encoding: 'utf8'}));
  console.log(JSON.stringify({files: files.length, unpackedBytes: info.unpackedSize}));
} finally {
  rmSync(dir, {recursive: true, force: true});
}
