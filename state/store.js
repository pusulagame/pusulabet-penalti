/** Seçimler ve Telegram sonucu için global durum */
export const store = {
  /** @type {import('../config/matches.js').MATCHES[0] | null} */
  selectedMatch: null,
  /** @type {import('../config/matches.js').MATCHES[0]['players'][0] | null} */
  selectedPlayer: null,
  /** ts | gs | fb | bjk */
  selectedTeamId: null,
  /** Oyuncunun adı (gösterim) */
  selectedTeamName: '',
  pusulabetUsername: '',
};

export function resetStore() {
  store.selectedMatch = null;
  store.selectedPlayer = null;
  store.selectedTeamId = null;
  store.selectedTeamName = '';
}
