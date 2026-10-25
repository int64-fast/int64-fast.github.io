/* DKZ4 glb 资产与接入点静态校验（不依赖浏览器/WebGL） */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const modelPath = path.join(root, 'dkz4.glb');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const worldJs = fs.readFileSync(path.join(root, 'js', 'world.js'), 'utf8');

function readGlb(file) {
  const buf = fs.readFileSync(file);
  assert.strictEqual(buf.readUInt32LE(0), 0x46546c67, 'glb magic 必须是 glTF');
  assert.strictEqual(buf.readUInt32LE(4), 2, 'glb 版本必须是 2');
  assert.strictEqual(buf.readUInt32LE(8), buf.length, 'glb 头部长度必须与文件实际长度一致');
  const jsonLength = buf.readUInt32LE(12);
  assert.strictEqual(buf.readUInt32LE(16), 0x4e4f534a, '第一个 chunk 必须是 JSON');
  const json = JSON.parse(buf.slice(20, 20 + jsonLength).toString('utf8'));
  const binHeader = 20 + jsonLength;
  const binLength = buf.readUInt32LE(binHeader);
  assert.strictEqual(buf.readUInt32LE(binHeader + 4), 0x004e4942, '第二个 chunk 必须是 BIN');
  return { buf: buf, json: json, binLength: binLength, binOffset: binHeader + 8 };
}

assert.ok(fs.existsSync(modelPath), '仓库根目录必须存在 dkz4.glb（GitHub Pages 相对路径 ./dkz4.glb）');
const stat = fs.statSync(modelPath);
assert.ok(stat.size > 8 * 1024 * 1024, 'DKZ4 模型应大于 8 MB');

const glb = readGlb(modelPath);
const gltf = glb.json;

assert.strictEqual(gltf.asset.version, '2.0', 'glTF 2.0');
assert.ok(Array.isArray(gltf.nodes) && gltf.nodes.length > 6000, '模型应包含完整车辆节点');
assert.ok(Array.isArray(gltf.meshes) && gltf.meshes.length > 6000, '模型应包含完整车辆 Mesh');
assert.ok(Array.isArray(gltf.materials) && gltf.materials.length >= 1, '模型应包含材质');
assert.strictEqual(gltf.buffers.length, 1, 'glb 必须只有一个 buffer（即 BIN chunk）');
assert.ok(!gltf.buffers[0].uri, 'glb 的 buffer 不允许再带 uri');
assert.strictEqual(gltf.buffers[0].byteLength, glb.binLength, 'buffer 长度必须等于 BIN chunk 长度');
assert.ok(gltf.bufferViews.every(function (v) {
  return (v.byteOffset || 0) + v.byteLength <= glb.binLength;
}), '所有 bufferView 必须落在 BIN chunk 内');
assert.ok(gltf.images && gltf.images.length >= 1, '模型应包含贴图');
assert.ok(gltf.images.every(function (img) {
  return img.bufferView !== undefined && img.uri === undefined;
}), '贴图应打包进 BIN chunk，避免额外文件请求或跨域');
gltf.images.forEach(function (img) {
  const view = gltf.bufferViews[img.bufferView];
  const start = glb.binOffset + (view.byteOffset || 0);
  const sig = glb.buf.slice(start, start + 8).toString('hex');
  assert.ok(sig === '89504e470d0a1a0a' || sig.slice(0, 4) === 'ffd8ffe0', '贴图字节必须是合法 PNG/JPEG');
});
assert.ok(gltf.images.filter(function (img) { return img.mimeType === 'image/png'; }).length >= 1, '贴图 mimeType 应为 image/png');

// 线上不能依赖额外解码器：GLTFLoader 单文件加载时无法解 Draco / meshopt
const extRequired = gltf.extensionsRequired || [];
['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_mesh_quantization'].forEach(function (ext) {
  assert.ok(extRequired.indexOf(ext) < 0, '模型不能要求额外解码器: ' + ext);
});
assert.ok(!(gltf.extensionsUsed || []).some(function (ext) {
  return ext === 'KHR_draco_mesh_compression' || ext === 'EXT_meshopt_compression';
}), '模型不能使用 Draco / meshopt 压缩');

const nodeNames = gltf.nodes.map(function (n) { return n.name || ''; });
['head_outside', 'head_inside', 'middle_outside', 'middle_inside'].forEach(function (name) {
  assert.ok(nodeNames.indexOf(name) >= 0, '模型应包含变体组 ' + name);
});
assert.ok(nodeNames.some(function (n) { return n.indexOf('door_head') >= 0; }), '模型应包含头车门组');
assert.ok(nodeNames.some(function (n) { return n.indexOf('door_mid') >= 0; }), '模型应包含中间车门组');

function subtreeMeshCount(groupName) {
  const start = nodeNames.indexOf(groupName);
  if (start < 0) return 0;
  let count = 0;
  (function walk(i) {
    const node = gltf.nodes[i];
    if (node.mesh !== undefined) count++;
    (node.children || []).forEach(walk);
  })(start);
  return count;
}
const headMeshes = subtreeMeshCount('head_outside') + subtreeMeshCount('head_inside');
const middleMeshes = subtreeMeshCount('middle_outside') + subtreeMeshCount('middle_inside');
assert.ok(headMeshes > 2000, '头车变体应包含足量 Mesh');
assert.ok(middleMeshes > 2000, '中间车变体应包含足量 Mesh');

const parent = new Array(gltf.nodes.length).fill(-1);
gltf.nodes.forEach(function (node, i) {
  (node.children || []).forEach(function (child) { parent[child] = i; });
});
function variantOfNode(i) {
  let p = i;
  while (p >= 0) {
    const n = (gltf.nodes[p].name || '').toLowerCase();
    if (n === 'head_inside' || n === 'head_outside' || n.indexOf('door_head') >= 0) return 'head';
    if (n === 'middle_inside' || n === 'middle_outside' || n.indexOf('door_mid') >= 0) return 'middle';
    p = parent[p];
  }
  return null;
}
let selectedMeshes = 0;
gltf.nodes.forEach(function (node, i) {
  if (node.mesh !== undefined && variantOfNode(i)) selectedMeshes++;
});
assert.strictEqual(selectedMeshes, gltf.meshes.length, '所有 Mesh 都应归入头车或中间车变体');

const loaderPos = indexHtml.indexOf('vendor/GLTFLoader.js');
const threePos = indexHtml.indexOf('vendor/three.min.js');
const worldPos = indexHtml.indexOf('js/world.js');
assert.ok(threePos >= 0 && loaderPos > threePos, 'GLTFLoader 必须位于 Three.js 之后');
assert.ok(worldPos > loaderPos, 'world.js 必须在 GLTFLoader 之后');
assert.ok(indexHtml.indexOf('id="model-toast"') >= 0, '页面应包含模型加载状态提示');

assert.ok(worldJs.indexOf("'./dkz4.glb'") >= 0, 'world.js 应通过相对路径 ./dkz4.glb 加载模型');
assert.ok(worldJs.indexOf("'assets/models/dkz4.gltf'") < 0, '不应再引用旧的 gltf 路径');
assert.ok(worldJs.indexOf('mergeDkz4Scene') >= 0, 'world.js 应合并 glb Mesh');
assert.ok(worldJs.indexOf("buildDkz4Template(gltf, 'head')") >= 0, 'world.js 应构建头车变体');
assert.ok(worldJs.indexOf("buildDkz4Template(gltf, 'middle')") >= 0, 'world.js 应构建中间车变体');
assert.ok(worldJs.indexOf('attachDkz4ToConsist') >= 0, 'world.js 应把模型装配到 6 节编组');
assert.ok(worldJs.indexOf('failDkz4Model') >= 0, 'world.js 应有加载失败回退');

console.log('Model integration test');
console.log('  ✓ glb 2.0 资产完整（' + (stat.size / 1024 / 1024).toFixed(1) + ' MB，' +
  gltf.nodes.length + ' nodes / ' + gltf.meshes.length + ' meshes / ' +
  gltf.images.length + ' 内嵌贴图）');
console.log('  ✓ GLTFLoader 在 Three.js 之后、world.js 之前加载');
console.log('  ✓ 头车变体 ' + headMeshes + ' Mesh / 中间车变体 ' + middleMeshes + ' Mesh，分别合并');
console.log('  ✓ 模型路径 ./dkz4.glb、Mesh 合并、编组装配、失败回退均已接线');
console.log('  ✓ model integration test passed.');
