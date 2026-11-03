#!/bin/bash
# 纯 shell 构造 ipk，无需 OpenWrt SDK（本包架构无关，不含编译产物）
# 用法: ./scripts/build-ipk.sh [version]   默认 0.0.0
set -euo pipefail

NAME=luci-app-ddnsfollow
VERSION="${1:-0.0.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
DATA="$BUILD/data"
CTRL="$BUILD/control"

rm -rf "$BUILD"
mkdir -p "$DATA" "$CTRL"

# ---- data ----
cp -r "$ROOT/src/." "$DATA/"
chmod 0755 "$DATA/usr/bin/ddns-follow" \
           "$DATA/usr/bin/ddns-follow-status" \
           "$DATA/etc/hotplug.d/iface/95-lan6-prefix" \
           "$DATA/etc/uci-defaults/99-ddnsfollow"
find "$DATA" -type d -exec chmod 0755 {} +

# ---- control ----
cat >"$CTRL/control" <<EOF
Package: $NAME
Version: $VERSION
Depends: luci-base, cron, bind-dig
Architecture: all
Maintainer: ohmyray
Section: luci
Priority: optional
Description: IPv6 NDP proxy auto-follow for DDNS domains
 Keeps NDP proxy entries and /128 routes in sync with the AAAA records
 of a DDNS domain so that LAN clients can reach the upstream CPE address
 without hitting the on-link black hole. Survives prefix and address drift.
EOF

printf '/etc/config/ddnsfollow\n' >"$CTRL/conffiles"

cat >"$CTRL/postinst" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] && exit 0

grep -q ddns-follow /etc/crontabs/root 2>/dev/null || \
    echo "* * * * * /usr/bin/ddns-follow >/dev/null 2>&1" >>/etc/crontabs/root

/etc/init.d/cron enable 2>/dev/null
/etc/init.d/cron restart 2>/dev/null
/etc/init.d/rpcd restart 2>/dev/null
rm -f /tmp/luci-indexcache* 2>/dev/null

exit 0
EOF
chmod 0755 "$CTRL/postinst"

cat >"$CTRL/prerm" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] && exit 0

sed -i '/ddns-follow/d' /etc/crontabs/root 2>/dev/null
/etc/init.d/cron restart 2>/dev/null

exit 0
EOF
chmod 0755 "$CTRL/prerm"

# ---- pack ----
cd "$CTRL"
tar -czf "$BUILD/control.tar.gz" ./*
cd "$DATA"
tar -czf "$BUILD/data.tar.gz" ./*
cd "$BUILD"
printf '2.0\n' >debian-binary

OUT="${NAME}_${VERSION}_all.ipk"
ar r "$OUT" debian-binary control.tar.gz data.tar.gz

echo "built: $BUILD/$OUT"
ls -lh "$OUT"
