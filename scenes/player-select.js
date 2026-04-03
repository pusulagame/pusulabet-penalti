import { teamLabel } from '../config/matches.js';
import { store } from '../state/store.js';
import { getTgId, isPenaltyLocked } from '../services/telegram.js';

const PB_USER_KEY = 'pusulabet_username';

function normPbUser(v) {
  return (v || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

/**
 * @param {{ root: HTMLElement, onStart: () => void }} opts
 */
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

  const grid = root.querySelector('#playerGrid');
  const pbIn = root.querySelector('#pbUserScene');
  const pbErr = root.querySelector('#pbErrScene');
  const btnStart = root.querySelector('#btnStartGame');
  const btnBack = root.querySelector('#btnBack');

  try {
    pbIn.value = normPbUser(localStorage.getItem(PB_USER_KEY) || '');
  } catch (e) {}

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
      <div class="player-name">${escapeHtml(p.name)}</div>
      <div class="player-team">${escapeHtml(teamLabel(p.teamId))}</div>
    `;
    b.addEventListener('click', () => {
      grid.querySelectorAll('.player-card').forEach((el) => el.classList.remove('selected'));
      b.classList.add('selected');
      store.selectedPlayer = p;
      store.selectedTeamId = p.teamId;
      store.selectedTeamName = teamLabel(p.teamId);
      if (!isPenaltyLocked()) {
        btnStart.disabled = false;
        btnStart.style.opacity = '';
        btnStart.textContent = 'PENALTİYİ BAŞLAT';
      }
    });
    grid.appendChild(b);
  });

  btnBack.addEventListener('click', () => {
    onStart(null);
  });

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
    try {
      localStorage.setItem(PB_USER_KEY, v);
    } catch (e2) {}
    onStart(store.selectedPlayer);
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
