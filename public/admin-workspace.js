(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const esc = (value) => String(value ?? '').replace(/[&<>\"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));

  let employees = [];
  let clients = []; let holidays = [];
  let activeTab = 'employees';
  let busy = false;
  let attendanceRecords = [];
  let attendanceSettings = { enabled:false, checkInTime:'09:00', graceMinutes:10, checkOutTime:'18:00' };

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      ...options
    });

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : { message: await response.text() };

    if (!response.ok) {
      throw new Error(data.message || data.error || `Request failed (${response.status})`);
    }
    return data;
  }

  function note(message, good = false) {
    const el = $('#note');
    if (!el) return;
    el.innerHTML = `<div class="notice ${good ? 'success' : 'danger'}">${esc(message)}</div>`;
  }

  function clearNote() {
    if ($('#note')) $('#note').innerHTML = '';
  }

  // Public so tab buttons can use onclick as a reliable fallback.
  window.showAdminTab = function (tabName) {
    const pane = document.getElementById(tabName);
    if (!pane) return;

    activeTab = tabName;
    try { history.replaceState(null, '', `#${tabName}`); } catch (_) {}

    $$('.tab').forEach((button) => {
      const isActive = button.dataset.tab === tabName;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Use the hidden attribute itself. workspace.css intentionally uses
    // `[hidden]{display:none!important}`, so an inline display style cannot
    // override it.
    $$('.tabpane').forEach((section) => {
      if (section.id === tabName) {
        section.removeAttribute('hidden');
      } else {
        section.setAttribute('hidden', '');
      }
    });

    // Load the selected area immediately so it never appears empty because
    // another panel's request failed.
    if (tabName === 'attendance') loadAttendance();
    if (tabName === 'performance') loadPerformance();
    if (tabName === 'leaves') loadLeaves();
    if (tabName === 'chat') loadMessages();
    if (tabName === 'holidays') loadHolidays();
  };

  function activateInitialTab() {
    const hash = location.hash.replace('#', '');
    const requested = document.getElementById(hash) && document.querySelector(`.tab[data-tab="${hash}"]`)
      ? hash : 'employees';
    window.showAdminTab(requested);
  }

  function renderEmployees() {
    const rows = $('#employeeRows');
    if (!rows) return;
    rows.innerHTML = employees.length
      ? employees.map((e) => `
          <tr>
            <td><div class="person-cell"><div>${e.profileImageUrl?`<img class="person-avatar" src="${esc(e.profileImageUrl)}?v=${Date.now()}" alt="">`:'<div class="person-avatar placeholder">👤</div>'}</div><div><a class="link-button" href="/api/workspace-admin/employees/${encodeURIComponent(e.id)}/details" data-action="view-employee" data-id="${esc(e.id)}"><strong>${esc(e.name)}</strong></a><br><small>${esc(e.username)}</small></div></div></td>
            <td>${esc(e.employeeId || '—')}</td>
            <td>${esc(e.department || '—')}</td>
            <td>${e.employeeType==='intern'?'Intern':e.employeeType==='wfh'?'WFH Employee':'Normal Employee'}</td>
            <td><span class="badge ${e.isActive ? 'green' : 'red'}">${e.isActive ? 'Active' : 'Inactive'}</span></td>
            <td><strong>${e.attendanceTotal ? `${Number(e.attendancePercentage || 0).toFixed(1)}%` : '—'}</strong><br><small>${e.attendanceAttended || 0}/${e.attendanceTotal || 0} counted days</small></td>
            <td>${e.attendanceScheduleEnabled !== false ? `<strong>${esc(e.checkInTime || '09:00')} – ${esc(e.checkOutTime || '18:00')}</strong><br><small>${Number(e.graceMinutes ?? 10)} min grace</small>` : '<strong>No fixed time</strong><br><small>Check in/out anytime</small>'}</td>
            <td><strong>${e.allowMultipleCheckIns ? `Up to ${Number(e.maxCheckInsPerDay || 1)} check-in sessions/day` : '1 session/day'}</strong><br><small>${e.allowMultipleCheckIns ? 'Multiple check-in/check-out sessions enabled' : 'Multiple check-in sessions disabled'}</small></td>
            <td><div class="actions"><button type="button" class="btn btn-light" data-action="edit-employee" data-id="${esc(e.id)}">Edit</button><button type="button" class="btn btn-red" data-action="delete-employee" data-id="${esc(e.id)}">Delete</button></div></td>
          </tr>`).join('')
      : '<tr><td colspan="9">No employees yet. Create the first employee using the form.</td></tr>';
  }

  function durationTextClient(seconds) { const n=Math.max(0,Number(seconds||0)); return `${Math.floor(n/3600)}h ${String(Math.floor((n%3600)/60)).padStart(2,'0')}m`; }
  function renderEmployeeDetail(data) {
    const e=data.employee||{}; const rows=data.attendance||[]; const perf=data.performance||[]; const leaves=data.leaves||[];
    const attRows=rows.length?rows.map(a=>{const secs=(a.sessions||[]).reduce((sum,x)=>sum+Number(x.durationSeconds||0),0);return `<tr><td>${esc(a.date)}</td><td>${esc(a.status)}</td><td>${(a.sessions||[]).map((x,i)=>`S${i+1}: ${x.checkIn?new Date(x.checkIn).toLocaleString('en-IN'):''} → ${x.checkOut?new Date(x.checkOut).toLocaleString('en-IN'):'Active'}`).join('<br>')||'—'}</td><td>${esc(durationTextClient(secs))}</td><td>${esc(a.note||'')}</td></tr>`}).join(''):'<tr><td colspan="5">No attendance records.</td></tr>';
    const perfRows=perf.length?perf.map(x=>`<tr><td>${x.reviewDate?esc(new Date(x.reviewDate).toLocaleDateString('en-IN')):'—'}</td><td>${esc(x.overallScore??'')}</td><td>${esc(x.attendanceScore??'')}</td><td>${esc(x.workQuality??'')}</td><td>${esc(x.punctuality??'')}</td><td>${esc(x.remarks||'')}</td></tr>`).join(''):'<tr><td colspan="6">No performance reviews.</td></tr>';
    const leaveRows=leaves.length?leaves.map(x=>`<tr><td>${x.fromDate?esc(new Date(x.fromDate).toLocaleDateString('en-IN')):'—'} – ${x.toDate?esc(new Date(x.toDate).toLocaleDateString('en-IN')):'—'}</td><td>${esc(x.type||'')}</td><td>${esc(x.status||'')}</td><td>${esc(x.reason||'')}</td></tr>`).join(''):'<tr><td colspan="4">No leave records.</td></tr>';
    $('#detailTitle').textContent=e.name||'Employee';
    $('#employeeDetailBody').innerHTML=`<div class="detail-profile">${e.profileImageUrl?`<img src="${esc(e.profileImageUrl)}?v=${Date.now()}" alt="${esc(e.name||'Employee')}">`:'<div class="person-avatar placeholder" style="width:110px;height:110px;font-size:42px">👤</div>'}<div><h3 style="margin:0 0 8px">${esc(e.name||'Employee')}</h3><div class="photo-actions"><button type="button" class="btn btn-blue" data-action="update-photo" data-id="${esc(e.id)}">${e.profileImageUrl?'Update Picture':'Add Picture'}</button><span class="muted">Only administrators can change this picture.</span></div></div></div><div class="detail-grid"><div class="detail-item"><small>Employee ID</small>${esc(e.employeeId||'—')}</div><div class="detail-item"><small>Category</small>${e.employeeType==='intern'?'Intern':e.employeeType==='wfh'?'WFH Employee':'Normal Employee'}</div><div class="detail-item"><small>Email</small>${esc(e.email||'—')}</div><div class="detail-item"><small>Phone</small>${esc(e.phone||'—')}</div><div class="detail-item"><small>Department</small>${esc(e.department||'—')}</div><div class="detail-item"><small>Designation</small>${esc(e.designation||'—')}</div><div class="detail-item"><small>Attendance</small>${esc(e.attendancePercentage??0)}% (${esc(e.attendanceAttended??0)}/${esc(e.attendanceTotal??0)})</div><div class="detail-item"><small>Schedule</small>${e.attendanceScheduleEnabled!==false?`${esc(e.checkInTime||'09:00')} – ${esc(e.checkOutTime||'18:00')} (${esc(e.graceMinutes??10)} min grace)`:'Flexible / No fixed time'}</div><div class="detail-item"><small>Multiple Sessions</small>${e.allowMultipleCheckIns?`Yes — up to ${esc(e.maxCheckInsPerDay||1)}/day`:'No'}</div><div class="detail-item"><small>Status</small>${e.isActive?'Active':'Inactive'}</div></div><div class="detail-section"><h3>Attendance & Working Duration</h3><div class="detail-table"><table class="table"><thead><tr><th>Date</th><th>Status</th><th>Sessions</th><th>Total</th><th>Note</th></tr></thead><tbody>${attRows}</tbody></table></div></div><div class="detail-section"><h3>Performance</h3><div class="detail-table"><table class="table"><thead><tr><th>Date</th><th>Overall</th><th>Attendance</th><th>Quality</th><th>Punctuality</th><th>Remarks</th></tr></thead><tbody>${perfRows}</tbody></table></div></div><div class="detail-section"><h3>Leave History</h3><div class="detail-table"><table class="table"><thead><tr><th>Dates</th><th>Type</th><th>Status</th><th>Reason</th></tr></thead><tbody>${leaveRows}</tbody></table></div></div>`;
    $('#employeeDetailModal').removeAttribute('hidden');
  }
  async function updateEmployeePhoto(id){
    const input=document.createElement('input');
    input.type='file'; input.accept='image/jpeg,image/png,image/webp'; input.style.display='none';
    document.body.appendChild(input);
    input.onchange=async()=>{
      try{
        if(!input.files?.[0]) return;
        const fd=new FormData(); fd.append('photo',input.files[0]);
        const d=await api('/api/workspace-admin/employees/'+encodeURIComponent(id)+'/photo',{method:'POST',body:fd});
        note(d.message,true); await loadOverview(); await viewEmployee(id);
      }catch(e){note(e.message);}
      finally{input.remove();}
    };
    input.click();
  }
  window.updateEmployeePhoto=updateEmployeePhoto;
  async function viewEmployee(id){try{const d=await api('/api/workspace-admin/employees/'+encodeURIComponent(id)+'/details');renderEmployeeDetail(d);}catch(e){note(e.message);}}
  window.viewEmployee = viewEmployee;
  async function downloadPeople(type){
    try {
      const endpoint = type === 'intern' ? '/api/workspace-admin/exports/interns.xlsx' : '/api/workspace-admin/exports/employees.xlsx';
      const response = await fetch(endpoint, {credentials:'include', cache:'no-store'});
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.toLowerCase().includes('spreadsheetml.sheet')) {
        const raw = await response.text();
        let message = `Excel export failed (${response.status}).`;
        try { const data=JSON.parse(raw); message=data.message || data.error || message; } catch (_) {}
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a=document.createElement('a'); a.href=url; a.download=type==='intern'?'interns-data.xlsx':'employees-data.xlsx'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      note('Excel export downloaded successfully.', true);
    } catch(e) { note(e.message); }
  }

  function renderClients(clients) {
    const rows = $('#clientRows');
    if (!rows) return;
    rows.innerHTML = clients.length
      ? clients.map((c) => `
          <tr>
            <td><strong>${esc(c.companyName)}</strong></td>
            <td>${esc(c.contactPerson)}<br>${esc(c.phone || c.email || '')}</td>
            <td>${esc(c.service || '—')}</td>
            <td>${(c.assignedEmployees || []).map((e) => esc(e.name)).join(', ') || '—'}</td>
            <td><div class="actions"><button type="button" class="btn btn-light" data-action="edit-client" data-id="${esc(c._id)}">Edit</button><button type="button" class="btn btn-red" data-action="delete-client" data-id="${esc(c._id)}">Delete</button></div></td>
          </tr>`).join('')
      : '<tr><td colspan="5">No clients yet.</td></tr>';
  }

  function renderInterns(){const rows=$('#internRows');if(!rows)return;const list=employees.filter(e=>e.employeeType==='intern');rows.innerHTML=list.length?list.map(e=>`<tr><td><div class="person-cell"><div>${e.profileImageUrl?`<img class="person-avatar" src="${esc(e.profileImageUrl)}?v=${Date.now()}" alt="">`:'<div class="person-avatar placeholder">👤</div>'}</div><div><a class="link-button" href="/api/workspace-admin/employees/${encodeURIComponent(e.id)}/details" data-action="view-employee" data-id="${esc(e.id)}"><strong>${esc(e.name)}</strong></a><br><small>${esc(e.username)}</small></div></div></td><td>${esc(e.employeeId||'—')}</td><td>${esc(e.department||'—')}</td><td><span class="badge ${e.isActive?'green':'red'}">${e.isActive?'Active':'Inactive'}</span></td><td>${e.attendanceScheduleEnabled!==false?`${esc(e.checkInTime||'09:00')} – ${esc(e.checkOutTime||'18:00')}<br><small>${Number(e.graceMinutes??10)} min grace</small>`:'No fixed time'}</td><td>${e.allowMultipleCheckIns?`Up to ${Number(e.maxCheckInsPerDay||1)}`:'1 session'}</td><td><div class="actions"><button type="button" class="btn btn-light" data-action="view-employee" data-id="${esc(e.id)}">View</button><button type="button" class="btn btn-light" data-action="edit-intern" data-id="${esc(e.id)}">Edit</button><button type="button" class="btn btn-red" data-action="delete-intern" data-id="${esc(e.id)}">Delete</button></div></td></tr>`).join(''):'<tr><td colspan="7">No interns yet.</td></tr>';}
  function renderHolidays(){const rows=$('#holidayRows');if(!rows)return;rows.innerHTML=holidays.length?holidays.map(h=>`<tr><td>${esc(h.date)}</td><td>${esc(h.name)}</td><td>${h.appliesTo==='all'?'Everyone':h.appliesTo==='intern'?'Interns':h.appliesTo==='wfh'?'WFH Employees':'Normal Employees'}</td><td><div class="actions"><button type="button" class="btn btn-light" data-action="edit-holiday" data-id="${esc(h._id)}">Edit</button><button type="button" class="btn btn-red" data-action="delete-holiday" data-id="${esc(h._id)}">Delete</button></div></td></tr>`).join(''):'<tr><td colspan="4">No holidays declared.</td></tr>';}
  async function loadHolidays(){try{const d=await api('/api/workspace-admin/holidays');holidays=d.holidays||[];renderHolidays();}catch(e){if($('#holidayRows'))$('#holidayRows').innerHTML=`<tr><td colspan="4">${esc(e.message)}</td></tr>`;}}

  function fillEmployeeSelects() {
    const options = employees.map((e) =>
      `<option value="${esc(e.id)}">${esc(e.name)}${e.employeeId ? ` — ${esc(e.employeeId)}` : ''}</option>`
    ).join('');

    const clientEmployees = $('#clientEmployees');
    if (clientEmployees) clientEmployees.innerHTML = options;

    const performance = $('#perfEmployee');
    if (performance) performance.innerHTML = options || '<option value="">Create an employee first</option>';

    const reply = $('#replyEmployee');
    if (reply) reply.innerHTML = options || '<option value="">No employees yet</option>';

    const attendance = $('#attEmployee');
    if (attendance) attendance.innerHTML = '<option value="">All employees</option>' + options;

    const attendanceForm = $('#attFormEmployee');
    if (attendanceForm) attendanceForm.innerHTML = options || '<option value="">Create an employee first</option>';
  }

  async function loadOverview() {
    const data = await api('/api/workspace-admin/overview');
    employees = Array.isArray(data.employees) ? data.employees : [];
    clients = [];
    holidays = Array.isArray(data.holidays) ? data.holidays : holidays;
    attendanceSettings = data.attendanceSettings || attendanceSettings;

    $('#empCount').textContent = employees.length;
    $('#internCount').textContent = employees.filter(e => e.employeeType === 'intern').length;
    $('#attCount').textContent = data.attToday ?? 0;
    $('#leaveCount').textContent = data.pendingLeaves ?? 0;

    renderEmployees();
    renderInterns(); renderHolidays();
    applyAttendanceSettingsUI();
    fillEmployeeSelects();
  }

  function applyAttendanceSettingsUI(){
    const e=$('#attRulesEnabled'), ci=$('#attRulesCheckIn'), g=$('#attRulesGrace'), co=$('#attRulesCheckOut');
    if(e)e.checked=!!attendanceSettings.enabled;
    if(ci)ci.value=attendanceSettings.checkInTime||'09:00';
    if(g)g.value=attendanceSettings.graceMinutes ?? 10;
    if(co)co.value=attendanceSettings.checkOutTime||'18:00';
    const st=$('#attendanceRuleStatus'); if(st)st.textContent=`New employees default to ${attendanceSettings.checkInTime||'09:00'} + ${attendanceSettings.graceMinutes??10} min grace. Checkout is employee-controlled and has no closing time.`;
  }
  function durationText(sec){const t=Math.max(0,Math.floor(Number(sec)||0)),h=Math.floor(t/3600),m=Math.floor((t%3600)/60);return `${h}h ${String(m).padStart(2,'0')}m`;}
  async function loadAttendance() {
    try {
      const query = new URLSearchParams();
      const employee = $('#attEmployee')?.value;
      const date = $('#attDate')?.value;
      if (employee) query.set('employeeId', employee);
      if (date) query.set('date', date);
      const data = await api('/api/workspace-admin/attendance?' + query.toString());
      attendanceRecords = data.attendance || [];
      const stats = data.attendanceStats || {};
      attendanceSettings = data.attendanceSettings || attendanceSettings;
      applyAttendanceSettingsUI();
      $('#attRows').innerHTML = attendanceRecords.map((a) => {
        const stat=stats[String(a.employee?._id||a.employee?.id||'')];
        const pct=stat ? `${Number(stat.percentage).toFixed(1)}%` : '—';
        return `<tr><td>${esc(a.employee?.name || '')}</td><td>${esc(a.date)}</td><td><span class="badge">${esc(a.status)}</span></td><td>${(a.sessions||[]).map((x,i)=>`<div><strong>Session ${i+1}</strong>: ${new Date(x.checkIn).toLocaleString()} – ${x.checkOut?new Date(x.checkOut).toLocaleString():'Active'} <small>(${esc(durationText(x.durationSeconds))})</small></div>`).join('') || '—'}</td><td><strong>${esc(a.totalWorkingDuration || '0h 00m')}</strong>${a.overtimeSeconds > 0 ? `<br><small>OT: ${esc(a.overtime || '0h 00m')}</small>` : ''}</td><td><strong>${pct}</strong></td><td><div class="actions"><button type="button" class="btn btn-light" data-action="edit-attendance" data-id="${esc(a._id)}">Edit</button><button type="button" class="btn btn-red" data-action="remove-attendance" data-id="${esc(a._id)}">Remove</button></div></td></tr>`;
      }).join('') || '<tr><td colspan="8">No attendance records.</td></tr>';
    } catch (error) {
      $('#attRows').innerHTML = `<tr><td colspan="8">${esc(error.message)}</td></tr>`;
    }
  }

  function editAttendance(id){
    const a=attendanceRecords.find(x=>String(x._id)===String(id)); if(!a)return;
    const form=$('#attendanceForm'); if(!form)return;
    form.dataset.editId=String(id);
    $('#attFormEmployee').value=String(a.employee?._id||a.employee?.id||'');
    $('#attFormDate').value=a.date||'';
    $('#attFormStatus').value=a.status||'present';
    $('#attFormCheckIn').value=a.checkIn?new Date(a.checkIn).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'}):'';
    $('#attFormCheckOut').value=a.checkOut?new Date(a.checkOut).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'}):'';
    form.elements.note.value=a.note||'';
    const submit=form.querySelector('button[type="submit"]'); if(submit)submit.textContent='Update Attendance';
    form.scrollIntoView({behavior:'smooth',block:'center'});
  }

  async function saveAttendanceSettings(event){
    event.preventDefault(); const form=event.currentTarget;
    const payload={enabled:$('#attRulesEnabled').checked,checkInTime:$('#attRulesCheckIn').value,graceMinutes:Number($('#attRulesGrace').value),checkOutTime:$('#attRulesCheckOut').value};
    try{ const d=await api('/api/workspace-admin/attendance-settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); attendanceSettings=d.settings; applyAttendanceSettingsUI(); note('Attendance time rules saved successfully.',true); }
    catch(e){note(e.message)}
  }

  async function saveAttendance(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    const date = fd.get('date');
    const status = fd.get('status');
    const checkIn = $('#attFormCheckIn')?.value;
    const checkOut = $('#attFormCheckOut')?.value;
    const payload = Object.fromEntries(fd.entries());
    const indiaDateTime = (d,t) => t ? `${d}T${t}:00+05:30` : null;
    payload.checkIn = (status === 'present' || status === 'late') ? indiaDateTime(date, checkIn) : null;
    payload.checkOut = (status === 'present' || status === 'late') ? indiaDateTime(date, checkOut) : null;
    try {
      await api('/api/workspace-admin/attendance', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      note('Attendance saved successfully.', true);
      form.dataset.editId=''; const submit=form.querySelector('button[type="submit"]'); if(submit)submit.textContent='Save Attendance';
      await loadAttendance();
      await loadOverview();
    } catch (error) { note(error.message); }
  }

  async function loadPerformance() {
    try {
      const data = await api('/api/workspace-admin/performance');
      $('#perfRows').innerHTML = (data.performances || []).map((p) => `
        <div class="card" style="margin-bottom:8px">
          <b>${esc(p.employee?.name || '')} — ${esc(p.overallScore)}/100</b>
          <p>Attendance ${esc(p.attendanceScore)} · Quality ${esc(p.workQuality)} · Punctuality ${esc(p.punctuality)} · Client ${esc(p.clientHandling)}</p>
          <small>${esc(p.remarks || 'No remarks')} · ${p.reviewDate ? new Date(p.reviewDate).toLocaleDateString() : ''}</small>
        </div>`).join('') || '<p class="muted">No reviews yet.</p>';
    } catch (error) {
      $('#perfRows').innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    }
  }

  async function loadLeaves() {
    try {
      const data = await api('/api/workspace-admin/leaves');
      $('#leaveRows').innerHTML = (data.leaves || []).map((l) => `
        <tr>
          <td>${esc(l.employee?.name || '')}<br><small>${esc(l.employee?.employeeId || '')}</small></td>
          <td>${esc(l.type)}</td>
          <td>${l.fromDate ? new Date(l.fromDate).toLocaleDateString() : ''} – ${l.toDate ? new Date(l.toDate).toLocaleDateString() : ''}</td>
          <td>${esc(l.reason)}${l.proofOriginalName ? `<br><a href="/api/workspace-admin/leaves/${encodeURIComponent(l._id)}/proof" target="_blank" rel="noopener">View proof</a>` : ''}</td>
          <td><span class="badge ${l.status === 'approved' ? 'green' : l.status === 'rejected' ? 'red' : 'amber'}">${esc(l.status)}</span></td>
          <td>${l.status === 'pending'
            ? `<div class="actions"><button type="button" class="btn btn-blue" data-action="review-leave" data-id="${esc(l._id)}" data-status="approved">Approve</button><button type="button" class="btn btn-red" data-action="review-leave" data-id="${esc(l._id)}" data-status="rejected">Reject</button></div>`
            : '—'}</td>
        </tr>`).join('') || '<tr><td colspan="6">No leave requests.</td></tr>';
    } catch (error) {
      $('#leaveRows').innerHTML = `<tr><td colspan="6">${esc(error.message)}</td></tr>`;
    }
  }

  window.reviewLeave = async function (id, status) {
    try {
      await api('/api/workspace-admin/leaves/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      note('Leave request updated.', true);
      await loadOverview();
      await loadLeaves();
    } catch (error) {
      note(error.message);
    }
  };

  async function loadMessages() {
    try {
      const data = await api('/api/workspace-admin/private-messages');
      $('#privateAdminMessages').innerHTML = (data.messages || []).map((m) => `
        <div class="card" style="margin-bottom:8px"><b>${esc(m.sender?.name || '')} → ${esc(m.recipient?.name || 'Admin')}</b>
        <p>${esc(m.body)}</p><small>${m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}</small></div>`).join('')
        || '<p class="muted">No private messages.</p>';

      const publicData = await api('/api/workspace/messages/public');
      $('#publicAdminMessages').innerHTML = (publicData.messages || []).map((m) => `
        <div class="card" style="margin-bottom:8px"><b>${esc(m.sender?.name || '')}</b><p>${esc(m.body)}</p></div>`).join('')
        || '<p class="muted">No public messages.</p>';
    } catch (error) {
      $('#privateAdminMessages').innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    }
  }

  function formObject(form) {
    const object = {};
    for (const [key, value] of new FormData(form).entries()) {
      if (key === 'assignedEmployees') {
        if (!Array.isArray(object[key])) object[key] = [];
        object[key].push(value);
      } else { object[key] = value; }
    }
    form.querySelectorAll('input[type=checkbox][name]').forEach(cb => { object[cb.name] = cb.checked; });
    return object;
  }

  function syncEmployeeScheduleUI() {
    const form = $('#employeeForm');
    if (!form) return;
    const enabled = form.elements.attendanceScheduleEnabled ? form.elements.attendanceScheduleEnabled.checked : true;
    const box = $('#employeeScheduleFields');
    if (box) box.style.opacity = enabled ? '1' : '.55';
    ['checkInTime','graceMinutes','checkOutTime'].forEach((name) => {
      const field = form.elements[name];
      if (field) field.disabled = !enabled;
    });
  }

  function resetEmployeeForm() {
    const form = $('#employeeForm');
    if (!form) return;
    form.dataset.editId = '';
    $('#employeeFormTitle').textContent = 'Add Employee';
    $('#employeeSubmit').textContent = 'Create Employee';
    $('#employeeCancel').hidden = true;
    const password = form.elements.password;
    if (password) { password.required = true; password.value = ''; }
    if (form.elements.attendanceScheduleEnabled) form.elements.attendanceScheduleEnabled.checked = true;
    if (form.elements.checkInTime) form.elements.checkInTime.value = attendanceSettings.checkInTime || '09:00';
    if (form.elements.graceMinutes) form.elements.graceMinutes.value = attendanceSettings.graceMinutes ?? 10;
    if (form.elements.checkOutTime) form.elements.checkOutTime.value = attendanceSettings.checkOutTime || '18:00';
    if(form.elements.employeeType) form.elements.employeeType.value='employee';
    if (form.elements.allowMultipleCheckIns) form.elements.allowMultipleCheckIns.checked = false;
    if (form.elements.maxCheckInsPerDay) form.elements.maxCheckInsPerDay.value = 1;
    syncEmployeeScheduleUI();
  }

  function resetClientForm() {
    const form = $('#clientForm');
    if (!form) return;
    form.dataset.editId = '';
    $('#clientFormTitle').textContent = 'Add Client';
    $('#clientSubmit').textContent = 'Create Client';
    $('#clientCancel').hidden = true;
    const password = form.elements.password;
    if (password) password.value = '';
  }

  window.editEmployee = function(id) {
    const e = employees.find(x => x.id === id);
    const form = $('#employeeForm');
    if (!e || !form) return;
    form.dataset.editId = id;
    form.elements.name.value = e.name || '';
    form.elements.employeeId.value = e.employeeId || '';
    form.elements.email.value = e.email || '';
    form.elements.username.value = e.username || '';
    form.elements.password.value = '';
    form.elements.phone.value = e.phone || '';
    form.elements.department.value = e.department || '';
    form.elements.designation.value = e.designation || '';
    if(form.elements.employeeType) form.elements.employeeType.value=e.employeeType||'employee';
    if (form.elements.attendanceScheduleEnabled) form.elements.attendanceScheduleEnabled.checked = e.attendanceScheduleEnabled !== false;
    form.elements.checkInTime.value = e.checkInTime || attendanceSettings.checkInTime || '09:00';
    form.elements.graceMinutes.value = e.graceMinutes ?? attendanceSettings.graceMinutes ?? 10;
    form.elements.checkOutTime.value = e.checkOutTime || attendanceSettings.checkOutTime || '18:00';
    if (form.elements.allowMultipleCheckIns) form.elements.allowMultipleCheckIns.checked = e.allowMultipleCheckIns === true;
    if (form.elements.maxCheckInsPerDay) form.elements.maxCheckInsPerDay.value = e.maxCheckInsPerDay ?? 1;
    syncEmployeeScheduleUI();
    $('#employeeFormTitle').textContent = `Edit Employee — ${e.name || ''}`;
    $('#employeeSubmit').textContent = 'Save Employee Changes';
    $('#employeeCancel').hidden = false;
    form.elements.password.required = false;
    window.showAdminTab('employees');
    form.scrollIntoView({behavior:'smooth', block:'center'});
  };

  window.editClient = function(id) {
    const c = clients.find(x => x._id === id);
    const form = $('#clientForm');
    if (!c || !form) return;
    form.dataset.editId = id;
    form.elements.companyName.value = c.companyName || '';
    form.elements.contactPerson.value = c.contactPerson || '';
    form.elements.email.value = c.email || '';
    form.elements.phone.value = c.phone || '';
    form.elements.address.value = c.address || '';
    form.elements.service.value = c.service || '';
    form.elements.notes.value = c.notes || '';
    const selected = new Set((c.assignedEmployees || []).map(e => String(e._id || e.id)));
    form.elements.assignedEmployees.value = '';
    Array.from(form.elements.assignedEmployees.options).forEach(o => o.selected = selected.has(o.value));
    form.elements.username.value = '';
    form.elements.password.value = '';
    $('#clientFormTitle').textContent = `Edit Client — ${c.companyName || ''}`;
    $('#clientSubmit').textContent = 'Save Client Changes';
    $('#clientCancel').hidden = false;
    window.showAdminTab('clients');
    form.scrollIntoView({behavior:'smooth', block:'center'});
  };

  window.editIntern=function(id){window.editEmployee(id);};
  window.deleteIntern=function(id){window.deleteEmployee(id);};
  async function saveHoliday(event){event.preventDefault();const form=event.currentTarget;const id=form.dataset.editId;const payload=formObject(form);try{const method=id?'PATCH':'POST';const url=id?'/api/workspace-admin/holidays/'+encodeURIComponent(id):'/api/workspace-admin/holidays';await api(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});note(id?'Holiday updated successfully.':'Holiday declared successfully.',true);form.reset();form.dataset.editId='';$('#holidayCancel').hidden=true;await loadHolidays();await loadOverview();window.showAdminTab('holidays');}catch(e){note(e.message)}}
  window.editHoliday=function(id){const h=holidays.find(x=>String(x._id)===String(id));const f=$('#holidayForm');if(!h||!f)return;f.dataset.editId=id;f.elements.date.value=h.date;f.elements.name.value=h.name;f.elements.appliesTo.value=h.appliesTo;$('#holidayCancel').hidden=false;window.showAdminTab('holidays');f.scrollIntoView({behavior:'smooth',block:'center'});};
  window.deleteHoliday=async function(id){if(!confirm('Delete this holiday?'))return;try{await api('/api/workspace-admin/holidays/'+encodeURIComponent(id),{method:'DELETE'});note('Holiday deleted.',true);await loadHolidays();await loadOverview();}catch(e){note(e.message)}};
  window.deleteEmployee = async function(id) {
    const employee = employees.find(x => x.id === id);
    if (!employee || !confirm(`Delete employee \"${employee.name || 'account'}\"? This will also remove their attendance, performance reviews, leave requests and messages. This cannot be undone.`)) return;
    try {
      await api('/api/workspace-admin/employees/' + encodeURIComponent(id), {method:'DELETE'});
      note('Employee deleted successfully.', true);
      resetEmployeeForm();
      await loadOverview();
      if (activeTab === 'attendance') await loadAttendance();
    } catch (error) { note(error.message); }
  };

  window.deleteClient = async function(id) {
    const client = clients.find(x => x._id === id);
    if (!client || !confirm(`Delete client \"${client.companyName || 'account'}\"? The linked client portal account and employee assignment will also be removed. This cannot be undone.`)) return;
    try {
      await api('/api/workspace-admin/clients/' + encodeURIComponent(id), {method:'DELETE'});
      note('Client deleted successfully.', true);
      resetClientForm();
      await loadOverview();
    } catch (error) { note(error.message); }
  };

  window.removeAttendance = async function(id) {
    if (!id || !confirm('Remove this attendance record? This cannot be undone.')) return;
    try {
      await api('/api/workspace-admin/attendance/' + encodeURIComponent(id), {method:'DELETE'});
      note('Attendance record removed successfully.', true);
      await loadAttendance();
      await loadOverview();
    } catch (error) { note(error.message); }
  };

  async function updateEmployee(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const id = form.dataset.editId;
    const payload = formObject(form);
    if (!payload.password) delete payload.password;
    delete payload.employeeId; // re-add below so empty values are still intentionally saved
    payload.employeeId = form.elements.employeeId.value;
    try {
      await api('/api/workspace-admin/employees/' + encodeURIComponent(id), {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
      note('Employee details updated successfully.', true);
      resetEmployeeForm(); form.reset();
      await loadOverview();
    } catch (error) { note(error.message); }
  }

  async function updateClient(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const id = form.dataset.editId;
    const payload = formObject(form);
    if (!payload.username) delete payload.username;
    if (!payload.password) delete payload.password;
    payload.assignedEmployees = Array.from(form.elements.assignedEmployees.selectedOptions).map(o => o.value);
    try {
      await api('/api/workspace-admin/clients/' + encodeURIComponent(id), {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
      note('Client details updated successfully.', true);
      resetClientForm(); form.reset();
      await loadOverview();
    } catch (error) { note(error.message); }
  }

  function setupEmployeeDropZone() {
    const input = $('#employeeBulkFile');
    const drop = input?.closest('.file-drop');
    if (!input || !drop) return;
    ['dragenter','dragover'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.add('dragover'); }));
    ['dragleave','drop'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.remove('dragover'); }));
    drop.addEventListener('drop', e => { if (e.dataTransfer.files?.length) { try { input.files = e.dataTransfer.files; } catch (_) {} } });
  }

  async function bulkImportEmployees(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = $('#employeeBulkFile')?.files?.[0];
    const resultBox = $('#employeeBulkResult');
    if (!file) return note('Please choose an .xlsx file.');
    if (!file.name.toLowerCase().endsWith('.xlsx')) return note('Only .xlsx Excel files are supported.');
    if (file.size > 5 * 1024 * 1024) return note('Excel file must be 5 MB or smaller.');
    const button = form.querySelector('button[type="submit"]');
    try {
      if (button) { button.disabled = true; button.textContent = 'Importing…'; }
      const fd = new FormData();
      fd.append('file', file);
      const data = await api('/api/workspace-admin/employees/bulk', { method:'POST', body:fd });
      const skipped = data.skipped || [];
      if (resultBox) resultBox.innerHTML = `<div class="notice success">${esc(data.message || 'Import complete.')} ${skipped.length ? `<br><strong>Skipped rows:</strong> ${skipped.map(x => `Row ${esc(x.row)} — ${esc(x.name || 'unnamed')}: ${esc(x.reason)}`).join('<br>')}` : ''}</div>`;
      form.reset();
      await loadOverview();
    } catch (error) {
      if (resultBox) resultBox.innerHTML = `<div class="notice danger">${esc(error.message)}</div>`;
      else note(error.message);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Import Employees'; }
    }
  }

  async function createEmployee(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.editId) return updateEmployee(event);
    const button = event.submitter || form.querySelector('button[type="submit"], button:not([type])');
    try {
      if (button) button.disabled = true;
      clearNote();
      const result = await api('/api/workspace-admin/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formObject(form))
      });
      form.reset();
      resetEmployeeForm();
      // Immediately show the returned account, then reconcile with MongoDB.
      if (result.user) {
        employees = [result.user, ...employees.filter((e) => e.id !== result.user.id)];
        renderEmployees();
        fillEmployeeSelects();
      }
      note(`Employee "${result.user?.name || 'account'}" created successfully.`, true);
      await loadOverview();
    } catch (error) {
      note(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function createClient(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.editId) return updateClient(event);
    try {
      const result = await api('/api/workspace-admin/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formObject(form))
      });
      form.reset();
      resetClientForm();
      note(`Client "${result.client?.companyName || 'account'}" created successfully.`, true);
      await loadOverview();
      window.showAdminTab('clients');
    } catch (error) {
      note(error.message);
    }
  }

  async function savePerformance(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/api/workspace-admin/performance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formObject(form))
      });
      form.reset();
      note('Performance review saved successfully.', true);
      await loadPerformance();
      window.showAdminTab('performance');
    } catch (error) { note(error.message); }
  }

  async function sendPrivateReply(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/api/workspace/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formObject(form))
      });
      form.reset(); note('Private reply sent.', true); await loadMessages();
    } catch (error) { note(error.message); }
  }

  async function sendPublicMessage(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/api/workspace/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: new FormData(form).get('body'), channel: 'public' })
      });
      form.reset(); note('Public message posted.', true); await loadMessages();
    } catch (error) { note(error.message); }
  }

  async function loadAll() {
    if (busy) return;
    busy = true;
    try {
      await loadOverview();
      await Promise.allSettled([loadAttendance(), loadPerformance(), loadLeaves(), loadMessages(), loadHolidays()]);
    } catch (error) {
      note(error.message);
    } finally {
      busy = false;
      // Never let the refresh timer move the admin away from the tab they chose.
      window.showAdminTab(activeTab);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $$('.tab').forEach((button) => {
      button.type = 'button';
      button.addEventListener('click', () => window.showAdminTab(button.dataset.tab));
    });

    $('#internRows')?.addEventListener('click',event=>{const b=event.target.closest('[data-action]');if(!b)return;const id=b.dataset.id;if(b.dataset.action==='view-employee')window.viewEmployee(id);if(b.dataset.action==='edit-intern')window.editIntern(id);if(b.dataset.action==='delete-intern')window.deleteIntern(id);});
    $('#holidayRows')?.addEventListener('click',event=>{const b=event.target.closest('[data-action]');if(!b)return;const id=b.dataset.id;if(b.dataset.action==='edit-holiday')window.editHoliday(id);if(b.dataset.action==='delete-holiday')window.deleteHoliday(id);});
    $('#employeeRows')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      if (button.dataset.action === 'view-employee') { event.preventDefault(); window.viewEmployee(id); }
      if (button.dataset.action === 'edit-employee') window.editEmployee(id);
      if (button.dataset.action === 'delete-employee') window.deleteEmployee(id);
    });
    $('#clientRows')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      if (button.dataset.action === 'edit-client') window.editClient(id);
      if (button.dataset.action === 'delete-client') window.deleteClient(id);
    });

    $('#downloadEmployeesBtn')?.addEventListener('click',()=>downloadPeople('employee'));
    $('#downloadInternsBtn')?.addEventListener('click',()=>downloadPeople('intern'));
    document.addEventListener('click',(event)=>{
      if(event.target.closest('[data-close-detail]'))$('#employeeDetailModal')?.setAttribute('hidden','');
      const photoButton=event.target.closest('[data-action=\"update-photo\"]');
      if(photoButton){event.preventDefault();event.stopPropagation();window.updateEmployeePhoto(photoButton.dataset.id);}
    });

    $('#employeeForm')?.addEventListener('submit', createEmployee);
    $('#holidayForm')?.addEventListener('submit', saveHoliday);
    $('#holidayCancel')?.addEventListener('click',()=>{const f=$('#holidayForm');f.reset();f.dataset.editId='';$('#holidayCancel').hidden=true;});
    $('#addInternBtn')?.addEventListener('click',()=>{resetEmployeeForm();if($('#employeeForm')?.elements.employeeType)$('#employeeForm').elements.employeeType.value='intern';window.showAdminTab('employees');$('#employeeForm')?.scrollIntoView({behavior:'smooth',block:'center'});});
    $('#employeeScheduleEnabled')?.addEventListener('change', syncEmployeeScheduleUI);
    $('#employeeBulkForm')?.addEventListener('submit', bulkImportEmployees);
    setupEmployeeDropZone();
    $('#employeeCancel')?.addEventListener('click', () => { $('#employeeForm').reset(); resetEmployeeForm(); });
    
    
    $('#attendanceForm')?.addEventListener('submit', saveAttendance);
    $('#attendanceSettingsForm')?.addEventListener('submit', saveAttendanceSettings);
    $('#attRows')?.addEventListener('click', (event) => { const button=event.target.closest('[data-action]'); if(!button)return; const id=button.dataset.id; if(button.dataset.action==='edit-attendance') editAttendance(id); if(button.dataset.action==='remove-attendance') window.removeAttendance(id); });
    $('#leaveRows')?.addEventListener('click', (event) => { const button=event.target.closest('[data-action="review-leave"]'); if(!button)return; window.reviewLeave(button.dataset.id, button.dataset.status); });
    $('#attFilterBtn')?.addEventListener('click', loadAttendance);
    $('#perfForm')?.addEventListener('submit', savePerformance);
    $('#replyForm')?.addEventListener('submit', sendPrivateReply);
    $('#publicAdminForm')?.addEventListener('submit', sendPublicMessage);
    $('#logout')?.addEventListener('click', async () => {
      try { await api('/api/logout', { method: 'POST' }); } finally { location.href = '/admin-login'; }
    });

    resetEmployeeForm();
    activateInitialTab();
    loadAll();
    setInterval(loadAll, 15000);
  });
})();
