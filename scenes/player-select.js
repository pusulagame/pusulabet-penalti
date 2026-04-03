import { teamLabel } from '../config/matches.js';
import { store } from '../state/store.js';
import { getTgId, isPenaltyLocked } from '../services/telegram.js';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const PB_USER_KEY = 'pusulabet_username';

function normPbUser(v) {
  return (v || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

/* ─────────────────────────────────────────────────────────
   TEK PAYLAŞIMLI RENDERER — tüm önizlemeler 1 WebGL context
   Her kare: sahne → offscreen WebGL canvas → 2D canvas kopyası
   ───────────────────────────────────────────────────────── */
const PW = 160, PH = 200;

let _glCanvas   = null; // offscreen WebGL canvas (DOM'a eklenmez)
let _renderer   = null;
let _rafId      = null;
let _lastT      = 0;
const _items    = [];   // { scene, cam, mixer, obj, canvas2d, rotT, ready }

function getRenderer() {
  if (_renderer) return _renderer;
  _glCanvas = document.createElement('canvas');
  _glCanvas.width  = PW;
  _glCanvas.height = PH;
  _renderer = new THREE.WebGLRenderer({
    canvas: _glCanvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,   // drawImage için zorunlu
  });
  _renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  _renderer.setSize(PW, PH);
  _renderer.outputColorSpace  = THREE.SRGBColorSpace;
  _renderer.toneMapping       = THREE.ACESFilmicToneMapping;
  _renderer.toneMappingExposure = 1.1;
  return _renderer;
}

/* Tüm preview state'ini temizle (oyun başlamadan önce çağrılır) */
export function disposePreviews() {
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  _items.length = 0;
  if (_renderer) { _renderer.dispose(); _renderer = null; }
  _glCanvas = null;
}

function startLoop() {
  if (_rafId) return;
  const renderer = getRenderer();

  function loop(t) {
    _rafId = requestAnimationFrame(loop);
    const dt = Math.min((t - _lastT) / 1000, 0.05);
    _lastT = t;

    for (const item of _items) {
      if (!item.ready || !item.canvas2d?.isConnected) continue;
      item.rotT += dt;
      item.mixer?.update(dt);
      if (item.obj) item.obj.rotation.y = Math.sin(item.rotT * 0.55) * 0.28;

      renderer.render(item.scene, item.cam);

      /* WebGL → 2D canvas kopyası */
      const ctx = item.canvas2d.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, PW, PH);
        ctx.drawImage(_glCanvas, 0, 0, PW, PH);
      }
    }
  }
  loop(0);
}

function buildScene() {
  const scene = new THREE.Scene();
  const cam   = new THREE.PerspectiveCamera(40, PW / PH, 0.1, 100);
  cam.position.set(0, 1.55, 3.4);
  cam.lookAt(0, 1.2, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.95));
  const sun  = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.45);
  fill.position.set(-2, 1, -2);
  scene.add(fill);

  return { scene, cam };
}

function fixMaterials(obj) {
  obj.traverse((c) => {
    if (!c.isMesh) return;
    const mats = Array.isArray(c.material) ? c.material : [c.material];
    mats.forEach((m) => {
      if (!m) return;
      if (m.map)         m.map.colorSpace         = THREE.SRGBColorSpace;
      if (m.emissiveMap) m.emissiveMap.colorSpace  = THREE.SRGBColorSpace;
      m.side        = THREE.DoubleSide;
      m.transparent = false;
      m.opacity     = 1.0;
      m.alphaTest   = 0;
      m.depthWrite  = true;
      m.needsUpdate = true;
    });
  });
}

function normalizeObj(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const h   = box.max.y - box.min.y || 1;
  const sc  = 1.9 / h;
  obj.scale.setScalar(sc);
  obj.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(obj);
  obj.position.x = -(b2.min.x + b2.max.x) / 2;
  obj.position.y = -b2.min.y;
}

function addPreview(canvas2d, dir, idleFile) {
  canvas2d.width  = PW;
  canvas2d.height = PH;

  const { scene, cam } = buildScene();
  const item = { scene, cam, mixer: null, obj: null, canvas2d, rotT: 0, ready: false };
  _items.push(item);

  const loader = new FBXLoader();
  loader.load(
    `./assets/${dir}/${idleFile}`,
    (obj) => {
      fixMaterials(obj);
      normalizeObj(obj);
      scene.add(obj);

      const mixer = new THREE.AnimationMixer(obj);
      if (obj.animations?.[0]) mixer.clipAction(obj.animations[0]).play();
      item.mixer = mixer;
      item.obj   = obj;
      item.ready = true;
    },
    undefined,
    (err) => console.warn('[Preview] FBX yüklenemedi:', dir, err?.message || err)
  );
}

/* ─────────────────────────────────────────────────────────
   EXPORT: Oyuncu Seç ekranı
   ───────────────────────────────────────────────────────── */
export function mountPlayerSelect({ root, onStart }) {
  const m = store.selectedMatch;
  if (!m) return;

  /* Önceki turdan kalan loop ve sahneleri temizle */
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  _items.length = 0;

  root.innerHTML = `
    <div class="scene-inner">
      <button type="button" class="scene-back" id="btnBack">← Maç</button>
      <h1 class="scene-title">OYUNCU SEÇ</h1>
      <p class="scene-sub">${escapeHtml(m.label)}</p>
      <div class="player-grid" id="playerGrid"></div>
      <div class="sform scene-form">
        <label class="slab" for="pbUserScene">Pusulabet Kullanıcı Adı</label>
        <input class="sinp" id="pbUserScene" autocomplete="username"
               inputmode="text" maxlength="24" placeholder="ornek: pusulaci123" />
        <div class="serr" id="pbErrScene"></div>
      </div>
      <button type="button" class="btnP" id="btnStartGame"
              disabled style="opacity:0.65">BİR OYUNCU SEÇ</button>
    </div>
  `;

  const grid     = root.querySelector('#playerGrid');
  const pbIn     = root.querySelector('#pbUserScene');
  const pbErr    = root.querySelector('#pbErrScene');
  const btnStart = root.querySelector('#btnStartGame');
  const btnBack  = root.querySelector('#btnBack');

  try { pbIn.value = normPbUser(localStorage.getItem(PB_USER_KEY) || ''); } catch (_) {}

  if (isPenaltyLocked()) {
    btnStart.disabled = true;
    btnStart.textContent = 'KATILIM TAMAMLANDI';
    btnStart.style.opacity = '0.55';
    pbIn.disabled = true;
    if (pbErr) pbErr.textContent = 'Bu Telegram hesabıyla zaten katıldın.';
  }

  m.players.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'player-card';
    b.dataset.playerId = p.id;

    /* 2D canvas — görüntü buraya kopyalanır */
    const cv = document.createElement('canvas');
    cv.className = 'player-preview';

    b.appendChild(cv);
    b.insertAdjacentHTML('beforeend', `
      <div class="player-name">${escapeHtml(p.name)}</div>
      <div class="player-team">${escapeHtml(teamLabel(p.teamId))}</div>
    `);

    b.addEventListener('click', () => {
      grid.querySelectorAll('.player-card').forEach((el) => el.classList.remove('selected'));
      b.classList.add('selected');
      store.selectedPlayer   = p;
      store.selectedTeamId   = p.teamId;
      store.selectedTeamName = teamLabel(p.teamId);
      if (!isPenaltyLocked()) {
        btnStart.disabled = false;
        btnStart.style.opacity = '';
        btnStart.textContent   = 'PENALTİYİ BAŞLAT';
      }
    });

    grid.appendChild(b);
    addPreview(cv, p.dir, p.idle);
  });

  startLoop();

  btnBack.addEventListener('click', () => onStart(null));

  btnStart.addEventListener('click', (e) => {
    e.preventDefault();
    if (isPenaltyLocked()) return;
    if (!store.selectedPlayer) {
      if (pbErr) pbErr.textContent = 'Önce bir oyuncu seç.';
      return;
    }
    const v = normPbUser(pbIn.value);
    if (!v) {
      if (pbErr) pbErr.textContent = 'Pusulabet kullanıcı adını gir.';
      pbIn?.focus();
      return;
    }
    if (pbErr) pbErr.textContent = '';
    store.pusulabetUsername = v;
    try { localStorage.setItem(PB_USER_KEY, v); } catch (_) {}
    onStart(store.selectedPlayer);
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
