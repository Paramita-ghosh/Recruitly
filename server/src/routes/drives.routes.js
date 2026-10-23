import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/httpError.js';
import { createDriveSchema, updateDriveSchema, roundSchema, roundPatchSchema, rubricSchema, membersSchema, statusSchema } from '../utils/schemas.js';
import * as d from '../services/drive.service.js';
import * as ev from '../services/evaluation.service.js';

const router = Router();
router.use(authenticate);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const staff = authorize('coordinator', 'company');

router.get('/drives', asyncHandler(async (req, res) => ok(res, await d.listDrives(req.user))));
router.post('/drives', staff, validate(createDriveSchema), asyncHandler(async (req, res) => ok(res, await d.createDrive(req.user, req.body, req.ip), 201)));
router.get('/drives/:driveId', asyncHandler(async (req, res) => ok(res, await d.getDrive(req.user, req.params.driveId))));
router.patch('/drives/:driveId', staff, validate(updateDriveSchema), asyncHandler(async (req, res) => ok(res, await d.updateDrive(req.user, req.params.driveId, req.body, req.ip))));
router.post('/drives/:driveId/approve', authorize('coordinator'), asyncHandler(async (req, res) => ok(res, await d.approveDrive(req.user, req.params.driveId, true))));
router.post('/drives/:driveId/reject', authorize('coordinator'), asyncHandler(async (req, res) => ok(res, await d.approveDrive(req.user, req.params.driveId, false))));

router.post('/drives/:driveId/rounds', staff, validate(roundSchema), asyncHandler(async (req, res) => ok(res, await d.createRound(req.user, req.params.driveId, req.body), 201)));
router.patch('/rounds/:roundId', staff, validate(roundPatchSchema), asyncHandler(async (req, res) => ok(res, await d.updateRound(req.user, req.params.roundId, req.body))));
router.delete('/rounds/:roundId', staff, asyncHandler(async (req, res) => { await d.deleteRound(req.user, req.params.roundId); ok(res, { ok: true }); }));
router.get('/rounds/:roundId/rubric', authorize('coordinator', 'company', 'interviewer'), asyncHandler(async (req, res) => ok(res, await ev.getRubric(req.params.roundId))));
router.put('/rounds/:roundId/rubric', authorize('coordinator'), validate(rubricSchema), asyncHandler(async (req, res) => ok(res, await ev.saveRubric(req.user, req.params.roundId, req.body))));

router.get('/drives/:driveId/rooms', authorize('coordinator', 'company', 'interviewer'), asyncHandler(async (req, res) => ok(res, await d.listRooms(req.user, req.params.driveId))));

router.get('/drives/:driveId/candidates', staff, asyncHandler(async (req, res) => ok(res, await d.listDriveCandidates(req.user, req.params.driveId))));
router.post('/drives/:driveId/candidates', staff, validate(membersSchema), asyncHandler(async (req, res) => ok(res, await d.addMembers(req.user, req.params.driveId, 'candidates', req.body))));
router.delete('/drives/:driveId/candidates/:uid', staff, asyncHandler(async (req, res) => { await d.removeMember(req.user, req.params.driveId, 'candidates', req.params.uid); ok(res, { ok: true }); }));
router.get('/drives/:driveId/interviewers', staff, asyncHandler(async (req, res) => ok(res, await d.listDriveInterviewers(req.user, req.params.driveId))));
router.post('/drives/:driveId/interviewers', staff, validate(membersSchema), asyncHandler(async (req, res) => ok(res, await d.addMembers(req.user, req.params.driveId, 'interviewers', req.body))));
router.delete('/drives/:driveId/interviewers/:uid', staff, asyncHandler(async (req, res) => { await d.removeMember(req.user, req.params.driveId, 'interviewers', req.params.uid); ok(res, { ok: true }); }));
router.get('/drives/:driveId/pipeline', staff, asyncHandler(async (req, res) => ok(res, await d.getPipeline(req.user, req.params.driveId))));
router.patch('/drives/:driveId/candidates/:uid/status', authorize('coordinator'), validate(statusSchema), asyncHandler(async (req, res) => ok(res, await d.setCandidateStatus(req.user, req.params.driveId, req.params.uid, req.body.status, req.body.note))));

export default router;
