import express from "express";
import {
  createCourse,
  getAllCourses,
  getCourseById,
  deleteCourse,
  updateCourse,
} from "../controllers/courseController.js";
import { authenticate, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public routes
router.get("/", getAllCourses);
router.get("/:id", getCourseById);

// Protected routes (Admin only for course management)
router.post(
  "/",
  authenticate,
  authorizeRoles("admin"),
  createCourse,
);

router.put(
  "/:id",
  authenticate,
  authorizeRoles("admin"),
  updateCourse,
);

router.delete(
  "/:id",
  authenticate,
  authorizeRoles("admin"),
  deleteCourse,
);

export default router;
