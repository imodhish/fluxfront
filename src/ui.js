/* ============================================================
   FLUXFRONT — HUD/overlay DOM wiring, input, init & main loop
   (entry module: importing this pulls in the whole game)
   ============================================================ */

import {COLS,ROWS,CELL,W,H,TICK,TYPES,BUILD_ORDER,CATEGORIES,DIFFS,MAP_SIZES,setMapSize,idx,clamp,dist,fmtT} from './constants.js';
import {
  S,selBuild,sel,delMode,moveSrc,moveMode,moveGroup,terraTarget,paused,speed,muted,hover,cv,creepCan,cctx,el,cam,dpr,
  settings,showRanges,ghost,replayMode,
  setS,setSelBuild,setSel,setDelMode,setMoveSrc,setMoveMode,setMoveGroup,setTerraTarget,setPausedState,setSpeedState,setMutedState,
  setCv,setCtx,setMiniCv,setMiniCtx,setCreepCan,setCctx,setCreepImg,setDpr,setUiScale,setShowRanges,setGhost,setReplayMode,setMarquee
} from './state.js';
import {canPlace,place,deconstruct,startMove,MOVABLE,terraPaint,forgeBuy,tick} from './sim.js';
import {needOf} from './economy.js';
import {newGame} from './world.js';
import {render,msg,jumpCamFrac,resetVisuals} from './render.js';
import {initAudio,sfx,applyMute,applyVolumes,setIntensity} from './audio.js';
import {loadAll,saveSettings,recordResult,bestTime,hasAch,achCount,ACHIEVEMENTS,tipSeen,markTipSeen,resetTips,saveGame,loadGame,clearGame} from './storage.js';

let lastInfo='';
const TOUCH=(typeof window!=='undefined'&&window.matchMedia)?window.matchMedia('(pointer:coarse)').matches:false;

/* ---------- build palette (tabbed categories) ---------- */
const HK={cryo:'C',sniper:'N',strafer:'V',shield:'B',convert:'K',bomber:'J'};
const SHORT={terra:'Terp',convert:'Converter',harvester:'Harvester',resonator:'Resonator',inhibitor:'Inhibitor',sensor:'Sensor',repair:'Repair Bay'};
const VCATS=CATEGORIES.filter(c=>c.keys.some(k=>TYPES[k]));
let buildTabIdx=0;
/* compact stat line for a build button's hover tooltip */
function tipStats(key){
  const T=TYPES[key], p=[];
  p.push(T.cost+'e · '+(T.sz>1?T.sz+'×'+T.sz:'1×1')+' · '+T.hp+'hp');
  if(T.prod)p.push('+'+T.prod+' e/s');
  if(T.cap)p.push('+'+T.cap+' cap');
  if(T.linkR)p.push('link '+T.linkR);
  if(T.range)p.push('range '+T.range);
  if(T.ammoMax)p.push('ammo '+T.ammoMax);
  if(T.workR)p.push('reach '+T.workR);
  if(T.charge)p.push(T.charge+'-packet charge');
  return p.join('  ·  ');
}
function mkBtn(key){
  const T=TYPES[key]; if(!T)return;
  const i=BUILD_ORDER.indexOf(key);
  const hk=HK[key]||(i>=0&&i<9?String(i+1):(i===9?'0':''));
  const btn=document.createElement('button');
  btn.className='bbtn'; btn.id='bb_'+key;
  btn.title=T.name+(hk?'  ['+hk+']':'')+'\n'+tipStats(key)+'\n'+T.desc;
  if(btn.setAttribute)btn.setAttribute('aria-label',T.name+', cost '+T.cost+' energy');
  btn.innerHTML='<span class="ic">'+T.icon+'</span><span class="nm">'+(SHORT[key]||T.name)+'</span><span class="ct">'+T.cost+'e</span><span class="hk">'+hk+'</span>';
  btn.addEventListener('click',function(){initAudio();selectBuild(key);});
  el.buildBar.appendChild(btn);
}
function showTab(ci){
  buildTabIdx=ci;
  el.buildBar.innerHTML='';
  for(const k of VCATS[ci].keys)if(TYPES[k])mkBtn(k);
  for(let i=0;i<VCATS.length;i++){
    const t=document.getElementById('tab_'+i);
    if(t)t.classList.toggle('on',i===ci);
  }
  if(el.catLabel)el.catLabel.textContent=VCATS[ci].name;
  refreshButtons();
}
function tabOf(key){
  for(let i=0;i<VCATS.length;i++)if(VCATS[i].keys.indexOf(key)>=0)return i;
  return -1;
}

/* ---------- replay & ghost (determinism makes this nearly free) ----------
   A run is just seed + diff + mutators + [tick, op, args...] actions. */
let rec=null, lastRun=null, replayQ=null, challengeTarget=null;
let selSize=2;                         // menu-selected map size index (default L)
function recAct(){if(rec&&!replayMode&&S)rec.a.push([S.tickN,...arguments]);}
/* resize the world to a map-size index: grid dims, HiDPI backing store
   (clamped so huge maps don't blow past GPU texture limits), Flux scratch
   buffers, and the W×H visual caches */
function applyMapSize(idx){
  const s=MAP_SIZES[idx]; setMapSize(s.cols,s.rows);
  const ratio=(typeof window!=='undefined'&&window.devicePixelRatio)||1;
  setDpr(Math.min(2,4000/Math.max(W,H),ratio));
  cv.width=W*dpr; cv.height=H*dpr;
  setCreepCan(document.createElement('canvas'));
  creepCan.width=COLS; creepCan.height=ROWS;
  setCctx(creepCan.getContext('2d'));
  setCreepImg(cctx.createImageData(COLS,ROWS));
  resetVisuals();
  updateUiScale();
}
export function startGame(dk,seed,opts){
  clearGame();                          // any new/resumed game invalidates the old continue slot
  const sizeIdx=(opts&&opts.sizeIdx!==undefined)?opts.sizeIdx:selSize;
  applyMapSize(sizeIdx);
  newGame(dk,seed,opts);
  setGhost(null); setReplayMode(false); replayQ=null;
  challengeTarget=(opts&&opts.challenge)||null;
  rec=(opts&&opts.sandbox)?null:{v:2,d:dk,s:S.seed,m:(opts&&opts.mods)||{},sz:sizeIdx,a:[]};
}
function applyAct(a){
  const op=a[1];
  if(op==='P'){if(canPlace(S,a[2],a[3],a[4]).ok)place(S,a[2],a[3],a[4]);}
  else if(op==='D'){const b=S.byId.get(a[2]);if(b)deconstruct(S,b);}
  else if(op==='M'){const b=S.byId.get(a[2]);if(b&&canPlace(S,b.type,a[3],a[4],b.id).ok)startMove(S,b,a[3],a[4]);}
  else if(op==='T'){const b=S.byId.get(a[2]);if(b)terraPaint(S,b,a[3],a[4],a[5]);}
  else if(op==='S'){S.supplyMode=a[2];}
  else if(op==='F'){forgeBuy(S,a[2]);}
}
function pumpReplay(){
  if(!replayQ)return;
  while(replayQ.i<replayQ.a.length && replayQ.a[replayQ.i][0]<=S.tickN){
    applyAct(replayQ.a[replayQ.i]); replayQ.i++;
  }
}
function encodeRun(r){return btoa(unescape(encodeURIComponent(JSON.stringify(r))));}
function decodeRun(s){return JSON.parse(decodeURIComponent(escape(atob(s.trim()))));}

/* ---------- save / resume a game in progress ----------
   The engine is deterministic, so a whole game IS its seed + action log. We
   persist that plus the current tick; resuming rebuilds the exact state by
   replaying the log forward (silently) to that tick, then hands back control. */
function buildSnapshot(){
  if(!rec||!S||replayMode||S.sandbox||S.tut||S.daily||challengeTarget||S.phase!=='play')return null;
  return {v:2,d:rec.d,s:rec.s,m:rec.m,sz:rec.sz,a:rec.a,tickN:S.tickN,t:S.t,diffName:S.diff.name};
}
function autoSave(){const g=buildSnapshot();if(g)saveGame(g);}
function refreshContinue(){
  const g=loadGame();
  if(el.btnContinue)el.btnContinue.classList.toggle('hide',!g);
  if(g&&el.contMeta)el.contMeta.textContent=(g.diffName||g.d||'sector')+(g.t!==undefined?' · '+fmtT(g.t):'')+' — in progress';
}
function resumeGame(){
  const g=loadGame();
  if(!g){refreshContinue();return;}
  initAudio();
  challengeTarget=null;
  startGame(g.d,g.s,{mods:g.m||{},sizeIdx:(g.sz!==undefined?g.sz:2)});   // fresh deterministic game (clears the slot)
  const wasMuted=muted; setMutedState(true);                            // silence the fast-forward
  replayQ={a:g.a,i:0};
  const target=g.tickN|0; let guard=0;
  while(S.tickN<target && guard++<500000){pumpReplay();tick();}
  pumpReplay();                                                          // flush actions at the live edge
  replayQ=null; setReplayMode(false); setMutedState(wasMuted);
  rec={v:2,d:g.d,s:g.s,m:g.m,sz:g.sz,a:g.a.slice()};                     // keep recording onward
  if(S.msgs)S.msgs.length=0;
  setShake(0); cam.x=0; cam.y=0; cam.z=1; setPaused(false);
  el.menu.classList.remove('show'); el.end.classList.remove('show'); el.btnResume.classList.add('hide');
  banner(false); updateInfo(true);
  saveGame(buildSnapshot()||g);                                         // re-persist right away
  msg('Sector restored — carry on, Commander.','#ffd27f');
}

/* ---------- guided first mission (tutorial coach) ----------
   A render-side state machine: each step shows a coach card and either
   advances automatically when its `done(st)` predicate is met (hands-on
   ACTION steps) or waits for the NEXT button (INFO steps). It only reads
   sim state and mutates render-only fields (S.tut/S.tutStep), so
   determinism is untouched. Started from the menu's FIRST MISSION button
   on a small fixed-seed EASY map. */
const TUT_SEED=0x5f10c5;
function tHasBuilt(st,type){for(const b of st.buildings)if(b.type===type&&b.built&&b.alive)return true;return false;}
function tHasAny(st,type){for(const b of st.buildings)if(b.type===type&&b.alive)return true;return false;}
/* steps with `done` are ACTION steps (auto-advance + a "skip step" Next);
   steps without are INFO steps (read, then tap NEXT). `hint` is the little
   italic prompt in the card footer. */
const TUT_STEPS=[
  {title:'WELCOME, COMMANDER',
   body:'This is <b>FLUXFRONT</b>. The blue <b>Flux</b> is a living fluid &mdash; it pours from red <b>Emitters</b>, floods downhill and destroys anything it drowns. Your job: contain it and wipe out every Emitter.',
   hint:'Read along and tap NEXT &mdash; I’ll walk you through it.'},
  {title:'DEPLOY YOUR CORE',
   body:'Everything starts with your <b>Command Core</b>. Click a flat, <b>green</b> landing site to drop it. The Flux stays completely frozen until you land &mdash; take your time and look around.',
   hint:'Click flat ground to deploy.',
   done:st=>st.phase==='play'},
  {title:'ENERGY & PACKETS',
   body:'See the <b>ENERGY</b> bar up top. Your Core ships glowing <b>energy packets</b> out along your network to build and arm everything. Watch them flow once you start building.',
   hint:'Energy is everything. Tap NEXT.'},
  {title:'HARVEST ENERGY',
   body:'Press <b>1</b> to pick the <b>Collector</b>, then click flat ground near your Core. Collectors claim the surrounding territory and turn it into steady income &mdash; the more ground, the more energy.',
   hint:'Press 1, then place a Collector.',
   done:st=>tHasBuilt(st,'collector')},
  {title:'THE NETWORK',
   body:'<b>Collectors</b> and <b>Relays</b> are <b>backbones</b> &mdash; the only structures others can link through. Anything off the network waits as a dim ghost until a backbone reaches it. <b>No link, no power.</b>',
   hint:'Reach is power. Tap NEXT.'},
  {title:'EXTEND YOUR REACH',
   body:'Press <b>2</b> for the <b>Relay</b> and place it out toward open ground. Relays have a long link radius &mdash; they stretch your network across the map so you can build near the Flux.',
   hint:'Press 2, then place a Relay.',
   done:st=>tHasAny(st,'relay')},
  {title:'READ THE LAND',
   body:'Structures need <b>flat ground</b> &mdash; the whole footprint on one level. <b>Height is defense</b>: Flux pools low, so hold the ridges. Hover any cell for its level and Flux depth; the <b>THREAT</b> bar shows how much map the Flux holds.',
   hint:'High ground buys time. Tap NEXT.'},
  {title:'HOLD THE LINE',
   body:'The Flux is creeping in. Press <b>6</b> for the <b>Cannon</b> and place it facing the blue tide to burn it back. Cannons fire automatically at shallow Flux in range.',
   hint:'Press 6, then place a Cannon.',
   done:st=>tHasAny(st,'cannon')},
  {title:'AMMO & SUPPLY',
   body:'Weapons spend energy as <b>ammo</b> &mdash; a Cannon with no supply goes quiet. The <b>SUPPLY</b> row shows who’s waiting (B = build, A = ammo). Press <b>P</b> to favour weapons, construction, or a balanced split.',
   hint:'Keep the guns fed. Tap NEXT.'},
  {title:'HOW YOU WIN',
   body:'You can’t out-shoot the Flux forever &mdash; you must kill the source. The <b>Nullifier</b> charges up, fires once, and erases every Emitter in range. Clear them all and the Flux dies with them.',
   hint:'Destroy the Emitters to win. Tap NEXT.'},
  {title:'CHARGE A NULLIFIER',
   body:'Press <b>0</b> for the <b>Nullifier</b> and place it within range of a red <b>Emitter</b> (it needs one nearby). Then keep it supplied &mdash; it swallows 20 packets, then fires.',
   hint:'Press 0, place it by an Emitter.',
   done:st=>tHasAny(st,'nullifier')},
  {title:'FINISH THE SECTOR',
   body:'Your Nullifier is charging &mdash; defend it until the beam fires and the Emitter is gone. That’s the whole loop: <b>expand, defend, nullify.</b> You’ve got this, Commander &mdash; clear the map!',
   hint:'Good luck out there.',
   last:true}
];
let tutShown=-1;
function endTutorial(){if(S)S.tut=false;tutShown=-1;if(el.tutCard)el.tutCard.classList.add('hide');}
function tutAdvance(){            // NEXT button: step forward, or finish on the last card
  if(!S||!S.tut)return;
  const s=TUT_STEPS[S.tutStep|0];
  if(!s||s.last){endTutorial();return;}
  S.tutStep=(S.tutStep|0)+1; sfx('uiclick'); tutShown=-1;
}
function tutCheck(){
  const card=el.tutCard;
  if(!card)return;
  if(!S||!S.tut||S.phase==='menu'){card.classList.add('hide');return;}
  const cur=TUT_STEPS[S.tutStep|0];
  if(cur&&cur.done&&cur.done(S)){          // hands-on step completed → auto-advance
    if(cur.last){endTutorial();return;}
    S.tutStep=(S.tutStep|0)+1; sfx('uiclick');
  }
  const s=TUT_STEPS[S.tutStep|0];
  if(!s){card.classList.add('hide');return;}
  card.classList.remove('hide');
  if(tutShown!==S.tutStep){
    if(el.tutStepNo)el.tutStepNo.textContent=((S.tutStep|0)+1)+' / '+TUT_STEPS.length;
    if(el.tutTitle)el.tutTitle.innerHTML=s.title;
    if(el.tutBody)el.tutBody.innerHTML=s.body;
    if(el.tutHint)el.tutHint.innerHTML=s.hint||'';
    if(el.tutNext)el.tutNext.innerHTML=s.last?'FINISH ✓':(s.done?'SKIP STEP ▶':'NEXT ▶');
    tutShown=S.tutStep;
  }
}

/* ---------- first-use structure tips ----------
   The first time the player ever selects a build type, a small card explains
   what it does and how to use it — covering every structure once, then
   remembered (storage.js). Render-only; toggle in SETTINGS. */
const STRUCTURE_TIPS={
  collector:'Claims the surrounding ground for energy income — fields never overlap, so spread Collectors out across open terrain to own more map.',
  relay:'A long-reach <b>backbone</b>. It carries your network across the map so you can build out near the Flux. Chain them toward the front.',
  reactor:'Flat <b>+0.8 e/s</b>, no territory needed — park them safe in the rear. Sitting on a Power Zone makes it ×6.',
  battery:'<b>+25 energy capacity.</b> Build a few so bursts of construction and ammo don’t drain your reserves to zero.',
  terra:'The <b>Terp</b> reshapes land. Set a target level (−/+ or [ ]) then click or drag ground in range to raise or lower it — walls, moats, ramps and platforms.',
  cannon:'Front-line workhorse: auto-fires at <b>shallow</b> Flux in range. Cheap and fast, but it eats energy as ammo — build a wall of them and keep them supplied.',
  mortar:'Lobs shells at <b>deep pools</b> (depth ≥0.9) far behind the front. Splash damage cracks open flooded basins that Cannons can’t reach.',
  beam:'<b>Anti-air.</b> The only thing that shoots down <b>Spore</b> blobs before they land. Cover your base whenever Spore Towers are on the map.',
  sprayer:'Sprays friendly <b>Anti-Flux</b> that annihilates Flux on contact — a chemical wall for gaps that terrain can’t hold.',
  nullifier:'Your <b>win condition</b>. Charges 20 packets, fires once, and erases every Emitter or Spore Tower in range. Must be built with one nearby.',
  cryo:'Hotkey <b>C</b>. A freeze pulse zeroes Flux in range and raises temporary <b>ice ground</b> — bridge a flooded basin and rush a Nullifier across.',
  sniper:'Hotkey <b>N</b>. One-shots <b>Digitalis Runners</b> before they reach your structures and stun them. Place near your Digitalis-prone front.',
  strafer:'Hotkey <b>V</b>. An air pad — its aircraft sorties against the <b>deepest Flux</b> nearby. Mobile firepower for shifting hotspots.',
  shield:'Hotkey <b>B</b>. Drains energy to physically <b>push Flux outward</b> in a dome — buy time to charge a Nullifier under heavy flooding.',
  convert:'Hotkey <b>K</b>. Charges up, then <b>captures</b> an Emitter so it pumps Anti-Flux for you. Counts as neutralised toward winning.',
  bomber:'Hotkey <b>J</b>. An air pad — its bomber carpet-drops <b>Anti-Flux</b> on the deepest Flux. Heavy area denial from the sky.',
  pylon:'A <b>backbone</b> with huge reach. Each connected Pylon also speeds up <b>every packet</b> (up to +0.6) — the logistics spine for big maps.',
  harvester:'Must sit on a purple <b>Aether Node</b>. Mines Aether into the <b>Forge</b> so you can buy permanent upgrades.',
  guppy:'An air-link <b>backbone</b> with the longest reach of all — attaches distant outposts across gaps nothing else can bridge.',
  sensor:'A scout tower: reveals a radar ring and blips around it. No combat — pure vision over the fog.',
  repair:'Heals nearby <b>built</b> structures over time (draining a little energy while it works). Tuck it behind the front line.',
  resonator:'A passive aura: weapons within range get <b>+40% fire rate & range</b>. But it attracts Spores — guard it well.',
  siphon:'Build it <b>directly on deep Flux</b> (it’s immune to damage). It drains its own cell straight into energy — turn the flood into fuel.',
  inhibitor:'Drains energy to <b>slow Flux to a crawl</b> in a zone — a soft wall that buys time at chokepoints.'
};
function hideTip(){if(el.tipCard)el.tipCard.classList.add('hide');}
function showTip(key){
  if(!el.tipCard)return;
  if(!settings.tips || (S&&S.tut)){hideTip();return;}   // suppressed during the guided tutorial
  const tip=STRUCTURE_TIPS[key];
  if(!tip || tipSeen(key)){hideTip();return;}
  const T=TYPES[key];
  if(el.tipName)el.tipName.textContent=(T&&T.name?T.name:key).toUpperCase();
  if(el.tipBody)el.tipBody.innerHTML=tip;
  el.tipCard.classList.remove('hide');
  markTipSeen(key);
}

/* ---------- UI helpers ---------- */
export function banner(show,text){
  if(text!==undefined)el.banner.textContent=text;
  el.banner.classList.toggle('hide',!show);
}
export function setPaused(v){
  if(paused!==v)sfx('uiclick');
  setPausedState(v);
  el.btnPause.textContent=paused?'▶ RESUME':'❚❚ PAUSE';
  el.btnPause.classList.toggle('on',paused);
}
export function setSpeed(v){
  if(speed!==v)sfx('uiclick');
  setSpeedState(v);
  el.spd1.classList.toggle('on',v===1);
  el.spd2.classList.toggle('on',v===2);
  el.spd4.classList.toggle('on',v===4);
  el.spd8.classList.toggle('on',v===8);
}
export function setMuted(v){
  setMutedState(v);
  applyMute();
  el.btnMute.textContent=muted?'🔇':'🔊';
  el.btnMute.classList.toggle('on',muted);
}
export function selectBuild(key){
  if(!S || S.phase!=='play')return;
  sfx('uiclick');
  clearArm();
  setDelMode(false); setMoveSrc(null); setMoveMode(false); setMoveGroup([]);
  const willSelect=(selBuild!==key);
  setSelBuild(willSelect?key:null);
  setSel(null);
  if(willSelect){const ti=tabOf(key);if(ti>=0&&ti!==buildTabIdx)showTab(ti);showTip(key);}  // jump to its tab + first-use tip
  else hideTip();
  refreshButtons(); updateInfo(true);
}
export function toggleDel(){
  if(!S || S.phase!=='play')return;
  sfx('uiclick');
  clearArm(); setMoveMode(false); setMoveGroup([]); setMarquee(null);
  setDelMode(!delMode); setMoveSrc(null);
  if(delMode){setSelBuild(null);setSel(null);}
  refreshButtons(); updateInfo(true);
}
export function toggleMove(){
  if(!S || S.phase!=='play')return;
  sfx('uiclick');
  clearArm(); setDelMode(false); setMoveSrc(null); setMarquee(null);
  setMoveMode(!moveMode); setMoveGroup([]);
  if(moveMode){setSelBuild(null);setSel(null);}
  refreshButtons(); updateInfo(true);
}
export function cancelModes(){
  clearArm(); setMarquee(null); hideTip();
  setSelBuild(null); setDelMode(false); setSel(null); setMoveSrc(null);
  setMoveMode(false); setMoveGroup([]);
  refreshButtons(); updateInfo(true);
}
export function refreshButtons(){
  for(const key of BUILD_ORDER){
    const btn=document.getElementById('bb_'+key);
    if(btn)btn.classList.toggle('on',selBuild===key);
  }
  el.btnDel.classList.toggle('on',delMode);
  if(el.btnMove)el.btnMove.classList.toggle('on',moveMode);
}
export function updateInfo(force){
  let html='';
  if(!S || S.phase==='menu'){
    html='Pick a difficulty to begin.';
  }else if(S.phase==='placeCore'){
    html=TOUCH
      ?'<b>Deploy the Command Core.</b><br>Tap any flat 3×3 plateau — anywhere, even beside an Emitter — then tap again to confirm. The Flux only starts once you land.'
      :'<b>Deploy the Command Core.</b><br>Click any flat 3×3 plateau — anywhere, even right next to an Emitter. The Flux only starts once you land. Low ground floods first.';
  }else if(delMode){
    html=TOUCH
      ?'<b>RECYCLE MODE</b><br>Tap to recycle one · <b>drag a box</b> to recycle many · <b>double-tap</b> a structure to recycle its kind nearby.'
      :'<b>RECYCLE MODE</b><br>Click to recycle one · <b>drag a box</b> to recycle many · <b>double-click</b> a structure to recycle its kind nearby. Esc/X cancels.';
  }else if(moveMode){
    html=moveGroup.length
      ?'<b>MOVE MODE</b> — '+moveGroup.length+' selected.<br>Click a destination; they fly there in formation. Drag a new box to reselect.'
      :'<b>MOVE MODE</b><br><b>Drag a box</b> over Cannons/Mortars/Core to grab them, then click a destination. They keep formation. Esc/G cancels.';
  }else if(moveSrc && moveSrc.alive){
    html='<b>RELOCATING '+TYPES[moveSrc.type].name+'</b><br>'+(TOUCH
      ?'Tap a flat destination, tap again to confirm.'
      :'Click a flat destination. Right-click or Esc to cancel.')
      +(moveSrc.type==='core'?'<br><span class="bad">The network is offline while the Core flies!</span>':'');
  }else if(selBuild){
    const T=TYPES[selBuild];
    html='<b>'+T.name+'</b> — '+T.cost+'e<br>'+T.desc+'<br><span class="dim">'+(TOUCH
      ?'Tap to preview · tap again to place. Drag to chain-build.'
      :'Click the map to place, or drag to chain-build a line. Right-click to cancel.')+'</span>';
  }else if(sel && sel.alive){
    html=selPanel(sel);
  }else{
    html=TOUCH
      ?'Pick a structure below, then tap the map. Pinch to zoom, drag to pan. Hunt the Emitters with Nullifiers.'
      :'Select a structure (1–0), then click the map. Hold the line, then hunt the Emitters and Spore Towers with Nullifiers.';
  }
  if(force || html!==lastInfo){
    el.info.innerHTML=html;
    lastInfo=html;
  }
  const showTerra=!!(sel&&sel.alive&&sel.type==='terra'&&sel.built&&!selBuild&&!delMode);
  el.terraBar.classList.toggle('hide',!showTerra);
  if(showTerra){
    if(lastTerraId!==sel.id){
      lastTerraId=sel.id;
      setTerraTarget(S.ter[idx(sel.gx,sel.gy)]);
    }
    el.tLevel.textContent='L'+terraTarget;
  }else lastTerraId=-1;
}
let lastTerraId=-1;
function row(k,v){return '<div class="r"><span>'+k+'</span><span>'+v+'</span></div>';}
/* rich selected-structure panel: bars + live stats + a plain-language status
   line + recycle / relocate buttons (wired by delegation on #info) */
function mbar(frac,col){return '<div class="mbar"><i style="width:'+(clamp(frac,0,1)*100).toFixed(0)+'%;background:'+col+'"></i></div>';}
function selPanel(b){
  const T=TYPES[b.type], shot=T.shotCost||1;
  let h='<div class="spHead"><b>'+T.name+'</b>';
  if(b.type!=='core'&&!b.moving)h+='<button class="spBtn" data-act="recycle" title="Recycle for a refund">♺ scrap</button>';
  h+='</div>';
  h+='<div class="spRow"><span>HEALTH</span><span>'+Math.ceil(b.hp)+' / '+T.hp+'</span></div>'
    +mbar(b.hp/T.hp, b.hp<T.hp*0.35?'#ff6e6e':(b.hp<T.hp*0.7?'#ffba5c':'#4df0c8'));
  if(!b.built)h+='<div class="spRow"><span>BUILDING</span><span>'+b.buildGot+' / '+T.cost+'</span></div>'+mbar(b.buildGot/T.cost,'#6fb7ff');
  if(T.ammoMax)h+='<div class="spRow"><span>AMMO</span><span>'+Math.floor(b.ammo)+' / '+T.ammoMax+'</span></div>'
    +mbar(b.ammo/T.ammoMax, b.ammo<shot?'#ffba5c':'#74e6a8');
  if((b.type==='nullifier'||b.type==='convert')&&!b.fired)h+='<div class="spRow"><span>CHARGE</span><span>'+b.charge+' / '+T.charge+'</span></div>'+mbar(b.charge/T.charge,'#b66bff');
  // live stat line
  const st=[];
  if(b.type==='collector')st.push('+'+(0.003*b.cov*(b.pz?3:1)).toFixed(2)+' e/s · '+b.cov+' cells');
  else if(T.prod)st.push('+'+(T.prod*(b.pz&&b.type==='reactor'?6:1)).toFixed(1)+' e/s');
  if(T.range)st.push('range '+(T.range*(b.reso?1.4:1)*(b.pz?1.3:1)).toFixed(0));
  if(T.cap)st.push('+'+(T.cap*(b.pz?3:1))+' cap');
  if(T.linkR)st.push('link '+(b.pz?(T.linkR*1.5).toFixed(0):T.linkR));
  if(st.length)h+='<div class="spStat">'+st.join('  ·  ')+'</div>';
  if(b.pz)h+='<div class="spStat" style="color:#ffd86b">★ POWER ZONE — boosted</div>';
  if(b.reso&&!b.pz)h+='<div class="spStat" style="color:#b9a3ff">↯ Resonator overcharge</div>';
  if(b.stun>0)h+='<div class="spStat bad">⚡ STUNNED — hit by a Runner</div>';
  // plain-language status, most urgent first
  if(b.moving)h+='<div class="spStat dim">Relocating… (offline in flight)</div>';
  else if(!b.conn)h+='<div class="spStat bad">⚠ DISCONNECTED — link a Collector or Relay within reach</div>';
  else if(T.ammoMax&&b.built&&b.ammo<shot)h+='<div class="spStat bad">Out of ammo — raise supply (P) or add reserves</div>';
  else if(b.type==='shield'&&b.built&&!b.active)h+='<div class="spStat bad">Unpowered — not enough energy to run</div>';
  else if(!b.built)h+='<div class="spStat dim">Awaiting packets…</div>';
  else h+='<div class="spStat" style="color:#7be3a8">● Connected &amp; operational</div>';
  // contextual controls
  if(b.type==='terra'&&b.built)h+='<div class="dim" style="margin-top:5px">Jobs '+b.tjobs.length+' · painting <b>L'+terraTarget+'</b> — [ and ] change, click/drag ground in range</div>';
  if(!b.moving&&MOVABLE[b.type]&&b.built)h+='<button class="spBtn wide" data-act="move">✥ RELOCATE</button>';
  return h;
}
function rankOf(won){
  if(!won)return 'F';
  const t=S.t, lost=S.stats.lost;
  if(t<300 && lost===0)return 'S';
  if(t<420 && lost<=2)return 'A';
  if(t<600 && lost<=5)return 'B';
  return 'C';
}
function computeUnlocks(won){
  const s=S.stats, u=[], mods=Object.keys(S.mods).filter(k=>S.mods[k]).length;
  if(won){
    u.push('firstwin');
    if(s.lost===0)u.push('flawless');
    if(S.t<300)u.push('speed');
    if(S.diff.key==='insane')u.push('insane');
    if(S.daily)u.push('daily');
    if(mods>=2)u.push('mutant');
  }
  if(s.frozen>=1000)u.push('frostbite');
  if(s.terra>=300)u.push('sculptor');
  if(S.relics.length&&S.relics.every(r=>r.claimed))u.push('relic3');
  if((s.pzPeak||0)>=5)u.push('pzlord');
  return u;
}
export function showEnd(won){
  clearGame();                       // the run is over — drop the resume slot
  const rank=rankOf(won);
  el.endRank.textContent=rank;
  el.endRank.className='rank'+rank;
  el.endTitle.textContent=won?'SECTOR SECURED':'CORE LOST';
  el.endTitle.style.color=won?'#4df0c8':'#ff6e6e';
  const s=S.stats;
  // persist + achievements (skipped for sandbox/replay so they don't pollute records)
  let extra='';
  if(!S.sandbox && !replayMode){
    const res=recordResult({won:won,diff:S.diff.key,time:S.t,daily:S.daily,dailyKey:S.dailyKey,unlock:computeUnlocks(won)});
    const bt=bestTime(S.diff.key);
    if(bt!==undefined)extra+=row(res.best?'★ NEW BEST TIME':'Best '+S.diff.name,fmtT(bt));
    for(const id of res.newAch){
      const a=ACHIEVEMENTS.find(x=>x.id===id);
      if(a)extra+='<div class="r" style="color:#b66bff"><span>◈ '+a.name+'</span><span>unlocked</span></div>';
    }
  }
  // challenge verdict
  if(challengeTarget){
    let verdict;
    if(!won)verdict='<div class="r" style="color:#ff6e6e"><span>◈ CHALLENGE</span><span>DEFEATED — they win</span></div>';
    else if(S.t<challengeTarget.time)verdict='<div class="r" style="color:#4df0c8"><span>◈ CHALLENGE</span><span>BEATEN by '+fmtT(challengeTarget.time-S.t)+'!</span></div>';
    else verdict='<div class="r" style="color:#ffba5c"><span>◈ CHALLENGE</span><span>too slow by '+fmtT(S.t-challengeTarget.time)+'</span></div>';
    extra=verdict+extra;
  }
  el.endStats.innerHTML=
    row('Time',fmtT(S.t))+
    row('Flux destroyed',Math.floor(s.flux))+
    row('Emitters neutralized',s.emitters+' / '+S.emitters.length)+
    row('Structures built',s.built)+
    row('Structures lost',s.lost)+
    (s.coresLost?row('Cores lost',s.coresLost):'')+
    row('Packets shipped',s.packets)+
    extra;
  el.end.classList.add('show');
}
/* persistent alert strip — incoming/active threats as little chips. Rebuilds
   the DOM only when the set (or a countdown second) changes. */
let lastAlertSig='';
function renderAlerts(dAmmo){
  if(!el.alerts||!el.alerts.classList)return;
  const A=[];   // [cls, icon, text]
  const cd=v=>Math.max(0,Math.ceil(v-S.t));
  if(S.coreDown)A.push(['bad','⟳','REDEPLOY CORE '+cd(S.reclaimT)+'s']);
  else{
    const core=S.byId.get(S.coreId);
    if(core&&core.moving)A.push(['bad','⚠','NETWORK DOWN — core in flight']);
    else if(core&&core.hp<core.hpMax*0.45)A.push(['bad','◈','CORE UNDER ATTACK']);
  }
  if(S.surge.active)A.push(['bad','⚡','SURGE ×2.5 — '+cd(S.surge.end)+'s']);
  else if(S.surge.warned)A.push(['warn','⚡','SURGE in '+cd(S.surge.next)+'s']);
  if(S.weather.active)A.push(['info','≈','FLUX SQUALL — '+cd(S.weather.end)+'s']);
  else if(S.weather.warned)A.push(['info','≈','SQUALL in '+cd(S.weather.next)+'s']);
  if(S.spores&&S.spores.length)A.push(['warn','◍','SPORE INBOUND ×'+S.spores.length]);
  if(dAmmo>0&&S.energy<2)A.push(['warn','▽','LOW ENERGY — guns starving']);
  const sig=A.map(a=>a[0]+a[2]).join('|');
  if(sig===lastAlertSig)return;        // only touch the DOM when something changes
  lastAlertSig=sig;
  el.alerts.classList.toggle('hide',!A.length);
  el.alerts.innerHTML=A.map(a=>'<span class="al '+a[0]+'"><span class="ai">'+a[1]+'</span>'+a[2]+'</span>').join('');
}
let hudT=0, lastAlarm=0, redSince=0, lastRedMsg=0;
export function updateHUD(){
  if(!S){setIntensity(0.15);return;}
  el.hudEnergy.textContent=Math.floor(S.energy)+' / '+Math.floor(S.cap);
  const net=S.prod-S.spend.rate;
  el.hudRate.textContent=(net>=0?'+':'')+net.toFixed(1)+'/s';
  el.hudRate.style.color=net>=-0.05?'#7be3a8':'#ff8d7a';
  el.hudFlux.textContent='×'+(1+S.t/S.diff.grow).toFixed(2);
  el.hudTime.textContent=fmtT(S.t);
  el.energyFill.style.width=(S.cap>0?clamp(S.energy/S.cap,0,1)*100:0).toFixed(1)+'%';
  let cells=0;
  for(let i=0;i<S.creep.length;i++)if(S.creep[i]>0.5)cells++;
  const cov=cells/S.creep.length;
  el.hudThreat.textContent=(cov*100).toFixed(0)+'%';
  el.threatFill.style.width=(clamp(cov/0.4,0,1)*100).toFixed(1)+'%';
  el.threatFill.style.background=cov>0.22?'#ff6e6e':(cov>0.1?'#ffba5c':'#4df0c8');
  // supply demand readout: how many structures are waiting on each lane
  let dBuild=0, dAmmo=0;
  for(const b of S.buildings){
    const need=needOf(S,b);
    if(need==='ammo')dAmmo++;
    else if(need)dBuild++;
  }
  el.hudSupply.textContent='B'+dBuild+' · A'+dAmmo;
  el.hudSupply.style.color=(dAmmo>0&&S.energy<2)?'#ff8d7a':(dBuild+dAmmo>8?'#ffba5c':'#7be3a8');
  if(el.energyBar&&el.energyBar.classList)el.energyBar.classList.toggle('low',dAmmo>0&&S.energy<2);
  renderAlerts(dAmmo);
  el.btnSupply.textContent=SUPPLY_LABEL[S.supplyMode];
  let pzc=0; for(const b of S.buildings)if(b.alive&&b.pz)pzc++;
  if(pzc>(S.stats.pzPeak||0))S.stats.pzPeak=pzc;
  let inten=S.phase==='play'?0.15+cov*2.2+Math.min(0.25,S.t/1200):0.3;
  if(S.surge.active||S.weather.active)inten=Math.max(inten,0.95);   // the music IS the warning
  else if(S.surge.warned||S.weather.warned)inten=Math.max(inten,0.8);
  if(S.coreDown)inten=1;
  setIntensity(inten);
  const core=S.byId.get(S.coreId);
  if(core && S.phase==='play' && core.hp<core.hpMax*0.45){
    const now=performance.now();
    if(now-lastAlarm>4000){
      lastAlarm=now;
      sfx('alarm');
      msg('WARNING: Command Core under attack!','#ff6e6e');
    }
  }
  if(S.phase==='play'){
    if(net<-0.5)redSince+=1/60; else redSince=0;
    if(redSince>15 && performance.now()-lastRedMsg>30000){
      lastRedMsg=performance.now(); redSince=0;
      msg('◈ OPS: Energy grid deep in the red. Build Reactors or recycle guns.','#ff9d5c');
      sfx('error');
    }
  }
  if(S.phase==='play'){
    for(const key of BUILD_ORDER){
      const btn=document.getElementById('bb_'+key);
      if(btn)btn.classList.toggle('poor',S.energy<TYPES[key].cost);
    }
  }
  // Forge panel: visible during play, labels track escalating costs
  el.forge.classList.toggle('hide',S.phase!=='play'&&S.phase!=='placeCore');
  el.fgAe.textContent=S.aether.toFixed(1)+' æ';
  el.fgRate.textContent='FIRE +10% · '+S.forge.rate+'æ';
  el.fgSpeed.textContent='PKT +15% · '+S.forge.speed+'æ';
  el.fgEnergy.textContent='PWR +0.5 · '+S.forge.energy+'æ';
  el.fgDmg.textContent='DMG +15% · '+S.forge.dmg+'æ';
  if((S.phase==='won'||S.phase==='lost')&&rec){rec.time=S.t;rec.won=(S.phase==='won');lastRun=rec;rec=null;}
  updateInfo(false);
}

/* ---------- camera ---------- */
const ZMAX=6;
function clampCam(){
  cam.z=clamp(cam.z,1,ZMAX);
  cam.x=clamp(cam.x,0,W-W/cam.z);
  cam.y=clamp(cam.y,0,H-H/cam.z);
}
function zoomAt(f,sx,sy){
  const wx=cam.x+sx/cam.z, wy=cam.y+sy/cam.z;
  cam.z=clamp(cam.z*f,1,ZMAX);
  cam.x=wx-sx/cam.z; cam.y=wy-sy/cam.z;
  clampCam();
}

/* ---------- input ---------- */
function screenPos(ev){
  const r=cv.getBoundingClientRect();
  return [(ev.clientX-r.left)*(W/r.width),(ev.clientY-r.top)*(H/r.height)];
}
function canvasPos(ev){
  const s=screenPos(ev);
  return [cam.x+s[0]/cam.z, cam.y+s[1]/cam.z];
}
function setHover(px,py){
  hover.px=px; hover.py=py;
  hover.inside=px>=0&&py>=0&&px<W&&py<H;
  hover.cx=clamp(Math.floor(px/CELL),0,COLS-1);
  hover.cy=clamp(Math.floor(py/CELL),0,ROWS-1);
  hover.b=null;
  if(S && hover.inside){
    const id=S.occ[idx(hover.cx,hover.cy)];
    if(id!==-1){
      const b=S.byId.get(id);
      if(b && b.alive)hover.b=b;
    }
  }
}

/* touch placement arms a target on the first tap and commits on the second */
let armedCx=-1, armedCy=-1, armedB=null;
function clearArm(){armedCx=-1;armedCy=-1;armedB=null;}

const ptrs=new Map();
let panPtr=-1, panning=false, panSx=0, panSy=0, camSx=0, camSy=0;
let pinch=null;
/* recycle-mode multi-select: box-drag and double-click-same-type */
let marqPtr=-1, marqActive=false, marqX0=0, marqY0=0;
let lastTapT=0, lastTapId=-1;
function recycleBox(x0,y0,x1,y1){
  if(replayMode)return 0;
  const lx=Math.min(x0,x1), rx=Math.max(x0,x1), ty=Math.min(y0,y1), by=Math.max(y0,y1);
  let n=0;
  for(const b of S.buildings.slice()){
    if(!b.alive||b.id===S.coreId||b.moving)continue;
    if(b.px>=lx&&b.px<=rx&&b.py>=ty&&b.py<=by){recAct('D',b.id);deconstruct(S,b);n++;}
  }
  if(n)msg('Recycled '+n+' structures.','#9fb2c8');
  return n;
}
function recycleSameType(b){
  if(replayMode||!b)return;
  const r=6, list=[];
  for(const o of S.buildings.slice()){
    if(!o.alive||o.id===S.coreId||o.moving||o.type!==b.type)continue;
    if(dist(o.px/CELL,o.py/CELL,b.px/CELL,b.py/CELL)<=r)list.push(o);
  }
  for(const o of list){recAct('D',o.id);deconstruct(S,o);}
  if(list.length)msg('Recycled '+list.length+' '+TYPES[b.type].name+' nearby.','#9fb2c8');
}
/* box-select all MOVABLE built structures into the move group */
function selectMoveBox(x0,y0,x1,y1){
  const lx=Math.min(x0,x1), rx=Math.max(x0,x1), ty=Math.min(y0,y1), by=Math.max(y0,y1);
  const ids=[];
  for(const b of S.buildings){
    if(!b.alive||!b.built||b.moving||!MOVABLE[b.type])continue;
    if(b.px>=lx&&b.px<=rx&&b.py>=ty&&b.py<=by)ids.push(b.id);
  }
  setMoveGroup(ids);
  msg(ids.length?('Selected '+ids.length+' movable structure'+(ids.length!==1?'s':'')+' — click a destination.'):'No movable structures in the box (cannons, mortars, core).','#9fd0ff');
  if(ids.length)sfx('uiclick'); else sfx('error');
}
/* relocate the whole group to a click, preserving their formation around
   the group centroid; members whose target cell is invalid stay put */
function relocateGroup(cx,cy){
  if(replayMode)return;
  const group=moveGroup.map(id=>S.byId.get(id)).filter(b=>b&&b.alive&&!b.moving);
  if(!group.length){setMoveGroup([]);return;}
  let sgx=0,sgy=0;
  for(const b of group){sgx+=b.gx+b.sz/2;sgy+=b.gy+b.sz/2;}
  sgx/=group.length; sgy/=group.length;
  let moved=0;
  for(const b of group){
    const tx=Math.round(cx+(b.gx+b.sz/2-sgx)), ty=Math.round(cy+(b.gy+b.sz/2-sgy));
    if(canPlace(S,b.type,tx,ty,b.id).ok){recAct('M',b.id,tx,ty);startMove(S,b,tx,ty);moved++;}
  }
  msg(moved?('Relocating '+moved+' structure'+(moved!==1?'s':'')+'.'):'No room for the formation there.',moved?'#9fd0ff':'#ff8d7a');
  if(moved)sfx('done'); else sfx('error');
  setMoveGroup([]);
}
/* minimap (its own panel canvas) → jump the camera to the clicked fraction */
let miniDrag=false;
function onMiniDown(ev){
  miniDrag=true;
  if(el.mini.setPointerCapture){try{el.mini.setPointerCapture(ev.pointerId);}catch(e){}}
  onMiniMove(ev);
}
function onMiniMove(ev){
  if(!miniDrag||!S)return;
  const r=el.mini.getBoundingClientRect();
  jumpCamFrac((ev.clientX-r.left)/r.width,(ev.clientY-r.top)/r.height);
}
function onMiniUp(){miniDrag=false;}
/* drag-to-chain build: in build mode the primary pointer paints structures
   along the drag path instead of panning (pinch still zooms/pans) */
let paintPtr=-1, paintActive=false, painted=false, paintLX=-99, paintLY=-99;
let paintKind='build';     // 'build' = chain-build with selBuild, 'terra' = Terp level painting

function terraSel(){
  return (sel&&sel.alive&&sel.type==='terra'&&sel.built&&!sel.moving)?sel:null;
}
function tryTerraPaint(){
  if(replayMode)return;
  if(hover.cx===paintLX && hover.cy===paintLY)return;
  paintLX=hover.cx; paintLY=hover.cy;
  const t=terraSel();
  if(t && !hover.b && terraPaint(S,t,hover.cx,hover.cy,terraTarget)){
    recAct('T',t.id,hover.cx,hover.cy,terraTarget);
    painted=true;
    sfx('uiclick');
  }
}
function tryPaint(first){
  if(replayMode)return;
  const T=TYPES[selBuild];
  if(!first && paintLX>-1){
    const spacing=(T.backbone&&T.linkR)?Math.max(1.5,T.linkR*0.85):T.sz;
    if(dist(hover.cx,hover.cy,paintLX,paintLY)<spacing)return;
  }
  if(canPlace(S,selBuild,hover.cx,hover.cy).ok){
    recAct('P',selBuild,hover.cx,hover.cy);
    place(S,selBuild,hover.cx,hover.cy);
    sfx('done');
    paintLX=hover.cx; paintLY=hover.cy;
    painted=true;
    clearArm();
  }
}
function onPointerDown(ev){
  initAudio();
  if(ev.button===2){cancelModes();return;}
  const s=screenPos(ev);
  ptrs.set(ev.pointerId,{x:s[0],y:s[1]});
  if(cv.setPointerCapture){try{cv.setPointerCapture(ev.pointerId);}catch(e){}}
  if(ptrs.size===1){
    panPtr=ev.pointerId; panning=false; painted=false;
    panSx=s[0]; panSy=s[1]; camSx=cam.x; camSy=cam.y;
    paintPtr=-1; paintActive=false; paintLX=-99; paintLY=-99;
    marqPtr=-1; marqActive=false;
    // recycle/move mode: primary drag draws a selection box (instead of panning)
    if(S && S.phase==='play' && (delMode||moveMode) && (ev.pointerType!=='mouse'||ev.button===0)){
      const p=canvasPos(ev);
      marqPtr=ev.pointerId; marqX0=p[0]; marqY0=p[1];
    }
    if(S && S.phase==='play' && !delMode && (selBuild||terraSel()) && (ev.pointerType!=='mouse'||ev.button===0)){
      paintPtr=ev.pointerId;
      paintKind=selBuild?'build':'terra';
      if(ev.pointerType==='mouse'){
        const p=canvasPos(ev); setHover(p[0],p[1]);
        if(hover.inside){
          if(paintKind==='build')tryPaint(true);
          else tryTerraPaint();
        }
      }
    }
    if(ev.pointerType!=='touch'){const p=canvasPos(ev);setHover(p[0],p[1]);}
  }else if(ptrs.size===2){
    panPtr=-1; panning=false;
    paintPtr=-1; paintActive=false;
    const pts=[...ptrs.values()];
    pinch={d0:Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)||1,z0:cam.z};
  }
}
function onPointerMove(ev){
  const s=screenPos(ev);
  const pt=ptrs.get(ev.pointerId);
  if(pt){pt.x=s[0];pt.y=s[1];}
  if(pinch && ptrs.size>=2){
    const pts=[...ptrs.values()];
    const d=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)||1;
    const cx=(pts[0].x+pts[1].x)/2, cy=(pts[0].y+pts[1].y)/2;
    zoomAt((pinch.z0*d/pinch.d0)/cam.z,cx,cy);
    return;
  }
  if(pt && ev.pointerId===marqPtr && S && (delMode||moveMode)){
    if(!marqActive && Math.hypot(s[0]-panSx,s[1]-panSy)>(ev.pointerType==='touch'?9:5))marqActive=true;
    if(marqActive){
      const p=canvasPos(ev);
      setMarquee({x0:marqX0,y0:marqY0,x1:p[0],y1:p[1]});
    }
    return;
  }
  if(pt && ev.pointerId===paintPtr && S && S.phase==='play' && (paintKind==='build'?selBuild:terraSel())){
    if(!paintActive && Math.hypot(s[0]-panSx,s[1]-panSy)>(ev.pointerType==='touch'?9:5))paintActive=true;
    if(paintActive){
      const p=canvasPos(ev); setHover(p[0],p[1]);
      if(hover.inside){
        if(paintKind==='build')tryPaint(false);
        else tryTerraPaint();
      }
    }
    return;
  }
  if(pt && ev.pointerId===panPtr){
    const dx=s[0]-panSx, dy=s[1]-panSy;
    if(!panning && Math.hypot(dx,dy)>(ev.pointerType==='touch'?9:5))panning=true;
    if(panning){
      cam.x=camSx-dx/cam.z; cam.y=camSy-dy/cam.z;
      clampCam();
      return;
    }
  }
  if(!pt && ev.pointerType!=='touch'){
    const p=canvasPos(ev); setHover(p[0],p[1]);
  }
}
function onPointerUp(ev){
  const pt=ptrs.get(ev.pointerId);
  ptrs.delete(ev.pointerId);
  if(ptrs.size<2)pinch=null;
  if(ev.pointerId===paintPtr){paintPtr=-1;paintActive=false;}
  // recycle/move-mode box select & commit
  if(ev.pointerId===marqPtr){
    marqPtr=-1; panPtr=-1;
    const p=canvasPos(ev);
    if(moveMode){
      if(marqActive){selectMoveBox(marqX0,marqY0,p[0],p[1]);}
      else{
        setHover(p[0],p[1]);
        if(moveGroup.length)relocateGroup(hover.cx,hover.cy);          // tap = destination
        else if(hover.b&&MOVABLE[hover.b.type]&&hover.b.built&&!hover.b.moving){setMoveGroup([hover.b.id]);msg('Selected — click a destination.','#9fd0ff');}
        else sfx('error');
      }
      marqActive=false; setMarquee(null); painted=false; return;
    }
    if(marqActive){
      recycleBox(marqX0,marqY0,p[0],p[1]);
      marqActive=false; setMarquee(null); painted=false; return;
    }
    setMarquee(null);
    setHover(p[0],p[1]);
    const now=performance.now();
    if(hover.b && hover.b.id!==S.coreId && now-lastTapT<320 && hover.b.id===lastTapId){
      recycleSameType(hover.b); lastTapId=-1; painted=false; return;   // double-click → same type nearby
    }
    lastTapT=now; lastTapId=hover.b?hover.b.id:-1;
    if(pt && (ev.pointerType!=='mouse'||ev.button===0))handleTap(ev);   // single recycle
    painted=false; return;
  }
  if(ev.pointerId===panPtr){
    panPtr=-1;
    if(!panning && !painted && pt && (ev.pointerType!=='mouse'||ev.button===0))handleTap(ev);
    panning=false;
  }
  painted=false;
}
function onPointerCancel(ev){
  ptrs.delete(ev.pointerId);
  if(ptrs.size<2)pinch=null;
  if(ev.pointerId===marqPtr){marqPtr=-1;marqActive=false;setMarquee(null);}
  if(ev.pointerId===paintPtr){paintPtr=-1;paintActive=false;painted=false;}
  if(ev.pointerId===panPtr){panPtr=-1;panning=false;}
}
function handleTap(ev){
  const p=canvasPos(ev);
  setHover(p[0],p[1]);
  if(!S || !hover.inside)return;
  const twoTap=ev.pointerType==='touch';
  if(replayMode)return;
  if(S.phase==='placeCore'){
    if(twoTap && (armedCx!==hover.cx||armedCy!==hover.cy)){
      armedCx=hover.cx; armedCy=hover.cy;
      return;
    }
    if(canPlace(S,'core',hover.cx,hover.cy).ok){
      recAct('P','core',hover.cx,hover.cy);
      place(S,'core',hover.cx,hover.cy);
      clearArm();
      if(twoTap){hover.inside=false;hover.b=null;}
      updateInfo(true);
    }else sfx('error');
    return;
  }
  if(S.phase!=='play')return;
  if(delMode){
    if(!hover.b)return;
    if(twoTap && armedB!==hover.b){armedB=hover.b;return;}
    recAct('D',hover.b.id);
    deconstruct(S,hover.b);
    clearArm();
    if(twoTap){hover.inside=false;hover.b=null;}
    return;
  }
  if(selBuild){
    if(twoTap && (armedCx!==hover.cx||armedCy!==hover.cy)){
      armedCx=hover.cx; armedCy=hover.cy;
      return;
    }
    if(canPlace(S,selBuild,hover.cx,hover.cy).ok){
      recAct('P',selBuild,hover.cx,hover.cy);
      place(S,selBuild,hover.cx,hover.cy);
      sfx('done');
      clearArm();
      if(twoTap){hover.inside=false;hover.b=null;}
    }else sfx('error');
    return;
  }
  const tp=terraSel();
  if(tp && !hover.b){
    if(terraPaint(S,tp,hover.cx,hover.cy,terraTarget)){
      recAct('T',tp.id,hover.cx,hover.cy,terraTarget);
      sfx('uiclick');return;
    }
  }
  if(moveSrc && !moveSrc.alive)setMoveSrc(null);
  if(moveSrc && !moveSrc.moving){
    if(hover.b===moveSrc){setMoveSrc(null);clearArm();updateInfo(true);return;}
    if(twoTap && (armedCx!==hover.cx||armedCy!==hover.cy)){
      armedCx=hover.cx; armedCy=hover.cy;
      return;
    }
    if(canPlace(S,moveSrc.type,hover.cx,hover.cy,moveSrc.id).ok){
      recAct('M',moveSrc.id,hover.cx,hover.cy);
      startMove(S,moveSrc,hover.cx,hover.cy);
      sfx('done');
      setMoveSrc(null); clearArm();
      if(twoTap){hover.inside=false;hover.b=null;}
    }else sfx('error');
    updateInfo(true);
    return;
  }
  const prevSel=sel;
  setSel(hover.b||null);
  if(sel && sel===prevSel && MOVABLE[sel.type] && sel.built && !sel.moving)setMoveSrc(sel);
  updateInfo(true);
}
function onWheel(ev){
  ev.preventDefault();
  const s=screenPos(ev);
  zoomAt(ev.deltaY<0?1.15:1/1.15,s[0],s[1]);
}
function onKey(ev){
  const tn=(ev.target&&ev.target.tagName)||'';
  if(/^(INPUT|TEXTAREA|SELECT)$/.test(tn))return;   // don't hijack keys while typing in a field
  const k=ev.key;
  if(k==='?'||(k==='/'&&ev.shiftKey)){if(el.keys)el.keys.classList.toggle('show');return;}
  if(k==='Escape'&&el.keys&&el.keys.classList.contains('show')){el.keys.classList.remove('show');return;}
  if(k===' '){
    ev.preventDefault();
    if(S && S.phase!=='menu')setPaused(!paused);
    return;
  }
  if(k>='0'&&k<='9'){
    const key=BUILD_ORDER[k==='0'?9:parseInt(k,10)-1];
    if(key)selectBuild(key);
    return;
  }
  if(k==='['){setTerraTarget(clamp(terraTarget-1,1,12));updateInfo(true);return;}
  if(k===']'){setTerraTarget(clamp(terraTarget+1,1,12));updateInfo(true);return;}
  const lk=k.toLowerCase();
  if(lk==='x')toggleDel();
  else if(lk==='g')toggleMove();
  else if(k==='Escape')cancelModes();
  else if(lk==='f')setSpeed(speed===1?2:(speed===2?4:(speed===4?8:1)));
  else if(lk==='m')setMuted(!muted);
  else if(lk==='h')el.help.classList.toggle('show');
  else if(lk==='r')toggleRecord();
  else if(lk==='p')cycleSupply();
  else if(lk==='c')selectBuild('cryo');
  else if(lk==='n')selectBuild('sniper');
  else if(lk==='v')selectBuild('strafer');
  else if(lk==='b')selectBuild('shield');
  else if(lk==='k')selectBuild('convert');
  else if(lk==='j')selectBuild('bomber');
  else if(lk==='t'){setShowRanges(!showRanges);sfx('uiclick');}
}

/* supply priority cycle: balanced → weapons-first → build-first */
const SUPPLY_LABEL={balanced:'⇄ BAL',weapons:'⇄ GUNS',build:'⇄ BUILD'};
function cycleSupply(){
  if(!S || S.phase!=='play' || replayMode)return;
  S.supplyMode=S.supplyMode==='balanced'?'weapons':(S.supplyMode==='weapons'?'build':'balanced');
  recAct('S',S.supplyMode);
  el.btnSupply.textContent=SUPPLY_LABEL[S.supplyMode];
  sfx('uiclick');
  msg('Supply priority: '+(S.supplyMode==='balanced'?'BALANCED — fair split.':(S.supplyMode==='weapons'?'WEAPONS FIRST — guns eat before builders.':'BUILD FIRST — construction rush.')),'#9fd0ff');
}

/* clip recording: R starts/stops a webm capture of the canvas (zero deps) */
let recorder=null;
function toggleRecord(){
  if(recorder){recorder.stop();return;}
  if(typeof MediaRecorder==='undefined'||!cv.captureStream){
    msg('Recording not supported in this browser.','#ff8d7a');
    return;
  }
  let chunks=[];
  try{recorder=new MediaRecorder(cv.captureStream(30),{mimeType:'video/webm'});}
  catch(e){
    try{recorder=new MediaRecorder(cv.captureStream(30));}
    catch(e2){recorder=null;msg('Recording not supported.','#ff8d7a');return;}
  }
  recorder.ondataavailable=function(ev){if(ev.data&&ev.data.size)chunks.push(ev.data);};
  recorder.onstop=function(){
    const blob=new Blob(chunks,{type:'video/webm'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='fluxfront-clip.webm';
    a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);},5000);
    recorder=null;
    msg('Clip saved — check your downloads.','#9fe8d8');
  };
  recorder.start();
  msg('● Recording… press R again to stop & save.','#ff8d7a');
}

/* ---------- init & loop ---------- */
function updateUiScale(){
  setUiScale(clamp(W/(cv.clientWidth||W),1,3));
}
function init(){
  setCv(document.getElementById('game'));
  setCtx(cv.getContext('2d'));
  applyMapSize(selSize);                 // sizes the canvas + Flux scratch at the default map
  const mini=document.getElementById('mini');
  if(mini && mini.getContext){
    setMiniCv(mini); setMiniCtx(mini.getContext('2d'));
    mini.addEventListener('pointerdown',onMiniDown);
    mini.addEventListener('pointermove',onMiniMove);
    mini.addEventListener('pointerup',onMiniUp);
    mini.addEventListener('pointercancel',onMiniUp);
  }
  const ids=['banner','menu','end','endTitle','endStats','endRank','btnAgain','help','btnHelpClose','info','buildBar','hudEnergy','hudRate','hudFlux','hudTime','hudThreat','energyFill','threatFill','spd1','spd2','spd4','btnPause','btnMute','btnHelp','btnDel','btnMenu','btnResume','btnSupply','hudSupply','terraBar','tMinus','tPlus','tLevel','forge','fgAe','fgRate','fgSpeed','fgEnergy','fgDmg','btnSandbox','btnCopyRep','btnGhost','btnLoadRep','mFrenzy','mFragile','mOver','btnTakeChal','records','achCount','btnAch','ach','achList','btnAchClose','sMusic','sSfx','sShake','sCb','sBloom','mini','spd8','buildTabs','catLabel','mErode','btnMove','modeRow',
    'btnTutorial','tutCard','tutStepNo','tutTitle','tutBody','tutSkip','tutNext','tutHint',
    'sTips','btnResetTips','tipCard','tipName','tipBody','tipClose',
    'energyBar','alerts','keys','btnKeysClose','btnContinue','contMeta','sFps','fps'];
  for(const id of ids)el[id]=document.getElementById(id);
  // categories live behind icon tabs so the palette stays compact
  VCATS.forEach(function(cat,ci){
    const tab=document.createElement('button');
    tab.className='tab'+(ci===0?' on':''); tab.id='tab_'+ci; tab.title=cat.name;
    if(tab.style.setProperty)tab.style.setProperty('--tc',cat.col||'#4df0c8');
    tab.innerHTML='<span class="ti">'+(cat.icon||'•')+'</span>';
    tab.addEventListener('click',function(){showTab(ci);});
    el.buildTabs.appendChild(tab);
  });
  showTab(0);
  // ---- persistence: load prefs + records, hydrate the menu ----
  loadAll();
  el.sMusic.value=settings.musicVol; el.sSfx.value=settings.sfxVol;
  el.sShake.checked=settings.shake; el.sCb.checked=settings.colorblind;
  if(el.sBloom)el.sBloom.checked=settings.bloom;
  if(el.sTips)el.sTips.checked=settings.tips;
  if(el.sFps)el.sFps.checked=settings.fps;
  if(el.fps)el.fps.classList.toggle('hide',!settings.fps);
  function onSetting(){
    settings.musicVol=parseFloat(el.sMusic.value);
    settings.sfxVol=parseFloat(el.sSfx.value);
    settings.shake=el.sShake.checked;
    settings.colorblind=el.sCb.checked;
    if(el.sBloom)settings.bloom=el.sBloom.checked;
    if(el.sTips)settings.tips=el.sTips.checked;
    if(el.sFps){settings.fps=el.sFps.checked;if(el.fps)el.fps.classList.toggle('hide',!settings.fps);}
    applyVolumes(); saveSettings();
  }
  el.sMusic.addEventListener('input',function(){initAudio();onSetting();});
  el.sSfx.addEventListener('input',function(){initAudio();onSetting();});
  el.sShake.addEventListener('change',onSetting);
  el.sCb.addEventListener('change',onSetting);
  if(el.sBloom)el.sBloom.addEventListener('change',onSetting);
  if(el.sTips)el.sTips.addEventListener('change',onSetting);
  if(el.tipClose)el.tipClose.addEventListener('click',hideTip);
  if(el.btnResetTips)el.btnResetTips.addEventListener('click',function(ev){
    ev.preventDefault();
    resetTips(); sfx('uiclick');
    if(el.sTips&&!el.sTips.checked){el.sTips.checked=true;settings.tips=true;saveSettings();}
    msg('Structure tips reset — they’ll show again as you build.','#a9c2ff');
  });
  const DIFF_KEYS=['easy','normal','hard','insane'];
  function refreshMenuMeta(){
    const parts=[];
    for(const k of DIFF_KEYS){const t=bestTime(k);if(t!==undefined)parts.push(DIFFS[k].name+' '+fmtT(t));}
    el.records.textContent=parts.length?('Best: '+parts.join(' · ')):'No records yet — win a sector.';
    el.achCount.textContent=achCount()+' / '+ACHIEVEMENTS.length;
  }
  refreshMenuMeta();
  refreshContinue();
  if(typeof window!=='undefined')window.addEventListener('beforeunload',autoSave);
  el.btnAch.addEventListener('click',function(){
    el.achList.innerHTML=ACHIEVEMENTS.map(function(a){
      const got=hasAch(a.id);
      return '<div class="achItem '+(got?'got':'locked')+'"><span class="an">'+(got?'◈ ':'')+a.name+'</span><span class="ad">'+a.desc+'</span></div>';
    }).join('');
    el.ach.classList.add('show');
  });
  el.btnAchClose.addEventListener('click',function(){el.ach.classList.remove('show');});

  function readMods(){
    return {erosion:el.mErode.checked,frenzy:el.mFrenzy.checked,fragile:el.mFragile.checked,overclock:el.mOver.checked};
  }
  // map-size selector
  const szbs=document.querySelectorAll?document.querySelectorAll('.szb'):[];
  [].forEach.call(szbs,function(b){
    b.addEventListener('click',function(){
      selSize=parseInt(b.getAttribute('data-sz'),10)||0;
      [].forEach.call(szbs,function(o){o.classList.toggle('on',o===b);});
    });
  });
  function diffStart(dk){return function(){initAudio();challengeTarget=null;startGame(dk,undefined,{mods:readMods()});};}
  if(el.btnTutorial)el.btnTutorial.addEventListener('click',function(){
    initAudio(); challengeTarget=null;
    startGame('easy',TUT_SEED,{mods:{},sizeIdx:0,tutorial:true});   // small fixed map, gentle pressure
    msg('First Mission — follow the coaching card. You can SKIP anytime.','#9fd0ff');
  });
  if(el.tutSkip)el.tutSkip.addEventListener('click',endTutorial);
  if(el.tutNext)el.tutNext.addEventListener('click',tutAdvance);
  document.getElementById('diff_easy').addEventListener('click',diffStart('easy'));
  document.getElementById('diff_normal').addEventListener('click',diffStart('normal'));
  document.getElementById('diff_hard').addEventListener('click',diffStart('hard'));
  document.getElementById('diff_insane').addEventListener('click',diffStart('insane'));
  document.getElementById('diff_daily').addEventListener('click',function(){
    initAudio();
    const d=new Date();
    const key=d.toISOString().slice(0,10);
    let n=(d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate())|0;
    n=Math.imul(n^(n>>>15),2246822519); n=Math.imul(n^(n>>>13),3266489917);
    startGame('normal',(n^(n>>>16))|0,{mods:readMods(),daily:true,dailyKey:key,sizeIdx:2});  // shared size
    msg('Daily Sector '+key+' — same map for everyone today.','#7fd9ff');
  });
  el.btnTakeChal.addEventListener('click',function(){
    const s=prompt('Paste a challenge / replay code to play that exact map:');
    if(!s)return;
    try{
      const d=decodeRun(s);
      initAudio();
      startGame(d.d,d.s,{mods:d.m||{},sizeIdx:(d.sz!==undefined?d.sz:2),challenge:(d.time!==undefined?{time:d.time,won:!!d.won}:null)});
      el.menu.classList.remove('show');
      msg(challengeTarget?('CHALLENGE — beat '+fmtT(challengeTarget.time)+(challengeTarget.won?'':' (they lost — just win)')):'Playing shared map.','#ffd86b');
    }catch(e){msg('Bad code.','#ff8d7a');}
  });
  document.getElementById('bl_daily').textContent='One shared NORMAL map per day. Compare times with friends.';
  el.btnSandbox.addEventListener('click',function(){
    initAudio();
    startGame('easy',undefined,{mods:{},sandbox:true});
    msg('SANDBOX — infinite energy. Sculpt, flood, play.','#9fe8d8');
  });
  el.btnCopyRep.addEventListener('click',function(){
    if(!lastRun){msg('Finish a run first.','#ff8d7a');return;}
    const code=encodeRun(lastRun);
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(code);
      msg('Challenge code copied — send it. They play your exact map.','#9fe8d8');
    }else prompt('Copy your challenge code:',code);
  });
  el.btnGhost.addEventListener('click',function(){
    if(!lastRun){msg('Finish a run first.','#ff8d7a');return;}
    const g=lastRun;
    startGame(g.d,g.s,{mods:g.m,sizeIdx:(g.sz!==undefined?g.sz:2)});
    setGhost(g.a.filter(a=>a[1]==='P'));
    el.end.classList.remove('show');
    msg('GHOST RACE — beat your last run. Its builds appear as blue outlines.','#7fd9ff');
  });
  el.btnLoadRep.addEventListener('click',function(){
    const s=prompt('Paste a replay code:');
    if(!s)return;
    try{
      const d=decodeRun(s);
      startGame(d.d,d.s,{mods:d.m||{},sizeIdx:(d.sz!==undefined?d.sz:2)});
      setReplayMode(true);
      replayQ={a:d.a,i:0};
      rec=null;
      msg('REPLAY — watching. Speed keys work; input is locked.','#7fd9ff');
    }catch(e){msg('Bad replay code.','#ff8d7a');}
  });
  el.fgRate.addEventListener('click',function(){if(S&&!replayMode&&forgeBuy(S,'rate'))recAct('F','rate');});
  el.fgSpeed.addEventListener('click',function(){if(S&&!replayMode&&forgeBuy(S,'speed'))recAct('F','speed');});
  el.fgEnergy.addEventListener('click',function(){if(S&&!replayMode&&forgeBuy(S,'energy'))recAct('F','energy');});
  el.fgDmg.addEventListener('click',function(){if(S&&!replayMode&&forgeBuy(S,'dmg'))recAct('F','dmg');});
  document.getElementById('bl_easy').textContent=DIFFS.easy.blurb;
  document.getElementById('bl_normal').textContent=DIFFS.normal.blurb;
  document.getElementById('bl_hard').textContent=DIFFS.hard.blurb;
  document.getElementById('bl_insane').textContent=DIFFS.insane.blurb;
  if(el.btnContinue)el.btnContinue.addEventListener('click',function(){resumeGame();});
  el.btnAgain.addEventListener('click',function(){
    el.end.classList.remove('show');
    el.menu.classList.add('show');
    el.btnResume.classList.add('hide');
    refreshMenuMeta(); refreshContinue();
    setS(null); banner(false); updateInfo(true);
  });
  el.btnMenu.addEventListener('click',function(){
    if(!S || S.phase==='menu')return;
    sfx('uiclick');
    setPaused(true);
    autoSave(); refreshContinue();          // opening the menu mid-game banks your progress
    el.btnResume.classList.remove('hide');
    el.menu.classList.add('show');
  });
  el.btnSupply.addEventListener('click',function(){cycleSupply();});
  el.btnResume.addEventListener('click',function(){
    sfx('uiclick');
    el.menu.classList.remove('show');
    el.btnResume.classList.add('hide');
    setPaused(false);
  });
  el.btnHelp.addEventListener('click',function(){el.help.classList.toggle('show');});
  el.btnHelpClose.addEventListener('click',function(){el.help.classList.remove('show');});
  if(el.btnKeysClose)el.btnKeysClose.addEventListener('click',function(){el.keys.classList.remove('show');});
  if(el.keys)el.keys.addEventListener('click',function(ev){if(ev.target===el.keys)el.keys.classList.remove('show');});
  // selected-structure panel buttons (recycle / relocate) via event delegation
  if(el.info)el.info.addEventListener('click',function(ev){
    const t=ev.target, act=t&&t.getAttribute&&t.getAttribute('data-act');
    if(!act||!S||S.phase!=='play'||replayMode||!sel||!sel.alive)return;
    if(act==='recycle'){
      if(sel.type==='core'||sel.moving)return;
      recAct('D',sel.id); deconstruct(S,sel); setSel(null); sfx('uiclick'); updateInfo(true);
    }else if(act==='move'&&MOVABLE[sel.type]&&sel.built&&!sel.moving){
      setMoveSrc(sel); sfx('uiclick'); updateInfo(true);
    }
  });
  el.btnPause.addEventListener('click',function(){if(S&&S.phase!=='menu')setPaused(!paused);});
  el.btnMute.addEventListener('click',function(){initAudio();setMuted(!muted);});
  el.spd1.addEventListener('click',function(){setSpeed(1);});
  el.spd2.addEventListener('click',function(){setSpeed(2);});
  el.spd4.addEventListener('click',function(){setSpeed(4);});
  el.spd8.addEventListener('click',function(){setSpeed(8);});
  el.btnDel.addEventListener('click',function(){toggleDel();});
  el.btnMove.addEventListener('click',function(){toggleMove();});
  el.tMinus.addEventListener('click',function(){setTerraTarget(clamp(terraTarget-1,1,12));el.tLevel.textContent='L'+terraTarget;sfx('uiclick');updateInfo(true);});
  el.tPlus.addEventListener('click',function(){setTerraTarget(clamp(terraTarget+1,1,12));el.tLevel.textContent='L'+terraTarget;sfx('uiclick');updateInfo(true);});
  cv.addEventListener('pointerdown',onPointerDown);
  cv.addEventListener('pointermove',onPointerMove);
  cv.addEventListener('pointerup',onPointerUp);
  cv.addEventListener('pointercancel',onPointerCancel);
  cv.addEventListener('pointerleave',function(ev){
    if(ev.pointerType!=='touch'){hover.inside=false;hover.b=null;}
  });
  cv.addEventListener('wheel',onWheel,{passive:false});
  cv.addEventListener('contextmenu',function(ev){ev.preventDefault();});
  // suppress the browser right-click menu everywhere in the game (panel etc.)
  window.addEventListener('contextmenu',function(ev){ev.preventDefault();});
  window.addEventListener('keydown',onKey);
  window.addEventListener('resize',updateUiScale);
  window.addEventListener('orientationchange',updateUiScale);
  setMuted(false); setSpeed(1); setPaused(false);
  updateInfo(true);
  requestAnimationFrame(frame);
}
let fpsAcc=0, fpsN=0, fpsLast=0, fpsPrev=0;
function drawFps(now){               // rolling FPS readout — lets you measure perf on big maps
  if(!el.fps||!settings.fps)return;
  const dt=now-fpsPrev; fpsPrev=now;
  if(dt>0&&dt<1000){fpsAcc+=dt;fpsN++;}
  if(now-fpsLast>500){
    const fps=fpsN?Math.round(1000/(fpsAcc/fpsN)):0;
    el.fps.textContent=fps+' fps';
    if(el.fps.classList)el.fps.classList.toggle('bad',fps<45);
    fpsAcc=0; fpsN=0; fpsLast=now;
  }
}
let lastFrame=performance.now(), acc=0, lastSave=0;
function frame(now){
  requestAnimationFrame(frame);
  let dt=(now-lastFrame)/1000;
  lastFrame=now;
  if(dt>0.25)dt=0.25;
  if(S && !paused && S.phase!=='menu'){
    acc+=dt*speed;
    let n=0;
    const cap=speed>=8?24:12;                 // allow 8× to run more sim ticks per frame
    while(acc>=TICK && n<cap){pumpReplay();tick();acc-=TICK;n++;}
    if(n>=cap)acc=0;
    if(now-lastSave>8000){lastSave=now;autoSave();}   // periodic resume checkpoint
  }
  render();
  if(S&&S.tut)tutCheck();
  else if(el.tutCard&&!el.tutCard.classList.contains('hide'))el.tutCard.classList.add('hide');
  drawFps(now);
}
window.addEventListener('load',init);
