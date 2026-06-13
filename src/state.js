/* ============================================================
   FLUXFRONT — shared mutable state
   ES module imports are read-only live bindings, so every
   variable that is reassigned from another module gets a setter.
   ============================================================ */

export let S=null;
export let selBuild=null, sel=null, delMode=false;
export let moveSrc=null;        // built structure being relocated (core/cannon/mortar)
export let moveMode=false;      // box-select-to-move mode
export let moveGroup=[];        // building ids selected for group relocation
export let terraTarget=6;       // target ground level for Terp painting (1..12)
export let ghost=null;          // previous run's placements (race-the-ghost overlay)
export let replayMode=false;    // true while watching a replay (input is camera-only)
export let paused=false, speed=1, muted=false;
export const hover={cx:-1,cy:-1,px:0,py:0,b:null,inside:false};
export let shake=0;
export let terCan=null, creepCan=null, cctx=null, creepImg=null;
export let cv=null, ctx=null;
export let miniCv=null, miniCtx=null;   // dedicated minimap canvas in the side panel
export const el={};
export const cam={x:0,y:0,z:1};      // world-space camera: top-left offset + zoom (1 = full map)
export let dpr=1;                    // canvas backing-store scale (devicePixelRatio, capped)
export let uiScale=1;                // scales canvas-space UI text when the canvas is displayed small
export let showRanges=false;         // toggle: draw every weapon/link range at once (T)
export let marquee=null;             // {x0,y0,x1,y1} world-space box-select rect (recycle mode)
// player settings (persisted via storage.js) — visual/audio prefs, never sim
export const settings={musicVol:0.6,sfxVol:0.9,shake:true,colorblind:false,bloom:true,tips:true};

export function setS(v){S=v;}
export function setSelBuild(v){selBuild=v;}
export function setSel(v){sel=v;}
export function setDelMode(v){delMode=v;}
export function setMoveSrc(v){moveSrc=v;}
export function setMoveMode(v){moveMode=v;}
export function setMoveGroup(v){moveGroup=v;}
export function setTerraTarget(v){terraTarget=v;}
export function setGhost(v){ghost=v;}
export function setReplayMode(v){replayMode=v;}
export function setPausedState(v){paused=v;}
export function setSpeedState(v){speed=v;}
export function setMutedState(v){muted=v;}
export function setShake(v){shake=v;}
export function setTerCan(v){terCan=v;}
export function setCreepCan(v){creepCan=v;}
export function setCctx(v){cctx=v;}
export function setCreepImg(v){creepImg=v;}
export function setCv(v){cv=v;}
export function setCtx(v){ctx=v;}
export function setMiniCv(v){miniCv=v;}
export function setMiniCtx(v){miniCtx=v;}
export function setDpr(v){dpr=v;}
export function setUiScale(v){uiScale=v;}
export function setShowRanges(v){showRanges=v;}
export function setMarquee(v){marquee=v;}
