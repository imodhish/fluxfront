/* ============================================================
   FLUXFRONT — energy pool, packet dispatch & delivery
   ============================================================ */

import {TICK,TYPES,PACKET_SPEED,idx} from './constants.js';
import {pathTo} from './net.js';
import {applyTerraStep} from './sim.js';
import {msg} from './render.js';
import {sfx} from './audio.js';

export function tickEnergy(st){
  let prod=0, cap=0, pylons=0;
  for(const b of st.buildings){
    if(!b.alive || !b.built || !b.conn)continue;
    const T=TYPES[b.type];
    if(b.type==='pylon')pylons++;
    let p=T.prod||0;
    if(b.type==='collector')p=0.003*b.cov;         // field economy: income per covered cell
    if(b.pz)p*=(b.type==='reactor'?6:(b.type==='collector'?3:1));
    prod+=p;
    if(T.cap)cap+=T.cap*(b.pz&&b.type==='battery'?3:1);
  }
  st.pylonSpeed=Math.min(0.6,0.05*pylons);          // each connected Pylon speeds packets
  prod+=st.buffs.prod;                              // relic/forge bonus
  if(st.mods.overclock)prod*=1.5;                   // OVERCLOCK mutator
  st.prod=prod; st.cap=cap;
  if(st.sandbox){st.cap=999;st.energy=999;st.prod=99;}
  st.energy=Math.min(cap,st.energy+prod*TICK);
  st.dispT+=TICK;
  while(st.dispT>=0.1){
    st.dispT-=0.1;
    // logistics scale with reserves: a healthy stockpile ships up to 4
    // packets per window instead of 1, so big bases don't bottleneck
    const burst=1+Math.min(3,Math.floor(st.energy/20));
    for(let i=0;i<burst;i++)dispatchPacket(st);
  }
  st.spend.t+=TICK;
  if(st.spend.t>=1){st.spend.rate=st.spend.acc/st.spend.t;st.spend.acc=0;st.spend.t=0;}
}
export function needOf(st,b){
  if(!b.alive || !b.conn)return null;
  const T=TYPES[b.type];
  if(!b.built){
    if(b.buildGot+b.pend<T.cost)return 'build';
    return null;
  }
  if(b.type==='terra'){
    let steps=0;
    for(const j of b.tjobs)steps+=Math.abs(st.ter[idx(j.x,j.y)]-j.t);
    if(steps>0 && b.pend<Math.min(4,steps))return 'terra';
    return null;
  }
  if((b.type==='nullifier' && !b.fired && !b.firing) || (b.type==='convert' && !b.fired)){
    if(b.charge+b.pend<T.charge)return 'charge';
    return null;
  }
  if(T.ammoMax!==undefined && (b.ammo+b.pend*T.ammoPer)<T.ammoMax-0.001)return 'ammo';
  return null;
}
/* supply priority: 'balanced' alternates construction/ammo fairly so
   weapons keep firing while you build; 'weapons'/'build' force an order */
export function dispatchPacket(st){
  if(st.energy<1)return;
  const arr=st.buildings, n=arr.length;
  if(!n)return;
  let ammoFirst;
  if(st.supplyMode==='weapons')ammoFirst=true;
  else if(st.supplyMode==='build')ammoFirst=false;
  else{st.dispFlip=!st.dispFlip; ammoFirst=st.dispFlip;}
  for(let pass=0;pass<2;pass++){
    const wantAmmo=(pass===0)===ammoFirst;
    for(let k=0;k<n;k++){
      st.rr=(st.rr+1)%n;
      const b=arr[st.rr];
      const need=needOf(st,b);
      if(!need)continue;
      if((need==='ammo')!==wantAmmo)continue;
      const path=pathTo(st,b);
      if(!path || path.length<2)continue;
      st.energy-=1; st.spend.acc+=1; st.stats.packets++;
      b.pend++;
      st.packets.push({tid:b.id,kind:need,path:path,seg:0,x:path[0][0],y:path[0][1],arrived:false});
      return;
    }
  }
}
export function tickPackets(st){
  const sp=PACKET_SPEED*(1+st.buffs.pspeed+(st.pylonSpeed||0))*TICK;
  for(const p of st.packets){
    const tgt=st.byId.get(p.tid);
    if(!tgt || !tgt.alive){
      p.dead=true;
      st.energy=Math.min(st.cap||40,st.energy+1);
      if(tgt)tgt.pend=Math.max(0,tgt.pend-1);
      continue;
    }
    let move=sp;
    while(move>0 && !p.arrived){
      if(p.seg>=p.path.length-1){p.arrived=true;break;}
      const a=p.path[p.seg], b=p.path[p.seg+1];
      const dx=b[0]-p.x, dy=b[1]-p.y;
      const d=Math.hypot(dx,dy);
      if(d<0.0001){p.seg++;continue;}
      if(move>=d){p.x=b[0];p.y=b[1];p.seg++;move-=d;}
      else{p.x+=dx/d*move;p.y+=dy/d*move;move=0;}
    }
    if(p.arrived){
      p.dead=true;
      tgt.pend=Math.max(0,tgt.pend-1);
      deliver(st,tgt,p.kind);
    }
  }
  st.packets=st.packets.filter(p=>!p.dead);
}
export function deliver(st,b,kind){
  const T=TYPES[b.type];
  if(kind==='build'){
    b.buildGot++;
    if(b.buildGot>=T.cost && !b.built){
      b.built=true; b.hp=b.hpMax;
      st.stats.built++;
      msg(T.name+' online.','#9fe8d8');
      sfx('done',b.px);
      if(T.backbone)st.netDirty=true;
    }
  }else if(kind==='ammo'){
    b.ammo=Math.min(T.ammoMax,b.ammo+T.ammoPer);
  }else if(kind==='charge'){
    b.charge++;
  }else if(kind==='terra'){
    applyTerraStep(st,b);
  }
}
