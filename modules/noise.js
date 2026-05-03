// Simplex noise and utility functions
export function mod289Vector3(x, y, z) {
  return [x - Math.floor(x * (1 / 289)) * 289, y - Math.floor(y * (1 / 289)) * 289, z - Math.floor(z * (1 / 289)) * 289];
}

export function mod289Vector4(values) {
  return values.map(value => value - Math.floor(value * (1 / 289)) * 289);
}

export function permuteVector4(values) {
  return mod289Vector4(values.map(value => ((value * 34) + 1) * value));
}

export function simplexNoise3D(x, y, z) {
  const Cx = 1 / 6;
  const Cy = 1 / 3;

  const i0 = Math.floor(x + (x + y + z) * Cy);
  const j0 = Math.floor(y + (x + y + z) * Cy);
  const k0 = Math.floor(z + (x + y + z) * Cy);

  const t = (i0 + j0 + k0) * Cx;
  const x0 = x - i0 + t;
  const y0 = y - j0 + t;
  const z0 = z - k0 + t;

  let i1 = 0, j1 = 0, k1 = 0;
  let i2 = 0, j2 = 0, k2 = 0;

  if (x0 >= y0) {
    if (y0 >= z0) {
      i1 = 1; i2 = 1; j2 = 1;
    } else if (x0 >= z0) {
      i1 = 1; i2 = 1; k2 = 1;
    } else {
      k1 = 1; i2 = 1; k2 = 1;
    }
  } else {
    if (y0 < z0) {
      k1 = 1; j2 = 1; k2 = 1;
    } else if (x0 < z0) {
      j1 = 1; j2 = 1; k2 = 1;
    } else {
      j1 = 1; i2 = 1; j2 = 1;
    }
  }

  const x1 = x0 - i1 + Cx;
  const y1 = y0 - j1 + Cx;
  const z1 = z0 - k1 + Cx;
  const x2 = x0 - i2 + Cy;
  const y2 = y0 - j2 + Cy;
  const z2 = z0 - k2 + Cy;
  const x3 = x0 - 0.5;
  const y3 = y0 - 0.5;
  const z3 = z0 - 0.5;

  const ii = i0 % 289;
  const jj = j0 % 289;
  const kk = k0 % 289;

  const p = permuteVector4(permuteVector4(permuteVector4([
    kk + 0,
    kk + k1,
    kk + k2,
    kk + 1
  ]).map(value => value + jj + 0).map((value, index) => value + [0, j1, j2, 1][index])).map(value => value + ii + 0).map((value, index) => value + [0, i1, i2, 1][index]));

  const ns = [1 / 7 * 2 - 0, 1 / 7 * 3 - 1, 1 / 7 * 4 - 2];
  const n_ = 1 / 7;

  const j = p.map(value => value - 49 * Math.floor(value * n_ * n_));
  const x_ = j.map(value => Math.floor(value * n_));
  const y_ = j.map((value, index) => Math.floor(value - 7 * x_[index]));

  const xVals = x_.map(value => value * n_ + 1 / 7);
  const yVals = y_.map(value => value * n_ + 1 / 7);
  const hVals = xVals.map((value, index) => 1 - Math.abs(value) - Math.abs(yVals[index]));

  const b0 = [xVals[0], xVals[1], yVals[0], yVals[1]];
  const b1 = [xVals[2], xVals[3], yVals[2], yVals[3]];

  const s0 = [Math.floor(b0[0]) * 2 + 1, Math.floor(b0[1]) * 2 + 1, Math.floor(b0[2]) * 2 + 1, Math.floor(b0[3]) * 2 + 1];
  const s1 = [Math.floor(b1[0]) * 2 + 1, Math.floor(b1[1]) * 2 + 1, Math.floor(b1[2]) * 2 + 1, Math.floor(b1[3]) * 2 + 1];
  const sh = hVals.map(value => (value < 0 ? -1 : 0));

  const a0 = [b0[0] + s0[0] * sh[0], b0[1] + s0[1] * sh[0], b0[2] + s0[2] * sh[1], b0[3] + s0[3] * sh[1]];
  const a1 = [b1[0] + s1[0] * sh[2], b1[1] + s1[1] * sh[2], b1[2] + s1[2] * sh[3], b1[3] + s1[3] * sh[3]];

  const p0 = [a0[0], a0[1], hVals[0]];
  const p1 = [a0[2], a0[3], hVals[1]];
  const p2 = [a1[0], a1[1], hVals[2]];
  const p3 = [a1[2], a1[3], hVals[3]];

  const norm0 = 1 / Math.sqrt(p0[0] * p0[0] + p0[1] * p0[1] + p0[2] * p0[2]);
  const norm1 = 1 / Math.sqrt(p1[0] * p1[0] + p1[1] * p1[1] + p1[2] * p1[2]);
  const norm2 = 1 / Math.sqrt(p2[0] * p2[0] + p2[1] * p2[1] + p2[2] * p2[2]);
  const norm3 = 1 / Math.sqrt(p3[0] * p3[0] + p3[1] * p3[1] + p3[2] * p3[2]);

  p0[0] *= norm0; p0[1] *= norm0; p0[2] *= norm0;
  p1[0] *= norm1; p1[1] *= norm1; p1[2] *= norm1;
  p2[0] *= norm2; p2[1] *= norm2; p2[2] *= norm2;
  p3[0] *= norm3; p3[1] *= norm3; p3[2] *= norm3;

  const m0 = Math.max(0.6 - (x0 * x0 + y0 * y0 + z0 * z0), 0.0);
  const m1 = Math.max(0.6 - (x1 * x1 + y1 * y1 + z1 * z1), 0.0);
  const m2 = Math.max(0.6 - (x2 * x2 + y2 * y2 + z2 * z2), 0.0);
  const m3 = Math.max(0.6 - (x3 * x3 + y3 * y3 + z3 * z3), 0.0);

  const dot0 = p0[0] * x0 + p0[1] * y0 + p0[2] * z0;
  const dot1 = p1[0] * x1 + p1[1] * y1 + p1[2] * z1;
  const dot2 = p2[0] * x2 + p2[1] * y2 + p2[2] * z2;
  const dot3 = p3[0] * x3 + p3[1] * y3 + p3[2] * z3;

  return 42 * ((m0 * m0 * dot0) + (m1 * m1 * dot1) + (m2 * m2 * dot2) + (m3 * m3 * dot3));
}

export function fbmSimplex3D(x, y, z, baseFrequency, octaves, lacunarity, gain, amplitude) {
  let value = 0;
  let amp = amplitude;
  let freq = baseFrequency;

  for (let octave = 0; octave < octaves; octave++) {
    value += simplexNoise3D(x * freq, y * freq, z * freq) * amp;
    freq *= lacunarity;
    amp *= gain;
  }

  return value;
}
