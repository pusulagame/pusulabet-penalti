import { getTg, getTgId, getTgUserName } from './telegram.js';
import { store } from '../state/store.js';

export const PENALTY_SHEETS_URL =
  'https://script.google.com/macros/s/AKfycbx9L5_DApizBucQXBfWzp-JJBLig1XQ6OmBhVadf4RawvqQVCVsyZ47sFZ9onCJASfq/exec';

/**
 * @param {{ goals:number, won:boolean, score:string, goalsHud:number, total:number }} stats
 */
export function sendPenaltyResult(stats) {
  const tg = getTg();
  const tgId = getTgId();
  const tgName = getTgUserName();
  const pb = (store.pusulabetUsername || '').trim();

  const payload = {
    game: 'penalty',
    match_id: store.selectedMatch?.id || '',
    selected_team: store.selectedTeamId || '',
    selected_player: store.selectedPlayer?.id || '',
    pusulabet_username: pb,
    telegram_id: tgId,
    telegram_kullanici: tgName,
    score: stats.score,
    goals: stats.goalsHud,
    won: stats.won,
    kazandi: stats.won ? 'EVET' : 'HAYIR',
    total: stats.total,
  };

  const json = JSON.stringify(payload);

  if (tg?.sendData) {
    try {
      tg.sendData(json);
      console.log('[sendData] gönderildi');
    } catch (e) {
      console.warn('[sendData]', e);
    }
  }

  if (stats.won) {
    const qs = new URLSearchParams({
      game: 'penalty',
      tarih: new Date().toLocaleString('tr-TR'),
      telegram_kullanici: tgName,
      telegram_id: tgId,
      pusulabet_username: pb,
      score: stats.score,
      goals: String(stats.goalsHud),
      kazandi: 'EVET',
    });
    const url = PENALTY_SHEETS_URL + '?' + qs.toString();
    try {
      fetch(url, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
      new Image().src = url;
    } catch (e) {
      console.warn('[sheets]', e);
    }
  }
}
