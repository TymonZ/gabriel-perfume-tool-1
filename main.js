import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import GUI from "lil-gui";
import config from './config.json';
import { noiseSurfaceVertexShader, noiseSurfaceFragmentShader } from "./shaders/noiseSurfaceShaders.js";

const MAX_SAFE_VERTICES = 300000;
const DEFAULT_SPHERE_SEGMENTS = 128;
const TARGET_RADIUS = 1;
const TRIPLANAR_SCALE = 0.75;
const MAX_SAFE_SPHERE_SEGMENTS = Math.floor(Math.sqrt(MAX_SAFE_VERTICES)) - 1;
const SIMPLEX_BASE_FREQUENCY = Number(config?.simplex?.baseFrequency ?? 1.15);
const SIMPLEX_OCTAVES = Math.max(1, Math.min(8, Math.round(Number(config?.simplex?.octaves ?? 4))));
const SIMPLEX_LACUNARITY = Number(config?.simplex?.lacunarity ?? 2.0);
const SIMPLEX_GAIN = Number(config?.simplex?.gain ?? 0.52);
const SIMPLEX_AMPLITUDE = Number(config?.simplex?.amplitude ?? 0.32);

function getInitialSphereSegments() {
  const configured = Number(config?.initialSphereResolution);
  if (!Number.isFinite(configured)) {
    return DEFAULT_SPHERE_SEGMENTS;
  }

  const rounded = Math.round(configured);
  const clamped = Math.max(3, Math.min(MAX_SAFE_SPHERE_SEGMENTS, rounded));
  if (clamped !== rounded) {
    console.warn(
      `initialSphereResolution (${rounded}) was clamped to ${clamped}. Allowed range: 3-${MAX_SAFE_SPHERE_SEGMENTS}.`
    );
  }
  return clamped;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Custom mouse controls for model rotation
let isMouseDown = false;
let previousMousePosition = { x: 0, y: 0 };
let modelRotation = { x: 0, y: 0 };

renderer.domElement.addEventListener("mousedown", (e) => {
  isMouseDown = true;
  previousMousePosition = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener("mousemove", (e) => {
  if (!isMouseDown) return;

  const deltaX = e.clientX - previousMousePosition.x;
  const deltaY = e.clientY - previousMousePosition.y;

  modelRotation.y += deltaX * 0.01;
  modelRotation.x += deltaY * 0.01;

  previousMousePosition = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener("mouseup", () => {
  isMouseDown = false;
});

renderer.domElement.addEventListener("mouseleave", () => {
  isMouseDown = false;
});

const textureLoader = new THREE.TextureLoader();
const modelLoader = new GLTFLoader();

// Discover available textures in the textures folder
const textureModules = import.meta.glob('./textures/*.{jpg,jpeg,png}', { eager: true, import: 'default' });
const textureOptions = Object.entries(textureModules).map(([path, url]) => ({ name: path.split('/').pop(), url })).sort((a, b) => a.name.localeCompare(b.name));
console.log('Displacement textures found:', textureOptions.map(t => t.name));

let currentTextureName = textureOptions.find(t => t.name === 'dirt.png')?.name ?? textureOptions[0]?.name ?? '';
let currentTextureName2 = textureOptions[1]?.name ?? '';
const defaultTextureName1 = currentTextureName;
const defaultTextureName2 = currentTextureName2;
const defaultRenderModeName = config?.renderViews?.default ?? "Current";
const defaultGradientMode = "hue spectrum";
const defaultGradientPosition = 0.5;
const defaultGlossiness = 0.45;

const fallbackTexture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
fallbackTexture.colorSpace = THREE.NoColorSpace;
fallbackTexture.needsUpdate = true;

let displacementSampler1 = null;
let displacementSampler2 = null;

const material = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: {
    noiseAmp: { value: config?.ui?.noise?.default ?? config?.ui?.noise1?.default ?? 0.2 },
    offset: { value: config?.ui?.offset?.default ?? 0.0 },
    displacementAmount1: { value: config?.ui?.displacement1?.default ?? 0.0 },
    displacementAmount2: { value: config?.ui?.displacement2?.default ?? 0.0 },
    gradientMode: { value: 1 },
    gradientPosition: { value: 0.5 },
    glossiness: { value: 0.45 },
    renderMode: { value: 0 },
    cameraNear: { value: camera.near },
    cameraFar: { value: camera.far },
    depthRangeNear: { value: config?.renderViews?.depthMap?.near ?? 1.5 },
    depthRangeFar: { value: config?.renderViews?.depthMap?.far ?? 5.5 },
    depthInvert: { value: (config?.renderViews?.depthMap?.invert ?? true) ? 1.0 : 0.0 },
    highVisibilityGray: { value: config?.renderViews?.highVisibility?.baseGray ?? 0.72 },
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

function createSphereBaseGeometry() {
  const segments = getInitialSphereSegments();
  return new THREE.SphereGeometry(TARGET_RADIUS, segments, segments);
}

function buildDisplacementNormals(geometry) {
  const pos = geometry.attributes.position;
  const norm = geometry.attributes.normal;
  const out = new Float32Array(pos.count * 3);
  const sums = new Map();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${Math.round(x * 100000)}|${Math.round(y * 100000)}|${Math.round(z * 100000)}`;
    let entry = sums.get(key);
    if (!entry) {
      entry = { x: 0, y: 0, z: 0 };
      sums.set(key, entry);
    }
    entry.x += norm.getX(i);
    entry.y += norm.getY(i);
    entry.z += norm.getZ(i);
  }

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${Math.round(x * 100000)}|${Math.round(y * 100000)}|${Math.round(z * 100000)}`;
    const entry = sums.get(key);

    let nx = norm.getX(i);
    let ny = norm.getY(i);
    let nz = norm.getZ(i);

    if (entry) {
      const len = Math.hypot(entry.x, entry.y, entry.z);
      if (len > 0.000001) {
        nx = entry.x / len;
        ny = entry.y / len;
        nz = entry.z / len;
      }
    }

    const idx = i * 3;
    out[idx] = nx;
    out[idx + 1] = ny;
    out[idx + 2] = nz;
  }

  geometry.setAttribute("displaceNormal", new THREE.BufferAttribute(out, 3));
}

function ensureGeometryAttributes(geometry) {
  if (!geometry.attributes.position) {
    throw new Error("Geometry is missing position attribute.");
  }

  if (!geometry.attributes.normal) {
    geometry.computeVertexNormals();
  }

  if (!geometry.attributes.uv) {
    const pos = geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const len = Math.hypot(x, y, z) || 1.0;
      const nx = x / len;
      const ny = y / len;
      const nz = z / len;
      const u = 0.5 + Math.atan2(nz, nx) / (2.0 * Math.PI);
      const v = 0.5 - Math.asin(ny) / Math.PI;
      uv[i * 2] = u;
      uv[i * 2 + 1] = v;
    }

    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    console.warn("UVs were missing. A fallback spherical UV projection was generated.");
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  buildDisplacementNormals(geometry);
}

function normalizeGeometry(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) {
    throw new Error("Unable to compute bounding box for geometry.");
  }

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const maxAxis = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxAxis) || maxAxis <= 0) {
    throw new Error("Model appears degenerate. Cannot normalize geometry.");
  }

  const scale = (TARGET_RADIUS * 2.0) / maxAxis;
  const position = geometry.attributes.position;

  for (let i = 0; i < position.count; i++) {
    position.setXYZ(
      i,
      (position.getX(i) - center.x) * scale,
      (position.getY(i) - center.y) * scale,
      (position.getZ(i) - center.z) * scale
    );
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function mod289Vector3(x, y, z) {
  return [x - Math.floor(x * (1 / 289)) * 289, y - Math.floor(y * (1 / 289)) * 289, z - Math.floor(z * (1 / 289)) * 289];
}

function mod289Vector4(values) {
  return values.map(value => value - Math.floor(value * (1 / 289)) * 289);
}

function permuteVector4(values) {
  return mod289Vector4(values.map(value => ((value * 34) + 1) * value));
}

function simplexNoise3D(x, y, z) {
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

function fbmSimplex3D(x, y, z) {
  let value = 0;
  let amplitude = SIMPLEX_AMPLITUDE;
  let frequency = SIMPLEX_BASE_FREQUENCY;

  for (let octave = 0; octave < SIMPLEX_OCTAVES; octave++) {
    value += simplexNoise3D(x * frequency, y * frequency, z * frequency) * amplitude;
    frequency *= SIMPLEX_LACUNARITY;
    amplitude *= SIMPLEX_GAIN;
  }

  return value;
}

function buildTextureSampler(texture, samplerIndex) {
  if (!texture?.image || !texture.image.width || !texture.image.height) {
    if (samplerIndex === 1) displacementSampler1 = null;
    else if (samplerIndex === 2) displacementSampler2 = null;
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = texture.image.width;
  canvas.height = texture.image.height;
  const context = canvas.getContext("2d");
  if (!context) {
    if (samplerIndex === 1) displacementSampler1 = null;
    else if (samplerIndex === 2) displacementSampler2 = null;
    return;
  }

  context.drawImage(texture.image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;

  const sampler = (u, v) => {
    const wrappedU = ((u % 1) + 1) % 1;
    const wrappedV = ((v % 1) + 1) % 1;
    const x = Math.min(canvas.width - 1, Math.max(0, Math.floor(wrappedU * (canvas.width - 1))));
    const y = Math.min(canvas.height - 1, Math.max(0, Math.floor((1 - wrappedV) * (canvas.height - 1))));
    const idx = (y * canvas.width + x) * 4;
    return data[idx] / 255;
  };

  if (samplerIndex === 1) displacementSampler1 = sampler;
  else if (samplerIndex === 2) displacementSampler2 = sampler;
}

function loadDisplacementTextures() {
  // Load initial textures
  applyDisplacementTexture(currentTextureName, 1);
  if (currentTextureName2) {
    applyDisplacementTexture(currentTextureName2, 2);
  }
}

function applyDisplacementTexture(name, textureIndex) {
  if (!name) return;
  const found = textureOptions.find(t => t.name === name);
  if (!found) {
    console.warn('Texture not found:', name);
    return;
  }

  textureLoader.load(found.url, tex => {
    tex.colorSpace = THREE.NoColorSpace;
    if (textureIndex === 1) {
      material.uniforms.displacementMap1.value = tex;
      buildTextureSampler(tex, 1);
      currentTextureName = name;
      console.log('Applied displacement texture 1:', name);
    } else if (textureIndex === 2) {
      material.uniforms.displacementMap2.value = tex;
      buildTextureSampler(tex, 2);
      currentTextureName2 = name;
      console.log('Applied displacement texture 2:', name);
    }
  }, undefined, err => {
    console.warn('Failed to load texture', name, err);
  });
}

let sphereBaseGeometry = createSphereBaseGeometry();
let userModelBaseGeometry = null;
let activeSource = "Sphere";

ensureGeometryAttributes(sphereBaseGeometry);

const mesh = new THREE.Mesh(sphereBaseGeometry.clone(), material);
scene.add(mesh);

function replaceMeshGeometry(nextGeometry) {
  ensureGeometryAttributes(nextGeometry);

  const vertexCount = nextGeometry.attributes.position.count;
  if (vertexCount > MAX_SAFE_VERTICES) {
    throw new Error(`Model has ${vertexCount.toLocaleString()} vertices. Limit is ${MAX_SAFE_VERTICES.toLocaleString()}.`);
  }

  mesh.geometry.dispose();
  mesh.geometry = nextGeometry;
  console.log("Active geometry updated. Vertices:", vertexCount);
}

function switchSource(source) {
  if (source === "User Model") {
    if (!userModelBaseGeometry) {
      console.warn("No user model loaded yet. Staying on Sphere.");
      params.sourceShape = "Sphere";
      sourceController.setValue("Sphere");
      return;
    }

    activeSource = "User Model";
    replaceMeshGeometry(userModelBaseGeometry.clone());
    return;
  }

  activeSource = "Sphere";
  replaceMeshGeometry(sphereBaseGeometry.clone());
}

function applyDisplacementCPU(baseGeometry) {
  const displaced = baseGeometry.clone();
  ensureGeometryAttributes(displaced);

  const pos = displaced.attributes.position;
  const displaceNorm = displaced.attributes.displaceNormal;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const nx = displaceNorm.getX(i);
    const ny = displaceNorm.getY(i);
    const nz = displaceNorm.getZ(i);

    const noise = fbmSimplex3D(x, y, z) * params.noise + params.offset;

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
    const sx1 = displacementSampler1 ? displacementSampler1(y * TRIPLANAR_SCALE + 0.5, z * TRIPLANAR_SCALE + 0.5) : 0.5;
    const sy1 = displacementSampler1 ? displacementSampler1(x * TRIPLANAR_SCALE + 0.5, z * TRIPLANAR_SCALE + 0.5) : 0.5;
    const sz1 = displacementSampler1 ? displacementSampler1(x * TRIPLANAR_SCALE + 0.5, y * TRIPLANAR_SCALE + 0.5) : 0.5;
    const tex1 = sx1 * bx + sy1 * by + sz1 * bz;

    // Sample texture 2
    const sx2 = displacementSampler2 ? displacementSampler2(y * TRIPLANAR_SCALE + 0.5, z * TRIPLANAR_SCALE + 0.5) : 0.5;
    const sy2 = displacementSampler2 ? displacementSampler2(x * TRIPLANAR_SCALE + 0.5, z * TRIPLANAR_SCALE + 0.5) : 0.5;
    const sz2 = displacementSampler2 ? displacementSampler2(x * TRIPLANAR_SCALE + 0.5, y * TRIPLANAR_SCALE + 0.5) : 0.5;
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

function bakeCurrentDisplacement() {
  try {
    const base = activeSource === "User Model" ? userModelBaseGeometry : sphereBaseGeometry;
    if (!base) {
      return;
    }

    const baked = applyDisplacementCPU(base);

    if (activeSource === "User Model") {
      userModelBaseGeometry?.dispose();
      userModelBaseGeometry = baked;
    } else {
      sphereBaseGeometry.dispose();
      sphereBaseGeometry = baked;
    }

    replaceMeshGeometry(baked.clone());
    console.log("Bake complete for source:", activeSource);
  } catch (error) {
    console.error("Bake failed:", error);
  }
}

async function loadUserModel(file) {
  const objectUrl = URL.createObjectURL(file);
  console.log("Loading model:", file.name, `${(file.size / (1024 * 1024)).toFixed(2)} MB`);

  try {
    const gltf = await new Promise((resolve, reject) => {
      modelLoader.load(objectUrl, resolve, undefined, reject);
    });

    gltf.scene.updateMatrixWorld(true);

    const geometries = [];
    gltf.scene.traverse(node => {
      if (!node.isMesh || !node.geometry) {
        return;
      }

      const g = node.geometry.clone();
      g.applyMatrix4(node.matrixWorld);
      ensureGeometryAttributes(g);
      geometries.push(g);
    });

    if (geometries.length === 0) {
      throw new Error("No mesh geometry found in model.");
    }

    let merged = geometries[0];
    if (geometries.length > 1) {
      const candidate = BufferGeometryUtils.mergeGeometries(geometries, false);
      if (!candidate) {
        throw new Error("Failed to merge meshes from model.");
      }
      merged = candidate;
    }

    ensureGeometryAttributes(merged);
    normalizeGeometry(merged);

    const count = merged.attributes.position.count;
    if (count > MAX_SAFE_VERTICES) {
      throw new Error(`Model too dense (${count.toLocaleString()} vertices). Limit is ${MAX_SAFE_VERTICES.toLocaleString()}.`);
    }

    userModelBaseGeometry?.dispose();
    userModelBaseGeometry = merged;

    params.sourceShape = "User Model";
    sourceController.setValue("User Model");
    switchSource("User Model");
    console.log("User model ready.");
  } catch (error) {
    console.error("Model load failed:", error);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = ".glb,.gltf";
fileInput.style.display = "none";
document.body.appendChild(fileInput);

fileInput.addEventListener("change", event => {
  const input = event.target;
  const file = input.files?.[0];
  if (file) {
    loadUserModel(file);
  }
  input.value = "";
});

const gui = new GUI();

const params = {
  sourceShape: "Sphere",
  noise: config?.ui?.noise?.default ?? config?.ui?.noise1?.default ?? 0.2,
  offset: config?.ui?.offset?.default ?? 0.0,
  displacement1: config?.ui?.displacement1?.default ?? 0.0,
  displacement2: config?.ui?.displacement2?.default ?? 0.0,
  displacementTexture1: defaultTextureName1,
  displacementTexture2: defaultTextureName2,
  gradientMode: defaultGradientMode,
  gradientPosition: defaultGradientPosition,
  glossiness: defaultGlossiness,
  uploadModel: () => fileInput.click(),
  bakeDisplacement: () => bakeCurrentDisplacement(),
  resetBase: () => resetCurrentBase()
};

let sourceController = null;

if (config?.ui?.showSourceShapeDropdown) {
sourceController = gui
  .add(params, "sourceShape", ["Sphere", "User Model"])
  .name("Source Shape")
  .onChange(value => switchSource(value));
}

gui.add(params, "uploadModel").name("Upload GLB/GLTF");

const noiseController = gui.add(params, "noise", config?.ui?.noise?.min ?? 0, config?.ui?.noise?.max ?? 1).onChange(v => {
  material.uniforms.noiseAmp.value = v;
});
const offsetController = gui.add(params, "offset", config?.ui?.offset?.min ?? -1, config?.ui?.offset?.max ?? 1).onChange(v => {
  material.uniforms.offset.value = v;
});

if (textureOptions.length > 0) {
  const displacementTexture1Controller = gui.add(params, 'displacementTexture1', textureOptions.map(t => t.name)).name('Displacement Texture 1').onChange(v => {
    applyDisplacementTexture(v, 1);
  });
  const displacement1Controller = gui.add(params, "displacement1", config?.ui?.displacement1?.min ?? 0, config?.ui?.displacement1?.max ?? 2).name("Texture Displacement 1").onChange(v => {
    material.uniforms.displacementAmount1.value = v;
  });
}

if (textureOptions.length > 1) {
  const displacementTexture2Controller = gui.add(params, 'displacementTexture2', textureOptions.map(t => t.name)).name('Displacement Texture 2').onChange(v => {
    applyDisplacementTexture(v, 2);
  });
} else {
  const displacementTexture2Controller = gui.add(params, 'displacementTexture2', textureOptions.map(t => t.name)).name('Displacement Texture 2').onChange(v => {
    applyDisplacementTexture(v, 2);
  });
}

const displacement2Controller = gui.add(params, "displacement2", config?.ui?.displacement2?.min ?? 0, config?.ui?.displacement2?.max ?? 2).name("Texture Displacement 2").onChange(v => {
  material.uniforms.displacementAmount2.value = v;
});

if (config?.ui?.showBakeButton) {
  gui.add(params, "bakeDisplacement").name("Bake / Remesh");
}
gui.add(params, "resetBase").name("Reset Current Base");

const gradientFolder = gui.addFolder("Gradient");
const gradientModeController = gradientFolder.add(params, "gradientMode", ["warmth", "hue spectrum"]).name("Gradient").onChange(value => {
  material.uniforms.gradientMode.value = value === "hue spectrum" ? 1 : 0;
});
const gradientPositionController = gradientFolder.add(params, "gradientPosition", 0, 1).name("Gradient Position").onChange(value => {
  material.uniforms.gradientPosition.value = value;
});
const glossinessController = gradientFolder.add(params, "glossiness", 0, 1).name("Glossiness").onChange(value => {
  material.uniforms.glossiness.value = value;
});
gradientFolder.open();

const renderModeContainer = document.createElement("div");
renderModeContainer.style.position = "fixed";
renderModeContainer.style.left = "14px";
renderModeContainer.style.bottom = "14px";
renderModeContainer.style.padding = "8px 10px";
renderModeContainer.style.background = "rgba(16, 16, 16, 0.72)";
renderModeContainer.style.border = "1px solid rgba(255, 255, 255, 0.24)";
renderModeContainer.style.borderRadius = "8px";
renderModeContainer.style.zIndex = "20";
renderModeContainer.style.color = "#e7e7e7";
renderModeContainer.style.fontFamily = "monospace";
renderModeContainer.style.fontSize = "12px";

const renderModeLabel = document.createElement("label");
renderModeLabel.textContent = "Render View ";

const renderModeSelect = document.createElement("select");
renderModeSelect.style.marginLeft = "6px";
renderModeSelect.style.background = "#222";
renderModeSelect.style.color = "#e7e7e7";
renderModeSelect.style.border = "1px solid #555";
renderModeSelect.style.borderRadius = "4px";
renderModeSelect.style.padding = "2px 6px";

[
  { label: "Current", value: "0" },
  { label: "Wireframe", value: "3" },
  { label: "Depth Map", value: "1" },
  { label: "High Visibility", value: "2" },
].forEach(opt => {
  const option = document.createElement("option");
  option.textContent = opt.label;
  option.value = opt.value;
  renderModeSelect.appendChild(option);
});

// const defaultRenderModeName = config?.renderViews?.default ?? "Current";
const renderModeNameToValue = {
  Current: "0",
  "Depth Map": "1",
  "High Visibility": "2",
  Wireframe: "3"
};
renderModeSelect.value = renderModeNameToValue[defaultRenderModeName] ?? "0";
renderModeSelect.addEventListener("change", () => {
  const mode = Number(renderModeSelect.value);
  if (mode === 3) {
    material.wireframe = true;
    material.uniforms.renderMode.value = 0;
    return;
  }

  material.wireframe = false;
  material.uniforms.renderMode.value = mode;
});

renderModeSelect.dispatchEvent(new Event("change"));

renderModeLabel.appendChild(renderModeSelect);
renderModeContainer.appendChild(renderModeLabel);
document.body.appendChild(renderModeContainer);

loadDisplacementTextures();

function resetCurrentBase() {
  if (activeSource === "User Model") {
    userModelBaseGeometry?.dispose();
    userModelBaseGeometry = null;
  }

  activeSource = "Sphere";
  params.sourceShape = "Sphere";
  if (sourceController) {
    sourceController.setValue("Sphere");
  }

  params.noise = config?.ui?.noise?.default ?? config?.ui?.noise1?.default ?? 0.2;
  params.offset = config?.ui?.offset?.default ?? 0.0;
  params.displacement1 = config?.ui?.displacement1?.default ?? 0.0;
  params.displacement2 = config?.ui?.displacement2?.default ?? 0.0;
  params.displacementTexture1 = defaultTextureName1;
  params.displacementTexture2 = defaultTextureName2;
  params.gradientMode = defaultGradientMode;
  params.gradientPosition = defaultGradientPosition;
  params.glossiness = defaultGlossiness;

  noiseController.setValue(params.noise);
  offsetController.setValue(params.offset);
  material.uniforms.noiseAmp.value = params.noise;
  material.uniforms.offset.value = params.offset;

  material.uniforms.displacementAmount1.value = params.displacement1;
  material.uniforms.displacementAmount2.value = params.displacement2;
  material.uniforms.gradientMode.value = 1;
  material.uniforms.gradientPosition.value = params.gradientPosition;
  material.uniforms.glossiness.value = params.glossiness;

  if (textureOptions.length > 0) {
    applyDisplacementTexture(defaultTextureName1, 1);
    displacementTexture1Controller?.setValue(defaultTextureName1);
  }

  if (textureOptions.length > 1) {
    applyDisplacementTexture(defaultTextureName2, 2);
    displacementTexture2Controller?.setValue(defaultTextureName2);
  } else if (textureOptions.length === 1) {
    applyDisplacementTexture(defaultTextureName1, 2);
    displacementTexture2Controller?.setValue(defaultTextureName1);
  }

  displacement1Controller?.setValue(params.displacement1);
  displacement2Controller?.setValue(params.displacement2);
  gradientModeController?.setValue(defaultGradientMode);
  gradientPositionController?.setValue(params.gradientPosition);
  glossinessController?.setValue(params.glossiness);

  material.wireframe = false;
  material.uniforms.renderMode.value = renderModeNameToValue[defaultRenderModeName] ? Number(renderModeNameToValue[defaultRenderModeName]) : 0;
  renderModeSelect.value = renderModeNameToValue[defaultRenderModeName] ?? "0";
  renderModeSelect.dispatchEvent(new Event("change"));

  sphereBaseGeometry.dispose();
  sphereBaseGeometry = createSphereBaseGeometry();
  ensureGeometryAttributes(sphereBaseGeometry);
  replaceMeshGeometry(sphereBaseGeometry.clone());
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  
  // Apply rotation to mesh based on mouse movement
  mesh.rotation.order = "YXZ";
  mesh.rotation.y = modelRotation.y;
  mesh.rotation.x = modelRotation.x;
  
  renderer.render(scene, camera);
}

animate();