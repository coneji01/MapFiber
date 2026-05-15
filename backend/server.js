const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require("fs");
const db = require('./database');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const expressLayouts = require('express-ejs-layouts');

// Web public site modules
const { initWebSchema, WEB_PLANS } = require('./web-db');
const webAuthRoutes = require('./web-auth');
const webTutorialRoutes = require('./web-tutorials');
const webPaymentRoutes = require('./web-payments');

const oltCardsRouter = require('./olt-cards');
const { router: fiberTraceRouter, syncPowerState } = require('./fiber-trace');
const apiV3MangasRouter = require('./api-v3-mangas');

const APP_TS = Date.now();
const app = express();
app.use(cors());
app.use(express.json());

// ====== Session & Cookie middleware (for web public site) ======
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'mapfiber_web_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, secure: false }
}));

// ====== EJS view engine (for web public site) ======
const frontendDir = path.join(__dirname, '..', 'frontend');
app.set('view engine', 'ejs');
app.set('views', path.join(frontendDir, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');
// extractScripts/extractStyles omitted for compatibility

// Make web user available to all EJS views
app.use((req, res, next) => {
  res.locals.webUser = req.session.webUserId ? {
    id: req.session.webUserId,
    email: req.session.webUserEmail,
    name: req.session.webUserName
  } : null;
  res.locals.webPath = req.path;
  next();
});

// Initialize web DB tables
initWebSchema();

// Mount OLT cards router (handles /api/olts/:id/cards/*)
app.use('/api/olts', oltCardsRouter);

// Mount fiber trace router (handles /api/fiber-trace and /api/olts/:id/active-traces)
app.use('/api/olts', fiberTraceRouter);

// Mount V3 manga model API (handles /api/v3/*)
app.use('/api/v3', apiV3MangasRouter);

// ====== Routes ======
app.get('/', (req, res) => {
  const idxHtml = fs.readFileSync(path.join(frontendDir, 'index.html'), 'utf-8').replace(/app\.js\?v=\d+/g, 'app.js?t=' + APP_TS);
  res.send(idxHtml);
});
app.get('/login', (req, res) => {
  res.sendFile('login.html', { root: frontendDir });
});

// No-cache headers for all static files (ensures browser loads updated JS/CSS)
app.use(function(req, res, next) {
  if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// ====== Web Public Site Routes (EJS pages) ======

// MUST come BEFORE static middleware to prevent directory redirect interference

// Web landing page
app.get('/web', (req, res) => {
  const recentTutorials = db.prepare('SELECT * FROM web_tutorials WHERE is_published = 1 ORDER BY created_at DESC LIMIT 3').all();
  res.render('index', { title: 'MapFiber - Diagramas de Fibra Óptica', recentTutorials });
});

// Web dashboard
app.get('/web/dashboard', (req, res) => {
  if (!req.session.webUserId) return res.redirect('/web/auth/login');
  const user = db.prepare('SELECT * FROM web_users WHERE id = ?').get(req.session.webUserId);
  const subscription = db.prepare('SELECT * FROM web_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.session.webUserId);
  const tutorials = db.prepare('SELECT * FROM web_tutorials WHERE is_published = 1 ORDER BY created_at DESC LIMIT 6').all();
  let planInfo = null;
  if (subscription && WEB_PLANS[subscription.plan]) planInfo = { ...WEB_PLANS[subscription.plan], tier: subscription.plan };
  res.render('dashboard', { title: 'Dashboard - MapFiber', user, subscription, planInfo, tutorials });
});

// Web pricing page
app.get('/web/pricing', (req, res) => {
  res.render('pricing', { title: 'Planes - MapFiber', plans: WEB_PLANS });
});

// Web auth pages (login, register, logout)
app.use('/web/auth', webAuthRoutes);

// Web tutorial pages
app.use('/web/tutorials', webTutorialRoutes);

// Web public site static files at /web (AFTER page routes to avoid conflicts)
app.use('/web', express.static(path.join(frontendDir, 'web'), { redirect: false }));

// ====== Web Public Site API Routes (/api/web/*) ======
app.use('/api/web/paypal', webPaymentRoutes);

// ====== Existing static file serving (keeps admin tool working) ======
app.use(express.static(frontendDir));

// ========== OLTs ==========
app.get('/api/olts', (req, res) => {
  const olts = db.prepare(`
    SELECT o.*, GROUP_CONCAT(json_object('id', p.id, 'port_number', p.port_number, 'power', p.power)) as ports_json
    FROM olts o LEFT JOIN olt_ports p ON p.olt_id = o.id
    GROUP BY o.id
  `).all();
  res.json(olts.map(o => ({
    ...o,
    ports: o.ports_json ? JSON.parse(`[${o.ports_json}]`) : []
  })));
});

app.post('/api/olts', (req, res) => {
  const { name, lat, lng, description, brand, model, ports_count = 0, power = 2.5 } = req.body;
  const result = db.prepare('INSERT INTO olts (name, lat, lng, description, brand, model, ports_count) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, lat, lng, description, brand, model, ports_count);

  // Don't auto-create ports - user adds them manually or via SmartOLT import

  res.json({ id: result.lastInsertRowid, message: 'OLT creada' });
});

app.put('/api/olts/:id', (req, res) => {
  const { name, lat, lng, description, brand, model } = req.body;
  db.prepare('UPDATE olts SET name=?, lat=?, lng=?, description=?, brand=?, model=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(name, lat, lng, description, brand, model, req.params.id);
  res.json({ message: 'OLT actualizada' });
});

app.delete('/api/olts/:id', (req, res) => {
  db.prepare('DELETE FROM olts WHERE id=?').run(req.params.id);
  res.json({ message: 'OLT eliminada' });
});

// OLT port power update
app.put('/api/olt-ports/:id/power', (req, res) => {
  const { power } = req.body;
  const portId = req.params.id;

  db.prepare('UPDATE olt_ports SET power=?, operational_status=? WHERE id=?').run(
    parseFloat(power),
    parseFloat(power) > 0 ? 'Online' : 'Offline',
    portId
  );

  // Sync with fiber_connections so manga/NAP visualizers see the power
  const hasPower = parseFloat(power) > 0;
  db.prepare('UPDATE fiber_connections SET active_power=?, power_level=? WHERE source_olt_port_id=?').run(
    hasPower ? 1 : 0,
    parseFloat(power),
    portId
  );

  // Also sync any fusions in mangas that use this fiber_connection
  const conn = db.prepare('SELECT cable_id, fiber_number FROM fiber_connections WHERE source_olt_port_id=?').get(portId);
  if (conn) {
    // Update fiber_splices that involve this hilo (cable + fiber number)
    db.prepare(`
      UPDATE fiber_splices SET active_power=? WHERE
        (left_type='cable' AND left_id=? AND left_fiber_number=?) OR
        (right_type='cable' AND right_id=? AND right_fiber_number=?)
    `).run(hasPower ? 1 : 0, conn.cable_id, conn.fiber_number, conn.cable_id, conn.fiber_number);

    // Trace through all splices and update them too
    const visitados = new Set();
    function propagar(fibraId, hiloNum) {
      const key = fibraId + ':' + hiloNum;
      if (visitados.has(key)) return;
      visitados.add(key);

      const fusiones = db.prepare(`
        SELECT * FROM fiber_splices WHERE
          (left_type='cable' AND left_id=? AND left_fiber_number=?) OR
          (right_type='cable' AND right_id=? AND right_fiber_number=?)
      `).all(fibraId, hiloNum, fibraId, hiloNum);

      for (const f of fusiones) {
        const esIzquierda = (f.left_type === 'cable' && f.left_id === fibraId && f.left_fiber_number === hiloNum);
        const sigFibra = esIzquierda ? f.right_id : f.left_id;
        const sigHilo = esIzquierda ? f.right_fiber_number : f.left_fiber_number;

        db.prepare('UPDATE fiber_splices SET active_power=? WHERE id=?').run(hasPower ? 1 : 0, f.id);
        propagar(sigFibra, sigHilo);
      }
    }
    propagar(conn.cable_id, conn.fiber_number);
  }

  res.json({ message: 'Potencia actualizada y propagada a ' + (conn ? 'hilos conectados' : 'puerto') });
});

// Add port to OLT (add card)
app.post('/api/olts/:id/ports', (req, res) => {
  const oltId = req.params.id;
  const olt = db.prepare('SELECT * FROM olts WHERE id=?').get(oltId);
  if (!olt) return res.status(404).json({ error: 'OLT no encontrada' });

  // Find next port number
  const maxPort = db.prepare('SELECT MAX(port_number) as max_p FROM olt_ports WHERE olt_id=?').get(oltId);
  const nextPort = (maxPort?.max_p || 0) + 1;

  const result = db.prepare('INSERT INTO olt_ports (olt_id, port_number, power) VALUES (?, ?, ?)').run(oltId, nextPort, 2.5);

  // Update ports_count
  db.prepare('UPDATE olts SET ports_count=ports_count+1, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(oltId);

  res.json({ id: result.lastInsertRowid, port_number: nextPort, message: 'Puerto agregado' });
});

// Batch add OLT ports (add multiple ports at once, e.g., for an 8 or 16 port card)
app.post('/api/olts/:id/ports/batch', (req, res) => {
  const oltId = req.params.id;
  const { count = 8, power = 2.5 } = req.body;
  const olt = db.prepare('SELECT * FROM olts WHERE id=?').get(oltId);
  if (!olt) return res.status(404).json({ error: 'OLT no encontrada' });

  // Each card starts numbering from 1 independently
  const insertPort = db.prepare('INSERT INTO olt_ports (olt_id, port_number, power) VALUES (?, ?, ?)');
  const created = [];
  for (let i = 1; i <= count; i++) {
    const result = insertPort.run(oltId, i, power);
    created.push({ id: result.lastInsertRowid, port_number: i });
  }

  db.prepare('UPDATE olts SET ports_count=ports_count+?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(count, oltId);

  res.json({ created, count, message: count + ' puertos agregados' });
});

// Delete OLT port
app.delete('/api/olt-ports/:id', (req, res) => {
  const port = db.prepare('SELECT * FROM olt_ports WHERE id=?').get(req.params.id);
  if (!port) return res.status(404).json({ error: 'Puerto no encontrado' });

  // Disconnect any fiber connected to this port
  db.prepare('DELETE FROM fiber_connections WHERE source_olt_port_id=?').run(req.params.id);
  db.prepare('DELETE FROM olt_ports WHERE id=?').run(req.params.id);

  // Update ports_count
  db.prepare('UPDATE olts SET ports_count=MAX(ports_count-1,0), updated_at=CURRENT_TIMESTAMP WHERE id=?').run(port.olt_id);

  res.json({ message: 'Puerto eliminado' });
});

// ====== SmartOLT Import ======
app.post('/api/import/smartolt/cards', async (req, res) => {
  const { subdomain, api_key, olt_id } = req.body;
  if (!subdomain || !api_key || !olt_id) {
    return res.status(400).json({ error: 'Faltan parámetros: subdomain, api_key, olt_id' });
  }

  const BASE = 'https://' + subdomain + '.smartolt.com/api';

  try {
    // 1. Look up our OLT to get its name
    const olt = db.prepare('SELECT * FROM olts WHERE id=?').get(olt_id);
    if (!olt) return res.status(404).json({ error: 'OLT no encontrada en nuestra base de datos' });

    // 2. Call SmartOLT get_olts to find matching OLT (optional - may return empty)
    let smartOltId = null;
    try {
      const fullUrl = BASE + '/system/get_olts';
      console.log('SmartOLT: Fetching', fullUrl);
      const oltsResp = await fetch(fullUrl, {
        headers: { 'X-Token': api_key }
      });
      if (oltsResp.ok) {
        const oltsText = await oltsResp.text();
        try {
          const oltsData = JSON.parse(oltsText);
          const oltList = oltsData.response || oltsData || [];
          const oltCount = Array.isArray(oltList) ? oltList.length : 0;
          console.log('SmartOLT: get_olts returned', oltCount, 'OLTs');
          if (Array.isArray(oltList) && oltCount > 0) {
            // Try to match by name
            const oltName = olt.name.toLowerCase();
            let match = oltList.find(function(o) {
              return o.name && o.name.toLowerCase() === oltName;
            });
            if (!match) {
              match = oltList.find(function(o) {
                return o.name && (oltName.includes(o.name.toLowerCase()) || o.name.toLowerCase().includes(oltName));
              });
            }
            if (!match && oltCount === 1) {
              match = oltList[0];
            }
            if (match) {
              smartOltId = match.id;
              console.log('SmartOLT: Matched OLT', match.name, 'id=' + smartOltId);
            }
          }
        } catch(parseErr) {
          console.log('SmartOLT: get_olts parse failed:', parseErr.message);
        }
      } else {
        console.log('SmartOLT: get_olts returned status', oltsResp.status, '(non-critical)');
      }
      console.log('SmartOLT: smartOltId=' + smartOltId);
    } catch(e) {
      console.log('SmartOLT: get_olts failed (non-critical):', e.message);
    }

    // 3. Get card details from SmartOLT
    // Try with smartOltId first, then without (some SmartOLT versions don't require ID)
    let cardsUrl = BASE + '/system/get_olt_cards_details';
    if (smartOltId) cardsUrl += '/' + smartOltId;
    console.log('SmartOLT: Fetching cards', cardsUrl);
    const cardsResp = await fetch(cardsUrl, {
      headers: { 'X-Token': api_key }
    });
    const cardsBody = await cardsResp.text();
    if (!cardsResp.ok) {
      return res.status(502).json({
        error: 'SmartOLT tarjetas respondió con ' + cardsResp.status,
        preview: cardsBody.substring(0, 200)
      });
    }
    let cardsData;
    try { cardsData = JSON.parse(cardsBody); } catch(e) {
      return res.status(502).json({ error: 'Respuesta inválida de SmartOLT cards (no es JSON)', preview: cardsBody.substring(0, 200) });
    }
    // SmartOLT may or may not include 'status' field
    if (!cardsData.response && Array.isArray(cardsData)) {
      // Response IS the array directly
      cardsData = { response: cardsData };
    } else if (!cardsData.response) {
      return res.status(502).json({ error: 'SmartOLT cards: respuesta inesperada', data: JSON.stringify(cardsData).substring(0, 500) });
    }

    // 4. VALIDATE SmartOLT response BEFORE deleting anything
    var smartoltCards = cardsData.response;

    // If the API returns individual PON ports (with pon_port), group by board/slot
    if (Array.isArray(smartoltCards) && smartoltCards.length > 0 && smartoltCards[0].pon_port !== undefined) {
      // Individual PON ports format - group by board
      var cardMap = {};
      smartoltCards.forEach(function(port) {
        var slot = String(port.board || port.slot || '0');
        if (!cardMap[slot]) {
          cardMap[slot] = { slot: slot, type: port.pon_type || 'GPON', ports: [], status: port.admin_status || 'Enabled' };
        }
        cardMap[slot].ports.push(port);
      });
      smartoltCards = Object.values(cardMap);
      console.log('SmartOLT: Grouped', Object.keys(cardMap).length, 'cards by board');
    }

    // Filter: only keep cards that are real PON service cards (GTGH = Huawei GPON)
    var validCards = [];
    if (Array.isArray(smartoltCards)) {
      smartoltCards.forEach(function(card) {
        var cardType = (card.type || card.pon_type || '').toUpperCase();

        // Solo tarjetas GPON reales: tipo empieza con GT (GTGH, GTED, etc.)
        // o contiene GPON (para otros vendors)
        var isPONCard = cardType.startsWith('GT') || cardType.includes('GPON');
        if (!isPONCard) {
          console.log('SmartOLT: Skipping slot ' + (card.slot || '?') + ' type=' + cardType + ' (no es GPON)');
          return;
        }

        var portCount = parseInt(card.ports, 10);
        if (isNaN(portCount) && Array.isArray(card.ports)) portCount = card.ports.length;
        if (!portCount || portCount <= 0) return;

        validCards.push(card);
      });
    }

    console.log('SmartOLT: Valid GTGH/GPON cards:', validCards.length);
    validCards.forEach(function(c) { console.log('  -> Slot ' + c.slot + ' ' + c.type + ' ' + c.ports + 'P'); });

    if (validCards.length === 0) {
      // ⛔ SAFETY: No valid cards from SmartOLT - do NOT delete anything!
      return res.status(502).json({
        error: 'SmartOLT devolvió 0 tarjetas GPON válidas. No se eliminó ningún dato existente.',
        hint: 'Verifica que la OLT en SmartOLT tenga tarjetas GPON con puertos configurados.',
        raw_response: JSON.stringify(smartoltCards).substring(0, 500)
      });
    }

    // 5. Save SmartOLT credentials in OLT
    db.prepare('UPDATE olts SET smartolt_subdomain=?, smartolt_olt_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(
      subdomain, smartOltId ? String(smartOltId) : null, parseInt(olt_id)
    );

    // 5b. Check which SmartOLT cards we already have locally (by slot in card name)
    var existingSmartolts = db.prepare(`
      SELECT id, name, ports_count FROM olt_cards
      WHERE olt_id=? AND source='smartolt'
    `).all(olt_id);
    var existingSlots = {};
    existingSmartolts.forEach(function(ec) {
      var m = ec.name.match(/Slot (\d+)/);
      if (m) existingSlots[m[1]] = ec;
    });

    // 5c. Only create cards that DON'T already exist locally
    var results = [];
    var insertCard = db.prepare('INSERT INTO olt_cards (olt_id, slot_number, name, ports_count, source) VALUES (?, ?, ?, ?, ?)');
    var insertPort = db.prepare('INSERT INTO olt_ports (olt_id, card_id, slot_number, port_number, power) VALUES (?, ?, ?, ?, ?)');

    validCards.forEach(function(card) {
      var portCount = parseInt(card.ports, 10);
      if (isNaN(portCount) && Array.isArray(card.ports)) portCount = card.ports.length;
      if (!portCount || portCount <= 0) return;

      var smartSlot = String(card.slot || card.board);

      // Skip if this SmartOLT slot is already in our DB
      if (existingSlots[smartSlot]) {
        console.log('SmartOLT: Slot ' + smartSlot + ' already imported, skipping');
        return;
      }

      // slot_number = SmartOLT slot real (2, 3, 4...), NO secuencial local
      // name = "Slot X" con el slot real de SmartOLT
      var cardResult = insertCard.run(olt_id, parseInt(smartSlot), 'Slot ' + smartSlot, portCount, 'smartolt');
      var cardId = cardResult.lastInsertRowid;

      var created = [];
      for (var pi = 1; pi <= portCount; pi++) {
        var powerValue = 2.5;
        if (Array.isArray(card.ports) && card.ports[pi-1] && card.ports[pi-1].power !== undefined) {
          powerValue = parseFloat(card.ports[pi-1].power) || 2.5;
        }
        // port_number = pi (local 1-N dentro de la tarjeta, igual que el PON port)
        var result = insertPort.run(olt_id, cardId, pi, pi, powerValue);
        created.push({ id: result.lastInsertRowid, port_number: pi, slot_number: pi });
      }

      if (created.length > 0) {
        results.push({
          slot: smartSlot,
          type: card.type || card.pon_type || 'GPON',
          ports: portCount,
          status: card.status || 'Enabled',
          created: created.length,
          cardId: cardId,
          portIds: created.map(function(p) { return p.id; })
        });
      }
    });

    // Recalculate total ports_count
    const totalCreated = results.reduce(function(sum, r) { return sum + r.created; }, 0);
    if (totalCreated > 0) {
      const allPortsCount = db.prepare('SELECT COUNT(*) as cnt FROM olt_ports WHERE olt_id=?').get(olt_id);
      db.prepare('UPDATE olts SET ports_count=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(allPortsCount.cnt, olt_id);
    }

    // 6. Fetch PON port details and update status/power for each port
    var ponUpdated = 0;

    // Try multiple PON endpoints - with smartOltId if available, then without
    var ponUrls = [];
    if (smartOltId) {
      ponUrls.push('/system/get_olt_pon_ports_details/' + smartOltId);
      ponUrls.push('/system/get_pon_ports/' + smartOltId);
      ponUrls.push('/system/get_olt_details/' + smartOltId);
    }
    ponUrls.push('/system/get_olt_pon_ports_details');
    ponUrls.push('/system/get_pon_ports');
    ponUrls.push('/system/get_olt_details');

    var ponResp = null;
    var ponBody = null;
    for (var ei = 0; ei < ponUrls.length; ei++) {
      try {
        var url = BASE + ponUrls[ei];
        var r = await fetch(url, { headers: { 'X-Token': api_key } });
        if (r.ok) {
          ponResp = r;
          ponBody = await r.text();
          console.log('SmartOLT: PON details found at', ponUrls[ei], '(len=' + ponBody.length + ')');
          break;
        }
      } catch (e) {
        console.log('SmartOLT: Endpoint', ponUrls[ei], 'failed:', e.message);
      }
    }
    if (!ponResp) {
      console.log('SmartOLT: No PON endpoint responded (all returned non-200)');
    }

    if (ponResp && ponBody) {
      try {
        var ponData = JSON.parse(ponBody);
        console.log('SmartOLT: PON response type:', typeof ponData, Array.isArray(ponData), ponData.status ? 'status=' + ponData.status : 'no status');
        if (ponBody.length < 500) console.log('SmartOLT: PON body:', ponBody);
        var ponList = ponData.response || ponData.data || ponData;
        if (Array.isArray(ponList)) {
          var updatePort = db.prepare('UPDATE olt_ports SET power=?, operational_status=?, online_onus_count=? WHERE olt_id=? AND id=?');

          ponList.forEach(function(pon) {
            // Try multiple field names for slot/board
            var slot = pon.board || pon.slot || pon.shelf || pon.card_id || null;
            if (slot !== null) slot = String(slot);

            // Try multiple field names for port number
            var ponPort = parseInt(pon.pon_port || pon.port || pon.port_number || pon.index || pon.pon_id, 10);
            if (isNaN(ponPort)) return;

            // Try multiple field names for tx power
            var txPower = parseFloat(pon.tx_power || pon.tx_power_dbm || pon.tx_power_db || pon.power || pon.signal || pon.rx_power || 0);

            // Try multiple field names for status
            var opStatus = pon.operational_status || pon.status || pon.state || pon.admin_state || '';
            var status = (opStatus === 'Up' || opStatus === 'up' || opStatus === 'Online' || opStatus === 'online' || opStatus === '1') ? 'Online' : 'Offline';

            // Try multiple field names for online ONU count
            var onusOnline = parseInt(pon.online_onus_count || pon.online_onus || pon.onu_count || pon.online_count || 0, 10) || 0;

            // Find the card for this slot - try matching as string or number
            var card = null;
            for (var ci = 0; ci < results.length; ci++) {
              var r = results[ci];
              var rSlot = String(r.slot);
              if (rSlot === slot || rSlot === String(parseInt(slot)) || r.slot == slot) {
                card = r;
                break;
              }
            }

            if (card && card.portIds) {
              // Try both 1-indexed and 0-indexed port numbers
              var portIdx = ponPort;
              if (portIdx >= 1 && portIdx <= card.portIds.length) {
                portIdx = portIdx - 1; // 0-indexed for array
              } else if (portIdx >= 0 && portIdx < card.portIds.length) {
                // Already 0-indexed
              } else {
                return; // Port number out of range
              }

              var portId = card.portIds[portIdx];
              txPower = isNaN(txPower) ? 0 : txPower;

              updatePort.run(txPower, status, onusOnline, olt_id, portId);
              ponUpdated++;
            }
          });
        } else if (typeof ponList === 'object' && ponList !== null) {
          // Maybe it's an object with card keys
          Object.keys(ponList).forEach(function(key) {
            var cardData = ponList[key];
            if (Array.isArray(cardData)) {
              cardData.forEach(function(pon) {
                var slot = pon.board || pon.slot || key;
                var ponPort = parseInt(pon.pon_port || pon.port || pon.port_number || 0, 10);
                if (isNaN(ponPort)) return;
                var txPower = parseFloat(pon.tx_power || pon.tx_power_dbm || pon.power || 0);
                var txPower = isNaN(txPower) ? 0 : txPower;

                var card = results.find(function(r) { return String(r.slot) === String(slot); });
                if (card && card.portIds && ponPort >= 1 && ponPort <= card.portIds.length) {
                  var portId = card.portIds[ponPort - 1];
                  updatePort.run(txPower, 'Online', 0, olt_id, portId);
                  ponUpdated++;
                }
              });
            }
          });
        }
        console.log('SmartOLT: Updated', ponUpdated, 'ports with PON power data');
      } catch(e) {
        console.log('SmartOLT: Error parsing PON data:', e.message);
      }
    }

    if (ponUpdated === 0) {
      console.log('SmartOLT: No PON details found - keeping default power values');
    }

    res.json({
      success: true,
      message: results.length + ' tarjetas importadas (' + totalCreated + ' puertos)',
      olt_name: olt.name,
      smartolt_name: olt.name + (smartOltId ? ' (SmartOLT ID: ' + smartOltId + ')' : ' (SmartOLT sin ID)'),
      cards: results,
      olt_id: olt_id
    });

  } catch (e) {
    console.error('SmartOLT import error:', e);
    var detail = e.message;
    if (e.cause) detail += ' - ' + e.cause.message;
    if (e.code) detail += ' [' + e.code + ']';
    res.status(500).json({ error: 'Error interno: ' + detail, url: BASE + '/system/get_olts' });
  }
});

// ====== SmartOLT API Test (debug PON response) ======
app.post('/api/import/smartolt/test', async (req, res) => {
  const { subdomain, api_key, olt_id } = req.body;
  if (!subdomain || !api_key) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  const BASE = 'https://' + subdomain + '.smartolt.com/api';
  const results = {};
  var endpoints = ['/system/get_olt_pon_ports_details', '/system/get_olt_cards_details', '/system/get_pon_ports', '/system/get_olt_details', '/system/get_olts'];

  for (var epi = 0; epi < endpoints.length; epi++) {
    try {
      var ep = endpoints[epi];
      var url = BASE + ep;
      if (olt_id) url += '/' + olt_id;
      var r = await fetch(url, { headers: { 'X-Token': api_key } });
      var body = await r.text();
      results[ep] = { status: r.status, body: body.length > 3000 ? body.substring(0, 3000) + '...' : body };
    } catch (e) {
      results[ep] = { error: e.message };
    }
  }

  res.json(results);
});

// ====== SmartOLT - refrescar potencia de todas las cards importadas ======
app.post('/api/import/smartolt/refresh-power', async (req, res) => {
  const { olt_id } = req.body;
  if (!olt_id) return res.status(400).json({ error: 'Falta olt_id' });

  const olt = db.prepare('SELECT * FROM olts WHERE id=?').get(olt_id);
  if (!olt) return res.status(404).json({ error: 'OLT no encontrada' });
  if (!olt.smartolt_subdomain || !olt.smartolt_olt_id) {
    return res.json({ message: 'No hay SmartOLT configurado para esta OLT', refreshed: 0 });
  }

  const BASE = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';
  const smartOltId = olt.smartolt_olt_id;

  try {
    // Buscar api_key guardada (se envía desde el frontend cada vez, no se guarda en DB)
    // Este endpoint requiere api_key en el body porque no persistimos la key
    const { api_key } = req.body;
    if (!api_key) {
      return res.status(400).json({ error: 'Se requiere api_key. Las credenciales SmartOLT no se guardan en el servidor por seguridad.' });
    }

    // Try multiple PON endpoints - with smartOltId if available, then without
    var ponUrls = [];
    if (smartOltId) {
      ponUrls.push('/system/get_olt_pon_ports_details/' + smartOltId);
      ponUrls.push('/system/get_pon_ports/' + smartOltId);
      ponUrls.push('/system/get_olt_details/' + smartOltId);
    }
    ponUrls.push('/system/get_olt_pon_ports_details');
    ponUrls.push('/system/get_pon_ports');
    ponUrls.push('/system/get_olt_details');

    var ponBody = null;
    var ponResp = null;
    for (var ei = 0; ei < ponUrls.length; ei++) {
      try {
        var url = BASE + ponUrls[ei];
        var r = await fetch(url, { headers: { 'X-Token': api_key } });
        if (r.ok) {
          ponResp = r;
          ponBody = await r.text();
          break;
        }
      } catch (e) {}
    }

    if (!ponResp) {
      return res.json({ message: 'No se pudo conectar con SmartOLT para refrescar potencia', refreshed: 0 });
    }

    var ponData = JSON.parse(ponBody);
    var ponList = ponData.response || ponData.data || ponData;

    if (!Array.isArray(ponList) || ponList.length === 0) {
      return res.json({ message: 'Sin datos de PON desde SmartOLT', refreshed: 0 });
    }

    // Get all smartolt cards and their ports for this OLT
    var smartoltCards = db.prepare(`
      SELECT c.id as card_id, c.name as card_name, c.slot_number,
             p.id as port_id, p.port_number, p.power as current_power
      FROM olt_cards c
      JOIN olt_ports p ON p.card_id = c.id
      WHERE c.olt_id = ? AND c.source = 'smartolt'
      ORDER BY c.slot_number, p.port_number
    `).all(olt_id);

    // Build a map: SmartOLT slot number → { cardInfo, ports: [{port_number, port_id}] }
    var cardsBySmartSlot = {};
    smartoltCards.forEach(function(sp) {
      // Extract SmartOLT slot from card name ("Slot 2" → 2, "Slot 3" → 3, etc.)
      var slotMatch = sp.card_name.match(/Slot (\d+)/);
      var smartSlot = slotMatch ? slotMatch[1] : String(sp.slot_number);
      if (!cardsBySmartSlot[smartSlot]) {
        cardsBySmartSlot[smartSlot] = { cardId: sp.card_id, cardName: sp.card_name, ports: [] };
      }
      cardsBySmartSlot[smartSlot].ports.push({ portNumber: sp.port_number, portId: sp.port_id });
    });

    var updatePort = db.prepare('UPDATE olt_ports SET power=?, operational_status=?, online_onus_count=? WHERE id=?');
    var updated = 0;

    for (var pi = 0; pi < ponList.length; pi++) {
      var pon = ponList[pi];
      // PON data has 'board' (SmartOLT slot) and 'pon_port' (port within that slot)
      var smartSlot = String(pon.board || pon.slot || '');
      var ponPortNum = parseInt(pon.pon_port || pon.port_number || pon.port || (pi + 1), 10);
      if (!smartSlot || isNaN(ponPortNum)) continue;

      var powerVal = parseFloat(pon.tx_power || pon.tx_power_dbm || pon.power || pon.rx_power || 0);
      var statusPON = pon.operational_status || pon.status || pon.admin_status || '';
      var status = (String(statusPON).toLowerCase() === 'up' || String(statusPON).toLowerCase() === 'online' || statusPON === '1') ? 'Online' : 'Offline';
      var onuCount = parseInt(pon.online_onus_count || pon.online_onus || pon.onu_count || pon.online_count || 0, 10) || 0;

      // Find the card for this SmartOLT slot
      var cardData = cardsBySmartSlot[smartSlot];
      if (!cardData) continue;

      // Find the port within this card (port_number is local 1-N per card)
      var matchingPort = cardData.ports.find(function(sp) { return sp.portNumber === ponPortNum; });
      if (matchingPort) {
        updatePort.run(powerVal, status, onuCount, matchingPort.portId);
        updated++;
      }
    }

    res.json({
      message: updated + ' puertos actualizados desde SmartOLT',
      refreshed: updated,
      total: smartoltCards.length
    });
  } catch (e) {
    console.error('SmartOLT refresh power error:', e);
    res.status(500).json({ error: 'Error al refrescar potencia: ' + e.message, refreshed: 0 });
  }
});


// OLT connections (similar to NAP connections)
app.get('/api/olts/:id/connections', (req, res) => {
  const oltId = req.params.id;
  const olt = db.prepare('SELECT * FROM olts WHERE id=?').get(oltId);
  if (!olt) return res.status(404).json({ error: 'OLT no encontrada' });

  const ports = db.prepare('SELECT * FROM olt_ports WHERE olt_id=? ORDER BY port_number').all(oltId);

  // Get fiber connections targeting this OLT
  const fiberCons = db.prepare(`
    SELECT fc.*, c.name as cable_name, cf.color as fiber_color, cf.color_name as fiber_color_name
    FROM fiber_connections fc
    LEFT JOIN cables c ON c.id = fc.cable_id
    LEFT JOIN cable_fibers cf ON cf.cable_id = fc.cable_id AND cf.fiber_number = fc.fiber_number
    WHERE (fc.source_type='olt' AND fc.source_id=?)
    ORDER BY fc.fiber_number
  `).all(oltId);

  res.json({ olt, ports, connections: fiberCons });
});

// ========== NAPs ==========
app.get('/api/naps', (req, res) => {
  const naps = db.prepare(`
    SELECT n.*, st.name as splitter_name, st.ports as splitter_ports, st.loss_db as splitter_loss,
      (SELECT COUNT(*) FROM nap_ports np WHERE np.nap_id = n.id) as used_ports
    FROM naps n LEFT JOIN splitter_types st ON st.id = n.splitter_type_id
    ORDER BY n.name
  `).all();

  // Get ports for each NAP
  const getPorts = db.prepare('SELECT * FROM nap_ports WHERE nap_id = ? ORDER BY port_number');
  return res.json(naps.map(n => ({ ...n, ports: getPorts.all(n.id) })));
});

app.post('/api/naps', (req, res) => {
  const { name, lat, lng, description, splitter_type_id, port_capacity = 8, address } = req.body;
  const result = db.prepare('INSERT INTO naps (name, lat, lng, description, splitter_type_id, port_capacity, address) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, lat, lng, description, splitter_type_id || null, port_capacity, address);

  // Create ports for the NAP
  const insertPort = db.prepare('INSERT INTO nap_ports (nap_id, port_number) VALUES (?, ?)');
  for (let i = 1; i <= port_capacity; i++) {
    insertPort.run(result.lastInsertRowid, i);
  }

  res.json({ id: result.lastInsertRowid, message: 'NAP creada' });
});

app.put('/api/naps/:id', (req, res) => {
  const { name, lat, lng, description, address, splitter_type_id } = req.body;
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name=?'); values.push(name); }
  if (lat !== undefined) { fields.push('lat=?'); values.push(lat); }
  if (lng !== undefined) { fields.push('lng=?'); values.push(lng); }
  if (description !== undefined) { fields.push('description=?'); values.push(description); }
  if (address !== undefined) { fields.push('address=?'); values.push(address); }
  if (splitter_type_id !== undefined) { fields.push('splitter_type_id=?'); values.push(splitter_type_id); }
  fields.push('updated_at=CURRENT_TIMESTAMP');

  if (fields.length > 1) {
    values.push(req.params.id);
    db.prepare(`UPDATE naps SET ${fields.join(', ')} WHERE id=?`).run(...values);

    // If splitter changed, regenerate ports + reset manga_fibers + splitter assignment
    if (splitter_type_id !== undefined) {
      const splitter = db.prepare('SELECT * FROM splitter_types WHERE id=?').get(splitter_type_id);
      if (splitter) {
        db.prepare('DELETE FROM nap_ports WHERE nap_id=?').run(req.params.id);
        db.prepare('UPDATE naps SET port_capacity=? WHERE id=?').run(splitter.ports, req.params.id);
        const insertPort = db.prepare('INSERT INTO nap_ports (nap_id, port_number) VALUES (?, ?)');
        for (let i = 1; i <= splitter.ports; i++) {
          insertPort.run(req.params.id, i);
        }

        // Limpiar datos viejos del splitter anterior
        db.prepare("DELETE FROM manga_fibers WHERE source_type='nap' AND source_id=?").run(req.params.id);
        db.prepare("DELETE FROM splitter_assignments WHERE entity_type='nap' AND entity_id=?").run(req.params.id);
        db.prepare("DELETE FROM splices WHERE fiber_a_id IN (SELECT id FROM cable_points WHERE element_type='nap' AND element_id=?) OR fiber_b_id IN (SELECT id FROM cable_points WHERE element_type='nap' AND element_id=?)").run(req.params.id, req.params.id);

        // Crear nuevo splitter y asignarlo
        var newSplitterId = db.prepare('INSERT INTO splitters (name, splitter_type_id, ports_count) VALUES (?, ?, ?)').run(
          'NAP Splitter ' + splitter.ports + 'p', splitter_type_id, splitter.ports
        ).lastInsertRowid;
        db.prepare('INSERT INTO splitter_assignments (splitter_id, entity_type, entity_id) VALUES (?, ?, ?)').run(newSplitterId, 'nap', req.params.id);

        // Crear manga_fibers (1 entrada + N salidas)
        var napId = parseInt(req.params.id);
        var insertMF = db.prepare('INSERT INTO manga_fibers (manga_id, fiber_number, splitter_output, source_type, source_id, notes) VALUES (?, ?, ?, ?, ?, ?)');
        var maxFiber = db.prepare('SELECT COALESCE(MAX(fiber_number), 0) as m FROM manga_fibers WHERE manga_id=?').get(napId);
        var fn = (maxFiber?.m || 0) + 1;
        insertMF.run(napId, fn, 0, 'nap', napId, 'Entrada splitter (NAP)');
        fn++;
        for (var i = 1; i <= splitter.ports; i++) {
          insertMF.run(napId, fn, i, 'nap', napId, 'Salida ' + i + ' ' + splitter.name);
          fn++;
        }
      }
    }
  }

  res.json({ message: 'NAP actualizada' });
});

app.delete('/api/naps/:id', (req, res) => {
  const napId = parseInt(req.params.id);

  // === HEAL cable route before deleting NAP ===
  // Guardar datos para restaurar fusiones despues de curar
  var _fusionRestore = []; // [{ cableId, fiberCount, beforeId, afterId }]

  try {
    const napPts = db.prepare(
      "SELECT * FROM cable_points WHERE element_type='nap' AND element_id=? ORDER BY cable_id, sequence"
    ).all(napId);

    if (napPts.length > 0) {
      const cablesAfectados = new Set(napPts.map(p => p.cable_id));

      cablesAfectados.forEach(function(cid) {
        var ptsCable = napPts.filter(function(p) { return p.cable_id === cid; });
        var seqs = ptsCable.map(function(p) { return p.sequence; });
        var minSeq = Math.min.apply(null, seqs);
        var maxSeq = Math.max.apply(null, seqs);

        // Guardar puntos ANTES y DESPUES del rango de la NAP para restaurar continuidad
        var ptBefore = db.prepare(
          'SELECT id, sequence FROM cable_points WHERE cable_id=? AND sequence<? ORDER BY sequence DESC LIMIT 1'
        ).get(cid, minSeq);
        var ptAfter = db.prepare(
          'SELECT id, sequence FROM cable_points WHERE cable_id=? AND sequence>? ORDER BY sequence ASC LIMIT 1'
        ).get(cid, maxSeq);

        // Obtener cantidad de fibras del cable
        var cableInfo = db.prepare('SELECT fiber_count FROM cables WHERE id=?').get(cid);
        var fiberCount = (cableInfo && cableInfo.fiber_count) || 12;

        if (ptBefore && ptAfter) {
          _fusionRestore.push({
            cableId: cid,
            fiberCount: fiberCount,
            beforeId: ptBefore.id,
            afterId: ptAfter.id
          });
        }

        // 1. Borrar puntos de ruta huerfanos ENTRE los puntos de la NAP
        db.prepare(
          'DELETE FROM cable_points WHERE cable_id=? AND sequence>? AND sequence<? AND element_type IS NULL AND element_id IS NULL'
        ).run(cid, minSeq, maxSeq);

        // 2. Borrar los cable_points de la NAP (CASCADE elimina fusiones relacionadas)
        db.prepare(
          "DELETE FROM cable_points WHERE element_type='nap' AND element_id=? AND cable_id=?"
        ).run(napId, cid);
      });

      // 3. Renumerar secuencias y RECREAR fusiones para restaurar continuidad
      _fusionRestore.forEach(function(fr) {
        var restantes = db.prepare(
          'SELECT * FROM cable_points WHERE cable_id=? ORDER BY sequence'
        ).all(fr.cableId);
        restantes.forEach(function(p, idx) {
          var newSeq = idx + 1;
          if (p.sequence !== newSeq) {
            db.prepare('UPDATE cable_points SET sequence=? WHERE id=?').run(newSeq, p.id);
          }
        });

        // 4. Recrear fusiones para TODAS las fibras (restaura hilos incluso los "cortados")
        //    entre el punto anterior y posterior a la NAP eliminada
        var insertFusion = db.prepare(
          'INSERT INTO fusions (name, cable_connection_id_in, fiber_in, cable_connection_id_out, fiber_out, loss_db) VALUES (?, ?, ?, ?, ?, ?)'
        );
        var fusionCount = 0;
        for (var fi = 1; fi <= fr.fiberCount; fi++) {
          insertFusion.run(
            'Restauracion #' + fi,
            fr.beforeId, fi,
            fr.afterId, fi,
            0.05
          );
          fusionCount++;
        }
        console.log('[HEAL-NAP] Cable #' + fr.cableId + ' curado: ' + restantes.length + ' puntos + ' + fusionCount + ' fusiones restauradas (' + fr.beforeId + '->' + fr.afterId + ')');
      });
    }
  } catch(e) {
    console.error('[HEAL-NAP] Error curando cable:', e.message);
  }

  // Delete NAP and related data
  db.prepare('DELETE FROM nap_ports WHERE nap_id=?').run(napId);
  db.prepare("DELETE FROM manga_fibers WHERE source_type='nap' AND source_id=?").run(napId);
  db.prepare("DELETE FROM splitter_assignments WHERE entity_type='nap' AND entity_id=?").run(napId);
  db.prepare('DELETE FROM naps WHERE id=?').run(napId);

  res.json({ message: 'NAP eliminada y cable curado' });
});

// Update NAP port (assign client, fiber)
app.put('/api/nap-ports/:id', (req, res) => {
  const { fiber_number, client_name, client_address, notes } = req.body;
  db.prepare('UPDATE nap_ports SET fiber_number=?, client_name=?, client_address=?, notes=? WHERE id=?')
    .run(fiber_number || null, client_name || null, client_address || null, notes || null, req.params.id);
  res.json({ message: 'Puerto actualizado' });
});

// ========== Mangas ==========
app.get('/api/mangas', (req, res) => {
  res.json(db.prepare('SELECT * FROM mangas ORDER BY name').all());
});

app.post('/api/mangas', (req, res) => {
  const { name, lat, lng, description } = req.body;
  const result = db.prepare('INSERT INTO mangas (name, lat, lng, description) VALUES (?, ?, ?, ?)')
    .run(name, lat, lng, description);
  res.json({ id: result.lastInsertRowid, message: 'Manga creada' });
});

app.put('/api/mangas/:id', (req, res) => {
  const { name, lat, lng, description } = req.body;
  db.prepare('UPDATE mangas SET name=?, lat=?, lng=?, description=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(name, lat, lng, description, req.params.id);
  res.json({ message: 'Manga actualizada' });
});

app.delete('/api/mangas/:id', (req, res) => {
  const mangaId = parseInt(req.params.id);

  // === HEAL cable route before deleting manga ===
  var _fusionRestore = []; // [{ cableId, fiberCount, beforeId, afterId }]

  try {
    const mangaPts = db.prepare(
      "SELECT * FROM cable_points WHERE element_type='manga' AND element_id=? ORDER BY cable_id, sequence"
    ).all(mangaId);

    if (mangaPts.length > 0) {
      const cablesAfectados = new Set(mangaPts.map(p => p.cable_id));

      cablesAfectados.forEach(function(cid) {
        var ptsCable = mangaPts.filter(function(p) { return p.cable_id === cid; });
        var seqs = ptsCable.map(function(p) { return p.sequence; });
        var minSeq = Math.min.apply(null, seqs);
        var maxSeq = Math.max.apply(null, seqs);

        // Guardar puntos ANTES y DESPUES del rango de la Manga
        var ptBefore = db.prepare(
          'SELECT id, sequence FROM cable_points WHERE cable_id=? AND sequence<? ORDER BY sequence DESC LIMIT 1'
        ).get(cid, minSeq);
        var ptAfter = db.prepare(
          'SELECT id, sequence FROM cable_points WHERE cable_id=? AND sequence>? ORDER BY sequence ASC LIMIT 1'
        ).get(cid, maxSeq);

        var cableInfo = db.prepare('SELECT fiber_count FROM cables WHERE id=?').get(cid);
        var fiberCount = (cableInfo && cableInfo.fiber_count) || 12;

        if (ptBefore && ptAfter) {
          _fusionRestore.push({
            cableId: cid,
            fiberCount: fiberCount,
            beforeId: ptBefore.id,
            afterId: ptAfter.id
          });
        }

        // 1. Borrar puntos de ruta huerfanos ENTRE los puntos de la Manga
        db.prepare(
          'DELETE FROM cable_points WHERE cable_id=? AND sequence>? AND sequence<? AND element_type IS NULL AND element_id IS NULL'
        ).run(cid, minSeq, maxSeq);

        // 2. Borrar los cable_points de la Manga (CASCADE elimina fusiones)
        db.prepare(
          "DELETE FROM cable_points WHERE element_type='manga' AND element_id=? AND cable_id=?"
        ).run(mangaId, cid);
      });

      // 3. Renumerar secuencias y RECREAR fusiones
      _fusionRestore.forEach(function(fr) {
        var restantes = db.prepare(
          'SELECT * FROM cable_points WHERE cable_id=? ORDER BY sequence'
        ).all(fr.cableId);
        restantes.forEach(function(p, idx) {
          var newSeq = idx + 1;
          if (p.sequence !== newSeq) {
            db.prepare('UPDATE cable_points SET sequence=? WHERE id=?').run(newSeq, p.id);
          }
        });

        // 4. Recrear fusiones para TODAS las fibras
        var insertFusion = db.prepare(
          'INSERT INTO fusions (name, cable_connection_id_in, fiber_in, cable_connection_id_out, fiber_out, loss_db) VALUES (?, ?, ?, ?, ?, ?)'
        );
        var fusionCount = 0;
        for (var fi = 1; fi <= fr.fiberCount; fi++) {
          insertFusion.run(
            'Restauracion #' + fi,
            fr.beforeId, fi,
            fr.afterId, fi,
            0.05
          );
          fusionCount++;
        }
        console.log('[HEAL-MANGA] Cable #' + fr.cableId + ' curado: ' + restantes.length + ' puntos + ' + fusionCount + ' fusiones restauradas (' + fr.beforeId + '->' + fr.afterId + ')');
      });
    }
  } catch(e) {
    console.error('[HEAL-MANGA] Error curando cable:', e.message);
  }

  // Delete manga and related data
  db.prepare("DELETE FROM manga_fibers WHERE source_type='manga' AND source_id=?").run(mangaId);
  db.prepare("DELETE FROM manga_fibers WHERE manga_id=?").run(mangaId);
  db.prepare("DELETE FROM splitter_assignments WHERE entity_type='manga' AND entity_id=?").run(mangaId);
  db.prepare('DELETE FROM mangas WHERE id=?').run(mangaId);

  res.json({ message: 'Manga eliminada y cable curado' });
});

// ========== GLOBAL SPLITTERS (shared across Mangas, NAPs, etc.) ==========

// GET all global splitters (optionally filtered by entity)
app.get('/api/splitters', (req, res) => {
  const { entity_type, entity_id } = req.query;
  let splitters;
  if (entity_type && entity_id) {
    splitters = db.prepare(`
      SELECT sp.*, st.name as splitter_name, st.loss_db, st.ports as splitter_ports
      FROM splitters sp
      JOIN splitter_assignments sa ON sa.splitter_id = sp.id
      LEFT JOIN splitter_types st ON st.id = sp.splitter_type_id
      WHERE sa.entity_type = ? AND sa.entity_id = ?
    `).all(entity_type, parseInt(entity_id));
  } else {
    splitters = db.prepare(`
      SELECT sp.*, st.name as splitter_name, st.loss_db, st.ports as splitter_ports
      FROM splitters sp
      LEFT JOIN splitter_types st ON st.id = sp.splitter_type_id
      ORDER BY sp.name
    `).all();
  }
  res.json(splitters);
});

// GET single splitter detail
app.get('/api/splitters/:id', (req, res) => {
  const splitter = db.prepare(`
    SELECT sp.*, st.name as splitter_name, st.loss_db, st.ports as splitter_ports,
      (SELECT COUNT(*) FROM manga_fibers mf WHERE mf.splitter_id = sp.id) as fiber_count
    FROM splitters sp
    LEFT JOIN splitter_types st ON st.id = sp.splitter_type_id
    WHERE sp.id = ?
  `).get(req.params.id);
  if (!splitter) return res.status(404).json({ error: 'Splitter no encontrado' });

  // Get assignments
  const assignments = db.prepare(`
    SELECT sa.*,
      CASE WHEN sa.entity_type='manga' THEN (SELECT name FROM mangas WHERE id=sa.entity_id) END as manga_name,
      CASE WHEN sa.entity_type='nap' THEN (SELECT name FROM naps WHERE id=sa.entity_id) END as nap_name
    FROM splitter_assignments sa WHERE sa.splitter_id = ?
  `).all(splitter.id);

  res.json({ ...splitter, assignments });
});

// POST - crear splitter global
app.post('/api/splitters', (req, res) => {
  const { name, splitter_type_id, ports_count } = req.body;
  const result = db.prepare('INSERT INTO splitters (name, splitter_type_id, ports_count) VALUES (?, ?, ?)')
    .run(name || 'Splitter', splitter_type_id, ports_count || 8);
  res.json({ id: result.lastInsertRowid, message: 'Splitter global creado' });
});

// PUT - editar splitter global
app.put('/api/splitters/:id', (req, res) => {
  const { name, splitter_type_id, ports_count } = req.body;
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name=?'); values.push(name); }
  if (splitter_type_id !== undefined) { fields.push('splitter_type_id=?'); values.push(splitter_type_id); }
  if (ports_count !== undefined) { fields.push('ports_count=?'); values.push(ports_count); }
  // input_fiber solo existe en manga_splitters, no en splitters
  if (fields.length > 0) {
    values.push(req.params.id);
    db.prepare('UPDATE splitters SET ' + fields.join(', ') + ' WHERE id=?').run(...values);
  }
  res.json({ message: 'Splitter actualizado' });
});

// DELETE - eliminar splitter global (cascade removes assignments)
app.delete('/api/splitters/:id', (req, res) => {
  db.prepare('DELETE FROM manga_fibers WHERE splitter_id=?').run(req.params.id);
  db.prepare('DELETE FROM splitters WHERE id=?').run(req.params.id);
  res.json({ message: 'Splitter eliminado' });
});

// ========== SPLITTER ASSIGNMENTS (pivot) ==========

// GET all splitter-assignments
app.get('/api/splitter-assignments', (req, res) => {
  const { entity_type, entity_id } = req.query;
  let assignments;
  if (entity_type && entity_id) {
    assignments = db.prepare(`
      SELECT sa.*, sp.name as splitter_name, st.name as splitter_type_name, st.loss_db
      FROM splitter_assignments sa
      JOIN splitters sp ON sp.id = sa.splitter_id
      LEFT JOIN splitter_types st ON st.id = sp.splitter_type_id
      WHERE sa.entity_type = ? AND sa.entity_id = ?
    `).all(entity_type, parseInt(entity_id));
  } else {
    assignments = db.prepare(`
      SELECT sa.*, sp.name as splitter_name, st.name as splitter_type_name, st.loss_db
      FROM splitter_assignments sa
      JOIN splitters sp ON sp.id = sa.splitter_id
      LEFT JOIN splitter_types st ON st.id = sp.splitter_type_id
      ORDER BY sa.entity_type, sa.entity_id
    `).all();
  }
  res.json(assignments);
});

// POST - assign existing splitter to an entity
app.post('/api/splitter-assignments', (req, res) => {
  const { splitter_id, entity_type, entity_id } = req.body;
  if (!splitter_id || !entity_type || !entity_id) {
    return res.status(400).json({ error: 'splitter_id, entity_type y entity_id son requeridos' });
  }
  try {
    db.prepare('INSERT OR IGNORE INTO splitter_assignments (splitter_id, entity_type, entity_id) VALUES (?, ?, ?)')
      .run(splitter_id, entity_type, entity_id);
    res.json({ message: 'Splitter asignado a ' + entity_type + ' #' + entity_id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE - remove assignment (does not delete splitter)
app.delete('/api/splitter-assignments/:id', (req, res) => {
  db.prepare('DELETE FROM splitter_assignments WHERE id=?').run(req.params.id);
  res.json({ message: 'Asignación eliminada' });
});

// ========== MANGA SPLITTERS (via splitter_assignments) ==========

// GET splitters assigned to a manga (uses splitter_assignments pivot)
app.get('/api/mangas/:id/splitters', (req, res) => {
  var entityId = parseInt(req.params.id);
  // First try as manga (entity_type='manga')
  var splitters = db.prepare(`
    SELECT sp.*, st.name as splitter_name, st.loss_db, st.ports as splitter_ports,
      (SELECT COUNT(*) FROM manga_fibers mf WHERE mf.splitter_id = sp.id AND mf.client_name IS NOT NULL) as used_ports
    FROM splitters sp
    JOIN splitter_assignments sa ON sa.splitter_id = sp.id
    LEFT JOIN splitter_types st ON st.id = sp.splitter_type_id
    WHERE sa.entity_type = 'manga' AND sa.entity_id = ?
  `).all(entityId);
  // If none found, try as NAP (entity_type='nap')
  if (splitters.length === 0) {
    splitters = db.prepare(`
      SELECT sp.*, st.name as splitter_name, st.loss_db, st.ports as splitter_ports,
        (SELECT COUNT(*) FROM manga_fibers mf WHERE mf.source_type='nap' AND mf.source_id=? AND mf.client_name IS NOT NULL) as used_ports
      FROM splitters sp
      JOIN splitter_assignments sa ON sa.splitter_id = sp.id
      LEFT JOIN splitter_types st ON st.id = sp.splitter_type_id
      WHERE sa.entity_type = 'nap' AND sa.entity_id = ?
    `).all(entityId, entityId);
  }
  // Fallback: check manga_splitters for legacy data
  if (splitters.length === 0) {
    const legacy = db.prepare('SELECT ms.*, st.name as splitter_name, st.loss_db, (SELECT COUNT(*) FROM manga_fibers mf WHERE mf.splitter_id = ms.id AND mf.client_name IS NOT NULL) as used_ports FROM manga_splitters ms LEFT JOIN splitter_types st ON st.id = ms.splitter_type_id WHERE ms.manga_id = ?').all(entityId);
    if (legacy.length > 0) return res.json(legacy);
  }
  res.json(splitters);
});

// POST - create + assign splitter to manga
app.post('/api/mangas/:id/splitters', (req, res) => {
  const { name, splitter_type_id, ports_count, input_fiber } = req.body;
  const mangaId = req.params.id;

  // Create global splitter (sin input_fiber - esa columna solo está en manga_splitters)
  const result = db.prepare('INSERT INTO splitters (name, splitter_type_id, ports_count) VALUES (?, ?, ?)')
    .run(name || 'Splitter', splitter_type_id, ports_count || 8);

  const splitterId = result.lastInsertRowid;

  // Create assignment
  db.prepare('INSERT OR IGNORE INTO splitter_assignments (splitter_id, entity_type, entity_id) VALUES (?, ?, ?)')
    .run(splitterId, 'manga', mangaId);

  // Also insert into manga_splitters (legacy FK target for manga_fibers.splitter_id)
  db.prepare('INSERT OR IGNORE INTO manga_splitters (id, manga_id, name, splitter_type_id, ports_count, input_fiber) VALUES (?, ?, ?, ?, ?, ?)')
    .run(splitterId, mangaId, name || 'Splitter', splitter_type_id, ports_count || 8, input_fiber || null);

  // Auto-create manga_fibers for each output port of the splitter
  const numPorts = ports_count || 8;
  const insertMF = db.prepare('INSERT INTO manga_fibers (manga_id, fiber_number, splitter_id, splitter_output, notes) VALUES (?, ?, ?, ?, ?)');

  const maxFiber = db.prepare('SELECT COALESCE(MAX(fiber_number), 0) as m FROM manga_fibers WHERE manga_id=?').get(mangaId);
  let fiberNum = (maxFiber?.m || 0) + 1;

  // Create input fiber
  insertMF.run(mangaId, fiberNum, splitterId, 0, 'Entrada splitter ' + (name || 'Splitter'));
  fiberNum++;

  // Create output fibers
  for (let i = 1; i <= numPorts; i++) {
    insertMF.run(mangaId, fiberNum, splitterId, i, 'Salida ' + i + ' ' + (name || 'Splitter'));
    fiberNum++;
  }

  res.json({ id: splitterId, message: 'Splitter agregado a manga con ' + numPorts + ' fibras de salida' });
});

// DELETE splitter (from global + manga_fibers)
app.delete('/api/manga-splitters/:id', (req, res) => {
  var splitterId = parseInt(req.params.id);
  // Find which entity this splitter is assigned to (manga or nap)
  var sa = db.prepare('SELECT * FROM splitter_assignments WHERE splitter_id=?').get(splitterId);
  if (sa) {
    if (sa.entity_type === 'nap') {
      // Delete NAP-style manga_fibers (source_type='nap' + source_id)
      db.prepare("DELETE FROM manga_fibers WHERE source_type='nap' AND source_id=?").run(sa.entity_id);
      // Also delete splices for this NAP
      db.prepare("DELETE FROM splices WHERE fiber_a_id IN (SELECT id FROM cable_points WHERE element_type='nap' AND element_id=?) OR fiber_b_id IN (SELECT id FROM cable_points WHERE element_type='nap' AND element_id=?) LIMIT 50").run(sa.entity_id, sa.entity_id);
    } else {
      // Delete manga-style manga_fibers (splitter_id FK)
      db.prepare('DELETE FROM manga_fibers WHERE splitter_id=?').run(splitterId);
    }
    db.prepare('DELETE FROM splitter_assignments WHERE splitter_id=?').run(splitterId);
  }
  db.prepare('DELETE FROM splitters WHERE id=?').run(splitterId);
  // Also delete from legacy manga_splitters
  db.prepare('DELETE FROM manga_splitters WHERE id=?').run(splitterId);
  res.json({ message: 'Splitter y sus fibras eliminados' });
});

// Init fibers for existing splitter (migration)
app.post('/api/mangas/:mangaId/splitters/:splitterId/init-fibers', (req, res) => {
  const { mangaId, splitterId } = req.params;
  const { ports_count = 8, entity_type } = req.body;

  // Determine if this is a NAP or manga splitter
  // Check via splitter_assignments first (most reliable), then fall back to request body
  const sa = db.prepare('SELECT entity_type, entity_id FROM splitter_assignments WHERE splitter_id=?').get(splitterId);
  const isNap = sa ? sa.entity_type === 'nap' : entity_type === 'nap';

  let napId = null;
  if (isNap) {
    napId = parseInt(mangaId);
  }

  const existing = db.prepare('SELECT COUNT(*) as c FROM manga_fibers WHERE source_type=? AND source_id=? AND splitter_id=?')
    .get(isNap ? 'nap' : 'manga', isNap ? napId : mangaId, splitterId);
  if (existing.c > 0) {
    return res.json({ message: 'Ya tiene fibras' });
  }

  const maxFiber = db.prepare('SELECT COALESCE(MAX(fiber_number), 0) as m FROM manga_fibers WHERE manga_id=?').get(mangaId);
  let fiberNum = (maxFiber?.m || 0) + 1;

  // Ensure a row exists in mangas for NAPs (FK constraint on manga_fibers.manga_id)
  if (isNap) {
    var mangaExists = db.prepare('SELECT id FROM mangas WHERE id=?').get(mangaId);
    if (!mangaExists) {
      db.prepare('INSERT OR IGNORE INTO mangas (id, name, lat, lng) VALUES (?, ?, 0, 0)')
        .run(mangaId, 'NAP-' + mangaId + ' (auto)');
    }
  }

  // For NAP splitters, don't set splitter_id (FK to manga_splitters); use source_type/source_id instead
  // For manga splitters, use splitter_id (FK to manga_splitters) - ensure manga_splitters row exists
  let insertMF;
  if (isNap) {
    insertMF = db.prepare('INSERT INTO manga_fibers (manga_id, fiber_number, splitter_output, source_type, source_id, notes) VALUES (?, ?, ?, ?, ?, ?)');
    insertMF.run(mangaId, fiberNum, 0, 'nap', napId, 'Entrada splitter (NAP)');
    fiberNum++;
    for (let i = 1; i <= ports_count; i++) {
      insertMF.run(mangaId, fiberNum, i, 'nap', napId, 'Salida ' + i);
      fiberNum++;
    }
  } else {
    // Ensure manga_splitters row exists to satisfy FK constraint
    var msExists = db.prepare('SELECT id FROM manga_splitters WHERE id=?').get(splitterId);
    if (!msExists) {
      var spData = db.prepare('SELECT * FROM splitters WHERE id=?').get(splitterId);
      db.prepare('INSERT OR IGNORE INTO manga_splitters (id, manga_id, name, splitter_type_id, ports_count) VALUES (?, ?, ?, ?, ?)')
        .run(splitterId, mangaId, (spData?.name || 'Splitter ' + splitterId), spData?.splitter_type_id || null, ports_count);
    }
    insertMF = db.prepare('INSERT INTO manga_fibers (manga_id, fiber_number, splitter_id, splitter_output, notes) VALUES (?, ?, ?, ?, ?)');
    insertMF.run(mangaId, fiberNum, splitterId, 0, 'Entrada splitter');
    fiberNum++;
    for (let i = 1; i <= ports_count; i++) {
      insertMF.run(mangaId, fiberNum, splitterId, i, 'Salida ' + i);
      fiberNum++;
    }
  }

  res.json({ message: 'Fibras creadas: 1 entrada + ' + ports_count + ' salidas' });
});

// ========== NAP SPLITTERS (splitter_assignments) ==========

// GET splitters assigned to a NAP
app.get('/api/naps/:id/splitters', (req, res) => {
  const splitters = db.prepare(`
    SELECT sp.*, st.name as splitter_name, st.loss_db, st.ports as splitter_ports
    FROM splitters sp
    JOIN splitter_assignments sa ON sa.splitter_id = sp.id
    LEFT JOIN splitter_types st ON st.id = sp.splitter_type_id
    WHERE sa.entity_type = 'nap' AND sa.entity_id = ?
  `).all(req.params.id);
  res.json(splitters);
});

// POST - create + assign splitter to NAP
app.post('/api/naps/:id/splitters', (req, res) => {
  const { name, splitter_type_id, ports_count } = req.body;
  const napId = req.params.id;
  const numPorts = ports_count || 8;

  // Create global splitter
  const result = db.prepare('INSERT INTO splitters (name, splitter_type_id, ports_count) VALUES (?, ?, ?)')
    .run(name || 'NAP Splitter', splitter_type_id, numPorts);
  const splitterId = result.lastInsertRowid;

  // Assign to NAP
  db.prepare('INSERT OR IGNORE INTO splitter_assignments (splitter_id, entity_type, entity_id) VALUES (?, ?, ?)')
    .run(splitterId, 'nap', napId);

  // Get the shared manga_id for this NAP
  var cpFirst = db.prepare("SELECT element_id FROM cable_points WHERE element_type='nap' AND element_id=? LIMIT 1").get(napId);
  var mangaId = cpFirst ? parseInt(cpFirst.element_id) : parseInt(napId);

  // Also insert into manga_splitters (FK target for manga_fibers.splitter_id)
  db.prepare('INSERT OR IGNORE INTO manga_splitters (id, manga_id, name, splitter_type_id, ports_count) VALUES (?, ?, ?, ?, ?)')
    .run(splitterId, mangaId, name || 'NAP Splitter', splitter_type_id, numPorts);

  // Create manga_fibers for the NAP splitter outputs
  const maxFiber = db.prepare("SELECT COALESCE(MAX(fiber_number), 0) as m FROM manga_fibers WHERE manga_id=? AND (source_type='nap' OR source_type IS NULL)").get(napId);
  let fiberNum = (maxFiber?.m || 0) + 1;

  // Ensure a manga row exists for FK constraint
  db.prepare('INSERT OR IGNORE INTO mangas (id, name, lat, lng) VALUES (?, ?, 0, 0)').run(mangaId, 'NAP-' + napId);

  // Create input fiber
  db.prepare('INSERT INTO manga_fibers (manga_id, fiber_number, splitter_id, splitter_output, source_type, source_id, notes) VALUES (?, ?, ?, 0, ?, ?, ?)')
    .run(mangaId, fiberNum, splitterId, 'nap', napId, 'Entrada splitter (NAP)');
  fiberNum++;

  // Create output fibers
  for (let i = 1; i <= numPorts; i++) {
    db.prepare('INSERT INTO manga_fibers (manga_id, fiber_number, splitter_id, splitter_output, source_type, source_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(mangaId, fiberNum, splitterId, i, 'nap', napId, 'Salida ' + i);
    fiberNum++;
  }

  res.json({ id: splitterId, message: 'Splitter asignado a NAP #' + napId + ' con ' + numPorts + ' salidas' });
});

// Manga fibers
app.get('/api/mangas/:id/fibers', (req, res) => {
  const mangaId = req.params.id;
  // ⭐ Nuevo modelo: sync power desde cable_points.power_status
  try {
    const { propagarPotencia } = require('./fiber-trace');
    if (typeof propagarPotencia === 'function') propagarPotencia();
  } catch(e) {}
  // Limpiar y re-sync desde cable_points
  db.prepare('UPDATE manga_fibers SET active_power=0, power_level=NULL WHERE manga_id=?').run(mangaId);
  // Splitter inputs: conectar con cable_points con power_status=1 via connections
  var poweredInputs = db.prepare([
    'SELECT DISTINCT mf.id, c.source_fiber as fiber_num',
    'FROM connections c',
    'JOIN cable_points cp ON cp.id = c.target_cp_id OR cp.id = c.source_cp_id',
    'JOIN cable_points cp_in ON cp_in.id = (CASE WHEN c.target_cp_id = cp.id THEN c.source_cp_id ELSE c.target_cp_id END)',
    'JOIN manga_fibers mf ON mf.splitter_id = cp.splitter_id AND mf.splitter_output = cp.splitter_port',
    'WHERE cp.splitter_id IS NOT NULL',
    'AND cp.power_status = 1',
    'AND mf.manga_id = ?'
  ].join(' ')).all(mangaId);
  for (var pi of poweredInputs) {
    db.prepare('UPDATE manga_fibers SET active_power=1 WHERE id=?').run(pi.id);
    // Propagar a outputs del splitter
    var mf = db.prepare('SELECT * FROM manga_fibers WHERE id=?').get(pi.id);
    if (mf && mf.splitter_id) {
      db.prepare('UPDATE manga_fibers SET active_power=1 WHERE splitter_id=? AND splitter_output>0 AND manga_id=?').run(mf.splitter_id, mangaId);
    }
  }
  const fibers = db.prepare('SELECT mf.*, COALESCE(sp.name, ms.name) as splitter_name FROM manga_fibers mf LEFT JOIN splitters sp ON sp.id = mf.splitter_id LEFT JOIN manga_splitters ms ON ms.id = mf.splitter_id WHERE mf.manga_id = ? ORDER BY mf.fiber_number').all(mangaId);
  res.json(fibers);
});

app.post('/api/mangas/:id/fibers', (req, res) => {
  const { fiber_number, splitter_id, splitter_output, source_type, source_id, target_type, target_id } = req.body;
  db.prepare('INSERT INTO manga_fibers (manga_id, fiber_number, splitter_id, splitter_output, source_type, source_id, target_type, target_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, fiber_number, splitter_id || null, splitter_output || null, source_type, source_id, target_type, target_id);
  res.json({ message: 'Fibra agregada a manga' });
});

app.put('/api/manga-fibers/:id', (req, res) => {
  const { active_power, power_level, client_name, notes } = req.body;
  db.prepare('UPDATE manga_fibers SET active_power=?, power_level=?, client_name=?, notes=? WHERE id=?')
    .run(active_power ? 1 : 0, power_level || null, client_name || null, notes || null, req.params.id);
  res.json({ message: 'Fibra de manga actualizada' });
});

app.delete('/api/manga-fibers/:id', (req, res) => {
  db.prepare('DELETE FROM manga_fibers WHERE id=?').run(req.params.id);
  res.json({ message: 'Fibra eliminada de manga' });
});

// ========== Cables / Rutas ==========
app.get('/api/cables', (req, res) => {
  const cables = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM fiber_connections fc WHERE fc.cable_id = c.id) as fiber_count_used
    FROM cables c ORDER BY c.name
  `).all();

  const getPoints = db.prepare('SELECT * FROM cable_points WHERE cable_id = ? ORDER BY sequence');
  const getFibers = db.prepare(`
    SELECT fc.*,
      CASE WHEN fc.source_type = 'olt' THEN (SELECT name FROM olts WHERE id = fc.source_id) END as source_name,
      CASE WHEN fc.source_type = 'manga' THEN (SELECT name FROM mangas WHERE id = fc.source_id) END as source_name2,
      CASE WHEN fc.target_type = 'nap' THEN (SELECT name FROM naps WHERE id = fc.target_id) END as target_name
    FROM fiber_connections fc WHERE fc.cable_id = ? ORDER BY fc.fiber_number
  `);

  return res.json(cables.map(c => ({
    ...c,
    points: getPoints.all(c.id),
    fibers: getFibers.all(c.id)
  })));
});

app.post('/api/cables', (req, res) => {
  const { name, fiber_count = 12, tube_count = 4, cable_type = 'ADSS', attenuation_db_per_km = 0.35, color = '#3388ff', length_m = 0, cable_type_id } = req.body;
  const result = db.prepare('INSERT INTO cables (name, fiber_count, tube_count, cable_type, attenuation_db_per_km, color, length_m, cable_type_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name, fiber_count, tube_count, cable_type, attenuation_db_per_km, color, length_m, cable_type_id || null);
  res.json({ id: result.lastInsertRowid, message: 'Cable creado' });
});

app.put('/api/cables/:id', (req, res) => {
  const { name, color } = req.body;
  db.prepare('UPDATE cables SET name=?, color=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(name, color || '#3388ff', req.params.id);
  res.json({ message: 'Cable actualizado' });
});

app.delete('/api/cables/:id', (req, res) => {
  db.prepare('DELETE FROM cables WHERE id=?').run(req.params.id);
  res.json({ message: 'Cable eliminado' });
});

// Add/update cable points - preserves existing element points to avoid cascade-deleting fusions
app.post('/api/cables/:id/points', (req, res) => {
  const { points } = req.body; // array of {lat, lng, element_type?, element_id?}
  const cableId = parseInt(req.params.id);

  // Get existing cable points for matching
  const existingPts = db.prepare('SELECT * FROM cable_points WHERE cable_id=? ORDER BY sequence').all(cableId);

  // Delete only pure routing points (no element reference) - these can be safely recreated
  db.prepare('DELETE FROM cable_points WHERE cable_id=? AND element_type IS NULL AND element_id IS NULL').run(cableId);

  // Track which old point IDs we've already updated (to avoid updating same point twice)
  var updatedIds = {};
  var updatesCount = 0, insertsCount = 0;

  const insert = db.prepare('INSERT INTO cable_points (cable_id, sequence, lat, lng, element_type, element_id) VALUES (?, ?, ?, ?, ?, ?)');
  const updateSeq = db.prepare('UPDATE cable_points SET sequence=?, lat=?, lng=? WHERE id=?');

  for (var pi = 0; pi < points.length; pi++) {
    var p = points[pi];
    if (p.element_type && p.element_id) {
      // Find matching existing point (same element, same approximate location)
      var matched = null;
      for (var ei = 0; ei < existingPts.length; ei++) {
        var ep = existingPts[ei];
        if (ep.element_type === p.element_type && ep.element_id == p.element_id && !updatedIds[ep.id]) {
          // Check if lat/lng match (allow small tolerance)
          var latMatch = Math.abs(parseFloat(ep.lat) - parseFloat(p.lat)) < 0.001;
          var lngMatch = Math.abs(parseFloat(ep.lng) - parseFloat(p.lng)) < 0.001;
          if (latMatch && lngMatch) {
            matched = ep;
            break;
          }
        }
      }
      // Fallback: match by element_type+element_id even if lat/lng differ (element was moved)
      if (!matched) {
        for (var ei = 0; ei < existingPts.length; ei++) {
          var ep = existingPts[ei];
          if (ep.element_type === p.element_type && ep.element_id == p.element_id && !updatedIds[ep.id]) {
            matched = ep;
            break;
          }
        }
      }

      if (matched) {
        // Update existing point in-place (preserves ID and all FK references)
        updateSeq.run(pi + 1, p.lat, p.lng, matched.id);
        updatedIds[matched.id] = true;
        updatesCount++;
      } else {
        // New element point
        insert.run(cableId, pi + 1, p.lat, p.lng, p.element_type, p.element_id);
        insertsCount++;
      }
    } else {
      // Pure routing point - always insert (old ones were deleted above)
      insert.run(cableId, pi + 1, p.lat, p.lng, null, null);
      insertsCount++;
    }
  }

  console.log('[CABLE POINTS] Cable #' + cableId + ': ' + updatesCount + ' updated, ' + insertsCount + ' inserted');
  res.json({ message: 'Puntos guardados', updated: updatesCount, inserted: insertsCount });
});

// ========== Fiber Connections ==========
app.get('/api/fibers', (req, res) => {
  res.json(db.prepare(`
    SELECT fc.*, oltp.power as olt_power
    FROM fiber_connections fc
    LEFT JOIN olt_ports oltp ON oltp.id = fc.source_olt_port_id
    ORDER BY fc.cable_id, fc.fiber_number
  `).all());
});

app.post('/api/fibers', (req, res) => {
  const { cable_id, fiber_number, source_type, source_id, source_port_id,
          target_type, target_id, target_port_id, source_olt_port_id } = req.body;

  // Calculate loss
  let total_loss = 0;
  let power_level = null;

  if (source_olt_port_id && source_type === 'olt') {
    const port = db.prepare('SELECT power FROM olt_ports WHERE id=?').get(source_olt_port_id);
    if (port) power_level = port.power;
  }

  const result = db.prepare(`INSERT INTO fiber_connections
    (cable_id, fiber_number, source_type, source_id, source_port_id, target_type, target_id, target_port_id, source_olt_port_id, total_loss, power_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(cable_id, fiber_number, source_type, source_id, source_port_id || null,
         target_type, target_id, target_port_id || null, source_olt_port_id || null, total_loss, power_level);

  res.json({ id: result.lastInsertRowid });
});

// ====== Power Chain Propagation (TOMODAT style) ======
// Follows fiber fusions through multiple mangas to propagate power
// from OLT → Cable → Manga → Cable → Manga → ... → NAP → Client
// Enhanced: also follows splices and splitters for GPON distribution

function propagatePowerChain(fiberConnId, initialPower) {
  var visited = new Set();

  function followChain(fcId, currentPower, depth) {
    if (depth > 25 || visited.has(fcId)) return;
    visited.add(fcId);

    var fc = db.prepare('SELECT * FROM fiber_connections WHERE id=?').get(fcId);
    if (!fc) return;

    // Cable attenuation
    var cable = db.prepare('SELECT * FROM cables WHERE id=?').get(fc.cable_id);
    var cableLoss = 0;
    if (cable && cable.length_m > 0) {
      var atten = cable.attenuation_db_per_km || 0.35;
      cableLoss = (cable.length_m / 1000) * atten;
    }

    // Fusion losses on this cable
    var fusionsIn = db.prepare(`
      SELECT COALESCE(SUM(f.loss_db), 0) as total_loss
      FROM fusions f JOIN cable_points cp_in ON cp_in.id = f.cable_connection_id_in
      WHERE cp_in.cable_id = ? AND (f.fiber_in = ? OR f.fiber_out = ?)
    `).get(fc.cable_id, fc.fiber_number, fc.fiber_number);
    var fusionLoss = fusionsIn ? (fusionsIn.total_loss || 0) : 0;

    var powerAfterCable = currentPower - cableLoss - fusionLoss;

    db.prepare('UPDATE fiber_connections SET active_power=1, power_level=?, total_loss=? WHERE id=?')
      .run(Math.round(powerAfterCable * 100) / 100, Math.round((cableLoss + fusionLoss) * 100) / 100, fcId);

    // ====== TARGET: MANGA ======
    if (fc.target_type === 'manga') {
      var mangaId = fc.target_id;
      var cablePt = db.prepare(
        "SELECT cp.id FROM cable_points cp WHERE cp.cable_id=? AND cp.element_type='manga' AND cp.element_id=? LIMIT 1"
      ).get(fc.cable_id, mangaId);
      if (!cablePt) return;
      var cablePtId = cablePt.id;

      // --- PATH A: Fusion (cable_point → cable_point passthrough) ---
      var fusionOut = db.prepare(`
        SELECT f.*, cp_out.cable_id as out_cable_id, f.fiber_out as out_fiber
        FROM fusions f JOIN cable_points cp_out ON cp_out.id = f.cable_connection_id_out
        WHERE f.cable_connection_id_in=? AND f.fiber_in=?
      `).get(cablePtId, fc.fiber_number);

      if (!fusionOut) {
        fusionOut = db.prepare(`
          SELECT f.*, cp_in.cable_id as out_cable_id, f.fiber_in as out_fiber
          FROM fusions f JOIN cable_points cp_in ON cp_in.id = f.cable_connection_id_in
          WHERE f.cable_connection_id_out=? AND f.fiber_out=?
        `).get(cablePtId, fc.fiber_number);
      }

      if (fusionOut && fusionOut.out_cable_id) {
        var nfc = db.prepare(
          'SELECT * FROM fiber_connections WHERE cable_id=? AND fiber_number=? ORDER BY id LIMIT 1'
        ).get(fusionOut.out_cable_id, fusionOut.out_fiber);
        if (nfc) { followChain(nfc.id, powerAfterCable, depth + 1); return; }
      }

      // --- PATH B: Splice (cable_point → manga_fiber → splitter → manga_fiber → cable_point) ---
      var splices = db.prepare(`
        SELECT s.* FROM splices s
        WHERE ((s.fiber_a_type='cable_fiber' AND s.fiber_a_id=?)
           OR (s.fiber_b_type='cable_fiber' AND s.fiber_b_id=?))
          AND s.manga_id=?
      `).all(cablePtId, cablePtId, mangaId);

      splices.forEach(function(s) {
        var mfId = null;
        if (s.fiber_a_type === 'cable_fiber' && s.fiber_a_id === cablePtId && s.fiber_a_port === fc.fiber_number)
          mfId = s.fiber_b_id;
        else if (s.fiber_b_type === 'cable_fiber' && s.fiber_b_id === cablePtId && s.fiber_b_port === fc.fiber_number)
          mfId = s.fiber_a_id;
        if (!mfId) return;

        var mf = db.prepare('SELECT * FROM manga_fibers WHERE id=?').get(mfId);
        if (!mf) return;

        var powerAtMF = powerAfterCable - (s.loss_db || 0.1);
        db.prepare('UPDATE manga_fibers SET active_power=1, power_level=? WHERE id=?')
          .run(Math.round(powerAtMF * 100) / 100, mfId);

        // If this manga_fiber is a SPLITTER INPUT (splitter_output=0), propagate through
        if (mf.splitter_id && mf.splitter_output === 0) {
          var splitter = db.prepare(
            'SELECT sp.*, st.loss_db FROM splitters sp LEFT JOIN splitter_types st ON st.id=sp.splitter_type_id WHERE sp.id=?'
          ).get(mf.splitter_id);
          if (!splitter || !splitter.loss_db) return;

          var outPower = powerAtMF - splitter.loss_db;
          var outMFs = db.prepare(
            'SELECT * FROM manga_fibers WHERE splitter_id=? AND splitter_output>0'
          ).all(mf.splitter_id);

          outMFs.forEach(function(outMF) {
            db.prepare('UPDATE manga_fibers SET active_power=1, power_level=? WHERE id=?')
              .run(Math.round(outPower * 100) / 100, outMF.id);

            // Follow output splices from this manga_fiber to cable fibers
            var outSplices = db.prepare(`
              SELECT s.* FROM splices s
              WHERE ((s.fiber_a_type='manga_fiber' AND s.fiber_a_id=?)
                 OR (s.fiber_b_type='manga_fiber' AND s.fiber_b_id=?))
                AND s.manga_id=?
            `).all(outMF.id, outMF.id, mangaId);

            outSplices.forEach(function(os) {
              var outCPId = null, outFN = null;
              if (os.fiber_a_type === 'cable_fiber' && os.fiber_b_type === 'manga_fiber' && os.fiber_b_id === outMF.id)
                { outCPId = os.fiber_a_id; outFN = os.fiber_a_port; }
              else if (os.fiber_b_type === 'cable_fiber' && os.fiber_a_type === 'manga_fiber' && os.fiber_a_id === outMF.id)
                { outCPId = os.fiber_b_id; outFN = os.fiber_b_port; }
              if (!outCPId || !outFN) return;

              var outCP = db.prepare('SELECT * FROM cable_points WHERE id=?').get(outCPId);
              if (!outCP) return;

              var powerOut = outPower - (os.loss_db || 0.1);
              var nextFc = db.prepare(
                'SELECT * FROM fiber_connections WHERE cable_id=? AND fiber_number=? ORDER BY id LIMIT 1'
              ).get(outCP.cable_id, outFN);
              if (nextFc) followChain(nextFc.id, powerOut, depth + 1);
            });
          });
        }
      });
    }

    // ====== TARGET: NAP ======
    if (fc.target_type === 'nap') {
      var napData = db.prepare(`
        SELECT n.*, st.name as sn, st.loss_db as sl
        FROM naps n LEFT JOIN splitter_types st ON st.id = n.splitter_type_id WHERE n.id=?
      `).get(fc.target_id);
      if (napData && napData.sl) {
        var napOutPower = powerAfterCable - napData.sl;
        db.prepare('UPDATE nap_ports SET fiber_number=?, notes=? WHERE nap_id=? AND port_number=?')
          .run(fc.fiber_number, '⚡ ' + Math.round(napOutPower * 100) / 100 + ' dBm', fc.target_id, fc.target_port_id || 1);
      }
    }
  }

  followChain(fiberConnId, initialPower, 0);
}

app.put('/api/fibers/:id/activate', (req, res) => {
  const { active_power, power_level } = req.body;

  if (active_power && power_level !== null && power_level !== undefined) {
    propagatePowerChain(parseInt(req.params.id), parseFloat(power_level));
  } else {
    db.prepare('UPDATE fiber_connections SET active_power=?, power_level=?, total_loss=? WHERE id=?')
      .run(active_power ? 1 : 0, power_level || null, req.body.total_loss || 0, req.params.id);
  }

  res.json({ message: 'Potencia propagada en cadena' });
});

app.delete('/api/fibers/:id', (req, res) => {
  // Obtener data ANTES de borrar para limpiar potencia downstream
  var fc = db.prepare('SELECT * FROM fiber_connections WHERE id=?').get(req.params.id);
  if (fc) {
    // Limpiar manga_fibers que recibieron potencia desde este cable+fiber via splices
    var cablePts = db.prepare('SELECT id FROM cable_points WHERE cable_id=?').all(fc.cable_id);
    cablePts.forEach(function(pt) {
      // Splices que conectan este cable_point a manga_fibers
      var splices = db.prepare(`SELECT fiber_a_id, fiber_b_id, fiber_a_type, fiber_b_type FROM splices
        WHERE (fiber_a_type='cable_fiber' AND fiber_a_id=?) OR (fiber_b_type='cable_fiber' AND fiber_b_id=?)`).all(pt.id, pt.id);
      splices.forEach(function(s) {
        var mfId = s.fiber_a_type === 'manga_fiber' ? s.fiber_a_id : s.fiber_b_id;
        if (mfId) {
          db.prepare('UPDATE manga_fibers SET active_power=0, power_level=NULL WHERE id=?').run(mfId);
          // Limpiar tambien las salidas del splitter si esta manga_fiber es input
          var mf = db.prepare('SELECT splitter_id FROM manga_fibers WHERE id=?').get(mfId);
          if (mf && mf.splitter_id) {
            db.prepare('UPDATE manga_fibers SET active_power=0, power_level=NULL WHERE splitter_id=? AND splitter_output>0').run(mf.splitter_id);
          }
        }
      });
    });
  }
  db.prepare('DELETE FROM fiber_connections WHERE id=?').run(req.params.id);
  res.json({ message: 'Fibra eliminada y potencia limpiada' });
});

// PUT /api/fibers/:id - general update (for power, activation, etc.)
app.put('/api/fibers/:id', (req, res) => {
  const { active_power, power_level, cable_id, fiber_number, source_type, source_id, source_port_id, target_type, target_id, target_port_id, source_olt_port_id } = req.body;

  const fiber = db.prepare('SELECT * FROM fiber_connections WHERE id=?').get(req.params.id);
  if (!fiber) return res.status(404).json({ error: 'Fibra no encontrada' });

  const fields = [];
  const values = [];

  if (active_power !== undefined) { fields.push('active_power=?'); values.push(active_power ? 1 : 0); }
  if (power_level !== undefined) { fields.push('power_level=?'); values.push(power_level); }
  if (cable_id !== undefined) { fields.push('cable_id=?'); values.push(cable_id); }
  if (fiber_number !== undefined) { fields.push('fiber_number=?'); values.push(fiber_number); }
  if (source_type !== undefined) { fields.push('source_type=?'); values.push(source_type); }
  if (source_id !== undefined) { fields.push('source_id=?'); values.push(source_id); }
  if (source_port_id !== undefined) { fields.push('source_port_id=?'); values.push(source_port_id); }
  if (target_type !== undefined) { fields.push('target_type=?'); values.push(target_type); }
  if (target_id !== undefined) { fields.push('target_id=?'); values.push(target_id); }
  if (target_port_id !== undefined) { fields.push('target_port_id=?'); values.push(target_port_id); }
  if (source_olt_port_id !== undefined) {
    fields.push('source_olt_port_id=?'); values.push(source_olt_port_id);
    // Si se desconecta de la OLT, limpiar potencia inmediatamente
    if (source_olt_port_id === null || source_olt_port_id === 0 || source_olt_port_id === 'null' || source_olt_port_id === '0') {
      fields.push('active_power=0'); fields.push('power_level=NULL');
    }
  }

  if (fields.length > 0) {
    values.push(req.params.id);
    db.prepare('UPDATE fiber_connections SET ' + fields.join(', ') + ' WHERE id=?').run(...values);
  }

  const updated = db.prepare('SELECT * FROM fiber_connections WHERE id=?').get(req.params.id);
  res.json({ message: 'Fibra actualizada', fiber: updated });
});

// ========== FOLDERS (Sistema de directorios) ==========

// Get full folder tree
app.get('/api/folders', (req, res) => {
  const folders = db.prepare('SELECT * FROM folders ORDER BY parent_id IS NULL DESC, parent_id, sort_order, name').all();

  // Get items for each folder
  const getItems = db.prepare('SELECT * FROM folder_items WHERE folder_id = ? ORDER BY sort_order, id');
  const foldersWithItems = folders.map(f => ({
    ...f,
    items: getItems.all(f.id)
  }));

  res.json(foldersWithItems);
});

// Create a folder
app.post('/api/folders', (req, res) => {
  const { name, parent_id } = req.body;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM folders WHERE parent_id IS ?').get(parent_id || null);
  const result = db.prepare('INSERT INTO folders (name, parent_id, sort_order) VALUES (?, ?, ?)')
    .run(name, parent_id || null, maxOrder.next);
  res.json({ id: result.lastInsertRowid, message: 'Carpeta creada' });
});

// Rename folder
app.put('/api/folders/:id', (req, res) => {
  const { name } = req.body;
  db.prepare('UPDATE folders SET name=? WHERE id=?').run(name, req.params.id);
  res.json({ message: 'Carpeta renombrada' });
});

// Move folder (change parent)
app.put('/api/folders/:id/move', (req, res) => {
  const { parent_id } = req.body;
  // Prevent circular reference
  if (parent_id) {
    let current = parent_id;
    while (current) {
      if (current == req.params.id) {
        return res.status(400).json({ error: 'No puedes mover una carpeta dentro de sí misma' });
      }
      const p = db.prepare('SELECT parent_id FROM folders WHERE id=?').get(current);
      current = p?.parent_id;
    }
  }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM folders WHERE parent_id IS ?').get(parent_id || null);
  db.prepare('UPDATE folders SET parent_id=?, sort_order=? WHERE id=?')
    .run(parent_id || null, maxOrder.next, req.params.id);
  res.json({ message: 'Carpeta movida' });
});

// Delete folder (cascade deletes sub-folders and items)
app.delete('/api/folders/:id', (req, res) => {
  const folderId = req.params.id;
  // Collect all descendant folder IDs
  const getAllChildIds = (parentId) => {
    const children = db.prepare('SELECT id FROM folders WHERE parent_id=?').all(parentId);
    let ids = [parseInt(parentId)];
    children.forEach(c => ids = ids.concat(getAllChildIds(c.id)));
    return ids;
  };
  const allIds = getAllChildIds(folderId);
  const placeholders = allIds.map(() => '?').join(',');
  // Delete all folder items in these folders
  db.prepare(`DELETE FROM folder_items WHERE folder_id IN (${placeholders})`).run(...allIds);
  // Delete all descendant folders (CASCADE will handle children)
  db.prepare(`DELETE FROM folders WHERE id IN (${placeholders})`).run(...allIds);
  res.json({ message: 'Carpeta eliminada' });
});

// Get items that are NOT in any folder (unassigned items)
app.get('/api/items-unassigned', (req, res) => {
  const oltIds = db.prepare('SELECT DISTINCT item_id FROM folder_items WHERE item_type=?')
    .all('olt').map(r => r.item_id);
  const napIds = db.prepare('SELECT DISTINCT item_id FROM folder_items WHERE item_type=?')
    .all('nap').map(r => r.item_id);
  const mangaIds = db.prepare('SELECT DISTINCT item_id FROM folder_items WHERE item_type=?')
    .all('manga').map(r => r.item_id);
  const cableIds = db.prepare('SELECT DISTINCT item_id FROM folder_items WHERE item_type=?')
    .all('cable').map(r => r.item_id);

  const unassignedOlts = oltIds.length > 0
    ? db.prepare(`SELECT id, name FROM olts WHERE id NOT IN (${oltIds.map(()=>'?').join(',')})`).all(...oltIds)
    : db.prepare('SELECT id, name FROM olts').all();
  const unassignedNaps = napIds.length > 0
    ? db.prepare(`SELECT id, name FROM naps WHERE id NOT IN (${napIds.map(()=>'?').join(',')})`).all(...napIds)
    : db.prepare('SELECT id, name FROM naps').all();
  const unassignedMangas = mangaIds.length > 0
    ? db.prepare(`SELECT id, name FROM mangas WHERE id NOT IN (${mangaIds.map(()=>'?').join(',')})`).all(...mangaIds)
    : db.prepare('SELECT id, name FROM mangas').all();
  const unassignedCables = cableIds.length > 0
    ? db.prepare(`SELECT id, name FROM cables WHERE id NOT IN (${cableIds.map(()=>'?').join(',')})`).all(...cableIds)
    : db.prepare('SELECT id, name FROM cables').all();

  res.json({ olts: unassignedOlts, naps: unassignedNaps, mangas: unassignedMangas, cables: unassignedCables });
});

// Add an item to a folder
app.post('/api/folder-items', (req, res) => {
  const { folder_id, item_type, item_id } = req.body;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM folder_items WHERE folder_id=?').get(folder_id);
  try {
    const result = db.prepare('INSERT INTO folder_items (folder_id, item_type, item_id, sort_order) VALUES (?, ?, ?, ?)')
      .run(folder_id, item_type, item_id, maxOrder.next);
    res.json({ id: result.lastInsertRowid, message: 'Item agregado a carpeta' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      res.json({ message: 'El item ya está en esta carpeta' });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// Move item to another folder
app.put('/api/folder-items/:id/move', (req, res) => {
  const { folder_id, new_type, new_item_id } = req.body;
  if (new_type && new_item_id) {
    // Update the item type/id as well (for repointing)
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM folder_items WHERE folder_id=?').get(folder_id);
    db.prepare('UPDATE folder_items SET folder_id=?, item_type=?, item_id=?, sort_order=? WHERE id=?')
      .run(folder_id, new_type, new_item_id, maxOrder.next, req.params.id);
  } else {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM folder_items WHERE folder_id=?').get(folder_id);
    db.prepare('UPDATE folder_items SET folder_id=?, sort_order=? WHERE id=?')
      .run(folder_id, maxOrder.next, req.params.id);
  }
  res.json({ message: 'Item movido' });
});

// Remove item from folder (doesn't delete the actual entity)
app.delete('/api/folder-items/:id', (req, res) => {
  db.prepare('DELETE FROM folder_items WHERE id=?').run(req.params.id);
  res.json({ message: 'Item removido de la carpeta' });
});

// Reorder items or folders
app.put('/api/folders/:id/reorder', (req, res) => {
  const { type, order } = req.body; // type: 'folder' | 'item', order: [{id, sort_order}]
  if (type === 'folder') {
    const update = db.prepare('UPDATE folders SET sort_order=? WHERE id=?');
    const txn = db.transaction(() => order.forEach(o => update.run(o.sort_order, o.id)));
    txn();
  } else {
    const update = db.prepare('UPDATE folder_items SET sort_order=? WHERE id=?');
    const txn = db.transaction(() => order.forEach(o => update.run(o.sort_order, o.id)));
    txn();
  }
  res.json({ message: 'Reordenado' });
});

// ========== Splices ==========
app.get('/api/splices', (req, res) => {
  const { manga_id, splitter_id } = req.query;
  if (splitter_id) {
    var splBySplitter = db.prepare(
      'SELECT s.* FROM splices s ' +
      'JOIN manga_fibers mf ON (mf.id = s.fiber_a_id AND s.fiber_a_type=\'manga_fiber\') ' +
      'OR (mf.id = s.fiber_b_id AND s.fiber_b_type=\'manga_fiber\') ' +
      'WHERE mf.splitter_id=? OR (mf.source_type=\'nap\' AND mf.splitter_id=?) ' +
      'ORDER BY s.name'
    ).all(splitter_id, splitter_id);
    return res.json(splBySplitter);
  }
  if (manga_id) {
    var splicesByManga = db.prepare('SELECT * FROM splices WHERE manga_id=? ORDER BY name').all(manga_id);
    if (splicesByManga.length === 0) {
      // Buscar por cable_points (para NAPs, donde manga_id=null)
      splicesByManga = db.prepare(
        'SELECT s.* FROM splices s ' +
        'JOIN cable_points cp ON (cp.id = s.fiber_a_id AND s.fiber_a_type=\'cable_fiber\') ' +
        'OR (cp.id = s.fiber_b_id AND s.fiber_b_type=\'cable_fiber\') ' +
        'WHERE cp.element_type=\'nap\' AND cp.element_id=? ' +
        'ORDER BY s.name'
      ).all(manga_id);
    }
    return res.json(splicesByManga);
  }
  res.json(db.prepare('SELECT * FROM splices ORDER BY name').all());
});

app.post('/api/splices', (req, res) => {
  const { name, manga_id, loss_db = 0.1, lat, lng, fiber_a_type, fiber_a_id, fiber_a_port, fiber_b_type, fiber_b_id, fiber_b_port } = req.body;
  const result = db.prepare(`INSERT INTO splices (name, manga_id, loss_db, lat, lng, fiber_a_type, fiber_a_id, fiber_a_port, fiber_b_type, fiber_b_id, fiber_b_port)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name || 'Splice', manga_id || null, loss_db, lat || null, lng || null,
         fiber_a_type, fiber_a_id, fiber_a_port, fiber_b_type, fiber_b_id, fiber_b_port);
  
  // ⭐ Insertar tambien en connections (nuevo modelo unificado)
  if (result.lastInsertRowid && fiber_a_type === 'cable_fiber' && fiber_b_type === 'manga_fiber') {
    // Mapear: cable fiber → buscar splitter cable_point
    var scp = db.prepare([
      'SELECT cp.id FROM cable_points cp',
      'JOIN manga_fibers mf ON mf.splitter_id = cp.splitter_id AND mf.splitter_port = cp.splitter_port',
      'WHERE mf.id = ? AND cp.splitter_id IS NOT NULL'
    ].join(' ')).get(fiber_b_id);
    if (scp) {
      var existsConn = db.prepare([
        'SELECT id FROM connections',
        'WHERE source_cp_id=? AND source_fiber=? AND target_cp_id=? AND target_fiber=?',
        'AND connection_type=\'splice\''
      ].join(' ')).get(fiber_a_id, fiber_a_port, scp.id, fiber_a_port);
      if (!existsConn) {
        db.prepare([
          'INSERT INTO connections',
          '(source_cp_id, source_fiber, target_cp_id, target_fiber, connection_type, loss_db, manga_id)',
          'VALUES (?, ?, ?, ?, \'splice\', ?, ?)'
        ].join(' ')).run(fiber_a_id, fiber_a_port, scp.id, fiber_a_port, loss_db, manga_id || null);
      }
    }
  }

  // Propagate power from cable fiber_connection to manga_fiber
  var cableConnId = null, cablePort = null, mangaFiberId = null;
  var _hasPower = false;
  if (fiber_a_type === 'cable_fiber' && fiber_b_type === 'manga_fiber') {
    cableConnId = fiber_a_id; cablePort = fiber_a_port; mangaFiberId = fiber_b_id;
  } else if (fiber_a_type === 'manga_fiber' && fiber_b_type === 'cable_fiber') {
    cableConnId = fiber_b_id; cablePort = fiber_b_port; mangaFiberId = fiber_a_id;
  }
  if (cableConnId && mangaFiberId) {
    var cablePt = db.prepare('SELECT cable_id FROM cable_points WHERE id=?').get(cableConnId);
    if (cablePt) {
      // Check fiber_connection directa
      var fc = db.prepare('SELECT * FROM fiber_connections WHERE cable_id=? AND fiber_number=? AND (active_power=1 OR (power_level IS NOT NULL AND power_level>0)) LIMIT 1').get(cablePt.cable_id, cablePort);
      // Fallback: si es splice OUTPUT, la potencia viene del splitter (manga_fiber), no del cable
      if (!fc && mangaFiberId) {
        var mfPower = db.prepare('SELECT active_power, power_level FROM manga_fibers WHERE id=?').get(mangaFiberId);
        if (mfPower && mfPower.active_power == 1) {
          _hasPower = true;
          db.prepare('UPDATE fiber_connections SET active_power=1, power_level=? WHERE cable_id=? AND fiber_number=?').run(mfPower.power_level || 9.3, cablePt.cable_id, cablePort);
          fc = db.prepare('SELECT * FROM fiber_connections WHERE cable_id=? AND fiber_number=? AND active_power=1 LIMIT 1').get(cablePt.cable_id, cablePort);
          if (fc) {
            db.prepare('UPDATE manga_fibers SET active_power=1, power_level=? WHERE id=?').run(mfPower.power_level || 9.3, mangaFiberId);
          }
        }
      }
      // Si aun no, trazar hacia atras por fusiones
      if (!fc) {
        var traceCID = cablePt.cable_id, traceFN = cablePort;
        for (var ti = 0; ti < 10; ti++) {
          var next = db.prepare(`
            SELECT cp_in.cable_id as cid_in, cp_out.cable_id as cid_out,
                   f.fiber_in, f.fiber_out,
                   COALESCE(fc_in.power_level, fc_out.power_level, 9.3) as pwr
            FROM fusions f
            LEFT JOIN cable_points cp_in ON cp_in.id = f.cable_connection_id_in
            LEFT JOIN cable_points cp_out ON cp_out.id = f.cable_connection_id_out
            LEFT JOIN fiber_connections fc_in ON fc_in.cable_id = cp_in.cable_id AND fc_in.fiber_number = f.fiber_in AND fc_in.active_power=1
            LEFT JOIN fiber_connections fc_out ON fc_out.cable_id = cp_out.cable_id AND fc_out.fiber_number = f.fiber_out AND fc_out.active_power=1
            WHERE ((cp_in.cable_id=? AND f.fiber_in=?) OR (cp_out.cable_id=? AND f.fiber_out=?))
              AND (fc_in.id IS NOT NULL OR fc_out.id IS NOT NULL)
            LIMIT 1
          `).get(traceCID, traceFN, traceCID, traceFN);
          if (next) {
            db.prepare('UPDATE fiber_connections SET active_power=1, power_level=? WHERE cable_id=? AND fiber_number=?').run(next.pwr, cablePt.cable_id, cablePort);
            fc = db.prepare('SELECT * FROM fiber_connections WHERE cable_id=? AND fiber_number=? AND active_power=1 LIMIT 1').get(cablePt.cable_id, cablePort);
            break;
          }
          // Si no encontramos con active_power, seguir a la siguiente fusion (sin active_power)
          var nextFusion = db.prepare(`
            SELECT cp_in.cable_id as cid_in, cp_out.cable_id as cid_out, f.fiber_in, f.fiber_out
            FROM fusions f
            LEFT JOIN cable_points cp_in ON cp_in.id = f.cable_connection_id_in
            LEFT JOIN cable_points cp_out ON cp_out.id = f.cable_connection_id_out
            WHERE (cp_in.cable_id=? AND f.fiber_in=?) OR (cp_out.cable_id=? AND f.fiber_out=?) LIMIT 1
          `).get(traceCID, traceFN, traceCID, traceFN);
          if (!nextFusion) break; // No more fusions to follow
          // Move to the other side of the fusion
          var moved = false;
          if (nextFusion.cid_in === traceCID && nextFusion.fiber_in === traceFN) {
            traceCID = nextFusion.cid_out; traceFN = nextFusion.fiber_out; moved = true;
          } else if (nextFusion.cid_out === traceCID && nextFusion.fiber_out === traceFN) {
            traceCID = nextFusion.cid_in; traceFN = nextFusion.fiber_in; moved = true;
          }
          if (!moved) break;
        }
      }
      if (fc) {
        _hasPower = true;
        db.prepare('UPDATE manga_fibers SET active_power=1, power_level=? WHERE id=?').run(fc.power_level, mangaFiberId);
        // Also propagate to splitter outputs (subtract splitter loss)
        var mf = db.prepare('SELECT * FROM manga_fibers WHERE id=?').get(mangaFiberId);
        if (mf) {
          var splitter = null;
          var splitterId = null;
          if (mf.splitter_id) {
            splitter = db.prepare('SELECT st.loss_db FROM splitters sp LEFT JOIN splitter_types st ON st.id=sp.splitter_type_id WHERE sp.id=?').get(mf.splitter_id);
            if (!splitter) splitter = db.prepare('SELECT st.loss_db FROM manga_splitters ms LEFT JOIN splitter_types st ON st.id=ms.splitter_type_id WHERE ms.id=?').get(mf.splitter_id);
            splitterId = mf.splitter_id;
          } else if (mf.source_type === 'nap') {
            var napSplitter = db.prepare('SELECT sp.id, st.loss_db FROM splitters sp JOIN splitter_assignments sa ON sa.splitter_id = sp.id LEFT JOIN splitter_types st ON st.id=sp.splitter_type_id WHERE sa.entity_type=? AND sa.entity_id=? LIMIT 1').get('nap', mf.source_id);
            if (napSplitter) { splitter = napSplitter; splitterId = napSplitter.id; }
          }
          if (splitter && fc.power_level !== null) {
            var outPower = Math.round((fc.power_level - splitter.loss_db) * 100) / 100;
            if (mf.splitter_id) {
              db.prepare('UPDATE manga_fibers SET active_power=1, power_level=? WHERE splitter_id=? AND splitter_output>0').run(outPower, mf.splitter_id);
            } else if (mf.source_type === 'nap') {
              db.prepare('UPDATE manga_fibers SET active_power=1, power_level=? WHERE source_type=? AND source_id=? AND splitter_output>0').run(outPower, 'nap', mf.source_id);
            }
          }
        }
      }
    }
  }

  // Propagar potencia DESDE manga_fiber (splitter output) hacia cable fiber_connection
  // Esto permite que la potencia fluya del splitter al cable y de ahi a las NAPs
  var revCableConnId = null, revCablePort = null, revMangaFiberId = null;
  if (fiber_a_type === 'manga_fiber' && fiber_b_type === 'cable_fiber') {
    revMangaFiberId = fiber_a_id; revCableConnId = fiber_b_id; revCablePort = fiber_b_port;
  } else if (fiber_a_type === 'cable_fiber' && fiber_b_type === 'manga_fiber') {
    revMangaFiberId = fiber_b_id; revCableConnId = fiber_a_id; revCablePort = fiber_a_port;
  }
  if (revCableConnId && revMangaFiberId) {
    var revMf = db.prepare('SELECT * FROM manga_fibers WHERE id=?').get(revMangaFiberId);
    if (revMf && (revMf.active_power === 1 || revMf.active_power === true || (revMf.power_level || 0) > -50)) {
      var revCablePt = db.prepare('SELECT cable_id FROM cable_points WHERE id=?').get(revCableConnId);
      if (revCablePt) {
        var existingFc = db.prepare('SELECT id FROM fiber_connections WHERE cable_id=? AND fiber_number=?').get(revCablePt.cable_id, revCablePort);
        if (!existingFc) {
          db.prepare('INSERT INTO fiber_connections (cable_id, fiber_number, active_power, power_level, total_loss) VALUES (?, ?, 1, ?, 0)')
            .run(revCablePt.cable_id, revCablePort, revMf.power_level || 2.5);
        } else {
          db.prepare('UPDATE fiber_connections SET active_power=1, power_level=? WHERE id=?')
            .run(revMf.power_level || 2.5, existingFc.id);
        }
      }
    }
  }

    syncPowerState();
  res.json({ id: result.lastInsertRowid, message: 'Splice creado', has_power: _hasPower ? 1 : 0 });
});

app.put('/api/splices/:id', (req, res) => {
  const { loss_db } = req.body;
  db.prepare('UPDATE splices SET loss_db=? WHERE id=?').run(loss_db, req.params.id);
  res.json({ message: 'Splice actualizado' });
});

app.delete('/api/splices/:id', (req, res) => {
  // Antes de borrar, obtener el splice para limpiar potencia
  var splice = db.prepare('SELECT * FROM splices WHERE id=?').get(req.params.id);
  if (splice) {
    if (splice.fiber_a_type === 'manga_fiber') {
      db.prepare('UPDATE manga_fibers SET active_power=0, power_level=NULL WHERE id=?').run(splice.fiber_a_id);
    } else if (splice.fiber_b_type === 'manga_fiber') {
      db.prepare('UPDATE manga_fibers SET active_power=0, power_level=NULL WHERE id=?').run(splice.fiber_b_id);
    }
    // Limpiar power en splitter outputs conectados a esta manga_fiber
    if (splice.fiber_a_type === 'manga_fiber') {
      var mfA = db.prepare('SELECT splitter_id FROM manga_fibers WHERE id=?').get(splice.fiber_a_id);
      if (mfA && mfA.splitter_id) {
        db.prepare('UPDATE manga_fibers SET active_power=0, power_level=NULL WHERE splitter_id=? AND splitter_output>0').run(mfA.splitter_id);
      }
    }
    if (splice.fiber_b_type === 'manga_fiber') {
      var mfB = db.prepare('SELECT splitter_id FROM manga_fibers WHERE id=?').get(splice.fiber_b_id);
      if (mfB && mfB.splitter_id) {
        db.prepare('UPDATE manga_fibers SET active_power=0, power_level=NULL WHERE splitter_id=? AND splitter_output>0').run(mfB.splitter_id);
      }
    }
    // Limpiar power en cable side
    if (splice.fiber_a_type === 'cable_fiber') {
      var ptA = db.prepare('SELECT cable_id FROM cable_points WHERE id=?').get(splice.fiber_a_id);
      if (ptA) db.prepare('UPDATE fiber_connections SET active_power=0 WHERE cable_id=? AND fiber_number=?').run(ptA.cable_id, splice.fiber_a_port);
    }
    if (splice.fiber_b_type === 'cable_fiber') {
      var ptB = db.prepare('SELECT cable_id FROM cable_points WHERE id=?').get(splice.fiber_b_id);
      if (ptB) db.prepare('UPDATE fiber_connections SET active_power=0 WHERE cable_id=? AND fiber_number=?').run(ptB.cable_id, splice.fiber_b_port);
    }
  }
  db.prepare('DELETE FROM splices WHERE id=?').run(req.params.id);
    syncPowerState();
  res.json({ message: 'Splice eliminado' });
});

// ========== FUSIONS (empalmes) - Versión antigua reemplazada por la versión mejorada abajo ==========

// ========== Splitter Types ==========
app.get('/api/splitter-types', (req, res) => {
  res.json(db.prepare('SELECT * FROM splitter_types').all());
});

// ========== NAP Connections (splitter → fibers → clients) ==========
app.get('/api/naps/:id/connections', (req, res) => {
  const napId = req.params.id;
  const nap = db.prepare('SELECT n.*, st.name as splitter_name, st.ports as splitter_ports, st.loss_db as splitter_loss FROM naps n LEFT JOIN splitter_types st ON st.id = n.splitter_type_id WHERE n.id=?').get(napId);
  if (!nap) return res.status(404).json({ error: 'NAP no encontrada' });

  const ports = db.prepare('SELECT * FROM nap_ports WHERE nap_id=? ORDER BY port_number').all(napId);

  // Get fiber connections targeting this NAP
  const fiberCons = db.prepare(`
    SELECT fc.*, c.name as cable_name, cf.color as fiber_color, cf.color_name as fiber_color_name
    FROM fiber_connections fc
    LEFT JOIN cables c ON c.id = fc.cable_id
    LEFT JOIN cable_fibers cf ON cf.cable_id = fc.cable_id AND cf.fiber_number = fc.fiber_number
    WHERE (fc.target_type='nap' AND fc.target_id=?)
    ORDER BY fc.fiber_number
  `).all(napId);

  // Also look for connections where this NAP is the source
  const sourceCons = db.prepare(`
    SELECT fc.*, c.name as cable_name, cf.color as fiber_color, cf.color_name as fiber_color_name
    FROM fiber_connections fc
    LEFT JOIN cables c ON c.id = fc.cable_id
    LEFT JOIN cable_fibers cf ON cf.cable_id = fc.cable_id AND cf.fiber_number = fc.fiber_number
    WHERE (fc.source_type='nap' AND fc.source_id=?)
    ORDER BY fc.fiber_number
  `).all(napId);

  // Check for manga fibers connected to this NAP
  const mangaFibers = db.prepare(`
    SELECT mf.*, COALESCE(sp.name, ms.name) as splitter_name
    FROM manga_fibers mf
    LEFT JOIN splitters sp ON sp.id = mf.splitter_id
    LEFT JOIN manga_splitters ms ON ms.id = mf.splitter_id
    WHERE (mf.target_type='nap' AND mf.target_id=?) OR (mf.source_type='nap' AND mf.source_id=?)
    ORDER BY mf.fiber_number
  `).all(napId, napId);

  // Build output: for each port, show what's connected
  const portDetails = ports.map(port => {
    const fiberConn = fiberCons.find(fc => fc.target_port_id === port.id);
    const sourceConn = sourceCons.find(fc => fc.source_port_id === port.id);
    const mangaFiber = mangaFibers.find(mf => mf.fiber_number === port.fiber_number);

    let client_name = port.client_name || null;
    let fiber_number = port.fiber_number || null;
    let fiber_color = null;
    let fiber_color_name = null;
    let cable_name = null;
    let power_level = null;
    let active_power = false;
    let source = null;

    if (fiberConn) {
      fiber_number = fiberConn.fiber_number;
      fiber_color = fiberConn.fiber_color;
      fiber_color_name = fiberConn.fiber_color_name;
      cable_name = fiberConn.cable_name;
      power_level = fiberConn.power_level;
      active_power = !!fiberConn.active_power;
      source = { type: 'cable', id: fiberConn.cable_id, name: fiberConn.cable_name };
      // If port has a client name but was set via NAP port, keep it
    }
    if (mangaFiber) {
      fiber_color = null; // manga fibers may not have color
      fiber_color_name = null;
      if (mangaFiber.client_name) client_name = mangaFiber.client_name;
      if (mangaFiber.active_power) {
        active_power = true;
        power_level = mangaFiber.power_level;
      }
      source = { type: 'manga', id: null, name: mangaFiber.splitter_name || 'Manga' };
    }
    if (sourceConn) {
      source = { type: 'cable_out', id: sourceConn.cable_id, name: sourceConn.cable_name };
    }

    return {
      port_number: port.port_number,
      port_id: port.id,
      fiber_number,
      fiber_color,
      fiber_color_name,
      cable_name,
      client_name,
      client_address: port.client_address,
      notes: port.notes,
      active_power,
      power_level,
      source,
      connected: !!(fiberConn || mangaFiber || sourceConn || port.fiber_number || port.client_name)
    };
  });

  // Incoming cables feeding the NAP (input to splitter)
  const incoming = db.prepare(`
    SELECT fc.*, c.name as cable_name, cf.color as fiber_color, cf.color_name as fiber_color_name
    FROM fiber_connections fc
    LEFT JOIN cables c ON c.id = fc.cable_id
    LEFT JOIN cable_fibers cf ON cf.cable_id = fc.cable_id AND cf.fiber_number = fc.fiber_number
    WHERE fc.target_type='nap' AND fc.target_id=? AND fc.target_port_id IS NULL
  `).all(napId);

  res.json({
    nap: {
      id: nap.id,
      name: nap.name,
      splitter_name: nap.splitter_name,
      splitter_ports: nap.splitter_ports,
      splitter_loss: nap.splitter_loss,
      port_capacity: nap.port_capacity
    },
    ports: portDetails,
    fiber_connections: fiberCons,
    manga_fibers: mangaFibers,
    incoming_cables: incoming
  });
});

// ========== Connect cable fiber to NAP splitter port ==========
app.post('/api/fiber-connections/connect', (req, res) => {
  const { cable_id, fiber_number, nap_id, nap_port_id, client_name, client_address, power_level } = req.body;

  if (!cable_id || !fiber_number || !nap_id) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos: cable_id, fiber_number, nap_id' });
  }

  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(cable_id);
  if (!cable) return res.status(404).json({ error: 'Cable no encontrado' });

  const nap = db.prepare('SELECT * FROM naps WHERE id=?').get(nap_id);
  if (!nap) return res.status(404).json({ error: 'NAP no encontrada' });

  // Check if this fiber is already connected
  const existing = db.prepare("SELECT * FROM fiber_connections WHERE cable_id=? AND fiber_number=? AND target_type='nap' AND target_id=?")
    .get(cable_id, fiber_number, nap_id);
  if (existing) {
    return res.status(400).json({ error: 'Esta fibra ya está conectada a esta NAP', existing_id: existing.id });
  }

  // Find or create nap_port_id
  let targetPortId = nap_port_id;
  if (!targetPortId) {
    // Find the first available port
    const freePort = db.prepare('SELECT id, port_number FROM nap_ports WHERE nap_id=? AND client_name IS NULL AND fiber_number IS NULL ORDER BY port_number LIMIT 1').get(nap_id);
    if (freePort) {
      targetPortId = freePort.id;
    } else {
      return res.status(400).json({ error: 'No hay puertos libres en esta NAP' });
    }
  }

  // Run everything in a transaction
  const result = db.transaction(() => {
    // 1. Create the fiber connection
    const insertConn = db.prepare(`INSERT INTO fiber_connections
      (cable_id, fiber_number, source_type, source_id, target_type, target_id, target_port_id, power_level, active_power)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const connResult = insertConn.run(
      cable_id, fiber_number,
      'nap', nap_id,  // source is the NAP (from splitter perspective)
      'nap', nap_id, targetPortId,
      power_level || 0, power_level ? 1 : 0
    );

    // 2. Update cable_fibers status to 'used'
    const updateFiber = db.prepare("UPDATE cable_fibers SET status='used' WHERE cable_id=? AND fiber_number=?");
    updateFiber.run(cable_id, fiber_number);

    // 3. Update the NAP port with client info
    if (client_name || fiber_number) {
      const port = db.prepare('SELECT * FROM nap_ports WHERE id=?').get(targetPortId);
      if (port) {
        db.prepare('UPDATE nap_ports SET fiber_number=?, client_name=?, client_address=? WHERE id=?')
          .run(fiber_number, client_name || null, client_address || null, targetPortId);
      }
    }

    return connResult.lastInsertRowid;
  })();

  // Get the updated fiber info
  const fiberInfo = db.prepare(`
    SELECT cf.* FROM cable_fibers cf WHERE cf.cable_id=? AND cf.fiber_number=?
  `).get(cable_id, fiber_number);

  res.json({
    id: result,
    message: 'Fibra conectada exitosamente',
    fiber: fiberInfo,
    port_id: targetPortId
  });
});

// ========== Power Calculation ==========
// Helper: calculate cable distance in km (uses GPS points or length_m)
function calcCableDistanceKm(cableId) {
  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(cableId);
  if (!cable) return 0;

  // If cable has explicit length_m, use that
  if (cable.length_m && cable.length_m > 0) {
    return cable.length_m / 1000;
  }

  // Fall back to GPS distance from cable points
  const cablePoints = db.prepare('SELECT * FROM cable_points WHERE cable_id=? ORDER BY sequence').all(cableId);
  if (cablePoints.length < 2) return 0;

  let total_distance_km = 0;
  for (let i = 1; i < cablePoints.length; i++) {
    const R = 6371;
    const dLat = (cablePoints[i].lat - cablePoints[i-1].lat) * Math.PI / 180;
    const dLng = (cablePoints[i].lng - cablePoints[i-1].lng) * Math.PI / 180;
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
              Math.cos(cablePoints[i-1].lat*Math.PI/180)*Math.cos(cablePoints[i].lat*Math.PI/180)*
              Math.sin(dLng/2)*Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    total_distance_km += R * c;
  }
  return total_distance_km;
}

// Helper: calculate total power loss for a fiber, following chain through fusions and splitters
function calculateFiberPowerChain(fiberConn, oltPower) {
  const result = {
    olt_power: oltPower || 0,
    distance_km: 0,
    cable_attenuation: 0,
    fusion_loss: 0,
    splitter_loss: 0,
    connector_loss: 1.0,
    total_loss: 0,
    remaining_power: 0,
    hops: [],
    _countedMangaSplitters: new Set(),
    _processedFusions: new Set()
  };

  let currentPower = oltPower || 0;

  // Track the fiber connection chain
  let fc = fiberConn;
  let visited = new Set();

  while (fc && !visited.has(fc.id)) {
    visited.add(fc.id);

    // Cable attenuation for this segment
    const distKm = calcCableDistanceKm(fc.cable_id);
    const cable = db.prepare('SELECT attenuation_db_per_km FROM cables WHERE id=?').get(fc.cable_id);
    const attenPerKm = cable?.attenuation_db_per_km || 0.35;
    const cableLoss = distKm * attenPerKm;

    result.distance_km += distKm;
    result.cable_attenuation += cableLoss;
    currentPower -= cableLoss;

    result.hops.push({
      type: 'cable',
      cable_id: fc.cable_id,
      fiber_number: fc.fiber_number,
      distance_km: distKm,
      cable_loss: cableLoss,
      power_after: Math.round(currentPower * 100) / 100
    });

    // If target is a NAP → add splitter loss
    if (fc.target_type === 'nap') {
      const nap = db.prepare('SELECT st.loss_db FROM naps n LEFT JOIN splitter_types st ON st.id = n.splitter_type_id WHERE n.id=?').get(fc.target_id);
      const napSplitterLoss = nap?.loss_db || 0;
      if (napSplitterLoss > 0) {
        result.splitter_loss += napSplitterLoss;
        currentPower -= napSplitterLoss;
        result.hops.push({
          type: 'nap_splitter',
          nap_id: fc.target_id,
          splitter_loss: napSplitterLoss,
          power_after: Math.round(currentPower * 100) / 100
        });
      }
    }

    // If source or target is a manga → check for manga splitter and fusions
    // Also follow fusions at any cable point on this cable for power continuity
    let nextFiberConn = null;

    // Find cable points on this cable that have fusions for this fiber
    if (!nextFiberConn) {
      const cablePoints = db.prepare('SELECT id FROM cable_points WHERE cable_id=?').all(fc.cable_id);
      for (const cp of cablePoints) {
        // Try finding fusion where this cable point is IN side
        const fusionIn = db.prepare(`
          SELECT f.*, cp_out.cable_id as out_cable_id
          FROM fusions f
          JOIN cable_points cp_out ON cp_out.id = f.cable_connection_id_out
          WHERE f.cable_connection_id_in = ? AND f.fiber_in = ?
          LIMIT 1
        `).get(cp.id, fc.fiber_number);
        if (fusionIn && !result._processedFusions.has(fusionIn.id)) {
          result._processedFusions.add(fusionIn.id);
          const fusionLoss = fusionIn.loss_db || 0;
          result.fusion_loss += fusionLoss;
          currentPower -= fusionLoss;
          result.hops.push({
            type: 'fusion', fusion_id: fusionIn.id,
            fiber_in: fusionIn.fiber_in, fiber_out: fusionIn.fiber_out,
            fusion_loss: fusionLoss, power_after: Math.round(currentPower * 100) / 100
          });
          // After fusion, keep looking - set fc to same to continue chain
          if (fusionIn.fiber_out) {
            // Look for next fiber_connection from OUT cable point, or any more fusions
            nextFiberConn = db.prepare(`
              SELECT fc.* FROM fiber_connections fc
              WHERE fc.cable_id = ? AND fc.fiber_number = ?
              LIMIT 1
            `).get(fusionIn.out_cable_id, fusionIn.fiber_out);
          }
          break;
        }
      }
    }

    // Also check manga-specific connections (splitter + existing fusion lookup)
    if (!nextFiberConn && (fc.source_type === 'manga' || fc.target_type === 'manga')) {
      const mangaId = fc.source_type === 'manga' ? fc.source_id : fc.target_id;

      // Add manga splitter loss if present (only once per manga)
      if (!result._countedMangaSplitters.has(mangaId)) {
        let mangaSplitter = db.prepare(`
          SELECT st.loss_db FROM splitters sp
          JOIN splitter_assignments sa ON sa.splitter_id = sp.id
          LEFT JOIN splitter_types st ON st.id = sp.splitter_type_id
          WHERE sa.entity_type = 'manga' AND sa.entity_id = ?
          LIMIT 1
        `).get(mangaId);
        // Fallback to legacy manga_splitters
        if (!mangaSplitter) {
          mangaSplitter = db.prepare(`
            SELECT st.loss_db FROM manga_splitters ms
            LEFT JOIN splitter_types st ON st.id = ms.splitter_type_id
            WHERE ms.manga_id = ?
          `).get(mangaId);
        }

        if (mangaSplitter && mangaSplitter.loss_db > 0) {
          result._countedMangaSplitters.add(mangaId);
          result.splitter_loss += mangaSplitter.loss_db;
          currentPower -= mangaSplitter.loss_db;
          result.hops.push({
            type: 'manga_splitter',
            manga_id: mangaId,
            splitter_loss: mangaSplitter.loss_db,
            power_after: Math.round(currentPower * 100) / 100
          });
        }
      }

      // Find cable point for this fiber connection
      const cablePoint = db.prepare(`
        SELECT id FROM cable_points
        WHERE cable_id = ? AND element_type = 'manga' AND element_id = ?
      `).get(fc.cable_id, mangaId);

      if (cablePoint) {
        // Find first fusion from this cable point with this fiber (follow one linear path)
        const fusion = db.prepare(`
          SELECT * FROM fusions
          WHERE manga_id = ? AND cable_connection_id_in = ? AND fiber_in = ?
          LIMIT 1
        `).get(mangaId, cablePoint.id, fc.fiber_number);

        if (fusion) {
          result._processedFusions.add(fusion.id);
          const fusionLoss = fusion.loss_db || 0;
          result.fusion_loss += fusionLoss;
          currentPower -= fusionLoss;

          result.hops.push({
            type: 'fusion',
            fusion_id: fusion.id,
            fiber_in: fusion.fiber_in,
            fiber_out: fusion.fiber_out,
            fusion_loss: fusionLoss,
            power_after: Math.round(currentPower * 100) / 100
          });

          // Look for next fiber connection (outgoing from manga)
          if (fusion.cable_connection_id_out && fusion.fiber_out) {
            const outPoint = db.prepare('SELECT * FROM cable_points WHERE id = ?').get(fusion.cable_connection_id_out);
            if (outPoint) {
              const nextFC = db.prepare(`
                SELECT * FROM fiber_connections
                WHERE cable_id = ? AND fiber_number = ?
              `).get(outPoint.cable_id, fusion.fiber_out);
              if (nextFC && !visited.has(nextFC.id)) {
                nextFiberConn = nextFC;
              }
            }
          }
        }

        // Also search for fusions where this fiber appears as OUT (reverse path)
        if (!fusion && !nextFiberConn) {
          const revFusion = db.prepare(`
            SELECT f.*, cp.cable_id as in_cable_id
            FROM fusions f
            LEFT JOIN cable_points cp ON cp.id = f.cable_connection_id_in
            WHERE f.manga_id = ? AND f.cable_connection_id_out = ? AND f.fiber_out = ?
            LIMIT 1
          `).get(mangaId, cablePoint.id, fc.fiber_number);

          if (revFusion && !result._processedFusions.has(revFusion.id)) {
            result._processedFusions.add(revFusion.id);
            const fusionLoss = revFusion.loss_db || 0;
            result.fusion_loss += fusionLoss;
            currentPower -= fusionLoss;

            result.hops.push({
              type: 'fusion_reverse',
              fusion_id: revFusion.id,
              fiber_in: revFusion.fiber_in,
              fiber_out: revFusion.fiber_out,
              fusion_loss: fusionLoss,
              power_after: Math.round(currentPower * 100) / 100
            });

            // Find the IN fiber connection
            if (revFusion.cable_connection_id_in && revFusion.fiber_in) {
              const inPoint = db.prepare('SELECT * FROM cable_points WHERE id = ?').get(revFusion.cable_connection_id_in);
              if (inPoint) {
                const prevFC = db.prepare(`
                  SELECT * FROM fiber_connections
                  WHERE cable_id = ? AND fiber_number = ?
                `).get(inPoint.cable_id, revFusion.fiber_in);
                if (prevFC && !visited.has(prevFC.id)) {
                  // Recurse backward: calculate power for the input fiber
                  const prevResult = calculateFiberPowerChain(prevFC, currentPower + fusionLoss);
                  currentPower = prevResult.remaining_power - fusionLoss;
                  result.distance_km += prevResult.distance_km;
                  result.cable_attenuation += prevResult.cable_attenuation;
                  result.fusion_loss += prevResult.fusion_loss;
                  result.splitter_loss += prevResult.splitter_loss;
                  result.hops = [...prevResult.hops, ...result.hops];
                  break;
                }
              }
            }
          }
        }
      }
    }

    fc = nextFiberConn;
  }

  // Add connector losses
  const connLoss = result.hops.length > 0 ? 1.0 : 0.5;
  result.connector_loss = connLoss;
  currentPower -= connLoss;

  result.total_loss = Math.round((result.olt_power - currentPower) * 100) / 100;
  result.remaining_power = Math.round(currentPower * 100) / 100;
  result.is_good = result.remaining_power >= -28;

  return result;
}

// GET calculate-power by fiber_connection_id
app.get('/api/calculate-power/:fiberId', (req, res) => {
  const fiber = db.prepare('SELECT * FROM fiber_connections WHERE id=?').get(req.params.fiberId);
  if (!fiber) return res.status(404).json({ error: 'Fibra no encontrada' });

  // Get OLT port power
  let oltPower = 0;
  if (fiber.source_olt_port_id) {
    const port = db.prepare('SELECT power FROM olt_ports WHERE id=?').get(fiber.source_olt_port_id);
    oltPower = port ? port.power : 0;
  } else {
    // Try to find OLT power by following source chain
    const port = db.prepare('SELECT power FROM olt_ports WHERE id=?').get(fiber.source_port_id);
    oltPower = port ? port.power : 2.5;
  }

  const result = calculateFiberPowerChain(fiber, oltPower);
  res.json(result);
});

// POST calculate-power with custom parameters
app.post('/api/calculate-power', (req, res) => {
  const { fiber_connection_id, olt_power, include_fusions } = req.body;

  const fiber = db.prepare('SELECT * FROM fiber_connections WHERE id=?').get(fiber_connection_id);
  if (!fiber) return res.status(404).json({ error: 'Fibra no encontrada' });

  let basePower = olt_power;
  if (!basePower) {
    if (fiber.source_olt_port_id) {
      const port = db.prepare('SELECT power FROM olt_ports WHERE id=?').get(fiber.source_olt_port_id);
      basePower = port ? port.power : 0;
    } else {
      const port = db.prepare('SELECT power FROM olt_ports WHERE id=?').get(fiber.source_port_id);
      basePower = port ? port.power : 2.5;
    }
  }

  const result = calculateFiberPowerChain(fiber, basePower);
  res.json(result);
});

// ========== Stats ==========
app.get('/api/stats', (req, res) => {
  const olts = db.prepare('SELECT COUNT(*) as c FROM olts').get().c;
  const naps = db.prepare('SELECT COUNT(*) as c FROM naps').get().c;
  const mangas = db.prepare('SELECT COUNT(*) as c FROM mangas').get().c;
  const cables = db.prepare('SELECT COUNT(*) as c FROM cables').get().c;
  const fibers = db.prepare('SELECT COUNT(*) as c FROM fiber_connections').get().c;
  const activeFibers = db.prepare('SELECT COUNT(*) as c FROM fiber_connections WHERE active_power=1').get().c;
  res.json({ olts, naps, mangas, cables, fibers, activeFibers });
});

// ========== All data for map ==========
app.get('/api/map-data', (req, res) => {
  res.json({
    olts: db.prepare('SELECT id, name, lat, lng, description, ports_count FROM olts').all(),
    naps: db.prepare('SELECT n.id, n.name, n.lat, n.lng, n.description, n.port_capacity, st.name as splitter, (SELECT COUNT(*) FROM nap_ports np WHERE np.nap_id = n.id AND np.client_name IS NOT NULL) as clients FROM naps n LEFT JOIN splitter_types st ON st.id=n.splitter_type_id').all(),
    mangas: db.prepare("SELECT id, name, lat, lng, description FROM mangas").all(),
    cables: db.prepare(`
      SELECT c.id, c.name, c.color, c.fiber_count,
        (SELECT COUNT(*) FROM fiber_connections fc WHERE fc.cable_id=c.id AND fc.active_power=1) as active_fibers
      FROM cables c
    `).all(),
    cablePoints: db.prepare('SELECT * FROM cable_points ORDER BY cable_id, sequence').all(),
    fiberConnections: db.prepare('SELECT id, cable_id, fiber_number, source_type, source_id, target_type, target_id, active_power, power_level, total_loss FROM fiber_connections').all()
  });
});

// ========== CABLE TYPES ==========
app.get('/api/cable-types', (req, res) => {
  res.json(db.prepare('SELECT * FROM cable_types ORDER BY fiber_count').all());
});

app.post('/api/cable-types', (req, res) => {
  const { name, fiber_count, tube_count = 4, attenuation_db_per_km = 0.35 } = req.body;
  const result = db.prepare('INSERT INTO cable_types (name, fiber_count, tube_count, attenuation_db_per_km) VALUES (?, ?, ?, ?)')
    .run(name, fiber_count, tube_count, attenuation_db_per_km);
  res.json({ id: result.lastInsertRowid, name, fiber_count });
});

app.put('/api/cable-types/:id', (req, res) => {
  const { name, fiber_count, tube_count, attenuation_db_per_km } = req.body;
  db.prepare('UPDATE cable_types SET name=?, fiber_count=?, tube_count=?, attenuation_db_per_km=? WHERE id=?')
    .run(name, fiber_count, tube_count, attenuation_db_per_km, req.params.id);
  res.json({ success: true });
});

app.delete('/api/cable-types/:id', (req, res) => {
  db.prepare('DELETE FROM cable_types WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ========== CABLE FIBERS (fibras individuales de cada cable) ==========
app.get('/api/cables/:id/fibers', (req, res) => {
  const fibers = db.prepare('SELECT * FROM cable_fibers WHERE cable_id=? ORDER BY fiber_number').all(req.params.id);
  res.json(fibers);
});

app.post('/api/cables/:id/fibers/init', (req, res) => {
  const cableId = req.params.id;
  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(cableId);
  if (!cable) return res.status(404).json({ error: 'Cable not found' });

  // Obtener colores estandar
  const colorCode = db.prepare('SELECT * FROM color_codes WHERE id=1').get();
  const colors = colorCode ? JSON.parse(colorCode.fusions_color_code_json) : [];

  const existing = db.prepare('SELECT COUNT(*) as c FROM cable_fibers WHERE cable_id=?').get(cableId);
  if (existing.c > 0) {
    return res.json({ message: 'Fibers already initialized', count: existing.c });
  }

  const insert = db.prepare('INSERT INTO cable_fibers (cable_id, fiber_number, color, color_name, status) VALUES (?, ?, ?, ?, ?)');
  const fiberCount = cable.fiber_count || 12;

  const insertMany = db.transaction((count) => {
    for (let i = 1; i <= count; i++) {
      const colorIdx = (i - 1) % colors.length;
      const color = colors[colorIdx] || { hex: '#cccccc', name: '' };
      insert.run(cableId, i, color.hex || '#cccccc', color.name || '', 'available');
    }
  });

  insertMany(fiberCount);
  const fibers = db.prepare('SELECT * FROM cable_fibers WHERE cable_id=? ORDER BY fiber_number').all(cableId);
  res.json(fibers);
});

app.put('/api/cable-fibers/:id', (req, res) => {
  const { status, notes } = req.body;
  const updates = [];
  if (status !== undefined) updates.push('status=?');
  if (notes !== undefined) updates.push('notes=?');
  if (updates.length === 0) return res.json({ success: false });

  const sql = 'UPDATE cable_fibers SET ' + updates.join(', ') + ' WHERE id=?';
  const params = [];
  if (status !== undefined) params.push(status);
  if (notes !== undefined) params.push(notes);
  params.push(req.params.id);

  db.prepare(sql).run(...params);
  res.json({ success: true });
});

// ========== COLOR CODES ==========
app.get('/api/color-codes', (req, res) => {
  res.json(db.prepare('SELECT * FROM color_codes').all());
});

app.put('/api/color-codes/:id', (req, res) => {
  const { name, connections_color_code_json, fusions_color_code_json } = req.body;
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name=?'); values.push(name); }
  if (connections_color_code_json !== undefined) { fields.push('connections_color_code_json=?'); values.push(connections_color_code_json); }
  if (fusions_color_code_json !== undefined) { fields.push('fusions_color_code_json=?'); values.push(fusions_color_code_json); }

  if (fields.length > 0) {
    values.push(req.params.id);
    db.prepare(`UPDATE color_codes SET ${fields.join(', ')} WHERE id=?`).run(...values);
    res.json({ message: 'Código de colores actualizado' });
  } else {
    res.json({ message: 'Sin cambios' });
  }
});

app.get('/api/color-codes/:id/colors', (req, res) => {
  const code = db.prepare('SELECT * FROM color_codes WHERE id=?').get(req.params.id);
  if (!code) return res.status(404).json({ error: 'Not found' });
  res.json({
    connections: JSON.parse(code.connections_color_code_json || '[]'),
    fusions: JSON.parse(code.fusions_color_code_json || '[]')
  });
});

app.get('/api/cables/:id/routing', (req, res) => {
  const cableId = req.params.id;
  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(cableId);
  if (!cable) return res.status(404).json({ error: 'Not found' });

  const connections = db.prepare(`
    SELECT fc.*,
      o.name as source_olt_name, n.name as source_nap_name, m.name as source_manga_name,
      o2.name as target_olt_name, n2.name as target_nap_name, m2.name as target_manga_name
    FROM fiber_connections fc
    LEFT JOIN olts o ON fc.source_type='olt' AND fc.source_id=o.id
    LEFT JOIN naps n ON fc.source_type='nap' AND fc.source_id=n.id
    LEFT JOIN mangas m ON fc.source_type='manga' AND fc.source_id=m.id
    LEFT JOIN olts o2 ON fc.target_type='olt' AND fc.target_id=o2.id
    LEFT JOIN naps n2 ON fc.target_type='nap' AND fc.target_id=n2.id
    LEFT JOIN mangas m2 ON fc.target_type='manga' AND fc.target_id=m2.id
    WHERE fc.cable_id=? ORDER BY fc.fiber_number
  `).all(cableId);

  const fibers = db.prepare('SELECT * FROM cable_fibers WHERE cable_id=? ORDER BY fiber_number').all(cableId);
  const points = db.prepare('SELECT * FROM cable_points WHERE cable_id=? ORDER BY sequence').all(cableId);

  const cablePointIds = points.map(p => p.id);
  let fusions = [];
  if (cablePointIds.length > 0) {
    const placeholders = cablePointIds.map(() => '?').join(',');
    fusions = db.prepare(`SELECT * FROM fusions WHERE cable_connection_id_in IN (${placeholders}) OR cable_connection_id_out IN (${placeholders})`)
      .all(...cablePointIds, ...cablePointIds);
  }

  res.json({ cable, fibers, connections, points, fusions });
});

// ========== INIT FIBERS FOR ALL EXISTING CABLES ==========
app.post('/api/cables/init-all-fibers', (req, res) => {
  const cables = db.prepare('SELECT id, fiber_count FROM cables').all();
  const colorCode = db.prepare('SELECT * FROM color_codes WHERE id=1').get();
  const colors = colorCode ? JSON.parse(colorCode.fusions_color_code_json) : [];
  const insert = db.prepare('INSERT OR IGNORE INTO cable_fibers (cable_id, fiber_number, color, color_name, status) VALUES (?, ?, ?, ?, ?)');

  let initialized = 0;
  cables.forEach(cable => {
    const existing = db.prepare('SELECT COUNT(*) as c FROM cable_fibers WHERE cable_id=?').get(cable.id);
    if (existing.c === 0) {
      for (let i = 1; i <= cable.fiber_count; i++) {
        const colorIdx = (i - 1) % colors.length;
        const color = colors[colorIdx] || { hex: '#cccccc', name: '' };
        insert.run(cable.id, i, color.hex || '#cccccc', color.name || '', 'available');
      }
      initialized++;
    }
  });
  res.json({ message: `Initialized fibers for ${initialized} cables` });
});

// ========== BATCH FIBER STATUS UPDATE (cable_fibers) ==========
app.post('/api/cable-fibers/batch-update', (req, res) => {
  const { updates } = req.body; // array of {id, status, notes, fiber_type}
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'Updates array is required' });
  }

  const updFields = [];
  const updVals = [];
  if (req.body.status !== undefined) updFields.push('status=?');
  if (req.body.notes !== undefined) updFields.push('notes=?');
  if (req.body.fiber_type !== undefined) updFields.push('fiber_type=?');

  if (updFields.length > 0) {
    // Apply same field to many IDs
    const sql = 'UPDATE cable_fibers SET ' + updFields.join(', ') + ', updated_at=CURRENT_TIMESTAMP WHERE id=?';
    const stmt = db.prepare(sql);
    const txn = db.transaction((items) => {
      items.forEach(item => {
        const params = [];
        if (req.body.status !== undefined) params.push(req.body.status);
        if (req.body.notes !== undefined) params.push(req.body.notes);
        if (req.body.fiber_type !== undefined) params.push(req.body.fiber_type);
        params.push(item.id);
        stmt.run(...params);
      });
    });
    txn(updates);
    res.json({ updated: updates.length, message: 'Fibras actualizadas por lote' });
  } else if (Array.isArray(updates) && updates.length > 0 && (
    updates[0].status !== undefined || updates[0].notes !== undefined || updates[0].fiber_type !== undefined
  )) {
    // Per-item updates
    const stmt = db.prepare('UPDATE cable_fibers SET status=COALESCE(?,status), notes=COALESCE(?,notes), fiber_type=COALESCE(?,fiber_type), updated_at=CURRENT_TIMESTAMP WHERE id=?');
    const txn = db.transaction((items) => {
      return items.map(item => {
        stmt.run(item.status || null, item.notes || null, item.fiber_type || null, item.id);
        return { id: item.id, status: item.status };
      });
    });
    const result = txn(updates);
    res.json({ updated: result.length, message: 'Fibras actualizadas por lote' });
  } else {
    res.status(400).json({ error: 'No valid fields provided for update' });
  }
});

// ========== CABLE-FIBERS BY MANGA (todas las fibras de cables que pasan por una manga) ==========
app.get('/api/mangas/:id/cable-fibers', (req, res) => {
  const mangaId = req.params.id;

  // Find all distinct cables whose route passes through this manga
  const cablesPassing = db.prepare(`
    SELECT DISTINCT cp.cable_id, c.name as cable_name, c.fiber_count, c.tube_count,
      c.cable_type, c.color, c.length_m, c.cable_type_id
    FROM cable_points cp
    JOIN cables c ON c.id = cp.cable_id
    WHERE cp.element_type = 'manga' AND cp.element_id = ?
  `).all(mangaId);

  // If no cable_points link, also check fusions that reference this manga
  // (some topologies may not have explicit cable_points for mangas)
  if (cablesPassing.length === 0) {
    const fusionCables = db.prepare(`
      SELECT DISTINCT fc.cable_id, c.name as cable_name, c.fiber_count, c.tube_count,
        c.cable_type, c.color, c.length_m, c.cable_type_id
      FROM fusions f
      JOIN fiber_connections fc ON fc.fiber_number = f.fiber_in AND (
        fc.cable_id = (SELECT cable_id FROM cable_points WHERE id = f.cable_connection_id_in)
      )
      JOIN cables c ON c.id = fc.cable_id
      WHERE f.manga_id = ?
    `).all(mangaId);
    cablesPassing.push(...fusionCables.filter(
      (c, i, arr) => arr.findIndex(x => x.cable_id === c.cable_id) === i
    ));
  }

  // If still none, try via cable_points where element_type starts with 'manga' (legacy)
  if (cablesPassing.length === 0) {
    const manga = db.prepare('SELECT * FROM mangas WHERE id=?').get(mangaId);
    if (manga) {
      // Search for cable_points near this manga location (within ~50m)
      const R = 6371000;
      const nearPoints = db.prepare(`
        SELECT DISTINCT cp.cable_id
        FROM cable_points cp
        WHERE (
          6371000 * 2 * ASIN(SQRT(
            POWER(SIN((? - cp.lat) * PI() / 360), 2) +
            COS(? * PI() / 180) * COS(cp.lat * PI() / 180) *
            POWER(SIN((? - cp.lng) * PI() / 360), 2)
          ))
        ) < 50
      `).all(manga.lat, manga.lat, manga.lng);

      if (nearPoints.length > 0) {
        const ids = nearPoints.map(p => p.cable_id);
        const placeholders = ids.map(() => '?').join(',');
        const detailCables = db.prepare(`
          SELECT id as cable_id, name as cable_name, fiber_count, tube_count,
            cable_type, color, length_m, cable_type_id
          FROM cables WHERE id IN (${placeholders})
        `).all(...ids);
        cablesPassing.push(...detailCables);
      }
    }
  }

  // Get fibers for each cable
  const result = cablesPassing.map(cable => {
    const fibers = db.prepare('SELECT * FROM cable_fibers WHERE cable_id=? ORDER BY fiber_number').all(cable.cable_id);
    return { ...cable, fibers };
  });

  res.json({
    manga_id: parseInt(mangaId),
    total_cables: result.length,
    total_fibers: result.reduce((sum, c) => sum + c.fibers.length, 0),
    cables: result
  });
});

// ========== FUSIONS (empalmes) - CRUD mejorado con vinculación a mangas ==========

// GET all fusions for a manga (con información detallada de cables de entrada/salida)
app.get('/api/mangas/:id/fusions', (req, res) => {
  var entityId = parseInt(req.params.id);
  const fusions = db.prepare(`
    SELECT f.*,
      c_in.name as cable_in_name, c_out.name as cable_out_name,
      c_in.color as cable_in_color, c_out.color as cable_out_color,
      fc_in.fiber_number as fc_fiber_in, fc_out.fiber_number as fc_fiber_out,
      fc_in.active_power as active_power, fc_in.power_level as power_level
    FROM fusions f
    LEFT JOIN cable_points cpi ON cpi.id = f.cable_connection_id_in
    LEFT JOIN cables c_in ON c_in.id = cpi.cable_id
    LEFT JOIN cable_points cpo ON cpo.id = f.cable_connection_id_out
    LEFT JOIN cables c_out ON c_out.id = cpo.cable_id
    LEFT JOIN fiber_connections fc_in ON fc_in.cable_id = cpi.cable_id AND fc_in.fiber_number = f.fiber_in
    LEFT JOIN fiber_connections fc_out ON fc_out.cable_id = cpo.cable_id AND fc_out.fiber_number = f.fiber_out
    WHERE f.manga_id = ?
    GROUP BY f.id
    UNION ALL
    SELECT f.*,
      c_in.name as cable_in_name, c_out.name as cable_out_name,
      c_in.color as cable_in_color, c_out.color as cable_out_color,
      fc_in.fiber_number as fc_fiber_in, fc_out.fiber_number as fc_fiber_out,
      fc_in.active_power as active_power, fc_in.power_level as power_level
    FROM fusions f
    LEFT JOIN cable_points cpi ON cpi.id = f.cable_connection_id_in
    LEFT JOIN cables c_in ON c_in.id = cpi.cable_id
    LEFT JOIN cable_points cpo ON cpo.id = f.cable_connection_id_out
    LEFT JOIN cables c_out ON c_out.id = cpo.cable_id
    LEFT JOIN fiber_connections fc_in ON fc_in.cable_id = cpi.cable_id AND fc_in.fiber_number = f.fiber_in
    LEFT JOIN fiber_connections fc_out ON fc_out.cable_id = cpo.cable_id AND fc_out.fiber_number = f.fiber_out
    WHERE (cpi.element_type='nap' AND cpi.element_id=?) OR (cpo.element_type='nap' AND cpo.element_id=?)
    GROUP BY f.id
    ORDER BY id
  `).all(entityId, entityId, entityId);
  res.json(fusions);
});

// GET fusions by cable_id (cable-centric view)
app.get('/api/cables/:id/fusions', (req, res) => {
  const fusions = db.prepare(`
    SELECT f.*,
      c_in.name as cable_in_name, c_out.name as cable_out_name,
      c_in.color as cable_in_color, c_out.color as cable_out_color,
      fc_in.fiber_number as fc_fiber_in, fc_out.fiber_number as fc_fiber_out,
      fc_in.active_power as fc_active_power_in, fc_in.power_level as fc_power_level_in,
      fc_out.active_power as fc_active_power_out, fc_out.power_level as fc_power_level_out
    FROM fusions f
    LEFT JOIN cable_points cpi ON cpi.id = f.cable_connection_id_in
    LEFT JOIN cables c_in ON c_in.id = cpi.cable_id
    LEFT JOIN cable_points cpo ON cpo.id = f.cable_connection_id_out
    LEFT JOIN cables c_out ON c_out.id = cpo.cable_id
    LEFT JOIN fiber_connections fc_in ON fc_in.cable_id = cpi.cable_id AND fc_in.fiber_number = f.fiber_in
    LEFT JOIN fiber_connections fc_out ON fc_out.cable_id = cpo.cable_id AND fc_out.fiber_number = f.fiber_out
    WHERE cpi.cable_id = ? OR cpo.cable_id = ?
    GROUP BY f.id
    ORDER BY f.id
  `).all(req.params.id, req.params.id);
  res.json(fusions);
});

// GET single fusion with full detail
app.get('/api/fusions/:id', (req, res) => {
  const fusion = db.prepare(`
    SELECT f.*,
      c_in.name as cable_in_name, c_in.color as cable_in_color, c_in.fiber_count as cable_in_fibers,
      c_out.name as cable_out_name, c_out.color as cable_out_color, c_out.fiber_count as cable_out_fibers,
      m.name as manga_name,
      cp_in.lat as cable_in_lat, cp_in.lng as cable_in_lng,
      cp_out.lat as cable_out_lat, cp_out.lng as cable_out_lng
    FROM fusions f
    LEFT JOIN cable_points cp_in ON cp_in.id = f.cable_connection_id_in
    LEFT JOIN cables c_in ON c_in.id = cp_in.cable_id
    LEFT JOIN cable_points cp_out ON cp_out.id = f.cable_connection_id_out
    LEFT JOIN cables c_out ON c_out.id = cp_out.cable_id
    LEFT JOIN mangas m ON m.id = f.manga_id
    WHERE f.id = ?
  `).get(req.params.id);
  if (!fusion) return res.status(404).json({ error: 'Fusion no encontrada' });
  res.json(fusion);
});

// POST - create fusion (empalme) con validación
app.post('/api/fusions', (req, res) => {
  const {
    name, manga_id,
    cable_connection_id_in, fiber_in,
    cable_connection_id_out, fiber_out,
    connection_type = 0, loss_db = 0.0
  } = req.body;

  // Validate: must have cable_connection_id_in and fiber_in
  if (!cable_connection_id_in || !fiber_in) {
    return res.status(400).json({ error: 'cable_connection_id_in y fiber_in son requeridos' });
  }

  // Validate cable_point_in exists
  const pointIn = db.prepare('SELECT cp.*, c.name as cable_name FROM cable_points cp JOIN cables c ON c.id=cp.cable_id WHERE cp.id=?').get(cable_connection_id_in);
  if (!pointIn) {
    return res.status(400).json({ error: 'cable_connection_id_in no encontrado' });
  }

  // Validate fiber_in exists in cable_fibers
  const fiberExists = db.prepare('SELECT id FROM cable_fibers WHERE cable_id=? AND fiber_number=?').get(pointIn.cable_id, fiber_in);
  if (!fiberExists) {
    return res.status(400).json({ error: `Fibra #${fiber_in} no existe en el cable #${pointIn.cable_id}` });
  }

  // Prevent creating 2 fusions on the same hilo
  var existingFusion = db.prepare(`
    SELECT id FROM fusions WHERE
      (cable_connection_id_in=? AND fiber_in=?) OR
      (cable_connection_id_out=? AND fiber_out=?)
    LIMIT 1
  `).get(cable_connection_id_in, fiber_in, cable_connection_id_in, fiber_in);
  if (existingFusion) {
    return res.status(409).json({ error: `El hilo #${fiber_in} ya tiene una fusion (id=${existingFusion.id}). Eliminala antes de crear otra.` });
  }

  // Also check the output side if provided
  if (cable_connection_id_out && fiber_out) {
    var existingOut = db.prepare(`
      SELECT id FROM fusions WHERE
        ((cable_connection_id_in=? AND fiber_in=?) OR
         (cable_connection_id_out=? AND fiber_out=?)) AND id != ?
      LIMIT 1
    `).get(cable_connection_id_out, fiber_out, cable_connection_id_out, fiber_out, (existingFusion ? existingFusion.id : 0));
    if (existingOut) {
      return res.status(409).json({ error: `El hilo #${fiber_out} ya tiene una fusion. Eliminala antes de crear otra.` });
    }
  }

  // If cable_connection_id_out is provided, validate it too
  if (cable_connection_id_out) {
    const pointOut = db.prepare('SELECT cp.*, c.name as cable_name FROM cable_points cp JOIN cables c ON c.id=cp.cable_id WHERE cp.id=?').get(cable_connection_id_out);
    if (!pointOut) {
      return res.status(400).json({ error: 'cable_connection_id_out no encontrado' });
    }
    if (fiber_out) {
      const fiberOutExists = db.prepare('SELECT id FROM cable_fibers WHERE cable_id=? AND fiber_number=?').get(pointOut.cable_id, fiber_out);
      if (!fiberOutExists) {
        return res.status(400).json({ error: `Fibra #${fiber_out} no existe en el cable #${pointOut.cable_id}` });
      }
    }
  }

  console.log('[FUSION] Creating fusion:', JSON.stringify({ name, manga_id, cable_connection_id_in, fiber_in, cable_connection_id_out, fiber_out, connection_type, loss_db }));

  // Auto-detect cable_id from the cable_connection_id_in point
  let result;
  try {
    result = db.prepare(`INSERT INTO fusions (name, manga_id, cable_connection_id_in, fiber_in, cable_connection_id_out, fiber_out, connection_type, loss_db)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      name || `Empalme #${fiber_in}`,
      manga_id || null,
      cable_connection_id_in,
      fiber_in,
      cable_connection_id_out || null,
      fiber_out || null,
      connection_type,
      loss_db
    );
  } catch(e) {
    console.error('[FUSION] Error:', e.message);
    console.error('[FUSION] cable_connection_id_in=' + cable_connection_id_in + ' cable_connection_id_out=' + cable_connection_id_out);
    try {
      const pin = db.prepare('SELECT * FROM cable_points WHERE id=?').get(cable_connection_id_in);
      console.error('[FUSION] pointIn exists:', !!pin);
      if (cable_connection_id_out) {
        const pout = db.prepare('SELECT * FROM cable_points WHERE id=?').get(cable_connection_id_out);
        console.error('[FUSION] pointOut exists:', !!pout);
      }
    } catch(e2) {}
    return res.status(500).json({ error: 'Error al crear fusion: ' + e.message });
  }

  // Update fiber status to 'used' if fusion is created
  if (result.lastInsertRowid) {
    db.prepare("UPDATE cable_fibers SET status='used', notes=COALESCE(notes || ' | ','') || 'fusion' WHERE cable_id=? AND fiber_number=?")
      .run(pointIn.cable_id, fiber_in);

    // ⭐ Fusion: ambos hilos comparten el MISMO fiber_uid (son el mismo hilo fisico)
    if (cable_connection_id_out && fiber_out) {
      var pointOut = db.prepare('SELECT * FROM cable_points WHERE id=?').get(cable_connection_id_out);
      if (pointOut) {
        var cfIn = db.prepare('SELECT * FROM cable_fibers WHERE cable_id=? AND fiber_number=?').get(pointIn.cable_id, fiber_in);
        var cfOut = db.prepare('SELECT * FROM cable_fibers WHERE cable_id=? AND fiber_number=?').get(pointOut.cable_id, fiber_out);
        if (cfIn && cfOut && cfIn.fiber_uid && cfOut.fiber_uid && cfIn.fiber_uid !== cfOut.fiber_uid) {
          var mergedUid = cfIn.fiber_uid;
          if (cfOut.active_power && !cfIn.active_power) mergedUid = cfOut.fiber_uid;
          // Usar el UID del que tiene power (o el del IN si ninguno)
          db.prepare('UPDATE cable_fibers SET fiber_uid=? WHERE fiber_uid=?').run(mergedUid, cfOut.fiber_uid);
          db.prepare('UPDATE cable_fibers SET fiber_uid=? WHERE fiber_uid=?').run(mergedUid, cfIn.fiber_uid);
        }
      }
    }

    // === TRACE through fusion chain to find OLT power source ===
    function hasPowerPath(cableId, fiberNum, visitados) {
      var key = cableId + ':' + fiberNum;
      if (visitados[key]) return false;
      visitados[key] = true;

      // Check if fiber_connection connects to an OLT port that has power (status Online OR power > 0)
      var fc = db.prepare(`
        SELECT fc.id FROM fiber_connections fc
        JOIN olt_ports p ON p.id = fc.source_olt_port_id
        WHERE fc.cable_id=? AND fc.fiber_number=?
        AND (p.operational_status='Online' OR (p.power IS NOT NULL AND p.power > 0))
        LIMIT 1
      `).get(cableId, fiberNum);
      if (fc) return true;

      // Check if any fusion with source_conn_id connects to this cable+fiber
      var src = db.prepare(`
        SELECT id FROM fusions WHERE source_conn_id IS NOT NULL
        AND (
          (cable_connection_id_in IN (SELECT id FROM cable_points WHERE cable_id=?) AND fiber_in=?) OR
          (cable_connection_id_out IN (SELECT id FROM cable_points WHERE cable_id=?) AND fiber_out=?)
        ) LIMIT 1
      `).get(cableId, fiberNum, cableId, fiberNum);
      if (src) return true;

      // Follow fusions to other cables
      var fusions = db.prepare(`
        SELECT f.*, cp_in.cable_id as cable_in, cp_out.cable_id as cable_out
        FROM fusions f
        LEFT JOIN cable_points cp_in ON cp_in.id = f.cable_connection_id_in
        LEFT JOIN cable_points cp_out ON cp_out.id = f.cable_connection_id_out
        WHERE (cp_in.cable_id=? AND f.fiber_in=?) OR (cp_out.cable_id=? AND f.fiber_out=?)
      `).all(cableId, fiberNum, cableId, fiberNum);

      for (var fi = 0; fi < fusions.length; fi++) {
        var f = fusions[fi];
        var fromIn = (f.cable_in === cableId && f.fiber_in === fiberNum);
        var nextCable = fromIn ? f.cable_out : f.cable_in;
        var nextFiber = fromIn ? f.fiber_out : f.fiber_in;
        if (nextCable && hasPowerPath(nextCable, nextFiber, visitados)) return true;
      }
      return false;
    }

    var sourceConnId = null;
    var visitIn = {};
    var hasPowerIn = pointIn && hasPowerPath(pointIn.cable_id, fiber_in, visitIn);
    var visitOut = {};
    var hasPowerOut = pointOut && pointOut.cable_id && fiber_out && hasPowerPath(pointOut.cable_id, fiber_out, visitOut);

    if (hasPowerIn) sourceConnId = cable_connection_id_in;
    else if (hasPowerOut) sourceConnId = cable_connection_id_out;

    if (sourceConnId) {
      db.prepare('UPDATE fusions SET source_conn_id=? WHERE id=?')
        .run(sourceConnId, result.lastInsertRowid);
    }
  }

  // === Propagate power from cable_in to cable_out via fusion ===
  if (cable_connection_id_out && fiber_out) {
    var pointOut = db.prepare('SELECT cp.*, c.name as cable_name FROM cable_points cp JOIN cables c ON c.id=cp.cable_id WHERE cp.id=?').get(cable_connection_id_out);
    if (pointOut) {
      // Look for an active fiber_connection on the input side
      var fcIn = db.prepare('SELECT * FROM fiber_connections WHERE cable_id=? AND fiber_number=? AND active_power=1 LIMIT 1').get(pointIn.cable_id, fiber_in);
      if (fcIn) {
        // Check if a fiber_connection exists on the output side
        var fcOut = db.prepare('SELECT * FROM fiber_connections WHERE cable_id=? AND fiber_number=? LIMIT 1').get(pointOut.cable_id, fiber_out);
        if (fcOut) {
          // Update existing fiber_connection with incoming power
          var outPower = Math.round((fcIn.power_level - (loss_db || 0)) * 100) / 100;
          db.prepare('UPDATE fiber_connections SET active_power=1, power_level=?, source_type=?, source_id=? WHERE id=?')
            .run(outPower, 'cable', pointIn.cable_id, fcOut.id);
        }
      }
    }
    
    // ⭐ Insertar tambien en connections (nuevo modelo unificado)
    if (cable_connection_id_out && fiber_out && result.lastInsertRowid) {
      var existsConn = db.prepare([
        'SELECT id FROM connections',
        'WHERE source_cp_id=? AND source_fiber=? AND target_cp_id=? AND target_fiber=?',
        'AND connection_type=\'fusion\''
      ].join(' ')).get(cable_connection_id_in, fiber_in, cable_connection_id_out, fiber_out);
      if (!existsConn) {
        db.prepare([
          'INSERT INTO connections',
          '(source_cp_id, source_fiber, target_cp_id, target_fiber, connection_type, loss_db, manga_id)',
          'VALUES (?, ?, ?, ?, \'fusion\', ?, ?)'
        ].join(' ')).run(cable_connection_id_in, fiber_in, cable_connection_id_out, fiber_out, loss_db, manga_id || null);
      }
    }
  }
  
  const created = db.prepare('SELECT * FROM fusions WHERE id=?').get(result.lastInsertRowid);
  res.json({ id: result.lastInsertRowid, message: 'Empalme creado', fusion: created });
});

// PUT - update fusion
app.put('/api/fusions/:id', (req, res) => {
  const fusion = db.prepare('SELECT * FROM fusions WHERE id=?').get(req.params.id);
  if (!fusion) return res.status(404).json({ error: 'Fusion no encontrada' });

  const {
    name, manga_id,
    cable_connection_id_out, fiber_out,
    connection_type, loss_db
  } = req.body;

  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name=?'); params.push(name); }
  if (manga_id !== undefined) { updates.push('manga_id=?'); params.push(manga_id); }
  if (cable_connection_id_out !== undefined) { updates.push('cable_connection_id_out=?'); params.push(cable_connection_id_out); }
  if (fiber_out !== undefined) { updates.push('fiber_out=?'); params.push(fiber_out); }
  if (connection_type !== undefined) { updates.push('connection_type=?'); params.push(connection_type); }
  if (loss_db !== undefined) { updates.push('loss_db=?'); params.push(loss_db); }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No hay campos para actualizar' });
  }

  params.push(req.params.id);
  db.prepare('UPDATE fusions SET ' + updates.join(', ') + ' WHERE id=?').run(...params);

  const updated = db.prepare('SELECT * FROM fusions WHERE id=?').get(req.params.id);
  res.json({ success: true, message: 'Empalme actualizado', fusion: updated });
});

// DELETE - delete fusion and optionally revert fiber status
app.delete('/api/fusions/:id', (req, res) => {
  const fusion = db.prepare(`
    SELECT f.*, cp.cable_id as cable_in_id, cp2.cable_id as cable_out_id
    FROM fusions f
    LEFT JOIN cable_points cp ON cp.id = f.cable_connection_id_in
    LEFT JOIN cable_points cp2 ON cp2.id = f.cable_connection_id_out
    WHERE f.id = ?
  `).get(req.params.id);

  if (!fusion) return res.status(404).json({ error: 'Fusion no encontrada' });

  // Limpiar potencia en los cables afectados
  [fusion.cable_in_id, fusion.cable_out_id].forEach(function(cid) {
    if (!cid) return;
    db.prepare("UPDATE fiber_connections SET active_power=0 WHERE cable_id=? AND fiber_number=?")
      .run(cid, fusion.fiber_in);
    db.prepare("UPDATE fiber_connections SET active_power=0 WHERE cable_id=? AND fiber_number=?")
      .run(cid, fusion.fiber_out);
    // Also clear manga_fibers power via splices on these cables
    var pts = db.prepare('SELECT id FROM cable_points WHERE cable_id=?').all(cid);
    pts.forEach(function(pt) {
      db.prepare(`UPDATE manga_fibers SET active_power=0 WHERE id IN (
        SELECT CASE WHEN fiber_a_type='manga_fiber' THEN fiber_a_id ELSE fiber_b_id END
        FROM splices WHERE (fiber_a_type='cable_fiber' AND fiber_a_id=?) OR (fiber_b_type='cable_fiber' AND fiber_b_id=?)
      )`).run(pt.id, pt.id);
    });
  });

  // Get the fiber_in from the fusion to revert its status
  if (fusion.cable_in_id && fusion.fiber_in) {
    const otherFusions = db.prepare(`
      SELECT COUNT(*) as c FROM fusions
      WHERE cable_connection_id_in IN (SELECT id FROM cable_points WHERE cable_id=?)
      AND fiber_in=? AND id != ?
    `).get(fusion.cable_in_id, fusion.fiber_in, req.params.id);
    if (otherFusions.c === 0) {
      db.prepare("UPDATE cable_fibers SET status='available' WHERE cable_id=? AND fiber_number=?")
        .run(fusion.cable_in_id, fusion.fiber_in);
    }
  }



    // ⭐ Dividir fiber_uid: cada lado ahora es un hilo diferente
  if (fusion.cable_in_id && fusion.fiber_in) {
    var cfIn = db.prepare('SELECT * FROM cable_fibers WHERE cable_id=? AND fiber_number=?').get(fusion.cable_in_id, fusion.fiber_in);
    if (cfIn && cfIn.fiber_uid) {
      db.prepare('UPDATE cable_fibers SET fiber_uid=? WHERE cable_id=? AND fiber_number=?').run('fiber-' + Date.now() + '-' + fusion.cable_in_id + '-' + fusion.fiber_in, fusion.cable_in_id, fusion.fiber_in);
    }
  }
  if (fusion.cable_out_id && fusion.fiber_out) {
    var cfOut = db.prepare('SELECT * FROM cable_fibers WHERE cable_id=? AND fiber_number=?').get(fusion.cable_out_id, fusion.fiber_out);
    if (cfOut && cfOut.fiber_uid) {
      db.prepare('UPDATE cable_fibers SET fiber_uid=? WHERE cable_id=? AND fiber_number=?').run('fiber-' + Date.now() + '-' + fusion.cable_out_id + '-' + fusion.fiber_out, fusion.cable_out_id, fusion.fiber_out);
    }
  }
  // ⭐ Eliminar conexion en connections tambien
  if (fusion.cable_connection_id_in && fusion.cable_connection_id_out) {
    db.prepare([
      'DELETE FROM connections',
      'WHERE source_cp_id=? AND source_fiber=? AND target_cp_id=? AND target_fiber=?',
      'AND connection_type=\'fusion\''
    ].join(' ')).run(fusion.cable_connection_id_in, fusion.fiber_in, fusion.cable_connection_id_out, fusion.fiber_out);
  }
  syncPowerState();
  db.prepare('DELETE FROM fusions WHERE id=?').run(req.params.id);
  res.json({ success: true, message: 'Empalme eliminado' });
});

// ========== REPORTS SUMMARY ==========
app.get('/api/reports/summary', (req, res) => {
  const oltCount = db.prepare('SELECT COUNT(*) as c FROM olts').get().c;
  const napCount = db.prepare('SELECT COUNT(*) as c FROM naps').get().c;
  const mangaCount = db.prepare('SELECT COUNT(*) as c FROM mangas').get().c;
  const cableCount = db.prepare('SELECT COUNT(*) as c FROM cables').get().c;

  const totalFibers = db.prepare('SELECT COALESCE(SUM(fiber_count), 0) as c FROM cables').get().c;
  const usedFibers = db.prepare('SELECT COUNT(*) as c FROM fiber_connections').get().c;
  const activeFibers = db.prepare('SELECT COUNT(*) as c FROM fiber_connections WHERE active_power=1').get().c;

  const fusionCount = db.prepare('SELECT COUNT(*) as c FROM fusions').get().c;
  const spliceCount = db.prepare('SELECT COUNT(*) as c FROM splices').get().c;

  const avgFusionLoss = db.prepare('SELECT COALESCE(AVG(loss_db), 0) as avg FROM fusions WHERE loss_db > 0').get().avg;
  const avgSpliceLoss = db.prepare('SELECT COALESCE(AVG(loss_db), 0) as avg FROM splices WHERE loss_db > 0').get().avg;

  const napPortsTotal = db.prepare('SELECT COUNT(*) as c FROM nap_ports').get().c;
  const napPortsUsed = db.prepare("SELECT COUNT(*) as c FROM nap_ports WHERE client_name IS NOT NULL OR fiber_number IS NOT NULL").get().c;

  const cableLengthTotal = db.prepare('SELECT COALESCE(SUM(length_m), 0) as c FROM cables').get().c;

  const mangaFusions = db.prepare(`
    SELECT m.name as manga_name, COUNT(f.id) as fusion_count, COALESCE(AVG(f.loss_db), 0) as avg_loss
    FROM fusions f
    LEFT JOIN mangas m ON m.id = f.manga_id
    GROUP BY f.manga_id
  `).all();

  const cableFibersUsage = db.prepare(`
    SELECT c.name as cable_name, c.fiber_count as total,
      (SELECT COUNT(*) FROM fiber_connections fc WHERE fc.cable_id = c.id) as used,
      (SELECT COUNT(*) FROM fiber_connections fc WHERE fc.cable_id = c.id AND fc.active_power = 1) as active
    FROM cables c
    ORDER BY c.name
  `).all();

  res.json({
    totals: { olts: oltCount, naps: napCount, mangas: mangaCount, cables: cableCount },
    fibers: {
      total: totalFibers, used: usedFibers, active: activeFibers, available: totalFibers - usedFibers
    },
    connections: {
      nap_ports_total: napPortsTotal, nap_ports_used: napPortsUsed, nap_ports_available: napPortsTotal - napPortsUsed
    },
    splices: {
      fusions: fusionCount, splices: spliceCount, total: fusionCount + spliceCount,
      avg_fusion_loss_db: Math.round(avgFusionLoss * 100) / 100,
      avg_splice_loss_db: Math.round(avgSpliceLoss * 100) / 100
    },
    infrastructure: {
      total_cable_length_m: cableLengthTotal,
      total_cable_length_km: Math.round(cableLengthTotal / 1000 * 100) / 100
    },
    fusion_by_manga: mangaFusions,
    cable_fibers_usage: cableFibersUsage
  });
});

// ========== FIBER ROUTE (complete path from OLT to client) ==========
app.get('/api/fibers/:id/route', (req, res) => {
  const fiber = db.prepare(`
    SELECT fc.*,
      o.name as source_olt_name, o.lat as source_olt_lat, o.lng as source_olt_lng,
      n.name as target_nap_name, n.lat as target_nap_lat, n.lng as target_nap_lng,
      n2.name as source_nap_name, n2.lat as source_nap_lat, n2.lng as source_nap_lng,
      m.name as source_manga_name, m.lat as source_manga_lat, m.lng as source_manga_lng,
      m2.name as target_manga_name, m2.lat as target_manga_lat, m2.lng as target_manga_lng,
      c.name as cable_name, c.color as cable_color, c.length_m as cable_length, c.fiber_count,
      c.attenuation_db_per_km,
      oltp.power as olt_port_power, oltp.port_number as olt_port_number
    FROM fiber_connections fc
    LEFT JOIN cables c ON c.id = fc.cable_id
    LEFT JOIN olts o ON fc.source_type='olt' AND fc.source_id=o.id
    LEFT JOIN naps n ON fc.target_type='nap' AND fc.target_id=n.id
    LEFT JOIN naps n2 ON fc.source_type='nap' AND fc.source_id=n2.id
    LEFT JOIN mangas m ON fc.source_type='manga' AND fc.source_id=m.id
    LEFT JOIN mangas m2 ON fc.target_type='manga' AND fc.target_id=m2.id
    LEFT JOIN olt_ports oltp ON oltp.id = fc.source_olt_port_id
    WHERE fc.id=?
  `).get(req.params.id);

  if (!fiber) return res.status(404).json({ error: 'Fibra no encontrada' });

  const cablePoints = db.prepare('SELECT * FROM cable_points WHERE cable_id=? ORDER BY sequence').all(fiber.cable_id);

  let distance_km = 0;
  for (let i = 1; i < cablePoints.length; i++) {
    const R = 6371;
    const dLat = (cablePoints[i].lat - cablePoints[i-1].lat) * Math.PI / 180;
    const dLng = (cablePoints[i].lng - cablePoints[i-1].lng) * Math.PI / 180;
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
              Math.cos(cablePoints[i-1].lat*Math.PI/180)*Math.cos(cablePoints[i].lat*Math.PI/180)*
              Math.sin(dLng/2)*Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    distance_km += R * c;
  }

  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(fiber.cable_id);
  const cable_attenuation = distance_km * (cable?.attenuation_db_per_km || 0.35);

  let fiberColor = null;
  let fiberColorName = null;
  if (fiber.cable_id && fiber.fiber_number) {
    const cf = db.prepare('SELECT color, color_name FROM cable_fibers WHERE cable_id=? AND fiber_number=?').get(fiber.cable_id, fiber.fiber_number);
    if (cf) { fiberColor = cf.color; fiberColorName = cf.color_name; }
  }

  const fusions = db.prepare(`
    SELECT f.*, m.name as manga_name
    FROM fusions f
    LEFT JOIN cable_points cp_in ON cp_in.id = f.cable_connection_id_in
    LEFT JOIN mangas m ON m.id = f.manga_id
    WHERE cp_in.cable_id = ?
      AND (f.fiber_in = ? OR f.fiber_out = ?)
    ORDER BY f.id
  `).all(fiber.cable_id, fiber.fiber_number, fiber.fiber_number);

  const splices = db.prepare(`
    SELECT s.* FROM splices s
    WHERE (s.fiber_a_id = ? AND s.fiber_a_port = ?)
       OR (s.fiber_b_id = ? AND s.fiber_b_port = ?)
  `).all(fiber.source_id, fiber.fiber_number, fiber.target_id, fiber.fiber_number);

  let initial_power = fiber.olt_port_power || 0;
  const fusion_losses = fusions.reduce((sum, f) => sum + (f.loss_db || 0), 0);
  const splice_losses = splices.reduce((sum, s) => sum + (s.loss_db || 0.1), 0);
  const splice_loss_total = fusion_losses + splice_losses;
  const connector_loss = 1.0;

  let splitter_loss = 0;
  let splitter_info = null;
  if (fiber.target_type === 'nap') {
    const nap = db.prepare(`
      SELECT n.*, st.name as splitter_type_name, st.loss_db as splitter_loss_db
      FROM naps n LEFT JOIN splitter_types st ON st.id = n.splitter_type_id WHERE n.id=?
    `).get(fiber.target_id);
    if (nap) {
      splitter_loss = nap.splitter_loss_db || 0;
      splitter_info = { name: nap.name, splitter_type: nap.splitter_type_name, loss_db: splitter_loss };
    }
  }

  const total_loss = Math.round((cable_attenuation + splice_loss_total + splitter_loss + connector_loss) * 100) / 100;
  const remaining_power = Math.round((initial_power - total_loss) * 100) / 100;

  const route_segments = [];

  if (fiber.source_type === 'olt') {
    route_segments.push({
      type: 'olt', name: fiber.source_olt_name || 'OLT #' + fiber.source_id,
      id: fiber.source_id, lat: fiber.source_olt_lat, lng: fiber.source_olt_lng,
      detail: 'Puerto ' + (fiber.olt_port_number || '?') + ' \u00b7 ' + initial_power + ' dBm',
      icon: '\u26a1'
    });
  } else if (fiber.source_type === 'nap') {
    route_segments.push({
      type: 'nap', name: fiber.source_nap_name || 'NAP #' + fiber.source_id,
      id: fiber.source_id, lat: fiber.source_nap_lat, lng: fiber.source_nap_lng,
      detail: 'Fuente', icon: '\uD83D\uDCE6'
    });
  } else if (fiber.source_type === 'manga') {
    route_segments.push({
      type: 'manga', name: fiber.source_manga_name || 'Manga #' + fiber.source_id,
      id: fiber.source_id, lat: fiber.source_manga_lat, lng: fiber.source_manga_lng,
      detail: 'Fuente', icon: '\uD83E\uDDF6'
    });
  }

  route_segments.push({
    type: 'cable', name: fiber.cable_name || 'Cable #' + fiber.cable_id,
    id: fiber.cable_id, fiber_number: fiber.fiber_number,
    fiber_color: fiberColor, fiber_color_name: fiberColorName,
    detail: 'Fibra #' + fiber.fiber_number + ' \u00b7 ' + Math.round(distance_km * 1000) + 'm \u00b7 ' + Math.round(cable_attenuation * 100) / 100 + ' dB atenuaci\u00f3n',
    icon: '\uD83D\uDD0C'
  });

  const mangaIds = [...new Set(fusions.filter(f => f.manga_id).map(f => f.manga_id))];
  mangaIds.forEach(mangaId => {
    const manga = db.prepare('SELECT * FROM mangas WHERE id=?').get(mangaId);
    const mangaFusions = fusions.filter(f => f.manga_id == mangaId);
    route_segments.push({
      type: 'manga', name: manga ? manga.name : 'Manga #' + mangaId,
      id: mangaId, lat: manga?.lat, lng: manga?.lng,
      detail: mangaFusions.length + ' empalmes \u00b7 ' + mangaFusions.reduce((s, f) => s + (f.loss_db || 0), 0).toFixed(2) + ' dB total',
      icon: '\uD83E\uDDF6', fusions: mangaFusions.map(f => ({ fiber_in: f.fiber_in, fiber_out: f.fiber_out, loss_db: f.loss_db }))
    });
  });

  splices.forEach((s, idx) => {
    route_segments.push({
      type: 'splice', name: 'Empalme #' + (idx + 1),
      id: s.id, detail: s.loss_db + ' dB p\u00e9rdida',
      icon: '\uD83D\uDD17', loss_db: s.loss_db
    });
  });

  if (fiber.target_type === 'nap') {
    route_segments.push({
      type: 'nap', name: fiber.target_nap_name || 'NAP #' + fiber.target_id,
      id: fiber.target_id, lat: fiber.target_nap_lat, lng: fiber.target_nap_lng,
      detail: splitter_info ? splitter_info.splitter_type + ' (' + splitter_loss + ' dB p\u00e9rdida)' : '',
      icon: '\uD83D\uDCE6', splitter: splitter_info
    });
  } else if (fiber.target_type === 'manga') {
    route_segments.push({
      type: 'manga', name: fiber.target_manga_name || 'Manga #' + fiber.target_id,
      id: fiber.target_id, lat: fiber.target_manga_lat, lng: fiber.target_manga_lng,
      icon: '\uD83E\uDDF6'
    });
  } else if (fiber.target_type === 'olt') {
    route_segments.push({
      type: 'olt', name: fiber.target_olt_name || 'OLT #' + fiber.target_id,
      icon: '\u26a1'
    });
  }

  res.json({
    fiber: {
      id: fiber.id, fiber_number: fiber.fiber_number, cable_id: fiber.cable_id,
      source_type: fiber.source_type, source_id: fiber.source_id,
      target_type: fiber.target_type, target_id: fiber.target_id,
      active_power: fiber.active_power, power_level: fiber.power_level,
      total_loss_stored: fiber.total_loss
    },
    route_segments: route_segments,
    power_analysis: {
      initial_power: initial_power,
      cable_distance_km: Math.round(distance_km * 100) / 100,
      cable_attenuation_db: Math.round(cable_attenuation * 100) / 100,
      fusion_loss_db: Math.round(fusion_losses * 100) / 100,
      splice_loss_db: Math.round(splice_losses * 100) / 100,
      splitter_loss_db: splitter_loss,
      connector_loss_db: connector_loss,
      total_loss_db: total_loss,
      remaining_power_db: remaining_power,
      is_good: remaining_power >= -28
    },
    cable_info: cable ? {
      name: cable.name, color: cable.color, fiber_count: cable.fiber_count,
      length_m: cable.length_m, attenuation_db_per_km: cable.attenuation_db_per_km
    } : null,
    fusions: fusions,
    splices: splices,
    cable_points: cablePoints
  });
});

// ========== CABLE POINTS (filtered by element_type/element_id) ==========
// GET cable_point_fibers (per-point fiber UIDs)
app.get('/api/cable-point-fibers', (req, res) => {
  const { cable_point_id } = req.query;
  if (cable_point_id) {
    res.json(db.prepare('SELECT * FROM cable_point_fibers WHERE cable_point_id=? ORDER BY fiber_number').all(cable_point_id));
  } else {
    res.json(db.prepare('SELECT * FROM cable_point_fibers ORDER BY cable_point_id, fiber_number').all());
  }
});

app.get('/api/cable-points', (req, res) => {
  const { element_type, element_id, cable_id } = req.query;
  if (cable_id) {
    const points = db.prepare('SELECT * FROM cable_points WHERE cable_id=? ORDER BY sequence').all(parseInt(cable_id));
    return res.json(points);
  }
  if (element_type && element_id) {
    const points = db.prepare('SELECT cp.*, c.name as cable_name FROM cable_points cp LEFT JOIN cables c ON c.id = cp.cable_id WHERE cp.element_type=? AND cp.element_id=? ORDER BY cp.cable_id, cp.sequence')
      .all(element_type, parseInt(element_id));
    return res.json(points);
  }
  res.json(db.prepare('SELECT cp.*, c.name as cable_name FROM cable_points cp LEFT JOIN cables c ON c.id = cp.cable_id ORDER BY cp.cable_id, cp.sequence').all());
});

// ========== Fusions by manga (GET) - with power calculation ==========
app.get('/api/fusions', (req, res) => {
  const { manga_id } = req.query;
  let fusions;
  if (manga_id) {
    fusions = db.prepare('SELECT * FROM fusions WHERE manga_id=? ORDER BY id').all(parseInt(manga_id));
  } else {
    fusions = db.prepare('SELECT * FROM fusions ORDER BY id').all();
  }

  // Calculate power for each fusion
  const fiberConns = db.prepare('SELECT * FROM fiber_connections').all();
  const powerReadings = db.prepare('SELECT * FROM power_readings ORDER BY timestamp DESC').all();

  fusions.forEach(f => {
    const connIn = db.prepare('SELECT * FROM cable_points WHERE id=?').get(f.cable_connection_id_in);
    let activePower = false;
    let powerLevel = null;

    if (connIn) {
      const fiberConn = fiberConns.find(fc => fc.cable_id == connIn.cable_id && fc.fiber_number == f.fiber_in);
      if (fiberConn) {
        activePower = fiberConn.active_power == 1 || fiberConn.active_power === true;
        if (fiberConn.power_level !== null && fiberConn.power_level !== undefined) {
          powerLevel = fiberConn.power_level;
        }
        const reading = powerReadings.find(r => r.fiber_connection_id == fiberConn.id);
        if (reading && reading.power_level !== null) {
          powerLevel = reading.power_level;
          activePower = reading.is_active == 1;
        }
      }
    }

    if (powerLevel !== null) {
      const loss = parseFloat(f.loss_db) || 0;
      f.power_level = powerLevel - loss;
    } else {
      f.power_level = null;
    }
    f.active_power = activePower;
  });

  res.json(fusions);
});

// ========== Power Readings ==========
app.post('/api/power-readings', (req, res) => {
  const { fiber_connection_id, element_type, element_id, power_level, is_active } = req.body;
  const result = db.prepare('INSERT INTO power_readings (fiber_connection_id, element_type, element_id, power_level, is_active) VALUES (?, ?, ?, ?, ?)')
    .run(fiber_connection_id || null, element_type, element_id, power_level || null, is_active ? 1 : 0);

  if (fiber_connection_id) {
    db.prepare('UPDATE fiber_connections SET power_level=?, active_power=? WHERE id=?')
      .run(power_level, is_active ? 1 : 0, fiber_connection_id);
  }

  res.json({ id: result.lastInsertRowid, message: 'Medición guardada' });
});

app.get('/api/power-readings', (req, res) => {
  const { element_type, element_id } = req.query;
  if (element_type && element_id) {
    return res.json(db.prepare('SELECT * FROM power_readings WHERE element_type=? AND element_id=? ORDER BY timestamp DESC LIMIT 50')
      .all(element_type, parseInt(element_id)));
  }
  res.json(db.prepare('SELECT * FROM power_readings ORDER BY timestamp DESC LIMIT 100').all());
});

// ========== CABLE CONNECTED ELEMENTS ==========
app.get('/api/cables/:id/connected-elements', (req, res) => {
  const cableId = req.params.id;
  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(cableId);
  if (!cable) return res.status(404).json({ error: 'Cable no encontrado' });

  const fiberConns = db.prepare('SELECT * FROM fiber_connections WHERE cable_id=?').all(cableId);

  const oltIds = [...new Set(fiberConns.filter(f => f.source_type === 'olt').map(f => f.source_id))];
  const napIds = [...new Set(fiberConns.filter(f => f.target_type === 'nap' || f.source_type === 'nap').map(f => f.target_type === 'nap' ? f.target_id : f.source_id))];
  const mangaIds = [...new Set(fiberConns.filter(f => f.target_type === 'manga' || f.source_type === 'manga').map(f => f.target_type === 'manga' ? f.target_id : f.source_id))];

  const cablePoints = db.prepare('SELECT * FROM cable_points WHERE cable_id=? AND element_type IS NOT NULL ORDER BY sequence').all(cableId);

  const olts = oltIds.length > 0
    ? db.prepare(`SELECT id, name, lat, lng, description, ports_count FROM olts WHERE id IN (${oltIds.map(()=>'?').join(',')})`).all(...oltIds) : [];
  const naps = napIds.length > 0
    ? db.prepare(`SELECT n.id, n.name, n.lat, n.lng, n.address, st.name as splitter_type,
        (SELECT COUNT(*) FROM nap_ports np WHERE np.nap_id = n.id AND np.client_name IS NOT NULL) as clients
      FROM naps n LEFT JOIN splitter_types st ON st.id = n.splitter_type_id
      WHERE n.id IN (${napIds.map(()=>'?').join(',')})`).all(...napIds) : [];
  const mangas = mangaIds.length > 0
    ? db.prepare(`SELECT id, name, lat, lng, description FROM mangas WHERE id IN (${mangaIds.map(()=>'?').join(',')})`).all(...mangaIds) : [];

  const directConnections = cablePoints.map(p => {
    let elementName = null;
    if (p.element_type === 'nap') { const n = naps.find(n => n.id == p.element_id); if (n) elementName = n.name; }
    else if (p.element_type === 'manga') { const m = mangas.find(m => m.id == p.element_id); if (m) elementName = m.name; }
    else if (p.element_type === 'olt') { const o = olts.find(o => o.id == p.element_id); if (o) elementName = o.name; }
    return { point_sequence: p.sequence, element_type: p.element_type, element_id: p.element_id, lat: p.lat, lng: p.lng, element_name: elementName };
  });

  const usedFibersCount = fiberConns.length;
  const activeFiberCount = fiberConns.filter(f => f.active_power).length;
  const fiberDetails = fiberConns.map(f => ({
    fiber_number: f.fiber_number, source_type: f.source_type, source_id: f.source_id,
    target_type: f.target_type, target_id: f.target_id, active_power: f.active_power
  }));

  const cableFibers = db.prepare('SELECT * FROM cable_fibers WHERE cable_id=? ORDER BY fiber_number').all(cableId);

  res.json({
    cable: { id: cable.id, name: cable.name, fiber_count: cable.fiber_count, length_m: cable.length_m },
    fiber_summary: {
      total: cable.fiber_count || 0, used: usedFibersCount,
      active: activeFiberCount, available: (cable.fiber_count || 0) - usedFibersCount
    },
    fiber_details: fiberDetails,
    cable_fibers: cableFibers,
    connected: { olts, naps, mangas },
    direct_connections: directConnections,
    cable_points_count: cablePoints.length,
    fusion_count: db.prepare(`
      SELECT COUNT(*) as c FROM fusions f
      LEFT JOIN cable_points cp ON cp.id IN (f.cable_connection_id_in, f.cable_connection_id_out)
      WHERE cp.cable_id = ?
    `).get(cableId).c
  });
});

// ========== MANGA BLOCK LAYOUT (posiciones persistentes) ==========
// Ensure table exists
const createBlockLayoutTable = db.prepare(`
  CREATE TABLE IF NOT EXISTS manga_block_layout (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id INTEGER NOT NULL,
    block_idx TEXT NOT NULL,
    transform TEXT DEFAULT 'translate(0,0)',
    flipped INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(manga_id, block_idx),
    FOREIGN KEY (manga_id) REFERENCES mangas(id) ON DELETE CASCADE
  )
`);
createBlockLayoutTable.run();

// GET all block layouts for a manga
app.get('/api/mangas/:id/block-layout', (req, res) => {
  const layouts = db.prepare('SELECT block_idx, transform, flipped FROM manga_block_layout WHERE manga_id=?').all(req.params.id);
  res.json(layouts);
});

// PUT - batch save all block layouts for a manga
app.put('/api/mangas/:id/block-layout', (req, res) => {
  const mangaId = parseInt(req.params.id);
  const blocks = req.body.blocks; // array of { block_idx, transform, flipped }
  if (!Array.isArray(blocks)) return res.status(400).json({ error: 'blocks must be an array' });

  const upsert = db.prepare(`
    INSERT INTO manga_block_layout (manga_id, block_idx, transform, flipped, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(manga_id, block_idx)
    DO UPDATE SET transform=excluded.transform, flipped=excluded.flipped, updated_at=CURRENT_TIMESTAMP
  `);

  const transaction = db.transaction(() => {
    for (const block of blocks) {
      upsert.run(mangaId, block.block_idx, block.transform || 'translate(0,0)', block.flipped ? 1 : 0);
    }
  });

  transaction();
  res.json({ message: `Saved ${blocks.length} block layouts` });
});

// ========== ONUs (Client Equipment) ==========
app.get('/api/onus', (req, res) => {
  const { status, nap_id, olt_port_id } = req.query;
  let query = 'SELECT o.*, op.port_number as olt_port_num, n.name as nap_name FROM onus o LEFT JOIN olt_ports op ON op.id = o.olt_port_id LEFT JOIN naps n ON n.id = o.nap_id';
  const conditions = [];
  const params = [];
  if (status) { conditions.push('o.status=?'); params.push(status); }
  if (nap_id) { conditions.push('o.nap_id=?'); params.push(parseInt(nap_id)); }
  if (olt_port_id) { conditions.push('o.olt_port_id=?'); params.push(parseInt(olt_port_id)); }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY o.name';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/onus', (req, res) => {
  const { name, serial, olt_port_id, nap_id, nap_port_id, client_name, client_address, vlan, notes } = req.body;
  const result = db.prepare(
    'INSERT INTO onus (name, serial, olt_port_id, nap_id, nap_port_id, client_name, client_address, vlan, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, serial || null, olt_port_id || null, nap_id || null, nap_port_id || null, client_name || null, client_address || null, vlan || null, notes || null);
  res.json({ id: result.lastInsertRowid, message: 'ONU creada' });
});

app.put('/api/onus/:id', (req, res) => {
  const { name, serial, status, last_signal, tx_power, rx_power, client_name, client_address, vlan, notes } = req.body;
  db.prepare(
    'UPDATE onus SET name=?, serial=?, status=?, last_signal=?, tx_power=?, rx_power=?, client_name=?, client_address=?, vlan=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).run(name, serial, status || 'offline', last_signal || null, tx_power || null, rx_power || null, client_name || null, client_address || null, vlan || null, notes || null, req.params.id);
  res.json({ message: 'ONU actualizada' });
});

app.delete('/api/onus/:id', (req, res) => {
  db.prepare('DELETE FROM onus WHERE id=?').run(req.params.id);
  res.json({ message: 'ONU eliminada' });
});

// ====== Power Stats Dashboard ======
app.get('/api/reports/power-stats', (req, res) => {
  const green = db.prepare("SELECT COUNT(*) as c FROM manga_fibers WHERE active_power=1 AND power_level > -20").get().c;
  const yellow = db.prepare("SELECT COUNT(*) as c FROM manga_fibers WHERE active_power=1 AND power_level <= -20 AND power_level > -25").get().c;
  const red = db.prepare("SELECT COUNT(*) as c FROM manga_fibers WHERE active_power=1 AND power_level <= -25").get().c;
  const total = db.prepare("SELECT COUNT(*) as c FROM manga_fibers WHERE active_power=1").get().c;
  const avgPower = db.prepare("SELECT COALESCE(AVG(power_level), 0) as avg FROM manga_fibers WHERE active_power=1").get().avg;
  const worstFiber = db.prepare(`
    SELECT mf.fiber_number, mf.power_level, m.name as manga_name
    FROM manga_fibers mf JOIN mangas m ON m.id = mf.manga_id
    WHERE mf.active_power=1 ORDER BY mf.power_level ASC LIMIT 1
  `).get();

  // ONU stats
  const onuOnline = db.prepare("SELECT COUNT(*) as c FROM onus WHERE status='online'").get().c;
  const onuOffline = db.prepare("SELECT COUNT(*) as c FROM onus WHERE status='offline'").get().c;
  const onuBadSignal = db.prepare("SELECT COUNT(*) as c FROM onus WHERE status='bad_signal'").get().c;
  const onuTotal = db.prepare("SELECT COUNT(*) as c FROM onus").get().c;

  res.json({
    power: {
      green, yellow, red, total,
      avg_power: Math.round(avgPower * 100) / 100,
      worst_fiber: worstFiber || null
    },
    onus: { online: onuOnline, offline: onuOffline, bad_signal: onuBadSignal, total: onuTotal }
  });
});

// ====== Multi-language: save user language preference ======
app.put('/api/users/language', (req, res) => {
  const { language } = req.body;
  if (!['es', 'pt', 'en'].includes(language)) {
    return res.status(400).json({ error: 'Idioma no soportado. Use: es, pt, en' });
  }
  // Simple: store in a settings key-value
  const existing = db.prepare("SELECT id FROM company_settings WHERE company_id='default'").get();
  if (existing) {
    db.prepare("UPDATE company_settings SET language=? WHERE company_id='default'").run(language);
  } else {
    db.prepare("INSERT INTO company_settings (company_id, name, language) VALUES ('default', 'Mi Empresa', ?)").run(language);
  }
  res.json({ message: 'Idioma actualizado', language });
});

app.get('/api/settings/language', (req, res) => {
  const setting = db.prepare("SELECT language FROM company_settings WHERE company_id='default'").get();
  res.json({ language: setting?.language || 'es' });
});

// ====== Logout ======
app.post('/api/logout', (req, res) => {
  // Clear any session data
  res.json({ message: 'Sesión cerrada', redirect: '/' });
});

const PORT = process.env.PORT || 3010;
// ========== GET fiber color from DB (by cable point id + fiber number) ==========
app.get('/api/fiber-color', (req, res) => {
  const { cable_conn_id, fiber_num } = req.query;
  if (!cable_conn_id || !fiber_num) return res.status(400).json({ error: 'cable_conn_id y fiber_num requeridos' });
  const point = db.prepare('SELECT cable_id FROM cable_points WHERE id=?').get(parseInt(cable_conn_id));
  if (!point) return res.status(404).json({ error: 'Cable point no encontrado' });
  const fiber = db.prepare('SELECT color, color_name FROM cable_fibers WHERE cable_id=? AND fiber_number=?').get(point.cable_id, parseInt(fiber_num));
  if (!fiber) return res.status(404).json({ error: 'Fibra no encontrada' });
  res.json({ hex: fiber.color, name: fiber.color_name });
});

// ====== SEED DATA: auto-populate reference tables if empty ======
(function seedData() {
  // Splitter types
  if (db.prepare('SELECT COUNT(*) as c FROM splitter_types').get().c === 0) {
    const insert = db.prepare('INSERT INTO splitter_types (name, ports, loss_db) VALUES (?, ?, ?)');
    [['1:2',2,3.5],['1:4',4,7.0],['1:8',8,10.5],['1:16',16,14.0],['1:32',32,17.5]].forEach(t => insert.run(t[0],t[1],t[2]));
    console.log('[SEED] splitter_types: 5 rows');
  }
  // Cable types
  if (db.prepare('SELECT COUNT(*) as c FROM cable_types').get().c === 0) {
    const insert = db.prepare('INSERT INTO cable_types (name, fiber_count, tube_count, description) VALUES (?, ?, ?, ?)');
    [['ADSS',12,4,'Cable dielectrico autosoportado'],['Drop',12,4,'Cable de caida'],['FO',12,4,'Cable de fibra optica estandar'],['Loose Tube',24,6,'Cable de tubo suelto']].forEach(t => insert.run(t[0],t[1],t[2],t[3]));
    console.log('[SEED] cable_types: 4 rows');
  }
  // Color codes (TIA/EIA-598)
  if (db.prepare('SELECT COUNT(*) as c FROM color_codes').get().c === 0) {
    const colors = [
      {name:'Azul',hex:'#0099ff'},{name:'Naranja',hex:'#ff6600'},{name:'Verde',hex:'#00ab39'},
      {name:'Marron',hex:'#8B4513'},{name:'Gris',hex:'#808080'},{name:'Blanco',hex:'#ffffff'},
      {name:'Rojo',hex:'#e94560'},{name:'Negro',hex:'#222222'},{name:'Amarillo',hex:'#f5d442'},
      {name:'Violeta',hex:'#9b59b6'},{name:'Rosa',hex:'#ff69b4'},{name:'Celeste',hex:'#87CEEB'}
    ];
    const colorJson = JSON.stringify(colors.map(c => c.hex));
    db.prepare('INSERT INTO color_codes (name, description, connections_color_code_json, fusions_color_code_json) VALUES (?, ?, ?, ?)')
      .run('TIA/EIA-598', 'Estandar de colores para fibras', colorJson, colorJson);
    console.log('[SEED] color_codes: 1 row (' + colors.length + ' colores)');
  }
})();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 MapFiber corriendo en http://0.0.0.0:${PORT}`);
});
