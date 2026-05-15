// ═══════════════════════════════════════════════════════════════
// Migración V4 — Modelo unificado de propagación de potencia
// ═══════════════════════════════════════════════════════════════
const db = require('./database');
const fs = require('fs');
const path = require('path');

console.log('🔄 Ejecutando migración V4...');

try {
  const sql = fs.readFileSync(path.join(__dirname, 'migration_v4_unified.sql'), 'utf-8');
  
  // Ejecutar cada statement por separado (sqlite solo permite una declaración a la vez)
  const statements = sql.split(';').filter(s => s.trim().length > 0);
  
  for (const stmt of statements) {
    try {
      db.exec(stmt + ';');
    } catch (e) {
      // Ignorar errores de "already exists" para ALTER TABLE
      if (e.message.includes('duplicate column name')) {
        console.log('  ⏭️ Columna ya existe, saltando:', stmt.substring(0, 60));
      } else if (e.message.includes('already exists')) {
        console.log('  ⏭️ Ya existe, saltando:', stmt.substring(0, 60));
      } else {
        console.error('  ❌ Error:', e.message.substring(0, 100));
        console.error('     SQL:', stmt.substring(0, 100));
      }
    }
  }
  
  console.log('✅ Migración V4 completada');
} catch (e) {
  console.error('❌ Error fatal:', e.message);
  process.exit(1);
}
