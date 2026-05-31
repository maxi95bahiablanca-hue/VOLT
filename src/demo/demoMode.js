// Global singleton — no toca servicios de producción
let _on = false;
export const isDemoMode    = ()    => _on;
export const enableDemo    = ()    => { _on = true; };
export const disableDemo   = ()    => { _on = false; };
export const toggleDemo    = ()    => { _on = !_on; return _on; };
