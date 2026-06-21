require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path = require('path');
const { initOIDC } = require('./config/oidc');
const { startScheduler } = require('./services/scheduler');
const updater = require('./services/updater');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  createDatabaseTable: true,
  expiration: 86400000,
  clearExpired: true,
  checkExpirationInterval: 900000,
});

app.use(session({
  key: 'dmarc_session',
  secret: process.env.SESSION_SECRET || 'change-me',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

async function start() {
  await initOIDC();

  app.locals.showDevTools = process.env.SHOW_DEV_TOOLS === 'true';

  // Anonymisierungsfunktionen für eingeschränkte Nutzer
  app.locals.anonIp = (ip) => {
    if (!ip) return ip;
    const parts = String(ip).split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
    // IPv6: letzte zwei Blöcke maskieren
    const v6 = String(ip).split(':');
    if (v6.length > 2) { v6.splice(-2, 2, 'xxxx', 'xxxx'); return v6.join(':'); }
    return 'xxx';
  };

  app.locals.anonEmail = (email) => {
    if (!email) return email;
    const str = String(email);
    const at = str.indexOf('@');
    if (at < 1) return '***@***';
    const local = str.substring(0, at);
    const domain = str.substring(at + 1);
    const dot = domain.lastIndexOf('.');
    const tld = dot >= 0 ? domain.substring(dot) : '';
    const base = dot >= 0 ? domain.substring(0, dot) : domain;
    return `${local[0]}***@${base[0]}***${tld}`;
  };

  // Update-Status und Nutzerrolle in jede View weitergeben
  app.use((req, res, next) => {
    const check = updater.getLastCheck();
    res.locals.updateAvailable = check?.hasUpdate || false;
    res.locals.isAdmin = req.session?.user?.role === 'admin';
    next();
  });

  const { requireAdmin } = require('./middleware/roles');

  app.use('/auth', require('./routes/auth'));
  app.use('/api', require('./routes/api'));
  app.use('/dashboard', require('./routes/dashboard'));
  app.use('/dashboard/updates', requireAdmin, require('./routes/updates'));

  app.get('/login', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/dashboard');
    res.render('login', { error: req.query.error });
  });

  app.get('/', (req, res) => res.redirect('/dashboard'));

  app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', {
      message: err.message || 'Ein unerwarteter Fehler ist aufgetreten.',
      user: req.session && req.session.user,
    });
  });

  startScheduler();
  updater.startAutoCheck();

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Email Security Dashboard läuft auf http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Startup fehlgeschlagen:', err);
  process.exit(1);
});
