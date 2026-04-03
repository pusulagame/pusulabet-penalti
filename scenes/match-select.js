import { MATCHES } from '../config/matches.js';
import { store } from '../state/store.js';

/**
 * @param {{ root: HTMLElement, onSelect: () => void }} opts
 */
export function mountMatchSelect({ root, onSelect }) {
  root.innerHTML = `
    <div class="scene-inner">
      <div class="scene-brand">PUSULABET</div>
      <h1 class="scene-title">MAÇ SEÇ</h1>
      <p class="scene-sub">Penaltı için bir karşılaşma seç</p>
      <div class="match-grid" id="matchGrid"></div>
    </div>
  `;
  const grid = root.querySelector('#matchGrid');
  MATCHES.forEach((m) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'match-card';
    card.dataset.matchId = m.id;
    const homeLogo = new URL('../assets/' + m.homeTeam.logo, import.meta.url).href;
    const awayLogo = new URL('../assets/' + m.awayTeam.logo, import.meta.url).href;
    card.innerHTML = `
      <div class="match-logos">
        <img src="${homeLogo}" alt="" class="team-logo" loading="lazy" />
        <span class="vs">VS</span>
        <img src="${awayLogo}" alt="" class="team-logo" loading="lazy" />
      </div>
      <div class="match-label">${escapeHtml(m.label)}</div>
    `;
    card.addEventListener('click', () => {
      store.selectedMatch = m;
      onSelect();
    });
    grid.appendChild(card);
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function showMatchSelect(root) {
  root.hidden = false;
}

export function hideMatchSelect(root) {
  root.hidden = true;
}
