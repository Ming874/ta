import * as THREE from 'three';
import { parseLayout } from './levels.js';
import { createDressCtx } from './props/ctx.js';
import { dressWorld } from './props/index.js';
import { Buckets } from './hospital/builder.js';
import { createShellContext, buildFloors, buildWalls, buildWindowCells, buildCeilings, buildVaults, buildPipes } from './hospital/shell.js';
import { procStats } from './hospital/proctex.js';
import { pbrState } from './hospital/pbr.js';

// 聖心醫院本體:依 levels.js 的四層佈局建出結構(牆/地板/天花板/門窗/樓梯/欄杆/戶外)、材質、燈光、氛圍與腳本驚嚇。
// 細節在 src/map/hospital/*;這裡只負責組裝與每幀更新。
export function buildHospital(world, layout, scene) {
  const t0 = performance.now();
  const L = layout || world?.layout || parseLayout();
  const root = new THREE.Group();
  root.name = 'hospital';
  const levels = L.levels.map((lv) => {
    const g = new THREE.Group();
    g.name = 'level-' + lv.id;
    root.add(g);
    return g;
  });

  // ---- 結構 ----
  const B = new Buckets();
  const K = createShellContext(L, B);
  buildFloors(K);
  buildWalls(K);
  buildWindowCells(K);
  buildCeilings(K);
  buildVaults(K);
  buildPipes(K);
  const tris = B.tris;
  const meshes = B.build(levels);
  const tShell = performance.now();

  // ---- 道具 ----
  const ctx = createDressCtx({ layout: L, world, group: root });
  dressWorld(ctx);
  const { lights: propLights, events: propEvents } = ctx.finalize();
  void propLights; void propEvents;

  // ---- 暫時的光源 ----
  const hemi = new THREE.HemisphereLight(0x8090a8, 0x201c18, 0.35);
  root.add(hemi);
  const moon = new THREE.DirectionalLight(0x9fb4e0, 0.9);
  moon.position.set(75, 60, 110);
  moon.target.position.set(60, 0, 50);
  root.add(moon, moon.target);

  const stats = { buildMs: Math.round(performance.now() - t0), shellMs: Math.round(tShell - t0), meshes: meshes.length, tris, proc: procStats, pbr: pbrState };
  console.log('[hospital] build', JSON.stringify(stats));
  return {
    group: root,
    stats,
    update(time, dt, player) {
      void time; void dt; void player;
    },
  };
}
