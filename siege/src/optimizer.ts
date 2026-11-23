// Top-0.1% 程序化买量素材蒙特卡洛寻优与帧级遥测审计引擎 (Monte Carlo Funnel & Telemetry Optimizer)
import type { SiegeMapId, SiegeModeId } from "./config.ts";
import { SiegeSimulator, SIM_HZ } from "./sim.ts";

export interface SeedTelemetryReport {
  seed: number;
  modeId: SiegeModeId;
  durationSec: number;
  endPhase: SiegeSimulator["phase"];
  // 1. 物理真实感硬门槛 (Zero-Defect Physics Gate)
  physicsAuditPass: boolean;
  jumpsOver5: number;
  postStepTouching: number;
  propClipCount: number;
  propsDestroyed: number;
  maxTracerLen: number;
  clearBeforeDeploy: boolean;
  minSquadY: number;
  horizontalSpanPx: number;
  // 2. 黄金前 3 秒钩子指标 (3s Thumbstop Funnel)
  killsAt32s: number;
  activeCombat3sRatio: number;
  // 3. 多巴胺脉冲与战局拉锯指标 (Dopamine Pacing & Reversal Entropy)
  peakGreens: number;
  finalGreens: number;
  finalReds: number;
  totalKills: number;
  totalInfections: number;
  bossesKilled: number;
  hiveMinHpPct: number;
  maxDryGapSec: number;
  tugDynamicRange: number;
  leadSwings: number;
  // 4. 综合买量留存评分 (0..100)
  hook3sScore: number;
  dopaminePacingScore: number;
  reversalTensionScore: number;
  durationSweetSpotScore: number;
  totalScore: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function evaluateSeedTelemetry(
  seed: number,
  modeId: SiegeModeId,
  mapId: SiegeMapId = "canyon-bridge",
  maxDurationSec = 54,
): SeedTelemetryReport {
  const sim = new SiegeSimulator(seed, mapId, maxDurationSec, modeId);
  const expectOverrun = modeId === "blackout" || modeId === "maze-infect";

  let jumpsOver5 = 0;
  let postStepTouching = 0;
  let propClipCount = 0;
  let maxTracerLen = 0;
  let prematureDeploy = false;
  let greensAt43s = 0;
  let killsAt32s = 0;

  let peakGreens = 0;
  let hiveMinHp = sim.hive.maxHp;
  let minSquadY = sim.squadCenterY;
  let minSquadX = sim.squadCenterX;
  let maxSquadX = sim.squadCenterX;

  const prevPos = new Map<number, { x: number; y: number }>();
  const combatBuckets3s = new Uint8Array(11); // 0.25s..3.00s 共 11 个 0.25s 窗口
  const milestoneSecs: number[] = [0];

  let prevBrokenCount = 0;
  let prevBossSpawned = 0;
  let prevBossKills = 0;
  let prevInfections = 0;
  let blackoutLogged = false;
  let hive75Logged = false;
  let hive45Logged = false;
  let hive15Logged = false;

  let minTug = 1.0;
  let maxTug = 0.0;
  let leadSwings = 0;
  let prevTugTrend = 0;
  let lastAnchorTug = -1;

  const maxTicks = Math.round(maxDurationSec * SIM_HZ);
  for (let tick = 1; tick <= maxTicks; tick++) {
    sim.stepTick();
    const tSec = tick / SIM_HZ;

    // (a) 载具先推进清场再下车严格审计
    if (tSec < 3.18 && sim.greens.length > 0) {
      prematureDeploy = true;
    }
    if (tick === Math.round(3.2 * SIM_HZ)) {
      killsAt32s = sim.kills;
      milestoneSecs.push(tSec);
    }
    if (tick === Math.round(4.3 * SIM_HZ)) {
      greensAt43s = sim.greens.length;
    }

    // (b) 黄金前 3 秒战斗活跃度窗口采样
    if (tSec >= 0.25 && tSec < 3.0) {
      const bIdx = Math.min(10, Math.floor((tSec - 0.25) / 0.25));
      if (sim.firingLines.length > 0 || sim.rockets.length > 0) {
        combatBuckets3s[bIdx] = 1;
      }
    }

    // (c) 射程上限、零瞬移、零免死贴脸物理审计
    for (let i = 0; i < sim.firingLines.length; i++) {
      const fl = sim.firingLines[i];
      const len = Math.hypot(fl.x2 - fl.x1, fl.y2 - fl.y1);
      if (len > maxTracerLen) maxTracerLen = len;
    }
    for (let gi = 0; gi < sim.greens.length; gi++) {
      const g = sim.greens[gi];
      const p = prevPos.get(g.id);
      if (p) {
        const d = Math.hypot(g.x - p.x, g.y - p.y);
        if (d > 5.0) jumpsOver5++;
      }
      prevPos.set(g.id, { x: g.x, y: g.y });

      for (let ri = 0; ri < sim.reds.length; ri++) {
        const r = sim.reds[ri];
        const d = Math.hypot(g.x - r.x, g.y - r.y);
        if (d < g.r + r.r - 0.5) postStepTouching++;
      }

      // 严格家具零穿模审计：任何人类士兵圆心与体积不得嵌入任何完好家具 (intact prop) 或承重柱内部！
      for (let pi = 0; pi < sim.props.length; pi++) {
        const pr = sim.props[pi];
        if (!pr.intact) continue;
        const cx = clamp(g.x, pr.x, pr.x + pr.w);
        const cy = clamp(g.y, pr.y, pr.y + pr.h);
        if (Math.hypot(g.x - cx, g.y - cy) < g.r - 0.8) {
          propClipCount++;
        }
      }
      for (let pli = 0; pli < sim.pillars.length; pli++) {
        const pl = sim.pillars[pli];
        const cx = clamp(g.x, pl.x, pl.x + pl.w);
        const cy = clamp(g.y, pl.y, pl.y + pl.h);
        if (Math.hypot(g.x - cx, g.y - cy) < g.r - 0.8) {
          propClipCount++;
        }
      }
    }
    for (let ri = 0; ri < sim.reds.length; ri++) {
      const r = sim.reds[ri];
      if ((r.mutatingTicks ?? 0) > 0) continue;
      for (let pi = 0; pi < sim.props.length; pi++) {
        const pr = sim.props[pi];
        if (!pr.intact) continue;
        const cx = clamp(r.x, pr.x, pr.x + pr.w);
        const cy = clamp(r.y, pr.y, pr.y + pr.h);
        if (Math.hypot(r.x - cx, r.y - cy) < r.r - 1.2) {
          propClipCount++;
        }
      }
    }

    if (sim.greens.length > peakGreens) peakGreens = sim.greens.length;
    if (sim.hive.hp < hiveMinHp) hiveMinHp = Math.max(0, sim.hive.hp);
    if (sim.greens.length > 0) {
      if (sim.squadCenterY < minSquadY) minSquadY = sim.squadCenterY;
      if (sim.squadCenterX < minSquadX) minSquadX = sim.squadCenterX;
      if (sim.squadCenterX > maxSquadX) maxSquadX = sim.squadCenterX;
    }

    // (d) 多巴胺高潮节点记录
    let brokenNow = 0;
    for (let ni = 0; ni < sim.nodes.length; ni++) {
      if (sim.nodes[ni].broken) brokenNow++;
    }
    if (brokenNow > prevBrokenCount) {
      prevBrokenCount = brokenNow;
      milestoneSecs.push(tSec);
    }
    if (sim.bossesSpawned > prevBossSpawned) {
      prevBossSpawned = sim.bossesSpawned;
      milestoneSecs.push(tSec);
    }
    if (sim.bossesKilled > prevBossKills) {
      prevBossKills = sim.bossesKilled;
      milestoneSecs.push(tSec);
    }
    if (tick === Math.round(5.0 * SIM_HZ)) {
      milestoneSecs.push(tSec);
    }
    const hiveRatio = sim.hive.hp / sim.hive.maxHp;
    if (!hive75Logged && hiveRatio <= 0.75) {
      hive75Logged = true;
      milestoneSecs.push(tSec);
    }
    if (!hive45Logged && hiveRatio <= 0.45) {
      hive45Logged = true;
      milestoneSecs.push(tSec);
    }
    if (!hive15Logged && hiveRatio <= 0.15) {
      hive15Logged = true;
      milestoneSecs.push(tSec);
    }
    if (sim.infectedCount > prevInfections) {
      // 首次感染与关键减员波次计入情绪脉冲
      if (prevInfections === 0 || sim.infectedCount - prevInfections >= 2 || tSec - milestoneSecs[milestoneSecs.length - 1] >= 3.2) {
        milestoneSecs.push(tSec);
      }
      prevInfections = sim.infectedCount;
    }
    if (sim.blackoutActive && !blackoutLogged) {
      blackoutLogged = true;
      milestoneSecs.push(tSec);
    }

    // (e) 每 0.5s 采样一次顶部红绿战力拉锯条，统计局势反转次数 (Lead Reversal Swings)
    if (tick % 30 === 0) {
      let aliveBossCount = 0;
      for (let i = 0; i < sim.reds.length; i++) {
        if (sim.reds[i].kind === "boss") aliveBossCount++;
      }
      let undeployed = 0;
      for (let i = 0; i < sim.vehicles.length; i++) {
        const v = sim.vehicles[i];
        undeployed += Math.max(0, v.totalToDeploy - v.deployedCount);
      }
      const humans = sim.greens.length + undeployed;
      const gPow = humans * 16;
      const rPow =
        sim.reds.length * 1.2 +
        aliveBossCount * 80 +
        (sim.hive.alive ? (sim.hive.hp / sim.hive.maxHp) * 90 : 0);
      const tug = humans === 0 ? 0 : clamp(gPow / Math.max(1, gPow + rPow), 0, 1);
      if (tug < minTug) minTug = tug;
      if (tug > maxTug) maxTug = tug;

      if (lastAnchorTug < 0) {
        lastAnchorTug = tug;
      } else {
        const delta = tug - lastAnchorTug;
        if (Math.abs(delta) >= 0.085) {
          const dir = delta > 0 ? 1 : -1;
          if (prevTugTrend !== 0 && dir !== prevTugTrend) {
            leadSwings++;
          }
          prevTugTrend = dir;
          lastAnchorTug = tug;
        }
      }
    }

    if (sim.isFinished) break;
  }

  const durationSec = Number((sim.tick / SIM_HZ).toFixed(2));
  milestoneSecs.push(durationSec);
  milestoneSecs.sort((a, b) => a - b);

  let maxDryGapSec = 0;
  for (let i = 1; i < milestoneSecs.length; i++) {
    const gap = milestoneSecs[i] - milestoneSecs[i - 1];
    if (gap > maxDryGapSec) maxDryGapSec = gap;
  }

  let activeBuckets = 0;
  for (let i = 0; i < combatBuckets3s.length; i++) activeBuckets += combatBuckets3s[i];
  const activeCombat3sRatio = activeBuckets / combatBuckets3s.length;

  const hiveMinHpPct = Number(((hiveMinHp / sim.hive.maxHp) * 100).toFixed(1));
  const clearBeforeDeploy = !prematureDeploy && greensAt43s >= 5 && killsAt32s >= 25;
  const outcomeMatch = expectOverrun
    ? sim.phase === "defeat" && sim.greens.length === 0 && hiveMinHpPct <= 60
    : sim.phase === "victory" && sim.greens.length >= 2 && sim.greens.length <= 7 && sim.reds.length === 0;

  let unlockedCount = 0;
  for (let ni = 0; ni < sim.nodes.length; ni++) {
    if (sim.nodes[ni].broken) unlockedCount++;
  }
  const enoughCagesUnlocked = unlockedCount >= Math.max(10, Math.floor(sim.nodes.length * 0.75));

  const horizontalSpanPx = Math.round(maxSquadX - minSquadX);
  const physicsAuditPass =
    outcomeMatch &&
    enoughCagesUnlocked &&
    peakGreens >= 18 &&
    clearBeforeDeploy &&
    minSquadY <= 680 &&
    horizontalSpanPx >= 780 &&
    jumpsOver5 === 0 &&
    postStepTouching === 0 &&
    propClipCount === 0 &&
    sim.propsDestroyed >= 4 &&
    maxTracerLen <= 375;

  // --- 计算四维买量评分 (0..100) ---
  // 1. Hook 3s Score (25分)：前 3.2s 清怪爽度 + 零冷场连续火力
  const killHookNorm = clamp((killsAt32s - 20) / 48, 0, 1);
  const hook3sScore = Number((activeCombat3sRatio * 15 + killHookNorm * 10).toFixed(2));

  // 2. Dopamine Pacing Score (25分)：最大空窗期越短分越高 (<= 5.0s 满分)
  const gapPenalty = Math.max(0, maxDryGapSec - 4.6) * 3.8;
  const dopaminePacingScore = Number(clamp(25 - gapPenalty, 0, 25).toFixed(2));

  // 3. Reversal & Climax Tension Score (30分)：大起大落拉锯振幅 + 终局毫厘悬念
  const tugDynamicRange = Number((maxTug - minTug).toFixed(3));
  const swingScore = clamp(leadSwings / 4, 0, 1) * 10 + clamp(tugDynamicRange / 0.55, 0, 1) * 8;
  let climaxMarginScore = 0;
  if (expectOverrun) {
    // Fail-Ad 精髓：人类曾暴兵至 >=20 人且把母巢血量压低，最后功败垂成全员同化！
    const peakBonus = clamp((peakGreens - 16) / 8, 0, 1) * 6;
    const nearWinBonus = clamp((100 - hiveMinHpPct) / 65, 0, 1) * 6;
    climaxMarginScore = peakBonus + nearWinBonus;
  } else {
    // 人类惨胜精髓：从 >=22 人大军惨烈牺牲至仅剩 3~4 名孤胆残血英雄引爆母巢！
    const peakBonus = clamp((peakGreens - 18) / 6, 0, 1) * 4;
    const survivorDist = Math.abs(sim.greens.length - 4);
    const narrowWinBonus = clamp(8 - survivorDist * 2.5, 0, 8);
    climaxMarginScore = peakBonus + narrowWinBonus;
  }
  const reversalTensionScore = Number(clamp(swingScore + climaxMarginScore, 0, 30).toFixed(2));

  // 4. Duration Sweet Spot Score (20分)：41.0s ~ 46.5s 真实商铺驻停救援与低 DPS 拉锯甜区
  const durDiff = Math.abs(durationSec - 43.5);
  const durationSweetSpotScore = Number(clamp(20 - durDiff * 2.6, 0, 20).toFixed(2));

  const totalScore = physicsAuditPass
    ? Number(
        (
          hook3sScore +
          dopaminePacingScore +
          reversalTensionScore +
          durationSweetSpotScore
        ).toFixed(2),
      )
    : 0;

  return {
    seed,
    modeId,
    durationSec,
    endPhase: sim.phase,
    physicsAuditPass,
    jumpsOver5,
    postStepTouching,
    propClipCount,
    propsDestroyed: sim.propsDestroyed,
    maxTracerLen: Math.round(maxTracerLen),
    clearBeforeDeploy,
    minSquadY: Math.round(minSquadY),
    horizontalSpanPx,
    killsAt32s,
    activeCombat3sRatio: Number(activeCombat3sRatio.toFixed(2)),
    peakGreens,
    finalGreens: sim.greens.length,
    finalReds: sim.reds.length,
    totalKills: sim.kills,
    totalInfections: sim.infectedCount,
    bossesKilled: sim.bossesKilled,
    hiveMinHpPct,
    maxDryGapSec: Number(maxDryGapSec.toFixed(2)),
    tugDynamicRange,
    leadSwings,
    hook3sScore,
    dopaminePacingScore,
    reversalTensionScore,
    durationSweetSpotScore,
    totalScore,
  };
}

export function findGoldenSeed(
  modeId: SiegeModeId,
  baseSeed = 3000,
  candidateCount = 80,
  mapId: SiegeMapId = "canyon-bridge",
): { best: SeedTelemetryReport; passedCount: number; scannedCount: number } {
  let best: SeedTelemetryReport | null = null;
  let passedCount = 0;

  for (let i = 0; i < candidateCount; i++) {
    const seed = baseSeed + i;
    const rep = evaluateSeedTelemetry(seed, modeId, mapId);
    if (rep.physicsAuditPass) {
      passedCount++;
      if (!best || rep.totalScore > best.totalScore) {
        best = rep;
      }
    }
  }

  if (!best) {
    throw new Error(`No valid Golden Seed found for mode=${modeId} across ${candidateCount} seeds`);
  }
  return { best, passedCount, scannedCount: candidateCount };
}
