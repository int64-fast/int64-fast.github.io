#!/usr/bin/env node
/* ==========================================================================
   gltf-to-glb.js — 把内嵌贴图/base64 的 .gltf 打包成单文件 .glb
   --------------------------------------------------------------------------
   用途：项目要把 DKZ4 模型以 ./dkz4.glb 的形式随仓库发布（GitHub Pages 静态托管），
   浏览器只发一次请求即可拿到几何 + 材质 + 贴图。

   用法：node tools/gltf-to-glb.js <输入.gltf> <输出.glb>

   转换规则（glTF 2.0 / GLB 容器）：
   - buffer 0 的 data URI 解码后成为 GLB 的 BIN chunk；
   - images 的 data URI 追加到 BIN chunk 末尾，改写成 bufferView 引用；
   - bufferView.byteOffset 相对 buffer 0，因此原有字节位置完全不变。
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

function decodeDataUri(uri, expect) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri || '');
  if (!m) throw new Error('不是 data URI: ' + String(uri).slice(0, 40));
  if (expect && m[1] && m[1] !== expect) {
    throw new Error('MIME 不符：期望 ' + expect + '，实际 ' + m[1]);
  }
  return m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'binary');
}

function pad4(n) {
  return (4 - (n % 4)) % 4;
}

function convert(inputPath, outputPath) {
  const json = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  if (!json.buffers || json.buffers.length !== 1) {
    throw new Error('只支持单 buffer 的 glTF（当前 ' + (json.buffers || []).length + ' 个）');
  }
  const buffer = json.buffers[0];
  if (typeof buffer.uri !== 'string' || buffer.uri.indexOf('data:') !== 0) {
    throw new Error('buffer 必须是内嵌 data URI，外链 .bin 请先自行内嵌');
  }

  const binParts = [decodeDataUri(buffer.uri)];
  let binLength = binParts[0].length;

  // 把内嵌图片搬进 BIN chunk，避免 GLB 内部再出现 data URI（体积更小、加载更快）
  const imageViews = [];
  (json.images || []).forEach(function (image, i) {
    if (typeof image.uri !== 'string' || image.uri.indexOf('data:image/') !== 0) {
      throw new Error('第 ' + i + ' 张贴图不是内嵌 data URI');
    }
    const bytes = decodeDataUri(image.uri, image.mimeType || 'image/png');
    const padding = pad4(binLength);
    if (padding) {
      binParts.push(Buffer.alloc(padding, 0));
      binLength += padding;
    }
    const viewIndex = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: bytes.length });
    imageViews.push({ image: image, viewIndex: viewIndex, bytes: bytes });
    binParts.push(bytes);
    binLength += bytes.length;
  });

  imageViews.forEach(function (rec) {
    delete rec.image.uri;
    rec.image.bufferView = rec.viewIndex;
  });

  buffer.byteLength = binLength;
  delete buffer.uri;

  // JSON chunk 必须 4 字节对齐，用空格补齐；BIN chunk 用 0 补齐
  let jsonText = JSON.stringify(json);
  const jsonPad = pad4(Buffer.byteLength(jsonText, 'utf8'));
  if (jsonPad) jsonText += ' '.repeat(jsonPad);
  const jsonBuf = Buffer.from(jsonText, 'utf8');

  const binPadding = pad4(binLength);
  const binBuf = binPadding
    ? Buffer.concat(binParts.concat([Buffer.alloc(binPadding, 0)]))
    : Buffer.concat(binParts);

  const totalLength = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const out = Buffer.alloc(totalLength);
  let offset = 0;
  out.writeUInt32LE(GLB_MAGIC, offset); offset += 4;
  out.writeUInt32LE(2, offset); offset += 4;
  out.writeUInt32LE(totalLength, offset); offset += 4;
  out.writeUInt32LE(jsonBuf.length, offset); offset += 4;
  out.writeUInt32LE(CHUNK_JSON, offset); offset += 4;
  jsonBuf.copy(out, offset); offset += jsonBuf.length;
  out.writeUInt32LE(binBuf.length, offset); offset += 4;
  out.writeUInt32LE(CHUNK_BIN, offset); offset += 4;
  binBuf.copy(out, offset); offset += binBuf.length;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, out);
  return { bytes: out.length, meshes: (json.meshes || []).length, nodes: (json.nodes || []).length };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('用法: node tools/gltf-to-glb.js <输入.gltf> <输出.glb>');
    process.exit(1);
  }
  const result = convert(path.resolve(args[0]), path.resolve(args[1]));
  console.log('GLB 已生成: ' + args[1]);
  console.log('  ' + (result.bytes / 1024 / 1024).toFixed(2) + ' MB · ' +
    result.nodes + ' nodes / ' + result.meshes + ' meshes');
}

module.exports = { convert: convert };
