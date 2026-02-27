import express from "express";
import {
  getAnnouncements,
  getAnnouncementById,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  toggleAnnouncementStatus,
  getActiveAnnouncements,
} from "../controllers/announcementController.js";
import { authenticate, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", authenticate, getAnnouncements);
router.get("/active", authenticate, getActiveAnnouncements);
router.get("/:id", getAnnouncementById);

router.post("/", authenticate, createAnnouncement);
router.put("/:id", authenticate, updateAnnouncement);
router.patch("/:id/status", authenticate, toggleAnnouncementStatus);
router.delete("/:id", authenticate, deleteAnnouncement);

export default router;
