import { CELL, parseLayout } from './layout.js';

const FINE = 0.5; // 導航格大小(m)
const ZOMBIE_R = 0.4; // 導航用的障礙膨脹半徑

export class World {
  constructor() {
    const L = parseLayout();
    this.w = L.w;
    this.h = L.h;
    this.solid = L.solid;
    this.spawns = L.spawns;
    this.start = L.start;
    this.sizeX = this.w * CELL;
    this.sizeZ = this.h * CELL;
    this.boxes = []; // 道具 AABB {minX,maxX,minZ,maxZ,height}
    this.fw = Math.round(this.sizeX / FINE);
    this.fh = Math.round(this.sizeZ / FINE);
    this.blocked = new Uint8Array(this.fw * this.fh);
    this.dist = new Int32Array(this.fw * this.fh).fill(-1);
    this.queue = new Int32Array(this.fw * this.fh);
    this.lastGoal = -1;
  }

  isSolidCell(c, r) {
    if (c < 0 || r < 0 || c >= this.w || r >= this.h) return true;
    return this.solid[r * this.w + c] === 1;
  }

  addBox(cx, cz, sx, sz, height = 1) {
    const b = { minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, height };
    this.boxes.push(b);
    return b;
  }

  removeBox(b) {
    const i = this.boxes.indexOf(b);
    if (i >= 0) this.boxes.splice(i, 1);
  }

  // 圓形(x,z,r)對牆格與道具的推擠;回傳修正後的位置
  resolve(pos, r) {
    const c0 = Math.floor((pos.x - r) / CELL);
    const c1 = Math.floor((pos.x + r) / CELL);
    const r0 = Math.floor((pos.z - r) / CELL);
    const r1 = Math.floor((pos.z + r) / CELL);
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        if (this.isSolidCell(cc, rr)) this._pushOut(pos, r, cc * CELL, (cc + 1) * CELL, rr * CELL, (rr + 1) * CELL);
      }
    }
    for (const b of this.boxes) {
      if (pos.x + r < b.minX || pos.x - r > b.maxX || pos.z + r < b.minZ || pos.z - r > b.maxZ) continue;
      this._pushOut(pos, r, b.minX, b.maxX, b.minZ, b.maxZ);
    }
    return pos;
  }

  _pushOut(pos, r, minX, maxX, minZ, maxZ) {
    const nx = Math.max(minX, Math.min(pos.x, maxX));
    const nz = Math.max(minZ, Math.min(pos.z, maxZ));
    let dx = pos.x - nx;
    let dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      const push = r - d;
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    } else {
      // 圓心在方塊內:往最近的邊推出
      const l = pos.x - minX, rt = maxX - pos.x, t = pos.z - minZ, bt = maxZ - pos.z;
      const m = Math.min(l, rt, t, bt);
      if (m === l) pos.x = minX - r;
      else if (m === rt) pos.x = maxX + r;
      else if (m === t) pos.z = minZ - r;
      else pos.z = maxZ + r;
    }
  }

  // 射線與牆/道具的最近交點距離(沒有則回傳 maxDist)
  rayDistance(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    // 牆:以 0.1m 步進
    const step = 0.1;
    for (let t = 0; t < best; t += step) {
      const x = ox + dx * t, z = oz + dz * t, y = oy + dy * t;
      if (y < 0 || y > 3.2) { best = Math.min(best, t); break; }
      if (this.isSolidCell(Math.floor(x / CELL), Math.floor(z / CELL))) { best = t; break; }
    }
    // 道具 AABB(slab 法)
    for (const b of this.boxes) {
      let tmin = 0, tmax = best;
      const slab = (o, d, lo, hi) => {
        if (Math.abs(d) < 1e-8) return o >= lo && o <= hi;
        let t1 = (lo - o) / d, t2 = (hi - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        return tmin <= tmax;
      };
      if (!slab(ox, dx, b.minX, b.maxX)) continue;
      if (!slab(oz, dz, b.minZ, b.maxZ)) continue;
      if (!slab(oy, dy, 0, b.height)) continue;
      if (tmin < best) best = tmin;
    }
    return best;
  }

  hasLineOfSight(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) return true;
    return this.rayDistance(ax, 1.2, az, dx / d, 0, dz / d, d) >= d - 0.05;
  }

  // ---- 導航 ----
  buildNav() {
    const { fw, fh } = this;
    for (let j = 0; j < fh; j++) {
      for (let i = 0; i < fw; i++) {
        const x = (i + 0.5) * FINE, z = (j + 0.5) * FINE;
        let blocked = false;
        const c0 = Math.floor((x - ZOMBIE_R) / CELL), c1 = Math.floor((x + ZOMBIE_R) / CELL);
        const r0 = Math.floor((z - ZOMBIE_R) / CELL), r1 = Math.floor((z + ZOMBIE_R) / CELL);
        for (let rr = r0; rr <= r1 && !blocked; rr++) {
          for (let cc = c0; cc <= c1; cc++) {
            if (this.isSolidCell(cc, rr)) {
              const nx = Math.max(cc * CELL, Math.min(x, (cc + 1) * CELL));
              const nz = Math.max(rr * CELL, Math.min(z, (rr + 1) * CELL));
              if ((x - nx) ** 2 + (z - nz) ** 2 < ZOMBIE_R * ZOMBIE_R) { blocked = true; break; }
            }
          }
        }
        if (!blocked) {
          for (const b of this.boxes) {
            const nx = Math.max(b.minX, Math.min(x, b.maxX));
            const nz = Math.max(b.minZ, Math.min(z, b.maxZ));
            if ((x - nx) ** 2 + (z - nz) ** 2 < ZOMBIE_R * ZOMBIE_R) { blocked = true; break; }
          }
        }
        this.blocked[j * fw + i] = blocked ? 1 : 0;
      }
    }
    this.lastGoal = -1;
  }

  // 以玩家位置為中心做 BFS;位置沒變(同一導航格)則略過
  updateFlow(px, pz) {
    const { fw, fh } = this;
    const gi = Math.max(0, Math.min(fw - 1, Math.floor(px / FINE)));
    const gj = Math.max(0, Math.min(fh - 1, Math.floor(pz / FINE)));
    const goal = gj * fw + gi;
    if (goal === this.lastGoal) return;
    this.lastGoal = goal;
    this.dist.fill(-1);
    const q = this.queue;
    let head = 0, tail = 0;
    this.dist[goal] = 0;
    q[tail++] = goal;
    const { dist, blocked } = this;
    while (head < tail) {
      const cur = q[head++];
      const ci = cur % fw, cj = (cur / fw) | 0;
      const nd = dist[cur] + 1;
      if (ci > 0 && !blocked[cur - 1] && dist[cur - 1] === -1) { dist[cur - 1] = nd; q[tail++] = cur - 1; }
      if (ci < fw - 1 && !blocked[cur + 1] && dist[cur + 1] === -1) { dist[cur + 1] = nd; q[tail++] = cur + 1; }
      if (cj > 0 && !blocked[cur - fw] && dist[cur - fw] === -1) { dist[cur - fw] = nd; q[tail++] = cur - fw; }
      if (cj < fh - 1 && !blocked[cur + fw] && dist[cur + fw] === -1) { dist[cur + fw] = nd; q[tail++] = cur + fw; }
    }
  }

  // 回傳從(x,z)前往玩家的方向(單位向量),找不到路時回傳 null
  flowDir(x, z, out) {
    const { fw, fh, dist, blocked } = this;
    const i = Math.max(0, Math.min(fw - 1, Math.floor(x / FINE)));
    const j = Math.max(0, Math.min(fh - 1, Math.floor(z / FINE)));
    let best = dist[j * fw + i] === -1 ? Infinity : dist[j * fw + i];
    let bi = -1, bj = -1;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= fw || nj >= fh) continue;
        const d = dist[nj * fw + ni];
        if (d === -1) continue;
        if (di && dj && (blocked[j * fw + ni] || blocked[nj * fw + i])) continue; // 不切角
        const score = d + (di && dj ? 0.4 : 0);
        if (score < best) { best = score; bi = ni; bj = nj; }
      }
    }
    if (bi < 0) return null;
    const tx = (bi + 0.5) * FINE - x;
    const tz = (bj + 0.5) * FINE - z;
    const l = Math.hypot(tx, tz) || 1;
    out.x = tx / l;
    out.z = tz / l;
    return out;
  }
}
