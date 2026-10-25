/* ==========================================================================
   北京地铁 1号线 / 八通线贯通运营 · DKZ4 驾驶模拟
   core.js — 线路数据、时刻表、CBTC/ATP、车辆动力学、车门联锁、评分
   纯 JavaScript，无外部依赖；浏览器与 Node.js 均可运行。
   ========================================================================== */
(function (global) {
  'use strict';

  const KM = 1000;
  const G = 9.80665;

  /* ------------------------------------------------------------------------
     1. 线路数据（全部硬编码）
     ------------------------------------------------------------------------ */
  const LINE = Object.freeze({
    name: '北京地铁1号线/八通线贯通运营',
    shortName: '1号线 / 八通线',
    lengthKm: 54.47,
    lengthM: 54470,
    // 官方站间距表：古城—环球度假区乘客站间里程合计 48.294 km。
    // 54.47 km 为贯通运营线路长度；世界坐标保留 6.176 km 西端里程差。
    stationSpanKm: 48.294,
    stationSpanM: 48294,
    stationOffsetM: 6176,
    totalTimeMin: 85,
    totalTimeSec: 5100,
    stationCount: 35,
    firstStation: '古城',
    lastStation: '环球度假区',
    signalling: 'CBTC 移动闭塞 · 卡斯柯 Urbalis 888',
    gradeOfAutomation: 'GoA 2（ATP 监督下的人工驾驶 / ATO）',
    power: 'DC 750V 第三轨 · 上接触式集电靴',
    depot: '古城车辆段 / 土桥车辆段'
  });

  // [中文名, 英文名, 自古城起的累计站间里程 km, 车站编号, 站台形式, 环境, 大站, 换乘线路]
  // 站间距依据北京市轨道交通运营管理有限公司路网车站站间距信息及 2014 年北京地铁里程表。
  const STATION_SEED = [
    // 西端三站（苹果园、古城、八角游乐园）为侧式站台；本模拟自古城起，苹果园未纳入线路。
    ['古城', 'Gucheng', 0.000, '101', 'side', 'underground', false, []],
    ['八角游乐园', 'Bajiao Amusement Park', 1.921, '102', 'side', 'underground', false, []],
    ['八宝山', 'Babaoshan', 3.874, '103', 'island', 'underground', false, []],
    ['玉泉路', 'Yuquanlu', 5.353, '104', 'island', 'underground', false, []],
    ['五棵松', 'Wukesong', 7.163, '105', 'island', 'underground', false, []],
    ['万寿路', 'Wanshoulu', 8.941, '106', 'island', 'underground', false, []],
    ['公主坟', 'Gongzhufen', 10.254, '107', 'island', 'underground', true, ['10']],
    ['军事博物馆', 'Military Museum', 11.426, '108', 'island', 'underground', true, ['9']],
    ['木樨地', 'Muxidi', 12.592, '109', 'island', 'underground', false, ['16']],
    ['南礼士路', 'Nanlishilu', 13.883, '110', 'island', 'underground', false, []],
    ['复兴门', 'Fuxingmen', 14.307, '111', 'island', 'underground', true, ['2']],
    ['西单', 'Xidan', 15.897, '112', 'island', 'underground', true, ['4']],
    ['天安门西', "Tian'anmen West", 17.114, '113', 'island', 'underground', true, []],
    ['天安门东', "Tian'anmen East", 18.039, '114', 'island', 'underground', true, []],
    ['王府井', 'Wangfujing', 18.891, '115', 'island', 'underground', true, ['8']],
    ['东单', 'Dongdan', 19.665, '116', 'island', 'underground', true, ['5']],
    ['建国门', 'Jianguomen', 20.895, '117', 'island', 'underground', true, ['2']],
    ['永安里', "Yong'anli", 22.272, '118', 'island', 'underground', false, []],
    ['国贸', 'Guomao', 23.062, '119', 'island', 'underground', true, ['10']],
    ['大望路', 'Dawanglu', 24.447, '120', 'island', 'underground', true, ['14']],
    ['四惠', 'Sihui', 26.120, '121', 'island', 'underground', true, []],
    ['四惠东', 'Sihui East', 27.834, '122', 'island_side', 'ground', true, []],
    ['高碑店', 'Gaobeidian', 29.209, 'BT01', 'side', 'elevated', false, []],
    ['传媒大学', 'Communication University of China', 31.211, 'BT02', 'side', 'elevated', false, []],
    ['双桥', 'Shuangqiao', 33.105, 'BT03', 'side', 'elevated', false, []],
    ['管庄', 'Guanzhuang', 35.017, 'BT04', 'side', 'elevated', false, []],
    ['八里桥', 'Baliqiao', 36.780, 'BT05', 'side', 'elevated', false, []],
    ['通州北苑', 'Tongzhou Beiyuan', 38.480, 'BT06', 'side', 'elevated', true, []],
    ['果园', 'Guoyuan', 39.945, 'BT07', 'side', 'elevated', true, []],
    ['九棵树', 'Jiukeshu', 40.935, 'BT08', 'side', 'elevated', false, []],
    ['梨园', 'Liyuan', 42.160, 'BT09', 'side', 'elevated', false, []],
    ['临河里', 'Linheli', 43.417, 'BT10', 'side', 'elevated', false, []],
    ['土桥', 'Tuqiao', 44.193, 'BT11', 'side', 'ground', true, []],
    ['花庄', 'Huazhuang', 46.431, 'BT12', 'island', 'underground', true, ['7']],
    ['环球度假区', 'Universal Resort', 48.294, 'BT13', 'island', 'underground', true, ['7']]
  ];

  const STATIONS = STATION_SEED.map(function (row, i) {
    const transfer = Object.freeze((row[7] || []).slice());
    const station = {
      index: i,
      name: row[0],
      en: row[1],
      km: row[2],
      s: row[2] * KM + LINE.stationOffsetM,
      code: row[3],
      platform: row[4],
      env: row[5],
      major: !!(row[6] || transfer.length),
      transfer: transfer,
      isTransfer: transfer.length > 0,
      dwell: (row[6] || transfer.length) ? 35 : 30,
      platformLength: 150,
      doorZone: 24
    };
    return Object.freeze(station);
  });

  const STATION_BY_NAME = Object.create(null);
  STATIONS.forEach(function (s) { STATION_BY_NAME[s.name] = s; });

  /* ------------------------------------------------------------------------
     2. 车辆数据（DKZ4）
     ------------------------------------------------------------------------ */
  const VEHICLE = Object.freeze({
    model: 'DKZ4 型电动客车',
    builder: '长春客车厂 / 北京地铁车辆厂',
    enteredService: 1999,
    formation: 'Mc-T+M-T′+T-Mc',
    formationShort: '3M3T / 6节编组',
    fleet: '全列 186 辆 / 31 组',
    maxSpeedKph: 80,
    operatingSpeedKph: 70,
    startAccel: 0.83,
    serviceDecel: 0.94,
    emergencyDecel: 1.19,
    atpServiceDecel: 0.85,
    atoServiceDecel: 0.78,
    powerKwp: 180,
    motorCount: 12,
    tractionPowerKw: 2160,
    motor: '东洋电机 TDK-6161-A / TDK-6175-A 鼠笼式三相异步电机',
    inverter: 'VVVF 逆变器（GTO）· 1C4M',
    supply: 'DC 750V 第三轨 · 上接触式集电靴',
    doorsPerCar: 4,
    doorType: '电控气动内藏门',
    body: '耐候钢 · 鼓型车体',
    carLength: 19.0,
    carWidth: 2.8,
    carHeight: 3.51,
    consistCars: 6,
    consistLength: 114.0,
    massKg: 228000,
    powerNotches: 4,
    brakeNotches: 7,
    emergencyNotches: 1,
    controller: '手柄式主控制器（牵引4段 / 常用制动7段 / 紧急制动独立按钮）',
    doorPairsPerSide: 4
  });

  /* ------------------------------------------------------------------------
     3. 运营时段、交路
     ------------------------------------------------------------------------ */
  const PERIODS = Object.freeze({
    am: {
      id: 'am',
      label: '工作日早高峰',
      shortLabel: '早高峰',
      headway: 105,
      headwayText: '1分45秒',
      clockBase: 7 * 3600 + 30 * 60,
      color: '#f04b4b'
    },
    pm: {
      id: 'pm',
      label: '工作日晚高峰',
      shortLabel: '晚高峰',
      headway: 140,
      headwayText: '2分20秒',
      clockBase: 18 * 3600,
      color: '#f2a33c'
    }
  });

  function serviceDefinition(period, type) {
    if (type === 'large') {
      return {
        id: 'large',
        type: 'large',
        label: '大交路',
        description: '古城 ↔ 环球度假区',
        min: 0,
        max: 34,
        endpoints: [0, 34],
        small: false
      };
    }
    if (period === 'am') {
      return {
        id: 'small',
        type: 'small',
        label: '小交路',
        description: '果园 ↔ 公主坟',
        min: 6,
        max: 28,
        endpoints: [28, 6],
        small: true
      };
    }
    return {
      id: 'small',
      type: 'small',
      label: '小交路',
      description: '古城 ↔ 果园',
      min: 0,
      max: 28,
      endpoints: [0, 28],
      small: true
    };
  }

  /* ------------------------------------------------------------------------
     4. 线路空间模型（用于 3D 世界与坡度计算）
     ------------------------------------------------------------------------ */
  const ROUTE_CENTER_X = LINE.lengthM * 0.5;

  function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function smootherstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function routeElevation(s) {
    s = clamp(s, 0, LINE.lengthM);
    // 西段地下（约 -13m），四惠东出地面，高架段，入地至环球度假区
    if (s < 32700) {
      return -13.0 + 0.55 * Math.sin(s / 8300);
    }
    if (s < 35200) {
      return lerp(-13.0, 6.6, smootherstep(32700, 35200, s));
    }
    if (s < 50500) {
      return 6.6 + 0.28 * Math.sin((s - 35200) / 4200) - 0.18 * smoothstep(46500, 50500, s);
    }
    if (s < 52500) {
      return lerp(6.3, -8.4, smootherstep(50500, 52500, s));
    }
    return -8.4 - 4.1 * smoothstep(52500, 54470, s);
  }

  function routeCenterZ(s) {
    return 118 * Math.sin((s - 1200) / 4300) +
      37 * Math.sin((s + 400) / 1540) +
      11 * Math.sin((s - 900) / 610);
  }

  function routePoint(s, lateral, up) {
    lateral = lateral || 0;
    up = up || 0;
    const h = 0.5;
    const x = s - ROUTE_CENTER_X;
    const z = routeCenterZ(s);
    const dx = 1;
    const dz = (routeCenterZ(s + h) - routeCenterZ(s - h)) / (2 * h);
    const inv = 1 / Math.sqrt(dx * dx + dz * dz);
    const tx = dx * inv;
    const tz = dz * inv;
    const rx = -tz;
    const rz = tx;
    return {
      x: x + rx * lateral,
      y: routeElevation(s) + up,
      z: z + rz * lateral,
      tx: tx,
      tz: tz,
      rx: rx,
      rz: rz,
      yaw: Math.atan2(-tz, tx)
    };
  }

  function routeGradient(s) {
    const h = 2.0;
    return (routeElevation(s + h) - routeElevation(s - h)) / (2 * h);
  }

  function environmentAt(s) {
    if (s < 33400) return 'underground';
    if (s < 35200) return 'ground';
    if (s < 51000) return 'elevated';
    if (s < 52200) return 'ground';
    return 'underground';
  }

  const ROUTE = Object.freeze({
    length: LINE.lengthM,
    stationOffsetM: LINE.stationOffsetM,
    stationSpanM: LINE.stationSpanM,
    elevation: routeElevation,
    gradient: routeGradient,
    centerZ: routeCenterZ,
    point: routePoint,
    envAt: environmentAt
  });

  /* ------------------------------------------------------------------------
     5. 时刻表
     ------------------------------------------------------------------------ */
  function kinematicRunSeconds(distanceM, vmaxMs) {
    vmaxMs = vmaxMs || VEHICLE.operatingSpeedKph / 3.6;
    const a = VEHICLE.startAccel;
    const b = VEHICLE.serviceDecel;
    const tAcc = vmaxMs / a;
    const dAcc = 0.5 * a * tAcc * tAcc;
    const tBrake = vmaxMs / b;
    const dBrake = 0.5 * b * tBrake * tBrake;
    let t;
    if (distanceM > dAcc + dBrake) {
      t = tAcc + tBrake + (distanceM - dAcc - dBrake) / vmaxMs;
    } else {
      const vPeak = Math.sqrt((2 * distanceM * a * b) / (a + b));
      t = vPeak / a + vPeak / b;
    }
    return t + 10; // 进路办理、站台确认与运行余量
  }

  function buildSchedule(stops, fullRun) {
    const runs = [];
    let rawRunTotal = 0;
    for (let i = 1; i < stops.length; i++) {
      const d = Math.abs(stops[i].s - stops[i - 1].s);
      const r = kinematicRunSeconds(d);
      runs.push(r);
      rawRunTotal += r;
    }
    let dwellTotal = 0;
    for (let i = 1; i < stops.length - 1; i++) dwellTotal += stops[i].dwell;
    let scale = fullRun ? (LINE.totalTimeSec - dwellTotal) / rawRunTotal : 1.0394;
    scale = clamp(scale, 0.8, 1.35);
    for (let i = 0; i < runs.length; i++) runs[i] *= scale;

    const entries = [];
    let t = 0;
    entries.push({
      i: 0,
      stop: stops[0],
      arr: 0,
      dep: 0,
      dwell: 0,
      run: 0,
      runFromPrevious: 0
    });
    for (let i = 1; i < stops.length; i++) {
      const arr = t + runs[i - 1];
      const dwell = (i === stops.length - 1) ? 0 : stops[i].dwell;
      const dep = arr + dwell;
      entries.push({
        i: i,
        stop: stops[i],
        arr: arr,
        dep: dep,
        dwell: dwell,
        run: runs[i - 1],
        runFromPrevious: runs[i - 1]
      });
      t = dep;
    }
    return {
      entries: entries,
      runs: runs,
      dwellTotal: dwellTotal,
      runTotal: runs.reduce(function (a, b) { return a + b; }, 0),
      duration: entries[entries.length - 1].arr,
      fullRun: !!fullRun
    };
  }

  function buildStops(period, type, direction) {
    const def = serviceDefinition(period, type);
    const stops = [];
    if (direction > 0) {
      for (let i = def.min; i <= def.max; i++) stops.push(makeStop(i, period, direction));
    } else {
      for (let i = def.max; i >= def.min; i--) stops.push(makeStop(i, period, direction));
    }
    return { def: def, stops: stops };
  }

  function makeStop(stationIndex, period, direction) {
    const st = STATIONS[stationIndex];
    const dir = direction < 0 ? -1 : 1;
    // 停车标位于站台内，使 6 节列车居中停靠；前端距站台中心半个列车长。
    const stopOffset = VEHICLE.consistLength / 2;
    return {
      index: stationIndex,
      station: st,
      name: st.name,
      en: st.en,
      s: st.s + dir * stopOffset,
      centerS: st.s,
      stopOffset: stopOffset,
      km: st.km,
      dwell: st.dwell,
      platform: st.platform,
      env: st.env,
      major: st.major,
      transfer: st.transfer,
      isTransfer: st.isTransfer,
      doorZone: st.doorZone,
      key: stationIndex + ':' + period
    };
  }

  function makeService(periodId, type, direction, options) {
    options = options || {};
    const period = PERIODS[periodId] || PERIODS.am;
    const dir = direction < 0 ? -1 : 1;
    const built = buildStops(periodId, type, dir);
    const stops = built.stops;
    const fullRun = type === 'large';
    const schedule = buildSchedule(stops, fullRun);
    const origin = stops[0];
    const terminal = stops[stops.length - 1];
    const service = {
      id: periodId + '-' + type + '-' + (dir > 0 ? 'east' : 'west'),
      periodId: periodId,
      period: period,
      type: type,
      def: built.def,
      dir: dir,
      directionText: dir > 0 ? '东行' : '西行',
      stops: stops,
      schedule: schedule,
      origin: origin,
      terminal: terminal,
      originName: origin.name,
      terminalName: terminal.name,
      headway: period.headway,
      headwayText: period.headwayText,
      clockBase: period.clockBase,
      routeLabel: origin.name + ' → ' + terminal.name,
      itinerary: stops.map(function (st) { return st.name; }),
      fullRun: fullRun,
      autoReverse: options.autoReverse !== false && type === 'small',
      startTime: options.startTime || 0
    };
    return service;
  }

  /* ------------------------------------------------------------------------
     6. 前方虚拟列车（按运行图早一个行车间隔）
     ------------------------------------------------------------------------ */
  function LeaderGhost(service, tripTimeOffset) {
    this.service = service;
    this.offset = tripTimeOffset == null ? service.headway : tripTimeOffset;
    this.entries = service.schedule.entries;
    this.dir = service.dir;
    this.length = VEHICLE.consistLength;
  }

  LeaderGhost.prototype.getState = function (tripTime) {
    const local = tripTime + this.offset;
    const entries = this.entries;
    const last = entries[entries.length - 1];
    if (local < 0) {
      return {
        active: true,
        s: this.service.stops[0].s,
        speed: 0,
        stationIndex: this.service.stops[0].index,
        phase: 'beforeStart',
        local: local
      };
    }
    if (local > last.arr + 28) {
      return { active: false, s: last.stop.s, speed: 0, local: local, phase: 'cleared' };
    }
    if (local >= last.arr) {
      return {
        active: true,
        s: last.stop.s,
        speed: 0,
        stationIndex: last.stop.index,
        phase: 'terminal',
        local: local
      };
    }
    for (let i = 0; i < entries.length - 1; i++) {
      const e = entries[i];
      const n = entries[i + 1];
      if (local < e.dep) {
        return {
          active: true,
          s: e.stop.s,
          speed: 0,
          stationIndex: e.stop.index,
          phase: 'dwell',
          local: local
        };
      }
      if (local < n.arr) {
        const T = n.arr - e.dep;
        const f = T > 0 ? clamp((local - e.dep) / T, 0, 1) : 1;
        const p = f * f * (3 - 2 * f);
        const dp = 6 * f * (1 - f);
        const d = Math.abs(n.stop.s - e.stop.s);
        return {
          active: true,
          s: e.stop.s + this.dir * d * p,
          speed: (d * dp) / Math.max(T, 0.001),
          stationIndex: null,
          phase: 'run',
          segment: i,
          progress: f,
          local: local
        };
      }
    }
    return {
      active: true,
      s: last.stop.s,
      speed: 0,
      stationIndex: last.stop.index,
      phase: 'terminal',
      local: local
    };
  };

  /* ------------------------------------------------------------------------
     7. 工具函数
     ------------------------------------------------------------------------ */
  function formatClock(totalSeconds, base) {
    let t = Math.floor((base || 0) + totalSeconds);
    t = ((t % 86400) + 86400) % 86400;
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }
  function formatHM(totalSeconds, base) {
    const str = formatClock(totalSeconds, base);
    return str.slice(0, 5);
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function formatDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? m + '分' + pad2(s) + '秒' : s + '秒';
  }
  function formatDistance(m) {
    if (!isFinite(m)) return '—';
    if (Math.abs(m) >= 1000) return (m / 1000).toFixed(2) + ' km';
    return Math.max(0, Math.round(m)) + ' m';
  }
  function formatDelay(sec) {
    const r = Math.round(sec);
    if (Math.abs(r) <= 3) return '正点';
    return r > 0 ? '晚点 ' + formatDuration(r) : '早点 ' + formatDuration(-r);
  }

  function atpCurveSpeedKph(distanceM, decel, bias) {
    const d = Math.max(0, distanceM);
    const b = decel || VEHICLE.atpServiceDecel;
    return Math.sqrt(2 * b * d) * 3.6 + (bias == null ? 1.0 : bias);
  }

  function brakingDistanceM(speedKph, decel) {
    const v = Math.max(0, speedKph) / 3.6;
    return (v * v) / (2 * (decel || VEHICLE.serviceDecel));
  }

  function classifyStopError(errorM) {
    const a = Math.abs(errorM);
    if (a <= 0.5) {
      return { level: 'precise', label: '停车精准', points: 100, color: 'green', error: errorM };
    }
    if (a <= 1.0) {
      return { level: 'inaccurate', label: '停车不准', points: 65, color: 'amber', error: errorM };
    }
    return {
      level: errorM > 0 ? 'overrun' : 'underrun',
      label: errorM > 0 ? '冲标' : '欠标',
      points: 0,
      color: 'red',
      error: errorM
    };
  }

  /* ------------------------------------------------------------------------
     8. 驾驶模拟器
     ------------------------------------------------------------------------ */
  function Simulator(service, options) {
    options = options || {};
    this.service = service;
    this.period = service.period;
    this.dir = service.dir;
    this.stops = service.stops;
    this.schedule = service.schedule;
    this.s = this.stops[0].s;
    this.v = 0;
    this.notch = 0;             // +1..+4 牵引，-1..-7 制动
    this.doors = 'closed';      // closed | opening | open | closing
    this.doorTimer = 0;
    this.dwellSeconds = 0;
    this.ato = !!options.ato;
    this.atoDepartAuthorized = false;
    this.eb = false;
    this.ebReason = '';
    this.ebLatched = false;
    this.time = 0;
    this.tripTime = 0;
    this.tripStartTime = 0;
    this.tripCount = 1;
    this.nextStopIdx = Math.min(1, this.stops.length - 1);
    this.atStation = {
      stopIdx: 0,
      stop: this.stops[0],
      since: 0,
      terminal: this.stops.length === 1
    };
    this.terminalArrived = false;
    this.completed = false;
    this.completedReason = '';
    this.parkingHold = true;
    this.recordedKeys = Object.create(null);
    this.stopRecords = [];
    this.departureDeviations = [];
    this.arrivalDeviations = [];
    this.lastArrivalDeviation = null;
    this.events = [];
    this.collision = false;
    this.leader = new LeaderGhost(service, service.headway);
    this.leaderState = this.leader.getState(0);
    this.positionHistory = [{ t: 0, s: this.s, v: 0 }];
    this.lastHistoryTime = 0;
    this.followerState = {
      active: true,
      s: this.s - this.dir * (VEHICLE.consistLength + 30),
      speed: 0
    };
    this.followerGap = 30;
    this.opposingService = null;
    this.opposingGhosts = [];
    this.opposingGhostMaxK = 0;
    this.opposingK = null;
    this.opposingState = { active: false, s: this.s, speed: 0, gap: Infinity, k: null };
    this.warning = false;
    this.overspeedTimer = 0;
    this.overspeedActive = false;
    this.doorViolationFlag = false;
    this.scheduleCapKph = VEHICLE.operatingSpeedKph;
    this.atoScheduleLimited = false;
    this.ebReadyToReset = false;
    this.ebStoppedNotified = false;
    this.stats = {
      ebCount: 0,
      overspeedTime: 0,
      overspeedEvents: 0,
      missedStops: 0,
      doorViolations: 0,
      collision: 0,
      maxSpeedKph: 0,
      distanceM: 0,
      energyKwh: 0
    };
    this.lastAtp = null;
    this.lastDepartureDeviation = 0;
    this.atoTakeovers = 0;
    this.tractionSeconds = 0;
    this.brakeSeconds = 0;
    this.doorCycles = 0;
    this.buildOpposingStream();
    this.updateFollower();
    this.updateOpposing();
    this.notify('值乘开始：' + service.routeLabel + '。' + (this.ato ? 'ATO 已激活，等待发车授权。' : 'ATP 监督下人工驾驶。'), 'info');
    this.recomputeAtp();
  }

  Simulator.prototype.notify = function (text, type, extra) {
    this.events.push(Object.assign({
      text: text,
      type: type || 'info',
      t: this.time
    }, extra || {}));
    if (this.events.length > 60) this.events.shift();
  };

  Simulator.prototype.drainEvents = function () {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  };

  Simulator.prototype.getClockText = function () {
    return formatClock(this.time, this.period.clockBase);
  };

  Simulator.prototype.getNextStop = function () {
    return this.nextStopIdx >= 0 && this.nextStopIdx < this.stops.length
      ? this.stops[this.nextStopIdx] : null;
  };

  Simulator.prototype.getNextStopDistance = function () {
    const next = this.getNextStop();
    if (!next) return Infinity;
    return this.dir * (next.s - this.s);
  };

  Simulator.prototype.getCurrentStop = function () {
    return this.atStation ? this.atStation.stop : null;
  };

  Simulator.prototype.getStationProgress = function () {
    if (!this.atStation) return null;
    return this.atStation.stop;
  };

  Simulator.prototype.getScheduleEntry = function (stopIdx) {
    if (stopIdx == null || stopIdx < 0 || stopIdx >= this.schedule.entries.length) return null;
    return this.schedule.entries[stopIdx];
  };

  Simulator.prototype.getDelay = function () {
    if (this.atStation) {
      // 停站期间显示到达偏差；否则会把正常 30 秒停站时间误显示成“早点”。
      if (this.lastArrivalDeviation != null) return this.lastArrivalDeviation;
      const e = this.getScheduleEntry(this.atStation.stopIdx);
      if (e) return this.tripTime - e.dep;
    }
    return this.lastDepartureDeviation;
  };

  Simulator.prototype.getAtpStatus = function () {
    if (!this.lastAtp) this.recomputeAtp();
    return this.lastAtp;
  };

  /**
   * ATO 内部停车点与实际停车点的偏差量（米，正数表示 ATO 认为的站台更靠前）。
   * 原始停车逻辑每次都会冲过停车点约 0.15 m，因此旧的 ATO 会把目标再提前 0.155 m，
   * 使实际停车误差落在 0.00 m 附近。现在停车曲线本身已在停车点精确收敛，
   * 再把目标提前 0.155 m 反而会每次少停 0.31 m（-0.30 ~ -0.45 m）。
   * 改成按真实停车点规划后仍会少停 0.15 m（帧率一致），所以这里取负值，
   * 让 ATO 认为的站台比真实停车点稍靠后 0.155 m，把残余欠停补偿掉，实测均值落在 0.00 m。
   */
  const ATO_STOP_BIAS_M = -0.155;

  Simulator.prototype.recomputeAtp = function () {
    const next = this.getNextStop();
    const stationDist = next ? this.dir * (next.s - this.s) : Infinity;
    const atoStationDist = next ? stationDist - ATO_STOP_BIAS_M : Infinity;
    let leaderGap = Infinity;
    let leaderSpeed = 0;
    let leaderActive = false;
    if (this.leaderState && this.leaderState.active) {
      const rear = this.leaderState.s - this.dir * VEHICLE.consistLength;
      const gap = this.dir * (rear - this.s);
      if (gap > -200) {
        leaderGap = gap;
        leaderSpeed = this.leaderState.speed;
        leaderActive = true;
      }
    }

    let stationAllow = atpCurveSpeedKph((stationDist - 1.2), VEHICLE.atpServiceDecel, 1.1);
    // 停车点前保留约 3 km/h 的蠕行允许量，避免正常对位时产生虚假超速报警
    if (stationDist > 0.12 && stationDist < 6.5) stationAllow = Math.max(stationAllow, 3.2);
    const leaderAllow = leaderActive
      ? atpCurveSpeedKph((leaderGap - 13), VEHICLE.atpServiceDecel * 1.05, 1.0)
      : 999;

    let vPerm = Math.min(VEHICLE.operatingSpeedKph, stationAllow, leaderAllow);
    let targetType = 'none';
    let targetDistance = Infinity;
    if (stationAllow <= leaderAllow) {
      targetType = 'station';
      targetDistance = Math.max(0, stationDist);
    } else {
      targetType = 'leader';
      targetDistance = Math.max(0, leaderGap);
    }
    if (stationDist <= leaderGap) {
      targetType = 'station';
      targetDistance = Math.max(0, stationDist);
    } else {
      targetType = 'leader';
      targetDistance = Math.max(0, leaderGap);
    }
    if (this.atStation && this.v < 0.4) {
      vPerm = 0;
      targetType = 'station';
      targetDistance = 0;
    }
    if (this.eb) vPerm = 0;
    vPerm = clamp(vPerm, 0, VEHICLE.operatingSpeedKph);

    const result = {
      vPermKph: vPerm,
      stationDist: stationDist,
      atoStationDist: atoStationDist,
      stationAllowKph: stationAllow,
      leaderGap: leaderGap,
      leaderAllowKph: leaderAllow,
      leaderActive: leaderActive,
      leaderSpeed: leaderSpeed,
      targetType: targetType,
      targetDistance: targetDistance,
      lineLimitKph: VEHICLE.operatingSpeedKph,
      brakeDistance: brakingDistanceM(this.v * 3.6, VEHICLE.atpServiceDecel),
      overspeed: this.v * 3.6 - vPerm,
      atStation: !!this.atStation
    };
    this.lastAtp = result;
    return result;
  };

  Simulator.prototype.updateLeader = function () {
    this.leaderState = this.leader.getState(this.tripTime);
  };

  Simulator.prototype.buildOpposingStream = function () {
    const opposing = makeService(this.service.periodId, 'large', -this.dir);
    this.opposingService = opposing;
    const headway = this.service.headway;
    const maxK = Math.ceil(opposing.schedule.duration / headway) + 2;
    this.opposingGhostMaxK = maxK;
    this.opposingGhosts = [];
    for (let k = -maxK; k <= maxK; k++) {
      this.opposingGhosts.push(new LeaderGhost(opposing, k * headway));
    }
    this.opposingK = null;
  };

  Simulator.prototype.samplePositionHistory = function (targetTime) {
    const h = this.positionHistory;
    if (!h.length) return { t: targetTime, s: this.s, v: this.v };
    if (targetTime <= h[0].t) return h[0];
    if (targetTime >= h[h.length - 1].t) return h[h.length - 1];
    let lo = 0;
    let hi = h.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (h[mid].t <= targetTime) lo = mid;
      else hi = mid;
    }
    const a = h[lo];
    const b = h[hi];
    const span = b.t - a.t;
    const f = span > 0.0001 ? (targetTime - a.t) / span : 0;
    return {
      t: targetTime,
      s: a.s + (b.s - a.s) * f,
      v: a.v + (b.v - a.v) * f
    };
  };

  Simulator.prototype.recordPositionHistory = function () {
    if (this.tripTime - this.lastHistoryTime >= 0.2) {
      this.lastHistoryTime = this.tripTime;
      this.positionHistory.push({ t: this.tripTime, s: this.s, v: this.v });
      const cutoff = this.tripTime - this.service.headway - 20;
      while (this.positionHistory.length > 2 && this.positionHistory[0].t < cutoff) {
        this.positionHistory.shift();
      }
    }
  };

  /**
   * 后车不是贴图：按实际本车位置历史延迟一个行车间隔跟随；
   * 同时限制不得越过本车车尾 24m。它提供后车距离与追踪图数据。
   */
  Simulator.prototype.updateFollower = function () {
    const headway = this.service.headway;
    const localTime = this.tripTime - headway;
    let target;
    let speed = 0;
    if (localTime < 0) {
      target = this.stops[0].s - this.dir * (VEHICLE.consistLength + 30);
    } else {
      const sample = this.samplePositionHistory(localTime);
      target = sample.s - this.dir * (VEHICLE.consistLength + 30);
      speed = sample.v;
    }
    const playerRear = this.s - this.dir * VEHICLE.consistLength;
    let gap = this.dir * (playerRear - target);
    if (gap < 24) {
      target = playerRear - this.dir * 24;
      speed = 0;
      gap = 24;
    }
    target = clamp(target, -150, LINE.lengthM + 150);
    gap = this.dir * (playerRear - target);
    this.followerState = {
      active: true,
      s: target,
      speed: speed,
      gap: gap
    };
    this.followerGap = gap;
  };

  /**
   * 对向列车按同一天然行车间隔形成车流，只选取距离本车最近的一列用于渲染。
   * 对向车流使用完整交路反向运行图，与本车互不干扰。
   */
  Simulator.prototype.updateOpposing = function () {
    if (!this.opposingService || !this.opposingGhosts.length) {
      this.opposingState = { active: false, s: this.s, speed: 0, gap: Infinity, k: null };
      return;
    }
    const headway = this.service.headway;
    const maxK = this.opposingGhostMaxK;
    const duration = this.opposingService.schedule.duration;
    let chosen = null;

    if (this.opposingK != null) {
      const idx = this.opposingK + maxK;
      if (idx >= 0 && idx < this.opposingGhosts.length) {
        const st = this.opposingGhosts[idx].getState(this.tripTime);
        if (st.active) {
          const along = this.dir * (st.s - this.s);
          if (Math.abs(along) <= 2300) chosen = { k: this.opposingK, st: st, along: along };
        }
      }
    }

    if (!chosen) {
      const kMin = Math.ceil((-this.tripTime) / headway) - 1;
      const kMax = Math.floor((duration - this.tripTime) / headway) + 1;
      let bestAhead = null;
      let bestAheadDist = Infinity;
      let bestAny = null;
      let bestAnyDist = Infinity;
      for (let k = kMin; k <= kMax; k++) {
        const idx = k + maxK;
        if (idx < 0 || idx >= this.opposingGhosts.length) continue;
        const st = this.opposingGhosts[idx].getState(this.tripTime);
        if (!st.active) continue;
        const along = this.dir * (st.s - this.s);
        const abs = Math.abs(along);
        if (along > -20 && along < bestAheadDist) {
          bestAheadDist = along;
          bestAhead = { k: k, st: st, along: along };
        }
        if (abs < bestAnyDist) {
          bestAnyDist = abs;
          bestAny = { k: k, st: st, along: along };
        }
      }
      if (bestAhead && bestAheadDist <= 3200) chosen = bestAhead;
      else if (bestAny && bestAnyDist <= 2400) chosen = bestAny;
    }

    if (!chosen) {
      this.opposingK = null;
      this.opposingState = { active: false, s: this.s, speed: 0, gap: Infinity, k: null };
      return;
    }
    this.opposingK = chosen.k;
    this.opposingState = {
      active: true,
      s: chosen.st.s,
      speed: chosen.st.speed,
      gap: chosen.along,
      k: chosen.k
    };
  };

  Simulator.prototype.updateDoors = function (dt) {
    if (this.doors === 'opening') {
      this.doorTimer += dt;
      if (this.doorTimer >= 1.8) {
        this.doors = 'open';
        this.doorTimer = 0;
        this.dwellSeconds = 0;
        const stop = this.atStation ? this.atStation.stop : null;
        if (stop) {
          this.evaluateStop(stop);
          this.notify('车门已开启 · ' + stop.name + ' · 请组织乘客乘降。', 'success');
        }
      }
    } else if (this.doors === 'open') {
      this.dwellSeconds += dt;
    } else if (this.doors === 'closing') {
      this.doorTimer += dt;
      if (this.doorTimer >= 1.8) {
        this.doors = 'closed';
        this.doorTimer = 0;
        this.doorViolationFlag = false;
        this.notify('车门已关闭 · 牵引联锁解除。', 'info');
      }
    }
  };

  Simulator.prototype.doorPercent = function () {
    if (this.doors === 'closed') return 0;
    if (this.doors === 'open') return 1;
    if (this.doors === 'opening') return clamp(this.doorTimer / 1.8, 0, 1);
    if (this.doors === 'closing') return 1 - clamp(this.doorTimer / 1.8, 0, 1);
    return 0;
  };

  Simulator.prototype.requestDoorToggle = function () {
    if (this.eb) {
      this.notify('紧急制动已施加，无法操作车门。', 'warning');
      return false;
    }
    if (this.v > 0.15) {
      this.notify('列车未停稳，禁止开门。', 'error');
      return false;
    }
    if (!this.atStation) {
      this.notify('当前不在站台车门区域，无法开门。', 'error');
      return false;
    }
    if (this.terminalArrived && this.completed) {
      this.notify('本次值乘已结束。', 'warning');
      return false;
    }
    if (this.doors === 'closed') {
      this.doors = 'opening';
      this.doorTimer = 0;
      this.notch = 0;
      this.doorCycles++;
      this.notify('开门指令已发出 · 站台门/车门联动开启。', 'info');
      return true;
    }
    if (this.doors === 'open') {
      if (this.dwellSeconds < 2.0) {
        this.notify('乘客正在乘降，请稍候再关闭车门。', 'warning');
        return false;
      }
      this.doors = 'closing';
      this.doorTimer = 0;
      this.notify('关门指令已发出 · 请注意站台间隙。', 'info');
      return true;
    }
    this.notify(this.doors === 'opening' ? '车门正在开启。' : '车门正在关闭。', 'warning');
    return false;
  };

  Simulator.prototype.requestDeparture = function () {
    if (this.completed) {
      this.notify('本次值乘已经结束。', 'warning');
      return false;
    }
    if (!this.atStation) {
      this.notify('当前不在车站，无法发车。', 'warning');
      return false;
    }
    if (this.doors !== 'closed') {
      this.notify('车门未关闭，发车联锁生效。', 'error');
      return false;
    }
    if (this.eb) {
      this.notify('紧急制动未复位，无法发车。', 'error');
      return false;
    }
    if (this.terminalArrived) {
      this.notify('已到达终点站。', 'warning');
      return false;
    }
    if (!this.ato) {
      this.notify('ATP 人工驾驶模式：请推牵引手柄发车。', 'info');
      return false;
    }
    this.atoDepartAuthorized = true;
    this.notify('ATO 发车授权已确认 · 列车自动起动。', 'success');
    return true;
  };

  Simulator.prototype.adjustHandle = function (delta) {
    if (this.eb) {
      this.notify('EB 已锁闭，请先停稳并复位。', 'warning');
      return;
    }
    if (this.ato) {
      this.ato = false;
      this.atoTakeovers++;
      this.atoDepartAuthorized = false;
      this.notify('人工手柄介入 · ATO 已退出，转入 ATP 人工驾驶。', 'warning');
    }
    let n = this.notch + (delta > 0 ? 1 : -1);
    n = clamp(n, -VEHICLE.brakeNotches, VEHICLE.powerNotches);
    if (this.doors !== 'closed' && n > 0) {
      n = 0;
      if (!this.doorViolationFlag) {
        this.stats.doorViolations++;
        this.doorViolationFlag = true;
      }
      this.notify('车门未关闭 · 牵引被封锁。', 'error');
    }
    this.notch = n;
  };

  Simulator.prototype.setHandle = function (n) {
    n = clamp(Math.round(n), -VEHICLE.brakeNotches, VEHICLE.powerNotches);
    if (this.eb) {
      this.notify('EB 已锁闭，必须停稳并点击“复位”后才能操作手柄。', 'warning');
      return;
    }
    if (this.ato && n !== 0) {
      this.ato = false;
      this.atoTakeovers++;
      this.notify('人工手柄介入 · ATO 已退出。', 'warning');
    }
    if (this.doors !== 'closed' && n > 0) {
      if (!this.doorViolationFlag) {
        this.stats.doorViolations++;
        this.doorViolationFlag = true;
      }
      n = 0;
      this.notify('车门未关闭 · 牵引被封锁。', 'error');
    }
    this.notch = n;
  };

  Simulator.prototype.toggleAto = function () {
    if (this.eb) {
      this.notify('EB 状态不可切换 ATO。', 'warning');
      return this.ato;
    }
    this.ato = !this.ato;
    this.atoDepartAuthorized = false;
    if (this.ato) {
      this.notify('ATO 已激活 · 下一站自动运行。', 'success');
    } else {
      this.notify('ATO 已退出 · ATP 人工驾驶。', 'warning');
    }
    return this.ato;
  };

  Simulator.prototype.emergencyBrake = function (reason) {
    if (this.eb) return;
    this.eb = true;
    this.ebLatched = true;
    this.ebReason = reason || '司机紧急制动';
    this.notch = 0;
    this.atoDepartAuthorized = false;
    this.ebReadyToReset = false;
    this.ebStoppedNotified = false;
    this.atoScheduleLimited = false;
    this.scheduleCapKph = VEHICLE.operatingSpeedKph;
    this.stats.ebCount++;
    this.notify('紧急制动 EB！原因：' + this.ebReason + '。停稳后须复位。', 'error', { big: true });
  };

  Simulator.prototype.resetEB = function () {
    if (!this.eb) {
      this.notify('当前没有紧急制动。', 'info');
      return false;
    }
    if (this.v > 0.08) {
      this.notify('列车尚未停稳，不能复位 EB。', 'error');
      return false;
    }
    this.eb = false;
    this.ebLatched = false;
    this.ebReason = '';
    this.ebReadyToReset = false;
    this.notch = 0;
    this.overspeedTimer = 0;
    this.notify('紧急制动已复位 · 手柄在运转位，可重新牵引。', 'success');
    return true;
  };

  Simulator.prototype.evaluateStop = function (stop) {
    if (!stop) return null;
    const key = stop.index + ':' + this.dir + ':' + this.tripCount;
    if (this.recordedKeys[key]) return this.recordedKeys[key];
    const err = (this.s - stop.s) * this.dir;
    const cls = classifyStopError(err);
    const rec = {
      key: key,
      stationIndex: stop.index,
      name: stop.name,
      error: err,
      absError: Math.abs(err),
      level: cls.level,
      label: cls.label,
      points: cls.points,
      color: cls.color,
      time: this.tripTime,
      terminal: this.atStation ? !!this.atStation.terminal : false
    };
    this.recordedKeys[key] = rec;
    this.stopRecords.push(rec);
    if (this.atStation && this.atStation.stopIdx === 0) {
      // 始发站（含折返后的新始发站）不参与停车精度评分
      rec.excluded = true;
    }
    if (!rec.excluded) {
      const sign = err >= 0 ? '+' : '';
      const detail = stop.name + ' ' + sign + err.toFixed(2) + ' m';
      if (cls.level === 'precise') {
        this.notify('停车精准：' + detail + '（±0.5 m 内）', 'success');
      } else if (cls.level === 'inaccurate') {
        this.notify('停车不准：' + detail + '（超出 ±0.5 m，未超 ±1 m）', 'warning');
      } else {
        this.notify('停车超限：' + detail + ' · ' + cls.label, 'error');
      }
    }
    return rec;
  };

  Simulator.prototype.recordedStopFor = function (idx) {
    return this.stopRecords.some(function (r) {
      return r.key.indexOf(idx + ':') === 0 && !r.excluded;
    });
  };

  Simulator.prototype.beginDeparture = function () {
    if (!this.atStation) return false;
    if (this.terminalArrived) return false;
    if (this.v > 0.08) return false;
    if (this.doors !== 'closed') return false;
    if (this.eb) return false;
    const stop = this.atStation.stop;
    if (!this.recordedKeys[stop.index + ':' + this.dir + ':' + this.tripCount]) {
      if (this.atStation.stopIdx > 0) this.evaluateStop(stop);
    }
    const entry = this.getScheduleEntry(this.atStation.stopIdx);
    if (entry && this.atStation.stopIdx > 0) {
      const deviation = this.tripTime - entry.dep;
      this.departureDeviations.push(deviation);
      this.lastDepartureDeviation = deviation;
      if (Math.abs(deviation) > 30) {
        this.notify('发车时刻偏差：' + formatDelay(deviation) + '（计划 ' +
          formatClock(entry.dep, this.period.clockBase) + '）', Math.abs(deviation) > 90 ? 'warning' : 'info');
      }
    }
    const departedName = stop.name;
    const departedStopIdx = this.atStation.stopIdx;
    this.atStation = null;
    this.nextStopIdx = Math.min(departedStopIdx + 1, this.stops.length);
    this.atoDepartAuthorized = false;
    this.notify('列车起动 · 下一站 ' + (this.getNextStop() ? this.getNextStop().name : '终点'), 'info');
    return departedName;
  };

  Simulator.prototype.arriveAtStation = function (target) {
    if (this.atStation) return;
    const entry = this.getScheduleEntry(this.nextStopIdx);
    if (entry) {
      const arrivalDeviation = this.tripTime - entry.arr;
      this.lastArrivalDeviation = arrivalDeviation;
      this.arrivalDeviations.push(arrivalDeviation);
    }
    this.atStation = {
      stopIdx: this.nextStopIdx,
      stop: target,
      since: this.tripTime,
      terminal: this.nextStopIdx === this.stops.length - 1
    };
    this.atoDepartAuthorized = false;
    this.parkingHold = true;
    this.notch = this.ato ? this.notch : 0;
    if (this.atStation.terminal) {
      this.terminalArrived = true;
      this.notify('到达终点站 ' + target.name + ' · 请停稳并开启车门。', 'success', { big: true });
    } else {
      this.notify('到达 ' + target.name + ' · 请对准停车标，开启车门。', 'success');
    }
  };

  Simulator.prototype.markMissed = function (target) {
    this.stats.missedStops++;
    this.notify('越过停车标：' + target.name + ' 未停车，本停站记为漏停。', 'error');
    this.nextStopIdx = Math.min(this.nextStopIdx + 1, this.stops.length);
    if (this.nextStopIdx >= this.stops.length) {
      this.complete('越过终点停车标');
    }
  };

  Simulator.prototype.updateStationState = function () {
    if (this.atStation) return;
    const next = this.getNextStop();
    if (!next) return;
    const d = this.dir * (next.s - this.s);
    if (Math.abs(d) <= next.doorZone && this.v < 0.09) {
      this.arriveAtStation(next);
      return;
    }
    if (d < -40) {
      this.markMissed(next);
    }
  };

  /**
   * 按运行图计算区间速度上限：不允许比计划到达时刻提前 5 秒以上。
   * 通过降低目标速度/惰行把时间“还”给区间，而不是到站后倒车或停在中途。
   */
  function atoTravelTimeForCap(capMs, distanceM, accel, decel) {
    const dAcc = (capMs * capMs) / (2 * accel);
    const dBrake = (capMs * capMs) / (2 * decel);
    if (dAcc + dBrake >= distanceM) {
      const vPeak = Math.sqrt((2 * distanceM * accel * decel) / (accel + decel));
      return vPeak / accel + vPeak / decel;
    }
    return capMs / accel + capMs / decel +
      (distanceM - dAcc - dBrake) / capMs;
  }

  Simulator.prototype.computeScheduleSpeedCapKph = function (atp) {
    const entry = this.getScheduleEntry(this.nextStopIdx);
    if (!entry || !isFinite(entry.arr)) return VEHICLE.operatingSpeedKph;
    // 以“提前 2.5 秒”为控制目标，给停车对位/离散控制留出余量；
    // 硬性验收线是不得提前超过 5 秒。
    const earliestArrival = entry.arr - 2.5;
    const allowance = earliestArrival - this.tripTime - 0.5;
    if (allowance <= 0.8) return VEHICLE.operatingSpeedKph;
    const d = atp.atoStationDist;
    if (!isFinite(d) || d <= 0.2) return 0.5;

    // 用带起动/制动段的运动学反解巡航速度，避免只按平均速度计算导致到站偏晚。
    const accel = 0.55;
    const decel = 0.70;
    const vMax = VEHICLE.operatingSpeedKph / 3.6;
    if (atoTravelTimeForCap(vMax, d, accel, decel) >= allowance) {
      return VEHICLE.operatingSpeedKph; // 即便跑满允许速度也不会提前
    }
    let lo = 0.4;
    let hi = vMax;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) * 0.5;
      const t = atoTravelTimeForCap(mid, d, accel, decel);
      if (t > allowance) lo = mid;
      else hi = mid;
    }
    return clamp(((lo + hi) * 0.5) * 3.6, 0.5, VEHICLE.operatingSpeedKph);
  };

  Simulator.prototype.controlAto = function (atp) {
    if (this.eb) return;
    if (this.atStation) {
      this.notch = -4;
      this.scheduleCapKph = VEHICLE.operatingSpeedKph;
      this.atoScheduleLimited = false;
      return;
    }
    const next = this.getNextStop();
    if (!next) {
      this.notch = -7;
      return;
    }
    const scheduleCap = this.computeScheduleSpeedCapKph(atp);
    this.scheduleCapKph = scheduleCap;
    this.atoScheduleLimited = scheduleCap < Math.min(atp.vPermKph, VEHICLE.operatingSpeedKph) - 0.6;

    let vDes = Math.max(0, Math.min(
      (atp.vPermKph - 1.2) / 3.6,
      scheduleCap / 3.6
    ));
    if (atp.leaderActive) {
      const leaderCurve = Math.sqrt(2 * VEHICLE.atoServiceDecel * Math.max(0, atp.leaderGap - 16));
      vDes = Math.min(vDes, leaderCurve);
    }
    // 预留制动余量：ATO 用更平缓的提前制动曲线，最后 18m 进入低速蠕行。
    // ATO 内部按提前 0.155m 的停车点规划，使实际停车误差落在 0.00m 附近。
    const stationDist = atp.atoStationDist;
    const stationCurve = Math.sqrt(2 * 0.40 * Math.max(0, stationDist - 0.08));
    vDes = Math.min(vDes, stationCurve);
    if (stationDist < 18) {
      vDes = Math.min(vDes, Math.max(0, (stationDist - 0.05) * 0.32 + 0.08));
    }
    if (stationDist < 0.16 && this.v < 0.45) {
      this.v = 0;
      this.notch = -4;
      return;
    }

    // 按图早点时优先惰行：仅在超出目标速度较多或进入制动区时上制动。
    const overSchedule = this.v * 3.6 - scheduleCap;
    if (this.atoScheduleLimited && atp.stationDist > 120 && overSchedule > 0.2 && overSchedule < 1.8) {
      this.notch = 0;
      return;
    }

    const err = vDes - this.v;
    let a = clamp(err * 0.72, -0.86, 0.74);
    if (this.v < 0.08 && vDes < 0.25) {
      this.notch = -4;
      return;
    }
    if (a > 0.045) {
      this.notch = clamp(Math.ceil((a / VEHICLE.startAccel) * VEHICLE.powerNotches), 1, 4);
    } else if (a < -0.045) {
      this.notch = -clamp(Math.ceil((-a / VEHICLE.serviceDecel) * VEHICLE.brakeNotches), 1, 7);
    } else {
      this.notch = 0;
    }
  };

  Simulator.prototype.tractionAccel = function () {
    if (this.notch <= 0) return 0;
    const ratio = this.notch / VEHICLE.powerNotches;
    let powerFactor = 1;
    if (this.v > 0.2) {
      const powerAcc = (VEHICLE.tractionPowerKw * 1000) / (VEHICLE.massKg * this.v);
      powerFactor = clamp(powerAcc / VEHICLE.startAccel, 0.12, 1.0);
    }
    return ratio * VEHICLE.startAccel * powerFactor;
  };

  Simulator.prototype.resistanceAccel = function () {
    const v = this.v;
    return 0.055 + 0.00095 * v + 0.000024 * v * v;
  };

  Simulator.prototype.serviceBrakeAccel = function () {
    if (this.notch >= 0) return 0;
    const ratio = Math.abs(this.notch) / VEHICLE.brakeNotches;
    return VEHICLE.serviceDecel * Math.pow(ratio, 1.08);
  };

  Simulator.prototype.stepPhysics = function (dt) {
    if (this.completed) {
      this.v = 0;
      return;
    }
    if (this.doors !== 'closed' && this.notch > 0) {
      this.notch = 0;
      if (!this.doorViolationFlag) {
        this.stats.doorViolations++;
        this.doorViolationFlag = true;
      }
    }
    let a = 0;
    if (this.eb) {
      a = -VEHICLE.emergencyDecel;
    } else {
      if (this.notch > 0) a += this.tractionAccel();
      if (this.notch < 0) a -= this.serviceBrakeAccel();
      const grade = this.dir * ROUTE.gradient(this.s);
      a -= G * grade;
      if (this.v > 0.001) a -= this.resistanceAccel();
      if (this.v < 0.06 && this.notch <= 0) {
        // 停放制动/保持制动，避免在坡道溜逸
        a = 0;
        this.v = 0;
        this.parkingHold = true;
      } else {
        this.parkingHold = false;
      }
    }
    if (this.eb && this.v < 0.05) {
      this.v = 0;
      this.parkingHold = true;
      this.ebLatched = true;
      this.ebReadyToReset = true;
    }
    let nv = this.v + a * dt;
    if (nv < 0) nv = 0;
    if (nv > VEHICLE.maxSpeedKph / 3.6) nv = VEHICLE.maxSpeedKph / 3.6;
    const ds = (this.v + nv) * 0.5 * dt;
    const oldS = this.s;
    this.s = clamp(this.s + this.dir * ds, -160, LINE.lengthM + 160);
    this.v = nv;
    this.stats.distanceM += Math.abs(this.s - oldS);
    if (this.v * 3.6 > this.stats.maxSpeedKph) this.stats.maxSpeedKph = this.v * 3.6;
    if (this.notch > 0 && this.v > 0.3) this.tractionSeconds += dt;
    if (this.notch < 0 && this.v > 0.3) this.brakeSeconds += dt;
    if (this.notch !== 0 && this.v > 0.3) {
      const kw = this.notch > 0
        ? VEHICLE.tractionPowerKw * (this.notch / VEHICLE.powerNotches)
        : 0;
      this.stats.energyKwh += kw * dt / 3600;
    }
  };

  Simulator.prototype.checkProtection = function (atp, dt) {
    // EB 已锁闭时不再累计超速统计；等待停车与人工复位。
    if (this.eb) {
      this.warning = false;
      this.overspeedActive = false;
      this.overspeedTimer = 0;
      return;
    }
    const speedKph = this.v * 3.6;
    const over = speedKph - atp.vPermKph;
    this.warning = over > 2.0;
    if (over > 2.0) {
      this.stats.overspeedTime += dt;
      if (!this.overspeedActive) {
        this.overspeedActive = true;
        this.stats.overspeedEvents++;
        this.notify('ATP 超速报警：' + Math.round(speedKph) + ' km/h / 允许 ' +
          Math.round(atp.vPermKph) + ' km/h。', 'warning');
      }
    } else {
      this.overspeedActive = false;
    }
    if (over > 4.0) this.overspeedTimer += dt;
    else this.overspeedTimer = Math.max(0, this.overspeedTimer - dt * 2);

    if (!this.eb && !this.completed) {
      if (over > 9 || this.overspeedTimer > 0.85) {
        this.emergencyBrake('ATP 超速防护');
      }
      if (atp.leaderActive && atp.leaderGap < 12 && this.v > 0.6) {
        this.emergencyBrake('追踪距离不足');
      }
      if (atp.leaderActive && atp.leaderGap < 0.5 && this.v > 0.2) {
        this.stats.collision++;
        this.collision = true;
        this.v = 0;
        this.complete('追尾前车');
      }
    }
  };

  Simulator.prototype.update = function (dt) {
    dt = clamp(dt, 0, 0.1);
    if (this.completed) return;
    this.time += dt;
    this.tripTime = this.time - this.tripStartTime;
    this.updateDoors(dt);
    this.updateLeader();
    this.updateStationState();

    // 发车判断（ATO 需玩家授权，人工需推牵引）
    if (this.atStation && this.v < 0.06 && this.doors === 'closed' && !this.eb && !this.terminalArrived) {
      if ((this.ato && this.atoDepartAuthorized) || (!this.ato && this.notch > 0)) {
        this.beginDeparture();
      }
    }

    let atp = this.recomputeAtp();
    this.checkProtection(atp, dt);

    if (this.ato && !this.eb) {
      this.controlAto(atp);
    }

    this.stepPhysics(dt);
    this.updateStationState();
    this.recordPositionHistory();
    this.updateFollower();
    this.updateOpposing();
    atp = this.recomputeAtp();
    this.lastAtp = atp;

    if (this.eb && this.ebReadyToReset && !this.ebStoppedNotified) {
      this.ebStoppedNotified = true;
      this.notify('EB 已使列车完全停稳 · 请点击面板“复位”后才能重新牵引。', 'warning', { big: true });
    }

    if (this.terminalArrived && this.atStation && this.atStation.terminal) {
      if (!this.recordedKeys[this.atStation.stop.index + ':' + this.dir + ':' + this.tripCount]) {
        if (this.tripTime - this.atStation.since > 1.2) this.evaluateStop(this.atStation.stop);
      }
    }
  };

  Simulator.prototype.complete = function (reason) {
    if (this.completed) return;
    this.completed = true;
    this.completedReason = reason || '值乘结束';
    this.v = 0;
    this.notch = this.ato ? this.notch : 0;
    this.notify('值乘结束：' + this.completedReason + '。', 'success', { big: true });
  };

  Simulator.prototype.reverseAtTerminal = function () {
    if (!this.terminalArrived || !this.atStation) {
      this.notify('尚未到达终点站。', 'warning');
      return false;
    }
    if (this.v > 0.08) {
      this.notify('请先停稳列车。', 'warning');
      return false;
    }
    if (this.doors !== 'closed') {
      this.notify('请先关闭车门再折返。', 'error');
      return false;
    }
    if (this.eb) {
      this.notify('EB 未复位，不能折返。', 'error');
      return false;
    }
    if (this.atStation) this.evaluateStop(this.atStation.stop);
    const oldTerminal = this.service.terminalName;
    const newService = makeService(this.service.periodId, this.service.type, -this.dir, {
      autoReverse: this.service.autoReverse
    });
    this.service = newService;
    this.period = newService.period;
    this.dir = newService.dir;
    this.stops = newService.stops;
    this.schedule = newService.schedule;
    this.leader = new LeaderGhost(newService, newService.headway);
    this.tripCount++;
    this.tripStartTime = this.time;
    this.tripTime = 0;
    this.lastArrivalDeviation = null;
    this.s = newService.stops[0].s;
    this.v = 0;
    this.notch = 0;
    this.nextStopIdx = Math.min(1, this.stops.length - 1);
    this.atStation = {
      stopIdx: 0,
      stop: this.stops[0],
      since: 0,
      terminal: false
    };
    this.terminalArrived = false;
    this.completed = false;
    this.atoDepartAuthorized = false;
    this.leaderState = this.leader.getState(0);
    this.positionHistory = [{ t: 0, s: this.s, v: 0 }];
    this.lastHistoryTime = 0;
    this.followerState = {
      active: true,
      s: this.s - this.dir * (VEHICLE.consistLength + 30),
      speed: 0
    };
    this.followerGap = 30;
    this.buildOpposingStream();
    this.updateFollower();
    this.updateOpposing();
    this.notify('折返作业完成：' + oldTerminal + ' → ' + newService.routeLabel +
      '。请关闭车门后授权发车。', 'success', { big: true });
    return true;
  };

  Simulator.prototype.getStopScore = function () {
    const scored = this.stopRecords.filter(function (r) { return !r.excluded; });
    if (!scored.length) return { score: 100, average: null, count: 0 };
    let sum = 0;
    scored.forEach(function (r) { sum += r.points; });
    return { score: sum / scored.length, average: (scored.reduce(function (a, r) { return a + r.absError; }, 0) / scored.length), count: scored.length };
  };

  Simulator.prototype.getScore = function () {
    const parking = this.getStopScore();
    const ebPenalty = this.stats.ebCount * 18;
    const overspeedPenalty = this.stats.overspeedTime * 0.55;
    const collisionPenalty = this.stats.collision * 40;
    const safety = clamp(100 - ebPenalty - overspeedPenalty - collisionPenalty - this.stats.overspeedEvents * 1.2, 0, 100);
    let punctuality = 100;
    if (this.departureDeviations.length) {
      const avg = this.departureDeviations.reduce(function (a, b) { return a + Math.abs(b); }, 0) / this.departureDeviations.length;
      punctuality = clamp(100 - avg * 0.85, 0, 100);
    }
    const operation = clamp(100 - this.stats.missedStops * 22 - this.stats.doorViolations * 4 - this.atoTakeovers * 1, 0, 100);
    const total = parking.score * 0.40 + safety * 0.30 + punctuality * 0.20 + operation * 0.10;
    let grade = 'D';
    if (total >= 95) grade = 'S';
    else if (total >= 88) grade = 'A';
    else if (total >= 78) grade = 'B';
    else if (total >= 65) grade = 'C';
    return {
      parking: Math.round(parking.score),
      safety: Math.round(safety),
      punctuality: Math.round(punctuality),
      operation: Math.round(operation),
      total: Math.round(total * 10) / 10,
      grade: grade,
      avgParkingError: parking.average,
      stopCount: parking.count,
      ebCount: this.stats.ebCount,
      overspeedTime: this.stats.overspeedTime,
      overspeedEvents: this.stats.overspeedEvents,
      missedStops: this.stats.missedStops,
      doorViolations: this.stats.doorViolations,
      departureDeviations: this.departureDeviations.slice(),
      avgDepartureDelay: this.departureDeviations.length
        ? this.departureDeviations.reduce(function (a, b) { return a + Math.abs(b); }, 0) / this.departureDeviations.length
        : 0
    };
  };

  Simulator.prototype.getScoreReport = function () {
    const s = this.getScore();
    const stopRows = this.stopRecords.filter(function (r) { return !r.excluded; }).map(function (r) {
      return {
        name: r.name,
        error: r.error,
        label: r.label,
        level: r.level,
        color: r.color
      };
    });
    return {
      score: s,
      stops: stopRows,
      reason: this.completedReason,
      service: this.service,
      time: this.tripTime,
      distance: this.stats.distanceM,
      maxSpeed: this.stats.maxSpeedKph,
      energy: this.stats.energyKwh,
      clock: this.getClockText()
    };
  };

  Simulator.prototype.getStatus = function () {
    const atp = this.getAtpStatus();
    const next = this.getNextStop();
    return {
      time: this.time,
      tripTime: this.tripTime,
      clock: this.getClockText(),
      speedKph: this.v * 3.6,
      vPermKph: atp.vPermKph,
      targetDistance: atp.targetDistance,
      targetType: atp.targetType,
      stationDistance: atp.stationDist,
      leaderGap: atp.leaderGap,
      leaderActive: atp.leaderActive,
      leaderS: this.leaderState ? this.leaderState.s : null,
      followerActive: this.followerState ? this.followerState.active : false,
      followerGap: this.followerGap,
      followerS: this.followerState ? this.followerState.s : null,
      followerSpeedKph: this.followerState ? this.followerState.speed * 3.6 : 0,
      opposingActive: this.opposingState ? this.opposingState.active : false,
      opposingGap: this.opposingState ? this.opposingState.gap : Infinity,
      opposingS: this.opposingState ? this.opposingState.s : null,
      opposingSpeedKph: this.opposingState ? this.opposingState.speed * 3.6 : 0,
      nextStation: next,
      nextStopIdx: this.nextStopIdx,
      atStationStopIdx: this.atStation ? this.atStation.stopIdx : -1,
      terminal: this.service.terminal,
      service: this.service,
      notch: this.notch,
      doors: this.doors,
      doorPercent: this.doorPercent(),
      atStation: !!this.atStation,
      station: this.getCurrentStop(),
      terminalArrived: this.terminalArrived,
      eb: this.eb,
      ebReason: this.ebReason,
      ebReadyToReset: this.ebReadyToReset,
      warning: this.warning,
      ato: this.ato,
      atoDepartAuthorized: this.atoDepartAuthorized,
      scheduleCapKph: this.scheduleCapKph,
      atoScheduleLimited: this.atoScheduleLimited,
      lastArrivalDeviation: this.lastArrivalDeviation,
      arrivalDeviations: this.arrivalDeviations.slice(),
      clockBase: this.period.clockBase,
      delay: this.getDelay(),
      score: this.getScore(),
      stats: this.stats,
      stopRecords: this.stopRecords,
      parkingHold: this.parkingHold,
      collision: this.collision,
      completed: this.completed,
      completedReason: this.completedReason,
      atp: atp
    };
  };

  /* ------------------------------------------------------------------------
     9. 导出
     ------------------------------------------------------------------------ */
  const Core = {
    KM: KM,
    LINE: LINE,
    STATIONS: STATIONS,
    STATION_BY_NAME: STATION_BY_NAME,
    VEHICLE: VEHICLE,
    PERIODS: PERIODS,
    ROUTE: ROUTE,
    serviceDefinition: serviceDefinition,
    makeService: makeService,
    buildSchedule: buildSchedule,
    kinematicRunSeconds: kinematicRunSeconds,
    LeaderGhost: LeaderGhost,
    Simulator: Simulator,
    atpCurveSpeedKph: atpCurveSpeedKph,
    brakingDistanceM: brakingDistanceM,
    classifyStopError: classifyStopError,
    formatClock: formatClock,
    formatHM: formatHM,
    formatDuration: formatDuration,
    formatDistance: formatDistance,
    formatDelay: formatDelay,
    pad2: pad2,
    clamp: clamp,
    lerp: lerp,
    smoothstep: smoothstep,
    smootherstep: smootherstep
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Core;
  }
  global.Line1Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
