// ===================== ui =====================
(function(){
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtB=b=>{b=Math.round(b);if(b>=1073741824)return (b/1073741824).toFixed(2)+' GiB';if(b>=1048576)return (b/1048576).toFixed(b>=104857600?0:1)+' MiB';if(b>=1024)return (b/1024).toFixed(b>=102400?0:1)+' KiB';return b+' B';};
const pctS=(a,b)=>b?(100*a/b<1&&a>0?'<1%':Math.round(100*a/b)+'%'):'0%';
const num=n=>Math.round(n).toLocaleString();
const PALETTE=['#3E6FB0','#2A9384','#7B5EA7','#B9852A','#5E8C3A','#8C5A3C','#667589','#C2553A','#A04F8E','#3F8FB5','#8E8B2E','#5C6BC0','#2F7D5B','#B06A3B','#6E5A8A','#4A8A9A','#9A4E5E','#7A8B3A','#B5733F','#55708F','#8A6A2E','#3D6E6E'];
const KIND_COL={code:'#41658F',rodata:'#8AA6C6',data:'#C47F2C',bss:'#E3BC6F'};
const KINDS=['code','rodata','data','bss'];
const KIND_NAME={code:'Code',rodata:'Read-only data',data:'Initialized data',bss:'Zero-initialized data (bss)'};
const MEAS={stored:'stored in RAM',live:'raw size in the image',dead:'eliminated',pre:'in the linker input'};
const MEAS_SHORT={stored:'Stored size',live:'Raw size',dead:'Eliminated size',pre:'Linker input size'};
const MIB=1048576;const TREE_MIN_ITEMS=2;const DOMINANT_SHARE=0.95;const COMP_LO='#D99A2B',COMP_HI='#2A8C7E',COMP_NONE='#B9C3CC';
const DEAD_LO='#D5DDE5',DEAD_HI='#8A3412';

let A=null,TREE=null,SAMPLE=null,SOURCE=null;
const state={comp:{pat:'.*clade*',cr:0.30,dr:0.50,ov:0},outExclude:'overlay_mem_dump, QSR_4_0_STR, QSR_4_0_MSG',whatIf:new Set(),compSort:'untap',measure:'stored',colorBy:'dom',addrColor:'dom',treeMode:'source',fragmentView:'logical',focus:[],selected:null,searchQuery:'',searchNode:null,searchOut:'',searchMsg:'',dsmLevel:'mod',dsmOrder:'tree',dsmMetric:'count',dsmPair:null,deadSort:'bytes',sample:'150000',roleLevel:'mod',tau:0.35,hideInfra:'show',workspace:'footprint',views:{footprint:'treemap',connectivity:'roles'}};
const domColor=di=>PALETTE[di%PALETTE.length];
state.pathMode='source';
const modColor=mi=>domColor(A.mods[mi].di);
const val=(k,meas)=>meas==='live'?k[0]+k[1]+k[2]+k[3]:meas==='dead'?k[4]+k[5]+k[6]+k[7]:k[0]+k[1]+k[2]+k[3]+k[4]+k[5]+k[6]+k[7];
const V=(node,meas)=>meas==='stored'?node.st:val(node.k,meas);
let C=null;
function globRe(p){return new RegExp('^'+p.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')+'$');}
function outputFilter(){const pats=state.outExclude.split(/[,\s]+/).filter(Boolean).map(globRe);return pats.length?out=>pats.some(re=>re.test(out)):null;}
function recomputeCompression(){
  const pats=state.comp.pat.split(/[\s,]+/).filter(Boolean).map(globRe);const cache=new Map();
  const match=o=>{if(!o)return false;let r=cache.get(o);if(r===undefined){r=pats.some(re=>re.test(o));cache.set(o,r);}return r;};
  const N=A.N;const stored=new Float64Array(N),proj=new Float64Array(N),elig=new Uint8Array(N);
  const wiM=new Set(),wiN=new Set();for(const k of state.whatIf){const [t,v]=k.split(':');(t==='m'?wiM:wiN).add(+v);}
  const M=A.mods.map(()=>({raw:0,stored:0,eligRaw:0,compRaw:0,saved:0,untap:0,hotRaw:0,proj:0}));const D=A.doms.map(()=>({raw:0,stored:0,proj:0,saved:0}));
  const T={raw:0,stored:0,eligRaw:0,compRaw:0,saved:0,untap:0,untapHot:0,proj:0,hotSkipped:0,hotRaw:0};
  for(const n of A.nodes){if(!n.live)continue;const i=n.i;const comp=n.kind!=='bss';const e=comp&&match(n.out);elig[i]=e?1:0;
    const r=comp?(n.kind==='code'?state.comp.cr:state.comp.dr):1;const s=e?n.size*r:n.size;stored[i]=s;
    let p=s;if(!e&&comp&&(wiM.has(n.mi)||wiN.has(i))){if(n.hot)T.hotSkipped++;else p=n.size*r;}proj[i]=p;
    const m=M[n.mi],d=D[n.di];m.raw+=n.size;m.stored+=s;m.proj+=p;d.raw+=n.size;d.stored+=s;d.proj+=p;T.raw+=n.size;T.stored+=s;T.proj+=p;
    if(comp){m.compRaw+=n.size;T.compRaw+=n.size;if(n.hot){m.hotRaw+=n.size;T.hotRaw+=n.size;}
      if(e){m.eligRaw+=n.size;T.eligRaw+=n.size;const sv=n.size-s;m.saved+=sv;d.saved+=sv;T.saved+=sv;}
      else{const pot=n.size*(1-r);if(n.hot)T.untapHot+=pot;else{m.untap+=pot;T.untap+=pot;}}}}
  (function walk(t){
    if(t.sym){const n=t.sym;if(n.live){t.st=stored[n.i];t.pj=proj[n.i];t.eg=elig[n.i]?n.size:0;t.cp=n.kind!=='bss'?n.size:0;}else{t.st=t.pj=t.eg=t.cp=0;}return;}
    if(t._nodes){let st=0,pj=0,eg=0,cp=0;for(const i of t._nodes){st+=stored[i];pj+=proj[i];if(elig[i])eg+=A.nodes[i].size;if(A.nodes[i].kind!=='bss')cp+=A.nodes[i].size;}t.st=st;t.pj=pj;t.eg=eg;t.cp=cp;for(const ch of t.children||[])walk(ch);return;}
    let st=0,pj=0,eg=0,cp=0;for(const ch of t.children){walk(ch);st+=ch.st;pj+=ch.pj;eg+=ch.eg;cp+=ch.cp;}t.st=st;t.pj=pj;t.eg=eg;t.cp=cp;
  })(TREE);
  const ret=new Float64Array(N+1);for(const v of A.dom.order){if(v===N)continue;ret[v]+=stored[v];ret[A.dom.idom[v]]+=ret[v];}
  const ov=(T.eligRaw>0||T.proj<T.stored)?Math.max(0,+state.comp.ov||0)*MIB:0;
  C={stored,proj,elig,M,D,T,ret,ov,hasHot:A.nodes.some(n=>n.hot)};
}
function impactStored(gi,level){const res=A.removalImpact(gi,level);let b=0,o=0,ob=0;for(const i of res.nodes){const s=C.stored[i];b+=s;if(!res.inG(A.nodes[i])){o++;ob+=s;}}return {bytes:b,others:o,othersBytes:ob};}
const gStored=(g,level)=>level==='dom'?C.D[g.i].stored:C.M[g.i].stored;
function syncNavigation(){
  document.querySelectorAll('[data-workspace]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.workspace===state.workspace)));
  document.querySelectorAll('[data-workspace-panel]').forEach(p=>{p.hidden=p.dataset.workspacePanel!==state.workspace;});
  document.querySelectorAll('[data-view-workspace]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.view===state.views[b.dataset.viewWorkspace])));
  document.querySelectorAll('[data-view-panel]').forEach(p=>{const [workspace,view]=p.dataset.viewPanel.split(':');p.hidden=workspace!==state.workspace||view!==state.views[workspace];});
}
const activateWorkspace=(workspace,view)=>{state.workspace=workspace;if(view)state.views[workspace]=view;renderAll();};
const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollToElement=el=>{if(el)el.scrollIntoView({behavior:reduceMotion()?'auto':'smooth',block:'start'});};
const go=sel=>{const el=$(sel);if(!el)return;const panel=el.dataset.viewPanel;if(panel){const [workspace,view]=panel.split(':');activateWorkspace(workspace,view);}scrollToElement(el);};

// ---------- tooltip
const tipEl=$('#tip');
function tipShow(html,ev){tipEl.innerHTML=html;tipEl.hidden=false;const p=14;const r=tipEl.getBoundingClientRect();let x=ev.clientX+p,y=ev.clientY+p;if(x+r.width>innerWidth-8)x=ev.clientX-r.width-p;if(y+r.height>innerHeight-8)y=ev.clientY-r.height-p;tipEl.style.left=Math.max(4,x)+'px';tipEl.style.top=Math.max(4,y)+'px';}
function tipHide(){tipEl.hidden=true;}

// ---------- tree: source-tree or kind-first summaries; raw sections on demand
function buildTree(mode=state.treeMode){
  const kindFirst=mode==='kind';
  const root={key:'',name:'Whole image',level:'root',depth:0,k:new Float64Array(8),children:[],_focusPath:[]};const byKey=new Map([['',root]]);
  const fragmentByTarget=new Map(),fragmentsBySection=new Map();
  if(state.fragmentView==='logical'&&A.details)for(const f of A.details.logicalFragments){fragmentByTarget.set(f.targetSection,f);let list=fragmentsBySection.get(f.containerSection);if(!list)fragmentsBySection.set(f.containerSection,list=[]);list.push(f);}
  const dirChoices=new Map(),fileChoices=new Map();
  const remember=(choices,key,branch,size)=>{let paths=choices.get(key);if(!paths){paths=new Map();choices.set(key,paths);}const old=paths.get(branch);if(old)old.size+=size;else paths.set(branch,{path:branch._focusPath,size});};
  const get=(parent,key,name,level,mod,dom)=>{let c=byKey.get(key);if(!c){const focusPath=parent._focusPath.slice();if(key)focusPath.push(key);c={key,name,level,depth:parent.depth+1,k:new Float64Array(8),children:[],mod,dom,_focusPath:focusPath};byKey.set(key,c);parent.children.push(c);}return c;};
  for(const n of A.nodes){const slot=n.ki+(n.live?0:4);const chain=[root];
    const fragment=fragmentByTarget.get(n.i)||fragmentsBySection.get(n.i)?.[0];
    const layout=fragment?A.nodes[fragment.containerSection]:n;
    const addLogicalContainer=(kind)=>{if(!fragment)return kind;const symbol=A.details.symbol(fragment.container);const name=`${symbol.name} (initializer data)`;const container=get(kind,`${kind.key}|fragment:${fragment.container}`,name,'container',layout.mod,layout.dom);if(!container._nodes)container._nodes=[];container._nodes.push(n.i);n._focusPath=container._focusPath.slice();chain.push(container);return container;};
    if(kindFirst){
      const kindKey=`kind:${layout.kind}`;const kind=get(root,kindKey,KIND_NAME[layout.kind],'kind',layout.mod,layout.dom);chain.push(kind);
      const dom=get(kind,`${kindKey}|dom:${layout.dom}`,layout.dom,'dir',layout.mod,layout.dom);chain.push(dom);
      const mod=get(dom,`${dom.key}|mod:${layout.mod}`,layout.mod.slice(layout.dom.length+1),'dir',layout.mod,layout.dom);chain.push(mod);
      const file=get(mod,`${mod.key}|file:${layout.path}`,layout.file,'file',layout.mod,layout.dom);chain.push(file);
      if(!file._allNodes)file._allNodes=[];file._allNodes.push(n.i);
      if(fragment)addLogicalContainer(file);else{if(!file._nodes)file._nodes=[];file._nodes.push(n.i);n._focusPath=file._focusPath.slice();}
      remember(dirChoices,layout.dom,dom,n.size);remember(dirChoices,layout.mod,mod,n.size);remember(fileChoices,layout.path,file,n.size);
      if(layout.dir){let p='';for(const part of layout.dir.split('/')){p=p?p+'/'+part:part;remember(dirChoices,p,p===layout.dom?dom:mod,n.size);}}
    }else{
      const dom=get(root,layout.dom,layout.dom,'dir',layout.mod,layout.dom);chain.push(dom);
      const mod=get(dom,layout.mod===layout.dom?`mod:${layout.mod}`:layout.mod,layout.mod.slice(layout.dom.length+1),'dir',layout.mod,layout.dom);chain.push(mod);
      const file=get(mod,`file:${layout.path}`,layout.file,'file',layout.mod,layout.dom);chain.push(file);
      if(!file._allNodes)file._allNodes=[];file._allNodes.push(n.i);
      const kind=get(file,`kind:${layout.path}|${layout.kind}`,KIND_NAME[layout.kind],'kind',layout.mod,layout.dom);chain.push(kind);if(fragment)addLogicalContainer(kind);else{if(!kind._nodes)kind._nodes=[];kind._nodes.push(n.i);n._focusPath=kind._focusPath.slice();}
      remember(dirChoices,layout.dom,dom,n.size);remember(dirChoices,layout.mod,mod,n.size);remember(fileChoices,layout.path,file,n.size);
      if(layout.dir){let p='';for(const part of layout.dir.split('/')){p=p?p+'/'+part:part;remember(dirChoices,p,p===layout.dom?dom:mod,n.size);}}
    }
    for(const c of chain)c.k[slot]+=n.size;
  }
  // A source-tree file owns its sections through kind children, whereas a
  // kind-first file owns them directly.  Include both forms.  The latter was
  // previously lost because this walk started below `node`; that emptied every
  // kind-first file and made the kind hierarchy effectively non-interactive.
  // A node may retain a cached aggregate as well as children, so de-duplicate
  // while walking rather than relying on one representation being absent.
  const allIds=node=>{const ids=[],seen=new Set();const collect=current=>{
    for(const i of current._nodes||[])if(!seen.has(i)){seen.add(i);ids.push(i);}
    for(const child of current.children||[])collect(child);
  };collect(node);return ids;};
  if(!kindFirst){
    // A singleton object file or kind bucket adds visual depth without adding
    // useful grouping. Keep its sections attached to the nearest retained
    // parent, while retaining the full node list for aggregate accounting.
    const itemCount=ids=>ids.reduce((count,i)=>{const n=A.nodes[i];const visible=n.size>0&&(state.measure==='pre'||state.measure==='live'&&n.live||state.measure==='stored'&&n.live||state.measure==='dead'&&!n.live);return count+(visible?1:0);},0);
    const fileFocus=new Map();
    for(const dom of root.children){
      for(const mod of dom.children){
        const files=mod.children||[];
        const retainedFiles=[];const direct=[];let modIds=[];
        for(const file of files){
          const ids=allIds(file);modIds=modIds.concat(ids);file._nodes=ids;
          const keptKinds=[];const kindDirect=[];
          for(const kind of file.children||[]){
            // Source-tree kind buckets are currently per object file. The
            // distinct-file test deliberately removes that redundant layer;
            // it remains here so a future cross-file kind aggregate can be
            // retained when it represents a real grouping.
            const kindIds=allIds(kind),kindFiles=new Set(kindIds.map(i=>A.nodes[i].path));
            if((itemCount(kindIds)>=TREE_MIN_ITEMS&&kindFiles.size>=TREE_MIN_ITEMS)||kind.children?.some(c=>c.level==='container'))keptKinds.push(kind);
            else kindDirect.push(...kindIds);
          }
          file.children=keptKinds;
          file._materializeNodes=kindDirect;
          for(const i of kindDirect)A.nodes[i]._focusPath=file._focusPath.slice();
          const fileSize=ids.reduce((sum,i)=>sum+A.nodes[i].size,0),filePath=A.nodes[ids[0]].path;
          const fileTarget=itemCount(ids)>=TREE_MIN_ITEMS?file:mod,oldFile=fileFocus.get(filePath);
          if(!oldFile||fileSize>oldFile.size)fileFocus.set(filePath,{path:fileTarget._focusPath.slice(),size:fileSize});
          if(itemCount(ids)>=TREE_MIN_ITEMS){
            retainedFiles.push(file);
          }else{
            direct.push(...ids);
            for(const i of ids)A.nodes[i]._focusPath=mod._focusPath.slice();
          }
        }
        mod.children=retainedFiles;
        mod._materializeNodes=direct;
        mod._nodes=modIds;
      }
    }
    // File searches should land on the nearest visible branch after a file or
    // kind bucket has been collapsed.
    A._focusFiles=new Map([...fileFocus].map(([path,v])=>[path,v.path]));
  }else{
    // Keep the kind-first overview, but collapse tiny object files there too.
    // This prevents a long tail of one-section file tiles when the user is
    // comparing a section kind across the image.
    const itemCount=ids=>ids.reduce((count,i)=>{const n=A.nodes[i];const visible=n.size>0&&(state.measure==='pre'||state.measure==='live'&&n.live||state.measure==='stored'&&n.live||state.measure==='dead'&&!n.live);return count+(visible?1:0);},0);
    const fileFocus=new Map();
    for(const kind of root.children){
      for(const dom of kind.children||[]){
        for(const mod of dom.children||[]){
          const retained=[];const direct=[];let modIds=[];
          for(const file of mod.children||[]){
            const directNodes=file._nodes||[],ids=allIds(file);file._nodes=ids;file._materializeNodes=directNodes;modIds=modIds.concat(ids);
            const fileSize=ids.reduce((sum,i)=>sum+A.nodes[i].size,0),filePath=A.nodes[ids[0]].path;
            if(itemCount(ids)>=TREE_MIN_ITEMS)retained.push(file);
            else{direct.push(...ids);for(const i of ids)A.nodes[i]._focusPath=mod._focusPath.slice();}
            const target=itemCount(ids)>=TREE_MIN_ITEMS?file:mod,old=fileFocus.get(filePath);
            if(!old||fileSize>old.size)fileFocus.set(filePath,{path:target._focusPath.slice(),size:fileSize});
          }
          mod.children=retained;mod._materializeNodes=direct;mod._nodes=modIds;
        }
      }
    }
    A._focusFiles=new Map([...fileFocus].map(([path,v])=>[path,v.path]));
  }
  const pick=choices=>new Map([...choices].map(([key,paths])=>{let best=null;for(const choice of paths.values())if(!best||choice.size>best.size)best=choice;return [key,best?best.path:[]];}));
  A._focusDirs=pick(dirChoices);if(kindFirst)A._focusFiles=pick(fileChoices);return root;
}
function makeSectionLeaf(i,parent){const n=A.nodes[i],slot=n.ki+(n.live?0:4);const leaf={key:'s:'+i,name:n.name,level:'sym',depth:parent.depth+1,k:new Float64Array(8),sym:n,mod:n.mod,dom:n.dom,_focusPath:parent._focusPath.slice(),_directLeaf:1};leaf.k[slot]=n.size;leaf.st=C?C.stored[i]:0;return leaf;}
function materializeSections(node,force=false){
  if(node._materialized&&!force)return;
  const ids=node._materializeNodes!=null?node._materializeNodes:(node._nodes||[]);
  node.children=(node.children||[]).filter(c=>!c._directLeaf);
  const max=force?ids.length:20000;let chosen=ids;
  if(ids.length>max)chosen=ids.slice().sort((a,b)=>A.nodes[b].size-A.nodes[a].size).slice(0,max);
  if(state.searchNode!=null&&ids.includes(state.searchNode)&&!chosen.includes(state.searchNode))chosen=chosen.concat(state.searchNode);
  const used=new Set(chosen);for(const i of chosen)node.children.push(makeSectionLeaf(i,node));
  const rest=ids.length===chosen.length?[]:ids.filter(i=>!used.has(i));
  if(rest.length){const other={key:'a:'+node.key,name:`Other sections (${num(rest.length)})`,level:'aggregate',depth:node.depth+1,k:new Float64Array(8),_nodes:rest,mod:node.mod,dom:node.dom,_focusPath:node._focusPath.slice()};for(const i of rest){const n=A.nodes[i],slot=n.ki+(n.live?0:4);other.k[slot]+=n.size;}other.st=rest.reduce((v,i)=>v+(C?C.stored[i]:0),0);node.children.push(other);}
  node._materialized=true;
}
function focusNode(){let cur=TREE;const ok=[];for(const k of state.focus){const nx=cur.children.find(c=>c.key===k);if(!nx)break;if(nx._nodes)materializeSections(nx);ok.push(k);cur=nx;}state.focus=ok;return cur;}
function shortName(s){const parts=s.split('::');return parts.length>2?parts.slice(-2).join('::'):s;}
function tmFontSize(d,type){
  const w=d.x1-d.x0,h=d.y1-d.y0;
  if(type==='leaf'){
    if(w<48||h<20)return 0;
    return Math.max(11.5,Math.min(19,(h-5)*.72,w/7));
  }
  if(type==='sub'){
    if(w<84||h<18)return 0;
    return Math.max(12,Math.min(17,(h-3)*.74,w/7));
  }
  if(w<42||h<18)return 0;
  return Math.max(12,Math.min(18,(Math.min(22,h)-3)*.75,w/7));
}
function tmLabel(s,w,font,pad){
  const max=Math.floor(Math.max(0,w-pad)/(font*.52));
  if(max<1)return '';
  return s.length>max?(max===1?s.slice(0,1):s.slice(0,max-1)+'…'):s;
}

// ---------- treemap search
function matchScore(text,q){
  const s=String(text||'').toLowerCase(),x=q.toLowerCase();if(!s)return -1;
  if(s===x)return 1000;
  if(s.startsWith(x))return 760;
  const slash=s.lastIndexOf('/');if(slash>=0&&s.slice(slash+1)===x)return 950;
  if(slash>=0&&s.slice(slash+1).startsWith(x))return 820;
  const scope=s.lastIndexOf('::');if(scope>=0&&s.slice(scope+2)===x)return 950;
  if(scope>=0&&s.slice(scope+2).startsWith(x))return 820;
  const at=s.indexOf(x);return at>=0?500-(at?Math.min(100,at):0):-1;
}
function findTreemapMatch(query){
  const q=query.toLowerCase();const types={directory:4,file:3,'source file':3,'output section':2,symbol:1};const all=[];
  for(const [label,path] of A._focusDirs){const score=matchScore(label,q);if(score>=0)all.push({type:'directory',label,focus:path,score});}
  for(const [label,path] of A._focusFiles){let score=matchScore(label,q);const base=label.slice(label.lastIndexOf('/')+1);score=Math.max(score,matchScore(base,q));if(score>=0)all.push({type:'file',label,focus:path,score});}
  const outs=new Map();
  for(const n of A.nodes){if(!n.out)continue;const score=matchScore(n.out,q);if(score<0)continue;const old=outs.get(n.out);if(!old||n.size>old.node.size||(n.live&&!old.node.live))outs.set(n.out,{type:'output section',label:n.out,node:n,score});}
  all.push(...outs.values());
  let best=null;
  for(const n of A.nodes){let score=matchScore(n.name,q);const leaf=n.name.slice(n.name.lastIndexOf('::')+2);score=Math.max(score,matchScore(leaf,q));if(score<0)continue;const cand={type:'symbol',label:n.name,node:n,score};if(!best||score>best.score||score===best.score&&(types[cand.type]>types[best.type]||types[cand.type]===types[best.type]&&n.size>best.node.size))best=cand;}
  all.push(...(best?[best]:[]));
  if(A.details){
    const d=A.details,s=d.symbols;let match=null;
    for(let i=0;i<s.count;i++){
      const ni=d.section[i];if(ni<0)continue;
      const score=Math.max(matchScore(s.name[i],q),matchScore(s.linkageName[i],q));
      const source=d.sourceFiles[s.sourceFile?.[i]]||'',sourceScore=matchScore(source,q);
      const cand={type:sourceScore>score?'source file':'symbol',label:sourceScore>score?source:s.name[i],node:A.nodes[ni],score:Math.max(score,sourceScore)};
      if(cand.score>=0&&(!match||cand.score>match.score||cand.score===match.score&&cand.node.size>match.node.size))match=cand;
    }
    if(match)all.push(match);
  }
  all.sort((a,b)=>b.score-a.score||types[b.type]-types[a.type]||(b.node?b.node.size:0)-(a.node?a.node.size:0));
  const r=all[0];if(!r)return null;
  if(r.node){r.focus=r.node._focusPath.slice();}
  return r;
}
function searchTreemap(){
  const input=$('#tmSearch'),q=input.value.trim();state.searchQuery=q;state.searchNode=null;state.searchOut='';
  if(!q){state.searchMsg='';renderAll();return;}
  const r=findTreemapMatch(q);
  if(!r){state.searchMsg=`No directory, object file, output section or symbol matched “${q}”.`;renderAll();return;}
  state.focus=r.focus.slice();state.searchMsg=`${r.type[0].toUpperCase()+r.type.slice(1)}: ${r.label}`;
  if(r.node){state.searchNode=r.node.i;state.searchOut=r.type==='output section'?r.node.out:'';if(!r.node.live)state.measure='dead';else if(state.measure==='dead')state.measure='stored';state.selected=r.node.mod;}
  else if(r.type==='directory'&&r.focus.length>1)state.selected=r.label;
  renderAll();go('#v-treemap');
}

// ---------- hero memory map
function renderHero(){
  $('#datasetName').textContent=A.title;
  const S=Math.max(A.capacity,A.total.pre);const W=b=>100*b/S;
  const segs=(meas)=>A.doms.map((d,di)=>({d,di})).filter(x=>x.d.live+(meas==='pre'?x.d.dead:0)>0).map(({d,di})=>{
    const live=`<span class="ms-live" style="width:${W(d.live)/(meas==='pre'?W(d.live+d.dead)||1:W(d.live)||1)*100}%"></span>`;
    const tot=meas==='pre'?d.live+d.dead:d.live;const w=W(tot);
    return `<button class="mem-seg${meas==='pre'?' pre':''}" style="width:${w}%;--c:${domColor(di)}" data-di="${di}" data-meas="${meas}" aria-label="${esc(d.name)}">${meas==='pre'?live:''}${w>4.2?`<span class="ms-name">${esc(d.name)}</span>`:''}</button>`;}).join('');
  const ticks=[0,0.25,0.5,0.75,1].map(t=>`<span style="left:${t*100}%">${t===0?'0':fmtB(S*t).replace(' ','\u202f')}</span>`).join('');
  const T=C.T,used=T.stored+C.ov;
  const ramSegs=A.doms.map((d,di)=>({d,di,v:C.D[di].stored})).filter(x=>x.v>0).map(({d,di,v})=>{const w=W(v);return `<button class="mem-seg" style="width:${w}%;--c:${domColor(di)}" data-di="${di}" data-meas="stored" aria-label="${esc(d.name)}">${w>4.2?`<span class="ms-name">${esc(d.name)}</span>`:''}</button>`;}).join('')
    +(C.ov?`<span class="mem-ov" style="width:${W(C.ov)}%" title="Decompression buffer"></span>`:'')+(T.saved?`<span class="mem-saved" style="width:${W(T.saved)}%"><span>${W(T.saved)>7?'Saved by compression':''}</span></span>`:'');
  const proj=state.whatIf.size&&T.proj<T.stored?` With the selected candidates also compressed: <strong>${fmtB(T.proj+C.ov)}</strong>.`:'';
  $('#memmap').innerHTML=`
   <div class="mem-row"><div class="mem-label">RAM</div><div>
     <div class="mem-track"><div class="mem-bar" style="width:${W(A.capacity)}%">${ramSegs}</div></div>
     <p class="mem-meta"><strong>${fmtB(used)}</strong> stored in RAM of ${fmtB(A.capacity)} (${pctS(used,A.capacity)}), ${fmtB(Math.max(0,A.capacity-used))} free. Raw size ${fmtB(T.raw)}; compression saves ${fmtB(T.saved)}${C.ov?`, ${fmtB(T.saved-C.ov)} after the ${fmtB(C.ov)} decompression buffer (dark grey)`:''}.${proj}</p></div></div>
   <div class="mem-row"><div class="mem-label small">Linker input</div><div>
     <div class="mem-track"><div class="mem-bar input" style="width:${W(A.total.pre)}%">${segs('pre')}</div></div>
     <div class="mem-ticks">${ticks}</div>
     <p class="mem-meta"><strong>${fmtB(A.total.pre)}</strong> of sections in the object files. Garbage collection removes <strong>${fmtB(A.total.dead)}</strong> (${pctS(A.total.dead,A.total.pre)}), shown hatched.</p></div></div>`;
  $('#memmap').querySelectorAll('.mem-seg').forEach(b=>{const d=A.doms[+b.dataset.di];
    b.addEventListener('mousemove',ev=>tipShow(`<strong>${esc(d.name)}</strong>, ${d.mods.length} subsystems<br>${fmtB(C.D[+b.dataset.di].stored)} stored in RAM, ${fmtB(d.live)} raw<br>${fmtB(d.dead)} eliminated, ${pctS(d.dead,d.live+d.dead)} of its input`,ev));
    b.addEventListener('mouseleave',tipHide);
    b.addEventListener('click',()=>{if(b.dataset.meas==='pre'&&(state.measure==='live'||state.measure==='stored'))state.measure='pre';state.focus=[d.name];const top=d.mods.slice().sort((a,c)=>A.mods[c].live-A.mods[a].live)[0];if(top!=null)state.selected=A.mods[top].name;renderAll();go('#v-treemap');});});
  const nf=A.nodes.reduce((s,n)=>s+(n.kind==='code'&&n.live?1:0),0);
  $('#heroFacts').textContent=`${num(A.N)} sections in ${A.mods.length} subsystems across ${A.doms.length} top-level directories. ${num(nf)} functions survive the link, connected by ${num(A.refCount)} references.`+(A.unreachable?` ${num(A.unreachable)} sections marked live are not reachable from any root (${fmtB(A.unreachBytes)}); they may be kept by KEEP rules or by roots missing from the export.`:'');
}

// ---------- treemap
function visibleTreeItem(i,meas){const n=A.nodes[i];return n.size>0&&(meas==='pre'||meas==='live'&&n.live||meas==='stored'&&n.live||meas==='dead'&&!n.live);}
function treeItemCount(node,meas){return node._nodes?node._nodes.reduce((count,i)=>count+(visibleTreeItem(i,meas)?1:0),0):0;}
function sectionValue(i,meas){const n=A.nodes[i];return meas==='stored'?(C?C.stored[i]:0):meas==='live'?(n.live?n.size:0):meas==='dead'?(!n.live?n.size:0):n.size;}
function dominantRatio(node,meas){const ids=node._allNodes||node._nodes;if(!ids)return 0;let total=0,max=0,count=0;for(const i of ids){const v=sectionValue(i,meas);if(v>0){count++;total+=v;if(v>max)max=v;}}return count>1&&total?max/total:0;}
function groupDominantSymbols(node,meas){
  if(node._dominantGrouped||!node.children||(node.level!=='file'&&node.level!=='kind'))return;
  const symbols=node.children.filter(c=>c.level==='sym');
  if(symbols.length<2||symbols.length!==node.children.length)return;
  const ranked=symbols.filter(c=>V(c,meas)>0).sort((a,b)=>V(b,meas)-V(a,meas));
  if(ranked.length<2)return;
  const total=ranked.reduce((sum,c)=>sum+V(c,meas),0),dominant=ranked[0],rest=symbols.filter(c=>c!==dominant);
  if(!total||V(dominant,meas)/total<DOMINANT_SHARE||!rest.length)return;
  const ids=rest.map(c=>c.sym.i),other={key:'a:dominant:'+node.key,name:`Other symbols (${num(rest.length)})`,level:'aggregate',depth:node.depth+1,k:new Float64Array(8),_nodes:ids,mod:node.mod,dom:node.dom,_focusPath:node._focusPath.slice(),_dominantRemainder:true};
  let st=0;for(const i of ids){const n=A.nodes[i],slot=n.ki+(n.live?0:4);other.k[slot]+=n.size;st+=C?C.stored[i]:0;}other.st=st;
  node.children=[dominant,other];node._dominantGrouped=true;
}
function displayChildren(node,meas){
  if(node._materializeNodes&&node._materializeNodes.length&&!node._materialized)materializeSections(node);
  groupDominantSymbols(node,meas);
  const out=[];
  for(const child of node.children||[]){
    if(child.level==='aggregate'&&child._nodes&&state.searchNode!=null&&child._nodes.includes(state.searchNode))materializeSections(child,true);
    if(child.level==='file'&&(child._dominantGrouped||dominantRatio(child,meas)>=DOMINANT_SHARE)){
      if(!child._dominantGrouped){materializeSections(child);groupDominantSymbols(child,meas);}
      if(child._dominantGrouped){out.push(...child.children);continue;}
    }
    if((child.level==='file'||child.level==='kind')&&child._nodes&&treeItemCount(child,meas)<TREE_MIN_ITEMS){
      if(child._nodes)materializeSections(child);
      out.push(...displayChildren(child,meas));
    }else out.push(child);
  }
  return out;
}
function shallow(node,depth,meas){
  const v=V(node,meas);if(!v)return null;const o={ref:node,v};
  const children=displayChildren(node,meas);
  if(depth<3&&children.length){const ch=[];for(const c of children){const s=shallow(c,depth+1,meas);if(s)ch.push(s);}if(ch.length)o.children=ch;}
  return o;
}
function renderTreemap(){
  const el=$('#treemap');el.innerHTML='';
  const W=Math.max(300,el.clientWidth||800),H=Math.round(Math.max(380,Math.min(660,W*0.6)));
  const meas=state.measure;const F=focusNode();
  const search=$('#tmSearch');if(search&&document.activeElement!==search)search.value=state.searchQuery;
  const searchMsg=$('#tmSearchMsg');if(searchMsg)searchMsg.textContent=state.searchMsg;
  const logical=A.details?.logicalFragments||[],fragmentNote=$('#fragmentModeNote');
  if(fragmentNote)fragmentNote.textContent=!A.details?'Export symbol_details=elf or dwarf and fragment_details=data to inspect anonymous initializer data.':!logical.length?'No unambiguous data-initializer fragments are available in this export.':state.fragmentView==='logical'?`${num(logical.length)} uniquely owned initializer fragments are shown under their data container. Shared or ambiguous fragments remain at their physical location; total bytes are unchanged.`:`${num(logical.length)} uniquely owned initializer fragments can be shown under their data container. Physical sections are shown now.`;
  const crumbs=[{label:'Whole image',path:[]}];let cur=TREE;
  state.focus.forEach((k,i)=>{cur=cur.children.find(c=>c.key===k);crumbs.push({label:cur.level==='dir'?cur.name:cur.name,path:state.focus.slice(0,i+1)});});
  $('#crumbs').innerHTML=crumbs.map((c,i)=>i===crumbs.length-1?`<span aria-current="location">${esc(c.label)}</span>`:`<button data-i="${i}">${esc(c.label)}</button><span class="sep" aria-hidden="true">/</span>`).join('');
  $('#crumbs').querySelectorAll('button').forEach(b=>b.onclick=()=>{state.focus=crumbs[+b.dataset.i].path;renderAll();});
  const sh=shallow(F,0,meas);
  if(!sh){el.innerHTML=`<p class="empty">Nothing here is ${MEAS[meas]}. Pick another measure or go up a level.</p>`;$('#tmTake').textContent='';$('#tmLegend').innerHTML='';return;}
  const h=d3.hierarchy(sh,d=>d.children).sum(d=>d.children?0:d.v).sort((a,b)=>b.value-a.value);
  d3.treemap().tile(d3.treemapSquarify.ratio(1.25)).size([W,H]).paddingOuter(d=>d.depth===1?1:0).paddingTop(d=>d.depth===1&&d.children?22:d.depth===2&&d.children&&(d.x1-d.x0)>84&&(d.y1-d.y0)>60?18:0).paddingInner(d=>d.depth===0?3:1).round(true)(h);
  const svg=d3.select(el).append('svg').attr('width',W).attr('height',H).attr('viewBox',`0 0 ${W} ${H}`).attr('role','img').attr('aria-label','Treemap of '+MEAS_SHORT[meas].toLowerCase());
  const domOf=r=>{const top=r.dom||(r.sym&&r.sym.dom)||r.key.split('/')[0];const di=A.doms.findIndex(d=>d.name===top);return di<0?0:di;};
  const domCache=new Map();const domIdx=r=>{if(!domCache.has(r))domCache.set(r,domOf(r));return domCache.get(r);};
  const searchHit=r=>r.level==='sym'&&(state.searchNode===r.sym.i||(state.searchOut&&r.sym.out===state.searchOut));
  const fill=d=>{const r=d.data.ref;
    if(state.colorBy==='dead'){const dv=val(r.k,'dead'),tv=val(r.k,'pre');return d3.interpolateRgb(DEAD_LO,DEAD_HI)(tv?Math.pow(dv/tv,0.8):0);}
    if(state.colorBy==='comp'){const raw=val(r.k,'live');if(!r.cp||!raw)return COMP_NONE;const c=d3.interpolateRgb(COMP_LO,COMP_HI)(r.eg/r.cp);return d3.interpolateRgb(c,COMP_NONE)(Math.max(0,1-r.cp/raw));}
    if(state.colorBy==='kind'){const off=meas==='dead'?4:0;let best=0,bv=-1;for(let q=0;q<4;q++){const v=meas==='pre'?r.k[q]+r.k[q+4]:r.k[q+off];if(v>bv){bv=v;best=q;}}return KIND_COL[KINDS[best]];}
    const c=d3.color(domColor(domIdx(r)));const sib=d.parent?d.parent.children.indexOf(d):0;const adj=r.level==='sym'?{code:0,rodata:.55,data:-.35,bss:.95}[r.sym.kind]:((sib%3)-1)*0.28;
    return (adj>=0?c.brighter(adj):c.darker(-adj)).formatHex();};
  const leaves=h.leaves().filter(d=>d.x1-d.x0>0&&d.y1-d.y0>0);
  const tipFor=d=>{const r=d.data.ref;const live=val(r.k,'live'),dead=val(r.k,'dead');
    if(r.level==='sym'){const n=r.sym;return `<strong>${esc(n.name)}</strong><br>${esc(n.path)}<br>${KIND_NAME[n.kind]}, ${fmtB(n.size)}${n.live?(C.elig[n.i]?`, stored compressed as ${fmtB(C.stored[n.i])}`:''):', eliminated by the linker'}<br>Output section: ${n.out?esc(n.out):'Not provided in export'}${n.hot?'<br>Hot path':''}`+(n.live&&C.ret[n.i]>C.stored[n.i]*1.2?`<br>Keeps ${fmtB(C.ret[n.i])} stored in RAM`:'');}
    if(r.level==='aggregate')return `<strong>${esc(r.name)}</strong><br>${num(r._nodes.length)} ${r._dominantRemainder?'smaller symbols grouped to keep the dominant symbol visible':'sections grouped for readability'}<br>${fmtB(r.st)} stored in RAM, ${fmtB(live)} raw, ${fmtB(dead)} eliminated`;
    return `<strong>${esc(r.name)}</strong><br>${fmtB(r.st)} stored in RAM, ${fmtB(live)} raw${r.cp?`, ${pctS(r.eg,r.cp)} of the compressible bytes compressed`:''}<br>${fmtB(dead)} eliminated (${pctS(dead,live+dead)} of input)`;};
  const onClick=d=>{const r=d.data.ref;
    // The displayed hierarchy deliberately flattens singleton files and
    // dominant files.  A D3 leaf's parent is therefore often a module, not
    // the section's navigable owner.  Keep the clicked node's focus path so a
    // click always drills into the file/container that owns that tile.
    if(r.level==='sym')state.searchNode=r.sym.i;
    if(r.level==='aggregate')materializeSections(r,true);
    else if(r._nodes)materializeSections(r);
    const mod=r.mod||(r.sym&&r.sym.mod);
    if(mod)state.selected=mod;else{const di=domIdx(r);const top=A.doms[di].mods.slice().sort((a,c)=>A.mods[c].live-A.mods[a].live)[0];if(top!=null)state.selected=A.mods[top].name;}
    if(r._focusPath?.length)state.focus=r._focusPath.slice();
    renderAll();};
  svg.append('g').selectAll('rect').data(leaves).join('rect').attr('class',d=>`tm-leaf${searchHit(d.data.ref)?' tm-search-hit':''}`).attr('x',d=>d.x0).attr('y',d=>d.y0).attr('width',d=>d.x1-d.x0).attr('height',d=>d.y1-d.y0).attr('fill',fill)
    .on('mousemove',(ev,d)=>tipShow(tipFor(d),ev)).on('mouseleave',tipHide).on('click',(ev,d)=>onClick(d));
  svg.append('g').selectAll('text').data(leaves.filter(d=>tmFontSize(d,'leaf')>0)).join('text').attr('class','tm-leaf-label').attr('x',d=>d.x0+4).attr('y',d=>d.y0+tmFontSize(d,'leaf')+2).style('font-size',d=>`${tmFontSize(d,'leaf')}px`).style('fill',d=>d3.hsl(fill(d)).l>0.62?'#16202A':'#fff')
    .text(d=>{const r=d.data.ref;const s=r.level==='sym'?shortName(r.name):r.name;return tmLabel(s,d.x1-d.x0-8,tmFontSize(d,'leaf'),8);});
  // second-level outlines and labels
  const sub=h.descendants().filter(d=>d.depth===2&&d.children);
  svg.append('g').selectAll('rect').data(sub).join('rect').attr('class','tm-sub').attr('x',d=>d.x0).attr('y',d=>d.y0).attr('width',d=>d.x1-d.x0).attr('height',d=>d.y1-d.y0);
  const subVisible=sub.filter(d=>tmFontSize(d,'sub')>0);
  svg.append('g').selectAll('rect').data(subVisible).join('rect').attr('class','tm-subhead').attr('x',d=>d.x0).attr('y',d=>d.y0).attr('width',d=>d.x1-d.x0).attr('height',d=>Math.min(18,d.y1-d.y0)).on('click',(ev,d)=>onClick(d)).on('mousemove',(ev,d)=>tipShow(tipFor(d),ev)).on('mouseleave',tipHide);
  svg.append('g').selectAll('text').data(subVisible).join('text').attr('class','tm-sub-label').attr('x',d=>d.x0+4).attr('y',d=>d.y0+tmFontSize(d,'sub')+1).style('font-size',d=>`${tmFontSize(d,'sub')}px`)
    .text(d=>{const s=`${d.data.ref.name}  ${fmtB(d.value)}`;return tmLabel(s,d.x1-d.x0-8,tmFontSize(d,'sub'),8);});
  const groups=(h.children||[]).filter(d=>d.children);
  const g=svg.append('g').selectAll('g').data(groups).join('g');
  g.append('rect').attr('class','tm-group').attr('x',d=>d.x0).attr('y',d=>d.y0).attr('width',d=>d.x1-d.x0).attr('height',d=>d.y1-d.y0);
  g.append('rect').attr('class','tm-head').attr('x',d=>d.x0).attr('y',d=>d.y0).attr('width',d=>d.x1-d.x0).attr('height',d=>Math.min(22,d.y1-d.y0))
    .on('click',(ev,d)=>onClick(d)).on('mousemove',(ev,d)=>tipShow(tipFor(d),ev)).on('mouseleave',tipHide);
  g.filter(d=>tmFontSize(d,'group')>0).append('text').attr('class','tm-group-label').attr('x',d=>d.x0+5).attr('y',d=>d.y0+tmFontSize(d,'group')+1).style('font-size',d=>`${tmFontSize(d,'group')}px`)
    .text(d=>{const s=`${d.data.ref.name}  ${fmtB(d.value)}`;return tmLabel(s,d.x1-d.x0-10,tmFontSize(d,'group'),10);});
  const selectedName=state.selected?state.selected.split('/').slice(1).join('/'):'';
  const sel=h.descendants().filter(d=>{const r=d.data.ref;return d.depth>0&&r.level==='dir'&&(r.key===state.selected||(r.mod===state.selected&&r.name===selectedName));});
  svg.append('g').selectAll('rect').data(sel).join('rect').attr('class','tm-sel').attr('x',d=>d.x0+1).attr('y',d=>d.y0+1).attr('width',d=>Math.max(0,d.x1-d.x0-2)).attr('height',d=>Math.max(0,d.y1-d.y0-2));
  const kids=(h.children||[]).slice().sort((a,b)=>b.value-a.value);const nm=d=>d.data.ref.level==='sym'?d.data.ref.name:d.data.ref.name;
  let t='';
  if(meas==='dead'){const top=kids[0];t=top?`${fmtB(h.value)} of this view never reaches the image. The most is in ${nm(top)} (${fmtB(top.value)}).`:'';}
  else if(state.focus.length===0&&kids.length>=3){const three=kids.slice(0,3);t=`${three.map(nm).join(', ')} hold ${pctS(three.reduce((s,d)=>s+d.value,0),h.value)} of the ${MEAS_SHORT[meas].toLowerCase()}.`;}
  else if(kids.length)t=`The largest part of ${F.name} is ${nm(kids[0])}, at ${fmtB(kids[0].value)} (${pctS(kids[0].value,h.value)}).`;
  $('#tmTake').textContent=t;
  $('#tmLegend').innerHTML=state.colorBy==='kind'?KINDS.map(k=>`<span><i style="background:${KIND_COL[k]}"></i>${KIND_NAME[k]}</span>`).join('')
    :state.colorBy==='comp'?`<span class="ramp"><i style="background:linear-gradient(90deg,${COMP_LO},${COMP_HI})"></i>Share of the compressible bytes that are compressed, from none to all</span><span><i style="background:${COMP_NONE}"></i>Zero-initialized data (bss); mixed tiles are greyed in proportion</span>`
    :state.colorBy==='dead'?`<span class="ramp"><i style="background:linear-gradient(90deg,${DEAD_LO},${DEAD_HI})"></i>Share of the linker input that is eliminated, from none to all</span>`
    :`<span class="hint">Color is the top-level directory. Shades separate neighbouring subsystems.</span>`;
}

// ---------- inspector
function barList(items,max,cls){
  if(!items.length)return `<li class="none">None</li>`;
  return items.map(d=>`<li><button class="bl" data-mod="${esc(d.name)}"><span class="bl-name"><i style="background:${modColor(d.mi)}"></i>${esc(d.name)}</span><span class="bl-track"><span class="bl-bar ${cls}" style="width:${Math.max(3,100*d.w/max)}%"></span></span><span class="bl-val">${num(d.w)}</span></button></li>`).join('');
}
function renderInspector(){
  const mi=A.mods.findIndex(m=>m.name===state.selected);if(mi<0)return;const m=A.mods[mi];const nm=A.nm;
  const sel=$('#modSelect');if(sel.options.length!==A.mods.length)sel.innerHTML=A.doms.map(d=>`<optgroup label="${esc(d.name)}">${d.mods.map(i=>`<option value="${esc(A.mods[i].name)}">${esc(A.mods[i].name)}</option>`).join('')}</optgroup>`).join('');sel.value=m.name;
  const inc=[],out=[];for(let j=0;j<nm;j++){if(j===mi)continue;const a=A.mm[j*nm+mi],b=A.mm[mi*nm+j];if(a)inc.push({mi:j,name:A.mods[j].name,w:a});if(b)out.push({mi:j,name:A.mods[j].name,w:b});}
  inc.sort((a,b)=>b.w-a.w);out.sort((a,b)=>b.w-a.w);const mx=Math.max(1,...inc.slice(0,7).map(d=>d.w),...out.slice(0,7).map(d=>d.w));
  const imp=impactStored(mi,'mod');const cm=C.M[mi];const cl=m.cluster>=0?A.clusters[m.cluster]:null;
  const meas=state.measure==='dead'?'dead':'live';
  const syms=(meas==='dead'?m.deadNodes:m.liveNodes).map(i=>A.nodes[i]).sort((a,b)=>b.size-a.size).slice(0,6);
  const mis=A.misplaced.filter(x=>x.from===mi);const inbound=A.misplaced.filter(x=>x.to===mi);
  const isl=A.islands.filter(o=>o.mi===mi).slice(0,1)[0];
  $('#insBody').innerHTML=`
   <h2 class="ins-name"><i style="background:${modColor(mi)}"></i><span>${esc(m.name)}</span></h2>
   <div class="explorer-actions"><button type="button" data-explore-subsystem>Explore relationships</button></div>
   ${m.live?(()=>{const g=A.roleSub[mi];const c=roleClass(g);return `<p class="ins-role"><span class="role-tag ${c}">${ROLE_NAME[c]}</span> Used from ${g.callerDoms.size} of ${A.nd-1} other top-level directories, through ${num(g.ifaceCount)} entry sections.${g.ownerShare>=0.6?` ${pctS(g.ownerShare*g.bytes,g.bytes)} of it is reachable only through <code>${esc(A.nodes[g.owner].name)}</code>.`:''}</p>`;})():''}
   <dl class="ins-stats"><div><dt>Stored in RAM</dt><dd>${fmtB(cm.stored)}</dd></div><div><dt>Raw size</dt><dd>${fmtB(m.live)}</dd></div>
     <div><dt>Compressed</dt><dd>${cm.compRaw?pctS(cm.eligRaw,cm.compRaw):'n/a'} <small>${cm.saved?fmtB(cm.saved)+' saved':''}</small></dd></div><div><dt>Eliminated</dt><dd>${fmtB(m.dead)} <small>${pctS(m.dead,m.dead+m.live)}</small></dd></div>
     <div><dt>Functions kept</dt><dd>${num(m.funcsLive)}</dd></div><div><dt>Functions dropped</dt><dd>${num(m.funcsDead)}</dd></div></dl>
   ${cm.untap>=64*1024?`<p class="ins-note">Compressing the rest of it would save about ${fmtB(cm.untap)}${cm.hotRaw?`; ${fmtB(cm.hotRaw)} is hot code that should stay uncompressed`:''}.</p>`:''}
   ${m.live?`<div class="ins-impact"><p class="ins-k">Without this subsystem</p><p>RAM use would drop by <strong>${fmtB(imp.bytes)}</strong>${imp.others?`, including ${num(imp.others)} sections in other subsystems (${fmtB(imp.othersBytes)}) that only it needs`:''}.</p></div>`
     :`<div class="ins-impact dead"><p class="ins-k">Entirely eliminated</p><p>Nothing reachable uses this subsystem. It is compiled and linked, then thrown away: ${fmtB(m.dead)} of input in ${m.files.size} files.</p></div>`}
   <h3>Used by</h3><ol class="bars">${barList(inc.slice(0,7),mx,'in')}</ol>
   <h3>Uses</h3><ol class="bars">${barList(out.slice(0,7),mx,'out')}</ol>
   <h3>Largest ${meas==='dead'?'eliminated':'kept'} sections</h3><ol class="syms">${syms.map(n=>`<li><span class="sym-name" title="${esc(n.name)}">${esc(n.name)}</span><span class="sym-val">${fmtB(n.size)}</span></li>`).join('')||'<li class="none">None</li>'}</ol>
   ${isl&&!isl.whole?`<h3>Largest unused island</h3><p class="ins-group">${num(isl.count)} sections (${fmtB(isl.size)}) that only reference each other, mostly in <strong>${esc(isl.dir)}</strong>.</p>`:''}
   ${m.live&&cl&&m.cluster>=0?`<h3>Natural group</h3><p class="ins-group">${pctS(m.share*m.live,m.live)} of this subsystem clusters with <strong>${esc(cl.label)}</strong>.${mis.length?` ${mis.length===1?'One file':mis.length+' files'} here mostly talk${mis.length===1?'s':''} to ${esc([...new Set(mis.map(x=>A.mods[x.to].name))].join(', '))}.`:''}${inbound.length?` ${esc(inbound.map(x=>x.file).join(', '))} from elsewhere would fit better here.`:''}</p>`:''}`;
  $('#insBody').querySelectorAll('.bl').forEach(b=>b.onclick=()=>{state.selected=b.dataset.mod;renderAll();});
  $('#insBody').querySelector('[data-explore-subsystem]').onclick=()=>openRelationshipExplorer('mod',mi);
}

// ---------- eliminated code
// ---------- address map
// Live sections sorted by address, padding within and between output
// sections, and the region they sit in. Cached per analysis.
let ADDR=null;
const hexA=v=>'0x'+Math.round(v).toString(16).padStart(8,'0');
function addressLayout(){
  if(ADDR&&ADDR.A===A)return ADDR;
  const live=A.nodes.filter(n=>n.live&&n.addr>=0).sort((a,b)=>a.addr-b.addr||a.i-b.i),starts=new Float64Array(live.length);
  const outs=new Map();let pad=0,gaps=0,between=0,big=null,lo=Infinity,hi=-Infinity;
  live.forEach((n,i)=>{starts[i]=n.addr;lo=Math.min(lo,n.addr);hi=Math.max(hi,n.addr+n.size);
    let o=outs.get(n.out);if(!o)outs.set(n.out,o={name:n.out||'(none)',start:n.addr,end:n.addr+n.size,count:0,bytes:0,pad:0});
    o.end=Math.max(o.end,n.addr+n.size);o.count++;o.bytes+=n.size;
    if(!i)return;const prev=live[i-1],g=n.addr-(prev.addr+prev.size);if(g<=0)return;
    if(prev.out!==n.out){between+=g;return;}
    pad+=g;gaps++;o.pad+=g;if(!big||g>big.size)big={size:g,before:n};});
  const region=live.length?A.regions.find(r=>r.start!=null&&r.start<=lo&&hi<=r.start+r.size)||null:null;
  return ADDR={A,live,starts,outs:[...outs.values()].sort((a,b)=>a.start-b.start),pad,gaps,between,big,lo,hi,region};
}
function addressAt(L,a){
  let x=0,y=L.starts.length-1,f=-1;while(x<=y){const m=(x+y)>>1;if(L.starts[m]<=a){f=m;x=m+1;}else y=m-1;}
  const n=f>=0?L.live[f]:null;return n&&a<n.addr+n.size?{n}:{prev:n,next:L.live[f+1]||null};
}
function renderAddrMap(){
  if(!A||$('#v-addrmap').hidden)return;
  const el=$('#addrMap'),L=addressLayout();el.innerHTML='';
  if(!L.live.length){el.innerHTML='<p class="empty">This export has no section addresses. Add <code>sections.addr</code> (and optionally <code>sections.align</code>) to the export to see the layout; docs/export-format.md describes both.</p>';
    $('#addrTake').textContent='';$('#addrLegend').innerHTML='';$('#addrTable').innerHTML='';return;}
  const base=L.region?L.region.start:L.lo,top=L.region?L.region.start+L.region.size:L.hi,span=top-base;
  const labelW=88,W=Math.max(260,el.clientWidth-16||800),cols=Math.max(120,Math.floor(W-labelW));
  let rowBytes=4096;while(span/rowBytes>160)rowBytes*=2;
  const rows=Math.ceil(span/rowBytes),rowH=Math.max(3,Math.min(8,Math.floor(560/rows))),H=rows*rowH,bpp=rowBytes/cols;
  const mode=state.addrColor,outIndex=new Map(L.outs.map((o,i)=>[o.name,i])),PAD=cssVar('--ink-3'),FREE=cssVar('--surface'),SEL=cssVar('--accent');
  const colorOf=n=>n.mod===state.selected?SEL:mode==='out'?PALETTE[outIndex.get(n.out||'(none)')%PALETTE.length]
    :mode==='comp'?(n.kind==='bss'?COMP_NONE:C.elig[n.i]?COMP_HI:COMP_LO):domColor(A.doms.findIndex(d=>d.name===n.dom));
  // One sample per point: the section at the middle address of the bytes it covers.
  const img=new ImageData(cols,rows),rgb=new Map(),put=(p,c)=>{let v=rgb.get(c);if(!v){const x=d3.color(c).rgb();rgb.set(c,v=[x.r,x.g,x.b]);}img.data.set(v,p*4);img.data[p*4+3]=255;};
  const domCache=new Map(),colorCached=n=>{const k=n.i;if(!domCache.has(k))domCache.set(k,colorOf(n));return domCache.get(k);};
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const a=base+r*rowBytes+(c+.5)*bpp;if(a>=top){put(r*cols+c,FREE);continue;}
    const hit=addressAt(L,a);put(r*cols+c,hit.n?colorCached(hit.n):a>=L.lo&&a<L.hi?PAD:FREE);}
  const dpr=window.devicePixelRatio||1,canvas=document.createElement('canvas');canvas.width=Math.round((labelW+cols)*dpr);canvas.height=Math.round((H+2)*dpr);
  canvas.style.width=(labelW+cols)+'px';canvas.style.height=(H+2)+'px';canvas.setAttribute('role','img');el.appendChild(canvas);
  const ctx=canvas.getContext('2d'),buf=document.createElement('canvas');buf.width=cols;buf.height=rows;buf.getContext('2d').putImageData(img,0,0);
  ctx.scale(dpr,dpr);ctx.imageSmoothingEnabled=false;ctx.drawImage(buf,labelW,0,cols,H);
  ctx.strokeStyle=cssVar('--rule');ctx.strokeRect(labelW-.5,-.5+1,cols+1,H);
  ctx.font='10px '+getComputedStyle(document.body).fontFamily;ctx.fillStyle=cssVar('--ink-2');ctx.textAlign='right';ctx.textBaseline='top';
  const every=Math.ceil(26/rowH);for(let r=0;r<rows;r+=every)ctx.fillText(hexA(base+r*rowBytes),labelW-6,r*rowH);
  // Mark where each output section begins.
  ctx.textAlign='left';let lastY=-99;
  for(const o of L.outs){const off=o.start-base,r=Math.floor(off/rowBytes),x=labelW+(off%rowBytes)/bpp,y=r*rowH;
    ctx.fillStyle=cssVar('--ink');ctx.fillRect(Math.min(x,labelW+cols-2),y-1,2,rowH+2);
    if(y-lastY<13)continue;lastY=y;const tx=Math.min(x+4,labelW+cols-ctx.measureText(o.name).width-6);
    ctx.fillStyle=cssVar('--paper');ctx.fillRect(tx-2,y+rowH,ctx.measureText(o.name).width+4,12);ctx.fillStyle=cssVar('--ink');ctx.fillText(o.name,tx,y+rowH+1);}
  const describe=ev=>{const b=canvas.getBoundingClientRect(),c=Math.floor(ev.clientX-b.left-labelW),r=Math.floor((ev.clientY-b.top)/rowH);
    if(c<0||c>=cols||r<0||r>=rows)return null;const a=base+r*rowBytes+(c+.5)*bpp;return a<top?{a,hit:addressAt(L,a)}:null;};
  canvas.addEventListener('mousemove',ev=>{const d=describe(ev);if(!d){tipHide();return;}const {a,hit}=d,n=hit.n;
    if(n)tipShow(`<strong>${esc(n.name)}</strong><br>${hexA(n.addr)} to ${hexA(n.addr+n.size)}, ${fmtB(n.size)}${n.align?`, aligned to ${num(n.align)} bytes`:''}<br>Output section: ${esc(n.out||'none')}<br>${esc(n.objectPath||n.path)}<br>Subsystem ${esc(n.mod)}<br><span class="hint">Each point covers about ${fmtB(bpp)}</span>`,ev);
    else if(a>=L.lo&&a<L.hi&&hit.prev&&hit.next){const g=hit.next.addr-(hit.prev.addr+hit.prev.size);tipShow(`<strong>${hit.prev.out===hit.next.out?'Alignment padding':'Gap between output sections'}</strong><br>${fmtB(g)} from ${hexA(hit.prev.addr+hit.prev.size)} to ${hexA(hit.next.addr)}<br>After ${esc(hit.prev.name)}<br>Before ${esc(hit.next.name)}`,ev);}
    else tipShow(`<strong>Unused</strong><br>${fmtB(Math.max(0,top-Math.max(a,L.hi)))} from ${hexA(Math.max(L.hi,base))} to ${hexA(top)}`,ev);});
  canvas.addEventListener('mouseleave',tipHide);
  canvas.addEventListener('click',ev=>{const d=describe(ev);if(!d?.hit.n)return;state.selected=d.hit.n.mod;state.searchNode=d.hit.n.i;renderAll();});
  const take=`Live sections fill ${hexA(L.lo)} to ${hexA(L.hi)} (${fmtB(L.hi-L.lo)})${L.region?`, ${pctS(L.hi-L.lo,L.region.size)} of the ${fmtB(L.region.size)} ${L.region.name} region`:''}. Alignment adds ${fmtB(L.pad)} of padding in ${num(L.gaps)} gaps${L.big?`; the largest is ${fmtB(L.big.size)}, before ${L.big.before.name}`:''}${L.between?`. Starting output sections on page boundaries adds ${fmtB(L.between)}`:''}.${L.region&&top>L.hi?` ${fmtB(top-L.hi)} above the image is unused.`:''}`;
  $('#addrTake').textContent=take;canvas.setAttribute('aria-label','Address map. '+take+' The table below lists each output section.');
  const sw=c=>`<i style="background:${c}"></i>`;
  $('#addrLegend').innerHTML=(mode==='out'?L.outs.map((o,i)=>`<span>${sw(PALETTE[i%PALETTE.length])}${esc(o.name)}</span>`).join('')
    :mode==='comp'?`<span>${sw(COMP_HI)}Compressed</span><span>${sw(COMP_LO)}Not compressed</span><span>${sw(COMP_NONE)}Zero-initialized</span>`
    :`<span class="hint">Color is the top-level directory.</span>`)+`<span>${sw(SEL)}Selected subsystem</span><span>${sw(PAD)}Padding</span><span>${sw(FREE)}Unused</span>`;
  $('#addrTable').innerHTML=`<thead><tr><th>Output section</th><th>Start</th><th>End</th><th>Size</th><th>Alignment padding</th><th>Sections</th></tr></thead><tbody>`+
    L.outs.map(o=>`<tr><td>${esc(o.name)}</td><td><code>${hexA(o.start)}</code></td><td><code>${hexA(o.end)}</code></td><td>${fmtB(o.end-o.start)}</td><td>${fmtB(o.pad)}</td><td>${num(o.count)}</td></tr>`).join('')+'</tbody>';
}

function renderDead(){
  const T=A.total;
  if(!T.dead){$('#deadTake').textContent='This export has no eliminated sections. Have the plugin also write the sections that garbage collection discards, marked "live": false.';$('#deadMods').innerHTML='';$('#deadIsl').innerHTML='';$('#deadFiles').innerHTML='';return;}
  const whole=A.mods.filter(m=>m.dead&&!m.live);const half=A.mods.filter(m=>m.live&&m.dead>m.live).length;
  $('#deadTake').textContent=`The linker discards ${fmtB(T.dead)}, ${pctS(T.dead,T.pre)} of everything it is given. ${whole.length?`${whole.length} subsystems are dropped completely, and `:''}${half} more lose over half of their input.`;
  const rows=A.mods.filter(m=>m.dead>0).sort((a,b)=>state.deadSort==='bytes'?b.dead-a.dead:(b.dead/(b.dead+b.live))-(a.dead/(a.dead+a.live))||b.dead-a.dead).slice(0,20);
  const max=Math.max(...rows.map(m=>state.deadSort==='bytes'?m.dead+m.live:1));
  $('#deadMods').innerHTML=rows.map(m=>{const tot=m.dead+m.live;const scale=state.deadSort==='bytes'?100*tot/max:100;
    return `<li><button class="drow${m.name===state.selected?' is-sel':''}" data-mod="${esc(m.name)}"><span class="r-name"><span class="r-sym">${esc(m.name)}</span><span class="r-mod">${m.live?`${pctS(m.dead,tot)} of its input`:'Dropped completely'}</span></span>
      <span class="d-track" style="--w:${scale}%"><span class="d-dead" style="width:${100*m.dead/tot}%;--c:${modColor(m.i)}"></span><span class="d-live" style="width:${100*m.live/tot}%;--c:${modColor(m.i)}"></span></span><span class="r-val">${fmtB(m.dead)}</span></button></li>`;}).join('');
  $('#deadMods').querySelectorAll('.drow').forEach(b=>b.onclick=()=>{state.selected=b.dataset.mod;renderAll();});
  const isl=A.islands.slice(0,9);
  $('#deadIsl').innerHTML=isl.map(o=>`<li><button class="irow" data-mod="${esc(A.mods[o.mi].name)}"><span class="r-name"><span class="r-sym">${esc(o.whole?A.mods[o.mi].name:o.dir)}</span><span class="r-mod">${o.whole?'Whole subsystem, ':''}${num(o.count)} sections in ${num(o.files.size)} files</span></span><span class="r-val">${fmtB(o.size)}</span></button></li>`).join('')
    +(A.scattered.count?`<li class="scatter">Plus ${num(A.scattered.count)} unused functions and objects scattered on their own or in small groups: ${fmtB(A.scattered.size)}.</li>`:'');
  $('#deadIsl').querySelectorAll('.irow').forEach(b=>b.onclick=()=>{state.selected=b.dataset.mod;renderAll();});
  const df=A.deadFiles;const dfb=df.reduce((s,f)=>s+f.dead,0);
  $('#deadFilesTake').textContent=df.length?`${num(df.length)} object files contribute nothing to the image (${fmtB(dfb)}). They can be removed from the build or put behind a configuration option.`:'Every object file contributes at least one section to the image.';
  $('#deadFiles').innerHTML=df.slice(0,6).map(f=>`<li><span class="sym-name" title="${esc(f.path)}">${esc(f.path)}</span><span class="sym-val">${fmtB(f.dead)}</span></li>`).join('');
}

// ---------- retained size
function renderRetained(){
  const tot=C.T.stored;const items=[];
  for(const n of A.nodes){if(!n.live||n.root||!A.dom.visited[n.i])continue;const r=C.ret[n.i],own=C.stored[n.i];if(r-own>0&&r<0.2*tot)items.push({n,r,own});}
  const depth=i=>{let d=0,p=i;while(p!==A.N&&p>=0&&d<4000){p=A.dom.idom[p];d++;}return d;};
  for(const it of items)it.d=depth(it.n.i);
  items.sort((a,b)=>b.r-a.r||a.d-b.d);
  const top=[];const listed=new Map();
  for(const it of items){if(top.length>=15)break;let p=A.dom.idom[it.n.i],dup=false;
    while(p!==A.N&&p>=0){const q=listed.get(p);if(q&&it.r>=0.9*q.r){dup=true;break;}p=A.dom.idom[p];}
    if(dup)continue;top.push(it);listed.set(it.n.i,it);}
  const set=new Set(top.map(d=>d.n.i));const max=top.length?top[0].r:1;
  const inside=n=>{let p=A.dom.idom[n.i];while(p!==A.N&&p>=0){if(set.has(p))return A.nodes[p];p=A.dom.idom[p];}return null;};
  $('#retList').innerHTML=top.map(d=>{const par=inside(d.n);return `<li><button class="rrow${d.n.mod===state.selected?' is-sel':''}" data-mod="${esc(d.n.mod)}">
     <span class="r-name"><span class="r-sym" title="${esc(d.n.name)}">${esc(d.n.name)}</span><span class="r-mod">${esc(d.n.mod)}${par?`, inside ${esc(par.name)}`:''}</span></span>
     <span class="r-track"><span class="r-own" style="width:${Math.max(0.6,100*d.own/max)}%;background:${modColor(d.n.mi)}"></span><span class="r-dom" style="width:${100*(d.r-d.own)/max}%;background:${modColor(d.n.mi)}"></span></span>
     <span class="r-val">${fmtB(d.r)}</span></button></li>`;}).join('')||`<li class="none">No single section keeps anything else alive.</li>`;
  $('#retList').querySelectorAll('.rrow').forEach(b=>b.onclick=()=>{state.selected=b.dataset.mod;renderAll();});
  $('#retTake').textContent=top.length?`${top[0].n.name} alone keeps ${fmtB(top[0].r)} stored in RAM, ${pctS(top[0].r,tot)} of it. Sections that make up more than a fifth of the image, such as main and the top-level init functions, are left out.`:'';
  $('#famBody').innerHTML=A.families.slice(0,6).map(f=>`<tr><td><code>${esc(f.family)}</code></td><td class="num">${f.insts.size}</td><td class="num">${f.deadInsts.size}</td><td class="num">${fmtB(f.live)}</td></tr>`).join('')||`<tr><td colspan="4" class="none">No template has more than one instantiation.</td></tr>`;
}


// ---------- shared versus isolated
const IFACE_LINE=0.3;
const infraMods=()=>{const s=new Set();A.roleSub.forEach(g=>{if(g.breadth>=state.tau&&g.bytes>0)s.add(g.i);});return s;};
const ifaceShare=g=>Math.max(0.002,Math.min(1,1-g.privateShare));
const roleClass=g=>g.breadth>=state.tau?(ifaceShare(g)>=IFACE_LINE?'thin':'heavy'):(ifaceShare(g)<IFACE_LINE?'iso':'wide');
const ROLE_NAME={thin:'Shared infrastructure',heavy:'Shared, with a large private body',iso:'Isolated',wide:'Few users, wide surface'};
function groupName(g,level){return level==='dom'?A.doms[g.i].name:A.mods[g.i].name;}
function groupDi(g,level){return level==='dom'?g.i:A.mods[g.i].di;}
function selectGroup(g,level){if(level==='dom'){const top=A.doms[g.i].mods.slice().sort((a,c)=>A.mods[c].live-A.mods[a].live)[0];if(top!=null)state.selected=A.mods[top].name;}else state.selected=A.mods[g.i].name;renderAll();}
function roleTip(g,level){const nd=A.nd-1;const own=g.ownerShare>=0.6?`<br>${pctS(g.ownerShare*g.bytes,g.bytes)} reachable only through ${esc(A.nodes[g.owner].name)}`:'';
  return `<strong>${esc(groupName(g,level))}</strong>, ${ROLE_NAME[roleClass(g)].toLowerCase()}<br>${fmtB(gStored(g,level))} stored in RAM (${fmtB(g.bytes)} raw)<br>Used from ${g.callerDoms.size} of ${nd} other top-level directories (${g.callers.size} ${level==='dom'?'directories':'subsystems'})<br>${num(g.ifaceCount)} sections referenced from outside, ${pctS(g.ifaceBytes,g.bytes)} of its bytes${own}`;}
function renderRoles(){
  const level=state.roleLevel;const groups=(level==='dom'?A.roleDom:A.roleSub).filter(g=>g.bytes>0);
  $('#tauVal').textContent=Math.round(state.tau*100)+'%';$('#tau').value=Math.round(state.tau*100);
  const el=$('#roleMap');el.innerHTML='';const W=Math.max(560,el.clientWidth||800),H=500;const m={l:62,r:18,t:30,b:46};
  const x=d3.scaleLinear().domain([0,1]).range([m.l,W-m.r]);const y=d3.scaleLog().domain([0.002,1]).range([m.t+22,H-m.b-8]).clamp(true);
  const r=d3.scaleSqrt().domain([0,d3.max(groups,g=>gStored(g,level))]).range(level==='dom'?[5,28]:[2.5,30]);
  const svg=d3.select(el).append('svg').attr('width',W).attr('height',H).attr('viewBox',`0 0 ${W} ${H}`).attr('role','img').attr('aria-label','Shared versus isolated map');
  const xt=x(state.tau),yt=y(IFACE_LINE);
  svg.append('rect').attr('class','rq-shared').attr('x',xt).attr('y',m.t).attr('width',W-m.r-xt).attr('height',H-m.b-m.t);
  svg.append('line').attr('class','rq-line').attr('x1',xt).attr('x2',xt).attr('y1',m.t).attr('y2',H-m.b);
  svg.append('line').attr('class','rq-line').attr('x1',m.l).attr('x2',W-m.r).attr('y1',yt).attr('y2',yt);
  const corner=[[m.l+4,m.t-12,'start','Isolated: few users, narrow interface'],[W-m.r-4,m.t-12,'end','Shared, with a large private body'],[W-m.r-8,H-m.b-10,'end','Shared infrastructure'],[m.l+8,H-m.b-10,'start','Few users, wide surface']];
  svg.append('g').selectAll('text').data(corner).join('text').attr('class','rq-corner').attr('x',d=>d[0]).attr('y',d=>d[1]).attr('text-anchor',d=>d[2]).text(d=>d[3]);
  svg.append('g').attr('class','axis').attr('transform',`translate(0,${H-m.b})`).call(d3.axisBottom(x).tickValues([0,0.25,0.5,0.75,1]).tickFormat(d3.format('.0%')).tickSize(4));
  svg.append('text').attr('class','axis-title').attr('x',(m.l+W-m.r)/2).attr('y',H-8).attr('text-anchor','middle').text('Share of the other top-level directories that use it');
  svg.append('g').attr('class','axis').attr('transform',`translate(${m.l},0)`).call(d3.axisLeft(y).tickValues([0.003,0.01,0.03,0.1,0.3,1]).tickFormat(v=>v<0.01?d3.format('.1%')(v):d3.format('.0%')(v)).tickSize(4));
  svg.append('text').attr('class','axis-title').attr('transform',`translate(14,${(m.t+H-m.b)/2}) rotate(-90)`).attr('text-anchor','middle').text('Bytes referenced from outside (log)');
  const jit=i=>(((i*2654435761)>>>0)%1000/1000-0.5)*(level==='dom'?0:12);
  const pts=groups.map(g=>({g,cx:Math.max(m.l+2,Math.min(W-m.r-2,x(g.breadth)+jit(g.i))),cy:y(ifaceShare(g)),r:r(gStored(g,level))})).sort((a,b)=>b.r-a.r);
  const selMi=A.mods.findIndex(q=>q.name===state.selected);const selG=level==='dom'?(selMi>=0?A.mods[selMi].di:-1):selMi;
  const gg=svg.append('g');
  gg.selectAll('circle.own').data(pts.filter(p=>p.g.ownerShare>=0.6)).join('circle').attr('class','rb-own').attr('cx',p=>p.cx).attr('cy',p=>p.cy).attr('r',p=>p.r+3.5);
  gg.selectAll('circle.b').data(pts).join('circle').attr('class',p=>'rb'+(p.g.i===selG?' is-sel':'')).attr('cx',p=>p.cx).attr('cy',p=>p.cy).attr('r',p=>p.r).attr('fill',p=>domColor(groupDi(p.g,level)))
    .on('mousemove',(ev,p)=>tipShow(roleTip(p.g,level),ev)).on('mouseleave',tipHide).on('click',(ev,p)=>selectGroup(p.g,level));
  const lab=new Set(pts.slice(0,level==='dom'?99:7).map(p=>p.g.i));pts.forEach(p=>{if(p.g.ownerShare>=0.6||p.g.i===selG)lab.add(p.g.i);});
  if(level==='mod'){const heavy=pts.filter(p=>roleClass(p.g)==='heavy').sort((a,b)=>b.g.breadth*b.g.bytes-a.g.breadth*a.g.bytes).slice(0,2);heavy.forEach(p=>lab.add(p.g.i));}
  const placed=[];const labPts=pts.filter(p=>lab.has(p.g.i)).sort((a,b)=>(b.g.i===selG)-(a.g.i===selG)||(b.g.ownerShare>=0.6)-(a.g.ownerShare>=0.6)||b.r-a.r).filter(p=>{
    const w=groupName(p.g,level).length*6.4,right=!(p.cx>W-160);const x0=right?p.cx+p.r+4:p.cx-p.r-4-w;const bb=[x0,p.cy-8,x0+w,p.cy+8];
    if(placed.some(q=>!(bb[2]<q[0]||bb[0]>q[2]||bb[3]<q[1]||bb[1]>q[3])))return false;placed.push(bb);return true;});
  gg.selectAll('text').data(labPts).join('text').attr('class',p=>'rb-label'+(p.g.i===selG?' is-sel':'')).attr('x',p=>p.cx+p.r+4).attr('y',p=>p.cy).attr('dy','0.35em')
    .attr('text-anchor',p=>p.cx>W-160?'end':'start').attr('dx',p=>p.cx>W-160?-(2*p.r+8):0).text(p=>groupName(p.g,level));
  // takeaway
  const cls={thin:[],heavy:[],iso:[],wide:[]};groups.forEach(g=>cls[roleClass(g)].push(g));const sum=a=>a.reduce((s,g)=>s+gStored(g,level),0);const unit=level==='dom'?'directories':'subsystems';
  const shared=cls.thin.concat(cls.heavy);const drift=level==='dom'?null:cls.heavy.filter(g=>!['base','third_party','kernel','platform'].includes(A.mods[g.i].dom)).sort((a,b)=>b.breadth*b.bytes-a.breadth*a.bytes)[0];
  $('#roleTake').textContent=`${shared.length} ${unit} (${fmtB(sum(shared))}, ${pctS(sum(shared),C.T.stored)} of what is stored) are shared, used from at least ${Math.round(state.tau*100)}% of the other top-level directories. ${cls.iso.length} are isolated behind narrow interfaces (${fmtB(sum(cls.iso))}).`+
    (drift?` ${groupName(drift,level)} is used from ${drift.callerDoms.size} other directories yet keeps ${pctS(drift.bytes-drift.ifaceBytes,drift.bytes)} of its bytes private: it behaves like a feature that became infrastructure.`:'');
  renderBlobs(groups,level);
}
function renderBlobs(groups,level){
  const infra=level==='dom'?new Set(A.roleDom.filter(g=>g.breadth>=state.tau).map(g=>g.i)):infraMods();
  const cand=groups.filter(g=>roleClass(g)==='iso'&&(g.ownerShare>=0.6||(g.callers.size<=3&&ifaceShare(g)<0.05))).sort((a,b)=>b.bytes-a.bytes).slice(0,6);
  $('#blobTake').textContent=cand.length?`The largest self-contained pieces. Each could be loaded on demand, placed in its own partition, or put behind a build option, at the cost of the interface listed.`:'Nothing at this level is both rarely used and behind a narrow interface.';
  $('#blobCards').innerHTML=cand.map(g=>{const nm=groupName(g,level);const di=groupDi(g,level);
    const callers=[...g.callers.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([c,w])=>`${esc(level==='dom'?A.doms[c].name:A.mods[c].name)} <span class="muted">${num(w)}</span>`).join(', ');
    const inf=[...g.uses.entries()].filter(([c])=>infra.has(c));const infW=inf.reduce((s,[,w])=>s+w,0);const infTop=inf.sort((a,b)=>b[1]-a[1]).slice(0,3).map(([c])=>esc(level==='dom'?A.doms[c].name:A.mods[c].name)).join(', ');
    const imp=impactStored(g.i,level);const gs=level==='dom'?C.D[g.i]:C.M[g.i];
    return `<button class="blob" data-g="${g.i}"><span class="blob-head"><i style="background:${domColor(di)}"></i><span class="blob-name">${esc(nm)}</span><span class="blob-size">${fmtB(gs.stored)}</span></span>
      <span class="blob-split">${fmtB(g.code)} code, ${fmtB(g.data)} data raw${gs.saved?`, ${fmtB(gs.saved)} saved by compression`:''}</span>
      <span class="blob-row"><b>Entry points</b>${num(g.ifaceCount)} ${g.ifaceCount===1?'section':'sections'}${g.entries.length?': '+g.entries.slice(0,3).map(e=>`<code>${esc(shortName(A.nodes[e.i].name))}</code>`).join(', '):''}</span>
      <span class="blob-row"><b>${g.ownerShare>=0.6?'Reached only through':'Used by'}</b>${g.ownerShare>=0.6?`<code>${esc(A.nodes[g.owner].name)}</code> (${pctS(g.ownerShare*g.bytes,g.bytes)} of it)`:(callers||'Startup code only')}</span>
      <span class="blob-row"><b>Relies on shared code</b>${infW?`${num(infW)} references, mostly ${infTop}`:'None'}</span>
      <span class="blob-row"><b>Removable as a unit</b>${fmtB(imp.bytes)}${imp.others?`, including ${fmtB(imp.othersBytes)} elsewhere that only it uses`:''}</span></button>`;}).join('');
  $('#blobCards').querySelectorAll('.blob').forEach(b=>b.onclick=()=>selectGroup((level==='dom'?A.roleDom:A.roleSub)[+b.dataset.g],level));
}
function renderLayers(){
  const el=$('#layers');el.innerHTML='';const infra=infraMods();const nm=A.nm;
  const live=A.mods.filter(q=>q.live>0).map(q=>q.i);const rest=live.filter(i=>!infra.has(i));const inRest=new Uint8Array(nm);rest.forEach(i=>inRest[i]=1);
  const out=Array.from({length:nm},()=>[]);for(const a of rest)for(const b of rest)if(a!==b&&A.mmLayer[a*nm+b]>0)out[a].push(b);
  // Tarjan (iterative); SCCs come out sinks first
  const index=new Int32Array(nm).fill(-1),low=new Int32Array(nm),onSt=new Uint8Array(nm),sccOf=new Int32Array(nm).fill(-1);const st=[],sccs=[];let idx=0;
  for(const s of rest){if(index[s]!==-1)continue;const cs=[[s,0]];index[s]=low[s]=idx++;st.push(s);onSt[s]=1;
    while(cs.length){const fr=cs[cs.length-1];const v=fr[0];if(fr[1]<out[v].length){const w=out[v][fr[1]++];if(index[w]===-1){index[w]=low[w]=idx++;st.push(w);onSt[w]=1;cs.push([w,0]);}else if(onSt[w])low[v]=Math.min(low[v],index[w]);}
      else{cs.pop();if(cs.length){const u2=cs[cs.length-1][0];low[u2]=Math.min(low[u2],low[v]);}
        if(low[v]===index[v]){const comp=[];let w;do{w=st.pop();onSt[w]=0;sccOf[w]=sccs.length;comp.push(w);}while(w!==v);sccs.push(comp);}}}}
  const layer=new Int32Array(sccs.length);
  sccs.forEach((comp,ci)=>{let l=0;for(const v of comp)for(const w of out[v]){const cw=sccOf[w];if(cw!==ci)l=Math.max(l,layer[cw]+1);}layer[ci]=l;});
  const L=sccs.length?Math.max(...layer)+1:0;const bh=L>20?16:22,pad=L>20?4:6;
  const bands=[{name:'Shared floor',items:[...infra].filter(i=>A.mods[i].live>0)}];for(let l=0;l<L;l++)bands.push({name:`Layer ${l+1}`,items:[]});
  for(const i of rest)bands[1+layer[sccOf[i]]].items.push(i);
  bands.forEach(b=>b.items.sort((a,c)=>A.mods[a].di-A.mods[c].di||A.mods[c].live-A.mods[a].live));
  const W=Math.max(560,el.clientWidth||800),lab=88,gap=1,fh=34;const avail=W-lab-8;
  const wOf=i=>Math.sqrt(C.M[i].stored);let maxSum=1;bands.forEach(b=>{maxSum=Math.max(maxSum,b.items.reduce((s,i)=>s+wOf(i),0)+b.items.length*gap/1e9);});
  const H=fh+L*(bh+pad)+pad+8;const svg=d3.select(el).append('svg').attr('width',W).attr('height',H).attr('viewBox',`0 0 ${W} ${H}`).attr('role','img').attr('aria-label','Dependency layers');
  const pos=new Map();
  bands.forEach((b,bi)=>{const yb=bi===0?H-fh-4:H-fh-4-pad-bi*(bh+pad)+pad;const h=bi===0?fh:bh;
    svg.append('text').attr('class','ly-band').attr('x',lab-8).attr('y',yb+h/2).attr('dy','0.35em').attr('text-anchor','end').text(b.name);
    const tot=b.items.reduce((s,i)=>s+wOf(i),0);const sc=Math.min((avail-gap*b.items.length)/Math.max(tot,1),(avail-gap*b.items.length)/maxSum*1.0);
    let xx=lab;const minw=2;const ws=b.items.map(i=>Math.max(minw,wOf(i)*sc));const over=ws.reduce((s,w)=>s+w+gap,0)-avail;const k=over>0?(avail-b.items.length*(gap+minw))/Math.max(1,ws.reduce((s,w)=>s+w-minw,0)):1;
    b.items.forEach((i,j)=>{const w=over>0?minw+(ws[j]-minw)*k:ws[j];pos.set(i,{x:xx,y:yb,w,h});xx+=w+gap;});});
  const selMi=A.mods.findIndex(q=>q.name===state.selected);
  const blocks=svg.append('g');
  for(const [i,p] of pos){const q=A.mods[i];const cyc=!infra.has(i)&&sccs[sccOf[i]].length>1;
    blocks.append('rect').attr('class','ly-block'+(i===selMi?' is-sel':'')).attr('x',p.x).attr('y',p.y).attr('width',Math.max(1,p.w)).attr('height',p.h).attr('fill',domColor(q.di))
      .on('mousemove',ev=>{const g=A.roleSub[i];tipShow(`<strong>${esc(q.name)}</strong>, ${fmtB(C.M[i].stored)} stored<br>${infra.has(i)?'Shared floor':`Layer ${1+layer[sccOf[i]]}`}${cyc?`, in a dependency cycle with ${sccs[sccOf[i]].length-1} other subsystems`:''}<br>Used from ${g.callerDoms.size} other top-level directories`,ev);})
      .on('mouseleave',tipHide).on('click',()=>{state.selected=q.name;renderAll();});
    if(p.w>58)blocks.append('text').attr('class','ly-label').attr('x',p.x+4).attr('y',p.y+p.h/2).attr('dy','0.35em').text(()=>{const s=q.name.split('/').pop();const max=Math.floor((p.w-6)/6);return s.length>max?s.slice(0,Math.max(1,max-1))+'…':s;});}
  if(selMi>=0&&pos.has(selMi)){const p=pos.get(selMi);const links=[];
    for(let j=0;j<nm;j++){if(j===selMi||!pos.has(j))continue;if(A.mmLayer[selMi*nm+j]>0)links.push([j,'dep']);else if(A.mmLayer[j*nm+selMi]>0)links.push([j,'use']);}
    const lg=svg.insert('g',':first-child');
    for(const [j,kind] of links.sort((a,b)=>(a[1]==='dep'?0:1)-(b[1]==='dep'?0:1)).slice(0,60)){const q=pos.get(j);const x1=p.x+p.w/2,y1=p.y+p.h/2,x2=q.x+q.w/2,y2=q.y+q.h/2;
      lg.append('path').attr('class','ly-link '+kind).attr('d',`M${x1},${y1}C${x1},${(y1+y2)/2} ${x2},${(y1+y2)/2} ${x2},${y2}`);}
    if(!infra.has(selMi)&&sccs[sccOf[selMi]].length>1)for(const v of sccs[sccOf[selMi]]){const q=pos.get(v);if(v!==selMi)blocks.append('rect').attr('class','ly-cyc').attr('x',q.x-1).attr('y',q.y-1).attr('width',q.w+2).attr('height',q.h+2);}}
  const cyc=sccs.filter(s=>s.length>1);const inCyc=cyc.reduce((s,c)=>s+c.length,0);const big=cyc.sort((a,b)=>b.length-a.length)[0];
  const domOfBig=big?d3.rollups(big,v=>v.length,i=>A.mods[i].dom).sort((a,b)=>b[1]-a[1])[0][0]:'';
  $('#layerTake').textContent=`On top of ${fmtB([...infra].reduce((s,i)=>s+C.M[i].stored,0))} of shared code, the other ${rest.length} subsystems stack ${L} layers deep.`+(inCyc?` ${inCyc} of them sit in dependency cycles, which is why they share a layer; the largest cycle ties together ${big.length} subsystems, mostly in ${domOfBig}.`:' There are no dependency cycles.');
}
async function applyInfraToggle(){
  busy('Regrouping the code…');await tick();
  let excl=null;if(state.hideInfra==='hide'){const inf=infraMods();excl=new Uint8Array(A.N);for(const n of A.nodes)if(inf.has(n.mi))excl[n.i]=1;}
  const r=A.computeClusters(excl);A.clusters=r.clusters;A.cOf=r.cOf;busy();renderAll();
}


// ---------- compression
function compTarget(prefix,fallback){const p=state.comp.pat.split(/[\s,]+/).filter(Boolean).find(x=>x.startsWith(prefix+'.')||x===prefix);return p?p.replace(/[*?].*$/,'').replace(/\.$/,''):fallback;}
function linkerRules(){
  const mods=[],objs=[];for(const k of state.whatIf){const [t,v]=k.split(':');if(t==='m')mods.push(A.mods[+v]);else objs.push(A.nodes[+v]);}
  if(!mods.length&&!objs.length)return '';
  const tgt={code:compTarget('.text','.text.z'),rodata:compTarget('.rodata','.rodata.z'),data:compTarget('.data','.data.z')};
  const inSec={code:'.text .text.*',rodata:'.rodata .rodata.*',data:'.data .data.*'};
  const hot=[];for(const m of mods)for(const i of m.liveNodes){const n=A.nodes[i];if(n.hot&&!C.elig[i])hot.push(n);}
  let s='/* Generated by Image Proctologist: move the selected input sections into compressed output sections.\n   Paste each rule into the matching output section of your linker script. The first matching rule wins,\n   so anything listed under "keep uncompressed" must be matched earlier, in an ordinary output section. */\n';
  if(hot.length){s+='\n/* Keep uncompressed (hot path), match these before the rules below:\n'+hot.slice(0,40).map(n=>`   *(${n.kind==='code'?'.text':'.'+n.kind}.${n.name})`).join('\n')+(hot.length>40?`\n   ... and ${hot.length-40} more`:'')+' */\n';}
  for(const kind of ['code','rodata','data']){const lines=[];
    for(const m of mods){if(m.liveNodes.some(i=>A.nodes[i].kind===kind&&!C.elig[i]))lines.push(`    *${m.name}/*(${inSec[kind]})`);}
    for(const n of objs){if(n.kind===kind)lines.push(/::|[<>]/.test(n.name)?`    /* ${n.name}: use its mangled section name */`:`    *(.${kind==='code'?'text':kind}.${n.name})`);}
    if(lines.length)s+=`\n${tgt[kind]} : {\n${lines.join('\n')}\n}\n`;}
  return s;
}
function renderComp(){
  const T=C.T;const sel=state.whatIf.size;
  $('#cPat').value=state.comp.pat;$('#xPat').value=state.outExclude;$('#cCode').value=Math.round(state.comp.cr*100);$('#cData').value=Math.round(state.comp.dr*100);$('#cOv').value=state.comp.ov;
  $('#cCodeVal').textContent=Math.round(state.comp.cr*100)+'%';$('#cDataVal').textContent=Math.round(state.comp.dr*100)+'%';
  $('#compTake').textContent=T.eligRaw?`Compression stores ${fmtB(T.eligRaw)} of code and data in ${fmtB(T.eligRaw-T.saved)}, saving ${fmtB(T.saved)}${C.ov?`, or ${fmtB(T.saved-C.ov)} after the decompression buffer`:''}. Only ${pctS(T.eligRaw,T.compRaw)} of the compressible bytes are compressed today; the rest could save up to ${fmtB(T.untap)} more${T.untapHot?`, not counting ${fmtB(T.untapHot)} in hot code that is better left uncompressed`:''}.`
    :`No section is in an output section matching the patterns, so nothing is compressed. Compressing all code and read-only and initialized data would save up to ${fmtB(T.untap+T.untapHot)}.`;
  // by subsystem
  const key={untap:m=>C.M[m.i].untap,saved:m=>C.M[m.i].saved,stored:m=>C.M[m.i].stored}[state.compSort];
  const rows=A.mods.filter(m=>C.M[m.i].raw>0).sort((a,b)=>key(b)-key(a)).slice(0,20);const max=Math.max(1,...rows.map(m=>C.M[m.i].raw));
  $('#compMods').innerHTML=rows.map(m=>{const c=C.M[m.i];const solid=c.stored-c.untap;
    return `<li><button class="crow${m.name===state.selected?' is-sel':''}" data-mod="${esc(m.name)}"><span class="r-name"><span class="r-sym">${esc(m.name)}</span><span class="r-mod">${c.compRaw?pctS(c.eligRaw,c.compRaw)+' of compressible bytes compressed':'Nothing compressible'}${c.hotRaw/(c.compRaw||1)>0.1?', hot code':''}</span></span>
      <span class="c-track" style="--c:${modColor(m.i)}"><span class="c-solid" style="width:${100*solid/max}%"></span><span class="c-untap" style="width:${100*c.untap/max}%"></span><span class="c-saved" style="width:${100*c.saved/max}%"></span></span>
      <span class="r-val">${fmtB(key(m))}</span></button></li>`;}).join('');
  $('#compMods').querySelectorAll('.crow').forEach(b=>b.onclick=()=>{state.selected=b.dataset.mod;renderAll();});
  // candidates
  const isHotty=i=>{const c=C.M[i];return c.hotRaw/(c.compRaw||1)>0.1;};
  const rare=A.roleSub.filter(g=>g.bytes>0&&roleClass(g)==='iso'&&(g.ownerShare>=0.6||g.callers.size<=3)&&C.M[g.i].untap>=64*1024&&!isHotty(g.i)).sort((a,b)=>C.M[b.i].untap-C.M[a.i].untap).slice(0,8)
    .map(g=>({k:'m:'+g.i,name:A.mods[g.i].name,sub:g.ownerShare>=0.6?`Reached only through ${A.nodes[g.owner].name}`:`Used by ${g.callers.size} subsystem${g.callers.size===1?'':'s'}`,v:C.M[g.i].untap}));
  const objs=A.nodes.filter(n=>n.live&&(n.kind==='rodata'||n.kind==='data')&&!C.elig[n.i]&&n.size>=256*1024).sort((a,b)=>b.size-a.size).slice(0,8)
    .map(n=>{const cov=state.whatIf.has('m:'+n.mi);return {k:'n:'+n.i,name:n.name,sub:cov?`Included with ${n.mod}`:`${KIND_NAME[n.kind]} in ${n.mod}`,v:n.size*(1-state.comp.dr),covered:cov};});
  const poor=A.roleSub.filter(g=>g.bytes>0&&(roleClass(g)==='thin'||roleClass(g)==='heavy'||isHotty(g.i))&&C.M[g.i].untap>=128*1024).sort((a,b)=>C.M[b.i].untap-C.M[a.i].untap).slice(0,6)
    .map(g=>({k:'m:'+g.i,name:A.mods[g.i].name,sub:isHotty(g.i)?`${pctS(C.M[g.i].hotRaw,C.M[g.i].compRaw)} hot code`:`Shared by ${g.callerDoms.size} directories, likely on hot paths`,v:C.M[g.i].untap,poor:true}));
  const list=(items,empty)=>items.length?items.map(it=>`<li><label class="cand${it.poor?' poor':''}${it.covered?' covered':''}"><input type="checkbox" data-k="${it.k}"${state.whatIf.has(it.k)||it.covered?' checked':''}${it.covered?' disabled':''}><span class="r-name"><span class="r-sym" title="${esc(it.name)}">${esc(it.name)}</span><span class="r-mod">${esc(it.sub)}</span></span><span class="r-val">${fmtB(it.v)}</span></label></li>`).join(''):`<li class="none">${empty}</li>`;
  $('#candRare').innerHTML=list(rare,'No rarely used subsystem has much left to compress.');
  $('#candData').innerHTML=list(objs,'Every large data object is already compressed.');
  $('#candPoor').innerHTML=list(poor,'None.');
  $('#candHotNote').textContent=C.hasHot?'Hot sections are taken from the export and stay uncompressed in the projection.':'This export has no hot-path information, so shared infrastructure stands in for hot code here. Add "hot": true to frequently executed sections to make this exact.';
  document.querySelectorAll('#v-comp input[data-k]').forEach(cb=>cb.onchange=()=>{if(cb.checked)state.whatIf.add(cb.dataset.k);else state.whatIf.delete(cb.dataset.k);recomputeCompression();renderAll();});
  // projection and export
  const gain=T.stored-T.proj;
  $('#whatIf').innerHTML=sel?`<p class="take">Compressing the ${sel} selected item${sel===1?'':'s'} saves <strong>${fmtB(gain)}</strong> more: RAM use goes from ${fmtB(T.stored+C.ov)} to <strong>${fmtB(T.proj+C.ov)}</strong>.${T.hotSkipped?` ${num(T.hotSkipped)} hot sections in them stay uncompressed.`:''} <button class="linkbtn" id="wiClear">Clear selection</button></p>`
    :'<p class="subq">Tick candidates to see the projected saving and the linker-script changes.</p>';
  if(sel)$('#wiClear').onclick=()=>{state.whatIf.clear();recomputeCompression();renderAll();};
  const rules=linkerRules();$('#rulesBox').hidden=!rules;$('#rules').value=rules;
}

// ---------- dependency matrix (canvas)
let dsmGeom=null;
function cssVar(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim();}
function dsmItems(){
  const lvl=state.dsmLevel;const hide=state.hideInfra==='hide'?infraMods():null;
  const items=lvl==='dom'?A.doms.map((d,i)=>({i,name:d.name,di:i,live:d.live,key:state.dsmOrder==='tree'?i:d.cluster})):A.mods.filter(m=>!hide||!hide.has(m.i)).map(m=>({i:m.i,name:m.name,di:m.di,live:m.live,key:state.dsmOrder==='tree'?m.di:m.cluster}));
  if(state.dsmOrder==='cluster'){const rank=new Map();const sz=new Map();for(const it of items)sz.set(it.key,(sz.get(it.key)||0)+it.live);[...sz.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k],r)=>rank.set(k,r));
    items.sort((a,b)=>rank.get(a.key)-rank.get(b.key)||b.live-a.live);}
  return items;
}
function dsmData(){
  const items=dsmItems(),lvl=state.dsmLevel,stride=lvl==='dom'?A.nd:A.nm;
  let M=lvl==='dom'?A.dm:A.mm;
  if(lvl==='dom'&&state.hideInfra==='hide'){const inf=infraMods();M=new Float64Array(A.nd*A.nd);for(let a=0;a<A.nm;a++){if(inf.has(a))continue;for(let b=0;b<A.nm;b++){if(inf.has(b))continue;const w=A.mm[a*A.nm+b];if(w)M[A.mods[a].di*A.nd+A.mods[b].di]+=w;}}}
  const external=new Float64Array(stride);
  for(const a of items)for(const b of items)if(a.i!==b.i)external[a.i]+=M[a.i*stride+b.i];
  return {items,lvl,stride,M,external};
}
function harmonic(a,b){return a&&b?2*a*b/(a+b):0;}
function dsmPairStats(d,a,b){
  const ab=d.M[a*d.stride+b],ba=d.M[b*d.stride+a];
  const aShare=d.external[a]?ab/d.external[a]:0,bShare=d.external[b]?ba/d.external[b]:0;
  return {ab,ba,aShare,bShare,density:harmonic(aShare,bShare)};
}
function dsmMetricValue(s){return state.dsmMetric==='share'?s.aShare:state.dsmMetric==='mutual'?s.density:s.ab;}
function itemStored(i,lvl){return lvl==='dom'?C.D[i].stored:C.M[i].stored;}
function pairSelected(lvl,a,b){const p=state.dsmPair;return !!p&&p.level===lvl&&((p.a===a&&p.b===b)||(p.a===b&&p.b===a));}
function renderDSM(){
  const wrap=$('#dsm'),d=dsmData(),{items,lvl,stride,M}=d;const n=items.length;
  const avail=Math.max(320,wrap.clientWidth||700);let lab=124;let cs=Math.floor((avail-lab-10)/n);if(cs<9){lab=92;cs=Math.max(1.5,(avail-lab-10)/n);}cs=Math.min(26,cs);
  const showLabels=cs>=9;const W=Math.ceil(lab+cs*n+10),H=W;const dpr=window.devicePixelRatio||1;
  let cv=wrap.querySelector('canvas');if(!cv){cv=document.createElement('canvas');wrap.innerHTML='';wrap.appendChild(cv);bindDSM(cv);}
  cv.width=W*dpr;cv.height=H*dpr;cv.style.width=W+'px';cv.style.height=H+'px';
  const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  const ink=d3.color(cssVar('--ink')||'#16202A'),accent=cssVar('--accent')||'#C0186A',ink2=cssVar('--ink-2')||'#4B5967';
  const posOf=new Map();items.forEach((it,k)=>{posOf.set(it.i,k);});
  let max=1;for(let a=0;a<n;a++)for(let b=0;b<n;b++)if(a!==b)max=Math.max(max,dsmMetricValue(dsmPairStats(d,items[a].i,items[b].i)));
  const selMi=A.mods.findIndex(m=>m.name===state.selected);const selI=lvl==='dom'?(selMi>=0?A.mods[selMi].di:-1):selMi;const sk=posOf.has(selI)?posOf.get(selI):-1;
  ctx.fillStyle=cssVar('--accent-soft')||'rgba(192,24,106,.1)';
  if(sk>=0){ctx.fillRect(lab,lab+sk*cs,cs*n,cs);ctx.fillRect(lab+sk*cs,lab,cs,cs*n);}
  const lmax=Math.log1p(max),gap=cs>=5?1:0;
  for(let a=0;a<n;a++){const ia=items[a].i;for(let b=0;b<n;b++){const w=M[ia*stride+items[b].i];if(!w)continue;
    if(a===b){const c=d3.color(domColor(items[a].di));c.opacity=0.5;ctx.fillStyle=c.formatRgb();}
    else{const v=dsmMetricValue(dsmPairStats(d,ia,items[b].i));if(!v)continue;const c=ink.copy();const strength=state.dsmMetric==='count'?Math.log1p(v)/lmax:Math.sqrt(v/max);c.opacity=(cs<5?0.35:0.12)+(cs<5?0.65:0.88)*strength;ctx.fillStyle=c.formatRgb();}
    ctx.fillRect(lab+b*cs,lab+a*cs,cs-gap,cs-gap);}}
  if(state.dsmPair&&state.dsmPair.level===lvl){for(let a=0;a<n;a++)for(let b=0;b<n;b++)if(a!==b&&pairSelected(lvl,items[a].i,items[b].i)){ctx.strokeStyle=accent;ctx.lineWidth=Math.max(1.5,cs<5?1:2);ctx.strokeRect(lab+b*cs+0.5,lab+a*cs+0.5,cs-1,cs-1);}}
  // diagonal frames
  const runs=[];items.forEach((it,k)=>{if(runs.length&&runs[runs.length-1].key===it.key)runs[runs.length-1].len++;else runs.push({key:it.key,start:k,len:1,di:it.di});});
  ctx.lineWidth=state.dsmOrder==='tree'?1.2:1.6;ctx.strokeStyle=state.dsmOrder==='tree'?ink2:accent;
  for(const r of runs)if(r.len>1||lvl==='dom')ctx.strokeRect(lab+r.start*cs+0.5,lab+r.start*cs+0.5,r.len*cs-1,r.len*cs-1);
  // colour ticks and labels
  for(let k=0;k<n;k++){ctx.fillStyle=domColor(items[k].di);ctx.fillRect(lab-6,lab+k*cs,4,Math.max(1,cs-gap));ctx.fillRect(lab+k*cs,lab-6,Math.max(1,cs-gap),4);}
  ctx.fillStyle=ink2;ctx.textBaseline='middle';const font=cssVar('--sans')||'sans-serif';
  if(showLabels){const fs=Math.min(12,Math.max(8,cs*0.55+1));ctx.font=`${fs}px ${font}`;
    items.forEach((it,k)=>{ctx.fillStyle=k===sk?accent:ink2;ctx.textAlign='right';ctx.fillText(it.name,lab-10,lab+k*cs+cs/2);
      ctx.save();ctx.translate(lab+k*cs+cs/2,lab-10);ctx.rotate(-Math.PI/2);ctx.textAlign='left';ctx.fillText(it.name,0,0);ctx.restore();});}
  else{ctx.font=`11px ${font}`;const druns=[];items.forEach((it,k)=>{if(druns.length&&druns[druns.length-1].di===it.di)druns[druns.length-1].len++;else druns.push({di:it.di,start:k,len:1});});
    for(const r of druns){if(r.len*cs<13)continue;const nm=A.doms[r.di].name;ctx.fillStyle=ink2;ctx.textAlign='right';ctx.fillText(nm,lab-10,lab+(r.start+r.len/2)*cs);
      ctx.save();ctx.translate(lab+(r.start+r.len/2)*cs,lab-10);ctx.rotate(-Math.PI/2);ctx.textAlign='left';ctx.fillText(nm,0,0);ctx.restore();}
    if(sk>=0){ctx.fillStyle=accent;ctx.font=`600 11px ${font}`;ctx.textAlign='left';ctx.fillText('◂ '+items[sk].name,lab+n*cs+4>W-60?lab+4:lab+n*cs+4,lab+sk*cs+cs/2);}}
  dsmGeom={lab,cs,n,data:d};
  let best=null,wAll=0,wC=0,wD=0;
  for(const a of items)for(const b of items){const w=M[a.i*stride+b.i];if(!w)continue;wAll+=w;if(a.i!==b.i)wC+=w;if(a.di!==b.di){wD+=w;if(!best||w>best.w)best={a,b,w};}}
  const groups=new Set(items.map(it=>it.key)).size;
  const hide=state.hideInfra==='hide'?infraMods():null;
  $('#dsmTake').textContent=(hide?`With the ${hide.size} shared subsystems hidden, `:'')+`${pctS(wC,wAll)} of references cross a ${lvl==='dom'?'directory':'subsystem'} boundary and ${pctS(wD,wAll)} cross a top-level directory.`+(best&&best.w?` The heaviest visible link is ${best.a.name} using ${best.b.name} (${num(best.w)} references).`:'')+(state.dsmOrder==='cluster'?` Ordered by actual connections, the ${lvl==='dom'?'directories':'subsystems'} fall into ${groups} groups.`:'');
  $('#dsmMetricNote').textContent=state.dsmMetric==='count'?'Cell intensity uses a logarithmic reference count.':state.dsmMetric==='share'?'Cell intensity is the share of the row subsystem’s external references that go to the column.':'Cell intensity is the harmonic mean of the two directions’ external-reference shares; it is symmetric and highlights reciprocal dependency.';
}
function bindDSM(cv){
  const hit=ev=>{if(!dsmGeom)return null;const r=cv.getBoundingClientRect();const x=ev.clientX-r.left,y=ev.clientY-r.top;const g=dsmGeom;
    const b=Math.floor((x-g.lab)/g.cs),a=Math.floor((y-g.lab)/g.cs);if(a<0||b<0||a>=g.n||b>=g.n){
      if(x<g.lab&&a>=0&&a<g.n)return {row:a};if(y<g.lab&&b>=0&&b<g.n)return {row:b};return null;}return {a,b};};
  cv.addEventListener('mousemove',ev=>{const h=hit(ev);if(!h){tipHide();cv.style.cursor='default';return;}cv.style.cursor='pointer';const g=dsmGeom;
    const d=g.data;if(h.row!=null){const model=explorerModel();tipShow(exNodeTip(model.groupMeta((d.lvl==='dom'?'d:':'m:')+d.items[h.row].i)),ev);return;}
    const A1=d.items[h.a],B1=d.items[h.b],s=dsmPairStats(d,A1.i,B1.i);
    const model=explorerModel(),prefix=d.lvl==='dom'?'d:':'m:',src=model.groupMeta(prefix+A1.i),dst=model.groupMeta(prefix+B1.i);
    const evidence=h.a===h.b?'':model.preview(src,dst).map(r=>'<br><br>'+exEndpoint(r.src,r.sourceSection)+'<br>→ '+exEndpoint(r.dst,r.targetSection)+(r.flags?'<br>'+exAttribution(r.flags):'')).join('');
    tipShow((h.a===h.b?`<strong>${esc(A1.name)}</strong><br>${num(s.ab)} references inside`:`<strong>${esc(A1.name)}</strong> uses <strong>${esc(B1.name)}</strong><br>${num(s.ab)} references (${pctS(s.ab,d.external[A1.i])} of its external references)<br>${esc(B1.name)} uses it ${num(s.ba)} times (${pctS(s.ba,d.external[B1.i])})${s.density?`<br>Two-way coupling density: ${pctS(s.density,1)}`:''}`)+evidence,ev);});
  cv.addEventListener('mouseleave',tipHide);
  cv.addEventListener('click',ev=>{const h=hit(ev);if(!h)return;const g=dsmGeom,d=g.data;const it=d.items[h.row!=null?h.row:h.a];
    if(h.row==null)state.dsmPair={level:g.data.lvl,a:g.data.items[h.a].i,b:g.data.items[h.b].i};else state.dsmPair=null;
    if(g.data.lvl==='dom'){const top=A.doms[it.i].mods.slice().sort((a,c)=>A.mods[c].live-A.mods[a].live)[0];if(top!=null)state.selected=A.mods[top].name;}else state.selected=it.name;renderAll();});
}

function renderPairFocus(){
  const el=$('#dsmPair');const p=state.dsmPair,d=dsmGeom&&dsmGeom.data;
  if(!p||!d||p.level!==d.lvl){el.hidden=true;el.innerHTML='';return;}
  const a=d.items.find(x=>x.i===p.a),b=d.items.find(x=>x.i===p.b);
  if(!a||!b||a.i===b.i){el.hidden=true;el.innerHTML='';return;}
  const s=dsmPairStats(d,a.i,b.i),sameDir=a.di===b.di;
  el.hidden=false;
  const sameGroup=d.lvl==='dom'?A.doms[a.i].cluster===A.doms[b.i].cluster:A.mods[a.i].cluster===A.mods[b.i].cluster;
  el.innerHTML=`<div class="pair-head"><h3>Selected relationship</h3><button type="button" class="linkbtn" data-clear-pair>Clear</button></div><div class="pair-grid"><button type="button" class="pair-name" data-pair-item="${a.i}">${esc(a.name)}</button><div class="pair-flow"><strong>${num(s.ab)}</strong><span>${pctS(s.aShare,1)} of external refs →</span></div><button type="button" class="pair-name" data-pair-item="${b.i}">${esc(b.name)}</button><div class="pair-meta">${fmtB(itemStored(a.i,d.lvl))} stored</div><div class="pair-density"><strong>${pctS(s.density,1)}</strong><span>two-way coupling density</span></div><div class="pair-meta">${fmtB(itemStored(b.i,d.lvl))} stored</div><div class="pair-meta">${sameDir?'Same top-level directory':`${esc(A.doms[a.di].name)} ↔ ${esc(A.doms[b.di].name)}`}</div><div class="pair-flow"><strong>${num(s.ba)}</strong><span>← ${pctS(s.bShare,1)} of external refs</span></div><div class="pair-meta">${sameGroup?'Same natural group':'Different natural groups'}</div></div>`;
  el.querySelector('[data-clear-pair]').onclick=()=>{state.dsmPair=null;renderAll();};
  const explore=document.createElement('button');explore.type='button';explore.className='linkbtn';explore.dataset.explorePair='';explore.textContent='Explore this relationship';
  explore.onclick=()=>openRelationshipExplorer(d.lvl,a.i,b.i);el.appendChild(explore);
  el.querySelectorAll('[data-pair-item]').forEach(button=>button.onclick=()=>{const i=+button.dataset.pairItem;if(d.lvl==='dom'){const top=A.doms[i].mods.slice().sort((x,y)=>A.mods[y].live-A.mods[x].live)[0];if(top!=null)state.selected=A.mods[top].name;}else state.selected=A.mods[i].name;renderAll();});
}
function collocationRows(){
  const infra=infraMods(),hide=state.hideInfra==='hide'?infra:null,nm=A.nm,active=A.mods.filter(m=>m.live>0&&(!hide||!hide.has(m.i))).map(m=>m.i),out=new Float64Array(nm);
  for(const a of active)for(const b of active)if(a!==b)out[a]+=A.mm[a*nm+b];
  let maxRefs=1;for(let a=0;a<active.length;a++)for(let b=a+1;b<active.length;b++)maxRefs=Math.max(maxRefs,A.mm[active[a]*nm+active[b]]+A.mm[active[b]*nm+active[a]]);
  const rows=[];
  for(let ai=0;ai<active.length;ai++)for(let bi=ai+1;bi<active.length;bi++){
    const a=active[ai],b=active[bi],ab=A.mm[a*nm+b],ba=A.mm[b*nm+a];if(!ab||!ba)continue;
    const aShare=out[a]?ab/out[a]:0,bShare=out[b]?ba/out[b]:0,density=harmonic(aShare,bShare),refs=ab+ba;
    const score=density*Math.log1p(refs)/Math.log1p(maxRefs);if(!score)continue;
    const ma=A.mods[a],mb=A.mods[b],sameDir=ma.di===mb.di;
    rows.push({a,b,ab,ba,aShare,bShare,density,refs,score,sameDir,sameGroup:ma.cluster===mb.cluster,shared:!hide&&(infra.has(a)||infra.has(b))});
  }
  return rows.sort((a,b)=>b.score-a.score||b.refs-a.refs);
}
function renderCollocation(){
  const rows=collocationRows(),shown=rows.slice(0,20),body=$('#collocBody');
  $('#collocTake').textContent=rows.length?`${rows.length} reciprocal subsystem pairs were found. The top candidates combine a large share of both subsystems’ external references with enough relocation evidence to be worth reviewing. A high score is a review signal, not a directive to merge.`:'No reciprocal subsystem pairs remain after the current filters.';
  body.innerHTML=shown.map(r=>{const a=A.mods[r.a],b=A.mods[r.b],selected=pairSelected('mod',r.a,r.b);const signal=[r.sameDir?'same directory':'cross-directory',r.sameGroup?'same natural group':'different natural groups',r.shared?'shared infrastructure':''].filter(Boolean).join(' · ');
    return `<tr class="colloc-row${selected?' is-sel':''}" data-a="${r.a}" data-b="${r.b}" tabindex="0"><td><strong>${esc(a.name)}</strong><span class="colloc-arrow">↔</span><strong>${esc(b.name)}</strong></td><td class="num">${pctS(r.score,1)}</td><td class="num">${num(r.ab)} <small>${pctS(r.aShare,1)}</small></td><td class="num">${num(r.ba)} <small>${pctS(r.bShare,1)}</small></td><td class="num">${pctS(r.density,1)}</td><td class="num">${fmtB(C.M[r.a].stored+C.M[r.b].stored)}</td><td>${signal}</td></tr>`;}).join('')||'<tr><td colspan="7" class="none">No candidates match the current filters.</td></tr>';
  body.querySelectorAll('.colloc-row').forEach(row=>{const select=()=>{state.dsmLevel='mod';state.dsmPair={level:'mod',a:+row.dataset.a,b:+row.dataset.b};state.selected=A.mods[+row.dataset.a].name;renderAll();};row.onclick=select;row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}};});
}

// ---------- Sankey: subsystems of one directory -> natural groups
function relax(items,minGap,H){items.forEach(d=>d.ly=(d.y0+d.y1)/2);
  for(let i=1;i<items.length;i++)if(items[i].ly<items[i-1].ly+minGap)items[i].ly=items[i-1].ly+minGap;
  const over=items.length?items[items.length-1].ly-(H-4):0;if(over>0){items[items.length-1].ly-=over;for(let i=items.length-2;i>=0;i--)if(items[i].ly>items[i+1].ly-minGap)items[i].ly=items[i+1].ly-minGap;}}
function renderSankey(){
  const el=$('#sankey');el.innerHTML='';const selMi=A.mods.findIndex(m=>m.name===state.selected);const di=selMi>=0?A.mods[selMi].di:0;const D=A.doms[di];
  $('#skDom').textContent=D.name;
  const hideS=state.hideInfra==='hide'?infraMods():null;const left=D.mods.map(i=>A.mods[i]).filter(m=>m.code>0&&(!hideS||!hideS.has(m.i))).map(m=>({mi:m.i,v:m.code}));const tot=left.reduce((s,d)=>s+d.v,0);
  if(!tot){el.innerHTML=`<p class="empty">${hideS?'Everything in this directory counts as shared infrastructure, which is hidden.':'Nothing in this directory reaches the image.'}</p>`;$('#skTake').textContent='';return;}
  const W=Math.max(640,el.clientWidth||800);const SMALL=-1;
  const fl=[];const rv=new Map();for(const d of left){for(const [c,v] of A.mods[d.mi].perCode)fl.push({mi:d.mi,c,v});}
  const csz=new Map();for(const f of fl)csz.set(f.c,(csz.get(f.c)||0)+f.v);
  for(const f of fl)if(csz.get(f.c)<0.02*tot)f.c=SMALL;
  const merged=new Map();for(const f of fl){const k=f.mi+'|'+f.c;const o=merged.get(k);if(o)o.v+=f.v;else merged.set(k,{...f});}
  const flows=[...merged.values()];for(const f of flows)rv.set(f.c,(rv.get(f.c)||0)+f.v);
  const gap=3,H=Math.max(380,left.length*22,rv.size*18);
  const k=Math.min((H-gap*(left.length-1))/tot,(H-gap*(rv.size-1))/tot);
  let y=(H-(tot*k+gap*(left.length-1)))/2;const LY=new Map();for(const d of left){d.y0=y;d.y1=y+d.v*k;LY.set(d.mi,d);y=d.y1+gap;}
  const right=[...rv.entries()].map(([c,v])=>({c,v}));
  for(const r of right){let s=0,sw=0;for(const f of flows){if(f.c!==r.c)continue;const l=LY.get(f.mi);s+=(l.y0+l.y1)/2*f.v;sw+=f.v;}r.bary=sw?s/sw:H;}
  right.sort((a,b)=>(a.c===SMALL)-(b.c===SMALL)||a.bary-b.bary);
  y=(H-(tot*k+gap*(right.length-1)))/2;const RY=new Map();for(const r of right){r.y0=y;r.y1=y+r.v*k;RY.set(r.c,r);y=r.y1+gap;}
  const labL=150,labR=Math.min(260,W*0.32),x0=labL,x1=W-labR-10,nw=10;
  const offL=new Map(),offR=new Map();
  flows.sort((a,b)=>RY.get(a.c).y0-RY.get(b.c).y0);for(const f of flows){const l=LY.get(f.mi);const o=offL.has(f.mi)?offL.get(f.mi):l.y0;f.ly0=o;f.ly1=o+f.v*k;offL.set(f.mi,f.ly1);}
  flows.sort((a,b)=>LY.get(a.mi).y0-LY.get(b.mi).y0);for(const f of flows){const r=RY.get(f.c);const o=offR.has(f.c)?offR.get(f.c):r.y0;f.ry0=o;f.ry1=o+f.v*k;offR.set(f.c,f.ry1);}
  const svg=d3.select(el).append('svg').attr('width',W).attr('height',H+8).attr('viewBox',`0 0 ${W} ${H+8}`).attr('role','img').attr('aria-label',`How ${D.name} groups`);
  const sel=state.selected;const xa=x0+nw,xb=x1,xm=(xa+xb)/2;const cname=c=>c===SMALL?'Smaller groups':A.clusters[c].label;
  svg.append('g').selectAll('path').data(flows).join('path').attr('class','sk-flow').attr('fill',d=>d3.color(domColor(di)).brighter(((LY.get(d.mi)&&left.indexOf(LY.get(d.mi)))%3-1)*0.3).formatHex())
    .attr('fill-opacity',d=>A.mods[d.mi].name===sel?0.8:0.22)
    .attr('d',d=>`M${xa},${d.ly0}C${xm},${d.ly0} ${xm},${d.ry0} ${xb},${d.ry0}L${xb},${d.ry1}C${xm},${d.ry1} ${xm},${d.ly1} ${xa},${d.ly1}Z`)
    .on('mousemove',(ev,d)=>tipShow(`<strong>${esc(A.mods[d.mi].name)}</strong> with <strong>${esc(cname(d.c))}</strong><br>${fmtB(d.v)}`,ev)).on('mouseleave',tipHide)
    .on('click',(ev,d)=>{state.selected=A.mods[d.mi].name;renderAll();});
  relax(left,12,H);relax(right,13,H);
  const gl=svg.append('g');
  for(const d of left){const m=A.mods[d.mi];
    gl.append('rect').attr('x',x0).attr('y',d.y0).attr('width',nw).attr('height',Math.max(1,d.y1-d.y0)).attr('fill',modColor(d.mi)).attr('class','sk-node').on('click',()=>{state.selected=m.name;renderAll();});
    gl.append('text').attr('class','sk-label'+(m.name===sel?' is-sel':'')).attr('x',x0-6).attr('y',d.ly).attr('dy','0.35em').attr('text-anchor','end').text(m.name.split('/').slice(1).join('/')||m.name).on('click',()=>{state.selected=m.name;renderAll();});}
  for(const r of right){gl.append('rect').attr('x',x1).attr('y',r.y0).attr('width',nw).attr('height',Math.max(1,r.y1-r.y0)).attr('class','sk-node sk-right');
    gl.append('text').attr('class','sk-label').attr('x',x1+nw+6).attr('y',r.ly).attr('dy','0.35em').text(`${cname(r.c)}  ${pctS(r.v,tot)}`);}
  const ms=D.mods.map(i=>A.mods[i]).filter(m=>m.code&&(!hideS||!hideS.has(m.i)));const splits=ms.filter(m=>{let mx=0;for(const v of m.perCode.values())mx=Math.max(mx,v);return mx<0.75*m.code;}).length;
  const outside=right.filter(r=>r.c!==SMALL&&A.mods[A.clusters[r.c].parts[0][0]].di!==di).reduce((s,r)=>s+r.v,0);
  $('#skTake').textContent=`${splits} of ${ms.length} subsystems in ${D.name} split across more than one group.`+(outside?` ${pctS(outside,tot)} of its code groups most naturally with code that lives in other directories.`:'');
}

// ---------- misplaced files
function renderMisplaced(){
  const rows=A.misplaced.slice(0,15);
  $('#misBody').innerHTML=rows.map(r=>`<tr class="${A.mods[r.from].name===state.selected||A.mods[r.to].name===state.selected?'is-sel':''}" data-mod="${esc(A.mods[r.from].name)}" tabindex="0">
     <td><span class="m-file" title="${esc(r.path)}">${esc(r.path.split('/').slice(2).join('/'))}</span><span class="m-funcs">${r.funcs} functions</span></td><td>${esc(A.mods[r.from].name)}</td><td><strong>${esc(A.mods[r.to].name)}</strong></td>
     <td class="num">${num(r.home)}</td><td class="num">${num(r.there)}</td><td class="num">${fmtB(r.size)}</td></tr>`).join('')||`<tr><td colspan="6" class="none">Every file talks most to its own subsystem.</td></tr>`;
  $('#misBody').querySelectorAll('tr[data-mod]').forEach(tr=>{const goSel=()=>{state.selected=tr.dataset.mod;renderAll();};tr.onclick=goSel;tr.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();goSel();}};});
  $('#misTake').textContent=A.misplaced.length?`${A.misplaced.length===1?'One file talks':num(A.misplaced.length)+' files talk'} far more to another subsystem than to the rest of their own.${A.misplaced.length>15?' The 15 strongest are listed.':''}`:'No file is pulled more strongly toward another subsystem than toward its own.';
}

// ---------- controls and loading
function renderSymbolDetails(){
  const d=A.details,panel=$('#symbolPanel');
  document.querySelectorAll('input[name="pathMode"]').forEach(r=>{r.checked=r.value===state.pathMode;if(r.value==='source')r.disabled=!d||!d.mapped;});
  const target=d?.codeTargets;
  $('#sourceCoverage').textContent=d?`${num(d.mapped)} sections have a single mapped DWARF source; ${num(d.mixed)} have mixed sources. Missing or mixed mappings retain object ownership. Source locations are declarations, not call sites.`+(target?.count?` Code targets: ${num(target.exact)} exact, ${num(target.approximate)} nearest-function, and ${num(target.sectionOnly)} section-only relocation uses.`:''):'Object paths are shown. Export with symbol_details=dwarf for DWARF source grouping, or symbol_details=elf for symbol/reference inspection.';
  const n=state.searchNode==null?null:A.nodes[state.searchNode];
  panel.hidden=!d||!n;if(panel.hidden)return;
  const symbols=d.members(n.i),refs=d.references(n.i),fragments=d.fragmentsForSection(n.i),total=d.offsets[n.i+1]-d.offsets[n.i];
  const loc=s=>s.sourceFile?`${esc(s.sourceFile)}:${s.sourceLine}`:'Not available';
  const flags=(bits,tags)=>tags.filter(([bit])=>bits&bit).map(([,name])=>name).join(', ')||'—';
  const ref=(s,i)=>`<button type="button" class="linkbtn" data-section="${i}">${esc(s?s.name:A.nodes[i].name+' [section only]')}</button>`;
  $('#symbolDetailBody').innerHTML=`<p><strong>${esc(n.name)}</strong> · ${fmtB(n.size)} section bytes<br>Object: ${esc(n.objectPath||n.path)}</p>
    <p>${num(total)} symbol records; showing ${num(symbols.length)}. Symbol ranges may overlap; section bytes are counted only once. Offsets are relative to the identified chunk.</p>
    <div class="xref-scroll"><table class="xref-table"><thead><tr><th>Symbol</th><th>Chunk / offset / size</th><th>Binding / type</th><th>DWARF declaration</th></tr></thead><tbody>${symbols.map(s=>`<tr><td title="${esc(s.linkageName)}"><button type="button" class="linkbtn" data-explore-symbol="${s.id}">${esc(s.name)}</button></td><td>${s.chunk} / ${s.offset} / ${s.size}</td><td>${flags(s.flags,[[1,'local'],[2,'weak'],[4,'function'],[8,'data']])}</td><td>${loc(s)}</td></tr>`).join('')}</tbody></table></div>
    ${fragments.length?`<h4>Initializer fragments</h4><p>Anonymous data targets referenced by data symbols. Physical bytes remain in their original section and are never counted again here; shared fragments remain shared.</p><div class="xref-scroll"><table class="xref-table"><thead><tr><th>Container</th><th>Fragment</th><th>Class</th><th>Uses</th><th>Ownership</th></tr></thead><tbody>${fragments.map(f=>{const target=A.nodes[f.targetSection],container=d.symbol(f.container);return `<tr><td>${esc(container.name)}</td><td><button type="button" class="linkbtn" data-section="${target.i}">${esc(target.name)}</button> · ${fmtB(target.size)}</td><td>${esc(d.fragmentName(f.class))}</td><td>${num(f.count)}</td><td>${f.ownerCount===1?'unique':'shared by '+num(f.ownerCount)}</td></tr>`;}).join('')}</tbody></table></div>`:''}
    <h4>References involving this section</h4><p>Up to 40 highest-count pairs, including same-section references. Counts are static relocations. “source approx” and “target approx” use a nearest symbol only when an exact range is unavailable; “unattributed” means no source symbol.</p>
    <div class="xref-scroll"><table class="xref-table"><thead><tr><th>Source</th><th>Target</th><th>Count</th><th>Flags</th></tr></thead><tbody>${refs.map(e=>`<tr><td>${ref(e.src,e.sourceSection)}</td><td>${ref(e.dst,e.targetSection)}</td><td>${e.count}</td><td>${flags(e.flags,[[1,'source approx'],[2,'unattributed'],[4,'trampoline'],[8,'target approx']])}</td></tr>`).join('')}</tbody></table></div>`;
  panel.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{const next=A.nodes[+b.dataset.section];state.searchNode=next.i;state.selected=next.mod;state.focus=next._focusPath.slice();renderAll();});
  let explore=panel.querySelector('[data-explore-section]');
  if(!explore){explore=document.createElement('button');explore.type='button';explore.className='linkbtn';explore.dataset.exploreSection='';explore.textContent='Explore this section’s relationships';panel.appendChild(explore);}
  explore.onclick=()=>exFocus('section:'+n.i,'symbol');
  panel.querySelectorAll('[data-explore-symbol]').forEach(button=>{
    button.onclick=()=>exFocus('s:'+button.dataset.exploreSymbol,'symbol');
    button.onmousemove=ev=>tipShow(exNodeTip(explorerModel().symbolMeta(+button.dataset.exploreSymbol)),ev);button.onmouseleave=tipHide;
  });
}
/*EXPLORER*/
function syncTreemapControls(){
  $('#tmMeasure').value=state.measure;$('#tmColor').value=state.colorBy;
  for(const name of ['treeMode','fragmentView'])document.querySelectorAll(`#tmTree input[name="${name}"]`).forEach(r=>{r.checked=r.value===state[name];});
  // Mark the Tree button when the structure differs from what a new export starts with.
  const changed=!!A&&(state.treeMode!=='source'||(!!A.details?.logicalFragments?.length&&state.fragmentView!=='logical')||state.pathMode!==(A.details?.mapped?'source':'object'));
  $('#tmTree .tm-tree-dot').hidden=!changed;$('#tmTreeChanged').textContent=changed?' (changed from the default)':'';
}
function syncControls(){syncTreemapControls();document.querySelectorAll('[data-set]').forEach(b=>{const [k,v]=b.dataset.set.split(':');b.setAttribute('aria-pressed',String(state[k]===v));});
  const logical=$('[data-set="fragmentView:logical"]');if(logical)logical.disabled=!(A?.details?.logicalFragments.length);
  document.querySelectorAll('.meas-name').forEach(s=>s.textContent=MEAS_SHORT[state.measure].toLowerCase());$('#sampleCtl').hidden=A&&A.__sample!==true;}
function renderAll(){syncNavigation();syncControls();renderHero();renderTreemap();renderSymbolDetails();renderComp();renderInspector();renderDead();renderRetained();renderRoles();renderLayers();renderDSM();renderPairFocus();renderCollocation();renderSankey();renderMisplaced();renderAddrMap();renderExplorer();}
const busy=(msg)=>{const b=$('#busy');if(msg){b.querySelector('p').textContent=msg;b.hidden=false;}else b.hidden=true;};
const tick=()=>new Promise(r=>setTimeout(r,30));
function warnBeforeLeaving(ev){ev.preventDefault();ev.returnValue='';}
function setLeaveWarning(enabled){
  window.removeEventListener('beforeunload',warnBeforeLeaving);
  if(enabled)window.addEventListener('beforeunload',warnBeforeLeaving);
}
async function load(data,isSample,preserveCompression=false){
  SOURCE=data;
  if(!preserveCompression){state.pathMode='source';state.fragmentView='logical';}
  if(!data.symbolDetails)state.pathMode='object';
  const savedCompression=state.comp;
  const nSec=isColumnar(data)?(data.sections.count!=null?data.sections.count:data.sections.size.length):(data.nodes||[]).length;const nRef=isColumnar(data)?((data.refs&&data.refs.targets)||[]).length:(data.edges||[]).length;
  busy(`Analyzing ${num(nSec)} sections and ${num(nRef)} references…`);await tick();
  try{A=analyze(data,{excludeOutput:outputFilter(),pathMode:state.pathMode});if(!A.details?.mapped)state.pathMode='object';A.format=isColumnar(data)?'columnar':'objects';A.__sample=!!isSample;TREE=buildTree(state.treeMode);const cd=A.compression||{};state.comp=preserveCompression?savedCompression:{pat:cd.patterns||'.*clade*',cr:cd.codeRatio>0?cd.codeRatio:0.30,dr:cd.dataRatio>0?cd.dataRatio:0.50,ov:cd.decompressBufferBytes>=0?cd.decompressBufferBytes/MIB:0};state.whatIf=new Set();recomputeCompression();}catch(err){busy();$('#loadMsg').textContent='Could not analyze this data. '+(err.message||err);return;}
  state.focus=[];state.searchQuery='';state.searchNode=null;state.searchOut='';state.searchMsg='';state.hideInfra='show';state.dsmPair=null;const big=A.mods.slice().sort((a,b)=>b.live-a.live)[0];state.selected=big?big.name:null;
  $('#restore').hidden=!!isSample;renderAll();setLeaveWarning(!isSample);busy();
}
async function loadSample(){busy(`Building a synthetic image with about ${num(+state.sample)} sections…`);await tick();SAMPLE=generateSample({symbols:+state.sample});await load(SAMPLE,true);}
function applySetting(k,v){if(state[k]===v)return;state[k]=v;
  if(k==='measure'){TREE=buildTree(state.treeMode);recomputeCompression();renderAll();return;}if(k==='sample'){loadSample();return;}if(k==='treeMode'||k==='fragmentView'){busy('Reorganizing the treemap…');setTimeout(()=>{TREE=buildTree();recomputeCompression();state.focus=[];state.searchQuery='';state.searchNode=null;state.searchOut='';state.searchMsg='';renderAll();busy();go('#v-treemap');},30);return;}if(k==='hideInfra'){applyInfraToggle();return;}if(k==='roleLevel'){syncControls();renderRoles();return;}if(k==='dsmLevel'||k==='dsmOrder'||k==='dsmMetric'){syncControls();renderDSM();renderPairFocus();renderCollocation();return;}if(k==='deadSort'){syncControls();renderDead();return;}if(k==='compSort'){syncControls();renderComp();return;}renderAll();}
document.querySelectorAll('[data-set]').forEach(b=>b.addEventListener('click',()=>{const [k,v]=b.dataset.set.split(':');applySetting(k,v);}));
$('#tmMeasure').addEventListener('change',e=>applySetting('measure',e.target.value));
$('#tmColor').addEventListener('change',e=>applySetting('colorBy',e.target.value));
document.querySelectorAll('#tmTree input[type="radio"]').forEach(r=>r.addEventListener('change',async()=>{
  if(r.name!=='pathMode'){applySetting(r.name,r.value);return;}
  state.pathMode=r.value;if(SOURCE)await load(SOURCE,A&&A.__sample===true,true);}));
document.querySelectorAll('[data-workspace]').forEach(b=>b.addEventListener('click',()=>{const workspace=b.dataset.workspace;activateWorkspace(workspace);requestAnimationFrame(()=>scrollToElement($(`[data-workspace-panel="${workspace}"]`)));}));
document.querySelectorAll('[data-view-workspace]').forEach(b=>b.addEventListener('click',()=>{const workspace=b.dataset.viewWorkspace,view=b.dataset.view;activateWorkspace(workspace,view);requestAnimationFrame(()=>scrollToElement($(`#v-${view}`)));}));
$('#modSelect').addEventListener('change',e=>{state.selected=e.target.value;renderAll();});
$('#tmSearchForm').addEventListener('submit',e=>{e.preventDefault();searchTreemap();});
$('#tau').addEventListener('input',e=>{$('#tauVal').textContent=e.target.value+'%';});
$('#tau').addEventListener('change',e=>{state.tau=(+e.target.value)/100;if(state.hideInfra==='hide')applyInfraToggle();else renderAll();});
const compChanged=()=>{state.comp={pat:$('#cPat').value,cr:(+$('#cCode').value)/100,dr:(+$('#cData').value)/100,ov:Math.max(0,+$('#cOv').value||0)};recomputeCompression();renderAll();};
$('#cPat').addEventListener('change',compChanged);$('#cOv').addEventListener('change',compChanged);
['cCode','cData'].forEach(id=>{$('#'+id).addEventListener('input',e=>{$('#'+id+'Val').textContent=e.target.value+'%';});$('#'+id).addEventListener('change',compChanged);});
$('#xPat').addEventListener('change',async()=>{state.outExclude=$('#xPat').value;if(SOURCE)await load(SOURCE,A&&A.__sample===true,true);});
$('#copyRules').addEventListener('click',async()=>{const t=$('#rules');t.select();let ok=false;try{await navigator.clipboard.writeText(t.value);ok=true;}catch{try{ok=document.execCommand('copy');}catch{/* the text stays selected for a manual copy */}}$('#copyMsg').textContent=ok?'Copied.':'Copy did not work here. The text is selected; press Ctrl+C or Cmd+C.';});
$('#showComp').addEventListener('click',()=>{state.measure='stored';state.colorBy='comp';state.focus=[];renderAll();go('#v-treemap');});
$('#showDead').addEventListener('click',()=>{state.measure='dead';state.focus=[];renderAll();go('#v-treemap');});
async function readExport(f){
  const buf=new Uint8Array(await f.arrayBuffer());
  let bytes=buf;
  if(buf.length>2&&buf[0]===0x1f&&buf[1]===0x8b){
    if(typeof DecompressionStream==='undefined')throw new Error('This browser cannot decompress gzip files. Decompress it first, or use a current version of Chrome, Edge, Firefox or Safari.');
    busy(`Decompressing ${f.name}…`);await tick();
    bytes=new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());}
  busy(`Parsing ${f.name} (${fmtB(bytes.length)})…`);await tick();
  let d;try{d=JSON.parse(new TextDecoder().decode(bytes));}catch(err){throw new Error('It is not valid JSON. '+(err.message||''),{cause:err});}
  if(!d||typeof d!=='object')throw new Error('It does not contain a JSON object.');
  if(isColumnar(d)){if(!d.sections||!Array.isArray(d.sections.size))throw new Error('This columnar export has no sections.size array.');if(!d.sections.size.length)throw new Error('The export has no sections.');}
  else{if(!Array.isArray(d.nodes)||!Array.isArray(d.edges))throw new Error('It has neither "nodes" and "edges" arrays nor a columnar "sections" and "refs" block. See the data format below.');if(!d.nodes.length)throw new Error('The file has no nodes.');}
  if(!d.title)d.title=f.name.replace(/\.gz$/i,'');
  return d;
}
$('#fileIn').addEventListener('change',async e=>{const f=e.target.files&&e.target.files[0];if(!f)return;e.target.value='';$('#loadMsg').textContent='';
  busy(`Reading ${f.name}…`);await tick();
  let d;try{d=await readExport(f);}catch(err){busy();$('#loadMsg').textContent=`Could not load ${f.name}. ${err.message||err}`;return;}
  await load(d,false);});
$('#restore').addEventListener('click',()=>{$('#loadMsg').textContent='';if(SAMPLE)load(SAMPLE,true);else loadSample();});
let rt=null;const ro=new ResizeObserver(()=>{clearTimeout(rt);rt=setTimeout(()=>{if(A){renderTreemap();renderAddrMap();renderRoles();renderLayers();renderDSM();renderSankey();renderExplorer();}},150);});ro.observe($('#mainCol'));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(A){renderDSM();renderExplorer();}});

if(typeof d3==='undefined'){$('#loadMsg').textContent='The charting library did not load, so the views cannot be drawn. Check the network connection and reload.';return;}
loadSample();
})();
