/**
 * A&C SOLUTIONS PVT. LTD. — BACKEND AUTOMATED TEST SUITE
 * Tests all core REST APIs, Authentication, RBAC, Database Operations, Validation & Security
 */

const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const User = require('../src/models/User');
const LoginLog = require('../src/models/LoginLog');
const InternshipApplication = require('../src/models/InternshipApplication');
const ContactEnquiry = require('../src/models/ContactEnquiry');
const ServiceEnquiry = require('../src/models/ServiceEnquiry');

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

async function runTests() {
  console.log('\n=============================================================');
  console.log('STARTING A&C SOLUTIONS BACKEND AUTOMATED TESTS');
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
      console.error(`  Error: ${err.message}\n`);
      failed++;
    }
  }

  try {
    // 1. Setup DB & Server
    await connectDatabase();
    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    let normalUserCookie = '';
    let adminUserCookie = '';
    let createdAppId = '';
    let createdContactId = '';
    let createdEnquiryId = '';

    // ==========================================
    // 1. HEALTH CHECK
    // ==========================================
    await test('GET /api/health returns 200 OK and service status', async () => {
      const res = await request('GET', '/api/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'ok');
      assert.strictEqual(res.body.service, 'A&C Solutions Backend');
    });

    // ==========================================
    // 2. AUTHENTICATION & USER REGISTRATION
    // ==========================================
    await test('POST /api/auth/register creates new user account', async () => {
      const uniqueSuffix = Date.now();
      const res = await request('POST', '/api/auth/register', {
        body: {
          fullName: 'Test Candidate',
          email: `candidate_${uniqueSuffix}@example.com`,
          username: `candidate_${uniqueSuffix}`,
          phone: '+919876543210',
          password: 'Password123!',
          confirmPassword: 'Password123!'
        }
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.user);
      assert.strictEqual(res.body.user.email, `candidate_${uniqueSuffix}@example.com`);
      assert.strictEqual(res.body.user.passwordHash, undefined, 'Password hash must never be returned');
    });

    await test('POST /api/auth/register rejects duplicate email', async () => {
      const res = await request('POST', '/api/auth/register', {
        body: {
          fullName: 'Duplicate User',
          email: 'duplicate@example.com',
          username: `user_${Date.now()}`,
          password: 'Password123!',
          confirmPassword: 'Password123!'
        }
      });
      assert.strictEqual(res.status, 201);

      // Attempt duplicate
      const dupRes = await request('POST', '/api/auth/register', {
        body: {
          fullName: 'Duplicate User 2',
          email: 'duplicate@example.com',
          username: `user_${Date.now() + 1}`,
          password: 'Password123!',
          confirmPassword: 'Password123!'
        }
      });
      assert.strictEqual(dupRes.status, 409);
      assert.strictEqual(dupRes.body.success, false);
    });

    await test('POST /api/auth/register rejects weak/short password', async () => {
      const res = await request('POST', '/api/auth/register', {
        body: {
          fullName: 'Short Pass User',
          email: `shortpass_${Date.now()}@example.com`,
          username: `user_${Date.now()}`,
          password: '123',
          confirmPassword: '123'
        }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    // ==========================================
    // 3. LOGIN & SESSION CREATION
    // ==========================================
    await test('POST /api/auth/login authenticates user and sets session cookie', async () => {
      const testEmail = `login_test_${Date.now()}@example.com`;
      const testUsername = `loginuser_${Date.now()}`;
      await request('POST', '/api/auth/register', {
        body: {
          fullName: 'Login Tester',
          email: testEmail,
          username: testUsername,
          password: 'SecurePassword123!',
          confirmPassword: 'SecurePassword123!'
        }
      });

      const res = await request('POST', '/api/auth/login', {
        body: {
          username: testUsername,
          password: 'SecurePassword123!'
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.token, 'Must return JWT token');
      assert.strictEqual(res.body.user.username, testUsername);

      normalUserCookie = extractCookie(res.headers);
      assert.ok(normalUserCookie.includes('ac_session='), 'Must set ac_session cookie');
    });

    await test('POST /api/auth/login records failed attempt in LoginLog', async () => {
      const res = await request('POST', '/api/auth/login', {
        body: {
          username: 'non_existent_user_xyz',
          password: 'WrongPassword!'
        }
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);

      // Verify log was saved to MongoDB
      const log = await LoginLog.findOne({ username: 'non_existent_user_xyz' }).sort({ timestamp: -1 });
      assert.ok(log, 'LoginLog record must exist for failed attempt');
      assert.strictEqual(log.success, false);
    });

    await test('GET /api/me returns authenticated user profile', async () => {
      const res = await request('GET', '/api/me', { cookie: normalUserCookie });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.authenticated, true);
      assert.strictEqual(res.body.user.role, 'user');
    });

    // ==========================================
    // 4. INTERNSHIP APPLICATIONS
    // ==========================================
    await test('POST /api/internships/apply submits application with Pending status', async () => {
      const res = await request('POST', '/api/internships/apply', {
        body: {
          fullName: 'Sneha Sharma',
          email: 'sneha.sharma@example.com',
          phone: '+919876543210',
          college: 'Kakatiya Institute of Technology & Science',
          course: 'B.Tech',
          branch: 'Computer Science & Engineering',
          yearOfStudy: 'Final Year',
          domain: 'IT & Technology',
          skills: 'JavaScript, Node.js, Python, MongoDB',
          message: 'I am passionate about full-stack web development and excited to intern with A&C Solutions.'
        }
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.applicationId);
      createdAppId = res.body.applicationId;

      const appDoc = await InternshipApplication.findById(createdAppId);
      assert.strictEqual(appDoc.status, 'Pending', 'Default status must be Pending');
      assert.strictEqual(appDoc.domain, 'IT & Technology');
    });

    await test('POST /api/internships/apply validates required email and college', async () => {
      const res = await request('POST', '/api/internships/apply', {
        body: {
          fullName: 'Missing Fields Person',
          phone: '9876543210'
        }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    // ==========================================
    // 5. CONTACT FORM
    // ==========================================
    await test('POST /api/contact submits contact enquiry with New status', async () => {
      const res = await request('POST', '/api/contact', {
        body: {
          name: 'Rajesh Kumar',
          email: 'rajesh.kumar@example.com',
          phone: '+919123456780',
          subject: 'Partnership Inquiry',
          message: 'We are interested in collaborating with A&C Solutions for surveillance services.'
        }
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.enquiryId);
      createdContactId = res.body.enquiryId;

      const contactDoc = await ContactEnquiry.findById(createdContactId);
      assert.strictEqual(contactDoc.status, 'New');
    });

    // ==========================================
    // 6. SERVICE / DOMAIN ENQUIRIES
    // ==========================================
    await test('POST /api/enquiries submits service enquiry with domain', async () => {
      const res = await request('POST', '/api/enquiries', {
        body: {
          name: 'Priya Verma',
          email: 'priya.verma@example.com',
          phone: '+919988776655',
          domain: 'CCTV Monitoring',
          message: 'Requesting quotation for 24/7 retail supermarket CCTV monitoring.'
        }
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.enquiryId);
      createdEnquiryId = res.body.enquiryId;

      const enquiryDoc = await ServiceEnquiry.findById(createdEnquiryId);
      assert.strictEqual(enquiryDoc.domain, 'CCTV Monitoring');
      assert.strictEqual(enquiryDoc.status, 'New');
    });

    // ==========================================
    // 7. ADMIN AUTHORIZATION & SECURITY (RBAC)
    // ==========================================
    await test('Non-admin user receives 403 Forbidden on admin endpoints', async () => {
      const res = await request('GET', '/api/admin/dashboard', { cookie: normalUserCookie });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
    });

    await test('Unauthenticated request receives 401 Unauthorized on admin endpoints', async () => {
      const res = await request('GET', '/api/admin/dashboard');
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
    });

    // Create & log in admin
    await test('Admin logs in and accesses admin dashboard stats', async () => {
      const adminPass = 'AdminSecret2026!';
      const adminUser = await User.findOneAndUpdate(
        { username: 'admin' },
        {
          name: 'A&C Administrator',
          email: 'admin@andsolutions.com',
          username: 'admin',
          passwordHash: await User.hashPassword(adminPass),
          role: 'admin',
          isActive: true
        },
        { upsert: true, new: true }
      );

      const loginRes = await request('POST', '/api/auth/login', {
        body: { username: 'admin', password: adminPass }
      });
      assert.strictEqual(loginRes.status, 200);
      assert.strictEqual(loginRes.body.user.role, 'admin');
      adminUserCookie = extractCookie(loginRes.headers);

      // Access Dashboard Stats
      const statsRes = await request('GET', '/api/admin/dashboard', { cookie: adminUserCookie });
      assert.strictEqual(statsRes.status, 200);
      assert.strictEqual(statsRes.body.success, true);
      assert.ok(statsRes.body.stats.totalUsers > 0);
      assert.ok(statsRes.body.stats.totalApplications > 0);
    });

    // ==========================================
    // 8. ADMIN MANAGEMENT OPERATIONS
    // ==========================================
    await test('Admin can view and update internship application status', async () => {
      const getRes = await request('GET', '/api/admin/internships', { cookie: adminUserCookie });
      assert.strictEqual(getRes.status, 200);
      assert.ok(Array.isArray(getRes.body.applications));

      // Update status
      const patchRes = await request('PATCH', `/api/admin/internships/${createdAppId}`, {
        cookie: adminUserCookie,
        body: {
          status: 'Shortlisted',
          notes: 'Strong JavaScript skills, eligible for interview round.'
        }
      });
      assert.strictEqual(patchRes.status, 200);
      assert.strictEqual(patchRes.body.application.status, 'Shortlisted');
      assert.strictEqual(patchRes.body.application.notes, 'Strong JavaScript skills, eligible for interview round.');
    });

    await test('Admin can view and update contact message status', async () => {
      const patchRes = await request('PATCH', `/api/admin/contacts/${createdContactId}`, {
        cookie: adminUserCookie,
        body: { status: 'Responded' }
      });
      assert.strictEqual(patchRes.status, 200);
      assert.strictEqual(patchRes.body.contact.status, 'Responded');
    });

    await test('Admin can view and update domain enquiry status', async () => {
      const patchRes = await request('PATCH', `/api/admin/enquiries/${createdEnquiryId}`, {
        cookie: adminUserCookie,
        body: { status: 'Read' }
      });
      assert.strictEqual(patchRes.status, 200);
      assert.strictEqual(patchRes.body.enquiry.status, 'Read');
    });

    await test('Admin can list security audit logs', async () => {
      const res = await request('GET', '/api/admin/logins', { cookie: adminUserCookie });
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.logs));
      assert.ok(res.body.logs.length > 0);
    });

    // ==========================================
    // 9. LOGOUT
    // ==========================================
    await test('POST /api/auth/logout clears session cookie', async () => {
      const res = await request('POST', '/api/auth/logout', { cookie: normalUserCookie });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });

  } catch (err) {
    console.error('Test suite setup error:', err);
    failed++;
  } finally {
    if (server) {
      server.close();
    }
    await disconnectDatabase();

    console.log('\n=============================================================');
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('=============================================================\n');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runTests();
