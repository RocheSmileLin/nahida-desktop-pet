/* ============================================================================
   照片级调色（后处理）—— pet.html 与 viewer.html 共用。

   做法：场景先渲染到 HalfFloat 贴图，再用全屏 quad 调对比度 / 高光 / 阴影。
   alpha 原样保留 → 桌宠窗口透明仍然成立。
   three r144 渲染到 RT 不走 outputEncoding，所以 RT 里是线性值，
   shader 里自己转 sRGB，三项调整都在显示空间里做（和 PS 调整图层一致）。

   用法：
     var pg = NXD.createPhotoGrade(renderer,
                                   function () { return scene; },
                                   function () { return camera; },
                                   function () { needsRender = true; });
     pg.apply({contrast: 2, highlights: -1, shadows: -1});
     pg.resize();          // 窗口尺寸变化时
     pg.render();          // 替代 renderer.render(scene, camera)
   ============================================================================ */
(function () {
  'use strict';

  function createPhotoGrade(renderer, getScene, getCamera, onApply) {
    var GRADE = { contrast: 1.0, highlights: 0.0, shadows: 0.0 };
    var rt = null, scene = null, cam = null, mat = null;

    function resize() {
      if (!rt) { return; }
      var v = new THREE.Vector2();
      renderer.getDrawingBufferSize(v);
      rt.setSize(Math.max(2, v.x), Math.max(2, v.y));
    }

    function active() {
      return GRADE.contrast !== 1 || GRADE.highlights !== 0 || GRADE.shadows !== 0;
    }

    function ensure() {
      if (scene) { return; }
      rt = new THREE.WebGLRenderTarget(2, 2, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat, type: THREE.HalfFloatType,
        depthBuffer: true, stencilBuffer: false
      });
      mat = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: rt.texture },
          uContrast: { value: 1.0 },
          uHigh: { value: 0.0 },
          uShadow: { value: 0.0 }
        },
        vertexShader:
          'varying vec2 vUv;\n' +
          'void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader:
          'varying vec2 vUv;\n' +
          'uniform sampler2D tDiffuse;\n' +
          'uniform float uContrast;\nuniform float uHigh;\nuniform float uShadow;\n' +
          'void main(){\n' +
          '  vec4 c = texture2D(tDiffuse, vUv);\n' +
          '  vec3 col = pow(c.rgb, vec3(1.0 / 2.2));\n' +
          '  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));\n' +
          '  float wS = 1.0 - smoothstep(0.0, 0.65, lum);\n' +
          '  col += uShadow * wS * (1.0 - col) * 0.85;\n' +
          '  float wH = smoothstep(0.35, 1.0, lum);\n' +
          '  col += uHigh * wH * (1.0 - col) * 0.85;\n' +
          '  float ck = uContrast - 1.0;\n' +
          '  if (ck > 0.0) {\n' +
          '    vec3 sc = smoothstep(0.0, 1.0, col);\n' +
          '    col = mix(col, sc, min(ck, 1.0));\n' +
          '  } else if (ck < 0.0) {\n' +
          '    col = mix(col, vec3(0.5), min(-ck * 0.8, 0.8));\n' +
          '  }\n' +
          '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);\n' +
          '}',
        transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.NoBlending          /* alpha 原样保留 → 背景透明仍然有效 */
      });
      scene = new THREE.Scene();
      cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
      resize();
    }

    function apply(v) {
      v = v || {};
      if (v.contrast !== undefined) {
        GRADE.contrast = (v.contrast === null ? 1 : +v.contrast);
        if (!isFinite(GRADE.contrast)) { GRADE.contrast = 1; }
      }
      if (v.highlights !== undefined) { GRADE.highlights = +v.highlights || 0; }
      if (v.shadows !== undefined) { GRADE.shadows = +v.shadows || 0; }
      if (typeof onApply === 'function') { onApply(GRADE); }
    }

    function render() {
      var s = getScene ? getScene() : null;
      var c = getCamera ? getCamera() : null;
      if (!active()) {
        renderer.setRenderTarget(null);
        renderer.render(s, c);
        return;
      }
      ensure();
      mat.uniforms.uContrast.value = GRADE.contrast;
      mat.uniforms.uHigh.value = GRADE.highlights;
      mat.uniforms.uShadow.value = GRADE.shadows;
      renderer.setRenderTarget(rt);
      renderer.render(s, c);
      renderer.setRenderTarget(null);
      renderer.render(scene, cam);
    }

    return {
      GRADE: GRADE,
      resize: resize,
      active: active,
      ensure: ensure,
      apply: apply,
      render: render
    };
  }

  window.NXD = window.NXD || {};
  window.NXD.createPhotoGrade = createPhotoGrade;
})();
