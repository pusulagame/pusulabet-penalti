import { teamLabel } from '../config/matches.js';
import { store } from '../state/store.js';
import { getTgId, isPenaltyLocked } from '../services/telegram.js';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const PB_USER_KEY = 'pusulabet_username';

function normPbUser(v) {
  return (v || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

/* ── Mini 3-D ön izleme ─────────────────────────────────── */
function initPlayerPreview(canvas, dir, idleFile) {
  const PW = 160;
  const PH = 200;
  canvas.width  = PW;
  canvas.height = PH;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(PW, PH);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene  = new THREE.Scene();
  const cam    = new THREE.PerspectiveCamera(40, PW / PH, 0.1, 100);
  cam.position.set(0, 1.55, 3.4);
  cam.lookAt(0, 1.2, 0);

  /* Işıklar */
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-2, 2, -2);
  scene.add(fill);

  const loader = new FBXLoader();
  loader.load(
    `./assets/${dir}/${idleFile}`,
    (obj) => {
      /* Materyal düzelt */
      obj.traverse((c) => {
        if (!c.isMesh) return;
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach((m) => {
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          m.depthWrite = true;
          m.needsUpdate = true;
        });
      });

      /* Boyut normalize */
      const box  = new THREE.Box3().setFromObject(obj);
      const h    = box.max.y - box.min.y || 1;
      const sc   = 1.9 / h;
      obj.scale.setScalar(sc);
      /* Merkezi sıfırla */
      box.setFromObject(obj);
      const cx = (box.min.x + box.max.x) / 2;
      obj.position.x -= cx;
      obj.position.y  = -box.min.y;
      scene.add(obj);

      /* Animasyon */
      const mixer = new THREE.AnimationMixer(obj);
      if (obj.animations?.[0]) {
        mixer.clipAction(obj.animations[0]).play();
      }

      let last = 0;
      let rotT = 0;
      function tick(t) {
        if (!canvas.isConnected) { renderer.dispose(); return; }
        requestAnimationFrame(tick);
        const dt = Math.min((t - last) / 1000, 0.05);
        last = t;
        mixer.update(dt);
        rotT += dt;
        /* Hafif sallanma ±15° */
        obj.rotation.y = Math.sin(rotT * 0.6) * 0.26;
        renderer.render(scene, cam);
      }
      requestAnimationFrame(tick);
    },
    undefined,
    (err) => console.warn('[Preview] FBX yüklenemedi:', dir, err?.message || err)
  );
}

/* ── Ana mount ──────────────────────────────────────────── */
export function mountPlayerSelect({ root, onStart }) {
  const m = store.selectedMatch;
  if (!m) return;

  root.innerHTML = `
    <div class="scene-inner">
      <button type="button" class="scene-back" id="btnBack">← Maç</button>
      <h1 class="scene-title">OYUNCU SEÇ</h1>
      <p class="scene-sub">${escapeHtml(m.label)}</p>
      <div class="player-grid" id="playerGrid"></div>
      <div class="sform scene-form">
        <label class="slab" for="pbUserScene">Pusulabet Kullanıcı Adı</label>
        <input class="sinp" id="pbUserScene" autocomplete="username" inputmode="text" maxlength="24" placeholder="ornek: pusulaci123" />
        <div class="serr" id="pbErrScene"></div>
      </div>
      <button type="button" class="btnP" id="btnStartGame" disabled style="opacity:0.65">BİR OYUNCU SEÇ</button>
    </div>
  `;

  const grid     = root.querySelector('#playerGrid');
  const pbIn     = root.querySelector('#pbUserScene');
  const pbErr    = root.querySelector('#pbErrScene');
  const btnStart = root.querySelector('#btnStartGame');
  const btnBack  = root.querySelector('#btnBack');

  try { pbIn.value = normPbUser(localStorage.getItem(PB_USER_KEY) || ''); } catch (e) {}

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
    b.innerHTML = `
      <canvas class="player-preview"></canvas>
      <div class="player-name">${escapeHtml(p.name)}</div>
      <div class="player-team">${escapeHtml(teamLabel(p.teamId))}</div>
    `;

    b.addEventListener('click', () => {
      grid.querySelectorAll('.player-card').forEach((el) => el.classList.remove('selected'));
      b.classList.add('selected');
      store.selectedPlayer    = p;
      store.selectedTeamId    = p.teamId;
      store.selectedTeamName  = teamLabel(p.teamId);
      if (!isPenaltyLocked()) {
        btnStart.disabled = false;
        btnStart.style.opacity = '';
        btnStart.textContent   = 'PENALTİYİ BAŞLAT';
      }
    });

    grid.appendChild(b);

    /* Mini 3D önizleme başlat */
    const cv = b.querySelector('.player-preview');
    initPlayerPreview(cv, p.dir, p.idle);
  });

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
    try { localStorage.setItem(PB_USER_KEY, v); } catch (e2) {}
    onStart(store.selectedPlayer);
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
