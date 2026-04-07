// QA Agent — Validates generated HTML sites
// Checks: responsive, SEO, phone click-to-call, content quality
// Returns score + list of issues + auto-fixed HTML

export function validateSite(html, data) {
  const issues = [];
  const checks = [];
  let score = 100;

  // 1. Basic HTML structure
  if (!html.includes('<!DOCTYPE') && !html.includes('<!doctype')) {
    issues.push({ severity: 'high', msg: 'Missing DOCTYPE' });
    score -= 10;
  } else checks.push('DOCTYPE OK');

  if (!html.includes('<meta name="viewport"')) {
    issues.push({ severity: 'high', msg: 'Missing viewport meta (not responsive)' });
    score -= 15;
  } else checks.push('Viewport OK');

  if (!html.includes('charset')) {
    issues.push({ severity: 'medium', msg: 'Missing charset declaration' });
    score -= 5;
  } else checks.push('Charset OK');

  // 2. SEO
  if (!html.includes('<title>')) {
    issues.push({ severity: 'high', msg: 'Missing title tag' });
    score -= 10;
  } else checks.push('Title tag OK');

  if (!html.includes('meta') || !html.includes('description')) {
    issues.push({ severity: 'medium', msg: 'Missing meta description' });
    score -= 5;
  } else checks.push('Meta description OK');

  if (data.commune && !html.toLowerCase().includes(data.commune.toLowerCase())) {
    issues.push({ severity: 'medium', msg: `Commune "${data.commune}" not found in HTML (SEO local)` });
    score -= 5;
  } else checks.push('Local SEO OK');

  // 3. Phone click-to-call
  if (data.telephone) {
    const telClean = data.telephone.replace(/[\s.-]/g, '');
    if (!html.includes('tel:') && !html.includes('click-to-call')) {
      issues.push({ severity: 'high', msg: 'No click-to-call link for phone number' });
      score -= 10;
    } else checks.push('Click-to-call OK');

    if (!html.includes(data.telephone) && !html.includes(telClean)) {
      issues.push({ severity: 'high', msg: 'Phone number not visible on page' });
      score -= 10;
    } else checks.push('Phone visible OK');
  }

  // 4. Responsive
  if (!html.includes('@media') && !html.includes('media screen')) {
    issues.push({ severity: 'high', msg: 'No media queries (not responsive)' });
    score -= 15;
  } else checks.push('Media queries OK');

  if (!html.includes('max-width') && !html.includes('flex') && !html.includes('grid')) {
    issues.push({ severity: 'medium', msg: 'No flex/grid layout detected' });
    score -= 5;
  } else checks.push('Layout system OK');

  // 5. Content quality
  if (data.nom_commerce && !html.includes(data.nom_commerce)) {
    issues.push({ severity: 'high', msg: `Commerce name "${data.nom_commerce}" not in HTML` });
    score -= 10;
  } else checks.push('Commerce name OK');

  if (html.includes('Lorem ipsum') || html.includes('lorem ipsum')) {
    issues.push({ severity: 'medium', msg: 'Contains Lorem ipsum placeholder text' });
    score -= 5;
  } else checks.push('No Lorem ipsum OK');

  // 6. Schema.org
  if (!html.includes('schema.org') && !html.includes('application/ld+json')) {
    issues.push({ severity: 'low', msg: 'Missing Schema.org structured data' });
    score -= 3;
  } else checks.push('Schema.org OK');

  // 7. Performance
  const sizeKb = Math.round(html.length / 1024);
  if (sizeKb > 200) {
    issues.push({ severity: 'medium', msg: `HTML too large: ${sizeKb}KB (target < 200KB)` });
    score -= 5;
  } else checks.push(`Size OK (${sizeKb}KB)`);

  // 8. Google Fonts
  if (!html.includes('fonts.googleapis.com')) {
    issues.push({ severity: 'low', msg: 'No Google Fonts loaded' });
    score -= 2;
  } else checks.push('Google Fonts OK');

  // 9. French content
  const frenchWords = ['accueil', 'contact', 'propos', 'services', 'horaires', 'bienvenue', 'notre', 'votre'];
  const frenchCount = frenchWords.filter(w => html.toLowerCase().includes(w)).length;
  if (frenchCount < 3) {
    issues.push({ severity: 'medium', msg: 'Content may not be in French' });
    score -= 10;
  } else checks.push(`French content OK (${frenchCount}/8 markers)`);

  // 10. CTA buttons
  const ctaPatterns = ['réserver', 'commander', 'contacter', 'appeler', 'devis', 'rendez-vous', 'rdv'];
  const hasCta = ctaPatterns.some(p => html.toLowerCase().includes(p));
  if (!hasCta) {
    issues.push({ severity: 'medium', msg: 'No clear CTA button found' });
    score -= 5;
  } else checks.push('CTA OK');

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    passed: score >= 70,
    issues,
    checks,
    summary: `QA Score: ${score}/100 | ${checks.length} passed | ${issues.length} issues`
  };
}

// Auto-fix common issues
export function autoFix(html, data) {
  let fixed = html;

  // Add viewport if missing
  if (!fixed.includes('viewport') && fixed.includes('<head>')) {
    fixed = fixed.replace('<head>', '<head>\n<meta name="viewport" content="width=device-width, initial-scale=1.0">');
  }

  // Add charset if missing
  if (!fixed.includes('charset') && fixed.includes('<head>')) {
    fixed = fixed.replace('<head>', '<head>\n<meta charset="UTF-8">');
  }

  // Add click-to-call if phone exists but no tel: link
  if (data.telephone && !fixed.includes('tel:')) {
    const tel = data.telephone.replace(/[\s.-]/g, '');
    const callButton = `
<a href="tel:${tel}" style="position:fixed;bottom:20px;right:20px;z-index:9999;background:#C0784A;color:#fff;width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;box-shadow:0 4px 12px rgba(0,0,0,0.3);text-decoration:none;" aria-label="Appeler">&#9742;</a>`;
    fixed = fixed.replace('</body>', callButton + '\n</body>');
  }

  return fixed;
}

// API endpoint for manual QA check
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { html, data } = req.body;
  if (!html) return res.status(400).json({ error: 'html required' });

  const result = validateSite(html, data || {});
  const fixed = autoFix(html, data || {});
  const fixedResult = validateSite(fixed, data || {});

  return res.status(200).json({
    original: result,
    fixed: fixedResult,
    improved: fixedResult.score > result.score,
    delta: fixedResult.score - result.score
  });
}
