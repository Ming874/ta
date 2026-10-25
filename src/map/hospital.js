import * as THREE from 'three';
import { CELL, WALL_H } from './layout.js';
import {
  rnd, makeWallTexture, makeFloorTexture, makeCeilingTexture, makeMetalTexture, makeFabricTexture,
  makeBloodSplat, makeBloodWall, makeCrackDecal, makePaper,
} from './textures.js';

const rr = (a, b) => a + rnd() * (b - a);

export function buildHospital(world) {
  const group = new THREE.Group();
  const flickers = [];

  // ---------- 材質 ----------
  const wallTex = makeWallTexture();
  const floorTex = makeFloorTexture();
  floorTex.repeat.set(world.sizeX / 4, world.sizeZ / 4);
  const ceilTex = makeCeilingTexture();
  ceilTex.repeat.set(world.sizeX / 4, world.sizeZ / 4);
  const metalTex = makeMetalTexture();
  const fabricTex = makeFabricTexture();

  const matWall = new THREE.MeshStandardMaterial({ map: wallTex, bumpMap: wallTex, bumpScale: 1.2, roughness: 0.95, metalness: 0 });
  const matFloor = new THREE.MeshStandardMaterial({ map: floorTex, bumpMap: floorTex, bumpScale: 0.8, roughness: 0.55, metalness: 0.02 });
  const matCeil = new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.95 });
  const matMetal = new THREE.MeshStandardMaterial({ map: metalTex, color: 0xbab6ac, roughness: 0.55, metalness: 0.75 });
  const matDarkMetal = new THREE.MeshStandardMaterial({ color: 0x2a2c2c, roughness: 0.6, metalness: 0.6 });
  const matFabric = new THREE.MeshStandardMaterial({ map: fabricTex, roughness: 0.95 });
  const matWood = new THREE.MeshStandardMaterial({ color: 0x5a4430, roughness: 0.85 });
  const matPlastic = new THREE.MeshStandardMaterial({ color: 0x3f6f78, roughness: 0.6 });
  const matConcrete = new THREE.MeshStandardMaterial({ color: 0x6f6d66, roughness: 1 });
  const matTeal = new THREE.MeshStandardMaterial({ color: 0x4d6f69, roughness: 0.7 });
  const matLightOn = new THREE.MeshStandardMaterial({ color: 0xdfe8e0, emissive: 0xcfe6d8, emissiveIntensity: 2.2 });
  const matLightOff = new THREE.MeshStandardMaterial({ color: 0x555a56, roughness: 0.6 });

  // ---------- 牆(只生成外露面,UV 採世界座標連續) ----------
  const pos = [], nor = [], uvs = [], idx = [];
  const exposed = [];
  const H = WALL_H;
  const U = 1 / 3.2;
  const quad = (v, n, u) => {
    const base = pos.length / 3;
    for (let i = 0; i < 4; i++) {
      pos.push(...v[i]);
      nor.push(...n);
      uvs.push(u[i][0], u[i][1]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let r = 0; r < world.h; r++) {
    for (let c = 0; c < world.w; c++) {
      if (!world.isSolidCell(c, r) || r < 0) continue;
      const x0 = c * CELL, x1 = x0 + CELL, z0 = r * CELL, z1 = z0 + CELL;
      const open = (cc, rrr) => cc >= 0 && rrr >= 0 && cc < world.w && rrr < world.h && !world.isSolidCell(cc, rrr);
      if (open(c, r + 1)) { // +z
        quad([[x0, 0, z1], [x1, 0, z1], [x1, H, z1], [x0, H, z1]], [0, 0, 1], [[x0 * U, 0], [x1 * U, 0], [x1 * U, 1], [x0 * U, 1]]);
        exposed.push({ x: (x0 + x1) / 2, z: z1, nx: 0, nz: 1 });
      }
      if (open(c, r - 1)) { // -z
        quad([[x1, 0, z0], [x0, 0, z0], [x0, H, z0], [x1, H, z0]], [0, 0, -1], [[x1 * U, 0], [x0 * U, 0], [x0 * U, 1], [x1 * U, 1]]);
        exposed.push({ x: (x0 + x1) / 2, z: z0, nx: 0, nz: -1 });
      }
      if (open(c + 1, r)) { // +x
        quad([[x1, 0, z1], [x1, 0, z0], [x1, H, z0], [x1, H, z1]], [1, 0, 0], [[z1 * U, 0], [z0 * U, 0], [z0 * U, 1], [z1 * U, 1]]);
        exposed.push({ x: x1, z: (z0 + z1) / 2, nx: 1, nz: 0 });
      }
      if (open(c - 1, r)) { // -x
        quad([[x0, 0, z0], [x0, 0, z1], [x0, H, z1], [x0, H, z0]], [-1, 0, 0], [[z0 * U, 0], [z1 * U, 0], [z1 * U, 1], [z0 * U, 1]]);
        exposed.push({ x: x0, z: (z0 + z1) / 2, nx: -1, nz: 0 });
      }
    }
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wallGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  wallGeo.setIndex(idx);
  const walls = new THREE.Mesh(wallGeo, matWall);
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  // 地板、天花板
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(world.sizeX, world.sizeZ), matFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(world.sizeX / 2, 0, world.sizeZ / 2);
  floor.receiveShadow = true;
  group.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(world.sizeX, world.sizeZ), matCeil);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(world.sizeX / 2, H, world.sizeZ / 2);
  ceil.receiveShadow = true;
  group.add(ceil);

  // 門楣(門洞上方的牆)
  for (let r = 1; r < world.h - 1; r++) {
    for (let c = 1; c < world.w - 1; c++) {
      if (world.isSolidCell(c, r)) continue;
      const hz = world.isSolidCell(c - 1, r) && world.isSolidCell(c + 1, r);
      const vt = world.isSolidCell(c, r - 1) && world.isSolidCell(c, r + 1);
      if (hz || vt) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(CELL, 0.8, CELL), matWall);
        m.position.set((c + 0.5) * CELL, H - 0.4, (r + 0.5) * CELL);
        m.castShadow = true;
        group.add(m);
        // 半掩的破門板
        if (hz && rnd() < 0.75) {
          const door = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.35, 0.05), matTeal);
          const side = rnd() < 0.5 ? -1 : 1;
          door.position.set((c + 0.5) * CELL + side * 0.98, 1.17, (r + 0.5) * CELL + rr(-0.1, 0.1));
          door.rotation.y = side * rr(0.15, 0.5) + Math.PI / 2 * 0; // 靠在門框邊
          door.rotation.z = rr(-0.04, 0.04);
          door.castShadow = true;
          group.add(door);
        }
      }
    }
  }

  // ---------- 道具工具 ----------
  const add = (geo, mat, x, y, z, ry = 0, rx = 0, rz = 0, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = shadow;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const box = (w, h, d, mat, x, y, z, ry = 0, rx = 0, rz = 0) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, ry, rx, rz);
  const cyl = (r, h, mat, x, y, z, rx = 0, rz = 0, seg = 10) => add(new THREE.CylinderGeometry(r, r, h, seg), mat, x, y, z, 0, rx, rz);
  const solid = (x, z, sx, sz, h) => world.addBox(x, z, sx, sz, h);

  const bed = (x, z, ry = 0, tipped = false) => {
    const g = new THREE.Group();
    const sub = (m) => { m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    const mk = (geo, mat, px, py, pz, rx = 0, ryy = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.rotation.set(rx, ryy, rz);
      return sub(m);
    };
    for (const [lx, lz] of [[-0.45, -0.95], [0.45, -0.95], [-0.45, 0.95], [0.45, 0.95]]) mk(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6), matMetal, lx, 0.25, lz);
    mk(new THREE.BoxGeometry(0.95, 0.05, 2.0), matMetal, 0, 0.52, 0);
    mk(new THREE.BoxGeometry(0.9, 0.16, 1.95), matFabric, 0, 0.63, 0);
    mk(new THREE.BoxGeometry(0.5, 0.1, 0.32), matFabric, 0, 0.76, -0.7); // 枕頭
    mk(new THREE.BoxGeometry(0.92, 0.06, 1.1), new THREE.MeshStandardMaterial({ color: 0x6d5a52, roughness: 1 }), 0, 0.73, 0.35, 0.05, 0.1, 0); // 污損毯子
    mk(new THREE.BoxGeometry(0.95, 0.5, 0.05), matMetal, 0, 0.8, -1.0); // 床頭板
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    if (tipped) { g.rotation.z = Math.PI / 2 * 0.92; g.position.y = 0.45; }
    group.add(g);
    const swap = Math.abs(Math.sin(ry)) > 0.7;
    if (tipped) solid(x, z, swap ? 1.1 : 0.9, swap ? 2.0 : 1.2, 1.2);
    else solid(x, z, swap ? 2.0 : 1.0, swap ? 1.0 : 2.0, 0.9);
  };

  const wheelchair = (x, z, ry = 0) => {
    const g = new THREE.Group();
    const part = (m) => { m.castShadow = true; g.add(m); };
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.45), matFabric); seat.position.set(0, 0.5, 0); part(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.04), matFabric); back.position.set(0, 0.75, -0.22); part(back);
    for (const sx of [-0.28, 0.28]) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.018, 6, 18), matDarkMetal); w.position.set(sx, 0.3, 0); w.rotation.y = Math.PI / 2; part(w);
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 10), matDarkMetal); f.position.set(sx, 0.08, 0.3); f.rotation.z = Math.PI / 2; part(f);
    }
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    group.add(g);
    solid(x, z, 0.7, 0.7, 0.9);
  };

  const bench = (x, z, ry = 0) => {
    const g = new THREE.Group();
    const mk = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = true; m.receiveShadow = true; g.add(m); };
    mk(new THREE.BoxGeometry(3, 0.06, 0.5), matPlastic, 0, 0.45, 0);
    mk(new THREE.BoxGeometry(3, 0.4, 0.05), matPlastic, 0, 0.75, -0.22);
    for (const lx of [-1.4, 0, 1.4]) mk(new THREE.BoxGeometry(0.05, 0.45, 0.45), matMetal, lx, 0.22, 0);
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    group.add(g);
    const swap = Math.abs(Math.sin(ry)) > 0.7;
    solid(x, z, swap ? 0.55 : 3, swap ? 3 : 0.55, 0.8);
  };

  const crate = (x, z, s = 0.8, ry = 0, y = 0) => {
    box(s, s, s, matWood, x, y + s / 2, z, ry);
  };

  // ---------- 病房 ----------
  bed(3.6, 4.4);
  bed(12.2, 4.4); bed(18.2, 4.4);
  box(0.5, 0.6, 0.5, matMetal, 10.9, 0.3, 2.6); solid(10.9, 2.6, 0.5, 0.5, 0.6);
  bed(24.2, 3.6, Math.PI / 2); bed(24, 9.2, 0.3, true);
  bed(36.2, 4.4); bed(42.2, 4.4);
  box(0.5, 0.6, 0.5, matMetal, 38.2, 0.3, 2.6); solid(38.2, 2.6, 0.5, 0.5, 0.6);
  bed(48.2, 4.4); bed(55.5, 4.4);
  wheelchair(52, 9.2, 0.6);
  // 輸液架
  for (const [x, z] of [[14.4, 4.2], [37.5, 7.5], [50.2, 3]]) {
    cyl(0.015, 1.9, matMetal, x, 0.95, z, 0, 0, 6);
    cyl(0.2, 0.03, matMetal, x, 0.02, z, 0, 0, 12);
    box(0.12, 0.2, 0.04, new THREE.MeshStandardMaterial({ color: 0xcfd8c8, roughness: 0.3, transparent: true, opacity: 0.8 }), x + 0.08, 1.7, z);
  }

  // ---------- 北走廊 ----------
  bed(22, 15.6, Math.PI / 2, true); // 翻倒的擔架床
  wheelchair(40, 17, 2.4);
  box(1.2, 0.85, 0.6, matMetal, 50, 0.45, 14.9); solid(50, 14.9, 1.2, 0.6, 0.9); // 推車
  box(0.5, 0.35, 0.4, matFabric, 48.7, 0.2, 14.9);

  // ---------- 手術室(左) ----------
  box(1.0, 0.12, 2.2, matMetal, 9, 0.95, 27); box(0.3, 0.9, 0.3, matMetal, 9, 0.45, 27); solid(9, 27, 1.0, 2.2, 1);
  cyl(0.02, 1.8, matDarkMetal, 9, 2.3, 26.6, 0, 0, 6);
  cyl(0.45, 0.12, new THREE.MeshStandardMaterial({ color: 0xcfd2cc, roughness: 0.4, emissive: 0x222222 }), 9, 1.9, 26.6, 0, 0, 16);
  box(0.9, 1.8, 0.5, matMetal, 3, 0.9, 22); solid(3, 22, 0.9, 0.5, 1.8);
  box(0.9, 1.8, 0.5, matMetal, 3, 0.9, 24.5); solid(3, 24.5, 0.9, 0.5, 1.8);
  box(0.8, 0.85, 0.5, matMetal, 13.5, 0.45, 31.5); solid(13.5, 31.5, 0.8, 0.5, 0.9);

  // ---------- 候診區(中) ----------
  bench(22.5, 23.2); bench(26.2, 23.4, 0.2); bench(34, 23.2); bench(38.2, 23.4, -0.15);
  bench(23, 31.3, Math.PI); bench(34.5, 31.2, Math.PI + 0.1);
  bench(39.5, 28.5, Math.PI / 2, true);

  // ---------- 儲藏室(右) ----------
  for (const z of [22, 24.4, 26.8, 29.2, 31.6]) {
    box(0.5, 2.0, 1.3, matMetal, 57.1, 1.0, z); solid(57.1, z, 0.5, 1.3, 2);
  }
  crate(46.4, 22.4, 0.9); crate(47.3, 22.5, 0.8, 0.3); crate(46.8, 22.4, 0.7, 0.1, 0.9);
  solid(46.8, 22.4, 1.8, 1, 1.4);
  crate(51, 31, 0.9, 0.4); solid(51, 31, 1, 1, 0.9);

  // ---------- 大廳 ----------
  box(6, 1.05, 0.9, matWood, 14, 0.52, 40.5); solid(14, 40.5, 6, 0.9, 1.05);
  box(6.1, 0.06, 1.05, matDarkMetal, 14, 1.07, 40.5);
  for (const [x, z] of [[22, 38.5], [38, 38.5], [22, 46], [38, 46]]) {
    box(0.7, H, 0.7, matConcrete, x, H / 2, z); solid(x, z, 0.7, 0.7, H);
  }
  bench(8, 46.8, Math.PI); bench(46, 41.5, -Math.PI / 2 + 0.2);
  wheelchair(44, 45, 1.2); wheelchair(12, 45.6, 4);
  // 崩塌的天花板碎片堆
  for (let i = 0; i < 14; i++) {
    const m = box(rr(0.5, 1.1), rr(0.05, 0.12), rr(0.5, 1.1), matCeil, 52 + rr(-1.6, 1.6), rr(0.05, 0.5), 41 + rr(-1.6, 1.6), rr(0, 6), rr(-0.4, 0.4), rr(-0.4, 0.4));
    m.receiveShadow = true;
  }
  solid(52, 41, 3, 3, 0.5);

  // ---------- 玄關(商店位置)與大門 ----------
  const doorZ = world.sizeZ - CELL - 0.02;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 2.7), new THREE.MeshStandardMaterial({ color: 0x55646c, emissive: 0x4a5f6e, emissiveIntensity: 0.35, roughness: 0.2 }));
  glass.position.set(30, 1.45, doorZ);
  glass.rotation.y = Math.PI;
  group.add(glass);
  for (let i = 0; i <= 4; i++) box(0.1, 2.9, 0.12, matDarkMetal, 26.2 + i * 1.9, 1.45, doorZ - 0.05);
  box(7.6, 0.1, 0.12, matDarkMetal, 30, 2.8, doorZ - 0.05);
  box(7.6, 0.1, 0.12, matDarkMetal, 30, 0.05, doorZ - 0.05);
  for (const [x, y, a] of [[28.4, 1.0, 0.12], [31.2, 1.6, -0.08], [29.8, 0.6, 0.05]]) {
    box(3.0, 0.2, 0.05, matWood, x, y, doorZ - 0.12, 0, 0, a); // 封門木板
  }
  const outside = new THREE.PointLight(0x8aa6c0, 3, 10, 2);
  outside.position.set(30, 2, world.sizeZ - CELL - 0.5);
  group.add(outside);

  // ---------- 壁面標示 ----------
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), new THREE.MeshStandardMaterial({ color: 0xd9d9d0, roughness: 0.6 }));
  sign.position.set(13, 2.3, 36.03);
  group.add(sign);
  box(0.6, 0.18, 0.02, new THREE.MeshStandardMaterial({ color: 0xa81818 }), 13, 2.3, 36.045);
  box(0.18, 0.6, 0.02, new THREE.MeshStandardMaterial({ color: 0xa81818 }), 13, 2.3, 36.045);

  // ---------- 貼花:血跡、裂縫、紙張 ----------
  const decalMat = (tex) => new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, color: 0xbbbbbb });
  const wallBloodMat = decalMat(makeBloodWall());
  const crackMat = decalMat(makeCrackDecal());
  const floorBloodMat = decalMat(makeBloodSplat());
  const paperMat = new THREE.MeshStandardMaterial({ map: makePaper(), roughness: 0.9, side: THREE.DoubleSide });

  const shuffled = exposed.slice().sort(() => rnd() - 0.5);
  shuffled.slice(0, 26).forEach((f, i) => {
    const s = rr(1.2, 2.4);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), i % 3 === 0 ? crackMat : wallBloodMat);
    m.position.set(f.x + f.nx * 0.01, rr(1.0, 2.2), f.z + f.nz * 0.01);
    m.rotation.y = Math.atan2(f.nx, f.nz);
    m.rotation.z = rr(-0.3, 0.3);
    group.add(m);
  });
  const floorCells = [];
  for (let r = 0; r < world.h; r++) for (let c = 0; c < world.w; c++) if (!world.isSolidCell(c, r)) floorCells.push([c, r]);
  for (let i = 0; i < 30; i++) {
    const [c, r] = floorCells[(rnd() * floorCells.length) | 0];
    const s = rr(0.9, 2.4);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), floorBloodMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rr(0, 6.28);
    m.position.set((c + rnd()) * CELL, 0.012 + i * 0.0003, (r + rnd()) * CELL);
    group.add(m);
  }
  for (let i = 0; i < 70; i++) { // 散落的病歷紙
    const [c, r] = floorCells[(rnd() * floorCells.length) | 0];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.2), paperMat);
    m.rotation.x = -Math.PI / 2 + rr(-0.05, 0.05);
    m.rotation.z = rr(0, 6.28);
    m.position.set((c + rnd()) * CELL, 0.014 + rnd() * 0.01, (r + rnd()) * CELL);
    m.receiveShadow = true;
    group.add(m);
  }
  for (let i = 0; i < 40; i++) { // 碎磚塊與碎片
    const [c, r] = floorCells[(rnd() * floorCells.length) | 0];
    const s = rr(0.08, 0.25);
    box(s, s * 0.6, s * rr(0.7, 1.3), matConcrete, (c + rnd()) * CELL, s * 0.3, (r + rnd()) * CELL, rr(0, 6), rr(-0.3, 0.3), rr(-0.3, 0.3));
  }

  // ---------- 燈具 ----------
  // [x, z, 是否點亮, 是否閃爍]
  const fixtures = [
    [6, 15, 0, 0], [20, 15, 1, 0], [34, 15, 0, 0], [48, 15, 1, 1],
    [4.5, 7, 0, 0], [14.5, 7, 1, 1], [27, 7, 0, 0], [38, 7, 1, 0], [52, 7, 0, 0],
    [9, 27, 1, 1], [30, 24, 0, 0], [30, 30, 1, 0], [51, 27, 0, 0],
    [10, 42, 1, 0], [30, 40, 0, 0], [50, 42, 1, 1], [30, 45.5, 1, 0], [30, 50, 0, 0],
  ];
  for (const [x, z, on, fl] of fixtures) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.28), on ? matLightOn.clone() : matLightOff);
    m.position.set(x, H - 0.04, z);
    group.add(m);
    if (on) {
      const light = new THREE.PointLight(0xdbeadf, 16, 18, 1.5);
      light.position.set(x, H - 0.4, z);
      group.add(light);
      flickers.push({ light, mesh: m, base: light.intensity, baseEm: m.material.emissiveIntensity, flicker: !!fl, phase: rnd() * 10 });
    } else if (rnd() < 0.5) {
      m.rotation.z = rr(0.02, 0.05); // 半垂下的壞燈
      m.position.y -= 0.08;
    }
  }

  const hemi = new THREE.HemisphereLight(0x8a9a94, 0x24201a, 1.3);
  group.add(hemi);

  return {
    group,
    update(t) {
      for (const f of flickers) {
        if (!f.flicker) continue;
        const n = Math.sin(t * 17 + f.phase) * Math.sin(t * 5.3 + f.phase * 2);
        const k = n > 0.55 ? 0.1 : n > 0.2 ? 0.6 : 1;
        const on = rnd() < 0.96 ? k : 0.05;
        f.light.intensity = f.base * on;
        f.mesh.material.emissiveIntensity = f.baseEm * on;
      }
    },
  };
}
