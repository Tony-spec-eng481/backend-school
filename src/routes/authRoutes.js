import express from 'express';
import {
  register,
  login,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
  registerStaff,
  updateProfile,
  registerTeacher,
  getDepartments,
  updateTeacherProfile,
  verifyEmail,
  registerAdminSelf
} from '../controllers/authController.js';

import { authenticate, authorizeRoles } from '../middleware/authMiddleware.js';
import upload from '../middleware/uploadMiddleware.js';

const router = express.Router();
    
/* ================================
   PUBLIC ROUTES 
================================ */

router.post('/register', register);
router.post('/register-admin', registerAdminSelf);
router.post('/register/teacher', upload.fields([
  { name: 'nationalIdPhoto', maxCount: 1 },
  { name: 'profilePhoto', maxCount: 1 }
]), registerTeacher);
router.get('/departments', getDepartments);
router.post('/login', login);
router.post('/refresh-token', refreshToken);
router.post('/logout', logout);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/verify-email/:token', verifyEmail);

/* ================================
   PROTECTED ROUTES EXAMPLES
================================ */

// Only authenticated users
router.get('/profile', authenticate, (req, res) => {
  res.json({ message: 'Profile accessed', user: req.user });
});
router.patch('/update-teacher-profile', authenticate, authorizeRoles('teacher'), upload.fields([
  { name: 'nationalIdPhoto', maxCount: 1 },
  { name: 'profilePhoto', maxCount: 1 }
]), updateTeacherProfile);

// Admin only
router.get(
  '/admin-dashboard',
  authenticate,
  authorizeRoles('admin'),
  (req, res) => {
    res.json({ message: 'Welcome Admin' });
  }
);

router.post('/register-staff', authenticate, authorizeRoles('admin'), registerStaff);

router.patch('/update-profile', authenticate, updateProfile);

// Teacher only
router.get(
  '/teacher-dashboard',
  authenticate,
  authorizeRoles('teacher'),
  (req, res) => {
    res.json({ message: 'Welcome Teacher' });
  }
);

export default router;
