// ===================== core: generator + analysis (no DOM) =====================
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function shuffleInPlace(arr,R){for(let i=arr.length-1;i>0;i--){const j=Math.floor(R()*(i+1));const t=arr[i];arr[i]=arr[j];arr[j]=t;}return arr;}
const MiB=1048576;

const DOMAINS=[
 ['apps',6,'cpp','launcher settings camera_app gallery media_player voice_assistant navigation phone messages browser_lite factory_test demo_mode fitness weather'],
 ['ui',5,'cpp','toolkit layout text input widgets themes accessibility i18n windowing gestures'],
 ['services',5,'cpp','boot_mgr config telemetry logging_svc crash_dump ota update_agent power_svc time_svc location connectivity_mgr account notification scheduler_svc health diag factory license'],
 ['media',4,'cpp','codec_h264 codec_hevc codec_av1 codec_vp9 codec_aac codec_mp3 codec_opus demux_mp4 demux_mkv demux_ts mux_mp4 streaming_hls streaming_dash player recorder transcoder subtitle drm_media'],
 ['graphics',4,'cpp','compositor gl_runtime vulkan_runtime shader_compiler raster fonts image_decode animation gpu_mem display_mgr color_mgmt hdr'],
 ['audio',4,'cpp','mixer effects dsp_graph voice_proc echo_cancel beamforming wakeword codec_mgr routing spatial'],
 ['camera',4,'cpp','pipeline isp_tuning aaa hdr_merge denoise face_detect stabilizer jpeg_enc metadata calibration'],
 ['ml',4,'cpp','runtime graph quant kernels_cpu kernels_dsp kernels_npu ops_vision ops_audio ops_nlp models_vision models_speech models_legacy profiler'],
 ['sensors',4,'c','fusion imu baro mag als proximity activity step gesture'],
 ['radio',3,'c','lte_phy lte_mac lte_rlc lte_pdcp lte_rrc nr_phy nr_mac nr_rlc nr_pdcp nr_rrc nas sim rf_cal rf_ctrl dsp_fw harq sched_ul sched_dl measurement positioning'],
 ['net',3,'c','ethernet ip4 ip6 tcp udp quic dns dhcp nat firewall routing bridge vlan qos sockets tls_glue mqtt http coap websocket ntp mdns ppp netlink'],
 ['bluetooth',3,'c','host_core l2cap rfcomm a2dp avrcp hfp gatt smp le_audio mesh'],
 ['security',3,'c','keystore attestation secure_boot tee_client crypto_api cert_store access_ctrl audit drm fuse_policy'],
 ['storage',3,'c','block partition fat ext4 f2fs littlefs cache ftl encryption quota backup ota_store'],
 ['drivers',2,'c','usb_core usb_gadget usb_xhci pcie i2c spi uart gpio dma emmc ufs nvme sdio eth_mac eth_phy wifi_fw_if bt_hci gnss camera_csi display_dsi display_hdmi gpu_kmd npu_kmd dsp_ipc audio_i2s audio_codec touch sensor_hub haptics battery charger watchdog rtc crypto_engine rng can_bus lin_bus flexray video_vpu isp_kmd'],
 ['tools',2,'c','gdbstub profiler tracer memcheck coverage shell perf_counters kunit'],
 ['kernel',1,'c','sched mm vfs ipc irq timer smp power_mgmt trace syscalls loader rcu workqueue cgroup'],
 ['platform',1,'c','boot clocks pinctrl pmic thermal dvfs iommu smmu firmware_if mailbox secure_monitor debug_uart reset efuse'],
 ['base',0,'c','libc libm libcxx containers strings json protobuf_rt zlib lz4 crc logging fmt regex time_utils allocators threading'],
 ['third_party',0,'c','openssl mbedtls icu sqlite lwip freetype harfbuzz libpng libjpeg_turbo flatbuffers tflite_micro eigen opus libwebp zstd curl expat lua cjson nanopb'],
];
const CPP_OVERRIDE=new Set(['base/libcxx','base/containers','base/protobuf_rt','base/json','third_party/icu','third_party/harfbuzz','third_party/flatbuffers','third_party/tflite_micro','third_party/eigen']);
const FAC={'third_party/openssl':4,'third_party/icu':3.5,'third_party/sqlite':2.5,'third_party/eigen':2.5,'radio/nr_phy':4,'radio/lte_phy':3,'graphics/shader_compiler':4,'graphics/vulkan_runtime':3.5,'graphics/gl_runtime':3,'ml/runtime':2.5,'ml/kernels_cpu':3,'media/codec_hevc':3,'media/codec_av1':3,'media/codec_h264':2.5,'kernel/mm':2,'kernel/sched':1.8,'base/libc':2,'base/libcxx':2.5,'apps/factory_test':1.6,'media/codec_vp9':2.5,'ml/models_legacy':1.2,'bluetooth/mesh':1.5,'net/quic':2,'drivers/gpu_kmd':2.5,'tools/kunit':1.4,'services/telemetry':2.6,'tools/gdbstub':1.2,'tools/tracer':1.3};
const DEADRATE={'third_party/openssl':.6,'third_party/icu':.65,'third_party/sqlite':.5,'third_party/eigen':.72,'third_party/curl':.55,'third_party/expat':.4,'third_party/mbedtls':.5,'third_party/harfbuzz':.45,'third_party/freetype':.45,'third_party/flatbuffers':.5,'third_party/tflite_micro':.55,'third_party/zstd':.4,'third_party/libwebp':.5,'base/regex':.6,'base/libcxx':.45,'base/fmt':.4,'base/json':.35};
const DEAD_SUBS=new Set(['media/codec_vp9','ml/models_legacy','apps/demo_mode','net/ppp','drivers/flexray','bluetooth/mesh','third_party/lua']);
const LAZY=new Set(['apps/factory_test','tools/kunit','tools/gdbstub','tools/tracer','ml/models_vision','third_party/icu']);
const COMPS='core api impl hal util proto ops backend cfg compat io engine'.split(' ');
const NOUNS='buffer queue state ctx request table session config handle entry node packet frame stream event cache pool desc map list task port channel job slot block record token cursor view'.split(' ');
const VERBS='get set handle process update read write alloc release start stop check build parse encode decode reset flush find apply submit poll attach detach map unmap'.split(' ');
const FILEW='core impl util ops mgr io proto helpers table api glue'.split(' ');

function generateSample(opts){
  opts=opts||{};
  const T=opts.symbols||150000;const R=mulberry32(opts.seed||11);
  const rnd=(a,b)=>a+Math.floor(R()*(b-a+1));
  const pick=a=>a[Math.floor(R()*a.length)];
  const gauss=()=>{let u=0,v=0;while(!u)u=R();while(!v)v=R();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};
  const logn=(med,s)=>Math.exp(Math.log(med)+s*gauss());
  const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
  const camel=s=>s.split('_').map(cap).join('');
  const nodes=[];const emap=new Map();const BIG=4194304;const names=new Set();
  const uniq=n=>{if(!names.has(n)){names.add(n);return n;}let i=2;while(names.has(n+'_'+i))i++;const s=n+'_'+i;names.add(s);return s;};
  const mk=(name,path,kind,size,live,cls,blob)=>{const o={id:nodes.length,name:uniq(name),path,kind,size,live};if(cls)o.class=cls;if(blob)o._blob=1;nodes.push(o);return o;};
  const link=(a,b,c)=>{if(!a||!b||a===b)return;if(a.live&&!b.live)return;const k=a.id*BIG+b.id;emap.set(k,(emap.get(k)||0)+(c||1));};

  // subsystems
  const SS=[],SSM={},doms=[];
  for(const [dom,layer,lang,list] of DOMAINS){const d={name:dom,layer,subs:[]};doms.push(d);
    for(const s of list.split(' ')){const key=dom+'/'+s;
      const o={key,dom,name:s,layer,lang:CPP_OVERRIDE.has(key)?'cpp':lang,fac:FAC[key]||Math.max(0.25,logn(1,0.6)),dead:DEAD_SUBS.has(key),lazy:LAZY.has(key),
        deadRate:DEADRATE[key]!=null?DEADRATE[key]:0.17,deadFileP:dom==='third_party'?0.15:0.095,files:[],api:[],liveFuncs:[],deadFuncs:[],init:null,deps:[]};
      SS.push(o);SSM[key]=o;d.subs.push(o);}}
  const sumFac=SS.reduce((s,x)=>s+x.fac,0);const TF=T*0.84;

  function genFile(ss,comp,fname,n,fileDead){
    const path=ss.dom==='third_party'?`${ss.key}/source/${comp}/${fname}`:`${ss.key}/${comp}/${fname}`;const f={path,ss,funcs:[],live:[],publics:[],dead:fileDead,aff:null};
    const nouns=[...ss.name.split('_').filter(w=>w.length>2),...NOUNS];
    let classes=null;
    if(ss.lang==='cpp'){classes=[];const nc=rnd(1,3);for(let c=0;c<nc;c++)classes.push(`${ss.dom}::${ss.name}::${camel(pick(nouns))}${pick(['','Impl','Manager','Cache','View','Handler','Pool'])}`);}
    for(let i=0;i<n;i++){
      const live=!fileDead&&!ss.dead&&(i<2||R()>=ss.deadRate);
      let name,cls=null;
      if(classes&&R()<0.85){cls=pick(classes);name=`${cls}::${pick(VERBS)}${cap(pick(nouns))}`;}
      else if(classes)name=`${ss.dom}::${ss.name}::${pick(VERBS)}${cap(pick(nouns))}`;
      else name=`${ss.name}_${pick(VERBS)}_${pick(nouns)}`;
      const x=mk(name,path,'code',Math.max(16,logn(380,0.85)),live,cls);f.funcs.push(x);(live?f.live:ss.deadFuncs).push(x);
    }
    f.publics=f.live.slice(0,Math.min(f.live.length,rnd(1,3)));
    for(let i=1;i<f.live.length;i++)link(f.live[rnd(0,i-1)],f.live[i],rnd(1,2));
    const dl=f.funcs.filter(x=>!x.live);
    for(let j=0;j<dl.length;j++){if(j>0&&R()<0.7)link(dl[rnd(0,j-1)],dl[j]);if(f.live.length&&R()<0.35)link(dl[j],pick(f.live));}
    for(const x of f.live)if(R()<0.35)link(x,pick(f.live),rnd(1,2));
    const cpp=ss.lang==='cpp';const mkData=(kind,med,sig)=>{
      const refs=[];const k=rnd(1,3);for(let i=0;i<k;i++)refs.push(pick(f.funcs));
      const live=refs.some(r=>r.live);
      const nm=cpp?`${ss.dom}::${ss.name}::${kind==='bss'?'s':kind==='data'?'g':'k'}${camel(pick(nouns))}${pick(['Table','Lut','Desc','Buf','State','Names'])}`:`${ss.name}_${pick(nouns)}_${pick(['tbl','lut','desc','buf','state','names'])}`;
      const d=mk(nm,path,kind,Math.max(4,logn(med,sig)),live);for(const r of refs)link(r,d,rnd(1,3));};
    const nr=rnd(0,2);for(let i=0;i<nr;i++)mkData('rodata',600,1.1);
    if(R()<0.3)mkData('data',120,1);if(R()<0.35)mkData('bss',900,1.1);
    ss.files.push(f);ss.liveFuncs.push(...f.live);
    return f;
  }

  for(const ss of SS){
    const nF=Math.max(12,Math.round(TF*ss.fac/sumFac));const nFiles=Math.max(2,Math.round(nF/12));
    const nc=Math.min(6,Math.max(1,Math.round(Math.sqrt(nFiles)/1.3)));const comps=shuffleInPlace(COMPS.slice(),R).slice(0,nc);
    const used=new Set();
    for(let i=0;i<nFiles;i++){const comp=comps[i%nc];let fname,tries=0;
      do{fname=`${pick([...ss.name.split('_'),...NOUNS])}_${pick(FILEW)}${tries>3?'_'+i:''}.${ss.lang==='cpp'?'cpp':'c'}`;tries++;}while(used.has(comp+'/'+fname));
      used.add(comp+'/'+fname);
      const n=Math.max(3,Math.round(nF/nFiles*(0.5+R())));
      genFile(ss,comp,fname,n,i>0&&R()<ss.deadFileP);}
    // thin infrastructure exposes most of what it has; everything else hides a body behind a few entry points
    const WIDE=ss.dom==='base'&&ss.name!=='containers'&&ss.name!=='protobuf_rt'||['kernel/sched','kernel/ipc','kernel/irq','kernel/timer','kernel/workqueue','platform/clocks','platform/pinctrl'].includes(ss.key);
    if(!ss.dead)for(const f of ss.files)if(!f.dead)ss.api.push(...(WIDE?f.live:f.publics));
  }

  // deps
  const usable=SS.filter(s=>!s.dead&&!s.lazy&&s.api.length&&s.key!=='platform/boot');
  const baseCore=['base/libc','base/strings','base/logging','base/allocators'].map(k=>SSM[k]);
  const radioApi=SSM['radio/nas'];const telemetry=SSM['services/telemetry'];
  for(const ss of SS){
    const sameAll=usable.filter(s=>s.dom===ss.dom&&s!==ss);const myIdx=doms.find(d=>d.name===ss.dom).subs.indexOf(ss);
    const below=sameAll.filter(s=>doms.find(d=>d.name===ss.dom).subs.indexOf(s)<myIdx);
    // mostly layered inside a directory, with the occasional upward reference that forms a cycle
    const pickSame=()=>below.length&&R()<0.96?pick(below):pick(sameAll);const same=sameAll;
    // outside radio/, the radio stack is only reachable through radio/nas
    const lower=usable.filter(s=>s.layer<ss.layer&&(s.dom!=='radio'||s===radioApi||ss.dom==='radio'));
    const fallback=usable.filter(s=>s.dom==='base'&&s!==ss);const set=new Set();const n=rnd(3,9);const pSame=ss.dom==='radio'?0.85:0.5;
    for(let i=0;i<n;i++){let c;if(same.length&&R()<pSame)c=pickSame();else c=lower.length?pick(lower):pick(fallback);if(c&&c!==ss)set.add(c);}
    if(ss!==telemetry&&!['base','third_party','radio','platform'].includes(ss.dom)&&R()<0.45)set.add(telemetry);
    for(const b of baseCore)if(b!==ss&&R()<0.6)set.add(b);
    ss.deps=[...set];
  }
  SSM['apps/factory_test'].deps.push(SSM['tools/kunit']);

  // files in the wrong place
  const cand=[];for(const ss of usable){if(ss.dom==='base'||ss.dom==='third_party')continue;for(const f of ss.files)if(!f.dead&&f.live.length>=5&&ss.files.length>3)cand.push(f);}
  shuffleInPlace(cand,R);
  for(const f of cand.slice(0,16)){const ok=f.ss.deps.filter(d=>d.dom!=='base'&&d.dom!=='third_party'&&d.liveFuncs.length>20);const same=ok.filter(d=>d.dom===f.ss.dom);const mode=R()<0.5?'in':'out';const tgt=same.length&&(mode==='in'||R()<0.75)?pick(same):mode==='out'&&ok.length?pick(ok):null;if(!tgt)continue;
    f.aff=tgt;f.affMode=mode;const pubs=new Set(f.publics);f.ss.api=f.ss.api.filter(x=>!pubs.has(x));}

  // cross-file and cross-subsystem references
  for(const ss of SS){const deps=ss.deps.filter(d=>d.api.length);
    for(const f of ss.files){
      for(const x of f.funcs){
        if(x.live){
          if(f.aff){if(f.affMode==='out'&&R()<0.75)link(x,pick(f.aff.api),rnd(1,3));if(deps.length&&R()<0.15)link(x,pick(pick(deps).api));continue;}
          if(deps.length&&R()<0.32)link(x,pick(pick(deps).api),rnd(1,2));
          if(ss.api.length&&R()<0.22)link(x,pick(ss.api),rnd(1,2));
        }else{
          if(deps.length&&R()<0.3)link(x,pick(pick(deps).api));
          if(ss.deadFuncs.length&&R()<0.25)link(x,pick(ss.deadFuncs));
        }}
      if(f.aff&&f.affMode==='in'){const k=rnd(16,30);for(let i=0;i<k;i++)link(pick(f.aff.liveFuncs),pick(f.live),rnd(1,2));}
    }}

  // template families
  const tplFile=(ssKey,file)=>{const ss=SSM[ssKey];return {path:`${ss.key}/core/${file}`,ss};};
  const users=SS.filter(s=>s.dom!=='base'&&s.dom!=='third_party');
  const family=(file,count,instName,methods,med)=>{
    for(let i=0;i<count;i++){const u=pick(users);const live=!u.dead&&R()>0.15&&u.liveFuncs.length>0;const inst=instName(i);
      for(const m of methods){const x=mk(`${inst}::${m}`,file.path,'code',Math.max(24,logn(med,0.5)),live,inst);
        const pool=live?u.liveFuncs:u.deadFuncs;const k=rnd(1,3);x._objSrc=u.files[0].path;
        for(let j=0;j<k&&pool.length;j++){const c=pick(pool);if(!j)x._objSrc=c.path;link(c,x);}}}};
  family(tplFile('base/containers','static_vector.hpp'),40,i=>`base::StaticVector<${camel(pick(NOUNS))}${i}, ${pick([4,8,16,32,64])}>`,['push_back','erase','insert','find','clear'],300);
  family(tplFile('base/containers','callback.hpp'),70,i=>`base::Callback<void(${camel(pick(NOUNS))}${i} const&)>`,['invoke','bind','reset'],130);
  family(tplFile('base/protobuf_rt','message.hpp'),160,i=>`pb::Message<${camel(pick(NOUNS))}${camel(pick(VERBS))}Msg${i}>`,['serialize','parse','byteSize','mergeFrom'],650);
  family(tplFile('base/containers','flat_map.hpp'),30,i=>`base::FlatMap<${camel(pick(NOUNS))}Id, ${camel(pick(NOUNS))}${i}>`,['find','insert','erase','rehash'],420);

  // inits and boot
  for(const ss of SS){if(ss.dead)continue;const f0=ss.files.find(f=>!f.dead&&f.live.length);if(!f0)continue;
    const init=mk(ss.lang==='cpp'?`${ss.dom}::${ss.name}::init`:`${ss.name}_init`,f0.path,'code',Math.max(24,logn(160,0.5)),true);ss.init=init;ss.liveFuncs.push(init);
    for(const f of ss.files)if(!f.dead&&f.publics[0])link(init,f.publics[0]);}
  const bootF=SSM['platform/boot'].files[0].path;
  const reset=mk('Reset_Handler',bootF,'code',140,true);reset.root=true;reset._noSource=1;
  const main=mk('main',bootF,'code',420,true);link(reset,main);link(reset,SSM['platform/boot'].init);
  for(const d of doms){const subs=d.subs.filter(s=>!s.dead&&!s.lazy&&s.init);if(!subs.length)continue;
    const di=mk(`${d.name}_init`,subs[0].files[0].path,'code',Math.max(24,logn(200,0.4)),true);link(main,di);for(const s of subs)link(di,s.init);}
  const vec=mk('__vector_table',bootF,'rodata',4096,true);vec.root=true;vec._noSource=1;link(vec,reset);
  for(const ss of SS){if(ss.dom!=='drivers'||ss.dead||!ss.api.length)continue;const f0=ss.files[0];
    const h=mk(`${ss.name.toUpperCase()}_IRQHandler`,f0.path,'code',Math.max(24,logn(120,0.5)),true);link(vec,h);link(h,pick(ss.api));link(h,pick(ss.liveFuncs));}

  // features reachable through exactly one call
  const entry=(callerSS,name,targets,cls)=>{const c=SSM[callerSS];const f=c.files.find(x=>!x.dead&&x.live.length>2);
    const fn=mk(name,f.path,'code',Math.max(64,logn(700,0.3)),true,cls);link(f.live[1]||f.live[0],fn);
    for(const t of targets){const T2=SSM[t];if(T2.init)link(fn,T2.init);for(const g of T2.files)if(!g.dead&&g.publics[0])link(fn,g.publics[0]);}return fn;};
  entry('apps/camera_app','apps::camera_app::Scene::loadModels',['ml/models_vision'],'apps::camera_app::Scene');
  entry('ui/text','ui::text::Shaper::shapeComplex',['third_party/icu'],'ui::text::Shaper');
  entry('services/diag','services::diag::enterFactoryMode',['apps/factory_test'],'services::diag::Console');
  entry('services/diag','services::diag::enableDebugger',['tools/gdbstub','tools/tracer'],'services::diag::Console');

  // large objects
  const BIN=new Set(['dsp_fw_image','wifi_fw_blob','icudt74_dat']);
  const blob=(ssKey,name,kind,size,live)=>{const ss=SSM[ssKey];const f=ss.files.find(x=>live?(!x.dead&&x.live.length):true)||ss.files[0];
    const d=mk(name,f.path,kind,size,live,null,true);if(BIN.has(name)){d._objPath=`${ss.key}/${name}.bin.o`;d._noSource=1;}const pool=live?f.live:f.funcs;const k=rnd(1,3);for(let i=0;i<k;i++)link(pick(pool),d,rnd(1,3));return d;};
  blob('graphics/display_mgr','g_framebuffers','bss',16*MiB,true);blob('graphics/gpu_mem','gpu_carveout','bss',16*MiB,true);
  blob('kernel/mm','__kernel_heap','bss',24*MiB,true);blob('net/sockets','net_pkt_pool','bss',6*MiB,true);
  blob('camera/pipeline','cam_frame_pool','bss',8*MiB,true);blob('ml/runtime','ml_tensor_arena','bss',6*MiB,true);
  blob('media/player','media_bitstream_buf','bss',4*MiB,true);
  blob('ml/models_vision','ml::models_vision::kDetectorV3Weights','rodata',11*MiB,true);blob('ml/models_vision','ml::models_vision::kSegmenterWeights','rodata',7*MiB,true);
  blob('ml/models_speech','ml::models_speech::kAsrWeights','rodata',8*MiB,true);blob('third_party/icu','icudt74_dat','rodata',12*MiB,true);
  blob('radio/dsp_fw','dsp_fw_image','rodata',12*MiB,true);blob('graphics/fonts','graphics::fonts::kFallbackFonts','rodata',4*MiB,true);
  blob('drivers/wifi_fw_if','wifi_fw_blob','rodata',2*MiB,true);
  blob('ml/models_legacy','ml::models_legacy::kSceneNetV1Weights','rodata',9*MiB,false);blob('apps/demo_mode','apps::demo_mode::kDemoAssets','rodata',3*MiB,false);
  blob('media/codec_vp9','vp9_default_probs','rodata',640*1024,false);blob('third_party/icu','icu_legacy_conv_tables','rodata',2*MiB,false);

  // anything the roots cannot reach is what --gc-sections would drop
  {const out=new Map();for(const k of emap.keys()){const a=Math.floor(k/BIG),b=k%BIG;let l=out.get(a);if(!l){l=[];out.set(a,l);}l.push(b);}
   const seen=new Uint8Array(nodes.length);const st=nodes.filter(n=>n.root).map(n=>n.id);st.forEach(i=>seen[i]=1);
   while(st.length){const v=st.pop();const l=out.get(v);if(l)for(const w of l)if(!seen[w]&&nodes[w].live){seen[w]=1;st.push(w);}}
   for(const n of nodes)if(n.live&&!seen[n.id])n.live=false;}
  // scale ordinary symbols to a several-hundred-MiB image
  const TARGET={code:150*MiB,rodata:22*MiB,data:10*MiB,bss:14*MiB};const sum={code:0,rodata:0,data:0,bss:0};
  for(const n of nodes)if(!n._blob&&n.live)sum[n.kind]+=n.size;
  for(const n of nodes){if(n._blob){delete n._blob;continue;}n.size=Math.max(4,Math.round(n.size*TARGET[n.kind]/sum[n.kind]/2)*2);}

  // Object files follow build targets, not source directories. First-party
  // subsystems are one GN-style target each, so objects are flattened into the
  // subsystem directory; vendored libraries keep CMake's mirrored object tree.
  // About half of the misplaced files are already compiled by the target of
  // the subsystem they talk to. Paths below are the object paths a linker sees.
  const objectOf=new Map(),objectNames=new Map(),stemOf=p=>p.slice(p.lastIndexOf('/')+1).replace(/\.[^.]+$/,'');
  for(const ss of SS){const seen=new Map();for(const f of ss.files)seen.set(stemOf(f.path),(seen.get(stemOf(f.path))||0)+1);objectNames.set(ss,seen);}
  for(const ss of SS)for(const f of ss.files){
    const parts=f.path.split('/'),comp=parts[parts.length-2],stem=stemOf(f.path);
    if(ss.dom==='third_party'){objectOf.set(f.path,`${ss.key}/CMakeFiles/${ss.name}.dir/${f.path.slice(ss.key.length+1)}.o`);continue;}
    const owner=f.aff&&f.affMode==='in'?f.aff:ss,clash=(objectNames.get(owner).get(stem)||0)>(owner===ss?1:0);
    objectOf.set(f.path,`${owner.key}/${owner.name}.${clash?(owner===ss?comp:ss.name)+'_':''}${stem}.o`);}
  for(const n of nodes){n._source=n._noSource?'':n.path;n.path=n._objPath||objectOf.get(n._objSrc||n.path)||n.path;}

  // output sections: some subsystems already live in compressed output sections; hot code never does
  const HOT={'kernel/sched':.6,'kernel/irq':.7,'kernel/timer':.5,'kernel/workqueue':.4,'platform/clocks':.4,'base/libc':.35,'base/strings':.4,'base/allocators':.5,'net/ip4':.15,'net/tcp':.15,'radio/nr_phy':.4,'radio/lte_phy':.4,'radio/harq':.3,'audio/dsp_graph':.3,'graphics/compositor':.2};
  const ZSUBS=new Set(['media/codec_h264','media/codec_hevc','media/codec_av1','media/codec_aac','media/codec_mp3','media/codec_opus','services/diag','services/factory','services/license','services/crash_dump','ui/i18n','ui/themes','ui/accessibility','tools/profiler','tools/tracer','tools/memcheck','tools/coverage','tools/shell','third_party/sqlite','graphics/fonts','ml/models_speech','storage/backup']);
  const BASE={code:'.text',rodata:'.rodata',data:'.data'};
  for(const n of nodes){const sub=n.path.split('/').slice(0,2).join('/');
    if(n.kind==='code'&&(/IRQHandler$/.test(n.name)||(HOT[sub]&&R()<HOT[sub])))n.hot=true;
    if(n.kind==='bss'){n.out='.bss';continue;}
    const z=(ZSUBS.has(sub)||(sub.startsWith('apps/')&&sub!=='apps/factory_test'))&&!n.hot;n.out=BASE[n.kind]+(z?'.z':'');}
  // Link-time layout: output sections in linker-script order, each page aligned;
  // input sections in object order within each. Addresses are before any
  // post-link compression, so .z output sections are laid out at raw size.
  vec.out='.vectors';
  const RAM0=0x80000000,ORDER=['.vectors','.text','.text.z','.rodata','.rodata.z','.data','.data.z','.bss'];
  const alignOf=n=>n.out==='.vectors'?128:n.size>=MiB?4096:n.kind==='code'?(n.hot?16:4):8;
  const placed=nodes.filter(n=>n.live).sort((a,b)=>ORDER.indexOf(a.out)-ORDER.indexOf(b.out)||(a.path<b.path?-1:a.path>b.path?1:0)||a.id-b.id);
  {let at=RAM0,out='';for(const n of placed){if(n.out!==out){out=n.out;at=Math.ceil(at/4096)*4096;}n.align=alignOf(n);at=Math.ceil(at/n.align)*n.align;n.addr=at;at+=n.size;}}
  const edges=new Array(emap.size);let i=0;for(const [k,c] of emap){edges[i++]={src:Math.floor(k/BIG),dst:k%BIG,count:c};}
  const doc={title:`Large RAM-only image (synthetic, ${Math.round(nodes.length/1000)}k sections)`,regions:{RAM:{start:RAM0,size:512*MiB}},compression:{patterns:'.*clade*',codeRatio:0.30,dataRatio:0.50,decompressBufferBytes:0},nodes,edges};
  if(opts.details!==false)doc.symbolDetails=sampleSymbolDetails(nodes,edges,(opts.seed||11)+101);
  for(const n of nodes){delete n._source;delete n._objSrc;delete n._objPath;delete n._noSource;}
  return doc;
}

// DWARF-style symbol details for the synthetic image: one symbol per section
// (function and data sections), declaration files from the source tree and
// symbol-level references. A separate random stream keeps the image itself
// independent of whether details are requested.
function sampleSymbolDetails(nodes,edges,seed){
  const R=mulberry32(seed),sourceFiles=[],fileIndex=new Map(),line=new Map();
  const mangle=(name,code)=>!name.includes('::')||/[<(]/.test(name)?name:'_ZN'+name.split('::').map(p=>p.length+p).join('')+'E'+(code?'v':'');
  const symbols=nodes.map(n=>{
    const code=n.kind==='code',sym={id:n.id,section:n.id,chunk:n.id,name:n.name,linkageName:mangle(n.name,code),offset:0,size:n.size,
      flags:(code?4:8)|(n._objSrc?2:0)|(code&&/^[a-z0-9_]+$/.test(n.name)&&n.name!=='main'&&!n.name.endsWith('_init')&&R()<0.3?1:0)};
    if(n._source){let f=fileIndex.get(n._source);if(f==null){f=sourceFiles.length;sourceFiles.push(n._source);fileIndex.set(n._source,f);}
      const at=(line.get(n._source)||10+Math.floor(R()*20))+6+Math.floor(R()*70);line.set(n._source,at);sym.sourceFile=f;sym.sourceLine=at;}
    return sym;});
  // A few code targets resolve only to the nearest preceding function, and a few calls go through trampolines.
  const refs=edges.map(e=>({sourceSection:e.src,targetSection:e.dst,src:e.src,dst:e.dst,count:e.count,
    flags:(nodes[e.dst].kind==='code'&&R()<0.02?8:0)|(nodes[e.dst].kind==='code'&&R()<0.005?4:0)}));
  return {version:1,sourceFiles,symbols,refs};
}

// ---------------- analysis ----------------
function csr(N,src,dst,w,mask){
  const off=new Int32Array(N+1);for(let e=0;e<src.length;e++)if(!mask||mask(e))off[src[e]+1]++;
  for(let i=0;i<N;i++)off[i+1]+=off[i];
  const adj=new Int32Array(off[N]),wt=w?new Float64Array(off[N]):null;const pos=off.slice(0,N);
  for(let e=0;e<src.length;e++){if(mask&&!mask(e))continue;const p=pos[src[e]]++;adj[p]=dst[e];if(wt)wt[p]=w[e];}
  return {off,adj,wt};
}
function dominatorsCSR(N,G,roots){
  const V=N;const post=new Int32Array(N+1).fill(-1);const order=[];const visited=new Uint8Array(N+1);
  const stN=new Int32Array(N+1),stE=new Int32Array(N+1);let sp=0;stN[0]=V;stE[0]=0;visited[V]=1;
  const deg=v=>v===V?roots.length:G.off[v+1]-G.off[v];const at=(v,k)=>v===V?roots[k]:G.adj[G.off[v]+k];
  while(sp>=0){const v=stN[sp];if(stE[sp]<deg(v)){const w=at(v,stE[sp]++);if(!visited[w]){visited[w]=1;sp++;stN[sp]=w;stE[sp]=0;}}
    else{post[v]=order.length;order.push(v);sp--;}}
  // predecessors among visited
  const pc=new Int32Array(N+2);
  for(const v of order){const d=deg(v);for(let k=0;k<d;k++){const w=at(v,k);pc[w+1]++;}}
  for(let i=0;i<=N;i++)pc[i+1]+=pc[i];const pr=new Int32Array(pc[N+1]);const pp=pc.slice();
  for(const v of order){const d=deg(v);for(let k=0;k<d;k++){const w=at(v,k);pr[pp[w]++]=v;}}
  const idom=new Int32Array(N+1).fill(-1);idom[V]=V;let changed=true;
  while(changed){changed=false;
    for(let r=order.length-1;r>=0;r--){const b=order[r];if(b===V)continue;let ni=-1;
      for(let q=pc[b];q<pc[b+1];q++){const p=pr[q];if(idom[p]===-1)continue;if(ni===-1){ni=p;continue;}
        let f1=p,f2=ni;while(f1!==f2){while(post[f1]<post[f2])f1=idom[f1];while(post[f2]<post[f1])f2=idom[f2];}ni=f1;}
      if(ni!==-1&&idom[b]!==ni){idom[b]=ni;changed=true;}}}
  return {idom,order,visited};
}
function louvainCSR(n,G,R,gamma){
  gamma=gamma||1;let off=G.off,adj=G.adj,wt=G.wt;
  let k=new Float64Array(n);for(let i=0;i<n;i++){let s=0;for(let e=off[i];e<off[i+1];e++)s+=wt[e];k[i]=s;}
  let m2=0;for(let i=0;i<n;i++)m2+=k[i];
  const member=new Int32Array(n);for(let i=0;i<n;i++)member[i]=i;if(m2===0)return member;
  let cur=n;
  for(let level=0;level<20;level++){
    const comm=new Int32Array(cur);for(let i=0;i<cur;i++)comm[i]=i;const tot=Float64Array.from(k);
    const nw=new Float64Array(cur);const touched=new Int32Array(cur);const order=new Int32Array(cur);for(let i=0;i<cur;i++)order[i]=i;
    let any=false;
    for(let pass=0;pass<(level===0?8:20);pass++){let moved=0;
      for(let i=cur-1;i>0;i--){const j=Math.floor(R()*(i+1));const t=order[i];order[i]=order[j];order[j]=t;}
      for(let oi=0;oi<cur;oi++){const i=order[oi];const ci=comm[i],ki=k[i];let nt=0;
        for(let e=off[i];e<off[i+1];e++){const j=adj[e];if(j===i)continue;const c=comm[j];if(nw[c]===0)touched[nt++]=c;nw[c]+=wt[e];}
        tot[ci]-=ki;let best=ci,bg=nw[ci]-gamma*tot[ci]*ki/m2;
        for(let q=0;q<nt;q++){const c=touched[q];const g=nw[c]-gamma*tot[c]*ki/m2;if(g>bg+1e-12){bg=g;best=c;}}
        for(let q=0;q<nt;q++)nw[touched[q]]=0;nw[ci]=0;
        tot[best]+=ki;if(best!==ci){comm[i]=best;moved++;any=true;}}
      if(moved<cur*0.002)break;}
    if(!any)break;
    const map=new Int32Array(cur).fill(-1);let nc=0;for(let i=0;i<cur;i++){if(map[comm[i]]===-1)map[comm[i]]=nc++;}
    const em=new Map();const nk=new Float64Array(nc);
    for(let i=0;i<cur;i++){const a=map[comm[i]];nk[a]+=k[i];for(let e=off[i];e<off[i+1];e++){const b=map[comm[adj[e]]];if(a===b)continue;const key=a*nc+b;em.set(key,(em.get(key)||0)+wt[e]);}}
    const S=new Int32Array(em.size),D=new Int32Array(em.size),W=new Float64Array(em.size);let q=0;for(const [key,w] of em){S[q]=Math.floor(key/nc);D[q]=key%nc;W[q]=w;q++;}
    const G2=csr(nc,S,D,W);off=G2.off;adj=G2.adj;wt=G2.wt;
    for(let v=0;v<n;v++)member[v]=map[comm[member[v]]];k=nk;cur=nc;
    if(nc===1)break;
  }
  return member;
}

// ---------------- ingestion: two export formats ----------------
// Object format: { nodes:[{id,name,path,kind,size,live,root,hot,out,class}], edges:[{src,dst,count}] }
// Columnar format ("fia-columnar"): string tables + one array per attribute + references grouped by source.
const KINDS=['code','rodata','data','bss'],KI={code:0,rodata:1,data:2,bss:3};
function makeNode(i,id,name,path,kind,size,live,cls,root,out,hot){
  const cut=path.lastIndexOf('/');const file=cut>=0?path.slice(cut+1):path;const dir=cut>=0?path.slice(0,cut):'';
  const s1=dir.indexOf('/');const dom=dir?(s1<0?dir:dir.slice(0,s1)):'(top level)';
  let mod=dom;if(s1>=0){const s2=dir.indexOf('/',s1+1);mod=s2<0?dir:dir.slice(0,s2);}
  return {i,id,name,path,file,dir,dom,mod,kind,ki:KI[kind],size,live,cls,root:live&&root,out,hot};
}
function isColumnar(data){return !!data&&(data.format==='fia-columnar'||(!!data.sections&&!!data.refs));}
// Optional layout: final link-time address (-1 or absent when unknown or
// eliminated) and alignment in bytes (0 when unknown).
function layoutField(v,live,what,i){
  if(v==null||v===(what==='addr'?-1:0))return what==='addr'?-1:0;
  if(!Number.isSafeInteger(v)||v<(what==='addr'?0:1))throw new Error(`Section ${i} has an invalid ${what} (${v}); use a non-negative integer${what==='addr'?' or -1':', or 0 when unknown'}.`);
  return what==='addr'&&!live?-1:v;
}
function ingestClassic(data,excludeOutput=null){
  const raw=data.nodes||[];const idx=new Map();const nodes=[];
  for(const n of raw){if(!n||n.id==null)continue;const id=String(n.id);if(idx.has(id))continue;
    const kind=KI[n.kind]!=null?n.kind:'code';const live=n.live!==false;
    const out=n.out!=null?String(n.out):'';if(excludeOutput&&excludeOutput(out))continue;
    const o=makeNode(nodes.length,id,String(n.name!=null?n.name:id),String(n.path||('(unknown)/'+n.name)),kind,Math.max(0,+n.size||0),live,n.class||null,!!n.root,out,!!n.hot);
    o.addr=layoutField(n.addr,live,'addr',id);o.align=layoutField(n.align,live,'align',id);
    idx.set(id,o.i);nodes.push(o);}
  const ed=data.edges||[];const S=new Int32Array(ed.length),D=new Int32Array(ed.length),W=new Float64Array(ed.length);let m=0;
  for(const e of ed){const a=idx.get(String(e.src)),b=idx.get(String(e.dst));if(a==null||b==null||a===b)continue;S[m]=a;D[m]=b;W[m]=Math.max(1,+e.count||1);m++;}
  return {nodes,S:S.subarray(0,m),D:D.subarray(0,m),W:W.subarray(0,m),m};
}
function ingestColumnar(doc,excludeOutput=null){
  const st=doc.strings||{},sec=doc.sections||{},refs=doc.refs||{};
  if(doc.version!=null&&doc.version>1)throw new Error(`This file uses columnar format version ${doc.version}; this page reads version 1.`);
  const N=sec.count!=null?+sec.count:(sec.size||[]).length;
  const col=(k,req)=>{const a=sec[k];if(a==null){if(req)throw new Error(`sections.${k} is missing.`);return null;}if(!Array.isArray(a)||a.length!==N)throw new Error(`sections.${k} must have ${N} entries, one per section.`);return a;};
  const size=col('size',true),fileI=col('file',true),kindI=col('kind'),flags=col('flags'),outI=col('out'),scopeI=col('scope'),nameA=col('name'),addrA=col('addr'),alignA=col('align');
  const dirs=st.dirs||[],files=st.files||[],scopes=st.scopes||[],outs=st.outs||[];
  const dirPath=new Array(dirs.length);
  const dp=i=>{if(i==null||i<0)return '';let s=dirPath[i];if(s!=null)return s;const e=dirs[i];if(!e)throw new Error(`strings.dirs has no entry ${i}.`);const p=dp(e[0]);s=p?p+'/'+e[1]:String(e[1]);dirPath[i]=s;return s;};
  const filePath=files.map((f,i)=>{if(!Array.isArray(f))throw new Error(`strings.files[${i}] must be [directory, name].`);const d=dp(f[0]);return d?d+'/'+f[1]:String(f[1]);});
  const scopePath=new Array(scopes.length);
  const sp=i=>{if(i==null||i<0)return '';let s=scopePath[i];if(s!=null)return s;const e=scopes[i];if(!e)throw new Error(`strings.scopes has no entry ${i}.`);const p=sp(e[0]);s=p?p+'::'+e[1]:String(e[1]);scopePath[i]=s;return s;};
  const outName=new Array(N);
  const keep=excludeOutput?new Uint8Array(N):null;
  const oldToNew=excludeOutput?new Int32Array(N).fill(-1):null;
  let kept=0;
  for(let i=0;i<N;i++){
    const fi=fileI[i];const path=filePath[fi];if(path==null)throw new Error(`Section ${i} refers to file ${fi}, which is not in strings.files.`);
    const sc=scopeI?scopeI[i]:-1;if(sc>=0)sp(sc);
    const out=outI&&outI[i]>=0&&outs[outI[i]]!=null?String(outs[outI[i]]):'';outName[i]=out;
    if(!excludeOutput||!excludeOutput(out)){if(excludeOutput){keep[i]=1;oldToNew[i]=kept++;}}
  }
  const nodes=new Array(excludeOutput?kept:N);
  for(let i=0;i<N;i++){
    if(excludeOutput&&!keep[i])continue;
    const fi=fileI[i];const path=filePath[fi];const k=kindI?kindI[i]:0;const kind=KINDS[k]||'code';const fl=flags?flags[i]|0:0;const live=(fl&1)===0;
    const sc=scopeI?scopeI[i]:-1;const scope=sc>=0?sp(sc):null;let leaf=nameA?nameA[i]:'';if(leaf==null)leaf='';
    const name=leaf===''?`${path.slice(path.lastIndexOf('/')+1)} #${i}`:(scope?scope+'::'+leaf:String(leaf));
    const ni=excludeOutput?oldToNew[i]:i;nodes[ni]=makeNode(ni,String(i),name,path,kind,Math.max(0,+size[i]||0),live,scope,(fl&2)!==0,outName[i],(fl&4)!==0);
    nodes[ni].addr=layoutField(addrA?addrA[i]:null,live,'addr',i);nodes[ni].align=layoutField(alignA?alignA[i]:null,live,'align',i);
  }
  const off=refs.offsets||null,tg=refs.targets||[],cn=refs.counts||null;
  if(off&&off.length!==N+1)throw new Error(`refs.offsets must have ${N+1} entries (one more than the number of sections).`);
  if(cn&&cn.length!==tg.length)throw new Error('refs.counts must have one entry per entry in refs.targets.');
  const E=tg.length;const S=new Int32Array(E),D=new Int32Array(E),W=new Float64Array(E);let m=0;
  if(off){for(let a=0;a<N;a++){if(excludeOutput&&!keep[a])continue;for(let e=off[a];e<off[a+1];e++){const b=tg[e];if(b===a||b<0||b>=N||excludeOutput&&!keep[b])continue;S[m]=excludeOutput?oldToNew[a]:a;D[m]=excludeOutput?oldToNew[b]:b;W[m]=cn?Math.max(1,+cn[e]||1):1;m++;}}}
  return {nodes,S:S.subarray(0,m),D:D.subarray(0,m),W:W.subarray(0,m),m};
}
// Converts an object-format document into the columnar format (used by the sample tools and tests).
function splitScope(name){const parts=[];let depth=0,last=0;
  for(let j=0;j<name.length;j++){const ch=name[j];if(ch==='<'||ch==='(')depth++;else if(ch==='>'||ch===')')depth--;else if(depth===0&&ch===':'&&name[j+1]===':'){parts.push(name.slice(last,j));j++;last=j+1;}}
  parts.push(name.slice(last));return parts;}
function toColumnar(data){
  const nodes=data.nodes||[];const N=nodes.length;
  const dirs=[],dirIdx=new Map(),files=[],fileIdx=new Map(),scopes=[],scopeIdx=new Map(),outs=[],outIdx=new Map();
  const dirOf=d=>{if(!d)return -1;let i=dirIdx.get(d);if(i!=null)return i;const c=d.lastIndexOf('/');const p=c>=0?dirOf(d.slice(0,c)):-1;i=dirs.length;dirs.push([p,c>=0?d.slice(c+1):d]);dirIdx.set(d,i);return i;};
  const fileOf=p=>{let i=fileIdx.get(p);if(i!=null)return i;const c=p.lastIndexOf('/');i=files.length;files.push([dirOf(c>=0?p.slice(0,c):''),c>=0?p.slice(c+1):p]);fileIdx.set(p,i);return i;};
  const scopeOf=parts=>{let parent=-1,key='';for(const s of parts){key=key?key+'::'+s:s;let i=scopeIdx.get(key);if(i==null){i=scopes.length;scopes.push([parent,s]);scopeIdx.set(key,i);}parent=i;}return parent;};
  const outOf=o=>{if(!o)return -1;let i=outIdx.get(o);if(i==null){i=outs.length;outs.push(o);outIdx.set(o,i);}return i;};
  const pos=new Map();const size=new Array(N),file=new Array(N),kind=new Array(N),flags=new Array(N),out=new Array(N),scope=new Array(N),name=new Array(N);
  nodes.forEach((n,i)=>{pos.set(String(n.id),i);size[i]=Math.max(0,Math.round(+n.size||0));file[i]=fileOf(String(n.path||'(unknown)/'+n.name));kind[i]=KI[n.kind]!=null?KI[n.kind]:0;
    flags[i]=(n.live===false?1:0)|(n.root?2:0)|(n.hot?4:0);out[i]=outOf(n.out||'');
    const parts=splitScope(String(n.name!=null?n.name:n.id));const leaf=parts.pop();scope[i]=parts.length?scopeOf(parts):-1;name[i]=leaf;});
  const rows=Array.from({length:N},()=>new Map());
  for(const e of data.edges||[]){const a=pos.get(String(e.src)),b=pos.get(String(e.dst));if(a==null||b==null||a===b)continue;rows[a].set(b,(rows[a].get(b)||0)+Math.max(1,+e.count||1));}
  const offsets=new Array(N+1);const targets=[],counts=[];let allOne=true;offsets[0]=0;
  for(let i=0;i<N;i++){for(const [b,c] of rows[i]){targets.push(b);counts.push(c);if(c!==1)allOne=false;}offsets[i+1]=targets.length;}
  const doc={format:'fia-columnar',version:1};for(const k of ['title','regions','compression'])if(data[k]!=null)doc[k]=data[k];
  doc.strings={dirs,files,scopes,outs};doc.sections={count:N,size,file,out,kind,flags,scope,name};
  if(nodes.some(n=>n.addr!=null&&n.addr>=0))doc.sections.addr=nodes.map(n=>n.live!==false&&n.addr!=null&&n.addr>=0?n.addr:-1);
  if(nodes.some(n=>n.align>0))doc.sections.align=nodes.map(n=>n.align>0?n.align:0);doc.refs=allOne?{offsets,targets}:{offsets,targets,counts};
  if(data.symbolDetails){
    const d=symbolDetailColumns(data.symbolDetails);
    doc.symbolDetails={version:1,sourceFiles:d.sourceFiles,symbols:{...d.symbols,section:d.symbols.section.map(i=>pos.get(String(i)))},refs:{...d.refs,sourceSection:d.refs.sourceSection.map(i=>pos.get(String(i))),targetSection:d.refs.targetSection.map(i=>pos.get(String(i)))}};
    if(data.symbolDetails.initializerFragments){const f=fragmentDetailColumns(data.symbolDetails.initializerFragments);doc.symbolDetails.initializerFragments={version:1,refs:{...f.refs,targetSection:f.refs.targetSection.map(i=>pos.get(String(i)))}};}
  }
  return doc;
}

// Optional details stay columnar. Only requested inspector rows are materialized;
// aliases do not become new memory nodes and never add to the section-size sum.
function symbolDetailColumns(d){
  if(d.version!==1)throw new Error(`Unsupported symbolDetails version ${d.version}.`);
  const columns=(input,keys,defaults)=>{
    if(Array.isArray(input)){
      const out={count:input.length};for(const k of keys)out[k]=input.map((r,i)=>{if(r.id!=null&&r.id!==i)throw new Error('Symbol detail IDs must be consecutive.');return r[k]??defaults[k];});return out;
    }
    if(!input||typeof input!=='object')throw new Error('Invalid symbolDetails table.');
    return input;
  };
  const symbols=columns(d.symbols,['section','chunk','name','linkageName','offset','size','flags','sourceFile','sourceLine'],{sourceFile:-1,sourceLine:0});
  const refs=columns(d.refs,['sourceSection','targetSection','src','dst','count','flags'],{});
  return {sourceFiles:d.sourceFiles||[],symbols,refs,initializerFragments:d.initializerFragments};
}
const FRAGMENT_NAMES=['string literal','numeric constant','const data','relocatable const data','read/write data','zero-init data'];
function fragmentDetailColumns(d){
  if(!d||d.version!==1)throw new Error(`Unsupported initializerFragments version ${d?.version}.`);
  const input=d.refs;if(Array.isArray(input)){const refs={container:[],targetSection:[],class:[],count:[],ownerCount:[]};for(const r of input)for(const k in refs)refs[k].push(r[k]);return {refs};}
  if(!input||typeof input!=='object')throw new Error('Invalid initializerFragments table.');
  return {refs:input};
}
function inferredFragmentClass(node){
  const name=node.name||'';
  if(/\.rodata\.str|\.L\.str|^\.str/.test(name))return 1;
  if(/^\.rodata\.cst/.test(name))return 2;
  if(/^\.data\.rel\.ro/.test(name))return 4;
  return node.kind==='rodata'?3:node.kind==='data'?5:node.kind==='bss'?6:0;
}
function ingestSymbolDetails(data,nodes,pathMode){
  if(!data.symbolDetails)return null;
  const d=symbolDetailColumns(data.symbolDetails),s=d.symbols,r=d.refs,N=s.count;
  const fail=msg=>{throw new Error('Invalid symbolDetails: '+msg);};
  const integer=(v,min)=>Number.isSafeInteger(v)&&v>=min;
  if(!integer(N,0))fail('symbol count');
  for(const k of ['section','chunk','name','linkageName','offset','size','flags'])if(!Array.isArray(s[k])||s[k].length!==N)fail('symbols.'+k);
  for(const k of ['sourceFile','sourceLine'])if(s[k]!=null&&(!Array.isArray(s[k])||s[k].length!==N))fail('symbols.'+k);
  if(!Array.isArray(d.sourceFiles)||d.sourceFiles.some(p=>typeof p!=='string'))fail('sourceFiles');
  const M=r.src?.length;if(!integer(M,0))fail('refs.src');
  for(const k of ['sourceSection','targetSection','src','dst','count','flags'])if(!Array.isArray(r[k])||r[k].length!==M)fail('refs.'+k);
  const columnar=isColumnar(data),count=columnar?data.sections.count??data.sections.size.length:0;
  const valid=columnar?id=>integer(id,0)&&id<count:(()=>{const all=new Set(data.nodes.map(n=>String(n.id)));return id=>all.has(String(id));})();
  const remap=columnar?new Int32Array(count).fill(-1):new Map();
  for(const n of nodes){if(columnar)remap[+n.id]=n.i;else remap.set(n.id,n.i);}
  const index=id=>columnar?remap[id]:(remap.get(String(id))??-1);
  const section=new Int32Array(N),offsets=new Uint32Array(nodes.length+1),source=new Int32Array(nodes.length).fill(-1);
  for(let i=0;i<N;i++){
    if(!valid(s.section[i])||!integer(s.chunk[i],0)||!integer(s.offset[i],0)||!integer(s.size[i],0)||!integer(s.flags[i],0)||s.flags[i]>15||typeof s.name[i]!=='string'||typeof s.linkageName[i]!=='string')fail('symbol '+i);
    const fi=s.sourceFile?.[i]??-1,line=s.sourceLine?.[i]??0;
    if(!integer(fi,-1)||fi>=d.sourceFiles.length||!integer(line,0)||(fi===-1&&line!==0))fail('source location '+i);
    const ni=section[i]=index(s.section[i]);if(ni<0)continue;offsets[ni+1]++;
    if(fi>=0&&line>0){if(source[ni]===-1)source[ni]=fi;else if(source[ni]!==fi)source[ni]=-2;}
  }
  for(let i=0;i<nodes.length;i++)offsets[i+1]+=offsets[i];
  const ids=new Int32Array(offsets[nodes.length]),cursor=offsets.slice();
  for(let i=0;i<N;i++)if(section[i]>=0)ids[cursor[section[i]]++]=i;
  for(let e=0;e<M;e++){
    if(!valid(r.sourceSection[e])||!valid(r.targetSection[e])||!integer(r.count[e],1)||!integer(r.flags[e],0)||r.flags[e]>15)fail('reference '+e);
    for(const [key,sc] of [['src','sourceSection'],['dst','targetSection']]){const id=r[key][e];if(!integer(id,-1)||id>=N||(id>=0&&String(s.section[id])!==String(r[sc][e])))fail('reference endpoint '+e);}
  }
  let mapped=0,mixed=0;
  for(const n of nodes){
    n.objectPath=n.path;n.sourcePath=source[n.i]>=0?d.sourceFiles[source[n.i]]:'';n.sourceMixed=source[n.i]===-2;
    if(n.sourcePath)mapped++;if(n.sourceMixed)mixed++;
    if(pathMode==='source'&&n.sourcePath)Object.assign(n,makeNode(n.i,n.id,n.name,n.sourcePath,n.kind,n.size,n.live,n.cls,n.root,n.out,n.hot));
  }
  const symbol=i=>({id:i,section:section[i],name:s.name[i],linkageName:s.linkageName[i],chunk:s.chunk[i],offset:s.offset[i],size:s.size[i],flags:s.flags[i],sourceFile:d.sourceFiles[s.sourceFile?.[i]]||'',sourceLine:s.sourceLine?.[i]||0});
  const fragmentMap=new Map(),fragmentTargets=new Map();
  const addFragment=(container,target,klass,count,owners)=>{const ni=index(target);if(ni<0)return;const key=container+'|'+target+'|'+klass;const old=fragmentMap.get(key);if(old){old.count+=count;old.ownerCount=Math.max(old.ownerCount,owners);return;}const value={container,targetSection:ni,class:klass,count,ownerCount:owners};fragmentMap.set(key,value);let list=fragmentTargets.get(target);if(!list)fragmentTargets.set(target,list=[]);list.push(value);};
  if(d.initializerFragments){
    const f=fragmentDetailColumns(d.initializerFragments).refs,F=f.container?.length;
    if(!integer(F,0))fail('initializerFragments.refs.container');
    for(const k of ['container','targetSection','class','count','ownerCount'])if(!Array.isArray(f[k])||f[k].length!==F)fail('initializerFragments.refs.'+k);
    for(let i=0;i<F;i++){if(!integer(f.container[i],0)||f.container[i]>=N||!valid(f.targetSection[i])||!integer(f.class[i],1)||f.class[i]>6||!integer(f.count[i],1)||!integer(f.ownerCount[i],1))fail('initializer fragment '+i);addFragment(f.container[i],f.targetSection[i],f.class[i],f.count[i],f.ownerCount[i]);}
  }else{
    // Existing exports can derive the conservative data-initializer view.
    for(let e=0;e<M;e++){const container=r.src[e],target=r.targetSection[e];if(container<0||r.dst[e]>=0||(s.flags[container]&8)===0)continue;const ni=index(target),klass=ni<0?0:inferredFragmentClass(nodes[ni]);if(klass)addFragment(container,target,klass,r.count[e],0);}
    for(const refs of fragmentTargets.values()){const owners=new Set(refs.map(x=>x.container)).size;for(const ref of refs)ref.ownerCount=owners;}
  }
  const fragments=[...fragmentMap.values()].sort((a,b)=>a.container-b.container||a.targetSection-b.targetSection||a.class-b.class);
  const fragmentsByContainer=new Map();for(const f of fragments){let list=fragmentsByContainer.get(f.container);if(!list)fragmentsByContainer.set(f.container,list=[]);list.push(f);}
  // A unique data-container relation can be displayed as logical ownership,
  // but never changes the physical section graph or byte totals. Be stricter
  // than the producer's ownerCount: aliases or filtered sections can make a
  // relation ambiguous in the document currently being viewed.
  const byTarget=new Map();for(const f of fragments){let list=byTarget.get(f.targetSection);if(!list)byTarget.set(f.targetSection,list=[]);list.push(f);}
  const candidates=[];
  for(const refs of byTarget.values()){
    const owners=new Set(refs.map(f=>f.container));if(owners.size!==1||refs.some(f=>f.ownerCount!==1))continue;
    const f=refs[0],containerSection=section[f.container];
    if(containerSection<0||containerSection===f.targetSection||(s.flags[f.container]&8)===0)continue;
    candidates.push({...f,containerSection});
  }
  const containersBySection=new Map();for(const f of candidates){let owners=containersBySection.get(f.containerSection);if(!owners)containersBySection.set(f.containerSection,owners=new Set());owners.add(f.container);}
  const sourceSections=new Set(candidates.map(f=>f.containerSection));
  const logicalFragments=candidates.filter(f=>containersBySection.get(f.containerSection).size===1&&!sourceSections.has(f.targetSection));
  const codeTargets={count:0,exact:0,approximate:0,sectionOnly:0,callerKnown:0};
  for(let e=0;e<M;e++){const ni=index(r.targetSection[e]);if(index(r.sourceSection[e])<0||ni<0||nodes[ni].kind!=='code')continue;const count=r.count[e];codeTargets.count+=count;if(r.src[e]>=0)codeTargets.callerKnown+=count;
    if(r.dst[e]<0)codeTargets.sectionOnly+=count;else if(r.flags[e]&8)codeTargets.approximate+=count;else codeTargets.exact+=count;}
  // Repainting controls must not rescan a multi-million-reference table. Cache
  // only the last inspector result, not an object adjacency list for all edges.
  let cachedSection=-1,cachedLimit=0,cachedRefs=[];
  return {symbols:s,refs:r,section,offsets,ids,sourceFiles:d.sourceFiles,mapped,mixed,symbol,fragments,logicalFragments,codeTargets,fragmentName:c=>FRAGMENT_NAMES[c-1]||'data fragment',
    fragmentsForSection:i=>{const out=[];for(const id of ids.subarray(offsets[i],offsets[i+1])){const list=fragmentsByContainer.get(id);if(list)out.push(...list);}return out;},
    members:(i,limit=40)=>Array.from(ids.subarray(offsets[i],Math.min(offsets[i+1],offsets[i]+limit)),symbol),
    references:(i,limit=40)=>{if(i===cachedSection&&limit===cachedLimit)return cachedRefs;const found=[];const id=nodes[i].id;for(let e=0;e<M;e++)if(String(r.sourceSection[e])===id||String(r.targetSection[e])===id){
      if(index(r.sourceSection[e])<0||index(r.targetSection[e])<0)continue;
      found.push(e);if(found.length>2*limit){found.sort((a,b)=>r.count[b]-r.count[a]||a-b);found.length=limit;}
    }cachedSection=i;cachedLimit=limit;return cachedRefs=found.sort((a,b)=>r.count[b]-r.count[a]||a-b).slice(0,limit).map(e=>({src:r.src[e]<0?null:symbol(r.src[e]),dst:r.dst[e]<0?null:symbol(r.dst[e]),sourceSection:index(r.sourceSection[e]),targetSection:index(r.targetSection[e]),count:r.count[e],flags:r.flags[e]}));}};
}

function analyze(data,options={}){
  const excludeOutput=typeof options.excludeOutput==='function'?options.excludeOutput:null;
  const ing=isColumnar(data)?ingestColumnar(data,excludeOutput):ingestClassic(data,excludeOutput);
  const nodes=ing.nodes,N=nodes.length,m=ing.m,Sa=ing.S,Da=ing.D,Wa=ing.W;
  const details=ingestSymbolDetails(data,nodes,options.pathMode);
  const LL=e=>nodes[Sa[e]].live&&nodes[Da[e]].live;
  const succ=csr(N,Sa,Da,Wa,LL);
  let roots=nodes.filter(n=>n.root).map(n=>n.i);
  if(!roots.length){const indeg=new Uint32Array(N);for(let e=0;e<m;e++)if(LL(e))indeg[Da[e]]++;roots=nodes.filter(n=>n.live&&indeg[n.i]===0).map(n=>n.i);}
  const dom=dominatorsCSR(N,succ,roots);
  const ret=new Float64Array(N+1);
  for(const v of dom.order){if(v===N)continue;ret[v]+=nodes[v].size;ret[dom.idom[v]]+=ret[v];}
  let unreachable=0,unreachBytes=0;for(const n of nodes)if(n.live&&!dom.visited[n.i]){unreachable++;unreachBytes+=n.size;}

  // domains and subsystems
  const doms=[],domIdx=new Map(),modFirst=new Map();
  for(const n of nodes){if(!domIdx.has(n.dom)){domIdx.set(n.dom,doms.length);doms.push({name:n.dom,live:0,dead:0,mods:[]});}if(!modFirst.has(n.mod))modFirst.set(n.mod,n.i);}
  const mods=[...modFirst.entries()].map(([name,first])=>({name,dom:nodes[first].dom,first,live:0,dead:0,k:new Float64Array(8),funcsLive:0,funcsDead:0,files:new Set(),liveNodes:[],deadNodes:[]}))
    .sort((x,y)=>domIdx.get(x.dom)-domIdx.get(y.dom)||x.first-y.first);
  const modIdx=new Map();mods.forEach((x,i)=>{x.i=i;x.di=domIdx.get(x.dom);modIdx.set(x.name,i);doms[x.di].mods.push(i);});
  const total={live:0,dead:0,pre:0,k:new Float64Array(8)};
  for(const n of nodes){n.mi=modIdx.get(n.mod);n.di=domIdx.get(n.dom);const x=mods[n.mi],d=doms[n.di];const slot=n.ki+(n.live?0:4);
    x.k[slot]+=n.size;total.k[slot]+=n.size;x.files.add(n.path);
    if(n.live){x.live+=n.size;d.live+=n.size;total.live+=n.size;x.liveNodes.push(n.i);if(n.kind==='code')x.funcsLive++;}
    else{x.dead+=n.size;d.dead+=n.size;total.dead+=n.size;x.deadNodes.push(n.i);if(n.kind==='code')x.funcsDead++;}}
  total.pre=total.live+total.dead;
  const nm=mods.length,nd=doms.length;const mm=new Float64Array(nm*nm),dm=new Float64Array(nd*nd);let wAll=0,wCross=0,wCrossDom=0;
  for(let e=0;e<m;e++){if(!LL(e))continue;const A=nodes[Sa[e]],B=nodes[Da[e]];mm[A.mi*nm+B.mi]+=Wa[e];dm[A.di*nd+B.di]+=Wa[e];wAll+=Wa[e];if(A.mi!==B.mi)wCross+=Wa[e];if(A.di!==B.di)wCrossDom+=Wa[e];}

  // undirected live graph and clustering
  const uS=[],uD=[],uW=[];for(let e=0;e<m;e++)if(LL(e)){uS.push(Sa[e],Da[e]);uD.push(Da[e],Sa[e]);uW.push(Wa[e],Wa[e]);}
  const U=csr(N,Int32Array.from(uS),Int32Array.from(uD),Float64Array.from(uW));
  function computeClusters(excl){
    let G=U;
    if(excl){const s=[],d=[],w=[];for(let i=0;i<N;i++){if(excl[i])continue;for(let e=U.off[i];e<U.off[i+1];e++){const j=U.adj[e];if(excl[j])continue;s.push(i);d.push(j);w.push(U.wt[e]);}}
      G=csr(N,Int32Array.from(s),Int32Array.from(d),Float64Array.from(w));}
    const comm=louvainCSR(N,G,mulberry32(42),1);
    const cmap=new Map();
    for(const n of nodes){if(!n.live||(excl&&excl[n.i]))continue;let c=cmap.get(comm[n.i]);if(!c){c={size:0,count:0,byMod:new Map()};cmap.set(comm[n.i],c);}c.size+=n.size;c.count++;c.byMod.set(n.mi,(c.byMod.get(n.mi)||0)+n.size);}
    const clusters=[...cmap.values()].sort((a,b)=>b.size-a.size);
    clusters.forEach((c,i)=>{c.i=i;const parts=[...c.byMod.entries()].sort((a,b)=>b[1]-a[1]);c.parts=parts;const big=parts.filter(p=>p[1]>=0.15*c.size);c.multi=big.length>=2;
      c.label=mods[parts[0][0]].name+(big.length>=2?' + '+mods[big[1][0]].name:'')+(big.length>=3?` +${big.length-2}`:'');});
    const cOf=new Int32Array(N).fill(-1);for(const n of nodes)if(n.live&&!(excl&&excl[n.i]))cOf[n.i]=cmap.get(comm[n.i]).i;
    for(const x of mods){const per=new Map(),perCode=new Map();for(const v of x.liveNodes){if(cOf[v]<0)continue;per.set(cOf[v],(per.get(cOf[v])||0)+nodes[v].size);if(nodes[v].kind==='code')perCode.set(cOf[v],(perCode.get(cOf[v])||0)+nodes[v].size);}
      x.perCode=perCode;x.per=per;x.code=x.k[0];let best=-1,bv=-1;for(const [c,v] of per)if(v>bv){bv=v;best=c;}x.cluster=best;x.share=x.live&&best>=0?bv/x.live:1;}
    return {clusters,cOf};
  }
  const CL=computeClusters(null);const clusters=CL.clusters,cOf=CL.cOf;
  // domain-level grouping for the domain matrix
  const dS=[],dD=[],dW=[];for(let a=0;a<nd;a++)for(let b=0;b<nd;b++){const w=dm[a*nd+b]+dm[b*nd+a];if(a!==b&&w){dS.push(a);dD.push(b);dW.push(w);}}
  const domComm=louvainCSR(nd,csr(nd,Int32Array.from(dS),Int32Array.from(dD),Float64Array.from(dW)),mulberry32(5),1);
  doms.forEach((d,i)=>d.cluster=domComm[i]);


  // shared versus isolated: breadth of use, cohesion, interface, exclusive ownership
  const isPlumb=new Uint8Array(N+1);isPlumb[N]=1;const plumbRe=/(^|[_:])(main|init|_start|start)$/i;
  for(const n of nodes)if(n.live&&(n.root||plumbRe.test(n.name)||ret[n.i]>=0.2*total.live))isPlumb[n.i]=1;
  function groupMetrics(gOf,G,domOfGroup){
    const g=Array.from({length:G},(_,i)=>({i,ifaceBytes:0,bytes:0,code:0,data:0,internal:0,inW:0,outW:0,callers:new Map(),callerDoms:new Set(),iface:new Map(),uses:new Map(),owners:new Map(),owned:0}));
    for(const n of nodes){if(!n.live)continue;const o=g[gOf(n)];o.bytes+=n.size;if(n.kind==='code')o.code+=n.size;else o.data+=n.size;}
    for(let e=0;e<m;e++){if(!LL(e))continue;const A1=nodes[Sa[e]],B1=nodes[Da[e]];const ga=gOf(A1),gb=gOf(B1),w=Wa[e];
      if(ga===gb){if(A1.path!==B1.path)g[ga].internal+=w;continue;}
      g[ga].outW+=w;g[gb].inW+=w;g[ga].uses.set(gb,(g[ga].uses.get(gb)||0)+w);g[gb].callers.set(ga,(g[gb].callers.get(ga)||0)+w);
      if(A1.di!==domOfGroup[gb])g[gb].callerDoms.add(A1.di);g[gb].iface.set(B1.i,(g[gb].iface.get(B1.i)||0)+w);}
    for(const n of nodes){if(!n.live||!dom.visited[n.i])continue;const gi=gOf(n);let p=dom.idom[n.i];
      while(p!==N&&p>=0&&(isPlumb[p]||gOf(nodes[p])===gi))p=dom.idom[p];
      if(p!==N&&p>=0){const o=g[gi];o.owned+=n.size;o.owners.set(p,(o.owners.get(p)||0)+n.size);}}
    for(const o of g){const t=o.internal+o.inW+o.outW;o.cohesion=t?o.internal/t:1;o.breadth=nd>1?o.callerDoms.size/(nd-1):0;
      let bo=-1,bv=0;for(const [p,v] of o.owners)if(v>bv){bv=v;bo=p;}o.owner=bo;o.ownerShare=o.bytes?bv/o.bytes:0;
      for(const ni of o.iface.keys())o.ifaceBytes+=nodes[ni].size;o.privateShare=o.bytes?1-o.ifaceBytes/o.bytes:1;
      o.entries=[...o.iface.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([i,w])=>({i,w}));o.ifaceCount=o.iface.size;}
    return g;
  }
  const mmLayer=new Float64Array(nm*nm);for(let e=0;e<m;e++){if(!LL(e)||isPlumb[Sa[e]])continue;const a=nodes[Sa[e]].mi,b=nodes[Da[e]].mi;if(a!==b)mmLayer[a*nm+b]+=Wa[e];}
  const roleSub=groupMetrics(n=>n.mi,nm,mods.map(x=>x.di));
  const roleDom=groupMetrics(n=>n.di,nd,doms.map((d,i)=>i));

  // misplaced files (live references, ignoring same-file)
  const fileW=new Map();const bump=(path,mi,w)=>{let o=fileW.get(path);if(!o){o=new Map();fileW.set(path,o);}o.set(mi,(o.get(mi)||0)+w);};
  for(let e=0;e<m;e++){if(!LL(e))continue;const A=nodes[Sa[e]],B=nodes[Da[e]];if(A.path===B.path)continue;bump(A.path,B.mi,Wa[e]);bump(B.path,A.mi,Wa[e]);}
  const files=new Map();for(const n of nodes){let f=files.get(n.path);if(!f){f={path:n.path,file:n.file,mi:n.mi,live:0,dead:0,funcs:0,deadFuncs:0};files.set(n.path,f);}if(n.live){f.live+=n.size;if(n.kind==='code')f.funcs++;}else{f.dead+=n.size;if(n.kind==='code')f.deadFuncs++;}}
  const misplaced=[];
  for(const [path,w] of fileW){const f=files.get(path);const home=w.get(f.mi)||0;let tot=0,best=-1,bv=0;for(const [mi,v] of w){tot+=v;if(mi!==f.mi&&v>bv){bv=v;best=mi;}}
    if(best>=0&&bv>=1.5*home&&bv>=8&&bv>=0.45*tot)misplaced.push({path,file:f.file,from:f.mi,to:best,home,there:bv,total:tot,size:f.live,funcs:f.funcs});}
  misplaced.sort((a,b)=>(b.there-b.home)-(a.there-a.home));

  // eliminated code: fully dropped files and connected islands
  const deadFiles=[...files.values()].filter(f=>f.live===0&&f.dead>0).sort((a,b)=>b.dead-a.dead);
  const par=new Int32Array(N);for(let i=0;i<N;i++)par[i]=i;const find=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;};
  for(let e=0;e<m;e++){const A=nodes[Sa[e]],B=nodes[Da[e]];if(A.live||B.live)continue;const ra=find(A.i),rb=find(B.i);if(ra!==rb)par[ra]=rb;}
  const isl=new Map();for(const n of nodes){if(n.live)continue;const r=find(n.i);let o=isl.get(r);if(!o){o={size:0,count:0,byMod:new Map(),byDir:new Map(),top:null,files:new Set()};isl.set(r,o);}
    o.size+=n.size;o.count++;o.byMod.set(n.mi,(o.byMod.get(n.mi)||0)+n.size);o.byDir.set(n.dir,(o.byDir.get(n.dir)||0)+n.size);o.files.add(n.path);if(!o.top||n.size>o.top.size)o.top=n;}
  const islands=[...isl.values()].sort((a,b)=>b.size-a.size);
  for(const o of islands){let bm=-1,bv=-1;for(const [mi,v] of o.byMod)if(v>bv){bv=v;bm=mi;}o.mi=bm;o.modShare=mods[bm].dead+mods[bm].live?o.size/(mods[bm].dead+mods[bm].live):0;
    let bd='',bdv=-1;for(const [d,v] of o.byDir)if(v>bdv){bdv=v;bd=d;}o.dir=bd;o.whole=mods[bm].live===0;}
  const bigIslands=islands.filter(o=>o.count>=4);const scattered=islands.filter(o=>o.count<4).reduce((a,o)=>({count:a.count+o.count,size:a.size+o.size}),{count:0,size:0});

  // template families
  const fam=new Map();
  for(const n of nodes){if(n.kind!=='code')continue;const lt=n.name.indexOf('<');if(lt<0)continue;let depth=0,end=-1;
    for(let j=lt;j<n.name.length;j++){const ch=n.name[j];if(ch==='<')depth++;else if(ch==='>'){depth--;if(depth===0){end=j;break;}}}
    if(end<0)continue;const family=n.name.slice(0,lt)+'<…>';const inst=n.name.slice(0,end+1);let f=fam.get(family);
    if(!f){f={family,insts:new Set(),deadInsts:new Set(),funcs:0,live:0,dead:0};fam.set(family,f);}
    if(n.live){f.insts.add(inst);f.funcs++;f.live+=n.size;}else{f.deadInsts.add(inst);f.dead+=n.size;}}
  const families=[...fam.values()].filter(f=>f.insts.size>=2).sort((a,b)=>b.live-a.live);

  const regions=Object.entries(data.regions||{}).map(([name,r])=>r&&typeof r==='object'?{name,start:Number.isSafeInteger(r.start)?r.start:null,size:+r.size||0}:{name,start:null,size:+r||0});
  let capacity=0;for(const r of regions)capacity+=r.size;
  const addressed=nodes.reduce((c,n)=>c+(n.live&&n.addr>=0?1:0),0);
  if(!(capacity>0)){capacity=MiB;while(capacity<total.live*1.15)capacity*=2;}

  const impactCache=new Map();
  function removalImpact(gi,level){
    const key=(level==='dom'?'d':'m')+gi;if(impactCache.has(key))return impactCache.get(key);
    const inG=level==='dom'?(n=>n.di===gi):(n=>n.mi===gi);
    const seen=new Uint8Array(N);const st=[];for(const r of roots)if(!inG(nodes[r])){seen[r]=1;st.push(r);}
    while(st.length){const v=st.pop();for(let e=succ.off[v];e<succ.off[v+1];e++){const w=succ.adj[e];if(!seen[w]&&!inG(nodes[w])){seen[w]=1;st.push(w);}}}
    const res={bytes:0,others:0,othersBytes:0,nodes:[],inG};
    for(const n of nodes){if(!n.live||!dom.visited[n.i]||seen[n.i])continue;res.nodes.push(n.i);res.bytes+=n.size;if(!inG(n)){res.others++;res.othersBytes+=n.size;}}
    impactCache.set(key,res);return res;
  }
  return {details,compression:data.compression||null,title:data.title||'Linker export',nodes,N,edgeCount:m,refCount:wAll,succ,roots,dom,ret,unreachable,unreachBytes,doms,mods,mm,dm,nm,nd,wAll,wCross,wCrossDom,
    // Louvain over a small undirected graph given as symmetric edge lists (explorer groups).
    communities:(n,src,dst,w)=>louvainCSR(n,csr(n,Int32Array.from(src),Int32Array.from(dst),Float64Array.from(w)),mulberry32(42),1),
    clusters,cOf,computeClusters,roleSub,roleDom,mmLayer,misplaced,files,deadFiles,islands:bigIslands,scattered,families,capacity,regions,addressed,total,removalImpact};
}
if(typeof module!=='undefined')module.exports={generateSample,analyze,toColumnar,isColumnar,ingestColumnar,ingestClassic};
