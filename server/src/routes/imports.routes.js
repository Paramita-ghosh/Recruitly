import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { asyncHandler, badRequest } from '../utils/httpError.js';
import * as imp from '../services/import.service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const okName = /\.csv$/i.test(file.originalname);
    const okType = ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'].includes(file.mimetype);
    cb(okName && okType ? null : badRequest('Please upload a .csv file.'), okName && okType);
  },
});

const router = Router();
router.use(authenticate, authorize('coordinator'));
const ok = (res, data) => res.json({ success: true, data });

router.get('/templates/:kind', (req, res) => {
  const cols = req.params.kind === 'candidates' ? imp.CANDIDATE_COLUMNS : imp.INTERVIEWER_COLUMNS;
  const sample = req.params.kind === 'candidates'
    ? 'Asha Verma,asha.verma@example.edu,21CS001,Computer Science,AI & ML,2027,Campus Hiring 2026\n'
    : 'Ravi Kumar,ravi.kumar@example.com,Northwind Labs,DSA;Coding;Backend,6,both,offline\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.kind}-template.csv"`);
  res.send(`${cols.join(',')}\n${sample}`);
});

for (const kind of ['candidates', 'interviewers']) {
  router.post(`/${kind}`, upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Attach a CSV file in the "file" field.');
    if (String(req.query.mode) === 'commit') return ok(res, await imp.commitImport(req.user, kind, req.file.buffer, req.ip));
    const { rows, summary } = await imp.previewImport(kind, req.file.buffer);
    ok(res, { summary, rows: rows.slice(0, 200).map((r) => ({ line: r.line, status: r.status, errors: r.errors, name: r.raw.name, email: r.raw.email })), errorCsv: rows.some((r) => r.status !== 'new') ? imp.errorReportCsv(rows) : null });
  }));
}
export default router;
