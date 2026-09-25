(() => {
  'use strict';
  let data = {attendance:[],performances:[],leaves:[],clients:[],messages:[],privateMessages:[],todayAttendance:null};
  const $=s=>document.querySelector(s);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,opt={}){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const r=await fetch(url,{credentials:'include',cache:'no-store',headers:{'Accept':'application/json',...(opt.headers||{})},signal:controller.signal,...opt});
      const ct=r.headers.get('content-type')||'';
      const d=ct.includes('application/json')?await r.json():{message:await r.text()};
      if(!r.ok) throw new Error(d.message||`Request failed (${r.status})`);
      return d;
    }catch(e){
      if(e.name==='AbortError') throw new Error('The attendance server took too long to respond. Please try again.');
      throw e;
    }finally{clearTimeout(timer)}
  }
  function note(msg,good=false){const n=$('#note');if(n)n.innerHTML=`<div class="notice ${good?'success':'danger'}">${esc(msg)}</div>`;}
  function renderProfile(user){const img=$('#myProfileImage'),ph=$('#myProfilePlaceholder'),btn=$('#addProfilePhotoBtn'),noteEl=$('#profilePhotoNote');if(!img||!ph)return;if(user?.profileImageUrl){img.src=user.profileImageUrl+`?v=${Date.now()}`;img.hidden=false;ph.hidden=true;if(btn){btn.disabled=true;btn.textContent='Profile Picture Added';}if(noteEl)noteEl.textContent='Your profile picture is set. Only an administrator can update it.';}else{img.hidden=true;ph.hidden=false;if(btn){btn.disabled=false;btn.textContent='Add Profile Picture';}if(noteEl)noteEl.textContent='Add your picture once. After it is added, only an administrator can replace it.';}}
  async function uploadProfilePhoto(){const input=$('#profilePhotoInput');if(!input?.files?.[0])return;const fd=new FormData();fd.append('photo',input.files[0]);const btn=$('#addProfilePhotoBtn');if(btn)btn.disabled=true;try{const d=await api('/api/users/me/photo',{method:'POST',body:fd,headers:{Accept:'application/json'}});data.user=d.user;renderProfile(d.user);note(d.message,true);}catch(e){note(e.message);if(btn)btn.disabled=false;}finally{input.value='';}}
  function renderAttendance(){
    const rows=$('#attendance'); if(!rows)return;
    const counted=(data.attendance||[]).filter(a=>['present','late','absent'].includes(a.status));
    const attended=counted.filter(a=>['present','late'].includes(a.status)).length;
    const pctEl=$('#attendancePct'); if(pctEl)pctEl.textContent=counted.length?((attended/counted.length)*100).toFixed(1)+'%':'—';
    rows.innerHTML=(data.attendance||[]).map(a=>{
      const sessions=Array.isArray(a.sessions)?a.sessions:[];
      const sessionText=sessions.length?sessions.map((x,i)=>`Session ${i+1}: ${new Date(x.checkIn).toLocaleTimeString()} – ${x.checkOut?new Date(x.checkOut).toLocaleTimeString():'Active'} (${esc(duration(x.durationSeconds))})`).join('<br>'):'—';
      return `<tr><td>${esc(a.date)}</td><td>${esc(a.status)}</td><td>${sessionText}</td><td><strong>${esc(a.totalWorkingDuration||a.workingDuration||'0h 00m')}</strong>${a.overtimeSeconds>0?`<br><small>OT: ${esc(a.overtime||'0h 00m')}</small>`:''}</td></tr>`;
    }).join('')||'<tr><td colspan="4">No attendance yet.</td></tr>';
  }
  function duration(sec){const t=Math.max(0,Math.floor(Number(sec)||0)),h=Math.floor(t/3600),m=Math.floor((t%3600)/60);return `${h}h ${String(m).padStart(2,'0')}m`;}
  function updateAttendanceButtons(){
    const a=data.todayAttendance,inBtn=$('#checkInBtn'),outBtn=$('#checkOutBtn'),status=$('#todayAttendanceStatus');
    const sessions=Array.isArray(a?.sessions)?a.sessions:[]; const open=sessions.find(x=>!x.checkOut);
    if(status){ if(!a)status.textContent='Not checked in today'; else if(open)status.textContent=`Checked in at ${new Date(open.checkIn).toLocaleTimeString()} (active session ${sessions.findIndex(x=>x===open)+1})`; else if(sessions.length)status.textContent=`Checked out. ${sessions.length} session${sessions.length===1?'':'s'} completed today.`; else status.textContent=`Today: ${a.status}`; }
    if(inBtn) inBtn.disabled=!!open || a?.status==='leave' || a?.status==='absent';
    if(outBtn) outBtn.disabled=!open;
  }
  async function loadToday(){
    try{
      const d=await api('/api/workspace/employee/today-attendance');
      data.todayAttendance=d.attendance||null; updateAttendanceButtons(); return true;
    }catch(e){
      const status=$('#todayAttendanceStatus'); if(status)status.textContent='Attendance status unavailable';
      note(e.message); return false;
    }
  }
  async function loadDashboard(){
    try{
      const d=await api('/api/workspace/employee/dashboard'); data={...data,...d};
      if($('#welcome'))$('#welcome').innerHTML=`<span class="welcome-person">${d.user?.profileImageUrl?`<img class="welcome-avatar" src="${esc(d.user.profileImageUrl)}?v=${Date.now()}" alt="">`:'<span class="welcome-avatar placeholder">👤</span>'}<span>Welcome, ${esc(d.user?.name||'Employee')}</span></span>`; renderProfile(d.user);
      if($('#workSchedule')){const sch=d.schedule||{enabled:true,checkInTime:'09:00',graceMinutes:10,checkOutTime:'18:00'};$('#workSchedule').textContent=sch.enabled===false?'No fixed attendance time: you may Check In and Check Out anytime. Multiple sessions follow your assigned daily session limit.':`Your schedule: first check-in opens at ${sch.checkInTime} IST · ${sch.graceMinutes} min grace · Check out anytime after check-in (employee controlled).`;}
      if($('#present'))$('#present').textContent=(d.attendance||[]).length;
      if($('#score'))$('#score').textContent=d.performances?.[0]?d.performances[0].overallScore+'/100':'—';
      if($('#leaveCount'))$('#leaveCount').textContent=(d.leaves||[]).length;
      if($('#clientCount'))$('#clientCount').textContent=(d.clients||[]).length;
      if($('#todayLoginDuration'))$('#todayLoginDuration').textContent=d.todayWorkingDuration||'0h 00m';
      renderAttendance(); updateAttendanceButtons();
      if($('#performance'))$('#performance').innerHTML=(d.performances||[]).map(p=>`<div class="card"><b>${esc(p.overallScore)}/100</b><p>Attendance ${esc(p.attendanceScore)} · Quality ${esc(p.workQuality)} · Punctuality ${esc(p.punctuality)} · Client handling ${esc(p.clientHandling)}</p><small>${esc(p.remarks||'No remarks')}</small></div>`).join('')||'<p class="muted">No performance review yet.</p>';
      if($('#clients'))$('#clients').innerHTML=(d.clients||[]).map(c=>`<tr><td>${esc(c.companyName)}</td><td>${esc(c.service)}</td><td>${esc(c.contactPerson)}<br>${esc(c.phone||c.email||'')}</td></tr>`).join('')||'<tr><td colspan="3">No assigned clients.</td></tr>';
      if($('#leaves'))$('#leaves').innerHTML=(d.leaves||[]).map(l=>`<div class="card" style="margin-bottom:8px"><b>${l.type==='emergency'?'Emergency':'Advance'} Leave</b> <span class="badge">${esc(l.status)}</span><p>${new Date(l.fromDate).toLocaleDateString()} – ${new Date(l.toDate).toLocaleDateString()}</p><small>${esc(l.reason)}</small></div>`).join('')||'<p class="muted">No leave requests.</p>';
      renderMessages('#privateMessages',d.privateMessages);renderMessages('#publicMessages',d.messages);
      return true;
    }catch(e){note('Employee data could not be loaded: '+e.message);return false;}
  }
  function renderMessages(sel,arr){const el=$(sel);if(!el)return;el.innerHTML=(arr||[]).slice().reverse().map(m=>`<div class="msg"><b>${esc(m.sender?.name||'Admin')}</b><br><p>${esc(m.body)}</p><small>${m.createdAt?new Date(m.createdAt).toLocaleString():''}</small></div>`).join('')||'<p class="muted">No messages yet.</p>';}
  async function checkIn(){
    const b=$('#checkInBtn'); if(b)b.disabled=true;
    note('Recording check-in…');
    try{const r=await api('/api/workspace/employee/check-in',{method:'POST'});data.todayAttendance=r.attendance||null;note(r.message||'Check-in recorded successfully.',true);await Promise.all([loadToday(),loadDashboard()]);}
    catch(e){note(e.message);await loadToday();}
  }
  async function checkOut(){
    const b=$('#checkOutBtn'); if(b)b.disabled=true;
    note('Recording check-out…');
    try{const r=await api('/api/workspace/employee/check-out',{method:'POST'});data.todayAttendance=r.attendance||null;note(r.message||'Check-out recorded successfully.',true);await Promise.all([loadToday(),loadDashboard()]);}
    catch(e){note(e.message);await loadToday();}
  }
  async function send(form,channel){const body=new FormData(form).get('body');try{await api('/api/workspace/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body,channel})});form.reset();note('Message sent.',true);await loadDashboard()}catch(e){note(e.message)}}
  function init(){
    $('#checkInBtn')?.addEventListener('click',checkIn);$('#checkOutBtn')?.addEventListener('click',checkOut);$('#addProfilePhotoBtn')?.addEventListener('click',()=>$('#profilePhotoInput')?.click());$('#profilePhotoInput')?.addEventListener('change',uploadProfilePhoto);
    $('#leaveForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/workspace/employee/leave',{method:'POST',body:new FormData(e.target)});note('Leave request submitted.',true);e.target.reset();await loadDashboard()}catch(x){note(x.message)}});
    $('#privateForm')?.addEventListener('submit',e=>{e.preventDefault();send(e.target,'private')});
    $('#publicForm')?.addEventListener('submit',e=>{e.preventDefault();send(e.target,'public')});
    $('#logout')?.addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'})}finally{location.href=(data.user?.employeeType==='intern'?'/intern-login':'/employee-login')}});
    loadToday();loadDashboard();setInterval(()=>{loadToday();loadDashboard()},30000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
