/**
 * Maç ve oyuncu tanımları — asset yolları assets/ köküne göredir.
 *
 * strikeTune (dünya +X = sahada sağ):
 * - rootOffsetX/Z: forvet başlangıç konumu ince ayarı (top merkezine göre STRIKER_START_OFFSET + bu değer)
 * - strikerYaw: rad; kök dönüşü = Math.PI + strikerYaw (varsayılan ~-0.22, kaleye hafif çapraz)
 * - kickMeshX/Z: kick FBX yerel offset (temas karesi / model hizası)
 * - kickContactFrac: şut klibinde temas anı = duration * frac (kod varsayılanı ~0.44)
 *
 * Top konumu strikeTune ile değişmez; daima penaltı noktası (BALL_SPOT_X/Z).
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
        strikeTune: {
          rootOffsetX: 0.11,
          rootOffsetZ: 0.04,
          kickMeshX: 0.075,
          kickMeshZ: 0.035,
        },
      },
      {
        id: 'osimhen',
        name: 'Osimhen',
        teamId: 'gs',
        dir: 'osimhen',
        idle: 'osimhen_idle.fbx',
        kick: 'osimhen_kick.fbx',
        strikeTune: {
          rootOffsetX: 0.09,
          rootOffsetZ: 0.05,
          kickMeshX: 0.07,
          kickMeshZ: 0.03,
        },
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
        strikeTune: {
          rootOffsetX: 0.13,
          rootOffsetZ: 0.04,
          kickMeshX: 0.085,
          kickMeshZ: 0.038,
        },
      },
      {
        id: 'oh',
        name: 'Oh',
        teamId: 'bjk',
        dir: 'oh',
        idle: 'oh_idle.fbx',
        kick: 'oh_kick.fbx',
        strikeTune: {
          rootOffsetX: 0.15,
          rootOffsetZ: 0.035,
          kickMeshX: 0.09,
          kickMeshZ: 0.042,
        },
      },
    ],
  },
];

export function teamLabel(teamId) {
  const map = { ts: 'Trabzonspor', gs: 'Galatasaray', fb: 'Fenerbahçe', bjk: 'Beşiktaş' };
  return map[teamId] || teamId;
}
