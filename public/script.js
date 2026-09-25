/**
 * A&C SOLUTIONS PVT. LTD. — MODERN CORPORATE INTERACTIVITY
 * Features: Scrollspy, Canvas Particle Network, IntersectionObserver, Mobile Drawer, Form Automation
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Header Scroll Effect & Scrollspy
  const header = document.getElementById('header');
  const navLinks = document.querySelectorAll('.nav-link');
  const sections = document.querySelectorAll('section[id], header[id]');

  let scrollTicking = false;
  const handleScroll = () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      if (window.scrollY > 30) header?.classList.add('scrolled');
      else header?.classList.remove('scrolled');

      let currentId = 'top';
      const scrollPos = window.scrollY + 120;
      sections.forEach(section => {
        const top = section.offsetTop;
        const bottom = top + section.offsetHeight;
        if (scrollPos >= top && scrollPos < bottom) currentId = section.id;
      });
      navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href')?.slice(1) === currentId));
      scrollTicking = false;
    });
  };
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();

  // 2. Mobile Menu Drawer
  const menuToggle = document.getElementById('menuToggle');
  const navMenu = document.getElementById('navMenu');

  if (menuToggle && navMenu) {
    menuToggle.addEventListener('click', () => {
      const isOpen = navMenu.classList.toggle('open');
      menuToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Close mobile menu on nav link click
    navMenu.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        navMenu.classList.remove('open');
        menuToggle.setAttribute('aria-expanded', 'false');
      });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (navMenu.classList.contains('open') && !navMenu.contains(e.target) && !menuToggle.contains(e.target)) {
        navMenu.classList.remove('open');
        menuToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // 3. Scroll Reveal Animations with IntersectionObserver
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -40px 0px'
  });

  document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

  // 4. Hero Background Particle Network Canvas (adaptive, battery-aware)
  const canvas = document.getElementById('heroCanvas');
  if (canvas && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const ctx = canvas.getContext('2d', { alpha: true });
    const parent = canvas.parentElement;
    let width = 0, height = 0, animationFrameId = 0, lastFrame = 0, isVisible = false;
    let particles = [];

    const resize = () => {
      if (!parent) return;
      width = parent.clientWidth; height = parent.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const areaCount = Math.floor((width * height) / 24000);
      const max = width < 700 ? 22 : 42;
      const count = Math.min(max, Math.max(10, areaCount));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width, y: Math.random() * height,
        vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35,
        r: Math.random() * 1.5 + .8, a: Math.random() * .4 + .15
      }));
    };
    const draw = (time) => {
      if (!isVisible) return;
      animationFrameId = requestAnimationFrame(draw);
      if (time - lastFrame < 33) return; // cap decorative animation near 30 FPS
      lastFrame = time;
      ctx.clearRect(0, 0, width, height);
      const maxDistance = width < 700 ? 105 : 135;
      const maxDistanceSq = maxDistance * maxDistance;
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(56,189,248,${p.a})`; ctx.fill();
      }
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          const dx = a.x - b.x, dy = a.y - b.y, distSq = dx * dx + dy * dy;
          if (distSq < maxDistanceSq) {
            const alpha = (1 - Math.sqrt(distSq) / maxDistance) * .18;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(0,210,255,${alpha})`; ctx.lineWidth = .7; ctx.stroke();
          }
        }
      }
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);
    const visibilityObserver = new IntersectionObserver(entries => {
      isVisible = entries[0]?.isIntersecting === true;
      cancelAnimationFrame(animationFrameId);
      if (isVisible) animationFrameId = requestAnimationFrame(draw);
    }, { threshold: .01 });
    visibilityObserver.observe(parent);
  }

  // 5. Internship CTA Handler & Form Preselection
  const internshipApplyBtn = document.getElementById('internshipApplyBtn');
  const serviceSelect = document.getElementById('contactService');
  const messageBox = document.getElementById('contactMessage');
  const internshipFields = document.getElementById('internshipFields');
  const internshipResume = document.getElementById('contactResume');
  const collegeInput = document.getElementById('contactCollege');

  const toggleInternshipFields = () => {
    if (!serviceSelect || !internshipFields) return;
    if (serviceSelect.value === 'IT Internship Application') {
      internshipFields.style.display = 'block';
      if (internshipResume) internshipResume.required = true;
      if (collegeInput) collegeInput.required = true;
      if (messageBox && !messageBox.value) {
        messageBox.placeholder = 'Please mention your key technical interests, project experiences, and why you would like to intern with A&C Solutions...';
      }
    } else {
      internshipFields.style.display = 'none';
      if (internshipResume) { internshipResume.required = false; internshipResume.value = ''; }
      if (collegeInput) collegeInput.required = false;
      if (messageBox && messageBox.placeholder.includes('intern with A&C Solutions')) {
        messageBox.placeholder = 'Describe your requirement or include your queries...';
      }
    }
  };

  if (internshipResume) {
    const drop = internshipResume.closest('.file-drop');
    if (drop) {
      ['dragenter','dragover'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.add('dragover'); }));
      ['dragleave','drop'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.remove('dragover'); }));
      drop.addEventListener('drop', e => { if (e.dataTransfer.files?.length) { try { internshipResume.files = e.dataTransfer.files; } catch (_) {} } });
    }
  }

  if (serviceSelect) {
    serviceSelect.addEventListener('change', toggleInternshipFields);
    toggleInternshipFields();
  }

  const selectInternship = () => {
    if (serviceSelect) {
      serviceSelect.value = 'IT Internship Application';
      toggleInternshipFields();
    }
  };

  if (internshipApplyBtn) {
    internshipApplyBtn.addEventListener('click', () => {
      selectInternship();
    });
  }

  // 6. Contact & Application Form Submission via REST API
  const contactForm = document.getElementById('contactForm');
  const formNote = document.getElementById('formNote');
  const contactSubmitBtn = document.getElementById('contactSubmitBtn');

  if (contactForm && formNote) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(contactForm);
      const name = (formData.get('name') || '').trim();
      const email = (formData.get('email') || '').trim();
      const phone = (formData.get('phone') || '').trim();
      const service = formData.get('service') || '';
      const message = (formData.get('message') || '').trim();

      const college = (formData.get('college') || '').trim();
      const branch = (formData.get('branch') || '').trim();
      const yearOfStudy = formData.get('yearOfStudy') || '';
      const skills = (formData.get('skills') || '').trim();

      if (contactSubmitBtn) {
        contactSubmitBtn.disabled = true;
        contactSubmitBtn.innerHTML = 'Submitting...';
      }

      formNote.className = 'form-status-msg';
      formNote.textContent = 'Processing your submission...';

      try {
        let endpoint = '/api/contact';
        let payload = {};

        if (service === 'IT Internship Application') {
          endpoint = '/api/internships/apply';
          const resume = formData.get('resume');
          if (!resume || !resume.name) throw new Error('Please upload your resume.');
          if (resume.size > 5 * 1024 * 1024) throw new Error('Resume must be 5 MB or smaller.');
          const ext = resume.name.toLowerCase().slice(resume.name.lastIndexOf('.'));
          if (!['.pdf', '.doc', '.docx'].includes(ext)) throw new Error('Resume must be PDF, DOC or DOCX.');
          const multipart = new FormData();
          multipart.append('fullName', name);
          multipart.append('email', email);
          multipart.append('phone', phone);
          multipart.append('college', college);
          multipart.append('course', branch);
          multipart.append('branch', branch);
          multipart.append('yearOfStudy', yearOfStudy);
          multipart.append('domain', 'IT & Technology');
          multipart.append('skills', skills);
          multipart.append('message', message);
          multipart.append('resume', resume);
          const res = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', body: multipart });
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || data.error || 'Submission failed. Please try again.');
          formNote.className = 'form-status-msg success';
          formNote.textContent = '✓ ' + (data.message || 'Internship application submitted successfully.');
          contactForm.reset();
          toggleInternshipFields();
          return;
        } else if (service === 'General Enquiry') {
          endpoint = '/api/contact';
          payload = {
            name,
            email,
            phone,
            subject: 'General Enquiry',
            message
          };
        } else {
          // Domain / Service Enquiries
          endpoint = '/api/enquiries';
          payload = {
            name,
            email,
            phone,
            domain: service,
            message
          };
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || data.error || 'Submission failed. Please try again.');
        }

        formNote.className = 'form-status-msg success';
        formNote.textContent = '✓ ' + (data.message || 'Submission received! Our team will get in touch with you shortly.');
        contactForm.reset();
        toggleInternshipFields();
      } catch (err) {
        formNote.className = 'form-status-msg error';
        formNote.textContent = '✕ ' + err.message;
      } finally {
        if (contactSubmitBtn) {
          contactSubmitBtn.disabled = false;
          contactSubmitBtn.innerHTML = 'Submit Enquiry <span>→</span>';
        }
      }
    });
  }

  // 7. Dynamic User Authentication State in Navigation
  const navAuthBtn = document.getElementById('navAuthBtn');
  if (navAuthBtn) {
    fetch('/api/me', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => {
        if (d && d.authenticated && d.user) {
          if (d.user.role === 'admin') {
            navAuthBtn.textContent = 'Admin Dashboard →';
            navAuthBtn.href = '/admin';
          } else {
            navAuthBtn.textContent = 'My Portal →';
            navAuthBtn.href = '/portal';
          }
        }
      })
      .catch(() => {});
  }
});

// Interactive service overview: the hero cards are real navigation controls.
document.querySelectorAll('.overview-link').forEach(link => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.overview-link').forEach(x => x.classList.remove('selected'));
    link.classList.add('selected');
  });
});
