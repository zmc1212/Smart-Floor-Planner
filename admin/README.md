# Admin

Next.js 16 App Router application for Smart Floor Planner administration.

## Local development

```powershell
cd admin
npm install
npm run dev
```

Open `http://localhost:3006`. The application requires the repository's
configured PostgreSQL and provider environment variables for authenticated
business flows.

## Production release

On Windows, `release.bat` builds `release/sfp-admin-release.zip` and copies
`auto_deploy.sh` beside it. The image is packed as `sfp-admin.tar` inside the
ZIP; Docker Hub push is skipped because production deploy loads that tar.
Alpine `apk` uses `mirrors.aliyun.com` because `dl-cdn.alpinelinux.org` often
fails TLS from China during `libc6-compat` / CJK font install.

Upload the ZIP to the server directory that already holds the previous extract
(for example `/datas/smartfloor`). First time only, also upload `auto_deploy.sh`
to that same directory and run `chmod +x auto_deploy.sh`. After each later ZIP
upload, run `./auto_deploy.sh`. That script overwrites the previous extract
without an unzip prompt, makes `sfp-admin-release/deploy.sh` executable, and
starts the existing Compose deploy. Windows ZIP warnings about backslash path
separators are ignored; only a real unzip failure stops the script.

## Runtime references

- Current module map: `../docs/admin-system-modules.md`
- Admin visual rules: `DESIGN.md`
- Tenant/auth and contribution rules: `../AGENTS.md` and `AGENTS.md`
