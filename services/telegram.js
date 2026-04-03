let tg = null;

export function initTelegram() {
  try {
    tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
    }
  } catch (e) {
    tg = null;
  }
  return tg;
}

export function getTg() {
  return tg;
}

export function getTgId() {
  return String(tg?.initDataUnsafe?.user?.id || '');
}

export function getTgUserName() {
  const u = tg?.initDataUnsafe?.user;
  return u?.username || u?.first_name || '';
}

export function isPenaltyLocked() {
  const id = getTgId();
  if (!id) return false;
  try {
    return localStorage.getItem('penalty_done_' + id) === '1';
  } catch (e) {
    return false;
  }
}
