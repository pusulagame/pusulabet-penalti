/**
 * Maç ve oyuncu tanımları — asset yolları assets/ köküne göredir.
 *
 * strikeTune (dünya +X = sahada sağ):
 * - rootOffsetX/Z: forvet kökü (gövde) kaydırma
 * - ballOffsetX/Z: top kaydırma — sağ ayak vuruşu için genelde root’tan KÜÇÜK tutulur
 *   (top, köke göre biraz “solda” kalır = sağ ayak hattına yaklaşır)
 * - kickMeshX/Z: sadece kick FBX local offset (temas karesi)
 * - kickContactFrac: (opsiyonel) temas anı = duration * frac (kod varsayılanı ~0.44)
 * - footForwardOffset: pivot → parmak ucu mesafe (m); footToeLocalX/Y/Z: kemik yerel ekseni (varsayılan 0,0,1)
 * - kickContactFrac: şut klibinde temas anı (varsayılan kodda ~0.44; model başına ayarlanır)
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
          rootOffsetX: 0.32,
          rootOffsetZ: -0.04,
          ballOffsetX: 0.12,
          ballOffsetZ: -0.05,
          kickMeshX: 0.075,
          kickMeshZ: 0.035,
          footForwardOffset: 0.17,
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
          rootOffsetX: 0.3,
          rootOffsetZ: -0.03,
          ballOffsetX: 0.11,
          ballOffsetZ: -0.04,
          kickMeshX: 0.07,
          kickMeshZ: 0.03,
          footForwardOffset: 0.17,
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
          rootOffsetX: 0.34,
          rootOffsetZ: -0.04,
          ballOffsetX: 0.13,
          ballOffsetZ: -0.05,
          kickMeshX: 0.085,
          kickMeshZ: 0.038,
          footForwardOffset: 0.17,
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
          rootOffsetX: 0.36,
          rootOffsetZ: -0.045,
          ballOffsetX: 0.14,
          ballOffsetZ: -0.055,
          kickMeshX: 0.09,
          kickMeshZ: 0.042,
          footForwardOffset: 0.17,
        },
      },
    ],
  },
];

export function teamLabel(teamId) {
  const map = { ts: 'Trabzonspor', gs: 'Galatasaray', fb: 'Fenerbahçe', bjk: 'Beşiktaş' };
  return map[teamId] || teamId;
}
