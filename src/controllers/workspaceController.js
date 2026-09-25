const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const Client = require('../models/Client');
const Attendance = require('../models/Attendance');
const Performance = require('../models/Performance');
const LeaveRequest = require('../models/LeaveRequest');
const Message = require('../models/Message');
const AttendanceSettings = require('../models/AttendanceSettings');
const LoginLog = require('../models/LoginLog');
const Holiday = require('../models/Holiday');
const logger = require('../utils/logger');
const environment = require('../config/environment');
const { sendAttendanceEmail, sendDailyAttendanceSummaryEmail, calculateWorkingHours } = require('../utils/emailService');

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const indiaTime = () => new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
const minutesOf = (hhmm) => { const [h,m]=String(hhmm||'00:00').split(':').map(Number); return h*60+m; };
function istDayRange(dateString) { return { start:new Date(`${dateString}T00:00:00+05:30`), end:new Date(`${dateString}T23:59:59.999+05:30`) }; }
function formatDuration(seconds) { const total=Math.max(0,Math.floor(Number(seconds)||0)); const h=Math.floor(total/3600), m=Math.floor((total%3600)/60); return `${h}h ${String(m).padStart(2,'0')}m`; }
function sessionDurationSeconds(session, endAt=new Date()) {
  if(!session?.checkIn) return 0;
  const a=new Date(session.checkIn).getTime();
  const b=new Date(session.checkOut || endAt).getTime();
  return b>a ? Math.floor((b-a)/1000) : 0;
}
function normalizeAttendance(a) {
  const obj=a && typeof a.toObject==='function' ? a.toObject() : {...(a||{})};
  if(!Array.isArray(obj.sessions) || !obj.sessions.length) {
    if(obj.checkIn) obj.sessions=[{checkIn:obj.checkIn, checkOut:obj.checkOut||null, durationSeconds:sessionDurationSeconds({checkIn:obj.checkIn,checkOut:obj.checkOut})}];
    else obj.sessions=[];
  } else {
    obj.sessions=obj.sessions.map(x=>({...x,durationSeconds:sessionDurationSeconds(x,obj.checkOut||new Date())}));
  }
  const total=obj.sessions.reduce((sum,x)=>sum+Number(x.durationSeconds||sessionDurationSeconds(x)),0);
  obj.totalWorkingSeconds=total; obj.totalWorkingDuration=formatDuration(total);
  obj.workingDuration=formatDuration(total);
  obj.currentSession=obj.sessions.find(x=>!x.checkOut)||null;
  return obj;
}
function maxCheckIns(employee) { return employee?.allowMultipleCheckIns===true || employee?.allowMultipleLogins===true ? Number(employee?.maxCheckInsPerDay || employee?.maxLoginsPerDay || 1) : 1; }
async function getRules(){ return (await AttendanceSettings.findOne({key:'company'}).lean()) || {enabled:false,checkInTime:'09:00',graceMinutes:10,checkOutTime:'18:00'}; }
function normalizeIp(value){
  let ip=String(value||'').trim();
  if(!ip) return '';
  // Strip IPv4-mapped IPv6 and optional IPv6 brackets.
  ip=ip.replace(/^::ffff:/i,'').replace(/^\[(.*)\]$/,'$1');
  // Ignore a forwarded host:port form when it is IPv4.
  if(/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) ip=ip.replace(/:\d+$/,'');
  return ip;
}
function clientIp(req){
  // Express req.ip is the preferred value because trust proxy is configured
  // centrally (Render: 1 proxy hop). Fall back to common proxy headers for
  // local/proxy setups that do not populate req.ip as expected.
  return normalizeIp(
    req.ip ||
    req.headers['x-real-ip'] ||
    req.headers['cf-connecting-ip'] ||
    String(req.headers['x-forwarded-for']||'').split(',')[0] ||
    req.socket?.remoteAddress
  );
}
function officeIps(){
  return String(process.env.OFFICE_WIFI_PUBLIC_IPS||'')
    .split(',')
    .map(normalizeIp)
    .filter(Boolean);
}
function isLocalRequestIp(ip){
  return ip==='127.0.0.1' || ip==='::1' || ip==='localhost';
}
function officeNetworkAllowed(req){
  const configured=officeIps();
  const detected=clientIp(req);
  // Localhost is explicitly allowed for development/testing. This does not
  // weaken production access from another device; a remote device will have
  // its actual network IP and must match OFFICE_WIFI_PUBLIC_IPS.
  if(isLocalRequestIp(detected)) return !environment.isProduction;
  if(!configured.length) return !environment.isProduction;
  return configured.includes(detected);
}
function officeNetworkStatus(req){
  const detected=clientIp(req);
  const configured=officeIps();
  return {
    allowed:officeNetworkAllowed(req),
    detectedIp:detected,
    configuredIps:configured,
    production:environment.isProduction,
    local:isLocalRequestIp(detected)
  };
}
async function applicableHoliday(date, employee){
  const h=await Holiday.findOne({date}).lean();
  if(h && (h.appliesTo==='all' || h.appliesTo===employee.employeeType)) return h;
  // Interns have Sundays as holidays, but may voluntarily work.
  if(employee.employeeType==='intern'){
    const day=new Date(`${date}T12:00:00+05:30`).getDay();
    if(day===0) return {date,name:'Sunday',appliesTo:'intern',automatic:true};
  }
  return null;
}

function employeeSchedule(employee){ return {enabled:employee.attendanceScheduleEnabled!==false,checkInTime:employee.checkInTime||'09:00',graceMinutes:Number.isFinite(employee.graceMinutes)?employee.graceMinutes:10,checkOutTime:employee.checkOutTime||'18:00'}; }
async function enforceAbsentForToday(){
  const date=today();
  const now=minutesOf(indiaTime());
  const employees=await User.find({role:'employee',isActive:true});
  if(!employees.length) return;
  const ids=employees.map(e=>e._id);
  const existing=await Attendance.find({employee:{$in:ids},date}).select('employee status checkIn');
  const map=new Map(existing.map(a=>[String(a.employee),a]));
  const ops=[];
  for(const employee of employees){
    const schedule=employeeSchedule(employee);
    if(!schedule.enabled) continue;
    if(await applicableHoliday(date, employee)) continue;
    const deadline=minutesOf(schedule.checkInTime)+schedule.graceMinutes;
    const current=map.get(String(employee._id));
    if(now>deadline && !current){
      ops.push({updateOne:{filter:{employee:employee._id,date},update:{$setOnInsert:{employee:employee._id,date,status:'absent',note:`Automatically marked absent after ${schedule.checkInTime} IST + ${schedule.graceMinutes} minute grace period.`}},upsert:true}});
    }
  }
  if(ops.length) await Attendance.bulkWrite(ops,{ordered:false});
}


const safeUser = u => {
  if(!u) return null;
  if(typeof u.toSafeObject==='function') return u.toSafeObject();
  return User.hydrate(u).toSafeObject();
};

async function employeeDashboard(req,res,next){
  try {
    await enforceAbsentForToday();
    if(req.user.role!=='employee') return res.status(403).json({success:false,message:'Employee access required.'});
    const employee=req.user;
    const todayDate = today();
    const [attendance, todayAttendance, performances, leaves, clients]=await Promise.all([
      Attendance.find({employee:employee._id}).sort({date:-1}).limit(60).lean(),
      Attendance.findOne({employee:employee._id,date:todayDate}).lean(),
      Performance.find({employee:employee._id}).sort({reviewDate:-1}).limit(20).populate('reviewedBy','name username').lean(),
      LeaveRequest.find({employee:employee._id}).sort({createdAt:-1}).limit(30).lean(),
      Client.find({_id:{$in:employee.assignedClients||[]}}).sort({companyName:1}).lean()
    ]);
    const todayHoliday = await applicableHoliday(todayDate, employee);
    const todayNormalized = todayAttendance ? normalizeAttendance(todayAttendance) : (todayHoliday ? {date:todayDate,status:'holiday',sessions:[],totalWorkingSeconds:0,totalWorkingDuration:'0h 00m',workingDuration:'0h 00m'} : null);
    const todayWorkingSeconds = todayNormalized?.totalWorkingSeconds || 0;
    const scheduledSeconds = employee.attendanceScheduleEnabled !== false ? Math.max(0, (minutesOf(employee.checkOutTime || '18:00') - minutesOf(employee.checkInTime || '09:00')) * 60) : 0;
    const attendanceWithDuration = attendance.map(a => { const n=normalizeAttendance(a); const overtimeSeconds=Math.max(0,n.totalWorkingSeconds-scheduledSeconds); return {...n,overtimeSeconds,overtime:formatDuration(overtimeSeconds)}; });
    const messages=await Message.find({channel:'public'}).sort({createdAt:-1}).limit(50).populate('sender','name role').lean();
    const privateMessages=await Message.find({channel:'private',$or:[{sender:employee._id,recipient:null},{sender:employee._id},{recipient:employee._id}]}).sort({createdAt:-1}).limit(100).populate('sender','name role').lean();
    res.json({success:true,user:safeUser(employee),schedule:employeeSchedule(employee),today:todayDate,todayAttendance:todayNormalized,attendance:attendanceWithDuration,todayWorkingSeconds,todayWorkingDuration:formatDuration(todayWorkingSeconds),performances,leaves,clients,messages,privateMessages});
  }catch(e){next(e)}
}

async function todayAttendance(req,res,next){
  try {
    await enforceAbsentForToday();
    if(req.user.role!=='employee') return res.status(403).json({success:false,message:'Employee access required.'});
    const date=today();
    const attendance=await Attendance.findOne({employee:req.user._id,date}).lean();
    res.json({success:true,date,attendance:attendance?normalizeAttendance(attendance):null});
  }catch(e){next(e)}
}

async function clientDashboard(req,res,next){
  try{
    const u=req.user;
    const client= u.clientId ? await Client.findById(u.clientId).populate('assignedEmployees','name username employeeId department designation') : null;
    res.json({success:true,user:safeUser(u),client});
  }catch(e){next(e)}
}

async function officeNetworkStatusEndpoint(req,res,next){
  try {
    if(req.user.role!=='employee') return res.status(403).json({success:false,message:'Employee access required.'});
    res.json({success:true, ...officeNetworkStatus(req)});
  } catch(e){ next(e); }
}

async function checkIn(req,res,next){
  try{
    await enforceAbsentForToday();
    if(req.user.role!=='employee') return res.status(403).json({success:false,message:'Employee access required.'});
    const date=today();
    if((req.user.employeeType==='employee' || req.user.employeeType==='intern') && !officeNetworkAllowed(req)) return res.status(403).json({success:false,message:`Check-in is allowed only from the authorized company office network. Detected network IP: ${clientIp(req) || 'unknown'}. Connect to company Wi-Fi and try again.`});
    const holiday=await applicableHoliday(date, req.user);
    const schedule=employeeSchedule(req.user);
    let attendance=await Attendance.findOne({employee:req.user._id,date});
    if(attendance?.status==='leave') return res.status(409).json({success:false,message:'You are marked on leave today. Contact Admin if this is incorrect.'});
    if(attendance?.status==='absent') return res.status(409).json({success:false,message:'You are marked absent today. Contact Admin if this is incorrect.'});
    const sessions=attendance?.sessions?.length ? attendance.sessions : (attendance?.checkIn ? [{checkIn:attendance.checkIn,checkOut:attendance.checkOut}] : []);
    const completed=sessions.length;
    const open=sessions.find(x=>!x.checkOut);
    if(open) return res.status(409).json({success:false,message:'You are already checked in. Check out this session before starting another.',attendance:normalizeAttendance(attendance)});
    if(completed>=maxCheckIns(req.user)) return res.status(409).json({success:false,message:`Your daily check-in limit of ${maxCheckIns(req.user)} session${maxCheckIns(req.user)===1?'':'s'} has been reached.`,attendance:normalizeAttendance(attendance)});
    // Only the first check-in is subject to the scheduled opening/grace window.
    if(schedule.enabled && completed===0 && !holiday){
      const now=minutesOf(indiaTime()); const openMinute=minutesOf(schedule.checkInTime); const deadline=openMinute+schedule.graceMinutes;
      if(now<openMinute) return res.status(409).json({success:false,message:`Your check-in opens at ${schedule.checkInTime} IST.`});
      if(now>deadline) return res.status(409).json({success:false,message:`Your first check-in closed at ${String(Math.floor(deadline/60)).padStart(2,'0')}:${String(deadline%60).padStart(2,'0')} IST. You have been marked absent.`});
    }
    const checkInTimestamp=new Date();
    if(!attendance) attendance=new Attendance({employee:req.user._id,date,status:'present',sessions:[]});
    if(!Array.isArray(attendance.sessions)) attendance.sessions=[];
    attendance.sessions.push({checkIn:checkInTimestamp,checkOut:null,durationSeconds:0});
    if(!attendance.checkIn) attendance.checkIn=checkInTimestamp;
    attendance.checkOut=null; attendance.status='present';
    await attendance.save();
    const normalized=normalizeAttendance(attendance);
    const employeeEmail=req.user.email, employeeName=req.user.name||'Employee';
    let emailSent=false;
    const message='Check-in recorded successfully. You will receive your attendance email when you check out.';
    res.json({success:true,message,attendance:normalized});
  }catch(e){next(e)}
}

async function checkOut(req,res,next){
  try{
    if(req.user.role!=='employee') return res.status(403).json({success:false,message:'Employee access required.'});
    const date=today();
    if((req.user.employeeType==='employee' || req.user.employeeType==='intern') && !officeNetworkAllowed(req)) return res.status(403).json({success:false,message:`Check-out is allowed only from the authorized company office network. Detected network IP: ${clientIp(req) || 'unknown'}. Connect to company Wi-Fi and try again.`});
    const attendance=await Attendance.findOne({employee:req.user._id,date});
    if(!attendance) return res.status(400).json({success:false,message:'Please check in first.'});
    if(!Array.isArray(attendance.sessions) || !attendance.sessions.length){
      if(attendance.checkIn) attendance.sessions=[{checkIn:attendance.checkIn,checkOut:attendance.checkOut||null,durationSeconds:0}];
      else return res.status(400).json({success:false,message:'Please check in first.'});
    }
    const openIndex=attendance.sessions.map(x=>x.checkOut?1:0).lastIndexOf(0);
    if(openIndex<0) return res.status(409).json({success:false,message:'You are already checked out. Start another check-in session if allowed.',attendance:normalizeAttendance(attendance)});
    const checkoutTimestamp=new Date();
    const session=attendance.sessions[openIndex]; session.checkOut=checkoutTimestamp; session.durationSeconds=sessionDurationSeconds(session);
    attendance.checkOut=checkoutTimestamp;
    await attendance.save();
    const normalized=normalizeAttendance(attendance);
    const totalWorking=normalized.totalWorkingDuration;
    const scheduledSeconds=req.user.attendanceScheduleEnabled !== false ? Math.max(0,(minutesOf(req.user.checkOutTime||'18:00')-minutesOf(req.user.checkInTime||'09:00'))*60) : 0;
    const overtime=formatDuration(Math.max(0,normalized.totalWorkingSeconds-scheduledSeconds));
    const employeeEmail=req.user.email, employeeName=req.user.name||'Employee';
    let emailSent=false;
    if(employeeEmail){try{const emailResult=await sendAttendanceEmail({employeeEmail,employeeName,type:'check-out',date,checkInTime:session.checkIn,checkOutTime:checkoutTimestamp,workingHours:formatDuration(session.durationSeconds),loginDuration:totalWorking,overtime});emailSent=!!emailResult?.success;}catch(emailErr){logger.error(`Check-out email sending failed for ${employeeEmail}:`,emailErr.message);}}
    const message=emailSent?'Check-out recorded successfully. Working-duration confirmation email sent.':'Check-out recorded successfully. Email notification could not be sent.';
    res.json({success:true,message,attendance:normalized,sessionWorkingDuration:formatDuration(session.durationSeconds),todayWorkingDuration:totalWorking,overtime});
  }catch(e){next(e)}
}

async function applyLeave(req,res,next){try{
  const {type,fromDate,toDate,reason}=req.body;
  if(!['advance','emergency'].includes(type)||!fromDate||!toDate||!reason) return res.status(400).json({success:false,message:'Leave type, dates and reason are required.'});
  if(type==='advance' && new Date(fromDate) < new Date(today())) return res.status(400).json({success:false,message:'Advance leave must be submitted for a future date.'});
  if(new Date(toDate)<new Date(fromDate)) return res.status(400).json({success:false,message:'End date cannot be before start date.'});
  const leave=await LeaveRequest.create({employee:req.user._id,type,fromDate,toDate,reason,proofPath:req.file?req.file.path:'',proofOriginalName:req.file?req.file.originalname:''});
  res.status(201).json({success:true,leave});
}catch(e){next(e)}}

async function getPublicMessages(req,res,next){try{const messages=await Message.find({channel:'public'}).sort({createdAt:-1}).limit(100).populate('sender','name role');res.json({success:true,messages})}catch(e){next(e)}}
async function getPrivateMessages(req,res,next){try{const admin=await User.findOne({role:'admin',isActive:true}).select('_id name username'); const messages=await Message.find({channel:'private',$or:[{sender:req.user._id,recipient:admin?admin._id:null},{sender:admin?admin._id:null,recipient:req.user._id}]}).sort({createdAt:1}).populate('sender','name role');res.json({success:true,messages,admin})}catch(e){next(e)}}
async function sendMessage(req,res,next){try{
  const {body,channel}=req.body;
  if(!body||!body.trim()) return res.status(400).json({success:false,message:'Message cannot be empty.'});
  if(channel==='public'){
    if(req.user.role!=='admin'&&req.user.role!=='employee') return res.status(403).json({success:false,message:'Public employee room is not available to clients.'});
    const m=await Message.create({sender:req.user._id,channel:'public',body:body.trim()}); return res.status(201).json({success:true,message:m});
  }
  const admin=await User.findOne({role:'admin',isActive:true}); if(!admin)return res.status(500).json({success:false,message:'Admin account unavailable.'});
  const recipient=req.user.role==='admin' ? (req.body.recipientId||null) : admin._id;
  if(!recipient)return res.status(400).json({success:false,message:'Recipient is required.'});
  const m=await Message.create({sender:req.user._id,recipient,channel:'private',body:body.trim()}); res.status(201).json({success:true,message:m});
}catch(e){next(e)}}



async function getProfileImage(req, res, next) {
  try {
    const targetId = String(req.params.id || '');
    const user = await User.findOne({ _id: targetId, role:'employee' }).select('profileImageFilename').lean();
    if (!user || !user.profileImageFilename) return res.status(404).json({ success:false, message:'Profile picture not found.' });
    if (req.user.role !== 'admin' && String(req.user._id) !== targetId) return res.status(403).json({ success:false, message:'Not authorized.' });
    const filePath = path.join(__dirname, '..', '..', 'private_uploads', 'profiles', path.basename(user.profileImageFilename));
    if (!fs.existsSync(filePath)) return res.status(404).json({ success:false, message:'Profile picture file not found.' });
    const ext = path.extname(filePath).toLowerCase();
    const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', type); res.setHeader('Cache-Control','private, max-age=300');
    return res.sendFile(filePath);
  } catch (e) { next(e); }
}

async function sendDailyAttendanceSummaries(targetDate=today()) {
  if(environment.attendanceEmailMode!=='summary') return {processed:0,sent:0};
  const now=new Date();
  const rows=await Attendance.find({date:targetDate, status:{$in:['present','late']}, emailSummarySentAt:null}).populate('employee','name email employeeType attendanceScheduleEnabled checkInTime checkOutTime').lean();
  let sent=0;
  for(const row of rows){
    const employee=row.employee;
    if(!employee?.email) continue;
    const sessions=Array.isArray(row.sessions)?row.sessions:[];
    const totalWorkingSeconds=sessions.reduce((sum,session)=>sum+sessionDurationSeconds(session,now),0);
    const scheduledSeconds=employee.attendanceScheduleEnabled!==false ? Math.max(0,(minutesOf(employee.checkOutTime||'18:00')-minutesOf(employee.checkInTime||'09:00'))*60) : 0;
    const overtime=formatDuration(Math.max(0,totalWorkingSeconds-scheduledSeconds));
    try {
      const result=await sendDailyAttendanceSummaryEmail({
        employeeEmail:employee.email,
        employeeName:employee.name||'Employee',
        date:targetDate,
        sessions,
        totalWorkingDuration:formatDuration(totalWorkingSeconds),
        overtime,
        status:row.status
      });
      if(result?.success){
        await Attendance.updateOne({_id:row._id,emailSummarySentAt:null},{$set:{emailSummarySentAt:new Date()}});
        sent++;
      }
    } catch(err) {
      logger.error(`Daily attendance summary failed for ${employee.email}:`,err.message);
    }
  }
  return {processed:rows.length,sent};
}

module.exports={officeNetworkStatusEndpoint, enforceAbsentForToday,sendDailyAttendanceSummaries,employeeDashboard,todayAttendance,clientDashboard,checkIn,checkOut,applyLeave,getPublicMessages,getPrivateMessages,sendMessage,getProfileImage};
