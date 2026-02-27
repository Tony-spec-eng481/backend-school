import supabase from "../config/supabase.js";

/**
 * Generates a unique user ID using department short_code
 * Format:
 *  Student → STU/DEPT/YEAR/SERIAL
 *  Teacher → TCH/DEPT/YEAR/SERIAL
 *  Admin   → ADM/YEAR/SERIAL
 *
 * @param {string} role - 'student' | 'teacher' | 'admin'
 * @param {string|null} departmentId - required for student & teacher
 * @returns {Promise<string>}
 */
export const generateUserId = async (role, departmentId = null) => {
  try {
    const year = new Date().getFullYear();
    const roleKey = role.toLowerCase();

    // ==============================
    // 1️⃣ Fetch department short code
    // ==============================
    let deptCode = null;

    if (roleKey === "teacher") {
      if (!departmentId) {
        throw new Error("Department ID is required for teachers");
      }

      const { data: dept, error: deptError } = await supabase
        .from("department")
        .select("short_code")
        .eq("id", departmentId)
        .single();

      if (deptError) throw deptError;
      if (!dept) throw new Error("Department not found");

      deptCode = dept.short_code;
    }

    // ==============================
    // 2️⃣ Get sequence
    // ==============================
    const { data: sequenceData, error: fetchError } = await supabase
      .from("id_sequences")
      .select("current_sequence")
      .eq("year", year)
      .eq("role", roleKey)
      .single();

    let currentSequence = 0;

    // If no record → create one
    if (fetchError && fetchError.code === "PGRST116") {
      const { error: insertError } = await supabase
        .from("id_sequences")
        .insert([{ year, role: roleKey, current_sequence: 0 }]);

      if (insertError) throw insertError;
    } else if (fetchError) {
      throw fetchError;
    } else {
      currentSequence = sequenceData.current_sequence;
    }

    // ==============================
    // 3️⃣ Increment sequence
    // ==============================
    const newSequence = currentSequence + 1;

    const { error: updateError } = await supabase
      .from("id_sequences")
      .update({ current_sequence: newSequence })
      .eq("year", year)
      .eq("role", roleKey);

    if (updateError) throw updateError;

    const sequenceString = newSequence.toString().padStart(4, "0");

    // ==============================
    // 4️⃣ Build final ID
    // ==============================
    if (roleKey === "student") {
      // departmentId is passed as courseCode for students
      return `STU/${departmentId}/${year}/${sequenceString}`;
    }

    if (roleKey === "teacher") {
      return `TCH/${deptCode}/${year}/${sequenceString}`;
    }

    return `ADM/${year}/${sequenceString}`;
  } catch (err) {
    console.error("ID generation error:", err.message);
    throw err;
  }
};
