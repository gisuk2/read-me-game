import type { BossPatternId, WeaponId } from '../config/bossBalance';

/**
 * 헬퍼 안내 화면 (HTML/CSS 오버레이). 요소는 index.html에 있다. 두 가지 모드:
 *  - 인사: 처음 접속했을 때. 세 줄 + "테스트 시작"
 *  - 그림 카드: 일시정지 메뉴 "패턴 안내". 무기별 카드 6장 (무기 아이콘 + 패턴 이름 + 대응법 꼬리표)
 *
 * 노이즈 기믹 준비 (학습 단계에서 사용, docs/design/learning-feedback.md §3 ⑮):
 * 카드의 각 칸에 열쇠를 붙여 두고, setCorrupted로 더 이상 맞지 않는 칸만 깨진 것처럼 보이게 한다.
 *   무기 칸      "weapon:<무기>"
 *   패턴 이름    "pattern:<패턴>:name"
 *   대응법 i번째  "pattern:<패턴>:answer:<i>"
 */
export interface WeaponCard {
  weapon: WeaponId;
  weaponName: string;
  /** SVG 문자열 (코드에 들어 있는 고정 값만 사용) */
  iconSvg: string;
  patterns: { id: BossPatternId; name: string; parryable: boolean; answers: readonly string[] }[];
}

export type BriefingMode = 'intro' | 'cards';

export const cardKey = {
  weapon: (w: WeaponId) => `weapon:${w}`,
  name: (p: BossPatternId) => `pattern:${p}:name`,
  answer: (p: BossPatternId, i: number) => `pattern:${p}:answer:${i}`,
};

export class Briefing {
  private readonly overlay: HTMLElement;
  private readonly intro: HTMLElement;
  private readonly cards: HTMLElement;
  private readonly button: HTMLElement;
  private readonly onClick: () => void;
  private mode: BriefingMode = 'intro';

  constructor(introLines: readonly string[], cards: readonly WeaponCard[], onClose: (mode: BriefingMode) => void) {
    this.overlay = Briefing.el('briefing');
    this.intro = Briefing.el('briefing-intro');
    this.cards = Briefing.el('briefing-cards');
    this.button = Briefing.el('briefing-start');

    this.intro.replaceChildren(...introLines.map((line) => Briefing.make('p', line)));
    this.cards.replaceChildren(...cards.map((c) => Briefing.renderCard(c)));

    this.onClick = () => {
      this.button.blur();
      this.hide();
      onClose(this.mode);
    };
    this.button.addEventListener('click', this.onClick);
    this.hide();
  }

  get isShown(): boolean {
    return !this.overlay.hidden;
  }

  /** 처음 접속: 인사만 */
  showIntro(): void {
    this.show('intro');
  }

  /** 일시정지 메뉴: 무기별 그림 카드 */
  showCards(): void {
    this.show('cards');
  }

  hide(): void {
    this.overlay.hidden = true;
  }

  /** 노이즈 기믹: 열쇠가 들어 있는 칸만 깨진 것처럼 보이게 (나머지는 원래대로) */
  setCorrupted(keys: ReadonlySet<string>): void {
    for (const el of this.cards.querySelectorAll<HTMLElement>('[data-key]')) {
      el.classList.toggle('corrupted', keys.has(el.dataset.key ?? ''));
    }
  }

  /** 씬이 재시작되면 버튼 연결을 풀어 중복 연결을 막는다 */
  destroy(): void {
    this.button.removeEventListener('click', this.onClick);
    this.hide();
  }

  private show(mode: BriefingMode): void {
    this.mode = mode;
    this.intro.hidden = mode !== 'intro';
    this.cards.hidden = mode !== 'cards';
    this.button.textContent = mode === 'intro' ? '테스트 시작' : '닫기';
    this.overlay.hidden = false;
  }

  private static renderCard(c: WeaponCard): HTMLElement {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'card-head';
    head.dataset.key = cardKey.weapon(c.weapon);
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.innerHTML = c.iconSvg; // 코드 안의 고정 SVG만 들어옴
    head.append(icon, Briefing.make('strong', c.weaponName));
    li.append(head);

    for (const p of c.patterns) {
      const row = document.createElement('div');
      row.className = 'row';
      const name = Briefing.make('span', p.name, 'name');
      name.dataset.key = cardKey.name(p.id);
      row.append(name);
      if (!p.parryable) row.append(Briefing.make('span', '패링 불가', 'tag heavy'));
      p.answers.forEach((a, i) => {
        const tag = Briefing.make('span', a, 'tag');
        tag.dataset.key = cardKey.answer(p.id, i);
        row.append(tag);
      });
      li.append(row);
    }
    return li;
  }

  private static make(tag: string, text: string, className?: string): HTMLElement {
    const el = document.createElement(tag);
    el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  private static el(id: string): HTMLElement {
    const found = document.getElementById(id);
    if (!found) throw new Error(`index.html에 #${id} 요소가 없습니다.`);
    return found;
  }
}
