const fs = require('fs');
const path = 'D:\\Tools\\pdr-staging\\greg_face_v8.html';
let c = fs.readFileSync(path, 'utf8');

// Replace the broken blending with direct spring target setting
const old = `const blended = expr({});  // start with neutral defaults
    for (const name in weights) {
      const w = weights[name];
      const src = CAT[name];
      if (!src || w < 0.02) continue;
      for (const k in blended) {
        if (typeof blended[k] === 'number' && typeof src[k] === 'number') {
          blended[k] += (src[k] - expr({})[k]) * w;
        }
      }
    }`;

const rep = `neutral = CAT.neutral;
    for (const k in springs) {
      if (neutral[k] === undefined || typeof neutral[k] !== 'number') continue;
      let bv = neutral[k];
      for (const name in weights) {
        const src = CAT[name];
        if (!src || src[k] === undefined) continue;
        bv += (src[k] - neutral[k]) * weights[name];
      }
      springs[k].target = bv;
    }`;

if (c.includes(old)) {
  c = c.replace(old, rep);
  // Remove setTarget(blended) call
  c = c.replace('    setTarget(blended);\n\n    // Blink', '    // Blink');
  // Fix background to use springs directly
  c = c.replace('blended.bgR = Math.max', 'springs.bgR.target = Math.max');
  c = c.replace('blended.bgG = Math.max', 'springs.bgG.target = Math.max');
  c = c.replace('blended.bgB = Math.max', 'springs.bgB.target = Math.max');
  c = c.replace('blended.bgR + bgMod', 'springs.bgR.target + bgMod');
  c = c.replace('blended.bgG + bgMod', 'springs.bgG.target + bgMod');
  c = c.replace('blended.bgB + bgMod', 'springs.bgB.target + bgMod');
  // Fix label to use hud directly
  c = c.replace("blended.label = window.snarc.getDominant()", "hud.textContent = window.snarc.getDominant()");
  // Remove the setTarget(blended) line if still present
  c = c.replace(/\n\s*\/\/ Feed blended.*\n\s*setTarget\(blended\);/g, '');
  fs.writeFileSync(path, c, 'utf8');
  console.log('PATCHED OK');
} else {
  console.log('OLD BLOCK NOT FOUND');
  console.log('Has expr({}):', c.includes('expr({})'));
}
