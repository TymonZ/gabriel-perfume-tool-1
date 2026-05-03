import * as THREE from "three";

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);
  return scene;
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 3);
  return camera;
}

export function createRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);
  return renderer;
}

export function setupMouseControls(renderer) {
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

  return modelRotation;
}

export function setupResizeHandler(camera, renderer) {
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

export function createMesh(geometry, material, scene) {
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  return mesh;
}

export function startAnimationLoop(mesh, modelRotation, renderer, camera, scene) {
  function animate() {
    requestAnimationFrame(animate);
    
    // Apply rotation to mesh based on mouse movement
    mesh.rotation.order = "YXZ";
    mesh.rotation.y = modelRotation.y;
    mesh.rotation.x = modelRotation.x;
    
    renderer.render(scene, camera);
  }

  animate();
}

export function replaceMeshGeometry(mesh, nextGeometry, ensureGeometryAttributesFn, validateGeometryFn) {
  ensureGeometryAttributesFn(nextGeometry);

  const vertexCount = validateGeometryFn(nextGeometry);

  mesh.geometry.dispose();
  mesh.geometry = nextGeometry;
  console.log("Active geometry updated. Vertices:", vertexCount);
}
