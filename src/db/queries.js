const pool = require('../config/database');

const T = () => `\`${process.env.DB_TABLE || 'dmarc_reports'}\``;

function parseJSON(val) {
  if (!val || typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return val; }
}

// ─── DMARC ────────────────────────────────────────────────────────────────────

async function getOverview(days = 30) {
  const [[r]] = await pool.query(`
    SELECT
      COUNT(*)                                                                                  AS total_records,
      COALESCE(SUM(mail_count), 0)                                                             AS total_emails,
      COALESCE(SUM(CASE WHEN evaluated_dkim='pass' AND evaluated_spf='pass' THEN mail_count ELSE 0 END), 0) AS fully_aligned,
      COALESCE(SUM(CASE WHEN evaluated_dkim='pass'                          THEN mail_count ELSE 0 END), 0) AS dkim_pass,
      COALESCE(SUM(CASE WHEN evaluated_spf='pass'                           THEN mail_count ELSE 0 END), 0) AS spf_pass,
      COALESCE(SUM(CASE WHEN evaluated_disposition='none'       THEN mail_count ELSE 0 END), 0) AS disp_none,
      COALESCE(SUM(CASE WHEN evaluated_disposition='quarantine' THEN mail_count ELSE 0 END), 0) AS disp_quarantine,
      COALESCE(SUM(CASE WHEN evaluated_disposition='reject'     THEN mail_count ELSE 0 END), 0) AS disp_reject,
      COUNT(DISTINCT source_ip)  AS unique_ips,
      COUNT(DISTINCT org_name)   AS reporting_orgs,
      COUNT(DISTINCT domain)     AS domains
    FROM ${T()}
    WHERE date_range_begin >= DATE_SUB(NOW(), INTERVAL ? DAY)
  `, [days]);

  const total = parseInt(r.total_emails) || 0;
  const aligned = parseInt(r.fully_aligned) || 0;
  const dkimPass = parseInt(r.dkim_pass) || 0;
  const spfPass = parseInt(r.spf_pass) || 0;

  return {
    totalRecords:   parseInt(r.total_records) || 0,
    totalEmails:    total,
    fullyAligned:   aligned,
    dkimPass,
    spfPass,
    dkimFail:       total - dkimPass,
    spfFail:        total - spfPass,
    dispNone:       parseInt(r.disp_none) || 0,
    dispQuarantine: parseInt(r.disp_quarantine) || 0,
    dispReject:     parseInt(r.disp_reject) || 0,
    uniqueIPs:      parseInt(r.unique_ips) || 0,
    reportingOrgs:  parseInt(r.reporting_orgs) || 0,
    domains:        parseInt(r.domains) || 0,
    alignmentRate:  total > 0 ? Math.round((aligned  / total) * 100) : 0,
    dkimPassRate:   total > 0 ? Math.round((dkimPass / total) * 100) : 0,
    spfPassRate:    total > 0 ? Math.round((spfPass  / total) * 100) : 0,
  };
}

async function getTimeline(days = 30) {
  const [rows] = await pool.query(`
    SELECT
      DATE(date_range_begin)  AS date,
      SUM(mail_count)         AS total,
      SUM(CASE WHEN evaluated_dkim='pass' AND evaluated_spf='pass' THEN mail_count ELSE 0 END) AS passed,
      SUM(CASE WHEN evaluated_dkim!='pass' OR evaluated_spf!='pass' THEN mail_count ELSE 0 END) AS failed
    FROM ${T()}
    WHERE date_range_begin >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY DATE(date_range_begin)
    ORDER BY date ASC
  `, [days]);

  return rows.map(r => ({
    date:   r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
    total:  parseInt(r.total)  || 0,
    passed: parseInt(r.passed) || 0,
    failed: parseInt(r.failed) || 0,
  }));
}

async function getTopSources(limit = 20, days = 30) {
  const [rows] = await pool.query(`
    SELECT
      source_ip,
      SUM(mail_count)         AS total_emails,
      SUM(CASE WHEN evaluated_dkim='pass' AND evaluated_spf='pass' THEN mail_count ELSE 0 END) AS passed,
      SUM(CASE WHEN evaluated_dkim!='pass' OR evaluated_spf!='pass' THEN mail_count ELSE 0 END) AS failed,
      COUNT(DISTINCT org_name) AS org_count,
      GROUP_CONCAT(DISTINCT org_name ORDER BY org_name SEPARATOR ', ') AS reporting_orgs,
      MAX(evaluated_disposition) AS last_disposition
    FROM ${T()}
    WHERE date_range_begin >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY source_ip
    ORDER BY total_emails DESC
    LIMIT ?
  `, [days, limit]);

  return rows.map(r => {
    const total = parseInt(r.total_emails) || 0;
    const passed = parseInt(r.passed) || 0;
    return {
      sourceIp:       r.source_ip,
      totalEmails:    total,
      passed,
      failed:         parseInt(r.failed) || 0,
      passRate:       total > 0 ? Math.round((passed / total) * 100) : 0,
      orgCount:       parseInt(r.org_count) || 0,
      reportingOrgs:  r.reporting_orgs || '',
      lastDisposition: r.last_disposition,
    };
  });
}

async function getTopOrganizations(limit = 10, days = 30) {
  const [rows] = await pool.query(`
    SELECT
      org_name,
      COUNT(*)          AS report_count,
      SUM(mail_count)   AS total_emails,
      MAX(date_range_begin) AS last_report
    FROM ${T()}
    WHERE date_range_begin >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY org_name
    ORDER BY total_emails DESC
    LIMIT ?
  `, [days, limit]);

  return rows.map(r => ({
    orgName:     r.org_name,
    reportCount: parseInt(r.report_count) || 0,
    totalEmails: parseInt(r.total_emails) || 0,
    lastReport:  r.last_report instanceof Date ? r.last_report.toISOString().split('T')[0] : String(r.last_report || ''),
  }));
}

async function getDomains(days = 30) {
  const [rows] = await pool.query(`
    SELECT
      domain,
      SUM(mail_count)   AS total_emails,
      SUM(CASE WHEN evaluated_dkim='pass' AND evaluated_spf='pass' THEN mail_count ELSE 0 END) AS passed,
      COUNT(DISTINCT source_ip) AS unique_ips
    FROM ${T()}
    WHERE date_range_begin >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY domain
    ORDER BY total_emails DESC
  `, [days]);

  return rows.map(r => {
    const total = parseInt(r.total_emails) || 0;
    const passed = parseInt(r.passed) || 0;
    return {
      domain:      r.domain,
      totalEmails: total,
      passed,
      passRate:    total > 0 ? Math.round((passed / total) * 100) : 0,
      uniqueIPs:   parseInt(r.unique_ips) || 0,
    };
  });
}

async function getRecords({ page = 1, limit = 25, dkim = '', spf = '', disposition = '', days = 30, search = '', category = '' } = {}) {
  const offset = (page - 1) * limit;
  const conds = ['date_range_begin >= DATE_SUB(NOW(), INTERVAL ? DAY)'];
  const params = [days];

  if (dkim)        { conds.push('evaluated_dkim = ?');        params.push(dkim); }
  if (spf)         { conds.push('evaluated_spf = ?');         params.push(spf); }
  if (disposition) { conds.push('evaluated_disposition = ?'); params.push(disposition); }
  if (search) {
    conds.push('(source_ip LIKE ? OR org_name LIKE ? OR domain LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (category === 'compatible')     conds.push("(evaluated_dkim='pass' AND evaluated_spf='pass')");
  else if (category === 'forwarded') conds.push("((evaluated_dkim='pass' AND evaluated_spf!='pass') OR (evaluated_dkim!='pass' AND evaluated_spf='pass'))");
  else if (category === 'failed')    conds.push("(evaluated_dkim!='pass' AND evaluated_spf!='pass')");

  const where = conds.join(' AND ');

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM ${T()} WHERE ${where}`, params);

  const [records] = await pool.query(
    `SELECT id, org_name, date_range_begin, date_range_end, domain, source_ip,
            mail_count, evaluated_disposition, evaluated_dkim, evaluated_spf,
            identifiers, auth_results, policy_published
     FROM ${T()} WHERE ${where}
     ORDER BY date_range_begin DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    records: records.map(r => ({
      ...r,
      identifiers:      parseJSON(r.identifiers),
      auth_results:     parseJSON(r.auth_results),
      policy_published: parseJSON(r.policy_published),
    })),
    total: parseInt(total) || 0,
  };
}

async function getSourceCategories(days = 30) {
  const [[r]] = await pool.query(`
    SELECT
      SUM(CASE WHEN evaluated_dkim='pass' AND evaluated_spf='pass'                                                          THEN mail_count ELSE 0 END) AS compatible,
      SUM(CASE WHEN (evaluated_dkim='pass' AND evaluated_spf!='pass') OR (evaluated_dkim!='pass' AND evaluated_spf='pass') THEN mail_count ELSE 0 END) AS forwarded,
      SUM(CASE WHEN evaluated_dkim!='pass' AND evaluated_spf!='pass'                                                        THEN mail_count ELSE 0 END) AS failed
    FROM ${T()}
    WHERE date_range_begin >= DATE_SUB(NOW(), INTERVAL ? DAY)
  `, [days]);
  return {
    compatible: parseInt(r.compatible) || 0,
    forwarded:  parseInt(r.forwarded)  || 0,
    failed:     parseInt(r.failed)     || 0,
  };
}

async function getTrend(days = 30) {
  const [[cur]] = await pool.query(`
    SELECT
      COALESCE(SUM(mail_count), 0) AS total,
      COALESCE(SUM(CASE WHEN evaluated_dkim='pass' AND evaluated_spf='pass' THEN mail_count ELSE 0 END), 0) AS aligned,
      COALESCE(SUM(CASE WHEN evaluated_dkim='pass' THEN mail_count ELSE 0 END), 0) AS dkim_pass,
      COALESCE(SUM(CASE WHEN evaluated_spf='pass'  THEN mail_count ELSE 0 END), 0) AS spf_pass
    FROM ${T()} WHERE date_range_begin >= DATE_SUB(NOW(), INTERVAL ? DAY)
  `, [days]);

  const [[prev]] = await pool.query(`
    SELECT
      COALESCE(SUM(mail_count), 0) AS total,
      COALESCE(SUM(CASE WHEN evaluated_dkim='pass' AND evaluated_spf='pass' THEN mail_count ELSE 0 END), 0) AS aligned,
      COALESCE(SUM(CASE WHEN evaluated_dkim='pass' THEN mail_count ELSE 0 END), 0) AS dkim_pass,
      COALESCE(SUM(CASE WHEN evaluated_spf='pass'  THEN mail_count ELSE 0 END), 0) AS spf_pass
    FROM ${T()}
    WHERE date_range_begin >= DATE_SUB(NOW(), INTERVAL ? DAY)
      AND date_range_begin <  DATE_SUB(NOW(), INTERVAL ? DAY)
  `, [days * 2, days]);

  function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }
  function delta(c, p) { return p > 0 ? Math.round(((c - p) / p) * 100) : null; }

  return {
    emailsDelta:    delta(parseInt(cur.total),    parseInt(prev.total)),
    alignmentDelta: pct(parseInt(cur.aligned),  parseInt(cur.total))  - pct(parseInt(prev.aligned),  parseInt(prev.total)),
    dkimDelta:      pct(parseInt(cur.dkim_pass), parseInt(cur.total)) - pct(parseInt(prev.dkim_pass), parseInt(prev.total)),
    spfDelta:       pct(parseInt(cur.spf_pass),  parseInt(cur.total)) - pct(parseInt(prev.spf_pass),  parseInt(prev.total)),
    prevTotal:      parseInt(prev.total) || 0,
  };
}

async function getSecurityScore(days = 30) {
  const overview = await getOverview(days);

  const [[policyRow]] = await pool.query(`
    SELECT policy_published FROM ${T()}
    WHERE date_range_begin >= DATE_SUB(NOW(), INTERVAL ? DAY)
    ORDER BY date_range_begin DESC LIMIT 1
  `, [days]);

  const policy = policyRow ? (parseJSON(policyRow.policy_published) || {}) : {};
  const pValue = policy.p || 'none';

  const policyScore = pValue === 'reject' ? 30 : pValue === 'quarantine' ? 20 : 5;
  const alignScore  = Math.round(overview.alignmentRate * 0.4);
  const dkimScore   = Math.round(overview.dkimPassRate  * 0.15);
  const spfScore    = Math.round(overview.spfPassRate    * 0.15);
  const total       = Math.min(100, policyScore + alignScore + dkimScore + spfScore);
  const grade       = total >= 90 ? 'A' : total >= 75 ? 'B' : total >= 60 ? 'C' : total >= 40 ? 'D' : 'F';

  const recommendations = [];
  if (pValue === 'none')          recommendations.push({ severity: 'critical', text: 'DMARC Policy auf quarantine oder reject umstellen – aktuell kein Schutz aktiv' });
  if (pValue === 'quarantine')    recommendations.push({ severity: 'warning',  text: 'Policy auf reject upgraden für maximalen Domain-Schutz' });
  if (overview.dkimPassRate < 95) recommendations.push({ severity: 'warning',  text: `DKIM Fehlerrate erhöht (${100 - overview.dkimPassRate}% Fehler) – Signing-Konfiguration prüfen` });
  if (overview.spfPassRate < 95)  recommendations.push({ severity: 'warning',  text: `SPF Fehlerrate erhöht (${100 - overview.spfPassRate}% Fehler) – SPF-Record auf Vollständigkeit prüfen` });
  if (overview.dispReject > 0)    recommendations.push({ severity: 'info',     text: `${overview.dispReject} E-Mail(s) wurden abgelehnt (reject) – Quell-IPs prüfen` });
  if (recommendations.length === 0) recommendations.push({ severity: 'success', text: 'Ausgezeichnet! Deine E-Mail Sicherheit ist optimal konfiguriert.' });

  return { score: total, grade, policy: pValue, policyScore, alignScore, dkimScore, spfScore, recommendations, ...overview };
}

async function getReportById(id) {
  const [[row]] = await pool.query(`SELECT * FROM ${T()} WHERE id = ?`, [id]);
  if (!row) return null;
  return {
    ...row,
    full_data:        parseJSON(row.full_data),
    identifiers:      parseJSON(row.identifiers),
    auth_results:     parseJSON(row.auth_results),
    policy_published: parseJSON(row.policy_published),
  };
}

async function getExportData(filters = {}) {
  const { dkim = '', spf = '', disposition = '', days = 30, search = '', category = '' } = filters;
  const conds = ['date_range_begin >= DATE_SUB(NOW(), INTERVAL ? DAY)'];
  const params = [days];

  if (dkim)        { conds.push('evaluated_dkim = ?');        params.push(dkim); }
  if (spf)         { conds.push('evaluated_spf = ?');         params.push(spf); }
  if (disposition) { conds.push('evaluated_disposition = ?'); params.push(disposition); }
  if (search) {
    conds.push('(source_ip LIKE ? OR org_name LIKE ? OR domain LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (category === 'compatible')     conds.push("(evaluated_dkim='pass' AND evaluated_spf='pass')");
  else if (category === 'forwarded') conds.push("((evaluated_dkim='pass' AND evaluated_spf!='pass') OR (evaluated_dkim!='pass' AND evaluated_spf='pass'))");
  else if (category === 'failed')    conds.push("(evaluated_dkim!='pass' AND evaluated_spf!='pass')");

  const [rows] = await pool.query(
    `SELECT id, org_name, date_range_begin, date_range_end, domain, source_ip,
            mail_count, evaluated_disposition, evaluated_dkim, evaluated_spf
     FROM ${T()} WHERE ${conds.join(' AND ')}
     ORDER BY date_range_begin DESC LIMIT 10000`,
    params
  );
  return rows;
}

// ─── TLSRPT ───────────────────────────────────────────────────────────────────

async function getTlsrptStats(days = 30) {
  const [[r]] = await pool.query(`
    SELECT
      COUNT(*)                      AS total_reports,
      COALESCE(SUM(sessions_ok),     0) AS total_ok,
      COALESCE(SUM(sessions_failed), 0) AS total_failed,
      COUNT(DISTINCT organization)  AS reporting_orgs,
      COUNT(DISTINCT domain)        AS domains,
      COUNT(DISTINCT policy_type)   AS policy_types,
      SUM(CASE WHEN sessions_failed > 0 THEN 1 ELSE 0 END) AS reports_with_failures
    FROM tlsrpt_reports
    WHERE date_begin >= DATE_SUB(NOW(), INTERVAL ? DAY)
  `, [days]);

  const ok = parseInt(r.total_ok) || 0;
  const failed = parseInt(r.total_failed) || 0;
  const total = ok + failed;

  return {
    totalReports:        parseInt(r.total_reports) || 0,
    totalOk:             ok,
    totalFailed:         failed,
    successRate:         total > 0 ? Math.round((ok / total) * 100) : 0,
    reportingOrgs:       parseInt(r.reporting_orgs) || 0,
    domains:             parseInt(r.domains) || 0,
    reportsWithFailures: parseInt(r.reports_with_failures) || 0,
  };
}

async function getTlsrptTimeline(days = 30) {
  const [rows] = await pool.query(`
    SELECT
      DATE(date_begin)         AS date,
      SUM(sessions_ok)         AS ok,
      SUM(sessions_failed)     AS failed
    FROM tlsrpt_reports
    WHERE date_begin >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY DATE(date_begin)
    ORDER BY date ASC
  `, [days]);

  return rows.map(r => ({
    date:   r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
    ok:     parseInt(r.ok)     || 0,
    failed: parseInt(r.failed) || 0,
  }));
}

async function getTlsrptRecords({ page = 1, limit = 25, days = 30, domain = '' } = {}) {
  const offset = (page - 1) * limit;
  const conds = ['date_begin >= DATE_SUB(NOW(), INTERVAL ? DAY)'];
  const params = [days];

  if (domain) { conds.push('domain LIKE ?'); params.push(`%${domain}%`); }

  const where = conds.join(' AND ');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM tlsrpt_reports WHERE ${where}`, params);

  const [records] = await pool.query(
    `SELECT id, report_id, organization, date_begin, date_end, domain,
            policy_type, policy_domain, mx_host, sessions_ok, sessions_failed, failure_details
     FROM tlsrpt_reports WHERE ${where}
     ORDER BY date_begin DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    records: records.map(r => ({ ...r, failure_details: parseJSON(r.failure_details) })),
    total: parseInt(total) || 0,
  };
}

async function getTlsrptFailureTypes(days = 30) {
  const [rows] = await pool.query(`
    SELECT policy_type, SUM(sessions_failed) AS failed_sessions, COUNT(*) AS report_count
    FROM tlsrpt_reports
    WHERE date_begin >= DATE_SUB(NOW(), INTERVAL ? DAY) AND sessions_failed > 0
    GROUP BY policy_type
    ORDER BY failed_sessions DESC
  `, [days]);
  return rows.map(r => ({
    policyType:     r.policy_type,
    failedSessions: parseInt(r.failed_sessions) || 0,
    reportCount:    parseInt(r.report_count) || 0,
  }));
}

// ─── Security Score ────────────────────────────────────────────────────────────

async function getLatestSecurityScore() {
  const [[row]] = await pool.query(
    `SELECT * FROM security_scores ORDER BY score_date DESC LIMIT 1`
  );
  if (!row) return null;
  return {
    ...row,
    control_scores:    parseJSON(row.control_scores),
    vendor_information: parseJSON(row.vendor_information),
  };
}

async function getSecurityScoreHistory(days = 90) {
  const [rows] = await pool.query(`
    SELECT score_date, current_score, max_score, percentage, avg_comparable_score
    FROM security_scores
    WHERE score_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
    ORDER BY score_date ASC
  `, [days]);
  return rows.map(r => ({
    date:               r.score_date instanceof Date ? r.score_date.toISOString().split('T')[0] : String(r.score_date),
    score:              parseFloat(r.current_score)        || 0,
    maxScore:           parseFloat(r.max_score)            || 0,
    percentage:         parseFloat(r.percentage)           || 0,
    avgComparableScore: parseFloat(r.avg_comparable_score) || 0,
  }));
}

// ─── Mail Flow ─────────────────────────────────────────────────────────────────

async function getMailFlowStats(days = 30) {
  const [[r]] = await pool.query(`
    SELECT
      COALESCE(SUM(good_mail),    0) AS good,
      COALESCE(SUM(spam_mail),    0) AS spam,
      COALESCE(SUM(malware_mail), 0) AS malware,
      COALESCE(SUM(phish_mail),   0) AS phish,
      COALESCE(SUM(spoof_mail),   0) AS spoof,
      COALESCE(SUM(edge_block),   0) AS edge_block,
      COALESCE(SUM(quarantine),   0) AS quarantine
    FROM mail_flow_stats
    WHERE report_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
      AND direction = 'Inbound'
  `, [days]);

  const total = Object.values(r).reduce((s, v) => s + (parseInt(v) || 0), 0);
  return {
    good:       parseInt(r.good)       || 0,
    spam:       parseInt(r.spam)       || 0,
    malware:    parseInt(r.malware)    || 0,
    phish:      parseInt(r.phish)      || 0,
    spoof:      parseInt(r.spoof)      || 0,
    edgeBlock:  parseInt(r.edge_block) || 0,
    quarantine: parseInt(r.quarantine) || 0,
    total,
  };
}

async function getMailFlowTimeline(days = 30) {
  const [rows] = await pool.query(`
    SELECT report_date, good_mail, spam_mail, malware_mail, phish_mail, spoof_mail, quarantine
    FROM mail_flow_stats
    WHERE report_date >= DATE_SUB(NOW(), INTERVAL ? DAY) AND direction = 'Inbound'
    ORDER BY report_date ASC
  `, [days]);

  return rows.map(r => ({
    date:    r.report_date instanceof Date ? r.report_date.toISOString().split('T')[0] : String(r.report_date),
    good:    parseInt(r.good_mail)    || 0,
    spam:    parseInt(r.spam_mail)    || 0,
    malware: parseInt(r.malware_mail) || 0,
    phish:   parseInt(r.phish_mail)   || 0,
    spoof:   parseInt(r.spoof_mail)   || 0,
    quarantine: parseInt(r.quarantine) || 0,
  }));
}

// ─── Security Alerts ──────────────────────────────────────────────────────────

async function getAlertStats() {
  const [rows] = await pool.query(`
    SELECT severity, status, COUNT(*) AS cnt
    FROM security_alerts
    GROUP BY severity, status
  `);

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, informational: 0, unknown: 0 };
  const byStatus   = { new: 0, inProgress: 0, resolved: 0 };
  let total = 0;

  for (const r of rows) {
    if (r.severity in bySeverity) bySeverity[r.severity] += parseInt(r.cnt) || 0;
    const st = r.status?.toLowerCase().replace(' ', '') || 'new';
    if (st in byStatus) byStatus[st] += parseInt(r.cnt) || 0;
    total += parseInt(r.cnt) || 0;
  }

  return { bySeverity, byStatus, total };
}

async function getAlerts({ page = 1, limit = 25, severity = '', status = '', category = '' } = {}) {
  const offset = (page - 1) * limit;
  const conds = ['1=1'];
  const params = [];

  if (severity) { conds.push('severity = ?'); params.push(severity); }
  if (status)   { conds.push('status = ?');   params.push(status); }
  if (category) { conds.push('category LIKE ?'); params.push(`%${category}%`); }

  const where = conds.join(' AND ');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM security_alerts WHERE ${where}`, params);

  const [records] = await pool.query(
    `SELECT id, alert_id, title, category, severity, status, alert_created, alert_modified,
            description, product_name, service_source
     FROM security_alerts WHERE ${where}
     ORDER BY alert_created DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { records, total: parseInt(total) || 0 };
}

// ─── Email Activity ──────────────────────────────────────────────────────────

async function getEmailActivityStats(days = 7) {
  const [[totals]] = await pool.query(`
    SELECT
      COALESCE(SUM(send_count),    0) AS total_sent,
      COALESCE(SUM(receive_count), 0) AS total_received,
      COALESCE(SUM(read_count),    0) AS total_read,
      COUNT(*)                        AS data_days
    FROM email_activity
    WHERE report_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
  `, [days]);

  const [timeline] = await pool.query(`
    SELECT report_date AS date, send_count AS sent, receive_count AS received, read_count AS \`read\`
    FROM email_activity
    WHERE report_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
    ORDER BY report_date ASC
  `, [days]);

  return {
    totalSent:     parseInt(totals.total_sent)     || 0,
    totalReceived: parseInt(totals.total_received) || 0,
    totalRead:     parseInt(totals.total_read)     || 0,
    dataDays:      parseInt(totals.data_days)      || 0,
    timeline: timeline.map(r => ({
      date:     r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
      sent:     parseInt(r.sent)     || 0,
      received: parseInt(r.received) || 0,
      read:     parseInt(r.read)     || 0,
    })),
  };
}

// ─── DNS Health ───────────────────────────────────────────────────────────────

async function getLatestDnsHealth() {
  const [rows] = await pool.query(`
    SELECT d.*
    FROM dns_health_checks d
    INNER JOIN (
      SELECT domain, MAX(check_date) AS latest
      FROM dns_health_checks
      GROUP BY domain
    ) m ON d.domain = m.domain AND d.check_date = m.latest
    ORDER BY d.domain ASC
  `);
  return rows;
}

async function getDnsHealthHistory(domain, days = 30) {
  const [rows] = await pool.query(`
    SELECT check_date, spf_valid, dkim_valid, dmarc_valid, dmarc_policy,
           mta_sts_dns_valid, mta_sts_mode, tlsrpt_valid, bimi_valid, issues_count
    FROM dns_health_checks
    WHERE domain = ? AND check_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
    ORDER BY check_date ASC
  `, [domain, days]);
  return rows;
}

module.exports = {
  // DMARC
  getOverview, getTimeline, getTopSources, getTopOrganizations, getDomains,
  getRecords, getSourceCategories, getTrend, getSecurityScore, getReportById, getExportData,
  // TLSRPT
  getTlsrptStats, getTlsrptTimeline, getTlsrptRecords, getTlsrptFailureTypes,
  // Security Score
  getLatestSecurityScore, getSecurityScoreHistory,
  // Mail Flow
  getMailFlowStats, getMailFlowTimeline,
  // Alerts
  getAlertStats, getAlerts,
  // Email Activity
  getEmailActivityStats,
  // DNS Health
  getLatestDnsHealth, getDnsHealthHistory,
};
