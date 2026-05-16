import * as THREE from "three";

function isWebGL2Renderer(renderer) {
  return Boolean(renderer?.capabilities?.isWebGL2);
}

function getGL(renderer) {
  const gl = renderer.getContext();
  return gl;
}

function getTextureHandle(renderer, texture) {
  if (!texture) {
    return null;
  }

  // Ensure texture has been uploaded at least once.
  // In this app it usually is, because we're rendering continuously.
  const props = renderer.properties.get(texture);
  if (!props) {
    return null;
  }

  if (props.__webglTexture) {
    return props.__webglTexture;
  }

  if (props.webglTexture) {
    return props.webglTexture;
  }

  if (typeof WebGLTexture !== "undefined") {
    for (const value of Object.values(props)) {
      if (value instanceof WebGLTexture) {
        return value;
      }
    }
  }

  return null;
}

function packVec3Attribute(attribute, count) {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const base = i * 3;
    out[base] = attribute.getX(i);
    out[base + 1] = attribute.getY(i);
    out[base + 2] = attribute.getZ(i);
  }
  return out;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create shader.");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? "";
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${info}`);
  }
  return shader;
}

function linkProgram(gl, vertexShader, fragmentShader, transformVaryings) {
  const program = gl.createProgram();
  if (!program) {
    throw new Error("Failed to create program.");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);

  if (transformVaryings?.length) {
    gl.transformFeedbackVaryings(program, transformVaryings, gl.SEPARATE_ATTRIBS);
  }

  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? "";
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${info}`);
  }

  return program;
}

function makeBakeFragmentShaderSource() {
  // WebGL2 requires a fragment shader for program linking, even when using RASTERIZER_DISCARD.
  return `#version 300 es
precision highp float;
out vec4 outColor;
void main() {
  outColor = vec4(0.0);
}
`;
}

function makeBakeVertexShaderSource() {
  // Match your current vertex shader logic, but output displaced position via transform feedback.
  // Uses GLSL ES 3.00 so we can use transform feedback in WebGL2.
  return `#version 300 es
precision highp float;
precision highp sampler2D;

in vec3 a_position;
in vec3 a_displaceNormal;

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

out vec3 tf_position;

float sampleRSoftFallback(sampler2D texMap, vec2 uv, float softness01, float maxSoftnessPx, float texMaxDim) {
  float s = clamp(softness01, 0.0, 1.0);
  float radiusPx = max(0.0, maxSoftnessPx) * s;
  float texel = 1.0 / max(texMaxDim, 1.0);
  float r = radiusPx * texel;

  vec2 o1 = vec2(r, 0.0);
  vec2 o2 = vec2(0.0, r);
  vec2 o3 = vec2(r, r);

  float c = texture(texMap, uv).r * 0.25;
  c += texture(texMap, uv + o1).r * 0.125;
  c += texture(texMap, uv - o1).r * 0.125;
  c += texture(texMap, uv + o2).r * 0.125;
  c += texture(texMap, uv - o2).r * 0.125;
  c += texture(texMap, uv + o3).r * 0.0625;
  c += texture(texMap, uv - o3).r * 0.0625;
  c += texture(texMap, uv + vec2(-r, r)).r * 0.0625;
  c += texture(texMap, uv + vec2(r, -r)).r * 0.0625;
  return c;
}

float sampleRSoft(sampler2D texMap, vec2 uv, float softness01, float texMaxDim) {
  return sampleRSoftFallback(texMap, uv, softness01, textureSoftnessMaxPx, texMaxDim);
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
  vec3 safeDisplaceNormal = normalize(a_displaceNormal);

  float scaleY = 1.0 + heaviness;
  float scaleXZ = 1.0 - heaviness * 0.5;

  float normalizedHeight = a_position.y * 0.5 + 0.5;
  float baseInfluence = smoothstep(0.5, 0.0, normalizedHeight);
  float topInfluence = smoothstep(0.5, 1.0, normalizedHeight);
  float effectiveScaleXZ = scaleXZ + longevity * baseInfluence * 0.3 - longevity * topInfluence * 0.3;

  vec3 scaledPos = a_position * vec3(effectiveScaleXZ, scaleY, effectiveScaleXZ);

  float noise = fbmSimplex(scaledPos) * noiseAmp + offset;
  float noiseInfluence = mix(1.0 - longevity * 0.8, 1.0 + longevity * 0.5, smoothstep(0.0, 1.0, normalizedHeight));
  noise *= noiseInfluence;

  float scale1 = triplanarScale / max(textureZoom1, 0.0001);
  float scale2 = triplanarScale / max(textureZoom2, 0.0001);
  float tex1 = sampleTriplanarSoft(scaledPos, safeDisplaceNormal, displacementMap1, textureSoftness1, displacementMap1MaxDim, scale1);
  float tex2 = sampleTriplanarSoft(scaledPos, safeDisplaceNormal, displacementMap2, textureSoftness2, displacementMap2MaxDim, scale2);

  vec3 displaced = scaledPos;
  displaced += safeDisplaceNormal * noise * 0.18;
  displaced += safeDisplaceNormal * (tex1 - 0.5) * displacementAmount1;
  displaced += safeDisplaceNormal * (tex2 - 0.5) * displacementAmount2;

  tf_position = displaced;
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
}
`;
}

function setUniform1f(gl, program, name, value) {
  const loc = gl.getUniformLocation(program, name);
  if (loc) {
    gl.uniform1f(loc, Number(value));
  }
}

function setUniform1i(gl, program, name, value) {
  const loc = gl.getUniformLocation(program, name);
  if (loc) {
    gl.uniform1i(loc, Number(value) | 0);
  }
}

function setUniformSampler(gl, program, name, unit) {
  const loc = gl.getUniformLocation(program, name);
  if (loc) {
    gl.uniform1i(loc, unit);
  }
}

export function bakeDisplacedGeometryWebGL2(renderer, sourceGeometry, shaderMaterial) {
  if (!isWebGL2Renderer(renderer)) {
    throw new Error("WebGL2 is required for GPU baking (transform feedback).");
  }

  if (!sourceGeometry?.attributes?.position) {
    throw new Error("Source geometry has no position attribute.");
  }

  const displaceAttr = sourceGeometry.attributes.displaceNormal;
  if (!displaceAttr) {
    throw new Error("Source geometry is missing 'displaceNormal' attribute. Call ensureGeometryAttributes() first.");
  }

  const uniforms = shaderMaterial?.uniforms;
  if (!uniforms) {
    throw new Error("Shader material uniforms missing.");
  }

  const tex1 = uniforms.displacementMap1?.value;
  const tex2 = uniforms.displacementMap2?.value;

  const gl = getGL(renderer);
  if (!(gl instanceof WebGL2RenderingContext)) {
    throw new Error("Renderer context is not WebGL2.");
  }

  // Save a small set of bindings we might disrupt.
  const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
  const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
  const prevArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
  const prevTransformFeedback = gl.getParameter(gl.TRANSFORM_FEEDBACK_BINDING);
  const prevActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
  gl.activeTexture(gl.TEXTURE0);
  const prevTex0 = gl.getParameter(gl.TEXTURE_BINDING_2D);
  gl.activeTexture(gl.TEXTURE1);
  const prevTex1 = gl.getParameter(gl.TEXTURE_BINDING_2D);
  gl.activeTexture(prevActiveTexture);

  const vertexCount = sourceGeometry.attributes.position.count;

  const packedPosition = packVec3Attribute(sourceGeometry.attributes.position, vertexCount);
  const packedDisplaceNormal = packVec3Attribute(displaceAttr, vertexCount);

  // Build program
  const vsSource = makeBakeVertexShaderSource();
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fsSource = makeBakeFragmentShaderSource();
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = linkProgram(gl, vs, fs, ["tf_position"]);

  const vao = gl.createVertexArray();
  const posBuffer = gl.createBuffer();
  const displaceBuffer = gl.createBuffer();
  const tf = gl.createTransformFeedback();
  const outBuffer = gl.createBuffer();

  if (!vao || !posBuffer || !displaceBuffer || !tf || !outBuffer) {
    throw new Error("Failed to create WebGL objects for baking.");
  }

  // Upload inputs
  gl.bindVertexArray(vao);

  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, packedPosition, gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(program, "a_position");
  if (posLoc >= 0) {
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, displaceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, packedDisplaceNormal, gl.STATIC_DRAW);
  const displaceLoc = gl.getAttribLocation(program, "a_displaceNormal");
  if (displaceLoc >= 0) {
    gl.enableVertexAttribArray(displaceLoc);
    gl.vertexAttribPointer(displaceLoc, 3, gl.FLOAT, false, 0, 0);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindVertexArray(null);

  // Allocate output buffer
  gl.bindBuffer(gl.ARRAY_BUFFER, outBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertexCount * 3 * 4, gl.DYNAMIC_READ);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  // Bind textures
  const texHandle1 = getTextureHandle(renderer, tex1);
  const texHandle2 = getTextureHandle(renderer, tex2);
  if (!texHandle1 || !texHandle2) {
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error("Displacement textures are not ready on the GPU yet.");
  }

  // Execute transform feedback
  gl.useProgram(program);

  // Scalar uniforms
  setUniform1f(gl, program, "noiseAmp", uniforms.noiseAmp?.value);
  setUniform1f(gl, program, "offset", uniforms.offset?.value);
  setUniform1f(gl, program, "displacementAmount1", uniforms.displacementAmount1?.value);
  setUniform1f(gl, program, "displacementAmount2", uniforms.displacementAmount2?.value);
  setUniform1f(gl, program, "textureSoftness1", uniforms.textureSoftness1?.value);
  setUniform1f(gl, program, "textureSoftness2", uniforms.textureSoftness2?.value);
  setUniform1f(gl, program, "textureZoom1", uniforms.textureZoom1?.value);
  setUniform1f(gl, program, "textureZoom2", uniforms.textureZoom2?.value);
  setUniform1f(gl, program, "textureSoftnessMaxPx", uniforms.textureSoftnessMaxPx?.value);
  setUniform1f(gl, program, "displacementMap1MaxDim", uniforms.displacementMap1MaxDim?.value);
  setUniform1f(gl, program, "displacementMap2MaxDim", uniforms.displacementMap2MaxDim?.value);
  setUniform1f(gl, program, "triplanarScale", uniforms.triplanarScale?.value);
  setUniform1f(gl, program, "simplexBaseFrequency", uniforms.simplexBaseFrequency?.value);
  setUniform1f(gl, program, "simplexLacunarity", uniforms.simplexLacunarity?.value);
  setUniform1f(gl, program, "simplexGain", uniforms.simplexGain?.value);
  setUniform1f(gl, program, "simplexAmplitude", uniforms.simplexAmplitude?.value);
  setUniform1i(gl, program, "simplexOctaves", uniforms.simplexOctaves?.value);
  setUniform1f(gl, program, "heaviness", uniforms.heaviness?.value);
  setUniform1f(gl, program, "longevity", uniforms.longevity?.value);

  // Samplers
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texHandle1);
  setUniformSampler(gl, program, "displacementMap1", 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texHandle2);
  setUniformSampler(gl, program, "displacementMap2", 1);

  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, outBuffer);

  gl.bindVertexArray(vao);
  gl.enable(gl.RASTERIZER_DISCARD);

  gl.beginTransformFeedback(gl.POINTS);
  gl.drawArrays(gl.POINTS, 0, vertexCount);
  gl.endTransformFeedback();

  gl.disable(gl.RASTERIZER_DISCARD);

  gl.bindVertexArray(null);
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

  // Ensure GPU work is complete before readback.
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  if (sync) {
    const maxWaitMs = 250;
    const start = performance.now();
    while (true) {
      const status = gl.clientWaitSync(sync, 0, 1_000_000); // 1ms
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
        break;
      }
      if (status === gl.WAIT_FAILED) {
        break;
      }
      if (performance.now() - start > maxWaitMs) {
        break;
      }
    }
    gl.deleteSync(sync);
  }

  // Read back
  gl.bindBuffer(gl.ARRAY_BUFFER, outBuffer);
  const displacedPositions = new Float32Array(vertexCount * 3);
  gl.getBufferSubData(gl.ARRAY_BUFFER, 0, displacedPositions);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  // Cleanup
  gl.deleteBuffer(posBuffer);
  gl.deleteBuffer(displaceBuffer);
  gl.deleteBuffer(outBuffer);
  gl.deleteVertexArray(vao);
  gl.deleteTransformFeedback(tf);
  gl.deleteProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  // Restore some bindings before giving control back to three.js.
  gl.useProgram(prevProgram);
  gl.bindVertexArray(prevVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, prevArrayBuffer);
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, prevTransformFeedback);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, prevTex0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, prevTex1);
  gl.activeTexture(prevActiveTexture);

  // Hard reset three.js' internal state caches (VAOs/bindings).
  renderer.resetState();

  const baked = sourceGeometry.clone();
  baked.setAttribute("position", new THREE.BufferAttribute(displacedPositions, 3));
  baked.computeVertexNormals();
  baked.computeBoundingBox();
  baked.computeBoundingSphere();

  return baked;
}
