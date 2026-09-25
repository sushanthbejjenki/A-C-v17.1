const fs = require('fs');
const path = require('path');

function createMultipartParser({ uploadDir, maxFileSize = 5 * 1024 * 1024, allowedExtensions = [] }) {
  fs.mkdirSync(uploadDir, { recursive: true });

  return function parseMultipart(req, res, next) {
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) return next();
    const raw = req.body;
    if (!Buffer.isBuffer(raw)) return next(new Error('Invalid multipart body.'));

    const match = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
    if (!match) return next(new Error('Multipart boundary missing.'));
    const boundary = Buffer.from('--' + (match[1] || match[2]));
    const body = raw;
    const fields = {};
    const files = {};
    let pos = 0;

    while ((pos = body.indexOf(boundary, pos)) !== -1) {
      pos += boundary.length;
      if (body.slice(pos, pos + 2).toString() === '--') break;
      if (body.slice(pos, pos + 2).toString() === '\r\n') pos += 2;
      const nextBoundary = body.indexOf(boundary, pos);
      if (nextBoundary < 0) break;
      const part = body.slice(pos, nextBoundary - 2);
      const sep = part.indexOf(Buffer.from('\r\n\r\n'));
      if (sep < 0) continue;

      const headers = part.slice(0, sep).toString('utf8');
      const content = part.slice(sep + 4);
      const nameMatch = headers.match(/name="([^"]+)"/i);
      if (!nameMatch) continue;
      const fieldName = nameMatch[1];
      const fileMatch = headers.match(/filename="([^"]*)"/i);

      if (fileMatch && fileMatch[1]) {
        const originalName = path.basename(fileMatch[1]);
        const ext = path.extname(originalName).toLowerCase();
        if (!allowedExtensions.includes(ext)) {
          return res.status(400).json({ success: false, message: `Unsupported file type for ${fieldName}. Allowed: ${allowedExtensions.join(', ')}` });
        }
        if (content.length > maxFileSize) {
          return res.status(400).json({ success: false, message: `${fieldName} must be ${Math.round(maxFileSize / 1024 / 1024)} MB or smaller.` });
        }
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, content);
        files[fieldName] = { path: filePath, originalname: originalName, filename, size: content.length, extension: ext };
      } else {
        fields[fieldName] = content.toString('utf8').trim();
      }
    }

    req.body = fields;
    req.files = files;
    next();
  };
}

module.exports = { createMultipartParser };
