const express = require('express');
const { generators } = require('openid-client');
const { getClient } = require('../config/oidc');

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

    req.session.user = {
      sub:        userinfo.sub,
      name:       userinfo.name || userinfo.preferred_username,
      email:      userinfo.email || userinfo.preferred_username,
      given_name: userinfo.given_name || '',
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
