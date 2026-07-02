// BOLT — Comisión por facturación (mano de obra de los últimos 30 días).
// Ventana MÓVIL: si el trabajador factura menos, la comisión vuelve a subir sola.
// Piso de calidad: con menos de 4.0★ no accede a descuentos.

export const COMMISSION_BASE = 20;

// Escalones: facturación mínima (en $) en los últimos 30 días → comisión.
export const COMMISSION_TIERS = [
  { min: 2000000, pct: 18 }, // ≈ $500k/semana
  { min: 4000000, pct: 16 },
  { min: 7000000, pct: 14 },
];

// Comisión vigente según lo facturado en 30 días + calificación.
export function commissionForBilled(billed30, rating) {
  const r = parseFloat(rating) || 0;
  if (r < 4.0) return COMMISSION_BASE; // piso de calidad
  let pct = COMMISSION_BASE;
  for (const t of COMMISSION_TIERS) if ((billed30 || 0) >= t.min) pct = t.pct;
  return pct;
}

// Próximo escalón: { pct, falta } o null si ya está en el más bajo.
export function nextCommissionStep(billed30) {
  for (const t of COMMISSION_TIERS) {
    if ((billed30 || 0) < t.min) return { pct: t.pct, falta: t.min - (billed30 || 0) };
  }
  return null;
}

// Etiqueta de nivel según la comisión vigente.
export function levelLabel(commission) {
  if (commission <= 14) return 'Elite';
  if (commission <= 16) return 'Pro';
  if (commission <= 18) return 'Activo';
  return 'Nuevo';
}
