const OPPORTUNITY_COLUMNS = [
  'id',
  'title',
  'organisation',
  'category',
  'location',
  'closing_date',
  'experience_level',
  'description',
  'eligibility',
  'required_documents',
  'application_instructions',
  'official_application_url',
  'source_url',
  'source_name',
  'last_verified_at',
  'verification_status',
  'verification_level',
  'status',
  'is_verified',
  'is_sample',
  'imported_at',
  'created_at',
  'updated_at'
].join(',');

const SEARCH_FIELDS = ['title', 'organisation', 'description', 'location'];
const PAGE_SIZE = 1000;

function getTodayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

class DataAccessError extends Error {
  constructor(code = 'UNKNOWN') {
    super('Supabase opportunity query failed.');
    this.name = 'DataAccessError';
    this.code = /^[A-Z0-9_]+$/.test(code) ? code : 'UNKNOWN';
  }
}

function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

function publicOpportunityQuery(supabase) {
  const today = getTodayDateOnly();
  return supabase
    .from('opportunities')
    .select(OPPORTUNITY_COLUMNS, { count: 'exact' })
    .eq('is_verified', true)
    .eq('is_sample', false)
    .eq('verification_status', 'verified')
    .or(`status.eq.active,closing_date.lt.${today}`);
}

async function readAllRows(supabase, filters, searchField) {
  const rows = [];
  let offset = 0;
  let total = 0;

  do {
    let query = publicOpportunityQuery(supabase);

    if (filters.category) {
      query = query.eq('category', filters.category);
    }
    if (filters.location) {
      query = query.ilike('location', `%${escapeLikePattern(filters.location)}%`);
    }
    if (searchField) {
      query = query.ilike(searchField, `%${escapeLikePattern(filters.q)}%`);
    }

    const { data, error, count } = await query
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new DataAccessError(error.code);
    }
    if (!Array.isArray(data) || !Number.isSafeInteger(count)) {
      throw new DataAccessError();
    }
    if (data.length === 0 && offset < count) {
      throw new DataAccessError();
    }

    total = count;
    rows.push(...data);
    offset += data.length;
  } while (offset < total);

  return rows;
}

function createOpportunityRepository(supabase) {
  return {
    async list(filters) {
      const searchFields = filters.q ? SEARCH_FIELDS : [null];
      const resultSets = await Promise.all(
        searchFields.map((field) => readAllRows(supabase, filters, field))
      );
      const byId = new Map();

      for (const rows of resultSets) {
        for (const row of rows) {
          byId.set(row.id, row);
        }
      }

      return [...byId.values()];
    },

    async getById(id) {
      const { data, error } = await publicOpportunityQuery(supabase)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw new DataAccessError(error.code);
      }

      return data;
    }
  };
}

module.exports = { createOpportunityRepository, DataAccessError };
