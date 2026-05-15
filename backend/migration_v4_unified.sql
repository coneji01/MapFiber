-- ═══════════════════════════════════════════════════════════
-- MIGRACIÓN V4: Modelo unificado de propagación de potencia
-- ═══════════════════════════════════════════════════════════
-- Cambios:
-- 1. cable_points: se agrega fiber_number y power_status
-- 2. Nueva tabla: connections (reemplaza fusions + splices)
-- 3. manga_fibers → cable_points (splitter ports)
-- 4. Migración de datos existentes
-- ═══════════════════════════════════════════════════════════

BEGIN TRANSACTION;

-- ══════════════════════════════════════════════════════════
-- 1. cable_points: agregar columnas
-- ══════════════════════════════════════════════════════════
ALTER TABLE cable_points ADD COLUMN fiber_number INTEGER DEFAULT NULL;
ALTER TABLE cable_points ADD COLUMN power_status BOOLEAN DEFAULT 0;
ALTER TABLE cable_points ADD COLUMN power_level REAL DEFAULT NULL;
ALTER TABLE cable_points ADD COLUMN splitter_id INTEGER DEFAULT NULL REFERENCES splitters(id) ON DELETE CASCADE;
ALTER TABLE cable_points ADD COLUMN splitter_port INTEGER DEFAULT NULL;

-- ══════════════════════════════════════════════════════════
-- 2. Tabla connections (unifica fusions + splices)
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_cp_id INTEGER NOT NULL,
    source_fiber INTEGER NOT NULL,
    target_cp_id INTEGER NOT NULL,
    target_fiber INTEGER NOT NULL,
    connection_type TEXT NOT NULL CHECK(connection_type IN ('fusion', 'splitter_internal', 'splice')),
    loss_db REAL DEFAULT 0.0,
    source_conn_id INTEGER DEFAULT NULL,
    manga_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_cp_id) REFERENCES cable_points(id) ON DELETE CASCADE,
    FOREIGN KEY (target_cp_id) REFERENCES cable_points(id) ON DELETE CASCADE
);

CREATE INDEX idx_conn_source ON connections(source_cp_id, source_fiber);
CREATE INDEX idx_conn_target ON connections(target_cp_id, target_fiber);

-- ══════════════════════════════════════════════════════════
-- 3. Migrar fusions → connections
-- ══════════════════════════════════════════════════════════
INSERT INTO connections (source_cp_id, source_fiber, target_cp_id, target_fiber, connection_type, loss_db, source_conn_id, manga_id, created_at)
SELECT 
    cable_connection_id_in, fiber_in,
    cable_connection_id_out, fiber_out,
    'fusion', loss_db, source_conn_id, manga_id, created_at
FROM fusions
WHERE cable_connection_id_in IS NOT NULL 
  AND cable_connection_id_out IS NOT NULL;

-- ══════════════════════════════════════════════════════════
-- 4. Crear cable_points para splitter ports
-- ══════════════════════════════════════════════════════════
-- Por cada manga_fiber, crear un cable_point 
INSERT INTO cable_points (cable_id, fiber_number, element_type, element_id, splitter_id, splitter_port, sequence, lat, lng, power_status)
SELECT 
    cp.cable_id,
    mf.fiber_number,
    'cable', -- usar 'cable' porque CHECK constraint no permite 'splitter'
    mf.splitter_id,
    mf.splitter_id,
    mf.splitter_output,
    cp.sequence + 100 + mf.splitter_output,
    cp.lat, cp.lng,
    mf.active_power
FROM manga_fibers mf
JOIN splitters sp ON sp.id = mf.splitter_id
LEFT JOIN cable_points cp ON cp.element_type = 'manga' AND cp.element_id = mf.manga_id
WHERE mf.splitter_id IS NOT NULL
GROUP BY mf.id;

-- ══════════════════════════════════════════════════════════
-- 5. Migrar splices cable↔splitter → connections
-- ══════════════════════════════════════════════════════════
-- Un splice conecta un cable_point con un manga_fiber.
-- El manga_fiber ahora es un cable_point (splitter port).
-- Buscar el cable_point creado para ese manga_fiber.
INSERT INTO connections (source_cp_id, source_fiber, target_cp_id, target_fiber, connection_type, loss_db, manga_id, created_at)
SELECT 
    s.fiber_a_id AS source_cp,  -- cable_point
    s.fiber_a_port AS source_fib,
    scp.id AS target_cp,        -- splitter cable_point
    scp.fiber_number AS target_fib,
    'splice', s.loss_db, s.manga_id, s.created_at
FROM splices s
JOIN manga_fibers mf ON 
    (s.fiber_b_type = 'manga_fiber' AND s.fiber_b_id = mf.id AND mf.splitter_id IS NOT NULL)
JOIN cable_points scp ON scp.splitter_id = mf.splitter_id AND scp.splitter_port = mf.splitter_output
WHERE s.fiber_a_type = 'cable_fiber'
UNION ALL
SELECT 
    s.fiber_b_id, s.fiber_b_port,
    scp.id, scp.fiber_number,
    'splice', s.loss_db, s.manga_id, s.created_at
FROM splices s
JOIN manga_fibers mf ON 
    (s.fiber_a_type = 'manga_fiber' AND s.fiber_a_id = mf.id AND mf.splitter_id IS NOT NULL)
JOIN cable_points scp ON scp.splitter_id = mf.splitter_id AND scp.splitter_port = mf.splitter_output
WHERE s.fiber_b_type = 'cable_fiber';

-- ══════════════════════════════════════════════════════════
-- 6. Poblar fiber_number en cable_points existentes
-- Usar fiber_connections para determinar qué fibra pasa por cada cable_point
-- ══════════════════════════════════════════════════════════
-- Para cada cable_point, buscar la fiber_connection del cable asociado
UPDATE cable_points SET fiber_number = (
    SELECT fc.fiber_number FROM fiber_connections fc 
    WHERE fc.cable_id = cable_points.cable_id 
    LIMIT 1
) WHERE fiber_number IS NULL;

-- ══════════════════════════════════════════════════════════
-- 7. Actualizar fiber_number desde fusions (para puntos en mangas)
-- ══════════════════════════════════════════════════════════
UPDATE cable_points SET fiber_number = (
    SELECT f.fiber_in FROM fusions f 
    WHERE f.cable_connection_id_in = cable_points.id 
    LIMIT 1
) WHERE fiber_number IS NULL;

UPDATE cable_points SET fiber_number = (
    SELECT f.fiber_out FROM fusions f 
    WHERE f.cable_connection_id_out = cable_points.id 
    LIMIT 1
) WHERE fiber_number IS NULL;

-- ══════════════════════════════════════════════════════════
-- 8. Indices y constraints
-- ══════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_cp_cable_fiber ON cable_points(cable_id, fiber_number);
CREATE INDEX IF NOT EXISTS idx_cp_splitter ON cable_points(splitter_id, splitter_port);

COMMIT;
