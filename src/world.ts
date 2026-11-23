import * as THREE from 'three';
import { BASE, FLIGHT } from './config';
import { needsAttention, objective, predictImpact, type Drone, type Sim } from './sim';
import { buildDepot } from './graphics/depot';
import { buildDestinations } from './graphics/destinations';
import { batteryPack, droneModel, type DroneMesh } from './graphics/drone';
import { KO_FONT, box, canvasTex, finish, ink, surfaces, type Surfaces } from './graphics/materials';
import { Pipeline } from './graphics/pipeline';
import { buildTerrain } from './graphics/terrain';

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1500);
  private pipeline: Pipeline;
  private materials: Surfaces;
  private drones: DroneMesh[] = [];
  private labels: THREE.Sprite[];
  private crates = new Map<number, { mesh: THREE.Group; ttl: number | null }>();
  private crateModels = new Map<string, THREE.Group>();
  private held = new THREE.Group();
  private heldCrate = new THREE.Group();
  private heldBattery: THREE.Group;
  private marker: THREE.Mesh;
  private impact: THREE.Mesh;
  private padOffline: THREE.Mesh;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  private bob = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.pipeline = new Pipeline(this.renderer, this.camera, this.scene);
    this.materials = surfaces(this.renderer);
    this.camera.rotation.order = 'YXZ';
    buildTerrain(this.scene, this.materials);
    const marks = this.pipeline.markings;
    buildDepot(this.scene, marks, this.materials);
    this.labels = buildDestinations(this.scene, marks, this.materials);

    this.heldCrate.scale.setScalar(0.8);
    this.heldBattery = batteryPack(this.materials.metal);
    this.held.add(this.heldCrate, this.heldBattery);
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
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline.resize(w, h);
  }

  private crate(code: string, color: number) {
    let model = this.crateModels.get(code);
    if (!model) {
      model = new THREE.Group();
      const wood = this.materials.wood;
      box(model, 0.66, 0.67, 0.66, wood, 0, 0, 0);
      for (const side of [-1, 1]) for (const edge of [-1, 1]) {
        box(model, 0.70, 0.062, 0.036, wood, 0, edge * 0.319, side * 0.332);
        box(model, 0.036, 0.062, 0.65, wood, side * 0.332, edge * 0.319, 0);
      }
      const band = finish(color, 0.63);
      box(model, 0.664, 0.075, 0.664, band, 0, 0.155, 0);
      const sticker = canvasTex(256, 192, g => {
        g.fillStyle = '#f3efe1'; g.fillRect(0, 0, 256, 192);
        g.fillStyle = new THREE.Color(color).getStyle(); g.fillRect(0, 0, 256, 33);
        g.fillStyle = '#1b2528'; g.textAlign = 'center'; g.font = `bold 21px ${KO_FONT}`;
        g.fillText('하늘길 택배', 128, 25);
        g.font = `bold 97px ${KO_FONT}`; g.fillText(code, 128, 129);
        for (let x = 30; x < 226; x += 5) g.fillRect(x, 145, 1 + (x * 7 % 4), 28);
      });
      const paper = new THREE.MeshStandardMaterial({ map: sticker, roughness: 0.86 });
      const decal = new THREE.PlaneGeometry(0.43, 0.323);
      for (let side = 0; side < 4; side++) {
        const a = side * Math.PI / 2;
        const label = new THREE.Mesh(decal, paper);
        label.rotation.y = a;
        label.position.set(Math.sin(a) * 0.334, -0.018, Math.cos(a) * 0.334);
        label.receiveShadow = true;
        model.add(label);
      }
      this.crateModels.set(code, model);
    }
    return model.clone();
  }

  update(s: Sim, dt: number) {
    while (this.drones.length < s.drones.length) {
      const drone = droneModel(this.drones.length, this.materials);
      this.scene.add(drone.group);
      this.drones.push(drone);
    }
    this.drones.forEach((drone, i) => { drone.group.visible = i < s.drones.length; });
    this.padOffline.visible = s.stage.drones < 2;
    s.drones.forEach((d, i) => this.updateDrone(d, this.drones[i], dt));
    this.updateCrates(s, dt);

    const carry = s.player.carrying;
    this.held.visible = s.player.mode === 'walk' && carry != null;
    this.heldBattery.visible = carry?.kind === 'battery';
    this.heldCrate.visible = carry?.kind === 'crate';
    if (carry?.kind === 'crate') {
      const o = s.orders.find((or) => or.id === carry.orderId);
      if (o && this.heldCrate.name !== o.dest.id) {
        this.heldCrate.clear();
        this.heldCrate.add(this.crate(o.dest.id, o.dest.color));
        this.heldCrate.name = o.dest.id;
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
    m.group.position.set(d.pos.x, d.pos.y, d.pos.z);
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
      if (o.status === 'waiting' && o.slot != null) {
        const sl = BASE.shelfSlots[o.slot];
        pos = new THREE.Vector3(sl.x, 1.0, sl.z);
      } else if (o.status === 'loaded' || o.status === 'flying') {
        const pk = s.packages.find((p) => p.orderId === o.id);
        const d = s.drones.find((dr) => dr.orderId === o.id);
        if (pk) pos = new THREE.Vector3(pk.pos.x, Math.max(0.35, pk.pos.y), pk.pos.z);
        else if (d) pos = new THREE.Vector3(d.pos.x, d.pos.y + 0.36, d.pos.z);
      }
      let entry = this.crates.get(o.id);
      if (pos) {
        if (!entry) {
          entry = { mesh: this.crate(o.dest.id, o.dest.color), ttl: null };
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

  resetCamera() { this.camInit = false; }

  render() { this.pipeline.render(); }
}
