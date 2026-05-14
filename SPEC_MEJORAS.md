# SPEC_MEJORAS — Mejoras al Visualizador MapFiber

> **Basado en:** Análisis de TOMODAT v2.17.37 + Código actual de MapFiber  
> **Objetivo:** Implementar animación D3.js para fibras activas, power monitoring con umbrales de color, y hover highlighting de rutas de fibra.

---

## 📐 Diagrama de Flujo General

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FLUJO DE CARGA DEL VISUALIZADOR              │
└─────────────────────────────────────────────────────────────────────┘

openMangaVisualizer(mangaId)
    │
    ├──► FETCH mangas/:id/splitters ───────────────► GET /api/mangas/:id/splitters
    ├──► FETCH mangas/:id/fibers  ─────────────────► GET /api/mangas/:id/fibers
    ├──► FETCH cable-points?element_type=manga&element_id=id
    ├──► FETCH cables/:id/fibers (for each cable)  ─► GET /api/cables/:id/fibers
    ├──► FETCH fusions?manga_id=id                 ─► GET /api/fusions?manga_id=
    │
    ├──► [NUEVO] FETCH power-readings?manga_id=id   ─► GET /api/power-readings
    │       (lecturas de potencia recientes por fibra)
    │
    ├──► BUILD SVG: cable blocks (IN/OUT)
    ├──► BUILD SVG: fusion bezier curves
    ├──► BUILD SVG: splitter
    │
    ├──► [NUEVO] INIT D3.js animations
    ├──► [NUEVO] INIT hover handlers
    ├──► [NUEVO] INIT power badges
    │
    └──► RENDER SVG + ATTACH EVENTS
```

---

## 1. 🎬 SISTEMA DE ANIMACIÓN D3.js PARA FIBRAS ACTIVAS

### 1.1 Concepto

Reemplazar la animación CSS actual (`fiber-active` con `stroke-dasharray` y `@keyframes power-flow`) por una animación D3.js que simule **pulsos de luz recorriendo la fibra**, similar a TOMODAT. Esto permite:

- Movimiento suave frame-by-frame (60fps) controlado por `requestAnimationFrame`
- Múltiples pulsos simultáneos en distintas fases
- Detener/reanudar animación por fibra
- Control de velocidad según nivel de potencia (mayor potencia = pulso más rápido)
- Efecto de "fading" gradual al inicio/fin del pulso

### 1.2 Especificación Técnica

#### 1.2.1 Integración D3.js

**Requisito:** Cargar D3.js v7+ en `frontend/index.html`:

```html
<script src="https://d3js.org/d3.v7.min.js"></script>
```

#### 1.2.2 Función Principal: `initFiberAnimations(svgSelector, fibersData)`

**Ubicación:** Nuevo archivo `frontend/js/animations.js` o dentro de `app.js`.

```javascript
/**
 * Inicia animación D3.js de pulsos de luz para fibras activas.
 *
 * @param {string} svgSelector - Selector CSS del SVG (ej: '#vis-svg svg')
 * @param {Array} fiberPaths - Array de objetos con datos de cada fibra activa
 *   [{
 *     pathId: string,       // ID único del path SVG (data-fusion-id o data-fiber-num)
 *     fiberNumber: number,
 *     powerLevel: number,   // dBm
 *     color: string,        // hex color TIA/EIA-598
 *     isActive: boolean,
 *     d: string             // atributo 'd' del path (curva bezier)
 *   }]
 */
function initFiberAnimations(svgSelector, fiberPaths) {
  const svg = d3.select(svgSelector);
  const ns = 'http://www.w3.org/2000/svg';

  // Limpiar animaciones previas
  svg.selectAll('.pulse-circle').remove();
  svg.selectAll('.pulse-glow').remove();

  fiberPaths.forEach(fiber => {
    if (!fiber.isActive || !fiber.powerLevel) return;

    // Velocidad del pulso basada en potencia
    const speed = calculatePulseSpeed(fiber.powerLevel);
    // amount of pulses based on path length
    const pathLength = getPathLength(fiber.d);
    const pulseCount = Math.max(2, Math.floor(pathLength / 120));

    for (let i = 0; i < pulseCount; i++) {
      const initialOffset = (i / pulseCount) * pathLength;
      const opacity = 0.6 + (fiber.powerLevel > -20 ? 0.4 : 0);

      svg.append('circle')
        .attr('class', 'pulse-circle')
        .attr('r', 4.5)
        .attr('fill', fiber.color)
        .attr('opacity', opacity)
        .attr('filter', `url(#glow-${fiber.fiberNumber})`)
        .append('animateMotion')
          .attr('dur', `${speed}s`)
          .attr('repeatCount', 'indefinite')
          .attr('path', fiber.d)
          .attr('begin', `-${initialOffset / pathLength * speed}s`);
    }
  });
}

/**
 * Calcula velocidad del pulso según nivel de potencia.
 * Mayor potencia = pulso más rápido.
 */
function calculatePulseSpeed(powerLevel) {
  if (powerLevel > -15) return 1.2;  // Excelente → rápido
  if (powerLevel > -20) return 1.8;  // Bueno → medio
  if (powerLevel > -25) return 2.5;  // Regular → lento
  return 3.5;                         // Malo → muy lento
}

/**
 * Obtiene longitud del path SVG.
 */
function getPathLength(d) {
  const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  tempPath.setAttribute('d', d);
  return tempPath.getTotalLength ? tempPath.getTotalLength() : 200;
}
```

#### 1.2.3 SVG Defs: Filtros de Glow

Añadir al SVG al crearlo:

```javascript
// Dentro de openMangaVisualizer, al construir svgLines
svgLines += `<defs>
  <filter id="glow-blue" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="3" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="glow-green" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="3" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="glow-red" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="3" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>`;
```

#### 1.2.4 Flujo Alternativo: `animateMotion` No Soportado

En caso de que `animateMotion` no funcione en algunos SVG renderers, implementar fallback con `requestAnimationFrame`:

```javascript
function startPulseAnimation(svgSelector, fiberPaths) {
  const svgEl = document.querySelector(svgSelector);
  if (!svgEl) return;

  const circles = [];
  fiberPaths.forEach(fiber => {
    if (!fiber.isActive) return;
    const path = svgEl.querySelector(`path[data-fiber="${fiber.fiberNumber}"]`);
    if (!path) return;

    const pathLength = path.getTotalLength();
    const speed = calculatePulseSpeed(fiber.powerLevel);
    const numPulses = Math.max(2, Math.floor(pathLength / 120));
    const stepPerFrame = (pathLength / (60 * speed)); // pixels por frame a 60fps

    for (let i = 0; i < numPulses; i++) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', '5');
      circle.setAttribute('fill', fiber.color);
      circle.setAttribute('opacity', '0.8');
      circle.classList.add('pulse-circle');
      circle.dataset.offset = (i / numPulses) * pathLength;
      circle.dataset.step = stepPerFrame;
      svgEl.appendChild(circle);
      circles.push({ circle, path, pathLength, stepPerFrame });
    }
  });

  function animate() {
    circles.forEach(({ circle, path, pathLength, stepPerFrame }) => {
      let offset = parseFloat(circle.dataset.offset) + stepPerFrame;
      if (offset > pathLength) offset = 0;
      circle.dataset.offset = offset;
      const point = path.getPointAtLength(offset);
      circle.setAttribute('cx', point.x);
      circle.setAttribute('cy', point.y);
    });
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}
```

### 1.3 Cambios en openMangaVisualizer

```javascript
// AL FINAL de openMangaVisualizer, después de insertar SVG:
async function openMangaVisualizer(mangaId) {
  // ... código existente ...

  // ====== [NUEVO] INICIALIZAR ANIMACIONES D3 ======
  const activeFiberPaths = [];
  const svgEl = document.querySelector('#vis-svg svg');

  if (svgEl && Array.isArray(fusions)) {
    fusions.forEach(fusion => {
      const fiber = fibers.find(f => f.fiber_number == fusion.fiber_in);
      if (!fiber || !fiber.active_power) return;

      const pathEl = svgEl.querySelector(`path[data-fusion="${fusion.id}"]`);
      if (!pathEl) return;

      const d = pathEl.getAttribute('d');
      const fiberColor = tiaColor(parseInt(fusion.fiber_in));

      activeFiberPaths.push({
        fiberNumber: fusion.fiber_in,
        pathId: `fusion-${fusion.id}`,
        powerLevel: fiber.power_level || -15,
        color: fiberColor,
        isActive: true,
        d: d
      });
    });
  }

  if (activeFiberPaths.length > 0) {
    initFiberAnimations('#vis-svg svg', activeFiberPaths);
  }
}
```

### 1.4 API Adicional para Animar Fibras Existentes

Para fibras en el SVG de NAP (no manga), reutilizar `fiber-active` con animación D3 similar:

```javascript
// En showNapRouting, después de dibujar paths de fibras activas:
function animateNapFibers(napId) {
  const svgEl = document.querySelector('#vis-svg svg');
  if (!svgEl) return;

  const activePaths = svgEl.querySelectorAll('path.fl.fiber-active');
  activePaths.forEach(pathEl => {
    const d = pathEl.getAttribute('d');
    if (!d) return;
    const fiberNum = pathEl.dataset.fiber;
    const isActive = pathEl.dataset.active === 'true';
    if (!isActive) return;

    // Usar el mismo sistema de pulsos
  });
}
```

---

## 2. ⚡ POWER MONITORING CON COLORES dBm

### 2.1 Concepto

Mostrar el nivel de potencia (dBm) en cada fibra del SVG, con color codificado:

| Rango (dBm) | Color       | Significado      | Acción recomendada                   |
|-------------|-------------|------------------|---------------------------------------|
| > -20       | 🟢 Verde    | Excelente/Bueno  | Sin acción                           |
| -20 a -25   | 🟡 Amarillo | Regular          | Monitorear, posible limpieza         |
| < -25       | 🔴 Rojo     | Crítico/Pobre    | Revisar empalmes, conector, OLT      |
| Sin dato    | ⚪ Gris     | Sin medición     | Tomar lectura de potencia            |

### 2.2 Cambios en Base de Datos

**Nueva tabla** en `database.js`:

```sql
-- Power Readings (lecturas programadas o manuales)
CREATE TABLE IF NOT EXISTS power_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  element_type TEXT NOT NULL CHECK(element_type IN ('fiber_connection', 'manga_fiber', 'cable_fiber', 'olt_port', 'nap_port')),
  element_id INTEGER NOT NULL,
  power_level REAL NOT NULL,
  is_active BOOLEAN DEFAULT 1,
  temperature REAL,
  notes TEXT,
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  source TEXT DEFAULT 'manual' CHECK(source IN ('manual', 'olt_api', 'otdr', 'scheduled'))
);

-- Índice para consultas rápidas por elemento
CREATE INDEX IF NOT EXISTS idx_power_readings_element 
  ON power_readings(element_type, element_id, recorded_at DESC);

-- Power Thresholds (umbrales configurables por tipo de elemento)
CREATE TABLE IF NOT EXISTS power_thresholds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  element_type TEXT NOT NULL,
  warning_high REAL DEFAULT -20,
  critical_high REAL DEFAULT -25,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2.3 Nuevas APIs en Backend

#### `GET /api/power-readings`

```javascript
// En server.js:

// ========== POWER READINGS ==========

// GET latest power readings for elements
app.get('/api/power-readings', (req, res) => {
  const { element_type, element_id, manga_id, limit = 1 } = req.query;

  if (manga_id) {
    // Obtener últimas lecturas para todas las fibras de una manga
    const fibers = db.prepare('SELECT id, fiber_number FROM manga_fibers WHERE manga_id=?').all(manga_id);
    const fiberIds = fibers.map(f => f.id);
    if (fiberIds.length === 0) return res.json([]);

    const placeholders = fiberIds.map(() => '?').join(',');
    // Latest reading per fiber (subquery with GROUP BY)
    const readings = db.prepare(`
      SELECT pr.* FROM power_readings pr
      INNER JOIN (
        SELECT element_id, MAX(recorded_at) as max_ts
        FROM power_readings
        WHERE element_type='manga_fiber' AND element_id IN (${placeholders})
        GROUP BY element_id
      ) latest ON pr.element_id = latest.element_id AND pr.recorded_at = latest.max_ts
      WHERE pr.element_type='manga_fiber'
    `).all(...fiberIds);

    // Mapear a fibras
    return res.json(readings.map(r => ({
      ...r,
      fiber_number: fibers.find(f => f.id === r.element_id)?.fiber_number
    })));
  }

  if (element_type && element_id) {
    return res.json(
      db.prepare('SELECT * FROM power_readings WHERE element_type=? AND element_id=? ORDER BY recorded_at DESC LIMIT ?')
        .all(element_type, parseInt(element_id), parseInt(limit))
    );
  }

  res.json(db.prepare('SELECT * FROM power_readings ORDER BY recorded_at DESC LIMIT 100').all());
});

// POST - record a power reading
app.post('/api/power-readings', (req, res) => {
  const { element_type, element_id, power_level, is_active, temperature, notes, source } = req.body;

  if (!element_type || !element_id || power_level === undefined) {
    return res.status(400).json({ error: 'element_type, element_id, power_level required' });
  }

  const result = db.prepare(
    'INSERT INTO power_readings (element_type, element_id, power_level, is_active, temperature, notes, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    element_type,
    element_id,
    power_level,
    is_active !== undefined ? (is_active ? 1 : 0) : 1,
    temperature || null,
    notes || null,
    source || 'manual'
  );

  // Actualizar el power_level en la tabla de origen
  if (element_type === 'manga_fiber') {
    db.prepare('UPDATE manga_fibers SET power_level=?, active_power=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(power_level, is_active !== false ? 1 : 0, element_id);
  } else if (element_type === 'fiber_connection') {
    db.prepare('UPDATE fiber_connections SET power_level=?, active_power=? WHERE id=?')
      .run(power_level, is_active !== false ? 1 : 0, element_id);
  }

  res.json({ id: result.lastInsertRowid, message: 'Lectura registrada' });
});

// GET power thresholds
app.get('/api/power-thresholds', (req, res) => {
  res.json(db.prepare('SELECT * FROM power_thresholds').all());
});

// POST - set threshold
app.post('/api/power-thresholds', (req, res) => {
  const { element_type, warning_high, critical_high } = req.body;
  db.prepare(
    'INSERT OR REPLACE INTO power_thresholds (element_type, warning_high, critical_high) VALUES (?, ?, ?)'
  ).run(element_type, warning_high || -20, critical_high || -25);
  res.json({ message: 'Umbral guardado' });
});

// GET historical readings for a fiber (for chart display)
app.get('/api/power-readings/:id/history', (req, res) => {
  const reading = db.prepare('SELECT * FROM power_readings WHERE id=?').get(req.params.id);
  if (!reading) return res.status(404).json({ error: 'Reading not found' });

  const history = db.prepare(`
    SELECT * FROM power_readings 
    WHERE element_type=? AND element_id=?
    ORDER BY recorded_at DESC LIMIT 50
  `).all(reading.element_type, reading.element_id);

  res.json(history);
});
```

### 2.4 Función Frontend: Power Color

```javascript
// En frontend/js/app.js

/**
 * Retorna el color correspondiente según el nivel de potencia.
 *
 * @param {number|null} powerLevel - Nivel de potencia en dBm
 * @returns {{ color: string, label: string, bgColor: string, borderColor: string }}
 */
function getPowerColor(powerLevel) {
  if (powerLevel === null || powerLevel === undefined) {
    return { color: '#888888', label: 'Sin dato', bgColor: 'rgba(136,136,136,0.15)', borderColor: '#666' };
  }
  if (powerLevel > -20) {
    return { color: '#00ff88', label: 'Excelente', bgColor: 'rgba(0,255,136,0.15)', borderColor: '#00ff88' };
  }
  if (powerLevel > -25) {
    return { color: '#ffd700', label: 'Regular', bgColor: 'rgba(255,215,0,0.15)', borderColor: '#ffd700' };
  }
  return { color: '#e94560', label: 'Crítico', bgColor: 'rgba(233,69,96,0.15)', borderColor: '#e94560' };
}
```

### 2.5 Power Badge en SVG de Manga Visualizer

Modificar el dibujo de badges de pérdida en las líneas de fusión para INCLUIR también el nivel de potencia:

```javascript
// En openMangaVisualizer, al dibujar cada fusión:
// Buscar la fibra activa correspondiente
const activeFiber = fibers.find(f => f.fiber_number == fusion.fiber_in);

if (activeFiber && activeFiber.active_power) {
  const powerInfo = getPowerColor(activeFiber.power_level);

  // Power badge en la línea de fusión (cerca de la mitad)
  const powerBadgeX = midX;
  const powerBadgeY = (srcY + tgtY) / 2 - 30; // Encima del badge de pérdida

  // Fondo del badge
  svgLines += `<rect x="${powerBadgeX - 35}" y="${powerBadgeY - 9}" 
    width="70" height="18" rx="9" 
    fill="${powerInfo.bgColor}" stroke="${powerInfo.borderColor}" 
    stroke-width="1.5" class="power-badge" 
    data-fiber="${fusion.fiber_in}" 
    data-power="${activeFiber.power_level}" 
    data-fusion-id="${fusion.id}" />`;

  // Icono + valor
  const powerValue = activeFiber.power_level?.toFixed(1) || '?';
  svgLines += `<text x="${powerBadgeX}" y="${powerBadgeY + 4}" 
    text-anchor="middle" fill="${powerInfo.color}" 
    font-family="sans-serif" font-size="10" font-weight="bold"
    class="power-badge-text">⚡ ${powerValue} dBm</text>`;
}
```

### 2.6 Tooltip de Power en Hover

```javascript
// Agregar evento hover al badge de potencia
function attachPowerBadgeEvents() {
  const svgEl = document.querySelector('#vis-svg svg');
  if (!svgEl) return;

  // Usar delegación de eventos
  svgEl.addEventListener('mouseover', (e) => {
    const badge = e.target.closest('.power-badge');
    if (!badge) return;

    const powerLevel = parseFloat(badge.dataset.power);
    const fiberNum = badge.dataset.fiber;
    const powerInfo = getPowerColor(powerLevel);

    // Crear tooltip
    const tooltip = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    tooltip.classList.add('power-tooltip');
    tooltip.setAttribute('transform', `translate(${parseFloat(badge.getAttribute('x')) || 0}, ${parseFloat(badge.getAttribute('y')) - 40})`);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', -70);
    rect.setAttribute('y', -25);
    rect.setAttribute('width', '140');
    rect.setAttribute('height', '50');
    rect.setAttribute('rx', '6');
    rect.setAttribute('fill', '#1a1a2e');
    rect.setAttribute('stroke', powerInfo.borderColor);
    rect.setAttribute('stroke-width', '1.5');
    rect.setAttribute('opacity', '0.95');
    tooltip.appendChild(rect);

    // Texto
    const lines = [
      `Fibra #${fiberNum} · ${powerInfo.label}`,
      `Potencia: ${powerLevel?.toFixed(1) || 'N/A'} dBm`
    ];
    lines.forEach((line, i) => {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', '0');
      text.setAttribute('y', -10 + i * 18);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', powerInfo.color);
      text.setAttribute('font-size', i === 0 ? '12' : '11');
      text.setAttribute('font-weight', i === 0 ? 'bold' : 'normal');
      text.textContent = line;
      tooltip.appendChild(text);
    });

    svgEl.appendChild(tooltip);
    badge._tooltip = tooltip;
  });

  svgEl.addEventListener('mouseout', (e) => {
    const badge = e.target.closest('.power-badge');
    if (badge && badge._tooltip) {
      svgEl.removeChild(badge._tooltip);
      badge._tooltip = null;
    }
  });
}
```

---

## 3. 🔍 HOVER HIGHLIGHTING DE RUTA DE FIBRA

### 3.1 Concepto

Al hacer hover sobre una fibra (path SVG) en el visualizador de mangas, se debe resaltar **toda la ruta de esa fibra** a través de todos los empalmes/fusiones hasta llegar a su destino final.

Similar a TOMODAT: al hacer hover sobre un path de fibra, se ilumina el trayecto completo y se atenúa el resto.

### 3.2 Algoritmo de Rastreo

```
FIBER HOVER → fusion.fiber_in

  1. Identificar la fusión donde fiber_in == N
  2. Obtener fiber_out de esa fusión
  3. Buscar otra fusión donde fiber_in == fiber_out (misma fibra, otro cable)
  4. Repetir hasta no encontrar más fusiones
  5. Marcar todos los paths de las fusiones encontradas como "highlighted"
  6. También marcar: cable blocks de entrada y salida original
```

### 3.3 Función: `highlightFiberRoute`

```javascript
/**
 * Resalta la ruta completa de una fibra a través de fusiones.
 *
 * @param {number} startFusionId - ID de la fusión donde comenzó el hover
 * @param {number} startFiberNum - Número de fibra de entrada
 * @param {Array} fusions - Lista de todas las fusiones de la manga
 * @param {string} action - 'enter' | 'leave'
 */
function highlightFiberRoute(startFusionId, startFiberNum, fusions, action) {
  const svgEl = document.querySelector('#vis-svg svg');
  if (!svgEl) return;

  if (action === 'leave') {
    // Restaurar todos los paths
    svgEl.querySelectorAll('.fl').forEach(p => {
      p.style.opacity = '';
      p.style.strokeWidth = '';
      p.style.filter = '';
    });
    svgEl.querySelectorAll('.power-badge').forEach(b => {
      b.style.opacity = '';
    });
    svgEl.querySelectorAll('.power-badge-text').forEach(t => {
      t.style.opacity = '';
    });
    svgEl.querySelectorAll('.fiber-dot').forEach(d => {
      d.style.opacity = '';
    });
    // Limpiar tooltip de highlight
    const hlTip = document.querySelector('.route-highlight-tip');
    if (hlTip) hlTip.remove();
    return;
  }

  // ---- ENTER ----
  // 1. Encontrar todas las fusiones en la cadena
  const routeFusionIds = new Set();
  const visitedFibers = new Set();

  function traceRoute(fiberNum) {
    if (visitedFibers.has(fiberNum)) return;
    visitedFibers.add(fiberNum);

    const fusion = fusions.find(f =>
      parseInt(f.fiber_in) === fiberNum && !routeFusionIds.has(f.id)
    );
    if (!fusion) return;

    routeFusionIds.add(fusion.id);

    // Trazar hacia adelante: fiber_out de esta fusión → fiber_in de otra
    if (fusion.fiber_out) {
      traceRoute(parseInt(fusion.fiber_out));
    }
  }

  traceRoute(startFiberNum);

  // 2. Atenuar todos los paths
  svgEl.querySelectorAll('.fl').forEach(p => {
    p.style.opacity = '0.1';
    p.style.transition = 'opacity 0.2s ease';
  });

  // 3. Resaltar paths de las fusiones en la ruta
  const highlightedPaths = [];
  routeFusionIds.forEach(fid => {
    const path = svgEl.querySelector(`path[data-fusion="${fid}"]`);
    if (path) {
      path.style.opacity = '1';
      path.style.strokeWidth = '5';
      path.style.filter = 'drop-shadow(0 0 6px currentColor)';
      path.style.transition = 'all 0.2s ease';
      highlightedPaths.push(path);
    }
  });

  // 4. Resaltar power badges de estas fusiones
  routeFusionIds.forEach(fid => {
    const badges = svgEl.querySelectorAll(`.power-badge[data-fusion-id="${fid}"]`);
    badges.forEach(b => {
      b.style.opacity = '1';
      b.style.filter = 'drop-shadow(0 0 4px currentColor)';
    });
  });

  // 5. Mostrar tooltip informativo en SVG
  if (highlightedPaths.length > 0) {
    const firstPath = highlightedPaths[0];
    const pathLen = firstPath.getTotalLength();
    const midPoint = firstPath.getPointAtLength(pathLen / 2);

    const tipGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    tipGroup.classList.add('route-highlight-tip');

    const tipBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    tipBg.setAttribute('x', midPoint.x - 100);
    tipBg.setAttribute('y', midPoint.y - 30);
    tipBg.setAttribute('width', '200');
    tipBg.setAttribute('height', '36');
    tipBg.setAttribute('rx', '6');
    tipBg.setAttribute('fill', 'rgba(0,0,0,0.85)');
    tipBg.setAttribute('stroke', '#00d4ff');
    tipBg.setAttribute('stroke-width', '1');
    tipGroup.appendChild(tipBg);

    const tipText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tipText.setAttribute('x', midPoint.x);
    tipText.setAttribute('y', midPoint.y - 12);
    tipText.setAttribute('text-anchor', 'middle');
    tipText.setAttribute('fill', '#00d4ff');
    tipText.setAttribute('font-size', '11');
    tipText.setAttribute('font-weight', 'bold');
    tipText.textContent = `🔍 Ruta: Fibra #${startFiberNum}`;
    tipGroup.appendChild(tipText);

    const tipSub = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tipSub.setAttribute('x', midPoint.x);
    tipSub.setAttribute('y', midPoint.y + 6);
    tipSub.setAttribute('text-anchor', 'middle');
    tipSub.setAttribute('fill', '#aaa');
    tipSub.setAttribute('font-size', '10');
    tipSub.textContent = `${routeFusionIds.size} empalme(s) en la ruta`;
    tipGroup.appendChild(tipSub);

    svgEl.appendChild(tipGroup);
  }
}
```

### 3.4 Eventos Hover en Paths

Modificar la creación de paths de fusión en `openMangaVisualizer` para incluir eventos hover:

```javascript
// En openMangaVisualizer, al crear cada path de fusión:
svgLines += `<path class="fl" 
  d="M ${x1},${srcY} C ${x1 + cpOffsetX},${srcY} ${x4 - cpOffsetX},${tgtY} ${x4},${tgtY}" 
  stroke="${fiberCol}" stroke-width="2.5" opacity="0.8" fill="none" 
  data-fusion="${fusion.id}" 
  data-fiber-in="${fusion.fiber_in}" 
  data-fiber-out="${fusion.fiber_out || ''}" />`;
```

Y adjuntar los eventos después de insertar el SVG:

```javascript
// En openMangaVisualizer, después de insertar SVG:
function attachFiberHoverEvents() {
  const svgEl = document.querySelector('#vis-svg svg');
  if (!svgEl || !Array.isArray(fusions)) return;

  svgEl.querySelectorAll('.fl').forEach(path => {
    path.addEventListener('mouseenter', function(e) {
      const fusionId = parseInt(this.dataset.fusion);
      const fiberIn = parseInt(this.dataset.fiberIn);

      if (fusions.length > 1) {
        highlightFiberRoute(fusionId, fiberIn, fusions, 'enter');
      } else {
        // Si es la única fusión, simplemente resaltar este path
        this.style.opacity = '1';
        this.style.strokeWidth = '5';
        this.style.filter = 'drop-shadow(0 0 8px currentColor)';
        this.style.transition = 'all 0.15s ease';
      }
    });

    path.addEventListener('mouseleave', function(e) {
      if (fusions.length > 1) {
        highlightFiberRoute(null, null, fusions, 'leave');
      } else {
        this.style.opacity = '0.8';
        this.style.strokeWidth = '2.5';
        this.style.filter = '';
      }
    });
  });
}
```

### 3.5 Información en el Panel Izquierdo

Cuando se hace hover sobre una fibra, también resaltar la fibra correspondiente en el panel izquierdo (`#vis-fibers`):

```javascript
function highlightLeftPanelFiber(fiberNumber, action) {
  const fiberEls = document.querySelectorAll('#vis-fibers .fiber-port');
  fiberEls.forEach(el => {
    const numEl = el.querySelector('.port-number');
    if (!numEl) return;
    const match = numEl.textContent.match(/Fibra #(\d+)/);
    if (!match) return;

    if (parseInt(match[1]) === fiberNumber) {
      if (action === 'enter') {
        el.style.borderColor = '#00d4ff';
        el.style.boxShadow = '0 0 12px rgba(0,212,255,0.5)';
        el.style.transform = 'scale(1.05)';
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        el.style.borderColor = '';
        el.style.boxShadow = '';
        el.style.transform = '';
      }
    }
  });
}
```

---

## 4. 🗄️ CAMBIOS EN BACKEND (Resumen)

### 4.1 Nuevos Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/power-readings` | Lecturas de potencia (filtros: element_type, element_id, manga_id) |
| POST | `/api/power-readings` | Registrar nueva lectura de potencia |
| GET | `/api/power-readings/:id/history` | Historial de lecturas para un elemento |
| GET | `/api/power-thresholds` | Obtener umbrales de potencia |
| POST | `/api/power-thresholds` | Configurar umbrales |

### 4.2 Modificaciones a Endpoints Existentes

| Ruta | Cambio |
|------|--------|
| `GET /api/mangas/:id/fibers` | Incluir `last_power_reading` y `power_status` en cada fibra |
| `GET /api/cables/:id/fibers` | Incluir `last_power_db` y `status_color` |
| `GET /api/fibers/:id/route` | Incluir lecturas de potencia en segmentos de ruta |
| `GET /api/reports/summary` | Añadir `power_stats`: fibras por rango (green/yellow/red) |

### 4.3 Migración a Database

Agregar en `database.js`:

```javascript
// Power readings table
const prColCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='power_readings'").get();
if (!prColCheck) {
  db.exec(`
    CREATE TABLE power_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      element_type TEXT NOT NULL,
      element_id INTEGER NOT NULL,
      power_level REAL NOT NULL,
      is_active BOOLEAN DEFAULT 1,
      temperature REAL,
      notes TEXT,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      source TEXT DEFAULT 'manual'
    );
    CREATE INDEX idx_power_readings_element ON power_readings(element_type, element_id, recorded_at DESC);
  `);
  console.log('✅ Migration: created power_readings table');
}

// Power thresholds table
const ptColCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='power_thresholds'").get();
if (!ptColCheck) {
  db.exec(`
    CREATE TABLE power_thresholds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      element_type TEXT NOT NULL,
      warning_high REAL DEFAULT -20,
      critical_high REAL DEFAULT -25,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO power_thresholds (element_type, warning_high, critical_high) VALUES
      ('fiber_connection', -20, -25),
      ('manga_fiber', -20, -25),
      ('olt_port', -20, -27),
      ('nap_port', -18, -22);
  `);
  console.log('✅ Migration: created power_thresholds table');
}
```

---

## 5. 🎨 CAMBIOS EN FRONTEND (Resumen)

### 5.1 Archivos Nuevos

| Archivo | Contenido |
|---------|-----------|
| `frontend/js/animations.js` | Sistema de animación D3.js (pulsos de luz) |
| `frontend/js/power-monitor.js` | Power badges, colores, tooltips, thresholds |
| `frontend/js/route-highlight.js` | Hover highlighting de rutas de fibra |

### 5.2 Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `frontend/index.html` | Cargar D3.js + nuevos JS |
| `frontend/js/app.js` | Llamar init de animaciones + hover en `openMangaVisualizer` |
| `frontend/css/style.css` | Estilos para badges, tooltips, animaciones |
| `backend/server.js` | Power readings endpoints + power en responses |
| `backend/database.js` | Migraciones para tablas nuevas |

### 5.3 Inicialización en app.js

```javascript
// Al final de openMangaVisualizer, después de insertar SVG:
function initializeVisualizerInteractions(mangaId, fusions, fibers) {
  // 1. Adjuntar eventos hover a las rutas de fibra
  attachFiberHoverEvents();

  // 2. Adjuntar eventos hover a los power badges
  attachPowerBadgeEvents();

  // 3. Iniciar animaciones D3 para fibras activas
  const activePaths = collectActiveFiberPaths(fusions, fibers);
  if (activePaths.length > 0) {
    initFiberAnimations('#vis-svg svg', activePaths);
  }

  // 4. Iniciar animación RAF fallback (si D3 animateMotion falla)
  if (activePaths.length > 0) {
    startPulseAnimation('#vis-svg svg', activePaths);
  }

  // 5. Agregar evento de click para abrir detalle de fibra
  document.querySelector('#vis-svg svg')?.addEventListener('click', (e) => {
    const path = e.target.closest('.fl');
    if (path && path.dataset.fiberIn) {
      showFiberDetail(mangaId, parseInt(path.dataset.fiberIn));
    }
  });
}
```

---

## 6. 🔧 INTERACCIONES DE USUARIO

### 6.1 Hover sobre Fibra (path SVG)

| Acción | Comportamiento |
|--------|----------------|
| `mouseenter` en path `.fl` | Resalta toda la ruta de la fibra (todas las fusiones en cadena) |
| `mouseleave` en path `.fl` | Restaura opacidad de todos los paths |
| Durante hover | Tooltip informativo: "Fibra #N → X empalmes" |
| Durante hover | Panel izquierdo: scroll a fibra correspondiente + glow |

### 6.2 Hover sobre Power Badge

| Acción | Comportamiento |
|--------|----------------|
| `mouseenter` en `.power-badge` | Tooltip detallado con nivel dBm, clasificación, recomendación |
| `mouseleave` en `.power-badge` | Oculta tooltip |

### 6.3 Click sobre Fibra

| Acción | Comportamiento |
|--------|----------------|
| Click en path `.fl` | Abre modal de detalle de fibra: nivel de potencia, pérdidas acumuladas, ruta completa |
| Click en power badge | Abre modal de historial de potencia (gráfico de lecturas en el tiempo) |

### 6.4 Drag de Bloques (ya existente)

| Acción | Comportamiento |
|--------|----------------|
| `mousedown` en bloque (no en port/path) | Inicia drag del bloque |
| `mousemove` | Mueve bloque en eje Y |
| `mouseup` | Finaliza drag, mantiene posición |

### 6.5 Connection Drag (ya existente)

| Acción | Comportamiento |
|--------|----------------|
| `mousedown` en `.clickable-port` | Inicia línea de conexión temporal |
| `mousemove` | Dibuja línea punteada desde el puerto origen |
| `mouseup` en otro puerto | Crea conexión entre puertos |

---

## 7. 📊 CSS: NUEVOS ESTILOS

### 7.1 Power Badges

```css
/* En style.css */

.power-badge {
  cursor: pointer;
  transition: all 0.2s ease;
}
.power-badge:hover {
  filter: brightness(1.3);
  stroke-width: 2.5 !important;
}

.power-badge-text {
  pointer-events: none;
  user-select: none;
}

/* Tooltip de power */
.power-tooltip {
  pointer-events: none;
  animation: tooltip-fade-in 0.15s ease;
}

@keyframes tooltip-fade-in {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}
```

### 7.2 Route Highlight Tooltip

```css
.route-highlight-tip {
  pointer-events: none;
  animation: tooltip-fade-in 0.2s ease;
}
```

### 7.3 Pulse Circles Animation

```css
.pulse-circle {
  pointer-events: none;
  mix-blend-mode: screen;
}
```

---

## 8. 📋 CHECKLIST DE IMPLEMENTACIÓN

### Fase 1: Backend (Database + APIs)

- [ ] Agregar `power_readings` table en `database.js`
- [ ] Agregar `power_thresholds` table en `database.js`
- [ ] Agregar migration checks en `database.js`
- [ ] Implementar `GET /api/power-readings`
- [ ] Implementar `POST /api/power-readings`
- [ ] Implementar `GET /api/power-readings/:id/history`
- [ ] Implementar `GET /api/power-thresholds`
- [ ] Implementar `POST /api/power-thresholds`
- [ ] Modificar `GET /api/mangas/:id/fibers` para incluir power readings
- [ ] Modificar `GET /api/cables/:id/fibers` para incluir power status

### Fase 2: Frontend — Power Monitoring

- [ ] Crear `frontend/js/power-monitor.js` con `getPowerColor()`
- [ ] Modificar `openMangaVisualizer` para dibujar power badges
- [ ] Implementar `attachPowerBadgeEvents()`
- [ ] Implementar tooltip SVG para power badges
- [ ] Agregar estilos CSS para power badges y tooltips

### Fase 3: Frontend — Hover Highlighting

- [ ] Crear `frontend/js/route-highlight.js` con `highlightFiberRoute()`
- [ ] Modificar paths de fusión para incluir `data-fusion`, `data-fiber-in`, `data-fiber-out`
- [ ] Implementar `attachFiberHoverEvents()`
- [ ] Implementar highlight de panel izquierdo sincronizado
- [ ] Agregar tooltip de ruta en SVG

### Fase 4: Frontend — Animación D3.js

- [ ] Crear `frontend/js/animations.js`
- [ ] Implementar `initFiberAnimations()` con `animateMotion`
- [ ] Implementar fallback `startPulseAnimation()` con `requestAnimationFrame`
- [ ] Implementar `calculatePulseSpeed()`
- [ ] Agregar SVG `<defs>` con filtros de glow
- [ ] Integrar con `openMangaVisualizer`
- [ ] Agregar estilos CSS para `.pulse-circle`

### Fase 5: Integración y Pruebas

- [ ] Cargar D3.js en `index.html`
- [ ] Cargar nuevos JS en `index.html`
- [ ] Probar visualizador de manga con fibras activas
- [ ] Probar hover highlighting con múltiples fusiones en cadena
- [ ] Probar power badges con diferentes niveles dBm
- [ ] Probar animación de pulsos
- [ ] Probar click en fibra → detalle de ruta

---

## 9. 🔄 DIAGRAMA DE FLUJO DETALLADO: HOVER HIGHLIGHTING

```
Usuario hace hover sobre path de fibra
        │
        ▼
  mouseenter event fire
        │
        ▼
  Leer data-fusion-id, data-fiber-in del path
        │
        ▼
  traceRoute(fiberNum)
        │
        ├──► Buscar fusión donde fiber_in === fiberNum
        │       │
        │       ├──► NO encontrada → stop
        │       │
        │       └──► SÍ encontrada → agregar fusion.id a routeFusionIds
        │               │
        │               ▼
        │         traceRoute(fusion.fiber_out)
        │               │
        │               └──► (recursivo hasta no encontrar más)
        │
        ▼
  Para todos los paths .fl en SVG:
        │
        ├──► Si data-fusion está en routeFusionIds → opacity=1, strokeWidth=5, glow
        └──► Si NO está → opacity=0.1
        │
        ▼
  Resaltar power badges correspondientes
        │
        ▼
  Mostrar tooltip: "Fibra #N · X empalmes en ruta"
        │
        ▼
  Resaltar fibra en panel izquierdo (scroll + glow)
```

---

## 10. 📐 DIAGRAMA: ANIMACIÓN D3.js

```
initFiberAnimations(svg, activeFibers)
        │
        ▼
  Por cada fibra activa:
        │
        ├──► Calcular speed = f(powerLevel)
        │       - > -15 dBm → 1.2s
        │       - > -20 dBm → 1.8s
        │       - > -25 dBm → 2.5s
        │       - else → 3.5s
        │
        ├──► Calcular pathLength = path.getTotalLength()
        │
        ├──► Calcular pulseCount = max(2, pathLength / 120)
        │
        └──► Crear N círculos, cada uno con animateMotion
                │
                ├──► begin offset = (i / N) * pathLength / speed
                ├──► dur = speed segundos
                ├──► repeatCount = indefinite
                └──► path = d del path original
        │
        ▼
  [Cada 16ms] requestAnimationFrame
        │
        ▼
  Los círculos se mueven a lo largo del path
  con velocidad proporcional a la potencia
```

---

## 11. 🚨 MANEJO DE ERRORES

### 11.1 Sin D3.js cargado

```javascript
if (typeof d3 === 'undefined') {
  console.warn('⚠️ D3.js no está cargado. Usando animación RAF fallback.');
  return startPulseAnimation(svgSelector, fiberPaths);
}
```

### 11.2 SVG no encontrado

```javascript
if (!svgEl) {
  console.warn('⚠️ SVG container not found for animations');
  return;
}
```

### 11.3 Path sin getTotalLength()

```javascript
const pathLength = path.getTotalLength ? path.getTotalLength() : 200;
```

### 11.4 Fusiones sin data completas

```javascript
// Validar datos de fusión antes de animar
if (!fusion.fiber_in || !fusion.fiber_out) return;
```

---

## 12. 📈 MÉTRICAS Y MONITOREO

### 12.1 Indicadores a mostrar en Dashboard

- **Fibras por rango de potencia:**
  - 🟢 Verde (> -20 dBm): N
  - 🟡 Amarillo (-20 a -25 dBm): N
  - 🔴 Rojo (< -25 dBm): N

- **Promedio de potencia:** Media de todas las fibras activas

- **Peor fibra:** Fibra con menor nivel de potencia (dBm más bajo)

- **Historial diario:** Lecturas de potencia por día (tendencia)

### 12.2 API para Dashboard Power

```javascript
// En server.js
app.get('/api/reports/power-stats', (req, res) => {
  const green = db.prepare("SELECT COUNT(*) as c FROM manga_fibers WHERE active_power=1 AND power_level > -20").get().c;
  const yellow = db.prepare("SELECT COUNT(*) as c FROM manga_fibers WHERE active_power=1 AND power_level <= -20 AND power_level > -25").get().c;
  const red = db.prepare("SELECT COUNT(*) as c FROM manga_fibers WHERE active_power=1 AND power_level <= -25").get().c;
  const total = db.prepare("SELECT COUNT(*) as c FROM manga_fibers WHERE active_power=1").get().c;
  const avgPower = db.prepare("SELECT COALESCE(AVG(power_level), 0) as avg FROM manga_fibers WHERE active_power=1").get().avg;
  const worstFiber = db.prepare(`
    SELECT mf.fiber_number, mf.power_level, m.name as manga_name
    FROM manga_fibers mf
    JOIN mangas m ON m.id = mf.manga_id
    WHERE mf.active_power=1
    ORDER BY mf.power_level ASC LIMIT 1
  `).get();

  res.json({
    green, yellow, red, total,
    avg_power: Math.round(avgPower * 100) / 100,
    worst_fiber: worstFiber
  });
});
```

---

## 13. 📦 ESTRUCTURA DE ARCHIVOS (POST-IMPLEMENTACIÓN)

```
ftth-project/
├── frontend/
│   ├── index.html          ← + D3.js CDN, + nuevos JS
│   ├── css/
│   │   └── style.css       ← + estilos power badges, tooltips, animaciones
│   └── js/
│       ├── app.js           ← modificado: init animaciones, hover events
│       ├── animations.js    ← [NUEVO] D3.js + RAF pulse animation
│       ├── power-monitor.js ← [NUEVO] power colors, badges, tooltips
│       └── route-highlight.js ← [NUEVO] hover route tracing
├── backend/
│   ├── server.js           ← + endpoints power-readings, power-stats
│   └── database.js         ← + tablas power_readings, power_thresholds
└── SPEC_MEJORAS.md          ← este archivo
```

---

## 14. 🔗 DEPENDENCIAS

| Dependencia | Versión | Propósito |
|-------------|---------|-----------|
| D3.js | v7+ | Animación de pulsos, SVG manipulation |
| better-sqlite3 | (existente) | Consultas de power readings |
| Express | (existente) | APIs REST nuevas |

Ninguna nueva dependencia NPM requerida — D3.js se carga via CDN.

---

## 15. ⏱ ESTIMACIÓN DE ESFUERZO

| Fase | Archivos | Tiempo estimado |
|------|----------|-----------------|
| Backend DB + APIs | 2 archivos (~150 líneas) | 2-3 horas |
| Power monitoring frontend | 2 archivos (~200 líneas) | 3-4 horas |
| Hover highlighting | 2 archivos (~180 líneas) | 3-4 horas |
| D3.js animation | 2 archivos (~250 líneas) | 4-5 horas |
| Integración + pruebas | — | 2-3 horas |
| **Total** | **8 archivos modificados/creados** | **14-19 horas** |
