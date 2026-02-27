import supabase from '../config/supabase.js';

/**
 * CREATE COURSE UNDER DEPARTMENT
 */
export const createCourse = async (req, res) => {
  const {
    title,
    description,
    short_code,
    duration_weeks,
    difficulty,
    department_id,   
  } = req.body;

  if (!title || !short_code) {
    return res.status(400).json({ error: "Title and short_code are required" });
  }

  try {
    const { data, error } = await supabase
      .from("courses")
      .insert([
        {
          title,
          description,
          short_code,
          duration_weeks,
          difficulty,
          department_id,
          status: "active",
        },
      ])
      .select()
      .single();

    if (error) throw error;

    console.log(`[courseController.createCourse] Created: "${title}" (${short_code})`);
    res.status(201).json(data);
  } catch (err) {
    console.error("[courseController.createCourse] Error:", err.message);
    res.status(500).json({ error: "Failed to create course" });
  }
};

/**
 * GET COURSES (WITH DEPARTMENT)
 */
export const getAllCourses = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("courses")
      .select(`
        *,
        department(name, short_code),
        program_units (
          semester,
          year,
          units (
            *,
            topics(id, title, sequence_number)
          )
        )
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error("[courseController.getAllCourses] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch courses" });
  }
};

export const getCourseById = async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from("courses")
      .select(`
        *,
        department(name, short_code),
        program_units (
          semester,
          year,
          units (
            *,
            topics(id, title, sequence_number)
          )
        )
      `)
      .eq("id", id)
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: "Course not found" });
    }

    res.json(data);
  } catch (error) {
    console.error("[courseController.getCourseById] Error:", error.message);
    res.status(500).json({ error: "Failed to fetch course" });
  }
};

export const deleteCourse = async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('courses')
      .delete()
      .eq('id', id);

    if (error) throw error;

    console.log(`[courseController.deleteCourse] Course ${id} deleted`);
    res.json({ message: 'Course deleted successfully' });
  } catch (error) {
    console.error("[courseController.deleteCourse] Error:", error.message);
    res.status(500).json({ error: "Failed to delete course" });
  }
};

/**
 * UPDATE COURSE
 */
export const updateCourse = async (req, res) => {
  const { id } = req.params;
  const {
    title,
    description,
    short_code,
    duration_weeks,
    difficulty,
    department_id,
  } = req.body;

  try {
    const updateData = { updated_at: new Date().toISOString() };
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (short_code !== undefined) updateData.short_code = short_code;
    if (duration_weeks !== undefined) updateData.duration_weeks = duration_weeks;
    if (difficulty !== undefined) updateData.difficulty = difficulty;
    if (department_id !== undefined) updateData.department_id = department_id;

    const { data, error } = await supabase
      .from("courses")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    console.log(`[courseController.updateCourse] Course ${id} updated`);
    res.json(data);
  } catch (err) {
    console.error("[courseController.updateCourse] Error:", err.message);
    res.status(500).json({ error: "Failed to update course" });
  }
};
