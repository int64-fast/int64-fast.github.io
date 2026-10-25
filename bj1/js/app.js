/* ==========================================================================
   app.js — UI、输入、声音、渲染循环与游戏流程
   ========================================================================== */
(function () {
  'use strict';

  const C = window.Line1Core;
  const W = window.BJWorld;
  if (!C || !W) {
    showFatal('核心脚本未加载：请确认 js/core.js 与 js/world.js 存在。');
    return;
  }

  const $ = function (id) { return document.getElementById(id); };
  const canvas = $('sim-canvas');
  const clamp = C.clamp;
  const fmtDist = C.formatDistance;
  const fmtDur = C.formatDuration;
  const fmtDelay = C.formatDelay;

  const app = {
    world: null,
    sim: null,
    running: false,
    paused: false,
    helpPaused: false,
    rafId: null,
    lastTs: 0,
    uiAccum: 0,
    speed: 1,
    view: 'cab',
    lookYaw: 0,
    lookPitch: 0,
    dragging: false,
    dragX: 0,
    dragY: 0,
    lastHorn: 0,
    lastClick: 0,
    terminalCountdown: 30,
    terminalTick: 0,
    terminalArmed: false,
    lastDoors: 'closed',
    reportOpen: false,
    scorePending: false,
    scoreTimer: null,
    bigAlertTimer: null,
    lastBig: 0,
    config: {
      period: 'am',
      type: 'large',
      dir: 1,
      ato: true,
      autoReverse: true
    },
    lastStripKey: '',
    lastFocus: -1,
    mapOpen: false,
    mapAccum: 0,
    announceState: { at: false, stopIdx: -1 },
    fatal: false
  };

  window.__BJ1__ = { app: app, C: C };

  /* ------------------------------------------------------------------------
     声音
     ------------------------------------------------------------------------ */
  function AudioEngine() {
    this.ctx = null;
    this.master = null;
    this.whine = null;
    this.whineGain = null;
    this.rumbleGain = null;
    this.rumbleFilter = null;
    this.muted = false;
    this.lastAlarm = 0;
    this._build = false;
  }
  AudioEngine.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(function () {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.20;
      master.connect(ctx.destination);

      // VVVF 逆变器工作声
      const whineGain = ctx.createGain();
      whineGain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1100;
      filter.Q.value = 1.2;
      whineGain.connect(filter);
      filter.connect(master);
      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 55;
      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = 110;
      const g2 = ctx.createGain();
      g2.gain.value = 0.4;
      osc1.connect(whineGain);
      osc2.connect(g2);
      g2.connect(whineGain);
      osc1.start();
      osc2.start();

      // 轮轨滚动噪声
      const len = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (0.3 + 0.7 * Math.random());
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 260;
      nf.Q.value = 0.7;
      const rg = ctx.createGain();
      rg.gain.value = 0;
      noise.connect(nf);
      nf.connect(rg);
      rg.connect(master);
      noise.start();

      this.ctx = ctx;
      this.master = master;
      this.whineGain = whineGain;
      this.whineOsc1 = osc1;
      this.whineOsc2 = osc2;
      this.whineFilter = filter;
      this.rumbleGain = rg;
      this.rumbleFilter = nf;
    } catch (e) {
      console.warn('Audio unavailable', e);
    }
  };
  AudioEngine.prototype.setMuted = function (muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.20, this.ctx.currentTime, 0.05);
  };
  AudioEngine.prototype.update = function (sim, active) {
    if (!this.ctx || !sim) return;
    const now = this.ctx.currentTime;
    if (!active || this.muted) {
      this.whineGain.gain.setTargetAtTime(0, now, 0.08);
      this.rumbleGain.gain.setTargetAtTime(0, now, 0.1);
      return;
    }
    const speed = sim.v * 3.6;
    const traction = sim.notch > 0 ? sim.notch / 4 : 0;
    const braking = sim.notch < 0 ? Math.abs(sim.notch) / 7 : 0;
    const f = 42 + speed * 3.4 + traction * 18 + (sim.ato ? 2.5 : 0);
    this.whineOsc1.frequency.setTargetAtTime(f, now, 0.08);
    this.whineOsc2.frequency.setTargetAtTime(f * 2.02, now, 0.08);
    this.whineFilter.frequency.setTargetAtTime(500 + speed * 32 + traction * 500, now, 0.1);
    const whine = 0.018 + traction * 0.022 + Math.min(0.018, speed * 0.00035) + braking * 0.006;
    this.whineGain.gain.setTargetAtTime(whine, now, 0.09);
    this.rumbleGain.gain.setTargetAtTime(Math.min(0.05, speed * 0.00075) + (sim.eb ? 0.01 : 0), now, 0.1);
    this.rumbleFilter.frequency.setTargetAtTime(180 + speed * 8, now, 0.15);

    // 报警音
    const needAlarm = sim.eb || sim.warning;
    if (needAlarm && performance.now() - this.lastAlarm > (sim.eb ? 520 : 760)) {
      this.lastAlarm = performance.now();
      this.beep(sim.eb ? 880 : 1120, 0.11, sim.eb ? 0.045 : 0.032);
    }
  };
  AudioEngine.prototype.beep = function (freq, dur, gain) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq || 880;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.03, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.1));
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + (dur || 0.1) + 0.02);
  };
  AudioEngine.prototype.chime = function (up) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const notes = up ? [660, 880] : [880, 660];
    notes.forEach(function (f, i) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const start = t + i * 0.16;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.06, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
      o.connect(g);
      g.connect(this.master);
      o.start(start);
      o.stop(start + 0.36);
    }, this);
  };
  AudioEngine.prototype.horn = function () {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [311, 370].forEach(function (f) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1500;
      o.type = 'sawtooth';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.075, t + 0.03);
      g.gain.setValueAtTime(0.075, t + 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
      o.connect(filter);
      filter.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 0.68);
    }, this);
  };
  AudioEngine.prototype.click = function () {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = 190;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.025, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.05);
  };
  const audio = new AudioEngine();

  /* ------------------------------------------------------------------------
     报站语音（Web Speech API）
     ------------------------------------------------------------------------ */
  function transferLinesCn(lines) {
    return lines.map(function (line) { return line + '号线'; }).join('、');
  }
  function transferLinesEn(lines) {
    if (lines.length <= 1) return 'line ' + (lines[0] || '');
    return 'lines ' + lines.slice(0, -1).join(', ') + ' and ' + lines[lines.length - 1];
  }

  function SpeechAnnouncer() {
    // 注意：构造函数里不碰 window.speechSynthesis。
    // HTTPS 站点在用户交互之前调用语音合成会被浏览器拦截，因此真正的初始化
    // 放在「点击进入」手势里（ensure()）。
    this.synth = null;
    this.Utterance = null;
    this.supported = false;
    this.ready = false;
    this.muted = false;
    this.zhVoice = null;
    this.enVoice = null;
    this.token = 0;
  }
  SpeechAnnouncer.prototype.ensure = function () {
    if (this.ready) return this.supported;
    this.ready = true;
    this.synth = window.speechSynthesis || null;
    this.Utterance = window.SpeechSynthesisUtterance || null;
    this.supported = !!(this.synth && this.Utterance);
    if (!this.supported) return false;
    this.loadVoices();
    if (typeof this.synth.addEventListener === 'function') {
      this.synth.addEventListener('voiceschanged', this.loadVoices.bind(this));
    } else {
      this.synth.onvoiceschanged = this.loadVoices.bind(this);
    }
    // 在用户手势内先发一条静音语句，移动端/Chrome 之后才允许真正报站。
    try {
      const primer = new this.Utterance(' ');
      primer.volume = 0;
      primer.lang = 'zh-CN';
      this.synth.speak(primer);
    } catch (e) { /* 解锁失败不影响后续 */ }
    return true;
  };
  SpeechAnnouncer.prototype.loadVoices = function () {
    if (!this.supported) return;
    const voices = this.synth.getVoices() || [];
    this.zhVoice = voices.find(function (v) { return /^zh[-_]CN/i.test(v.lang); }) ||
      voices.find(function (v) { return /^zh/i.test(v.lang); }) || null;
    this.enVoice = voices.find(function (v) { return /^en[-_]US/i.test(v.lang); }) ||
      voices.find(function (v) { return /^en/i.test(v.lang); }) || null;
  };
  SpeechAnnouncer.prototype.cancel = function () {
    this.token++;
    if (this.supported) {
      try { this.synth.cancel(); } catch (e) {}
    }
  };
  SpeechAnnouncer.prototype.setMuted = function (muted) {
    this.muted = !!muted;
    if (this.muted) this.cancel();
  };
  SpeechAnnouncer.prototype.speakPair = function (zhText, enText) {
    if (!this.supported || this.muted) return;
    const token = ++this.token;
    try { this.synth.cancel(); } catch (e) {}
    const synth = this.synth;
    const Utterance = this.Utterance;
    const self = this;
    const speak = function () {
      if (token !== self.token || self.muted) return;
      const zh = new Utterance(zhText);
      zh.lang = 'zh-CN';
      if (self.zhVoice) zh.voice = self.zhVoice;
      zh.rate = 0.93;
      zh.pitch = 1.0;
      zh.volume = 1.0;
      synth.speak(zh);
      if (enText) {
        const en = new Utterance(enText);
        en.lang = 'en-US';
        if (self.enVoice) en.voice = self.enVoice;
        en.rate = 0.96;
        en.pitch = 1.0;
        en.volume = 1.0;
        synth.speak(en);
      }
    };
    // Chrome 在 cancel 后立刻 speak 偶尔会吞掉第一条，稍作延迟。
    setTimeout(speak, 35);
  };
  SpeechAnnouncer.prototype.announceArrival = function (station) {
    if (!station) return;
    this.speakPair(
      station.name + '站到了。',
      'We are arriving at ' + station.en + ' station.'
    );
  };
  SpeechAnnouncer.prototype.announceDeparture = function (nextStop) {
    if (!nextStop) return;
    const st = nextStop.station || nextStop;
    const transfer = st.transfer || [];
    let zh = '列车运行前方是' + st.name + '站，下车的乘客请提前做好准备。';
    let en = 'The next station is ' + st.en + '. Please get ready for your arrival.';
    if (transfer.length) {
      zh += '各位乘客，' + st.name + '站是换乘车站，换乘地铁' +
        transferLinesCn(transfer) + '的乘客，请从' + st.name + '站下车。';
      en += ' ' + st.en + ' is a transfer station. Passengers can take the subway ' +
        transferLinesEn(transfer) + '.';
    }
    this.speakPair(zh, en);
  };
  const announcer = new SpeechAnnouncer();

  /* ------------------------------------------------------------------------
     速度表刻度
     ------------------------------------------------------------------------ */
  function polar(cx, cy, r, deg) {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r };
  }
  function arcPath(fractionStart, fractionEnd) {
    if (fractionEnd <= fractionStart + 0.0001) return '';
    const startDeg = 140 + 260 * fractionStart;
    const endDeg = 140 + 260 * fractionEnd;
    const a = polar(110, 110, 88, startDeg);
    const b = polar(110, 110, 88, endDeg);
    const large = (endDeg - startDeg) > 180 ? 1 : 0;
    return 'M ' + a.x.toFixed(2) + ' ' + a.y.toFixed(2) +
      ' A 88 88 0 ' + large + ' 1 ' + b.x.toFixed(2) + ' ' + b.y.toFixed(2);
  }
  function initGauge() {
    $('gaugeTrack').setAttribute('d', arcPath(0, 1));
    let ticks = '';
    for (let i = 0; i <= 8; i++) {
      const value = i * 10;
      const deg = 140 + 260 * (value / 80);
      const p1 = polar(110, 110, 75, deg);
      const p2 = polar(110, 110, 84, deg);
      const major = value % 20 === 0;
      ticks += '<line class="' + (major ? 'major' : '') + '" x1="' + p1.x.toFixed(1) + '" y1="' + p1.y.toFixed(1) +
        '" x2="' + p2.x.toFixed(1) + '" y2="' + p2.y.toFixed(1) + '"></line>';
      if (major) {
        const pt = polar(110, 110, 64, deg);
        ticks += '<text class="major" x="' + pt.x.toFixed(1) + '" y="' + (pt.y + 3.5).toFixed(1) + '">' + value + '</text>';
      }
    }
    $('gaugeTicks').innerHTML = ticks;
    // ATP 外圈指针改为朝外箭头
    $('atpNeedle').innerHTML = '<path d="M211 110 L203 104 L203 116 Z"></path>';
  }

  /* ------------------------------------------------------------------------
     开始界面
     ------------------------------------------------------------------------ */
  function serviceDef() {
    return C.serviceDefinition(app.config.period, app.config.type);
  }
  function updateStartUI() {
    const def = serviceDef();
    document.querySelectorAll('#periodSegment .seg-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.period === app.config.period);
    });
    document.querySelectorAll('#typeCards .route-card').forEach(function (b) {
      b.classList.toggle('active', b.dataset.type === app.config.type);
    });
    document.querySelectorAll('#modeToggle .mode-btn').forEach(function (b) {
      b.classList.toggle('active', (b.dataset.ato === '1') === app.config.ato);
    });
    $('smallRouteName').textContent = app.config.period === 'am' ? '公主坟 ⇄ 果园' : '古城 ⇄ 果园';
    $('smallRouteMeta').textContent = app.config.period === 'am'
      ? '工作日早高峰 · 与全程车共线 · 终点自动折返'
      : '工作日晚高峰 · 与全程车共线 · 终点自动折返';
    const dirEast = document.querySelector('#directionRow [data-dir="1"]');
    const dirWest = document.querySelector('#directionRow [data-dir="-1"]');
    const eastFrom = C.STATIONS[def.min].name;
    const eastTo = C.STATIONS[def.max].name;
    dirEast.querySelector('span').textContent = '东行';
    dirEast.querySelector('small').textContent = eastFrom + ' → ' + eastTo;
    dirWest.querySelector('span').textContent = '西行';
    dirWest.querySelector('small').textContent = eastTo + ' → ' + eastFrom;
    document.querySelectorAll('#directionRow .dir-btn').forEach(function (b) {
      b.classList.toggle('active', Number(b.dataset.dir) === app.config.dir);
    });
    const revToggle = $('reverseToggle');
    revToggle.classList.toggle('on', app.config.autoReverse);
    revToggle.parentElement.style.opacity = app.config.type === 'small' ? '1' : '0.45';
    $('reverseToggle').disabled = app.config.type !== 'small';
    const period = C.PERIODS[app.config.period];
    $('headwayBadge').textContent = period.headwayText;
    $('periodBadge').textContent = period.shortLabel;
  }

  function onStartConfigClick(e) {
    const seg = e.target.closest('#periodSegment .seg-btn');
    if (seg) {
      app.config.period = seg.dataset.period;
      updateStartUI();
      return;
    }
    const card = e.target.closest('#typeCards .route-card');
    if (card) {
      app.config.type = card.dataset.type;
      updateStartUI();
      return;
    }
    const dir = e.target.closest('#directionRow .dir-btn');
    if (dir) {
      app.config.dir = Number(dir.dataset.dir);
      updateStartUI();
      return;
    }
    const mode = e.target.closest('#modeToggle .mode-btn');
    if (mode) {
      app.config.ato = mode.dataset.ato === '1';
      updateStartUI();
    }
  }

  /* ------------------------------------------------------------------------
     点击进入
     HTTPS 页面在用户交互前不允许 AudioContext 运行、也不允许语音合成发声。
     所以「进入」这个动作必须发生在真实点击的同步栈里：先建音频引擎，再进菜单。
     ------------------------------------------------------------------------ */
  const entry = { entered: false };

  function enterSimulator(options) {
    if (entry.entered) return false;
    entry.entered = true;
    if (!entry.enteredAt) entry.enteredAt = performance.now();
    const silent = !!(options && options.silent);
    // 关键：以下两个 ensure 必须在点击事件的同步调用栈里执行
    if (!silent) {
      audio.ensure();
      announcer.ensure();
    }
    const gate = $('entry-gate');
    if (gate) {
      gate.classList.add('leaving');
      setTimeout(function () { gate.classList.add('hidden'); }, 380);
    }
    document.body.classList.add('entered');
    if ($('start-screen')) $('start-screen').classList.remove('hidden');
    return true;
  }

  /* ------------------------------------------------------------------------
     启动 / 返回主菜单
     ------------------------------------------------------------------------ */
  function startRun() {
    if (app.starting) return;
    app.starting = true;
    const service = C.makeService(app.config.period, app.config.type, app.config.dir, {
      autoReverse: app.config.autoReverse
    });
    audio.ensure();
    $('loading-overlay').classList.remove('hidden');
    $('start-screen').classList.add('hidden');
    setTimeout(function () {
      try {
        if (!app.world) app.world = W.createWorld(canvas);
        app.sim = new C.Simulator(service, { ato: app.config.ato });
        app.service = service;
        app.world.setDestination(service.terminalName);
        app.world.setOpposingDestination(service.dir > 0 ? '古城' : '环球度假区');
        app.speed = 1;
        app.paused = false;
        app.helpPaused = false;
        app.view = 'cab';
        app.lookYaw = 0;
        app.lookPitch = 0;
        app.terminalCountdown = 30;
        app.terminalTick = 0;
        app.terminalArmed = false;
        app.lastDoors = 'closed';
        app.reportOpen = false;
        app.scorePending = false;
        if (app.scoreTimer) { clearTimeout(app.scoreTimer); app.scoreTimer = null; }
        if (app.bigAlertTimer) { clearTimeout(app.bigAlertTimer); app.bigAlertTimer = null; }
        app.lastStripKey = '';
        app.lastFocus = -1;
        app.uiAccum = 0;
        app.lastTs = performance.now();
        app.running = true;
        app.starting = false;
        document.querySelectorAll('.speed-btn').forEach(function (b) {
          b.classList.toggle('active', b.dataset.speed === '1');
        });
        $('loading-overlay').classList.add('hidden');
        $('game-ui').classList.remove('hidden');
        $('start-screen').classList.add('hidden');
        $('help-modal').classList.add('hidden');
        $('pause-modal').classList.add('hidden');
        $('score-modal').classList.add('hidden');
        $('terminal-banner').classList.add('hidden');
        $('big-alert').classList.add('hidden');
        $('toast-stack').innerHTML = '';
        $('center-hint').classList.remove('show');
        toggleTrackingMap(false);
        resetAnnouncementState(app.sim);
        if (app.world && app.world.getCameraMode() !== 'cab') app.world.toggleCameraMode();
        app.world.resize();
        app.world.update(app.sim, 0.016, { mode: 'cab', yaw: 0, pitch: 0 });
        updateStaticHud();
        updateHud(true);
        audio.ensure();
        if (app.rafId == null) app.rafId = requestAnimationFrame(loop);
        applyQueryExtras();
      } catch (err) {
        app.starting = false;
        console.error(err);
        $('loading-overlay').classList.add('hidden');
        showFatal(err && err.message ? err.message : String(err));
      }
    }, 60);
  }

  function returnToMenu() {
    app.running = false;
    app.paused = false;
    app.helpPaused = false;
    app.scorePending = false;
    if (app.scoreTimer) { clearTimeout(app.scoreTimer); app.scoreTimer = null; }
    if (app.bigAlertTimer) { clearTimeout(app.bigAlertTimer); app.bigAlertTimer = null; }
    if (app.rafId != null) {
      cancelAnimationFrame(app.rafId);
      app.rafId = null;
    }
    $('game-ui').classList.add('hidden');
    $('pause-modal').classList.add('hidden');
    $('score-modal').classList.add('hidden');
    $('help-modal').classList.add('hidden');
    $('terminal-banner').classList.add('hidden');
    $('start-screen').classList.remove('hidden');
    $('toast-stack').innerHTML = '';
    toggleTrackingMap(false);
    announcer.cancel();
    app.reportOpen = false;
    audio.update(app.sim, false);
  }

  function pauseGame(showModal) {
    if (!app.running) return;
    app.paused = true;
    if (showModal !== false) $('pause-modal').classList.remove('hidden');
    $('big-alert').classList.add('hidden');
    announcer.cancel();
    audio.update(app.sim, false);
  }
  function resumeGame() {
    if (!app.running) return;
    app.paused = false;
    app.helpPaused = false;
    app.lastTs = performance.now();
    $('pause-modal').classList.add('hidden');
    $('help-modal').classList.add('hidden');
  }

  /* ------------------------------------------------------------------------
     HUD
     ------------------------------------------------------------------------ */
  function setText(id, text) {
    const el = $(id);
    if (el && el.textContent !== text) el.textContent = text;
  }

  function resetAnnouncementState(sim) {
    app.announceState = {
      at: !!(sim && sim.atStation),
      stopIdx: sim && sim.atStation ? sim.atStation.stopIdx : -1
    };
    announcer.cancel();
  }

  function updateAnnouncements(sim) {
    if (!sim || app.paused || app.reportOpen || sim.completed) return;
    const state = app.announceState;
    const at = !!sim.atStation;
    const idx = at ? sim.atStation.stopIdx : -1;
    if (at && idx > 0 && (!state.at || state.stopIdx !== idx)) {
      announcer.announceArrival(sim.atStation.stop.station);
    } else if (!at && state.at) {
      const next = sim.getNextStop();
      if (next) announcer.announceDeparture(next);
    }
    state.at = at;
    state.stopIdx = idx;
  }

  function toggleTrackingMap(force) {
    const next = typeof force === 'boolean' ? force : !app.mapOpen;
    app.mapOpen = next;
    $('tracking-map').classList.toggle('hidden', !next);
    $('mapBtn').classList.toggle('active', next);
    if (next && app.sim) {
      drawTrackingMap(app.sim.getStatus());
    }
  }

  function drawTrackingMap(s) {
    if (!app.mapOpen || !app.sim) return;
    const canvas = $('trackingCanvas');
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(320, rect.width || 800);
    const cssH = Math.max(110, rect.height || 150);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const sim = app.sim;
    const dir = sim.dir;
    const playerS = sim.s;
    const L = C.VEHICLE.consistLength;
    const leadGap = s.leaderActive && isFinite(s.leaderGap) ? Math.max(0, s.leaderGap) : null;
    const followGap = s.followerActive && isFinite(s.followerGap) ? Math.max(0, s.followerGap) : null;
    const leaderRel = leadGap != null ? leadGap + L : null;
    const followerRel = followGap != null ? -(followGap + L) : null;

    const stops = s.service.stops;
    let prevStop = null;
    let nextStop = null;
    if (s.atStation) {
      const idx = Math.max(0, s.atStationStopIdx);
      prevStop = stops[Math.max(0, idx - 1)] || null;
      nextStop = stops[Math.min(stops.length - 1, idx + 1)] || null;
    } else {
      const idx = Math.min(Math.max(0, s.nextStopIdx), stops.length - 1);
      nextStop = stops[idx] || null;
      prevStop = stops[Math.max(0, idx - 1)] || null;
    }
    const prevRel = prevStop ? dir * (prevStop.s - playerS) : null;
    const nextRel = nextStop ? dir * (nextStop.s - playerS) : null;

    let minRel = -360;
    let maxRel = 760;
    if (followerRel != null) minRel = Math.min(minRel, followerRel - 260);
    if (leaderRel != null) maxRel = Math.max(maxRel, leaderRel + 260);
    if (prevRel != null) minRel = Math.min(minRel, prevRel - 120);
    if (nextRel != null) maxRel = Math.max(maxRel, nextRel + 120);
    minRel -= 100;
    maxRel += 100;
    if (maxRel - minRel < 800) {
      const mid = (minRel + maxRel) * 0.5;
      minRel = mid - 400;
      maxRel = mid + 400;
    }

    const padX = 38;
    const plotW = cssW - padX * 2;
    const yLine = 74;
    const xOf = function (rel) {
      return padX + ((rel - minRel) / (maxRel - minRel)) * plotW;
    };

    // 当前站区间底色
    if (prevRel != null && nextRel != null) {
      const x1 = xOf(dir * (prevStop.s - playerS));
      const x2 = xOf(dir * (nextStop.s - playerS));
      const left = Math.max(padX, Math.min(x1, x2));
      const right = Math.min(cssW - padX, Math.max(x1, x2));
      if (right > left) {
        const grd = ctx.createLinearGradient(left, 0, right, 0);
        grd.addColorStop(0, 'rgba(111,229,243,.015)');
        grd.addColorStop(.5, 'rgba(111,229,243,.09)');
        grd.addColorStop(1, 'rgba(111,229,243,.015)');
        ctx.fillStyle = grd;
        ctx.fillRect(left, yLine - 24, right - left, 55);
      }
    }

    // 主线路
    const lineGrad = ctx.createLinearGradient(padX, 0, cssW - padX, 0);
    lineGrad.addColorStop(0, 'rgba(139,169,183,.18)');
    lineGrad.addColorStop(.5, 'rgba(139,169,183,.55)');
    lineGrad.addColorStop(1, 'rgba(139,169,183,.18)');
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padX, yLine);
    ctx.lineTo(cssW - padX, yLine);
    ctx.stroke();

    // 车站刻度
    ctx.font = '10px "Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let lastLabelX = -999;
    stops.forEach(function (stop) {
      const rel = dir * (stop.s - playerS);
      if (rel < minRel || rel > maxRel) return;
      const x = xOf(rel);
      const isNext = nextStop && stop.index === nextStop.index;
      const isCurrent = s.atStation && s.station && s.station.index === stop.index;
      ctx.strokeStyle = isNext || isCurrent ? 'rgba(111,229,243,.85)' : 'rgba(139,169,183,.42)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, yLine - 7);
      ctx.lineTo(x, yLine + 7);
      ctx.stroke();
      ctx.fillStyle = isNext || isCurrent ? '#8eeaf5' : '#78919e';
      ctx.beginPath();
      ctx.arc(x, yLine, isNext || isCurrent ? 3.4 : 2.3, 0, Math.PI * 2);
      ctx.fill();
      if (Math.abs(x - lastLabelX) > 50 || isNext || isCurrent) {
        ctx.fillStyle = isNext || isCurrent ? '#dff8fb' : '#8aa0ab';
        ctx.font = (isNext || isCurrent ? '600 ' : '') + '10px "Microsoft YaHei",sans-serif';
        ctx.fillText(stop.name, x, yLine + 16);
        lastLabelX = x;
      }
    });

    function drawDot(rel, color, glow, label, distText, yOffset) {
      const x = clamp(xOf(rel), padX + 5, cssW - padX - 5);
      const y = yLine + (yOffset || 0);
      ctx.save();
      ctx.shadowColor = glow;
      ctx.shadowBlur = 12;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 6.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = '600 10px "Microsoft YaHei",sans-serif';
      ctx.fillStyle = color;
      ctx.fillText(label, x, y - 10);
      if (distText) {
        ctx.font = '9px "Bahnschrift","Segoe UI",sans-serif';
        ctx.fillStyle = 'rgba(220,236,242,.72)';
        ctx.fillText(distText, x, y - 21);
      }
    }

    if (followerRel != null) {
      drawDot(followerRel, '#f5bc4e', 'rgba(245,188,78,.8)', '后车',
        '-' + fmtDist(followGap));
    }
    if (leaderRel != null) {
      drawDot(leaderRel, '#ff4d52', 'rgba(255,77,82,.85)', '前车',
        '+' + fmtDist(leadGap));
    }
    drawDot(0, '#74df9d', 'rgba(116,223,157,.95)', '本列', null);

    // 两端方向提示
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = '8px "Bahnschrift","Segoe UI",sans-serif';
    ctx.fillStyle = 'rgba(112,139,151,.8)';
    ctx.fillText('← 后方', padX, cssH - 6);
    ctx.textAlign = 'right';
    ctx.fillText('前方 →', cssW - padX, cssH - 6);

    const intervalLabel = (prevStop ? prevStop.name : '—') + ' — ' +
      (nextStop ? nextStop.name : '—');
    setText('mapInterval', '当前区间 · ' + intervalLabel);
    setText('mapLeaderValue', leadGap != null ? fmtDist(leadGap) : '—');
    setText('mapFollowerValue', followGap != null ? fmtDist(followGap) : '—');
  }
  function updateStaticHud() {
    if (!app.sim) return;
    const svc = app.sim.service;
    $('terminalName').textContent = svc.terminalName;
    $('serviceType').textContent = svc.def.label;
    $('routeLine').textContent = svc.originName + ' → ' + svc.terminalName + ' · ' + svc.directionText;
    $('headwayBadge').textContent = svc.headwayText;
    $('periodBadge').textContent = C.PERIODS[svc.periodId].shortLabel;
    $('modeText').textContent = app.sim.ato ? 'ATO 自动驾驶' : 'ATP 人工驾驶';
    $('modeBadge').textContent = app.sim.ato ? 'ATO' : 'ATP';
    $('speedModeText').textContent = app.sim.ato ? 'ATO 自动' : 'ATP 人工';
    $('atoState').textContent = app.sim.ato ? '开' : '关';
    $('departHint').textContent = app.sim.ato ? 'ATO' : '手动';
    $('atoBtn').classList.toggle('active', app.sim.ato);
    $('atoLamp').classList.toggle('on', app.sim.ato);
    $('atoLamp').textContent = app.sim.ato ? 'ATO 激活' : 'ATP 人工';
    $('atoLamp').classList.toggle('warn', !app.sim.ato);
    const stopOrder = app.sim.atStation ? app.sim.atStation.stopIdx : app.sim.nextStopIdx;
    $('stopProgress').textContent = Math.min((Number.isFinite(stopOrder) ? stopOrder : 0) + 1, svc.stops.length) + ' / ' + svc.stops.length + ' 站';
  }

  function updateHud(force) {
    if (!app.sim) return;
    const sim = app.sim;
    const s = sim.getStatus();
    const atp = s.atp;
    const speedKph = s.speedKph;
    const display = s.atStation ? s.station : s.nextStation;
    const displayIsCurrent = !!s.atStation;
    const period = C.PERIODS[s.service.periodId];

    // 顶部
    setText('nextLabel', displayIsCurrent ? '当前站' : '下一站');
    setText('nextDistance', displayIsCurrent ? (s.terminalArrived ? '终点' : '站台 · 停稳') : fmtDist(Math.max(0, s.stationDistance)));
    setText('nextStationName', display ? display.name : '—');
    setText('nextStationEn', display ? display.en : '—');
    const transfer = display && display.transfer && display.transfer.length
      ? '换乘 ' + display.transfer.map(function (l) { return l + '号线'; }).join('、')
      : '';
    setText('nextTransfer', transfer);
    setText('simClock', s.clock);
    setText('periodBadge', period.shortLabel);

    // 速度表
    const speedFrac = clamp(speedKph / 80, 0, 1);
    $('gaugeArc').setAttribute('d', arcPath(0, Math.max(0.001, speedFrac)));
    $('speedNeedle').setAttribute('transform', 'rotate(' + (140 + 260 * speedFrac).toFixed(2) + ' 110 110)');
    const atpFrac = clamp(s.vPermKph / 80, 0, 1);
    $('atpNeedle').setAttribute('transform', 'rotate(' + (140 + 260 * atpFrac).toFixed(2) + ' 110 110)');
    setText('speedValue', String(Math.round(speedKph)));
    setText('permitValue', String(Math.round(s.vPermKph)));
    setText('targetValue', fmtDist(atp.targetDistance));
    setText('targetType', atp.targetType === 'leader' ? '前方列车' : (atp.targetType === 'station' ? '下一停车点' : '线路终点'));
    const ratio = atp.vPermKph > 0.5 ? clamp(speedKph / atp.vPermKph, 0, 1.3) : (speedKph > 0.5 ? 1.3 : 0);
    $('curveFill').style.width = Math.min(100, ratio * 100).toFixed(1) + '%';
    $('atpMark').style.left = '100%';
    let atpText = 'ATP 监控中';
    let atpClass = '';
    if (s.eb) { atpText = 'EB 已施加 · 停稳复位'; atpClass = 'over'; }
    else if (s.warning) { atpText = 'ATP 超速报警'; atpClass = 'over'; }
    else if (s.atStation) { atpText = '站台停车 · 允许速度 0'; }
    else if (atp.targetType === 'leader' && atp.leaderGap < 260) { atpText = '追踪制动曲线'; }
    else if (atp.stationDist < 520) { atpText = '进站制动曲线'; }
    setText('atpStatus', atpText);
    document.querySelector('.curve-status').classList.toggle('over', !!atpClass);
    $('speedValue').style.color = s.eb ? '#ff645a' : (s.warning ? '#ffb347' : '#f3f8f9');

    // 追踪
    setText('leaderDistance', atp.leaderActive ? fmtDist(Math.max(0, atp.leaderGap)) : '—');
    setText('leaderSpeed', atp.leaderActive ? Math.round(atp.leaderSpeed * 3.6) + ' km/h' : '—');
    setText('followerDistance', s.followerActive ? fmtDist(Math.max(0, s.followerGap)) : '—');
    setText('followerSpeed', s.followerActive ? Math.round(s.followerSpeedKph) + ' km/h' : '—');
    setText('headwayBadge', s.service.headwayText);
    updateAtpProfile(atp);
    const doorLamp = $('doorLamp');
    doorLamp.textContent = s.doors === 'closed' ? '车门 关闭' : (s.doors === 'open' ? '车门 开启' : '车门 动作中');
    doorLamp.className = 'lamp ' + (s.doors === 'closed' ? 'on' : (s.doors === 'open' ? 'warn' : ''));
    $('holdLamp').classList.toggle('on', !!s.parkingHold && s.speedKph < 1);
    $('holdLamp').textContent = s.parkingHold && s.speedKph < 1 ? '保持制动' : '牵引/滑行';
    $('atoLamp').classList.toggle('on', s.ato);
    $('atoLamp').classList.toggle('warn', !s.ato);
    $('atoLamp').textContent = s.ato ? 'ATO 激活' : 'ATP 人工';

    // 评分
    const score = s.score;
    setText('liveScore', String(Math.round(score.total)));
    setText('liveGrade', score.grade);
    $('liveGrade').style.color = score.total >= 88 ? '#74df9d' : (score.total >= 70 ? '#f5bc4e' : '#ff584d');
    setText('scoreParking', score.stopCount ? String(score.parking) : '—');
    setText('scoreSafety', String(score.safety));
    setText('scorePunctual', String(score.punctuality));
    setText('scoreOperation', String(score.operation));
    $('barParking').style.width = (score.stopCount ? score.parking : 0) + '%';
    $('barSafety').style.width = score.safety + '%';
    $('barPunctual').style.width = score.punctuality + '%';
    $('barOperation').style.width = score.operation + '%';
    const barColor = function (v) { return v >= 85 ? '#74df9d' : (v >= 60 ? '#f5bc4e' : '#ff584d'); };
    $('barParking').style.background = barColor(score.parking);
    $('barSafety').style.background = barColor(score.safety);
    $('barPunctual').style.background = barColor(score.punctuality);
    $('barOperation').style.background = barColor(score.operation);

    // 右侧控制
    setText('modeBadge', s.ato ? 'ATO' : 'ATP');
    setText('modeText', s.ato
      ? (s.atoScheduleLimited ? 'ATO 自动驾驶 · 按图控速/惰行' : 'ATO 自动驾驶')
      : 'ATP 人工驾驶');
    setText('speedModeText', s.ato
      ? (s.atoScheduleLimited ? 'ATO 按图控速' : 'ATO 自动')
      : 'ATP 人工');
    setText('atoState', s.ato ? '开' : '关');
    setText('departHint', s.ato ? 'ATO' : '手动');
    $('atoBtn').classList.toggle('active', s.ato);
    $('atoBtn').classList.toggle('on', s.ato);
    $('serviceType').textContent = s.service.def.label;
    $('terminalName').textContent = s.service.terminalName;
    $('routeLine').textContent = s.service.originName + ' → ' + s.service.terminalName + ' · ' + s.service.directionText;
    const stopOrder = s.atStation ? s.atStationStopIdx : s.nextStopIdx;
    setText('stopProgress', Math.min((Number.isFinite(stopOrder) ? stopOrder : 0) + 1, s.service.stops.length) + ' / ' + s.service.stops.length + ' 站');
    const readout = s.eb ? 'EB · 紧急制动' : (s.notch > 0 ? 'P' + s.notch + ' · 牵引' : (s.notch < 0 ? 'B' + (-s.notch) + ' · 制动' : '0 · 运转位'));
    setText('handleReadout', readout);
    document.querySelectorAll('.notch-tile').forEach(function (b) {
      b.classList.toggle('active', Number(b.dataset.notch) === s.notch);
    });
    setText('doorBtnState', s.doors === 'closed' ? '关闭' : (s.doors === 'open' ? '开启' : '动作中'));
    $('doorBtn').classList.toggle('active', s.doors === 'open');
    $('doorBtn').classList.toggle('warn', s.doors === 'opening' || s.doors === 'closing');
    $('departBtn').classList.toggle('active', s.ato && s.atoDepartAuthorized);
    $('resetBtn').classList.toggle('active', s.eb && s.ebReadyToReset);
    setText('resetHint', s.eb ? (s.ebReadyToReset ? '可复位' : '等待停稳') : 'R');

    // 底部
    const originS = s.service.origin.s;
    const terminalS = s.service.terminal.s;
    const total = Math.max(1, Math.abs(terminalS - originS));
    const travelled = clamp(Math.abs(sim.s - originS), 0, total);
    const pct = travelled / total * 100;
    $('progressFill').style.width = pct.toFixed(1) + '%';
    $('progressTrain').style.left = pct.toFixed(2) + '%';
    setText('progressPercent', Math.round(pct) + '%');
    const nearest = nearestStation(sim.s);
    const stationKm = s.atStation && s.station
      ? s.station.km
      : clamp((sim.s - C.LINE.stationOffsetM) / 1000, 0, C.LINE.stationSpanKm);
    setText('positionText', nearest.name + ' · ' + stationKm.toFixed(2) + ' km');
    setText('delayText', fmtDelay(s.delay));
    $('delayText').style.color = Math.abs(s.delay) <= 10 ? '#74df9d' : (Math.abs(s.delay) <= 60 ? '#f5bc4e' : '#ff584d');
    setText('scoreSmall', Math.round(score.total) + ' 分');
    $('scoreSmall').style.color = score.total >= 88 ? '#74df9d' : (score.total >= 70 ? '#f5bc4e' : '#ff584d');

    // 中央状态提示
    updateCenterHint(s);

    // 按钮状态
    $('ebBtn').classList.toggle('active', s.eb);
    $('ebBtn').classList.toggle('eb-on', s.eb);
    $('departBtn').classList.toggle('disabled', !s.atStation || s.doors !== 'closed' || s.eb);
    $('tractionBtn').classList.toggle('flash', s.notch > 0);
    $('brakeBtn').classList.toggle('flash', s.notch < 0);
    $('liveGrade').textContent = score.grade;

    updateRouteStrip(s);
    updateMeters(s);
    updateTerminalBanner(s);
    updateBigAlert(s);
    if (app.mapOpen) drawTrackingMap(s);
  }

  function nearestStation(sM) {
    let best = C.STATIONS[0];
    let bestD = Infinity;
    C.STATIONS.forEach(function (st) {
      const d = Math.abs(st.s - sM);
      if (d < bestD) { bestD = d; best = st; }
    });
    return best;
  }

  function updateCenterHint(s) {
    let hint = '';
    if (s.completed) hint = '';
    else if (s.eb) hint = s.ebReadyToReset
      ? 'EB 已锁闭 · 列车已停稳 · 点击“复位”解除'
      : 'EB 已锁闭 · 等待列车完全停稳后再复位';
    else if (s.atStation && s.terminalArrived) hint = '终点站 · ' + (s.doors === 'closed' ? '可结束值乘' : '请组织乘客下车');
    else if (s.atStation) {
      const sched = app.sim.getScheduleEntry(s.atStationStopIdx);
      const remain = sched ? sched.dep - app.sim.tripTime : 0;
      const plan = sched ? C.formatClock(sched.dep, app.sim.period.clockBase).slice(0, 5) : '—';
      const timing = remain >= 0 ? '计划发车 ' + plan + ' · 剩余 ' + Math.ceil(remain) + 's' : '已晚点 ' + fmtDur(-remain);
      if (s.doors === 'closed') {
        hint = s.ato ? '停稳 · O 开门 · ' + timing + ' · 关妥后 SPACE 发车' : '停稳 · O 开门 · ' + timing + ' · 关妥后推牵引';
      } else {
        hint = '车门开启 · ' + timing + ' · 牵引联锁已生效';
      }
    }
    else if (s.doors === 'open') hint = '车门开启 · 牵引联锁已生效';
    else if (s.speedKph < 1 && !s.atStation) hint = '未在站台停车区域 · 请继续对位';
    else if (s.warning) hint = 'ATP 超速 · 立即制动';
    const el = $('center-hint');
    el.classList.toggle('show', !!hint);
    setText('centerHintText', hint);
  }

  function updateAtpProfile(atp) {
    const W = 260;
    const H = 58;
    const left = 6;
    const right = 254;
    const top = 5;
    const bottom = 50;
    let target = atp.targetDistance;
    let domain = 600;
    if (isFinite(target) && target > 0) {
      domain = Math.min(1600, Math.max(120, target));
    } else if (atp.targetType === 'none') {
      domain = 600;
    }
    let line = '';
    let area = '';
    const N = 44;
    for (let i = 0; i <= N; i++) {
      const ahead = domain * (i / N);
      let v;
      if (atp.targetType === 'leader' && isFinite(target)) {
        v = C.atpCurveSpeedKph(Math.max(0, target - ahead - 13), 0.85 * 1.05, 1.0);
      } else if (atp.targetType === 'station' && isFinite(target)) {
        const remain = Math.max(0, target - ahead);
        v = C.atpCurveSpeedKph(Math.max(0, remain - 1.2), 0.85, 1.1);
        if (remain > 0.12 && remain < 6.5) v = Math.max(v, 3.2);
      } else {
        v = 70;
      }
      v = clamp(v, 0, 70);
      const x = left + (ahead / domain) * (right - left);
      const y = bottom - (v / 70) * (bottom - top);
      line += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
    }
    area = line + 'L ' + right + ' ' + bottom + ' L ' + left + ' ' + bottom + ' Z';
    $('atpProfileLine').setAttribute('d', line.trim());
    $('atpProfileFill').setAttribute('d', area);
    const dotY = bottom - (clamp(atp.vPermKph, 0, 70) / 70) * (bottom - top);
    $('atpProfileDot').setAttribute('cx', String(left));
    $('atpProfileDot').setAttribute('cy', dotY.toFixed(1));
    const tx = left + (Math.min(domain, isFinite(target) ? target : domain) / domain) * (right - left);
    $('atpProfileTargetLine').setAttribute('x1', tx.toFixed(1));
    $('atpProfileTargetLine').setAttribute('x2', tx.toFixed(1));
    $('atpProfileTarget').textContent = atp.targetType === 'leader'
      ? '前行列车 · ' + fmtDist(target)
      : (atp.targetType === 'station' ? '停车点 · ' + fmtDist(target) : '线路限速 70');
  }

  function updateMeters(s) {
    const atp = s.atp;
    // 保持占位，具体值已在 updateHud 设置；这里处理动态 class
    const modeBadge = $('modeBadge');
    modeBadge.classList.toggle('manual', !s.ato);
    modeBadge.textContent = s.ato ? 'ATO' : 'ATP';
  }

  function updateRouteStrip(s) {
    const sim = app.sim;
    const stops = s.service.stops;
    const nextIdx = Number.isFinite(s.nextStopIdx) ? s.nextStopIdx : 0;
    const focus = s.atStation ? Math.max(0, s.atStationStopIdx) : Math.max(0, nextIdx - 1);
    const key = s.service.id + ':' + focus + ':' + (s.atStation ? 'A' : 'R') + ':' + nextIdx;
    if (key === app.lastStripKey && !app.forceStrip) return;
    app.lastStripKey = key;
    app.forceStrip = false;
    const windowSize = 7;
    let start = Math.max(0, focus - 3);
    let end = Math.min(stops.length, start + windowSize);
    start = Math.max(0, end - windowSize);
    let html = '';
    for (let i = start; i < end; i++) {
      const stop = stops[i];
      let cls = 'route-stop';
      if (i < focus) cls += ' passed';
      if (i === focus && s.atStation) cls += ' current';
      if (i === nextIdx && !s.atStation) cls += ' next';
      if (i === 0 && !s.atStation && focus === 0) cls += ' current';
      const terminalBadge = (i === stops.length - 1) ? '<span class="mini-badge">终点</span>' : '';
      html += '<div class="' + cls + '">' + stop.name + terminalBadge + '</div>';
    }
    $('routeStrip').innerHTML = html;
  }

  function updateBigAlert(s) {
    if (s.eb && !app.bigAlertShownEb) {
      app.bigAlertShownEb = true;
      showBigAlert('紧急制动 EB', s.ebReason || 'ATP 防护', 'danger', 2600);
    }
    if (!s.eb) app.bigAlertShownEb = false;
  }

  function showBigAlert(title, sub, cls, ms) {
    const el = $('big-alert');
    $('bigAlertTitle').textContent = title;
    $('bigAlertSub').textContent = sub || '';
    el.className = '';
    if (cls) el.classList.add(cls);
    el.classList.remove('hidden');
    if (app.bigAlertTimer) clearTimeout(app.bigAlertTimer);
    app.bigAlertTimer = setTimeout(function () {
      el.classList.add('hidden');
    }, ms || 2200);
  }

  function updateTerminalBanner(s) {
    const banner = $('terminal-banner');
    const finishBtn = $('finishBtn');
    const reverseBtn = $('reverseBtn');
    if (s.completed || !s.terminalArrived) {
      banner.classList.add('hidden');
      app.terminalArmed = false;
      return;
    }
    banner.classList.remove('hidden');
    const isSmall = s.service.type === 'small';
    const canReverse = isSmall && s.service.autoReverse;
    if (!app.terminalArmed) {
      app.terminalArmed = true;
      app.terminalCountdown = 30;
      app.terminalTick = performance.now();
    }
    const nowMs = performance.now();
    const frozen = app.paused || app.reportOpen;
    const terminalDt = (!frozen && app.terminalTick) ? Math.min(0.4, (nowMs - app.terminalTick) / 1000) : 0;
    app.terminalTick = nowMs;
    $('terminalKicker').textContent = isSmall ? '小交路终点 · 折返作业' : '终点站';
    $('terminalBannerTitle').textContent = s.station ? s.station.name : s.service.terminalName;
    reverseBtn.classList.toggle('hidden', !canReverse);
    if (canReverse) {
      if (s.doors === 'closed' && s.speedKph < 0.3) {
        app.terminalCountdown = Math.max(0, app.terminalCountdown - terminalDt);
        $('terminalBannerText').textContent = '车门已关闭 · ' + Math.ceil(app.terminalCountdown) + ' 秒后自动折返';
        if (app.terminalCountdown <= 0 && !app.reverseTriggered) {
          app.reverseTriggered = true;
          if (app.sim.reverseAtTerminal()) {
            app.terminalArmed = false;
            app.terminalCountdown = 30;
            app.reverseTriggered = false;
            app.forceStrip = true;
            if (app.world) {
              app.world.setDestination(app.sim.service.terminalName);
              app.world.setOpposingDestination(app.sim.dir > 0 ? '古城' : '环球度假区');
            }
            resetAnnouncementState(app.sim);
            updateStaticHud();
          }
        }
      } else {
        $('terminalBannerText').textContent = '请打开车门组织乘客下车；关妥车门后自动折返。';
        app.terminalCountdown = 30;
        app.terminalTick = nowMs;
      }
    } else {
      $('terminalBannerText').textContent = '列车已停稳 · 可结束值乘并查看评分';
    }
    finishBtn.textContent = isSmall ? '结束值乘' : '结束值乘';
  }

  /* ------------------------------------------------------------------------
     事件与提示
     ------------------------------------------------------------------------ */
  function addToast(text, type) {
    const stack = $('toast-stack');
    const div = document.createElement('div');
    div.className = 'toast ' + (type || 'info');
    div.textContent = text;
    stack.appendChild(div);
    while (stack.children.length > 4) stack.removeChild(stack.firstChild);
    setTimeout(function () {
      div.classList.add('out');
      setTimeout(function () { if (div.parentNode) div.parentNode.removeChild(div); }, 260);
    }, type === 'error' ? 5200 : 3800);
  }

  function drainEvents() {
    if (!app.sim) return;
    const events = app.sim.drainEvents();
    events.forEach(function (ev) {
      addToast(ev.text, ev.type);
      if (ev.big) {
        if (/终点站|折返/.test(ev.text)) showBigAlert('到达终点', ev.text, 'good', 2400);
        else if (/紧急制动|EB|追尾/.test(ev.text)) showBigAlert('紧急制动', ev.text, 'danger', 2600);
      }
      if (/车门已开启/.test(ev.text)) audio.chime(true);
      if (/车门已关闭/.test(ev.text)) audio.chime(false);
      if (/超速报警/.test(ev.text)) audio.beep(1120, 0.13, 0.04);
      if (/紧急制动/.test(ev.text)) audio.beep(700, 0.22, 0.055);
    });
  }

  /* ------------------------------------------------------------------------
     主循环
     ------------------------------------------------------------------------ */
  function loop(ts) {
    if (!app.running) {
      app.rafId = null;
      return;
    }
    app.rafId = requestAnimationFrame(loop);
    const realDt = clamp((ts - app.lastTs) / 1000 || 0, 0, 0.1);
    app.lastTs = ts;
    const sim = app.sim;
    if (!sim) return;

    if (!app.paused) {
      let simDt = realDt * app.speed;
      const steps = Math.max(1, Math.ceil(simDt / 0.035));
      const step = simDt / steps;
      for (let i = 0; i < steps; i++) sim.update(step);
      drainEvents();
      updateAnnouncements(sim);
      if (sim.completed && !app.reportOpen && !app.scorePending) {
        // 碰撞、越过终点等强制结束场景自动进入评分
        app.scorePending = true;
        app.scoreTimer = setTimeout(function () {
          app.scorePending = false;
          app.scoreTimer = null;
          if (!app.reportOpen && app.running) showScore();
        }, 900);
      }
      if (sim.doors !== app.lastDoors) {
        if (sim.doors === 'opening') audio.chime(true);
        if (sim.doors === 'closing') audio.chime(false);
        app.lastDoors = sim.doors;
      }
      audio.update(sim, true);
    } else {
      audio.update(sim, false);
    }

    app.world.update(sim, realDt, {
      mode: app.view,
      yaw: app.lookYaw,
      pitch: app.lookPitch
    });

    app.uiAccum += realDt;
    if (app.uiAccum > 0.075) {
      app.uiAccum = 0;
      updateHud(false);
    }
  }

  /* ------------------------------------------------------------------------
     评分与结束
     ------------------------------------------------------------------------ */
  function showScore() {
    if (!app.sim) return;
    if (app.sim.atStation) app.sim.evaluateStop(app.sim.atStation.stop);
    if (!app.sim.completed) app.sim.complete(app.sim.terminalArrived ? '到达终点站' : '司机结束值乘');
    const report = app.sim.getScoreReport();
    const score = report.score;
    app.reportOpen = true;
    app.paused = true;
    $('reportGrade').textContent = score.grade;
    $('reportGrade').style.background = score.total >= 88
      ? 'linear-gradient(145deg,#7ce9aa,#38b67a)'
      : (score.total >= 70 ? 'linear-gradient(145deg,#f7d06f,#cf9a2e)' : 'linear-gradient(145deg,#ff8d81,#c23a30)');
    $('reportTitle').textContent = score.grade === 'S' || score.grade === 'A' ? '优秀值乘' : '值乘结束';
    $('reportReason').textContent = report.reason + ' · ' + report.clock;
    $('reportTotal').textContent = String(Math.round(score.total));
    const bar = function (id, v) { $(id).style.width = v + '%'; };
    $('reportParking').textContent = score.stopCount ? String(score.parking) : '—';
    $('reportSafety').textContent = String(score.safety);
    $('reportPunctual').textContent = String(score.punctuality);
    $('reportOperation').textContent = String(score.operation);
    setTimeout(function () {
      bar('reportParkingBar', score.stopCount ? score.parking : 100);
      bar('reportSafetyBar', score.safety);
      bar('reportPunctualBar', score.punctuality);
      bar('reportOperationBar', score.operation);
    }, 80);
    $('reportStops').textContent = String(score.stopCount);
    $('reportError').textContent = score.avgParkingError == null ? '—' : score.avgParkingError.toFixed(2) + ' m';
    $('reportEb').textContent = String(score.ebCount);
    $('reportOverspeed').textContent = Math.round(score.overspeedTime) + ' s';
    $('reportDelay').textContent = score.avgDepartureDelay ? Math.round(score.avgDepartureDelay) + ' s' : '0 s';
    $('reportMaxSpeed').textContent = Math.round(report.maxSpeed) + ' km/h';
    const list = $('reportStopList');
    list.innerHTML = '';
    if (!report.stops.length) {
      list.innerHTML = '<span class="report-stop">尚未完成停站</span>';
    } else {
      report.stops.forEach(function (st) {
        const el = document.createElement('span');
        el.className = 'report-stop ' + st.level;
        el.textContent = st.name + ' ' + (st.error >= 0 ? '+' : '') + st.error.toFixed(2) + 'm · ' + st.label;
        list.appendChild(el);
      });
    }
    $('score-modal').classList.remove('hidden');
    $('terminal-banner').classList.add('hidden');
    toggleTrackingMap(false);
    announcer.cancel();
    audio.update(app.sim, false);
  }

  function finishRun() {
    if (!app.sim) return;
    if (!app.sim.completed) {
      app.sim.complete(app.sim.terminalArrived
        ? '到达终点站 ' + app.sim.service.terminalName
        : '司机结束值乘');
    }
    showScore();
  }

  /* ------------------------------------------------------------------------
     输入
     ------------------------------------------------------------------------ */
  function handleKey(e) {
    if (!entry.entered) {
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
        e.preventDefault();
        enterSimulator();
      }
      return;
    }
    if (e.code === 'Enter' && !app.running) {
      if ($('start-screen') && !$('start-screen').classList.contains('hidden')) {
        e.preventDefault();
        startRun();
        return;
      }
    }
    if (!app.running) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const code = e.code;
    const now = performance.now();
    const repeatGuard = e.repeat ? 115 : 0;

    if (code === 'Tab') {
      e.preventDefault();
      if (!app.reportOpen) toggleTrackingMap();
      return;
    }
    if (code === 'KeyP' || code === 'Escape') {
      if (!$('help-modal').classList.contains('hidden')) { closeHelp(); e.preventDefault(); return; }
      if (!$('pause-modal').classList.contains('hidden')) { resumeGame(); e.preventDefault(); return; }
      if (app.mapOpen) { toggleTrackingMap(false); e.preventDefault(); return; }
      if (app.reportOpen) return;
      pauseGame(true);
      e.preventDefault();
      return;
    }
    if (app.paused || app.reportOpen) return;

    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        e.preventDefault();
        if (now - (app.lastHandle || 0) >= repeatGuard) {
          app.lastHandle = now;
          app.sim.adjustHandle(1);
          audio.click();
          updateHud(true);
        }
        break;
      case 'KeyS':
      case 'ArrowDown':
        e.preventDefault();
        if (now - (app.lastHandle || 0) >= repeatGuard) {
          app.lastHandle = now;
          app.sim.adjustHandle(-1);
          audio.click();
          updateHud(true);
        }
        break;
      case 'KeyX':
        e.preventDefault();
        app.sim.setHandle(0);
        audio.click();
        updateHud(true);
        break;
      case 'Space':
        e.preventDefault();
        app.sim.requestDeparture();
        updateHud(true);
        break;
      case 'KeyO':
        e.preventDefault();
        app.sim.requestDoorToggle();
        updateHud(true);
        break;
      case 'KeyE':
        e.preventDefault();
        app.sim.emergencyBrake('司机手动 EB');
        updateHud(true);
        break;
      case 'Equal':
      case 'NumpadAdd':
      case 'PageUp':
        if (zoomExternal(1 / 1.12)) e.preventDefault();
        break;
      case 'Minus':
      case 'NumpadSubtract':
      case 'PageDown':
        if (zoomExternal(1.12)) e.preventDefault();
        break;
      case 'KeyR':
        if (e.shiftKey && app.view === 'external' && app.world && app.world.resetOrbit) {
          e.preventDefault();
          app.world.resetOrbit();
          break;
        }
        e.preventDefault();
        app.sim.resetEB();
        updateHud(true);
        break;
      case 'KeyH':
        e.preventDefault();
        if (now - app.lastHorn > 1000) {
          app.lastHorn = now;
          audio.horn();
        }
        break;
      case 'KeyV':
        e.preventDefault();
        toggleView();
        break;
      case 'KeyT':
        e.preventDefault();
        app.sim.toggleAto();
        updateStaticHud();
        updateHud(true);
        break;
      case 'KeyM':
        e.preventDefault();
        toggleMute();
        break;
      case 'BracketLeft':
        e.preventDefault();
        cycleSpeed(-1);
        break;
      case 'BracketRight':
        e.preventDefault();
        cycleSpeed(1);
        break;
      default:
        break;
    }
  }

  function toggleView() {
    if (!app.world) return;
    app.view = app.world.toggleCameraMode();
    app.lookYaw = 0;
    app.lookPitch = 0;
    addToast(app.view === 'cab' ? '切换至驾驶室视角' : '切换至 DKZ4 外观视角 · 拖动旋转 / 滚轮缩放', 'info');
    updateHud(true);
  }
  function toggleMute() {
    audio.setMuted(!audio.muted);
    announcer.setMuted(audio.muted);
    $('muteBtn').textContent = audio.muted ? '×' : '♪';
    $('muteBtn').title = audio.muted ? '取消静音 (M)' : '静音 (M)';
  }
  function cycleSpeed(dir) {
    const speeds = [1, 2, 4, 8];
    let idx = speeds.indexOf(app.speed);
    idx = (idx + dir + speeds.length) % speeds.length;
    setSpeed(speeds[idx]);
  }
  function setSpeed(speed) {
    app.speed = speed;
    document.querySelectorAll('.speed-btn').forEach(function (b) {
      b.classList.toggle('active', Number(b.dataset.speed) === speed);
    });
    addToast('模拟倍率 ' + speed + '×', 'info');
  }

  function openHelp() {
    if (app.running && !app.paused) {
      app.paused = true;
      app.helpPaused = true;
    }
    announcer.cancel();
    $('help-modal').classList.remove('hidden');
  }
  function closeHelp() {
    $('help-modal').classList.add('hidden');
    if (app.helpPaused) {
      app.helpPaused = false;
      app.paused = false;
      app.lastTs = performance.now();
    }
  }

  /* ------------------------------------------------------------------------
     鼠标视角
     ------------------------------------------------------------------------ */
  function initPointer() {
    canvas.addEventListener('pointerdown', function (e) {
      if (!app.running || app.paused) return;
      app.dragging = true;
      app.dragX = e.clientX;
      app.dragY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!app.dragging || app.paused) return;
      const dx = e.clientX - app.dragX;
      const dy = e.clientY - app.dragY;
      app.dragX = e.clientX;
      app.dragY = e.clientY;
      // 外观视角：拖动绕 DKZ4 旋转；驾驶室视角：转头
      if (app.view === 'external' && app.world.orbitRotate) {
        app.world.orbitRotate(dx, dy);
        return;
      }
      app.lookYaw = clamp(app.lookYaw - dx * 0.0042, -1.0, 1.0);
      app.lookPitch = clamp(app.lookPitch - dy * 0.0033, -0.24, 0.30);
    });
    canvas.addEventListener('pointerup', function (e) {
      app.dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    });
    canvas.addEventListener('pointercancel', function () { app.dragging = false; });
    canvas.addEventListener('dblclick', function () {
      app.lookYaw = 0;
      app.lookPitch = 0;
      if (app.view === 'external' && app.world.resetOrbit) app.world.resetOrbit();
    });
    canvas.addEventListener('wheel', function (e) {
      if (!app.world || app.paused || app.view !== 'external') return;
      // 临时调试：Shift+滚轮微调车顶终点站牌的前后位置
      if (e.shiftKey && app.world.nudgeDestBoard) {
        e.preventDefault();
        app.world.nudgeDestBoard(e.deltaY < 0 ? 0.02 : -0.02);
        return;
      }
      if (!app.world.orbitZoomBy) return;
      e.preventDefault();
      const factor = Math.exp(clamp(e.deltaY, -180, 180) * 0.0011);
      app.world.orbitZoomBy(factor);
    }, { passive: false });
  }

  /** 外观视角键盘缩放：[ / ] 在键盘映射里已用于模拟倍率，这里用 +/- 与 PageUp/PageDown */
  function zoomExternal(factor) {
    if (!app.world || !app.running || app.paused) return false;
    if (app.view !== 'external' || !app.world.orbitZoomBy) return false;
    app.world.orbitZoomBy(factor);
    return true;
  }

  /* ------------------------------------------------------------------------
     查询参数（便于截图与调试）
     ------------------------------------------------------------------------ */
  function applyQueryExtras() {
    if (!app.sim) return;
    const params = new URLSearchParams(window.location.search);
    const at = params.get('at');
    if (at != null && isFinite(Number(at))) {
      const sM = C.LINE.stationOffsetM + Number(at) * 1000;
      app.sim.s = clamp(sM, C.LINE.stationOffsetM, C.LINE.lengthM);
      app.sim.v = 0;
      app.sim.atStation = null;
      app.sim.terminalArrived = false;
      let idx = app.sim.stops.findIndex(function (st) { return st.s > app.sim.s + 5; });
      app.sim.nextStopIdx = idx > 0 ? idx : app.sim.stops.length - 1;
      app.sim.recomputeAtp();
      app.forceStrip = true;
    }
    const view = params.get('view');
    if (view === 'external' && app.world.getCameraMode() === 'cab') {
      app.view = app.world.toggleCameraMode();
    }
    const speed = Number(params.get('speed'));
    if ([1, 2, 4, 8].indexOf(speed) >= 0) setSpeed(speed);
    if (params.get('drive') === '1') {
      setTimeout(function () {
        if (app.sim) {
          app.sim.requestDeparture();
          if (params.get('doors') === 'open') app.sim.requestDoorToggle();
        }
      }, 700);
    }
  }

  /* ------------------------------------------------------------------------
     初始化
     ------------------------------------------------------------------------ */
  function showFatal(message) {
    app.fatal = true;
    $('fatal-overlay').classList.remove('hidden');
    $('fatalMessage').textContent = message || '未知错误';
    $('loading-overlay').classList.add('hidden');
  }

  function initModelToast() {
    const toast = $('model-toast');
    const text = $('modelToastText');
    if (!toast || !text) return;
    let hideTimer = null;
    function scheduleHide(ms) {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { toast.classList.remove('show'); }, ms);
    }
    window.addEventListener('dkz4-model-status', function (e) {
      const d = (e && e.detail) || {};
      toast.classList.add('show');
      toast.classList.remove('loading', 'ready', 'error');
      if (d.status === 'loading') {
        toast.classList.add('loading');
        text.textContent = d.message || '正在加载 DKZ4 模型…';
      } else if (d.status === 'ready') {
        toast.classList.add('ready');
        const info = d.info;
        text.textContent = info
          ? 'DKZ4 高精度模型已装配 · ' + info.triangleCount.toLocaleString() + ' 三角面 / 节'
          : 'DKZ4 高精度模型已装配';
        scheduleHide(4200);
      } else if (d.status === 'fallback') {
        toast.classList.add('error');
        text.textContent = d.message || 'DKZ4 模型加载失败，已使用程序化车体';
        scheduleHide(9000);
      }
    });
  }

  function init() {
    initGauge();
    initPointer();
    initModelToast();
    updateStartUI();
    const hashParams = new URLSearchParams(window.location.search);
    if (hashParams.get('period') === 'pm') app.config.period = 'pm';
    if (hashParams.get('type') === 'small') app.config.type = 'small';
    if (hashParams.get('dir') === '-1') app.config.dir = -1;
    if (hashParams.get('ato') === '0') app.config.ato = false;
    updateStartUI();

    // 开始界面事件
    const gate = $('entry-gate');
    if (gate) {
      gate.addEventListener('click', function (e) {
        e.preventDefault();
        enterSimulator();
      });
    }
    const entryBtn = $('entryBtn');
    if (entryBtn) {
      entryBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        enterSimulator();
      });
    }
    $('start-screen').addEventListener('click', function (e) {
      onStartConfigClick(e);
      if (e.target.closest('#startBtn')) startRun();
      if (e.target.closest('#reverseToggle')) {
        if (app.config.type !== 'small') return;
        app.config.autoReverse = !app.config.autoReverse;
        updateStartUI();
      }
    });
    $('startBtn').addEventListener('click', function (e) { e.stopPropagation(); startRun(); });

    // HUD 按钮
    $('tractionBtn').addEventListener('click', function () { if (!app.paused) { app.sim.adjustHandle(1); audio.click(); updateHud(true); } });
    $('brakeBtn').addEventListener('click', function () { if (!app.paused) { app.sim.adjustHandle(-1); audio.click(); updateHud(true); } });
    $('neutralBtn').addEventListener('click', function () { if (!app.paused) { app.sim.setHandle(0); audio.click(); updateHud(true); } });
    document.querySelectorAll('.notch-tile').forEach(function (b) {
      b.addEventListener('click', function () {
        if (app.paused || !app.sim) return;
        app.sim.setHandle(Number(b.dataset.notch));
        audio.click();
        updateHud(true);
      });
    });
    $('doorBtn').addEventListener('click', function () { if (app.sim && !app.paused) { app.sim.requestDoorToggle(); updateHud(true); } });
    $('departBtn').addEventListener('click', function () { if (app.sim && !app.paused) { app.sim.requestDeparture(); updateHud(true); } });
    $('ebBtn').addEventListener('click', function () { if (app.sim && !app.paused) { app.sim.emergencyBrake('司机手动 EB'); updateHud(true); } });
    $('resetBtn').addEventListener('click', function () { if (app.sim && !app.paused) { app.sim.resetEB(); updateHud(true); } });
    $('atoBtn').addEventListener('click', function () { if (app.sim && !app.paused) { app.sim.toggleAto(); updateStaticHud(); updateHud(true); } });
    $('viewBtn').addEventListener('click', toggleView);
    $('hornBtn').addEventListener('click', function () { if (!app.paused) audio.horn(); });
    $('helpBtn2').addEventListener('click', openHelp);
    $('helpBtn').addEventListener('click', openHelp);
    $('pauseBtn').addEventListener('click', function () { pauseGame(true); });
    $('muteBtn').addEventListener('click', toggleMute);
    $('mapBtn').addEventListener('click', function () { toggleTrackingMap(); });
    $('mapCloseBtn').addEventListener('click', function () { toggleTrackingMap(false); });
    document.querySelectorAll('.speed-btn').forEach(function (b) {
      b.addEventListener('click', function () { setSpeed(Number(b.dataset.speed)); });
    });

    // 弹窗
    document.querySelectorAll('[data-close="help"]').forEach(function (b) {
      b.addEventListener('click', closeHelp);
    });
    $('help-modal').addEventListener('click', function (e) {
      if (e.target === $('help-modal')) closeHelp();
    });
    $('resumeBtn').addEventListener('click', resumeGame);
    $('pauseFinishBtn').addEventListener('click', function () {
      $('pause-modal').classList.add('hidden');
      finishRun();
    });
    $('pauseMenuBtn').addEventListener('click', returnToMenu);
    $('finishBtn').addEventListener('click', function () {
      if (app.sim && app.sim.doors === 'open') {
        addToast('请先关闭车门，再结束值乘。', 'warning');
        return;
      }
      finishRun();
    });
    $('reverseBtn').addEventListener('click', function () {
      if (!app.sim) return;
      if (app.sim.doors !== 'closed') { addToast('请先关闭车门再折返。', 'error'); return; }
      if (app.sim.reverseAtTerminal()) {
        app.terminalArmed = false;
        app.terminalCountdown = 30;
        app.forceStrip = true;
        if (app.world) {
          app.world.setDestination(app.sim.service.terminalName);
          app.world.setOpposingDestination(app.sim.dir > 0 ? '古城' : '环球度假区');
        }
        resetAnnouncementState(app.sim);
        updateStaticHud();
        updateHud(true);
      }
    });
    $('reportRestartBtn').addEventListener('click', function () {
      $('score-modal').classList.add('hidden');
      app.reportOpen = false;
      startRun();
    });
    $('reportMenuBtn').addEventListener('click', returnToMenu);
    $('score-modal').addEventListener('click', function (e) {
      if (e.target === $('score-modal')) { /* 强制停留，防止误关 */ }
    });

    window.addEventListener('keydown', handleKey);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && app.running && !app.paused) pauseGame(true);
    });
    window.addEventListener('error', function (ev) {
      if (!app.fatal && ev.message) {
        console.error(ev.error || ev.message);
      }
    });
    window.addEventListener('resize', function () {
      if (app.world) app.world.resize();
    });

    if (hashParams.get('autostart') === '1') {
      setTimeout(function () {
        enterSimulator({ silent: true });
        startRun();
      }, 200);
    }
  }

  window.__BJ1__.startRun = startRun;
  window.__BJ1__.enterSimulator = enterSimulator;
  window.__BJ1__.entry = entry;
  window.__BJ1__.updateHud = updateHud;
  window.__BJ1__.showScore = showScore;
  window.__BJ1__.returnToMenu = returnToMenu;
  window.__BJ1__.toggleView = toggleView;
  window.__BJ1__.setSpeed = setSpeed;
  window.__BJ1__.pauseGame = pauseGame;
  window.__BJ1__.resumeGame = resumeGame;
  window.__BJ1__.audio = audio;
  window.__BJ1__.announcer = announcer;
  window.__BJ1__.toggleTrackingMap = toggleTrackingMap;
  window.__BJ1__.drawTrackingMap = drawTrackingMap;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
