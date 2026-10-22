(function (global) {
  const DEFAULT_BASE_URL = '/api';

  function normalizeBaseUrl(baseUrl) {
    if (!baseUrl) return DEFAULT_BASE_URL;
    return String(baseUrl).trim() || DEFAULT_BASE_URL;
  }

  function getDefaultBaseUrl(location = global.location) {
    if (global.SKILLBRIDGE_API_BASE_URL) {
      return normalizeBaseUrl(global.SKILLBRIDGE_API_BASE_URL);
    }

    const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
    if (location && /^https?:$/.test(location.protocol) && localHosts.has(location.hostname.toLowerCase())) {
      return `${location.protocol}//${location.hostname}:3000/api`;
    }

    return DEFAULT_BASE_URL;
  }

  function buildUrl(path, baseUrl) {
    const normalizedBase = normalizeBaseUrl(baseUrl);
    const normalizedPath = String(path || '').replace(/^\/+/, '');

    if (!normalizedPath) {
      return normalizedBase;
    }

    if (/^https?:\/\//i.test(normalizedBase)) {
      return new URL(normalizedPath, `${normalizedBase.replace(/\/$/, '')}/`).toString();
    }

    return `${normalizedBase.replace(/\/$/, '')}/${normalizedPath}`;
  }

  function createSearchParams(params = {}) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        return;
      }
      const nextValue = typeof value === 'string' ? value.trim() : String(value);
      if (nextValue) {
        searchParams.append(key, nextValue);
      }
    });
    return searchParams;
  }

  async function requestJson(path, options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl || getDefaultBaseUrl());
    const url = buildUrl(path, baseUrl);
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(options.headers || {})
      },
      ...options
    });

    const contentType = response.headers.get('content-type') || '';
    let payload;
    if (contentType.includes('application/json')) {
      payload = await response.json();
    } else {
      payload = await response.text();
    }

    if (!response.ok) {
      const message = payload && typeof payload === 'object' && payload.error && payload.error.message
        ? payload.error.message
        : 'Unexpected API response.';
      throw new Error(message);
    }

    return payload;
  }

  function normalizeOpportunity(item) {
    if (!item || typeof item !== 'object') {
      return item;
    }

    return {
      id: item.id,
      title: item.title,
      organisation: item.organisation,
      category: item.category,
      location: item.location,
      closingDate: item.closingDate || item.closing_date || null,
      experienceLevel: item.experienceLevel || item.experience_level || 'Varies',
      description: item.description,
      fullDescription: item.fullDescription || item.description,
      eligibility: Array.isArray(item.eligibility) ? item.eligibility : [],
      requiredDocuments: Array.isArray(item.requiredDocuments) ? item.requiredDocuments : Array.isArray(item.required_documents) ? item.required_documents : [],
      applicationInstructions: item.applicationInstructions || item.application_instructions || '',
      officialApplicationUrl: item.officialApplicationUrl || item.official_application_url || item.applicationLink || '',
      sourceUrl: item.sourceUrl || item.source_url || '',
      sourceName: item.sourceName || item.source_name || item.organisation || '',
      lastVerified: item.lastVerified || item.last_verified_at || item.lastUpdated || null,
      verificationStatus: item.verificationStatus || item.verification_status || 'needs_review',
      verificationLevel: item.verificationLevel || item.verification_level || null,
      status: item.status || 'active',
      isVerified: item.isVerified !== undefined ? item.isVerified : Boolean(item.is_verified),
      isSample: item.isSample !== undefined ? item.isSample : Boolean(item.is_sample),
      importedAt: item.importedAt || item.imported_at || null,
      createdAt: item.createdAt || item.created_at || null,
      updatedAt: item.updatedAt || item.updated_at || null,
      lastUpdated: item.lastUpdated || item.updated_at || item.last_verified_at || null
    };
  }

  function buildFallbackListResult(items = []) {
    const collection = Array.isArray(items) ? items : [];
    const normalizedItems = collection.map(normalizeOpportunity);

    return {
      items: normalizedItems,
      fallback: true,
      pagination: {
        page: 1,
        limit: normalizedItems.length,
        total: normalizedItems.length,
        totalPages: normalizedItems.length ? 1 : 0
      }
    };
  }

  async function listOpportunities(filters = {}, options = {}) {
    const query = createSearchParams({
      q: filters.q,
      category: filters.category,
      location: filters.location,
      page: filters.page,
      limit: filters.limit,
      sort: filters.sort || 'closing_date',
      includeExpired: filters.includeExpired,
      includeUnverified: filters.includeUnverified
    });

    let result;
    try {
      result = await requestJson(`opportunities?${query.toString()}`, options);
    } catch (error) {
      if (options.fallback !== undefined) {
        return buildFallbackListResult(options.fallback);
      }
      throw error;
    }

    if (Array.isArray(result)) {
      return {
        items: result.map(normalizeOpportunity),
        fallback: false,
        pagination: {
          page: 1,
          limit: result.length,
          total: result.length,
          totalPages: result.length ? 1 : 0
        }
      };
    }

    if (!result || typeof result !== 'object' || Array.isArray(result) || !Array.isArray(result.items)) {
      throw new Error('Unexpected API response.');
    }

    const pagination = result.pagination;
    if (pagination !== undefined && (!pagination || typeof pagination !== 'object' || Array.isArray(pagination))) {
      throw new Error('Unexpected API response.');
    }
    if (pagination && [pagination.page, pagination.limit, pagination.total, pagination.totalPages]
      .some((value) => !Number.isSafeInteger(value) || value < 0)) {
      throw new Error('Unexpected API response.');
    }

    const items = result.items.map(normalizeOpportunity);
    return {
      items,
      fallback: false,
      pagination: pagination || {
        page: 1,
        limit: items.length,
        total: items.length,
        totalPages: items.length ? 1 : 0
      }
    };
  }

  async function listAllOpportunities(filters = {}, options = {}) {
    const limit = 100;
    const firstPage = await listOpportunities({ ...filters, page: 1, limit }, options);
    const pages = [firstPage];

    for (let page = 2; page <= firstPage.pagination.totalPages; page += 1) {
      pages.push(await listOpportunities({ ...filters, page, limit }, options));
    }

    return {
      items: pages.flatMap((result) => result.items),
      pagination: firstPage.pagination
    };
  }

  async function getOpportunityById(id, options = {}) {
    const result = await requestJson(`opportunities/${encodeURIComponent(String(id))}`, options);
    if (result && result.item) {
      return normalizeOpportunity(result.item);
    }
    if (result && result.id) {
      return normalizeOpportunity(result);
    }
    return null;
  }

  async function getHealth(options = {}) {
    return requestJson('health', options);
  }

  const api = {
    DEFAULT_BASE_URL,
    getDefaultBaseUrl,
    buildUrl,
    requestJson,
    normalizeOpportunity,
    listOpportunities,
    listAllOpportunities,
    getOpportunityById,
    getHealth
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  global.SkillBridgeAPI = api;
})(typeof window !== 'undefined' ? window : globalThis);
