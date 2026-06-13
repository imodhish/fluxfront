/* ============================================================
   FLUXFRONT — canvas rendering & toast messages
   ============================================================ */

import {COLS,ROWS,CELL,W,H,TYPES,clamp,lerp,dist,idx} from './constants.js';
import {S,sel,selBuild,delMode,moveSrc,moveMode,moveGroup,terraTarget,ghost,hover,paused,shake,settings,showRanges,marquee,terCan,creepCan,cctx,creepImg,ctx,cam,dpr,uiScale,miniCv,miniCtx} from './state.js';
import {canPlace,MOVABLE} from './sim.js';
import {linkTargets} from './net.js';
import {updateHUD} from './ui.js';

/* ---------- fx sprites (pre-rendered, lazy) ---------- */
const glowCache=new Map();
let vigCan=null, redVigCan=null, scanCan=null;
const spawnMap=new Map();
let spawnS=null;

function glowSprite(col){
  let s=glowCache.get(col);
  if(!s){
    s=document.createElement('canvas');
    s.width=64; s.height=64;
    const c=s.getContext('2d');
    const g=c.createRadialGradient(32,32,0,32,32,32);
    if(g && g.addColorStop){
      g.addColorStop(0,col);
      g.addColorStop(0.35,col+'66');
      g.addColorStop(1,col+'00');
      c.fillStyle=g;
    }
    c.fillRect(0,0,64,64);
    glowCache.set(col,s);
  }
  return s;
}
function drawGlow(x,y,r,col,a){
  ctx.save();
  ctx.globalCompositeOperation='lighter';
  ctx.globalAlpha=a;
  ctx.drawImage(glowSprite(col),x-r,y-r,r*2,r*2);
  ctx.restore();
}
function vignetteSprite(col0,col1){
  const can=document.createElement('canvas');
  can.width=W; can.height=H;
  const c=can.getContext('2d');
  const g=c.createRadialGradient(W/2,H/2,H*0.42,W/2,H/2,H*0.95);
  if(g && g.addColorStop){
    g.addColorStop(0,col0);
    g.addColorStop(1,col1);
    c.fillStyle=g;
  }
  c.fillRect(0,0,W,H);
  return can;
}
function ensureFX(){
  if(vigCan)return;
  vigCan=vignetteSprite('rgba(5,8,14,0)','rgba(5,8,14,0.5)');
  redVigCan=vignetteSprite('rgba(255,40,60,0)','rgba(255,40,60,0.4)');
  scanCan=document.createElement('canvas');
  scanCan.width=W; scanCan.height=H;
  const c=scanCan.getContext('2d');
  c.fillStyle='rgba(0,0,0,0.10)';
  for(let y=0;y<H;y+=3)c.fillRect(0,y,W,1);
}
/* drop all W×H-sized caches so they rebuild at a new map size */
export function resetVisuals(){
  vigCan=null; redVigCan=null; scanCan=null; frameCan=null; mmTerr=null; mmTerrKey=NaN;
}
/* full-frame bloom: downscale the rendered frame (= blur), crush the midtones
   so only highlights survive (cheap bright-pass), then add it back — Flux,
   emitters, beams and explosions glow cinematically. Cheap, toggleable. */
let bloomCan=null, bloomCtx=null;
function drawBloom(){
  const cv=ctx&&ctx.canvas;
  if(!settings.bloom || !cv || !cv.width)return;
  const bw=Math.max(1,cv.width>>2), bh=Math.max(1,cv.height>>2);
  if(!bloomCan){bloomCan=document.createElement('canvas');bloomCtx=bloomCan.getContext('2d');}
  if(bloomCan.width!==bw||bloomCan.height!==bh){bloomCan.width=bw;bloomCan.height=bh;}
  const b=bloomCtx;
  if(!b||!b.setTransform)return;
  b.setTransform(1,0,0,1,0,0); b.globalCompositeOperation='source-over'; b.globalAlpha=1;
  b.imageSmoothingEnabled=true;
  b.clearRect(0,0,bw,bh);
  b.drawImage(cv,0,0,cv.width,cv.height,0,0,bw,bh);   // downscale → blur
  b.globalCompositeOperation='multiply';               // crush midtones → keep only brights
  b.fillStyle='#6a6a6a'; b.fillRect(0,0,bw,bh);
  b.globalCompositeOperation='source-over';
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalCompositeOperation='lighter';
  ctx.globalAlpha=0.85;
  ctx.imageSmoothingEnabled=true;
  ctx.drawImage(bloomCan,0,0,bw,bh,0,0,cv.width,cv.height);   // upscale (blur) + add
  ctx.restore();
}

/* ---------- messages ---------- */
export function msg(text,col){
  if(!S)return;
  S.msgs.push({text:text,col:col||'#d7e3ee',t:performance.now()});
  if(S.msgs.length>5)S.msgs.shift();
}
export function drawMsgs(){
  if(!S || !S.msgs.length)return;
  const now=performance.now(), u=uiScale;
  ctx.font=(12*u).toFixed(1)+'px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  let y=H-14*u;
  for(let i=S.msgs.length-1;i>=0;i--){
    const m=S.msgs[i], age=(now-m.t)/1000;
    if(age>4.5)continue;
    const a=age<3.8?1:1-(age-3.8)/0.7;
    ctx.globalAlpha=Math.max(0,a)*0.92;
    const w=ctx.measureText(m.text).width;
    ctx.fillStyle='rgba(8,12,20,0.72)';
    ctx.fillRect(8,y-12*u,w+12*u,17*u);
    ctx.fillStyle=m.col;
    ctx.fillText(m.text,8+6*u,y+u);
    y-=20*u;
  }
  ctx.globalAlpha=1;
}

/* ---------- rendering ---------- */
export function dashCircle(x,y,r,col){
  ctx.strokeStyle=col; ctx.lineWidth=1;
  ctx.setLineDash([6,6]);
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.stroke();
  ctx.setLineDash([]);
}
export function renderCreeper(){
  const img=creepImg, d=img.data, c=S.creep;
  const t=performance.now()*0.002;
  const an=S.anti, dg=S.digi;
  for(let i=0,p=0;i<c.length;i++,p+=4){
    const v=c[i];
    if(v<=0.01){
      if(dg[i]){                            // bare digitalis: dark red web
        d[p]=120;d[p+1]=26;d[p+2]=40;d[p+3]=130;
        continue;
      }
      const av=an[i];
      if(av<=0.01){d[p+3]=0;continue;}
      const ad=Math.min(1,av/8);          // friendly Anti-Flux: pale frost
      d[p]=205+40*ad; d[p+1]=238; d[p+2]=255;
      d[p+3]=255*Math.min(0.85,0.22+0.5*ad);
      continue;
    }
    const dep=Math.min(1,v/10);
    const x=i%COLS, row=(i/COLS)|0;
    // glowing rim where the fluid meets dry land
    let rim=0;
    if(x>0&&c[i-1]<=0.01)rim=1;
    else if(x<COLS-1&&c[i+1]<=0.01)rim=1;
    else if(row>0&&c[i-COLS]<=0.01)rim=1;
    else if(row<ROWS-1&&c[i+COLS]<=0.01)rim=1;
    // animated surface waves
    const shim=0.82+0.12*Math.sin(t+x*0.35+row*0.27)+0.06*Math.sin(x*0.9-t*2.2+row*0.15);
    let r=(90-58*dep)*shim, g=(195-130*dep)*shim, b=(255-68*dep)*shim;
    // topographic depth bands in the body of the fluid
    if(v>0.9){
      const bf=(v*0.8)%1;
      if(bf<0.12){r+=40;g+=50;b+=36;}
    }
    if(rim){r=r*0.45+104;g=g*0.45+132;b=b*0.45+140;}
    if(dg[i]){r=r*0.6+70;g*=0.5;b*=0.6;}   // flux riding the web reads redder
    if(settings.colorblind){const t2=r;r=b*0.95+40;b=t2*0.5;g*=0.7;}  // blue→amber, distinct from teal network
    d[p]=r; d[p+1]=g; d[p+2]=b;
    d[p+3]=255*Math.min(0.95,(rim?0.46:0.34)+0.62*Math.min(1,v/6));
  }
  cctx.putImageData(img,0,0);
  ctx.save();
  ctx.imageSmoothingEnabled=true;
  ctx.drawImage(creepCan,0,0,COLS,ROWS,0,0,W,H);
  ctx.globalCompositeOperation='lighter';      // cheap bloom
  ctx.globalAlpha=0.20;
  ctx.drawImage(creepCan,0,0,COLS,ROWS,0,0,W,H);
  ctx.restore();
}
/* translucent network-coverage tint: union of collector + core link radii,
   filled in one path so overlaps don't stack alpha */
export function drawCoverage(){
  ctx.beginPath();
  let any=false;
  for(const b of S.buildings){
    if(!b.alive || !b.built || b.moving)continue;
    if(b.type!=='collector' && b.type!=='core')continue;
    const r=TYPES[b.type].linkR*CELL;
    ctx.moveTo(b.px+r,b.py);
    ctx.arc(b.px,b.py,r,0,Math.PI*2);
    any=true;
  }
  if(!any)return;
  ctx.fillStyle='rgba(77,240,200,0.055)';
  ctx.fill();
  ctx.strokeStyle='rgba(77,240,200,0.11)';
  ctx.lineWidth=1;
  ctx.stroke();
}
export function drawLinks(){
  if(!S.linkPairs.length)return;
  ctx.beginPath();
  for(const pr of S.linkPairs){
    ctx.moveTo(pr[0].px,pr[0].py);
    ctx.lineTo(pr[1].px,pr[1].py);
  }
  ctx.strokeStyle='rgba(77,240,200,0.14)'; ctx.lineWidth=1;
  ctx.stroke();
  ctx.strokeStyle='rgba(77,240,200,0.35)';
  ctx.setLineDash([2,10]);
  ctx.lineDashOffset=-(performance.now()*0.014)%12;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset=0;
}
function ngon(x,y,r,n,rot){
  ctx.beginPath();
  for(let i=0;i<n;i++){
    const a=rot+i*Math.PI*2/n;
    if(i===0)ctx.moveTo(x+Math.cos(a)*r,y+Math.sin(a)*r);
    else ctx.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r);
  }
  ctx.closePath();
}
export function drawEmitters(){
  const now=performance.now()*0.001;
  const sg=S.surge;
  const surgeK=sg&&sg.active?1.25:(sg&&sg.warned?1+0.12*Math.sin(performance.now()*0.012):1);
  for(const e of S.emitters){
    const x=(e.cx+0.5)*CELL, y=(e.cy+0.5)*CELL;
    const k2=(0.72+0.31*(e.str||1))*surgeK;   // bigger when stronger; pulsing during surges
    if(e.captured){                            // captured: friendly Anti-Flux fountain
      drawGlow(x,y,16,'#9ffce4',0.5);
      ctx.save(); ctx.translate(x,y); ctx.scale(k2,k2);
      ctx.fillStyle='#0e2c2a'; ngon(0,0,6.5,7,-now*0.4); ctx.fill();
      ctx.strokeStyle='#9ffce4'; ctx.lineWidth=1.4; ctx.stroke();
      ctx.fillStyle='#cffcf0';
      ctx.beginPath(); ctx.arc(0,0,2.4+0.7*Math.sin(now*5+e.pulse),0,Math.PI*2); ctx.fill();
      ctx.restore();
      continue;
    }
    if(!e.alive){
      // cooled husk
      ctx.save();
      ctx.translate(x,y); ctx.scale(k2,k2);
      ctx.fillStyle='rgba(16,13,22,0.9)';
      ngon(0,0,6.5,7,e.pulse); ctx.fill();
      ctx.strokeStyle='rgba(120,120,140,0.55)'; ctx.lineWidth=1.2; ctx.stroke();
      ctx.strokeStyle='rgba(90,90,105,0.5)'; ctx.lineWidth=1;
      for(let k=0;k<3;k++){
        const a=e.pulse+k*2.1;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a)*2,Math.sin(a)*2);
        ctx.lineTo(Math.cos(a+0.3)*6,Math.sin(a+0.3)*6);
        ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    drawGlow(x,y,(18+4*Math.sin(now*2+e.pulse))*k2,'#ff5340',0.45+0.12*(e.str||1));
    ctx.save();
    ctx.translate(x,y); ctx.scale(k2,k2);
    // molten cracks radiating into the rock
    ctx.strokeStyle='rgba(255,84,52,'+(0.3+0.18*Math.sin(now*3+e.pulse)).toFixed(3)+')';
    ctx.lineWidth=1.4;
    for(let k=0;k<6;k++){
      const a=e.pulse+k*Math.PI/3;
      const r2=12+3*Math.sin(now*1.7+k*1.9+e.pulse);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a)*6.5,Math.sin(a)*6.5);
      ctx.quadraticCurveTo(
        Math.cos(a+0.18)*(6.5+r2)/2+Math.sin(k*7)*2,
        Math.sin(a+0.18)*(6.5+r2)/2+Math.cos(k*5)*2,
        Math.cos(a+0.3)*r2,Math.sin(a+0.3)*r2);
      ctx.stroke();
    }
    // shockwave rings
    for(let k=0;k<2;k++){
      const pr=((now+e.pulse+k*0.8)%1.6)/1.6;
      ctx.strokeStyle='rgba(255,110,70,'+((1-pr)*0.5).toFixed(3)+')';
      ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(0,0,5+pr*16,0,Math.PI*2); ctx.stroke();
    }
    // rotating containment ring
    const rot=now*0.6+e.pulse;
    ctx.strokeStyle='rgba(255,150,90,0.85)'; ctx.lineWidth=1.8;
    for(let k=0;k<3;k++){
      ctx.beginPath();
      ctx.arc(0,0,8.6,rot+k*Math.PI*2/3,rot+k*Math.PI*2/3+1.1);
      ctx.stroke();
    }
    // obsidian body + molten core
    ctx.fillStyle='#1c0e14';
    ngon(0,0,6.5,7,-rot*0.4); ctx.fill();
    ctx.strokeStyle='#ff5340'; ctx.lineWidth=1.4; ctx.stroke();
    ctx.fillStyle='#ff5340';
    ctx.beginPath(); ctx.arc(0,0,3.6,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#ffd2a0';
    ctx.beginPath(); ctx.arc(0,0,1.8+0.6*Math.sin(now*6+e.pulse),0,Math.PI*2); ctx.fill();
    // personality marks
    if(e.kind==='breeder'||e.kind==='migrant'||e.kind==='boss'||e.kind==='magma'){
      ctx.strokeStyle=e.kind==='breeder'?'#7be37b':(e.kind==='migrant'?'#7fd9ff':(e.kind==='magma'?'#ff9d3c':'#b66bff'));
      ctx.lineWidth=1.4;
      ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.arc(0,0,11,now*0.8,now*0.8+Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if(e.shield>0){
      ctx.strokeStyle='rgba(182,107,255,'+(0.55+0.3*Math.sin(now*4)).toFixed(3)+')';
      ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(0,0,13,0,Math.PI*2); ctx.stroke();
    }
    ctx.restore();
  }
}
function poly(pts){
  ctx.beginPath();
  ctx.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i][0],pts[i][1]);
  ctx.closePath();
}
/* ---------- structure sprites ----------
   Each structure body is baked once into a supersampled offscreen sprite —
   icon-quality gradients, bevels and detail are too expensive to redraw per
   frame. Animated parts (turrets, rings, orbs, charge ticks, LEDs) are
   drawn live on top in drawShape. */
const SPRITE_SS=6;
const sprites=new Map();
function blitSprite(key,size,draw){
  let s=sprites.get(key);
  if(s===undefined){
    const can=document.createElement('canvas');
    can.width=can.height=Math.ceil(size*SPRITE_SS);
    const sc=can.getContext('2d');
    sc.scale(SPRITE_SS,SPRITE_SS);
    sc.translate(size/2,size/2);
    draw(sc);
    s={can,size};
    sprites.set(key,s);
  }
  ctx.drawImage(s.can,-s.size/2,-s.size/2,s.size,s.size);
}
function lin(c,x0,y0,x1,y1,stops){
  const g=c.createLinearGradient(x0,y0,x1,y1);
  if(g&&g.addColorStop)for(const s of stops)g.addColorStop(s[0],s[1]);
  return g;
}
function rad(c,r0,r1,stops){
  const g=c.createRadialGradient(0,0,r0,0,0,r1);
  if(g&&g.addColorStop)for(const s of stops)g.addColorStop(s[0],s[1]);
  return g;
}
function rr(c,x,y,w,h,r){
  c.beginPath();
  c.moveTo(x+r,y);
  c.lineTo(x+w-r,y); c.quadraticCurveTo(x+w,y,x+w,y+r);
  c.lineTo(x+w,y+h-r); c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  c.lineTo(x+r,y+h); c.quadraticCurveTo(x,y+h,x,y+h-r);
  c.lineTo(x,y+r); c.quadraticCurveTo(x,y,x+r,y);
  c.closePath();
}
function cpoly(c,pts){
  c.beginPath();
  c.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++)c.lineTo(pts[i][0],pts[i][1]);
  c.closePath();
}
function cngon(c,r,n,rot){
  c.beginPath();
  for(let i=0;i<n;i++){
    const a=rot+i*Math.PI*2/n;
    if(i===0)c.moveTo(Math.cos(a)*r,Math.sin(a)*r);
    else c.lineTo(Math.cos(a)*r,Math.sin(a)*r);
  }
  c.closePath();
}
/* riveted foundation with drop shadow, NW-lit (baked into every sprite) */
function plate(c,s){
  const h=s*0.46;
  c.fillStyle='rgba(0,0,0,0.32)';
  c.beginPath(); c.ellipse(1.5,h*0.55,h*1.08,h*0.5,0,0,Math.PI*2); c.fill();
  c.fillStyle=lin(c,-h,-h,h,h,[[0,'#1f2c40'],[0.5,'#131d2c'],[1,'#0a111d']]);
  rr(c,-h,-h,h*2,h*2,2.5); c.fill();
  c.strokeStyle='rgba(150,190,220,0.3)'; c.lineWidth=0.8; c.stroke();
  c.strokeStyle='rgba(90,120,150,0.25)'; c.lineWidth=0.6;
  rr(c,-h+1.6,-h+1.6,h*2-3.2,h*2-3.2,1.8); c.stroke();
  for(const p of [[-h+2.2,-h+2.2],[h-2.2,-h+2.2],[-h+2.2,h-2.2],[h-2.2,h-2.2]]){
    c.fillStyle='rgba(200,225,245,0.5)';
    c.beginPath(); c.arc(p[0],p[1],0.8,0,Math.PI*2); c.fill();
    c.fillStyle='rgba(0,0,0,0.45)';
    c.beginPath(); c.arc(p[0]+0.25,p[1]+0.25,0.4,0,Math.PI*2); c.fill();
  }
}
function spriteCore(c){
  plate(c,30);
  c.fillStyle=rad(c,1.5,13,[[0,'#26695a'],[0.6,'#123c33'],[1,'#081f1a']]);
  cngon(c,12.5,6,Math.PI/6); c.fill();
  c.strokeStyle='#2f8f78'; c.lineWidth=1.8; c.stroke();
  c.strokeStyle='rgba(170,255,230,0.3)'; c.lineWidth=0.9;
  cngon(c,11,6,Math.PI/6); c.stroke();
  c.strokeStyle='rgba(77,240,200,0.3)'; c.lineWidth=0.9;
  for(let i=0;i<6;i++){
    const a=Math.PI/6+i*Math.PI/3;
    c.beginPath();
    c.moveTo(Math.cos(a)*6.4,Math.sin(a)*6.4);
    c.lineTo(Math.cos(a)*11,Math.sin(a)*11);
    c.stroke();
  }
  for(let i=0;i<6;i++){
    const a=Math.PI/6+i*Math.PI/3;
    const lx=Math.cos(a)*12.5, ly=Math.sin(a)*12.5;
    c.fillStyle='#0a1d19';
    c.beginPath(); c.arc(lx,ly,1.7,0,Math.PI*2); c.fill();
    c.fillStyle='rgba(170,255,235,0.55)';
    c.beginPath(); c.arc(lx-0.4,ly-0.4,0.7,0,Math.PI*2); c.fill();
  }
  c.fillStyle='#04110d';
  c.beginPath(); c.arc(0,0,6.4,0,Math.PI*2); c.fill();
  c.strokeStyle='rgba(130,235,205,0.3)'; c.lineWidth=0.8;
  c.beginPath(); c.arc(0.5,0.5,6.4,Math.PI*0.1,Math.PI*0.6); c.stroke();
}
function spriteCollector(c){
  plate(c,10);
  c.fillStyle='#101c28';
  rr(c,-2,2.6,4,2.2,0.7); c.fill();
  c.fillStyle='#2a8a62'; cpoly(c,[[0,-5.2],[0,0],[-4.4,0]]); c.fill();
  c.fillStyle='#1c6347'; cpoly(c,[[0,-5.2],[4.4,0],[0,0]]); c.fill();
  c.fillStyle='#154a35'; cpoly(c,[[-4.4,0],[0,0],[0,5.2]]); c.fill();
  c.fillStyle='#0e3525'; cpoly(c,[[0,0],[4.4,0],[0,5.2]]); c.fill();
  c.strokeStyle='#74e6a8'; c.lineWidth=1.1;
  cpoly(c,[[0,-5.2],[4.4,0],[0,5.2],[-4.4,0]]); c.stroke();
  c.strokeStyle='rgba(230,255,242,0.85)'; c.lineWidth=0.7;
  c.beginPath(); c.moveTo(-1.1,-3.4); c.lineTo(-0.2,-4.5); c.stroke();
}
function spriteRelay(c){
  plate(c,10);
  c.strokeStyle='#31496b'; c.lineWidth=1.3;
  c.beginPath();
  c.moveTo(-4,4.4); c.lineTo(0,-3.2);
  c.moveTo(4,4.4); c.lineTo(0,-3.2);
  c.stroke();
  c.strokeStyle='#6fb7ff'; c.lineWidth=1.1;
  c.beginPath();
  c.moveTo(0,4.6); c.lineTo(0,-6.4);
  c.moveTo(-2.7,1.6); c.lineTo(2.7,1.6);
  c.moveTo(-1.5,-1.4); c.lineTo(1.5,-1.4);
  c.stroke();
  c.fillStyle='#13243c';
  c.beginPath(); c.ellipse(0,-3.6,2.5,1.1,0,0,Math.PI*2); c.fill();
  c.strokeStyle='rgba(159,208,255,0.7)'; c.lineWidth=0.7; c.stroke();
  c.save(); c.translate(0,-7);
  c.fillStyle=rad(c,0.2,1.8,[[0,'#eaf5ff'],[0.5,'#8cc4ff'],[1,'#2c5687']]);
  c.beginPath(); c.arc(0,0,1.7,0,Math.PI*2); c.fill();
  c.restore();
}
function spriteReactor(c){
  plate(c,20);
  c.fillStyle=lin(c,-8,-8,8,8,[[0,'#574a1f'],[0.5,'#2a2310'],[1,'#161204']]);
  cpoly(c,[[-8,-5.4],[-5.4,-8],[5.4,-8],[8,-5.4],[8,5.4],[5.4,8],[-5.4,8],[-8,5.4]]); c.fill();
  c.strokeStyle='#ffd86b'; c.lineWidth=1.4; c.stroke();
  c.strokeStyle='rgba(90,75,25,0.8)'; c.lineWidth=0.8;
  cpoly(c,[[-6.6,-4.4],[-4.4,-6.6],[4.4,-6.6],[6.6,-4.4],[6.6,4.4],[4.4,6.6],[-4.4,6.6],[-6.6,4.4]]); c.stroke();
  c.fillStyle='rgba(255,216,107,0.3)';
  for(let i=-1;i<=1;i++){
    c.fillRect(-9.5,i*3-0.9,1.7,1.8);
    c.fillRect(7.8,i*3-0.9,1.7,1.8);
  }
  c.save();
  c.translate(5.7,-5.7); c.rotate(Math.PI/4);
  c.fillStyle='#d9b53e'; c.fillRect(-2.6,-0.8,5.2,1.6);
  c.fillStyle='#241d08';
  for(let k=-2;k<=2;k++)c.fillRect(k*1.3-0.3,-0.8,0.65,1.6);
  c.restore();
  c.strokeStyle='rgba(0,0,0,0.55)'; c.lineWidth=2.2;
  c.beginPath(); c.arc(0,0,4.4,0,Math.PI*2); c.stroke();
  c.strokeStyle='rgba(255,225,150,0.25)'; c.lineWidth=0.8;
  c.beginPath(); c.arc(0.4,0.4,4.4,-0.4,1.2); c.stroke();
}
function spriteBattery(c){
  plate(c,10);
  c.fillStyle=lin(c,-3.8,0,3.8,0,[[0,'#3d4a63'],[0.22,'#2a3850'],[0.6,'#1b2436'],[1,'#101727']]);
  rr(c,-3.8,-5,7.6,10,1.2); c.fill();
  c.strokeStyle='#b9c7d8'; c.lineWidth=1; c.stroke();
  c.strokeStyle='rgba(0,0,0,0.4)'; c.lineWidth=0.6;
  c.beginPath();
  c.moveTo(-3.8,-2.6); c.lineTo(3.8,-2.6);
  c.moveTo(-3.8,2.6); c.lineTo(3.8,2.6);
  c.stroke();
  c.fillStyle=lin(c,0,-7,0,-5,[[0,'#d7e3ee'],[1,'#7a8aa0']]);
  rr(c,-1.7,-6.8,3.4,1.9,0.5); c.fill();
  c.fillStyle='#cfd9e6'; c.fillRect(-0.5,-7.7,1,1);
  c.fillStyle='rgba(0,0,0,0.5)';
  for(let i=0;i<4;i++)c.fillRect(-3,2.8-i*2.1,6,1.7);
}
function spriteCannonBase(c){
  plate(c,10);
  c.fillStyle=rad(c,1,5,[[0,'#4a5a74'],[0.7,'#2b3850'],[1,'#192234']]);
  c.beginPath(); c.arc(0,0,4.9,0,Math.PI*2); c.fill();
  c.strokeStyle='#54657f'; c.lineWidth=1.1; c.stroke();
  c.fillStyle='rgba(190,215,240,0.55)';
  for(let i=0;i<6;i++){
    const a=Math.PI/6+i*Math.PI/3;
    c.beginPath(); c.arc(Math.cos(a)*3.9,Math.sin(a)*3.9,0.65,0,Math.PI*2); c.fill();
  }
  c.fillStyle='#10182a';
  c.beginPath(); c.arc(0,0,1.8,0,Math.PI*2); c.fill();
}
function spriteCannonTurret(c){
  // drawn pointing +x, pivot at origin
  c.fillStyle=lin(c,0,-2.6,0,2.6,[[0,'#4d5f84'],[0.5,'#33405c'],[1,'#1f2940']]);
  rr(c,-3.1,-2.5,5.8,5,1); c.fill();
  c.strokeStyle='#ff9d5c'; c.lineWidth=0.9; c.stroke();
  c.fillStyle='rgba(0,0,0,0.45)';
  c.fillRect(-2.2,-1.6,1,0.9); c.fillRect(-2.2,0.7,1,0.9);
  c.fillStyle=lin(c,0,-2,0,2,[[0,'#9cb0d2'],[0.5,'#5d6f92'],[1,'#3a4763']]);
  c.fillRect(2.2,-1.75,6.2,1.15);
  c.fillRect(2.2,0.6,6.2,1.15);
  c.fillStyle='#202c44';
  c.fillRect(7.4,-2.05,1.5,1.75); c.fillRect(7.4,0.3,1.5,1.75);
  c.fillStyle='rgba(220,235,255,0.5)';
  c.fillRect(7.4,-2.05,1.5,0.4); c.fillRect(7.4,0.3,1.5,0.4);
  c.fillStyle='#19233a';
  rr(c,-4,-1.5,1.4,3,0.5); c.fill();
}
function spriteMortar(c){
  plate(c,20);
  c.fillStyle=lin(c,-8,-8,8,8,[[0,'#54303f'],[0.5,'#2c1620'],[1,'#170a10']]);
  cpoly(c,[[-8,-5],[-5,-8],[5,-8],[8,-5],[8,5],[5,8],[-5,8],[-8,5]]); c.fill();
  c.strokeStyle='#ff6e6e'; c.lineWidth=1.4; c.stroke();
  for(const p of [[-5.9,-5.9],[5.9,-5.9],[-5.9,5.9],[5.9,5.9]]){
    c.fillStyle='#1b0f15';
    c.beginPath(); c.arc(p[0],p[1],1.7,0,Math.PI*2); c.fill();
    c.fillStyle='rgba(255,190,190,0.45)';
    c.beginPath(); c.arc(p[0]-0.4,p[1]-0.4,0.7,0,Math.PI*2); c.fill();
  }
  c.fillStyle='#d9b53e';
  for(let k=-1;k<=1;k++){
    cpoly(c,[[k*2.4-0.8,-7.3],[k*2.4,-6.5],[k*2.4+0.8,-7.3]]);
    c.fill();
  }
  c.fillStyle=rad(c,3,6.6,[[0,'#6b4252'],[0.75,'#3a2230'],[1,'#221019']]);
  c.beginPath(); c.arc(0,0,6.3,0,Math.PI*2); c.fill();
  c.strokeStyle='#ff8d8d'; c.lineWidth=1.4;
  c.beginPath(); c.arc(0,0,6.3,0,Math.PI*2); c.stroke();
  c.strokeStyle='rgba(255,230,230,0.35)'; c.lineWidth=0.8;
  c.beginPath(); c.arc(-0.4,-0.4,5.4,Math.PI*0.85,Math.PI*1.6); c.stroke();
  c.fillStyle=rad(c,0.4,3.4,[[0,'#000000'],[0.8,'#0c070d'],[1,'#241318']]);
  c.beginPath(); c.arc(0,0,3.2,0,Math.PI*2); c.fill();
  c.strokeStyle='rgba(255,160,140,0.25)'; c.lineWidth=0.6;
  c.beginPath(); c.arc(0,0,2.4,0,Math.PI*2); c.stroke();
}
function spriteTerra(c){
  plate(c,10);
  c.fillStyle=lin(c,-4.5,-4.5,4.5,4.5,[[0,'#5a4a2a'],[0.5,'#3a3018'],[1,'#241d0c']]);
  rr(c,-4.5,-4.5,9,9,1.2); c.fill();
  c.strokeStyle='#d8b46a'; c.lineWidth=1.1; c.stroke();
  for(const p of [[-3,-3],[3,-3],[-3,3],[3,3]]){    // corner pistons
    c.fillStyle='#1c1810';
    c.beginPath(); c.arc(p[0],p[1],1.5,0,Math.PI*2); c.fill();
    c.fillStyle='rgba(255,220,150,0.5)';
    c.beginPath(); c.arc(p[0]-0.4,p[1]-0.4,0.6,0,Math.PI*2); c.fill();
  }
  c.fillStyle='#120e08';                            // drill well
  c.beginPath(); c.arc(0,0,2.6,0,Math.PI*2); c.fill();
  c.strokeStyle='rgba(216,180,106,0.6)'; c.lineWidth=0.8;
  c.beginPath(); c.arc(0,0,1.7,0,Math.PI*2); c.stroke();
}
function spriteBeam(c){
  plate(c,10);
  c.strokeStyle='#3d6b66'; c.lineWidth=1.3;     // tripod
  c.beginPath();
  c.moveTo(-3.6,4.2); c.lineTo(0,-1);
  c.moveTo(3.6,4.2); c.lineTo(0,-1);
  c.moveTo(0,4.6); c.lineTo(0,-1);
  c.stroke();
  c.fillStyle=lin(c,0,-7,0,-1,[[0,'#cffcf0'],[0.5,'#5fe6c4'],[1,'#1d5a4c']]);
  cpoly(c,[[0,-7.2],[2.2,-2.4],[0,-0.6],[-2.2,-2.4]]);   // crystal prism
  c.fill();
  c.strokeStyle='#9ffce4'; c.lineWidth=1; c.stroke();
  c.fillStyle='rgba(230,255,248,0.9)';
  c.beginPath(); c.arc(-0.6,-4.6,0.6,0,Math.PI*2); c.fill();
}
function spriteSprayer(c){
  plate(c,10);
  c.fillStyle=lin(c,-3.6,0,3.6,0,[[0,'#3f5a72'],[0.5,'#27405a'],[1,'#16283c']]);
  rr(c,-3.6,-3.2,7.2,7.6,2.4); c.fill();        // pressure tank
  c.strokeStyle='#9fd0ff'; c.lineWidth=1.1; c.stroke();
  c.strokeStyle='rgba(0,0,0,0.4)'; c.lineWidth=0.6;
  c.beginPath(); c.moveTo(-3.6,0); c.lineTo(3.6,0); c.stroke();
  for(let k=0;k<4;k++){                          // nozzles
    const a=Math.PI/4+k*Math.PI/2;
    c.save(); c.translate(Math.cos(a)*4.2,Math.sin(a)*4.2); c.rotate(a);
    c.fillStyle='#cfe8ff';
    c.fillRect(-0.6,-0.9,1.8,1.8);
    c.restore();
  }
  c.fillStyle='rgba(207,232,255,0.9)';           // gauge
  c.beginPath(); c.arc(0,-4.6,1.3,0,Math.PI*2); c.fill();
  c.fillStyle='#16283c';
  c.beginPath(); c.arc(0,-4.6,0.6,0,Math.PI*2); c.fill();
}
function spriteCryo(c){
  plate(c,10);
  c.fillStyle=lin(c,-4,-4,4,4,[[0,'#2a4458'],[0.5,'#1a2c40'],[1,'#0e1a2a']]);
  cngon(c,4.8,6,Math.PI/6); c.fill();
  c.strokeStyle='#bfe8ff'; c.lineWidth=1.1; c.stroke();
  c.strokeStyle='rgba(191,232,255,0.8)'; c.lineWidth=1;
  for(let k=0;k<3;k++){                            // snowflake arms
    const a=k*Math.PI/3;
    c.beginPath();
    c.moveTo(Math.cos(a)*-3.4,Math.sin(a)*-3.4);
    c.lineTo(Math.cos(a)*3.4,Math.sin(a)*3.4);
    c.stroke();
  }
  c.fillStyle='#eaf8ff';
  c.beginPath(); c.arc(0,0,1.3,0,Math.PI*2); c.fill();
}
function spriteSniper(c){
  plate(c,10);
  c.fillStyle=rad(c,1,4.6,[[0,'#3c3448'],[0.8,'#241e30'],[1,'#161020']]);
  c.beginPath(); c.arc(0,0,4.2,0,Math.PI*2); c.fill();
  c.strokeStyle='#ffd2dd'; c.lineWidth=1.1; c.stroke();
  c.strokeStyle='#ffd2dd'; c.lineWidth=1.4;        // long rifle
  c.beginPath(); c.moveTo(0,0); c.lineTo(7.6,-3.2); c.stroke();
  c.fillStyle='rgba(255,210,221,0.9)';
  c.beginPath(); c.arc(0,0,1.2,0,Math.PI*2); c.fill();
}
function spriteStrafer(c){
  plate(c,20);
  c.strokeStyle='rgba(127,217,255,0.5)'; c.lineWidth=1;
  c.beginPath(); c.arc(0,0,7,0,Math.PI*2); c.stroke();   // landing circle
  c.setLineDash([2,3]);
  c.strokeStyle='rgba(127,217,255,0.35)';
  c.beginPath(); c.moveTo(-7,0); c.lineTo(7,0); c.stroke();
  c.setLineDash([]);
  c.fillStyle='#d9b53e';                            // pad chevrons
  cpoly(c,[[-6.5,-6.5],[-4,-6.5],[-6.5,-4]]); c.fill();
  cpoly(c,[[6.5,6.5],[4,6.5],[6.5,4]]); c.fill();
}
function spriteBomber(c){
  plate(c,20);
  c.strokeStyle='rgba(191,232,255,0.5)'; c.lineWidth=1;
  c.beginPath(); c.arc(0,0,7,0,Math.PI*2); c.stroke();
  c.setLineDash([2,3]);
  c.strokeStyle='rgba(191,232,255,0.35)';
  c.beginPath(); c.moveTo(0,-7); c.lineTo(0,7); c.stroke();
  c.setLineDash([]);
  c.fillStyle='#7fd9ff';                            // pad markers
  cpoly(c,[[-6.5,6.5],[-4,6.5],[-6.5,4]]); c.fill();
  cpoly(c,[[6.5,-6.5],[4,-6.5],[6.5,-4]]); c.fill();
  c.fillStyle='rgba(191,232,255,0.7)';
  c.beginPath(); c.arc(0,0,1.6,0,Math.PI*2); c.fill();
}
function drawAircraftShape(x,y,ang,col){
  ctx.save();
  ctx.translate(x,y);
  ctx.rotate(ang);
  ctx.fillStyle='#cfe5f5';
  poly([[5,0],[-3,3.6],[-1.4,0],[-3,-3.6]]); ctx.fill();
  ctx.strokeStyle=col||'#7fd9ff'; ctx.lineWidth=0.9; ctx.stroke();
  ctx.restore();
}
function spritePylon(c){
  plate(c,10);
  c.strokeStyle='#5a78a8'; c.lineWidth=1.2;        // lattice mast
  c.beginPath(); c.moveTo(0,-6); c.lineTo(0,6); c.stroke();
  c.strokeStyle='#9fd0ff'; c.lineWidth=1;
  for(let k=-1;k<=1;k++){c.beginPath();c.moveTo(-3,k*3);c.lineTo(3,k*3);c.stroke();}
  c.fillStyle=rad(c,0.2,2.2,[[0,'#eaf5ff'],[0.5,'#8cc4ff'],[1,'#2c5687']]);
  c.beginPath(); c.arc(0,-6,1.8,0,Math.PI*2); c.fill();
}
function spriteHarvester(c){
  plate(c,10);
  c.fillStyle=lin(c,-4.5,-4.5,4.5,4.5,[[0,'#4a3a18'],[0.5,'#2e2410'],[1,'#1a1408']]);
  rr(c,-4.5,-4.5,9,9,2); c.fill();
  c.strokeStyle='#d8b46a'; c.lineWidth=1.1; c.stroke();
  c.fillStyle=rad(c,0.3,3,[[0,'#e8d4ff'],[0.5,'#b66bff'],[1,'rgba(80,40,140,0)']]);  // crystal glow
  c.beginPath(); c.arc(0,0.6,2.6,0,Math.PI*2); c.fill();
  c.strokeStyle='#d8b46a'; c.lineWidth=1.2;        // drill mast
  c.beginPath(); c.moveTo(0,-4.5); c.lineTo(0,-1); c.stroke();
}
function spriteGuppy(c){
  plate(c,20);
  c.strokeStyle='rgba(127,217,255,0.5)'; c.lineWidth=1;
  c.beginPath(); c.arc(0,0,8,0,Math.PI*2); c.stroke();
  c.fillStyle=lin(c,0,-4,0,4,[[0,'#9cb0d2'],[1,'#3a4763']]);  // dropship hull
  cpoly(c,[[-5,0],[-2,-3],[5,-1.5],[5,1.5],[-2,3]]); c.fill();
  c.strokeStyle='#7fd9ff'; c.lineWidth=0.9; c.stroke();
  c.fillStyle='#cfe5f5';
  c.beginPath(); c.arc(3,0,1.1,0,Math.PI*2); c.fill();
}
function spriteSensor(c){
  plate(c,10);
  c.strokeStyle='#3d6b66'; c.lineWidth=1.2;
  c.beginPath(); c.moveTo(0,5); c.lineTo(0,-3); c.stroke();
  c.fillStyle='#13243c';                           // dish
  c.beginPath(); c.ellipse(0,-3.5,4,2.2,-0.5,0,Math.PI*2); c.fill();
  c.strokeStyle='#9ffce4'; c.lineWidth=1; c.stroke();
  c.fillStyle='#cffcf0';
  c.beginPath(); c.arc(1.2,-4.6,0.8,0,Math.PI*2); c.fill();
}
function spriteRepair(c){
  plate(c,10);
  c.fillStyle=lin(c,-4.5,-4.5,4.5,4.5,[[0,'#1f4a3a'],[0.5,'#143025'],[1,'#0c2018']]);
  rr(c,-4.5,-4.5,9,9,2); c.fill();
  c.strokeStyle='#7be3a8'; c.lineWidth=1.2; c.stroke();
  c.fillStyle='#7be3a8';                            // green cross
  c.fillRect(-1,-3.2,2,6.4); c.fillRect(-3.2,-1,6.4,2);
  c.fillStyle='rgba(200,255,225,0.9)';
  c.fillRect(-0.5,-3.2,1,6.4);
}
function spriteResonator(c){
  plate(c,10);
  c.fillStyle=rad(c,1,5,[[0,'#5a3a6a'],[0.7,'#2e1d3a'],[1,'#1a1024']]);
  c.beginPath(); c.arc(0,0,4.8,0,Math.PI*2); c.fill();
  c.strokeStyle='#d8a0ff'; c.lineWidth=1.1; c.stroke();
  c.strokeStyle='rgba(216,160,255,0.7)'; c.lineWidth=0.9;
  c.beginPath(); c.arc(0,0,3,0,Math.PI*2); c.stroke();
  c.fillStyle='#f0d8ff';
  c.beginPath(); c.arc(0,0,1.4,0,Math.PI*2); c.fill();
}
function spriteSiphon(c){
  plate(c,10);
  c.fillStyle=lin(c,0,-5,0,5,[[0,'#2a4458'],[0.5,'#16303f'],[1,'#0c1c26']]);
  cpoly(c,[[-3.5,-4.5],[3.5,-4.5],[2,4.8],[-2,4.8]]); c.fill();   // funnel
  c.strokeStyle='#7be3a8'; c.lineWidth=1.2; c.stroke();
  c.strokeStyle='rgba(123,227,168,0.6)'; c.lineWidth=0.8;
  c.beginPath(); c.moveTo(-2.6,-1); c.lineTo(2.6,-1); c.stroke();
  c.fillStyle='#bfffe0';                            // intake throat
  c.beginPath(); c.arc(0,4.4,1.1,0,Math.PI*2); c.fill();
}
function spriteInhibitor(c){
  plate(c,10);
  c.fillStyle=rad(c,1,5,[[0,'#2a3a5a'],[0.7,'#16223a'],[1,'#0c1424']]);
  c.beginPath(); c.arc(0,0,4.8,0,Math.PI*2); c.fill();
  c.strokeStyle='#9fb8ff'; c.lineWidth=1.1; c.stroke();
  c.strokeStyle='rgba(159,184,255,0.7)'; c.lineWidth=1.4;   // no-entry bar
  c.beginPath(); c.arc(0,0,3,0,Math.PI*2); c.stroke();
  c.beginPath(); c.moveTo(-2.1,-2.1); c.lineTo(2.1,2.1); c.stroke();
}
export function drawShields(){
  const now=performance.now()*0.001;
  for(const b of S.buildings){
    if(b.type!=='shield'||!b.alive||!b.built)continue;
    const r=TYPES.shield.range*CELL;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    ctx.globalAlpha=b.active?0.16+0.05*Math.sin(now*3+b.id):0.05;
    ctx.fillStyle='#8fe8ff';
    ctx.beginPath(); ctx.arc(b.px,b.py,r,0,Math.PI*2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle=b.active?'rgba(143,232,255,'+(0.4+0.2*Math.sin(now*4+b.id)).toFixed(3)+')':'rgba(143,232,255,0.15)';
    ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.arc(b.px,b.py,r,0,Math.PI*2); ctx.stroke();
  }
}
export function drawAircraft(){
  for(const b of S.buildings){
    if((b.type!=='strafer'&&b.type!=='bomber')||!b.alive||!b.air)continue;
    const col=b.type==='bomber'?'#bfe8ff':'#7fd9ff';
    const a=b.air;
    if(a.state==='idle'){
      drawAircraftShape(b.px,b.py,-Math.PI/2,col);
      continue;
    }
    ctx.fillStyle='rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(a.x+3,a.y+5,4,2,0,0,Math.PI*2); ctx.fill();
    const ang=a.state==='strafe'?0:Math.atan2((a.state==='out'?a.ty:b.py)-a.y,(a.state==='out'?a.tx:b.px)-a.x);
    drawGlow(a.x,a.y,7,col,0.4);
    drawAircraftShape(a.x,a.y-6,ang,col);
  }
}
function spriteShield(c){
  plate(c,10);
  c.fillStyle=lin(c,0,-5,0,5,[[0,'#2a5e6a'],[0.5,'#173a44'],[1,'#0d242b']]);
  cpoly(c,[[0,-5.5],[4.6,-2.5],[4.6,2.5],[0,5.5],[-4.6,2.5],[-4.6,-2.5]]); c.fill();
  c.strokeStyle='#8fe8ff'; c.lineWidth=1.2; c.stroke();
  c.strokeStyle='rgba(143,232,255,0.6)'; c.lineWidth=0.8;
  cpoly(c,[[0,-3.4],[2.8,-1.6],[2.8,1.6],[0,3.4],[-2.8,1.6],[-2.8,-1.6]]); c.stroke();
  c.fillStyle='#cffcf0';
  c.beginPath(); c.arc(0,0,1.1,0,Math.PI*2); c.fill();
}
function spriteConvert(c){
  plate(c,20);
  c.fillStyle=rad(c,2,8,[[0,'#1e4a52'],[0.7,'#143038'],[1,'#0c2026']]);
  c.beginPath(); c.arc(0,0,7.6,0,Math.PI*2); c.fill();
  c.strokeStyle='#bfe8ff'; c.lineWidth=1.2; c.stroke();
  c.strokeStyle='rgba(191,232,255,0.7)'; c.lineWidth=1.4;
  for(let k=0;k<2;k++){                             // recycling arrows
    c.beginPath(); c.arc(0,0,4.4,k*Math.PI+0.4,k*Math.PI+Math.PI-0.4); c.stroke();
    const a=k*Math.PI+Math.PI-0.4;
    c.fillStyle='#bfe8ff';
    c.save(); c.translate(Math.cos(a)*4.4,Math.sin(a)*4.4); c.rotate(a+Math.PI/2);
    cpoly(c,[[0,-1.6],[1.4,0.8],[-1.4,0.8]]); c.fill(); c.restore();
  }
}
function spriteNullifier(c){
  plate(c,20);
  c.fillStyle=rad(c,2,8,[[0,'#3c3c5c'],[0.7,'#23233a'],[1,'#15152a']]);
  c.beginPath(); c.arc(0,0,7.7,0,Math.PI*2); c.fill();
  c.strokeStyle='#cfd6ff'; c.lineWidth=1.1;
  c.beginPath(); c.arc(0,0,7.7,0,Math.PI*2); c.stroke();
  c.strokeStyle='rgba(207,214,255,0.3)'; c.lineWidth=1;
  for(let i=0;i<12;i++){
    const a=i*Math.PI/6+0.12;
    c.beginPath(); c.arc(0,0,6,a,a+0.32); c.stroke();
  }
  c.fillStyle='#3a3a58';
  for(let i=0;i<3;i++){
    const a=-Math.PI/2+i*Math.PI*2/3;
    c.save(); c.translate(Math.cos(a)*7,Math.sin(a)*7); c.rotate(a);
    rr(c,-1.2,-1.6,2.4,3.2,0.8); c.fill();
    c.restore();
  }
  c.fillStyle='#0b0b18';
  c.beginPath(); c.arc(0,0,2.7,0,Math.PI*2); c.fill();
}
const gradCache=new Map();
function cgrad(key,make){
  let g=gradCache.get(key);
  if(g===undefined){g=make();gradCache.set(key,g);}
  return g;
}
function drawShape(b,T){
  const now=performance.now()*0.001;
  if(b.type==='core'){
    blitSprite('core',45,spriteCore);
    const rot=now*0.6;
    ctx.strokeStyle='rgba(77,240,200,0.7)'; ctx.lineWidth=1.6;
    for(let i=0;i<3;i++){
      ctx.beginPath(); ctx.arc(0,0,8.4,rot+i*Math.PI*2/3,rot+i*Math.PI*2/3+1.4); ctx.stroke();
    }
    ctx.fillStyle=cgrad('core',()=>{
      const g=ctx.createRadialGradient(0,0,0.5,0,0,6);
      if(g&&g.addColorStop){g.addColorStop(0,'#eafffa');g.addColorStop(0.45,'#4df0c8');g.addColorStop(1,'rgba(13,40,35,0)');}
      return g;
    });
    ctx.beginPath(); ctx.arc(0,0,6,0,Math.PI*2); ctx.fill();
    const ga=ctx.globalAlpha;
    ctx.globalAlpha=ga*(0.5+0.3*Math.sin(now*3));
    ctx.strokeStyle='#bffff0'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(0,0,5.4+0.8*Math.sin(now*3),0,Math.PI*2); ctx.stroke();
    ctx.globalAlpha=ga;
    ctx.fillStyle='#9ffce4';
    for(let i=0;i<3;i++){
      const a=Math.PI/6+i*Math.PI*2/3;
      if(Math.sin(now*2.4+i*2.1)>0)
        ctx.fillRect(Math.cos(a)*12-0.8,Math.sin(a)*12-0.8,1.6,1.6);
    }
  }else if(b.type==='collector'){
    blitSprite('collector',15,spriteCollector);
    ctx.fillStyle='rgba(180,255,215,'+(0.25+0.3*Math.sin(now*2.2+b.id*1.7)).toFixed(3)+')';
    poly([[0,-2.4],[2,0],[0,2.4],[-2,0]]); ctx.fill();
  }else if(b.type==='relay'){
    blitSprite('relay',15,spriteRelay);
    const a=now*1.4+b.id;
    ctx.strokeStyle='rgba(140,200,255,0.3)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.cos(a)*6.5,Math.sin(a)*6.5); ctx.stroke();
    if(Math.sin(now*3.2+b.id)>0.3){
      ctx.fillStyle='rgba(235,248,255,0.95)';
      ctx.beginPath(); ctx.arc(0,-7,0.8,0,Math.PI*2); ctx.fill();
    }
  }else if(b.type==='reactor'){
    blitSprite('reactor',30,spriteReactor);
    ctx.strokeStyle='rgba(255,216,107,'+(0.45+0.3*Math.sin(now*4+b.id)).toFixed(3)+')';
    ctx.lineWidth=1.6;
    ctx.beginPath(); ctx.arc(0,0,4.4,0,Math.PI*2); ctx.stroke();
    const s=2.6+1.2*Math.sin(now*5+b.id);
    ctx.fillStyle='#ffd86b'; ctx.fillRect(-s/2,-s/2,s,s);
    ctx.fillStyle='rgba(255,255,230,0.9)'; ctx.fillRect(-0.8,-0.8,1.6,1.6);
  }else if(b.type==='battery'){
    blitSprite('battery',15,spriteBattery);
    const lvl=S.cap>0?clamp(S.energy/S.cap,0,1):0;
    const segs=Math.round(lvl*4);
    ctx.fillStyle='#7be3a8';
    for(let i=0;i<segs;i++)ctx.fillRect(-2.9,2.9-i*2.1,5.8,1.5);
  }else if(b.type==='terra'){
    blitSprite('terra',15,spriteTerra);
    if(b.built){
      ctx.lineWidth=1.2;
      for(let i=0;i<T.charge;i++){
        const a=-Math.PI/2+i*Math.PI*2/T.charge;
        ctx.strokeStyle=i<b.charge?'rgba(255,222,150,0.95)':'rgba(216,180,106,0.25)';
        ctx.beginPath();
        ctx.moveTo(Math.cos(a)*5.6,Math.sin(a)*5.6);
        ctx.lineTo(Math.cos(a)*6.8,Math.sin(a)*6.8);
        ctx.stroke();
      }
      const a2=now*4+b.id;
      ctx.fillStyle='#ffd86b';
      ctx.fillRect(Math.cos(a2)*1.2-0.5,Math.sin(a2)*1.2-0.5,1,1);
    }
  }else if(b.type==='bomber'){
    blitSprite('bomber',30,spriteBomber);
  }else if(b.type==='pylon'){
    blitSprite('pylon',15,spritePylon);
    if(b.built){
      ctx.fillStyle='rgba(159,208,255,'+(0.5+0.4*Math.sin(now*4+b.id)).toFixed(3)+')';
      ctx.beginPath(); ctx.arc(0,-6,1,0,Math.PI*2); ctx.fill();
    }
  }else if(b.type==='harvester'){
    blitSprite('harvester',15,spriteHarvester);
    if(b.built&&b.conn){
      ctx.fillStyle='rgba(216,160,255,'+(0.4+0.3*Math.sin(now*3+b.id)).toFixed(3)+')';
      ctx.beginPath(); ctx.arc(0,0.6,1.2,0,Math.PI*2); ctx.fill();
    }
  }else if(b.type==='guppy'){
    blitSprite('guppy',30,spriteGuppy);
  }else if(b.type==='sensor'){
    blitSprite('sensor',15,spriteSensor);
    if(b.built){                              // sweeping radar arm
      ctx.strokeStyle='rgba(159,252,228,0.5)'; ctx.lineWidth=1;
      const a=now*1.6+b.id;
      ctx.beginPath(); ctx.moveTo(0,-3.5); ctx.lineTo(Math.cos(a)*5,-3.5+Math.sin(a)*5); ctx.stroke();
    }
  }else if(b.type==='repair'){
    blitSprite('repair',15,spriteRepair);
    if(b.built){
      ctx.globalAlpha=0.12+0.06*Math.sin(now*3+b.id);
      ctx.fillStyle='#7be3a8';
      ctx.beginPath(); ctx.arc(0,0,TYPES.repair.range*CELL,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha=1;
    }
  }else if(b.type==='resonator'){
    blitSprite('resonator',15,spriteResonator);
    if(b.built){
      ctx.strokeStyle='rgba(216,160,255,'+(0.3+0.25*Math.sin(now*5+b.id)).toFixed(3)+')';
      ctx.lineWidth=1;
      ctx.beginPath(); ctx.arc(0,0,3+1.5*Math.sin(now*5+b.id),0,Math.PI*2); ctx.stroke();
    }
  }else if(b.type==='siphon'){
    blitSprite('siphon',15,spriteSiphon);
    if(b.built){
      ctx.fillStyle='rgba(123,227,168,'+(0.4+0.4*Math.sin(now*6+b.id)).toFixed(3)+')';
      ctx.beginPath(); ctx.arc(0,4.4,1.2,0,Math.PI*2); ctx.fill();
    }
  }else if(b.type==='inhibitor'){
    blitSprite('inhibitor',15,spriteInhibitor);
  }else if(b.type==='shield'){
    blitSprite('shield',15,spriteShield);
  }else if(b.type==='convert'){
    blitSprite('convert',30,spriteConvert);
    if(b.built&&!b.fired){
      const chg=clamp(b.charge/T.charge,0,1);
      ctx.strokeStyle='rgba(191,232,255,0.9)'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(0,0,9.5,-Math.PI/2,-Math.PI/2+chg*Math.PI*2); ctx.stroke();
    }
  }else if(b.type==='cryo'){
    blitSprite('cryo',15,spriteCryo);
    if(b.built&&b.ammo>=3){
      ctx.strokeStyle='rgba(191,232,255,'+(0.4+0.3*Math.sin(now*3+b.id)).toFixed(3)+')';
      ctx.lineWidth=1;
      ctx.beginPath(); ctx.arc(0,0,6,0,Math.PI*2); ctx.stroke();
    }
  }else if(b.type==='sniper'){
    blitSprite('sniper',15,spriteSniper);
  }else if(b.type==='strafer'){
    blitSprite('strafer',30,spriteStrafer);
  }else if(b.type==='beam'){
    blitSprite('beam',15,spriteBeam);
    if(b.built&&b.ammo>=1){
      ctx.fillStyle='rgba(159,252,228,'+(0.5+0.4*Math.sin(now*5+b.id)).toFixed(3)+')';
      ctx.beginPath(); ctx.arc(0,-4,1.1,0,Math.PI*2); ctx.fill();
    }
  }else if(b.type==='sprayer'){
    blitSprite('sprayer',15,spriteSprayer);
    if(b.built&&b.cd>0.3){
      ctx.fillStyle='rgba(207,232,255,0.5)';
      for(let k=0;k<4;k++){
        const a=Math.PI/4+k*Math.PI/2+now*2;
        ctx.beginPath(); ctx.arc(Math.cos(a)*6,Math.sin(a)*6,1,0,Math.PI*2); ctx.fill();
      }
    }
  }else if(b.type==='cannon'){
    blitSprite('cannonBase',15,spriteCannonBase);
    ctx.save();
    ctx.rotate(b.aim);
    const rec=T.shotCd?Math.max(0,b.cd/T.shotCd)*1.8:0;
    ctx.translate(-rec,0);
    blitSprite('cannonTurret',20,spriteCannonTurret);
    if(rec>0.9){
      ctx.fillStyle='rgba(255,230,180,'+((rec-0.9)/0.9).toFixed(3)+')';
      ctx.beginPath();
      ctx.arc(9.2,-1.2,1.1,0,Math.PI*2);
      ctx.arc(9.2,1.2,1.1,0,Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }else if(b.type==='mortar'){
    blitSprite('mortar',30,spriteMortar);
    const ld=T.shotCd?1-clamp(b.cd/T.shotCd,0,1):0;
    if(b.ammo>=T.shotCost){
      ctx.fillStyle='rgba(255,140,90,'+(0.15+0.45*ld).toFixed(3)+')';
      ctx.beginPath(); ctx.arc(0,0,2.2,0,Math.PI*2); ctx.fill();
    }
  }else if(b.type==='nullifier'){
    blitSprite('nullifier',30,spriteNullifier);
    const chg=clamp(b.charge/T.charge,0,1);
    const rot=now*(0.7+1.6*chg)+b.id;
    if(b.firing){
      ctx.fillStyle='rgba(150,150,230,0.35)';
      ctx.beginPath(); ctx.arc(0,0,7.7,0,Math.PI*2); ctx.fill();
    }
    if(b.built&&!b.fired){
      ctx.lineWidth=1.4;
      for(let i=0;i<T.charge;i++){
        const a=-Math.PI/2+i*Math.PI*2/T.charge;
        ctx.strokeStyle=i<b.charge?'rgba(255,255,255,0.95)':'rgba(207,214,255,0.22)';
        ctx.beginPath();
        ctx.moveTo(Math.cos(a)*8.6,Math.sin(a)*8.6);
        ctx.lineTo(Math.cos(a)*10.2,Math.sin(a)*10.2);
        ctx.stroke();
      }
    }
    ctx.fillStyle='#e8ecff';
    for(let i=0;i<3;i++){
      const a=rot+i*Math.PI*2/3;
      ctx.save();
      ctx.translate(Math.cos(a)*5.6,Math.sin(a)*5.6);
      ctx.rotate(a+Math.PI);
      poly([[2.2,0],[-1.4,1.4],[-1.4,-1.4]]); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle=cgrad('nullorb',()=>{
      const g=ctx.createRadialGradient(0,0,0.3,0,0,4.5);
      if(g&&g.addColorStop){g.addColorStop(0,'#ffffff');g.addColorStop(0.5,'#cfd6ff');g.addColorStop(1,'rgba(120,130,220,0)');}
      return g;
    });
    const ga=ctx.globalAlpha;
    ctx.globalAlpha=ga*Math.min(1,0.25+0.75*chg+(b.firing?0.5:0));
    ctx.beginPath(); ctx.arc(0,0,2+3*chg+(b.firing?2:0),0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=ga;
  }
}
export function drawBuildings(){
  if(spawnS!==S){spawnMap.clear();spawnS=S;}
  const tNow=performance.now();
  for(const b of S.buildings){
    if(!b.alive)continue;
    const T=TYPES[b.type];
    let born=spawnMap.get(b.id);
    if(born===undefined){born=tNow;spawnMap.set(b.id,born);}
    const k=Math.min(1,(tNow-born)/320);
    if(b.type==='core')drawGlow(b.px,b.py,20,'#4df0c8',0.18+0.12*Math.sin(tNow*0.003));
    if(b.type==='nullifier'&&b.firing)drawGlow(b.px,b.py,26,'#ffffff',0.5+0.4*Math.random());
    if(b.moving)drawGlow(b.px,b.py+4,b.sz*CELL*0.6,'#8fd0ff',0.5);
    ctx.save();
    ctx.translate(b.px,b.py);
    if(b.moving)ctx.scale(1.12,1.12);
    if(k<1){
      const e=1-(1-k)*(1-k)*(1-k);
      ctx.scale(0.5+0.5*e,0.5+0.5*e);
      ctx.strokeStyle='rgba(77,240,200,'+(0.7*(1-k)).toFixed(3)+')';
      ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(0,0,b.sz*CELL*(0.5+k),0,Math.PI*2); ctx.stroke();
    }
    let a=b.built?1:0.45;
    if(b.hurtT>0 && (((tNow*0.02)|0)%2===0))a*=0.5;
    ctx.globalAlpha=a*(0.3+0.7*k);
    drawShape(b,T);
    if(b.stun>0){                              // runner stun: crackling ring
      ctx.strokeStyle='rgba(255,210,221,'+(0.4+0.4*Math.random()).toFixed(3)+')';
      ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(0,0,b.sz*CELL*0.55,0,Math.PI*2); ctx.stroke();
    }
    if(b.built && Math.sin(tNow*0.004+b.id*1.37)>0.1){   // blinking status LED
      ctx.fillStyle=b.conn?'rgba(120,255,200,0.95)':'rgba(255,110,110,0.95)';
      const hs=b.sz*CELL*0.46;
      ctx.fillRect(hs-3.1,-hs+1.5,1.6,1.6);
    }
    ctx.restore();
    if(!b.built){
      const pr=clamp(b.buildGot/T.cost,0,1);
      ctx.strokeStyle='#4df0c8'; ctx.lineWidth=2;
      ctx.beginPath();
      ctx.arc(b.px,b.py,b.sz*CELL*0.68,-Math.PI/2,-Math.PI/2+pr*Math.PI*2);
      ctx.stroke();
    }
    if(b.built && b.hp<b.hpMax-0.5){
      const w=b.sz*CELL, x=b.px-w/2, y=b.py-b.sz*CELL/2-6;
      ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(x,y,w,3);
      ctx.fillStyle=(b.hp/b.hpMax)>0.4?'#7be37b':'#ff7d6c';
      ctx.fillRect(x,y,w*(b.hp/b.hpMax),3);
    }
    if(b.built && T.ammoMax){
      const w=b.sz*CELL, x=b.px-w/2, y=b.py+b.sz*CELL/2+3;
      ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(x,y,w,2.5);
      ctx.fillStyle='#ffba5c';
      ctx.fillRect(x,y,w*(b.ammo/T.ammoMax),2.5);
    }
    if(!b.conn && !b.moving && S.phase==='play'){
      ctx.fillStyle='#ff5d5d';
      ctx.font='bold 11px ui-monospace, Menlo, monospace';
      ctx.textAlign='center';
      ctx.fillText('!',b.px,b.py-b.sz*CELL/2-8);
    }
  }
  const focus=(sel&&sel.alive)?sel:((hover.b&&hover.b.alive&&!selBuild&&!delMode)?hover.b:null);
  if(focus){
    const T=TYPES[focus.type];
    const pzMul=focus.pz?1.5:1, pzR=focus.pz?1.3:1;
    if(T.linkR)dashCircle(focus.px,focus.py,T.linkR*pzMul*CELL,'rgba(77,240,200,0.5)');
    if(T.range)dashCircle(focus.px,focus.py,T.range*pzR*CELL,'rgba(255,170,90,0.55)');
    if(T.workR)dashCircle(focus.px,focus.py,T.workR*CELL,'rgba(255,216,107,0.55)');
  }
}
/* spore towers + airborne spores */
export function drawSporeTowers(){
  if(!S.sporeTowers.length)return;
  const now=performance.now()*0.001;
  for(const tw of S.sporeTowers){
    const x=(tw.cx+0.5)*CELL, y=(tw.cy+0.5)*CELL;
    if(!tw.alive){
      ctx.fillStyle='rgba(20,16,24,0.9)';
      ngon(x,y,5.5,5,tw.pulse); ctx.fill();
      ctx.strokeStyle='rgba(120,120,140,0.5)'; ctx.lineWidth=1.1; ctx.stroke();
      continue;
    }
    const charge=Math.max(0,1-(tw.next-S.t)/8);   // bulges before launching
    drawGlow(x,y,13+4*charge,'#ff7d9c',0.4+0.3*charge);
    ctx.fillStyle='#1f0f1a';
    ngon(x,y,6,5,tw.pulse+now*0.15); ctx.fill();
    ctx.strokeStyle='#ff7d9c'; ctx.lineWidth=1.3; ctx.stroke();
    for(let k=0;k<3;k++){                          // spore sacs
      const a=tw.pulse+k*Math.PI*2/3+now*0.15;
      const sx=x+Math.cos(a)*3.4, sy=y+Math.sin(a)*3.4;
      ctx.fillStyle='rgba(255,125,156,'+(0.5+0.3*Math.sin(now*3+k)).toFixed(3)+')';
      ctx.beginPath(); ctx.arc(sx,sy,1.6+charge,0,Math.PI*2); ctx.fill();
    }
    ctx.fillStyle='#ffd2dd';
    ctx.beginPath(); ctx.arc(x,y,1.4+charge*1.4,0,Math.PI*2); ctx.fill();
  }
}
export function drawSpores(){
  for(const sp of S.spores){
    ctx.fillStyle='rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(sp.x,sp.y,3.4,1.8,0,0,Math.PI*2); ctx.fill();
    drawGlow(sp.x,sp.y-sp.h,9,'#ff7d9c',0.6);
    ctx.fillStyle='#5e1f33';
    ctx.beginPath(); ctx.arc(sp.x,sp.y-sp.h,3.4,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#ff7d9c'; ctx.lineWidth=1.2; ctx.stroke();
    ctx.fillStyle='#ffd2dd';
    ctx.beginPath(); ctx.arc(sp.x,sp.y-sp.h,1.2,0,Math.PI*2); ctx.fill();
  }
}
export function drawRunners(){
  const now=performance.now()*0.001;
  for(const r of S.runners){
    drawGlow(r.x,r.y,7,'#ff7d9c',0.6);
    ctx.save();
    ctx.translate(r.x,r.y);
    ctx.rotate(now*8);
    ctx.fillStyle='#3a1020';
    poly([[3,0],[0,2.4],[-3,0],[0,-2.4]]); ctx.fill();
    ctx.strokeStyle='#ff7d9c'; ctx.lineWidth=1; ctx.stroke();
    ctx.restore();
  }
}
export function drawTotems(){
  if(!S.totems.length)return;
  const now=performance.now()*0.001;
  for(const tm of S.totems){
    const x=(tm.cx+0.5)*CELL, y=(tm.cy+0.5)*CELL;
    if(tm.on)drawGlow(x,y,12,'#b66bff',0.45);
    ctx.save();
    ctx.translate(x,y);
    ctx.fillStyle='#171225';
    poly([[0,-6.5],[2.6,-3],[2.6,5],[-2.6,5],[-2.6,-3]]); ctx.fill();
    ctx.strokeStyle=tm.on?'#b66bff':'rgba(150,130,190,0.6)'; ctx.lineWidth=1.3; ctx.stroke();
    ctx.fillStyle=tm.on?'rgba(220,190,255,'+(0.6+0.3*Math.sin(now*3+tm.cx)).toFixed(3)+')':'rgba(150,130,190,0.3)';
    ctx.fillRect(-1,-4.4,2,7.5);
    ctx.restore();
  }
}
/* aether crystal nodes (mine with a Harvester) */
export function drawNodes(){
  if(!S.nodes||!S.nodes.length)return;
  const now=performance.now()*0.001;
  for(const n of S.nodes){
    if(S.occ[idx(n.cx,n.cy)]!==-1)continue;       // covered by a Harvester
    const x=(n.cx+0.5)*CELL, y=(n.cy+0.5)*CELL;
    drawGlow(x,y,9+2*Math.sin(now*2+n.cx),'#b66bff',0.4);
    ctx.save(); ctx.translate(x,y); ctx.rotate(now*0.3);
    ctx.fillStyle='#2a1a44';
    poly([[0,-5],[3,-1.5],[2,4],[-2,4],[-3,-1.5]]); ctx.fill();
    ctx.strokeStyle='#b66bff'; ctx.lineWidth=1.1; ctx.stroke();
    ctx.fillStyle='rgba(220,190,255,'+(0.5+0.3*Math.sin(now*3+n.cy)).toFixed(3)+')';
    poly([[0,-2.4],[1.4,0],[0,2.4],[-1.4,0]]); ctx.fill();
    ctx.restore();
  }
}
/* Inhibitor slow-fields (translucent indigo, drawn under buildings) */
export function drawInhibitorFields(){
  const now=performance.now()*0.001;
  for(const b of S.buildings){
    if(b.type!=='inhibitor'||!b.alive||!b.built)continue;
    const r=TYPES.inhibitor.range*CELL;
    ctx.save();
    ctx.globalAlpha=b.active?0.12:0.04;
    ctx.fillStyle='#5a78c8';
    ctx.beginPath(); ctx.arc(b.px,b.py,r,0,Math.PI*2); ctx.fill();
    ctx.restore();
    if(b.active){
      ctx.strokeStyle='rgba(159,184,255,'+(0.3+0.15*Math.sin(now*3+b.id)).toFixed(3)+')';
      ctx.lineWidth=1.2; ctx.setLineDash([3,4]);
      ctx.beginPath(); ctx.arc(b.px,b.py,r,0,Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
export function drawGhost(){
  if(!ghost||!S)return;
  ctx.globalAlpha=0.4;
  for(const a of ghost){
    if(a[0]>S.tickN)break;
    if(a[1]!=='P')continue;
    const T=TYPES[a[2]];
    if(!T)continue;
    const sz=T.sz, gx=a[3]-Math.floor(sz/2), gy=a[4]-Math.floor(sz/2);
    ctx.strokeStyle='#7fd9ff';
    ctx.setLineDash([3,3]); ctx.lineWidth=1;
    ctx.strokeRect(gx*CELL+1,gy*CELL+1,sz*CELL-2,sz*CELL-2);
    ctx.setLineDash([]);
    ctx.fillStyle='#7fd9ff';
    ctx.font='6px ui-monospace, Menlo, monospace';
    ctx.textAlign='center';
    ctx.fillText(T.icon,(gx+sz/2)*CELL,(gy+sz/2)*CELL+2);
  }
  ctx.globalAlpha=1;
}
/* Power Zones: pulsing pads left by nullified emitters */
export function drawPZones(){
  if(!S.pzones.length)return;
  const now=performance.now()*0.001;
  for(const z of S.pzones){
    const x=(z.cx+0.5)*CELL, y=(z.cy+0.5)*CELL;
    drawGlow(x,y,12+2*Math.sin(now*2.4+z.cx),'#9ffce4',0.4);
    ctx.strokeStyle='rgba(159,252,228,'+(0.5+0.25*Math.sin(now*2.4+z.cx)).toFixed(3)+')';
    ctx.lineWidth=1.4;
    ngon(x,y,5.5,6,now*0.5); ctx.stroke();
    ctx.fillStyle='rgba(159,252,228,0.25)';
    ngon(x,y,3.4,6,-now*0.4); ctx.fill();
  }
}
/* relics: claimable monoliths on high ground */
const RELIC_COL={rate:'#ff9d5c',speed:'#7fd9ff',energy:'#9ffce4'};
export function drawRelics(){
  if(!S.relics.length)return;
  const now=performance.now()*0.001;
  for(const rl of S.relics){
    const x=(rl.cx+0.5)*CELL, y=(rl.cy+0.5)*CELL;
    const col=RELIC_COL[rl.kind];
    drawGlow(x,y,rl.claimed?10:15+3*Math.sin(now*1.6+rl.cx),col,rl.claimed?0.3:0.55);
    ctx.save();
    ctx.translate(x,y);
    ctx.fillStyle=rl.claimed?'#1b2433':'#0d1422';
    poly([[0,-7],[3.4,-2],[2.2,6],[-2.2,6],[-3.4,-2]]); ctx.fill();
    ctx.strokeStyle=col; ctx.lineWidth=1.4; ctx.stroke();
    ctx.fillStyle=col;
    ctx.globalAlpha=rl.claimed?0.9:(0.4+0.3*Math.sin(now*3+rl.cy));
    poly([[0,-3.4],[1.5,0],[0,3.4],[-1.5,0]]); ctx.fill();
    ctx.globalAlpha=1;
    ctx.restore();
    if(!rl.claimed&&rl.prog>0){
      ctx.strokeStyle=col; ctx.lineWidth=2;
      ctx.beginPath();
      ctx.arc(x,y,10,-Math.PI/2,-Math.PI/2+(rl.prog/12)*Math.PI*2);
      ctx.stroke();
    }
  }
}
/* Terp paint jobs: amber cell markers with target levels */
export function drawTerraJobs(){
  ctx.strokeStyle='rgba(255,216,107,0.7)';
  ctx.lineWidth=1;
  let any=false;
  for(const b of S.buildings){
    if(b.type!=='terra'||!b.alive||!b.tjobs.length)continue;
    for(const j of b.tjobs){
      ctx.strokeRect(j.x*CELL+1.5,j.y*CELL+1.5,CELL-3,CELL-3);
      any=true;
    }
  }
  if(any&&cam.z>=1.8){
    ctx.fillStyle='rgba(255,228,150,0.9)';
    ctx.font='5px ui-monospace, Menlo, monospace';
    ctx.textAlign='center';
    for(const b of S.buildings){
      if(b.type!=='terra'||!b.alive||!b.tjobs.length)continue;
      for(const j of b.tjobs)ctx.fillText(j.t,(j.x+0.5)*CELL,(j.y+0.5)*CELL+1.8);
    }
  }
}
export function drawPackets(){
  for(const p of S.packets){
    const col=p.kind==='build'?'#4df0c8':(p.kind==='ammo'?'#ffba5c':'#ffffff');
    // motion trail along the current path segment
    const a=p.path[Math.min(p.seg,p.path.length-1)];
    const b=p.path[Math.min(p.seg+1,p.path.length-1)];
    const dx=b[0]-a[0], dy=b[1]-a[1];
    const dd=Math.hypot(dx,dy);
    if(dd>0.001){
      const ux=dx/dd, uy=dy/dd;
      ctx.strokeStyle=col;
      ctx.globalAlpha=0.18; ctx.lineWidth=2.4;
      ctx.beginPath(); ctx.moveTo(p.x-ux*10,p.y-uy*10); ctx.lineTo(p.x,p.y); ctx.stroke();
      ctx.globalAlpha=0.45; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.moveTo(p.x-ux*5,p.y-uy*5); ctx.lineTo(p.x,p.y); ctx.stroke();
      ctx.globalAlpha=1;
    }
    drawGlow(p.x,p.y,7,col,0.45);
    ctx.fillStyle=col;
    ctx.globalAlpha=0.3;
    ctx.beginPath(); ctx.arc(p.x,p.y,4.4,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1;
    ctx.beginPath(); ctx.arc(p.x,p.y,2.1,0,Math.PI*2); ctx.fill();
  }
}
export function drawShells(){
  for(const s of S.shells){
    const k=clamp(s.t/s.dur,0,1);
    const x=lerp(s.x1,s.x2,k), y=lerp(s.y1,s.y2,k);
    const h=Math.sin(Math.PI*k)*(dist(s.x1,s.y1,s.x2,s.y2)*0.22+18);
    ctx.fillStyle='rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x,y,3,1.6,0,0,Math.PI*2); ctx.fill();
    drawGlow(x,y-h,8,'#ff9d5c',0.55);
    ctx.fillStyle='#ffd2a0';
    ctx.beginPath(); ctx.arc(x,y-h,2.6,0,Math.PI*2); ctx.fill();
  }
}
export function drawShotsFX(){
  ctx.save();
  ctx.globalCompositeOperation='lighter';
  for(const s of S.shots){
    const a=clamp(s.t/(s.col?0.14:0.08),0,1);
    ctx.strokeStyle=s.col?s.col:'rgba(150,225,255,'+a.toFixed(3)+')';
    if(s.col)ctx.globalAlpha=a;
    ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(s.x1,s.y1); ctx.lineTo(s.x2,s.y2); ctx.stroke();
    ctx.globalAlpha=a*0.7;
    ctx.drawImage(glowSprite(s.col||'#7fd9ff'),s.x2-6,s.y2-6,12,12);
    ctx.globalAlpha=1;
  }
  for(const b of S.buildings){
    if(b.alive && b.type==='nullifier' && b.firing){
      for(const e of S.emitters){
        if(!e.alive)continue;
        const ex=(e.cx+0.5)*CELL, ey=(e.cy+0.5)*CELL;
        if(dist(ex/CELL,ey/CELL,b.px/CELL,b.py/CELL)>TYPES.nullifier.range+0.5)continue;
        ctx.strokeStyle='rgba(255,255,255,'+(0.45+0.5*Math.random()).toFixed(3)+')';
        ctx.lineWidth=2+Math.random()*2;
        const mx=(b.px+ex)/2+(Math.random()-0.5)*6;
        const my=(b.py+ey)/2+(Math.random()-0.5)*6;
        ctx.beginPath(); ctx.moveTo(b.px,b.py);
        ctx.quadraticCurveTo(mx,my,ex,ey); ctx.stroke();
        ctx.fillStyle='rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.arc(ex,ey,4+Math.random()*4,0,Math.PI*2); ctx.fill();
      }
    }
  }
  for(const p of S.parts){
    ctx.globalAlpha=clamp(p.t/p.max,0,1);
    ctx.fillStyle=p.col;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha=1;
  ctx.restore();
}
export function drawPreview(){
  if(!hover.inside)return;
  const ph=S.phase;
  if(delMode && ph==='play'){
    if(hover.b && hover.b.alive && hover.b.id!==S.coreId){
      const b=hover.b;
      ctx.strokeStyle='#ff5d5d'; ctx.lineWidth=2;
      ctx.strokeRect(b.gx*CELL+1,b.gy*CELL+1,b.sz*CELL-2,b.sz*CELL-2);
    }
    return;
  }
  // Terp paint ghost: amber target cell + level while a built Terp is selected
  if(ph==='play' && !selBuild && !moveSrc && sel && sel.alive && sel.type==='terra' && sel.built && !hover.b){
    const inR=dist(hover.cx+0.5,hover.cy+0.5,sel.gx+0.5,sel.gy+0.5)<=TYPES.terra.workR;
    const col=inR?'rgba(255,216,107,':'rgba(255,93,93,';
    ctx.fillStyle=col+'0.2)';
    ctx.fillRect(hover.cx*CELL,hover.cy*CELL,CELL,CELL);
    ctx.strokeStyle=col+'0.9)'; ctx.lineWidth=1;
    ctx.strokeRect(hover.cx*CELL+0.5,hover.cy*CELL+0.5,CELL-1,CELL-1);
    if(inR){
      ctx.setLineDash([3,4]);
      ctx.strokeStyle='rgba(255,216,107,0.45)';
      ctx.beginPath(); ctx.moveTo(sel.px,sel.py); ctx.lineTo((hover.cx+0.5)*CELL,(hover.cy+0.5)*CELL); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle='rgba(255,228,150,0.95)';
      ctx.font=(8*uiScale/cam.z).toFixed(2)+'px ui-monospace, Menlo, monospace';
      ctx.textAlign='center';
      ctx.fillText('L'+terraTarget,(hover.cx+0.5)*CELL,hover.cy*CELL-3);
    }
    return;
  }
  let type=null, ignoreId;
  if(ph==='placeCore')type='core';
  else if(ph==='play' && selBuild)type=selBuild;
  else if(ph==='play' && moveSrc && moveSrc.alive && !moveSrc.moving){type=moveSrc.type;ignoreId=moveSrc.id;}
  if(!type)return;
  const T=TYPES[type], sz=T.sz;
  const gx=hover.cx-Math.floor(sz/2), gy=hover.cy-Math.floor(sz/2);
  const px=(gx+sz/2)*CELL, py=(gy+sz/2)*CELL;
  const res=canPlace(S,type,hover.cx,hover.cy,ignoreId);
  if(ignoreId!==undefined){
    ctx.strokeStyle='rgba(159,208,255,0.6)';
    ctx.setLineDash([5,5]); ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.moveTo(moveSrc.px,moveSrc.py); ctx.lineTo(px,py); ctx.stroke();
    ctx.setLineDash([]);
  }
  const col=res.ok?'rgba(77,240,200,':'rgba(255,93,93,';
  ctx.fillStyle=col+'0.18)';
  ctx.fillRect(gx*CELL,gy*CELL,sz*CELL,sz*CELL);
  ctx.strokeStyle=col+'0.9)'; ctx.lineWidth=1.5;
  ctx.strokeRect(gx*CELL+0.5,gy*CELL+0.5,sz*CELL-1,sz*CELL-1);
  if(T.linkR)dashCircle(px,py,T.linkR*CELL,col+'0.5)');
  if(T.range)dashCircle(px,py,T.range*CELL,'rgba(255,170,90,0.5)');
  if(type!=='core'){
    const links=linkTargets(S,type,hover.cx,hover.cy);
    if(links.length){
      ctx.strokeStyle='rgba(77,240,200,0.5)';
      ctx.setLineDash([4,4]); ctx.lineWidth=1;
      ctx.beginPath();
      for(const l of links){ctx.moveTo(px,py);ctx.lineTo(l.px,l.py);}
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  if(!res.ok && res.why){
    ctx.fillStyle='rgba(255,130,130,0.95)';
    ctx.font=(11*uiScale/cam.z).toFixed(2)+'px ui-monospace, Menlo, monospace';
    ctx.textAlign='center';
    ctx.fillText(res.why,px,Math.max(12,gy*CELL-6));
  }
}
/* hover tooltip near the pointer: building stats, or terrain level + Flux
   depth on open ground (suppressed in build/recycle/relocate modes) */
function drawHoverInfo(){
  if(!S || !hover.inside)return;
  if(selBuild || delMode || (moveSrc&&moveSrc.alive))return;
  if(S.phase!=='play' && S.phase!=='placeCore')return;
  const u=uiScale;
  const lines=[];
  let em=null;
  for(const e of S.emitters){
    if(Math.abs(hover.cx-e.cx)<=1 && Math.abs(hover.cy-e.cy)<=1){em=e;break;}
  }
  let rlc=null;
  for(const rl of S.relics){
    if(Math.abs(hover.cx-rl.cx)<=1 && Math.abs(hover.cy-rl.cy)<=1){rlc=rl;break;}
  }
  let twc=null;
  for(const tw of S.sporeTowers){
    if(Math.abs(hover.cx-tw.cx)<=1 && Math.abs(hover.cy-tw.cy)<=1){twc=tw;break;}
  }
  if(twc){
    if(twc.alive){
      lines.push('Spore Tower');
      lines.push('Next launch in '+Math.max(0,twc.next-S.t).toFixed(0)+'s');
      lines.push('Nullify it — or keep Beams ready');
    }else{
      lines.push('Spore Tower — DESTROYED');
      lines.push('★ Power Zone — build here');
    }
  }else if(em){
    const str=em.str||1;
    if(em.captured){
      lines.push('Captured Emitter — OURS');
      lines.push('Pumping Anti-Flux for the network');
    }else if(em.alive){
      const tier=str>=2.2&&em.kind!=='boss'?'MASSIVE':(str>=1.5?'Strong':(str>=1?'Standard':'Weak'));
      const kindTag=em.kind==='boss'?'BOSS':(em.kind==='breeder'?'Breeder':(em.kind==='migrant'?'Migrant':(em.kind==='magma'?'MAGMA':(em.kind==='spawn'?'Spawnling':tier))));
      lines.push('Flux Emitter — '+kindTag);
      if(em.shield>0)lines.push('SHIELDED: needs 2 nullifier strikes');
      if(em.kind==='breeder')lines.push('Spawns children every 3 min');
      if(em.kind==='magma')lines.push('Solidifies Flux into rock walls');
      const warm=clamp(S.t/25,0.3,1);
      const rate=S.diff.amt*str*warm*(1+S.t/S.diff.grow)*(S.surge.active?2.5:1)/0.7;
      lines.push('Output ~'+rate.toFixed(1)+' Flux/s (×'+str.toFixed(1)+')');
      if(S.surge.active)lines.push('SURGING ×2.5');
    }else{
      lines.push('Flux Emitter — DESTROYED');
      lines.push('★ Power Zone — build here');
    }
  }else if(rlc){
    const names={rate:'fire rate +15%',speed:'packet speed +25%',energy:'+0.6 energy/s'};
    lines.push('Ancient Relic — '+names[rlc.kind]);
    lines.push(rlc.claimed?'CLAIMED':(rlc.prog>0
      ?'Claiming… '+Math.floor(rlc.prog/12*100)+'%'
      :'Hold a linked backbone within 5 cells'));
  }else if(hover.b){
    const b=hover.b, T=TYPES[b.type];
    lines.push(T.name+'  HP '+Math.ceil(b.hp)+'/'+T.hp);
    if(!b.built)lines.push(b.conn?'Building '+b.buildGot+'/'+T.cost+(b.pend?'':' — queued'):'Building '+b.buildGot+'/'+T.cost);
    if(T.ammoMax){
      lines.push('Ammo '+Math.floor(b.ammo)+'/'+T.ammoMax);
      if(b.built&&b.ammo<(T.shotCost||1))lines.push('OUT OF AMMO — check supply (P)');
    }
    if(T.charge)lines.push('Charge '+b.charge+'/'+T.charge);
    if(b.type==='terra')lines.push('Jobs '+b.tjobs.length);
    if(b.type==='collector')lines.push('+'+(0.003*b.cov*(b.pz?3:1)).toFixed(2)+' e/s ('+b.cov+' cells)');
    else if(T.prod)lines.push('+'+(T.prod*(b.pz&&b.type==='reactor'?6:1)).toFixed(1)+' e/s');
    if(b.pz)lines.push('★ POWER ZONE boost');
    lines.push(b.moving?'Relocating…':(b.conn?'Linked':'NO LINK'));
  }else{
    let tmc=null;
    for(const tm of S.totems)if(Math.abs(hover.cx-tm.cx)<=1&&Math.abs(hover.cy-tm.cy)<=1){tmc=tm;break;}
    if(tmc){
      lines.push('Aether Totem — '+(tmc.on?'CHANNELING':'dormant'));
      lines.push(tmc.on?'+0.05 aether/s to the Forge':'Hold a linked backbone within 5 cells');
    }
    let ndc=null;
    if(S.nodes)for(const n of S.nodes)if(n.cx===hover.cx&&n.cy===hover.cy){ndc=n;break;}
    if(ndc)lines.push('Aether Node — build a Harvester here');
    const i=idx(hover.cx,hover.cy);
    lines.push('Ground L'+S.ter[i]);
    const dep=S.creep[i];
    if(dep>0.05)lines.push('Flux '+dep.toFixed(1));
    if(S.digi[i])lines.push('DIGITALIS — carries Flux uphill, feeds Runners');
    for(const z of S.pzones){
      if(z.cx===hover.cx&&z.cy===hover.cy){lines.push('★ Power Zone — build here');break;}
    }
  }
  const sx=(hover.px-cam.x)*cam.z, sy=(hover.py-cam.y)*cam.z;
  ctx.font=(11*u).toFixed(1)+'px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  let wMax=0;
  for(const ln of lines){const lw=ctx.measureText(ln).width;if(lw>wMax)wMax=lw;}
  const lh=15*u, pad=6*u;
  const bw=wMax+pad*2, bh=lines.length*lh+pad;
  let bx=sx+14*u, by=sy+14*u;
  if(bx+bw>W)bx=sx-bw-10*u;
  if(by+bh>H)by=sy-bh-10*u;
  if(bx<0)bx=0; if(by<0)by=0;
  ctx.fillStyle='rgba(8,13,22,0.85)';
  ctx.fillRect(bx,by,bw,bh);
  ctx.strokeStyle='rgba(77,240,200,0.35)'; ctx.lineWidth=1;
  ctx.strokeRect(bx+0.5,by+0.5,bw-1,bh-1);
  ctx.fillStyle='#d7e3ee';
  for(let i=0;i<lines.length;i++)ctx.fillText(lines[i],bx+pad,by+lh*(i+1)-3*u);
}
/* box select: rectangle + outline on enclosed structures.
   red = recycle (delMode), blue = move (moveMode) */
function drawMarquee(){
  const m=marquee, mv=moveMode;
  const fill=mv?'rgba(120,200,255,0.10)':'rgba(255,93,93,0.10)';
  const line=mv?'rgba(120,200,255,0.9)':'rgba(255,93,93,0.85)';
  const lx=Math.min(m.x0,m.x1), rx=Math.max(m.x0,m.x1);
  const ty=Math.min(m.y0,m.y1), by=Math.max(m.y0,m.y1);
  ctx.fillStyle=fill; ctx.fillRect(lx,ty,rx-lx,by-ty);
  ctx.strokeStyle=line; ctx.lineWidth=1.2;
  ctx.setLineDash([5,4]); ctx.strokeRect(lx,ty,rx-lx,by-ty); ctx.setLineDash([]);
  let n=0;
  for(const b of S.buildings){
    if(!b.alive||b.id===S.coreId||b.moving)continue;
    if(mv && (!b.built||!MOVABLE[b.type]))continue;          // move box only grabs movables
    if(b.px>=lx&&b.px<=rx&&b.py>=ty&&b.py<=by){
      ctx.strokeStyle=mv?'#8fd0ff':'#ff5d5d'; ctx.lineWidth=1.5;
      ctx.strokeRect(b.gx*CELL+1,b.gy*CELL+1,b.sz*CELL-2,b.sz*CELL-2);
      n++;
    }
  }
  if(n){
    ctx.fillStyle=mv?'rgba(159,208,255,0.95)':'rgba(255,93,93,0.95)';
    ctx.font='bold '+(11*uiScale/cam.z).toFixed(2)+'px ui-monospace, Menlo, monospace';
    ctx.textAlign='left';
    ctx.fillText('× '+n,rx+4,ty+11);
  }
}
/* selected move group: pulsing blue outlines + a formation ghost at the cursor */
function drawMoveGroup(){
  if(!moveGroup.length)return;
  const now=performance.now()*0.004;
  const a=(0.5+0.4*Math.sin(now)).toFixed(3);
  const grp=[];
  for(const id of moveGroup){const b=S.byId.get(id);if(b&&b.alive)grp.push(b);}
  ctx.strokeStyle='rgba(143,208,255,'+a+')'; ctx.lineWidth=2;
  for(const b of grp)ctx.strokeRect(b.gx*CELL+1,b.gy*CELL+1,b.sz*CELL-2,b.sz*CELL-2);
  if(!hover.inside||!grp.length)return;
  let sgx=0,sgy=0;
  for(const b of grp){sgx+=b.gx+b.sz/2;sgy+=b.gy+b.sz/2;}
  sgx/=grp.length; sgy/=grp.length;
  for(const b of grp){
    const tx=Math.round(hover.cx+(b.gx+b.sz/2-sgx)), ty=Math.round(hover.cy+(b.gy+b.sz/2-sgy));
    const gx=tx-Math.floor(b.sz/2), gy=ty-Math.floor(b.sz/2);
    const ok=canPlace(S,b.type,tx,ty,b.id).ok;
    ctx.strokeStyle=ok?'rgba(143,208,255,0.7)':'rgba(255,93,93,0.7)';
    ctx.setLineDash([3,3]); ctx.lineWidth=1.2;
    ctx.strokeRect(gx*CELL+0.5,gy*CELL+0.5,b.sz*CELL-1,b.sz*CELL-1);
    ctx.setLineDash([]);
  }
}
/* show-all-ranges overlay (T): faint weapon + link rings for every tower */
function drawAllRanges(){
  ctx.lineWidth=1;
  for(const b of S.buildings){
    if(!b.alive||!b.built||b.moving)continue;
    const T=TYPES[b.type];
    if(T.range&&b.type!=='strafer'){
      ctx.strokeStyle='rgba(255,170,90,0.18)';
      ctx.beginPath(); ctx.arc(b.px,b.py,T.range*(b.pz?1.3:1)*CELL,0,Math.PI*2); ctx.stroke();
    }
  }
}
/* corner-bracket HUD frame around the playfield (screen space) */
let frameCan=null;
function buildFrame(){
  frameCan=document.createElement('canvas');
  frameCan.width=W; frameCan.height=H;
  const c=frameCan.getContext('2d');
  const g=c.createLinearGradient(0,0,0,H);
  if(g&&g.addColorStop){g.addColorStop(0,'rgba(77,240,200,0.5)');g.addColorStop(1,'rgba(60,150,200,0.5)');}
  c.strokeStyle=g||'rgba(77,240,200,0.5)';
  c.lineWidth=2;
  const m=6, L=34;
  for(const [cx,cy,sx,sy] of [[m,m,1,1],[W-m,m,-1,1],[m,H-m,1,-1],[W-m,H-m,-1,-1]]){
    c.beginPath();
    c.moveTo(cx,cy+sy*L); c.lineTo(cx,cy); c.lineTo(cx+sx*L,cy);
    c.stroke();
  }
  c.strokeStyle='rgba(77,240,200,0.12)'; c.lineWidth=1;
  c.strokeRect(m+0.5,m+0.5,W-2*m-1,H-2*m-1);
}
/* minimap: drawn into its own panel canvas (miniCtx) so it never covers
   the playfield. Terrain thumb cached per bake; live Flux/network/threat
   blips + viewport rect. Click/drag-to-jump handled in ui.js on miniCv. */
let mmTerr=null, mmTerrKey=NaN;
export function drawMinimap(){
  const mc=miniCtx, mcv=miniCv;
  if(!mc||!mcv||!S)return;
  const mw=mcv.width, mh=mcv.height;
  if(mmTerrKey!==S.seed || !mmTerr){
    mmTerrKey=S.seed;
    mmTerr=document.createElement('canvas'); mmTerr.width=mw; mmTerr.height=mh;
    if(terCan)mmTerr.getContext('2d').drawImage(terCan,0,0,mw,mh);
  }
  mc.clearRect(0,0,mw,mh);
  mc.fillStyle='#05080e'; mc.fillRect(0,0,mw,mh);
  if(terCan){mc.globalAlpha=0.95;mc.drawImage(mmTerr,0,0);mc.globalAlpha=1;}
  const sx=mw/COLS, sy=mh/ROWS;
  // Anti-Flux (frost) then Flux (azure), sampled every 2 cells
  const cre=S.creep, an=S.anti;
  for(let y=0;y<ROWS;y+=2){
    for(let x=0;x<COLS;x+=2){
      const i=y*COLS+x;
      if(cre[i]>0.5){mc.fillStyle='rgba(90,180,255,0.6)';mc.fillRect(x*sx,y*sy,sx*2,sy*2);}
      else if(an[i]>0.5){mc.fillStyle='rgba(200,240,255,0.5)';mc.fillRect(x*sx,y*sy,sx*2,sy*2);}
    }
  }
  for(const e of S.emitters){
    if(e.captured){mc.fillStyle='#9ffce4';mc.fillRect(e.cx*sx-1.5,e.cy*sy-1.5,3,3);}
    else if(e.alive){mc.fillStyle='#ff5340';mc.fillRect(e.cx*sx-1.5,e.cy*sy-1.5,3,3);}
  }
  for(const tw of S.sporeTowers){if(tw.alive){mc.fillStyle='#ff7d9c';mc.fillRect(tw.cx*sx-1.5,tw.cy*sy-1.5,3,3);}}
  for(const rl of S.relics){mc.fillStyle=rl.claimed?'#6a5a8a':'#b66bff';mc.fillRect(rl.cx*sx-1,rl.cy*sy-1,2,2);}
  if(S.nodes)for(const n of S.nodes){mc.fillStyle='#9a6ad8';mc.fillRect(n.cx*sx-1,n.cy*sy-1,2,2);}
  mc.fillStyle='#4df0c8';
  for(const b of S.buildings){if(b.alive&&b.built)mc.fillRect((b.px/CELL)*sx-1,(b.py/CELL)*sy-1,2,2);}
  const core=S.byId.get(S.coreId);
  if(core&&core.alive){mc.fillStyle='#eafffa';mc.fillRect((core.px/CELL)*sx-2,(core.py/CELL)*sy-2,4,4);}
  for(const r of S.runners){mc.fillStyle='#ff3d6e';mc.fillRect(r.cx*sx-1,r.cy*sy-1,2,2);}
  // viewport rectangle
  mc.strokeStyle='rgba(255,255,255,0.9)'; mc.lineWidth=1.2;
  mc.strokeRect((cam.x/W)*mw+0.5,(cam.y/H)*mh+0.5,(mw/cam.z)-1,(mh/cam.z)-1);
}
/* center the camera on a fraction (fx,fy) of the world — used by the
   minimap's own pointer handlers in ui.js */
export function jumpCamFrac(fx,fy){
  cam.x=clamp(fx,0,1)*W-(W/cam.z)/2;
  cam.y=clamp(fy,0,1)*H-(H/cam.z)/2;
  cam.x=clamp(cam.x,0,W-W/cam.z);
  cam.y=clamp(cam.y,0,H-H/cam.z);
}
export function render(){
  ensureFX();
  if(!frameCan)buildFrame();
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle='#0b0f17';
  ctx.fillRect(0,0,W,H);
  if(!S)return;
  ctx.save();
  ctx.setTransform(dpr*cam.z,0,0,dpr*cam.z,-cam.x*cam.z*dpr,-cam.y*cam.z*dpr);
  if(shake>0&&settings.shake)ctx.translate((Math.random()-0.5)*shake,(Math.random()-0.5)*shake);
  if(terCan){                                   // terCan may be supersampled (BW×BH) → fit to W×H
    ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
    ctx.drawImage(terCan,0,0,terCan.width,terCan.height,0,0,W,H);
  }
  drawCoverage();
  drawPZones();
  drawInhibitorFields();
  renderCreeper();
  drawLinks();
  drawRelics();
  drawTotems();
  drawNodes();
  drawEmitters();
  drawSporeTowers();
  drawTerraJobs();
  drawGhost();
  drawBuildings();
  drawRunners();
  drawShields();
  drawPackets();
  drawShells();
  drawSpores();
  drawAircraft();
  drawShotsFX();
  if(showRanges)drawAllRanges();
  if(S.phase==='placeCore'||S.phase==='play')drawPreview();
  if(moveMode)drawMoveGroup();
  if(marquee)drawMarquee();
  ctx.restore();
  ctx.drawImage(scanCan,0,0,W,H);
  ctx.drawImage(vigCan,0,0,W,H);
  const core=S.byId.get(S.coreId);
  if(core && core.alive && core.hp<core.hpMax*0.6 && (S.phase==='play'||S.phase==='lost')){
    const f=Math.max(0,core.hp/core.hpMax);
    ctx.globalAlpha=Math.min(1,(0.6-f)*1.6)*(0.55+0.45*Math.sin(performance.now()*0.009));
    ctx.drawImage(redVigCan,0,0,W,H);
    ctx.globalAlpha=1;
  }
  // orbital reclaim countdown — big, urgent, centered
  if(S.coreDown){
    const left=Math.max(0,S.reclaimT-S.t);
    ctx.fillStyle='rgba(40,6,10,'+(0.25+0.12*Math.sin(performance.now()*0.008)).toFixed(3)+')';
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#ff6e6e';
    ctx.font='bold '+(30*uiScale).toFixed(1)+'px ui-monospace, Menlo, monospace';
    ctx.textAlign='center';
    ctx.fillText('CORE DOWN — ORBITAL REDEPLOY '+left.toFixed(1)+'s',W/2,40*uiScale);
    ctx.font=(13*uiScale).toFixed(1)+'px ui-monospace, Menlo, monospace';
    ctx.fillStyle='#ffd2a0';
    ctx.fillText('click a flat landing site to drop a new Command Core',W/2,40*uiScale+20*uiScale);
  }
  // Flux-rain squall: diagonal streaks across the screen
  if(S.weather&&S.weather.active){
    const t=performance.now()*0.001;
    ctx.strokeStyle='rgba(120,200,255,0.28)'; ctx.lineWidth=1;
    ctx.beginPath();
    for(let k=0;k<120;k++){
      const sx=((k*97+ (t*420|0))%W), sy=((k*53+(t*620|0))%H);
      ctx.moveTo(sx,sy); ctx.lineTo(sx-5,sy+12);
    }
    ctx.stroke();
  }
  drawBloom();                    // cinematic glow over the world; UI text drawn crisp on top
  drawHoverInfo();
  drawMsgs();
  if(paused && (S.phase==='placeCore'||S.phase==='play')){
    ctx.fillStyle='rgba(7,10,16,0.55)';
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#d7e3ee';
    ctx.font='bold '+(26*uiScale).toFixed(1)+'px ui-monospace, Menlo, monospace';
    ctx.textAlign='center';
    ctx.fillText('PAUSED',W/2,H/2);
    ctx.font=(12*uiScale).toFixed(1)+'px ui-monospace, Menlo, monospace';
    ctx.fillStyle='#7e93a8';
    ctx.fillText('plan freely — drag to pan, pinch to zoom',W/2,H/2+22*uiScale);
  }
  ctx.drawImage(frameCan,0,0,W,H);
  drawMinimap();
  updateHUD();
}
