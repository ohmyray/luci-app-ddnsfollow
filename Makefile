include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-ddnsfollow
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=ohmyray

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-ddnsfollow
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=IPv6 NDP proxy auto-follow for DDNS
  DEPENDS:=+luci-base +cron +bind-dig
  PKGARCH:=all
endef

define Package/luci-app-ddnsfollow/description
  Keeps NDP proxy entries and /128 routes in sync with the AAAA records of a
  DDNS domain, so LAN clients can reach the upstream CPE address without
  hitting the on-link black hole. Survives prefix and address drift.
endef

define Build/Compile
endef

define Package/luci-app-ddnsfollow/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./src/usr/bin/ddns-follow $(1)/usr/bin/
	$(INSTALL_BIN) ./src/usr/bin/ddns-follow-status $(1)/usr/bin/
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./src/etc/config/ddnsfollow $(1)/etc/config/
	$(INSTALL_DIR) $(1)/etc/hotplug.d/iface
	$(INSTALL_BIN) ./src/etc/hotplug.d/iface/95-lan6-prefix $(1)/etc/hotplug.d/iface/
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./src/etc/uci-defaults/99-ddnsfollow $(1)/etc/uci-defaults/
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./src/usr/share/luci/menu.d/luci-app-ddnsfollow.json $(1)/usr/share/luci/menu.d/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./src/usr/share/rpcd/acl.d/luci-app-ddnsfollow.json $(1)/usr/share/rpcd/acl.d/
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/ddnsfollow
	$(INSTALL_DATA) ./src/www/luci-static/resources/view/ddnsfollow/overview.js $(1)/www/luci-static/resources/view/ddnsfollow/
endef

$(eval $(call BuildPackage,luci-app-ddnsfollow))
