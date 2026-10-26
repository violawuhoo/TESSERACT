# TESSERACT 项目笔记

- 性质：浏览器 3D 空间俄罗斯方块（Three.js + 原生 JS 单文件 `index.html`）。
- 仓库：`https://github.com/violawuhoo/TESSERACT`，默认分支 `main`。
- 依赖已本地化至 `vendor/`（`vendor/build/three.module.js` + `vendor/jsm/controls/OrbitControls.js`），离线可跑；运行需经 HTTP 服务器（ES module + importmap，不能用 file://）。
- 介绍/设计文档即仓库 `README.md`。
- 目标：做 iOS App（计划用 Capacitor 套壳），目前仅维护 Web 版源码。
- 认证坑：本机无 GitHub HTTPS 凭据；`~/.ssh/id_ed25519_github` 未被该账户授权，SSH 推送失败。推送需用户提供 PAT 或在本地用其常驻凭证推送。
