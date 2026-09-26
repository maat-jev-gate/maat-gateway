#!/bin/sh
set -eu

app_dir=$1
domain=$2
staging="$app_dir/.incoming"
site="/etc/caddy/sites/$domain.caddy"
backup="$app_dir/.deploy-backups/$(date +%Y%m%d-%H%M%S-%N)"
had_dist=0
had_site=0
committed=0

test -f "$staging/dist/index.html"
test -f "$staging/site.caddy"
mkdir -p "$backup"

if [ -d "$app_dir/dist" ]; then
  mv "$app_dir/dist" "$backup/dist"
  had_dist=1
fi
if [ -f "$site" ]; then
  cp "$site" "$backup/site.caddy"
  had_site=1
fi

rollback() {
  rm -f "$site.tmp"
  if [ "$had_site" -eq 1 ]; then
    cp "$backup/site.caddy" "$site"
  else
    rm -f "$site"
  fi
  rm -rf "$app_dir/dist"
  if [ "$had_dist" -eq 1 ]; then
    mv "$backup/dist" "$app_dir/dist"
  fi
  caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 && systemctl reload caddy || true
}

trap 'if [ "$committed" -ne 1 ]; then rollback; fi' EXIT
mv "$staging/dist" "$app_dir/dist"
cp "$staging/site.caddy" "$site.tmp"
mv "$site.tmp" "$site"
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
committed=1
printf 'Static site activated for %s\n' "$domain"
