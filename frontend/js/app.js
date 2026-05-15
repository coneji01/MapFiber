// ========== TIA/EIA-598 Color Codes (12 colores estándar) ==========
const TIA_EIA598_COLORS = [
  { hex: '#003da5', name: 'Azul', rgb: '0,61,165' },
  { hex: '#f5a623', name: 'Naranja', rgb: '245,166,35' },
  { hex: '#00a650', name: 'Verde', rgb: '0,166,80' },
  { hex: '#8b4513', name: 'Marrón', rgb: '139,69,19' },
  { hex: '#708090', name: 'Pizarra', rgb: '112,128,144' },
  { hex: '#ffffff', name: 'Blanco', rgb: '255,255,255' },
  { hex: '#e82020', name: 'Rojo', rgb: '232,32,32' },
  { hex: '#1a1a1a', name: 'Negro', rgb: '26,26,26' },
  { hex: '#f5d442', name: 'Amarillo', rgb: '245,212,66' },
  { hex: '#8a2be2', name: 'Violeta', rgb: '138,43,226' },
  { hex: '#ff69b4', name: 'Rosa', rgb: '255,105,180' },
  { hex: '#20b2aa', name: 'Aguamarina', rgb: '32,178,170' }
];

function tiaColor(num) {
  const idx = ((num - 1) % 12 + 12) % 12;
  return TIA_EIA598_COLORS[idx].hex;
}

function tiaColorName(num) {
  const idx = ((num - 1) % 12 + 12) % 12;
  return TIA_EIA598_COLORS[idx].name;
}

function getFiberColor(num, colorArray, fallbackColor) {
  if (colorArray && colorArray.length > 0) {
    const idx = ((num - 1) % colorArray.length + colorArray.length) % colorArray.length;
    const c = colorArray[idx];
    if (typeof c === 'object' && c.hex) return c.hex;
    if (typeof c === 'string') return c;
    if (typeof c === 'object' && c.length === 3) return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  }
  return fallbackColor || tiaColor(num);
}

function getFiberColorName(num, colorArray) {
  if (colorArray && colorArray.length > 0) {
    const idx = ((num - 1) % colorArray.length + colorArray.length) % colorArray.length;
    const c = colorArray[idx];
    if (typeof c === 'object' && c.name) return c.name;
  }
  return tiaColorName(num);
}

function getFiberName(num) {
  return tiaColorName(num);
}

// === SURGICAL FUSION INSERT (sin re-render completo) ===
async function injectFusion(connIn, fiberIn, connOut, fiberOut, fusionId, lossDb) {
  const svgEl = document.querySelector('#vis-svg svg');
  if (!svgEl) { console.warn('[INJECT] SVG no encontrado'); return; }
  console.log('[INJECT] Fusion inyectada:', connIn, fiberIn, '→', connOut, fiberOut, 'id=' + fusionId);
  const srcDot = svgEl.querySelector(`.fiber-dot-inner[data-cable-conn="${connIn}"][data-fiber-num="${fiberIn}"]`);
  const tgtDot = svgEl.querySelector(`.fiber-dot-inner[data-cable-conn="${connOut}"][data-fiber-num="${fiberOut}"]`);
  if (!srcDot || !tgtDot) return;

  function getPortGlobalPos(el) {
    const tag = el.tagName.toLowerCase();
    let x, y;
    if (tag === 'circle') { x = parseFloat(el.getAttribute('cx')); y = parseFloat(el.getAttribute('cy')); }
    else if (tag === 'rect') { x = parseFloat(el.getAttribute('x')) + parseFloat(el.getAttribute('width'))/2; y = parseFloat(el.getAttribute('y')) + parseFloat(el.getAttribute('height'))/2; }
    else return null;
    const block = el.closest('.vis-block');
    if (block) {
      const t = (block.getAttribute('transform') || '').match(/translate\(([\d.\-]+),\s*([\d.\-]+)\)/);
      if (t) { x += parseFloat(t[1]); y += parseFloat(t[2]); }
    }
    return { x, y };
  }

  const srcPos = getPortGlobalPos(srcDot);
  const tgtPos = getPortGlobalPos(tgtDot);
  if (!srcPos || !tgtPos) return;

  // Obtener color desde la BD (cable_fibers.color)
  async function dbColor(connId, fiberNum) {
    try {
      const r = await fetch('/api/fiber-color?cable_conn_id=' + connId + '&fiber_num=' + fiberNum);
      if (r.ok) { const d = await r.json(); if (d && d.hex) return d.hex; }
    } catch(e) {}
    return null;
  }
  const colIn = await dbColor(connIn, fiberIn) || tiaColor(fiberIn);
  const colOut = await dbColor(connOut, fiberOut) || tiaColor(fiberOut);

  const x1 = srcPos.x, y1 = srcPos.y;
  const x4 = tgtPos.x, y4 = tgtPos.y;
  const dx = Math.abs(x4 - x1);
  const cpOff = Math.max(dx * 0.35, 60);
  const cpx1 = x1 < x4 ? x1 + cpOff : x1 - cpOff;
  const cpx2 = x1 < x4 ? x4 - cpOff : x4 + cpOff;
  const cpY1 = y1 + (y4 - y1) * 0.15;
  const cpY2 = y4 - (y4 - y1) * 0.15;
  const midX = (x1 + x4) / 2;
  const midY = (y1 + y4) / 2;
  const d = `M ${x1},${y1} C ${cpx1},${cpY1} ${cpx2},${cpY2} ${x4},${y4}`;

  const ns = 'http://www.w3.org/2000/svg';

  // Determinar que color va en cada lado del ✂️ segun posicion visual
  const firstIsLeft = x1 <= midX; // primer clic esta a la izquierda del ✂️?
  const leftColor = firstIsLeft ? colIn : colOut;
  const rightColor = firstIsLeft ? colOut : colIn;
  console.log('[INJECT] COLOR: x1=' + x1.toFixed(1) + ' x4=' + x4.toFixed(1) + ' midX=' + midX.toFixed(1) + ' firstIsLeft=' + firstIsLeft + ' colIn=' + colIn + '(fib' + fiberIn + ') colOut=' + colOut + '(fib' + fiberOut + ') leftColor=' + leftColor + ' rightColor=' + rightColor);

  // Gradient con corte exacto en la posicion del boton ✂️
  let strokeVal = leftColor;
  if (leftColor !== rightColor) {
    const bboxLeft = Math.min(x1, x4, cpx1, cpx2);
    const bboxRight = Math.max(x1, x4, cpx1, cpx2);
    const gradMidPct = bboxRight > bboxLeft ? ((midX - bboxLeft) / (bboxRight - bboxLeft)) * 100 : 50;
    const gm = Math.max(2, Math.min(98, gradMidPct));
    const gid = 'grad-' + fusionId;
    let defs = svgEl.querySelector('defs');
    if (!defs) { defs = document.createElementNS(ns, 'defs'); svgEl.insertBefore(defs, svgEl.firstChild); }
    if (!defs.querySelector('#' + gid)) {
      const grad = document.createElementNS(ns, 'linearGradient');
      grad.id = gid; grad.setAttribute('x1','0%'); grad.setAttribute('y1','0%'); grad.setAttribute('x2','100%'); grad.setAttribute('y2','0%');
      const s1 = document.createElementNS(ns, 'stop'); s1.setAttribute('offset','0%'); s1.setAttribute('stop-color',leftColor); s1.setAttribute('stop-opacity','1');
      const s2 = document.createElementNS(ns, 'stop'); s2.setAttribute('offset', gm + '%'); s2.setAttribute('stop-color',leftColor); s2.setAttribute('stop-opacity','1');
      const s3 = document.createElementNS(ns, 'stop'); s3.setAttribute('offset', gm + '%'); s3.setAttribute('stop-color',rightColor); s3.setAttribute('stop-opacity','1');
      const s4 = document.createElementNS(ns, 'stop'); s4.setAttribute('offset','100%'); s4.setAttribute('stop-color',rightColor); s4.setAttribute('stop-opacity','1');
      grad.append(s1, s2, s3, s4); defs.appendChild(grad);
    }
    strokeVal = 'url(#' + gid + ')';
  }

  // Detectar potencia y propagarla: si una fibra tiene power, la otra tambien (recien fusionada)
  const srcHasPower = srcDot.getAttribute('data-has-power') === 'true';
  const tgtHasPower = tgtDot.getAttribute('data-has-power') === 'true';
  const hasPower = srcHasPower || tgtHasPower;
  // Propagar power al dot que no lo tenga
  if (hasPower) {
    if (!srcHasPower) srcDot.setAttribute('data-has-power', 'true');
    if (!tgtHasPower) tgtDot.setAttribute('data-has-power', 'true');
    // Tambien marcar el jacket
    [srcDot, tgtDot].forEach(function(d) {
      var g = d.closest('.fiber-dot-group');
      if (g) {
        var j = g.querySelector('.fiber-jacket');
        if (j) j.classList.add('fiber-powered');
      }
    });
  }
  const pathClass = 'fl' + (hasPower ? ' data-flow' : '');
  const pathOpacity = hasPower ? '0.85' : '0.5';

  // Fusion path
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('class', pathClass); path.setAttribute('d', d);
  path.setAttribute('stroke', strokeVal); path.setAttribute('stroke-width','2.5');
  path.setAttribute('opacity', pathOpacity); path.setAttribute('fill','none');
  path.setAttribute('data-fusion', fusionId);
  path.setAttribute('data-fiber-in', fiberIn); path.setAttribute('data-fiber-out', fiberOut);
  path.setAttribute('data-conn-in', connIn); path.setAttribute('data-conn-out', connOut);
  path.setAttribute('data-fiber-color-in', leftColor); path.setAttribute('data-fiber-color-out', rightColor);
  path.setAttribute('data-fiber-color', leftColor); path.setAttribute('data-active', hasPower ? 'true' : 'false');
  path.setAttribute('data-fusion-power', hasPower ? '9.4' : ''); path.setAttribute('data-fiber-name', firstIsLeft ? (tiaColorName(fiberIn) || '—') : (tiaColorName(fiberOut) || '—'));
  svgEl.appendChild(path);

  // Midpoint dot
  const dot = document.createElementNS(ns, 'circle');
  const dotR = hasPower ? 6 : 4;
  const dotClass = hasPower ? 'fl-dot active-dot' : 'fl-dot';
  dot.setAttribute('class', dotClass); dot.setAttribute('cx',midX); dot.setAttribute('cy',midY);
  dot.setAttribute('r', String(dotR)); dot.setAttribute('fill', leftColor === rightColor ? leftColor : '#fff');
  dot.setAttribute('stroke','#fff'); dot.setAttribute('stroke-width','1.5');
  dot.setAttribute('opacity','0.9'); dot.setAttribute('data-fusion', fusionId);
  svgEl.appendChild(dot);

  // ✂️ Break fusion button at midpoint
  const btnG = document.createElementNS(ns, 'g');
  btnG.setAttribute('style','cursor:pointer');
  btnG.setAttribute('class','break-fusion-btn');
  btnG.setAttribute('data-fusion', fusionId);
  btnG.addEventListener('click', function(ev) { ev.stopPropagation(); confirmBreakFusion(fusionId); });
  const r = document.createElementNS(ns, 'rect');
  r.setAttribute('x', midX - 20); r.setAttribute('y', midY - 10);
  r.setAttribute('width','40'); r.setAttribute('height','20'); r.setAttribute('rx','6');
  r.setAttribute('fill','rgba(200,50,50,0.12)'); r.setAttribute('stroke','rgba(200,50,50,0.35)'); r.setAttribute('stroke-width','1');
  const t = document.createElementNS(ns, 'text');
  t.setAttribute('x', midX); t.setAttribute('y', midY + 4);
  t.setAttribute('text-anchor','middle'); t.setAttribute('fill','#e94560');
  t.setAttribute('font-family','sans-serif'); t.setAttribute('font-size','13');
  t.setAttribute('font-weight','bold'); t.setAttribute('pointer-events','none');
  t.textContent = '✂️';
  btnG.append(r, t);
  svgEl.appendChild(btnG);

  // Marcar dots con data-has-fusion + fiber-connected class
  srcDot.setAttribute('data-has-fusion','true');
  tgtDot.setAttribute('data-has-fusion','true');
  const sg = srcDot.closest('.fiber-dot-group');
  const tg = tgtDot.closest('.fiber-dot-group');
  if (sg) sg.classList.add('fiber-connected');
  if (tg) tg.classList.add('fiber-connected');
  
  // ⭐ Al crear la fusion, remover el ⚡ del texto SVG
  // Cuando un hilo tiene fusion, el ⚡ no debe aparecer (la fusion muestra potencia)
  [srcDot, tgtDot].forEach(function(dot) {
    var fn = dot.getAttribute('data-fiber-num');
    var dotY = parseFloat(dot.getAttribute('cy'));
    // Buscar texto SVG que contenga #N y este alineado verticalmente con el dot
    svgEl.querySelectorAll('text').forEach(function(tx) {
      var txY = parseFloat(tx.getAttribute('y'));
      if (isNaN(txY) || isNaN(dotY)) return;
      if (Math.abs(txY - dotY) > 4) return;
      if (tx.textContent.includes('#' + fn)) {
        tx.textContent = tx.textContent.replace(/^[\u26A1]+/, '');
      }
    });
  });

  // Actualizar contador en toolbar
  const infoEl = document.getElementById('vis-splitter-info');
  if (infoEl) {
    infoEl.innerHTML = infoEl.innerHTML.replace(/(Empalmes:\s*)(\d+)/, (m, p1) => p1 + ((parseInt(document.querySelectorAll('.fl[data-fusion]').length) || 1)));
  }

  // ⭐ Refresh completo de potencia desde el servidor para sync todos los indicadores
  refreshPowerDotsFromServer();
}

// === SURGICAL SPLICE INSERT (cable ↔ splitter, sin re-render) ===
function injectSplice(cableConnId, cableFiber, splitterMfId, splitterPort, spliceId, hasPowerFromServer) {
  const svgEl = document.querySelector('#vis-svg svg');
  if (!svgEl) { console.warn('[INJECT-SPLICE] SVG no encontrado'); return; }
  console.log('[INJECT-SPLICE] Splice inyectado:', cableConnId, cableFiber, '→ splitter', splitterMfId, 'port', splitterPort, 'id=' + spliceId);

  const cableDot = svgEl.querySelector(`.fiber-dot-inner[data-cable-conn="${cableConnId}"][data-fiber-num="${cableFiber}"]`);
  const splitterDot = svgEl.querySelector(`.fiber-dot-inner[data-manga-fiber-id="${splitterMfId}"]`);
  if (!cableDot || !splitterDot) { console.warn('[INJECT-SPLICE] Dots no encontrados'); return; }

  function getPortGlobalPos(el) {
    const tag = el.tagName.toLowerCase();
    let x, y;
    if (tag === 'circle') { x = parseFloat(el.getAttribute('cx')); y = parseFloat(el.getAttribute('cy')); }
    else if (tag === 'rect') { x = parseFloat(el.getAttribute('x')) + parseFloat(el.getAttribute('width'))/2; y = parseFloat(el.getAttribute('y')) + parseFloat(el.getAttribute('height'))/2; }
    else return null;
    const block = el.closest('.vis-block');
    if (block) {
      const t = (block.getAttribute('transform') || '').match(/translate\(([\d.\-]+),\s*([\d.\-]+)\)/);
      if (t) { x += parseFloat(t[1]); y += parseFloat(t[2]); }
    }
    return { x, y };
  }

  const srcPos = getPortGlobalPos(cableDot);
  const tgtPos = getPortGlobalPos(splitterDot);
  if (!srcPos || !tgtPos) return;

  // Leer color REAL del jacket (el mismo que se ve en el SVG)
  function dotColor(dot, fallbackNum) {
    const g = dot.closest('.fiber-dot-group');
    if (g) {
      const j = g.querySelector('.fiber-jacket');
      if (j) { const c = j.getAttribute('fill'); if (c && c !== 'transparent' && c.startsWith('#')) return c; }
    }
    return tiaColor(fallbackNum);
  }
  const colIn = dotColor(cableDot, cableFiber);
  const colOut = dotColor(splitterDot, splitterPort > 0 ? splitterPort : 1);

  const isInput = splitterPort === 0;
  // stroke-dashoffset anima de END→START. INPUT: power va cable→splitter → END=cable. OUTPUT: power va splitter→cable → END=splitter
  var px1 = isInput ? tgtPos.x : srcPos.x, py1 = isInput ? tgtPos.y : srcPos.y;
  var px4 = isInput ? srcPos.x : tgtPos.x, py4 = isInput ? srcPos.y : tgtPos.y;
  console.log('[INJECT-SPLICE] DIR: isInput=' + isInput + ' cable.x=' + srcPos.x.toFixed(0) + ' splitter.x=' + tgtPos.x.toFixed(0) + ' px1=' + px1.toFixed(0) + ' px4=' + px4.toFixed(0) + ' dir=' + (px1 < px4 ? 'L→R' : 'R→L'));
  const dx = Math.abs(px4 - px1);
  const cpOff = Math.max(dx * 0.3, 40);
  const cpx1 = px1 < px4 ? px1 + cpOff : px1 - cpOff;
  const cpx2 = px1 < px4 ? px4 - cpOff : px4 + cpOff;
  const midX = (px1 + px4) / 2;
  const midY = (py1 + py4) / 2;
  const d = `M ${px1},${py1} C ${cpx1},${py1} ${cpx2},${py4} ${px4},${py4}`;

  const ns = 'http://www.w3.org/2000/svg';

  // Gradiente: 0% = color del dot en px1, 100% = color del dot en px4
  // Gradiente 0% (left) = splitter, 100% (right) = cable (segun bounding box del path)
  var leftX = Math.min(px1, px4, px1 < px4 ? px1 + cpOff : px1 - cpOff, px1 < px4 ? px4 - cpOff : px4 + cpOff);
  var rightX = Math.max(px1, px4, px1 < px4 ? px1 + cpOff : px1 - cpOff, px1 < px4 ? px4 - cpOff : px4 + cpOff);
  // Si el cable esta a la izquierda, cable color a 0%; si no, splitter a 0%
  var cableX = srcPos.x, splitterX = tgtPos.x;
  var colA = cableX <= splitterX ? colIn : colOut;  // color del dot IZQUIERDO
  var colB = cableX <= splitterX ? colOut : colIn;  // color del dot DERECHO
  let strokeVal = colA;
  if (colA !== colB) {
    const gid = 'grad-splice-' + spliceId;
    let defs = svgEl.querySelector('defs');
    if (!defs) { defs = document.createElementNS(ns, 'defs'); svgEl.insertBefore(defs, svgEl.firstChild); }
    if (!defs.querySelector('#' + gid)) {
      const grad = document.createElementNS(ns, 'linearGradient');
      grad.id = gid; grad.setAttribute('x1','0%'); grad.setAttribute('y1','0%'); grad.setAttribute('x2','100%'); grad.setAttribute('y2','0%');
      const s1 = document.createElementNS(ns, 'stop'); s1.setAttribute('offset','0%'); s1.setAttribute('stop-color',colA); s1.setAttribute('stop-opacity','1');
      const s2 = document.createElementNS(ns, 'stop'); s2.setAttribute('offset','50%'); s2.setAttribute('stop-color',colA); s2.setAttribute('stop-opacity','1');
      const s3 = document.createElementNS(ns, 'stop'); s3.setAttribute('offset','50%'); s3.setAttribute('stop-color',colB); s3.setAttribute('stop-opacity','1');
      const s4 = document.createElementNS(ns, 'stop'); s4.setAttribute('offset','100%'); s4.setAttribute('stop-color',colB); s4.setAttribute('stop-opacity','1');
      grad.append(s1, s2, s3, s4); defs.appendChild(grad);
    }
    strokeVal = 'url(#' + gid + ')';
  }

  // Detectar potencia y propagarla
  const cableHasPower = cableDot.getAttribute('data-has-power') === 'true' || hasPowerFromServer == 1 || hasPowerFromServer === true;
  const splitterHasPower = splitterDot.getAttribute('data-has-power') === 'true';
  const hasPower = cableHasPower || splitterHasPower;
  console.log('[INJECT-SPLICE] POWER: cableHasPower=' + cableHasPower + ' splitterHasPower=' + splitterHasPower + ' hasPowerFromServer=' + hasPowerFromServer + ' hasPower=' + hasPower);
  if (hasPower) {
    if (!cableHasPower) cableDot.setAttribute('data-has-power', 'true');
    if (!splitterHasPower) splitterDot.setAttribute('data-has-power', 'true');
    [cableDot, splitterDot].forEach(function(d) {
      var g = d.closest('.fiber-dot-group');
      if (g) {
        var j = g.querySelector('.fiber-jacket');
        if (j) j.classList.add('fiber-powered');
      }
    });
    // Si es OUTPUT del splitter (port > 0), la potencia fluye splitter→cable
    if (splitterPort > 0 || (splitterPort !== 0 && splitterPort !== '0')) {
      // Ya marcamos cableDot arriba, solo necesitamos que el data-flow se vea
    }
    // Si es INPUT del splitter, propagar potencia a TODAS las salidas
    if (splitterPort === 0 || splitterPort === '0') {
      var spId = splitterDot.getAttribute('data-splitter-id');
      if (spId) {
        var outDots = svgEl.querySelectorAll('.fiber-dot-inner[data-splitter-id="' + spId + '"][data-splitter-output]:not([data-splitter-output="0"])');
        outDots.forEach(function(od) {
          od.setAttribute('data-has-power', 'true');
          var og = od.closest('.fiber-dot-group');
          if (og) {
            var oj = og.querySelector('.fiber-jacket');
            if (oj) oj.classList.add('fiber-powered');
          }
          // Buscar splice path desde esta salida a un cable y activarle data-flow
          var omfId = od.getAttribute('data-manga-fiber-id');
          if (omfId) {
            var outSplice = svgEl.querySelector('.fl[data-splice][data-conn-out="' + omfId + '"]');
            if (outSplice) {
              outSplice.classList.add('data-flow');
              outSplice.setAttribute('data-active', 'true');
              outSplice.setAttribute('data-fusion-power', '9.4');
              outSplice.setAttribute('opacity', '0.85');
            }
          }
        });
      }
    }
  }
  const pathClass = 'fl' + (hasPower ? ' data-flow' : '');
  const pathOpacity = hasPower ? '0.85' : '0.8';

  // Splice path
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('class', pathClass); path.setAttribute('d', d);
  path.setAttribute('stroke', strokeVal); path.setAttribute('stroke-width','3.5');
  path.setAttribute('opacity', pathOpacity); path.setAttribute('fill','none');
  path.setAttribute('data-splice', spliceId);
  path.setAttribute('data-fiber-in', cableFiber);
  const mfFiberNum = splitterDot.getAttribute('data-fiber-num') || '';
  path.setAttribute('data-fiber-out', mfFiberNum);
  path.setAttribute('data-conn-in', cableConnId);
  path.setAttribute('data-conn-out', splitterMfId);
  path.setAttribute('data-fiber-color-in', colA); path.setAttribute('data-fiber-color-out', colB);
  path.setAttribute('data-active', hasPower ? 'true' : 'false');
  path.setAttribute('data-fusion-power', hasPower ? '9.4' : '');
  svgEl.appendChild(path);

  // Break button at midpoint
  const btnG = document.createElementNS(ns, 'g');
  btnG.setAttribute('style','cursor:pointer');
  btnG.setAttribute('class','break-fusion-btn');
  btnG.setAttribute('data-splice', spliceId);
  btnG.addEventListener('click', function(ev) { ev.stopPropagation(); confirmBreakSplice(spliceId); });
  const r = document.createElementNS(ns, 'rect');
  r.setAttribute('x', midX - 20); r.setAttribute('y', midY - 10);
  r.setAttribute('width','40'); r.setAttribute('height','20'); r.setAttribute('rx','4');
  r.setAttribute('fill','rgba(233,69,96,0.8)'); r.setAttribute('stroke','#e94560'); r.setAttribute('stroke-width','1');
  const t = document.createElementNS(ns, 'text');
  t.setAttribute('x', midX); t.setAttribute('y', midY + 4);
  t.setAttribute('fill','#fff'); t.setAttribute('font-family','sans-serif');
  t.setAttribute('font-size','12'); t.setAttribute('text-anchor','middle');
  t.setAttribute('pointer-events','none');
  t.textContent = '✂️';
  btnG.append(r, t);
  svgEl.appendChild(btnG);

  // Marcar splitter fiber dot
  splitterDot.setAttribute('data-has-fusion','true');
  cableDot.setAttribute('data-has-fusion','true');
  const cg = cableDot.closest('.fiber-dot-group');
  if (cg) cg.classList.add('fiber-connected');
  
  // ⭐ Remover ⚡ del texto SVG al crear splice (igual que en injectFusion)
  [cableDot, splitterDot].forEach(function(dot) {
    var fn = dot.getAttribute('data-fiber-num');
    var dotY = parseFloat(dot.getAttribute('cy'));
    svgEl.querySelectorAll('text').forEach(function(tx) {
      var txY = parseFloat(tx.getAttribute('y'));
      if (isNaN(txY) || isNaN(dotY)) return;
      if (Math.abs(txY - dotY) > 4) return;
      if (tx.textContent.includes('#' + fn)) {
        tx.textContent = tx.textContent.replace(/^[\u26A1]+/, '');
      }
    });
  });

  // Actualizar contador
  const infoEl = document.getElementById('vis-splitter-info');
  if (infoEl) {
    infoEl.innerHTML = infoEl.innerHTML.replace(/(Splices:\s*)(\d+)/, (m, p1) => p1 + ((parseInt(document.querySelectorAll('.fl[data-splice]').length) || 1)));
  }

  // ⭐ Refresh completo de potencia desde el servidor para sync todos los indicadores
  refreshPowerDotsFromServer();
}

// === POST-RENDER: corregir gradientes de fusiones y splices segun posicion real de los dots ===
function fixFusionGradients() {
  var t0 = performance.now();
  const svgEl = document.querySelector('#vis-svg svg');
  if (!svgEl) { console.log('[FIX-GRAD] SVG no encontrado'); return; }
  var fus = svgEl.querySelectorAll('.fl[data-fusion]:not([data-splice])');
  var spl = svgEl.querySelectorAll('.fl[data-splice]');
  console.log('[FIX-GRAD] Iniciando: ' + fus.length + ' fusiones, ' + spl.length + ' splices');
  // Corregir fusiones cable-cable (.fl[data-fusion])
  fus.forEach(function(p) {
    var connIn = p.getAttribute('data-conn-in');
    var fiberIn = p.getAttribute('data-fiber-in');
    var connOut = p.getAttribute('data-conn-out');
    var fiberOut = p.getAttribute('data-fiber-out');
    if (!connIn || !fiberIn || !connOut || !fiberOut) return;
    var inDot = svgEl.querySelector('.fiber-dot-inner[data-cable-conn="' + connIn + '"][data-fiber-num="' + fiberIn + '"]');
    var outDot = svgEl.querySelector('.fiber-dot-inner[data-cable-conn="' + connOut + '"][data-fiber-num="' + fiberOut + '"]');
    if (!inDot || !outDot) return;
    function getX(el) {
      var tag = el.tagName.toLowerCase();
      var x = tag === 'circle' ? parseFloat(el.getAttribute('cx')) : (tag === 'rect' ? parseFloat(el.getAttribute('x')) + parseFloat(el.getAttribute('width'))/2 : 0);
      var block = el.closest('.vis-block');
      if (block) { var t = (block.getAttribute('transform') || '').match(/translate\(([\d.\-]+),/); if (t) x += parseFloat(t[1]); }
      return x;
    }
    var xi = getX(inDot);
    var xo = getX(outDot);
    var colorIn = p.getAttribute('data-fiber-color-in') || tiaColor(parseInt(fiberIn));
    var colorOut = p.getAttribute('data-fiber-color-out') || tiaColor(parseInt(fiberOut));
    var correctLeft = xi <= xo ? colorIn : colorOut;
    var correctRight = xi <= xo ? colorOut : colorIn;
    var fid = p.getAttribute('data-fusion');
    if (!fid) return;
    var grad = svgEl.querySelector('defs #grad-' + fid);
    if (!grad) return;
    var stops = grad.querySelectorAll('stop');
    if (stops.length >= 4) {
      stops[0].setAttribute('stop-color', correctLeft);
      stops[1].setAttribute('stop-color', correctLeft);
      stops[2].setAttribute('stop-color', correctRight);
      stops[3].setAttribute('stop-color', correctRight);
      p.setAttribute('data-fiber-color-in', correctLeft);
      p.setAttribute('data-fiber-color-out', correctRight);
      p.setAttribute('data-fiber-color', correctLeft);
    }
  });
  var fixed = 0;
  // Corregir splices cable-splitter (.fl[data-splice])
  svgEl.querySelectorAll('.fl[data-splice]').forEach(function(p) {
    var cableConnId = p.getAttribute('data-conn-in');
    var cableFiberNum = parseInt(p.getAttribute('data-fiber-in'));
    var mfId = p.getAttribute('data-conn-out');
    var sid = p.getAttribute('data-splice');
    if (!cableConnId || !cableFiberNum || !mfId) { console.log('[FIX-GRAD] splice ' + sid + ' sin data-conn-in/fiber-in/conn-out'); return; }
    var cableDot = svgEl.querySelector('.fiber-dot-inner[data-cable-conn="' + cableConnId + '"][data-fiber-num="' + cableFiberNum + '"]');
    var splitterDot = svgEl.querySelector('.fiber-dot-inner[data-manga-fiber-id="' + mfId + '"]');
    if (!cableDot) { console.log('[FIX-GRAD] splice ' + sid + ' cableDot no encontrado: conn=' + cableConnId + ' fib=' + cableFiberNum); return; }
    if (!splitterDot) { console.log('[FIX-GRAD] splice ' + sid + ' splitterDot no encontrado: mfId=' + mfId); return; }
    function getX(el) {
      var tag = el.tagName.toLowerCase();
      var x = tag === 'circle' ? parseFloat(el.getAttribute('cx')) : (tag === 'rect' ? parseFloat(el.getAttribute('x')) + parseFloat(el.getAttribute('width'))/2 : 0);
      var block = el.closest('.vis-block');
      if (block) { var t = (block.getAttribute('transform') || '').match(/translate\(([\d.\-]+),/); if (t) x += parseFloat(t[1]); }
      return x;
    }
    var xc = getX(cableDot);
    var xs = getX(splitterDot);
    var cableColor = p.getAttribute('data-fiber-color-in');
    var splitterColor = p.getAttribute('data-fiber-color-out');
    if (!cableColor || !splitterColor) { console.log('[FIX-GRAD] splice ' + sid + ' sin colors'); return; }
    var correctLeft = xc <= xs ? cableColor : splitterColor;
    var correctRight = xc <= xs ? splitterColor : cableColor;
    if (!sid) return;
    var grad = svgEl.querySelector('defs #grad-splice-' + sid) || svgEl.querySelector('defs #grad-splice-in-' + sid);
    if (!grad) { console.log('[FIX-GRAD] splice ' + sid + ' gradiente no encontrado'); return; }
    var stops = grad.querySelectorAll('stop');
    if (stops.length >= 4) {
      stops[0].setAttribute('stop-color', correctLeft);
      stops[1].setAttribute('stop-color', correctLeft);
      stops[2].setAttribute('stop-color', correctRight);
      stops[3].setAttribute('stop-color', correctRight);
      p.setAttribute('data-fiber-color-in', correctLeft);
      p.setAttribute('data-fiber-color-out', correctRight);
      fixed++;
    }
  });
  console.log('[FIX-GRAD] Completo en ' + (performance.now() - t0).toFixed(0) + 'ms, corregidos: ' + fixed);
}

// ========== STATE ==========
const state = {
  olts: [], naps: [], mangas: [], cables: [],
  folders: [],
  expandedFolders: new Set(),
  selectedNode: null, // { type: 'folder'|'item', id: ... }
  markers: { olt: [], nap: [], manga: [], cable: [] },
  cablePolylines: [],
  selectedCablePoints: [],
  cableDrawingPoints: [],
  cableTempLine: null,
  tempMarkers: [],
  mapClickHandler: null,
  pendingLat: null,
  pendingLng: null,
  pendingFiberConnections: [],
  cablePendingConnection: null,
  // Active folder (bold) — items created go here automatically
  activeFolderId: null,
  // Visibility checkboxes (item keys "type:id" that are visible on map)
  visibleItems: new Set(),
  // Drag & drop
  dragData: null,
  contextTarget: null, // { type: 'folder'|'item', id: ... }
  fiberContext: null, // { napId, portNum } for SVG fiber right-click
  currentVisualizerType: null, // 'nap' or 'manga'
  currentVisualizerId: null
};

const API = '/api';


// ========== CUSTOM DIALOGS ==========
var _confirmCallback = null;

function showConfirmDialog(msg, onConfirm, onCancel) {
  _confirmCallback = { ok: onConfirm || function(){}, cancel: onCancel || function(){} };
  var h = '<p style="white-space:pre-wrap;margin:10px 0;font-size:14px;line-height:1.5">' + (msg || '') + '</p>';
  h += '<div class="btn-group" style="margin-top:16px">';
  h += '<button class="btn-primary" onclick="closeModal(); var cb = _confirmCallback ? _confirmCallback.ok : null; _confirmCallback = null; if(cb) cb()">&#x2705; Si</button>';
  h += '<button class="btn-secondary" onclick="closeModal(); var cb = _confirmCallback ? _confirmCallback.cancel : null; _confirmCallback = null; if(cb) cb()">&#x274c; No</button>';
  h += '</div>';
  openModal(h);
}

function showAlertDialog(msg) {
  var h = '<p style="white-space:pre-wrap;margin:10px 0;font-size:14px;line-height:1.5">' + (msg || '') + '</p>';
  h += '<div class="btn-group" style="margin-top:16px"><button class="btn-primary" onclick="closeModal()">OK</button></div>';
  openModal(h);
}


// ========== MAP ==========
const map = L.map('map', {
  center: [18.4861, -69.9312],
  zoom: 13,
  zoomControl: true,
});

// ====== MAPA BASE: CartoDB Positron (limpio, tipo Google) ======
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
  maxZoom: 19,
});

const cartoLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/">CARTO</a>',
  maxZoom: 19,
});

const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: '&copy; <a href="https://esri.com">Esri</a>, Maxar, Earthstar Geographics',
  maxZoom: 18,
});

// Default: CartoDB Positron (limpio)
cartoLayer.addTo(map);

// Layer switcher
L.control.layers({
  '🗺️ Mapa Limpio (CartoDB)': cartoLayer,
  '🌍 Satélite (Esri)': satelliteLayer,
  '📍 Detallado (OSM)': osmLayer,
}).addTo(map);

L.control.locate({ position: 'topleft' }).addTo(map);

// ========== USER LOCATION (DISABLED) ==========

// ========== ICONS ==========
function createMarkerIcon(type) {
  const icons = {
    olt:  { url: 'img/olt.png',  size: [40, 40], anchor: [20, 20] },
    nap:  { url: 'img/nap.png',  size: [40, 40], anchor: [20, 20] },
    manga: { url: 'img/manga.png', size: [40, 40], anchor: [20, 20] }
  };
  const cfg = icons[type] || { url: '', size: [28, 28], anchor: [14, 14] };
  return L.icon({
    iconUrl: cfg.url,
    iconSize: cfg.size,
    iconAnchor: cfg.anchor,
    popupAnchor: [0, -cfg.anchor[1]]
  });
}

// ========== CABLE FIBER PREVIEW ==========
function getFiberPreviewHtml(fiberCount) {
  let html = '<div style="max-height:200px;overflow-y:auto">';
  html += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
  html += '<tr style="background:#0f3460;color:#fff"><th style="padding:4px 6px">#</th><th style="padding:4px 6px">Color</th><th style="padding:4px 6px">Nombre</th><th style="padding:4px 6px">Estado</th></tr>';
  for (let i = 1; i <= fiberCount; i++) {
    const colHex = tiaColor(i);
    const colName = tiaColorName(i);
    const borderColor = colHex === '#ffffff' ? '#888' : colHex;
    html += '<tr style="border-bottom:1px solid #333">';
    html += '<td style="padding:4px 6px;color:#888">' + i + '</td>';
    html += '<td style="padding:4px 6px"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + colHex + ';border:2px solid ' + borderColor + ';vertical-align:middle"></span></td>';
    html += '<td style="padding:4px 6px;color:#ccc">' + colName + '</td>';
    html += '<td style="padding:4px 6px;color:#888">—</td>';
    html += '</tr>';
  }
  html += '</table></div>';
  return html;
}

function showCableFiberPreview() {
  const sel = document.getElementById('cable-type-id');
  const opt = sel.options[sel.selectedIndex];
  const fiberCount = opt && opt.value ? (parseInt(opt.dataset.fiberCount) || parseInt(document.getElementById('cable-fibers').value) || 12) : (parseInt(document.getElementById('cable-fibers').value) || 12);
  showModal('🔍 Preview de fibras (' + fiberCount + 'f) — TIA/EIA-598', getFiberPreviewHtml(fiberCount));
}

function showFiberPreviewFromPanel() {
  const fiberCount = parseInt(document.getElementById('cable-fibers').value) || 12;
  showModal('🔍 Preview de fibras (' + fiberCount + 'f) — TIA/EIA-598', getFiberPreviewHtml(fiberCount));
}

// ========== API HELPERS ==========
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  return res.json();
}

// ========== LOAD ALL DATA ==========
async function loadAll() {
  const data = await api('/map-data');
  state.olts = data.olts;
  state.naps = data.naps;
  state.mangas = data.mangas;
  state.cables = data.cables;
  state._cablePoints = data.cablePoints || [];
  state.folders = await api('/folders');
  renderMapMarkers(data);
  renderCableLines(data);
  renderTree();
  updateStats();
  // Show nothing by default — user checks items to see them
  setTimeout(updateMapVisibility, 100);
}

// ========== UPDATE STATS ==========
async function updateStats() {
  const s = await api('/stats');
  document.getElementById('stat-olts').textContent = s.olts;
  document.getElementById('stat-naps').textContent = s.naps;
  document.getElementById('stat-mangas').textContent = s.mangas;
  document.getElementById('stat-cables').textContent = s.cables;
  document.getElementById('stat-active').textContent = s.activeFibers;
}

// ========== MAP MARKERS ==========
function renderMapMarkers(data) {
  Object.values(state.markers).forEach(arr => arr.forEach(m => map.removeLayer(m)));
  state.markers = { olt: [], nap: [], manga: [], cable: [] };

  data.olts.forEach(o => {
    const m = L.marker([o.lat, o.lng], { icon: createMarkerIcon('olt') })
      .addTo(map)
      .bindPopup(`<div class="popup-title">⚡ ${o.name}</div><div class="popup-info">${o.description || ''}<br>Puertos: ${o.ports_count}</div><div style="display:flex;gap:6px;margin-top:6px"><a class="popup-btn" onclick="openOLTVisualizer(${o.id})">🔍 Abrir</a><a class="popup-btn" onclick="showEditOLT(${o.id})">Editar</a></div>`);
    m._entityType = 'olt'; m._entityId = o.id;
    m.on('contextmenu', function(e) { showMarkerContextMenu(e.originalEvent, 'olt', o.id, o.name, o.lat, o.lng); });
    state.markers.olt.push(m);
  });

  data.naps.forEach(n => {
    const m = L.marker([n.lat, n.lng], { icon: createMarkerIcon('nap') })
      .addTo(map)
      .bindPopup(`<div class="popup-title">📦 ${n.name}</div><div class="popup-info">Splitter: ${n.splitter || 'N/A'}<br>Clientes: ${n.clients || 0}/${n.port_capacity}</div><a class="popup-btn" onclick="openVisualizer(${n.id})">Abrir</a>`);
    m._entityType = 'nap'; m._entityId = n.id;
    m.on('contextmenu', function(e) { showMarkerContextMenu(e.originalEvent, 'nap', n.id, n.name, n.lat, n.lng); });
    state.markers.nap.push(m);
  });

  data.mangas.forEach(mg => {
    const m = L.marker([mg.lat, mg.lng], { icon: createMarkerIcon('manga') })
      .addTo(map)
      .bindPopup(`<div class="popup-title">🧶 ${mg.name}</div><div class="popup-info">${mg.description || ''}</div><a class="popup-btn" onclick="openMangaVisualizer(${mg.id})">🔍 Abrir</a>`);
    m._entityType = 'manga'; m._entityId = mg.id;
    m.on('contextmenu', function(e) { showMarkerContextMenu(e.originalEvent, 'manga', mg.id, mg.name, mg.lat, mg.lng); });
    state.markers.manga.push(m);
  });
}

// ========== CABLE LINES ==========
function renderCableLines(data) {
  state.cablePolylines.forEach(p => map.removeLayer(p));
  state.cablePolylines = [];

  data.cables.forEach(c => {
    const points = data.cablePoints.filter(p => p.cable_id === c.id);
    if (points.length < 2) return;
    const latlngs = points.map(p => [p.lat, p.lng]);
    const hasActive = c.active_fibers > 0;
    const polyline = L.polyline(latlngs, {
      color: c.color || '#3388ff',
      weight: 3,
      opacity: 0.8,
    }).addTo(map);
    
    polyline.bindPopup(`
      <div style="min-width:180px">
        <div style="font-weight:bold;font-size:14px;margin-bottom:5px">🔌 ${escHtml(c.name)}</div>
        <div style="font-size:12px;color:#888">${c.fiber_count || '?'} fibras · ${hasActive ? '⚡ ' + c.active_fibers + ' activas' : '💤 inactivo'}</div>
        <div style="margin-top:8px">
          <a class="popup-btn" onclick="showFiberStatus(${c.id})" style="display:inline-block;margin-bottom:4px">🔍 Ver fibras</a>
          <a class="popup-btn" onclick="showCableRouting(${c.id})" style="display:inline-block">🗺 Ruteo</a>
        </div>
      </div>
    `);
    
    // Right-click context menu on cable
    polyline.on('contextmenu', function(e) {
      showCableContextMenu(e.originalEvent, c.id, c.name, e.latlng.lat, e.latlng.lng);
    });
    

    
    polyline._entityType = 'cable'; polyline._entityId = c.id;
    state.cablePolylines.push(polyline);
  });
}

// ========== UTILITY: Get item name by type/id ==========
function getItemName(type, id) {
  const arr = type === 'olt' ? state.olts : type === 'nap' ? state.naps : type === 'manga' ? state.mangas : state.cables;
  const item = arr.find(x => x.id == id);
  return item ? item.name : `? (${type}#${id})`;
}

function getItemIcon(type) {
  return type === 'olt' ? '⚡' : type === 'nap' ? '📦' : type === 'manga' ? '🧶' : '🔌';
}

// ===================================================================
// ========== FOLDER TREE (Windows Explorer Style) ==========
// ===================================================================

function renderTree() {
  const container = document.getElementById('tree-container');
  const rootFolders = state.folders.filter(f => !f.parent_id);
  const rootItems = getRootItems();
  
  let html = '';
  
  // Render root folders
  rootFolders.forEach(f => {
    html += renderTreeNode(f, 0);
  });
  
  // Render items sin carpeta DIRECTAMENTE en la raiz (no dentro de una carpeta)
  rootItems.forEach(function(item) {
    html += renderLeafItem(item, 0);
  });
  
  // Empty state
  if (rootFolders.length === 0 && rootItems.length === 0) {
    html = `<div style="text-align:center;padding:30px;color:#888;font-size:13px">
      📁 No hay carpetas aún<br><br>
      <button class="tree-btn" onclick="showNewFolderDialog(null)">Crear primera carpeta</button>
    </div>`;
  }
  
  container.innerHTML = html;
  
  // Update stats
  const totalItems = state.olts.length + state.naps.length + state.mangas.length + state.cables.length;
  document.getElementById('tree-count').textContent = totalItems + ' elementos';
  
}

function getRootItems() {
  // Items that are not in any folder
  const allFolderItemIds = {};
  state.folders.forEach(f => {
    (f.items || []).forEach(item => {
      const key = item.item_type + ':' + item.item_id;
      allFolderItemIds[key] = true;
    });
  });
  const unassigned = [];
  ['olt', 'nap', 'manga', 'cable'].forEach(type => {
    const arr = type === 'olt' ? state.olts : type === 'nap' ? state.naps : type === 'manga' ? state.mangas : state.cables;
    arr.forEach(item => {
      const key = type + ':' + item.id;
      if (!allFolderItemIds[key]) {
        unassigned.push({ item_type: type, item_id: item.id });
      }
    });
  });
  return unassigned;
}

function findItem(type, id) {
  const arr = type === 'olt' ? state.olts : type === 'nap' ? state.naps : type === 'manga' ? state.mangas : state.cables;
  return arr.find(x => x.id == id);
}

function renderTreeNode(folder, depth) {
  const children = state.folders.filter(f => f.parent_id == folder.id);
  const items = folder.items || [];
  const hasChildren = children.length > 0 || items.length > 0;
  const isExpanded = state.expandedFolders.has(folder.id);
  const isSelected = state.selectedNode && state.selectedNode.type === 'folder' && state.selectedNode.id == folder.id;
  
  let html = `<div class="tree-node" data-folder-id="${folder.id}" data-depth="${depth}">`;
  const isActive = state.activeFolderId == folder.id;
  // Visibility checkbox
  const folderKey = 'folder:' + folder.id;
  const isChecked = state.visibleItems.has(folderKey);
  html += `<div class="tree-row ${isSelected ? 'selected' : ''} ${isActive ? 'tree-row-active' : ''}" 
    ondblclick="event.stopPropagation();setActiveFolder(${folder.id});"
    onclick="selectNode('folder', ${folder.id})"
    oncontextmenu="showTreeContextMenu(event, 'folder', ${folder.id})"
    draggable="true"
    ondragstart="onDragStart(event, 'folder', ${folder.id})"
    ondragover="onDragOver(event, ${folder.id})"
    ondragleave="onDragLeave(event)"
    ondrop="onDrop(event, ${folder.id})">`;
  
  // Checkbox
  html += `<span class="tree-checkbox ${isChecked ? 'checked' : ''}" onclick="event.stopPropagation();toggleFolderVisibility(${folder.id})">${isChecked ? '☑' : '☐'}</span>`;
  // Toggle
  html += `<span class="tree-toggle ${!hasChildren ? 'no-children' : ''}" onclick="event.stopPropagation();toggleFolderExpand(${folder.id})">${isExpanded ? '▼' : '▶'}</span>`;
  html += `<span class="tree-icon">📁</span>`;
  html += `<span class="tree-label ${isActive ? 'tree-label-active' : ''}">${isActive ? '📌 ' : ''}${escHtml(folder.name)}</span>`;
  if (isActive) {
    html += `<span class="tree-badge-active">📂 activa</span>`;
  }
  
  // Count badge
  const totalItems = children.length + items.length;
  if (totalItems > 0) {
    html += `<span class="tree-badge">${totalItems}</span>`;
  }
  
  html += `</div>`; // end .tree-row
  
  // Children (expanded) — also a drop zone for the folder
  html += `<div class="tree-children ${isExpanded ? 'expanded' : ''}" 
    ondragover="onDragOver(event, ${folder.id})" 
    ondragleave="onDragLeave(event)" 
    ondrop="onDrop(event, ${folder.id})">`;
  if (isExpanded) {
    // Render sub-folders first
    children.forEach(child => {
      html += renderTreeNode(child, depth + 1);
    });
    // Then render items
    items.forEach(item => {
      const itemObj = findItem(item.item_type, item.item_id);
      if (itemObj) {
        html += renderTreeItem(item, depth + 1, folder.id);
      }
    });
  }
  html += `</div>`; // end .tree-children
  
  html += `</div>`; // end .tree-node
  return html;
}

function renderTreeItem(folderItem, depth, parentFolderId) {
  const itemObj = findItem(folderItem.item_type, folderItem.item_id);
  if (!itemObj) return '';
  
  const isSelected = state.selectedNode && state.selectedNode.type === 'item' && state.selectedNode.id == folderItem.id;
  const icon = getItemIcon(folderItem.item_type);
  
  // Details for the badge
  let badge = '';
  if (folderItem.item_type === 'nap') {
    badge = `<span class="tree-badge">${itemObj.clients || 0}/${itemObj.port_capacity}</span>`;
  } else if (folderItem.item_type === 'olt') {
    badge = `<span class="tree-badge">${itemObj.ports_count ? itemObj.ports_count + ' pts' : '?'}</span>`;
  } else if (folderItem.item_type === 'cable') {
    const fc = itemObj.fiber_count || '?';
    badge = `<span class="tree-badge tree-badge-fiber" style="background:#0f3460;color:#00d4ff;font-weight:bold">${fc}f</span>`;
  }
  
  const itemKey = folderItem.item_type + ':' + folderItem.item_id;
  const isChecked = state.visibleItems.has(itemKey);
  
  return `<div class="tree-node" data-item-id="${folderItem.id}" data-depth="${depth + 1}">
    <div class="tree-row ${isSelected ? 'selected' : ''}" 
      style="padding-left:${15 + (depth + 1) * 18}px"
      onclick="selectNode('item', ${folderItem.id}); openItem('${folderItem.item_type}', ${folderItem.item_id})"
      ondblclick="event.stopPropagation();focusItemOnMap('${folderItem.item_type}', ${folderItem.item_id})"
      oncontextmenu="showTreeContextMenu(event, 'item', ${folderItem.id})"
      draggable="true"
      ondragstart="onDragStart(event, 'item', ${folderItem.id})"
      ondragover="onDragOver(event, ${parentFolderId})"
      ondragleave="onDragLeave(event)"
      ondrop="onDrop(event, ${parentFolderId})">
      <span class="tree-checkbox ${isChecked ? 'checked' : ''}" onclick="event.stopPropagation();toggleItemVisibility('${folderItem.item_type}', ${folderItem.item_id})">${isChecked ? '☑' : '☐'}</span>
      <span class="tree-toggle no-children">▶</span>
      <span class="tree-icon">${icon}</span>
      <span class="tree-label">${escHtml(itemObj.name)}</span>
      ${badge}
      <span class="tree-delete-btn" onclick=\"event.stopPropagation();showConfirmDialog('¿Eliminar permanentemente ${escHtml(itemObj.name)}?', function() { deleteTreeItem('${folderItem.item_type}', ${folderItem.item_id}) })\" title="Eliminar elemento">🗑️</span>
    </div>
  </div>`;
}

function renderLeafItem(rootItem, depth) {
  const itemObj = findItem(rootItem.item_type, rootItem.item_id);
  if (!itemObj) return '';
  
  var compositeId = rootItem.id || (rootItem.item_type + '_' + rootItem.item_id);
  var isSelected = state.selectedNode && state.selectedNode.type === 'item' && state.selectedNode.id == compositeId;
  var icon = getItemIcon(rootItem.item_type);
  var itemKey = rootItem.item_type + ':' + rootItem.item_id;
  var isChecked = state.visibleItems.has(itemKey);
  
  // Badge
  var badge = '';
  if (rootItem.item_type === 'nap') {
    badge = '<span class="tree-badge">' + (itemObj.clients || 0) + '/' + (itemObj.port_capacity) + '</span>';
  } else if (rootItem.item_type === 'olt') {
    badge = '<span class="tree-badge">' + (itemObj.ports_count ? itemObj.ports_count + ' pts' : '?') + '</span>';
  } else if (rootItem.item_type === 'cable') {
    var fc = itemObj.fiber_count || '?';
    badge = '<span class="tree-badge tree-badge-fiber" style="background:#0f3460;color:#00d4ff;font-weight:bold">' + fc + 'f</span>';
  }
  
  return '<div class="tree-node" data-item-id="' + compositeId + '" data-depth="' + (depth + 1) + '">' +
    '<div class="tree-row ' + (isSelected ? 'selected' : '') + '" ' +
      'style="padding-left:' + (15 + (depth + 1) * 18) + 'px"' +
      'onclick="selectNode(\'item\', \'' + compositeId + '\'); openItem(\'' + rootItem.item_type + '\', ' + rootItem.item_id + ')"' +
      'ondblclick="event.stopPropagation();focusItemOnMap(\'' + rootItem.item_type + '\', ' + rootItem.item_id + ')"' +
      'oncontextmenu="showTreeContextMenu(event, \'item\', \'' + compositeId + '\')" ' +
      'draggable="true" ' +
      'ondragstart="onDragStart(event, \'item\', \'' + compositeId + '\')">' +
      '<span class="tree-checkbox ' + (isChecked ? 'checked' : '') + '" onclick="event.stopPropagation();toggleItemVisibility(\'' + rootItem.item_type + '\', ' + rootItem.item_id + ')">' + (isChecked ? '☑' : '☐') + '</span>' +
      '<span class="tree-toggle no-children">▶</span>' +
      '<span class="tree-icon">' + icon + '</span>' +
      '<span class="tree-label">' + escHtml(itemObj.name) + '</span>' +
      badge +
      '<span class="tree-delete-btn" onclick="event.stopPropagation();if(confirm(\'¿Eliminar permanentemente ' + escHtml(itemObj.name) + '?\')) deleteTreeItem(\'' + rootItem.item_type + '\', ' + rootItem.item_id + ')" title="Eliminar elemento">🗑️</span>' +
    '</div>' +
  '</div>';
}

// ========== TREE CONTROLS ==========
function toggleFolderExpand(folderId) {
  if (state.expandedFolders.has(folderId)) {
    state.expandedFolders.delete(folderId);
  } else {
    state.expandedFolders.add(folderId);
  }
  renderTree();
}

// Set active folder (bold) — new items go here automatically
function setActiveFolder(folderId) {
  if (state.activeFolderId == folderId) {
    // Toggle off if double-clicking same folder
    state.activeFolderId = null;
    document.getElementById('tree-active-folder').textContent = '📌 Doble clic en carpeta para hacerla activa';
    showToast('📌 Carpeta desactivada');
  } else {
    state.activeFolderId = folderId;
    // Auto-expand so user can see it
    state.expandedFolders.add(folderId);
    const name = state.folders.find(f => f.id == folderId)?.name || '';
    document.getElementById('tree-active-folder').textContent = '📌 Activa: ' + name + ' — Items van aquí automáticamente';
    showToast('📌 Carpeta activa: ' + name);
    
    // ⭐ Al activar carpeta, mostrar sus items en el mapa automaticamente
    // Recorrer items de esta carpeta y subcarpetas
    (function showAllItems(fId) {
      var folder = state.folders.find(function(f) { return f.id == fId; });
      if (!folder) return;
      // Mostrar items directos
      if (folder.items) {
        folder.items.forEach(function(item) {
          var ik = item.item_type + ':' + item.item_id;
          state.visibleItems.add(ik);
        });
      }
      // Mostrar items en subcarpetas
      state.folders.forEach(function(f) {
        if (f.parent_id == fId) showAllItems(f.id);
      });
      // Marcar la carpeta como visible
      state.visibleItems.add('folder:' + fId);
    })(folderId);
    
    updateMapVisibility();
  }
  renderTree();
}

// Toggle folder visibility (checkbox) - show/hide all children on map
function toggleFolderVisibility(folderId) {
  const key = 'folder:' + folderId;
  const isNowVisible = !state.visibleItems.has(key);
  
  // Recursively toggle folder and all children
  function toggleRecursive(fId, visible) {
    const fk = 'folder:' + fId;
    if (visible) state.visibleItems.add(fk); else state.visibleItems.delete(fk);
    
    // Toggle all items in this folder
    const folder = state.folders.find(f => f.id == fId);
    if (folder && folder.items) {
      folder.items.forEach(item => {
        const ik = item.item_type + ':' + item.item_id;
        if (visible) state.visibleItems.add(ik); else state.visibleItems.delete(ik);
      });
    }
    // Toggle all sub-folders
    state.folders.filter(f => f.parent_id == fId).forEach(child => toggleRecursive(child.id, visible));
  }
  
  toggleRecursive(folderId, isNowVisible);
  renderTree();
  updateMapVisibility();
}

// Toggle individual item visibility on map
function toggleItemVisibility(type, id) {
  const key = type + ':' + id;
  if (state.visibleItems.has(key)) {
    state.visibleItems.delete(key);
  } else {
    state.visibleItems.add(key);
  }
  renderTree();
  updateMapVisibility();
}

// Update map markers based on visible items
function updateMapVisibility() {
  // Hide all markers first
  Object.values(state.markers).forEach(arr => arr.forEach(m => {
    if (map.hasLayer(m)) map.removeLayer(m);
  }));
  state.cablePolylines.forEach(p => { if (map.hasLayer(p)) map.removeLayer(p); });
  
  // Show only markers for visible items (filtrados por ID)
  state.visibleItems.forEach(key => {
    const parts = key.split(':');
    const type = parts[0];
    if (type === 'folder') return;
    const id = parseInt(parts[1]);
    
    if (type === 'olt') {
      state.markers.olt.forEach(m => { if (m._entityId === id) m.addTo(map); });
    } else if (type === 'nap') {
      state.markers.nap.forEach(m => { if (m._entityId === id) m.addTo(map); });
    } else if (type === 'manga') {
      state.markers.manga.forEach(m => { if (m._entityId === id) m.addTo(map); });
    } else if (type === 'cable') {
      state.cablePolylines.forEach(p => { if (p._entityId === id) p.addTo(map); });
    }
  });
  
  // Items visibles: SOLO los que el usuario ha activado manualmente.
  // Por defecto TODO oculto. Items nuevos se agregan automaticamente visibles.
}

function expandAllFolders() {
  state.folders.forEach(f => state.expandedFolders.add(f.id));
  renderTree();
}

function collapseAllFolders() {
  state.expandedFolders.clear();
  renderTree();
}

function toggleRootExpanded() {
  if (state.expandedFolders.has('__root')) {
    state.expandedFolders.delete('__root');
  } else {
    state.expandedFolders.add('__root');
  }
  renderTree();
}

function selectNode(type, id) {
  state.selectedNode = { type, id };
  // Update selection visually without full tree re-render
  document.querySelectorAll('.tree-row.selected').forEach(el => el.classList.remove('selected'));
  if (type === 'folder') {
    const row = document.querySelector(`[data-folder-id="${id}"] > .tree-row`);
    if (row) row.classList.add('selected');
  } else {
    const row = document.querySelector(`[data-item-id="${id}"] > .tree-row`);
    if (row) row.classList.add('selected');
  }
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ========== OPEN ITEM (from tree click) ==========
function openItem(type, id) {
  if (type === 'nap') openVisualizer(id);
  else if (type === 'manga') openMangaVisualizer(id);
  else if (type === 'olt') openOLTVisualizer(id);
  else if (type === 'cable') flyToCable(id);
}

function flyToItem(type, id) {
  const item = findItem(type, id);
  if (item) map.flyTo([item.lat, item.lng], 16, { duration: 0.8 });
}

function focusItemOnMap(type, id) {
  if (type === 'cable') {
    flyToCable(id);
  } else {
    flyToItem(type, id);
  }
}

function flyToCable(id) {
  const cable = state.cables.find(c => c.id == id);
  if (cable) {
    // Use cable points from the map data for the cable location
    const allCablePoints = state._cablePoints || [];
    const points = allCablePoints.filter(p => p.cable_id == id);
    if (points.length > 0) {
      const avgLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
      const avgLng = points.reduce((s, p) => s + p.lng, 0) / points.length;
      map.flyTo([avgLat, avgLng], 15, { duration: 0.8 });
    } else {
      // Fallback: zoom to a general view
      map.flyTo([19.45, -70.697], 13, { duration: 0.8 });
    }
    showToast(`🔌 ${cable.name}`);
  }
}

// ========== DIALOGS: NEW FOLDER ==========
function showNewFolderDialog(parentId) {
  const parentName = parentId ? (state.folders.find(f => f.id == parentId)?.name || 'raíz') : 'raíz';
  openModal(`
    <h3>📁 Nueva Carpeta</h3>
    <p style="font-size:12px;color:#888;margin-bottom:10px">Ubicación: <strong>${escHtml(parentName)}</strong></p>
    <label>Nombre de la carpeta</label>
    <input id="f-folder-name" placeholder="Ej: Zona Norte" />
    <div class="btn-group">
      <button class="btn-primary" onclick="confirmNewFolder(${parentId || 'null'})">Crear</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
  setTimeout(() => document.getElementById('f-folder-name')?.focus(), 100);
}

async function confirmNewFolder(parentId) {
  const name = document.getElementById('f-folder-name').value.trim();
  if (!name) { showAlertDialog('Escribe un nombre para la carpeta'); return; }
  await api('/folders', 'POST', { name, parent_id: parentId || null });
  if (parentId) state.expandedFolders.add(parentId);
  closeModal();
  await refreshFolders();
  renderTree();
}

// ========== DIALOGS: ADD ITEM TO FOLDER ==========
async function showAddToFolderDialog(folderId) {
  const folderName = folderId ? (state.folders.find(f => f.id == folderId)?.name || 'carpeta') : 'raíz';
  const unassigned = await api('/items-unassigned');
  
  // Also get all existing folder items to allow adding any item
  const allOlts = await api('/olts');
  const allNaps = await api('/naps');
  const allMangas = await api('/mangas');
  const allCables = await api('/cables');
  
  openModal(`
    <h3>➕ Agregar Item a Carpeta</h3>
    <p style="font-size:12px;color:#888;margin-bottom:10px">Destino: <strong>${escHtml(folderName)}</strong></p>
    
    <h4>⚡ OLTs</h4>
    <select id="f-add-item-type-olt">
      <option value="">— Seleccionar OLT —</option>
      ${allOlts.map(o => `<option value="${o.id}">${escHtml(o.name)}</option>`).join('')}
    </select>
    
    <h4>📦 NAPs</h4>
    <select id="f-add-item-type-nap">
      <option value="">— Seleccionar NAP —</option>
      ${allNaps.map(n => `<option value="${n.id}">${escHtml(n.name)}</option>`).join('')}
    </select>
    
    <h4>🧶 Mangas</h4>
    <select id="f-add-item-type-manga">
      <option value="">— Seleccionar Manga —</option>
      ${allMangas.map(m => `<option value="${m.id}">${escHtml(m.name)}</option>`).join('')}
    </select>
    
    <h4>🔌 Cables</h4>
    <select id="f-add-item-type-cable">
      <option value="">— Seleccionar Cable —</option>
      ${allCables.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('')}
    </select>
    
    <div class="btn-group">
      <button class="btn-primary" onclick="confirmAddToFolder(${folderId || 'null'})">Agregar</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

async function confirmAddToFolder(folderId) {
  const folderIdVal = folderId || state.contextTarget?.id;
  if (!folderIdVal) { showAlertDialog('Selecciona una carpeta primero'); return; }
  
  const oltId = document.getElementById('f-add-item-type-olt')?.value;
  const napId = document.getElementById('f-add-item-type-nap')?.value;
  const mangaId = document.getElementById('f-add-item-type-manga')?.value;
  const cableId = document.getElementById('f-add-item-type-cable')?.value;
  
  let count = 0;
  if (oltId) { await api('/folder-items', 'POST', { folder_id: folderIdVal, item_type: 'olt', item_id: parseInt(oltId) }); count++; }
  if (napId) { await api('/folder-items', 'POST', { folder_id: folderIdVal, item_type: 'nap', item_id: parseInt(napId) }); count++; }
  if (mangaId) { await api('/folder-items', 'POST', { folder_id: folderIdVal, item_type: 'manga', item_id: parseInt(mangaId) }); count++; }
  if (cableId) { await api('/folder-items', 'POST', { folder_id: folderIdVal, item_type: 'cable', item_id: parseInt(cableId) }); count++; }
  
  if (count === 0) { showAlertDialog('Selecciona al menos un item'); return; }
  
  closeModal();
  await refreshFolders();
  renderTree();
  showToast(`✅ ${count} item(s) agregado(s) a la carpeta`);
}

// ========== DIALOG: RENAME ==========
function showRenameDialog(type, id) {
  if (type === 'folder') {
    const folder = state.folders.find(f => f.id == id);
    if (!folder) return;
    openModal(`
      <h3>✏️ Renombrar Carpeta</h3>
      <label>Nombre</label>
      <input id="f-rename" value="${escHtml(folder.name)}" />
      <div class="btn-group">
        <button class="btn-primary" onclick="confirmRename('folder', ${id})">Guardar</button>
        <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
      </div>
    `);
    setTimeout(() => { const inp = document.getElementById('f-rename'); inp?.select(); inp?.focus(); }, 100);
  } else {
    // For items, we rename the actual entity
    const allItems = state.folders.flatMap(f => f.items || []);
    const fi = allItems.find(i => i.id == id);
    if (!fi) return;
    const itemObj = findItem(fi.item_type, fi.item_id);
    if (!itemObj) return;
    openModal(`
      <h3>✏️ Renombrar ${getItemIcon(fi.item_type)} ${escHtml(itemObj.name)}</h3>
      <label>Nuevo nombre</label>
      <input id="f-rename" value="${escHtml(itemObj.name)}" />
      <p style="font-size:11px;color:#888;margin-top:5px">Esto cambiará el nombre del elemento original.</p>
      <div class="btn-group">
        <button class="btn-primary" onclick="confirmRenameItem('${fi.item_type}', ${fi.item_id})">Guardar</button>
        <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
      </div>
    `);
    setTimeout(() => { const inp = document.getElementById('f-rename'); inp?.select(); inp?.focus(); }, 100);
  }
}

async function confirmRename(type, id) {
  const name = document.getElementById('f-rename').value.trim();
  if (!name) return;
  if (type === 'folder') {
    await api('/folders/' + id, 'PUT', { name });
  }
  closeModal();
  await refreshFolders();
  renderTree();
}

async function confirmRenameItem(itemType, itemId) {
  const name = document.getElementById('f-rename').value.trim();
  if (!name) return;
  await api('/' + itemType + 's/' + itemId, 'PUT', { name });
  closeModal();
  await refreshAll();
  renderTree();
}

// ========== DIALOG: MOVE TO... ==========
function showMoveDialog(type, id) {
  const folderTree = buildFolderSelectOptions();
  
  const currentLabel = type === 'folder' 
    ? (state.folders.find(f => f.id == id)?.name || '?')
    : (() => {
        const fi = state.folders.flatMap(f => f.items || []).find(i => i.id == id);
        return fi ? getItemName(fi.item_type, fi.item_id) : '?';
      })();
  
  openModal(`
    <h3>📂 Mover "${escHtml(currentLabel)}"</h3>
    <label>Selecciona la carpeta destino</label>
    <select id="f-move-target">
      <option value="">— Raíz (sin carpeta) —</option>
      ${folderTree}
    </select>
    <div class="btn-group">
      <button class="btn-primary" onclick="confirmMove('${type}', ${id})">Mover</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

function buildFolderSelectOptions(excludeId = null, parentId = null, depth = 0) {
  let html = '';
  const folders = state.folders.filter(f => f.parent_id == parentId);
  folders.forEach(f => {
    if (excludeId && f.id == excludeId) return;
    const indent = '&nbsp;&nbsp;'.repeat(depth);
    const prefix = depth > 0 ? '└ ' : '';
    html += `<option value="${f.id}">${indent}${prefix}${escHtml(f.name)}</option>`;
    html += buildFolderSelectOptions(excludeId, f.id, depth + 1);
  });
  return html;
}

async function confirmMove(type, id) {
  const targetFolderId = document.getElementById('f-move-target').value;
  
  if (type === 'folder') {
    await api('/folders/' + id + '/move', 'PUT', { parent_id: targetFolderId ? parseInt(targetFolderId) : null });
    if (targetFolderId) state.expandedFolders.add(parseInt(targetFolderId));
  } else {
    // Move item to another folder (or remove from folder)
    const fi = state.folders.flatMap(f => f.items || []).find(i => i.id == id);
    if (fi) {
      if (targetFolderId) {
        // Move to different folder
        await api('/folder-items/' + id + '/move', 'PUT', { 
          folder_id: parseInt(targetFolderId),
          new_type: fi.item_type,
          new_item_id: fi.item_id
        });
        state.expandedFolders.add(parseInt(targetFolderId));
      } else {
        // Remove from folder (back to root/unassigned)
        await api('/folder-items/' + id, 'DELETE');
      }
    }
  }
  
  closeModal();
  await refreshFolders();
  renderTree();
  showToast('✅ Movido exitosamente');
}

// ========== DELETE ==========
async function deleteNode(type, id) {
  const label = type === 'folder' 
    ? (state.folders.find(f => f.id == id)?.name || '?')
    : (() => {
        const fi = state.folders.flatMap(f => f.items || []).find(i => i.id == id);
        return fi ? getItemName(fi.item_type, fi.item_id) : '?';
      })();
  
  if (type === 'folder') {
    const countDescendants = (folderId) => {
      let count = 0;
      const children = state.folders.filter(f => f.parent_id == folderId);
      children.forEach(c => { count++; count += countDescendants(c.id); });
      const items = state.folders.find(f => f.id == folderId)?.items || [];
      count += items.length;
      return count;
    };
    const total = countDescendants(id);
    const msg = total > 0 
      ? `¿Eliminar solo la carpeta "${label}"? (sus ${total} elemento(s) quedarán sin carpeta)`
      : `¿Eliminar carpeta "${label}"?`;
    if (!confirm(msg)) return;
    await api('/folders/' + id, 'DELETE');
  } else {
    if (!confirm(`¿Quitar "${label}" de esta carpeta? (el elemento original no se borra)`)) return;
    await api('/folder-items/' + id, 'DELETE');
  }
  
  state.selectedNode = null;
  await refreshFolders();
  renderTree();
  showToast('🗑️ Eliminado');
}

// ========== DELETE ITEM (actual entity — OLT, NAP, Manga, or Cable) ==========
function deleteTreeItem(type, itemId) {
  const itemObj = findItem(type, itemId);
  if (!itemObj) { showToast('❌ Elemento no encontrado'); return; }
  
  const typeLabel = type === 'olt' ? '⚡ OLT' : type === 'nap' ? '📦 NAP' : type === 'manga' ? '🧶 Manga' : '🔌 Cable';
  
  api('/' + type + 's/' + itemId, 'DELETE')
    .then(function() {
      showToast('🗑️ ' + typeLabel + ' "' + itemObj.name + '" eliminado');
      return refreshAll();
    })
    .then(function() {
      renderTree();
    })
    .catch(function(e) {
      showToast('❌ Error al eliminar: ' + e.message);
    });
}

function contextDeleteItem() {
  document.getElementById('context-menu-tree').classList.add('hidden');
  if (!state.contextTarget || state.contextTarget.type !== 'item') return;
  
  var type, itemId;
  var targetId = state.contextTarget.id;
  
  // Root items: id is string like "nap_5"
  if (typeof targetId === 'string' && targetId.indexOf('_') > 0) {
    var parts = targetId.split('_');
    type = parts[0];
    itemId = parseInt(parts[1]);
  } else {
    // Folder items: search in folder items
    var allItems = state.folders.flatMap(function(f) { return f.items || []; });
    var fi = allItems.find(function(i) { return i.id == targetId; });
    if (!fi) { showToast('❌ Elemento no encontrado'); return; }
    type = fi.item_type;
    itemId = fi.item_id;
  }
  
  var itemObj = findItem(type, itemId);
  if (!itemObj) { showToast('❌ Elemento no encontrado'); return; }
  
  var typeLabel = type === 'olt' ? '⚡ OLT' : type === 'nap' ? '📦 NAP' : type === 'manga' ? '🧶 Manga' : '🔌 Cable';
  var msg = '¿Eliminar permanentemente ' + typeLabel + ' "' + itemObj.name + '"?"\n\nEsto borrará el elemento de la base de datos, incluyendo sus conexiones de fibra, empalmes y asignaciones.\n\n❌ Esta acción NO se puede deshacer.';
  
  if (!confirm(msg)) return;
  
  api('/' + type + 's/' + itemId, 'DELETE')
    .then(function() {
      showToast('🗑️ ' + typeLabel + ' "' + itemObj.name + '" eliminado permanentemente');
      state.selectedNode = null;
      return refreshAll();
    })
    .then(function() {
      renderTree();
      closeModal();
    })
    .catch(function(e) {
      showToast('❌ Error al eliminar: ' + e.message);
    });
}

// ========== REMOVE FROM FOLDER (keep entity, remove from tree) ==========
function contextRemoveFromFolder() {
  document.getElementById('context-menu-tree').classList.add('hidden');
  if (!state.contextTarget || state.contextTarget.type !== 'item') return;
  
  const allItems = state.folders.flatMap(f => f.items || []);
  const fi = allItems.find(i => i.id == state.contextTarget.id);
  if (!fi) return;
  
  const itemObj = findItem(fi.item_type, fi.item_id);
  const label = itemObj ? itemObj.name : '?';
  
  if (!confirm(`¿Quitar "${label}" de esta carpeta? (el elemento original NO se borra, solo sale de la carpeta)`)) return;
  
  api('/folder-items/' + state.contextTarget.id, 'DELETE')
    .then(function() {
      showToast('✂️ "' + label + '" quitado de la carpeta');
      state.selectedNode = null;
      return refreshFolders();
    })
    .then(function() {
      renderTree();
    })
    .catch(function(e) {
      showToast('❌ Error: ' + e.message);
    });
}

// ========== CLEAR FOLDER (remove all items from folder, keep folder) ==========
function contextClearFolder() {
  document.getElementById('context-menu-tree').classList.add('hidden');
  if (!state.contextTarget || state.contextTarget.type !== 'folder') return;
  
  const folderId = state.contextTarget.id;
  const folder = state.folders.find(f => f.id == folderId);
  if (!folder) return;
  
  // Count items and subfolders
  const items = folder.items || [];
  const subfolders = state.folders.filter(f => f.parent_id == folderId);
  const total = items.length + subfolders.length;
  
  if (total === 0) {
    showToast('📁 La carpeta ya está vacía');
    return;
  }
  
  if (!confirm(`¿Vaciar la carpeta "${folder.name}"?\n\nSe quitarán ${items.length} elemento(s) y ${subfolders.length} sub-carpeta(s).\nLos elementos originales NO se borrarán, quedarán sin carpeta.`)) return;
  
  // Remove all folder-items
  const promises = [];
  items.forEach(function(item) {
    promises.push(api('/folder-items/' + item.id, 'DELETE'));
  });
  // Delete all subfolders (cascade removes their items too)
  subfolders.forEach(function(sf) {
    promises.push(api('/folders/' + sf.id, 'DELETE'));
  });
  
  Promise.all(promises)
    .then(function() {
      showToast('🧹 Carpeta "' + folder.name + '" vaciada (' + total + ' elemento(s) removidos)');
      return refreshFolders();
    })
    .then(function() {
      renderTree();
    })
    .catch(function(e) {
      showToast('❌ Error: ' + e.message);
    });
}

// ========== DELETE FOLDER WITH CONTENTS (recursive, deletes actual entities) ==========
function contextDeleteFolderWithContents() {
  document.getElementById('context-menu-tree').classList.add('hidden');
  if (!state.contextTarget || state.contextTarget.type !== 'folder') return;
  
  const folderId = state.contextTarget.id;
  const folder = state.folders.find(f => f.id == folderId);
  if (!folder) return;
  
  // Collect all items recursively
  function collectItems(fId) {
    const resultItems = [];
    const resultFolders = [];
    const f = state.folders.find(x => x.id == fId);
    if (f && f.items) resultItems.push(...f.items);
    const children = state.folders.filter(x => x.parent_id == fId);
    children.forEach(function(c) {
      resultFolders.push(c.id);
      const child = collectItems(c.id);
      resultItems.push(...child.items);
      resultFolders.push(...child.folders);
    });
    return { items: resultItems, folders: resultFolders };
  }
  
  const collected = collectItems(folderId);
  const totalItems = collected.items.length;
  const totalFolders = collected.folders.length;
  
  if (totalItems === 0 && totalFolders === 0) {
    // No children, just delete the folder
    if (!confirm(`¿Eliminar carpeta "${folder.name}"? (está vacía)`)) return;
    api('/folders/' + folderId, 'DELETE')
      .then(function() { return refreshFolders(); })
      .then(function() { renderTree(); showToast('🗑️ Carpeta eliminada'); })
      .catch(function(e) { showToast('❌ Error: ' + e.message); });
    return;
  }
  
  // Confirm — show all items that will be deleted
  let itemDetails = '';
  collected.items.forEach(function(item) {
    const obj = findItem(item.item_type, item.item_id);
    const icon = getItemIcon(item.item_type);
    itemDetails += '\n  ' + icon + ' ' + (obj ? obj.name : '?');
  });
  
  if (!confirm(`💣 ¿ELIMINAR PERMANENTEMENTE la carpeta "${folder.name}" Y TODO SU CONTENIDO?\n\nSe borrarán:\n  📁 1 carpeta${totalFolders > 0 ? ' + ' + totalFolders + ' sub-carpeta(s)' : ''}\n  ${totalItems} elemento(s):${itemDetails}\n\n❌ Esta acción NO se puede deshacer.\nLos elementos se borrarán de la base de datos.`)) return;
  
  // Confirm again for dangerous operation
  if (!confirm(`⚠️ ¿Estás SEGURO? Esta acción eliminará definitivamente ${totalItems} elemento(s) de la base de datos.`)) return;
  
  showToast('💣 Eliminando ' + (totalItems + totalFolders + 1) + ' elemento(s)...');
  
  // Start deletion: first delete actual entities, then folders
  async function doDelete() {
    try {
      // Delete actual entities (OLTs, NAPs, Mangas, Cables)
      for (const item of collected.items) {
        await api('/' + item.item_type + 's/' + item.item_id, 'DELETE');
      }
      // Delete subfolders
      for (const sfId of collected.folders) {
        await api('/folders/' + sfId, 'DELETE');
      }
      // Delete main folder
      await api('/folders/' + folderId, 'DELETE');
      
      await refreshAll();
      renderTree();
      showToast('💣 Carpeta y ' + (totalItems + totalFolders) + ' elemento(s) eliminados permanentemente');
    } catch(e) {
      showToast('❌ Error durante eliminación: ' + e.message);
    }
  }
  
  doDelete();
}

// ========== REFRESH HELPERS ==========
async function refreshFolders() {
  state.folders = await api('/folders');
}

async function refreshAll() {
  const data = await api('/map-data');
  state.olts = data.olts;
  state.naps = data.naps;
  state.mangas = data.mangas;
  state.cables = data.cables;
  state._cablePoints = data.cablePoints || [];
  state.folders = await api('/folders');
  renderMapMarkers(data);
  renderCableLines(data);
  updateStats();
}

// ========== SHOW UNASSIGNED ITEMS ==========
async function showUnassignedItems() {
  const unassigned = await api('/items-unassigned');
  const oltsHtml = unassigned.olts.map(o => `<div class="unassigned-item">
    <span>⚡ ${escHtml(o.name)}</span>
    <button onclick="quickAddToFolder('olt', ${o.id})">➕ Asignar</button>
  </div>`).join('');
  
  const napsHtml = unassigned.naps.map(n => `<div class="unassigned-item">
    <span>📦 ${escHtml(n.name)}</span>
    <button onclick="quickAddToFolder('nap', ${n.id})">➕ Asignar</button>
  </div>`).join('');
  
  const mangasHtml = unassigned.mangas.map(m => `<div class="unassigned-item">
    <span>🧶 ${escHtml(m.name)}</span>
    <button onclick="quickAddToFolder('manga', ${m.id})">➕ Asignar</button>
  </div>`).join('');
  
  const cablesHtml = unassigned.cables.map(c => `<div class="unassigned-item">
    <span>🔌 ${escHtml(c.name)}</span>
    <button onclick="quickAddToFolder('cable', ${c.id})">➕ Asignar</button>
  </div>`).join('');
  
  openModal(`
    <h3>📋 Items sin carpeta</h3>
    <p style="font-size:12px;color:#888;margin-bottom:15px">
      Estos elementos no están en ninguna carpeta. Asígnalos a una carpeta existente.
    </p>
    <div id="unassigned-list">
      ${oltsHtml ? `<div class="unassigned-group"><h4>⚡ OLTs</h4>${oltsHtml}</div>` : ''}
      ${napsHtml ? `<div class="unassigned-group"><h4>📦 NAPs</h4>${napsHtml}</div>` : ''}
      ${mangasHtml ? `<div class="unassigned-group"><h4>🧶 Mangas</h4>${mangasHtml}</div>` : ''}
      ${cablesHtml ? `<div class="unassigned-group"><h4>🔌 Cables</h4>${cablesHtml}</div>` : ''}
      ${!oltsHtml && !napsHtml && !mangasHtml && !cablesHtml 
        ? '<p style="text-align:center;padding:20px;color:#888">✅ Todos los items están asignados a carpetas</p>' 
        : ''}
    </div>
    <div class="btn-group" style="margin-top:15px">
      <button class="btn-secondary" onclick="closeModal()">Cerrar</button>
    </div>
  `);
}

async function quickAddToFolder(type, id) {
  // Find first folder or create one
  const rootFolders = state.folders.filter(f => !f.parent_id);
  let targetFolder;
  
  if (rootFolders.length === 0) {
    // Create a folder first
    const result = await api('/folders', 'POST', { name: 'Equipos', parent_id: null });
    targetFolder = result.id;
  } else {
    targetFolder = rootFolders[0].id;
  }
  
  await api('/folder-items', 'POST', { folder_id: targetFolder, item_type: type, item_id: id });
  state.expandedFolders.add(parseInt(targetFolder));
  showToast(`✅ Asignado a carpeta`);
  closeModal();
  await refreshFolders();
  renderTree();
}

// ========== CONTEXT MENU (Tree items) ==========
function showTreeContextMenu(event, type, id) {
  event.preventDefault();
  event.stopPropagation();
  
  state.contextTarget = { type, id };
  const menu = document.getElementById('context-menu-tree');
  if (!menu) return; // Salir si el menu contextual no existe en esta pagina
  
  // Show/hide options based on type
  const isFolder = type === 'folder';
  ['ctx-add-folder','ctx-add-item','ctx-remove-from-folder','ctx-delete-item',
   'ctx-divider-folder','ctx-clear-folder','ctx-delete-folder'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return; // skip if element doesn't exist in this page
    if (id === 'ctx-remove-from-folder' || id === 'ctx-delete-item') {
      el.style.display = isFolder ? 'none' : '';
    } else {
      el.style.display = isFolder ? '' : 'none';
    }
  });
  // The default delete (remove folder only / remove from folder) always visible
  
  // Position menu
  menu.style.left = Math.min(event.clientX, window.innerWidth - 220) + 'px';
  menu.style.top = Math.min(event.clientY, window.innerHeight - 200) + 'px';
  menu.classList.remove('hidden');
  
  // Select the node
  selectNode(type, id);
}

// Hide context menus
document.addEventListener('click', (e) => {
  if (!e.target.closest('.ctx-menu')) {
    document.querySelectorAll('.ctx-menu').forEach(m => m.classList.add('hidden'));
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.ctx-menu').forEach(m => m.classList.add('hidden'));
    closeModal();
    closeVisualizer();
    cancelEditCable();
  }
});

function contextAddFolder() {
  document.getElementById('context-menu-tree').classList.add('hidden');
  showNewFolderDialog(state.contextTarget?.id);
}

function contextAddItem() {
  document.getElementById('context-menu-tree').classList.add('hidden');
  showAddToFolderDialog(state.contextTarget?.id);
}

function contextRename() {
  document.getElementById('context-menu-tree').classList.add('hidden');
  if (state.contextTarget) showRenameDialog(state.contextTarget.type, state.contextTarget.id);
}

function contextMoveTo() {
  document.getElementById('context-menu-tree').classList.add('hidden');
  if (state.contextTarget) showMoveDialog(state.contextTarget.type, state.contextTarget.id);
}

function contextDelete() {
  document.getElementById('context-menu-tree').classList.add('hidden');
  if (state.contextTarget) deleteNode(state.contextTarget.type, state.contextTarget.id);
}

// ========== FIBER CONTEXT MENU (SVG right-click) ==========
function showFiberContextMenu(event, napId, portNum) {
  event.preventDefault();
  state.fiberContext = { napId, portNum };
  const menu = document.getElementById('ctx-fiber-menu');
  menu.style.left = Math.min(event.clientX, window.innerWidth - 200) + 'px';
  menu.style.top = Math.min(event.clientY, window.innerHeight - 120) + 'px';
  menu.classList.remove('hidden');
}

function contextRemoveFiber() {
  document.getElementById('ctx-fiber-menu').classList.add('hidden');
  if (state.fiberContext) {
    removeFiberFromNap(state.fiberContext.napId, state.fiberContext.portNum);
    state.fiberContext = null;
  }
}

function contextEditFiber() {
  document.getElementById('ctx-fiber-menu').classList.add('hidden');
  if (state.fiberContext) {
    editNapPort(state.fiberContext.napId, state.fiberContext.portNum);
    state.fiberContext = null;
  }
}

function contextFiberInfo() {
  document.getElementById('ctx-fiber-menu').classList.add('hidden');
  if (state.fiberContext) {
    showToast(`🔌 Puerto ${state.fiberContext.portNum} de NAP #${state.fiberContext.napId}`);
    state.fiberContext = null;
  }
}

// Close fiber context menu on any click
document.addEventListener('click', (e) => {
  var fm = document.getElementById('ctx-fiber-menu');
  if (fm && !e.target.closest('#ctx-fiber-menu')) {
    fm.classList.add('hidden');
  }
});

document.addEventListener('contextmenu', (e) => {
  var fm = document.getElementById('ctx-fiber-menu');
  if (fm && !e.target.closest('#ctx-fiber-menu')) {
    fm.classList.add('hidden');
  }
});

// ========== DRAG & DROP ==========
function onDragStart(event, type, id) {
  state.dragData = { type, id };
  event.dataTransfer.effectAllowed = 'move';
  
  // Create ghost element
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  let label = '';
  if (type === 'folder') {
    const f = state.folders.find(x => x.id == id);
    label = f ? '📁 ' + f.name : '📁 Folder';
  } else {
    // Root item? (composite id like 'nap_5')
    var rootType = null, rootId = null;
    if (typeof id === 'string' && id.indexOf('_') > 0) {
      var parts = id.split('_');
      rootType = parts[0]; rootId = parseInt(parts[1]);
      label = getItemIcon(rootType) + ' ' + (findItem(rootType, rootId)?.name || 'Item');
    } else {
      const fi = state.folders.flatMap(f => f.items || []).find(i => i.id == id);
      label = fi ? getItemIcon(fi.item_type) + ' ' + getItemName(fi.item_type, fi.item_id) : '📄 Item';
    }
  }
  ghost.textContent = label;
  ghost.style.left = '-1000px';
  ghost.style.top = '-1000px';
  document.body.appendChild(ghost);
  event.dataTransfer.setDragImage(ghost, 10, 10);
  setTimeout(() => ghost.remove(), 0);
  
  // Highlight source
  const row = event.target.closest('.tree-row');
  if (row) row.classList.add('dragging');
}

function onDragOver(event, targetFolderId) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  
  // Highlight target
  const targetNode = event.target.closest('.tree-node');
  if (targetNode) targetNode.classList.add('drag-over');
}

function onDragLeave(event) {
  const targetNode = event.target.closest('.tree-node');
  if (targetNode) targetNode.classList.remove('drag-over');
}

async function onDrop(event, targetFolderId) {
  event.preventDefault();
  document.querySelectorAll('.drag-ghost').forEach(g => g.remove());
  document.querySelectorAll('.tree-row.dragging').forEach(r => r.classList.remove('dragging'));
  document.querySelectorAll('.tree-node.drag-over').forEach(n => n.classList.remove('drag-over'));
  
  if (!state.dragData) return;
  
  const { type, id } = state.dragData;
  state.dragData = null;
  
  if (!targetFolderId) return;
  if (type === 'folder' && id == targetFolderId) return;
  
  // Check circular reference for folders
  if (type === 'folder') {
    let current = targetFolderId;
    let circular = false;
    while (current) {
      if (current == id) { circular = true; break; }
      const p = state.folders.find(f => f.id == current);
      current = p?.parent_id;
    }
    if (circular) {
      showToast('❌ No puedes mover una carpeta dentro de sí misma');
      return;
    }
  }
  
  // Perform the move
  if (type === 'folder') {
    await api('/folders/' + id + '/move', 'PUT', { parent_id: targetFolderId });
  } else {
    var itemType, itemId;
    // Root item? (composite id like 'nap_5')
    if (typeof id === 'string' && id.indexOf('_') > 0) {
      var parts2 = id.split('_');
      itemType = parts2[0]; itemId = parseInt(parts2[1]);
      // Root items need a folder_item creaci
      await api('/folder-items', 'POST', {
        folder_id: parseInt(targetFolderId),
        item_type: itemType,
        item_id: itemId
      });
    } else {
      // Move folder item to new folder
      const fi = state.folders.flatMap(f => f.items || []).find(i => i.id == id);
      if (fi) {
        await api('/folder-items/' + id + '/move', 'PUT', { 
          folder_id: parseInt(targetFolderId),
          new_type: fi.item_type,
          new_item_id: fi.item_id
        });
      }
    }
  }
  
  state.expandedFolders.add(targetFolderId);
  await refreshFolders();
  renderTree();
  showToast('✅ Movido por arrastre');
}

// ========== MODALS ==========
function showModal(title, bodyHtml) {
  openModal('<h3>' + title + '</h3>' + bodyHtml);
}

function openModal(html) {
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modal-overlay').classList.add('hidden');
  state.mapClickHandler = null;
  state.selectedCablePoints = [];
  state.tempMarkers.forEach(m => map.removeLayer(m));
  state.tempMarkers = [];
  state.pendingLat = null;
  state.pendingLng = null;
}

// ========== ADD OLT ==========
function showAddOLT() {
  openModal(`
    <h3>⚡ Agregar OLT</h3>
    <label>Nombre</label><input id="f-olt-name" value="OLT-${state.olts.length + 1}" />
    <label>Marca</label><input id="f-olt-brand" placeholder="Ej: Huawei" />
    <label>Modelo</label><input id="f-olt-model" placeholder="Ej: MA5800" />
    <label>Puertos</label><input id="f-olt-ports" type="number" value="16" />
    <label>Potencia de salida (dBm)</label><input id="f-olt-power" type="number" step="0.1" value="2.5" />
    <label>Descripción</label><textarea id="f-olt-desc" rows="2"></textarea>
    <p style="margin-top:10px;font-size:12px;color:#888;">💡 Haz clic en el mapa para colocar la OLT</p>
    <div class="btn-group">
      <button class="btn-primary" onclick="confirmAddOLT()">Guardar</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
  state.mapClickHandler = async (lat, lng) => {
    state.pendingLat = lat;
    state.pendingLng = lng;
    showMapConfirm('OLT', lat, lng);
  };
}

function showMapConfirm(type, lat, lng) {
  const m = L.circleMarker([lat, lng], { radius: 10, color: '#e94560', fillColor: '#e94560', fillOpacity: 0.5 }).addTo(map);
  state.tempMarkers.push(m);
}

async function confirmAddOLT() {
  const name = document.getElementById('f-olt-name').value;
  if (!state.pendingLat) { showAlertDialog('Haz clic en el mapa para colocar la OLT'); return; }
  const result = await api('/olts', 'POST', {
    name, lat: state.pendingLat, lng: state.pendingLng,
    brand: document.getElementById('f-olt-brand').value,
    model: document.getElementById('f-olt-model').value,
    ports_count: parseInt(document.getElementById('f-olt-ports').value),
    power: parseFloat(document.getElementById('f-olt-power').value),
    description: document.getElementById('f-olt-desc').value
  });
  state.pendingLat = null;
  state.pendingLng = null;
  closeModal();
  
  // Ask if want to add to a folder
  askAddToFolder('olt', result.id);
}

// ========== ADD NAP ==========
async function showAddNAP() {
  const types = await api('/splitter-types');
  openModal(`
    <h3>📦 Agregar NAP</h3>
    <label>Nombre</label><input id="f-nap-name" value="NAP-${state.naps.length + 1}" />
    <label>Splitter</label>
    <select id="f-nap-splitter">
      ${types.map(t => `<option value="${t.id}">${t.name} (${t.loss_db}dB pérdida)</option>`).join('')}
    </select>
    <label>Capacidad (puertos)</label><input id="f-nap-ports" type="number" value="8" />
    <label>Dirección</label><input id="f-nap-address" placeholder="Calle, número, sector" />
    <label>Descripción</label><textarea id="f-nap-desc" rows="2"></textarea>
    <p style="margin-top:10px;font-size:12px;color:#888;">💡 Haz clic en el mapa para colocar la NAP</p>
    <div class="btn-group">
      <button class="btn-primary" onclick="confirmAddNAP()">Guardar</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
  state.mapClickHandler = (lat, lng) => { state.pendingLat = lat; state.pendingLng = lng; showMapConfirm('NAP', lat, lng); };
}

async function confirmAddNAP() {
  if (!state.pendingLat) { showAlertDialog('Haz clic en el mapa'); return; }
  const result = await api('/naps', 'POST', {
    name: document.getElementById('f-nap-name').value,
    lat: state.pendingLat, lng: state.pendingLng,
    splitter_type_id: parseInt(document.getElementById('f-nap-splitter').value),
    port_capacity: parseInt(document.getElementById('f-nap-ports').value),
    address: document.getElementById('f-nap-address').value,
    description: document.getElementById('f-nap-desc').value
  });
  state.pendingLat = null;
  state.pendingLng = null;
  closeModal();
  askAddToFolder('nap', result.id);
}

// ========== ADD MANGA ==========
function showAddManga() {
  openModal(`
    <h3>🧶 Agregar Manga</h3>
    <label>Nombre</label><input id="f-manga-name" value="Manga-${state.mangas.length + 1}" />
    <label>Descripción</label><textarea id="f-manga-desc" rows="2"></textarea>
    <p style="margin-top:10px;font-size:12px;color:#888;">💡 Haz clic en el mapa para colocar la Manga</p>
    <div class="btn-group">
      <button class="btn-primary" onclick="confirmAddManga()">Guardar</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
  state.mapClickHandler = (lat, lng) => { state.pendingLat = lat; state.pendingLng = lng; showMapConfirm('Manga', lat, lng); };
}

async function confirmAddManga() {
  if (!state.pendingLat) { showAlertDialog('Haz clic en el mapa'); return; }
  const result = await api('/mangas', 'POST', {
    name: document.getElementById('f-manga-name').value,
    lat: state.pendingLat, lng: state.pendingLng,
    description: document.getElementById('f-manga-desc').value
  });
  state.pendingLat = null; state.pendingLng = null;
  closeModal();
  askAddToFolder('manga', result.id);
}

// ========== FIBER STATUS POPUP ==========
async function showFiberStatus(cableId) {
  try {
    const [fibers, routing] = await Promise.all([
      api('/cables/' + cableId + '/fibers'),
      api('/cables/' + cableId + '/routing')
    ]);
    const cable = state.cables.find(c => c.id == cableId);
    if (!cable) return showToast('❌ Cable no encontrado');
    
    const connections = routing.connections || [];
    
    let html = '<div style="max-height:400px;overflow-y:auto;padding:10px">';
    html += '<h3 style="margin-bottom:10px;color:#e94560">🔌 ' + escHtml(cable.name) + '</h3>';
    html += '<p style="font-size:13px;color:#888">' + (cable.fiber_count || fibers.length) + ' fibras · ' + fibers.filter(function(f) { return f.status === 'used'; }).length + ' usadas · ' + connections.length + ' conexiones</p>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
    html += '<tr style="background:#16213e;color:white"><th style="padding:6px">#</th><th style="padding:6px">Color</th><th style="padding:6px">Estado</th><th style="padding:6px">Ruta</th></tr>';
    
    fibers.forEach(function(f) {
      var statusLabel = f.status === 'available' ? 'Libre' : f.status === 'used' ? 'Usada' : f.status === 'reserved' ? 'Reservada' : 'Dañada';
      var statusColor = f.status === 'used' ? '#00ff88' : f.status === 'available' ? '#888' : f.status === 'reserved' ? '#ffaa00' : '#e94560';
      var conn = connections.find(function(fc) { return fc.fiber_number == f.fiber_number; });
      html += '<tr style="border-bottom:1px solid #333">';
      html += '<td style="padding:6px">' + f.fiber_number + '</td>';
      html += '<td style="padding:6px"><span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:' + f.color + ';border:2px solid #555;vertical-align:middle;margin-right:6px"></span>' + (f.color_name || '') + '</td>';
      html += '<td style="padding:6px;color:' + statusColor + '">' + statusLabel + '</td>';
      html += '<td style="padding:6px">';
      if (conn && conn.id) {
        html += '<button onclick="showFiberRoute(' + conn.id + ')" style="background:#0f3460;color:#00ff88;border:1px solid #00ff88;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:11px;white-space:nowrap">🗺 Ruta</button>';
      } else {
        html += '<span style="color:#555;font-size:11px">—</span>';
      }
      html += '</td>';
      html += '</tr>';
    });
    html += '</table></div>';
    
    openModal(html);
  } catch(e) {
    showToast('❌ Error al cargar fibras: ' + e.message);
  }
}

// ========== CABLE ROUTING (SVG Diagram) ==========
async function showCableRouting(cableId) {
  try {
    var resp = await fetch('/api/cables/' + cableId + '/routing');
    var data = await resp.json();
    if (!data || !data.connections) return showToast('❌ No hay datos de ruteo');
    
    var cable = data.cable || {};
    var connections = data.connections || [];
    var fusions = data.fusions || [];
    var fibers = data.fibers || [];
    
    // TIA/EIA-598 colors
    var tiaColors = ['#003da5','#f5a623','#00a650','#8b4513','#808080','#ffffff','#e82020','#1a1a1a','#f5d442','#8a2be2','#ff69b4','#20b2aa'];
    var tiaNames = ['Azul','Naranja','Verde','Marrón','Gris','Blanco','Rojo','Negro','Amarillo','Violeta','Rosa','Aguamarina'];
    
    function getFiberColor(num) { return tiaColors[(num - 1) % 12]; }
    function getFiberName(num) { return tiaNames[(num - 1) % 12]; }
    
    // Build route topology
    var routes = [];
    connections.forEach(function(conn) {
      var srcName = conn.source_olt_name || conn.source_nap_name || conn.source_manga_name || conn.source_type || '?';
      var srcIcon = conn.source_type === 'olt' ? '⚡' : conn.source_type === 'nap' ? '📦' : conn.source_type === 'manga' ? '🧶' : '?';
      var tgtName = conn.target_olt_name || conn.target_nap_name || conn.target_manga_name || conn.target_type || '?';
      var tgtIcon = conn.target_type === 'olt' ? '⚡' : conn.target_type === 'nap' ? '📦' : conn.target_type === 'manga' ? '🧶' : '?';
      var fiberColor = getFiberColor(conn.fiber_number);
      
      // Find fusions for this fiber
      var fiberFusions = fusions.filter(function(fu) {
        return fu.fiber_in == conn.fiber_number || fu.fiber_out == conn.fiber_number;
      });
      
      routes.push({
        fiberNum: conn.fiber_number,
        fiberColor: fiberColor,
        fiberName: getFiberName(conn.fiber_number),
        srcIcon: srcIcon, srcName: srcName, srcType: conn.source_type,
        tgtIcon: tgtIcon, tgtName: tgtName, tgtType: conn.target_type,
        activePower: conn.active_power,
        powerLevel: conn.power_level,
        fusions: fiberFusions
      });
    });
    
    // Sort by fiber number
    routes.sort(function(a, b) { return a.fiberNum - b.fiberNum; });
    
    var maxFibers = Math.min(routes.length, 12);
    var svgW = 1100;
    var svgH = 200 + maxFibers * 40;
    if (svgH < 250) svgH = 250;
    
    var svg = '<svg width="' + svgW + '" height="' + svgH + '" viewBox="0 0 ' + svgW + ' ' + svgH + '" style="background:#1a1a2e;border-radius:8px;font-family:sans-serif">';
    
    // Title bar
    svg += '<rect x="0" y="0" width="' + svgW + '" height="36" fill="#0f3460" rx="8" />';
    svg += '<text x="20" y="24" fill="#00d4ff" font-size="16" font-weight="bold">🗺 Ruteo: ' + escHtml(cable.name || '') + '</text>';
    svg += '<text x="' + (svgW - 20) + '" y="24" text-anchor="end" fill="#888" font-size="12">' + cable.fiber_count + ' fibras · ' + Math.round(cable.length_m) + 'm · ' + connections.length + ' conexiones · ' + fusions.length + ' empalmes</text>';
    
    // Column headers
    var colX1 = 20;
    var colX2 = 120;
    var colX3 = 300;
    var colX4 = 500;
    var colX5 = 700;
    
    svg += '<line x1="10" y1="44" x2="' + (svgW - 10) + '" y2="44" stroke="#333" stroke-width="1" />';
    
    // Draw each route
    routes.forEach(function(route, idx) {
      var baseY = 58 + idx * 48;
      var routeBottomY = baseY + 42;
      
      // Row background (alternating)
      if (idx % 2 === 0) {
        svg += '<rect x="5" y="' + (baseY - 4) + '" width="' + (svgW - 10) + '" height="48" fill="rgba(255,255,255,0.02)" rx="4" />';
      }
      
      // Row separator
      svg += '<line x1="10" y1="' + (baseY + 44) + '" x2="' + (svgW - 10) + '" y2="' + (baseY + 44) + '" stroke="#2a2a4a" stroke-width="0.5" />';
      
      // Fiber # and color dot
      var colorDot = route.fiberColor;
      var dotBorder = colorDot === '#ffffff' ? '#ccc' : colorDot;
      svg += '<circle cx="' + (colX1 + 12) + '" cy="' + (baseY + 20) + '" r="10" fill="' + colorDot + '" stroke="' + dotBorder + '" stroke-width="2" />';
      svg += '<text x="' + (colX1 + 28) + '" y="' + (baseY + 24) + '" fill="#ddd" font-size="13" font-weight="bold">#' + route.fiberNum + '</text>';
      
      // Source block
      svg += '<rect x="' + colX2 + '" y="' + (baseY + 5) + '" width="140" height="30" rx="6" fill="#0f3460" stroke="#4a7ab5" stroke-width="1" />';
      svg += '<text x="' + (colX2 + 8) + '" y="' + (baseY + 24) + '" fill="#00d4ff" font-size="12">' + route.srcIcon + ' ' + escHtml(route.srcName.substring(0, 20)) + '</text>';
      
      // Fiber line (colored bezier curve)
      var fiberStartX = colX2 + 140;
      var fiberEndX = colX5;
      var fiberMidY = baseY + 20;
      var cpOff = (fiberEndX - fiberStartX) * 0.3;
      
      if (route.activePower) {
        svg += '<path d="M ' + fiberStartX + ',' + fiberMidY + ' C ' + (fiberStartX + cpOff) + ',' + fiberMidY + ' ' + (fiberEndX - cpOff) + ',' + fiberMidY + ' ' + fiberEndX + ',' + fiberMidY + '" stroke="#00ff88" stroke-width="" /><line x1="'+fiberStartX+'" y1="'+fiberMidY+'" x2="'+fiberEndX+'" y2="'+fiberMidY+'" stroke="'+route.fiberColor+'" stroke-width="5" opacity="0.8" stroke-dasharray="12,6" />';
      } else {
        svg += '<path d="M ' + fiberStartX + ',' + fiberMidY + ' C ' + (fiberStartX + cpOff) + ',' + fiberMidY + ' ' + (fiberEndX - cpOff) + ',' + fiberMidY + ' ' + fiberEndX + ',' + fiberMidY + '" stroke="' + route.fiberColor + '" stroke-width="3" opacity="0.6" fill="none" stroke-dasharray="8,4" />';
      }
      
      // Fusion markers on the fiber line
      if (route.fusions && route.fusions.length > 0) {
        route.fusions.forEach(function(fu, fi) {
          var fusX = fiberStartX + (fiberEndX - fiberStartX) * (0.3 + fi * 0.3);
          svg += '<text x="' + fusX + '" y="' + (fiberMidY - 10) + '" text-anchor="middle" font-size="10">🔗</text>';
          svg += '<rect x="' + (fusX - 18) + '" y="' + (fiberMidY + 6) + '" width="36" height="14" rx="3" fill="rgba(255,170,0,0.15)" stroke="#ffaa00" stroke-width="0.5" />';
          svg += '<text x="' + fusX + '" y="' + (fiberMidY + 16) + '" text-anchor="middle" fill="#ffaa00" font-size="9">' + (fu.loss_db || 0) + ' dB</text>';
        });
      }
      
      // Power badge on line
      if (route.activePower) {
        var badgeX = (fiberStartX + fiberEndX) / 2;
        svg += '<rect x="' + (badgeX - 30) + '" y="' + (fiberMidY - 22) + '" width="60" height="18" rx="9" fill="rgba(0,255,136,0.12)" stroke="#00ff88" stroke-width="1" />';
        svg += '<text x="' + badgeX + '" y="' + (fiberMidY - 9) + '" text-anchor="middle" fill="#00ff88" font-size="10" font-weight="bold">⚡ ' + (route.powerLevel || '?') + ' dBm</text>';
      }
      
      // Target block
      svg += '<rect x="' + colX5 + '" y="' + (baseY + 5) + '" width="140" height="30" rx="6" fill="#0f3460" stroke="#4a7ab5" stroke-width="1" />';
      svg += '<text x="' + (colX5 + 8) + '" y="' + (baseY + 24) + '" fill="#00d4ff" font-size="12">' + route.tgtIcon + ' ' + escHtml(route.tgtName.substring(0, 20)) + '</text>';
      
      // Fiber name badge
      svg += '<rect x="' + (colX1 + 12) + '" y="' + (baseY + 33) + '" width="80" height="14" rx="3" fill="rgba(255,255,255,0.05)" />';
      svg += '<text x="' + (colX1 + 52) + '" y="' + (baseY + 43) + '" text-anchor="middle" fill="#888" font-size="9">' + route.fiberName + '</text>';
    });
    
    if (routes.length === 0) {
      svg += '<text x="' + (svgW / 2) + '" y="' + (svgH / 2 - 10) + '" text-anchor="middle" fill="#666" font-size="16">Sin conexiones activas</text>';
      svg += '<text x="' + (svgW / 2) + '" y="' + (svgH / 2 + 20) + '" text-anchor="middle" fill="#555" font-size="13">Los cables deben conectarse a OLTs, NAPs o Mangas</text>';
    }
    
    svg += '</svg>';
    
    // Fusion table (if any)
    var fusionHtml = '';
    if (fusions.length > 0) {
      fusionHtml += '<div style="margin-top:15px;padding:12px;background:#0f3460;border-radius:8px">';
      fusionHtml += '<h4 style="color:#ffaa00;margin-bottom:8px">🔗 Empalmes (' + fusions.length + ')</h4>';
      fusionHtml += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
      fusionHtml += '<tr style="background:#16213e;color:white"><th style="padding:5px">Fibra In</th><th style="padding:5px">Fibra Out</th><th style="padding:5px">Pérdida (dB)</th></tr>';
      fusions.forEach(function(fu) {
        var fiberColorIn = getFiberColor(fu.fiber_in || 1);
        var dotBorderIn = fiberColorIn === '#ffffff' ? '#ccc' : fiberColorIn;
        fusionHtml += '<tr style="border-bottom:1px solid #333">';
        fusionHtml += '<td style="padding:5px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + fiberColorIn + ';border:2px solid ' + dotBorderIn + ';vertical-align:middle;margin-right:5px"></span>#' + fu.fiber_in + '</td>';
        var fiberColorOut = getFiberColor(fu.fiber_out || 1);
        var dotBorderOut = fiberColorOut === '#ffffff' ? '#ccc' : fiberColorOut;
        fusionHtml += '<td style="padding:5px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + fiberColorOut + ';border:2px solid ' + dotBorderOut + ';vertical-align:middle;margin-right:5px"></span>#' + (fu.fiber_out || '—') + '</td>';
        fusionHtml += '<td style="padding:5px;color:#ffaa00">' + fu.loss_db + ' dB</td>';
        fusionHtml += '</tr>';
      });
      fusionHtml += '</table></div>';
    }
    
    // Routing info
    var infoHtml = '<div style="margin-top:10px;padding:10px;background:#0f3460;border-radius:8px;font-size:12px;color:#aaa;line-height:1.8">';
    infoHtml += '<strong style="color:#ddd">📋 Resumen:</strong><br>';
    infoHtml += '• <strong style="color:#00d4ff">' + cable.fiber_count + '</strong> fibras totales en el cable<br>';
    infoHtml += '• <strong style="color:#00ff88">' + connections.filter(function(c) { return c.active_power; }).length + '</strong> fibras con potencia activa<br>';
    infoHtml += '• <strong style="color:#ffaa00">' + fusions.length + '</strong> empalmes registrados<br>';
    infoHtml += '• <strong style="color:#888">' + cable.length_m + '</strong> metros de longitud total';
    infoHtml += '</div>';
    
    var html = '<div style="max-height:500px;overflow-y:auto;padding:5px">';
    html += svg;
    html += fusionHtml;
    html += infoHtml;
    html += '<div class="btn-group" style="margin-top:15px"><button class="btn-secondary" onclick="closeModal()">Cerrar</button></div>';
    html += '</div>';
    
    openModal(html);
  } catch(e) {
    showToast('❌ Error: ' + e.message);
  }
}

// ========== FIBER ROUTE (complete path from OLT to client) ==========
async function showFiberRoute(fiberConnectionId) {
  try {
    var resp = await fetch('/api/fibers/' + fiberConnectionId + '/route');
    var data = await resp.json();
    if (!data || !data.route_segments) return showToast('❌ Ruta no encontrada');
    
    var segments = data.route_segments || [];
    var power = data.power_analysis || {};
    var fiber = data.fiber || {};
    
    var svgW = 1000;
    var svgH = 100 + segments.length * 80;
    if (svgH < 250) svgH = 250;
    
    // Build SVG route diagram
    var svg = '<svg width="' + svgW + '" height="' + svgH + '" viewBox="0 0 ' + svgW + ' ' + svgH + '" style="background:#1a1a2e;border-radius:8px;font-family:sans-serif">';
    
    // Title
    svg += '<rect x="0" y="0" width="' + svgW + '" height="36" fill="#0f3460" rx="8" />';
    svg += '<text x="20" y="24" fill="#00ff88" font-size="16" font-weight="bold">🗺 Ruta Completa de Fibra</text>';
    svg += '<text x="' + (svgW - 20) + '" y="24" text-anchor="end" fill="#888" font-size="12">Fibra #' + (fiber.fiber_number || '?') + ' · ' + (power.total_loss_db || 0) + ' dB pérdida total</text>';
    
    svg += '<line x1="10" y1="44" x2="' + (svgW - 10) + '" y2="44" stroke="#333" stroke-width="1" />';
    
    // Draw route segments connected by lines
    var segGap = Math.min(80, Math.floor((svgH - 60) / segments.length));
    var startY = 60;
    
    segments.forEach(function(seg, idx) {
      var baseY = startY + idx * segGap;
      var isLast = idx === segments.length - 1;
      
      // Connection line from previous segment
      if (idx > 0) {
        var prevBaseY = startY + (idx - 1) * segGap;
        var arrowColor = seg.type === 'splice' ? '#ffaa00' : '#4a7ab5';
        svg += '<line x1="30" y1="' + (prevBaseY + 30) + '" x2="30" y2="' + baseY + '" stroke="' + arrowColor + '" stroke-width="2" stroke-dasharray="4,3" opacity="0.5" />';
        // Arrow
        svg += '<polygon points="23,' + (baseY - 2) + ' 30,' + baseY + ' 37,' + (baseY - 2) + '" fill="' + arrowColor + '" opacity="0.6" />';
      }
      
      // Icon circle
      var circleColor = seg.type === 'olt' ? '#e94560' : seg.type === 'nap' ? '#00d4ff' : seg.type === 'manga' ? '#ffaa00' : seg.type === 'splice' ? '#ff6600' : '#4a7ab5';
      var icon = seg.icon || '•';
      svg += '<circle cx="30" cy="' + (baseY + 15) + '" r="16" fill="' + circleColor + '" stroke="#fff" stroke-width="2" />';
      svg += '<text x="30" y="' + (baseY + 20) + '" text-anchor="middle" fill="#fff" font-size="14">' + icon + '</text>';
      
      // Segment name and detail
      svg += '<text x="60" y="' + (baseY + 12) + '" fill="#ddd" font-size="14" font-weight="bold">' + escHtml(seg.name || '') + '</text>';
      if (seg.detail) {
        svg += '<text x="60" y="' + (baseY + 30) + '" fill="#888" font-size="11">' + escHtml(seg.detail || '') + '</text>';
      }
      
      // Fusion sub-details
      if (seg.fusions && seg.fusions.length > 0) {
        seg.fusions.forEach(function(fu, fi) {
          var fuX = 300 + fi * 180;
          svg += '<rect x="' + fuX + '" y="' + (baseY - 2) + '" width="150" height="34" rx="4" fill="rgba(255,170,0,0.08)" stroke="rgba(255,170,0,0.3)" stroke-width="0.5" />';
          svg += '<text x="' + (fuX + 8) + '" y="' + (baseY + 14) + '" fill="#ffaa00" font-size="11">🔗 #' + (fu.fiber_in || '?') + ' → #' + (fu.fiber_out || '?') + '</text>';
          svg += '<text x="' + (fuX + 8) + '" y="' + (baseY + 28) + '" fill="#ff8800" font-size="10">' + (fu.loss_db || 0) + ' dB pérdida</text>';
        });
      }
      
      // Splitter info
      if (seg.splitter && seg.splitter.loss_db) {
        svg += '<rect x="500" y="' + (baseY - 2) + '" width="200" height="34" rx="4" fill="rgba(0,212,255,0.08)" stroke="rgba(0,212,255,0.3)" stroke-width="0.5" />';
        svg += '<text x="508" y="' + (baseY + 14) + '" fill="#00d4ff" font-size="11">🔀 Splitter: ' + escHtml(seg.splitter.splitter_type || '') + '</text>';
        svg += '<text x="508" y="' + (baseY + 28) + '" fill="#00aacc" font-size="10">' + seg.splitter.loss_db + ' dB pérdida</text>';
      }
    });
    
    svg += '</svg>';
    
    // Power analysis panel
    var powerHtml = '<div style="margin-top:15px;padding:15px;background:#0f3460;border-radius:8px">';
    powerHtml += '<h4 style="color:#00ff88;margin-bottom:10px">⚡ Análisis de Potencia</h4>';
    
    // Power bar visualization
    var maxPower = Math.max(power.initial_power || 0, 1);
    var remainingPct = ((power.remaining_power_db || 0) / (power.initial_power || 2.5)) * 100;
    if (remainingPct < 0) remainingPct = 0;
    if (remainingPct > 100) remainingPct = 100;
    var barColor = (power.is_good !== false) ? '#00ff88' : '#e94560';
    
    powerHtml += '<div style="margin-bottom:12px">';
    powerHtml += '<div style="display:flex;justify-content:space-between;font-size:12px;color:#aaa;margin-bottom:4px">';
    powerHtml += '<span>Potencia inicial: <strong style="color:#fff">' + (power.initial_power || 0) + ' dBm</strong></span>';
    powerHtml += '<span>Potencia restante: <strong style="color:' + barColor + '">' + (power.remaining_power_db || 0) + ' dBm</strong></span>';
    powerHtml += '</div>';
    powerHtml += '<div style="background:#1a1a2e;border-radius:10px;height:20px;overflow:hidden;border:1px solid #333">';
    powerHtml += '<div style="width:' + remainingPct + '%;height:100%;background:linear-gradient(90deg,' + barColor + ',rgba(0,255,136,0.3));border-radius:10px;transition:width 0.5s"></div>';
    powerHtml += '</div>';
    powerHtml += '<div style="display:flex;justify-content:space-between;font-size:10px;color:#555;margin-top:2px">';
    powerHtml += '<span>' + (power.initial_power || 0) + ' dBm</span>';
    powerHtml += '<span>0 dBm</span>';
    powerHtml += '</div>';
    powerHtml += '</div>';
    
    powerHtml += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
    powerHtml += '<tr><td style="padding:4px 8px;color:#aaa">📏 Distancia del cable</td><td style="padding:4px 8px;text-align:right;color:#ddd">' + (power.cable_distance_km || 0) + ' km</td></tr>';
    powerHtml += '<tr><td style="padding:4px 8px;color:#aaa">📉 Atenuación del cable</td><td style="padding:4px 8px;text-align:right;color:#ffaa00">-' + (power.cable_attenuation_db || 0) + ' dB</td></tr>';
    powerHtml += '<tr><td style="padding:4px 8px;color:#aaa">🔗 Pérdida por empalmes</td><td style="padding:4px 8px;text-align:right;color:#ffaa00">-' + ((power.fusion_loss_db || 0) + (power.splice_loss_db || 0)).toFixed(2) + ' dB</td></tr>';
    powerHtml += '<tr><td style="padding:4px 8px;color:#aaa">🔀 Pérdida del splitter</td><td style="padding:4px 8px;text-align:right;color:#ffaa00">-' + (power.splitter_loss_db || 0) + ' dB</td></tr>';
    powerHtml += '<tr><td style="padding:4px 8px;color:#aaa">🔌 Pérdida por conectores</td><td style="padding:4px 8px;text-align:right;color:#ffaa00">-' + (power.connector_loss_db || 0) + ' dB</td></tr>';
    powerHtml += '<tr style="border-top:1px solid #444"><td style="padding:6px 8px;color:#ddd;font-weight:bold">📊 Pérdida total</td><td style="padding:6px 8px;text-align:right;color:#ffaa00;font-weight:bold">-' + (power.total_loss_db || 0) + ' dB</td></tr>';
    powerHtml += '<tr><td style="padding:6px 8px;color:#ddd;font-weight:bold">⚡ Potencia restante</td><td style="padding:6px 8px;text-align:right;color:' + barColor + ';font-weight:bold">' + (power.remaining_power_db || 0) + ' dBm</td></tr>';
    powerHtml += '<tr><td style="padding:4px 8px;color:#aaa">✅ Señal válida</td><td style="padding:4px 8px;text-align:right;color:' + (power.is_good !== false ? '#00ff88' : '#e94560') + '">' + (power.is_good !== false ? '✅ Sí (≥ -28 dBm)' : '❌ No (< -28 dBm)') + '</td></tr>';
    powerHtml += '</table></div>';
    
    // Fusions/Splices detailed table
    var fusionsList = data.fusions || [];
    var splicesList = data.splices || [];
    var allSplices = [];
    fusionsList.forEach(function(f) { allSplices.push({ type: 'fusion', fiber_in: f.fiber_in, fiber_out: f.fiber_out, loss_db: f.loss_db, name: f.name, manga_name: f.manga_name }); });
    splicesList.forEach(function(s) { allSplices.push({ type: 'splice', fiber_in: s.fiber_a_port, fiber_out: s.fiber_b_port, loss_db: s.loss_db, name: s.name }); });
    
    var splicesHtml = '';
    if (allSplices.length > 0) {
      splicesHtml += '<div style="margin-top:15px;padding:12px;background:#0f3460;border-radius:8px">';
      splicesHtml += '<h4 style="color:#ffaa00;margin-bottom:8px">🔗 Empalmes en esta ruta (' + allSplices.length + ')</h4>';
      splicesHtml += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
      splicesHtml += '<tr style="background:#16213e;color:white"><th style="padding:5px">Tipo</th><th style="padding:5px">Nombre</th><th style="padding:5px">Fibra</th><th style="padding:5px">Pérdida</th></tr>';
      allSplices.forEach(function(s) {
        splicesHtml += '<tr style="border-bottom:1px solid #333">';
        splicesHtml += '<td style="padding:5px">' + (s.type === 'fusion' ? '🔗 Fusión' : '🔗 Empalme') + '</td>';
        splicesHtml += '<td style="padding:5px">' + escHtml(s.name || (s.manga_name || '')) + '</td>';
        splicesHtml += '<td style="padding:5px">#' + (s.fiber_in || '?') + ' → #' + (s.fiber_out || '?') + '</td>';
        splicesHtml += '<td style="padding:5px;color:#ffaa00">' + (s.loss_db || 0) + ' dB</td>';
        splicesHtml += '</tr>';
      });
      splicesHtml += '</table></div>';
    }
    
    // Cable info
    var cableInfo = data.cable_info || {};
    var infoHtml = '<div style="margin-top:15px;padding:12px;background:#0f3460;border-radius:8px;font-size:12px">';
    infoHtml += '<h4 style="color:#00d4ff;margin-bottom:5px">🔌 Información del Cable</h4>';
    infoHtml += '<table style="width:100%;font-size:12px">';
    infoHtml += '<tr><td style="padding:3px 8px;color:#aaa">Nombre</td><td style="padding:3px 8px;color:#ddd">' + escHtml(cableInfo.name || '') + '</td></tr>';
    infoHtml += '<tr><td style="padding:3px 8px;color:#aaa">Fibras</td><td style="padding:3px 8px;color:#ddd">' + (cableInfo.fiber_count || '?') + '</td></tr>';
    infoHtml += '<tr><td style="padding:3px 8px;color:#aaa">Longitud</td><td style="padding:3px 8px;color:#ddd">' + (cableInfo.length_m || 0) + ' m</td></tr>';
    infoHtml += '<tr><td style="padding:3px 8px;color:#aaa">Atenuación</td><td style="padding:3px 8px;color:#ddd">' + (cableInfo.attenuation_db_per_km || 0.35) + ' dB/km</td></tr>';
    infoHtml += '</table></div>';
    
    var html = '<div style="max-height:500px;overflow-y:auto;padding:5px">';
    html += svg;
    html += powerHtml;
    html += splicesHtml;
    html += infoHtml;
    html += '<div class="btn-group" style="margin-top:15px"><button class="btn-secondary" onclick="closeModal()">Cerrar</button></div>';
    html += '</div>';
    
    openModal(html);
  } catch(e) {
    showToast('❌ Error al obtener ruta: ' + e.message);
  }
}

// ========== NETWORK REPORT ==========
async function showNetworkReport() {
  try {
    var resp = await fetch('/api/reports/summary');
    var data = await resp.json();
    if (!data) return showToast('❌ Error al obtener reporte');
    
    var totals = data.totals || {};
    var fibers = data.fibers || {};
    var connections = data.connections || {};
    var splices = data.splices || {};
    var infra = data.infrastructure || {};
    var cableUsage = data.cable_fibers_usage || [];
    
    var html = '<div style="max-height:500px;overflow-y:auto;padding:5px">';
    
    // Header
    html += '<h3 style="color:#e94560;margin-bottom:15px">📊 Reporte de Red MapFiber</h3>';
    
    // Summary cards
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:15px">';
    
    html += '<div style="background:#0f3460;border-radius:8px;padding:15px;text-align:center">';
    html += '<div style="font-size:28px;color:#e94560;font-weight:bold">' + (totals.olts || 0) + '</div>';
    html += '<div style="font-size:12px;color:#888;margin-top:5px">⚡ OLTs</div>';
    html += '</div>';
    
    html += '<div style="background:#0f3460;border-radius:8px;padding:15px;text-align:center">';
    html += '<div style="font-size:28px;color:#00d4ff;font-weight:bold">' + (totals.naps || 0) + '</div>';
    html += '<div style="font-size:12px;color:#888;margin-top:5px">📦 NAPs</div>';
    html += '</div>';
    
    html += '<div style="background:#0f3460;border-radius:8px;padding:15px;text-align:center">';
    html += '<div style="font-size:28px;color:#ffaa00;font-weight:bold">' + (totals.mangas || 0) + '</div>';
    html += '<div style="font-size:12px;color:#888;margin-top:5px">🧶 Mangas</div>';
    html += '</div>';
    
    html += '<div style="background:#0f3460;border-radius:8px;padding:15px;text-align:center">';
    html += '<div style="font-size:28px;color:#00ff88;font-weight:bold">' + (totals.cables || 0) + '</div>';
    html += '<div style="font-size:12px;color:#888;margin-top:5px">🔌 Cables</div>';
    html += '</div>';
    
    html += '</div>';
    
    // Fibers section
    html += '<div style="background:#0f3460;border-radius:8px;padding:15px;margin-bottom:10px">';
    html += '<h4 style="color:#00ff88;margin-bottom:8px">🔌 Fibras</h4>';
    
    var usedPct = fibers.total > 0 ? Math.round((fibers.used / fibers.total) * 100) : 0;
    var activePct = fibers.total > 0 ? Math.round((fibers.active / fibers.total) * 100) : 0;
    
    html += '<div style="margin-bottom:8px">';
    html += '<div style="display:flex;justify-content:space-between;font-size:12px;color:#aaa;margin-bottom:3px">';
    html += '<span>Usadas: <strong style="color:#00ff88">' + (fibers.used || 0) + '</strong> / <strong>' + (fibers.total || 0) + '</strong></span>';
    html += '<span>' + usedPct + '%</span>';
    html += '</div>';
    html += '<div style="background:#1a1a2e;border-radius:6px;height:12px;overflow:hidden">';
    html += '<div style="width:' + usedPct + '%;height:100%;background:linear-gradient(90deg,#00ff88,#00cc66);border-radius:6px"></div>';
    html += '</div>';
    html += '</div>';
    
    html += '<div style="margin-bottom:8px">';
    html += '<div style="display:flex;justify-content:space-between;font-size:12px;color:#aaa;margin-bottom:3px">';
    html += '<span>Activas: <strong style="color:#ffaa00">' + (fibers.active || 0) + '</strong> ⚡</span>';
    html += '<span>' + activePct + '%</span>';
    html += '</div>';
    html += '<div style="background:#1a1a2e;border-radius:6px;height:12px;overflow:hidden">';
    html += '<div style="width:' + activePct + '%;height:100%;background:linear-gradient(90deg,#ffaa00,#ff8800);border-radius:6px"></div>';
    html += '</div>';
    html += '</div>';
    
    html += '<div style="font-size:12px;color:#888;margin-top:5px">Disponibles: <strong style="color:#aaa">' + (fibers.available || 0) + '</strong></div>';
    html += '</div>';
    
    // Connections section
    html += '<div style="background:#0f3460;border-radius:8px;padding:15px;margin-bottom:10px">';
    html += '<h4 style="color:#00d4ff;margin-bottom:8px">📦 Puertos de NAP</h4>';
    html += '<table style="width:100%;font-size:12px">';
    html += '<tr><td style="padding:4px 8px;color:#aaa">Total de puertos</td><td style="padding:4px 8px;text-align:right;color:#ddd">' + (connections.nap_ports_total || 0) + '</td></tr>';
    html += '<tr><td style="padding:4px 8px;color:#aaa">Puertos usados</td><td style="padding:4px 8px;text-align:right;color:#00ff88">' + (connections.nap_ports_used || 0) + '</td></tr>';
    html += '<tr><td style="padding:4px 8px;color:#aaa">Puertos disponibles</td><td style="padding:4px 8px;text-align:right;color:#888">' + (connections.nap_ports_available || 0) + '</td></tr>';
    html += '</table></div>';
    
    // Splices section
    html += '<div style="background:#0f3460;border-radius:8px;padding:15px;margin-bottom:10px">';
    html += '<h4 style="color:#ffaa00;margin-bottom:8px">🔗 Empalmes y Fusions</h4>';
    html += '<table style="width:100%;font-size:12px">';
    html += '<tr><td style="padding:4px 8px;color:#aaa">Total de empalmes</td><td style="padding:4px 8px;text-align:right;color:#ddd">' + (splices.total || 0) + '</td></tr>';
    html += '<tr><td style="padding:4px 8px;color:#aaa">Fusiones</td><td style="padding:4px 8px;text-align:right;color:#ddd">' + (splices.fusions || 0) + '</td></tr>';
    html += '<tr><td style="padding:4px 8px;color:#aaa">Empalmes mecánicos</td><td style="padding:4px 8px;text-align:right;color:#ddd">' + (splices.splices || 0) + '</td></tr>';
    html += '<tr><td style="padding:4px 8px;color:#aaa">Pérdida promedio (fusiones)</td><td style="padding:4px 8px;text-align:right;color:#ffaa00">' + (splices.avg_fusion_loss_db || 0) + ' dB</td></tr>';
    html += '<tr><td style="padding:4px 8px;color:#aaa">Pérdida promedio (empalmes)</td><td style="padding:4px 8px;text-align:right;color:#ffaa00">' + (splices.avg_splice_loss_db || 0) + ' dB</td></tr>';
    html += '</table></div>';
    
    // Infrastructure section
    html += '<div style="background:#0f3460;border-radius:8px;padding:15px;margin-bottom:10px">';
    html += '<h4 style="color:#888;margin-bottom:8px">🏗️ Infraestructura</h4>';
    html += '<table style="width:100%;font-size:12px">';
    html += '<tr><td style="padding:4px 8px;color:#aaa">Longitud total de cables</td><td style="padding:4px 8px;text-align:right;color:#ddd">' + (infra.total_cable_length_m || 0) + ' m <span style="color:#888">(' + (infra.total_cable_length_km || 0) + ' km)</span></td></tr>';
    html += '</table></div>';
    
    // Cable fiber usage
    if (cableUsage.length > 0) {
      html += '<div style="background:#0f3460;border-radius:8px;padding:15px;margin-bottom:10px">';
      html += '<h4 style="color:#00d4ff;margin-bottom:8px">🔌 Uso de Fibras por Cable</h4>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
      html += '<tr style="background:#16213e;color:white"><th style="padding:4px">Cable</th><th style="padding:4px">Total</th><th style="padding:4px">Usadas</th><th style="padding:4px">Activas</th><th style="padding:4px">% Uso</th></tr>';
      cableUsage.forEach(function(cu) {
        var pct = cu.total > 0 ? Math.round((cu.used / cu.total) * 100) : 0;
        html += '<tr style="border-bottom:1px solid #333">';
        html += '<td style="padding:4px;color:#ddd">' + escHtml(cu.cable_name || '') + '</td>';
        html += '<td style="padding:4px;text-align:center;color:#888">' + cu.total + '</td>';
        html += '<td style="padding:4px;text-align:center;color:#00ff88">' + cu.used + '</td>';
        html += '<td style="padding:4px;text-align:center;color:#ffaa00">' + cu.active + '</td>';
        html += '<td style="padding:4px;text-align:center;color:#888">' + pct + '%</td>';
        html += '</tr>';
      });
      html += '</table></div>';
    }
    
    html += '<div class="btn-group" style="margin-top:15px"><button class="btn-secondary" onclick="closeModal()">Cerrar</button></div>';
    html += '</div>';
    
    openModal(html);
  } catch(e) {
    showToast('❌ Error al cargar reporte: ' + e.message);
  }
}

// ========== CABLE CONTEXT MENU (right-click on map cable) ==========
function showCableContextMenu(event, cableId, cableName, clickLat, clickLng) {
  _cableCtxLat = clickLat;
  _cableCtxLng = clickLng;
  event.preventDefault();
  hideAllContextMenus();
  
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.cssText = 'position:fixed;left:' + event.clientX + 'px;top:' + event.clientY + 'px;z-index:10000';
  menu.innerHTML = `
    <div class="ctx-item" onclick="hideAllContextMenus();showFiberStatus(${cableId})">🔍 Ver fibras</div>
    <div class="ctx-item" onclick="hideAllContextMenus();showCableRouting(${cableId})">🗺 Ver ruteo</div>
    <div class="ctx-divider"></div>
    <div class="ctx-item" onclick="hideAllContextMenus();editCableRoute(${cableId})">🗺 Editar trazado</div>
    <div class="ctx-divider"></div>
    <div class="ctx-item" onclick="hideAllContextMenus();addElementAtClick('nap', ${cableId})">📦 Agregar NAP aquí</div>
    <div class="ctx-item" onclick="hideAllContextMenus();addElementAtClick('manga', ${cableId})">🧶 Agregar Manga aquí</div>
    <div class="ctx-divider"></div>
    <div class="ctx-item" style="color:#e94560" onclick="hideAllContextMenus();deleteCableConfirm(${cableId}, '${escHtml(cableName)}')">✕ Eliminar cable</div>
  `;
  document.body.appendChild(menu);
  
  // Click outside to close
  setTimeout(() => {
    document.addEventListener('click', function closeCtx(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeCtx);
      }
    });
  }, 0);
}

var _cableCtxLat = null, _cableCtxLng = null;

function showMarkerContextMenu(event, type, id, name, lat, lng) {
  event.preventDefault();
  hideAllContextMenus();
  
  // Si estamos en modo trazado de cable, ofrecer conectar
  if (state.cableDrawingPoints && state.cableDrawingPoints.length > 0) {
    var menu2 = document.createElement('div');
    menu2.className = 'ctx-menu';
    menu2.style.cssText = 'position:fixed;left:' + event.clientX + 'px;top:' + event.clientY + 'px;z-index:10000;background:#1a3a2a;border:1px solid #e94560';
    var icon2 = type === 'olt' ? '⚡' : (type === 'nap' ? '📦' : '🧶');
    menu2.innerHTML = '<div style="padding:4px 10px;color:#e94560;font-size:11px;border-bottom:1px solid #444;font-weight:bold">🔌 Modo Cable</div>' +
      '<div class="ctx-item" style="color:#00ff88;font-weight:bold" onclick="hideAllContextMenus();confirmCableConnectionAt(' + id + ',\'' + type + '\',' + lat + ',' + lng + ')">🔗 Conectar cable aquí</div>';
    document.body.appendChild(menu2);
    setTimeout(function() {
      document.addEventListener('click', function closeCtx(e) {
        if (!menu2.contains(e.target)) { menu2.remove(); document.removeEventListener('click', closeCtx); }
      });
    }, 0);
    return;
  }
  
  var menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.cssText = 'position:fixed;left:' + event.clientX + 'px;top:' + event.clientY + 'px;z-index:10000';
  var icon = type === 'olt' ? '⚡' : (type === 'nap' ? '📦' : '🧶');
  var typeName = type === 'olt' ? 'OLT' : (type === 'nap' ? 'NAP' : 'Manga');
  var items = '';
  if (type === 'olt') {
    items += '<div class="ctx-item" onclick="hideAllContextMenus();openOLTVisualizer(' + id + ')">🔍 Abrir visualizador</div>';
    items += '<div class="ctx-item" onclick="hideAllContextMenus();showEditOLT(' + id + ')">✏️ Editar</div>';
  } else if (type === 'nap') {
    items += '<div class="ctx-item" onclick="hideAllContextMenus();openVisualizer(' + id + ')">🔍 Abrir</div>';
    items += '<div class="ctx-item" onclick="hideAllContextMenus();editNap(' + id + ')">✏️ Editar</div>';
  } else if (type === 'manga') {
    items += '<div class="ctx-item" onclick="hideAllContextMenus();openMangaVisualizer(' + id + ')">🔍 Abrir visualizador</div>';
    items += '<div class="ctx-item" onclick="hideAllContextMenus();editManga(' + id + ')">✏️ Editar</div>';
  }
  items += '<div class="ctx-divider"></div>';
  items += '<div class="ctx-item" style="color:#e94560" onclick="hideAllContextMenus();contextDeleteMarker(' + "'" + type + "'" + ', ' + id + ', ' + "'" + escHtml(name) + "'" + ')">🗑️ Eliminar ' + typeName + '</div>';
  menu.innerHTML = '<div style="padding:4px 10px;color:#888;font-size:11px;border-bottom:1px solid #333">' + icon + ' ' + escHtml(name) + '</div>' + items;
  document.body.appendChild(menu);
  setTimeout(function() {
    document.addEventListener('click', function closeCtx(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeCtx); }
    });
  }, 0);
}

function confirmCableConnectionAt(id, type, lat, lng) {
  if (!state.cableDrawingPoints || state.cableDrawingPoints.length === 0) {
    showToast('❌ No hay trazado de cable activo');
    return;
  }
  console.log('[CABLE] confirmCableConnectionAt id=' + id + ' type=' + type + ' currentPoints=' + state.cableDrawingPoints.length);
  // Cerrar popup
  map.closePopup();
  // Agregar punto al cable conectado a este elemento
  state.cableDrawingPoints.push({ lat, lng, element_type: type, element_id: id, conectado: true });
  console.log('[CABLE] After push: ' + state.cableDrawingPoints.length + ' points');
  
  // Mostrar marcador
  const pm = L.circleMarker([lat, lng], {
    radius: 10, color: '#ffaa00', fillColor: '#ffaa00', fillOpacity: 0.7
  }).addTo(map);
  pm.bindTooltip('🔗 ' + (type === 'nap' ? state.naps.find(function(n){return n.id==id})?.name || '' : type === 'olt' ? state.olts.find(function(o){return o.id==id})?.name || '' : state.mangas.find(function(m){return m.id==id})?.name || ''), { direction: 'top' }).openTooltip();
  state.tempMarkers.push(pm);
  
  // Actualizar linea
  var pts = state.cableDrawingPoints.map(function(p) { return [p.lat, p.lng]; });
  console.log('[CABLE] Updating line with pts:', JSON.stringify(pts.map(function(p){return p.map(function(x){return x.toFixed(6)})})));
  if (state.cableTempLine) map.removeLayer(state.cableTempLine);
  state.cableTempLine = L.polyline(pts, { color: '#00ff88', weight: 3, dashArray: '5,5' }).addTo(map);
  
  updateCableStatus();
  showToast('✅ Cable conectado a ' + (type === 'nap' ? 'NAP' : type === 'olt' ? 'OLT' : 'Manga'));
}

function showEditOLT(oltId) {
  var olt = state.olts.find(function(o) { return o.id == oltId; });
  if (!olt) { showToast('❌ OLT no encontrada'); return; }
  var newName = prompt('✏️ Nombre de la OLT:', olt.name);
  if (newName === null) return;
  fetch(API + '/olts/' + oltId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName }) })
    .then(function(r) { if (!r.ok) throw new Error(); showToast('✅ OLT actualizada'); refreshAll(); })
    .catch(function(e) { showToast('❌ Error al actualizar'); });
}

function editNap(napId) {
  var nap = state.naps.find(function(n) { return n.id == napId; });
  if (!nap) { showToast('❌ NAP no encontrada'); return; }
  var newName = prompt('✏️ Nombre de la NAP:', nap.name);
  if (newName === null) return;
  fetch(API + '/naps/' + napId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName }) })
    .then(function(r) { if (!r.ok) throw new Error(); showToast('✅ NAP actualizada'); refreshAll(); })
    .catch(function(e) { showToast('❌ Error al actualizar'); });
}

function editManga(mangaId) {
  var manga = state.mangas.find(function(m) { return m.id == mangaId; });
  if (!manga) { showToast('❌ Manga no encontrada'); return; }
  var newName = prompt('✏️ Nombre de la Manga:', manga.name);
  if (newName === null) return;
  fetch(API + '/mangas/' + mangaId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName }) })
    .then(function(r) { if (!r.ok) throw new Error(); showToast('✅ Manga actualizada'); refreshAll(); })
    .catch(function(e) { showToast('❌ Error al actualizar'); });
}

var _deleteMarkerTarget = null; // { type, id, name } for modal confirm

function contextDeleteMarker(type, id, name) {
  _deleteMarkerTarget = { type: type, id: id, name: name };
  var icon = type === 'olt' ? '⚡' : (type === 'nap' ? '📦' : '🧶');
  var typeName = type === 'olt' ? 'OLT' : (type === 'nap' ? 'NAP' : 'Manga');
  showModal('🗑️ Eliminar ' + typeName,
    '<p style="color:#ccc;margin:12px 0">¿Eliminar permanentemente ' + icon + ' <strong>' + escHtml(name) + '</strong>?</p>' +
    '<p style="color:#888;font-size:12px;margin-bottom:16px">Esta acción no se puede deshacer. Se eliminarán todos los puertos y conexiones asociados.</p>' +
    '<div class="btn-group">' +
      '<button class="btn-danger" id="btn-confirm-delete-marker">🗑️ Eliminar</button>' +
      '<button class="btn-secondary" onclick="closeModal()">Cancelar</button>' +
    '</div>'
  );
  // Bind confirm handler (prevents HTML escaping issues with onclick)
  setTimeout(function() {
    var btn = document.getElementById('btn-confirm-delete-marker');
    if (btn) btn.onclick = function() { doDeleteMarker(); };
  }, 0);
}

function doDeleteMarker() {
  var target = _deleteMarkerTarget;
  if (!target) return;
  _deleteMarkerTarget = null;
  closeModal();
  var url = target.type === 'olt' ? '/olts/' + target.id : (target.type === 'nap' ? '/naps/' + target.id : '/mangas/' + target.id);
  fetch(API + url, { method: 'DELETE' })
    .then(function(r) {
      if (!r.ok) throw new Error('Error al eliminar');
      showToast('✅ ' + target.name + ' eliminado');
      refreshAll();
    })
    .catch(function(e) { showToast('❌ ' + e.message); });
}

// ========== EDIT CABLE ROUTE MODE ==========
var _editingCableId = null; // cable id being edited

async function editCableRoute(cableId) {
  var cable = state.cables.find(function(c) { return c.id == cableId; });
  if (!cable) { showToast('❌ Cable no encontrado'); return; }
  
  var pts = (state._cablePoints || []).filter(function(p) { return p.cable_id == cableId; });
  if (pts.length < 2) {
    showToast('❌ El cable no tiene puntos de ruta');
    return;
  }
  
  cancelEditCable();
  _editingCableId = cableId;
  
  // Cancel any previous cable drawing
  cancelCableCreation();
  
  // Show cable panel with existing data
  document.getElementById('cable-name').value = cable.name || 'Cable-' + cableId;
  document.getElementById('cable-fibers').value = cable.fiber_count || 12;
  document.getElementById('cable-tubes').value = cable.tube_count || 4;
  document.getElementById('cable-type').value = cable.cable_type || 'Drop';
  document.getElementById('cable-atten').value = cable.attenuation_db_per_km || 0.35;
  document.getElementById('cable-color').value = cable.color || '#3388ff';
  document.getElementById('cable-status-text').textContent = '✏️ Editando trazado — clic en el mapa para agregar puntos';
  document.getElementById('cable-btn-finish').disabled = false;
  document.getElementById('cable-btn-finish').textContent = '✅ Guardar cambios';
  document.getElementById('cable-panel').classList.remove('hidden');
  
  // Load cable types
  loadCableTypes();
  
  // Pre-populate drawing with existing points
  state.cableDrawingPoints = pts.map(function(p) {
    return { lat: p.lat, lng: p.lng, element_type: p.element_type, element_id: p.element_id, conectado: !!p.element_type };
  });
  
  // Ocultar linea original del cable mientras editamos
  state.cablePolylines.forEach(function(pl) {
    if (map.hasLayer(pl)) map.removeLayer(pl);
  });
  
  // Draw editing route
  var routeLats = pts.map(function(p) { return [p.lat, p.lng]; });
  state.cableTempLine = L.polyline(routeLats, { color: '#00ff88', weight: 3, dashArray: '5,5' }).addTo(map);
  
  // Direction control
  state._editDirection = 'end'; // default: extend from end
  
  // Helper: crear marcador arrastrable
  function makeEditMarker(lat, lng, color, label, isStart) {
    var ptIdx = isStart ? 0 : (pts.length - 1);
    var m = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'cable-drag-marker',
        html: '<div style="width:22px;height:22px;background:' + color + ';border:3px solid #fff;border-radius:50%;cursor:grab;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      }),
      draggable: true
    }).addTo(map);
    m.bindTooltip(label, { direction: 'top' });
    m._cablePointIdx = ptIdx;
    
    // Click: cambiar direccion de extension
    m.on('click', function() {
      state._editDirection = isStart ? 'start' : 'end';
      // Resaltar el seleccionado
      var allIcons = startM.getIcon && endM.getIcon ? [startM, endM] : [];
      if (startM && startM.setIcon) {
        startM.setIcon(L.divIcon({
          className: 'cable-drag-marker',
          html: '<div style="width:' + (isStart ? 28 : 22) + 'px;height:' + (isStart ? 28 : 22) + 'px;background:' + (isStart ? '#ffeb3b' : '#4CAF50') + ';border:3px solid #fff;border-radius:50%;cursor:grab;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>',
          iconSize: [isStart ? 34 : 28, isStart ? 34 : 28],
          iconAnchor: [isStart ? 17 : 14, isStart ? 17 : 14]
        }));
      }
      if (endM && endM.setIcon) {
        endM.setIcon(L.divIcon({
          className: 'cable-drag-marker',
          html: '<div style="width:' + (!isStart ? 28 : 22) + 'px;height:' + (!isStart ? 28 : 22) + 'px;background:' + (!isStart ? '#ffeb3b' : '#e94560') + ';border:3px solid #fff;border-radius:50%;cursor:grab;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>',
          iconSize: [!isStart ? 34 : 28, !isStart ? 34 : 28],
          iconAnchor: [!isStart ? 17 : 14, !isStart ? 17 : 14]
        }));
      }
      document.getElementById('cable-status-text').textContent = isStart ? '\u2B05\uFE0F Extendiendo desde INICIO' : '\u27A1\uFE0F Extendiendo desde FINAL';
      showToast(isStart ? '\uD83D\uDFE2 Ahora al INICIO' : '\uD83D\uDD34 Ahora al FINAL');
    });
    
    function onEditDragEnd() {
      map.dragging.enable();
      var pos = m.getLatLng();
      var nearEl = findNearElement(pos.lat, pos.lng, 0.00004);
      if (nearEl) {
        var yaConectado = state.cableDrawingPoints.some(function(p) {
          return p.element_type === nearEl.type && p.element_id === nearEl.id;
        });
        if (!yaConectado) {
          // Mostrar popup preguntando si conectar
          var elIcon = nearEl.type === 'nap' ? '\uD83D\uDCE6' : (nearEl.type === 'olt' ? '\u26A1' : '\uD83E\uDDF6');
          var popupHtml = '<div style="min-width:200px;text-align:center">' +
            '<div style="font-size:24px;margin-bottom:5px">' + elIcon + '</div>' +
            '<div style="font-weight:bold;font-size:14px;margin-bottom:8px;color:#00ff88">' + nearEl.name + '</div>' +
            '<div style="margin-bottom:8px;font-size:12px;color:#aaa">\uD83D\uDCCD Arrastraste hasta este elemento</div>' +
            '<button onclick="connectEditPoint(' + ptIdx + ',' + nearEl.id + ',\'' + nearEl.type + '\')" style="background:#e94560;color:#fff;border:none;padding:8px 20px;border-radius:5px;cursor:pointer;font-size:13px;font-weight:bold;width:100%">\uD83D\uDD17 Conectar cable aqu\u00ED</button>' +
            '</div>';
          var tempM = L.marker([pos.lat, pos.lng], {
            icon: L.divIcon({ className: '', html: '', iconSize: [0,0] })
          }).addTo(map);
          setTimeout(function() {
            tempM.bindPopup(popupHtml, { closeButton: true, maxWidth: 250 }).openPopup();
          }, 50);
          state.tempMarkers.push(tempM);
        }
      }
    }
    m.on('dragstart', function() { map.dragging.disable(); });
    m.on('dragend', onEditDragEnd);
    m.on('drag', function() {
      var pos = m.getLatLng();
      state.cableDrawingPoints[ptIdx].lat = pos.lat;
      state.cableDrawingPoints[ptIdx].lng = pos.lng;
      var allPts = state.cableDrawingPoints.map(function(p) { return [p.lat, p.lng]; });
      if (state.cableTempLine) state.cableTempLine.setLatLngs(allPts);
    });
    state.tempMarkers.push(m);
    return m;
  }
  
  var startM = makeEditMarker(pts[0].lat, pts[0].lng, '#4CAF50', '\uD83D\uDFE2 Inicio \u2014 clic para extender', true);
  var endM = makeEditMarker(pts[pts.length-1].lat, pts[pts.length-1].lng, '#e94560', '\uD83D\uDD34 Final \u2014 clic para extender', false);
  
  // Add draggable markers for intermediate points
  for (var i = 1; i < pts.length - 1; i++) {
    (function(idx) {
      // Usar L.marker con icono circular personalizado (circleMarker no soporta draggable)
      var im = L.marker([pts[idx].lat, pts[idx].lng], {
        icon: L.divIcon({
          className: 'cable-drag-marker',
          html: '<div style="width:14px;height:14px;background:#00d4ff;border:2px solid #fff;border-radius:50%;cursor:grab"></div>',
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        }),
        draggable: true
      }).addTo(map);
      im._cablePointIdx = idx;
      im.on('dragstart', function() { map.dragging.disable(); });
      im.on('dragend', function() {
        map.dragging.enable();
        var pos = im.getLatLng();
        var nearEl = findNearElement(pos.lat, pos.lng, 0.00004);
        if (nearEl) {
          var yaCon = state.cableDrawingPoints.some(function(p) {
            return p.element_type === nearEl.type && p.element_id === nearEl.id;
          });
          if (!yaCon) {
            var elIcon = nearEl.type === 'nap' ? '\uD83D\uDCE6' : (nearEl.type === 'olt' ? '\u26A1' : '\uD83E\uDDF6');
            var html = '<div style="min-width:200px;text-align:center">' +
              '<div style="font-size:24px;margin-bottom:5px">' + elIcon + '</div>' +
              '<div style="font-weight:bold;font-size:14px;margin-bottom:8px;color:#00ff88">' + nearEl.name + '</div>' +
              '<button onclick="connectEditPoint(' + idx + ',' + nearEl.id + ',\'' + nearEl.type + '\')" style="background:#e94560;color:#fff;border:none;padding:8px 20px;border-radius:5px;cursor:pointer;font-size:13px;font-weight:bold;width:100%">\uD83D\uDD17 Conectar cable aqu\u00ED</button></div>';
            var tm = L.marker([pos.lat, pos.lng], {
              icon: L.divIcon({ className: '', html: '', iconSize: [0,0] })
            }).addTo(map);
            setTimeout(function() { tm.bindPopup(html, { closeButton: true, maxWidth: 250 }).openPopup(); }, 50);
            state.tempMarkers.push(tm);
          }
        }
      });
      im.on('drag', function() {
        var pos = im.getLatLng();
        state.cableDrawingPoints[idx].lat = pos.lat;
        state.cableDrawingPoints[idx].lng = pos.lng;
        var allPts = state.cableDrawingPoints.map(function(p) { return [p.lat, p.lng]; });
        if (state.cableTempLine) state.cableTempLine.setLatLngs(allPts);
      });
      state.tempMarkers.push(im);
    })(i);
  }
  
  map.fitBounds(state.cableTempLine.getBounds().pad(0.15));
  
  // Set up map click handler \u2014 inserts at start or end
  state.mapClickHandler = function(lat, lng) {
    if (!_editingCableId) return;
    
    // Check if clicking near element
    var nearEl = findNearElement(lat, lng, 0.00004);
    if (nearEl && !state.cableDrawingPoints.some(function(p) { return p.element_id === nearEl.id && p.element_type === nearEl.type; })) {
      map.closePopup();
      
      var elIcon = nearEl.type === 'nap' ? '📦' : (nearEl.type === 'olt' ? '⚡' : '🧶');
      var popupContent = '<div style="font-weight:bold;color:#e94560;font-size:14px;margin-bottom:5px">' + elIcon + ' ' + nearEl.name + '</div>' +
        '<div style="font-size:12px;color:#aaa;margin-bottom:8px">📏 Clic para conectar cable</div>' +
        '<button class="btn-primary" onclick="addCablePoint(' + nearEl.el.lat + ', ' + nearEl.el.lng + ', \'' + nearEl.type + '\', ' + nearEl.id + ', true)\
">🔗 Conectar</button>';
      L.popup({ closeButton: true, className: 'cable-popup' })
        .setLatLng([nearEl.el.lat, nearEl.el.lng])
        .setContent(popupContent)
        .openOn(map);
      return;
    }
    
    // Add point at chosen direction — use addCablePoint for drag support
    if (state._editDirection === 'start') {
      // For start: insert at beginning and rebuild markers
      state.cableDrawingPoints.unshift({ lat: lat, lng: lng, element_type: null, element_id: null, conectado: false });
      // Rebuild temp line and markers to keep indices correct
      if (state.cableTempLine) map.removeLayer(state.cableTempLine);
      var allLats2 = state.cableDrawingPoints.map(function(p) { return [p.lat, p.lng]; });
      state.cableTempLine = L.polyline(allLats2, { color: '#00ff88', weight: 3, dashArray: '5,5' }).addTo(map);
      // Rebuild draggable markers for all points (usando L.marker que soporta draggable)
      state.tempMarkers.forEach(function(m) { map.removeLayer(m); });
      state.tempMarkers = [];
      state.cableDrawingPoints.forEach(function(p, i) {
        var pm2 = L.marker([p.lat, p.lng], {
          icon: L.divIcon({
            className: 'cable-drag-marker',
            html: '<div style="width:' + (p.element_type ? 20 : 12) + 'px;height:' + (p.element_type ? 20 : 12) + 'px;background:' + (p.element_type ? '#ffaa00' : '#00d4ff') + ';border:2px solid #fff;border-radius:50%;cursor:grab"></div>',
            iconSize: [p.element_type ? 24 : 16, p.element_type ? 24 : 16],
            iconAnchor: [p.element_type ? 12 : 8, p.element_type ? 12 : 8]
          }),
          draggable: true
        }).addTo(map);
        pm2._cablePointIdx = i;
        pm2.on('dragstart', function() { map.dragging.disable(); });
        pm2.on('dragend', function() { map.dragging.enable(); updateCableStatus(); });
        pm2.on('drag', function() {
          var pos = pm2.getLatLng();
          state.cableDrawingPoints[i].lat = pos.lat;
          state.cableDrawingPoints[i].lng = pos.lng;
          state.cableTempLine.setLatLngs(state.cableDrawingPoints.map(function(x) { return [x.lat, x.lng]; }));
        });
        state.tempMarkers.push(pm2);
      });
    } else {
      addCablePoint(lat, lng, null, null, false);
    }
    updateCableStatus();
  };
  
  updateCableStatus();
  document.getElementById('cable-status-text').textContent += ' \u2014 clic en \uD83D\uDFE2 inicio o \uD83D\uDD34 final para elegir direcci\u00F3n';
}

function cancelEditCable() {
  if (_editingCableId) {
    _editingCableId = null;
    cancelCableCreation();
  }
}

async function addElementAtClick(type, cableId) {
  if (_cableCtxLat == null || _cableCtxLng == null) { showToast('❌ No se pudo obtener la ubicación'); return; }
  ctxLat = parseFloat(_cableCtxLat);
  ctxLng = parseFloat(_cableCtxLng);
  
  // Create the element first
  var result;
  if (type === 'nap') {
    result = await api('/naps', 'POST', {
      name: 'NAP-' + (state.naps.length + 1) + '-C' + cableId,
      lat: ctxLat, lng: ctxLng,
      splitter_type_id: null,
      port_capacity: 8,
      address: '', description: 'Insertada en cable #' + cableId
    });
  } else {
    result = await api('/mangas', 'POST', {
      name: 'Manga-' + (state.mangas.length + 1) + '-C' + cableId,
      lat: ctxLat, lng: ctxLng,
      description: 'Insertada en cable #' + cableId
    });
  }
  
  if (!result || !result.id) { showToast('❌ Error al crear elemento'); return; }
  var newId = result.id;
  
  // Mostrar el nuevo elemento automaticamente en el mapa
  state.visibleItems.add(type + ':' + newId);
  
  // Now insert the point into the cable route with element connection
  var pts = (state._cablePoints || []).filter(function(p) { return p.cable_id == cableId; }).sort(function(a, b) { return a.sequence - b.sequence; });
  if (pts.length < 2) { showToast('❌ El cable no tiene suficientes puntos'); return; }
  
  // Find the closest segment on the cable and insert points
  var insertIdx = -1;
  var minDist = Infinity;
  for (var i = 0; i < pts.length - 1; i++) {
    var midLat = (pts[i].lat + pts[i+1].lat) / 2;
    var midLng = (pts[i].lng + pts[i+1].lng) / 2;
    var d = Math.sqrt(Math.pow(midLat - ctxLat, 2) + Math.pow(midLng - ctxLng, 2));
    if (d < minDist) { minDist = d; insertIdx = i + 1; }
  }
  
  // Detectar si estamos en los ÚLTIMOS 40 METROS del cable (o primeros 40m)
  // Calcula la distancia DIRECTA (Haversine) desde el clic hasta los extremos del cable
  function _distHaversine(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
  var distAlInicio = _distHaversine(ctxLat, ctxLng, pts[0].lat, pts[0].lng);
  var distAlFinal = _distHaversine(ctxLat, ctxLng, pts[pts.length - 1].lat, pts[pts.length - 1].lng);
  var esFinalCable = distAlFinal <= 40 || distAlInicio <= 40;
  
  // Si es final del cable, mover insertIdx al extremo correspondiente
  // para que el punto quede AL INICIO O AL FINAL de la ruta, no en medio
  if (esFinalCable) {
    if (distAlInicio <= distAlFinal) {
      insertIdx = 0; // Cerca del inicio → insertar al PRINCIPIO
    } else {
      insertIdx = pts.length; // Cerca del final → insertar al FINAL
    }
  }
  
  console.log('[ADD-ELEMENT] insertIdx=' + insertIdx + ' pts.length=' + pts.length + ' distInicio=' + distAlInicio.toFixed(1) + 'm distFinal=' + distAlFinal.toFixed(1) + 'm esFinal=' + esFinalCable + ' totalPts=' + pts.length + ' ultimoPt=' + pts[pts.length-1].element_type + '#' + pts[pts.length-1].element_id);
  
  // Build points array
  var allPts = [];
  for (var i = 0; i <= pts.length; i++) {
    if (i === insertIdx) {
      if (esFinalCable) {
        // FINAL del cable: solo UNA punta al extremo, sin continuidad
        allPts.push({ lat: ctxLat, lng: ctxLng, element_type: type, element_id: newId });
      } else {
        // Medio del cable: DOS puntas (entrada y salida) para pass-through
        allPts.push({ lat: ctxLat, lng: ctxLng, element_type: type, element_id: newId });
        allPts.push({ lat: ctxLat, lng: ctxLng, element_type: type, element_id: newId });
      }
    }
    if (i < pts.length) {
      allPts.push({ lat: pts[i].lat, lng: pts[i].lng, element_type: pts[i].element_type || null, element_id: pts[i].element_id || null });
    }
  }
  
  // Save updated cable route
  try {
    var res = await fetch(API + '/cables/' + cableId + '/points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: allPts })
    });
    if (!res.ok) throw new Error('Error al insertar punto');
    
    // Auto-create fusions para mangas y NAPs (si no está en final del cable)
    if (!esFinalCable) {
      // Auto-create fusions for each fiber (cable pass-through)
      var allPts2 = await fetch(API + '/cable-points?element_type=' + type + '&element_id=' + newId).then(function(r) { return r.json(); });
      if (Array.isArray(allPts2) && allPts2.length >= 2) {
        var cpIn = allPts2[0], cpOut = allPts2[1];
        var cableInfo = state.cables.find(function(c) { return c.id == cableId; });
        var hilos = cableInfo ? (cableInfo.fiber_count || 12) : 12;
        
        // Fetch existing fusions to avoid 409 conflicts
        var existingFusions = [];
        try { existingFusions = await fetch(API + '/mangas/' + newId + '/fusions').then(function(r) { return r.json(); }); } catch(e) {}
        var usedFibers = new Set();
        existingFusions.forEach(function(f) {
          if (parseInt(f.cable_connection_id_in) === cpIn.id) usedFibers.add(parseInt(f.fiber_in));
          if (parseInt(f.cable_connection_id_out) === cpOut.id) usedFibers.add(parseInt(f.fiber_out));
        });
        
        var fusionCount = 0;
        for (var fi = 1; fi <= hilos; fi++) {
          if (usedFibers.has(fi)) continue;
          try {
            var fusionBody = {
              cable_connection_id_in: cpIn.id,
              fiber_in: fi,
              cable_connection_id_out: cpOut.id,
              fiber_out: fi,
              loss_db: 0.05
            };
            // Solo enviar manga_id si es manga (NAP usa tabla aparte y no tiene FK en fusions)
            if (type === 'manga') {
              fusionBody.manga_id = newId;
            }
            var fr = await fetch(API + '/fusions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(fusionBody)
            });
            if (fr.ok) fusionCount++;
          } catch(e) {}
        }
        showToast('✅ ' + (type === 'nap' ? 'NAP' : 'Manga') + ' insertada — ' + fusionCount + '/' + hilos + ' hilos fusionados');
      } else {
        showToast('✅ ' + (type === 'nap' ? 'NAP' : 'Manga') + ' insertada en cable #' + cableId);
      }
    } else {
      showToast('✅ ' + (type === 'nap' ? 'NAP' : 'Manga') + ' insertada (final del cable) — sin fusiones');
    }
  } catch(e) {
    showToast('❌ Error: ' + e.message);
  }
  
  // Auto-asignar a carpeta activa si existe
  if (state.activeFolderId) {
    try {
      await api('/folder-items', 'POST', { folder_id: state.activeFolderId, item_type: type, item_id: newId });
    } catch(e) {}
  }
  
  await loadAll();
  // Asegurar que el nuevo elemento se muestre en el mapa
  updateMapVisibility();
}

function deleteCableConfirm(cableId, cableName) {
  if (confirm('¿Eliminar el cable \'' + cableName + '\'?\n\nSe eliminarán todas sus fibras y puntos de ruta.\nEsta acción no se puede deshacer.')) {
    api('/cables/' + cableId, 'DELETE').then(() => {
      showToast('🗑️ Cable \'' + cableName + '\' eliminado');
      loadAll();
    }).catch(e => {
      showToast('❌ Error al eliminar cable: ' + e.message);
    });
  }
}

function hideAllContextMenus() {
  document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
}

// ========== CABLE CREATOR - Floating Panel ==========
function startDrawCable() {
  cancelEditCable();
  showCableCreator(null, null);
}

function startMeasure() {
  showToast('📏 Haz clic en el mapa para medir distancias');
}

function showCableCreator(startLat, startLng) {
  // Limpiar cualquier trazado previo antes de empezar
  cancelCableCreation();
  // Set initial name
  document.getElementById('cable-name').value = 'Cable-' + (state.cables.length + 1);
  document.getElementById('cable-status-text').textContent = '💡 Clic en el mapa para empezar a trazar';
  document.getElementById('cable-btn-finish').disabled = true;
  
  // Load cable types from database
  loadCableTypes();
  
  // Show panel
  document.getElementById('cable-panel').classList.remove('hidden');
  
  // If we have a starting point from right-click
  if (startLat != null && startLng != null) {
    startCableTrace(startLat, startLng);
  } else {
    // Unbind NAP/Manga/OLT popups temporarily so clicks reach the map
    state._savedPopups = [];
    state._savedClickHandlers = [];
    [...state.markers.nap, ...state.markers.manga, ...state.markers.olt].forEach(function(m) {
      state._savedPopups.push({ marker: m, popup: m.getPopup() });
      m.unbindPopup();
      // Also add click handler to detect marker clicks for cable start
      var ch = function(e) {
        if (e && e.originalEvent) L.DomEvent.stopPropagation(e);
        var pos2 = m.getLatLng();
        startCableTrace(pos2.lat, pos2.lng);
      };
      m.on('click', ch);
      state._savedClickHandlers.push({ marker: m, handler: ch });
    });
    // Wait for first map click
    state.mapClickHandler = function(lat, lng) {
      startCableTrace(lat, lng);
    };
    showToast('📍 Clic en el mapa para colocar el primer punto del cable');
  }
}

// Cable type selector handler
async function loadCableTypes() {
  try {
    const types = await api('/cable-types');
    const sel = document.getElementById('cable-type-id');
    const currentVal = sel.value;
    // Keep only the first option (-- Seleccionar --)
    while (sel.options.length > 1) sel.remove(1);
    types.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name + ' (' + t.fiber_count + 'f, ' + t.attenuation_db_per_km + ' dB/km)';
      opt.dataset.fiberCount = t.fiber_count;
      opt.dataset.tubeCount = t.tube_count;
      opt.dataset.atten = t.attenuation_db_per_km;
      sel.appendChild(opt);
    });
    if (currentVal) sel.value = currentVal;
  } catch(e) {
    console.warn('Could not load cable types:', e);
  }
}

// When a standardized cable type is selected, auto-fill fiber count, tubes, attenuation
// and show a preview of the fiber colors
function onCableTypeChange() {
  const sel = document.getElementById('cable-type-id');
  const opt = sel.options[sel.selectedIndex];
  if (opt && opt.value) {
    const fiberCount = parseInt(opt.dataset.fiberCount);
    const tubeCount = parseInt(opt.dataset.tubeCount);
    const atten = parseFloat(opt.dataset.atten);
    if (!isNaN(fiberCount)) {
      document.getElementById('cable-fibers').value = fiberCount;
    }
    if (!isNaN(tubeCount)) {
      document.getElementById('cable-tubes').value = tubeCount;
    }
    if (!isNaN(atten)) {
      document.getElementById('cable-atten').value = atten;
    }
  }
}

function startCableTrace(lat, lng) {
  state.mapClickHandler = null;
  
  // Remover handlers previos (agregados por showCableCreator) antes de agregar nuevos
  restoreNapPopups();
  
  // Save original NAP/Manga/OLT popups and temporarily unbind them
  state._savedPopups = [];
  state._savedClickHandlers = [];
  [...state.markers.nap, ...state.markers.manga, ...state.markers.olt].forEach(m => {
    state._savedPopups.push({ marker: m, popup: m.getPopup() });
    m.unbindPopup();
    // Add click handler — show prompt to connect
    const clickHandler = function(e) {
      if (e && e.originalEvent) L.DomEvent.stopPropagation(e);
      var pos = m.getLatLng();
      console.log('[CABLE] Marker clicked at (' + pos.lat.toFixed(6) + ',' + pos.lng.toFixed(6) + ') cablePts=' + state.cableDrawingPoints.length);
      var nearEl = findNearElement(pos.lat, pos.lng, 0.00004);
      if (nearEl && state.cableDrawingPoints && state.cableDrawingPoints.length > 0) {
        console.log('[CABLE] Near element: ' + nearEl.name + ' type=' + nearEl.type + ' id=' + nearEl.id);
        // Check if already connected
        var yaConectado = state.cableDrawingPoints.some(function(p) {
          return p.element_type === nearEl.type && p.element_id === nearEl.id;
        });
        if (yaConectado) { console.log('[CABLE] Already connected — ignoring'); return; }
        console.log('[CABLE] Showing connect popup');
        
        // Show prompt popup
        map.closePopup();
        var elIcon = nearEl.type === 'nap' ? '📦' : (nearEl.type === 'olt' ? '⚡' : '🧶');
        var popupHtml = '<div style="min-width:200px;text-align:center">' +
          '<div style="font-size:24px;margin-bottom:5px">' + elIcon + '</div>' +
          '<div style="font-weight:bold;font-size:14px;margin-bottom:8px;color:#00ff88">' + nearEl.name + '</div>' +
          '<button onclick="confirmCableConnectionAt(' + nearEl.id + ',\'' + nearEl.type + '\',' + pos.lat + ',' + pos.lng + ')" style="background:#e94560;color:#fff;border:none;padding:8px 20px;border-radius:5px;cursor:pointer;font-size:13px;font-weight:bold;width:100%">🔗 Conectar cable aquí</button>' +
          '<button onclick="simpleWaypoint(' + pos.lat + ',' + pos.lng + ')" style="background:#333;color:#fff;border:none;padding:6px 16px;border-radius:5px;cursor:pointer;font-size:12px;margin-top:6px;width:100%">📍 Solo punto de paso</button></div>';
        var tempM = L.marker([pos.lat, pos.lng], {
          icon: L.divIcon({ className: '', html: '', iconSize: [0,0] })
        }).addTo(map);
        setTimeout(function() {
          tempM.bindPopup(popupHtml, { closeButton: true, maxWidth: 250 }).openPopup();
        }, 50);
        state.tempMarkers.push(tempM);
      } else if (state.mapClickHandler) {
        state.mapClickHandler(pos.lat, pos.lng);
      }
    };
    m.on('click', clickHandler);
    state._savedClickHandlers.push({ marker: m, handler: clickHandler });
  });
  
  // Check if starting on a NAP, Manga or OLT
  var nearEl = findNearElement(lat, lng, 0.00004);
  
  state.cableDrawingPoints = [{ lat, lng, element_type: null, element_id: null, conectado: false }];
  state.cablePendingConnection = false;
  
  // Marker for first point
  var markerColor = nearEl ? '#ffaa00' : '#00ff88';
  var marker = L.circleMarker([lat, lng], {
    radius: 8, color: markerColor, fillColor: markerColor, fillOpacity: 0.7
  }).addTo(map);
  state.tempMarkers.push(marker);
  
  if (nearEl) {
    // Show popup asking to connect
    var elIcon = nearEl.type === 'nap' ? '📦' : (nearEl.type === 'olt' ? '⚡' : '🧶');
    var popupHtml = '<div style="min-width:200px;text-align:center">' +
      '<div style="font-size:24px;margin-bottom:5px">' + elIcon + '</div>' +
      '<div style="font-weight:bold;font-size:14px;margin-bottom:10px;color:#00ff88">' + nearEl.name + '</div>' +
      '<div style="margin-bottom:12px;font-size:12px;color:#aaa">¿Iniciar cable aquí?</div>' +
      '<button onclick="startCableConnected(' + nearEl.id + ',\'' + nearEl.type + '\')" style="background:#e94560;color:#fff;border:none;padding:8px 20px;border-radius:5px;cursor:pointer;font-size:13px;font-weight:bold;width:100%">🔗 Conectar y empezar</button>' +
      '<button onclick="startCableHere()" style="background:#333;color:#fff;border:none;padding:6px 16px;border-radius:5px;cursor:pointer;font-size:12px;margin-top:6px;width:100%">📍 Solo empezar aquí</button></div>';
    marker.bindPopup(popupHtml, { closeButton: true, maxWidth: 250 }).openPopup();
  }
  
  // Update panel status
  updateCableStatus();
  document.getElementById('cable-status-text').textContent = '📍 Trazando — clic para agregar puntos, clic en inicio o ✅ para terminar';
  document.getElementById('cable-btn-finish').disabled = false;
  
  // Map click handler for adding points / finishing
  // ⭐ Solo maneja clics en el mapa VACIO o en el primer punto (para finalizar)
  state.mapClickHandler = async (clickLat, clickLng) => {
    console.log('[CABLE] mapClickHandler fired at (' + clickLat.toFixed(6) + ',' + clickLng.toFixed(6) + ') existing=' + state.cableDrawingPoints.length);
    const firstPt = state.cableDrawingPoints[0];
    // Check if clicking on first point to finish (incluso si esta en un elemento)
    if (firstPt) {
      const dist = Math.sqrt(Math.pow(firstPt.lat - clickLat, 2) + Math.pow(firstPt.lng - clickLng, 2));
      if (dist < 0.0004 && state.cableDrawingPoints.length >= 2) {
        console.log('[CABLE] Clicked on first point — finishing');
        finishCableDrawing();
        return;
      }
    }
    // Si hay un elemento cerca, NO procesar (el manejador del marcador lo hace)
    var nearEl = findNearElement(clickLat, clickLng, 0.00004);
    if (nearEl) { console.log('[CABLE] Near element ' + nearEl.name + ' — skipping'); return; }
    console.log('[CABLE] Adding waypoint');
    addCablePoint(clickLat, clickLng, null, null);
  };
}

// Confirm cable connection to NAP/Manga (called from popup)
function confirmCableConnection() {
  const nearEl2 = state._pendingCableConnection;
  if (!nearEl2) { showToast('❌ No hay conexión pendiente'); return; }
  state._pendingCableConnection = null;
  
  // Add the NAP/Manga as a waypoint
  addCablePoint(nearEl2.el ? nearEl2.el.lat : nearEl2.lat, nearEl2.el ? nearEl2.el.lng : nearEl2.lng, nearEl2.type, nearEl2.id, true);
  
  // Create marker at NAP location
  const ptMarker = L.circleMarker([nearEl2.el ? nearEl2.el.lat : nearEl2.lat, nearEl2.el ? nearEl2.el.lng : nearEl2.lng], {
    radius: 10, color: '#ffaa00', fillColor: '#ffaa00', fillOpacity: 0.7
  }).addTo(map);
  ptMarker.bindTooltip('🔗 ' + nearEl2.name, { direction: 'top' }).openTooltip();
  state.tempMarkers.push(ptMarker);
  
  updateCableStatus();
  showToast('✅ Cable conectado a ' + nearEl2.name);
  
  // Close any open popups
  map.closePopup();
}

// Conectar primer punto del cable a un elemento (desde popup)
function startCableConnected(id, type) {
  map.closePopup();
  if (!state.cableDrawingPoints || state.cableDrawingPoints.length === 0) return;
  state.cableDrawingPoints[0].element_type = type;
  state.cableDrawingPoints[0].element_id = id;
  state.cableDrawingPoints[0].conectado = true;
  // Actualizar marcador
  if (state.tempMarkers.length > 0) {
    var m = state.tempMarkers[0];
    m.setStyle({ radius: 10, color: '#ffaa00', fillColor: '#ffaa00' });
    var elName = type === 'nap' ? (state.naps.find(function(n){return n.id==id})?.name || '') : type === 'olt' ? (state.olts.find(function(o){return o.id==id})?.name || '') : (state.mangas.find(function(mg){return mg.id==id})?.name || '');
    m.bindTooltip('📌 Inicio: ' + elName, { direction: 'top' }).openTooltip();
  }
  showToast('🔗 Cable conectado a ' + (type === 'nap' ? 'NAP' : type === 'olt' ? 'OLT' : 'Manga'));
}

// Empezar cable sin conectar (solo marcar posicion)
function startCableHere() {
  map.closePopup();
  showToast('📍 Punto de inicio marcado');
}

// Conectar punto en edicion a un elemento (arrastrado)
function connectEditPoint(ptIdx, elId, elType) {
  map.closePopup();
  if (state.cableDrawingPoints && state.cableDrawingPoints[ptIdx]) {
    state.cableDrawingPoints[ptIdx].element_type = elType;
    state.cableDrawingPoints[ptIdx].element_id = elId;
    state.cableDrawingPoints[ptIdx].conectado = true;
    showToast('\uD83D\uDD17 Punto conectado a ' + (elType === 'nap' ? 'NAP' : elType === 'olt' ? 'OLT' : 'Manga'));
  }
}

// Agregar punto de paso simple sin conectar
function simpleWaypoint(lat, lng) {
  map.closePopup();
  addCablePoint(lat, lng, null, null, false);
  showToast('📍 Punto de paso agregado');
}

// ========== ASK: Add to folder after creation ==========
async function askAddToFolder(type, itemId) {
  // Mostrar el nuevo elemento automaticamente en el mapa
  state.visibleItems.add(type + ':' + itemId);
  
  // Auto-add to active folder if set — sin preguntar, sin toast
  if (state.activeFolderId) {
    const folder = state.folders.find(f => f.id == state.activeFolderId);
    if (folder) {
      await api('/folder-items', 'POST', { 
        folder_id: state.activeFolderId, 
        item_type: type, 
        item_id: itemId 
      });
      state.expandedFolders.add(state.activeFolderId);
      // Flash effect on folder (inline, no toast)
      flashTreeRow(state.activeFolderId);
    }
  }
  
  await refreshAll();
  renderTree();
}

// Flash a tree row briefly (inline indicator)
function flashTreeRow(folderId) {
  setTimeout(() => {
    const rows = document.querySelectorAll('.tree-row');
    for (const row of rows) {
      if (row.closest('[data-folder-id]') && row.closest('[data-folder-id]').dataset.folderId == folderId) {
        row.style.transition = 'background 0s';
        row.style.background = '#00cc6633';
        setTimeout(() => {
          row.style.transition = 'background 0.5s';
          row.style.background = '';
        }, 400);
        break;
      }
    }
  }, 100);
}

// ========== SHOW FOLDER EMPTY STATE ==========
function showFolderEmptyState(folderId) {
  const folder = state.folders.find(f => f.id == folderId);
  if (!folder) return;
  openModal(`
    <h3>📁 ${escHtml(folder.name)}</h3>
    <p style="color:#888;margin-bottom:15px">
      Esta carpeta está vacía. Puedes agregar elementos o sub-carpetas.
    </p>
    <div class="btn-group">
      <button class="btn-primary" onclick="closeModal();showNewFolderDialog(${folderId})">📁 Nueva sub-carpeta</button>
      <button class="btn-success" onclick="closeModal();showAddToFolderDialog(${folderId})">➕ Agregar item</button>
      <button class="btn-secondary" onclick="closeModal()">Cerrar</button>
    </div>
  `);
}

// ========== NAP VISUALIZER (unchanged from original) ==========
async function openVisualizer(napId) {
  // Reuse the manga visualizer layout with entityType='nap' =
  // same interactive SVG with cable blocks, splitter blocks, and fiber connections
  openMangaVisualizer(napId, 'nap');
  return;
  
  // ====== Build fibers data array with real colors ======
  const napFibers = [];
  for (const f of fibersWithPower) {
    const cable = cables.find(c => c.id == f.cable_id);
    let fiberColor = '#cccccc';
    let fiberColorName = '';
    const cbFibers = cableFibersMap[f.cable_id];
    if (cbFibers && cbFibers.length) {
      const cf = cbFibers.find(x => x.fiber_number === f.fiber_number);
      if (cf) {
        fiberColor = cf.color || '#cccccc';
        fiberColorName = cf.color_name || '';
      }
    }
    if (!fiberColorName && activeColorCode && activeColorCode.length) {
      const idx = ((f.fiber_number || 1) - 1) % activeColorCode.length;
      const cc = activeColorCode[idx];
      if (cc) {
        fiberColor = (typeof cc === 'object' && cc.hex) ? cc.hex : (typeof cc === 'string' ? cc : fiberColor);
        fiberColorName = (typeof cc === 'object' && cc.name) ? cc.name : fiberColorName;
      }
    }
    napFibers.push({
      fiber_number: f.fiber_number || 0,
      active_power: f.active_power || false,
      power_level: f.power_level || 0,
      cable_name: cable?.name || 'N/A',
      total_loss: f.total_loss || 0,
      fiber_color: fiberColor,
      fiber_color_name: fiberColorName
    });
  }
  
  const hasFibers = napFibers.length > 0 || fibers.some(f => f.id);
  
  let portsHTML = '';
  for (let i = 1; i <= splitterPorts; i++) {
    const port = ports.find(p => p.port_number === i);
    const hasClient = port?.client_name || port?.fiber_number;
    const fiberActive = fibersWithPower.find(f => f.target_port_id === port?.id && f.active_power);
    const powerVal = fiberActive?.calc?.remaining_power;
    
    // Find fiber color for this port
    const fiberEntry = napFibers.find(f => f.fiber_number === (port?.fiber_number || i));
    const portFiberColor = fiberEntry?.fiber_color || (port?.fiber_number ? getFiberColor(port.fiber_number, activeColorCode) : null);
    const portFiberColorName = fiberEntry?.fiber_color_name || (port?.fiber_number ? getFiberColorName(port.fiber_number, activeColorCode) : '');
    const isWhite = portFiberColor === '#ffffff' || portFiberColor === '#FFFFFF';
    const colorBorder = isWhite ? '2px solid #ccc' : '2px solid #555';
    
    portsHTML += `
      <div class="fiber-port ${hasClient ? 'connected' : ''} ${fiberActive ? 'active' : ''}"
           onclick="editNapPort(${napId}, ${i})">
        <div class="port-number">Puerto ${i}</div>
        <div class="port-status">${port?.client_name || 'Libre'}</div>
        ${fiberActive ? `<div class="port-power">⚡ ${powerVal?.toFixed(1) || '?'} dBm</div>` : ''}
        ${hasClient && port?.fiber_number ? `<div class="port-status" style="color:#00cc66">✅ Fibra #${port.fiber_number}</div>` : ''}
        ${portFiberColor ? `<div style="display:flex;align-items:center;margin-top:4px;gap:6px"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${portFiberColor};border:${colorBorder}"></span><span style="font-size:11px;color:#aaa">${portFiberColorName}</span></div>` : ''}
        ${port?.client_name ? `<div style="font-size:11px;color:#00d4ff;margin-top:2px">👤 ${port.client_name}</div>` : ''}
      </div>
    `;
  }
  
  // ====== SVG: F1 → SPLITTER → F2 LAYOUT ======
  let svgContent = '';
  const w = 1400;
  const h = 520;
  
  if (!hasFibers) {
    // === EMPTY STATE ===
    let svg = `<rect width="${w}" height="${h}" fill="#f5f5f5" rx="6" />`;
    svg += `<text x="${w/2}" y="${h/2 - 20}" text-anchor="middle" fill="#bbb" font-family="sans-serif" font-size="22">📦 Esta NAP no tiene fibras conectadas</text>`;
    svg += `<text x="${w/2}" y="${h/2 + 15}" text-anchor="middle" fill="#ccc" font-family="sans-serif" font-size="14">Despliega cables en el mapa o conecta fibras desde los puertos</text>`;
    svg += `<text x="${w/2}" y="${h/2 + 45}" text-anchor="middle" fill="#ddd" font-family="sans-serif" font-size="12">${splitter} · ${splitterPorts} puertos disponibles · ${splitterLoss}dB pérdida</text>`;
    svgContent = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="background:#555;border-radius:8px;">${svg}</svg>`;
  } else {
  // Layout
  const marginTop = 40;
  const marginBody = 30;
  const bodyH = h - marginTop - marginBody;
  
  // F1 block (left)
  const f1X = 60;
  const f1W = 110;
  const f1Y = marginTop;
  const f1H = bodyH;
  
  // Splitter (center)
  const spX = 400;
  const spW = 600;
  const spY = marginTop;
  const spH = bodyH;
  
  // F2 block (right)
  const f2X = 1180;
  const f2W = 110;
  const f2Y = marginTop;
  const f2H = bodyH;
  
  // Splitter internal ports
  const spPorts = 16;
  
  // NAP output ports
  const outPortCount = Math.min(splitterPorts, 12);
  const outSpacing = (f2H - 40) / Math.max(outPortCount, 8);
  
  // ===== Pre-compute ALL layout variables before SVG string building =====
  const trapLeftW = 60;
  const trapRightW = spW;
  const trapTop = spY + 10;
  const trapBot = spY + spH - 10;
  const leftInset = (trapRightW - trapLeftW) / 2;
  const inX = spX + leftInset;
  const inY = (trapTop + trapBot) / 2;
  const spDisplayPorts = Math.min(splitterPorts, 16);
  const spPortOutSpacing = (spH - 50) / spDisplayPorts;
  const spPortStartY = spY + 45;
  const firstActive = napFibers.find(f => f.active_power);
  
  let svg = `<rect width="${w}" height="${h}" fill="#f5f5f5" rx="6" />`;
  
  // ===== NAP ENCLOSURE (background) =====
  const napBoxX = 30;
  const napBoxW = w - 60;
  const napBoxY = marginTop - 5;
  const napBoxH = bodyH + 10;
  svg += `<rect x="${napBoxX}" y="${napBoxY}" width="${napBoxW}" height="${napBoxH}" rx="12" fill="none" stroke="#ccc" stroke-width="1.5" stroke-dasharray="8,4" opacity="0.4" />`;
  svg += `<text x="${napBoxX + 12}" y="${napBoxY + 16}" fill="#bbb" font-family="sans-serif" font-size="10">${nap.name}</text>`;
  
  // ===== INPUT CABLE(S) coming from left (traced fibers) =====
  const cableNames = [...new Set(napFibers.map(f => f.cable_name))];
  const inputCableY = spY + spH/2;
  const inputCableStartX = 10;
  const inputCableEndX = spX + leftInset;
  
  // Draw each input cable entering the NAP
  cableNames.forEach((cname, idx) => {
    const cy = inputCableY - 15 + idx * 30;
    // Cable line entering from left
    svg += `<path d="M ${inputCableStartX},${cy} L ${inputCableEndX},${cy}" stroke="#f5a623" stroke-width="3" opacity="0.7" fill="none" />`;
    // Cable label
    svg += `<text x="${inputCableStartX + 5}" y="${cy - 8}" fill="#f5a623" font-family="sans-serif" font-size="9">🔌 ${cname}</text>`;
  });
  if (cableNames.length === 0 && napFibers.length > 0) {
    // Show individual fibers as inputs
    napFibers.slice(0, 3).forEach((f, idx) => {
      const cy = inputCableY - 15 + idx * 25;
      svg += `<path d="M ${inputCableStartX},${cy} L ${inputCableEndX},${cy}" stroke="#f5a623" stroke-width="2" opacity="0.5" fill="none" />`;
      svg += `<text x="${inputCableStartX + 5}" y="${cy - 6}" fill="#f5a623" font-family="sans-serif" font-size="8">Fibra #${f.fiber_number}</text>`;
    });
  }
  
  // Arrow indicating fiber entry
  if (cableNames.length > 0 || napFibers.length > 0) {
    const arrowY = inputCableY;
    svg += `<polygon points="${inputCableEndX - 8},${arrowY - 5} ${inputCableEndX},${arrowY} ${inputCableEndX - 8},${arrowY + 5}" fill="#f5a623" opacity="0.7" />`;
  }
  
  // ===== INPUT CABLE LABEL =====
  svg += `<rect x="${spX - 30}" y="${inY - 10}" width="30" height="20" rx="4" fill="#ddd" stroke="#aaa" stroke-width="1" />`;
  svg += `<text x="${spX - 15}" y="${inY + 4}" text-anchor="middle" fill="#555" font-family="sans-serif" font-size="10" font-weight="bold">IN</text>`;
  
  // ===== SPLITTER (trapezoid style, draggable) =====
  svg += `<g id="vis-block-splitter" class="vis-block" transform="translate(0,0)">`;
  
  // Splitter toolbar
  const spTbY = spY - 30;
  const spTbCX = spX + spW/2;
  svg += `<rect x="${spTbCX - 50}" y="${spTbY}" width="100" height="26" rx="6" fill="#333" stroke="#555" stroke-width="1" opacity="0.9" class="block-toolbar" />`;
  svg += `<g class="block-toolbar" style="cursor:pointer" onclick="changeNapSplitter(${napId})">`;
  svg += `<circle cx="${spTbCX - 22}" cy="${spTbY + 13}" r="9" fill="#555" />`;
  svg += `<text x="${spTbCX - 22}" y="${spTbY + 17}" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="11">⚙</text>`;
  svg += `</g>`;
  svg += `<g class="block-toolbar" style="cursor:pointer" onclick="showDeleteSplitterConfirm(${napId})">`;
  svg += `<circle cx="${spTbCX + 12}" cy="${spTbY + 13}" r="9" fill="#8a1a1a" />`;
  svg += `<text x="${spTbCX + 12}" y="${spTbY + 17}" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="11">🗑</text>`;
  svg += `</g>`;
  svg += `<g class="block-toolbar" style="cursor:pointer" onclick="showAlertDialog('Splitter ${splitter}: ${splitterPorts}p, ${splitterLoss}dB')">`;
  svg += `<circle cx="${spTbCX + 46}" cy="${spTbY + 13}" r="9" fill="#446" />`;
  svg += `<text x="${spTbCX + 46}" y="${spTbY + 17}" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="11">ℹ</text>`;
  svg += `</g>`;
  
  // === TRAPEZOID BODY ===
  svg += `<polygon points="${spX + leftInset},${trapTop} ${spX + trapRightW - leftInset},${trapTop} ${spX + trapRightW - 10},${trapBot} ${spX + 10},${trapBot}" fill="#e8e8e8" stroke="#999" stroke-width="1.5" class="block-header" style="cursor:grab" />`;
  // Inner dotted lines showing 1→N splitting
  for (let i = 0; i < Math.min(spDisplayPorts, 16); i++) {
    const outY = trapBot - 15 - i * ((trapBot - trapTop - 20) / Math.min(spDisplayPorts - 1, 15));
    const outX = spX + 10;
    svg += `<line x1="${inX}" y1="${inY}" x2="${outX}" y2="${outY}" stroke="#ccc" stroke-width="0.8" stroke-dasharray="3,3" opacity="0.6" />`;
  }
  
  // === INPUT LABEL (IN) ===
  svg += `<rect x="${spX - 5}" y="${inY - 10}" width="30" height="20" rx="4" fill="#ddd" stroke="#aaa" stroke-width="1" />`;
  svg += `<text x="${spX + 10}" y="${inY + 4}" text-anchor="middle" fill="#555" font-family="sans-serif" font-size="10" font-weight="bold">IN</text>`;
  
  // === OUTPUT PORTS (numbered 01-N) ===
  for (let i = 0; i < spDisplayPorts; i++) {
    const py = spPortStartY + i * spPortOutSpacing;
    const label = (i+1) < 10 ? '0' + (i+1) : '' + (i+1);
    // Output port circle
    svg += `<circle cx="${spX + spW - 12}" cy="${py}" r="5" fill="#fff" stroke="#888" stroke-width="1" />`;
    svg += `<text x="${spX + spW - 22}" y="${py + 3}" text-anchor="end" fill="#666" font-family="sans-serif" font-size="9">${label}</text>`;
    // Loss badge (per port: splitter loss)
    const perPortLoss = splitterLoss > 0 ? splitterLoss : 0.01;
    svg += `<rect x="${spX + spW - 80}" y="${py - 6}" width="45" height="12" rx="3" fill="#d0e4f5" stroke="#8ab4d8" stroke-width="0.5" />`;
    svg += `<text x="${spX + spW - 58}" y="${py + 3}" text-anchor="middle" fill="#2b579a" font-family="sans-serif" font-size="8">${perPortLoss.toFixed(1)}dB</text>`;
  }
  
  // === TOP LABEL BAR ===
  svg += `<rect x="${spX + 4}" y="${spY}" width="${spW - 8}" height="22" rx="4" fill="#333" />`;
  svg += `<text x="${spX + 12}" y="${spY + 15}" fill="#fff" font-family="sans-serif" font-size="11" font-weight="bold">${splitter}</text>`;
  svg += `<text x="${spX + spW - 12}" y="${spY + 15}" text-anchor="end" fill="#aaa" font-family="sans-serif" font-size="9">${splitterPorts}p · ${splitterLoss}dB</text>`;
  
  svg += `</g>`; // end splitter block
  
  // ===== OUTPUT PORTS SECTION (right side of NAP) =====
  const outBlockX = f2X;
  const outBlockW = f2W;
  const outBlockY = f2Y;
  const outBlockH = f2H;
  
  svg += `<g id="vis-block-output" class="vis-block" transform="translate(0,0)">`;
  // Output block header (NAP output panel)
  svg += `<rect x="${outBlockX}" y="${outBlockY}" width="${outBlockW}" height="${outBlockH}" rx="10" fill="#1a4a8a" stroke="#0d2e5c" stroke-width="2" class="block-header" style="cursor:grab" />`;
  svg += `<rect x="${outBlockX + 3}" y="${outBlockY + 3}" width="3" height="${outBlockH - 6}" rx="1" fill="#2a6aba" opacity="0.5" />`;
  svg += `<text x="${outBlockX + outBlockW/2}" y="${outBlockY + 22}" text-anchor="middle" fill="#7ab4e0" font-family="sans-serif" font-size="13" font-weight="bold">SALIDAS</text>`;
  svg += `<line x1="${outBlockX + 12}" y1="${outBlockY + 32}" x2="${outBlockX + outBlockW - 12}" y2="${outBlockY + 32}" stroke="#2a5a8a" stroke-width="1" />`;
  
  // F2 output ports
  for (let i = 0; i < outPortCount; i++) {
    const py = f2Y + 46 + i * outSpacing;
    const portNum = i + 1;
    const colIdx = i % stdColors.length;
    const col = stdColors[colIdx];
    const port = ports.find(p => p.port_number === portNum);
    const hasClient = port?.client_name;
    
    // Get real fiber color for this port
    const fiberEntry = napFibers.find(f => f.fiber_number === portNum);
    const realFiberColor = fiberEntry?.fiber_color || (port?.fiber_number ? stdColors[(port.fiber_number - 1) % stdColors.length] : col);
    const realFiberColorName = fiberEntry?.fiber_color_name || (port?.fiber_number ? stdColorNames[(port.fiber_number - 1) % stdColorNames.length] : '');
    const isWhiteColor = realFiberColor === '#ffffff' || realFiberColor === '#FFFFFF';
    
    svg += `<circle cx="${f2X + 20}" cy="${py}" r="5" fill="${hasClient ? realFiberColor : '#5a8aba'}" stroke="#fff" stroke-width="1" />`;
    // Color swatch next to port number
    if (hasClient && !isWhiteColor) {
      svg += `<circle cx="${f2X + 38}" cy="${py}" r="3" fill="${realFiberColor}" stroke="#555" stroke-width="0.5" />`;
    }
    svg += `<text x="${f2X + 44}" y="${py + 3}" fill="#8abae8" font-family="sans-serif" font-size="8">${portNum < 10 ? '0'+portNum : portNum}</text>`;
    
    // Connection line from splitter output to F2 port
    const isActive = napFibers.some(f => f.fiber_number === portNum && f.active_power);
    const lineCol = isActive ? '#00ff88' : realFiberColor;
    const alpha = isActive ? 1 : 0.45;
    const lineClass = isActive ? 'class="fl fiber-active"' : '';
    
    // Splitter output port Y
    const spOutY = spPortStartY + i * spPortOutSpacing;
    
    // If splitter has input power, ALL outputs show calculated power
    const hasInputPower = firstActive !== undefined && firstActive !== null;
    const perPortPower = hasInputPower ? ((firstActive?.power_level || 2.5) - splitterLoss) : 0;
    const isPowered = hasInputPower;
    const outLineCol = isPowered ? '#00cc66' : lineCol;
    const outAlpha = isPowered ? 1 : alpha;
    const outClass = isPowered ? 'class="fl fiber-active"' : lineClass;
    const powerColor = perPortPower > -22 ? '#00cc66' : '#e94560';
    const powerStr = isPowered ? (perPortPower.toFixed(1) + 'dBm') : '0.01dB';
    
    if (napFibers.some(f => f.fiber_number === portNum) || isPowered) {
      // Bezier curve: splitter right → F2 left — colored with real fiber color
      const cpOff = (f2X - (spX + spW)) * 0.4;
      svg += `<path ${outClass} d="M ${spX + spW - 20},${spOutY} C ${spX + spW - 20 + cpOff},${spOutY} ${f2X + 20 - cpOff},${py} ${f2X + 20},${py}" stroke="${outLineCol}" stroke-width="${isPowered ? 4 : 2.5}" opacity="${outAlpha}" fill="none" data-fiber="${portNum}" data-active="${isPowered}" />`;
      
      // Power badge
      const midX = (spX + spW - 20 + f2X + 20) / 2;
      svg += `<rect x="${midX - 24}" y="${(spOutY + py) / 2 - 7}" width="48" height="14" rx="4" fill="rgba(255,255,255,0.85)" stroke="${isPowered ? powerColor : '#ddd'}" stroke-width="0.5" />`;
      svg += `<text x="${midX}" y="${(spOutY + py) / 2 + 3}" text-anchor="middle" fill="${isPowered ? powerColor : '#999'}" font-family="sans-serif" font-size="9">${powerStr}</text>`;
    } else {
      // Dashed placeholder line — use port's TIA/EIA color for unconnected lines
      svg += `<line x1="${spX + spW - 20}" y1="${spOutY}" x2="${f2X + 20}" y2="${py}" stroke="${realFiberColor}" stroke-width="1.5" stroke-dasharray="4,4" opacity="0.25" />`;
    }
    
    // Client name with fiber color indicator
    if (port?.client_name) {
      const clientColorLabel = realFiberColorName ? `(${realFiberColorName})` : '';
      svg += `<text x="${f2X + f2W + 8}" y="${py + 3}" fill="#555" font-family="sans-serif" font-size="9">👤 ${port.client_name.substring(0, 14)}</text>`;
      // Fiber color name below client
      if (realFiberColorName) {
        svg += `<text x="${f2X + f2W + 8}" y="${py + 14}" fill="${realFiberColor}" font-family="sans-serif" font-size="7">${realFiberColorName} #${port.fiber_number || portNum}</text>`;
      }
    }
  }
  svg += `</g>`; // end F2 block
  
  // Power flow: input cable → Splitter (YELLOW)
  if (firstActive) {
    const spInputMidY = (spY + spH) / 2;
    const inCableEndX = spX + leftInset;
    const cpOff = (inCableEndX - inputCableStartX) * 0.3;
    // Yellow input fiber from left edge
    svg += `<path d="M ${inputCableStartX + 5},${spInputMidY} C ${inputCableStartX + 5 + cpOff},${spInputMidY} ${inCableEndX - cpOff},${spInputMidY} ${inCableEndX},${spInputMidY}" stroke="#f5a623" stroke-width="3.5" opacity="0.9" fill="none" class="fl fiber-active" data-active="true" />`;
    // Remaining power after splitter loss
    const remainingPower = (firstActive.power_level || 2.5) - splitterLoss;
    const powerColor = remainingPower > -20 ? '#f5a623' : '#e94560';
    // Power badge
    const mx = (inputCableStartX + inCableEndX) / 2 + 20;
    svg += `<g class="power-badge">`;
    svg += `<rect x="${mx - 28}" y="${spInputMidY - 18}" width="56" height="18" rx="9" fill="rgba(255,255,255,0.95)" stroke="${powerColor}" stroke-width="1.5" />`;
    svg += `<text x="${mx}" y="${spInputMidY - 4}" text-anchor="middle" fill="${powerColor}" font-family="sans-serif" font-size="10" font-weight="bold">⚡${remainingPower.toFixed(1)}dBm</text>`;
    svg += `</g>`;
    // Input power label (before splitting)
    const inputPower = firstActive.power_level || 2.5;
    svg += `<rect x="${mx - 28}" y="${spInputMidY + 2}" width="56" height="16" rx="4" fill="rgba(255,255,255,0.8)" stroke="#ddd" stroke-width="0.5" />`;
    svg += `<text x="${mx}" y="${spInputMidY + 13}" text-anchor="middle" fill="#888" font-family="sans-serif" font-size="9">${splitterLoss}dB pérdida</text>`;
  }
  
  svgContent = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="background:#555;border-radius:8px;">${svg}</svg>`;
  } // end else (hasFibers)
  
  state.currentVisualizerType = 'nap';
  state.currentVisualizerId = napId;
  document.getElementById('vis-title').textContent = `📦 ${nap.name}`;
  
  // Init block dragging after SVG is in DOM (only if fibers exist)
  if (hasFibers) { setTimeout(initBlockDrag, 50); setTimeout(restoreBlockPositions, 150); }
  document.getElementById('vis-power-info').innerHTML = powerInfo;
  
  // Build assigned splitters info
  let splittersHtml = '';
  if (napSplitters.length > 0) {
    splittersHtml = napSplitters.map(s => `<span style="font-size:11px;color:#00d4ff;margin-right:8px;">🔀 ${escHtml(s.name)} (${s.splitter_name || 'N/A'} · ${s.splitter_ports || s.ports_count}p)</span>`).join('');
  }
  
  document.getElementById('vis-splitter-info').innerHTML = `
    <strong>Splitter NAP:</strong> ${splitter} · ${splitterPorts}p · ${splitterLoss}dB
    · <strong>Usados:</strong> ${usedPorts.length}/${splitterPorts}
    · <strong>Clientes:</strong> ${ports.filter(p => p.client_name).length}
    <br><span style="font-size:11px;color:#aaa">Splitters globales asignados:</span> ${splittersHtml || '<span style="font-size:11px;color:#888">ninguno</span>'}
    <button class="vis-inline-btn" onclick="addNapSplitter(${napId})">➕ Agregar Splitter Global</button>
    <button class="vis-inline-btn danger" onclick="showDeleteSplitterConfirm(${napId})">✕ Eliminar Splitter NAP</button>
    <button class="vis-inline-btn" style="background:#e94560;color:#fff;font-weight:bold;" onclick="showSetPowerDialogForNap(${napId})">⚡ Set Power</button>
  `;
  document.getElementById('vis-fibers').innerHTML = portsHTML;
  swapSvgRender('vis-svg', svgContent, w, h);
  document.querySelector('#vis-fibers-title').innerHTML = '📦 Puertos <span class="vis-toggle-left" onclick="toggleVisLeft()">◀ Ocultar</span>';
  
  document.getElementById('vis-panel').classList.remove('hidden');
  flyTo(nap.lat, nap.lng);
  
  // ⭐ Actualizar líneas desde el DOM inmediatamente
  setTimeout(function() {
    const newSvgEl = document.querySelector('#vis-svg svg');
    if (newSvgEl && typeof _updateFusionBlockFn === 'function') {
      newSvgEl.querySelectorAll('.vis-block').forEach(function(b) {
        _updateFusionBlockFn(b);
      });
    }
  }, 30);
}

let usedPortsList = [];

function closeVisualizer() {
  stopFiberAnimations();
  // Save block positions for current visualizer before resetting
  saveBlockPositions();
  state.currentVisualizerType = null;
  state.currentVisualizerId = null;
  document.getElementById('vis-panel').classList.add('hidden');
  // Restore left panel
  document.getElementById('vis-left').style.display = '';
  // Reset connection mode
  _connectModeActive = false;
  _connectSource = null;
  removeConnectTempLine();
  const btn = document.getElementById('vis-connect-toggle');
  if (btn) { btn.textContent = '🔗 Conectar'; btn.style.background = ''; }
  // Clear fusion selection
  state.fusionSelection = null;
  _oltRefreshGuard = false;
  const info = document.getElementById('vis-selection-info');
  if (info) info.remove();
}

// Toggle left panel (ports list)
function toggleVisLeft() {
  const left = document.getElementById('vis-left');
  const toggle = document.querySelector('.vis-toggle-left');
  if (left.style.display === 'none') {
    left.style.display = '';
    if (toggle) toggle.textContent = '◀ Ocultar';
    setTimeout(refreshFiberAnimations, 100);
  } else {
    left.style.display = 'none';
    if (toggle) toggle.textContent = '▶ Mostrar';
  }
}

// Change NAP splitter
async function changeNapSplitter(napId) {
  const types = await api('/splitter-types');
  openModal(`
    <h3>🔀 Cambiar Splitter de NAP</h3>
    <label>Selecciona el nuevo splitter</label>
    <select id="f-nap-splitter-change">
      ${types.map(t => `<option value="${t.id}">${t.name} (${t.loss_db}dB pérdida · ${t.ports} puertos)</option>`).join('')}
    </select>
    <p style="font-size:12px;color:#888;margin-top:8px">⚡ Esto cambiará el splitter y regenerará los puertos.</p>
    <div class="btn-group">
      <button class="btn-primary" onclick="saveNapSplitterChange(${napId})">Guardar</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

async function saveNapSplitterChange(napId) {
  const typeId = parseInt(document.getElementById('f-nap-splitter-change').value);
  await api('/naps/' + napId, 'PUT', { splitter_type_id: typeId });
  closeModal();
  openVisualizer(napId);
  showToast('✅ Splitter actualizado');
}

// Delete Manga splitter
// Delete NAP splitter (confirm)
function showDeleteSplitterConfirm(napId) {
  if (confirm('🗑️ ¿Eliminar el splitter de esta NAP? Los puertos se mantendrán pero quedarán sin splitter.')) {
    // Reset splitter to default (1x2)
    api('/naps/' + napId, 'PUT', { splitter_type_id: 1 }).then(() => {
      openVisualizer(napId);
      showToast('🗑️ Splitter eliminado, se asignó splitter por defecto');
    });
  }
}

// Remove fiber from NAP/Manga
async function removeFiberFromNap(napId, portNum) {
  if (!confirm(`¿Desconectar fibra del puerto ${portNum}?`)) return;
  const napDetail = await api('/naps');
  const nap = napDetail.find(n => n.id == napId);
  if (!nap) return;
  const port = nap.ports.find(p => p.port_number == portNum);
  if (port) {
    // Clear the port
    await api('/nap-ports/' + port.id, 'PUT', {
      fiber_number: null,
      client_name: null,
      client_address: null,
      notes: null
    });
    // Also delete any fiber connections to this port
    const fibers = await api('/fibers');
    const fiberConn = fibers.find(f => f.target_id == napId && f.target_port_id == port.id);
    if (fiberConn) {
      await api('/fibers/' + fiberConn.id, 'DELETE');
    }
    openVisualizer(napId);
    showToast('✅ Fibra removida del puerto ' + portNum);
  }
}

async function deleteMangaSplitter(mangaId, splitterId) {
  if (!splitterId) {
    // Sin splitterId específico: mostrar modal para elegir
    const splitters = await api('/mangas/' + mangaId + '/splitters');
    if (splitters.length === 0) {
      showToast('❌ No hay splitters para eliminar');
      return;
    }
    openModal(`
      <h3>🗑️ Eliminar Splitter</h3>
      <label>Selecciona el splitter a eliminar</label>
      <select id="f-splitter-delete">
        ${splitters.map(s => `<option value="${s.id}">${s.name} - ${s.splitter_name} (${s.used_ports || 0} puertos usados)</option>`).join('')}
      </select>
      <p style="font-size:12px;color:#e94560;margin-top:8px">⚠️ Las fibras conectadas a este splitter se mantendrán pero quedarán sin splitter.</p>
      <div class="btn-group">
        <button class="btn-danger" onclick="confirmDeleteMangaSplitter(${mangaId})">🗑️ Eliminar</button>
        <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
      </div>
    `);
  } else {
    // SplitterId específico: verificar splices primero
    var visEl = document.getElementById('vis-fibers');
    
    // Consultar splices asociados a este splitter (por las fibras del splitter)
    // Buscar splices donde fiber_a o fiber_b sean manga_fibers de este splitter
    var allSplices = await api('/splices').catch(function() { return []; });
    if (!Array.isArray(allSplices)) allSplices = [];
    var allMf = await api('/mangas/' + mangaId + '/fibers').catch(function() { return []; });
    if (!Array.isArray(allMf)) allMf = [];
    var splitterFibers = allMf.filter(function(f) { return f.splitter_id == splitterId || (f.source_type === 'nap' && f.source_id == mangaId); });
    var fiberIds = splitterFibers.map(function(f) { return f.id; });
    var connectedSplices = allSplices.filter(function(s) { 
      return (s.fiber_a_type === 'manga_fiber' && fiberIds.indexOf(s.fiber_a_id) >= 0) ||
             (s.fiber_b_type === 'manga_fiber' && fiberIds.indexOf(s.fiber_b_id) >= 0);
    });
    var numSplices = connectedSplices.length;
    
    if (numSplices > 0) {
      // Mostrar advertencia en el espacio de trabajo
      var warningDiv = document.createElement('div');
      warningDiv.id = 'splitter-warning';
      warningDiv.style.cssText = 'padding:12px 16px;background:#3a1a1a;border:1px solid #e94560;border-radius:8px;margin:8px 0;font-size:13px;color:#e0e0e0;';
      warningDiv.innerHTML = '<strong style="color:#e94560">⚠️ No se puede eliminar el splitter</strong><br>' +
        '<span style="color:#aaa;font-size:12px">Este splitter tiene <strong style="color:#ff6b6b">' + numSplices + ' empalme(s)</strong> conectado(s).</span><br>' +
        '<span style="color:#888;font-size:11px">✂️ Elimina primero las fusiones desde el icono tijera en cada línea de empalme.</span>';
      
      var container = document.getElementById('vis-fibers');
      if (container) {
        container.insertBefore(warningDiv, container.firstChild);
      }
      showToast('⚠️ Elimina los ' + numSplices + ' empalme(s) antes de borrar el splitter');
    } else {
      // Sin splices: eliminar directamente
      if (confirm('🗑️ ¿Eliminar este splitter?')) {
        await api('/manga-splitters/' + splitterId, 'DELETE');
        var _refreshType = (state.currentVisualizerType || 'manga');
        if (_refreshType === 'nap') {
          openVisualizer(mangaId);
        } else {
          openMangaVisualizer(mangaId);
        }
        showToast('🗑️ Splitter eliminado');
      }
    }
  }
}

async function confirmDeleteMangaSplitter(mangaId) {
  const splitterId = parseInt(document.getElementById('f-splitter-delete').value);
  await api('/manga-splitters/' + splitterId, 'DELETE');
  closeModal();
  openMangaVisualizer(mangaId);
  showToast('🗑️ Splitter eliminado');
}

async function editNapPort(napId, portNumber) {
  const data = await api('/naps');
  const nap = data.find(n => n.id == napId);
  if (!nap) return;
  const port = nap.ports.find(p => p.port_number == portNumber);
  
  const cablesData = await api('/cables');
  
  openModal(`
    <h3>🔧 Puerto ${portNumber} - ${nap.name}</h3>
    <label>Número de fibra</label>
    <input id="f-port-fiber" type="number" value="${port?.fiber_number || ''}" placeholder="Ej: 1" />
    <label>Cliente</label>
    <input id="f-port-client" value="${port?.client_name || ''}" placeholder="Nombre del cliente" />
    <label>Dirección</label>
    <input id="f-port-addr" value="${port?.client_address || ''}" />
    <label>Notas</label>
    <textarea id="f-port-notes" rows="2">${port?.notes || ''}</textarea>
    <hr style="border-color:#533483;margin:15px 0" />
    <h4 style="color:#00d4ff;margin-bottom:10px">Conectar a cable/fibra</h4>
    <label>Cable</label>
    <select id="f-connect-cable">
      <option value="">Sin conexión</option>
      ${cablesData.map(c => `<option value="${c.id}">${c.name} (${c.fiber_count} fibras)</option>`).join('')}
    </select>
    <label>Número de fibra del cable</label>
    <input id="f-connect-fiber" type="number" value="${port?.fiber_number || ''}" min="1" />
    <label>¿Activar potencia?</label>
    <select id="f-connect-power">
      <option value="0">No</option><option value="1">Sí</option>
    </select>
    <label>Potencia (dBm)</label>
    <input id="f-connect-dbm" type="number" step="0.1" value="2.5" />
    <div class="btn-group">
      <button class="btn-primary" onclick="saveNapPort(${napId}, ${port?.id || 0}, ${portNumber})">Guardar</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

async function saveNapPort(napId, portId, portNumber) {
  if (portId) {
    await api('/nap-ports/' + portId, 'PUT', {
      fiber_number: parseInt(document.getElementById('f-port-fiber').value) || null,
      client_name: document.getElementById('f-port-client').value || null,
      client_address: document.getElementById('f-port-addr').value || null,
      notes: document.getElementById('f-port-notes').value || null
    });
  }
  
  const cableId = document.getElementById('f-connect-cable').value;
  if (cableId) {
    const fiberNum = parseInt(document.getElementById('f-connect-fiber').value);
    const activatePower = document.getElementById('f-connect-power').value === '1';
    const powerDB = parseFloat(document.getElementById('f-connect-dbm').value) || 2.5;
    
    const existingFibers = await api('/fibers');
    const existing = existingFibers.find(f => f.target_id == napId && f.target_port_id == portId);
    
    if (existing) {
      await api('/fibers/' + existing.id + '/activate', 'PUT', { active_power: activatePower, power_level: powerDB, total_loss: 0 });
    } else {
      await api('/fibers', 'POST', {
        cable_id: parseInt(cableId),
        fiber_number: fiberNum,
        source_type: 'olt', source_id: 1,
        target_type: 'nap', target_id: napId,
        target_port_id: portId,
        source_olt_port_id: 1,
        power_level: powerDB
      });
    }
    
    const calcRes = await fetch(API + '/fibers?napId=' + napId);
    const updatedFibers = await calcRes.json();
    const fiber = Array.isArray(updatedFibers) ? updatedFibers.find(f => f.target_id == napId && f.fiber_number == fiberNum) : null;
    if (fiber) {
      const calc = await api('/calculate-power/' + fiber.id);
      await api('/fibers/' + fiber.id + '/activate', 'PUT', {
        active_power: activatePower,
        power_level: powerDB,
        total_loss: calc.total_loss
      });
    }
  }
  
  closeModal();
  openVisualizer(napId);
}

function flyTo(lat, lng) {
  map.flyTo([lat, lng], 17, { duration: 1 });
}

// ========== MAP CONTEXT MENU (right click on map) ==========
let ctxLat = null, ctxLng = null;

map.on('contextmenu', (e) => {
  const event = e.originalEvent;
  ctxLat = e.latlng.lat;
  ctxLng = e.latlng.lng;
  
  const menu = document.getElementById('context-menu');
  if (!menu) return;
  let x = event.clientX;
  let y = event.clientY;
  
  const menuW = 220;
  const menuH = 200;
  if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 10;
  if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 10;
  if (x < 10) x = 10;
  if (y < 10) y = 10;
  
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.remove('hidden');
});

map.on('click', () => {
  var cm = document.getElementById('context-menu');
  if (cm) cm.classList.add('hidden');
});

function ctxAddOLT() {
  var _cm = document.getElementById('context-menu'); if (_cm) _cm.classList.add('hidden');
  const activeFolder = state.activeFolderId ? state.folders.find(f => f.id == state.activeFolderId) : null;
  openModal(`
    <h3>⚡ Agregar OLT</h3>
    ${activeFolder ? `<p style="font-size:12px;color:#4CAF50;margin-bottom:8px">📂 Carpeta: <strong>${escHtml(activeFolder.name)}</strong></p>` : ''}
    <label>Nombre</label><input id="f-olt-name" value="OLT-${state.olts.length + 1}" />
    <label>Marca</label><input id="f-olt-brand" placeholder="Ej: Huawei" />
    <label>Modelo</label><input id="f-olt-model" placeholder="Ej: MA5800" />
    <label>Puertos</label><input id="f-olt-ports" type="number" value="16" />
    <label>Potencia de salida (dBm)</label><input id="f-olt-power" type="number" step="0.1" value="2.5" />
    <label>Descripción</label><textarea id="f-olt-desc" rows="2"></textarea>
    <p style="margin-top:10px;font-size:12px;color:#888;">📍 Ubicación seleccionada en el mapa</p>
    <div class="btn-group">
      <button class="btn-primary" onclick="ctxSaveOLT()">Guardar</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

async function ctxSaveOLT() {
  const result = await api('/olts', 'POST', {
    name: document.getElementById('f-olt-name').value,
    lat: ctxLat, lng: ctxLng,
    brand: document.getElementById('f-olt-brand').value,
    model: document.getElementById('f-olt-model').value,
    ports_count: parseInt(document.getElementById('f-olt-ports').value),
    power: parseFloat(document.getElementById('f-olt-power').value),
    description: document.getElementById('f-olt-desc').value
  });
  closeModal();
  askAddToFolder('olt', result.id);
}

function ctxAddNAP() {
  var _cm = document.getElementById('context-menu'); if (_cm) _cm.classList.add('hidden');
  const activeFolder = state.activeFolderId ? state.folders.find(f => f.id == state.activeFolderId) : null;
  fetch(API + '/splitter-types').then(r => r.json()).then(types => {
    openModal(`
      <h3>📦 Agregar NAP</h3>
      ${activeFolder ? `<p style="font-size:12px;color:#4CAF50;margin-bottom:8px">📂 Carpeta: <strong>${escHtml(activeFolder.name)}</strong></p>` : ''}
      <label>Nombre</label><input id="f-nap-name" value="NAP-${state.naps.length + 1}" />
      <label>Splitter</label>
      <select id="f-nap-splitter">
        ${types.map(t => `<option value="${t.id}">${t.name} (${t.loss_db}dB pérdida)</option>`).join('')}
      </select>
      <label>Capacidad (puertos)</label><input id="f-nap-ports" type="number" value="8" />
      <label>Dirección</label><input id="f-nap-address" placeholder="Calle, número, sector" />
      <label>Descripción</label><textarea id="f-nap-desc" rows="2"></textarea>
      <p style="margin-top:10px;font-size:12px;color:#888;">📍 Ubicación seleccionada en el mapa</p>
      <div class="btn-group">
        <button class="btn-primary" onclick="ctxSaveNAP()">Guardar</button>
        <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
      </div>
    `);
  });
}

async function ctxSaveNAP() {
  const result = await api('/naps', 'POST', {
    name: document.getElementById('f-nap-name').value,
    lat: ctxLat, lng: ctxLng,
    splitter_type_id: parseInt(document.getElementById('f-nap-splitter').value),
    port_capacity: parseInt(document.getElementById('f-nap-ports').value),
    address: document.getElementById('f-nap-address').value,
    description: document.getElementById('f-nap-desc').value
  });
  closeModal();
  askAddToFolder('nap', result.id);
}

function ctxAddManga() {
  var _cm = document.getElementById('context-menu'); if (_cm) _cm.classList.add('hidden');
  const activeFolder = state.activeFolderId ? state.folders.find(f => f.id == state.activeFolderId) : null;
  openModal(`
    <h3>🧶 Agregar Manga</h3>
    ${activeFolder ? `<p style="font-size:12px;color:#4CAF50;margin-bottom:8px">📂 Carpeta: <strong>${escHtml(activeFolder.name)}</strong></p>` : ''}
    <label>Nombre</label><input id="f-manga-name" value="Manga-${state.mangas.length + 1}" />
    <label>Descripción</label><textarea id="f-manga-desc" rows="2"></textarea>
    <p style="margin-top:10px;font-size:12px;color:#888;">📍 Ubicación seleccionada en el mapa</p>
    <div class="btn-group">
      <button class="btn-primary" onclick="ctxSaveManga()">Guardar</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

async function ctxSaveManga() {
  const result = await api('/mangas', 'POST', {
    name: document.getElementById('f-manga-name').value,
    lat: ctxLat, lng: ctxLng,
    description: document.getElementById('f-manga-desc').value
  });
  closeModal();
  askAddToFolder('manga', result.id);
}

function ctxStartCable(startLat, startLng) {
  var _cm = document.getElementById('context-menu'); if (_cm) _cm.classList.add('hidden');
  // Si se llama sin coordenadas (desde toolbar), esperar clic en el mapa
  if (startLat != null && startLng != null) {
    showCableCreator(startLat, startLng);
  } else if (typeof ctxLat !== 'undefined' && ctxLat != null) {
    // Desde el menu contextual (tiene ctxLat/ctxLng del right-click)
    showCableCreator(ctxLat, ctxLng);
  } else {
    // Desde toolbar: esperar primer clic en el mapa
    showCableCreator(null, null);
  }
}

function findNearElement(lat, lng, threshold = 0.00004) {
  for (const n of state.naps) {
    const dist = Math.sqrt(Math.pow(n.lat - lat, 2) + Math.pow(n.lng - lng, 2));
    if (dist < threshold) return { type: 'nap', id: n.id, name: n.name, el: n };
  }
  for (const m of state.mangas) {
    const dist = Math.sqrt(Math.pow(m.lat - lat, 2) + Math.pow(m.lng - lng, 2));
    if (dist < threshold) return { type: 'manga', id: m.id, name: m.name, el: m };
  }
  for (const o of state.olts) {
    const dist = Math.sqrt(Math.pow(o.lat - lat, 2) + Math.pow(o.lng - lng, 2));
    if (dist < threshold) return { type: 'olt', id: o.id, name: o.name, el: o };
  }
  return null;
}

function addCablePoint(lat, lng, elementType, elementId, conectado = false) {
  var idx = state.cableDrawingPoints.length;
  state.cableDrawingPoints.push({ 
    lat, lng, 
    element_type: elementType, 
    element_id: elementId,
    conectado
  });
  console.log('[CABLE] addCablePoint #' + idx + ' (' + lat.toFixed(6) + ',' + lng.toFixed(6) + ') type=' + (elementType||'-') + ' id=' + (elementId||'-') + ' conectado=' + conectado + ' total=' + state.cableDrawingPoints.length);
  
  const pts = state.cableDrawingPoints.map(p => [p.lat, p.lng]);
  if (state.cableTempLine) map.removeLayer(state.cableTempLine);
  state.cableTempLine = L.polyline(pts, { color: '#00ff88', weight: 3, dashArray: '5,5' }).addTo(map);
  console.log('[CABLE] Line updated: ' + pts.length + ' points');
  
  const pm = L.circleMarker([lat, lng], {
    radius: elementType ? 10 : 6, 
    color: elementType ? '#ffaa00' : '#00d4ff', 
    fillColor: elementType ? '#ffaa00' : '#00d4ff', 
    fillOpacity: 0.7,
    draggable: true
  }).addTo(map);
  
  // Disable map drag while dragging marker
  pm.on('dragstart', function() { map.dragging.disable(); });
  pm.on('dragend', function() { map.dragging.enable(); });
  
  // Store point index on marker for drag update
  pm._cablePointIdx = idx;
  
  pm.on('drag', function() {
    var pos = pm.getLatLng();
    state.cableDrawingPoints[idx].lat = pos.lat;
    state.cableDrawingPoints[idx].lng = pos.lng;
    var allPts = state.cableDrawingPoints.map(function(p) { return [p.lat, p.lng]; });
    state.cableTempLine.setLatLngs(allPts);
  });
  
  pm.on('dragend', function() {
    updateCableStatus();
  });
  
  state.tempMarkers.push(pm);
  
  updateCableStatus();
}

function restoreNapPopups() {
  if (state._savedPopups) {
    state._savedPopups.forEach(({marker, popup}) => {
      if (popup) marker.bindPopup(popup);
    });
    state._savedPopups = null;
  }
  // Remove cable trace click handlers and restore popup behavior
  if (state._savedClickHandlers) {
    state._savedClickHandlers.forEach(({marker, handler}) => {
      marker.off('click', handler);
    });
    state._savedClickHandlers = null;
  }
}

function finishCableDrawing() {
  state.mapClickHandler = null;
  restoreNapPopups();
  
  if (state.cableDrawingPoints.length < 2) {
    showAlertDialog('Necesitas al menos 2 puntos para crear el cable');
    return;
  }
  
  // Clean up temp visuals
  if (state.cableTempLine) { map.removeLayer(state.cableTempLine); state.cableTempLine = null; }
  state.tempMarkers.forEach(m => map.removeLayer(m));
  state.tempMarkers = [];
  
  const cableDistM = Math.round(calculateRouteDistance(state.cableDrawingPoints));
  document.getElementById('cable-status-text').textContent = 
    `📏 ${(cableDistM/1000).toFixed(2)} km (${cableDistM} m) · Guardando...`;
  
  // Save from panel
  ctxSaveCableFromPanel();
}

function cancelCableCreation() {
  state.mapClickHandler = null;
  restoreNapPopups();
  // Restaurar lineas de cables ocultas durante edicion
  state.cablePolylines.forEach(function(pl) {
    if (!map.hasLayer(pl)) pl.addTo(map);
  });
  if (state.cableTempLine) { map.removeLayer(state.cableTempLine); state.cableTempLine = null; }
  state.tempMarkers.forEach(m => map.removeLayer(m));
  state.tempMarkers = [];
  state.cableDrawingPoints = [];
  var cp = document.getElementById('cable-panel');
  if (cp) cp.classList.add('hidden');
  var cm = document.getElementById('context-menu');
  if (cm) cm.classList.add('hidden');
  showToast('❌ Cable cancelado');
}

function updateCableStatus() {
  const pts = state.cableDrawingPoints.length;
  if (pts === 0) {
    document.getElementById('cable-status-text').textContent = '💡 Clic en el mapa para empezar';
    return;
  }
  const distM = calculateRouteDistance(state.cableDrawingPoints);
  document.getElementById('cable-status-text').textContent = 
    `📍 ${pts} puntos · 📏 ${(distM/1000).toFixed(3)} km (${Math.round(distM)} m)`;
  document.getElementById('cable-btn-finish').disabled = pts < 2;
}

// Calculate Haversine distance between route points
function calculateRouteDistance(points) {
  const R = 6371000; // Earth radius in meters
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dLat = (points[i].lat - points[i-1].lat) * Math.PI / 180;
    const dLng = (points[i].lng - points[i-1].lng) * Math.PI / 180;
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) + 
              Math.cos(points[i-1].lat*Math.PI/180)*Math.cos(points[i].lat*Math.PI/180)*
              Math.sin(dLng/2)*Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    total += R * c;
  }
  return total;
}

async function ctxSaveCableFromPanel() {
  const cableDistM = Math.round(calculateRouteDistance(state.cableDrawingPoints));
  var cableTypeId = parseInt(document.getElementById('cable-type-id').value) || null;
  
  var cableId;
  if (_editingCableId) {
    // UPDATE existing cable
    cableId = _editingCableId;
    await fetch(API + '/cables/' + cableId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('cable-name').value,
        color: document.getElementById('cable-color').value
      })
    });
    _editingCableId = null;
  } else {
    // CREATE new cable
    const result = await api('/cables', 'POST', {
      name: document.getElementById('cable-name').value,
      fiber_count: parseInt(document.getElementById('cable-fibers').value),
      tube_count: parseInt(document.getElementById('cable-tubes').value),
      cable_type: document.getElementById('cable-type').value,
      attenuation_db_per_km: parseFloat(document.getElementById('cable-atten').value),
      color: document.getElementById('cable-color').value,
      length_m: cableDistM,
      cable_type_id: cableTypeId
    });
    cableId = result.id;
    
    // Auto-initialize individual fibers with TIA/EIA-598 colors
    try {
      await api('/cables/' + cableId + '/fibers/init', 'POST', {});
    } catch(e) {
      console.warn('Fiber init skipped:', e);
    }
  }
  
  var totalPts = state.cableDrawingPoints.length;
  var pointsForSave = [];
  state.cableDrawingPoints.forEach(function(p, idx) {
    var esPrimero = idx === 0;
    var esUltimo = idx === totalPts - 1;
    if (p.element_type && p.element_id) {
      if (esPrimero || esUltimo) {
        // Extremo del cable: un SOLO punto (terminacion)
        pointsForSave.push({ lat: p.lat, lng: p.lng, element_type: p.element_type, element_id: p.element_id });
      } else {
        // Medio del cable: DOS puntos (IN y OUT) para pass-through
        pointsForSave.push({ lat: p.lat, lng: p.lng, element_type: p.element_type, element_id: p.element_id });
        pointsForSave.push({ lat: p.lat, lng: p.lng, element_type: p.element_type, element_id: p.element_id });
      }
    } else {
      // Punto de ruteo normal: un solo punto
      pointsForSave.push({ lat: p.lat, lng: p.lng, element_type: null, element_id: null });
    }
  });
  
  await api('/cables/' + cableId + '/points', 'POST', { points: pointsForSave });
  
  const fiberCount = parseInt(document.getElementById('cable-fibers').value) || 0;
  const cableName = document.getElementById('cable-name').value || 'Cable';
  
  // Show success toast with fiber count and a link to view fibers
  showSuccessToast(cableId, cableName, fiberCount);
  
  // Collect connected elements, preserving cable-point order
  const sortedDrawingPoints = [...state.cableDrawingPoints].filter(p => p.element_type).reduce((acc, p) => {
    if (!acc.some(x => x.element_type === p.element_type && x.element_id === p.element_id)) acc.push(p);
    return acc;
  }, []);
  
  // First pass: create fiber_connections for NAPs and mangas
  // NAPs take the first available fiber numbers, the final manga gets all remaining fibers
  let fiberNum = 1;
  let lastMangaEl = null;
  
  for (const el of sortedDrawingPoints) {
    if (el.element_type === 'nap') {
      const existingFibers = await api('/fibers');
      const exists = existingFibers.some(f => 
        f.cable_id == cableId && f.target_type === 'nap' && f.target_id == el.element_id
      );
      if (!exists && fiberNum <= fiberCount) {
        await api('/fibers', 'POST', {
          cable_id: cableId,
          fiber_number: fiberNum,
          source_type: 'cable',
          source_id: cableId,
          target_type: 'nap',
          target_id: el.element_id,
          target_port_id: fiberNum
        });
        
        const newFiber = (await api('/fibers')).find(f => 
          f.cable_id == cableId && f.fiber_number == fiberNum && f.target_type === 'nap'
        );
        if (newFiber) {
          await api('/fibers/' + newFiber.id + '/activate', 'PUT', {
            active_power: true,
            power_level: 2.5,
            total_loss: cableDistM * 0.35 / 1000
          });
        }
        fiberNum++;
      }
    } else if (el.element_type === 'manga') {
      lastMangaEl = el;
    }
  }
  
  // Second pass: connect all remaining fibers to the final manga
  if (lastMangaEl) {
    const existingMangaFCs = await api('/fibers');
    for (let fn = fiberNum; fn <= fiberCount; fn++) {
      const exists = existingMangaFCs.some(f => 
        f.cable_id == cableId && f.fiber_number == fn && f.target_type === 'manga' && f.target_id == lastMangaEl.element_id
      );
      if (!exists) {
        await api('/fibers', 'POST', {
          cable_id: cableId,
          fiber_number: fn,
          source_type: 'cable',
          source_id: cableId,
          target_type: 'manga',
          target_id: lastMangaEl.element_id,
          target_port_id: fn
        });
      }
    }
  }
  
  // ====== AUTO-CREATE FUSIONS for pass-through elements ======
  // Detect which elements the cable passes through and auto-fuse all fibers
  try {
    const cablePoints2 = await api('/cable-points?cable_id=' + cableId);
    if (cablePoints2 && cablePoints2.length >= 2) {
      const elementCounts = {};
      cablePoints2.forEach(p => {
        if (p.element_type && p.element_id) {
          const key = p.element_type + ':' + p.element_id;
          elementCounts[key] = (elementCounts[key] || 0) + 1;
        }
      });
      
      // For each element with 1 cable point — check if it's pass-through
      // An element is pass-through if there are points both BEFORE and AFTER it
      const sortedPoints = cablePoints2.sort((a, b) => a.sequence - b.sequence);
      for (let i = 0; i < sortedPoints.length; i++) {
        const p = sortedPoints[i];
        if (!p.element_type || !p.element_id) continue;
        const hasBefore = i > 0;
        const hasAfter = i < sortedPoints.length - 1;
        const isPassThrough = hasBefore && hasAfter;
        
        if (isPassThrough) {
          // Determine OUT point — same element if multiple points, or itself
          const sameElemPoints = sortedPoints.filter(x => x.element_type === p.element_type && x.element_id === p.element_id);
          const otherP = sameElemPoints.find(x => x.id !== p.id) || p;
          
          // Si hay multiples puntos para este elemento, solo procesar el primero (IN)
          if (sameElemPoints.length >= 2 && p.id !== sameElemPoints[0].id) continue;
          // Crear fusiones para NAPs y mangas pass-through
          if (p.element_type === 'manga' || p.element_type === 'nap') {
            // Fetch existing fusions to avoid 409 conflicts
            var existingFusions2 = [];
            try { existingFusions2 = await fetch(API + '/mangas/' + p.element_id + '/fusions').then(function(r) { return r.json(); }); } catch(e) {}
            var usedFibers2 = new Set();
            existingFusions2.forEach(function(f) {
              if (parseInt(f.cable_connection_id_in) === p.id) usedFibers2.add(parseInt(f.fiber_in));
              if (parseInt(f.cable_connection_id_out) === otherP.id) usedFibers2.add(parseInt(f.fiber_out));
            });
            
            // Create fusions only for fibers that don't have one yet
            for (let fn = 1; fn <= fiberCount; fn++) {
              if (usedFibers2.has(fn)) continue; // skip already-fused fibers
              try {
                await fetch(API + '/fusions', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    manga_id: p.element_type === 'manga' ? p.element_id : null,
                    name: 'Auto paso: Fibra #' + fn,
                    cable_connection_id_in: p.id,
                    fiber_in: fn,
                    cable_connection_id_out: otherP.id,
                    fiber_out: fn,
                    connection_type: 1,
                    loss_db: 0.05
                  })
                });
              } catch(e) {
                // Si ya existe (409), ignorar — la fusion ya estaba creada
              }
            }
          }
        }
      }
    }
  } catch(e) {
    console.warn('Auto-fusion on save error:', e);
  }
  
  state.cableDrawingPoints = [];
  state.pendingFiberConnections = [];
  
  // Hide the floating panel
  document.getElementById('cable-panel').classList.add('hidden');
  
  // Auto-add to active folder
  askAddToFolder('cable', cableId);
}

// ========== CONNECTION MODE (SVG interactive) ==========
let _connectModeActive = false;
let _connectSource = null; // { type: 'nap'|'manga', id, fiber_num, element, x, y }
let _connectTempLine = null;

function toggleConnectMode() {
  _connectModeActive = !_connectModeActive;
  const btn = document.getElementById('vis-connect-toggle');
  if (_connectModeActive) {
    btn.textContent = '🔗 Cancelar';
    btn.style.background = '#00cc66';
    _connectSource = null;
    showToast('🔗 Modo conexión: clic en un puerto de fibra, luego en otro para conectar');
  } else {
    btn.textContent = '🔗 Conectar';
    btn.style.background = '';
    _connectSource = null;
    removeConnectTempLine();
  }
}

function removeConnectTempLine() {
  if (_connectTempLine) {
    try { _connectTempLine.remove(); } catch(e) {}
    _connectTempLine = null;
  }
}

// Called when SVG port is clicked
function connectPortClick(sourceType, sourceId, fiberNum, isLeft, x, y) {
  if (!_connectModeActive) return;
  
  if (!_connectSource) {
    // First click — select source
    _connectSource = { type: sourceType, id: sourceId, fiber_num: fiberNum, isLeft, x, y };
    showToast(`🔗 Origen: ${sourceType} Fibra #${fiberNum} — clic en el destino`);
    return;
  }
  
  // Second click — create connection
  const source = _connectSource;
  if (source.x === x && source.y === y) {
    showToast('❌ Mismo puerto — selecciona otro destino');
    _connectSource = null;
    return;
  }
  
  // Draw temporary connection line
  removeConnectTempLine();
  const svg = document.querySelector('#vis-svg svg');
  if (svg) {
    const ns = 'http://www.w3.org/2000/svg';
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', source.x);
    line.setAttribute('y1', source.y);
    line.setAttribute('x2', x);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', '#e94560');
    line.setAttribute('stroke-width', '3');
    line.setAttribute('stroke-dasharray', '8,4');
    line.style.opacity = '0.7';
    svg.appendChild(line);
    _connectTempLine = line;
  }
  
  showToast(`✅ Conexión trazada: Fibra #${source.fiber_num} → Fibra #${fiberNum}`);
  _connectSource = null;
  
  // Auto exit connect mode after 2s
  setTimeout(() => {
    if (_connectModeActive) toggleConnectMode();
  }, 2000);
}

// ========== TOAST ==========
function showToast(msg, duration = 3000) {
  const existing = document.querySelector('.toast-msg');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = 'toast-msg';
  toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#16213e;color:#fff;padding:10px 20px;border-radius:6px;border:1px solid #533483;z-index:9999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.5);transition:opacity 0.3s;';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, duration);
}

function showSuccessToast(cableId, cableName, fiberCount) {
  const existing = document.querySelector('.toast-msg');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = 'toast-msg';
  toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#16213e;color:#fff;padding:12px 24px;border-radius:8px;border:1px solid #00cc66;z-index:9999;font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,0.6);transition:opacity 0.3s;min-width:280px;text-align:center;';
  toast.innerHTML = '✅ <b>' + escHtml(cableName) + '</b> creado con <b>' + fiberCount + '</b> fibras<br>' +
    '<span style="font-size:12px;color:#00d4ff;cursor:pointer;text-decoration:underline" onclick="this.closest(\'.toast-msg\').remove();showFiberStatus(' + cableId + ')">🔍 Ver fibras</span>';
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 6000);
}

// ========== MAP CLICK HANDLER ==========
map.on('click', (e) => {
  if (state.mapClickHandler) {
    state.mapClickHandler(e.latlng.lat, e.latlng.lng);
  }
});

// ========== SIDEBAR TOGGLE ==========
document.getElementById('toggle-sidebar').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('hidden');
});


// ========== ADD MANGA FUSION ==========
async function addMangaFusion(mangaId, cableConnectionInId, fiberIn, cableConnectionOutId, fiberOut, lossDb, esNap) {
  const payload = {
    manga_id: mangaId,
    cable_connection_id_in: parseInt(cableConnectionInId),
    fiber_in: parseInt(fiberIn),
    cable_connection_id_out: parseInt(cableConnectionOutId),
    fiber_out: parseInt(fiberOut),
    loss_db: parseFloat(lossDb || 0.01)
  };
  const result = await api('/fusions', 'POST', payload);
  return result;
}

async function deleteMangaFusion(fusionId) {
  return await api('/fusions/' + fusionId, 'DELETE');
}

// ========== FUSION DIALOG ==========
async function openFusionDialog(mangaId) {
  // Fetch cable points for this manga
  const cablePoints = await fetch(API + '/cable-points?element_type=manga&element_id=' + mangaId).then(r => r.json());
  
  // Get cable details
  const cableDetails = [];
  for (const cp of cablePoints) {
    const cable = state.cables.find(c => c.id == cp.cable_id);
    if (!cable) continue;
    const fibers = await fetch(API + '/cables/' + cp.cable_id + '/fibers').then(r => r.json());
    cableDetails.push({
      cableConnectionId: cp.id,
      cableId: cp.cable_id,
      cableName: cable.name,
      fibers: fibers
    });
  }
  
  if (cableDetails.length < 2) {
    showToast('❌ Se necesitan al menos 2 cables conectados a la manga para crear un empalme');
    return;
  }
  
  // Build options for cable selection
  function cableOptionHTML(cd) {
    return cd.fibers.map(f => 
      `<option value="${cd.cableConnectionId}:${f.fiber_number}">${cd.cableName} - Fibra #${f.fiber_number} (${tiaColorName(f.fiber_number)})</option>`
    ).join('');
  }
  
  let selectInHTML = '';
  let selectOutHTML = '';
  for (const cd of cableDetails) {
    selectInHTML += `<optgroup label="${cd.cableName}">${cableOptionHTML(cd)}</optgroup>`;
    selectOutHTML += `<optgroup label="${cd.cableName}">${cableOptionHTML(cd)}</optgroup>`;
  }
  
  openModal(`
    <h3>➕ Empalme en Manga</h3>
    <p style="color:#aaa;font-size:12px;margin-bottom:12px;">Conecta una fibra de ENTRADA a una fibra de SALIDA</p>
    <label>Fibra de Entrada (IN)</label>
    <select id="f-fusion-in">${selectInHTML}</select>
    <label>Fibra de Salida (OUT)</label>
    <select id="f-fusion-out">${selectOutHTML}</select>
    <label>Pérdida (dB)</label>
    <input id="f-fusion-loss" type="number" step="0.01" value="0.01" min="0" max="10" />
    <div class="btn-group" style="margin-top:16px;">
      <button class="btn-primary" onclick="saveMangaFusion(${mangaId})">💾 Guardar Empalme</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

async function saveMangaFusion(mangaId) {
  const inVal = document.getElementById('f-fusion-in').value;
  const outVal = document.getElementById('f-fusion-out').value;
  const loss = document.getElementById('f-fusion-loss').value;
  
  if (!inVal || !outVal) {
    showToast('❌ Selecciona ambas fibras');
    return;
  }
  
  const [connIn, fibIn] = inVal.split(':');
  const [connOut, fibOut] = outVal.split(':');
  
  try {
    const result = await addMangaFusion(mangaId, connIn, fibIn, connOut, fibOut, loss, isNap);
    closeModal();
    showToast('✅ Empalme creado correctamente');
    renderTree();
    // Refresh completo del visualizador
    setTimeout(function() { openMangaVisualizer(mangaId, isNap ? 'nap' : undefined); }, 50);
  } catch(e) {
    showToast('❌ Error al crear empalme: ' + e.message);
  }
}

// ========== MANGA VISUALIZER ==========
// Persist block drag positions per visualizer session
const _blockPositions = {}; // in-memory cache keyed by 'type:id'
const BLOCK_POSITIONS_KEY = 'ftth_block_positions';

function loadBlockPositionsFromStorage() {
  try {
    const stored = localStorage.getItem(BLOCK_POSITIONS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      Object.keys(parsed).forEach(k => { _blockPositions[k] = parsed[k]; });
    }
  } catch(e) { /* localStorage not available */ }
}

let _saveLayoutTimeout = null;

function saveBlockPositions() {
  const visId = state.currentVisualizerId;
  const visType = state.currentVisualizerType;
  if (!visId || !visType) return;
  const svgEl = document.querySelector('#vis-svg svg');
  if (!svgEl) return;
  const key = visType + ':' + visId;
  _blockPositions[key] = {};
  const blocks = [];
  svgEl.querySelectorAll('.vis-block').forEach(b => {
    const idx = b.getAttribute('data-block-idx');
    if (!idx) return;
    const transform = b.getAttribute('transform') || 'translate(0,0)';
    const flipped = b.getAttribute('data-flipped') === 'true';
    _blockPositions[key][idx] = { transform, flipped };
    blocks.push({ block_idx: idx, transform, flipped });
  });
  // Save to localStorage (immediate, local cache)
  try {
    localStorage.setItem(BLOCK_POSITIONS_KEY, JSON.stringify(_blockPositions));
  } catch(e) {}
  
  // Auto-save to server (debounced) — only for manga view
  if (visType === 'manga' && blocks.length > 0) {
    if (_saveLayoutTimeout) clearTimeout(_saveLayoutTimeout);
    _saveLayoutTimeout = setTimeout(() => {
      fetch(API + '/mangas/' + visId + '/block-layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks })
      }).catch(err => console.warn('[Layout] Server save failed:', err));
      _saveLayoutTimeout = null;
    }, 800);
  }
}

async function restoreBlockPositions() {
  const visId = state.currentVisualizerId;
  const visType = state.currentVisualizerType;
  if (!visId || !visType) return;
  const key = visType + ':' + visId;
  const svgEl = document.querySelector('#vis-svg svg');
  if (!svgEl) return;
  
  // Load from server only if no local positions exist yet
  if (visType === 'manga' && !_blockPositions[key]) {
    try {
      const serverLayouts = await fetch(API + '/mangas/' + visId + '/block-layout').then(r => r.json());
      if (Array.isArray(serverLayouts) && serverLayouts.length > 0) {
        const serverPositions = {};
        serverLayouts.forEach(l => {
          serverPositions[l.block_idx] = {
            transform: l.transform || 'translate(0,0)',
            flipped: l.flipped === 1 || l.flipped === true
          };
        });
        _blockPositions[key] = serverPositions;
        try { localStorage.setItem(BLOCK_POSITIONS_KEY, JSON.stringify(_blockPositions)); } catch(e) {}
      }
    } catch(e) {
      console.warn('[Layout] Server load failed, falling back to localStorage:', e);
    }
  }
  
  const positions = _blockPositions[key];
  if (!positions) return;
  Object.keys(positions).forEach(idx => {
    const block = svgEl.querySelector(`.vis-block[data-block-idx="${idx}"]`);
    if (!block) return;
    const data = positions[idx];
    const transform = typeof data === 'string' ? data : (data?.transform || 'translate(0,0)');
    const flipped = typeof data === 'object' && data?.flipped === true;
    const isSplitter = (block.getAttribute('data-block-idx') || '').startsWith('splitter-');
    block.setAttribute('transform', transform);
    block.setAttribute('data-flipped', flipped ? 'true' : 'false');
    // ⭐ Cable blocks ya se renderizan con la orientación correcta desde el inicio
    // (el render lee _blockPositions para determinar el estado flipped).
    // Ya NO necesitamos applyBlockFlipSVG aquí — eso causaba DOBLE FLIP.
    // Splitter blocks también se renderizan correctamente desde el inicio.
    if (typeof _updateFusionBlockFn === 'function') {
      _updateFusionBlockFn(block);
    }
  });
}

function applyBlockFlipSVG(block) {
  // Flip fiber ports to the opposite edge of the block within the SVG
  const blockW = 140;
  const rect = block.querySelector('rect');
  if (!rect) return;
  const bx = parseFloat(rect.getAttribute('x'));
  // Move each fiber group to the opposite side: mirror around block center
  block.querySelectorAll('.fiber-dot-group').forEach(g => {
    const dot = g.querySelector('.fiber-dot-inner');
    const jacket = g.querySelector('.fiber-jacket');
    const core = g.querySelector('.fiber-core');
    const ferrule = g.querySelector('rect[width="10"]');
    
    if (dot) {
      const cx = parseFloat(dot.getAttribute('cx') || '0');
      const cy = parseFloat(dot.getAttribute('cy') || '0');
      const newCx = bx + blockW - (cx - bx);
      dot.setAttribute('cx', newCx);
    }
    if (jacket) {
      const tag = jacket.tagName.toLowerCase();
      if (tag === 'rect') {
        const jx = parseFloat(jacket.getAttribute('x') || '0');
        const jy = parseFloat(jacket.getAttribute('y') || '0');
        const jw = parseFloat(jacket.getAttribute('width') || '12');
        const jh = parseFloat(jacket.getAttribute('height') || '4');
        const newJx = bx + blockW - (jx + jw - bx);
        jacket.setAttribute('x', newJx);
        jacket.setAttribute('y', jy);
      } else if (tag === 'circle') {
        const cx = parseFloat(jacket.getAttribute('cx') || '0');
        const cy = parseFloat(jacket.getAttribute('cy') || '0');
        const newCx = bx + blockW - (cx - bx);
        jacket.setAttribute('cx', newCx);
      }
    }
    if (core) {
      const tag = core.tagName.toLowerCase();
      if (tag === 'circle') {
        const coreX = parseFloat(core.getAttribute('cx') || '0');
        const coreY = parseFloat(core.getAttribute('cy') || '0');
        core.setAttribute('cx', bx + blockW - (coreX - bx));
        core.setAttribute('cy', coreY);
      }
    }
    if (ferrule) {
      const fx = parseFloat(ferrule.getAttribute('x') || '0');
      const fy = parseFloat(ferrule.getAttribute('y') || '0');
      const fw = parseFloat(ferrule.getAttribute('width') || '3');
      const fh = parseFloat(ferrule.getAttribute('height') || '4');
      ferrule.setAttribute('x', bx + blockW - (fx + fw - bx));
      ferrule.setAttribute('y', fy);
    }
  });
  // Flip labels too
  block.querySelectorAll('text:not(.flip-side-btn):not(.block-toolbar)').forEach(t => {
    // ⭐ No mover el indicador de orientación — se queda a la izquierda
    if (t.getAttribute('orient-role') === 'cable-orient-char') return;
    const tx = parseFloat(t.getAttribute('x') || '0');
    const ty = parseFloat(t.getAttribute('y') || '0');
    t.setAttribute('x', bx + blockW - (tx - bx));
    // If text was left-aligned, make it right-aligned and vice versa
    const anchor = t.getAttribute('text-anchor');
    if (anchor === 'end') t.setAttribute('text-anchor', 'start');
    else if (anchor === 'start') t.setAttribute('text-anchor', 'end');
  });
  
  // ⭐ Actualizar indicador de orientación del bloque de cable
  const cableOrientBg = block.querySelector('circle[orient-role="cable-orient-bg"]');
  const cableOrientChar = block.querySelector('text[orient-role="cable-orient-char"]');
  if (cableOrientBg && cableOrientChar) {
    const isNowFlipped = block.getAttribute('data-flipped') === 'true';
    // LEFT blocks (IN): default ▶ (ports right), flipped ◀ (ports left)
    // RIGHT blocks (OUT): default ◀ (ports left), flipped ▶ (ports right)
    const isLeftBlock = (block.getAttribute('data-block-idx') || '').startsWith('in-');
    if (isLeftBlock) {
      cableOrientChar.textContent = isNowFlipped ? '◀' : '▶';
      const color = isNowFlipped ? '#ff6b6b' : '#00ff88';
      cableOrientChar.setAttribute('fill', color);
      cableOrientBg.setAttribute('stroke', color);
    } else {
      cableOrientChar.textContent = isNowFlipped ? '▶' : '◀';
      const color = isNowFlipped ? '#00ff88' : '#ff6b6b';
      cableOrientChar.setAttribute('fill', color);
      cableOrientBg.setAttribute('stroke', color);
    }
  }
}

var _visRefreshGuard = false;

async function openMangaVisualizer(mangaId, entityType) {
  entityType = entityType || 'manga';
  const isNap = entityType === 'nap';
  if (_visRefreshGuard) { console.warn('[VIS] Refresh already in progress, queuing'); setTimeout(() => openMangaVisualizer(mangaId, entityType), 100); return; }
  _visRefreshGuard = true;
  try {
    if (!mangaId) { showToast('❌ Error interno: ID de ' + entityType + ' inválido'); _visRefreshGuard = false; return; }
    console.log('[VIS] Refreshing visualizer for ' + entityType, mangaId);
    // Save current block positions before re-rendering
    saveBlockPositions();
    
    let splitters, fibers, cablePoints;
    var manga;
    
    if (isNap) {
      const nap = state.naps.find(n => n.id == mangaId);
      if (!nap) { showToast('❌ NAP no encontrada (id=' + mangaId + ')'); return; }
      splitters = await api('/naps/' + mangaId + '/splitters');
      cablePoints = await fetch(API + '/cable-points?element_type=nap&element_id=' + mangaId).then(r => r.json());
      // Use a fake manga object for UI consistency
      var manga = { id: mangaId, name: nap.name, description: nap.description || '' };
    } else {
      const mangaFound = state.mangas.find(m => m.id == mangaId);
      if (!mangaFound) { showToast('❌ Manga no encontrada (id=' + mangaId + ')'); return; }
      manga = mangaFound;
      splitters = await api('/mangas/' + mangaId + '/splitters');
      cablePoints = await fetch(API + '/cable-points?element_type=manga&element_id=' + mangaId).then(r => r.json());
    }
    
    fibers = await api('/mangas/' + mangaId + '/fibers');
    
    // Auto-create fibers for splitters that don't have them
    let needsRefresh = false;
    for (const sp of splitters) {
      // For NAP splitters, check by source_type/source_id; for manga splitters, check by splitter_id
      const hasFibers = fibers.some(f => 
        f.splitter_id == sp.id || 
        (f.source_type === (isNap ? 'nap' : 'manga') && f.source_id == mangaId)
      );
      if (!hasFibers && sp.ports_count > 0) {
        console.log('Auto-creating fibers for splitter', sp.id, '(' + sp.splitter_name + ', ' + sp.ports_count + ' ports)');
        try {
          await api('/mangas/' + mangaId + '/splitters/' + sp.id + '/init-fibers', 'POST', {
            ports_count: sp.ports_count
          });
          needsRefresh = true;
        } catch(e) {
          console.warn('Could not auto-init fibers:', e);
        }
      }
    }
    if (needsRefresh) {
      fibers = await api('/mangas/' + mangaId + '/fibers');
    }
  
  // ====== FETCH CABLES + REAL FIBERS for each cable point ======
  
  const cableFiberData = [];
  for (const cp of cablePoints) {
    const cable = state.cables.find(c => c.id == cp.cable_id);
    if (!cable) continue;
    let cableFibers = [];
    try {
      cableFibers = await fetch(API + '/cables/' + cp.cable_id + '/fibers').then(r => r.json());
    } catch(e) {
      console.warn('No fibers for cable', cp.cable_id);
    }
    cableFiberData.push({
      cableConnectionId: cp.id,
      cableId: cp.cable_id,
      cableName: cable.name,
      fiberCount: cable.fiber_count || cableFibers.length || 12,
      fibers: cableFibers
    });
  }
  
  // ====== FETCH FIBER CONNECTIONS for active power ======
  var _activePowerMap = {};
  // Fetch fiber_connections for active power
  // ⭐ Ya no marcamos potencia aqui por cable_id (cubria TODOS los cable_points
  // del mismo cable). Ahora la potencia la determina exclusivamente el endpoint
  // /olts/hilos-con-potencia que rastrea puntos de cable especificos.
  // Solo cargamos _fcData para referencia, sin modificar _activePowerMap.
  var _fcData = [];
  try {
    _fcData = await fetch(API + '/map-data').then(function(r) { return r.json(); }).then(function(d) { return d.fiberConnections || []; });
  } catch(e) {}
  
  // ====== FETCH EXISTING FUSIONS ======
  let fusions = [];
  let renderFusions = [];
  try {
    fusions = await fetch(API + '/mangas/' + mangaId + '/fusions').then(r => r.json());
    // Separar: fusiones duplicadas (loop-back, mismo cable_point) no se renderizan
    // Las fusiones entre diferentes puntos del manga (IN→OUT) SÍ se muestran
    var cpIds = new Set(cablePoints.map(function(cp) { return cp.id; }));
    renderFusions = fusions.filter(function(f) {
      if (isNap) return true;
      var inCp = parseInt(f.cable_connection_id_in);
      var outCp = parseInt(f.cable_connection_id_out);
      // Solo ocultar si es loop-back (mismo cable_point IN y OUT)
      // Fusiones entre DISTINTOS puntos (IN→OUT del mismo cable) SÍ se renderizan
      return !(inCp && outCp && inCp === outCp);
    });
  } catch(e) {
    console.warn('No fusions for manga', mangaId);
  }
  
  // ❌ Fusion-based power REMOVIDO: contaminaba _activePowerMap con datos a nivel CABLE
  //    en vez de a nivel CABLE_POINT. La unica fuente de potencia es hilos-con-potencia
  //    que traza correctamente punto por punto respetando cortes de fusion en NAPs.
  
  // ====== OVERLAY: marcar hilos con potencia desde OLT + propagados por fusiones ======
  try {
    var hilosRes = await fetch(API + '/olts/hilos-con-potencia');
    var hilosData = await hilosRes.json();
    
    if (hilosData.fuentes && hilosData.fuentes.length > 0) {
      var hilosPowerMap = {};
      // Marcar hilos FUENTE (directamente desde OLT)
      hilosData.fuentes.forEach(function(h) {
        if (!hilosPowerMap[h.fibra_id]) hilosPowerMap[h.fibra_id] = {};
        hilosPowerMap[h.fibra_id][h.hilo_numero] = true;
      });
      _oltHilosFuente = hilosPowerMap;
    }
    
    // Usar 'potencia' del servidor: contiene pares (cable_point_id, fiber_number)
    // que tienen potencia (fuente OLT + propagados por fusiones a traves de toda la red)
    // ⭐ Fix: se matchea contra cd.cableConnectionId (NO cd.cableId) para respetar
    // cortes de fusion en NAPs en cascada sobre el mismo cable.
    if (hilosData.potencia && hilosData.potencia.length > 0) {
      // Detectar formato: nuevo (cable_point_id) vs viejo (cable_id)
      var tienePuntoId = hilosData.potencia.some(function(p) { return p.cable_point_id; });
      
      if (tienePuntoId) {
        // ⭐ NUEVO FORMATO: matchear por cable_point_id (especifico)
        var potSet = {};
        hilosData.potencia.forEach(function(p) {
          var cpId = p.cable_point_id;
          if (!cpId) return;
          potSet[cpId + ':' + p.fiber_number] = true;
        });
        cableFiberData.forEach(function(cd) {
          var connId = cd.cableConnectionId;
          if (!connId) return;
          cd.fibers.forEach(function(fib) {
            var fn = parseInt(fib.fiber_number);
            if (potSet[connId + ':' + fn]) {
              if (!_activePowerMap[connId]) _activePowerMap[connId] = {};
              _activePowerMap[connId][fn] = true;
            }
          });
        });
      } else {
        // VIEJO FORMATO (compatibilidad): matchear por cable_id (todos los puntos)
        var potMap = {};
        hilosData.potencia.forEach(function(p) {
          if (!potMap[p.cable_id]) potMap[p.cable_id] = {};
          potMap[p.cable_id][p.fiber_number] = true;
        });
        cableFiberData.forEach(function(cd) {
          var cablePower = potMap[cd.cableId];
          if (cablePower && cd.fibers) {
            cd.fibers.forEach(function(fib) {
              var fn = parseInt(fib.fiber_number);
              if (cablePower[fn]) {
                if (!_activePowerMap[cd.cableConnectionId]) _activePowerMap[cd.cableConnectionId] = {};
                _activePowerMap[cd.cableConnectionId][fn] = true;
              }
            });
          }
        });
      }
      console.log('[POWER] Marked ' + hilosData.potencia.length + ' fiber points with power');
    }
  } catch(e) {
    console.log('hilos-con-potencia not available:', e.message);
  }
  
  // ====== PROPAGATE power through fusion chain ======
  // If fiber #N on Cable A has power and is fused to fiber #N on Cable B,
  // Cable B's fiber should also show power
  if (Array.isArray(fusions) && fusions.length > 0 && typeof _activePowerMap !== 'undefined') {
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 20) {
      changed = false;
      iterations++;
      for (const f of fusions) {
        var connIn = parseInt(f.cable_connection_id_in);
        var fIn = parseInt(f.fiber_in);
        var connOut = parseInt(f.cable_connection_id_out);
        var fOut = parseInt(f.fiber_out);
        
        // Propagación UNIDIRECCIONAL: solo del ORIGEN (LEFT) al DESTINO (RIGHT)
        // Usar _cablePairLeft para determinar qué lado es el origen (más cerca de la OLT)
        if (connIn && fIn && connOut && fOut) {
          var srcFirst = _cablePairLeft && _cablePairLeft[connIn];
          var srcSecond = _cablePairLeft && _cablePairLeft[connOut];
          if (srcFirst) {
            // connIn es ORIGEN → propagar IN → OUT
            if (_activePowerMap[connIn] && _activePowerMap[connIn][fIn]) {
              if (!_activePowerMap[connOut]) _activePowerMap[connOut] = {};
              if (!_activePowerMap[connOut][fOut]) {
                _activePowerMap[connOut][fOut] = true;
                changed = true;
              }
            }
          } else if (srcSecond) {
            // connOut es ORIGEN → propagar OUT → IN
            if (_activePowerMap[connOut] && _activePowerMap[connOut][fOut]) {
              if (!_activePowerMap[connIn]) _activePowerMap[connIn] = {};
              if (!_activePowerMap[connIn][fIn]) {
                _activePowerMap[connIn][fIn] = true;
                changed = true;
              }
            }
          } else {
            // Sin datos de orientación: NO propagar (evita falsos positivos)
            // La potencia solo se marca desde el servidor (hilos-con-potencia)
          }
        }
      }
    }
    console.log('[POWER] Propagated through ' + iterations + ' rounds, ' + fusions.length + ' fusions');
  }
  
  // ====== FETCH SPLICES (for splitter connections) ======
  let mangaSplices = [];
  try {
    mangaSplices = await fetch(API + '/splices?manga_id=' + mangaId).then(r => r.json());
    
    // Propagar potencia a través de splices (cable → splitter)
    // Si el cable fiber tiene potencia, marcarla en la manga_fiber correspondiente
    if (Array.isArray(mangaSplices) && mangaSplices.length > 0 && !isNap) {
      for (const s of mangaSplices) {
        var cableConnId = null, cablePort = null, mangaFiberId = null;
        if (s.fiber_a_type === 'cable_fiber' && s.fiber_b_type === 'manga_fiber') {
          cableConnId = parseInt(s.fiber_a_id); cablePort = parseInt(s.fiber_a_port); mangaFiberId = parseInt(s.fiber_b_id);
        } else if (s.fiber_a_type === 'manga_fiber' && s.fiber_b_type === 'cable_fiber') {
          cableConnId = parseInt(s.fiber_b_id); cablePort = parseInt(s.fiber_b_port); mangaFiberId = parseInt(s.fiber_a_id);
        }
        if (cableConnId && mangaFiberId && _activePowerMap[cableConnId] && _activePowerMap[cableConnId][cablePort]) {
          // Encontrar la manga_fiber y marcarle potencia
          var mf = fibers.find(function(f) { return f.id == mangaFiberId; });
          if (mf) {
            mf.active_power = true;
            // Usar el power_level de la fiber_connection o un valor por defecto
            var fcPower = null;
            for (var cd of cableFiberData) {
              if (cd.cableConnectionId == cableConnId) {
                var cableFibers = cd.fibers || [];
                var fibFound = cableFibers.find(function(fib) { return fib.fiber_number == cablePort; });
                if (fibFound) fcPower = fibFound.power_level;
                break;
              }
            }
            mf.power_level = fcPower || 2.5;
            // Propagar a las salidas del splitter
            if (mf.splitter_id) {
              var splitterLoss = 0;
              var spData = splitters.find(function(sp) { return sp.id == mf.splitter_id; });
              if (spData) splitterLoss = parseFloat(spData.loss_db || spData.loss_db || 0);
              var outPower = (mf.power_level || 2.5) - splitterLoss;
              fibers.forEach(function(f) {
                if (f.splitter_id == mf.splitter_id && f.splitter_output > 0) {
                  f.active_power = true;
                  f.power_level = outPower;
                }
              });
            }
          }
        }
      }
    }
  } catch(e) {
    console.warn('No splices for manga', mangaId);
  }
  
  // ====== DETECT: PASS-THROUGH vs TERMINATION for each cable point ======
  // For each cable connection point, check if the cable has points both before and after this manga
  // If yes → pass-through (IN + OUT). If no → termination (only one side).
  const cablePassThrough = {}; // cableConnectionId -> boolean (true = pass-through)
  var uniqueCableIds = [];
  try {
    // Fetch full point sequences for all unique cables
    uniqueCableIds = [...new Set(cableFiberData.map(cd => cd.cableId))];
    for (const cid of uniqueCableIds) {
      const allPoints = await api('/cable-points?cable_id=' + cid);
      // Get cable points that belong to this manga
      const mangaPoints = cablePoints.filter(cp => cp.cable_id == cid);
      
      for (const mp of mangaPoints) {
        const sortedPoints = allPoints.sort((a, b) => a.sequence - b.sequence);
        const idx = sortedPoints.findIndex(p => p.id == mp.id);
        if (idx === -1) {
          cablePassThrough[mp.id] = false;
          continue;
        }
        // Has points before AND after → pass-through
        const hasBefore = idx > 0;
        const hasAfter = idx < sortedPoints.length - 1;
        cablePassThrough[mp.id] = hasBefore && hasAfter;
      }
    }
  } catch(e) {
    console.warn('Error detecting pass-through cables:', e);
    // Default: show as termination
    cablePoints.forEach(cp => { cablePassThrough[cp.id] = false; });
  }
  
  // For consecutive same-cable points: detect which side is closer to OLT
  // La potencia viene DESDE la OLT. Queremos el lado OLT a la IZQUIERDA.
  // ⭐ Refresh all cable points for each cable to ensure OLT detection works
  // (state._cablePoints puede estar stale si la manga se creo despues de cargar la pagina)
  for (var ci = 0; ci < uniqueCableIds.length; ci++) {
    var cid = uniqueCableIds[ci];
    var existing = (state._cablePoints || []).filter(function(p) { return p.cable_id == cid; });
    if (existing.length === 0) {
      try {
        var fresh = await api('/cable-points?cable_id=' + cid);
        if (fresh && fresh.length > 0) {
          if (!state._cablePoints) state._cablePoints = [];
          fresh.forEach(function(fp) {
            if (!state._cablePoints.some(function(p) { return p.id == fp.id; })) {
              state._cablePoints.push(fp);
            }
          });
        }
      } catch(e) {}
    }
  }
  
  var _cablePairLeft = {}, _cablePairRight = {};
  uniqueCableIds.forEach(function(cid) {
    var mangaPts = cablePoints.filter(function(cp) { return cp.cable_id == cid; }).sort(function(a, b) { return a.sequence - b.sequence; });
    var cableAllPts = (state._cablePoints || []).filter(function(p) { return p.cable_id == cid; }).sort(function(a, b) { return a.sequence - b.sequence; });
    for (var pi = 0; pi < mangaPts.length - 1; pi++) {
      if (mangaPts[pi + 1].sequence === mangaPts[pi].sequence + 1) {
        var firstSeq = mangaPts[pi].sequence;
        var secondSeq = mangaPts[pi + 1].sequence;
        var hasOLTBefore = cableAllPts.some(function(p) { return p.sequence < firstSeq && p.element_type === 'olt'; });
        var hasOLTAfter = cableAllPts.some(function(p) { return p.sequence > secondSeq && p.element_type === 'olt'; });
        var firstPt = mangaPts[pi];
        var secondPt = mangaPts[pi + 1];
        if (hasOLTAfter || (!hasOLTBefore && secondSeq > firstSeq)) {
          _cablePairLeft[secondPt.id] = true;
          _cablePairRight[firstPt.id] = true;
        } else {
          _cablePairLeft[firstPt.id] = true;
          _cablePairRight[secondPt.id] = true;
        }
      }
    }
  });
  
  // ====== BUILD POWER INFO ======
  let powerInfo = '';
  const activeFibers = fibers.filter(f => f.active_power);
  if (activeFibers.length > 0) {
    powerInfo = `<span style="color:#00ff88">⚡ ${activeFibers.length} fibra(s) activas</span>`;
  } else {
    powerInfo = `<span style="color:#888">💤 Sin fibras activas</span>`;
  }
  
  // ====== TOOLBAR ======
  const emoji = isNap ? '📡' : '🧶';
  state.currentVisualizerType = isNap ? 'nap' : 'manga';
  state.currentVisualizerId = mangaId;
  document.getElementById('vis-title').textContent = `${emoji} ${manga.name}`;
  document.getElementById('vis-power-info').innerHTML = powerInfo;
  
  if (isNap) {
    const napSplits = splitters.map(s => `<span style="font-size:11px;color:#00d4ff;margin-right:8px;">🔀 ${escHtml(s.name)} (${s.splitter_name || 'N/A'} · ${s.splitter_ports || s.ports_count}p)</span>`).join('');
    document.getElementById('vis-splitter-info').innerHTML = `
      <strong>Splitter NAP:</strong> ${splitters[0]?.name || 'N/A'} · ${splitters[0]?.splitter_ports || splitters[0]?.ports_count || '?'}p · ${splitters[0]?.loss_db || 0}dB
      · <strong>Cables:</strong> ${cablePoints.length}
      · <strong>Fibras:</strong> ${fibers.length}
      <br><span style="font-size:11px;color:#aaa">Splitters globales:</span> ${napSplits || '<span style="font-size:11px;color:#888">ninguno</span>'}
      <button class="vis-inline-btn" onclick="addNapSplitter(${mangaId})">➕ Splitter Global</button>
      <button class="vis-inline-btn danger" onclick="showDeleteSplitterConfirm(${mangaId})">✕ Splitter</button>
      <button class="vis-inline-btn" style="background:#e94560;color:#fff;font-weight:bold;" onclick="showSetPowerDialogForNap(${mangaId})">⚡ Set Power</button>
      <span style="color:#888;font-size:11px;margin-left:8px;">(Clic fibras SVG para empalmar →)</span>
    `;
  } else {
    document.getElementById('vis-splitter-info').innerHTML = `
      <strong>Splitters:</strong> ${splitters.length} · 
      <strong>Fibras:</strong> ${fibers.length} · 
      <strong>Cables:</strong> ${cablePoints.length} · 
      <strong>Empalmes:</strong> ${Array.isArray(fusions) ? fusions.length : 0} · <strong>Splices:</strong> ${Array.isArray(mangaSplices) ? mangaSplices.length : 0}
      <button class="vis-inline-btn" onclick="addMangaSplitter(${mangaId})">➕ Splitter</button>
      <button class="vis-inline-btn danger" onclick="deleteMangaSplitter(${mangaId})">✕ Splitter</button>
      <button class="vis-inline-btn" onclick="addMangaFiber(${mangaId})">➕ Fibra</button>
      <button class="vis-inline-btn" style="background:#e94560;color:#fff;font-weight:bold;" onclick="showSetPowerDialog(${mangaId})">⚡ Set Power</button>
      <span style="color:#888;font-size:11px;margin-left:8px;">(Clic fibras SVG para empalmar →)</span>
    `;
  }
  document.querySelector('#vis-fibers-title').innerHTML = isNap ? '📡 Puertos <span class="vis-toggle-left" onclick="toggleVisLeft()">◀ Ocultar</span>' : '🧶 Fibras <span class="vis-toggle-left" onclick="toggleVisLeft()">◀ Ocultar</span>';
  
  // ====== LEFT PANEL FIBERS ======
  let fibersHTML = '';
  fibers.forEach((f) => {
    const col = tiaColor(f.fiber_number);
    const borderStyle = (col === '#ffffff' || col === '#ffd700') 
      ? `border-left: 3px solid ${col}; border-left-color: #666;`  // darker border for light colors
      : `border-left: 3px solid ${col}`;
    fibersHTML += `
      <div class="fiber-port ${f.active_power ? 'active' : ''} ${f.client_name ? 'connected' : ''}" 
           onclick="editMangaFiber(${mangaId}, ${f.id})"
           style="${borderStyle}">
        <div class="port-number">Fibra #${f.fiber_number} <span style="font-size:9px;color:#aaa">${tiaColorName(f.fiber_number)}</span></div>
        <div class="port-status">${f.client_name || 'Libre'}</div>
        ${f.active_power ? `<div class="port-power">⚡ ${f.power_level?.toFixed(1) || '?'} dBm</div>` : ''}
        ${f.splitter_name ? `<div class="port-status" style="color:#ffaa00">🔀 Splitter: ${f.splitter_name}</div>` : ''}
      </div>
    `;
  });
  
  if (fibers.length === 0) {
    fibersHTML = '<p style="text-align:center;padding:20px;color:#888;">🧶 No hay fibras en esta manga. Agrega fibras desde el botón de arriba.</p>';
  }
  // For NAPs, show NAP ports in left panel instead of manga_fibers
  if (isNap) {
    try {
      const napDetail = await api('/naps');
      const fullNap = napDetail.find(n => n.id == mangaId);
      if (fullNap && fullNap.ports) {
        const globalSplitter = splitters && splitters.length > 0 ? splitters[0] : null;
        const splitterPorts = globalSplitter ? (globalSplitter.splitter_ports || globalSplitter.ports_count || 8) : (fullNap?.splitter_ports || fullNap?.port_capacity || 8);
        const portCapacity = splitterPorts;
        let napPortsHTML = '';
        for (let i = 1; i <= portCapacity; i++) {
          const port = fullNap.ports.find(p => p.port_number === i);
          const hasClient = port?.client_name || port?.fiber_number;
          const col = tiaColor(i);
          const borderStyle = (col === '#ffffff' || col === '#ffd700') 
            ? `border-left: 3px solid ${col}; border-left-color: #666;`
            : `border-left: 3px solid ${col}`;
          napPortsHTML += `
            <div class="fiber-port ${hasClient ? 'connected' : ''}"
                 onclick="editNapPort(${mangaId}, ${i})"
                 style="${borderStyle}">
              <div class="port-number">Puerto ${i}</div>
              <div class="port-status">${port?.client_name || 'Libre'}</div>
              ${port?.fiber_number ? `<div class="port-status" style="color:#00cc66">✅ Fibra #${port.fiber_number}</div>` : ''}
              ${port?.client_name ? `<div style="font-size:11px;color:#00d4ff;margin-top:2px">👤 ${port.client_name}</div>` : ''}
            </div>
          `;
        }
        if (napPortsHTML) {
          fibersHTML = napPortsHTML;
        }
      }
    } catch(e) {
      console.warn('Could not load NAP ports for left panel:', e);
    }
  }
  document.getElementById('vis-fibers').innerHTML = fibersHTML;
  
  // ====== SVG ======
  let svgLines = '';
  let svgDefs = '<marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#00ff88" opacity="0.9"/></marker>';  // arrow for data-flow
  const w = 1600;
  const h = 1000;
  svgLines = `<rect width="${w}" height="${h}" fill="#555" rx="8" />`;
  
  const centerY = h / 2;
  
  // ====== CABLE CONNECTIONS ON LEFT SIDE ======
  const leftStartX = 60;
  const leftCableBlockW = 140;
  const rightStartX = leftStartX + leftCableBlockW + 320;
  const rightCableBlockW = 140;
  const cableBlocks = Math.max(cableFiberData.length, 1);
  const availableH = h - 100;
  const blockH = Math.min(availableH / cableBlocks, 350);
  
  // ====== TRACK cable block positions for fusion drawing ======
  const cableBlockPositions = {}; // cableConnectionId -> { blockTop, blockH, isPassThrough, idx }
  
  // Draw left cables (IN) — skip if point is second in a consecutive pair
  cableFiberData.forEach((cd, idx) => {
    var ptId = parseInt(cd.cableConnectionId);
    if (_cablePairRight[ptId]) return; // Este punto va al lado derecho (OUT)
    const blockTop = 60 + idx * (blockH + 20);
    const isPt = !!cablePassThrough[cd.cableConnectionId];
    cableBlockPositions[cd.cableConnectionId] = { blockTop, blockH, isPassThrough: isPt, idx };
    
    if (!isPt && cd.cableConnectionId) {
      const maxFibers = Math.min(cd.fibers.length || cd.fiberCount, 24);
      // Height adjusts to fiber count - same design as pass-through blocks
      const headerH = 30;
      const fSpacing = 24;
      const contentH = 10 + maxFibers * fSpacing + 10;
      const termBlockH = Math.max(headerH + contentH, 100);
      const fiberStartY = blockTop + headerH + 8;
      const fiberEndX = leftStartX + leftCableBlockW - 16;
      
      // ⭐ ORIENTACIÓN del bloque LEFT (IN) — pass-through
      const ptBlockKey = (isNap ? 'nap' : 'manga') + ':' + mangaId;
      const ptInBlockIdx = 'in-' + idx;
      const ptLeftSavedPos = _blockPositions[ptBlockKey]?.[ptInBlockIdx];
      const ptLeftBlockFlipped = ptLeftSavedPos?.flipped === true;
      
      svgLines += `<g class="vis-block" transform="translate(0,0)" data-block-idx="in-${idx}">`;
      
      // Same design as pass-through blocks (solid border, purple)
      svgLines += `<rect x="${leftStartX}" y="${blockTop}" width="${leftCableBlockW}" height="${termBlockH}" rx="6" fill="#1a1a2e" stroke="#533483" stroke-width="2" />`;
      
      // Header matching pass-through style
      svgLines += `<circle cx="${leftStartX + 14}" cy="${blockTop + 16}" r="9" fill="rgba(83,52,131,0.5)" stroke="${ptLeftBlockFlipped ? '#ff6b6b' : '#00ff88'}" stroke-width="1.5" orient-role="cable-orient-bg" />`;
      svgLines += `<text x="${leftStartX + 14}" y="${blockTop + 20}" text-anchor="middle" fill="${ptLeftBlockFlipped ? '#ff6b6b' : '#00ff88'}" font-family="sans-serif" font-size="11" font-weight="bold" orient-role="cable-orient-char">${ptLeftBlockFlipped ? '◀' : '▶'}</text>`;
      svgLines += `<text x="${leftStartX + 28}" y="${blockTop + 16}" fill="#ffaa00" font-family="sans-serif" font-size="11" font-weight="bold">${escHtml(cd.cableName)}</text>`;
      // Flip button (mismo estilo que pass-through)
      svgLines += `<rect class="flip-side-btn-bg" x="${leftStartX + leftCableBlockW - 22}" y="${blockTop + 4}" width="20" height="20" rx="4" fill="#3a3f4b" stroke="#555" stroke-width="1" style="cursor:pointer" onclick="toggleBlockSide('in-${idx}')" />`;
      svgLines += `<text class="flip-side-btn" x="${leftStartX + leftCableBlockW - 12}" y="${blockTop + 17}" fill="#00d4ff" font-family="sans-serif" font-size="13" text-anchor="middle" pointer-events="none">🔄</text>`;
      svgLines += `<text x="${leftStartX + leftCableBlockW - 8}" y="${blockTop + 16}" text-anchor="end" fill="#888" font-family="sans-serif" font-size="9">${maxFibers}h</text>`;
      svgLines += `<line x1="${leftStartX + 10}" y1="${blockTop + headerH}" x2="${leftStartX + leftCableBlockW - 10}" y2="${blockTop + headerH}" stroke="#533483" stroke-width="1" />`;
      
      // Draw hilos — same style as pass-through blocks
      for (let fi = 1; fi <= maxFibers; fi++) {
        const fy = fiberStartY + (fi - 1) * fSpacing;
        const col = tiaColor(fi);
        const jacketCol = (col === '#ffffff') ? '#ccc' : col;
        const contrastBorder = (col === '#ffffff' || col === '#f5d442') ? '#888' : jacketCol;
        // ⭐ Posición del puerto según orientación
        const portX = ptLeftBlockFlipped 
          ? leftStartX + 4   // flipped: left edge
          : leftStartX + leftCableBlockW - 4; // default: right edge
        
        // Check if this fiber already has a fusion
        const hasFusion = (
          (Array.isArray(fusions) && fusions.some(f => 
            (parseInt(f.cable_connection_id_in) === cd.cableConnectionId && parseInt(f.fiber_in) === fi) ||
            (parseInt(f.cable_connection_id_out) === cd.cableConnectionId && parseInt(f.fiber_out) === fi)
          )) ||
          (Array.isArray(mangaSplices) && mangaSplices.some(s =>
            (s.fiber_a_type === 'cable_fiber' && parseInt(s.fiber_a_id) === cd.cableConnectionId && parseInt(s.fiber_a_port) === fi) ||
            (s.fiber_b_type === 'cable_fiber' && parseInt(s.fiber_b_id) === cd.cableConnectionId && parseInt(s.fiber_b_port) === fi)
          ))
        );
        
        // === REALISTIC OPTICAL FIBER (same as pass-through blocks) ===
        const jacketW = 32;
        const jacketH = 16;
        // ⭐ Chaqueta se voltea según orientación del bloque
        const jacketX = ptLeftBlockFlipped 
          ? portX                     // flipped: jacket extends RIGHT (into block)
          : portX - jacketW + 4;      // default: jacket extends LEFT (into block)
        const jacketY = fy - jacketH/2;
        
        const fiberDotClass = 'fiber-dot-group' + (hasFusion ? ' fiber-connected' : '');
        const fiberDotCursor = hasFusion ? 'default' : 'pointer';
        svgLines += `<g class="${fiberDotClass}" style="cursor:${fiberDotCursor};">`;
        svgLines += `<rect x="${jacketX}" y="${jacketY}" width="${jacketW}" height="${jacketH}" rx="4" fill="${col}" stroke="${contrastBorder}" stroke-width="2" class="fiber-jacket" />`;
        const coreR = 5;
        const coreCol = (col === '#ffffff' || col === '#f5d442') ? '#333' : '#fff';
        svgLines += `<circle cx="${jacketX + jacketW/2}" cy="${fy}" r="${coreR}" fill="${coreCol}" opacity="0.9" class="fiber-core" />`;
        const ferruleX = portX;
        const ferruleW = 10;
        const ferruleH = 12;
        svgLines += `<rect x="${ferruleX}" y="${fy - ferruleH/2}" width="${ferruleW}" height="${ferruleH}" rx="3" fill="#888" stroke="#666" stroke-width="1.5" opacity="0.9" />`;
        var _isRightSide = _cablePairRight && !!_cablePairRight[cd.cableConnectionId];
        var fiberHasPower = !_isRightSide && (
          (_activePowerMap[cd.cableConnectionId] && _activePowerMap[cd.cableConnectionId][fi] === true) ||
          (hasFusion && Array.isArray(fusions) && fusions.some(f => 
            (parseInt(f.cable_connection_id_in) === cd.cableConnectionId && parseInt(f.fiber_in) === fi && (f.active_power === true || f.active_power === 1 || f.active_power === '1')) ||
            (parseInt(f.cable_connection_id_out) === cd.cableConnectionId && parseInt(f.fiber_out) === fi && (f.active_power === true || f.active_power === 1 || f.active_power === '1'))
          ))
        );
        svgLines += `<circle class="fiber-dot-inner" cx="${portX}" cy="${fy}" r="32" fill="transparent" data-original-stroke="${contrastBorder}" data-original-r="32" data-cable-conn="${cd.cableConnectionId}" data-fiber-num="${fi}" data-side="in" data-has-fusion="${hasFusion}" data-has-power="${fiberHasPower}" />`;
        svgLines += `</g>`;
        
        var ptInLabelX = ptLeftBlockFlipped ? portX + 56 : portX - 56;
        if (fiberHasPower && !hasFusion) {
          svgLines += `<text x="${ptInLabelX}" y="${fy + 8}" text-anchor="middle" fill="#00ff88" font-family="sans-serif" font-size="18" font-weight="bold">⚡#${fi}</text>`;
        } else {
          svgLines += `<text x="${ptInLabelX}" y="${fy + 8}" text-anchor="middle" fill="#888" font-family="sans-serif" font-size="18" font-weight="bold">#${fi}</text>`;
        }
      }
      svgLines += `</g>`;
      return;
    }
    
    // Cable name + IN label (inside block header)
    var leftLabelStr = isPt ? cd.cableName + ' IN' : cd.cableName.substring(0, 14);
    
    // ⭐ ORIENTACIÓN del bloque LEFT (IN)
    // Default (not flipped): puertos a la DERECHA ▶
    // Flipped: puertos a la IZQUIERDA ◀
    const leftBlockKey = (isNap ? 'nap' : 'manga') + ':' + mangaId;
    const inBlockIdx = 'in-' + idx;
    const leftSavedPos = _blockPositions[leftBlockKey]?.[inBlockIdx];
    const leftBlockFlipped = leftSavedPos?.flipped === true;
    
    // Wrap cable block in draggable vis-block group
    svgLines += `<g class="vis-block" transform="translate(0,0)" data-block-idx="in-${idx}">`;
    svgLines += `<rect x="${leftStartX}" y="${blockTop}" width="${leftCableBlockW}" height="${blockH}" rx="6" fill="#1a1a2e" stroke="#533483" stroke-width="2" />`;
    svgLines += `<rect class="flip-side-btn-bg" x="${leftStartX + leftCableBlockW - 22}" y="${blockTop + 4}" width="20" height="20" rx="4" fill="#3a3f4b" stroke="#555" stroke-width="1" style="cursor:pointer" onclick="toggleBlockSide('in-${idx}')" />`;
    svgLines += `<text class="flip-side-btn" x="${leftStartX + leftCableBlockW - 12}" y="${blockTop + 17}" fill="#00d4ff" font-family="sans-serif" font-size="13" text-anchor="middle" pointer-events="none">🔄</text>`;
    // Indicador de orientación a la izquierda del nombre
    const inOrientChar = leftBlockFlipped ? '◀' : '▶';
    const inOrientColor = leftBlockFlipped ? '#ff6b6b' : '#00ff88';
    svgLines += `<circle cx="${leftStartX + 16}" cy="${blockTop + 18}" r="9" fill="rgba(83,52,131,0.5)" stroke="${inOrientColor}" stroke-width="1.5" orient-role="cable-orient-bg" />`;
    svgLines += `<text x="${leftStartX + 16}" y="${blockTop + 22}" text-anchor="middle" fill="${inOrientColor}" font-family="sans-serif" font-size="11" font-weight="bold" orient-role="cable-orient-char">${inOrientChar}</text>`;
    svgLines += `<text x="${leftStartX + leftCableBlockW/2}" y="${blockTop + 18}" text-anchor="middle" fill="${isPt ? '#00d4ff' : '#ffaa00'}" font-family="sans-serif" font-size="11" font-weight="bold">${escHtml(leftLabelStr)}</text>`;
    svgLines += `<line x1="${leftStartX + 10}" y1="${blockTop + 28}" x2="${leftStartX + leftCableBlockW - 10}" y2="${blockTop + 28}" stroke="#533483" stroke-width="1" />`;
    
    // Fiber ports on LEFT block (right edge of block = connection points)
    const maxFibers = Math.min(cd.fibers.length || cd.fiberCount, 24);
    const fSpacing = (blockH - 36) / maxFibers;
    
    for (let fi = 1; fi <= maxFibers; fi++) {
      const fy = blockTop + 44 + (fi - 1) * fSpacing;
      const col = tiaColor(fi);
      // ⭐ Posición del puerto según orientación
      const portX = leftBlockFlipped 
        ? leftStartX + 4   // flipped: left edge
        : leftStartX + leftCableBlockW - 4; // default: right edge
      
      // Check if this fiber already has a fusion IN
      const hasFusion = (
        (Array.isArray(fusions) && fusions.some(f => 
          (parseInt(f.cable_connection_id_in) === cd.cableConnectionId && parseInt(f.fiber_in) === fi) ||
          (parseInt(f.cable_connection_id_out) === cd.cableConnectionId && parseInt(f.fiber_out) === fi)
        )) ||
        (Array.isArray(mangaSplices) && mangaSplices.some(s => 
          (s.fiber_a_type === 'cable_fiber' && parseInt(s.fiber_a_id) === cd.cableConnectionId && parseInt(s.fiber_a_port) === fi) ||
          (s.fiber_b_type === 'cable_fiber' && parseInt(s.fiber_b_id) === cd.cableConnectionId && parseInt(s.fiber_b_port) === fi)
        ))
      );
      
      // === REALISTIC OPTICAL FIBER (pigtail with colored jacket + glass core) ===
      const jacketW = 32;
      const jacketH = 16;
      // ⭐ Chaqueta se voltea según orientación
      const jacketX = leftBlockFlipped 
        ? portX                     // flipped: jacket extends RIGHT (into block)
        : portX - jacketW + 4;      // default: jacket extends LEFT (into block)
      const jacketY = fy - jacketH/2;
      const jacketCol = (col === '#ffffff') ? '#ccc' : col;
      const contrastBorder = (col === '#ffffff' || col === '#f5d442') ? '#888' : jacketCol;
      
      const fiberDotClass = 'fiber-dot-group' + (hasFusion ? ' fiber-connected' : '');
      const fiberDotCursor = hasFusion ? 'default' : 'pointer';
      svgLines += `<g class="${fiberDotClass}" style="cursor:${fiberDotCursor};">`;
      svgLines += `<rect x="${jacketX}" y="${jacketY}" width="${jacketW}" height="${jacketH}" rx="4" fill="${col}" stroke="${contrastBorder}" stroke-width="2" class="fiber-jacket" />`;
      const coreR = 5;
      const coreCol = (col === '#ffffff' || col === '#f5d442') ? '#333' : '#fff';
      svgLines += `<circle cx="${jacketX + jacketW/2}" cy="${fy}" r="${coreR}" fill="${coreCol}" opacity="0.9" class="fiber-core" />`;
      const ferruleX = portX;
      const ferruleW = 10;
      const ferruleH = 12;
      svgLines += `<rect x="${ferruleX}" y="${fy - ferruleH/2}" width="${ferruleW}" height="${ferruleH}" rx="3" fill="#888" stroke="#666" stroke-width="1.5" opacity="0.9" />`;
      var _isRightSide = _cablePairRight && !!_cablePairRight[cd.cableConnectionId];
      var fiberHasPower = !_isRightSide && (
        (_activePowerMap[cd.cableConnectionId] && _activePowerMap[cd.cableConnectionId][fi] === true) ||
        (hasFusion && Array.isArray(fusions) && fusions.some(f => 
          (parseInt(f.cable_connection_id_in) === cd.cableConnectionId && parseInt(f.fiber_in) === fi && (f.active_power === true || f.active_power === 1 || f.active_power === '1')) ||
          (parseInt(f.cable_connection_id_out) === cd.cableConnectionId && parseInt(f.fiber_out) === fi && (f.active_power === true || f.active_power === 1 || f.active_power === '1'))
        ))
      );
      svgLines += `<circle class="fiber-dot-inner" cx="${portX}" cy="${fy}" r="32" fill="transparent" data-original-stroke="${contrastBorder}" data-original-r="32" data-cable-conn="${cd.cableConnectionId}" data-fiber-num="${fi}" data-side="in" data-has-fusion="${hasFusion}" data-has-power="${fiberHasPower}" />`;
      svgLines += `</g>`;
      
      var inLabelX = leftBlockFlipped ? portX + 56 : portX - 56;
      if (fiberHasPower && !hasFusion) {
        svgLines += `<text x="${inLabelX}" y="${fy + 8}" text-anchor="middle" fill="#00ff88" font-family="sans-serif" font-size="18" font-weight="bold">⚡#${fi}</text>`;
      } else {
        svgLines += `<text x="${inLabelX}" y="${fy + 8}" text-anchor="middle" fill="#888" font-family="sans-serif" font-size="18" font-weight="bold">#${fi}</text>`;
      }
    }
    svgLines += `</g>`; // end .vis-block
  });
  
  // Draw right cables (OUT) — skip if point is first in a consecutive pair
  cableFiberData.forEach((cd, idx) => {
    var ptId = parseInt(cd.cableConnectionId);
    if (_cablePairLeft[ptId]) return; // Este punto ya se dibujó en el lado izquierdo (IN)
    const isPt = !!cablePassThrough[cd.cableConnectionId];
    // Skip OUT block: show only if paired as OUT or pass-through
    // (NO mostrar OUT solo porque tiene splice — eso crea un bloque extra)
    if (!_cablePairRight[ptId] && !isPt) return;
    
    const blockTop = 60 + idx * (blockH + 20);
    
    // Cable name label on right side (outside draggable block)
    var rightLabelStr = cd.cableName + ' OUT';
    
    // Wrap cable block in draggable vis-block group
    // ⭐ ORIENTACIÓN del bloque RIGHT (OUT)
    // Default (not flipped): puertos a la IZQUIERDA ◀
    // Flipped: puertos a la DERECHA ▶
    const outBlockKey = (isNap ? 'nap' : 'manga') + ':' + mangaId;
    const outBlockIdx = 'out-' + idx;
    const outSavedPos = _blockPositions[outBlockKey]?.[outBlockIdx];
    const outBlockFlipped = outSavedPos?.flipped === true;
    
    svgLines += `<g class="vis-block" transform="translate(0,0)" data-block-idx="out-${idx}">`;
    svgLines += `<rect x="${rightStartX}" y="${blockTop}" width="${rightCableBlockW}" height="${blockH}" rx="6" fill="#1a1a2e" stroke="#533483" stroke-width="2" />`;
    // Flip button en la ESQUINA DERECHA (como el LEFT block), no en la izquierda
    svgLines += `<rect class="flip-side-btn-bg" x="${rightStartX + rightCableBlockW - 22}" y="${blockTop + 4}" width="20" height="20" rx="4" fill="#3a3f4b" stroke="#555" stroke-width="1" style="cursor:pointer" onclick="toggleBlockSide('out-${idx}')" />`;
    svgLines += `<text class="flip-side-btn" x="${rightStartX + rightCableBlockW - 12}" y="${blockTop + 17}" fill="#00d4ff" font-family="sans-serif" font-size="13" text-anchor="middle" pointer-events="none">🔄</text>`;
    // Indicador de orientación a la izquierda del nombre
    const outOrientChar = outBlockFlipped ? '▶' : '◀';
    const outOrientColor = outBlockFlipped ? '#00ff88' : '#ff6b6b';
    svgLines += `<circle cx="${rightStartX + 16}" cy="${blockTop + 18}" r="9" fill="rgba(83,52,131,0.5)" stroke="${outOrientColor}" stroke-width="1.5" orient-role="cable-orient-bg" />`;
    svgLines += `<text x="${rightStartX + 16}" y="${blockTop + 22}" text-anchor="middle" fill="${outOrientColor}" font-family="sans-serif" font-size="11" font-weight="bold" orient-role="cable-orient-char">${outOrientChar}</text>`;
    svgLines += `<text x="${rightStartX + rightCableBlockW/2}" y="${blockTop + 18}" text-anchor="middle" fill="#00d4ff" font-family="sans-serif" font-size="12" font-weight="bold">${escHtml(rightLabelStr)}</text>`;
    svgLines += `<line x1="${rightStartX + 10}" y1="${blockTop + 28}" x2="${rightStartX + rightCableBlockW - 10}" y2="${blockTop + 28}" stroke="#533483" stroke-width="1" />`;
    
    // Fiber ports on RIGHT block (left edge of block = connection points)
    const maxFibers = Math.min(cd.fibers.length || cd.fiberCount, 24);
    const fSpacing = (blockH - 36) / maxFibers;
    
    for (let fi = 1; fi <= maxFibers; fi++) {
      const fy = blockTop + 44 + (fi - 1) * fSpacing;
      const col = tiaColor(fi);
      // ⭐ Posición del puerto según orientación
      const portX = outBlockFlipped 
        ? rightStartX + rightCableBlockW - 4  // flipped: right edge
        : rightStartX + 4; // default: left edge
      
      // Check if this fiber has a fusion (OUT side for right blocks)
      const hasFusion = (
        (Array.isArray(fusions) && fusions.some(f => 
          (parseInt(f.cable_connection_id_in) === cd.cableConnectionId && parseInt(f.fiber_in) === fi) ||
          (parseInt(f.cable_connection_id_out) === cd.cableConnectionId && parseInt(f.fiber_out) === fi)
        )) ||
        (Array.isArray(mangaSplices) && mangaSplices.some(s => 
          (s.fiber_a_type === 'cable_fiber' && parseInt(s.fiber_a_id) === cd.cableConnectionId && parseInt(s.fiber_a_port) === fi) ||
          (s.fiber_b_type === 'cable_fiber' && parseInt(s.fiber_b_id) === cd.cableConnectionId && parseInt(s.fiber_b_port) === fi)
        ))
      );
      
      // === REALISTIC OPTICAL FIBER (pigtail pointing LEFT/RIGHT según orientación) ===
      const jacketW = 32;
      const jacketH = 16;
      // ⭐ Chaqueta se voltea según orientación
      const jacketX = outBlockFlipped 
        ? portX - jacketW + 4   // flipped: jacket extends LEFT (into block)
        : portX;                 // default: jacket extends RIGHT (into block)
      const jacketY = fy - jacketH/2;
      const contrastBorder = (col === '#ffffff' || col === '#f5d442') ? '#888' : col;
      
      const fiberDotClass = 'fiber-dot-group' + (hasFusion ? ' fiber-connected' : '');
      const fiberDotCursor = hasFusion ? 'default' : 'pointer';
      svgLines += `<g class="${fiberDotClass}" style="cursor:${fiberDotCursor};">`;
      svgLines += `<rect x="${jacketX}" y="${jacketY}" width="${jacketW}" height="${jacketH}" rx="4" fill="${col}" stroke="${contrastBorder}" stroke-width="2" class="fiber-jacket" />`;
      const coreCol = (col === '#ffffff' || col === '#f5d442') ? '#333' : '#fff';
      svgLines += `<circle cx="${jacketX + jacketW/2}" cy="${fy}" r="5" fill="${coreCol}" opacity="0.9" class="fiber-core" />`;
      svgLines += `<rect x="${portX - 5}" y="${fy - 6}" width="10" height="12" rx="3" fill="#888" stroke="#666" stroke-width="1.5" opacity="0.9" />`;
      var _isRightSide = _cablePairRight && !!_cablePairRight[cd.cableConnectionId];
      var fiberHasPower = !_isRightSide && (
        (_activePowerMap[cd.cableConnectionId] && _activePowerMap[cd.cableConnectionId][fi] === true) ||
        (hasFusion && Array.isArray(fusions) && fusions.some(f => 
          (parseInt(f.cable_connection_id_in) === cd.cableConnectionId && parseInt(f.fiber_in) === fi && (f.active_power === true || f.active_power === 1 || f.active_power === '1')) ||
          (parseInt(f.cable_connection_id_out) === cd.cableConnectionId && parseInt(f.fiber_out) === fi && (f.active_power === true || f.active_power === 1 || f.active_power === '1'))
        ))
      );
      svgLines += `<circle class="fiber-dot-inner" cx="${portX}" cy="${fy}" r="32" fill="transparent" data-original-stroke="${contrastBorder}" data-original-r="32" data-cable-conn="${cd.cableConnectionId}" data-fiber-num="${fi}" data-side="out" data-has-fusion="${hasFusion}" data-has-power="${fiberHasPower}" />`;
      svgLines += `</g>`;
      
      // ⭐ Label de fibra al lado opuesto según orientación
      const outLabelX = outBlockFlipped ? portX - 56 : portX + 56;
      if (fiberHasPower && !hasFusion) {
        svgLines += `<text x="${outLabelX}" y="${fy + 8}" text-anchor="middle" fill="#00ff88" font-family="sans-serif" font-size="18" font-weight="bold">⚡#${fi}</text>`;
      } else {
        svgLines += `<text x="${outLabelX}" y="${fy + 8}" text-anchor="middle" fill="#888" font-family="sans-serif" font-size="18" font-weight="bold">#${fi}</text>`;
      }
    }
    svgLines += `</g>`; // end .vis-block
  });
  
  // ====== CENTER LABEL ======

  
  // ====== DRAW FUSION LINES with color gradient + conditional animation ======
  if (Array.isArray(renderFusions)) {
    renderFusions.forEach((fusion, fi) => {
      // Determine LEFT (OLT-source) and RIGHT (destination) for the fusion
      // El flujo siempre va desde el hilo del lado de la OLT hacia el otro lado
      // No importa el orden en que el usuario hizo clic para crear la fusion
      var leftCableId = null, rightCableId = null;
      var leftFiberNum = null, rightFiberNum = null;
      
      var connIn = fusion.cable_connection_id_in;
      var connOut = fusion.cable_connection_id_out;
      var fIn = parseInt(fusion.fiber_in);
      var fOut = parseInt(fusion.fiber_out);
      
      // Determinar lado izquierdo usando source_conn_id guardado en DB
      // El backend guarda qué lado tiene la fuente OLT al crear la fusion
      var pointIn = null, pointOut = null;
      if (state._cablePoints) {
        pointIn = state._cablePoints.find(function(p) { return p.id == connIn; });
        pointOut = state._cablePoints.find(function(p) { return p.id == connOut; });
      }
      var cableIdIn = pointIn ? pointIn.cable_id : null;
      var cableIdOut = pointOut ? pointOut.cable_id : null;
      var mismoCable = cableIdIn && cableIdOut && cableIdIn === cableIdOut;
      
      // Dirección del data-flow:
      // 1. _cablePairLeft nos dice QUÉ lado es el ORIGEN (izquierda)
      // 2. Si connIn es LEFT → flujo de connIn a connOut
      // 3. Si connOut es LEFT → flujo de connOut a connIn
      // 4. Si no hay _cablePairLeft, usar _cablePairRight (cuál es SALIDA)
      // 5. Si connIn es RIGHT → connOut es origen
      // 6. Si connOut es RIGHT → connIn es origen
      if (_cablePairLeft && _cablePairLeft[connIn]) {
        // connIn es LEFT (origen)
        leftCableId = connIn; leftFiberNum = fIn;
        rightCableId = connOut; rightFiberNum = fOut;
      } else if (_cablePairLeft && _cablePairLeft[connOut]) {
        // connOut es LEFT (origen)
        leftCableId = connOut; leftFiberNum = fOut;
        rightCableId = connIn; rightFiberNum = fIn;
      } else if (_cablePairRight && _cablePairRight[connIn]) {
        // connIn es RIGHT (salida) → connOut es origen
        leftCableId = connOut; leftFiberNum = fOut;
        rightCableId = connIn; rightFiberNum = fIn;
      } else if (_cablePairRight && _cablePairRight[connOut]) {
        // connOut es RIGHT (salida) → connIn es origen
        leftCableId = connIn; leftFiberNum = fIn;
        rightCableId = connOut; rightFiberNum = fOut;
      } else if (typeof _activePowerMap !== 'undefined' && _activePowerMap[connIn] && _activePowerMap[connIn][fIn] && _activePowerMap[connOut] && _activePowerMap[connOut][fOut]) {
        // Ambos tienen potencia: usar _cablePairLeft (o secuencia como fallback)
        if (_cablePairLeft && _cablePairLeft[connIn]) {
          leftCableId = connIn; leftFiberNum = fIn;
          rightCableId = connOut; rightFiberNum = fOut;
        } else if (_cablePairLeft && _cablePairLeft[connOut]) {
          leftCableId = connOut; leftFiberNum = fOut;
          rightCableId = connIn; rightFiberNum = fIn;
        } else if (_cablePairRight && _cablePairRight[connIn]) {
          leftCableId = connOut; leftFiberNum = fOut;
          rightCableId = connIn; rightFiberNum = fIn;
        } else if (_cablePairRight && _cablePairRight[connOut]) {
          leftCableId = connIn; leftFiberNum = fIn;
          rightCableId = connOut; rightFiberNum = fOut;
        } else if (pointIn && pointOut) {
          // Fallback: secuencia menor = mas cerca de OLT
          if (parseInt(pointIn.sequence) <= parseInt(pointOut.sequence)) {
            leftCableId = connIn; leftFiberNum = fIn;
            rightCableId = connOut; rightFiberNum = fOut;
          } else {
            leftCableId = connOut; leftFiberNum = fOut;
            rightCableId = connIn; rightFiberNum = fIn;
          }
        } else {
          leftCableId = connIn; leftFiberNum = fIn;
          rightCableId = connOut; rightFiberNum = fOut;
        }
      } else if (typeof _activePowerMap !== 'undefined' && _activePowerMap[connIn] && _activePowerMap[connIn][fIn]) {
        leftCableId = connIn; leftFiberNum = fIn;
        rightCableId = connOut; rightFiberNum = fOut;
      } else if (typeof _activePowerMap !== 'undefined' && _activePowerMap[connOut] && _activePowerMap[connOut][fOut]) {
        leftCableId = connOut; leftFiberNum = fOut;
        rightCableId = connIn; rightFiberNum = fIn;
      } else if (_oltHilosFuente && _oltHilosFuente[cableIdIn] && _oltHilosFuente[cableIdIn][fIn]) {
        leftCableId = connIn; leftFiberNum = fIn;
        rightCableId = connOut; rightFiberNum = fOut;
      } else if (_oltHilosFuente && _oltHilosFuente[cableIdOut] && _oltHilosFuente[cableIdOut][fOut]) {
        leftCableId = connOut; leftFiberNum = fOut;
        rightCableId = connIn; rightFiberNum = fIn;
      } else {
        // Fallback: connIn a la izquierda
        leftCableId = connIn; leftFiberNum = fIn;
        rightCableId = connOut; rightFiberNum = fOut;
      }
      
      console.log('[FUSION-DIR] fusion #' + fusion.id + ' IN=' + connIn + '#' + fIn + ' OUT=' + connOut + '#' + fOut + ' left=' + leftCableId + '#' + leftFiberNum + ' right=' + rightCableId + '#' + rightFiberNum + ' pairRight[in]=' + (_cablePairRight ? _cablePairRight[connIn] : 'N/A') + ' pairRight[out]=' + (_cablePairRight ? _cablePairRight[connOut] : 'N/A') + ' pairLeft[in]=' + (_cablePairLeft ? _cablePairLeft[connIn] : 'N/A') + ' pairLeft[out]=' + (_cablePairLeft ? _cablePairLeft[connOut] : 'N/A') + ' activeIn=' + (typeof _activePowerMap !== 'undefined' && !!_activePowerMap[connIn]) + ' activeOut=' + (typeof _activePowerMap !== 'undefined' && !!_activePowerMap[connOut]));
      const srcCD = cableFiberData.find(cd => cd.cableConnectionId == leftCableId);
      const tgtCD = cableFiberData.find(cd => cd.cableConnectionId == rightCableId);
      
      if (!srcCD || !tgtCD) return;
      
      const srcBlockIdx = cableFiberData.indexOf(srcCD);
      const tgtBlockIdx = cableFiberData.indexOf(tgtCD);
      
      const srcBlockTop = 60 + srcBlockIdx * (blockH + 20);
      const tgtBlockTop = 60 + tgtBlockIdx * (blockH + 20);
      
      const maxFibersSrc = Math.min(srcCD.fibers.length || srcCD.fiberCount, 24);
      const maxFibersTgt = Math.min(tgtCD.fibers.length || tgtCD.fiberCount, 24);
      const fSpacingSrc = (blockH - 36) / maxFibersSrc;
      const fSpacingTgt = (blockH - 36) / maxFibersTgt;
      
      const srcFiberNum = leftFiberNum;
      const tgtFiberNum = rightFiberNum;
      
      const srcY = srcBlockTop + 34 + (Math.min(srcFiberNum, maxFibersSrc) - 1) * fSpacingSrc + 4;
      const tgtY = tgtBlockTop + 34 + (Math.min(tgtFiberNum, maxFibersTgt) - 1) * fSpacingTgt + 4;
      
      // Animación SIEMPRE hacia la DERECHA (como la OLT)
      // x1 = borde derecho del bloque izquierdo, x4 = borde izquierdo del bloque derecho
      const x1 = leftStartX + leftCableBlockW;
      const x4 = rightStartX;
      
      // Calculate bezier control points (gentle curves)
      const midX = (x1 + x4) / 2;
      const cpOffsetX = (x4 - x1) * 0.3;
      
      const colorIn = tiaColor(srcFiberNum);
      const colorOut = tiaColor(tgtFiberNum);
      console.log('[FUSION-DIR] COLOR: fusion=' + fusion.id + ' srcFib=' + srcFiberNum + '(' + colorIn + ') -> tgtFib=' + tgtFiberNum + '(' + colorOut + ') x1=' + x1 + ' x4=' + x4 + ' midX=' + midX);
      const loss = parseFloat(fusion.loss_db) || 0.01;
      
      // Check if fiber has active power: via _activePowerMap (propagated from OLT through fusions)
      // or fallback to fusion.active_power field
      const srcHasPower = typeof _activePowerMap !== 'undefined' && _activePowerMap[leftCableId] && _activePowerMap[leftCableId][srcFiberNum];
      const tgtHasPower = typeof _activePowerMap !== 'undefined' && _activePowerMap[rightCableId] && _activePowerMap[rightCableId][tgtFiberNum];
      const hasActivePower = srcHasPower || tgtHasPower || (fusion.active_power === true || fusion.active_power === 1 || fusion.active_power === '1');
      let powerLevel = fusion.power_level;
      // If no power_level on fusion but we know it has power, use a default OLT power level
      if (hasActivePower && (powerLevel === null || powerLevel === undefined)) {
        powerLevel = 9.4; // Default OLT power level for animation display
      }
      
      // Determine power badge class
      let powerTextClass = '';
      if (hasActivePower && powerLevel !== null) {
        if (powerLevel >= -20) { powerTextClass = 'power-text-good'; }
        else if (powerLevel >= -25) { powerTextClass = 'power-text-warn'; }
        else { powerTextClass = 'power-text-bad'; }
      }
      
      // Only add glow if fiber has active power (no dash animation - dots pulse instead)
      const activeClass = hasActivePower ? 'data-flow' : '';
      const lineOpacity = hasActivePower ? '0.85' : '0.5';
      const fusionIdAttr = `data-fusion="${fusion.id}"`;
      const fiberInAttr = `data-fiber-in="${srcFiberNum}"`;
      const fiberOutAttr = `data-fiber-out="${tgtFiberNum}"`;
      const connInAttr = `data-conn-in="${fusion.cable_connection_id_in}"`;
      const connOutAttr = `data-conn-out="${fusion.cable_connection_id_out || ''}"`;
      
      // Determine line color: single or gradient
      let gradientId = '';
      let strokeValue = '';
      if (colorIn === colorOut) {
        // Same color: use single stroke
        strokeValue = colorIn;
      } else {
        // Different colors: create linear gradient
        gradientId = `grad-${fusion.id}`;
        const gradAttr = `<linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${colorIn}" stop-opacity="1" />
          <stop offset="50%" stop-color="${colorIn}" stop-opacity="1" />
          <stop offset="50%" stop-color="${colorOut}" stop-opacity="1" />
          <stop offset="100%" stop-color="${colorOut}" stop-opacity="1" />
        </linearGradient>`;
        // Add gradient to SVG defs
        if (!svgDefs.includes(gradientId)) {
          svgDefs += gradAttr;
        }
        strokeValue = `url(#${gradientId})`;
      }
      
      // Draw bezier curve for the fusion
      const arrowMarker = hasActivePower ? ' marker-end="url(#flow-arrow)"' : '';
      svgLines += `<path class="fl ${activeClass}" d="M ${x1},${srcY} C ${x1 + cpOffsetX},${srcY} ${x4 - cpOffsetX},${tgtY} ${x4},${tgtY}" stroke="${strokeValue}" stroke-width="2.5" opacity="${lineOpacity}" fill="none"${arrowMarker} ${fusionIdAttr} ${fiberInAttr} ${fiberOutAttr} ${connInAttr} ${connOutAttr} data-fiber-color-in="${colorIn}" data-fiber-color-out="${colorOut}" data-fiber-color="${colorIn}" data-active="${hasActivePower ? 'true' : 'false'}" data-fusion-power="${hasActivePower && powerLevel !== null ? powerLevel.toFixed(1) : ''}" data-fiber-name="${tiaColorName(srcFiberNum) || '—'}" />`;
      // Fusion dot at midpoint (bicolor if colors differ)
      const dotR = hasActivePower ? 6 : 4;
      const dotClass = hasActivePower ? 'fl-dot active-dot' : 'fl-dot';
      if (colorIn === colorOut) {
        svgLines += `<circle class="${dotClass}" cx="${midX}" cy="${(srcY + tgtY) / 2}" r="${dotR}" fill="${colorIn}" stroke="#fff" stroke-width="1.5" opacity="0.9" ${fusionIdAttr} />`;
      } else {
        // Bicolor dot: left half IN, right half OUT
        svgLines += `<circle class="${dotClass}" cx="${midX}" cy="${(srcY + tgtY) / 2}" r="${dotR}" fill="${colorIn}" stroke="#fff" stroke-width="1.5" opacity="0.9" ${fusionIdAttr} />`;
        svgLines += `<path d="M ${midX + 1},${(srcY + tgtY) / 2 - dotR} A ${dotR} ${dotR} 0 0 1 ${midX + 1},${(srcY + tgtY) / 2 + dotR}" fill="${colorOut}" opacity="0.5" />`;
      }
      
      // ✂️ Break fusion icon — directly on the fusion dot
      const mx = midX;
      const my = (srcY + tgtY) / 2;
      svgLines += `<g style="cursor:pointer" onclick="confirmBreakFusion(${fusion.id})" class="break-fusion-btn" data-fusion="${fusion.id}">`;
      svgLines += `<rect x="${mx - 20}" y="${my - 10}" width="40" height="20" rx="6" fill="rgba(200,50,50,0.12)" stroke="rgba(200,50,50,0.35)" stroke-width="1" />`;
      svgLines += `<text x="${mx}" y="${my + 4}" text-anchor="middle" fill="#e94560" font-family="sans-serif" font-size="13" font-weight="bold">✂️</text>`;
      svgLines += `</g>`;

    });
  }
  
  // ====== SPLITTER SECTION (multiple splitters, stacked vertically) ======
  const splitterX = (leftStartX + leftCableBlockW + rightStartX) / 2;
  
  splitters.forEach((sp, spIdx) => {
    const lastCableBlockIdx = cableFiberData.length - 1;
    const lastBlockTop = 60 + lastCableBlockIdx * (blockH + 20);
    const spY = Math.min(lastBlockTop + blockH + 60 + spIdx * 200, h - 60 + spIdx * 200);
    const spName = sp.splitter_name || 'Splitter';
    const spRatio = sp.splitter_type_name || `1:${sp.ports_count || 16}`;
    const spLoss = sp.loss_db || (sp.splitter_loss || 13.8);
    const spOutputs = sp.ports_count || 8;
    const maxOutDisplay = Math.min(spOutputs, 24);
    
    // Find manga_fibers that belong to this splitter
    // For manga splitters, match by splitter_id; for NAP splitters, match by source_type+source_id
    const splitterInputFibers = fibers.filter(f => 
      (f.splitter_id == sp.id || (isNap && f.source_type === 'nap' && f.source_id == mangaId)) && f.splitter_output == 0);
    const splitterOutputFibers = fibers.filter(f => 
      (f.splitter_id == sp.id || (isNap && f.source_type === 'nap' && f.source_id == mangaId)) && f.splitter_output > 0)
      .sort((a,b) => (a.splitter_output||0) - (b.splitter_output||0));
    
    // === SPLITTER BLOCK DIMENSIONS ===
    const spBlockW = 220;
    const spBlockH = Math.max(60, 20 + maxOutDisplay * 20);
    const spBlockX = splitterX - spBlockW / 2;
    const spBlockY = spY - spBlockH / 2;
    
    // === Check saved flip orientation for this splitter ===
    const blockKey = (isNap ? 'nap' : 'manga') + ':' + mangaId;
    const splitterBlockIdx = 'splitter-' + sp.id;
    const savedSplitterPos = _blockPositions[blockKey]?.[splitterBlockIdx];
    const splitterFlipped = savedSplitterPos?.flipped === true;
    
    // === SPLITTER BLOCK (draggable vis-block) ===
    svgLines += `<g class="vis-block" transform="translate(0,0)" data-block-idx="splitter-${sp.id}" data-splitter-id="${sp.id}" data-flipped="${splitterFlipped}">`;
    
    // === TRIANGLE dimensions ===
    const tipX = splitterFlipped ? (spBlockX + spBlockW) : spBlockX;
    const baseX = splitterFlipped ? spBlockX : (spBlockX + spBlockW);
    const midY = spBlockY + spBlockH / 2;
    const triPoints = splitterFlipped
      ? (spBlockX + spBlockW) + ',' + midY + ' ' + spBlockX + ',' + spBlockY + ' ' + spBlockX + ',' + (spBlockY + spBlockH)
      : spBlockX + ',' + midY + ' ' + (spBlockX + spBlockW) + ',' + spBlockY + ' ' + (spBlockX + spBlockW) + ',' + (spBlockY + spBlockH);
    
    // Triangle enclosure
    svgLines += `<polygon points="${triPoints}" fill="#1a1a2e" stroke="#533483" stroke-width="2.5" class="block-header" style="cursor:grab" />`;
    
    // Splitter label inside triangle
    const labelX = splitterFlipped ? (spBlockX + spBlockW * 0.3) : (spBlockX + spBlockW * 0.7);
    svgLines += `<text x="${labelX}" y="${spBlockY + 20}" text-anchor="middle" fill="#e94560" font-family="sans-serif" font-size="12" font-weight="bold">🔀 ${spName}</text>`;
    svgLines += `<text x="${labelX}" y="${spBlockY + 35}" text-anchor="middle" fill="#aaa" font-family="sans-serif" font-size="10">${spRatio} · ${spLoss}dB</text>`;
    
    // ⭐ Indicador de ORIENTACIÓN en el centro del triángulo
    // Muestra ▶ cuando apunta a la derecha, ◀ cuando apunta a la izquierda
    const orientX = spBlockX + spBlockW / 2;
    const orientY = midY;
    const orientChar = splitterFlipped ? '◀' : '▶';
    const orientTooltip = splitterFlipped ? '← Apunta a la IZQUIERDA' : '→ Apunta a la DERECHA';
    // Badge de fondo
    svgLines += `<circle cx="${orientX}" cy="${orientY}" r="14" fill="rgba(83,52,131,0.5)" stroke="${splitterFlipped ? '#ff6b6b' : '#00ff88'}" stroke-width="2" orient-role="orient-bg" />`;
    svgLines += `<text x="${orientX}" y="${orientY + 5}" text-anchor="middle" fill="${splitterFlipped ? '#ff6b6b' : '#00ff88'}" font-family="sans-serif" font-size="16" font-weight="bold" orient-role="orient-char">${orientChar}</text>`;
    svgLines += `<title>${orientTooltip}</title>`;
    
    // === INPUT PORT at the tip (pigtail style like cable fibers) ===
    const inputPortY = midY;
    const inputPortX = tipX;
    const inputCol = tiaColor(1);
    const inputBorder = (inputCol === '#ffffff' || inputCol === '#f5d442') ? '#888' : inputCol;
    
    // Find manga fiber for input BEFORE rendering jacket (needed for power check)
    const inputMangaFiberId = splitterInputFibers[0]?.id;
    const inputHasFusion = (
      (Array.isArray(mangaSplices) && inputMangaFiberId && mangaSplices.some(s =>
        (s.fiber_a_type === 'manga_fiber' && s.fiber_a_id === inputMangaFiberId) ||
        (s.fiber_b_type === 'manga_fiber' && s.fiber_b_id === inputMangaFiberId)
      ))
    );
    var inputHasActivePower = splitterInputFibers[0] && (splitterInputFibers[0].active_power === 1 || splitterInputFibers[0].active_power === true || splitterInputFibers[0].active_power === '1');
    var inputPowerClass = !inputHasFusion && inputHasActivePower ? ' fiber-powered' : '';
    
    // Pigtail jacket pointing INTO the triangle
    const jacketW = 20;
    const jacketH = 12;
    const inJacketX = splitterFlipped ? (inputPortX - jacketW - 4) : (inputPortX + 4);
    const inJacketY = inputPortY - jacketH / 2;
    
    // ⭐ FIX: meter chaqueta, core y ferrule DENTRO del fiber-dot-group
    // para que toggleSplitterBlockSide los mire correctamente al voltear
    const inDotClass = 'fiber-dot-group' + (inputHasFusion ? ' fiber-connected' : '');
    const inDotCursor = inputHasFusion ? 'default' : 'pointer';
    svgLines += `<g class="${inDotClass}" style="cursor:${inDotCursor}">`;
    svgLines += `<rect x="${inJacketX}" y="${inJacketY}" width="${jacketW}" height="${jacketH}" rx="3" fill="${inputCol}" stroke="${inputBorder}" stroke-width="1.5" class="fiber-jacket${inputPowerClass}" />`;
    svgLines += `<circle cx="${inJacketX + jacketW/2}" cy="${inputPortY}" r="4" fill="#fff" opacity="0.9" />`;
    svgLines += `<rect x="${inputPortX - 3}" y="${inputPortY - 5}" width="8" height="10" rx="2" fill="#888" stroke="#666" stroke-width="1" opacity="0.9" />`;
    if (!inputHasFusion && inputHasActivePower) {
      svgLines += `<text x="${splitterFlipped ? inputPortX - 30 : inputPortX + 24}" y="${inputPortY + 4}" fill="#00ff88" font-family="sans-serif" font-size="10" font-weight="bold">⚡ entrada</text>`;
    }
    svgLines += `<rect x="${inputPortX - 18}" y="${inputPortY - 18}" width="36" height="36" rx="4" fill="transparent" class="fiber-dot-inner" 
      data-original-stroke="${inputBorder}" data-splitter-id="${sp.id}" data-splitter-output="0" 
      data-side="splitter-in" data-has-fusion="${inputHasFusion}" data-has-power="${(splitterInputFibers[0]?.active_power) || false}" 
      data-fiber-num="${splitterInputFibers[0]?.fiber_number || 0}" 
      data-manga-fiber-id="${inputMangaFiberId || ''}" />`;
    svgLines += `</g>`;
    
    // === OUTPUT PORTS along the base (pigtail style, same as cable fibers) ===
    const outStartY = spBlockY + 40;
    const outSpacing = (spBlockH - 50) / Math.max(maxOutDisplay, 1);
    const outPortX = baseX;
    
    for (let i = 1; i <= maxOutDisplay; i++) {
      const py = outStartY + (i - 1) * outSpacing;
      const col = tiaColor(i);
      const borderCol = (col === '#ffffff' || col === '#f5d442') ? '#888' : col;
      
      // Find the manga_fiber for this splitter output
      const outFiber = splitterOutputFibers.find(f => f.splitter_output == i);
      const fiberNum = outFiber?.fiber_number || i;
      const outMangaFiberId = outFiber?.id;
      
      // Check if this output already has a splice connection
      const outHasFusion = outMangaFiberId && Array.isArray(mangaSplices) && mangaSplices.some(s =>
        (s.fiber_a_type === 'manga_fiber' && parseInt(s.fiber_a_id) === outMangaFiberId) ||
        (s.fiber_b_type === 'manga_fiber' && parseInt(s.fiber_b_id) === outMangaFiberId)
      );
      
      // Pigtail fiber: jacket pointing OUT of the base
      const outJacketW = 20;
      const outJacketH = 12;
      const outJacketX = splitterFlipped ? (outPortX + 4) : (outPortX - outJacketW - 4);
      const outJacketY = py - outJacketH / 2;
      
      const outDotClass = 'fiber-dot-group' + (outHasFusion ? ' fiber-connected' : '');
      const outDotCursor = outHasFusion ? 'default' : 'pointer';
      svgLines += `<g class="${outDotClass}" style="cursor:${outDotCursor}">`;
      // Jacket (colored)
      svgLines += `<rect x="${outJacketX}" y="${outJacketY}" width="${outJacketW}" height="${outJacketH}" rx="3" fill="${col}" stroke="${borderCol}" stroke-width="1.5" class="fiber-jacket" />`;
      // Core
      svgLines += `<circle cx="${outJacketX + outJacketW/2}" cy="${py}" r="4" fill="#fff" opacity="0.9" />`;
      // Ferrule at the port
      svgLines += `<rect x="${outPortX - 3}" y="${py - 5}" width="8" height="10" rx="2" fill="#888" stroke="#666" stroke-width="1" opacity="0.9" />`;
      
      // Port number label (inside the jacket area)
      const labelX = splitterFlipped ? (outJacketX + outJacketW + 6) : (outJacketX - 18);
      svgLines += `<text x="${labelX}" y="${py + 3}" fill="#aaa" font-family="sans-serif" font-size="8" pointer-events="none">${String(i).padStart(2, '0')}\</text>`;
      
      // Power / client labels
      if (outFiber?.active_power) {
        const pwrX = splitterFlipped ? (outJacketX + outJacketW + 24) : (outJacketX - 46);
        svgLines += `<text x="${pwrX}" y="${py + 2}" fill="#00ff88" font-family="sans-serif" font-size="8" pointer-events="none">⚡${outFiber.power_level?.toFixed(1) || '?'}dBm\</text>`;
      }
      
      // Transparent clickable rect
      svgLines += `<rect x="${outPortX - 18}" y="${py - 18}" width="36" height="36" rx="4" fill="transparent" class="fiber-dot-inner" 
        data-original-stroke="${borderCol}" data-splitter-id="${sp.id}" data-splitter-output="${i}" 
        data-fiber-num="${fiberNum}" data-manga-fiber-id="${outMangaFiberId || ''}" 
        data-side="splitter-out" data-has-fusion="${outHasFusion}" data-has-power="${outFiber?.active_power || false}" />`;
      svgLines += `</g>`;
    }
    
    // === SPLITTER TOOLBAR (centered inside triangle) ===
    const btnCenterX = spBlockX + spBlockW / 2;
    const btnY = spBlockY + spBlockH - 34;
    svgLines += `<g class="splitter-btn" style="cursor:pointer" onclick="addMangaSplitter(${mangaId})">`;
    svgLines += `<rect x="${btnCenterX - 36}" y="${btnY}" width="22" height="22" rx="4" fill="#3a3f4b" stroke="#555" stroke-width="1" />`;
    svgLines += `<text x="${btnCenterX - 25}" y="${btnY + 15}" text-anchor="middle" fill="#00d4ff" font-family="sans-serif" font-size="12">⚙</text>`;
    svgLines += `</g>`;
    
    svgLines += `<g class="splitter-btn" style="cursor:pointer" onclick="deleteMangaSplitter(${mangaId}, ${sp.id})">`;
    svgLines += `<rect x="${btnCenterX - 11}" y="${btnY}" width="22" height="22" rx="4" fill="#3a3f4b" stroke="#555" stroke-width="1" />`;
    svgLines += `<text x="${btnCenterX}" y="${btnY + 15}" text-anchor="middle" fill="#e94560" font-family="sans-serif" font-size="12">🗑</text>`;
    svgLines += `</g>`;
    
    // Flip button
    svgLines += `<g class="splitter-btn flip-side-btn" style="cursor:pointer" onclick="toggleBlockSide('splitter-${sp.id}')">`;
    svgLines += `<rect x="${btnCenterX + 14}" y="${btnY}" width="22" height="22" rx="4" fill="#3a3f4b" stroke="#555" stroke-width="1" />`;
    svgLines += `<text x="${btnCenterX + 25}" y="${btnY + 15}" text-anchor="middle" fill="#00d4ff" font-family="sans-serif" font-size="12">🔄</text>`;
    svgLines += `</g>`;
    
    svgLines += `</g>`; // end vis-block
    
    // === FUSION LINES: Splitter connections (via splices) are handled below ===
    
    console.log('[VIS] Rendering splices:', Array.isArray(mangaSplices) ? mangaSplices.length : 'no data');
    // === DRAW SPLICE CONNECTIONS (splitter fiber ↔ cable fiber) ===
    if (Array.isArray(mangaSplices) && mangaSplices.length > 0) {
      mangaSplices.forEach(splice => {
        // Determine which side is manga_fiber (splitter) and which is cable_fiber
        const isMangaFirst = splice.fiber_a_type === 'manga_fiber';
        const mangaInfo = isMangaFirst 
          ? { id: splice.fiber_a_id, port: splice.fiber_a_port }
          : { id: splice.fiber_b_id, port: splice.fiber_b_port };
        const cableInfo = isMangaFirst
          ? { connId: splice.fiber_b_id, port: splice.fiber_b_port }
          : { connId: splice.fiber_a_id, port: splice.fiber_a_port };
        
        // Find the manga_fiber to get the splitter output index
        const mf = fibers.find(f => f.id == mangaInfo.id);
        if (!mf) {
          return;
        }
        const splitterOutIdx = mf.splitter_output || 0;
        
        // Find the cable connection
        const cd = cableFiberData.find(c => c.cableConnectionId == cableInfo.connId);
        if (!cd) {
          return;
        }
        
        const cableIdx = cableFiberData.indexOf(cd);
        const blockTop = 60 + cableIdx * (blockH + 20);
        const maxFibers = Math.min(cd.fibers.length || cd.fiberCount, 24);
        // ⭐ FIX: usar MISMA fórmula que fusiones (blockH - 36) / maxFibers
        // así el punto de conexión del splice coincide exactamente con
        // la posición del puerto de fibra en el bloque de cable
        const fSpacing = (blockH - 36) / maxFibers;
        const cableFiberNum = cableInfo.port;
        const cableY = blockTop + 34 + (Math.min(cableFiberNum, maxFibers) - 1) * fSpacing + 4;
        
        // Determine which SIDE the cable fiber is on (LEFT or RIGHT block)
        // ⭐ FIX: usar _cablePairLeft/_cablePairRight como lo hacen las fusiones,
        // en lugar de asumir basado en splitterFlipped
        const cableIsLeft = _cablePairLeft && _cablePairLeft[cableInfo.connId];
        const cableIsRight = _cablePairRight && _cablePairRight[cableInfo.connId];
        
        let fromX, fromY, toX, toY, lineColor, colIn, colOut, strokeVal;
        
        if (splitterOutIdx === 0) {
          // Splitter INPUT connection: cable → splitter
          // La línea viene DESDE el cable (del lado donde esté) HACIA el tip del splitter
          if (cableIsRight) {
            fromX = rightStartX;
          } else {
            fromX = leftStartX + leftCableBlockW;
          }
          toX = inputPortX;
          fromY = cableY;
          toY = inputPortY;
          colIn = tiaColor(cableFiberNum);
          colOut = '#ffffff';
          let gradId = '';
          strokeVal = '';
          if (colIn === colOut) {
            strokeVal = colIn;
          } else {
            gradId = 'grad-splice-in-' + splice.id;
            var gradAttr = '<linearGradient id="' + gradId + '" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="' + colIn + '" stop-opacity="1" /><stop offset="50%" stop-color="' + colIn + '" stop-opacity="1" /><stop offset="50%" stop-color="' + colOut + '" stop-opacity="1" /><stop offset="100%" stop-color="' + colOut + '" stop-opacity="1" /></linearGradient>';
            if (svgDefs.indexOf(gradId) === -1) {
              svgDefs += gradAttr;
            }
            strokeVal = 'url(#' + gradId + ')';
          }
        } else {
          // Splitter OUTPUT connection: splitter → cable
          // La línea viene DESDE la base del splitter HACIA el cable (del lado donde esté)
          const outIdx = Math.min(splitterOutIdx, maxOutDisplay) - 1;
          fromY = outStartY + outIdx * outSpacing;
          toY = cableY;
          if (cableIsLeft) {
            // Cable está en LEFT → conectar al left block
            fromX = outPortX - 8;
            toX = leftStartX + leftCableBlockW;
          } else {
            // Cable está en RIGHT (o no determinado) → conectar al right block
            fromX = outPortX + 8;
            toX = rightStartX;
          }
          colIn = tiaColor(cableFiberNum);
          colOut = tiaColor(splitterOutIdx);
          let gradId = '';
          strokeVal = '';
          if (colIn === colOut) {
            strokeVal = colIn;
          } else {
            gradId = 'grad-splice-' + splice.id;
            var gradAttr = '<linearGradient id="' + gradId + '" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="' + colOut + '" stop-opacity="1" /><stop offset="50%" stop-color="' + colOut + '" stop-opacity="1" /><stop offset="50%" stop-color="' + colIn + '" stop-opacity="1" /><stop offset="100%" stop-color="' + colIn + '" stop-opacity="1" /></linearGradient>';
            if (svgDefs.indexOf(gradId) === -1) {
              svgDefs += gradAttr;
            }
            strokeVal = 'url(#' + gradId + ')';
          }
        }
        
        const cpOff = (toX - fromX) * 0.3;
        const hasPower = mf.active_power && mf.power_level !== null;
        const activeClass = hasPower ? 'data-flow' : '';
        
        const arrowMarker2 = hasPower ? ' marker-end="url(#flow-arrow)"' : '';
        svgLines += `<path class="fl ${activeClass}" d="M ${fromX},${fromY} C ${fromX + cpOff},${fromY} ${toX - cpOff},${toY} ${toX},${toY}" 
          stroke="${strokeVal}" stroke-width="3.5" opacity="${hasPower ? '1' : '0.8'}" fill="none"${arrowMarker2}
          data-splice="${splice.id}" data-fiber-in="${cableFiberNum}" data-fiber-out="${mf.fiber_number || ''}"
          data-fiber-color-in="${colIn}" data-fiber-color-out="${colOut}"
          data-conn-in="${cableInfo.connId}" data-conn-out="${splice.fiber_a_type === 'manga_fiber' ? splice.fiber_a_id : splice.fiber_b_id || ''}"
          data-fusion-power="${hasPower && mf.power_level !== null ? mf.power_level : ''}" />`;
        
        
        // ✂️ Break splice button at midpoint (like cable fusions)
        var midX = (fromX + toX) / 2;
        var midY = (fromY + toY) / 2;
        svgLines += '<g style="cursor:pointer" onclick="deleteSpliceThenRefresh(' + splice.id + ')" class="break-fusion-btn" data-splice="' + splice.id + '" data-fiber-out="' + (mf.fiber_number || '') + '">';
        svgLines += '<rect x="' + (midX - 20) + '" y="' + (midY - 10) + '" width="40" height="20" rx="6" fill="rgba(200,50,50,0.12)" stroke="rgba(200,50,50,0.35)" stroke-width="1" />';
        svgLines += '<text x="' + midX + '" y="' + (midY + 4) + '" text-anchor="middle" fill="#e94560" font-family="sans-serif" font-size="13" font-weight="bold">\u2702\uFE0F</text>';
        svgLines += '</g>';
      });
    }
    
    // === MARK CONNECTED PORTS (no guide lines) ===
  });
  
  // ====== FINALIZE SVG with proper viewBox and scroll wrapper ======
  const svgContent = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMinYMin meet" style="background:#555;border-radius:8px;min-width:${w}px;"><defs>${svgDefs}</defs>${svgLines}</svg>`;
  
  swapSvgRender('vis-svg', svgContent, w, h);
  document.getElementById('vis-panel').classList.remove('hidden');
  
  // Init block dragging for movable cable blocks
  setTimeout(initBlockDrag, 50);
  // Restore saved block positions after render + drag init
  setTimeout(restoreBlockPositions, 150);
  
  // ⭐ Actualizar TODAS las líneas (fusiones + splices) inmediatamente
  // desde el DOM, igual que lo hacen las fusiones fibra→fibra.
  // Esto asegura que los splices se dibujen con las posiciones reales
  // de los puertos, sin depender de cálculos de LEFT/RIGHT.
  setTimeout(function() {
    const newSvgEl = document.querySelector('#vis-svg svg');
    if (newSvgEl && typeof _updateFusionBlockFn === 'function') {
      newSvgEl.querySelectorAll('.vis-block').forEach(function(b) {
        _updateFusionBlockFn(b);
      });
    }
  }, 30);
  
  // ====== HILOS CON POTENCIA: aplicar animación dinámica ======
  (async function aplicarAnimacionHilosManga() {
    try {
      var hilosRes = await fetch(API + '/olts/hilos-con-potencia');
      var hilosData = await hilosRes.json();
      if (!hilosData.fuentes || hilosData.fuentes.length === 0) return;
      
      // Build map: cableId → [hilo_numbers with power]
      // Solo hilos FUENTE (directamente desde OLT), no heredados
      var hilosPower = {};
      hilosData.fuentes.forEach(function(h) {
        if (!hilosPower[h.fibra_id]) hilosPower[h.fibra_id] = {};
        hilosPower[h.fibra_id][h.hilo_numero] = true;
      });
      _oltHilosFuente = hilosPower;
      
      // Apply pulse to SVG fibers that match powered hilos
      var svgEl = document.querySelector('#vis-svg svg');
      if (!svgEl) return;
      
      cableFiberData.forEach(function(cd) {
        var cableHilos = hilosPower[cd.cableId];
        if (!cableHilos) return;
        
        // Solo aplicar animacion a los hilos de ESTE cable (cd.cableConnectionId)
        var connId = String(cd.cableConnectionId);
        
        Object.keys(cableHilos).forEach(function(hiloNum) {
          // 1. Pulse .fiber-dot-inner elements (pass-through blocks) — solo de ESTE cable
          var dots = svgEl.querySelectorAll('.fiber-dot-inner[data-fiber-num="' + hiloNum + '"][data-cable-conn="' + connId + '"]');
          dots.forEach(function(dot) {
            dot.classList.add('active-pulse');
            var parentG = dot.closest('.fiber-dot-group');
            if (parentG) {
              var jacket = parentG.querySelector('.fiber-jacket');
              if (jacket) jacket.classList.add('active-pulse');
            }
          });
          
          // 2. Pulse termination dots — solo de ESTE cable
          var termDots = svgEl.querySelectorAll('circle[data-side="term"][data-fiber-num="' + hiloNum + '"][data-cable-conn="' + connId + '"]');
          termDots.forEach(function(dot) {
            dot.classList.add('active-pulse');
            var g = dot.closest('.fiber-dot-group, g');
            if (g) {
              var line = g.querySelector('line');
              if (line) line.classList.add('active-pulse');
              var rectEl = g.querySelector('rect');
              if (rectEl) rectEl.classList.add('active-pulse');
            }
          });
          
          // 3. Pulse fusion lines — data-flow style (excluye splices de splitter)
          var fusionPathsIn = svgEl.querySelectorAll('.fl[data-fiber-in="' + hiloNum + '"][data-conn-in="' + connId + '"]:not([data-splice])');
          fusionPathsIn.forEach(function(p) {
            p.classList.add('data-flow');
          });
          var fusionPathsOut = svgEl.querySelectorAll('.fl[data-fiber-out="' + hiloNum + '"][data-conn-out="' + connId + '"]:not([data-splice])');
          fusionPathsOut.forEach(function(p) {
            p.classList.add('data-flow');
          });
        });
        
        // 4. Update fiber labels — solo de ESTE cable
        Object.keys(cableHilos).forEach(function(hiloNum) {
          svgEl.querySelectorAll('[data-cable-conn="' + connId + '"]').forEach(function(el) {
            var g = el.closest('.fiber-dot-group, g');
            if (g) {
              var txtEl = g.querySelector('text');
              if (txtEl) {
                var txt = txtEl.textContent || '';
                if (txt.indexOf('#' + hiloNum) >= 0 && txt.indexOf('⚡') < 0) {
                  txtEl.textContent = '⚡#' + hiloNum;
                  txtEl.setAttribute('fill', '#00ff88');
                }
              }
            }
          });
        });
      });
    } catch(e) {
      // Opcional
    }
  })();
  
  // ====== SET UP SVG EVENT HANDLERS (TOMODAT-style click-to-fusion) ======
  stopFiberAnimations();
  const svgEl = document.querySelector('#vis-svg svg');
  state.fusionSelection = null;
  
  if (svgEl) {
    // --- Add selection info banner ---
    const selectionInfo = document.createElement('div');
    selectionInfo.id = 'vis-selection-info';
    selectionInfo.style.cssText = 'display:none;padding:8px 14px;background:#16213e;border:1px solid #e94560;border-radius:6px;margin:6px 0;font-size:13px;color:#e0e0e0;text-align:center;';
    const toolbar = document.getElementById('vis-splitter-info');
    if (toolbar) {
      toolbar.parentNode.insertBefore(selectionInfo, toolbar.nextSibling);
    }
    
    // Helper: remove selection highlight from all fiber dots
    function clearFiberSelection() {
      state.fusionSelection = null;
      // Remove temporary connection line if any
      if (typeof _connDrag !== 'undefined' && _connDrag && _connDrag.tempLine) {
        try { if (_connDrag.tempLine.parentNode) _connDrag.tempLine.parentNode.removeChild(_connDrag.tempLine); } catch(e) {}
        _connDrag.tempLine = null;
      }
      _connDrag = null;
      // Also remove any orphaned temp connection lines from the SVG
      svgEl.querySelectorAll('path.temp-connection-line').forEach(function(el) { el.remove(); });
      // Clear highlights
      svgEl.querySelectorAll('.fiber-dot-group.fiber-selected').forEach(g => g.classList.remove('fiber-selected'));
      svgEl.querySelectorAll('.fiber-dot-inner').forEach(function(d) {
        d.setAttribute('stroke', 'transparent');
        d.setAttribute('stroke-width', '2');
      });
      svgEl.querySelectorAll('.fiber-dot-glow').forEach(function(g) { g.remove(); });
      var info = document.getElementById('vis-selection-info');
      if (info) info.style.display = 'none';
    }
    
    // Helper: highlight a fiber dot as selected (dock-style scale + glow)
    function highlightFiberDot(el) {
      clearFiberSelection();
      
      // Add dock-style scale effect to the parent group
      const group = el.closest('.fiber-dot-group');
      if (group) group.classList.add('fiber-selected');
      
      const origStroke = el.getAttribute('data-original-stroke') || el.getAttribute('stroke');
      if (!el.getAttribute('data-original-stroke')) {
        el.setAttribute('data-original-stroke', origStroke);
      }
      
      // Glow and stroke removed — only fiber-selected class remains for hover style
      let cx, cy;
      const tag = el.tagName.toLowerCase();
      if (tag === 'circle') {
        cx = parseFloat(el.getAttribute('cx'));
        cy = parseFloat(el.getAttribute('cy'));
      } else if (tag === 'rect') {
        cx = parseFloat(el.getAttribute('x')) + parseFloat(el.getAttribute('width')) / 2;
        cy = parseFloat(el.getAttribute('y')) + parseFloat(el.getAttribute('height')) / 2;
      }
    }
    
    // --- Global click handler on SVG using event delegation ---
    svgEl.addEventListener('click', function(e) {
      // Don't cancel if clicking on a fusion path, fusion dot, button, or break-fusion button
      if (e.target.closest('.fl') || e.target.closest('.fl-dot') || e.target.closest('button') || e.target.closest('a') || e.target.closest('.break-fusion-btn')) {
        return;
      }
      
      let circle = e.target.closest('.fiber-dot-inner');
      // If click is on the scaled group (outside the small inner element), find the inner
      if (!circle) {
        const group = e.target.closest('.fiber-dot-group');
        if (group) {
          circle = group.querySelector('.fiber-dot-inner');
        }
      }
      if (!circle) {
        // Click on empty area → cancel selection
        if (state.fusionSelection) {
          clearFiberSelection();
          showToast('⚡ Selección cancelada');
        }
        return;
      }
      
      // Support both cable fibers and splitter fibers
      const cableConnId = circle.dataset.cableConn ? parseInt(circle.dataset.cableConn) : null;
      const fiberNum = circle.dataset.fiberNum ? parseInt(circle.dataset.fiberNum) : null;
      const side = circle.dataset.side;
      const splitterId = circle.dataset.splitterId ? parseInt(circle.dataset.splitterId) : null;
      const splitterOutput = circle.dataset.splitterOutput ? parseInt(circle.dataset.splitterOutput) : null;
      const mangaFiberId = circle.dataset.mangaFiberId ? parseInt(circle.dataset.mangaFiberId) : null;
      const hasFusion = circle.dataset.hasFusion === 'true';
      console.log('[MANGA-FIBER-CLICK] cableConnId=', cableConnId, 'fiberNum=', fiberNum, 'side=', side, 'hasFusion=', hasFusion);
      
      // If it's a splitter fiber without a fusion, mark as selectable
      const isSplitterFiber = splitterId !== null;
      
      // Helper to find existing connection for a fiber (cable or splitter)
      function findFiberConnection(fCableConnId, fFiberNum, fSplitterId, fSplitterOutput, fMangaFiberId) {
        // Check fusions for cable fibers
        if (fCableConnId) {
          const fusion = (Array.isArray(fusions) ? fusions : []).find(f => 
            (parseInt(f.cable_connection_id_in) === fCableConnId && parseInt(f.fiber_in) === fFiberNum) ||
            (parseInt(f.cable_connection_id_out) === fCableConnId && parseInt(f.fiber_out) === fFiberNum)
          );
          if (fusion) return { table: 'fusion', id: fusion.id, data: fusion };
        }
        // Check splices for splitter fibers
        if (fMangaFiberId) {
          const splice = (Array.isArray(mangaSplices) ? mangaSplices : []).find(s =>
            (s.fiber_a_type === 'manga_fiber' && parseInt(s.fiber_a_id) === fMangaFiberId) ||
            (s.fiber_b_type === 'manga_fiber' && parseInt(s.fiber_b_id) === fMangaFiberId)
          );
          if (splice) return { table: 'splice', id: splice.id, data: splice };
        }
        // Also check splices that reference this cable point
        if (fCableConnId) {
          const splice = (Array.isArray(mangaSplices) ? mangaSplices : []).find(s =>
            (s.fiber_a_type === 'cable_fiber' && parseInt(s.fiber_a_id) === fCableConnId && parseInt(s.fiber_a_port) === fFiberNum) ||
            (s.fiber_b_type === 'cable_fiber' && parseInt(s.fiber_b_id) === fCableConnId && parseInt(s.fiber_b_port) === fFiberNum)
          );
          if (splice) return { table: 'splice', id: splice.id, data: splice };
        }
        return null;
      }
      
      if (hasFusion) {
        // Already has a connection → show info
        const conn = findFiberConnection(cableConnId, fiberNum, splitterId, splitterOutput, mangaFiberId);
        if (conn) {
          if (conn.table === 'fusion') {
            const path = svgEl.querySelector(`.fl[data-fusion="${conn.id}"]`);
            if (path) {
              const power = path.dataset.fusionPower;
              showFusionDetail(conn.id, conn.data.fiber_in, conn.data.fiber_out, power);
            }
          } else {
            showModal('🔗 Empalme activo', `
              <p style="color:#aaa;font-size:13px">Conexión vía splice #${conn.id}</p>
              <p style="color:#888;font-size:12px;margin-top:8px">
                ${conn.data.fiber_a_type} (id:${conn.data.fiber_a_id}, puerto:${conn.data.fiber_a_port})<br>
                ↔ ${conn.data.fiber_b_type} (id:${conn.data.fiber_b_id}, puerto:${conn.data.fiber_b_port})<br>
                Pérdida: ${conn.data.loss_db || 0.1}dB
              </p>
              <button class="btn-danger" onclick="deleteSpliceThenRefresh(${conn.id})">✂️ Romper empalme</button>
              <button class="btn-secondary" onclick="closeModal()">Cerrar</button>
            `);
          }
        }
        return;
      }
      
      // --- BIDIRECTIONAL click-to-fusion (also supports splitter fibers) ---
      
      if (!state.fusionSelection) {
        // FIRST CLICK: select this fiber (cable or splitter)
        highlightFiberDot(circle);
        
        // Calculate fiber dot SVG coordinates (accounting for block transforms)
        // Get fiber dot center in SVG viewBox coords using SVG point conversion
        function getDotCenter(el) {
          var svgEl = document.querySelector('#vis-svg svg');
          if (!svgEl) return { x: 0, y: 0 };
          try {
            // Create an SVG point at the element's absolute screen position
            var rect = el.getBoundingClientRect();
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;
            // Convert screen position to SVG viewBox coordinates
            var svgRect = svgEl.getBoundingClientRect();
            var vb = svgEl.viewBox.animVal;
            var vx = vb?.x || 0, vy = vb?.y || 0;
            var vw = vb?.width || 1600, vh = vb?.height || 1000;
            var sx = vw / svgRect.width, sy = vh / svgRect.height;
            return { x: vx + (cx - svgRect.left) * sx, y: vy + (cy - svgRect.top) * sy };
          } catch(e) {
            return { x: 0, y: 0 };
          }
        }
        state.fusionSelection = { 
          cableConnectionId: cableConnId, 
          fiberNumber: fiberNum,
          splitterId: splitterId,
          splitterOutput: splitterOutput,
          mangaFiberId: mangaFiberId,
          side: side,
          element: circle 
        };
        
        let fiberLabel = isSplitterFiber 
          ? (splitterOutput === 0 ? 'Splitter IN' : 'Splitter OUT #' + splitterOutput)
          : 'Fibra ' + (side === 'in' ? 'IN' : 'OUT') + ' #' + fiberNum;
        
        const info = document.getElementById('vis-selection-info');
        if (info) {
          info.style.display = 'block';
          info.innerHTML = `🔗 <strong>${fiberLabel}</strong> seleccionada — haz clic en <strong>cualquier otra fibra</strong> para crear empalme, o clic vacío para cancelar.`;
        }
        showToast(`🔗 ${fiberLabel} seleccionada — clic en cualquier otra fibra para empalmar`);
      } else {
        // SECOND CLICK: create fusion connecting first selected → this fiber
        const first = state.fusionSelection;
        
        // Prevent connecting to the exact same fiber DOT (same DOM element)
        if (first.element === circle) {
          clearFiberSelection();
          showToast('⚡ Selección cancelada');
          return;
        }
        
                // ====== SIMPLIFIED UNIVERSAL FIBER SPLICING ======
        const isFirstCable = first.cableConnectionId !== null;
        const isFirstSplitter = first.splitterId !== null;
        const isSecondCable = cableConnId !== null;
        const isSecondSplitter = splitterId !== null;
        
        if (!isFirstCable && !isFirstSplitter) { throw new Error('Primera fibra no identificada'); }
        if (!isSecondCable && !isSecondSplitter) { throw new Error('Segunda fibra no identificada'); }
        
        const bothCables = isFirstCable && isSecondCable;
        
        // Delete existing connections for either fiber (auto-replace)
var cableSideId = null, cableSideFiber = null, splitterMfId = null, splitterPort = null, spliceData = null;
Promise.resolve().then(async () => {
          if (bothCables) {
            // Determinar orden izquierda→derecha por posicion visual
            function getElX(el) {
              var tag = el.tagName.toLowerCase();
              var x = tag === 'circle' ? parseFloat(el.getAttribute('cx')) : (tag === 'rect' ? parseFloat(el.getAttribute('x')) + parseFloat(el.getAttribute('width'))/2 : 0);
              var block = el.closest('.vis-block');
              if (block) { var t = (block.getAttribute('transform') || '').match(/translate\(([\d.\-]+),/); if (t) x += parseFloat(t[1]); }
              return x;
            }
            var x1 = getElX(first.element);
            var x4 = getElX(circle);
            var leftFirst = x1 <= x4; // primer clic esta a la izquierda?
            var swapIn = leftFirst ? first.cableConnectionId : cableConnId;
            var swapFibIn = leftFirst ? first.fiberNumber : fiberNum;
            var swapOut = leftFirst ? cableConnId : first.cableConnectionId;
            var swapFibOut = leftFirst ? fiberNum : first.fiberNumber;
            console.log('[MANGA-FUSION] Creando fusion entre:', JSON.stringify({ mangaId, cableConnId_in: swapIn, fiber_in: swapFibIn, cableConnId_out: swapOut, fiber_out: swapFibOut, leftFirst: leftFirst }));
            var fusionBody2 = {
                cable_connection_id_in: swapIn,
                fiber_in: swapFibIn,
                cable_connection_id_out: swapOut,
                fiber_out: swapFibOut,
                loss_db: 0.05
              };
              // Solo enviar manga_id si es manga (NAP usa tabla aparte y no tiene FK en fusions)
              if (!isNap) {
                fusionBody2.manga_id = mangaId;
              }
            const res = await fetch(API + '/fusions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(fusionBody2)
            });
            if (!res.ok) { const errText = await res.text().catch(() => 'unknown'); throw new Error('Error al crear empalme: ' + errText.substring(0, 200)); }
            const newFusion = await res.json().catch(() => ({}));
            console.log('[MANGA-FUSION] Fusion creada:', newFusion);
            clearFiberSelection();
            showToast('✅ Empalme creado');
            renderTree();
            // Refresh completo del visualizador para sync de potencia e indicadores
            var refreshType = isNap ? 'nap' : undefined;
            setTimeout(function() { openMangaVisualizer(mangaId, refreshType); }, 50);
            return;
          } else {
            if (isFirstCable && isSecondSplitter) {
              cableSideId = first.cableConnectionId;
              cableSideFiber = first.fiberNumber;
              splitterMfId = mangaFiberId;
              splitterPort = splitterOutput !== null ? splitterOutput : 0;
            } else if (isFirstSplitter && isSecondCable) {
              cableSideId = cableConnId;
              cableSideFiber = fiberNum;
              splitterMfId = first.mangaFiberId;
              splitterPort = first.splitterOutput !== null ? first.splitterOutput : 0;
            } else {
              const res = await fetch(API + '/splices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  manga_id: mangaId,
                  name: 'Splitter to Splitter',
                  loss_db: 0.05,
                  fiber_a_type: 'manga_fiber',
                  fiber_a_id: first.mangaFiberId,
                  fiber_a_port: first.splitterOutput || 0,
                  fiber_b_type: 'manga_fiber',
                  fiber_b_id: mangaFiberId,
                  fiber_b_port: splitterOutput || 0
                })
              });
              if (!res.ok) throw new Error('Error al crear empalme');
              showToast('✅ Empalme creado');
              renderTree();
              var _refreshEntityType2 = isNap ? 'nap' : 'manga';
              openMangaVisualizer(mangaId, _refreshEntityType2);
              return;
            }
            console.log('[SPLICE] Sending:', JSON.stringify({
                manga_id: mangaId,
                name: splitterPort > 0 ? 'Splitter out#' + splitterPort : 'Cable->Splitter entrada',
                loss_db: 0.05,
                fiber_a_type: 'cable_fiber',
                fiber_a_id: cableSideId,
                fiber_a_port: cableSideFiber,
                fiber_b_type: 'manga_fiber',
                fiber_b_id: splitterMfId,
                fiber_b_port: splitterPort
              }));
            const spliceRes = await fetch(API + '/splices', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                manga_id: mangaId,
                name: splitterPort > 0 ? 'Splitter out#' + splitterPort : 'Cable->Splitter entrada',
                loss_db: 0.05,
                fiber_a_type: 'cable_fiber',
                fiber_a_id: cableSideId,
                fiber_a_port: cableSideFiber,
                fiber_b_type: 'manga_fiber',
                fiber_b_id: splitterMfId,
                fiber_b_port: splitterPort
              })
            });
            spliceData = spliceRes.ok ? await spliceRes.json().catch(() => ({})) : null;
            if (!spliceRes.ok) { 
              const errText = await spliceRes.text().catch(() => 'Unknown error');
              throw new Error('Error al conectar splitter: HTTP ' + spliceRes.status + ' - ' + errText.substring(0, 100));
            }
          }
          clearFiberSelection();
          showToast('✅ Empalme creado');
          renderTree();
          // Refresh completo del visualizador para sync de potencia e indicadores
          var refreshType = isNap ? 'nap' : undefined;
          setTimeout(function() { openMangaVisualizer(mangaId, refreshType); }, 50);
        }).catch(err => {
          showToast('❌ ' + err.message);
          clearFiberSelection();
        });
      }
    });
    
    // --- Fusion path hover: highlight route and all connected fibers ---
    svgEl.querySelectorAll('.fl').forEach(path => {
      path.addEventListener('mouseenter', (e) => {
        const hoveredFiberNum = parseInt(path.dataset.fiber) || 0;
        const hoveredFusionId = path.dataset.fusion;
        
        // Highlight this path
        path.classList.add('fiber-selected');
        path.setAttribute('stroke-width', '4');
        path.setAttribute('stroke-opacity', '1');
        
        // Find all connected paths (same fiber number through fusions)
        if (hoveredFiberNum > 0) {
          svgEl.querySelectorAll('.fl').forEach(function(p) {
            const pFiber = parseInt(p.dataset.fiber) || 0;
            if (pFiber === hoveredFiberNum && p !== path) {
              p.classList.add('fiber-selected');
              p.setAttribute('stroke-width', '3.5');
              p.setAttribute('stroke-opacity', '0.8');
            }
          });
        }
        
        // Show tooltip with fiber info
        if (path.dataset.fiberName) {
          const tooltip = document.getElementById('fiber-route-tooltip') || (function() {
            const t = document.createElement('div');
            t.id = 'fiber-route-tooltip';
            t.style.cssText = 'position:absolute;background:#1a1a2e;color:#fff;padding:6px 12px;border-radius:6px;font-size:12px;border:1px solid #533483;pointer-events:none;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.5);';
            document.getElementById('vis-svg')?.appendChild(t);
            return t;
          })();
          
          const fiberColor = path.dataset.fiberColor || '#fff';
          tooltip.innerHTML = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${fiberColor};margin-right:6px;vertical-align:middle"></span> Fibra #${hoveredFiberNum} · ${path.dataset.fiberName || '—'} ${path.dataset.fusionPower ? '· ' + path.dataset.fusionPower + ' dBm' : ''}`;
          tooltip.style.display = 'block';
          
          const svgRect = svgEl.getBoundingClientRect();
          tooltip.style.left = (e.clientX - svgRect.left + 12) + 'px';
          tooltip.style.top = (e.clientY - svgRect.top - 30) + 'px';
        }
      });
      
      path.addEventListener('mousemove', (e) => {
        const tooltip = document.getElementById('fiber-route-tooltip');
        if (tooltip && tooltip.style.display !== 'none') {
          const svgRect = svgEl.getBoundingClientRect();
          tooltip.style.left = (e.clientX - svgRect.left + 12) + 'px';
          tooltip.style.top = (e.clientY - svgRect.top - 30) + 'px';
        }
      });
      
      path.addEventListener('mouseleave', () => {
        path.classList.remove('fiber-selected');
        path.setAttribute('stroke-width', '2.5');
        path.setAttribute('stroke-opacity', '0.7');
        
        // Remove highlights from connected paths
        svgEl.querySelectorAll('.fl.fiber-selected').forEach(function(p) {
          p.classList.remove('fiber-selected');
          p.setAttribute('stroke-width', '2.5');
          p.setAttribute('stroke-opacity', '0.7');
        });
        
        const tooltip = document.getElementById('fiber-route-tooltip');
        if (tooltip) tooltip.style.display = 'none';
      });
      
      path.addEventListener('click', (e) => {
        const fusionId = path.dataset.fusion;
        const fIn = path.dataset.fiberIn;
        const fOut = path.dataset.fiberOut;
        const power = path.dataset.fusionPower;
        if (fusionId) showFusionDetail(fusionId, fIn, fOut, power);
      });
    });
    
    // --- Fiber dot hover: show power info for fused/powered fibers ---
    svgEl.querySelectorAll('.fiber-dot-inner').forEach(function(dot) {
      var hasFusion = dot.dataset.hasFusion === 'true';
      var hasPower = dot.dataset.hasPower === 'true';
      if (!hasFusion && !hasPower) return;
      
      var connId = dot.dataset.cableConn;
      var fiberNum = dot.dataset.fiberNum;
      
      // Find matching fusion path to get power level
      var fusionPath = svgEl.querySelector('.fl[data-conn-in="' + connId + '"][data-fiber-in="' + fiberNum + '"], .fl[data-conn-out="' + connId + '"][data-fiber-out="' + fiberNum + '"]');
      var fusionPower = fusionPath ? fusionPath.dataset.fusionPower : '';
      
      dot.addEventListener('mouseenter', function(e) {
        // Highlight the fiber group
        var group = this.closest('.fiber-dot-group');
        if (group) group.classList.add('fiber-selected');
        
        // Also highlight connected fusion path
        if (fusionPath) {
          fusionPath.classList.add('fiber-selected');
          fusionPath.setAttribute('stroke-width', '4');
          fusionPath.setAttribute('stroke-opacity', '1');
        }
        
        // Show tooltip
        var tooltip = document.getElementById('fiber-route-tooltip') || (function() {
          var t = document.createElement('div');
          t.id = 'fiber-route-tooltip';
          t.style.cssText = 'position:absolute;background:#1a1a2e;color:#fff;padding:6px 12px;border-radius:6px;font-size:12px;border:1px solid #533483;pointer-events:none;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.5);';
          document.getElementById('vis-svg')?.appendChild(t);
          return t;
        })();
        
        var fiberColor = fusionPath ? (fusionPath.dataset.fiberColor || '#888') : '#888';
        var powerText = '';
        if (hasPower) {
          if (fusionPower) {
            powerText = '· ⚡ ' + fusionPower + ' dBm';
          } else {
            powerText = '· ⚡ Sí';
          }
        }
        tooltip.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + fiberColor + ';margin-right:6px;vertical-align:middle"></span> Hilo #' + fiberNum + ' ' + (hasFusion ? '🔗 fusionado' : '') + ' ' + powerText;
        tooltip.style.display = 'block';
        
        var svgRect = svgEl.getBoundingClientRect();
        tooltip.style.left = (e.clientX - svgRect.left + 12) + 'px';
        tooltip.style.top = (e.clientY - svgRect.top - 30) + 'px';
      });
      
      dot.addEventListener('mousemove', function(e) {
        var tooltip = document.getElementById('fiber-route-tooltip');
        if (tooltip && tooltip.style.display !== 'none') {
          var svgRect = svgEl.getBoundingClientRect();
          tooltip.style.left = (e.clientX - svgRect.left + 12) + 'px';
          tooltip.style.top = (e.clientY - svgRect.top - 30) + 'px';
        }
      });
      
      dot.addEventListener('mouseleave', function() {
        var group = this.closest('.fiber-dot-group');
        if (group) group.classList.remove('fiber-selected');
        
        if (fusionPath) {
          fusionPath.classList.remove('fiber-selected');
          fusionPath.setAttribute('stroke-width', '2.5');
          fusionPath.setAttribute('stroke-opacity', '0.7');
        }
        
        var tooltip = document.getElementById('fiber-route-tooltip');
        if (tooltip) tooltip.style.display = 'none';
      });
    });
    
    // --- Fusion dots click ---
    svgEl.querySelectorAll('.fl-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
        const fusionId = dot.dataset.fusion;
        if (fusionId) {
          const path = svgEl.querySelector(`.fl[data-fusion="${fusionId}"]`);
          if (path) {
            const fIn = path.dataset.fiberIn;
            const fOut = path.dataset.fiberOut;
            const power = path.dataset.fusionPower;
            showFusionDetail(fusionId, fIn, fOut, power);
          }
        }
      });
    });
    
    // --- Fusion dots click ---
    svgEl.querySelectorAll('.fl-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
        const fusionId = dot.dataset.fusion;
        if (fusionId) {
          const path = svgEl.querySelector(`.fl[data-fusion="${fusionId}"]`);
          if (path) {
            const fIn = path.dataset.fiberIn;
            const fOut = path.dataset.fiberOut;
            const power = path.dataset.fusionPower;
            showFusionDetail(fusionId, fIn, fOut, power);
          }
        }
      });
    });
    
    // --- D3.js animations for active fusion + splice paths ---
    const activePaths = [];
    svgEl.querySelectorAll('.fl.active-pulse').forEach(path => {
      const fusionId = path.dataset.fusion;
      const spliceId = path.dataset.splice;
      // For splice paths, use fiber-color-in as main color (the blue fiber coming from OLT)
      const color = path.dataset.fiberColorIn || path.dataset.fiberColor || '#00ff88';
      const power = path.dataset.fusionPower;
      if (fusionId || spliceId) {
        activePaths.push({
          fusionId: fusionId || null,
          spliceId: spliceId || null,
          color,
          powerLevel: power ? parseFloat(power) : null
        });
      }
    });
    if (activePaths.length > 0) {
      initFiberAnimations('#vis-svg svg', activePaths);
    }
    
    // ====== [NUEVO] INICIAR ANIMACIONES D3.js ======
    try {
      const activeFiberPaths = [];
      const svgContainer = document.querySelector('#vis-svg svg');
      
      if (svgContainer) {
        svgContainer.querySelectorAll('.fl.fusion-path[data-active="true"]').forEach(function(p) {
          const fusionId = p.dataset.fusion;
          const fiberColor = p.dataset.fiberColor || '#00ff88';
          const power = p.dataset.fusionPower;
          if (fusionId) {
            activeFiberPaths.push({
              fusionId: fusionId,
              color: fiberColor,
              powerLevel: power ? parseFloat(power) : null
            });
          }
        });
      }
      
      if (activeFiberPaths.length > 0 && typeof initFiberAnimations === 'function') {
        setTimeout(function() {
          initFiberAnimations('#vis-svg svg', activeFiberPaths);
        }, 100);
      }
    } catch(e) {
      console.warn('⚠️ D3.js animation init error:', e.message);
    }
  }
  
  // Scroll to position on map
  if (manga.lat && manga.lng) {
    flyTo(manga.lat, manga.lng);
  }
  } catch(e) {
    console.error('openMangaVisualizer error:', e);
    showToast('❌ Error al abrir manga: ' + e.message);
  } finally {
    _visRefreshGuard = false;
    console.log('[VIS] Refresh complete');
    fixFusionGradients();
  }
}

// ====== SET POWER DIALOG (TOMODAT-style) ======
function showSetPowerDialog(mangaId) {
  openModal(`
    <h3>⚡ Configurar Potencia</h3>
    <p style="color:#aaa;font-size:12px;margin-bottom:12px;">Establece la potencia de una fibra conectada a la OLT</p>
    <label>Fibra ID (fiber_connection)</label>
    <input id="f-sp-fid" type="number" value="26" />
    <label>Potencia (dBm)</label>
    <input id="f-sp-power" type="number" step="0.1" value="3.0" />
    <label>Activar</label>
    <select id="f-sp-active">
      <option value="1">Sí</option>
      <option value="0">No</option>
    </select>
    <div class="btn-group" style="margin-top:16px;">
      <button class="btn-primary" onclick="saveSetPower(${mangaId})">💾 Guardar</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

async function saveSetPower(mangaId) {
  const fiberId = parseInt(document.getElementById('f-sp-fid').value);
  const power = parseFloat(document.getElementById('f-sp-power').value);
  const active = document.getElementById('f-sp-active').value === '1';
  
  try {
    await api('/fibers/' + fiberId, 'PUT', {
      active_power: active ? 1 : 0,
      power_level: power
    });
    closeModal();
    showToast('✅ Potencia configurada: ' + power + ' dBm en fibra #' + fiberId);
    openMangaVisualizer(mangaId);
  } catch(e) {
    showToast('❌ Error: ' + e.message);
  }
}

// ====== SET POWER FOR NAP ======
function showSetPowerDialogForNap(napId) {
  openModal(`
    <h3>⚡ Configurar Potencia</h3>
    <p style="color:#aaa;font-size:12px;margin-bottom:12px;">Establece la potencia de una fibra conectada al NAP</p>
    <label>Fibra ID (fiber_connection)</label>
    <input id="f-sp-fid" type="number" value="27" />
    <label>Potencia (dBm)</label>
    <input id="f-sp-power" type="number" step="0.1" value="-15.0" />
    <label>Activar</label>
    <select id="f-sp-active">
      <option value="1">Sí</option>
      <option value="0" selected>No</option>
    </select>
    <div class="btn-group" style="margin-top:16px;">
      <button class="btn-primary" onclick="saveSetPowerForNap(${napId})">💾 Guardar</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

async function saveSetPowerForNap(napId) {
  const fiberId = parseInt(document.getElementById('f-sp-fid').value);
  const power = parseFloat(document.getElementById('f-sp-power').value);
  const active = document.getElementById('f-sp-active').value === '1';
  
  try {
    await api('/fibers/' + fiberId, 'PUT', {
      active_power: active ? 1 : 0,
      power_level: power
    });
    closeModal();
    showToast('✅ Potencia configurada: ' + power + ' dBm en fibra #' + fiberId);
    openNapDetail(napId);
  } catch(e) {
    showToast('❌ Error: ' + e.message);
  }
}

async function addMangaSplitter(mangaId) {
  const types = await api('/splitter-types');
  openModal(`
    <h3>🔀 Agregar Splitter a Manga</h3>
    <label>Tipo de Splitter</label>
    <select id="f-ms-type">
      ${types.map(t => `<option value="${t.id}">${t.name} (${t.loss_db}dB · ${t.ports} puertos)</option>`).join('')}
    </select>
    <label>Nombre</label>
    <input id="f-ms-name" value="Splitter ${document.querySelectorAll('#vis-fibers .fiber-port').length + 1}" />
    <label>Fibra de entrada</label>
    <input id="f-ms-input" type="number" placeholder="Número de fibra" />
    <div class="btn-group">
      <button class="btn-primary" onclick="saveMangaSplitter(${mangaId})">Guardar</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

async function saveMangaSplitter(mangaId) {
  const typeId = parseInt(document.getElementById('f-ms-type').value);
  const types = await api('/splitter-types');
  const type = types.find(t => t.id == typeId);
  
  await api('/mangas/' + mangaId + '/splitters', 'POST', {
    name: document.getElementById('f-ms-name').value,
    splitter_type_id: typeId,
    ports_count: type?.ports || 8,
    input_fiber: parseInt(document.getElementById('f-ms-input').value) || null
  });
  
  closeModal();
  // Clear cached block positions so layout recalculates
  const _bk = 'manga:' + mangaId;
  delete _blockPositions[_bk];
  try { const s = JSON.parse(localStorage.getItem(BLOCK_POSITIONS_KEY) || '{}'); delete s[_bk]; localStorage.setItem(BLOCK_POSITIONS_KEY, JSON.stringify(s)); } catch(e){}
  openMangaVisualizer(mangaId);
}

// ========== NAP SPLITTER (global splitters) ==========
async function addNapSplitter(napId) {
  // Check if splitter already assigned
  const existing = await api('/naps/' + napId + '/splitters');
  if (existing && existing.length > 0) {
    showToast('🔀 Esta NAP ya tiene el splitter: ' + existing[0].name + ' (' + existing[0].splitter_name + ')');
    return;
  }
  const types = await api('/splitter-types');
  openModal(`
    <h3>🔀 Agregar Splitter Global a NAP</h3>
    <label>Tipo de Splitter</label>
    <select id="f-ns-type">
      ${types.map(t => `<option value="${t.id}">${t.name} (${t.loss_db}dB · ${t.ports} puertos)</option>`).join('')}
    </select>
    <label>Nombre</label>
    <input id="f-ns-name" value="NAP-Splitter" />
    <div class="btn-group">
      <button class="btn-primary" onclick="saveNapSplitter(${napId})">Guardar</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

async function saveNapSplitter(napId) {
  const typeId = parseInt(document.getElementById('f-ns-type').value);
  const types = await api('/splitter-types');
  const type = types.find(t => t.id == typeId);
  
  await api('/naps/' + napId + '/splitters', 'POST', {
    name: document.getElementById('f-ns-name').value,
    splitter_type_id: typeId,
    ports_count: type?.ports || 8
  });
  
  closeModal();
  openVisualizer(napId);
}

async function addMangaFiber(mangaId) {
  const splitters = await api('/mangas/' + mangaId + '/splitters');
  const fibers = await api('/mangas/' + mangaId + '/fibers');
  
  openModal(`
    <h3>➕ Agregar Fibra a Manga</h3>
    <label>Número de fibra</label>
    <input id="f-mf-number" type="number" value="${fibers.length + 1}" />
    <label>Splitter (opcional)</label>
    <select id="f-mf-splitter">
      <option value="">Sin splitter (solo paso)</option>
      ${splitters.map(s => `<option value="${s.id}">${s.name} - ${s.splitter_name} (puerto ${s.ports_count})</option>`).join('')}
    </select>
    <label>Puerto de salida del splitter</label>
    <input id="f-mf-output" type="number" placeholder="1-16" />
    <label>Fuente (OLT/NAP)</label>
    <input id="f-mf-source" placeholder="Ej: OLT Central" />
    <label>Destino</label>
    <input id="f-mf-target" placeholder="Ej: NAP Residencial A" />
    <label>Cliente</label>
    <input id="f-mf-client" placeholder="Nombre del cliente" />
    <label>Notas</label>
    <textarea id="f-mf-notes" rows="2"></textarea>
    <div class="btn-group">
      <button class="btn-primary" onclick="saveMangaFiber(${mangaId})">Guardar</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

async function saveMangaFiber(mangaId) {
  await api('/mangas/' + mangaId + '/fibers', 'POST', {
    fiber_number: parseInt(document.getElementById('f-mf-number').value),
    splitter_id: parseInt(document.getElementById('f-mf-splitter').value) || null,
    splitter_output: parseInt(document.getElementById('f-mf-output').value) || null,
    source_type: 'manual',
    target_type: 'manual'
  });
  
  const clientName = document.getElementById('f-mf-client').value;
  if (clientName) {
    const fibers = await api('/mangas/' + mangaId + '/fibers');
    const newFiber = fibers[fibers.length - 1];
    if (newFiber) {
      await api('/manga-fibers/' + newFiber.id, 'PUT', {
        client_name: clientName,
        active_power: true,
        power_level: -15 + Math.random() * 10
      });
    }
  }
  
  closeModal();
  openMangaVisualizer(mangaId);
}

async function editMangaFiber(mangaId, fiberId) {
  const fibers = await api('/mangas/' + mangaId + '/fibers');
  const fiber = fibers.find(f => f.id == fiberId);
  if (!fiber) return;
  
  openModal(`
    <h3>🔧 Editar Fibra #${fiber.fiber_number}</h3>
    <label>Cliente</label>
    <input id="f-ef-client" value="${fiber.client_name || ''}" />
    <label>Notas</label>
    <textarea id="f-ef-notes" rows="2">${fiber.notes || ''}</textarea>
    <label>Potencia activa</label>
    <select id="f-ef-power">
      <option value="0" ${!fiber.active_power ? 'selected' : ''}>No</option>
      <option value="1" ${fiber.active_power ? 'selected' : ''}>Sí ⚡</option>
    </select>
    <label>Nivel de potencia (dBm)</label>
    <input id="f-ef-level" type="number" step="0.1" value="${fiber.power_level || '-15'}" />
    <div class="btn-group">
      <button class="btn-primary" onclick="saveEditMangaFiber(${mangaId}, ${fiberId})">Guardar</button>
      <button class="btn-danger" onclick="deleteMangaFiber(${mangaId}, ${fiberId})">Eliminar</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

async function saveEditMangaFiber(mangaId, fiberId) {
  await api('/manga-fibers/' + fiberId, 'PUT', {
    client_name: document.getElementById('f-ef-client').value || null,
    notes: document.getElementById('f-ef-notes').value || null,
    active_power: document.getElementById('f-ef-power').value === '1',
    power_level: parseFloat(document.getElementById('f-ef-level').value)
  });
  closeModal();
  openMangaVisualizer(mangaId);
}

async function deleteMangaFiber(mangaId, fiberId) {
  if (!confirm('¿Eliminar esta fibra?')) return;
  await api('/manga-fibers/' + fiberId, 'DELETE');
  closeModal();
  openMangaVisualizer(mangaId);
}

// ========== COLOR CODE PANEL ==========

async function showColorCodePanel() {
  // Try to load color codes from API, fall back to static TIA/EIA-598
  let colors = TIA_EIA598_COLORS;
  try {
    const codes = await api('/color-codes');
    if (codes && codes.length > 0) {
      const defaultCode = codes.find(c => c.id === 1) || codes[0];
      if (defaultCode && defaultCode.fusions_color_code_json) {
        const parsed = typeof defaultCode.fusions_color_code_json === 'string'
          ? JSON.parse(defaultCode.fusions_color_code_json)
          : defaultCode.fusions_color_code_json;
        if (parsed && parsed.length === 12) {
          colors = parsed.map((c, i) => ({
            number: i + 1,
            name: c.name || TIA_EIA598_COLORS[i].name,
            hex: (typeof c === 'object' && c.hex) ? c.hex : (typeof c === 'string' ? c : TIA_EIA598_COLORS[i].hex),
            rgb: ''
          }));
        }
      }
    }
  } catch(e) {
    // Use static colors
  }

  let html = '<div style="max-width:480px;margin:0 auto">';
  html += '<h3 style="color:#e94560;margin-bottom:5px">🎨 Código de Colores TIA/EIA-598</h3>';
  html += '<p style="font-size:13px;color:#888;margin-bottom:15px">Estándar de coloración para fibras ópticas — 12 colores para identificación de fibras y tubos</p>';
  
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  colors.forEach(c => {
    const isWhite = c.hex === '#ffffff' || c.hex === '#FFFFFF' || c.hex === '#fff' || c.hex === '#FFF';
    const border = isWhite ? '2px solid #ccc' : '2px solid #555';
    html += `<div style="display:flex;align-items:center;background:#1a1a2e;border-radius:6px;padding:8px 10px;border:1px solid #333">`;
    html += `<span style="display:inline-block;width:32px;height:32px;border-radius:50%;background:${c.hex};border:${border};flex-shrink:0;margin-right:10px"></span>`;
    html += `<div style="flex:1"><div style="font-weight:bold;font-size:14px;color:#ddd">${c.name}</div>`;
    html += `<div style="font-size:11px;color:#888">#${(c.number || i + 1) < 10 ? '0' + (c.number || i + 1) : (c.number || i + 1)} · <code style="background:#0f0f23;padding:1px 4px;border-radius:3px;font-size:10px">${c.hex}</code></div></div>`;
    html += '</div>';
  });
  html += '</div>';
  
  html += '<div style="margin-top:15px;padding:10px;background:#0f0f23;border-radius:6px;font-size:12px;color:#aaa;line-height:1.6">';
  html += '<strong style="color:#ddd">📌 Notas:</strong><br>';
  html += '• Los primeros 12 colores se repiten cíclicamente para más de 12 fibras.<br>';
  html += '• En cables de múltiples tubos, cada tubo sigue la misma secuencia de colores.<br>';
  html += '• Los colores personalizados pueden editarse en la base de datos.';
  html += '</div>';
  
  html += '<div class="btn-group" style="margin-top:15px">';
  html += '<button class="btn-secondary" onclick="closeModal()">Cerrar</button>';
  html += '</div></div>';
  
  openModal(html);
}

// ========== INIT ==========
// ========== BLOCK DRAGGING (SVG interactive) ==========
let _dragState = null; // Block dragging
let _panState = null; // Canvas panning { startX, startY, origVX, origVY }
let _connDrag = null; // Connection dragging: { sourcePort, sourceNapId, tempLine, startX, startY }
let _updateFusionBlockFn = null; // reference for restoreBlockPositions
var _initBlockDragSvg = null; // Track which SVG has listeners
function initBlockDrag() {
  const svgEl = document.querySelector('#vis-svg svg');
  if (!svgEl) return;
  if (_initBlockDragSvg === svgEl) return; // Already initialized for this SVG
  _initBlockDragSvg = svgEl;
  const ns = 'http://www.w3.org/2000/svg';
  
  // Get SVG coordinate from mouse event (accounts for viewBox pan/zoom)
  function svgPoint(e) {
    const rect = svgEl.getBoundingClientRect();
    const vb = svgEl.viewBox.animVal;
    const vx = vb?.x || 0;
    const vy = vb?.y || 0;
    const vw = vb?.width || 1400;
    const vh = vb?.height || 1000;
    const sx = vw / rect.width;
    const sy = vh / rect.height;
    return { x: vx + (e.clientX - rect.left) * sx, y: vy + (e.clientY - rect.top) * sy };
  }
  
  // Find nearest port at point (within radius 20)
  function findPortAt(svgX, svgY) {
    const ports = svgEl.querySelectorAll('.clickable-port');
    let best = null, bestDist = 25;
    ports.forEach(p => {
      const cx = parseFloat(p.getAttribute('cx'));
      const cy = parseFloat(p.getAttribute('cy'));
      const dist = Math.sqrt(Math.pow(cx-svgX,2) + Math.pow(cy-svgY,2));
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    });
    return best;
  }
  
  // Block dragging — event delegation on SVG (works for dynamically created vis-blocks)
  svgEl.addEventListener('mousedown', function blockDragStart(e) {
    const block = e.target.closest('.vis-block');
    if (!block) return;
    if (e.target.closest('.clickable-port') || e.target.closest('.fl') || e.target.closest('.power-badge') || e.target.closest('.break-fusion-btn') || e.target.closest('.fiber-dot-inner') || e.target.closest('.fiber-dot-group') || e.target.closest('.flip-side-btn') || e.target.closest('.splitter-btn')) return;
    if (e.button !== 0) return;
    const rect = svgEl.getBoundingClientRect();
    const sx = (svgEl.viewBox.animVal?.width || 1400) / rect.width;
    const transform = block.getAttribute('transform') || 'translate(0,0)';
    const m = transform.match(/translate\(([\d.\-]+),\s*([\d.\-]+)\)/);
    _dragState = {
      element: block, startX: e.clientX, startY: e.clientY,
      origX: m ? parseFloat(m[1]) : 0, origY: m ? parseFloat(m[2]) : 0,
      scaleX: sx
    };
    block.style.cursor = 'grabbing';
    e.preventDefault();
  });
  
  // Global mousedown on SVG — detect connection drag start
  svgEl.addEventListener('mousedown', (e) => {
    const port = e.target.closest('.clickable-port');
    if (!port || e.button !== 0) return;
    const pt = svgPoint(e);
    const cx = parseFloat(port.getAttribute('cx'));
    const cy = parseFloat(port.getAttribute('cy'));
    _connDrag = {
      sourcePort: port, startX: cx, startY: cy, tempLine: null
    };
  });
  
  // Canvas panning — click on empty SVG space and drag (like Google Maps)
  svgEl.addEventListener('mousedown', function(e) {
    // Only start pan if NOT clicking on a block, dot, button, or fiber
    if (e.target.closest('.vis-block') || e.target.closest('.fiber-dot-inner') || e.target.closest('.clickable-port')) return;
    if (e.target.closest('.fl') || e.target.closest('.power-badge') || e.target.closest('.break-fusion-btn') || e.target.closest('.flip-side-btn') || e.target.closest('.splitter-btn')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    var vb = svgEl.getAttribute('viewBox');
    if (!vb) return;
    var parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length < 4) return;
    svgEl.style.cursor = 'grabbing';
    _panState = { startX: e.clientX, startY: e.clientY, origVX: parts[0], origVY: parts[1] };
  });
  
  // Mousemove: either drag block OR draw connection line
  // Store original fusion path coords before drag starts
  function updateFusionLine(connIn, fiberIn, connOut, fiberOut) {
    // Find the actual fiber port positions — works for IN, OUT, or IN↔IN
    const inPort = svgEl.querySelector(`.fiber-dot-inner[data-cable-conn="${connIn}"][data-fiber-num="${fiberIn}"]`);
    const outPort = svgEl.querySelector(`.fiber-dot-inner[data-cable-conn="${connOut}"][data-fiber-num="${fiberOut}"]`);
    if (!inPort || !outPort) return;
    
    // Get positions from the fiber port (handles both circle and rect elements)
    function getAbsolutePos(el) {
      const block = el.closest('.vis-block');
      const tag = el.tagName.toLowerCase();
      var cx, cy;
      if (tag === 'circle') {
        cx = parseFloat(el.getAttribute('cx'));
        cy = parseFloat(el.getAttribute('cy'));
      } else if (tag === 'rect') {
        cx = parseFloat(el.getAttribute('x')) + parseFloat(el.getAttribute('width')) / 2;
        cy = parseFloat(el.getAttribute('y')) + parseFloat(el.getAttribute('height')) / 2;
      } else {
        cx = 0; cy = 0;
      }
      if (block) {
        const t = (block.getAttribute('transform') || '').match(/translate\(([\d.\-]+),\s*([\d.\-]+)\)/);
        if (t) return { x: cx + parseFloat(t[1]), y: cy + parseFloat(t[2]) };
      }
      return { x: cx, y: cy };
    }
    
    const inPos = getAbsolutePos(inPort);
    const outPos = getAbsolutePos(outPort);
    
    // Bezier curve from IN port to OUT port with natural bending
    const x1 = inPos.x, y1 = inPos.y;
    const x4 = outPos.x, y4 = outPos.y;
    const dx = Math.abs(x4 - x1);
    const cpOff = Math.max(dx * 0.35, 60);
    const cpY1 = y1 + (y4 - y1) * 0.15;
    const cpY2 = y4 - (y4 - y1) * 0.15;
    // Adjust control point direction based on port positions
    const cpx1 = x1 < x4 ? x1 + cpOff : x1 - cpOff;
    const cpx2 = x1 < x4 ? x4 - cpOff : x4 + cpOff;
    
    const d = `M ${x1},${y1} C ${cpx1},${cpY1} ${cpx2},${cpY2} ${x4},${y4}`;
    
    // Find the fusion path and update it
    const fp = svgEl.querySelector(`.fl[data-conn-in="${connIn}"][data-fiber-in="${fiberIn}"][data-conn-out="${connOut}"][data-fiber-out="${fiberOut}"]`);
    if (!fp) return;
    fp.setAttribute('d', d);
    
    // Update fusion dot and ✂️ to midpoint
    const midX = (x1 + x4) / 2;
    const midY = (y1 + y4) / 2;
    const fusionId = fp.getAttribute('data-fusion');
    if (fusionId) {
      svgEl.querySelectorAll(`.fl-dot[data-fusion="${fusionId}"]`).forEach(dot => {
        dot.setAttribute('cx', midX);
        dot.setAttribute('cy', midY);
      });
      svgEl.querySelectorAll(`.break-fusion-btn[data-fusion="${fusionId}"]`).forEach(btn => {
        const r = btn.querySelector('rect');
        const t = btn.querySelector('text');
        if (r && t) {
          r.setAttribute('x', midX - 20);
          r.setAttribute('y', midY - 10);
          t.setAttribute('x', midX);
          t.setAttribute('y', midY + 4);
        }
      });
    }
  }
  
  function updateAllFusionsForBlock(blockEl) {
    const ports = blockEl.querySelectorAll('.fiber-dot-inner');
    const blockIsSplitter = (blockEl.getAttribute('data-block-idx') || '').startsWith('splitter-');
    const blockIdx = blockEl.getAttribute('data-block-idx') || '';
    
    
    ports.forEach(port => {
      const connId = port.getAttribute('data-cable-conn');
      const fiberNum = port.getAttribute('data-fiber-num');
      const splitterId = port.getAttribute('data-splitter-id');
      const splitterOutput = port.getAttribute('data-splitter-output');
      
      // ⭐ Handle SPLITTER block: actualizar splices desde el lado del splitter
      if (blockIsSplitter && splitterId && fiberNum) {
        
        // Buscar splice paths donde data-fiber-out (data-conn-out) = fiberNum
        var foundPaths = svgEl.querySelectorAll(`.fl[data-splice][data-fiber-out="${fiberNum}"]`);
        
        foundPaths.forEach(function(fp) {
          var sCableConn = fp.getAttribute('data-conn-in');
          var sFiberIn = fp.getAttribute('data-fiber-in');
          var pathD = fp.getAttribute('d');
          
          if (!sCableConn || !sFiberIn) {  return; }
          var cablePort = svgEl.querySelector('.fiber-dot-inner[data-cable-conn="' + sCableConn + '"][data-fiber-num="' + sFiberIn + '"]');
          var splitterPort = svgEl.querySelector('.fiber-dot-inner[data-fiber-num="' + fiberNum + '"][data-splitter-id="' + splitterId + '"]');
          
          if (!cablePort || !splitterPort) {  return; }
          function gA(el) {
            var b = el.closest('.vis-block');
            var tag = el.tagName.toLowerCase();
            var cx, cy;
            if (tag === 'circle') { cx = parseFloat(el.getAttribute('cx')); cy = parseFloat(el.getAttribute('cy')); }
            else if (tag === 'rect') { cx = parseFloat(el.getAttribute('x')) + parseFloat(el.getAttribute('width')) / 2; cy = parseFloat(el.getAttribute('y')) + parseFloat(el.getAttribute('height')) / 2; }
            else { cx = 0; cy = 0; }
            if (b) { var t = (b.getAttribute('transform') || '').match(/translate\(([\d.\-]+),\s*([\d.\-]+)\)/); if (t) { cx += parseFloat(t[1]); cy += parseFloat(t[2]); } }
            return { x: cx, y: cy };
          }
          var cP = gA(cablePort);
          var sP = gA(splitterPort);
          
          if (cP.x === 0 && cP.y === 0 && sP.x === 0 && sP.y === 0) {  return; }
          // Preservar direccion INPUT/OUTPUT
          var sOut = splitterPort.getAttribute('data-splitter-output');
          var isInput = sOut === '0' || sOut === 'null' || sOut === '' || sOut === null;
          var fromPt = isInput ? sP : cP;
          var toPt = isInput ? cP : sP;
          var cpOff = Math.max(Math.abs(toPt.x - fromPt.x) * 0.3, 40);
          var scpx1 = fromPt.x < toPt.x ? (fromPt.x + cpOff) : (fromPt.x - cpOff);
          var scpx2 = fromPt.x < toPt.x ? (toPt.x - cpOff) : (toPt.x + cpOff);
          var scpy1 = fromPt.y + (toPt.y - fromPt.y) * 0.15;
          var scpy2 = toPt.y - (toPt.y - fromPt.y) * 0.15;
          fp.setAttribute('d', 'M ' + fromPt.x + ',' + fromPt.y + ' C ' + scpx1 + ',' + scpy1 + ' ' + scpx2 + ',' + scpy2 + ' ' + toPt.x + ',' + toPt.y);
          
          var scx = (cP.x + sP.x) / 2, scy = (cP.y + sP.y) / 2;
          svgEl.querySelectorAll('.break-fusion-btn[data-splice="' + fp.getAttribute('data-splice') + '"]').forEach(function(btn) {
            var r = btn.querySelector('rect'), t = btn.querySelector('text');
            if (r && t) { r.setAttribute('x', scx - 20); r.setAttribute('y', scy - 10); t.setAttribute('x', scx); t.setAttribute('y', scy + 4); }
          });
        });
        return; // No processar cable-side para splitter blocks
      }
      
      // Handle cable fiber ports
      if (connId && fiberNum) {
        // Update fusion paths (cable-to-cable)
        const fusionSelector = `.fl[data-conn-in="${connId}"][data-fiber-in="${fiberNum}"]:not([data-splice]), .fl[data-conn-out="${connId}"][data-fiber-out="${fiberNum}"]:not([data-splice])`;
        var foundFusions = svgEl.querySelectorAll(fusionSelector);
        if (foundFusions.length > 0) 
        foundFusions.forEach(fp => {
          const cIn = fp.getAttribute('data-conn-in');
          const fIn = fp.getAttribute('data-fiber-in');
          const cOut = fp.getAttribute('data-conn-out');
          const fOut = fp.getAttribute('data-fiber-out');
          if (cIn && fIn && cOut && fOut) {
            updateFusionLine(cIn, fIn, cOut, fOut);
          }
        });
        
        // ⭐ SPLICE: update usando las MISMAS posiciones DOM que las fusiones
        // Buscar splice paths que conectan cable→splitter por data-conn-in/data-fiber-in
        var foundCableSplices = svgEl.querySelectorAll(`.fl[data-splice][data-conn-in="${connId}"][data-fiber-in="${fiberNum}"]`);
        
        foundCableSplices.forEach(function(fp) {
          var sCableConn = fp.getAttribute('data-conn-in');
          var sFiberIn = fp.getAttribute('data-fiber-in');
          var sFiberOut = fp.getAttribute('data-fiber-out');
          var pathD = fp.getAttribute('d');
          
          if (!sCableConn || !sFiberIn || !sFiberOut) {  return; }
          // ⭐ Usar getAbsolutePos (MISMA función que updateFusionLine)
          var cablePort = svgEl.querySelector('.fiber-dot-inner[data-cable-conn="' + sCableConn + '"][data-fiber-num="' + sFiberIn + '"]');
          var splitterPort = svgEl.querySelector('.fiber-dot-inner[data-fiber-num="' + sFiberOut + '"][data-splitter-id]');
          
          if (!cablePort || !splitterPort) {  return; }
          function getAbsPos(el) {
            var b = el.closest('.vis-block');
            var tag = el.tagName.toLowerCase();
            var cx, cy;
            if (tag === 'circle') { cx = parseFloat(el.getAttribute('cx')); cy = parseFloat(el.getAttribute('cy')); }
            else if (tag === 'rect') { cx = parseFloat(el.getAttribute('x')) + parseFloat(el.getAttribute('width')) / 2; cy = parseFloat(el.getAttribute('y')) + parseFloat(el.getAttribute('height')) / 2; }
            else { cx = 0; cy = 0; }
            if (b) { var t = (b.getAttribute('transform') || '').match(/translate\(([\d.\-]+),\s*([\d.\-]+)\)/); if (t) { cx += parseFloat(t[1]); cy += parseFloat(t[2]); } }
            return { x: cx, y: cy };
          }
          var cP = getAbsPos(cablePort);
          var sP = getAbsPos(splitterPort);
          
          if (cP.x === 0 && cP.y === 0 && sP.x === 0 && sP.y === 0) {  return; }
          // Preservar direccion INPUT/OUTPUT como en injectSplice
          var sOut = splitterPort.getAttribute('data-splitter-output');
          var isInput = sOut === '0' || sOut === 'null' || sOut === '' || sOut === null;
          var fromPt = isInput ? sP : cP;
          var toPt = isInput ? cP : sP;
          var cpOff = Math.max(Math.abs(toPt.x - fromPt.x) * 0.3, 40);
          var scpx1 = fromPt.x < toPt.x ? (fromPt.x + cpOff) : (fromPt.x - cpOff);
          var scpx2 = fromPt.x < toPt.x ? (toPt.x - cpOff) : (toPt.x + cpOff);
          var scpy1 = fromPt.y + (toPt.y - fromPt.y) * 0.15;
          var scpy2 = toPt.y - (toPt.y - fromPt.y) * 0.15;
          fp.setAttribute('d', 'M ' + fromPt.x + ',' + fromPt.y + ' C ' + scpx1 + ',' + scpy1 + ' ' + scpx2 + ',' + scpy2 + ' ' + toPt.x + ',' + toPt.y);
          
          // Mantener clase active-pulse/data-flow que ya puso el render inicial
          var scx = (cP.x + sP.x) / 2, scy = (cP.y + sP.y) / 2;
          svgEl.querySelectorAll('.break-fusion-btn[data-splice="' + fp.getAttribute('data-splice') + '"]').forEach(function(btn) {
            var r = btn.querySelector('rect'), t = btn.querySelector('text');
            if (r && t) { r.setAttribute('x', scx - 20); r.setAttribute('y', scy - 10); t.setAttribute('x', scx); t.setAttribute('y', scy + 4); }
          });
        });
      }
      
      // Handle OLT connection paths: update lines from cable fibers to OLT ports
      if (connId && fiberNum) {
        svgEl.querySelectorAll(`.fl[data-conn-in="${connId}"][data-fiber-in="${fiberNum}"][data-olt-port-id]`).forEach(fp => {
          const oltPortId = fp.getAttribute('data-olt-port-id');
          if (!oltPortId) return;
          
          // Find OLT port dot
          const oltPortDot = svgEl.querySelector(`.fiber-dot-inner[data-olt-port-id="${oltPortId}"]`);
          if (!oltPortDot) return;
          
          // Get positions accounting for block transforms
          const cableBlock = port.closest('.vis-block');
          const oltBlock = oltPortDot.closest('.vis-block');
          
          let cx, cy;
          if (port.tagName === 'circle') {
            cx = parseFloat(port.getAttribute('cx'));
            cy = parseFloat(port.getAttribute('cy'));
          } else {
            cx = parseFloat(port.getAttribute('x')) + parseFloat(port.getAttribute('width')) / 2;
            cy = parseFloat(port.getAttribute('y')) + parseFloat(port.getAttribute('height')) / 2;
          }
          if (cableBlock) {
            const m = (cableBlock.getAttribute('transform') || '').match(/translate\(([\d.\-]+),\s*([\d.\-]+)\)/);
            if (m) { cx += parseFloat(m[1]); cy += parseFloat(m[2]); }
          }
          
          let ox, oy;
          if (oltPortDot.tagName === 'circle') {
            ox = parseFloat(oltPortDot.getAttribute('cx'));
            oy = parseFloat(oltPortDot.getAttribute('cy'));
          } else {
            ox = parseFloat(oltPortDot.getAttribute('x')) + parseFloat(oltPortDot.getAttribute('width')) / 2;
            oy = parseFloat(oltPortDot.getAttribute('y')) + parseFloat(oltPortDot.getAttribute('height')) / 2;
          }
          if (oltBlock) {
            const m = (oltBlock.getAttribute('transform') || '').match(/translate\(([\d.\-]+),\s*([\d.\-]+)\)/);
            if (m) { ox += parseFloat(m[1]); oy += parseFloat(m[2]); }
          }
          
          const midDist = Math.abs(ox - cx) * 0.35;
          const d = `M ${cx},${cy} C ${cx + midDist},${cy} ${ox - midDist},${oy} ${ox},${oy}`;
          fp.setAttribute('d', d);
        });
      }
      
      // Handle OLT port dots: update paths connected to this port
      const oltPortId = port.getAttribute('data-olt-port-id');
      if (oltPortId) {
        svgEl.querySelectorAll(`.fl[data-olt-port-id="${oltPortId}"]`).forEach(fp => {
          const connIn = fp.getAttribute('data-conn-in');
          const fIn = fp.getAttribute('data-fiber-in');
          if (!connIn || !fIn) return;
          
          const cableDot = svgEl.querySelector(`.fiber-dot-inner[data-cable-conn="${connIn}"][data-fiber-num="${fIn}"]`);
          if (!cableDot) return;
          
          const cableBlock = cableDot.closest('.vis-block');
          const oltBlock = port.closest('.vis-block');
          
          let cx, cy;
          if (cableDot.tagName === 'circle') {
            cx = parseFloat(cableDot.getAttribute('cx'));
            cy = parseFloat(cableDot.getAttribute('cy'));
          } else {
            cx = parseFloat(cableDot.getAttribute('x')) + parseFloat(cableDot.getAttribute('width')) / 2;
            cy = parseFloat(cableDot.getAttribute('y')) + parseFloat(cableDot.getAttribute('height')) / 2;
          }
          if (cableBlock) {
            const m = (cableBlock.getAttribute('transform') || '').match(/translate\(([\d.\-]+),\s*([\d.\-]+)\)/);
            if (m) { cx += parseFloat(m[1]); cy += parseFloat(m[2]); }
          }
          
          let ox, oy;
          if (port.tagName === 'circle') {
            ox = parseFloat(port.getAttribute('cx'));
            oy = parseFloat(port.getAttribute('cy'));
          } else {
            ox = parseFloat(port.getAttribute('x')) + parseFloat(port.getAttribute('width')) / 2;
            oy = parseFloat(port.getAttribute('y')) + parseFloat(port.getAttribute('height')) / 2;
          }
          if (oltBlock) {
            const m = (oltBlock.getAttribute('transform') || '').match(/translate\(([\d.\-]+),\s*([\d.\-]+)\)/);
            if (m) { ox += parseFloat(m[1]); oy += parseFloat(m[2]); }
          }
          
          const midDist = Math.max(Math.abs(ox - cx) * 0.35, 30);
          const d = `M ${cx},${cy} C ${cx + midDist},${cy} ${ox - midDist},${oy} ${ox},${oy}`;
          fp.setAttribute('d', d);
          // Update ✂️ button and power label (direct sibling approach)
          var mx = (cx + ox) / 2;
          var my = (cy + oy) / 2;
          var fconn = fp.getAttribute('data-fiber-conn');
          var es = fp.parentNode ? fp.parentNode.querySelectorAll('.olt-power-label[data-fiber-conn="' + fconn + '"], .break-fusion-btn[data-fiber-conn="' + fconn + '"]') : [];
          es.forEach(function(el) {
            if (el.classList.contains('olt-power-label')) {
              el.setAttribute('x', mx);
              el.setAttribute('y', my - 14);
            } else if (el.classList.contains('break-fusion-btn')) {
              var r = el.querySelector('rect'), t = el.querySelector('text');
              if (r && t) { r.setAttribute('x', mx - 12); r.setAttribute('y', my - 10); t.setAttribute('x', mx); t.setAttribute('y', my + 4); }
            }
          });
        });
      }
      
      // Handle splitter ports: update splice paths connected to this port
      if (splitterId !== null && fiberNum) {
        // Find splice paths where data-fiber-out matches this fiber number
        svgEl.querySelectorAll('.fl[data-splice]').forEach(fp => {
          const fOut = fp.getAttribute('data-fiber-out');
          if (!fOut || fOut !== fiberNum) return;
          
          const connIn = fp.getAttribute('data-conn-in');
          const fIn = fp.getAttribute('data-fiber-in');
          const connOut = fp.getAttribute('data-conn-out');
          
          if (!connIn || !fIn) return;
          
          // Find the cable fiber port
          const cablePort = svgEl.querySelector(`.fiber-dot-inner[data-cable-conn="${connIn}"][data-fiber-num="${fIn}"]`);
          if (!cablePort) return;
          
          // Get positions
          function getPos(el) {
            const block = el.closest('.vis-block');
            let x, y;
            if (el.tagName === 'circle') {
              x = parseFloat(el.getAttribute('cx'));
              y = parseFloat(el.getAttribute('cy'));
            } else {
              x = parseFloat(el.getAttribute('x')) + parseFloat(el.getAttribute('width')) / 2;
              y = parseFloat(el.getAttribute('y')) + parseFloat(el.getAttribute('height')) / 2;
            }
            if (block) {
              const t = (block.getAttribute('transform') || '').match(/translate\(([\d.\-]+),\s*([\d.\-]+)\)/);
              if (t) { x += parseFloat(t[1]); y += parseFloat(t[2]); }
            }
            return { x, y };
          }
          
          const cablePos = getPos(cablePort);
          const splitterPos = getPos(port);
          
          // Bezier from cable to splitter
          const x1 = cablePos.x, y1 = cablePos.y;
          const x4 = splitterPos.x, y4 = splitterPos.y;
          const cpOff = Math.max(Math.abs(x4 - x1) * 0.3, 40);
          const d = 'M ' + x1 + ',' + y1 + ' C ' + (x1 + cpOff) + ',' + y1 + ' ' + (x4 - cpOff) + ',' + y4 + ' ' + x4 + ',' + y4;
          fp.setAttribute('d', d);
          // Update ✂️ button position
          var midX2 = (cablePos.x + splitterPos.x) / 2;
          var midY2 = (cablePos.y + splitterPos.y) / 2;
          svgEl.querySelectorAll('.break-fusion-btn[data-fiber-out="' + fOut + '"]').forEach(function(btn) {
            var r = btn.querySelector('rect'), t = btn.querySelector('text');
            if (r && t) { r.setAttribute('x', midX2 - 20); r.setAttribute('y', midY2 - 10); t.setAttribute('x', midX2); t.setAttribute('y', midY2 + 4); }
          });
        });
      }
    });
  }
  // Export for use by restoreBlockPositions
  // === ZOOM: mouse wheel on SVG ===
  svgEl.addEventListener('wheel', function(e) {
    e.preventDefault();
    var vb = svgEl.getAttribute('viewBox');
    if (!vb) return;
    var parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length < 4) return;
    var vx = parts[0], vy = parts[1], vw = parts[2], vh = parts[3];
    var factor = e.deltaY > 0 ? 1.12 : 0.88;
    var newW = Math.max(800, Math.min(20000, vw * factor));
    var newH = Math.max(600, Math.min(15000, vh * factor));
    // Keep centered on mouse position
    var rect = svgEl.getBoundingClientRect();
    var mx = (e.clientX - rect.left) / rect.width;
    var my = (e.clientY - rect.top) / rect.height;
    var newX = vx + (vw - newW) * mx;
    var newY = vy + (vh - newH) * my;
    svgEl.setAttribute('viewBox', newX + ',' + newY + ',' + newW + ',' + newH);
  }, { passive: false });

  _updateFusionBlockFn = updateAllFusionsForBlock;
  
  svgEl.addEventListener('mousemove', (e) => {
    // Canvas panning
    if (_panState) {
      var vb = svgEl.getAttribute('viewBox');
      if (vb) {
        var parts = vb.split(/[\s,]+/).map(Number);
        if (parts.length >= 4) {
          var vw = parts[2], vh = parts[3];
          var rect = svgEl.getBoundingClientRect();
          var sx = vw / rect.width;
          var sy = vh / rect.height;
          var dx = (e.clientX - _panState.startX) * sx;
          var dy = (e.clientY - _panState.startY) * sy;
          svgEl.setAttribute('viewBox', (_panState.origVX - dx) + ',' + (_panState.origVY - dy) + ',' + vw + ',' + vh);
        }
      }
      return;
    }
    // Block dragging
    if (_dragState) {
      const dx = (e.clientX - _dragState.startX) * _dragState.scaleX;
      const dy = (e.clientY - _dragState.startY) * _dragState.scaleX;
      _dragState.element.setAttribute('transform',
        `translate(${_dragState.origX + dx}, ${_dragState.origY + dy})`);
      
      // Recalculate all fusion lines for this block from actual port positions
      updateAllFusionsForBlock(_dragState.element);
      // Force-update OLT connection line labels and buttons on drag
      var fConnLines = svgEl.querySelectorAll('.fl[data-olt-port-id]');
      fConnLines.forEach(function(p) {
        var d = p.getAttribute('d');
        if (!d) return;
        var parts = d.match(/M ([\d.\-]+),([\d.\-]+) C [\d.\-]+,[\d.\-]+ [\d.\-]+,[\d.\-]+ ([\d.\-]+),([\d.\-]+)/);
        if (!parts) return;
        var mx = (parseFloat(parts[1]) + parseFloat(parts[3])) / 2;
        var my = (parseFloat(parts[2]) + parseFloat(parts[4])) / 2;
        var fc = p.getAttribute('data-fiber-conn');
        var lbl = svgEl.querySelector('.olt-power-label[data-fiber-conn="' + fc + '"]');
        if (lbl) { lbl.setAttribute('x', mx); lbl.setAttribute('y', my - 14); }
        var btn = svgEl.querySelector('.break-fusion-btn[data-fiber-conn="' + fc + '"]');
        if (btn) {
          var r = btn.querySelector('rect'), t = btn.querySelector('text');
          if (r && t) { r.setAttribute('x', mx - 12); r.setAttribute('y', my - 10); t.setAttribute('x', mx); t.setAttribute('y', my + 4); }
        }
      });
      return;
    }
    // Connection dragging
    if (_connDrag) {
      const pt = svgPoint(e);
      if (!_connDrag.tempLine) {
        _connDrag.tempLine = document.createElementNS(ns, 'path');
        _connDrag.tempLine.setAttribute('stroke', '#00ff88');
        _connDrag.tempLine.setAttribute('stroke-width', '3');
        _connDrag.tempLine.setAttribute('stroke-dasharray', '8,4');
        _connDrag.tempLine.setAttribute('opacity', '0.8');
        _connDrag.tempLine.setAttribute('fill', 'none');
        _connDrag.tempLine.setAttribute('class', 'temp-connection-line');
        svgEl.appendChild(_connDrag.tempLine);
      }
      // Recalculate source position from actual element position (handles pan/drag updates)
      var srcPt = { x: _connDrag.startX, y: _connDrag.startY };
      if (_connDrag.sourcePort) {
        try {
          var sr = _connDrag.sourcePort.getBoundingClientRect();
          var svgRect2 = svgEl.getBoundingClientRect();
          var vb2 = svgEl.viewBox.animVal;
          var vx2 = vb2?.x || 0, vy2 = vb2?.y || 0;
          var vw2 = vb2?.width || 1600, vh2 = vb2?.height || 1000;
          srcPt.x = vx2 + ((sr.left + sr.width/2) - svgRect2.left) * (vw2 / svgRect2.width);
          srcPt.y = vy2 + ((sr.top + sr.height/2) - svgRect2.top) * (vh2 / svgRect2.height);
        } catch(e) {}
      }
      // Draw Bézier curve instead of straight line (matches real fusion line style)
      var x1 = srcPt.x, y1 = srcPt.y;
      var x4 = pt.x, y4 = pt.y;
      var dx = Math.abs(x4 - x1);
      var cpOff = Math.max(dx * 0.35, 60);
      var cpY1 = y1 + (y4 - y1) * 0.15;
      var cpY2 = y4 - (y4 - y1) * 0.15;
      var cpx1 = x1 < x4 ? x1 + cpOff : x1 - cpOff;
      var cpx2 = x1 < x4 ? x4 - cpOff : x4 + cpOff;
      var bezierD = 'M ' + x1 + ',' + y1 + ' C ' + cpx1 + ',' + cpY1 + ' ' + cpx2 + ',' + cpY2 + ' ' + x4 + ',' + y4;
      _connDrag.tempLine.setAttribute('d', bezierD);
    }
  });
  
  // Mouseup: finish block drag OR finish connection
  svgEl.addEventListener('mouseup', (e) => {
    // Finish canvas pan
    if (_panState) {
      svgEl.style.cursor = '';
      _panState = null;
      return;
    }
    // Finish block drag
    if (_dragState) {
      var _endIdx = _dragState.element.getAttribute('data-block-idx');
      _dragState.element.style.cursor = 'grab';
      _dragState = null;
      saveBlockPositions();
      if (typeof fixFusionGradients === 'function') setTimeout(fixFusionGradients, 50);
      return;
    }
    // Finish connection drag
    if (_connDrag) {
      if (_connDrag.tempLine) {
        try { svgEl.removeChild(_connDrag.tempLine); } catch(e) {}
      }
      // Also remove any orphaned temp lines
      svgEl.querySelectorAll('path.temp-connection-line').forEach(function(el) { el.remove(); });
      
      // Check if dropped on another port
      const pt = svgPoint(e);
      const targetPort = findPortAt(pt.x, pt.y);
      
      if (targetPort && targetPort !== _connDrag.sourcePort) {
        // Get port info from onclick attribute
        const srcOnClick = _connDrag.sourcePort.getAttribute('onclick') || '';
        const tgtOnClick = targetPort.getAttribute('onclick') || '';
        
        // Extract port numbers from onclick handlers
        const srcMatch = srcOnClick.match(/editNapPort\((\d+),\s*(\d+)\)/);
        const tgtMatch = tgtOnClick.match(/editNapPort\((\d+),\s*(\d+)\)/);
        
        if (srcMatch && tgtMatch) {
          const srcNapId = parseInt(srcMatch[1]);
          const srcPort = parseInt(srcMatch[2]);
          const tgtNapId = parseInt(tgtMatch[1]);
          const tgtPort = parseInt(tgtMatch[2]);
          
          showToast('🔗 Conectado: puerto ' + srcPort + ' → puerto ' + tgtPort);
          
          // Open the edit dialog for target port
          if (tgtNapId && tgtPort) {
            editNapPort(tgtNapId, tgtPort);
          }
        }
      }
      _connDrag = null;
    }
  });
  
  svgEl.addEventListener('mouseleave', () => {
    if (_dragState) { _dragState.element.style.cursor = 'grab'; _dragState = null; saveBlockPositions(); }
    if (_connDrag) {
      if (_connDrag.tempLine) { try { svgEl.removeChild(_connDrag.tempLine); } catch(e) {} }
      _connDrag = null;
    }
    svgEl.querySelectorAll('path.temp-connection-line').forEach(function(el) { el.remove(); });
  });
}

// Window click to close modals
window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal') || e.target.classList.contains('vis-panel')) { closeModal(); closeVisualizer(); }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.ctx-menu').forEach(m => m.classList.add('hidden'));
    closeModal();
    closeVisualizer();
  }
});

// ========== FIBER TOOLTIP ==========
let _fiberTooltipTimer = null;

function showFiberTooltip(e, content) {
  hideFiberTooltip();
  const tooltip = document.createElement('div');
  tooltip.id = 'fiber-tooltip';
  tooltip.style.cssText = `
    position: fixed; z-index: 99999; background: rgba(22,33,62,0.95);
    border: 1px solid #533483; border-radius: 8px; padding: 8px 14px;
    color: #e0e0e0; font-size: 12px; font-family: 'Segoe UI', sans-serif;
    pointer-events: none; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    max-width: 220px; line-height: 1.5;
  `;
  tooltip.style.left = (e.clientX + 15) + 'px';
  tooltip.style.top = (e.clientY - 10) + 'px';
  tooltip.innerHTML = content;
  document.body.appendChild(tooltip);
}

function hideFiberTooltip() {
  const t = document.getElementById('fiber-tooltip');
  if (t) t.remove();
}

// ========== FIBER FUSION DETAIL MODAL ==========
function showFusionDetail(fusionId, fiberIn, fiberOut, power) {
  const loss = power ? parseFloat(power) : null;
  const powerInfo = loss !== null ? (
    loss >= -20 
      ? `<span style="color:#00ff88">🟢 Buena (${loss.toFixed(1)} dBm)</span>`
      : loss >= -25 
        ? `<span style="color:#ffaa00">🟡 Regular (${loss.toFixed(1)} dBm)</span>`
        : `<span style="color:#e94560">🔴 Mala (${loss.toFixed(1)} dBm)</span>`
  ) : '<span style="color:#888">⚪ Sin medición</span>';
  
  // Find the mangaId from the current visualizer title
  const visTitle = document.getElementById('vis-title')?.textContent || '';
  
  openModal(`
    <h3>🔗 Detalle de Empalme #${fusionId}</h3>
    <div style="margin:16px 0;line-height:2">
      <div><strong>Fibra entrada:</strong> #${fiberIn || '?'} <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${tiaColor(parseInt(fiberIn) || 1)};vertical-align:middle;margin-left:8px;"></span> ${tiaColorName(parseInt(fiberIn) || 1)}</div>
      <div><strong>Fibra salida:</strong> #${fiberOut || '?'} <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${tiaColor(parseInt(fiberOut) || 1)};vertical-align:middle;margin-left:8px;"></span> ${tiaColorName(parseInt(fiberOut) || 1)}</div>
      <div><strong>Estado:</strong> ${powerInfo}</div>
    </div>
    <div style="background:#0f3460;padding:12px;border-radius:6px;margin:12px 0">
      <strong style="color:#00d4ff">📊 Potencia estimada:</strong>
      <div style="margin-top:8px;height:8px;background:#1a1a2e;border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${loss !== null ? Math.max(10, Math.min(100, (loss + 30) * 2)) : 50}%;background:${loss !== null ? (loss >= -20 ? '#00ff88' : loss >= -25 ? '#ffaa00' : '#e94560') : '#555'};border-radius:4px;transition:width 0.5s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:#666">
        <span>-30 dBm</span>
        <span>-20 dBm</span>
      </div>
    </div>
    <div class="btn-group" style="justify-content:space-between">
      <button class="btn-primary" onclick="closeModal()">Cerrar</button>
      <button class="btn-danger" onclick="breakFusion(${fusionId})">✂️ Romper Empalme</button>
    </div>
  `);
}

function confirmBreakSplice(spliceId) {
  if (!spliceId || spliceId === 'new') { showToast('Splice ID no disponible, refresca la página'); return; }
  showModal('✂️ Romper empalme', 
    '<p style="color:#ccc;margin:12px 0">¿Estás seguro de romper este empalme #' + spliceId + '?</p>' +
    '<p style="color:#888;font-size:12px;margin-bottom:16px">Los hilos quedarán libres para conectarse a otra fibra o splitter.</p>' +
    '<div class="btn-group">' +
      '<button class="btn-danger" onclick="doBreakSplice(' + spliceId + ')">✂️ Romper</button>' +
      '<button class="btn-secondary" onclick="closeModal()">Cancelar</button>' +
    '</div>'
  );
}

function doBreakSplice(spliceId) {
  closeModal();
  fetch(API + '/splices/' + spliceId, { method: 'DELETE' })
    .then(r => {
      if (!r.ok) throw new Error('Error al romper');
      // Dynamic removal: just remove the SVG path and update attributes
      const svgEl = document.querySelector('#vis-svg svg');
      if (svgEl) {
        // Remove splice path
        svgEl.querySelectorAll('.fl[data-splice="' + spliceId + '"]').forEach(p => p.remove());
        // Remove break buttons for this splice
        svgEl.querySelectorAll('.break-fusion-btn[data-splice="' + spliceId + '"]').forEach(g => g.remove());
        // Clear has-fusion on affected ports
        svgEl.querySelectorAll('.fiber-dot-inner[data-has-fusion="true"]').forEach(d => {
          // Check if this port still has a connection
          d.setAttribute('data-has-fusion', 'false');
        });
        // Remove glow elements — solo del splice eliminado
        svgEl.querySelectorAll('.fiber-dot-glow, .fl-dot, .active-dot').forEach(g => {
          var sId = g.getAttribute('data-splice');
          if (!sId || sId === String(spliceId)) g.remove();
        });
        // Remove pulse class solo del splice eliminado
        svgEl.querySelectorAll('.fl[data-splice="' + spliceId + '"]').forEach(p => p.classList.remove('active-pulse', 'data-flow'));
      }
      showToast('\u2714 Splice #' + spliceId + ' roto');
    })
    .catch(e => showToast('\u274c ' + e.message));
}

function confirmBreakFusion(fusionId) {
  // Direct break from the ✂️ icon — shows confirmation then breaks immediately
  showModal('✂️ Romper empalme', 
    '<p style="color:#ccc;margin:12px 0">¿Estás seguro de romper este empalme #' + fusionId + '?</p>' +
    '<p style="color:#888;font-size:12px;margin-bottom:16px">Los hilos quedarán libres para fusionarse con otra fibra o splitter.</p>' +
    '<div class="btn-group">' +
      '<button class="btn-danger" onclick="doBreakFusion(' + fusionId + ')">✂️ Romper</button>' +
      '<button class="btn-secondary" onclick="closeModal()">Cancelar</button>' +
    '</div>'
  );
}

function doBreakFusion(fusionId) {
  closeModal();
  fetch(API + '/fusions/' + fusionId, { method: 'DELETE' })
    .then(r => {
      if (!r.ok) throw new Error('Error al romper');
      // Full visualizer refresh to ensure all power indicators sync correctly
      closeModal();
      if (state.currentVisualizerId && state.currentVisualizerType) {
        var vid = state.currentVisualizerId;
        var vtype = state.currentVisualizerType;
        setTimeout(function() {
          if (vtype === 'nap') openMangaVisualizer(vid, 'nap');
          else openMangaVisualizer(vid);
        }, 50);
      }
    })
    .catch(e => showToast('\u274c ' + e.message));
}

async function deleteSpliceThenRefresh(spliceId) {
  closeModal();
  showModal('✂️ Romper empalme', 
    '<p style="color:#ccc;margin:12px 0">¿Estás seguro de romper este empalme #' + spliceId + '?</p>' +
    '<div class="btn-group">' +
      '<button class="btn-danger" onclick="doDeleteSpliceThenRefresh(' + spliceId + ')">✂️ Romper</button>' +
      '<button class="btn-secondary" onclick="closeModal()">Cancelar</button>' +
    '</div>'
  );
}

async function doDeleteSpliceThenRefresh(spliceId) {
  closeModal();
  try {
    await fetch(API + '/splices/' + spliceId, { method: 'DELETE' });
    // Dynamic removal instead of full refresh
    const svgEl = document.querySelector('#vis-svg svg');
    if (svgEl) {
      svgEl.querySelectorAll('.fl[data-splice="' + spliceId + '"]').forEach(p => p.remove());
      svgEl.querySelectorAll('.break-fusion-btn[data-splice="' + spliceId + '"]').forEach(g => g.remove());
      svgEl.querySelectorAll('.fiber-dot-inner[data-has-fusion="true"]').forEach(d => {
        d.setAttribute('data-has-fusion', 'false');
      });
      svgEl.querySelectorAll('.fiber-dot-glow, .fl-dot, .active-dot').forEach(g => {
        var sId = g.getAttribute('data-splice');
        if (!sId || sId === String(spliceId)) g.remove();
      });
      svgEl.querySelectorAll('.fl[data-splice="' + spliceId + '"]').forEach(p => p.classList.remove('active-pulse', 'data-flow'));
    }
    // Refresh completo del visualizador
    if (typeof state !== 'undefined' && state.currentVisualizerId) {
      var vid = state.currentVisualizerId;
      var vtype = state.currentVisualizerType;
      setTimeout(function() {
        if (vtype === 'nap') openMangaVisualizer(vid, 'nap');
        else openMangaVisualizer(vid);
      }, 50);
    }
    showToast('✅ Splice roto');
  } catch(e) {
    showToast('❌ Error: ' + e.message);
  }
}

async function breakFusion(fusionId) {
  closeModal();
  showModal('✂️ Romper empalme', 
    '<p style="color:#ccc;margin:12px 0">¿Estás seguro de romper este empalme #' + fusionId + '?</p>' +
    '<p style="color:#888;font-size:12px;margin-bottom:16px">Los hilos quedarán libres para fusionarse con otra fibra o splitter.</p>' +
    '<div class="btn-group">' +
      '<button class="btn-danger" onclick="doBreakFusionDirect(' + fusionId + ')">✂️ Romper</button>' +
      '<button class="btn-secondary" onclick="closeModal()">Cancelar</button>' +
    '</div>'
  );
}

async function doBreakFusionDirect(fusionId) {
  closeModal();
  try {
    const res = await fetch(API + '/fusions/' + fusionId, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error al romper empalme');
    }
    // Dynamic removal instead of close + reopen
    const svgEl = document.querySelector('#vis-svg svg');
    if (svgEl) {
      // Extraer datos ANTES de borrar los paths
      var pathsData = [];
      svgEl.querySelectorAll('.fl[data-fusion="' + fusionId + '"]').forEach(function(p) {
        pathsData.push({
          connIn: p.getAttribute('data-conn-in'),
          fiberIn: p.getAttribute('data-fiber-in'),
          connOut: p.getAttribute('data-conn-out'),
          fiberOut: p.getAttribute('data-fiber-out')
        });
        p.remove();
      });
      svgEl.querySelectorAll('.break-fusion-btn[data-fusion="' + fusionId + '"]').forEach(function(g) { g.remove(); });
      // Reset dots: solo quitar fusion, NO tocar potencia
      // La potencia se reevalua desde el servidor abajo
      pathsData.forEach(function(pd) {
        if (pd.connIn && pd.fiberIn) {
          svgEl.querySelectorAll('.fiber-dot-inner[data-cable-conn="' + pd.connIn + '"][data-fiber-num="' + pd.fiberIn + '"]').forEach(function(d) {
            d.setAttribute('data-has-fusion', 'false');
          });
        }
        if (pd.connOut && pd.fiberOut) {
          svgEl.querySelectorAll('.fiber-dot-inner[data-cable-conn="' + pd.connOut + '"][data-fiber-num="' + pd.fiberOut + '"]').forEach(function(d) {
            d.setAttribute('data-has-fusion', 'false');
          });
        }
      });
      // Limpiar fiber-connected class en grupos que ya no tienen fusion
      svgEl.querySelectorAll('.fiber-dot-group.fiber-connected').forEach(function(g) {
        var inner = g.querySelector('.fiber-dot-inner');
        if (inner && inner.getAttribute('data-has-fusion') !== 'true') {
          g.classList.remove('fiber-connected');
        }
      });
    }
    // Refresh completo del visualizador
    if (typeof state !== 'undefined' && state.currentVisualizerId) {
      var vid = state.currentVisualizerId;
      var vtype = state.currentVisualizerType;
      setTimeout(function() {
        if (vtype === 'nap') openMangaVisualizer(vid, 'nap');
        else openMangaVisualizer(vid);
      }, 50);
    }
    showToast('\u2705 Empalme #' + fusionId + ' roto \u2014 hilos liberados');
  } catch(e) {
    showToast('\u274c ' + e.message);
  }
}

// ========== RE-EVALUAR POTENCIA DESDE EL SERVIDOR ==========
// Se llama despues de romper un empalme para que solo el lado OLT retenga potencia
async function refreshPowerDotsFromServer() {
  try {
    const res = await fetch(API + '/olts/hilos-con-potencia');
    if (!res.ok) return;
    const data = await res.json();
    const svgEl = document.querySelector('#vis-svg svg');
    if (!svgEl) return;
    
    // Construir set de pares (cable_point_id:fiber_number) con potencia
    var potSet = {};
    if (data.potencia && data.potencia.length > 0) {
      data.potencia.forEach(function(p) {
        var cpId = p.cable_point_id;
        if (!cpId) return;
        potSet[cpId + ':' + p.fiber_number] = true;
      });
    }
    
    // Re-marcar TODOS los fiber-dot-inner del SVG
    var allDots = svgEl.querySelectorAll('.fiber-dot-inner');
    allDots.forEach(function(dot) {
      var connId = dot.getAttribute('data-cable-conn');
      var fiberNum = dot.getAttribute('data-fiber-num');
      var key = connId + ':' + fiberNum;
      var hasPower = !!potSet[key];
      
      dot.setAttribute('data-has-power', hasPower ? 'true' : 'false');
      var g = dot.closest('.fiber-dot-group');
      if (g) {
        var j = g.querySelector('.fiber-jacket');
        if (j) {
          if (hasPower) {
            j.classList.add('fiber-powered');
          } else {
            j.classList.remove('fiber-powered');
          }
        }
      }
      
      // ⭐ Actualizar texto SVG (⚡#N vs #N) segun poder y fusion
      var fn = dot.getAttribute('data-fiber-num');
      var hasFusion = dot.getAttribute('data-has-fusion') === 'true';
      var dotY = parseFloat(dot.getAttribute('cy'));
      svgEl.querySelectorAll('text').forEach(function(tx) {
        var txY = parseFloat(tx.getAttribute('y'));
        if (isNaN(txY) || isNaN(dotY)) return;
        if (Math.abs(txY - dotY) > 4) return;
        if (tx.textContent.includes('#' + fn)) {
          if (hasPower && !hasFusion) {
            if (!tx.textContent.includes('\u26A1')) {
              tx.textContent = '\u26A1' + tx.textContent;
            }
          } else {
            tx.textContent = tx.textContent.replace(/^[\u26A1]+/, '');
          }
        }
      });
    });
    
    // Actualizar _activePowerMap para operaciones posteriores
    if (typeof _activePowerMap !== 'undefined') {
      _activePowerMap = {};
      if (data.potencia) {
        data.potencia.forEach(function(p) {
          var connId = p.cable_point_id;
          if (!connId) return;
          if (!_activePowerMap[connId]) _activePowerMap[connId] = {};
          _activePowerMap[connId][p.fiber_number] = true;
        });
      }
    }
    
    console.log('[POWER-REFRESH] Updated ' + allDots.length + ' fiber dots from server power data');
  } catch(e) {
    console.warn('[POWER-REFRESH] Error:', e.message);
  }
}

// ========== OLT CONNECTION BREAK ==========
function breakOLTConnection(connId) {
  showModal('✂️ Romper conexión OLT', 
    '<p style="color:#ccc;margin:12px 0">¿Estás seguro de romper esta conexión fibra→PON?</p>' +
    '<p style="color:#888;font-size:12px;margin-bottom:16px">El puerto PON quedará libre y la fibra podrá reconectarse a otro puerto.</p>' +
    '<div class="btn-group">' +
      '<button class="btn-danger" onclick="doBreakOLTConnection(' + connId + ')">✂️ Romper</button>' +
      '<button class="btn-secondary" onclick="closeModal()">Cancelar</button>' +
    '</div>'
  );
}

async function doBreakOLTConnection(connId) {
  closeModal();
  try {
    const res = await fetch(API + '/fibers/' + connId, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error al romper conexión');
    showToast('✅ Conexión rota');
    renderTree();
    var visId = state.currentVisualizerId;
    if (visId) refreshOLTVisualizer(visId);
  } catch(e) {
    showToast('❌ ' + e.message);
  }
}

// ========== DOBLE BUFFER PARA REFRESH SIN FLASH ==========
// Al recargar el SVG, mover el anterior a un hermano oculto
// para que el usuario nunca vea un area en blanco.
function swapSvgRender(wrapId, svgHtml) {
    var wrap = document.getElementById(wrapId);
    if (!wrap) return;
    var oldSvg = wrap.querySelector('svg');
    if (oldSvg) {
        // Crear o reusar un contenedor buffer hermano de wrap
        var parent = wrap.parentNode;
        var bufId = wrapId + '-buf';
        var buffer = document.getElementById(bufId);
        if (!buffer) {
            buffer = document.createElement('div');
            buffer.id = bufId;
            buffer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:10;background:#16161e;border-radius:8px;';
        }
        // Mover el SVG actual al buffer
        buffer.innerHTML = '';
        buffer.appendChild(oldSvg);
        parent.appendChild(buffer);
        // Renderizar nuevo SVG en el wrap (debajo del buffer)
        wrap.innerHTML = svgHtml;
        // Quitar buffer cuando el nuevo SVG ya se renderizo
        requestAnimationFrame(function() {
            if (buffer && buffer.parentNode) {
                buffer.parentNode.removeChild(buffer);
            }
        });
    } else {
        wrap.innerHTML = svgHtml;
    }
}

// ========== NAP VISUALIZER ENHANCEMENTS ==========
// Add power monitoring badge to NAP ports
function updateNapPortPower(napId, portNum, powerLevel) {
  const svg = document.querySelector('#vis-svg svg');
  if (!svg) return;
  const portEl = svg.querySelector(`.nap-port[data-port="${portNum}"]`);
  if (!portEl) return;
  
  let badgeClass = 'power-badge-unknown';
  if (powerLevel >= -20) badgeClass = 'power-badge-good';
  else if (powerLevel >= -25) badgeClass = 'power-badge-warn';
  else badgeClass = 'power-badge-bad';
  
  // Update or create power badge
  let badge = portEl.querySelector('.port-power-badge');
  if (!badge) {
    badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    badge.classList.add('port-power-badge');
    const bbox = portEl.getBBox();
    badge.setAttribute('x', bbox.x + bbox.width + 5);
    badge.setAttribute('y', bbox.y + 5);
    badge.setAttribute('font-size', '9');
    portEl.appendChild(badge);
  }
  badge.textContent = powerLevel.toFixed(1) + 'dBm';
  badge.setAttribute('fill', powerLevel >= -20 ? '#00ff88' : powerLevel >= -25 ? '#ffaa00' : '#e94560');
}

// ========== NETWORK HEALTH DASHBOARD ==========
function showNetworkHealth() {
  const activeFibers = document.querySelectorAll('.fl.active-pulse').length;
  const totalFusions = document.querySelectorAll('.fl').length;
  const goodPower = document.querySelectorAll('.fl[data-fusion-power]').length;
  
  openModal(`
    <h3>📊 Salud de la Red</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0">
      <div style="background:#16213e;padding:16px;border-radius:8px;text-align:center">
        <div style="font-size:28px;color:#00ff88">${activeFibers}</div>
        <div style="font-size:11px;color:#888">Fibras Activas ⚡</div>
      </div>
      <div style="background:#16213e;padding:16px;border-radius:8px;text-align:center">
        <div style="font-size:28px;color:#00d4ff">${totalFusions}</div>
        <div style="font-size:11px;color:#888">Empalmes Totales</div>
      </div>
      <div style="background:#16213e;padding:16px;border-radius:8px;text-align:center">
        <div style="font-size:28px;color:#ffaa00">${goodPower}</div>
        <div style="font-size:11px;color:#888">Con Potencia 📡</div>
      </div>
      <div style="background:#16213e;padding:16px;border-radius:8px;text-align:center">
        <div style="font-size:28px;color:#e94560">${state.mangas.length + state.naps.length}</div>
        <div style="font-size:11px;color:#888">Puntos de Red 🏗️</div>
      </div>
    </div>
    <div class="btn-group">
      <button class="btn-primary" onclick="closeModal()">Cerrar</button>
    </div>
  `);
}

// ========== TOMODAT-STYLE FUNCTIONS ==========

// Tab switching
function switchTab(tab) {
  document.querySelectorAll('.top-tab').forEach(t => t.classList.remove('active'));
  const tabEl = document.getElementById('tab-' + tab);
  if (tabEl) tabEl.classList.add('active');
  
  if (tab === 'mapa') {
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('map-container').style.display = '';
    setTimeout(() => map.invalidateSize(), 100);
  } else {
    // For other tabs, we could show different panels
    showToast('📌 Módulo "' + tab + '" en desarrollo — usa la pestaña Mapa');
  }
}

// Tree filter
let _filterTimer = null;
function filterTree(query) {
  clearTimeout(_filterTimer);
  _filterTimer = setTimeout(() => {
    renderTree(query);
  }, 200);
}

// Auto-fit map to show all markers
function autoFitMap() {
  const allMarkers = [];
  Object.values(state.markers).forEach(arr => allMarkers.push(...arr));
  
  if (allMarkers.length > 1) {
    const group = L.featureGroup(allMarkers);
    map.fitBounds(group.getBounds().pad(0.1));
  } else if (allMarkers.length === 1) {
    const m = allMarkers[0];
    map.setView(m.getLatLng(), 15);
  } else {
    map.setView([18.4861, -69.9312], 13);
  }
  
  document.getElementById('btn-auto-fit').classList.add('active');
  setTimeout(() => document.getElementById('btn-auto-fit').classList.remove('active'), 500);
}

// New item dialog (quick add from sidebar)
function showNewItemDialog() {
  const activeFolder = state.activeFolderId ? state.folders.find(f => f.id == state.activeFolderId) : null;
  openModal(`
    <h3>➕ Nuevo Elemento</h3>
    ${activeFolder ? `<p style="font-size:12px;color:#4CAF50;margin-bottom:10px">📂 Se agregará a: <strong>${escHtml(activeFolder.name)}</strong></p>` : '<p style="font-size:12px;color:#888;margin-bottom:10px">📂 Sin carpeta activa — doble clic en carpeta para activarla</p>'}
    <label>Tipo</label>
    <select id="f-new-type">
      <option value="olt">⚡ OLT</option>
      <option value="nap">📦 NAP</option>
      <option value="manga">🧶 Manga</option>
      <option value="cable">🔌 Cable</option>
    </select>
    <label>Nombre</label>
    <input id="f-new-name" placeholder="Nombre del elemento" />
    <p style="font-size:12px;color:#888;margin-top:8px">💡 El elemento se creará sin ubicación. Después puedes arrastrarlo al mapa.</p>
    <div class="btn-group">
      <button class="btn-primary" onclick="quickCreateNewItem()">Crear</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

async function quickCreateNewItem() {
  const type = document.getElementById('f-new-type').value;
  const name = document.getElementById('f-new-name').value;
  if (!name) { showToast('❌ El nombre es obligatorio'); return; }
  
  // Default coordinates (center of current map view)
  const center = map.getCenter();
  const lat = center.lat;
  const lng = center.lng;
  
  try {
    let result;
    if (type === 'olt') {
      result = await api('/olts', 'POST', { name, lat, lng, description: '', brand: '', model: '', ports_count: 0 });
    } else if (type === 'nap') {
      result = await api('/naps', 'POST', { name, lat, lng, description: '', splitter_type_id: 3, port_capacity: 8 });
    } else if (type === 'manga') {
      result = await api('/mangas', 'POST', { name, lat, lng, description: '' });
    } else if (type === 'cable') {
      result = await api('/cables', 'POST', { name });
    }
    closeModal();
    // Auto-assign to active folder (TOMODAT style)
    if (result && result.id && state.activeFolderId) {
      await askAddToFolder(type, result.id);
    }
    showToast('✅ ' + type.toUpperCase() + ' "' + name + '" creado' + (state.activeFolderId ? ' en carpeta activa' : ''));
    loadAll();
  } catch(e) {
    showToast('❌ Error al crear: ' + e.message);
  }
}

// Show add marker dialog at map position
function showAddMarkerDialog() {
  const center = map.getCenter();
  state.pendingLat = center.lat;
  state.pendingLng = center.lng;
  const activeFolder = state.activeFolderId ? state.folders.find(f => f.id == state.activeFolderId) : null;
  
  openModal(`
    <h3>➕ Agregar elemento en ubicación actual</h3>
    <p style="font-size:12px;color:#888;margin-bottom:12px">📍 ${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}</p>
    ${activeFolder ? `<p style="font-size:12px;color:#4CAF50;margin-bottom:10px">📂 Se agregará a carpeta: <strong>${escHtml(activeFolder.name)}</strong></p>` : ''}
    <label>Tipo</label>
    <select id="f-add-type">
      <option value="olt">⚡ OLT</option>
      <option value="nap">📦 NAP</option>
      <option value="manga">🧶 Manga</option>
    </select>
    <label>Nombre</label>
    <input id="f-add-name" />
    <label>Descripción</label>
    <textarea id="f-add-desc" rows="2"></textarea>
    <div class="btn-group">
      <button class="btn-primary" onclick="addMarkerAtMapCenter()">Agregar</button>
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

// ====== MOBILE FUNCTIONS ======
function mobileShowAddOptions() {
  var name = prompt('📦 Nombre de la NAP:', 'NAP-' + (state.naps.length + 1));
  if (!name) return;
  var center = map.getCenter();
  mobileAddNAP(center.lat, center.lng, name);
}

async function mobileAddNAP(lat, lng, name) {
  showToast('📦 Agregando NAP...');
  try {
    var result = await api('/naps', 'POST', { name: name, lat: lat, lng: lng, description: '' });
    if (result && result.id && state.activeFolderId) {
      await askAddToFolder('nap', result.id);
    }
    showToast('✅ ' + name + ' creada' + (state.activeFolderId ? ' en carpeta activa' : ''));
    loadAll();
  } catch(e) {
    showToast('❌ Error: ' + e.message);
  }
}

async function addMarkerAtMapCenter() {
  const type = document.getElementById('f-add-type').value;
  const name = document.getElementById('f-add-name').value;
  const desc = document.getElementById('f-add-desc').value;
  if (!name) { showToast('❌ El nombre es obligatorio'); return; }
  
  try {
    let result;
    if (type === 'olt') {
      result = await api('/olts', 'POST', { name, lat: state.pendingLat, lng: state.pendingLng, description: desc });
    } else if (type === 'nap') {
      result = await api('/naps', 'POST', { name, lat: state.pendingLat, lng: state.pendingLng, description: desc });
    } else if (type === 'manga') {
      result = await api('/mangas', 'POST', { name, lat: state.pendingLat, lng: state.pendingLng, description: desc });
    }
    closeModal();
    // Auto-assign to active folder (TOMODAT style)
    if (result && result.id && state.activeFolderId) {
      await askAddToFolder(type, result.id);
    }
    showToast('✅ ' + name + ' creado' + (state.activeFolderId ? ' en carpeta activa' : ''));
    loadAll();
  } catch(e) {
    showToast('❌ Error: ' + e.message);
  }
}

// Cable fiber preview dialog
function showCableFiberPreviewDialog() {
  const fiberCount = parseInt(prompt('Número de fibras:', '12')) || 12;
  showModal('🔌 Preview de fibras (' + fiberCount + 'f) — TIA/EIA-598', getFiberPreviewHtml(fiberCount));
}

// ========== TOGGLE SPLITTER SIDE (flip input ↔ outputs) ==========
function toggleSplitterBlockSide(block) {
  // In-place mirror of the triangle and all its elements.
  // The flip state was already toggled by toggleBlockSide (data-flipped).
  
  const poly = block.querySelector('polygon');
  if (!poly) return;
  const pts = poly.getAttribute('points').trim().split(/\s+/);
  if (pts.length < 3) return;
  const coords = pts.map(p => p.split(',').map(parseFloat));
  const allX = coords.map(c => c[0]);
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const centerX = (minX + maxX) / 2;
  
  // Mirror each point across center
  const newPts = coords.map(c => (2 * centerX - c[0]) + ',' + c[1]);
  poly.setAttribute('points', newPts.join(' '));
  
  // Mirror all fiber-dot-group elements (input port + output ports)
  block.querySelectorAll('.fiber-dot-group').forEach(g => {
    g.querySelectorAll('circle').forEach(c => {
      const cx = parseFloat(c.getAttribute('cx'));
      if (!isNaN(cx)) c.setAttribute('cx', 2 * centerX - cx);
    });
    g.querySelectorAll('rect').forEach(r => {
      const rx = parseFloat(r.getAttribute('x'));
      if (!isNaN(rx)) {
        const rw = parseFloat(r.getAttribute('width')) || 0;
        r.setAttribute('x', 2 * centerX - (rx + rw));
      }
    });
  });
  
  // Mirror text labels (but NOT splitter buttons which stay centered)
  block.querySelectorAll('text').forEach(t => {
    if (t.closest('.splitter-btn')) return;
    const tx = parseFloat(t.getAttribute('x'));
    if (!isNaN(tx)) {
      t.setAttribute('x', 2 * centerX - tx);
      const anchor = t.getAttribute('text-anchor');
      if (anchor === 'end') t.setAttribute('text-anchor', 'start');
      else if (anchor === 'start') t.setAttribute('text-anchor', 'end');
    }
  });
  
  // ⭐ Actualizar el indicador de orientación en el centro
  // Cambiar el carácter ▶/◀ y los colores según la nueva orientación
  const isNowFlipped = block.getAttribute('data-flipped') === 'true';
  const orientCircle = block.querySelector('circle[orient-role="orient-bg"]');
  const orientText = block.querySelector('text[orient-role="orient-char"]');
  const orientTitle = block.querySelector('title');
  if (orientCircle) {
    orientCircle.setAttribute('stroke', isNowFlipped ? '#ff6b6b' : '#00ff88');
  }
  if (orientText) {
    orientText.textContent = isNowFlipped ? '◀' : '▶';
    orientText.setAttribute('fill', isNowFlipped ? '#ff6b6b' : '#00ff88');
  }
  if (orientTitle) {
    orientTitle.textContent = isNowFlipped ? '← Apunta a la IZQUIERDA' : '→ Apunta a la DERECHA';
  }
  
  // Recalculate all fusion/splice lines
  if (typeof _updateFusionBlockFn === 'function') {
    const svgEl = document.querySelector('#vis-svg svg');
    if (svgEl) svgEl.querySelectorAll('.vis-block').forEach(b => _updateFusionBlockFn(b));
  }
  saveBlockPositions();
  showToast('🔄 Splitter ' + (isNowFlipped ? '◀ IZQUIERDA' : '▶ DERECHA'));
}

// ========== TOGGLE BLOCK SIDE (flip between left ↔ right) ==========
function toggleBlockSide(blockIdx) {
  console.log('[FLIP] toggleBlockSide llamado con blockIdx=' + blockIdx);
  const svgEl = document.querySelector('#vis-svg svg');
  if (!svgEl) { console.log('[FLIP] SVG no encontrado'); return; }
  const block = svgEl.querySelector(`.vis-block[data-block-idx="${blockIdx}"]`);
  if (!block) { console.log('[FLIP] Block no encontrado: ' + blockIdx); return; }
  if (!block) return;
  
  // Toggle flipped state
  const isFlipped = block.getAttribute('data-flipped') === 'true';
  block.setAttribute('data-flipped', isFlipped ? 'false' : 'true');
  
  // Save immediately so refresh reads the correct state
  saveBlockPositions();
  
  console.log('[FLIP] flipped=' + block.getAttribute('data-flipped') + ' visId=' + state.currentVisualizerId + ' visType=' + state.currentVisualizerType);
  // ⭐ REFRESCAR visualizer completo
  const visId = state.currentVisualizerId;
  const visType = state.currentVisualizerType;
  if (!visId) { console.log('[FLIP] visId vacio'); return; }
  if (visType === 'manga' || visType === 'nap') {
    console.log('[FLIP] Refrescando manga/nap visId=' + visId);
    openMangaVisualizer(visId, visType === 'nap' ? 'nap' : undefined);
  } else if (visType === 'olt') {
    console.log('[FLIP] Refrescando OLT visId=' + visId);
    openOLTVisualizer(visId);
  } else {
    console.log('[FLIP] visType desconocido: ' + visType);
  }
  const isSpl = blockIdx && blockIdx.startsWith('splitter-');
  showToast('🔄 ' + (isSpl ? 'Splitter' : 'Cable') + ' ' + (block.getAttribute('data-flipped') === 'true' ? '◀ IZQUIERDA' : '▶ DERECHA'));
}

// ========== OLT VISUALIZER (SVG visualizer with card management) ==========
let _oltRefreshGuard = false;
// Cards data fetched from API, cached per visualizer load
let _oltCardsCache = [];
// Hilos fuente (con potencia directa desde OLT), usado en manga visualizer
var _oltHilosFuente = {};

function buildOLTCardData(ports, oltId) {
  // Use cards from API cache instead of localStorage
  if (_oltCardsCache.length > 0 && ports.length > 0) {
    return _oltCardsCache.map(function(card) {
      var cardPorts = ports.filter(function(p) { return parseInt(p.card_id) === card.id; });
      cardPorts.sort(function(a,b) { return a.port_number - b.port_number; });
      return { startPort: 1, count: card.ports_count, ports: cardPorts, cardId: card.id, cardName: card.name, slotNumber: card.slot_number };
    });
  }
  if (ports.length > 0) {
    return [{ startPort: 1, count: ports.length, ports: ports, cardId: null, cardName: 'Card 1', slotNumber: 1 }];
  }
  return [];
}

async function openOLTVisualizer(oltId) {
  if (!oltId) { showToast('❌ Error: ID de OLT inválido'); return; }
  if (_oltRefreshGuard) { setTimeout(() => openOLTVisualizer(oltId), 100); return; }
  _oltRefreshGuard = true;
  
  try {
    showToast('⚡ Cargando OLT...');
    const [oltData, fetchedCards] = await Promise.all([
      api('/olts/' + oltId + '/connections'),
      api('/olts/' + oltId + '/cards').catch(function() { return { cards: [] }; })
    ]);
    _oltCardsCache = fetchedCards.cards || [];
    if (!oltData || !oltData.olt) { showToast('❌ OLT no encontrada'); _oltRefreshGuard = false; return; }
    
    const olt = oltData.olt;
    let ports = oltData.ports || [];
    let connections = oltData.connections || [];
    
    // Fetch cable points for this OLT
    const cablePoints = await fetch(API + '/cable-points?element_type=olt&element_id=' + oltId).then(r => r.json());
    
    // Build cable fiber data (like manga visualizer) — save to state for createOLTConnection
    var cableFiberData = [];
    for (const cp of cablePoints) {
      const cable = state.cables.find(c => c.id == cp.cable_id);
      if (!cable) continue;
      let cableFibers = [];
      try {
        cableFibers = await fetch(API + '/cables/' + cp.cable_id + '/fibers').then(r => r.json());
      } catch(e) {}
      cableFiberData.push({
        cableConnectionId: cp.id,
        cableId: cp.cable_id,
        cableName: cable.name,
        fiberCount: cable.fiber_count || cableFibers.length || 12,
        fibers: cableFibers
      });
    }
    state._oltCableFiberData = cableFiberData;
    
    state.currentVisualizerType = 'olt';
    state.currentVisualizerId = oltId;
    
    // ====== SVG RENDER ======
    const w = 1600;
    const leftStartX = 60;
    const leftCableBlockW = 140;
    const oltCardStartX = leftStartX + leftCableBlockW + 40;
    const oltCardW = 220;
    const cardLabelH = 26;
    const cardPortSpacing = 20;
    var cardsData = buildOLTCardData(ports, oltId);
    // Calculate required SVG height first (based on cable & card content)
    var minCableH = cableFiberData.length > 0 ? cableFiberData.length * 180 + 40 : 60;
    var minCardH = 50;
    cardsData.forEach(function(cd, ci) {
      var ch = cardLabelH + cd.ports.length * cardPortSpacing + cardPortSpacing;
      var bt = 50 + ci * (cardLabelH + cd.ports.length * cardPortSpacing + cardPortSpacing + 6);
      var ce = bt + ch + 20;
      if (ce > minCardH) minCardH = ce;
    });
    const h = Math.max(1000, minCableH, minCardH);
    const blockH = Math.min(350, Math.max(120, Math.floor((h - 80) / Math.max(cableFiberData.length, 1))));
    
    let svgLines = '';
    let svgDefs = '';
    
    // === LEFT CABLE BLOCKS (simple version) ===
    cableFiberData.forEach((cd, idx) => {
      const blockTop = 60 + idx * (blockH + 20);
      const maxFibers = Math.min(cd.fibers.length || cd.fiberCount, 18);
      const fSpacing = Math.min(24, (blockH - 36) / maxFibers);
      
      svgLines += '<g class="vis-block" transform="translate(0,0)" data-block-idx="olt-cable-' + idx + '">';
      svgLines += '<rect x="' + leftStartX + '" y="' + blockTop + '" width="' + leftCableBlockW + '" height="' + blockH + '" rx="6" fill="#1a1a2e" stroke="#533483" stroke-width="2" />';
      svgLines += '<rect class="flip-side-btn-bg" x="' + (leftStartX + leftCableBlockW - 22) + '" y="' + (blockTop + 4) + '" width="20" height="20" rx="4" fill="#3a3f4b" stroke="#555" stroke-width="1" style="cursor:pointer" onclick="toggleBlockSide(\'olt-cable-' + idx + '\')" />';
      svgLines += '<text class="flip-side-btn" x="' + (leftStartX + leftCableBlockW - 12) + '" y="' + (blockTop + 17) + '" fill="#00d4ff" font-family="sans-serif" font-size="13" text-anchor="middle" pointer-events="none">\uD83D\uDD04</text>';
      svgLines += '<text x="' + (leftStartX + leftCableBlockW/2) + '" y="' + (blockTop + 16) + '" text-anchor="middle" fill="#ffaa00" font-family="sans-serif" font-size="10" font-weight="bold">' + escHtml(cd.cableName) + '</text>';
      svgLines += '<line x1="' + (leftStartX + 8) + '" y1="' + (blockTop + 24) + '" x2="' + (leftStartX + leftCableBlockW - 8) + '" y2="' + (blockTop + 24) + '" stroke="#533483" stroke-width="1" />';
      
      for (let fi = 1; fi <= maxFibers; fi++) {
        const fy = blockTop + 32 + fi * fSpacing;
        const col = tiaColor(fi);
        const portX = leftStartX + leftCableBlockW - 4;
        const hasConn = connections.some(c => c.fiber_number === fi && c.cable_id == cd.cableId);
        const border = (col === '#ffffff' || col === '#f5d442') ? '#888' : col;
        const coreCol = (col === '#ffffff' || col === '#f5d442') ? '#333' : '#fff';
        
        // === FIBER PIGTAIL (unified style: same as manga blocks) ===
        var jacketW = 32, jacketH = 16;
        var jacketX = portX - jacketW + 4;
        var jacketY = fy - jacketH/2;
        
        var dotCursor = hasConn ? 'default' : 'pointer';
        var dotGroupClass = 'fiber-dot-group' + (hasConn ? ' fiber-connected' : '');
        svgLines += '<g class="' + dotGroupClass + '">';
        // Jacket (colored rect)
        svgLines += '<rect x="' + jacketX + '" y="' + jacketY + '" width="' + jacketW + '" height="' + jacketH + '" rx="4" fill="' + col + '" stroke="' + border + '" stroke-width="2" class="fiber-jacket" />';
        // Core (white circle inside jacket)
        svgLines += '<circle cx="' + (jacketX + jacketW/2) + '" cy="' + fy + '" r="5" fill="' + coreCol + '" opacity="0.9" class="fiber-core" />';
        // Ferrule at the port
        svgLines += '<rect x="' + (portX - 4) + '" y="' + (fy - 6) + '" width="10" height="12" rx="3" fill="#888" stroke="#666" stroke-width="1.5" opacity="0.9" />';
        svgLines += '<circle class="fiber-dot-inner" cx="' + portX + '" cy="' + fy + '" r="32" fill="transparent" style="pointer-events:all;cursor:' + dotCursor + '" stroke="transparent" stroke-width="2" data-original-stroke="' + border + '" data-cable-conn="' + cd.cableConnectionId + '" data-fiber-num="' + fi + '" data-has-fusion="' + hasConn + '" />';
        svgLines += '<text x="' + (portX - 42) + '" y="' + (fy + 4) + '" fill="#aaa" font-family="sans-serif" font-size="9" pointer-events="none">#' + fi + '</text>';
        svgLines += '</g>';
      }
      svgLines += '</g>';
    });
    
    // === OLT PORT CARDS (vars already defined in height calc above) ===
    var oltStartY = 50;
    var oltCardGap = 6;
    
    // Toolbar moved to HTML bar (vis-title + vis-splitter-info)
    
        // Render each card
    cardsData.forEach(function(cd, ci) {
      var blockTop = 50 + ci * (cardLabelH + cd.ports.length * cardPortSpacing + cardPortSpacing + 6);
      var cardH = cardLabelH + cd.ports.length * cardPortSpacing + cardPortSpacing;
      
      svgLines += '<g class="vis-block" transform="translate(0,0)" data-block-idx="olt-card-' + oltId + '-' + ci + '">';
      svgLines += '<rect x="' + oltCardStartX + '" y="' + blockTop + '" width="' + oltCardW + '" height="' + cardH + '" rx="5" fill="#1a1a2e" stroke="#e94560" stroke-width="1.5" />';
      
      // Header
      var onlineCount = cd.ports.filter(function(p) { return p.operational_status === 'Online'; }).length;
      svgLines += '<text x="' + (oltCardStartX + 6) + '" y="' + (blockTop + 13) + '" fill="#e94560" font-family="sans-serif" font-size="9" font-weight="bold">🎴 Tarjeta ' + (ci + 1) + '</text>';
      svgLines += '<text x="' + (oltCardStartX + oltCardW - 50) + '" y="' + (blockTop + 13) + '" fill="#888" font-family="sans-serif" font-size="8">' + cd.ports.length + 'P</text>';
      if (onlineCount > 0) svgLines += '<text x="' + (oltCardStartX + oltCardW - 30) + '" y="' + (blockTop + 13) + '" fill="#4CAF50" font-family="sans-serif" font-size="8">●' + onlineCount + '</text>';
      // Delete card button (using cardId from API)
      var cardIdToDelete = cd.cardId || 'null';
      svgLines += '<g style="cursor:pointer" onclick="if(confirm(\'¿Eliminar esta tarjeta de ' + cd.ports.length + ' puertos? Se perderán las conexiones.\')) removeOLTCard(' + oltId + ', ' + cardIdToDelete + ', ' + cd.ports.length + ')">';
      svgLines += '<rect x="' + (oltCardStartX + oltCardW - 20) + '" y="' + (blockTop + 2) + '" width="16" height="16" rx="3" fill="rgba(244,67,54,0.2)" stroke="rgba(244,67,54,0.5)" stroke-width="1" />';
      svgLines += '<text x="' + (oltCardStartX + oltCardW - 12) + '" y="' + (blockTop + 14) + '" text-anchor="middle" fill="#f44336" font-family="sans-serif" font-size="12" pointer-events="none">🗑️</text>';
      svgLines += '</g>';
      
      // Render ports
      cd.ports.forEach(function(port, pi) {
        var py = blockTop + 22 + pi * cardPortSpacing;
        var conn = connections.find(function(c) { return parseInt(c.source_olt_port_id) === port.id; });
        var fiberNum = conn ? conn.fiber_number : null;
        
        // Port number
        svgLines += '<text x="' + (oltCardStartX + 5) + '" y="' + (py + 3) + '" fill="#ccc" font-family="sans-serif" font-size="8">P' + port.port_number + '</text>';
        
        // Status dot
        var stCol = port.operational_status === 'Online' ? '#4CAF50' : (port.operational_status === 'Offline' ? '#f44336' : '#555');
        svgLines += '<circle cx="' + (oltCardStartX + 22) + '" cy="' + py + '" r="2.5" fill="' + stCol + '" />';
        
        // Power — click to edit
        if (port.power > 0) {
          var pwStyle = port.operational_status === 'Online' ? '#4CAF50' : '#888';
          var pwText = port.power.toFixed(1) + 'dBm';
          if (port.operational_status !== 'Online' && port.power === 2.5) {
            // Likely default value — show in different color
            pwStyle = '#666';
            pwText = port.power.toFixed(1) + 'dBm*';
          }
          svgLines += '<g style="cursor:pointer" onclick="editOLTPortPower(' + port.id + ', ' + oltId + ', ' + port.power + ')">';
          svgLines += '<text x="' + (oltCardStartX + 28) + '" y="' + (py + 3) + '" fill="' + pwStyle + '" font-family="monospace" font-size="7" data-port-power="' + port.id + '">' + pwText + '</text>';
          svgLines += '</g>';
        } else {
          svgLines += '<g style="cursor:pointer" onclick="editOLTPortPower(' + port.id + ', ' + oltId + ', 0)">';
          svgLines += '<text x="' + (oltCardStartX + 28) + '" y="' + (py + 3) + '" fill="#555" font-family="monospace" font-size="7" data-port-power="' + port.id + '">0.0dBm</text>';
          svgLines += '</g>';
        }
        
        // ONUs count
        if (port.online_onus_count > 0) {
          svgLines += '<text x="' + (oltCardStartX + 72) + '" y="' + (py + 3) + '" fill="#8bc34a" font-family="sans-serif" font-size="7">ONU:' + port.online_onus_count + '</text>';
        }
        // Delete individual port button
        svgLines += '<g style="cursor:pointer" onclick="if(confirm(\'¿Eliminar puerto P' + port.port_number + '?\')) removeOLTPort(' + port.id + ', ' + oltId + ')">';
        svgLines += '<rect x="' + (oltCardStartX + oltCardW - 16) + '" y="' + (py - 5) + '" width="12" height="12" rx="2" fill="transparent" stroke="rgba(244,67,54,0.3)" stroke-width="1" />';
        svgLines += '<text x="' + (oltCardStartX + oltCardW - 10) + '" y="' + (py + 5) + '" text-anchor="middle" fill="rgba(244,67,54,0.6)" font-family="sans-serif" font-size="9" pointer-events="none">✕</text>';
        svgLines += '</g>';
        
        // Connection indicator on LEFT edge
        var pX = oltCardStartX;
        if (fiberNum) {
          var fCol = tiaColor(fiberNum);
          svgLines += '<text x="' + (pX + 6) + '" y="' + (py + 3) + '" fill="' + fCol + '" font-family="sans-serif" font-size="7">#' + fiberNum + '</text>';
        }
        // Fiber dot group with hover animation (like cable fibers) — left edge
        var dotCol = fiberNum ? tiaColor(fiberNum) : '#555';
        var dotBorder = (dotCol === '#ffffff' || dotCol === '#f5d442') ? '#888' : dotCol;
        svgLines += '<g class="fiber-dot-group' + (fiberNum ? ' fiber-connected' : '') + '" style="cursor:pointer;">';
        svgLines += '<circle cx="' + pX + '" cy="' + py + '" r="6" fill="' + dotCol + '" stroke="' + dotBorder + '" stroke-width="1.5" class="fiber-jacket" />';
        var oltPortHasFusion = !!fiberNum;
        var oltPortCursor = oltPortHasFusion ? 'default' : 'pointer';
        svgLines += '<rect class="fiber-dot-inner" x="' + (pX - 30) + '" y="' + (py - 30) + '" width="60" height="60" rx="6" fill="transparent" style="pointer-events:all;cursor:' + oltPortCursor + '" stroke="transparent" stroke-width="2" data-original-stroke="transparent" data-olt-id="' + oltId + '" data-olt-port-id="' + port.id + '" data-olt-port-num="' + port.port_number + '" data-has-fusion="' + oltPortHasFusion + '" />';
        svgLines += '</g>';
      });
      svgLines += '</g>';
    });
    
    // === DRAW CONNECTION LINES ===
    connections.forEach(conn => {
      var cd2 = cableFiberData.find(function(c) { return c.cableId == conn.cable_id; });
      if (!cd2) return;
      
      var cableIdx = cableFiberData.indexOf(cd2);
      var blockTop2 = 60 + cableIdx * (blockH + 20);
      var maxFibers2 = Math.min(cd2.fibers.length || cd2.fiberCount, 18);
      var fSpacing2 = Math.min(24, (blockH - 36) / maxFibers2);
      var cableY = blockTop2 + 32 + conn.fiber_number * fSpacing2;
      
      var fromX = leftStartX + leftCableBlockW;
      var fromY = cableY;
      
      var port = ports.find(function(p) { return p.id == conn.source_olt_port_id; });
      if (!port) return;
      
      var toY2 = 0;
      cardsData.forEach(function(cd3, ci) {
        var pi2 = cd3.ports.indexOf(port);
        if (pi2 >= 0) {
          var bt = 50 + ci * (cardLabelH + cd3.ports.length * cardPortSpacing + cardPortSpacing + 6);
          toY2 = bt + 22 + pi2 * cardPortSpacing;
        }
      });
      if (!toY2) return;
      
      var toX = oltCardStartX;
      var midX = (fromX + toX) / 2;
      var cpOff = Math.max(Math.abs(toX - fromX) * 0.3, 30);
      
      var colCable = tiaColor(conn.fiber_number);
      var colPort = tiaColor(port.port_number);
      var strokeColor = colCable;
      if (colCable !== colPort) {
        var gId = 'og-' + conn.id;
        var gAttr = '<linearGradient id="' + gId + '" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="' + colCable + '" /><stop offset="50%" stop-color="' + colCable + '" /><stop offset="50%" stop-color="' + colPort + '" /><stop offset="100%" stop-color="' + colPort + '" /></linearGradient>';
        if (svgDefs.indexOf(gId) === -1) svgDefs += gAttr;
        strokeColor = 'url(#' + gId + ')';
      }
      
      var hasPower = port.operational_status === 'Online' || (port.power && port.power > 0);
      var animClass = hasPower ? 'active-pulse data-flow' : '';
      var powerVal = port.power && port.power > 0 ? '+' + port.power.toFixed(1) + ' dBm' : (port.operational_status === 'Online' ? 'Online' : 'Offline');
      var tooltipText = powerVal + ' | P' + port.port_number + ' → #' + conn.fiber_number;
      svgLines += '<path class="fl ' + animClass + '" d="M ' + fromX + ',' + fromY + ' C ' + (fromX + cpOff) + ',' + fromY + ' ' + (toX - cpOff) + ',' + toY2 + ' ' + toX + ',' + toY2 + '" stroke="' + strokeColor + '" stroke-width="4" opacity="0.8" fill="none" data-fiber-conn="' + conn.id + '" data-conn-in="' + cd2.cableConnectionId + '" data-fiber-in="' + conn.fiber_number + '" data-olt-port-id="' + port.id + '" title="' + escHtml(tooltipText) + '" />';
      
      // Power label on the line
      var mx = (fromX + toX) / 2;
      var my = (fromY + toY2) / 2;
      if (hasPower) {
        var displayPower = (port.power > 0 ? '+' : '') + port.power.toFixed(1);
        svgLines += '<text class="olt-power-label" x="' + mx + '" y="' + (my - 14) + '" text-anchor="middle" fill="#00ff88" font-family="sans-serif" font-size="11" font-weight="bold" stroke="#1a1a2e" stroke-width="3" paint-order="stroke" data-fiber-conn="' + conn.id + '">' + displayPower + ' dBm</text>';
      }
      
      // ✂️ Break fusion button at midpoint
      svgLines += '<g style="cursor:pointer" onclick="breakOLTConnection(' + conn.id + ')" class="break-fusion-btn" data-fiber-conn="' + conn.id + '">';
      svgLines += '<rect x="' + (mx - 12) + '" y="' + (my - 10) + '" width="24" height="20" rx="4" fill="#1a1a2e" stroke="#e94560" stroke-width="1" opacity="0.85" />';
      svgLines += '<text x="' + mx + '" y="' + (my + 4) + '" text-anchor="middle" fill="#e94560" font-family="sans-serif" font-size="13" font-weight="bold">\u2702\uFE0F</text>';
      svgLines += '</g>';
    });
// === LEFT INFO PANEL (estilo manga) ===
    let fibersHTML = '<div class="panel-section">';
    fibersHTML += '<h3 style="color:#e94560;margin:0 0 8px 0">⚡ ' + escHtml(olt.name) + '</h3>';
    fibersHTML += '<p style="font-size:12px;color:#aaa;margin:0 0 4px 0">' + escHtml(olt.brand || '') + ' ' + escHtml(olt.model || '') + '</p>';
    fibersHTML += '<p style="font-size:12px;color:#888;margin:0 0 8px 0">Tarjetas: ' + cardsData.length + ' · Puertos: ' + ports.length + '</p>';
    fibersHTML += '<p style="font-size:11px;color:#666;margin:0 0 8px 0">💡 Clic fibra del cable → clic puerto OLT para empalmar</p>';
    fibersHTML += '</div>';
    
    // Show card inputs first
    fibersHTML += '<div class="panel-section"><h4 style="color:#ffaa00;margin:0 0 8px 0">🔗 Puertos PON y Empalmes (' + connections.length + ')</h4>';
    cardsData.forEach(function(cd, ci) {
      cd.ports.forEach(function(port) {
        var conn = connections.find(function(c) { return c.source_olt_port_id == port.id; });
        var cableName = conn ? (state.cables.find(function(c) { return c.id == conn.cable_id; })?.name || 'Cable #' + conn.cable_id) : '';
        var col = tiaColor(port.port_number);
        var borderStyle = (col === '#ffffff' || col === '#ffd700') ? 'border-left: 3px solid ' + col + '; border-left-color: #666;' : 'border-left: 3px solid ' + col + ';';
        
        fibersHTML += '<div class="fiber-port ' + (port.operational_status === 'Online' ? 'active' : '') + ' ' + (conn ? 'connected' : '') + '" style="' + borderStyle + '">';
        fibersHTML += '<div class="port-number">Tarjeta ' + (ci + 1) + ' · P' + port.port_number + ' <span style="font-size:9px;color:#aaa">' + tiaColorName(port.port_number) + '</span></div>';
        fibersHTML += '<div class="port-status">' + (port.operational_status === 'Online' ? '🟢 Online' : (port.operational_status === 'Offline' ? '🔴 Offline' : '⚪ ' + port.operational_status)) + '</div>';
        if (port.power && port.power > 0) fibersHTML += '<div class="port-power">⚡ ' + port.power.toFixed(1) + ' dBm</div>';
        if (conn) fibersHTML += '<div class="port-status" style="color:#4CAF50">🔗 Fibra #' + conn.fiber_number + ' → ' + escHtml(cableName) + '</div>';
        fibersHTML += '</div>';
      });
    });
    if (cardsData.length === 0 || ports.length === 0) {
      fibersHTML += '<p style="text-align:center;padding:20px;color:#888;">⚡ Sin tarjetas. Agrega una desde 🎴 o importa desde ⬇</p>';
    }
    fibersHTML += '</div>';
    fibersHTML += '<div class="panel-section"><button class="btn-secondary" onclick="refreshOLTVisualizer(' + oltId + ')" style="width:100%;font-size:11px">🔄 Refrescar</button></div>';
    
    // Set HTML toolbar with OLT name, port count, and action buttons
    document.getElementById('vis-title').textContent = '⚡ ' + olt.name;
    document.getElementById('vis-power-info').innerHTML = '<span style="font-size:12px;color:#888">' + ports.length + ' puertos</span>';
    document.getElementById('vis-splitter-info').innerHTML = 
      '<button class="vis-inline-btn" onclick="showAddCardModal(' + oltId + ')" style="background:#1a4a2e;color:#66ff88;border:1px solid #4CAF50;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px">➕ Agregar</button> ' +
      '<button class="vis-inline-btn" onclick="showSmartOLTImportModal(' + oltId + ')" style="background:#2a4a6a;color:#66bbff;border:1px solid #4488cc;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px">⬇ Importar</button>';
    
    document.getElementById('vis-fibers').innerHTML = fibersHTML;
    document.getElementById('vis-fibers-title').innerHTML = '⚡ OLT <span class="vis-toggle-left" onclick="toggleVisLeft()">◀ Ocultar</span>';
    
    // === FINALIZE SVG & SET UP HANDLERS ===
    // Shift viewBox up so items (starting at y=40) are visible without scrolling
    var viewStartY = 40;
    var viewH = h - viewStartY;
    const svgContent = '<svg width="' + w + '" height="' + viewH + '" viewBox="0 ' + viewStartY + ' ' + w + ' ' + viewH + '" preserveAspectRatio="xMinYMin meet" style="background:#555;border-radius:8px;min-width:' + w + 'px;"><defs>' + svgDefs + '</defs>' + svgLines + '</svg>';
    const svgContainer = document.querySelector('#vis-svg');
    if (!svgContainer) { _oltRefreshGuard = false; return; }
    swapSvgRender('vis-svg', svgContent, w, h);
    // Restore previous viewBox if refreshing (preserves zoom/pan)
    if (_pendingOLTViewBox) {
      var newSvg = svgContainer.querySelector('svg');
      if (newSvg) newSvg.setAttribute('viewBox', _pendingOLTViewBox);
      _pendingOLTViewBox = null;
    }
    document.getElementById('vis-panel').classList.remove('hidden');
    setTimeout(initBlockDrag, 50);
    setTimeout(restoreBlockPositions, 150);
    
    // === CLICK HANDLERS for fiber selection + OLT port connection ===
    const svgEl = document.querySelector('#vis-svg svg');
    if (!svgEl) { showToast('⚠️ SVG no encontrado'); _oltRefreshGuard = false; return; }
    
    state.oltSelection = null;
    
    // Selection info banner (reuse existing or create)
    var selInfo = document.getElementById('vis-selection-info');
    if (!selInfo) {
      selInfo = document.createElement('div');
      selInfo.id = 'vis-selection-info';
      selInfo.style.cssText = 'display:none;padding:8px 14px;background:#16213e;border:1px solid #e94560;border-radius:6px;margin:6px 0;font-size:13px;color:#e0e0e0;text-align:center;';
      var tb = document.getElementById('vis-splitter-info');
      if (tb) tb.parentNode.insertBefore(selInfo, tb.nextSibling);
    }
    
    function clearOLTSelection() {
      state.oltSelection = null;
      // Remove temporary connection line
      if (typeof _connDrag !== 'undefined' && _connDrag && _connDrag.tempLine) {
        try { if (_connDrag.tempLine.parentNode) _connDrag.tempLine.parentNode.removeChild(_connDrag.tempLine); } catch(e) {}
        _connDrag.tempLine = null;
      }
      _connDrag = null;
      // Also remove any orphaned temp connection lines from the SVG
      svgEl.querySelectorAll('path.temp-connection-line').forEach(function(el) { el.remove(); });
      svgEl.querySelectorAll('.fiber-dot-glow').forEach(function(g) { g.remove(); });
      if (selInfo) selInfo.style.display = 'none';
    }
    
    function highlightOLTFiber(el) {
      clearOLTSelection();
      var cx, cy;
      if (el.tagName.toLowerCase() === 'circle') {
        cx = parseFloat(el.getAttribute('cx')); cy = parseFloat(el.getAttribute('cy'));
      } else {
        var x = parseFloat(el.getAttribute('x')) || 0;
        var y = parseFloat(el.getAttribute('y')) || 0;
        cx = x + (parseFloat(el.getAttribute('width')) || 0) / 2;
        cy = y + (parseFloat(el.getAttribute('height')) || 0) / 2;
      }
      // Glow circle removed — only fiber-selected class remains for hover style
    }
    
    // Single event delegation click handler
    svgEl.addEventListener('click', function(e) {
      console.log('[OLT] Click en SVG, target:', e.target.tagName, e.target.getAttribute('class'));
      if (e.target.closest('.fl') || e.target.closest('.break-fusion-btn')) return;
      var dot = e.target.closest('.fiber-dot-inner');
      if (!dot) {
        console.log('[OLT] No es fiber-dot-inner, limpiando seleccion');
        if (state.oltSelection) clearOLTSelection();
        return;
      }
      
      var cableConn = dot.getAttribute('data-cable-conn');
      var oltPortId = dot.getAttribute('data-olt-port-id');
      var hasFusion = dot.getAttribute('data-has-fusion') === 'true';
      console.log('[OLT] Click en dot: cableConn=', cableConn, 'oltPortId=', oltPortId, 'hasFusion=', hasFusion);
      console.log('[OLT] cableFiberData:', JSON.stringify(cableFiberData.map(c => ({ ccn: c.cableConnectionId, cid: c.cableId, name: c.cableName }))));
      if (cableConn) {
        var foundCD = cableFiberData.find(function(c) { return c.cableConnectionId == cableConn; });
        console.log('[OLT] cableFiberData.find:', foundCD ? foundCD.cableId + ' -> ' + foundCD.cableName : 'NOT FOUND');
      }
      
      if (hasFusion) { showToast('⚠️ Ya conectado'); return; }
      
      // Cable fiber was clicked first
      if (state.oltSelection && state.oltSelection.type === 'olt-port' && cableConn) {
        console.log('[OLT] Segundo click: cable fiber, creando conexion...');
        var selPortId = state.oltSelection.portId;
        var selPortNum = state.oltSelection.portNum;
        var cd = cableFiberData.find(function(c) { return c.cableConnectionId == cableConn; });
        if (!cd) { console.log('[OLT] No se encontro cable'); return; }
        clearOLTSelection();
        createOLTConnection(oltId, cd.cableId, parseInt(dot.getAttribute('data-fiber-num')),
          selPortId, selPortNum);
        return;
      }
      
      console.log('[OLT] Estado actual oltSelection:', JSON.stringify(state.oltSelection));
      // OLT port was clicked first
      if (state.oltSelection && state.oltSelection.type === 'cable-fiber' && oltPortId) {
        console.log('[OLT] Segundo click: OLT port, creando conexion...');
        var selFiberNum = state.oltSelection.fiberNum;
        var selCableId = state.oltSelection.connId;
        var cd = cableFiberData.find(function(c) { return c.cableConnectionId == selCableId; });
        if (!cd) { console.log('[OLT] No se encontro cable'); return; }
        clearOLTSelection();
        createOLTConnection(oltId, cd.cableId, parseInt(selFiberNum),
          parseInt(oltPortId), parseInt(dot.getAttribute('data-olt-port-num')));
        return;
      }
      
      // First click: select
      if (cableConn) {
        console.log('[OLT] Primer click: cable fiber #' + dot.getAttribute('data-fiber-num'));
        highlightOLTFiber(dot);
        // Start temp line following mouse (use screen→SVG conversion for accuracy)
        var dotRect = dot.getBoundingClientRect();
        var svgRect = svgEl.getBoundingClientRect();
        var vb = svgEl.viewBox.animVal;
        var vx2 = vb?.x || 0, vy2 = vb?.y || 0;
        var vw2 = vb?.width || 1600, vh2 = vb?.height || 1000;
        var sx2 = vw2 / svgRect.width, sy2 = vh2 / svgRect.height;
        var dotCX = vx2 + ((dotRect.left + dotRect.width/2) - svgRect.left) * sx2;
        var dotCY = vy2 + ((dotRect.top + dotRect.height/2) - svgRect.top) * sy2;
        if (typeof _connDrag !== 'undefined') {
          _connDrag = { sourcePort: dot, startX: dotCX, startY: dotCY, tempLine: null };
        }
        state.oltSelection = { type: 'cable-fiber', connId: cableConn, fiberNum: parseInt(dot.getAttribute('data-fiber-num')) };
        if (selInfo) { selInfo.style.display = 'block'; selInfo.innerHTML = '🔗 Fibra seleccionada — clic en PON'; }
      } else if (oltPortId) {
        console.log('[OLT] Primer click: OLT port P' + dot.getAttribute('data-olt-port-num'));
        highlightOLTFiber(dot);
        // Start temp line following mouse
        var dotRect2 = dot.getBoundingClientRect();
        var svgRect2 = svgEl.getBoundingClientRect();
        var vb2 = svgEl.viewBox.animVal;
        var vx3 = vb2?.x || 0, vy3 = vb2?.y || 0;
        var vw3 = vb2?.width || 1600, vh3 = vb2?.height || 1000;
        var sx3 = vw3 / svgRect2.width, sy3 = vh3 / svgRect2.height;
        var dotCX2 = vx3 + ((dotRect2.left + dotRect2.width/2) - svgRect2.left) * sx3;
        var dotCY2 = vy3 + ((dotRect2.top + dotRect2.height/2) - svgRect2.top) * sy3;
        if (typeof _connDrag !== 'undefined') {
          _connDrag = { sourcePort: dot, startX: dotCX2, startY: dotCY2, tempLine: null };
        }
        state.oltSelection = { type: 'olt-port', portId: parseInt(oltPortId), portNum: parseInt(dot.getAttribute('data-olt-port-num')) };
        if (selInfo) { selInfo.style.display = 'block'; selInfo.innerHTML = '🔗 P' + dot.getAttribute('data-olt-port-num') + ' seleccionado — clic en fibra'; }
      }
    });
    
    // Cancel on ESC
    function _oltEscHandler(e) { if (e.key === 'Escape') { clearOLTSelection(); } }
    document.addEventListener('keydown', _oltEscHandler);
    
    // ==== TRAZAR HILOS: aplicar animación a todos los segmentos de un hilo con potencia ====
    (async function aplicarTrazaHilos() {
      try {
        var traceRes = await fetch(API + '/olts/' + oltId + '/hilos-activos');
        var traceData = await traceRes.json();
        if (!traceData.trazas || traceData.trazas.length === 0) return;
        
        traceData.trazas.forEach(function(traza) {
          if (!traza.potencia || traza.potencia <= 0) return;
          
          // El primer segmento es la conexión OLT → hilo en fibra
          var segInicial = traza.segmentos.find(function(s) { return s.tipo === 'olt_a_fibra'; });
          if (!segInicial) return;
          
          // Animar TODAS las líneas Bézier de este hilo en el SVG
          svgEl.querySelectorAll('.fl[data-fiber-in="' + segInicial.hilo_numero + '"]').forEach(function(p) {
            p.classList.add('active-pulse', 'data-flow');
          });
          
          var hiloNum = segInicial.hilo_numero;
          
          // Recoger todas las fusiones que atraviesa este hilo
          var mangasRuta = [];
          var napsRuta = [];
          traza.segmentos.forEach(function(s) {
            if (s.tipo === 'fusion' && s.manga_nombre) {
              mangasRuta.push(s.manga_nombre + ' (' + s.perdida_db + 'dB)');
            }
            if (s.tipo === 'hacia_nap' && s.nap_nombre) {
              napsRuta.push(s.nap_nombre + ' (H#' + s.hilo_numero + ')');
            }
          });
          
          // Panel de info con la ruta del hilo
          var infoPanel = document.getElementById('vis-fibers');
          if (infoPanel && (mangasRuta.length > 0 || napsRuta.length > 0)) {
            var rutaHtml = '<div class="panel-section" style="border-left: 3px solid #00ff88;padding-left:8px">';
            rutaHtml += '<h4 style="color:#00ff88;margin:0 0 4px 0;font-size:11px">🔗 Ruta Hilo #' + hiloNum + '</h4>';
            rutaHtml += '<div style="font-size:10px;color:#aaa">⚡ ' + traza.potencia.toFixed(1) + ' dBm desde P' + traza.puerto_olt_numero + '</div>';
            if (mangasRuta.length > 0) {
              rutaHtml += '<div style="font-size:10px;color:#888;margin-top:4px">🧶 Mangas: ' + mangasRuta.join(' → ') + '</div>';
            }
            if (napsRuta.length > 0) {
              rutaHtml += '<div style="font-size:10px;color:#888;margin-top:2px">📦 NAPs: ' + napsRuta.join(', ') + '</div>';
            }
            rutaHtml += '</div>';
            infoPanel.insertAdjacentHTML('afterbegin', rutaHtml);
          }
        });
      } catch(e) {
        // Traza de hilos es opcional
        console.log('Traza de hilos no disponible:', e.message);
      }
    })();
    
    _oltRefreshGuard = false;
  } catch(e) {
    console.error('openOLTVisualizer error:', e);
    showToast('❌ Error al abrir OLT: ' + e.message);
    _oltRefreshGuard = false;
  }
}

// Helper: create OLT fiber connection
async function createOLTConnection(oltId, cableId, fiberNum, portId, portNum) {
  showToast('🔗 Conectando...');
  try {
    var res = await fetch(API + '/fibers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cable_id: cableId,
        fiber_number: fiberNum,
        source_type: 'olt',
        source_id: oltId,
        source_olt_port_id: portId,
        target_type: 'olt_port',
        target_id: portId
      })
    });
    if (!res.ok) { showToast('❌ Error al conectar'); return; }
    showToast('✅ Conectado: Fibra #' + fiberNum + ' → Puerto P' + portNum);
    renderTree();
    // Refresh the entire visualizer (reliable, shows correct paths)
    refreshOLTVisualizer(oltId);
  } catch(e) {
    showToast('❌ Error: ' + e.message);
  }
}

// ====== OLT PORT CARD MANAGEMENT ======
function editOLTPortPower(portId, oltId, currentPower) {
  var newPower = prompt('✏️ Potencia del puerto (dBm):', currentPower || '2.5');
  if (newPower === null) return;
  newPower = parseFloat(newPower);
  if (isNaN(newPower)) { showToast('❌ Valor inválido'); return; }
  
  fetch(API + '/olt-ports/' + portId + '/power', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ power: newPower })
  })
    .then(function(r) {
      if (!r.ok) throw new Error('Error al actualizar potencia');
      showToast('⚡ Potencia actualizada a ' + newPower.toFixed(1) + ' dBm');
      refreshOLTVisualizer(oltId);
    })
    .catch(function(e) { showToast('❌ ' + e.message); });
}

// Refresh OLT visualizer preserving current zoom/pan viewBox
var _pendingOLTViewBox = null;
function refreshOLTVisualizer(oltId) {
  var svgEl = document.querySelector('#vis-svg svg');
  _pendingOLTViewBox = svgEl ? svgEl.getAttribute('viewBox') : null;
  openOLTVisualizer(oltId);
}

function addOLTPort(oltId) {
  fetch(API + '/olts/' + oltId + '/ports', { method: 'POST' })
    .then(function(r) {
      if (!r.ok) throw new Error('Error al agregar puerto');
      showToast('\u2795 Puerto agregado — refrescando...');
      refreshOLTVisualizer(oltId);
    })
    .catch(function(e) { showToast('\u274c ' + e.message); });
}

// ====== SHOW ADD CARD MODAL ======
function showAddCardModal(oltId) {
  var body = '' +
    '<div style="padding:12px 0">' +
    '<label style="color:#aaa;font-size:12px">Nombre de la tarjeta</label>' +
    '<input id="card-name-input" type="text" placeholder="Ej: Card 1" style="width:100%;padding:8px;margin:4px 0 12px 0;border:1px solid #3a3f4b;border-radius:4px;background:#1a1a2e;color:#e0e0e0;font-size:14px" />' +
    '<label style="color:#aaa;font-size:12px">Puertos</label>' +
    '<select id="card-ports-count" style="width:100%;padding:8px;margin:4px 0 12px 0;border:1px solid #3a3f4b;border-radius:4px;background:#1a1a2e;color:#e0e0e0;font-size:14px">' +
    '  <option value="8">8 puertos</option>' +
    '  <option value="16">16 puertos</option>' +
    '</select>' +
    '<label style="color:#aaa;font-size:12px">Potencia por puerto (dBm)</label>' +
    '<input id="card-port-power" type="number" step="0.1" value="2.5" style="width:100%;padding:8px;margin:4px 0 12px 0;border:1px solid #3a3f4b;border-radius:4px;background:#1a1a2e;color:#e0e0e0;font-size:14px" />' +
    '<div style="color:#888;font-size:11px;margin-bottom:12px">💡 Todos los puertos se crean con esta potencia. Puedes cambiarla luego haciendo clic en cada puerto.</div>' +
    '<div style="display:flex;gap:8px">' +
    '<button class="btn-primary" onclick="confirmAddCard(' + oltId + ')" style="flex:1;padding:10px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px">' +
    '  ✅ Crear Tarjeta' +
    '</button>' +
    '</div>' +
    '<div id="card-add-status" style="margin-top:10px;color:#aaa;font-size:12px"></div>' +
    '</div>';
  showModal('➕ Agregar Tarjeta', body);
}

async function confirmAddCard(oltId) {
  var name = document.getElementById('card-name-input').value.trim();
  var portsCount = parseInt(document.getElementById('card-ports-count').value);
  var portPower = parseFloat(document.getElementById('card-port-power').value);
  
  var statusEl = document.getElementById('card-add-status');
  if (!statusEl) return;
  
  statusEl.innerHTML = '⏳ Creando tarjeta...';
  try {
    var res = await fetch(API + '/olts/' + oltId + '/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ports_count: portsCount, name: name || undefined, port_power: portPower })
    });
    var data = await res.json();
    if (!res.ok) { statusEl.innerHTML = '❌ ' + (data.error || 'Error'); return; }
    statusEl.innerHTML = '✅ ' + data.message;
    closeModal();
    showToast('✅ ' + data.message);
    refreshOLTVisualizer(oltId);
  } catch(e) {
    statusEl.innerHTML = '❌ ' + e.message;
  }
}

// ====== ADD OLT CARD (via new API) ======
function addOLTCard(oltId, count) {
  showToast('📦 Agregando tarjeta de ' + count + ' puertos...');
  fetch(API + '/olts/' + oltId + '/cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ports_count: count, port_power: 2.5 })
  })
    .then(function(r) {
      if (!r.ok) throw new Error('Error al agregar tarjeta');
      return r.json();
    })
    .then(function(data) {
      showToast('✅ ' + (data.message || 'Tarjeta ' + count + 'P agregada'));
      refreshOLTVisualizer(oltId);
    })
    .catch(function(e) { showToast('❌ ' + e.message); });
}

// ====== SmartOLT Import ======
function showSmartOLTImportModal(oltId) {
  var body = '' +
    '<div style="padding:12px 0">' +
    '<label style="color:#aaa;font-size:12px">Subdominio SmartOLT</label>' +
    '<input id="smartolt-subdomain" type="text" placeholder="ej: tuempresa" style="width:100%;padding:8px;margin:4px 0 12px 0;border:1px solid #3a3f4b;border-radius:4px;background:#1a1a2e;color:#e0e0e0;font-size:14px" />' +
    '<label style="color:#aaa;font-size:12px">API Key (X-Token)</label>' +
    '<input id="smartolt-apikey" type="password" placeholder="Tu API key de SmartOLT" style="width:100%;padding:8px;margin:4px 0 12px 0;border:1px solid #3a3f4b;border-radius:4px;background:#1a1a2e;color:#e0e0e0;font-size:14px" />' +
    '<div style="color:#888;font-size:11px;margin-bottom:12px">' +
    '  💡 La API key se envía al servidor, nunca se guarda.' +
    '</div>' +
    '<div style="display:flex;gap:8px">' +
    '<button class="btn-primary" onclick="testSmartOLTAPI(' + oltId + ')" style="flex:1;padding:10px;background:#3a3f4b;color:#FFC107;border:1px solid #FFC107;border-radius:4px;cursor:pointer;font-size:13px">' +
    '  🧪 Probar API' +
    '</button>' +
    '<button class="btn-primary" onclick="importSmartOLTCards(' + oltId + ')" style="flex:1;padding:10px;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px">' +
    '  ⬇️ Importar' +
    '</button>' +
    '</div>' +
    '<div id="smartolt-import-status" style="margin-top:10px;color:#aaa;font-size:12px"></div>' +
    '</div>';
  showModal('📦 Importar Tarjetas desde SmartOLT', body);
}

function testSmartOLTAPI(oltId) {
  var subdomain = document.getElementById('smartolt-subdomain').value.trim();
  var apiKey = document.getElementById('smartolt-apikey').value.trim();
  if (!subdomain) { showToast('❌ Ingresa el subdominio'); return; }
  if (!apiKey) { showToast('❌ Ingresa la API key'); return; }
  
  var statusEl = document.getElementById('smartolt-import-status');
  statusEl.innerHTML = '⏳ Probando API de SmartOLT...';
  
  fetch(API + '/import/smartolt/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subdomain: subdomain, api_key: apiKey, olt_id: oltId })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var html = '<div style="text-align:left;font-size:11px;max-height:300px;overflow-y:auto">';
      Object.keys(data).forEach(function(ep) {
        var epData = data[ep];
        html += '<div style="margin:8px 0;padding:6px;background:#0f3460;border-radius:4px">';
        html += '<strong style="color:#FFC107">' + ep + '</strong>';
        html += ' — Status: <strong>' + (epData.status || 'error') + '</strong>';
        if (epData.body) {
          var preview = epData.body.length > 500 ? epData.body.substring(0, 500) + '...' : epData.body;
          html += '<pre style="margin:4px 0;padding:4px;background:#1a1a2e;color:#8bc34a;font-size:10px;overflow-x:auto;white-space:pre-wrap">' + escHtml(preview) + '</pre>';
        } else if (epData.error) {
          html += '<div style="color:#F44336">❌ ' + escHtml(epData.error) + '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
      statusEl.innerHTML = html;
    })
    .catch(function(e) {
      statusEl.innerHTML = '❌ Error: ' + e.message;
    });
}

function importSmartOLTCards(oltId) {
  var subdomain = document.getElementById('smartolt-subdomain').value.trim();
  var apiKey = document.getElementById('smartolt-apikey').value.trim();
  if (!subdomain) { showToast('❌ Ingresa el subdominio'); return; }
  if (!apiKey) { showToast('❌ Ingresa la API key'); return; }
  
  var statusEl = document.getElementById('smartolt-import-status');
  statusEl.innerHTML = '⏳ Conectando con SmartOLT...';
  
  fetch(API + '/import/smartolt/cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subdomain: subdomain, api_key: apiKey, olt_id: oltId })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        if (data.available) {
          statusEl.innerHTML = '❌ ' + data.error + '<br><small style="color:#888">Disponibles: ' + data.available.join(', ') + '</small>';
        } else {
          statusEl.innerHTML = '❌ ' + data.error;
        }
        return;
      }
      if (data.success) {
        // Cards are now stored in the database with proper olt_cards table
        
        var cardList = '';
        data.cards.forEach(function(c) {
          cardList += '<div style="padding:4px 0;border-bottom:1px solid #2a2a3e">' +
            '🎴 Slot ' + c.slot + ' — ' + c.type + ' (' + c.ports + 'P) ' +
            '<span style="color:' + (c.status === 'Online' ? '#4CAF50' : '#f44336') + '">' + c.status + '</span>' +
            '</div>';
        });
        statusEl.innerHTML = '✅ ' + data.message + '<br><div style="margin-top:8px;max-height:200px;overflow-y:auto">' + cardList + '</div>';
        showToast('✅ ' + data.message);
        setTimeout(function() {
          closeModal();
          refreshOLTVisualizer(oltId);
        }, 1500);
      } else {
        statusEl.innerHTML = '❌ ' + JSON.stringify(data);
      }
    })
    .catch(function(e) {
      statusEl.innerHTML = '❌ Error de conexión: ' + e.message;
      showToast('❌ ' + e.message);
    });
}

function removeOLTPort(portId, oltId) {
  if (!confirm('❌ Eliminar este puerto? Se perderá la conexión si existe.')) return;
  fetch(API + '/olt-ports/' + portId, { method: 'DELETE' })
    .then(function(r) {
      if (!r.ok) throw new Error('Error al eliminar puerto');
      showToast('Puerto eliminado — refrescando...');
      refreshOLTVisualizer(oltId);
    })
    .catch(function(e) { showToast('❌ ' + e.message); });
}

function removeOLTCard(oltId, cardId, portCount) {
  if (cardId === null || cardId === 'null') {
    showToast('❌ Esta tarjeta no tiene ID en base de datos');
    return;
  }
  if (!confirm('❌ Eliminar tarjeta de ' + portCount + ' puertos? Se perderán todas las conexiones.')) return;
  showToast('🗑️ Eliminando tarjeta...');
  fetch(API + '/olts/' + oltId + '/cards/' + cardId, { method: 'DELETE' })
    .then(function(r) {
      if (!r.ok) throw new Error('Error al eliminar tarjeta');
      return r.json();
    })
    .then(function(data) {
      showToast(data.message || '🗑️ Tarjeta eliminada');
      refreshOLTVisualizer(oltId);
    })
    .catch(function(e) { showToast('❌ ' + e.message); });
}

// ====== BREAK OLT FIBER CONNECTION ======
function confirmBreakFiberConn(fiberConnId, oltId) {
  if (!fiberConnId || fiberConnId === 'new') { showToast('ID no disponible, refresca'); return; }
  showModal('\u2702\uFE0F Romper conexi\u00f3n',
    '<p style="color:#ccc;margin:12px 0">\u00bfEst\u00e1s seguro de romper esta conexi\u00f3n #' + fiberConnId + '?</p>' +
    '<div class="btn-group">' +
      '<button class="btn-danger" onclick="doBreakFiberConn(' + fiberConnId + ',' + oltId + ')">\u2702\uFE0F Romper</button>' +
      '<button class="btn-secondary" onclick="closeModal()">Cancelar</button>' +
    '</div>'
  );
}

function doBreakFiberConn(fiberConnId, oltId) {
  closeModal();
  fetch(API + '/fibers/' + fiberConnId, { method: 'DELETE' })
    .then(function(r) {
      if (!r.ok) throw new Error('Error al romper');
      // Dynamic removal
      var svgEl = document.querySelector('#vis-svg svg');
      if (svgEl) {
        svgEl.querySelectorAll('.fl[data-fiber-conn="' + fiberConnId + '"]').forEach(function(p) { p.remove(); });
        svgEl.querySelectorAll('.break-fusion-btn[data-fiber-conn="' + fiberConnId + '"]').forEach(function(g) { g.remove(); });
        svgEl.querySelectorAll('.fiber-dot-inner').forEach(function(d) {
          d.setAttribute('data-has-fusion', 'false');
        });
      }
      showToast('\u2714 Conexi\u00f3n rota');
    })
    .catch(function(e) { showToast('\u274c ' + e.message); });
}

// ====================================================
// 🌐 MULTI-LANGUAGE SUPPORT
// ====================================================

const FTTH_LANGUAGES = {
  es: {
    'sidebar.new': 'Nuevo elemento',
    'sidebar.collapse': 'Colapsar',
    'sidebar.expand': 'Expandir',
    'sidebar.search': 'Buscar...',
    'sidebar.count': 'elementos',
    'sidebar.nofolder': 'Sin carpeta',
    'topbar.olts': 'OLTs',
    'topbar.naps': 'NAPs',
    'topbar.mangas': 'Mangas',
    'topbar.cables': 'Cables',
    'topbar.active': 'Activos',
    'tooltip.health': 'Salud de la Red',
    'tooltip.report': 'Reporte',
    'tooltip.colors': 'Colores',
    'tooltip.onus': 'ONUs',
    'tooltip.logout': 'Cerrar sesión',
    'tooltip.language': 'Idioma',
    'tab.map': 'Mapa',
    'tab.dashboard': 'Dashboard',
    'tab.comercial': 'Comercial',
    'tab.monitor': 'Monitor',
    'tab.settings': 'Ajustes',
    'map.draw': 'Dibujar cable',
    'map.add': 'Agregar elemento',
    'map.measure': 'Medir distancia',
    'map.locate': 'Mi ubicación',
    'map.fibers': 'Fibras',
    'map.fit': 'Ajustar vista',
    'modal.close': 'Cerrar',
    'modal.confirm': 'Confirmar',
    'modal.cancel': 'Cancelar',
    'onu.title': 'Panel de ONUs',
    'onu.online': 'Online',
    'onu.offline': 'Offline',
    'onu.badsignal': 'Mala Señal',
    'onu.total': 'Total',
    'onu.name': 'Nombre',
    'onu.serial': 'Serial',
    'onu.status': 'Estado',
    'onu.client': 'Cliente',
    'onu.signal': 'Señal (dBm)',
    'onu.oltport': 'Puerto OLT',
    'onu.nap': 'NAP',
    'onu.loading': 'Cargando ONUs...',
    'onu.empty': 'No hay ONUs registradas. Crea una desde "Nuevo elemento".',
    'onu.actions': 'Acciones',
    'ps.title': 'Dashboard de Potencia',
    'ps.excellent': 'Excelente (> -20 dBm)',
    'ps.warning': 'Regular (-20 a -25 dBm)',
    'ps.critical': 'Crítico (< -25 dBm)',
    'ps.avg': 'Potencia promedio',
    'ps.worst': 'Peor fibra',
    'ps.fibers': 'fibras activas',
    'ps.onuonline': 'ONUs Online',
    'ps.onuoffline': 'ONUs Offline',
    'ps.onubadsignal': 'Señal Mala',
    'logout.confirm': '¿Cerrar sesión?',
    'logout.message': 'Has cerrado sesión'
  },
  pt: {
    'sidebar.new': 'Novo elemento',
    'sidebar.collapse': 'Recolher',
    'sidebar.expand': 'Expandir',
    'sidebar.search': 'Buscar...',
    'sidebar.count': 'elementos',
    'sidebar.nofolder': 'Sem pasta',
    'topbar.olts': 'OLTs',
    'topbar.naps': 'NAPs',
    'topbar.mangas': 'Mangas',
    'topbar.cables': 'Cabos',
    'topbar.active': 'Ativos',
    'tooltip.health': 'Saúde da Rede',
    'tooltip.report': 'Relatório',
    'tooltip.colors': 'Cores',
    'tooltip.onus': 'ONUs',
    'tooltip.logout': 'Sair',
    'tooltip.language': 'Idioma',
    'tab.map': 'Mapa',
    'tab.dashboard': 'Dashboard',
    'tab.comercial': 'Comercial',
    'tab.monitor': 'Monitor',
    'tab.settings': 'Ajustes',
    'map.draw': 'Desenhar cabo',
    'map.add': 'Adicionar elemento',
    'map.measure': 'Medir distância',
    'map.locate': 'Minha localização',
    'map.fibers': 'Fibras',
    'map.fit': 'Ajustar vista',
    'modal.close': 'Fechar',
    'modal.confirm': 'Confirmar',
    'modal.cancel': 'Cancelar',
    'onu.title': 'Painel de ONUs',
    'onu.online': 'Online',
    'onu.offline': 'Offline',
    'onu.badsignal': 'Sinal Ruim',
    'onu.total': 'Total',
    'onu.name': 'Nome',
    'onu.serial': 'Serial',
    'onu.status': 'Estado',
    'onu.client': 'Cliente',
    'onu.signal': 'Sinal (dBm)',
    'onu.oltport': 'Porta OLT',
    'onu.nap': 'NAP',
    'onu.loading': 'Carregando ONUs...',
    'onu.empty': 'Nenhuma ONU registrada. Crie uma em "Novo elemento".',
    'onu.actions': 'Ações',
    'ps.title': 'Dashboard de Potência',
    'ps.excellent': 'Excelente (> -20 dBm)',
    'ps.warning': 'Regular (-20 a -25 dBm)',
    'ps.critical': 'Crítico (< -25 dBm)',
    'ps.avg': 'Potência média',
    'ps.worst': 'Pior fibra',
    'ps.fibers': 'fibras ativas',
    'ps.onuonline': 'ONUs Online',
    'ps.onuoffline': 'ONUs Offline',
    'ps.onubadsignal': 'Sinal Ruim',
    'logout.confirm': 'Sair?',
    'logout.message': 'Sessão encerrada'
  },
  en: {
    'sidebar.new': 'New element',
    'sidebar.collapse': 'Collapse',
    'sidebar.expand': 'Expand',
    'sidebar.search': 'Search...',
    'sidebar.count': 'elements',
    'sidebar.nofolder': 'Unassigned',
    'topbar.olts': 'OLTs',
    'topbar.naps': 'NAPs',
    'topbar.mangas': 'Splice Enclosures',
    'topbar.cables': 'Cables',
    'topbar.active': 'Active',
    'tooltip.health': 'Network Health',
    'tooltip.report': 'Report',
    'tooltip.colors': 'Colors',
    'tooltip.onus': 'ONUs',
    'tooltip.logout': 'Logout',
    'tooltip.language': 'Language',
    'tab.map': 'Map',
    'tab.dashboard': 'Dashboard',
    'tab.comercial': 'Sales',
    'tab.monitor': 'Monitor',
    'tab.settings': 'Settings',
    'map.draw': 'Draw cable',
    'map.add': 'Add element',
    'map.measure': 'Measure distance',
    'map.locate': 'My location',
    'map.fibers': 'Fibers',
    'map.fit': 'Fit view',
    'modal.close': 'Close',
    'modal.confirm': 'Confirm',
    'modal.cancel': 'Cancel',
    'onu.title': 'ONU Dashboard',
    'onu.online': 'Online',
    'onu.offline': 'Offline',
    'onu.badsignal': 'Bad Signal',
    'onu.total': 'Total',
    'onu.name': 'Name',
    'onu.serial': 'Serial',
    'onu.status': 'Status',
    'onu.client': 'Client',
    'onu.signal': 'Signal (dBm)',
    'onu.oltport': 'OLT Port',
    'onu.nap': 'NAP',
    'onu.loading': 'Loading ONUs...',
    'onu.empty': 'No ONUs registered. Create one from "New element".',
    'onu.actions': 'Actions',
    'ps.title': 'Power Dashboard',
    'ps.excellent': 'Excellent (> -20 dBm)',
    'ps.warning': 'Warning (-20 to -25 dBm)',
    'ps.critical': 'Critical (< -25 dBm)',
    'ps.avg': 'Average power',
    'ps.worst': 'Worst fiber',
    'ps.fibers': 'active fibers',
    'ps.onuonline': 'ONUs Online',
    'ps.onuoffline': 'ONUs Offline',
    'ps.onubadsignal': 'Bad Signal',
    'logout.confirm': 'Logout?',
    'logout.message': 'Logged out'
  }
};

let _currentLang = localStorage.getItem('ftth-lang') || 'es';

function __(key) {
  return FTTH_LANGUAGES[_currentLang]?.[key] || FTTH_LANGUAGES.es[key] || key;
}

function changeLanguage(lang) {
  if (!['es', 'pt', 'en'].includes(lang)) lang = 'es';
  _currentLang = lang;
  localStorage.setItem('ftth-lang', lang);
  
  // Update language selector if exists
  const sel = document.getElementById('lang-selector');
  if (sel) sel.value = lang;
  
  // Save preference to server
  fetch('/api/users/language', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: lang })
  }).catch(function() {});
  
  // Update visible UI strings
  updateLangUI();
  showToast('🌐 ' + (lang === 'es' ? 'Idioma cambiado a Español' : lang === 'pt' ? 'Idioma alterado para Português' : 'Language changed to English'));
}

function updateLangUI() {
  // Topbar stats
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var key = el.getAttribute('data-i18n');
    if (key && __(key)) el.textContent = __(key);
  });
}

// ====================================================
// 🏠 ONU DASHBOARD
// ====================================================

function showOnuDashboard() {
  // Create overlay and panel if not exists
  var overlay = document.getElementById('dashboard-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'dashboard-overlay';
    overlay.className = '';
    document.body.appendChild(overlay);
  }
  
  var panel = document.getElementById('onu-dashboard');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'onu-dashboard';
    panel.innerHTML = `
      <div class="onu-header">
        <h2 data-i18n="onu.title">🏠 Panel de ONUs</h2>
        <span style="color:#888;font-size:12px" id="onu-dash-subtitle"></span>
        <button class="onu-close" onclick="closeOnuDashboard()">&times;</button>
      </div>
      <div class="onu-stats" id="onu-dash-stats">
        <div class="onu-stat online">
          <div class="stat-num" id="onu-stat-online">0</div>
          <div class="stat-label" data-i18n="onu.online">Online</div>
        </div>
        <div class="onu-stat offline">
          <div class="stat-num" id="onu-stat-offline">0</div>
          <div class="stat-label" data-i18n="onu.offline">Offline</div>
        </div>
        <div class="onu-stat bad-signal">
          <div class="stat-num" id="onu-stat-badsignal">0</div>
          <div class="stat-label" data-i18n="onu.badsignal">Mala Señal</div>
        </div>
        <div class="onu-stat" style="background:rgba(33,150,243,0.15);border:1px solid rgba(33,150,243,0.3)">
          <div class="stat-num" id="onu-stat-total" style="color:#2196F3">0</div>
          <div class="stat-label" data-i18n="onu.total">Total</div>
        </div>
      </div>
      <div class="onu-body">
        <div class="onu-loading" id="onu-dash-loading" data-i18n="onu.loading">Cargando ONUs...</div>
        <table class="onu-table" id="onu-dash-table" style="display:none">
          <thead>
            <tr>
              <th data-i18n="onu.name">Nombre</th>
              <th data-i18n="onu.serial">Serial</th>
              <th data-i18n="onu.status">Estado</th>
              <th data-i18n="onu.client">Cliente</th>
              <th data-i18n="onu.signal">Señal (dBm)</th>
              <th data-i18n="onu.oltport">Puerto OLT</th>
              <th data-i18n="onu.nap">NAP</th>
              <th data-i18n="onu.actions">Acciones</th>
            </tr>
          </thead>
          <tbody id="onu-dash-tbody"></tbody>
        </table>
        <div class="onu-empty" id="onu-dash-empty" style="display:none" data-i18n="onu.empty">No hay ONUs registradas.</div>
      </div>
    `;
    document.body.appendChild(panel);
  }
  
  overlay.className = 'open';
  panel.className = 'open';
  
  // Load power stats and ONUs
  loadPowerStats();
  loadOnus();
}

function closeOnuDashboard() {
  var overlay = document.getElementById('dashboard-overlay');
  var panel = document.getElementById('onu-dashboard');
  if (overlay) overlay.className = '';
  if (panel) panel.className = '';
}

function loadPowerStats() {
  fetch('/api/reports/power-stats')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var subtitle = document.getElementById('onu-dash-subtitle');
      if (subtitle && data.power) {
        subtitle.textContent = '⚡ ' + data.power.total + ' ' + __('ps.fibers') + ' · ' + __('ps.avg') + ': ' + data.power.avg_power + ' dBm';
      }
    })
    .catch(function() {});
}

function loadOnus() {
  var loading = document.getElementById('onu-dash-loading');
  var table = document.getElementById('onu-dash-table');
  var empty = document.getElementById('onu-dash-empty');
  var tbody = document.getElementById('onu-dash-tbody');
  
  if (!tbody) return;
  
  loading.style.display = 'block';
  table.style.display = 'none';
  empty.style.display = 'none';
  
  fetch('/api/onus')
    .then(function(r) { return r.json(); })
    .then(function(onus) {
      loading.style.display = 'none';
      
      if (!onus || onus.length === 0) {
        empty.style.display = 'block';
        return;
      }
      
      table.style.display = '';
      tbody.innerHTML = '';
      
      var onlineCount = 0, offlineCount = 0, badCount = 0;
      
      onus.forEach(function(onu) {
        var statusClass = onu.status === 'online' ? 'online' : onu.status === 'bad_signal' ? 'bad-signal' : 'offline';
        var statusLabel = onu.status === 'online' ? __('onu.online') : onu.status === 'bad_signal' ? __('onu.badsignal') : __('onu.offline');
        
        if (onu.status === 'online') onlineCount++;
        else if (onu.status === 'bad_signal') badCount++;
        else offlineCount++;
        
        var signalColor = onu.last_signal !== null ? (onu.last_signal > -20 ? '#4CAF50' : onu.last_signal > -25 ? '#FFC107' : '#F44336') : '#888';
        
        var tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${onu.name || '—'}</strong></td>
          <td style="color:#888;font-family:monospace">${onu.serial || '—'}</td>
          <td><span class="onu-status-badge ${statusClass}">${statusLabel}</span></td>
          <td>${onu.client_name || '—'}</td>
          <td style="color:${signalColor};font-weight:${onu.last_signal !== null ? 'bold' : 'normal'}">${onu.last_signal !== null ? onu.last_signal + ' dBm' : '—'}</td>
          <td style="color:#888">${onu.olt_port_num || '—'}</td>
          <td style="color:#888">${onu.nap_name || '—'}</td>
          <td>
            <button onclick="editOnu(${onu.id})" style="background:none;border:none;color:#2196F3;cursor:pointer;font-size:12px">✏️</button>
            <button onclick="deleteOnu(${onu.id})" style="background:none;border:none;color:#F44336;cursor:pointer;font-size:12px;margin-left:4px">🗑️</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
      
      // Update stats
      document.getElementById('onu-stat-online').textContent = onlineCount;
      document.getElementById('onu-stat-offline').textContent = offlineCount;
      document.getElementById('onu-stat-badsignal').textContent = badCount;
      document.getElementById('onu-stat-total').textContent = onus.length;
    })
    .catch(function(e) {
      loading.style.display = 'none';
      empty.style.display = 'block';
      empty.textContent = '❌ Error: ' + e.message;
    });
}

function editOnu(id) {
  showToast('✏️ Editar ONU #' + id + ' — Próximamente formulario completo');
}

function deleteOnu(id) {
  if (!confirm(__('logout.confirm') + ' Eliminar ONU #' + id + '?')) return;
  fetch('/api/onus/' + id, { method: 'DELETE' })
    .then(function(r) { return r.json(); })
    .then(function() {
      showToast('🗑️ ONU eliminada');
      loadOnus();
    })
    .catch(function(e) { showToast('❌ ' + e.message); });
}

// ====================================================
// ⚡ POWER STATS PANEL
// ====================================================

function showPowerStatsPanel() {
  var overlay = document.getElementById('dashboard-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'dashboard-overlay';
    overlay.className = 'open';
    document.body.appendChild(overlay);
  } else {
    overlay.className = 'open';
  }
  
  var panel = document.getElementById('power-stats-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'power-stats-panel';
    panel.innerHTML = `
      <div class="ps-header">
        <h2>⚡ <span data-i18n="ps.title">Dashboard de Potencia</span></h2>
        <button class="ps-close" onclick="closePowerStats()">&times;</button>
      </div>
      <div class="ps-body" id="ps-body-content">
        <div style="text-align:center;padding:40px;color:#888">Cargando...</div>
      </div>
    `;
    document.body.appendChild(panel);
  }
  panel.className = 'open';
  
  fetch('/api/reports/power-stats')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var body = document.getElementById('ps-body-content');
      if (!body) return;
      
      var total = data.power.total || 0;
      var greenPct = total > 0 ? (data.power.green / total * 100) : 0;
      var yellowPct = total > 0 ? (data.power.yellow / total * 100) : 0;
      var redPct = total > 0 ? (data.power.red / total * 100) : 0;
      
      body.innerHTML = `
        <div class="power-bar-group">
          <h3>📊 <span data-i18n="ps.fibers">Fibras Activas</span>: ${total}</h3>
          <div class="power-bar">
            ${greenPct > 0 ? '<div class="power-bar-segment green" style="width:' + greenPct + '%">' + data.power.green + '</div>' : ''}
            ${yellowPct > 0 ? '<div class="power-bar-segment yellow" style="width:' + yellowPct + '%">' + data.power.yellow + '</div>' : ''}
            ${redPct > 0 ? '<div class="power-bar-segment red" style="width:' + redPct + '%">' + data.power.red + '</div>' : ''}
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px">
            <span style="color:#4CAF50">🟢 ${data.power.green} <span data-i18n="ps.excellent">Excelente</span></span>
            <span style="color:#FFC107">🟡 ${data.power.yellow} <span data-i18n="ps.warning">Regular</span></span>
            <span style="color:#F44336">🔴 ${data.power.red} <span data-i18n="ps.critical">Crítico</span></span>
          </div>
        </div>
        <div style="margin-top:20px;padding:16px;background:#0f3460;border-radius:10px">
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px">
            <div>
              <span style="color:#888;font-size:12px"><span data-i18n="ps.avg">Potencia promedio</span></span>
              <div style="color:#00ff88;font-size:24px;font-weight:700">${data.power.avg_power} dBm</div>
            </div>
            ${data.power.worst_fiber ? '<div><span style="color:#888;font-size:12px"><span data-i18n="ps.worst">Peor fibra</span></span><div style="color:#F44336;font-size:16px;font-weight:600">#${data.power.worst_fiber.fiber_number} · ${data.power.worst_fiber.manga_name} · ${data.power.worst_fiber.power_level} dBm</div></div>' : ''}
          </div>
        </div>
        <div class="power-bar-group" style="margin-top:24px">
          <h3>🏠 ONUs</h3>
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <div style="padding:12px 20px;background:rgba(76,175,80,0.15);border-radius:8px;border:1px solid rgba(76,175,80,0.3);text-align:center">
              <div style="color:#4CAF50;font-size:24px;font-weight:700">${data.onus.online}</div>
              <div style="color:#aaa;font-size:11px" data-i18n="ps.onuonline">ONUs Online</div>
            </div>
            <div style="padding:12px 20px;background:rgba(158,158,158,0.15);border-radius:8px;border:1px solid rgba(158,158,158,0.3);text-align:center">
              <div style="color:#9E9E9E;font-size:24px;font-weight:700">${data.onus.offline}</div>
              <div style="color:#aaa;font-size:11px" data-i18n="ps.onuoffline">ONUs Offline</div>
            </div>
            <div style="padding:12px 20px;background:rgba(244,67,54,0.15);border-radius:8px;border:1px solid rgba(244,67,54,0.3);text-align:center">
              <div style="color:#F44336;font-size:24px;font-weight:700">${data.onus.bad_signal}</div>
              <div style="color:#aaa;font-size:11px" data-i18n="ps.onubadsignal">Señal Mala</div>
            </div>
            <div style="padding:12px 20px;background:rgba(33,150,243,0.15);border-radius:8px;border:1px solid rgba(33,150,243,0.3);text-align:center">
              <div style="color:#2196F3;font-size:24px;font-weight:700">${data.onus.total}</div>
              <div style="color:#aaa;font-size:11px" data-i18n="onu.total">Total</div>
            </div>
          </div>
        </div>
      `;
    })
    .catch(function(e) {
      var body = document.getElementById('ps-body-content');
      if (body) body.innerHTML = '<div style="text-align:center;padding:40px;color:#F44336">❌ Error: ' + e.message + '</div>';
    });
}

function closePowerStats() {
  var overlay = document.getElementById('dashboard-overlay');
  var panel = document.getElementById('power-stats-panel');
  if (overlay) overlay.className = '';
  if (panel) panel.className = '';
}

// Close overlay on click
// (handled by inline onclick)

// ====================================================
// 🚪 LOGOUT
// ====================================================

function handleLogout() {
  if (!confirm(__('logout.confirm'))) return;
  
  fetch('/api/logout', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function() {
      localStorage.removeItem('ftth-company');
      localStorage.removeItem('ftth-email');
      showToast(__('logout.message'));
      window.location.href = '/login';
    })
    .catch(function() {
      localStorage.removeItem('ftth-company');
      localStorage.removeItem('ftth-email');
      window.location.href = '/login';
    });
}

// Close dashboard overlay
// ====================================================
// START
// ====================================================
loadBlockPositionsFromStorage();
loadAll();
console.log('✅ MapFiber v2 — TOMODAT Style cargado');
