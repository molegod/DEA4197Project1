// Renderer, camera, lights and orbit controls, plus helpers to go between the
// screen and the board.
//
// Everything is drawn into a floating-point buffer and finished off with a bloom pass,
// so bright things (the sun, glitter on the water, snow) spill light the way a camera
// does, and the filmic tone map brings that back into range at the end.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CONFIG } from '../config.js';
import { Sky, SUN_DIR } from './sky.js';
import { Daylight } from './daylight.js';
import { shadingUniforms } from './shading.js';
import { DepthOfFieldShader } from './dof.js';

export class Stage {
  constructor(canvas, { width, height }) {
    this.canvas = canvas;
    this.boardW = width;
    this.boardH = height;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = CONFIG.view.exposure;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(36, 1, 2, 14000);

    // The sky doubles as the ambient light: it is baked into an environment map, so
    // shaded sides pick up blue from above and warm bounce from the horizon.
    this.sky = new Sky(scene, renderer);
    scene.environmentIntensity = 0.75;
    const hemi = new THREE.HemisphereLight(0xe4edff, 0x6b5a44, 0.3);
    scene.add(hemi);

    // Sun from the back left, so shadows fall toward the viewer where they can be seen.
    const sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
    sun.position.copy(SUN_DIR).multiplyScalar(900);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    const reach = Math.hypot(width, height) * 0.5;
    sc.left = -reach;
    sc.right = reach;
    sc.top = reach;
    sc.bottom = -reach;
    sc.near = 100;
    sc.far = 2200;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    sun.shadow.radius = 3;
    scene.add(sun);
    this.sun = sun;
    // A soft fill from the front right, so faces aren't in black shade.
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.3);
    fill.position.set(500, 300, 700);
    scene.add(fill);

    // One clock for the sun, the sky, the fill and the exposure, and one set of
    // uniforms that every lit material in the scene shares.
    this.shade = shadingUniforms();
    this.daylight = new Daylight({ sky: this.sky, sun, hemi, scene, renderer });
    this.time = 0;

    const controls = new OrbitControls(this.camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = 1.38;
    controls.minDistance = 60;
    controls.maxDistance = 2600;
    controls.autoRotateSpeed = 0.5;
    controls.zoomToCursor = true;
    this.controls = controls;
    this.home();

    const B = CONFIG.view.bloom;
    this.composer = new EffectComposer(
      renderer,
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }),
    );
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.dof = new ShaderPass(DepthOfFieldShader);
    this.dof.uniforms.uStrength.value = CONFIG.view.dof.strength;
    this.dof.uniforms.uRange.value = CONFIG.view.dof.range;
    this.dof.uniforms.uMaxBlur.value = CONFIG.view.dof.maxBlur;
    this.composer.addPass(this.dof);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), B.strength, B.radius, B.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // The water reads this: the scene without it, at half size, with its depth. One
    // extra pass, and the shadow map is reused rather than redrawn for it.
    renderer.shadowMap.autoUpdate = false;
    const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: depth });
    this.water = null;
    this.skipInRefraction = [];

    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.tmp = new THREE.Vector3();
    this.resize();
  }

  home() {
    this.camera.position.set(0, 840, 1000);
    this.controls.target.set(0, 20, 40);
    this.controls.update();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.bloom.setSize(w * dpr, h * dpr);
    this.sceneTarget.setSize(Math.max(2, Math.round((w * dpr) / 2)), Math.max(2, Math.round((h * dpr) / 2)));
    if (this.water) {
      this.renderer.getDrawingBufferSize(this.water.uniforms.uResolution.value);
      this.water.uniforms.uNear.value = this.camera.near;
      this.water.uniforms.uFar.value = this.camera.far;
    }
    this.dof.uniforms.uTexel.value.set(1 / (w * dpr), 1 / (h * dpr));
    this.camera.aspect = w / h;
    // Keep the whole board in view on narrow screens.
    this.camera.fov = w / h < 1 ? 58 : 36;
    this.camera.updateProjectionMatrix();
  }

  // Keep the camera's focus on the board.
  clampTarget() {
    const t = this.controls.target, W = this.boardW / 2, H = this.boardH / 2;
    const cx = Math.min(W, Math.max(-W, t.x)), cz = Math.min(H, Math.max(-H, t.z));
    if (cx !== t.x || cz !== t.z) {
      this.camera.position.x += cx - t.x;
      this.camera.position.z += cz - t.z;
      t.x = cx;
      t.z = cz;
    }
  }

  // Things that never sit under the water don't need drawing into the buffer the water
  // refracts, and the grass is most of the scene's triangles.
  hideFromWater(object) {
    this.skipInRefraction.push(object);
  }

  // Hand the ocean the buffers it refracts, and keep it in step with the canvas.
  setWater(ocean) {
    this.water = ocean;
    ocean.uniforms.uScene.value = this.sceneTarget.texture;
    ocean.uniforms.uSceneDepth.value = this.sceneTarget.depthTexture;
    this.dof.uniforms.tDepth.value = this.sceneTarget.depthTexture;
    this.resize();
  }

  render(seconds = this.time) {
    this.time = seconds;
    this.controls.update();
    this.clampTarget();
    this.camera.updateMatrixWorld();
    this.sky.dome.position.copy(this.camera.position);

    // Move the day on, then hand the new sun to every material that is lit by it.
    this.daylight.update(seconds, this.camera);
    this.shade.uTime.value = seconds;
    this.shade.uSunView.value.copy(this.daylight.viewDir);
    this.shade.uKey.value.copy(this.sun.color).multiplyScalar(this.sun.intensity);

    if (this.water) this.water.uniforms.uLight.value.copy(this.daylight.light);

    // Focus on whatever the camera is pointed at.
    this.dof.uniforms.uFocus.value = this.camera.position.distanceTo(this.controls.target);
    this.dof.uniforms.uNear.value = this.camera.near;
    this.dof.uniforms.uFar.value = this.camera.far;
    this.renderer.shadowMap.needsUpdate = true;
    if (this.water) {
      this.water.surface.visible = false;
      for (const o of this.skipInRefraction) o.visible = false;
      this.renderer.setRenderTarget(this.sceneTarget);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      this.water.surface.visible = true;
      for (const o of this.skipInRefraction) o.visible = true;
    }
    this.composer.render();
  }

  // Screen position (CSS px) of a point on the board.
  project(v) {
    this.tmp.copy(v).project(this.camera);
    return { x: (this.tmp.x * 0.5 + 0.5) * window.innerWidth, y: (-this.tmp.y * 0.5 + 0.5) * window.innerHeight, behind: this.tmp.z > 1 };
  }

  // The point on the ground (or water surface) under a screen position, in simulation
  // coordinates, by marching the view ray across the height field.
  groundAt(clientX, clientY, world) {
    this.ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const { origin: o, direction: d } = this.raycaster.ray;
    const VS = CONFIG.view.heightScale, water = CONFIG.world.waterLevel * VS;
    const W = world.width, H = world.height;
    const surface = (x, z) => Math.max(world.heightAt(x + W / 2, z + H / 2) * VS, water);
    const inside = (x, z) => x >= -W / 2 && x <= W / 2 && z >= -H / 2 && z <= H / 2;
    let t = d.y < 0 ? Math.max(0, (VS * 1.05 - o.y) / d.y) : 0;
    let prev = t;
    for (let i = 0; i < 1200; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < -CONFIG.view.baseDepth) break;
      if (inside(x, z) && y <= surface(x, z)) {
        let lo = prev, hi = t;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          const mx = o.x + d.x * mid, my = o.y + d.y * mid, mz = o.z + d.z * mid;
          if (inside(mx, mz) && my <= surface(mx, mz)) hi = mid;
          else lo = mid;
        }
        const hx = o.x + d.x * hi, hz = o.z + d.z * hi;
        return { x: hx + W / 2, y: hz + H / 2, point: new THREE.Vector3(hx, surface(hx, hz), hz) };
      }
      prev = t;
      t += 3;
    }
    return null;
  }
}
