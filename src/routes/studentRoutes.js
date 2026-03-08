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
  createTicket,
  getAvailableCourses,
  enrollInCourse,
  recordLiveClassJoin,
  recordLiveClassLeave,
  getNotifications,
  markNotificationRead
} from '../controllers/studentController.js';

import upload from '../middleware/uploadMiddleware.js';

const router = express.Router();

// All student routes require authentication
const guard = [authenticate, authorizeRoles('student')];

router.get('/stats', ...guard, getStats);
router.get('/courses', ...guard, getEnrolledCourses);
router.get('/courses/:id', ...guard, getCoursePlayerDetails);
router.get('/available-courses', ...guard, getAvailableCourses);
router.post('/enroll', ...guard, enrollInCourse);
router.get('/units', ...guard, getStudentUnits);
router.get('/units/:id', ...guard, getUnitDetails);
router.get('/assignments', ...guard, getAssignments);
router.post('/assignments/:id/submit', ...guard, upload.single('file'), submitAssignment);
router.post('/progress/mark-complete', ...guard, markTopicComplete);
router.get('/live-classes', ...guard, getLiveClasses);
router.get('/announcements', ...guard, getAnnouncements);
router.get('/tickets', ...guard, getTickets);
router.post('/tickets', ...guard, createTicket);

// Live Class Attendance
router.post('/live-classes/join', ...guard, recordLiveClassJoin);
router.post('/live-classes/leave', ...guard, recordLiveClassLeave);

// Notifications
router.get('/notifications', authenticate, authorizeRoles('student', 'teacher', 'lecturer'), getNotifications);
router.patch('/notifications/:id/read', authenticate, authorizeRoles('student', 'teacher', 'lecturer'), markNotificationRead);

export default router;   