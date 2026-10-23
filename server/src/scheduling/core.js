

import { MIN, covers, dateKeyInTz } from './timeUtils.js';

export const WEIGHTS = {
  load: 10, // per session an interviewer already has (prefers least loaded)
  dayLoad: 5, // per session already on that day
  idle: 1, // per slot of idle time next to the nearest neighbouring interview
  candidatePref: 8, // outside candidate's preferred windows
  modePref: 6, // per panel member whose preferred mode differs
  continuity: 4, // reward for reusing the interviewer from the candidate's earlier round
};

export function interviewerModes(modes) {
  switch (modes) {
    case 'offline_only':
      return { offline: true, online: false, pref: 'offline' };
    case 'online_only':
      return { offline: false, online: true, pref: 'online' };
    case 'both_prefer_online':
      return { offline: true, online: true, pref: 'online' };
    case 'both_prefer_offline':
    default:
      return { offline: true, online: true, pref: 'offline' };
  }
}

/** Normalise raw input into the structure the engine expects. */
export function createProblem(raw) {
  const drive = { timezone: 'Asia/Kolkata', slotMinutes: 30, bufferMinutes: 0, modePolicy: 'any', ...raw.drive };
  const p = {
    drive,
    days: raw.days,
    rounds: raw.rounds,
    candidates: raw.candidates.map((c) => ({ preferred: [], availability: [], ...c })),
    interviewers: raw.interviewers.map((iv) => ({
      minBreakMinutes: 0,
      dailyCapacity: 6,
      ...iv,
      skillSet: new Set(iv.skills || []),
      modeCfg: interviewerModes(iv.modes),
    })),
    rooms: (raw.rooms || []).map((r) => ({ equipment: [], blocked: [], ...r })),
    existing: raw.existing || [],
    passedRounds: raw.passedRounds || new Map(),
    notBefore: raw.notBefore ?? 0,
    names: raw.names || {},
    skillNames: raw.skillNames || {},
  };
  p.roundById = new Map(p.rounds.map((r) => [r.id, r]));
  p.candById = new Map(p.candidates.map((c) => [c.id, c]));
  p.ivById = new Map(p.interviewers.map((i) => [i.id, i]));
  p.roomById = new Map(p.rooms.map((r) => [r.id, r]));
  const tz = drive.timezone;
  const cache = new Map();
  p.dayKey = (ms) => {
    const h = Math.floor(ms / 3600000);
    let k = cache.get(h);
    if (!k) {
      k = dateKeyInTz(ms, tz);
      cache.set(h, k);
    }
    return k;
  };
  p.bufferMs = drive.bufferMinutes * MIN;
  p.gapMs = (iv) => Math.max(drive.bufferMinutes, iv.minBreakMinutes || 0) * MIN;
  p.nameOf = (id) => p.names[id] || String(id).slice(0, 8);
  return p;
}

export function permittedModes(p, round) {
  const base = round.allowedModes && round.allowedModes.length ? round.allowedModes : ['offline', 'online'];
  return ['offline', 'online'].filter((m) => {
    if (!base.includes(m)) return false;
    if (p.drive.modePolicy === 'offline_only' && m !== 'offline') return false;
    if (p.drive.modePolicy === 'online_only' && m !== 'online') return false;
    return true;
  });
}

export function roomNeedFor(round) {
  return round.minRoomCapacity ?? round.panelSize + 1;
}

export function generateStarts(p, round) {
  const dur = round.durationMinutes * MIN;
  const step = p.drive.slotMinutes * MIN;
  const out = [];
  for (const day of p.days) {
    for (let t = day.startMs; t + dur <= day.endMs; t += step) {
      if (t >= p.notBefore) out.push(t);
    }
  }
  return out;
}

export class ScheduleState {
  constructor(problem, sessions = problem.existing) {
    this.p = problem;
    this.ivBusy = new Map();
    this.roomBusy = new Map();
    this.candBusy = new Map();
    this.dayCounts = new Map();
    this.loads = new Map();
    this.sessions = new Map();
    for (const s of sessions) this.add(s);
  }

  static _push(map, id, s, e, key) {
    let a = map.get(id);
    if (!a) map.set(id, (a = []));
    a.push({ s, e, key });
  }

  static _pull(map, id, key) {
    const a = map.get(id);
    if (!a) return;
    const i = a.findIndex((x) => x.key === key);
    if (i >= 0) a.splice(i, 1);
  }

  add(sess) {
    this.sessions.set(sess.key, sess);
    ScheduleState._push(this.candBusy, sess.candidateId, sess.start, sess.end, sess.key);
    if (sess.roomId) ScheduleState._push(this.roomBusy, sess.roomId, sess.start, sess.end, sess.key);
    const dk = this.p.dayKey(sess.start);
    for (const id of sess.interviewerIds) {
      ScheduleState._push(this.ivBusy, id, sess.start, sess.end, sess.key);
      let m = this.dayCounts.get(id);
      if (!m) this.dayCounts.set(id, (m = new Map()));
      m.set(dk, (m.get(dk) || 0) + 1);
      this.loads.set(id, (this.loads.get(id) || 0) + 1);
    }
  }

  remove(sess) {
    this.sessions.delete(sess.key);
    ScheduleState._pull(this.candBusy, sess.candidateId, sess.key);
    if (sess.roomId) ScheduleState._pull(this.roomBusy, sess.roomId, sess.key);
    const dk = this.p.dayKey(sess.start);
    for (const id of sess.interviewerIds) {
      ScheduleState._pull(this.ivBusy, id, sess.key);
      const m = this.dayCounts.get(id);
      if (m) m.set(dk, Math.max(0, (m.get(dk) || 0) - 1));
      this.loads.set(id, Math.max(0, (this.loads.get(id) || 0) - 1));
    }
  }

  interviewerFree(iv, s, e) {
    const gap = this.p.gapMs(iv);
    for (const x of this.ivBusy.get(iv.id) || []) if (s < x.e + gap && x.s < e + gap) return false;
    return true;
  }

  candidateFree(cand, s, e) {
    const gap = this.p.bufferMs;
    for (const x of this.candBusy.get(cand.id) || []) if (s < x.e + gap && x.s < e + gap) return false;
    return true;
  }

  roomFree(room, s, e) {
    for (const x of this.roomBusy.get(room.id) || []) if (s < x.e && x.s < e) return false;
    for (const b of room.blocked || []) if (s < b.end && b.start < e) return false;
    return true;
  }

  dayCount(id, dk) {
    return this.dayCounts.get(id)?.get(dk) || 0;
  }

  load(id) {
    return this.loads.get(id) || 0;
  }

  /** Minutes of idle time between this slot and the nearest neighbouring interview on the same day. */
  idleMinutes(iv, s, e) {
    const list = this.ivBusy.get(iv.id);
    if (!list || !list.length) return 0;
    const dk = this.p.dayKey(s);
    let best = Infinity;
    for (const x of list) {
      if (this.p.dayKey(x.s) !== dk) continue;
      const d = x.e <= s ? s - x.e : x.s >= e ? x.s - e : 0;
      if (d < best) best = d;
    }
    if (best === Infinity) return 0;
    return Math.max(0, best - this.p.gapMs(iv)) / MIN;
  }
}

export function hasAllSkills(iv, round) {
  for (const s of round.requiredSkillIds || []) if (!iv.skillSet.has(s)) return false;
  return true;
}

export function panelSatisfies(round, combo) {
  for (const req of round.panelRequirements || []) {
    let n = 0;
    for (const iv of combo) if (iv.skillSet.has(req.skillId)) n += 1;
    if (n < req.minCount) return false;
  }
  return true;
}

export function eligibleInterviewers(p, round, s, e, state, exclude) {
  const dk = p.dayKey(s);
  const out = [];
  for (const iv of p.interviewers) {
    if (exclude && exclude.has(iv.id)) continue;
    if (!hasAllSkills(iv, round)) continue;
    if (!covers(iv.availability, s, e)) continue;
    if (!state.interviewerFree(iv, s, e)) continue;
    if (state.dayCount(iv.id, dk) >= iv.dailyCapacity) continue;
    out.push(iv);
  }
  return out;
}

export function pickRoom(p, round, s, e, state, preferRoomId) {
  const need = roomNeedFor(round);
  const equip = round.requiredEquipment || [];
  let best = null;
  for (const r of p.rooms) {
    if (r.isActive === false) continue;
    if (r.capacity < need) continue;
    if (!equip.every((q) => (r.equipment || []).includes(q))) continue;
    if (!state.roomFree(r, s, e)) continue;
    if (preferRoomId && r.id === preferRoomId) return r;
    if (!best || r.capacity < best.capacity || (r.capacity === best.capacity && r.id < best.id)) best = r;
  }
  return best;
}

function* combinations(arr, k, start = 0, cur = []) {
  if (cur.length === k) {
    yield cur.slice();
    return;
  }
  for (let i = start; i <= arr.length - (k - cur.length); i += 1) {
    cur.push(arr[i]);
    yield* combinations(arr, k, i + 1, cur);
    cur.pop();
  }
}

function optionCost(p, state, cand, s, e, combo, mode, ctx) {
  const dk = p.dayKey(s);
  let cost = 0;
  for (const iv of combo) {
    cost += WEIGHTS.load * state.load(iv.id) + WEIGHTS.dayLoad * state.dayCount(iv.id, dk);
    cost += (WEIGHTS.idle * state.idleMinutes(iv, s, e)) / p.drive.slotMinutes;
    if (iv.modeCfg.offline && iv.modeCfg.online && iv.modeCfg.pref !== mode) cost += WEIGHTS.modePref;
    if (ctx.continuityIds && ctx.continuityIds.has(iv.id)) cost -= WEIGHTS.continuity;
  }
  if (cand.preferred && cand.preferred.length && !covers(cand.preferred, s, e)) cost += WEIGHTS.candidatePref;
  if (ctx.preferMode && ctx.preferMode !== mode) cost += ctx.modeChangeCost ?? 0;
  return cost;
}


export function* iterOptions(p, round, cand, s, state, opt = {}) {
  const e = s + round.durationMinutes * MIN;
  const modes = permittedModes(p, round);
  if (!modes.length) return;
  let elig = eligibleInterviewers(p, round, s, e, state, opt.exclude);
  if (elig.length < round.panelSize) return;
  const must = opt.mustInclude && opt.mustInclude.length ? opt.mustInclude : null;
  if (must) {
    const ids = new Set(elig.map((i) => i.id));
    if (!must.every((id) => ids.has(id))) return;
  }
  if (elig.length > 10) {
    const keep = must ? elig.filter((i) => must.includes(i.id)) : [];
    const rest = elig
      .filter((i) => !keep.includes(i))
      .sort((a, b) => state.load(a.id) - state.load(b.id) || (a.id < b.id ? -1 : 1))
      .slice(0, 10 - keep.length);
    elig = [...keep, ...rest];
  }
  elig = [...elig].sort((a, b) => (a.id < b.id ? -1 : 1));
  let offlineRoom;
  for (const combo of combinations(elig, round.panelSize)) {
    if (must && !must.every((id) => combo.some((c) => c.id === id))) continue;
    if (!panelSatisfies(round, combo)) continue;
    for (const mode of modes) {
      if (!combo.every((iv) => iv.modeCfg[mode])) continue;
      let roomId = null;
      if (mode === 'offline') {
        if (offlineRoom === undefined) offlineRoom = pickRoom(p, round, s, e, state, opt.preferRoomId) || null;
        if (!offlineRoom) continue;
        roomId = offlineRoom.id;
      }
      yield {
        interviewerIds: combo.map((i) => i.id).sort(),
        mode,
        roomId,
        cost: opt.noCost ? 0 : optionCost(p, state, cand, s, e, combo, mode, opt),
      };
    }
  }
}

export function hasOption(p, round, cand, s, state, opt = {}) {
  for (const _ of iterOptions(p, round, cand, s, state, { ...opt, noCost: true })) return true; // eslint-disable-line no-unused-vars
  return false;
}

export function buildOptions(p, round, cand, s, state, opt = {}) {
  const list = [...iterOptions(p, round, cand, s, state, opt)];
  list.sort((a, b) => a.cost - b.cost || (a.mode < b.mode ? -1 : a.mode > b.mode ? 1 : 0) || (a.interviewerIds.join() < b.interviewerIds.join() ? -1 : 1));
  return opt.limit ? list.slice(0, opt.limit) : list;
}

/** Start times where the candidate is available and free (ignores interviewer/room contention). */
export function candidateStarts(p, round, cand, state) {
  const dur = round.durationMinutes * MIN;
  return generateStarts(p, round).filter((s) => covers(cand.availability, s, s + dur) && state.candidateFree(cand, s, s + dur));
}

export function makeSession(round, cand, s, opt) {
  return {
    key: `new:${cand.id}:${round.id}`,
    candidateId: cand.id,
    roundId: round.id,
    start: s,
    end: s + round.durationMinutes * MIN,
    mode: opt.mode,
    roomId: opt.roomId,
    interviewerIds: opt.interviewerIds,
    cost: opt.cost,
  };
}
