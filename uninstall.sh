#!/bin/sh
# 卸载程序与定时任务，保留 /etc/config/ddnsfollow
set -e

LAN_IF=$(uci -q get ddnsfollow.settings.lan_iface)
[ -n "$LAN_IF" ] || LAN_IF=br-lan

for a in $(ip -6 neigh show proxy dev "$LAN_IF" 2>/dev/null | awk '{print $1}'); do
    ip -6 neigh del proxy "$a" dev "$LAN_IF" 2>/dev/null || true
    ip -6 route del "$a/128" 2>/dev/null || true
    echo "removed proxy $a"
done

sed -i '/ddns-follow/d' /etc/crontabs/root 2>/dev/null || true
/etc/init.d/cron restart 2>/dev/null || true

rm -f /usr/bin/ddns-follow
rm -f /usr/bin/ddns-follow-status
rm -f /usr/share/luci/menu.d/luci-app-ddnsfollow.json
rm -f /usr/share/rpcd/acl.d/luci-app-ddnsfollow.json
rm -f /www/luci-static/resources/view/ddnsfollow/overview.js
rmdir /www/luci-static/resources/view/ddnsfollow 2>/dev/null || true

/etc/init.d/rpcd restart 2>/dev/null || true
rm -f /tmp/luci-indexcache* 2>/dev/null || true

echo "removed. 配置保留在 /etc/config/ddnsfollow"
