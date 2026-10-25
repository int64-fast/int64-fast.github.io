'use strict';
/* 在 Node 中用 DOM/WebGL stub 运行 world.js，捕获几何构建与逐帧更新中的运行时错误。 */
const assert = require('assert');

function noop() {}
function makeContext() {
  const target = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    globalAlpha: 1,
    canvas: null,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    beginPath: noop,
    closePath: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    moveTo: noop,
    lineTo: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    fillText: noop,
    strokeText: noop,
    measureText: function (t) { return { width: (t || '').length * 10 }; },
    createLinearGradient: function () { return { addColorStop: noop }; },
    createRadialGradient: function () { return { addColorStop: noop }; },
    drawImage: noop,
    getImageData: function () { return { data: new Uint8ClampedArray(4) }; },
    putImageData: noop,
    setLineDash: noop
  };
  return new Proxy(target, {
    get(obj, key) {
      if (key in obj) return obj[key];
      return noop;
    },
    set(obj, key, value) { obj[key] = value; return true; }
  });
}

const canvasProto = {
  width: 512,
  height: 256,
  style: {},
  getContext: function () { return makeContext(); },
  addEventListener: noop,
  removeEventListener: noop,
  setPointerCapture: noop,
  releasePointerCapture: noop
};

function makeCanvas(w, h) {
  return Object.assign(Object.create(canvasProto), { width: w || 512, height: h || 256 });
}

global.document = {
  createElement: function (tag) {
    if (tag === 'canvas') return makeCanvas();
    return { style: {}, appendChild: noop, classList: { add: noop, remove: noop, toggle: noop } };
  },
  createElementNS: function () { return makeCanvas(); },
  getElementById: function () { return null; },
  querySelectorAll: function () { return []; },
  addEventListener: noop,
  body: { appendChild: noop }
};
global.window = {
  devicePixelRatio: 1,
  innerWidth: 1440,
  innerHeight: 900,
  addEventListener: noop,
  removeEventListener: noop,
  location: { search: '' },
  performance: { now: function () { return Date.now(); } }
};
global.self = global.window;
global.performance = global.window.performance;
global.requestAnimationFrame = function () { return 1; };
global.cancelAnimationFrame = noop;

const THREE = require('../vendor/three.min.js');
global.THREE = THREE;
window.THREE = THREE;

// 替换 WebGLRenderer（无真实 GL 上下文）
class FakeRenderer {
  constructor() {
    this.capabilities = { getMaxAnisotropy: function () { return 4; } };
    this.shadowMap = { enabled: false, type: 0 };
    this.domElement = makeCanvas();
    this.outputEncoding = 0;
    this.toneMapping = 0;
    this.toneMappingExposure = 1;
  }
  setPixelRatio() {}
  setSize() {}
  render() {}
  dispose() {}
}
THREE.WebGLRenderer = FakeRenderer;

global.Line1Core = require('../js/core.js');
window.Line1Core = global.Line1Core;
require('../js/world.js');

const C = global.Line1Core;
const W = global.window.BJWorld;
assert(W && typeof W.createWorld === 'function', 'BJWorld missing');

console.log('\nWorld smoke test');
const world = W.createWorld(makeCanvas(), {});
assert(world.scene, 'scene missing');
assert(world.camera, 'camera missing');
assert(world.stationGroups.length === 35, 'station groups=' + world.stationGroups.length);

// 侧式站台站牌必须挂在两侧站台，不得悬在轨道正上方
const sideLats = [];
world.stationGroups[22].traverse(o => {
  if (o.userData && o.userData.signLat != null) sideLats.push(o.userData.signLat);
});
assert(sideLats.length > 0, 'side platform signs missing');
assert(sideLats.every(v => Math.abs(v) >= 8), 'side platform sign over track: ' + sideLats.join(','));
assert(sideLats.includes(-10) && sideLats.includes(10), 'side platform signs missing both canopies');
const islandLats = [];
world.stationGroups[2].traverse(o => {
  if (o.userData && o.userData.signLat != null) islandLats.push(o.userData.signLat);
});
assert(islandLats.includes(0), 'island platform sign missing center position');
console.log('  ✓ platform sign placement');

// 西端侧式站台：古城、八角游乐园取消中央岛式站台，改为轨道居中、两侧各一座站台
{
  assert(C.STATION_BY_NAME['古城'].platform === 'side', '古城 should be side platform');
  assert(C.STATION_BY_NAME['八角游乐园'].platform === 'side', '八角游乐园 should be side platform');
  assert(world.stationGroups[0].userData.platformLayout === 'side', '古城 layout');
  assert(world.stationGroups[1].userData.platformLayout === 'side', '八角游乐园 layout');
  assert(world.stationGroups[2].userData.platformLayout === 'island', '八宝山 must stay island');
  assert.deepStrictEqual(world.stationGroups[0].userData.platformEdgeLats.slice().sort(),
    [-7.66, 7.66], 'side platform edges should sit on both sides of the track');
  assert.deepStrictEqual(world.stationGroups[0].userData.platformEdgeLats,
    [-7.66, 7.66], 'side platform edges order');
  console.log('  ✓ western side platforms (Gucheng / Bajiao)');

  // 地下侧式站台的隧道侧墙必须在站台范围断开，否则会从站台中间穿过去
  const tunnelWalls = [];
  world.scene.traverse(o => {
    if (o.userData && o.userData.tunnelWallRange) tunnelWalls.push(o.userData.tunnelWallRange);
  });
  assert(tunnelWalls.length >= 2, 'tunnel wall metadata missing');
  ['古城', '八角游乐园'].forEach(name => {
    const st = C.STATION_BY_NAME[name];
    const a = st.s - st.platformLength / 2;
    const b = st.s + st.platformLength / 2;
    tunnelWalls.forEach(r => {
      assert(r[1] <= a + 1e-6 || r[0] >= b - 1e-6,
        'tunnel wall crosses side platform at ' + name + ': ' + r.join('–'));
    });
  });
  console.log('  ✓ tunnel walls break out around side platforms');
}

// 花庄南侧上下行左右互换：两条正线在区间内交叉，交叉后贴到对侧
{
  const xo = world.crossover;
  const hz = C.STATION_BY_NAME['花庄'];
  assert(xo && xo.len >= 120, 'crossover geometry missing');
  assert(xo.s0 > hz.s + hz.platformLength / 2, 'crossover must start south of Huazhuang platform');
  assert(xo.s1 < C.STATION_BY_NAME['环球度假区'].s, 'crossover must end before Universal Resort');
  const mid = (xo.s0 + xo.s1) / 2;
  assert(Math.abs(world.trackLateralAt(1, xo.s0 - 5) - 5.5) < 1e-6, 'up track before crossover');
  assert(Math.abs(world.trackLateralAt(-1, xo.s0 - 5) + 5.5) < 1e-6, 'down track before crossover');
  assert(Math.abs(world.trackLateralAt(1, xo.s1 + 5) + 5.5) < 1e-6, 'up track after crossover');
  assert(Math.abs(world.trackLateralAt(-1, xo.s1 + 5) - 5.5) < 1e-6, 'down track after crossover');
  assert(Math.abs(world.trackLateralAt(1, mid)) < 1e-6, 'tracks must cross at the midpoint');
  assert(Math.abs(world.trackLateralAt(-1, mid)) < 1e-6, 'both tracks meet at the X');
  assert(Math.abs(world.trackLateralAt(1, C.LINE.lengthM) + 5.5) < 1e-6, 'swap persists to the terminus');
  // 交叉区间应连续：相邻采样点位移不超过 0.5 m，避免轨道折线
  let prev = world.trackLateralAt(1, xo.s0);
  for (let s = xo.s0; s <= xo.s1; s += 2) {
    const cur = world.trackLateralAt(1, s);
    assert(Math.abs(cur - prev) < 0.5, 'crossover discontinuity at ' + s);
    prev = cur;
  }
  console.log('  ✓ Huazhuang crossover (s=' + xo.s0.toFixed(0) + '→' + xo.s1.toFixed(0) + ')');
}

// 配线（纯装饰）：车辆段出入线、折返线、联络线
{
  const yards = world.getYardInfo();
  if (process.env.YARD_DUMP) {
    yards.forEach(y => console.log('    ' + y.name + ' s=' + y.s0 + '→' + y.s1 +
      ' lat=' + y.lat0.toFixed(2) + '→' + y.lat1.toFixed(2) + ' len=' + y.length));
  }
  assert(yards.length >= 15, 'yard tracks missing: ' + yards.length);
  const byName = {};
  yards.forEach(y => { byName[y.name] = y; });
  const near = (a, b) => Math.abs(a - b) < 1.5;

  // 玉泉路联络线：八宝山—玉泉路 之间中央单线，两端横向居中
  const link = byName['玉泉路联络线'];
  assert(link, '玉泉路联络线 missing');
  assert(near(link.lat0, 0) && near(link.lat1, 0), 'link must run on the centre line');
  const bsS = C.STATION_BY_NAME['八宝山'].s;
  const yqS = C.STATION_BY_NAME['玉泉路'].s;
  assert(link.s0 >= bsS && link.s1 <= yqS, 'link must stay between 八宝山 and 玉泉路');
  ['八宝山上行引入', '八宝山下行引入', '玉泉路上行引出', '玉泉路下行引出'].forEach(n => {
    const lead = byName[n];
    assert(lead, n + ' missing');
    const lats = [Math.abs(lead.lat0), Math.abs(lead.lat1)].sort();
    assert(Math.abs(lats[0]) < 1e-6 && Math.abs(lats[1] - 5.5) < 1e-6,
      n + ' must connect the centre link to a main track (lat ' + lead.lat0 + '→' + lead.lat1 + ')');
  });
  console.log('  ✓ Yuyuanquan connection line');

  // 公主坟站后折返线：站西交叉渡线 + 中央折返线
  const gz = C.STATION_BY_NAME['公主坟'];
  const gzEnd = gz.s - gz.platformLength / 2;
  const xa = byName['公主坟交叉渡线A'];
  const xb = byName['公主坟交叉渡线B'];
  assert(xa && xb && byName['公主坟折返线'], 'Gongzhufen yard tracks missing');
  assert(Math.abs(xa.lat0) === 5.5 && Math.abs(xa.lat1) === 5.5, 'crossover A must join both mains');
  assert(xa.s1 <= gzEnd, 'Gongzhufen crossover must stay west of the platform');
  assert(Math.abs(xa.lat0 - 5.5) < 1e-6 && Math.abs(xa.lat1 + 5.5) < 1e-6, 'crossover A must swap the mains');
  assert(Math.abs(xb.lat0 + 5.5) < 1e-6 && Math.abs(xb.lat1 - 5.5) < 1e-6, 'crossover B must swap back');
  assert(Math.abs(byName['公主坟折返线'].s1 - (xa.s0 + xa.s1) / 2) < 3,
    'reversing siding must end at the X centre: siding=' + byName['公主坟折返线'].s1 +
    ' x=' + (xa.s0 + xa.s1) / 2);
  console.log('  ✓ Gongzhufen reversing siding');

  // 环球度假区站后掉头线
  const u = C.STATION_BY_NAME['环球度假区'];
  const uEnd = u.s + u.platformLength / 2;
  const turn = byName['环球掉头线'];
  assert(turn && byName['环球交叉渡线A'] && byName['环球交叉渡线B'], 'Universal turnback missing');
  assert(turn.s0 > uEnd, 'turnback must start beyond the Universal platform');
  assert(turn.s1 <= C.LINE.lengthM + 180, 'turnback must stay inside the line');
  assert(near(turn.lat0, 0) && near(turn.lat1, 0), 'turnback must run on the centre line');
  console.log('  ✓ Universal Resort turnback');

  // 土桥车辆段：上下行出入段线 + 联络线 + 地面车库
  const tq = C.STATION_BY_NAME['土桥'];
  const inLead = byName['土桥入段线'];
  const outLead = byName['土桥出段线'];
  assert(inLead && outLead, 'Tuqiao depot leads missing');
  assert(Math.abs(inLead.lat0) === 5.5 && inLead.lat1 > 30, 'inbound lead must leave the main for the depot');
  assert(Math.abs(outLead.lat1) === 5.5 && outLead.lat0 > 25, 'outbound lead must join the main from the depot');
  assert(inLead.s0 > tq.s && outLead.s1 > tq.s, 'Tuqiao leads must stay east of the platform');
  assert(byName['土桥上下行联络线'] && byName['土桥出段联络线'], 'Tuqiao crossovers missing');
  console.log('  ✓ Tuqiao depot leads');

  // 古城车辆段：站西洞室与三条停车线；隧道必须为洞室让出空间
  const cave = byName['古城车辆段1道'];
  assert(cave && byName['古城车辆段入段线'] && byName['古城车辆段3道'], 'Gucheng depot missing');
  assert(cave.s1 < C.STATION_BY_NAME['古城'].s - 75, 'Gucheng depot stabling must stay west of the platform');
  const walls2 = [];
  world.scene.traverse(o => {
    if (o.userData && o.userData.tunnelWallRange) walls2.push(o.userData.tunnelWallRange);
  });
  walls2.forEach(r => {
    assert(r[1] <= 5952 + 1e-6 || r[0] >= 6098 - 1e-6,
      'tunnel wall crosses Gucheng depot cavern: ' + r.join('–'));
  });
  console.log('  ✓ Gucheng depot cavern');

  // 所有配线都不得压在运营站台上（站台外缘 ±7.66，留出余量）
  yards.forEach(y => {
    C.STATIONS.forEach(st => {
      const a = st.s - st.platformLength / 2;
      const b = st.s + st.platformLength / 2;
      if (Math.min(y.s1, b) <= Math.max(y.s0, a)) return;
      const latMin = Math.min(y.lat0, y.lat1);
      const latMax = Math.max(y.lat0, y.lat1);
      assert(latMin > 7.8 || latMax < -7.8,
        'yard ' + y.name + ' overlaps platform of ' + st.name + ' (lat ' + latMin + '..' + latMax + ')');
    });
  });
  console.log('  ✓ yard tracks clear of platforms');

  // 复杂枢纽：复兴门/南礼士路、东单/建国门、四惠/四惠东、八角游乐园
  {
    const need = (n) => { assert(byName[n], 'missing hub track: ' + n); return byName[n]; };
    const S = C.STATION_BY_NAME;
    const fxX = need('复兴门东交叉渡线A');
    assert(fxX.lat0 > 5.4 && fxX.lat1 < -5.4, 'Fuxingmen crossover should swap up/down');
    assert(need('复兴门东交叉渡线B').lat0 < -5.4, 'Fuxingmen crossover B should mirror');
    assert(fxX.s0 > S['复兴门'].s, 'Fuxingmen crossover should be east of the station');
    const l2a = need('复兴门2号线联络线（上行）');
    const l2b = need('复兴门2号线联络线（下行）');
    assert(l2a.lat0 > 5.4 && l2a.lat1 > 9.0, 'Line 2 link (up) should leave the up track for the south wall');
    assert(l2b.lat0 < -5.4 && l2b.lat1 > 9.0, 'Line 2 link (down) should leave the down track for the south wall');
    const ddX = need('东单西交叉渡线A');
    assert(ddX.lat0 > 5.4 && ddX.lat1 < -5.4, 'Dongdan crossover should swap up/down');
    assert(ddX.s1 < S['东单'].s - 100, 'Dongdan crossover should sit west of the station');
    assert(need('东单北京站方向联络线').lat1 > 9.0, 'Beijingzhan link should reach the south wall');
    ['四惠西单渡线', '四惠东单渡线'].forEach(function (n) {
      const y = need(n);
      assert(Math.abs(y.lat0) > 5.4 && Math.abs(y.lat1) > 5.4 && y.lat0 * y.lat1 < 0, n + ' should be a single crossover');
    });
    let group = 0;
    yards.forEach(function (y) { if (/四惠东贯通道岔/.test(y.name)) group++; });
    assert(group === 4, 'Sihui-dong through-running switch group should have 4 switches, got ' + group);
    const p101 = need('八角游乐园101线预留线');
    assert(p101.s0 > S['八角游乐园'].s + 150, 'Line 101 branch should be east of the station');
    assert(p101.lat0 > 5.4 && p101.lat1 > 9.0, 'Line 101 branch should leave the running line toward the south wall');
  }
  console.log('  ✓ complex junction trackwork (4 hubs)');
}

const service = C.makeService('am', 'large', 1);
const sim = new C.Simulator(service, { ato: true });
sim.requestDeparture();
let tick = 0;
for (let i = 0; i < 220; i++) {
  sim.update(0.05);
  world.update(sim, 0.016, { mode: 'cab', yaw: 0, pitch: 0 });
  tick++;
}
console.log('  ✓ cab view frames:', tick);

// 检查外观视角
world.toggleCameraMode();
for (let i = 0; i < 60; i++) {
  sim.update(0.05);
  world.update(sim, 0.016, { mode: 'external', yaw: 0, pitch: 0 });
}
console.log('  ✓ external view frames');

// 外观视角轨道控制：旋转 / 缩放 / 复位
const orbitBase = world.getOrbit();
{
  const pos0 = world.camera.position.clone();
  assert(world.orbitRotate(120, 60), 'orbitRotate should work in external mode');
  for (let i = 0; i < 45; i++) {
    sim.update(0.05);
    world.update(sim, 0.016, { mode: 'external' });
  }
  const posR = world.camera.position.clone();
  assert(posR.distanceTo(pos0) > 1.0, 'orbit rotate should move the camera');

  assert(world.orbitZoomBy(0.5), 'orbitZoomBy should work in external mode');
  for (let i = 0; i < 90; i++) {
    sim.update(0.05);
    world.update(sim, 0.016, { mode: 'external' });
  }
  const posZ = world.camera.position.clone();
  assert(posZ.distanceTo(posR) > 1.0, 'orbit zoom should move the camera');
  const lookMid = world.getState().externalLook;
  assert(Math.abs(posZ.distanceTo(lookMid) - 13.2) < 3.0, 'zoomed distance=' + posZ.distanceTo(lookMid).toFixed(2));

  world.resetOrbit();
  for (let i = 0; i < 90; i++) {
    sim.update(0.05);
    world.update(sim, 0.016, { mode: 'external' });
  }
  const orbitBack = world.getOrbit();
  assert(Math.abs(orbitBack.yaw - orbitBase.yaw) < 1e-6, 'reset yaw');
  assert(Math.abs(orbitBack.pitch - orbitBase.pitch) < 1e-6, 'reset pitch');
  assert(Math.abs(orbitBack.zoom - orbitBase.zoom) < 1e-6, 'reset zoom');
  const dDefault = world.camera.position.distanceTo(world.getState().externalLook);
  assert(dDefault <= 26.4 + 0.01 && dDefault > 6, 'default distance=' + dDefault.toFixed(2));

  // 驾驶室视角下轨道接口不生效
  world.toggleCameraMode();
  assert(world.orbitRotate(50, 50) === false, 'orbitRotate must be disabled in cab mode');
  assert(world.orbitZoomBy(0.5) === false, 'orbitZoomBy must be disabled in cab mode');
  world.toggleCameraMode();
}
// 临时调试：Shift+滚轮调节车顶终点站牌 offset
{
  const o0 = world.getDestBoardOffset();
  assert(typeof o0 === 'number', 'dest board offset should be a number');
  world.nudgeDestBoard(0.05);
  assert(Math.abs(world.getDestBoardOffset() - (o0 + 0.05)) < 1e-9, 'dest board nudge forward');
  world.nudgeDestBoard(-0.10);
  assert(Math.abs(world.getDestBoardOffset() - (o0 - 0.05)) < 1e-9, 'dest board nudge backward');
  world.nudgeDestBoard(0.05);
  console.log('  ✓ dest board offset nudge, offset=' + world.getDestBoardOffset().toFixed(2));
}

console.log('  ✓ external orbit rotate / zoom / reset');

// 外观机位不得穿进隧道侧墙或顶板：绕轴一圈都应留在断面内
{
  const st = world.getState();
  sim.dir = 1;
  sim.v = 0;
  sim.s = 8000; // 地下区间
  let worstLat = 0;
  let worstUp = 0;
  for (let i = 0; i < 12; i++) {
    st.orbitYaw = -Math.PI + (i / 11) * Math.PI * 2;
    st.orbitPitch = i % 2 ? 1.1 : -0.3;
    for (let k = 0; k < 24; k++) world.update(sim, 0.05, { mode: 'external' });
    const p = world.camera.position;
    const base = C.ROUTE.point(sim.s, 0, 0);
    const lat = (p.x - base.x) * base.rx + (p.z - base.z) * base.rz;
    const up = p.y - base.y;
    worstLat = Math.max(worstLat, Math.abs(lat));
    worstUp = Math.max(worstUp, up);
    assert(Math.abs(lat) <= 9.31, 'camera lateral=' + lat.toFixed(2) + ' at yaw ' + i);
    assert(up >= 0.54 && up <= 5.51, 'camera height=' + up.toFixed(2) + ' at yaw ' + i);
  }
  world.resetOrbit();
  console.log('  ✓ tunnel camera stays inside corridor (max |lat|=' + worstLat.toFixed(2) +
    ', max up=' + worstUp.toFixed(2) + ')');
}

// 外观视角旋转中心应贴在车头
{
  const st = world.getState();
  sim.dir = 1;
  sim.v = 0;
  sim.s = 8000;
  st.orbitYaw = 0;
  st.orbitPitch = 0.13;
  for (let k = 0; k < 40; k++) world.update(sim, 0.05, { mode: 'external' });
  const head = C.ROUTE.point(sim.s, st.visualLateral, 2.10);
  const look = world.getState().externalLook;
  assert(Math.abs(look.x - head.x) < 0.05 && Math.abs(look.z - head.z) < 0.05,
    'orbit pivot should sit at the train head');
  console.log('  ✓ orbit pivot at train head');
}

// 在所有车站位置渲染一帧，覆盖地下/地面/高架以及岛式/侧式站台
let stationFrames = 0;
for (const st of C.STATIONS) {
  sim.s = st.s;
  sim.v = 0;
  sim.atStation = { stopIdx: 0, stop: { index: st.index, s: st.s, name: st.name }, since: 0, terminal: false };
  sim.nextStopIdx = 0;
  sim.leaderState = { active: false };
  world.update(sim, 0.016, { mode: 'cab', yaw: 0, pitch: 0 });
  stationFrames++;
}
console.log('  ✓ station frames:', stationFrames);

// 全部区段可视
let segFrames = 0;
for (let s = 0; s <= C.LINE.lengthM; s += 9000) {
  sim.s = s;
  sim.atStation = null;
  sim.nextStopIdx = Math.min(1, service.stops.length - 1);
  world.update(sim, 0.016, { mode: 'cab', yaw: 0.2, pitch: -0.1 });
  segFrames++;
}
console.log('  ✓ segment frames:', segFrames);

// 西行（反向）驾驶室与外观
const westService = C.makeService('am', 'large', -1);
const westSim = new C.Simulator(westService, { ato: false });
westSim.s = westService.stops[0].s;
world.update(westSim, 0.016, { mode: 'cab', yaw: 0, pitch: 0 });
world.toggleCameraMode();
for (let i = 0; i < 30; i++) {
  westSim.update(0.03);
  world.update(westSim, 0.016, { mode: 'external', yaw: 0, pitch: 0 });
}
console.log('  ✓ westbound frames');

console.log('  ✓ world smoke test passed.');
