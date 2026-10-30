import * as THREE from 'three';

// 16-bit (RGB565) color quantization with a 4×4 ordered dither, applied at the
// end of every fragment shader in the scene for that period-correct banding.
// Expects display (sRGB) values, i.e. after any color-space conversion.
export const DITHER_GLSL = /* glsl */ `
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

// Patches one of three's built-in materials to end with the same dither as
// the custom shaders, so lit models match the water and sky. three's own
// dithering hook runs after the sRGB conversion, which is where we want it.
export const applyDither = <M extends THREE.Material>(material: M): M => {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader =
      DITHER_GLSL +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        'gl_FragColor.rgb = dither565(gl_FragColor.rgb);',
      );
  };
  return material;
};
