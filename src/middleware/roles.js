'use strict';

function requireAdmin(req, res, next) {
  if (!req.session?.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  if (req.session.user.role === 'admin') return next();
  if (!req.session.user.role) {
    // Session pre-dates RBAC — force fresh login to get role assigned
    return req.session.destroy(() => res.redirect('/login'));
  }
  res.status(403).render('error', {
    message: 'Kein Zugriff. Diese Funktion ist nur für Administratoren verfügbar.',
    user: req.session.user,
  });
}

module.exports = { requireAdmin };
