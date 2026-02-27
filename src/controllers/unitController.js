import supabase from "../config/supabase.js";

/**
 * Get all units assigned to a specific course (program)
 */
export const getUnitsByCourse = async (req, res) => {
  const { programId } = req.params;
  try {
    const { data: programUnits, error } = await supabase
      .from("program_units")
      .select(`
        id,
        semester,
        year,
        units (
          id,
          title,
          description,
          short_code,
          created_at,
          topics(id, title)
        )
      `)
      .eq("program_id", programId);

    if (error) throw error;

    // For each unit, get its assigned lecturer separately
    const units = await Promise.all((programUnits || []).map(async (pu) => {
      if (!pu.units) return null;

      // Find the teacher assigned for this specific program and unit
      const { data: lecturerAssignment } = await supabase
        .from("lecturer_units")
        .select("lecturer_id")
        .eq("unit_id", pu.units.id)
        .eq("program_id", programId)
        .maybeSingle();

      let assignedTeacher = null;
      if (lecturerAssignment?.lecturer_id) {
        const { data: teacher } = await supabase
          .from("users")
          .select("id, name")
          .eq("id", lecturerAssignment.lecturer_id)
          .single();
        assignedTeacher = teacher || null;
      }

      return {
        program_unit_id: pu.id,
        semester: pu.semester,
        year: pu.year,
        ...pu.units,
        assigned_teacher: assignedTeacher,
      };
    }));

    res.json(units.filter(Boolean));
  } catch (err) {
    console.error("[unitController.getUnitsByCourse] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch units" });
  }
};

/**
 * Create a new unit and link it to a course
 */
export const createUnit = async (req, res) => {
  const { title, description, short_code, program_id, semester, year, teacher_id } = req.body;

  if (!title || !program_id) {
    return res.status(400).json({ error: "Title and program_id are required" });
  }

  try {
    // 1. Create the unit
    const { data: newUnit, error: unitError } = await supabase
      .from("units")
      .insert([{ title, description, short_code }])
      .select()
      .single();

    if (unitError) throw unitError;

    // 2. Link it to the course (program)
    const { error: linkError } = await supabase
      .from("program_units")
      .insert([
        {
          program_id,
          unit_id: newUnit.id,
          semester: semester || 1,
          year: year || 1,
        },
      ]);

    if (linkError) {
      // Rollback unit creation if link fails
      await supabase.from("units").delete().eq("id", newUnit.id);
      throw linkError;
    }

    // 3. Assign teacher if provided
    if (teacher_id) {
      const { error: lecturerError } = await supabase
        .from("lecturer_units")
        .insert([
          {
            lecturer_id: teacher_id,
            unit_id: newUnit.id,
            program_id: program_id
          }
        ]);
        
      if (lecturerError) {
        console.error("[unitController.createUnit] Failed to assign teacher:", lecturerError.message);
      }
    }

    console.log(`[unitController.createUnit] Unit "${title}" created and linked to program ${program_id}`);
    res.status(201).json({ message: "Unit created successfully", unit: newUnit });
  } catch (err) {
    console.error("[unitController.createUnit] Error:", err.message);
    res.status(500).json({ error: "Failed to create unit" });
  }
};

/**
 * Update a unit
 */
export const updateUnit = async (req, res) => {
  const { id } = req.params;
  const { title, description, short_code, semester, year, program_unit_id, teacher_id, program_id } = req.body;

  try {
    // Update unit details
    const updateData = { updated_at: new Date().toISOString() };
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (short_code !== undefined) updateData.short_code = short_code;

    const { data: updatedUnit, error: unitError } = await supabase
      .from("units")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (unitError) throw unitError;

    // Update program link details if provided
    if (program_unit_id && (semester !== undefined || year !== undefined)) {
      const linkUpdate = {};
      if (semester !== undefined) linkUpdate.semester = semester;
      if (year !== undefined) linkUpdate.year = year;
      
      const { error: linkError } = await supabase
        .from("program_units")
        .update(linkUpdate)
        .eq("id", program_unit_id);
        
      if (linkError) {
        console.error("[unitController.updateUnit] Link update error:", linkError.message);
        throw linkError;
      }
    }

    // Update teacher assignment if explicitly provided
    if (teacher_id !== undefined && program_id) {
      if (teacher_id === "" || teacher_id === null) {
        // Remove assignment
        const { error: delErr } = await supabase
          .from("lecturer_units")
          .delete()
          .match({ unit_id: id, program_id: program_id });
        if (delErr) console.error("[unitController.updateUnit] Remove teacher error:", delErr.message);
      } else {
        // Check if an assignment already exists for this unit and program
        const { data: existingAssignment } = await supabase
          .from("lecturer_units")
          .select("id")
          .match({ unit_id: id, program_id: program_id })
          .maybeSingle();

        if (existingAssignment) {
          // Update existing assignment
          await supabase
            .from("lecturer_units")
            .update({ lecturer_id: teacher_id })
            .eq("id", existingAssignment.id);
        } else {
          // Create new assignment
          await supabase
            .from("lecturer_units")
            .insert([{
              lecturer_id: teacher_id,
              unit_id: id,
              program_id: program_id
            }]);
        }
      }
    }

    console.log(`[unitController.updateUnit] Unit ${id} updated`);
    res.json(updatedUnit);
  } catch (err) {
    console.error("[unitController.updateUnit] Error:", err.message);
    res.status(500).json({ error: "Failed to update unit" });
  }
};

/**
 * Delete a unit
 */
export const deleteUnit = async (req, res) => {
  const { id } = req.params;
  try {
    // Clean up related records first (in case no CASCADE)
    await supabase.from("program_units").delete().eq("unit_id", id);
    await supabase.from("lecturer_units").delete().eq("unit_id", id);
    await supabase.from("student_units").delete().eq("unit_id", id);

    const { error } = await supabase.from("units").delete().eq("id", id);
    if (error) throw error;

    console.log(`[unitController.deleteUnit] Unit ${id} deleted`);
    res.json({ message: "Unit deleted successfully" });
  } catch (err) {
    console.error("[unitController.deleteUnit] Error:", err.message);
    res.status(500).json({ error: "Failed to delete unit" });
  }
};
