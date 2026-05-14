/**
 * D3.js Fiber Animations — TOMODAT-style animated light pulses
 * 
 * Creates animated pulses of light that travel along active fiber paths,
 * simulating optical data flow. Uses D3.js v7 for smooth 60fps animations.
 */

let _animationRefs = {};

/**
 * Initialize D3.js fiber animations on the SVG
 * @param {string} svgSelector - CSS selector for the SVG element
 * @param {Array} fiberPaths - Array of active fiber path data
 */
function initFiberAnimations(svgSelector, fiberPaths) {
  // Clear any existing animations
  stopFiberAnimations();
  
  const svg = d3.select(svgSelector);
  if (svg.empty()) return;
  
  // Create a defs section for glow filter if not exists
  let defs = svg.select('defs');
  if (defs.empty()) {
    defs = svg.append('defs');
  }
  
  // Add glow filter for pulse effect
  if (defs.select('#fiber-glow').empty()) {
    defs.append('filter')
      .attr('id', 'fiber-glow')
      .append('feGaussianBlur')
      .attr('stdDeviation', '2')
      .attr('result', 'blur');
    
    defs.select('#fiber-glow')
      .append('feMerge')
      .selectAll('feMergeNode')
      .data(['blur', 'SourceGraphic'])
      .enter()
      .append('feMergeNode')
      .attr('in', d => d);
  }
  
  // For each active fiber path, create traveling pulse
  fiberPaths.forEach((fp) => {
    // Try matching by data-fusion first, then data-splice
    let pathEl = svg.select(`path[data-fusion="${fp.fusionId}"]`);
    if (pathEl.empty()) {
      pathEl = svg.select(`path[data-splice="${fp.spliceId}"]`);
    }
    if (pathEl.empty()) return;
    
    const pathNode = pathEl.node();
    const pathLength = pathNode.getTotalLength();
    if (!pathLength) return;
    
    // Pulse speed based on power level (higher power = faster)
    let speed = 3000; // default ms for full traversal
    if (fp.powerLevel !== null) {
      if (fp.powerLevel >= -15) speed = 1500;
      else if (fp.powerLevel >= -20) speed = 2500;
      else if (fp.powerLevel >= -25) speed = 3500;
      else speed = 5000;
    }
    
    // Create multiple pulses at different phases for continuous effect
    const pulseCount = 3;
    const color = fp.color || '#00ff88';
    
    for (let p = 0; p < pulseCount; p++) {
      const phase = (p / pulseCount) * speed;
      
      // Create pulse circle
      const pulse = svg.append('circle')
        .attr('class', 'd3-pulse')
        .attr('r', 0)
        .attr('fill', color)
        .attr('opacity', 0)
        .attr('filter', 'url(#fiber-glow)');
      
      // Use a wrapper object so the animation frame ID is stored properly
      const animState = { current: null };
      
      function pulseFrame(startTime, offset, pathNode, pathLength, speed, pulse, animState) {
        const elapsed = (Date.now() - startTime + offset) % speed;
        const progress = elapsed / speed; // 0 to 1
        
        // Fade in at start, fade out at end
        let opacity = 0;
        let radius = 0;
        if (progress < 0.15) {
          // Fade in
          opacity = progress / 0.15 * 0.9;
          radius = 2 + (progress / 0.15) * 3;
        } else if (progress > 0.85) {
          // Fade out
          const fadeOut = (1 - progress) / 0.15;
          opacity = fadeOut * 0.9;
          radius = 2 + fadeOut * 3;
        } else {
          // Full brightness
          opacity = 0.9;
          radius = 5;
        }
        
        try {
          const point = pathNode.getPointAtLength(progress * pathLength);
          pulse
            .attr('cx', point.x)
            .attr('cy', point.y)
            .attr('r', radius)
            .attr('opacity', opacity);
        } catch(e) {
          // Path might be invalid, skip frame
        }
        
        if (animState.current !== null) {
          animState.current = requestAnimationFrame(() => 
            pulseFrame(startTime, offset, pathNode, pathLength, speed, pulse, animState)
          );
        }
      }
      
      // Start the animation
      const startTime = Date.now();
      animState.current = requestAnimationFrame(() => 
        pulseFrame(startTime, phase, pathNode, pathLength, speed, pulse, animState)
      );
      
      const animId = `fiber-${fp.fusionId || fp.spliceId}-${p}`;
      _animationRefs[animId] = animState;
    }
    
    // Also add a glow effect on the path itself
    pathEl
      .attr('filter', 'url(#fiber-glow)')
      .style('transition', 'none');
  });
}

/**
 * Stop all D3.js fiber animations and cleanup
 */
function stopFiberAnimations() {
  // Remove pulse circles from SVG
  d3.selectAll('.d3-pulse').remove();
  
  // Clear animation frame references
  Object.keys(_animationRefs).forEach(key => {
    if (_animationRefs[key] && _animationRefs[key].current) {
      cancelAnimationFrame(_animationRefs[key].current);
    }
    delete _animationRefs[key];
  });
  
  // Remove glow filter from paths
  d3.selectAll('.fl').attr('filter', null);
}

/**
 * Refresh animations — call after SVG is re-rendered
 */
function refreshFiberAnimations() {
  const svg = document.querySelector('#vis-svg svg');
  if (!svg) return;
  
  const activePaths = [];
  svg.querySelectorAll('.fl.active-pulse').forEach(path => {
    const fusionId = path.dataset.fusion;
    const spliceId = path.dataset.splice;
    // Use fiber-color-in as the main color (fallback to fiberColor), or just #00ff88
    const color = path.dataset.fiberColorIn || path.dataset.fiberColor || '#00ff88';
    const power = path.dataset.fusionPower;
    if (fusionId || spliceId) {
      activePaths.push({
        fusionId: fusionId || spliceId,
        spliceId: spliceId || null,
        color,
        powerLevel: power ? parseFloat(power) : null
      });
    }
  });
  
  if (activePaths.length > 0) {
    initFiberAnimations('#vis-svg svg', activePaths);
  }
}
