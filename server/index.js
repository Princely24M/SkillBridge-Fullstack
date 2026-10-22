require('dotenv').config();

const { createSupabaseClient, readSupabaseConfig } = require('./lib/supabase');
const { createOpportunityRepository } = require('./lib/opportunities');
const { createApp } = require('./app');

function readPort(value) {
  if (value === undefined || value === '') {
    return 3000;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error('PORT must be a positive integer from 1 to 65535.');
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error('PORT must be a positive integer from 1 to 65535.');
  }

  return port;
}

const port = readPort(process.env.PORT);
const supabaseConfig = readSupabaseConfig();
const supabase = createSupabaseClient();
const opportunities = createOpportunityRepository(supabase);
const app = createApp({ opportunities, authConfig: supabaseConfig, supabaseClient: supabase });

app.listen(port, () => {
  console.log(`SkillBridge API listening on port ${port}.`);
});
