import * as THREE from "three";

// Discover available textures in the textures folder
const textureModules = import.meta.glob('../textures/*.{jpg,jpeg,png}', { eager: true, import: 'default' });
export const textureOptions = Object.entries(textureModules)
  .map(([path, url]) => ({ name: path.split('/').pop(), url }))
  .sort((a, b) => a.name.localeCompare(b.name));

console.log('Displacement textures found:', textureOptions.map(t => t.name));

export function getDefaultTextureNames() {
  const defaultName1 = textureOptions.find(t => t.name === 'dirt.png')?.name ?? textureOptions[0]?.name ?? '';
  const defaultName2 = textureOptions[1]?.name ?? '';
  return {
    currentTextureName: defaultName1,
    currentTextureName2: defaultName2
  };
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
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;

    const w = tex?.image?.width ?? 0;
    const h = tex?.image?.height ?? 0;
    const isPOT = Boolean(w && h && THREE.MathUtils.isPowerOfTwo(w) && THREE.MathUtils.isPowerOfTwo(h));
    if (isPOT) {
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
    } else {
      // Avoid incomplete texture in WebGL1; softness will effectively fall back to LOD 0.
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
    }
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    console.log(`Applied displacement texture ${textureIndex}:`, name);
    if (onTextureLoaded) {
      onTextureLoaded(textureIndex, tex);
    }
  }, undefined, err => {
    console.warn('Failed to load texture', name, err);
  });
}
