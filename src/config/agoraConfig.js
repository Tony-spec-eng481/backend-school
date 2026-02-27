import dotenv from "dotenv";
import pkg from 'agora-access-token';
const { RtcTokenBuilder, RtcRole, RtmTokenBuilder, RtmRole } = pkg;

dotenv.config();

export const APP_ID = process.env.AGORA_APP_ID;
export const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

// Screen share UIDs are offset by this amount from regular UIDs
export const SCREEN_SHARE_UID_OFFSET = 100000;

/**
 * Generate an RTC token for joining a video/audio channel.
 * Both teachers and students get PUBLISHER role so both can stream video/audio.
 * @param {string} channelName - The Agora channel name
 * @param {number} uid - User ID (0 = auto-assign)
 * @param {string} role - "publisher" or "subscriber"
 * @param {number} expireSeconds - Token TTL in seconds
 * @returns {string} The RTC token
 */
export const generateAgoraToken = (
  channelName,
  uid = 0,
  role = "publisher",
  expireSeconds = 3600,
) => {
  if (!APP_ID || !APP_CERTIFICATE) {
    console.error(
      "CRITICAL ERROR: AGORA_APP_ID or AGORA_APP_CERTIFICATE is missing in .env file."
    );
    return "mock-token-" + Math.random().toString(36).substring(7);
  }

  const roleEnum =
    role === "publisher" ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpireTime = currentTimestamp + expireSeconds;

  const token = RtcTokenBuilder.buildTokenWithUid(
    APP_ID,
    APP_CERTIFICATE,
    channelName,
    uid,
    roleEnum,
    privilegeExpireTime,
  );

  return token;
};

/**
 * Generate a dedicated screen share token.
 * Screen sharing uses a separate Agora client with a different UID
 * (regular UID + SCREEN_SHARE_UID_OFFSET) so it needs its own token.
 *
 * @param {string} channelName - The Agora channel name
 * @param {number} regularUid - The user's regular numeric UID
 * @param {number} expireSeconds - Token TTL in seconds
 * @returns {{ token: string, screenShareUid: number }} Token and the screen share UID
 */
export const generateScreenShareToken = (
  channelName,
  regularUid,
  expireSeconds = 3600,
) => {
  const screenShareUid = regularUid + SCREEN_SHARE_UID_OFFSET;
  const token = generateAgoraToken(channelName, screenShareUid, "publisher", expireSeconds);
  return { token, screenShareUid };
};

/**
 * Generate an RTM token for the Agora RTM (Real-Time Messaging) system.
 * Used for chat functionality in the live class room.
 * @param {string} userId - A string user identifier
 * @param {number} expireSeconds - Token TTL in seconds
 * @returns {string} The RTM token
 */
export const generateRtmToken = (userId, expireSeconds = 3600) => {
  if (!APP_ID || !APP_CERTIFICATE) {
    console.error(
      "CRITICAL ERROR: AGORA_APP_ID or AGORA_APP_CERTIFICATE is missing in .env file."
    );
    return "mock-rtm-token-" + Math.random().toString(36).substring(7);
  }

  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpireTime = currentTimestamp + expireSeconds;

  const token = RtmTokenBuilder.buildToken(
    APP_ID,
    APP_CERTIFICATE,
    userId,
    RtmRole.Rtm_User,
    privilegeExpireTime,
  );

  return token;
};
