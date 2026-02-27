import express from "express";
import {
  getUnitsByCourse,
  createUnit,
  updateUnit,
  deleteUnit,
} from "../controllers/unitController.js";
import { authenticate, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// GET all units for a specific course/program
router.get("/course/:programId", authenticate, authorizeRoles("admin", "teacher"), getUnitsByCourse);

// POST create a new unit and link to a course
router.post("/", authenticate, authorizeRoles("admin", "teacher"), createUnit);

// PUT update a specific unit
router.put("/:id", authenticate, authorizeRoles("admin", "teacher"), updateUnit);

// DELETE a specific unit
router.delete("/:id", authenticate, authorizeRoles("admin", "teacher"), deleteUnit);

export default router;
