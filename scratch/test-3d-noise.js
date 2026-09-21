// Test 3D noise and spherical projection
const W = 512, H = 256;

// 3D Simplex-like fast gradient noise
const p = new Uint8Array(512);
for (let i = 0; i < 256; i++) p[i] = p[i + 256] = Math.floor(Math.random() * 256);

function grad3(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function noise3D(x, y, z) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const fz = z - Math.floor(z);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);

  const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
  const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;

  return (1 + (
    (1 - w) * (
      (1 - v) * ((1 - u) * grad3(p[AA], fx, fy, fz) + u * grad3(p[BA], fx - 1, fy, fz)) +
      v * ((1 - u) * grad3(p[AB], fx, fy - 1, fz) + u * grad3(p[BB], fx - 1, fy - 1, fz))
    ) +
    w * (
      (1 - v) * ((1 - u) * grad3(p[AA + 1], fx, fy, fz - 1) + u * grad3(p[BA + 1], fx - 1, fy, fz - 1)) +
      v * ((1 - u) * grad3(p[AB + 1], fx, fy - 1, fz - 1) + u * grad3(p[BB + 1], fx - 1, fy - 1, fz - 1))
    )
  )) * 0.5;
}

function fbm(x, y, z, octaves = 5) {
  let val = 0, amp = 0.5, freq = 1.0, max = 0;
  for (let i = 0; i < octaves; i++) {
    val += noise3D(x * freq, y * freq, z * freq) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return val / max;
}

const t0 = Date.now();
let sum = 0;
for (let y = 0; y < H; y++) {
  const phi = (0.5 - y / H) * Math.PI;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  for (let x = 0; x < W; x++) {
    const theta = (x / W - 0.5) * 2 * Math.PI;
    const px = cosP * Math.cos(theta);
    const py = sinP;
    const pz = cosP * Math.sin(theta);
    sum += fbm(px * 3, py * 3, pz * 3, 4);
  }
}
console.log(`Computed 512x256 3D fBm in ${Date.now() - t0}ms, avg=${sum / (W * H)}`);
