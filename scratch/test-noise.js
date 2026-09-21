// Quick test for spherical noise generation performance
function testNoise() {
  const t0 = Date.now();
  const W = 1024, H = 512;
  const buffer = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const phi = (0.5 - y / H) * Math.PI;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    for (let x = 0; x < W; x++) {
      const theta = (x / W - 0.5) * 2 * Math.PI;
      const px = cosPhi * Math.cos(theta);
      const py = sinPhi;
      const pz = cosPhi * Math.sin(theta);
      
      const idx = (y * W + x) * 4;
      const val = Math.floor((px * 0.5 + 0.5) * 255);
      buffer[idx] = val;
      buffer[idx + 1] = val;
      buffer[idx + 2] = val;
      buffer[idx + 3] = 255;
    }
  }
  const dt = Date.now() - t0;
  console.log(`Generated ${W}x${H} in ${dt}ms`);
}
testNoise();
