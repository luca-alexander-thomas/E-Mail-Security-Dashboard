require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path = require('path');
const { initOIDC } = require('./config/oidc');
const { startScheduler } = require('./services/scheduler');

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

  app.use('/auth', require('./routes/auth'));
  app.use('/api', require('./routes/api'));
  app.use('/dashboard', require('./routes/dashboard'));

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

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Email Security Dashboard läuft auf http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Startup fehlgeschlagen:', err);
  process.exit(1);
});
