require('dotenv').config();

const environment = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  mongodbUri: process.env.MONGODB_URI || '',
  jwtSecret: process.env.JWT_SECRET || 'dev_jwt_secret_ac_solutions_pvtd_ltd_key_32bytes_long!',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, ''),
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map(v => v.trim().replace(/\/$/, '')).filter(Boolean),
  adminUsername: (process.env.ADMIN_USERNAME || 'admin').trim(),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionCookieName: 'ac_session',
  sessionCookieMaxAge: 7 * 24 * 60 * 60 * 1000,
  cookieSameSite: process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax'),
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : (process.env.NODE_ENV === 'production' ? 1 : 0),
  emailUser: (process.env.EMAIL_USER || process.env.SMTP_USER || '').trim(),
  emailAppPassword: (process.env.EMAIL_APP_PASSWORD || process.env.SMTP_PASS || '').trim(),
  emailFrom: (process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.SMTP_USER || '').trim(),
  smtpHost: (process.env.SMTP_HOST || 'smtp.gmail.com').trim(),
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpSecure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  attendanceEmailMode: (process.env.ATTENDANCE_EMAIL_MODE || 'checkout').trim().toLowerCase(),
  attendanceSummaryHour: Math.min(23, Math.max(0, Number(process.env.ATTENDANCE_SUMMARY_HOUR || 23))),
  attendanceSummaryMinute: Math.min(59, Math.max(0, Number(process.env.ATTENDANCE_SUMMARY_MINUTE || 55)))
};

if (environment.isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  console.error('FATAL ERROR: JWT_SECRET must be at least 32 characters in production.');
  process.exit(1);
}
if (!['lax','strict','none'].includes(environment.cookieSameSite)) {
  console.error('FATAL ERROR: COOKIE_SAMESITE must be lax, strict, or none.');
  process.exit(1);
}

module.exports = environment;
