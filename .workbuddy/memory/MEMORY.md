# TESSERACT 项目笔记

- 性质：浏览器 3D 空间俄罗斯方块（Three.js + 原生 JS 单文件 `index.html`）。
- 仓库：`https://github.com/violawuhoo/TESSERACT`，默认分支 `main`。
- 依赖已本地化至 `vendor/`（`vendor/build/three.module.js` + `vendor/jsm/controls/OrbitControls.js`），离线可跑；运行需经 HTTP 服务器（ES module + importmap，不能用 file://）。
- 介绍/设计文档即仓库 `README.md`。
- 目标：做 iOS App（计划用 Capacitor 套壳），目前仅维护 Web 版源码。
- 认证坑：本机无 GitHub HTTPS 凭据；`~/.ssh/id_ed25519_github` 未被该账户授权，SSH 推送失败。推送需用户提供 PAT 或在本地用其常驻凭证推送。
- 控制方案（2026-10-28 重构）：移动端=相对视角操作——左下十字方向键(↑↓←→)移动、右下「竖转/横翻/侧翻」旋转、单指拖场=转画面、双指=缩放、落底/回正视角键；桌面端=键盘(方向键移动 / QE·WS·AD 三轴旋转 / 空格落底 / C 回正) + 手柄层(Gamepad API：左摇杆=视图相对移动、右摇杆=转画面、A/X/B=竖转/横翻/侧翻、RB=落底、Start=暂停、Back=回正、D-pad=精确移动)。移动端/手柄映射均为视图相对，非绝对世界坐标。
- FakePad 调试开关：`?fakepad=1` 用键盘模拟手柄（WASD=左摇杆、IJKL/方向键=右摇杆、1234=ABXY、Q=RB落底、E=Start暂停、R=Back回正），覆盖 `navigator.getGamepads`；启用时真实键盘 handler 经 `if (FAKEPAD) return;` 完全让位，消除双触发。无 flag 时生产零影响。**注意：FakePad Q 必须映射到按钮索引 5(RB) 才能触发 hardDrop（pollGamepad 的 GP.RB=5，曾误写为 4=LB 导致 Q 不落底，已修）。**
- 反馈/音频升级（2026-11-02）：程序化音效 playRotateSound/playLandSound/playHardDropSound/playComboSound(chain)/playGameOverSound/playUISound（均尊重 soundOn）；落子 scale-pop + 白闪；消行 `pulseBackground` 反应式背景脉动。全部程序化、零外部资源（离线安全）。
- 测试桩：`_test.mjs`（Node，mock THREE/DOM/Gamepad）从 `index.html` 抽取真实 `camBasis/viewMove/viewRotate/pollGamepad/FakePad/真实键盘handler` 实跑断言；两套模式 `?fakepad=1` 与无 flag 各约 55/32 项全绿。仅验证逻辑层，渲染/音频听感/触控/真手柄仍需浏览器人工验证（起 `python3 -m http.server` 后开 localhost）。
