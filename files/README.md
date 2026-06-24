# 📋 Adsvisory Changelog

Dokumen changelog otomatis yang ngumpulin semua merged PR dari repo-repo Adsvisory ke satu halaman web.

🔗 **Live:** `https://[username-lo].github.io/changelog`

---

## Setup (sekali doang)

### 1. Bikin repo baru di GitHub
Buat repo baru di akun/org lo, nama misalnya `changelog`. Set visibility ke **Public**.

### 2. Push code ini ke repo tersebut
```bash
git init
git add .
git commit -m "feat: init changelog"
git remote add origin https://github.com/[username-lo]/changelog.git
git push -u origin main
```

### 3. Bikin Personal Access Token (PAT)
1. Buka GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
2. Klik **Generate new token (classic)**
3. Centang scope: `repo` (full)
4. Copy token-nya

### 4. Tambah token ke repo secrets
1. Di repo `changelog`, buka **Settings** → **Secrets and variables** → **Actions**
2. Klik **New repository secret**
3. Name: `CHANGELOG_PAT`
4. Value: paste token tadi

### 5. Aktifkan GitHub Pages
1. Di repo `changelog`, buka **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `gh-pages` / `/ (root)`
4. Save

### 6. Jalankan manual pertama kali
1. Buka tab **Actions** di repo
2. Klik workflow **Generate Changelog**
3. Klik **Run workflow**
4. Tunggu selesai (~1-2 menit)
5. Buka `https://[username-lo].github.io/changelog` ✅

---

## Konfigurasi

Edit bagian CONFIG di `scripts/fetch-and-generate.js`:

```js
const ORG = 'adsvisory';       // nama org/akun GitHub

const REPOS = [
  { name: 'artha',   label: 'Artha' },
  { name: 'astra',   label: 'Astra' },
  { name: 'shastra', label: 'Shastra' },
  { name: 'sutra',   label: 'Sutra' },
  // tambah repo baru:
  // { name: 'nama-repo', label: 'Label Tampil' },
];

const DAYS_BACK = 90; // berapa hari ke belakang yang diambil
```

---

## Jadwal otomatis

Changelog di-generate otomatis setiap **hari jam 00.00 WIB**.

Kalau mau ubah jadwal, edit file `.github/workflows/changelog.yml`:
```yaml
- cron: '0 17 * * *'   # 17.00 UTC = 00.00 WIB
```

---

## Trigger dari repo lain (opsional)

Kalau mau changelog langsung update setiap ada PR merge di repo lain,
tambahkan workflow ini di repo `artha`, `astra`, dll:

```yaml
# .github/workflows/trigger-changelog.yml
name: Trigger Changelog Update

on:
  pull_request:
    types: [closed]
    branches: [main]

jobs:
  trigger:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - name: Trigger changelog repo
        uses: peter-evans/repository-dispatch@v3
        with:
          token: ${{ secrets.CHANGELOG_PAT }}
          repository: [username-lo]/changelog
          event-type: pr-merged
```

---

## Pindah ke org baru?

Cukup update 1 baris di `scripts/fetch-and-generate.js`:
```js
const ORG = 'nama-org-baru';
```

Lalu update juga token PAT-nya kalau akses org berbeda.
