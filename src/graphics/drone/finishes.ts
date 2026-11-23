import * as THREE from 'three';
import { brushedAluminium, canvasTex, carbonFibre, glossPlastic, KO_FONT, mattePlastic, rubber, seeded } from '../materials';

function makeFinishes() {
  return {
    carbon: carbonFibre(), nylon: mattePlastic(0x333c3e), shell: glossPlastic(0xc7c8be),
    gasket: rubber(0x191e20), rubber: rubber(0x262a2a), latch: mattePlastic(0xb35737),
    anodized: brushedAluminium(0x566063), titanium: brushedAluminium(0xadafae),
    sockets: brushedAluminium(0x737978), copper: brushedAluminium(0xd18a60), brass: brushedAluminium(0xc9a567),
  };
}

let shared: ReturnType<typeof makeFinishes> | undefined;
export function finishes() {
  return shared ??= makeFinishes();
}

export function paintedDeck(team: number, serial: string) {
  // The molded cover uses plan-projected UVs spanning 1 x 1.32 local units.
  const map = canvasTex(1024, 1280, g => {
    g.fillStyle = '#cecec4';
    g.fillRect(0, 0, 1024, 1280);
    const rnd = seeded(75);
    for (let i = 0; i < 3400; i++) {
      g.fillStyle = i % 2 ? 'rgba(82,78,65,.046)' : 'rgba(252,248,225,.12)';
      g.fillRect(rnd() * 1024, rnd() * 1280, 1 + rnd() * 1.7, 1);
    }
    // A swept field and hairline are screen printed onto the cover under the clear coat.
    const ribbon = (offset: number, width: number, paint: string) => {
      g.save(); g.translate(offset, 0);
      g.beginPath(); g.moveTo(370, 0); g.lineTo(370 + width, 0);
      g.bezierCurveTo(251 + width, 395, 174 + width, 679, 177 + width, 1280);
      g.lineTo(177, 1280); g.bezierCurveTo(174, 679, 251, 395, 370, 0);
      g.closePath(); g.fillStyle = paint; g.fill(); g.restore();
    };
    ribbon(-105, 106, new THREE.Color(team).getStyle());
    ribbon(18, 9, '#344344');
    g.fillStyle = '#273638';
    g.textAlign = 'center';
    g.font = `800 173px ${KO_FONT}`; g.fillText(serial, 556, 525);
    g.font = `bold 32px ${KO_FONT}`; g.fillText('하늘길 택배', 556, 578);
    // Localized rub marks around the leading shoulder and the removable pack.
    for (const [cx, cy] of [[270, 224], [740, 230], [181, 712], [655, 903], [324, 1047]]) {
      const grime = g.createRadialGradient(cx, cy, 4, cx, cy, 68);
      grime.addColorStop(0, 'rgba(94,83,61,.073)'); grime.addColorStop(1, 'rgba(94,83,61,0)');
      g.fillStyle = grime; g.fillRect(cx - 68, cy - 68, 136, 136);
      for (let i = 0; i < 14; i++) {
        const x = cx + (rnd() - 0.5) * 68, y = cy + (rnd() - 0.5) * 95;
        g.strokeStyle = i % 3 ? 'rgba(90,88,77,.15)' : 'rgba(246,242,227,.52)';
        g.lineWidth = 0.8 + rnd(); g.beginPath(); g.moveTo(x, y);
        g.lineTo(x + rnd() * 10 + 1, y - rnd() * 7); g.stroke();
      }
    }
  });
  const paint = finishes().shell.clone();
  paint.map = map;
  paint.color.setHex(0xffffff);
  return paint;
}

export function batteryPlate() {
  const map = canvasTex(512, 448, g => {
    g.fillStyle = '#bfc2b9'; g.fillRect(0, 0, 512, 448);
    g.fillStyle = '#293333'; g.fillRect(0, 0, 512, 100);
    g.fillStyle = '#ecebda'; g.font = `bold 46px ${KO_FONT}`; g.fillText('비행 전지', 24, 66);
    g.textAlign = 'right'; g.font = `bold 36px ${KO_FONT}`; g.fillText('B–06', 484, 65); g.textAlign = 'left';
    g.fillStyle = '#252e2e'; g.font = `bold 63px ${KO_FONT}`; g.fillText('48 V', 23, 179);
    g.font = `bold 32px ${KO_FONT}`; g.fillText('교환형 배터리', 24, 227);
    g.fillRect(24, 249, 464, 3);
    g.font = `27px ${KO_FONT}`; g.fillText('단자 접촉 주의', 24, 301);
    let x = 24;
    const rnd = seeded(810);
    while (x < 322) {
      const width = 2 + Math.floor(rnd() * 6);
      g.fillRect(x, 337, width, 72); x += width + 2 + Math.floor(rnd() * 4);
    }
    g.strokeStyle = '#384342'; g.lineWidth = 7; g.beginPath();
    g.moveTo(420, 323); g.lineTo(468, 406); g.lineTo(372, 406); g.closePath(); g.stroke();
    g.fillRect(416, 349, 8, 31); g.fillRect(416, 389, 8, 8);
  });
  return new THREE.MeshStandardMaterial({ map, roughness: 0.61, metalness: 0.12 });
}
