/**
 * 現場用「リングフック設定」チェックリスト型 攻略診断ツール
 * 0円チェック → 1手目診断 → タイプ別実践 → 2手目以降の修正＆撤退判定
 */

interface AdvisorState {
  // Step 1: 0円チェック（yes / no / unset）
  c1_width: 'unset' | 'yes' | 'no';
  c1_dir: 'unset' | 'yes' | 'no';
  c1_dist: 'unset' | 'yes' | 'no';
  c1_size: 'unset' | 'yes' | 'no';
  c1_stopBtn: boolean;
  c1_lever: boolean;

  // Step 2: 1手目テストプレイ診断
  depth: 'unset' | 'deep' | 'mid' | 'shallow';
  swing: 'unset' | 'steady' | 'none' | 'wild';
  slideDir: 'unset' | 'left' | 'right' | 'back' | 'front';
  inertia: 'unset' | 'small' | 'large';

  // Step 3: 実践チェック
  checks: Record<string, boolean>;

  // Step 4: 修正・撤退カウント
  oneAxisDone: boolean;
  plays: number;
  missBack: number;
  missOver: number;
  missSlip: number;
}

const STORAGE_KEY = 'hcs-advisor-v1';

const DEFAULT_STATE: AdvisorState = {
  c1_width: 'unset',
  c1_dir: 'unset',
  c1_dist: 'unset',
  c1_size: 'unset',
  c1_stopBtn: false,
  c1_lever: false,
  depth: 'unset',
  swing: 'unset',
  slideDir: 'unset',
  inertia: 'unset',
  checks: {},
  oneAxisDone: false,
  plays: 0,
  missBack: 0,
  missOver: 0,
  missSlip: 0,
};

function loadState(): AdvisorState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch { /* デフォルトへフォールバック */ }
  return { ...DEFAULT_STATE, checks: {} };
}

export function initAdvisor(modalEl: HTMLElement, openBtn: HTMLElement) {
  let st: AdvisorState = loadState();
  let activeTab = 1;

  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(st));

  /** 現在のチェック状況から総合判断（推奨攻略法 or 撤退）を算出 */
  function evaluate(): { level: 'go' | 'warn' | 'stop' | 'idle'; badge: string; text: string; strat: 'slide' | 'cycle' | 'none' } {
    // 撤退条件を最優先判定
    if (st.depth === 'shallow') {
      return { level: 'stop', badge: '🛑 即撤退', text: '下降が浅すぎてフック先端に届きません。0円〜1手で撤退推奨！', strat: 'none' };
    }
    if (st.plays >= 5) {
      return { level: 'stop', badge: '🛑 撤退ライン', text: `${st.plays}プレイ到達。再現性がない場合は深追いせず即撤退！`, strat: 'none' };
    }
    if (st.c1_width === 'no') {
      return { level: 'stop', badge: '🛑 見送り推奨', text: 'フックの開き幅が狭く加工／広すぎ。別台を探すのが無難です。', strat: 'none' };
    }

    // 1手目診断に基づく攻略タイプ判定
    if (st.depth === 'deep') {
      const warnWild = st.swing === 'wild' ? '（暴れ注意・安定させよう）' : '';
      return { level: 'go', badge: '✅ 滑り込み狙い推奨', text: `よく下がる台です。開口側へ落として斜めに滑り込ませましょう${warnWild}`, strat: 'slide' };
    }
    if (st.depth === 'mid') {
      if (st.swing === 'wild') {
        return { level: 'warn', badge: '⚠️ 高難度（撤退検討）', text: '揺れがランダムに暴れて再現性が低いです。3手以内に見切りを！', strat: 'cycle' };
      }
      return { level: 'go', badge: '✅ 周期狙い推奨', text: 'フック付近で止まる台です。背中側に合わせて揺れの端で押しましょう。', strat: 'cycle' };
    }

    // 0円チェックのみの段階
    const noCount = [st.c1_width, st.c1_dir, st.c1_dist, st.c1_size].filter((v) => v === 'no').length;
    const yesCount = [st.c1_width, st.c1_dir, st.c1_dist, st.c1_size].filter((v) => v === 'yes').length;
    if (noCount >= 2) {
      return { level: 'warn', badge: '⚠️ 高難度台', text: '不利条件が複数あります。1手だけテストするか別台を検討。', strat: 'none' };
    }
    if (yesCount >= 3) {
      return { level: 'go', badge: '👍 0円チェック良好', text: '狙いやすい台です！1手目テストプレイで下降量と揺れを診断しましょう。', strat: 'none' };
    }
    if (st.plays >= 3) {
      return { level: 'warn', badge: '⚠️ 3手経過・要判断', text: '再現性があるか確認。外れ方に一貫性がなければ撤退準備。', strat: 'none' };
    }
    return { level: 'idle', badge: '📋 診断前', text: 'まず「1. 0円チェック」で台の状態を確認してください。', strat: 'none' };
  }

  function ynRow(key: 'c1_width' | 'c1_dir' | 'c1_dist' | 'c1_size', title: string, note: string) {
    const v = st[key];
    return `
      <div class="adv-item">
        <div class="adv-item-text">
          <div class="adv-item-title">${title}</div>
          <div class="adv-item-note">${note}</div>
        </div>
        <div class="adv-yn">
          <button data-yn="${key}:yes" class="${v === 'yes' ? 'sel-yes' : ''}">YES</button>
          <button data-yn="${key}:no" class="${v === 'no' ? 'sel-no' : ''}">NO</button>
        </div>
      </div>`;
  }

  function chkRow(id: string, title: string, note?: string) {
    const on = !!st.checks[id];
    return `
      <label class="adv-chk ${on ? 'done' : ''}">
        <input type="checkbox" data-chk="${id}" ${on ? 'checked' : ''} />
        <span><b>${title}</b>${note ? `<small>${note}</small>` : ''}</span>
      </label>`;
  }

  function render() {
    const ev = evaluate();

    let body = '';
    if (activeTab === 1) {
      body = `
        <div class="adv-sec-title">Step 1：プレイ前の 0 円チェック（台選び）</div>
        ${ynRow('c1_width', 'フックの開き幅は適正？', '狭く加工されていない / 広すぎて抜けない幅か')}
        ${ynRow('c1_dir', 'フックは真横（左右向き）？', '左右向きがベスト。斜め・前後向きは高難度')}
        ${ynRow('c1_dist', 'リングとフックの初期距離・高さが近い？', '近いほどズレが少なく有利')}
        ${ynRow('c1_size', 'リングとフックのサイズ・太さに余裕がある？', '開口にリングが無理なく通るバランスか')}
        <div class="adv-sub-title">操作ギミックの有無（有利オプション）</div>
        <div class="adv-chips">
          <button data-toggle="c1_stopBtn" class="${st.c1_stopBtn ? 'on' : ''}">[${st.c1_stopBtn ? '✓' : ' '}] 下降ストップ（第3ボタン）あり</button>
          <button data-toggle="c1_lever" class="${st.c1_lever ? 'on' : ''}">[${st.c1_lever ? '✓' : ' '}] レバー操作あり</button>
        </div>
        <div class="adv-next-row"><button class="adv-primary" data-tab="2">次へ：1手目テスト診断 →</button></div>`;
    } else if (activeTab === 2) {
      body = `
        <div class="adv-sec-title">Step 2：1手目テストプレイ診断（台の性質判定）</div>
        <div class="adv-sub-title">① リングの下降量（最重要）</div>
        <div class="adv-radios">
          <button data-set="depth:deep" class="${st.depth === 'deep' ? 'on-go' : ''}">床に接地して寝る／根元まで下がる<small>→「滑り込み狙い」推奨</small></button>
          <button data-set="depth:mid" class="${st.depth === 'mid' ? 'on-go' : ''}">フック付近でちょうど止まる<small>→「周期狙い（揺らし）」推奨</small></button>
          <button data-set="depth:shallow" class="${st.depth === 'shallow' ? 'on-stop' : ''}">浅すぎてフック先端に届かない<small>→ 🛑 即撤退</small></button>
        </div>
        <div class="adv-sub-title">② 揺れ方と規則性</div>
        <div class="adv-chips">
          <button data-set="swing:steady" class="${st.swing === 'steady' ? 'on' : ''}">一定リズムで左右に揺れる</button>
          <button data-set="swing:none" class="${st.swing === 'none' ? 'on' : ''}">ほぼ揺れない</button>
          <button data-set="swing:wild" class="${st.swing === 'wild' ? 'on-warn' : ''}">ランダムに暴れる</button>
        </div>
        <div class="adv-sub-title">③ 接地後の滑る方向 ＆ 停止時の慣性ズレ</div>
        <div class="adv-chips">
          <button data-set="slideDir:left" class="${st.slideDir === 'left' ? 'on' : ''}">← 左へ滑る</button>
          <button data-set="slideDir:right" class="${st.slideDir === 'right' ? 'on' : ''}">→ 右へ滑る</button>
          <button data-set="slideDir:back" class="${st.slideDir === 'back' ? 'on' : ''}">↑ 奥へ滑る</button>
          <button data-set="slideDir:front" class="${st.slideDir === 'front' ? 'on' : ''}">↓ 手前へ滑る</button>
        </div>
        <div class="adv-chips" style="margin-top:6px;">
          <button data-set="inertia:small" class="${st.inertia === 'small' ? 'on' : ''}">慣性ズレ：小（ピタッと止まる）</button>
          <button data-set="inertia:large" class="${st.inertia === 'large' ? 'on-warn' : ''}">慣性ズレ：大（手前で離す）</button>
        </div>
        <div class="adv-next-row"><button class="adv-primary" data-tab="3">次へ：タイプ別・実践アクション →</button></div>`;
    } else if (activeTab === 3) {
      const slideRec = ev.strat === 'slide';
      const cycleRec = ev.strat === 'cycle';
      body = `
        <div class="adv-sec-title">Step 3：タイプ別・実践アクション</div>
        <div class="adv-card ${slideRec ? 'rec' : ''}">
          <div class="adv-card-head">
            <b>A. 滑り込み狙い</b>
            ${slideRec ? '<span class="adv-rec-badge">★ この台に推奨</span>' : '<span class="adv-tag">よく下がる台・大リング</span>'}
          </div>
          ${chkRow('s1', '1ボタン目：フックの開いている側へ寄せる', 'リング直径分ほど離して落とすのが目安')}
          ${chkRow('s2', '2ボタン目：接地後にフックへ斜めに滑り込む位置で止める', '1手目で確認した「滑る方向」を逆算')}
          ${chkRow('s3', '抜け防止：最下部ではなく少し斜めの「肩」を掛ける', '上昇時にフックの奥へ食い込みやすくなる')}
        </div>
        <div class="adv-card ${cycleRec ? 'rec' : ''}">
          <div class="adv-card-head">
            <b>B. 周期狙い（揺らし）</b>
            ${cycleRec ? '<span class="adv-rec-badge">★ この台に推奨</span>' : '<span class="adv-tag">適度に揺れる台・浅め〜普通</span>'}
          </div>
          ${chkRow('c1', '1ボタン目：フックの開いている側と反対（背中側）に合わせる', 'スイングで開口部へ飛び込ませる')}
          ${chkRow('c2', '2ボタン目：左右の揺れの端（右端 or 左端）でタイミング固定', '毎回同じ端で押して再現性を検証')}
          ${chkRow('c3', '周期切り替え：反対側へ落ちたら位置は変えず逆の端で押す', '位置とタイミングを同時に変えない')}
          ${chkRow('c4', '揺れ幅調整：大きく→逆向きに揺れた瞬間 ／ 抑える→同じ向き', '1ボタン目の押し始めで揺れ幅をコントロール')}
        </div>
        <div class="adv-next-row"><button class="adv-primary" data-tab="4">次へ：修正ルール＆撤退判定 →</button></div>`;
    } else {
      const warnLevel = st.plays >= 5 ? 'stop' : st.plays >= 3 ? 'warn' : 'ok';
      body = `
        <div class="adv-sec-title">Step 4：2手目以降の修正ルール＆撤退ライン</div>
        <div class="adv-card">
          <label class="adv-chk ${st.oneAxisDone ? 'done' : ''}">
            <input type="checkbox" data-toggle-chk="oneAxisDone" ${st.oneAxisDone ? 'checked' : ''} />
            <span><b>1軸修正を徹底する</b><small>左右(X)と奥行き(Z)を同時に直さない。1手につき1軸だけ修正！</small></span>
          </label>
        </div>
        <div class="adv-sub-title">外れ方の原因記録（タップでカウント）</div>
        <div class="adv-miss-grid">
          <button data-inc="missBack">背に当たった<b>${st.missBack}回</b><small>→ 開口側へ微調整 / 周期切替</small></button>
          <button data-inc="missOver">奥へ落ちた<b>${st.missOver}回</b><small>→ 2ボタン目を早めに離す</small></button>
          <button data-inc="missSlip">入ったが抜けた<b>${st.missSlip}回</b><small>→ 「肩」掛け意識 / 浅すぎ警戒</small></button>
        </div>
        <div class="adv-sub-title">撤退ライン管理（目安：3〜5プレイ）</div>
        <div class="adv-retreat ${warnLevel}">
          <div>
            <div class="adv-retreat-num">現在の手数：<b>${st.plays}</b> 回（¥${st.plays * 100}）</div>
            <div class="adv-retreat-msg">
              ${st.plays >= 5 ? '🛑 5プレイ到達！再現性がなければ即撤退しましょう' : st.plays >= 3 ? '⚠️ 3プレイ経過。あと1〜2手で手応えがなければ撤退' : '3〜5プレイを目安に、再現性・到達度を見極めよう'}
            </div>
          </div>
          <div class="adv-retreat-btns">
            <button data-play="-1">−1</button>
            <button data-play="1" class="plus">+1手</button>
          </div>
        </div>`;
    }

    modalEl.innerHTML = `
      <div class="adv-head">
        <b>🎯 現場チェック＆攻略診断</b>
        <button id="advClose" aria-label="閉じる">✕</button>
      </div>
      <div class="adv-banner ${ev.level}">
        <span class="adv-badge">${ev.badge}</span>
        <span class="adv-btext">${ev.text}</span>
      </div>
      <nav class="adv-tabs">
        <button data-tab="1" class="${activeTab === 1 ? 'active' : ''}">1. 0円</button>
        <button data-tab="2" class="${activeTab === 2 ? 'active' : ''}">2. 1手目</button>
        <button data-tab="3" class="${activeTab === 3 ? 'active' : ''}">3. 実践</button>
        <button data-tab="4" class="${activeTab === 4 ? 'active' : ''}">4. 修正/撤退</button>
      </nav>
      <div class="adv-body">${body}</div>
      <div class="adv-foot">
        <button id="advReset">チェックをリセット（新しい台へ）</button>
      </div>
    `;
  }

  // イベント委任（1回の登録で全操作を処理）
  modalEl.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('button, input') as HTMLElement | null;
    if (!t) return;

    if (t.id === 'advClose') {
      modalEl.classList.remove('open');
      return;
    }
    if (t.id === 'advReset') {
      st = { ...DEFAULT_STATE, checks: {} };
      activeTab = 1;
      save();
      render();
      return;
    }
    if (t.dataset.tab) {
      activeTab = Number(t.dataset.tab);
      render();
      return;
    }
    if (t.dataset.yn) {
      const [k, v] = t.dataset.yn.split(':') as ['c1_width' | 'c1_dir' | 'c1_dist' | 'c1_size', 'yes' | 'no'];
      st[k] = st[k] === v ? 'unset' : v;
      save();
      render();
      return;
    }
    if (t.dataset.toggle) {
      const k = t.dataset.toggle as 'c1_stopBtn' | 'c1_lever';
      st[k] = !st[k];
      save();
      render();
      return;
    }
    if (t.dataset.set) {
      const [k, v] = t.dataset.set.split(':') as ['depth' | 'swing' | 'slideDir' | 'inertia', string];
      (st as any)[k] = (st as any)[k] === v ? 'unset' : v;
      save();
      render();
      return;
    }
    if (t.dataset.inc) {
      const k = t.dataset.inc as 'missBack' | 'missOver' | 'missSlip';
      st[k]++;
      save();
      render();
      return;
    }
    if (t.dataset.play) {
      st.plays = Math.max(0, st.plays + Number(t.dataset.play));
      save();
      render();
      return;
    }
  });

  modalEl.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.chk) {
      st.checks[input.dataset.chk] = input.checked;
      save();
      render();
    } else if (input.dataset.toggleChk === 'oneAxisDone') {
      st.oneAxisDone = input.checked;
      save();
      render();
    }
  });

  openBtn.addEventListener('click', () => {
    render();
    modalEl.classList.toggle('open');
  });

  render();
}
