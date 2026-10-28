const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const api = require('../js/api.js');
const { createApp } = require('../server/app');
const { createOpportunityRepository } = require('../server/lib/opportunities');
const { readSupabaseConfig } = require('../server/lib/supabase');

const secretSentinel = 'do-not-disclose-this-secret';

function makeOpportunity(overrides = {}) {
  return {
    id: 'skillbridge-106',
    title: 'Junior developer',
    organisation: 'SkillBridge',
    category: 'Job',
    location: 'Johannesburg',
    closing_date: '2099-12-31',
    experience_level: 'Junior',
    description: 'Entry-level software opportunity',
    eligibility: [],
    required_documents: [],
    application_instructions: 'Apply through the official source.',
    official_application_url: 'https://example.com/apply',
    source_url: 'https://example.com',
    source_name: 'Example',
    last_verified_at: '2026-10-01T00:00:00Z',
    verification_status: 'verified',
    verification_level: 'official-source',
    status: 'active',
    is_verified: true,
    is_sample: false,
    imported_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides
  };
}

function createFixtureRepository(items) {
  const calls = { list: [], getById: [] };
  return {
    calls,
    repository: {
      async list(filters) {
        calls.list.push(filters);
        return items.filter((item) => {
          if (filters.category && item.category !== filters.category) return false;
          if (filters.location && !item.location.toLowerCase().includes(filters.location.toLowerCase())) return false;
          if (filters.q) {
            const searchable = [item.title, item.organisation, item.description, item.location]
              .join(' ')
              .toLowerCase();
            if (!searchable.includes(filters.q.toLowerCase())) return false;
          }
          return true;
        });
      },
      async getById(id) {
        calls.getById.push(id);
        return items.find((item) => item.id === id) || null;
      }
    }
  };
}

async function startApp(repository, logger = { error() {} }, authConfig = null) {
  const server = createApp({ opportunities: repository, logger, authConfig }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  return {
    server,
    async get(path, options) {
      return fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
    }
  };
}

describe('SkillBridge public API', () => {
  let running;
  let fixtures;
  const rows = [
    makeOpportunity(),
    makeOpportunity({
      id: 'skillbridge-107',
      title: 'Data analyst internship',
      category: 'Internship',
      location: 'Cape Town',
      closing_date: null,
      created_at: '2026-10-02T00:00:00Z'
    }),
    makeOpportunity({ id: 'expired', closing_date: '2000-01-01', status: 'pending' }),
    makeOpportunity({ id: 'unverified', is_verified: false }),
    makeOpportunity({ id: 'sample', is_sample: true }),
    makeOpportunity({ id: 'needs-review', verification_status: 'needs_review' }),
    makeOpportunity({ id: 'inactive', status: 'closed' })
  ];

  before(async () => {
    fixtures = createFixtureRepository(rows);
    running = await startApp(fixtures.repository);
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      running.server.close((error) => error ? reject(error) : resolve());
    });
  });

  it('serves the app shell at the root route', async () => {
    const response = await running.get('/');
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /<html/i);
  });

  it('returns a minimal root API response', async () => {
    const response = await running.get('/api');
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      ok: true,
      service: 'skillbridge-api',
      endpoints: ['/api/health', '/api/opportunities', '/api/opportunities/:id']
    });
  });

  it('uses dedicated page modes for reports and activity admin screens', async () => {
    const repoRoot = path.resolve(__dirname, '..');
    const reportsHtml = fs.readFileSync(path.join(repoRoot, 'admin', 'reports.html'), 'utf8');
    const activityHtml = fs.readFileSync(path.join(repoRoot, 'admin', 'activity.html'), 'utf8');

    assert.match(reportsHtml, /data-admin-page="reports"/i);
    assert.match(reportsHtml, /data-admin-reports/i);
    assert.match(activityHtml, /data-admin-page="activity"/i);
    assert.match(activityHtml, /data-admin-activity/i);
  });

  it('forces fresh admin HTML and exposes the admin landing route', async () => {
    const dashboard = await running.get('/admin/dashboard.html');
    assert.equal(dashboard.status, 200);
    assert.match((dashboard.headers.get('cache-control') || ''), /no-store/i);

    const landing = await running.get('/admin', { redirect: 'manual' });
    assert.equal(landing.status, 302);
    assert.equal(landing.headers.get('location'), '/admin/dashboard.html');
  });

  it('returns a minimal health response without environment data', async () => {
    const previous = process.env.API_TEST_SECRET;
    process.env.API_TEST_SECRET = secretSentinel;

    try {
      const response = await running.get('/api/health');
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(body, { ok: true, service: 'skillbridge-api' });
      assert.equal(JSON.stringify(body).includes(secretSentinel), false);
    } finally {
      if (previous === undefined) {
        delete process.env.API_TEST_SECRET;
      } else {
        process.env.API_TEST_SECRET = previous;
      }
    }
  });

  it('falls back to a demo opportunity list when the API fetch fails', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error('Failed to fetch');
    };

    try {
      const fallback = [{
        id: 'demo-1',
        title: 'Demo opportunity',
        organisation: 'SkillBridge Demo',
        category: 'Job',
        location: 'Johannesburg',
        closingDate: '2026-10-20',
        experienceLevel: 'Junior',
        description: 'Fallback example'
      }];

      const result = await api.listOpportunities({ limit: 10 }, {
        baseUrl: '/api',
        fallback
      });

      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].title, 'Demo opportunity');
      assert.deepEqual(result.pagination, {
        page: 1,
        limit: 1,
        total: 1,
        totalPages: 1
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('returns only the validated public Supabase Auth configuration', async () => {
    const publicConfig = {
      url: 'https://example.supabase.co',
      key: 'sb_publishable_public-test-value'
    };
    const authApp = await startApp(fixtures.repository, { error() {} }, publicConfig);

    try {
      const response = await authApp.get('/api/auth-config');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), {
        supabaseUrl: publicConfig.url,
        publishableKey: publicConfig.key
      });
    } finally {
      await new Promise((resolve, reject) => {
        authApp.server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it('returns the list shape, pagination totals, and a stable closing-date order', async () => {
    const response = await running.get('/api/opportunities?limit=1');
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.pagination, { page: 1, limit: 1, total: 3, totalPages: 3 });
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].id, 'expired');
    const finalPage = await running.get('/api/opportunities?page=3&limit=1');
    assert.equal((await finalPage.json()).items[0].id, 'skillbridge-107');
  });

  it('serves the real list route to a loopback-hosted frontend', async () => {
    const origin = 'http://localhost:5500';
    const response = await running.get('/api/opportunities?page=1&limit=20&sort=closing_date', {
      headers: { Origin: origin }
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.ok(Array.isArray(body.items));
    assert.deepEqual(body.pagination, { page: 1, limit: 20, total: 3, totalPages: 1 });
  });

  it('allows loopback admin requests to pass the authorization-header preflight', async () => {
    const origin = 'http://localhost:5500';
    const response = await running.get('/api/admin/me', {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization'
      }
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, PATCH, DELETE, OPTIONS');
    assert.match(response.headers.get('access-control-allow-headers'), /authorization/i);
  });

  it('allows loopback admin mutation requests to pass the mutation preflight', async () => {
    const origin = 'http://localhost:5500';
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const response = await running.get('/api/admin/opportunities', {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': method,
          'Access-Control-Request-Headers': 'authorization, content-type'
        }
      });

      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.match(response.headers.get('access-control-allow-methods'), new RegExp(method, 'i'));
    }
  });

  it('does not grant cross-origin access to non-loopback origins', async () => {
    const response = await running.get('/api/opportunities', {
      headers: { Origin: 'https://example.com' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });

  it('does not grant preflight access to non-loopback origins', async () => {
    const response = await running.get('/api/admin/me', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization'
      }
    });

    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('access-control-allow-headers'), null);
  });

  it('keeps eligible null closing dates and supports newest sorting', async () => {
    const response = await running.get('/api/opportunities?sort=newest');
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.items.map((item) => item.id), ['skillbridge-107', 'expired', 'skillbridge-106']);
    assert.equal(body.pagination.total, 3);
  });

  it('applies category, location, and keyword filters', async () => {
    const response = await running.get(
      '/api/opportunities?category=Internship&location=cape%20town&q=data%20analyst'
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.items.map((item) => item.id), ['skillbridge-107']);
    assert.equal(fixtures.calls.list.at(-1).category, 'Internship');
    assert.equal(fixtures.calls.list.at(-1).location, 'cape town');
    assert.equal(fixtures.calls.list.at(-1).q, 'data analyst');
  });

  it('normalizes search and filter strings before querying', async () => {
    const response = await running.get('/api/opportunities?q=%20Junior%20&category=%20Job%20');
    assert.equal(response.status, 200);
    assert.equal(fixtures.calls.list.at(-1).q, 'Junior');
    assert.equal(fixtures.calls.list.at(-1).category, 'Job');
  });

  for (const [parameter, value] of [
    ['page', '0'],
    ['page', '-1'],
    ['page', '1.5'],
    ['page', '1e3'],
    ['page', '9007199254740992'],
    ['limit', '0'],
    ['limit', '101'],
    ['limit', 'nope'],
    ['sort', 'random'],
    ['q', 'x'.repeat(101)],
    ['includeExpired', 'true']
  ]) {
    it(`rejects invalid ${parameter}=${value.length > 20 ? `${value.slice(0, 20)}...` : value}`, async () => {
      const response = await running.get(`/api/opportunities?${parameter}=${encodeURIComponent(value)}`);
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.deepEqual(body, {
        error: { code: 'BAD_REQUEST', message: 'Invalid query parameters.' }
      });
    });
  }

  it('rejects repeated query parameters instead of accepting ambiguous values', async () => {
    const response = await running.get('/api/opportunities?page=1&page=2');
    assert.equal(response.status, 400);
  });

  it('rejects page offsets that cannot be represented safely', async () => {
    const response = await running.get('/api/opportunities?page=90071992547410&limit=100');
    assert.equal(response.status, 400);
  });

  it('returns a public opportunity by its text ID without numeric coercion', async () => {
    const response = await running.get('/api/opportunities/skillbridge-106');
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.item.id, 'skillbridge-106');
    assert.deepEqual(fixtures.calls.getById.at(-1), 'skillbridge-106');
  });

  it('rejects blank and oversized opportunity IDs', async () => {
    const blank = await running.get('/api/opportunities/%20');
    const oversized = await running.get(`/api/opportunities/${'a'.repeat(201)}`);

    assert.equal(blank.status, 400);
    assert.equal(oversized.status, 400);
    assert.deepEqual(await blank.json(), {
      error: { code: 'BAD_REQUEST', message: 'Invalid opportunity ID.' }
    });
  });

  it('returns expired records and 404 for unknown and ineligible IDs', async () => {
    const unknown = await running.get('/api/opportunities/unknown-id');
    const unverified = await running.get('/api/opportunities/unverified');
    const expired = await running.get('/api/opportunities/expired');

    assert.equal(unknown.status, 404);
    assert.equal(unverified.status, 404);
    assert.equal(expired.status, 200);
    assert.equal((await expired.json()).item.id, 'expired');
    assert.deepEqual(await unknown.json(), {
      error: { code: 'NOT_FOUND', message: 'Opportunity not found.' }
    });
  });

  it('returns sanitized errors when the repository fails', async () => {
    const failingSupabase = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          or() { return this; },
          order() { return this; },
          range() {
            return Promise.resolve({
              data: null,
              error: { code: '42501', message: secretSentinel },
              count: null
            });
          }
        };
      },
    };
    const failing = createOpportunityRepository(failingSupabase);
    const events = [];
    const app = await startApp(failing, { error: (event) => events.push(event) });

    try {
      const response = await app.get('/api/opportunities');
      const bodyText = await response.text();

      assert.equal(response.status, 500);
      assert.equal(bodyText.includes(secretSentinel), false);
      assert.equal(events.length, 1);
      assert.equal(JSON.stringify(events[0]).includes(secretSentinel), false);
      assert.equal(events[0].code, '42501');
    } finally {
      await new Promise((resolve, reject) => {
        app.server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it('makes only read operations through its repository interface', async () => {
    const listCalls = fixtures.calls.list.length;
    const detailCalls = fixtures.calls.getById.length;

    await running.get('/api/health');
    await running.get('/api/opportunities');
    await running.get('/api/opportunities/skillbridge-106');

    assert.equal(fixtures.calls.list.length, listCalls + 1);
    assert.equal(fixtures.calls.getById.length, detailCalls + 1);
  });
});

describe('Supabase configuration', () => {
  it('accepts a publishable key from environment configuration', () => {
    const config = readSupabaseConfig({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_placeholder'
    });
    assert.equal(config.url, 'https://example.supabase.co');
  });

  it('accepts a legacy anon JWT and rejects a service-role JWT', () => {
    const jwt = (role) => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
    const base = { SUPABASE_URL: 'https://example.supabase.co' };

    assert.equal(readSupabaseConfig({ ...base, SUPABASE_ANON_KEY: jwt('anon') }).key.includes('.'), true);
    assert.throws(
      () => readSupabaseConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: jwt('service_role') }),
      /privileged keys are not supported/
    );
  });

  it('fails clearly when required configuration is missing', () => {
    assert.throws(() => readSupabaseConfig({}), /SUPABASE_URL is required/);
  });
});

describe('Supabase opportunity repository', () => {
  it('uses only read queries, fixed eligibility filters, and safe equality for IDs', async () => {
    const seen = [];
    let writeCalls = 0;
    const supabase = {
      from(table) {
        const query = {
          filters: [],
          select(columns, options) {
            this.columns = columns;
            this.options = options;
            return this;
          },
          eq(column, value) {
            this.filters.push(['eq', column, value]);
            return this;
          },
          or(expression) {
            this.filters.push(['or', expression]);
            return this;
          },
          order(column, options) {
            this.orderBy = [column, options];
            return this;
          },
          range(from, to) {
            seen.push({ table, columns: this.columns, filters: this.filters, from, to });
            return Promise.resolve({ data: [], error: null, count: 0 });
          },
          maybeSingle() {
            seen.push({ table, columns: this.columns, filters: this.filters });
            return Promise.resolve({ data: null, error: null });
          },
          insert() { writeCalls += 1; return this; },
          update() { writeCalls += 1; return this; },
          delete() { writeCalls += 1; return this; },
          upsert() { writeCalls += 1; return this; }
        };
        return query;
      }
    };
    const repository = createOpportunityRepository(supabase);

    await repository.list({ q: undefined, category: undefined, location: undefined });
    await repository.getById('skillbridge-106');

    assert.equal(seen.every((query) => query.table === 'opportunities'), true);
    assert.equal(writeCalls, 0);
    for (const query of seen) {
      assert.deepEqual(query.filters.slice(0, 3), [
        ['eq', 'is_verified', true],
        ['eq', 'is_sample', false],
        ['eq', 'verification_status', 'verified']
      ]);
      assert.match(query.filters.find(([kind]) => kind === 'or')[1], /^status\.eq\.active,closing_date\.lt\.\d{4}-\d{2}-\d{2}$/);
    }
    assert.deepEqual(seen[1].filters.at(-1), ['eq', 'id', 'skillbridge-106']);
  });

  it('does not interpolate search text into filter expressions', async () => {
    const ilikeFilters = [];
    const supabase = {
      from() {
        return {
          filters: [],
          select() { return this; },
          eq(column, value) { this.filters.push(['eq', column, value]); return this; },
          or(expression) { this.filters.push(['or', expression]); return this; },
          ilike(column, value) { ilikeFilters.push([column, value]); return this; },
          order() { return this; },
          range() { return Promise.resolve({ data: [], error: null, count: 0 }); }
        };
      }
    };
    const repository = createOpportunityRepository(supabase);
    await repository.list({
      q: 'x%,id.eq.secret',
      category: undefined,
      location: undefined
    });

    assert.deepEqual(ilikeFilters, [
      ['title', '%x\\%,id.eq.secret%'],
      ['organisation', '%x\\%,id.eq.secret%'],
      ['description', '%x\\%,id.eq.secret%'],
      ['location', '%x\\%,id.eq.secret%']
    ]);
  });
});

describe('Admin route protection', () => {
  function createAuthClient(role = 'admin', userMetadata = {}) {
    return {
      auth: {
        async getUser(token) {
          if (!token || token === 'invalid') {
            return { data: { user: null }, error: { message: 'Invalid token' } };
          }
          return {
            data: {
              user: {
                id: role === 'candidate' ? 'candidate-user' : 'admin-user',
                email: role === 'candidate' ? 'candidate@example.com' : 'admin@example.com',
                role,
                user_metadata: {
                  full_name: role === 'candidate' ? 'Candidate User' : 'Admin User',
                  ...userMetadata
                },
                app_metadata: { role }
              }
            },
            error: null
          };
        }
      },
      from(table) {
        if (table === 'profiles') {
          return {
            select() { return this; },
            eq() { return this; },
            maybeSingle() {
              return Promise.resolve({
                data: { id: role === 'candidate' ? 'candidate-user' : 'admin-user', role, status: 'active' },
                error: null
              });
            }
          };
        }
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() { return Promise.resolve({ data: { role, status: 'active' }, error: null }); },
          order() { return this; },
          range() { return Promise.resolve({ data: [], error: null, count: 0 }); }
        };
      }
    };
  }

  it('requires a valid bearer token for admin endpoints', async () => {
    const app = createApp({
      opportunities: createFixtureRepository([]).repository,
      authConfig: { url: 'https://example.supabase.co', key: 'sb_publishable_test' },
      supabaseClient: createAuthClient('admin')
    });

    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));

    try {
      const result = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/metrics`);
      assert.equal(result.status, 401);
      const body = await result.json();
      assert.equal(body.error.code, 'UNAUTHORIZED');
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('blocks candidate roles from admin metrics and allows admins through', async () => {
    const adminUsersClient = {
      auth: {
        admin: {
          async listUsers() {
            return {
              data: {
                users: [
                  { id: 'user-1', email: 'candidate@example.com', app_metadata: { role: 'candidate' }, user_metadata: { full_name: 'Candidate User' }, created_at: '2026-01-01T00:00:00Z' },
                  { id: 'user-2', email: 'admin@example.com', app_metadata: { role: 'admin' }, user_metadata: { full_name: 'Admin User' }, created_at: '2026-01-02T00:00:00Z' }
                ]
              },
              error: null
            };
          }
        }
      }
    };

    const appWithCandidate = createApp({
      opportunities: createFixtureRepository([]).repository,
      authConfig: { url: 'https://example.supabase.co', key: 'sb_publishable_test' },
      supabaseClient: createAuthClient('candidate')
    });
    const appWithAdmin = createApp({
      opportunities: createFixtureRepository([
        makeOpportunity(),
        makeOpportunity({ id: 'closed-future', closing_date: '2099-12-31', status: 'closed' }),
        makeOpportunity({ id: 'closing-today', closing_date: new Date().toISOString().slice(0, 10) })
      ]).repository,
      authConfig: { url: 'https://example.supabase.co', key: 'sb_publishable_test' },
      supabaseClient: createAuthClient('admin'),
      adminClient: adminUsersClient
    });
    const appWithSelfDeclaredAdmin = createApp({
      opportunities: createFixtureRepository([]).repository,
      authConfig: { url: 'https://example.supabase.co', key: 'sb_publishable_test' },
      supabaseClient: createAuthClient('candidate', { role: 'admin' })
    });

    const start = async (instance) => {
      const server = instance.listen(0);
      await new Promise((resolve) => server.once('listening', resolve));
      return server;
    };

    const candidateServer = await start(appWithCandidate);
    const adminServer = await start(appWithAdmin);
    const selfDeclaredAdminServer = await start(appWithSelfDeclaredAdmin);

    try {
      const candidateResult = await fetch(`http://127.0.0.1:${candidateServer.address().port}/api/admin/metrics`, {
        headers: { Authorization: 'Bearer token' }
      });
      assert.equal(candidateResult.status, 403);

      const adminResult = await fetch(`http://127.0.0.1:${adminServer.address().port}/api/admin/metrics`, {
        headers: { Authorization: 'Bearer token' }
      });
      assert.equal(adminResult.status, 200);
      const body = await adminResult.json();
      assert.ok(body.metrics.totalOpportunities >= 1);
      assert.equal(body.metrics.expiredOpportunities, 1);
      assert.equal(body.metrics.totalUsers, 2);
      assert.equal(body.metrics.activeCandidateAccounts, 1);
      assert.equal(body.user.role, 'admin');

      const selfDeclaredAdminResult = await fetch(`http://127.0.0.1:${selfDeclaredAdminServer.address().port}/api/admin/metrics`, {
        headers: { Authorization: 'Bearer token' }
      });
      assert.equal(selfDeclaredAdminResult.status, 403);
    } finally {
      await Promise.all([
        new Promise((resolve, reject) => candidateServer.close((error) => error ? reject(error) : resolve())),
        new Promise((resolve, reject) => adminServer.close((error) => error ? reject(error) : resolve())),
        new Promise((resolve, reject) => selfDeclaredAdminServer.close((error) => error ? reject(error) : resolve()))
      ]);
    }
  });

  it('lists users and lets an admin update a user role', async () => {
    const adminClient = {
      auth: {
        admin: {
          async listUsers() {
            return {
              data: {
                users: [
                  {
                    id: 'user-1',
                    email: 'candidate@example.com',
                    app_metadata: { role: 'candidate' },
                    user_metadata: { full_name: 'Candidate User' },
                    created_at: '2026-01-01T00:00:00Z'
                  },
                  {
                    id: 'admin-1',
                    email: 'admin@example.com',
                    app_metadata: { role: 'admin' },
                    user_metadata: { full_name: 'Admin User' },
                    created_at: '2026-01-02T00:00:00Z'
                  }
                ]
              },
              error: null
            };
          },
          async updateUserById(userId, update) {
            return {
              data: {
                user: {
                  id: userId,
                  email: 'candidate@example.com',
                  app_metadata: update.app_metadata,
                  user_metadata: { full_name: 'Candidate User' },
                  created_at: '2026-01-01T00:00:00Z'
                }
              },
              error: null
            };
          }
        }
      }
    };

    const app = createApp({
      opportunities: createFixtureRepository([]).repository,
      authConfig: { url: 'https://example.supabase.co', key: 'sb_publishable_test' },
      supabaseClient: createAuthClient('admin'),
      adminClient
    });

    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));

    try {
      const usersResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/users`, {
        headers: { Authorization: 'Bearer token' }
      });
      assert.equal(usersResponse.status, 200);
      const users = await usersResponse.json();
      assert.equal(users.users.length, 2);
      assert.equal(users.users[0].role, 'candidate');

      const updateResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/users/user-1/role`, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ role: 'admin' })
      });
      assert.equal(updateResponse.status, 200);
      const updated = await updateResponse.json();
      assert.equal(updated.user.role, 'admin');
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('allows an admin to create opportunities, update them, delete them, and update their own profile', async () => {
    const adminClient = {
      auth: {
        admin: {
          async updateUserById(userId, update) {
            return {
              data: {
                user: {
                  id: userId,
                  email: 'admin@example.com',
                  app_metadata: { role: 'admin' },
                  user_metadata: { full_name: update.user_metadata?.full_name || 'Admin User' },
                  created_at: '2026-01-02T00:00:00Z'
                }
              },
              error: null
            };
          }
        }
      },
      from(table) {
        if (table === 'opportunities') {
          return {
            select() {
              return {
                eq(column, value) {
                  if (column === 'id' && value === 'skillbridge-new') {
                    return {
                      maybeSingle() {
                        return Promise.resolve({
                          data: {
                            id: 'skillbridge-new',
                            title: 'Data Analyst',
                            organisation: 'SkillBridge',
                            category: 'Job',
                            location: 'Cape Town',
                            status: 'active',
                            is_verified: true,
                            verification_status: 'verified'
                          },
                          error: null
                        });
                      }
                    };
                  }
                  return {
                    maybeSingle() {
                      return Promise.resolve({ data: null, error: null });
                    }
                  };
                }
              };
            },
            insert(payload) {
              return {
                select() {
                  return {
                    single() {
                      return Promise.resolve({
                        data: {
                          id: 'skillbridge-new',
                          ...payload,
                          created_at: '2026-01-03T00:00:00Z',
                          updated_at: '2026-01-03T00:00:00Z'
                        },
                        error: null
                      });
                    }
                  };
                }
              };
            },
            update(payload) {
              return {
                eq(column, value) {
                  if (column === 'id' && value === 'skillbridge-new') {
                    return {
                      select() {
                        return {
                          single() {
                            return Promise.resolve({
                              data: {
                                id: 'skillbridge-new',
                                title: payload.title,
                                organisation: payload.organisation,
                                category: payload.category,
                                location: payload.location,
                                status: payload.status,
                                updated_at: '2026-01-04T00:00:00Z'
                              },
                              error: null
                            });
                          }
                        };
                      }
                    };
                  }
                  return this;
                }
              };
            },
            delete() {
              return {
                eq(column, value) {
                  if (column === 'id' && value === 'skillbridge-new') {
                    return {
                      select() {
                        return {
                          single() {
                            return Promise.resolve({
                              data: { id: 'skillbridge-new', deleted: true },
                              error: null
                            });
                          }
                        };
                      }
                    };
                  }
                  return this;
                }
              };
            }
          };
        }
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() { return Promise.resolve({ data: null, error: null }); }
        };
      }
    };

    const app = createApp({
      opportunities: createFixtureRepository([]).repository,
      authConfig: { url: 'https://example.supabase.co', key: 'sb_publishable_test' },
      supabaseClient: createAuthClient('admin'),
      adminClient
    });

    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));

    try {
      const createResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/opportunities`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Data Analyst',
          organisation: 'SkillBridge',
          category: 'Job',
          location: 'Cape Town',
          closing_date: '2030-12-31',
          experience_level: 'Mid',
          description: 'Analyst role',
          status: 'active',
          is_verified: true,
          is_sample: false,
          verification_status: 'verified'
        })
      });
      assert.equal(createResponse.status, 200);
      const created = await createResponse.json();
      assert.equal(created.opportunity.title, 'Data Analyst');

      const updateResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/opportunities/skillbridge-new`, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Senior Data Analyst',
          organisation: 'SkillBridge',
          category: 'Job',
          location: 'Cape Town',
          closing_date: '2031-12-31',
          experience_level: 'Senior',
          description: 'Updated analyst role',
          status: 'active',
          is_verified: true,
          verification_status: 'verified'
        })
      });
      assert.equal(updateResponse.status, 200);
      const updated = await updateResponse.json();
      assert.equal(updated.opportunity.title, 'Senior Data Analyst');

      const deleteResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/opportunities/skillbridge-new`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer token' }
      });
      assert.equal(deleteResponse.status, 200);
      const removed = await deleteResponse.json();
      assert.equal(removed.deleted.id, 'skillbridge-new');

      const schemaMismatchApp = createApp({
        opportunities: createFixtureRepository([]).repository,
        authConfig: { url: 'https://example.supabase.co', key: 'sb_publishable_test' },
        supabaseClient: createAuthClient('admin'),
        adminClient: {
          auth: { admin: {} },
          from() {
            return {
              insert() {
                return {
                  select() {
                    return {
                      single() {
                        return Promise.resolve({
                          data: null,
                          error: { code: '23514', message: 'new row for relation "opportunities" violates check constraint "opportunities_status_check"' }
                        });
                      }
                    };
                  }
                };
              }
            };
          }
        }
      });
      const schemaMismatchServer = schemaMismatchApp.listen(0);
      await new Promise((resolve) => schemaMismatchServer.once('listening', resolve));

      try {
        const schemaMismatchResponse = await fetch(`http://127.0.0.1:${schemaMismatchServer.address().port}/api/admin/opportunities`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            title: 'Broken status opportunity',
            organisation: 'SkillBridge',
            category: 'Job',
            location: 'Cape Town',
            description: 'Test status mismatch',
            status: 'draft'
          })
        });
        assert.equal(schemaMismatchResponse.status, 400);
        const schemaMismatchBody = await schemaMismatchResponse.json();
        assert.equal(schemaMismatchBody.error.code, 'OPPORTUNITY_STATUS_INVALID');
      } finally {
        await new Promise((resolve, reject) => schemaMismatchServer.close((error) => error ? reject(error) : resolve()));
      }

      const profileResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/profile`, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ full_name: 'Updated Admin User' })
      });
      assert.equal(profileResponse.status, 200);
      const profile = await profileResponse.json();
      assert.equal(profile.user.full_name, 'Updated Admin User');
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe('Frontend API client', () => {
  it('uses valid UTC calendar dates for date-only opportunity ranges', () => {
    const api = require('../js/api.js');

    assert.equal(api.isValidDateOnly('2026-10-28'), true);
    assert.equal(api.isValidDateOnly('2026-02-29'), false);
    assert.equal(api.isValidDateOnly('not-a-date'), false);
    assert.equal(api.addDaysToDateOnly('2026-10-28', 7), '2026-11-04');
    assert.equal(api.addDaysToDateOnly('2026-12-31', 1), '2027-01-01');
    assert.equal(api.addDaysToDateOnly('invalid', 7), null);
    assert.equal(api.isDateOnlyBetween('2026-10-28', '2026-10-28', '2026-11-04'), true);
    assert.equal(api.isDateOnlyBetween('2026-10-31', '2026-10-28', '2026-11-04'), true);
    assert.equal(api.isDateOnlyBetween('2026-11-04', '2026-10-28', '2026-11-04'), true);
    assert.equal(api.isDateOnlyBetween('2026-11-05', '2026-10-28', '2026-11-04'), false);
    assert.equal(api.isDateOnlyBetween('2026-10-27', '2026-10-28', '2026-11-04'), false);
    assert.equal(api.isDateOnlyBetween(null, '2026-10-28', '2026-11-04'), false);
    assert.equal(api.isDateOnlyBetween('2026-99-99', '2026-10-28', '2026-11-04'), false);
    assert.equal(api.isOpportunityClosingSoon({ status: 'active', closingDate: '2026-10-28' }, '2026-10-28'), true);
    assert.equal(api.isOpportunityClosingSoon({ status: 'active', closingDate: '2026-10-31' }, '2026-10-28'), true);
    assert.equal(api.isOpportunityClosingSoon({ status: 'active', closingDate: '2026-11-04' }, '2026-10-28'), true);
    assert.equal(api.isOpportunityClosingSoon({ status: 'active', closingDate: '2026-11-05' }, '2026-10-28'), false);
    assert.equal(api.isOpportunityClosingSoon({ status: 'active', closingDate: '2026-10-27' }, '2026-10-28'), false);
    assert.equal(api.isOpportunityClosingSoon({ status: 'closed', closingDate: '2026-10-31' }, '2026-10-28'), false);
    assert.equal(api.isOpportunityClosingSoon({ status: 'active', closingDate: null }, '2026-10-28'), false);
    assert.equal(api.isOpportunityClosingSoon({ status: 'active', closingDate: '2026-99-99' }, '2026-10-28'), false);
    assert.equal(api.getCurrentDateOnly(new Date('2026-10-28T23:59:59.000Z')), '2026-10-28');
  });

  it('uses the API origin on a local frontend and a relative base elsewhere', () => {
    const api = require('../js/api.js');

    assert.equal(api.getDefaultBaseUrl({ protocol: 'http:', hostname: 'localhost' }), 'http://localhost:3000/api');
    assert.equal(api.getDefaultBaseUrl({ protocol: 'http:', hostname: '127.0.0.1' }), 'http://127.0.0.1:3000/api');
    assert.equal(api.getDefaultBaseUrl({ protocol: 'https:', hostname: 'skillbridge.example' }), '/api');
  });

  it('uses a relative API base URL and normalizes the API response shape', async () => {
    const originalFetch = global.fetch;
    let requestUrl = '';
    global.fetch = async (url, options = {}) => {
      requestUrl = url;
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          items: [{
            id: 'skillbridge-106',
            title: 'Junior developer',
            organisation: 'SkillBridge',
            category: 'Job',
            location: 'Johannesburg',
            closing_date: '2026-10-31',
            experience_level: 'Junior',
            description: 'Entry-level developer role',
            eligibility: ['South African youth'],
            required_documents: ['CV'],
            application_instructions: 'Apply through the official source.',
            official_application_url: 'https://example.com/apply',
            source_url: 'https://example.com',
            source_name: 'SkillBridge',
            last_verified_at: '2026-10-01T00:00:00Z',
            verification_status: 'verified',
            verification_level: 'official-source',
            status: 'active',
            is_verified: true,
            is_sample: false,
            created_at: '2026-10-01T00:00:00Z',
            updated_at: '2026-10-01T00:00:00Z',
            lastUpdated: '2026-10-01T00:00:00Z'
          }],
          pagination: { page: 1, limit: 10, total: 1, totalPages: 1 }
        })
      };
    };

    try {
      const api = require('../js/api.js');
      const result = await api.listOpportunities({ q: 'developer', category: 'Job', page: 1, limit: 10 }, { baseUrl: '/api' });

      assert.equal(requestUrl, '/api/opportunities?q=developer&category=Job&page=1&limit=10&sort=closing_date');
      assert.equal(result.items[0].id, 'skillbridge-106');
      assert.equal(result.items[0].closingDate, '2026-10-31');
      assert.equal(result.pagination.total, 1);
      assert.deepEqual(result.pagination, { page: 1, limit: 10, total: 1, totalPages: 1 });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('loads and merges every page of opportunities while retaining pagination metadata', async () => {
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url) => {
      const requestUrl = new URL(url, 'http://localhost');
      requests.push(requestUrl);
      const page = Number(requestUrl.searchParams.get('page'));
      const items = page === 1
        ? [{ id: 'skillbridge-001', title: 'First', organisation: 'Org' }]
        : [{ id: 'skillbridge-101', title: 'Expired second-page record', organisation: 'Org', closing_date: '2000-01-01', status: 'closed' }];

      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          items,
          pagination: { page, limit: 100, total: 101, totalPages: 2 }
        })
      };
    };

    try {
      const api = require('../js/api.js');
      const result = await api.listAllOpportunities({ category: 'Job', sort: 'closing_date' }, { baseUrl: '/api' });

      assert.deepEqual(result.items.map((item) => item.id), ['skillbridge-001', 'skillbridge-101']);
      assert.equal(result.items[1].closingDate, '2000-01-01');
      assert.equal(result.items[1].status, 'closed');
      assert.deepEqual(result.pagination, { page: 1, limit: 100, total: 101, totalPages: 2 });
      assert.deepEqual(requests.map((url) => url.searchParams.get('page')), ['1', '2']);
      assert.ok(requests.every((url) => url.searchParams.get('category') === 'Job'));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('rejects malformed list envelopes and pagination metadata', async () => {
    const originalFetch = global.fetch;
    const api = require('../js/api.js');
    const malformedPayloads = [
      { items: {} },
      { items: [], pagination: 'invalid' },
      { items: [], pagination: { page: 1, limit: 10, total: -1, totalPages: 0 } }
    ];

    try {
      for (const payload of malformedPayloads) {
        global.fetch = async () => ({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => payload
        });
        await assert.rejects(() => api.listOpportunities({}, { baseUrl: '/api' }), /Unexpected API response/);
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('surfaces the API error message rather than swallowing it', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: { message: 'Bad request' } })
    });

    try {
      const api = require('../js/api.js');
      await assert.rejects(() => api.getHealth({ baseUrl: '/api' }), /Bad request/);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
