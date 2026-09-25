const fs=require('fs');
const path=require('path');
const User=require('../models/User'); const Client=require('../models/Client'); const Attendance=require('../models/Attendance'); const Performance=require('../models/Performance'); const LeaveRequest=require('../models/LeaveRequest'); const Message=require('../models/Message'); const AttendanceSettings=require('../models/AttendanceSettings'); const LoginLog=require('../models/LoginLog'); const Holiday=require('../models/Holiday');

const { parseXlsx, parseXlsxWithImages } = require('../utils/xlsxLite');
const { buildWorkbook } = require('../utils/xlsxExport');
const profileDir = path.join(__dirname,'..','..','private_uploads','profiles');
fs.mkdirSync(profileDir,{recursive:true});
function saveImportedProfileImage(image){
  if(!image?.data) return '';
  const ext=['jpg','jpeg','png','webp'].includes(String(image.ext||'').toLowerCase()) ? String(image.ext).toLowerCase() : 'png';
  const filename=`${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  fs.writeFileSync(path.join(profileDir,filename),image.data);
  return filename;
}

function normalizeImportHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function normalizeExcelTime(value, fallback = '') {
  // Excel stores time-only cells as a fraction of a day (for example,
  // 10:00 = 10/24 = 0.416666...). The lightweight XLSX reader exposes
  // that underlying numeric value, so convert it to the HH:MM string
  // expected by the attendance validator. Also accept normal text times
  // and common HH:MM:SS input.
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const text = String(value).trim();
  const direct = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (direct) {
    const hour = Number(direct[1]);
    const minute = Number(direct[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric < 1) {
    // XLSX time serial: fraction of a 24-hour day. Round to the nearest
    // minute so floating-point representation cannot produce 09:59/10:01.
    const totalMinutes = Math.round(numeric * 24 * 60) % (24 * 60);
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  return text;
}

function rowToEmployee(row, headers) {
  const out = {};
  headers.forEach((h, i) => { out[normalizeImportHeader(h)] = String(row[i] ?? '').trim(); });
  const pick = (...keys) => { for (const k of keys) if (out[k] !== undefined) return out[k]; return ''; };
  return {
    name: pick('name', 'fullname', 'employeename'),
    employeeType: (() => { const v=pick('employeetype','category','type','employmenttype').toLowerCase(); return ['intern','wfh','employee'].includes(v) ? v : 'employee'; })(),
    employeeId: pick('employeeid', 'id'),
    email: pick('email', 'emailaddress').toLowerCase(),
    username: pick('username', 'loginusername').toLowerCase(),
    password: pick('password', 'loginpassword'),
    phone: pick('phone', 'phonenumber', 'mobile'),
    department: pick('department', 'dept'),
    designation: pick('designation', 'role', 'jobtitle'),
    attendanceScheduleEnabled: (() => {
      const raw = pick('attendancescheduleenabled','fixedschedule','useschedule','fixedattendanceschedule','scheduledattendance');
      if (!raw) return true;
      return !['false','0','no','off','disabled'].includes(raw.toLowerCase());
    })(),
    checkInTime: normalizeExcelTime(pick('checkintime', 'checkin', 'starttime'), ''),
    graceMinutes: pick('graceminutes', 'grace', 'graceperiod') || '10',
    checkOutTime: normalizeExcelTime(pick('checkouttime', 'checkout', 'endtime'), ''),
    allowMultipleCheckIns: ['true','1','yes','on'].includes(pick('allowmultiplecheckins','multiplecheckins','allowmulticheckins').toLowerCase()),
    maxCheckInsPerDay: pick('maxcheckinsperday','checkinlimit','maxcheckins','maxloginsperday','loginlimit') || '1'
  };
}

async function bulkCreateEmployees(req, res, next) {
  let tempPath = '';
  try {
    const file = req.files?.file;
    if (!file) return res.status(400).json({ success:false, message:'Please choose an Excel .xlsx file.' });
    tempPath = file.path;
    const ext = file.extension;
    if (ext !== '.xlsx') return res.status(400).json({ success:false, message:'Only .xlsx Excel files are supported. Download the template and save it as .xlsx.' });
    const parsedXlsx = parseXlsxWithImages(file.path);
    const rows = parsedXlsx.rows;
    const embeddedImages = parsedXlsx.images || [];
    if (!rows.length) return res.status(400).json({ success:false, message:'The Excel sheet is empty.' });
    const headers = rows[0].map(v => String(v || '').trim());
    const required = ['name','email','username','password'];
    const normalizedHeaders = headers.map(normalizeImportHeader);
    const missing = required.filter(k => !normalizedHeaders.includes(k));
    if (missing.length) return res.status(400).json({ success:false, message:`Missing required Excel columns: ${missing.join(', ')}` });

    const created = [], skipped = [];
    const timeOk = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i].some(v => String(v ?? '').trim())) continue;
      const item = rowToEmployee(rows[i], headers);
      const rowNumber = i + 1;
      if (!item.name || !item.email || !item.username || !item.password) {
        skipped.push({ row: rowNumber, name: item.name || '', reason: 'Name, email, username and password are required.' }); continue;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)) { skipped.push({row:rowNumber,name:item.name,reason:'Invalid email address.'}); continue; }
      if (item.password.length < 8) { skipped.push({row:rowNumber,name:item.name,reason:'Password must be at least 8 characters.'}); continue; }
      const grace = Number(item.graceMinutes);
      if (!Number.isFinite(grace) || grace < 0 || grace > 120) {
        skipped.push({row:rowNumber,name:item.name,reason:'Grace period must be a number from 0–120.'}); continue;
      }
      if (item.attendanceScheduleEnabled) {
        if (!timeOk(item.checkInTime) || !timeOk(item.checkOutTime) || minutesFromTime(item.checkOutTime) <= minutesFromTime(item.checkInTime)) {
          skipped.push({row:rowNumber,name:item.name,reason:'Fixed schedule is enabled. Check-in/check-out must be HH:MM and checkout must be after check-in.'}); continue;
        }
      } else {
        item.checkInTime = '09:00';
        item.checkOutTime = '18:00';
      }
      const loginLimit = Number(item.maxCheckInsPerDay);
      if (!Number.isInteger(loginLimit) || loginLimit < 1 || loginLimit > 50) {
        skipped.push({row:rowNumber,name:item.name,reason:'Maximum check-in sessions per day must be a whole number from 1 to 50.'}); continue;
      }
      const duplicate = await User.findOne({$or:[{email:item.email},{username:item.username}]});
      if (duplicate) { skipped.push({row:rowNumber,name:item.name,reason:'Email or username already exists.'}); continue; }
      try {
        const user = await User.create({
          name:item.name,email:item.email,username:item.username,passwordHash:await User.hashPassword(item.password),
          phone:item.phone,employeeId:item.employeeId,department:item.department,designation:item.designation,
          role:'employee',employeeType:item.employeeType,isActive:true,attendanceScheduleEnabled:item.attendanceScheduleEnabled,checkInTime:item.checkInTime,
          graceMinutes:grace,checkOutTime:item.checkOutTime,allowMultipleCheckIns:item.allowMultipleCheckIns,maxCheckInsPerDay:loginLimit,
          profileImageFilename: saveImportedProfileImage(embeddedImages.find(img => img.row === i))
        });
        created.push(clean(user));
      } catch (err) {
        skipped.push({row:rowNumber,name:item.name,reason:err.code === 11000 ? 'Email or username already exists.' : (err.message || 'Could not create employee.')});
      }
    }
    const withPhotos = created.filter(u => u.profileImageUrl).length;
    return res.status(201).json({success:true,message:`Bulk import complete: ${created.length} employee(s) created, ${skipped.length} row(s) skipped.${withPhotos ? ` ${withPhotos} profile picture(s) imported.` : ''}`,created,skipped});
  } catch (err) { next(err); }
  finally { if (tempPath) { try { await fs.promises.unlink(tempPath); } catch (_) {} } }
}

const clean=u=>{
  if(!u) return null;
  if(typeof u.toSafeObject==='function') return u.toSafeObject();
  return User.hydrate(u).toSafeObject();
};
const indiaDate = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata'}).format(new Date());
const attendanceStats = async () => {
  const rows = await Attendance.aggregate([
    {$match:{status:{$in:['present','late','absent']}}},
    {$group:{_id:'$employee', attended:{$sum:{$cond:[{$in:['$status',['present','late']]},1,0]}}, total:{$sum:1}}}
  ]);
  return Object.fromEntries(rows.map(r=>[String(r._id), {attended:r.attended,total:r.total,percentage:r.total?Number(((r.attended/r.total)*100).toFixed(1)):0}]));
};
async function overview(req,res,next){try{
  const [employees,clients,pendingLeaves,attToday,latestMessages,stats,settings,holidays]=await Promise.all([
    User.find({role:'employee'}).sort({name:1}).lean(),
    Client.find().populate('assignedEmployees','name username employeeId').lean(),
    LeaveRequest.countDocuments({status:'pending'}),
    Attendance.countDocuments({date:indiaDate(),status:{$in:['present','late']}}),
    Message.find({channel:'public'}).sort({createdAt:-1}).limit(20).populate('sender','name role').lean(),
    attendanceStats(),
    AttendanceSettings.findOne({key:'company'}).lean(),
    Holiday.find().sort({date:1}).lean()
  ]);
  const safeEmployees=employees.map(e=>({...clean(e),attendancePercentage:stats[String(e._id)]?.percentage??0,attendanceAttended:stats[String(e._id)]?.attended??0,attendanceTotal:stats[String(e._id)]?.total??0}));
  res.json({success:true,employees:safeEmployees,clients,pendingLeaves,attToday,latestMessages,attendanceStats:stats,attendanceSettings:settings||{key:'company',enabled:false,checkInTime:'09:00',graceMinutes:10,checkOutTime:'18:00'},holidays})
}catch(e){next(e)}}
async function createEmployee(req,res,next){try{
  const {name,email,username,password,phone,employeeId,department,designation,employeeType='employee',attendanceScheduleEnabled=true,checkInTime,graceMinutes=10,checkOutTime,allowMultipleCheckIns=false,maxCheckInsPerDay=1}=req.body;
  if(!name||!email||!username||!password)return res.status(400).json({success:false,message:'Name, email, username and password are required.'});
  const type = ['employee','intern','wfh'].includes(String(employeeType).toLowerCase()) ? String(employeeType).toLowerCase() : 'employee';
  const scheduleEnabled = asBool(attendanceScheduleEnabled, true);
  const timeOk=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||''));
  const ci=scheduleEnabled ? String(checkInTime||'') : '09:00';
  const co=scheduleEnabled ? String(checkOutTime||'') : '18:00';
  if(scheduleEnabled && (!timeOk(ci)||!timeOk(co)))return res.status(400).json({success:false,message:'Fixed schedule employees need check-in and check-out times in HH:MM format.'});
  const grace=Number(graceMinutes);
  if(!Number.isFinite(grace)||grace<0||grace>120)return res.status(400).json({success:false,message:'Employee grace period must be between 0 and 120 minutes.'});
  if(scheduleEnabled && minutesFromTime(co)<=minutesFromTime(ci))return res.status(400).json({success:false,message:'Employee check-out time must be after check-in time.'});
  const loginLimit=Number(maxCheckInsPerDay); if(!Number.isInteger(loginLimit)||loginLimit<1||loginLimit>50)return res.status(400).json({success:false,message:'Maximum check-in sessions per day must be a whole number from 1 to 50.'});
  if(await User.findOne({$or:[{email:email.toLowerCase()},{username:username.toLowerCase()}]}))return res.status(409).json({success:false,message:'Email or username already exists.'});
  const u=await User.create({name,email:email.toLowerCase(),username:username.toLowerCase(),phone,passwordHash:await User.hashPassword(password),role:'employee',employeeType:type,employeeId,department,designation,isActive:true,attendanceScheduleEnabled:scheduleEnabled,checkInTime:ci,graceMinutes:grace,checkOutTime:co,allowMultipleCheckIns:asBool(allowMultipleCheckIns, false),maxCheckInsPerDay:loginLimit});
  res.status(201).json({success:true,user:clean(u)})
}catch(e){next(e)}}
function minutesFromTime(value){const [h,m]=String(value||'00:00').split(':').map(Number);return h*60+m;}
function asBool(value, fallback=false){ if(typeof value==='boolean') return value; const v=String(value??'').trim().toLowerCase(); if(['true','1','yes','on'].includes(v)) return true; if(['false','0','no','off','disabled'].includes(v)) return false; return fallback; }
async function createClient(req,res,next){try{const {companyName,contactPerson,email,phone,address,service,notes,username,password}=req.body;if(!companyName||!contactPerson)return res.status(400).json({success:false,message:'Company name and contact person are required.'});const assignedEmployees=Array.isArray(req.body.assignedEmployees)?req.body.assignedEmployees:(req.body.assignedEmployees?[req.body.assignedEmployees]:[]);const c=await Client.create({companyName,contactPerson,email,phone,address,service,notes,assignedEmployees});if(assignedEmployees.length)await User.updateMany({_id:{$in:assignedEmployees},role:'employee'},{$addToSet:{assignedClients:c._id}});let account=null;if(username&&password){if(await User.findOne({username:username.toLowerCase()}))return res.status(409).json({success:false,message:'Client username already exists.'});account=await User.create({name:contactPerson,email:(email||`${username}@andsolutions.com`).toLowerCase(),username:username.toLowerCase(),phone,passwordHash:await User.hashPassword(password),role:'client',clientId:c._id,clientCompany:companyName,isActive:true});}res.status(201).json({success:true,client:c,account:account?clean(account):null})}catch(e){next(e)}}
async function updateEmployee(req,res,next){try{
  const existing=await User.findOne({_id:req.params.id,role:'employee'});
  if(!existing)return res.status(404).json({success:false,message:'Employee not found.'});
  const patch={};['name','email','phone','employeeId','department','designation','isActive','employeeType','attendanceScheduleEnabled','allowMultipleCheckIns'].forEach(k=>{if(req.body[k]!==undefined)patch[k]=req.body[k]});
  if(patch.employeeType!==undefined && !['employee','intern','wfh'].includes(String(patch.employeeType))) return res.status(400).json({success:false,message:'Invalid employee category.'});
  if(req.body.email){patch.email=String(req.body.email).trim().toLowerCase();const taken=await User.findOne({email:patch.email,_id:{$ne:existing._id}});if(taken)return res.status(409).json({success:false,message:'Email already exists.'})}
  if(req.body.username){const username=String(req.body.username).trim().toLowerCase();const taken=await User.findOne({username,_id:{$ne:existing._id}});if(taken)return res.status(409).json({success:false,message:'Username already exists.'});patch.username=username}
  const timeOk=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||''));
  if(req.body.attendanceScheduleEnabled!==undefined || req.body.checkInTime!==undefined || req.body.checkOutTime!==undefined || req.body.graceMinutes!==undefined){
    const scheduleEnabled = req.body.attendanceScheduleEnabled !== undefined ? asBool(req.body.attendanceScheduleEnabled, existing.attendanceScheduleEnabled !== false) : existing.attendanceScheduleEnabled !== false;
    const ci=scheduleEnabled ? (req.body.checkInTime!==undefined?String(req.body.checkInTime):String(existing.checkInTime||'09:00')) : '09:00';
    const co=scheduleEnabled ? (req.body.checkOutTime!==undefined?String(req.body.checkOutTime):String(existing.checkOutTime||'18:00')) : '18:00';
    const grace=req.body.graceMinutes!==undefined?Number(req.body.graceMinutes):Number(existing.graceMinutes??10);
    if(scheduleEnabled && (!timeOk(ci)||!timeOk(co)))return res.status(400).json({success:false,message:'Fixed schedule employees need check-in and check-out times in HH:MM format.'});
    if(!Number.isFinite(grace)||grace<0||grace>120)return res.status(400).json({success:false,message:'Employee grace period must be between 0 and 120 minutes.'});
    if(scheduleEnabled && minutesFromTime(co)<=minutesFromTime(ci))return res.status(400).json({success:false,message:'Employee check-out time must be after check-in time.'});
    patch.attendanceScheduleEnabled=scheduleEnabled;patch.checkInTime=ci;patch.graceMinutes=grace;patch.checkOutTime=co;
  }
  if(req.body.allowMultipleCheckIns!==undefined){
    patch.allowMultipleCheckIns=asBool(req.body.allowMultipleCheckIns, existing.allowMultipleCheckIns === true);
  }
  if(req.body.maxCheckInsPerDay!==undefined){
    const loginLimit=Number(req.body.maxCheckInsPerDay);
    if(!Number.isInteger(loginLimit)||loginLimit<1||loginLimit>50)return res.status(400).json({success:false,message:'Maximum check-in sessions per day must be a whole number from 1 to 50.'});
    patch.maxCheckInsPerDay=loginLimit;
  }
  if(req.body.password){if(String(req.body.password).length<8)return res.status(400).json({success:false,message:'New password must be at least 8 characters.'});patch.passwordHash=await User.hashPassword(String(req.body.password))}
  const u=await User.findByIdAndUpdate(existing._id,patch,{new:true,runValidators:true});res.json({success:true,user:clean(u)})
}catch(e){next(e)}}
async function updateClient(req,res,next){try{const allowed=['companyName','contactPerson','email','phone','address','service','notes','status','assignedEmployees'];const patch={};allowed.forEach(k=>{if(req.body[k]!==undefined)patch[k]=req.body[k]});const c=await Client.findByIdAndUpdate(req.params.id,patch,{new:true,runValidators:true});if(!c)return res.status(404).json({success:false,message:'Client not found.'});if(req.body.assignedEmployees){await User.updateMany({role:'employee'},{$pull:{assignedClients:c._id}});await User.updateMany({_id:{$in:req.body.assignedEmployees},role:'employee'},{$addToSet:{assignedClients:c._id}})}const account=await User.findOne({role:'client',clientId:c._id});if(account){const accountPatch={};if(req.body.contactPerson!==undefined)accountPatch.name=req.body.contactPerson;if(req.body.email)accountPatch.email=String(req.body.email).trim().toLowerCase();if(req.body.phone!==undefined)accountPatch.phone=req.body.phone;if(req.body.companyName!==undefined)accountPatch.clientCompany=req.body.companyName;if(req.body.username){const username=String(req.body.username).trim().toLowerCase();const taken=await User.findOne({username,_id:{$ne:account._id}});if(taken)return res.status(409).json({success:false,message:'Client portal username already exists.'});accountPatch.username=username}if(req.body.password){if(String(req.body.password).length<8)return res.status(400).json({success:false,message:'New client portal password must be at least 8 characters.'});accountPatch.passwordHash=await User.hashPassword(String(req.body.password))}if(Object.keys(accountPatch).length)await User.findByIdAndUpdate(account._id,accountPatch)}res.json({success:true,client:c})}catch(e){next(e)}}
async function deleteEmployee(req,res,next){try{const employee=await User.findOne({_id:req.params.id,role:'employee'});if(!employee)return res.status(404).json({success:false,message:'Employee not found.'});const leaveRequests=await LeaveRequest.find({employee:employee._id}).select('proofPath');for(const leave of leaveRequests){if(leave.proofPath){try{await fs.promises.unlink(path.resolve(leave.proofPath));}catch(err){if(err.code!=='ENOENT') console.warn('Could not remove leave proof:',err.message);}}}await Promise.all([Attendance.deleteMany({employee:employee._id}),Performance.deleteMany({employee:employee._id}),LeaveRequest.deleteMany({employee:employee._id}),Message.deleteMany({$or:[{sender:employee._id},{recipient:employee._id}]}),Client.updateMany({assignedEmployees:employee._id},{$pull:{assignedEmployees:employee._id}}),User.deleteOne({_id:employee._id})]);res.json({success:true,message:'Employee and related records deleted successfully.'})}catch(e){next(e)}}
async function deleteClient(req,res,next){try{const client=await Client.findById(req.params.id);if(!client)return res.status(404).json({success:false,message:'Client not found.'});await Promise.all([User.updateMany({role:'employee',assignedClients:client._id},{$pull:{assignedClients:client._id}}),User.deleteMany({role:'client',clientId:client._id}),Client.deleteOne({_id:client._id})]);res.json({success:true,message:'Client and linked portal account deleted successfully.'})}catch(e){next(e)}}
async function getAttendance(req,res,next){try{
  const q={};if(req.query.employeeId)q.employee=req.query.employeeId;if(req.query.date)q.date=req.query.date;
  const [rows,stats,settings]=await Promise.all([Attendance.find(q).sort({date:-1}).limit(500).populate('employee','name username employeeId employeeType department designation checkInTime checkOutTime allowMultipleCheckIns maxCheckInsPerDay'),attendanceStats(),AttendanceSettings.findOne({key:'company'}).lean()]);
  const format=(sec)=>{const total=Math.max(0,Math.floor(Number(sec)||0)),h=Math.floor(total/3600),m=Math.floor((total%3600)/60);return `${h}h ${String(m).padStart(2,'0')}m`;};
  const attendance=rows.map(a=>{const o=a.toObject();if(!Array.isArray(o.sessions)||!o.sessions.length){o.sessions=o.checkIn?[{_id:`legacy-${a._id}`,checkIn:o.checkIn,checkOut:o.checkOut||null,durationSeconds:o.checkOut?Math.max(0,Math.floor((new Date(o.checkOut)-new Date(o.checkIn))/1000)):Math.max(0,Math.floor((Date.now()-new Date(o.checkIn))/1000))}]:[];}o.sessions=o.sessions.map(x=>({...x,durationSeconds:x.checkOut?Math.max(0,Math.floor((new Date(x.checkOut)-new Date(x.checkIn))/1000)):Math.max(0,Math.floor((Date.now()-new Date(x.checkIn))/1000))}));const seconds=o.sessions.reduce((sum,x)=>sum+Number(x.durationSeconds||0),0);const scheduled=Math.max(0,(minutesFromTime(o.employee?.checkOutTime||'18:00')-minutesFromTime(o.employee?.checkInTime||'09:00'))*60);return {...o,totalWorkingSeconds:seconds,totalWorkingDuration:format(seconds),workingDuration:format(seconds),overtimeSeconds:Math.max(0,seconds-scheduled),overtime:format(Math.max(0,seconds-scheduled))};});
  res.json({success:true,attendance,attendanceStats:stats,attendanceSettings:settings||{key:'company',enabled:false,checkInTime:'09:00',graceMinutes:10,checkOutTime:'18:00'}})
}catch(e){next(e)}}
async function setAttendance(req,res,next){try{
  const {employeeId,date,status,checkIn,checkOut,note}=req.body;
  if(!employeeId||!date) return res.status(400).json({success:false,message:'Employee and date are required.'});
  if(!['present','absent','late','leave','holiday'].includes(status||'present')) return res.status(400).json({success:false,message:'Invalid attendance status.'});
  const employee=await User.findOne({_id:employeeId,role:'employee',isActive:true});
  if(!employee) return res.status(404).json({success:false,message:'Active employee not found.'});
  const cleanTime=(value)=> value ? new Date(value) : null; const ci=cleanTime(checkIn),co=cleanTime(checkOut);
  if(ci && Number.isNaN(ci.getTime())) return res.status(400).json({success:false,message:'Invalid check-in time.'});
  if(co && Number.isNaN(co.getTime())) return res.status(400).json({success:false,message:'Invalid check-out time.'});
  if(ci && co && co<ci) return res.status(400).json({success:false,message:'Check-out cannot be before check-in.'});
  const existing=await Attendance.findOne({employee:employeeId,date});
  const sessions=existing?.sessions?.length ? existing.sessions : (existing?.checkIn?[{checkIn:existing.checkIn,checkOut:existing.checkOut||null,durationSeconds:0}]:[]);
  let nextSessions=sessions;
  if(ci){
    if(existing?.sessions?.length){ nextSessions=[...existing.sessions]; nextSessions[0]={...nextSessions[0].toObject?.()||nextSessions[0],checkIn:ci,checkOut:co||null,durationSeconds:co?Math.floor((co-ci)/1000):0}; }
    else nextSessions=[{checkIn:ci,checkOut:co||null,durationSeconds:co?Math.floor((co-ci)/1000):0}];
  } else if(status==='absent'||status==='leave'){ nextSessions=[]; }
  const a=await Attendance.findOneAndUpdate({employee:employeeId,date},{$set:{employee:employeeId,date,status:status||'present',sessions:nextSessions,checkIn:ci,checkOut:co,note:String(note||'').trim()}},{new:true,upsert:true,setDefaultsOnInsert:true,runValidators:true}).populate('employee','name username employeeId employeeType department designation checkInTime checkOutTime allowMultipleCheckIns maxCheckInsPerDay');
  res.json({success:true,message:'Attendance saved successfully.',attendance:a})
}catch(e){next(e)}}
async function deleteAttendance(req,res,next){try{const a=await Attendance.findByIdAndDelete(req.params.id);if(!a)return res.status(404).json({success:false,message:'Attendance record not found.'});res.json({success:true,message:'Attendance deleted successfully.'})}catch(e){next(e)}}
async function getAttendanceSettings(req,res,next){try{
  const settings=await AttendanceSettings.findOneAndUpdate({key:'company'},{$setOnInsert:{key:'company'}},{new:true,upsert:true,setDefaultsOnInsert:true}).lean();
  res.json({success:true,attendanceSettings:settings});
}catch(e){next(e)}}
async function updateAttendanceSettings(req,res,next){try{
  const {enabled,checkInTime,graceMinutes,checkOutTime}=req.body||{};
  const timeRe=/^([01]\d|2[0-3]):[0-5]\d$/;
  if(checkInTime!==undefined&&!timeRe.test(String(checkInTime)))return res.status(400).json({success:false,message:'Invalid check-in time. Use HH:MM.'});
  if(checkOutTime!==undefined&&!timeRe.test(String(checkOutTime)))return res.status(400).json({success:false,message:'Invalid check-out time. Use HH:MM.'});
  if(graceMinutes!==undefined&&(!Number.isInteger(Number(graceMinutes))||Number(graceMinutes)<0||Number(graceMinutes)>120))return res.status(400).json({success:false,message:'Grace period must be between 0 and 120 minutes.'});
  const patch={};
  if(enabled!==undefined)patch.enabled=!!enabled;
  if(checkInTime!==undefined)patch.checkInTime=String(checkInTime);
  if(graceMinutes!==undefined)patch.graceMinutes=Number(graceMinutes);
  if(checkOutTime!==undefined)patch.checkOutTime=String(checkOutTime);
  const settings=await AttendanceSettings.findOneAndUpdate({key:'company'},{$set:patch,$setOnInsert:{key:'company'}},{new:true,upsert:true,setDefaultsOnInsert:true,runValidators:true}).lean();
  res.json({success:true,message:'Attendance settings updated successfully.',settings});
}catch(e){next(e)}}
async function getHolidays(req,res,next){try{const rows=await Holiday.find().sort({date:1});res.json({success:true,holidays:rows});}catch(e){next(e)}}
async function createHoliday(req,res,next){try{const {date,name,appliesTo='all'}=req.body||{};if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(date||''))||!name)return res.status(400).json({success:false,message:'Date and holiday name are required.'});if(!['all','employee','intern','wfh'].includes(appliesTo))return res.status(400).json({success:false,message:'Invalid holiday scope.'});const h=await Holiday.findOneAndUpdate({date},{$set:{name:String(name).trim(),appliesTo,createdBy:req.user._id}}, {new:true,upsert:true,setDefaultsOnInsert:true,runValidators:true});res.status(201).json({success:true,holiday:h});}catch(e){next(e)}}
async function updateHoliday(req,res,next){try{const {date,name,appliesTo}=req.body||{};const patch={};if(date!==undefined)patch.date=String(date);if(name!==undefined)patch.name=String(name).trim();if(appliesTo!==undefined)patch.appliesTo=appliesTo;if(patch.date && !/^\\d{4}-\\d{2}-\\d{2}$/.test(patch.date))return res.status(400).json({success:false,message:'Invalid holiday date.'});if(patch.appliesTo&&!['all','employee','intern','wfh'].includes(patch.appliesTo))return res.status(400).json({success:false,message:'Invalid holiday scope.'});const h=await Holiday.findByIdAndUpdate(req.params.id,patch,{new:true,runValidators:true});if(!h)return res.status(404).json({success:false,message:'Holiday not found.'});res.json({success:true,holiday:h});}catch(e){next(e)}}
async function deleteHoliday(req,res,next){try{const h=await Holiday.findByIdAndDelete(req.params.id);if(!h)return res.status(404).json({success:false,message:'Holiday not found.'});await Attendance.deleteMany({date:h.date,status:'holiday',note:h.name});res.json({success:true,message:'Holiday deleted.'});}catch(e){next(e)}}
async function getPerformance(req,res,next){try{const rows=await Performance.find(req.query.employeeId?{employee:req.query.employeeId}:{}).sort({reviewDate:-1}).populate('employee','name username employeeId').populate('reviewedBy','name');res.json({success:true,performances:rows})}catch(e){next(e)}}
async function setPerformance(req,res,next){try{const {employeeId,overallScore,attendanceScore,workQuality,punctuality,clientHandling,remarks,reviewDate}=req.body;if(overallScore===undefined)return res.status(400).json({success:false,message:'Overall score is required.'});const p=await Performance.create({employee:employeeId,overallScore,attendanceScore,workQuality,punctuality,clientHandling,remarks,reviewDate:reviewDate||new Date(),reviewedBy:req.user._id});res.status(201).json({success:true,performance:p})}catch(e){next(e)}}
async function getLeaves(req,res,next){try{const rows=await LeaveRequest.find(req.query.status?{status:req.query.status}:{}).sort({createdAt:-1}).populate('employee','name username employeeId department');res.json({success:true,leaves:rows})}catch(e){next(e)}}
async function reviewLeave(req,res,next){try{const {status,adminNote}=req.body;if(!['approved','rejected'].includes(status))return res.status(400).json({success:false,message:'Invalid leave status.'});const l=await LeaveRequest.findByIdAndUpdate(req.params.id,{status,adminNote:adminNote||'',reviewedBy:req.user._id,reviewedAt:new Date()},{new:true});if(!l)return res.status(404).json({success:false,message:'Leave request not found.'});if(status==='approved'){const start=new Date(l.fromDate);const end=new Date(l.toDate);for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){const date=d.toISOString().slice(0,10);await Attendance.findOneAndUpdate({employee:l.employee,date},{employee:l.employee,date,status:'leave'},{upsert:true,new:true,setDefaultsOnInsert:true})}}res.json({success:true,leave:l})}catch(e){next(e)}}

function durationSecondsForAttendance(a) {
  if (a && typeof a.totalWorkingDurationSeconds === 'number') return a.totalWorkingDurationSeconds;
  return (a?.sessions || []).reduce((sum, s) => sum + Number(s.durationSeconds || 0), 0);
}
function durationText(seconds) {
  const n = Math.max(0, Number(seconds || 0));
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60);
  return `${h}h ${String(m).padStart(2,'0')}m`;
}
function exportUserRows(users) {
  return users.map(u => [u.name,u.employeeId,u.employeeType==='intern'?'Intern':u.employeeType==='wfh'?'WFH Employee':'Normal Employee',u.email,u.username,u.phone,u.department,u.designation,u.isActive?'Active':'Inactive',u.attendanceScheduleEnabled!==false?'Fixed':'Flexible',u.checkInTime||'',u.graceMinutes??'',u.checkOutTime||'',u.allowMultipleCheckIns?'Yes':'No',u.maxCheckInsPerDay||1,u.createdAt?new Date(u.createdAt).toISOString().slice(0,10):'']);
}
async function buildPeopleExport({employeeType, employeeId, includeLegacyNormal=false}={}) {
  const filter = {role:'employee'};
  if (employeeType) {
    if (includeLegacyNormal && employeeType === 'employee') {
      filter.$or = [{employeeType:'employee'}, {employeeType:{$exists:false}}, {employeeType:null}, {employeeType:''}];
    } else {
      filter.employeeType = employeeType;
    }
  }
  if (employeeId) filter._id = employeeId;
  const users = await User.find(filter).sort({name:1}).lean();
  const ids = users.map(u=>u._id);
  const [attendance, performance, leaves] = await Promise.all([
    Attendance.find({employee:{$in:ids}}).sort({date:1}).lean(),
    Performance.find({employee:{$in:ids}}).sort({reviewDate:-1}).lean(),
    LeaveRequest.find({employee:{$in:ids}}).sort({fromDate:1}).lean()
  ]);
  const names = new Map(users.map(u=>[String(u._id),u.name]));
  const employeeSheet = [['Name','Employee ID','Category','Email','Username','Phone','Department','Designation','Status','Schedule','Check-In','Grace Minutes','Check-Out','Multiple Sessions','Max Sessions/Day','Created Date'], ...exportUserRows(users)];
  const attendanceSheet = [['Employee','Employee ID','Date','Status','Sessions','Total Working Duration','Overtime','Note']];
  for (const a of attendance) {
    const user=users.find(u=>String(u._id)===String(a.employee));
    const secs=durationSecondsForAttendance(a);
    const scheduled=user?.attendanceScheduleEnabled===false?0:Math.max(0,(minutesFromTime(user?.checkOutTime||'18:00')-minutesFromTime(user?.checkInTime||'09:00'))*60); const overtime=scheduled?durationText(Math.max(0,secs-scheduled)):''; attendanceSheet.push([names.get(String(a.employee))||'',user?.employeeId||'',a.date,a.status,(a.sessions||[]).map((x,i)=>`S${i+1}: ${x.checkIn?new Date(x.checkIn).toLocaleString('en-IN'):''} - ${x.checkOut?new Date(x.checkOut).toLocaleString('en-IN'):'Active'}`).join(' | '),durationText(secs),overtime,a.note||'']);
  }
  const performanceSheet=[['Employee','Employee ID','Review Date','Overall','Attendance','Work Quality','Punctuality','Client Handling','Remarks']];
  for(const p of performance){const u=users.find(x=>String(x._id)===String(p.employee));performanceSheet.push([names.get(String(p.employee))||'',u?.employeeId||'',p.reviewDate?new Date(p.reviewDate).toLocaleDateString('en-IN'):'',p.overallScore,p.attendanceScore,p.workQuality,p.punctuality,p.clientHandling,p.remarks||'']);}
  const leaveSheet=[['Employee','Employee ID','From','To','Type','Status','Reason','Admin Note']];
  for(const l of leaves){const u=users.find(x=>String(x._id)===String(l.employee));leaveSheet.push([names.get(String(l.employee))||'',u?.employeeId||'',l.fromDate?new Date(l.fromDate).toLocaleDateString('en-IN'):'',l.toDate?new Date(l.toDate).toLocaleDateString('en-IN'):'',l.type||'',l.status||'',l.reason||'',l.adminNote||'']);}
  return {users,attendance,performance,leaves,buffer:buildWorkbook([{name:'Employees',rows:employeeSheet},{name:'Attendance',rows:attendanceSheet},{name:'Performance',rows:performanceSheet},{name:'Leaves',rows:leaveSheet}])};
}
async function downloadEmployeeData(req,res,next){try{
  const requestedType = req.query.type;
  const type = ['employee','intern','wfh'].includes(requestedType) ? requestedType : null;
  let report;
  if (req.query.employeeId) {
    report = await buildPeopleExport({employeeId:req.query.employeeId});
  } else if (type === 'employee') {
    // The Employees export includes both normal employees and WFH employees.
    // Include legacy normal employees whose employeeType was not stored in older V17.x records.
    const [normal, wfh] = await Promise.all([
      buildPeopleExport({employeeType:'employee', includeLegacyNormal:true}),
      buildPeopleExport({employeeType:'wfh'})
    ]);
    // Rebuild one combined workbook from both groups.
    const users = [...normal.users, ...wfh.users].sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
    const ids = users.map(u=>u._id);
    const [attendance, performance, leaves] = await Promise.all([
      Attendance.find({employee:{$in:ids}}).sort({date:1}).lean(),
      Performance.find({employee:{$in:ids}}).sort({reviewDate:-1}).lean(),
      LeaveRequest.find({employee:{$in:ids}}).sort({fromDate:1}).lean()
    ]);
    const names = new Map(users.map(u=>[String(u._id),u.name]));
    const employeeSheet = [['Name','Employee ID','Category','Email','Username','Phone','Department','Designation','Status','Schedule','Check-In','Grace Minutes','Check-Out','Multiple Sessions','Max Sessions/Day','Created Date'], ...exportUserRows(users)];
    const attendanceSheet = [['Employee','Employee ID','Date','Status','Sessions','Total Working Duration','Overtime','Note']];
    for (const a of attendance) {
      const user=users.find(u=>String(u._id)===String(a.employee));
      const secs=durationSecondsForAttendance(a);
      const scheduled=user?.attendanceScheduleEnabled===false?0:Math.max(0,(minutesFromTime(user?.checkOutTime||'18:00')-minutesFromTime(user?.checkInTime||'09:00'))*60);
      const overtime=scheduled?durationText(Math.max(0,secs-scheduled)):'';
      attendanceSheet.push([names.get(String(a.employee))||'',user?.employeeId||'',a.date,a.status,(a.sessions||[]).map((x,i)=>`S${i+1}: ${x.checkIn?new Date(x.checkIn).toLocaleString('en-IN'):''} - ${x.checkOut?new Date(x.checkOut).toLocaleString('en-IN'):'Active'}`).join(' | '),durationText(secs),overtime,a.note||'']);
    }
    const performanceSheet=[['Employee','Employee ID','Review Date','Overall','Attendance','Work Quality','Punctuality','Client Handling','Remarks']];
    for(const p of performance){const u=users.find(x=>String(x._id)===String(p.employee));performanceSheet.push([names.get(String(p.employee))||'',u?.employeeId||'',p.reviewDate?new Date(p.reviewDate).toLocaleDateString('en-IN'):'',p.overallScore,p.attendanceScore,p.workQuality,p.punctuality,p.clientHandling,p.remarks||'']);}
    const leaveSheet=[['Employee','Employee ID','From','To','Type','Status','Reason','Admin Note']];
    for(const l of leaves){const u=users.find(x=>String(x._id)===String(l.employee));leaveSheet.push([names.get(String(l.employee))||'',u?.employeeId||'',l.fromDate?new Date(l.fromDate).toLocaleDateString('en-IN'):'',l.toDate?new Date(l.toDate).toLocaleDateString('en-IN'):'',l.type||'',l.status||'',l.reason||'',l.adminNote||'']);}
    report={users,buffer:buildWorkbook([{name:'Employees',rows:employeeSheet},{name:'Attendance',rows:attendanceSheet},{name:'Performance',rows:performanceSheet},{name:'Leaves',rows:leaveSheet}])};
  } else {
    report=await buildPeopleExport({employeeType:type});
  }
  if(!report.users.length)return res.status(404).json({success:false,message:'No employee records found.'});
  const filename=req.query.employeeId ? 'employee-details.xlsx' : type==='intern'?'interns-data.xlsx':type==='wfh'?'wfh-employees-data.xlsx':type==='employee'?'employees-data.xlsx':'employees-and-interns-data.xlsx';
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
  res.send(report.buffer);
}catch(e){next(e)}}


async function updateEmployeePhoto(req, res, next) {
  try {
    const file = req.files?.photo;
    if (!file) return res.status(400).json({success:false,message:'Please choose a JPG, PNG or WebP image.'});
    const employee = await User.findOne({_id:req.params.id,role:'employee'});
    if (!employee) return res.status(404).json({success:false,message:'Employee not found.'});
    const old = employee.profileImageFilename;
    employee.profileImageFilename = file.filename;
    await employee.save();
    if (old) {
      const oldPath = path.join(__dirname,'..','..','private_uploads','profiles',path.basename(old));
      try { await fs.promises.unlink(oldPath); } catch (_) {}
    }
    res.json({success:true,message:'Profile picture updated successfully.',user:clean(employee)});
  } catch(e) { next(e); }
}

async function getEmployeeDetails(req,res,next){try{
  const u=await User.findOne({_id:req.params.id,role:'employee'}).lean();
  if(!u)return res.status(404).json({success:false,message:'Employee not found.'});
  const [attendance,performance,leaves]=await Promise.all([
    Attendance.find({employee:u._id}).sort({date:-1}).lean(),
    Performance.find({employee:u._id}).sort({reviewDate:-1}).lean(),
    LeaveRequest.find({employee:u._id}).sort({fromDate:-1}).lean()
  ]);
  const safe=clean(u);
  const total=attendance.filter(a=>['present','late','absent'].includes(a.status)).length;
  const attended=attendance.filter(a=>['present','late'].includes(a.status)).length;
  res.json({success:true,employee:{...safe,attendancePercentage:total?Number((attended/total*100).toFixed(1)):0,attendanceAttended:attended,attendanceTotal:total},attendance,performance,leaves});
}catch(e){next(e)}}

async function getEmployees(req,res,next){try{const rows=await User.find({role:'employee'}).sort({name:1}).lean();res.json({success:true,employees:rows.map(clean)})}catch(e){next(e)}}
async function getClients(req,res,next){try{const rows=await Client.find().sort({companyName:1}).populate('assignedEmployees','name username employeeId').lean();res.json({success:true,clients:rows})}catch(e){next(e)}}
async function getPrivateThreads(req,res,next){try{const employees=await User.find({role:'employee'}).select('name username employeeId');const messages=await Message.find({channel:'private'}).sort({createdAt:-1}).limit(500).populate('sender','name role username').populate('recipient','name role username');res.json({success:true,employees,messages})}catch(e){next(e)}}
async function getProof(req,res,next){try{const l=await LeaveRequest.findById(req.params.id);if(!l||!l.proofPath)return res.status(404).json({success:false,message:'Proof not found.'});res.sendFile(path.resolve(l.proofPath),{headers:{'Content-Disposition':`inline; filename=\"${path.basename(l.proofOriginalName||'proof')}\"`}},err=>{if(err)next(err)})}catch(e){next(e)}}
module.exports={overview,createEmployee,bulkCreateEmployees,createClient,updateEmployee,deleteEmployee,updateClient,deleteClient,getAttendance,setAttendance,deleteAttendance,getAttendanceSettings,updateAttendanceSettings,getPerformance,setPerformance,getLeaves,reviewLeave,getProof,getEmployees,getClients,getPrivateThreads,getHolidays,createHoliday,updateHoliday,deleteHoliday,getEmployeeDetails,downloadEmployeeData,updateEmployeePhoto};
