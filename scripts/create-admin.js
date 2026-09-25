require('dotenv').config();
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const User = require('../src/models/User');

async function createAdmin() {
  const username = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';

  if (!password) {
    console.error('ERROR: Please set ADMIN_PASSWORD in .env before running this script.');
    process.exit(1);
  }

  try {
    console.log('Connecting to database...');
    await connectDatabase();

    const existingUser = await User.findOne({
      $or: [
        { username },
        { email: 'admin@andsolutions.com' }
      ]
    });

    const passwordHash = await User.hashPassword(password);

    if (existingUser) {
      existingUser.role = 'admin';
      existingUser.isActive = true;
      existingUser.passwordHash = passwordHash;
      if (!existingUser.username) existingUser.username = username;
      await existingUser.save();
      console.log(`✓ Admin account updated successfully: ${existingUser.username}`);
    } else {
      const newAdmin = await User.create({
        name: 'A&C Administrator',
        email: 'admin@andsolutions.com',
        username,
        phone: '+91 9494678101',
        passwordHash,
        role: 'admin',
        isActive: true
      });
      console.log(`✓ Admin account created successfully: ${newAdmin.username}`);
    }

    await disconnectDatabase();
    process.exit(0);
  } catch (err) {
    console.error('Failed to create/update admin:', err.message);
    process.exit(1);
  }
}

createAdmin();
