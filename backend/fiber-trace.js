const express = require('express');
const db = require('./database');
const router = express.Router();

// ========== TRAZAR RUTA DE UN HILO desde un puerto OLT ==========
// La fibra es el cascarón. El hilo es lo que lleva la potencia.
// Un cable (fibra) contiene N hilos. Los hilos se fusionan entre cables en mangas.
// Este endpoint sigue un hilo desde el puerto OLT a través de todas sus fusiones.
router.get('/hilo-trace', (req, res) => {
  const { olt_port_id } = req.query;
  if (!olt_port_id) return res.status(400).json({ error: 'Se requiere olt_port_id' });

  const port = db.prepare('SELECT * FROM olt_ports WHERE id=?').get(olt_port_id);
  if (!port) return res.status(404).json({ error: 'Puerto OLT no encontrado' });

  const hasPower = port.operational_status === 'Online' || (port.power && port.power > 0);
  const powerLevel = port.power || 0;

  // Buscar conexión del puerto OLT → hilo en un cable
  const conn = db.prepare(`
    SELECT fc.*, c.name as cable_name
    FROM fiber_connections fc
    LEFT JOIN cables c ON c.id = fc.cable_id
    WHERE fc.source_olt_port_id = ?
  `).get(olt_port_id);

  if (!conn) {
    return res.json({
      puerto_olt: { id: port.id, numero: port.port_number, potencia: port.power },
      tiene_potencia: hasPower,
      nivel_db: powerLevel,
      hilos: [],
      total_segmentos: 0,
      mensaje: 'Puerto OLT sin hilo conectado'
    });
  }

  // Hilo inicial: Puerto OLT → Cable X / Hilo #N
  const hilos = [{
    tipo: 'olt_a_fibra',
    fibra_id: conn.cable_id,
    fibra_nombre: conn.cable_name || 'Cable #' + conn.cable_id,
    hilo_numero: conn.fiber_number,
    conexion_id: conn.id
  }];

  // Seguir el hilo a través de fusiones en mangas
  const visitados = new Set();

  function seguirHilo(fibraId, hiloNum) {
    const key = fibraId + ':' + hiloNum;
    if (visitados.has(key)) return;
    visitados.add(key);

    // Buscar fusiones donde este hilo aparezca (lado izquierdo o derecho)
    const fusiones = db.prepare(`
      SELECT fs.*, 
        m.name as manga_nombre,
        c_origen.name as fibra_origen_nombre,
        c_destino.name as fibra_destino_nombre
      FROM fiber_splices fs
      LEFT JOIN mangas m ON m.id = fs.manga_id
      LEFT JOIN cables c_origen ON c_origen.id = fs.left_id
      LEFT JOIN cables c_destino ON c_destino.id = fs.right_id
      WHERE (fs.left_type = 'cable' AND fs.left_id = ? AND fs.left_fiber_number = ?)
         OR (fs.right_type = 'cable' AND fs.right_id = ? AND fs.right_fiber_number = ?)
    `).all(fibraId, hiloNum, fibraId, hiloNum);

    for (const fusion of fusiones) {
      const estaALaIzquierda = (fusion.left_type === 'cable' && fusion.left_id === fibraId && fusion.left_fiber_number === hiloNum);
      const sigFibraId = estaALaIzquierda ? fusion.right_id : fusion.left_id;
      const sigHiloNum = estaALaIzquierda ? fusion.right_fiber_number : fusion.left_fiber_number;
      const sigFibraNombre = estaALaIzquierda ? (fusion.fibra_destino_nombre || 'Cable #' + sigFibraId) : (fusion.fibra_origen_nombre || 'Cable #' + sigFibraId);

      hilos.push({
        tipo: 'fusion',
        fusion_id: fusion.id,
        manga_id: fusion.manga_id,
        manga_nombre: fusion.manga_nombre || 'Manga #' + fusion.manga_id,
        desde_fibra_id: fibraId,
        desde_fibra: fusion.fibra_origen_nombre || 'Cable #' + fibraId,
        desde_hilo: hiloNum,
        hacia_fibra_id: sigFibraId,
        hacia_fibra: sigFibraNombre,
        hacia_hilo: sigHiloNum,
        perdida_db: fusion.loss_db
      });

      seguirHilo(sigFibraId, sigHiloNum);
    }

    // Buscar si este hilo llega a un puerto NAP
    const napsConectados = db.prepare(`
      SELECT np.*, n.name as nap_nombre, n.lat as nap_lat, n.lng as nap_lng
      FROM nap_ports np
      JOIN naps n ON n.id = np.nap_id
      WHERE np.fiber_number = ? AND np.nap_id IN (
        SELECT element_id FROM cable_points 
        WHERE cable_id = ? AND element_type = 'nap'
      )
    `).all(hiloNum, fibraId);

    for (const nap of napsConectados) {
      hilos.push({
        tipo: 'hacia_nap',
        nap_puerto_id: nap.id,
        nap_id: nap.nap_id,
        nap_nombre: nap.nap_nombre,
        nap_lat: nap.nap_lat,
        nap_lng: nap.nap_lng,
        hilo_numero: hiloNum,
        cliente: nap.client_name
      });
    }
  }

  seguirHilo(conn.cable_id, conn.fiber_number);

  res.json({
    puerto_olt: {
      id: port.id,
      numero: port.port_number,
      potencia: port.power,
      estado: port.operational_status
    },
    tiene_potencia: hasPower,
    nivel_db: powerLevel,
    conexion_inicial: {
      fibra_id: conn.cable_id,
      fibra_nombre: conn.cable_name || 'Cable #' + conn.cable_id,
      hilo_numero: conn.fiber_number
    },
    hilos: hilos,
    total_segmentos: hilos.length
  });
});

// ========== TRAZAR TODOS LOS HILOS ACTIVOS DE UNA OLT ==========
// Busca todos los puertos OLT que tienen potencia + conexión y traza sus hilos
router.get('/:id/hilos-activos', (req, res) => {
  const oltId = req.params.id;

  const puertosActivos = db.prepare(`
    SELECT p.*, fc.id as conn_id, fc.cable_id, fc.fiber_number, c.name as cable_name
    FROM olt_ports p
    JOIN fiber_connections fc ON fc.source_olt_port_id = p.id
    LEFT JOIN cables c ON c.id = fc.cable_id
    WHERE p.olt_id = ? AND (p.operational_status = 'Online' OR (p.power IS NOT NULL AND p.power > 0))
  `).all(oltId);

  const trazas = [];

  for (const puerto of puertosActivos) {
    const conn = db.prepare('SELECT * FROM fiber_connections WHERE id=?').get(puerto.conn_id);
    if (!conn) continue;

    const segmentos = [{
      tipo: 'olt_a_fibra',
      fibra_id: conn.cable_id,
      fibra_nombre: puerto.cable_name || 'Cable #' + conn.cable_id,
      hilo_numero: conn.fiber_number,
      conexion_id: conn.id,
      puerto_olt_id: puerto.id,
      puerto_olt_numero: puerto.port_number
    }];

    const visitados = new Set();
    function seguir(fibraId, hiloNum) {
      const key = fibraId + ':' + hiloNum;
      if (visitados.has(key)) return;
      visitados.add(key);

      const fusiones = db.prepare(`
        SELECT fs.*, m.name as manga_nombre,
          c_origen.name as fibra_origen_nombre,
          c_destino.name as fibra_destino_nombre
        FROM fiber_splices fs
        LEFT JOIN mangas m ON m.id = fs.manga_id
        LEFT JOIN cables c_origen ON c_origen.id = fs.left_id
        LEFT JOIN cables c_destino ON c_destino.id = fs.right_id
        WHERE (fs.left_type='cable' AND fs.left_id=? AND fs.left_fiber_number=?)
           OR (fs.right_type='cable' AND fs.right_id=? AND fs.right_fiber_number=?)
      `).all(fibraId, hiloNum, fibraId, hiloNum);

      for (const f of fusiones) {
        const esIzquierda = (f.left_type === 'cable' && f.left_id === fibraId && f.left_fiber_number === hiloNum);
        const sigFibra = esIzquierda ? f.right_id : f.left_id;
        const sigHilo = esIzquierda ? f.right_fiber_number : f.left_fiber_number;
        const sigNombre = esIzquierda ? (f.fibra_destino_nombre || 'Cable #' + sigFibra) : (f.fibra_origen_nombre || 'Cable #' + sigFibra);

        segmentos.push({
          tipo: 'fusion',
          fusion_id: f.id,
          manga_id: f.manga_id,
          manga_nombre: f.manga_nombre || 'Manga #' + f.manga_id,
          desde_fibra_id: fibraId,
          desde_hilo: hiloNum,
          hacia_fibra_id: sigFibra,
          hacia_fibra: sigNombre,
          hacia_hilo: sigHilo,
          perdida_db: f.loss_db
        });
        seguir(sigFibra, sigHilo);
      }
    }

    seguir(conn.cable_id, conn.fiber_number);

    trazas.push({
      puerto_olt_id: puerto.id,
      puerto_olt_numero: puerto.port_number,
      potencia: puerto.power,
      segmentos
    });
  }

  res.json({ trazas });
});

// ========== HILOS CON POTENCIA: solo los hilos fuente desde OLT ==========
// Devuelve SOLO los hilos conectados DIRECTAMENTE a puertos OLT con potencia.
// Los hilos que heredan potencia a traves de fusiones NO se marcan como fuente.
// Las fusiones se animan mediante el campo 'segmentos' en las trazas.
router.get('/hilos-con-potencia', (req, res) => {
  // 1. Buscar todos los puertos OLT con potencia + conexión directa
  const fuentes = db.prepare(`
    SELECT p.id, p.olt_id, p.port_number, p.power,
      fc.cable_id, fc.fiber_number, o.name as olt_name,
      fc.id as conn_id
    FROM olt_ports p
    JOIN fiber_connections fc ON fc.source_olt_port_id = p.id
    JOIN olts o ON o.id = p.olt_id
    WHERE p.operational_status = 'Online' OR (p.power IS NOT NULL AND p.power > 0)
  `).all();

  if (fuentes.length === 0) {
    return res.json({ fuentes: [], segmentos: [] });
  }

  // 2. Hilos fuente (directamente desde OLT)
  const hilosFuente = fuentes.map(f => ({
    fibra_id: f.cable_id,
    hilo_numero: f.fiber_number,
    potencia: f.power,
    origen: f.olt_name + ' P' + f.port_number
  }));

  // 3. Trazar cada fuente: CAMINAR LA SECUENCIA DE PUNTOS DEL CABLE
  // ⭐ Fix: caminamos los cable_points en orden de sequence desde el extremo
  // de la OLT. En NAPs: si no hay fusion → hilo cortado (no continua).
  // En mangas/splitters: siempre pasan (la fibra es continua en el mismo cable).
  // Tambien seguimos SPLICES para cruces cable → manga_fiber → splitter → cable.
  const visitadosPuntos = new Set(); // "cable_point_id:fiber_number"
  const todosSegmentos = [];

  for (const fuente of fuentes) {
    const cableId = fuente.cable_id;
    const fiberNum = fuente.fiber_number;

    // Obtener todos los cable_points de este cable, ordenados por sequence
    var cablePuntos = db.prepare(`
      SELECT cp.id, cp.sequence, cp.element_type, cp.element_id
      FROM cable_points cp
      WHERE cp.cable_id = ?
      ORDER BY cp.sequence ASC
    `).all(cableId);

    if (cablePuntos.length === 0) continue;

    // Encontrar el indice del punto OLT
    var idxOLT = -1;
    for (var pi = 0; pi < cablePuntos.length; pi++) {
      if (cablePuntos[pi].element_type === 'olt') { idxOLT = pi; break; }
    }
    if (idxOLT === -1) continue; // Sin OLT, no hay origen de potencia

    // La potencia fluye desde la OLT hacia afuera.
    // Detectar direccion: OLT al inicio → forward; OLT al final → backward
    // Usar slice().reverse() para caminar hacia atras si es necesario
    var pts = idxOLT <= cablePuntos.length / 2
      ? cablePuntos
      : cablePuntos.slice().reverse().map(function(p) { return p; });
    var startIdx = idxOLT <= cablePuntos.length / 2
      ? idxOLT
      : cablePuntos.length - 1 - idxOLT;

    for (var pi = startIdx; pi < pts.length; pi++) {
      var punto = pts[pi];
      var puntoKey = punto.id + ':' + fiberNum;

      // Ya visitado (posiblemente desde otro cable)? Saltar
      if (visitadosPuntos.has(puntoKey)) continue;

      // Punto OLT → origen de potencia, siguiente punto
      if (punto.element_type === 'olt') { visitadosPuntos.add(puntoKey); continue; }

      // Punto NAP: verificar fusion. Sin fusion = hilo cortado.
      if (punto.element_type === 'nap') {
        // Verificar que el NAP realmente exista (no sea un punto huerfano)
        if (punto.element_id) {
          var napExiste = db.prepare('SELECT id FROM naps WHERE id=?').get(punto.element_id);
          if (!napExiste) {
            // NAP eliminado: tratar como punto de ruteo (la fibra pasa)
            visitadosPuntos.add(puntoKey);
            continue;
          }
        }

        // Buscar fusion en AMBAS direcciones (IN→OUT y OUT→IN)
        var fusionNAP = db.prepare(`
          SELECT f.*, cp_out.cable_id as cable_out
          FROM fusions f
          JOIN cable_points cp_out ON cp_out.id = f.cable_connection_id_out
          WHERE f.cable_connection_id_in = ? AND f.fiber_in = ?
        `).get(punto.id, fiberNum);

        if (!fusionNAP) {
          // Buscar fusion REVERSA (este punto es OUT, buscar IN)
          fusionNAP = db.prepare(`
            SELECT f.*, cp_in.cable_id as cable_out
            FROM fusions f
            JOIN cable_points cp_in ON cp_in.id = f.cable_connection_id_in
            WHERE f.cable_connection_id_out = ? AND f.fiber_out = ?
          `).get(punto.id, fiberNum);
        }

        if (!fusionNAP) {
          // ⛔ Hilo cortado en este NAP. Potencia llega hasta AQUI pero no continua.
          visitadosPuntos.add(puntoKey);
          break;
        }

        // ✅ Hilo pasa: marcar el otro lado de la fusion
        var otroLadoId = (fusionNAP.cable_connection_id_in === punto.id)
          ? fusionNAP.cable_connection_id_out
          : fusionNAP.cable_connection_id_in;
        visitadosPuntos.add(puntoKey);
        visitadosPuntos.add(otroLadoId + ':' + fiberNum);

        // Si la fusion va a OTRO cable, seguirlo
        if (fusionNAP.cable_out && fusionNAP.cable_out !== cableId) {
          propagarEnOtroCable(fusionNAP.cable_out, fusionNAP.fiber_out, otroLadoId);
          // Al cruzar a otro cable, la fibra sale de este
          break;
        }
        continue;
      }

      // Punto MANGA: verificar fusion igual que NAP. Sin fusion = hilo cortado.
      if (punto.element_type === 'manga' && punto.element_id) {
        // Verificar que la manga exista (no sea huerfana)
        var mExiste = db.prepare('SELECT id FROM mangas WHERE id=?').get(punto.element_id);
        if (mExiste) {
          // Manga existe → verificar fusion (igual que NAP)
          var fwd = db.prepare(`
            SELECT f.*, cp_out.cable_id as cable_out
            FROM fusions f
            JOIN cable_points cp_out ON cp_out.id = f.cable_connection_id_out
            WHERE f.cable_connection_id_in = ? AND f.fiber_in = ?
          `).get(punto.id, fiberNum);
          if (!fwd) {
            fwd = db.prepare(`
              SELECT f.*, cp_in.cable_id as cable_out
              FROM fusions f
              JOIN cable_points cp_in ON cp_in.id = f.cable_connection_id_in
              WHERE f.cable_connection_id_out = ? AND f.fiber_out = ?
            `).get(punto.id, fiberNum);
          }

          if (!fwd) {
            // Sin fusion: verificar si hay SPLICE (splitter) antes de asumir corte
            var spliceCheck = db.prepare(`
              SELECT s.* FROM splices s
              WHERE ((s.fiber_a_type='cable_fiber' AND s.fiber_a_id=? AND s.fiber_a_port=?)
                 OR (s.fiber_b_type='cable_fiber' AND s.fiber_b_id=? AND s.fiber_b_port=?))
              LIMIT 1
            `).get(punto.id, fiberNum, punto.id, fiberNum);
            if (!spliceCheck) {
              // ⛔ Sin fusion Y sin splice → hilo CORTADO
              // Si antes habia una fusion y se elimino, el corte detiene la potencia.
              // Las fibras pasantes se crean con fusiones auto al insertar la manga,
              // asi que si no hay fusion es porque el usuario la corto.
              visitadosPuntos.add(puntoKey);
              break;
            }
            // Hay splice → marcar punto, la seccion de ruteo manejara la continuacion
            visitadosPuntos.add(puntoKey);
          } else {
            // ✅ Fusion existe → marcar el otro lado
            var otroLadoId = (fwd.cable_connection_id_in === punto.id)
              ? fwd.cable_connection_id_out
              : fwd.cable_connection_id_in;
            visitadosPuntos.add(puntoKey);
            visitadosPuntos.add(otroLadoId + ':' + fiberNum);

            // Si va a OTRO cable, seguirlo
            if (fwd.cable_out && fwd.cable_out !== cableId) {
              propagarEnOtroCable(fwd.cable_out, fwd.fiber_out, otroLadoId);
              // NO hacer break: la manga es un punto de paso, el cable CONTINUA
            }
            continue;
          }
        }
      }

      // Punto de ruteo, manga huerfana: marcar potencia
      visitadosPuntos.add(puntoKey);
      // verificar si hay SPLICE a splitter
      var splice = db.prepare(`
        SELECT s.* FROM splices s
        WHERE ((s.fiber_a_type='cable_fiber' AND s.fiber_a_id=? AND s.fiber_a_port=?)
           OR (s.fiber_b_type='cable_fiber' AND s.fiber_b_id=? AND s.fiber_b_port=?))
        LIMIT 1
      `).get(punto.id, fiberNum, punto.id, fiberNum);

      if (splice) {
        seguirSplice(splice, punto.id, fiberNum, cableId);
      }

      // La fibra continua por el cable (punto de ruteo o manga huerfana)
    }
  }

  function propagarEnOtroCable(cableIdDest, fNumDest, desdePuntoId) {
    var destPuntos = db.prepare(`
      SELECT cp.id, cp.sequence, cp.element_type, cp.element_id
      FROM cable_points cp WHERE cp.cable_id = ? ORDER BY cp.sequence ASC
    `).all(cableIdDest);
    if (destPuntos.length === 0) return;

    // Encontrar el punto de entrada y caminar en AMBAS direcciones
    var idxEntrada = 0;
    if (desdePuntoId) {
      for (var dpi = 0; dpi < destPuntos.length; dpi++) {
        if (destPuntos[dpi].id === desdePuntoId) { idxEntrada = dpi; break; }
      }
    }

    function caminarPuntos(desdeIdx, direccion) {
      for (var dpi = desdeIdx; dpi >= 0 && dpi < destPuntos.length; dpi += direccion) {
        var dp = destPuntos[dpi];
        var dpKey = dp.id + ':' + fNumDest;
        if (visitadosPuntos.has(dpKey)) continue;

        // ⭐ NO marcar dpKey al inicio — se marca SOLO dentro del branch
        // correspondiente despues de verificar la condicion de corte.

        if (dp.element_type === 'olt') {
          visitadosPuntos.add(dpKey);
          continue;
        }

        if (dp.element_type === 'nap') {
          // Verificar que el NAP exista (no sea huerfano)
          if (dp.element_id) {
            var napEx = db.prepare('SELECT id FROM naps WHERE id=?').get(dp.element_id);
            if (!napEx) {
              visitadosPuntos.add(dpKey);
              continue; // NAP eliminado, tratar como pasante
            }
          }
          // Buscar fusion: forward (este punto es IN) o reverse (este punto es OUT)
          var fwd = db.prepare(`
            SELECT f.id, f.cable_connection_id_in as pIn, f.cable_connection_id_out as pOut, f.fiber_in as fIn, f.fiber_out as fOut, cp_out.cable_id as cable_out, f.loss_db
            FROM fusions f
            JOIN cable_points cp_out ON cp_out.id = f.cable_connection_id_out
            WHERE f.cable_connection_id_in = ? AND f.fiber_in = ?
          `).get(dp.id, fNumDest);
          if (!fwd) {
            fwd = db.prepare(`
              SELECT f.id, f.cable_connection_id_in as pIn, f.cable_connection_id_out as pOut, f.fiber_in as fIn, f.fiber_out as fOut, cp_in.cable_id as cable_out, f.loss_db
              FROM fusions f
              JOIN cable_points cp_in ON cp_in.id = f.cable_connection_id_in
              WHERE f.cable_connection_id_out = ? AND f.fiber_out = ?
            `).get(dp.id, fNumDest);
          }
          if (!fwd) {
            // ⛔ Cortado en NAP. NO marcamos este punto.
            break;
          }
          // ✅ Fusion existe → marcar ESTE punto y el OTRO LADO
          visitadosPuntos.add(dpKey);
          var otroPunto = (fwd.pIn === dp.id) ? fwd.pOut : fwd.pIn;
          var otroFibra = (fwd.pIn === dp.id) ? fwd.fOut : fwd.fIn;
          visitadosPuntos.add(otroPunto + ':' + otroFibra);
          if (fwd.cable_out && fwd.cable_out !== cableIdDest) {
            propagarEnOtroCable(fwd.cable_out, fwd.fOut, otroPunto);
          }
        } else if (dp.element_type === 'manga' && dp.element_id) {
          // Punto MANGA: verificar fusion (igual que NAP)
          var mEx = db.prepare('SELECT id FROM mangas WHERE id=?').get(dp.element_id);
          if (mEx) {
            var fwd2 = db.prepare(`
              SELECT f.*, cp_out.cable_id as cable_out
              FROM fusions f
              JOIN cable_points cp_out ON cp_out.id = f.cable_connection_id_out
              WHERE f.cable_connection_id_in = ? AND f.fiber_in = ?
            `).get(dp.id, fNumDest);
            if (!fwd2) {
              fwd2 = db.prepare(`
                SELECT f.*, cp_in.cable_id as cable_out
                FROM fusions f
                JOIN cable_points cp_in ON cp_in.id = f.cable_connection_id_in
                WHERE f.cable_connection_id_out = ? AND f.fiber_out = ?
              `).get(dp.id, fNumDest);
            }
            if (!fwd2) {
              // Sin fusion: verificar si hay splice antes de asumir corte
              var spAntes = db.prepare(`
                SELECT s.* FROM splices s
                WHERE ((s.fiber_a_type='cable_fiber' AND s.fiber_a_id=? AND s.fiber_a_port=?)
                   OR (s.fiber_b_type='cable_fiber' AND s.fiber_b_id=? AND s.fiber_b_port=?))
                LIMIT 1
              `).get(dp.id, fNumDest, dp.id, fNumDest);
              if (!spAntes) {
                // ⛔ Sin fusion Y sin splice → hilo cortado
                visitadosPuntos.add(dpKey);
                break;
              }
              // Hay splice: marcar punto y seguir — saltar fusion-specific code
              visitadosPuntos.add(dpKey);
            } else {
              // Hay fusion: marcar ambos lados
              visitadosPuntos.add(dpKey);
              var otroL = (fwd2.cable_connection_id_in === dp.id) ? fwd2.cable_connection_id_out : fwd2.cable_connection_id_in;
              visitadosPuntos.add(otroL + ':' + fNumDest);
              if (fwd2.cable_out && fwd2.cable_out !== cableIdDest) {
                propagarEnOtroCable(fwd2.cable_out, fwd2.fiber_out, otroL);
                // NO break: la manga es paso, el cable continua
              }
            }
          } else {
            visitadosPuntos.add(dpKey); // Manga huerfana: pasante
          }
          var sp2 = db.prepare(`
            SELECT s.* FROM splices s
            WHERE ((s.fiber_a_type='cable_fiber' AND s.fiber_a_id=? AND s.fiber_a_port=?)
               OR (s.fiber_b_type='cable_fiber' AND s.fiber_b_id=? AND s.fiber_b_port=?))
            LIMIT 1
          `).get(dp.id, fNumDest, dp.id, fNumDest);
          if (sp2) seguirSplice(sp2, dp.id, fNumDest, cableIdDest);
        } else {
          // Punto de ruteo: la fibra es continua
          visitadosPuntos.add(dpKey);
          var fwd3 = db.prepare(`
            SELECT f.id, f.cable_connection_id_out, f.fiber_out, cp_out.cable_id as cable_out
            FROM fusions f
            JOIN cable_points cp_out ON cp_out.id = f.cable_connection_id_out
            WHERE f.cable_connection_id_in = ? AND f.fiber_in = ? AND cp_out.cable_id != ?
          `).get(dp.id, fNumDest, cableIdDest);
          if (fwd3 && fwd3.cable_out) {
            visitadosPuntos.add(fwd3.cable_connection_id_out + ':' + fNumDest);
            propagarEnOtroCable(fwd3.cable_out, fwd3.fiber_out, null);
          }
          var sp3 = db.prepare(`
            SELECT s.* FROM splices s
            WHERE ((s.fiber_a_type='cable_fiber' AND s.fiber_a_id=? AND s.fiber_a_port=?)
               OR (s.fiber_b_type='cable_fiber' AND s.fiber_b_id=? AND s.fiber_b_port=?))
            LIMIT 1
          `).get(dp.id, fNumDest, dp.id, fNumDest);
          if (sp3) seguirSplice(sp3, dp.id, fNumDest, cableIdDest);
        }
      }
    }

    // Caminar ambas direcciones desde el punto de entrada
    caminarPuntos(idxEntrada, 1);   // forward (hacia seq mayor)
    if (idxEntrada > 0) {
      caminarPuntos(idxEntrada - 1, -1); // backward (hacia seq menor)
    }
  }

  function seguirSplice(splice, cablePointId, fiberNum, cableIdActual) {
    var mfId = null;
    if (splice.fiber_a_type === 'cable_fiber' && splice.fiber_a_id === cablePointId && splice.fiber_a_port === fiberNum) {
      mfId = splice.fiber_b_id;
    } else if (splice.fiber_b_type === 'cable_fiber' && splice.fiber_b_id === cablePointId && splice.fiber_b_port === fiberNum) {
      mfId = splice.fiber_a_id;
    }
    if (!mfId) return;

    var mf = db.prepare('SELECT * FROM manga_fibers WHERE id=?').get(mfId);
    if (!mf) return;

    if (mf.splitter_id && mf.splitter_output === 0) {
      // SPLITTER INPUT: propagar a todas las salidas
      var outMFs = db.prepare(
        'SELECT * FROM manga_fibers WHERE splitter_id=? AND splitter_output>0'
      ).all(mf.splitter_id);

      for (var omf of outMFs) {
        var spliceOut = db.prepare(`
          SELECT s.* FROM splices s
          WHERE ((s.fiber_a_type='manga_fiber' AND s.fiber_a_id=?)
             OR (s.fiber_b_type='manga_fiber' AND s.fiber_b_id=?))
            AND s.id != ?
          LIMIT 1
        `).get(omf.id, omf.id, splice.id);

        if (spliceOut) {
          var cpOutId = null, cpOutFn = null;
          if (spliceOut.fiber_a_type === 'cable_fiber' && spliceOut.fiber_b_type === 'manga_fiber' && spliceOut.fiber_b_id === omf.id) {
            cpOutId = spliceOut.fiber_a_id; cpOutFn = spliceOut.fiber_a_port;
          } else if (spliceOut.fiber_b_type === 'cable_fiber' && spliceOut.fiber_a_type === 'manga_fiber' && spliceOut.fiber_a_id === omf.id) {
            cpOutId = spliceOut.fiber_b_id; cpOutFn = spliceOut.fiber_b_port;
          }

          if (cpOutId) {
            var cpData = db.prepare('SELECT cable_id FROM cable_points WHERE id=?').get(cpOutId);
            if (cpData) {
              visitadosPuntos.add(cpOutId + ':' + cpOutFn);
              propagarEnOtroCable(cpData.cable_id, cpOutFn, cpOutId);
            }
          }
        }
      }
    } else {
      var spliceFromMF = db.prepare(`
        SELECT s.* FROM splices s
        WHERE ((s.fiber_a_type='manga_fiber' AND s.fiber_a_id=?)
           OR (s.fiber_b_type='manga_fiber' AND s.fiber_b_id=?))
          AND s.id != ?
        LIMIT 1
      `).get(mf.id, mf.id, splice.id);

      if (spliceFromMF) {
        var outCPId = null, outCPFn = null;
        if (spliceFromMF.fiber_a_type === 'cable_fiber' && spliceFromMF.fiber_b_type === 'manga_fiber' && spliceFromMF.fiber_b_id === mf.id) {
          outCPId = spliceFromMF.fiber_a_id; outCPFn = spliceFromMF.fiber_a_port;
        } else if (spliceFromMF.fiber_b_type === 'cable_fiber' && spliceFromMF.fiber_a_type === 'manga_fiber' && spliceFromMF.fiber_a_id === mf.id) {
          outCPId = spliceFromMF.fiber_b_id; outCPFn = spliceFromMF.fiber_b_port;
        }

        if (outCPId) {
          var cpData = db.prepare('SELECT cable_id FROM cable_points WHERE id=?').get(outCPId);
          if (cpData) {
            visitadosPuntos.add(outCPId + ':' + outCPFn);
            propagarEnOtroCable(cpData.cable_id, outCPFn, outCPId);
          }
        }
      }
    }
  }

  // 4. Construir lista de puntos de cable con potencia
  const todosPotencia = [];
  for (const key of visitadosPuntos) {
    const idx = key.indexOf(':');
    const puntoId = parseInt(key.substring(0, idx));
    const fibNum = parseInt(key.substring(idx + 1));
    todosPotencia.push({
      cable_point_id: puntoId,
      fiber_number: fibNum
    });
  }

  // 5. Limpiar manga_fibers.active_power stale (el verdadero bug del frontend)
  // Las manga_fibers mantienen active_power=1 incluso despues de cortar fusiones
  // porque propagatePowerChain las seteo y nunca se limpian.
  // Revisamos cada manga_fiber con active_power=1 y verificamos si su cable_point
  // conectado realmente tiene potencia segun el trace.
  const poweredSet = new Set(visitadosPuntos);
  
  // Obtener todas las manga_fibers con active_power=1
  var mfsConPotencia = db.prepare(`
    SELECT mf.*, s.id as splice_id, s.fiber_a_type as s_fiber_a_type, s.fiber_a_id as s_fiber_a_id,
           s.fiber_a_port as s_fiber_a_port, s.fiber_b_type as s_fiber_b_type,
           s.fiber_b_id as s_fiber_b_id, s.fiber_b_port as s_fiber_b_port
    FROM manga_fibers mf
    LEFT JOIN splices s ON (s.manga_id = mf.manga_id
      AND ((s.fiber_b_type='manga_fiber' AND s.fiber_b_id = mf.id)
        OR (s.fiber_a_type='manga_fiber' AND s.fiber_a_id = mf.id)))
    WHERE mf.active_power = 1 OR mf.splitter_output = 0
  `).all();

  // Agrupar por manga_id para manejar splitters
  var mangasAChequear = {};
  for (var mf of mfsConPotencia) {
    if (!mangasAChequear[mf.manga_id]) mangasAChequear[mf.manga_id] = [];
    mangasAChequear[mf.manga_id].push(mf);
  }

  for (var mangaId of Object.keys(mangasAChequear)) {
    var mfs = mangasAChequear[mangaId];
    var splitterInput = mfs.filter(function(m) { return m.splitter_output === 0 || m.splitter_output === null; })[0];
    
    if (splitterInput) {
      // Este manga tiene splitter. Verificar si el INPUT tiene potencia.
      var inputPowered = false;
      if (splitterInput.splice_id) {
        var cpId = null, cpPort = null;
        if (splitterInput.s_fiber_a_type === 'cable_fiber') { cpId = splitterInput.s_fiber_a_id; cpPort = splitterInput.s_fiber_a_port; }
        else if (splitterInput.s_fiber_b_type === 'cable_fiber') { cpId = splitterInput.s_fiber_b_id; cpPort = splitterInput.s_fiber_b_port; }
        if (cpId) {
          inputPowered = poweredSet.has(cpId + ':' + cpPort);
        }
      }
      
      if (!inputPowered) {
        // Input sin potencia → limpiar TODAS las manga_fibers de este splitter
        var mid = parseInt(mangaId);
        if (splitterInput.splitter_id) {
          // Splitter del sistema manga_splitters
          db.prepare('UPDATE manga_fibers SET active_power=0, power_level=NULL WHERE manga_id=? AND splitter_id=?').run(mid, parseInt(splitterInput.splitter_id));
        } else if (splitterInput.source_type && splitterInput.source_id) {
          // Splitter de NAP (usa source_type/source_id)
          db.prepare('UPDATE manga_fibers SET active_power=0, power_level=NULL WHERE manga_id=? AND source_type=? AND source_id=?').run(mid, splitterInput.source_type, splitterInput.source_id);
        }
      }
      // Si input tiene potencia, las salidas ya tienen active_power=1 (correcto)
    } else {
      // Sin splitter: verificar cada manga_fiber individualmente
      for (var mf of mfs) {
        if (!mf.splice_id) continue;
        var cpId = null, cpPort = null;
        if (mf.s_fiber_a_type === 'cable_fiber') { cpId = mf.s_fiber_a_id; cpPort = mf.s_fiber_a_port; }
        else if (mf.s_fiber_b_type === 'cable_fiber') { cpId = mf.s_fiber_b_id; cpPort = mf.s_fiber_b_port; }
        if (cpId && !poweredSet.has(cpId + ':' + cpPort)) {
          db.prepare('UPDATE manga_fibers SET active_power=0, power_level=NULL WHERE id=?').run(mf.id);
        }
      }
    }
  }

  // Sincronizar fiber_connections.active_power con los puntos traceados
  // PRIMERO: limpiar active_power en cables que ya no tienen potencia
  var cablesEnPotencia = new Set();
  var powerCablePairs = {}; // cable_id -> Set of fiber_numbers
  for (var ppp of todosPotencia) {
    var cableP = db.prepare('SELECT cable_id FROM cable_points WHERE id=?').get(ppp.cable_point_id);
    if (cableP) {
      cablesEnPotencia.add(cableP.cable_id);
      if (!powerCablePairs[cableP.cable_id]) powerCablePairs[cableP.cable_id] = new Set();
      powerCablePairs[cableP.cable_id].add(ppp.fiber_number);
    }
  }
  // Limpiar active_power en fibras que YA NO tienen potencia (ej: fusion cortada)
  for (var cid of cablesEnPotencia) {
    var fcs = db.prepare('SELECT id, fiber_number FROM fiber_connections WHERE cable_id=? AND active_power=1').all(cid);
    for (var fc of fcs) {
      if (!powerCablePairs[cid] || !powerCablePairs[cid].has(fc.fiber_number)) {
        db.prepare('UPDATE fiber_connections SET active_power=0, power_level=NULL WHERE id=?').run(fc.id);
      }
    }
  }
  // LUEGO: asegurar que las que SÍ tienen potencia estén marcadas
  for (var ppp of todosPotencia) {
    var cableP = db.prepare('SELECT cable_id FROM cable_points WHERE id=?').get(ppp.cable_point_id);
    if (cableP) {
      db.prepare('UPDATE fiber_connections SET active_power=1 WHERE cable_id=? AND fiber_number=? AND active_power=0')
        .run(cableP.cable_id, ppp.fiber_number);
    }
  }

  syncPowerState();
  
  res.json({
    // Solo hilos fuente (directamente desde OLT), NO heredados
    fuentes: hilosFuente,
    // Segmentos de fusion para animar el flujo
    segmentos: todosSegmentos,
    // TODOS los (cable_point_id, fiber_number) que tienen potencia
    potencia: todosPotencia,
    total_fuentes: hilosFuente.length,
    total_potencia: todosPotencia.length
  });
});

// ========== SINCRONIZAR POTENCIA (EVENT-DRIVEN) ==========
// Se ejecuta despues de cada cambio (fusion/splice create/break)
// para mantener fiber_connections.active_power siempre correcto.
// No depende de traces ni de cable_points.
function syncPowerState() {
  // 1. Limpiar power de todas las conexiones NO-OLT
  db.prepare("UPDATE fiber_connections SET active_power=0, power_level=NULL WHERE source_type != 'olt'").run();
  
  // 2. Mantener power en conexiones OLT que esten activas
  db.prepare(`
    UPDATE fiber_connections SET active_power=1, power_level=op.power
    FROM olt_ports op
    WHERE fiber_connections.source_olt_port_id = op.id
      AND (op.operational_status = 'Online' OR (op.power IS NOT NULL AND op.power > 0))
      AND fiber_connections.active_power = 0
  `).run();
  
  // 3. Propagar por fusiones (iterativo hasta estabilizar)
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 50) {
    changed = false;
    iterations++;
    
    // Buscar cable+fiber con power
    var powered = db.prepare('SELECT cable_id, fiber_number, power_level FROM fiber_connections WHERE active_power=1').all();
    
    for (var p of powered) {
      // Buscar fusiones donde este cable+fiber aparezca (lado IN)
      var fusionsIn = db.prepare(`
        SELECT f.*, cp_out.cable_id as cable_out
        FROM fusions f
        JOIN cable_points cp_in ON cp_in.id = f.cable_connection_id_in
        JOIN cable_points cp_out ON cp_out.id = f.cable_connection_id_out
        WHERE cp_in.cable_id = ? AND f.fiber_in = ?
      `).all(p.cable_id, p.fiber_number);
      
      for (var f of fusionsIn) {
        var other = db.prepare('SELECT * FROM fiber_connections WHERE cable_id=? AND fiber_number=?').get(f.cable_out, f.fiber_out);
        if (other && !other.active_power) {
          db.prepare('UPDATE fiber_connections SET active_power=1, power_level=? WHERE id=?').run(p.power_level, other.id);
          changed = true;
        }
      }
      
      // Buscar fusiones donde este cable+fiber aparezca (lado OUT)
      var fusionsOut = db.prepare(`
        SELECT f.*, cp_in.cable_id as cable_in
        FROM fusions f
        JOIN cable_points cp_out ON cp_out.id = f.cable_connection_id_out
        JOIN cable_points cp_in ON cp_in.id = f.cable_connection_id_in
        WHERE cp_out.cable_id = ? AND f.fiber_out = ?
      `).all(p.cable_id, p.fiber_number);
      
      for (var f of fusionsOut) {
        var other = db.prepare('SELECT * FROM fiber_connections WHERE cable_id=? AND fiber_number=?').get(f.cable_in, f.fiber_in);
        if (other && !other.active_power) {
          db.prepare('UPDATE fiber_connections SET active_power=1, power_level=? WHERE id=?').run(p.power_level, other.id);
          changed = true;
        }
      }
    }
  }
  
  // 4. Propagar por splices (cable ↔ splitter)
  // Primero: INPUT splices (cable → splitter input)
  var spliceInputs = db.prepare(`
    SELECT s.*, cp.cable_id as cable_id, mf.id as mf_id
    FROM splices s
    JOIN cable_points cp ON cp.id = CASE 
      WHEN s.fiber_a_type='cable_fiber' THEN s.fiber_a_id 
      ELSE s.fiber_b_id 
    END
    JOIN manga_fibers mf ON mf.id = CASE 
      WHEN s.fiber_a_type='manga_fiber' THEN s.fiber_a_id 
      ELSE s.fiber_b_id 
    END
    WHERE mf.splitter_output = 0 OR mf.splitter_output IS NULL
  `).all();
  
  for (var si of spliceInputs) {
    var cablePort = si.fiber_a_type === 'cable_fiber' ? si.fiber_a_port : si.fiber_b_port;
    var fc = db.prepare('SELECT * FROM fiber_connections WHERE cable_id=? AND fiber_number=?').get(si.cable_id, cablePort);
    if (fc && fc.active_power) {
      db.prepare('UPDATE manga_fibers SET active_power=1, power_level=? WHERE id=?').run(fc.power_level, si.mf_id);
    }
  }
  
  // Luego: Splitter INPUT → OUTPUTS (si input tiene power, todas las salidas prenden)
  var inputMFs = db.prepare('SELECT * FROM manga_fibers WHERE splitter_id IS NOT NULL AND (splitter_output=0 OR splitter_output IS NULL) AND active_power=1').all();
  for (var imf of inputMFs) {
    var loss = db.prepare('SELECT st.loss_db FROM splitters s JOIN splitter_types st ON st.id=s.splitter_type_id WHERE s.id=?').get(imf.splitter_id);
    var outPower = (imf.power_level || 2.5) - (loss ? loss.loss_db : 0);
    db.prepare('UPDATE manga_fibers SET active_power=1, power_level=? WHERE splitter_id=? AND splitter_output>0').run(outPower, imf.splitter_id);
  }
  
  // Finalmente: OUTPUT splices (splitter output → cable)
  var spliceOutputs = db.prepare(`
    SELECT s.*, cp.cable_id as cable_id, mf.id as mf_id, mf.power_level as mf_power
    FROM splices s
    JOIN cable_points cp ON cp.id = CASE 
      WHEN s.fiber_a_type='cable_fiber' THEN s.fiber_a_id 
      ELSE s.fiber_b_id 
    END
    JOIN manga_fibers mf ON mf.id = CASE 
      WHEN s.fiber_a_type='manga_fiber' THEN s.fiber_a_id 
      ELSE s.fiber_b_id 
    END
    WHERE mf.splitter_output > 0
  `).all();
  
  for (var so of spliceOutputs) {
    if (!so.mf_power) continue;
    var cablePort2 = so.fiber_a_type === 'cable_fiber' ? so.fiber_a_port : so.fiber_b_port;
    var fc2 = db.prepare('SELECT * FROM fiber_connections WHERE cable_id=? AND fiber_number=?').get(so.cable_id, cablePort2);
    if (fc2 && !fc2.active_power) {
      db.prepare('UPDATE fiber_connections SET active_power=1, power_level=? WHERE id=?').run(so.mf_power, fc2.id);
    }
  }
  
  // 4.5 Sincronizar fiber_uid entre cable_fibers y manga_fibers via splices
  var allSplices = db.prepare('SELECT * FROM splices').all();
  for (var sp of allSplices) {
    var cableId = null, cableFiberNum = null, mfId = null;
    if (sp.fiber_a_type === 'cable_fiber' && sp.fiber_b_type === 'manga_fiber') {
      cableId = sp.fiber_a_id; cableFiberNum = sp.fiber_a_port; mfId = sp.fiber_b_id;
    } else if (sp.fiber_a_type === 'manga_fiber' && sp.fiber_b_type === 'cable_fiber') {
      cableId = sp.fiber_b_id; cableFiberNum = sp.fiber_b_port; mfId = sp.fiber_a_id;
    }
    if (cableId && mfId) {
      var cablePt = db.prepare('SELECT cable_id FROM cable_points WHERE id=?').get(cableId);
      if (cablePt) {
        var cf = db.prepare('SELECT fiber_uid FROM cable_fibers WHERE cable_id=? AND fiber_number=?').get(cablePt.cable_id, cableFiberNum);
        var mf = db.prepare('SELECT id, fiber_uid FROM manga_fibers WHERE id=?').get(mfId);
        if (cf && cf.fiber_uid && mf && (!mf.fiber_uid || mf.fiber_uid !== cf.fiber_uid)) {
          db.prepare('UPDATE manga_fibers SET fiber_uid=? WHERE id=?').run(cf.fiber_uid, mfId);
        }
      }
    }
  }
  
  // 5. Sincronizar cable_fibers.active_power por fiber_uid
  // Primero limpiar todo
  db.prepare('UPDATE cable_fibers SET active_power=0, power_level=NULL').run();
  
  // Luego marcar power donde fiber_uid tenga conexion activa
  var activeFCs = db.prepare('SELECT cable_id, fiber_number, power_level FROM fiber_connections WHERE active_power=1').all();
  var processedUIDs = {};
  for (var afc of activeFCs) {
    var cf = db.prepare('SELECT id, fiber_uid FROM cable_fibers WHERE cable_id=? AND fiber_number=?').get(afc.cable_id, afc.fiber_number);
    if (cf && cf.fiber_uid && !processedUIDs[cf.fiber_uid]) {
      processedUIDs[cf.fiber_uid] = true;
      db.prepare('UPDATE cable_fibers SET active_power=1, power_level=? WHERE fiber_uid=?').run(afc.power_level || 2.5, cf.fiber_uid);
    }
  }
}

module.exports = { router, syncPowerState };
