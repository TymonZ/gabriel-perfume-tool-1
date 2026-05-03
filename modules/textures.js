import * as THREE from "three";

const TRIPLANAR_SCALE = 0.75;

// Discover available textures in the textures folder
const textureModules = import.meta.glob('../textures/*.{jpg,jpeg,png}', { eager: true, import: 'default' });
export const textureOptions = Object.entries(textureModules)
  .map(([path, url]) => ({ name: path.split('/').pop(), url }))
  .sort((a, b) => a.name.localeCompare(b.name));

console.log('Displacement textures found:', textureOptions.map(t => t.name));

let displacementSampler1 = null;
let displacementSampler2 = null;

export function getDefaultTextureNames() {
  const defaultName1 = textureOptions.find(t => t.name === 'dirt.png')?.name ?? textureOptions[0]?.name ?? '';
  const defaultName2 = textureOptions[1]?.name ?? '';
  return {
    currentTextureName: defaultName1,
    currentTextureName2: defaultName2
  };
}

export function getDisplacementSampler(index) {
  return index === 1 ? displacementSampler1 : displacementSampler2;
}

export function buildTextureSampler(texture, samplerIndex) {
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

export function loadDisplacementTextures(textureLoader, currentTextureName, currentTextureName2, onTextureLoaded) {
  // Load initial textures
  applyDisplacementTexture(currentTextureName, 1, textureLoader, onTextureLoaded);
  if (currentTextureName2) {
    applyDisplacementTexture(currentTextureName2, 2, textureLoader, onTextureLoaded);
  }
}

export function applyDisplacementTexture(name, textureIndex, textureLoader, onTextureLoaded) {
  if (!name) return;
  const found = textureOptions.find(t => t.name === name);
  if (!found) {
    console.warn('Texture not found:', name);
    return;
  }

  textureLoader.load(found.url, tex => {
    tex.colorSpace = THREE.NoColorSpace;
    buildTextureSampler(tex, textureIndex);
    console.log(`Applied displacement texture ${textureIndex}:`, name);
    if (onTextureLoaded) {
      onTextureLoaded(textureIndex, tex);
    }
  }, undefined, err => {
    console.warn('Failed to load texture', name, err);
  });
}

export function getTriplanarScale() {
  return TRIPLANAR_SCALE;
}
