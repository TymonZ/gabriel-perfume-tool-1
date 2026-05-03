import * as THREE from "three";
import config from '../config.json';
import { noiseSurfaceVertexShader, noiseSurfaceFragmentShader } from "../shaders/noiseSurfaceShaders.js";

const SIMPLEX_BASE_FREQUENCY = Number(config?.simplex?.baseFrequency ?? 1.15);
const SIMPLEX_OCTAVES = Math.max(1, Math.min(8, Math.round(Number(config?.simplex?.octaves ?? 4))));
const SIMPLEX_LACUNARITY = Number(config?.simplex?.lacunarity ?? 2.0);
const SIMPLEX_GAIN = Number(config?.simplex?.gain ?? 0.52);
const SIMPLEX_AMPLITUDE = Number(config?.simplex?.amplitude ?? 0.32);
const TRIPLANAR_SCALE = 0.75;

const fallbackTexture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
fallbackTexture.colorSpace = THREE.NoColorSpace;
fallbackTexture.needsUpdate = true;

export function createMaterial(camera) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      noiseAmp: { value: config?.ui?.noise?.default ?? config?.ui?.noise1?.default ?? 0.2 },
      offset: { value: config?.ui?.offset?.default ?? 0.0 },
      displacementAmount1: { value: config?.ui?.displacement1?.default ?? 0.0 },
      displacementAmount2: { value: config?.ui?.displacement2?.default ?? 0.0 },
      heaviness: { value: config?.ui?.heaviness?.default ?? 0.0 },
      longevity: { value: config?.ui?.longevity?.default ?? 0.0 },
      gradientMode: { value: 1 },
      gradientPosition: { value: 0.5 },
      glossiness: { value: 0.45 },
      renderMode: { value: 0 },
      cameraNear: { value: camera.near },
      cameraFar: { value: camera.far },
      depthRangeNear: { value: config?.renderViews?.depthMap?.near ?? 1.5 },
      depthRangeFar: { value: config?.renderViews?.depthMap?.far ?? 5.5 },
      depthInvert: { value: (config?.renderViews?.depthMap?.invert ?? true) ? 1.0 : 0.0 },

      triplanarScale: { value: TRIPLANAR_SCALE },
      simplexBaseFrequency: { value: SIMPLEX_BASE_FREQUENCY },
      simplexOctaves: { value: SIMPLEX_OCTAVES },
      simplexLacunarity: { value: SIMPLEX_LACUNARITY },
      simplexGain: { value: SIMPLEX_GAIN },
      simplexAmplitude: { value: SIMPLEX_AMPLITUDE },
      displacementMap1: { value: fallbackTexture },
      displacementMap2: { value: fallbackTexture }
    },
    vertexShader: noiseSurfaceVertexShader,
    fragmentShader: noiseSurfaceFragmentShader
  });
}

export function getSimplexConstants() {
  return {
    baseFrequency: SIMPLEX_BASE_FREQUENCY,
    octaves: SIMPLEX_OCTAVES,
    lacunarity: SIMPLEX_LACUNARITY,
    gain: SIMPLEX_GAIN,
    amplitude: SIMPLEX_AMPLITUDE
  };
}
