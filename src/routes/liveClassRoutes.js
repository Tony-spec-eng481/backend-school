import express from 'express';
import {
  createLiveClass,
  getLiveClasses,
  getAgoraToken,
  updateClassStatus,
  deleteLiveClass,
  startRecording,
  stopRecording,
  getRecordingInfo,
  getSessionInfo,
  getRecordingDownload,
} from '../controllers/liveClassController.js';
import { authenticate, authorizeRoles } from '../middleware/authMiddleware.js';

const router = express.Router();

// ─── Core CRUD ─────────────────────────────────────────────────────────
router.get('/', authenticate, getLiveClasses);
router.post('/', authenticate, authorizeRoles('teacher', 'admin', 'lecturer'), createLiveClass);
router.delete('/:id', authenticate, authorizeRoles('teacher', 'admin', 'lecturer'), deleteLiveClass);

// ─── Agora Tokens ──────────────────────────────────────────────────────
router.get('/token', authenticate, getAgoraToken);

// ─── Class Status ──────────────────────────────────────────────────────
router.patch('/:id/status', authenticate, authorizeRoles('teacher', 'admin', 'lecturer'), updateClassStatus);

// ─── Session Info ──────────────────────────────────────────────────────
router.get('/:id/session-info', authenticate, getSessionInfo);

// ─── Cloud Recording ───────────────────────────────────────────────────
router.post('/recording/start', authenticate, authorizeRoles('teacher', 'admin', 'lecturer'), startRecording);
router.post('/recording/stop', authenticate, authorizeRoles('teacher', 'admin', 'lecturer'), stopRecording);
router.get('/recording/:classId', authenticate, getRecordingInfo);

// ─── Recording Download ───────────────────────────────────────────────
router.get('/:id/recording/download', authenticate, getRecordingDownload);

export default router;