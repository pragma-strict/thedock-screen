// The ocean's height field, defined once and used three ways: compiled into
// the water's vertex shader (GLSL) to shape the surface, evaluated in
// JavaScript so floating objects ride the exact same waves, and — for the
// finest `pixel` octaves — compiled into the fragment shader as per-pixel
// normal detail.

type WaveOctave = {
  amplitude: number; // meters
  frequency: number; // noise cycles per meter
  drift: [number, number]; // noise-space units per second, in x and z
  // Each octave fades toward `fadeFloor` between these distances, before the
  // water mesh gets too coarse to carry it (otherwise far water shimmers).
  fadeStart: number;
  fadeEnd: number;
  fadeFloor: number;
  // Ridged noise (1 − 2|n|) folds each octave into sharp crests instead of
  // rounded bumps — used for the fine chop.
  ridged?: boolean;
  // Too fine for the mesh to carry: shades the surface per pixel (bends its
  // normal) instead of moving vertices, so it stays crisp at any distance. It
  // also fades out automatically where it would be smaller than a pixel.
  // Doesn't move floating objects.
  pixel?: boolean;
};

export const WAVE_OCTAVES: WaveOctave[] = [
  // Long, slow swell.
  { amplitude: 2.5, frequency: 0.02, drift: [0.012, 0.008], fadeStart: 400, fadeEnd: 1200, fadeFloor: 0.5 },
  { amplitude: 0.2, frequency: 0.06, drift: [0.025, 0.015], fadeStart: 300, fadeEnd: 900, fadeFloor: 0.4 },
  { amplitude: 0.1, frequency: 0.15, drift: [-0.045, 0.035], fadeStart: 120, fadeEnd: 400, fadeFloor: 0 },
  { amplitude: 0.04, frequency: 0.4, drift: [0.07, -0.055], fadeStart: 40, fadeEnd: 140, fadeFloor: 0 },
  // Sharp chop, shaded per pixel.
  { amplitude: 0.005, frequency: 0.9, drift: [-0.12, 0.09], fadeStart: 150, fadeEnd: 400, fadeFloor: 0, ridged: true, pixel: true },
  { amplitude: 0.005, frequency: 1.8, drift: [0.16, 0.13], fadeStart: 100, fadeEnd: 300, fadeFloor: 0, ridged: true, pixel: true },
];

const glslFloat = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

// 2D simplex noise — Ashima Arts / Stefan Gustavson (MIT license).
export const SIMPLEX_GLSL = /* glsl */ `
  vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
`;

const MESH_OCTAVES = WAVE_OCTAVES.filter((o) => !o.pixel);
const PIXEL_OCTAVES = WAVE_OCTAVES.filter((o) => o.pixel);

// GLSL statements adding each octave's height into `h` (uses `t`, `p`,
// `dist`, and a scratch `n`); `extraFade` multiplies in a per-octave fade.
const octavesGlsl = (octaves: WaveOctave[], extraFade = (o: WaveOctave) => '') =>
  octaves
    .map(
      (o) =>
        `n = snoise(p * ${glslFloat(o.frequency)}` +
        ` + vec2(t * ${glslFloat(o.drift[0])}, t * ${glslFloat(o.drift[1])}));\n    ` +
        (o.ridged ? 'n = 1.0 - 2.0 * abs(n);\n    ' : '') +
        `h += ${glslFloat(o.amplitude)} * n * mix(1.0, ${glslFloat(o.fadeFloor)},` +
        ` smoothstep(${glslFloat(o.fadeStart)}, ${glslFloat(o.fadeEnd)}, dist))` +
        `${extraFade(o)};`,
    )
    .join('\n    ');

// Defines `float waterHeight(vec2 p, float dist)` for the mesh octaves;
// expects a `uTime` uniform.
export const WATER_HEIGHT_GLSL = /* glsl */ `
  ${SIMPLEX_GLSL}
  float waterHeight(vec2 p, float dist) {
    float t = uTime;
    float h = 0.0;
    float n;
    ${octavesGlsl(MESH_OCTAVES)}
    return h;
  }
`;

// Defines `float waterDetail(vec2 p, float dist, float footprint)` for the
// pixel octaves, where `footprint` is the world size of one pixel there.
// Expects `uTime` and `snoise` (SIMPLEX_GLSL) to be defined already.
export const WATER_DETAIL_GLSL = /* glsl */ `
  float waterDetail(vec2 p, float dist, float footprint) {
    float t = uTime;
    float h = 0.0;
    float n;
    ${octavesGlsl(
      PIXEL_OCTAVES,
      // Fade out as a pixel grows past ~1/3 of the wavelength (else: shimmer).
      (o) => ` * (1.0 - smoothstep(0.2, 0.4, footprint * ${glslFloat(o.frequency)}))`,
    )}
    return h;
  }
`;

// JavaScript port of the GLSL above — keep the two in step.
const mod289 = (x: number) => x - Math.floor(x / 289) * 289;
const permute = (x: number) => mod289((x * 34 + 1) * x);
const fract = (x: number) => x - Math.floor(x);

const C0 = 0.211324865405187;
const C1 = 0.366025403784439;
const C2 = -0.577350269189626;
const C3 = 0.024390243902439;

// One simplex corner's contribution: falloff weight × gradient · offset.
const corner = (p: number, x: number, y: number) => {
  let m = Math.max(0.5 - (x * x + y * y), 0);
  m = m * m;
  m = m * m;
  const gx = 2 * fract(p * C3) - 1;
  const h = Math.abs(gx) - 0.5;
  const a0 = gx - Math.floor(gx + 0.5);
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  return m * (a0 * x + h * y);
};

export const snoise = (vx: number, vy: number) => {
  const s = (vx + vy) * C1;
  let ix = Math.floor(vx + s);
  let iy = Math.floor(vy + s);
  const t = (ix + iy) * C0;
  const x0 = vx - ix + t;
  const y0 = vy - iy + t;
  const i1x = x0 > y0 ? 1 : 0;
  const i1y = 1 - i1x;
  const x1 = x0 + C0 - i1x;
  const y1 = y0 + C0 - i1y;
  const x2 = x0 + C2;
  const y2 = y0 + C2;
  ix = mod289(ix);
  iy = mod289(iy);
  const p0 = permute(permute(iy) + ix);
  const p1 = permute(permute(iy + i1y) + ix + i1x);
  const p2 = permute(permute(iy + 1) + ix + 1);
  return 130 * (corner(p0, x0, y0) + corner(p1, x1, y1) + corner(p2, x2, y2));
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

// Water surface height (meters) at world (x, z) and time t (seconds); `dist`
// is the point's horizontal distance from the camera. Mesh octaves only — the
// per-pixel chop is too small to move anything.
export const waterHeight = (x: number, z: number, t: number, dist: number) => {
  let h = 0;
  for (const o of MESH_OCTAVES) {
    const fade = 1 + (o.fadeFloor - 1) * smoothstep(o.fadeStart, o.fadeEnd, dist);
    let n = snoise(x * o.frequency + t * o.drift[0], z * o.frequency + t * o.drift[1]);
    if (o.ridged) n = 1 - 2 * Math.abs(n);
    h += o.amplitude * n * fade;
  }
  return h;
};
