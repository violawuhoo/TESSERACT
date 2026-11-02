// Headless logic test for TESSERACT input layer.
// Mocks THREE/WebGL/DOM/Gamepad, extracts the REAL functions from index.html module,
// and asserts behavior: FakePad synthesis, pollGamepad (deadzone/edge/orbit),
// view-relative movement, and the FakePad double-trigger keyboard guard.
import fs from 'fs';

const FILE = 'C:/Users/E14/WorkBuddy/TESSERACT/index.html';
const SEARCH = process.argv[2] || '';
const html = fs.readFileSync(FILE, 'utf8');
const mod = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];

// ---- brace-matched extractor ----
function grabFrom(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) throw new Error('NOT FOUND: ' + sig);
  const ob = src.indexOf('{', i);
  let depth = 0, j = ob;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
function sliceByMarkers(src, startSig, endSig) {
  const i = src.indexOf(startSig);
  if (i < 0) throw new Error('start not found: ' + startSig);
  const e = src.indexOf(endSig, i + startSig.length);
  if (e < 0) throw new Error('end not found: ' + endSig);
  return src.slice(i, e);
}
function grabRealKeydown(src) {
  const marker = "if (overlay.style.display === 'flex') return;";
  const mi = src.indexOf(marker);
  if (mi < 0) throw new Error('real keydown marker not found');
  const s = src.lastIndexOf("window.addEventListener('keydown', (e) => {", mi);
  const ob = src.indexOf('{', s);
  let depth = 0, j = ob;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(ob, j); // includes the { ... }
}
// ---- extract real function bodies ----
const touchBlock = sliceByMarkers(mod, "const WORLD_UP = new THREE.Vector3(0, 1, 0);", "function bindHold");
const gamepadConsts = sliceByMarkers(mod, "const GP_DEADZONE = 0.28;", "function pollGamepad() {");
const pollGamepadFn = grabFrom(mod, "function pollGamepad() {");
const gamepadBlock = gamepadConsts + "\n" + pollGamepadFn;
const fakepadBlock = grabFrom(mod, "const FAKEPAD = location.search.includes('fakepad');");
const realKeydownBody = grabRealKeydown(mod);

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

// ---- assemble a scope with mocks + extracted real code ----
let nowMs = 1000;
const code = `
${THREE}
const winHandlers = {};
const navigator = { getGamepads: () => [] };
const window = {
  addEventListener: (t,h) => { (winHandlers[t]=winHandlers[t]||[]).push(h); },
  innerWidth: 1280, innerHeight: 720
};
const location = { search: ${JSON.stringify(SEARCH)} };
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
globalThis.__now = ${nowMs};
`;

globalThis.__now = nowMs;
try {
  // eslint-disable-next-line no-eval
  (0, eval)(code);
} catch (err) {
  fs.writeFileSync('C:/Users/E14/WorkBuddy/TESSERACT/_assembled.mjs', code);
  console.error('EVAL FAILED; wrote _assembled.mjs for inspection');
  throw err;
}
const T = globalThis.__T;

// ---- tiny assert framework ----
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
}
function approx(a, b, eps=1e-6){ return Math.abs(a-b) <= eps; }

// ============ A. FakePad synthesis (only when enabled) ============
if (SEARCH.includes('fakepad')) {
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
  void before;
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

// ============ E. static wiring / guard checks on full source ============
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

// ---- summary ----
const fails = results.filter(r => !r.ok);
console.log('\n==== SUMMARY ====');
console.log('TOTAL ' + results.length + '  PASS ' + (results.length-fails.length) + '  FAIL ' + fails.length);
if (fails.length) { console.log('FAILED:'); fails.forEach(f => console.log('  - ' + f.name + (f.detail?'  ['+f.detail+']':''))); process.exit(1); }
else console.log('ALL PASS');
