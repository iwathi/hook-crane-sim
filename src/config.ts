/** 台設定（全パラメータを1つの型に集約） */
export interface MachineConfig {
  speed: 'slow' | 'normal' | 'fast';
  brake: 'hard' | 'soft';
  rope: 'chain' | 'wire' | 'soft';
  twist: 'none' | 'cw' | 'ccw' | 'random';
  ringMass: 'light' | 'normal' | 'heavy';
  ringShape: 'circleL' | 'circleM' | 'circleS' | 'dring' | 'thick';
  depth: 'shallow' | 'normal' | 'deep';
  hook: 'pin3Up' | 'j' | 'pinUp' | 'pinDiag' | 'multi';
  hookDepth: 'deep' | 'normal' | 'shallow';
  nut: 'none' | 'small' | 'large';
  guard: 'none' | 'side';
  slope: 'none' | 'left' | 'right' | 'toward';
  prize: 'plate' | 'basket';
  com: 'none' | 'left' | 'right';
  /** 景品位置（単位: 10cm） */
  prizeX: number;
  prizeZ: number;
}

export type Field =
  | { key: keyof MachineConfig; label: string; type: 'select'; options: [string, string][] }
  | { key: keyof MachineConfig; label: string; type: 'range'; min: number; max: number; step: number };

/** カスタムパネル用スキーマ */
export const FIELDS: Field[] = [
  { key: 'speed', label: '移動速度', type: 'select', options: [['slow', '低速'], ['normal', '標準（実機同等）'], ['fast', '高速']] },
  { key: 'brake', label: '停止ブレーキ', type: 'select', options: [['hard', '急停止（実機同等）'], ['soft', '緩やか']] },
  { key: 'rope', label: '紐の素材', type: 'select', options: [['chain', 'ボールチェーン（実機）'], ['wire', 'テグス／ワイヤー'], ['soft', '柔らかい紐']] },
  { key: 'twist', label: 'チェーンのねじれ方向', type: 'select', options: [['cw', '時計回り（右回転）'], ['ccw', '反時計回り（左回転）'], ['random', 'ランダム（開始時に観察）'], ['none', 'なし']] },
  { key: 'ringMass', label: 'リング質量', type: 'select', options: [['heavy', '重量級（実機トーラス）'], ['normal', '標準'], ['light', '軽量']] },
  { key: 'ringShape', label: 'リング形状', type: 'select', options: [['thick', '太めリング（実機 約5.7cm）'], ['circleM', '真円・中'], ['circleL', '真円・大'], ['circleS', '真円・小'], ['dring', 'Dカン']] },
  { key: 'depth', label: '下降限界', type: 'select', options: [['deep', '深め（しっかり接地・倒れ込み）'], ['normal', '標準'], ['shallow', '浅め']] },
  { key: 'hook', label: 'フック形状', type: 'select', options: [['pin3Up', '実機2連・？型フック（木ブロック）'], ['pinUp', '単体・？型フック'], ['j', 'ワイド・？型フック（深掛け）'], ['pinDiag', '斜め向き・？型フック'], ['multi', '3連三角・？型フック']] },
  { key: 'hookDepth', label: 'フック深さ', type: 'select', options: [['normal', '標準（実機フック）'], ['deep', '深め（抜けにくい）'], ['shallow', '浅め（抜けやすい）']] },
  { key: 'nut', label: '固定ナット', type: 'select', options: [['none', 'なし（実機フラット座金）'], ['small', '小'], ['large', '大']] },
  { key: 'guard', label: 'ガード板', type: 'select', options: [['none', 'なし（実機）'], ['side', '左右にシールド']] },
  { key: 'slope', label: '傾斜プレート', type: 'select', options: [['none', '平置き（実機）'], ['left', '左へ傾斜'], ['right', '右へ傾斜'], ['toward', '手前へ傾斜']] },
  { key: 'prize', label: '景品タイプ', type: 'select', options: [['plate', '連動トレイ＋飲料5本（実機）'], ['basket', '重量カゴ']] },
  { key: 'com', label: '重心偏り', type: 'select', options: [['none', '均等（実機）'], ['left', '左寄り'], ['right', '右寄り']] },
  { key: 'prizeX', label: 'フック台位置 X', type: 'range', min: -1.0, max: 1.4, step: 0.05 },
  { key: 'prizeZ', label: 'フック台位置 Z', type: 'range', min: -2.4, max: -1.4, step: 0.05 },
];

/** 実機（フック付き土台板引き上げ → 連動ワイヤーネット傾き → 手前の飲料5本落下）のデフォルト設定 */
export const BASE: MachineConfig = {
  speed: 'normal',
  brake: 'hard',
  rope: 'chain',
  twist: 'cw',
  ringMass: 'heavy',
  ringShape: 'thick',
  depth: 'deep',
  hook: 'pin3Up',
  hookDepth: 'normal',
  nut: 'none',
  guard: 'none',
  slope: 'none',
  prize: 'plate',
  com: 'none',
  prizeX: 0.0,
  prizeZ: -1.75,
};

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

/** 実機にあり得る範囲でランダム生成 */
export function randomConfig(): MachineConfig {
  const c: any = { ...BASE };
  for (const f of FIELDS) {
    if (f.type === 'select') c[f.key] = pick(f.options)[0];
  }
  c.prizeX = +(Math.random() * 2.2 - 0.6).toFixed(2);
  c.prizeZ = +(Math.random() * 1.2 - 0.8).toFixed(2);
  return c;
}

export const PRESETS: { name: string; desc: string; make: () => MachineConfig }[] = [
  {
    name: '1. 実機再現（フック連動トレイ台）',
    desc: '実機スケール設定。リングの微細な回転癖を見てフック開口部へ落とし、連動トレイから商品を落とす！',
    make: () => ({ ...BASE }),
  },
  {
    name: '2. ねじれランダム（回転見極め実戦）',
    desc: '毎回チェーンのねじれ方向がランダムに変化。開始時のわずかな回転癖を観察して狙い位置を判断！',
    make: () => ({ ...BASE, twist: 'random' }),
  },
  {
    name: '3. ナット当て＋反時計回転（CCW）',
    desc: 'ねじれ癖が反時計回りの台。回転方向の違いによる狙い位置（奥側狙い等）の検証に',
    make: () => ({ ...BASE, twist: 'ccw' }),
  },
  {
    name: '4. 王道・振り子揺らし狙い',
    desc: '軽量リング＋急停止。移動・停止のタイミングでリングを振ってスイングで掛ける感覚の練習',
    make: () => ({ ...BASE, speed: 'fast', ringMass: 'light', ringShape: 'circleM', hook: 'j', nut: 'none' }),
  },
  {
    name: '5. 精密・直接差し込み（テグス台）',
    desc: '揺れを抑え、奥行きと横位置をミリ単位で合わせて直接フックに通す距離感の習得',
    make: () => ({ ...BASE, speed: 'slow', brake: 'soft', rope: 'wire', hook: 'pinDiag', guard: 'side', depth: 'normal' }),
  },
  {
    name: '6. 浅掛け・途中落下警戒',
    desc: '浅めフック＋重量カゴ。フックの奥まで確実に掛けて運搬中の滑落を防ぐ',
    make: () => ({ ...BASE, hookDepth: 'shallow', prize: 'basket', com: 'right', slope: 'left' }),
  },
  {
    name: '7. ランダム実戦（日替わり台）',
    desc: '初見台で1〜2手目の挙動から揺れ・ねじれ・深さを見極める実戦練習',
    make: randomConfig,
  },
];
