/* ============================================================
   FLUXFRONT — local persistence (settings, records, achievements)
   This is the one module that touches localStorage — a deliberate
   exception to the otherwise storage-free design, for the retention
   layer. It NEVER feeds the sim (determinism is unaffected); it only
   stores player prefs and post-game stats. Fails silently if storage
   is unavailable (private mode, file://, etc).
   ============================================================ */

import {settings} from './state.js';

const KEY='fluxfront.v1';
let DB={settings:{},records:{},daily:{},ach:{},tips:{}};

function safeGet(){
  try{const s=localStorage.getItem(KEY);return s?JSON.parse(s):null;}catch(e){return null;}
}
function safePut(){
  try{localStorage.setItem(KEY,JSON.stringify(DB));}catch(e){}
}

/* ---------- achievements catalogue ---------- */
export const ACHIEVEMENTS=[
  {id:'firstwin', name:'Sector Secured',      desc:'Win your first map.'},
  {id:'flawless', name:'Not One Scratch',     desc:'Win without losing a single structure.'},
  {id:'speed',    name:'Blitz',               desc:'Win in under 5 minutes.'},
  {id:'insane',   name:'Against All Odds',    desc:'Win on INSANE.'},
  {id:'frostbite',name:'Deep Freeze',         desc:'Freeze 1000 Flux with Cryo Towers.'},
  {id:'sculptor', name:'Terraformer',         desc:'Reshape 300 cells with Terps.'},
  {id:'relic3',   name:'Archaeologist',       desc:'Claim all 3 relics in one game.'},
  {id:'pzlord',   name:'Power Broker',        desc:'Hold 5 Power-Zoned structures at once.'},
  {id:'daily',    name:'Daily Driver',        desc:'Complete a Daily Challenge.'},
  {id:'mutant',   name:'Glutton for Punishment', desc:'Win with 2+ mutators active.'}
];

export function loadAll(){
  const d=safeGet();
  if(d){
    DB=Object.assign({settings:{},records:{},daily:{},ach:{},tips:{}},d);
    Object.assign(settings,DB.settings||{});
  }
  return DB;
}
export function saveSettings(){
  DB.settings={musicVol:settings.musicVol,sfxVol:settings.sfxVol,shake:settings.shake,colorblind:settings.colorblind,bloom:settings.bloom,tips:settings.tips};
  safePut();
}
/* one-time structure tips: remember which build types the player has met */
export function tipSeen(t){return !!(DB.tips&&DB.tips[t]);}
export function markTipSeen(t){if(!DB.tips)DB.tips={};if(!DB.tips[t]){DB.tips[t]=1;safePut();}}
export function resetTips(){DB.tips={};safePut();}
/* record a finished game; returns {best:bool, newAch:[ids]} */
export function recordResult(r){
  const out={best:false,newAch:[]};
  if(r.won){
    const cur=DB.records[r.diff];
    if(cur===undefined || r.time<cur){DB.records[r.diff]=r.time;out.best=true;}
    if(r.daily){
      const k=r.dailyKey;
      if(!DB.daily[k] || r.time<DB.daily[k])DB.daily[k]=r.time;
    }
  }
  for(const id of r.unlock||[]){
    if(!DB.ach[id]){DB.ach[id]=1;out.newAch.push(id);}
  }
  safePut();
  return out;
}
export function bestTime(diff){return DB.records[diff];}
export function hasAch(id){return !!DB.ach[id];}
export function achCount(){let n=0;for(const a of ACHIEVEMENTS)if(DB.ach[a.id])n++;return n;}
export function dailyHistory(){return DB.daily;}
