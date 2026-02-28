import supabase from '../config/supabase.js';
import { uploadToGCS } from '../utils/gcsUtils.js';

const getLecturerId = (req) => req.user.id;
   
/**
 * GET /api/lecturer/overview
 */
export const getOverview = async (req, res) => {
  const tid = getLecturerId(req);
  try {
    // Total units taught
    const { count: unitCount } = await supabase
      .from('lecturer_units')
      .select('unit_id', { count: 'exact', head: true })
      .eq('lecturer_id', tid);

    // Total programs taught
    const { data: programs } = await supabase
      .from('lecturer_units')
      .select('program_id')
      .eq('lecturer_id', tid);
    
    const uniquePrograms = new Set((programs || []).map(p => p.program_id));

    // Upcoming live classes
    const { data: liveClasses } = await supabase
      .from('live_classes')
      .select('*')
      .eq('teacher_id', tid)
      .gte('start_time', new Date().toISOString())
      .order('start_time', { ascending: true })
      .limit(5);

    // Recent submissions for units this lecturer teaches
    const { data: lecturerUnits } = await supabase
      .from('lecturer_units')
      .select('unit_id')
      .eq('lecturer_id', tid);
    
    const unitIds = (lecturerUnits || []).map(lu => lu.unit_id);

    let recentSubmissions = [];
    if (unitIds.length > 0) {
      // Get assignments for lecturer's units
      const { data: assignments } = await supabase
        .from('assignments')
        .select('id')
        .in('unit_id', unitIds);

      const assignmentIds = (assignments || []).map(a => a.id);

      if (assignmentIds.length > 0) {
        const { data: submissions } = await supabase
          .from('assignment_submissions')
          .select('*')
          .in('assignment_id', assignmentIds)
          .order('submitted_at', { ascending: false })
          .limit(5);
        recentSubmissions = submissions || [];
      }
    }

    res.json({
      totalUnits: unitCount || 0,
      totalPrograms: uniquePrograms.size,
      upcomingClasses: liveClasses || [],
      recentSubmissions
    });
  } catch (err) {
    console.error('[lecturerController.getOverview] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
};

/**
 * GET /api/lecturer/units
 */
export const getUnits = async (req, res) => {
  const tid = getLecturerId(req);
  try {
    const { data, error } = await supabase
      .from('lecturer_units')
      .select(`
        id,
        unit_id,
        program_id,
        units ( id, title, short_code, description ),
        courses ( id, title, short_code )
      `)
      .eq('lecturer_id', tid);

    if (error) throw error;

    // Enrich with semester and year from program_units
    const enriched = await Promise.all((data || []).map(async (item) => {
      if (!item.units) return null;

      const { data: pu } = await supabase
        .from('program_units')
        .select('semester, year')
        .eq('program_id', item.program_id)
        .eq('unit_id', item.unit_id)
        .maybeSingle();
      
      return {
        ...item.units,
        program: item.courses,
        semester: pu?.semester,
        year: pu?.year
      };
    }));

    res.json(enriched.filter(Boolean));
  } catch (err) {
    console.error('[lecturerController.getUnits] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch units' });
  }
};

/**
 * GET /api/lecturer/programs
 */
export const getPrograms = async (req, res) => {
  const tid = getLecturerId(req);
  try {
    const { data, error } = await supabase
      .from('lecturer_units')
      .select(`
        program_id,
        courses ( id, title, short_code, description, thumbnail_url )
      `)
      .eq('lecturer_id', tid);

    if (error) throw error;

    const uniquePrograms = [];
    const seen = new Set();
    (data || []).forEach(item => {
      if (item.courses && !seen.has(item.courses.id)) {
        uniquePrograms.push(item.courses);
        seen.add(item.courses.id);
      }
    });

    res.json(uniquePrograms);
  } catch (err) {
    console.error('[lecturerController.getPrograms] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch programs' });
  }
};  

/**
 * GET /api/lecturer/topics/:unitId
 */
export const getTopicsByUnit = async (req, res) => {
  const { unitId } = req.params;
  const tid = getLecturerId(req);

  try {
    // Security check: Verify lecturer is assigned to this unit
    const { data: access } = await supabase
      .from('lecturer_units')
      .select('id')
      .eq('lecturer_id', tid)
      .eq('unit_id', unitId)
      .maybeSingle();

    if (!access) {
      console.warn(`[lecturerController.getTopicsByUnit] Access denied for lecturer ${tid} on unit ${unitId}`);
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data, error } = await supabase
      .from('topics')
      .select('*')
      .eq('unit_id', unitId)
      .order('sequence_number', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[lecturerController.getTopicsByUnit] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch topics' });
  }
};

/**
 * POST /api/lecturer/topics
 */
export const createTopic = async (req, res) => {
  const tid = getLecturerId(req);
  const { unit_id, title, content_type, sequence_number, notes } = req.body;

  if (!unit_id || !title) {
    return res.status(400).json({ error: 'unit_id and title are required' });
  }

  try {
    // Security check
    const { data: access } = await supabase
      .from('lecturer_units')
      .select('id')
      .eq('lecturer_id', tid)
      .eq('unit_id', unit_id)
      .maybeSingle();

    if (!access) return res.status(403).json({ error: 'Access denied' });

    // Handle file uploads
    let video_url = req.body.video_url || null;
    let audio_intro_url = req.body.audio_intro_url || null;
    let notes_url = req.body.notes_url || null;

    if (req.files) {
      if (req.files.video?.[0]) video_url = await uploadToGCS(req.files.video[0]);
      if (req.files.audio?.[0]) audio_intro_url = await uploadToGCS(req.files.audio[0]);
      if (req.files.document?.[0]) notes_url = await uploadToGCS(req.files.document[0]);
    }

    const { data, error } = await supabase
      .from('topics')
      .insert({
        unit_id,
        title,
        content_type: content_type || 'text',
        sequence_number: sequence_number || 0,   
        notes,
        video_url,
        audio_intro_url,
        notes_url
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`[lecturerController.createTopic] Topic "${title}" created in unit ${unit_id}`);
    res.status(201).json(data);
  } catch (err) {
    console.error('[lecturerController.createTopic] Error:', err.message);
    res.status(500).json({ error: 'Failed to create topic' });
  }
};


/**
 * PATCH /api/lecturer/topics/:id
 */
export const updateTopic = async (req, res) => {
  const { id } = req.params;
  const tid = getLecturerId(req);
  const updates = { ...req.body };

  try {
    // Security check
    const { data: topic } = await supabase
      .from('topics')
      .select('unit_id')
      .eq('id', id)
      .maybeSingle();

    if (!topic) return res.status(404).json({ error: 'Topic not found' });

    const { data: access } = await supabase
      .from('lecturer_units')
      .select('id')
      .eq('lecturer_id', tid)
      .eq('unit_id', topic.unit_id)
      .maybeSingle();

    if (!access) return res.status(403).json({ error: 'Access denied' });

    // Handle file uploads for updates
    if (req.files) {
      if (req.files.video?.[0]) updates.video_url = await uploadToGCS(req.files.video[0]);
      if (req.files.audio?.[0]) updates.audio_intro_url = await uploadToGCS(req.files.audio[0]);
      if (req.files.document?.[0]) updates.notes_url = await uploadToGCS(req.files.document[0]);
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('topics')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    console.log(`[lecturerController.updateTopic] Topic ${id} updated`);
    res.json(data);
  } catch (err) {
    console.error('[lecturerController.updateTopic] Error:', err.message);
    res.status(500).json({ error: 'Failed to update topic' });
  }
};


/**
 * DELETE /api/lecturer/topics/:id
 */
export const deleteTopic = async (req, res) => {
  const { id } = req.params;
  const tid = getLecturerId(req);

  try {
    const { data: topic } = await supabase
      .from('topics')
      .select('unit_id')
      .eq('id', id)
      .maybeSingle();

    if (!topic) return res.status(404).json({ error: 'Topic not found' });

    const { data: access } = await supabase
      .from('lecturer_units')
      .select('id')
      .eq('lecturer_id', tid)
      .eq('unit_id', topic.unit_id)
      .maybeSingle();

    if (!access) return res.status(403).json({ error: 'Access denied' });

    const { error } = await supabase.from('topics').delete().eq('id', id);
    if (error) throw error;

    console.log(`[lecturerController.deleteTopic] Topic ${id} deleted`);
    res.json({ message: 'Topic deleted successfully' });
  } catch (err) {
    console.error('[lecturerController.deleteTopic] Error:', err.message);
    res.status(500).json({ error: 'Failed to delete topic' });
  }
};

/**
 * GET /api/lecturer/assignments
 */
export const getAssignments = async (req, res) => {
  const tid = getLecturerId(req);
  try {
    const { data: lecturerUnits } = await supabase
      .from('lecturer_units')
      .select('unit_id')
      .eq('lecturer_id', tid);
    
    const unitIds = (lecturerUnits || []).map(lu => lu.unit_id);

    if (unitIds.length === 0) {
      return res.json([]);
    }

    const { data, error } = await supabase
      .from('assignments')
      .select(`
        *,
        units ( title, short_code )
      `)
      .in('unit_id', unitIds)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[lecturerController.getAssignments] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
};

/**
 * POST /api/lecturer/assignments
 */
export const createAssignment = async (req, res) => {
  const tid = getLecturerId(req);
  const { unit_id, title, description, due_date } = req.body;

  if (!unit_id || !title) {
    return res.status(400).json({ error: 'unit_id and title are required' });
  }

  try {
    // Security check
    const { data: access } = await supabase
      .from('lecturer_units')
      .select('id')
      .eq('lecturer_id', tid)
      .eq('unit_id', unit_id)
      .maybeSingle();

    if (!access) return res.status(403).json({ error: 'Access denied' });

    let file_url = req.body.file_url || null;
    if (req.file) {
      file_url = await uploadToGCS(req.file);
    }

    const { data, error } = await supabase
      .from('assignments')
      .insert({
        teacher_id: tid,
        unit_id,
        title,
        description,
        due_date,
        file_url,
        type: 'assignment'
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`[lecturerController.createAssignment] Assignment "${title}" created for unit ${unit_id}`);
    res.status(201).json(data);
  } catch (err) {
    console.error('[lecturerController.createAssignment] Error:', err.message);
    res.status(500).json({ error: 'Failed to create assignment' });
  }
};


/**
 * GET /api/lecturer/submissions
 */
export const getSubmissions = async (req, res) => {
  const tid = getLecturerId(req);
  const { unitId } = req.query;

  try {
    const { data: lecturerUnits } = await supabase
      .from('lecturer_units')
      .select('unit_id')
      .eq('lecturer_id', tid);
    
    const unitIds = (lecturerUnits || []).map(lu => lu.unit_id);
    
    if (unitId && !unitIds.includes(unitId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const targetUnitIds = unitId ? [unitId] : unitIds;

    if (targetUnitIds.length === 0) {
      return res.json([]);
    }

    // Get assignments for the target units first
    const { data: assignments } = await supabase
      .from('assignments')
      .select('id, title, unit_id')
      .in('unit_id', targetUnitIds);

    const assignmentIds = (assignments || []).map(a => a.id);

    if (assignmentIds.length === 0) {
      return res.json([]);
    }

    const { data: submissions, error } = await supabase
      .from('assignment_submissions')
      .select('*')
      .in('assignment_id', assignmentIds)
      .order('submitted_at', { ascending: false });

    if (error) throw error;

    // Enrich submissions with assignment titles
    const assignmentMap = new Map((assignments || []).map(a => [a.id, a]));
    const enriched = (submissions || []).map(sub => ({
      ...sub,
      assignment: assignmentMap.get(sub.assignment_id) || null
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[lecturerController.getSubmissions] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
};

/**
 * GET /api/lecturer/units/:unitId/students
 */
export const getStudentsByUnit = async (req, res) => {
  const { unitId } = req.params;
  try {
    const { data, error } = await supabase
      .from('student_units')
      .select('student_id')
      .eq('unit_id', unitId);

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.json([]);
    }

    // Get user details for each student
    const studentIds = data.map(s => s.student_id);
    const { data: students, error: userError } = await supabase
      .from('users')
      .select('id, name, email')
      .in('id', studentIds);

    if (userError) throw userError;

    res.json(students || []);
  } catch (err) {
    console.error('[lecturerController.getStudentsByUnit] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
};
   
/**
 * GET /api/lecturer/live-classes
 */
export const getLecturerLiveClasses = async (req, res) => {
  const lecturerId = getLecturerId(req);
  try {
    const { data, error } = await supabase
      .from("live_classes")
      .select("*")
      .eq("teacher_id", lecturerId)
      .order("start_time", { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error("[lecturerController.getLecturerLiveClasses] Error:", err.message);
    res.status(500).json({ error: 'Failed to fetch live classes' });
  }
};


export const updateTeacherProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { national_id_number } = req.body;

    // Build update object with only provided values
    const updates = {};
    if (national_id_number) updates.national_id_number = national_id_number;

    if (req.files) {
      if (req.files.nationalIdPhoto?.[0]) {
        updates.national_id_photo_url = await uploadToGCS(req.files.nationalIdPhoto[0]);
      }
      if (req.files.profilePhoto?.[0]) {
        updates.profile_photo_url = await uploadToGCS(req.files.profilePhoto[0]);
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    updates.updated_at = new Date().toISOString();

    const { data: updatedDetails, error } = await supabase
      .from("teacher_details")
      .update(updates)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;

    console.log(`[Auth] Teacher profile updated for user ${userId}`);
    res.json({ message: "Profile updated successfully", teacherDetails: updatedDetails });
  } catch (err) {
    console.error("[Auth] Update teacher profile error:", err.message);
    res.status(500).json({ error: "Failed to update teacher profile" });
  }
};

/**
 * GET /api/lecturer/profile
 * Get full profile of the logged-in lecturer
 */
export const getTeacherProfile = async (req, res) => {
  const userId = req.user.id;
  try {
    // 1. Get base user details
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    // 2. Get teacher specific details, along with department name
    const { data: teacherDetails, error: detailsError } = await supabase
      .from('teacher_details')
      .select(`
        teacher_id, 
        department_id, 
        national_id_number, 
        national_id_photo_url, 
        profile_photo_url,
        department(name)
      `)
      .eq('user_id', userId)
      .single();

    if (detailsError) throw detailsError;

    // 3. Combine and return
    const profile = {
      ...user,
      ...teacherDetails,
      department_name: teacherDetails?.department?.name || null
    };

    res.json(profile);
  } catch (err) {
    console.error('[lecturerController.getTeacherProfile] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch teacher profile' });
  }
};