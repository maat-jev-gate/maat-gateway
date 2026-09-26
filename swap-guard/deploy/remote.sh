#!/usr/bin/env bash
set -euo pipefail

domain="$1"
port="$2"
app_dir=/opt/maat-swap-guard
site="/etc/caddy/sites/${domain}.caddy"
backup_dir="${app_dir}/.deploy-backups/$(date +%Y%m%d-%H%M%S)"

test "$domain" = "$(sed -n '1s/ {//p' "${app_dir}/deploy/site.caddy.next")"
test -f "${app_dir}/.next/BUILD_ID"
test -f "${app_dir}/.env"
test -f "${app_dir}/package-lock.json"
if pm2 describe maat-swap-guard >/dev/null 2>&1; then
  current_dir="$(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const p=JSON.parse(s).find(x=>x.name==="maat-swap-guard");process.stdout.write(p?.pm2_env.pm_cwd ?? "")})')"
  test "$current_dir" = "$app_dir"
fi

mkdir -p "$backup_dir" /etc/caddy/sites
if test -f "$site"; then cp "$site" "$backup_dir/site.caddy"; fi
if test -f "${app_dir}/.env"; then chmod 600 "${app_dir}/.env"; fi

cd "$app_dir"
npm ci --omit=dev
cp deploy/site.caddy.next "$site"
if ! caddy validate --config /etc/caddy/Caddyfile; then
  if test -f "$backup_dir/site.caddy"; then
    cp "$backup_dir/site.caddy" "$site"
  else
    rm "$site"
  fi
  exit 1
fi
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
systemctl reload caddy

ready=0
for attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${port}/api/state" >/dev/null; then ready=1; break; fi
  sleep 1
done
if test "$ready" -ne 1; then
  pm2 logs maat-swap-guard --lines 40 --nostream >&2 || true
  exit 1
fi
pm2 describe maat-swap-guard >/dev/null
echo "Swap Guard is ready on port ${port}."
