import { assetUrl } from './assets.js';

/**
 * Yükleme ekranı logo döngüsü (süreler saniye — kullanıcı spec):
 * TS 3.20 → VS 3.50 → GS 2.10 → FB 1.99 → VS 3.50 → BJK 3.30 → tekrar
 */
const STEPS = [
  { mode: 'single', src: 'logo/ts_logo.png', sec: 3.2 },
  {
    mode: 'vs',
    left: 'logo/ts_logo.png',
    right: 'logo/gs_logo.png',
    sec: 3.5,
  },
  { mode: 'single', src: 'logo/gs_logo.png', sec: 2.1 },
  { mode: 'single', src: 'logo/fb_logo.png', sec: 1.99 },
  {
    mode: 'vs',
    left: 'logo/fb_logo.png',
    right: 'logo/bjk_logo.png',
    sec: 3.5,
  },
  { mode: 'single', src: 'logo/bjk_logo.png', sec: 3.3 },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let cancelCarousel = () => {};

export function stopLoadingLogoCarousel() {
  cancelCarousel();
  cancelCarousel = () => {};
}

/** @returns {() => void} döngüyü durdur */
export function startLoadingLogoCarousel() {
  stopLoadingLogoCarousel();
  const root = document.getElementById('ldBrand');
  if (!root) return () => {};

  const elSingle = document.getElementById('ldBrandSingle');
  const elVs = document.getElementById('ldBrandVs');
  const imgSingle = elSingle?.querySelector('img');
  const imgL = elVs?.querySelector('.ld-brand-l');
  const imgR = elVs?.querySelector('.ld-brand-r');

  let cancelled = false;

  async function run() {
    while (!cancelled) {
      for (const step of STEPS) {
        if (cancelled) break;
        if (step.mode === 'single') {
          if (elVs) elVs.hidden = true;
          if (elSingle) elSingle.hidden = false;
          if (imgSingle) imgSingle.src = assetUrl(step.src);
        } else {
          if (elSingle) elSingle.hidden = true;
          if (elVs) elVs.hidden = false;
          if (imgL) imgL.src = assetUrl(step.left);
          if (imgR) imgR.src = assetUrl(step.right);
        }
        await sleep(Math.round(step.sec * 1000));
      }
    }
  }

  run();

  const stop = () => {
    cancelled = true;
    if (elSingle) elSingle.hidden = false;
    if (elVs) elVs.hidden = true;
  };
  cancelCarousel = stop;
  return stop;
}
