import re

path = r'D:\Tools\pdr-staging\greg_face_v8.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = '''    // Blend expression catalog by SNARC weights
    const weights = window.snarc.getExpressionWeights();
    const blended = expr({});  // start with neutral defaults
    for (const name in weights) {
      const w = weights[name];
      const src = CAT[name];
      if (!src || w < 0.02) continue;
      for (const k in blended) {
        if (typeof blended[k] === 'number' && typeof src[k] === 'number') {
          blended[k] += (src[k] - expr({})[k]) * w;
        }
      }
    }

    // Background color modulation from SNARC
    const bgMod = window.snarc.getBackgroundMod();
    blended.bgR = Math.max(0, Math.min(255, blended.bgR + bgMod.r));
    blended.bgG = Math.max(0, Math.min(255, blended.bgG + bgMod.g));
    blended.bgB = Math.max(0, Math.min(255, blended.bgB + bgMod.b));'''

new = '''    // Blend expression catalog by SNARC weights
    const weights = window.snarc.getExpressionWeights();
    const neutral = CAT.neutral;
    for (const k in springs) {
      if (neutral[k] === undefined || typeof neutral[k] !== 'number') continue;
      let blendedVal = neutral[k];
      for (const name in weights) {
        const src = CAT[name];
        if (!src || src[k] === undefined) continue;
        blendedVal += (src[k] - neutral[k]) * weights[name];
      }
      // Directly set spring target — no anticipation/stagger
      springs[k].target = blendedVal;
    }

    // Background color modulation from SNARC
    const bgMod = window.snarc.getBackgroundMod();
    springs.bgR.target = Math.max(0, Math.min(255, springs.bgR.target + bgMod.r));
    springs.bgG.target = Math.max(0, Math.min(255, springs.bgG.target + bgMod.g));
    springs.bgB.target = Math.max(0, Math.min(255, springs.bgB.target + bgMod.b));'''

if old in content:
    content = content.replace(old, new)
    # Also fix the label/setTarget lines
    content = content.replace(
        "    // Build label from dominant SNARC dimension\n    blended.label = window.snarc.getDominant()",
        "    // HUD shows live SNARC state\n    hud.textContent = window.snarc.getDominant()"
    )
    content = content.replace(
        "    // Feed blended expression to spring targets (smooth transition)\n    setTarget(blended);\n\n    // Blink",
        "    // Blink"
    )
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('PATCHED OK')
else:
    print('OLD BLOCK NOT FOUND — checking...')
    if 'const blended = expr' in content:
        print('Found blended expr but exact match failed')
    else:
        print('Already patched or different content')
