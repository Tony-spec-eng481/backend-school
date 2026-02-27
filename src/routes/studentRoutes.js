import express from 'express';
import { authenticate, authorizeRoles } from '../middleware/authMiddleware.js';
import {
  getStats,
  getEnrolledCourses,
  getCoursePlayerDetails,
  getStudentUnits,
  getUnitDetails,
  getAssignments,
  submitAssignment,
  markTopicComplete,
  getLiveClasses,
  getAnnouncements,
  getTickets,
  createTicket
} from '../controllers/studentController.js';

const router = express.Router();

// All student routes require authentication
const guard = [authenticate, authorizeRoles('student')];

router.get('/stats', ...guard, getStats);
router.get('/courses', ...guard, getEnrolledCourses);
router.get('/courses/:id', ...guard, getCoursePlayerDetails);
router.get('/units', ...guard, getStudentUnits);
router.get('/units/:id', ...guard, getUnitDetails);
router.get('/assignments', ...guard, getAssignments);
router.post('/assignments/:id/submit', ...guard, submitAssignment);
router.post('/progress/mark-complete', ...guard, markTopicComplete);
router.get('/live-classes', ...guard, getLiveClasses);
router.get('/announcements', ...guard, getAnnouncements);
router.get('/tickets', ...guard, getTickets);
router.post('/tickets', ...guard, createTicket);

export default router;   