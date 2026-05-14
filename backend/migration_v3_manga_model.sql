-- ============================================================
-- MIGRACIÓN V3 — Nuevo modelo de mangas, hilos y splitters
-- Basado en la lógica real de MapFiber de Joel
-- ============================================================
-- 
-- Conceptos clave:
--   1. Un CABLE puede ENTRA a una MANGA (N cables por manga)
--   2. Desde una MANGA pueden SALIR N cables
--   3. Cada HILO dentro de una manga se modela individualmente
--   4. Un hilo puede ser: PASANTE, FUSIONADO a otra fibra,
--      FUSIONADO a la ENTRADA o SALIDA de un SPLITTER, o TERMINADO
--   5. Los SPLITTERS viven DENTRO de las mangas
--   6. La NAP es una MANGA con un splitter interno
--   7. Al deshacer, la fibra NO se restaura — queda cortada (rota)
-- ============================================================

BEGIN TRANSACTION;

-- ============================================================
-- 1. TABLA: entrada_cable_manga
--    Modela qué cables entran/salen de cada manga
-- ============================================================
CREATE TABLE IF NOT EXISTS entrada_cable_manga (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id INTEGER NOT NULL,
    cable_id INTEGER NOT NULL,
    
    -- "atraviesa" = el cable sigue después de la manga (se corta la funda, pasan o no los hilos)
    -- "termina_aqui" = el cable termina en esta manga (no sigue)
    -- "inicia_aqui" = el cable empieza en esta manga (sale del splitter o de fusión)
    tipo TEXT NOT NULL DEFAULT 'atraviesa'
        CHECK (tipo IN ('atraviesa', 'termina_aqui', 'inicia_aqui')),
    
    -- Si el cable atraviesa, por qué cable continúa (puede ser el mismo ID si sigue intacto,
    -- o un nuevo segmento si se cortaron hilos)
    cable_continuacion_id INTEGER REFERENCES cables(id) ON DELETE SET NULL,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (manga_id) REFERENCES mangas(id) ON DELETE CASCADE,
    FOREIGN KEY (cable_id) REFERENCES cables(id) ON DELETE CASCADE,
    UNIQUE(manga_id, cable_id)
);

-- ============================================================
-- 2. TABLA: hilo_dentro_manga
--    EL CORAZÓN DEL MODELO — qué pasa con CADA hilo dentro de una manga
-- ============================================================
CREATE TABLE IF NOT EXISTS hilo_dentro_manga (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entrada_cable_manga_id INTEGER NOT NULL,
    numero_hilo INTEGER NOT NULL,          -- 1-144, posición física
    color_hilo TEXT,                        -- color para identificación física
    fibra_original_cable_id INTEGER,        -- cable original al que pertenece (para rastreo)
    fibra_original_numero INTEGER,          -- número original en el cable padre
    
    -- ESTADOS:
    --   "pasante"            → el hilo NO se toca, sigue intacto por dentro del cable
    --   "fusionado_fibra"    → fusionado a otro hilo (empalme directo cable→cable)
    --   "fusionado_splitter" → conectado a entrada o salida de splitter
    --   "terminado"          → punta suelta dentro de la manga (no fusionada a nada)
    --   "roto"               → se usó, se deshizo, quedó partido — irreversible
    estado TEXT NOT NULL DEFAULT 'pasante'
        CHECK (estado IN ('pasante', 'fusionado_fibra', 'fusionado_splitter', 'terminado', 'roto')),
    
    -- Si está fusionado a OTRO hilo dentro de la misma manga:
    fusionado_a_hilo_id INTEGER REFERENCES hilo_dentro_manga(id) ON DELETE SET NULL,
    
    -- Si está fusionado a un SPLITTER:
    splitter_id INTEGER REFERENCES splitter(id) ON DELETE SET NULL,
    splitter_puerto INTEGER,  -- 0 = entrada, 1-N = salidas
    
    -- Potencia óptica (dBm) en este punto
    potencia_db REAL,
    tiene_potencia INTEGER DEFAULT 0,
    
    -- Para agrupar fusiones que forman un "michelle" (sangrado)
    -- Un michelle es cuando solo 1-2 hilos se cortan de un cable, el resto pasan
    grupo_michelle_id INTEGER,
    
    perdida_db REAL DEFAULT 0.1,  -- pérdida de la fusión si aplica
    
    notas TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (entrada_cable_manga_id) REFERENCES entrada_cable_manga(id) ON DELETE CASCADE,
    UNIQUE(entrada_cable_manga_id, numero_hilo)
);

-- ============================================================
-- 3. TABLA: splitter (diferente a la tabla `splitters` existente)
--    Splitter que vive DENTRO de una manga
-- ============================================================
CREATE TABLE IF NOT EXISTS splitter (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id INTEGER NOT NULL,
    nombre TEXT,
    tipo_split TEXT NOT NULL DEFAULT '1:8'
        CHECK (tipo_split IN ('1:4', '1:8', '1:16', '1:32', '1:64')),
    puertos INTEGER NOT NULL DEFAULT 8,
    perdida_db REAL DEFAULT 10.5,  -- pérdida típica según tipo
    
    -- El hilo de entrada (referencia a hilo_dentro_manga)
    hilo_entrada_id INTEGER REFERENCES hilo_dentro_manga(id) ON DELETE SET NULL,
    
    notas TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (manga_id) REFERENCES mangas(id) ON DELETE CASCADE
);

-- ============================================================
-- 4. TABLA: cable_tramo
--    Segmentos de un cable entre mangas
--    Un cable original se parte en N tramos al pasar por mangas
-- ============================================================
CREATE TABLE IF NOT EXISTS cable_tramo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cable_origen_id INTEGER NOT NULL,       -- el cable físico original
    nombre_tramo TEXT,                       -- ej: "Tramo A (0-500m)"
    manga_inicio_id INTEGER REFERENCES mangas(id) ON DELETE SET NULL,
    manga_fin_id INTEGER REFERENCES mangas(id) ON DELETE SET NULL,
    longitud_metros REAL,
    hilos_presentes TEXT,                   -- JSON array de números de hilo que siguen vivos
    -- Potencia de entrada en este tramo (desde OLT, propagada)
    potencia_entrada_db REAL,
    atenuacion_cable_db REAL,
    perdida_fusiones_db REAL,
    potencia_salida_db REAL,
    tiene_potencia INTEGER DEFAULT 0,
    notas TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (cable_origen_id) REFERENCES cables(id) ON DELETE CASCADE
);

-- ============================================================
-- 5. TABLA: michelle_grupo
--    Agrupa operaciones de sangrado (Michelle)
--    Un "michelle" es cortar 1-2 hilos selectivamente y dejar el resto pasante
-- ============================================================
CREATE TABLE IF NOT EXISTS michelle_grupo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id INTEGER NOT NULL,
    nombre TEXT,
    -- El splitter al que se conectó el sangrado (si aplica)
    splitter_id INTEGER REFERENCES splitter(id) ON DELETE SET NULL,
    -- Cuántos hilos se "sacrificaron" (cortaron)
    hilos_cortados INTEGER DEFAULT 1,
    -- Cuántos hilos quedaron pasantes
    hilos_pasantes INTEGER DEFAULT 0,
    notas TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (manga_id) REFERENCES mangas(id) ON DELETE CASCADE
);

-- ============================================================
-- 6. ÍNDICES para rendimiento
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_entrada_cable_manga_manga ON entrada_cable_manga(manga_id);
CREATE INDEX IF NOT EXISTS idx_entrada_cable_manga_cable ON entrada_cable_manga(cable_id);
CREATE INDEX IF NOT EXISTS idx_hilo_dentro_manga_entrada ON hilo_dentro_manga(entrada_cable_manga_id);
CREATE INDEX IF NOT EXISTS idx_hilo_dentro_manga_splitter ON hilo_dentro_manga(splitter_id);
CREATE INDEX IF NOT EXISTS idx_hilo_dentro_manga_estado ON hilo_dentro_manga(estado);
CREATE INDEX IF NOT EXISTS idx_hilo_dentro_manga_fusion ON hilo_dentro_manga(fusionado_a_hilo_id);
CREATE INDEX IF NOT EXISTS idx_splitter_manga ON splitter(manga_id);
CREATE INDEX IF NOT EXISTS idx_cable_tramo_origen ON cable_tramo(cable_origen_id);
CREATE INDEX IF NOT EXISTS idx_cable_tramo_manga ON cable_tramo(manga_inicio_id);
CREATE INDEX IF NOT EXISTS idx_cable_tramo_manga_fin ON cable_tramo(manga_fin_id);

-- ============================================================
-- 7. MIGRACIÓN: Agregar columna tipo_manga a la tabla `mangas` existente
-- ============================================================
ALTER TABLE mangas ADD COLUMN tipo_manga TEXT DEFAULT 'empalme'
    CHECK (tipo_manga IN ('empalme', 'splitter', 'mixta', 'nap'));

-- ============================================================
-- 8. MIGRACIÓN: Agregar columna hilo_original a cable_fibers
--    Para rastrear qué hilo original se cortó y está dentro de una manga
-- ============================================================
ALTER TABLE cable_fibers ADD COLUMN cortado_en_manga_id INTEGER;

-- ============================================================
-- 9. MIGRACIÓN: Agregar campos de rastreo a fusions (existente)
--    Para indicar qué hilos dentro de manga están involucrados
-- ============================================================
ALTER TABLE fusions ADD COLUMN hilo_manga_a_id INTEGER REFERENCES hilo_dentro_manga(id) ON DELETE SET NULL;
ALTER TABLE fusions ADD COLUMN hilo_manga_b_id INTEGER REFERENCES hilo_dentro_manga(id) ON DELETE SET NULL;

COMMIT;

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
SELECT '✅ Migración V3 completada' as estado;
SELECT 'entrada_cable_manga' as tabla UNION SELECT 'hilo_dentro_manga' UNION SELECT 'splitter' UNION SELECT 'cable_tramo' UNION SELECT 'michelle_grupo';
