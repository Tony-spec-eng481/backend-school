import express from 'express';
import {
  createLiveClass,
  getLiveClasses,
  getZoomJoinInfo,
  updateClassStatus,
  deleteLiveClass,
  getSessionInfo,
  getRecordingInfo,
  getRecordingDownload,
} from '../controllers/liveClassController.js';
import { authenticate, authorizeRoles } from '../middleware/authMiddleware.js';

const router = express.Router();

// ─── Core CRUD ─────────────────────────────────────────────────────────
router.get('/', authenticate, getLiveClasses);
router.post('/', authenticate, authorizeRoles('teacher', 'admin', 'lecturer'), createLiveClass);
router.delete('/:id', authenticate, authorizeRoles('teacher', 'admin', 'lecturer'), deleteLiveClass);

// ─── Zoom Join Info ────────────────────────────────────────────────────
router.get('/join-info/:id', authenticate, getZoomJoinInfo);

// ─── Class Status ──────────────────────────────────────────────────────
router.patch('/:id/status', authenticate, authorizeRoles('teacher', 'admin', 'lecturer'), updateClassStatus);

// ─── Session Info ──────────────────────────────────────────────────────
router.get('/:id/session-info', authenticate, getSessionInfo);

// ─── Recording Info ────────────────────────────────────────────────────
router.get('/recording/:classId', authenticate, getRecordingInfo);

// ─── Recording Download ───────────────────────────────────────────────
router.get('/:id/recording/download', authenticate, getRecordingDownload);

export default router;