const express = require('express');
const db = require('./database');
const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// PROPAGACIÓN DE POTENCIA — Solo conexiones
// ═══════════════════════════════════════════════════════════════
// Reglas:
//   1. Los puertos PON de la OLT (Online) son la fuente de potencia
//   2. Si cp:A tiene potencia y hay una conexión cp:A↔cp:B → cp:B tiene potencia  
//   3. Mismo cable + mismo fiber_number = mismo hilo físico → potencia continua
//   4. Fixpoint: repetir hasta converger
// ═══════════════════════════════════════════════════════════════

function propagarPotencia() {
  const powered = new Set(); // "cable_point_id:fiber_number"

  // 1. FUENTES: puertos PON de la OLT (Online → potencia inherente)
  //    Cada puerto PON conectado a un cable_point es una fuente
  const fuentes = db.prepare(`
    SELECT p.id, p.olt_id, p.port_number, p.power,
           fc.cable_id, fc.fiber_number, o.name as olt_name
    FROM olt_ports p
    JOIN fiber_connections fc ON fc.source_olt_port_id = p.id
    JOIN olts o ON o.id = p.olt_id
    WHERE p.operational_status = 'Online' OR (p.power IS NOT NULL AND p.power > 0)
  `).all();

  const hilosFuente = fuentes.map(f => ({
    fibra_id: f.cable_id,
    hilo_numero: f.fiber_number,
    potencia: f.power,
    origen: f.olt_name + ' P' + f.port_number
  }));

  // Marcar cable_points de la fuente
  for (const f of fuentes) {
    const puntos = db.prepare(`
      SELECT id, fiber_number FROM cable_points 
      WHERE cable_id = ? AND (fiber_number = ? OR fiber_number IS NULL)
      ORDER BY sequence ASC
    `).all(f.cable_id, f.fiber_number);
    for (const p of puntos) {
      powered.add(p.id + ':' + (p.fiber_number || f.fiber_number));
    }
  }

  // 2. FIXPOINT: seguir conexiones hasta converger
  let dirty = true;
  let iteraciones = 0;
  while (dirty && iteraciones < 100) {
    dirty = false;
    iteraciones++;

    const conexiones = db.prepare(`
      SELECT c.*, cp1.cable_id as cable_id_a, cp2.cable_id as cable_id_b
      FROM connections c
      JOIN cable_points cp1 ON cp1.id = c.source_cp_id
      JOIN cable_points cp2 ON cp2.id = c.target_cp_id
    `).all();

    for (const conn of conexiones) {
      const srcKey = conn.source_cp_id + ':' + conn.source_fiber;
      const tgtKey = conn.target_cp_id + ':' + conn.target_fiber;

      // ⭐ Forward: source tiene potencia → target recibe
      if (powered.has(srcKey) && !powered.has(tgtKey)) {
        powered.add(tgtKey);
        // Propagar al mismo cable (mismo hilo físico)
        const pts = db.prepare(`
          SELECT id, fiber_number FROM cable_points 
          WHERE cable_id = ? AND (fiber_number = ? OR fiber_number IS NULL)
          ORDER BY sequence ASC
        `).all(conn.cable_id_b, conn.target_fiber);
        for (const p of pts) {
          powered.add(p.id + ':' + (p.fiber_number || conn.target_fiber));
        }
        dirty = true;
      }

      // ⭐ Reverse: target tiene potencia → source recibe
      if (powered.has(tgtKey) && !powered.has(srcKey)) {
        powered.add(srcKey);
        const pts = db.prepare(`
          SELECT id, fiber_number FROM cable_points 
          WHERE cable_id = ? AND (fiber_number = ? OR fiber_number IS NULL)
          ORDER BY sequence ASC
        `).all(conn.cable_id_a, conn.source_fiber);
        for (const p of pts) {
          powered.add(p.id + ':' + (p.fiber_number || conn.source_fiber));
        }
        dirty = true;
      }
    }

    // Splitter interno: input → todos los outputs
    const splitterInputs = db.prepare(`
      SELECT cp.id, cp.fiber_number, cp.splitter_id
      FROM cable_points cp
      WHERE cp.splitter_port = 0 AND cp.splitter_id IS NOT NULL
    `).all();
    for (const inp of splitterInputs) {
      const inpKey = inp.id + ':' + inp.fiber_number;
      if (!powered.has(inpKey)) continue;
      const outputs = db.prepare(`
        SELECT id, fiber_number, splitter_port FROM cable_points
        WHERE splitter_id = ? AND splitter_port > 0
      `).all(inp.splitter_id);
      for (const out of outputs) {
        const outKey = out.id + ':' + (out.fiber_number || inp.fiber_number);
        if (!powered.has(outKey)) {
          powered.add(outKey);
          dirty = true;
        }
      }
    }
  }

  // 3. Construir resultado
  const todosPotencia = Array.from(powered).map(key => {
    const idx = key.indexOf(':');
    return {
      cable_point_id: parseInt(key.substring(0, idx)),
      fiber_number: parseInt(key.substring(idx + 1))
    };
  });

  // 4. Sync: cable_points.power_status
  db.prepare('UPDATE cable_points SET power_status=0, power_level=NULL').run();
  for (const p of todosPotencia) {
    db.prepare('UPDATE cable_points SET power_status=1 WHERE id=?').run(p.cable_point_id);
  }

  // 5. Sync: manga_fibers (compatibilidad frontend)
  db.prepare('UPDATE manga_fibers SET active_power=0, power_level=NULL').run();
  const splitterCPs = db.prepare(`
    SELECT cp.splitter_id, cp.splitter_port, cp.fiber_number 
    FROM cable_points cp
    WHERE cp.splitter_id IS NOT NULL AND cp.power_status=1
    GROUP BY cp.id
  `).all();
  for (const scp of splitterCPs) {
    if (scp.splitter_port === 0) {
      db.prepare('UPDATE manga_fibers SET active_power=1, power_level=9.4 WHERE splitter_id=? AND (splitter_output=0 OR splitter_output IS NULL)').run(scp.splitter_id);
    } else {
      db.prepare('UPDATE manga_fibers SET active_power=1, power_level=9.4 WHERE splitter_id=? AND splitter_output=?').run(scp.splitter_id, scp.splitter_port);
    }
  }

  // 6. Sync: fiber_connections (compatibilidad endpoints viejos)
  db.prepare('UPDATE fiber_connections SET active_power=0, power_level=NULL WHERE active_power=1').run();
  const cableFibers = db.prepare(`
    SELECT cp.cable_id, cp.fiber_number FROM cable_points cp
    WHERE cp.cable_id IS NOT NULL AND cp.fiber_number IS NOT NULL AND cp.power_status=1
    GROUP BY cp.cable_id, cp.fiber_number
  `).all();
  for (const cf of cableFibers) {
    db.prepare('UPDATE fiber_connections SET active_power=1, power_level=9.4 WHERE cable_id=? AND fiber_number=? AND active_power=0').run(cf.cable_id, cf.fiber_number);
  }

  return {
    fuentes: hilosFuente,
    potencia: todosPotencia,
    total_potencia: todosPotencia.length,
    iteraciones: iteraciones
  };
}

// GET /olts/hilos-con-potencia
router.get('/hilos-con-potencia', (req, res) => {
  const result = propagarPotencia();
  res.json(result);
});

module.exports = { router, propagarPotencia, syncPowerState: () => { try { propagarPotencia(); } catch(e) {} } };
