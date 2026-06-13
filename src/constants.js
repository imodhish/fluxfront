/* ============================================================
   FLUXFRONT — constants, structure stats & small utilities
   ============================================================ */

export let COLS=160, ROWS=100;
export const CELL=10;
export let W=COLS*CELL, H=ROWS*CELL;
// selectable map sizes (all 1.6 aspect so the canvas/UI proportions hold)
export const MAP_SIZES=[
  {label:'S',    cols:96,  rows:60},
  {label:'M',    cols:128, rows:80},
  {label:'L',    cols:160, rows:100},
  {label:'XL',   cols:208, rows:130},
  {label:'HUGE', cols:256, rows:160}
];
export function setMapSize(c,r){COLS=c;ROWS=r;W=c*CELL;H=r*CELL;}
export const TICK=1/30;
export const FLOW=0.25, CREEP_MAX=50, TER_H=3.0;
export const PACKET_SPEED=170;

export const TYPES={
  core:     {name:'Command Core', sz:3, hp:90, cost:0,  linkR:9,   prod:1.4, cap:40, backbone:true, icon:'⬡', desc:'Network heart. +1.4 e/s, 40 storage. If it falls, you lose.'},
  collector:{name:'Collector',    sz:1, hp:14, cost:5,  linkR:6.5, prod:0.3,         backbone:true, icon:'◇', desc:'Earns energy from the ground it claims (up to ≈0.4 e/s) — spread them out, fields don\'t stack.'},
  relay:    {name:'Relay',        sz:1, hp:14, cost:10, linkR:14,                    backbone:true, icon:'△', desc:'Long-range network link. No power, big reach.'},
  reactor:  {name:'Reactor',      sz:2, hp:20, cost:20, prod:0.8,                                   icon:'▣', desc:'+0.8 e/s. Dense power for a hungry front line.'},
  battery:  {name:'Battery',      sz:1, hp:14, cost:8,  cap:25,                                     icon:'▥', desc:'+25 energy storage. Buffer for big pushes.'},
  terra:    {name:'Terp',         sz:1, hp:16, cost:20, workR:8,                                    icon:'⌗', desc:'Select it, then paint target ground levels in range. Raises and lowers — 1 packet per level step.'},
  cannon:   {name:'Pulse Cannon', sz:1, hp:18, cost:15, range:7.5, ammoMax:30, ammoPer:4, shotCd:0.22, shotCost:1, icon:'◉', desc:'Rapid fire. Mows shallow Flux near the wire.'},
  mortar:   {name:'Mortar',       sz:2, hp:22, cost:25, range:13,  ammoMax:12, ammoPer:2, shotCd:2.6,  shotCost:3, icon:'◎', desc:'Lobs shells into deep Flux pools at long range.'},
  beam:     {name:'Beam',         sz:1, hp:16, cost:18, range:11,  ammoMax:10, ammoPer:2,             icon:'✦', desc:'Anti-air laser. Zaps incoming Spores out of the sky. 1 ammo per spore.'},
  sprayer:  {name:'Sprayer',      sz:1, hp:16, cost:16, range:4.5, ammoMax:20, ammoPer:2,             icon:'✺', desc:'Converts packets into Anti-Flux and blankets nearby ground when the Flux closes in.'},
  nullifier:{name:'Nullifier',    sz:2, hp:24, cost:30, range:7,   charge:20,                        icon:'✛', desc:'Charges 20 packets, then erases every Emitter or Spore Tower in range. Single use.'},
  cryo:     {name:'Cryo Tower',   sz:1, hp:16, cost:22, range:5,   ammoMax:6, ammoPer:2,             icon:'❄', desc:'Flash-freezes Flux in range into raised ice ground for 25 s. Bridge basins, buy time. (C)'},
  sniper:   {name:'Sniper',       sz:1, hp:14, cost:14, range:14,  ammoMax:8, ammoPer:2, shotCd:1.5, icon:'⌖', desc:'Long-range anti-Runner rifle. One shot, one kill. (N)'},
  strafer:  {name:'Strafer',      sz:2, hp:20, cost:35, ammoMax:12, ammoPer:2,                       icon:'✈', desc:'Air pad. Its aircraft sorties to the deepest Flux nearby, strafes it, returns to re-arm. (V)'},
  shield:   {name:'Shield',       sz:1, hp:18, cost:24, range:5.5,                                   icon:'⛨', desc:'Pushes Flux away while powered (1.5 e/s). Cover a Nullifier build or hold a pass. (B)'},
  convert:  {name:'Converter',    sz:2, hp:26, cost:40, range:6, charge:40,                          icon:'⟲', desc:'Charges 40 packets, then CAPTURES an Emitter in range — it pumps Anti-Flux for you forever. (K)'},
  bomber:   {name:'Bomber',       sz:2, hp:20, cost:32, ammoMax:12, ammoPer:2,                       icon:'➤', desc:'Air pad. Its bomber carpets the deepest Flux nearby with Anti-Flux, then re-arms. (J)'},
  pylon:    {name:'Pylon',        sz:1, hp:14, cost:12, linkR:18,                  backbone:true,     icon:'╪', desc:'Long tether backbone. Packets crossing the network move faster the more Pylons carry them.'},
  harvester:{name:'Harvester',    sz:1, hp:18, cost:18,                                               icon:'⛏', desc:'Place on an Aether Node to mine +0.08 aether/s straight into the Forge. A second tech source.'},
  guppy:    {name:'Guppy Pad',    sz:2, hp:18, cost:28, linkR:22,                  backbone:true,     icon:'⬓', desc:'Air-ferries construction packets to disconnected outposts in range — leapfrog the grid across floods.'},
  sensor:   {name:'Sensor Tower', sz:1, hp:14, cost:12, range:30,                                     icon:'◈', desc:'Reveals Spores & Runners early and paints lead-markers on the tactical map. Cheap eyes.'},
  repair:   {name:'Repair Bay',   sz:1, hp:16, cost:16, range:7,                                      icon:'✚', desc:'Mends nearby damaged structures +1.2 hp/s while powered — hold a battered line instead of recycling.'},
  resonator:{name:'Resonator',    sz:1, hp:14, cost:14, range:2.5,                                    icon:'⊛', desc:'Overcharges adjacent weapons: +40% fire rate & range. But it draws Spores — a juicy target.'},
  siphon:   {name:'Siphon',       sz:1, hp:14, cost:16,                                               icon:'⤓', desc:'Plant ON deep Flux to drain it into energy (up to +0.6 e/s). Fragile and exposed — pure risk.'},
  inhibitor:{name:'Inhibitor',    sz:1, hp:16, cost:18, range:4.5,                                    icon:'⊘', desc:'Projects a field that slows Flux flow to a crawl in range (1 e/s) — freeze a choke without pushing.'}
};
export const BUILD_ORDER=['collector','relay','reactor','battery','terra','cannon','mortar','beam','sprayer','nullifier','cryo','sniper','strafer','shield','convert','bomber','pylon','harvester','guppy','sensor','repair','resonator','siphon','inhibitor'];
// display grouping for the build palette (keys not in TYPES are skipped)
export const CATEGORIES=[
  {name:'ECONOMY',   icon:'⚡', col:'#74e6a8', keys:['collector','relay','reactor','battery','pylon','harvester','guppy']},
  {name:'UTILITY',   icon:'⌗', col:'#ffd86b', keys:['terra','sensor','repair','resonator','siphon']},
  {name:'DEFENSE',   icon:'◎', col:'#ff9d5c', keys:['cannon','mortar','beam','sniper','shield','inhibitor']},
  {name:'ANTI-FLUX', icon:'✺', col:'#9ffce4', keys:['sprayer','cryo','strafer','bomber']},
  {name:'ASSAULT',   icon:'✛', col:'#cfb6ff', keys:['nullifier','convert']}
];
export const DIFFS={
  easy:  {key:'easy',  name:'EASY',   emitters:5, amt:2.4, grow:900,  spores:1, blurb:'5 Emitters, gentle growth. Learn the ropes.'},
  normal:{key:'normal',name:'NORMAL', emitters:8, amt:3.2, grow:650,  spores:2, blurb:'8 Emitters, steady growth. The intended fight.'},
  hard:  {key:'hard',  name:'HARD',   emitters:11, amt:4.0, grow:480, spores:3, blurb:'11 Emitters, relentless growth. Good luck.'},
  insane:{key:'insane',name:'INSANE', emitters:14, amt:4.8, grow:360, spores:5, blurb:'14 Emitters, explosive growth. Everything wants you dead.'}
};

/* ---------- utils ---------- */
export function mulberry32(a){
  function r(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}
  r.state=function(){return a|0;};          // expose state so the whole sim can be snapshotted (Tactical Rewind)
  r.setState=function(v){a=v|0;};
  return r;
}
export const idx=(x,y)=>y*COLS+x;
export const inB=(x,y)=>x>=0&&y>=0&&x<COLS&&y<ROWS;
export const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
export const lerp=(a,b,t)=>a+(b-a)*t;
export const dist=(ax,ay,bx,by)=>Math.hypot(ax-bx,ay-by);
export function fmtT(s){s=Math.floor(s);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
