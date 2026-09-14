/**
 * The shaders.
 *
 * One lighting model runs through all of them: a low sun, a cool sky
 * bouncing off everything it can see, a warmer bounce off the ground, and
 * an English haze that thickens with distance. Shadows come from a single
 * directional depth map fitted to the ground near the camera.
 */

/** Shared by every pass: the vertex layout and the varyings it produces. */
const VERTEX_HEAD = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aColor;

uniform mat4 uViewProjection;
uniform mat4 uShadowMatrix;

out vec3 vWorld;
out vec3 vNormal;
out vec4 vColor;
out vec4 vShadow;
`;

const VERTEX_BODY = `
  vWorld = aPosition;
  vNormal = aNormal;
  vColor = aColor;
  vShadow = uShadowMatrix * vec4(aPosition, 1.0);
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
`;

/** The lighting, shared by the ground and everything standing on it. */
const LIGHT_CHUNK = `
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uCameraPosition;
uniform sampler2D uShadowMap;
uniform float uShadowTexel;
uniform vec4 uTint;
/**
 * 1 where the machine has a graphics card, 0 where it is rasterising in
 * software. Every branch on it trades a little fidelity for a lot of fill,
 * which is the only thing a software rasteriser is short of.
 */
uniform float uDetail;

in vec3 vWorld;
in vec3 vNormal;
in vec4 vColor;
in vec4 vShadow;
out vec4 fragColor;

/** Percentage-closer filtering, so the shadow edge is soft rather than sawn. */
float shadowFactor(vec3 normal) {
  vec3 coord = vShadow.xyz / vShadow.w;
  coord = coord * 0.5 + 0.5;
  if (coord.z > 1.0 || coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0) return 1.0;
  float slope = clamp(1.0 - dot(normal, uSunDirection), 0.0, 1.0);
  float bias = 0.0016 + 0.0055 * slope;

  // Nine taps per pixel is nothing on a graphics card and most of the frame
  // without one, so software takes the single tap and the harder edge.
  if (uDetail < 0.5) {
    return coord.z - bias > texture(uShadowMap, coord.xy).r ? 0.0 : 1.0;
  }

  float lit = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y)) * uShadowTexel;
      float depth = texture(uShadowMap, coord.xy + offset).r;
      lit += coord.z - bias > depth ? 0.0 : 1.0;
    }
  }
  return lit / 9.0;
}

vec3 shadeSurface(vec3 albedo, vec3 normal, float occlusion) {
  vec3 n = normalize(normal);
  float sun = max(dot(n, uSunDirection), 0.0);
  // A little wrapped light keeps the shaded sides of things readable
  // instead of sinking to black, the way an overcast sky fills them in.
  float wrapped = max((dot(n, uSunDirection) + 0.35) / 1.35, 0.0);
  float shade = shadowFactor(n);
  float sky = 0.5 + 0.5 * n.y;

  vec3 lit = albedo * uSunColor * (sun * 0.78 + wrapped * 0.22) * shade;
  lit += albedo * uSkyColor * sky * occlusion;
  lit += albedo * uGroundColor * (1.0 - sky) * 0.5 * occlusion;
  return lit;
}

vec3 applyFog(vec3 colour) {
  float distance = length(vWorld - uCameraPosition);
  float amount = 1.0 - exp(-pow(distance * uFogDensity, 2.0));
  // Height haze: the valley floor holds more of it than the tops do.
  float lift = clamp(1.0 - (vWorld.y - 4.0) / 46.0, 0.35, 1.0);
  return mix(colour, uFogColor, clamp(amount * lift, 0.0, 0.92));
}

vec3 finish(vec3 colour) {
  colour = mix(colour, uTint.rgb, uTint.a);
  colour = applyFog(colour);
  // Gentle filmic shoulder, so bright limewash rolls off instead of clipping.
  colour = colour / (colour + vec3(0.72)) * 1.72;
  return pow(clamp(colour, 0.0, 1.0), vec3(1.0 / 2.2));
}
`;

/** Value noise in world space, for grain that never repeats visibly. */
const NOISE_CHUNK = `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

export const OBJECT_VERTEX = `${VERTEX_HEAD}
void main() {${VERTEX_BODY}}
`;

export const OBJECT_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;
${LIGHT_CHUNK}
void main() {
  vec3 colour = shadeSurface(vColor.rgb, vNormal, vColor.a);
  fragColor = vec4(finish(colour), 1.0);
}
`;

/**
 * The ground.
 *
 * Two things are added over the object shader: a world-space grain so the
 * turf reads as turf at every distance, and the decal map — zoning, service
 * overlays, the lot grid and whatever the player is currently pointing at —
 * which is sampled in tile space so it drapes exactly over the relief.
 */
export const GROUND_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;
${LIGHT_CHUNK}
${NOISE_CHUNK}
uniform sampler2D uDecal;
uniform vec2 uMapSize;

void main() {
  vec2 tile = vWorld.xz;
  // The broad octave carries the turf; the fine two are what it is made of.
  // Dropping them in software keeps the same mean, so the ground does not
  // change colour — it only loses its close grain.
  float grain = valueNoise(tile * 1.7) * 0.5;
  grain += uDetail > 0.5
    ? valueNoise(tile * 5.3) * 0.3 + valueNoise(tile * 17.0) * 0.2
    : 0.25;
  vec3 albedo = vColor.rgb * (0.88 + grain * 0.24);

  vec4 decal = texture(uDecal, tile / uMapSize);
  albedo = mix(albedo, decal.rgb, decal.a);

  vec3 colour = shadeSurface(albedo, vNormal, vColor.a);
  fragColor = vec4(finish(colour), 1.0);
}
`;

/**
 * Water.
 *
 * The surface is a flat sheet; all of its movement is in the normal, from a
 * pair of crossing wave trains. Depth is baked into the vertex alpha, so
 * the shallows are clearer and greener than the middle of the lake.
 */
export const WATER_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;
${LIGHT_CHUNK}
${NOISE_CHUNK}
uniform float uTime;

void main() {
  vec2 p = vWorld.xz;
  float chop = uDetail > 0.5 ? 1.0 : 0.0;
  float wave =
    sin(p.x * 0.9 + uTime * 0.65) * 0.5 +
    sin((p.x * 0.4 - p.y * 0.7) + uTime * 0.9) * 0.35 +
    chop * valueNoise(p * 2.1 + vec2(uTime * 0.14, uTime * 0.09)) * 0.7;
  float slopeX = cos(p.x * 0.9 + uTime * 0.65) * 0.028
    + chop * (valueNoise(p * 2.1 + vec2(uTime * 0.14, 0.0)) - 0.5) * 0.05;
  float slopeZ = cos(p.y * 0.7 - uTime * 0.9) * 0.024
    + chop * (valueNoise(p * 1.7 - vec2(0.0, uTime * 0.11)) - 0.5) * 0.05;
  vec3 normal = normalize(vec3(-slopeX, 1.0, -slopeZ));

  float depth = vColor.a;
  vec3 albedo = vColor.rgb;

  vec3 view = normalize(uCameraPosition - vWorld);
  float fresnel = pow(1.0 - clamp(dot(view, normal), 0.0, 1.0), 3.0);

  vec3 colour = albedo * uSunColor * max(dot(normal, uSunDirection), 0.0) * 0.35;
  colour += albedo * uSkyColor * 0.9;
  colour = mix(colour, uSkyColor * 1.25, fresnel * 0.65);

  // A specular glint off the low sun, broken up by the same wave train.
  vec3 halfway = normalize(uSunDirection + view);
  float glint = pow(max(dot(normal, halfway), 0.0), 90.0);
  colour += uSunColor * glint * 0.85;

  // Where the water shallows out it thins to nothing over the sand.
  float alpha = mix(0.42, 0.93, depth) + fresnel * 0.25 + wave * 0.01;
  fragColor = vec4(finish(colour), clamp(alpha, 0.0, 1.0));
}
`;

/** The depth-only pass that fills the shadow map. */
export const SHADOW_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
uniform mat4 uViewProjection;
void main() {
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}
`;

export const SHADOW_FRAGMENT = `#version 300 es
precision highp float;
void main() {}
`;

/**
 * The sky: a gradient with the sun's glow in it, drawn across the whole
 * viewport before anything else and never written to the depth buffer.
 */
export const SKY_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
uniform mat4 uInverseViewProjection;
out vec3 vRay;
void main() {
  vec4 far = uInverseViewProjection * vec4(aPosition.xy, 1.0, 1.0);
  vec4 near = uInverseViewProjection * vec4(aPosition.xy, -1.0, 1.0);
  vRay = far.xyz / far.w - near.xyz / near.w;
  gl_Position = vec4(aPosition.xy, 0.9999, 1.0);
}
`;

export const SKY_FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
in vec3 vRay;
out vec4 fragColor;

void main() {
  vec3 direction = normalize(vRay);
  float height = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 colour = mix(uHorizon, uZenith, pow(max(direction.y, 0.0), 0.55));
  // Below the horizon the sky meets the haze over the far country.
  colour = mix(uHorizon, colour, smoothstep(0.44, 0.56, height));

  float toSun = max(dot(direction, uSunDirection), 0.0);
  colour += uSunColor * pow(toSun, 7.0) * 0.35;
  colour += uSunColor * pow(toSun, 220.0) * 1.6;

  colour = colour / (colour + vec3(0.72)) * 1.72;
  fragColor = vec4(pow(clamp(colour, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}
`;
