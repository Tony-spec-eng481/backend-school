import supabase from '../config/supabase.js';

/* ================================================================
   HELPER
 ================================================================ */
const studentId = (req) => req.user.id;

/* ================================================================
   DASHBOARD OVERVIEW  —  GET /api/student/stats
 ================================================================ */
export const getStats = async (req, res) => {
  const sid = studentId(req);

  try {
    /* ===============================
       0. Get student's program
    =============================== */
    const { data: studentDetails, error: sdError } = await supabase
      .from("student_details")
      .select("program_id")
      .eq("user_id", sid)
      .single();

    if (sdError || !studentDetails) {
      console.error("[studentController.getStats] Student details not found:", sdError?.message);
      return res.status(404).json({ error: "Student details not found" });
    }

    const programId = studentDetails.program_id;

    if (!programId) {
      console.warn("[studentController.getStats] Student has no program assigned");
      return res.json({
        enrolledUnits: 0,
        completedLessons: 0,
        avgProgress: 0,
        liveClassesToday: 0,
        certificates: 0,
        streak: 0,
      });
    }

    /* ===============================
       1. Total Units in program
    =============================== */
    const { count: enrolledUnits } = await supabase
      .from("program_units")
      .select("*", { count: "exact", head: true })
      .eq("program_id", programId);

    /* ===============================
       2. Completed Topics
    =============================== */
    const { count: completedTopics } = await supabase
      .from("progress")
      .select("*", { count: "exact", head: true })
      .eq("student_id", sid)
      .eq("is_completed", true);
    
    /* ===============================
       3. Average Progress
    =============================== */
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

    /* ===============================
       4. Today's Live Classes
    =============================== */
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    const { data: programUnits } = await supabase
      .from("program_units")
      .select("unit_id")
      .eq("program_id", programId);

    const unitIds = (programUnits || []).map((u) => u.unit_id);

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

    /* ===============================
       5. Certificates
    =============================== */
    const { count: certificates } = await supabase
      .from("enrollments")
      .select("*", { count: "exact", head: true })
      .eq("student_id", sid)
      .eq("completed", true);

    res.json({
      enrolledUnits: enrolledUnits ?? 0,
      completedLessons: completedTopics ?? 0,
      avgProgress,
      liveClassesToday,
      certificates: certificates ?? 0,
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
   STUDENT UNITS  —  GET /api/student/units
 ================================================================ */
export const getStudentUnits = async (req, res) => {
  const sid = req.user.id;

  try {
    // 1. Get the student's course/program
    const { data: studentDetails, error: sdError } = await supabase
      .from("student_details")
      .select("program_id")
      .eq("user_id", sid)
      .single();

    if (sdError || !studentDetails) {
      console.error("[studentController.getStudentUnits] Student not found:", sdError?.message);
      return res.status(404).json({ error: "Student not found" });
    }

    const programId = studentDetails.program_id;

    if (!programId) {
      return res.json([]);
    }

    // 2. Get all units for this program from program_units
    const { data: programUnits, error: puError } = await supabase
      .from("program_units")
      .select(`
        unit:unit_id (id, title, description),
        semester,
        year
      `)
      .eq("program_id", programId)
      .order("semester", { ascending: true })
      .order("year", { ascending: true });

    if (puError) throw puError;

    // 3. For each unit, fetch counts separately
    const shaped = await Promise.all(
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

    res.json(shaped.filter(Boolean));
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

    console.log(`[studentController.markTopicComplete] Student ${sid} completed topic ${topicId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[studentController.markTopicComplete] Error:', err.message);
    res.status(500).json({ error: "Failed to mark topic as complete" });
  }
};

/* ================================================================
   LIVE CLASSES  —  GET /api/student/live-classes
 ================================================================ */
export const getLiveClasses = async (req, res) => {
  const sid = studentId(req);

  try {
    const { data: sd, error: sdError } = await supabase
      .from("student_details")
      .select("program_id")
      .eq("user_id", sid)
      .single();

    if (sdError || !sd) {
      console.error("[studentController.getLiveClasses] Student details not found:", sdError?.message);
      return res.status(404).json({ error: "Student details not found" });
    }

    if (!sd.program_id) {
      return res.json([]);
    }

    const { data: units, error: unitsError } = await supabase
      .from("program_units")
      .select("unit_id")
      .eq("program_id", sd.program_id);

    if (unitsError) throw unitsError;

    const unitIds = (units || []).map((u) => u.unit_id);

    if (unitIds.length === 0) {
      return res.json([]);
    }

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
      course: lc.unit?.title
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
    const { data: sd, error: sdError } = await supabase
      .from("student_details")
      .select("program_id")
      .eq("user_id", sid)
      .single();

    if (sdError || !sd) {
      console.error("[studentController.getAssignments] Student details not found:", sdError?.message);
      return res.status(404).json({ error: "Student details not found" });
    }

    if (!sd.program_id) {
      return res.json([]);
    }

    const { data: units, error: unitsError } = await supabase
      .from("program_units")
      .select("unit_id")
      .eq("program_id", sd.program_id);

    if (unitsError) throw unitsError;

    const unitIds = (units || []).map((u) => u.unit_id);

    if (unitIds.length === 0) {
      return res.json([]);
    }

    const { data, error } = await supabase
      .from("assignments")
      .select("*, unit:unit_id(title)")
      .in("unit_id", unitIds)
      .order("due_date", { ascending: true });

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error('[studentController.getAssignments] Error:', err.message);
    res.status(500).json({ error: "Failed to fetch assignments" });
  }
};

export const submitAssignment = async (req, res) => {
  const sid = studentId(req);
  const { id } = req.params; // assignment_id
  const { file_url, answer_text } = req.body;

  if (!file_url && !answer_text) {
    return res.status(400).json({ error: "File URL or answer text is required" });
  }

  try {
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
