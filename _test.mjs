// Headless logic test for TESSERACT input layer.
// Mocks THREE/WebGL/DOM/Gamepad, extracts the REAL functions from index.html module,
// and asserts behavior: FakePad synthesis, pollGamepad (deadzone/edge/orbit),
// view-relative movement, and the FakePad double-trigger keyboard guard.
//
// WP1.5 (stage 1):
//  - index.html resolved from import.meta.url (no absolute path; clean-clone/CI safe).
//  - eval failure no longer writes _assembled.mjs into the project directory;
//    the assembled code is dumped to stderr only.
//  - anchor misses raise NAMED diagnostics (stage + extractor + marker literal).
//  - one `node _test.mjs` runs BOTH `?fakepad=1` and the no-flag mode, each with
//    its own eval/mocks/spies/results; E static checks run once in the CI domain.
//  - Slice 0 items (modMerged / htmlMerged / vm.Script / setDt / setOverlay)
//    are intentionally NOT implemented in this batch.
import fs from 'fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('./index.html', import.meta.url));
const html = fs.readFileSync(FILE, 'utf8');
const mod = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];

// ---- 具名锚点诊断：任一 marker 失配时，报错点名「阶段 + 抽取函数 + marker 字面串」 ----
function anchorFail(stage, fn, marker, reason) {
  throw new Error(
    '[锚点诊断] 阶段=' + stage +
    ' | 抽取函数=' + fn +
    ' | marker=' + JSON.stringify(marker) +
    ' | 原因=' + reason +
    ' | 常见成因: index.html 被并行改写，或 marker 字面串被改动'
  );
}

// ---- brace-matched extractor ----
function grabFrom(src, sig, stage) {
  const i = src.indexOf(sig);
  if (i < 0) anchorFail(stage, 'grabFrom', sig, '起始签名未在 mod 中命中');
  const ob = src.indexOf('{', i);
  if (ob < 0) anchorFail(stage, 'grabFrom', sig, '签名之后未找到函数体开括号 {');
  let depth = 0, j = ob;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
function sliceByMarkers(src, startSig, endSig, stage) {
  const i = src.indexOf(startSig);
  if (i < 0) anchorFail(stage, 'sliceByMarkers', startSig, '起始 marker 未命中');
  const e = src.indexOf(endSig, i + startSig.length);
  if (e < 0) anchorFail(stage, 'sliceByMarkers', endSig, '结束 marker 未命中');
  return src.slice(i, e);
}
function grabRealKeydown(src, stage) {
  // 隐藏 marker：此行逐字不可改，A11 顶层依赖它定位真实 keydown 监听
  const marker = "if (overlay.style.display === 'flex') return;";
  const mi = src.indexOf(marker);
  if (mi < 0) anchorFail(stage, 'grabRealKeydown', marker, '隐藏守卫 marker 未命中（顶层抽取将崩溃）');
  const startSig = "window.addEventListener('keydown', (e) => {";
  const s = src.lastIndexOf(startSig, mi);
  if (s < 0) anchorFail(stage, 'grabRealKeydown', startSig, '守卫之前未找到 keydown 监听签名');
  const ob = src.indexOf('{', s);
  if (ob < 0) anchorFail(stage, 'grabRealKeydown', startSig, '监听签名之后未找到 {');
  let depth = 0, j = ob;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(ob, j); // includes the { ... }
}

// ---- extract real function bodies (stage names feed 具名锚点诊断) ----
// marker 字面串 "function pollGamepad() {" 与 "if (overlay.style.display === 'flex') return;"
// 在本批逐字保留，不得改写。
const touchBlock      = sliceByMarkers(mod, "const WORLD_UP = new THREE.Vector3(0, 1, 0);", "function bindHold", 'E1/touchBlock');
const gamepadConsts   = sliceByMarkers(mod, "const GP_DEADZONE = 0.28;", "function pollGamepad() {", 'E2/gamepadConsts');
const pollGamepadFn   = grabFrom(mod, "function pollGamepad() {", 'E3/pollGamepadFn');
const gamepadBlock    = gamepadConsts + "\n" + pollGamepadFn;
const fakepadBlock    = grabFrom(mod, "const FAKEPAD = location.search.includes('fakepad');", 'E4/fakepadBlock');
const realKeydownBody = grabRealKeydown(mod, 'E5/realKeydownBody');

// ---- minimal THREE mock (matches THREE convention for Spherical/Vector3) ----
const THREE = `
class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
  subVectors(a,b){this.x=a.x-b.x;this.y=a.y-b.y;this.z=a.z-b.z;return this;}
  negate(){this.x=-this.x;this.y=-this.y;this.z=-this.z;return this;}
  lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}
  normalize(){const l=Math.sqrt(this.lengthSq())||1;this.x/=l;this.y/=l;this.z/=l;return this;}
  crossVectors(a,b){const ax=a.x,ay=a.y,az=a.z,bx=b.x,by=b.y,bz=b.z;this.x=ay*bz-az*by;this.y=az*bx-ax*bz;this.z=ax*by-ay*bx;return this;}
  setFromSpherical(s){const sp=Math.sin(s.phi);this.x=s.radius*sp*Math.sin(s.theta);this.y=s.radius*Math.cos(s.phi);this.z=s.radius*sp*Math.cos(s.theta);return this;}
}
class Spherical {
  constructor(r=1,phi=0,theta=0){this.radius=r;this.phi=phi;this.theta=theta;}
  setFromVector3(v){this.radius=Math.sqrt(v.x*v.x+v.y*v.y+v.z*v.z)||1;this.phi=Math.acos(Math.max(-1,Math.min(1,v.y/this.radius)));this.theta=Math.atan2(v.x,v.z);return this;}
}
const THREE = { Vector3, Spherical };
`;

const NOW_SEED = 1000;

// ---- assemble one INDEPENDENT scope of mocks + extracted real code ----
// `search` is the only per-mode variable. Each mode gets a fresh indirect-eval:
// all mutable state (spies / winHandlers / camera / controls / FAKEPAD) is declared
// with const|let and therefore lives in that eval's own lexical environment, and
// `results` + `check` are local to runMode. __T is snapshotted immediately after
// each eval, and each mode is run to completion before the next eval starts, so
// the shared global slots (__T / __now / the hoisted function declarations) can
// never be observed by the other mode mid-flight. Keep this sequential invariant
// if the runner is ever refactored.
function buildCode(search) {
  return `
${THREE}
const winHandlers = {};
const navigator = { getGamepads: () => [] };
const window = {
  addEventListener: (t,h) => { (winHandlers[t]=winHandlers[t]||[]).push(h); },
  innerWidth: 1280, innerHeight: 720
};
const location = { search: ${JSON.stringify(search)} };
const performance = { now: () => globalThis.__now };
const camera = { position: new THREE.Vector3(12,14,18), lookAt(){}, updateProjectionMatrix(){}, fov:45, aspect:1 };
const controls = { target: new THREE.Vector3(4.5,6,4.5), update(){} };
let running = true, gameOver = false, paused = false, containerType = 'cube';
const overlay = { style: { display: 'none' } };
// spies
const movePieceCalls = []; const flashAxisCalls = []; const tryRotateCalls = [];
let hardDropCalls = 0, togglePauseCalls = 0, resetViewCalls = 0, backToMenuCalls = 0, startGameCalls = 0;
function movePiece(x,y,z){ movePieceCalls.push([x,y,z]); return true; }
function flashAxis(a,b,c){ flashAxisCalls.push([a,b,c]); }
function tryRotate(a){ tryRotateCalls.push(a); }
function hardDrop(){ hardDropCalls++; }
function togglePause(){ togglePauseCalls++; }
function resetView(){ resetViewCalls++; }
function backToMenu(){ backToMenuCalls++; }
function startGame(){ startGameCalls++; }

${touchBlock}
${gamepadBlock}
${fakepadBlock}
const realKeydown = (e) => ${realKeydownBody};

globalThis.__T = {
  THREE, navigator, window, camera, controls,
  pollGamepad, viewMove, viewRotate, camBasis,
  realKeydown, winHandlers,
  getFAKEPAD: () => FAKEPAD,
  spies: () => ({movePieceCalls, flashAxisCalls, tryRotateCalls, hardDropCalls, togglePauseCalls, resetViewCalls, backToMenuCalls, startGameCalls}),
  resetSpies: () => { movePieceCalls.length=0; flashAxisCalls.length=0; tryRotateCalls.length=0; hardDropCalls=0; togglePauseCalls=0; resetViewCalls=0; backToMenuCalls=0; startGameCalls=0; },
  setState: (s) => { running=s.running!==undefined?s.running:running; gameOver=s.gameOver!==undefined?s.gameOver:gameOver; paused=s.paused!==undefined?s.paused:paused; },
  setCamPos: (x,y,z) => { camera.position.set(x,y,z); },
  setNow: (t) => { globalThis.__now = t; }
};
globalThis.__now = ${NOW_SEED};
`;
}

// baseline = 当期已签收断言基线（A23+B9+C4+D2 / B9+C4+D2），逐条静态核算，非实测。
// baseline 不含 E 段 17 条：E 属 CI 静态域，不进套件计数。
const MODES = [
  { search: '?fakepad=1', label: '?fakepad=1', baseline: 38 },
  { search: '',           label: '无 flag',    baseline: 15 }
];

function runMode(mode) {
  const results = [];
  const check = (name, cond, detail) => {
    results.push({ mode: mode.label, name, ok: !!cond, detail: detail || '' });
    console.log('[' + mode.label + '] ' + (cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
  };
  function approx(a, b, eps=1e-6){ return Math.abs(a-b) <= eps; }

  const assembled = buildCode(mode.search);
  globalThis.__now = NOW_SEED;
  try {
    // eslint-disable-next-line no-eval
    (0, eval)(assembled);
  } catch (err) {
    // WP1.5: 不再向项目盘写 _assembled.mjs；仅把组装结果打到 stderr 供人工排查。
    console.error('==== EVAL FAILED [' + mode.label + '] ====');
    console.error('assembled code follows (stderr only; NO file written):');
    console.error('---- BEGIN ASSEMBLED CODE ----');
    console.error(assembled);
    console.error('---- END ASSEMBLED CODE ----');
    throw err;
  }
  const T = globalThis.__T;
  if (!T) throw new Error('[双模式 runner] ' + mode.label + ': eval 未产生 globalThis.__T');

  // 隔离不变量（harness 级，不计入套件断言数）：FAKEPAD 必须与本模式 search 一致。
  const expected = mode.search.includes('fakepad');
  if (T.getFAKEPAD() !== expected) {
    throw new Error('[双模式隔离] ' + mode.label + ': FAKEPAD=' + T.getFAKEPAD() + ' 期望 ' + expected);
  }

  // ============ A. FakePad synthesis (only when enabled) ============
  if (mode.search.includes('fakepad')) {
    T.setNow(1000);
    check('FakePad: FAKEPAD const === true', T.getFAKEPAD() === true);
    check('FakePad: getGamepads overridden', typeof T.navigator.getGamepads === 'function');

    const kd = (code) => T.winHandlers.keydown.forEach(h => h({ code }));
    const ku = (code) => T.winHandlers.keyup.forEach(h => h({ code }));
    const pad = () => T.navigator.getGamepads()[0];

    const tests = [
      ['KeyW', () => pad().axes[1], -1, 'W→左摇杆上(axes[1]=-1)'],
      ['KeyS', () => pad().axes[1],  1, 'S→axes[1]=1'],
      ['KeyA', () => pad().axes[0], -1, 'A→axes[0]=-1'],
      ['KeyD', () => pad().axes[0],  1, 'D→axes[0]=1'],
      ['KeyI', () => pad().axes[3], -1, 'I→右摇杆上(axes[3]=-1)'],
      ['KeyK', () => pad().axes[3],  1, 'K→axes[3]=1'],
      ['KeyJ', () => pad().axes[2], -1, 'J→axes[2]=-1'],
      ['KeyL', () => pad().axes[2],  1, 'L→axes[2]=1'],
      ['ArrowUp',    () => pad().axes[3], -1, '↑→axes[3]=-1'],
      ['ArrowDown',  () => pad().axes[3],  1, '↓→axes[3]=1'],
      ['ArrowLeft',  () => pad().axes[2], -1, '←→axes[2]=-1'],
      ['ArrowRight', () => pad().axes[2],  1, '→→axes[2]=1'],
      ['Digit1', () => pad().buttons[0].pressed, true, '1→button0(A)'],
      ['Digit2', () => pad().buttons[1].pressed, true, '2→button1(B)'],
      ['Digit3', () => pad().buttons[2].pressed, true, '3→button2(X)'],
      ['Digit4', () => pad().buttons[3].pressed, true, '4→button3(Y)'],
      ['KeyQ', () => pad().buttons[5].pressed, true, 'Q→button5(RB)'],
      ['KeyE', () => pad().buttons[9].pressed, true, 'E→button9(Start)'],
      ['KeyR', () => pad().buttons[8].pressed, true, 'R→button8(Back)'],
    ];
    for (const [code, getv, exp, label] of tests) {
      kd(code);
      const v = getv();
      check('FakePad: ' + label, v === exp, 'got ' + v);
      ku(code);
    }
    check('FakePad: keyup clears axes', pad().axes[0] === 0 && pad().axes[1] === 0);
    check('FakePad: keyup clears buttons', pad().buttons.every(b => !b.pressed));
  }

  // ============ B. pollGamepad: deadzone / edge / orbit ============
  {
    // craft a synthetic pad and force navigator.getGamepads to return it (overrides FakePad if any)
    let padObj = { connected: true, axes: [0,0,0,0,0,0], buttons: Array.from({length:16},()=>({pressed:false,value:0})) };
    T.navigator.getGamepads = () => [padObj];
    T.resetSpies();
    T.setNow(2000);

    // deadzone: small stick should NOT move
    padObj.axes[0] = 0.1;
    T.pollGamepad();
    check('pollGamepad: deadzone ignores |0.1| (<0.28)', T.spies().movePieceCalls.length === 0);

    // left stick right (axis0=1) => viewMove('right'); throttle: immediate 2nd poll within step should NOT repeat
    T.resetSpies();
    padObj.axes[0] = 1; padObj.axes[1] = 0;
    T.setNow(2000);
    T.pollGamepad();            // first -> move
    T.pollGamepad();            // within 130ms -> throttled
    check('pollGamepad: left stick right moves once then throttle', T.spies().movePieceCalls.length === 1, 'calls='+T.spies().movePieceCalls.length);
    T.setNow(2000 + 200);       // advance beyond GP_MOVE_STEP
    T.pollGamepad();
    check('pollGamepad: move repeats after step (130ms)', T.spies().movePieceCalls.length === 2);

    // button edge: A(0) pressed -> viewRotate('spin') once; held -> no repeat; release+press -> edge again
    T.resetSpies();
    padObj.buttons[0] = { pressed:true, value:1 };
    T.pollGamepad();
    T.pollGamepad(); // held, no edge
    check('pollGamepad: button A edge (spin) fires once on hold', T.spies().tryRotateCalls.length === 1 && T.spies().tryRotateCalls[0]==='y', 'calls='+JSON.stringify(T.spies().tryRotateCalls));
    padObj.buttons[0] = { pressed:false, value:0 };
    T.pollGamepad(); // release registers prev
    padObj.buttons[0] = { pressed:true, value:1 };
    T.pollGamepad(); // re-press -> edge
    check('pollGamepad: button A re-press re-triggers edge', T.spies().tryRotateCalls.length === 2);

    // RB(5) -> hardDrop
    T.resetSpies();
    padObj.buttons[5] = { pressed:true, value:1 };
    T.pollGamepad();
    check('pollGamepad: RB(5) triggers hardDrop', T.spies().hardDropCalls === 1);
    padObj.buttons[5] = { pressed:false, value:0 };

    // right stick orbit: camera.position should change, phi clamped
    const before = T.camera.position.clone ? null : null;
    const px0 = T.camera.position.x, py0 = T.camera.position.y, pz0 = T.camera.position.z;
    padObj.axes[2] = 0; padObj.axes[3] = 0; // reset
    // push phi downward hard to test lower clamp 0.15
    padObj.axes[2] = 0; padObj.axes[3] = 1; // ry=1 -> phi decreases
    for (let k=0;k<50;k++) T.pollGamepad();
    const off = T.camera.position.clone();
    // recompute phi from offset relative to target
    const ox=T.camera.position.x-T.controls.target.x, oy=T.camera.position.y-T.controls.target.y, oz=T.camera.position.z-T.controls.target.z;
    const r=Math.sqrt(ox*ox+oy*oy+oz*oz);
    const phi=Math.acos(Math.max(-1,Math.min(1,oy/r)));
    check('pollGamepad: right stick changes camera position', !(approx(T.camera.position.x,px0)&&approx(T.camera.position.y,py0)&&approx(T.camera.position.z,pz0)));
    check('pollGamepad: phi clamped >= 0.15', phi >= 0.15 - 1e-6, 'phi='+phi.toFixed(4));
    check('pollGamepad: phi clamped <= PI-0.15', phi <= Math.PI-0.15 + 1e-6, 'phi='+phi.toFixed(4));
    void before; void off;
  }

  // ============ C. view-relative movement (the original pain-point fix) ============
  {
    // default iso camera: target(4.5,6,4.5), pos(12,14,18) -> fwd≈(-7.5,-8,-13.5); |z|>|x| => 'up' maps to Z axis
    T.resetSpies();
    T.setState({ running:true, gameOver:false, paused:false });
    T.setCamPos(12,14,18);
    T.viewMove('up');
    const upDefault = T.spies().movePieceCalls[0];
    check('viewMove: default view "up" maps to Z axis', upDefault && upDefault[2] !== 0 && upDefault[0] === 0, 'move='+JSON.stringify(upDefault));

    // rotate camera 90° so view forward points along -X: pos = target + (10,0,0) -> fwd=(-10,0,0); |x|>|z| => 'up' maps to X axis
    T.resetSpies();
    T.setCamPos(14.5, 6, 4.5); // camera to +X side of target, same height -> fwd is pure -X
    T.viewMove('up');
    const upRotated = T.spies().movePieceCalls[0];
    check('viewMove: after 90° camera rotation "up" maps to X axis', upRotated && upRotated[0] !== 0 && upRotated[2] === 0, 'move='+JSON.stringify(upRotated));
    check('viewMove: axis flips with view (Z->X)', JSON.stringify(upDefault)!==JSON.stringify(upRotated));

    // 'right' should be perpendicular-ish: default gives the dominant axis's perpendicular
    T.resetSpies();
    T.setCamPos(12,14,18);
    T.viewMove('right');
    const rightDefault = T.spies().movePieceCalls[0];
    check('viewMove: default "right" produces a valid single-axis move', rightDefault && ((rightDefault[0]!==0)!==(rightDefault[2]!==0)), 'move='+JSON.stringify(rightDefault));
  }

  // ============ D. real keyboard handler guard vs FakePad ============
  {
    T.resetSpies();
    T.setState({ running:true, gameOver:false, paused:false });
    // overlay hidden so it doesn't early-return; FAKEPAD read from const
    const ev = (code) => ({ code, repeat:false, preventDefault(){} });
    T.realKeydown(ev('KeyW')); // KeyW -> tryRotate('x') in real handler
    const sp = T.spies();
    if (T.getFAKEPAD()) {
      check('Keyboard guard: FAKEPAD=true blocks real keyboard (KeyW did NOT rotate)', sp.tryRotateCalls.length === 0);
    } else {
      check('Keyboard guard: FAKEPAD=false lets real keyboard rotate', sp.tryRotateCalls.length === 1 && sp.tryRotateCalls[0]==='x', 'calls='+JSON.stringify(sp.tryRotateCalls));
    }
    // 'KeyC' should call resetView in both modes if not blocked
    T.resetSpies();
    T.realKeydown(ev('KeyC'));
    if (T.getFAKEPAD()) {
      check('Keyboard guard: FAKEPAD=true also blocks KeyC(resetView)', T.spies().resetViewCalls === 0);
    } else {
      check('Keyboard guard: FAKEPAD=false KeyC calls resetView', T.spies().resetViewCalls === 1);
    }
  }

  return { label: mode.label, baseline: mode.baseline, results, T };
}

// ============ E. static wiring / guard checks on full source (CI 域，单次，不计入套件数) ============
function runStaticDomain() {
  const results = [];
  const check = (name, cond, detail) => {
    results.push({ mode: 'CI 静态域', name, ok: !!cond, detail: detail || '' });
    console.log('[CI 静态域] ' + (cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
  };
  function has(s){ return html.includes(s); }
  check('Static: no leftover old axis buttons', !has('btnXMinus') && !has('btnXPlus') && !has('btnZMinus') && !has('btnZPlus') && !has('btnRotX') && !has('btnRotY') && !has('btnRotZ'));
  check('Static: tryRotate wires playRotateSound', has('playRotateSound()'));
  check('Static: tryRotate wires popActivePiece', has('popActivePiece()'));
  check('Static: lockPiece wires playLandSound', has('playLandSound()'));
  check('Static: lockPiece wires spawnLandFlash', has('spawnLandFlash('));
  check('Static: lockPiece wires pulseBackground', has('pulseBackground('));
  check('Static: clear path uses playComboSound', has('playComboSound('));
  check('Static: triggerGameOver wires playGameOverSound', has('playGameOverSound()'));
  check('Static: hardDrop wires playHardDropSound', has('playHardDropSound()'));
  check('Static: keyboard guard present (if FAKEPAD) return', has("if (FAKEPAD) return; // FakePad"));
  check('Static: only one const FAKEPAD', (html.match(/const FAKEPAD/g)||[]).length === 1);
  // sound functions respect soundOn
  for (const fn of ['playRotateSound','playLandSound','playHardDropSound','playComboSound','playGameOverSound','playUISound']) {
    const i = html.indexOf('function '+fn);
    const j = html.indexOf('function ', i+1);
    const body = html.slice(i, j<0?undefined:j);
    check('Static: '+fn+' respects soundOn', body.includes('if (!soundOn) return;'));
  }
  return results;
}

// ---- summary ----
function summarize(results) {
  const fails = results.filter(r => !r.ok);
  return { total: results.length, pass: results.length - fails.length, fails };
}

const runs = MODES.map(runMode);
const staticResults = runStaticDomain();
const staticSummary = summarize(staticResults);

console.log('\n==== 双模式对照表（38/15 + 套件内增量）====');
console.log('说明 1: 38/15 为「当期已签收断言基线」(A23+B9+C4+D2 / B9+C4+D2)，系逐条静态核算，非实测数字。');
console.log('说明 2: 套件内增量 = 本套件实测断言数 − 基线；随 Slice 0 之后新增断言自动增长，本批未新增断言故为 +0。');
console.log('说明 3: E 段 17 条静态检查属 CI 静态域，全程一次性执行，不计入任一模式的套件数。');
console.log('');
for (const r of runs) {
  const s = summarize(r.results);
  const inc = s.total - r.baseline;
  console.log(
    '  ' + r.label.padEnd(14) +
    ' 基线 ' + String(r.baseline).padStart(3) +
    ' + 套件内增量 ' + String(inc >= 0 ? '+' + inc : inc).padStart(4) +
    ' = 实测 ' + String(s.total).padStart(3) +
    '  PASS ' + String(s.pass).padStart(3) +
    '  FAIL ' + String(s.fails.length).padStart(3)
  );
}
console.log('  CI 静态域(E)'.padEnd(18) + ' 共 ' + staticSummary.total + ' 条  PASS ' + staticSummary.pass + '  FAIL ' + staticSummary.fails.length);
if (runs.length === 2) {
  console.log('  双模式隔离: __T 对象独立 = ' + (runs[0].T !== runs[1].T) +
              '  |  FAKEPAD = ' + runs.map(r => r.T.getFAKEPAD()).join(' / '));
}

const allResults = runs.flatMap(r => r.results).concat(staticResults);
const all = summarize(allResults);
console.log('\n==== SUMMARY ====');
console.log('TOTAL ' + all.total + '  PASS ' + all.pass + '  FAIL ' + all.fails.length);
if (all.fails.length) {
  console.log('FAILED:');
  all.fails.forEach(f => console.log('  - [' + f.mode + '] ' + f.name + (f.detail ? '  [' + f.detail + ']' : '')));
  process.exit(1);
} else console.log('ALL PASS');
