// Directed relationship queries. The browser and Node checks use the same model.
class RelationshipModel {
  constructor(analysis) {
    this.a = analysis;
    this.types = ['cc', 'cd', 'dc', 'dd'];
    this.groupCache = new Map();
    this.evidenceCache = new Map();
    this.samples = new Map();
    const {nm, nodes, succ} = analysis;
    this.modTypes = this.types.map(() => new Float64Array(nm * nm));
    for (const n of nodes) for (let e = succ.off[n.i]; e < succ.off[n.i + 1]; e++) {
      const t = nodes[succ.adj[e]], kind = (n.kind === 'code' ? 0 : 2) + (t.kind === 'code' ? 0 : 1);
      this.modTypes[kind][n.mi * nm + t.mi] += succ.wt[e];
    }
    // Keep a small representative sample for each boundary, without building
    // an object adjacency list for a potentially enormous symbol table.
    const d = analysis.details;
    const remember = (key, ref) => {
      let list = this.samples.get(key);
      if (!list) this.samples.set(key, list = []);
      list.push(ref); list.sort((x, y) => y.count - x.count); if (list.length > 3) list.length = 3;
    };
    if (d) {
      const sectionIndex = new Map(nodes.map(n => [String(n.id), n.i])), r = d.refs;
      for (let e = 0; e < r.src.length; e++) {
        const si = sectionIndex.get(String(r.sourceSection[e])), ti = sectionIndex.get(String(r.targetSection[e]));
        if (si == null || ti == null || !nodes[si].live || !nodes[ti].live) continue;
        const key=nodes[si].mi+':'+nodes[ti].mi, ref={e,count:r.count[e]};
        remember(key,ref);remember(key+'/'+this.sectionType(si,ti),ref);
      }
    } else {
      for (const n of nodes) for (let e = succ.off[n.i]; e < succ.off[n.i + 1]; e++) {
        const t = nodes[succ.adj[e]];
        const key=n.mi+':'+t.mi,ref={sourceSection:n.i,targetSection:t.i,count:succ.wt[e],flags:0};
        remember(key,ref);remember(key+'/'+this.sectionType(n.i,t.i),ref);
      }
    }
  }

  sectionType(source, target) { return (this.a.nodes[source].kind === 'code' ? 'c' : 'd') + (this.a.nodes[target].kind === 'code' ? 'c' : 'd'); }

  groupMeta(key) {
    const [level, raw] = key.split(':'), i = +raw, a = this.a;
    if(level!=='d'&&level!=='m')return null;
    const g = level === 'd' ? a.doms[i] : a.mods[i];
    if (!g) return null;
    const mods = level === 'd' ? g.mods : [i], role = level === 'd' ? a.roleDom[i] : a.roleSub[i];
    return {key, name: g.name, level, i, di: level === 'd' ? i : g.di, mods,
      bytes: g.live, cluster: g.cluster, breadth: role.breadth,
      internal: level === 'd' ? a.dm[i * a.nd + i] : a.mm[i * a.nm + i],
      paths: level === 'd' ? [g.name + '/'] : Array.from((function*(){let count=0;for(const path of g.files){yield path;if(++count===3)break;}})())};
  }

  symbolMeta(i) {
    const a = this.a, d = a.details, count = d ? d.symbols.count : 0;
    if (d && i < count) {
      const s = d.symbol(i), n = a.nodes[s.section];
      if (!n) return null;
      return {key: 's:' + i, name: s.name, level: 's', i, section: s.section, di: n.di,
        mods: [n.mi], bytes: s.size, kind: s.flags & 4 ? 'code' : s.flags & 8 ? 'data' : n.kind,
        cluster: a.mods[n.mi].cluster, symbol: s, paths: [n.objectPath || n.path], source: s.sourceFile, line: s.sourceLine,
        breadth: a.roleSub[n.mi].breadth};
    }
    const ni = i - count, n = a.nodes[ni];
    if (!n) return null;
    return {key: 'n:' + ni, name: n.name, level: 'n', i, section: ni, di: n.di, mods: [n.mi],
      bytes: n.size, kind: n.kind, cluster: a.mods[n.mi].cluster,
      paths: [n.objectPath || n.path], source: n.sourcePath || '', sectionOnly: true, breadth: a.roleSub[n.mi].breadth};
  }

  graphData(count, source, target, weight, keys, meta, flags = null, evidence = null) {
    const out = new Float64Array(count), incoming = new Float64Array(count);
    const off = new Uint32Array(count + 1), back = new Uint32Array(count + 1);
    for (let e = 0; e < source.length; e++) {
      off[source[e] + 1]++; back[target[e] + 1]++;
      if (source[e] !== target[e]) { out[source[e]] += weight[e]; incoming[target[e]] += weight[e]; }
    }
    for (let i = 0; i < count; i++) { off[i + 1] += off[i]; back[i + 1] += back[i]; }
    const forward = new Uint32Array(source.length), reverse = new Uint32Array(source.length), p = off.slice(), q = back.slice();
    for (let e = 0; e < source.length; e++) { forward[p[source[e]]++] = e; reverse[q[target[e]]++] = e; }
    return {count, source, target, weight, keys, meta, flags, evidence, out, incoming, off, back, forward, reverse};
  }

  groups(level = 'dom', expanded = [], type = 'all') {
    const cacheKey = level + '/' + expanded.slice().sort().join(',') + '/' + type;
    if (this.groupCache.has(cacheKey)) return this.groupCache.get(cacheKey);
    const a = this.a, open = new Set(expanded), keys = [], pos = new Map(), modAt = new Uint32Array(a.nm);
    for (const m of a.mods) {
      const key = level === 'mod' || open.has(m.di) ? 'm:' + m.i : 'd:' + m.di;
      if (!pos.has(key)) { pos.set(key, keys.length); keys.push(key); }
      modAt[m.i] = pos.get(key);
    }
    const count = keys.length, matrix = new Float64Array(count * count), all = new Float64Array(count * count);
    for (let x = 0; x < a.nm; x++) for (let y = 0; y < a.nm; y++) {
      const at = modAt[x] * count + modAt[y], slot = x * a.nm + y;
      all[at] += a.mm[slot];
      matrix[at] += type === 'all' ? a.mm[slot] : this.modTypes[this.types.indexOf(type)][slot];
    }
    const source = [], target = [], weight = [];
    for (let x = 0; x < count; x++) for (let y = 0; y < count; y++) if (matrix[x * count + y]) {
      source.push(x); target.push(y); weight.push(matrix[x * count + y]);
    }
    const g = this.graphData(count, source, target, weight, keys, i => this.groupMeta(keys[i]));
    // Shares retain the full-image denominator when edges or types are filtered.
    g.out.fill(0);
    for (let x = 0; x < count; x++) for (let y = 0; y < count; y++) if (x !== y) g.out[x] += all[x * count + y];
    if (this.groupCache.size >= 8) this.groupCache.delete(this.groupCache.keys().next().value);
    this.groupCache.set(cacheKey, g); return g;
  }

  symbols() {
    if (this.symbolGraph) return this.symbolGraph;
    const a = this.a, d = a.details, count = (d ? d.symbols.count : 0) + a.N;
    const length = d ? d.refs.src.length : a.succ.adj.length;
    const source = new Uint32Array(length), target = new Uint32Array(length), weight = new Float64Array(length), flags = new Uint8Array(length), evidence = new Int32Array(length);
    let used = 0;
    const ns = d ? d.symbols.count : 0;
    if (d) {
      const index = new Map(a.nodes.map(n => [String(n.id), n.i])), r = d.refs;
      for (let e = 0; e < r.src.length; e++) {
        const si = index.get(String(r.sourceSection[e])), ti = index.get(String(r.targetSection[e]));
        if (si == null || ti == null || !a.nodes[si].live || !a.nodes[ti].live) continue;
        source[used] = r.src[e] >= 0 ? r.src[e] : ns + si; target[used] = r.dst[e] >= 0 ? r.dst[e] : ns + ti;
        weight[used] = r.count[e]; flags[used] = r.flags[e]; evidence[used++] = e;
      }
    } else for (const n of a.nodes) for (let e = a.succ.off[n.i]; e < a.succ.off[n.i + 1]; e++) {
      source[used] = n.i; target[used] = a.succ.adj[e]; weight[used] = a.succ.wt[e]; evidence[used++] = -1;
    }
    const keys = {get: i => i < ns ? 's:' + i : 'n:' + (i - ns)};
    this.symbolGraph = this.graphData(count, source.subarray(0,used), target.subarray(0,used),
      weight.subarray(0,used), keys, i => this.symbolMeta(i), flags.subarray(0,used), evidence.subarray(0,used));
    return this.symbolGraph;
  }

  keyAt(g, i) { return Array.isArray(g.keys) ? g.keys[i] : g.keys.get(i); }
  position(g, key) {
    if (Array.isArray(g.keys)) return g.keys.indexOf(key);
    const [prefix, raw] = key.split(':'), i = +raw;
    if (prefix === 's') return i;
    if (prefix === 'n') return (this.a.details ? this.a.details.symbols.count : 0) + i;
    return -1;
  }
  matchesType(g, e, type) {
    if (type === 'all' || !g.flags) return true;
    const s = g.meta(g.source[e]), t = g.meta(g.target[e]);
    return (s.kind === 'code' ? 'c' : 'd') + (t.kind === 'code' ? 'c' : 'd') === type;
  }
  incomingImportance(g, i, type = 'all') {
    const callers = new Set(); let rankIncoming = 0;
    // Count across the full projection, before neighborhood and display pruning.
    for (let p = g.back[i]; p < g.back[i + 1]; p++) {
      const e = g.reverse[p], caller = g.source[e];
      if (caller === i || !this.matchesType(g, e, type)) continue;
      callers.add(caller); rankIncoming += g.weight[e];
    }
    return {dependents: callers.size, rankIncoming};
  }
  radial(result, spacing = 120) {
    // Focused items lead their own neighborhood; breadth of use orders the rest.
    const ranked = result.nodes.slice().sort((x, y) => Number(!!y.anchor) - Number(!!x.anchor) || y.dependents - x.dependents || y.rankIncoming - x.rankIncoming ||
      x.name.localeCompare(y.name) || x.key.localeCompare(y.key)), layout = [];
    if (!ranked.length) return layout;
    layout.push({...ranked[0], dependenceRank: 0, radialBand: 0, targetRadius: 0, seedX: 0, seedY: 0});
    // Each outer band has room for more labels. Stagger angles between bands.
    for (let start = 1, band = 1; start < ranked.length; band++) {
      const count = Math.min(6 * band, ranked.length - start), radius = band * spacing;
      for (let j = 0; j < count; j++) {
        const angle = j * 2 * Math.PI / count + band * Math.PI * (3 - Math.sqrt(5));
        layout.push({...ranked[start + j], dependenceRank: start + j, radialBand: band, targetRadius: radius,
          seedX: Math.cos(angle) * radius, seedY: Math.sin(angle) * radius});
      }
      start += count;
    }
    return layout;
  }
  // Groups need live bytes and sections must be live; a fully eliminated
  // subsystem has no live references and would float unconnected.
  liveItem(n) { return n.section == null ? n.bytes > 0 : this.a.nodes[n.section]?.live !== false; }
  focusMods(g, focus) { return new Set(focus.filter(key => this.position(g, key) < 0).flatMap(key => this.groupMeta(key)?.mods || [])); }
  // Groups named by the focus that are left out because nothing in them survived linking.
  omitted(g, focus) {
    if (!Array.isArray(g.keys)) return [];
    const wanted = this.focusMods(g, focus), direct = new Set(focus.map(key => this.position(g, key)).filter(i => i >= 0)), names = [];
    for (let i = 0; i < g.count; i++) {
      const n = g.meta(i);
      if (n && !n.bytes && (direct.has(i) || n.mods.some(m => wanted.has(m)))) names.push(n.name);
    }
    return names;
  }
  seeds(g, focus) {
    if (!focus.length) return [];
    const direct = focus.map(key => this.position(g, key)).filter(i => {
      if (i < 0 || i >= g.count) return false;
      const n = g.meta(i);
      return n && this.liveItem(n);
    });
    const wanted = this.focusMods(g, focus), result = [...direct];
    const sections=new Set(focus.filter(key=>key.startsWith('section:')).map(key=>+key.split(':')[1]));
    if (!wanted.size&&!sections.size) return [...new Set(result)];
    for (let i = 0; i < g.count; i++) {
      const n = g.meta(i);
      if(n?.level==='n'&&this.a.details&&g.off[i]===g.off[i+1]&&g.back[i]===g.back[i+1])continue;
      if (n && (n.mods.some(m => wanted.has(m))||sections.has(n.section)) && this.liveItem(n)) result.push(i);
    }
    return [...new Set(result)];
  }

  query(options = {}) {
    const o = {level: 'dom', expanded: [], focus: [], direction: 'both', hops: 1, type: 'all', metric: 'count',
      maxNodes: 50, maxEdges: 150, strongest: 3, minCount: 1, shared: true, tau: .35, ...options};
    const g = o.level === 'symbol' ? this.symbols() : this.groups(o.level, o.expanded, o.type);
    const seeds = this.seeds(g, o.focus), anchor = new Set(seeds), distance = new Int16Array(g.count).fill(-1), queue = [];
    if (seeds.length) {
      for (const i of seeds) { distance[i] = 0; queue.push(i); }
      for (let at = 0; at < queue.length; at++) {
        const i = queue[at]; if (distance[i] >= o.hops) continue;
        const visit = (off, ids, dest) => {
          for (let p = off[i]; p < off[i + 1]; p++) {
            const e = ids[p], j = dest[e]; if (!this.matchesType(g, e, o.type)) continue;
            if (distance[j] < 0) { distance[j] = distance[i] + 1; queue.push(j); }
          }
        };
        if (o.direction !== 'in') visit(g.off, g.forward, g.target);
        if (o.direction !== 'out') visit(g.back, g.reverse, g.source);
      }
    } else if (!o.focus.length) for (let i = 0; i < g.count; i++) {
      const meta = g.meta(i); if (meta && meta.bytes > 0 && (g.out[i] || g.incoming[i] || o.level !== 'symbol')) { distance[i] = 0; queue.push(i); }
    }
    const candidates = queue.filter(i => {
      const n = g.meta(i); return n && (o.shared || anchor.has(i) || !n.breadth || n.breadth < o.tau);
    });
    candidates.sort((x, y) => Number(anchor.has(y)) - Number(anchor.has(x)) || distance[x] - distance[y]
      || g.out[y] + g.incoming[y] - g.out[x] - g.incoming[x] || g.meta(x).name.localeCompare(g.meta(y).name));
    const selected = new Set(candidates.slice(0, o.maxNodes)), eligible = new Set(candidates), links = new Map();
    let totalEdges = 0, totalWeight = 0;
    // Aggregate visible pairs; preserve evidence flags even when multiple
    // symbol relocations describe the same directed relationship.
    for (const x of eligible) {
      const totals = new Map();
      for (let p=g.off[x];p<g.off[x+1];p++) {
        const e=g.forward[p],y=g.target[e];
        if(x===y||!eligible.has(y)||!this.matchesType(g,e,o.type))continue;
        totals.set(y,(totals.get(y)||0)+g.weight[e]);
        if(!selected.has(x)||!selected.has(y))continue;
        const key=x+':'+y;let link=links.get(key);
        if(!link)links.set(key,link={source:x,target:y,count:0,flags:0,samples:[]});
        link.count+=g.weight[e];link.flags|=g.flags?g.flags[e]:0;
        if(link.samples.length<3&&g.evidence)link.samples.push(g.evidence[e]);
      }
      for(const weight of totals.values())if(weight>=o.minCount){totalEdges++;totalWeight+=weight;}
    }
    let edges = [...links.values()].filter(e => e.count >= o.minCount);
    for (const e of edges) {
      e.share = g.out[e.source] ? e.count / g.out[e.source] : 0;
      const reverse = links.get(e.target + ':' + e.source)?.count || 0, other = g.out[e.target] ? reverse / g.out[e.target] : 0;
      e.mutual = e.share && other ? 2 * e.share * other / (e.share + other) : 0;
      e.value = o.metric === 'share' ? e.share : o.metric === 'mutual' ? e.mutual : e.count;
    }
    if(o.metric==='mutual')edges=edges.filter(e=>e.value>0);
    edges.sort((x, y) => y.value - x.value || y.count - x.count);
    const bestOut = new Map(), bestIn = new Map(), chosen = new Set();
    for (const e of edges) {
      const outs = bestOut.get(e.source) || 0, ins = bestIn.get(e.target) || 0;
      if (!o.strongest || outs < o.strongest || ins < o.strongest) chosen.add(e);
      bestOut.set(e.source, outs + 1); bestIn.set(e.target, ins + 1);
    }
    edges = edges.filter(e => chosen.has(e)).slice(0, o.maxEdges);
    const nodes = [...selected].map(i => ({...g.meta(i), ...this.incomingImportance(g, i, o.type), index: i, depth: distance[i], anchor: anchor.has(i),
      outgoing: g.out[i], incoming: g.incoming[i]}));
    return {g, options: o, nodes, edges, omitted: this.omitted(g, o.focus), candidates: candidates.length, totalEdges, totalWeight,
      shownWeight: edges.reduce((sum, e) => sum + e.count, 0), seeds, distance};
  }

  displayedLinks(result) {
    // Every qualifying direct relationship between the displayed items, before
    // edge pruning. Layout and depth use these; arrows show the pruned subset.
    if (result.displayedLinks) return result.displayedLinks;
    const {g, options: o, nodes} = result, selected = new Set(nodes.map(n => n.index)), links = [], byPair = new Map();
    for (const x of selected) {
      const totals = new Map();
      for (let p = g.off[x]; p < g.off[x + 1]; p++) {
        const e = g.forward[p], y = g.target[e];
        if (x === y || !selected.has(y) || !this.matchesType(g, e, o.type)) continue;
        totals.set(y, (totals.get(y) || 0) + g.weight[e]);
      }
      for (const [y, count] of totals) if (count >= o.minCount) {
        const link = {source: x, target: y, count, share: g.out[x] ? count / g.out[x] : 0};
        links.push(link); byPair.set(x + ':' + y, link);
      }
    }
    for (const e of links) {
      const reverse = byPair.get(e.target + ':' + e.source), other = reverse ? reverse.share : 0;
      e.mutual = e.share && other ? 2 * e.share * other / (e.share + other) : 0;
    }
    return result.displayedLinks = links;
  }

  communities(result) {
    // Natural groups among the displayed items, from the same undirected pair
    // weights as the connection layout: the larger caller share of either side.
    if (result.communities) return result.communities;
    const {nodes} = result, at = new Map(nodes.map((n, i) => [n.index, i])), pairs = new Map();
    for (const e of this.displayedLinks(result)) {
      const x = at.get(e.source), y = at.get(e.target), key = Math.min(x, y) + ':' + Math.max(x, y);
      pairs.set(key, Math.max(pairs.get(key) || 0, e.share));
    }
    const src = [], dst = [], weight = [];
    for (const [key, w] of pairs) { const [x, y] = key.split(':').map(Number); src.push(x, y); dst.push(y, x); weight.push(w, w); }
    const member = this.a.communities(nodes.length, src, dst, weight), strength = new Float64Array(nodes.length), byId = new Map();
    for (let e = 0; e < src.length; e++) if (member[src[e]] === member[dst[e]]) strength[src[e]] += weight[e];
    nodes.forEach((n, i) => { if (!byId.has(member[i])) byId.set(member[i], []); byId.get(member[i]).push(i); });
    // Largest groups first; each group is named after its most strongly tied member.
    const groups = [...byId.values()].map(list => list.sort((x, y) => strength[y] - strength[x] || nodes[x].name.localeCompare(nodes[y].name)))
      .sort((x, y) => y.length - x.length || nodes[x[0]].name.localeCompare(nodes[y[0]].name))
      .map((list, id) => ({id, members: list.map(i => nodes[i].index), lead: nodes[list[0]].name}));
    const groupOf = new Map();
    for (const g of groups) for (const i of g.members) groupOf.set(i, g.id);
    return result.communities = {groups, groupOf};
  }

  depths(result) {
    // Pruning drawn edges must not invent a hierarchy or conceal a cycle.
    const {nodes} = result, links = this.displayedLinks(result);
    const adj = new Map(nodes.map(n => [n.index, []]));
    for (const e of links) adj.get(e.source).push(e.target);
    const index = new Map(), low = new Map(), stack = [], active = new Set(), groups = [], groupOf = new Map();
    const visit = v => {
      index.set(v, index.size); low.set(v, index.get(v)); stack.push(v); active.add(v);
      for (const w of adj.get(v)) {
        if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
        else if (active.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
      }
      if (low.get(v) === index.get(v)) {
        const members = []; let w;
        do { w = stack.pop(); active.delete(w); members.push(w); groupOf.set(w, groups.length); } while (w !== v);
        groups.push({id: groups.length, members, cyclic: members.length > 1, depth: null});
      }
    };
    for (const n of nodes) if (!index.has(n.index)) visit(n.index);
    const dependencies = groups.map(() => new Set());
    for (const e of links) {
      const x = groupOf.get(e.source), y = groupOf.get(e.target); if (x !== y) dependencies[x].add(y);
    }
    const depth = id => {
      const group = groups[id];
      if (group.depth == null) group.depth = dependencies[id].size ? 1 + Math.max(...[...dependencies[id]].map(depth)) : 0;
      return group.depth;
    };
    for (const group of groups) depth(group.id);
    const levels = new Map(), flow = new Map();
    for (const group of groups) {
      if (!levels.has(group.depth)) levels.set(group.depth, []);
      levels.get(group.depth).push(group);
    }
    for (const e of links) {
      const source = groups[groupOf.get(e.source)].depth, target = groups[groupOf.get(e.target)].depth, key = source + ':' + target;
      if (!flow.has(key)) flow.set(key, {source, target, count: 0, relationships: 0});
      const f = flow.get(key); f.count += e.count; f.relationships++;
    }
    return {groups, groupOf, levels: [...levels].sort((x, y) => y[0] - x[0]), flow: [...flow.values()], relationships: links.length};
  }

  find(query, level = 'mod', limit = 8, expanded = []) {
    const q = query.trim().toLowerCase(); if (!q) return [];
    const g = level === 'symbol' ? this.symbols() : this.groups(level,expanded), result = [];
    for (let i = 0; i < g.count; i++) {
      const n = g.meta(i); if (!n) continue;
      if (n.section != null ? !this.a.nodes[n.section]?.live : !n.bytes) continue;
      if(n.level==='n'&&this.a.details&&g.off[i]===g.off[i+1]&&g.back[i]===g.back[i+1])continue;
      const exact = n.name.toLowerCase() === q, text = [n.name, n.symbol?.linkageName, n.source, ...n.paths].join(' ').toLowerCase();
      if (text.includes(q)) result.push({...n, exact});
    }
    return result.sort((x, y) => Number(y.exact) - Number(x.exact) || y.bytes - x.bytes).slice(0, limit);
  }

  path(g, from, to, type = 'all') {
    const start = this.position(g, from), end = this.position(g, to);
    if (start < 0 || end < 0 || start >= g.count || end >= g.count) return [];
    const prev = new Int32Array(g.count).fill(-1), queue = [start]; prev[start] = start;
    for (let at = 0; at < queue.length && prev[end] < 0; at++) {
      const i = queue[at];
      for (let p = g.off[i]; p < g.off[i + 1]; p++) {
        const e = g.forward[p], j = g.target[e]; if (prev[j] >= 0 || !this.matchesType(g, e, type)) continue;
        prev[j] = i; queue.push(j);
      }
    }
    if (prev[end] < 0) return [];
    const steps = [end]; while (steps[steps.length - 1] !== start) steps.push(prev[steps[steps.length - 1]]);
    return steps.reverse().map((i,at,list) => {
      let viaFlags=0;
      if(at&&g.flags)for(let p=g.off[list[at-1]];p<g.off[list[at-1]+1];p++){const e=g.forward[p];if(g.target[e]===i&&this.matchesType(g,e,type))viaFlags|=g.flags[e];}
      return {...g.meta(i),viaFlags};
    });
  }

  ref(e) {
    const r = this.a.details.refs;
    if (!this.refIndex) this.refIndex = new Map(this.a.nodes.map(n => [String(n.id), n.i]));
    return {src: r.src[e] < 0 ? null : this.a.details.symbol(r.src[e]), dst: r.dst[e] < 0 ? null : this.a.details.symbol(r.dst[e]),
      sourceSection: this.refIndex.get(String(r.sourceSection[e])), targetSection: this.refIndex.get(String(r.targetSection[e])), count: r.count[e], flags: r.flags[e]};
  }
  preview(source, target, type = 'all') {
    if (source.level === 's' || source.level === 'n') {
      const g = this.symbols(), x = this.position(g, source.key), y = this.position(g, target.key), refs = [];
      for (let p = g.off[x]; p < g.off[x + 1]; p++) {
        const e = g.forward[p]; if (g.target[e] === y && g.evidence[e] >= 0 && this.matchesType(g,e,type)) refs.push(this.ref(g.evidence[e]));
      }
      return refs.sort((x, y) => y.count - x.count).slice(0, 3);
    }
    const refs = [];
    for (const x of source.mods) for (const y of target.mods) for (const r of this.samples.get(x + ':' + y+(type==='all'?'':'/'+type)) || []) refs.push(r.e == null ? r : this.ref(r.e));
    return refs.sort((x, y) => y.count - x.count).slice(0, 3);
  }
  evidence(source, target, limit = 40, type = 'all') {
    const cacheKey = source.key + '/' + target.key+'/'+type;
    if (this.evidenceCache.has(cacheKey)) return this.evidenceCache.get(cacheKey);
    const a = this.a, d = a.details, refs = [], sm = new Set(source.mods), tm = new Set(target.mods);
    const match = (meta, symbol, section, mods) => meta.level === 's' ? symbol === meta.i : meta.level === 'n' ? symbol < 0 && section === meta.section : mods.has(a.nodes[section].mi);
    if (d) {
      if (!this.refIndex) this.refIndex = new Map(a.nodes.map(n => [String(n.id), n.i]));
      const r = d.refs;
      for (let e = 0; e < r.src.length; e++) {
        const si = this.refIndex.get(String(r.sourceSection[e])), ti = this.refIndex.get(String(r.targetSection[e]));
        if (si == null || ti == null || !a.nodes[si].live || !a.nodes[ti].live) continue;
        if(type!=='all'){
          const named=source.level==='s'||source.level==='n';
          const code=(id,section)=>named&&id>=0&&(d.symbols.flags[id]&12)?!!(d.symbols.flags[id]&4):a.nodes[section].kind==='code';
          if((code(r.src[e],si)?'c':'d')+(code(r.dst[e],ti)?'c':'d')!==type)continue;
        }
        if (match(source, r.src[e], si, sm) && match(target, r.dst[e], ti, tm)) refs.push({e, count: r.count[e]});
        if (refs.length > 2 * limit) { refs.sort((x, y) => y.count - x.count); refs.length = limit; }
      }
      refs.sort((x, y) => y.count - x.count); refs.length = Math.min(refs.length, limit);
      for (let i = 0; i < refs.length; i++) refs[i] = this.ref(refs[i].e);
    } else {
      for (const n of a.nodes) if (sm.has(n.mi)) for (let e = a.succ.off[n.i]; e < a.succ.off[n.i + 1]; e++) {
        const t = a.nodes[a.succ.adj[e]];
        if (tm.has(t.mi) && (source.level !== 'n' || n.i === source.section) && (target.level !== 'n' || t.i === target.section) && (type==='all'||this.sectionType(n.i,t.i)===type))
          refs.push({sourceSection: n.i, targetSection: t.i, count: a.succ.wt[e], flags: 0});
        if (refs.length > 2 * limit) { refs.sort((x, y) => y.count - x.count); refs.length = limit; }
      }
      refs.sort((x, y) => y.count - x.count); refs.length = Math.min(refs.length, limit);
    }
    if (this.evidenceCache.size >= 8) this.evidenceCache.delete(this.evidenceCache.keys().next().value);
    this.evidenceCache.set(cacheKey, refs); return refs;
  }
}
if (typeof module !== 'undefined') module.exports = {RelationshipModel};
