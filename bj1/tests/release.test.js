/* Release 0.0.1 上线适配校验：版本号、点击进入、相对路径、大小写、无后端 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const worldJs = fs.readFileSync(path.join(root, 'js', 'world.js'), 'utf8');
const styleCss = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/* 1. 版本号 ---------------------------------------------------------------- */
assert.strictEqual(pkg.version, '0.0.1', 'package.json version 必须是 0.0.1');
const releaseTag = 'Release 0.0.1';
assert.ok(indexHtml.indexOf(releaseTag) >= 0, 'index.html 必须显示 ' + releaseTag);
assert.ok(indexHtml.split(releaseTag).length - 1 >= 2, '进入页与开始页都应显示版本号');
assert.ok(indexHtml.indexOf('entry-release') >= 0, '进入页应有独立的版本徽标');

/* 2. 点击进入遮罩 ---------------------------------------------------------- */
const gateHtml = indexHtml.indexOf('id="entry-gate"');
const startHtml = indexHtml.indexOf('id="start-screen"');
assert.ok(gateHtml >= 0, '必须存在 #entry-gate 遮罩层');
assert.ok(gateHtml < startHtml, '遮罩层必须位于开始界面之前（层级在其上方）');
assert.ok(indexHtml.indexOf('id="entryBtn"') >= 0, '遮罩层必须提供「点击进入」按钮');
assert.ok(appJs.indexOf('function enterSimulator') >= 0, 'app.js 必须实现 enterSimulator');
assert.ok(/entry-gate/.test(appJs) && /addEventListener\('click'/.test(appJs), '遮罩层必须绑定点击事件');

// 音频/语音引擎必须在点击手势里初始化，而不是页面加载时
assert.ok(/function enterSimulator[\s\S]{0,600}audio\.ensure\(\)/.test(appJs), '点击进入时必须创建 AudioContext');
assert.ok(/function enterSimulator[\s\S]{0,600}announcer\.ensure\(\)/.test(appJs), '点击进入时必须初始化语音合成');
assert.ok(appJs.indexOf('SpeechAnnouncer.prototype.ensure') >= 0, '语音引擎应提供延迟初始化 ensure()');
const ctorButCode = appJs.slice(appJs.indexOf('function SpeechAnnouncer()'), appJs.indexOf('SpeechAnnouncer.prototype.ensure'))
  .split('\n')
  .map(function (line) { return line.replace(/\/\/.*$/, ''); })
  .join('\n');
assert.ok(!/window\.speechSynthesis\s*\|\|/.test(ctorButCode), '构造函数不得直接读取 speechSynthesis');
assert.ok(!/window\.SpeechSynthesisUtterance\s*\|\|/.test(ctorButCode), '构造函数不得直接读取 SpeechSynthesisUtterance');
assert.ok(/enterSimulator\(\{ silent: true \}\)/.test(appJs), 'autostart 也要先经过遮罩逻辑');
assert.ok(styleCss.indexOf('.entry-gate') >= 0, 'css 必须包含遮罩层样式');

/* 3. 相对路径 + 大小写严格匹配 -------------------------------------------- */
function readDirEntries(dir) {
  return fs.readdirSync(dir);
}
function existsWithExactCase(relPath) {
  const parts = relPath.replace(/^\.\//, '').split('/').filter(Boolean);
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    const entries = readDirEntries(current);
    if (entries.indexOf(parts[i]) < 0) return false;
    current = path.join(current, parts[i]);
  }
  return fs.existsSync(current);
}

const refs = [];
const refRe = /(?:src|href)\s*=\s*"([^"]+)"/g;
let m;
while ((m = refRe.exec(indexHtml)) !== null) refs.push(m[1]);
assert.ok(refs.length >= 5, 'index.html 应引用样式与脚本');

refs.forEach(function (ref) {
  if (/^(data:|https?:|mailto:|#|\/\/)/i.test(ref)) {
    assert.fail('不允许绝对地址或外链资源: ' + ref);
  }
  assert.ok(!/^[A-Za-z]:[\\/]/.test(ref), '不允许本地绝对路径: ' + ref);
  assert.ok(existsWithExactCase(ref), '引用的文件不存在或大小写不匹配: ' + ref);
});

// 关键文件逐个点名校验（GitHub Pages 的 Linux 文件系统区分大小写）
['index.html', 'css/style.css', 'js/core.js', 'js/world.js', 'js/app.js',
  'vendor/three.min.js', 'vendor/GLTFLoader.js', 'dkz4.glb'].forEach(function (file) {
  assert.ok(existsWithExactCase(file), '缺少文件或大小写不符: ' + file);
});
assert.ok(existsWithExactCase('dkz4.glb'), '模型必须位于仓库根目录并保持小写 dkz4.glb');
// 注：Windows 文件系统不区分大小写，无法用 existsSync 断言“错误大小写的文件不存在”，
// 因此这里只做正向的逐级大小写比对（existsWithExactCase）。

/* 4. 无写死域名 / 无后端 --------------------------------------------------- */
[indexHtml, appJs, worldJs, styleCss].forEach(function (text, i) {
  const name = ['index.html', 'js/app.js', 'js/world.js', 'css/style.css'][i];
  assert.ok(!/https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(text), name + ' 不应写死本地地址');
  assert.ok(!/https?:\/\//i.test(text) || name === 'index.html', name + ' 不应引用外部 http(s) 资源');
  assert.ok(text.indexOf('XMLHttpRequest') < 0 || name === 'js/world.js', name + ' 不应自行发起后端请求');
});
assert.ok(worldJs.indexOf("'./dkz4.glb'") >= 0, '模型必须用相对路径 ./dkz4.glb 加载');
assert.ok(worldJs.indexOf('assets/models') < 0, 'world.js 不应再引用 assets/models');

console.log('Release 0.0.1 deployment test');
console.log('  ✓ 版本号 ' + releaseTag + '（进入页 + 开始页 + package.json）');
console.log('  ✓ 点击进入遮罩在场，音频/语音引擎在点击手势内初始化');
console.log('  ✓ ' + refs.length + ' 个资源引用全部为相对路径且大小写严格匹配');
console.log('  ✓ 模型 ./dkz4.glb 位于仓库根目录，无后端、无写死域名');
console.log('  ✓ release test passed.');
