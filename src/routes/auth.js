const express = require('express');
const { generators } = require('openid-client');
const { getClient } = require('../config/oidc');
const { checkUserGroups } = require('../services/graphApi');

const router = express.Router();

router.get('/login', (req, res) => {
  const client = getClient();
  const nonce = generators.nonce();
  const state = generators.state();

  req.session.nonce = nonce;
  req.session.state = state;

  const authUrl = client.authorizationUrl({
    scope: 'openid profile email',
    nonce,
    state,
  });

  res.redirect(authUrl);
});

router.get('/callback', async (req, res, next) => {
  try {
    const client = getClient();
    const params = client.callbackParams(req);

    const tokenSet = await client.callback(
      process.env.AZURE_REDIRECT_URI,
      params,
      { nonce: req.session.nonce, state: req.session.state }
    );

    const userinfo = await client.userinfo(tokenSet.access_token);

    // Determine role via Entra group membership
    const adminGroupId = (process.env.ENTRA_ADMIN_GROUP_ID || '').trim().toLowerCase();
    const userGroupId  = (process.env.ENTRA_USER_GROUP_ID  || '').trim().toLowerCase();
    let role = 'admin'; // default when RBAC not configured

    if (adminGroupId || userGroupId) {
      const claims   = tokenSet.claims();
      const oid      = claims.oid || userinfo.sub;
      const groupIds = [adminGroupId, userGroupId].filter(Boolean);
      let memberOf   = [];

      // Option A: groups in ID token (requires groupMembershipClaims: SecurityGroup in manifest)
      if (Array.isArray(claims.groups)) {
        memberOf = claims.groups.map(g => String(g).toLowerCase());
        console.log('[Auth] Gruppen aus Token-Claims gelesen:', memberOf.length);
      } else {
        // Option B: Graph API (requires GroupMember.Read.All application permission)
        try {
          const raw = await checkUserGroups(oid, groupIds);
          memberOf = raw.map(g => String(g).toLowerCase());
          console.log('[Auth] Gruppen via Graph API geprüft:', memberOf);
        } catch (e) {
          console.error('[Auth] Gruppen-Check fehlgeschlagen:', e.message);
          const hint = e.message.includes('403')
            ? 'Konfiguration erforderlich: "groupMembershipClaims" im App-Manifest setzen oder GroupMember.Read.All erteilen.'
            : 'Gruppen-Prüfung fehlgeschlagen. Bitte erneut versuchen.';
          return res.redirect('/login?error=' + encodeURIComponent(hint));
        }
      }

      console.log('[Auth] Gruppen-Check — oid:', oid, '| adminGroup:', adminGroupId, '| userGroup:', userGroupId, '| memberOf:', memberOf);

      if (adminGroupId && memberOf.includes(adminGroupId)) {
        role = 'admin';
      } else if (userGroupId && memberOf.includes(userGroupId)) {
        role = 'user';
      } else {
        return res.redirect('/login?error=' + encodeURIComponent('Kein Zugriff. Bitte wende dich an einen Administrator.'));
      }
    }

    req.session.user = {
      sub:        userinfo.sub,
      name:       userinfo.name || userinfo.preferred_username,
      email:      userinfo.email || userinfo.preferred_username,
      given_name: userinfo.given_name || '',
      role,
    };

    delete req.session.nonce;
    delete req.session.state;

    const returnTo = req.session.returnTo || '/dashboard';
    delete req.session.returnTo;
    res.redirect(returnTo);
  } catch (err) {
    next(err);
  }
});

router.get('/logout', (req, res) => {
  const client = getClient();
  req.session.destroy(() => {
    try {
      const url = client.endSessionUrl({
        post_logout_redirect_uri: process.env.BASE_URL || 'http://localhost:3000',
      });
      res.redirect(url);
    } catch {
      res.redirect('/');
    }
  });
});

module.exports = router;
