/**
 * web-tutorials.js — Tutorial routes for web public site
 * Mounted at /api/web/tutorials
 */
const express = require('express');
const router = express.Router();
const db = require('./database');

// Tutorials listing
router.get('/', (req, res) => {
  const category = req.query.category || null;

  let tutorials;
  if (category) {
    tutorials = db.prepare('SELECT * FROM web_tutorials WHERE is_published = 1 AND category = ? ORDER BY created_at DESC').all(category);
  } else {
    tutorials = db.prepare('SELECT * FROM web_tutorials WHERE is_published = 1 ORDER BY created_at DESC').all();
  }

  const categories = db.prepare('SELECT DISTINCT category FROM web_tutorials WHERE is_published = 1').all();

  res.render('tutorials', {
    title: 'Tutoriales - MapFiber',
    tutorials,
    categories,
    activeCategory: category,
    layout: 'layout'
  });
});

// Single tutorial
router.get('/:slug', (req, res) => {
  const tutorial = db.prepare('SELECT * FROM web_tutorials WHERE slug = ? AND is_published = 1').get(req.params.slug);

  if (!tutorial) {
    return res.status(404).render('tutorial', { title: 'No encontrado - MapFiber', tutorial: null, related: [], layout: 'layout' });
  }

  const related = db.prepare('SELECT * FROM web_tutorials WHERE category = ? AND id != ? AND is_published = 1 LIMIT 3').all(tutorial.category, tutorial.id);

  res.render('tutorial', {
    title: `${tutorial.title} - MapFiber`,
    tutorial,
    related,
    layout: 'layout'
  });
});

module.exports = router;
