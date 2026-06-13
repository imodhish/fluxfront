/* ============================================================
   FLUXFRONT — network: backbone graph, paths, link targeting
   ============================================================ */

import {COLS,ROWS,CELL,TYPES,idx,dist,clamp} from './constants.js';

/* effective link radius: Power Zones stretch a backbone's reach ×1.5 */
export function linkRof(b){
  return TYPES[b.type].linkR*(b.pz?1.5:1);
}
export function recomputeNet(st){
  st.netDirty=false;
  st.linkPairs=[];
  for(const b of st.buildings){b.conn=false;b.parent=0;}
  const core=st.byId.get(st.coreId);
  if(!core || !core.alive || core.moving){computeCoverage(st);return;}   // airborne core = network down
  const bbs=st.buildings.filter(b=>b.alive&&b.built&&!b.moving&&TYPES[b.type].backbone);
  const adj=new Map();
  for(const b of bbs)adj.set(b.id,[]);
  for(let i=0;i<bbs.length;i++){
    for(let j=i+1;j<bbs.length;j++){
      const a=bbs[i], c=bbs[j];
      const maxR=Math.max(linkRof(a),linkRof(c))*CELL;
      if(dist(a.px,a.py,c.px,c.py)<=maxR){
        adj.get(a.id).push(c.id);
        adj.get(c.id).push(a.id);
        st.linkPairs.push([a,c]);
      }
    }
  }
  core.conn=true; core.parent=0;
  const q=[core.id];
  while(q.length){
    const id=q.shift();
    const ns=adj.get(id);
    if(!ns)continue;
    for(const nid of ns){
      const nb=st.byId.get(nid);
      if(nb && !nb.conn){nb.conn=true;nb.parent=id;q.push(nid);}
    }
  }
  for(const b of st.buildings){
    if(!b.alive || b.conn || b.moving)continue;
    let best=null, bd=1e9;
    for(const bb of bbs){
      if(!bb.conn)continue;
      const d=dist(b.px,b.py,bb.px,bb.py);
      if(d<=linkRof(bb)*CELL && d<bd){bd=d;best=bb;}
    }
    if(best){b.conn=true;b.parent=best.id;st.linkPairs.push([b,best]);}
  }
  computeCoverage(st);
}
/* CW3-style field economy: each ground cell pays out to at most one
   collector, so territory itself is the resource */
const covOwner=new Int16Array(COLS*ROWS);
export function computeCoverage(st){
  covOwner.fill(-1);
  for(const b of st.buildings){
    if(b.type!=='collector' || !b.alive || !b.built || b.moving){if(b.cov!==undefined)b.cov=0;continue;}
    b.cov=0;
    const r=TYPES.collector.linkR*(b.pz?1.5:1);
    const cx=b.px/CELL, cy=b.py/CELL, ri=Math.ceil(r);
    const x0=clamp(Math.floor(cx-ri),0,COLS-1), x1=clamp(Math.ceil(cx+ri),0,COLS-1);
    const y0=clamp(Math.floor(cy-ri),0,ROWS-1), y1=clamp(Math.ceil(cy+ri),0,ROWS-1);
    for(let y=y0;y<=y1;y++){
      for(let x=x0;x<=x1;x++){
        const i=idx(x,y);
        if(covOwner[i]!==-1)continue;
        if(dist(x+0.5,y+0.5,cx,cy)>r)continue;
        covOwner[i]=b.id;
        b.cov++;
      }
    }
  }
}
export function pathTo(st,b){
  const pts=[]; let cur=b, guard=0;
  while(cur && guard++<200){
    pts.push([cur.px,cur.py]);
    if(cur.id===st.coreId)break;
    cur=st.byId.get(cur.parent);
  }
  if(!cur || cur.id!==st.coreId)return null;
  pts.reverse();
  return pts;
}
export function linkTargets(st,type,cx,cy){
  const T=TYPES[type], sz=T.sz;
  const gx=cx-Math.floor(sz/2), gy=cy-Math.floor(sz/2);
  const px=(gx+sz/2)*CELL, py=(gy+sz/2)*CELL;
  const myR=T.linkR||0;
  const out=[];
  for(const b of st.buildings){
    if(!b.alive || !b.conn || !b.built)continue;
    const bT=TYPES[b.type];
    if(!bT.backbone)continue;
    const d=dist(px,py,b.px,b.py);
    const reach=(T.backbone?Math.max(myR,bT.linkR):bT.linkR)*CELL;
    if(d<=reach)out.push(b);
  }
  return out;
}
