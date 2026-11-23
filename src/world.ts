import * as THREE from 'three';
import { BASE, DESTINATIONS, FLIGHT } from './config';
import { needsAttention, objective, predictImpact, type Drone, type Sim } from './sim';

const DRONE_COLORS = [0xff8a3d, 0x3dd6ff];

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, base: string, n: number, colors: string[]) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i % colors.length];
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

function labelTex(text: string, sub: string, color: number) {
  return canvasTex(512, 160, (g) => {
    g.fillStyle = 'rgba(10,16,24,0.85)';
    g.beginPath();
    g.roundRect(4, 4, 504, 152, 18);
    g.fill();
    g.fillStyle = hex(color);
    g.fillRect(4, 4, 18, 152);
    g.fillStyle = '#fff';
    g.font = 'bold 64px system-ui, sans-serif';
    g.fillText(text, 44, 76);
    g.font = '40px system-ui, sans-serif';
    g.fillStyle = '#cfe3f0';
    g.fillText(sub, 44, 132);
  });
}

function crateTex(code: string, color: number) {
  return canvasTex(128, 128, (g) => {
    speckle(g, 128, 128, '#b8894f', 300, ['#a77a43', '#c99b5f']);
    g.strokeStyle = '#7a5528';
    g.lineWidth = 8;
    g.strokeRect(4, 4, 120, 120);
    g.fillStyle = hex(color);
    g.fillRect(18, 34, 92, 60);
    g.fillStyle = '#111';
    g.font = 'bold 44px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(code, 64, 80);
  });
}

interface DroneMesh { group: THREE.Group; tilt: THREE.Group; rotors: THREE.Mesh[]; led: THREE.MeshBasicMaterial; shadow: THREE.Mesh; battery: THREE.Mesh }

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1500);
  private drones: DroneMesh[] = [];
  private labels: THREE.Sprite[] = [];
  private crates = new Map<number, { mesh: THREE.Mesh; ttl: number | null }>();
  private crateGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
  private crateMats = new Map<string, THREE.Material[]>();
  private held = new THREE.Group();
  private heldCrate: THREE.Mesh;
  private heldBattery: THREE.Group;
  private marker: THREE.Mesh;
  private impact: THREE.Mesh;
  private padOffline: THREE.Mesh;
  private shadowTex: THREE.Texture;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  private bob = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.scene.background = canvasTex(4, 256, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#4a86c5');
      gr.addColorStop(0.6, '#a9d0ec');
      gr.addColorStop(1, '#e6efe8');
      g.fillStyle = gr;
      g.fillRect(0, 0, 4, 256);
    });
    this.scene.fog = new THREE.Fog(0xc9dde8, 120, 520);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x5b6b4a, 1.6));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
    sun.position.set(80, 140, 40);
    this.scene.add(sun);
    this.shadowTex = canvasTex(64, 64, (g) => {
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      gr.addColorStop(0, 'rgba(0,0,0,0.6)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
    });

    this.buildTerrain();
    this.buildBase();
    this.buildDestinations();

    this.heldCrate = new THREE.Mesh(this.crateGeo, new THREE.MeshLambertMaterial({ color: 0xb8894f }));
    this.heldCrate.scale.setScalar(0.8);
    this.heldBattery = this.batteryMesh();
    this.held.add(this.heldCrate, this.heldBattery);
    this.held.position.set(0.32, -0.42, -0.85);
    this.camera.add(this.held);
    this.scene.add(this.camera);

    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 4), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    this.marker.rotation.x = Math.PI;
    this.scene.add(this.marker);

    this.impact = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.35, 32), new THREE.MeshBasicMaterial({ color: 0xff3df0, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false }));
    this.impact.rotation.x = -Math.PI / 2;
    this.impact.renderOrder = 10;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.25, 16), this.impact.material);
    dot.renderOrder = 10;
    this.impact.add(dot);
    this.scene.add(this.impact);

    this.padOffline = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({
      map: canvasTex(128, 128, (g) => { g.strokeStyle = '#e53935'; g.lineWidth = 14; g.beginPath(); g.moveTo(14, 14); g.lineTo(114, 114); g.moveTo(114, 14); g.lineTo(14, 114); g.stroke(); }),
      transparent: true, depthWrite: false,
    }));
    this.padOffline.rotation.x = -Math.PI / 2;
    this.padOffline.position.set(BASE.pads[1].x, 0.08, BASE.pads[1].z);
    this.scene.add(this.padOffline);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ building

  private buildTerrain() {
    const grass = canvasTex(256, 256, (g) => speckle(g, 256, 256, '#6f9a4f', 4000, ['#5f8a43', '#7eaa5b', '#668f48']), [120, 120]);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshLambertMaterial({ map: grass }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const roadMat = new THREE.MeshLambertMaterial({ color: 0x4a4f55 });
    for (const d of DESTINATIONS) {
      const full = Math.hypot(d.x, d.z);
      const len = full - 24;
      const road = new THREE.Mesh(new THREE.PlaneGeometry(5, len), roadMat);
      const mid = (24 + full) / 2 / full;
      road.position.set(d.x * mid, 0.02, d.z * mid);
      road.rotation.set(-Math.PI / 2, 0, 0);
      road.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.atan2(-d.x, -d.z));
      this.scene.add(road);
    }

    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const facade = canvasTex(128, 256, (g) => {
      g.fillStyle = '#d9d4c8';
      g.fillRect(0, 0, 128, 256);
      for (let y = 10; y < 256; y += 28) for (let x = 10; x < 128; x += 30) {
        g.fillStyle = Math.random() < 0.3 ? '#f4e2a1' : '#5b7590';
        g.fillRect(x, y, 18, 16);
      }
    });
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0);
    const bldgs = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ map: facade }), 240);
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2, 6);
    trunkGeo.translate(0, 1, 0);
    const leafGeo = new THREE.ConeGeometry(1.8, 4.5, 7);
    leafGeo.translate(0, 4, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6b4a2f }), 420);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0x3f7a3a }), 420);
    const m = new THREE.Matrix4();
    const tint = new THREE.Color();
    const clear = (x: number, z: number, r: number) => DESTINATIONS.every((d) => Math.hypot(d.x - x, d.z - z) > r) && Math.hypot(x, z) > 45;
    let b = 0;
    for (let tries = 0; b < 240 && tries < 5000; tries++) {
      const a = rnd() * Math.PI * 2;
      const r = 55 + rnd() * 300;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!clear(x, z, 26)) continue;
      const w = 6 + rnd() * 10;
      const nearDest = !clear(x, z, 60);
      const h = Math.min(nearDest ? 11 : 22, 4 + rnd() * rnd() * 18);
      m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 3), new THREE.Vector3(w, h, 6 + rnd() * 10));
      bldgs.setMatrixAt(b, m);
      bldgs.setColorAt(b, tint.setHSL(0.08 + rnd() * 0.1, 0.15, 0.7 + rnd() * 0.25));
      b++;
    }
    bldgs.count = b;
    let t = 0;
    for (let tries = 0; t < 420 && tries < 5000; tries++) {
      const x = (rnd() - 0.5) * 700;
      const z = (rnd() - 0.5) * 700;
      if (Math.hypot(x, z) < 26 || DESTINATIONS.some((d) => Math.hypot(d.x - x, d.z - z) < 12)) continue;
      const s = 0.7 + rnd() * 0.8;
      m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(t, m);
      leaves.setMatrixAt(t, m);
      t++;
    }
    trunks.count = leaves.count = t;
    this.scene.add(bldgs, trunks, leaves);
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    return mesh;
  }

  private batteryMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.5, 0.2), new THREE.MeshLambertMaterial({ color: 0x2b3440 }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.12, 0.21), new THREE.MeshBasicMaterial({ color: 0x48ff8b }));
    band.position.y = 0.12;
    g.add(body, band);
    return g;
  }

  private buildBase() {
    const h = BASE.hangar;
    const concrete = canvasTex(256, 256, (g) => {
      speckle(g, 256, 256, '#8d9298', 3000, ['#80858b', '#9aa0a6']);
      g.strokeStyle = '#6f7479';
      g.lineWidth = 2;
      g.strokeRect(0, 0, 256, 256);
    }, [10, 10]);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(40, 32), new THREE.MeshLambertMaterial({ map: concrete }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(0, 0.01, 6.5);
    this.scene.add(apron);
    const floorTex = canvasTex(256, 256, (g) => {
      speckle(g, 256, 256, '#5d6670', 2000, ['#56606a', '#66707a']);
      g.fillStyle = '#e8c547';
      g.fillRect(0, 120, 256, 6);
    }, [6, 4]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(h.maxX - h.minX, h.maxZ - h.minZ), new THREE.MeshLambertMaterial({ map: floorTex }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.02, (h.minZ + h.maxZ) / 2);
    this.scene.add(floor);

    const wallMat = new THREE.MeshLambertMaterial({ color: 0xc7cdd3 });
    const trim = new THREE.MeshLambertMaterial({ color: 0x2f3a46 });
    const H = 5.5;
    const midZ = (h.minZ + h.maxZ) / 2;
    const depth = h.maxZ - h.minZ;
    this.box(0.4, H, depth, wallMat, h.minX, H / 2, midZ);
    this.box(0.4, H, depth, wallMat, h.maxX, H / 2, midZ);
    this.box(h.maxX - h.minX, H, 0.4, wallMat, 0, H / 2, h.minZ);
    this.box(5.5, H, 0.4, wallMat, -9.25, H / 2, h.maxZ);
    this.box(5.5, H, 0.4, wallMat, 9.25, H / 2, h.maxZ);
    this.box(13, 1.5, 0.4, wallMat, 0, H - 0.75, h.maxZ);
    this.box(0.5, H, 0.6, trim, -6.5, H / 2, h.maxZ);
    this.box(0.5, H, 0.6, trim, 6.5, H / 2, h.maxZ);
    const roof = this.box(h.maxX - h.minX + 1, 0.3, depth + 1, new THREE.MeshLambertMaterial({ color: 0x7d8792 }), 0, H + 0.15, midZ);
    roof.name = 'roof';
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff7e0 });
    for (const z of [-6, -1, 4]) this.box(10, 0.08, 0.4, lightMat, 0, H - 0.05, z);
    const inner = new THREE.PointLight(0xfff1d6, 30, 30, 1.4);
    inner.position.set(0, 4.5, -1);
    this.scene.add(inner);

    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.2), new THREE.MeshBasicMaterial({ map: labelTex('SKYHOOK DEPOT', 'Drone delivery · Bay 01', 0xffd23f) }));
    sign.position.set(0, H - 0.75, h.maxZ + 0.22);
    this.scene.add(sign);

    // cargo shelf
    const shelfMat = new THREE.MeshLambertMaterial({ color: 0x3466a8 });
    const plate = new THREE.MeshLambertMaterial({ color: 0x9aa3ad });
    this.box(1.6, 0.08, 10, plate, -11.1, 0.62, -1.2);
    this.box(1.6, 0.08, 10, plate, -11.1, 1.9, -1.2);
    for (const z of [-6.2, -3.75, -1.25, 1.25, 3.75]) this.box(1.6, 2.6, 0.12, shelfMat, -11.1, 1.3, z);
    const shelfSign = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75), new THREE.MeshBasicMaterial({ map: labelTex('CARGO', 'Outgoing orders', 0x4fc3f7) }));
    shelfSign.position.set(-11.75, 3.3, -1.2);
    shelfSign.rotation.y = Math.PI / 2;
    this.scene.add(shelfSign);
    BASE.shelfSlots.forEach((p) => {
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.22), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
      tag.position.set(p.x + 0.82, 0.45, p.z);
      tag.rotation.y = Math.PI / 2;
      this.scene.add(tag);
    });

    // battery rack
    this.box(1.5, 1.6, 2.6, new THREE.MeshLambertMaterial({ color: 0x39424d }), 11.15, 0.8, BASE.batteryRack.z);
    for (let i = 0; i < 4; i++) {
      const b = this.batteryMesh();
      b.position.set(10.45, 1.85, BASE.batteryRack.z - 0.9 + i * 0.6);
      b.rotation.y = Math.PI / 2;
      this.scene.add(b);
    }
    const rackSign = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75), new THREE.MeshBasicMaterial({ map: labelTex('CHARGING', 'Fresh batteries', 0x48ff8b) }));
    rackSign.position.set(11.75, 3.2, BASE.batteryRack.z);
    rackSign.rotation.y = -Math.PI / 2;
    this.scene.add(rackSign);

    // console
    this.box(5.6, 0.9, 0.9, new THREE.MeshLambertMaterial({ color: 0x2a313a }), 0, 0.45, -8.55);
    const screen = new THREE.MeshBasicMaterial({ map: canvasTex(256, 160, (g) => {
      g.fillStyle = '#071a24'; g.fillRect(0, 0, 256, 160);
      g.strokeStyle = '#2ee6a6'; g.lineWidth = 2;
      for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(128, 80, 12 + i * 12, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = '#2ee6a6'; g.font = 'bold 22px monospace'; g.fillText('FLIGHT OPS', 8, 24);
    }) });
    for (const [x, ry] of [[-1.8, 0.25], [0, 0], [1.8, -0.25]] as const) {
      const mon = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), screen);
      mon.position.set(x, 1.6, -8.75);
      mon.rotation.y = ry;
      this.scene.add(mon);
      this.box(1.7, 1.1, 0.06, trim, x, 1.6, -8.8).rotation.y = ry;
    }
    const opsSign = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75), new THREE.MeshBasicMaterial({ map: labelTex('CONTROL', 'Launch · Drop · Land', 0xff8a3d) }));
    opsSign.position.set(0, 3.1, -8.75);
    this.scene.add(opsSign);

    // pads
    const padTex = canvasTex(256, 256, (g) => {
      g.fillStyle = '#2b3036'; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = '#ffd23f'; g.lineWidth = 10;
      g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#ffffff'; g.font = 'bold 150px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('H', 128, 180);
    });
    BASE.pads.forEach((p, i) => {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.5, 0.1, 40), [new THREE.MeshLambertMaterial({ color: 0x2b3036 }), new THREE.MeshLambertMaterial({ map: padTex }), new THREE.MeshLambertMaterial({ color: 0x2b3036 })]);
      pad.position.set(p.x, 0.05, p.z);
      this.scene.add(pad);
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.6), new THREE.MeshBasicMaterial({ map: labelTex(`PAD ${i + 1}`, 'Drone ' + (i + 1), DRONE_COLORS[i]) }));
      lbl.position.set(p.x, 1.6, p.z + 3.2);
      this.scene.add(lbl);
      this.box(0.1, 1.3, 0.1, trim, p.x, 0.65, p.z + 3.2);
    });

    // fence
    const B = BASE.bounds;
    const post = new THREE.MeshLambertMaterial({ color: 0x9aa3ad });
    for (let x = B.minX; x <= B.maxX; x += 2.5) this.box(0.1, 1.2, 0.1, post, x, 0.6, B.maxZ + 0.5);
    for (let z = h.maxZ; z <= B.maxZ; z += 2.5) { this.box(0.1, 1.2, 0.1, post, B.minX - 0.5, 0.6, z); this.box(0.1, 1.2, 0.1, post, B.maxX + 0.5, 0.6, z); }
    this.box(B.maxX - B.minX + 1, 0.06, 0.06, post, 0, 1.1, B.maxZ + 0.5);
    this.box(0.06, 0.06, B.maxZ - h.maxZ, post, B.minX - 0.5, 1.1, (B.maxZ + h.maxZ) / 2);
    this.box(0.06, 0.06, B.maxZ - h.maxZ, post, B.maxX + 0.5, 1.1, (B.maxZ + h.maxZ) / 2);
  }

  private buildDestinations() {
    for (const d of DESTINATIONS) {
      const rings: [number, number, number, number][] = [[7.6, 9, 0xffffff, 0.55], [3.8, 5, d.color, 0.9], [0, 2, 0xffffff, 0.45]];
      for (const [r0, r1, c, o] of rings) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 48), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(d.x, 0.06, d.z);
        this.scene.add(ring);
      }
      const ang = Math.atan2(d.z, d.x);
      const hx = d.x + Math.cos(ang) * 15;
      const hz = d.z + Math.sin(ang) * 15;
      const house = this.box(9, 5, 8, new THREE.MeshLambertMaterial({ color: 0xe8e1d4 }), hx, 2.5, hz);
      house.rotation.y = -ang;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(7, 3, 4), new THREE.MeshLambertMaterial({ color: d.color }));
      roof.position.set(hx, 6.5, hz);
      roof.rotation.y = Math.PI / 4 - ang;
      this.scene.add(roof);
      this.box(0.3, 14, 0.3, new THREE.MeshLambertMaterial({ color: 0xdddddd }), d.x + 10.5, 7, d.z);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({ color: d.color }));
      beacon.position.set(d.x + 10.5, 14.5, d.z);
      this.scene.add(beacon);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(d.id, d.name, d.color), depthTest: false, fog: false, sizeAttenuation: false }));
      sprite.scale.set(0.16, 0.05, 1);
      sprite.position.set(d.x, 22, d.z);
      sprite.renderOrder = 5;
      this.scene.add(sprite);
      this.labels.push(sprite);
    }
  }

  private makeDrone(i: number): DroneMesh {
    const group = new THREE.Group();
    const tilt = new THREE.Group();
    group.add(tilt);
    const dark = new THREE.MeshLambertMaterial({ color: 0x23282f });
    const accent = new THREE.MeshLambertMaterial({ color: DRONE_COLORS[i] });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.32, 1.1), dark);
    body.position.y = 0.55;
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.9), accent);
    shell.position.y = 0.77;
    tilt.add(body, shell);
    const rotors: THREE.Mesh[] = [];
    const rotorGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.02, 20);
    const rotorMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.45 });
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 1.15), dark);
      arm.position.set(sx * 0.42, 0.6, sz * 0.42);
      arm.rotation.y = (sx * sz > 0 ? 1 : -1) * Math.PI / 4;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.18, 8), accent);
      hub.position.set(sx * 0.82, 0.68, sz * 0.82);
      const rotor = new THREE.Mesh(rotorGeo, rotorMat);
      rotor.position.set(sx * 0.82, 0.8, sz * 0.82);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.015, 0.08), dark);
      rotor.add(blade);
      tilt.add(arm, hub, rotor);
      rotors.push(rotor);
    }
    for (const sx of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.1), dark);
      skid.position.set(sx * 0.38, 0.05, 0);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.05), dark);
      leg.position.set(sx * 0.38, 0.25, 0);
      tilt.add(skid, leg);
    }
    const led = new THREE.MeshBasicMaterial({ color: 0x48ff8b });
    const ledMesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), led);
    ledMesh.position.set(0, 0.6, -0.58);
    tilt.add(ledMesh);
    const battery = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.3), new THREE.MeshBasicMaterial({ color: 0x48ff8b }));
    battery.position.set(0, 0.86, 0.25);
    tilt.add(battery);
    group.scale.setScalar(1.4);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    this.scene.add(group, shadow);
    return { group, tilt, rotors, led, shadow, battery };
  }

  // ------------------------------------------------------------ per frame

  private crateMat(code: string, color: number) {
    let m = this.crateMats.get(code);
    if (!m) {
      const face = new THREE.MeshLambertMaterial({ map: crateTex(code, color) });
      m = [face, face, face, face, face, face];
      this.crateMats.set(code, m);
    }
    return m;
  }

  update(s: Sim, dt: number) {
    while (this.drones.length < s.drones.length) this.drones.push(this.makeDrone(this.drones.length));
    while (this.drones.length > s.drones.length) {
      const d = this.drones.pop()!;
      this.scene.remove(d.group, d.shadow);
    }
    this.padOffline.visible = s.stage.drones < 2;
    s.drones.forEach((d, i) => this.updateDrone(d, this.drones[i], dt));
    this.updateCrates(s, dt);

    const carry = s.player.carrying;
    this.held.visible = s.player.mode === 'walk' && carry != null;
    this.heldBattery.visible = carry?.kind === 'battery';
    this.heldCrate.visible = carry?.kind === 'crate';
    if (carry?.kind === 'crate') {
      const o = s.orders.find((or) => or.id === carry.orderId);
      if (o) this.heldCrate.material = this.crateMat(o.dest.id, o.dest.color);
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
    const spin = d.state === 'pad' ? 0 : d.state === 'down' ? 2 : 40;
    m.rotors.forEach((r, i) => (r.rotation.y += spin * dt * (i % 2 ? 1 : -1)));
    const local = new THREE.Vector3(d.vel.x, 0, d.vel.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -d.yaw);
    m.tilt.rotation.x += (local.z * 0.025 - m.tilt.rotation.x) * Math.min(1, dt * 4);
    m.tilt.rotation.z += (-local.x * 0.025 - m.tilt.rotation.z) * Math.min(1, dt * 4);
    if (d.state === 'down') m.tilt.rotation.z = 1.2;
    const blink = Math.sin(performance.now() / 120) > 0;
    m.led.color.setHex(d.fault ? (blink ? 0xff3b30 : 0x330000) : needsAttention(d) ? (blink ? 0xffd23f : 0x332a00) : 0x48ff8b);
    const b = d.battery / 100;
    (m.battery.material as THREE.MeshBasicMaterial).color.setHex(d.battery < FLIGHT.criticalBattery ? 0xff3b30 : d.battery < FLIGHT.lowBattery ? 0xffb020 : 0x48ff8b);
    m.battery.scale.x = Math.max(0.1, b);
    m.shadow.position.set(d.pos.x, 0.07, d.pos.z);
    const sc = 1 + d.pos.y * 0.03;
    m.shadow.scale.set(sc, sc, 1);
    (m.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 1 - d.pos.y / 40);
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
          entry = { mesh: new THREE.Mesh(this.crateGeo, this.crateMat(o.dest.id, o.dest.color)), ttl: null };
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

  render() { this.renderer.render(this.scene, this.camera); }
}
