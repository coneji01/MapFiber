// ═══════════════════════════════════════════════════════════════
// Migración: Un cable_point por fibra en cada junction
// ═══════════════════════════════════════════════════════════════
// Cada cable_point en una mangas/NAPs/OLTs se expande en N
// cable_points, uno por fibra del cable.
// ═══════════════════════════════════════════════════════════════
const db = require('./database');

// 1. Obtener todos los cable_points de junction
const junctions = db.prepare(`
  SELECT cp.id, cp.cable_id, c.fiber_count, cp.sequence, 
         cp.element_type, cp.element_id, cp.lat, cp.lng, cp.name,
         cp.splitter_id, cp.splitter_port
  FROM cable_points cp
  JOIN cables c ON c.id = cp.cable_id
  WHERE cp.element_type IN ('manga','nap','olt')
  ORDER BY cp.id
`).all();

console.log('Junctions encontradas:', junctions.length);

// Mapa: old_cp_id -> { new_cps: [{id, fiber_number}], old_fiber_map: {fiber: old_cp_id} }
const cpMap = {};

for (const j of junctions) {
  const N = j.fiber_count || 12;
  console.log(`\n📦 cp:${j.id} (${j.element_type}#${j.element_id}, cable#${j.cable_id}, ${N} fibras)`);
  
  // Fiber 1: mantener el cable_point existente, asignar fiber_number=1
  db.prepare('UPDATE cable_points SET fiber_number=1 WHERE id=?').run(j.id);
  cpMap[j.id] = { new_cps: [{ id: j.id, fiber_number: 1 }] };
  
  // Fibras 2..N: crear nuevos cable_points
  for (let fib = 2; fib <= N; fib++) {
    const newSeq = j.sequence + fib;
    const result = db.prepare(`
      INSERT INTO cable_points (cable_id, lat, lng, sequence, element_type, element_id, name, notes, fiber_number, splitter_id, splitter_port)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(j.cable_id, j.lat, j.lng, newSeq, j.element_type, j.element_id, 
           j.name || null, 'fibra ' + fib, fib, j.splitter_id, j.splitter_port);
    
    cpMap[j.id].new_cps.push({ id: result.lastInsertRowid, fiber_number: fib });
    console.log(`  ✓ Nuevo cp:${result.lastInsertRowid} para fibra #${fib}`);
  }
  
  // Actualizar fusions que usan este cable_point
  const fusionsIn = db.prepare('SELECT * FROM fusions WHERE cable_connection_id_in=?').all(j.id);
  for (const f of fusionsIn) {
    const fib = f.fiber_in;
    if (fib > 1) {
      const newCp = cpMap[j.id].new_cps.find(cp => cp.fiber_number === fib);
      if (newCp) {
        db.prepare('UPDATE fusions SET cable_connection_id_in=? WHERE id=?').run(newCp.id, f.id);
        console.log(`  → fusion #${f.id}: cable_connection_id_in ${j.id}→${newCp.id} (fibra ${fib})`);
      }
    }
  }
  
  const fusionsOut = db.prepare('SELECT * FROM fusions WHERE cable_connection_id_out=?').all(j.id);
  for (const f of fusionsOut) {
    const fib = f.fiber_out;
    if (fib > 1) {
      const newCp = cpMap[j.id].new_cps.find(cp => cp.fiber_number === fib);
      if (newCp) {
        db.prepare('UPDATE fusions SET cable_connection_id_out=? WHERE id=?').run(newCp.id, f.id);
        console.log(`  → fusion #${f.id}: cable_connection_id_out ${j.id}→${newCp.id} (fibra ${fib})`);
      }
    }
  }
  
  // Actualizar connections que usan este cable_point
  const connsSrc = db.prepare('SELECT * FROM connections WHERE source_cp_id=?').all(j.id);
  for (const c of connsSrc) {
    const fib = c.source_fiber;
    if (fib > 1) {
      const newCp = cpMap[j.id].new_cps.find(cp => cp.fiber_number === fib);
      if (newCp) {
        db.prepare('UPDATE connections SET source_cp_id=? WHERE id=?').run(newCp.id, c.id);
        console.log(`  → conn #${c.id}: source_cp_id ${j.id}→${newCp.id} (fibra ${fib})`);
      }
    }
  }
  
  const connsTgt = db.prepare('SELECT * FROM connections WHERE target_cp_id=?').all(j.id);
  for (const c of connsTgt) {
    const fib = c.target_fiber;
    if (fib > 1) {
      const newCp = cpMap[j.id].new_cps.find(cp => cp.fiber_number === fib);
      if (newCp) {
        db.prepare('UPDATE connections SET target_cp_id=? WHERE id=?').run(newCp.id, c.id);
        console.log(`  → conn #${c.id}: target_cp_id ${j.id}→${newCp.id} (fibra ${fib})`);
      }
    }
  }
}

console.log('\n✅ Migración completada');

// Verificar resultados
const total = db.prepare('SELECT COUNT(*) as cnt FROM cable_points').get();
console.log('Total cable_points:', total.cnt);
const withFiber = db.prepare('SELECT COUNT(*) as cnt FROM cable_points WHERE fiber_number IS NOT NULL').get();
console.log('Con fiber_number:', withFiber.cnt);
