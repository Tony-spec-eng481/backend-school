import supabase from '../config/supabase.js';
import { createZoomMeeting, deleteZoomMeeting } from "../config/zoomConfig.js";

const getLecturerId = (req) => req.user.id;

// ─── CREATE LIVE CLASS ─────────────────────────────────────────────────
export const createLiveClass = async (req, res) => {
  console.log("[liveClassController.createLiveClass] REQ.USER:", req.user?.id);
  console.log("[liveClassController.createLiveClass] BODY:", JSON.stringify(req.body));
  const lecturerId = getLecturerId(req);
  const { unit_id, title, start_time, end_time } = req.body;

  if (!unit_id || !title || !start_time) {
    return res.status(400).json({ error: "unit_id, title, and start_time are required" });
  }

  try {
    // Check lecturer has access to this unit
    const { data: access, error: accessError } = await supabase
      .from("lecturer_units")
      .select("id")
      .eq("lecturer_id", lecturerId)
      .eq("unit_id", unit_id)
      .maybeSingle();

    if (accessError) throw accessError;

    if (!access) {
      return res.status(403).json({ error: "Access denied — not assigned to this unit" });
    }

    // Calculate duration in minutes
    let durationMinutes = 60;
    if (start_time && end_time) {
      const diff = new Date(end_time).getTime() - new Date(start_time).getTime();
      durationMinutes = Math.max(Math.round(diff / 60000), 30);
    }

    // Create Zoom meeting
    const zoomMeeting = await createZoomMeeting(title, start_time, durationMinutes);

    // Save to database
    const { data, error } = await supabase
      .from("live_classes")
      .insert({
        teacher_id: lecturerId,
        unit_id,
        title,
        start_time,
        end_time,
        live_url: zoomMeeting.join_url,
        zoom_meeting_id: zoomMeeting.id,
        zoom_join_url: zoomMeeting.join_url,
        zoom_start_url: zoomMeeting.start_url,
        token: zoomMeeting.password || null,
        status: "scheduled",
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`[liveClassController.createLiveClass] Created class "${title}" with Zoom Meeting ID ${zoomMeeting.id}`);
    res.status(201).json({
      ...data,
      zoom: {
        meetingId: zoomMeeting.id,
        joinUrl: zoomMeeting.join_url,
        startUrl: zoomMeeting.start_url,
        password: zoomMeeting.password,
      },
    });
  } catch (error) {
    console.error("[liveClassController.createLiveClass] Error:", error.message);
    res.status(500).json({ error: "Failed to schedule live class" });
  }
};

// ─── GET LIVE CLASSES ──────────────────────────────────────────────────
export const getLiveClasses = async (req, res) => {
  const { courseId } = req.query;

  try {
    let query = supabase.from('live_classes').select('*');

    if (courseId) {
      query = query.eq("unit_id", courseId);
    }

    const { data, error } = await query.order('start_time', { ascending: true });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error("[liveClassController.getLiveClasses] Error:", error.message);
    res.status(500).json({ error: "Failed to fetch live classes" });
  }
};

// ─── GET ZOOM JOIN INFO ────────────────────────────────────────────────
export const getZoomJoinInfo = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    // Fetch user name
    const { data: userData } = await supabase
      .from('users')
      .select('name, email')
      .eq('id', userId)
      .single();

    const userName = userData?.name || userData?.email || 'User';

    // Get the live class
    const { data: liveClass, error: classError } = await supabase
      .from("live_classes")
      .select("id, teacher_id, title, start_time, end_time, status, zoom_meeting_id, zoom_join_url, zoom_start_url, token")
      .eq("id", id)
      .maybeSingle();

    if (classError) throw classError;
    if (!liveClass) return res.status(404).json({ error: "Class not found" });

    // Determine if user is the teacher
    const isTeacher = (liveClass.teacher_id === userId) ||
                      userRole === 'teacher' || userRole === 'lecturer';

    console.log(`[liveClassController.getZoomJoinInfo] User ${userId} (${isTeacher ? 'teacher' : 'student'}) requesting join info for class ${id}`);

    res.json({
      id: liveClass.id,
      title: liveClass.title,
      startTime: liveClass.start_time,
      endTime: liveClass.end_time,
      status: liveClass.status,
      role: isTeacher ? 'teacher' : 'student',
      userName,
      zoomMeetingId: liveClass.zoom_meeting_id,
      joinUrl: isTeacher ? liveClass.zoom_start_url : liveClass.zoom_join_url,
      password: liveClass.token,
    });
  } catch (error) {
    console.error("[liveClassController.getZoomJoinInfo] Error:", error.message);
    res.status(500).json({ error: "Failed to get join info" });
  }
};

// ─── UPDATE CLASS STATUS ───────────────────────────────────────────────
export const updateClassStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const userId = req.user.id;

  if (!['scheduled', 'live', 'ended'].includes(status)) {
    return res.status(400).json({ error: "Invalid status. Must be: scheduled, live, or ended" });
  }

  try {
    // Verify user is the teacher for this class
    const { data: liveClass, error: fetchError } = await supabase
      .from("live_classes")
      .select("teacher_id")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!liveClass) return res.status(404).json({ error: "Class not found" });
    if (liveClass.teacher_id !== userId) {
      return res.status(403).json({ error: "Only the class teacher can update status" });
    }

    const updateData = { status, updated_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from("live_classes")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    console.log(`[liveClassController.updateClassStatus] Class ${id} → ${status}`);
    res.json(data);
  } catch (error) {
    console.error("[liveClassController.updateClassStatus] Error:", error.message);
    res.status(500).json({ error: "Failed to update class status" });
  }
};

// ─── DELETE LIVE CLASS ─────────────────────────────────────────────────
export const deleteLiveClass = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { data: liveClass, error: fetchError } = await supabase
      .from("live_classes")
      .select("teacher_id, status, zoom_meeting_id")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!liveClass) return res.status(404).json({ error: "Class not found" });
    if (liveClass.teacher_id !== userId) {
      return res.status(403).json({ error: "Only the class teacher can delete this class" });
    }
    if (liveClass.status === 'live') {
      return res.status(400).json({ error: "Cannot delete a live class. End it first." });
    }

    // Delete the Zoom meeting if it exists
    if (liveClass.zoom_meeting_id) {
      try {
        await deleteZoomMeeting(liveClass.zoom_meeting_id);
        console.log(`[liveClassController.deleteLiveClass] Zoom meeting ${liveClass.zoom_meeting_id} deleted`);
      } catch (zoomErr) {
        console.warn("[liveClassController.deleteLiveClass] Failed to delete Zoom meeting:", zoomErr.message);
        // Continue with DB deletion even if Zoom delete fails
      }
    }

    const { error } = await supabase
      .from("live_classes")
      .delete()
      .eq("id", id);

    if (error) throw error;

    console.log(`[liveClassController.deleteLiveClass] Class ${id} deleted`);
    res.json({ message: "Class deleted successfully" });
  } catch (error) {
    console.error("[liveClassController.deleteLiveClass] Error:", error.message);
    res.status(500).json({ error: "Failed to delete class" });
  }
};

// ─── GET SESSION INFO ──────────────────────────────────────────────────
export const getSessionInfo = async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from("live_classes")
      .select("id, title, teacher_id, unit_id, status, start_time, end_time, recording_url, zoom_meeting_id, zoom_join_url, created_at")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Class not found" });

    res.json({
      id: data.id,
      title: data.title,
      teacherId: data.teacher_id,
      unitId: data.unit_id,
      status: data.status,
      startTime: data.start_time,
      endTime: data.end_time,
      hasRecording: !!data.recording_url,
      zoomMeetingId: data.zoom_meeting_id,
      zoomJoinUrl: data.zoom_join_url,
      createdAt: data.created_at,
    });
  } catch (error) {
    console.error("[liveClassController.getSessionInfo] Error:", error.message);
    res.status(500).json({ error: "Failed to get session info" });
  }
};

// ─── GET RECORDING INFO ────────────────────────────────────────────────
export const getRecordingInfo = async (req, res) => {
  const { classId } = req.params;

  try {
    const { data, error } = await supabase
      .from("live_classes")
      .select("id, recording_url")
      .eq("id", classId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Class not found" });

    // Parse recording metadata from recording_url
    let recordingMeta = null;
    if (data.recording_url) {
      try {
        recordingMeta = JSON.parse(data.recording_url);
      } catch {
        recordingMeta = { url: data.recording_url };
      }
    }

    res.json({
      id: data.id,
      recording: recordingMeta,
    });
  } catch (error) {
    console.error("[liveClassController.getRecordingInfo] Error:", error.message);
    res.status(500).json({ error: "Failed to get recording info" });
  }
};

// ─── GET RECORDING DOWNLOAD ───────────────────────────────────────────
export const getRecordingDownload = async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from("live_classes")
      .select("id, title, recording_url, teacher_id, start_time, end_time")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Class not found" });
    if (!data.recording_url) {
      return res.status(404).json({ error: "No recording available for this class" });
    }

    let fileList = [];
    try {
      const parsed = JSON.parse(data.recording_url);
      fileList = parsed.fileList || [parsed];
    } catch {
      fileList = [{ url: data.recording_url }];
    }

    res.json({
      classId: data.id,
      title: data.title,
      teacherId: data.teacher_id,
      startTime: data.start_time,
      endTime: data.end_time,
      files: fileList,
    });
  } catch (error) {
    console.error("[liveClassController.getRecordingDownload] Error:", error.message);
    res.status(500).json({ error: "Failed to get recording download" });
  }
};
