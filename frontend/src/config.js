// URL base de la API
// En producción usa la misma URL que la app (proxy reverso)
// En desarrollo apunta al backend local
export const API_BASE = import.meta.env.VITE_API_URL || (
  typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? ''  // En producción: misma URL (proxy nginx/docker sirve todo)
    : 'http://localhost:3001'
);
