#!/usr/bin/env node
// Fast, dependency-free checks of the analysis core. Run after any change to src/core.js.
//
//   node tools/check.js               (default 60k sections, a few seconds)
//   node tools/check.js --sections 150000
//
// It verifies that
//   1. both export formats load to identical analysis results, and the columnar
//      format survives a JSON round trip;
//   2. the stories planted in the synthetic data are still detectable with DWARF
//      source paths, which the dashboard selects for this sample
//      (README.md and CLAUDE.md describe them; the dashboard copy relies on them);
//   3. object paths differ from source paths the way a build system makes them.
'use strict';
const { generateSample, toColumnar, analyze } = require('../src/core.js');

const args = process.argv.slice(2);
const sections = +(args[args.indexOf('--sections') + 1] || 0) || 60000;

let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) failed++; };
const t = (label, fn) => { const s = Date.now(); const r = fn(); console.log(`      ${label}: ${Date.now() - s} ms`); return r; };

const data = t('generate', () => generateSample({ symbols: sections }));
const source = { pathMode: 'source' };
const A = t('analyze objects', () => analyze(JSON.parse(JSON.stringify(data)), source));
const col = t('toColumnar', () => toColumnar(data));
const B = t('analyze columnar', () => analyze(JSON.parse(JSON.stringify(col)), source));
const O = t('analyze object paths', () => analyze(JSON.parse(JSON.stringify(data))));
const excludeText = out => out === '.text';
const FA = t('filter objects', () => analyze(JSON.parse(JSON.stringify(data)), { ...source, excludeOutput: excludeText }));
const FB = t('filter columnar', () => analyze(JSON.parse(JSON.stringify(col)), { ...source, excludeOutput: excludeText }));

// 1. formats agree
ok(A.N === B.N && A.edgeCount === B.edgeCount && A.refCount === B.refCount, `same sections and references (${A.N}, ${A.edgeCount}, ${A.refCount})`);
ok(A.total.live === B.total.live && A.total.dead === B.total.dead, 'same live and eliminated bytes');
ok(FA.N === FB.N && FA.edgeCount === FB.edgeCount && FA.N < A.N && FA.edgeCount <= A.edgeCount, 'output-section filtering removes matching sections and references in both formats');
ok(FA.nodes.every(n => n.out !== '.text') && FB.nodes.every(n => n.out !== '.text'), 'filtered analyses contain no excluded output sections');
let retDiff = 0, nodeDiff = 0;
for (let i = 0; i < A.N; i++) {
  if (A.ret[i] !== B.ret[i]) retDiff++;
  const a = A.nodes[i], b = B.nodes[i];
  if (a.name !== b.name || a.path !== b.path || a.kind !== b.kind || a.out !== b.out || a.hot !== b.hot || a.live !== b.live || a.root !== b.root || a.addr !== b.addr || a.align !== b.align) nodeDiff++;
}
ok(retDiff === 0, 'same retained sizes for every section');
ok(nodeDiff === 0, 'same names, paths, kinds, output sections, flags, addresses and alignment for every section');
ok(A.deadFiles.length === B.deadFiles.length && A.islands.length === B.islands.length && A.misplaced.length === B.misplaced.length, 'same dropped files, unused islands and misplaced files');

// 2. planted stories
const mod = (name) => { const i = A.mods.findIndex((m) => m.name === name); return { m: A.mods[i], g: A.roleSub[i] }; };
const dom = (name) => { const i = A.doms.findIndex((d) => d.name === name); return { d: A.doms[i], g: A.roleDom[i] }; };
const deadShare = A.total.dead / A.total.pre;
ok(A.mods.length > 280 && A.doms.length === 20, `about 300 subsystems in 20 directories (${A.mods.length})`);
ok(A.total.live > 300 * 1048576 && A.total.live < 360 * 1048576, `image is several hundred MiB (${(A.total.live / 1048576).toFixed(0)} MiB)`);
ok(deadShare > 0.15 && deadShare < 0.25, `about 20% of the linker input is eliminated (${(100 * deadShare).toFixed(1)}%)`);
ok(A.unreachable === 0, 'every live section is reachable from a root');
for (const s of ['ml/models_legacy', 'apps/demo_mode', 'media/codec_vp9']) ok(mod(s).m.live === 0 && mod(s).m.dead > 0, `${s} is eliminated completely`);
const mv = mod('ml/models_vision').g;
ok(mv.ownerShare >= 0.6 && A.nodes[mv.owner].name === 'apps::camera_app::Scene::loadModels', 'ml/models_vision is reachable only through Scene::loadModels');
const icu = mod('third_party/icu').g;
ok(icu.ownerShare >= 0.6 && A.nodes[icu.owner].name === 'ui::text::Shaper::shapeComplex', 'third_party/icu is reachable only through Shaper::shapeComplex');
const tel = mod('services/telemetry').g;
ok(tel.breadth >= 0.6 && tel.privateShare > 0.7, `services/telemetry is widely used with a large private body (${tel.callerDoms.size} directories, ${(100 * tel.privateShare).toFixed(0)}% private)`);
const libc = mod('base/libc').g;
ok(libc.breadth >= 0.9 && libc.privateShare < 0.5, 'base/libc is thin shared infrastructure');
const radio = dom('radio').g;
ok(radio.breadth < 0.35 && radio.ifaceCount < 40, `radio/ is an isolated stack behind a narrow interface (${radio.ifaceCount} entry sections)`);
ok(A.misplaced.length >= 8, `files in the wrong place are detected (${A.misplaced.length})`);
ok(A.families.some((f) => f.family.startsWith('pb::Message')), 'template families are detected');
let elig = 0, comp = 0, hot = 0;
for (const n of A.nodes) { if (!n.live || n.kind === 'bss') continue; comp += n.size; if (/\.z$/.test(n.out)) elig += n.size; if (n.hot) hot++; }
ok(elig / comp > 0.05 && elig / comp < 0.25, `some code and data is already compressed (${(100 * elig / comp).toFixed(0)}% of compressible bytes)`);
ok(hot > 100, `hot sections are marked (${hot})`);
const blob = A.nodes.find((n) => n.name === 'ml::models_vision::kDetectorV3Weights');
ok(blob && blob.live && blob.out === '.rodata', 'the vision model weights are live and uncompressed');

// 3. build system: object files follow build targets; DWARF records where the source lives
const S = data.symbolDetails, file = (i) => S.sourceFiles[S.symbols[i].sourceFile];
ok(A.details.mapped > 0.99 * A.N && A.details.mixed === 0, `nearly every section has one DWARF source file (${A.details.mapped} of ${A.N})`);
const unmapped = data.nodes.filter((n) => S.symbols[n.id].sourceFile == null).map((n) => n.name);
ok(unmapped.includes('Reset_Handler') && unmapped.includes('dsp_fw_image') && unmapped.length < 10, `boot assembly and binary blobs have no DWARF source (${unmapped.join(', ')})`);
ok(data.nodes.every((n) => S.symbols[n.id].sourceFile == null || file(n.id) !== n.path), 'every mapped object path differs from its source path');
const sample = (re) => data.nodes.find((n) => re.test(n.name));
const pc = sample(/^pc_|^[a-z]+_[a-z]+_[a-z]+$/);
ok(/^[^/]+\/[^/]+\/[^/]+\.[^/]+\.o$/.test(pc.path) && file(pc.id).split('/').length === 4, `first-party objects are flattened per subsystem target (${pc.path} from ${file(pc.id)})`);
const vendored = data.nodes.find((n) => n.path.startsWith('third_party/icu/CMakeFiles/'));
ok(vendored && file(vendored.id).startsWith('third_party/icu/source/'), 'vendored libraries keep their upstream sources and a CMake object tree');
const tpl = sample(/^pb::Message</);
ok(file(tpl.id) === 'base/protobuf_rt/core/message.hpp' && !tpl.path.startsWith('base/protobuf_rt/') && S.symbols[tpl.id].flags & 2, `template instantiations are weak symbols in their users' objects (${tpl.path})`);
const msz = (X, name) => X.mods.find((m) => m.name === name).live;
ok(msz(A, 'base/protobuf_rt') > 5 * msz(O, 'base/protobuf_rt'), 'protobuf templates are charged to base/protobuf_rt by source and to their users by object');
ok(O.misplaced.length < A.misplaced.length && A.misplaced.length >= 8, `some misplaced files are already built by the subsystem they talk to (${A.misplaced.length} by source, ${O.misplaced.length} by object)`);
ok(A.doms.length === O.doms.length && A.mods.length === O.mods.length, 'both path modes keep the same directories and subsystems');

// 4. link-time layout: every live section placed once, aligned, inside the region, output sections contiguous
const placed = A.nodes.filter((n) => n.live).sort((a, b) => a.addr - b.addr), ram = A.regions[0];
let overlaps = 0, misaligned = 0, interleaved = 0;
const seenOut = new Set();
placed.forEach((n, i) => {
  if (i && n.addr < placed[i - 1].addr + placed[i - 1].size) overlaps++;
  if (!n.align || n.addr % n.align) misaligned++;
  if (i && n.out !== placed[i - 1].out) { if (seenOut.has(n.out)) interleaved++; seenOut.add(placed[i - 1].out); }
});
ok(A.addressed === placed.length && placed.every((n) => n.addr >= 0), `every live section has an address (${A.addressed})`);
ok(A.nodes.every((n) => n.live || n.addr === -1), 'eliminated sections have no address');
ok(overlaps === 0 && misaligned === 0, 'live sections do not overlap and respect their alignment');
ok(interleaved === 0 && placed[0].name === '__vector_table', 'output sections are contiguous, with the vector table first');
const end = placed.at(-1).addr + placed.at(-1).size;
ok(ram.start === 0x80000000 && placed[0].addr === ram.start && end <= ram.start + ram.size, `the image fits the RAM region (${(end - ram.start) / 1048576 | 0} of ${ram.size / 1048576} MiB)`);
ok(A.capacity === ram.size, 'region capacity comes from {start, size} regions');

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
