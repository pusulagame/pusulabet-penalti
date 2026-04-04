import { initTelegram } from './services/telegram.js';
import { resetStore } from './state/store.js';
import { mountMatchSelect } from './scenes/match-select.js';
import { mountPlayerSelect, disposePreviews } from './scenes/player-select.js';
import { startLoadingLogoCarousel, stopLoadingLogoCarousel } from './services/loading-logos.js';

initTelegram();

const sceneMatch = document.getElementById('scene-match');
const scenePlayer = document.getElementById('scene-player');

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
  if (!player) {
    gotoMatch();
    return;
  }
  // ── Preview renderer'ı temizle — WebGL context / memory boşalt ──
  disposePreviews();

  // ── Yükleniyor ekranını dynamic import'tan ÖNCE göster ──
  sceneMatch.hidden = true;
  scenePlayer.hidden = true;
  const ld     = document.getElementById('loading');
  const ldFill = document.getElementById('ldFill');
  const ldPct  = document.getElementById('ldPct');
  if (ld)     ld.classList.remove('hide');
  if (ldFill) ldFill.style.width  = '0%';
  if (ldPct)  ldPct.textContent   = '0%';

  // Mobil / WebView: overlay bir kare boyunca çizilsin, sonra ağır modül yüklensin
  await new Promise((r) => requestAnimationFrame(() => r()));

  const idle = `${player.dir}/${player.idle}`;
  const kick = `${player.dir}/${player.kick}`;
  // Telegram geri tuşunu gizle — oyun sırasında yanlışlıkla başa dönmesin
  const _tg = window.Telegram?.WebApp;
  try { _tg?.BackButton?.hide(); } catch(_) {}
  try { _tg?.enableClosingConfirmation?.(); } catch(_) {}

  const { setStrikerAssets, runPenaltyGame } = await import('./scenes/game-scene.js');
  setStrikerAssets(idle, kick);
  try {
    await runPenaltyGame();
  } catch(err) {
    console.error('[Game] Kritik hata:', err);
    // Maç seçimine dön; yükleme overlay'ini kapat (mobilde takılı kalmayı önle)
    const ldTxt   = document.getElementById('ldTxt');
    const ldPctEl = document.getElementById('ldPct');
    if (ldTxt)   ldTxt.textContent   = 'YÜKLENİYOR';
    if (ldPctEl) ldPctEl.textContent  = '0%';
    if (ldFill)  ldFill.style.width   = '0%';
    if (ld)      ld.classList.add('hide');
    gotoMatch();
  } finally {
    stopLoadingLogoCarousel();
    try { _tg?.disableClosingConfirmation?.(); } catch(_) {}
  }
}

document.getElementById('loading')?.classList.add('hide');
gotoMatch();
