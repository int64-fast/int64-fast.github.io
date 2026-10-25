'use strict';
/* 最小 DOM + WebGL stub，执行 app.js 的初始化、开局、HUD 与评分流程。 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

function noop() {}
function makeContext() {
  const target = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '',
    textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
    fillRect: noop, strokeRect: noop, clearRect: noop, beginPath: noop,
    closePath: noop, arc: noop, fill: noop, stroke: noop, moveTo: noop,
    lineTo: noop, save: noop, restore: noop, translate: noop, rotate: noop,
    scale: noop, fillText: noop, strokeText: noop,
    measureText: t => ({ width: (t || '').length * 10 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    drawImage: noop, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: noop, setLineDash: noop
  };
  return new Proxy(target, {
    get: (o, k) => (k in o ? o[k] : noop),
    set: (o, k, v) => { o[k] = v; return true; }
  });
}

class ClassList {
  constructor(el, initial) {
    this.el = el;
    this.set = new Set(initial || []);
  }
  add(...names) { names.forEach(n => this.set.add(n)); }
  remove(...names) { names.forEach(n => this.set.delete(n)); }
  contains(n) { return this.set.has(n); }
  toggle(n, force) {
    if (force === undefined) force = !this.set.has(n);
    if (force) this.set.add(n); else this.set.delete(n);
    return force;
  }
}

let idCounter = 0;
class FakeElement {
  constructor(tag, id, cls) {
    this.tagName = (tag || 'DIV').toUpperCase();
    this.id = id || ('el' + (++idCounter));
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.attributes = {};
    this._text = '';
    this._html = '';
    this.disabled = false;
    this.listeners = {};
    this.parentElement = null;
    this.classList = new ClassList(this, cls || []);
    this.className = (cls || []).join(' ');
    this.firstChild = null;
  }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  addEventListener(type, fn) {
    (this.listeners[type] || (this.listeners[type] = [])).push(fn);
  }
  removeEventListener(type, fn) {
    if (this.listeners[type]) this.listeners[type] = this.listeners[type].filter(f => f !== fn);
  }
  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    child.parentElement = this;
    this.children.push(child);
    this.firstChild = this.children[0] || null;
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter(c => c !== child);
    this.firstChild = this.children[0] || null;
    return child;
  }
  setAttribute(k, v) { this.attributes[k] = v; if (k === 'class') this.className = v; }
  getAttribute(k) { return this.attributes[k]; }
  querySelector(sel) {
    if (sel === 'span') return this._span || (this._span = new FakeElement('span'));
    return new FakeElement('div');
  }
  querySelectorAll() { return []; }
  closest() { return null; }
  focus() {}
  setPointerCapture() {}
  releasePointerCapture() {}
}

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ids = Array.from(html.matchAll(/id="([^"]+)"/g)).map(m => m[1]);
const elements = {};
ids.forEach(id => {
  elements[id] = new FakeElement('div', id);
  elements[id].parentElement = new FakeElement('div');
});
['game-ui', 'help-modal', 'pause-modal', 'score-modal', 'loading-overlay', 'fatal-overlay', 'terminal-banner', 'big-alert', 'tracking-map']
  .forEach(id => { if (elements[id]) elements[id].classList.add('hidden'); });
elements['trackingCanvas'] = makeCanvas(900, 150);

// 特定交互元素
const speedBtns = [1, 2, 4, 8].map(n => {
  const el = new FakeElement('button');
  el.dataset.speed = String(n);
  return el;
});
const notchTiles = [];
for (let n = 4; n >= -7; n--) {
  const el = new FakeElement('button');
  el.dataset.notch = String(n);
  notchTiles.push(el);
}
const periodBtns = ['am', 'pm'].map(p => {
  const el = new FakeElement('button');
  el.dataset.period = p;
  return el;
});
const typeCards = ['large', 'small'].map(t => {
  const el = new FakeElement('button');
  el.dataset.type = t;
  return el;
});
const modeBtns = ['1', '0'].map(a => {
  const el = new FakeElement('button');
  el.dataset.ato = a;
  return el;
});
const dirBtns = ['1', '-1'].map(d => {
  const el = new FakeElement('button');
  el.dataset.dir = d;
  el._span = new FakeElement('span');
  const sm = new FakeElement('small');
  el._span2 = sm;
  el.querySelector = function (sel) {
    if (sel === 'span') return this._span;
    if (sel === 'small') return this._span2;
    return new FakeElement('div');
  };
  return el;
});
const curveStatus = new FakeElement('div');
curveStatus.classList.add('curve-status');

function querySelectorAll(sel) {
  if (sel === '.speed-btn') return speedBtns;
  if (sel === '.notch-tile') return notchTiles;
  if (sel === '#periodSegment .seg-btn') return periodBtns;
  if (sel === '#typeCards .route-card') return typeCards;
  if (sel === '#modeToggle .mode-btn') return modeBtns;
  if (sel === '#directionRow .dir-btn') return dirBtns;
  if (sel === '[data-close="help"]') return [new FakeElement('button')];
  return [];
}
function querySelector(sel) {
  if (sel === '.curve-status') return curveStatus;
  if (sel === '#directionRow [data-dir="1"]') return dirBtns[0];
  if (sel === '#directionRow [data-dir="-1"]') return dirBtns[1];
  return new FakeElement('div');
}

const documentStub = {
  readyState: 'complete',
  getElementById: id => elements[id] || null,
  querySelectorAll,
  querySelector,
  createElement: tag => (tag === 'canvas' ? makeCanvas() : new FakeElement(tag)),
  createElementNS: () => makeCanvas(),
  addEventListener: noop,
  body: new FakeElement('body')
};

function makeCanvas(w, h) {
  return {
    width: w || 512, height: h || 256, style: {},
    getContext: () => makeContext(),
    getBoundingClientRect: () => ({ width: 900, height: 150, left: 0, top: 0 }),
    addEventListener: noop, removeEventListener: noop,
    setPointerCapture: noop, releasePointerCapture: noop
  };
}

const rafQueue = [];
global.document = documentStub;
global.window = {
  devicePixelRatio: 1,
  innerWidth: 1440,
  innerHeight: 900,
  location: { search: '' },
  addEventListener: noop,
  removeEventListener: noop,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  requestAnimationFrame: fn => { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame: noop,
  performance: { now: () => Date.now() }
};
global.self = global.window;
global.performance = global.window.performance;
global.requestAnimationFrame = fn => { rafQueue.push(fn); return rafQueue.length; };
global.cancelAnimationFrame = noop;

const THREE = require('../vendor/three.min.js');
global.THREE = THREE;
window.THREE = THREE;
class FakeRenderer {
  constructor() {
    this.capabilities = { getMaxAnisotropy: () => 4 };
    this.shadowMap = { enabled: false, type: 0 };
    this.domElement = makeCanvas();
  }
  setPixelRatio() {}
  setSize() {}
  render() {}
}
THREE.WebGLRenderer = FakeRenderer;

global.Line1Core = require('../js/core.js');
window.Line1Core = global.Line1Core;
require('../js/world.js');
window.BJWorld = global.BJWorld || window.BJWorld;
// world.js 的 IIFE 参数是 window；其导出挂在 window 上
const W = window.BJWorld;
if (!W) throw new Error('BJWorld not found');

require('../js/app.js');

setTimeout(() => {
  assert(window.__BJ1__, '__BJ1__ missing');
  const app = window.__BJ1__.app;
  assert(app, 'app missing');
  console.log('\nApp smoke test');
  console.log('  ✓ init complete');
  window.__BJ1__.startRun();
  setTimeout(() => {
    assert(app.running, 'app not running');
    assert(app.sim, 'sim missing');
    assert(app.world, 'world missing');
    console.log('  ✓ startRun, world created');
    window.__BJ1__.updateHud(true);
    assert(elements['stopProgress'].textContent.includes('/ 35 站'),
      'stopProgress=' + elements['stopProgress'].textContent);
    assert(!elements['stopProgress'].textContent.includes('NaN'),
      'stopProgress contains NaN: ' + elements['stopProgress'].textContent);
    assert(elements['routeStrip'].innerHTML.includes('古城'),
      'route strip not rendered: ' + elements['routeStrip'].innerHTML);
    for (const [id, el] of Object.entries(elements)) {
      assert(!String(el.textContent).includes('NaN'), id + ' textContent contains NaN');
      assert(!String(el.innerHTML).includes('NaN'), id + ' innerHTML contains NaN');
    }
    console.log('  ✓ HUD rendered');
    // 手动推进若干帧，覆盖 loop 内同款路径
    for (let i = 0; i < 100; i++) {
      app.sim.update(0.03);
      app.world.update(app.sim, 0.03, { mode: app.view, yaw: 0, pitch: 0 });
    }
    window.__BJ1__.updateHud(true);
    console.log('  ✓ 100 frames + HUD');
    window.__BJ1__.toggleView();
    window.__BJ1__.updateHud(true);
    console.log('  ✓ view toggle');

    // 报站文本（换乘站）
    const ann = window.__BJ1__.announcer;
    let captured = null;
    ann.speakPair = (zh, en) => { captured = { zh, en }; };
    const fuxingmen = app.sim.service.stops.find(st => st.name === '复兴门');
    ann.announceDeparture(fuxingmen);
    assert(captured && captured.zh.includes('换乘地铁2号线'), 'transfer announcement missing line 2');
    assert(captured.en.includes('line 2'), 'English transfer announcement missing line 2');
    captured = null;
    ann.announceArrival(fuxingmen.station);
    assert(captured && captured.zh === '复兴门站到了。', 'arrival announcement text wrong');
    assert(captured.en.includes('Fuxingmen'), 'arrival English text wrong');
    console.log('  ✓ speech announcement text');

    // 2D 追踪图
    window.__BJ1__.toggleTrackingMap(true);
    assert(!elements['tracking-map'].classList.contains('hidden'), 'tracking map not opened');
    window.__BJ1__.updateHud(true);
    window.__BJ1__.toggleTrackingMap(false);
    assert(elements['tracking-map'].classList.contains('hidden'), 'tracking map not closed');
    console.log('  ✓ tracking map');
    // 停车与开门事件
    app.sim.v = 0;
    app.sim.s = app.sim.stops[0].s;
    app.sim.atStation = { stopIdx: 0, stop: app.sim.stops[0], since: app.sim.tripTime, terminal: false };
    app.sim.requestDoorToggle();
    app.sim.update(2.0);
    window.__BJ1__.updateHud(true);
    console.log('  ✓ door cycle HUD');
    // 评分页
    window.__BJ1__.showScore();
    assert(app.reportOpen, 'score report not open');
    assert(!elements['score-modal'].classList.contains('hidden'), 'score modal hidden');
    console.log('  ✓ score report');
    console.log('  ✓ app smoke test passed.');
    process.exit(0);
  }, 260);
}, 50);

setTimeout(() => {
  console.error('App smoke test timeout');
  process.exit(1);
}, 6000).unref();
