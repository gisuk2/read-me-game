import type { WeaponId } from '../config/bossBalance';

/**
 * 그림 카드용 무기 아이콘 (SVG 문자열). 게임 안 실루엣(BossView)과 같은 모양을 단순화했다.
 * 모두 오른쪽을 향하고, 48×24 크기.
 */
const svg = (body: string): string =>
  `<svg viewBox="0 0 48 24" width="48" height="24" xmlns="http://www.w3.org/2000/svg" fill="#000" stroke="#000">${body}</svg>`;

export const WEAPON_ICONS: Record<WeaponId, string> = {
  greatsword: svg('<line x1="6" y1="12" x2="44" y2="12" stroke-width="5"/><line x1="10" y1="5" x2="10" y2="19" stroke-width="3"/>'),
  spear: svg('<line x1="2" y1="12" x2="38" y2="12" stroke-width="2"/><polygon points="36,7 47,12 36,17" stroke="none"/>'),
  twinblades: svg(
    '<line x1="8" y1="7" x2="34" y2="7" stroke-width="3"/><line x1="11" y1="3" x2="11" y2="11" stroke-width="2"/>' +
      '<line x1="8" y1="17" x2="34" y2="17" stroke-width="3"/><line x1="11" y1="13" x2="11" y2="21" stroke-width="2"/>',
  ),
  hammer: svg('<line x1="4" y1="12" x2="34" y2="12" stroke-width="3"/><rect x="32" y="3" width="12" height="18" stroke="none"/>'),
  gun: svg('<rect x="6" y="7" width="16" height="9" stroke="none"/><line x1="22" y1="10" x2="44" y2="10" stroke-width="3"/><line x1="10" y1="16" x2="7" y2="22" stroke-width="4"/>'),
  bare: svg('<circle cx="18" cy="7" r="5" stroke="none"/><circle cx="18" cy="17" r="5" stroke="none"/>'),
};
