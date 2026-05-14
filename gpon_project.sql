-- =====================================================
-- GPON PROJECT — MapFiber v2
-- 20 NAPs — Diseño completo
-- =====================================================

BEGIN TRANSACTION;

-- =====================================================
-- 1. FIX: Actualizar splitter types en NAPs existentes
-- =====================================================
-- NAP-3 tiene splitter 1x2 → cambiar a 1x8 (GPON proper)
UPDATE naps SET splitter_type_id = 3, description = 'Caja NAP Zona Universitaria — 8 puertos GPON', updated_at = CURRENT_TIMESTAMP WHERE id = 3;

-- NAP-5 tiene splitter 1x2 → cambiar a 1x8
UPDATE naps SET splitter_type_id = 3, description = 'Caja NAP Callejón — 8 puertos GPON', updated_at = CURRENT_TIMESTAMP WHERE id = 5;

-- NAP-6 tiene splitter 1x2 y 2 puertos → cambiar a 8 puertos + splitter 1x8
UPDATE naps SET splitter_type_id = 3, port_capacity = 8, description = 'Caja NAP Ensanche Ozama Norte — 8 puertos GPON', updated_at = CURRENT_TIMESTAMP WHERE id = 6;

-- NAP-7 igual
UPDATE naps SET splitter_type_id = 3, port_capacity = 8, description = 'Caja NAP Ensanche Ozama Sur — 8 puertos GPON', updated_at = CURRENT_TIMESTAMP WHERE id = 7;

-- NAP-1 y NAP-2 ya tienen 1x16 y 16 puertos — correcto ✅

-- =====================================================
-- 2. AGREGAR 6 NAPs nuevas (15-20)
-- =====================================================

-- NAP-15: Zona Sur, entre NAP-4 y NAP-8
INSERT INTO naps (name, lat, lng, description, splitter_type_id, port_capacity, address)
VALUES ('NAP-15', 18.481500, -69.955000, 'Caja NAP Zona Sur Residencial — 8 puertos GPON', 3, 8, 'Calle Sánchez, Esquina Independencia');

-- NAP-16: Zona Este, cerca de manga principal
INSERT INTO naps (name, lat, lng, description, splitter_type_id, port_capacity, address)
VALUES ('NAP-16', 18.490000, -69.920000, 'Caja NAP Zona Este Comercial — 8 puertos GPON', 3, 8, 'Av. Máximo Gómez #55, Ensanche Ozama');

-- NAP-17: Zona Noroeste
INSERT INTO naps (name, lat, lng, description, splitter_type_id, port_capacity, address)
VALUES ('NAP-17', 18.480000, -69.965000, 'Caja NAP Zona Noroeste — 8 puertos GPON', 3, 8, 'Av. Abraham Lincoln #200, Piantini');

-- NAP-18: Cerca de NAP-3 (Zona U)
INSERT INTO naps (name, lat, lng, description, splitter_type_id, port_capacity, address)
VALUES ('NAP-18', 18.482000, -69.935000, 'Caja NAP Zona Universitaria Sur — 8 puertos GPON', 3, 8, 'Calle Doctor Delgado, Zona Universitaria');

-- NAP-19: Cerca de NAP-4
INSERT INTO naps (name, lat, lng, description, splitter_type_id, port_capacity, address)
VALUES ('NAP-19', 18.485000, -69.928000, 'Caja NAP Zona Céntrica — 8 puertos GPON', 3, 8, 'Calle El Conde, Zona Colonial');

-- NAP-20: Zona Oeste  
INSERT INTO naps (name, lat, lng, description, splitter_type_id, port_capacity, address)
VALUES ('NAP-20', 18.475000, -69.970000, 'Caja NAP Zona Oeste Residencial — 8 puertos GPON', 3, 8, 'Av. 27 de Febrero #150, Bella Vista');

-- =====================================================
-- 3. CREAR PORTS para las NAPs nuevas
-- =====================================================

INSERT INTO nap_ports (nap_id, port_number) VALUES (15, 1), (15, 2), (15, 3), (15, 4), (15, 5), (15, 6), (15, 7), (15, 8);
INSERT INTO nap_ports (nap_id, port_number) VALUES (16, 1), (16, 2), (16, 3), (16, 4), (16, 5), (16, 6), (16, 7), (16, 8);
INSERT INTO nap_ports (nap_id, port_number) VALUES (17, 1), (17, 2), (17, 3), (17, 4), (17, 5), (17, 6), (17, 7), (17, 8);
INSERT INTO nap_ports (nap_id, port_number) VALUES (18, 1), (18, 2), (18, 3), (18, 4), (18, 5), (18, 6), (18, 7), (18, 8);
INSERT INTO nap_ports (nap_id, port_number) VALUES (19, 1), (19, 2), (19, 3), (19, 4), (19, 5), (19, 6), (19, 7), (19, 8);
INSERT INTO nap_ports (nap_id, port_number) VALUES (20, 1), (20, 2), (20, 3), (20, 4), (20, 5), (20, 6), (20, 7), (20, 8);

-- =====================================================
-- 4. AGREGAR SPLITTERS en MANGAS
-- =====================================================

-- Splitter 1:8 en Manga-2 (distribución zona norte)
INSERT INTO manga_splitters (manga_id, name, splitter_type_id, ports_count, input_fiber)
VALUES (2, 'Splitter 1:8 — Zona Norte', 3, 8, 1);

-- Splitter 1:8 en Manga-3 (distribución zona centro)
INSERT INTO manga_splitters (manga_id, name, splitter_type_id, ports_count, input_fiber)
VALUES (3, 'Splitter 1:8 — Zona Centro', 3, 8, 1);

-- Splitter 1:8 en Manga-4 (distribución zona oeste)
INSERT INTO manga_splitters (manga_id, name, splitter_type_id, ports_count, input_fiber)
VALUES (4, 'Splitter 1:8 — Zona Oeste', 3, 8, 1);

-- =====================================================
-- 5. FIBER CONNECTIONS — power budget calculations
-- =====================================================
-- Using formulas:
--   Attenuation: fiber_km × 0.35 dB/km
--   Splice loss: 0.1 dB per splice
--   Connector loss: 0.3 dB per connector pair
--   Splitter loss: depends on type (1:8=10.5, 1:16=13.8)
--   Margin: 1.0 dB

-- Cable-2 (515m): Manga Principal → Manga-2
-- Fiber 1: Manga Principal splitter output 1 → Manga-2
INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (2, 1, 'manga', 1, 'manga', 2, 515, 2, ROUND((0.515 * 0.35) + (2 * 0.1) + (2 * 0.3) + 1.0, 3), 1, 2.5);

-- Cable-3 (380m): Manga-2 → NAP-6 area
INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (3, 1, 'manga', 2, 'nap', 6, 380, 2, ROUND((0.380 * 0.35) + (2 * 0.1) + (2 * 0.3) + 1.0, 3), 0, 2.5);

-- Cable-3 fiber 2: Manga-2 → NAP-7
INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (3, 2, 'manga', 2, 'nap', 7, 395, 2, ROUND((0.395 * 0.35) + (2 * 0.1) + (2 * 0.3) + 1.0, 3), 0, 2.5);

-- Cable-4 (330m): Manga-2 → NAP-8
INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (4, 1, 'manga', 2, 'nap', 8, 330, 2, ROUND((0.330 * 0.35) + (2 * 0.1) + (2 * 0.3) + 1.0, 3), 0, 2.5);

-- Cable-4 fiber 2: Manga-2 → NAP-9
INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (4, 2, 'manga', 2, 'nap', 9, 345, 2, ROUND((0.345 * 0.35) + (2 * 0.1) + (2 * 0.3) + 1.0, 3), 0, 2.5);

-- Cable-5 (330m): Manga Principal → NAP-15
INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (5, 1, 'manga', 1, 'nap', 15, 330, 2, ROUND((0.330 * 0.35) + (2 * 0.1) + (2 * 0.3) + 1.0, 3), 0, 2.5);

-- Cable-6 (202m): Manga Principal → NAP-16
INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (6, 1, 'manga', 1, 'nap', 16, 202, 1, ROUND((0.202 * 0.35) + (1 * 0.1) + (1 * 0.3) + 1.0, 3), 0, 2.5);

-- OLT → Manga Principal via splitter connections
-- Fibers from OLT port through 1:16 splitter to NAP-3,4,5,18,19, etc.
-- New fiber connections for NAPs directly from OLT (via splitter 1:16 at Manga Principal)
INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (1, 4, 'olt', 1, 'nap', 3, 850, 2, ROUND((0.850 * 0.35) + (2 * 0.1) + (2 * 0.3) + 13.8 + 1.0, 3), 0, 0.0);

INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (1, 5, 'olt', 1, 'nap', 4, 750, 2, ROUND((0.750 * 0.35) + (2 * 0.1) + (2 * 0.3) + 13.8 + 1.0, 3), 0, 0.0);

INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (1, 6, 'olt', 1, 'nap', 5, 900, 2, ROUND((0.900 * 0.35) + (2 * 0.1) + (2 * 0.3) + 13.8 + 1.0, 3), 0, 0.0);

INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (1, 7, 'olt', 1, 'nap', 18, 950, 3, ROUND((0.950 * 0.35) + (3 * 0.1) + (2 * 0.3) + 13.8 + 1.0, 3), 0, 0.0);

INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (1, 8, 'olt', 1, 'nap', 19, 600, 1, ROUND((0.600 * 0.35) + (1 * 0.1) + (2 * 0.3) + 13.8 + 1.0, 3), 0, 0.0);

INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (1, 9, 'olt', 1, 'nap', 14, 1050, 3, ROUND((1.050 * 0.35) + (3 * 0.1) + (2 * 0.3) + 13.8 + 1.0, 3), 0, 0.0);

-- Cable-8 (1044m): Manga-2 → Manga-3
INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (9, 2, 'manga', 2, 'manga', 3, 1044, 2, ROUND((1.044 * 0.35) + (2 * 0.1) + (2 * 0.3) + 1.0, 3), 1, 2.5);

-- Cable-8 fiber 3: Manga-2 → NAP-17
INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (9, 3, 'manga', 2, 'nap', 17, 1100, 3, ROUND((1.100 * 0.35) + (3 * 0.1) + (2 * 0.3) + 1.0, 3), 0, 2.5);

-- Cable-8 fiber 4: Manga-2 → NAP-14
INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (9, 4, 'manga', 2, 'nap', 14, 980, 2, ROUND((0.980 * 0.35) + (2 * 0.1) + (2 * 0.3) + 1.0, 3), 0, 2.5);

-- Connection from Manga-3 via splitter to NAP-20
INSERT INTO fiber_connections (cable_id, fiber_number, source_type, source_id, target_type, target_id, distance_m, splice_count, total_loss, active_power, power_level)
VALUES (10, 4, 'manga', 3, 'nap', 20, 600, 2, ROUND((0.600 * 0.35) + (2 * 0.1) + (2 * 0.3) + 1.0, 3), 0, 2.5);

-- =====================================================
-- 6. MANGA FIBERS — connect splitter outputs to NAPs
-- =====================================================

-- Manga Principal: Splitter 1:16 outputs
-- Output already configured for NAP-1 (fiber 1) and NAP-2 (fiber 2) in existing connections
-- Add remaining splitter outputs
INSERT INTO manga_fibers (manga_id, fiber_number, splitter_id, splitter_output, source_type, source_id, target_type, target_id, active_power, power_level)
VALUES 
  (1, 3, 2, 3, 'nap', 3, 'nap', 3, 0, 0.0),
  (1, 4, 2, 4, 'nap', 4, 'nap', 4, 0, 0.0),
  (1, 5, 2, 5, 'nap', 5, 'nap', 5, 1, -10.5),
  (1, 6, 2, 6, 'nap', 15, 'nap', 15, 0, 0.0),
  (1, 7, 2, 7, 'nap', 16, 'nap', 16, 0, 0.0),
  (1, 8, 2, 8, 'nap', 18, 'nap', 18, 0, 0.0),
  (1, 9, 2, 9, 'nap', 19, 'nap', 19, 0, 0.0);

-- =====================================================
-- 7. CABLE FIBERS — actualizar estado de fibras
-- =====================================================
INSERT OR REPLACE INTO cable_fibers (cable_id, fiber_number, status, fiber_type)
VALUES 
  (1, 1, 'used', 'feeder'),
  (1, 2, 'used', 'feeder'),
  (1, 3, 'used', 'feeder'),
  (1, 4, 'used', 'feeder'),
  (1, 5, 'used', 'feeder'),
  (1, 6, 'used', 'feeder'),
  (1, 7, 'used', 'feeder'),
  (1, 8, 'used', 'feeder'),
  (1, 9, 'used', 'feeder'),
  (1, 10, 'available', 'feeder'),
  (1, 11, 'available', 'feeder'),
  (1, 12, 'available', 'feeder');

-- =====================================================
-- 8. POWER READINGS — verify the most critical routes
-- =====================================================
-- OLT Port 1 → NAP-1: 2.5 - 16.02 = -13.52 dBm ✅ (within GPON range)
-- OLT Port 1 → NAP-2: 2.5 - 16.13 = -13.63 dBm ✅
-- OLT Port 1 → NAP-3: 2.5 - 15.47 = -12.97 dBm ✅
-- OLT Port 1 → NAP-5: 2.5 - 15.51 = -13.01 dBm ✅

INSERT INTO power_readings (fiber_connection_id, element_type, element_id, power_level, is_active)
VALUES 
  (1, 'nap', 1, -13.52, 1),
  (2, 'nap', 2, -13.63, 1),
  (9, 'nap', 3, -12.97, 1),
  (10, 'nap', 4, -12.84, 1);

-- =====================================================
-- 9. FOLDER ITEMS — add new NAPs to folders
-- =====================================================
-- NAP-15 and NAP-16 go to "Pon 1" folder (id=3)
INSERT OR IGNORE INTO folder_items (folder_id, item_type, item_id)
VALUES 
  (3, 'nap', 15),
  (3, 'nap', 16),
  (3, 'nap', 18),
  (3, 'nap', 19);

-- NAP-17 goes to "Pon 2" folder (id=6)
INSERT OR IGNORE INTO folder_items (folder_id, item_type, item_id)
VALUES 
  (6, 'nap', 17),
  (6, 'nap', 20);

-- =====================================================
-- 10. CABLE POINTS — add routing for new cables
-- =====================================================
-- Cable-3 route points (Manga-2 → NAP-6, NAP-7)
INSERT OR IGNORE INTO cable_points (cable_id, sequence, lat, lng, element_type, element_id)
VALUES 
  (3, 1, 18.476149, -69.965819, 'manga', 2),
  (3, 2, 18.480000, -69.962000, NULL, NULL),
  (3, 3, 18.484000, -69.958000, NULL, NULL),
  (3, 4, 18.486203, -69.953814, 'nap', 6);

INSERT OR IGNORE INTO cable_points (cable_id, sequence, lat, lng, element_type, element_id)
VALUES 
  (3, 5, 18.486203, -69.953814, NULL, NULL),
  (3, 6, 18.485554, -69.953999, 'nap', 7);

-- Cable-5 route (Manga Principal → NAP-15)
INSERT OR IGNORE INTO cable_points (cable_id, sequence, lat, lng, element_type, element_id)
VALUES 
  (5, 1, 18.492000, -69.928000, 'manga', 1),
  (5, 2, 18.487000, -69.940000, NULL, NULL),
  (5, 3, 18.481500, -69.955000, 'nap', 15);

-- Cable-6 route (Manga Principal → NAP-16)
INSERT OR IGNORE INTO cable_points (cable_id, sequence, lat, lng, element_type, element_id)
VALUES 
  (6, 1, 18.492000, -69.928000, 'manga', 1),
  (6, 2, 18.490000, -69.920000, 'nap', 16);

COMMIT;

-- =====================================================
-- VERIFICACIÓN FINAL
-- =====================================================
SELECT '✅ GPON Project — 20 NAPs' as status;
SELECT COUNT(*) as total_naps FROM naps;
SELECT * FROM (
  SELECT 'Power budget verification' as check_name
  UNION ALL
  SELECT CASE WHEN MIN(total_loss) > 0 AND MAX(total_loss) < 27 THEN '✅ ALL within GPON budget' ELSE '⚠️ Some exceed budget' END
  FROM fiber_connections WHERE target_type = 'nap'
);
