const pool = require('../config/database');

const DOH = 'https://cloudflare-dns.com/dns-query';
const DOH_HEADERS = { Accept: 'application/dns-json' };

async function queryTxt(name, contains) {
  try {
    const res = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=TXT`, { headers: DOH_HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    const rec = (data.Answer || []).find(a => a.data?.replace(/"/g, '').includes(contains));
    return rec ? rec.data.replace(/"/g, '').trim() : null;
  } catch {
    return null;
  }
}

async function fetchMtaStsPolicy(domain) {
  try {
    const res = await fetch(
      `https://mta-sts.${domain}/.well-known/mta-sts.txt`,
      { signal: AbortSignal.timeout(10000) }
    );
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function checkDomain(domain, dkimSelector) {
  const [spfRecord, dmarcRecord, mtaStsRecord, tlsrptRecord, bimiRecord, dkimRecord] = await Promise.all([
    queryTxt(domain, 'v=spf1'),
    queryTxt(`_dmarc.${domain}`, 'v=DMARC1'),
    queryTxt(`_mta-sts.${domain}`, 'v=STSv1'),
    queryTxt(`_smtp._tls.${domain}`, 'v=TLSRPTv1'),
    queryTxt(`default._bimi.${domain}`, 'v=BIMI1'),
    queryTxt(`${dkimSelector}._domainkey.${domain}`, 'v=DKIM1'),
  ]);

  const mtaStsPolicyRaw = mtaStsRecord ? await fetchMtaStsPolicy(domain) : null;

  let dmarcPolicy = null, dmarcPct = null;
  if (dmarcRecord) {
    dmarcPolicy = (dmarcRecord.match(/p=([^;\s]+)/) || [])[1]?.trim() || null;
    dmarcPct = parseInt((dmarcRecord.match(/pct=(\d+)/) || [])[1] ?? '100');
  }

  let mtaStsMode = null, mtaStsPolicyId = null, mtaStsMaxAge = null;
  if (mtaStsRecord) {
    mtaStsPolicyId = (mtaStsRecord.match(/id=([^;\s]+)/) || [])[1] || null;
  }
  if (mtaStsPolicyRaw) {
    mtaStsMode = (mtaStsPolicyRaw.match(/mode:\s*(\S+)/) || [])[1]?.trim() || null;
    mtaStsMaxAge = parseInt((mtaStsPolicyRaw.match(/max_age:\s*(\d+)/) || [])[1] ?? '0') || null;
  }

  const bimiLogoUrl = bimiRecord ? (bimiRecord.match(/l=([^;\s]+)/) || [])[1] || null : null;
  const bimiHasVmc = bimiRecord?.includes('a=') ?? false;

  let issues = 0;
  if (!spfRecord) issues++;
  if (!dmarcRecord) issues++;
  if (!dkimRecord) issues++;
  if (dmarcPolicy === 'none') issues++;
  if (!mtaStsRecord) issues++;
  if (!tlsrptRecord) issues++;

  const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);

  return {
    domain, check_date: now,
    spf_record: spfRecord, spf_valid: !!spfRecord,
    dkim_selector: dkimSelector, dkim_record: dkimRecord, dkim_valid: !!dkimRecord,
    dmarc_record: dmarcRecord, dmarc_valid: !!dmarcRecord, dmarc_policy: dmarcPolicy, dmarc_pct: dmarcPct,
    mta_sts_dns: mtaStsRecord, mta_sts_dns_valid: !!mtaStsRecord,
    mta_sts_mode: mtaStsMode, mta_sts_policy_id: mtaStsPolicyId,
    mta_sts_max_age: mtaStsMaxAge, mta_sts_policy_raw: mtaStsPolicyRaw,
    tlsrpt_record: tlsrptRecord, tlsrpt_valid: !!tlsrptRecord,
    bimi_record: bimiRecord, bimi_valid: !!bimiRecord,
    bimi_logo_url: bimiLogoUrl, bimi_has_vmc: bimiHasVmc,
    issues_count: issues,
  };
}

async function runDnsHealthChecks() {
  const domains = (process.env.DNS_CHECK_DOMAINS || '')
    .split(',').map(d => d.trim()).filter(Boolean);
  if (!domains.length) {
    console.log('[DNS Health] DNS_CHECK_DOMAINS nicht gesetzt, überspringe');
    return;
  }
  const dkimSelector = process.env.DNS_CHECK_DKIM_SELECTOR || 'selector1';

  for (const domain of domains) {
    try {
      const r = await checkDomain(domain, dkimSelector);
      await pool.execute(
        `INSERT INTO dns_health_checks
           (domain, check_date,
            spf_record, spf_valid, dkim_selector, dkim_record, dkim_valid,
            dmarc_record, dmarc_valid, dmarc_policy, dmarc_pct,
            mta_sts_dns, mta_sts_dns_valid, mta_sts_mode, mta_sts_policy_id, mta_sts_max_age, mta_sts_policy_raw,
            tlsrpt_record, tlsrpt_valid, bimi_record, bimi_valid, bimi_logo_url, bimi_has_vmc, issues_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.domain, r.check_date,
          r.spf_record, r.spf_valid ? 1 : 0,
          r.dkim_selector, r.dkim_record, r.dkim_valid ? 1 : 0,
          r.dmarc_record, r.dmarc_valid ? 1 : 0, r.dmarc_policy, r.dmarc_pct,
          r.mta_sts_dns, r.mta_sts_dns_valid ? 1 : 0, r.mta_sts_mode, r.mta_sts_policy_id,
          r.mta_sts_max_age, r.mta_sts_policy_raw,
          r.tlsrpt_record, r.tlsrpt_valid ? 1 : 0,
          r.bimi_record, r.bimi_valid ? 1 : 0, r.bimi_logo_url, r.bimi_has_vmc ? 1 : 0,
          r.issues_count,
        ]
      );
      console.log(`[DNS Health] ${domain}: ${6 - r.issues_count}/6 OK, ${r.issues_count} Problem(e)`);
    } catch (err) {
      console.error(`[DNS Health] Fehler für ${domain}:`, err.message);
    }
  }
}

module.exports = { runDnsHealthChecks, checkDomain };
