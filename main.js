import { initTelegram } from './services/telegram.js';
import { resetStore } from './state/store.js';
import { mountMatchSelect } from './scenes/match-select.js';
import { mountPlayerSelect, disposePreviews } from './scenes/player-select.js';

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
    // Yükleme ekranında hata mesajı göster — başa atmak yerine
    const ldTxt  = document.getElementById('ldTxt');
    const ldPctEl = document.getElementById('ldPct');
    if(ldTxt)  ldTxt.textContent  = 'HATA OLUŞTU';
    if(ldPctEl) ldPctEl.textContent = 'Sayfayı yenileyin';
    if(ld) ld.classList.remove('hide');
  } finally {
    try { _tg?.disableClosingConfirmation?.(); } catch(_) {}
  }
}

document.getElementById('loading')?.classList.add('hide');
gotoMatch();
