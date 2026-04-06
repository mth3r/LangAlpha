/**
 * Deployment mode: "oss" (self-hosted, no auth) or "platform" (Supabase auth + quota service).
 *
 * Resolved once from the VITE_HOST_MODE build-time env var.
 * Import this instead of checking VITE_SUPABASE_URL for mode detection.
 */
export type HostMode = 'oss' | 'platform';

export const HOST_MODE: HostMode = (import.meta.env.VITE_HOST_MODE ?? 'oss') as HostMode;
export const isPlatformMode = HOST_MODE === 'platform';
