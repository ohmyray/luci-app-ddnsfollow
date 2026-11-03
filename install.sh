#!/bin/sh
# 直接安装到运行中的 OpenWrt 设备（在本机 root 下执行）
set -e

SRC="$(cd "$(dirname "$0")" && pwd)/src"
[ -d "$SRC" ] || { echo "src/ not found" >&2; exit 1; }

cd "$SRC"
find . -type f | while read -r f; do
    dest="/${f#./}"
    case "$dest" in
        /etc/config/*)
            if [ -f "$dest" ]; then
                echo "skip $dest (exists)"
                continue
            fi
            ;;
    esac
    mkdir -p "$(dirname "$dest")"
    cp "$f" "$dest"
    echo "installed $dest"
done

chmod +x /usr/bin/ddns-follow /usr/bin/ddns-follow-status \
    /etc/hotplug.d/iface/95-lan6-prefix 2>/dev/null || true

if ! grep -q ddns-follow /etc/crontabs/root 2>/dev/null; then
    echo "* * * * * /usr/bin/ddns-follow >/dev/null 2>&1" >>/etc/crontabs/root
    echo "cron added"
fi

/etc/init.d/cron enable 2>/dev/null || true
/etc/init.d/cron restart 2>/dev/null || true
/etc/init.d/rpcd restart 2>/dev/null || true
rm -f /tmp/luci-indexcache* 2>/dev/null || true

echo
echo "done. LuCI: 服务 -> DDNS IPv6 跟随"
