import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { DITHER_GLSL } from './seascape/dither';
import { FloatingLogo, loadFloatingLogo } from './seascape/floatingLogo';
import { SIMPLEX_GLSL, WATER_DETAIL_GLSL, WATER_HEIGHT_GLSL } from './seascape/waves';

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
const PIXEL_SCALE = 4;
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
// Twinkle: how fast (multiplier on each star's own rate) and how deep the
// dips go (0 = steady, 1 = can blink out). Stars near the horizon, seen
// through more air, twinkle harder.
const TWINKLE_SPEED = 0.45;
const TWINKLE_DEPTH = 1.0;

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

// Water opacity looking straight down into it; it turns fully opaque toward
// grazing angles and into the haze. What shows through is the submerged part
// of the logo, or the sky dome's horizon color where there's nothing below.
const WATER_OPACITY = 0.3;

// Froth where the floating logo meets the water: strongest at the hull and
// fading out over FOAM_WIDTH meters, broken up by noise and ripples that
// drift outward.
const FOAM_WIDTH = 0.35;
const FOAM_OPACITY = 0.6;

const COLORS = {
  skyZenith: '#01020a',
  skyHorizon: '#1a2a4a',
  water: '#0b1a30',
  foam: '#c8d4ea',
  moon: '#e6ebf5',
  moonGlow: '#5d7299',
  star: '#d8e0ff',
  // Lighting for the floating logo: cool moonlight from behind it, a soft
  // fill from the viewer's side so its face reads, and a dim ambient.
  moonlight: '#c8d4f0',
  fillLight: '#8fa4d0',
  ambientLight: '#3a4a70',
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

// Shared by water and sky so the water's reflection, fog, and the sky agree.
const SKY_GLSL = /* glsl */ `
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  vec3 skyGradient(float y) {
    return mix(uSkyHorizon, uSkyZenith, smoothstep(0.0, 0.45, y));
  }
`;

const WATER_VERTEX = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  // Height field shared with the floating logo (see seascape/waves.ts).
  ${WATER_HEIGHT_GLSL}

  void main() {
    vec3 p = position;
    float dist = length(p.xz - cameraPosition.xz);
    // Normal from finite differences of the height field.
    const float e = 0.08;
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
  uniform float uOpacity;
  uniform float uTime;
  // The floating logo's waterline footprint: a rectangle on the surface,
  // given by its center, its local x axis (cos/sin of its turn), and its
  // half-size. uFoamOpacity is 0 until the logo is in the scene.
  uniform vec2 uFoamCenter;
  uniform vec2 uFoamAxis;
  uniform vec2 uFoamHalfSize;
  uniform float uFoamWidth;
  uniform float uFoamOpacity;
  uniform vec3 uFoamColor;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  ${SKY_GLSL}
  ${DITHER_GLSL}
  ${SIMPLEX_GLSL}
  ${WATER_DETAIL_GLSL}

  // Signed distance (meters) from a surface point to the footprint's edge.
  float footprintDistance(vec2 p) {
    vec2 d = p - uFoamCenter;
    vec2 local = vec2(dot(d, vec2(uFoamAxis.x, -uFoamAxis.y)),
                      dot(d, vec2(uFoamAxis.y, uFoamAxis.x)));
    vec2 q = abs(local) - uFoamHalfSize;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  }

  float foamAmount(vec2 p) {
    float d = max(footprintDistance(p), 0.0);
    float falloff = exp(-d / uFoamWidth);
    // Rings drifting outward from the hull, broken up by slow noise.
    float ripple = 0.5 + 0.5 * sin(d * 9.0 - uTime * 1.6);
    float breakup = 0.5 + 0.5 * snoise(p * 2.2 + vec2(uTime * 0.15, -uTime * 0.1));
    float froth = falloff * (0.45 + 0.35 * breakup + 0.2 * ripple);
    return smoothstep(0.5, 0.75, froth) * uFoamOpacity;
  }

  void main() {
    vec3 toCamera = cameraPosition - vWorldPos;
    float dist = length(toCamera);
    vec3 v = toCamera / dist;

    // Fine chop bends the mesh normal per pixel: add the detail octaves'
    // slope (finite differences) to the mesh surface's slope.
    vec2 p = vWorldPos.xz;
    float footprint = max(length(dFdx(p)), length(dFdy(p)));
    float flatDist = length(p - cameraPosition.xz);
    const float de = 0.02;
    float d0 = waterDetail(p, flatDist, footprint);
    float dhdx = (waterDetail(p + vec2(de, 0.0), flatDist, footprint) - d0) / de;
    float dhdz = (waterDetail(p + vec2(0.0, de), flatDist, footprint) - d0) / de;
    vec3 meshNormal = normalize(vNormal);
    vec3 n = normalize(vec3(meshNormal.x / meshNormal.y - dhdx, 1.0,
                            meshNormal.z / meshNormal.y - dhdz));

    // Silvery look: reflect a brightened version of the sky, weighted by a
    // Fresnel term, over a dim moonlit base.
    vec3 r = reflect(-v, n);
    // A deliberately broad, bright gradient (not the true sky) so the
    // reflection varies smoothly across each swell — that's the "plastic".
    vec3 env = mix(uSkyHorizon * 1.8, uSkyZenith + uSkyHorizon * 0.3,
                   smoothstep(-0.1, 0.7, r.y));
    float fresnel = 0.15 + 0.85 * pow(1.0 - max(dot(n, v), 0.0), 10.0);
    vec3 color = uWaterColor * (0.35 + 0.65 * max(dot(n, uMoonDir), 0.0));
    color = mix(color, env, fresnel);

    // Plastic sheen: a broad soft highlight plus a tight one that forms the
    // moon's glitter path.
    vec3 halfway = normalize(uMoonDir + v);
    float nh = max(dot(n, halfway), 0.0);
    float glint = 0.35 * pow(nh, 600.0);
    color += uMoonColor * (0.12 * pow(nh, 12.0) + glint);

    float foam = foamAmount(vWorldPos.xz);
    color = mix(color, uFoamColor, foam);

    float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
    color = mix(color, skyGradient(0.0), fog);

    // See-through when looking down into it; glints, froth and haze stay solid.
    float alpha = mix(uOpacity, 1.0, fresnel);
    alpha = max(alpha, max(max(fog, foam), min(glint, 1.0)));

    gl_FragColor = vec4(dither565(color), alpha);
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
  uniform float uTwinkleSpeed;
  uniform float uTwinkleDepth;
  attribute float aSize;
  attribute float aBrightness;
  attribute float aPhase;
  varying float vAlpha;
  void main() {
    float elevation = normalize(position).y;
    // Two out-of-step waves per star make an irregular flicker; squaring the
    // dip keeps stars mostly bright with occasional sharp drops.
    float t = uTime * uTwinkleSpeed;
    float rate = 2.0 + aPhase * 4.0;
    float wave = 0.5 + 0.25 * (sin(t * rate + aPhase * 6.2831) +
                               sin(t * rate * 2.37 + aPhase * 17.0));
    float depth = uTwinkleDepth * mix(1.0, 0.5, smoothstep(0.0, 0.6, elevation));
    float twinkle = 1.0 - depth * pow(1.0 - wave, 2.0);
    // Stars dim into the haze near the horizon.
    float haze = smoothstep(0.0, 0.2, elevation);
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
      // Counter-clockwise seen from above, so the surface faces up (row b is
      // farther from the camera than row a).
      indices.push(a, a + 1, b, a + 1, b + 1, b);
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

export default function MidnightSeascape({
  onLogoReady,
}: {
  // Called once the 3D logo is in the scene, so the page can hide its flat one.
  onLogoReady?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onLogoReadyRef = useRef(onLogoReady);
  onLogoReadyRef.current = onLogoReady;

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
        uOpacity: { value: WATER_OPACITY },
        uFoamCenter: { value: new THREE.Vector2() },
        uFoamAxis: { value: new THREE.Vector2(1, 0) },
        uFoamHalfSize: { value: new THREE.Vector2() },
        uFoamWidth: { value: FOAM_WIDTH },
        uFoamOpacity: { value: 0 },
        uFoamColor: { value: hexToVec3(COLORS.foam) },
      },
    });
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.frustumCulled = false; // vertices are displaced in the shader
    waterMaterial.transparent = true;

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
        uTwinkleSpeed: { value: TWINKLE_SPEED },
        uTwinkleDepth: { value: TWINKLE_DEPTH },
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

    // Only the floating logo uses three's lights; water and sky shade
    // themselves.
    const moonlight = new THREE.DirectionalLight(COLORS.moonlight, 1.6);
    moonlight.position.copy(moonDirection).multiplyScalar(100);
    const fillLight = new THREE.DirectionalLight(COLORS.fillLight, 3);
    fillLight.position.set(-20, 25, 40);
    scene.add(moonlight, fillLight, new THREE.AmbientLight(COLORS.ambientLight, 2.5));

    let logo: FloatingLogo | null = null;
    // Anchor the logo in view and point the water's froth at its footprint.
    const placeLogo = () => {
      if (!logo) return;
      const { center, yaw, halfSize } = logo.place(camera);
      const foam = waterMaterial.uniforms;
      foam.uFoamCenter.value.copy(center);
      foam.uFoamAxis.value.set(Math.cos(yaw), Math.sin(yaw));
      foam.uFoamHalfSize.value.copy(halfSize);
    };
    let disposed = false;
    loadFloatingLogo()
      .then((loaded) => {
        if (disposed) {
          loaded.dispose();
          return;
        }
        logo = loaded;
        placeLogo();
        scene.add(logo.object);
        waterMaterial.uniforms.uFoamOpacity.value = FOAM_OPACITY;
        onLogoReadyRef.current?.();
      })
      .catch((e) => console.error('Floating logo unavailable', e));

    const resize = () => {
      const width = Math.max(1, Math.round(window.innerWidth / PIXEL_SCALE));
      const height = Math.max(1, Math.round(window.innerHeight / PIXEL_SCALE));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      placeLogo();
    };
    resize();
    window.addEventListener('resize', resize);

    const start = performance.now();
    let lastFrame = -Infinity;
    let frameId = requestAnimationFrame(function frame(now) {
      frameId = requestAnimationFrame(frame);
      if (now - lastFrame < FRAME_INTERVAL_MS) return;
      const dt = Math.min((now - lastFrame) / 1000, 0.25);
      lastFrame = now;
      time.value = (now - start) / 1000;
      logo?.update(time.value, dt);
      renderer.render(scene, camera);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
      waterGeometry.dispose();
      waterMaterial.dispose();
      skyGeometry.dispose();
      skyMaterial.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      logo?.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className='midnight-seascape' />;
}
