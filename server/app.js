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
const MAX_AUTH_USER_PAGES = 1000;
const AUTH_USERS_PER_PAGE = 1000;
const ACCOUNT_STATUSES = new Set(['active', 'awaiting', 'inactive']);
const USER_ROLES = new Set(['candidate', 'admin', 'super_admin']);
const USER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AUDIT_ACTIONS = new Set([
  'user.created',
  'user.updated',
  'user.role_changed',
  'user.status_changed',
  'user.deleted',
  'opportunity.created',
  'opportunity.updated',
  'opportunity.status_changed',
  'opportunity.deleted'
]);
const AUDIT_ENTITY_TYPES = new Set(['user', 'opportunity']);
const AUDIT_FIELDS = new Set([
  'full_name', 'email', 'role', 'status',
  'title', 'organisation', 'category', 'location', 'closing_date',
  'experience_level', 'description', 'application_instructions', 'source_name',
  'verification_level', 'opportunity_status', 'verification_status', 'is_verified'
]);

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

function normalizeAdminUser(user, profile = null) {
  if (!user || typeof user !== 'object') {
    return {
      id: '',
      full_name: 'User',
      email: '',
      role: 'candidate',
      status: 'active',
      created_at: '',
      updated_at: null
    };
  }

  const metadataStatus = user.app_metadata?.account_status;
  const status = ACCOUNT_STATUSES.has(profile?.account_status)
    ? profile.account_status
    : ACCOUNT_STATUSES.has(metadataStatus)
      ? metadataStatus
      : 'active';

  return {
    id: user.id || '',
    full_name: profile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User',
    email: user.email || '',
    role: normalizeRole(user.app_metadata?.role || user.role || 'candidate'),
    status,
    created_at: user.created_at || '',
    updated_at: profile?.updated_at || user.updated_at || null
  };
}

function getAdminClient(_supabaseClient, adminClient) {
  if (adminClient && adminClient.auth && adminClient.auth.admin) {
    return adminClient;
  }

  return null;
}

function getAccountStatus(user) {
  return ACCOUNT_STATUSES.has(user?.app_metadata?.account_status)
    ? user.app_metadata.account_status
    : 'active';
}

function isValidUserId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_ID_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function getUserName(user) {
  const value = typeof user?.user_metadata?.full_name === 'string'
    ? user.user_metadata.full_name
    : typeof user?.user_metadata?.name === 'string'
      ? user.user_metadata.name
      : user?.email?.split('@')[0] || 'User';
  return value.trim().slice(0, 160) || 'User';
}

function validDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseAuditQuery(query) {
  const allowed = new Set(['range', 'from', 'to', 'actor', 'action', 'entity_type', 'status', 'q', 'page', 'limit']);
  if (Object.keys(query).some((key) => !allowed.has(key))) throw new BadRequestError('Invalid audit filters.');
  const range = query.range === undefined ? '30d' : query.range;
  if (!['today', '7d', '30d', '90d', 'all', 'custom'].includes(range) || typeof range !== 'string') {
    throw new BadRequestError('Invalid audit date range.');
  }
  const today = new Date().toISOString().slice(0, 10);
  let fromDate = null;
  let toDate = null;
  if (range === 'custom') {
    fromDate = query.from;
    toDate = query.to;
    if (!validDateOnly(fromDate) || !validDateOnly(toDate) || fromDate > toDate) {
      throw new BadRequestError('Choose a valid custom date range.');
    }
  } else if (range !== 'all') {
    const days = range === 'today' ? 0 : Number.parseInt(range, 10) - 1;
    const start = new Date(`${today}T00:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() - days);
    fromDate = start.toISOString().slice(0, 10);
    toDate = today;
  }

  const actor = query.actor === undefined || query.actor === '' ? null : query.actor;
  if (actor !== null && (typeof actor !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actor))) {
    throw new BadRequestError('Invalid administrator filter.');
  }
  const action = readOptionalText(query, 'action');
  if (action && !AUDIT_ACTIONS.has(action)) throw new BadRequestError('Invalid action filter.');
  const entityType = readOptionalText(query, 'entity_type');
  if (entityType && !AUDIT_ENTITY_TYPES.has(entityType)) throw new BadRequestError('Invalid resource filter.');
  const status = readOptionalText(query, 'status');
  if (status && !['success', 'failure'].includes(status)) throw new BadRequestError('Invalid result filter.');
  const search = readOptionalText(query, 'q');
  if (search && search.length > 160) throw new BadRequestError('Audit search is too long.');

  return {
    range,
    from: fromDate ? `${fromDate}T00:00:00.000Z` : null,
    to: toDate ? new Date(new Date(`${toDate}T00:00:00.000Z`).getTime() + 86400000).toISOString() : null,
    actor,
    action: action || null,
    entityType: entityType || null,
    status: status || null,
    search: search || null,
    page: readPositiveInteger(query, 'page', 1, 2147483647),
    limit: readPositiveInteger(query, 'limit', 25, 100)
  };
}

function auditSafeValues(values = {}) {
  const safe = {};
  for (const [field, value] of Object.entries(values)) {
    if (!AUDIT_FIELDS.has(field)) continue;
    if (typeof value === 'string') safe[field] = value.slice(0, 500);
    else if (typeof value === 'boolean' || value === null || typeof value === 'number') safe[field] = value;
  }
  return safe;
}

function getChangedAuditValues(before = {}, after = {}) {
  const oldValues = {};
  const newValues = {};
  for (const field of AUDIT_FIELDS) {
    if (before[field] !== after[field]) {
      oldValues[field] = before[field] ?? null;
      newValues[field] = after[field] ?? null;
    }
  }
  return { oldValues: auditSafeValues(oldValues), newValues: auditSafeValues(newValues) };
}

async function writeAuditEvent(admin, req, event, logger) {
  const actor = req.authUser;
  const actorName = actor.user_metadata?.full_name || actor.user_metadata?.name || actor.email || 'Administrator';
  const record = {
    actor_user_id: actor.id,
    actor_name: String(actorName).slice(0, 160),
    actor_email: String(actor.email || '').slice(0, 254),
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId === undefined ? null : String(event.entityId).slice(0, 200),
    entity_label: String(event.entityLabel || 'Record').slice(0, 200),
    description: String(event.description).slice(0, 1000),
    old_values: auditSafeValues(event.oldValues),
    new_values: auditSafeValues(event.newValues),
    status: event.status === 'failure' ? 'failure' : 'success',
    metadata: {}
  };

  try {
    const { error } = await admin.from('audit_logs').insert(record);
    if (error) throw error;
  } catch (error) {
    logger.error?.({
      event: 'admin.audit_log_write_failed',
      action: record.action,
      entityType: record.entity_type,
      entityId: record.entity_id,
      code: error.code || 'AUDIT_WRITE_FAILED'
    });
    const auditError = new Error('Unable to persist the administrative audit record.');
    auditError.code = 'AUDIT_LOG_WRITE_FAILED';
    throw auditError;
  }
}

function executeOpportunityMutation(admin, req, operation, id, payload) {
  const actor = req.authUser;
  return admin.rpc('admin_manage_opportunity', {
    p_operation: operation,
    p_id: id || null,
    p_payload: payload || null,
    p_actor_user_id: actor.id,
    p_actor_name: actor.user_metadata?.full_name || actor.user_metadata?.name || actor.email || 'Administrator',
    p_actor_email: actor.email || ''
  });
}

async function listAllAuthUsers(admin) {
  const users = [];
  const seenIds = new Set();

  for (let page = 1; page <= MAX_AUTH_USER_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: AUTH_USERS_PER_PAGE
    });

    if (error || !Array.isArray(data?.users)) {
      throw new Error('Unable to retrieve users from Supabase Auth.');
    }

    let added = 0;
    for (const user of data.users) {
      if (user?.id && !seenIds.has(user.id)) {
        users.push(user);
        seenIds.add(user.id);
        added += 1;
      }
    }

    if (data.users.length < AUTH_USERS_PER_PAGE) {
      return users;
    }
    if (added === 0) {
      throw new Error('Supabase Auth returned a repeated user page.');
    }
  }

  throw new Error('Supabase Auth returned too many user pages.');
}

async function listAllUserProfiles(admin) {
  const profiles = new Map();
  const pageSize = 1000;

  for (let offset = 0; offset < MAX_AUTH_USER_PAGES * pageSize; offset += pageSize) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, full_name, account_status, updated_at')
      .range(offset, offset + pageSize - 1);

    if (error || !Array.isArray(data)) {
      throw new Error('Unable to retrieve user profiles.');
    }

    for (const profile of data) {
      profiles.set(profile.id, profile);
    }

    if (data.length < pageSize) {
      return profiles;
    }
  }

  throw new Error('The profile table contains too many pages to retrieve safely.');
}

function getActiveAdminCount(users, profiles) {
  return users.filter((user) => {
    const role = normalizeRole(user.app_metadata?.role || user.role);
    const status = normalizeAdminUser(user, profiles.get(user.id)).status;
    return (role === 'admin' || role === 'super_admin') && status === 'active';
  }).length;
}

function getPublicUserList(users, profiles) {
  return users.map((user) => normalizeAdminUser(user, profiles.get(user.id)));
}

function validateUserFields(body, { creating = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'A valid user object is required.';
  }
  if (Object.keys(body).some((key) => !['full_name', 'email', 'role', 'status'].includes(key))) {
    return 'Only full name, email, role, and status may be changed.';
  }
  if (creating || body.full_name !== undefined) {
    if (typeof body.full_name !== 'string' || !body.full_name.trim() || body.full_name.trim().length > 160) {
      return 'Full name must be between 1 and 160 characters.';
    }
  }
  if (creating || body.email !== undefined) {
    if (typeof body.email !== 'string' || body.email.trim().length > 254 || !USER_EMAIL_PATTERN.test(body.email.trim())) {
      return 'A valid email address is required.';
    }
  }
  if (body.role !== undefined && (typeof body.role !== 'string' || !USER_ROLES.has(body.role.trim().toLowerCase()))) {
    return 'Role must be one of: candidate, admin, super_admin.';
  }
  if (body.status !== undefined && (typeof body.status !== 'string' || !ACCOUNT_STATUSES.has(body.status.trim().toLowerCase()))) {
    return 'Status must be one of: active, awaiting, inactive.';
  }

  return null;
}

function isDuplicateEmailError(error) {
  const message = String(error?.message || '').toLowerCase();
  return ['already registered', 'already exists', 'already been registered', 'user already', 'email_exists']
    .some((phrase) => message.includes(phrase))
    || ['email_exists', 'user_already_exists'].includes(String(error?.code || '').toLowerCase());
}

async function removeInvitedUser(admin, userId, logger) {
  try {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      logger.error?.({ event: 'admin.users.invitation_rollback_failed', userId });
    }
  } catch {
    logger.error?.({ event: 'admin.users.invitation_rollback_failed', userId });
  }
}

async function restoreManagedProfile(admin, userId, profile, current, updatedAt, logger) {
  try {
    const { error } = await admin.from('profiles').upsert({
      id: userId,
      full_name: profile?.full_name || current.full_name,
      account_status: current.status,
      updated_at: profile?.updated_at || updatedAt
    }, { onConflict: 'id' });
    if (error) {
      logger.error?.({ event: 'admin.users.profile_rollback_failed', userId });
    }
  } catch {
    logger.error?.({ event: 'admin.users.profile_rollback_failed', userId });
  }
}

async function restoreManagedAuth(admin, user, userId, logger) {
  try {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      email: user.email,
      email_confirm: Boolean(user.email_confirmed_at),
      app_metadata: user.app_metadata || {},
      user_metadata: user.user_metadata || {}
    });
    if (error) {
      logger.error?.({ event: 'admin.users.update_rollback_failed', userId });
    }
  } catch {
    logger.error?.({ event: 'admin.users.update_rollback_failed', userId });
  }
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
    const accountStatusUnavailable = {
      error: {
        code: 'ACCOUNT_STATUS_UNAVAILABLE',
        message: 'Administrator account status is unavailable. Apply the latest Supabase migrations and verify that the admin profile exists.'
      }
    };
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
    const admin = getAdminClient(supabaseClient, adminClient);
    if (!admin || typeof admin.from !== 'function') {
      return res.status(503).json({
        error: {
          code: 'ACCOUNT_STATUS_UNAVAILABLE',
          message: 'Administrator access requires the server-side account-status service.'
        }
      });
    }

    let profile;
    let error;
    try {
      ({ data: profile, error } = await admin.from('profiles')
        .select('account_status')
        .eq('id', auth.user.id)
        .maybeSingle());
    } catch (lookupError) {
      logger.error?.({ event: 'admin.account_status_lookup_failed', userId: auth.user.id, message: lookupError.message });
      return res.status(503).json(accountStatusUnavailable);
    }
    if (error || !profile || !ACCOUNT_STATUSES.has(profile.account_status)) {
      logger.error?.({
        event: 'admin.account_status_lookup_failed',
        userId: auth.user.id,
        code: error?.code || (!profile ? 'PROFILE_NOT_FOUND' : 'INVALID_ACCOUNT_STATUS'),
        message: error?.message || null
      });
      return res.status(503).json(accountStatusUnavailable);
    }
    if (profile.account_status !== 'active') {
      return res.status(403).json({
        error: { code: 'ACCOUNT_INACTIVE', message: 'This account is not active.' }
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

  app.get('/api/admin/audit-logs/actors', requireAdmin, async (req, res) => {
    const admin = getAdminClient(supabaseClient, adminClient);
    if (!admin || typeof admin.rpc !== 'function') {
      return res.status(503).json({
        error: { code: 'AUDIT_LOG_UNAVAILABLE', message: 'Persistent audit history is not configured.' }
      });
    }

    const { data, error } = await admin.rpc('admin_audit_actors');
    if (error || !Array.isArray(data)) {
      logger.error?.({ event: 'admin.audit_actors_query_failed', code: error?.code || 'AUDIT_QUERY_FAILED' });
      return res.status(503).json({
        error: { code: 'AUDIT_LOG_UNAVAILABLE', message: 'Unable to load audit administrators.' }
      });
    }
    return res.json({ actors: data });
  });

  app.get('/api/admin/audit-logs', requireAdmin, async (req, res) => {
    let filters;
    try {
      filters = parseAuditQuery(req.query);
    } catch (error) {
      if (error instanceof BadRequestError) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: error.message }
        });
      }
      throw error;
    }
    const admin = getAdminClient(supabaseClient, adminClient);
    if (!admin || typeof admin.rpc !== 'function') {
      return res.status(503).json({
        error: { code: 'AUDIT_LOG_UNAVAILABLE', message: 'Persistent audit history is not configured.' }
      });
    }

    const { data, error } = await admin.rpc('admin_search_audit_logs', {
      p_from: filters.from,
      p_to: filters.to,
      p_actor: filters.actor,
      p_action: filters.action,
      p_entity_type: filters.entityType,
      p_status: filters.status,
      p_search: filters.search,
      p_page: filters.page,
      p_limit: filters.limit
    });
    if (error || !Array.isArray(data)) {
      logger.error?.({ event: 'admin.audit_logs_query_failed', code: error?.code || 'AUDIT_QUERY_FAILED' });
      return res.status(503).json({
        error: { code: 'AUDIT_LOG_UNAVAILABLE', message: 'Unable to load audit history. Apply the audit-log migration and check server configuration.' }
      });
    }

    const total = Number(data[0]?.total_count || 0);
    return res.json({
      items: data.map(({ total_count: _totalCount, ...item }) => item),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit)
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
      const users = await listAllAuthUsers(admin);
      totalUsers = users.length;
      activeCandidateAccounts = users.filter((user) => (
        normalizeRole(user.app_metadata?.role || user.role || 'candidate') === 'candidate'
        && getAccountStatus(user) === 'active'
      )).length;
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
    if (!admin || typeof admin.auth.admin.listUsers !== 'function' || typeof admin.from !== 'function') {
      return res.status(503).json({
        error: { code: 'ADMIN_USERS_UNAVAILABLE', message: 'User management requires the server-side Supabase service-role configuration.' }
      });
    }

    try {
      const [authUsers, profiles] = await Promise.all([
        listAllAuthUsers(admin),
        listAllUserProfiles(admin)
      ]);
      const users = getPublicUserList(authUsers, profiles);
      return res.json({
        users,
        counts: {
          total: users.length,
          active: users.filter((user) => user.status === 'active').length,
          awaiting: users.filter((user) => user.status === 'awaiting').length,
          inactive: users.filter((user) => user.status === 'inactive').length
        }
      });
    } catch (error) {
      logger.error?.({ event: 'admin.users.list_failed', message: error.message });
      return res.status(500).json({
        error: { code: 'ADMIN_USERS_QUERY_FAILED', message: 'Unable to load users. Check the server-side Supabase configuration and migrations.' }
      });
    }
  });

  app.post('/api/admin/users', requireAdmin, async (req, res) => {
    const validationError = validateUserFields(req.body, { creating: true });
    if (validationError) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: validationError } });
    }

    const admin = getAdminClient(supabaseClient, adminClient);
    if (!admin || typeof admin.auth.admin.inviteUserByEmail !== 'function'
      || typeof admin.auth.admin.updateUserById !== 'function'
      || typeof admin.auth.admin.deleteUser !== 'function'
      || typeof admin.from !== 'function') {
      return res.status(503).json({
        error: { code: 'ADMIN_USERS_UNAVAILABLE', message: 'Secure user invitations require the server-side Supabase service-role configuration.' }
      });
    }

    const role = req.body.role === undefined ? 'candidate' : req.body.role.trim().toLowerCase();
    const status = req.body.status === undefined ? 'awaiting' : req.body.status.trim().toLowerCase();
    if (role === 'super_admin' && req.authRole !== 'super_admin') {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Only a super admin may create another super admin.' }
      });
    }

    const email = req.body.email.trim().toLowerCase();
    const fullName = req.body.full_name.trim();
    let invitation;
    try {
      invitation = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName }
      });
    } catch (error) {
      logger.error?.({ event: 'admin.users.invitation_failed', message: error.message });
      await writeAuditEvent(admin, req, {
        action: 'user.created',
        entityType: 'user',
        entityLabel: fullName,
        description: `Failed to invite ${fullName} (${email}).`,
        newValues: { full_name: fullName, email, role, status },
        status: 'failure'
      }, logger);
      return res.status(502).json({
        error: { code: 'USER_INVITATION_FAILED', message: 'Unable to send the account invitation.' }
      });
    }

    if (invitation.error || !invitation.data?.user?.id) {
      const duplicate = isDuplicateEmailError(invitation.error);
      await writeAuditEvent(admin, req, {
        action: 'user.created',
        entityType: 'user',
        entityLabel: fullName,
        description: `Failed to invite ${fullName} (${email}).`,
        newValues: { full_name: fullName, email, role, status },
        status: 'failure'
      }, logger);
      return res.status(duplicate ? 409 : 400).json({
        error: {
          code: duplicate ? 'EMAIL_ALREADY_REGISTERED' : 'USER_INVITATION_FAILED',
          message: duplicate ? 'An account with this email already exists.' : 'Unable to send the account invitation.'
        }
      });
    }

    const invitedUser = invitation.data.user;
    let updatedUser;
    try {
      updatedUser = await admin.auth.admin.updateUserById(invitedUser.id, {
        app_metadata: {
          ...(invitedUser.app_metadata || {}),
          role,
          account_status: status
        }
      });
    } catch (error) {
      logger.error?.({ event: 'admin.users.invitation_update_failed', userId: invitedUser.id, message: error.message });
      await removeInvitedUser(admin, invitedUser.id, logger);
      await writeAuditEvent(admin, req, {
        action: 'user.created',
        entityType: 'user',
        entityId: invitedUser.id,
        entityLabel: fullName,
        description: `Failed to complete the invitation for ${fullName}.`,
        newValues: { full_name: fullName, email, role, status },
        status: 'failure'
      }, logger);
      return res.status(502).json({
        error: { code: 'USER_INVITATION_FAILED', message: 'Unable to finish setting up the invited account.' }
      });
    }

    if (updatedUser.error || !updatedUser.data?.user) {
      await removeInvitedUser(admin, invitedUser.id, logger);
      await writeAuditEvent(admin, req, {
        action: 'user.created',
        entityType: 'user',
        entityId: invitedUser.id,
        entityLabel: fullName,
        description: `Failed to complete the invitation for ${fullName}.`,
        newValues: { full_name: fullName, email, role, status },
        status: 'failure'
      }, logger);
      return res.status(500).json({
        error: { code: 'USER_INVITATION_FAILED', message: 'Unable to finish setting up the invited account.' }
      });
    }

    let profileResult;
    try {
      profileResult = await admin.from('profiles')
        .upsert({
          id: invitedUser.id,
          full_name: fullName,
          account_status: status,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' })
        .select('id, full_name, account_status, updated_at')
        .single();
    } catch (error) {
      logger.error?.({ event: 'admin.users.profile_invitation_failed', userId: invitedUser.id, message: error.message });
      await removeInvitedUser(admin, invitedUser.id, logger);
      await writeAuditEvent(admin, req, {
        action: 'user.created',
        entityType: 'user',
        entityId: invitedUser.id,
        entityLabel: fullName,
        description: `Failed to save the profile for invited user ${fullName}.`,
        newValues: { full_name: fullName, email, role, status },
        status: 'failure'
      }, logger);
      return res.status(500).json({
        error: { code: 'USER_PROFILE_UPDATE_FAILED', message: 'The account could not be saved to the profile database.' }
      });
    }

    if (profileResult.error || !profileResult.data) {
      await removeInvitedUser(admin, invitedUser.id, logger);
      await writeAuditEvent(admin, req, {
        action: 'user.created',
        entityType: 'user',
        entityId: invitedUser.id,
        entityLabel: fullName,
        description: `Failed to save the profile for invited user ${fullName}.`,
        newValues: { full_name: fullName, email, role, status },
        status: 'failure'
      }, logger);
      return res.status(500).json({
        error: { code: 'USER_PROFILE_UPDATE_FAILED', message: 'The account could not be saved to the profile database.' }
      });
    }

    logger.info?.({
      event: 'admin.users.invited',
      actorId: req.authUser.id,
      userId: invitedUser.id,
      role,
      status
    });
    await writeAuditEvent(admin, req, {
      action: 'user.created',
      entityType: 'user',
      entityId: invitedUser.id,
      entityLabel: fullName,
      description: `Invited ${fullName} (${email}) as ${role}; account status ${status}.`,
      newValues: { full_name: fullName, email, role, status }
    }, logger);
    return res.status(201).json({ user: normalizeAdminUser(updatedUser.data.user, profileResult.data) });
  });

  async function updateManagedUser(req, res, userId, payload) {
    if (!isValidUserId(userId)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'A valid user ID is required.' } });
    }

    const validationError = validateUserFields(payload);
    if (validationError) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: validationError } });
    }

    const admin = getAdminClient(supabaseClient, adminClient);
    if (!admin || typeof admin.auth.admin.updateUserById !== 'function'
      || typeof admin.auth.admin.listUsers !== 'function'
      || typeof admin.from !== 'function') {
      return res.status(503).json({
        error: { code: 'ADMIN_USERS_UNAVAILABLE', message: 'User management requires the server-side Supabase service-role configuration.' }
      });
    }

    let users;
    let profiles;
    try {
      [users, profiles] = await Promise.all([
        listAllAuthUsers(admin),
        listAllUserProfiles(admin)
      ]);
    } catch (error) {
      logger.error?.({ event: 'admin.users.lookup_failed', message: error.message });
      return res.status(500).json({
        error: { code: 'ADMIN_USERS_QUERY_FAILED', message: 'Unable to verify the target account.' }
      });
    }

    const user = users.find((entry) => entry.id === userId);
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
    }

    const profile = profiles.get(userId) || {
      id: userId,
      full_name: getUserName(user),
      account_status: getAccountStatus(user),
      updated_at: user.updated_at || null
    };
    const current = normalizeAdminUser(user, profile);
    const nextRole = payload.role === undefined ? current.role : payload.role.trim().toLowerCase();
    const nextStatus = payload.status === undefined ? current.status : payload.status.trim().toLowerCase();
    const nextName = payload.full_name === undefined ? current.full_name : payload.full_name.trim();
    const nextEmail = payload.email === undefined ? user.email : payload.email.trim().toLowerCase();
    const auditUserUpdate = async (resultStatus) => {
      const diff = getChangedAuditValues(
        { full_name: current.full_name, email: current.email, role: current.role, status: current.status },
        { full_name: nextName, email: nextEmail, role: nextRole, status: nextStatus }
      );
      if (!Object.keys(diff.newValues).length) return;
      const groups = new Map();
      for (const field of Object.keys(diff.newValues)) {
        const action = field === 'role'
          ? 'user.role_changed'
          : field === 'status'
            ? 'user.status_changed'
            : 'user.updated';
        if (!groups.has(action)) groups.set(action, []);
        groups.get(action).push(field);
      }
      for (const [action, fields] of groups) {
        const oldValues = Object.fromEntries(fields.map((field) => [field, diff.oldValues[field]]));
        const newValues = Object.fromEntries(fields.map((field) => [field, diff.newValues[field]]));
        await writeAuditEvent(admin, req, {
          action,
          entityType: 'user',
          entityId: userId,
          entityLabel: nextName,
          description: `${resultStatus === 'success' ? 'Updated' : 'Failed to update'} ${nextName}: ${fields.join(', ')} ${resultStatus === 'success' ? 'changed' : 'could not be changed'}.`,
          oldValues,
          newValues,
          status: resultStatus
        }, logger);
      }
    };

    if (userId === req.authUser.id && (nextRole !== current.role || nextStatus !== 'active')) {
      return res.status(400).json({
        error: { code: 'SELF_MANAGEMENT_BLOCKED', message: 'You cannot change your own role or disable your own account.' }
      });
    }
    if (req.authRole !== 'super_admin' && nextRole === 'super_admin' && current.role !== 'super_admin') {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Only a super admin may grant the super admin role.' }
      });
    }

    const nextActiveAdminCount = getActiveAdminCount(users, profiles)
      - ((current.role === 'admin' || current.role === 'super_admin') && current.status === 'active' ? 1 : 0)
      + ((nextRole === 'admin' || nextRole === 'super_admin') && nextStatus === 'active' ? 1 : 0);
    if (nextActiveAdminCount < 1) {
      return res.status(400).json({
        error: { code: 'LAST_ACTIVE_ADMIN', message: 'At least one active administrator must remain.' }
      });
    }

    const authChanges = {};
    if (nextRole !== current.role || nextStatus !== current.status) {
      authChanges.app_metadata = {
        ...(user.app_metadata || {}),
        role: nextRole,
        account_status: nextStatus
      };
    }
    if (nextName !== current.full_name) {
      authChanges.user_metadata = {
        ...(user.user_metadata || {}),
        full_name: nextName
      };
    }
    if (nextEmail !== user.email) {
      authChanges.email = nextEmail;
      authChanges.email_confirm = false;
    }

    let updatedUser = user;
    let profileResult = null;
    const updatedAt = new Date().toISOString();
    const profilePayload = {
      id: userId,
      full_name: nextName,
      account_status: nextStatus,
      updated_at: updatedAt
    };

    if (nextStatus !== 'active' && nextStatus !== current.status) {
      try {
        profileResult = await admin.from('profiles')
          .upsert(profilePayload, { onConflict: 'id' })
          .select('id, full_name, account_status, updated_at')
          .single();
      } catch (error) {
        logger.error?.({ event: 'admin.users.profile_update_failed', userId, message: error.message });
        await auditUserUpdate('failure');
        return res.status(500).json({
          error: { code: 'USER_PROFILE_UPDATE_FAILED', message: 'The account status could not be updated.' }
        });
      }

      if (profileResult.error || !profileResult.data) {
        await auditUserUpdate('failure');
        return res.status(500).json({
          error: { code: 'USER_PROFILE_UPDATE_FAILED', message: 'The account status could not be updated.' }
        });
      }
    }

    if (Object.keys(authChanges).length) {
      let authResult;
      try {
        authResult = await admin.auth.admin.updateUserById(userId, authChanges);
      } catch (error) {
        if (profileResult?.data) {
          await restoreManagedProfile(admin, userId, profile, current, updatedAt, logger);
        }
        logger.error?.({ event: 'admin.users.auth_update_failed', userId, message: error.message });
        await auditUserUpdate('failure');
        return res.status(502).json({
          error: { code: 'USER_UPDATE_FAILED', message: 'Unable to update the authentication account.' }
        });
      }
      if (authResult.error || !authResult.data?.user) {
        if (profileResult?.data) {
          await restoreManagedProfile(admin, userId, profile, current, updatedAt, logger);
        }
        const duplicate = isDuplicateEmailError(authResult.error);
        await auditUserUpdate('failure');
        return res.status(duplicate ? 409 : 400).json({
          error: {
            code: duplicate ? 'EMAIL_ALREADY_REGISTERED' : 'USER_UPDATE_FAILED',
            message: duplicate ? 'An account with this email already exists.' : 'Unable to update the authentication account.'
          }
        });
      }
      updatedUser = authResult.data.user;
    }

    if (!profileResult) {
      try {
        profileResult = await admin.from('profiles')
          .upsert(profilePayload, { onConflict: 'id' })
          .select('id, full_name, account_status, updated_at')
          .single();
      } catch (error) {
        logger.error?.({ event: 'admin.users.profile_update_failed', userId, message: error.message });
        profileResult = { error };
      }
    }

    if (profileResult.error || !profileResult.data) {
      if (Object.keys(authChanges).length) {
        await restoreManagedAuth(admin, user, userId, logger);
      }
      await restoreManagedProfile(admin, userId, profile, current, updatedAt, logger);
      await auditUserUpdate('failure');
      return res.status(500).json({
        error: { code: 'USER_PROFILE_UPDATE_FAILED', message: 'The user profile could not be updated.' }
      });
    }

    await auditUserUpdate('success');

    logger.info?.({
      event: 'admin.users.updated',
      actorId: req.authUser.id,
      userId,
      changedFields: Object.keys(payload)
    });
    return res.json({ user: normalizeAdminUser(updatedUser, profileResult.data) });
  }

  app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => (
    updateManagedUser(req, res, String(req.params.id || '').trim(), req.body)
  ));

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
    if (!fullName || fullName.length > 160) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Full name must be between 1 and 160 characters.' }
      });
    }

    return updateManagedUser(req, res, req.authUser.id, { full_name: fullName });
  });

  app.patch('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
    if (typeof req.body?.role !== 'string') {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Role must be one of: candidate, admin, super_admin.' }
      });
    }

    return updateManagedUser(req, res, String(req.params.id || '').trim(), { role: req.body.role });
  });

  app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
    const userId = String(req.params.id || '').trim();
    if (!isValidUserId(userId)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'A valid user ID is required.' } });
    }

    if (userId === req.authUser.id) {
      return res.status(400).json({
        error: { code: 'SELF_DELETE_BLOCKED', message: 'You cannot delete your own account.' }
      });
    }

    const admin = getAdminClient(supabaseClient, adminClient);
    if (!admin || typeof admin.auth.admin.deleteUser !== 'function'
      || typeof admin.auth.admin.listUsers !== 'function'
      || typeof admin.from !== 'function') {
      return res.status(503).json({
        error: { code: 'ADMIN_USERS_UNAVAILABLE', message: 'User deletion requires the server-side Supabase service-role configuration.' }
      });
    }

    let users;
    let profiles;
    try {
      [users, profiles] = await Promise.all([
        listAllAuthUsers(admin),
        listAllUserProfiles(admin)
      ]);
    } catch (error) {
      logger.error?.({ event: 'admin.users.delete_lookup_failed', message: error.message });
      return res.status(500).json({
        error: { code: 'ADMIN_USERS_QUERY_FAILED', message: 'Unable to verify the target account.' }
      });
    }

    const user = users.find((entry) => entry.id === userId);
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
    }
    const profile = profiles.get(userId);
    const target = normalizeAdminUser(user, profile);
    if ((target.role === 'admin' || target.role === 'super_admin')
      && target.status === 'active'
      && getActiveAdminCount(users, profiles) <= 1) {
      return res.status(400).json({
        error: { code: 'LAST_ACTIVE_ADMIN', message: 'At least one active administrator must remain.' }
      });
    }

    let deleteResult;
    try {
      deleteResult = await admin.auth.admin.deleteUser(userId);
    } catch (error) {
      logger.error?.({ event: 'admin.users.delete_failed', userId, message: error.message });
      await writeAuditEvent(admin, req, {
        action: 'user.deleted',
        entityType: 'user',
        entityId: userId,
        entityLabel: target.full_name,
        description: `Failed to delete user ${target.full_name} (${target.email}).`,
        oldValues: {
          full_name: target.full_name,
          email: target.email,
          role: target.role,
          status: target.status
        },
        status: 'failure'
      }, logger);
      return res.status(502).json({
        error: { code: 'USER_DELETE_FAILED', message: 'Unable to delete the authentication account.' }
      });
    }
    const { error } = deleteResult;
    if (error) {
      logger.error?.({ event: 'admin.users.delete_failed', userId, code: error.code || 'UNKNOWN' });
      await writeAuditEvent(admin, req, {
        action: 'user.deleted',
        entityType: 'user',
        entityId: userId,
        entityLabel: target.full_name,
        description: `Failed to delete user ${target.full_name} (${target.email}).`,
        oldValues: {
          full_name: target.full_name,
          email: target.email,
          role: target.role,
          status: target.status
        },
        status: 'failure'
      }, logger);
      return res.status(500).json({
        error: { code: 'USER_DELETE_FAILED', message: 'Unable to delete the authentication account.' }
      });
    }

    await writeAuditEvent(admin, req, {
      action: 'user.deleted',
      entityType: 'user',
      entityId: userId,
      entityLabel: target.full_name,
      description: `Deleted user ${target.full_name} (${target.email}).`,
      oldValues: {
        full_name: target.full_name,
        email: target.email,
        role: target.role,
        status: target.status
      }
    }, logger);

    logger.info?.({
      event: 'admin.users.deleted',
      actorId: req.authUser.id,
      userId
    });
    return res.json({ deleted: { id: userId } });
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
    if (!admin || typeof admin.rpc !== 'function') {
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

    const { data: mutation, error } = await executeOpportunityMutation(admin, req, 'create', payload.id, payload);
    const data = mutation?.record;

    if (error || !data) {
      if (error?.code !== 'PGRST202') {
        await writeAuditEvent(admin, req, {
          action: 'opportunity.created',
          entityType: 'opportunity',
          entityId: payload.id,
          entityLabel: payload.title,
          description: `Failed to create opportunity "${payload.title}".`,
          newValues: {
            title: payload.title,
            organisation: payload.organisation,
            category: payload.category,
            location: payload.location,
            closing_date: payload.closing_date,
            experience_level: payload.experience_level,
            description: payload.description,
            application_instructions: payload.application_instructions,
            source_name: payload.source_name,
            verification_level: payload.verification_level,
            opportunity_status: payload.status,
            verification_status: payload.verification_status,
            is_verified: payload.is_verified
          },
          status: 'failure'
        }, logger);
      }
      const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
      if (error?.code === '42P01' || error?.code === 'PGRST202' || message.includes('does not exist')) {
        return res.status(503).json({
          error: { code: 'OPPORTUNITY_TABLE_MISSING', message: 'The Supabase opportunity or audit schema is not configured. Apply the latest database migrations before creating opportunities.' }
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
    if (!admin || typeof admin.rpc !== 'function' || typeof admin.from !== 'function') {
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

    const { data: mutation, error } = await executeOpportunityMutation(admin, req, 'update', id, payload);
    const data = mutation?.record;

    if (error || !data) {
      if (error?.code !== 'PGRST202') {
        await writeAuditEvent(admin, req, {
          action: 'opportunity.updated',
          entityType: 'opportunity',
          entityId: id,
          entityLabel: payload.title,
          description: `Failed to update opportunity "${payload.title}".`,
          newValues: {
            title: payload.title,
            organisation: payload.organisation,
            category: payload.category,
            location: payload.location,
            closing_date: payload.closing_date,
            experience_level: payload.experience_level,
            description: payload.description,
            application_instructions: payload.application_instructions,
            source_name: payload.source_name,
            verification_level: payload.verification_level,
            opportunity_status: payload.status,
            verification_status: payload.verification_status,
            is_verified: payload.is_verified
          },
          status: 'failure'
        }, logger);
      }
      if (!error && mutation?.found === false) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Opportunity not found.' }
        });
      }
      const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
      if (error?.code === '42P01' || error?.code === 'PGRST202' || message.includes('does not exist')) {
        return res.status(503).json({
          error: { code: 'OPPORTUNITY_TABLE_MISSING', message: 'The Supabase opportunity or audit schema is not configured. Apply the latest database migrations before updating opportunities.' }
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
    if (!admin || typeof admin.rpc !== 'function') {
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

    const { data: mutation, error } = await executeOpportunityMutation(admin, req, 'delete', id);
    const data = mutation?.record;
    if (error || !data) {
      if (error?.code !== 'PGRST202') {
        await writeAuditEvent(admin, req, {
          action: 'opportunity.deleted',
          entityType: 'opportunity',
          entityId: id,
          entityLabel: id,
          description: `Failed to delete opportunity "${id}".`,
          status: 'failure'
        }, logger);
      }
      if (!error && mutation?.found === false) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Opportunity not found.' }
        });
      }
      if (error?.code === '42P01' || error?.code === 'PGRST202' || error?.message?.toLowerCase().includes('does not exist')) {
        return res.status(503).json({
          error: { code: 'OPPORTUNITY_TABLE_MISSING', message: 'The Supabase opportunity or audit schema is not configured. Apply the latest database migrations before deleting opportunities.' }
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
