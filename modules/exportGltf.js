import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportGeometryAsGLB(geometry, { filename = "baked.glb" } = {}) {
  if (!geometry?.attributes?.position) {
    throw new Error("No geometry/positions to export.");
  }

  const scene = new THREE.Scene();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.0,
    roughness: 1.0
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);
  mesh.updateMatrixWorld(true);
  scene.add(mesh);

  const exporter = new GLTFExporter();

  const arrayBuffer = await new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      result => {
        if (result instanceof ArrayBuffer) {
          resolve(result);
        } else {
          // If binary isn't honored for some reason, stringify JSON.
          resolve(new TextEncoder().encode(JSON.stringify(result)).buffer);
        }
      },
      error => reject(error),
      {
        binary: true,
        // Keep it minimal: geometry-only-ish. We still need a material node for glTF.
        onlyVisible: true,
        truncateDrawRange: true
      }
    );
  });

  const blob = new Blob([arrayBuffer], { type: "model/gltf-binary" });
  downloadBlob(blob, filename);
}
