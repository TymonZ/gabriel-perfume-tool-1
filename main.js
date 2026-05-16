import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import config from './config.json';

// Import modules
import * as geometry from './modules/geometry.js';
import * as textures from './modules/textures.js';
import * as materials from './modules/materials.js';
import * as sceneModule from './modules/scene.js';
import * as ui from './modules/ui.js';
import { bakeDisplacedGeometryWebGL2 } from './modules/bakeGpu.js';
import { exportGeometryAsGLB } from './modules/exportGltf.js';


// ============ INITIALIZATION ============

const textureLoader = new THREE.TextureLoader();
const modelLoader = new GLTFLoader();

const scene = sceneModule.createScene();
const camera = sceneModule.createCamera();
const renderer = sceneModule.createRenderer();
const modelRotation = sceneModule.setupMouseControls(renderer);
sceneModule.setupResizeHandler(camera, renderer);

const material = materials.createMaterial(camera);
const simplexConstants = materials.getSimplexConstants();

// Geometry state
let sphereBaseGeometry = geometry.createSphereBaseGeometry();
let userModelBaseGeometry = null;
let activeSource = "Sphere";

geometry.ensureGeometryAttributes(sphereBaseGeometry);
const mesh = sceneModule.createMesh(sphereBaseGeometry.clone(), material, scene);

// Texture state
const { currentTextureName: initialTextureName, currentTextureName2: initialTextureName2 } = textures.getDefaultTextureNames();
let currentTextureName = initialTextureName;
let currentTextureName2 = initialTextureName2;
const defaultTextureName1 = currentTextureName;
const defaultTextureName2 = currentTextureName2;

// UI state
const defaultRenderModeName = config?.renderViews?.default ?? "Current";
const defaultGradientMode = "hue spectrum";
const defaultGradientPosition = 0.5;
const defaultGlossiness = 0.45;

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function applyMidValueCurve(value, midValue) {
  const t = clamp01(value);
  const m = clamp01(midValue ?? 0.5);
  if (m === 0.5) {
    return t;
  }
  if (m <= 0) {
    return 0;
  }
  if (m >= 1) {
    return t;
  }

  if (m > 0.5) {
    const p = Math.log(1 - m) / Math.log(0.5);
    return 1 - Math.pow(1 - t, p);
  }

  const p = Math.log(m) / Math.log(0.5);
  return Math.pow(t, p);
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

// Params object
const params = {
  sourceShape: "Sphere",
  noise: config?.ui?.noise?.default ?? config?.ui?.noise1?.default ?? 0.2,
  offset: config?.ui?.offset?.default ?? 0.0,
  combinedTextureZoom1: config?.ui?.combinedTextureZoom1?.default ?? 0.5,
  combinedTextureZoom2: config?.ui?.combinedTextureZoom2?.default ?? 0.5,
  heaviness: config?.ui?.heaviness?.default ?? 0.0,
  longevity: config?.ui?.longevity?.default ?? 0.0,
  displacementTexture1: initialTextureName,
  displacementTexture2: initialTextureName2,
  gradientMode: defaultGradientMode,
  gradientPosition: defaultGradientPosition,
  glossiness: defaultGlossiness,
  uploadModel: () => fileInput.click(),
  exportBakedGLB: async () => exportCurrentBakedGLB(),
  resetBase: () => resetCurrentBase()
};

function handleDisplacementTextureLoaded(index, tex) {
  if (index === 1) {
    material.uniforms.displacementMap1.value = tex;
    material.uniforms.displacementMap1MaxDim.value = Math.max(tex?.image?.width ?? 1, tex?.image?.height ?? 1);
  } else if (index === 2) {
    material.uniforms.displacementMap2.value = tex;
    material.uniforms.displacementMap2MaxDim.value = Math.max(tex?.image?.width ?? 1, tex?.image?.height ?? 1);
  }
}

function applyDisplacementTexture(name, index) {
  textures.applyDisplacementTexture(name, index, textureLoader, handleDisplacementTextureLoaded);
}

async function exportCurrentBakedGLB() {
  try {
    const baked = bakeDisplacedGeometryWebGL2(renderer, mesh.geometry, material);
    await exportGeometryAsGLB(baked, { filename: "baked.glb" });
  } catch (error) {
    console.error("GLB export failed:", error);
  }
}

// Compute values from combined sliders
const combined1 = config?.ui?.combinedTextureZoom1;
const zoomMin1 = combined1?.textureZoom?.min ?? 0.25;
const zoomMax1 = combined1?.textureZoom?.max ?? 100;
const dispMin1 = combined1?.displacement?.min ?? 0;
const dispMax1 = combined1?.displacement?.max ?? 0.5;
const softMin1 = combined1?.textureSoftness?.min ?? 0;
const softMax1 = combined1?.textureSoftness?.max ?? 1;

const midValue1 = combined1?.midValue ?? 0.5;
const scaledCombined1 = applyMidValueCurve(params.combinedTextureZoom1, midValue1);
params.displacement1 = dispMin1 + (dispMax1 - dispMin1) * scaledCombined1;
params.textureZoom1 = zoomMin1 + (zoomMax1 - zoomMin1) * scaledCombined1;
params.textureSoftness1 = softMin1 + (softMax1 - softMin1) * scaledCombined1;

const combined2 = config?.ui?.combinedTextureZoom2;
const zoomMin2 = combined2?.textureZoom?.min ?? 0.25;
const zoomMax2 = combined2?.textureZoom?.max ?? 100;
const dispMin2 = combined2?.displacement?.min ?? 0;
const dispMax2 = combined2?.displacement?.max ?? 0.5;
const softMin2 = combined2?.textureSoftness?.min ?? 0;
const softMax2 = combined2?.textureSoftness?.max ?? 1;
const midValue2 = combined2?.midValue ?? 0.5;
const scaledCombined2 = applyMidValueCurve(params.combinedTextureZoom2, midValue2);
params.displacement2 = dispMin2 + (dispMax2 - dispMin2) * scaledCombined2;
params.textureZoom2 = zoomMin2 + (zoomMax2 - zoomMin2) * scaledCombined2;
params.textureSoftness2 = softMin2 + (softMax2 - softMin2) * scaledCombined2;

// Controllers
const controllers = {
  sourceController: null,
  noiseController: null,
  offsetController: null,
  heavinessController: null,
  longevityController: null,
  displacementTexture1Controller: null,
  combinedTextureZoom1Controller: null,
  displacementTexture2Controller: null,
  combinedTextureZoom2Controller: null,
  gradientModeController: null,
  gradientPositionController: null,
  glossinessController: null
};

// File input for model upload
const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = ".glb,.gltf";
fileInput.style.display = "none";
document.body.appendChild(fileInput);

fileInput.addEventListener("change", async event => {
  const input = event.target;
  const file = input.files?.[0];
  if (file) {
    try {
      const loaded = await geometry.loadUserModel(file, modelLoader);
      userModelBaseGeometry = loaded;
      params.sourceShape = "User Model";
      controllers.sourceController?.setValue("User Model");
      switchSource("User Model");
    } catch (error) {
      console.error("Model load failed:", error);
    }
  }
  input.value = "";
});

// ============ FUNCTIONS ============

function switchSource(source) {
  if (source === "User Model") {
    if (!userModelBaseGeometry) {
      console.warn("No user model loaded yet. Staying on Sphere.");
      params.sourceShape = "Sphere";
      controllers.sourceController?.setValue("Sphere");
      return;
    }

    activeSource = "User Model";
    sceneModule.replaceMeshGeometry(mesh, userModelBaseGeometry.clone(), geometry.ensureGeometryAttributes, geometry.validateGeometryVertexCount);
    return;
  }

  activeSource = "Sphere";
  sceneModule.replaceMeshGeometry(mesh, sphereBaseGeometry.clone(), geometry.ensureGeometryAttributes, geometry.validateGeometryVertexCount);
}

function resetCurrentBase() {
  if (activeSource === "User Model") {
    userModelBaseGeometry?.dispose();
    userModelBaseGeometry = null;
  }

  activeSource = "Sphere";
  params.sourceShape = "Sphere";
  if (controllers.sourceController) {
    controllers.sourceController.setValue("Sphere");
  }

  // Reset all parameters
  params.noise = config?.ui?.noise?.default ?? config?.ui?.noise1?.default ?? 0.2;
  params.offset = config?.ui?.offset?.default ?? 0.0;
  params.heaviness = config?.ui?.heaviness?.default ?? 0.0;
  params.longevity = config?.ui?.longevity?.default ?? 0.0;
  params.combinedTextureZoom1 = config?.ui?.combinedTextureZoom1?.default ?? 0.5;
  params.combinedTextureZoom2 = config?.ui?.combinedTextureZoom2?.default ?? 0.5;
  const scaledCombined1 = applyMidValueCurve(params.combinedTextureZoom1, midValue1);
  params.displacement1 = dispMin1 + (dispMax1 - dispMin1) * scaledCombined1;
  params.textureZoom1 = zoomMin1 + (zoomMax1 - zoomMin1) * scaledCombined1;
  params.textureSoftness1 = softMin1 + (softMax1 - softMin1) * scaledCombined1;
  const scaledCombined2 = applyMidValueCurve(params.combinedTextureZoom2, midValue2);
  params.displacement2 = dispMin2 + (dispMax2 - dispMin2) * scaledCombined2;
  params.textureZoom2 = zoomMin2 + (zoomMax2 - zoomMin2) * scaledCombined2;
  params.textureSoftness2 = softMin2 + (softMax2 - softMin2) * scaledCombined2;
  params.displacementTexture1 = defaultTextureName1;
  params.displacementTexture2 = defaultTextureName2;
  params.gradientMode = defaultGradientMode;
  params.gradientPosition = defaultGradientPosition;
  params.glossiness = defaultGlossiness;

  // Update controllers
  controllers.noiseController?.setValue(params.noise);
  controllers.offsetController?.setValue(params.offset);
  controllers.heavinessController?.setValue(params.heaviness);
  controllers.longevityController?.setValue(params.longevity);
  material.uniforms.noiseAmp.value = params.noise;
  material.uniforms.offset.value = params.offset;
  material.uniforms.heaviness.value = params.heaviness;
  material.uniforms.longevity.value = params.longevity;

  material.uniforms.displacementAmount1.value = params.displacement1;
  material.uniforms.displacementAmount2.value = params.displacement2;
  material.uniforms.textureSoftness1.value = params.textureSoftness1;
  material.uniforms.textureSoftness2.value = params.textureSoftness2;
  material.uniforms.textureZoom1.value = params.textureZoom1;
  material.uniforms.textureZoom2.value = params.textureZoom2;
  material.uniforms.gradientMode.value = 1;
  material.uniforms.gradientPosition.value = params.gradientPosition;
  material.uniforms.glossiness.value = params.glossiness;

  if (textures.textureOptions.length > 0) {
    applyDisplacementTexture(defaultTextureName1, 1);
    controllers.displacementTexture1Controller?.setValue(defaultTextureName1);
  }

  if (textures.textureOptions.length > 1) {
    applyDisplacementTexture(defaultTextureName2, 2);
    controllers.displacementTexture2Controller?.setValue(defaultTextureName2);
  } else if (textures.textureOptions.length === 1) {
    applyDisplacementTexture(defaultTextureName1, 2);
    controllers.displacementTexture2Controller?.setValue(defaultTextureName1);
  }

  controllers.combinedTextureZoom1Controller?.setValue(params.combinedTextureZoom1);
  controllers.combinedTextureZoom2Controller?.setValue(params.combinedTextureZoom2);
  controllers.gradientModeController?.setValue(defaultGradientMode);
  controllers.gradientPositionController?.setValue(params.gradientPosition);
  controllers.glossinessController?.setValue(params.glossiness);

  material.wireframe = false;
  const renderModeNameToValue = ui.getRenderModeNameToValue();
  material.uniforms.renderMode.value = renderModeNameToValue[defaultRenderModeName] ? Number(renderModeNameToValue[defaultRenderModeName]) : 0;
  renderModeSelect.value = renderModeNameToValue[defaultRenderModeName] ?? "0";
  renderModeSelect.dispatchEvent(new Event("change"));

  sphereBaseGeometry.dispose();
  sphereBaseGeometry = geometry.createSphereBaseGeometry();
  geometry.ensureGeometryAttributes(sphereBaseGeometry);
  sceneModule.replaceMeshGeometry(mesh, sphereBaseGeometry.clone(), geometry.ensureGeometryAttributes, geometry.validateGeometryVertexCount);
}

// ============ UI SETUP ============

const gui = ui.createGUI();

// Main controls
controllers.sourceController = ui.addDropdownControl(gui, "sourceShape", "Source Shape", ["Sphere", "User Model"], params, value => switchSource(value));

gui.add(params, "uploadModel").name("Upload GLB/GLTF");

gui.add(params, "exportBakedGLB").name("Export GLB (Baked)");

controllers.noiseController = ui.addSliderControl(gui, "noise", "Noise", config?.ui?.noise?.min ?? 0, config?.ui?.noise?.max ?? 1, params, v => {
  material.uniforms.noiseAmp.value = v;
});

controllers.offsetController = ui.addSliderControl(gui, "offset", "Offset", config?.ui?.offset?.min ?? -1, config?.ui?.offset?.max ?? 1, params, v => {
  material.uniforms.offset.value = v;
});

controllers.heavinessController = ui.addSliderControl(gui, "heaviness", "Heavy ↔ Light", config?.ui?.heaviness?.min ?? -0.5, config?.ui?.heaviness?.max ?? 0.5, params, v => {
  material.uniforms.heaviness.value = v;
});

controllers.longevityController = ui.addSliderControl(gui, "longevity", "Longevity", config?.ui?.longevity?.min ?? -1.5, config?.ui?.longevity?.max ?? 1.5, params, v => {
  material.uniforms.longevity.value = v;
});

// Texture folder
ui.setupTextureFolder(gui, textures.textureOptions, params, controllers, (name, index) => {
  applyDisplacementTexture(name, index);
});

// Add onChange handlers for texture displacement sliders
// Removed separate displacement controllers

if (controllers.combinedTextureZoom1Controller) {
  controllers.combinedTextureZoom1Controller.onChange(v => {
    const scaled = applyMidValueCurve(v, midValue1);
    params.displacement1 = dispMin1 + (dispMax1 - dispMin1) * scaled;
    params.textureZoom1 = zoomMin1 + (zoomMax1 - zoomMin1) * scaled;
    params.textureSoftness1 = softMin1 + (softMax1 - softMin1) * scaled;
    material.uniforms.displacementAmount1.value = params.displacement1;
    material.uniforms.textureZoom1.value = params.textureZoom1;
    material.uniforms.textureSoftness1.value = params.textureSoftness1;
  });
}

if (controllers.combinedTextureZoom2Controller) {
  controllers.combinedTextureZoom2Controller.onChange(v => {
    const scaled = applyMidValueCurve(v, midValue2);
    params.displacement2 = dispMin2 + (dispMax2 - dispMin2) * scaled;
    params.textureZoom2 = zoomMin2 + (zoomMax2 - zoomMin2) * scaled;
    params.textureSoftness2 = softMin2 + (softMax2 - softMin2) * scaled;
    material.uniforms.displacementAmount2.value = params.displacement2;
    material.uniforms.textureZoom2.value = params.textureZoom2;
    material.uniforms.textureSoftness2.value = params.textureSoftness2;
  });
}

// Reset button
if (config?.ui?.showResetButton !== false) {
  gui.add(params, "resetBase").name("Reset Current Base");
}

// Gradient folder
ui.setupGradientFolder(gui, params, controllers);

// Add onChange handlers for gradient controls
if (controllers.gradientModeController) {
  controllers.gradientModeController.onChange(value => {
    material.uniforms.gradientMode.value = value === "hue spectrum" ? 1 : 0;
  });
}
if (controllers.gradientPositionController) {
  controllers.gradientPositionController.onChange(value => {
    material.uniforms.gradientPosition.value = value;
  });
}
if (controllers.glossinessController) {
  controllers.glossinessController.onChange(value => {
    material.uniforms.glossiness.value = value;
  });
}

// Render mode dropdown
const { renderModeSelect, renderModeContainer } = ui.createRenderModeDropdown();
const renderModeNameToValue = ui.getRenderModeNameToValue();

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

// ============ TEXTURE LOADING & ANIMATION ============

textures.loadDisplacementTextures(textureLoader, currentTextureName, currentTextureName2, (index, tex) => {
  handleDisplacementTextureLoaded(index, tex);
});

sceneModule.startAnimationLoop(mesh, modelRotation, renderer, camera, scene);