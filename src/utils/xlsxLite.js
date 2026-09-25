const fs = require('fs');
const zlib = require('zlib');

// Minimal XLSX reader for the employee bulk-import workflow.
// It intentionally supports the normal .xlsx format produced by Excel/LibreOffice/Google Sheets.
function readUInt16(buf, o) { return buf.readUInt16LE(o); }
function readUInt32(buf, o) { return buf.readUInt32LE(o); }

function unzipEntries(buffer) {
  const entries = new Map();
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid XLSX file: ZIP end record not found.');
  const cdSize = readUInt32(buffer, eocd + 12);
  const cdOffset = readUInt32(buffer, eocd + 16);
  let p = cdOffset;
  const end = cdOffset + cdSize;
  while (p < end) {
    if (readUInt32(buffer, p) !== 0x02014b50) throw new Error('Invalid XLSX central directory.');
    const method = readUInt16(buffer, p + 10);
    const compressedSize = readUInt32(buffer, p + 20);
    const nameLen = readUInt16(buffer, p + 28);
    const extraLen = readUInt16(buffer, p + 30);
    const commentLen = readUInt16(buffer, p + 32);
    const localOffset = readUInt32(buffer, p + 42);
    const name = buffer.slice(p + 46, p + 46 + nameLen).toString('utf8');

    const localNameLen = readUInt16(buffer, localOffset + 26);
    const localExtraLen = readUInt16(buffer, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(`Unsupported XLSX compression method: ${method}`);
    entries.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function xmlText(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function columnNumber(ref) {
  const letters = String(ref).match(/^[A-Z]+/i)?.[0].toUpperCase() || 'A';
  let n = 0;
  for (const c of letters) n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
}
function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => xmlText(x[1])).join(''));
}
function parseSheet(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const inner = cellMatch[2];
      const ref = attrs.match(/\br="([^"]+)"/i)?.[1] || `A${cells.length + 1}`;
      const type = attrs.match(/\bt="([^"]+)"/i)?.[1] || '';
      const inline = inner.match(/<is>([\s\S]*?)<\/is>/)?.[1];
      let value = '';
      if (inline) value = [...inline.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => xmlText(m[1])).join('');
      else {
        const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
        if (type === 's') value = sharedStrings[Number(raw)] ?? '';
        else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
        else value = xmlText(raw);
      }
      cells.push({ col: columnNumber(ref), value });
    }
    const width = cells.reduce((m, c) => Math.max(m, c.col + 1), 0);
    const out = Array(width).fill('');
    cells.forEach(c => { out[c.col] = c.value; });
    rows.push(out);
  }
  return rows;
}

function parseXlsx(filePath) {
  const buffer = fs.readFileSync(filePath);
  const entries = unzipEntries(buffer);
  const workbookXml = entries.get('xl/workbook.xml');
  if (!workbookXml) throw new Error('Invalid XLSX file: workbook.xml is missing.');
  const relsXml = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '';
  const workbook = workbookXml.toString('utf8');
  const firstSheet = workbook.match(/<sheet\b[^>]*r:id="([^"]+)"[^>]*>/i) || workbook.match(/<sheet\b[^>]*r:id='([^']+)'[^>]*>/i);
  if (!firstSheet) throw new Error('No worksheet found in XLSX file.');
  const relId = firstSheet[1];
  const rels = [...relsXml.matchAll(/<Relationship\b([^>]*)\/>/gi)];
  const rel = rels.map(m => m[1]).map(attrs => {
    const id = attrs.match(/\bId=\"([^\"]+)\"/i)?.[1] || attrs.match(/\bId='([^']+)'/i)?.[1];
    const target = attrs.match(/\bTarget=\"([^\"]+)\"/i)?.[1] || attrs.match(/\bTarget='([^']+)'/i)?.[1];
    return id === relId ? { target } : null;
  }).find(Boolean);
  if (!rel) throw new Error('Could not locate the first worksheet.');
  let sheetPath = rel.target.replace(/^\//, '');
  if (!sheetPath.startsWith('xl/')) sheetPath = `xl/${sheetPath.replace(/^xl\//, '')}`;
  const sheetXml = entries.get(sheetPath);
  if (!sheetXml) throw new Error('Worksheet data is missing.');
  const shared = parseSharedStrings(entries.get('xl/sharedStrings.xml')?.toString('utf8') || '');
  return parseSheet(sheetXml.toString('utf8'), shared);
}

function parseDrawingImages(entries, sheetPath, sheetXml) {
  const drawingRef = sheetXml.match(/<drawing\b[^>]*r:id="([^"]+)"[^>]*(?:\/>|>)/i)?.[1] || sheetXml.match(/<drawing\b[^>]*r:id='([^']+)'[^>]*(?:\/>|>)/i)?.[1];
  if (!drawingRef) return [];
  const slash = sheetPath.lastIndexOf('/');
  const sheetDir = sheetPath.slice(0, slash);
  const sheetFile = sheetPath.slice(slash + 1);
  const relPath = `${sheetDir}/_rels/${sheetFile}.rels`;
  const relXml = entries.get(relPath)?.toString('utf8') || '';
  const drawingTarget = [...relXml.matchAll(/<Relationship\b([^>]*)\/>/gi)].map(m => {
    const a=m[1]; const id=a.match(/\bId="([^"]+)"/i)?.[1]||a.match(/\bId='([^']+)'/i)?.[1];
    const target=a.match(/\bTarget="([^"]+)"/i)?.[1]||a.match(/\bTarget='([^']+)'/i)?.[1]; return id===drawingRef?target:null;
  }).find(Boolean);
  if (!drawingTarget) return [];
  const drawingPath = pathJoinXlsx(sheetDir, drawingTarget);
  const drawingXml = entries.get(drawingPath)?.toString('utf8');
  if (!drawingXml) return [];
  const dp = drawingPath.lastIndexOf('/');
  const drawingDir = drawingPath.slice(0,dp);
  const drawingFile = drawingPath.slice(dp+1);
  const drawingRelPath = `${drawingDir}/_rels/${drawingFile}.rels`;
  const drawingRels = entries.get(drawingRelPath)?.toString('utf8') || '';
  const relMap = {};
  for (const m of drawingRels.matchAll(/<Relationship\b([^>]*)\/>/gi)) {
    const a=m[1]; const id=a.match(/\bId="([^"]+)"/i)?.[1]||a.match(/\bId='([^']+)'/i)?.[1];
    const target=a.match(/\bTarget="([^"]+)"/i)?.[1]||a.match(/\bTarget='([^']+)'/i)?.[1];
    if(id&&target) relMap[id]=pathJoinXlsx(drawingDir,target);
  }
  const out=[];
  const anchors=[...drawingXml.matchAll(/<(?:xdr:)?twoCellAnchor\b[\s\S]*?<\/(?:xdr:)?twoCellAnchor>|<(?:xdr:)?oneCellAnchor\b[\s\S]*?<\/(?:xdr:)?oneCellAnchor>/gi)].map(m=>m[0]);
  for(const anchor of anchors){
    const row=Number(anchor.match(/<(?:xdr:)?from\b[\s\S]*?<\/?(?:xdr:)?row>(\d+)<\//i)?.[1] ?? anchor.match(/<(?:xdr:)?from\b[^>]*>[^]*?<row>(\d+)<\/row>/i)?.[1]);
    const col=Number(anchor.match(/<(?:xdr:)?from\b[\s\S]*?<\/?(?:xdr:)?col>(\d+)<\//i)?.[1] ?? anchor.match(/<(?:xdr:)?from\b[^>]*>[^]*?<col>(\d+)<\/col>/i)?.[1] ?? 0);
    const rid=anchor.match(/r:embed="([^"]+)"/i)?.[1] || anchor.match(/r:embed='([^']+)'/i)?.[1];
    if(!Number.isInteger(row)||!rid||!relMap[rid]) continue;
    const data=entries.get(relMap[rid]); if(!data) continue;
    const ext=(relMap[rid].match(/\.([a-z0-9]+)$/i)?.[1]||'png').toLowerCase();
    out.push({row,col:Number.isFinite(col)?col:0,data,ext});
  }
  return out;
}
function pathJoinXlsx(base, target) {
  const raw = String(target || '');
  const parts=(raw.startsWith('/') ? raw.slice(1) : (base + '/' + raw)).split('/'); const out=[];
  for(const part of parts){ if(!part||part==='.') continue; if(part==='..') out.pop(); else out.push(part); }
  return out.join('/');
}
function parseXlsxWithImages(filePath) {
  const buffer = fs.readFileSync(filePath);
  const entries = unzipEntries(buffer);
  const workbookXml = entries.get('xl/workbook.xml');
  if (!workbookXml) throw new Error('Invalid XLSX file: workbook.xml is missing.');
  const relsXml = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '';
  const workbook = workbookXml.toString('utf8');
  const firstSheet = workbook.match(/<sheet\b[^>]*r:id="([^"]+)"[^>]*>/i) || workbook.match(/<sheet\b[^>]*r:id='([^']+)'[^>]*>/i);
  if (!firstSheet) throw new Error('No worksheet found in XLSX file.');
  const relId = firstSheet[1];
  const rels = [...relsXml.matchAll(/<Relationship\b([^>]*)\/>/gi)];
  const rel = rels.map(m => { const attrs=m[1]; const id=attrs.match(/\bId="([^"]+)"/i)?.[1]||attrs.match(/\bId='([^']+)'/i)?.[1]; const target=attrs.match(/\bTarget="([^"]+)"/i)?.[1]||attrs.match(/\bTarget='([^']+)'/i)?.[1]; return id===relId?{target}:null; }).find(Boolean);
  if (!rel) throw new Error('Could not locate the first worksheet.');
  let sheetPath = rel.target.replace(/^\//, '');
  if (!sheetPath.startsWith('xl/')) sheetPath=`xl/${sheetPath.replace(/^xl\//,'')}`;
  const sheetXml=entries.get(sheetPath); if(!sheetXml) throw new Error('Worksheet data is missing.');
  const shared=parseSharedStrings(entries.get('xl/sharedStrings.xml')?.toString('utf8')||'');
  return { rows: parseSheet(sheetXml.toString('utf8'), shared), images: parseDrawingImages(entries, sheetPath, sheetXml.toString('utf8')) };
}

module.exports = { parseXlsx, parseXlsxWithImages };
