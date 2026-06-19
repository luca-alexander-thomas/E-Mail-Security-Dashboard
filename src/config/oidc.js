const { Issuer } = require('openid-client');

let oidcClient = null;

async function initOIDC() {
  const tenantId = process.env.AZURE_TENANT_ID;
  if (!tenantId) throw new Error('AZURE_TENANT_ID is not set in .env');

  const issuer = await Issuer.discover(
    `https://login.microsoftonline.com/${tenantId}/v2.0`
  );

  oidcClient = new issuer.Client({
    client_id: process.env.AZURE_CLIENT_ID,
    client_secret: process.env.AZURE_CLIENT_SECRET,
    redirect_uris: [process.env.AZURE_REDIRECT_URI],
    response_types: ['code'],
  });

  console.log('[OIDC] Client initialized for tenant:', tenantId);
  return oidcClient;
}

function getClient() {
  if (!oidcClient) throw new Error('OIDC client not initialized');
  return oidcClient;
}

module.exports = { initOIDC, getClient };
