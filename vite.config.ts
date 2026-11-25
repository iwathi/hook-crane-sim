import { defineConfig } from 'vite';

// スマホ実機からLAN経由で確認できるよう host を公開
export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2022' },
});
