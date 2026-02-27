// src/routes/lecturerRoutes.js
import express from "express";
import { authenticate, authorizeRoles } from "../middleware/authMiddleware.js";
import * as lecturerController from "../controllers/lecturerController.js";
import upload from "../middleware/uploadMiddleware.js";


const router = express.Router();

// --- ROUTES ---
// All routes require authentication as a lecturer

// Overview
router.get(
  "/overview",
  authenticate,
  authorizeRoles("teacher", "lecturer"),
  lecturerController.getOverview,
);

// Units 
router.get(
  "/units",
  authenticate,
  authorizeRoles("teacher", "lecturer"),
  lecturerController.getUnits,
);

// Students by Unit   
router.get(
  "/units/:unitId/students",
  authenticate,
  authorizeRoles("teacher", "lecturer"),
  lecturerController.getStudentsByUnit,
);

// Programs
router.get(
  "/programs",
  authenticate,
  authorizeRoles("teacher", "lecturer"),
  lecturerController.getPrograms,
);

// Topics
router.get(
  "/topics/:unitId",
  authenticate,  
  authorizeRoles("teacher", "lecturer"),
  lecturerController.getTopicsByUnit,
);

router.post(
  "/topics",
  authenticate,
  authorizeRoles("teacher", "lecturer"),
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "document", maxCount: 1 },
    { name: "audio", maxCount: 1 },
  ]),
  lecturerController.createTopic,
);

router.patch(
  "/topics/:id",
  authenticate,
  authorizeRoles("teacher", "lecturer"),
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "document", maxCount: 1 },
    { name: "audio", maxCount: 1 },
  ]),
  lecturerController.updateTopic,
);


router.delete(
  "/topics/:id",
  authenticate,
  authorizeRoles("teacher", "lecturer"),
  lecturerController.deleteTopic,
);

// Assignments
router.get(
  "/assignments",
  authenticate,
  authorizeRoles("teacher", "lecturer"),
  lecturerController.getAssignments,
);

router.post(
  "/assignments",
  authenticate,
  authorizeRoles("teacher", "lecturer"),
  upload.single("file"),
  lecturerController.createAssignment,
);


// Submissions
router.get(
  "/submissions",
  authenticate,
  authorizeRoles("teacher", "lecturer"),
  lecturerController.getSubmissions,
);

// Live Classes
router.get(
  "/live-classes",
  authenticate,
  authorizeRoles("teacher", "lecturer"),
  lecturerController.getLecturerLiveClasses,
);

export default router;
      