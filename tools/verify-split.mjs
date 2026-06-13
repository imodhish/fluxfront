/* Sim verification harness for the src/ modules.
   History: this originally asserted bit-equivalence against the legacy
   fluxfront.html build. That comparison was retired when the map grew from
   96×60 to 128×80 (fluxfront.html is now a historical prototype). Today it
   checks, on a stubbed DOM:
     1. determinism — two fresh games with the same seed produce identical
        sim snapshots after an identical scripted scenario,
     2. sim invariants — finite/bounded Flux, energy within capacity,
        consistent building registry,
     3. a render smoke test (full draw pass on the canvas stubs).
   Usage: node tools/verify-split.mjs */
import {fileURLToPath} from 'node:url';

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

/* ---------- minimal DOM stubs ---------- */
/* chainable sink: any method call / property access returns itself */
const hole=new Proxy(function(){},{
  get:(t,p)=>(p===Symbol.toPrimitive?()=>0:hole),
  set:()=>true,
  apply:()=>hole
});
function makeCtx2d(){
  const store=new Map();
  return new Proxy({},{
    get(_,prop){
      if(store.has(prop))return store.get(prop);
      if(prop==='createImageData')return (w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)});
      if(prop==='measureText')return ()=>({width:0});
      return ()=>hole;
    },
    set(_,prop,v){store.set(prop,v);return true;}
  });
}
function makeElement(tag){
  const listeners={};
  const elObj={
    tagName:tag, id:'', className:'', title:'', textContent:'', innerHTML:'',
    style:{},
    classList:{add(){},remove(){},toggle(){}},
    addEventListener(type,fn){(listeners[type]||(listeners[type]=[])).push(fn);},
    appendChild(){},
    _listeners:listeners
  };
  if(tag==='canvas'){
    elObj.width=0; elObj.height=0;
    elObj.getContext=()=>makeCtx2d();
    elObj.getBoundingClientRect=()=>({left:0,top:0,width:1280,height:800});
  }
  return elObj;
}
const byId=new Map();
const winListeners={};
globalThis.document={
  getElementById(id){
    if(!byId.has(id))byId.set(id, makeElement(id==='game'?'canvas':'div'));
    return byId.get(id);
  },
  createElement(tag){return makeElement(tag);}
};
globalThis.window={
  addEventListener(type,fn){(winListeners[type]||(winListeners[type]=[])).push(fn);},
  matchMedia:()=>({matches:false})
};
globalThis.requestAnimationFrame=()=>0;

/* ---------- modules ---------- */
const root=new URL('..',import.meta.url);
const {COLS,ROWS,CREEP_MAX}=await import(new URL('src/constants.js',root));
const ui=await import(new URL('src/ui.js',root));
const sim=await import(new URL('src/sim.js',root));
const world=await import(new URL('src/world.js',root));
const state=await import(new URL('src/state.js',root));
const net=await import(new URL('src/net.js',root));
const {render}=await import(new URL('src/render.js',root));
for(const fn of winListeners.load||[])fn();   // run init()

/* ---------- scripted scenario ---------- */
function runScenario(seed){
  const origRandom=Math.random;
  Math.random=mulberry32(seed);
  world.newGame('easy');
  const S=state.S;
  outer1: for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
    if(sim.canPlace(S,'core',x,y).ok){sim.place(S,'core',x,y);break outer1;}
  }
  for(let i=0;i<900;i++)sim.tick();              // 30 s
  // relocate the core to the next flat spot (exercises startMove + net-down)
  const coreB=S.buildings.find(b=>b.type==='core');
  outerM: for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
    if(sim.canPlace(S,'core',x,y,coreB.id).ok && (x!==coreB.gx+1||y!==coreB.gy+1)){
      sim.startMove(S,coreB,x,y);
      break outerM;
    }
  }
  for(let i=0;i<900;i++)sim.tick();              // flight + landing + rebuild
  // placement is allowed off-network now; keep the economy exercised by
  // requiring a live link for these
  outer2: for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
    if(sim.canPlace(S,'collector',x,y).ok && net.linkTargets(S,'collector',x,y).length){
      sim.place(S,'collector',x,y);break outer2;
    }
  }
  outer3: for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
    if(sim.canPlace(S,'cannon',x,y).ok && net.linkTargets(S,'cannon',x,y).length){
      sim.place(S,'cannon',x,y);break outer3;
    }
  }
  // a linked Terp with painted jobs: raises one cell two levels and lowers
  // another (exercises ter edits + retileTerrain patches deterministically)
  let terraB=null;
  outer4: for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
    if(sim.canPlace(S,'terra',x,y).ok && net.linkTargets(S,'terra',x,y).length){
      terraB=sim.place(S,'terra',x,y);break outer4;
    }
  }
  if(terraB){
    const cx=terraB.gx+2, cy=terraB.gy;
    const t1=Math.min(12,S.ter[cy*COLS+cx]+2);
    sim.terraPaint(S,terraB,cx,cy,t1);
    const t2=Math.max(1,S.ter[cy*COLS+cx+1]-1);
    sim.terraPaint(S,terraB,cx+1,cy,t2);
  }
  // anti-air + anti-flux coverage (spores launch from t≈120s)
  outer5: for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
    if(sim.canPlace(S,'beam',x,y).ok && net.linkTargets(S,'beam',x,y).length){
      sim.place(S,'beam',x,y);break outer5;
    }
  }
  outer6: for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
    if(sim.canPlace(S,'sprayer',x,y).ok && net.linkTargets(S,'sprayer',x,y).length){
      sim.place(S,'sprayer',x,y);break outer6;
    }
  }
  outer7: for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){     // shield (energy drain)
    if(sim.canPlace(S,'shield',x,y).ok && net.linkTargets(S,'shield',x,y).length){
      sim.place(S,'shield',x,y);break outer7;
    }
  }
  for(const t of ['pylon','repair','inhibitor','resonator']){   // new support structures
    outerN: for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
      if(sim.canPlace(S,t,x,y).ok && net.linkTargets(S,t,x,y).length){sim.place(S,t,x,y);break outerN;}
    }
  }
  // harvester on an aether node (if reachable) exercises the node economy
  if(S.nodes.length){
    const n=S.nodes[0];
    if(sim.canPlace(S,'harvester',n.cx,n.cy).ok && net.linkTargets(S,'harvester',n.cx,n.cy).length)
      sim.place(S,'harvester',n.cx,n.cy);
  }
  for(let i=0;i<2700;i++)sim.tick();             // +90 s (covers a weather squall)
  const col=S.buildings.find(b=>b.type==='collector');
  sim.deconstruct(S,col);
  for(let i=0;i<30;i++)sim.tick();
  const core=S.buildings.find(b=>b.type==='core');
  for(let i=0;i<600;i++){                        // drown the core -> 'lost'
    if(i<400)                                    // keep refilling: flat ground drains fast
      for(let y=core.gy;y<core.gy+core.sz;y++)
        for(let x=core.gx;x<core.gx+core.sz;x++)
          S.creep[y*COLS+x]=40;
    sim.tick();
  }
  Math.random=origRandom;
  return S;
}
function snapshot(S){
  let creepSum=0, creepCells=0;
  for(let i=0;i<S.creep.length;i++){const v=S.creep[i];creepSum+=v;if(v>0)creepCells++;}
  let terSum=0;
  for(let i=0;i<S.ter.length;i++)terSum+=S.ter[i];
  return {
    seed:S.seed, t:S.t, phase:S.phase,
    energy:S.energy, cap:S.cap, prod:S.prod,
    stats:{...S.stats},
    creepSum, creepCells, terSum,
    packetsInFlight:S.packets.length,
    buffs:{...S.buffs},
    weather:[S.weather.next,S.weather.active,S.weather.warned],
    coreDown:S.coreDown,
    aether:Math.round(S.aether*100)/100,
    nodes:S.nodes.length,
    pylonSpeed:S.pylonSpeed,
    pzones:S.pzones.length,
    relics:S.relics.map(r=>[r.cx,r.cy,r.kind,r.claimed]),
    surgeNext:S.surge.next,
    antiSum:(()=>{let s=0;for(let i=0;i<S.anti.length;i++)s+=S.anti[i];return s;})(),
    sporeTowers:S.sporeTowers.map(t=>[t.cx,t.cy,t.alive,t.next]),
    sporesInFlight:S.spores.length,
    kinds:S.emitters.map(e=>e.kind),
    emitters:S.emitters.map(e=>[e.cx,e.cy,e.alive,e.t,e.str]),
    buildings:S.buildings.map(b=>[b.type,b.gx,b.gy,b.hp,b.built,b.buildGot,b.ammo,b.conn,b.pend])
  };
}
function checkInvariants(S,label){
  const fail=m=>{console.error('INVARIANT FAILED ('+label+'):',m);process.exit(1);};
  for(let i=0;i<S.creep.length;i++){
    const v=S.creep[i];
    if(!Number.isFinite(v))fail('non-finite Flux at '+i);
    if(v<0||v>CREEP_MAX*1.0001)fail('Flux out of range at '+i+': '+v);
  }
  if(!Number.isFinite(S.energy)||S.energy<0)fail('bad energy '+S.energy);
  if(S.cap>0&&S.energy>S.cap+1e-6)fail('energy '+S.energy+' over cap '+S.cap);
  if(S.byId.size!==S.buildings.length)fail('byId/buildings mismatch');
  for(const b of S.buildings){
    if(b.pend<0)fail('negative pend on '+b.type);
    if(!S.byId.has(b.id))fail('building missing from byId');
  }
  if(!['placeCore','play','won','lost'].includes(S.phase))fail('bad phase '+S.phase);
}

/* ---------- run ---------- */
const S1=runScenario(424242);
checkInvariants(S1,'run 1');
const snapA=snapshot(S1);
render();                       // smoke-test a full draw pass on the stubs
const S2=runScenario(424242);
checkInvariants(S2,'run 2');
const snapB=snapshot(S2);

const a=JSON.stringify(snapA), b=JSON.stringify(snapB);
if(a===b){
  console.log('PASS — deterministic across runs, invariants hold, render OK.');
  console.log(JSON.stringify(snapA,null,1));
}else{
  console.error('NON-DETERMINISTIC: snapshots differ between identical runs!');
  console.error('run 1:',a);
  console.error('run 2:',b);
  process.exit(1);
}
