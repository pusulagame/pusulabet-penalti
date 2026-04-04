import { initTelegram } from './services/telegram.js';
import { resetStore } from './state/store.js';
import { mountMatchSelect } from './scenes/match-select.js';
import { mountPlayerSelect, disposePreviews } from './scenes/player-select.js';
import { initLoadingMatchRows } from './services/loading-screen-ui.js';

initTelegram();

const sceneMatch  = document.getElementById('scene-match');
const scenePlayer = document.getElementById('scene-player');

// ── Etkinlik kapalı ekranı ──
function showClosed() {
  sceneMatch.hidden  = true;
  scenePlayer.hidden = true;
  document.getElementById('loading')?.classList.add('hide');

  let el = document.getElementById('scene-closed');
  if (!el) {
    el = document.createElement('div');
    el.id = 'scene-closed';
    el.style.cssText = [
      'position:fixed', 'inset:0', 'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center', 'gap:16px',
      'background:rgba(0,0,0,0.92)', 'z-index:999', 'padding:24px', 'text-align:center'
    ].join(';');
    el.innerHTML = `
      <div style="font-size:64px">🔒</div>
      <div style="font-family:'Bebas Neue',cursive;font-size:36px;color:#FFD700;letter-spacing:3px">ETKİNLİK SONA ERDİ</div>
      <div style="font-size:15px;color:rgba(255,255,255,0.7);line-height:1.6;max-width:300px">
        Penaltı etkinliği şu an aktif değil.<br>
        Yeni etkinlikler için kanalımızı takip et!
      </div>
      <a href="https://t.me/pusulasocial" target="_blank"
         style="margin-top:8px;background:linear-gradient(135deg,#FF6B00,#e02000);color:#fff;
                font-family:'Bebas Neue',cursive;font-size:20px;letter-spacing:2px;
                padding:12px 32px;border-radius:50px;text-decoration:none">
        📢 @PUSULASOCIAL
      </a>
    `;
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
}

// ── Aktif kontrol ──
async function checkActive() {
  try {
    const base = window.location.href.replace(/\/[^/]*$/, '/');
    const r = await fetch(base + 'data.json', { cache: 'no-store' });
    if (!r.ok) return true; // data.json yoksa açık say
    const d = await r.json();
    const penalty = d?.games?.penalty ?? d?.games?.penalti;
    if (penalty) return !!penalty.active;
    return !!d?.active; // fallback
  } catch (e) {
    return true; // hata olursa açık say
  }
}

async function init() {
  const active = await checkActive();
  if (!active) {
    showClosed();
    return;
  }
  document.getElementById('loading')?.classList.add('hide');
  gotoMatch();
}

function gotoPlayer() {
  sceneMatch.hidden = true;
  scenePlayer.hidden = false;
  mountPlayerSelect({ root: scenePlayer, onStart: onPlayerStart });
}

function gotoMatch() {
  resetStore();
  scenePlayer.hidden = true;
  sceneMatch.hidden = false;
  mountMatchSelect({ root: sceneMatch, onSelect: gotoPlayer });
}

async function onPlayerStart(player) {
  if (!player) { gotoMatch(); return; }
  disposePreviews();

  sceneMatch.hidden = true;
  scenePlayer.hidden = true;
  const ld     = document.getElementById('loading');
  const ldFill = document.getElementById('ldFill');
  const ldPct  = document.getElementById('ldPct');
  if (ld)     ld.classList.remove('hide');
  if (ldFill) ldFill.style.width  = '0%';
  if (ldPct)  ldPct.textContent   = '0%';
  initLoadingMatchRows();

  await new Promise((r) => requestAnimationFrame(() => r()));

  const idle = `${player.dir}/${player.idle}`;
  const kick = `${player.dir}/${player.kick}`;
  const _tg = window.Telegram?.WebApp;
  try { _tg?.BackButton?.hide(); } catch(_) {}
  try { _tg?.enableClosingConfirmation?.(); } catch(_) {}

  const { setStrikerAssets, runPenaltyGame } = await import('./scenes/game-scene.js');
  setStrikerAssets(idle, kick, player.strikeTune);
  try {
    await runPenaltyGame();
  } catch(err) {
    console.error('[Game] Kritik hata:', err);
    const ldTxt   = document.getElementById('ldTxt');
    const ldPctEl = document.getElementById('ldPct');
    if (ldTxt)   ldTxt.textContent   = 'YÜKLENİYOR';
    if (ldPctEl) ldPctEl.textContent  = '0%';
    if (ldFill)  ldFill.style.width   = '0%';
    if (ld)      ld.classList.add('hide');
    gotoMatch();
  } finally {
    try { _tg?.disableClosingConfirmation?.(); } catch(_) {}
  }
}

init();
