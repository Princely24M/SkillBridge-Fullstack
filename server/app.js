const path = require('node:path');
const express = require('express');
const { DataAccessError } = require('./lib/opportunities');

const ALLOWED_QUERY_PARAMETERS = new Set([
  'q',
  'category',
  'location',
  'page',
  'limit',
  'sort'
]);
const SORT_OPTIONS = new Set(['closing_date', 'newest']);
const MAX_FILTER_LENGTH = 100;
const MAX_ID_LENGTH = 200;

class BadRequestError extends Error {
  constructor(message = 'Invalid query parameters.') {
    super(message);
    this.name = 'BadRequestError';
  }
}

function readOptionalText(query, name) {
  const value = query[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new BadRequestError();
  }

  const normalized = value.trim();
  if (normalized.length > MAX_FILTER_LENGTH) {
    throw new BadRequestError();
  }

  return normalized || undefined;
}

function readPositiveInteger(query, name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const value = query[name];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new BadRequestError();
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new BadRequestError();
  }

  return parsed;
}

function parseListQuery(query) {
  if (Object.keys(query).some((key) => !ALLOWED_QUERY_PARAMETERS.has(key))) {
    throw new BadRequestError();
  }

  const sort = query.sort === undefined ? 'closing_date' : query.sort;
  if (typeof sort !== 'string' || !SORT_OPTIONS.has(sort)) {
    throw new BadRequestError();
  }

  const page = readPositiveInteger(query, 'page', 1);
  const limit = readPositiveInteger(query, 'limit', 20, 100);
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset) || offset > Number.MAX_SAFE_INTEGER - limit) {
    throw new BadRequestError();
  }

  return {
    q: readOptionalText(query, 'q'),
    category: readOptionalText(query, 'category'),
    location: readOptionalText(query, 'location'),
    page,
    limit,
    sort
  };
}

function isExpiredByDate(item, today = new Date().toISOString().slice(0, 10)) {
  if (typeof item.closing_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.closing_date)) {
    return false;
  }

  const parsedDate = new Date(`${item.closing_date}T00:00:00.000Z`);
  return Number.isFinite(parsedDate.getTime())
    && parsedDate.toISOString().slice(0, 10) === item.closing_date
    && item.closing_date < today;
}

function isPublicOpportunity(item) {
  return (item.status === 'active' || isExpiredByDate(item))
    && item.is_verified === true
    && item.is_sample === false
    && item.verification_status === 'verified';
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortOpportunities(items, sort) {
  return items.sort((left, right) => {
    if (sort === 'newest') {
      const byCreatedAt = compareText(right.created_at || '', left.created_at || '');
      return byCreatedAt || compareText(left.id, right.id);
    }

    if (left.closing_date === null && right.closing_date !== null) return 1;
    if (left.closing_date !== null && right.closing_date === null) return -1;
    return compareText(left.closing_date || '', right.closing_date || '')
      || compareText(left.id, right.id);
  });
}

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function normalizeRole(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['candidate', 'admin', 'super_admin'].includes(normalized) ? normalized : 'candidate';
}

function normalizeAdminUser(user) {
  if (!user || typeof user !== 'object') {
    return {
      id: '',
      full_name: 'User',
      email: '',
      role: 'candidate',
      status: 'active',
      created_at: new Date().toISOString()
    };
  }

  return {
    id: user.id || '',
    full_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User',
    email: user.email || '',
    role: normalizeRole(user.app_metadata?.role || user.role || 'candidate'),
    status: user.status || 'active',
    created_at: user.created_at || new Date().toISOString()
  };
}

function getAdminClient(supabaseClient, adminClient) {
  if (adminClient && adminClient.auth && adminClient.auth.admin) {
    return adminClient;
  }

  if (supabaseClient && supabaseClient.auth && supabaseClient.auth.admin) {
    return supabaseClient;
  }

  return null;
}

function setBearerToken(req) {
  const header = req.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

function getUserRole(user) {
  if (!user || typeof user !== 'object') {
    return 'candidate';
  }

  return normalizeRole(user.app_metadata?.role || 'candidate');
}

async function getAuthenticatedUser(req, supabaseClient) {
  const token = setBearerToken(req);
  if (!token) {
    return { error: { status: 401, code: 'UNAUTHORIZED', message: 'Authentication required.' } };
  }

  if (!supabaseClient || typeof supabaseClient.auth?.getUser !== 'function') {
    return { error: { status: 503, code: 'AUTH_UNAVAILABLE', message: 'Authentication services are unavailable.' } };
  }

  const { data, error } = await supabaseClient.auth.getUser(token);
  if (error || !data?.user) {
    return { error: { status: 401, code: 'UNAUTHORIZED', message: 'Authentication required.' } };
  }

  return { user: data.user };
}

function summarizeOpportunityMetrics(items) {
  const normalized = Array.isArray(items) ? items : [];
  const totalOpportunities = normalized.length;
  const publishedOpportunities = normalized.filter((item) => item.status === 'active' && item.is_verified === true).length;
  const draftOpportunities = normalized.filter((item) => item.status === 'draft' || item.status === 'pending').length;
  const expiredOpportunities = normalized.filter((item) => (
    item.status === 'expired'
    || item.status === 'closed'
    || isExpiredByDate(item)
  )).length;
  const awaitingReview = normalized.filter((item) => item.verification_status === 'needs_review' || item.verification_status === 'pending').length;

  return {
    totalUsers: 0,
    totalOpportunities,
    activeCandidateAccounts: 0,
    publishedOpportunities,
    draftOpportunities,
    expiredOpportunities,
    awaitingReview
  };
}

function buildOpportunityPayload(body = {}, fallbackId = undefined) {
  const nextId = typeof body?.id === 'string' && body.id.trim() ? body.id.trim() : fallbackId || `skillbridge-${Date.now()}`;
  const title = String(body?.title || '').trim();
  const organisation = String(body?.organisation || '').trim();
  const category = String(body?.category || '').trim();
  const location = String(body?.location || '').trim();

  return {
    id: nextId,
    title,
    organisation,
    category,
    location,
    closing_date: body?.closing_date || null,
    experience_level: String(body?.experience_level || 'Varies').trim() || 'Varies',
    description: String(body?.description || '').trim(),
    eligibility: Array.isArray(body?.eligibility) ? body.eligibility : [],
    required_documents: Array.isArray(body?.required_documents) ? body.required_documents : [],
    application_instructions: String(body?.application_instructions || '').trim(),
    official_application_url: String(body?.official_application_url || '').trim(),
    source_url: String(body?.source_url || '').trim(),
    source_name: String(body?.source_name || '').trim() || organisation,
    status: ['draft', 'active', 'expired', 'closed', 'pending'].includes(String(body?.status || 'draft').trim()) ? String(body.status).trim() : 'draft',
    verification_status: ['verified', 'pending', 'needs_review'].includes(String(body?.verification_status || 'pending').trim()) ? String(body.verification_status).trim() : 'pending',
    verification_level: String(body?.verification_level || 'manual').trim() || 'manual',
    is_verified: Boolean(body?.is_verified ?? false),
    is_sample: Boolean(body?.is_sample ?? false),
    last_verified_at: body?.last_verified_at || new Date().toISOString(),
    imported_at: body?.imported_at || new Date().toISOString(),
    created_at: body?.created_at || new Date().toISOString(),
    updated_at: body?.updated_at || new Date().toISOString()
  };
}

function createApp({ opportunities, logger = console, authConfig = null, supabaseClient = null, adminClient = null }) {
  if (!opportunities || typeof opportunities.list !== 'function' || typeof opportunities.getById !== 'function') {
    throw new TypeError('An opportunity repository with list and getById methods is required.');
  }

  const app = express();
  const staticRoot = path.resolve(__dirname, '..');
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.get('/admin', (req, res) => {
    res.redirect(302, '/admin/dashboard.html');
  });

  app.use(express.static(staticRoot, {
    index: 'index.html',
    redirect: false,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }));
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && isLoopbackOrigin(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
      if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Accept, Authorization, Content-Type, X-Requested-With');
        res.vary('Access-Control-Request-Method');
        res.vary('Access-Control-Request-Headers');
        return res.sendStatus(204);
      }
    }
    next();
  });

  app.get('/api', (req, res) => {
    res.json({
      ok: true,
      service: 'skillbridge-api',
      endpoints: ['/api/health', '/api/opportunities', '/api/opportunities/:id']
    });
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'skillbridge-api' });
  });

  app.get('/api/auth-config', (req, res) => {
    if (!authConfig) {
      return res.status(503).json({
        error: { code: 'AUTH_CONFIG_UNAVAILABLE', message: 'Authentication is not configured.' }
      });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({
      supabaseUrl: authConfig.url,
      publishableKey: authConfig.key
    });
  });

  async function requireAdmin(req, res, next) {
    const auth = await getAuthenticatedUser(req, supabaseClient);
    if (auth.error) {
      return res.status(auth.error.status || 401).json({
        error: { code: auth.error.code || 'UNAUTHORIZED', message: auth.error.message || 'Authentication required.' }
      });
    }

    const role = getUserRole(auth.user);
    if (role !== 'admin' && role !== 'super_admin') {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You do not have permission to access the admin area.' }
      });
    }

    req.authUser = auth.user;
    req.authRole = role;
    return next();
  }

  app.get('/api/admin/me', requireAdmin, async (req, res) => {
    res.json({
      user: {
        id: req.authUser.id,
        email: req.authUser.email,
        role: req.authRole,
        status: 'active'
      }
    });
  });

  app.get('/api/admin/metrics', requireAdmin, async (req, res) => {
    const items = await opportunities.list({ limit: 1000, page: 1, sort: 'newest' });
    const metrics = summarizeOpportunityMetrics(items);

    const admin = getAdminClient(supabaseClient, adminClient);
    let totalUsers = 0;
    let activeCandidateAccounts = 0;
    if (admin && typeof admin.auth?.admin?.listUsers === 'function') {
      const { data, error } = await admin.auth.admin.listUsers();
      if (!error && Array.isArray(data?.users)) {
        totalUsers = data.users.length;
        activeCandidateAccounts = data.users.filter((user) => normalizeRole(user.app_metadata?.role || user.role || 'candidate') === 'candidate').length;
      }
    }

    metrics.totalUsers = totalUsers;
    metrics.activeCandidateAccounts = activeCandidateAccounts;

    res.json({
      user: {
        id: req.authUser.id,
        email: req.authUser.email,
        role: req.authRole,
        status: 'active'
      },
      metrics,
      generatedAt: new Date().toISOString()
    });
  });

  app.get('/api/admin/opportunities', requireAdmin, async (req, res) => {
    const items = await opportunities.list({ limit: 1000, page: 1, sort: 'newest' });
    res.json({
      items,
      pagination: {
        page: 1,
        limit: items.length,
        total: items.length,
        totalPages: items.length === 0 ? 0 : 1
      }
    });
  });

  app.get('/api/admin/users', requireAdmin, async (req, res) => {
    const admin = getAdminClient(supabaseClient, adminClient);

    if (!admin || typeof admin.auth?.admin?.listUsers !== 'function') {
      const profile = normalizeAdminUser(req.authUser);
      return res.json({ users: [profile] });
    }

    const { data, error } = await admin.auth.admin.listUsers();
    if (error || !data || !Array.isArray(data.users)) {
      const profile = normalizeAdminUser(req.authUser);
      return res.json({ users: [profile] });
    }

    const users = data.users.map(normalizeAdminUser);
    return res.json({ users });
  });

  app.get('/api/admin/profile', requireAdmin, async (req, res) => {
    const admin = getAdminClient(supabaseClient, adminClient);
    const profile = normalizeAdminUser(req.authUser);

    if (!admin || typeof admin.auth?.admin?.listUsers !== 'function') {
      return res.json({ user: profile });
    }

    const { data, error } = await admin.auth.admin.listUsers();
    if (!error && data && Array.isArray(data.users)) {
      const current = data.users.find((user) => user.id === req.authUser.id);
      if (current) {
        return res.json({ user: normalizeAdminUser(current) });
      }
    }

    return res.json({ user: profile });
  });

  app.patch('/api/admin/profile', requireAdmin, async (req, res) => {
    const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
    if (!fullName) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Full name is required.' }
      });
    }

    const admin = getAdminClient(supabaseClient, adminClient);
    if (!admin || typeof admin.auth?.admin?.updateUserById !== 'function') {
      return res.status(503).json({
        error: { code: 'ADMIN_PROFILE_UNAVAILABLE', message: 'Profile updates are unavailable.' }
      });
    }

    const { data, error } = await admin.auth.admin.updateUserById(req.authUser.id, {
      user_metadata: { full_name: fullName }
    });

    if (error || !data?.user) {
      return res.status(400).json({
        error: { code: 'PROFILE_UPDATE_FAILED', message: 'Unable to update your profile.' }
      });
    }

    return res.json({ user: normalizeAdminUser(data.user) });
  });

  app.patch('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
    const userId = String(req.params.id || '').trim();
    if (!userId) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'A valid user ID is required.' }
      });
    }

    const role = normalizeRole(req.body?.role);
    if (req.body?.role === undefined || typeof req.body.role !== 'string' || !['candidate', 'admin', 'super_admin'].includes(req.body.role.trim().toLowerCase())) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Role must be one of: candidate, admin, super_admin.' }
      });
    }

    const admin = getAdminClient(supabaseClient, adminClient);
    if (!admin || typeof admin.auth?.admin?.updateUserById !== 'function') {
      return res.status(503).json({
        error: { code: 'ADMIN_USERS_UNAVAILABLE', message: 'User management is unavailable.' }
      });
    }

    const { data, error } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: { role }
    });

    if (error || !data?.user) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'User not found.' }
      });
    }

    return res.json({ user: normalizeAdminUser(data.user) });
  });

  app.get('/api/admin/opportunities/:id', requireAdmin, async (req, res) => {
    const admin = getAdminClient(supabaseClient, adminClient);
    if (!admin || typeof admin.from !== 'function') {
      return res.status(503).json({
        error: { code: 'ADMIN_OPPORTUNITIES_UNAVAILABLE', message: 'Opportunity management is unavailable.' }
      });
    }

    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'A valid opportunity ID is required.' }
      });
    }

    const { data, error } = await admin
      .from('opportunities')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Opportunity not found.' }
      });
    }

    return res.json({ opportunity: data });
  });

  app.post('/api/admin/opportunities', requireAdmin, async (req, res) => {
    const admin = getAdminClient(supabaseClient, adminClient);
    if (!admin || typeof admin.from !== 'function') {
      return res.status(503).json({
        error: { code: 'ADMIN_OPPORTUNITIES_UNAVAILABLE', message: 'Opportunity creation is unavailable.' }
      });
    }

    const payload = buildOpportunityPayload(req.body);

    if (!payload.title || !payload.organisation || !payload.category || !payload.location) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Title, organisation, category, and location are required.' }
      });
    }

    const { data, error } = await admin
      .from('opportunities')
      .insert(payload)
      .select()
      .single();

    if (error || !data) {
      const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
      if (error?.code === '42P01' || message.includes('does not exist')) {
        return res.status(503).json({
          error: { code: 'OPPORTUNITY_TABLE_MISSING', message: 'The Supabase opportunities table is not configured. Add the project table or run the migration before creating opportunities.' }
        });
      }

      if (error?.code === '23514' || message.includes('check constraint') || message.includes('violates check constraint')) {
        return res.status(400).json({
          error: { code: 'OPPORTUNITY_STATUS_INVALID', message: 'The Supabase opportunities table is using an older status constraint. Update the table schema to allow draft, active, expired, closed, and pending values, then try again.' }
        });
      }

      return res.status(400).json({
        error: { code: 'OPPORTUNITY_CREATE_FAILED', message: 'Unable to create the opportunity.' }
      });
    }

    return res.json({ opportunity: data });
  });

  app.patch('/api/admin/opportunities/:id', requireAdmin, async (req, res) => {
    const admin = getAdminClient(supabaseClient, adminClient);
    if (!admin || typeof admin.from !== 'function') {
      return res.status(503).json({
        error: { code: 'ADMIN_OPPORTUNITIES_UNAVAILABLE', message: 'Opportunity updates are unavailable.' }
      });
    }

    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'A valid opportunity ID is required.' }
      });
    }

    const existing = await admin.from('opportunities').select('*').eq('id', id).maybeSingle();
    if (existing.error || !existing.data) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Opportunity not found.' }
      });
    }

    const payload = buildOpportunityPayload({
      ...existing.data,
      ...req.body,
      id,
      updated_at: new Date().toISOString()
    }, id);

    if (!payload.title || !payload.organisation || !payload.category || !payload.location) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Title, organisation, category, and location are required.' }
      });
    }

    const { data, error } = await admin
      .from('opportunities')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
      if (error?.code === '42P01' || message.includes('does not exist')) {
        return res.status(503).json({
          error: { code: 'OPPORTUNITY_TABLE_MISSING', message: 'The Supabase opportunities table is not configured. Add the project table or run the migration before updating opportunities.' }
        });
      }

      if (error?.code === '23514' || message.includes('check constraint') || message.includes('violates check constraint')) {
        return res.status(400).json({
          error: { code: 'OPPORTUNITY_STATUS_INVALID', message: 'The Supabase opportunities table is using an older status constraint. Update the table schema to allow draft, active, expired, closed, and pending values, then try again.' }
        });
      }

      return res.status(400).json({
        error: { code: 'OPPORTUNITY_UPDATE_FAILED', message: 'Unable to update the opportunity.' }
      });
    }

    return res.json({ opportunity: data });
  });

  app.delete('/api/admin/opportunities/:id', requireAdmin, async (req, res) => {
    const admin = getAdminClient(supabaseClient, adminClient);
    if (!admin || typeof admin.from !== 'function') {
      return res.status(503).json({
        error: { code: 'ADMIN_OPPORTUNITIES_UNAVAILABLE', message: 'Opportunity deletion is unavailable.' }
      });
    }

    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'A valid opportunity ID is required.' }
      });
    }

    const { data, error } = await admin
      .from('opportunities')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      if (error?.code === '42P01' || error?.message?.toLowerCase().includes('does not exist')) {
        return res.status(503).json({
          error: { code: 'OPPORTUNITY_TABLE_MISSING', message: 'The Supabase opportunities table is not configured. Add the project table or run the migration before deleting opportunities.' }
        });
      }

      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Opportunity not found.' }
      });
    }

    return res.json({ deleted: data });
  });

  app.get('/api/admin/reports', requireAdmin, async (req, res) => {
    const items = await opportunities.list({ limit: 1000, page: 1, sort: 'newest' });
    const metrics = summarizeOpportunityMetrics(items);
    res.json({
      generatedAt: new Date().toISOString(),
      summary: metrics,
      categories: [...new Set(items.map((item) => item.category).filter(Boolean))]
    });
  });

  app.get('/api/opportunities', async (req, res) => {
    const filters = parseListQuery(req.query);
    const results = await opportunities.list(filters);
    const eligible = results.filter(isPublicOpportunity);
    const sorted = sortOpportunities(eligible, filters.sort);
    const start = (filters.page - 1) * filters.limit;
    const items = sorted.slice(start, start + filters.limit);

    res.json({
      items,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total: sorted.length,
        totalPages: Math.ceil(sorted.length / filters.limit)
      }
    });
  });

  app.get('/api/opportunities/:id', async (req, res) => {
    const id = req.params.id.trim();
    if (!id || id.length > MAX_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(id)) {
      throw new BadRequestError('Invalid opportunity ID.');
    }

    const item = await opportunities.getById(id);
    if (!item || !isPublicOpportunity(item)) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Opportunity not found.' }
      });
    }

    return res.json({ item });
  });

  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Endpoint not found.' }
    });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    if (error instanceof BadRequestError) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: error.message }
      });
    }

    if (error?.status === 400 || error?.status === 413) {
      const status = error.status;
      return res.status(status).json({
        error: {
          code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
          message: status === 413 ? 'Request body is too large.' : 'Invalid request.'
        }
      });
    }

    logger.error({
      event: 'api_request_failed',
      method: req.method,
      route: req.route?.path || req.path,
      code: error instanceof DataAccessError ? error.code : 'INTERNAL_ERROR'
    });
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' }
    });
  });

  return app;
}

module.exports = { createApp };
