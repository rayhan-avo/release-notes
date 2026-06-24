const https = require('https');
const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIG — sesuaikan nama repo di sini
// ============================================================
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ORG = 'adsvisory'; // ganti ke nama org baru kalau udah pindah

const REPOS = [
  { name: 'artha',   label: 'Artha' },
  { name: 'astra',   label: 'Astra' },
  { name: 'shastra', label: 'Shastra' },
  { name: 'sutra',   label: 'Sutra' },
  // tambah repo baru di sini:
  // { name: 'nama-repo', label: 'Label Tampil' },
];

const DAYS_BACK = 90; // ambil PR dari 90 hari terakhir
// ============================================================

function githubRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'adsvisory-changelog-bot',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`GitHub API error ${res.statusCode}: ${data}`));
          return;
        }
        resolve(JSON.parse(data));
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function cleanTitle(title) {
  // Parse conventional commits
  const conventionalMatch = title.match(/^(feat|fix|chore|docs|refactor|style|test|perf|ci|build|revert)(\([^)]+\))?:\s*(.+)/i);
  if (conventionalMatch) {
    const type = conventionalMatch[1].toLowerCase();
    const scope = conventionalMatch[2] ? conventionalMatch[2].replace(/[()]/g, '') : null;
    const desc = conventionalMatch[3].trim();
    return { type, scope, description: capitalize(desc), isConventional: true };
  }

  // Branch-name style PR (Fix/env, Fix/Login-Artha) — ini "internal"
  if (/^[A-Za-z]+\/[A-Za-z0-9-_]+$/.test(title.trim())) {
    return { type: 'internal', scope: null, description: 'Internal update', isConventional: false };
  }

  // Freestyle — tampil as-is
  return { type: 'update', scope: null, description: capitalize(title.trim()), isConventional: false };
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function typeToLabel(type) {
  const map = {
    feat: '✨ Fitur Baru',
    fix: '🐛 Perbaikan',
    chore: '🔧 Internal',
    docs: '📝 Dokumentasi',
    refactor: '♻️ Refactor',
    style: '🎨 Tampilan',
    test: '🧪 Testing',
    perf: '⚡ Performa',
    internal: '🔧 Internal',
    update: '📦 Update',
  };
  return map[type] || '📦 Update';
}

async function fetchMergedPRs(repo) {
  const since = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000).toISOString();
  const prs = [];
  let page = 1;

  while (true) {
    const data = await githubRequest(
      `/repos/${ORG}/${repo}/pulls?state=closed&base=main&per_page=100&page=${page}&sort=updated&direction=desc`
    );

    if (!Array.isArray(data) || data.length === 0) break;

    const merged = data.filter(pr =>
      pr.merged_at &&
      new Date(pr.merged_at) >= new Date(since)
    );

    prs.push(...merged);

    // kalau semua PR di halaman ini udah lebih lama dari since, stop
    const oldest = data[data.length - 1];
    if (!oldest.merged_at || new Date(oldest.merged_at) < new Date(since)) break;

    page++;
  }

  return prs;
}

async function main() {
  console.log('🔍 Fetching PRs from all repos...\n');

  const allEntries = [];

  for (const repo of REPOS) {
    try {
      console.log(`  → ${repo.label} (${repo.name})`);
      const prs = await fetchMergedPRs(repo.name);
      console.log(`     ${prs.length} merged PR(s) ditemukan`);

      for (const pr of prs) {
        const parsed = cleanTitle(pr.title);
        allEntries.push({
          repo: repo.label,
          repoSlug: repo.name,
          prNumber: pr.number,
          prUrl: pr.html_url,
          title: parsed.description,
          type: parsed.type,
          typeLabel: typeToLabel(parsed.type),
          scope: parsed.scope,
          author: pr.user?.login || 'unknown',
          mergedAt: pr.merged_at,
          mergedAtFormatted: formatDate(pr.merged_at),
        });
      }
    } catch (err) {
      console.error(`  ✗ Gagal fetch ${repo.name}: ${err.message}`);
    }
  }

  // Sort by mergedAt descending
  allEntries.sort((a, b) => new Date(b.mergedAt) - new Date(a.mergedAt));

  console.log(`\n✅ Total: ${allEntries.length} PR(s) dari ${REPOS.length} repo`);

  // Generate HTML
  const distDir = path.join(__dirname, '..', 'dist');
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

  const html = generateHTML(allEntries);
  fs.writeFileSync(path.join(distDir, 'index.html'), html, 'utf8');

  // Simpan raw data juga (optional, buat debugging)
  fs.writeFileSync(path.join(distDir, 'data.json'), JSON.stringify(allEntries, null, 2), 'utf8');

  console.log('📄 index.html generated di dist/');
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function generateHTML(entries) {
  const generatedAt = new Date().toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'
  });

  // Group by month
  const grouped = {};
  for (const entry of entries) {
    const d = new Date(entry.mergedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    if (!grouped[key]) grouped[key] = { label, entries: [] };
    grouped[key].entries.push(entry);
  }

  const repoColors = {
    'artha':   '#4F8EF7',
    'astra':   '#F7934F',
    'shastra': '#7C4FF7',
    'sutra':   '#4FF7A0',
  };

  const entriesHTML = Object.keys(grouped).sort().reverse().map(monthKey => {
    const { label, entries } = grouped[monthKey];
    const rows = entries.map(e => {
      const color = repoColors[e.repoSlug] || '#aaa';
      const scopeBadge = e.scope ? `<span class="scope">${e.scope}</span>` : '';
      return `
        <tr>
          <td class="td-date">${e.mergedAtFormatted}</td>
          <td><span class="repo-badge" style="background:${color}20;color:${color};border-color:${color}40">${e.repo}</span></td>
          <td><span class="type-badge">${e.typeLabel}</span></td>
          <td class="td-title">${scopeBadge}${e.title}</td>
          <td><a class="pr-link" href="${e.prUrl}" target="_blank">#${e.prNumber}</a></td>
        </tr>`;
    }).join('');

    return `
      <div class="month-group">
        <h2 class="month-header">${label}</h2>
        <table>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Produk</th>
              <th>Tipe</th>
              <th>Perubahan</th>
              <th>PR</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  const repoFilterButtons = REPOS.map(r => {
    const color = repoColors[r.name] || '#aaa';
    return `<button class="filter-btn active" data-repo="${r.name}" style="--c:${color}" onclick="toggleFilter(this)">${r.label}</button>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Changelog — Adsvisory</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0d0f14;
      --surface: #13161e;
      --border: #1e2330;
      --text: #e8eaf0;
      --muted: #5a6070;
      --accent: #4F8EF7;
    }

    body {
      font-family: 'Syne', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 0 0 80px;
    }

    /* HEADER */
    header {
      padding: 56px 48px 40px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 24px;
      flex-wrap: wrap;
    }

    .header-left h1 {
      font-size: clamp(2rem, 5vw, 3.2rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1;
    }

    .header-left h1 span {
      color: var(--accent);
    }

    .header-left p {
      margin-top: 10px;
      color: var(--muted);
      font-size: 0.9rem;
      font-family: 'DM Mono', monospace;
    }

    .header-right {
      font-family: 'DM Mono', monospace;
      font-size: 0.75rem;
      color: var(--muted);
      text-align: right;
    }

    /* FILTERS */
    .filters {
      padding: 24px 48px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      border-bottom: 1px solid var(--border);
      align-items: center;
    }

    .filters-label {
      font-size: 0.75rem;
      color: var(--muted);
      font-family: 'DM Mono', monospace;
      margin-right: 4px;
    }

    .filter-btn {
      background: transparent;
      border: 1px solid var(--c, #4F8EF7);
      color: var(--c, #4F8EF7);
      padding: 5px 14px;
      border-radius: 99px;
      font-family: 'Syne', sans-serif;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      opacity: 0.35;
    }

    .filter-btn.active {
      background: color-mix(in srgb, var(--c, #4F8EF7) 12%, transparent);
      opacity: 1;
    }

    /* CONTENT */
    .content { padding: 0 48px; }

    .month-group { margin-top: 48px; }

    .month-header {
      font-size: 1rem;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 16px;
      font-family: 'DM Mono', monospace;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    thead tr {
      border-bottom: 1px solid var(--border);
    }

    th {
      text-align: left;
      padding: 8px 12px;
      font-size: 0.7rem;
      color: var(--muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-family: 'DM Mono', monospace;
    }

    tbody tr {
      border-bottom: 1px solid var(--border);
      transition: background 0.1s;
    }

    tbody tr:hover { background: var(--surface); }

    td {
      padding: 12px 12px;
      vertical-align: middle;
    }

    .td-date {
      color: var(--muted);
      font-family: 'DM Mono', monospace;
      font-size: 0.75rem;
      white-space: nowrap;
    }

    .repo-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 99px;
      border: 1px solid;
      font-size: 0.75rem;
      font-weight: 700;
      white-space: nowrap;
    }

    .type-badge {
      white-space: nowrap;
      font-size: 0.78rem;
      color: var(--muted);
    }

    .td-title { font-weight: 600; }

    .scope {
      display: inline-block;
      background: #ffffff10;
      color: var(--muted);
      font-family: 'DM Mono', monospace;
      font-size: 0.7rem;
      padding: 1px 6px;
      border-radius: 4px;
      margin-right: 6px;
    }

    .pr-link {
      color: var(--muted);
      font-family: 'DM Mono', monospace;
      font-size: 0.78rem;
      text-decoration: none;
      transition: color 0.15s;
    }

    .pr-link:hover { color: var(--accent); }

    tr.hidden { display: none; }

    /* EMPTY STATE */
    .empty { padding: 80px 48px; text-align: center; color: var(--muted); }

    /* RESPONSIVE */
    @media (max-width: 640px) {
      header, .filters, .content { padding-left: 20px; padding-right: 20px; }
      th:nth-child(1), td:nth-child(1),
      th:nth-child(5), td:nth-child(5) { display: none; }
    }
  </style>
</head>
<body>

<header>
  <div class="header-left">
    <h1>Change<span>log</span></h1>
    <p>// semua perubahan produk adsvisory dalam satu tempat</p>
  </div>
  <div class="header-right">
    Diperbarui otomatis<br>${generatedAt} WIB
  </div>
</header>

<div class="filters">
  <span class="filters-label">filter:</span>
  ${repoFilterButtons}
</div>

<div class="content">
  ${entriesHTML || '<div class="empty">Belum ada data changelog.</div>'}
</div>

<script>
  function toggleFilter(btn) {
    btn.classList.toggle('active');
    applyFilters();
  }

  function applyFilters() {
    const activeRepos = [...document.querySelectorAll('.filter-btn.active')]
      .map(b => b.dataset.repo);

    document.querySelectorAll('tbody tr').forEach(row => {
      const repoBadge = row.querySelector('.repo-badge');
      if (!repoBadge) return;
      const repoSlug = repoBadge.textContent.trim().toLowerCase();
      // match by label — find the repo config
      const match = activeRepos.some(slug => {
        const badge = row.querySelector(\`.repo-badge\`);
        return badge && badge.style.color && row.querySelector(\`[data-repo-slug="${activeRepos}"]\`);
      });
      // simpler: hide row if no active filter matches the badge text
      const badgeText = repoBadge.textContent.trim();
      const isActive = activeRepos.some(slug => {
        const btn = document.querySelector(\`[data-repo="\${slug}"]\`);
        return btn && btn.textContent.trim() === badgeText;
      });
      row.classList.toggle('hidden', !isActive);
    });
  }
</script>
</body>
</html>`;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
