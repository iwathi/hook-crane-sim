import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { MachineConfig } from './config';
import { createWoodTexture, createCushionTexture } from './assets';

/**
 * 物理コア。単位は 1 = 10cm、重力 98 (= 9.8m/s²)。
 * 座標系: +X = 画面右、+Y = 上、+Z = 手前（プレイヤー側・商品＆落とし口）、-Z = 奥（上段フック棚）。
 */
export const STEP = 1 / 240; // 240Hz 高精度ステップ
const G = -98;
const BOUNDS = { minX: -2.6, maxX: 2.6, minZ: -3.6, maxZ: 1.6 };
export const HOME = { x: -2.25, z: 1.15 }; // 待機位置（左手前上空・実機同等の移動距離を確保）
const TOP_Y = 5.4;
const ROPE_LEN = 2.0;
const DESCEND = 1.5;
const ASCEND = 1.25;
const SHELF_TOP = 1.65; // 奥の上段棚の上面高さ

// 衝突グループ
const G_STATIC = 1, G_PRIZE = 2, G_RING = 4, G_ROPE = 8;
const ig = (m: number, f: number) => ((m & 0xffff) << 16) | (f & 0xffff);

const SPEED = { slow: 1.0, normal: 1.6, fast: 2.4 };
const ACCEL = { slow: 5, normal: 7, fast: 9 };
// 実機挙動: 急停止しても揺れは小さく、すぐに収まる
const BRAKE = { hard: 18, soft: 3.5 };
const RING_MASS = { light: 1.8, normal: 3.8, heavy: 6.5 };
const RING_DAMP = { light: 0.22, normal: 0.45, heavy: 0.75 };

const ROPE_SPEC = {
  chain: { n: 12, r: 0.022, mass: 0.22, angDamp: 0.6, linDamp: 0.12, twist: 1.25, rest: 0.02, color: 0xe2e6ee },
  wire: { n: 5, r: 0.011, mass: 0.1, angDamp: 8, linDamp: 0.05, twist: 0.3, rest: 0.25, color: 0xdff3ff },
  soft: { n: 14, r: 0.018, mass: 0.1, angDamp: 0.05, linDamp: 0.3, twist: 0.0, rest: 0.0, color: 0xff9a66 },
};

// 実機サイズ比（1 = 10cm）: 大きめで細身のリング（外径約6.5cm・線径約5.2mm）
const RING_SHAPE = {
  thick: { R: 0.30, t: 0.026 },
  circleM: { R: 0.30, t: 0.024 },
  circleL: { R: 0.36, t: 0.024 },
  circleS: { R: 0.24, t: 0.022 },
};

export type Mode = 'real' | 'tutorial' | 'demo' | 'cont' | 'free';
export type Phase = 'idle' | 'moveX' | 'waitZ' | 'moveZ' | 'free' | 'settle' | 'down' | 'bottom' | 'up' | 'hold' | 'return' | 'result';
export type ResultKind = 'get' | 'drop' | 'miss';

export interface LandingSnap {
  ringPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  errX: number;
  errZ: number;
  twistSign: number;
}

export interface Input { b1: boolean; b2: boolean; l: boolean; r: boolean; u: boolean; d: boolean; drop: boolean }

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
type Seg = [THREE.Vector3, THREE.Vector3, number];

// 明るい筐体内で輪郭・先端の向きがくっきり見えるマテリアル設定
const MAT = {
  metal: new THREE.MeshStandardMaterial({ color: 0xd8dfe8, metalness: 0.78, roughness: 0.20 }),
  ring: new THREE.MeshStandardMaterial({ color: 0xf4be37, metalness: 0.76, roughness: 0.22 }),
  nut: new THREE.MeshStandardMaterial({ color: 0xcbd3df, metalness: 0.82, roughness: 0.24 }),
  washer: new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.75, roughness: 0.32 }),
  basket: new THREE.MeshStandardMaterial({ color: 0xff5f8f, roughness: 0.55 }),
  floor: new THREE.MeshStandardMaterial({ color: 0xe6ebf3, roughness: 0.72, metalness: 0.05 }),
  chute: new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.85 }),
  standBar: new THREE.MeshStandardMaterial({ color: 0xd2d8e2, metalness: 0.75, roughness: 0.26 }),
  guard: new THREE.MeshStandardMaterial({ color: 0xb8e8ff, transparent: true, opacity: 0.32, roughness: 0.15 }),
  slope: new THREE.MeshStandardMaterial({ color: 0x7a6cff, roughness: 0.45 }),
  ufoWhite: new THREE.MeshStandardMaterial({ color: 0xfafcff, roughness: 0.25, metalness: 0.05 }),
  ufoGreen: new THREE.MeshStandardMaterial({ color: 0x00c880, roughness: 0.28 }),
  ufoDome: new THREE.MeshStandardMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.55, roughness: 0.15 }),
  shelfWhite: new THREE.MeshStandardMaterial({ color: 0xf7f9fc, roughness: 0.45, metalness: 0.05 }),
  shelfPink: new THREE.MeshStandardMaterial({ color: 0xf4a8c4, roughness: 0.5 }),
  goldBar: new THREE.MeshStandardMaterial({ color: 0xd4b24c, metalness: 0.8, roughness: 0.25 }),
  wireWhite: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.25 }),
  linkChain: new THREE.MeshStandardMaterial({ color: 0xb8c2d0, metalness: 0.85, roughness: 0.25 }),
};

function capsuleBetween(a: THREE.Vector3, b: THREE.Vector3) {
  const d = b.clone().sub(a);
  const len = d.length();
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), d.normalize());
  return { mid, q, half: len / 2 };
}

export class Sim {
  world!: RAPIER.World;
  root = new THREE.Group();
  syncs: { body: RAPIER.RigidBody; obj: THREE.Object3D }[] = [];
  cfg!: MachineConfig;
  mode: Mode = 'real';

  head!: RAPIER.RigidBody;
  ring!: RAPIER.RigidBody;
  ringAttachY = 0;
  ringR = 0.35;
  prize!: RAPIER.RigidBody;
  prizeInit = v3(0, 0, 0);
  hookTarget = v3(0, 0, 0); // 木ブロックローカルの狙い点

  // 連動ギミック（ワイヤーネットトレイ・連動チェーン・手前のペットボトル5本）
  tray!: RAPIER.RigidBody;
  trayInit = v3(0, 0.78, 0.20);
  bottles: { body: RAPIER.RigidBody; initPos: THREE.Vector3 }[] = [];
  linkBeads: THREE.Mesh[] = [];
  linkAnchorPrize = v3(0, -0.14, 0.18);
  linkAnchorTray = v3(0, 0.02, -0.72);
  linkRopeLen = 1.04;

  pos = { x: HOME.x, y: TOP_Y, z: HOME.z };
  vel = { x: 0, z: 0 };
  phase: Phase = 'idle';
  timer = 0;
  stopY = 0;
  twistSign = 0;
  maxLift = 0;
  lifted = false;
  droppedCount = 0;
  lastScore = 0;
  demoTimer = 0;
  landingErr: { x: number; z: number } | null = null;
  landingSnap: LandingSnap | null = null;
  lastResult: ResultKind | null = null;

  onResult?: (k: ResultKind, err: { x: number; z: number } | null, droppedCount?: number, score?: number) => void;
  onPhase?: (p: Phase) => void;

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
  }

  /** 今回のプレイにおけるねじれ方向を確定（ランダム時は開始時に決定して観察可能にする） */
  private resolveTwistSign() {
    if (this.cfg.twist === 'random') {
      this.twistSign = Math.random() < 0.5 ? -1 : 1;
    } else {
      this.twistSign = ({ none: 0, cw: -1, ccw: 1 } as const)[this.cfg.twist];
    }
  }

  activeTwistSign(): number {
    return this.twistSign;
  }

  /** 答え合わせ表示をスキップして即座に次のプレイへ進む */
  skipResult() {
    if (this.phase === 'result') {
      this.timer = 0;
    }
  }

  build(cfg: MachineConfig, mode: Mode) {
    this.cfg = cfg;
    this.mode = mode;
    if (this.world) this.world.free();
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
    this.root.clear();
    this.syncs = [];
    this.bottles = [];
    this.linkBeads = [];

    const w = new RAPIER.World({ x: 0, y: G, z: 0 });
    w.timestep = STEP;
    w.numSolverIterations = 16;
    this.world = w;

    this.resolveTwistSign();
    this.buildStatic();
    this.buildPrize();
    this.buildTrayAndBottles();
    this.buildCrane();

    this.vel = { x: 0, z: 0 };
    this.maxLift = 0;
    this.lifted = false;
    this.droppedCount = 0;
    this.lastScore = 0;
    this.demoTimer = 0.65;
    this.landingErr = null;
    this.landingSnap = null;
    this.setPhase(mode === 'free' ? 'free' : 'idle');
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.onPhase?.(p);
  }

  private addMesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, pos?: THREE.Vector3, q?: THREE.Quaternion) {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.copy(pos);
    if (q) m.quaternion.copy(q);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  private addCapsule(body: RAPIER.RigidBody, obj: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material,
    opt: { mass?: number; groups: number; friction?: number; rest?: number }) {
    const { mid, q, half } = capsuleBetween(a, b);
    const cd = RAPIER.ColliderDesc.capsule(half, r)
      .setTranslation(mid.x, mid.y, mid.z)
      .setRotation(q)
      .setCollisionGroups(opt.groups)
      .setFriction(opt.friction ?? 0.4)
      .setRestitution(opt.rest ?? 0.05);
    if (opt.mass !== undefined) cd.setMass(opt.mass);
    this.world.createCollider(cd, body);
    this.addMesh(obj, new THREE.CapsuleGeometry(r, half * 2, 6, 12), mat, mid, q);
  }

  private fixedBox(pos: THREE.Vector3, half: THREE.Vector3, mat: THREE.Material | null, q = new THREE.Quaternion(), friction = 0.6) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(q));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setCollisionGroups(ig(G_STATIC, 0xffff)).setFriction(friction), body);
    if (mat) this.addMesh(this.root, new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2), mat, pos, q);
    return body;
  }

  private buildStatic() {
    const c = this.cfg;

    // 1. 奥の上段棚（白い棚板: フック付き土台板が載る・奥行き広め）
    this.fixedBox(v3(0, SHELF_TOP - 0.06, -2.55), v3(3.1, 0.06, 1.4), MAT.shelfWhite, undefined, 0.55);
    // 棚前端のピンクストライプ装飾（実機写真風）
    this.addMesh(this.root, new THREE.BoxGeometry(6.2, 0.008, 0.16), MAT.shelfPink, v3(0, SHELF_TOP + 0.004, -1.24));

    // 2. 手前下の大きな落とし口（カラフルな布クッション床＋囲い）
    const cushionMat = new THREE.MeshStandardMaterial({ map: createCushionTexture(), roughness: 0.9 });
    this.fixedBox(v3(0, -0.95, 0.6), v3(2.8, 0.1, 1.8), cushionMat, undefined, 0.9);
    // 落とし口の囲い（落ちたボトルを受け止める）
    this.fixedBox(v3(0, -0.35, 2.35), v3(2.9, 0.65, 0.08), MAT.guard);
    this.fixedBox(v3(-2.85, -0.35, 0.6), v3(0.08, 0.65, 1.8), null);
    this.fixedBox(v3(2.85, -0.35, 0.6), v3(0.08, 0.65, 1.8), null);
    this.fixedBox(v3(0, 0.25, -1.25), v3(3.1, 1.35, 0.06), MAT.shelfWhite); // 上段棚下の前面パネル

    // 3. 外壁（衝突境界）
    this.fixedBox(v3(-3.2, 3.5, -0.8), v3(0.1, 4.5, 3.6), null);
    this.fixedBox(v3(3.2, 3.5, -0.8), v3(0.1, 4.5, 3.6), null);
    this.fixedBox(v3(0, 3.5, -4.2), v3(3.2, 4.5, 0.1), null);
    this.fixedBox(v3(0, 3.5, 2.5), v3(3.2, 4.5, 0.1), null);

    // 4. ワイヤーネットトレイの奥側受けバー（ゴールドの横バー: ヒンジ0.78より少し低い0.70にして通常時はわずかに奥下がりで安定）
    const goldBarBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.70, -0.35));
    const barQ = new THREE.Quaternion().setFromAxisAngle(v3(0, 0, 1), Math.PI / 2);
    this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(2.9, 0.04).setRotation(barQ).setCollisionGroups(ig(G_STATIC, 0xffff)).setFriction(0.3),
      goldBarBody,
    );
    this.addMesh(this.root, new THREE.CylinderGeometry(0.04, 0.04, 5.8, 12), MAT.goldBar, v3(0, 0.70, -0.35), barQ);

    const px = c.prizeX, pz = c.prizeZ;
    if (c.guard === 'side') {
      const h = 1.2;
      for (const s of [-1, 1]) this.fixedBox(v3(px + s * 0.85, SHELF_TOP + h / 2, pz), v3(0.02, h / 2, 0.55), MAT.guard);
    }
    if (c.slope !== 'none') {
      const q = new THREE.Quaternion();
      if (c.slope === 'left') q.setFromAxisAngle(v3(0, 0, 1), 0.25);
      if (c.slope === 'right') q.setFromAxisAngle(v3(0, 0, 1), -0.25);
      if (c.slope === 'toward') q.setFromAxisAngle(v3(1, 0, 0), 0.25);
      this.fixedBox(v3(px, SHELF_TOP + 0.08, pz + 0.55), v3(0.8, 0.04, 0.35), MAT.slope, q, 0.25);
    }
  }

  /**
   * 実機写真準拠の美しい「？型（洋灯吊・クエスチョンマーク型）」オープンフックを生成。
   * 根元の垂直軸から C1 連続の 3次ベジェ曲線でくびれを描き、歪みのない真円アーチへ滑らかに接続する。
   */
  private generateSmoothHook(
    origin: THREE.Vector3,
    yaw: number = 0,
    radius: number = 0.16,
    openDeg: number = -15,
    wireR: number = 0.022,
  ): { segs: Seg[]; curvePts: THREE.Vector3[]; target: THREE.Vector3; topY: number; nut: THREE.Vector3; wireR: number } {
    const q = new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), yaw);
    const toWorld = (p: THREE.Vector3) => p.clone().applyQuaternion(q).add(origin);

    const stemH = 0.08;
    const centerY = stemH + radius * 1.48;
    const startAngle = (-140 * Math.PI) / 180; // 左下から真円アーチ開始
    const endAngle = (openDeg * Math.PI) / 180;

    // 根元から垂直軸
    const p0 = v3(0, 0, 0);
    const p1 = v3(0, stemH, 0);

    // 真円アーチの開始点と時計回り接線ベクトル
    const pArcStart = v3(
      radius * Math.cos(startAngle),
      centerY + radius * Math.sin(startAngle),
      0,
    );
    // 角度減少方向（時計回り）の単位接線: (sin(a), -cos(a))
    const tanStart = v3(Math.sin(startAngle), -Math.cos(startAngle), 0).normalize();

    // 垂直軸上端(接線=真上) → 真円開始点(接線=tanStart) を歪みなく滑らかに繋ぐ 3次ベジェ曲線
    const cp1 = v3(0, stemH + radius * 0.42, 0);
    const cp2 = pArcStart.clone().addScaledVector(tanStart, -radius * 0.36);
    const neckCurve = new THREE.CubicBezierCurve3(p1, cp1, cp2, pArcStart);

    const localPts: THREE.Vector3[] = [p0, p1];
    const neckSteps = 8;
    for (let i = 1; i <= neckSteps; i++) {
      localPts.push(neckCurve.getPoint(i / neckSteps));
    }

    // 歪みのない真円アーチ（左下 -140° → 左 -180° → 真上 -270° → 右 -360° → 先端）
    const totalSweep = -2 * Math.PI + (endAngle - startAngle);
    const arcSteps = 22;
    for (let i = 1; i <= arcSteps; i++) {
      const a = startAngle + totalSweep * (i / arcSteps);
      localPts.push(v3(radius * Math.cos(a), centerY + radius * Math.sin(a), 0));
    }

    const worldPts = localPts.map(toWorld);
    const segs: Seg[] = [];
    for (let i = 0; i < worldPts.length - 1; i++) {
      segs.push([worldPts[i], worldPts[i + 1], wireR]);
    }

    const target = toWorld(v3(0, centerY, 0));

    return {
      segs,
      curvePts: worldPts,
      target,
      topY: centerY + radius,
      nut: origin.clone(),
      wireR,
    };
  }

  /** 全フック形状を実機写真の「？型オープンフック」に統一 */
  private hookParts(): {
    segs: Seg[];
    curves: { pts: THREE.Vector3[]; wireR: number }[];
    target: THREE.Vector3;
    armY: number;
    nutPositions: THREE.Vector3[];
  } {
    const c = this.cfg;
    const rScale = { deep: 1.15, normal: 1.0, shallow: 0.85 }[c.hookDepth];
    // フック深さ（shallow ほど開口が広く抜けやすい）
    const openDeg = { deep: -30, normal: -15, shallow: 10 }[c.hookDepth];
    const baseR = 0.16 * rScale;
    const wireR = 0.022;

    const collect = (list: ReturnType<Sim['generateSmoothHook']>[], mainIdx = 0, armY = 0.48) => ({
      segs: list.flatMap((h) => h.segs),
      curves: list.map((h) => ({ pts: h.curvePts, wireR: h.wireR })),
      target: list[mainIdx].target,
      armY,
      nutPositions: list.map((h) => h.nut),
    });

    // 1. 実機2連・？型フック（写真の通り左右に2本配置）
    if (c.hook === 'pin3Up') {
      return collect([
        this.generateSmoothHook(v3(-0.42, 0, 0.0), 0, baseR, openDeg, wireR),        // 左（開口部右向き）
        this.generateSmoothHook(v3(0.42, 0, 0.0), Math.PI, baseR, openDeg, wireR),   // 右（開口部左向き）
      ], 0, 0.48);
    }

    // 1b. 動画再現：中央1本・左開口「？」型フック（リング右端を合わせて左奥に落とす滑り込み用）
    if (c.hook === 'slideLeft') {
      return collect([
        this.generateSmoothHook(v3(0, 0, 0), Math.PI, baseR * 1.05, openDeg, wireR),
      ], 0, 0.50);
    }

    // 2. 単体・？型フック
    if (c.hook === 'pinUp') {
      return collect([this.generateSmoothHook(v3(0, 0, 0), 0, baseR * 1.12, openDeg, wireR)], 0, 0.50);
    }

    // 3. ワイド・特大？型フック
    if (c.hook === 'j') {
      return collect([this.generateSmoothHook(v3(0, 0, 0), 0, baseR * 1.3, openDeg - 8, wireR * 1.05)], 0, 0.55);
    }

    // 4. 斜め向き・？型フック
    if (c.hook === 'pinDiag') {
      return collect([this.generateSmoothHook(v3(0, 0, 0), Math.PI * 0.25, baseR, openDeg, wireR)], 0, 0.48);
    }

    // 5. 3連三角・？型フック
    return collect([
      this.generateSmoothHook(v3(-0.42, 0, 0.14), 0, baseR, openDeg, wireR),
      this.generateSmoothHook(v3(0.42, 0, 0.14), Math.PI, baseR, openDeg, wireR),
      this.generateSmoothHook(v3(0.0, 0, -0.18), -Math.PI * 0.35, baseR, openDeg, wireR),
    ], 0, 0.48);
  }

  private buildPrize() {
    const c = this.cfg;
    const isPlate = c.prize === 'plate';
    // 奥の上段棚（SHELF_TOP = 1.65）に平置きされた広く薄い土台板（面積約5倍・厚さ4mm相当）
    const baseTop = SHELF_TOP;
    const half = isPlate ? v3(1.60, 0.02, 0.83) : v3(0.75, 0.32, 0.45);
    const offX = { none: 0, left: -0.3, right: 0.3 }[c.com];

    this.prizeInit.set(c.prizeX, baseTop + half.y, c.prizeZ);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.prizeInit.x, this.prizeInit.y, this.prizeInit.z)
        .setCcdEnabled(true)
        .setAngularDamping(1.0)
        .setLinearDamping(0.35),
    );
    const obj = new THREE.Group();
    this.root.add(obj);
    this.syncs.push({ body, obj });
    this.prize = body;

    // 垂直スライド専用ガイド（PrismaticJoint）:
    // リングがぶつかっても絶対に倒れたり横ズレしたりせず、フックに引っ掛かって上に引き上げたときだけ真上に持ち上がる
    const prizeAnchor = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(this.prizeInit.x, this.prizeInit.y, this.prizeInit.z),
    );
    const slideData = RAPIER.JointData.prismatic({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    slideData.limitsEnabled = true;
    slideData.limits = [0, 2.2];
    const slideJoint = this.world.createImpulseJoint(slideData, prizeAnchor, body, true);
    slideJoint.setContactsEnabled(false);

    const groups = ig(G_PRIZE, 0xffff);
    const bc = v3(offX, 0, 0);
    const isSlide = c.hook === 'slideLeft';

    // 土台板コライダー（動画再現のアクリル板は超低摩擦0.06で金属リングがツルッと滑る）
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setTranslation(bc.x, bc.y, bc.z)
        .setMass(isPlate ? 0.85 : 2.8)
        .setFriction(isSlide ? 0.06 : 0.20)
        .setRestitution(0.02)
        .setCollisionGroups(groups),
      body,
    );

    // 土台板のメッシュ表示（slideLeft時は動画どおりのクリアアクリル板、通常は木目板）
    if (isPlate) {
      if (isSlide) {
        const acrylicMat = new THREE.MeshStandardMaterial({
          color: 0xf4f8ff,
          transparent: true,
          opacity: 0.72,
          roughness: 0.12,
          metalness: 0.08,
        });
        this.addMesh(obj, new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2), acrylicMat, bc);
      } else {
        const woodMat = new THREE.MeshStandardMaterial({
          map: createWoodTexture(),
          roughness: 0.65,
          metalness: 0.04,
        });
        this.addMesh(obj, new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2), woodMat, bc);
      }
    } else {
      this.addMesh(obj, new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2), MAT.basket, bc);
    }

    // 連動チェーンの接続アンカーを板の底面手前端に設定
    this.linkAnchorPrize.set(0, -half.y, half.z - 0.12);

    // フック金具（プレート上面から立ち上がる・滑らかな1本のTubeメッシュ＋物理カプセル複合コライダー）
    const hp = this.hookParts();
    this.hookTarget.copy(hp.target).add(v3(0, half.y, 0));

    // 物理コライダー（各セグメントをカプセルで配置）
    for (const [a, b, r] of hp.segs) {
      const pa = a.clone().add(v3(0, half.y, 0));
      const pb = b.clone().add(v3(0, half.y, 0));
      const { mid, q, half: segHalf } = capsuleBetween(pa, pb);
      const cd = RAPIER.ColliderDesc.capsule(segHalf, r)
        .setTranslation(mid.x, mid.y, mid.z)
        .setRotation(q)
        .setCollisionGroups(groups)
        .setFriction(0.28)
        .setRestitution(0.02)
        .setMass(0.03);
      this.world.createCollider(cd, body);
    }

    // 視覚メッシュ（継ぎ目のない美しい1本のクロームチューブ＋先端丸キャップ＋フラット座金）
    for (const cv of hp.curves) {
      const liftedPts = cv.pts.map((p) => p.clone().add(v3(0, half.y, 0)));
      const path = new THREE.CatmullRomCurve3(liftedPts, false, 'centripetal', 0.5);
      this.addMesh(obj, new THREE.TubeGeometry(path, 48, cv.wireR, 14, false), MAT.metal);
      // 先端の丸みキャップ
      this.addMesh(obj, new THREE.SphereGeometry(cv.wireR, 12, 10), MAT.metal, liftedPts[liftedPts.length - 1]);
    }

    // 根元の処理: デフォルト(none)は突起なしのごく薄いフラット座金のみ（実機写真準拠）
    for (const npos of hp.nutPositions) {
      const wp = npos.clone().add(v3(0, half.y + 0.004, 0));
      this.addMesh(obj, new THREE.CylinderGeometry(0.055, 0.065, 0.008, 16), MAT.washer, wp);
    }

    // オプションで六角ナットを選択した場合のみ物理コライダー付きナットを追加
    if (c.nut !== 'none') {
      const isLarge = c.nut === 'large';
      const nr = isLarge ? 0.14 : 0.095;
      const nh = isLarge ? 0.11 : 0.075;
      for (const npos of hp.nutPositions) {
        const np = npos.clone().add(v3(0, half.y + nh / 2, 0));
        this.world.createCollider(
          RAPIER.ColliderDesc.cylinder(nh / 2, nr)
            .setTranslation(np.x, np.y, np.z)
            .setMass(0.05)
            .setFriction(0.68)
            .setRestitution(0.02)
            .setCollisionGroups(groups),
          body,
        );
        this.addMesh(obj, new THREE.CylinderGeometry(nr, nr, nh, 6), MAT.nut, np);
      }
    }

    // 下降限界の計算:
    // リングが木ブロック上面・フック根元にしっかり接地し、倒れ込んでチェーンが弛む深さ
    const armWorld = baseTop + half.y * 2 + 0.10;
    this.ringR = this.ringSize().R;
    const delta = { shallow: 0.06, normal: -this.ringR * 0.75, deep: -(this.ringR * 1.65 + 0.10) }[c.depth];
    const ringBottomTarget = armWorld + delta;
    this.stopY = Math.max(ROPE_LEN + 0.5, ringBottomTarget + ROPE_LEN + this.ringSize().span);
  }

  /**
   * 写真準拠の「連動ワイヤーネットトレイ＋手前のペットボトル飲料5本」を構築。
   * 木ブロックがフックで持ち上がると、連動チェーン（RopeJoint）がワイヤーネットの奥側を引き上げ、
   * 手前のヒンジバーを支点にトレイが大きく傾いて5本のペットボトルが手前の落とし口へ滑り落ちる。
   */
  private buildTrayAndBottles() {
    const trayHalf = v3(1.45, 0.02, 0.76);
    this.trayInit.set(0, 0.78, 0.20);

    // 1. 手前側のヒンジ固定バー（シルバーの金属棒）
    const hingeZ = this.trayInit.z + trayHalf.z; // +0.96
    const hingeY = this.trayInit.y;              // 0.78
    const hingeBar = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, hingeY, hingeZ),
    );
    const barQ = new THREE.Quaternion().setFromAxisAngle(v3(0, 0, 1), Math.PI / 2);
    this.addMesh(this.root, new THREE.CylinderGeometry(0.032, 0.032, 5.8, 12), MAT.metal, v3(0, hingeY, hingeZ), barQ);

    // 2. ワイヤーネットトレイ（ダイナミック剛体）
    const tray = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.trayInit.x, this.trayInit.y, this.trayInit.z)
        .setAngularDamping(0.8)
        .setLinearDamping(0.2)
        .setCanSleep(false),
    );
    this.tray = tray;
    const trayObj = new THREE.Group();
    this.root.add(trayObj);
    this.syncs.push({ body: tray, obj: trayObj });

    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(trayHalf.x, trayHalf.y, trayHalf.z)
        .setMass(0.42)
        .setFriction(0.24)
        .setRestitution(0.03)
        .setCollisionGroups(ig(G_PRIZE, G_STATIC | G_PRIZE)),
      tray,
    );
    // トレイ奥側の低い転がり止め（通常時のわずかな奥下がりでボトルが奥へ落ちないようにする）
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(trayHalf.x, 0.08, 0.02)
        .setTranslation(0, 0.08, -trayHalf.z + 0.02)
        .setMass(0.02)
        .setFriction(0.3)
        .setCollisionGroups(ig(G_PRIZE, G_STATIC | G_PRIZE)),
      tray,
    );

    // ワイヤーネットの視覚表現（白い金属フレーム＋縦横の細いワイヤー格子）
    const w = trayHalf.x * 2, d = trayHalf.z * 2;
    const rFrame = 0.022, rGrid = 0.011;
    // 外枠4辺
    this.addMesh(trayObj, new THREE.BoxGeometry(w, rFrame * 2, rFrame * 2), MAT.wireWhite, v3(0, 0, -trayHalf.z));
    this.addMesh(trayObj, new THREE.BoxGeometry(w, rFrame * 2, rFrame * 2), MAT.wireWhite, v3(0, 0, trayHalf.z));
    this.addMesh(trayObj, new THREE.BoxGeometry(rFrame * 2, rFrame * 2, d), MAT.wireWhite, v3(-trayHalf.x, 0, 0));
    this.addMesh(trayObj, new THREE.BoxGeometry(rFrame * 2, rFrame * 2, d), MAT.wireWhite, v3(trayHalf.x, 0, 0));
    // 縦ワイヤー
    for (let x = -1.2; x <= 1.21; x += 0.3) {
      this.addMesh(trayObj, new THREE.BoxGeometry(rGrid * 2, rGrid * 2, d), MAT.wireWhite, v3(x, 0, 0));
    }
    // 横ワイヤー
    for (let z = -0.55; z <= 0.56; z += 0.275) {
      this.addMesh(trayObj, new THREE.BoxGeometry(w, rGrid * 2, rGrid * 2), MAT.wireWhite, v3(0, 0, z));
    }

    // ヒンジジョイント（手前バーを支点に X 軸回転）
    const hingeJoint = this.world.createImpulseJoint(
      RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: trayHalf.z }, { x: 1, y: 0, z: 0 }),
      hingeBar,
      tray,
      true,
    );
    hingeJoint.setContactsEnabled(false);

    // 3. 木ブロック底面とワイヤーネット奥側を繋ぐ連動チェーン（RopeJoint）
    this.linkAnchorTray.set(0, trayHalf.y, -trayHalf.z + 0.03);
    const pA = this.prizeInit.clone().add(this.linkAnchorPrize);
    const pB = this.trayInit.clone().add(this.linkAnchorTray);
    // わずかな遊び(+0.08)を持たせ、木ブロックが確実に持ち上がったときだけトレイを引き上げる
    this.linkRopeLen = pA.distanceTo(pB) + 0.08;

    const ropeJoint = this.world.createImpulseJoint(
      RAPIER.JointData.rope(
        this.linkRopeLen,
        { x: this.linkAnchorPrize.x, y: this.linkAnchorPrize.y, z: this.linkAnchorPrize.z },
        { x: this.linkAnchorTray.x, y: this.linkAnchorTray.y, z: this.linkAnchorTray.z },
      ),
      this.prize,
      tray,
      true,
    );
    ropeJoint.setContactsEnabled(false);

    // 連動チェーンのリアルタイム描画ビーズ（10個）
    const beadGeo = new THREE.SphereGeometry(0.026, 8, 8);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(beadGeo, MAT.linkChain);
      m.castShadow = true;
      this.root.add(m);
      this.linkBeads.push(m);
    }

    // 4. 手前の商品: 5本のペットボトル飲料（オレンジ×2、ピンク×2、白×1）
    const bottleSpecs = [
      { x: -0.96, bodyCol: 0xf59e0b, labelCol: 0xfef3c7, capCol: 0x65a30d },
      { x: -0.48, bodyCol: 0xf59e0b, labelCol: 0xfef3c7, capCol: 0x65a30d },
      { x: 0.0,   bodyCol: 0xfb7185, labelCol: 0xffe4e6, capCol: 0x65a30d },
      { x: 0.48,  bodyCol: 0xfb7185, labelCol: 0xffe4e6, capCol: 0x65a30d },
      { x: 0.96,  bodyCol: 0xf1f5f9, labelCol: 0x38bdf8, capCol: 0x1d4ed8 },
    ];
    const bR = 0.185;
    const bHalfLen = 0.36;
    const rotX90 = new THREE.Quaternion().setFromAxisAngle(v3(1, 0, 0), Math.PI / 2);

    for (const sp of bottleSpecs) {
      const initPos = v3(sp.x, this.trayInit.y + trayHalf.y + bR + 0.01, this.trayInit.z - 0.02);
      const bBody = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(initPos.x, initPos.y, initPos.z)
          .setCcdEnabled(true)
          .setLinearDamping(0.08)
          .setAngularDamping(0.25),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.capsule(bHalfLen, bR)
          .setRotation(rotX90)
          .setMass(0.32)
          .setFriction(0.22)
          .setRestitution(0.1)
          .setCollisionGroups(ig(G_PRIZE, G_STATIC | G_PRIZE)),
        bBody,
      );

      const bObj = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: sp.bodyCol, roughness: 0.22, metalness: 0.05 });
      const labelMat = new THREE.MeshStandardMaterial({ color: sp.labelCol, roughness: 0.4 });
      const capMat = new THREE.MeshStandardMaterial({ color: sp.capCol, roughness: 0.35 });

      // ペットボトル胴体（Z軸沿い・奥側がキャップ、手前が底）
      this.addMesh(bObj, new THREE.CylinderGeometry(bR, bR, 0.88, 16), bodyMat, v3(0, 0, 0.08), rotX90);
      // ラベル帯
      this.addMesh(bObj, new THREE.CylinderGeometry(bR + 0.005, bR + 0.005, 0.42, 16), labelMat, v3(0, 0, 0.0), rotX90);
      // 肩・ネック部（奥 -Z 方向）
      this.addMesh(bObj, new THREE.CylinderGeometry(bR * 0.42, bR, 0.22, 16), bodyMat, v3(0, 0, -0.46), rotX90);
      // キャップ
      this.addMesh(bObj, new THREE.CylinderGeometry(bR * 0.44, bR * 0.44, 0.12, 14), capMat, v3(0, 0, -0.60), rotX90);

      this.root.add(bObj);
      this.syncs.push({ body: bBody, obj: bObj });
      this.bottles.push({ body: bBody, initPos });
    }
  }

  private ringSize() {
    if (this.cfg.ringShape === 'dring') return { R: 0.30, span: 0.20 + 0.30 + 0.024 };
    const s = RING_SHAPE[this.cfg.ringShape as keyof typeof RING_SHAPE] || RING_SHAPE.thick;
    return { R: s.R, span: s.R * 2 + s.t };
  }

  /** リングの複合コライダー用セグメント（24セグメントで滑らか・確実な引っ掛かり） */
  private ringSegs(): { segs: Seg[]; attachY: number } {
    const segs: Seg[] = [];
    if (this.cfg.ringShape === 'dring') {
      const t = 0.024, top = 0.20, w = 0.28, h = 0.48;
      segs.push([v3(-w, top, 0), v3(w, top, 0), t]);
      const N = 16;
      let prev = v3(w, top, 0);
      for (let i = 1; i <= N; i++) {
        const th = -Math.PI * (i / N);
        const p = v3(w * Math.cos(th), top + h * Math.sin(th), 0);
        segs.push([prev, p, t]);
        prev = p;
      }
      return { segs, attachY: top };
    }

    const s = RING_SHAPE[this.cfg.ringShape as keyof typeof RING_SHAPE] || RING_SHAPE.thick;
    const { R, t } = s;
    const N = 24;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      segs.push([v3(R * Math.cos(a0), R * Math.sin(a0), 0), v3(R * Math.cos(a1), R * Math.sin(a1), 0), t]);
    }
    return { segs, attachY: R };
  }

  /** 丸型クレーンヘッド＋ボールチェーン＋金属リングの構築 */
  private buildCrane() {
    const c = this.cfg;
    this.pos = { x: HOME.x, y: TOP_Y, z: HOME.z };
    const head = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y, this.pos.z),
    );
    this.head = head;

    // 白い丸型クレーンヘッド
    const hobj = new THREE.Group();
    // 白い丸みのあるボディ
    this.addMesh(hobj, new THREE.CylinderGeometry(0.55, 0.5, 0.32, 24), MAT.ufoWhite, v3(0, 0.16, 0));
    // 上部ドーム
    this.addMesh(hobj, new THREE.SphereGeometry(0.48, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.ufoDome, v3(0, 0.28, 0));
    // エメラルドグリーンリング帯
    this.addMesh(hobj, new THREE.TorusGeometry(0.52, 0.04, 12, 32), MAT.ufoGreen, v3(0, 0.16, 0), new THREE.Quaternion().setFromAxisAngle(v3(1, 0, 0), Math.PI / 2));
    // ガイド支柱
    this.addMesh(hobj, new THREE.CylinderGeometry(0.04, 0.04, 3, 10), MAT.metal, v3(0, 1.8, 0));
    this.root.add(hobj);
    this.syncs.push({ body: head, obj: hobj });

    // ボールチェーン（球体カプセル連結）
    const rs = ROPE_SPEC[c.rope];
    const segLen = ROPE_LEN / rs.n;
    const ropeMat = new THREE.MeshStandardMaterial({
      color: rs.color,
      metalness: c.rope === 'chain' ? 0.9 : 0.1,
      roughness: 0.25,
    });

    let prev: RAPIER.RigidBody = head;
    let prevAnchor = { x: 0, y: 0, z: 0 };

    for (let i = 0; i < rs.n; i++) {
      const y = this.pos.y - segLen * (i + 0.5);
      const b = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(this.pos.x, y, this.pos.z)
          .setAngularDamping(rs.angDamp)
          .setLinearDamping(rs.linDamp)
          .setCanSleep(false),
      );
      const half = Math.max(0.01, segLen / 2 - rs.r);
      this.world.createCollider(
        RAPIER.ColliderDesc.capsule(half, rs.r).setMass(rs.mass).setCollisionGroups(ig(G_ROPE, G_STATIC)),
        b,
      );

      const o = new THREE.Group();
      if (c.rope === 'chain') {
        // ボールチェーンらしさを出すため球体ビーズを2個並べる
        this.addMesh(o, new THREE.SphereGeometry(rs.r * 1.5, 8, 8), ropeMat, v3(0, -segLen * 0.25, 0));
        this.addMesh(o, new THREE.SphereGeometry(rs.r * 1.5, 8, 8), ropeMat, v3(0, segLen * 0.25, 0));
      } else {
        this.addMesh(o, new THREE.CylinderGeometry(rs.r, rs.r, segLen, 8), ropeMat);
      }
      this.root.add(o);
      this.syncs.push({ body: b, obj: o });

      const j = this.world.createImpulseJoint(
        RAPIER.JointData.spherical(prevAnchor, { x: 0, y: segLen / 2, z: 0 }),
        prev,
        b,
        true,
      );
      j.setContactsEnabled(false);
      prev = b;
      prevAnchor = { x: 0, y: -segLen / 2, z: 0 };
    }

    // リング（金属トーラス）
    const rsg = this.ringSegs();
    this.ringAttachY = rsg.attachY;
    const ringMassVal = RING_MASS[c.ringMass];
    const ring = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.pos.x, this.pos.y - ROPE_LEN - rsg.attachY, this.pos.z)
        .setCcdEnabled(true)
        .setLinearDamping(RING_DAMP[c.ringMass])
        .setAngularDamping(0.4)
        .setCanSleep(false),
    );
    this.ring = ring;
    const robj = new THREE.Group();
    this.root.add(robj);
    this.syncs.push({ body: ring, obj: robj });

    const ringFriction = c.hook === 'slideLeft' ? 0.08 : 0.22;
    const m = ringMassVal / rsg.segs.length;
    for (const [a, b, r] of rsg.segs) {
      this.addCapsule(ring, robj, a, b, r, MAT.ring, {
        mass: m,
        groups: ig(G_RING, G_STATIC | G_PRIZE),
        friction: ringFriction,
        rest: rs.rest,
      });
    }

    // 吊り下げ接続
    const j = this.world.createImpulseJoint(
      RAPIER.JointData.spherical(prevAnchor, { x: 0, y: rsg.attachY, z: 0 }),
      prev,
      ring,
      true,
    );
    j.setContactsEnabled(false);
  }

  resetPrize() {
    const p = this.prize;
    p.setTranslation(this.prizeInit, true);
    p.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    p.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.setAngvel({ x: 0, y: 0, z: 0 }, true);

    if (this.tray) {
      this.tray.setTranslation(this.trayInit, true);
      this.tray.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      this.tray.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.tray.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    for (const b of this.bottles) {
      b.body.setTranslation(b.initPos, true);
      b.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.maxLift = 0;
    this.lifted = false;
    this.droppedCount = 0;
  }

  hookTargetWorld() {
    const t = this.prize.translation(), r = this.prize.rotation();
    return this.hookTarget.clone().applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)).add(v3(t.x, t.y, t.z));
  }

  /** フック開口部へ潜り込むための理想の狙い位置（チュートリアル・デモ・採点共通） */
  aimTargetWorld() {
    const tg = this.hookTargetWorld();
    if (this.cfg.hook === 'slideLeft') {
      // 動画再現：リング右端をフックに合わせ、フック左奥(-3.2cm, -1.4cm)へ落として滑り込ませる
      return v3(tg.x - 0.32, tg.y, tg.z - 0.14);
    }
    // 長距離奥移動後の慣性・回転を考慮したフック開口部のスイートスポット
    const offZ = -0.08;
    return v3(tg.x + 0.18, tg.y, tg.z + offZ);
  }

  ringPos() {
    const t = this.ring.translation();
    return v3(t.x, t.y, t.z);
  }

  groundBelow(p: THREE.Vector3): number {
    const ray = new RAPIER.Ray({ x: p.x, y: p.y - 0.5, z: p.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 20, true, undefined, ig(0x10, G_STATIC | G_PRIZE));
    return hit ? p.y - 0.5 - hit.timeOfImpact : 0;
  }

  info() {
    const rv = this.ring.linvel();
    const av = this.ring.angvel();
    const rp = this.ringPos();
    const tg = this.hookTargetWorld();
    return {
      swing: Math.hypot(rv.x - this.vel.x, rv.z - this.vel.z),
      spin: av.y,
      twistSign: this.twistSign || ({ none: 0, cw: -1, ccw: 1, random: 0 } as const)[this.cfg.twist],
      errX: rp.x - tg.x,
      errZ: rp.z - tg.z,
      phase: this.phase,
    };
  }

  private approach(v: number, target: number, rate: number, dt: number) {
    return v < target ? Math.min(v + rate * dt, target) : Math.max(v - rate * dt, target);
  }

  /**
   * 獲得判定＆スコア採点（0〜100点）:
   * 「フックに引っ掛かって木ブロックがしっかり持ち上がり、その結果として手前の商品が落ちた」ことのみを成功(get)とする。
   */
  private judge() {
    let fallen = 0;
    for (const b of this.bottles) {
      if (b.body.translation().y < 0.25) fallen++;
    }
    this.droppedCount = fallen;

    const hookedAndLifted = this.maxLift > 0.35;
    let k: ResultKind = 'miss';
    let score = 0;

    if (hookedAndLifted && fallen > 0) {
      k = 'get';
      score = Math.min(100, 80 + fallen * 4);
    } else if (hookedAndLifted) {
      k = 'drop'; // 引っ掛かって持ち上がったが、商品が落ちるまで届かなかった
      score = Math.min(78, Math.round(60 + (this.maxLift - 0.35) * 14));
    } else {
      const err = this.landingErr;
      const distCm = err ? Math.hypot(err.x, err.z) * 10 : 12;
      score = Math.max(0, Math.round(58 - distCm * 5.2));
    }

    this.lastScore = score;
    this.lastResult = k;
    this.onResult?.(k, this.landingErr, fallen, score);
  }

  step(input: Input) {
    const dt = STEP;
    const c = this.cfg;
    let inX = 0, inZ = 0;
    const real = this.mode !== 'free';
    const isDemo = this.mode === 'demo';

    // デモモード自動操縦（理想ルートに沿って①→②→降下→引っ掛け→落下を実演）
    if (isDemo) {
      const aim = this.aimTargetWorld();
      const brake = BRAKE[c.brake];
      switch (this.phase) {
        case 'idle':
          this.demoTimer -= dt;
          if (this.demoTimer <= 0) this.setPhase('moveX');
          break;
        case 'moveX': {
          const stopDist = (this.vel.x * this.vel.x) / (2 * brake);
          if (this.pos.x + stopDist < aim.x) {
            inX = 1;
          } else {
            this.demoTimer = 0.45;
            this.setPhase('waitZ');
          }
          break;
        }
        case 'waitZ':
          this.demoTimer -= dt;
          if (this.demoTimer <= 0) this.setPhase('moveZ');
          break;
        case 'moveZ': {
          const stopDist = (this.vel.z * this.vel.z) / (2 * brake);
          if (this.pos.z - stopDist > aim.z) {
            inZ = -1;
          } else {
            this.setPhase('settle');
            this.timer = 0.3;
          }
          break;
        }
        default:
          break;
      }
    }

    switch (this.phase) {
      case 'idle':
        if (!isDemo && input.b1) this.setPhase('moveX');
        break;
      case 'moveX':
        if (!isDemo) {
          if (input.b1) inX = 1; else this.setPhase('waitZ');
        }
        break;
      case 'waitZ':
        if (!isDemo && input.b2) this.setPhase('moveZ');
        break;
      case 'moveZ':
        if (!isDemo) {
          if (input.b2) inZ = -1; else { this.setPhase('settle'); this.timer = 0.25; }
        }
        break;
      case 'free':
        inX = (input.r ? 1 : 0) - (input.l ? 1 : 0);
        inZ = (input.d ? 1 : 0) - (input.u ? 1 : 0);
        if (input.drop) { this.setPhase('settle'); this.timer = 0.15; }
        break;
      case 'settle':
        if (Math.abs(this.vel.x) < 1e-3 && Math.abs(this.vel.z) < 1e-3) {
          this.timer -= dt;
          if (this.timer <= 0) {
            this.maxLift = 0;
            this.lifted = false;
            this.landingErr = null;
            this.landingSnap = null;
            this.setPhase('down');
          }
        }
        break;
      case 'down':
        this.pos.y -= DESCEND * dt;
        if (this.pos.y <= this.stopY) {
          this.pos.y = this.stopY;
          const rp = this.ringPos(), aim = this.aimTargetWorld();
          this.landingErr = { x: rp.x - aim.x, z: rp.z - aim.z };
          this.landingSnap = {
            ringPos: rp.clone(),
            targetPos: aim.clone(),
            errX: rp.x - aim.x,
            errZ: rp.z - aim.z,
            twistSign: this.twistSign,
          };
          this.timer = 0.85; // しっかり倒れ込み＆回転時間を確保
          this.setPhase('bottom');
        }
        break;
      case 'bottom':
        this.timer -= dt;
        if (this.timer <= 0) this.setPhase('up');
        break;
      case 'up':
        this.pos.y += ASCEND * dt;
        if (this.pos.y >= TOP_Y) {
          this.pos.y = TOP_Y;
          // 持ち上げた状態で手前の商品が滑り落ちきるのを待つ
          this.timer = this.maxLift > 0.2 ? 0.9 : 0.25;
          this.setPhase('hold');
        }
        break;
      case 'hold':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.judge();
          this.timer = 3.2;
          this.setPhase('result');
        }
        break;
      case 'return': {
        // 未使用だが互換維持
        this.setPhase('result');
        break;
      }
      case 'result':
        this.timer -= dt;
        if (this.timer <= 0) {
          // 次のプレイへ: クレーンと商品を初期状態に戻す（実機／成功時は全リセット）
          if (real) {
            this.build(this.cfg, this.mode);
            return;
          } else {
            if (this.lastResult === 'get') this.resetPrize();
            this.resolveTwistSign();
            this.setPhase('free');
          }
        }
        break;
    }

    const curLift = this.prize.translation().y - this.prizeInit.y;
    this.maxLift = Math.max(this.maxLift, curLift);
    if (curLift > 0.6) this.lifted = true;

    // クレーン水平移動（加速・ブレーキで慣性＝振り子を発生）
    if (this.phase !== 'return') {
      this.vel.x = this.approach(this.vel.x, inX * SPEED[c.speed], inX ? ACCEL[c.speed] : BRAKE[c.brake], dt);
      this.vel.z = this.approach(this.vel.z, inZ * SPEED[c.speed], inZ ? ACCEL[c.speed] : BRAKE[c.brake], dt);
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    if (this.pos.x < BOUNDS.minX || this.pos.x > BOUNDS.maxX) { this.pos.x = THREE.MathUtils.clamp(this.pos.x, BOUNDS.minX, BOUNDS.maxX); this.vel.x = 0; }
    if (this.pos.z < BOUNDS.minZ || this.pos.z > BOUNDS.maxZ) { this.pos.z = THREE.MathUtils.clamp(this.pos.z, BOUNDS.minZ, BOUNDS.maxZ); this.vel.z = 0; }
    this.head.setNextKinematicTranslation(this.pos);

    // ねじれ癖＆接地時の滑り込み:
    // 1. 接地して紐が94%以下に弛んだとき:
    //    - ねじれあり: 回転トルクでクルッと回ってフックの懐へ潜り込む
    //    - 動画再現(slideLeft): アクリル板上でリングが傾きながら右斜め手前（フック側）へスッと滑る
    // 2. プレイ開始・待機中（張力あり）: ごく微細な回転癖を与え、目視で回転方向を見極められるようにする
    this.ring.resetTorques(true);
    this.ring.resetForces(true);
    const sign = this.twistSign;
    const ropeTwist = ROPE_SPEC[c.rope].twist;
    const rpNow = this.ring.translation();
    const distToHead = Math.hypot(rpNow.x - this.pos.x, rpNow.y + this.ringAttachY - this.pos.y, rpNow.z - this.pos.z);
    const slack = distToHead < ROPE_LEN * 0.94;
    const m = RING_MASS[c.ringMass];

    if (slack && (this.phase === 'down' || this.phase === 'bottom')) {
      // 接地後の自然な滑り（アクリル板の低摩擦＋傾きによる横滑り）
      const slideForce = c.hook === 'slideLeft' ? 18.0 : 8.0;
      const dirX = c.hook === 'slideLeft' ? 1.0 : (this.hookTargetWorld().x - rpNow.x >= 0 ? 0.6 : -0.6);
      const dirZ = c.hook === 'slideLeft' ? 0.35 : 0;
      const rv = this.ring.linvel();
      if (Math.hypot(rv.x, rv.z) < 1.2) {
        this.ring.addForce({ x: dirX * slideForce * m, y: 0, z: dirZ * slideForce * m }, true);
      }
    }

    if (sign && ropeTwist > 0) {
      const inertia = m * this.ringR * this.ringR;
      if (slack) {
        if (sign * this.ring.angvel().y < 3.4) {
          this.ring.addTorque({ x: 0, y: sign * 16 * ropeTwist * inertia, z: 0 }, true);
        }
      } else if (this.phase === 'idle' || this.phase === 'moveX' || this.phase === 'waitZ' || this.phase === 'moveZ' || this.phase === 'free') {
        // プレイ開始時の微細な回転癖（リングがほんのりゆっくり回転して向きを観察できる）
        if (sign * this.ring.angvel().y < 0.45) {
          this.ring.addTorque({ x: 0, y: sign * 0.55 * ropeTwist * inertia, z: 0 }, true);
        }
      }
    }

    this.world.step();
  }

  sync() {
    for (const { body, obj } of this.syncs) {
      const t = body.translation(), r = body.rotation();
      obj.position.set(t.x, t.y, t.z);
      obj.quaternion.set(r.x, r.y, r.z, r.w);
    }

    // 木ブロック〜ワイヤーネット間の連動チェーンをリアルタイム描画
    if (this.linkBeads.length > 0 && this.prize && this.tray) {
      const pt = this.prize.translation(), pr = this.prize.rotation();
      const tt = this.tray.translation(), tr = this.tray.rotation();
      const pA = this.linkAnchorPrize.clone().applyQuaternion(new THREE.Quaternion(pr.x, pr.y, pr.z, pr.w)).add(v3(pt.x, pt.y, pt.z));
      const pB = this.linkAnchorTray.clone().applyQuaternion(new THREE.Quaternion(tr.x, tr.y, tr.z, tr.w)).add(v3(tt.x, tt.y, tt.z));
      const dist = pA.distanceTo(pB);
      const sag = Math.max(0, (this.linkRopeLen - dist) * 0.45);
      const n = this.linkBeads.length;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const pos = pA.clone().lerp(pB, u);
        pos.y -= sag * Math.sin(u * Math.PI);
        this.linkBeads[i].position.copy(pos);
      }
    }
  }
}
