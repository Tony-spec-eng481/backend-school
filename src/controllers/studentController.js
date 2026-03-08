import supabase from '../config/supabase.js';
import { uploadToGCS } from '../utils/gcsUtils.js';

/* ================================================================
   HELPER
 ================================================================ */
const studentId = (req) => req.user.id;

/* ================================================================
   HELPER  —  get all enrolled program IDs for a student
 ================================================================ */
const getEnrolledProgramIds = async (sid) => {
  const { data, error } = await supabase
    .from("enrollments")
    .select("program_id")
    .eq("student_id", sid);
  if (error) throw error;
  return (data || []).map((e) => e.program_id).filter(Boolean);
};

const getUnitIdsForPrograms = async (programIds) => {
  if (programIds.length === 0) return [];
  const { data, error } = await supabase
    .from("program_units")
    .select("unit_id")
    .in("program_id", programIds);
  if (error) throw error;
  return (data || []).map((pu) => pu.unit_id);
};

/* ================================================================
   DASHBOARD OVERVIEW  —  GET /api/student/stats
 ================================================================ */
export const getStats = async (req, res) => {
  const sid = studentId(req);

  try {
    /* 0. Get all enrolled program IDs */
    const programIds = await getEnrolledProgramIds(sid);

    if (programIds.length === 0) {
      return res.json({
        enrolledUnits: 0,
        completedLessons: 0,
        avgProgress: 0,
        liveClassesToday: 0,
        certificates: 0,
        pendingAssignments: 0,
        streak: 0,
      });
    }

    /* 1. Total Units across all enrolled programs */
    const { count: enrolledUnits } = await supabase
      .from("program_units")
      .select("*", { count: "exact", head: true })
      .in("program_id", programIds);

    /* 2. Completed Topics */
    const { count: completedTopics } = await supabase
      .from("progress")
      .select("*", { count: "exact", head: true })
      .eq("student_id", sid)
      .eq("is_completed", true);

    /* 3. Average Progress */
    const { data: enrollments } = await supabase
      .from("enrollments")
      .select("progress")
      .eq("student_id", sid);

    const avgProgress =
      enrollments && enrollments.length > 0
        ? Math.round(
            enrollments.reduce((sum, e) => sum + (e.progress || 0), 0) /
              enrollments.length,
          )
        : 0;

    /* 4. Today's Live Classes */
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    const unitIds = await getUnitIdsForPrograms(programIds);
    let liveClassesToday = 0;

    if (unitIds.length > 0) {
      const { count } = await supabase
        .from("live_classes")
        .select("*", { count: "exact", head: true })
        .in("unit_id", unitIds)
        .gte("start_time", todayStart.toISOString())
        .lte("start_time", todayEnd.toISOString());

      liveClassesToday = count ?? 0;
    }

    /* 5. Certificates */
    const { count: certificates } = await supabase
      .from("enrollments")
      .select("*", { count: "exact", head: true })
      .eq("student_id", sid)
      .eq("completed", true);

    /* 6. Pending Assignments */
    let pendingAssignments = 0;
    if (unitIds.length > 0) {
      // Get all assignments for these units
      const { data: assignments } = await supabase
        .from("assignments")
        .select("id")
        .in("unit_id", unitIds);

      if (assignments && assignments.length > 0) {
        const assignmentIds = assignments.map(a => a.id);
        
        // Get count of submitted assignments
        const { count: submittedCount } = await supabase
          .from("assignment_submissions")
          .select("*", { count: "exact", head: true })
          .eq("student_id", sid)
          .in("assignment_id", assignmentIds);

        pendingAssignments = assignments.length - (submittedCount || 0);
      }
    }

    res.json({
      enrolledUnits: enrolledUnits ?? 0,
      completedLessons: completedTopics ?? 0,
      avgProgress,
      liveClassesToday,
      certificates: certificates ?? 0,
      pendingAssignments,
      streak: 0,
    });
  } catch (err) {
    console.error("[studentController.getStats] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch student stats" });
  }
};

/* ================================================================
   ENROLLED COURSES  —  GET /api/student/courses
 ================================================================ */
export const getEnrolledCourses = async (req, res) => {
  const sid = studentId(req);

  try {
    const { data, error } = await supabase
      .from("enrollments")
      .select(`
        id,
        enrolled_at,
        progress,
        completed,
        last_accessed,
        course:program_id (
          id,    
          title,
          description,
          thumbnail_url,
          difficulty
        )
      `)
      .eq("student_id", sid)
      .order("last_accessed", { ascending: false });

    if (error) throw error;

    const shaped = (data || []).map((e) => ({
      id: e.course?.id,
      title: e.course?.title,
      thumbnail: e.course?.thumbnail_url,
      progress: e.progress ?? 0,
      completed: e.completed,
      lastAccessed: e.last_accessed,
      difficulty: e.course?.difficulty,
    }));

    res.json(shaped);
  } catch (err) {
    console.error("[studentController.getEnrolledCourses] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch enrolled courses" });
  }
};

/* ================================================================
   STUDENT UNITS (grouped by enrolled course)  —  GET /api/student/units
 ================================================================ */
export const getStudentUnits = async (req, res) => {
  const sid = req.user.id;

  try {
    // 1. Get enrolled courses
    const { data: enrollments, error: enrError } = await supabase
      .from("enrollments")
      .select(`
        id,
        progress,
        completed,
        course:program_id (
          id, title, description, thumbnail_url, difficulty, short_code
        )
      `)
      .eq("student_id", sid)
      .order("enrolled_at", { ascending: false });

    if (enrError) throw enrError;

    if (!enrollments || enrollments.length === 0) {
      return res.json([]);
    }

    // 2. For each enrolled course, get units
    const result = await Promise.all(
      enrollments.map(async (enr) => {
        if (!enr.course) return null;
        const courseId = enr.course.id;

        const { data: programUnits, error: puError } = await supabase
          .from("program_units")
          .select(`
            unit:unit_id (id, title, description),
            semester,
            year
          `)
          .eq("program_id", courseId)
          .order("semester", { ascending: true })
          .order("year", { ascending: true });

        if (puError) throw puError;

        const units = await Promise.all(
          (programUnits || []).map(async (pu) => {
            if (!pu.unit) return null;
            const unitId = pu.unit.id;

            const { count: topicCount } = await supabase
              .from("topics")
              .select("*", { count: "exact", head: true })
              .eq("unit_id", unitId);

            const { count: liveClassCount } = await supabase
              .from("live_classes")
              .select("*", { count: "exact", head: true })
              .eq("unit_id", unitId);

            return {
              id: pu.unit.id,
              title: pu.unit.title,
              description: pu.unit.description,
              semester: pu.semester,
              year: pu.year,
              topicCount: topicCount ?? 0,
              liveClassCount: liveClassCount ?? 0,
            };
          }),
        );

        return {
          courseId: enr.course.id,
          courseTitle: enr.course.title,
          courseDescription: enr.course.description,
          courseThumbnail: enr.course.thumbnail_url,
          courseDifficulty: enr.course.difficulty,
          courseShortCode: enr.course.short_code,
          progress: enr.progress ?? 0,
          completed: enr.completed,
          units: units.filter(Boolean),
        };
      }),
    );

    res.json(result.filter(Boolean));
  } catch (err) {
    console.error("[studentController.getStudentUnits] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch student units" });
  }
};

/* ================================================================
   UNIT DETAILS  —  GET /api/student/units/:id
 ================================================================ */
export const getUnitDetails = async (req, res) => {
  const sid = studentId(req);
  const { id } = req.params; // unit id

  try {
    const { data: unit, error } = await supabase
      .from('units')
      .select(`
        id, title, description,
        topics (
          id, title, video_url, audio_intro_url, notes, notes_url, sequence_number, content_type
        ),
        assignments (
          id, title, description, due_date, file_url
        )
      `)
      .eq('id', id)
      .single();

    if (error) throw error;

    if (!unit) {
      return res.status(404).json({ error: "Unit not found" });
    }

    // Fetch progress for these topics   
    const { data: progressRows } = await supabase
      .from('progress')
      .select('topic_id, is_completed')
      .eq('student_id', sid);

    const completedTopicIds = new Set((progressRows || [])
      .filter(p => p.is_completed)
      .map(p => p.topic_id));

    const shaped = {
      ...unit,
      topics: (unit.topics || [])
        .sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0))
        .map(t => ({
          ...t,
          isCompleted: completedTopicIds.has(t.id)
        }))
    };

    res.json(shaped);
  } catch (err) {
    console.error('[studentController.getUnitDetails] Error:', err.message);
    res.status(500).json({ error: "Failed to fetch unit details" });
  }
};

/* ================================================================
   COURSE PLAYER / DETAILS  —  GET /api/student/courses/:id
   Returns course with its units and topics for the player view
 ================================================================ */
export const getCoursePlayerDetails = async (req, res) => {
  const sid = studentId(req);
  const { id } = req.params; // courseId (program_id)

  try {
    // 1. Get course details
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('id, title, description, thumbnail_url, difficulty')
      .eq('id', id)
      .single();

    if (courseError) throw courseError;
    if (!course) return res.status(404).json({ error: "Course not found" });

    // 2. Get units for this course via program_units
    const { data: programUnits, error: puError } = await supabase
      .from('program_units')
      .select(`
        semester,
        year,
        unit:unit_id (
          id, title, description,
          topics (
            id, title, video_url, audio_intro_url, notes, notes_url, sequence_number, content_type
          )
        )
      `)
      .eq('program_id', id)
      .order('semester', { ascending: true });

    if (puError) throw puError;

    // 3. Get student's completion progress
    const { data: progressRows } = await supabase
      .from('progress')
      .select('topic_id, is_completed')
      .eq('student_id', sid);

    const completedTopicIds = new Set((progressRows || [])
      .filter(p => p.is_completed)
      .map(p => p.topic_id));

    // 4. Shape response
    const units = (programUnits || [])
      .filter(pu => pu.unit)
      .map(pu => ({
        id: pu.unit.id,
        title: pu.unit.title,
        description: pu.unit.description,
        semester: pu.semester,
        year: pu.year,
        topics: (pu.unit.topics || [])
          .sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0))
          .map(t => ({
            ...t,
            isCompleted: completedTopicIds.has(t.id)
          }))
      }));

    res.json({
      id: course.id,
      title: course.title,
      description: course.description,
      thumbnail: course.thumbnail_url,
      difficulty: course.difficulty,
      units,
    });
  } catch (err) {
    console.error('[studentController.getCoursePlayerDetails] Error:', err.message);
    res.status(500).json({ error: "Failed to fetch course details" });
  }
};

/* ================================================================
   MARK TOPIC COMPLETE  —  POST /api/student/progress/mark-complete
 ================================================================ */
export const markTopicComplete = async (req, res) => {
  const sid = studentId(req);
  const { topicId, courseId } = req.body;

  if (!topicId || !courseId) {
    return res.status(400).json({ error: 'Topic ID and Course ID are required' });
  }

  try {
    // 1. Upsert progress for the topic
    const { error: upsertErr } = await supabase
      .from('progress')
      .upsert({
        student_id: sid,
        topic_id: topicId,
        is_completed: true,
        completed_at: new Date().toISOString()
      }, { onConflict: 'student_id, topic_id' });

    if (upsertErr) throw upsertErr;

    // 2. Recalculate course progress
    // Get all units for this course
    const { data: programUnits } = await supabase
      .from('program_units')
      .select('unit_id')
      .eq('program_id', courseId);

    const unitIds = (programUnits || []).map(pu => pu.unit_id);

    if (unitIds.length > 0) {
      // Get all topics for these units
      const { data: allTopics } = await supabase
        .from('topics')
        .select('id')
        .in('unit_id', unitIds);

      const allTopicIds = (allTopics || []).map(t => t.id);
      const totalTopics = allTopicIds.length;

      if (totalTopics > 0) {
        // Get completed topics for this course
        const { count: completedCount } = await supabase
          .from('progress')
          .select('*', { count: 'exact', head: true })
          .eq('student_id', sid)
          .eq('is_completed', true)
          .in('topic_id', allTopicIds);

        const newProgress = Math.round(((completedCount || 0) / totalTopics) * 100);
        const isCompleted = newProgress === 100;

        // Update enrollment
        const { error: enrollError } = await supabase
          .from('enrollments')
          .update({ 
            progress: newProgress, 
            completed: isCompleted,
            last_accessed: new Date().toISOString() 
          })
          .eq('student_id', sid)
          .eq('program_id', courseId);

        if (enrollError) {
          console.error('[studentController.markTopicComplete] Enrollment update error:', enrollError.message);
        }
      }
    }

    // 3. Notify teachers assigned to this unit
    try {
      // Find teachers for this unit
      const { data: lecturerUnits } = await supabase
        .from('lecturer_units')
        .select('lecturer_id')
        .eq('unit_id', (
          await supabase.from('topics').select('unit_id').eq('id', topicId).single()
        ).data?.unit_id);

      if (lecturerUnits && lecturerUnits.length > 0) {
        // Get student name
        const { data: student } = await supabase
          .from('users')
          .select('name')
          .eq('id', sid)
          .single();

        // Get topic title
        const { data: topic } = await supabase
          .from('topics')
          .select('title')
          .eq('id', topicId)
          .single();

        const notifications = lecturerUnits.map(lu => ({
          user_id: lu.lecturer_id,
          student_id: sid,
          type: 'topic_completion',
          message: `${student?.name || 'A student'} has completed the topic: "${topic?.title || 'Unknown Topic'}"`,
          created_at: new Date().toISOString()
        }));

        await supabase.from('notifications').insert(notifications);
      }
    } catch (notifyErr) {
      console.error('[studentController.markTopicComplete] Notification error:', notifyErr.message);
      // Don't fail the whole request if notifications fail
    }

    console.log(`[studentController.markTopicComplete] Student ${sid} completed topic ${topicId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[studentController.markTopicComplete] Error:', err.message);
    res.status(500).json({ error: "Failed to mark topic as complete" });
  }
};

/* ================================================================
   LIVE CLASS ATTENDANCE
  ================================================================ */
export const recordLiveClassJoin = async (req, res) => {
  const sid = studentId(req);
  const { liveClassId } = req.body;

  if (!liveClassId) {
    return res.status(400).json({ error: "Live Class ID is required" });
  }

  try {
    const { data, error } = await supabase
      .from('live_class_attendance')
      .upsert({
        live_class_id: liveClassId,
        student_id: sid,
        joined_at: new Date().toISOString()
      }, { onConflict: 'live_class_id, student_id' })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[studentController.recordLiveClassJoin] Error:', err.message);
    res.status(500).json({ error: "Failed to record join" });
  }
};

export const recordLiveClassLeave = async (req, res) => {
  const sid = studentId(req);
  const { liveClassId } = req.body;

  if (!liveClassId) {
    return res.status(400).json({ error: "Live Class ID is required" });
  }

  try {
    const { error } = await supabase
      .from('live_class_attendance')
      .update({ left_at: new Date().toISOString() })
      .eq('live_class_id', liveClassId)
      .eq('student_id', sid);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[studentController.recordLiveClassLeave] Error:', err.message);
    res.status(500).json({ error: "Failed to record leave" });
  }
};

/* ================================================================
   NOTIFICATIONS
  ================================================================ */
export const getNotifications = async (req, res) => {
  const uid = req.user.id;
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[studentController.getNotifications] Error:', err.message);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
};

export const markNotificationRead = async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[studentController.markNotificationRead] Error:', err.message);
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
};

/* ================================================================
   LIVE CLASSES  —  GET /api/student/live-classes
 ================================================================ */
export const getLiveClasses = async (req, res) => {
  const sid = studentId(req);

  try {
    const programIds = await getEnrolledProgramIds(sid);
    if (programIds.length === 0) return res.json([]);

    const unitIds = await getUnitIdsForPrograms(programIds);
    if (unitIds.length === 0) return res.json([]);

    const { data, error } = await supabase
      .from("live_classes")
      .select("*, unit:unit_id(title)")
      .in("unit_id", unitIds)
      .order("start_time", { ascending: true });

    if (error) throw error;

    const shaped = (data || []).map(lc => ({
      ...lc,
      startTime: lc.start_time,
      endTime: lc.end_time,
      course: lc.unit?.title,
      recordingUrl: lc.recording_url,
    }));

    res.json(shaped);
  } catch (err) {
    console.error('[studentController.getLiveClasses] Error:', err.message);
    res.status(500).json({ error: "Failed to fetch live classes" });
  }
};

/* ================================================================
   ASSIGNMENTS  —  GET /api/student/assignments
 ================================================================ */
export const getAssignments = async (req, res) => {
  const sid = studentId(req);

  try {
    const programIds = await getEnrolledProgramIds(sid);
    if (programIds.length === 0) return res.json([]);

    const unitIds = await getUnitIdsForPrograms(programIds);
    if (unitIds.length === 0) return res.json([]);

    const { data: assignments, error: assignError } = await supabase
      .from("assignments")
      .select("*, unit:unit_id(title, short_code)")
      .in("unit_id", unitIds)
      .order("created_at", { ascending: false });

    if (assignError) throw assignError;

    if (!assignments || assignments.length === 0) return res.json([]);

    // Get submissions for these assignments for THIS student
    const assignmentIds = assignments.map(a => a.id);
    const { data: submissions, error: subError } = await supabase
      .from("assignment_submissions")
      .select("*")
      .eq("student_id", sid)
      .in("assignment_id", assignmentIds);

    if (subError) throw subError;

    const submissionMap = new Map();
    (submissions || []).forEach(s => submissionMap.set(s.assignment_id, s));

    const formattedData = assignments.map(a => ({
      ...a,
      submission: submissionMap.get(a.id) || null
    }));

    res.json(formattedData);
  } catch (err) {
    console.error('[studentController.getAssignments] Error:', err.message);
    res.status(500).json({ error: "Failed to fetch assignments" });
  }
};

export const submitAssignment = async (req, res) => {
  const sid = studentId(req);
  const { id } = req.params; // assignment_id
  const { answer_text } = req.body;

  try {
    let file_url = req.body.file_url || null;
    if (req.file) {
      file_url = await uploadToGCS(req.file);
    }

    if (!file_url && !answer_text) {
      return res.status(400).json({ error: "A file upload or answer text is required" });
    }
    const { data, error } = await supabase
      .from('assignment_submissions')
      .insert({
        assignment_id: id,
        student_id: sid,
        file_url,
        answer_text,
        status: 'pending',
        submitted_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`[studentController.submitAssignment] Student ${sid} submitted assignment ${id}`);
    res.status(201).json(data);
  } catch (err) {
    console.error('[studentController.submitAssignment] Error:', err.message);
    res.status(500).json({ error: "Failed to submit assignment" });
  }
};

/* ================================================================
   ANNOUNCEMENTS  —  GET /api/student/announcements
 ================================================================ */
export const getAnnouncements = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .or('target_role.eq.student,target_role.eq.all,target_role.is.null')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[studentController.getAnnouncements] Error:', err.message);
    res.status(500).json({ error: "Failed to fetch announcements" });
  }
};

/* ================================================================
   SUPPORT TICKETS  —  GET /api/student/tickets
 ================================================================ */
export const getTickets = async (req, res) => {
  const sid = studentId(req);
  try {
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('user_id', sid)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[studentController.getTickets] Error:', err.message);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
};

export const createTicket = async (req, res) => {
  const sid = studentId(req);
  const { subject, message, priority } = req.body;

  if (!subject || !message) {
    return res.status(400).json({ error: "Subject and message are required" });
  }

  try {
    const { data, error } = await supabase
      .from('support_tickets')
      .insert({
        user_id: sid,
        subject,
        message,
        priority: priority || 'medium',
        status: 'open'
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`[studentController.createTicket] Student ${sid} created ticket: ${subject}`);
    res.status(201).json(data);
  } catch (err) {
    console.error('[studentController.createTicket] Error:', err.message);
    res.status(500).json({ error: "Failed to create ticket" });
  }
};

/* ================================================================
   AVAILABLE COURSES  —  GET /api/student/available-courses
 ================================================================ */
export const getAvailableCourses = async (req, res) => {
  const sid = studentId(req);

  try {
    // 1. Get all active courses
    const { data: courses, error: cError } = await supabase
      .from("courses")
      .select(`
        id, title, description, short_code, thumbnail_url,
        difficulty, duration_weeks, department_id,
        department:department_id (name)
      `)
      .eq("status", "active")
      .order("title", { ascending: true });

    if (cError) throw cError;

    // 2. Get student's current enrollments
    const { data: enrollments, error: eError } = await supabase
      .from("enrollments")
      .select("program_id, completed")
      .eq("student_id", sid);

    if (eError) throw eError;

    const enrolledMap = new Map();
    (enrollments || []).forEach((e) => {
      enrolledMap.set(e.program_id, e.completed);
    });

    const activeEnrollments = (enrollments || []).filter((e) => !e.completed).length;

    // 3. Shape response
    const shaped = (courses || []).map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      shortCode: c.short_code,
      thumbnail: c.thumbnail_url,
      difficulty: c.difficulty,
      durationWeeks: c.duration_weeks,
      department: c.department?.name || "N/A",
      isEnrolled: enrolledMap.has(c.id),
      isCompleted: enrolledMap.get(c.id) === true,
      canEnroll: !enrolledMap.has(c.id) && activeEnrollments < 2,
    }));

    res.json(shaped);
  } catch (err) {
    console.error("[studentController.getAvailableCourses] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch available courses" });
  }
};

/* ================================================================
   ENROLL IN COURSE  —  POST /api/student/enroll
 ================================================================ */
export const enrollInCourse = async (req, res) => {
  const sid = studentId(req);
  const { courseId } = req.body;

  if (!courseId) {
    return res.status(400).json({ error: "Course ID is required" });
  }

  try {
    // 1. Check if already enrolled
    const { data: existing } = await supabase
      .from("enrollments")
      .select("id")
      .eq("student_id", sid)
      .eq("program_id", courseId)
      .single();

    if (existing) {
      return res.status(400).json({ error: "Already enrolled in this course" });
    }

    // 2. Count active (non-completed) enrollments
    const { data: active, error: countErr } = await supabase
      .from("enrollments")
      .select("id")
      .eq("student_id", sid)
      .eq("completed", false);

    if (countErr) throw countErr;

    if ((active || []).length >= 2) {
      return res.status(400).json({
        error: "Maximum 2 active courses allowed. Complete a course to enroll in a new one.",
      });
    }

    // 3. Verify course exists and is active
    const { data: course, error: courseErr } = await supabase
      .from("courses")
      .select("id, title")
      .eq("id", courseId)
      .eq("status", "active")
      .single();

    if (courseErr || !course) {
      return res.status(404).json({ error: "Course not found or not active" });
    }

    // 4. Create enrollment
    const { data: enrollment, error: enrollErr } = await supabase
      .from("enrollments")
      .insert({
        student_id: sid,
        program_id: courseId,
        enrolled_at: new Date().toISOString(),
        progress: 0,
        completed: false,
      })
      .select()
      .single();

    if (enrollErr) throw enrollErr;

    console.log(`[studentController.enrollInCourse] Student ${sid} enrolled in course ${course.title}`);
    res.status(201).json({
      message: `Successfully enrolled in ${course.title}`,
      enrollment,
    });
  } catch (err) {
    console.error("[studentController.enrollInCourse] Error:", err.message);
    res.status(500).json({ error: "Failed to enroll in course" });
  }
};
