/* ==========================================================================
   world.js — 北京地铁 1号线 / 八通线 · Three.js 场景
   低多边形但结构可辨认：隧道/高架、岛式/侧式站台、屏蔽门、第三轨、DKZ4、
   驾驶室、前车、城市与光照。
   ========================================================================== */
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const C = global.Line1Core;
  if (!THREE) throw new Error('Three.js 未加载');
  if (!C) throw new Error('Line1Core 未加载');

  const STATIONS = C.STATIONS;
  const VEHICLE = C.VEHICLE;
  const ROUTE = C.ROUTE;
  const TRACK_OFFSET = 5.5;
  const TRAIN_LENGTH = VEHICLE.consistLength;
  const TWO_PI = Math.PI * 2;

  function damp(current, target, lambda, dt) {
    return current + (target - current) * (1 - Math.exp(-lambda * dt));
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ------------------------------------------------------------------------
     纹理与材质
     ------------------------------------------------------------------------ */
  function canvasTexture(w, h, draw, opts) {
    opts = opts || {};
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    draw(ctx, w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = opts.anisotropy || 4;
    tex.wrapS = opts.wrapS || THREE.ClampToEdgeWrapping;
    tex.wrapT = opts.wrapT || THREE.ClampToEdgeWrapping;
    if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
    return tex;
  }

  function makeBallastTexture() {
    return canvasTexture(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#34383a';
      ctx.fillRect(0, 0, w, h);
      const rnd = makeRng(77);
      for (let i = 0; i < 2600; i++) {
        const g = 35 + Math.floor(rnd() * 55);
        ctx.fillStyle = 'rgb(' + g + ',' + (g + 2) + ',' + (g + 1) + ')';
        const r = 0.7 + rnd() * 2.2;
        ctx.beginPath();
        ctx.arc(rnd() * w, rnd() * h, r, 0, TWO_PI);
        ctx.fill();
      }
      // 轨枕（每 0.65m 一条，纹理覆盖约 9.6m）
      for (let y = 0; y < h; y += 17) {
        ctx.fillStyle = 'rgba(93,88,78,.88)';
        ctx.fillRect(0, y, w, 8);
        ctx.fillStyle = 'rgba(20,22,22,.30)';
        ctx.fillRect(0, y + 8, w, 2);
      }
    }, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
  }

  function makeConcreteTexture(base, seed) {
    return canvasTexture(128, 128, function (ctx, w, h) {
      ctx.fillStyle = base || '#676c6d';
      ctx.fillRect(0, 0, w, h);
      const rnd = makeRng(seed || 5);
      for (let i = 0; i < 900; i++) {
        const a = 0.03 + rnd() * 0.09;
        ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
        ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 2);
      }
      ctx.strokeStyle = 'rgba(0,0,0,.18)';
      ctx.lineWidth = 2;
      for (let i = 0; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo((w / 4) * i, 0);
        ctx.lineTo((w / 4) * i, h);
        ctx.stroke();
      }
    }, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
  }

  function makeTileTexture() {
    return canvasTexture(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#777873';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 32) {
        for (let x = 0; x < w; x += 32) {
          const v = (x / 32 + y / 32) % 2 === 0 ? 0.05 : -0.015;
          ctx.fillStyle = 'rgba(255,255,255,' + (0.025 + v) + ')';
          ctx.fillRect(x + 1, y + 1, 30, 30);
        }
      }
      ctx.strokeStyle = 'rgba(30,31,30,.32)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= w; i += 32) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
      }
    }, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
  }

  function makeStationSignTexture(name, en, code, major) {
    return canvasTexture(768, 220, function (ctx, w, h) {
      ctx.fillStyle = '#0b1926';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#b21f32';
      ctx.fillRect(0, 0, w, 15);
      ctx.fillRect(0, h - 8, w, 8);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = 'bold 78px "Microsoft YaHei","Noto Sans SC",sans-serif';
      ctx.fillText(name, 30, 32);
      ctx.font = '28px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#b9c9d8';
      ctx.fillText(en.toUpperCase(), 34, 126);
      ctx.textAlign = 'right';
      ctx.font = 'bold 36px "Bahnschrift","Segoe UI",sans-serif';
      ctx.fillStyle = major ? '#ffcc55' : '#7893a9';
      ctx.fillText(code, w - 28, 40);
      ctx.font = '24px "Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#e7eef4';
      ctx.fillText('1号线 / 八通线', w - 28, 140);
      ctx.fillStyle = '#b21f32';
      ctx.fillRect(w - 126, 38, 8, 82);
    });
  }

  function makeStopMarkerTexture() {
    return canvasTexture(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#f1c51c';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#17191a';
      for (let i = -h; i < w + h; i += 64) {
        ctx.save();
        ctx.translate(i, 0);
        ctx.rotate(-Math.PI / 4);
        ctx.fillRect(0, -h, 32, h * 3);
        ctx.restore();
      }
      ctx.fillStyle = '#17191a';
      ctx.fillRect(16, 82, w - 32, 92);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 58px "Microsoft YaHei",sans-serif';
      ctx.fillText('停车标', w / 2, 128);
    });
  }

  function makeCbtcTexture() {
    return canvasTexture(256, 128, function (ctx, w, h) {
      ctx.fillStyle = '#0b2842';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#58c8ff';
      ctx.lineWidth = 8;
      ctx.strokeRect(6, 6, w - 12, h - 12);
      ctx.fillStyle = '#e8f7ff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 48px "Bahnschrift","Segoe UI",sans-serif';
      ctx.fillText('CBTC', w / 2, 45);
      ctx.font = '24px "Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#88d4ff';
      ctx.fillText('移动闭塞', w / 2, 92);
    });
  }

  function makeSpeedTexture() {
    return canvasTexture(256, 256, function (ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#f4f4ef';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 116, 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = '#b21f32';
      ctx.lineWidth = 18;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 108, 0, TWO_PI);
      ctx.stroke();
      ctx.fillStyle = '#171a1c';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 108px "Bahnschrift","Segoe UI",sans-serif';
      ctx.fillText('70', w / 2, h / 2 - 6);
      ctx.font = 'bold 28px "Microsoft YaHei",sans-serif';
      ctx.fillText('km/h', w / 2, h / 2 + 68);
    });
  }

  function makeWarningTexture() {
    return canvasTexture(256, 128, function (ctx, w, h) {
      ctx.fillStyle = '#f1c51c';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#17191a';
      ctx.fillRect(0, 0, w, 10);
      ctx.fillRect(0, h - 10, w, 10);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 31px "Microsoft YaHei",sans-serif';
      ctx.fillText('第三轨有电', w / 2, 43);
      ctx.font = 'bold 26px "Microsoft YaHei",sans-serif';
      ctx.fillText('禁止靠近', w / 2, 84);
    });
  }

  /* ------------------------------------------------------------------------
     几何工具
     ------------------------------------------------------------------------ */
  function ribbonGeometry(lateral, width, y, startS, endS, step, vScale) {
    step = step || 4;
    vScale = vScale || 10;
    const count = Math.max(1, Math.ceil((endS - startS) / step));
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= count; i++) {
      const s = startS + (endS - startS) * (i / count);
      const l = lateral - width / 2;
      const r = lateral + width / 2;
      const pl = ROUTE.point(s, l, y);
      const pr = ROUTE.point(s, r, y);
      positions.push(pl.x, pl.y, pl.z, pr.x, pr.y, pr.z);
      uvs.push(0, s / vScale, 1, s / vScale);
      if (i < count) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  function wallGeometry(lateral, y0, y1, startS, endS, step, vScale, flip) {
    step = step || 5;
    vScale = vScale || 8;
    const count = Math.max(1, Math.ceil((endS - startS) / step));
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= count; i++) {
      const s = startS + (endS - startS) * (i / count);
      const pb = ROUTE.point(s, lateral, y0);
      const pt = ROUTE.point(s, lateral, y1);
      positions.push(pb.x, pb.y, pb.z, pt.x, pt.y, pt.z);
      uvs.push(s / vScale, 0, s / vScale, 1);
      if (i < count) {
        const a = i * 2;
        if (flip) indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        else indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  function addRibbon(scene, mat, lateral, width, y, startS, endS, step, vScale) {
    const m = new THREE.Mesh(ribbonGeometry(lateral, width, y, startS, endS, step, vScale), mat);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  function addWall(scene, mat, lateral, y0, y1, startS, endS, step, vScale, flip) {
    const m = new THREE.Mesh(wallGeometry(lateral, y0, y1, startS, endS, step, vScale, flip), mat);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  // 变横向偏距的条带：用于上下行左右互换的交叉曲线
  function ribbonGeometryAt(latFn, width, y, startS, endS, step, vScale) {
    step = step || 3;
    vScale = vScale || 10;
    const count = Math.max(1, Math.ceil((endS - startS) / step));
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= count; i++) {
      const s = startS + (endS - startS) * (i / count);
      const c = latFn(s);
      const pl = ROUTE.point(s, c - width / 2, y);
      const pr = ROUTE.point(s, c + width / 2, y);
      positions.push(pl.x, pl.y, pl.z, pr.x, pr.y, pr.z);
      uvs.push(0, s / vScale, 1, s / vScale);
      if (i < count) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  function addRibbonAt(scene, mat, latFn, width, y, startS, endS, step, vScale) {
    const m = new THREE.Mesh(ribbonGeometryAt(latFn, width, y, startS, endS, step, vScale), mat);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  function box(w, h, d, mat, x, y, z, parent) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (parent) parent.add(m);
    return m;
  }

  function plane(w, h, mat, x, y, z, rotY, parent) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    if (rotY) m.rotation.y = rotY;
    if (parent) parent.add(m);
    return m;
  }

  /* ------------------------------------------------------------------------
     创建世界
     ------------------------------------------------------------------------ */
  function createWorld(canvas, options) {
    options = options || {};
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 4;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fc4e8);
    scene.fog = new THREE.Fog(0x9fc4e8, 120, 1800);

    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 2600);
    camera.position.set(0, 10, 0);
    scene.add(camera);

    /* ---------------------------- 灯光 ---------------------------- */
    const hemi = new THREE.HemisphereLight(0xcfe5ff, 0x4a4b49, 0.95);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff0d4, 1.9);
    sun.position.set(80, 180, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -130;
    sun.shadow.camera.right = 130;
    sun.shadow.camera.top = 130;
    sun.shadow.camera.bottom = -130;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 500;
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    scene.add(sun.target);

    const fill = new THREE.DirectionalLight(0x8fb4d8, 0.25);
    fill.position.set(-100, 80, -60);
    scene.add(fill);

    const tunnelLightA = new THREE.PointLight(0xffe6bd, 0, 65, 2);
    const tunnelLightB = new THREE.PointLight(0xffdfae, 0, 48, 2);
    scene.add(tunnelLightA);
    scene.add(tunnelLightB);

    /* ---------------------------- 材质 ---------------------------- */
    const ballastTex = makeBallastTexture();
    ballastTex.anisotropy = maxAniso;
    const concreteTex = makeConcreteTexture('#626667', 11);
    concreteTex.anisotropy = maxAniso;
    const wallTex = makeConcreteTexture('#44494b', 21);
    wallTex.anisotropy = maxAniso;
    const tileTex = makeTileTexture();
    tileTex.anisotropy = maxAniso;
    tileTex.repeat.set(24, 1);

    const MAT = {
      ballast: new THREE.MeshStandardMaterial({ map: ballastTex, color: 0xcfcfc9, roughness: 0.98, metalness: 0.02 }),
      concrete: new THREE.MeshStandardMaterial({ map: concreteTex, color: 0xb4b6b3, roughness: 0.96 }),
      tunnelWall: new THREE.MeshStandardMaterial({ map: wallTex, color: 0x8b8e8d, roughness: 0.95, side: THREE.DoubleSide }),
      tunnelDark: new THREE.MeshStandardMaterial({ color: 0x252a2c, roughness: 0.92, side: THREE.DoubleSide }),
      rail: new THREE.MeshStandardMaterial({ color: 0xbfc5c7, roughness: 0.25, metalness: 0.85 }),
      railSide: new THREE.MeshStandardMaterial({ color: 0x6d6e6a, roughness: 0.45, metalness: 0.6 }),
      sleeper: new THREE.MeshStandardMaterial({ color: 0x777064, roughness: 0.95 }),
      thirdRail: new THREE.MeshStandardMaterial({ color: 0xd9a932, roughness: 0.35, metalness: 0.65 }),
      thirdCover: new THREE.MeshStandardMaterial({ color: 0x1c2428, roughness: 0.7 }),
      platform: new THREE.MeshStandardMaterial({ map: tileTex, color: 0xc9c8bf, roughness: 0.88 }),
      platformEdge: new THREE.MeshStandardMaterial({ color: 0xbfc3c3, roughness: 0.65 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xe7b524, roughness: 0.62 }),
      red: new THREE.MeshStandardMaterial({ color: 0xb21f32, roughness: 0.55 }),
      white: new THREE.MeshStandardMaterial({ color: 0xe7e8e2, roughness: 0.55 }),
      darkMetal: new THREE.MeshStandardMaterial({ color: 0x24292c, roughness: 0.5, metalness: 0.55 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x8f9699, roughness: 0.4, metalness: 0.65 }),
      roof: new THREE.MeshStandardMaterial({ color: 0x3c474b, roughness: 0.82, metalness: 0.18 }),
      roofSoffit: new THREE.MeshStandardMaterial({ color: 0x20292d, roughness: 0.9, metalness: 0.1 }),
      stationCeiling: new THREE.MeshStandardMaterial({ color: 0x4d5658, roughness: 0.9, metalness: 0.08 }),
      glass: new THREE.MeshStandardMaterial({
        color: 0x9fd4e2, roughness: 0.12, metalness: 0.05,
        transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide
      }),
      soundBarrier: new THREE.MeshStandardMaterial({
        color: 0x879192, roughness: 0.62, metalness: 0.12,
        transparent: true, opacity: 0.36, depthWrite: false, side: THREE.DoubleSide
      }),
      psdFrame: new THREE.MeshStandardMaterial({ color: 0x777f83, roughness: 0.4, metalness: 0.6 }),
      lightStrip: new THREE.MeshBasicMaterial({ color: 0xfff4d7 }),
      stationLight: new THREE.MeshBasicMaterial({ color: 0xd9f1ff }),
      signBack: new THREE.MeshStandardMaterial({ color: 0x101c27, roughness: 0.55 }),
      ground: new THREE.MeshStandardMaterial({ color: 0x3e4b3f, roughness: 1 }),
      road: new THREE.MeshStandardMaterial({ color: 0x3b4043, roughness: 1 }),
      building: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      treeTrunk: new THREE.MeshLambertMaterial({ color: 0x5b4632 }),
      treeLeaf: new THREE.MeshLambertMaterial({ color: 0x47633f }),
      bridge: new THREE.MeshStandardMaterial({ color: 0x777b7b, roughness: 0.9 }),
      cabDark: new THREE.MeshStandardMaterial({ color: 0x242a2d, roughness: 0.7 }),
      cabBeige: new THREE.MeshStandardMaterial({ color: 0x9d988d, roughness: 0.75 }),
      cabConsole: new THREE.MeshStandardMaterial({ color: 0x363d40, roughness: 0.58 }),
      cabRed: new THREE.MeshStandardMaterial({ color: 0xb21f32, roughness: 0.4 }),
      cabGreen: new THREE.MeshStandardMaterial({ color: 0x1f9a57, emissive: 0x0b3b20, emissiveIntensity: 0.5 }),
      cabAmber: new THREE.MeshStandardMaterial({ color: 0xdb8c22, emissive: 0x593200, emissiveIntensity: 0.45 }),
      trainBody: new THREE.MeshStandardMaterial({ color: 0xd4d6d1, roughness: 0.42, metalness: 0.35 }),
      trainBodyDark: new THREE.MeshStandardMaterial({ color: 0x9fa3a1, roughness: 0.55, metalness: 0.25 }),
      trainRed: new THREE.MeshStandardMaterial({ color: 0x9c1b2d, roughness: 0.45, metalness: 0.1 }),
      trainGlass: new THREE.MeshStandardMaterial({ color: 0x0e1a20, roughness: 0.15, metalness: 0.4 }),
      trainRoof: new THREE.MeshStandardMaterial({ color: 0x82898a, roughness: 0.65, metalness: 0.3 }),
      trainBlack: new THREE.MeshStandardMaterial({ color: 0x15191a, roughness: 0.75 }),
      headlight: new THREE.MeshBasicMaterial({ color: 0xfff5cf }),
      taillight: new THREE.MeshBasicMaterial({ color: 0xff3326 }),
      destination: new THREE.MeshBasicMaterial({ color: 0xffb63c }),
      stationSignMat: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      stopSignMat: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      cbtcSignMat: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      speedSignMat: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true }),
      warnSignMat: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    };

    const stopTex = makeStopMarkerTexture();
    const cbtcTex = makeCbtcTexture();
    const speedTex = makeSpeedTexture();
    const warnTex = makeWarningTexture();
    stopTex.anisotropy = maxAniso;
    cbtcTex.anisotropy = maxAniso;

    /* ---------------------------- 世界根节点 ---------------------------- */
    const staticRoot = new THREE.Group();
    const dynamicRoot = new THREE.Group();
    const stationRoot = new THREE.Group();
    const cityRoot = new THREE.Group();
    const trainRoot = new THREE.Group();
    scene.add(staticRoot, dynamicRoot, stationRoot, cityRoot, trainRoot);

    /* ---------------------------- 地面与城市 ---------------------------- */
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(62000, 4200, 1, 1), MAT.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -2.4, 0);
    ground.receiveShadow = true;
    cityRoot.add(ground);

    const roadPlane = new THREE.Mesh(new THREE.PlaneGeometry(62000, 15), MAT.road);
    roadPlane.rotation.x = -Math.PI / 2;
    roadPlane.position.set(0, -2.25, -26);
    cityRoot.add(roadPlane);

    function buildCity() {
      const rnd = makeRng(20240611);
      const count = 420;
      const bGeo = new THREE.BoxGeometry(1, 1, 1);
      const buildings = new THREE.InstancedMesh(bGeo, MAT.building, count);
      const dummy = new THREE.Object3D();
      const colors = [0x8a8b86, 0x9a968c, 0x7f8589, 0xa9a69d, 0x6f777b, 0xb5ada1, 0x8d969a];
      let idx = 0;
      for (let s = 35500; s < 50800 && idx < count; s += 105) {
        for (let side = -1; side <= 1 && idx < count; side += 2) {
          if (rnd() < 0.22) continue;
          const lateral = side * (23 + rnd() * 72);
          const p = ROUTE.point(s, lateral, -2.2);
          const w = 8 + rnd() * 17;
          const d = 8 + rnd() * 16;
          const h = 7 + rnd() * (rnd() > 0.86 ? 58 : 28);
          dummy.position.set(p.x, -2.2 + h / 2, p.z);
          dummy.rotation.set(0, Math.atan2(-p.tz, p.tx) + (rnd() - 0.5) * 0.18, 0);
          dummy.scale.set(w, h, d);
          dummy.updateMatrix();
          buildings.setMatrixAt(idx, dummy.matrix);
          const col = new THREE.Color(colors[Math.floor(rnd() * colors.length)]);
          buildings.setColorAt(idx, col);
          idx++;
        }
        if (idx >= count) break;
      }
      buildings.count = idx;
      buildings.instanceMatrix.needsUpdate = true;
      if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
      buildings.receiveShadow = false;
      buildings.castShadow = false;
      cityRoot.add(buildings);

      // 树木
      const treeCount = 240;
      const trunkGeo = new THREE.CylinderGeometry(0.17, 0.25, 2.6, 5);
      const leafGeo = new THREE.IcosahedronGeometry(1.25, 0);
      const trunks = new THREE.InstancedMesh(trunkGeo, MAT.treeTrunk, treeCount);
      const leaves = new THREE.InstancedMesh(leafGeo, MAT.treeLeaf, treeCount);
      let ti = 0;
      for (let s = 35500; s < 50700 && ti < treeCount; s += 78) {
        for (let side = -1; side <= 1 && ti < treeCount; side += 2) {
          if (rnd() < 0.3) continue;
          const lateral = side * (13 + rnd() * 11);
          const p = ROUTE.point(s, lateral, -2.2);
          dummy.position.set(p.x, p.y + 1.3, p.z);
          dummy.scale.set(1, 0.8 + rnd() * 0.65, 1);
          dummy.rotation.set(0, rnd() * 6.28, 0);
          dummy.updateMatrix();
          trunks.setMatrixAt(ti, dummy.matrix);
          dummy.position.y = p.y + 3.1 * dummy.scale.y;
          dummy.scale.set(0.85 + rnd() * 0.45, 0.8 + rnd() * 0.55, 0.85 + rnd() * 0.45);
          dummy.updateMatrix();
          leaves.setMatrixAt(ti, dummy.matrix);
          ti++;
        }
      }
      trunks.count = ti;
      leaves.count = ti;
      trunks.instanceMatrix.needsUpdate = true;
      leaves.instanceMatrix.needsUpdate = true;
      cityRoot.add(trunks, leaves);
    }

    /* ---------------------------- 轨道 ---------------------------- */
    // 花庄站南侧上下行左右互换：区间内两条正线以 X 形交叉，交叉后各自贴到对侧。
    // 纯视觉改造——列车仍按主逻辑沿线路中线（±TRACK_OFFSET）直行。
    const CROSSOVER = (function () {
      const hz = C.STATION_BY_NAME['花庄'];
      const s0 = hz.s + 88;
      const len = 168;
      return Object.freeze({ s0: s0, s1: s0 + len, len: len, stationS: hz.s });
    })();

    function trackLateralAt(side, s) {
      const base = side * TRACK_OFFSET;
      if (s <= CROSSOVER.s0) return base;
      if (s >= CROSSOVER.s1) return -base;
      const t = (s - CROSSOVER.s0) / CROSSOVER.len;
      const k = t * t * (3 - 2 * t);
      return base * (1 - 2 * k);
    }

    function buildTrack() {
      const L = C.LINE.lengthM;
      const A = -180;
      const B = L + 180;
      // 道床
      addRibbon(staticRoot, MAT.ballast, 0, 17.2, -0.06, A, B, 4, 9.6);
      // 两侧电缆槽 / 疏散通道
      addRibbon(staticRoot, MAT.concrete, 8.55, 1.15, 0.11, A, B, 5, 6);
      addRibbon(staticRoot, MAT.concrete, -8.55, 1.15, 0.11, A, B, 5, 6);
      addRibbon(staticRoot, MAT.darkMetal, 8.55, 0.55, 0.18, A, B, 8, 4);
      addRibbon(staticRoot, MAT.darkMetal, -8.55, 0.55, 0.18, A, B, 8, 4);

      // 轨道条带分三段：普通区间 4 m 采样，花庄交叉段 1.2 m 采样（既保证曲线平滑，又不让顶点数爆炸）
      function addTrackRibbon(mat, latFn, width, y, stepOut, vScale) {
        addRibbonAt(staticRoot, mat, latFn, width, y, A, CROSSOVER.s0, stepOut || 4, vScale || 3);
        addRibbonAt(staticRoot, mat, latFn, width, y, CROSSOVER.s0, CROSSOVER.s1, 1.2, vScale || 3);
        addRibbonAt(staticRoot, mat, latFn, width, y, CROSSOVER.s1, B, stepOut || 4, vScale || 3);
      }
      [-1, 1].forEach(function (side) {
        // 上下行交叉段横向偏距连续变化：±0.7175 为轨距半宽，第三轨随轨道一起过交叉
        const lift = side > 0 ? 0 : 0.004;
        addTrackRibbon(MAT.rail, function (s) {
          return trackLateralAt(side, s) - 0.7175;
        }, 0.085, 0.145 + lift, 4, 3);
        addTrackRibbon(MAT.rail, function (s) {
          return trackLateralAt(side, s) + 0.7175;
        }, 0.085, 0.145 + lift, 4, 3);
        // 第三轨（接触轨）及防护罩
        const thirdLat = function (s) { return trackLateralAt(side, s) + side * 1.62; };
        addTrackRibbon(MAT.thirdRail, thirdLat, 0.15, 0.42 + lift, 5, 4);
        addTrackRibbon(MAT.thirdCover, thirdLat, 0.34, 0.56 + lift, 5, 4);
      });

      // 动态轨枕
      const sleeperGeo = new THREE.BoxGeometry(0.24, 0.10, 2.65);
      const count = 1200;
      const sleepers = new THREE.InstancedMesh(sleeperGeo, MAT.sleeper, count);
      sleepers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      sleepers.frustumCulled = false;
      sleepers.receiveShadow = true;
      staticRoot.add(sleepers);
      const dummy = new THREE.Object3D();
      let sleeperKey = '';
      function updateSleepers(centerS) {
        const key = Math.round(centerS / 2.5);
        if (key === sleeperKey) return;
        sleeperKey = key;
        let i = 0;
        const start = Math.max(-165, centerS - 205);
        const end = Math.min(C.LINE.lengthM + 165, centerS + 205);
        for (let s = start; s <= end && i < count; s += 0.68) {
          for (let side = -1; side <= 1 && i < count; side += 2) {
            const lat = trackLateralAt(side, s);
            const p = ROUTE.point(s, lat, 0.025);
            const slope = trackLateralAt(side, s + 0.5) - trackLateralAt(side, s - 0.5);
            dummy.position.set(p.x, p.y, p.z);
            dummy.rotation.set(0, p.yaw - Math.atan(slope), 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            sleepers.setMatrixAt(i, dummy.matrix);
            i++;
          }
        }
        sleepers.count = i;
        sleepers.instanceMatrix.needsUpdate = true;
      }
      updateSleepers(0);
      return updateSleepers;
    }

    /* ---------------------------- 隧道 ---------------------------- */
    function buildTunnel() {
      // 地下侧式站台的站厅比区间隧道宽：站台范围内断开隧道侧墙，由站体端墙收口。
      const stationGaps = STATIONS.filter(function (st) {
        return st.env === 'underground' && (st.platform === 'side' || st.platform === 'island_side');
      }).map(function (st) {
        return [st.s - st.platformLength / 2, st.s + st.platformLength / 2];
      }).sort(function (a, b) { return a[0] - b[0]; });
      // 古城车辆段洞室同样需要断开隧道
      stationGaps.push([DEPOT_CAVERN.s0, DEPOT_CAVERN.s1]);
      stationGaps.sort(function (a, b) { return a[0] - b[0]; });
      const ranges = [];
      [[-180, 33400], [52200, C.LINE.lengthM + 180]].forEach(function (base) {
        let cursor = base[0];
        stationGaps.forEach(function (gap) {
          if (gap[1] <= cursor || gap[0] >= base[1]) return;
          if (gap[0] > cursor) ranges.push([cursor, Math.min(gap[0], base[1])]);
          cursor = Math.max(cursor, gap[1]);
        });
        if (cursor < base[1]) ranges.push([cursor, base[1]]);
      });
      ranges.forEach(function (range) {
        const a = range[0];
        const b = range[1];
        // 侧墙、顶板、设备槽
        const wallR = addWall(staticRoot, MAT.tunnelWall, 10.1, 0, 6.1, a, b, 6, 9, true);
        const wallL = addWall(staticRoot, MAT.tunnelWall, -10.1, 0, 6.1, a, b, 6, 9, false);
        wallR.userData.tunnelWallRange = [a, b];
        wallL.userData.tunnelWallRange = [a, b];
        addRibbon(staticRoot, MAT.tunnelDark, 0, 20.2, 6.08, a, b, 6, 9);
        addWall(staticRoot, MAT.tunnelDark, 9.9, 0, 0.55, a, b, 8, 6, true);
        addWall(staticRoot, MAT.tunnelDark, -9.9, 0, 0.55, a, b, 8, 6, false);
        // 侧壁光带
        const count = Math.ceil((b - a) / 18) * 2;
        const geo = new THREE.BoxGeometry(0.08, 0.16, 1.5);
        const lights = new THREE.InstancedMesh(geo, MAT.lightStrip, count);
        const dummy = new THREE.Object3D();
        let idx = 0;
        for (let s = a + 8; s < b && idx < count; s += 18) {
          [-1, 1].forEach(function (side) {
            if (idx >= count) return;
            const p = ROUTE.point(s, side * 9.85, 4.85);
            dummy.position.set(p.x, p.y, p.z);
            dummy.rotation.set(0, p.yaw, 0);
            dummy.updateMatrix();
            lights.setMatrixAt(idx, dummy.matrix);
            idx++;
          });
        }
        lights.count = idx;
        lights.instanceMatrix.needsUpdate = true;
        staticRoot.add(lights);
      });

      // 洞门
      [33400, 52200].forEach(function (s) {
        const p = ROUTE.point(s, 0, 0);
        const portal = new THREE.Group();
        portal.position.set(p.x, p.y, p.z);
        portal.rotation.y = p.yaw;
        box(2.4, 7.0, 2.8, MAT.concrete, 0, 3.5, 10.2, portal);
        box(2.4, 7.0, 2.8, MAT.concrete, 0, 3.5, -10.2, portal);
        box(2.4, 1.8, 23.2, MAT.concrete, 0, 7.1, 0, portal);
        staticRoot.add(portal);
      });
    }

    /* ---------------------------- 高架 ---------------------------- */
    function buildViaduct() {
      const a = 35000;
      const b = 52200;
      // 桥面板与边梁
      addRibbon(staticRoot, MAT.concrete, 0, 21, -0.42, a, b, 6, 8);
      addWall(staticRoot, MAT.concrete, 10.4, -1.35, 0.0, a, b, 6, 8, true);
      addWall(staticRoot, MAT.concrete, -10.4, -1.35, 0.0, a, b, 6, 8, false);
      // 桥下阴影板
      addRibbon(staticRoot, MAT.tunnelDark, 0, 21, -1.38, a, b, 8, 10);

      // 灰色半透明隔音屏：连续覆盖高架区间，在车站站台范围留缺口。
      const stationGaps = STATIONS
        .filter(function (st) { return st.s > a + 150 && st.s < b - 150 && st.env !== 'underground'; })
        .map(function (st) { return [st.s - 86, st.s + 86]; })
        .sort(function (x, y) { return x[0] - y[0]; });
      const barrierSegments = [];
      let cursor = a + 20;
      stationGaps.forEach(function (gap) {
        if (gap[0] > cursor + 20) barrierSegments.push([cursor, gap[0]]);
        cursor = Math.max(cursor, gap[1]);
      });
      if (cursor < b - 20) barrierSegments.push([cursor, b - 20]);
      barrierSegments.forEach(function (seg) {
        addWall(staticRoot, MAT.soundBarrier, 10.58, 0.08, 2.46, seg[0], seg[1], 7, 8, true);
        addWall(staticRoot, MAT.soundBarrier, -10.58, 0.08, 2.46, seg[0], seg[1], 7, 8, false);
      });

      const postGeo = new THREE.BoxGeometry(0.14, 2.38, 0.14);
      const posts = new THREE.InstancedMesh(postGeo, MAT.darkMetal, 5000);
      const postDummy = new THREE.Object3D();
      let postIdx = 0;
      barrierSegments.forEach(function (seg) {
        for (let s = seg[0] + 4; s < seg[1] && postIdx < 5000; s += 9) {
          [-1, 1].forEach(function (side) {
            if (postIdx >= 5000) return;
            const p = ROUTE.point(s, side * 10.58, 1.27);
            postDummy.position.set(p.x, p.y, p.z);
            postDummy.rotation.set(0, p.yaw, 0);
            postDummy.updateMatrix();
            posts.setMatrixAt(postIdx, postDummy.matrix);
            postIdx++;
          });
        }
      });
      posts.count = postIdx;
      posts.instanceMatrix.needsUpdate = true;
      posts.castShadow = true;
      staticRoot.add(posts);

      const count = Math.ceil((b - a) / 30);
      const pierGeo = new THREE.BoxGeometry(2.6, 1, 5.2);
      const piers = new THREE.InstancedMesh(pierGeo, MAT.concrete, count);
      const dummy = new THREE.Object3D();
      let idx = 0;
      for (let s = a + 15; s < b && idx < count; s += 30) {
        const p = ROUTE.point(s, 0, 0);
        const h = Math.max(1.2, p.y - 1.4 + 2.4);
        dummy.position.set(p.x, -2.4 + h / 2, p.z);
        dummy.rotation.set(0, p.yaw, 0);
        dummy.scale.set(1, h, 1);
        dummy.updateMatrix();
        piers.setMatrixAt(idx, dummy.matrix);
        idx++;
      }
      piers.count = idx;
      piers.instanceMatrix.needsUpdate = true;
      piers.castShadow = true;
      piers.receiveShadow = true;
      staticRoot.add(piers);

      // 跨线桥
      [38000, 43500, 48700].forEach(function (s) {
        const p = ROUTE.point(s, 0, 0);
        const g = new THREE.Group();
        g.position.set(p.x, p.y + 8.5, p.z);
        g.rotation.y = p.yaw;
        box(7.5, 1.8, 64, MAT.bridge, 0, 0, 0, g);
        box(2.0, 8.5, 3.2, MAT.concrete, 0, -5.2, 27, g);
        box(2.0, 8.5, 3.2, MAT.concrete, 0, -5.2, -27, g);
        staticRoot.add(g);
      });
    }

    /* ---------------------------- 配线（静态装饰） ---------------------------- */
    // 车辆段出入线、折返线、联络线只用于观赏：用 CatmullRomCurve3 生成静态钢轨、道床与
    // 轨枕，不注册到任何碰撞、限速或 ATO 逻辑，列车也永远不会开上去。
    const YARD = Object.freeze({
      railY: 0.145,
      gauge: 1.435,
      railWidth: 0.085,
      crossBias: 0.005
    });

    // 古城车辆段明挖扩大区：站西侧 146 m 的加宽洞室，区间隧道在此断开
    const DEPOT_CAVERN = Object.freeze({
      s0: 5952,
      s1: 6098,
      halfWidth: 30,
      height: 8.0
    });

    // 外观机位在洞室内可以放宽的断面
    const DEPOT_CAMERA_ZONES = [
      { s0: DEPOT_CAVERN.s0, s1: DEPOT_CAVERN.s1, halfWidth: 27, ceiling: 7.2 }
    ];

    const yardSleeperSpots = [];
    const yardLongSpots = [];
    const yardInfo = [];
    let yardRailMat = null;
    let yardSleeperMat = null;

    // 配线专用材质：在 5 mm 抬升之外再加一层深度偏移，彻底消除汇合处闪烁
    function yardRailMaterial() {
      if (!yardRailMat) {
        yardRailMat = MAT.rail.clone();
        yardRailMat.polygonOffset = true;
        yardRailMat.polygonOffsetFactor = -2;
        yardRailMat.polygonOffsetUnits = -2;
      }
      return yardRailMat;
    }

    function yardSleeperMaterial() {
      if (!yardSleeperMat) {
        yardSleeperMat = MAT.sleeper.clone();
        yardSleeperMat.polygonOffset = true;
        yardSleeperMat.polygonOffsetFactor = -2;
        yardSleeperMat.polygonOffsetUnits = -2;
      }
      return yardSleeperMat;
    }

    function yardCurve(list) {
      const pts = list.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); });
      return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    }

    // 两端斜率为 0 的过渡曲线：保证与主线 / 相邻配线在接点处相切
    function yardTransition(sA, latA, sB, latB, upA, upB) {
      const list = [];
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const e = t * t * (3 - 2 * t);
        list.push([sA + (sB - sA) * t, latA + (latB - latA) * e, upA + (upB - upA) * e]);
      }
      return yardCurve(list);
    }

    function yardUpAt(s, absRailY) {
      return absRailY - ROUTE.elevation(s);
    }

    function sampleYard(curve, step) {
      const n = Math.max(6, Math.ceil(curve.getLength() / (step || 3)));
      return curve.getSpacedPoints(n).map(function (pt) {
        const w = ROUTE.point(pt.x, pt.y, pt.z);
        w.s = pt.x;
        w.lat = pt.y;
        return w;
      });
    }

    function yardForward(pts, i) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1e-6) return { x: 1, z: 0 };
      return { x: dx / len, z: dz / len };
    }

    function addYardRails(pts, opts) {
      opts = opts || {};
      const halfGauge = YARD.gauge / 2;
      const rw = YARD.railWidth;
      const bias = opts.bias == null ? YARD.crossBias : opts.bias;
      const n = pts.length - 1;
      for (let side = -1; side <= 1; side += 2) {
        const positions = [];
        const uvs = [];
        const indices = [];
        for (let i = 0; i <= n; i++) {
          const f = yardForward(pts, i);
          const rx = -f.z;
          const rz = f.x;
          const c = pts[i];
          const y = c.y + bias;
          const o = side * halfGauge;
          positions.push(c.x + rx * (o - rw / 2), y, c.z + rz * (o - rw / 2));
          positions.push(c.x + rx * (o + rw / 2), y, c.z + rz * (o + rw / 2));
          uvs.push(0, i * 0.4, 1, i * 0.4);
          if (i < n) {
            const a = i * 2;
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, yardRailMaterial());
        m.receiveShadow = true;
        staticRoot.add(m);
      }
    }

    function addYardBed(pts, width, drop) {
      const positions = [];
      const uvs = [];
      const indices = [];
      const n = pts.length - 1;
      for (let i = 0; i <= n; i++) {
        const f = yardForward(pts, i);
        const rx = -f.z;
        const rz = f.x;
        const c = pts[i];
        const y = c.y + (drop || -0.205);
        positions.push(c.x - rx * width / 2, y, c.z - rz * width / 2);
        positions.push(c.x + rx * width / 2, y, c.z + rz * width / 2);
        uvs.push(0, i * 0.35, 1, i * 0.35);
        if (i < n) {
          const a = i * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, MAT.ballast);
      m.receiveShadow = true;
      staticRoot.add(m);
    }

    function addYardSleepers(pts, throat) {
      const spacing = 0.68;
      let remaining = spacing;
      const n = pts.length - 1;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dz * dz + dy * dy);
        if (d < 1e-6) continue;
        const long = !!throat && (i <= 3 || i >= n - 2);
        let t = remaining;
        while (t <= d) {
          const k = t / d;
          const spot = {
            x: a.x + dx * k,
            y: a.y + dy * k - 0.113,
            z: a.z + dz * k,
            yaw: Math.atan2(-dz, dx)
          };
          if (long) yardLongSpots.push(spot);
          else yardSleeperSpots.push(spot);
          t += spacing;
        }
        remaining = spacing - (d - (t - spacing));
      }
    }

    // 菱形交叉处的加长枕木：垂直于两条轨道的角平分线铺 3 根
    function addDiamondTimbers(s, lat, up) {
      const yaw = (ROUTE.point(s, 0, 0).yaw) || 0;
      for (let k = -1; k <= 1; k++) {
        const p = ROUTE.point(s + k * 0.72, lat, up - 0.113);
        yardLongSpots.push({ x: p.x, y: p.y, z: p.z, yaw: yaw });
      }
    }

    // 隧道侧壁上的配线洞门：黑色洞口 + 混凝土门框，读作“联络线由此拐出”
    function addYardPortal(s, lat, up) {
      const p = ROUTE.point(s, lat, up);
      const g = new THREE.Group();
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = p.yaw;
      box(5.6, 4.7, 0.16, MAT.tunnelDark, 0, 2.3, 0, g);
      box(6.3, 0.55, 0.42, MAT.concrete, 0, 4.95, 0, g);
      box(0.55, 5.2, 0.42, MAT.concrete, -2.95, 2.45, 0, g);
      box(0.55, 5.2, 0.42, MAT.concrete, 2.95, 2.45, 0, g);
      staticRoot.add(g);
    }

    function flushYardSleepers() {
      if (yardSleeperSpots.length) {
        const geo = new THREE.BoxGeometry(0.24, 0.10, 2.65);
        const mesh = new THREE.InstancedMesh(geo, yardSleeperMaterial(), yardSleeperSpots.length);
        const dummy = new THREE.Object3D();
        for (let i = 0; i < yardSleeperSpots.length; i++) {
          const p = yardSleeperSpots[i];
          dummy.position.set(p.x, p.y, p.z);
          dummy.rotation.set(0, p.yaw, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.count = yardSleeperSpots.length;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.receiveShadow = true;
        staticRoot.add(mesh);
      }
      if (yardLongSpots.length) {
        const geo = new THREE.BoxGeometry(0.26, 0.115, 3.35);
        const mesh = new THREE.InstancedMesh(geo, yardSleeperMaterial(), yardLongSpots.length);
        const dummy = new THREE.Object3D();
        for (let i = 0; i < yardLongSpots.length; i++) {
          const p = yardLongSpots[i];
          dummy.position.set(p.x, p.y, p.z);
          dummy.rotation.set(0, p.yaw, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.count = yardLongSpots.length;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.receiveShadow = true;
        staticRoot.add(mesh);
      }
    }

    function buildYardTrack(name, curve, opts) {
      opts = opts || {};
      const pts = sampleYard(curve, opts.step || 3);
      addYardRails(pts, opts);
      if (opts.bed !== false) addYardBed(pts, opts.bedWidth || 3.2, opts.bedDrop);
      if (opts.sleepers !== false) addYardSleepers(pts, opts.throat);
      if (opts.deck) addYardDeck(pts, opts.deckWidth || 5.2);
      yardInfo.push({
        name: name,
        s0: Math.round(pts[0].s),
        s1: Math.round(pts[pts.length - 1].s),
        lat0: pts[0].lat,
        lat1: pts[pts.length - 1].lat,
        length: Math.round(pts[0].s === pts[pts.length - 1].s ? 0 : Math.abs(pts[pts.length - 1].s - pts[0].s))
      });
      return pts;
    }

    // 出入段线的桥面与桥墩（高架段下到地面的斜坡）
    function addYardDeck(pts, width) {
      const n = pts.length - 1;
      const positions = [];
      const indices = [];
      for (let i = 0; i <= n; i++) {
        const f = yardForward(pts, i);
        const rx = -f.z;
        const rz = f.x;
        const c = pts[i];
        const y = c.y - 0.30;
        positions.push(c.x - rx * width / 2, y, c.z - rz * width / 2);
        positions.push(c.x + rx * width / 2, y, c.z + rz * width / 2);
        if (i < n) {
          const a = i * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const deckMesh = new THREE.Mesh(geo, MAT.concrete);
      deckMesh.receiveShadow = true;
      staticRoot.add(deckMesh);

      // 桥墩：每隔 24 m 一根，落到地面
      const pierGeo = new THREE.BoxGeometry(1.6, 1, 3.4);
      const count = Math.max(1, Math.floor(pts.length / 9));
      const piers = new THREE.InstancedMesh(pierGeo, MAT.concrete, count + 1);
      const dummy = new THREE.Object3D();
      let idx = 0;
      for (let i = 0; i < pts.length && idx <= count; i += 9) {
        const c = pts[i];
        const groundY = -2.4;
        const top = c.y - 0.9;
        const h = Math.max(0.8, top - groundY);
        const f = yardForward(pts, i);
        dummy.position.set(c.x, groundY + h / 2, c.z);
        dummy.rotation.set(0, Math.atan2(-f.z, f.x), 0);
        dummy.scale.set(1, h, 1);
        dummy.updateMatrix();
        piers.setMatrixAt(idx, dummy.matrix);
        idx++;
      }
      piers.count = idx;
      piers.instanceMatrix.needsUpdate = true;
      piers.castShadow = true;
      piers.receiveShadow = true;
      staticRoot.add(piers);
    }

    // hangar=true：只做屋面与后端墙（地下洞室内没有空间立柱）
    function yardShed(s, lat, absRailY, length, width, height, hangar) {
      const p = ROUTE.point(s, lat, absRailY - ROUTE.elevation(s));
      const g = new THREE.Group();
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = p.yaw;
      // 屋面
      box(length, 0.5, width, MAT.roof, 0, height, 0, g);
      box(length - 1.2, 0.18, width - 1.2, MAT.roofSoffit, 0, height - 0.32, 0, g);
      if (hangar) {
        box(0.35, height, width, MAT.tunnelWall, length / 2 - 0.4, height / 2, 0, g);
        staticRoot.add(g);
        return;
      }
      // 立柱
      for (let x = -length / 2 + 3; x <= length / 2 - 3; x += 6.5) {
        [-1, 1].forEach(function (side) {
          box(0.5, height, 0.5, MAT.steel, x, height / 2, side * (width / 2 - 0.8), g);
        });
      }
      // 后墙与两侧矮墙
      box(0.35, height, width, MAT.tunnelWall, length / 2 - 0.4, height / 2, 0, g);
      [-1, 1].forEach(function (side) {
        box(length, 1.6, 0.28, MAT.tunnelWall, 0, 0.8, side * (width / 2 - 0.15), g);
      });
      staticRoot.add(g);
    }

    function buildDepotCavern() {
      const c = DEPOT_CAVERN;
      // 底面、侧墙、顶板
      addRibbon(staticRoot, MAT.concrete, 0, c.halfWidth * 2 + 4, -0.03, c.s0, c.s1, 5, 8);
      addWall(staticRoot, MAT.tunnelWall, c.halfWidth, 0, c.height, c.s0, c.s1, 6, 9, true);
      addWall(staticRoot, MAT.tunnelWall, -c.halfWidth, 0, c.height, c.s0, c.s1, 6, 9, false);
      addRibbon(staticRoot, MAT.tunnelDark, 0, c.halfWidth * 2 + 6, c.height, c.s0, c.s1, 6, 9);
      // 两端封头：把隧道 20.2 m 断面以外的洞室空间封住
      [c.s0, c.s1].forEach(function (s) {
        const p = ROUTE.point(s, 0, 0);
        const g = new THREE.Group();
        g.position.set(p.x, p.y, p.z);
        g.rotation.y = p.yaw;
        const span = c.halfWidth - 10.1;
        box(0.6, c.height, span, MAT.tunnelWall, 0, c.height / 2, 10.1 + span / 2, g);
        box(0.6, c.height, span, MAT.tunnelWall, 0, c.height / 2, -10.1 - span / 2, g);
        box(0.6, c.height - 6.1, 20.4, MAT.tunnelWall, 0, 6.1 + (c.height - 6.1) / 2, 0, g);
        staticRoot.add(g);
      });
      // 洞室照明
      for (let s = c.s0 + 10; s < c.s1 - 4; s += 16) {
        const p = ROUTE.point(s, 0, c.height - 0.28);
        const strip = box(1.8, 0.07, 0.34, MAT.lightStrip, p.x, p.y, p.z);
        strip.rotation.y = p.yaw;
      }
      [c.s0 + 26, c.s0 + 78, c.s0 + 126].forEach(function (s) {
        const p = ROUTE.point(s, 0, c.height - 1.4);
        const light = new THREE.PointLight(0xffe6bd, 1.1, 70, 2);
        light.position.set(p.x, p.y, p.z);
        scene.add(light);
      });
    }

    function buildYards() {
      const R = YARD.railY;
      const bias = YARD.crossBias;
      const bs = C.STATION_BY_NAME['八宝山'].s;
      const yq = C.STATION_BY_NAME['玉泉路'].s;
      const gz = C.STATION_BY_NAME['公主坟'].s;
      const u = C.STATION_BY_NAME['环球度假区'].s;
      const tq = C.STATION_BY_NAME['土桥'].s;

      /* ---- 玉泉路联络线：八宝山—玉泉路之间中央单线，两端各两组引入 ---- */
      const linkA = bs + 170;
      const linkB = yq - 170;
      buildYardTrack('玉泉路联络线', yardCurve([
        [linkA, 0, R], [linkA + 40, 0, R], [linkB - 40, 0, R], [linkB, 0, R]
      ]), { bedWidth: 3.0 });
      buildYardTrack('八宝山上行引入', yardTransition(bs + 78, TRACK_OFFSET, linkA, 0, R, R));
      buildYardTrack('八宝山下行引入', yardTransition(bs + 78, -TRACK_OFFSET, linkA, 0, R, R), { bias: bias });
      buildYardTrack('玉泉路上行引出', yardTransition(linkB, 0, yq - 78, TRACK_OFFSET, R, R), { bias: bias });
      buildYardTrack('玉泉路下行引出', yardTransition(linkB, 0, yq - 78, -TRACK_OFFSET, R, R));

      /* ---- 公主坟站后折返线：站西交叉渡线 + 中央折返线 ---- */
      const xA = gz - 140;
      const xB = gz - 75;
      const xMid = (xA + xB) / 2;
      buildYardTrack('公主坟交叉渡线A', yardTransition(xA, TRACK_OFFSET, xB, -TRACK_OFFSET, R, R));
      buildYardTrack('公主坟交叉渡线B', yardTransition(xA, -TRACK_OFFSET, xB, TRACK_OFFSET, R, R), { bias: bias });
      buildYardTrack('公主坟折返线', yardCurve([
        [xMid - 520, 0, R], [xMid - 340, 0, R], [xMid - 120, 0, R], [xMid, 0, R]
      ]), { bias: bias });
      // 折返线车挡
      {
        const p = ROUTE.point(xMid - 520, 0, R);
        const g = new THREE.Group();
        g.position.set(p.x, p.y, p.z);
        g.rotation.y = p.yaw;
        box(1.0, 1.1, 2.4, MAT.red, 1.2, 0.55, 0, g);
        staticRoot.add(g);
      }

      /* ---- 环球度假区站后掉头线：站台外交叉渡线 + 折返线 ---- */
      const uA = u + 80;
      const uB = u + 145;
      const uMid = (uA + uB) / 2;
      buildYardTrack('环球交叉渡线A', yardTransition(uA, TRACK_OFFSET, uB, -TRACK_OFFSET, R, R));
      buildYardTrack('环球交叉渡线B', yardTransition(uA, -TRACK_OFFSET, uB, TRACK_OFFSET, R, R), { bias: bias });
      buildYardTrack('环球掉头线', yardCurve([
        [uMid, 0, R], [uMid + 34, 0, R], [uMid + 62, 0, R]
      ]), { bias: bias });
      {
        const p = ROUTE.point(uMid + 62, 0, R);
        const g = new THREE.Group();
        g.position.set(p.x, p.y, p.z);
        g.rotation.y = p.yaw;
        box(1.0, 1.1, 2.4, MAT.red, -1.2, 0.55, 0, g);
        staticRoot.add(g);
      }

      /* ---- 土桥车辆段：出入段线 + 上下行联络线 + 地面车库 ---- */
      const yardRail = -2.02;
      const gYard = yardUpAt(tq + 430, yardRail);   // 段内地面轨面（相对高度）
      const gMid = (R + gYard) / 2;
      // 入段线：上行 → 段内 1 道（咽喉区先保持桥面高度，再下坡）
      buildYardTrack('土桥入段线', yardCurve([
        [tq + 91, TRACK_OFFSET, R],
        [tq + 150, 14, R],
        [tq + 200, 24, gMid],
        [tq + 250, 33, gYard],
        [tq + 300, 38, gYard]
      ]), { bedWidth: 4.6, bedDrop: -0.34, deck: true, deckWidth: 5.0 });
      // 出段线：段内 0 道（外侧）→ 下行，全程与入段线平行不交叉
      buildYardTrack('土桥出段线', yardCurve([
        [tq + 331, 30, gYard],
        [tq + 270, 26, gYard],
        [tq + 220, 20, gMid],
        [tq + 170, 10, R],
        [tq + 86, -TRACK_OFFSET, R]
      ]), { bedWidth: 4.6, bedDrop: -0.34, deck: true, deckWidth: 5.0 });
      // 上下行联络线（站东）
      buildYardTrack('土桥上下行联络线', yardTransition(tq + 88, TRACK_OFFSET, tq + 112, -TRACK_OFFSET, R, R), { bias: 0.010 });
      // 出段线—下行线联络线（咽喉区，仍在桥面高度）
      buildYardTrack('土桥出段联络线', yardTransition(tq + 130, 9, tq + 104, -TRACK_OFFSET, R, R), { bias: 0.015, bedWidth: 3.4 });
      // 段内 0～3 道 + 两道联络
      buildYardTrack('土桥车辆段0道', yardCurve([
        [tq + 331, 30, gYard], [tq + 420, 30, gYard], [tq + 491, 30, gYard]
      ]));
      buildYardTrack('土桥车辆段1道', yardCurve([
        [tq + 300, 38, gYard], [tq + 380, 38, gYard], [tq + 470, 38, gYard]
      ]));
      buildYardTrack('土桥车辆段2道', yardCurve([
        [tq + 330, 46, gYard], [tq + 400, 46, gYard], [tq + 478, 46, gYard]
      ]));
      buildYardTrack('土桥车辆段3道', yardCurve([
        [tq + 392, 54, gYard], [tq + 450, 54, gYard], [tq + 500, 54, gYard]
      ]));
      buildYardTrack('土桥1-2道联络', yardTransition(tq + 350, 38, tq + 382, 46, gYard, gYard), { bias: 0.010 });
      buildYardTrack('土桥2-3道联络', yardTransition(tq + 372, 46, tq + 392, 54, gYard, gYard), { bias: 0.015 });
      // 段内地面、停车库
      addRibbon(staticRoot, MAT.concrete, 42, 46, gYard - 0.12, tq + 286, tq + 512, 4, 8);
      yardShed(tq + 448, 42, yardRail, 108, 36, 9.2);
      // 车辆段入口标志牌
      {
        const p = ROUTE.point(tq + 292, 28, yardUpAt(tq + 292, yardRail));
        const g = new THREE.Group();
        g.position.set(p.x, p.y, p.z);
        g.rotation.y = p.yaw;
        box(0.25, 2.6, 0.25, MAT.steel, 0, 1.3, 0, g);
        box(0.18, 3.2, 2.6, MAT.signBack, 0, 3.4, 0, g);
        box(0.06, 2.8, 2.2, MAT.white, 0.12, 3.4, 0, g);
        staticRoot.add(g);
      }

      /* ---- 古城车辆段：站西地下洞室 + 两条引出线 + 三条停车线 ---- */
      buildDepotCavern();
      const cave = DEPOT_CAVERN;
      const caveEnd = cave.s0 + 16;
      buildYardTrack('古城车辆段入段线', yardTransition(cave.s1 - 6, TRACK_OFFSET, 6032, 9, R, R));
      buildYardTrack('古城车辆段出段线', yardTransition(cave.s1 - 6, -TRACK_OFFSET, 6044, 21, R, R), { bias: 0.010 });
      buildYardTrack('古城车辆段1道', yardCurve([
        [6032, 9, R], [6000, 9, R], [caveEnd, 9, R]
      ]));
      buildYardTrack('古城车辆段2道', yardCurve([
        [6016, 15, R], [5992, 15, R], [caveEnd, 15, R]
      ]));
      buildYardTrack('古城车辆段3道', yardCurve([
        [6044, 21, R], [6000, 21, R], [caveEnd, 21, R]
      ]));
      buildYardTrack('古城车辆段2-3道联络', yardTransition(6030, 21, 6016, 15, R, R), { bias: 0.010 });
      buildYardTrack('古城车辆段1-2道联络', yardTransition(6012, 15, 6000, 9, R, R), { bias: 0.015 });
      yardShed(cave.s0 + 46, 17, R, 70, 16, 7.0, true);

      /* ---- 复杂枢纽配线（南礼士路/复兴门、东单/建国门、四惠/四惠东、八角游乐园） ---- */
      const nls = C.STATION_BY_NAME['南礼士路'].s;
      const fx = C.STATION_BY_NAME['复兴门'].s;
      const dd = C.STATION_BY_NAME['东单'].s;
      const sh = C.STATION_BY_NAME['四惠'].s;
      const shd = C.STATION_BY_NAME['四惠东'].s;
      const bj = C.STATION_BY_NAME['八角游乐园'].s;

      // 复兴门站东：交叉渡线（上下行在此互换）
      const fxA = fx + 87;
      const fxB = fxA + 72;
      buildYardTrack('复兴门东交叉渡线A', yardTransition(fxA, TRACK_OFFSET, fxB, -TRACK_OFFSET, R, R), { throat: true });
      buildYardTrack('复兴门东交叉渡线B', yardTransition(fxA, -TRACK_OFFSET, fxB, TRACK_OFFSET, R, R), { bias: 0.010, throat: true });
      addDiamondTimbers((fxA + fxB) / 2, 0, R);

      // 复兴门—南礼士路：通往 2 号线的两条单联络线，在洞壁洞口处拐出
      const fjA = yardTransition(fx - 300, TRACK_OFFSET, fx - 200, 9.5, R, R - 0.7);
      buildYardTrack('复兴门2号线联络线（上行）', fjA, { throat: true, bedWidth: 3.0 });
      addYardPortal(fx - 194, 9.97, R - 0.8);
      const fjB = yardTransition(fx - 250, -TRACK_OFFSET, fx - 120, 9.2, R, R - 2.4);
      buildYardTrack('复兴门2号线联络线（下行）', fjB, { bias: 0.012, throat: true, bedWidth: 3.0 });
      addYardPortal(fx - 114, 9.97, R - 2.5);

      // 东单站西：交叉渡线 + 通往北京站方向的联络线
      const ddA = dd - 300;
      const ddB = ddA + 72;
      buildYardTrack('东单西交叉渡线A', yardTransition(ddA, TRACK_OFFSET, ddB, -TRACK_OFFSET, R, R), { throat: true });
      buildYardTrack('东单西交叉渡线B', yardTransition(ddA, -TRACK_OFFSET, ddB, TRACK_OFFSET, R, R), { bias: 0.010, throat: true });
      addDiamondTimbers((ddA + ddB) / 2, 0, R);
      const dLink = yardTransition(ddB, 0, ddB + 130, 9.4, R, R - 1.6);
      buildYardTrack('东单北京站方向联络线', dLink, { bias: 0.014, throat: true, bedWidth: 3.0 });
      addYardPortal(ddB + 136, 9.97, R - 1.7);

      // 四惠站两端：单渡线
      buildYardTrack('四惠西单渡线', yardTransition(sh - 196, TRACK_OFFSET, sh - 131, -TRACK_OFFSET, R, R), { throat: true });
      buildYardTrack('四惠东单渡线', yardTransition(sh + 119, -TRACK_OFFSET, sh + 184, TRACK_OFFSET, R, R), { bias: 0.010, throat: true });

      // 四惠东站西：一号线—八通线贯通工程的 4 组道岔（之字形串接）
      const tg = shd - 390;
      const diverge = [
        [tg, TRACK_OFFSET, tg + 40, 0, 0.006],
        [tg + 55, 0, tg + 95, -TRACK_OFFSET, 0.009],
        [tg + 110, -TRACK_OFFSET, tg + 150, 0, 0.012],
        [tg + 165, 0, tg + 205, TRACK_OFFSET, 0.015]
      ];
      diverge.forEach(function (d, i) {
        buildYardTrack('四惠东贯通道岔' + (i + 1), yardTransition(d[0], d[1], d[2], d[3], R, R), { bias: d[4], throat: true });
      });

      // 八角游乐园：一号线支线（101 线）预留线，站东向南下坡拐出
      const bjLink = yardTransition(bj + 232, TRACK_OFFSET, bj + 330, 9.6, R, R - 0.9);
      buildYardTrack('八角游乐园101线预留线', bjLink, { bias: 0.008, throat: true, bedWidth: 3.0 });
      addYardPortal(bj + 336, 9.97, R - 1.0);

      flushYardSleepers();
    }

    /* ---------------------------- 站台 ---------------------------- */
    function buildPSD(group, z, y0, length, fullHeight) {
      const h = fullHeight ? 2.28 : 1.25;
      const glass = box(length - 1.5, h, 0.055, MAT.glass, 0, y0 + h / 2, z, group);
      glass.renderOrder = 2;
      box(length, 0.09, 0.10, MAT.psdFrame, 0, y0 + h, z, group);
      box(length, 0.10, 0.12, MAT.psdFrame, 0, y0 + 0.03, z, group);
      for (let x = -length / 2 + 1.5; x <= length / 2 - 1.5; x += 8.7) {
        box(0.09, h, 0.11, MAT.psdFrame, x, y0 + h / 2, z, group);
        // 滑动门扇
        box(1.45, h * 0.9, 0.035, MAT.psdFrame, x + 2.1, y0 + h * 0.45, z + 0.025, group);
      }
    }

    function buildStation(station) {
      const p = ROUTE.point(station.s, 0, 0);
      const group = new THREE.Group();
      group.position.set(p.x, p.y, p.z);
      group.rotation.y = p.yaw;
      group.userData.stationIndex = station.index;
      group.userData.s = station.s;

      const length = station.platformLength;
      const isIsland = station.platform === 'island' || station.platform === 'island_side';
      const isSide = station.platform === 'side' || station.platform === 'island_side';
      const underground = station.env === 'underground';
      group.userData.platformLayout = isSide ? (isIsland ? 'island_side' : 'side') : 'island';
      group.userData.platformEdgeLats = isSide
        ? [-7.66, 7.66]
        : [4.02, -4.02];

      if (isIsland) {
        box(length, 1.05, 8.0, MAT.platform, 0, 0.525, 0, group);
        box(length, 0.08, 0.36, MAT.yellow, 0, 1.09, 3.88, group);
        box(length, 0.08, 0.36, MAT.yellow, 0, 1.09, -3.88, group);
        box(length, 0.12, 0.16, MAT.platformEdge, 0, 1.055, 4.02, group);
        box(length, 0.12, 0.16, MAT.platformEdge, 0, 1.055, -4.02, group);
        buildPSD(group, 4.02, 1.05, length, underground);
        buildPSD(group, -4.02, 1.05, length, underground);
      }
      if (isSide) {
        [-1, 1].forEach(function (side) {
          const z = side * 10.0;
          box(length, 1.05, 4.6, MAT.platform, 0, 0.525, z, group);
          box(length, 0.08, 0.38, MAT.yellow, 0, 1.09, side * 7.82, group);
          box(length, 0.12, 0.18, MAT.platformEdge, 0, 1.055, side * 7.68, group);
          buildPSD(group, side * 7.66, 1.05, length, underground);
        });
      }

      // 顶棚/站厅
      if (underground) {
        // 侧式站台：站厅向两侧加宽到站台外缘，补外墙与端墙（区间隧道墙已在站台范围断开）
        if (isSide) {
          [-1, 1].forEach(function (side) {
            box(length, 5.6, 0.36, MAT.tunnelWall, 0, 2.8, side * 12.55, group);
            [-1, 1].forEach(function (end) {
              box(0.5, 6.1, 2.5, MAT.tunnelWall, end * length / 2, 3.05, side * 11.35, group);
            });
          });
        }
        box(length, 0.28, isSide ? 25.6 : 17.2, MAT.stationCeiling, 0, 5.42, 0, group);
        if (isSide) {
          [-10.0, 10.0].forEach(function (z) {
            box(length - 8, 0.10, 2.6, MAT.stationLight, 0, 5.24, z, group);
          });
        }
        box(length - 8, 0.10, 2.6, MAT.stationLight, 0, 5.24, 2.0, group);
        box(length - 8, 0.10, 2.6, MAT.stationLight, 0, 5.24, -2.0, group);
        box(length - 12, 0.12, 1.0, MAT.lightStrip, 0, 5.18, 0, group);
        const pl = new THREE.PointLight(0xffe8c2, 0.95, 72, 2);
        pl.position.set(0, 4.7, 0);
        group.add(pl);
        if (isSide) {
          [-10, 10].forEach(function (z) {
            const lamp = new THREE.PointLight(0xe6f2ff, 0.55, 46, 2);
            lamp.position.set(0, 4.55, z);
            group.add(lamp);
          });
        }
      } else {
        // 侧式站台雨棚：深色顶板 + 深色吊顶 + 横向梁，避免在天空下发白
        if (isSide) {
          [-1, 1].forEach(function (side) {
            box(length, 0.24, 6.2, MAT.roof, 0, 4.55, side * 10.0, group);
            box(length - 0.8, 0.06, 5.85, MAT.roofSoffit, 0, 4.40, side * 10.0, group);
            box(length, 0.38, 0.10, MAT.darkMetal, 0, 4.38, side * 12.95, group);
            box(length, 0.38, 0.10, MAT.darkMetal, 0, 4.38, side * 7.05, group);
            for (let x = -length / 2 + 6; x < length / 2; x += 17) {
              box(0.24, 3.5, 0.24, MAT.steel, x, 2.8, side * 10.0, group);
              box(0.14, 0.16, 5.95, MAT.darkMetal, x, 4.38, side * 10.0, group);
            }
          });
        }
        if (isIsland) {
          box(length, 0.24, 9.4, MAT.roof, 0, 4.55, 0, group);
          box(length - 0.8, 0.06, 9.0, MAT.roofSoffit, 0, 4.40, 0, group);
          box(length, 0.38, 0.10, MAT.darkMetal, 0, 4.38, 4.65, group);
          box(length, 0.38, 0.10, MAT.darkMetal, 0, 4.38, -4.65, group);
          for (let x = -length / 2 + 6; x < length / 2; x += 17) {
            box(0.24, 3.5, 0.24, MAT.steel, x, 2.8, 0, group);
            box(0.14, 0.16, 9.0, MAT.darkMetal, x, 4.38, 0, group);
          }
        }
      }

      // 站名牌：岛式挂站台中心，侧式分别挂两侧站台雨棚下，绝不跨越轨道。
      const signTex = makeStationSignTexture(station.name, station.en, station.code, station.major);
      signTex.anisotropy = maxAniso;
      const signMat = new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide });
      const signLats = [];
      if (isIsland) signLats.push(0);
      if (isSide) signLats.push(-10, 10);
      const signY = 3.45;
      const signW = 5.4;
      const signH = 1.3;
      signLats.forEach(function (signZ) {
        const sign1 = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH), signMat);
        sign1.position.set(-length / 2 + 23, signY, signZ);
        sign1.rotation.y = -Math.PI / 2;
        sign1.userData.signLat = signZ;
        group.add(sign1);
        const sign2 = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH), signMat);
        sign2.position.set(length / 2 - 23, signY, signZ);
        sign2.rotation.y = Math.PI / 2;
        sign2.userData.signLat = signZ;
        group.add(sign2);
        // 吊杆：把站牌明确挂在雨棚/顶板下，避免悬浮
        const hangerH = underground ? 1.18 : 0.33;
        [-2.35, 2.35].forEach(function (dz) {
          box(0.07, hangerH, 0.07, MAT.darkMetal,
            -length / 2 + 23, signY + signH / 2 + hangerH / 2, signZ + dz, group);
          box(0.07, hangerH, 0.07, MAT.darkMetal,
            length / 2 - 23, signY + signH / 2 + hangerH / 2, signZ + dz, group);
        });
      });

      // 站台边缘小名牌（两侧各一组，避免背面文字镜像）
      const smallMat = new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide });
      [-1, 1].forEach(function (side) {
        for (let x = -length / 2 + 35; x < length / 2 - 30; x += 50) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.86), smallMat);
          if (isIsland) {
            m.position.set(x, 2.42, side * 3.7);
            m.rotation.y = side > 0 ? 0 : Math.PI;
          } else {
            // 侧式：贴在屏蔽门外侧、朝轨道，司机在车上可读
            m.position.set(x, 2.42, side * 7.52);
            m.rotation.y = side > 0 ? Math.PI : 0;
          }
          group.add(m);
        }
      });

      // 停车标（两侧各一块；列车前端对准停车标时整车位于站台内）
      const stopX = VEHICLE.consistLength / 2;
      const stopMat = new THREE.MeshBasicMaterial({ map: stopTex, side: THREE.DoubleSide });
      const stop1 = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 1.08), stopMat);
      stop1.position.set(stopX, 2.2, isIsland ? 3.55 : 8.3);
      stop1.rotation.y = -Math.PI / 2;
      group.add(stop1);
      box(0.10, 1.5, 0.10, MAT.steel, stopX, 1.55, isIsland ? 3.55 : 8.3, group);
      const stop2 = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 1.08), stopMat);
      stop2.position.set(-stopX, 2.2, isIsland ? -3.55 : -8.3);
      stop2.rotation.y = Math.PI / 2;
      group.add(stop2);
      box(0.10, 1.5, 0.10, MAT.steel, -stopX, 1.55, isIsland ? -3.55 : -8.3, group);

      // 长椅 / 立柱 / 导向牌
      const benchLats = isIsland ? [0.4] : [-10.4, 10.4];
      benchLats.forEach(function (bz) {
        for (let x = -length / 2 + 22; x < length / 2 - 20; x += 46) {
          box(4.2, 0.12, 0.55, MAT.darkMetal, x, 1.58, bz, group);
          box(0.16, 0.55, 0.5, MAT.darkMetal, x - 1.6, 1.3, bz, group);
          box(0.16, 0.55, 0.5, MAT.darkMetal, x + 1.6, 1.3, bz, group);
        }
      });
      const colLats = isIsland ? [0] : (isSide ? [-10.0, 10.0] : [0]);
      for (let x = -length / 2 + 12; x < length / 2; x += 24) {
        colLats.forEach(function (cz) {
          box(0.26, 3.2, 0.26, MAT.steel, x, 2.65, cz, group);
        });
      }

      // 站台照明光带（高架）
      if (!underground) {
        [-1, 1].forEach(function (side) {
          const z = isSide ? side * 10 : 0;
          box(length - 16, 0.08, 0.4, MAT.lightStrip, 0, 4.38, z, group);
        });
      }

      group.traverse(function (o) {
        if (!o.isMesh) return;
        o.receiveShadow = true;
        o.castShadow = o.material !== MAT.glass;
      });
      group.visible = false;
      stationRoot.add(group);
      return group;
    }

    /* ---------------------------- 轨道旁标识 ---------------------------- */
    function buildTrackside() {
      const signMat = new THREE.MeshBasicMaterial({ map: cbtcTex, side: THREE.DoubleSide });
      const warnMat = new THREE.MeshBasicMaterial({ map: warnTex, side: THREE.DoubleSide });
      const speedMat = new THREE.MeshBasicMaterial({ map: speedTex, side: THREE.DoubleSide, transparent: true });
      const L = C.LINE.lengthM;
      for (let s = C.LINE.stationOffsetM + 500; s < L; s += 1800) {
        const p = ROUTE.point(s, -8.9, 0);
        const g = new THREE.Group();
        g.position.set(p.x, p.y, p.z);
        g.rotation.y = p.yaw;
        box(0.10, 3.0, 0.10, MAT.steel, 0, 1.5, 0, g);
        const board = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.65), signMat);
        board.position.set(0, 3.0, 0);
        board.rotation.y = -Math.PI / 2;
        g.add(board);
        if (Math.round(s / 1800) % 3 === 0) {
          const w = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.56), warnMat);
          w.position.set(0, 2.25, 0);
          w.rotation.y = -Math.PI / 2;
          g.add(w);
        }
        staticRoot.add(g);
      }
      for (let s = C.LINE.stationOffsetM + 1600; s < L; s += 4200) {
        const p = ROUTE.point(s, 8.9, 0);
        const g = new THREE.Group();
        g.position.set(p.x, p.y, p.z);
        g.rotation.y = p.yaw;
        box(0.09, 2.6, 0.09, MAT.steel, 0, 1.3, 0, g);
        const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.86), speedMat);
        sp.position.set(0, 2.6, 0);
        sp.rotation.y = -Math.PI / 2;
        g.add(sp);
        staticRoot.add(g);
      }
    }

    /* ---------------------------- DKZ4 列车 ---------------------------- */
    const trainMaterials = {
      body: MAT.trainBody,
      dark: MAT.trainBodyDark,
      red: MAT.trainRed,
      glass: MAT.trainGlass,
      roof: MAT.trainRoof,
      black: MAT.trainBlack,
      head: MAT.headlight,
      tail: MAT.taillight,
      dest: MAT.destination
    };
    const geoCache = {};
    function cachedBox(w, h, d) {
      const key = w + '|' + h + '|' + d;
      if (!geoCache[key]) geoCache[key] = new THREE.BoxGeometry(w, h, d);
      return geoCache[key];
    }
    function addCachedBox(parent, w, h, d, mat, x, y, z) {
      const m = new THREE.Mesh(cachedBox(w, h, d), mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    }

    const destinationMaterials = [];
    const opposingDestinationMaterials = [];
    function createCabEnd(text, destSink) {
      const g = new THREE.Group();
      // 车头正面
      addCachedBox(g, 0.20, 2.35, 2.68, trainMaterials.body, 0.05, 2.12, 0);
      // 前窗
      addCachedBox(g, 0.06, 1.06, 2.16, trainMaterials.glass, 0.17, 2.68, 0);
      addCachedBox(g, 0.04, 1.15, 2.22, trainMaterials.black, 0.145, 2.68, 0);
      // 车顶前檐
      addCachedBox(g, 0.34, 0.25, 2.5, trainMaterials.roof, 0.10, 3.31, 0);
      // 红色腰带与 V 形装饰
      addCachedBox(g, 0.03, 0.23, 2.72, trainMaterials.red, 0.175, 1.73, 0);
      const chevL = addCachedBox(g, 0.025, 0.10, 1.42, trainMaterials.red, 0.19, 1.88, -0.34);
      chevL.rotation.x = -0.30;
      const chevR = addCachedBox(g, 0.025, 0.10, 1.42, trainMaterials.red, 0.19, 1.88, 0.34);
      chevR.rotation.x = 0.30;
      // 头灯
      addCachedBox(g, 0.05, 0.26, 0.34, trainMaterials.head, 0.20, 1.31, -0.92);
      addCachedBox(g, 0.05, 0.26, 0.34, trainMaterials.head, 0.20, 1.31, 0.92);
      // 尾灯（红灯）与头灯并排
      addCachedBox(g, 0.05, 0.14, 0.19, trainMaterials.tail, 0.205, 1.08, -1.22);
      addCachedBox(g, 0.05, 0.14, 0.19, trainMaterials.tail, 0.205, 1.08, 1.22);
      // 目的地屏
      const destMat = new THREE.MeshBasicMaterial({
        map: textToggleTexture(text || '环球度假区'), transparent: true
      });
      (destSink || destinationMaterials).push(destMat);
      const dest = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.28), destMat);
      dest.position.set(0.225, 3.17, 0);
      dest.rotation.y = Math.PI / 2;
      g.add(dest);
      // 车号
      addCachedBox(g, 0.03, 0.16, 0.62, trainMaterials.black, 0.195, 1.48, 0.72);
      // 排障器
      addCachedBox(g, 0.55, 0.32, 1.25, trainMaterials.black, 0.18, 0.48, 0);
      return g;
    }

    const destTextureCache = {};
    function textToggleTexture(text) {
      if (destTextureCache[text]) return destTextureCache[text];
      const tex = canvasTexture(512, 96, function (ctx, w, h) {
        ctx.fillStyle = '#101315';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ffae28';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 52px "Microsoft YaHei",sans-serif';
        ctx.fillText(text, w / 2, h / 2 + 2);
      });
      destTextureCache[text] = tex;
      return tex;
    }

    /* ----------------------------------------------------------------------
       DKZ4 glb 模型
       - 单文件 glb（几何 + 材质 + 贴图）放在仓库根目录，用相对路径加载，
         保证 GitHub Pages 等静态托管下与本地路径完全一致。
       - 模型含 6500+ 个 Mesh；先按头车/中间车变体合并，再为 6 节车各克隆
         一个 Mesh，避免每帧上万次 draw call。
       - 加载后按包围盒自动缩放、居中、落到轨面，并把车头朝 +X。
       - 失败时保留程序化列车，不影响驾驶逻辑。
       ---------------------------------------------------------------------- */
    const DKZ4_MODEL_URL = './dkz4.glb';
    const DKZ4_TARGET_LENGTH = VEHICLE.carLength;
    const dkz4State = {
      status: 'idle',
      url: DKZ4_MODEL_URL,
      progress: 0,
      message: '等待加载',
      error: null,
      info: null
    };
    let dkz4Templates = null;

    function publishDkz4State() {
      try {
        if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
          global.dispatchEvent(new global.CustomEvent('dkz4-model-status', {
            detail: {
              status: dkz4State.status,
              progress: dkz4State.progress,
              message: dkz4State.message,
              error: dkz4State.error,
              info: dkz4State.info
            }
          }));
        }
      } catch (e) { /* 状态提示不能影响主线程 */ }
    }

    function failDkz4Model(message, error) {
      dkz4State.status = 'fallback';
      dkz4State.message = message;
      dkz4State.error = error ? String(error.message || error) : null;
      dkz4State.progress = 0;
      publishDkz4State();
      if (global.console) {
        global.console.warn('[DKZ4] ' + message, error || '');
      }
    }

    /**
     * 模型把“头车”和“中间车”两套完整外观叠在同一位置（否则会 z-fighting）。
     * 这里按顶层组名筛选：head_outside/head_inside/*door_head* 为头车，
     * middle_outside/middle_inside/*door_mid* 为中间车。
     */
    function isDkz4VariantGroup(name, variant) {
      const n = String(name || '').toLowerCase();
      if (variant === 'head') {
        return n === 'head_inside' || n === 'head_outside' || n.indexOf('door_head') >= 0;
      }
      return n === 'middle_inside' || n === 'middle_outside' || n.indexOf('door_mid') >= 0;
    }

    /**
     * 将选定变体的 Mesh 顶点烘焙到世界坐标，合并成一个几何体。
     * 每节车从约 3100 个 draw call 降到 1 个；18 节车也只有 18 个 draw call。
     */
    function mergeDkz4Scene(root, variant) {
      root.updateMatrixWorld(true);
      const meshes = [];
      let vertexCount = 0;
      let indexCount = 0;
      let sourceMaterial = null;
      root.traverse(function (o) {
        if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
        let p = o;
        let variantGroup = null;
        while (p && p !== root) {
          if (isDkz4VariantGroup(p.name, variant)) { variantGroup = p; break; }
          p = p.parent;
        }
        if (!variantGroup) return;
        meshes.push(o);
        vertexCount += o.geometry.attributes.position.count;
        indexCount += o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count;
        if (!sourceMaterial && o.material) {
          sourceMaterial = Array.isArray(o.material) ? o.material[0] : o.material;
        }
      });
      if (!meshes.length || !sourceMaterial) throw new Error('模型中没有可合并的 ' + variant + ' Mesh');

      const positions = new Float32Array(vertexCount * 3);
      const normals = new Float32Array(vertexCount * 3);
      const uvs = new Float32Array(vertexCount * 2);
      const indices = new Uint32Array(indexCount);
      const normalMatrix = new THREE.Matrix3();
      const v = new THREE.Vector3();
      const n = new THREE.Vector3();
      let vOff = 0;
      let iOff = 0;
      let triangleCount = 0;

      for (let mi = 0; mi < meshes.length; mi++) {
        const mesh = meshes[mi];
        const geo = mesh.geometry;
        const pos = geo.attributes.position;
        const nor = geo.attributes.normal;
        const uv = geo.attributes.uv;
        const idx = geo.index;
        const base = vOff;
        normalMatrix.getNormalMatrix(mesh.matrixWorld);

        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          positions[vOff * 3] = v.x;
          positions[vOff * 3 + 1] = v.y;
          positions[vOff * 3 + 2] = v.z;
          if (nor) {
            n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
            normals[vOff * 3] = n.x;
            normals[vOff * 3 + 1] = n.y;
            normals[vOff * 3 + 2] = n.z;
          } else {
            normals[vOff * 3 + 1] = 1;
          }
          if (uv) {
            uvs[vOff * 2] = uv.getX(i);
            uvs[vOff * 2 + 1] = uv.getY(i);
          }
          vOff++;
        }

        if (idx) {
          for (let i = 0; i < idx.count; i++) indices[iOff++] = base + idx.getX(i);
          triangleCount += idx.count / 3;
        } else {
          for (let i = 0; i < pos.count; i++) indices[iOff++] = base + i;
          triangleCount += pos.count / 3;
        }
      }

      const merged = new THREE.BufferGeometry();
      merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      merged.setIndex(new THREE.BufferAttribute(indices, 1));
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      merged.userData.sourceMeshCount = meshes.length;
      merged.userData.triangleCount = Math.round(triangleCount);

      // 原始 6265 份 geometry 已烘焙进合并体，释放显存；材质/贴图保留。
      for (let i = 0; i < meshes.length; i++) {
        if (meshes[i].geometry && meshes[i].geometry !== merged) meshes[i].geometry.dispose();
      }

      return {
        geometry: merged,
        material: sourceMaterial,
        meshCount: meshes.length,
        vertexCount: vertexCount,
        triangleCount: Math.round(triangleCount)
      };
    }

    function buildDkz4Template(gltf, variant) {
      const merged = mergeDkz4Scene(gltf.scene, variant);
      const material = merged.material.clone ? merged.material.clone() : merged.material;
      material.side = THREE.DoubleSide;
      if (material.map) {
        material.map.anisotropy = maxAniso;
        material.map.needsUpdate = true;
      }
      // GLTFLoader 已根据 alphaMode=MASK 设置 alphaTest；这里只做兜底。
      if (material.alphaTest === undefined) material.alphaTest = 0.05;
      material.needsUpdate = true;

      const bbox = merged.geometry.boundingBox;
      const size = bbox.getSize(new THREE.Vector3());
      const center = bbox.getCenter(new THREE.Vector3());
      const longAxis = size.z >= size.x ? 'z' : 'x';
      const rawLength = Math.max(size.x, size.z);
      const scale = DKZ4_TARGET_LENGTH / rawLength;

      const mesh = new THREE.Mesh(merged.geometry, material);
      // 先在原始坐标里把长轴中心、横向中心、底面归零，再统一缩放/旋转。
      mesh.position.set(-center.x, -bbox.min.y, -center.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;

      const fit = new THREE.Group();
      fit.add(mesh);
      fit.scale.setScalar(scale);
      // 模型长轴为 Z；车头朝 -Z（head_outside 位于负 Z），旋转后朝 +X。
      if (longAxis === 'z') fit.rotation.y = -Math.PI / 2;

      const template = new THREE.Group();
      template.add(fit);
      template.updateMatrixWorld(true);

      const finalBox = new THREE.Box3().setFromObject(template);
      const finalSize = finalBox.getSize(new THREE.Vector3());
      const info = {
        variant: variant,
        rawSize: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
        size: { x: +finalSize.x.toFixed(3), y: +finalSize.y.toFixed(3), z: +finalSize.z.toFixed(3) },
        scale: +scale.toFixed(5),
        longAxis: longAxis,
        meshCount: merged.meshCount,
        vertexCount: merged.vertexCount,
        triangleCount: merged.triangleCount,
        material: material.name || 'DKZ4'
      };
      template.userData.dkz4 = info;
      return { template: template, info: info };
    }

    /* ---- 车头顶部终点站牌（位置可临时用 Shift+滚轮 微调） ---- */
    // back：牌面相对车体前脸的“后退量”（米）。正值往车厢里收，负值往前凸。
    const DEST_BOARD_TUNE = { back: 0.75, step: 0.02, min: -2.5, max: 4.5 };
    const destBoardRecords = [];
    let destBoardHintEl = null;
    let destBoardHintTimer = 0;

    function applyDestBoard(rec) {
      const info = rec.info;
      const dir = rec.front ? 1 : -1;
      rec.board.position.set(
        dir * (info.size.x * 0.5 + 0.018 - DEST_BOARD_TUNE.back),
        Math.min(info.size.y - 0.28, Math.max(1.35, info.size.y * 0.82)),
        0
      );
      rec.board.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }

    /** 临时调试：显示当前牌面偏移；用户取到合适的值后整体移除 */
    function showDestBoardHint() {
      if (!global.document || !document.body) return;
      if (!destBoardHintEl) {
        destBoardHintEl = document.createElement('div');
        destBoardHintEl.id = 'dest-board-hint';
        destBoardHintEl.style.cssText = 'position:fixed;left:50%;bottom:86px;transform:translateX(-50%);' +
          'padding:7px 15px;border-radius:9px;background:rgba(10,14,18,0.84);color:#ffd479;' +
          'font:600 13px/1.5 "Microsoft YaHei",sans-serif;letter-spacing:0.04em;z-index:80;' +
          'pointer-events:none;box-shadow:0 8px 20px rgba(0,0,0,0.5);white-space:nowrap;';
        document.body.appendChild(destBoardHintEl);
      }
      // 对外显示“向前为正”的偏移，方便直接报数
      const fwd = -DEST_BOARD_TUNE.back;
      destBoardHintEl.textContent = '终点站牌 offset ' + (fwd >= 0 ? '+' : '') + fwd.toFixed(2) + ' m' +
        '（负值向后，Shift+滚轮调节）';
      destBoardHintEl.style.display = 'block';
      if (destBoardHintTimer) global.clearTimeout(destBoardHintTimer);
      destBoardHintTimer = global.setTimeout(function () {
        if (destBoardHintEl) destBoardHintEl.style.display = 'none';
        destBoardHintTimer = 0;
      }, 4000);
      if (destBoardHintTimer && destBoardHintTimer.unref) destBoardHintTimer.unref();
    }

    /** 临时调试入口：fwdMeters > 0 表示把牌子往车头方向推 */
    function nudgeDestBoard(fwdMeters) {
      DEST_BOARD_TUNE.back = clamp(DEST_BOARD_TUNE.back - fwdMeters, DEST_BOARD_TUNE.min, DEST_BOARD_TUNE.max);
      destBoardRecords.forEach(applyDestBoard);
      showDestBoardHint();
      return -DEST_BOARD_TUNE.back;
    }

    function addModelDestination(car, info, front, destSink, text) {
      const mat = new THREE.MeshBasicMaterial({
        map: textToggleTexture(text || '环球度假区'),
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      (destSink || destinationMaterials).push(mat);
      const boardW = Math.min(1.35, Math.max(0.9, info.size.z * 0.55));
      const board = new THREE.Mesh(new THREE.PlaneGeometry(boardW, 0.26), mat);
      board.renderOrder = 2;
      const rec = { board: board, info: info, front: front };
      applyDestBoard(rec);
      destBoardRecords.push(rec);
      car.add(board);
      return board;
    }

    function attachDkz4ToConsist(consist, templates, info) {
      if (!consist || consist.modelAttached) return;
      const last = consist.cars.length - 1;
      for (let i = 0; i < consist.cars.length; i++) {
        const car = consist.cars[i];
        const isCabCar = i === 0 || i === last;
        const built = isCabCar ? templates.head : templates.middle;
        // 隐藏原来的程序化车体，但保留 Group/位置/旋转，追踪与车门逻辑不变。
        for (let c = 0; c < car.children.length; c++) car.children[c].visible = false;
        const visual = built.template.clone(true);
        visual.name = 'DKZ4_GLB';
        visual.position.y = 0.015;
        // 头车模型车头朝 +X；尾车旋转 180°，让司机室朝列车尾部。
        if (i === last) visual.rotation.y = Math.PI;
        car.add(visual);
        car.userData.dkz4 = visual;
        car.userData.dkz4Variant = built.info.variant;
        if (isCabCar) {
          // 两端都挂目的地牌；朝向车钩的一端会被相邻车厢遮住。
          addModelDestination(car, built.info, true, consist.destSink, consist.destination);
          addModelDestination(car, built.info, false, consist.destSink, consist.destination);
        }
      }
      consist.modelAttached = true;
      consist.modelInfo = info;
    }

    function startDkz4Load() {
      if (options.loadTrainModel === false) {
        dkz4State.status = 'disabled';
        dkz4State.message = '模型加载已关闭';
        return;
      }
      if (!THREE.GLTFLoader) {
        failDkz4Model('GLTFLoader 未加载，继续使用程序化列车', null);
        return;
      }
      dkz4State.status = 'loading';
      dkz4State.message = '正在加载 DKZ4 模型';
      dkz4State.progress = 0;
      publishDkz4State();
      const t0 = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
      const loader = new THREE.GLTFLoader();
      loader.load(
        dkz4State.url,
        function (gltf) {
          try {
            dkz4State.progress = 0.99;
            dkz4State.message = '正在合并 6265 个车体网格…';
            publishDkz4State();
            const head = buildDkz4Template(gltf, 'head');
            const middle = buildDkz4Template(gltf, 'middle');
            dkz4Templates = { head: head, middle: middle };
            const info = Object.assign({}, head.info, {
              meshCount: head.info.meshCount + middle.info.meshCount,
              vertexCount: head.info.vertexCount + middle.info.vertexCount,
              triangleCount: head.info.triangleCount,
              totalTriangleCount: head.info.triangleCount + middle.info.triangleCount,
              head: head.info,
              middle: middle.info
            });
            attachDkz4ToConsist(playerConsist, dkz4Templates, info);
            attachDkz4ToConsist(leaderConsist, dkz4Templates, info);
            attachDkz4ToConsist(opposingConsist, dkz4Templates, info);
            const t1 = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
            dkz4State.status = 'ready';
            dkz4State.progress = 1;
            dkz4State.message = 'DKZ4 模型已加载 · 6 节编组';
            dkz4State.info = info;
            dkz4State.loadMs = Math.round(t1 - t0);
            publishDkz4State();
            if (global.console) global.console.info('[DKZ4] glb 已按头车/中间车变体合并并装配', info);
          } catch (err) {
            failDkz4Model('模型解析失败，继续使用程序化列车', err);
          }
        },
        function (xhr) {
          if (xhr && xhr.total) {
            const p = Math.min(0.98, xhr.loaded / xhr.total);
            if (p - dkz4State.progress > 0.04) {
              dkz4State.progress = p;
              dkz4State.message = '正在加载 DKZ4 模型 ' + Math.round(p * 100) + '%';
              publishDkz4State();
            }
          }
        },
        function (err) {
          const fileHint = (global.location && global.location.protocol === 'file:')
            ? '（file:// 无法读取模型文件，请用本地 HTTP 服务打开）'
            : '';
          failDkz4Model('DKZ4 模型加载失败，继续使用程序化列车' + fileHint, err);
        }
      );
    }

    function createCar(cabFront, cabRear, destination, destSink) {
      const g = new THREE.Group();
      // 车体
      addCachedBox(g, 18.65, 2.55, 2.76, trainMaterials.body, 0, 2.13, 0);
      // 下裙板
      addCachedBox(g, 18.8, 0.48, 2.6, trainMaterials.dark, 0, 0.72, 0);
      // 车顶
      addCachedBox(g, 18.4, 0.26, 2.45, trainMaterials.roof, 0, 3.50, 0);
      // 车顶空调
      addCachedBox(g, 2.4, 0.34, 1.55, trainMaterials.roof, -4.5, 3.76, 0);
      addCachedBox(g, 2.4, 0.34, 1.55, trainMaterials.roof, 4.5, 3.76, 0);
      // 两侧腰带
      addCachedBox(g, 18.7, 0.22, 0.03, trainMaterials.red, 0, 1.78, 1.395);
      addCachedBox(g, 18.7, 0.22, 0.03, trainMaterials.red, 0, 1.78, -1.395);
      // 侧窗：整条深色窗带
      addCachedBox(g, 16.2, 0.82, 0.035, trainMaterials.glass, 0, 2.72, 1.40);
      addCachedBox(g, 16.2, 0.82, 0.035, trainMaterials.glass, 0, 2.72, -1.40);
      // 车门 4 对（每侧）
      [-6.75, -2.25, 2.25, 6.75].forEach(function (x) {
        [-1, 1].forEach(function (side) {
          addCachedBox(g, 1.34, 2.18, 0.045, trainMaterials.dark, x, 1.97, side * 1.412);
          addCachedBox(g, 1.18, 0.61, 0.02, trainMaterials.glass, x, 2.72, side * 1.442);
        });
      });
      // 端部贯通道（带司机室的一端不设置，避免遮挡车头正面）
      if (!cabRear) addCachedBox(g, 0.5, 2.2, 1.6, trainMaterials.black, -9.28, 1.85, 0);
      if (!cabFront) addCachedBox(g, 0.5, 2.2, 1.6, trainMaterials.black, 9.28, 1.85, 0);
      // 转向架
      [-6.4, 6.4].forEach(function (x) {
        addCachedBox(g, 3.1, 0.52, 2.25, trainMaterials.black, x, 0.55, 0);
        [-1, 1].forEach(function (z) {
          [-1.05, 1.05].forEach(function (dx) {
            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.40, 0.40, 0.14, 14), trainMaterials.black);
            wheel.rotation.x = Math.PI / 2;
            wheel.position.set(x + dx, 0.43, z * 1.18);
            g.add(wheel);
          });
        });
      });
      // 受电靴与第三轨
      addCachedBox(g, 2.8, 0.13, 0.12, trainMaterials.black, -2.5, 0.48, 1.34);
      addCachedBox(g, 2.8, 0.13, 0.12, trainMaterials.black, 2.5, 0.48, 1.34);
      // 车头/车尾
      if (cabFront) {
        const cab = createCabEnd(destination, destSink);
        cab.position.x = 9.28;
        g.add(cab);
      }
      if (cabRear) {
        const cab = createCabEnd(destination, destSink);
        cab.position.x = -9.28;
        cab.rotation.y = Math.PI;
        g.add(cab);
      }
      return g;
    }

    function createConsist(destination, destSink) {
      const group = new THREE.Group();
      const cars = [];
      for (let i = 0; i < VEHICLE.consistCars; i++) {
        const car = createCar(i === 0, i === VEHICLE.consistCars - 1, destination, destSink);
        // 让车体接受阴影
        car.traverse(function (o) {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = false;
          }
        });
        group.add(car);
        cars.push(car);
      }
      trainRoot.add(group);
      return {
        group: group,
        cars: cars,
        destination: destination,
        destSink: destSink || destinationMaterials,
        modelAttached: false,
        modelInfo: null
      };
    }

    function placeConsist(consist, headS, dir, lateral, yOffset) {
      for (let i = 0; i < consist.cars.length; i++) {
        const carS = headS - dir * (9.5 + i * 19.18);
        const p = ROUTE.point(carS, lateral, yOffset || 0.03);
        const car = consist.cars[i];
        car.position.set(p.x, p.y, p.z);
        car.rotation.set(0, p.yaw + (dir < 0 ? Math.PI : 0), 0);
        car.visible = carS > -160 && carS < C.LINE.lengthM + 160;
      }
    }

    /* ---------------------------- 驾驶室 ---------------------------- */
    function buildCab() {
      const cab = new THREE.Group();
      camera.add(cab);

      const mats = {
        dark: MAT.cabDark,
        beige: MAT.cabBeige,
        console: MAT.cabConsole,
        red: MAT.cabRed
      };
      // 顶部与 A 柱
      const header = box(2.4, 0.16, 0.16, mats.beige, 0, 0.64, -0.72, cab);
      const leftPillar = box(0.13, 1.55, 0.16, mats.beige, -0.94, -0.04, -0.72, cab);
      const rightPillar = box(0.13, 1.55, 0.16, mats.beige, 0.94, -0.04, -0.72, cab);
      // 顶部遮阳板
      box(2.1, 0.09, 0.32, mats.dark, 0, 0.55, -0.78, cab);
      // 左右侧围板
      box(0.10, 1.15, 0.9, mats.beige, -1.08, -0.18, -0.34, cab);
      box(0.10, 1.15, 0.9, mats.beige, 1.08, -0.18, -0.34, cab);
      // 仪表台
      box(2.15, 0.42, 0.62, mats.console, 0, -0.47, -0.73, cab);
      box(2.05, 0.11, 0.38, mats.dark, 0, -0.27, -0.80, cab);
      // 仪表台斜面
      const dashSlope = box(2.05, 0.36, 0.1, mats.console, 0, -0.38, -1.0, cab);
      dashSlope.rotation.x = -0.35;
      // 左侧车门控制面板
      box(0.38, 0.24, 0.12, mats.console, -0.74, -0.24, -0.60, cab);
      const doorButtons = {};
      ['open', 'close'].forEach(function (k, i) {
        const mat = new THREE.MeshStandardMaterial({
          color: i === 0 ? 0x2ba864 : 0xd7a326,
          emissive: i === 0 ? 0x0c3b22 : 0x4a2c00,
          emissiveIntensity: 0.4,
          roughness: 0.5
        });
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.045, 14), mat);
        b.rotation.x = Math.PI / 2;
        b.position.set(-0.84 + i * 0.11, -0.235, -0.665);
        cab.add(b);
        doorButtons[k] = mat;
      });
      // 主控制器手柄
      const handlePivot = new THREE.Group();
      handlePivot.position.set(0.70, -0.34, -0.58);
      cab.add(handlePivot);
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.026, 0.32, 10), mats.dark);
      lever.position.y = -0.07;
      handlePivot.add(lever);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), mats.red);
      knob.position.y = 0.10;
      handlePivot.add(knob);
      box(0.18, 0.02, 0.30, mats.dark, 0.70, -0.45, -0.58, cab);
      // 右侧紧急制动按钮（真实车辆为独立按钮）
      const ebMat = new THREE.MeshStandardMaterial({ color: 0xc61f2b, emissive: 0x42070b, emissiveIntensity: 0.4, roughness: 0.4 });
      const ebBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.05, 16), ebMat);
      ebBtn.rotation.z = Math.PI / 2;
      ebBtn.position.set(0.86, -0.17, -0.66);
      cab.add(ebBtn);
      // 无线电/开关
      box(0.22, 0.10, 0.14, mats.dark, 0.30, -0.26, -0.83, cab);
      // 雨刷（压低在风窗下沿，避免遮挡瞭望）
      [-0.32, 0.32].forEach(function (x) {
        const wiper = box(0.014, 0.30, 0.018, mats.dark, x, -0.205, -0.92, cab);
        wiper.rotation.z = x < 0 ? -1.02 : 1.02;
      });
      // 驾驶室顶灯
      box(0.5, 0.04, 0.16, MAT.lightStrip, 0, 0.57, -0.56, cab);
      const cabLight = new THREE.PointLight(0xffe7c4, 0.8, 2.8, 2);
      cabLight.position.set(0, 0.25, -0.4);
      cab.add(cabLight);

      // 小型 DMI（3D 屏，作为 HUD 的补充）
      const dmiCanvas = document.createElement('canvas');
      dmiCanvas.width = 512;
      dmiCanvas.height = 256;
      const dmiCtx = dmiCanvas.getContext('2d');
      const dmiTex = new THREE.CanvasTexture(dmiCanvas);
      dmiTex.encoding = THREE.sRGBEncoding;
      const dmiMat = new THREE.MeshBasicMaterial({ map: dmiTex });
      const dmi = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.155), dmiMat);
      dmi.position.set(0.52, -0.21, -0.925);
      dmi.rotation.x = -0.14;
      cab.add(dmi);
      box(0.345, 0.18, 0.03, mats.dark, 0.52, -0.213, -0.952, cab);

      cab.visible = true;
      return {
        group: cab,
        handle: handlePivot,
        doorButtons: doorButtons,
        ebMat: ebMat,
        dmi: { canvas: dmiCanvas, ctx: dmiCtx, texture: dmiTex, mesh: dmi, last: -1 }
      };
    }

    function drawDmi(cabDmi, status) {
      const now = performance.now();
      if (now - cabDmi.last < 180) return;
      cabDmi.last = now;
      const ctx = cabDmi.ctx;
      const w = 512;
      const h = 256;
      ctx.fillStyle = '#071825';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#0e3b57';
      ctx.fillRect(0, 0, w, 34);
      ctx.fillStyle = '#85d8ff';
      ctx.font = 'bold 20px "Bahnschrift","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('ATP  CBTC / Urbalis 888', 14, 18);
      ctx.textAlign = 'right';
      ctx.fillStyle = status.eb ? '#ff5a5a' : '#86e3a8';
      ctx.fillText(status.eb ? 'EB' : (status.ato ? 'ATO' : 'SM'), w - 14, 18);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#8eaec1';
      ctx.font = '20px "Microsoft YaHei",sans-serif';
      ctx.fillText('实际速度', 22, 74);
      ctx.fillStyle = '#f4f8f9';
      ctx.font = 'bold 70px "Bahnschrift","Segoe UI",sans-serif';
      ctx.fillText(String(Math.round(status.speedKph)).padStart(2, '0'), 20, 120);
      ctx.fillStyle = '#7e9aab';
      ctx.font = '19px "Microsoft YaHei",sans-serif';
      ctx.fillText('km/h', 140, 133);

      ctx.fillStyle = '#8eaec1';
      ctx.font = '20px "Microsoft YaHei",sans-serif';
      ctx.fillText('允许速度', 270, 74);
      ctx.fillStyle = status.overspeed ? '#ff6c5c' : '#82e6ff';
      ctx.font = 'bold 62px "Bahnschrift","Segoe UI",sans-serif';
      ctx.fillText(String(Math.round(status.vPermKph)), 266, 118);
      ctx.fillStyle = '#7e9aab';
      ctx.font = '18px "Microsoft YaHei",sans-serif';
      ctx.fillText('km/h', 362, 131);

      ctx.fillStyle = '#1a3546';
      ctx.fillRect(18, 158, 476, 78);
      ctx.fillStyle = '#8eaec1';
      ctx.font = '18px "Microsoft YaHei",sans-serif';
      ctx.fillText(status.targetType === 'leader' ? '前方列车距离' : '下一站目标距离', 30, 180);
      ctx.fillStyle = '#f4f8f9';
      ctx.font = 'bold 40px "Bahnschrift","Segoe UI",sans-serif';
      const dist = isFinite(status.targetDistance) ? Math.round(status.targetDistance) : 0;
      ctx.fillText(dist >= 1000 ? (dist / 1000).toFixed(2) + ' km' : dist + ' m', 30, 218);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#bad5e4';
      ctx.font = '20px "Microsoft YaHei",sans-serif';
      ctx.fillText(status.atStation ? '站台停车' : (status.nextStation ? status.nextStation.name : '终点'), w - 24, 190);
      ctx.fillStyle = status.warning ? '#ff5548' : '#2b586e';
      ctx.fillRect(w - 150, 204, 126, 9);
      cabDmi.texture.needsUpdate = true;
    }

    /* ---------------------------- 组装 ---------------------------- */
    const updateSleepers = buildTrack();
    buildTunnel();
    buildViaduct();
    buildCity();
    buildTrackside();
    buildYards();

    const stationGroups = STATIONS.map(function (st) { return buildStation(st); });

    const playerLateralStart = 5.5;
    const playerConsist = createConsist('环球度假区');
    const leaderConsist = createConsist('环球度假区');
    const opposingConsist = createConsist('古城', opposingDestinationMaterials);
    playerConsist.group.visible = false;
    opposingConsist.group.visible = false;

    const cab = buildCab();

    // 头灯
    const headlight = new THREE.SpotLight(0xfff2cf, 0, 175, 0.30, 0.55, 1.2);
    headlight.castShadow = false;
    scene.add(headlight);
    scene.add(headlight.target);
    const headGlow = new THREE.PointLight(0xfff1c9, 0, 22, 2);
    scene.add(headGlow);

    // 前车尾灯点光
    const leaderGlow = new THREE.PointLight(0xff2d24, 0, 30, 2);
    scene.add(leaderGlow);

    /* ---------------------------- 状态 ---------------------------- */
    /* ------------------- 外观视角（DKZ4）轨道参数 ------------------- */
    const ORBIT_TARGET_YAW = 0;
    const ORBIT_TARGET_PITCH = 0.13;
    const ORBIT_TARGET_ZOOM = 1;
    const ORBIT_YAW_LIMIT = Math.PI * 0.98;
    const ORBIT_PITCH_MIN = -0.32;
    const ORBIT_PITCH_MAX = 1.32;
    const ORBIT_ZOOM_MIN = 0.30;
    const ORBIT_ZOOM_MAX = 4.20;
    const EXTERNAL_DIST = 26.4;

    const state = {
      playerS: 0,
      playerDir: 1,
      playerLateral: 5.5,
      visualLateral: 5.5,
      cameraMode: 'cab',
      cameraYaw: 0,
      cameraPitch: 0,
      targetYaw: 0,
      targetPitch: 0,
      envBlend: 1,
      lastStationCull: -9999,
      externalCam: new THREE.Vector3(),
      externalLook: new THREE.Vector3(),
      externalInit: false,
      // 外观视角轨道控制：方位角相对列车侧方基准，俯仰角相对水平面，缩放为距离系数
      orbitYaw: ORBIT_TARGET_YAW,
      orbitPitch: ORBIT_TARGET_PITCH,
      orbitZoom: ORBIT_TARGET_ZOOM,
      orbitDist: EXTERNAL_DIST,
      time: 0
    };

    function clampOrbitPitch(v) {
      return clamp(v, ORBIT_PITCH_MIN, ORBIT_PITCH_MAX);
    }

    /** 鼠标/触摸拖动：外观视角绕车头旋转 */
    function orbitRotate(dxPx, dyPx) {
      if (state.cameraMode !== 'external') return false;
      state.orbitYaw = clamp(state.orbitYaw + dxPx * 0.0062, -ORBIT_YAW_LIMIT, ORBIT_YAW_LIMIT);
      state.orbitPitch = clampOrbitPitch(state.orbitPitch + dyPx * 0.0042);
      return true;
    }

    /** 滚轮/捏合：外观视角拉近推远 */
    function orbitZoomBy(factor) {
      if (state.cameraMode !== 'external') return false;
      state.orbitZoom = clamp(state.orbitZoom * factor, ORBIT_ZOOM_MIN, ORBIT_ZOOM_MAX);
      return true;
    }

    /** 回到默认外观机位 */
    function resetOrbit() {
      state.orbitYaw = ORBIT_TARGET_YAW;
      state.orbitPitch = ORBIT_TARGET_PITCH;
      state.orbitZoom = ORBIT_TARGET_ZOOM;
      state.orbitDist = EXTERNAL_DIST;
      return true;
    }

    function getOrbit() {
      return {
        yaw: state.orbitYaw,
        pitch: state.orbitPitch,
        zoom: state.orbitZoom,
        distance: state.orbitDist
      };
    }

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);

    function updateStationVisibility(s) {
      if (Math.abs(s - state.lastStationCull) < 18) return;
      state.lastStationCull = s;
      stationGroups.forEach(function (g) {
        const d = Math.abs(g.userData.s - s);
        g.visible = d < 620;
      });
    }

    function updateEnvironment(s, dt) {
      const env = ROUTE.envAt(s);
      const target = env === 'underground' ? 1 : (env === 'ground' ? 0.48 : 0);
      state.envBlend = damp(state.envBlend, target, 1.5, dt);
      const t = state.envBlend;
      const sky = new THREE.Color(0x9dc5ea).lerp(new THREE.Color(0x05080b), t);
      scene.background.copy(sky);
      scene.fog.color.copy(sky);
      scene.fog.near = C.lerp(140, 18, t);
      scene.fog.far = C.lerp(2050, 175, t);
      sun.intensity = 1.9 * (1 - t * 0.92);
      hemi.intensity = 0.16 + 0.82 * (1 - t);
      fill.intensity = 0.05 + 0.22 * (1 - t);
      renderer.toneMappingExposure = C.lerp(1.08, 0.95, t);
      cityRoot.visible = t < 0.94;
      tunnelLightA.intensity = t * 1.5;
      tunnelLightB.intensity = t * 0.9;
      const p = ROUTE.point(s, 0, 4.6);
      tunnelLightA.position.set(p.x, p.y, p.z);
      const p2 = ROUTE.point(s + state.playerDir * 55, 0, 4.2);
      tunnelLightB.position.set(p2.x, p2.y, p2.z);
    }

    function updateSun(s) {
      const p = ROUTE.point(s, 0, 0);
      sun.position.set(p.x + 95, p.y + 165, p.z + 110);
      sun.target.position.set(p.x, p.y, p.z);
      sun.target.updateMatrixWorld();
    }

    /* 外观机位可用空间：隧道侧墙 ±10.1、顶板 6.08，留出机位余量 */
    const CORRIDOR = {
      tunnelHalfWidth: 9.30,
      tunnelCeiling: 5.50,
      tunnelFloor: 0.55,
      openLateralLimit: 17.0,
      openFloor: 0.30
    };

    /** 把机位夹回线路断面内部：优先牺牲距离，不改变观察角度。 */
    function clampCameraToCorridor(pos) {
      const centerX = C.LINE.lengthM * 0.5;
      const s = clamp(pos.x + centerX, -240, C.LINE.lengthM + 240);
      const base = ROUTE.point(s, 0, 0);
      const lat = (pos.x - base.x) * base.rx + (pos.z - base.z) * base.rz;
      const up = pos.y - base.y;
      let nl = lat;
      let nu = up;
      if (ROUTE.envAt(s) === 'underground') {
        let half = CORRIDOR.tunnelHalfWidth;
        let ceil = CORRIDOR.tunnelCeiling;
        // 车辆段等局部扩大区段：断面放宽
        for (let i = 0; i < DEPOT_CAMERA_ZONES.length; i++) {
          const zone = DEPOT_CAMERA_ZONES[i];
          if (s >= zone.s0 && s <= zone.s1) {
            half = Math.max(half, zone.halfWidth);
            ceil = Math.max(ceil, zone.ceiling);
          }
        }
        nl = clamp(lat, -half, half);
        nu = clamp(up, CORRIDOR.tunnelFloor, ceil);
      } else {
        nl = clamp(lat, -CORRIDOR.openLateralLimit, CORRIDOR.openLateralLimit);
        nu = Math.max(up, CORRIDOR.openFloor);
      }
      if (nl === lat && nu === up) return pos;
      pos.x = base.x + base.rx * nl;
      pos.z = base.z + base.rz * nl;
      pos.y = base.y + nu;
      return pos;
    }

    function updateCamera(sim, dt, view) {
      const dir = sim.dir;
      const lateral = dir > 0 ? TRACK_OFFSET : -TRACK_OFFSET;
      state.playerS = sim.s;
      state.playerDir = dir;
      state.playerLateral = lateral;
      if (Math.abs(state.visualLateral - lateral) > 8) state.visualLateral = lateral;
      else state.visualLateral = damp(state.visualLateral, lateral, 2.5, dt);

      const lookS = sim.s;
      if (state.cameraMode === 'cab') {
        const p = ROUTE.point(lookS - dir * 2.35, state.visualLateral + dir * 0.50, 2.88);
        camera.position.set(p.x, p.y, p.z);
        // 轻微车体振动
        const shake = Math.min(1, Math.abs(sim.v) / 18);
        camera.position.y += Math.sin(state.time * 17.0) * 0.008 * shake;
        camera.position.x += Math.sin(state.time * 11.3 + 1.7) * 0.006 * shake;

        const target = ROUTE.point(lookS + dir * 110, state.visualLateral + dir * 0.5, 2.25);
        let vx = target.x - camera.position.x;
        let vy = target.y - camera.position.y;
        let vz = target.z - camera.position.z;
        const yaw = state.cameraYaw;
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const nx = vx * cy + vz * sy;
        const nz = -vx * sy + vz * cy;
        vx = nx; vz = nz;
        const hlen = Math.sqrt(vx * vx + vz * vz);
        vy += Math.tan(state.cameraPitch) * hlen;
        camera.up.set(0, 1, 0);
        camera.lookAt(camera.position.x + vx, camera.position.y + vy, camera.position.z + vz);
        cab.group.visible = true;
        playerConsist.group.visible = false;
      } else {
        // 外观视角：以车头为轴心做球面轨道，可旋转与缩放。
        const pivot = ROUTE.point(sim.s, state.visualLateral, 2.10);
        const dist = damp(state.orbitDist, EXTERNAL_DIST * state.orbitZoom, 9, dt);
        state.orbitDist = dist;
        // 基准机位：轨道右侧（dir>0 时 -z 方向）斜后上方；angle 绕轴心旋转。
        const angle = -dir * Math.PI * 0.5 + state.orbitYaw;
        const cosP = Math.cos(state.orbitPitch);
        const offset = dist * cosP;
        const camPos = {
          x: pivot.x + (-pivot.tz) * Math.sin(angle) * offset + pivot.tx * Math.cos(angle) * offset,
          y: pivot.y + Math.sin(state.orbitPitch) * dist,
          z: pivot.z + pivot.tx * Math.sin(angle) * offset + pivot.tz * Math.cos(angle) * offset
        };
        // 不让机位穿进隧道侧墙/顶板或桥面以下：优先保留角度，只把距离缩到墙面以内。
        clampCameraToCorridor(camPos);
        if (!state.externalInit) {
          state.externalCam.copy(camPos);
          state.externalLook.copy(pivot);
          state.externalInit = true;
        }
        state.externalCam.x = damp(state.externalCam.x, camPos.x, 12, dt);
        state.externalCam.y = damp(state.externalCam.y, camPos.y, 12, dt);
        state.externalCam.z = damp(state.externalCam.z, camPos.z, 12, dt);
        state.externalLook.x = damp(state.externalLook.x, pivot.x, 12, dt);
        state.externalLook.y = damp(state.externalLook.y, pivot.y, 12, dt);
        state.externalLook.z = damp(state.externalLook.z, pivot.z, 12, dt);
        // 平滑后的位置同样再夹一次，保证列车移动/过渡时也不会卡进墙里。
        clampCameraToCorridor(state.externalCam);
        camera.position.copy(state.externalCam);
        camera.lookAt(state.externalLook);
        cab.group.visible = false;
        playerConsist.group.visible = true;
      }

      // 头灯跟随车头
      const hp = ROUTE.point(sim.s, state.visualLateral, 1.25);
      const ht = ROUTE.point(sim.s + dir * 95, state.visualLateral, 0.9);
      headlight.position.set(hp.x, hp.y, hp.z);
      headlight.target.position.set(ht.x, ht.y, ht.z);
      headlight.target.updateMatrixWorld();
      headGlow.position.set(hp.x, hp.y, hp.z);
    }

    function updatePlayerTrain(sim) {
      placeConsist(playerConsist, sim.s, sim.dir, state.visualLateral, 0.03);
      cab.handle.rotation.x = sim.notch > 0
        ? -sim.notch / VEHICLE.powerNotches * 0.34
        : (sim.notch < 0 ? (-sim.notch / VEHICLE.brakeNotches) * 0.28 : 0);
      cab.doorButtons.open.emissiveIntensity = sim.doors === 'open' || sim.doors === 'opening' ? 1.0 : 0.18;
      cab.doorButtons.close.emissiveIntensity = sim.doors === 'closed' ? 0.9 : 0.18;
      cab.ebMat.emissiveIntensity = sim.eb ? 1.2 : 0.25;
      const atp = sim.getAtpStatus();
      const st = {
        speedKph: sim.v * 3.6,
        vPermKph: atp.vPermKph,
        targetDistance: atp.targetDistance,
        targetType: atp.targetType,
        nextStation: sim.getNextStop(),
        atStation: !!sim.atStation,
        warning: sim.warning,
        overspeed: sim.v * 3.6 > atp.vPermKph + 2.0,
        eb: sim.eb,
        ato: sim.ato
      };
      drawDmi(cab.dmi, st);
      headlight.intensity = sim.eb ? 2.5 : (state.envBlend > 0.2 ? 4.2 : 0.35);
      headGlow.intensity = state.envBlend > 0.2 ? 1.0 : 0.08;
    }

    function updateLeader(sim) {
      const ghost = sim.leaderState;
      if (!ghost || !ghost.active) {
        leaderConsist.group.visible = false;
        leaderGlow.intensity = 0;
        return;
      }
      const dir = sim.dir;
      const lateral = dir > 0 ? TRACK_OFFSET : -TRACK_OFFSET;
      const gap = sim.lastAtp ? sim.lastAtp.leaderGap : Infinity;
      const visible = Math.abs(ghost.s - sim.s) < 1750;
      leaderConsist.group.visible = visible;
      if (visible) {
        placeConsist(leaderConsist, ghost.s, dir, lateral, 0.03);
        const rear = ROUTE.point(ghost.s - dir * (TRAIN_LENGTH - 1.0), lateral, 1.25);
        leaderGlow.position.set(rear.x, rear.y, rear.z);
        leaderGlow.intensity = gap < 400 ? 0.6 : 0.15;
      } else {
        leaderGlow.intensity = 0;
      }
    }

    function updateOpposing(sim) {
      const opp = sim.opposingState;
      if (!opp || !opp.active || !isFinite(opp.s)) {
        opposingConsist.group.visible = false;
        return;
      }
      const oppDir = -sim.dir;
      const visible = Math.abs(opp.s - sim.s) < 1950;
      opposingConsist.group.visible = visible;
      if (!visible) return;
      const lateral = oppDir > 0 ? TRACK_OFFSET : -TRACK_OFFSET;
      placeConsist(opposingConsist, opp.s, oppDir, lateral, 0.03);
    }

    function updateSleepersAndCull(sim) {
      updateSleepers(sim.s);
      updateStationVisibility(sim.s);
    }

    function update(sim, dt, view) {
      state.time += dt;
      state.cameraMode = (view && view.mode) || state.cameraMode;
      state.cameraYaw = view && typeof view.yaw === 'number' ? view.yaw : state.cameraYaw;
      state.cameraPitch = view && typeof view.pitch === 'number' ? view.pitch : state.cameraPitch;
      updateEnvironment(sim.s, dt);
      updateSun(sim.s);
      updateCamera(sim, dt, view);
      updatePlayerTrain(sim);
      updateLeader(sim);
      updateOpposing(sim);
      updateSleepersAndCull(sim);
      if (cab.group.visible) cab.group.visible = true;
      renderer.render(scene, camera);
    }

    resize();

    // 让第一帧先出来，再在后台解析 12 MB glb；失败则继续用程序化车体。
    if (typeof global.setTimeout === 'function') {
      global.setTimeout(startDkz4Load, 550);
    } else {
      startDkz4Load();
    }

    return {
      scene: scene,
      camera: camera,
      renderer: renderer,
      update: update,
      resize: resize,
      toggleCameraMode: function () {
        state.cameraMode = state.cameraMode === 'cab' ? 'external' : 'cab';
        state.externalInit = false;
        state.cameraYaw = 0;
        state.cameraPitch = 0;
        resetOrbit();
        return state.cameraMode;
      },
      getCameraMode: function () { return state.cameraMode; },
      orbitRotate: orbitRotate,
      orbitZoomBy: orbitZoomBy,
      resetOrbit: resetOrbit,
      getOrbit: getOrbit,
      // 临时调试：Shift+滚轮调节车顶终点站牌前后位置（取到合适值后移除）
      nudgeDestBoard: nudgeDestBoard,
      getDestBoardOffset: function () { return -DEST_BOARD_TUNE.back; },
      getDestBoardHint: function () { return destBoardHintEl ? destBoardHintEl.textContent : ''; },
      getState: function () { return state; },
      stationGroups: stationGroups,
      // 花庄南侧上下行交叉（纯视觉）：交叉区间与给定位置的实际轨道中心横向偏距
      crossover: CROSSOVER,
      trackLateralAt: trackLateralAt,
      // 配线（纯装饰）：只用于自检与调试，不参与行车逻辑
      getYardInfo: function () { return yardInfo.slice(); },
      getYardTrackCount: function () { return yardInfo.length; },
      playerConsist: playerConsist,
      leaderConsist: leaderConsist,
      trainModel: dkz4State,
      getTrainModelStatus: function () {
        return {
          status: dkz4State.status,
          progress: dkz4State.progress,
          message: dkz4State.message,
          error: dkz4State.error,
          info: dkz4State.info
        };
      },
      setDestination: function (name) {
        if (!name) return;
        playerConsist.destination = name;
        leaderConsist.destination = name;
        const tex = textToggleTexture(name);
        destinationMaterials.forEach(function (mat) {
          mat.map = tex;
          mat.needsUpdate = true;
        });
      },
      setOpposingDestination: function (name) {
        if (!name) return;
        opposingConsist.destination = name;
        const tex = textToggleTexture(name);
        opposingDestinationMaterials.forEach(function (mat) {
          mat.map = tex;
          mat.needsUpdate = true;
        });
      }
    };
  }

  global.BJWorld = { createWorld: createWorld };
})(window);
