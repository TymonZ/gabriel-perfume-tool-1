export const noiseSurfaceVertexShader = `
uniform float noiseAmp;
uniform float offset;
uniform float displacementAmount1;
uniform float displacementAmount2;
uniform float textureSoftness1;
uniform float textureSoftness2;
uniform float textureZoom1;
uniform float textureZoom2;
uniform float textureSoftnessMaxPx;
uniform float displacementMap1MaxDim;
uniform float displacementMap2MaxDim;
uniform float triplanarScale;
uniform float simplexBaseFrequency;
uniform float simplexLacunarity;
uniform float simplexGain;
uniform float simplexAmplitude;
uniform int simplexOctaves;
uniform sampler2D displacementMap1;
uniform sampler2D displacementMap2;
uniform float heaviness;
uniform float longevity;

attribute vec3 displaceNormal;
varying vec3 vNormal;
varying vec3 vWorldPos;

float log2Safe(float x) {
  return log(max(x, 0.000001)) / log(2.0);
}

vec4 tex2DLodCompat(sampler2D texMap, vec2 uv, float lod) {
#ifdef GL_EXT_shader_texture_lod
  return texture2DLodEXT(texMap, uv, lod);
#else
  return texture2D(texMap, uv);
#endif
}

float computeSoftnessLod(float softness01, float maxSoftnessPx, float texMaxDim) {
  float s = clamp(softness01, 0.0, 1.0);
  // Map 0..1 to 1..maxSoftnessPx (1px ~= no additional blur)
  float softnessPx = mix(1.0, max(1.0, maxSoftnessPx), s);
  float lod = log2Safe(softnessPx);
  float maxLod = log2Safe(max(texMaxDim, 1.0));
  return clamp(lod, 0.0, maxLod);
}

float sampleRAtLod(sampler2D texMap, vec2 uv, float lod, float maxLod) {
  float l0 = floor(lod);
  float l1 = min(l0 + 1.0, maxLod);
  float t = fract(lod);
  float a = tex2DLodCompat(texMap, uv, l0).r;
  float b = tex2DLodCompat(texMap, uv, l1).r;
  return mix(a, b, t);
}

float sampleRSoftFallback(sampler2D texMap, vec2 uv, float softness01, float maxSoftnessPx, float texMaxDim) {
  float s = clamp(softness01, 0.0, 1.0);
  float radiusPx = max(0.0, maxSoftnessPx) * s;
  float texel = 1.0 / max(texMaxDim, 1.0);
  float r = radiusPx * texel;

  // 9-tap tent-ish blur. Wide radii will be approximated but stays stable and gradual.
  vec2 o1 = vec2(r, 0.0);
  vec2 o2 = vec2(0.0, r);
  vec2 o3 = vec2(r, r);

  float c = texture2D(texMap, uv).r * 0.25;
  c += texture2D(texMap, uv + o1).r * 0.125;
  c += texture2D(texMap, uv - o1).r * 0.125;
  c += texture2D(texMap, uv + o2).r * 0.125;
  c += texture2D(texMap, uv - o2).r * 0.125;
  c += texture2D(texMap, uv + o3).r * 0.0625;
  c += texture2D(texMap, uv - o3).r * 0.0625;
  c += texture2D(texMap, uv + vec2(-r, r)).r * 0.0625;
  c += texture2D(texMap, uv + vec2(r, -r)).r * 0.0625;
  return c;
}

float sampleRSoft(sampler2D texMap, vec2 uv, float softness01, float texMaxDim) {
#ifdef GL_EXT_shader_texture_lod
  float maxLod = log2Safe(max(texMaxDim, 1.0));
  float lod = computeSoftnessLod(softness01, textureSoftnessMaxPx, texMaxDim);
  return sampleRAtLod(texMap, uv, lod, maxLod);
#else
  return sampleRSoftFallback(texMap, uv, softness01, textureSoftnessMaxPx, texMaxDim);
#endif
}

float sampleTriplanarSoft(vec3 pos, vec3 n, sampler2D texMap, float softness01, float texMaxDim, float triScale) {
  vec3 an = abs(normalize(n));
  an = pow(an, vec3(4.0));
  an /= max(an.x + an.y + an.z, 0.0001);

  vec2 uvX = fract(pos.yz * triScale + 0.5);
  vec2 uvY = fract(pos.xz * triScale + 0.5);
  vec2 uvZ = fract(pos.xy * triScale + 0.5);

  float tx = sampleRSoft(texMap, uvX, softness01, texMaxDim);
  float ty = sampleRSoft(texMap, uvY, softness01, texMaxDim);
  float tz = sampleRSoft(texMap, uvZ, softness01, texMaxDim);
  return tx * an.x + ty * an.y + tz * an.z;
}

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }

float simplexNoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = inversesqrt(vec4(
    dot(p0, p0),
    dot(p1, p1),
    dot(p2, p2),
    dot(p3, p3)
  ));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(
    dot(x0, x0),
    dot(x1, x1),
    dot(x2, x2),
    dot(x3, x3)
  ), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(
    dot(p0, x0),
    dot(p1, x1),
    dot(p2, x2),
    dot(p3, x3)
  ));
}

float fbmSimplex(vec3 p) {
  float value = 0.0;
  float amplitude = simplexAmplitude;
  float frequency = simplexBaseFrequency;
  int octaveCount = clamp(simplexOctaves, 1, 8);

  for (int i = 0; i < 8; i++) {
    if (i >= octaveCount) {
      break;
    }
    value += simplexNoise(p * frequency) * amplitude;
    frequency *= simplexLacunarity;
    amplitude *= simplexGain;
  }

  return value;
}

void main() {
  vec3 meshNormal = normalize(normal);
  vec3 safeDisplaceNormal = normalize(displaceNormal);

  // Apply heaviness: non-uniform scaling with volume compensation
  // Heaviness positive = compressed (shorter, wider)
  // Heaviness negative = stretched (taller, thinner)
  float scaleY = 1.0 + heaviness;
  float scaleXZ = 1.0 - heaviness * 0.5;
  
  // Normalize height for longevity effects (0 = bottom, 1 = top)
  // Assuming object is centered, so position.y ranges roughly -1 to 1
  float normalizedHeight = position.y * 0.5 + 0.5;
  
  // Longevity: base flattening and widening from middle to bottom
  float baseInfluence = smoothstep(0.5, 0.0, normalizedHeight);
  // Reverse effect: narrowing from middle to top
  float topInfluence = smoothstep(0.5, 1.0, normalizedHeight);
  // Apply opposite effects top and bottom
  float effectiveScaleXZ = scaleXZ + longevity * baseInfluence * 0.3 - longevity * topInfluence * 0.3;

  // Apply shape modifiers first so the rest of the deformation works on the updated form
  vec3 scaledPos = position * vec3(effectiveScaleXZ, scaleY, effectiveScaleXZ);
  
  // Apply noise with longevity dampening from middle to bottom, amplification from middle to top
  float noise = fbmSimplex(scaledPos) * noiseAmp + offset;
  float noiseInfluence = mix(1.0 - longevity * 0.8, 1.0 + longevity * 0.5, smoothstep(0.0, 1.0, normalizedHeight));
  noise *= noiseInfluence;

  float scale1 = triplanarScale / max(textureZoom1, 0.0001);
  float scale2 = triplanarScale / max(textureZoom2, 0.0001);
  float tex1 = sampleTriplanarSoft(scaledPos, safeDisplaceNormal, displacementMap1, textureSoftness1, displacementMap1MaxDim, scale1);
  float tex2 = sampleTriplanarSoft(scaledPos, safeDisplaceNormal, displacementMap2, textureSoftness2, displacementMap2MaxDim, scale2);
  
  vec3 displaced = scaledPos;
  displaced += safeDisplaceNormal * noise * 0.18;
  // Center texture values around 0.0 (0.5 = neutral): black -> inward, white -> outward
  displaced += safeDisplaceNormal * (tex1 - 0.5) * displacementAmount1;
  displaced += safeDisplaceNormal * (tex2 - 0.5) * displacementAmount2;

  vNormal = normalize(normalMatrix * meshNormal);
  vWorldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

export const noiseSurfaceFragmentShader = `
uniform int renderMode;
uniform int gradientMode;
uniform float gradientPosition;
uniform float glossiness;
uniform float cameraNear;
uniform float cameraFar;
uniform float depthRangeNear;
uniform float depthRangeFar;
uniform float depthInvert;

varying vec3 vNormal;
varying vec3 vWorldPos;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float linearizeDepth(float depth) {
  float ndc = depth * 2.0 - 1.0;
  return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - ndc * (cameraFar - cameraNear));
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 lightDir0 = normalize(vec3(1.0, 1.0, 1.0));
  vec3 lightDir1 = normalize(vec3(-1.0, 0.35, 0.85));
  vec3 lightDir2 = normalize(vec3(0.25, -1.0, 0.6));
  vec3 lightDir3 = normalize(vec3(-0.55, 0.7, -1.0));

  float diffuse0 = max(dot(n, lightDir0), 0.0);
  float diffuse1 = max(dot(n, lightDir1), 0.0);
  float diffuse2 = max(dot(n, lightDir2), 0.0);
  float diffuse3 = max(dot(n, lightDir3), 0.0);

  vec3 halfDir0 = normalize(lightDir0 + viewDir);
  vec3 halfDir1 = normalize(lightDir1 + viewDir);
  vec3 halfDir2 = normalize(lightDir2 + viewDir);
  vec3 halfDir3 = normalize(lightDir3 + viewDir);

  float gloss = clamp(glossiness, 0.0, 1.0);
  float specPower = mix(10.0, 140.0, gloss);
  float specStrength = mix(0.03, 0.75, gloss);

  float specular = 0.0;
  specular += pow(max(dot(n, halfDir0), 0.0), specPower) * specStrength * 1.00;
  specular += pow(max(dot(n, halfDir1), 0.0), specPower * 0.95) * specStrength * 0.85;
  specular += pow(max(dot(n, halfDir2), 0.0), specPower * 1.05) * specStrength * 0.70;
  specular += pow(max(dot(n, halfDir3), 0.0), specPower * 0.90) * specStrength * 0.60;

  float diffuse = diffuse0 * 0.85 + diffuse1 * 0.45 + diffuse2 * 0.35 + diffuse3 * 0.25;

  if (renderMode == 1) {
    float linearDepth = linearizeDepth(gl_FragCoord.z);
    float depth01 = clamp((linearDepth - depthRangeNear) / max(depthRangeFar - depthRangeNear, 0.0001), 0.0, 1.0);
    float depthView = depthInvert > 0.5 ? (1.0 - depth01) : depth01;
    gl_FragColor = vec4(vec3(depthView), 1.0);
    return;
  }

  float ambient = 0.28;
  float t = clamp(gradientPosition, 0.0, 1.0);
  vec3 gradientColor = gradientMode == 1
    ? hsv2rgb(vec3((2.0 / 3.0) * (1.0 - t), 1.0, 1.0))
    : mix(vec3(0.12, 0.28, 1.0), vec3(1.0, 0.12, 0.05), t);
  vec3 color = gradientColor * (ambient + diffuse * 0.9) + vec3(specular);
  gl_FragColor = vec4(color, 1.0);
}
`;
