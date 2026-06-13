/* ============================================================
   FLUXFRONT — simulation: Flux fluid, combat, placement,
   win/lose, FX and the master tick
   ============================================================ */

import {COLS,ROWS,CELL,TICK,FLOW,CREEP_MAX,TER_H,TYPES,idx,inB,clamp,dist} from './constants.js';
import {S,sel,hover,shake,moveSrc,setSel,setSelBuild,setDelMode,setShake,setMoveSrc} from './state.js';
import {recomputeNet} from './net.js';
import {retileTerrain,carveBasin,TER_LEVELS} from './world.js';
import {tickEnergy,tickPackets} from './economy.js';
import {banner,refreshButtons,showEnd} from './ui.js';
import {msg} from './render.js';
import {sfx} from './audio.js';

/* ---------- fluid simulation (Flux + Anti-Flux share the physics) ----------
   slow: optional per-cell outflow multiplier (Inhibitor field) — null = none */
function flowPass(c,bf,ter,slow){
  bf.set(c);
  for(let y=0;y<ROWS;y++){
    const up=y>0, dn=y<ROWS-1;
    for(let x=0;x<COLS;x++){
      const i=y*COLS+x;
      const v=c[i];
      if(v<=0.001)continue;
      const F=slow?FLOW*slow[i]:FLOW;
      const myH=ter[i]*TER_H+v;
      let f0=0,f1=0,f2=0,f3=0,tot=0;
      if(x>0){ const j=i-1; const d=myH-(ter[j]*TER_H+c[j]); if(d>0){f0=d*F;tot+=f0;} }
      if(x<COLS-1){ const j=i+1; const d=myH-(ter[j]*TER_H+c[j]); if(d>0){f1=d*F;tot+=f1;} }
      if(up){ const j=i-COLS; const d=myH-(ter[j]*TER_H+c[j]); if(d>0){f2=d*F;tot+=f2;} }
      if(dn){ const j=i+COLS; const d=myH-(ter[j]*TER_H+c[j]); if(d>0){f3=d*F;tot+=f3;} }
      if(tot<=0)continue;
      const mx=v*0.9;
      const k=tot>mx?(mx/tot):1;
      if(f0)bf[i-1]+=f0*k;
      if(f1)bf[i+1]+=f1*k;
      if(f2)bf[i-COLS]+=f2*k;
      if(f3)bf[i+COLS]+=f3*k;
      bf[i]-=tot*k;
    }
  }
}
export function simCreeper(st){
  flowPass(st.creep,st.buf,st.ter,st._slowAny?st.slow:null);
  // barely any evaporation: the Flux keeps expanding for the whole game
  // and only recedes once every emitter is dead
  const allDead=st.emitters.length>0 && st.emitters.every(e=>!e.alive);
  const dec=allDead?0.02:0;
  const bf=st.buf;
  for(let i=0;i<bf.length;i++){
    let v=bf[i];
    if(v<=0){bf[i]=0;continue;}
    v*=0.9998; v-=0.0004+dec;
    bf[i]=v<0.0005?0:(v>CREEP_MAX?CREEP_MAX:v);
  }
  const t0=st.creep; st.creep=bf; st.buf=t0;
  if(st._antiAny){
    flowPass(st.anti,st.antiBuf,st.ter);
    const t1=st.anti; st.anti=st.antiBuf; st.antiBuf=t1;
    // annihilation + Anti-Flux decay (it fades faster than Flux)
    const cr=st.creep, an=st.anti;
    let any=false;
    for(let i=0;i<an.length;i++){
      let a=an[i];
      if(a<=0){an[i]=0;continue;}
      const v=cr[i];
      if(v>0){const k=v<a?v:a; cr[i]=v-k; a-=k; st.stats.flux+=k;}
      a*=0.999; a-=0.001;
      an[i]=a<0.0005?0:(a>CREEP_MAX?CREEP_MAX:a);
      if(an[i]>0)any=true;
    }
    st._antiAny=any;
  }
}

export function tickEmitters(st){
  const surge=st.surge.active?2.5:1;
  for(const e of st.emitters){
    if(e.captured){                              // captured: pumps friendly Anti-Flux
      e.t+=TICK;
      if(e.t>=0.7){
        e.t-=0.7;
        const i=idx(e.cx,e.cy);
        st.anti[i]=Math.min(CREEP_MAX,st.anti[i]+st.diff.amt*0.8);
        st._antiAny=true;
      }
      continue;
    }
    if(!e.alive)continue;
    e.t+=TICK;
    if(e.t>=0.7){
      e.t-=0.7;
      const warm=clamp(st.t/25,0.3,1);
      const growth=1+st.t/st.diff.grow;
      const i=idx(e.cx,e.cy);
      st.creep[i]=Math.min(CREEP_MAX,st.creep[i]+st.diff.amt*e.str*warm*growth*surge);
    }
  }
}

/* surge tides: periodic map-wide emitter frenzy, announced 8 s ahead
   (the music swells with it — see updateHUD's intensity feed) */
export function tickSurge(st){
  const sg=st.surge;
  if(!sg.warned && st.t>=sg.next-8){
    sg.warned=true;
    msg('◈ OPS: Surge building in the Flux network. Brace.','#ff9d5c');
    sfx('alarm');
  }
  if(!sg.active && st.t>=sg.next){
    sg.active=true; sg.end=st.t+8;
    msg('FLUX SURGE!','#ff6e6e');
    setShake(Math.max(shake,5));
    sfx('nullify');
  }
  if(sg.active && st.t>=sg.end){
    sg.active=false; sg.warned=false;
    sg.next=st.t+(st.mods.frenzy?35:75)+st.rng()*(st.mods.frenzy?25:60);
    msg('◈ OPS: Surge subsiding. Hold positions.','#9fe8d8');
  }
}

/* weather: a Flux-rain squall that lightly coats the whole map for 10 s,
   announced 8 s ahead (music swells like a surge) */
export function tickWeather(st){
  const w=st.weather;
  if(!w.warned && st.t>=w.next-8){
    w.warned=true;
    msg('◈ OPS: Atmospheric Flux squall inbound. It will fall everywhere.','#9fd0ff');
    sfx('alarm');
  }
  if(!w.active && st.t>=w.next){
    w.active=true; w.end=st.t+10;
    msg('◈ FLUX RAIN — shelter the front line.','#7fd9ff');
  }
  if(w.active){
    // scatter shallow Flux deterministically via st.rng (≈40 drops/tick)
    for(let k=0;k<40;k++){
      const x=(st.rng()*COLS)|0, y=(st.rng()*ROWS)|0;
      const i=idx(x,y);
      if(st.creep[i]<6)st.creep[i]+=0.5;
    }
    if(st.t>=w.end){
      w.active=false; w.warned=false;
      w.next=st.t+150+st.rng()*100;
      msg('◈ OPS: Squall passing.','#9fe8d8');
    }
  }
}
/* Inhibitors: project a field that throttles Flux outflow to a crawl in
   range (drains 1 e/s while powered). Builds st.slow for flowPass. */
export function tickInhibitors(st){
  let any=false;
  for(const b of st.buildings)if(b.type==='inhibitor'&&b.alive&&b.built){any=true;break;}
  st._slowAny=any;
  if(!any)return;
  st.slow.fill(1);
  for(const b of st.buildings){
    if(b.type!=='inhibitor'||!b.alive||!b.built||b.stun>0)continue;
    if(!(st.energy>=1*TICK||st.sandbox)){b.active=false;continue;}
    if(!st.sandbox)st.energy-=1*TICK;
    b.active=true;
    const r=TYPES.inhibitor.range, ri=Math.ceil(r), bcx=b.px/CELL, bcy=b.py/CELL;
    const x0=Math.max(0,Math.floor(bcx-ri)), x1=Math.min(COLS-1,Math.ceil(bcx+ri));
    const y0=Math.max(0,Math.floor(bcy-ri)), y1=Math.min(ROWS-1,Math.ceil(bcy+ri));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      if(dist(x+0.5,y+0.5,bcx,bcy)<=r){const i=idx(x,y);if(st.slow[i]>0.25)st.slow[i]=0.25;}
    }
  }
}
/* magma: emitters of kind 'magma' periodically solidify nearby deep Flux
   into permanent rock — the un-erosion */
export function tickMagma(st){
  if((st.tickN%15)!==0)return;                   // every 0.5 s
  for(const e of st.emitters){
    if(!e.alive||e.kind!=='magma')continue;
    for(let k=0;k<3;k++){
      const a=st.rng()*Math.PI*2, r=2+st.rng()*5;
      const x=Math.round(e.cx+Math.cos(a)*r), y=Math.round(e.cy+Math.sin(a)*r);
      if(!inB(x,y))continue;
      const i=idx(x,y);
      if(st.occ[i]!==-1)continue;
      if(st.creep[i]>2 && st.ter[i]<TER_LEVELS){
        st.ter[i]++;
        st.creep[i]=Math.max(0,st.creep[i]-3);
        retileTerrain(st,x-1,y-1,x+1,y+1);
      }
    }
  }
}
/* erosion: deep Flux pressing against a cliff grinds it down a level —
   walls are not forever */
export function tickErosion(st){
  if(!st.mods.erosion)return;                 // chooseable: Flux only erodes terrain when enabled
  const c=st.creep, ter=st.ter, ero=st.ero;
  for(let i=0;i<c.length;i++){
    const v=c[i];
    if(v<=6)continue;
    const x=i%COLS, y=(i/COLS)|0;
    const press=TICK*(v-6)*0.02;
    if(x>0&&ter[i-1]>ter[i])erodeCell(st,i-1,press);
    if(x<COLS-1&&ter[i+1]>ter[i])erodeCell(st,i+1,press);
    if(y>0&&ter[i-COLS]>ter[i])erodeCell(st,i-COLS,press);
    if(y<ROWS-1&&ter[i+COLS]>ter[i])erodeCell(st,i+COLS,press);
  }
}
function erodeCell(st,i,press){
  st.ero[i]+=press;
  if(st.ero[i]<8)return;
  st.ero[i]=0;
  if(st.ter[i]<=1)return;
  st.ter[i]--;
  const x=i%COLS, y=(i/COLS)|0;
  retileTerrain(st,x-1,y-1,x+1,y+1);
  if(st.t-st.lastEroMsg>10){
    st.lastEroMsg=st.t;
    msg('◈ OPS: The Flux is eroding our terrain!','#ff9d5c');
    sfx('die',(x+0.5)*CELL);
  }
}

/* spore towers lob arcing Flux blobs at random structures — only Beams
   can intercept them mid-flight */
export function tickSpores(st){
  for(const tw of st.sporeTowers){
    if(!tw.alive)continue;
    if(st.t>=tw.next){
      tw.next=st.t+40+st.rng()*25;
      const cand=st.buildings.filter(b=>b.alive&&b.built);
      if(cand.length){
        const tgt=cand[Math.floor(st.rng()*cand.length)];
        const x1=(tw.cx+0.5)*CELL, y1=(tw.cy+0.5)*CELL;
        st.spores.push({x1:x1,y1:y1,tx:tgt.px,ty:tgt.py,t:0,dur:11,x:x1,y:y1,h:0});
        msg('◈ OPS: Spore launch detected — get Beams up!','#ff9d5c');
        sfx('alarm');
      }
    }
  }
  for(const sp of st.spores){
    if(sp.dead)continue;
    sp.t+=TICK;
    const k=Math.min(1,sp.t/sp.dur);
    sp.x=sp.x1+(sp.tx-sp.x1)*k;
    sp.y=sp.y1+(sp.ty-sp.y1)*k;
    sp.h=Math.sin(Math.PI*k)*60;
    if(k>=1){
      sp.dead=true;
      const cx=clamp(Math.round(sp.x/CELL),0,COLS-1), cy=clamp(Math.round(sp.y/CELL),0,ROWS-1);
      for(let dy=-2;dy<=2;dy++){
        for(let dx=-2;dx<=2;dx++){
          const x=cx+dx, y=cy+dy;
          if(!inB(x,y))continue;
          const d=Math.hypot(dx,dy);
          if(d>2.5)continue;
          const i=idx(x,y);
          st.creep[i]=Math.min(CREEP_MAX,st.creep[i]+9*(1-d/3.2));
        }
      }
      boom(st,sp.x,sp.y,1.2,'#ff7d9c');
      sfx('boom',sp.x);
    }
  }
  st.spores=st.spores.filter(s=>!s.dead);
}

/* emitter personalities: Breeders multiply, Migrants flee a charging
   nullifier (once), the Boss shrugs off the first nullifier strike */
export function tickPersonalities(st){
  for(const e of st.emitters){
    if(!e.alive)continue;
    if(e.kind==='breeder'){
      e.breedT+=TICK;
      if(e.breedT>=180){
        e.breedT=0;
        let kids=0;
        for(const o of st.emitters)if(o.kind==='spawn'&&o.alive)kids++;
        if(kids>=3)continue;
        let bx=-1, by=-1, bh=99;
        for(let k=0;k<24;k++){
          const a=st.rng()*Math.PI*2, r=3+st.rng()*4;
          const x=Math.round(e.cx+Math.cos(a)*r), y=Math.round(e.cy+Math.sin(a)*r);
          if(!inB(x,y)||st.occ[idx(x,y)]!==-1)continue;
          let near=false;
          for(const o of st.emitters)if(o.alive&&Math.abs(o.cx-x)<3&&Math.abs(o.cy-y)<3){near=true;break;}
          if(near)continue;
          const h=st.ter[idx(x,y)];
          if(h<bh){bh=h;bx=x;by=y;}
        }
        if(bx>=0){
          st.emitters.push({cx:bx,cy:by,alive:true,t:0,pulse:st.rng()*6,str:0.8,kind:'spawn'});
          carveBasin(st,bx,by);
          retileTerrain(st,bx-2,by-2,bx+2,by+2);
          msg('◈ OPS: The Breeder spawned a new Emitter!','#ff7d9c');
          sfx('die',(bx+0.5)*CELL);
        }
      }
    }else if(e.kind==='migrant'&&!e.migrated){
      let threat=false;
      for(const b of st.buildings){
        if(b.alive&&b.type==='nullifier'&&b.charge>0&&dist(b.px/CELL,b.py/CELL,e.cx+0.5,e.cy+0.5)<=9){threat=true;break;}
      }
      if(!threat)continue;
      e.migrated=true;
      for(let k=0;k<40;k++){
        const a=st.rng()*Math.PI*2, r=12+st.rng()*8;
        const x=Math.round(e.cx+Math.cos(a)*r), y=Math.round(e.cy+Math.sin(a)*r);
        if(x<4||y<4||x>=COLS-4||y>=ROWS-4)continue;
        if(st.occ[idx(x,y)]!==-1)continue;
        let nearB=false;
        for(const b of st.buildings)if(b.alive&&dist(b.px/CELL,b.py/CELL,x,y)<6){nearB=true;break;}
        if(nearB)continue;
        boom(st,(e.cx+0.5)*CELL,(e.cy+0.5)*CELL,1.5,'#b66bff');
        e.cx=x; e.cy=y;
        carveBasin(st,x,y);
        retileTerrain(st,x-2,y-2,x+2,y+2);
        msg('◈ OPS: That Emitter just BURROWED AWAY. Unbelievable.','#b66bff');
        sfx('nullify',(x+0.5)*CELL);
        break;
      }
    }
  }
}

/* ice melts: frozen ground reverts after 25 s */
export function tickIce(st){
  if(!st.ice.length)return;
  let changed=false, x0=COLS, y0=ROWS, x1=0, y1=0;
  for(let k=st.ice.length-1;k>=0;k--){
    const ic=st.ice[k];
    if(st.t<ic.until)continue;
    const x=ic.i%COLS, y=(ic.i/COLS)|0;
    st.ter[ic.i]=clamp(st.ter[ic.i]-ic.amt,1,TER_LEVELS);
    if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
    st.ice.splice(k,1);
    changed=true;
  }
  if(changed)retileTerrain(st,x0-1,y0-1,x1+1,y1+1);
}

/* digitalis: a living web that grows where Flux feeds it, lets Flux level
   itself across any height, and carries Runners. Withers without Flux. */
export function tickDigitalis(st){
  st.runT+=TICK;
  const c=st.creep, dg=st.digi, step=(st.t*2)|0;
  if(st.runT>=0.5){
    for(const e of st.emitters)if(e.alive)dg[idx(e.cx,e.cy)]=1;
    const hash=(x,y)=>{
      let n=(Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(step,69069))|0;
      n=Math.imul(n^(n>>>13),1274126177);
      return ((n^(n>>>16))>>>0)/4294967296;
    };
    for(let i=0;i<dg.length;i++){
      const x=i%COLS, y=(i/COLS)|0;
      if(dg[i]){
        if(c[i]<=0.05 && hash(x,y)<0.06)dg[i]=0;     // starves without Flux
        continue;
      }
      if(c[i]<=0.3)continue;
      const nb=(x>0&&dg[i-1])||(x<COLS-1&&dg[i+1])||(y>0&&dg[i-COLS])||(y<ROWS-1&&dg[i+COLS]);
      if(nb && hash(x,y)<0.3)dg[i]=1;
    }
  }
  // Flux equalizes along the web ignoring terrain — it climbs cliffs here
  for(let i=0;i<dg.length;i++){
    if(!dg[i])continue;
    const x=i%COLS;
    if(x<COLS-1&&dg[i+1]){const d=(c[i]-c[i+1])*0.08; c[i]-=d; c[i+1]+=d;}
    if(i+COLS<dg.length&&dg[i+COLS]){const d=(c[i]-c[i+COLS])*0.08; c[i]-=d; c[i+COLS]+=d;}
  }
  // runners: spawn on the web, sprint to the nearest structure, stun it
  if(st.runT>=0.5){
    st.runT=0;
    if(st.runners.length<8 && st.t>150){
      for(const e of st.emitters){
        if(!e.alive)continue;
        if(st.rng()<0.006){
          st.runners.push({x:(e.cx+0.5)*CELL,y:(e.cy+0.5)*CELL,cx:e.cx,cy:e.cy,mt:0});
          msg('◈ OPS: Runner on the web — Snipers!','#ff9d5c');
          sfx('alarm');
          break;
        }
      }
    }
  }
  for(const r of st.runners){
    if(r.dead)continue;
    r.mt+=TICK;
    if(r.mt<0.16)continue;
    r.mt=0;
    let tb=null, td=1e9;
    for(const b of st.buildings){
      if(!b.alive)continue;
      const d=dist(b.px/CELL,b.py/CELL,r.cx,r.cy);
      if(d<td){td=d;tb=b;}
    }
    if(!tb||td>40){r.dead=true;continue;}
    if(td<1.8){
      tb.stun=6;
      r.dead=true;
      boom(st,r.x,r.y,0.9,'#ff7d9c');
      msg('◈ OPS: '+TYPES[tb.type].name+' stunned by a Runner!','#ff7d9c');
      sfx('die',r.x);
      continue;
    }
    let bx=r.cx, by=r.cy, bd2=td;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const x=r.cx+dx, y=r.cy+dy;
      if(!inB(x,y)||!st.digi[idx(x,y)])continue;
      const d=dist(tb.px/CELL,tb.py/CELL,x,y);
      if(d<bd2){bd2=d;bx=x;by=y;}
    }
    if(bx===r.cx&&by===r.cy){                     // web dead-ends: leap off it
      r.cx+=Math.sign(tb.px/CELL-r.cx); r.cy+=Math.sign(tb.py/CELL-r.cy);
    }else{r.cx=bx; r.cy=by;}
    r.x=(r.cx+0.5)*CELL; r.y=(r.cy+0.5)*CELL;
  }
  st.runners=st.runners.filter(r=>!r.dead);
}

/* totems feed the Forge with aether while a connected backbone holds them */
export function tickTotems(st){
  for(const tm of st.totems){
    tm.on=false;
    for(const b of st.buildings){
      if(!b.alive||!b.built||!b.conn||b.moving)continue;
      if(!TYPES[b.type].backbone)continue;
      if(dist(b.px/CELL,b.py/CELL,tm.cx+0.5,tm.cy+0.5)<=5){tm.on=true;break;}
    }
    if(tm.on)st.aether+=0.05*TICK;
  }
}

/* relics: claim by holding a connected backbone nearby for 12 s —
   permanent global buffs, placed on dangerous high ground */
export function tickRelics(st){
  for(const rl of st.relics){
    if(rl.claimed)continue;
    let near=false;
    for(const b of st.buildings){
      if(!b.alive||!b.built||!b.conn||b.moving)continue;
      if(!TYPES[b.type].backbone)continue;
      if(dist(b.px/CELL,b.py/CELL,rl.cx+0.5,rl.cy+0.5)<=5){near=true;break;}
    }
    if(near){
      rl.prog+=TICK;
      if(rl.prog>=12){
        rl.claimed=true;
        if(rl.kind==='rate'){st.buffs.rate+=0.15;msg('◈ RELIC CLAIMED: weapon fire rate +15%.','#b66bff');}
        else if(rl.kind==='speed'){st.buffs.pspeed+=0.25;msg('◈ RELIC CLAIMED: packet speed +25%.','#b66bff');}
        else{st.buffs.prod+=0.6;msg('◈ RELIC CLAIMED: +0.6 energy/s.','#b66bff');}
        sfx('win');
        boom(st,(rl.cx+0.5)*CELL,(rl.cy+0.5)*CELL,1.4,'#b66bff');
      }
    }else if(rl.prog>0){
      rl.prog=Math.max(0,rl.prog-TICK*2);
    }
  }
}

/* ---------- combat helpers ---------- */
export function removeCreep(st,x,y,amt){
  const i=idx(x,y); const v=st.creep[i];
  if(v<=0)return 0;
  const r=Math.min(v,amt);
  st.creep[i]=v-r; st.stats.flux+=r;
  return r;
}
export function blast(st,px,py,r,power){
  const cx=px/CELL, cy=py/CELL;
  const x0=Math.max(0,Math.floor(cx-r)), x1=Math.min(COLS-1,Math.ceil(cx+r));
  const y0=Math.max(0,Math.floor(cy-r)), y1=Math.min(ROWS-1,Math.ceil(cy+r));
  for(let y=y0;y<=y1;y++){
    for(let x=x0;x<=x1;x++){
      const d=dist(x+0.5,y+0.5,cx,cy);
      if(d>r)continue;
      removeCreep(st,x,y,power*(1-(d/r)*0.7));
    }
  }
}
export function nearestCreep(st,b,range){
  const bcx=b.px/CELL, bcy=b.py/CELL, r=Math.ceil(range);
  const x0=Math.max(0,Math.floor(bcx-r)), x1=Math.min(COLS-1,Math.ceil(bcx+r));
  const y0=Math.max(0,Math.floor(bcy-r)), y1=Math.min(ROWS-1,Math.ceil(bcy+r));
  let best=null, bd=1e9;
  for(let y=y0;y<=y1;y++){
    for(let x=x0;x<=x1;x++){
      if(st.creep[idx(x,y)]<=0.07)continue;
      const d=dist(x+0.5,y+0.5,bcx,bcy);
      if(d<=range && d<bd){bd=d;best={cx:x,cy:y,px:(x+0.5)*CELL,py:(y+0.5)*CELL};}
    }
  }
  return best;
}
export function deepestCreep(st,b,range){
  const bcx=b.px/CELL, bcy=b.py/CELL, r=Math.ceil(range);
  const x0=Math.max(0,Math.floor(bcx-r)), x1=Math.min(COLS-1,Math.ceil(bcx+r));
  const y0=Math.max(0,Math.floor(bcy-r)), y1=Math.min(ROWS-1,Math.ceil(bcy+r));
  let best=null, bv=0;
  for(let y=y0;y<=y1;y++){
    for(let x=x0;x<=x1;x++){
      const v=st.creep[idx(x,y)];
      if(v<=0.07)continue;
      if(dist(x+0.5,y+0.5,bcx,bcy)>range)continue;
      if(v>bv){bv=v;best={cx:x,cy:y,px:(x+0.5)*CELL,py:(y+0.5)*CELL,v:v};}
    }
  }
  return best;
}
export function sparks(st,x,y,n,col){
  for(let i=0;i<n;i++){
    const a=Math.random()*Math.PI*2, sp=30+Math.random()*70;
    st.parts.push({x:x,y:y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,t:0.3+Math.random()*0.3,max:0.6,col:col,r:1+Math.random()*1.5,g:0});
  }
}
export function boom(st,x,y,scale,col){
  const n=Math.floor(18*scale);
  for(let i=0;i<n;i++){
    const a=Math.random()*Math.PI*2, sp=(40+Math.random()*120)*scale*0.7;
    st.parts.push({x:x,y:y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,t:0.4+Math.random()*0.5,max:0.9,col:Math.random()<0.5?col:'#ffffff',r:1.5+Math.random()*2.5,g:1});
  }
  setShake(Math.max(shake,2+scale*1.5));
}

/* ---------- buildings tick ---------- */
export function tickBuildings(st){
  // resonator precompute: mark weapons adjacent to a built Resonator (+40%
  // rate & range), so the fire code can read a simple flag
  let anyReso=false;
  for(const b of st.buildings)if(b.type==='resonator'&&b.alive&&b.built){anyReso=true;break;}
  if(anyReso){
    for(const b of st.buildings)b.reso=false;
    for(const r of st.buildings){
      if(r.type!=='resonator'||!r.alive||!r.built)continue;
      for(const b of st.buildings){
        if(!b.alive||!b.built||!TYPES[b.type].range)continue;
        if(b.type==='resonator'||b.type==='sensor'||b.type==='repair'||b.type==='shield'||b.type==='inhibitor')continue;
        if(dist(b.px,b.py,r.px,r.py)<=(TYPES.resonator.range+1)*CELL)b.reso=true;
      }
    }
  }
  let died=false;
  for(const b of st.buildings){
    if(!b.alive)continue;
    if(b.moving){
      const mv=b.moving;
      mv.t+=TICK;
      const k=Math.min(1,mv.t/mv.dur);
      const e=k*k*(3-2*k);
      b.px=mv.x0+(mv.tx-mv.x0)*e;
      b.py=mv.y0+(mv.ty-mv.y0)*e;
      if(k>=1){b.moving=null;st.netDirty=true;}
      continue;
    }
    let cmax=0;
    for(let y=b.gy;y<b.gy+b.sz;y++){
      for(let x=b.gx;x<b.gx+b.sz;x++){
        const v=st.creep[idx(x,y)];
        if(v>cmax)cmax=v;
      }
    }
    if(cmax>0.05 && b.type!=='siphon'){      // the Siphon is built to live in Flux
      b.hp-=(0.8+1.4*Math.min(cmax,6))*TICK;
      b.hurtT=0.15;
      if(b.hp<=0){killBuilding(st,b,true);died=true;continue;}
    }else if(b.built && b.hp<b.hpMax){
      b.hp=Math.min(b.hpMax,b.hp+0.6*TICK);
    }
    if(b.hurtT>0)b.hurtT-=TICK;
    if(!b.built)continue;
    if(b.stun>0){b.stun-=TICK;continue;}    // runner-stunned: systems offline
    const T=TYPES[b.type];
    const RZ=b.reso?1.4:1;                   // resonator: +40% rate & range
    if(b.type==='cannon'){
      b.cd-=TICK;
      if(b.cd<=0 && b.ammo>=T.shotCost){
        const tgt=nearestCreep(st,b,T.range*(b.pz?1.3:1)*RZ);
        if(tgt){
          b.cd=T.shotCd/((b.pz?2:1)*(1+st.buffs.rate)*RZ); b.ammo-=T.shotCost;
          b.aim=Math.atan2(tgt.py-b.py,tgt.px-b.px);
          const dm=1+st.buffs.dmg;
          removeCreep(st,tgt.cx,tgt.cy,1.8*dm);
          for(let dy=-1;dy<=1;dy++){
            for(let dx=-1;dx<=1;dx++){
              if(dx===0&&dy===0)continue;
              const x=tgt.cx+dx, y=tgt.cy+dy;
              if(inB(x,y))removeCreep(st,x,y,0.45*dm);
            }
          }
          st.shots.push({x1:b.px,y1:b.py-3,x2:tgt.px,y2:tgt.py,t:0.08});
          sparks(st,tgt.px,tgt.py,3,'#7fd9ff');
          sfx('shot',b.px);
        }
      }
    }else if(b.type==='mortar'){
      b.cd-=TICK;
      if(b.cd<=0 && b.ammo>=T.shotCost){
        const tgt=deepestCreep(st,b,T.range*(b.pz?1.3:1)*RZ);
        if(tgt && tgt.v>=0.9){
          b.cd=T.shotCd/((b.pz?2:1)*(1+st.buffs.rate)*RZ); b.ammo-=T.shotCost;
          st.shells.push({x1:b.px,y1:b.py,x2:tgt.px,y2:tgt.py,t:0,dur:0.9});
          sfx('mortar',b.px);
        }
      }
    }else if(b.type==='beam'){
      b.cd-=TICK;
      if(b.cd<=0 && b.ammo>=1){
        let best=null, bd=1e9;
        for(const sp of st.spores){
          if(sp.dead)continue;
          const d=dist(sp.x,sp.y,b.px,b.py);
          if(d<=T.range*CELL && d<bd){bd=d;best=sp;}
        }
        if(best){
          b.cd=0.5; b.ammo-=1; best.dead=true;
          st.shots.push({x1:b.px,y1:b.py,x2:best.x,y2:best.y-best.h,t:0.12,col:'#9ffce4'});
          boom(st,best.x,best.y-best.h,0.7,'#9ffce4');
          sfx('shot',b.px);
        }
      }
    }else if(b.type==='sprayer'){
      b.cd-=TICK;
      if(b.cd<=0 && b.ammo>=1 && nearestCreep(st,b,T.range+3)){
        b.cd=0.5; b.ammo-=1;
        const r=T.range, bcx=b.px/CELL, bcy=b.py/CELL, ri=Math.ceil(r);
        const x0=Math.max(0,Math.floor(bcx-ri)), x1=Math.min(COLS-1,Math.ceil(bcx+ri));
        const y0=Math.max(0,Math.floor(bcy-ri)), y1=Math.min(ROWS-1,Math.ceil(bcy+ri));
        for(let y=y0;y<=y1;y++){
          for(let x=x0;x<=x1;x++){
            const d=dist(x+0.5,y+0.5,bcx,bcy);
            if(d>r)continue;
            st.anti[idx(x,y)]+=1.6*(1-(d/r)*0.6);
          }
        }
        st._antiAny=true;
        sparks(st,b.px,b.py,2,'#cfe8ff');
      }
    }else if(b.type==='cryo'){
      b.cd-=TICK;
      if(b.cd<=0 && b.ammo>=3 && nearestCreep(st,b,T.range)){
        b.cd=8; b.ammo-=3;
        const bcx=b.px/CELL, bcy=b.py/CELL, ri=Math.ceil(T.range);
        const x0=Math.max(0,Math.floor(bcx-ri)), x1=Math.min(COLS-1,Math.ceil(bcx+ri));
        const y0=Math.max(0,Math.floor(bcy-ri)), y1=Math.min(ROWS-1,Math.ceil(bcy+ri));
        for(let y=y0;y<=y1;y++){
          for(let x=x0;x<=x1;x++){
            if(dist(x+0.5,y+0.5,bcx,bcy)>T.range)continue;
            const i=idx(x,y);
            if(st.creep[i]>0.05){st.stats.flux+=st.creep[i];st.stats.frozen+=st.creep[i];st.creep[i]=0;}
            const add=Math.min(2,TER_LEVELS-st.ter[i]);
            if(add>0&&st.occ[i]===-1){
              st.ter[i]+=add;
              st.ice.push({i:i,amt:add,until:st.t+25});
            }
          }
        }
        retileTerrain(st,Math.floor(bcx-ri)-1,Math.floor(bcy-ri)-1,Math.ceil(bcx+ri)+1,Math.ceil(bcy+ri)+1);
        boom(st,b.px,b.py,1.3,'#bfe8ff');
        msg('◈ OPS: Flux flash-frozen — ice holds 25 seconds!','#bfe8ff');
        sfx('nullify',b.px);
      }
    }else if(b.type==='sniper'){
      b.cd-=TICK;
      if(b.cd<=0 && b.ammo>=1){
        let best=null, bd=1e9;
        for(const r of st.runners){
          if(r.dead)continue;
          const d=dist(r.x,r.y,b.px,b.py);
          if(d<=T.range*CELL && d<bd){bd=d;best=r;}
        }
        if(best){
          b.cd=T.shotCd/((b.pz?2:1)*(1+st.buffs.rate)); b.ammo-=1; best.dead=true;
          st.shots.push({x1:b.px,y1:b.py,x2:best.x,y2:best.y,t:0.1,col:'#ffd2dd'});
          boom(st,best.x,best.y,0.6,'#ff7d9c');
          sfx('shot',b.px);
        }
      }
    }else if(b.type==='strafer'){
      const air=b.air||(b.air={x:b.px,y:b.py,state:'idle',tx:0,ty:0,t:0});
      if(air.state==='idle'){
        air.x=b.px; air.y=b.py;
        b.cd-=TICK;
        if(b.cd<=0 && b.ammo>=4){
          const tgt=deepestCreep(st,b,22);
          if(tgt){air.state='out'; air.tx=tgt.px; air.ty=tgt.py;}
        }
      }else if(air.state==='out'||air.state==='back'){
        const gx2=air.state==='out'?air.tx:b.px, gy2=air.state==='out'?air.ty:b.py;
        const d=dist(air.x,air.y,gx2,gy2), sp2=120*TICK;
        if(d<=sp2){
          air.x=gx2; air.y=gy2;
          if(air.state==='out'){air.state='strafe'; air.t=2.2; b.ammo-=4;}
          else{air.state='idle'; b.cd=3;}
        }else{
          air.x+=(gx2-air.x)/d*sp2; air.y+=(gy2-air.y)/d*sp2;
        }
      }else if(air.state==='strafe'){
        air.t-=TICK;
        air.x+=20*TICK;                          // strafing run drifts east
        const cx2=Math.round(air.x/CELL), cy2=Math.round(air.y/CELL);
        const dm=0.55*(1+st.buffs.dmg);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const x=cx2+dx, y=cy2+dy;
          if(inB(x,y))removeCreep(st,x,y,dm);
        }
        if(((st.tickN)%4)===0)sparks(st,air.x,air.y,2,'#7fd9ff');
        if(air.t<=0)air.state='back';
      }
    }else if(b.type==='bomber'){
      const air=b.air||(b.air={x:b.px,y:b.py,state:'idle',tx:0,ty:0,t:0});
      if(air.state==='idle'){
        air.x=b.px; air.y=b.py;
        b.cd-=TICK;
        if(b.cd<=0 && b.ammo>=4){
          const tgt=deepestCreep(st,b,24);
          if(tgt){air.state='out'; air.tx=tgt.px; air.ty=tgt.py;}
        }
      }else if(air.state==='out'||air.state==='back'){
        const gx2=air.state==='out'?air.tx:b.px, gy2=air.state==='out'?air.ty:b.py;
        const d=dist(air.x,air.y,gx2,gy2), sp2=130*TICK;
        if(d<=sp2){
          air.x=gx2; air.y=gy2;
          if(air.state==='out'){
            air.state='back'; b.ammo-=4;
            // drop an Anti-Flux payload in a radius
            const bcx=air.x/CELL, bcy=air.y/CELL, r=3.5, ri=Math.ceil(r);
            for(let dy=-ri;dy<=ri;dy++)for(let dx=-ri;dx<=ri;dx++){
              const x=Math.round(bcx)+dx, y=Math.round(bcy)+dy;
              if(!inB(x,y))continue;
              const dd=Math.hypot(dx,dy);
              if(dd>r)continue;
              st.anti[idx(x,y)]+=2.4*(1-dd/(r+1));
            }
            st._antiAny=true;
            boom(st,air.x,air.y,1.4,'#bfe8ff');
            sfx('boom',air.x);
          }else{air.state='idle'; b.cd=3.5;}
        }else{
          air.x+=(gx2-air.x)/d*sp2; air.y+=(gy2-air.y)/d*sp2;
        }
      }
    }else if(b.type==='shield'){
      // push Flux radially outward while powered (continuous energy drain)
      b.active=false;
      if(st.energy>=1.5*TICK || st.sandbox){
        if(!st.sandbox)st.energy-=1.5*TICK;
        b.active=true;
        const bcx=b.px/CELL, bcy=b.py/CELL, r=T.range, ri=Math.ceil(r);
        const x0=Math.max(1,Math.floor(bcx-ri)), x1=Math.min(COLS-2,Math.ceil(bcx+ri));
        const y0=Math.max(1,Math.floor(bcy-ri)), y1=Math.min(ROWS-2,Math.ceil(bcy+ri));
        for(let y=y0;y<=y1;y++){
          for(let x=x0;x<=x1;x++){
            const i=idx(x,y), v=st.creep[i];
            if(v<=0.05)continue;
            const ddx=x+0.5-bcx, ddy=y+0.5-bcy, d=Math.hypot(ddx,ddy);
            if(d>r||d<0.3)continue;
            const ox=x+(Math.abs(ddx)>Math.abs(ddy)?(ddx>0?1:-1):0);
            const oy=y+(Math.abs(ddy)>=Math.abs(ddx)?(ddy>0?1:-1):0);
            const push=Math.min(v,0.25+v*0.25);
            st.creep[i]-=push;
            if(inB(ox,oy))st.creep[idx(ox,oy)]+=push;
          }
        }
      }
    }else if(b.type==='repair'){
      if(st.energy>=0.5*TICK || st.sandbox){
        let did=false;
        for(const o of st.buildings){
          if(o===b||!o.alive||!o.built||o.hp>=o.hpMax-0.01||o.moving)continue;
          if(dist(o.px,o.py,b.px,b.py)>T.range*CELL)continue;
          o.hp=Math.min(o.hpMax,o.hp+1.2*TICK); did=true;
        }
        if(did&&!st.sandbox)st.energy-=0.5*TICK;
      }
    }else if(b.type==='siphon'){
      // drain Flux on its own cell directly into energy (≤0.6 e/s)
      const i=idx(b.gx,b.gy), v=st.creep[i];
      if(v>0.1){
        const take=Math.min(v,2.4*TICK);
        st.creep[i]-=take; st.stats.flux+=take;
        if(!st.sandbox)st.energy=Math.min((st.cap||40),st.energy+take*0.25);
        if((st.tickN%6)===0)sparks(st,b.px,b.py,1,'#7be3a8');
      }
    }else if(b.type==='harvester'){
      if(b.conn)st.aether+=0.08*TICK;        // mines its Aether Node
    }else if(b.type==='convert'){
      if(!b.fired && b.charge>=T.charge){
        b.fired=true;
        let best=null, bd=1e9;
        for(const e of st.emitters){
          if(!e.alive||e.captured)continue;
          const d=dist(e.cx+0.5,e.cy+0.5,b.px/CELL,b.py/CELL);
          if(d<=T.range+0.5 && d<bd){bd=d;best=e;}
        }
        if(best){
          best.captured=true; best.alive=false;   // alive=false → counts as neutralized for win
          st.stats.emitters++;
          st._antiAny=true;
          boom(st,(best.cx+0.5)*CELL,(best.cy+0.5)*CELL,2.4,'#bfe8ff');
          msg('◈ Emitter CAPTURED — it pumps Anti-Flux for us now!','#bfe8ff');
          sfx('nullify',b.px);
          setShake(Math.max(shake,7));
          checkWin(st);
        }else{
          msg('◈ OPS: No Emitter in converter range.','#ff8d7a');
        }
        killBuilding(st,b,false);
        died=true;
      }
    }else if(b.type==='nullifier'){
      if(!b.fired && !b.firing && b.charge>=T.charge){
        b.firing=true; b.fireT=1.2;
        sfx('charge',b.px);
      }
      if(b.firing){
        b.fireT-=TICK;
        if(b.fireT<=0){
          b.firing=false; b.fired=true;
          let n=0;
          for(const e of st.emitters){
            if(e.alive && dist(e.cx+0.5,e.cy+0.5,b.px/CELL,b.py/CELL)<=T.range+0.5){
              if(e.shield>0){
                e.shield--;
                boom(st,(e.cx+0.5)*CELL,(e.cy+0.5)*CELL,1.6,'#b66bff');
                msg('◈ OPS: Boss shield shattered — hit it again!','#b66bff');
                continue;
              }
              e.alive=false; n++; st.stats.emitters++;
              st.pzones.push({cx:e.cx,cy:e.cy});
              boom(st,(e.cx+0.5)*CELL,(e.cy+0.5)*CELL,2.2,'#ffd86b');
              blast(st,(e.cx+0.5)*CELL,(e.cy+0.5)*CELL,5,30);
            }
          }
          for(const tw of st.sporeTowers){
            if(tw.alive && dist(tw.cx+0.5,tw.cy+0.5,b.px/CELL,b.py/CELL)<=T.range+0.5){
              tw.alive=false; n++;
              st.pzones.push({cx:tw.cx,cy:tw.cy});
              boom(st,(tw.cx+0.5)*CELL,(tw.cy+0.5)*CELL,2,'#ff7d9c');
            }
          }
          for(const ob of st.buildings)if(ob.alive)updatePZ(st,ob);
          msg(n+' target'+(n!==1?'s':'')+' neutralized — Power Zone'+(n!==1?'s':'')+' exposed.','#ffd86b');
          sfx('nullify',b.px);
          setShake(Math.max(shake,8));
          killBuilding(st,b,false);
          died=true;
          checkWin(st);
        }
      }
    }
  }
  if(died)cleanupDead(st);
}

export function tickShells(st){
  for(const s of st.shells){
    s.t+=TICK;
    if(s.t>=s.dur){
      s.dead=true;
      blast(st,s.x2,s.y2,3.6,3.2*(1+st.buffs.dmg));
      boom(st,s.x2,s.y2,1.2,'#ff9d5c');
      sfx('boom',s.x2);
    }
  }
  st.shells=st.shells.filter(s=>!s.dead);
}

/* ---------- placement / removal ---------- */
/* ignoreId lets a relocating building overlap its own current footprint.
   No network-link requirement: disconnected placements are legal and sit
   as dormant ghosts until the network reaches them. */
export function canPlace(st,type,cx,cy,ignoreId){
  const T=TYPES[type], sz=T.sz;
  const gx=cx-Math.floor(sz/2), gy=cy-Math.floor(sz/2);
  if(gx<0||gy<0||gx+sz>COLS||gy+sz>ROWS)return{ok:false,why:'Out of bounds'};
  const lvl0=st.ter[idx(gx,gy)];
  const onFlux=type==='siphon';            // the Siphon is built ON deep Flux
  for(let y=gy;y<gy+sz;y++){
    for(let x=gx;x<gx+sz;x++){
      const i=idx(x,y);
      if(st.occ[i]!==-1 && st.occ[i]!==ignoreId)return{ok:false,why:'Blocked'};
      if(!onFlux && st.creep[i]>0.05)return{ok:false,why:'Flux contamination'};
      if(st.ter[i]!==lvl0)return{ok:false,why:'Uneven ground'};
    }
  }
  for(const e of st.emitters){
    if(!e.alive)continue;
    if(type==='core'){                       // the Core may deploy right beside Emitters — only block sitting ON one
      if(e.cx>=gx && e.cx<gx+sz && e.cy>=gy && e.cy<gy+sz)return{ok:false,why:'On an Emitter'};
    }else if(e.cx>=gx-1 && e.cx<gx+sz+1 && e.cy>=gy-1 && e.cy<gy+sz+1)return{ok:false,why:'Too close to Emitter'};
  }
  for(const rl of st.relics){
    if(rl.cx>=gx && rl.cx<gx+sz && rl.cy>=gy && rl.cy<gy+sz)return{ok:false,why:'Relic site'};
  }
  for(const tm of st.totems){
    if(tm.cx>=gx && tm.cx<gx+sz && tm.cy>=gy && tm.cy<gy+sz)return{ok:false,why:'Totem site'};
  }
  // nodes block normal builds but a Harvester *requires* sitting on one
  let onNode=false;
  for(const n of st.nodes){
    if(n.cx>=gx && n.cx<gx+sz && n.cy>=gy && n.cy<gy+sz){onNode=true;break;}
  }
  if(type==='harvester'){
    if(!onNode)return{ok:false,why:'Must sit on an Aether Node'};
  }else if(onNode)return{ok:false,why:'Aether Node — use a Harvester'};
  if(type==='core')return{ok:true};          // Core deploys anywhere flat & Flux-free, even by Emitters
  if(type==='nullifier'){
    const px=(gx+sz/2), py=(gy+sz/2);
    const any=st.emitters.some(e=>e.alive&&dist(e.cx+0.5,e.cy+0.5,px,py)<=T.range+0.5)
      || st.sporeTowers.some(t=>t.alive&&dist(t.cx+0.5,t.cy+0.5,px,py)<=T.range+0.5);
    if(!any)return{ok:false,why:'No Emitter or Spore Tower in range'};
  }
  if(type==='convert'){
    const px=(gx+sz/2), py=(gy+sz/2);
    const any=st.emitters.some(e=>e.alive&&!e.captured&&dist(e.cx+0.5,e.cy+0.5,px,py)<=T.range+0.5);
    if(!any)return{ok:false,why:'No Emitter in range'};
  }
  return{ok:true};
}
export function place(st,type,cx,cy){
  const T=TYPES[type], sz=T.sz;
  const gx=cx-Math.floor(sz/2), gy=cy-Math.floor(sz/2);
  const b={
    id:st.nextId++, type:type, gx:gx, gy:gy, sz:sz,
    px:(gx+sz/2)*CELL, py:(gy+sz/2)*CELL,
    hpMax:T.hp*(st.mods.fragile?0.6:1), hp:(type==='core'?T.hp:T.hp*0.5)*(st.mods.fragile?0.6:1),
    built:type==='core', buildGot:0, pend:0,
    ammo:0, cd:0, charge:0, aim:-Math.PI/2,
    conn:false, parent:0, alive:true, hurtT:0,
    fired:false, firing:false, fireT:0, moving:null,
    tjobs:[], pz:false, cov:0, stun:0, air:null
  };
  updatePZ(st,b);
  st.buildings.push(b);
  st.byId.set(b.id,b);
  for(let y=gy;y<gy+sz;y++){
    for(let x=gx;x<gx+sz;x++)st.occ[idx(x,y)]=b.id;
  }
  if(type==='core'){
    const reclaim=st.coreDown;
    st.coreId=b.id; st.energy=15; st.stats.built++;
    st.phase='play';
    st.coreDown=false; st.reclaimT=0;
    banner(false);
    if(reclaim){
      boom(st,b.px,b.py,3.2,'#4df0c8');
      setShake(Math.max(shake,7));
      msg('◈ Core redeployed from orbit. Rebuild the network!','#4df0c8');
    }else{
      msg('Command Core deployed. Build Collectors to expand.','#4df0c8');
      if(!st.tut)msg('OBJECTIVE: charge a Nullifier beside every Emitter to win.','#ffd27f');
    }
    sfx('done');
  }
  st.netDirty=true;
  return b;
}
/* ---------- Terp terraforming (CW3-style) ----------
   Paint target levels onto cells in range; the Terp consumes one packet
   per level step, raising or lowering one job cell at a time. */
export function terraPaint(st,b,cx,cy,target){
  if(!b || !b.alive || !b.built || b.type!=='terra')return false;
  if(!inB(cx,cy))return false;
  if(dist(cx+0.5,cy+0.5,b.gx+0.5,b.gy+0.5)>TYPES.terra.workR)return false;
  const i=idx(cx,cy);
  if(st.occ[i]!==-1)return false;
  for(const e of st.emitters)if(e.alive&&e.cx===cx&&e.cy===cy)return false;
  for(const rl of st.relics)if(rl.cx===cx&&rl.cy===cy)return false;
  target=clamp(target,1,TER_LEVELS);
  const old=b.tjobs.findIndex(j=>j.x===cx&&j.y===cy);
  if(target===st.ter[i]){               // painting current level = erase job
    if(old>=0)b.tjobs.splice(old,1);
    return true;
  }
  if(old>=0)b.tjobs[old].t=target;
  else b.tjobs.push({x:cx,y:cy,t:target});
  return true;
}
export function applyTerraStep(st,b){
  while(b.tjobs.length){
    const j=b.tjobs[0];
    const i=idx(j.x,j.y);
    if(st.occ[i]!==-1 || st.ter[i]===j.t){b.tjobs.shift();continue;}
    st.ter[i]+=st.ter[i]<j.t?1:-1;
    st.stats.terra++;
    if(st.ter[i]===j.t)b.tjobs.shift();
    retileTerrain(st,j.x-1,j.y-1,j.x+1,j.y+1);
    st.shots.push({x1:b.px,y1:b.py,x2:(j.x+0.5)*CELL,y2:(j.y+0.5)*CELL,t:0.14,col:'#ffd86b'});
    sparks(st,(j.x+0.5)*CELL,(j.y+0.5)*CELL,3,'#d8b46a');
    return;
  }
}

/* relocation: weapons + core fly to a new (validated) footprint. The
   destination cells are claimed immediately; the structure is airborne —
   offline and untouchable by Flux — until it lands. */
export const MOVABLE={core:true,cannon:true,mortar:true};
export function startMove(st,b,cx,cy){
  if(!b.alive || !b.built || b.moving || !MOVABLE[b.type])return;
  const sz=b.sz;
  const gx=cx-Math.floor(sz/2), gy=cy-Math.floor(sz/2);
  for(let y=b.gy;y<b.gy+sz;y++){
    for(let x=b.gx;x<b.gx+sz;x++){
      const i=idx(x,y);
      if(st.occ[i]===b.id)st.occ[i]=-1;
    }
  }
  b.gx=gx; b.gy=gy;
  for(let y=gy;y<gy+sz;y++){
    for(let x=gx;x<gx+sz;x++)st.occ[idx(x,y)]=b.id;
  }
  const tx=(gx+sz/2)*CELL, ty=(gy+sz/2)*CELL;
  b.moving={x0:b.px,y0:b.py,tx:tx,ty:ty,t:0,dur:Math.max(0.25,dist(b.px,b.py,tx,ty)/55)};
  updatePZ(st,b);
  st.netDirty=true;
  msg(TYPES[b.type].name+' relocating.','#9fd0ff');
}
/* Power Zones: a nullified emitter leaves a zone that supercharges
   whatever is built on top of it */
export function updatePZ(st,b){
  b.pz=false;
  for(const z of st.pzones){
    if(z.cx>=b.gx && z.cx<b.gx+b.sz && z.cy>=b.gy && z.cy<b.gy+b.sz){b.pz=true;return;}
  }
}
export function killBuilding(st,b,byFlux){
  if(!b.alive)return;
  b.alive=false;
  for(let y=b.gy;y<b.gy+b.sz;y++){
    for(let x=b.gx;x<b.gx+b.sz;x++){
      const i=idx(x,y);
      if(st.occ[i]===b.id)st.occ[i]=-1;
    }
  }
  boom(st,b.px,b.py,b.sz*0.8,byFlux?'#b66bff':'#9fb2c8');
  if(byFlux){
    st.stats.lost++;
    msg(TYPES[b.type].name+' lost to the Flux.','#ff7d9c');
    sfx('die',b.px);
  }
  st.netDirty=true;
  if(b.id===st.coreId){
    // orbital reclaim: the Core is gone, but Command can drop a replacement
    // from orbit if you secure a landing site before the window closes
    st.coreId=0; st.coreDown=true; st.reclaimT=st.t+25; st.stats.coresLost++;
    st.phase='placeCore';
    setSelBuild(null); setDelMode(false); setSel(null); setMoveSrc(null);
    refreshButtons();
    boom(st,b.px,b.py,3,'#ff6e6e');
    setShake(Math.max(shake,9));
    banner(true,'◈ CORE DOWN — request orbital redeployment! Secure a flat landing site, fast.');
    msg('◈ OPS: Core destroyed. Orbital redeploy ready — 25 seconds.','#ff6e6e');
    sfx('lose');
  }
}
export function cleanupDead(st){
  let changed=false;
  for(let i=st.buildings.length-1;i>=0;i--){
    const b=st.buildings[i];
    if(!b.alive){
      st.buildings.splice(i,1);
      st.byId.delete(b.id);
      changed=true;
      if(sel===b)setSel(null);
      if(moveSrc===b)setMoveSrc(null);
      if(hover.b===b)hover.b=null;
    }
  }
  if(changed)st.netDirty=true;
}
export function deconstruct(st,b){
  if(!b || !b.alive || b.id===st.coreId || b.moving)return;
  const T=TYPES[b.type];
  const refund=b.built?Math.floor(T.cost*0.5):b.buildGot;
  st.energy=Math.min(st.cap||40,st.energy+refund);
  b.alive=false;
  for(let y=b.gy;y<b.gy+b.sz;y++){
    for(let x=b.gx;x<b.gx+b.sz;x++){
      const i=idx(x,y);
      if(st.occ[i]===b.id)st.occ[i]=-1;
    }
  }
  sparks(st,b.px,b.py,8,'#9fb2c8');
  msg(T.name+' recycled (+'+refund+'e).','#9fb2c8');
  cleanupDead(st);
}

/* Forge: spend totem aether on permanent upgrades (costs escalate ×1.6) */
export function forgeBuy(st,key){
  const cost=st.forge[key];
  if(st.aether<cost)return false;
  st.aether-=cost;
  st.forge[key]=Math.ceil(cost*1.6);
  if(key==='rate')st.buffs.rate+=0.10;
  else if(key==='speed')st.buffs.pspeed+=0.15;
  else if(key==='energy')st.buffs.prod+=0.5;
  else st.buffs.dmg+=0.15;
  msg('◈ FORGE: upgrade installed.','#b66bff');
  sfx('done');
  return true;
}

/* ---------- win / lose ---------- */
export function checkWin(st){
  if(st.phase!=='play')return;
  if((st.emitters.length||st.sporeTowers.length)
    && st.emitters.every(e=>!e.alive)
    && st.sporeTowers.every(t=>!t.alive))gameEnd(st,true);
}
export function gameEnd(st,won){
  if(st.phase==='won'||st.phase==='lost')return;
  st.phase=won?'won':'lost';
  setSelBuild(null); setDelMode(false); setSel(null); setMoveSrc(null);
  refreshButtons();
  showEnd(won);
  sfx(won?'win':'lose');
}

/* ---------- FX & main tick ---------- */
export function tickFX(st){
  for(const p of st.parts){
    p.x+=p.vx*TICK; p.y+=p.vy*TICK;
    p.vx*=0.96; p.vy=p.vy*0.96+(p.g?18*TICK*9:0);
    p.t-=TICK;
  }
  st.parts=st.parts.filter(p=>p.t>0);
  for(const s of st.shots)s.t-=TICK;
  st.shots=st.shots.filter(s=>s.t>0);
  if(shake>0)setShake(Math.max(0,shake-30*TICK));
}
export function tick(){
  const st=S;
  if(!st || st.phase==='menu')return;
  if(st.phase==='won'||st.phase==='lost'){
    simCreeper(st);
    tickFX(st);
    return;
  }
  // initial deploy: the world is frozen (no Flux, no clock) until the Core
  // lands — but an orbital RECLAIM (coreDown) keeps flooding while you scramble
  if(st.phase==='placeCore' && !st.coreDown){tickFX(st);return;}
  st.t+=TICK;
  st.tickN++;
  if(st.coreDown && st.t>=st.reclaimT){gameEnd(st,false);return;}   // reclaim window expired
  if(st.phase==='play'){tickSurge(st);tickWeather(st);tickInhibitors(st);}
  tickEmitters(st);
  simCreeper(st);
  if(st.phase==='play'){
    tickErosion(st);
    tickMagma(st);
    tickDigitalis(st);
    tickIce(st);
    tickSpores(st);
    tickPersonalities(st);
    tickTotems(st);
    if(st.netDirty)recomputeNet(st);
    tickBuildings(st);
    if(st.netDirty)recomputeNet(st);
    tickEnergy(st);
    tickPackets(st);
    tickShells(st);
    tickRelics(st);
  }
  tickFX(st);
}
