import * as THREE from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import config from '../config.json';

const TARGET_RADIUS = 1;
const DEFAULT_SPHERE_SEGMENTS = 128;
const MAX_SAFE_VERTICES = 300000;
const MAX_SAFE_SPHERE_SEGMENTS = Math.floor(Math.sqrt(MAX_SAFE_VERTICES)) - 1;

export function getInitialSphereSegments() {
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

export function createSphereBaseGeometry() {
  const segments = getInitialSphereSegments();
  return new THREE.SphereGeometry(TARGET_RADIUS, segments, segments);
}

export function buildDisplacementNormals(geometry) {
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

export function ensureGeometryAttributes(geometry) {
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

export function normalizeGeometry(geometry) {
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

export async function loadUserModel(file, modelLoader) {
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

    return merged;
  } catch (error) {
    console.error("Model load failed:", error);
    throw error;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function validateGeometryVertexCount(geometry) {
  const vertexCount = geometry.attributes.position.count;
  if (vertexCount > MAX_SAFE_VERTICES) {
    throw new Error(`Model has ${vertexCount.toLocaleString()} vertices. Limit is ${MAX_SAFE_VERTICES.toLocaleString()}.`);
  }
  return vertexCount;
}
