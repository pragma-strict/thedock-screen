import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Midnight-mode background: a static camera a few meters above an endless,
// slowly heaving ocean under a star field and a low moon. The look is aimed at
// an early-2000s Windows screensaver — silvery "plastic" water, a hard-edged
// moon, square star pixels — helped along by rendering at reduced resolution
// (upscaled with nearest-neighbour) and quantizing to 16-bit color with an
// ordered dither.
//
// Everything is tuned via the constants below; the water and sky are custom
// shaders so the whole scene costs a single small draw per object per frame.

// Render resolution divisor. 2 → a 1080p screen renders at 960×540.
const PIXEL_SCALE = 2;
// The scene moves slowly, so 30fps looks the same and halves the GPU work.
const FRAME_INTERVAL_MS = 1000 / 30;

const CAMERA_HEIGHT = 3; // meters above the mean water level
const CAMERA_FOV = 50; // vertical, degrees
// Fraction of the screen height (from the bottom) where the horizon sits.
const HORIZON_SCREEN_FRACTION = 1 / 3;

// Moon position: degrees above the horizon, and degrees right of straight
// ahead. Placed so it sits in the right-hand column between clock and logo.
const MOON_ELEVATION = 9;
const MOON_AZIMUTH = 20;
const MOON_ANGULAR_RADIUS = 1.6; // degrees

const STAR_COUNT = 1500;

// Water mesh: rows spaced geometrically with distance so detail is dense near
// the camera and sparse toward the horizon, and each row only as wide as the
// view needs. The far edge is lost in the haze, so it reads as infinite.
const WATER_NEAR = 4;
const WATER_FAR = 1200;
const WATER_ROWS = 220;
const WATER_COLS = 160;
// Half-width of a row relative to its distance; covers aspect ratios to ~2.4.
const WATER_WIDTH_FACTOR = 1.3;

const FOG_DENSITY = 0.0025;

const COLORS = {
  skyZenith: '#01020a',
  skyHorizon: '#1a2a4a',
  water: '#0b1a30',
  moon: '#e6ebf5',
  moonGlow: '#5d7299',
  star: '#d8e0ff',
};

// Colors are passed to the shaders as raw display values (no linear/sRGB
// conversion happens in these ShaderMaterials), so build them by hand rather
// than through THREE.Color, which would linearize them.
const hexToVec3 = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
  );
};

const degToRad = THREE.MathUtils.degToRad;

const moonDirection = new THREE.Vector3(
  Math.sin(degToRad(MOON_AZIMUTH)) * Math.cos(degToRad(MOON_ELEVATION)),
  Math.sin(degToRad(MOON_ELEVATION)),
  -Math.cos(degToRad(MOON_AZIMUTH)) * Math.cos(degToRad(MOON_ELEVATION)),
).normalize();

// 16-bit (RGB565) color quantization with a 4×4 ordered dither, applied at the
// end of every fragment shader for that period-correct banding.
const DITHER_GLSL = /* glsl */ `
  float bayer2(vec2 a) {
    a = floor(a);
    return fract(a.x / 2.0 + a.y * a.y * 0.75);
  }
  float bayer4(vec2 a) {
    return bayer2(0.5 * a) * 0.25 + bayer2(a);
  }
  vec3 dither565(vec3 color) {
    vec3 levels = vec3(31.0, 63.0, 31.0);
    float threshold = bayer4(gl_FragCoord.xy);
    return floor(clamp(color, 0.0, 1.0) * levels + threshold) / levels;
  }
`;

// Shared by water and sky so the water's reflection, fog, and the sky agree.
const SKY_GLSL = /* glsl */ `
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  vec3 skyGradient(float y) {
    return mix(uSkyHorizon, uSkyZenith, smoothstep(0.0, 0.45, y));
  }
`;

// 2D simplex noise — Ashima Arts / Stefan Gustavson (MIT license).
const SIMPLEX_GLSL = /* glsl */ `
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

const WATER_VERTEX = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  ${SIMPLEX_GLSL}

  // Three octaves of drifting noise. Each octave fades out with distance
  // before the mesh gets too coarse to carry it, which keeps the far water
  // from shimmering.
  float waterHeight(vec2 p, float dist) {
    float t = uTime;
    float h = 0.0;
    h += 0.60 * snoise(p * 0.06 + vec2(t * 0.025, t * 0.015))
             * mix(1.0, 0.4, smoothstep(300.0, 900.0, dist));
    h += 0.30 * snoise(p * 0.15 + vec2(-t * 0.045, t * 0.035))
             * (1.0 - smoothstep(120.0, 400.0, dist));
    h += 0.12 * snoise(p * 0.40 + vec2(t * 0.070, -t * 0.055))
             * (1.0 - smoothstep(40.0, 140.0, dist));
    return h;
  }

  void main() {
    vec3 p = position;
    float dist = length(p.xz - cameraPosition.xz);
    // Normal from finite differences of the height field.
    const float e = 0.25;
    float h = waterHeight(p.xz, dist);
    float hx = waterHeight(p.xz + vec2(e, 0.0), dist);
    float hz = waterHeight(p.xz + vec2(0.0, e), dist);
    vNormal = normalize(vec3(h - hx, e, h - hz));
    p.y += h;
    vWorldPos = p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  uniform vec3 uMoonDir;
  uniform vec3 uMoonColor;
  uniform vec3 uWaterColor;
  uniform float uFogDensity;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  ${SKY_GLSL}
  ${DITHER_GLSL}

  void main() {
    vec3 n = normalize(vNormal);
    vec3 toCamera = cameraPosition - vWorldPos;
    float dist = length(toCamera);
    vec3 v = toCamera / dist;

    // Silvery look: reflect a brightened version of the sky, weighted by a
    // Fresnel term, over a dim moonlit base.
    vec3 r = reflect(-v, n);
    // A deliberately broad, bright gradient (not the true sky) so the
    // reflection varies smoothly across each swell — that's the "plastic".
    vec3 env = mix(uSkyHorizon * 1.8, uSkyZenith + uSkyHorizon * 0.3,
                   smoothstep(-0.1, 0.7, r.y));
    float fresnel = 0.15 + 0.85 * pow(1.0 - max(dot(n, v), 0.0), 3.0);
    vec3 color = uWaterColor * (0.35 + 0.65 * max(dot(n, uMoonDir), 0.0));
    color = mix(color, env, fresnel);

    // Plastic sheen: a broad soft highlight plus a tight one that forms the
    // moon's glitter path.
    vec3 halfway = normalize(uMoonDir + v);
    float nh = max(dot(n, halfway), 0.0);
    color += uMoonColor * (0.22 * pow(nh, 12.0) + 0.75 * pow(nh, 120.0));

    float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
    color = mix(color, skyGradient(0.0), fog);

    gl_FragColor = vec4(dither565(color), 1.0);
  }
`;

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uMoonDir;
  uniform vec3 uMoonColor;
  uniform vec3 uMoonGlow;
  uniform float uMoonCos;
  varying vec3 vDirection;
  ${SKY_GLSL}
  ${DITHER_GLSL}

  void main() {
    vec3 dir = normalize(vDirection);
    vec3 color = skyGradient(dir.y);
    float m = dot(dir, uMoonDir);
    color += uMoonGlow * (0.35 * pow(max(m, 0.0), 400.0) + 0.12 * pow(max(m, 0.0), 30.0));
    // Hard-edged disc with a little limb darkening.
    if (m > uMoonCos) {
      float edge = (m - uMoonCos) / (1.0 - uMoonCos);
      color = uMoonColor * (0.82 + 0.18 * sqrt(edge));
    }
    gl_FragColor = vec4(dither565(color), 1.0);
  }
`;

const STAR_VERTEX = /* glsl */ `
  uniform float uTime;
  attribute float aSize;
  attribute float aBrightness;
  attribute float aPhase;
  varying float vAlpha;
  void main() {
    float twinkle = 0.7 + 0.3 * sin(uTime * (0.6 + aPhase * 0.25) + aPhase * 6.2831);
    // Stars dim into the haze near the horizon.
    float haze = smoothstep(0.0, 0.2, normalize(position).y);
    vAlpha = aBrightness * twinkle * haze;
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  uniform vec3 uStarColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uStarColor * vAlpha, 1.0);
  }
`;

const buildWaterGeometry = () => {
  const positions = new Float32Array(WATER_ROWS * WATER_COLS * 3);
  for (let row = 0; row < WATER_ROWS; row++) {
    const distance =
      WATER_NEAR * Math.pow(WATER_FAR / WATER_NEAR, row / (WATER_ROWS - 1));
    const halfWidth = distance * WATER_WIDTH_FACTOR + 5;
    for (let col = 0; col < WATER_COLS; col++) {
      const i = (row * WATER_COLS + col) * 3;
      positions[i] = -halfWidth + (2 * halfWidth * col) / (WATER_COLS - 1);
      positions[i + 1] = 0;
      positions[i + 2] = -distance;
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < WATER_ROWS - 1; row++) {
    for (let col = 0; col < WATER_COLS - 1; col++) {
      const a = row * WATER_COLS + col;
      const b = a + WATER_COLS;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
};

const buildStarGeometry = () => {
  const radius = 1400;
  const positions = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  const brightness = new Float32Array(STAR_COUNT);
  const phases = new Float32Array(STAR_COUNT);
  const moonClearance = Math.cos(degToRad(MOON_ANGULAR_RADIUS * 3));
  const direction = new THREE.Vector3();
  let placed = 0;
  while (placed < STAR_COUNT) {
    // Uniform over the upper hemisphere.
    const y = Math.random();
    const theta = Math.random() * Math.PI * 2;
    const ring = Math.sqrt(1 - y * y);
    direction.set(ring * Math.cos(theta), y, ring * Math.sin(theta));
    if (direction.dot(moonDirection) > moonClearance) continue;
    direction.multiplyScalar(radius).toArray(positions, placed * 3);
    // Mostly faint single pixels, with the occasional bright 2×2 star.
    const b = Math.pow(Math.random(), 3);
    brightness[placed] = 0.25 + 0.75 * b;
    sizes[placed] = b > 0.6 ? 2 : 1;
    phases[placed] = Math.random();
    placed++;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  return geometry;
};

export default function MidnightSeascape() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    } catch (e) {
      // No WebGL: fall back to the plain black background.
      console.error('Midnight mode unavailable', e);
      return;
    }
    renderer.setPixelRatio(1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 3000);
    camera.position.set(0, CAMERA_HEIGHT, 0);
    // Tilt up so the horizon (straight ahead) lands at HORIZON_SCREEN_FRACTION
    // from the bottom instead of the middle of the screen.
    const halfFovTan = Math.tan(degToRad(CAMERA_FOV / 2));
    camera.rotation.x = Math.atan(halfFovTan * (1 - 2 * HORIZON_SCREEN_FRACTION));

    const sky = {
      uSkyZenith: { value: hexToVec3(COLORS.skyZenith) },
      uSkyHorizon: { value: hexToVec3(COLORS.skyHorizon) },
    };
    const moon = {
      uMoonDir: { value: moonDirection },
      uMoonColor: { value: hexToVec3(COLORS.moon) },
    };
    const time = { value: 0 };

    const waterGeometry = buildWaterGeometry();
    const waterMaterial = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      uniforms: {
        ...sky,
        ...moon,
        uTime: time,
        uWaterColor: { value: hexToVec3(COLORS.water) },
        uFogDensity: { value: FOG_DENSITY },
      },
    });
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.frustumCulled = false; // vertices are displaced in the shader

    const skyGeometry = new THREE.SphereGeometry(2000, 32, 16);
    const skyMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        ...sky,
        ...moon,
        uMoonGlow: { value: hexToVec3(COLORS.moonGlow) },
        uMoonCos: { value: Math.cos(degToRad(MOON_ANGULAR_RADIUS)) },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    const skyDome = new THREE.Mesh(skyGeometry, skyMaterial);
    skyDome.position.copy(camera.position);
    skyDome.renderOrder = -2;

    const starGeometry = buildStarGeometry();
    const starMaterial = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: {
        uTime: time,
        uStarColor: { value: hexToVec3(COLORS.star) },
      },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const stars = new THREE.Points(starGeometry, starMaterial);
    stars.position.copy(camera.position);
    stars.renderOrder = -1;

    scene.add(skyDome, stars, water);

    const resize = () => {
      const width = Math.max(1, Math.round(window.innerWidth / PIXEL_SCALE));
      const height = Math.max(1, Math.round(window.innerHeight / PIXEL_SCALE));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    const start = performance.now();
    let lastFrame = -Infinity;
    let frameId = requestAnimationFrame(function frame(now) {
      frameId = requestAnimationFrame(frame);
      if (now - lastFrame < FRAME_INTERVAL_MS) return;
      lastFrame = now;
      time.value = (now - start) / 1000;
      renderer.render(scene, camera);
    });

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
      waterGeometry.dispose();
      waterMaterial.dispose();
      skyGeometry.dispose();
      skyMaterial.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className='midnight-seascape' />;
}
