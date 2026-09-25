/**
 * A&C SOLUTIONS PVT. LTD. — ATTENDANCE EMAIL NOTIFICATION TEST SUITE
 * Tests:
 * 1. Unit tests for IST Date & Time formatting and working hours duration calculation.
 * 2. Employee check-in -> Saves to MongoDB -> Sends check-in email.
 * 3. Employee check-out -> Saves to MongoDB -> Computes working hours -> Sends check-out email.
 * 4. Email failure resilience -> MongoDB attendance preserved -> Sensible API response.
 * 5. Edge cases: duplicate check-in, duplicate check-out, checkout before check-in.
 * 6. Auth guards: unauthenticated and unauthorized requests rejected with NO email.
 */

const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const User = require('../src/models/User');
const Attendance = require('../src/models/Attendance');
const {
  formatISTDate,
  formatISTTime,
  calculateWorkingHours,
  setTransporter
} = require('../src/utils/emailService');

let server;
let baseUrl;

function request(method, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    if (options.cookie) {
      reqOptions.headers['Cookie'] = options.cookie;
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json || data
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

function extractCookie(headers) {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return '';
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return cookieStr.split(';')[0];
}

async function runEmailTests() {
  console.log('\n=============================================================');
  console.log('STARTING ATTENDANCE EMAIL NOTIFICATION TEST SUITE');
  console.log('=============================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      process.stdout.write(`• Testing: ${name}... `);
      await fn();
      console.log('✓ PASS');
      passed++;
    } catch (err) {
      console.log('✕ FAIL');
      console.error(`  Error: ${err.message}\n`, err.stack);
      failed++;
    }
  }

  // Mock transporter for tracking sent emails
  const sentEmails = [];
  let shouldFailEmail = false;

  const mockTransporter = {
    sendMail: async (mailOptions) => {
      if (shouldFailEmail) {
        throw new Error('SMTP Connection timeout to smtp.gmail.com:465');
      }
      sentEmails.push(mailOptions);
      return { messageId: `<mock-${Date.now()}@mail.local>` };
    }
  };

  setTransporter(mockTransporter);

  try {
    // 1. Setup DB & Server
    await connectDatabase();
    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // ==========================================
    // UNIT TESTS: TIMEZONE & WORKING HOURS
    // ==========================================
    await test('formatISTDate formats UTC timestamp to Asia/Kolkata date', () => {
      // 2026-09-18T04:00:00Z is 09:30 AM in IST on Sept 18, 2026
      const dateStr = formatISTDate(new Date('2026-09-18T04:00:00Z'));
      assert.ok(dateStr.includes('September 18, 2026'), `Expected September 18, 2026, got: ${dateStr}`);
    });

    await test('formatISTTime formats UTC timestamp to 12-hour IST time with AM/PM', () => {
      // 2026-09-18T04:12:15Z is 09:42:15 AM in IST (UTC+5:30)
      const timeStr = formatISTTime(new Date('2026-09-18T04:12:15Z'));
      assert.ok(/09:42:15\s*AM/i.test(timeStr), `Expected ~09:42:15 AM, got: ${timeStr}`);
    });

    await test('calculateWorkingHours computes correct duration', () => {
      const checkIn = new Date('2026-09-18T09:42:15+05:30');
      const checkOut = new Date('2026-09-18T18:17:32+05:30'); // 8h 35m 17s
      const duration = calculateWorkingHours(checkIn, checkOut);
      assert.strictEqual(duration, '8 hours 35 minutes');
    });

    await test('calculateWorkingHours handles singular hour and minute correctly', () => {
      const checkIn = new Date('2026-09-18T09:00:00+05:30');
      const checkOut = new Date('2026-09-18T10:01:00+05:30');
      const duration = calculateWorkingHours(checkIn, checkOut);
      assert.strictEqual(duration, '1 hour 1 minute');
    });

    // ==========================================
    // INTEGRATION TESTS: EMPLOYEE CHECK-IN & CHECK-OUT
    // ==========================================
    // Create test employee
    const uniqueNum = Date.now();
    const testEmployeeEmail = `emp_email_${uniqueNum}@example.com`;
    const testPassword = 'Password123!';
    const passwordHash = await User.hashPassword(testPassword);

    const employeeUser = await User.create({
      name: 'Rohan Sharma',
      email: testEmployeeEmail,
      username: `rohan_${uniqueNum}`,
      passwordHash,
      role: 'employee',
      employeeId: `EMP-${uniqueNum}`,
      department: 'Engineering',
      designation: 'Software Engineer',
      isActive: true
    });

    // Login as employee
    const loginRes = await request('POST', '/api/login', {
      body: {
        username: `rohan_${uniqueNum}`,
        password: testPassword
      }
    });
    assert.strictEqual(loginRes.status, 200);
    const employeeCookie = extractCookie(loginRes.headers);
    assert.ok(employeeCookie, 'Session cookie must be set');

    // Clean any attendance for this employee today
    const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    await Attendance.deleteMany({ employee: employeeUser._id });

    // Test 1: Check-out before check-in should fail and NOT send email
    await test('Check-out before check-in returns 400 and sends NO email', async () => {
      sentEmails.length = 0;
      const res = await request('POST', '/api/workspace/employee/check-out', { cookie: employeeCookie });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(sentEmails.length, 0, 'No email should be sent on failed checkout');
    });

    // Test 2: Successful Check-in
    await test('Employee check-in saves record in MongoDB and sends check-in email', async () => {
      sentEmails.length = 0;
      const res = await request('POST', '/api/workspace/employee/check-in', { cookie: employeeCookie });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.message.includes('Confirmation email sent'));

      // Verify MongoDB persistence
      const record = await Attendance.findOne({ employee: employeeUser._id, date: todayDate });
      assert.ok(record, 'Attendance record must exist in MongoDB');
      assert.ok(record.checkIn, 'Check-in timestamp must be populated');
      assert.strictEqual(record.status, 'present');

      // Verify email delivery
      assert.strictEqual(sentEmails.length, 1, 'Exactly 1 email should have been sent');
      const email = sentEmails[0];
      assert.strictEqual(email.to, testEmployeeEmail, 'Recipient must match employee registered email');
      assert.ok(email.subject.includes('Check-In Confirmation'));
      assert.ok(email.text.includes('Check-In Successful'));
      assert.ok(email.text.includes('Rohan Sharma'));
      assert.ok(email.text.includes('A&C Solutions Pvt. Ltd.'));
      assert.ok(email.html.includes('Check-In Time'));
    });

    // Test 3: Duplicate Check-in should fail and NOT send email
    await test('Duplicate check-in returns 409 and sends NO email', async () => {
      sentEmails.length = 0;
      const res = await request('POST', '/api/workspace/employee/check-in', { cookie: employeeCookie });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(sentEmails.length, 0, 'No email should be sent on duplicate check-in');
    });

    // Test 4: Successful Check-out
    await test('Employee check-out saves record in MongoDB, calculates hours, and sends check-out email', async () => {
      sentEmails.length = 0;

      // Ensure slight difference in time for working hours
      const pastTime = new Date(Date.now() - 4 * 60 * 60 * 1000 - 25 * 60 * 1000); // 4h 25m ago
      await Attendance.findOneAndUpdate(
        { employee: employeeUser._id, date: todayDate },
        { checkIn: pastTime }
      );

      const res = await request('POST', '/api/workspace/employee/check-out', { cookie: employeeCookie });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.message.includes('Confirmation email sent'));

      // Verify MongoDB persistence
      const record = await Attendance.findOne({ employee: employeeUser._id, date: todayDate });
      assert.ok(record.checkOut, 'Check-out timestamp must be saved in MongoDB');

      // Verify email delivery
      assert.strictEqual(sentEmails.length, 1, 'Exactly 1 checkout email should have been sent');
      const email = sentEmails[0];
      assert.strictEqual(email.to, testEmployeeEmail);
      assert.ok(email.subject.includes('Check-Out Confirmation'));
      assert.ok(email.text.includes('Check-Out Successful'));
      assert.ok(email.text.includes('Total Working Hours'));
      assert.ok(email.text.includes('4 hours 25 minutes'));
      assert.ok(email.html.includes('Total Working Hours'));
    });

    // Test 5: Duplicate Check-out should fail and NOT send email
    await test('Duplicate check-out returns 409 and sends NO email', async () => {
      sentEmails.length = 0;
      const res = await request('POST', '/api/workspace/employee/check-out', { cookie: employeeCookie });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(sentEmails.length, 0, 'No email should be sent on duplicate check-out');
    });

    // Test 6: Resilience on Email Failure
    await test('Email transport failure does NOT rollback attendance and returns sensible message', async () => {
      // Create another test employee for clean state
      const emp2 = await User.create({
        name: 'Priya Patel',
        email: `priya_${Date.now()}@example.com`,
        username: `priya_${Date.now()}`,
        passwordHash,
        role: 'employee',
        isActive: true
      });

      const loginRes2 = await request('POST', '/api/login', {
        body: { username: emp2.username, password: testPassword }
      });
      const cookie2 = extractCookie(loginRes2.headers);

      // Force email delivery to fail
      shouldFailEmail = true;
      sentEmails.length = 0;

      const res = await request('POST', '/api/workspace/employee/check-in', { cookie: cookie2 });
      assert.strictEqual(res.status, 200, 'Endpoint should return 200 even when email delivery fails');
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.message.includes('Email notification could not be sent'));

      // Verify attendance is STILL saved in MongoDB
      const record = await Attendance.findOne({ employee: emp2._id, date: todayDate });
      assert.ok(record, 'Attendance record MUST remain saved in MongoDB');
      assert.ok(record.checkIn, 'Check-in timestamp must remain intact');
      assert.strictEqual(record.status, 'present');

      shouldFailEmail = false; // Reset
    });

    // Test 7: Unauthenticated request should be rejected with 401 and send NO email
    await test('Unauthenticated check-in is rejected (401) and sends NO email', async () => {
      sentEmails.length = 0;
      const res = await request('POST', '/api/workspace/employee/check-in');
      assert.strictEqual(res.status, 401);
      assert.strictEqual(sentEmails.length, 0);
    });

  } catch (err) {
    console.error('Test setup error:', err);
    failed++;
  } finally {
    if (server) {
      server.close();
    }
    await disconnectDatabase();

    console.log('\n=============================================================');
    console.log(`ATTENDANCE EMAIL TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('=============================================================\n');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runEmailTests();
