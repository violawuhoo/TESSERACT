#!/usr/bin/env node
// TESSERACT 视觉基线捕获脚本 —— 零第三方依赖，Node 22+
//
//   npm run baseline            # 捕获全部 V01..V13
//   ONLY=V03 npm run baseline  # 只跑单张，用于调试
//
// 原理：内建静态服务器 + Chrome DevTools Protocol。
// 在页面加载前冻结 Math.random / Date.now 并放大自动下落定时器，
// 使方块序列、时间显示、自动下落完全确定；所有状态仅通过 DOM 点击 /
// 合成键盘事件 / DOM 注入达成，不修改任何游戏源码。
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'baseline');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8791;
const CDP_PORT = 9334;
const BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = process.env.ONLY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json; charset=utf-8'
};

// ---------- 确定性注入（文档加载前执行） ----------
const FREEZE = `
(() => {
  let s = 0x2f6e2b1 >>> 0;
  Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  // 开局前重置，使方块序列不受页面加载期（程序化音效噪声等）随机调用次数影响
  window.__resetRandom = () => { s = 0x2f6e2b1 >>> 0; };
  Date.now = () => 1762750000000;
  const si = window.setInterval;
  window.setInterval = function (fn, ms, ...args) {
    if (typeof ms === 'number' && ms >= 400) ms = 2147483647;
    return si.call(window, fn, ms, ...args);
  };
})();`;

// CSS 极光 / 脉动等动画依赖 wall clock，会让同场景两帧不同；基线里统一停到初始态。
const NO_ANIM = `
document.addEventListener('DOMContentLoaded', () => {
  const st = document.createElement('style');
  st.textContent = '*,*::before,*::after{animation:none !important;transition:none !important;}';
  document.head.appendChild(st);
});`;

// 移动端控件由 (pointer: coarse) 或 body.is-touch 控制；headless 默认 pointer: fine，
// 用项目自带的 is-touch 类触发，并隐藏只在桌面显示的提示条。
const TOUCH_PRELUDE = `
document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('is-touch');
  const tips = document.getElementById('desktop-tips');
  if (tips) tips.style.display = 'none';
});`;

const SETUP = {
  none: '',
  menuPyramidSoundOff: `
    document.querySelector('.cont-btn[data-cont="pyramid"]').click();
    document.getElementById('btnSound').click();`,
  playCubeNormal: `document.querySelector('#start-card .diff-btn[data-diff="normal"]').click();`,
  playCubeEasy: `document.querySelector('#start-card .diff-btn[data-diff="easy"]').click();`,
  playPyramidNormal: `
    document.querySelector('.cont-btn[data-cont="pyramid"]').click();
    document.querySelector('#start-card .diff-btn[data-diff="normal"]').click();`,
  playPyramidHard: `
    document.querySelector('.cont-btn[data-cont="pyramid"]').click();
    document.querySelector('#start-card .diff-btn[data-diff="hard"]').click();`,
  playRotated: `
    document.querySelector('#start-card .diff-btn[data-diff="easy"]').click();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));`,
  paused: `
    document.querySelector('#start-card .diff-btn[data-diff="easy"]').click();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', bubbles: true }));`,
  // 结束覆盖层：真实触发需要堆叠到顶，不可稳定复现；此处仅注入 UI 状态与固定文本。
  gameOver: `
    document.querySelector('#start-card .diff-btn[data-diff="easy"]').click();
    document.getElementById('overlay').style.display = 'flex';
    document.getElementById('start-card').style.display = 'none';
    document.getElementById('over-card').style.display = 'block';
    document.getElementById('finalScore').textContent = '42';
    document.getElementById('finalTime').textContent = '01:23';`
};

const SCENES = [
  { id: 'V01', name: '桌面 · 开始界面 · 默认（立方体 / 中等 / 音效开）', w: 1280, h: 800, setup: SETUP.none },
  { id: 'V02', name: '桌面 · 开始界面 · 倒金字塔 + 音效关', w: 1280, h: 800, setup: SETUP.menuPyramidSoundOff },
  { id: 'V03', name: '桌面 · 游戏中 · 立方体 · 中等', w: 1280, h: 800, setup: SETUP.playCubeNormal },
  { id: 'V04', name: '桌面 · 游戏中 · 立方体 · 简单（幽灵落点）', w: 1280, h: 800, setup: SETUP.playCubeEasy },
  { id: 'V05', name: '桌面 · 游戏中 · 倒金字塔 · 中等', w: 1280, h: 800, setup: SETUP.playPyramidNormal },
  { id: 'V06', name: '桌面 · 游戏中 · 倒金字塔 · 困难', w: 1280, h: 800, setup: SETUP.playPyramidHard },
  { id: 'V07', name: '桌面 · 游戏中 · 旋转后（Q + W）', w: 1280, h: 800, setup: SETUP.playRotated },
  { id: 'V08', name: '桌面 · 暂停覆盖层', w: 1280, h: 800, setup: SETUP.paused },
  { id: 'V09', name: '桌面 · 结束覆盖层（DOM 注入态）', w: 1280, h: 800, setup: SETUP.gameOver },
  { id: 'V10', name: '移动 · 开始界面 · 默认', w: 390, h: 844, touch: true, setup: SETUP.none },
  { id: 'V11', name: '移动 · 游戏中 · 立方体 · 中等', w: 390, h: 844, touch: true, setup: SETUP.playCubeNormal },
  { id: 'V12', name: '移动 · 游戏中 · 倒金字塔 · 中等', w: 390, h: 844, touch: true, setup: SETUP.playPyramidNormal },
  { id: 'V13', name: '移动 · 暂停覆盖层', w: 390, h: 844, touch: true, setup: SETUP.paused }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 内建静态服务器 ----------
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404); res.end('404'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

// ---------- 极简 CDP 客户端 ----------
class CDP {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (!msg.id || !this.pending.has(msg.id)) return;
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.method || 'cdp'}: ${JSON.stringify(msg.error)}`)) : resolve(msg.result);
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch { /* noop */ } }
}

async function waitCdp() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome CDP 未就绪');
}

async function main() {
  if (!existsSync(CHROME)) throw new Error(`未找到 Chrome: ${CHROME}（可设 CHROME_PATH）`);
  mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

  const profile = path.join(os.tmpdir(), 'tesseract-baseline-' + process.pid);
  mkdirSync(profile, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-extensions',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1280,800',
    'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  const scenes = ONLY ? SCENES.filter((s) => s.id === ONLY) : SCENES;
  if (!scenes.length) throw new Error(`ONLY=${ONLY} 未匹配任何场景`);

  try {
    await waitCdp();
    for (const scene of scenes) {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(BASE)}`, { method: 'PUT' });
      const target = await r.json();
      const cdp = await CDP.connect(target.webSocketDebuggerUrl);
      try {
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: scene.w, height: scene.h, deviceScaleFactor: 1, mobile: false
        });
        await cdp.send('Emulation.setTouchEmulationEnabled', {
          enabled: !!scene.touch, maxTouchPoints: scene.touch ? 5 : 1
        });
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
          source: FREEZE + NO_ANIM + (scene.touch ? TOUCH_PRELUDE : '')
        });
        await cdp.send('Page.navigate', { url: BASE });

        // 等待主 canvas 被 JS 创建（等价于模块已执行到 renderer 初始化）
        await cdp.send('Runtime.evaluate', {
          expression: `new Promise(res => {
            const t = setInterval(() => { if (document.querySelector('canvas')) { clearInterval(t); res(true); } }, 40);
            setTimeout(() => { clearInterval(t); res(false); }, 10000);
          })`,
          awaitPromise: true
        });
        await sleep(900); // 首帧 + 字体/极光稳定

        await cdp.send('Runtime.evaluate', { expression: 'window.__resetRandom && window.__resetRandom();' });
        if (scene.setup) {
          const outcome = await cdp.send('Runtime.evaluate', { expression: scene.setup, returnByValue: true });
          if (outcome.exceptionDetails) throw new Error(`setup 异常: ${JSON.stringify(outcome.exceptionDetails)}`);
        }
        await sleep(700); // setup 后渲染稳定

        const shot = await cdp.send('Page.captureScreenshot', {
          format: 'png', fromSurface: true, captureBeyondViewport: false
        });
        const file = path.join(OUT, `${scene.id}.png`);
        writeFileSync(file, Buffer.from(shot.data, 'base64'));
        console.log(`[${scene.id}] ${scene.w}x${scene.h}  ${scene.name}  ->  ${path.relative(ROOT, file)}`);
      } finally {
        cdp.close();
        try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`); } catch { /* noop */ }
      }
    }
    if (!ONLY) {
      const { createHash } = await import('node:crypto');
      const lines = SCENES.map((s) => {
        const buf = readFileSync(path.join(OUT, `${s.id}.png`));
        return `${createHash('sha256').update(buf).digest('hex')}  ${s.id}.png`;
      });
      writeFileSync(path.join(OUT, 'SHA256SUMS'), lines.join('\n') + '\n');
      console.log(`校验清单: ${path.relative(ROOT, path.join(OUT, 'SHA256SUMS'))}`);
    }
    console.log(`\n完成 ${scenes.length} 张，输出目录: ${OUT}`);
  } finally {
    try { chrome.kill(); } catch { /* noop */ }
    server.close();
  }
}

main().catch((err) => {
  console.error('基线捕获失败:', err);
  server.close();
  process.exit(1);
});
