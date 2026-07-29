// ── SNARC → PDR PERSONALITY MAPPING ──────────────────────
// Emotional state modulates involuntary reflex behavior.
// Alert = jumpy, hypervigilant. Sleepy = sluggish. Angry = fast lock-back.
// Each expression maps to PDR personality parameters:
//   sens = reflex sensitivity (0=stoic, 1=jumpy)
//   cur  = assessment curiosity (0=quick glance, 1=lingers)
//   ret  = return speed (0=slow drift, 1=snaps back)
//   hab  = habituation rate (0=stays reactive, 1=adapts fast)
const PDR_SNARC = {
  neutral:     { sens: 0.50, cur: 0.40, ret: 0.50, hab: 0.50 },
  alert:       { sens: 0.80, cur: 0.60, ret: 0.60, hab: 0.30 },
  content:     { sens: 0.35, cur: 0.30, ret: 0.40, hab: 0.60 },
  sleepy:      { sens: 0.15, cur: 0.20, ret: 0.30, hab: 0.80 },
  angry:       { sens: 0.70, cur: 0.20, ret: 0.85, hab: 0.40 },
  shocked:     { sens: 0.90, cur: 0.70, ret: 0.30, hab: 0.20 },
  grinning:    { sens: 0.30, cur: 0.30, ret: 0.60, hab: 0.70 },
  sad:         { sens: 0.25, cur: 0.50, ret: 0.30, hab: 0.60 },
  confused:    { sens: 0.60, cur: 0.70, ret: 0.40, hab: 0.40 },
  mischievous: { sens: 0.50, cur: 0.60, ret: 0.50, hab: 0.50 },
  deadpan:     { sens: 0.20, cur: 0.15, ret: 0.70, hab: 0.90 },
  laughing:    { sens: 0.20, cur: 0.20, ret: 0.70, hab: 0.80 },
};

function syncPDRtoExpression(name) {
  if (!window.pdr) return;
  const mapping = PDR_SNARC[name] || PDR_SNARC.neutral;
  window.pdr.setPersonality(mapping);
}
