const express = require('express');
const db = require('./database');
const router = express.Router();

// ==================================================================
// API V3 — Modelo de Mangas, Hilos y Splitters
// Basado en la lógica real de MapFiber:
//   - N cables entran/salen de una manga
//   - Cada hilo se modela individualmente DENTRO de la manga
//   - Splitters viven dentro de mangas
//   - Deshacer NO restaura — la fibra queda rota
// ==================================================================

// ==================================================================
// 1. ENTRADA_CABLE_MANGA — Cables dentro de mangas
// ==================================================================

// GET /api/v3/mangas/:id/cables — Lista cables que entran/salen
router.get('/mangas/:id/cables', (req, res) => {
  const mangaId = parseInt(req.params.id);

  const entrando = db.prepare(`
    SELECT ecm.*, c.name as cable_name, c.fiber_count as total_hilos,
      cc.name as continuacion_name,
      (SELECT COUNT(*) FROM hilo_dentro_manga hdm 
       WHERE hdm.entrada_cable_manga_id = ecm.id AND hdm.estado = 'pasante') as hilos_pasantes,
      (SELECT COUNT(*) FROM hilo_dentro_manga hdm 
       WHERE hdm.entrada_cable_manga_id = ecm.id AND hdm.estado != 'pasante') as hilos_cortados
    FROM entrada_cable_manga ecm
    JOIN cables c ON c.id = ecm.cable_id
    LEFT JOIN cables cc ON cc.id = ecm.cable_continuacion_id
    WHERE ecm.manga_id = ?
    ORDER BY ecm.tipo, c.name
  `).all(mangaId);

  const manga = db.prepare('SELECT * FROM mangas WHERE id=?').get(mangaId);

  res.json({
    manga_id: mangaId,
    manga_name: manga ? manga.name : null,
    cables: entrando,
    total_cables: entrando.length,
    total_hilos: entrando.reduce((s, c) => s + c.total_hilos, 0)
  });
});

// POST /api/v3/mangas/:id/cables — Agrega cable a manga (crea entrada + hilos)
router.post('/mangas/:id/cables', (req, res) => {
  const mangaId = parseInt(req.params.id);
  const { cable_id, tipo, cable_continuacion_id } = req.body;

  if (!cable_id) return res.status(400).json({ error: 'cable_id requerido' });

  const manga = db.prepare('SELECT * FROM mangas WHERE id=?').get(mangaId);
  if (!manga) return res.status(404).json({ error: 'Manga no encontrada' });

  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(cable_id);
  if (!cable) return res.status(404).json({ error: 'Cable no encontrado' });

  // Check if this cable is already in this manga
  const existing = db.prepare('SELECT id FROM entrada_cable_manga WHERE manga_id=? AND cable_id=?').get(mangaId, cable_id);
  if (existing) return res.status(409).json({ error: 'El cable ya está en esta manga', entrada_id: existing.id });

  // Check continuacion FK
  if (cable_continuacion_id) {
    const cc = db.prepare('SELECT id FROM cables WHERE id=?').get(cable_continuacion_id);
    if (!cc) return res.status(400).json({ error: 'cable_continuacion_id no encontrado' });
  }

  // Create entrada_cable_manga
  const tipoVal = tipo || (cable_continuacion_id ? 'atraviesa' : 'termina_aqui');
  const result = db.prepare(
    'INSERT INTO entrada_cable_manga (manga_id, cable_id, tipo, cable_continuacion_id) VALUES (?, ?, ?, ?)'
  ).run(mangaId, cable_id, tipoVal, cable_continuacion_id || null);

  const entradaId = result.lastInsertRowid;

  // Auto-generate hilo_dentro_manga for each fiber in the cable
  const cableFibers = db.prepare('SELECT * FROM cable_fibers WHERE cable_id=? ORDER BY fiber_number').all(cable_id);
  const fibraCount = cable.fiber_count || cableFibers.length || 12;

  const insertHilo = db.prepare(
    'INSERT INTO hilo_dentro_manga (entrada_cable_manga_id, numero_hilo, color_hilo, fibra_original_cable_id, fibra_original_numero, estado) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const txn = db.transaction(() => {
    for (let i = 1; i <= fibraCount; i++) {
      const cf = cableFibers.find(f => f.fiber_number === i);
      insertHilo.run(
        entradaId, i,
        cf ? cf.color : null,
        cable_id, i,
        'pasante'
      );
    }
  });
  txn();

  const hilos = db.prepare('SELECT * FROM hilo_dentro_manga WHERE entrada_cable_manga_id=? ORDER BY numero_hilo').all(entradaId);
  const pasantes = hilos.filter(h => h.estado === 'pasante').length;
  const cortados = hilos.filter(h => h.estado !== 'pasante').length;

  // Update cable's fiber status: cortado_en_manga_id
  if (tipoVal !== 'atraviesa') {
    // If cable termina aqui or inicia aqui, leave status as-is
  }

  res.json({
    id: entradaId,
    message: `Cable "${cable.name}" agregado a manga "${manga.name}"`,
    manga_id: mangaId,
    cable_id,
    tipo: tipoVal,
    cable_continuacion_id: cable_continuacion_id || null,
    hilos_creados: hilos.length,
    hilos_pasantes: pasantes,
    hilos_cortados: cortados
  });
});

// DELETE /api/v3/mangas/:mangaId/cables/:entradaId — Saca cable de manga
router.delete('/mangas/:mangaId/cables/:entradaId', (req, res) => {
  const { mangaId, entradaId } = req.params;
  const entrada = db.prepare(`
    SELECT ecm.*, c.name as cable_name FROM entrada_cable_manga ecm
    JOIN cables c ON c.id = ecm.cable_id WHERE ecm.id=?
  `).get(entradaId);

  if (!entrada) return res.status(404).json({ error: 'Entrada no encontrada' });

  // Get all hilos for this entrada
  const hilos = db.prepare('SELECT * FROM hilo_dentro_manga WHERE entrada_cable_manga_id=?').all(entradaId);

  // ⚠️ NO se restauran los hilos — se marcan como ROTO
  const updateRoto = db.prepare("UPDATE hilo_dentro_manga SET estado='roto', updated_at=CURRENT_TIMESTAMP WHERE id=?");

  const txn = db.transaction(() => {
    for (const h of hilos) {
      // If this hilo was fusionado_a_splitter with a splitter, remove the splitter reference
      if (h.splitter_id) {
        db.prepare('UPDATE hilo_dentro_manga SET splitter_id=NULL, splitter_puerto=NULL WHERE splitter_id=? AND entrada_cable_manga_id=?')
          .run(h.splitter_id, entradaId);
      }
      // If fusionado_a_hilo, clear the other side's reference too
      if (h.fusionado_a_hilo_id) {
        db.prepare('UPDATE hilo_dentro_manga SET fusionado_a_hilo_id=NULL WHERE id=?').run(h.fusionado_a_hilo_id);
      }
      // Mark as ROTO (irreversible)
      updateRoto.run(h.id);
    }

    // Update cable_fibers — remove manga reference
    db.prepare('UPDATE cable_fibers SET cortado_en_manga_id=NULL WHERE cable_id=?').run(entrada.cable_id);

    // Delete the entrada
    db.prepare('DELETE FROM entrada_cable_manga WHERE id=?').run(entradaId);
  });
  txn();

  res.json({
    success: true,
    message: `Cable "${entrada.cable_name}" removido de la manga. ${hilos.length} hilos marcados como ROTO (irreversible).`,
    hilos_afectados: hilos.length,
    irreversibles: true
  });
});

// ==================================================================
// 2. HILO_DENTRO_MANGA — Gestión de hilos dentro de mangas
// ==================================================================

// GET /api/v3/mangas/:id/hilos — Todos los hilos de una manga
router.get('/mangas/:id/hilos', (req, res) => {
  const mangaId = parseInt(req.params.id);
  const { cable_id, estado } = req.query;

  let query = `
    SELECT hdm.*, ecm.cable_id, c.name as cable_name, c.fiber_count as cable_total_hilos,
      ecm.tipo as entrada_tipo,
      s.nombre as splitter_nombre, s.tipo_split,
      hdm2.numero_hilo as fusionado_a_hilo_num,
      c2.name as fusionado_cable_name
    FROM hilo_dentro_manga hdm
    JOIN entrada_cable_manga ecm ON ecm.id = hdm.entrada_cable_manga_id
    JOIN cables c ON c.id = ecm.cable_id
    LEFT JOIN splitter s ON s.id = hdm.splitter_id
    LEFT JOIN hilo_dentro_manga hdm2 ON hdm2.id = hdm.fusionado_a_hilo_id
    LEFT JOIN entrada_cable_manga ecm2 ON ecm2.id = hdm2.entrada_cable_manga_id
    LEFT JOIN cables c2 ON c2.id = ecm2.cable_id
    WHERE ecm.manga_id = ?
  `;
  const params = [mangaId];

  if (cable_id) {
    query += ' AND ecm.cable_id = ?';
    params.push(parseInt(cable_id));
  }
  if (estado) {
    query += ' AND hdm.estado = ?';
    params.push(estado);
  }

  query += ' ORDER BY ecm.cable_id, hdm.numero_hilo';

  const hilos = db.prepare(query).all(...params);

  // Agrupar por cable de entrada
  const grouped = {};
  for (const h of hilos) {
    const key = h.entrada_cable_manga_id;
    if (!grouped[key]) {
      grouped[key] = {
        entrada_cable_manga_id: key,
        cable_id: h.cable_id,
        cable_name: h.cable_name,
        cable_total_hilos: h.cable_total_hilos,
        entrada_tipo: h.entrada_tipo,
        hilos: []
      };
    }
    grouped[key].hilos.push(h);
  }

  // Estadísticas
  const stats = {
    total: hilos.length,
    pasantes: hilos.filter(h => h.estado === 'pasante').length,
    fusionados_fibra: hilos.filter(h => h.estado === 'fusionado_fibra').length,
    fusionados_splitter: hilos.filter(h => h.estado === 'fusionado_splitter').length,
    terminados: hilos.filter(h => h.estado === 'terminado').length,
    rotos: hilos.filter(h => h.estado === 'roto').length,
    con_potencia: hilos.filter(h => h.tiene_potencia).length,
    potencia_promedio: (() => {
      const c = hilos.filter(h => h.potencia_db !== null);
      return c.length ? Math.round(c.reduce((s, h) => s + h.potencia_db, 0) / c.length * 100) / 100 : null;
    })()
  };

  res.json({
    manga_id: mangaId,
    stats,
    cables: Object.values(grouped),
    hilos_planos: hilos
  });
});

// PUT /api/v3/hilos-dentro-manga/:id — Actualiza estado de un hilo
router.put('/hilos-dentro-manga/:id', (req, res) => {
  const hiloId = parseInt(req.params.id);
  const { estado, fusionado_a_hilo_id, splitter_id, splitter_puerto, perdida_db, notas } = req.body;

  const hilo = db.prepare('SELECT * FROM hilo_dentro_manga WHERE id=?').get(hiloId);
  if (!hilo) return res.status(404).json({ error: 'Hilo dentro de manga no encontrado' });

  // Validate state transitions
  if (estado === 'roto' && hilo.estado === 'roto') {
    return res.status(400).json({ error: 'Este hilo ya está roto. Es irreversible.' });
  }

  const updates = [];
  const params = [];

  if (estado !== undefined) {
    // Basic validation
    if (!['pasante', 'fusionado_fibra', 'fusionado_splitter', 'terminado', 'roto'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido: ' + estado });
    }

    // If setting to fusionado_fibra, must have fusionado_a_hilo_id
    if (estado === 'fusionado_fibra' && !fusionado_a_hilo_id && !hilo.fusionado_a_hilo_id) {
      return res.status(400).json({ error: 'fusionado_a_hilo_id requerido para estado fusionado_fibra' });
    }

    // If setting to fusionado_splitter, must have splitter_id
    if (estado === 'fusionado_splitter' && !splitter_id && !hilo.splitter_id) {
      return res.status(400).json({ error: 'splitter_id requerido para estado fusionado_splitter' });
    }

    updates.push('estado=?');
    params.push(estado);
  }

  if (fusionado_a_hilo_id !== undefined) {
    // Verify target hilo exists
    const target = db.prepare('SELECT * FROM hilo_dentro_manga WHERE id=?').get(fusionado_a_hilo_id);
    if (!target) return res.status(404).json({ error: 'Hilo destino no encontrado' });
    updates.push('fusionado_a_hilo_id=?');
    params.push(fusionado_a_hilo_id);
  }

  if (splitter_id !== undefined) {
    // Verify splitter exists
    const spl = db.prepare('SELECT * FROM splitter WHERE id=?').get(splitter_id);
    if (!spl) return res.status(404).json({ error: 'Splitter no encontrado' });
    updates.push('splitter_id=?');
    params.push(splitter_id);
  }

  if (splitter_puerto !== undefined) {
    updates.push('splitter_puerto=?');
    params.push(splitter_puerto);
  }

  if (perdida_db !== undefined) {
    updates.push('perdida_db=?');
    params.push(perdida_db);
  }

  if (notas !== undefined) {
    updates.push('notas=?');
    params.push(notas);
  }

  updates.push('updated_at=CURRENT_TIMESTAMP');

  if (updates.length > 1) {
    params.push(hiloId);
    db.prepare('UPDATE hilo_dentro_manga SET ' + updates.join(', ') + ' WHERE id=?').run(...params);

    // If this hilo is now fusionado_splitter and has splitter_puerto = 0 (input),
    // propagate power to the splitter outputs
    const finalEstado = estado || hilo.estado;
    if (finalEstado === 'fusionado_splitter' && (splitter_puerto === 0 || hilo.splitter_puerto === 0)) {
      const splId = splitter_id || hilo.splitter_id;
      const spl = db.prepare('SELECT * FROM splitter WHERE id=?').get(splId);
      if (spl && hilo.potencia_db !== null) {
        const outputPower = hilo.potencia_db - spl.perdida_db;
        db.prepare(`
          UPDATE hilo_dentro_manga SET potencia_db=?, tiene_potencia=1
          WHERE splitter_id=? AND splitter_puerto > 0 AND (tiene_potencia=0 OR tiene_potencia IS NULL)
        `).run(Math.round(outputPower * 100) / 100, splId);

        // Update cable_tramo with propagated power
        const entrada = db.prepare('SELECT ecm.* FROM entrada_cable_manga ecm JOIN hilo_dentro_manga hdm ON hdm.entrada_cable_manga_id=ecm.id WHERE hdm.id=?').get(hiloId);
        if (entrada) {
          db.prepare('UPDATE cable_tramo SET potencia_entrada_db=?, tiene_potencia=1 WHERE cable_origen_id=?')
            .run(Math.round(outputPower * 100) / 100, entrada.cable_id);
        }
      }
    }

    // If setting ROTO, also clear reciprocal references
    if (estado === 'roto') {
      // Clear all references from/to this hilo
      db.prepare('UPDATE hilo_dentro_manga SET fusionado_a_hilo_id=NULL WHERE fusionado_a_hilo_id=?').run(hiloId);
      db.prepare('UPDATE splitter SET hilo_entrada_id=NULL WHERE hilo_entrada_id=?').run(hiloId);
    }
  }

  const updated = db.prepare('SELECT * FROM hilo_dentro_manga WHERE id=?').get(hiloId);
  res.json({ success: true, message: 'Hilo actualizado', hilo: updated });
});

// ==================================================================
// 3. SPLITTER — Dentro de Manga
// ==================================================================

// GET /api/v3/mangas/:id/splitters
router.get('/mangas/:id/splitters', (req, res) => {
  const mangaId = parseInt(req.params.id);

  const splitters = db.prepare(`
    SELECT s.*,
      (SELECT hdm.numero_hilo FROM hilo_dentro_manga hdm WHERE hdm.id = s.hilo_entrada_id) as hilo_entrada_num,
      (SELECT c.name FROM hilo_dentro_manga hdm 
        JOIN entrada_cable_manga ecm ON ecm.id = hdm.entrada_cable_manga_id
        JOIN cables c ON c.id = ecm.cable_id
        WHERE hdm.id = s.hilo_entrada_id) as hilo_entrada_cable,
      (SELECT COUNT(*) FROM hilo_dentro_manga hdm WHERE hdm.splitter_id = s.id AND hdm.splitter_puerto > 0) as salidas_usadas,
      (SELECT COUNT(*) FROM hilo_dentro_manga hdm WHERE hdm.splitter_id = s.id AND hdm.tiene_potencia = 1) as salidas_con_potencia
    FROM splitter s
    WHERE s.manga_id = ?
    ORDER BY s.nombre
  `).all(mangaId);

  // For each splitter, get detailed output fibers
  for (const s of splitters) {
    s.salidas = db.prepare(`
      SELECT hdm.*, ecm.cable_id, c.name as cable_name
      FROM hilo_dentro_manga hdm
      JOIN entrada_cable_manga ecm ON ecm.id = hdm.entrada_cable_manga_id
      JOIN cables c ON c.id = ecm.cable_id
      WHERE hdm.splitter_id = ? AND hdm.splitter_puerto > 0
      ORDER BY hdm.splitter_puerto
    `).all(s.id);
  }

  res.json({ manga_id: mangaId, total: splitters.length, splitters });
});

// POST /api/v3/mangas/:id/splitters — Crear splitter dentro de manga
router.post('/mangas/:id/splitters', (req, res) => {
  const mangaId = parseInt(req.params.id);
  const { nombre, tipo_split, puertos } = req.body;

  if (!tipo_split) return res.status(400).json({ error: 'tipo_split requerido (1:4, 1:8, 1:16, 1:32, 1:64)' });

  if (!['1:4', '1:8', '1:16', '1:32', '1:64'].includes(tipo_split)) {
    return res.status(400).json({ error: 'tipo_split debe ser: 1:4, 1:8, 1:16, 1:32, o 1:64' });
  }

  // Calculate loss based on splitter type
  const perdidaMap = { '1:4': 7.2, '1:8': 10.5, '1:16': 13.8, '1:32': 16.5, '1:64': 19.8 };
  const perdidaDb = perdidaMap[tipo_split] || 10.5;
  const numPuertos = puertos || parseInt(tipo_split.split(':')[1]) || 8;

  const result = db.prepare(
    'INSERT INTO splitter (manga_id, nombre, tipo_split, puertos, perdida_db) VALUES (?, ?, ?, ?, ?)'
  ).run(mangaId, nombre || 'Splitter ' + tipo_split, tipo_split, numPuertos, perdidaDb);

  res.json({
    id: result.lastInsertRowid,
    message: `Splitter ${tipo_split} creado en la manga`,
    manga_id: mangaId,
    nombre: nombre || 'Splitter ' + tipo_split,
    tipo_split,
    puertos: numPuertos,
    perdida_db: perdidaDb
  });
});

// DELETE /api/v3/splitters/:id — Eliminar splitter y desconectar hilos
router.delete('/splitters/:id', (req, res) => {
  const splitterId = parseInt(req.params.id);

  const spl = db.prepare('SELECT * FROM splitter WHERE id=?').get(splitterId);
  if (!spl) return res.status(404).json({ error: 'Splitter no encontrado' });

  // Count connected fibers before deleting
  const hilosConectados = db.prepare(
    "SELECT COUNT(*) as c FROM hilo_dentro_manga WHERE splitter_id=?"
  ).get(splitterId).c;

  // Transaction: mark connected fibers as TERMINADO (puntas sueltas), then delete splitter
  const txn = db.transaction(() => {
    // Mark input fiber as TERMINADO (was cortado, now just suelto)
    if (spl.hilo_entrada_id) {
      db.prepare("UPDATE hilo_dentro_manga SET estado='terminado', splitter_id=NULL, splitter_puerto=NULL, potencia_db=NULL, tiene_potencia=0 WHERE id=?")
        .run(spl.hilo_entrada_id);
    }

    // Mark ALL output fibers as TERMINADO
    db.prepare(
      "UPDATE hilo_dentro_manga SET estado='terminado', splitter_id=NULL, splitter_puerto=NULL, potencia_db=NULL, tiene_potencia=0 WHERE splitter_id=? AND splitter_puerto > 0"
    ).run(splitterId);

    // Delete the splitter
    db.prepare('DELETE FROM splitter WHERE id=?').run(splitterId);
  });
  txn();

  res.json({
    success: true,
    message: `Splitter "${spl.nombre}" eliminado. ${hilosConectados} hilos desconectados y marcados como TERMINADO (puntas sueltas).`,
    hilos_afectados: hilosConectados,
    restaurados: false
  });
});

// ==================================================================
// 4. MICHELLE — Sangrado de hilos
// ==================================================================

// POST /api/v3/mangas/:id/michelle — Realizar sangrado (Michelle)
router.post('/mangas/:id/michelle', (req, res) => {
  const mangaId = parseInt(req.params.id);
  const { cable_id, hilos_a_cortar, splitter_id, nombre } = req.body;

  if (!cable_id || !hilos_a_cortar || !Array.isArray(hilos_a_cortar) || hilos_a_cortar.length === 0) {
    return res.status(400).json({ error: 'cable_id y hilos_a_cortar (array) requeridos' });
  }

  // Find the entrada for this cable in this manga
  const entrada = db.prepare(
    'SELECT * FROM entrada_cable_manga WHERE manga_id=? AND cable_id=?'
  ).get(mangaId, cable_id);

  if (!entrada) {
    return res.status(404).json({ error: 'Cable no encontrado en esta manga. Agréguelo primero con POST /mangas/:id/cables' });
  }

  // Get all hilos for this entrada
  const hilos = db.prepare(
    'SELECT * FROM hilo_dentro_manga WHERE entrada_cable_manga_id=? ORDER BY numero_hilo'
  ).all(entrada.id);

  // Validate that hilos_a_cortar are valid hilo numbers
  const validNumbers = hilos.map(h => h.numero_hilo);
  const invalid = hilos_a_cortar.filter(n => !validNumbers.includes(n));
  if (invalid.length > 0) {
    return res.status(400).json({ error: 'Hilos inválidos: ' + invalid.join(', '), validos: validNumbers });
  }

  // If splitter_id is provided, verify it exists in this manga
  if (splitter_id) {
    const spl = db.prepare('SELECT * FROM splitter WHERE id=? AND manga_id=?').get(splitter_id, mangaId);
    if (!spl) return res.status(404).json({ error: 'Splitter no encontrado en esta manga' });
  }

  const hilosCortados = [];
  const hilosPasantes = [];

  const txn = db.transaction(() => {
    for (const h of hilos) {
      if (hilos_a_cortar.includes(h.numero_hilo)) {
        // This hilo gets cut → connect to splitter
        db.prepare(
          'UPDATE hilo_dentro_manga SET estado=?, splitter_id=?, splitter_puerto=0, grupo_michelle_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
        ).run(
          splitter_id ? 'fusionado_splitter' : 'terminado',
          splitter_id || null,
          null, // grupo_michelle_id — se asigna después
          h.id
        );
        hilosCortados.push(h.numero_hilo);
      } else {
        // Stays pasante
        hilosPasantes.push(h.numero_hilo);
      }
    }

    // Create michelle_grupo record
    const mgResult = db.prepare(
      'INSERT INTO michelle_grupo (manga_id, nombre, splitter_id, hilos_cortados, hilos_pasantes) VALUES (?, ?, ?, ?, ?)'
    ).run(
      mangaId,
      nombre || `Michelle (${hilos_a_cortar.join(',')})`,
      splitter_id || null,
      hilosCortados.length,
      hilosPasantes.length
    );
    const mgId = mgResult.lastInsertRowid;

    // Update grupo_michelle_id for the cut hilos
    db.prepare('UPDATE hilo_dentro_manga SET grupo_michelle_id=? WHERE entrada_cable_manga_id=? AND numero_hilo IN (' +
      hilos_a_cortar.map(() => '?').join(',') + ')'
    ).run(mgId, entrada.id, ...hilos_a_cortar);

    return mgId;
  });

  const mgId = txn();

  res.json({
    success: true,
    message: `Michelle realizado: ${hilosCortados.length} hilos cortados, ${hilosPasantes.length} pasantes`,
    michelle_grupo_id: mgId,
    cable_id,
    manga_id: mangaId,
    splitter_id: splitter_id || null,
    hilos_cortados: hilosCortados,
    hilos_pasantes: hilosPasantes
  });
});

// ==================================================================
// 5. CABLE_TRAMO — Segmentos de cable entre mangas
// ==================================================================

// GET /api/v3/cables/:id/tramos
router.get('/cables/:id/tramos', (req, res) => {
  const cableId = parseInt(req.params.id);

  const tramos = db.prepare(`
    SELECT ct.*, m_inicio.name as manga_inicio_name, m_fin.name as manga_fin_name
    FROM cable_tramo ct
    LEFT JOIN mangas m_inicio ON m_inicio.id = ct.manga_inicio_id
    LEFT JOIN mangas m_fin ON m_fin.id = ct.manga_fin_id
    WHERE ct.cable_origen_id = ?
    ORDER BY ct.id
  `).all(cableId);

  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(cableId);

  res.json({
    cable_id: cableId,
    cable_name: cable ? cable.name : null,
    total_tramos: tramos.length,
    longitud_total: tramos.reduce((s, t) => s + (t.longitud_metros || 0), 0),
    tramos
  });
});

// POST /api/v3/cables/:id/tramos — Crear tramo
router.post('/cables/:id/tramos', (req, res) => {
  const cableId = parseInt(req.params.id);
  const { manga_inicio_id, manga_fin_id, longitud_metros, hilos_presentes } = req.body;

  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(cableId);
  if (!cable) return res.status(404).json({ error: 'Cable no encontrado' });

  const hilosJson = hilos_presentes ? JSON.stringify(hilos_presentes) : null;

  const result = db.prepare(`
    INSERT INTO cable_tramo (cable_origen_id, nombre_tramo, manga_inicio_id, manga_fin_id, longitud_metros, hilos_presentes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    cableId,
    `Tramo ${cableId}-${(db.prepare('SELECT COUNT(*)+1 as c FROM cable_tramo WHERE cable_origen_id=?').get(cableId).c)}`,
    manga_inicio_id || null,
    manga_fin_id || null,
    longitud_metros || 0,
    hilosJson
  );

  res.json({
    id: result.lastInsertRowid,
    message: 'Tramo creado',
    cable_id: cableId,
    hilos_presentes: hilos_presentes || null
  });
});

// ==================================================================
// 6. TOPOLOGÍA COMPLETA de una manga
// ==================================================================

// GET /api/v3/mangas/:id/topologia
router.get('/mangas/:id/topologia', (req, res) => {
  const mangaId = parseInt(req.params.id);

  const manga = db.prepare('SELECT * FROM mangas WHERE id=?').get(mangaId);
  if (!manga) return res.status(404).json({ error: 'Manga no encontrada' });

  // Cables entrando
  const cablesEntrada = db.prepare(`
    SELECT ecm.*, c.name as cable_name, c.fiber_count, c.color,
      cc.name as continuacion_name,
      (SELECT COUNT(*) FROM hilo_dentro_manga hdm WHERE hdm.entrada_cable_manga_id = ecm.id AND hdm.estado = 'pasante') as pasantes,
      (SELECT COUNT(*) FROM hilo_dentro_manga hdm WHERE hdm.entrada_cable_manga_id = ecm.id AND hdm.estado != 'pasante') as cortados
    FROM entrada_cable_manga ecm
    JOIN cables c ON c.id = ecm.cable_id
    LEFT JOIN cables cc ON cc.id = ecm.cable_continuacion_id
    WHERE ecm.manga_id = ? AND ecm.tipo IN ('atraviesa', 'termina_aqui')
    ORDER BY c.name
  `).all(mangaId);

  // Cables saliendo
  const cablesSalida = db.prepare(`
    SELECT ecm.*, c.name as cable_name, c.fiber_count, c.color
    FROM entrada_cable_manga ecm
    JOIN cables c ON c.id = ecm.cable_id
    WHERE ecm.manga_id = ? AND ecm.tipo = 'inicia_aqui'
    ORDER BY c.name
  `).all(mangaId);

  // Splitters
  const splitters = db.prepare(`
    SELECT s.*,
      (SELECT hdm.numero_hilo FROM hilo_dentro_manga hdm WHERE hdm.id = s.hilo_entrada_id) as hilo_entrada_num,
      (SELECT c.name FROM hilo_dentro_manga hdm 
        JOIN entrada_cable_manga ecm ON ecm.id = hdm.entrada_cable_manga_id
        JOIN cables c ON c.id = ecm.cable_id
        WHERE hdm.id = s.hilo_entrada_id) as hilo_entrada_cable
    FROM splitter s
    WHERE s.manga_id = ?
  `).all(mangaId);

  // For each splitter, get detailed outputs
  for (const s of splitters) {
    s.entrada = db.prepare(`
      SELECT hdm.*, ecm.cable_id, c.name as cable_name
      FROM hilo_dentro_manga hdm
      JOIN entrada_cable_manga ecm ON ecm.id = hdm.entrada_cable_manga_id
      JOIN cables c ON c.id = ecm.cable_id
      WHERE hdm.id = ?
    `).get(s.hilo_entrada_id);

    s.salidas = db.prepare(`
      SELECT hdm.*, ecm.cable_id, c.name as cable_name
      FROM hilo_dentro_manga hdm
      JOIN entrada_cable_manga ecm ON ecm.id = hdm.entrada_cable_manga_id
      JOIN cables c ON c.id = ecm.cable_id
      WHERE hdm.splitter_id = ? AND hdm.splitter_puerto > 0
      ORDER BY hdm.splitter_puerto
    `).all(s.id);
  }

  // Michel groups
  const michelles = db.prepare(`
    SELECT mg.*,
      (SELECT COUNT(*) FROM hilo_dentro_manga hdm WHERE hdm.grupo_michelle_id = mg.id) as hilos_en_grupo
    FROM michelle_grupo mg WHERE mg.manga_id = ?
  `).all(mangaId);

  // Full hilo list
  const hilos = db.prepare(`
    SELECT hdm.*, ecm.cable_id, c.name as cable_name
    FROM hilo_dentro_manga hdm
    JOIN entrada_cable_manga ecm ON ecm.id = hdm.entrada_cable_manga_id
    JOIN cables c ON c.id = ecm.cable_id
    WHERE ecm.manga_id = ?
    ORDER BY ecm.cable_id, hdm.numero_hilo
  `).all(mangaId);

  // Stats
  const stats = {
    cables_entrando: cablesEntrada.length,
    cables_saliendo: cablesSalida.length,
    total_cables: cablesEntrada.length + cablesSalida.length,
    total_hilos: hilos.length,
    hilos_pasantes: hilos.filter(h => h.estado === 'pasante').length,
    hilos_cortados: hilos.filter(h => h.estado !== 'pasante').length,
    hilos_con_potencia: hilos.filter(h => h.tiene_potencia).length,
    splitters: splitters.length,
    michelles: michelles.length
  };

  res.json({
    manga: { id: manga.id, name: manga.name, tipo: manga.tipo_manga, lat: manga.lat, lng: manga.lng },
    stats,
    cables_entrada: cablesEntrada,
    cables_salida: cablesSalida,
    splitters,
    michelles,
    hilos
  });
});

// ==================================================================
// 7. RUTA COMPLETA de un cable a través de mangas
// ==================================================================

// GET /api/v3/cables/:id/ruta-completa
router.get('/cables/:id/ruta-completa', (req, res) => {
  const cableId = parseInt(req.params.id);

  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(cableId);
  if (!cable) return res.status(404).json({ error: 'Cable no encontrado' });

  // Find all mangas this cable passes through
  const mangas = db.prepare(`
    SELECT DISTINCT m.*, ecm.tipo as entrada_tipo,
      ecm.cable_continuacion_id
    FROM entrada_cable_manga ecm
    JOIN mangas m ON m.id = ecm.manga_id
    WHERE ecm.cable_id = ? OR ecm.cable_continuacion_id = ?
    ORDER BY ecm.id
  `).all(cableId, cableId);

  // Get all tramos for this cable
  const tramos = db.prepare(`
    SELECT ct.*, m_inicio.name as inicio_name, m_fin.name as fin_name
    FROM cable_tramo ct
    LEFT JOIN mangas m_inicio ON m_inicio.id = ct.manga_inicio_id
    LEFT JOIN mangas m_fin ON m_fin.id = ct.manga_fin_id
    WHERE ct.cable_origen_id = ?
    ORDER BY ct.id
  `).all(cableId);

  res.json({
    cable: { id: cable.id, name: cable.name, fiber_count: cable.fiber_count },
    mangas_visitadas: mangas.map(m => ({
      id: m.id,
      name: m.name,
      tipo: m.tipo_manga,
      entrada_tipo: m.entrada_tipo,
      lat: m.lat,
      lng: m.lng
    })),
    tramos,
    total_mangas: mangas.length,
    total_tramos: tramos.length
  });
});

// ==================================================================
// 8. SEGUIR UN HILO a través de mangas y splitters
// ==================================================================

// GET /api/v3/hilos/:cableId/:numeroHilo/ruta
router.get('/hilos/:cableId/:numeroHilo/ruta', (req, res) => {
  const { cableId, numeroHilo } = req.params;

  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(cableId);
  if (!cable) return res.status(404).json({ error: 'Cable no encontrado' });

  const segmentos = [];
  const visitados = new Set();

  function seguirHilo(cId, hNum, origen, profundidad) {
    if (profundidad > 50) return; // Safety
    const key = cId + ':' + hNum;
    if (visitados.has(key)) return;
    visitados.add(key);

    // Find mangas where this cable+fiber appears
    const entradas = db.prepare(`
      SELECT ecm.*, m.name as manga_name, m.tipo_manga, m.lat, m.lng
      FROM entrada_cable_manga ecm
      JOIN mangas m ON m.id = ecm.manga_id
      WHERE ecm.cable_id = ?
    `).all(cId);

    for (const e of entradas) {
      // Find the specific hilo in this manga
      const hilo = db.prepare(
        'SELECT * FROM hilo_dentro_manga WHERE entrada_cable_manga_id=? AND numero_hilo=?'
      ).get(e.id, parseInt(hNum));

      if (!hilo) continue;

      segmentos.push({
        tipo: 'manga',
        manga_id: e.manga_id,
        manga_name: e.manga_name,
        manga_tipo: e.tipo_manga,
        lat: e.lat,
        lng: e.lng,
        hilo_estado: hilo.estado,
        potencia_db: hilo.potencia_db,
        tiene_potencia: !!hilo.tiene_potencia,
        perdida_db: hilo.perdida_db
      });

      // If this hilo is fusionado_fibra, follow the chain
      if (hilo.estado === 'fusionado_fibra' && hilo.fusionado_a_hilo_id) {
        const targetHilo = db.prepare(`
          SELECT hdm.*, ecm.cable_id, c.name as cable_name
          FROM hilo_dentro_manga hdm
          JOIN entrada_cable_manga ecm ON ecm.id = hdm.entrada_cable_manga_id
          JOIN cables c ON c.id = ecm.cable_id
          WHERE hdm.id = ?
        `).get(hilo.fusionado_a_hilo_id);

        if (targetHilo) {
          segmentos.push({
            tipo: 'fusion',
            desde_cable: cable.name,
            desde_hilo: parseInt(hNum),
            hacia_cable: targetHilo.cable_name,
            hacia_hilo: targetHilo.numero_hilo,
            perdida_db: hilo.perdida_db
          });

          seguirHilo(targetHilo.cable_id, targetHilo.numero_hilo, 'fusion', profundidad + 1);
        }
      }

      // If this hilo goes into a splitter, trace outputs
      if (hilo.estado === 'fusionado_splitter' && hilo.splitter_id) {
        const spl = db.prepare('SELECT * FROM splitter WHERE id=?').get(hilo.splitter_id);
        if (spl) {
          segmentos.push({
            tipo: 'splitter',
            splitter_id: spl.id,
            splitter_nombre: spl.nombre,
            tipo_split: spl.tipo_split,
            perdida_db: spl.perdida_db,
            puerto_entrada: hilo.splitter_puerto
          });

          // If this hilo is the INPUT (puerto=0), follow all outputs
          if (hilo.splitter_puerto === 0) {
            const outputs = db.prepare(`
              SELECT hdm.*, ecm.cable_id, c.name as cable_name
              FROM hilo_dentro_manga hdm
              JOIN entrada_cable_manga ecm ON ecm.id = hdm.entrada_cable_manga_id
              JOIN cables c ON c.id = ecm.cable_id
              WHERE hdm.splitter_id = ? AND hdm.splitter_puerto > 0
              ORDER BY hdm.splitter_puerto
            `).all(spl.id);

            for (const out of outputs) {
              segmentos.push({
                tipo: 'splitter_output',
                puerto: out.splitter_puerto,
                cable: out.cable_name,
                hilo: out.numero_hilo,
                potencia_db: out.potencia_db,
                tiene_potencia: !!out.tiene_potencia
              });

              seguirHilo(out.cable_id, out.numero_hilo, 'splitter_out', profundidad + 1);
            }
          }
        }
      }
    }
  }

  seguirHilo(parseInt(cableId), parseInt(numeroHilo), 'inicio', 0);

  const powerPoints = segmentos.filter(s => s.tiene_potencia && s.potencia_db !== undefined && s.potencia_db !== null);

  res.json({
    hilo_original: {
      cable_id: parseInt(cableId),
      cable_name: cable.name,
      numero_hilo: parseInt(numeroHilo)
    },
    segmentos,
    total_segmentos: segmentos.length,
    puntos_con_potencia: powerPoints.length,
    potencia_rango: powerPoints.length > 0 ? {
      min: Math.min(...powerPoints.map(s => s.potencia_db)),
      max: Math.max(...powerPoints.map(s => s.potencia_db)),
      avg: Math.round(powerPoints.reduce((s, p) => s + p.potencia_db, 0) / powerPoints.length * 100) / 100
    } : null
  });
});

module.exports = router;
