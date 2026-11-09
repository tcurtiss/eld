#!/usr/bin/env node
// Writes a synthetic linker export, the same image the dashboard generates on load.
//
//   node tools/gen-sample.js                                   -> samples/sample-150k.columnar.json.gz
//   node tools/gen-sample.js --sections 60000 --format objects --no-gzip
//   node tools/gen-sample.js --sections 300000 --seed 7 --out /tmp/big.json.gz
//
// Options
//   --sections N   approximate number of input sections (default 150000)
//   --seed N       random seed (default 11, the one the dashboard uses)
//   --format F     "columnar" (default) or "objects"
//   --no-gzip      write plain JSON instead of .json.gz
//   --no-details   omit DWARF-style symbol details (a plain section-graph export)
//   --out FILE     output path (default under samples/)
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { generateSample, toColumnar, analyze } = require('../src/core.js');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const sections = +opt('--sections', 150000);
const seed = +opt('--seed', 11);
const format = opt('--format', 'columnar');
const gzip = !args.includes('--no-gzip');
const details = !args.includes('--no-details');
if (!['columnar', 'objects'].includes(format)) { console.error('--format must be "columnar" or "objects"'); process.exit(1); }

const k = Math.round(sections / 1000) + 'k';
const def = path.join(__dirname, '..', 'samples', `sample-${k}.${format}.json${gzip ? '.gz' : ''}`);
const out = path.resolve(opt('--out', def));

const t0 = Date.now();
const data = generateSample({ symbols: sections, seed, details });
const doc = format === 'columnar' ? toColumnar(data) : data;
const json = JSON.stringify(doc);
const bytes = gzip ? zlib.gzipSync(json, { level: 9 }) : Buffer.from(json);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bytes);

const A = analyze(doc, { pathMode: 'source' });
const MiB = (b) => (b / 1048576).toFixed(1) + ' MiB';
console.log(`Wrote ${path.relative(process.cwd(), out)}: ${(bytes.length / 1e6).toFixed(1)} MB (${(json.length / 1e6).toFixed(1)} MB of JSON) in ${Date.now() - t0} ms`);
console.log(`  ${A.N.toLocaleString()} sections, ${A.edgeCount.toLocaleString()} references, ${A.mods.length} subsystems in ${A.doms.length} directories`);
if (A.details) console.log(`  DWARF source files for ${A.details.mapped.toLocaleString()} of ${A.N.toLocaleString()} sections; object paths follow build targets`);
console.log(`  ${MiB(A.total.live)} in the image, ${MiB(A.total.dead)} eliminated (${(100 * A.total.dead / A.total.pre).toFixed(0)}% of linker input)`);
