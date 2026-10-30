import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { applyDither } from './dither';
import { waterHeight } from './waves';

// theDock logo as an extruded 3D sign floating in the water, standing in for
// the flat logo in the bottom-right corner. Built at runtime from the traced
// SVG: each fill color becomes its own extruded slab, and the whole thing
// rides the same wave field as the water surface, so it bobs and tilts with
// the swell actually passing under it. The water hides whatever is below the
// surface, so it reads as partially submerged.

export const LOGO_SVG_URL = '/theDockLogoSVG_1.svg';

// Where the logo floats, as a point on screen (normalized device coordinates,
// −1…1 from left/bottom) for its waterline, plus its width as a fraction of
// the screen width. Matches where the flat logo sits in the right column.
const LOGO_SCREEN_X = 0.67;
const LOGO_SCREEN_Y = -0.72;
const LOGO_SCREEN_WIDTH = 0.18;
// Extra turn (degrees) beyond facing the camera, to show off the extrusion.
const LOGO_YAW_OFFSET = -14;
// Resting tilt (degrees, counterclockwise as seen from the front) about the
// logo's depth axis: the left end ("the") dips into the water. The wave
// motion rolls it around this.
const LOGO_LIST = 8;

// Proportions relative to the logo's width.
const LOGO_DEPTH = 0.35;
// Keep the bevel well under half the white outline's width (~0.7% of the
// logo's width), or that thin band collapses.
const LOGO_BEVEL = 0.0015;
// How far the bottom edge sits below the surface. Deep enough that the water
// cuts through the body for a visible waterline (it covers most of the
// "CENTRE FOR SOCIAL IMPACT" line).
const LOGO_SUBMERGE = 0.06;

// How strongly the logo follows the water: 1 = rides it exactly. Kept below 1
// and smoothed over BOB_SMOOTHING seconds so the motion stays gentle.
const BOB_AMOUNT = 0.7;
const TILT_AMOUNT = 0.5;
const MAX_TILT = THREE.MathUtils.degToRad(8);
const BOB_SMOOTHING = 0.8;

// Edge sides render as a slightly darker shade of each face color (lighting
// does most of the shading), so the white outline's sides stay white.
const SIDE_SHADE = 0.8;
// Self-illumination as a fraction of each color. Under realistic moonlight the
// logo's dark brown goes near-black; this keeps it reading as the brand
// colors while the lights still shade it into 3D.
const FACE_GLOW = 0.55;
const SIDE_GLOW = 0.22;
// Low curve resolution keeps the edges faceted, like a period model.
const CURVE_SEGMENTS = 4;

// Shapes thinner than this (SVG units) are tracing artifacts, not logo.
const MIN_SHAPE_EXTENT = 2;

// The logo's waterline footprint on the surface, in world meters: a rectangle
// centered at `center`, turned by `yaw`, with half-extents `halfSize`
// (x across the logo, y front to back).
export type Footprint = {
  center: THREE.Vector2;
  yaw: number;
  halfSize: THREE.Vector2;
};

export type FloatingLogo = {
  object: THREE.Object3D;
  // Re-anchor to the camera's current view (call after resizes).
  place: (camera: THREE.PerspectiveCamera) => Footprint;
  update: (time: number, dt: number) => void;
  dispose: () => void;
};

export const loadFloatingLogo = async (): Promise<FloatingLogo> => {
  const data = await new SVGLoader().loadAsync(LOGO_SVG_URL);

  const parts = data.paths
    .map((path) => ({
      color: path.color,
      shapes: SVGLoader.createShapes(path).filter((shape) => {
        const box = new THREE.Box2().setFromPoints(shape.getPoints());
        const size = box.getSize(new THREE.Vector2());
        return size.x > MIN_SHAPE_EXTENT && size.y > MIN_SHAPE_EXTENT;
      }),
    }))
    .filter((part) => part.shapes.length > 0);

  const bounds = new THREE.Box2();
  parts.forEach((part) =>
    part.shapes.forEach((shape) =>
      shape.getPoints().forEach((point) => bounds.expandByPoint(point)),
    ),
  );
  const svgWidth = bounds.max.x - bounds.min.x;

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  // Built in SVG units, then normalized to width 1 so the root's scale is the
  // logo's width in meters.
  const model = new THREE.Group();
  for (const part of parts) {
    const bevel = LOGO_BEVEL * svgWidth;
    const geometry = new THREE.ExtrudeGeometry(part.shapes, {
      depth: LOGO_DEPTH * svgWidth,
      curveSegments: CURVE_SEGMENTS,
      bevelEnabled: true,
      bevelThickness: bevel,
      // The bevel bulges outward slightly; where it overlaps a neighbouring
      // color it's buried inside that shape's volume, so it never shows.
      bevelSize: bevel,
      bevelSegments: 1,
    });
    const face = applyDither(
      new THREE.MeshLambertMaterial({
        color: part.color,
        emissive: part.color.clone().multiplyScalar(FACE_GLOW),
      }),
    );
    const sideColor = part.color.clone().multiplyScalar(SIDE_SHADE);
    const side = applyDither(
      new THREE.MeshLambertMaterial({
        color: sideColor,
        emissive: sideColor.clone().multiplyScalar(SIDE_GLOW),
        flatShading: true,
      }),
    );
    geometries.push(geometry);
    materials.push(face, side);
    // ExtrudeGeometry groups: 0 = front/back caps, 1 = sides.
    model.add(new THREE.Mesh(geometry, [face, side]));
  }
  // SVG y points down: flip y, and z with it (a 180° turn about x, so faces
  // keep their winding). Then center horizontally and in depth, with the
  // bottom edge at y = 0 — the root's origin is the waterline.
  const s = 1 / svgWidth;
  model.scale.set(s, -s, -s);
  model.position.set(
    -(bounds.min.x + svgWidth / 2) * s,
    bounds.max.y * s,
    (LOGO_DEPTH * svgWidth * s) / 2,
  );

  const root = new THREE.Group();
  root.rotation.order = 'YXZ'; // yaw first, then tilt in the logo's own frame
  root.add(model);

  let yaw = 0;
  let cameraPosition = new THREE.Vector3();
  let settled = false;
  const state = { y: 0, pitch: 0, roll: 0 };

  const place = (camera: THREE.PerspectiveCamera): Footprint => {
    camera.updateMatrixWorld();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(LOGO_SCREEN_X, LOGO_SCREEN_Y), camera);
    const anchor = new THREE.Vector3();
    // The anchor ray points below the horizon, so it always meets the water.
    raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), anchor);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const depth = anchor.clone().sub(camera.position).dot(forward);
    const halfWidthTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    root.scale.setScalar(LOGO_SCREEN_WIDTH * 2 * depth * halfWidthTan);
    root.position.set(anchor.x, root.position.y, anchor.z);
    cameraPosition = camera.position.clone();
    yaw =
      Math.atan2(camera.position.x - anchor.x, camera.position.z - anchor.z) +
      THREE.MathUtils.degToRad(LOGO_YAW_OFFSET);
    root.rotation.y = yaw;

    const width = root.scale.x;
    const bevel = LOGO_BEVEL * width;
    return {
      center: new THREE.Vector2(anchor.x, anchor.z),
      yaw,
      halfSize: new THREE.Vector2(width / 2 + bevel, (LOGO_DEPTH * width) / 2 + bevel),
    };
  };

  const update = (time: number, dt: number) => {
    const width = root.scale.x;
    const { x, z } = root.position;
    const dist = Math.hypot(x - cameraPosition.x, z - cameraPosition.z);
    const sample = (dx: number, dz: number) => waterHeight(x + dx, z + dz, time, dist);
    // Sample across the logo's width (its local x) and a shallower span front
    // to back (local z), as if it sat on a float wider than the sign itself.
    const span = width * 0.4;
    const reach = width * 0.2;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const left = sample(-rx * span, -rz * span);
    const right = sample(rx * span, rz * span);
    const front = sample(fx * reach, fz * reach);
    const back = sample(-fx * reach, -fz * reach);
    const center = sample(0, 0);

    const clampTilt = (a: number) => Math.max(-MAX_TILT, Math.min(MAX_TILT, a));
    const target = {
      y: ((left + right + front + back + 2 * center) / 6) * BOB_AMOUNT -
        LOGO_SUBMERGE * width,
      roll: clampTilt(Math.atan((right - left) / (2 * span)) * TILT_AMOUNT),
      pitch: clampTilt(Math.atan((back - front) / (2 * reach)) * TILT_AMOUNT),
    };
    const k = settled ? 1 - Math.exp(-dt / BOB_SMOOTHING) : 1;
    settled = true;
    state.y += (target.y - state.y) * k;
    state.roll += (target.roll - state.roll) * k;
    state.pitch += (target.pitch - state.pitch) * k;

    root.position.y = state.y;
    root.rotation.x = state.pitch;
    root.rotation.z = state.roll + THREE.MathUtils.degToRad(LOGO_LIST);
  };

  const dispose = () => {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
  };

  return { object: root, place, update, dispose };
};
