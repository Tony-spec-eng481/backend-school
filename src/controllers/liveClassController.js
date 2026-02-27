import supabase from '../config/supabase.js';
import { generateAgoraToken, generateRtmToken, generateScreenShareToken, APP_ID, SCREEN_SHARE_UID_OFFSET } from "../config/agoraConfig.js";
import axios from 'axios';

const getLecturerId = (req) => req.user.id;

// ─── Helper: Agora Cloud Recording credentials ────────────────────────
const AGORA_CUSTOMER_ID = process.env.AGORA_CUSTOMER_ID;
const AGORA_CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET;
const AGORA_APP_ID = APP_ID;

const getAgoraAuthHeader = () => {
  if (!AGORA_CUSTOMER_ID || !AGORA_CUSTOMER_SECRET) return null;
  const credentials = Buffer.from(`${AGORA_CUSTOMER_ID}:${AGORA_CUSTOMER_SECRET}`).toString('base64');
  return `Basic ${credentials}`;
};

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

    // Create Agora channel name
    const channelName = `class-${Math.random().toString(36).substring(2, 8)}`;

    // Generate temporary token for lecturer (publisher) — 2 hours
    const token = generateAgoraToken(channelName, 0, "publisher", 2 * 3600);

    // Save to database
    const { data, error } = await supabase
      .from("live_classes")
      .insert({
        teacher_id: lecturerId,
        unit_id,
        title,
        start_time,
        end_time,
        live_url: channelName,
        token,
        status: "scheduled",
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`[liveClassController.createLiveClass] Created class "${title}" on channel ${channelName}`);
    res.status(201).json({
      ...data,
      agora: {
        appId: AGORA_APP_ID,
        channel: channelName,
        token,
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

// ─── GET AGORA TOKEN ───────────────────────────────────────────────────
export const getAgoraToken = async (req, res) => {
  const { channel } = req.query;
  const userId = req.user.id;
  const userRole = req.user.role;

  if (!channel) {
    return res.status(400).json({ error: "Channel name is required" });
  }

  try {
    // Fetch user name
    const { data: userData } = await supabase
      .from('users')
      .select('name, email')
      .eq('id', userId)
      .single();
    
    const userName = userData?.name || userData?.email || 'User';

    // Verify the class exists in the database
    const { data: liveClass, error: classError } = await supabase
      .from("live_classes")
      .select("id, teacher_id")
      .eq("live_url", channel)
      .maybeSingle();

    if (classError) throw classError;

    // Determine the user's classroom role
    const isTeacher = (liveClass && liveClass.teacher_id === userId) ||
                      userRole === 'teacher' || userRole === 'lecturer';

    // Generate a numeric UID from the user ID (Agora requires numeric UIDs)
    const numericUid = Math.abs(userId.split('').reduce((acc, char) => {
      return ((acc << 5) - acc) + char.charCodeAt(0);
    }, 0)) % 1000000;

    // Both roles get publisher token (both can stream audio/video)
    const token = generateAgoraToken(channel, numericUid, "publisher", 2 * 3600);

    // Generate RTM token for chat
    const rtmUserId = userId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 64);
    const rtmToken = generateRtmToken(rtmUserId, 2 * 3600);

    // Generate a dedicated screen share token with offset UID
    const { token: screenShareToken, screenShareUid } = generateScreenShareToken(
      channel,
      numericUid,
      2 * 3600
    );

    console.log(`[liveClassController.getAgoraToken] Token generated for user ${userId} on channel ${channel}`);
    res.json({
      appId: AGORA_APP_ID,
      token,
      rtmToken,
      screenShareToken,
      screenShareUid,
      role: isTeacher ? 'teacher' : 'student',
      uid: numericUid,
      userName,
      rtmUserId,
      classId: liveClass?.id || null,
    });
  } catch (error) {
    console.error("[liveClassController.getAgoraToken] Error:", error.message);
    res.status(500).json({ error: "Failed to generate token" });
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
      .select("teacher_id, status")
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
    // Only select columns that exist in the schema
    const { data, error } = await supabase
      .from("live_classes")
      .select("id, title, teacher_id, unit_id, status, start_time, end_time, recording_url, created_at")
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
      createdAt: data.created_at,
    });
  } catch (error) {
    console.error("[liveClassController.getSessionInfo] Error:", error.message);
    res.status(500).json({ error: "Failed to get session info" });
  }
};

// ─── START CLOUD RECORDING ─────────────────────────────────────────────
export const startRecording = async (req, res) => {
  const { channel, classId } = req.body;
  const authHeader = getAgoraAuthHeader();

  if (!authHeader) {
    return res.status(503).json({
      error: "Cloud Recording not configured. Set AGORA_CUSTOMER_ID and AGORA_CUSTOMER_SECRET."
    });
  }

  if (!channel || !classId) {
    return res.status(400).json({ error: "channel and classId are required" });
  }

  try {
    // Step 1: Acquire recording resource
    const acquireRes = await axios.post(
      `https://api.agora.io/v1/apps/${AGORA_APP_ID}/cloud_recording/acquire`,
      {
        cname: channel,
        uid: "1",
        clientRequest: {
          resourceExpiredHour: 24,
        },
      },
      { headers: { Authorization: authHeader, 'Content-Type': 'application/json' } }
    );

    const resourceId = acquireRes.data.resourceId;

    // Step 2: Generate a token for the recording bot
    const recordingToken = generateAgoraToken(channel, 1, "subscriber", 2 * 3600);

    // Step 3: Start recording
    const startRes = await axios.post(
      `https://api.agora.io/v1/apps/${AGORA_APP_ID}/cloud_recording/resourceid/${resourceId}/mode/mix/start`,
      {
        cname: channel,
        uid: "1",
        clientRequest: {
          token: recordingToken,
          recordingConfig: {
            maxIdleTime: 300,
            streamTypes: 2,
            channelType: 1,
            videoStreamType: 0,
            transcodingConfig: {
              height: 720,
              width: 1280,
              bitrate: 2260,
              fps: 30,
              mixedVideoLayout: 1,
            },
          },
          storageConfig: {
            vendor: 0,
            region: 0,
            bucket: process.env.AGORA_STORAGE_BUCKET || "",
            accessKey: process.env.AGORA_STORAGE_ACCESS_KEY || "",
            secretKey: process.env.AGORA_STORAGE_SECRET_KEY || "",
          },
        },
      },
      { headers: { Authorization: authHeader, 'Content-Type': 'application/json' } }
    );

    const sid = startRes.data.sid;

    // Step 4: Store recording info in recording_url as JSON metadata
    const recordingMeta = JSON.stringify({ resourceId, sid, status: 'recording', startedAt: new Date().toISOString() });
    await supabase
      .from("live_classes")
      .update({ recording_url: recordingMeta })
      .eq("id", classId);

    console.log(`[liveClassController.startRecording] Recording started for class ${classId}`);
    res.json({
      message: "Recording started",
      resourceId,
      sid,
    });
  } catch (error) {
    console.error("[liveClassController.startRecording] Error:", error?.response?.data || error.message);
    res.status(500).json({ error: "Failed to start recording" });
  }
};

// ─── STOP CLOUD RECORDING ──────────────────────────────────────────────
export const stopRecording = async (req, res) => {
  const { channel, classId, resourceId, sid } = req.body;
  const authHeader = getAgoraAuthHeader();

  if (!authHeader) {
    return res.status(503).json({
      error: "Cloud Recording not configured."
    });
  }

  if (!channel || !resourceId || !sid) {
    return res.status(400).json({ error: "channel, resourceId, and sid are required" });
  }

  try {
    const stopRes = await axios.post(
      `https://api.agora.io/v1/apps/${AGORA_APP_ID}/cloud_recording/resourceid/${resourceId}/sid/${sid}/mode/mix/stop`,
      {
        cname: channel,
        uid: "1",
        clientRequest: {},
      },
      { headers: { Authorization: authHeader, 'Content-Type': 'application/json' } }
    );

    // Update database with file list
    if (classId) {
      const fileList = stopRes.data?.serverResponse?.fileList;
      const recordingData = JSON.stringify({
        resourceId,
        sid,
        status: 'stopped',
        stoppedAt: new Date().toISOString(),
        fileList: fileList || []
      });
      
      await supabase
        .from("live_classes")
        .update({ recording_url: recordingData })
        .eq("id", classId);
    }

    console.log(`[liveClassController.stopRecording] Recording stopped for class ${classId}`);
    res.json({
      message: "Recording stopped",
      serverResponse: stopRes.data.serverResponse,
    });
  } catch (error) {
    console.error("[liveClassController.stopRecording] Error:", error?.response?.data || error.message);
    res.status(500).json({ error: "Failed to stop recording" });
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
