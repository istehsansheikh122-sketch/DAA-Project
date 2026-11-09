// 3D character stage (Three.js). Sab kuch screen-pixel (px) mein bolta hai,
// taake DOM ke numbers aur 3D character ek hi coordinates mein kaam karein.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const FOV = 35;
const CAM_D = 6.3;            // camera ki doori (bada = character chhota). Array pe focus rakhne ke liye
const FEET_FRAC = 0.88;       // character ke pair screen ki height ke 88% par (neeche chat bar ki jagah chhodi hai)
const TALK_GESTURES = ['ack', 'nod', 'happy', 'think', 'dismiss'];   // bolte waqt ye clips beech beech mein chalti hain
const MOVE_SPEED = 1.5;       // world units / second
const TURN_SPEED = 10;
const LOOK = { yaw: 1.0, pitch: 0.5, smooth: 8 };
const LOOPING = new Set(['walk', 'idle', 'hiphop']);

export const PICK_TIME = 2.3; // pickup clip mein haath sab se neeche is second par aata hai

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  // Phone (portrait) par character thoda chhota, taake bubble ke liye sar ke upar jagah bache
  let visibleH = 1;
  function setCamera() {
    const d = CAM_D * (innerWidth / innerHeight < 0.8 ? 1.28 : 1);
    visibleH = 2 * d * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const camY = ((innerWidth < 700 ? 0.82 : FEET_FRAC) - 0.5) * visibleH;   // phone: pair thode upar, neeche button ki jagah
    camera.position.set(0, camY, d);
    camera.lookAt(0, camY, 0);
  }
  setCamera();

  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x8a7358, 1.25));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
  sun.position.set(2.5, 5, 3.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 15 });
  scene.add(sun);

  const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.22 }));
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.y = 0.005;
  shadowFloor.receiveShadow = true;
  scene.add(shadowFloor);

  const pxPerUnit = () => innerHeight / visibleH;
  const worldX = px => (px - innerWidth / 2) / pxPerUnit();
  const toPx = v => {
    const p = v.clone().project(camera);
    return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight };
  };

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    setCamera();
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  // ---------- state ----------
  let model, mixer, head, neck, spine, rightHand;
  const actions = {};
  const finishers = new Map();
  let current = null;
  let busy = false;
  let walkTarget = null, walkResolve = null;
  let targetYaw = 0;
  let speed = 1;
  let lookPx = null;
  // bolne ki movement
  let talking = false, talkEnv = 0, emph = 0, nextGestureAt = 0, lastGestureAt = 0;
  const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
  const look = { yaw: 0, pitch: 0, weight: 0 };
  const clock = new THREE.Clock();
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

  let lastMouseMove = -Infinity;
  addEventListener('pointermove', e => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    lastMouseMove = performance.now();
  });

  function play(name, fade = 0.25) {
    const next = actions[name];
    if (!next || next === current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (current) current.fadeOut(fade);
    current = next;
  }

  function interrupt() {            // chalti hui one-shot clip ko beech mein rokna
    busy = false;
    finishers.forEach(r => r());
    finishers.clear();
  }

  // ---------- skin tone ----------
  // Texture mein skin ka ek hi brown colour hai. Hum sirf "skin jaise" pixels dhoondte hain
  // (hue/saturation/brightness se), aur unka colour naye tone se badal dete hain.
  // Kapre, hair, jootay, aankhein wagaira nahi chhoote. Shading (halka/gehra) bhi bacha rehta hai.
  let skin = null;
  const win = (x, a, b, c, d) => Math.max(0, Math.min((x - a) / (b - a), 1, (d - x) / (d - c)));

  const imgReady = async map => {
    const t0 = performance.now();
    while ((!map.image || map.image.complete === false || !map.image.width) && performance.now() - t0 < 8000) {
      await new Promise(r => setTimeout(r, 40));
    }
    return !!(map.image && map.image.width);
  };

  // opts.meshes: sirf in naam wale meshes ki skin (UV se), opts.vmin: kam se kam roshni (gehre brown / chamde ko chhodne ke liye)
  async function initSkin(root, opts = {}) {
    let mat = null;
    const skinMeshes = [];
    const re = opts.meshes ? new RegExp(opts.meshes) : null;
    root.traverse(o => {
      if (!o.isMesh || !o.material || !o.material.map) return;
      if (re) { if (re.test(o.name)) { skinMeshes.push(o); mat = mat || o.material; } }
      else if (!mat) mat = o.material;
    });
    if (!mat || !(await imgReady(mat.map))) return null;
    const mats = [];
    root.traverse(o => { if (o.isMesh) [].concat(o.material).forEach(m => { if (m.map === mat.map && !mats.includes(m)) mats.push(m); }); });
    const img = mat.map.image;
    const scale = Math.min(1, (opts.maxSize || 4096) / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const base = new Uint8ClampedArray(imageData.data);
    // UV mask: texture ka kaun sa hissa skin wale meshes ka hai
    let uvMask = null;
    if (skinMeshes.length) {
      const mc = document.createElement('canvas');
      mc.width = w; mc.height = h;
      const mx = mc.getContext('2d', { willReadFrequently: true });
      mx.fillStyle = '#fff'; mx.strokeStyle = '#fff'; mx.lineWidth = 2; mx.lineJoin = 'round';
      const flip = mat.map.flipY;
      skinMeshes.forEach(o => {
        const uv = o.geometry.attributes.uv, idx = o.geometry.index;
        const n = idx ? idx.count : uv.count;
        const at = k => { const i = idx ? idx.getX(k) : k; return [uv.getX(i) * w, (flip ? 1 - uv.getY(i) : uv.getY(i)) * h]; };
        for (let k = 0; k + 2 < n; k += 3) {
          const A = at(k), B = at(k + 1), C = at(k + 2);
          mx.beginPath(); mx.moveTo(A[0], A[1]); mx.lineTo(B[0], B[1]); mx.lineTo(C[0], C[1]); mx.closePath();
          mx.fill(); mx.stroke();
        }
      });
      uvMask = mx.getImageData(0, 0, w, h).data;
    }
    const vmin = opts.vmin ?? 0.22;
    const mask = new Float32Array(w * h);
    const lum = new Float32Array(w * h);
    let sumM = 0, sumL = 0;
    for (let i = 0; i < w * h; i++) {
      const r = base[i * 4] / 255, g = base[i * 4 + 1] / 255, b = base[i * 4 + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let hue = 0;
      if (d > 1e-6) {
        if (mx === r) hue = ((g - b) / d + 6) % 6;
        else if (mx === g) hue = (b - r) / d + 2;
        else hue = (r - g) / d + 4;
        hue *= 60;
      }
      const sat = mx > 0 ? d / mx : 0;
      let m = win(hue, 4, 10, 36, 44) * win(sat, 0.16, 0.26, 0.8, 0.95) * win(mx, vmin, vmin + 0.08, 0.92, 0.99);
      if (uvMask) m *= uvMask[i * 4] / 255;
      mask[i] = m;
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      sumM += m; sumL += m * lum[i];
    }
    const tex = new THREE.CanvasTexture(canvas);
    Object.assign(tex, {
      flipY: mat.map.flipY, colorSpace: mat.map.colorSpace,
      wrapS: mat.map.wrapS, wrapT: mat.map.wrapT, anisotropy: 8,
    });
    return { mats, orig: mat.map, tex, ctx, imageData, base, mask, lum, L0: sumL / Math.max(sumM, 1), pixels: sumM };
  }

  // rgb = [r,g,b] (0-1) ya null (original tone wapas)
  function setSkinTone(rgb) {
    if (!skin) return;
    if (!rgb) { skin.mats.forEach(m => { m.map = skin.orig; m.needsUpdate = true; }); return; }
    const { base, mask, lum, imageData, L0 } = skin;
    const out = imageData.data;
    for (let i = 0; i < mask.length; i++) {
      const m = mask[i];
      const j = i * 4;
      if (m < 0.002) { out[j] = base[j]; out[j + 1] = base[j + 1]; out[j + 2] = base[j + 2]; continue; }
      const k = Math.min(1.6, Math.max(0.5, lum[i] / L0));
      for (let c = 0; c < 3; c++) {
        const target = Math.min(1, rgb[c] * k) * 255;
        out[j + c] = base[j + c] * (1 - m) + target * m;
      }
    }
    skin.ctx.putImageData(imageData, 0, 0);
    skin.tex.needsUpdate = true;
    skin.mats.forEach(m => { m.map = skin.tex; m.needsUpdate = true; });
  }

  // ---------- public API ----------
  // ---------- characters ----------
  // Original character GLB hi sab animations (clips) ka source hai. Baaqi characters (FBX) ke bones ke naam
  // wahi Mixamo wale hain, is liye wahi clips unpar bhi chalti hain.
  let origGltf = null, refSize = null, origHips = null;
  const entries = {};              // id -> { root, clips, headY, skin }
  let currentId = null, headY = 1.45;

  const loadWith = (Loader, url, onProgress) => new Promise((res, rej) => {
    new Loader().load(url, res, e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); }, rej);
  });

  // FBX ka masla: har mesh ke saath bones ki alag copy aati hai (Hips ke andar Hips...). Animation sirf ek copy
  // ko chalati hai, baaqi mesh jam jate hain. Yahan sab copies ko ek saaf skeleton mein badal dete hain.
  function rebuildRig(root) {
    root.updateMatrixWorld(true);
    const meshes = [];
    root.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
    const worldRest = new Map(), parentOf = new Map(), order = [];
    meshes.forEach(m => m.skeleton.bones.forEach((b, i) => {
      if (!worldRest.has(b.name)) {
        worldRest.set(b.name, m.skeleton.boneInverses[i].clone().invert());   // bind pose (world)
        order.push(b.name);
      }
      const p = b.parent;
      if (p && p.isBone && p.name !== b.name && !parentOf.has(b.name)) parentOf.set(b.name, p.name);
    }));
    const oldRoots = new Set();
    meshes.forEach(m => m.skeleton.bones.forEach(b => {
      let t = b;
      while (t.parent && t.parent.isBone) t = t.parent;
      oldRoots.add(t);
    }));
    const canon = new Map();
    order.forEach(n => { const bn = new THREE.Bone(); bn.name = n; canon.set(n, bn); });
    const rig = new THREE.Group();
    rig.name = 'rig';
    const inv = new THREE.Matrix4(), local = new THREE.Matrix4();
    order.forEach(n => {
      const bone = canon.get(n), pn = parentOf.get(n);
      if (pn && canon.has(pn)) {
        inv.copy(worldRest.get(pn)).invert();
        local.multiplyMatrices(inv, worldRest.get(n));
        canon.get(pn).add(bone);
      } else {
        local.copy(worldRest.get(n));
        rig.add(bone);
      }
      local.decompose(bone.position, bone.quaternion, bone.scale);
    });
    oldRoots.forEach(r => { if (r.parent) r.parent.remove(r); });
    root.add(rig);
    root.updateMatrixWorld(true);
    meshes.forEach(m => {
      const bones = m.skeleton.bones.map(b => canon.get(b.name));
      m.bind(new THREE.Skeleton(bones, m.skeleton.boneInverses), m.bindMatrix);
    });
    return canon;
  }

  const findBone = (root, re) => { let f = null; root.traverse(o => { if (!f && o.isBone && re.test(o.name)) f = o; }); return f; };

  function buildFbx(fbx, gltf) {
    const canon = rebuildRig(fbx);
    // FBX ke Phong materials dull lagte hain (color 0xcccccc texture ko 20% gehra kar deta hai).
    // Original character jaisa Standard material, pura white color, naram roughness.
    const stdOf = new Map();
    const toStd = m => {
      if (!stdOf.has(m)) {
        const n = new THREE.MeshStandardMaterial({
          name: m.name, map: m.map, normalMap: m.normalMap, alphaMap: m.alphaMap,
          transparent: m.transparent, opacity: m.opacity, side: m.side, depthWrite: m.depthWrite,
          roughness: 0.78, metalness: 0, color: 0xffffff,
        });
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        stdOf.set(m, n);
      }
      return stdOf.get(m);
    };
    fbx.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.frustumCulled = false;
      o.material = Array.isArray(o.material) ? o.material.map(toStd) : toStd(o.material);
    });
    const hips = canon.get([...canon.keys()].find(k => /Hips$/.test(k)));
    const restPos = hips.position.clone();
    // kad: original character jitna hi lamba, pair floor par
    const box = new THREE.Box3().setFromObject(fbx);
    const size = box.getSize(new THREE.Vector3());
    const s = refSize.y / size.y;
    fbx.scale.setScalar(s);
    fbx.position.y = -box.min.y * s;
    // Hips ki position wali track: original ke hisaab se bani hai, naye kad ke hisaab se scale karo
    const ratio = restPos.y / origHips.y;
    const clips = gltf.animations.map(c => {
      const nc = c.clone();
      nc.tracks.forEach(t => {
        if (!/Hips\.position$/.test(t.name)) return;
        const v = t.values;
        for (let i = 0; i < v.length; i += 3) {
          v[i] = restPos.x + (v[i] - origHips.x) * ratio;
          v[i + 1] = restPos.y + (v[i + 1] - origHips.y) * ratio;
          v[i + 2] = restPos.z + (v[i + 2] - origHips.z) * ratio;
        }
      });
      return nc;
    });
    const head = findBone(fbx, /Head$/);
    const hp = new THREE.Vector3();
    head.getWorldPosition(hp);
    return { root: fbx, clips, headY: hp.y * 1.45 / origHeadY };
  }

  let origHeadY = 1.5;

  function teardown() {
    if (!model) return;
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(model); mixer.removeEventListener('finished', onFinished); }
    scene.remove(model);
    Object.keys(actions).forEach(k => delete actions[k]);
    finishers.clear();
    current = null; busy = false; walkTarget = null;
    if (walkResolve) { walkResolve(); walkResolve = null; }
    model = head = neck = spine = rightHand = null;
    skin = null;
  }

  function onFinished(e) {
    const r = finishers.get(e.action);
    if (r) { finishers.delete(e.action); r(); }
    if (e.action === current) { busy = false; play('idle'); }
  }

  // def = { id, type: 'glb' | 'fbx', url, tone }
  async function load(def, onProgress) {
    if (typeof def === 'function') { onProgress = def; def = { id: 'original', type: 'glb', url: document.body.dataset.model, tone: true }; }
    if (currentId === def.id && model) return;
    const startX = model ? model.position.x : worldX(-300);
    teardown();
    if (!origGltf) {
      origGltf = await loadWith(GLTFLoader, document.body.dataset.model, p => onProgress && onProgress(def.type === 'glb' ? p : p * 0.3));
      origGltf.scene.updateMatrixWorld(true);
      refSize = new THREE.Box3().setFromObject(origGltf.scene).getSize(new THREE.Vector3());
      origHips = findBone(origGltf.scene, /Hips$/).position.clone();
      const oh = new THREE.Vector3(); findBone(origGltf.scene, /Head$/).getWorldPosition(oh);
      origHeadY = oh.y;
    }
    let entry = entries[def.id];
    if (!entry) {
      if (def.type === 'glb') {
        origGltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
        entry = { root: origGltf.scene, clips: origGltf.animations, headY: 1.45 };
      } else {
        const fbx = await loadWith(FBXLoader, def.url, p => onProgress && onProgress(0.3 + p * 0.7));
        entry = buildFbx(fbx, origGltf);
      }
      entries[def.id] = entry;
    }
    // skin recolor ke liye texture ready hona chahiye, is liye model scene mein lagane se pehle
    if (def.tone && entry.skin === undefined) entry.skin = await initSkin(entry.root, def.skin || {});
    currentId = def.id;
    headY = entry.headY;
    model = new THREE.Group();
    model.add(entry.root);
    model.traverse(o => {
      if (!o.isBone) return;
      if (/Head$/.test(o.name)) head = o;
      if (/Neck$/.test(o.name)) neck = o;
      if (/Spine2$/.test(o.name)) spine = o;
      if (/RightHand$/.test(o.name)) rightHand = o;
    });
    model.position.x = startX;
    model.rotation.y = Math.PI / 2;
    scene.add(model);
    skin = def.tone ? entry.skin || null : null;

    mixer = new THREE.AnimationMixer(model);
    mixer.timeScale = speed;
    entry.clips.forEach(c => {
      const a = mixer.clipAction(c);
      if (!LOOPING.has(c.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      actions[c.name] = a;
    });
    mixer.addEventListener('finished', onFinished);
    play('idle', 0);
    if (!ticking) { ticking = true; requestAnimationFrame(tick); }
  }
  let ticking = false;

  const placeAtPx = px => { if (model) model.position.x = worldX(px); };

  function walkTo(px) {
    return new Promise(resolve => {
      interrupt();
      if (walkResolve) { walkResolve(); walkResolve = null; }   // pichli walk ka intezar karne wale ko free karo
      walkTarget = worldX(px);
      walkResolve = resolve;
    });
  }

  function playOnce(name) {
    return new Promise(resolve => {
      const a = actions[name];
      if (!a) return resolve();
      interrupt();
      busy = true;
      lastGestureAt = performance.now();
      a.reset();
      finishers.set(a, resolve);
      play(name);
    });
  }

  // character bol raha hai: thoda sa hilna-julna (gestures + sar ka halka hilna)
  function setTalking(on) {
    talking = on;
    if (on) nextGestureAt = performance.now() + 900;
  }
  const emphasize = () => { emph = 1; };     // har lafz par halka sa sar jhukana (agar voice boundary events de)

  function startLoop(name) { interrupt(); busy = true; play(name); }
  function stopLoop() { busy = false; play('idle'); }

  const lookAt = p => { lookPx = p; };
  const setSpeed = s => { speed = s; if (mixer) mixer.timeScale = s; };

  function headPx() {
    return toPx(_v.set(model ? model.position.x : 0, headY, 0));
  }
  function feetPx() {                // character ke pairon ke saamne floor ka point
    return toPx(_v.set(model ? model.position.x : 0, 0, 0.35));
  }
  function handPx() {
    if (!rightHand) return headPx();
    rightHand.getWorldPosition(_v);
    return toPx(_v);
  }

  // ---------- head tracking ----------
  function addRotation(bone, yaw, pitch) {
    if (!bone) return;
    _e.set(pitch, yaw, 0, 'YXZ');
    bone.quaternion.multiply(_q.setFromEuler(_e));
  }
  function updateLook(dt, enabled) {
    // Idle ho to mouse follow karo. Mouse 3 second na hile to wapas current number (lookPx) ki taraf.
    const mouseActive = performance.now() - lastMouseMove < 3000;
    const target = mouseActive ? mouse : (lookPx || mouse);
    const hp = headPx();
    const dx = (target.x - hp.x) / (innerWidth / 2);
    const dy = (target.y - hp.y) / (innerHeight / 2);
    const ty = THREE.MathUtils.clamp(dx * LOOK.yaw, -LOOK.yaw, LOOK.yaw);
    const tp = THREE.MathUtils.clamp(dy * LOOK.pitch, -LOOK.pitch, LOOK.pitch);
    const t = 1 - Math.exp(-LOOK.smooth * dt);
    look.yaw += (ty - look.yaw) * t;
    look.pitch += (tp - look.pitch) * t;
    look.weight += ((enabled ? 1 : 0) - look.weight) * t;
    const w = look.weight;
    addRotation(spine, look.yaw * 0.15 * w, look.pitch * 0.10 * w);
    addRotation(neck, look.yaw * 0.35 * w, look.pitch * 0.30 * w);
    addRotation(head, look.yaw * 0.50 * w, look.pitch * 0.60 * w);

    // bolte waqt: sar ka halka hilna (upar-neeche + idhar-udhar) jo animation ke upar lagta hai
    if (talkEnv > 0.01 || emph > 0.01) {
      const tt = performance.now() / 1000;
      const pitch = (Math.sin(tt * 7.1) * 0.6 + Math.sin(tt * 3.3 + 1) * 0.4) * 0.03 * talkEnv + emph * 0.05;
      const yaw = Math.sin(tt * 2.1) * 0.045 * talkEnv;
      addRotation(spine, yaw * 0.3, pitch * 0.3);
      addRotation(neck, yaw * 0.5, pitch * 0.5);
      addRotation(head, yaw * 0.6, pitch);
    }
  }

  // ---------- loop ----------
  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!model) { renderer.render(scene, camera); return; }   // character badalte waqt
    let walking = false;

    if (walkTarget !== null) {
      const dx = walkTarget - model.position.x;
      const step = MOVE_SPEED * Math.min(speed, 2) * dt;
      if (Math.abs(dx) <= step) {
        model.position.x = walkTarget;
        walkTarget = null;
        const r = walkResolve; walkResolve = null;
        play('idle');
        if (r) r();
      } else {
        walking = true;
        play('walk');
        model.position.x += Math.sign(dx) * step;
        targetYaw = Math.sign(dx) * Math.PI / 2;      // chalne ki taraf muh
      }
    }
    if (!walking) {
      targetYaw = 0;                                  // baaki waqt camera ki taraf muh
      if (!busy && current !== actions.idle) play('idle');
    }
    model.rotation.y += (targetYaw - model.rotation.y) * (1 - Math.exp(-TURN_SPEED * dt));

    // bolte waqt beech beech mein koi gesture (sirf jab character khada ho aur koi clip na chal rahi ho)
    const now = performance.now();
    talkEnv += ((talking ? 1 : 0) - talkEnv) * (1 - Math.exp(-6 * dt));
    emph *= Math.exp(-9 * dt);
    if (talking && !walking && !busy && now >= nextGestureAt && now - lastGestureAt > 2500) {
      const g = TALK_GESTURES[Math.floor(Math.random() * TALK_GESTURES.length)];
      playOnce(g);
      nextGestureAt = now + 2500 + Math.random() * 2500;
    }

    mixer.update(dt);                                 // 1) animation
    updateLook(dt, !walking && !busy);                // 2) phir head tracking + bolne ki movement
    renderer.render(scene, camera);
  }

  return { load, get characterId() { return currentId; }, placeAtPx, walkTo, playOnce, startLoop, stopLoop, lookAt, setSpeed, headPx, handPx, feetPx, setSkinTone, setTalking, emphasize, get clip() { return current ? current.getClip().name : null; } };
}
