import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const ZOOM_ACCOUNT_ID = process.env.ZOOM_ACCOUNT_ID;
const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;

// ─── Token Cache ────────────────────────────────────────────────────────
let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Get a Zoom OAuth access token using Server-to-Server OAuth (account credentials).
 * Tokens are cached for ~55 minutes (Zoom tokens last 1 hour).
 * @returns {Promise<string>} Access token
 */
export const getZoomAccessToken = async () => {
  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedToken;
  }

  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error(
      "CRITICAL: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, or ZOOM_CLIENT_SECRET is missing in .env"
    );
  }

  const credentials = Buffer.from(
    `${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`
  ).toString("base64");

  const res = await axios.post(
    "https://zoom.us/oauth/token",
    null,
    {
      params: {
        grant_type: "account_credentials",
        account_id: ZOOM_ACCOUNT_ID,
      },
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  cachedToken = res.data.access_token;
  tokenExpiresAt = Date.now() + res.data.expires_in * 1000;

  return cachedToken;
};

/**
 * Create a Zoom meeting via the Zoom REST API.
 * @param {string} topic - Meeting title
 * @param {string} startTime - ISO 8601 start time
 * @param {number} durationMinutes - Duration in minutes
 * @param {object} [options] - Additional meeting settings
 * @returns {Promise<object>} Zoom meeting object with id, join_url, start_url, password, etc.
 */
export const createZoomMeeting = async (
  topic,
  startTime,
  durationMinutes = 60,
  options = {}
) => {
  const token = await getZoomAccessToken();

  const meetingData = {
    topic,
    type: 2, // Scheduled meeting
    start_time: startTime,
    duration: durationMinutes,
    timezone: "Africa/Nairobi",
    settings: {
      host_video: true,
      participant_video: true,
      join_before_host: false,
      mute_upon_entry: true,
      waiting_room: false,
      auto_recording: "none",
      meeting_authentication: false,
      ...options,
    },
  };

  const res = await axios.post(
    "https://api.zoom.us/v2/users/me/meetings",
    meetingData,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  return res.data;
};

/**
 * Delete a Zoom meeting by its ID.
 * @param {number|string} meetingId - Zoom meeting ID
 */
export const deleteZoomMeeting = async (meetingId) => {
  const token = await getZoomAccessToken();

  await axios.delete(
    `https://api.zoom.us/v2/meetings/${meetingId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
};

/**
 * Get Zoom meeting details by its ID.
 * @param {number|string} meetingId - Zoom meeting ID
 * @returns {Promise<object>} Meeting details
 */
export const getZoomMeetingDetails = async (meetingId) => {
  const token = await getZoomAccessToken();

  const res = await axios.get(
    `https://api.zoom.us/v2/meetings/${meetingId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return res.data;
};
