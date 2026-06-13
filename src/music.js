/* ============================================================
   FLUXFRONT — procedural adaptive music
   Layered WebAudio ambient engine: sub drone, minor-key pads,
   echoed arpeggios and a pulse bass. Intensity (0..1) follows
   the threat level fed in from the HUD and crossfades layers.
   No assets, no dependencies — everything is synthesized.
   ============================================================ */

let ac=null, bus=null, arpSend=null;
let started=false, timer=null;
let nextT=0, step=0;
let intensity=0.15, target=0.15;

const ROOT=110;                                   // A2
const STEP=0.5;                                   // scheduler grid (s)
const CHORD_STEPS=8;                              // 4 s per chord
const CHORDS=[                                    // semitones from A2
  [0,3,7,12],                                     // Am
  [-4,0,3,8],                                     // F
  [3,7,10,15],                                    // C
  [7,10,14,19]                                    // Em
];
const freq=s=>ROOT*Math.pow(2,s/12);

export function setMusicVol(v){
  if(bus)bus.gain.value=0.25*(v<0?0:(v>1?1:v));   // 0.6 → ~0.15 (old default)
}
export function musicStart(ctx,dest){
  if(started || !ctx)return;
  ac=ctx; started=true;
  bus=ac.createGain(); bus.gain.value=0.15; bus.connect(dest);
  // feedback delay for the arp layer
  const delay=ac.createDelay(1); delay.delayTime.value=0.375;
  const fb=ac.createGain(); fb.gain.value=0.38;
  const wet=ac.createGain(); wet.gain.value=0.5;
  delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(bus);
  arpSend=ac.createGain(); arpSend.connect(bus); arpSend.connect(delay);
  // endless sub drone with a slow breathing LFO
  const sub=ac.createOscillator(); sub.type='sine'; sub.frequency.value=ROOT/2;
  const sg=ac.createGain(); sg.gain.value=0.05;
  const lfo=ac.createOscillator(); lfo.frequency.value=0.07;
  const lg=ac.createGain(); lg.gain.value=0.02;
  lfo.connect(lg); lg.connect(sg.gain);
  sub.connect(sg); sg.connect(bus);
  sub.start(); lfo.start();
  nextT=ac.currentTime+0.1;
  timer=setInterval(schedule,200);
}
export function setMusicIntensity(v){target=v<0?0:(v>1?1:v);}

function schedule(){
  intensity+=(target-intensity)*0.06;
  const ahead=ac.currentTime+0.7;
  while(nextT<ahead){
    scheduleStep(step,nextT);
    step++; nextT+=STEP;
  }
}
function scheduleStep(st,t){
  const chord=CHORDS[((st/CHORD_STEPS)|0)%CHORDS.length];
  if(st%CHORD_STEPS===0)pad(chord,t);
  // arpeggio density and brightness rise with intensity
  const p=0.22+intensity*0.65;
  if(rnd()<p)pluck(chord,t+rnd()*0.06);
  if(intensity>0.7 && rnd()<0.5)pluck(chord,t+STEP/2,12);
  // pulse bass enters at high threat
  if(intensity>0.55){
    pulse(chord[0]-12,t,0.05*(intensity-0.5)*2);
    if(intensity>0.8)pulse(chord[0]-12,t+STEP/2,0.035);
  }
}
let seed=98765;
function rnd(){seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;}

function pad(chord,t){
  const dur=CHORD_STEPS*STEP;
  const lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.Q.value=0.7;
  lp.frequency.setValueAtTime(350+intensity*900,t);
  lp.connect(bus);
  for(const s of chord){
    for(const det of[-5,4]){
      const o=ac.createOscillator(), g=ac.createGain();
      o.type='sawtooth'; o.frequency.value=freq(s); o.detune.value=det;
      g.gain.setValueAtTime(0.0001,t);
      g.gain.linearRampToValueAtTime(0.016,t+1.4);
      g.gain.setValueAtTime(0.016,t+dur-1.6);
      g.gain.linearRampToValueAtTime(0.0001,t+dur+0.4);
      o.connect(g); g.connect(lp);
      o.start(t); o.stop(t+dur+0.5);
    }
  }
}
function pluck(chord,t,lift){
  const s=chord[(rnd()*chord.length)|0]+12+(lift||0)+(rnd()<0.3?12:0);
  const o=ac.createOscillator(), g=ac.createGain();
  o.type='triangle'; o.frequency.value=freq(s);
  const a=0.025+intensity*0.03;
  g.gain.setValueAtTime(0.0001,t);
  g.gain.linearRampToValueAtTime(a,t+0.02);
  g.gain.exponentialRampToValueAtTime(0.0001,t+0.9);
  o.connect(g); g.connect(arpSend);
  o.start(t); o.stop(t+1);
}
function pulse(s,t,a){
  const o=ac.createOscillator(), g=ac.createGain();
  const lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=320;
  o.type='square'; o.frequency.value=freq(s);
  g.gain.setValueAtTime(a,t);
  g.gain.exponentialRampToValueAtTime(0.0001,t+0.22);
  o.connect(lp); lp.connect(g); g.connect(bus);
  o.start(t); o.stop(t+0.25);
}
