# フック引っ掛けクレーンゲーム練習シミュレーター

Three.js + Rapier3D（WASM 物理エンジン・240Hz 固定ステップ）で動作する、スマートフォン向けフック引っ掛けクレーンゲーム練習シミュレーターです。

## 主な機能
- **連動トレイギミック**: 奥のフック付き土台板を引っ掛けて持ち上げると、連動チェーンで手前のワイヤーネットトレイが傾き、商品が落とし口へ滑り落ちる物理連動を再現
- **プレイモード**:
  - **実機モード**: ①（横移動）→ ②（奥移動）→ 自動降下・上昇。プレイ中はガイド非表示、終了後に着地誤差と 100 点満点のスコアを答え合わせ表示
  - **チュートリアルモード**: 引っ掛かり理想ルートを 3D 表示し、ボタンを離すベストタイミングをリアルタイム案内
  - **デモモード**: 純粋な物理演算によるお手本プレイを自動実演
  - **フリー／連続モード**: 位置微調整や手数再現の練習に対応
- **ガラス越し覗き込み**: 画面を左右にドラッグして奥行きを確認（「覗き固定」対応）
- **100円 / 回カウンター**: `GET 回数 / 実施回数` と金額を常時集計（集計リセット・初期位置ボタン分離）

## ローカル起動

```bash
npm install
npm run dev
```

## GitHub Pages への公開手順（専用リポジトリ）

1. GitHub で新しいパブリックリポジトリ（例：`hook-crane-sim`）を作成
2. `hook-crane-sim` フォルダ内で以下を実行して push：

```bash
cd hook-crane-sim
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<あなたのユーザー名>/hook-crane-sim.git
git push -u origin main
```

3. GitHub のリポジトリページ → **Settings** → **Pages** → **Build and deployment / Source** を **GitHub Actions** に設定
4. 数十秒〜1分ほどで `https://<あなたのユーザー名>.github.io/hook-crane-sim/` に自動公開されます
