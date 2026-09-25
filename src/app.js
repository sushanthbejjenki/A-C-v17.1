const express = require('express');
const path = require('path');
const zlib = require('zlib');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const environment = require('./config/environment');

const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const internshipRoutes = require('./routes/internshipRoutes');
const contactRoutes = require('./routes/contactRoutes');
const enquiryRoutes = require('./routes/enquiryRoutes');
const adminRoutes = require('./routes/adminRoutes');
const workspaceRoutes = require('./routes/workspaceRoutes');
const workspaceAdminRoutes = require('./routes/workspaceAdminRoutes');
const { requireAuth } = require('./middleware/authMiddleware');
const { requireAdmin } = require('./middleware/adminMiddleware');
const { errorHandler } = require('./middleware/errorMiddleware');
const authController = require('./controllers/authController');
const { authLimiter, registerLimiter } = require('./middleware/rateLimiter');

const app = express();
app.set('trust proxy', environment.trustProxy);

// Secure defaults. CSP remains compatible with the current site; third-party
// font loading has been removed, reducing a render-blocking network request.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", environment.frontendUrl, ...environment.corsOrigins],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

const allowedOrigins = new Set([environment.frontendUrl, ...environment.corsOrigins].filter(Boolean));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (!environment.isProduction && /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
    return callback(null, allowedOrigins.has(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());

// Lightweight built-in gzip compression. This avoids another runtime
// dependency while shrinking HTML/CSS/JS/JSON/SVG responses substantially.
function compressTextResponses(req, res, next) {
  if (req.method === 'HEAD' || req.headers['accept-encoding']?.includes('gzip') !== true) return next();
  const originalWrite = res.write;
  const originalEnd = res.end;
  let chunks = [];
  let total = 0;
  let capture = null;

  const canCompress = () => {
    const type = String(res.getHeader('Content-Type') || '').toLowerCase();
    return type.startsWith('text/') || /json|javascript|xml|svg|css/.test(type);
  };

  res.write = function (chunk, encoding, callback) {
    if (capture === null) capture = canCompress();
    if (!capture) return originalWrite.call(res, chunk, encoding, callback);
    if (chunk) { const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding); chunks.push(buf); total += buf.length; }
    if (typeof callback === 'function') callback();
    return true;
  };

  res.end = function (chunk, encoding, callback) {
    if (typeof chunk === 'function') { callback = chunk; chunk = undefined; encoding = undefined; }
    else if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
    if (capture === null) capture = canCompress();
    if (!capture || res.getHeader('Content-Encoding')) return originalEnd.call(res, chunk, encoding, callback);
    if (chunk) { const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding); chunks.push(buf); total += buf.length; }
    if (total < 1024 || res.statusCode === 204 || res.statusCode === 304) {
      const body = Buffer.concat(chunks, total); chunks = [];
      res.setHeader('Content-Length', body.length);
      return originalEnd.call(res, body, undefined, callback);
    }
    const body = Buffer.concat(chunks, total); chunks = [];
    const compressed = zlib.gzipSync(body, { level: 6 });
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Length', compressed.length);
    return originalEnd.call(res, compressed, undefined, callback);
  };
  next();
}
app.use(compressTextResponses);

const publicDir = path.join(__dirname, '..', 'public');
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(express.static(publicDir, {
  etag: true,
  lastModified: true,
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    // HTML stays revalidatable; fingerprinting/version query strings handle CSS/JS updates.
    if (ext === '.html') res.setHeader('Cache-Control', 'no-cache');
    else if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico'].includes(ext)) res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    else if (['.css', '.js', '.json', '.webmanifest'].includes(ext)) res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  }
}));

app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/internships', internshipRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/enquiries', enquiryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/workspace-admin', workspaceAdminRoutes);

app.post('/api/register', registerLimiter, authController.register);
app.post('/api/login', authLimiter, authController.login);
app.post('/api/logout', authController.logout);
app.get('/api/me', requireAuth, authController.getMe);

app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(publicDir, 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(publicDir, 'register.html')));
app.get('/portal', requireAuth, (req, res) => res.sendFile(path.join(publicDir, 'portal.html')));
app.get('/admin', requireAuth, requireAdmin, (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('/employee-login', (req,res)=>res.sendFile(path.join(publicDir,'employee-login.html')));
app.get('/intern-login',(req,res)=>res.sendFile(path.join(publicDir,'intern-login.html')));
app.get('/client-login', (req,res)=>res.sendFile(path.join(publicDir,'client-login.html')));
app.get('/admin-login', (req,res)=>res.sendFile(path.join(publicDir,'admin-login.html')));
app.get('/admin-workspace', requireAuth, requireAdmin, (req,res)=>res.sendFile(path.join(publicDir,'admin-workspace.html')));
app.get('/employee', requireAuth, (req,res)=> req.user.role==='employee' ? res.sendFile(path.join(publicDir,'employee.html')) : res.redirect('/login.html'));
app.get('/intern', requireAuth, (req,res)=> req.user.role==='employee' && req.user.employeeType==='intern' ? res.sendFile(path.join(publicDir,'employee.html')) : res.redirect('/login.html'));
app.get('/client', requireAuth, (req,res)=> req.user.role==='client' ? res.sendFile(path.join(publicDir,'client.html')) : res.redirect('/login.html'));

app.use('/api/*', (req, res) => res.status(404).json({ success:false, message:`API endpoint not found: ${req.method} ${req.originalUrl}` }));
app.use(errorHandler);

module.exports = app;
