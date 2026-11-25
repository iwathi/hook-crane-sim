import './style.css';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Sim, STEP, HOME, type Mode, type Input, type ResultKind } from './sim';
import { FIELDS, PRESETS, BASE, randomConfig, type MachineConfig } from './config';
import { initAdvisor } from './advisor';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** 明るいクレーンゲーム筐体内装・LED照明バーの構築 */
function buildArcadeEnvironment(scene: THREE.Scene) {
  const env = new THREE.Group();

  // 筐体フレーム（ライトグレーのアルミ枠）
  const frameMat = new THREE.LineBasicMaterial({ color: 0xb0bdd0 });
  const frameBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(6.4, 6.4, 6.8)),
    frameMat,
  );
  frameBox.position.set(0, 3.2, -0.8);
  env.add(frameBox);

  // 明るいライトグレーの背面・側面パネル（白いクレーンヘッドが背景に溶け込まずくっきり見える明度）
  const panelMat = new THREE.MeshStandardMaterial({ color: 0xdde4ef, roughness: 0.6, metalness: 0.04 });
  const sideMat = new THREE.MeshStandardMaterial({ color: 0xd3dce9, roughness: 0.65, metalness: 0.04, side: THREE.DoubleSide });

  const backPanel = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4), panelMat);
  backPanel.position.set(0, 3.2, -4.2);
  backPanel.receiveShadow = true;
  env.add(backPanel);

  // 背面パネルの水平ガイド帯（奥行き・高さの目視基準）
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xc2cde0, roughness: 0.5 });
  for (const y of [1.2, 2.6, 4.0]) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.05), stripeMat);
    stripe.position.set(0, y, -4.18);
    env.add(stripe);
  }

  // 左右サイドパネル（うっすらと筐体の奥行きを感じさせる）
  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 6.4), sideMat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-3.2, 3.2, -0.8);
  env.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 6.4), sideMat);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(3.2, 3.2, -0.8);
  env.add(rightWall);

  // 天井LEDライトバー（手前から奥まで2本＋手前側1本）
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const lx of [-2.4, 2.4]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 6.4), ledMat);
    bar.position.set(lx, 6.3, -0.8);
    env.add(bar);
  }
  const frontBar = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.06, 0.14), ledMat);
  frontBar.position.set(0, 6.3, 1.8);
  env.add(frontBar);

  scene.add(env);
}

async function main() {
  await RAPIER.init();

  // ---------- 描画セットアップ ----------
  const stage = $('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  stage.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef2f8);

  // 環境マップ（金属リング・フック・六角ナットの反射と輪郭をくっきりさせる）
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;

  // 明るい筐体内ライティング
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd4dce8, 1.45));

  // 真上からのメインLED照明
  const topLight = new THREE.DirectionalLight(0xffffff, 1.9);
  topLight.position.set(1.5, 9.5, 3.2);
  topLight.castShadow = true;
  topLight.shadow.mapSize.set(2048, 2048);
  topLight.shadow.bias = -0.0004;
  Object.assign(topLight.shadow.camera, { left: -3.5, right: 3.5, top: 3.5, bottom: -3.5, near: 1, far: 20 });
  scene.add(topLight);

  // プレート＆フックを真上から照らすLEDスポットライト
  const spotLed = new THREE.SpotLight(0xffffff, 36, 16, Math.PI / 3.2, 0.45, 1.2);
  spotLed.position.set(0.4, 6.2, 0.2);
  spotLed.target.position.set(0.4, 0.4, -0.15);
  scene.add(spotLed, spotLed.target);

  // 正面からの補助光（フック先端やナットの立体感を強調）
  const fillLight = new THREE.DirectionalLight(0xf2f7ff, 0.85);
  fillLight.position.set(-2.0, 4.2, 5.5);
  scene.add(fillLight);

  buildArcadeEnvironment(scene);

  // 実機ガラス越しの距離感（FOV = 40°）
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);

  // ガイド（練習モード用垂線・軌跡・ターゲットマーカー）
  const guideLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineDashedMaterial({ color: 0x00bfa5, dashSize: 0.08, gapSize: 0.05 }),
  );
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.11, 24),
    new THREE.MeshBasicMaterial({ color: 0x00bfa5, side: THREE.DoubleSide }),
  );
  marker.rotation.x = -Math.PI / 2;
  const TRAIL_N = 90;
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xff8f00, transparent: true, opacity: 0.85 }));
  trail.frustumCulled = false;
  const targetMark = new THREE.Mesh(new THREE.SphereGeometry(0.04), new THREE.MeshBasicMaterial({ color: 0xe91e63 }));
  const guide = new THREE.Group();
  guide.add(guideLine, marker, trail, targetMark);
  scene.add(guide);
  const trailPts: THREE.Vector3[] = [];

  // 答え合わせ専用の着地地点マーカー（result フェーズのみ表示）
  const snapRingMark = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.12, 24),
    new THREE.MeshBasicMaterial({ color: 0xff9800, side: THREE.DoubleSide }),
  );
  snapRingMark.rotation.x = -Math.PI / 2;
  const snapTargetMark = new THREE.Mesh(
    new THREE.SphereGeometry(0.045),
    new THREE.MeshBasicMaterial({ color: 0xe91e63 }),
  );
  const snapGroup = new THREE.Group();
  snapGroup.add(snapRingMark, snapTargetMark);
  snapGroup.visible = false;
  scene.add(snapGroup);

  // チュートリアル／デモ用 3D引っ掛かりルート（①横ライン→②奥ライン→③降下ライン→着地マーカー→フック潜り込み矢印）
  const routeXLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0x00bcd4 }),
  );
  const routeZLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0x2979ff }),
  );
  const routeDownLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineDashedMaterial({ color: 0xffa000, dashSize: 0.1, gapSize: 0.06 }),
  );
  const routeLandRing = new THREE.Mesh(
    new THREE.RingGeometry(0.14, 0.21, 28),
    new THREE.MeshBasicMaterial({ color: 0xffab00, side: THREE.DoubleSide }),
  );
  routeLandRing.rotation.x = -Math.PI / 2;
  const routeHookLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0xff1744 }),
  );
  const routeHookTip = new THREE.Mesh(
    new THREE.ConeGeometry(0.055, 0.14, 12),
    new THREE.MeshBasicMaterial({ color: 0xff1744 }),
  );
  const tutorialGroup = new THREE.Group();
  tutorialGroup.add(routeXLine, routeZLine, routeDownLine, routeLandRing, routeHookLine, routeHookTip);
  tutorialGroup.visible = false;
  scene.add(tutorialGroup);

  // ---------- 状態 ----------
  const sim = new Sim(scene);
  let cfg: MachineConfig = loadInitialConfig();
  let presetName = 'カスタム';
  let mode: Mode = 'real';
  let camMode: 'front' | 'side' | 'zoom' | 'auto' = 'front';
  let timeScale = 1;
  // 実機モードのデフォルトはガイドOFF（目視トレーニング優先）
  let guideOn = false;

  // ガラス越し覗き込み視点の状態（単位1=10cm → ±2.0 = ±20cm）
  const PEEK_MAX = 2.0;
  let peekX = 0;
  let peekTargetX = 0;
  let peekLocked = false;
  let draggingPeek = false;
  let dragStartX = 0;
  let dragStartPeek = 0;

  const input: Input = { b1: false, b2: false, l: false, r: false, u: false, d: false, drop: false };
  const touch = { b1: false, b2: false, l: false, r: false, u: false, d: false };
  const keys = new Set<string>();

  function rebuild() {
    sim.build(cfg, mode);
    trailPts.length = 0;
    hideAnswer();
    localStorage.setItem('hcs-current-v4', JSON.stringify(cfg));
    syncPanel();
  }

  // ---------- 結果・統計・答え合わせ・100円/回カウンター ----------
  type Stat = { tries: number; gets: number; drops: number; ex: number; ez: number; n: number };
  type Counter = { gets: number; plays: number; sinceLastGet: number; lastGetTries: number };
  const stats: Record<string, Stat> = JSON.parse(localStorage.getItem('hcs-stats') || '{}');
  const counter: Counter = Object.assign(
    { gets: 0, plays: 0, sinceLastGet: 0, lastGetTries: 0 },
    JSON.parse(localStorage.getItem('hcs-counter') || '{}'),
  );
  const answerBox = $('answerBox');
  const playCounter = $('playCounter');

  function renderCounter() {
    const totalYen = counter.plays * 100;
    const curYen = counter.sinceLastGet * 100;
    const lastInfo = counter.lastGetTries > 0
      ? `直近GET: ${counter.lastGetTries}回（¥${counter.lastGetTries * 100}）`
      : '未GET';
    playCounter.innerHTML =
      `<div class="pc-main">GET <span class="pc-get">${counter.gets}</span> / ${counter.plays}回 <small>(¥${totalYen.toLocaleString()})</small></div>` +
      `<div class="pc-sub">現在 ${counter.sinceLastGet}回(¥${curYen.toLocaleString()}) ｜ ${lastInfo}</div>`;
  }

  function hideAnswer() {
    answerBox.classList.remove('show');
    snapGroup.visible = false;
  }

  function showAnswer() {
    const snap = sim.landingSnap;
    const score = sim.lastScore;
    const rank = score >= 95 ? 'S' : score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 30 ? 'C' : 'D';
    const rankCls = rank === 'S' ? 's' : rank === 'A' ? 'a' : '';

    let errHtml = '';
    let subHtml = 'タップで次へ';
    if (snap) {
      const exCm = snap.errX * 10;
      const ezCm = snap.errZ * 10;
      const dirX = Math.abs(exCm) < 0.25 ? 'ドンピシャ' : exCm > 0 ? `右 +${exCm.toFixed(1)}cm` : `左 ${exCm.toFixed(1)}cm`;
      const dirZ = Math.abs(ezCm) < 0.25 ? 'ドンピシャ' : ezCm > 0 ? `手前 +${ezCm.toFixed(1)}cm` : `奥 ${ezCm.toFixed(1)}cm`;
      const tw = snap.twistSign < 0 ? '↻ 時計回り' : snap.twistSign > 0 ? '↺ 反時計回り' : 'なし';
      const costText = mode !== 'demo'
        ? (sim.lastResult === 'get'
          ? ` ／ <b>${counter.lastGetTries}回目（¥${counter.lastGetTries * 100}）でGET!</b>`
          : ` ／ 累計 ${counter.sinceLastGet}回（¥${counter.sinceLastGet * 100}）`)
        : '';
      errHtml = `<div class="ans-vals">横(X): ${dirX} ／ 奥行(Z): ${dirZ}</div>`;
      subHtml = `ねじれ: ${tw}${costText}（タップで次へ）`;

      snapRingMark.position.set(snap.ringPos.x, snap.targetPos.y, snap.ringPos.z);
      snapTargetMark.position.copy(snap.targetPos);
      snapGroup.visible = true;
    }

    answerBox.innerHTML =
      `<div class="ans-title">${mode === 'demo' ? 'デモ実演 結果' : '結果・答え合わせ'}</div>` +
      `<div class="ans-score">${score}<small>点 / 100</small><span class="ans-rank ${rankCls}">${rank}</span></div>` +
      errHtml +
      `<div class="ans-sub">${subHtml}</div>`;
    answerBox.classList.add('show');
  }

  answerBox.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    sim.skipResult();
  });

  sim.onPhase = (p) => {
    if (p === 'result') {
      showAnswer();
    } else {
      hideAnswer();
    }
  };

  sim.onResult = (k: ResultKind, err, droppedCount = 0) => {
    // デモモードは自動実演のため戦績・金額にカウントしない
    if (mode !== 'demo') {
      counter.plays++;
      counter.sinceLastGet++;
      if (k === 'get') {
        counter.gets++;
        counter.lastGetTries = counter.sinceLastGet;
        counter.sinceLastGet = 0;
      }
      localStorage.setItem('hcs-counter', JSON.stringify(counter));
      renderCounter();

      const s = (stats[presetName] ||= { tries: 0, gets: 0, drops: 0, ex: 0, ez: 0, n: 0 });
      s.tries++;
      if (k === 'get') s.gets++;
      if (k === 'drop') s.drops++;
      if (err) { s.ex += err.x; s.ez += err.z; s.n++; }
      localStorage.setItem('hcs-stats', JSON.stringify(stats));
      renderStats();
    }
    const label = k === 'get' ? (droppedCount > 0 ? `GET!! ${droppedCount}本落下!` : 'GET!!') : k === 'drop' ? '惜しい！' : 'ミス';
    showMsg(label, k);
  };

  const msg = $('msg');
  let msgTimer = 0;
  function showMsg(t: string, cls: string) {
    msg.textContent = t;
    msg.className = 'show ' + cls;
    clearTimeout(msgTimer);
    msgTimer = window.setTimeout(() => (msg.className = ''), 1800);
  }

  function renderStats() {
    const rows = Object.entries(stats).map(([name, s]) => {
      const ax = s.n ? (s.ex / s.n) * 10 : 0, az = s.n ? (s.ez / s.n) * 10 : 0;
      const trend = [
        Math.abs(az) > 0.5 ? (az > 0 ? `手前に${az.toFixed(1)}cm` : `奥に${(-az).toFixed(1)}cm`) : '',
        Math.abs(ax) > 0.5 ? (ax > 0 ? `右に${ax.toFixed(1)}cm` : `左に${(-ax).toFixed(1)}cm`) : '',
      ].filter(Boolean).join('・') || '良好';
      return `<tr><td>${name}</td><td>${s.tries}</td><td>${s.tries ? Math.round((s.gets / s.tries) * 100) : 0}%</td><td>${s.gets ? (s.tries / s.gets).toFixed(1) : '-'}</td><td>${trend}</td></tr>`;
    });
    $('stats').innerHTML = rows.length
      ? `<table><tr><th>台</th><th>試行</th><th>GET率</th><th>平均手数</th><th>ズレ傾向</th></tr>${rows.join('')}</table>`
      : 'まだ記録がありません';
  }

  // ---------- パネル ----------
  const fieldsEl = $('fields');
  const fieldEls: Record<string, HTMLInputElement | HTMLSelectElement> = {};
  for (const f of FIELDS) {
    const label = document.createElement('label');
    label.textContent = f.label;
    let el: HTMLInputElement | HTMLSelectElement;
    if (f.type === 'select') {
      el = document.createElement('select');
      for (const [v, t] of f.options) el.add(new Option(t, v));
    } else {
      el = document.createElement('input');
      Object.assign(el, { type: 'range', min: f.min, max: f.max, step: f.step });
    }
    el.addEventListener('change', () => {
      (cfg as any)[f.key] = f.type === 'range' ? parseFloat(el.value) : el.value;
      presetName = 'カスタム';
      presetSel.value = '';
      rebuild();
    });
    label.append(el);
    fieldsEl.append(label);
    fieldEls[f.key] = el;
  }
  function syncPanel() {
    for (const f of FIELDS) fieldEls[f.key].value = String(cfg[f.key]);
    const p = PRESETS.find((p) => p.name === presetName);
    $('presetDesc').textContent = p ? p.desc : 'カスタム設定';
  }

  const presetSel = $<HTMLSelectElement>('preset');
  presetSel.add(new Option('カスタム', ''));
  PRESETS.forEach((p, i) => presetSel.add(new Option(p.name, String(i))));
  presetSel.addEventListener('change', () => {
    if (presetSel.value === '') return;
    const p = PRESETS[+presetSel.value];
    presetName = p.name;
    cfg = p.make();
    rebuild();
    presetSel.blur();
  });

  const panel = $('panel');
  $('menuBtn').onclick = () => panel.classList.toggle('open');
  $('closePanel').onclick = () => panel.classList.remove('open');
  $('randBtn').onclick = () => { cfg = randomConfig(); presetName = 'カスタム'; presetSel.value = ''; rebuild(); };
  $('shareBtn').onclick = async () => {
    const url = location.origin + location.pathname + '#c=' + btoa(encodeURIComponent(JSON.stringify(cfg)));
    try { await navigator.clipboard.writeText(url); showMsg('URLコピー済', 'miss'); } catch { prompt('このURLを共有してください', url); }
  };

  const saved: Record<string, MachineConfig> = JSON.parse(localStorage.getItem('hcs-saved') || '{}');
  const savedSel = $<HTMLSelectElement>('savedSel');
  function renderSaved() {
    savedSel.innerHTML = '';
    for (const n of Object.keys(saved)) savedSel.add(new Option(n, n));
  }
  $('saveBtn').onclick = () => {
    const n = prompt('設定名（例: 〇〇ゲーセン 3番台）');
    if (!n) return;
    saved[n] = { ...cfg };
    localStorage.setItem('hcs-saved', JSON.stringify(saved));
    renderSaved();
    savedSel.value = n;
  };
  $('loadBtn').onclick = () => {
    const c = saved[savedSel.value];
    if (!c) return;
    cfg = { ...BASE, ...c };
    presetName = savedSel.value;
    presetSel.value = '';
    rebuild();
  };
  $('delBtn').onclick = () => {
    delete saved[savedSel.value];
    localStorage.setItem('hcs-saved', JSON.stringify(saved));
    renderSaved();
  };
  $('clearStats').onclick = () => {
    if (!confirm('統計をリセットしますか？')) return;
    for (const k of Object.keys(stats)) delete stats[k];
    localStorage.setItem('hcs-stats', '{}');
    renderStats();
  };

  // ---------- トップバー ----------
  const MODE_LABEL: Record<Mode, string> = { real: '実機', tutorial: 'チュート', demo: 'デモ中', cont: '連続', free: 'フリー' };
  const modeBtn = $('modeBtn');
  const demoBtn = $('demoBtn');
  function applyMode() {
    modeBtn.textContent = MODE_LABEL[mode];
    modeBtn.classList.toggle('on', mode === 'tutorial');
    demoBtn.classList.toggle('on', mode === 'demo');
    $('realCtl').classList.toggle('active', mode !== 'free');
    $('freeCtl').classList.toggle('active', mode === 'free');
    $('guideBtn').classList.toggle('on', guideOn && mode !== 'real');
  }
  modeBtn.onclick = () => {
    mode = mode === 'real' ? 'tutorial' : mode === 'tutorial' ? 'cont' : mode === 'cont' ? 'free' : 'real';
    if (mode === 'free' || mode === 'tutorial') guideOn = true;
    if (mode === 'real') guideOn = false;
    applyMode();
    rebuild();
  };
  demoBtn.onclick = () => {
    mode = mode === 'demo' ? 'real' : 'demo';
    if (mode === 'real') guideOn = false;
    applyMode();
    rebuild();
  };
  const CAM_LABEL = { front: '正面', side: '側面', zoom: '拡大', auto: '自動' };
  $('camBtn').onclick = () => {
    camMode = camMode === 'front' ? 'side' : camMode === 'side' ? 'zoom' : camMode === 'zoom' ? 'auto' : 'front';
    $('camBtn').textContent = CAM_LABEL[camMode];
  };
  $('peekLockBtn').onclick = () => {
    peekLocked = !peekLocked;
    $('peekLockBtn').classList.toggle('on', peekLocked);
    if (!peekLocked && !draggingPeek) peekTargetX = 0;
  };
  $('slowBtn').onclick = () => {
    timeScale = timeScale === 1 ? 0.5 : timeScale === 0.5 ? 0.25 : 1;
    $('slowBtn').textContent = timeScale + 'x';
    $('slowBtn').classList.toggle('on', timeScale !== 1);
  };
  $('guideBtn').onclick = () => {
    if (mode === 'real') {
      showMsg('実機モードは目視専用', 'miss');
      return;
    }
    guideOn = !guideOn;
    $('guideBtn').classList.toggle('on', guideOn);
  };
  // 初期位置に戻すボタン（集計はリセットしない）
  $('resetBtn').onclick = () => {
    peekTargetX = 0;
    rebuild();
  };
  // 集計リセットボタン（GET数・実施回数・金額を0に戻す）
  $('resetStatsBtn').onclick = () => {
    counter.gets = 0;
    counter.plays = 0;
    counter.sinceLastGet = 0;
    counter.lastGetTries = 0;
    localStorage.setItem('hcs-counter', JSON.stringify(counter));
    renderCounter();
    showMsg('集計リセット', 'miss');
  };

  // ---------- ガラス越し「左右ドラッグ覗き込み」操作 ----------
  const canvas = renderer.domElement;
  const peekBadge = $('peekBadge');

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    canvas.setPointerCapture(e.pointerId);
    draggingPeek = true;
    dragStartX = e.clientX;
    dragStartPeek = peekTargetX;
    canvas.classList.add('peeking');
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!draggingPeek) return;
    const dx = e.clientX - dragStartX;
    // 画面幅の40%ドラッグで ±20cm（±2.0）移動
    const scale = (PEEK_MAX * 2) / Math.max(220, stage.clientWidth * 0.65);
    peekTargetX = THREE.MathUtils.clamp(dragStartPeek + dx * scale, -PEEK_MAX, PEEK_MAX);
  });

  const endPeek = () => {
    if (!draggingPeek) return;
    draggingPeek = false;
    canvas.classList.remove('peeking');
    if (!peekLocked) {
      peekTargetX = 0;
    }
  };
  canvas.addEventListener('pointerup', endPeek);
  canvas.addEventListener('pointercancel', endPeek);
  canvas.addEventListener('lostpointercapture', endPeek);

  // ---------- タッチ操作 ----------
  function bindHold(el: HTMLElement, key: keyof typeof touch) {
    const up = () => { touch[key] = false; el.classList.remove('on'); };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      touch[key] = true;
      el.classList.add('on');
      navigator.vibrate?.(10);
    });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }
  bindHold($('btn1'), 'b1');
  bindHold($('btn2'), 'b2');
  document.querySelectorAll<HTMLElement>('.d').forEach((el) => bindHold(el, el.dataset.k as keyof typeof touch));
  $('dropBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); input.drop = true; navigator.vibrate?.(15); });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // ---------- キーボード ----------
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'SELECT' || (e.target as HTMLElement).tagName === 'INPUT') return;
    keys.add(e.key.toLowerCase());
    if (e.key === ' ') { input.drop = true; e.preventDefault(); }
    if (e.key.toLowerCase() === 'r') rebuild();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  const kd = (...k: string[]) => k.some((x) => keys.has(x));

  function gatherInput() {
    input.b1 = touch.b1 || kd('1', 'arrowright', 'd');
    input.b2 = touch.b2 || kd('2', 'arrowup', 'w');
    input.l = touch.l || kd('arrowleft', 'a');
    input.r = touch.r || kd('arrowright', 'd');
    input.u = touch.u || kd('arrowup', 'w');
    input.d = touch.d || kd('arrowdown', 's');
  }

  // ---------- リサイズ ----------
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // ---------- 実機ガラス越し目線のカメラ＋答え合わせ側面拡大 ----------
  const camPos = new THREE.Vector3(-0.2, 3.2, 5.8);
  const camLook = new THREE.Vector3(-0.2, 1.5, 0.0);

  function updateCamera() {
    // 覗き込みXを滑らかに補間
    peekX = THREE.MathUtils.lerp(peekX, peekTargetX, draggingPeek ? 0.35 : 0.14);
    if (Math.abs(peekX) > 0.05) {
      const cm = (peekX * 10).toFixed(0);
      peekBadge.textContent = `覗き込み ${peekX > 0 ? '右 +' : '左 '}${cm}cm${peekLocked ? '（固定）' : ''}`;
      peekBadge.classList.add('show');
    } else {
      peekBadge.classList.remove('show');
    }

    // 画面アスペクト比に応じて、クレーンヘッド(x=-1.45, y=5.4)〜プレート・トレイ全体が
    // iPhone縦画面でもPC横画面でも切れないベストな距離を自動算出する
    const vRad = THREE.MathUtils.degToRad(camera.fov) / 2;
    const tanV = Math.tan(vRad);
    const tanH = tanV * Math.max(0.45, camera.aspect);
    const ph = sim.phase;
    const look = new THREE.Vector3();
    const off = new THREE.Vector3();

    // result フェーズ時は答え合わせのため「接地瞬間の側面・拡大アングル」へ自動切替
    if (ph === 'result' && sim.landingSnap) {
      const snap = sim.landingSnap;
      look.copy(snap.ringPos).lerp(snap.targetPos, 0.5);
      // 斜め横（側面寄り）からX/Zのズレが一目でわかるアングル
      off.set(2.3, 0.85, 1.15);
      const k = 0.12;
      camPos.lerp(look.clone().add(off), k);
      camLook.lerp(look, k);
      camera.position.copy(camPos);
      camera.lookAt(camLook);
      return;
    }

    let m = camMode;
    // デモモード中は「降下〜引っ掛け」を自動で拡大し、上昇〜落下時は正面全体へ戻して商品落下を見やすくする
    if (mode === 'demo') {
      m = ph === 'down' || ph === 'bottom' ? 'zoom' : 'front';
    } else if (m === 'auto') {
      m = ph === 'down' || ph === 'bottom' || ph === 'up' ? 'zoom' : 'front';
    }

    if (m === 'front') {
      // 手前のペットボトル5本・連動トレイ・奥の木ブロック＆フック・クレーンヘッド全体を一望できる見下ろしアングル
      const dist = Math.max(2.0 / tanH, 2.7 / tanV);
      look.set(-0.05 + peekX * 0.22, 1.95, -0.35);
      off.set(peekX, 2.25, dist);
    } else if (m === 'side') {
      const dist = Math.max(2.0 / tanH, 2.5 / tanV);
      look.set(cfg.prizeX, 1.7, -0.5);
      off.set(dist, 0.9, 0);
    } else {
      // 拡大視点: リングとフック・ナットの接地面を斜め上から追従
      const zoomScale = camera.aspect < 1 ? Math.min(1.45, 0.82 / camera.aspect) : 1;
      look.copy(sim.ringPos()).lerp(sim.hookTargetWorld(), 0.5);
      off.set(1.55 * zoomScale, 0.85 * zoomScale, 1.85 * zoomScale);
    }

    const k = m === 'zoom' ? 0.14 : 0.2;
    camPos.lerp(look.clone().add(off), k);
    camLook.lerp(look, k);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }

  // ---------- HUD・ヒント ----------
  const hud = $('hud'), hint = $('hint');
  const PHASE_HINT: Record<string, string> = {
    idle: '画面左右ドラッグで覗き込み ／ ①長押しで右へ',
    moveX: '離すと停止',
    waitZ: '左右ドラッグで奥行確認 ／ ②長押しで奥へ',
    moveZ: '離すと降下開始',
    free: '方向キーで位置調整 → 降下',
    settle: '停止待ち…',
    down: '降下中',
    bottom: '接地・回転中…',
    up: '上昇中',
    hold: '落下判定中…',
    return: '待機位置へ移動中…',
    result: '',
  };

  /** 実機モードのプレイ中は誤差数値・ガイド垂線を完全に非表示にする */
  function shouldShowGuide(): boolean {
    if (mode === 'real') return false;
    return guideOn;
  }

  /** チュートリアル／デモ用の 3D 引っ掛かりルートを更新 */
  function updateTutorialRoute() {
    const show = mode === 'tutorial' || mode === 'demo';
    tutorialGroup.visible = show;
    if (!show) return;

    const aim = sim.aimTargetWorld();
    const hook = sim.hookTargetWorld();
    const ringY = 3.1; // 待機時のリング中心高さ目安
    const plateY = aim.y - 0.25;

    const setLine = (line: THREE.Line, a: THREE.Vector3, b: THREE.Vector3) => {
      const pts = line.geometry.attributes.position as THREE.BufferAttribute;
      pts.setXYZ(0, a.x, a.y, a.z);
      pts.setXYZ(1, b.x, b.y, b.z);
      pts.needsUpdate = true;
    };

    // ① 横移動ルート（シアン）
    setLine(routeXLine, new THREE.Vector3(HOME.x, ringY, HOME.z), new THREE.Vector3(aim.x, ringY, HOME.z));
    // ② 奥移動ルート（ブルー）
    setLine(routeZLine, new THREE.Vector3(aim.x, ringY, HOME.z), new THREE.Vector3(aim.x, ringY, aim.z));
    // ③ 降下ルート（ゴールド点線）
    setLine(routeDownLine, new THREE.Vector3(aim.x, ringY, aim.z), new THREE.Vector3(aim.x, plateY, aim.z));
    routeDownLine.computeLineDistances();

    // 着地狙いリングマーカー
    routeLandRing.position.set(aim.x, plateY + 0.015, aim.z);

    // フック開口部への潜り込み矢印（ピンク）
    setLine(routeHookLine, new THREE.Vector3(aim.x, aim.y, aim.z), hook);
    routeHookTip.position.copy(hook);
    const dir = hook.clone().sub(aim).normalize();
    routeHookTip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }

  let hudTick = 0;
  function updateHud() {
    let text = PHASE_HINT[sim.phase] ?? '';
    let highlight = false;

    if (mode === 'demo') {
      const DEMO_HINT: Record<string, string> = {
        idle: '【デモ実演】お手本プレイを開始します…',
        moveX: '【デモ】① 横移動でフック開口部の真横へ',
        waitZ: '【デモ】横位置OK！次は奥へ移動',
        moveZ: '【デモ】② 奥移動で狙いポイントへ',
        settle: '【デモ】停止・降下準備中…',
        down: '【デモ】降下中（開口部付近へ着地）',
        bottom: '【デモ】回転してフックの懐へ潜り込み！',
        up: '【デモ】上昇！木ブロック＆トレイを引き上げ！',
        hold: '【デモ】手前の商品が落下！',
        result: '【デモ完了】もう一度再生します（デモボタンで終了）',
      };
      text = DEMO_HINT[sim.phase] ?? text;
      highlight = sim.phase === 'bottom' || sim.phase === 'up' || sim.phase === 'hold';
    } else if (mode === 'tutorial') {
      const aim = sim.aimTargetWorld();
      const rp = sim.ringPos();
      if (sim.phase === 'idle') {
        text = '【チュートリアル】水色ラインに沿って①を長押し！';
      } else if (sim.phase === 'moveX') {
        const dx = aim.x - rp.x;
        if (Math.abs(dx) < 0.14) {
          text = '★ いま①を離す！（ベストタイミング）';
          highlight = true;
        } else {
          text = dx > 0 ? `①長押し中… あと右へ ${(dx * 10).toFixed(1)}cm` : '通り過ぎ！すぐ①を離そう';
        }
      } else if (sim.phase === 'waitZ') {
        text = '【チュートリアル】青いラインに沿って②を長押し！';
      } else if (sim.phase === 'moveZ') {
        const dz = rp.z - aim.z;
        if (Math.abs(dz) < 0.14) {
          text = '★ いま②を離す！（ここで降下！）';
          highlight = true;
        } else {
          text = dz > 0 ? `②長押し中… あと奥へ ${(dz * 10).toFixed(1)}cm` : '通り過ぎ！すぐ②を離そう';
        }
      }
    }

    hint.textContent = text;
    hint.classList.toggle('ok', highlight);

    if (!shouldShowGuide()) {
      hud.innerHTML = '';
      return;
    }
    const i = sim.info();
    const tw = i.twistSign < 0 ? '↻ 時計回り' : i.twistSign > 0 ? '↺ 反時計' : 'なし';
    hud.innerHTML =
      `揺れ速度 ${(i.swing * 10).toFixed(1)} cm/s<br>` +
      `ねじれ ${tw}（回転 ${i.spin.toFixed(1)} rad/s）<br>` +
      `誤差 X ${(i.errX * 10).toFixed(1)}cm / Z ${(i.errZ * 10).toFixed(1)}cm` +
      (sim.landingErr ? `<br>着地誤差 X ${(sim.landingErr.x * 10).toFixed(1)} / Z ${(sim.landingErr.z * 10).toFixed(1)}cm` : '');
  }

  function updateGuide() {
    const show = shouldShowGuide();
    guide.visible = show;
    if (!show) return;
    const p = sim.ringPos();
    const gy = sim.groundBelow(p);
    const pts = guideLine.geometry.attributes.position as THREE.BufferAttribute;
    pts.setXYZ(0, p.x, p.y, p.z);
    pts.setXYZ(1, p.x, gy, p.z);
    pts.needsUpdate = true;
    guideLine.computeLineDistances();
    marker.position.set(p.x, gy + 0.01, p.z);
    targetMark.position.copy(sim.hookTargetWorld());
    trailPts.push(p);
    if (trailPts.length > TRAIL_N) trailPts.shift();
    const arr = trailGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < TRAIL_N; i++) {
      const q = trailPts[Math.min(i, trailPts.length - 1)];
      arr.setXYZ(i, q.x, q.y, q.z);
    }
    arr.needsUpdate = true;
  }

  // ---------- 初期化 ----------
  initAdvisor($('advisorModal'), $('advisorBtn'));
  renderSaved();
  renderStats();
  renderCounter();
  applyMode();
  const firstPreset = location.hash.startsWith('#c=') ? -1 : 0;
  if (firstPreset === 0 && !localStorage.getItem('hcs-current-v4')) {
    presetName = PRESETS[0].name;
    presetSel.value = '0';
    cfg = PRESETS[0].make();
  }
  rebuild();

  // ---------- メインループ（固定ステップアキュムレータ） ----------
  let acc = 0, last = performance.now();
  function frame(t: number) {
    const dt = Math.min((t - last) / 1000, 0.05);
    last = t;
    acc += dt * timeScale;
    gatherInput();
    let n = 0;
    while (acc >= STEP && n < 10) {
      sim.step(input);
      input.drop = false;
      acc -= STEP;
      n++;
    }
    if (n >= 10) acc = 0;
    sim.sync();
    updateCamera();
    updateGuide();
    updateTutorialRoute();
    if (++hudTick % 6 === 0) updateHud();
    for (const id of ['btn1', 'btn2'] as const) {
      const ok = mode !== 'demo' && (id === 'btn1' ? sim.phase === 'idle' || sim.phase === 'moveX' : sim.phase === 'waitZ' || sim.phase === 'moveZ');
      $(id).classList.toggle('disabled', !ok);
      if (mode === 'demo') {
        $(id).classList.toggle('on', (id === 'btn1' && sim.phase === 'moveX') || (id === 'btn2' && sim.phase === 'moveZ'));
      }
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function loadInitialConfig(): MachineConfig {
  try {
    if (location.hash.startsWith('#c=')) return { ...BASE, ...JSON.parse(decodeURIComponent(atob(location.hash.slice(3)))) };
    const c = localStorage.getItem('hcs-current-v4');
    if (c) return { ...BASE, ...JSON.parse(c) };
  } catch { /* デフォルトにフォールバック */ }
  return { ...BASE };
}

main();
