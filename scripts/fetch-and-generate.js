const https = require('https');
const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIG — sesuaikan nama repo di sini
// ============================================================
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ORG = 'adsvisory'; // ganti ke nama org baru kalau udah pindah

const REPOS = [
  { name: 'avq-artha',   label: 'Artha' },
  { name: 'avq-astra',   label: 'Astra' },
  { name: 'avq-shastra', label: 'Shastra' },
  { name: 'avq-sutra',   label: 'Sutra' },
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

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildDetailContent(body, commits) {
  if (body && body.trim()) {
    const escaped = escapeHtml(body.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
    return `<div class="detail-body">${escaped}</div>`;
  }
  if (commits && commits.length > 0) {
    const items = commits
      .map(c => `<div class="commit-line"><span class="commit-sha">${escapeHtml(c.sha)}</span>${escapeHtml(c.message)}</div>`)
      .join('');
    return `<div class="detail-commits-label">Dari commit messages:</div><div class="commits-list">${items}</div>`;
  }
  return '<em style="color:var(--muted)">Tidak ada deskripsi PR.</em>';
}

async function fetchPRCommits(repo, prNumber) {
  try {
    const data = await githubRequest(
      `/repos/${ORG}/${repo}/pulls/${prNumber}/commits?per_page=100`
    );
    if (!Array.isArray(data)) return [];
    return data
      .map(c => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0].trim(),
      }))
      .filter(c =>
        c.message.length > 0 &&
        !c.message.startsWith('Merge pull request') &&
        !c.message.startsWith('Merge branch')
      );
  } catch {
    return [];
  }
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
        const fmt = formatDate(pr.merged_at);
        const commits = await fetchPRCommits(repo.name, pr.number);
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
          mergedAtDate: fmt.date,
          mergedAtTime: fmt.time,
          body: pr.body || '',
          commits,
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
  return {
    date: d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    }),
    time: d.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Jakarta',
    }),
  };
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
    'avq-artha':   '#4F8EF7',
    'avq-astra':   '#F7934F',
    'avq-shastra': '#7C4FF7',
    'avq-sutra':   '#4FF7A0',
  };

  const entriesHTML = Object.keys(grouped).sort().reverse().map(monthKey => {
    const { label, entries } = grouped[monthKey];
    const rows = entries.map(e => {
      const color = repoColors[e.repoSlug] || '#aaa';
      const scopeBadge = e.scope ? `<span class="scope">${e.scope}</span>` : '';
      const rowId = `${e.repoSlug}-${e.prNumber}`;
      const bodyContent = buildDetailContent(e.body, e.commits);
      return `
        <tr class="data-row" onclick="toggleDetail('${rowId}')">
          <td class="td-date">
            <div>${e.mergedAtDate}</div>
            <div class="td-time">${e.mergedAtTime}</div>
          </td>
          <td><span class="repo-badge" style="background:${color}20;color:${color};border-color:${color}40">${e.repo}</span></td>
          <td><span class="type-badge">${e.typeLabel}</span></td>
          <td class="td-title">${scopeBadge}${e.title}</td>
          <td class="td-pr">
            <a class="pr-link" href="${e.prUrl}" target="_blank" onclick="event.stopPropagation()">#${e.prNumber}</a>
            <span class="expand-chevron" id="chev-${rowId}">▾</span>
          </td>
        </tr>
        <tr class="detail-row hidden" id="detail-${rowId}">
          <td colspan="5" class="detail-cell">
            ${bodyContent}
          </td>
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
      line-height: 1.5;
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
      overflow: visible;
    }

    .header-left {
      overflow: visible;
      padding-bottom: 0.2em;
    }

    .header-left h1 {
      font-size: clamp(2rem, 5vw, 3.2rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.5;
      overflow: visible;
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

    tbody tr.data-row { cursor: pointer; }
    tbody tr.data-row:hover { background: var(--surface); }

    .detail-row td { padding: 0; border-bottom: none; }
    .detail-cell {
      background: #0a0d13;
      border-bottom: 1px solid var(--border);
      padding: 14px 24px !important;
    }
    .detail-body {
      font-size: 0.82rem;
      color: var(--text);
      white-space: pre-wrap;
      font-family: 'DM Mono', monospace;
      line-height: 1.6;
      max-height: 300px;
      overflow-y: auto;
    }

    .detail-commits-label {
      font-family: 'DM Mono', monospace;
      font-size: 0.7rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 8px;
    }

    .commits-list { display: flex; flex-direction: column; gap: 4px; }

    .commit-line {
      font-family: 'DM Mono', monospace;
      font-size: 0.8rem;
      color: var(--text);
      display: flex;
      gap: 12px;
      align-items: baseline;
    }

    .commit-sha {
      font-size: 0.7rem;
      color: var(--muted);
      flex-shrink: 0;
    }

    .td-pr { white-space: nowrap; }
    .expand-chevron {
      margin-left: 6px;
      color: var(--muted);
      font-size: 0.85rem;
      display: inline-block;
      transition: transform 0.2s;
      user-select: none;
    }
    .expand-chevron.open { transform: rotate(180deg); }

    td {
      padding: 12px 12px;
      vertical-align: middle;
      line-height: 1.5;
    }

    .td-date {
      color: var(--muted);
      font-family: 'DM Mono', monospace;
      font-size: 0.75rem;
      white-space: nowrap;
    }

    .td-time {
      font-family: 'DM Mono', monospace;
      font-size: 0.68rem;
      color: var(--muted);
      opacity: 0.6;
      margin-top: 2px;
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
    const activeLabels = [...document.querySelectorAll('.filter-btn.active')]
      .map(b => b.textContent.trim());

    document.querySelectorAll('tbody tr.data-row').forEach(row => {
      const repoBadge = row.querySelector('.repo-badge');
      if (!repoBadge) return;
      const badgeText = repoBadge.textContent.trim();
      row.classList.toggle('hidden', !activeLabels.includes(badgeText));
    });

    // Collapse all detail rows when filter changes
    document.querySelectorAll('tbody tr.detail-row').forEach(r => r.classList.add('hidden'));
    document.querySelectorAll('.expand-chevron').forEach(c => c.classList.remove('open'));
  }

  function toggleDetail(id) {
    const row = document.getElementById('detail-' + id);
    const chev = document.getElementById('chev-' + id);
    if (!row) return;
    row.classList.toggle('hidden');
    if (chev) chev.classList.toggle('open');
  }
</script>
</body>
</html>`;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});