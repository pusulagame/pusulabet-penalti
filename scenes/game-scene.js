import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { sendPenaltyResult } from '../services/result-sender.js';
import { store } from '../state/store.js';
import { getTg, getTgId, isPenaltyLocked } from '../services/telegram.js';
import { assetUrl as ASSET } from '../services/assets.js';
import { fbxResolveUrl } from '../services/fbx-textures.js';
import { MATCHES } from '../config/matches.js';

let strikerIdleRel = 'onuachu/onuachu_idle.fbx';
let strikerKickRel = 'onuachu/onuachu_kick.fbx';
/** @type {Record<string, number> & { kickContactFrac?: number } | null} */
let strikerStrikeTune = null;

/** Oyuncu nesnesinde strikeTune yoksa (eski build) MATCHES’ten idle yoluna göre yükle */
function resolveStrikerStrikeTune(explicitTune, idleRel) {
  if (explicitTune && typeof explicitTune === 'object') return { ...explicitTune };
  if (!idleRel || typeof idleRel !== 'string') return null;
  for (const m of MATCHES) {
    const p = m.players?.find(
      (pl) => idleRel === `${pl.dir}/${pl.idle}` || idleRel.startsWith(`${pl.dir}/`),
    );
    if (p?.strikeTune && typeof p.strikeTune === 'object') return { ...p.strikeTune };
  }
  return null;
}

export function setStrikerAssets(idleRel, kickRel, strikeTune) {
  strikerIdleRel = idleRel;
  strikerKickRel = kickRel;
  strikerStrikeTune = resolveStrikerStrikeTune(strikeTune, idleRel);
}

export async function runPenaltyGame() {
  try {
    await boot();
  } catch (e) {
    console.error('[runPenaltyGame]', e);
    try {
      setLoadProgress(1);
    } catch (_) {}
    throw e;
  }
}


// ── ASSET YOLLARI ──
// BASE/ASSET from module scope

// ── SABITLER ──
const TOTAL=5, BALL_R=0.11;
// Gercek olculer: kale 7.32m x 2.44m, penalti 11m
const GW=7.32, GH=2.44;
// Goal line Z (world). Penalti noktasi 11m onde (kamera tarafina dogru).
const GZ=-16;
const PENALTY_Z = GZ + 11; // = -5
// Penaltı noktası / top / forvet — aynı X; negatif = ekranda sola
// Top sağ ayak hizasına yakın (negatif X topu ayağın solunda bırakıyordu)
const BALL_SPOT_X = 0.07;
const BALL_SPOT_Z = PENALTY_Z + 0.08;
// Forvet + kaleci: ceza noktasından bir adım daha geri (kameraya doğru)
const STRIKER_SPOT_Z = PENALTY_Z + 1.98;
const KEEPER_BASE_Z = GZ + 0.42;
/** Hedef düzlemi: kale ağzının altına doğru genişlet (local / world, m) */
const TARGET_EXTEND_DOWN_LOCAL = 0.32;
const TARGET_EXTEND_DOWN_WORLD = 0.26;
// Goal modelinin BG ile cakismamasi icin biraz geride durmasi
const GOAL_MODEL_Z = GZ - 0.45;
// Hedef/impact duzlemi: kale icinde, kalecinin arkasinda
const TARGET_Z_WORLD = GZ + 0.02;
// Fallback: goal fbx yoksa secim rect'i icin y offset
const GOAL_YOF=0.22;
// FBX Mixamo modelleri genellikle 100x buyuk gelir (cm cinsinden)
// normalizeChar ile hedef boya scale edilir
// Arda oncekine gore ~%30 kucuk
const ARDA_TARGET_H   = 1.28;  // metre
// Kaleci kale icinde gorunur ve daha gercekci
const KEEPER_TARGET_H = 1.78;  // metre

function strikeTuneNum(key, def = 0) {
  const v = strikerStrikeTune?.[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return def;
}
/** Eski dünya X/Z (işaretçi / debug); top yerleşimi striker.root + ballOffsetFromRoot() ile yapılır */
function tunedBallX() {
  return BALL_SPOT_X + strikeTuneNum('ballOffsetX');
}
function tunedBallZ() {
  return BALL_SPOT_Z + strikeTuneNum('ballOffsetZ');
}
function tunedStrikerRootX() {
  return BALL_SPOT_X + strikeTuneNum('rootOffsetX');
}
function tunedStrikerRootZ() {
  return STRIKER_SPOT_Z + strikeTuneNum('rootOffsetZ');
}
/** ballOffset* ve rootOffset* aynı anchor: top = kök + (tunedBall - tunedRoot) — ayrı BALL_SPOT/SPOT_Z farkı burada tek vektörde */
function ballOffsetFromRoot() {
  return {
    x: tunedBallX() - tunedStrikerRootX(),
    y: BALL_R,
    z: tunedBallZ() - tunedStrikerRootZ(),
  };
}
function applyBallRestFromStrikerRoot() {
  if (!striker?.root || !ballMesh) return;
  const o = ballOffsetFromRoot();
  ballMesh.position.set(striker.root.position.x + o.x, o.y, striker.root.position.z + o.z);
}
/** Forvet kökü X/Z — boot ve Faz-2 sonunda tekrar (yerleşimin ezilmesini önlemek için) */
function applyStrikerRootPlacement() {
  if (!striker?.root) return;
  striker.root.position.set(tunedStrikerRootX(), 0, tunedStrikerRootZ());
}

const GMSG=["Net kose! 🔥","Tam isabet! ✨","Harika sut! 💥","Ust kose! 🎯","Gecilmez! ⚡"];
const MMSG=["Kaleci tuttu! 🧤","Az kaldi! 😅","Direkce carpti!","Kacti! 😬","Kaleci sezdi! 👀"];
const CC=['#FFD700','#FF6B00','#00E676','#FF1744','#00BCD4','#E91E63','#fff'];

// ── LOADING UI (progress bar) ──
const ld=document.getElementById('loading');
const ldFill=document.getElementById('ldFill');
const ldPct=document.getElementById('ldPct');

// ── THREE.JS ──
const canvas=document.getElementById('c');
const fx=document.getElementById('fx');
const fctx=fx.getContext('2d');
let W=innerWidth,H=innerHeight;

// Faz-1 manager: ilerleme çubuğunu yönetir
const manager=new THREE.LoadingManager();
manager.setURLModifier(fbxResolveUrl);

// Faz-2 manager: arka planda yükler, progress bar'ı etkilemez
const bgManager=new THREE.LoadingManager();
bgManager.setURLModifier(fbxResolveUrl);

function setLoadProgress(p){
  const pct=Math.round(clamp(p,0,1)*100);
  if(ldPct) ldPct.textContent=pct+'%';
  if(ldFill) ldFill.style.width=pct+'%';
  if(pct>=100){
    if(ld) ld.classList.add('hide');
  }
}
// ÖNEMLİ: manager.onLoad KULLANMA — Three.js her tek dosya bittiğinde itemsLoaded===itemsTotal
// olabiliyor (ör. sadece bg.png); setLoadProgress(1) erken çağrılıp yükleme ekranı kapanıyordu.
// İlerleme yalnızca boot() içindeki setLoadProgress ile yönetilir.

const scene=new THREE.Scene();
const cam=new THREE.PerspectiveCamera(42,W/H,0.1,220);
const isMobile = ()=> window.innerWidth < 768;

// Kamera kompozisyon presetleri (oyun mantigina dokunmadan kadraj duzeltme)
const CAMERA_PRESETS = {
  desktop: {
    pos: new THREE.Vector3(0, 1.65, 9.6),
    look: new THREE.Vector3(0, 1.25, GZ + 2.2),
    fovPortrait: 58,
    fovLandscape: 42,
  },
  mobile: {
    // Mobilde sahne fazla uzak gorunmesin: kamerayi yaklastir + FOV'i daralt
    pos: new THREE.Vector3(0, 1.56, 6.85),
    look: new THREE.Vector3(0, 1.22, GZ + 2.15),
    fovPortrait: 38,
    fovLandscape: 44,
  }
};

function applyCameraPreset(){
  const preset = isMobile() ? CAMERA_PRESETS.mobile : CAMERA_PRESETS.desktop;
  cam.position.copy(preset.pos);
  cam.fov = (H > W) ? preset.fovPortrait : preset.fovLandscape;
  cam.updateProjectionMatrix();
  cam.lookAt(preset.look);
}

const _mob = window.innerWidth < 768 || /Android|iPhone|iPad/i.test(navigator.userAgent);
const rdr=new THREE.WebGLRenderer({
  canvas,
  antialias:!_mob,           // mobilde antialias kapalı → bellek/hız
  alpha:true,
  powerPreference:_mob?'low-power':'high-performance'
});
rdr.setPixelRatio(_mob ? 1.0 : Math.min(devicePixelRatio,1.5));
rdr.outputColorSpace=THREE.SRGBColorSpace;
rdr.toneMapping=THREE.ACESFilmicToneMapping;
rdr.toneMappingExposure=1.05;
rdr.autoClear=false;

// ── BACKGROUND (ayri scene: full-screen cover) ──
const bgScene=new THREE.Scene();
const bgCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const bgPlane=new THREE.Mesh(
  new THREE.PlaneGeometry(2,2),
  new THREE.MeshBasicMaterial({depthTest:false,depthWrite:false})
);
bgPlane.frustumCulled=false;
bgPlane.renderOrder=-1000;
bgScene.add(bgPlane);
let bgTex=null;
function updateBgCover(){
  if(!bgTex||!bgTex.image) return;
  const iw=bgTex.image.width||1536;
  const ih=bgTex.image.height||1024;
  const imgAspect=iw/ih;
  const viewAspect=W/H;
  // cover: ekranı doldur, taşanı kırp
  if(viewAspect>imgAspect){
    const scale=viewAspect/imgAspect;
    bgTex.repeat.set(1,1/scale);
    bgTex.offset.set(0,(1-bgTex.repeat.y)/2);
  }else{
    const scale=imgAspect/viewAspect;
    bgTex.repeat.set(1/scale,1);
    bgTex.offset.set((1-bgTex.repeat.x)/2,0);
  }
  bgTex.needsUpdate=true;
}

function resize(){
  W=innerWidth;H=innerHeight;
  canvas.width=W;canvas.height=H;
  fx.width=W;fx.height=H;
  rdr.setSize(W,H,false);
  cam.aspect=W/H;
  applyCameraPreset();
  updateBgCover();
}
resize();
addEventListener('resize',resize);
// Mobil WebView'lerde (Telegram dahil) bazen sadece visualViewport degisir.
if (window.visualViewport){
  window.visualViewport.addEventListener('resize', resize);
  window.visualViewport.addEventListener('scroll', resize);
}

// Isiklar
scene.add(new THREE.AmbientLight(0xffffff,0.8));
const sun=new THREE.DirectionalLight(0xfff5e6,1.0);
sun.position.set(-8,22,12);
scene.add(sun);
const fill=new THREE.DirectionalLight(0xaaccff,0.25);
fill.position.set(10,8,-5);
scene.add(fill);

// Zemin
const gnd=new THREE.Mesh(
  new THREE.PlaneGeometry(120,120),
  new THREE.MeshStandardMaterial({transparent:true,opacity:0,depthWrite:false})
);
gnd.rotation.x=-Math.PI/2;
scene.add(gnd);

// Penalti noktasi (world-space: kale merkezinden 11m)
const wm=new THREE.MeshBasicMaterial({color:0xffffff});
const sp=new THREE.Mesh(new THREE.CircleGeometry(0.22,32),wm);
sp.rotation.x=-Math.PI/2;sp.position.set(0,0.02,PENALTY_Z);scene.add(sp);
const ln=new THREE.Mesh(new THREE.PlaneGeometry(9.15,0.12),wm);
ln.rotation.x=-Math.PI/2;ln.position.set(0,0.02,PENALTY_Z-5.5);scene.add(ln);

// Kale agzi rect'i (world) — goal.fbx yuklenince bbox'tan guncellenir
let goalRect={xMin:-GW/2,xMax:GW/2,yMin:GOAL_YOF-TARGET_EXTEND_DOWN_WORLD,yMax:GOAL_YOF+GH,z:GZ};
// Target plane'in world Z'i (goalun icinde, kaleci arkasi) — sabit
// Goal local uzayinda hedef rect (hiG goalObj child olunca local yerlesim buradan gelir)
let goalLocalRect={xMin:-GW/2,xMax:GW/2,yMin:-TARGET_EXTEND_DOWN_LOCAL,yMax:GH,z:0};

// ── SAHNE OBJELERI (TDZ hatasini onlemek icin erken tanim) ──
let striker=null;   // {models:{idle,kick}, mixers:{idle,kick}, actions:{idle,kick}, current}
let keeper=null; // {models:{idle,dive_left,...}, mixers:{...}, actions:{...}, current}
let goalObj=null; // goal.fbx
let ballObj=null; // ball.fbx (opsiyonel)

// Goal hit plane mesh (raycast): goal ile aynı düzlemde ve aynı dönüşte
let goalHitMesh=null;
const rc=new THREE.Raycaster();
const ndc=new THREE.Vector2();
const hit=new THREE.Vector3();

// Goal hit plane mesh (raycast): goal ile aynı düzlemde ve aynı dönüşte
function ensureGoalHitMesh(){
  const w=Math.max(0.01,goalLocalRect.xMax-goalLocalRect.xMin);
  const h=Math.max(0.01,goalLocalRect.yMax-goalLocalRect.yMin);
  const cx=(goalLocalRect.xMin+goalLocalRect.xMax)/2;
  const cy=(goalLocalRect.yMin+goalLocalRect.yMax)/2;

  if(!goalHitMesh){
    goalHitMesh=new THREE.Mesh(
      new THREE.PlaneGeometry(w,h),
      new THREE.MeshBasicMaterial({
        transparent:true,
        opacity:0,
        depthTest:false,
        depthWrite:false,
        side:THREE.DoubleSide,
      })
    );
    goalHitMesh.name='goalHitMesh';
    goalHitMesh.renderOrder=-1;
  }else{
    goalHitMesh.geometry.dispose();
    goalHitMesh.geometry=new THREE.PlaneGeometry(w,h);
  }
  if(goalHitMesh.material) goalHitMesh.material.side=THREE.DoubleSide;

  goalHitMesh.position.set(cx,cy,goalLocalRect.z);

  if(goalObj){
    if(goalHitMesh.parent!==goalObj) goalObj.add(goalHitMesh);
  }else{
    if(goalHitMesh.parent!==scene) scene.add(goalHitMesh);
    goalHitMesh.position.set(0,GOAL_YOF+GH/2,TARGET_Z_WORLD);
  }
}
ensureGoalHitMesh();

// Aim marker: hedef noktasinda kucuk isaret (desktop hover + mobile tap feedback)
const aimMarker=new THREE.Mesh(
  new THREE.CircleGeometry(0.12,24),
  new THREE.MeshBasicMaterial({color:0xffd700,transparent:true,opacity:0.0,depthTest:true,depthWrite:false})
);
aimMarker.rotation.x=-Math.PI/2;
aimMarker.renderOrder=3;
scene.add(aimMarker);

let aim={inside:false, world:new THREE.Vector3(), local:new THREE.Vector3()};

function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }

function getAimFromPointer(cx,cy){
  if(!goalHitMesh) return null;
  ndc.x=(cx/W)*2-1; ndc.y=-(cy/H)*2+1;
  rc.setFromCamera(ndc,cam);
  const ints=rc.intersectObject(goalHitMesh,false);
  if(!ints||ints.length===0) return null;

  const wp=ints[0].point;
  const lp=goalObj ? goalObj.worldToLocal(wp.clone()) : wp.clone();

  // clamp to goal local bounds
  lp.x=clamp(lp.x,goalLocalRect.xMin,goalLocalRect.xMax);
  lp.y=clamp(lp.y,goalLocalRect.yMin,goalLocalRect.yMax);
  lp.z=goalLocalRect.z;

  const w=goalObj ? goalObj.localToWorld(lp.clone()) : new THREE.Vector3(lp.x, lp.y+GOAL_YOF, TARGET_Z_WORLD);
  return {world:w, local:lp};
}

// ── FBX YUKLEME ──
const fbxLoader=new FBXLoader(manager);
const fbxLoaderBg=new FBXLoader(bgManager); // Faz-2 için

function loadFBX(url){
  return new Promise(resolve=>{
    fbxLoader.load(url,obj=>resolve(obj),undefined,err=>{
      console.error('[FBX] Yuklenemedi:',url,err?.message||err);
      resolve(null);
    });
  });
}

function loadFBXBg(url){
  return new Promise(resolve=>{
    fbxLoaderBg.load(url,obj=>resolve(obj),undefined,err=>{
      console.warn('[FBX-BG] Atlandı:',url,err?.message||err);
      resolve(null);
    });
  });
}

/** Kale FBX: FBX + tüm bağımlı doku istekleri bitene kadar bekle (paylaşımlı bgManager erken callback verebiliyor) */
function loadFBXWithAllDeps(url){
  return new Promise((resolve)=>{
    const mgr=new THREE.LoadingManager();
    mgr.setURLModifier(fbxResolveUrl);
    const loader=new FBXLoader(mgr);
    let obj=null;
    let settled=false;
    const finish=(v)=>{ if(settled) return; settled=true; resolve(v); };
    mgr.onLoad=()=>finish(obj);
    mgr.onError=(u)=>{ console.warn('[FBX deps]',u); };
    loader.load(url,(o)=>{ obj=o; },undefined,(err)=>{
      console.warn('[FBX] Kale yüklenemedi:',url,err?.message||err);
      finish(null);
    });
    setTimeout(()=>finish(obj),120000);
  });
}

function waitTextureReady(tex){
  if(!tex||!tex.isTexture) return Promise.resolve();
  const img=tex.image;
  if(!img) return Promise.resolve();
  if(img.complete&&img.naturalWidth!==0) return Promise.resolve();
  return new Promise((res)=>{
    const done=()=>res();
    if(img.addEventListener){ img.addEventListener('load',done,{once:true}); img.addEventListener('error',done,{once:true}); }
    else done();
    setTimeout(done,15000);
  });
}

async function waitForObjectTextures(root){
  if(!root) return;
  const pending=[];
  root.traverse((o)=>{
    if(!o.isMesh) return;
    const mats=Array.isArray(o.material)?o.material:[o.material];
    for(const m of mats){
      if(!m) continue;
      for(const k of Object.keys(m)){
        const v=m[k];
        if(v&&v.isTexture) pending.push(waitTextureReady(v));
      }
    }
  });
  if(pending.length) await Promise.all(pending);
}

/** Kale FBX: dünya ölçüsü (7.32×2.44m) + kale çizgisi Z — bootBg'de önce eksikti → dev ağ / yanlış konum */
function applyGoalFbx(gfbx){
  if(!gfbx) return;
  if(goalObj){
    scene.remove(goalObj);
    goalObj=null;
  }
  gfbx.traverse((o)=>{ if(o.isMesh){ o.castShadow=false; o.receiveShadow=false; }});
  gfbx.updateMatrixWorld(true);
  const box0=new THREE.Box3().setFromObject(gfbx);
  const sz=new THREE.Vector3();
  box0.getSize(sz);
  if(sz.x>0.0001 && sz.y>0.0001){
    const sx=GW/sz.x;
    const sy=GH/sz.y;
    const s=Math.min(sx,sy);
    gfbx.scale.setScalar(s);
  }
  gfbx.position.set(0,0,GOAL_MODEL_Z);
  gfbx.updateMatrixWorld(true);
  const bGround=new THREE.Box3().setFromObject(gfbx);
  gfbx.position.y-=bGround.min.y;
  gfbx.updateMatrixWorld(true);
  gfbx.renderOrder=2;
  scene.add(gfbx);
  goalObj=gfbx;

  gfbx.updateMatrixWorld(true);
  const b2=new THREE.Box3().setFromObject(gfbx);
  const inv=new THREE.Matrix4().copy(gfbx.matrixWorld).invert();
  const wMin=b2.min.clone().applyMatrix4(inv);
  const wMax=b2.max.clone().applyMatrix4(inv);
  const localZ=new THREE.Vector3(0,0,TARGET_Z_WORLD).applyMatrix4(inv).z;
  const lyMin2=Math.min(wMin.y,wMax.y);
  const lyMax2=Math.max(wMin.y,wMax.y);
  goalLocalRect={
    xMin:Math.min(wMin.x,wMax.x),
    xMax:Math.max(wMin.x,wMax.x),
    yMin:lyMin2-TARGET_EXTEND_DOWN_LOCAL,
    yMax:Math.max(lyMin2+0.02,lyMax2),
    z:localZ,
  };
  goalRect={
    xMin:b2.min.x,
    xMax:b2.max.x,
    yMin:b2.min.y-TARGET_EXTEND_DOWN_WORLD,
    yMax:Math.max(b2.min.y+0.02,b2.max.y),
    z:TARGET_Z_WORLD,
  };
  ensureGoalHitMesh();
  console.log('[Goal.fbx] yerleştirildi (ölçek + Z)');
}

// FBX modelini normalize et: hedef yukseklige scale, ayaklari y=0'a getir
function normalizeChar(obj, targetH){
  // FBX Mixamo modelleri cm cinsinden gelir (100x buyuk)
  // Once bbox olc, sonra scale ayarla
  obj.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(obj);
  const sz=new THREE.Vector3();
  box.getSize(sz);
  if(sz.y<0.001){console.warn('normalizeChar: sifir yukseklik');return;}
  const s=targetH/sz.y;
  obj.scale.setScalar(s);
  obj.updateMatrixWorld(true);
  // Ayaklari y=0'a getir
  const b2=new THREE.Box3().setFromObject(obj);
  obj.position.y-=b2.min.y;
}

/** FBX: tek yüzey / sRGB doku — bazı modellerde karakter görünmez kalıyor */
function applyFbxCharacterMaterials(root){
  root.traverse((o)=>{
    if(!o.isMesh) return;
    const mats=Array.isArray(o.material)?o.material:[o.material];
    mats.forEach((m)=>{
      if(!m) return;
      if(m.map) m.map.colorSpace=THREE.SRGBColorSpace;
      if(m.emissiveMap) m.emissiveMap.colorSpace=THREE.SRGBColorSpace;
      m.side=THREE.DoubleSide;
      // FBX'ten gelen düşük opacity / transparent bayraklarını sıfırla
      m.transparent=false;
      m.opacity=1.0;
      m.alphaTest=0;
      m.depthWrite=true;
      m.needsUpdate=true;
    });
  });
}

// ── KARAKTER YAPISI ──
// Her FBX dosyasi kendi model+mixer+action ikilisiyle calisir
// Animasyon gecisi: onceki model gizlenir, yeni model gosterilir

// (moved earlier) arda/keeper/goalObj/ballObj

function playAnim(ch, name){
  if(!ch || !ch.models[name]) return;
  if(ch.current===name) return;

  // Onceki modeli gizle
  const prev=ch.models[ch.current];
  if(prev) prev.visible=false;

  // Onceki action'i durdur
  const prevAct=ch.actions[ch.current];
  if(prevAct) prevAct.stop();

  // Yeni modeli goster
  const next=ch.models[name];
  if(next) next.visible=true;

  ch.current=name;
  const nextAct=ch.actions[name];
  if(nextAct){
    nextAct.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
  }
}

function tickChar(ch, dt){
  if(!ch) return;
  Object.values(ch.mixers).forEach(mx=>mx.update(dt));
}

// ── OYUN DURUMU ──
let ballMesh=null;
let goals=0,misses=0,shots=0,gameActive=false,canShoot=true,ready=false;
let loopStarted=false;
let parts=[],confs=[];
let ballAnim={on:false,t:0,dur:0.55,p0:null,p1:null,p2:null};
let ballCaught=false;
let ballCatchAnchor=null;
const _tmpV=new THREE.Vector3();
const _tmpV2=new THREE.Vector3();
let kAnim={phase:'idle',t:0,sx:0,tx:0,side:'center',yN:0};
const K_REACT_DELAY=0.14;
const PRE_SHOT_DELAY=0.0;      // hedef secilince kick hemen baslar
let shotTarget=null;
const DEBUG_SHOT=false;
/** Ayak/top debug: `true` → ~45 karede bir Ball/Foot Vector3 log (doğrulama sonrası false) */
const DEBUG_BALL_FOOT = false;
let _debugBallFootFrame = 0;
let ballTetherToFoot = true;
let pendingShotTimer=null;
let pendingKickTimer=null;

function easeOut(t){return 1-Math.pow(1-t,3);}
function easeIO(t){return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}

function getKeeperCatchAnchor(){
  if(!keeper) return null;
  const model = keeper.models?.[keeper.current] || keeper.root;
  if(!model) return keeper.root;
  let best=null;
  model.traverse(o=>{
    if(!o || !o.isBone || !o.name) return;
    const n=o.name.toLowerCase();
    // Mixamo: mixamorigRightHand / LeftHand etc.
    if(n.includes('righthand') || n.includes('lefthand')) best=o;
    if(!best && (n.includes('hand') || n.includes('wrist') || n.includes('forearm') || n.includes('spine2') || n.includes('chest'))) best=o;
  });
  return best || model;
}

/** Şut ayağı (Mixamo: RightFoot / mixamorig:RightFoot) */
function getStrikerFootBone(modelRoot){
  if(!modelRoot) return null;
  let rightFoot=null, anyFoot=null;
  modelRoot.traverse((o)=>{
    if(!o?.isBone || !o.name) return;
    const n=o.name.toLowerCase().replace(/:/g,'');
    if(n.includes('right') && n.includes('foot')) rightFoot=o;
    if(!anyFoot && n.includes('foot')) anyFoot=o;
  });
  return rightFoot || anyFoot;
}

function getKickContactDelaySec(){
  const act=striker?.actions?.kick;
  let duration=1;
  if(act){
    const clip=typeof act.getClip==='function' ? act.getClip() : act._clip;
    if(clip && Number.isFinite(clip.duration) && clip.duration>0) duration=clip.duration;
  }
  const frac=strikeTuneNum('kickContactFrac', 0.7);
  const f=clamp(Number.isFinite(frac) ? frac : 0.7, 0.15, 0.95);
  return clamp(duration * f, 0.04, Math.max(0.06, duration - 0.02));
}

function syncBallToStrikerFoot(){
  if(!ballMesh || !striker?.root) return;
  const model=striker.models?.[striker.current] || striker.models?.idle;
  const footBone=model ? getStrikerFootBone(model) : null;
  if(footBone){
    footBone.getWorldPosition(_tmpV);
    footBone.getWorldDirection(_tmpV2);
    const off=strikeTuneNum('footForwardOffset', 0.18);
    _tmpV2.multiplyScalar(off);
    _tmpV.add(_tmpV2);
    ballMesh.position.set(_tmpV.x, BALL_R, _tmpV.z);
    if(DEBUG_BALL_FOOT){
      _debugBallFootFrame++;
      if(_debugBallFootFrame % 45 === 0){
        console.log('Foot:', _tmpV.clone());
        console.log('Ball:', ballMesh.position.clone());
      }
    }
  }else{
    applyBallRestFromStrikerRoot();
    if(DEBUG_BALL_FOOT){
      _debugBallFootFrame++;
      if(_debugBallFootFrame % 45 === 0){
        console.log('Ball (root fallback):', ballMesh.position.x, ballMesh.position.y, ballMesh.position.z, '(no foot bone)');
      }
    }
  }
}

function detachBallToScene(){
  if(!ballMesh) return;
  if(ballMesh.parent && ballMesh.parent !== scene){
    ballMesh.getWorldPosition(_tmpV);
    scene.add(ballMesh);
    ballMesh.position.copy(_tmpV);
  }
  ballCaught=false;
  ballCatchAnchor=null;
}

function attachBallToKeeper(){
  if(!ballMesh || !keeper) return;
  const anchor=getKeeperCatchAnchor();
  if(!anchor) return;
  detachBallToScene();
  ballTetherToFoot=false;
  ballCatchAnchor=anchor;
  anchor.add(ballMesh);

  // Offset: anim tipine gore kabaca elde/goguste dursun (bone yoksa modele gore calisir)
  const animName = (keeper.current||'').toLowerCase();
  let ox=0, oy=1.05, oz=0.28;
  if(animName.includes('low')){ oy=0.58; oz=0.22; ox=animName.includes('right')?0.18:-0.18; }
  else if(animName.includes('dive')){ oy=0.85; oz=0.26; ox=animName.includes('right')?0.22:-0.22; }
  else if(animName.includes('sidestep')){ oy=1.0; oz=0.32; ox=0.10; }

  ballMesh.position.set(ox,oy,oz);
  ballMesh.rotation.set(0,0,0);
  ballAnim.on=false;
  ballCaught=true;
}

// ── TARGETING (tam 3D raycast) ──
function updateAimVisual(cx,cy){
  if(!gameActive||!canShoot){ aim.inside=false; aimMarker.material.opacity=0; canvas.style.cursor='default'; return; }
  const a=getAimFromPointer(cx,cy);
  if(!a){ aim.inside=false; aimMarker.material.opacity=0; canvas.style.cursor='default'; return; }
  aim.inside=true;
  aim.world.copy(a.world);
  aim.local.copy(a.local);
  aimMarker.position.set(a.world.x,0.012,a.world.z); // yere projekte marker
  aimMarker.material.opacity=0.55;
  canvas.style.cursor='crosshair';
}

function pickKAnim(side,yN){
  const high=yN>0.66;
  const low=yN<0.33;
  // Mobilde yalnızca idle+dive_left+dive_right yüklü → bunlara map'le
  if(_mob){
    if(side==='center') return 'idle';
    return side==='left'?'dive_left':'dive_right';
  }
  if(high) return side==='left'?'dive_left':(side==='right'?'dive_right':(Math.random()<0.5?'dive_left':'dive_right'));
  if(low)  return side==='left'?'save_low_left':(side==='right'?'save_low_right':'save_low_left');
  if(side==='center') return Math.random()<0.5?'sidestep_left':'sidestep_right';
  return side==='left'?'dive_left':'dive_right';
}

function shootAt(worldTarget, localTarget){
  if(!ready||!canShoot||!gameActive) return;
  canShoot=false;
  document.getElementById('banner').style.display='none';
  // hedef noktasi secildi — kisa marker goster
  aimMarker.material.opacity=0.75;

  // clamp again for safety
  const lp=localTarget ? localTarget.clone() : (goalObj?goalObj.worldToLocal(worldTarget.clone()):worldTarget.clone());
  lp.x=clamp(lp.x,goalLocalRect.xMin,goalLocalRect.xMax);
  lp.y=clamp(lp.y,goalLocalRect.yMin,goalLocalRect.yMax);
  lp.z=goalLocalRect.z;
  // worldTarget zaten goal plane uzerinde + clamped geliyor; onu dogrudan kullan (mapping drift olmasin)
  const target=worldTarget ? worldTarget.clone() : (goalObj ? goalObj.localToWorld(lp.clone()) : new THREE.Vector3(lp.x, lp.y+GOAL_YOF, TARGET_Z_WORLD));
  shotTarget=target.clone();

  const goalCx=(goalRect.xMin+goalRect.xMax)/2;
  const dx=target.x-goalCx;
  const halfW=(goalRect.xMax-goalRect.xMin)/2;
  const reachX=Math.max(0.6,halfW-0.55);
  const diveX=goalCx+clamp(dx,-reachX,reachX);
  let side='center';
  if(dx<-0.35) side='left';
  else if(dx>0.35) side='right';

  const yN=(lp.y-goalLocalRect.yMin)/Math.max(0.01,(goalLocalRect.yMax-goalLocalRect.yMin));

  // Zorluk dengesi: hedeflenen sut basina gol olasiligi ~0.2466 (≈ %24.7)
  // (5 sutta >=3 gol kazanma olasiligi ≈ %10)
  // Daha kolay: taban gol olasiligi arttirildi
  const pGoalBase = 0.44;
  const cornerScore = clamp(Math.abs(dx)/Math.max(0.001, halfW), 0, 1); // 0 merkez, 1 kose
  const heightScore = clamp(yN, 0, 1); // 0 alt, 1 ust
  // Kullanicinin kose/ust tercihine kucuk odul, toplam ortalama pGoalBase etrafinda kalir
  const pGoal = clamp(
    pGoalBase + 0.07*(cornerScore-0.5) + 0.05*(heightScore-0.5),
    0.18,
    0.62
  );
  const saved = Math.random() > pGoal;

  // Eski timer'lari temizle (spam tap/click)
  if(pendingShotTimer){ clearTimeout(pendingShotTimer); pendingShotTimer=null; }
  if(pendingKickTimer){ clearTimeout(pendingKickTimer); pendingKickTimer=null; }

  // 1) hedef secildi → ~1s sonra kick baslat
  pendingShotTimer=setTimeout(()=>{
    playAnim(striker,'kick');

    // 2) kick temas aninda topu firlat + kaleciyi reaksiyona sok
    pendingKickTimer=setTimeout(()=>{
      // keeper her zaman ortadan baslar (teleport yok)
      if(keeper){
        keeper.root.position.x=0;
        keeper.root.position.y=0;
        kAnim={phase:'react',t:0,sx:0,tx:diveX,side,yN};
      }

      const p0=ballMesh.position.clone();
      const p2=target.clone();
      const p1=new THREE.Vector3().addVectors(p0,p2).multiplyScalar(0.5);
      p1.y+=2.0+Math.random()*0.4;
      ballAnim={on:true,t:0,dur:0.55,p0,p1,p2};
      if(DEBUG_SHOT){
        console.log('[shot] target',shotTarget,'ballStart',p0,'dir',new THREE.Vector3().subVectors(p2,p0).normalize());
      }
      setTimeout(()=>land(saved,target),560);
    }, contactDelayMs);
  }, Math.round(PRE_SHOT_DELAY*1000));
}

function land(saved,wt){
  shots++;
  const dot=document.getElementById('dot-'+(shots-1));
  const wv=wt.clone().project(cam);
  const px=(wv.x*0.5+0.5)*W, py=(-wv.y*0.5+0.5)*H;
  if(!saved){
    goals++;document.getElementById('sGoal').textContent=goals;
    if(dot)dot.classList.add('goal');
    spawnP(px,py);spawnC(px,py-H*0.06);
    showRes(true);
  }else{
    // SAVE: topu world-space'te dondurmak yerine kaleciye bagla (caught) ya da sektir (deflect)
    const caught = Math.random() < 0.65; // basit ayrim: caught vs deflect
    if(caught && keeper){
      attachBallToKeeper();
    }else if(ballMesh){
      // Deflection/parry: kisa bir sekme animasyonu (kalede asili kalmasin)
      detachBallToScene();
      const p0=ballMesh.position.clone();
      const dir=new THREE.Vector3().subVectors(p0, new THREE.Vector3(0,1.0,KEEPER_BASE_Z)).normalize();
      const p2=p0.clone().add(new THREE.Vector3(dir.x,0.1,1.0).multiplyScalar(2.0));
      p2.y=Math.max(0.18, p0.y-0.25);
      p2.z=Math.min(p2.z, GZ+1.4);
      const p1=new THREE.Vector3().addVectors(p0,p2).multiplyScalar(0.5);
      p1.y+=0.35;
      ballAnim={on:true,t:0,dur:0.28,p0,p1,p2};
    }
    misses++;document.getElementById('sMiss').textContent=misses;
    if(dot)dot.classList.add('miss');
    showRes(false);
  }
  document.getElementById('sRemain').textContent=TOTAL-shots;
}

function showRes(ok){
  const ov=document.getElementById('result');
  document.getElementById('rEmoji').textContent=ok?'⚽':'🧤';
  const rt=document.getElementById('rTxt');
  rt.textContent=ok?'GOL!':'TUTTU!';
  rt.className='rtxt '+(ok?'gt':'mt');
  document.getElementById('rSub').textContent=(ok?GMSG:MMSG)[Math.floor(Math.random()*(ok?GMSG:MMSG).length)];
  ov.classList.add('show');
  setTimeout(()=>{
    ov.classList.remove('show');
    if(pendingShotTimer){ clearTimeout(pendingShotTimer); pendingShotTimer=null; }
    if(pendingKickTimer){ clearTimeout(pendingKickTimer); pendingKickTimer=null; }
    if(ballMesh){
      detachBallToScene();
      applyStrikerRootPlacement();
      ballTetherToFoot=true;
      syncBallToStrikerFoot();
      ballAnim.on=false;
    }
    playAnim(striker,'idle');
    if(keeper){
      kAnim={phase:'return',t:0,sx:keeper.root.position.x,tx:0};
      playAnim(keeper,'idle');
    }
    if(shots>=TOTAL) setTimeout(showFinal,450);
    else{canShoot=true;document.getElementById('banner').style.display='';}
  },1600);
}

function showFinal(){
  const tgIdEarly = getTgId();
  if(tgIdEarly){
    try{ localStorage.setItem('penalty_done_'+tgIdEarly,'1'); }catch(e){}
  }
  // HUD tek kaynak: global goals ile tutarsizlik olmasin
  const goalsHud = parseInt(document.getElementById('sGoal')?.textContent || '0', 10) || goals;
  const pct=goalsHud/TOTAL;
  const t=document.getElementById('fTrophy');
  const ti=document.getElementById('fTitle');
  const m=document.getElementById('fMsg');
  const fs=document.getElementById('fScore');
  if(fs) fs.textContent=goalsHud+'/'+TOTAL+' GOL';
  const won = goalsHud >= 3;
  if(won){
    if(t) t.textContent = '';
    if(ti){ ti.textContent = 'KAZANDIN!'; ti.style.color = '#00E676'; }
    if(m) m.textContent = pct===1 ? 'Mukemmel performans!' : 'Tebrikler! Kazandin.';
  }else{
    if(t) t.textContent = '';
    if(ti){ ti.textContent = 'KAYBETTİN!'; ti.style.color = '#FF5252'; }
    if(m) m.textContent = 'Bu sefer kaleci kazandi!';
  }
  document.getElementById('final').classList.add('show');
  gameActive=false;
  spawnC(W/2,H*0.35);

  const score = goalsHud + '/' + TOTAL;

  sendPenaltyResult({
    goals: goalsHud,
    won,
    score,
    goalsHud,
    total: TOTAL,
  });

  const btnReplay=document.querySelector('#final .btnP');
  if(btnReplay && getTgId()){ btnReplay.style.display='none'; }
}

function resetGame(){
  if(isPenaltyLocked()) return;
  ballTetherToFoot=true;
  goals=0;misses=0;shots=0;canShoot=true;gameActive=true;
  document.getElementById('sGoal').textContent='0';
  document.getElementById('sMiss').textContent='0';
  document.getElementById('sRemain').textContent=TOTAL;
  document.getElementById('final').classList.remove('show');
  document.getElementById('banner').style.display='';
  parts=[];confs=[];buildDots();
  if(pendingShotTimer){ clearTimeout(pendingShotTimer); pendingShotTimer=null; }
  if(pendingKickTimer){ clearTimeout(pendingKickTimer); pendingKickTimer=null; }
  if(ballMesh){
    detachBallToScene();
    applyStrikerRootPlacement();
    ballTetherToFoot=true;
    syncBallToStrikerFoot();
    ballAnim.on=false;
  }
  playAnim(striker,'idle');
  if(keeper){
    keeper.root.position.set(0,0,KEEPER_BASE_Z);
    kAnim={phase:'idle',t:0,sx:0,tx:0};
    playAnim(keeper,'idle');
  }
}
window.resetGame=resetGame;

window.openBet=function(){
  const url='https://t2m.io/guncelpusulabet';
  const t = getTg();
  try{
    if(t && t.openLink) t.openLink(url);
    else window.open(url,'_blank','noopener');
  }catch(e){
    window.open(url,'_blank','noopener');
  }
};

window.openPusulaTelegram=function(){
  const url='https://t.me/pusulasocial';
  const t = getTg();
  try{
    if(t && t.openTelegramLink) t.openTelegramLink(url);
    else window.open(url,'_blank','noopener');
  }catch(e){
    window.open(url,'_blank','noopener');
  }
};

// ── PARTIKUL ──
function spawnP(cx,cy){for(let i=0;i<32;i++){const a=Math.random()*Math.PI*2,s=1.5+Math.random()*5;parts.push({x:cx,y:cy,vx:Math.cos(a)*s,vy:Math.sin(a)*s-2,life:1,decay:0.02+Math.random()*0.02,r:2+Math.random()*5,col:Math.random()<0.5?'#00E676':'#FFD700'});}}
function spawnC(cx,cy){for(let i=0;i<70;i++){const a=(Math.random()-0.5)*Math.PI*1.5-Math.PI/2,s=4+Math.random()*11;confs.push({x:cx,y:cy,vx:Math.cos(a)*s+(Math.random()-0.5)*4,vy:Math.sin(a)*s,w:4+Math.random()*8,h:3+Math.random()*5,rot:Math.random()*Math.PI*2,rotV:(Math.random()-0.5)*0.35,life:1,decay:0.008+Math.random()*0.008,col:CC[Math.floor(Math.random()*CC.length)]});}}
function drawFx(){
  fctx.clearRect(0,0,W,H);
  for(let i=parts.length-1;i>=0;i--){const p=parts[i];p.x+=p.vx;p.y+=p.vy;p.vy+=0.18;p.life-=p.decay;if(p.life<=0){parts.splice(i,1);continue;}fctx.globalAlpha=p.life;fctx.fillStyle=p.col;fctx.beginPath();fctx.arc(p.x,p.y,p.r*p.life,0,Math.PI*2);fctx.fill();}
  for(let i=confs.length-1;i>=0;i--){const c=confs[i];c.x+=c.vx;c.y+=c.vy;c.vy+=0.28;c.vx*=0.99;c.rot+=c.rotV;c.life-=c.decay;if(c.life<=0){confs.splice(i,1);continue;}fctx.save();fctx.globalAlpha=c.life;fctx.translate(c.x,c.y);fctx.rotate(c.rot);fctx.fillStyle=c.col;fctx.fillRect(-c.w/2,-c.h/2,c.w,c.h);fctx.restore();}
  fctx.globalAlpha=1;
}

// ── INPUT ──
function buildDots(){const cont=document.getElementById('dots');cont.innerHTML='';for(let i=0;i<TOTAL;i++){const d=document.createElement('div');d.className='dot';d.id='dot-'+i;cont.appendChild(d);}}
canvas.addEventListener('mousemove',e=>{updateAimVisual(e.clientX,e.clientY);});
canvas.addEventListener('click',e=>{
  if(!gameActive||!canShoot) return;
  const a=getAimFromPointer(e.clientX,e.clientY);
  if(a){ shootAt(a.world,a.local); }
});
canvas.addEventListener('touchstart',e=>{
  if(!gameActive||!canShoot) return;
  const t=e.touches[0];
  const a=getAimFromPointer(t.clientX,t.clientY);
  if(a){ e.preventDefault(); shootAt(a.world,a.local); }
},{passive:false});
canvas.addEventListener('touchmove',e=>{ if(gameActive&&canShoot){ const t=e.touches[0]; updateAimVisual(t.clientX,t.clientY); }},{passive:true});

// ── ANA DONGU ──
let lastT=0;
function loop(ts){
  const dt=Math.min((ts-lastT)/1000,0.05);lastT=ts;

  rdr.clear();
  rdr.render(bgScene,bgCam);
  rdr.clearDepth();

  tickChar(striker,dt);
  tickChar(keeper,dt);

  if(
    ballTetherToFoot &&
    ballMesh &&
    !ballCaught &&
    !ballAnim.on &&
    gameActive &&
    striker?.root
  ){
    syncBallToStrikerFoot();
    sp.position.set(ballMesh.position.x, 0.02, ballMesh.position.z);
  }

  if(ballAnim.on&&ballMesh){
    ballAnim.t+=dt;
    const u=Math.min(ballAnim.t/ballAnim.dur,1),e=easeIO(u);
    const{p0,p1,p2}=ballAnim;
    ballMesh.position.x=(1-e)*(1-e)*p0.x+2*(1-e)*e*p1.x+e*e*p2.x;
    ballMesh.position.y=(1-e)*(1-e)*p0.y+2*(1-e)*e*p1.y+e*e*p2.y;
    ballMesh.position.z=(1-e)*(1-e)*p0.z+2*(1-e)*e*p1.z+e*e*p2.z;
    ballMesh.rotation.x+=14*dt;ballMesh.rotation.z+=10*dt;
    if(u>=1)ballAnim.on=false;
  }

  if(keeper){
    if(kAnim.phase==='react'){
      kAnim.t+=dt;
      keeper.root.position.x=0;
      keeper.root.position.y=0;
      if(kAnim.t>=K_REACT_DELAY){
        kAnim.phase='dive';
        kAnim.t=0;
        playAnim(keeper, pickKAnim(kAnim.side,kAnim.yN));
      }
    }else if(kAnim.phase==='dive'){
      kAnim.t+=dt;
      const u=Math.min(kAnim.t/0.42,1),e=easeOut(u);
      keeper.root.position.x=kAnim.sx+(kAnim.tx-kAnim.sx)*e;
      // Dalis yuksekligini sinirla (bar ustune cikmasin / ziplama abartmasin)
      keeper.root.position.y=Math.sin(u*Math.PI)*0.10;
      if(u>=1)kAnim.phase='hold';
    }else if(kAnim.phase==='hold'){
      // Pozisyonu sabitle (idle bob'a dusup ziplama/floating yapmasin)
      keeper.root.position.y=0;
    }else if(kAnim.phase==='return'){
      kAnim.t+=dt;
      const u=Math.min(kAnim.t/0.6,1),e=easeIO(u);
      keeper.root.position.x=kAnim.sx*(1-e);
      keeper.root.position.y=0;
      if(u>=1){kAnim.phase='idle';keeper.root.position.set(0,0,KEEPER_BASE_Z);}
    }else{
      keeper.root.position.x=Math.sin(ts*0.0014)*0.04;
      keeper.root.position.y=0;
    }
  }

  rdr.render(scene,cam);
  drawFx();
  requestAnimationFrame(loop);
}

// ── BOOT ──
const texLoader=new THREE.TextureLoader(manager);
texLoader.setCrossOrigin('anonymous');

/* ── Oyuncu kurulum yardımcıları ─────────────────────── */
function _setupStriker(idle){
  if(!idle) return;
  const root=new THREE.Group();
  root.rotation.y=Math.PI;
  root.renderOrder=10;
  scene.add(root);
  striker={root,models:{},mixers:{},actions:{},current:''};
  normalizeChar(idle,ARDA_TARGET_H);
  applyFbxCharacterMaterials(idle);
  idle.visible=true;
  root.add(idle);
  striker.models.idle=idle;
  const mx=new THREE.AnimationMixer(idle);
  striker.mixers.idle=mx;
  const clip=idle.animations?.[0];
  if(clip){
    const act=mx.clipAction(clip);
    act.setLoop(THREE.LoopRepeat,Infinity);
    act.play();
    striker.actions.idle=act;
  }
  striker.current='idle';
  applyStrikerRootPlacement();
  console.log('[Striker] rootX', tunedStrikerRootX(), 'ballX', tunedBallX(), 'tune', !!strikerStrikeTune);
}

function _addStrikerAnim(fbx,name,loopType){
  if(!striker||!fbx) return;
  normalizeChar(fbx,ARDA_TARGET_H);
  applyFbxCharacterMaterials(fbx);
  fbx.visible=false;
  if(name==='kick'&&strikerStrikeTune){
    const t=strikerStrikeTune;
    const kx=Number.isFinite(t.kickMeshX)?t.kickMeshX:strikeTuneNum('kickPosX');
    const kz=Number.isFinite(t.kickMeshZ)?t.kickMeshZ:strikeTuneNum('kickPosZ');
    fbx.position.x+=kx;
    fbx.position.z+=kz;
  }
  striker.root.add(fbx);
  striker.models[name]=fbx;
  const mx=new THREE.AnimationMixer(fbx);
  striker.mixers[name]=mx;
  const clip=fbx.animations?.[0];
  if(clip){
    const act=mx.clipAction(clip);
    act.setLoop(loopType,loopType===THREE.LoopOnce?1:Infinity);
    if(loopType===THREE.LoopOnce) act.clampWhenFinished=true;
    striker.actions[name]=act;
  }
  console.log('[Striker] anim eklendi:',name);
}

function _setupKeeper(idle){
  if(!idle) return;
  const kRoot=new THREE.Group();
  kRoot.position.set(0,0,KEEPER_BASE_Z);
  kRoot.rotation.y=0;
  kRoot.renderOrder=8;
  scene.add(kRoot);
  keeper={root:kRoot,models:{},mixers:{},actions:{},current:''};
  normalizeChar(idle,KEEPER_TARGET_H);
  applyFbxCharacterMaterials(idle);
  idle.visible=true;
  kRoot.add(idle);
  const mx=new THREE.AnimationMixer(idle);
  const clip=idle.animations?.[0];
  if(clip){
    const act=mx.clipAction(clip);
    act.setLoop(THREE.LoopRepeat,Infinity);
    act.play();
    keeper.models.idle=idle;
    keeper.mixers.idle=mx;
    keeper.actions.idle=act;
  }
  keeper.current='idle';
  try{
    const kb=new THREE.Box3().setFromObject(kRoot);
    kRoot.position.y-=kb.min.y;
    const kh=kb.max.y-kb.min.y;
    if(kh>GH*0.92){ const s=(GH*0.90)/kh; kRoot.scale.multiplyScalar(s); kRoot.position.y=0; }
  }catch(e){}
  console.log('[Keeper] idle hazır');
}

function _addKeeperAnim(name,fbx,loopType){
  if(!keeper||!fbx) return;
  normalizeChar(fbx,KEEPER_TARGET_H);
  applyFbxCharacterMaterials(fbx);
  fbx.visible=false;
  keeper.root.add(fbx);
  const mx=new THREE.AnimationMixer(fbx);
  const clip=fbx.animations?.[0];
  if(clip){
    const act=mx.clipAction(clip);
    act.setLoop(loopType,loopType===THREE.LoopOnce?1:Infinity);
    if(loopType===THREE.LoopOnce) act.clampWhenFinished=true;
    keeper.models[name]=fbx;
    keeper.mixers[name]=mx;
    keeper.actions[name]=act;
  }
  console.log('[Keeper] anim eklendi:',name);
}

/* ── Faz-2: Kick, kaleci ekstra animasyonlar, kale FBX — yükleme bitmeden oyun açılmaz ── */
async function bootBg(){
  const kExtra=_mob?[
    ['dive_left',  ASSET('keeper/dive_left.fbx'),  THREE.LoopOnce],
    ['dive_right', ASSET('keeper/dive_right.fbx'), THREE.LoopOnce],
  ]:[
    ['dive_left',      ASSET('keeper/dive_left.fbx'),      THREE.LoopOnce],
    ['dive_right',     ASSET('keeper/dive_right.fbx'),     THREE.LoopOnce],
    ['save_low_left',  ASSET('keeper/save_low_left.fbx'),  THREE.LoopOnce],
    ['save_low_right', ASSET('keeper/save_low_right.fbx'), THREE.LoopOnce],
    ['sidestep_left',  ASSET('keeper/sidestep_left.fbx'),  THREE.LoopOnce],
    ['sidestep_right', ASSET('keeper/sidestep_right.fbx'), THREE.LoopOnce],
  ];
  const bgSteps = 1 + kExtra.length + 1; // kick + ekstra + kale
  let bgDone = 0;
  const bumpBg = () => {
    bgDone++;
    setLoadProgress(0.88 + Math.min(1, bgDone / bgSteps) * 0.11);
  };

  const kick=await loadFBXBg(ASSET(strikerKickRel));
  _addStrikerAnim(kick,'kick',THREE.LoopOnce);
  bumpBg();

  for(const[name,url,lt] of kExtra){
    const fbx=await loadFBXBg(url);
    _addKeeperAnim(name,fbx,lt);
    bumpBg();
  }

  try{
    const gfbx=await loadFBXBg(ASSET('goal/goal_texture.fbx'));
    if(gfbx) applyGoalFbx(gfbx);
  }catch(e){ console.warn('[Goal.fbx] bootBg hatası',e?.message||e); }
  bumpBg();
  console.log('[bootBg] Tamamlandı');
}

/* ── Ana boot: Faz-1 (engeller) → oyunu başlat → Faz-2 (arka) ── */
async function boot(){
  setLoadProgress(0.04);

  // BG
  try{
    bgTex=await new Promise((res,rej)=>texLoader.load(ASSET('bg.png'),res,undefined,rej));
    bgTex.colorSpace=THREE.SRGBColorSpace;
    bgTex.wrapS=THREE.ClampToEdgeWrapping;
    bgTex.wrapT=THREE.ClampToEdgeWrapping;
    bgTex.repeat.set(1,1); bgTex.offset.set(0,0);
    bgPlane.material.map=bgTex;
    bgPlane.material.needsUpdate=true;
    updateBgCover();
  }catch(e){ console.error('[BG] Yuklenemedi',e); }
  setLoadProgress(0.12);

  // Top dokusu
  try{
    const bt=await new Promise((res,rej)=>texLoader.load(ASSET('ball/ball_texture.png'),res,undefined,rej));
    bt.colorSpace=THREE.SRGBColorSpace;
    ballMesh=new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R,32,32),
      new THREE.MeshStandardMaterial({map:bt,roughness:0.35,metalness:0.05})
    );
    ballMesh.position.set(tunedBallX(), BALL_R, tunedBallZ());
    scene.add(ballMesh);
  }catch(e){ console.error('[Ball.png] Yuklenemedi',e); }
  setLoadProgress(0.22);

  // Striker IDLE (Faz-1)
  const strikerIdle=await loadFBX(ASSET(strikerIdleRel));
  _setupStriker(strikerIdle);
  setLoadProgress(0.52);

  // Kaleci IDLE (Faz-1)
  const keeperIdle=await loadFBX(ASSET('keeper/idle.fbx'));
  _setupKeeper(keeperIdle);
  setLoadProgress(0.82);

  // Kale wireframe (her zaman var — FBX'siz fallback)
  ensureGoalHitMesh();
  setLoadProgress(0.88);

  // Faz-2: kick, kaleci ek animasyonlar, kale modeli — bitene kadar yükleme ekranı açık kalır
  try{
    await bootBg();
  }catch(e){
    console.warn('[bootBg] Hata',e);
  }

  if(striker?.root) await waitForObjectTextures(striker.root);
  if(keeper?.root) await waitForObjectTextures(keeper.root);
  if(ballMesh) await waitForObjectTextures(ballMesh);
  if(goalObj) await waitForObjectTextures(goalObj);

  applyCameraPreset();
  try{ rdr.compile(scene,cam); }catch(_){}
  await new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r)));

  // Top + forvet: Faz-2 sonunda konumları strikeTune’a göre yenile (kick yükleme sırası vb.)
  applyStrikerRootPlacement();
  ballTetherToFoot=true;
  if (ballMesh) syncBallToStrikerFoot();

  // OYUNU BAŞLAT (dokular + shader ön derleme sonrası)
  sp.position.set(ballMesh ? ballMesh.position.x : tunedBallX(), 0.02, ballMesh ? ballMesh.position.z : PENALTY_Z);
  ready=true;
  gameActive=true;
  canShoot=true;
  setLoadProgress(1.0);
  buildDots();
  console.log('[boot] Faz-1+Faz-2 tamam → oyun açık');
  if(!loopStarted){ loopStarted=true; requestAnimationFrame(loop); }
}
