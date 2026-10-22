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

function isPublicOpportunity(item) {
  return item.status === 'active'
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
  const expiredOpportunities = normalized.filter((item) => item.status === 'expired' || (item.closing_date && new Date(item.closing_date) < new Date())).length;
  const awaitingReview = normalized.filter((item) => item.verification_status === 'needs_review' || item.verification_status === 'pending').length;

  return {
    totalOpportunities,
    activeCandidateAccounts: 0,
    publishedOpportunities,
    draftOpportunities,
    expiredOpportunities,
    awaitingReview
  };
}

function createApp({ opportunities, logger = console, authConfig = null, supabaseClient = null }) {
  if (!opportunities || typeof opportunities.list !== 'function' || typeof opportunities.getById !== 'function') {
    throw new TypeError('An opportunity repository with list and getById methods is required.');
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && isLoopbackOrigin(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
      if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Accept, Authorization, Content-Type');
        res.vary('Access-Control-Request-Method');
        res.vary('Access-Control-Request-Headers');
        return res.sendStatus(204);
      }
    }
    next();
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
    metrics.activeCandidateAccounts = 0;

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
    const profile = {
      id: req.authUser.id,
      full_name: req.authUser.user_metadata?.full_name || req.authUser.email?.split('@')[0] || 'Admin',
      email: req.authUser.email,
      role: req.authRole,
      status: 'active',
      created_at: req.authUser.created_at || new Date().toISOString()
    };

    res.json({ users: [profile] });
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
