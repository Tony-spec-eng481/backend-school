// utils/email.js

import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

/**
 * Send Email using Brevo API
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - Email body (HTML)
 */
export const sendEmail = async (to, subject, html) => {
  try {
    const response = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: {
          name: "Trespics School",
          email: process.env.EMAIL_FROM, // MUST be verified in Brevo
        },
        to: [
          {
            email: to,
          },
        ],
        subject: subject,
        htmlContent: html,
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json",
        },
        timeout: 10000, // 10 seconds safety timeout
      },
    );

    console.log(`Brevo email sent to ${to}`);
    return response.data;
  } catch (error) {
    console.error(
      `Brevo failed to send email to ${to}:`,
      error.response?.data || error.message,
    );
    throw error;
  }
};
