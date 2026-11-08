// 3D character stage (Three.js). Sab kuch screen-pixel (px) mein bolta hai,
// taake DOM ke numbers aur 3D character ek hi coordinates mein kaam karein.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FOV = 35;
const CAM_D = 6.0;            // camera ki doori (bada = character chhota). Array pe focus rakhne ke liye
const FEET_FRAC = 0.95;       // character ke pair screen ki height ke 95% par (neeche floor par)
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
  const visibleH = 2 * CAM_D * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const camY = (FEET_FRAC - 0.5) * visibleH;
  camera.position.set(0, camY, CAM_D);
  camera.lookAt(0, camY, 0);

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
  let speaking = false;
  let speechTime = 0;
  let speechPose = [];
  let faceMorphs = [];
  let walkTarget = null, walkResolve = null;
  let targetYaw = 0;
  let facingYaw = Math.PI / 2;
  let speed = 1;
  let lookPx = null;
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

  function initFaceMorphs() {
    faceMorphs = [];
    model.traverse(o => {
      if (!o.isMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
      for (const [name, index] of Object.entries(o.morphTargetDictionary)) {
        const key = name.toLowerCase();
        if (/mouth|jaw|viseme|phoneme|smile|blink/.test(key)) {
          faceMorphs.push({
            influences: o.morphTargetInfluences,
            index,
            name: key,
            original: o.morphTargetInfluences[index],
          });
        }
      }
    });
  }

  function setSpeaking(value) {
    speaking = value;
    if (!value) {
      speechTime = 0;
      faceMorphs.forEach(morph => { morph.influences[morph.index] = morph.original; });
    }
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

  function initSkin() {
    let mat = null;
    model.traverse(o => { if (o.isMesh && !mat && o.material && o.material.map) mat = o.material; });
    if (!mat) return;
    const img = mat.map.image;
    const w = img.width, h = img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    const base = new Uint8ClampedArray(imageData.data);
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
      const m = win(hue, 6, 12, 32, 40) * win(sat, 0.2, 0.28, 0.8, 0.95) * win(mx, 0.22, 0.3, 0.9, 0.98);
      mask[i] = m;
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      sumM += m; sumL += m * lum[i];
    }
    const tex = new THREE.CanvasTexture(canvas);
    Object.assign(tex, {
      flipY: mat.map.flipY, colorSpace: mat.map.colorSpace,
      wrapS: mat.map.wrapS, wrapT: mat.map.wrapT, anisotropy: 8,
    });
    skin = { mat, orig: mat.map, tex, ctx, imageData, base, mask, lum, L0: sumL / Math.max(sumM, 1) };
  }

  // rgb = [r,g,b] (0-1) ya null (original tone wapas)
  function setSkinTone(rgb) {
    if (!skin) return;
    if (!rgb) { skin.mat.map = skin.orig; skin.mat.needsUpdate = true; return; }
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
    skin.mat.map = skin.tex;
    skin.mat.needsUpdate = true;
  }

  // ---------- public API ----------
  function load(onProgress) {
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(
        document.body.dataset.model,
        gltf => {
          model = gltf.scene;
          model.traverse(o => {
            if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
            if (o.isBone) {
              if (/Head$/.test(o.name)) head = o;
              if (/Neck$/.test(o.name)) neck = o;
              if (/Spine2$/.test(o.name)) spine = o;
              if (/RightHand$/.test(o.name)) rightHand = o;
            }
          });
          model.position.x = worldX(-300);
          model.rotation.y = Math.PI / 2;
          scene.add(model);
          initSkin();
          initFaceMorphs();

          mixer = new THREE.AnimationMixer(model);
          gltf.animations.forEach(c => {
            const a = mixer.clipAction(c);
            if (!LOOPING.has(c.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
            actions[c.name] = a;
          });
          mixer.addEventListener('finished', e => {
            const r = finishers.get(e.action);
            if (r) { finishers.delete(e.action); r(); }
            if (e.action === current) { busy = false; play('idle'); }
          });
          play('idle', 0);
          requestAnimationFrame(tick);
          resolve();
        },
        e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); },
        reject
      );
    });
  }

  const placeAtPx = px => { if (model) model.position.x = worldX(px); };

  function walkTo(px) {
    return new Promise(resolve => {
      interrupt();
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
      a.reset();
      finishers.set(a, resolve);
      play(name);
    });
  }

  function startLoop(name) { interrupt(); busy = true; play(name); }
  function stopLoop() { busy = false; play('idle'); }

  const lookAt = p => { lookPx = p; };
  const setSpeed = s => { speed = s; if (mixer) mixer.timeScale = s; };

  function updateSpeechPose(dt) {
    for (const [bone, axis, offset] of speechPose) bone.rotation[axis] -= offset;
    speechPose = [];
    if (!speaking) return;

    speechTime += dt;
    const addPose = (bone, axis, offset) => {
      if (!bone) return;
      bone.rotation[axis] += offset;
      speechPose.push([bone, axis, offset]);
    };
    addPose(spine, 'z', Math.sin(speechTime * 2.1) * 0.035);
    addPose(neck, 'z', Math.sin(speechTime * 2.7 + 0.5) * 0.045);
    addPose(head, 'x', Math.sin(speechTime * 3.2) * 0.045);
    addPose(rightHand, 'z', Math.sin(speechTime * 2.8) * 0.07);

    const mouth = Math.abs(Math.sin(speechTime * 7.5)) * 0.48;
    const blink = Math.pow(Math.max(0, Math.sin(speechTime * 1.8)), 36) * 0.85;
    for (const morph of faceMorphs) {
      if (/blink/.test(morph.name)) {
        morph.influences[morph.index] = Math.max(morph.original, blink);
      } else if (/smile/.test(morph.name)) {
        morph.influences[morph.index] = Math.max(morph.original, 0.18);
      } else if (/mouth|jaw/.test(morph.name)) {
        morph.influences[morph.index] = Math.max(morph.original, mouth);
      } else if (/viseme|phoneme/.test(morph.name)) {
        morph.influences[morph.index] = Math.max(morph.original, mouth * 0.75);
      }
    }
  }

  function headPx() {
    return toPx(_v.set(model ? model.position.x : 0, 1.45, 0));
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
  }

  // ---------- loop ----------
  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
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
    facingYaw += (targetYaw - facingYaw) * (1 - Math.exp(-TURN_SPEED * dt));
    model.rotation.y = facingYaw + (speaking ? Math.sin(speechTime * 1.4) * 0.035 : 0);

    mixer.update(dt);                                 // 1) animation
    updateSpeechPose(dt);
    updateLook(dt, !walking && !busy);                // 2) phir head tracking
    renderer.render(scene, camera);
  }

  return { load, placeAtPx, walkTo, playOnce, startLoop, stopLoop, lookAt, setSpeed, setSpeaking, headPx, handPx, feetPx, setSkinTone };
}
