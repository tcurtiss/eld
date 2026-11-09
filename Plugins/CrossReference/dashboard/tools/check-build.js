#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eld-dashboard-build-'));
try {
  const output = path.join(temp, 'dashboard.html');
  execFileSync(process.execPath, [path.join(__dirname, 'build.js'), '--out', output]);
  const built = fs.readFileSync(output, 'utf8');
  assert.equal(built, fs.readFileSync(path.join(root, 'dist/image-anatomy.html'), 'utf8'),
    'The committed dashboard is stale; run npm run build in the dashboard directory.');
  for (const marker of ['/*CORE*/', '/*RELATIONSHIPS*/', '/*UI*/', '/*EXPLORER*/'])
    assert.ok(!built.includes(marker), `Unexpanded build marker: ${marker}`);
  console.log('Dashboard build matches the committed HTML.');
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}
