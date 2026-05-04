import { fbmSimplex3D } from './noise.js';
import { ensureGeometryAttributes } from './geometry.js';
import { getDisplacementSampler, getTriplanarScale } from './textures.js';

export function applyDisplacementCPU(baseGeometry, params, simplexConstants) {
  const displaced = baseGeometry.clone();
  ensureGeometryAttributes(displaced);

  const pos = displaced.attributes.position;
  const displaceNorm = displaced.attributes.displaceNormal;
  const triplanarScale = getTriplanarScale();
  const displacementSampler1 = getDisplacementSampler(1);
  const displacementSampler2 = getDisplacementSampler(2);

  const zoom1 = Math.max(0.0001, Number(params?.textureZoom1 ?? 1.0));
  const zoom2 = Math.max(0.0001, Number(params?.textureZoom2 ?? 1.0));
  const scale1 = triplanarScale / zoom1;
  const scale2 = triplanarScale / zoom2;

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    // Apply heaviness: non-uniform scaling with volume compensation
    const scaleY = 1.0 + params.heaviness;
    const scaleXZ = 1.0 - params.heaviness * 0.5;
    
    // Normalize height for longevity effects
    const normalizedHeight = y * 0.5 + 0.5;
    
    // Longevity: base flattening and widening from middle to bottom
    const baseInfluence = Math.max(0, Math.min(1, (0.5 - normalizedHeight) / 0.5));
    // Reverse effect: narrowing from middle to top
    const topInfluence = Math.max(0, Math.min(1, (normalizedHeight - 0.5) / 0.5));
    // Apply opposite effects top and bottom
    const effectiveScaleXZ = scaleXZ + params.longevity * baseInfluence * 0.3 - params.longevity * topInfluence * 0.3;
    
    // Apply scaling
    x *= effectiveScaleXZ;
    y *= scaleY;
    z *= effectiveScaleXZ;

    const nx = displaceNorm.getX(i);
    const ny = displaceNorm.getY(i);
    const nz = displaceNorm.getZ(i);

    // Apply noise with longevity dampening from middle to bottom, amplification from middle to top
    let noise = fbmSimplex3D(x, y, z, simplexConstants.baseFrequency, simplexConstants.octaves, simplexConstants.lacunarity, simplexConstants.gain, simplexConstants.amplitude) * params.noise + params.offset;
    const noiseInfluence = 1.0 - params.longevity * 0.8 * baseInfluence + params.longevity * 0.5 * topInfluence;
    noise *= noiseInfluence;

    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    const wx = Math.pow(ax, 4);
    const wy = Math.pow(ay, 4);
    const wz = Math.pow(az, 4);
    const wsum = Math.max(wx + wy + wz, 0.0001);
    const bx = wx / wsum;
    const by = wy / wsum;
    const bz = wz / wsum;

    // Sample texture 1
    const sx1 = displacementSampler1 ? displacementSampler1(y * scale1 + 0.5, z * scale1 + 0.5) : 0.5;
    const sy1 = displacementSampler1 ? displacementSampler1(x * scale1 + 0.5, z * scale1 + 0.5) : 0.5;
    const sz1 = displacementSampler1 ? displacementSampler1(x * scale1 + 0.5, y * scale1 + 0.5) : 0.5;
    const tex1 = sx1 * bx + sy1 * by + sz1 * bz;

    // Sample texture 2
    const sx2 = displacementSampler2 ? displacementSampler2(y * scale2 + 0.5, z * scale2 + 0.5) : 0.5;
    const sy2 = displacementSampler2 ? displacementSampler2(x * scale2 + 0.5, z * scale2 + 0.5) : 0.5;
    const sz2 = displacementSampler2 ? displacementSampler2(x * scale2 + 0.5, y * scale2 + 0.5) : 0.5;
    const tex2 = sx2 * bx + sy2 * by + sz2 * bz;

    // Center texture values around 0.0 (0.5 = neutral): black -> inward, white -> outward
    const total = noise * 0.18 + (tex1 - 0.5) * params.displacement1 + (tex2 - 0.5) * params.displacement2;
    pos.setXYZ(i, x + nx * total, y + ny * total, z + nz * total);
  }

  pos.needsUpdate = true;
  displaced.computeVertexNormals();
  displaced.computeBoundingBox();
  displaced.computeBoundingSphere();
  return displaced;
}

export function bakeCurrentDisplacement(activeSourceData, params, simplexConstants) {
  try {
    const baked = applyDisplacementCPU(activeSourceData.baseGeometry, params, simplexConstants);

    activeSourceData.baseGeometry?.dispose();
    activeSourceData.baseGeometry = baked;

    return baked;
  } catch (error) {
    console.error("Bake failed:", error);
    throw error;
  }
}
