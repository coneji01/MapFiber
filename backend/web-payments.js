/**
 * web-payments.js — Payment/subscription routes for web public site
 * Mounted at /api/web/paypal
 */
const express = require('express');
const router = express.Router();
const db = require('./database');
const { WEB_PLANS } = require('./web-db');

// Middleware: require web auth
function requireAuth(req, res, next) {
  if (!req.session.webUserId) return res.redirect('/web/auth/login');
  next();
}

// Create subscription (initiates PayPal flow)
router.post('/subscribe', requireAuth, async (req, res) => {
  const { plan } = req.body;

  if (!WEB_PLANS[plan]) {
    return res.status(400).json({ error: 'Plan inválido. Opciones: basico, profesional, enterprise' });
  }

  // Check if user already has an active subscription
  const existing = db.prepare('SELECT * FROM web_subscriptions WHERE user_id = ? AND status = ?').get(req.session.webUserId, 'active');
  if (existing) {
    return res.status(400).json({ error: 'Ya tienes una suscripción activa' });
  }

  const planInfo = WEB_PLANS[plan];

  // Create a pending subscription record
  const result = db.prepare(
    'INSERT INTO web_subscriptions (user_id, plan, status, km_limit, paypal_plan_id) VALUES (?, ?, ?, ?, ?)'
  ).run(req.session.webUserId, plan, 'inactive', planInfo.km, planInfo.paypalPlanId);

  res.json({
    success: true,
    plan,
    planName: planInfo.name,
    kmLimit: planInfo.km,
    price: planInfo.price,
    paypalPlanId: planInfo.paypalPlanId,
    subscriptionId: result.lastInsertRowid
  });
});

// PayPal webhook endpoint
router.post('/webhook', async (req, res) => {
  const eventType = req.body.event_type;
  const resource = req.body.resource;

  console.log(`[Web PayPal Webhook] Event: ${eventType}`);

  try {
    switch (eventType) {
      case 'BILLING.SUBSCRIPTION.CREATED': {
        const subId = resource.id;
        const planId = resource.plan_id;
        const sub = db.prepare('SELECT * FROM web_subscriptions WHERE paypal_plan_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1').get(planId, 'inactive');
        if (sub) {
          db.prepare('UPDATE web_subscriptions SET paypal_subscription_id = ?, status = ?, current_period_start = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(subId, 'active', resource.start_time || new Date().toISOString(), sub.id);
          console.log(`[Web PayPal] Subscription created: ${subId} (${sub.plan})`);
        }
        break;
      }
      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        const subId = resource.id;
        db.prepare('UPDATE web_subscriptions SET status = ?, updated_at = datetime(\'now\') WHERE paypal_subscription_id = ?').run('active', subId);
        break;
      }
      case 'PAYMENT.SALE.COMPLETED': {
        const subId = resource.billing_agreement_id;
        const transactionId = resource.id;
        const amount = resource.amount?.total || 0;
        if (subId) {
          const sub = db.prepare('SELECT * FROM web_subscriptions WHERE paypal_subscription_id = ?').get(subId);
          if (sub) {
            db.prepare('UPDATE web_subscriptions SET current_period_end = ?, updated_at = datetime(\'now\') WHERE id = ?')
              .run(new Date().toISOString(), sub.id);
            db.prepare('INSERT INTO web_payments (user_id, subscription_id, paypal_transaction_id, amount, status) VALUES (?, ?, ?, ?, ?)')
              .run(sub.user_id, sub.id, transactionId, amount, 'completed');
          }
        }
        break;
      }
      case 'BILLING.SUBSCRIPTION.CANCELLED': {
        db.prepare('UPDATE web_subscriptions SET status = ?, updated_at = datetime(\'now\') WHERE paypal_subscription_id = ?').run('cancelled', resource.id);
        break;
      }
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
      case 'BILLING.SUBSCRIPTION.EXPIRED': {
        db.prepare('UPDATE web_subscriptions SET status = ?, updated_at = datetime(\'now\') WHERE paypal_subscription_id = ?').run('expired', resource.id);
        break;
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('[Web PayPal Webhook Error]', err);
    res.sendStatus(200);
  }
});

// Get subscription status (for dashboard)
router.get('/status', requireAuth, (req, res) => {
  const sub = db.prepare('SELECT * FROM web_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.session.webUserId);
  const planInfo = sub && WEB_PLANS[sub.plan] ? { ...WEB_PLANS[sub.plan], tier: sub.plan } : null;

  res.json({ subscription: sub || null, planInfo });
});

// Cancel subscription
router.post('/cancel', requireAuth, async (req, res) => {
  const sub = db.prepare('SELECT * FROM web_subscriptions WHERE user_id = ? AND status = ?').get(req.session.webUserId, 'active');
  if (!sub) return res.status(400).json({ error: 'No tienes una suscripción activa' });

  db.prepare('UPDATE web_subscriptions SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run('cancelled', sub.id);
  res.json({ success: true, message: 'Suscripción cancelada' });
});

// Create PayPal order
router.post('/create-order', requireAuth, async (req, res) => {
  const { plan } = req.body;
  if (!WEB_PLANS[plan]) return res.status(400).json({ error: 'Plan inválido' });

  const planInfo = WEB_PLANS[plan];
  res.json({
    success: true,
    plan: {
      name: planInfo.name,
      description: `MapFiber - ${planInfo.name}: ${planInfo.km} km de fibra óptica`,
      price: planInfo.price.toFixed(2),
      km: planInfo.km,
      currency: 'USD'
    },
    approvalUrl: null
  });
});

module.exports = router;
