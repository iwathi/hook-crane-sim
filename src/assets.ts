import * as THREE from 'three';

/** Canvas 2D による動的テクスチャ生成 */

/** ナチュラルな木目ブロック用テクスチャ */
export function createWoodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#dec293';
  ctx.fillRect(0, 0, 256, 256);

  // 木目の縞模様
  for (let y = 0; y < 256; y += 3) {
    const alpha = 0.05 + Math.sin(y * 0.14) * 0.04 + Math.random() * 0.03;
    ctx.fillStyle = `rgba(135, 92, 42, ${alpha.toFixed(3)})`;
    ctx.fillRect(0, y, 256, 2);
  }
  // わずかな節
  ctx.strokeStyle = 'rgba(120, 78, 34, 0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(140, 128, 42, 10, 0.08, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

/** 落とし口のカラフルなクッション布テクスチャ */
export function createCushionTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f5d547';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#5bb8f5';
  ctx.beginPath();
  ctx.arc(190, 160, 75, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f26a6a';
  ctx.beginPath();
  ctx.arc(70, 80, 55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff88';
  ctx.beginPath();
  ctx.arc(130, 190, 45, 0, Math.PI * 2);
  ctx.fill();

  return new THREE.CanvasTexture(canvas);
}
