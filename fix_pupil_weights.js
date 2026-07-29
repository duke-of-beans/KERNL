const fs = require('fs');
const path = 'D:\\Tools\\pdr-staging\\greg_face_v8.html';
let c = fs.readFileSync(path, 'utf8');
let changes = 0;

// FIX 1: Remove eye tracker's direct focus control — let SNARC own it
const focusBlock = `          // Focus adjusts slowly, not every frame
          // (rapid focus changes caused pupil size jitter)
          if (springs && springs.focus && !window._focusLock) {
            window._focusLock = true;
            setTimeout(function() {
              springs.focus.target = Math.max(0.1, 1 - d.size * 1.5);
              window._focusLock = false;
            }, 500);  // Update focus at most every 500ms
          }`;
if (c.includes(focusBlock)) {
  c = c.replace(focusBlock, `          // Focus now driven by SNARC — eye tracker provides size to SNARC only
          if (window.snarc && d.size) {
            // Feed face size as arousal signal (closer = higher arousal)
            var sizeArousal = Math.min(0.3, d.size * 0.3);
            if (window.snarc.A < sizeArousal) window.snarc.A = window.snarc.A * 0.95 + sizeArousal * 0.05;
          }`);
  changes++;
}

// FIX 2: Make pupil springs critically damped — no bounce at all
if (c.includes("pupil: { stiff: 0.15, damp: 0.5")) {
  c = c.replace("pupil: { stiff: 0.15, damp: 0.5", "pupil: { stiff: 0.08, damp: 0.75");
  changes++;
}

// FIX 3: Polarize SNARC weights — square them before normalizing
// This makes the dominant expression much stronger and suppresses weak ones
// Find getExpressionWeights in snarc.js
const snarcPath = 'D:\\Tools\\pdr-staging\\snarc.js';
let s = fs.readFileSync(snarcPath, 'utf8');

// Replace the normalization section with power-scaling
const oldNorm = `    // Normalize weights so they sum to 1
    let total = 0;
    for (const k in w) total += w[k];
    if (total > 0) {
      for (const k in w) w[k] /= total;
    } else {
      w.neutral = 1;
    }

    // Kill negligible weights (below 2%)
    for (const k in w) {
      if (w[k] < 0.02) delete w[k];
    }`;

const newNorm = `    // Power-scale weights for contrast — dominant expression reads clearly
    for (const k in w) w[k] = Math.pow(Math.max(0, w[k]), 1.8);

    // Normalize so they sum to 1
    let total = 0;
    for (const k in w) total += w[k];
    if (total > 0) {
      for (const k in w) w[k] /= total;
    } else {
      w.neutral = 1;
    }

    // Kill negligible weights (below 5%)
    for (const k in w) {
      if (w[k] < 0.05) delete w[k];
    }
    // Re-normalize after culling
    total = 0;
    for (const k in w) total += w[k];
    if (total > 0) for (const k in w) w[k] /= total;`;

if (s.includes(oldNorm)) {
  s = s.replace(oldNorm, newNorm);
  fs.writeFileSync(snarcPath, s, 'utf8');
  console.log('SNARC weights polarized');
  changes++;
}

fs.writeFileSync(path, c, 'utf8');
console.log('Changes applied:', changes);
