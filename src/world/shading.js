import * as THREE from 'three';

// Changes to three.js's built-in shaders that every lit material shares:
//
// 1. Fog becomes aerial perspective plus valley mist. The distance haze glows
//    towards the sun, and a height fog (thick on valley floors, thin on the
//    ridges, patchy) is added on top.
// 2. Shadows come from two maps: a sharp one that follows the hunter and a
//    soft one covering the whole hunting ground (long hill and tree shadows at
//    dawn and dusk). The near map fades into the far map at its edges.
//
// The mist values live in plain objects that every material shares by
// reference (three.js copies Vector uniforms per material but not plain
// objects), so Atmosphere only has to update them once per frame.

export const mistParams = { x: 0, y: 0, z: 30, w: 0 }; // density, base height, falloff, patchiness
export const mistColor = { x: 0.8, y: 0.82, z: 0.85 };
export const sunScatter = { x: 0, y: 0, z: 0 }; // sun-coloured haze glow (rgb)
export const sunDirection = { x: 0, y: 1, z: 0 };
// a number would be copied per material, so time is kept in an object too
export const mistTime = { x: 0, y: 0 };
// aerial perspective: x = how clear the air is (1: gradual blue haze that
// thins with height; 0: the plain fog wall), y = valley floor height
export const aerial = { x: 1, y: 0 };

// How wet the ground is (0..1, from the weather). Materials that get wet
// (terrain, stone, grass) add this very uniform object to their shaders in
// onBeforeCompile, so one write a frame reaches them all. Water fills the
// pores of soil and stone, so less light scatters back out (darker) and the
// surface picks up a sheen (smoother).
export const wetness = { value: 0 };

const extra = {
  uMist: { value: mistParams },
  uMistColor: { value: mistColor },
  uSunScatter: { value: sunScatter },
  uSunDirF: { value: sunDirection },
  uMistTime: { value: mistTime },
  uAerial: { value: aerial },
};

for (const key of Object.keys(THREE.ShaderLib)) {
  const lib = THREE.ShaderLib[key];
  if (lib.uniforms && lib.uniforms.fogColor) Object.assign(lib.uniforms, extra);
}

const C = THREE.ShaderChunk;

C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif
`;

C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // view space back to world space (the view matrix is rigid)
  vFogWorld = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );
#endif
`;

C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  uniform vec4 uMist;
  uniform vec3 uMistColor;
  uniform vec3 uSunScatter;
  uniform vec3 uSunDirF;
  uniform vec2 uMistTime;
  uniform vec2 uAerial;
  float lbhFogHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float lbhFogNoise( vec2 p ) {
    vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( lbhFogHash( i ), lbhFogHash( i + vec2( 1, 0 ) ), f.x ), mix( lbhFogHash( i + vec2( 0, 1 ) ), lbhFogHash( i + vec2( 1, 1 ) ), f.x ), f.y );
  }
#endif
`;

C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  {
    vec3 fogRay = vFogWorld - cameraPosition;
    float fogDist = length( fogRay );
    vec3 fogDir = fogRay / max( fogDist, 1e-3 );
    float sunAmt = pow( max( dot( fogDir, uSunDirF ), 0.0 ), 5.0 );
    vec3 hazeCol = fogColor + uSunScatter * sunAmt;
    #ifdef FOG_EXP2
      // Aerial perspective. The fog's own exp2 curve (clear close by, a wall
      // far off) is what fog and rain need; clear air instead thickens
      // steadily with distance, thins with height (scale height ~1.1 km above
      // the valley floor) and takes the blue out first, so far ridges step
      // back in layers of blue haze rather than vanishing into white.
      float fz = fogDensity * vFogDepth;
      float hAvg = max( 0.0, 0.5 * ( cameraPosition.y + vFogWorld.y ) - uAerial.y );
      float thin = mix( 1.0, exp( - hAvg / 1600.0 ), uAerial.x );
      float odG = ( fz * fz * ( 1.0 - 0.45 * uAerial.x ) + fz * 0.55 * uAerial.x ) * thin;
      // the haze itself is the sky's colour (fogColor); what lies behind it
      // loses its blue first
      vec3 fogT = exp( - odG * mix( vec3( 1.0 ), vec3( 0.86, 0.98, 1.16 ), uAerial.x ) );
      gl_FragColor.rgb *= fogT / max( exp( - odG ), 1e-4 );
      vec3 fogFactor3 = vec3( 1.0 - exp( - odG ) );
    #else
      vec3 fogFactor3 = vec3( smoothstep( fogNear, fogFar, vFogDepth ) );
    #endif
    if ( uMist.x > 0.0 ) {
      // optical depth of exp(-(y - base) / falloff) integrated along the ray
      float k = 1.0 / uMist.z;
      float h0 = clamp( ( cameraPosition.y - uMist.y ) * k, -8.0, 60.0 );
      float dyk = clamp( fogRay.y * k, -60.0, 60.0 );
      float rd = abs( dyk ) > 1e-3 ? ( 1.0 - exp( - dyk ) ) / dyk : 1.0;
      float od = uMist.x * exp( - h0 ) * fogDist * rd;
      // drifting banks: thicker and thinner patches
      vec2 np = vFogWorld.xz * 0.0045 + uMistTime.x * vec2( 0.006, 0.0025 );
      float mistPatch = lbhFogNoise( np ) * 0.65 + lbhFogNoise( np * 2.7 + 3.1 ) * 0.35;
      od *= mix( 1.0, smoothstep( 0.15, 0.85, mistPatch ) * 1.8, uMist.w );
      float mistF = 1.0 - exp( - od );
      vec3 mistCol = uMistColor + uSunScatter * sunAmt * 0.7;
      gl_FragColor.rgb = mix( gl_FragColor.rgb, mistCol, mistF );
    }
    gl_FragColor.rgb = mix( gl_FragColor.rgb, hazeCol, fogFactor3 );
  }
#endif
`;

// ---- two-level directional shadows ----
// Directional light 0 is the sun with the near map; light 1 (zero intensity)
// only exists to own the far map. Light 1 is never shaded with shadows.
// Inside the near map, the far map still darkens areas a distant hill puts in
// shade (its soft fringes are ignored so nearby shadows stay crisp).

C.shadowmap_pars_fragment += /* glsl */ `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1
  float lbhShadow( float nearShadow, vec4 nearCoord ) {
    vec2 sc = nearCoord.xy / nearCoord.w;
    float edge = max( abs( sc.x - 0.5 ), abs( sc.y - 0.5 ) ) * 2.0;
    float w = smoothstep( 0.72, 0.96, edge );
    DirectionalLightShadow fs = directionalLightShadows[ 1 ];
    float farShadow = getShadow( directionalShadowMap[ 1 ], fs.shadowMapSize, fs.shadowIntensity, fs.shadowBias, fs.shadowRadius, vDirectionalShadowCoord[ 1 ] );
    float inner = min( nearShadow, smoothstep( 0.0, 0.6, farShadow ) );
    return mix( inner, farShadow, w );
  }
#elif defined( USE_SHADOWMAP )
  float lbhShadow( float nearShadow, vec4 nearCoord ) { return nearShadow; }
#endif
`;

const SHADOW_LINE =
  'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
if (C.lights_fragment_begin.includes(SHADOW_LINE)) {
  C.lights_fragment_begin = C.lights_fragment_begin
    .replace(
      '#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )\n\t\tdirectionalLightShadow',
      '#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS ) && ( UNROLLED_LOOP_INDEX == 0 )\n\t\tdirectionalLightShadow'
    )
    .replace(
      SHADOW_LINE,
      'directLight.color *= ( directLight.visible && receiveShadow ) ? lbhShadow( getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ), vDirectionalShadowCoord[ i ] ) : 1.0;'
    );
} else {
  console.warn('lights_fragment_begin changed; far shadows disabled');
}
