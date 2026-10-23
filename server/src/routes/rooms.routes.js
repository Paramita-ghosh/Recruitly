import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/httpError.js';
import { roomSchema, roomPatchSchema, roomBlockSchema } from '../utils/schemas.js';
import * as d from '../services/drive.service.js';

const router = Router();
const staff = [authenticate, authorize('coordinator', 'company')];
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

router.post('/drives/:driveId/rooms', ...staff, validate(roomSchema), asyncHandler(async (req, res) => ok(res, await d.createRoom(req.user, req.params.driveId, req.body), 201)));
router.patch('/rooms/:roomId', ...staff, validate(roomPatchSchema), asyncHandler(async (req, res) => ok(res, await d.updateRoom(req.user, req.params.roomId, req.body))));
router.post('/rooms/:roomId/blocks', ...staff, validate(roomBlockSchema), asyncHandler(async (req, res) => ok(res, await d.addRoomBlock(req.user, req.params.roomId, req.body), 201)));
router.delete('/room-blocks/:blockId', ...staff, asyncHandler(async (req, res) => { await d.deleteRoomBlock(req.user, req.params.blockId); ok(res, { ok: true }); }));

export default router;
