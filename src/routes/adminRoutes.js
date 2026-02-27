import { 
  getStats, 
  getUsers, 
  verifyUser, 
  deleteUser,
  getSupportTickets,
  updateTicketStatus,
  getSettings,
  updateSettings,
  getAnnouncements,
  createAnnouncement,
  getPendingCourses,
  updateCourseStatus,
  getAnalytics,
  createDepartment,
  getDepartments,
  updateDepartment,
  deleteDepartment,
  getUserById,
} from '../controllers/adminController.js';
import { authenticate, authorizeRoles } from '../middleware/authMiddleware.js';
import express from "express";

const router = express.Router();

// All routes here should be protected by admin role
router.use(authenticate);
router.use(authorizeRoles('admin'));

router.get('/stats', getStats);
router.get('/users', getUsers);
router.patch('/users/:id/verify', verifyUser);  
router.delete('/users/:id', deleteUser);
router.get("/users/:id", getUserById);

// Support
router.get('/tickets', getSupportTickets);
router.patch('/tickets/:id', updateTicketStatus);

// Settings
router.get('/settings', getSettings);
router.post('/settings', updateSettings);

// Announcements
router.get('/announcements', getAnnouncements);
router.post('/announcements', createAnnouncement);

// Content Approval
router.get('/courses/pending', getPendingCourses);
router.patch('/courses/:id/status', updateCourseStatus);

// Analytics
router.get('/analytics', getAnalytics);

// Departments
router.post('/departments', createDepartment);
router.get('/departments', getDepartments);
router.put('/departments/:id', updateDepartment);
router.delete('/departments/:id', deleteDepartment);

export default router;
