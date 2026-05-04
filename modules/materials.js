import * as THREE from "three";
import config from '../config.json';
import { noiseSurfaceVertexShader, noiseSurfaceFragmentShader } from "../shaders/noiseSurfaceShaders.js";

const SIMPLEX_BASE_FREQUENCY = Number(config?.simplex?.baseFrequency ?? 1.15);
const SIMPLEX_OCTAVES = Math.max(1, Math.min(8, Math.round(Number(config?.simplex?.octaves ?? 4))));
const SIMPLEX_LACUNARITY = Number(config?.simplex?.lacunarity ?? 2.0);
const SIMPLEX_GAIN = Number(config?.simplex?.gain ?? 0.52);
const SIMPLEX_AMPLITUDE = Number(config?.simplex?.amplitude ?? 0.32);
const TRIPLANAR_SCALE = 0.75;

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function computeSoftnessFromZoom(index, zoomValue) {
  const zoomMin = Number(config?.ui?.[`textureZoom${index}`]?.min ?? 0.25);
  const zoomMax = Number(config?.ui?.[`textureZoom${index}`]?.max ?? 4.0);
  const softMin = Number(config?.ui?.[`textureSoftness${index}`]?.min ?? 0.0);
  const softMax = Number(config?.ui?.[`textureSoftness${index}`]?.max ?? 1.0);
  const denom = Math.max(zoomMax - zoomMin, 0.000001);
  const t = clamp01((Number(zoomValue) - zoomMin) / denom);
  return softMin + (softMax - softMin) * t;
}

const fallbackTexture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
fallbackTexture.colorSpace = THREE.NoColorSpace;
fallbackTexture.needsUpdate = true;

export function createMaterial(camera) {
  const defaultZoom1 = Number(config?.ui?.textureZoom1?.default ?? 1.0);
  const defaultZoom2 = Number(config?.ui?.textureZoom2?.default ?? 1.0);

  return new THREE.ShaderMaterial({
    extensions: {
      shaderTextureLOD: true
    },
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
      displacementMap2: { value: fallbackTexture },

      textureSoftness1: { value: computeSoftnessFromZoom(1, defaultZoom1) },
      textureSoftness2: { value: computeSoftnessFromZoom(2, defaultZoom2) },
      textureZoom1: { value: defaultZoom1 },
      textureZoom2: { value: defaultZoom2 },
      textureSoftnessMaxPx: { value: Number(config?.softness?.textureSoftnessMaxPx ?? 100) },
      displacementMap1MaxDim: { value: 1.0 },
      displacementMap2MaxDim: { value: 1.0 }
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
