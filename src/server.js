const app = require('./app');
const environment = require('./config/environment');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const logger = require('./utils/logger'); const { enforceAbsentForToday, sendDailyAttendanceSummaries } = require('./controllers/workspaceController');

let server = null;

async function startServer() {
  try {
    await connectDatabase();

    const attendanceTimer = setInterval(() => enforceAbsentForToday().catch(err => logger.warn('Attendance auto-mark check failed:', err.message)), 60 * 1000);
    attendanceTimer.unref?.();

    // In summary mode, send at most one consolidated attendance email per employee per day.
    // The default is 23:55 IST; configure ATTENDANCE_SUMMARY_HOUR/MINUTE in .env if needed.
    const emailSummaryTimer = setInterval(async () => {
      if (environment.attendanceEmailMode !== 'summary') return;
      try {
        const nowParts = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
        const hour=Number(nowParts.find(x=>x.type==='hour')?.value||-1);
        const minute=Number(nowParts.find(x=>x.type==='minute')?.value||-1);
        if(hour===environment.attendanceSummaryHour && minute===environment.attendanceSummaryMinute){
          const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
          const result=await sendDailyAttendanceSummaries(date);
          if(result.sent) logger.info(`Attendance email summary sent: ${result.sent} employee(s).`);
        }
      } catch(err) {
        logger.warn('Attendance email summary job failed:', err.message);
      }
    }, 60 * 1000);
    emailSummaryTimer.unref?.();

    server = app.listen(environment.port, () => {
      logger.info(`=======================================================`);
      logger.info(`A&C SOLUTIONS PVT. LTD. — BACKEND SERVER ACTIVE`);
      logger.info(`Server URL: http://localhost:${environment.port}`);
      logger.info(`Environment: ${environment.nodeEnv}`);
      logger.info(`Health check: http://localhost:${environment.port}/api/health`);
      logger.info(`=======================================================`);
    });

    const shutdown = async (signal) => {
      logger.info(`Received ${signal}. Gracefully shutting down...`);
      if (server) {
        clearInterval(attendanceTimer);
        clearInterval(emailSummaryTimer);
        server.close(async () => {
          logger.info('HTTP server closed.');
          await disconnectDatabase();
          process.exit(0);
        });
      } else {
        await disconnectDatabase();
        process.exit(0);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    return server;
  } catch (error) {
    logger.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer
};
