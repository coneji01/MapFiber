#!/usr/bin/env node
/**
 * Migration V3 — Run schema migration for new manga model
 * 
 * Usage: node run-migration-v3.js
 * 
 * This script applies the V3 migration SQL and then runs a quick
 * validation to ensure all tables were created correctly.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'ftth.db');
const migrationSqlPath = path.join(__dirname, 'migration_v3_manga_model.sql');

console.log('🔧 MapFiber — Migration V3');
console.log('═══════════════════════════════');
console.log(`📁 DB: ${dbPath}`);
console.log(`📄 SQL: ${migrationSqlPath}`);

// Check if DB exists
if (!fs.existsSync(dbPath)) {
  console.error('❌ Base de datos no encontrada. Ejecuta primero el servidor para crearla.');
  process.exit(1);
}

// Read migration SQL
if (!fs.existsSync(migrationSqlPath)) {
  console.error('❌ Archivo de migración no encontrado:', migrationSqlPath);
  process.exit(1);
}

const sql = fs.readFileSync(migrationSqlPath, 'utf-8');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

try {
  console.log('⚡ Ejecutando migración...');
  db.exec(sql);
  console.log('✅ Migración SQL ejecutada correctamente');
} catch (e) {
  // Some ALTER TABLE additions may fail if columns already exist (previous runs)
  if (e.message.includes('duplicate column')) {
    console.log('⚠️  Algunas columnas ya existían (migración parcial previa)');
  } else {
    console.error('❌ Error ejecutando migración:', e.message);
    process.exit(1);
  }
}

// Verify tables were created
const expectedTables = [
  'entrada_cable_manga',
  'hilo_dentro_manga',
  'splitter',
  'cable_tramo',
  'michelle_grupo'
];

console.log('\n📋 Verificando tablas...');
const existingTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();

let allOk = true;
for (const tbl of expectedTables) {
  const found = existingTables.some(t => t.name === tbl);
  console.log(`  ${found ? '✅' : '❌'} ${tbl}`);
  if (!found) allOk = false;
}

// Also verify columns
console.log('\n📋 Verificando columnas en tablas existentes...');
for (const tbl of expectedTables) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${tbl})`).all();
    console.log(`  ${tbl}: ${cols.length} columnas`);
    for (const c of cols) {
      console.log(`    ├─ ${c.name} (${c.type}) ${c.notnull ? 'NOT NULL' : ''} ${c.pk ? 'PK' : ''}`);
    }
  } catch (e) {
    console.log(`  ${tbl}: ❌ ERROR — ${e.message}`);
  }
}

// Show current mangas with their new tipo_manga column
console.log('\n📋 Mangas existentes:');
const mangas = db.prepare('SELECT id, name, tipo_manga FROM mangas ORDER BY id').all();
for (const m of mangas) {
  console.log(`  ├─ [${m.id}] ${m.name} — tipo: ${m.tipo_manga || 'empalme (default)'}`);
}

db.close();

console.log('\n' + (allOk ? '✅ Migración V3 completada exitosamente' : '❌ Algunas tablas faltan'));
console.log('🚀 Reinicia el servidor para que los cambios surtan efecto.');
