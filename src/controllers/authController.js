import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import supabase from "../config/supabase.js";
import { generateUserId } from "../utils/idGenerator.js";
import { sendEmail } from "../utils/email.js";
import { uploadToGCS } from "../utils/gcsUtils.js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ================================
   TOKEN GENERATORS
================================ */

const generateAccessToken = (user) => {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });
};

const generateVerificationToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

const generateRefreshToken = (user) => {
  return jwt.sign({ id: user.id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: "7d",
  });
};

/* ================================
   TEMPLATE HELPERS
================================ */

const loadTemplate = (filename) => {
  const filePath = path.join(__dirname, `../emails/${filename}`);
  return fs.readFileSync(filePath, "utf8");
};

const replacePlaceholders = (template, replacements) => {
  let output = template;
  for (const key in replacements) {
    output = output.replaceAll(`{{${key}}}`, replacements[key]);
  }
  return output;
};

const notifyAdminsNewRegistration = async (
  userFullName,
  userEmail,
  userRole,
  department,
  registrationDateStr,
  verificationUrl,
) => {
  try {
    // Fetch all admin emails
    const { data: admins } = await supabase
      .from("users")
      .select("email, name")
      .eq("role", "admin");

    if (!admins || admins.length === 0) return;

    for (const admin of admins) {
      let html = loadTemplate("AdminNotification-email.html");
      html = replacePlaceholders(html, {
        ADMIN_NAME: admin.name || "Admin",
        USER_NAME: userFullName,
        USER_ROLE_TITLE:
          userRole.charAt(0).toUpperCase() +
          userRole.slice(1) +
          " Registration",
        EMAIL_ADDRESS: userEmail,
        DEPARTMENT: department || "N/A",
        REGISTRATION_DATE: registrationDateStr,
        ADMIN_URL: verificationUrl,
      });

    sendEmail(admin.email, `New ${userRole} Registration Alert`, html);
    }
  } catch (error) {
    console.error("Failed to send admin notifications:", error);
  }
};

/* ================================
   REGISTER STAFF (ADMIN ONLY)
   ================================ */

export const registerStaff = async (req, res) => {
  const { name, email, password, role } = req.body;

  try {
    if (role !== "admin") {
      return res
        .status(400)
        .json({ error: "Invalid role for admin registration" });
    }

    const { data: existingUser } = await supabase
      .from("users")
      .select("email")
      .eq("email", email)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data: newUser, error: userError } = await supabase
      .from("users")
      .insert([
        {
          name,
          email,
          password: hashedPassword,
          role,
          is_verified: true, // Staff created by admin are verified by default
        },
      ])
      .select()
      .single();

    if (userError) throw userError;

    const generatedId = await generateUserId(role, "GEN");

    // Register as admin
    const { error } = await supabase.from("admin_details").insert([
      {
        user_id: newUser.id,
        admin_id: generatedId,
      },
    ]);
    if (error) throw error;

    // Send Welcome Email with Teacher ID
    try {
      let html = loadTemplate("Admission-email.html");
      html = replacePlaceholders(html, {
        USER_ID: generatedId,
      });

      sendEmail(
        email,
        "Welcome to Trespics School - Your Account is Ready",
        html,
      );
    } catch (emailError) {
      console.error("Failed to send registration email:", emailError);
      // Don't fail the registration if email fails, but maybe report it
    }

    res.status(201).json({
      message: `${role} registered successfully. Credentials sent to email.`,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        custom_id: generatedId,
      },
    });
  } catch (error) {
    console.error("Staff registration error:", error);
    res.status(500).json({ error: error.message });
  }
};

/* ================================
   REGISTER
================================ */

/* ================================
   REGISTER
================================ */

export const register = async (req, res) => {
  const { name, email, password, role, courseId } = req.body;

  try {
    if (role !== "student") {
      return res
        .status(403)
        .json({ error: "Only student registration is handled here." });
    }
    const { data: existingUser } = await supabase
      .from("users")
      .select("email")
      .eq("email", email)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    // 2. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes

    // 3. Create user in users table
    const { data: newUser, error: userError } = await supabase
      .from("users")
      .insert([
        {
          name,
          email,
          password: hashedPassword,
          role,
          is_verified: false,
          verification_token: verificationToken,
          verification_token_expires: verificationTokenExpires
        },
      ])
      .select()
      .single();

    if (userError) throw userError;

    // 4. Fetch short_code using courseId
    let courseCodeStr = "GEN";
    if (courseId) {
      const { data: courseData } = await supabase
        .from("courses")
        .select("short_code")
        .eq("id", courseId)
        .single();
      if (courseData) courseCodeStr = courseData.short_code;
    }

    // 5. Generate Custom ID and Create user details in respective table
    const generatedId = await generateUserId(role, courseCodeStr);
    let detailsError;

    const { error } = await supabase.from("student_details").insert([
      {
        user_id: newUser.id,
        student_id: generatedId,
        program_id: courseId || null,
        year: new Date().getFullYear(),
      },
    ]);
    detailsError = error;

    if (detailsError) {
      // Rollback user creation if details fail (optional but good practice)
      await supabase.from("users").delete().eq("id", newUser.id);
      throw detailsError;
    }

    // 5. Send Verification Email
    const clientUrl = process.env.STUDENT_CLIENT_URL;
    const verifyLink = `${process.env.API_URL}/api/auth/verify-email/${verificationToken}`;

    let html = loadTemplate("Email-Verification.html");
    html = replacePlaceholders(html, {
      VERIFY_LINK: verifyLink,
    });

    sendEmail(
      email,
      "Verify your Trespics School Account",
      html,
    );

    const registrationDateStr = new Date().toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    // Notify admins
    await notifyAdminsNewRegistration(
      name,
      email,
      "student",
      courseCodeStr,
      registrationDateStr,
      `${process.env.ADMIN_CLIENT_URL}/dashboard`,
    );

    res.status(201).json({
      message:
        "Registration successful. Your account will be verified by an admin.",
      userId: generatedId,
    });
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(500).json({ error: "Registration failed: " + error.message });
  }
};

/* ================================
   REGISTER TEACHER
================================ */

export const registerTeacher = async (req, res) => {
  try {
    const { name, email, password, department_id } = req.body;

    // Validate fields
    if (!name || !email || !password || !department_id) {
      return res.status(400).json({ error: "All fields are required." });
    }
    // Check if email exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("email")
      .eq("email", email)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: "Email already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = generateVerificationToken();
    const verificationTokenExpires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes

    // Create user in users table
    const { data: newUser, error: userError } = await supabase
      .from("users")
      .insert([
        {
          name,
          email,
          password: hashedPassword,
          role: "teacher",
          is_verified: false,
          verification_token: verificationToken,
          verification_token_expires: verificationTokenExpires
        },
      ])
      .select()
      .single();

    if (userError) throw userError;

    // Upload files to GCS
    // let nationalIdPhotoUrl = null;
    // let profilePhotoUrl = null;

    // if (req.files) {
    //   if (req.files.nationalIdPhoto && req.files.nationalIdPhoto[0]) {
    //     nationalIdPhotoUrl = await uploadToGCS(req.files.nationalIdPhoto[0]);
    //   }
    //   if (req.files.profilePhoto && req.files.profilePhoto[0]) {
    //     profilePhotoUrl = await uploadToGCS(req.files.profilePhoto[0]);
    //   }
    // }

    // Generate Custom ID
    const generatedId = await generateUserId("teacher", department_id);

    // Create teacher_details
    const { error: detailsError } = await supabase
      .from("teacher_details")
      .insert([
        {
          user_id: newUser.id,
          teacher_id: generatedId,
          department_id: department_id,
          // national_id_number,
          // national_id_photo_url: nationalIdPhotoUrl,
          // profile_photo_url: profilePhotoUrl,
        },
      ]);

    // Rollback if details fail
    if (detailsError) {
      await supabase.from("users").delete().eq("id", newUser.id);
      throw detailsError;
    }

    // Fetch department name for email
    let deptName = "N/A";
    if (department_id) {
      const { data: dept } = await supabase
        .from("department")
        .select("name")
        .eq("id", department_id)
        .single();
      if (dept) deptName = dept.name;
    }

    // Format date
    const registrationDateStr = new Date().toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    // After inserting teacher_details
    const clientUrl = process.env.TEACHER_CLIENT_URL;
    const verifyLink = `${process.env.API_URL || 'http://localhost:5000'}/api/auth/verify-email/${verificationToken}`;

    let html = loadTemplate("Email-Verification.html");
    html = replacePlaceholders(html, {
      VERIFY_LINK: verifyLink,
    });

    try {
      sendEmail(
        email,
        "Verify your Trespics School Account",
        html,
      );
    } catch (err) {
      console.error("Teacher registration email failed:", err.message);
    }
    // Notify Admins
    await notifyAdminsNewRegistration(
      name,
      email,
      "teacher",
      deptName,
      registrationDateStr,
      `${process.env.ADMIN_CLIENT_URL}/dashboard`,
    );

    // Success response
    res.status(201).json({
      message: "Teacher registration successful. Awaiting admin verification.",
      teacher_id: generatedId,
    });
  } catch (error) {
    console.error("Teacher Registration Error:", error);
    res.status(500).json({ error: "Registration failed: " + error.message });
  }
};

/* ================================
   VERIFY EMAIL
================================ */

export const verifyEmail = async (req, res) => {
  const { token } = req.params;

  try {
    // 1. Find user by token
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("verification_token", token)
      .single();

    if (!user) {
      return res.status(400).send("Invalid verification token.");
    }

    // 2. Check if token expired
    if (new Date(user.verification_token_expires) < new Date()) {
      return res.status(400).send("Verification token has expired.");
    }

    // 3. Mark as verified and clear token
    const { error: updateError } = await supabase
      .from("users")
      .update({
        is_verified: true,
        verification_token: null,
        verification_token_expires: null
      })
      .eq("id", user.id);

    if (updateError) throw updateError;

    // 4. Fetch the ID generated during registration
    let userSystemId = null;
    let deptName = "N/A";
    
    if (user.role === "student") {
      const { data: details } = await supabase
        .from("student_details")
        .select("student_id")
        .eq("user_id", user.id)
        .single();
      userSystemId = details?.student_id;
    } else if (user.role === "teacher") {
      const { data: details } = await supabase
        .from("teacher_details")
        .select("teacher_id, department_id")
        .eq("user_id", user.id)
        .single();
      userSystemId = details?.teacher_id;
      
      // Fetch department name if teacher
      if (details?.department_id) {
        const { data: dept } = await supabase
          .from("department")
          .select("name")
          .eq("id", details.department_id)
          .single();
        if (dept) deptName = dept.name;
      }
    }

    // 5. Send Admission email
    if (userSystemId) {
      let html = loadTemplate("Admission-email.html");
      html = replacePlaceholders(html, {
        USER_ID: userSystemId,
        DEPARTMENT: deptName,
      });

      sendEmail(
        user.email,
        "Welcome to Trespics School - Admission Successful",
        html,
      );
    }

    // 6. Redirect to login
    const clientUrl = (() => {
      switch (user.role) {
        case "student": return process.env.STUDENT_CLIENT_URL;
        case "teacher": return process.env.TEACHER_CLIENT_URL;
        case "admin": return process.env.ADMIN_CLIENT_URL;
        default: return process.env.STUDENT_CLIENT_URL;
      }
    })();

    res.redirect(`${clientUrl}/auth/login?verified=true`);
  } catch (error) {
    console.error("Email Verification Error:", error);
    res.status(500).send("Email verification failed: " + error.message);
  }
};

/* ================================
   LOGIN
================================ */

export const login = async (req, res) => {
  const { userId, password } = req.body;

  try {
    let user;

    // Check if input is email or custom ID
    if (userId.includes("@")) {
      // Login via Email
      const { data } = await supabase
        .from("users")
        .select("*")
        .eq("email", userId)
        .single();
      user = data;
    } else {
      // Login via Custom ID (Student/Teacher/Admin ID)
      // Try Student Details
      let { data: idData } = await supabase
        .from("student_details")
        .select("user_id")
        .eq("student_id", userId)
        .single();

      if (!idData) {
        // Try Teacher Details
        const { data: teacherData } = await supabase
          .from("teacher_details")
          .select("user_id")
          .eq("teacher_id", userId)
          .single();
        idData = teacherData;
      }

      if (!idData) {
        // Try Admin Details
        const { data: adminData } = await supabase
          .from("admin_details")
          .select("user_id")
          .eq("admin_id", userId)
          .single();
        idData = adminData;
      }

      if (idData) {
        const { data } = await supabase
          .from("users")
          .select("*")
          .eq("id", idData.user_id)
          .single();
        user = data;
      }
    }

    if (!user) return res.status(400).json({ error: "Invalid credentials" });
    if (!user.is_verified)
      return res.status(403).json({ error: "Verify email first" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Store refresh token in DB
    await supabase.from("refresh_tokens").insert([
      {
        user_id: user.id,
        token: refreshToken,
      },
    ]);

    // Fetch details to return with user object (optional, for frontend display)
    let details = {};
    if (user.role === "student") {
      const { data } = await supabase
        .from("student_details")
        .select("*")
        .eq("user_id", user.id)
        .single();
      details = data || {};
      if (details.student_id) details.user_id = details.student_id;
    } else if (user.role === "teacher") {
      const { data } = await supabase
        .from("teacher_details")
        .select("*")
        .eq("user_id", user.id)
        .single();
      details = data || {};
      if (details.teacher_id) details.user_id = details.teacher_id;
    } else if (user.role === "admin") {
      const { data } = await supabase
        .from("admin_details")
        .select("*")
        .eq("user_id", user.id)
        .single();
      details = data || {};
      if (details.admin_id) details.user_id = details.admin_id;
    }

    res.json({ accessToken, refreshToken, user: { ...user, ...details } });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ error: "Login failed" });
  }
};

/* ================================
   GET DEPARTMENTS
================================ */

export const getDepartments = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("department")
      .select("id, name")
      .order("name");
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Fetch Departments Error:", error);
    res.status(500).json({ error: "Failed to fetch departments" });
  }
};

/* ================================
   REFRESH TOKEN
================================ */

export const refreshToken = async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const { data: storedToken } = await supabase
      .from("refresh_tokens")
      .select("*")
      .eq("token", token)
      .single();

    if (!storedToken)
      return res.status(403).json({ error: "Invalid refresh token" });

    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", decoded.id)
      .single();

    const newAccessToken = generateAccessToken(user);
    res.json({ accessToken: newAccessToken });
  } catch (error) {
    console.error("Refresh Token Error:", error);
    res.status(403).json({ error: "Invalid or expired refresh token" });
  }
};

/* ================================
   FORGOT PASSWORD
================================ */

export const forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (!user) {
      // For security, don't reveal if user exists
      return res.json({
        message:
          "If an account with that email exists, a reset link has been sent.",
      });
    }

    const resetToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: "30m",
    });

    // 3️⃣ Choose frontend URL based on user role
    const getClientUrl = (role) => {
      switch (role) {
        case "student":
          return process.env.STUDENT_CLIENT_URL;
        case "teacher":
          return process.env.TEACHER_CLIENT_URL;
        case "admin":
          return process.env.ADMIN_CLIENT_URL;
        default:
          return process.env.STUDENT_CLIENT_URL; // fallback
      }
    };

    const clientUrl = getClientUrl(user.role);

    // 4️⃣ Construct reset link
    const resetLink = `${clientUrl}/auth/reset-password?token=${resetToken}`;

    let html = loadTemplate("Reset-email.html");
    html = replacePlaceholders(html, {
      RESET_LINK: resetLink,
    });

    sendEmail(email, "Reset Your Trespics Password", html);

    res.json({
      message:
        "If an account with that email exists, a reset link has been sent.",
    });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    res
      .status(500)
      .json({ error: "Failed to process forgot password request" });
  }
};

/* ================================
   RESET PASSWORD
================================ */

export const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const { error } = await supabase
      .from("users")
      .update({ password: hashedPassword })
      .eq("id", decoded.id);

    if (error) throw error;

    res.json({ message: "Password reset successful. You can now login." });
  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(400).json({ error: "Invalid or expired reset token" });
  }
};

/* ================================
   LOGOUT
================================ */

export const logout = async (req, res) => {
  const { token } = req.body;

  try {
    if (token) {
      const { error } = await supabase.from("refresh_tokens").delete().eq("token", token);
      if (error) {
        console.error("[Auth] Logout - failed to delete refresh token:", error.message);
      }
    }

    console.log("[Auth] User logged out successfully");
    res.json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("[Auth] Logout error:", error.message);
    res.status(500).json({ error: "Logout failed" });
  }
};

/* ================================
   UPDATE PROFILE
================================ */

export const updateProfile = async (req, res) => {
  const { name, email, password } = req.body;
  const userId = req.user.id;

  try {
    const updates = {};
    if (name) updates.name = name;
    if (email) {
      // Check if email is already taken by another user
      const { data: existingUser } = await supabase
        .from("users")
        .select("id")
        .eq("email", email)
        .neq("id", userId)
        .single();

      if (existingUser) {
        return res.status(400).json({ error: "Email already in use" });
      }
      updates.email = email;
    }
    if (password) {
      updates.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const { data: updatedUser, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: "Profile updated successfully",
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
      },
    });
  } catch (error) {
    console.error("Update Profile Error:", error);
    res.status(500).json({ error: "Failed to update profile" });
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

    const { error } = await supabase
      .from("teacher_details")
      .update(updates)
      .eq("user_id", userId);

    if (error) throw error;

    console.log(`[Auth] Teacher profile updated for user ${userId}`);
    res.json({ message: "Profile updated successfully" });
  } catch (err) {
    console.error("[Auth] Update teacher profile error:", err.message);
    res.status(500).json({ error: "Failed to update teacher profile" });
  }
};


/* ================================
   ADMIN SELF-REGISTRATION
================================ */

export const registerAdminSelf = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validate fields
    if (!name || !email || !password) {
      return res.status(400).json({ error: "All fields are required." });
    }

    // Check if email already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("email")
      .eq("email", email)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: "Email already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate verification token
    const verificationToken = generateVerificationToken();
    const verificationTokenExpires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes

    // Insert admin user with unverified status
    const { data: newUser, error: userError } = await supabase
      .from("users")
      .insert([
        {
          name,
          email,
          password: hashedPassword,
          role: "admin",
          is_verified: false,
          verification_token: verificationToken,
          verification_token_expires: verificationTokenExpires,
        },
      ])
      .select()
      .single();

    if (userError) throw userError;

    // Generate Custom Admin ID
    const generatedId = await generateUserId("admin", "GEN");

    // Insert into admin_details table
    const { error: detailsError } = await supabase
      .from("admin_details")
      .insert([
        {
          user_id: newUser.id,
          admin_id: generatedId,
        },
      ]);

    if (detailsError) {
      await supabase.from("users").delete().eq("id", newUser.id);
      throw detailsError;
    }

    // Send Verification Email
    const verifyLink = `${process.env.API_URL}/api/auth/verify-email/${verificationToken}`;
    let html = loadTemplate("Email-Verification.html");
    html = replacePlaceholders(html, { VERIFY_LINK: verifyLink });

    sendEmail(email, "Verify your Admin Account", html);

    res.status(201).json({
      message:
        "Admin registration successful. Please check your email to verify your account.",
      adminId: generatedId,
    });
  } catch (error) {
    console.error("Admin Self-Registration Error:", error);
    res.status(500).json({ error: "Registration failed: " + error.message });
  }
};