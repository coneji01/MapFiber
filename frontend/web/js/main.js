/* ============================================
   MapFiber - Main JavaScript
   Fiber Optic Particle Animation & Interactions
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* --- Mobile Menu Toggle --- */
  const menuToggle = document.getElementById('menuToggle');
  const mobileMenu = document.getElementById('mobileMenu');

  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', () => {
      mobileMenu.classList.toggle('open');
      menuToggle.classList.toggle('open');
    });

    // Close menu on link click
    mobileMenu.querySelectorAll('.mobile-link').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        menuToggle.classList.remove('open');
      });
    });
  }

  /* --- Fiber Optic Canvas Animation --- */
  const canvas = document.getElementById('fiberCanvas');
  if (canvas) {
    initFiberAnimation(canvas);
  }



  /* --- FAQ Accordion --- */
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const isOpen = item.classList.contains('open');

      // Close all
      document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));

      // Toggle current
      if (!isOpen) item.classList.add('open');
    });
  });

  /* --- Subscribe Button --- */
  document.querySelectorAll('.subscribe-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      const plan = this.dataset.plan;

      // Plan display names
      const planNames = {
        basico: 'Básico',
        profesional: 'Profesional',
        enterprise: 'Enterprise'
      };
      const planPrices = {
        basico: '$10',
        profesional: '$20',
        enterprise: '$30'
      };
      const planKms = {
        basico: '20 km',
        profesional: '40 km',
        enterprise: '60 km'
      };

      // Show PayPal modal
      const modal = document.getElementById('paypalModal');
      const planInfo = document.getElementById('modalPlanInfo');
      if (modal && planInfo) {
        planInfo.textContent = `Plan ${planNames[plan] || plan} - ${planPrices[plan] || '$?'}/mes (${planKms[plan] || '?'})`;
        modal.classList.add('open');
      }

      // Call backend to create subscription
      try {
        const response = await fetch('/api/web/paypal/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan })
        });
        const data = await response.json();

        if (data.success && data.paypalPlanId) {
          console.log('Subscription initiated:', data);
          // In production, render PayPal buttons here
        } else if (data.error) {
          alert(data.error);
          if (modal) modal.classList.remove('open');
        }
      } catch (err) {
        console.error('Subscription error:', err);
      }
    });
  });

  /* --- Modal Close --- */
  const modalClose = document.getElementById('modalClose');
  const paypalModal = document.getElementById('paypalModal');

  if (modalClose && paypalModal) {
    modalClose.addEventListener('click', () => {
      paypalModal.classList.remove('open');
    });

    paypalModal.querySelector('.modal-backdrop')?.addEventListener('click', () => {
      paypalModal.classList.remove('open');
    });
  }

  /* --- Navbar scroll effect --- */
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    const currentScroll = window.pageYOffset;

    if (currentScroll > 100) {
      navbar.style.background = 'rgba(10, 10, 26, 0.95)';
    } else {
      navbar.style.background = 'rgba(10, 10, 26, 0.8)';
    }

    lastScroll = currentScroll;
  });
});

/* ============================================
   Fiber Optic Particle Animation
   ============================================ */
function initFiberAnimation(canvas) {
  const ctx = canvas.getContext('2d');
  let width, height;
  let particles = [];
  let mouseX = -1000, mouseY = -1000;
  let animationId;

  const PARTICLE_COUNT = 80;
  const CONNECTION_DISTANCE = 150;
  const MOUSE_CONNECT_DISTANCE = 200;

  class Particle {
    constructor() {
      this.reset();
    }

    reset() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.vx = (Math.random() - 0.5) * 0.8;
      this.vy = (Math.random() - 0.5) * 0.8;
      this.size = Math.random() * 3 + 1;
      this.opacity = Math.random() * 0.6 + 0.2;

      // Choose a color
      const colors = [
        { r: 0, g: 212, b: 255 },   // cyan
        { r: 83, g: 52, b: 131 },   // purple
        { r: 0, g: 255, b: 136 },   // green
      ];
      const c = colors[Math.floor(Math.random() * colors.length)];
      this.color = c;
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;

      // Wrap around edges
      if (this.x < -20) this.x = width + 20;
      if (this.x > width + 20) this.x = -20;
      if (this.y < -20) this.y = height + 20;
      if (this.y > height + 20) this.y = -20;
    }

    draw() {
      const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size * 3);
      gradient.addColorStop(0, `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${this.opacity})`);
      gradient.addColorStop(1, `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, 0)`);

      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${this.opacity})`;
      ctx.fill();

      // Glow
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * 3, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    }
  }

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  function drawConnections() {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < CONNECTION_DISTANCE) {
          const opacity = (1 - dist / CONNECTION_DISTANCE) * 0.3;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);

          // Gradient line color
          const gradient = ctx.createLinearGradient(
            particles[i].x, particles[i].y,
            particles[j].x, particles[j].y
          );
          gradient.addColorStop(0, `rgba(${particles[i].color.r}, ${particles[i].color.g}, ${particles[i].color.b}, ${opacity})`);
          gradient.addColorStop(1, `rgba(${particles[j].color.r}, ${particles[j].color.g}, ${particles[j].color.b}, ${opacity})`);

          ctx.strokeStyle = gradient;
          ctx.lineWidth = 0.5 + (1 - dist / CONNECTION_DISTANCE);

          // Cyan glow for certain connections
          if (Math.random() > 0.998) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#00d4ff';
          }

          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }
    }
  }

  function drawMouseConnections() {
    if (mouseX < 0 && mouseY < 0) return;

    for (const p of particles) {
      const dx = p.x - mouseX;
      const dy = p.y - mouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < MOUSE_CONNECT_DISTANCE) {
        const opacity = (1 - dist / MOUSE_CONNECT_DISTANCE) * 0.6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(mouseX, mouseY);
        ctx.strokeStyle = `rgba(0, 212, 255, ${opacity})`;
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#00d4ff';
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);

    // Update particles
    for (const p of particles) {
      p.update();
    }

    // Draw connections
    drawConnections();
    drawMouseConnections();

    // Draw particles
    for (const p of particles) {
      p.draw();
    }

    animationId = requestAnimationFrame(animate);
  }

  function init() {
    resize();
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(new Particle());
    }
    animate();
  }

  // Mouse tracking
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
  });

  canvas.addEventListener('mouseleave', () => {
    mouseX = -1000;
    mouseY = -1000;
  });

  // Touch tracking
  canvas.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    mouseX = touch.clientX - rect.left;
    mouseY = touch.clientY - rect.top;
  }, { passive: true });

  canvas.addEventListener('touchend', () => {
    mouseX = -1000;
    mouseY = -1000;
  });

  window.addEventListener('resize', resize);

  init();

  // Return cleanup function
  return () => {
    cancelAnimationFrame(animationId);
    window.removeEventListener('resize', resize);
  };
}


