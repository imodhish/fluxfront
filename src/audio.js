/* ============================================================
   FLUXFRONT — WebAudio sound design (lazy init on first pointer
   event). Master bus -> compressor; sfx are synthesized from
   oscillators + filtered noise, panned by world x where given.
   Music starts with the audio context (see music.js).
   ============================================================ */

import {W,clamp} from './constants.js';
import {muted,settings} from './state.js';
import {musicStart,setMusicIntensity,setMusicVol} from './music.js';

let AC=null, master=null, sfxBus=null, noiseBuf=null, lastShotSfx=0;

export function initAudio(){
  if(!AC){
    try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){AC=null;}
    if(AC){
      const comp=AC.createDynamicsCompressor();
      comp.threshold.value=-18; comp.ratio.value=6;
      comp.connect(AC.destination);
      master=AC.createGain(); master.gain.value=muted?0:1; master.connect(comp);
      sfxBus=AC.createGain(); sfxBus.gain.value=settings.sfxVol; sfxBus.connect(master);
      noiseBuf=AC.createBuffer(1,AC.sampleRate,AC.sampleRate);
      const d=noiseBuf.getChannelData(0);
      for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
      musicStart(AC,master);
      setMusicVol(settings.musicVol);
    }
  }
  if(AC && AC.state==='suspended')AC.resume();
}
/* apply music/sfx volume sliders (settings.musicVol / settings.sfxVol) */
export function applyVolumes(){
  if(sfxBus)sfxBus.gain.value=settings.sfxVol;
  setMusicVol(settings.musicVol);
}
export function applyMute(){
  if(master)master.gain.linearRampToValueAtTime(muted?0:1,AC.currentTime+0.08);
}
export function setIntensity(v){setMusicIntensity(v);}

/* ---------- synthesis helpers ---------- */
function pan(x){
  if(x===undefined || !AC.createStereoPanner)return sfxBus;
  const p=AC.createStereoPanner();
  p.pan.value=clamp((x/W)*2-1,-1,1)*0.7;
  p.connect(sfxBus);
  return p;
}
function tone(o){ // {type,f0,f1,lin,g,dur,at,x}
  const t=AC.currentTime+(o.at||0);
  const osc=AC.createOscillator(), g=AC.createGain();
  osc.type=o.type;
  osc.frequency.setValueAtTime(o.f0,t);
  if(o.f1)osc.frequency[o.lin?'linearRampToValueAtTime':'exponentialRampToValueAtTime'](Math.max(20,o.f1),t+o.dur);
  g.gain.setValueAtTime(o.g,t);
  g.gain.exponentialRampToValueAtTime(0.0001,t+o.dur);
  osc.connect(g); g.connect(pan(o.x));
  osc.start(t); osc.stop(t+o.dur+0.05);
}
function burst(o){ // filtered noise: {f0,f1,type,q,g,dur,at,x}
  const t=AC.currentTime+(o.at||0);
  const src=AC.createBufferSource(); src.buffer=noiseBuf;
  src.playbackRate.value=0.8+Math.random()*0.4;
  const f=AC.createBiquadFilter();
  f.type=o.type||'lowpass'; f.Q.value=o.q||0.8;
  f.frequency.setValueAtTime(o.f0,t);
  if(o.f1)f.frequency.exponentialRampToValueAtTime(Math.max(30,o.f1),t+o.dur);
  const g=AC.createGain();
  g.gain.setValueAtTime(o.g,t);
  g.gain.exponentialRampToValueAtTime(0.0001,t+o.dur);
  src.connect(f); f.connect(g); g.connect(pan(o.x));
  src.start(t); src.stop(t+o.dur+0.05);
}

/* ---------- sfx ---------- */
export function sfx(kind,x){
  if(muted || !AC)return;
  if(kind==='shot'){
    const now=performance.now();
    if(now-lastShotSfx<70)return;
    lastShotSfx=now;
  }
  if(kind==='shot'){
    tone({type:'square',f0:900,f1:240,g:0.03,dur:0.07,x:x});
    burst({type:'highpass',f0:3200,g:0.04,dur:0.05,x:x});
  }else if(kind==='mortar'){
    tone({type:'sine',f0:150,f1:50,g:0.13,dur:0.3,x:x});
    burst({f0:700,f1:200,g:0.07,dur:0.25,x:x});
  }else if(kind==='boom'){
    burst({f0:900,f1:80,g:0.3,dur:0.5,x:x});
    tone({type:'sine',f0:100,f1:34,g:0.17,dur:0.45,x:x});
  }else if(kind==='done'){
    tone({type:'triangle',f0:523,g:0.05,dur:0.12,x:x});
    tone({type:'triangle',f0:784,g:0.05,dur:0.2,at:0.07,x:x});
    burst({type:'highpass',f0:5200,g:0.015,dur:0.18,at:0.07,x:x});
  }else if(kind==='die'){
    tone({type:'sawtooth',f0:320,f1:60,g:0.11,dur:0.35,x:x});
    burst({f0:1400,f1:150,g:0.12,dur:0.32,x:x});
  }else if(kind==='charge'){
    tone({type:'sine',f0:280,f1:880,lin:true,g:0.05,dur:0.55,x:x});
    burst({type:'highpass',f0:3800,g:0.02,dur:0.5,x:x});
  }else if(kind==='nullify'){
    tone({type:'triangle',f0:880,f1:160,g:0.13,dur:0.6,x:x});
    burst({f0:2400,f1:120,g:0.22,dur:0.6,x:x});
    tone({type:'sine',f0:60,f1:30,g:0.15,dur:0.7,x:x});
  }else if(kind==='win'){
    const seq=[440,554,659,880];
    for(let i=0;i<seq.length;i++)tone({type:'triangle',f0:seq[i],g:0.07,dur:0.5,at:i*0.13});
    burst({type:'highpass',f0:4500,g:0.025,dur:0.9,at:0.3});
  }else if(kind==='lose'){
    tone({type:'sawtooth',f0:220,f1:55,g:0.09,dur:0.9});
    tone({type:'sawtooth',f0:208,f1:50,g:0.07,dur:0.95});
    tone({type:'sine',f0:55,f1:30,g:0.12,dur:1});
  }else if(kind==='uiclick'){
    tone({type:'square',f0:1300,f1:850,g:0.018,dur:0.045});
  }else if(kind==='error'){
    tone({type:'square',f0:130,g:0.05,dur:0.12});
    tone({type:'square',f0:98,g:0.05,dur:0.14,at:0.09});
  }else if(kind==='alarm'){
    tone({type:'square',f0:660,g:0.05,dur:0.14});
    tone({type:'square',f0:520,g:0.05,dur:0.18,at:0.17});
  }
}
