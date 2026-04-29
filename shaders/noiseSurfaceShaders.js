export const noiseSurfaceVertexShader = `
uniform float noiseAmp;
uniform float offset;
uniform float displacementAmount1;
uniform float displacementAmount2;
uniform float triplanarScale;
uniform float simplexBaseFrequency;
uniform float simplexLacunarity;
uniform float simplexGain;
uniform float simplexAmplitude;
uniform int simplexOctaves;
uniform sampler2D displacementMap1;
uniform sampler2D displacementMap2;

attribute vec3 displaceNormal;
varying vec3 vNormal;
varying vec3 vWorldPos;

float sampleTriplanar(vec3 pos, vec3 n, sampler2D texMap) {
  vec3 an = abs(normalize(n));
  an = pow(an, vec3(4.0));
  an /= max(an.x + an.y + an.z, 0.0001);

  vec2 uvX = fract(pos.yz * triplanarScale + 0.5);
  vec2 uvY = fract(pos.xz * triplanarScale + 0.5);
  vec2 uvZ = fract(pos.xy * triplanarScale + 0.5);

  float tx = texture2D(texMap, uvX).r;
  float ty = texture2D(texMap, uvY).r;
  float tz = texture2D(texMap, uvZ).r;
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

  float noise = fbmSimplex(position) * noiseAmp + offset;

  float tex1 = sampleTriplanar(position, safeDisplaceNormal, displacementMap1);
  float tex2 = sampleTriplanar(position, safeDisplaceNormal, displacementMap2);
  
  vec3 displaced = position;
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
uniform float highVisibilityGray;

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

  if (renderMode == 2) {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.5);
    float lit = 0.35 + diffuse * 0.9;
    vec3 color = vec3(highVisibilityGray) * lit + vec3(0.22) * rim;
    gl_FragColor = vec4(color, 1.0);
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
