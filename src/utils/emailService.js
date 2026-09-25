/**
 * A&C SOLUTIONS PVT. LTD. — ATTENDANCE EMAIL SERVICE
 * Handles Gmail SMTP transport, Indian Standard Time formatting,
 * dynamic working hours computation, and transactional notifications.
 */

const nodemailer = require('nodemailer');
const environment = require('../config/environment');
const logger = require('./logger');

let customTransporter = null;

/**
 * Format a Date object or string into Indian Standard Time date
 * Example: "September 18, 2026"
 */
function formatISTDate(dateInput) {
  if (!dateInput) return '—';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(d);
}

/**
 * Format a Date object or string into Indian Standard Time 12-hour time
 * Example: "09:42:15 AM"
 */
function formatISTTime(dateInput) {
  if (!dateInput) return '—';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(d);
}

/**
 * Calculate total working hours and minutes from check-in and check-out timestamps
 * Example: "8 hours 35 minutes"
 */
function calculateWorkingHours(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 'N/A';
  const start = new Date(checkIn).getTime();
  const end = new Date(checkOut).getTime();
  if (isNaN(start) || isNaN(end) || end < start) return 'N/A';

  const diffMs = end - start;
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const hourText = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const minuteText = `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  return `${hourText} ${minuteText}`;
}

/**
 * Obtain or create the active Nodemailer transporter
 */
function getTransporter() {
  if (customTransporter) {
    return customTransporter;
  }

  const user = environment.emailUser;
  const pass = environment.emailAppPassword;

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host: environment.smtpHost || 'smtp.gmail.com',
    port: environment.smtpPort || 587,
    secure: environment.smtpSecure === true,
    auth: { user, pass }
  });
}

/**
 * Override the transporter (used primarily for automated test mocks)
 */
function setTransporter(transporter) {
  customTransporter = transporter;
}

/**
 * Sanitize strings for safe embedding into HTML emails
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

/**
 * Send an automated attendance email notification (check-in or check-out)
 * 
 * @param {Object} options
 * @param {string} options.employeeEmail - Registered email address of employee
 * @param {string} options.employeeName - Employee display name
 * @param {string} options.type - 'check-in' or 'check-out'
 * @param {Date|string} [options.date] - Attendance date
 * @param {Date|string} [options.time] - Timestamp of current action
 * @param {Date|string} [options.checkInTime] - Check-in timestamp
 * @param {Date|string} [options.checkOutTime] - Check-out timestamp
 * @param {string} [options.workingHours] - Calculated duration string
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function sendAttendanceEmail(options) {
  const {
    employeeEmail,
    employeeName = 'Employee',
    type,
    date = new Date(),
    time,
    checkInTime,
    checkOutTime,
    workingHours,
    loginDuration
  } = options || {};

  if (!employeeEmail) {
    logger.warn('Email notification skipped: No registered employee email provided.');
    return { success: false, error: 'Employee email missing' };
  }

  const transporter = getTransporter();
  if (!transporter) {
    logger.warn('Email notification skipped: EMAIL_USER or EMAIL_APP_PASSWORD is not configured.');
    return { success: false, error: 'Email service credentials not configured' };
  }

  const isCheckIn = type === 'check-in';
  const actionTitle = isCheckIn ? 'Check-In Confirmation' : 'Check-Out Confirmation';
  const statusHeadline = isCheckIn ? 'Check-In Successful' : 'Check-Out Successful';
  const statusBadgeColor = isCheckIn ? '#16a34a' : '#2563eb';
  const statusBadgeBg = isCheckIn ? '#dcfce7' : '#dbeafe';

  const formattedDate = formatISTDate(date);
  const formattedCheckIn = formatISTTime(checkInTime || (isCheckIn ? (time || date) : null));
  const formattedCheckOut = !isCheckIn ? formatISTTime(checkOutTime || time || date) : null;

  let computedWorkingHours = workingHours;
  if (!isCheckIn && !computedWorkingHours && checkInTime && (checkOutTime || time)) {
    computedWorkingHours = calculateWorkingHours(checkInTime, checkOutTime || time);
  }

  const safeName = escapeHtml(employeeName);

  // Email subject line
  const subject = `A&C Solutions - ${actionTitle}`;

  // Plain text fallback body
  let textBody = `A&C Solutions\n${statusHeadline}\n\n`;
  textBody += `Hello ${employeeName},\n\n`;
  textBody += `Your ${isCheckIn ? 'check-in' : 'check-out'} has been successfully recorded.\n\n`;
  textBody += `Date: ${formattedDate}\n`;
  textBody += `Check-In Time: ${formattedCheckIn}\n`;
  if (!isCheckIn) {
    textBody += `Check-Out Time: ${formattedCheckOut}\n`;
    textBody += `Total Working Hours (Check-in to Check-out): ${computedWorkingHours || 'N/A'}\n`;
    textBody += `Total Working Duration: ${loginDuration || 'N/A'}\n`;
  }
  textBody += `\nThis is an automated attendance notification from A&C Solutions.\n\n`;
  textBody += `Regards,\nA&C Solutions Pvt. Ltd.\n`;

  // Professional HTML Email with inline CSS
  const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; -webkit-font-smoothing: antialiased;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f1f5f9; padding: 24px 12px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.05); border: 1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%); padding: 28px 32px; text-align: left;">
              <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; color: #ffffff;">
                A&amp;C SOLUTIONS
              </h1>
              <p style="margin: 4px 0 0 0; font-size: 12px; color: #93c5fd; letter-spacing: 0.8px; text-transform: uppercase;">
                Employee Attendance System
              </p>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 32px 24px 32px;">
              <!-- Status Pill -->
              <div style="display: inline-block; padding: 6px 14px; background-color: ${statusBadgeBg}; color: ${statusBadgeColor}; font-size: 13px; font-weight: 600; border-radius: 9999px; margin-bottom: 20px;">
                ✓ ${escapeHtml(statusHeadline)}
              </div>

              <!-- Salutation & Summary -->
              <h2 style="margin: 0 0 12px 0; font-size: 18px; font-weight: 600; color: #0f172a;">
                Hello ${safeName},
              </h2>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                Your ${isCheckIn ? 'check-in' : 'check-out'} has been successfully recorded in the attendance system.
              </p>

              <!-- Attendance Data Table -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; border-collapse: separate; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #64748b; width: 40%;">Date</td>
                  <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(formattedDate)}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; ${!isCheckIn ? 'border-bottom: 1px solid #e2e8f0;' : ''} font-size: 13px; color: #64748b;">Check-In Time</td>
                  <td style="padding: 12px 16px; ${!isCheckIn ? 'border-bottom: 1px solid #e2e8f0;' : ''} font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(formattedCheckIn)} (IST)</td>
                </tr>
                ${!isCheckIn ? `
                <tr>
                  <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #64748b;">Check-Out Time</td>
                  <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(formattedCheckOut)} (IST)</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #64748b;">Total Working Hours</td>
                  <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-size: 14px; font-weight: 700; color: #16a34a;">${escapeHtml(computedWorkingHours || 'N/A')}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; font-size: 13px; color: #64748b;">Total Working Duration</td>
                  <td style="padding: 12px 16px; font-size: 14px; font-weight: 700; color: #2563eb;">${escapeHtml(loginDuration || 'N/A')}</td>
                </tr>
                ` : ''}
              </table>

              <!-- Notice -->
              <p style="margin: 0 0 20px 0; font-size: 12px; line-height: 1.5; color: #94a3b8;">
                This is an automated attendance notification from A&amp;C Solutions.
              </p>

              <!-- Closing -->
              <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #334155;">
                Regards,<br>
                <strong style="color: #0f172a;">A&amp;C Solutions Pvt. Ltd.</strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 16px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #94a3b8;">
                &copy; ${new Date().getFullYear()} A&amp;C Solutions Pvt. Ltd. All rights reserved. &bull; Timezone: Asia/Kolkata (IST)
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const mailOptions = {
    from: `"A&C Solutions Attendance" <${environment.emailFrom || environment.emailUser}>`,
    to: employeeEmail,
    subject,
    text: textBody,
    html: htmlBody
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Attendance email (${type}) sent successfully to ${employeeEmail}. MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error(`Attendance email delivery failed for ${employeeEmail}:`, err.message);
    return { success: false, error: err.message };
  }
}


/**
 * Send one consolidated attendance email for the whole working day.
 * This is the default mode so multiple check-in/check-out sessions do not
 * fill an employee's inbox with separate messages.
 */
async function sendDailyAttendanceSummaryEmail(options) {
  const {
    employeeEmail,
    employeeName = 'Employee',
    date = new Date(),
    sessions = [],
    totalWorkingDuration = '0h 00m',
    overtime = '0h 00m',
    status = 'present'
  } = options || {};

  if (!employeeEmail) return { success: false, error: 'Employee email missing' };
  const transporter = getTransporter();
  if (!transporter) return { success: false, error: 'Email service credentials not configured' };

  const formattedDate = formatISTDate(date);
  const safeName = escapeHtml(employeeName);
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const sessionRows = safeSessions.length ? safeSessions.map((session, index) => {
    const cin = formatISTTime(session.checkIn);
    const cout = session.checkOut ? formatISTTime(session.checkOut) : 'Not checked out';
    const duration = session.checkOut ? calculateWorkingHours(session.checkIn, session.checkOut) : 'Active';
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;">Session ${index + 1}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;">${escapeHtml(cin)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;">${escapeHtml(cout)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:600;">${escapeHtml(duration)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="4" style="padding:14px;color:#64748b;">No work sessions recorded.</td></tr>`;

  const subject = `A&C Solutions - Daily Attendance Summary - ${formattedDate}`;
  const textSessions = safeSessions.map((session, index) =>
    `Session ${index + 1}: ${formatISTTime(session.checkIn)} - ${session.checkOut ? formatISTTime(session.checkOut) : 'Not checked out'} (${session.checkOut ? calculateWorkingHours(session.checkIn, session.checkOut) : 'Active'})`
  ).join('\n');
  const textBody = `A&C Solutions\nDaily Attendance Summary\n\nHello ${employeeName},\n\nDate: ${formattedDate}\nStatus: ${status}\n\n${textSessions || 'No work sessions recorded.'}\n\nTotal Working Duration: ${totalWorkingDuration}\nOvertime: ${overtime}\n\nThis is one consolidated automated attendance notification for the day.\n\nRegards,\nA&C Solutions Pvt. Ltd.`;

  const htmlBody = `<!DOCTYPE html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#1e293b;padding:24px 12px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table width="100%" style="max-width:650px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
    <tr><td style="background:#0f172a;padding:24px 28px;color:#fff"><strong style="font-size:20px">A&amp;C SOLUTIONS</strong><div style="font-size:12px;color:#93c5fd;margin-top:4px">DAILY ATTENDANCE SUMMARY</div></td></tr>
    <tr><td style="padding:28px"><h2 style="margin:0 0 10px">Hello ${safeName},</h2><p style="color:#475569">Here is your consolidated attendance record for ${escapeHtml(formattedDate)}.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-top:20px"><tr style="background:#f8fafc"><th align="left" style="padding:10px 12px">Session</th><th align="left" style="padding:10px 12px">Check-In</th><th align="left" style="padding:10px 12px">Check-Out</th><th align="left" style="padding:10px 12px">Duration</th></tr>${sessionRows}</table>
      <table width="100%" style="margin-top:20px"><tr><td style="padding:8px 0;color:#64748b">Total Working Duration</td><td align="right" style="font-weight:700">${escapeHtml(totalWorkingDuration)}</td></tr><tr><td style="padding:8px 0;color:#64748b">Overtime</td><td align="right" style="font-weight:700">${escapeHtml(overtime)}</td></tr></table>
      <p style="margin-top:24px;color:#64748b;font-size:13px">This is one consolidated automated attendance notification for the day, so separate check-in/check-out emails are not sent in summary mode.</p>
    </td></tr></table></td></tr></table></body></html>`;

  try {
    const info = await transporter.sendMail({ from: environment.emailFrom || environment.emailUser, to: employeeEmail, subject, text: textBody, html: htmlBody });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error(`Daily attendance summary email failed for ${employeeEmail}:`, error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendAttendanceEmail,
  sendDailyAttendanceSummaryEmail,
  formatISTDate,
  formatISTTime,
  calculateWorkingHours,
  getTransporter,
  setTransporter
};
