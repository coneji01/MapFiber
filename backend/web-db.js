/**
 * web-db.js — Web public tables in the existing ftth.db
 * Adds: users, subscriptions, tutorials, payments tables
 */
const db = require('./database');

function initWebSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS web_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan TEXT NOT NULL CHECK(plan IN ('basico', 'profesional', 'enterprise')),
      status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('active', 'inactive', 'cancelled', 'expired')),
      km_limit INTEGER NOT NULL DEFAULT 20,
      fiber_km_used REAL NOT NULL DEFAULT 0,
      paypal_subscription_id TEXT,
      paypal_plan_id TEXT,
      current_period_start TEXT,
      current_period_end TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES web_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS web_tutorials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      content TEXT DEFAULT '',
      category TEXT DEFAULT 'general',
      video_url TEXT DEFAULT '',
      thumbnail_url TEXT DEFAULT '',
      is_published INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS web_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      subscription_id INTEGER,
      paypal_transaction_id TEXT,
      amount REAL,
      currency TEXT DEFAULT 'USD',
      status TEXT DEFAULT 'completed',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES web_users(id) ON DELETE SET NULL,
      FOREIGN KEY (subscription_id) REFERENCES web_subscriptions(id) ON DELETE SET NULL
    );
  `);

  // Seed tutorials if empty
  const count = db.prepare('SELECT COUNT(*) as c FROM web_tutorials').get();
  if (count.c === 0) seedTutorials();
}

function seedTutorials() {
  const insert = db.prepare(`
    INSERT INTO web_tutorials (title, slug, description, content, category, video_url, thumbnail_url, is_published)
    VALUES (@title, @slug, @description, @content, @category, @video_url, @thumbnail_url, @is_published)
  `);

  const tutorials = [
    {
      title: 'Cómo empezar con MapFiber Diagram',
      slug: 'empezar-con-mapfiber-diagram',
      description: 'Primeros pasos para crear tus diagramas de red con fibra óptica.',
      content: `<h2>Paso 1: Elige tu plan</h2>
<p>Selecciona el plan que mejor se ajuste a tus necesidades. Desde 20 km hasta 60 km de fibra óptica.</p>

<h2>Paso 2: Crea tu diagrama</h2>
<p>Arrastra iconos de equipos de red (routers, switches, ONTs) al lienzo y conéctalos con cable de fibra.</p>

<h2>Paso 3: Despliega fibra</h2>
<p>Cada conexión entre equipos consume kilómetros de tu límite. El total se actualiza en tiempo real.</p>

<h2>Paso 4: Exporta y comparte</h2>
<p>Exporta tu diagrama como imagen o compártelo con tu equipo.</p>`,
      category: 'introduccion',
      video_url: '',
      thumbnail_url: '/web/img/tutorial-start.jpg',
      is_published: 1
    },
    {
      title: 'Optimiza tu uso de kilometraje',
      slug: 'optimizar-kilometraje',
      description: 'Consejos para aprovechar al máximo los kilómetros de fibra de tu plan.',
      content: `<h2>1. Planifica tu red</h2>
<p>Antes de empezar, dibuja un boceto de tu red para optimizar las rutas de fibra.</p>

<h2>2. Usa splitters</h2>
<p>Los splitters te permiten dividir una fibra óptica en múltiples salidas, ahorrando kilometraje.</p>

<h2>3. Actualiza tu plan</h2>
<p>Si necesitas más kilometraje, puedes actualizar a un plan superior en cualquier momento.</p>`,
      category: 'optimizacion',
      video_url: '',
      thumbnail_url: '/web/img/tutorial-optimize.jpg',
      is_published: 1
    },
    {
      title: 'Exportación avanzada de diagramas',
      slug: 'exportacion-avanzada',
      description: 'Aprende a exportar tus diagramas en PDF, SVG y otros formatos.',
      content: `<h2>Formatos disponibles</h2>
<p>Dependiendo de tu plan, puedes exportar en diferentes formatos.</p>

<h2>Exportar a PDF</h2>
<p>Ideal para presentaciones y documentación técnica.</p>

<h2>Exportar a SVG</h2>
<p>Perfecto para editar en programas de diseño vectorial.</p>`,
      category: 'tutoriales',
      video_url: '',
      thumbnail_url: '/web/img/tutorial-export.jpg',
      is_published: 1
    }
  ];

  const insertMany = db.transaction((items) => {
    for (const item of items) insert.run(item);
  });
  insertMany(tutorials);
}

// Plan definitions (shared)
const WEB_PLANS = {
  basico:       { name: 'Básico',       price: 10, km: 20, paypalPlanId: process.env.PAYPAL_PLAN_BASICO       || 'P-BASICO-XXXXXXXX' },
  profesional:  { name: 'Profesional',  price: 20, km: 40, paypalPlanId: process.env.PAYPAL_PLAN_PROFESIONAL || 'P-PROFESIONAL-XXXXX' },
  enterprise:   { name: 'Enterprise',   price: 30, km: 60, paypalPlanId: process.env.PAYPAL_PLAN_ENTERPRISE  || 'P-ENTERPRISE-XXXXXX' }
};

function getPlanInfo(subscription) {
  if (!subscription) return null;
  const plan = WEB_PLANS[subscription.plan];
  return plan ? { ...plan, tier: subscription.plan } : null;
}

module.exports = { initWebSchema, WEB_PLANS, getPlanInfo };
