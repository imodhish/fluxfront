/* ============================================================
   FLUXFRONT — terrain generation, emitter placement, new game
   ============================================================ */

import {COLS,ROWS,CELL,W,H,DIFFS,mulberry32,idx,inB,clamp,lerp,dist} from './constants.js';
import {S,el,cam,terCan,setS,setShake,setTerCan} from './state.js';
import {banner,setPaused,setSpeed,cancelModes,refreshButtons,updateInfo} from './ui.js';
import {msg} from './render.js';

/* ---------- terrain ---------- */
export const TER_LEVELS=12;
export function genTerrain(rng){
  const ter=new Int8Array(COLS*ROWS);
  const field=new Float32Array(COLS*ROWS);
  let amp=1, scale=12, total=0;
  for(let o=0;o<3;o++){
    const gw=Math.ceil(COLS/scale)+2, gh=Math.ceil(ROWS/scale)+2;
    const g=new Float32Array(gw*gh);
    for(let i=0;i<g.length;i++)g[i]=rng();
    for(let y=0;y<ROWS;y++){
      for(let x=0;x<COLS;x++){
        const fx=x/scale, fy=y/scale;
        let x0=Math.floor(fx), y0=Math.floor(fy);
        if(x0>gw-2)x0=gw-2;
        if(y0>gh-2)y0=gh-2;
        const tx=fx-x0, ty=fy-y0;
        const sx=tx*tx*(3-2*tx), sy=ty*ty*(3-2*ty);
        const a=g[y0*gw+x0], b=g[y0*gw+x0+1], c=g[(y0+1)*gw+x0], d=g[(y0+1)*gw+x0+1];
        field[idx(x,y)]+=amp*lerp(lerp(a,b,sx),lerp(c,d,sx),sy);
      }
    }
    total+=amp; amp*=0.5; scale=Math.max(3,Math.floor(scale/2));
  }
  let mn=1e9, mx=-1e9;
  for(let i=0;i<field.length;i++){const v=field[i]/total; field[i]=v; if(v<mn)mn=v; if(v>mx)mx=v;}
  const span=(mx-mn)||1;
  // plateau-biased terracing: ~80% of each height band snaps flat, so the
  // map is dominated by buildable plateaus with crisp single-level steps
  for(let i=0;i<field.length;i++){
    const t=((field[i]-mn)/span)*(TER_LEVELS-0.8);
    const f=Math.floor(t), fr=t-f;
    const lv=1+f+(fr>0.8?1:0);
    ter[i]=lv<1?1:(lv>TER_LEVELS?TER_LEVELS:lv);
  }
  // two passes of 3×3 majority smoothing: merges flats, removes speck cells
  const tmp=new Int8Array(COLS*ROWS);
  const cnt=new Int8Array(TER_LEVELS+1);
  for(let it=0;it<2;it++){
    for(let y=0;y<ROWS;y++){
      for(let x=0;x<COLS;x++){
        cnt.fill(0);
        for(let dy=-1;dy<=1;dy++){
          for(let dx=-1;dx<=1;dx++){
            const xx=clamp(x+dx,0,COLS-1), yy=clamp(y+dy,0,ROWS-1);
            cnt[ter[idx(xx,yy)]]++;
          }
        }
        let best=ter[idx(x,y)], bc=0;
        for(let v=1;v<=TER_LEVELS;v++)if(cnt[v]>bc){bc=cnt[v];best=v;}
        tmp[idx(x,y)]=best;
      }
    }
    ter.set(tmp);
  }
  return ter;
}

export function placeEmitters(st){
  const rng=st.rng, n=st.diff.emitters, ems=[];
  let guard=0;
  while(ems.length<n && guard++<4000){
    let best=null, bestH=1e9;
    for(let s=0;s<60;s++){
      const x=8+Math.floor(rng()*(COLS-16)), y=8+Math.floor(rng()*(ROWS-16));
      let ok=true;
      for(const e of ems){ if(dist(x,y,e.cx,e.cy)<20){ok=false;break;} }
      if(!ok)continue;
      const h=st.ter[idx(x,y)];
      if(h<bestH){bestH=h;best={x:x,y:y};}
    }
    if(best){
      // strength tier: some emitters match, some don't — Massive ones are
      // priority targets (weights: 25/35/25/15 %)
      const r=rng();
      const str=r<0.25?0.8:(r<0.6?1:(r<0.85?1.5:2.2));
      ems.push({cx:best.x,cy:best.y,alive:true,t:rng()*0.7,pulse:rng()*6,str:str});
    }
    else break;
  }
  for(const e of ems)carveBasin(st,e.cx,e.cy);
  // personalities: a Boss anchors INSANE, Breeders multiply, Migrants flee
  if(st.diff.key==='insane'&&ems.length){
    let bi=0;
    for(let i=1;i<ems.length;i++)if(ems[i].str>ems[bi].str)bi=i;
    ems[bi].kind='boss'; ems[bi].str=3.0; ems[bi].shield=1;
  }
  const pool=ems.filter(e=>!e.kind);
  if(pool.length&&st.diff.key!=='easy'&&rng()<0.7){
    const e=pool[Math.floor(rng()*pool.length)];
    e.kind='breeder'; e.breedT=0;
  }
  const pool2=ems.filter(e=>!e.kind);
  if(pool2.length&&(st.diff.key==='hard'||st.diff.key==='insane')&&rng()<0.6){
    pool2[Math.floor(rng()*pool2.length)].kind='migrant';
  }
  // magma: a hard/insane emitter whose Flux solidifies into rock, slowly
  // entombing the map (the inverse of erosion)
  const pool3=ems.filter(e=>!e.kind);
  if(pool3.length&&(st.diff.key==='hard'||st.diff.key==='insane')&&rng()<0.6){
    pool3[Math.floor(rng()*pool3.length)].kind='magma';
  }
  for(const e of ems)if(!e.kind)e.kind='std';
  st.emitters=ems;
}
export function carveBasin(st,cx,cy){
  const base=Math.max(1,st.ter[idx(cx,cy)]-1);
  for(let dy=-2;dy<=2;dy++){
    for(let dx=-2;dx<=2;dx++){
      const x=cx+dx, y=cy+dy;
      if(!inB(x,y))continue;
      const d=Math.hypot(dx,dy);
      if(d<=2.5){
        const i=idx(x,y);
        const target=base+(d>1.5?1:0);
        if(st.ter[i]>target)st.ter[i]=target;
        if(st.ter[i]<1)st.ter[i]=1;
      }
    }
  }
}
export function placeSporeTowers(st){
  const rng=st.rng, n=st.diff.spores||0, ts=[];
  let guard=0;
  while(ts.length<n && guard++<3000){
    const x=8+Math.floor(rng()*(COLS-16)), y=8+Math.floor(rng()*(ROWS-16));
    const h=st.ter[idx(x,y)];
    let ok=h>=4&&h<=9;
    if(ok)for(const e of st.emitters)if(dist(x,y,e.cx,e.cy)<12){ok=false;break;}
    if(ok)for(const t of ts)if(dist(x,y,t.cx,t.cy)<25){ok=false;break;}
    if(!ok)continue;
    ts.push({cx:x,cy:y,alive:true,next:120+rng()*30,pulse:rng()*6});
  }
  st.sporeTowers=ts;
}

/* relics live on dangerous high ground, far from each other and from
   emitters — claiming one means stretching the network somewhere exposed */
export function placeRelics(st){
  const rng=st.rng, kinds=['rate','speed','energy'];
  const rls=[];
  let guard=0;
  while(rls.length<3 && guard++<3000){
    const x=6+Math.floor(rng()*(COLS-12)), y=6+Math.floor(rng()*(ROWS-12));
    if(st.ter[idx(x,y)]<8)continue;
    let ok=true;
    for(const r of rls)if(dist(x,y,r.cx,r.cy)<30){ok=false;break;}
    for(const e of st.emitters)if(dist(x,y,e.cx,e.cy)<10){ok=false;break;}
    if(!ok)continue;
    rls.push({cx:x,cy:y,kind:kinds[rls.length],claimed:false,prog:0});
  }
  st.relics=rls;
}

/* totems generate aether for the Forge while a connected backbone holds
   them — mid-elevation, contested ground */
export function placeTotems(st){
  const rng=st.rng, ts=[];
  let guard=0;
  while(ts.length<3 && guard++<3000){
    const x=6+Math.floor(rng()*(COLS-12)), y=6+Math.floor(rng()*(ROWS-12));
    const h=st.ter[idx(x,y)];
    let ok=h>=5&&h<=9;
    if(ok)for(const t of ts)if(dist(x,y,t.cx,t.cy)<35){ok=false;break;}
    if(ok)for(const e of st.emitters)if(dist(x,y,e.cx,e.cy)<8){ok=false;break;}
    if(ok)for(const r of st.relics)if(dist(x,y,r.cx,r.cy)<6){ok=false;break;}
    if(!ok)continue;
    ts.push({cx:x,cy:y,on:false});
  }
  st.totems=ts;
}

/* aether crystal nodes: a second Forge resource you mine with a Harvester,
   scattered on buildable mid-ground away from emitters/totems */
export function placeNodes(st){
  const rng=st.rng, ns=[];
  let guard=0;
  while(ns.length<5 && guard++<3000){
    const x=5+Math.floor(rng()*(COLS-10)), y=5+Math.floor(rng()*(ROWS-10));
    const h=st.ter[idx(x,y)];
    let ok=h>=4&&h<=9;
    if(ok)for(const e of st.emitters)if(dist(x,y,e.cx,e.cy)<10){ok=false;break;}
    if(ok)for(const t of st.totems)if(dist(x,y,t.cx,t.cy)<8){ok=false;break;}
    if(ok)for(const n of ns)if(dist(x,y,n.cx,n.cy)<20){ok=false;break;}
    if(ok)for(const r of st.relics)if(dist(x,y,r.cx,r.cy)<6){ok=false;break;}
    if(!ok)continue;
    ns.push({cx:x,cy:y});
  }
  st.nodes=ns;
}

/* ---------- terrain visual bake ----------
   Real per-pixel relief work: cell heights are resampled into a domain-
   warped, terrace-sharpened height field, shaded with cast sun shadows,
   material splatting, Blinn specular, AO and organic contours. Visual
   only — the sim reads st.ter cells. The heavy intermediates (noise
   fields, height map, shadow map) are cached per seed so the Terraformer
   can repaint just the changed region via retileTerrain(). */
// designed cool→warm relief: violet-blue basins (where Flux pools) climbing
// through slate/teal lowlands to warm sunlit sage→ochre→sandstone highlands
const PAL=[null,
  [26,22,46],[31,30,60],[36,44,73],[42,58,82],
  [50,72,88],[62,84,90],[80,92,84],[100,102,78],
  [122,114,80],[146,128,88],[170,146,102],[194,168,124]
];
// supersampling: the terrain is baked at SS× the logical size and drawn back
// down (true SSAA), so cliff edges and contours are crisp and zoom-in stays
// sharp. SS is adaptive — full on small/medium maps, off on huge ones to keep
// bake time sane. BW/BH = bake pixel dims, CPX = bake pixels per cell.
let SS=1, BW, BH, CPX, BCW, BCH, BSW, BSH;
const LV=5.5;                                    // visual px height per level (×SS in bake space)
let bakeSeed=NaN, bk=null;

function ensureBake(st){
  if(bk && bakeSeed===st.seed && BW===Math.round(W*SS))return;
  bakeSeed=st.seed;
  BW=Math.round(W*SS); BH=Math.round(H*SS); CPX=CELL*SS;
  BCW=(BW>>2)+2; BCH=(BH>>2)+2; BSW=BW>>1; BSH=BH>>1;
  const seed=st.seed|0;
  const hash=(x,y)=>{
    let n=(Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(seed,69069))|0;
    n=Math.imul(n^(n>>>13),1274126177);
    return ((n^(n>>>16))>>>0)/4294967296;
  };
  const vnoise=(x,y,s)=>{
    const x0=Math.floor(x), y0=Math.floor(y);
    const fx=x-x0, fy=y-y0;
    const sx=fx*fx*(3-2*fx), sy=fy*fy*(3-2*fy);
    const a=hash(x0+s,y0), b=hash(x0+1+s,y0), d2=hash(x0+s,y0+1), e=hash(x0+1+s,y0+1);
    return a+(b-a)*sx+(d2-a)*sy+(a-b-d2+e)*sx*sy;
  };
  // low-frequency fields on a coarse 4 px grid (smooth → bilinear upsample
  // is visually lossless and ~16× cheaper)
  const warpX=new Float32Array(BCW*BCH), warpY=new Float32Array(BCW*BCH);
  const dustF=new Float32Array(BCW*BCH), minF=new Float32Array(BCW*BCH);
  const detF=new Float32Array(BCW*BCH);
  // noise feature sizes are expressed in world pixels, so divide bake-px by SS
  for(let cy=0;cy<BCH;cy++){
    for(let cx=0;cx<BCW;cx++){
      const i=cy*BCW+cx, X=cx*4/SS, Y=cy*4/SS;
      warpX[i]=(vnoise(X/26,Y/26,51173)-0.5)*8*SS;
      warpY[i]=(vnoise(X/26,Y/26,94007)-0.5)*8*SS;
      dustF[i]=vnoise(X/95,Y/95,4242);
      minF[i] =vnoise(X/70,Y/70,5151);
      detF[i] =(vnoise(X/7,Y/7,1717)-0.5)*1.2;
    }
  }
  // fine surface-detail height (fBm), full bake res — its gradient gives a
  // micro-normal so flat ground catches the raking light (tactile texture)
  bk={hash,vnoise,warpX,warpY,dustF,minF,detF,
      hm:new Float32Array(BW*BH),
      shad:new Float32Array(BSW*BSH),
      pad:new Float32Array((COLS+2)*(ROWS+2))};
}
function csamp(fld,x,y){
  const gx=x*0.25, gy=y*0.25;
  const x0=gx|0, y0=gy|0;
  const fx=gx-x0, fy=gy-y0;
  const i=y0*BCW+x0;
  const a=fld[i], b=fld[i+1], c2=fld[i+BCW], d2=fld[i+BCW+1];
  return a+(b-a)*fx+(c2-a)*fy+(a-b-c2+d2)*fx*fy;
}
const sharpT=t=>{const u=t*t*(3-2*t);return u*u*(3-2*u);};  // keeps terraces crisp

// smooth height field with wandering terrace edges (region-updatable)
function rebuildHm(st,x0,y0,x1,y1){
  const hm=bk.hm, pad=bk.pad, ter=st.ter, PW=COLS+2;
  for(let cy=-1;cy<=ROWS;cy++)
    for(let cx=-1;cx<=COLS;cx++)
      pad[(cy+1)*PW+cx+1]=clamp(ter[idx(clamp(cx,0,COLS-1),clamp(cy,0,ROWS-1))],1,TER_LEVELS);
  for(let y=y0;y<y1;y++){
    for(let x=x0;x<x1;x++){
      const gx=(x+csamp(bk.warpX,x,y))/CPX-0.5, gy=(y+csamp(bk.warpY,x,y))/CPX-0.5;
      const xx=Math.floor(gx), yy=Math.floor(gy);
      const sx=sharpT(gx-xx), sy=sharpT(gy-yy);
      const pi=(yy+1)*PW+xx+1;
      const h00=pad[pi], h10=pad[pi+1], h01=pad[pi+PW], h11=pad[pi+PW+1];
      hm[y*BW+x]=h00+(h10-h00)*sx+(h01-h00)*sy+(h00-h10-h01+h11)*sx*sy;
    }
  }
}
// cast shadows at half resolution; jitter hides step banding and the
// bilinear upsample doubles as soft shadow edges
function rebuildShadows(x0,y0,x1,y1){
  const hm=bk.hm, shad=bk.shad, hash=bk.hash;
  const sx0=Math.max(0,x0>>1), sy0=Math.max(0,y0>>1);
  const sx1=Math.min(BSW,(x1+1)>>1), sy1=Math.min(BSH,(y1+1)>>1);
  for(let sy=sy0;sy<sy1;sy++){
    for(let sx=sx0;sx<sx1;sx++){
      const x=sx*2, y=sy*2;
      const h0=hm[y*BW+x];
      let s=1;
      const j=hash(x,y)*1.9;
      for(let k=1;k<=14;k++){
        const dw=k*2.8+j, dd=dw*SS;             // world-px step → bake-px offset
        let xx=(x-0.748*dd+0.5)|0, yy=(y-0.663*dd+0.5)|0;
        if(xx<0)xx=0; if(yy<0)yy=0;
        if(hm[yy*BW+xx]>h0+dw*0.1227+0.22){s=0.5;break;}
      }
      shad[sy*BSW+sx]=s;
    }
  }
}
function shAt(x,y){
  const shad=bk.shad;
  const gx=Math.min(x*0.5,BSW-1.001), gy=Math.min(y*0.5,BSH-1.001);
  const x0=gx|0, y0=gy|0;
  const fx=gx-x0, fy=gy-y0;
  const i=y0*BSW+x0;
  const a=shad[i], b=shad[i+1], c2=shad[i+BSW], d2=shad[i+BSW+1];
  return a+(b-a)*fx+(c2-a)*fy+(a-b-c2+d2)*fx*fy;
}
// materials (rock/dust/mineral/mud) + lambert with cast shadows, blinn
// specular, AO and organic contours, written for an arbitrary region
function shadeRegion(c,x0r,y0r,x1r,y1r){
  const hm=bk.hm, hash=bk.hash, vnoise=bk.vnoise;
  const RW=x1r-x0r;
  const img=c.createImageData(RW,y1r-y0r);
  const d=img.data;
  const Lx=-0.62, Ly=-0.55, Lz=0.56;             // light from NW, elevated
  const Hx=-0.351, Hy=-0.311, Hz=0.883;          // blinn half-vector (top-down view)
  const LVS=LV*SS;                               // relief slope scales with bake res
  const T5=Math.max(1,Math.round(5*SS));         // AO sample radius (world ~5px)
  for(let y=y0r;y<y1r;y++){
    const yu=y>0?-BW:0, yd=y<BH-1?BW:0;
    const y5u=(y>=T5?-T5*BW:-y*BW), y5d=(y<BH-T5?T5*BW:(BH-1-y)*BW);
    for(let x=x0r;x<x1r;x++){
      const i=y*BW+x;
      const h=hm[i];
      const xl=x>0?-1:0, xr=x<BW-1?1:0;
      const x5l=(x>=T5?-T5:-x), x5r=(x<BW-T5?T5:(BW-1-x));
      const dzx=(hm[i+xr]-hm[i+xl])*0.5*LVS;
      const dzy=(hm[i+yd]-hm[i+yu])*0.5*LVS;
      const inv=1/Math.sqrt(dzx*dzx+dzy*dzy+1);
      const diff=Math.max(0,(-dzx*Lx-dzy*Ly+Lz)*inv);
      const slope=Math.sqrt(dzx*dzx+dzy*dzy);
      const hi=h<1?1:(h>11.999?11.999:h);
      const i0=hi|0, f=hi-i0;
      const A=PAL[i0], B=PAL[i0+1];
      let r=A[0]+(B[0]-A[0])*f, g=A[1]+(B[1]-A[1])*f, b2=A[2]+(B[2]-A[2])*f;
      const det=csamp(bk.detF,x,y);
      if(slope<0.35&&h>5){                        // warm windblown dust on high flats
        const k=Math.max(0,csamp(bk.dustF,x,y)-0.42)*0.6;
        r+=(196-r)*k; g+=(160-g)*k; b2+=(104-b2)*k;
      }
      if(h<7&&slope<0.5){                        // teal-green mineral seams in lowlands
        const k=Math.max(0,csamp(bk.minF,x,y)-0.52)*0.55;
        r+=(40-r)*k; g+=(118-g)*k; b2+=(108-b2)*k;
      }
      let strata=1, spec=0.07;
      if(slope>0.42){                            // exposed cliff rock — warm stone + rust
        const rk=Math.min(1,(slope-0.42)*1.5);
        const ridge=1-Math.abs(vnoise(x/(5*SS),y/(11*SS),6363)*2-1);
        r+=(96-r)*rk*0.55; g+=(80-g)*rk*0.55; b2+=(66-b2)*rk*0.55;
        const rust=Math.max(0,vnoise(x/(22*SS),y/(22*SS),7474)-0.5)*rk;
        r+=(150-r)*rust; g+=(86-g)*rust; b2+=(54-b2)*rust;
        strata=1+rk*(0.12*Math.sin(h*12.6)+0.13*(ridge-0.5));
        spec=0.15;
        const gl=1/slope;
        const ux=dzx*gl, uy=dzy*gl;              // downhill unit
        const u=x*ux+y*uy, w=-x*uy+y*ux;
        strata*=1+0.11*(vnoise(w/(2.3*SS),u/(24*SS),8585)-0.5)*rk;   // erosion streaks
      }
      if(h<2.3){                                 // dark mud-cracked basin sediment (wet)
        if(Math.abs(vnoise(x/(9*SS),y/(9*SS),9696)-0.5)<0.025)strata*=0.78;
        spec=0.45*(2.3-h);                       // wet sheen
        const k=(2.3-h)*0.42;
        r+=(24-r)*k; g+=(22-g)*k; b2+=(50-b2)*k;
      }
      const shv=shAt(x,y);
      const dl=diff*shv;                          // clean terrain normal — smooth, flat surfaces
      // higher-contrast key light, warm sun / cool shadow split for depth
      const lr=(0.40*0.86+0.98*dl*1.16)*strata;  // warm sun
      const lg=(0.40*0.95+0.98*dl*1.00)*strata;
      const lb=(0.40*1.22+0.98*dl*0.80)*strata;  // cool ambient
      let s0=Math.max(0,(-dzx*Hx-dzy*Hy+Hz)*inv);     // pow(s0,24) by squaring
      s0*=s0; s0*=s0; const s8=s0*s0;                 // s0 is now ^4
      const sp=s8*s8*s8*spec*shv;
      const havg=(hm[i+x5r]+hm[i+x5l]+hm[i+y5d]+hm[i+y5u])*0.25;
      const ao=1-Math.min(0.5,Math.max(0,(havg-h)*0.55));   // deeper crevice shade
      const lvl=Math.round(h);
      const ck=(Math.round(hm[i+xr])!==lvl||Math.round(hm[i+yd])!==lvl)?0.78:1;
      const gr=1+det*0.09;                         // gentle low-freq mottle only — no grain
      let R=(r*lr)*ao*ck*gr*1.1+sp*210-4;
      let G=(g*lg)*ao*ck*gr*1.1+sp*215-4;
      let Bv=(b2*lb)*ao*ck*gr*1.1+sp*225-4;
      // sunward crest catch-light: warm rim on NW-facing top edges (chisels plateaus)
      const crest=Math.max(h-hm[i+yu],h-hm[i+xl]);
      if(crest>0.3){
        const rim=Math.min(0.7,(crest-0.3)*1.1)*shv*(0.4+0.6*diff);
        R+=rim*66; G+=rim*55; Bv+=rim*36;
      }
      // grade: saturation + warm-highlight / cool-shadow + gentle contrast
      let rr=R/255, gg=G/255, bb=Bv/255;
      const lum=rr*0.299+gg*0.587+bb*0.114;
      rr=lum+(rr-lum)*1.13; gg=lum+(gg-lum)*1.13; bb=lum+(bb-lum)*1.13;
      const wc=lum-0.5;
      rr+=wc*0.045; bb-=wc*0.05;
      // aerial perspective: sunlit highlands warm, deep basins recede cooler
      if(h>8){const wm=(h-8)*0.018; rr+=wm; bb-=wm;}
      else if(h<3.5){const cz=(3.5-h)*0.03; bb+=cz; rr-=cz*0.6;}
      rr=(rr-0.5)*1.07+0.5; gg=(gg-0.5)*1.07+0.5; bb=(bb-0.5)*1.07+0.5;
      const p=((y-y0r)*RW+(x-x0r))*4;
      d[p]=rr*255; d[p+1]=gg*255; d[p+2]=bb*255; d[p+3]=255;
    }
  }
  c.putImageData(img,x0r,y0r);
}
function drawGridRegion(c,x0,y0,x1,y1){
  c.strokeStyle='rgba(130,160,190,0.035)'; c.lineWidth=1; c.beginPath();
  for(let x=Math.ceil(x0/CPX)*CPX;x<=x1;x+=CPX){ c.moveTo(x+0.5,y0); c.lineTo(x+0.5,y1); }
  for(let y=Math.ceil(y0/CPX)*CPX;y<=y1;y+=CPX){ c.moveTo(x0,y+0.5); c.lineTo(x1,y+0.5); }
  c.stroke();
}
export function prerenderTerrain(st){
  // adaptive supersampling: 2× small maps, 1.5× large, off on huge (bake cost)
  const cells=COLS*ROWS;
  SS=cells<=10300?2:(cells<=16200?1.5:1);
  const can=document.createElement('canvas');
  can.width=Math.round(W*SS); can.height=Math.round(H*SS);
  const c=can.getContext('2d');
  bakeSeed=NaN;                                  // fresh cache per new map
  ensureBake(st);
  rebuildHm(st,0,0,BW,BH);
  rebuildShadows(0,0,BW,BH);
  shadeRegion(c,0,0,BW,BH);
  // seeded decor: boulders (lit, with SE drop shadow), scree at cliff bases,
  // sand ripples on flats, dark stains in basins. Separate rng — never
  // consume st.rng, which drives the sim. Coords in bake pixels.
  const hAt=(cx,cy)=>clamp(st.ter[idx(clamp(cx,0,COLS-1),clamp(cy,0,ROWS-1))],1,TER_LEVELS);
  const drng=mulberry32(((st.seed|0)^0x9E3779B9)|0);
  const ND=Math.round(COLS*ROWS/22);
  for(let i=0;i<ND;i++){
    const x=drng()*BW, y=drng()*BH;
    const cx=(x/CPX)|0, cy=(y/CPX)|0;
    const h=hAt(cx,cy);
    const relief=Math.abs(hAt(cx+1,cy)-hAt(cx-1,cy))+Math.abs(hAt(cx,cy+1)-hAt(cx,cy-1));
    const r=(0.7+drng()*2.3)*SS;
    if(relief>=2){                                 // scree debris at the foot of cliffs
      const tn=drng();
      for(let s=0;s<5;s++){
        const sx=x+(drng()-0.5)*8*SS, sy=y+(drng()-0.5)*8*SS+r;
        c.fillStyle='rgba('+(64+(tn*46|0))+','+(54+(tn*30|0))+','+(46+(tn*18|0))+','+(0.22+drng()*0.28).toFixed(2)+')';
        c.beginPath(); c.arc(sx,sy,(0.5+drng()*1.3)*SS,0,Math.PI*2); c.fill();
      }
    }else if(h>=7){                                // highland boulder, NW-lit
      c.fillStyle='rgba(0,0,0,0.30)';              // SE cast shadow
      c.beginPath(); c.ellipse(x+r*0.55,y+r*0.6,r*1.05,r*0.66,0,0,Math.PI*2); c.fill();
      const bv=92+(drng()*38|0);                   // rock body
      c.fillStyle='rgb('+bv+','+(bv-7)+','+(bv-18)+')';
      c.beginPath(); c.ellipse(x,y,r,r*0.85,0,0,Math.PI*2); c.fill();
      c.fillStyle='rgba(255,242,212,0.20)';        // NW catch-light
      c.beginPath(); c.ellipse(x-r*0.32,y-r*0.34,r*0.5,r*0.4,0,0,Math.PI*2); c.fill();
    }else if(h>=4&&relief<1){                      // wind ripples on open flats
      c.strokeStyle='rgba(210,180,120,0.10)'; c.lineWidth=SS;
      c.beginPath();
      for(let s=-1;s<=1;s++){const yy=y+s*3*SS; c.moveTo(x-5*SS,yy); c.quadraticCurveTo(x,yy-1.6*SS,x+5*SS,yy);}
      c.stroke();
    }else if(h<=3){                                // basin sediment stain
      c.fillStyle='rgba(8,13,30,0.26)';
      c.beginPath(); c.arc(x,y,r*2.2,0,Math.PI*2); c.fill();
    }
  }
  drawGridRegion(c,0,0,BW,BH);                    // faint build grid
  setTerCan(can);
}
/* repaint just the pixels affected by a terrain edit (Terraformer). The
   patch extends SE beyond the cells because cliffs cast shadows that way,
   and the height field is rebuilt with extra NW margin the shadow rays
   sample from. */
export function retileTerrain(st,gx0,gy0,gx1,gy1){
  if(!terCan)return;
  ensureBake(st);
  const m14=14*SS, m54=54*SS, m12=12*SS;          // patch margins in bake px
  const bx0=clamp(gx0*CPX-m14,0,BW), by0=clamp(gy0*CPX-m14,0,BH);
  const bx1=clamp((gx1+1)*CPX+m54,0,BW), by1=clamp((gy1+1)*CPX+m54,0,BH);
  rebuildHm(st,clamp(bx0-m54,0,BW),clamp(by0-m54,0,BH),clamp(bx1+m12,0,BW),clamp(by1+m12,0,BH));
  rebuildShadows(bx0,by0,bx1,by1);
  const c=terCan.getContext('2d');
  shadeRegion(c,Math.floor(bx0),Math.floor(by0),Math.ceil(bx1),Math.ceil(by1));
  drawGridRegion(c,bx0,by0,bx1,by1);
}

/* ---------- new game ---------- */
export function newGame(dk,fixedSeed,opts){
  const seed=fixedSeed!==undefined?(fixedSeed|0):((Math.random()*4294967296)|0);
  const rng=mulberry32(seed);
  setS({
    seed:seed, rng:rng, diff:DIFFS[dk], t:0, phase:'placeCore',
    ter:null, occ:new Int16Array(COLS*ROWS).fill(-1),
    creep:new Float32Array(COLS*ROWS), buf:new Float32Array(COLS*ROWS),
    buildings:[], byId:new Map(), nextId:1, coreId:0, rr:0,
    emitters:[], packets:[], shells:[], shots:[], parts:[], msgs:[],
    energy:0, cap:0, prod:0, netDirty:true, dispT:0, linkPairs:[],
    stats:{built:0,lost:0,packets:0,flux:0,emitters:0,coresLost:0,frozen:0,terra:0},
    spend:{acc:0,t:0,rate:0},
    pzones:[], relics:[], buffs:{rate:0,pspeed:0,prod:0},
    surge:{next:0,end:0,active:false,warned:false},
    weather:{next:0,end:0,active:false,warned:false},
    ero:new Float32Array(COLS*ROWS), lastEroMsg:-99,
    anti:new Float32Array(COLS*ROWS), antiBuf:new Float32Array(COLS*ROWS), _antiAny:false,
    spores:[], sporeTowers:[],
    supplyMode:'balanced', dispFlip:false,
    aether:0, forge:{rate:6,speed:5,energy:5,dmg:6}, totems:[], nodes:[],
    digi:new Uint8Array(COLS*ROWS), runners:[], runT:0,
    slow:new Float32Array(COLS*ROWS), pylonSpeed:0,
    ice:[], tickN:0, coreDown:false, reclaimT:0,
    daily:!!(opts&&opts.daily), dailyKey:(opts&&opts.dailyKey)||'',
    mods:(opts&&opts.mods)||{}, sandbox:!!(opts&&opts.sandbox)
  });
  S.ter=genTerrain(rng);
  placeEmitters(S);
  placeSporeTowers(S);
  placeRelics(S);
  placeTotems(S);
  placeNodes(S);
  S.surge.next=(S.mods.frenzy?45:90)+rng()*60;
  S.weather.next=140+rng()*80;
  S.buffs.dmg=0;
  prerenderTerrain(S);
  cancelModes(); setShake(0);
  cam.x=0; cam.y=0; cam.z=1;
  setPaused(false); setSpeed(1);
  el.menu.classList.remove('show');
  el.end.classList.remove('show');
  el.help.classList.remove('show');
  el.btnResume.classList.add('hide');
  banner(true,'DEPLOY COMMAND CORE — click or tap a safe zone, well away from the Emitters');
  refreshButtons(); updateInfo(true);
  msg('Flux Emitters detected. Deploy your Command Core.','#4df0c8');
}
