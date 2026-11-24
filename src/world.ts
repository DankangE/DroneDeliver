import * as THREE from 'three';
import { BASE, FLIGHT } from './config';
import { needsAttention, objective, predictImpact, type Drone, type Sim } from './sim';
import { buildDepot } from './graphics/depot';
import { buildDestinations } from './graphics/destinations';
import { batteryPack, droneModel, type DroneMesh } from './graphics/drone';
import { displayContents, packingStation, productModel, stockShelves } from './graphics/packing';
import { crateModel } from './graphics/crate';
import { canvasTex, ink, setTextureQuality, surfaces, type Surfaces } from './graphics/materials';
import { Pipeline } from './graphics/pipeline';
import { AdaptiveQuality, TIERS, loadQualitySetting, saveQualitySetting, type QualitySetting, type QualityTier } from './graphics/quality';
import { buildTerrain } from './graphics/terrain';

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  private readonly adaptive = new AdaptiveQuality(loadQualitySetting());
  camera = new THREE.PerspectiveCamera(75, 1, 0.05, TIERS[this.adaptive.tier].far);
  private pipeline: Pipeline;
  private materials: Surfaces;
  private terrain: ReturnType<typeof buildTerrain>;
  private drones: DroneMesh[] = [];
  private labels: THREE.Sprite[];
  private crates = new Map<number, { mesh: THREE.Group; ttl: number | null }>();
  private crateModels = new Map<string, THREE.Group>();
  private held = new THREE.Group();
  private heldCrate = new THREE.Group();
  private heldBattery: THREE.Group;
  private heldItem = new THREE.Group();
  private packing: ReturnType<typeof packingStation>;
  private contentsKey = '';
  private marker: THREE.Mesh;
  private impact: THREE.Mesh;
  private padOffline: THREE.Mesh;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  private bob = 0;

  constructor(canvas: HTMLCanvasElement) {
    const settings = TIERS[this.adaptive.tier];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.pipeline = new Pipeline(this.renderer, this.camera, this.scene, settings);
    this.materials = surfaces(this.renderer, settings);
    this.camera.rotation.order = 'YXZ';
    this.terrain = buildTerrain(this.scene, this.materials);
    const marks = this.pipeline.markings;
    buildDepot(this.scene, marks, this.materials);
    stockShelves(this.scene);
    this.packing = packingStation(this.materials);
    this.scene.add(this.packing.station);
    this.labels = buildDestinations(this.scene, marks, this.materials);

    this.heldCrate.scale.setScalar(0.8);
    this.heldBattery = batteryPack(this.materials.metal);
    this.heldBattery.traverse(part => { part.castShadow = false; });
    this.heldItem.scale.setScalar(1.32);
    this.heldItem.rotation.set(0.08, -0.35, -0.12);
    this.held.add(this.heldCrate, this.heldBattery, this.heldItem);
    this.held.position.set(0.32, -0.42, -0.85);
    this.camera.add(this.held);
    this.scene.add(this.camera);

    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 4), ink({ color: 0xffd23f }));
    this.marker.rotation.x = Math.PI;
    marks.add(this.marker);

    this.impact = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.35, 80), ink({
      color: 0xff3df0, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false,
    }));
    this.impact.rotation.x = -Math.PI / 2;
    this.impact.renderOrder = 10;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.25, 32), this.impact.material);
    dot.renderOrder = 10;
    this.impact.add(dot);
    marks.add(this.impact);

    this.padOffline = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), ink({
      map: canvasTex(256, 256, g => {
        g.strokeStyle = '#e53935'; g.lineWidth = 28; g.beginPath();
        g.moveTo(28, 28); g.lineTo(228, 228); g.moveTo(228, 28); g.lineTo(28, 228); g.stroke();
      }),
      transparent: true, depthWrite: false,
    }));
    this.padOffline.rotation.x = -Math.PI / 2;
    this.padOffline.position.set(BASE.pads[1].x, 0.108, BASE.pads[1].z);
    this.padOffline.renderOrder = 1;
    marks.add(this.padOffline);
    this.terrain.setQuality(settings);
    this.pipeline.prepare(this.scene);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline.resize(w, h);
  }

  private crate(code: string, color: number, orderId: number) {
    const variant = orderId % 3;
    const key = code + '/' + variant;
    let model = this.crateModels.get(key);
    if (!model) {
      model = crateModel(code, color, variant);
      this.pipeline.prepare(model);
      this.crateModels.set(key, model);
    }
    return model.clone();
  }

  update(s: Sim, dt: number) {
    while (this.drones.length < s.drones.length) {
      const drone = droneModel(this.drones.length, this.materials);
      this.pipeline.prepare(drone.group);
      this.scene.add(drone.group);
      this.drones.push(drone);
    }
    this.drones.forEach((drone, i) => {
      const visible = i < s.drones.length;
      if (drone.group.visible !== visible) this.pipeline.invalidateCasters();
      drone.group.visible = visible;
    });
    this.padOffline.visible = s.stage.drones < 2;
    s.drones.forEach((d, i) => this.updateDrone(d, this.drones[i], dt));
    this.updateCrates(s, dt);

    this.packing.carton.visible = !!s.box;
    const contentsKey = s.box?.contents.join('/') ?? '';
    if (this.contentsKey !== contentsKey) {
      displayContents(this.packing.contents, s.box?.contents ?? []);
      this.pipeline.prepare(this.packing.contents);
      this.contentsKey = contentsKey;
    }

    const carry = s.player.carrying;
    this.heldItem.visible = carry?.kind === 'item';
    if (carry?.kind === 'item' && this.heldItem.name !== carry.product) {
      this.heldItem.clear();
      this.heldItem.add(productModel(carry.product));
      this.pipeline.prepare(this.heldItem);
      this.heldItem.name = carry.product;
    }
    this.held.visible = s.player.mode === 'walk' && carry != null;
    this.heldBattery.visible = carry?.kind === 'battery';
    this.heldCrate.visible = carry?.kind === 'crate';
    if (carry?.kind === 'crate') {
      const o = s.orders.find((or) => or.id === carry.orderId);
      if (o && this.heldCrate.name !== o.dest.id + '/' + o.id) {
        this.heldCrate.clear();
        this.heldCrate.add(this.crate(o.dest.id, o.dest.color, o.id));
        this.heldCrate.name = o.dest.id + '/' + o.id;
      }
    }

    const obj = objective(s);
    this.marker.visible = s.player.mode === 'walk' && obj.at != null && s.phase === 'playing';
    if (obj.at) {
      this.marker.position.set(obj.at.x, obj.at.y + Math.sin(performance.now() / 300) * 0.15, obj.at.z);
      this.marker.rotation.y += dt * 2;
    }

    const sel = s.drones[s.selected];
    const showImpact = s.player.mode === 'console' && sel && sel.state === 'hold';
    this.impact.visible = !!showImpact;
    if (showImpact) {
      const p = predictImpact(s, sel.pos, sel.vel);
      this.impact.position.set(p.x, 0.12, p.z);
    }
    this.updateCamera(s, dt);
    for (const l of this.labels) l.visible = this.camera.position.distanceTo(l.position) > 45;
  }

  private updateDrone(d: Drone, m: DroneMesh, dt: number) {
    const position = m.group.position;
    if (d.state !== 'pad' || m.speed > 0.01 || m.group.rotation.y !== d.yaw ||
        position.x !== d.pos.x || position.y !== d.pos.y || position.z !== d.pos.z) {
      this.pipeline.invalidateCasters();
    }
    position.set(d.pos.x, d.pos.y, d.pos.z);
    m.group.rotation.y = d.yaw;
    const spin = d.state === 'pad' ? 0 : d.state === 'down' ? 2 : 100;
    m.speed = THREE.MathUtils.damp(m.speed, spin, 6, dt);
    for (const { motor, prop, disc, direction } of m.rotors) {
      motor.rotation.y += m.speed * dt * direction;
      disc.visible = m.speed > 28;
      prop.visible = !disc.visible;
    }
    const local = new THREE.Vector3(d.vel.x, 0, d.vel.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -d.yaw);
    m.tilt.rotation.x += (local.z * 0.025 - m.tilt.rotation.x) * Math.min(1, dt * 4);
    m.tilt.rotation.z += (-local.x * 0.025 - m.tilt.rotation.z) * Math.min(1, dt * 4);
    if (d.state === 'down') m.tilt.rotation.z = 1.2;
    const now = performance.now(), blink = Math.sin(now / 120) > 0;
    m.led.emissive.setHex(d.fault ? (blink ? 0xff3b30 : 0x330000) : needsAttention(d) ? (blink ? 0xffd23f : 0x332a00) : 0x48ff8b);
    m.led.color.copy(m.led.emissive);
    const pulse = (now + d.idx * 310) % 1400;
    m.strobe.emissiveIntensity = pulse < 70 || (pulse > 145 && pulse < 200) ? 6 : 0.1;
    m.gauge.emissive.setHex(d.battery < FLIGHT.criticalBattery ? 0xff3b30 : d.battery < FLIGHT.lowBattery ? 0xffb020 : 0x48ff8b);
    m.gauge.color.copy(m.gauge.emissive);
    m.battery.scale.x = Math.max(0.1, d.battery / 100);
  }

  private updateCrates(s: Sim, dt: number) {
    const seen = new Set<number>();
    for (const o of s.orders) {
      let pos: THREE.Vector3 | null = null;
      if (o.status === 'loaded' || o.status === 'flying') {
        const pk = s.packages.find((p) => p.orderId === o.id);
        const d = s.drones.find((dr) => dr.orderId === o.id);
        if (pk) pos = new THREE.Vector3(pk.pos.x, Math.max(0.35, pk.pos.y), pk.pos.z);
        else if (d) pos = new THREE.Vector3(d.pos.x, d.pos.y + 0.36, d.pos.z);
      }
      let entry = this.crates.get(o.id);
      if (pos) {
        if (!entry) {
          entry = { mesh: this.crate(o.dest.id, o.dest.color, o.id), ttl: null };
          this.scene.add(entry.mesh);
          this.crates.set(o.id, entry);
        }
        entry.mesh.position.copy(pos);
        seen.add(o.id);
      } else if (entry && (o.status === 'delivered' || o.status === 'missed') && entry.ttl == null) {
        entry.ttl = 12;
        entry.mesh.position.y = 0.35;
        seen.add(o.id);
      } else if (entry && entry.ttl != null) {
        entry.ttl -= dt;
        if (entry.ttl > 0) seen.add(o.id);
      }
    }
    for (const [id, e] of this.crates) if (!seen.has(id)) { this.scene.remove(e.mesh); this.crates.delete(id); }
  }

  private updateCamera(s: Sim, dt: number) {
    const p = s.player;
    if (p.mode === 'walk' || s.phase === 'briefing') {
      this.camInit = false;
      this.bob += dt * 8;
      this.camera.position.set(p.x, 1.65, p.z);
      this.camera.rotation.set(p.pitch, p.yaw, 0);
      if (this.camera.fov !== 75) { this.camera.fov = 75; this.camera.updateProjectionMatrix(); }
      return;
    }
    const d = s.drones[s.selected];
    const want = new THREE.Vector3();
    const look = new THREE.Vector3();
    const pad = BASE.pads[d.idx];
    if (d.state === 'pad' || d.state === 'down') {
      want.set(d.pos.x + 3, 6, d.pos.z + 9);
      look.set(d.pos.x, 0.8, d.pos.z);
    } else if (d.state === 'hold' || d.state === 'approach' || d.state === 'landing' || d.fault === 'gps') {
      want.set(d.pos.x, d.pos.y + 15, d.pos.z + 5);
      look.set(d.pos.x, 0, d.pos.z - 1.5);
      if (d.state === 'landing') look.set(pad.x, 0, pad.z - 1.5), want.set(pad.x, d.pos.y + 13, pad.z + 5);
    } else {
      const sp = Math.hypot(d.vel.x, d.vel.z);
      const dir = sp > 0.5 ? new THREE.Vector3(d.vel.x / sp, 0, d.vel.z / sp) : new THREE.Vector3(-Math.sin(d.yaw), 0, -Math.cos(d.yaw));
      want.set(d.pos.x - dir.x * 9, d.pos.y + 3.5, d.pos.z - dir.z * 9);
      look.set(d.pos.x + dir.x * 12, d.pos.y - 2, d.pos.z + dir.z * 12);
    }
    if (!this.camInit) { this.camPos.copy(want); this.camLook.copy(look); this.camInit = true; }
    const k = 1 - Math.exp(-dt * 5);
    this.camPos.lerp(want, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    if (this.camera.fov !== 60) { this.camera.fov = 60; this.camera.updateProjectionMatrix(); }
  }

  /** Player-chosen setting ('auto' picks a tier from measured FPS) and the tier in effect. */
  get quality(): { setting: QualitySetting; tier: QualityTier } {
    return { setting: this.adaptive.setting, tier: this.adaptive.tier };
  }

  setQuality(setting: QualitySetting) {
    this.adaptive.select(setting);
    this.applyTier();
    saveQualitySetting(setting);
  }

  private applyTier() {
    const settings = TIERS[this.adaptive.tier];
    setTextureQuality(this.renderer, settings);
    this.terrain.setQuality(settings);
    this.pipeline.setTier(settings);
  }

  resetCamera() { this.camInit = false; }

  render(now = performance.now()) {
    const { tier, scale } = this.adaptive;
    this.adaptive.sample(now);
    if (tier !== this.adaptive.tier) this.applyTier();
    else if (scale !== this.adaptive.scale) this.pipeline.setScale(this.adaptive.scale);
    this.terrain.update(this.camera.position, TIERS[this.adaptive.tier]);
    this.pipeline.render();
  }
}
