# NAT66 + NDP 代答 产品化方案

从「能跑的原型」到「可交付、可开关、可观测、可回滚」的完整规格。

- 适用硬件基线：ImmortalWRT SNAPSHOT（aarch64）+ 中兴 5G CPE 5G CPE
- 文档状态：P0 / P1 已上线（2026-11-03 实施并验收），P2 部分完成
- 数据来源：2026-11-03 实测

---

## 1. 问题界定

### 1.1 不可协商的约束（全部实测）

| 约束 | 实测证据 | 影响 |
| --- | --- | --- |
| 上游 IPv4 是 CGNAT | WAN `10.2.x.x`，出口公网为运营商共享地址 | IPv4 入站永久无解 |
| 无前缀委派（PD） | `ubus ... wan6 status` 的 `ipv6-prefix` 恒为 `[]`；CPE 上**没有任何 DHCPv6 客户端进程**；给 `ff02::1:2` 发 Solicit（IA_NA + IA_PD）**零回应** | 子路由永远拿不到独立前缀 |
| 单条 /64 且被 CPE 占用 | CPE `br0` 有 `前缀::7d/64`，WAN 口 `sipa_eth0` 有 `前缀::aaaa:.../64` | LAN 只能复用这条 /64 |
| 前缀会漂移 | 一天内观测到 `660:6fe5` → `640:6082` → `670:65d` 三次 | 任何写死地址的方案都会失效 |
| CPE 不提供管理接口 | `adb root` 不可用（`ro.build.type=user`），`su` 需授权，无包管理器 | 无法在上游做任何改造 |

### 1.2 目标

1. 内网设备获得可用的公网 IPv6 出口（访问 IPv6 互联网）
2. 内网通过域名访问自身服务时不因「同 /64 的 on-link 黑洞」而超时
3. 前缀/地址漂移后**无人值守自动恢复**，恢复时间有明确上界
4. 每一项能力都能独立开关、独立回滚

### 1.3 非目标（明确不做）

- ❌ 让下游拿到 PD 委派（上游无此能力，已实测到底）
- ❌ 端到端 IPv6 可达（CGNAT + 无 PD，不成立）
- ❌ 无公网 IPv6 入站（对外访问统一走 Lucky 隧道）

---

## 2. 功能覆盖范围与分层

按「不启用的后果」分三层，产品交付时必须至少满足 L0 + L1。

### 2.1 L0 核心能力 —— 不开就不通

| ID | 能力 | 实现要点 | 关闭后果 |
| --- | --- | --- | --- |
| L0-1 | IPv6 上游接入 | `wan6` 走 DHCPv6 客户端（实际靠 SLAAC 拿地址 + RA 学默认路由） | 无 IPv6 |
| L0-2 | LAN 前缀供给 | `br-lan` 配 `前缀::1/64`，并加 `前缀::/64 dev br-lan metric 100` | LAN 设备无 GUA |
| L0-3 | IPv6 转发 | `net.ipv6.conf.all.forwarding=1` | 跨网段不通 |
| L0-4 | NAT66 | `firewall.@zone[wan].masq6='1'` | LAN 出站断（前缀不被上游认可） |
| L0-5 | 防火墙放行 | zone `wan` 覆盖 `wan wan6`；保留 `Allow-DHCPv6`、`Allow-ICMPv6-*`、`Allow-MLD` | RA/DHCPv6/ICMPv6 被丢 |

### 2.2 L1 稳定性能力 —— 不开会间歇性故障

| ID | 能力 | 实现要点 | 关闭后果 |
| --- | --- | --- | --- |
| L1-1 | NDP 代答 | `proxy_ndp=1` + `ip -6 neigh add proxy <DDNS地址> dev br-lan` + `<地址>/128 via <上游LL> dev wan` | 内网访问自身域名超时 |
| L1-2 | 代答目标自动跟随 | `/usr/bin/ddns-follow` + cron `*/2` | 前缀漂移后需人工修 |
| L1-3 | 前缀漂移自愈 | hotplug `95-lan6-prefix`（wan6 ifup/ifupdate 触发） | 前缀变了 LAN 失联直到重启 |

### 2.3 L2 可选能力 —— 体验增强

| ID | 能力 | 价值 | 默认 |
| --- | --- | --- | --- |
| L2-1 | LuCI 可视化页 | 看状态、手动同步、读日志 | 开 |
| L2-2 | 内网 DNS 覆盖 | 走 IPv4 路径回退，不依赖 NDP | 关（需先解决终端 DNS 被劫持） |
| L2-3 | 多域名跟随 | 一个实例跟多个 DDNS 名 | 关 |
| L2-4 | 变更告警 | 前缀漂移/解析失败时推送通知 | 关 |
| L2-5 | 全 /64 NDP 代理（ndppd） | 后缀任意变化都能通 | 关（与 L1-1 二选一） |

> L2-5 是 L1-1 的替代实现：`ndppd` 代理整段 `/64` 而非单条地址，优点是后缀变化免维护，缺点是要装包、且会让整个 /64 的地址在内网看起来都"可达"。

---

## 3. 配置项设计

统一进 `/etc/config/ddnsfollow`，全部支持 UCI 读写、LuCI 表单绑定。

### 3.1 主开关

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `ddnsfollow.settings.enabled` | bool | `1` | 总开关。关掉后 cron 空转、不修改任何内核状态 |
| `ddnsfollow.settings.mode` | enum | `proxy` | `proxy`=单地址代答；`ndppd`=整段代理（需装 ndppd） |

### 3.2 目标与探测

| 键 | 类型 | 默认 | 适用场景 |
| --- | --- | --- | --- |
| `settings.domain` | string | `ddns.example.com` | 要跟随的域名 |
| `settings.probe_dns` | list | `223.5.5.5 2400:3200::1 119.29.29.29` | 依次尝试，全部失败视为解析失败 |
| `settings.record_type` | enum | `AAAA` | 只在双栈环境切 `A` |
| `settings.interval` | string | `2m` | 改这个要同步改 cron（由 LuCI 写入 crontab） |
| `settings.timeout` | int | `3` | 单次 DNS 查询超时（秒） |

### 3.3 接口绑定

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `settings.lan_iface` | string | `br-lan` | 代答挂载的接口 |
| `settings.wan_iface` | string | `wan` | `/128` 路由出接口 |
| `settings.upstream_gw` | string | 自动 | 留空则从 `ip -6 route show default` 的 `via` 取 |

### 3.4 行为策略（关键，决定故障时的表现）

| 键 | 类型 | 默认 | 关闭/改值后的行为 |
| --- | --- | --- | --- |
| `settings.strict_prefix` | bool | `1` | 开：DDNS 前缀与 `br-lan` 前缀不一致时**跳过本轮**（等 DDNS 追上）。关：强行改，可能指向不存在的地址 |
| `settings.keep_stale` | bool | `1` | 开：解析失败时保留现有代答。关：清空条目（会导致内网立刻不通） |
| `settings.clean_others` | bool | `1` | 开：删除非目标地址的代答条目。关：只增不删（多域名场景要关） |
| `settings.manage_lan_addr` | bool | `0` | 开：允许脚本自己补 `br-lan` 的 `前缀::1/64`（单路由形态需要） |
| `settings.log_max_lines` | int | `500` | 日志超过即轮转，防 `/tmp` 占满 |

### 3.5 关联的系统项（不属于本应用，但要一起交付）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `firewall.@zone[1].masq6` | `1` | NAT66 总闸 |
| `dhcp.lan.ra` | `server` | LAN 发 RA |
| `dhcp.lan.dhcpv6` | `disabled` | 不发 DHCPv6（无前缀可分） |
| `dhcp.lan.ndp` | `disabled` | 不用 odhcpd 的 relay（会动 RA，风险高） |
| `net.ipv6.conf.br-lan.proxy_ndp` | `1` | 代答前提 |

### 3.6 开关组合的推荐配置

| 场景 | 配置 |
| --- | --- |
| 单域名、有子路由（当前） | 默认值全开，`manage_lan_addr=0` |
| 多域名 | `clean_others=0`，`manage_lan_addr=0` |
| 单路由直连 CPE | `manage_lan_addr=1`（无 hotplug 脚本管前缀） |
| 调试试错期 | `keep_stale=1` + `strict_prefix=1`，宁可不动也不要改坏 |
| 彻底停用 | `enabled=0`，然后手动清代答条目（脚本不动内核） |

---

## 4. 部署形态

### 4.1 形态 A：子路由（推荐，当前形态）

```
[5G CPE 192.0.2.254] ◄── WAN ──► [子路由 192.0.2.1] ◄── LAN ──► 终端
   Lucky :22222→192.0.2.100:8022   NAT66 + NDP 代答 + DDNS 跟随
```

- 前置：CPE 可做端口转发；子路由 WAN 为 DHCP 客户端
- 依赖：`dig` 或 `nslookup`、`ip`、`cron`、`jsonfilter`（OpenWrt 标配）
- 交付物：`ddns-follow`、`ddns-follow-status`、hotplug 脚本、LuCI 三件套、UCI 配置文件

### 4.2 形态 B：单路由直连

子路由直接当主路由用，`br-lan` 与 CPE 同网段。需要 `manage_lan_addr=1`，且没有 `95-lan6-prefix` 的 hotplug 自愈（改由脚本兜底）。

### 4.3 形态 C：软路由 / VM

逻辑同 A，只是接口名和 `/128` 网关不同。注意 VM 若无 `ipv6_passthrough`，拿不到公网 v6（实测 5G CPE 内置 VM 就是这种）。

---

## 5. 兼容性约束

### 5.1 上游必须满足

| 条件 | 检查方法 | 不满足的后果 |
| --- | --- | --- |
| 给的是 `/64` 而非更小的段 | `ip -6 addr show dev wan` 的前缀长度 | `/128` 时无法给 LAN 分发 |
| LAN 与 CPE 同段（透明 /64） | 对比 CPE br0 与 WAN 前缀 | 不同段时无需代答，本方案退化为纯 NAT66 |
| 无 PD | `ipv6-prefix` 为空 | 有 PD 时不应用本方案，直接分前缀更优 |

### 5.2 终端兼容

| 平台 | 注意点 |
| --- | --- |
| Windows | 隐私地址每小时轮换；NAT66 只看前缀不看后缀，无影响；`/64` 内地址会走 on-link 需代答 |
| Android/iOS | 同上；iOS 对 RA 生命周期敏感，`max_valid_lifetime` 保持 3600 |
| Linux | 同 Windows，另注意 `accept_ra` 策略 |
| IoT（米家等） | 只走 IPv4，不受影响；**不要为此开 RA relay**（会改动 2.4G 侧设备行为） |

### 5.3 明确不兼容

- 上游下发 PD 的网络（本方案多余）
- 上游为独立公网 IPv4 的网络（应直接端口映射）
- 客户端强制走 DoH 且不遵循内网 DNS 的环境（L2-2 失效，但 L1-1 仍有效）

---

## 6. 性能与可靠性

### 6.1 资源占用

| 项 | 量级 |
| --- | --- |
| `neigh proxy` 条目 | 每地址 1 条，约数十字节，可忽略 |
| `/128` 路由 | 每地址 1 条 |
| `ddns-follow` 单次运行 | 3 次 `dig` 以内，CPU < 50ms |
| cron 频率 `*/2` | 每天 720 次，对 flash 无写入（日志在 `/tmp`） |

### 6.2 收敛时间（SLO）

| 事件 | 恢复时间上界 | 依赖 |
| --- | --- | --- |
| 运营商换前缀 | ≤ 2 分钟 | hotplug 立即 + cron 兜底 |
| CPE 换出口地址（后缀变） | ≤ 7 分钟 | DDNS 5 分钟 + cron 2 分钟 |
| DDNS 服务异常 | 不恢复（保留旧条目） | `keep_stale=1` |
| 路由器重启 | ≤ 90 秒 | hotplug 重跑 |

### 6.3 故障模式与降级

| 故障 | 表现 | 自动行为 |
| --- | --- | --- |
| 公共 DNS 全不可达 | 解析失败 | 保留旧条目，写日志，下一轮重试 |
| DDNS 未及时更新 | 前缀不匹配 | `strict_prefix` 跳过，等下一轮 |
| 上游网关变化 | `/128` 下一跳失效 | 每轮重新取默认网关，自动修正 |
| 日志写满 `/tmp` | — | 按 `log_max_lines` 轮转 |
| 脚本异常退出 | 状态停滞 | 文件锁自动释放（`trap` 清理） |

---

## 7. 运维与监控

### 7.1 状态采集

```sh
/usr/bin/ddns-follow-status        # key=value，供脚本和页面共用
```

输出字段：`domain / resolved / proxy / route_dev / route_via / lan_prefix / last_run`

### 7.2 判定规则（可告警）

| 指标 | 正常 | 告警条件 |
| --- | --- | --- |
| `resolved == proxy` | 相等 | 连续 2 轮不等 |
| `route_dev` | `wan` | 不是 `wan`（说明走了 on-link） |
| `last_run` 距今 | < 5 分钟 | > 10 分钟（cron 失效） |
| `lan_prefix` 与 DDNS 前缀 | 相同 | 连续 10 分钟不同（DDNS 挂了） |

### 7.3 日志

- 路径：`/tmp/ddns-follow.log`
- 格式：`YYYY-MM-DD HH:MM:SS <事件> <参数>`
- 只在状态变化时写（`proxy add` / `drop stale` / `route add` / `prefix not synced yet` / `resolve failed`），不写"本轮无变化"。

### 7.4 常用诊断命令

```sh
ip -6 neigh show proxy dev br-lan              # 当前代答
ip -6 route get <DDNS地址>                      # 是否走 wan
ubus call network.interface.wan6 status | jsonfilter -e '@["ipv6-prefix"]'
cat /tmp/ddns-follow.log | tail -20
ubus call file exec '{"command":"/usr/bin/ddns-follow-status","params":[]}'
```

### 7.5 故障处置表

| 现象 | 判断 | 处置 |
| --- | --- | --- |
| 内网连域名超时，但直连 IP 正常 | 代答条目错/缺 | 手动跑 `ddns-follow`，看日志 |
| 内网通，外网不通 | 上游/Lucky 问题 | 查 CPE 端口转发状态 |
| 全网 IPv6 断 | 前缀变了但没跟上 | 查 `br-lan` 前缀与 DDNS 是否一致 |
| LuCI 页面 403 | 登录态问题 | 看响应头有无 `x-luci-login-required` |
| cron 不触发 | 服务停用 | `/etc/init.d/cron enabled && restart` |

---

## 8. 分阶段实施与验收

### P0 基础可用（已完成）

交付：NAT66 + 手工 NDP 代答 + hotplug 前缀自愈

验收：

```sh
ip -6 addr show br-lan | grep 2001      # 有 GUA
ping6 -c3 2400:3200::1                  # 0% 丢包
ip -6 route get <DDNS地址> | grep wan   # 走 wan
```

### P1 自动化与开关（已完成，2026-11-03）

交付：`ddns-follow` 全 UCI 驱动、`enabled` 主开关、`strict_prefix` / `keep_stale` /
`clean_others` / `manage_lan_addr` 策略开关、cron 每分钟触发 + 脚本内节流。

实测结果：

| 验收项 | 命令 | 结果 |
| --- | --- | --- |
| 代答与解析一致 | `ddns-follow-status \| grep -E 'resolved\|proxy'` | 均为 `2001:db8:3:3:9999:aaaa:bbbb:cccc` ✅ |
| 路由走 wan | `route_dev` | `wan`，`via fe80::1` ✅ |
| 主开关生效 | `enabled=0` 后运行 | `elapsed=0s`，`last_run` 未变，内核无改动 ✅ |
| 间隔节流 | 连续运行两次 | 第二次 `elapsed=1s`，`last_run` 未变 ✅ |
| 配置即时生效 | 改 `interval` | 无需改 crontab，下一分钟按新值 ✅ |
| LuCI 通路 | `ubus call file exec` | `code:0` + 完整状态 ✅ |

> cron 改为 `* * * * *`，真实间隔由脚本体内的 `interval` 控制。这样改间隔不用碰
> crontab，也不会因为 uci 与 cron 不同步导致行为漂移。

### P2 可观测性（部分完成）

交付：LuCI 状态页、手动同步按钮、日志视图、状态字段化

验收：页面能显示 `resolved/proxy/route_dev/last_run`；点「立即同步」后状态 10 秒内刷新；`resolved != proxy` 时标红。

### P3 多场景适配（待规划）

交付：`mode=ndppd` 分支、多域名（`clean_others=0`）、变更告警接入

验收：同一脚本在形态 A/B/C 下均可运行；改 `interval` 后 crontab 自动同步；告警能在前缀漂移时 10 分钟内触发。

---

## 9. 回滚

每层独立回滚，不需要整机重置。

| 改动 | 回滚 |
| --- | --- |
| NDP 代答 | `ip -6 neigh del proxy <addr> dev br-lan`；`ip -6 route del <addr>/128` |
| 自动跟随 | 删 crontab 中 `ddns-follow` 行；`rm /usr/bin/ddns-follow` |
| hotplug 自愈 | `cp /root/95-lan6-prefix.bak /etc/hotplug.d/iface/95-lan6-prefix` |
| NAT66 | `uci set firewall.@zone[1].masq6='0' && uci commit firewall && /etc/init.d/firewall reload` |
| LuCI 页面 | 删 menu.d / acl.d / view 三个文件 + `rm -f /tmp/luci-indexcache*` + 重启 rpcd |

回滚后必须验证：`ping6 2400:3200::1` 与 `ssh -p 22222 <user>@<域名>` 的预期行为。

---

## 10. 现状基线（2026-11-03）

| 项 | 值 |
| --- | --- |
| LAN 前缀 | `2001:db8:3:3::1/64`（当日第三次漂移） |
| NAT66 | `masq6=1` |
| 转发 | `net.ipv6.conf.all.forwarding=1` |
| 代答开关 | `proxy_ndp=1` |
| RA | `ra='server'`，`dhcpv6='disabled'`，`ndp='disabled'` |
| 自动跟随 | `* * * * * /usr/bin/ddns-follow`，脚本内按 `interval` 节流 |
| 主开关 | `ddnsfollow.settings.enabled=1` |
| 可视化 | 服务 → DDNS IPv6 跟随 |
| PD | 无（已实测到底，不再尝试） |
