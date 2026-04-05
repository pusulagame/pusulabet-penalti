import { assetUrl } from './assets.js';

const ROW_LOGOS = {
  ldLogoFb: 'logo/fb_logo.png',
  ldLogoBjk: 'logo/bjk_logo.png',
};

/** Yükleme ekranındaki takım logoları (oran metinleri HTML'de sabit) */
export function initLoadingMatchRows() {
  for (const [id, sub] of Object.entries(ROW_LOGOS)) {
    const el = document.getElementById(id);
    if (el) el.src = assetUrl(sub);
  }
}
