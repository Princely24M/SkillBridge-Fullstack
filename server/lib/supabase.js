const { createClient } = require('@supabase/supabase-js');

function isPublicKey(key) {
  if (key.startsWith('sb_publishable_')) {
    return true;
  }

  const segments = key.split('.');
  if (segments.length !== 3) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString());
    return payload.role === 'anon';
  } catch {
    return false;
  }
}

function readSupabaseConfig(env = process.env) {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim() || env.SUPABASE_ANON_KEY?.trim();

  if (!url) {
    throw new Error('SUPABASE_URL is required.');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTP or HTTPS URL.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('SUPABASE_URL must be a valid HTTP or HTTPS URL.');
  }

  if (!key) {
    throw new Error('Set SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY.');
  }

  if (!isPublicKey(key)) {
    throw new Error('The Supabase key must be a publishable key or an anon key; privileged keys are not supported.');
  }

  return { url, key };
}

function createSupabaseClient(env = process.env) {
  const { url, key } = readSupabaseConfig(env);

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

module.exports = { createSupabaseClient, readSupabaseConfig };
