// Global singleton — no toca servicios de producción
let _on = false;
let _role = 'client'; // 'client' | 'worker' — desde qué lado se mira el demo

export const isDemoMode    = ()    => _on;
export const enableDemo    = ()    => { _on = true; };
export const disableDemo   = ()    => { _on = false; };
export const toggleDemo    = ()    => { _on = !_on; return _on; };

export const setDemoRole   = (r)   => { _role = r === 'worker' ? 'worker' : 'client'; };
export const getDemoRole   = ()    => _role;
