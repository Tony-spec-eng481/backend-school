import supabase from "../config/supabase.js";

/* =====================================================
   GET ALL ANNOUNCEMENTS
===================================================== */
export const getAnnouncements = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("announcements")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   GET SINGLE ANNOUNCEMENT
===================================================== */
export const getAnnouncementById = async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from("announcements")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   CREATE ANNOUNCEMENT
===================================================== */
export const createAnnouncement = async (req, res) => {
  const { title, content, target_role, expires_at } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: "Title and content are required" });
  }

  try {
    const { data, error } = await supabase
      .from("announcements")
      .insert([
        {
          title,
          content,
          target_role,
          expires_at,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   UPDATE ANNOUNCEMENT
===================================================== */
export const updateAnnouncement = async (req, res) => {
  const { id } = req.params;
  const { title, content, target_role, expires_at, is_active } = req.body;

  try {
    const { data, error } = await supabase
      .from("announcements")
      .update({
        title,
        content,
        target_role,
        expires_at,
        is_active,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   DELETE ANNOUNCEMENT
===================================================== */
export const deleteAnnouncement = async (req, res) => {
  const { id } = req.params;

  try {
    const { error } = await supabase
      .from("announcements")
      .delete()
      .eq("id", id);

    if (error) throw error;

    res.json({ message: "Announcement deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   TOGGLE ACTIVE STATUS
===================================================== */
export const toggleAnnouncementStatus = async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  try {
    const { data, error } = await supabase
      .from("announcements")
      .update({ is_active })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =====================================================
   GET ACTIVE ANNOUNCEMENTS (NOT EXPIRED)
===================================================== */
export const getActiveAnnouncements = async (req, res) => {
  try {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("announcements")
      .select("*")
      .eq("is_active", true)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
