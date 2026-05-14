/**
 * web-auth.js — Auth routes for web public site
 * Mounted at /api/web/auth
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('./database');
const { initWebSchema } = require('./web-db');

// Ensure web tables exist
try { initWebSchema(); } catch(e) {}

// Register page
router.get('/register', (req, res) => {
  if (req.session.webUserId) return res.redirect('/web/dashboard');
  res.render('register', { title: 'Crear Cuenta - MapFiber', error: null, layout: 'layout' });
});

// Register handler
router.post('/register', (req, res) => {
  const { name, email, password, confirmPassword } = req.body;

  if (!email || !password) {
    return res.render('register', { title: 'Crear Cuenta - MapFiber', error: 'Correo y contraseña son requeridos', layout: 'layout' });
  }
  if (password !== confirmPassword) {
    return res.render('register', { title: 'Crear Cuenta - MapFiber', error: 'Las contraseñas no coinciden', layout: 'layout' });
  }
  if (password.length < 6) {
    return res.render('register', { title: 'Crear Cuenta - MapFiber', error: 'La contraseña debe tener al menos 6 caracteres', layout: 'layout' });
  }

  const existing = db.prepare('SELECT id FROM web_users WHERE email = ?').get(email);
  if (existing) {
    return res.render('register', { title: 'Crear Cuenta - MapFiber', error: 'Este correo ya está registrado', layout: 'layout' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO web_users (name, email, password) VALUES (?, ?, ?)').run(name || email.split('@')[0], email, hashedPassword);

  req.session.webUserId = result.lastInsertRowid;
  req.session.webUserEmail = email;
  req.session.webUserName = name;

  res.redirect('/web/dashboard');
});

// Login page
router.get('/login', (req, res) => {
  if (req.session.webUserId) return res.redirect('/web/dashboard');
  res.render('login', { title: 'Iniciar Sesión - MapFiber', error: null, layout: 'layout' });
});

// Login handler
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { title: 'Iniciar Sesión - MapFiber', error: 'Correo y contraseña son requeridos', layout: 'layout' });
  }

  const user = db.prepare('SELECT * FROM web_users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { title: 'Iniciar Sesión - MapFiber', error: 'Correo o contraseña incorrectos', layout: 'layout' });
  }

  req.session.webUserId = user.id;
  req.session.webUserEmail = user.email;
  req.session.webUserName = user.name;

  res.redirect('/web/dashboard');
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/web');
});

module.exports = router;
