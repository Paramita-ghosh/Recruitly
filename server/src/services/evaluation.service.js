import env from '../config/env.js';
import { pool, query, withTransaction, lockDrive } from '../config/database.js';
import { loadProblem } from './loadProblem.js';
import { solveSchedule } from '../scheduling/scheduleSolver.js';
import { placeSession } from './session.service.js';
import { notify } from './notification.service.js';
import { sendBookingInvite } from './booking.service.js';
import { notifySessionParticipants } from './scheduling.service.js';
import { syncSession } from './calendar.service.js';
import { emitToRole } from '../realtime/socket.js';
import { audit } from '../utils/audit.js';
import { badRequest, forbidden, notFound, conflict } from '../utils/httpError.js';

const r2 = (n) => Math.round(n * 100) / 100;

export function weightedScore(criteria, scores, scaleMin, scaleMax) {
  const totalW = criteria.reduce((a, c) => a + Number(c.weight), 0);
  let sum = 0;
  for (const c of criteria) {
    const sc = scores.find((s) => s.criterionId === c.id);
    sum += (Number(c.weight) / totalW) * ((sc.score - scaleMin) / (scaleMax - scaleMin)) * 100;
  }
  return r2(sum);
}

export async function getRubric(roundId, db = pool) {
  const rub = (await db.query('SELECT * FROM evaluation_rubrics WHERE round_id = $1', [roundId])).rows[0];
  if (!rub) return null;
  const criteria = (await db.query('SELECT id, position, name, description, weight FROM rubric_criteria WHERE rubric_id = $1 ORDER BY position, name', [rub.id])).rows;
  return { id: rub.id, name: rub.name, scaleMin: rub.scale_min, scaleMax: rub.scale_max, criteria };
}

export async function saveRubric(user, roundId, { name, scaleMin, scaleMax, criteria }) {
  const total = criteria.reduce((a, c) => a + c.weight, 0);
  if (Math.abs(total - 100) > 0.001) throw badRequest(`Rubric weights must total 100% (currently ${total}%).`);
  const round = (await query('SELECT id, drive_id FROM interview_rounds WHERE id = $1', [roundId])).rows[0];
  if (!round) throw notFound('Round not found');
  await withTransaction(async (client) => {
    const existing = (await client.query('SELECT id FROM evaluation_rubrics WHERE round_id = $1', [roundId])).rows[0];
    let rid;
    if (existing) {
      rid = existing.id;
      await client.query('UPDATE evaluation_rubrics SET name = $2, scale_min = $3, scale_max = $4 WHERE id = $1', [rid, name, scaleMin, scaleMax]);
    } else {
      rid = (await client.query('INSERT INTO evaluation_rubrics (round_id, name, scale_min, scale_max) VALUES ($1,$2,$3,$4) RETURNING id', [roundId, name, scaleMin, scaleMax])).rows[0].id;
    }
    const used = existing && (await client.query('SELECT 1 FROM evaluation_scores es JOIN rubric_criteria rc ON rc.id = es.criterion_id WHERE rc.rubric_id = $1 LIMIT 1', [rid])).rows[0];
    if (used) throw conflict('Evaluations have already been submitted for this round, so its rubric can no longer be changed.');
    await client.query('DELETE FROM rubric_criteria WHERE rubric_id = $1', [rid]);
    let pos = 1;
    for (const c of criteria) {
      await client.query('INSERT INTO rubric_criteria (rubric_id, position, name, description, weight) VALUES ($1,$2,$3,$4,$5)', [rid, pos++, c.name, c.description || null, c.weight]);
    }
    await audit(client, { actorId: user.id, action: 'rubric.save', entityType: 'round', entityId: roundId, details: { criteria: criteria.length } });
  });
  return getRubric(roundId);
}

async function loadSessionForEval(db, sessionId) {
  const { rows } = await db.query(
    `SELECT s.*, d.company_id, d.name AS drive_name, rd.name AS round_name, rd.pass_threshold, rd.requires_review, rd.position AS round_position, rd.drive_id AS round_drive,
            cu.name AS candidate_name,
            (SELECT count(*) FROM interview_assignments a WHERE a.session_id = s.id AND a.active) AS panel_count
       FROM interview_sessions s JOIN recruitment_drives d ON d.id = s.drive_id JOIN interview_rounds rd ON rd.id = s.round_id
       JOIN users cu ON cu.id = s.candidate_id WHERE s.id = $1`,
    [sessionId],
  );
  if (!rows[0]) throw notFound('Interview not found');
  return rows[0];
}

const isAssigned = async (db, sessionId, userId) => Boolean((await db.query('SELECT 1 FROM interview_assignments WHERE session_id = $1 AND interviewer_id = $2 AND active', [sessionId, userId])).rows[0]);


export async function getEvaluationView(user, sessionId) {
  const s = await loadSessionForEval(pool, sessionId);
  const coordinator = user.role === 'coordinator';
  if (!coordinator && !(user.role === 'interviewer' && (await isAssigned(pool, sessionId, user.id)))) throw forbidden('You are not assigned to this interview.');
  const rubric = await getRubric(s.round_id);
  const evals = (await query(
    `SELECT e.*, u.name AS interviewer_name,
            COALESCE((SELECT json_agg(json_build_object('criterionId', es.criterion_id, 'score', es.score, 'comment', es.comment)) FROM evaluation_scores es WHERE es.evaluation_id = e.id), '[]') AS scores
       FROM evaluations e JOIN users u ON u.id = e.interviewer_id WHERE e.session_id = $1 ORDER BY e.submitted_at`,
    [sessionId],
  )).rows;
  const present = (e) => ({ id: e.id, interviewerId: e.interviewer_id, interviewerName: e.interviewer_name, comments: e.comments, recommendation: e.recommendation, weightedScore: e.weighted_score, scores: e.scores, submittedAt: e.submitted_at, revision: e.revision });
  const mine = evals.find((e) => e.interviewer_id === user.id);
  const submitted = evals.length;
  const allIn = submitted >= Number(s.panel_count);
  let others = null;
  let blinded = false;
  if (coordinator) others = evals.filter((e) => e.interviewer_id !== user.id).map(present);
  else if (mine && allIn) others = evals.filter((e) => e.interviewer_id !== user.id).map(present);
  else blinded = true;
  return {
    session: { id: s.id, candidateName: s.candidate_name, roundName: s.round_name, driveName: s.drive_name, startsAt: s.starts_at, endsAt: s.ends_at, mode: s.mode, status: s.status, resultStatus: s.result_status },
    rubric,
    panel: { size: Number(s.panel_count), submitted, ...(coordinator || mine ? {} : {}) },
    mine: mine ? present(mine) : null,
    others,
    blinded,
    blindedNote: blinded ? 'Other panel members’ scores and comments are hidden until you and every panel member have submitted.' : null,
    result: coordinator ? { status: s.result_status, finalScore: s.final_score, finalizedAt: s.finalized_at, note: s.result_note } : undefined,
    canSubmit: !coordinator && ['scheduled', 'in_progress', 'completed'].includes(s.status) && s.result_status !== 'passed' && s.result_status !== 'failed',
  };
}

export async function submitEvaluation(user, sessionId, body, ip) {
  const out = await withTransaction(async (client) => {
    const s0 = (await client.query('SELECT drive_id FROM interview_sessions WHERE id = $1', [sessionId])).rows[0];
    if (!s0) throw notFound('Interview not found');
    await lockDrive(client, s0.drive_id);
    const s = await loadSessionForEval(client, sessionId);
    if (!(await isAssigned(client, sessionId, user.id))) throw forbidden('You are not assigned to this interview.');
    if (!['scheduled', 'in_progress', 'completed'].includes(s.status)) throw badRequest('This interview cannot be evaluated in its current state.');
    if (['passed', 'failed'].includes(s.result_status)) throw badRequest('This result has been finalised. Ask the coordinator to reopen it.');
    if (!env.ALLOW_EARLY_EVALUATION && s.starts_at.getTime() > Date.now()) throw badRequest('You can submit an evaluation once the interview has started.');
    const rubric = await getRubric(s.round_id, client);
    if (!rubric || !rubric.criteria.length) throw badRequest('No evaluation rubric has been configured for this round.');

    const ids = new Set(rubric.criteria.map((c) => c.id));
    const given = new Set();
    for (const sc of body.scores) {
      if (!ids.has(sc.criterionId)) throw badRequest('Unknown rubric criterion.');
      if (given.has(sc.criterionId)) throw badRequest('Each criterion can only be scored once.');
      if (sc.score < rubric.scaleMin || sc.score > rubric.scaleMax) throw badRequest(`Scores must be between ${rubric.scaleMin} and ${rubric.scaleMax}.`);
      given.add(sc.criterionId);
    }
    if (given.size !== ids.size) throw badRequest('Please score every criterion.');
    const ws = weightedScore(rubric.criteria, body.scores, rubric.scaleMin, rubric.scaleMax);

    const prev = (await client.query('SELECT id, weighted_score, revision FROM evaluations WHERE session_id = $1 AND interviewer_id = $2 FOR UPDATE', [sessionId, user.id])).rows[0];
    let evalId;
    if (prev) {
      evalId = prev.id;
      await client.query('UPDATE evaluations SET comments = $2, recommendation = $3, weighted_score = $4, revision = revision + 1, updated_at = now() WHERE id = $1', [evalId, body.comments || null, body.recommendation || null, ws]);
      await client.query('DELETE FROM evaluation_scores WHERE evaluation_id = $1', [evalId]);
      await audit(client, { actorId: user.id, action: 'evaluation.correct', entityType: 'evaluation', entityId: evalId, details: { from: prev.weighted_score, to: ws, revision: prev.revision + 1 }, ip });
    } else {
      evalId = (await client.query('INSERT INTO evaluations (session_id, interviewer_id, comments, recommendation, weighted_score) VALUES ($1,$2,$3,$4,$5) RETURNING id', [sessionId, user.id, body.comments || null, body.recommendation || null, ws])).rows[0].id;
      await audit(client, { actorId: user.id, action: 'evaluation.submit', entityType: 'evaluation', entityId: evalId, details: { sessionId }, ip });
    }
    for (const sc of body.scores) await client.query('INSERT INTO evaluation_scores (evaluation_id, criterion_id, score, comment) VALUES ($1,$2,$3,$4)', [evalId, sc.criterionId, sc.score, sc.comment || null]);

    const agg = (await client.query('SELECT count(*)::int AS n, avg(weighted_score)::numeric(6,2) AS avg FROM evaluations WHERE session_id = $1', [sessionId])).rows[0];
    const complete = agg.n >= Number(s.panel_count);
    const threshold = Number(s.pass_threshold);
    await client.query(
      `UPDATE interview_sessions SET final_score = $2, status = $3, result_status = $4, updated_at = now() WHERE id = $1`,
      [sessionId, agg.avg, complete ? 'completed' : (s.starts_at.getTime() > Date.now() ? s.status : 'in_progress'), complete ? (agg.avg >= threshold ? 'provisional_pass' : 'provisional_fail') : 'pending'],
    );
    await client.query(`UPDATE drive_candidates SET pipeline_status = 'evaluation_pending', updated_at = now() WHERE drive_id = $1 AND candidate_id = $2`, [s.drive_id, s.candidate_id]);
    return { s, complete, score: agg.avg, evalId, ws, autoFinalize: complete && !s.requires_review };
  });

  emitToRole('coordinator', 'evaluation:submitted', { sessionId, driveId: out.s.drive_id, complete: out.complete });
  let result = null;
  if (out.autoFinalize) {
    result = await finalizeResult({ id: null, role: 'system' }, sessionId, { decision: out.score >= Number(out.s.pass_threshold) ? 'pass' : 'fail', auto: true }, ip);
  } else if (out.complete) {
    const coords = await query(`SELECT id FROM users WHERE role = 'coordinator' AND is_active`);
    for (const c of coords.rows) await notify({ userId: c.id, category: 'evaluation', title: `Review needed: ${out.s.candidate_name}`, body: `${out.s.round_name} evaluations are complete (${out.score}/100). Finalise the result.`, link: `/coordinator/drives/${out.s.drive_id}/evaluations`, dedupeKey: `review:${sessionId}` });
  }
  return { evaluationId: out.evalId, weightedScore: out.ws, panelComplete: out.complete, aggregate: out.score, finalised: result };
}


export async function finalizeResult(user, sessionId, { decision, note, auto = false }, ip) {
  const info = await withTransaction(async (client) => {
    const s0 = (await client.query('SELECT drive_id FROM interview_sessions WHERE id = $1', [sessionId])).rows[0];
    if (!s0) throw notFound('Interview not found');
    await lockDrive(client, s0.drive_id);
    const s = await loadSessionForEval(client, sessionId);
    const evals = (await client.query('SELECT count(*)::int AS n FROM evaluations WHERE session_id = $1', [sessionId])).rows[0].n;
    const complete = evals >= Number(s.panel_count) && evals > 0;
    if (['passed', 'failed'].includes(s.result_status)) throw conflict('This result has already been finalised.');
    if (!auto) {
      if (!complete && !note) throw badRequest('Evaluations are incomplete. Provide a note to override and finalise anyway.');
    }
    const passed = decision === 'pass';
    const rounds = (await client.query('SELECT id, position, booking_policy FROM interview_rounds WHERE drive_id = $1 ORDER BY position', [s.drive_id])).rows;
    const next = rounds.find((r) => r.position > s.round_position) || null;
    await client.query(
      `UPDATE interview_sessions SET result_status = $2, status = 'completed', finalized_by = $3, finalized_at = now(), result_note = $4,
              result_published = $5, version = version, updated_at = now() WHERE id = $1`,
      [sessionId, passed ? 'passed' : 'failed', user.id || null, note || null, passed],
    );
    if (!passed) {
      await client.query(`UPDATE drive_candidates SET pipeline_status = 'failed', updated_at = now() WHERE drive_id = $1 AND candidate_id = $2`, [s.drive_id, s.candidate_id]);
    } else if (!next) {
      await client.query(`UPDATE drive_candidates SET pipeline_status = 'passed', updated_at = now() WHERE drive_id = $1 AND candidate_id = $2`, [s.drive_id, s.candidate_id]);
    } else {
      await client.query(`UPDATE drive_candidates SET pipeline_status = 'awaiting_booking', current_round_id = $3, updated_at = now() WHERE drive_id = $1 AND candidate_id = $2`, [s.drive_id, s.candidate_id, next.id]);
    }
    await audit(client, { actorId: user.id || null, action: auto ? 'result.auto_finalize' : 'result.finalize', entityType: 'session', entityId: sessionId, details: { decision, note: note || null, complete, score: s.final_score }, ip });
    return { s, passed, next };
  });

  const { s, passed, next } = info;
  try {
    if (passed && next) {
      await scheduleNextRound(s.drive_id, s.candidate_id, next);
    } else if (passed) {
      await notify({ userId: s.candidate_id, category: 'result', title: 'Congratulations!', body: `You cleared every round of ${s.drive_name}.`, link: '/candidate', dedupeKey: `final:${s.drive_id}:${s.candidate_id}`, email: { subject: `Congratulations – you cleared ${s.drive_name}`, intro: `You have successfully cleared all interview rounds of ${s.drive_name}. The placement cell will be in touch with next steps.` } });
    }
  } catch (e) {
    console.error('[pipeline] advancing candidate failed', e.message);
  }
  emitToRole('coordinator', 'pipeline:changed', { driveId: s.drive_id });
  return { sessionId, result: passed ? 'passed' : 'failed', nextRound: next?.id || null };
}

async function scheduleNextRound(driveId, candidateId, nextRound) {
  if (nextRound.booking_policy === 'auto') {
    const placed = await withTransaction(async (client) => {
      await lockDrive(client, driveId);
      const { problem } = await loadProblem(client, driveId);
      const res = solveSchedule(problem, { roundId: nextRound.id, candidateIds: [candidateId] });
      const a = res.assignments[0];
      if (!a) return null;
      const id = await placeSession(client, { driveId, roundId: nextRound.id, candidateId, start: a.start, end: a.end, mode: a.mode, roomId: a.roomId, interviewerIds: a.interviewerIds, source: 'solver', published: true });
      await client.query(`UPDATE drive_candidates SET pipeline_status = 'scheduled', updated_at = now() WHERE drive_id = $1 AND candidate_id = $2`, [driveId, candidateId]);
      return id;
    });
    if (placed) {
      await notifySessionParticipants(placed, 'published');
      await syncSession(placed);
      return;
    }
  }
  await sendBookingInvite({ candidateId, driveId, roundId: nextRound.id });
}

export async function advanceCandidate(user, sessionId, ip) {
  const s = await loadSessionForEval(pool, sessionId);
  if (s.result_status !== 'passed') throw badRequest('Only passed interviews can be advanced. Finalise the result first.');
  const next = (await query('SELECT id, position, booking_policy FROM interview_rounds WHERE drive_id = $1 AND position > $2 ORDER BY position LIMIT 1', [s.drive_id, s.round_position])).rows[0];
  if (!next) throw badRequest('This was the final round.');
  const has = (await query(`SELECT 1 FROM interview_sessions WHERE candidate_id = $1 AND round_id = $2 AND status NOT IN ('cancelled')`, [s.candidate_id, next.id])).rows[0];
  if (has) throw conflict('The candidate already has an interview in the next round.');
  await query(`UPDATE drive_candidates SET pipeline_status = 'awaiting_booking', current_round_id = $3, updated_at = now() WHERE drive_id = $1 AND candidate_id = $2`, [s.drive_id, s.candidate_id, next.id]);
  await scheduleNextRound(s.drive_id, s.candidate_id, next);
  await audit(null, { actorId: user.id, action: 'pipeline.advance', entityType: 'session', entityId: sessionId, details: { next: next.id }, ip });
  return { advanced: true };
}

export async function publishResults(user, driveId) {
  const { rows } = await query(
    `UPDATE interview_sessions SET result_published = true, updated_at = now() WHERE drive_id = $1 AND result_status IN ('passed','failed') AND result_published = false
     RETURNING id, candidate_id, result_status, round_id`,
    [driveId],
  );
  const drive = (await query('SELECT name FROM recruitment_drives WHERE id = $1', [driveId])).rows[0];
  for (const r of rows) {
    await notify({
      userId: r.candidate_id,
      category: 'result',
      title: r.result_status === 'passed' ? 'Result published: you passed' : 'Result published',
      body: r.result_status === 'passed' ? `You passed a round of ${drive.name}.` : `Thank you for interviewing for ${drive.name}. Unfortunately you will not proceed to the next stage.`,
      link: '/candidate',
      dedupeKey: `result:${r.id}`,
      email: { subject: `Your result – ${drive.name}`, intro: r.result_status === 'passed' ? 'Congratulations, you have passed this round.' : 'Thank you for your time. You will not proceed to the next stage.' },
    });
  }
  await audit(null, { actorId: user.id, action: 'results.publish', entityType: 'drive', entityId: driveId, details: { count: rows.length } });
  return { published: rows.length };
}

export async function rankings(user, driveId) {
  const drive = (await query('SELECT company_id, eligibility FROM recruitment_drives WHERE id = $1', [driveId])).rows[0];
  if (!drive) throw notFound('Drive not found');
  if (user.role === 'company') {
    if (user.companyId !== drive.company_id) throw forbidden();
    if (drive.eligibility?.shareRankingsWithCompany === false) throw forbidden('The placement cell has not shared rankings with your company yet.');
  } else if (user.role !== 'coordinator') throw forbidden();

  const rounds = (await query('SELECT id, name, position FROM interview_rounds WHERE drive_id = $1 ORDER BY position', [driveId])).rows;
  const criteria = (await query(
    `SELECT rc.id, rc.name, rc.weight, rc.position, ev.round_id FROM rubric_criteria rc JOIN evaluation_rubrics ev ON ev.id = rc.rubric_id
      JOIN interview_rounds r ON r.id = ev.round_id WHERE r.drive_id = $1 ORDER BY rc.position`,
    [driveId],
  )).rows;
  const sess = (await query(
    `SELECT s.id, s.candidate_id, s.round_id, s.result_status, s.final_score, u.name,
            (SELECT count(*)::int FROM evaluations e WHERE e.session_id = s.id) AS eval_count
       FROM interview_sessions s JOIN users u ON u.id = s.candidate_id
      WHERE s.drive_id = $1 AND s.status <> 'cancelled' AND EXISTS (SELECT 1 FROM evaluations e WHERE e.session_id = s.id)`,
    [driveId],
  )).rows;
  const avgs = (await query(
    `SELECT e.session_id, es.criterion_id, avg(es.score)::numeric(5,2) AS avg FROM evaluations e
       JOIN evaluation_scores es ON es.evaluation_id = e.id JOIN interview_sessions s ON s.id = e.session_id WHERE s.drive_id = $1 GROUP BY 1,2`,
    [driveId],
  )).rows;
  const avgBy = new Map();
  for (const a of avgs) {
    if (!avgBy.has(a.session_id)) avgBy.set(a.session_id, {});
    avgBy.get(a.session_id)[a.criterion_id] = a.avg;
  }
  const byCand = new Map();
  for (const s of sess) {
    if (!byCand.has(s.candidate_id)) byCand.set(s.candidate_id, { candidateId: s.candidate_id, name: s.name, rounds: [] });
    byCand.get(s.candidate_id).rounds.push({ roundId: s.round_id, sessionId: s.id, evalCount: s.eval_count, score: s.final_score, criteria: avgBy.get(s.id) || {}, result: s.result_status, finalised: ['passed', 'failed'].includes(s.result_status) });
  }
  const rows = [...byCand.values()].map((c) => {
    const scored = c.rounds.filter((r) => r.score != null);
    const overall = scored.length ? r2(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null;
    return { ...c, overall, roundsScored: scored.length, final: c.rounds.every((r) => r.finalised), evalCount: c.rounds.reduce((a, r) => a + r.evalCount, 0) };
  });
  rows.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1) || b.roundsScored - a.roundsScored || a.name.localeCompare(b.name) || (a.candidateId < b.candidateId ? -1 : 1));
  let rank = 0;
  let prev = null;
  rows.forEach((r, i) => {
    if (prev === null || r.overall !== prev) rank = i + 1; // equal scores share a rank (1,2,2,4)
    r.rank = rank;
    prev = r.overall;
  });
  return { rounds, criteria, rows, note: 'Scores are 0–100. “Provisional” rows still have open evaluations or un-finalised results. Ties share a rank and are ordered by rounds scored, then name.' };
}

export async function companySummary(user, driveId) {
  const rk = await rankings(user, driveId);
  return { ...rk, rows: rk.rows.map((r) => ({ ...r, rounds: r.rounds.map((x) => ({ ...x, sessionId: undefined })) })) };
}
