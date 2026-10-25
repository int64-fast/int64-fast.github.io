'use strict';
const assert = require('assert');
const Core = require('../js/core.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    console.error('  ✗ ' + name);
    console.error(err && err.stack || err);
    process.exitCode = 1;
  }
}

console.log('\n线路与车辆数据');
test('35 座车站，贯通线路 54.47 km，首末站正确', () => {
  assert.strictEqual(Core.STATIONS.length, 35);
  assert.strictEqual(Core.STATIONS[0].name, '古城');
  assert.strictEqual(Core.STATIONS[34].name, '环球度假区');
  assert.strictEqual(Core.STATIONS[34].km, 48.294);
  assert.strictEqual(Core.LINE.lengthKm, 54.47);
  assert.strictEqual(Core.LINE.stationSpanKm, 48.294);
  assert.strictEqual(Core.LINE.stationOffsetM, 6176);
  assert.strictEqual(Core.STATIONS[0].s, 6176);
  assert.strictEqual(Core.STATIONS[34].s, 54470);
  assert.strictEqual(Core.LINE.stationCount, 35);
});
test('车站站间距采用官方里程（南礼士路—复兴门 424m）', () => {
  const st = name => Core.STATION_BY_NAME[name];
  const d = (a, b) => Math.round((st(b).km - st(a).km) * 1000);
  assert.strictEqual(d('南礼士路', '复兴门'), 424);
  assert.strictEqual(d('复兴门', '西单'), 1590);
  assert.strictEqual(d('西单', '天安门西'), 1217);
  assert.strictEqual(d('国贸', '大望路'), 1385);
  assert.strictEqual(d('土桥', '花庄'), 2238);
  assert.strictEqual(d('花庄', '环球度假区'), 1863);
  assert.strictEqual(d('古城', '八角游乐园'), 1921);
});
test('换乘站数据标记完整', () => {
  assert.deepStrictEqual(Core.STATION_BY_NAME['复兴门'].transfer.slice(), ['2']);
  assert.deepStrictEqual(Core.STATION_BY_NAME['西单'].transfer.slice(), ['4']);
  assert.deepStrictEqual(Core.STATION_BY_NAME['东单'].transfer.slice(), ['5']);
  assert.deepStrictEqual(Core.STATION_BY_NAME['建国门'].transfer.slice(), ['2']);
  assert.deepStrictEqual(Core.STATION_BY_NAME['国贸'].transfer.slice(), ['10']);
  assert.deepStrictEqual(Core.STATION_BY_NAME['花庄'].transfer.slice(), ['7']);
  assert.strictEqual(Core.STATION_BY_NAME['复兴门'].isTransfer, true);
  assert.strictEqual(Core.STATION_BY_NAME['南礼士路'].isTransfer, false);
});
test('车站里程严格递增', () => {
  for (let i = 1; i < Core.STATIONS.length; i++) {
    assert(Core.STATIONS[i].km > Core.STATIONS[i - 1].km);
  }
});
test('线路环境阈值与官方站里程对齐', () => {
  const at = name => Core.STATION_BY_NAME[name];
  assert.strictEqual(Core.ROUTE.envAt(at('四惠').s), 'underground');
  assert.strictEqual(Core.ROUTE.envAt(at('四惠东').s), 'ground');
  assert.strictEqual(Core.ROUTE.envAt(at('高碑店').s), 'elevated');
  assert.strictEqual(Core.ROUTE.envAt(at('土桥').s), 'elevated');
  assert.strictEqual(Core.ROUTE.envAt(at('花庄').s), 'underground');
  assert.strictEqual(Core.ROUTE.envAt(at('环球度假区').s), 'underground');
});
test('DKZ4 关键参数硬编码', () => {
  const v = Core.VEHICLE;
  assert.strictEqual(v.maxSpeedKph, 80);
  assert.strictEqual(v.operatingSpeedKph, 70);
  assert.strictEqual(v.startAccel, 0.83);
  assert.strictEqual(v.serviceDecel, 0.94);
  assert.strictEqual(v.emergencyDecel, 1.19);
  assert.strictEqual(v.powerNotches, 4);
  assert.strictEqual(v.brakeNotches, 7);
  assert.strictEqual(v.consistCars, 6);
  assert.strictEqual(v.carLength, 19);
  assert.strictEqual(v.doorsPerCar, 4);
});

console.log('\n运行图与交路');
test('工作日早高峰行车间隔 1分45秒', () => {
  assert.strictEqual(Core.PERIODS.am.headway, 105);
  assert.strictEqual(Core.PERIODS.am.headwayText, '1分45秒');
});
test('工作日晚高峰行车间隔 2分20秒', () => {
  assert.strictEqual(Core.PERIODS.pm.headway, 140);
  assert.strictEqual(Core.PERIODS.pm.headwayText, '2分20秒');
});
test('早高峰小交路为果园 ↔ 公主坟', () => {
  const east = Core.makeService('am', 'small', 1);
  assert.strictEqual(east.originName, '公主坟');
  assert.strictEqual(east.terminalName, '果园');
  const west = Core.makeService('am', 'small', -1);
  assert.strictEqual(west.originName, '果园');
  assert.strictEqual(west.terminalName, '公主坟');
});
test('晚高峰小交路为古城 ↔ 果园', () => {
  const east = Core.makeService('pm', 'small', 1);
  assert.strictEqual(east.originName, '古城');
  assert.strictEqual(east.terminalName, '果园');
  const west = Core.makeService('pm', 'small', -1);
  assert.strictEqual(west.originName, '果园');
  assert.strictEqual(west.terminalName, '古城');
});
test('大交路为古城 ↔ 环球度假区，共 35 站', () => {
  const east = Core.makeService('am', 'large', 1);
  assert.strictEqual(east.originName, '古城');
  assert.strictEqual(east.terminalName, '环球度假区');
  assert.strictEqual(east.stops.length, 35);
  const west = Core.makeService('am', 'large', -1);
  assert.strictEqual(west.originName, '环球度假区');
  assert.strictEqual(west.terminalName, '古城');
});
test('大交路全程运行时间 85 分钟（5100 秒）', () => {
  const east = Core.makeService('am', 'large', 1);
  assert(Math.abs(east.schedule.duration - 5100) < 0.01,
    'east duration=' + east.schedule.duration);
  const west = Core.makeService('pm', 'large', -1);
  assert(Math.abs(west.schedule.duration - 5100) < 0.01,
    'west duration=' + west.schedule.duration);
});
test('时刻表到发时刻单调递增', () => {
  const svc = Core.makeService('am', 'large', 1);
  let last = -1;
  svc.schedule.entries.forEach(e => {
    assert(e.arr >= last - 1e-6, 'arr must be monotonic');
    assert(e.dep >= e.arr - 1e-6, 'dep >= arr');
    last = e.dep;
  });
});

console.log('\nATP 曲线');
test('允许速度曲线随目标距离单调递增', () => {
  let last = -1;
  for (let d = 0; d <= 1200; d += 10) {
    const v = Core.atpCurveSpeedKph(d, 0.85, 1.0);
    assert(v >= last - 1e-9);
    last = v;
  }
});
test('目标距离为 0 时允许速度接近 0', () => {
  const v = Core.atpCurveSpeedKph(0, 0.85, 0);
  assert.strictEqual(v, 0);
});
test('70 km/h 常用制动距离约 200m', () => {
  const d = Core.brakingDistanceM(70, 0.94);
  assert(d > 180 && d < 230, 'distance=' + d);
});
test('停车误差分级：±0.5m / ±1m', () => {
  assert.strictEqual(Core.classifyStopError(0.2).level, 'precise');
  assert.strictEqual(Core.classifyStopError(-0.49).level, 'precise');
  assert.strictEqual(Core.classifyStopError(0.7).level, 'inaccurate');
  assert.strictEqual(Core.classifyStopError(-1.0).level, 'inaccurate');
  assert.strictEqual(Core.classifyStopError(1.2).label, '冲标');
  assert.strictEqual(Core.classifyStopError(-1.2).label, '欠标');
});

console.log('\n虚拟前车');
test('前车按行车间隔提前运行且位置在前方', () => {
  const svc = Core.makeService('am', 'large', 1);
  const ghost = new Core.LeaderGhost(svc, svc.headway);
  const st = ghost.getState(0);
  assert(st.active);
  assert(st.s > svc.stops[0].s, 'leader s=' + st.s);
  assert(st.s < svc.stops[1].s);
  assert(st.speed > 0);
});
test('前车会停站并动态移动', () => {
  const svc = Core.makeService('am', 'large', 1);
  const ghost = new Core.LeaderGhost(svc, svc.headway);
  const a = ghost.getState(0);
  const b = ghost.getState(15);
  assert(Math.abs(b.s - a.s) > 1);
  const atDwell = ghost.getState(svc.schedule.entries[1].arr - svc.headway + 2);
  assert(atDwell.active);
  assert.strictEqual(Math.round(atDwell.s), Math.round(svc.stops[1].s));
  assert.strictEqual(atDwell.speed, 0);
});
test('后车按本车位置历史延迟一个行车间隔跟随', () => {
  const svc = Core.makeService('am', 'large', 1);
  const sim = new Core.Simulator(svc, { ato: true });
  const initial = sim.getStatus();
  assert(initial.followerActive);
  assert(initial.followerGap >= 20);
  const initialS = initial.followerS;
  sim.requestDeparture();
  for (let t = 0; t < 60; t += 0.05) sim.update(0.05);
  const after = sim.getStatus();
  assert(after.followerActive);
  assert(after.followerGap > initial.followerGap, 'follower gap should grow while player departs');
  assert(after.followerS < sim.s - Core.VEHICLE.consistLength, 'follower must remain behind player rear');
  for (let t = 0; t < 80; t += 0.05) sim.update(0.05);
  const later = sim.getStatus();
  assert(later.followerS > initialS, 'follower should start moving after one headway');
});
test('对向列车以相同行车间隔反向运行', () => {
  const svc = Core.makeService('am', 'large', 1);
  const sim = new Core.Simulator(svc, { ato: false });
  const a = sim.getStatus();
  assert(a.opposingActive, 'opposing train not active at start');
  assert.strictEqual(sim.opposingService.dir, -1);
  const s0 = a.opposingS;
  for (let t = 0; t < 6; t += 0.05) sim.update(0.05);
  const b = sim.getStatus();
  assert(b.opposingActive);
  assert(b.opposingS < s0, 'westbound opposing train should move toward lower chainage');
});

console.log('\n动力学与 ATO');
function runSim(sim, seconds, cb) {
  const dt = 0.02;
  for (let t = 0; t < seconds; t += dt) {
    if (cb) cb(t);
    sim.update(dt);
    if (sim.completed) break;
  }
}
test('人工牵引可以起动，ATP 允许速度有限制', () => {
  const svc = Core.makeService('am', 'large', 1);
  const sim = new Core.Simulator(svc, { ato: false });
  sim.setHandle(4);
  runSim(sim, 8);
  assert(sim.v > 2, 'v=' + sim.v);
  const atp = sim.getAtpStatus();
  assert(atp.vPermKph <= 70);
  assert(sim.s > svc.stops[0].s);
});
test('常用制动可使列车停车', () => {
  const svc = Core.makeService('am', 'large', 1);
  const sim = new Core.Simulator(svc, { ato: false });
  sim.setHandle(4);
  runSim(sim, 8);
  sim.setHandle(-7);
  runSim(sim, 20);
  assert(sim.v < 0.05, 'v=' + sim.v);
});
test('ATO 可以自动运行至下一站并精确停车', () => {
  const svc = Core.makeService('am', 'large', 1);
  const sim = new Core.Simulator(svc, { ato: true });
  const initialStatus = sim.getStatus();
  assert.strictEqual(initialStatus.nextStopIdx, 1);
  assert.strictEqual(initialStatus.atStationStopIdx, 0);
  assert.strictEqual(initialStatus.atStation, true);
  assert(sim.requestDeparture());
  let elapsed = 0;
  const dt = 0.02;
  while (elapsed < 420) {
    sim.update(dt);
    elapsed += dt;
    if (sim.atStation || sim.terminalArrived) break;
  }
  assert(sim.atStation, 'ATO did not stop at next station');
  const st = sim.atStation.stop;
  assert.strictEqual(st.name, '八角游乐园');
  const err = Math.abs((sim.s - st.s) * sim.dir);
  assert(err <= 1.0, 'ATO stop error=' + err.toFixed(2) + 'm');
  assert.strictEqual(sim.stats.ebCount, 0, 'ATO triggered EB');
});
test('车门未关闭时牵引被封锁', () => {
  const svc = Core.makeService('am', 'large', 1);
  const sim = new Core.Simulator(svc, { ato: false });
  sim.doors = 'open';
  sim.setHandle(4);
  assert.strictEqual(sim.notch, 0);
  sim.update(0.02);
  assert.strictEqual(sim.notch, 0);
  assert.strictEqual(sim.stats.doorViolations, 1);
});
test('停稳后才能开门，开门后不能牵引', () => {
  const svc = Core.makeService('am', 'large', 1);
  const sim = new Core.Simulator(svc, { ato: false });
  sim.s = svc.stops[0].s + 0.2;
  sim.v = 0;
  assert(sim.requestDoorToggle());
  runSim(sim, 2.1);
  assert.strictEqual(sim.doors, 'open');
  sim.setHandle(2);
  assert.strictEqual(sim.notch, 0);
});
test('EB 施加后停稳可复位，未停稳不可复位', () => {
  const svc = Core.makeService('am', 'large', 1);
  const sim = new Core.Simulator(svc, { ato: false });
  sim.setHandle(4);
  runSim(sim, 6);
  sim.emergencyBrake('测试');
  assert(sim.eb);
  assert.strictEqual(sim.resetEB(), false);
  runSim(sim, 12);
  assert(sim.v < 0.05);
  assert.strictEqual(sim.resetEB(), true);
  assert(!sim.eb);
});
test('超速会触发 ATP 紧急制动', () => {
  const svc = Core.makeService('am', 'large', 1);
  const sim = new Core.Simulator(svc, { ato: false });
  sim.v = 21;
  sim.s = svc.stops[0].s + 300;
  sim.nextStopIdx = 1;
  sim.atStation = null;
  for (let i = 0; i < 80; i++) sim.update(0.02);
  assert(sim.stats.ebCount >= 1, 'EB not triggered');
  assert(sim.eb);
});
test('人工模式持续超速：报警→EB→完全停稳→面板复位后才可牵引', () => {
  const svc = Core.makeService('am', 'large', 1);
  const sim = new Core.Simulator(svc, { ato: false });
  sim.s = 15000;
  sim.v = 0;
  sim.atStation = null;
  sim.nextStopIdx = svc.stops.findIndex(st => st.s > 24000);
  sim.leader.getState = () => ({ active: false, s: 0, speed: 0, phase: 'run' });
  sim.recomputeAtp();
  sim.setHandle(4);
  let t = 0;
  let warned = false;
  while (t < 120 && !sim.eb) {
    sim.update(0.02);
    if (sim.warning) warned = true;
    t += 0.02;
  }
  assert(warned, 'ATP overspeed warning not raised');
  assert(sim.eb, 'EB not triggered by sustained overspeed');
  assert(/超速/.test(sim.ebReason), 'unexpected EB reason: ' + sim.ebReason);
  assert.strictEqual(sim.resetEB(), false, 'EB reset must fail while moving');
  assert.strictEqual(sim.setHandle(4), undefined);
  assert.strictEqual(sim.notch, 0, 'handle must stay locked during EB');
  let t2 = 0;
  while (t2 < 30 && !sim.ebReadyToReset) {
    sim.update(0.02);
    t2 += 0.02;
  }
  assert.strictEqual(sim.v, 0, 'train did not fully stop');
  assert(sim.ebReadyToReset, 'EB reset not enabled after stop');
  assert.strictEqual(sim.resetEB(), true);
  assert.strictEqual(sim.eb, false);
  assert.strictEqual(sim.notch, 0);
  sim.setHandle(4);
  assert.strictEqual(sim.notch, 4, 'traction should be available after reset');
});
test('无视前车距离逼近会触发追踪 EB', () => {
  const svc = Core.makeService('am', 'large', 1);
  const sim = new Core.Simulator(svc, { ato: false });
  sim.s = 15000;
  sim.v = 3 / 3.6;
  sim.atStation = null;
  sim.nextStopIdx = svc.stops.findIndex(st => st.s > 30000);
  sim.leader.getState = () => ({
    active: true,
    s: sim.s + 8 + Core.VEHICLE.consistLength,
    speed: 0,
    phase: 'dwell'
  });
  sim.recomputeAtp();
  sim.update(0.02);
  assert(sim.eb, 'following-distance EB not triggered');
  assert(/追踪/.test(sim.ebReason), 'unexpected reason: ' + sim.ebReason);
  assert(sim.stats.ebCount >= 1);
});
test('停车精度记录正确', () => {
  const svc = Core.makeService('am', 'large', 1);
  const sim = new Core.Simulator(svc, { ato: false });
  const target = svc.stops[1];
  sim.nextStopIdx = 1;
  sim.atStation = null;
  sim.s = target.s + 0.7;
  sim.v = 0;
  sim.arriveAtStation(target);
  sim.evaluateStop(target);
  const rec = sim.stopRecords.find(r => r.stationIndex === target.index);
  assert(rec);
  assert.strictEqual(rec.label, '停车不准');
  assert.strictEqual(Math.round(rec.points), 65);
});
test('小交路终点折返后方向与终点更新', () => {
  const svc = Core.makeService('am', 'small', 1);
  const sim = new Core.Simulator(svc, { ato: true });
  const terminal = svc.terminal;
  sim.s = terminal.s;
  sim.nextStopIdx = svc.stops.length - 1;
  sim.atStation = { stopIdx: svc.stops.length - 1, stop: svc.stops[svc.stops.length - 1], since: 0, terminal: true };
  sim.terminalArrived = true;
  sim.v = 0;
  assert(sim.reverseAtTerminal());
  assert.strictEqual(sim.service.originName, '果园');
  assert.strictEqual(sim.service.terminalName, '公主坟');
  assert.strictEqual(sim.dir, -1);
});

console.log('\n评分');
test('评分包含停车、安全、准点、操作四项', () => {
  const svc = Core.makeService('am', 'large', 1);
  const sim = new Core.Simulator(svc, { ato: true });
  const s = sim.getScore();
  for (const k of ['parking', 'safety', 'punctuality', 'operation', 'total', 'grade']) {
    assert(k in s, 'missing ' + k);
  }
  assert(s.total >= 0 && s.total <= 100);
});

test('ATO 全程 35 站运行：无 EB、无超速、停车全部达标', () => {
  const svc = Core.makeService('am', 'large', 1);
  const sim = new Core.Simulator(svc, { ato: true });
  sim.requestDeparture();
  const dt = 0.05;
  let t = 0;
  let opened = false;
  let closing = false;
  let departRequested = false;
  let lastAt = null;
  for (; t < 6500; t += dt) {
    sim.update(dt);
    if (sim.completed) break;
    if (!sim.atStation) {
      opened = closing = departRequested = false;
      lastAt = null;
    } else if (lastAt !== sim.atStation.stop.name) {
      opened = closing = departRequested = false;
      lastAt = sim.atStation.stop.name;
    }
    if (sim.atStation && !sim.terminalArrived) {
      const entry = sim.getScheduleEntry(sim.atStation.stopIdx);
      if (sim.doors === 'closed' && !opened) {
        sim.requestDoorToggle();
        opened = true;
      } else if (sim.doors === 'open' && !closing && sim.tripTime + 3 >= entry.dep) {
        sim.requestDoorToggle();
        closing = true;
      } else if (closing && sim.doors === 'closed' && !departRequested) {
        sim.requestDeparture();
        departRequested = true;
      }
    }
    if (sim.atStation && sim.terminalArrived) break;
  }
  assert(sim.terminalArrived, 'terminal not reached');
  assert.strictEqual(sim.atStation.stop.name, '环球度假区');
  sim.evaluateStop(sim.atStation.stop);
  assert(t > 5000 && t < 5200, 'full run duration=' + t);
  assert.strictEqual(sim.stats.ebCount, 0);
  assert.strictEqual(sim.stats.overspeedEvents, 0);
  assert.strictEqual(sim.stats.missedStops, 0);
  const records = sim.stopRecords.filter(r => !r.excluded);
  assert.strictEqual(records.length, 34);
  records.forEach(r => assert(r.absError <= 1.0, r.name + ' error=' + r.absError));
  sim.arrivalDeviations.forEach((dev, i) => {
    assert(dev >= -5.0, 'scheduled arrival #' + (i + 1) + ' early by ' + dev.toFixed(2) + 's');
  });
  const score = sim.getScore();
  assert(score.total >= 95, 'score=' + score.total);
  assert(score.safety === 100, 'safety=' + score.safety);
});

test('ATO 提前发车时按图降速：任何车站都不会提前超过 5 秒', () => {
  const svc = Core.makeService('am', 'large', 1);
  const sim = new Core.Simulator(svc, { ato: true });
  sim.requestDeparture();
  const dt = 0.025;
  let t = 0;
  let opened = false;
  let closing = false;
  let departRequested = false;
  let lastAt = null;
  let sawScheduleLimit = false;
  while (t < 1600 && sim.arrivalDeviations.length < 6) {
    sim.update(dt);
    t += dt;
    if (sim.atoScheduleLimited) sawScheduleLimit = true;
    if (!sim.atStation) {
      opened = closing = departRequested = false;
      lastAt = null;
    } else if (lastAt !== sim.atStation.stop.name) {
      opened = closing = departRequested = false;
      lastAt = sim.atStation.stop.name;
    }
    if (sim.atStation && !sim.terminalArrived) {
      // 故意不等计划停站时间，开门后立刻关门发车，制造大幅早点趋势
      if (sim.doors === 'closed' && !opened) {
        sim.requestDoorToggle();
        opened = true;
      } else if (sim.doors === 'open' && sim.dwellSeconds > 2.05 && !closing) {
        sim.requestDoorToggle();
        closing = true;
      } else if (closing && sim.doors === 'closed' && !departRequested) {
        sim.requestDeparture();
        departRequested = true;
      }
    }
  }
  assert(sim.arrivalDeviations.length >= 6, 'not enough arrivals: ' + sim.arrivalDeviations.length);
  assert(sawScheduleLimit, 'ATO schedule cap was never engaged');
  sim.arrivalDeviations.forEach((dev, i) => {
    assert(dev >= -5.0, 'arrival #' + (i + 1) + ' was ' + dev.toFixed(2) + 's early');
  });
  assert.strictEqual(sim.stats.ebCount, 0);
  assert.strictEqual(sim.stats.overspeedEvents, 0);
});

console.log('\n' + passed + ' tests passed.');
