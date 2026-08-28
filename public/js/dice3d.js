// CSS 3D dice: a real cube (6 faces, fixed pips per face) that spins to
// bring the correct face forward on every roll.

// front=1, back=6, right=3, left=4, top=2, bottom=5 (opposite faces sum to 7)
const FACE_DEFS = [
  { value: 1, cls: 'f-front' },
  { value: 6, cls: 'f-back' },
  { value: 3, cls: 'f-right' },
  { value: 4, cls: 'f-left' },
  { value: 2, cls: 'f-top' },
  { value: 5, cls: 'f-bottom' },
];

// Rotation (deg) that brings each value's face to the front, derived from
// the placements above. A small constant tilt is baked in so the cube never
// sits perfectly flat-on — it always reads as a 3D object with a visible
// top/side edge, even at rest.
const TILT = { x: -16, y: 20 };
const BASE_ROTATION = {
  1: { x: 0, y: 0 },
  2: { x: 90, y: 0 },
  3: { x: 0, y: -90 },
  4: { x: 0, y: 90 },
  5: { x: -90, y: 0 },
  6: { x: 0, y: 180 },
};
const SHOW_ROTATION = Object.fromEntries(
  Object.entries(BASE_ROTATION).map(([k, v]) => [k, { x: v.x + TILT.x, y: v.y + TILT.y }])
);

const PIP_LAYOUT = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

function buildFace(def) {
  const face = document.createElement('div');
  face.className = `die-face ${def.cls}`;
  for (let i = 1; i <= 9; i++) {
    const pip = document.createElement('span');
    pip.className = 'pip';
    if (PIP_LAYOUT[def.value].includes(i)) pip.classList.add('on');
    face.appendChild(pip);
  }
  return face;
}

export function createDie(mount) {
  const scene = document.createElement('div');
  scene.className = 'die-scene';
  const cube = document.createElement('div');
  cube.className = 'die';
  FACE_DEFS.forEach((def) => cube.appendChild(buildFace(def)));
  scene.appendChild(cube);
  mount.appendChild(scene);

  let cur = { x: 0, y: 0 };
  cube.style.transform = 'rotateX(0deg) rotateY(0deg)';

  return {
    el: scene,
    setValue(value, { animate = true } = {}) {
      const target = SHOW_ROTATION[value] || SHOW_ROTATION[1];
      const spins = animate ? 2 + Math.floor(Math.random() * 2) : 0;
      const baseX = Math.floor(cur.x / 360) * 360;
      const baseY = Math.floor(cur.y / 360) * 360;
      const nextX = baseX + spins * 360 * (Math.random() < 0.5 ? 1 : -1) + target.x;
      const nextY = baseY + spins * 360 * (Math.random() < 0.5 ? 1 : -1) + target.y;
      cube.style.transition = animate
        ? 'transform .65s cubic-bezier(.34,1.56,.64,1)'
        : 'none';
      cube.style.transform = `rotateX(${nextX}deg) rotateY(${nextY}deg)`;
      cur = { x: nextX, y: nextY };
    },
    setHeld(held) {
      scene.classList.toggle('held', !!held);
    },
  };
}
