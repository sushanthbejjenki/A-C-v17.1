function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim()) && email.trim().length <= 160;
}

function isValidPhone(phone) {
  if (!phone) return true; // Optional in some forms
  if (typeof phone !== 'string') return false;
  const clean = phone.trim().replace(/[\s\-()]/g, '');
  // Matches 10-15 digits optionally prefixed with +
  return /^\+?[0-9]{10,15}$/.test(clean);
}

function isValidPassword(password) {
  if (!password || typeof password !== 'string') return false;
  return password.length >= 8 && password.length <= 128;
}

function sanitizeString(str, maxLength = 500) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLength);
}

module.exports = {
  isValidEmail,
  isValidPhone,
  isValidPassword,
  sanitizeString
};
