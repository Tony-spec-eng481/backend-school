import supabase from "../config/supabase.js";

/**
 * Get system-wide statistics
 */
export const getStats = async (req, res) => {
  try {
    const [studentsRes, teachersRes, coursesRes, pendingRes] =
      await Promise.all([
        supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("role", "student"),

        supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("role", "teacher"),

        supabase.from("courses").select("id", { count: "exact", head: true }),

        supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("is_verified", false),
      ]);

    res.json({
      students: studentsRes.count || 0,
      teachers: teachersRes.count || 0,
      courses: coursesRes.count || 0,
      pendingVerifications: pendingRes.count || 0,
    });
  } catch (error) {
    console.error("[adminController.getStats] Error:", error.message);
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
};

/**
 * Get all users with their details
 */
export const getUsers = async (req, res) => {
  const { role } = req.query;

  try {
    let query = supabase.from("users").select(`
        *,
        student_details (*),
        teacher_details (*),
        admin_details (*)
      `);

    if (role) {
      query = query.eq("role", role);
    }

    const { data: users, error } = await query.order("created_at", {
      ascending: false,
    });

    if (error) throw error;

    // Remove password from response
    const sanitized = (users || []).map(({ password, ...user }) => user);

    res.json(sanitized);
  } catch (error) {
    console.error("[adminController.getUsers] Error:", error.message);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

/**
 * Update user verification status
 */
export const verifyUser = async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from("users")
      .update({ is_verified: true })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: "User not found" });
    }

    console.log(`[adminController.verifyUser] User ${id} verified`);
    res.json({ message: "User verified successfully", user: data });
  } catch (error) {
    console.error("[adminController.verifyUser] Error:", error.message);
    res.status(500).json({ error: "Failed to verify user" });
  }
};

/**
 * Delete a user (Reject)
 */
export const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    // Delete role-specific details first (in case no CASCADE)
    await supabase.from("student_details").delete().eq("user_id", id);
    await supabase.from("teacher_details").delete().eq("user_id", id);
    await supabase.from("admin_details").delete().eq("user_id", id);
    await supabase.from("refresh_tokens").delete().eq("user_id", id);

    const { error } = await supabase.from("users").delete().eq("id", id);

    if (error) throw error;

    console.log(`[adminController.deleteUser] User ${id} deleted`);
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("[adminController.deleteUser] Error:", error.message);
    res.status(500).json({ error: "Failed to delete user" });
  }
};

/**
 * Support Tickets
 */
export const getSupportTickets = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("support_tickets")
      .select("*, users(name, email)")
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error("[adminController.getSupportTickets] Error:", error.message);
    res.status(500).json({ error: "Failed to fetch support tickets" });
  }
};

export const updateTicketStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: "Status is required" });
  }

  try {
    const { data, error } = await supabase
      .from("support_tickets")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    console.log(`[adminController.updateTicketStatus] Ticket ${id} → ${status}`);
    res.json(data);
  } catch (error) {
    console.error("[adminController.updateTicketStatus] Error:", error.message);
    res.status(500).json({ error: "Failed to update ticket status" });
  }
};

/**
 * System Settings
 */
export const getSettings = async (req, res) => {
  try {
    const { data, error } = await supabase.from("system_settings").select("*");
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error("[adminController.getSettings] Error:", error.message);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
};

export const updateSettings = async (req, res) => {
  const { key, value } = req.body;

  if (!key || value === undefined) {
    return res.status(400).json({ error: "Key and value are required" });
  }

  try {
    const { data, error } = await supabase
      .from("system_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() })
      .select()
      .single();

    if (error) throw error;

    console.log(`[adminController.updateSettings] Setting "${key}" updated`);
    res.json(data);
  } catch (error) {
    console.error("[adminController.updateSettings] Error:", error.message);
    res.status(500).json({ error: "Failed to update settings" });
  }
};

/**
 * Announcements
 */
export const getAnnouncements = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("announcements")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error("[adminController.getAnnouncements] Error:", error.message);
    res.status(500).json({ error: "Failed to fetch announcements" });
  }
};

export const createAnnouncement = async (req, res) => {
  const { title, content, target_role, expires_at } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: "Title and content are required" });
  }

  try {
    const { data, error } = await supabase
      .from("announcements")
      .insert([{ title, content, target_role, expires_at, is_active: true }])
      .select()
      .single();

    if (error) throw error;

    console.log(`[adminController.createAnnouncement] Created: "${title}"`);
    res.status(201).json(data);
  } catch (error) {
    console.error("[adminController.createAnnouncement] Error:", error.message);
    res.status(500).json({ error: "Failed to create announcement" });
  }
};

/**
 * Course/Content Approval
 */
export const getPendingCourses = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("courses")
      .select(`
        *,
        department(name, short_code)
      `)
      .eq("status", "pending");

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error("[adminController.getPendingCourses] Error:", error.message);
    res.status(500).json({ error: "Failed to fetch pending courses" });
  }
};

export const updateCourseStatus = async (req, res) => {
  const { id } = req.params;
  const { status, title, tags } = req.body;

  if (!status) {
    return res.status(400).json({ error: "Status is required" });
  }

  try {
    const updateData = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (title) updateData.title = title;
    if (tags) updateData.tags = tags;

    const { data, error } = await supabase
      .from("courses")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    console.log(`[adminController.updateCourseStatus] Course ${id} → ${status}`);
    res.json(data);
  } catch (error) {
    console.error("[adminController.updateCourseStatus] Error:", error.message);
    res.status(500).json({ error: "Failed to update course status" });
  }
};

/**
 * Analytics
 */
export const getAnalytics = async (req, res) => {
  try {
    const [enrollRes, progressRes] = await Promise.all([
      supabase.from("enrollments").select("id", { count: "exact", head: true }),

      supabase
        .from("progress")
        .select("id", { count: "exact", head: true })
        .eq("is_completed", true),
    ]);

    const totalEnrollments = enrollRes.count || 0;
    const completedLessons = progressRes.count || 0;

    res.json({
      totalEnrollments,
      completedLessons,
      engagementRate: totalEnrollments
        ? (completedLessons / totalEnrollments).toFixed(2)
        : 0,
    });
  } catch (error) {
    console.error("[adminController.getAnalytics] Error:", error.message);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
};

/**
 * CREATE DEPARTMENT
 */
export const createDepartment = async (req, res) => {
  const { name, description, short_code } = req.body;

  if (!name || !short_code) {
    return res.status(400).json({ error: "Name and short_code are required" });
  }

  try {
    const { data, error } = await supabase
      .from("department")
      .insert([{ name, description, short_code }])
      .select()
      .single();

    if (error) throw error;

    console.log(`[adminController.createDepartment] Created: "${name}" (${short_code})`);
    res.status(201).json(data);
  } catch (err) {
    console.error("[adminController.createDepartment] Error:", err.message);
    res.status(500).json({ error: "Failed to create department" });
  }
};

/**
 * GET ALL DEPARTMENTS
 */
export const getDepartments = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("department")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error("[adminController.getDepartments] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch departments" });
  }
};

/**
 * UPDATE DEPARTMENT
 */
export const updateDepartment = async (req, res) => {
  const { id } = req.params;
  const { name, description, short_code } = req.body;

  try {
    const { data, error } = await supabase
      .from("department")
      .update({ name, description, short_code })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    console.log(`[adminController.updateDepartment] Updated department ${id}`);
    res.json(data);
  } catch (err) {
    console.error("[adminController.updateDepartment] Error:", err.message);
    res.status(500).json({ error: "Failed to update department" });
  }
};

/**
 * DELETE DEPARTMENT
 */
export const deleteDepartment = async (req, res) => {
  const { id } = req.params;

  try {
    const { error } = await supabase.from("department").delete().eq("id", id);

    if (error) throw error;

    console.log(`[adminController.deleteDepartment] Deleted department ${id}`);
    res.json({ message: "Department deleted" });
  } catch (err) {
    console.error("[adminController.deleteDepartment] Error:", err.message);
    res.status(500).json({ error: "Failed to delete department" });
  }
};

/**
 * GET SINGLE USER (REPORT)
 */
export const getUserById = async (req, res) => {
  const { id } = req.params;

  try {
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Remove password from response
    const { password, ...safeUser } = user;
    let report = { ...safeUser };

    if (user.role === "teacher") {
      const { data: teacherDetails } = await supabase
        .from("teacher_details")
        .select(`
          *,
          department(name, short_code)
        `)
        .eq("user_id", id)
        .single();

      const { count: coursesCount } = await supabase
        .from("lecturer_units")
        .select("id", { count: "exact", head: true })
        .eq("lecturer_id", id);

      // Count students they teach (via units)
      const { data: lecturerUnitsList } = await supabase
        .from("lecturer_units")
        .select("unit_id")
        .eq("lecturer_id", id);

      let totalStudents = 0;
      if (lecturerUnitsList?.length) {
        const unitIds = lecturerUnitsList.map((u) => u.unit_id);
        const { count: studentCount } = await supabase
          .from("student_units")
          .select("id", { count: "exact", head: true })
          .in("unit_id", unitIds);
        totalStudents = studentCount || 0;
      }

      report.teacherReport = {
        details: teacherDetails,
        totalCourses: coursesCount || 0,
        totalStudents,
      };
    } else if (user.role === "student") {
      const { data: studentDetails } = await supabase
        .from("student_details")
        .select("*")
        .eq("user_id", id)
        .single();

      // Get program info separately if program_id exists
      let programInfo = null;
      if (studentDetails?.program_id) {
        const { data: program } = await supabase
          .from("courses")
          .select("title, short_code")
          .eq("id", studentDetails.program_id)
          .single();
        programInfo = program;
      }

      const { count: enrolledCourses } = await supabase
        .from("enrollments")
        .select("id", { count: "exact", head: true })
        .eq("student_id", id);

      const { count: completedLessons } = await supabase
        .from("progress")
        .select("id", { count: "exact", head: true })
        .eq("student_id", id)
        .eq("is_completed", true);

      report.studentReport = {
        details: { ...studentDetails, program: programInfo },
        totalCourses: enrolledCourses || 0,
        completedLessons: completedLessons || 0,
      };
    } else if (user.role === "admin") {
      const { data: adminDetails } = await supabase
        .from("admin_details")
        .select("*")
        .eq("user_id", id)
        .single();

      report.adminReport = {
        details: adminDetails || null,
      };
    }

    res.json(report);
  } catch (err) {
    console.error("[adminController.getUserById] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch user report" });
  }
};