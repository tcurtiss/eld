// Included inside ui.js's closure by the single-file build.
/* exported openRelationshipExplorer */
const EX = {model: null, analysis: null, level: 'dom', view: 'graph', arrange: 'links', color: 'group', maximized: false, direction: 'both', hops: 1,
  metric: 'count', type: 'all', nodes: 50, edges: 150, strongest: 1, min: 1,
  shared: 'show', expanded: [], focus: [], trail: [], pinned: null, result: null, cacheKey: '',
  positions: new Map(), transform: null, zoom: null, svg: null, simulation: null,
  graphNodes: [], graphWidth: 0, graphHeight: 0, forceKey: '', paused: reduceMotion(), alpha: 0, draw: null, highlight: null, compactTools: null};

function exStopGraph() {
  if (!EX.simulation) return;
  EX.alpha = EX.simulation.alpha(); EX.simulation.stop();
  for (const n of EX.graphNodes) EX.positions.set(n.key, {
    x: n.x / EX.graphWidth, y: n.y / EX.graphHeight,
    fixed: n.fx != null, vx: n.vx, vy: n.vy,
  });
  EX.simulation = null; EX.svg = null; EX.zoom = null; EX.draw = null; EX.highlight = null;
}

function explorerModel() {
  if (EX.analysis !== A) {
    exStopGraph(); EX.forceKey = '';
    EX.analysis = A; EX.model = new RelationshipModel(A); EX.expanded = []; EX.focus = []; EX.trail = [];
    EX.pinned = null; EX.result = null; EX.cacheKey = ''; EX.positions.clear(); EX.transform = null;
    $('#exDetail').hidden = true; $('#exPath').textContent = ''; $('#exResults').innerHTML = '';
  }
  return EX.model;
}
function exKeyName(key) {
  const model = explorerModel();
  if (key.startsWith('section:')) return A.nodes[+key.split(':')[1]]?.name;
  if (key.startsWith('s:') || key.startsWith('n:')) { const g = model.symbols(), i = model.position(g, key); return i >= 0 ? g.meta(i)?.name : null; }
  return model.groupMeta(key)?.name;
}
function exStateName(s) { return s.focus.map(exKeyName).filter(Boolean).join(' and ') || (s.level === 'mod' ? 'All subsystems' : null); }
function renderExplorerCrumbs() {
  // Whole image, then each step of the drill-down trail; the last one is the current view.
  const steps = [...EX.trail.map((s, at) => ({s, at})), {s: EX, at: -1}].filter(({s}) => exStateName(s));
  const current = steps.length && steps[steps.length - 1].at < 0;
  if (current) $('#exOverview').removeAttribute('aria-current'); else $('#exOverview').setAttribute('aria-current', 'location');
  $('#exCrumbTrail').innerHTML = steps.map(({s, at}) => '<span class="sep" aria-hidden="true">/</span>' + (at < 0 ?
    `<span aria-current="location">${esc(exStateName(s))}</span>` : `<button type="button" data-trail="${at}">${esc(exStateName(s))}</button>`)).join('');
  $('#exCrumbTrail').querySelectorAll('[data-trail]').forEach(button => button.onclick = () => {
    const at = +button.dataset.trail, target = EX.trail[at];
    EX.trail = EX.trail.slice(0, at); Object.assign(EX, target); EX.cacheKey = '';
    tipHide(); $('#exPath').textContent = ''; $('#exResults').innerHTML = ''; renderExplorer();
  });
}
function exSetMaximized(on) {
  EX.maximized = on;
  $('.explorer-workbench').classList.toggle('is-max', on);
  document.documentElement.style.overflow = on ? 'hidden' : '';
  const button = $('#exMax'), label = on ? 'Exit expanded graph' : 'Expand graph';
  button.setAttribute('aria-pressed', String(on)); button.title = label; button.querySelector('.sr-only').textContent = label;
  button.querySelector('path').setAttribute('d', on ? 'M6 2v4H2M10 2v4h4M14 10h-4v4M2 10h4v4' : 'M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4');
  EX.transform = null; renderExplorer();
}
function exStored(n) {
  if (n.level === 'd') return C.D[n.i].stored;
  if (n.level === 'm') return C.M[n.i].stored;
  const section = A.nodes[n.section];
  return n.level === 's' ? n.bytes * (section.size ? C.stored[section.i] / section.size : 1) : C.stored[n.section];
}
function exTypeName(src, dst) { return (src.kind === 'code' ? 'Code' : 'Data') + ' to ' + (dst.kind === 'code' ? 'code' : 'data'); }
function exAttribution(bits) {
  return [[1, 'source approximate'], [2, 'source unattributed'], [4, 'trampoline'], [8, 'target approximate']]
    .filter(([bit]) => bits & bit).map(([, name]) => name).join(', ') || 'no approximation flag';
}
function exEndpoint(s, section) {
  const n = A.nodes[section]; if (!n) return '';
  const name = s ? s.name : n.name + ' [section only]';
  return `${esc(name)}${s?.linkageName && s.linkageName !== s.name ? '<br>Linkage: ' + esc(s.linkageName) : ''}` +
    `<br>${esc(n.objectPath || n.path)}` + (s?.sourceFile ? `<br>Declaration: ${esc(s.sourceFile)}:${s.sourceLine}` : '');
}
function exNodeTip(n) {
  const symbol = n.level === 's', label = symbol ? 'Symbol range' : n.level === 'n' ? 'Physical section' : 'Stored in RAM';
  let text = `<strong>${esc(n.name)}</strong><br>${label}: ${fmtB(symbol ? n.bytes : exStored(n))}`;
  if (n.symbol?.linkageName && n.symbol.linkageName !== n.name) text += `<br>Linkage: ${esc(n.symbol.linkageName)}`;
  if(n.symbol)text+=`<br>Chunk ${n.symbol.chunk}, offset ${num(n.symbol.offset)}; ${n.symbol.flags&1?'local':n.symbol.flags&2?'weak':'global'} binding`;
  if (n.kind) text += `<br>${KIND_NAME[n.kind] || 'Data'}; ${esc(A.mods[n.mods[0]].name)}`;
  for (const path of n.paths || []) text += '<br>' + esc(path);
  if (n.source) text += `<br>Declaration source: ${esc(n.source)}${n.line ? ':' + n.line : ''}`;
  if (n.sectionOnly) text += '<br>Section-only attribution';
  if (n.outgoing != null) text += `<br>${num(n.incoming)} incoming; ${num(n.outgoing)} external outgoing reference uses`;
  if (n.internal) text += `<br>${num(n.internal)} internal reference uses`;
  return text;
}
// Shape shows what a node is: hexagon directory, diamond subsystem, circle
// function, square data symbol. A hollow outline is a section without symbol information.
const EX_TYPES = {
  dir: {shape: 'hex', name: 'Top-level directory', key: 'Directory'},
  mod: {shape: 'diamond', name: 'Subsystem', key: 'Subsystem'},
  code: {shape: 'circle', name: 'Function', key: 'Function'},
  data: {shape: 'square', name: 'Data symbol', key: 'Data'},
  section: {shape: 'circle', hollow: true, name: 'Section without symbol information', key: 'Section without symbol'},
  dataSection: {shape: 'square', hollow: true, name: 'Data section without symbol information', key: 'Data section without symbol'},
};
function exType(n) {
  if (n.level === 'd') return EX_TYPES.dir;
  if (n.level === 'm') return EX_TYPES.mod;
  const data = n.kind && n.kind !== 'code';
  return n.level === 'n' ? (data ? EX_TYPES.dataSection : EX_TYPES.section) : data ? EX_TYPES.data : EX_TYPES.code;
}
// Shapes are scaled so they read as about the same size as a circle of radius r.
const EX_SHAPE_SCALE = {circle: 1, square: 1, hex: 1.1, diamond: 1.25};
function exShapePath(shape, r) {
  const R = r * EX_SHAPE_SCALE[shape];
  if (shape === 'square') return `M${-R},${-R}H${R}V${R}H${-R}Z`;
  if (shape === 'diamond') return `M0,${-R}L${R},0L0,${R}L${-R},0Z`;
  if (shape === 'hex') { const h = R * Math.sqrt(3) / 2; return `M${-R},0L${-R / 2},${-h}L${R / 2},${-h}L${R},0L${R / 2},${h}L${-R / 2},${h}Z`; }
  return `M${R},0A${R},${R} 0 1 1 ${-R},0A${R},${R} 0 1 1 ${R},0Z`;
}
function exGlyph(type, color) {
  const fill = type.hollow ? 'none' : color, stroke = type.hollow ? color : 'none';
  return `<svg class="ex-glyph" viewBox="-8 -8 16 16" width="14" height="14" aria-hidden="true"><path d="${exShapePath(type.shape, 5.4)}" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/></svg>`;
}
function exGraphNodeTip(n) {
  let text = `<strong>${esc(n.name)}</strong><br>Type: ${exType(n).name}`;
  if (n.kind) text += `<br>Kind: ${KIND_NAME[n.kind] || 'Data'}`;
  if (n.shared) text += '<br>Shared infrastructure';
  text += `<br>${n.level === 's' ? 'Symbol range' : 'Stored in RAM'}: ${fmtB(n.level === 's' ? n.bytes : exStored(n))}`;
  text += `<br>External refs in: ${num(n.incoming)}<br>External refs out: ${num(n.outgoing)}`;
  text += `<br>Distinct dependents: ${num(n.dependents)}`;
  if (n.groupSize > 1) text += `<br>Connected group: ${num(n.groupSize)} items around ${esc(n.groupLead)}`;
  if (n.internal) text += `<br>Internal refs: ${num(n.internal)}`;
  return text;
}
function exEdgeTip(e, result, showEvidence = true) {
  const model = explorerModel(), src = result.g.meta(e.source), dst = result.g.meta(e.target);
  let text = `<strong>${esc(src.name)}</strong> uses <strong>${esc(dst.name)}</strong><br>${num(e.count)} static reference uses` +
    `<br>${pctS(e.share, 1)} of the caller’s full external references; ${pctS(e.mutual, 1)} reciprocal strength`;
  if (src.kind && dst.kind) text += '<br>' + exTypeName(src, dst);
  if (!showEvidence) return text;
  if (e.flags) text += '<br>' + exAttribution(e.flags);
  const refs = model.preview(src, dst,EX.type);
  for (const r of refs) text += '<br><br>' + exEndpoint(r.src, r.sourceSection) + '<br>→ ' + exEndpoint(r.dst, r.targetSection) +
    `<br>${num(r.count)} uses; ${r.src && r.dst && !r.flags ? 'exact endpoints' : exAttribution(r.flags)}`;
  return text;
}
function exHover(html, ev) {
  if (!Number.isFinite(ev.clientX)) { const r = ev.currentTarget.getBoundingClientRect(); tipShow(html, {clientX: r.left + r.width / 2, clientY: r.top}); }
  else tipShow(html, ev);
}
function exBind(selection, tip, pin) {
  selection.attr('tabindex', 0).attr('role', 'button')
    .on('mousemove', (ev, n) => exHover(tip(n), ev)).on('mouseleave', tipHide)
    .on('focus', (ev, n) => exHover(tip(n), ev)).on('blur', tipHide)
    .on('click', (ev, n) => { if (ev.defaultPrevented) return; ev.stopPropagation(); tipHide(); pin(n, ev); })
    .on('keydown', (ev, n) => { if ((ev.key === 'Enter' && !ev.shiftKey) || ev.key === ' ') { ev.preventDefault(); tipHide(); pin(n, ev); } });
}
function exSetSelection(n) {
  const mod = n.mods.slice().sort((x, y) => A.mods[y].live - A.mods[x].live)[0];
  if (mod != null) state.selected = A.mods[mod].name;
  if (n.section != null) state.searchNode = n.section;
  renderInspector();
}
function exRefreshSelection() {
  if (EX.view !== 'graph' || !EX.svg) { renderExplorer(); return; }
  EX.svg.selectAll('.rel-node').classed('is-sel', n => EX.pinned?.node === n.key)
    .attr('aria-pressed', n => String(EX.pinned?.node === n.key));
  EX.svg.selectAll('.rel-edge').classed('is-sel', e => EX.pinned?.source === EX.result.g.meta(e.source).key && EX.pinned?.target === EX.result.g.meta(e.target).key);
  EX.highlight?.();
  renderExplorerDetail(EX.result);
}
function exPinNode(n) { EX.pinned = {node: n.key}; exSetSelection(n); exRefreshSelection(); }
function exToggleGraphNode(n, ev) {
  // The second click belongs to the double-click expansion gesture.
  if (ev?.detail > 1) return;
  EX.pinned = EX.pinned?.node === n.key ? null : {node: n.key};
  if (EX.pinned) exSetSelection(n);
  exRefreshSelection();
}
function exExpandNode(n) {
  if (n.level !== 'd' && n.level !== 'm') return;
  EX.trail.push({level: EX.level, expanded: EX.expanded.slice(), focus: EX.focus.slice(), pinned: EX.pinned, transform: EX.transform});
  exSetSelection(n);
  if (n.level === 'd') {
    EX.level = 'dom';
    if (!EX.expanded.includes(n.i)) EX.expanded = [...EX.expanded, n.i];
  } else EX.level = 'symbol';
  EX.focus = [n.key]; EX.pinned = null; EX.cacheKey = ''; EX.transform = null;
  tipHide(); $('#exPath').textContent = ''; $('#exResults').innerHTML = ''; renderExplorer();
}
function exPinEdge(e, result) {
  const src = result.g.meta(e.source), dst = result.g.meta(e.target);
  EX.pinned = {source: src.key, target: dst.key, edge: e}; exSetSelection(src);
  if (src.level === 'm' && dst.level === 'm') state.dsmPair = {level: 'mod', a: src.i, b: dst.i};
  else if (src.level === 'd' && dst.level === 'd') state.dsmPair = {level: 'dom', a: src.i, b: dst.i};
  exRefreshSelection(); renderDSM(); renderPairFocus(); renderCollocation();
}
function exFocus(key, level) {
  explorerModel(); EX.level = level || (key.startsWith('s:') || key.startsWith('n:') ? 'symbol' : key.startsWith('m:') ? 'mod' : 'dom');
  EX.trail = [];
  EX.focus = [key]; EX.pinned = key.startsWith('section:')?null:{node: key}; EX.cacheKey = ''; EX.transform = null;
  const g = EX.level === 'symbol' ? EX.model.symbols() : EX.model.groups(EX.level, EX.expanded, EX.type);
  const i = EX.model.position(g, key); if (i >= 0) exSetSelection(g.meta(i));
  activateWorkspace('connectivity', 'explorer'); scrollToElement($('#v-explorer'));
}
function openRelationshipExplorer(level = 'mod', a = null, b = null) {
  explorerModel(); EX.level = level; EX.metric = state.dsmMetric; EX.focus = a == null ? [] : [(level === 'dom' ? 'd:' : 'm:') + a];
  EX.trail = [];
  if (b != null) EX.focus.push((level === 'dom' ? 'd:' : 'm:') + b);
  EX.cacheKey = ''; EX.transform = null;
  EX.pinned = b != null ? {source: EX.focus[0], target: EX.focus[1]} : a != null ? {node: EX.focus[0]} : null;
  activateWorkspace('connectivity', 'explorer'); scrollToElement($('#v-explorer'));
}

const GROUP_PULL = .3;

function exFitGraph() {
  if (!EX.svg || !EX.zoom || !EX.graphNodes.length) return;
  // Labels keep a constant screen size, so reserve their room in screen pixels.
  const nodes = EX.graphNodes, padX = 70, padTop = 20, padBottom = 50;
  const x0 = Math.min(...nodes.map(n => n.x - n.extent)), x1 = Math.max(...nodes.map(n => n.x + n.extent));
  const y0 = Math.min(...nodes.map(n => n.y - n.extent)), y1 = Math.max(...nodes.map(n => n.y + n.extent));
  const k = Math.min(1, (EX.graphWidth - 2 * padX) / Math.max(1, x1 - x0), (EX.graphHeight - padTop - padBottom) / Math.max(1, y1 - y0));
  EX.svg.call(EX.zoom.transform, d3.zoomIdentity.translate(EX.graphWidth / 2 - k * (x0 + x1) / 2,
    padTop + (EX.graphHeight - padTop - padBottom) / 2 - k * (y0 + y1) / 2).scale(k));
}

function renderExplorerGraph(result) {
  const wrap = $('#exChart'), width = Math.max(340, wrap.clientWidth || 850);
  // Fill the window below the graph's header; expanded mode uses everything down to the footer.
  const height = EX.maximized ? Math.max(320, Math.floor(innerHeight - wrap.getBoundingClientRect().top - $('.explorer-stage-foot').offsetHeight - 14)) :
    Math.max(440, Math.min(1000, innerHeight - 170));
  if (width !== EX.graphWidth || height !== EX.graphHeight) EX.transform = null;
  EX.graphWidth = width; EX.graphHeight = height;
  const maxSize = Math.max(1, ...result.nodes.map(exStored));
  const appearance = new Map(result.nodes.map(n => {
    const radius = 10 + 15 * Math.sqrt(Math.max(0, exStored(n)) / maxSize);
    const label = n.name.length > 24 ? n.name.slice(0, 23) + '…' : n.name, labelWidth = Math.max(60, label.length * 6.3);
    // Connections pack by circle size and hide overlapping labels; bands keep room for every label.
    const type = exType(n), extent = radius * EX_SHAPE_SCALE[type.shape];
    return [n.key, {radius, extent, type, label, labelWidth, collisionRadius: EX.arrange === 'links' ? extent + 10 : Math.max(extent + 34, labelWidth / 2 + 8)}];
  }));
  const spacing = Math.max(115, ...Array.from(appearance.values(), n => 2 * n.collisionRadius + 12));
  const model = explorerModel(), radial = model.radial(result, spacing);
  // D3 assigns its own node.index; keep the model's projection id for links.
  const communities = model.communities(result);
  const nodes = radial.map(n => {
    const old = EX.positions.get(n.key), community = communities.groups[communities.groupOf.get(n.index)];
    const x = old ? old.x * width : width / 2 + n.seedX;
    const y = old ? old.y * height : height / 2 + n.seedY;
    return {...n, graphIndex: n.index, x, y, vx: old?.vx || 0, vy: old?.vy || 0, fx: old?.fixed ? x : null, fy: old?.fixed ? y : null,
      ...appearance.get(n.key), group: community.id, groupSize: community.members.length, groupLead: community.lead,
      shared: n.breadth >= state.tau};
  });
  const hub = nodes[0], all = model.displayedLinks(result), hidden = all.length - result.edges.length;
  const center = hub.anchor ? `The focused item ${hub.name} starts at the center.` : hub.dependents ?
    `${hub.name}, used by ${num(hub.dependents)} distinct items, starts at the center.` : 'No item here has external incoming references of the selected type.';
  $('#exRadial').textContent = EX.arrange === 'links' ?
    `${center} Items that make up a larger share of each other’s references are pulled closer. The layout uses all ${num(all.length)} relationships among these items, including ${num(hidden)} not drawn as arrows.` :
    `${center} Items used by more distinct callers start nearer the center and stay in bands. Ranking includes hidden incoming references of the selected type.`;
  const connected = communities.groups.filter(g => g.members.length > 1);
  if (connected.length) $('#exRadial').textContent += ` These items form ${num(connected.length)} connected group${connected.length === 1 ? '' : 's'}; the largest has ${num(connected[0].members.length)} items around ${connected[0].lead}.`;
  const groupColor = n => n.groupSize > 1 ? PALETTE[n.group % PALETTE.length] : cssVar('--ink-3');
  const fill = n => EX.color === 'group' ? groupColor(n) : domColor(n.di);
  const legend = $('#exGroups');
  legend.hidden = EX.color !== 'group' || !connected.length;
  legend.innerHTML = connected.slice(0, 8).map(g => `<span><i class="ex-swatch" style="background:${PALETTE[g.id % PALETTE.length]}"></i>${num(g.members.length)} around ${esc(g.lead)}</span>`).join('') +
    (connected.length > 8 ? `<span>${num(connected.length - 8)} smaller groups</span>` : '') +
    (connected.length < communities.groups.length ? `<span><i class="ex-swatch" style="background:${cssVar('--ink-3')}"></i>Not grouped</span>` : '');
  EX.graphNodes = nodes;
  const present = Object.values(EX_TYPES).filter(type => nodes.some(n => n.type === type));
  $('#exShapes').innerHTML = present.map(type => `<span role="listitem">${exGlyph(type, cssVar('--ink-2'))}${type.key}</span>`).join('');
  $('#exShapes').hidden = false;
  const positions = new Map(nodes.map(n => [n.graphIndex, n])), pairs = new Set(result.edges.map(e => e.source + ':' + e.target));
  const svg = d3.select(wrap).append('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('width', '100%').attr('height', height)
    .attr('role', 'group').attr('aria-label', 'Interactive force-directed relationship graph').attr('data-layout-links', all.length);
  EX.svg = svg;
  const defs = svg.append('defs');
  for (const [id, color] of [['exArrow', cssVar('--ink-3')], ['exArrowOut', cssVar('--accent')], ['exArrowIn', '#2A9384']]) {
    defs.append('marker').attr('id', id).attr('viewBox', '0 -4 8 8').attr('refX', 7).attr('markerWidth', 9)
      .attr('markerHeight', 9).attr('markerUnits', 'userSpaceOnUse').attr('orient', 'auto')
      .append('path').attr('d', 'M0,-3L7,0L0,3').attr('fill', color);
  }
  const scene = svg.append('g'), maxWeight = Math.max(1, ...result.edges.map(e => e.value));
  const selected = e => EX.pinned?.source === result.g.meta(e.source).key && EX.pinned?.target === result.g.meta(e.target).key;
  let visiblePairs = pairs;
  const curve = e => {
    const src = positions.get(e.source), dst = positions.get(e.target), dx = dst.x - src.x, dy = dst.y - src.y;
    const length = Math.hypot(dx, dy) || 1, bend = visiblePairs.has(e.target + ':' + e.source) ? 24 : 0;
    const boundary = n => n.type.shape === 'square' ? n.extent * length / Math.max(Math.abs(dx), Math.abs(dy), 1) :
      n.type.shape === 'diamond' ? n.extent * length / Math.max(Math.abs(dx) + Math.abs(dy), 1) : n.type.shape === 'hex' ? n.extent * .93 : n.extent;
    const sx = src.x + dx / length * (boundary(src) + 2), sy = src.y + dy / length * (boundary(src) + 2);
    const tx = dst.x - dx / length * (boundary(dst) + 9), ty = dst.y - dy / length * (boundary(dst) + 9);
    return `M${sx},${sy}Q${(sx + tx) / 2 - dy / length * bend},${(sy + ty) / 2 + dx / length * bend} ${tx},${ty}`;
  };
  // Relationships hidden by display limits appear only around a highlighted item.
  const extraGroup = scene.append('g'), edgeGroup = scene.append('g');
  const paths = edgeGroup.selectAll('.rel-edge').data(result.edges).join('path').attr('class', e => 'rel-edge' + (selected(e) ? ' is-sel' : ''))
    .attr('marker-end', 'url(#exArrow)').attr('stroke-width', e => 1.2 + 3 * Math.sqrt(e.value / maxWeight))
    .attr('stroke-dasharray', e => e.flags & 9 ? '5,4' : null)
    .attr('aria-label', e => `${result.g.meta(e.source).name} uses ${result.g.meta(e.target).name}, ${e.count} references`);
  exBind(paths, e => exEdgeTip(e, result, false), e => exPinEdge(e, result));
  const hits = edgeGroup.selectAll('.rel-edge-hit').data(result.edges).join('path').attr('class', 'rel-edge-hit');
  exBind(hits, e => exEdgeTip(e, result, false), e => exPinEdge(e, result)); hits.attr('tabindex', -1).attr('aria-hidden', 'true');
  const group = scene.append('g').selectAll('.rel-node').data(nodes).join('g')
    .attr('class', n => 'rel-node' + (EX.pinned?.node === n.key ? ' is-sel' : ''))
    .attr('aria-label', n => `${n.name}, ${exType(n).name.toLowerCase()}`)
    .attr('aria-pressed', n => String(EX.pinned?.node === n.key))
    .attr('aria-description', n => 'Click or press Enter to toggle highlighting. ' +
      (n.level === 'd' || n.level === 'm' ? 'Double-click or press Shift+Enter to expand contents. ' : '') +
      'Drag to hold position; press Escape to release. Arrow keys move the node.');
  // Keep the short name available as a stable label for search and linked views.
  group.attr('data-name', n => n.name).attr('data-key', n => n.key).attr('data-type', n => n.type.key);
  group.each(function(n) {
    d3.select(this).append('path').attr('class', 'rel-shape' + (n.type.hollow ? ' is-hollow' : '')).attr('d', exShapePath(n.type.shape, n.radius))
      .attr('fill', n.type.hollow ? cssVar('--paper') : fill(n)).attr('stroke', n.type.hollow ? fill(n) : cssVar('--surface'))
      .attr('stroke-width', n.type.hollow ? 3 : 2).attr('stroke-linejoin', 'round')
      .attr('stroke-dasharray', n.shared ? '3,2' : null);
    d3.select(this).append('text').attr('class', 'rel-name').attr('text-anchor', 'middle').text(n.label);
    d3.select(this).append('text').attr('class', 'rel-caption').attr('text-anchor', 'middle')
      .text(n.shared ? 'shared' : n.level === 'd' ? 'directory, ' + n.mods.length + ' subsystems' : n.level === 'm' ? 'subsystem' : n.sectionOnly ? 'section' : n.kind === 'code' ? 'function' : 'data');
    d3.select(this).append('circle').attr('class', 'rel-position-lock').attr('cx', n.extent * .75).attr('cy', -n.extent * .75).attr('r', 4);
  });
  exBind(group, exGraphNodeTip, exToggleGraphNode);
  // Labels keep a constant screen size. Place them greedily without overlap:
  // the highlighted item and its neighbors first, then the focus and center,
  // then the most widely used items. Zooming in reveals the rest.
  const placeLabels = () => {
    const s = 1 / (EX.transform?.k || 1), pinned = nodes.find(n => EX.pinned?.node === n.key), near = new Set(), placed = [];
    if (pinned) for (const e of all) if (e.source === pinned.graphIndex || e.target === pinned.graphIndex) { near.add(e.source); near.add(e.target); }
    const rank = n => n === pinned ? 0 : near.has(n.graphIndex) ? 1 : n.anchor || n.dependenceRank === 0 ? 2 : 3;
    for (const n of nodes.slice().sort((x, y) => rank(x) - rank(y) || y.dependents - x.dependents || y.radius - x.radius || x.dependenceRank - y.dependenceRank)) {
      const half = n.labelWidth * s / 2, top = n.y + n.extent + 2 * s, box = [n.x - half, top, n.x + half, top + 28 * s];
      n.labelShown = !placed.some(b => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3]);
      if (n.labelShown) placed.push(box);
    }
    group.select('.rel-name').attr('y', n => n.extent + 13 * s).style('font-size', 11 * s + 'px').style('stroke-width', 3 * s + 'px')
      .attr('display', n => n.labelShown ? null : 'none');
    group.select('.rel-caption').attr('y', n => n.extent + 26 * s).style('font-size', 10 * s + 'px').style('stroke-width', 3 * s + 'px')
      .attr('display', n => n.labelShown ? null : 'none');
  };
  EX.highlight = () => {
    const n = nodes.find(item => EX.pinned?.node === item.key);
    const touches = e => e.source === n.graphIndex || e.target === n.graphIndex;
    const extra = n ? all.filter(e => touches(e) && !pairs.has(e.source + ':' + e.target)) : [];
    visiblePairs = new Set([...pairs, ...extra.map(e => e.source + ':' + e.target)]);
    const extras = extraGroup.selectAll('.rel-edge-extra').data(extra, e => e.source + ':' + e.target).join('path')
      .attr('class', 'rel-edge-extra')
      .attr('aria-label', e => `${result.g.meta(e.source).name} uses ${result.g.meta(e.target).name}, ${e.count} references, hidden by display limits`);
    exBind(extras, e => exEdgeTip(e, result, false) + '<br>Hidden by display limits', e => exPinEdge(e, result)); extras.attr('tabindex', -1);
    paths.attr('d', curve);
    if (!n) {
      group.style('opacity', null);
      paths.style('stroke-opacity', null).style('stroke', null).attr('marker-end', 'url(#exArrow)');
      return;
    }
    const neighbors = new Set([n.graphIndex]);
    for (const e of [...result.edges, ...extra]) if (touches(e)) { neighbors.add(e.source); neighbors.add(e.target); }
    group.style('opacity', item => neighbors.has(item.graphIndex) ? 1 : .2);
    const stroke = e => e.source === n.graphIndex ? cssVar('--accent') : e.target === n.graphIndex ? '#2A9384' : null;
    const marker = e => `url(#${e.source === n.graphIndex ? 'exArrowOut' : e.target === n.graphIndex ? 'exArrowIn' : 'exArrow'})`;
    paths.style('stroke-opacity', e => touches(e) ? 1 : .1).style('stroke', stroke).attr('marker-end', marker);
    extras.style('stroke', stroke).attr('marker-end', marker).attr('d', curve);
  };
  const highlight = EX.highlight;
  EX.highlight = () => { highlight(); placeLabels(); };
  EX.highlight();
  const simulation = d3.forceSimulation(nodes).stop()
    .force('collision', d3.forceCollide(n => n.collisionRadius).iterations(3)).velocityDecay(.4);
  if (EX.arrange === 'links') {
    // Lay out by connectivity: one undirected spring per related pair, using
    // every relationship among displayed items, weighted by the larger share
    // of either side's external references, so large items' raw reference
    // counts don't decide which pairs sit together.
    const springs = new Map();
    for (const e of all) {
      const key = Math.min(e.source, e.target) + ':' + Math.max(e.source, e.target);
      const spring = springs.get(key) || {source: e.source, target: e.target, weight: 0};
      spring.weight = Math.max(spring.weight, e.share); springs.set(key, spring);
    }
    const linked = new Set([...springs.values()].flatMap(e => [e.source, e.target]));
    const maxShare = Math.max(1e-9, ...Array.from(springs.values(), e => e.weight)), closeness = e => Math.sqrt(e.weight / maxShare);
    simulation.force('link', d3.forceLink([...springs.values()]).id(n => n.graphIndex)
      .distance(e => e.source.radius + e.target.radius + 50 + 90 * (1 - closeness(e)))
      .strength(e => .6 * (.15 + .85 * closeness(e))))
      .force('charge', d3.forceManyBody().strength(-600).distanceMax(Math.max(width, height)))
      // Items with no relationship here have no spring; hold them near the rest instead of letting repulsion push them away.
      .force('x', d3.forceX(width / 2).strength(n => linked.has(n.graphIndex) ? .04 : .25))
      .force('y', d3.forceY(height / 2).strength(n => linked.has(n.graphIndex) ? .04 : .25))
      .force('group', alpha => {
        // A gentle pull toward each connected group's centroid separates the groups.
        const sums = new Map();
        for (const n of nodes) if (n.groupSize > 1) {
          const c = sums.get(n.group) || {x: 0, y: 0, count: 0}; c.x += n.x; c.y += n.y; c.count++; sums.set(n.group, c);
        }
        for (const n of nodes) {
          const c = sums.get(n.group); if (!c) continue;
          n.vx += (c.x / c.count - n.x) * GROUP_PULL * alpha; n.vy += (c.y / c.count - n.y) * GROUP_PULL * alpha;
        }
      })
      .force('center', d3.forceCenter(width / 2, height / 2))
      // Applied last: keep the leading item at the center unless the user holds it elsewhere.
      .force('lead', () => { if (hub.fx == null) { hub.x = width / 2; hub.y = height / 2; hub.vx = hub.vy = 0; } });
  } else {
    const links = result.edges.map(e => ({source: e.source, target: e.target, value: e.value}));
    simulation.force('link', d3.forceLink(links).id(n => n.graphIndex)
      .distance(e => 150 - 35 * Math.sqrt(e.value / maxWeight)).strength(.12))
      .force('charge', d3.forceManyBody().strength(-420))
      .force('radial', d3.forceRadial(n => n.targetRadius, width / 2, height / 2).strength(n => n.dependenceRank === 0 ? 1 : .2))
      .force('x', d3.forceX(width / 2).strength(n => n.dependenceRank === 0 ? .8 : .008))
      .force('y', d3.forceY(height / 2).strength(n => n.dependenceRank === 0 ? .8 : .008));
  }
  EX.simulation = simulation;
  const draw = () => {
    group.attr('transform', n => `translate(${n.x},${n.y})`).classed('is-fixed', n => n.fx != null);
    paths.attr('d', curve); hits.attr('d', curve); extraGroup.selectAll('path').attr('d', curve); placeLabels();
  };
  EX.draw = draw;
  const forceKey = EX.cacheKey + '/' + EX.arrange + '/' + width + '/' + height + '/' + nodes.map(n => n.radius.toFixed(2) + ':' + n.targetRadius).join(',');
  if (forceKey !== EX.forceKey) { simulation.tick(180); EX.forceKey = forceKey; }
  else simulation.alpha(EX.alpha);
  draw(); simulation.on('tick', draw);
  const release = n => {
    n.fx = n.fy = null; draw();
    if (!EX.paused) simulation.alpha(.4).restart();
  };
  group.call(d3.drag().container(() => scene.node()).clickDistance(4)
    .on('start', (ev, n) => {
      tipHide();
      n.dragStart = {x: n.x, y: n.y, fixed: n.fx != null}; n.dragged = false; n.fx = n.x; n.fy = n.y;
    })
    .on('drag', function(ev, n) {
      // Reparenting on mouse-down can cancel an ordinary click in the browser.
      if (!n.dragged && Math.hypot(ev.x - n.dragStart.x, ev.y - n.dragStart.y) * (EX.transform?.k || 1) > 4) {
        // Reheat only for a real drag, so a click leaves the layout still.
        n.dragged = true; d3.select(this).raise();
        if (!EX.paused) simulation.alphaTarget(.2).restart();
      }
      n.x = n.fx = ev.x; n.y = n.fy = ev.y; draw();
    })
    .on('end', (ev, n) => {
      if (!n.dragged && !n.dragStart.fixed) n.fx = n.fy = null;
      if (n.dragged) simulation.alphaTarget(0);
      delete n.dragStart; delete n.dragged; draw();
    }))
    .on('dblclick.expand', (ev, n) => { ev.preventDefault(); ev.stopPropagation(); exExpandNode(n); })
    .on('keydown.position', (ev, n) => {
      if (ev.key === 'Enter' && ev.shiftKey) { ev.preventDefault(); exExpandNode(n); return; }
      if (ev.key === 'Escape') { ev.preventDefault(); release(n); return; }
      const delta = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[ev.key];
      if (!delta) return; ev.preventDefault();
      n.x = n.fx = n.x + delta[0] * (ev.shiftKey ? 30 : 10); n.y = n.fy = n.y + delta[1] * (ev.shiftKey ? 30 : 10); draw();
    });
  EX.zoom = d3.zoom().scaleExtent([.05, 8]).on('zoom', ev => { EX.transform = ev.transform; scene.attr('transform', ev.transform); placeLabels(); });
  svg.call(EX.zoom).on('dblclick.zoom', null);
  if (EX.transform) svg.call(EX.zoom.transform, EX.transform); else exFitGraph();
  group.filter(n => n.fx != null).raise();
  if (!EX.paused && simulation.alpha() > simulation.alphaMin()) simulation.restart();
  $('#exMotion').textContent = EX.paused ? 'Resume motion' : 'Pause motion';
  $('#exMotion').setAttribute('aria-pressed', String(EX.paused));
}

function renderExplorerMatrix(result) {
  const list = result.nodes.slice().sort((x, y) => Number(y.anchor) - Number(x.anchor) || x.di - y.di || x.name.localeCompare(y.name)), n = list.length;
  const cell = n > 50 ? 18 : 25, margin = 138, size = margin + n * cell + 8, wrap = $('#exChart');
  const svg = d3.select(wrap).append('svg').attr('width', size).attr('height', size).attr('role', 'group').attr('aria-label', 'Focused directed relationship matrix');
  const pos = new Map(list.map((item, i) => [item.index, i])), max = Math.max(1, ...result.edges.map(e => e.value));
  for (let i = 0; i < n; i++) if (list[i].anchor || EX.pinned?.node === list[i].key) {
    svg.append('rect').attr('x', margin).attr('y', margin + i * cell).attr('width', cell * n).attr('height', cell).attr('fill', cssVar('--accent-soft'));
    svg.append('rect').attr('x', margin + i * cell).attr('y', margin).attr('width', cell).attr('height', cell * n).attr('fill', cssVar('--accent-soft'));
  }
  const cells = svg.append('g').selectAll('.rel-cell').data(result.edges).join('rect').attr('class', 'rel-cell')
    .attr('x', e => margin + pos.get(e.target) * cell).attr('y', e => margin + pos.get(e.source) * cell)
    .attr('width', cell - 1).attr('height', cell - 1).attr('fill', e => e.flags & 9 ? cssVar('--accent') : cssVar('--ink'))
    .attr('fill-opacity', e => .15 + .85 * Math.sqrt(e.value / max))
    .attr('stroke', e => EX.pinned?.source === result.g.meta(e.source).key && EX.pinned?.target === result.g.meta(e.target).key ? cssVar('--accent') : 'none')
    .attr('stroke-width', 2).attr('aria-label', e => `${result.g.meta(e.source).name} uses ${result.g.meta(e.target).name}, ${e.count} references`);
  exBind(cells, e => exEdgeTip(e, result), e => exPinEdge(e, result));
  const rows = svg.append('g').selectAll('.rel-label').data(list).join('text').attr('class', 'rel-label')
    .attr('x', margin - 8).attr('y', (_, i) => margin + (i + .5) * cell).attr('dy', '.35em').attr('text-anchor', 'end')
    .text(n => n.name.length > 21 ? n.name.slice(0, 20) + '…' : n.name).attr('aria-label', n => n.name);
  exBind(rows, exNodeTip, exPinNode);
  const columns = svg.append('g').selectAll('.rel-label').data(list).join('text').attr('class', 'rel-label')
    .attr('transform', (_, i) => `translate(${margin + (i + .5) * cell},${margin - 8}) rotate(-90)`).attr('text-anchor', 'start')
    .text(n => n.name.length > 21 ? n.name.slice(0, 20) + '…' : n.name).attr('aria-label', n => n.name);
  exBind(columns, exNodeTip, exPinNode);
}

function renderExplorerDepth(result) {
  const depth = explorerModel().depths(result), byIndex = new Map(result.nodes.map(n => [n.index, n]));
  const wrap = d3.select('#exChart').append('div').attr('class', 'explorer-depth');
  const cycles = depth.groups.filter(g => g.cyclic);
  wrap.append('p').attr('class', 'depth-take').text(`${depth.levels.length} dependency depth${depth.levels.length === 1 ? '' : 's'} among ${result.nodes.length} displayed items; ${cycles.length} cycle group${cycles.length === 1 ? '' : 's'}. ${depth.relationships} relationships considered, including edges hidden by display limits.`);
  wrap.append('p').text('Depth 0 has no dependencies outside its cycle group among these items. Each higher depth adds a step to the longest dependency chain. Cycles are kept together. Hidden items can extend chains or connect cycle groups; focus a smaller neighborhood or raise the node limit to inspect them.');
  wrap.append('p').text('Heatmap rows use the depths in columns. Darkness shows reference count; diagonal cells are references within cycles.');
  const cell = 30, margin = 72, levels = depth.levels.map(([level]) => level), size = margin + levels.length * cell + 8;
  const svg = wrap.append('div').attr('class', 'scroll-x').append('svg').attr('width', size).attr('height', size)
    .attr('role', 'group').attr('aria-label', 'References between dependency depths');
  const pos = new Map(levels.map((level, i) => [level, i])), max = Math.max(1, ...depth.flow.map(f => f.count));
  const focusLevel = level => { wrap.select(`[data-depth-level="${level}"]`).node()?.scrollIntoView({block: 'nearest', behavior: 'auto'}); };
  const cells = svg.selectAll('.depth-cell').data(depth.flow).join('rect').attr('class', 'depth-cell')
    .attr('x', f => margin + pos.get(f.target) * cell).attr('y', f => margin + pos.get(f.source) * cell)
    .attr('width', cell - 1).attr('height', cell - 1).attr('fill', f => f.source === f.target ? cssVar('--accent') : cssVar('--ink'))
    .attr('fill-opacity', f => .2 + .8 * Math.sqrt(f.count / max))
    .attr('aria-label', f => `Depth ${f.source} uses depth ${f.target}, ${num(f.count)} references`);
  exBind(cells, f => `<strong>Depth ${f.source} uses depth ${f.target}</strong><br>${num(f.count)} reference uses across ${num(f.relationships)} relationships${f.source === f.target ? '<br>References within cycle groups' : ''}`, f => focusLevel(f.source));
  for (let i = 0; i < levels.length; i++) {
    svg.append('text').attr('x', margin - 8).attr('y', margin + (i + .5) * cell).attr('dy', '.35em').attr('text-anchor', 'end').attr('class', 'rel-label').text('Depth ' + levels[i]);
    svg.append('text').attr('transform', `translate(${margin + (i + .5) * cell},${margin - 8}) rotate(-90)`).attr('class', 'rel-label').text('Depth ' + levels[i]);
  }
  const addItems = (parent, members) => {
    const buttons = parent.append('div').attr('class', 'depth-items').selectAll('button')
      .data(members.map(i => byIndex.get(i)).sort((x, y) => x.name.localeCompare(y.name))).join('button')
      .attr('type', 'button').attr('class', n => 'depth-node' + (EX.pinned?.node === n.key ? ' is-sel' : ''))
      .attr('aria-label', n => n.name).text(n => n.name);
    exBind(buttons, exNodeTip, exPinNode);
  };
  for (const [level, groups] of depth.levels) {
    const section = wrap.append('section').attr('class', 'depth-level').attr('data-depth-level', level);
    const count = groups.reduce((sum, g) => sum + g.members.length, 0);
    section.append('h3').text(`Depth ${level}: ${count} item${count === 1 ? '' : 's'}`);
    const independent = groups.filter(g => !g.cyclic).flatMap(g => g.members);
    if (independent.length) addItems(section, independent);
    for (const group of groups.filter(g => g.cyclic)) {
      const cycle = section.append('div').attr('class', 'depth-cycle');
      cycle.append('p').text(`Cycle group: ${group.members.length} items depend on one another through directed paths.`);
      addItems(cycle, group.members);
    }
  }
}

function renderExplorerDetail(result) {
  const panel = $('#exDetail'), p = EX.pinned, model = explorerModel();
  if (!p) { panel.hidden = true; panel.innerHTML = ''; return; }
  const meta = key => { const i = model.position(result.g, key); return i < 0 ? model.groupMeta(key) : result.g.meta(i); };
  const action = (label, key, type) => `<button type="button" data-ex-action="${type}" data-key="${esc(key)}">${label}</button>`;
  if (p.node) {
    const n = meta(p.node); if (!n) { panel.hidden = true; return; }
    const full = result.nodes.find(x => x.key === n.key) || n;
    panel.innerHTML = `<h3>${esc(n.name)}</h3><p>${exNodeTip(full)}</p><div class="explorer-actions">` +
      action('Focus neighborhood', n.key, 'focus') +
      (n.level === 'd' || n.level === 'm' ? action('Expand contents', n.key, 'contents') : '') +
      (n.level === 'd' || n.level === 'm' ? action('Explore functions and data', n.key, 'symbols') : action('Show in footprint', n.key, 'footprint')) +
      `<button type="button" data-ex-clear>Clear details</button></div>`;
  } else {
    const src = meta(p.source), dst = meta(p.target); if (!src || !dst) { panel.hidden = true; return; }
    const matches = e => model.keyAt(result.g, e.source) === p.source && model.keyAt(result.g, e.target) === p.target;
    const edge = result.edges.find(matches) || model.displayedLinks(result).find(matches), refs = model.evidence(src, dst,40,EX.type);
    const refButton = (s, ni) => `<button class="linkbtn" type="button" data-ex-action="focus" data-key="${s ? 's:' + s.id : 'n:' + ni}">${exEndpoint(s, ni)}</button>`;
    panel.innerHTML = `<h3>${esc(src.name)} → ${esc(dst.name)}</h3><p>${edge ? `${num(edge.count)} reference uses; ${pctS(edge.share, 1)} of the caller’s full external references; ${pctS(edge.mutual, 1)} reciprocal strength.` : 'This relationship is outside the current display filters.'}</p>` +
      `<div class="explorer-actions">${action('Focus caller', src.key, 'focus')}${action('Focus dependency', dst.key, 'focus')}<button type="button" data-ex-clear>Clear details</button></div>` +
      `<p>Highest-count reference evidence, up to 40 pairs. Source locations are declarations. Code references can include function addresses as well as calls.</p>` +
      `<div class="xref-scroll"><table class="xref-table"><thead><tr><th>Source</th><th>Destination</th><th>Uses</th><th>Attribution</th></tr></thead><tbody>` +
      refs.map(r => `<tr><td>${refButton(r.src, r.sourceSection)}</td><td>${refButton(r.dst, r.targetSection)}</td><td>${num(r.count)}</td><td>${r.src && r.dst && !r.flags ? 'exact endpoints' : exAttribution(r.flags)}${!r.dst ? '; section-only target' : ''}</td></tr>`).join('') + '</tbody></table></div>';
  }
  panel.hidden = false;
  panel.querySelector('[data-ex-clear]').onclick = () => { EX.pinned = null; exRefreshSelection(); };
  panel.querySelectorAll('[data-ex-action]').forEach(button => button.onclick = () => {
    const key = button.dataset.key, type = button.dataset.exAction;
    if (type === 'focus') { exFocus(key); return; }
    if (type === 'contents') { exExpandNode(meta(key)); return; }
    if (type === 'symbols') { EX.level = 'symbol'; EX.focus = [key]; EX.pinned = null; EX.trail = []; }
    else if (type === 'footprint') {
      const n = meta(key); if (n.section != null) { state.searchNode = n.section; state.focus = A.nodes[n.section]._focusPath.slice(); renderAll(); go('#v-treemap'); } return;
    }
    EX.cacheKey = ''; EX.transform = null; renderExplorer();
  });
}

function renderExplorer() {
  exStopGraph();
  const visible = state.workspace === 'connectivity' && state.views.connectivity === 'explorer' && !!A;
  // The explorer has its own detail panel; give its graph the inspector's width.
  $('.layout').classList.toggle('is-wide', visible);
  if (!visible) { if (EX.maximized) exSetMaximized(false); return; }
  const compactTools = innerWidth <= 760;
  if (EX.compactTools !== compactTools) { $('#exTools').open = !compactTools; EX.compactTools = compactTools; }
  const model = explorerModel();
  if (EX.level === 'symbol' && !EX.focus.length) EX.focus = ['m:' + A.mods.findIndex(m => m.name === state.selected)];
  for (const [id, key] of [['exArrange', 'arrange'], ['exColor', 'color'], ['exLevel', 'level'], ['exDirection', 'direction'], ['exHops', 'hops'], ['exMetric', 'metric'],
    ['exType', 'type'], ['exNodes', 'nodes'], ['exEdges', 'edges'], ['exStrongest', 'strongest'], ['exMin', 'min'], ['exShared', 'shared']]) $('#'+id).value = String(EX[key]);
  document.querySelectorAll('[data-ex-view]').forEach(button => button.setAttribute('aria-pressed', String(EX.view === button.dataset.exView)));
  $('#exZoom').hidden = EX.view !== 'graph'; $('#exGraphHelp').hidden = EX.view !== 'graph'; $('#exFocusSymbol').disabled = state.searchNode == null;
  $('#exBack').hidden = !EX.trail.length;
  $('#exLegendBox').hidden = EX.view !== 'graph';
  if (EX.view !== 'graph') $('#exShapes').hidden = true;
  $('#exMetric').closest('label').hidden = EX.view === 'depth';
  document.querySelectorAll('.ex-graph-only').forEach(el => { el.hidden = EX.view !== 'graph'; });
  renderExplorerCrumbs();
  if (EX.view !== 'graph') $('#exGroups').hidden = true;
  $('#exExpanded').innerHTML=EX.level==='dom'?EX.expanded.map(i=>`<button type="button" data-collapse-dir="${i}">Collapse ${esc(A.doms[i].name)}</button>`).join(''):'';
  $('#exExpanded').querySelectorAll('button').forEach(button=>button.onclick=()=>{EX.expanded=EX.expanded.filter(i=>i!==+button.dataset.collapseDir);EX.focus=[];EX.trail=[];EX.pinned=null;EX.cacheKey='';renderExplorer();});
  const budget = Math.min(EX.nodes, innerWidth < 620 ? 30 : EX.nodes);
  const cacheKey = JSON.stringify([EX.level, EX.expanded, EX.focus, EX.direction, EX.hops, EX.type, EX.metric, budget, EX.edges, EX.strongest, EX.min, EX.shared, state.tau]);
  if (cacheKey !== EX.cacheKey) {
    EX.result = model.query({level: EX.level, expanded: EX.expanded, focus: EX.focus, direction: EX.direction, hops: EX.hops, type: EX.type,
      metric: EX.metric, maxNodes: budget, maxEdges: EX.edges, strongest: EX.strongest, minCount: EX.min, shared: EX.shared === 'show', tau: state.tau});
    EX.cacheKey = cacheKey;
  }
  const result = EX.result;
  $('#exRadial').hidden = EX.view !== 'graph' || !result.nodes.length;
  $('#exTake').textContent = EX.focus.length ? `Exploring ${EX.focus.map(exKeyName).filter(Boolean).join(' and ')} with ${EX.direction === 'both' ? 'incoming and outgoing' : EX.direction === 'out' ? 'outgoing' : 'incoming'} neighbors up to ${EX.hops} hop${EX.hops === 1 ? '' : 's'} away.` : 'Whole-image overview. Click a node to toggle its relationships; double-click a component or subsystem to expand its contents.';
  const omitted = result.omitted;
  if (omitted.length) $('#exTake').textContent += omitted.length === 1 ? ` ${omitted[0]} is not shown: none of its code or data is left after linking.` :
    ` ${num(omitted.length)} items are not shown because none of their code or data is left after linking: ${omitted.join(', ')}.`;
  $('#exCoverageShort').textContent = `${num(result.nodes.length)} of ${num(result.candidates)} items, ${num(result.edges.length)} of ${num(result.totalEdges)} relationships`;
  $('#exCoverage').textContent = `${num(result.nodes.length)} of ${num(result.candidates)} eligible items shown; ${num(result.edges.length)} of ${num(result.totalEdges)} relationships displayed; ${pctS(result.shownWeight, result.totalWeight)} of eligible reference volume represented. Node budget ${budget}, edge budget ${EX.edges}; ${EX.strongest?'strongest '+EX.strongest+' per direction':'all links within budget'}.`;
  const chart = $('#exChart'); chart.innerHTML = '';
  if (!result.nodes.length) chart.innerHTML = '<p class="empty" style="padding:16px">No items match this neighborhood. Change direction, depth or reference type, or return to the overview.</p>';
  else if (EX.view === 'graph') renderExplorerGraph(result);
  else if (EX.view === 'depth') renderExplorerDepth(result);
  else renderExplorerMatrix(result);
  renderExplorerDetail(result);
}

document.querySelectorAll('[data-ex-view]').forEach(button => button.onclick = () => { EX.view = button.dataset.exView; tipHide(); renderExplorer(); });
for (const [id, key] of [['exArrange', 'arrange'], ['exColor', 'color'], ['exLevel', 'level'], ['exDirection', 'direction'], ['exHops', 'hops'], ['exMetric', 'metric'],
  ['exType', 'type'], ['exNodes', 'nodes'], ['exEdges', 'edges'], ['exStrongest', 'strongest'], ['exMin', 'min'], ['exShared', 'shared']]) {
  $('#'+id).onchange = event => {
    const numeric = ['hops', 'nodes', 'edges', 'strongest', 'min'].includes(key);
    EX[key] = numeric ? Math.max(key === 'strongest' ? 0 : 1, Number(event.target.value) || 0) : event.target.value;
    if (key === 'level') { EX.focus = EX.level === 'symbol' ? ['m:' + A.mods.findIndex(m => m.name === state.selected)] : []; EX.pinned = null; EX.trail = []; }
    if (key === 'level') EX.transform = null;
    if (key === 'arrange') { EX.positions.clear(); EX.forceKey = ''; EX.transform = null; }
    EX.cacheKey = ''; renderExplorer();
  };
}
$('#exBack').onclick = () => {
  const previous = EX.trail.pop(); if (!previous) return;
  Object.assign(EX, previous); EX.cacheKey = '';
  tipHide(); $('#exPath').textContent = ''; $('#exResults').innerHTML = ''; renderExplorer();
};
$('#exOverview').onclick = () => { EX.level = 'dom'; EX.expanded = []; EX.focus = []; EX.trail = []; EX.pinned = null; EX.cacheKey = ''; EX.transform = null; renderExplorer(); };
$('#exFocusSelected').onclick = () => exFocus('m:' + A.mods.findIndex(m => m.name === state.selected), 'mod');
$('#exFocusSymbol').onclick = () => {
  const i = state.searchNode;
  if (i != null) exFocus('section:'+i,'symbol');
};
function exShowResults() {
  const query = $('#exSearch').value; if (!query.trim()) { $('#exResults').innerHTML = ''; return; }
  const results = explorerModel().find(query, EX.level,8,EX.expanded);
  $('#exResults').innerHTML = results.length ? results.map(n => `<button type="button" data-key="${esc(n.key)}">${esc(n.name)}<small>${esc(n.source || n.paths[0] || '')}</small></button>`).join('') : '<p class="none">No matching items at this detail level.</p>';
  $('#exResults').querySelectorAll('button').forEach(button => button.onclick = () => { $('#exResults').innerHTML = ''; exFocus(button.dataset.key, EX.level); });
}
let exSearchTimer = null;
$('#exSearchForm').onsubmit = event => { event.preventDefault(); clearTimeout(exSearchTimer); exShowResults(); };
$('#exSearch').oninput = () => { clearTimeout(exSearchTimer); exSearchTimer = setTimeout(exShowResults, 200); };
$('#exSearch').onkeydown = event => {
  if (event.key === 'ArrowDown') { event.preventDefault(); $('#exResults button')?.focus(); }
};
$('#exResults').onkeydown = event => {
  const buttons = [...$('#exResults').querySelectorAll('button')], at = buttons.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); const next = at + (event.key === 'ArrowDown' ? 1 : -1);
    if (next < 0) $('#exSearch').focus(); else buttons[Math.min(next, buttons.length - 1)]?.focus();
  }
};
$('#exPathForm').onsubmit = event => {
  event.preventDefault(); const model = explorerModel(), from = EX.pinned?.node || EX.pinned?.source || EX.focus[0], panel = $('#exPath');
  if (!from || !EX.result || model.position(EX.result.g, from) < 0) { panel.textContent = 'Pin a node at the current detail level to choose the path’s starting point.'; return; }
  const matches = model.find($('#exPathTarget').value, EX.level,8,EX.expanded), destination = matches[0];
  if (!destination) { panel.textContent = 'No matching destination at this detail level.'; return; }
  const path = model.path(EX.result.g, from, destination.key, EX.type);
  panel.innerHTML = path.length ? `<p>${path.length - 1} directed hop${path.length === 2 ? '' : 's'} using all references of the chosen type, including relationships hidden by display limits.</p>` +
    path.map(n => `<button type="button" data-key="${esc(n.key)}">${esc(n.name)}${n.viaFlags&9?' (approximate)':''}${n.sectionOnly?' [section only]':''}</button>`).join(' → ') : `No directed path from this item to ${esc(destination.name)} with the selected reference type.`;
  panel.querySelectorAll('button').forEach(button => button.onclick = () => exFocus(button.dataset.key, EX.level));
};
$('#exZoomIn').onclick = () => { if (EX.svg && EX.zoom) EX.svg.call(EX.zoom.scaleBy, 1.3); };
$('#exZoomOut').onclick = () => { if (EX.svg && EX.zoom) EX.svg.call(EX.zoom.scaleBy, 1 / 1.3); };
$('#exFit').onclick = exFitGraph;
$('#exMotion').onclick = () => {
  EX.paused = !EX.paused;
  if (EX.simulation) { if (EX.paused) EX.simulation.stop(); else EX.simulation.alpha(.4).restart(); }
  $('#exMotion').textContent = EX.paused ? 'Resume motion' : 'Pause motion';
  $('#exMotion').setAttribute('aria-pressed', String(EX.paused));
};
$('#exRelease').onclick = () => {
  for (const n of EX.graphNodes) n.fx = n.fy = null;
  if (EX.draw) EX.draw();
  if (EX.simulation && !EX.paused) EX.simulation.alpha(.6).restart();
};
$('#exRearrange').onclick = () => {
  exStopGraph(); EX.positions.clear(); EX.forceKey = ''; EX.transform = null; renderExplorer();
};
$('#exMax').onclick = () => exSetMaximized(!EX.maximized);
// Popovers and search results close on an outside click or Escape.
const exPopovers = () => [...document.querySelectorAll('.ex-pop[open], .ex-chip[open]')];
document.addEventListener('click', event => {
  for (const pop of exPopovers()) if (!pop.contains(event.target)) pop.open = false;
  if (!$('#exSearchForm').contains(event.target)) $('#exResults').innerHTML = '';
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const open = exPopovers();
  if (open.length) { for (const pop of open) { pop.open = false; pop.querySelector('summary').focus(); } return; }
  if ($('#v-explorer').hidden) return;
  if ($('#exResults').innerHTML) { $('#exResults').innerHTML = ''; $('#exSearch').focus(); return; }
  // On a graph node, Escape releases its held position instead.
  if (EX.maximized && !event.target.closest?.('.rel-node')) { exSetMaximized(false); $('#exMax').focus(); }
});
let exResizeTimer = null;
addEventListener('resize', () => { clearTimeout(exResizeTimer); exResizeTimer = setTimeout(() => { if (A) renderExplorer(); }, 150); });
