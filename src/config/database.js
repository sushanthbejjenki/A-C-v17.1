const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const environment = require('./environment');
const logger = require('../utils/logger');
const User = require('../models/User');
const LoginLog = require('../models/LoginLog');

let memoryServer = null;

async function connectDatabase() {
  let uri = environment.mongodbUri;

  if (!uri) {
    logger.info('No MONGODB_URI provided in environment. Initializing local embedded MongoDB engine...');
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create({
        instance: {
          dbName: 'ac_solutions_db'
        }
      });
      uri = memoryServer.getUri();
      logger.info(`Local MongoDB Memory Server started successfully at ${uri}`);
    } catch (err) {
      logger.warn(`Could not start MongoMemoryServer: ${err.message}. Attempting default local URI...`);
      uri = 'mongodb://127.0.0.1:27017/ac_solutions_db';
    }
  }

  try {
    mongoose.set('strictQuery', false);
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000
    });
    logger.info(`Connected to MongoDB successfully at ${uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')}`);

    // Run auto-migration of legacy JSON data and default admin creation
    await migrateLegacyData();
    await seedDefaultAdmin();

    return mongoose.connection;
  } catch (error) {
    logger.error('Failed to connect to MongoDB:', error.message);
    throw error;
  }
}

async function migrateLegacyData() {
  try {
    const dataDir = path.join(__dirname, '..', '..', 'data');
    const usersFile = path.join(dataDir, 'users.json');
    const logsFile = path.join(dataDir, 'login-log.json');

    // Migrate users
    if (fs.existsSync(usersFile)) {
      const fileData = fs.readFileSync(usersFile, 'utf8');
      const legacyUsers = JSON.parse(fileData || '[]');
      for (const lu of legacyUsers) {
        if (!lu.username) continue;
        const exists = await User.findOne({
          $or: [
            { username: lu.username.toLowerCase() },
            { email: (lu.email || '').toLowerCase() }
          ].filter(q => Object.values(q)[0])
        });

        if (!exists) {
          await User.create({
            name: lu.fullName || lu.name || lu.username,
            email: lu.email || `${lu.username.toLowerCase()}@andsolutions.com`,
            username: lu.username.toLowerCase(),
            passwordHash: lu.passwordHash,
            role: lu.role || 'user',
            isActive: lu.active !== false,
            createdAt: lu.createdAt ? new Date(lu.createdAt) : new Date()
          });
          logger.info(`Migrated legacy user into MongoDB: ${lu.username}`);
        }
      }
    }

    // Migrate logs if database is empty
    const logCount = await LoginLog.countDocuments();
    if (logCount === 0 && fs.existsSync(logsFile)) {
      const fileData = fs.readFileSync(logsFile, 'utf8');
      const legacyLogs = JSON.parse(fileData || '[]');
      if (Array.isArray(legacyLogs) && legacyLogs.length > 0) {
        const docs = legacyLogs.map(l => ({
          username: l.username || '',
          email: l.email || '',
          success: !!l.success,
          role: l.role || null,
          ip: l.ip || '—',
          userAgent: l.userAgent || '—',
          timestamp: l.timestamp ? new Date(l.timestamp) : new Date()
        }));
        await LoginLog.insertMany(docs);
        logger.info(`Migrated ${docs.length} legacy login logs into MongoDB.`);
      }
    }
  } catch (err) {
    logger.warn('Legacy data migration note:', err.message);
  }
}

async function seedDefaultAdmin() {
  try {
    const adminUsername = environment.adminUsername || 'admin';
    const adminPassword = environment.adminPassword;

    const existingAdmin = await User.findOne({
      $or: [
        { role: 'admin' },
        { username: adminUsername.toLowerCase() }
      ]
    });

    if (!existingAdmin && adminPassword) {
      const passwordHash = await User.hashPassword(adminPassword);
      await User.create({
        name: 'A&C Administrator',
        email: 'admin@andsolutions.com',
        username: adminUsername.toLowerCase(),
        phone: '+91 9494678101',
        passwordHash,
        role: 'admin',
        isActive: true
      });
      logger.info(`Default administrator account created: ${adminUsername}`);
    }
  } catch (err) {
    logger.warn('Admin seed note:', err.message);
  }
}

async function disconnectDatabase() {
  try {
    await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
      memoryServer = null;
    }
    logger.info('MongoDB disconnected cleanly.');
  } catch (err) {
    logger.error('Error disconnecting MongoDB:', err.message);
  }
}

module.exports = {
  connectDatabase,
  disconnectDatabase
};
