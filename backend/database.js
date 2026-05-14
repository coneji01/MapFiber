const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'ftth.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Crear tablas
db.exec(`
  -- OLTs (Optical Line Terminals)
  CREATE TABLE IF NOT EXISTS olts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    description TEXT,
    brand TEXT,
    model TEXT,
    ports_count INTEGER DEFAULT 16,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- OLT Cards (tarjetas físicas dentro de una OLT)
  CREATE TABLE IF NOT EXISTS olt_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    olt_id INTEGER NOT NULL,
    slot_number INTEGER NOT NULL,
    name TEXT,
    ports_count INTEGER NOT NULL DEFAULT 8,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (olt_id) REFERENCES olts(id) ON DELETE CASCADE
  );

  -- OLT Ports
  CREATE TABLE IF NOT EXISTS olt_ports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    olt_id INTEGER NOT NULL,
    card_id INTEGER,
    slot_number INTEGER,
    port_number INTEGER NOT NULL,
    power REAL DEFAULT 2.5,
    name TEXT,
    operational_status TEXT DEFAULT 'Offline',
    online_onus_count INTEGER DEFAULT 0,
    FOREIGN KEY (olt_id) REFERENCES olts(id) ON DELETE CASCADE,
    FOREIGN KEY (card_id) REFERENCES olt_cards(id) ON DELETE SET NULL
  );

  -- Mangas (splice enclosures)
  CREATE TABLE IF NOT EXISTS mangas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    description TEXT,
    max_splices INTEGER DEFAULT 48,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Splitter Types (1x8, 1x16)
  CREATE TABLE IF NOT EXISTS splitter_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ports INTEGER NOT NULL,
    loss_db REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cable_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    fiber_count INTEGER NOT NULL DEFAULT 12,
    tube_count INTEGER DEFAULT 4,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS color_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    connections_color_code_json TEXT,
    fusions_color_code_json TEXT
  );

  CREATE TABLE IF NOT EXISTS color_code_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    color_code_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    hex TEXT NOT NULL DEFAULT '#ffffff',
    FOREIGN KEY (color_code_id) REFERENCES color_codes(id) ON DELETE CASCADE
  );

  -- NAP Boxes (cajas de distribución)
  CREATE TABLE IF NOT EXISTS naps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    description TEXT,
    splitter_type_id INTEGER,
    port_capacity INTEGER DEFAULT 8,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (splitter_type_id) REFERENCES splitter_types(id)
  );

  -- NAP Ports (individual fiber outputs from a NAP splitter)
  CREATE TABLE IF NOT EXISTS nap_ports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nap_id INTEGER NOT NULL,
    port_number INTEGER NOT NULL,
    fiber_number INTEGER,
    client_name TEXT,
    client_address TEXT,
    notes TEXT,
    FOREIGN KEY (nap_id) REFERENCES naps(id) ON DELETE CASCADE
  );

  -- Cables (fiber optic cables — multi-fiber)
  CREATE TABLE IF NOT EXISTS cables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    fiber_count INTEGER NOT NULL DEFAULT 12,
    tube_count INTEGER DEFAULT 4,
    length_m REAL,
    cable_type TEXT DEFAULT 'ADSS',
    attenuation_db_per_km REAL DEFAULT 0.35,
    color TEXT DEFAULT '#3388ff',
    cable_type_id INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Cable Points (where cables connect to elements)
  CREATE TABLE IF NOT EXISTS cable_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cable_id INTEGER NOT NULL,
    lat REAL,
    lng REAL,
    sequence INTEGER DEFAULT 0,
    element_type TEXT CHECK(element_type IN ('olt','nap','manga','cable','')),
    element_id INTEGER,
    name TEXT,
    notes TEXT,
    FOREIGN KEY (cable_id) REFERENCES cables(id) ON DELETE CASCADE
  );

  -- Fiber splices (fusiones dentro de mangas)
  CREATE TABLE IF NOT EXISTS fiber_splices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id INTEGER NOT NULL,
    left_type TEXT NOT NULL CHECK(left_type IN ('nap','cable')),
    left_id INTEGER NOT NULL,
    left_fiber_number INTEGER NOT NULL,
    right_type TEXT NOT NULL CHECK(right_type IN ('nap','cable')),
    right_id INTEGER NOT NULL,
    right_fiber_number INTEGER NOT NULL,
    loss_db REAL DEFAULT 0.1,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (manga_id) REFERENCES mangas(id) ON DELETE CASCADE
  );

  -- Fiber connections (empalmes directos entre OLT ports y cables)
  -- This table is being phased out in favor of fiber_splices for the manga path
  CREATE TABLE IF NOT EXISTS fiber_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cable_id INTEGER NOT NULL,
    fiber_number INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    source_port_id INTEGER,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    target_port_id INTEGER,
    source_olt_port_id INTEGER,
    distance_m REAL DEFAULT 0,
    splice_count INTEGER DEFAULT 0,
    total_loss REAL DEFAULT 0,
    active_power BOOLEAN DEFAULT 0,
    power_level REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cable_id) REFERENCES cables(id) ON DELETE CASCADE
  );

  -- Fusiones directas (cable → cable dentro de mangas)
  CREATE TABLE IF NOT EXISTS fusiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id INTEGER,
    cable_origen_id INTEGER NOT NULL,
    fibra_origen INTEGER NOT NULL,
    cable_destino_id INTEGER NOT NULL,
    fibra_destino INTEGER NOT NULL,
    perdida_db REAL DEFAULT 0.1,
    FOREIGN KEY (manga_id) REFERENCES mangas(id) ON DELETE SET NULL,
    FOREIGN KEY (cable_origen_id) REFERENCES cables(id) ON DELETE CASCADE,
    FOREIGN KEY (cable_destino_id) REFERENCES cables(id) ON DELETE CASCADE
  );

  -- Folder/grouping system (like Windows Explorer tree)
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
  );

  -- Folder items (entities inside folders)
  CREATE TABLE IF NOT EXISTS folder_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER NOT NULL,
    item_type TEXT NOT NULL CHECK(item_type IN ('olt','nap','manga','cable')),
    item_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
  );

  -- ============================================================
  -- V3 — Nuevo modelo de mangas, hilos y splitters
  -- Basado en la lógica real de MapFiber: cada hilo dentro de una
  -- manga se modela individualmente con su estado.
  -- ============================================================

  -- Mangas: agregar columna tipo
  CREATE TABLE IF NOT EXISTS mangas_v3 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    description TEXT,
    tipo_manga TEXT DEFAULT 'empalme' CHECK (tipo_manga IN ('empalme','splitter','mixta','nap')),
    max_splices INTEGER DEFAULT 48,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Cables que entran/salen de mangas (N:M)
  CREATE TABLE IF NOT EXISTS entrada_cable_manga (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id INTEGER NOT NULL REFERENCES mangas(id) ON DELETE CASCADE,
    cable_id INTEGER NOT NULL REFERENCES cables(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL DEFAULT 'atraviesa' CHECK (tipo IN ('atraviesa','termina_aqui','inicia_aqui')),
    cable_continuacion_id INTEGER REFERENCES cables(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(manga_id, cable_id)
  );

  -- ⭐ EL CORAZÓN: cada hilo dentro de una manga
  CREATE TABLE IF NOT EXISTS hilo_dentro_manga (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entrada_cable_manga_id INTEGER NOT NULL REFERENCES entrada_cable_manga(id) ON DELETE CASCADE,
    numero_hilo INTEGER NOT NULL,
    color_hilo TEXT,
    fibra_original_cable_id INTEGER REFERENCES cables(id) ON DELETE SET NULL,
    fibra_original_numero INTEGER,
    estado TEXT NOT NULL DEFAULT 'pasante' CHECK (estado IN ('pasante','fusionado_fibra','fusionado_splitter','terminado','roto')),
    fusionado_a_hilo_id INTEGER REFERENCES hilo_dentro_manga(id) ON DELETE SET NULL,
    splitter_id INTEGER REFERENCES splitter(id) ON DELETE SET NULL,
    splitter_puerto INTEGER,
    potencia_db REAL,
    tiene_potencia INTEGER DEFAULT 0,
    grupo_michelle_id INTEGER REFERENCES michelle_grupo(id) ON DELETE SET NULL,
    perdida_db REAL DEFAULT 0.1,
    notas TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(entrada_cable_manga_id, numero_hilo)
  );

  -- Splitter dentro de manga
  CREATE TABLE IF NOT EXISTS splitter (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id INTEGER NOT NULL REFERENCES mangas(id) ON DELETE CASCADE,
    nombre TEXT,
    tipo_split TEXT NOT NULL DEFAULT '1:8' CHECK (tipo_split IN ('1:4','1:8','1:16','1:32','1:64')),
    puertos INTEGER NOT NULL DEFAULT 8,
    perdida_db REAL DEFAULT 10.5,
    hilo_entrada_id INTEGER REFERENCES hilo_dentro_manga(id) ON DELETE SET NULL,
    notas TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Cable tramo (segmento entre mangas)
  CREATE TABLE IF NOT EXISTS cable_tramo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cable_origen_id INTEGER NOT NULL REFERENCES cables(id) ON DELETE CASCADE,
    nombre_tramo TEXT,
    manga_inicio_id INTEGER REFERENCES mangas(id) ON DELETE SET NULL,
    manga_fin_id INTEGER REFERENCES mangas(id) ON DELETE SET NULL,
    longitud_metros REAL,
    hilos_presentes TEXT,
    potencia_entrada_db REAL,
    atenuacion_cable_db REAL,
    perdida_fusiones_db REAL,
    potencia_salida_db REAL,
    tiene_potencia INTEGER DEFAULT 0,
    notas TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Michelle (sangrado) grupo
  CREATE TABLE IF NOT EXISTS michelle_grupo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id INTEGER NOT NULL REFERENCES mangas(id) ON DELETE CASCADE,
    nombre TEXT,
    splitter_id INTEGER REFERENCES splitter(id) ON DELETE SET NULL,
    hilos_cortados INTEGER DEFAULT 1,
    hilos_pasantes INTEGER DEFAULT 0,
    notas TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Índices
  CREATE INDEX IF NOT EXISTS idx_entrada_cable_manga_manga ON entrada_cable_manga(manga_id);
  CREATE INDEX IF NOT EXISTS idx_entrada_cable_manga_cable ON entrada_cable_manga(cable_id);
  CREATE INDEX IF NOT EXISTS idx_hilo_dentro_manga_entrada ON hilo_dentro_manga(entrada_cable_manga_id);
  CREATE INDEX IF NOT EXISTS idx_hilo_dentro_manga_splitter ON hilo_dentro_manga(splitter_id);
  CREATE INDEX IF NOT EXISTS idx_hilo_dentro_manga_estado ON hilo_dentro_manga(estado);
  CREATE INDEX IF NOT EXISTS idx_hilo_dentro_manga_fusion ON hilo_dentro_manga(fusionado_a_hilo_id);
  CREATE INDEX IF NOT EXISTS idx_splitter_manga ON splitter(manga_id);
  CREATE INDEX IF NOT EXISTS idx_cable_tramo_origen ON cable_tramo(cable_origen_id);
  CREATE INDEX IF NOT EXISTS idx_cable_tramo_manga ON cable_tramo(manga_inicio_id);
`);

// === TABLAS FALTANTES (creadas externamente antes) ===
db.exec(`
  CREATE TABLE IF NOT EXISTS fusions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    manga_id INTEGER,
    cable_connection_id_in INTEGER NOT NULL,
    fiber_in INTEGER NOT NULL,
    cable_connection_id_out INTEGER,
    fiber_out INTEGER,
    connection_type INTEGER DEFAULT 0,
    loss_db REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    source_conn_id INTEGER,
    hilo_manga_a_id INTEGER,
    hilo_manga_b_id INTEGER,
    FOREIGN KEY (manga_id) REFERENCES mangas(id) ON DELETE SET NULL,
    FOREIGN KEY (cable_connection_id_in) REFERENCES cable_points(id) ON DELETE CASCADE,
    FOREIGN KEY (cable_connection_id_out) REFERENCES cable_points(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS cable_fibers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cable_id INTEGER NOT NULL,
    fiber_number INTEGER NOT NULL,
    color TEXT NOT NULL DEFAULT '#ffffff',
    color_name TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'used', 'reserved', 'broken')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    fiber_type TEXT DEFAULT 'distribution',
    cortado_en_manga_id INTEGER,
    FOREIGN KEY (cable_id) REFERENCES cables(id) ON DELETE CASCADE,
    UNIQUE(cable_id, fiber_number)
  );
  CREATE TABLE IF NOT EXISTS manga_fibers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id INTEGER NOT NULL,
    fiber_number INTEGER NOT NULL,
    splitter_id INTEGER,
    splitter_output INTEGER,
    source_type TEXT,
    source_id INTEGER,
    target_type TEXT,
    target_id INTEGER,
    client_name TEXT,
    notes TEXT,
    active_power BOOLEAN DEFAULT 0,
    power_level REAL,
    FOREIGN KEY (manga_id) REFERENCES mangas(id) ON DELETE CASCADE,
    FOREIGN KEY (splitter_id) REFERENCES manga_splitters(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS splices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    manga_id INTEGER,
    lat REAL,
    lng REAL,
    loss_db REAL DEFAULT 0.1,
    fiber_a_type TEXT,
    fiber_a_id INTEGER,
    fiber_a_port INTEGER,
    fiber_b_type TEXT,
    fiber_b_id INTEGER,
    fiber_b_port INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (manga_id) REFERENCES mangas(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS splitters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    splitter_type_id INTEGER,
    ports_count INTEGER DEFAULT 8,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (splitter_type_id) REFERENCES splitter_types(id)
  );
  CREATE TABLE IF NOT EXISTS splitter_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    splitter_id INTEGER NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    FOREIGN KEY (splitter_id) REFERENCES splitters(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS manga_splitters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id INTEGER NOT NULL,
    name TEXT,
    splitter_type_id INTEGER,
    ports_count INTEGER DEFAULT 8,
    input_fiber INTEGER,
    FOREIGN KEY (manga_id) REFERENCES mangas(id) ON DELETE CASCADE,
    FOREIGN KEY (splitter_type_id) REFERENCES splitter_types(id)
  );
`);

// === TABLAS ADICIONALES ===
db.exec(`
  CREATE TABLE IF NOT EXISTS company_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL UNIQUE,
    name TEXT DEFAULT 'Mi Empresa',
    language TEXT DEFAULT 'es',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS onus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    olt_port_id INTEGER,
    onu_id TEXT,
    name TEXT,
    serial_number TEXT,
    status TEXT DEFAULT 'offline',
    signal_db REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (olt_port_id) REFERENCES olt_ports(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS power_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fiber_connection_id INTEGER,
    power_level REAL,
    measured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (fiber_connection_id) REFERENCES fiber_connections(id) ON DELETE CASCADE
  );
`);

// === MIGRATIONS: columns that may not exist yet ===
function migrate() {
  // Add card_id to olt_ports if not exist
  try {
    db.exec('ALTER TABLE olt_ports ADD COLUMN card_id INTEGER REFERENCES olt_cards(id) ON DELETE SET NULL');
  } catch(e) {
    if (!e.message.includes('duplicate column')) throw e;
  }
  try {
    db.exec('ALTER TABLE olt_ports ADD COLUMN slot_number INTEGER');
  } catch(e) {
    if (!e.message.includes('duplicate column')) throw e;
  }
  try {
    db.exec('ALTER TABLE olt_ports ADD COLUMN operational_status TEXT DEFAULT "Offline"');
  } catch(e) {
    if (!e.message.includes('duplicate column')) throw e;
  }
  try {
    db.exec('ALTER TABLE olt_ports ADD COLUMN online_onus_count INTEGER DEFAULT 0');
  } catch(e) {
    if (!e.message.includes('duplicate column')) throw e;
  }

  // Add source_conn_id to fusions if not exist
  try {
    db.exec('ALTER TABLE fusions ADD COLUMN source_conn_id INTEGER');
  } catch(e) {
    if (!e.message.includes('duplicate column')) throw e;
  }

  // Add source column to olt_cards (manual | smartolt)
  try {
    db.exec('ALTER TABLE olt_cards ADD COLUMN source TEXT DEFAULT "manual"');
  } catch(e) {
    if (!e.message.includes('duplicate column')) throw e;
  }
  // Backfill existing cards that have NULL source
  db.prepare("UPDATE olt_cards SET source='manual' WHERE source IS NULL").run();

  // Add smartolt fields to olts
  try {
    db.exec('ALTER TABLE olts ADD COLUMN smartolt_subdomain TEXT');
  } catch(e) {
    if (!e.message.includes('duplicate column')) throw e;
  }
  try {
    db.exec('ALTER TABLE olts ADD COLUMN smartolt_olt_id TEXT');
  } catch(e) {
    if (!e.message.includes('duplicate column')) throw e;
  }

  // V3 — Add tipo_manga column to existing mangas table if not exists
  try {
    db.exec('ALTER TABLE mangas ADD COLUMN tipo_manga TEXT DEFAULT "empalme"');
  } catch(e) {
    if (!e.message.includes('duplicate column')) throw e;
  }

  // V3 — Add cortado_en_manga_id to cable_fibers
  try {
    db.exec('ALTER TABLE cable_fibers ADD COLUMN cortado_en_manga_id INTEGER');
  } catch(e) {
    if (!e.message.includes('duplicate column')) throw e;
  }

  // V3 — Add hilo_manga references to fusions
  try {
    db.exec('ALTER TABLE fusions ADD COLUMN hilo_manga_a_id INTEGER');
  } catch(e) {
    if (!e.message.includes('duplicate column')) throw e;
  }
  try {
    db.exec('ALTER TABLE fusions ADD COLUMN hilo_manga_b_id INTEGER');
  } catch(e) {
    if (!e.message.includes('duplicate column')) throw e;
  }

  // Migrate legacy flat olt_ports: group by existing OLT into virtual cards
  const legacyPorts = db.prepare(`
    SELECT p.id, p.olt_id, p.port_number
    FROM olt_ports p
    WHERE p.card_id IS NULL
    ORDER BY p.olt_id, p.port_number
  `).all();

  if (legacyPorts.length > 0) {
    // Group by olt to create default "Card 1" for each OLT
    const grouped = {};
    for (const p of legacyPorts) {
      if (!grouped[p.olt_id]) grouped[p.olt_id] = [];
      grouped[p.olt_id].push(p);
    }
    
    const insertCard = db.prepare(`
      INSERT INTO olt_cards (olt_id, slot_number, name, ports_count, source)
      VALUES (?, 1, 'Card 1', ?, 'manual')
    `);
    const updatePort = db.prepare(`
      UPDATE olt_ports SET card_id=?, slot_number=? WHERE id=?
    `);
    
    for (const [oltId, ports] of Object.entries(grouped)) {
      const cardResult = insertCard.run(parseInt(oltId), ports.length);
      const cardId = cardResult.lastInsertRowid;
      for (let i = 0; i < ports.length; i++) {
        updatePort.run(cardId, i + 1, ports[i].id);
      }
    }
    console.log(`Migrated ${legacyPorts.length} legacy ports into cards`);
  }
}

migrate();

module.exports = db;
