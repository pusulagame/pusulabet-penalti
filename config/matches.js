/**
 * Maç ve oyuncu tanımları — asset yolları assets/ köküne göredir.
 * Logolar: assets/logo/*.png | Oyuncu FBX: assets/<klasör>/*.fbx
 */
export const MATCHES = [
  {
    id: 'ts_vs_gs',
    label: 'Trabzonspor — Galatasaray',
    homeTeam: { id: 'ts', name: 'Trabzonspor', logo: 'logo/ts_logo.png' },
    awayTeam: { id: 'gs', name: 'Galatasaray', logo: 'logo/gs_logo.png' },
    players: [
      {
        id: 'onuachu',
        name: 'Onuachu',
        teamId: 'ts',
        dir: 'onuachu',
        idle: 'onuachu_idle.fbx',
        kick: 'onuachu_kick.fbx',
      },
      {
        id: 'osimhen',
        name: 'Osimhen',
        teamId: 'gs',
        dir: 'osimhen',
        idle: 'osimhen_idle.fbx',
        kick: 'osimhen_kick.fbx',
      },
    ],
  },
  {
    id: 'fb_vs_bjk',
    label: 'Fenerbahçe — Beşiktaş',
    homeTeam: { id: 'fb', name: 'Fenerbahçe', logo: 'logo/fb_logo.png' },
    awayTeam: { id: 'bjk', name: 'Beşiktaş', logo: 'logo/bjk_logo.png' },
    players: [
      {
        id: 'asensio',
        name: 'Asensio',
        teamId: 'fb',
        dir: 'asensio',
        idle: 'asensio_idle.fbx',
        kick: 'asensio_kick.fbx',
      },
      {
        id: 'oh',
        name: 'Oh',
        teamId: 'bjk',
        dir: 'oh',
        idle: 'oh_idle.fbx',
        kick: 'oh_kick.fbx',
      },
    ],
  },
];

export function teamLabel(teamId) {
  const map = { ts: 'Trabzonspor', gs: 'Galatasaray', fb: 'Fenerbahçe', bjk: 'Beşiktaş' };
  return map[teamId] || teamId;
}
