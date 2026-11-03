'use strict';
'require view';
'require form';
'require fs';
'require uci';
'require ui';
'require poll';

var STATUS_CMD = '/usr/bin/ddns-follow-status';
var SYNC_CMD = '/usr/bin/ddns-follow';
var LOG_FILE = '/tmp/ddns-follow.log';

var MONO = 'SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace';

function parseKV(text) {
    var out = {};
    (text || '').split('\n').forEach(function(line) {
        var i = line.indexOf('=');
        if (i > 0)
            out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    return out;
}

function sectionTitle(text) {
    return E('h3', {
        'style': 'text-align:left;font-size:15px;font-weight:600;margin:0 0 12px 0;color:inherit'
    }, [ text ]);
}

function kvRow(label, value, style) {
    return E('tr', {
        'class': 'tr',
        'style': 'border-bottom:1px solid rgba(0,0,0,.06)'
    }, [
        E('td', {
            'class': 'td',
            'style': 'text-align:left;width:24%;color:#6b7280;font-size:13px;' +
                'padding:8px 0;vertical-align:top'
        }, [ label ]),
        E('td', {
            'class': 'td',
            'style': 'text-align:left;font-size:13px;padding:8px 0;' +
                'word-break:break-all;' + (style || '')
        }, [ value || '—' ])
    ]);
}

function badge(text, tone) {
    var bg = tone === 'ok' ? '#2dce89' : (tone === 'warn' ? '#fb6340' : '#8898aa');
    return E('span', {
        'style': 'display:inline-block;padding:2px 10px;border-radius:10px;' +
            'font-size:12px;line-height:18px;color:#fff;background:' + bg
    }, [ text ]);
}

return view.extend({
    load: function() {
        return Promise.all([
            uci.load('ddnsfollow'),
            L.resolveDefault(fs.exec_direct(STATUS_CMD, []), ''),
            L.resolveDefault(fs.read(LOG_FILE), '')
        ]);
    },

    render: function(data) {
        var self = this;
        var st = parseKV(data[1]);

        var table = E('table', {
            'class': 'table ddns-status',
            'style': 'width:100%;table-layout:fixed'
        }, [ E('tbody', {}, []) ]);
        this.fill(table, st);

        var logBox = E('pre', {
            'style': 'max-height:240px;overflow:auto;white-space:pre-wrap;' +
                'font-family:' + MONO + ';font-size:12px;line-height:1.6;' +
                'background:rgba(0,0,0,.04);padding:10px;border-radius:4px;' +
                'margin:0;text-align:left'
        }, [ data[2] || '(暂无日志)' ]);

        var btn = E('button', {
            'class': 'btn cbi-button cbi-button-action',
            'style': 'margin-top:14px'
        }, [ '立即同步' ]);

        btn.addEventListener('click', function() {
            if (btn.disabled)
                return;
            btn.disabled = true;
            btn.textContent = '同步中…';
            fs.exec_direct(SYNC_CMD, [])
                .then(function() {
                    return self.refresh(table, logBox);
                })
                .catch(function(e) {
                    ui.addNotification(null, E('p', {}, [ '执行失败：' + e ]), 'danger');
                })
                .finally(function() {
                    btn.disabled = false;
                    btn.textContent = '立即同步';
                });
        });

        var statusBlock = E('div', {
            'class': 'cbi-section',
            'style': 'text-align:left'
        }, [
            sectionTitle('运行状态'),
            E('div', { 'class': 'cbi-section-node' }, [
                table,
                btn,
                E('p', {
                    'class': 'cbi-section-descr',
                    'style': 'margin-top:12px;text-align:left'
                }, [
                    'cron 每分钟触发，按「执行间隔」节流，改间隔无需动 crontab。'
                ])
            ])
        ]);

        var logBlock = E('div', {
            'class': 'cbi-section',
            'style': 'text-align:left'
        }, [
            sectionTitle('最近日志'),
            E('div', { 'class': 'cbi-section-node' }, [ logBox ])
        ]);

        var m = new form.Map('ddnsfollow', 'DDNS IPv6 跟随',
            '向公共 DNS 查询域名的 AAAA 记录，与当前 NDP 代答条目比对，不一致就更新代答和 /128 路由。');

        var s = m.section(form.NamedSection, 'settings', 'settings');
        s.anonymous = true;
        s.addremove = false;
        s.tab('basic', '基本');
        s.tab('strategy', '策略');
        s.tab('advanced', '高级');

        var o;

        o = s.taboption('basic', form.Flag, 'enabled', '启用',
            '总开关。关闭后脚本立即退出，不修改任何内核状态。');
        o.default = '1';
        o.rmempty = false;

        o = s.taboption('basic', form.Value, 'domain', '域名',
            '要跟随 AAAA 记录的域名。');
        o.default = 'ddns.example.com';
        o.rmempty = false;

        o = s.taboption('basic', form.Value, 'interval', '执行间隔（分钟）',
            '1–60。cron 每分钟触发，脚本内部按此值节流，改这里即时生效。');
        o.datatype = 'range(1,60)';
        o.default = '2';
        o.rmempty = false;

        o = s.taboption('basic', form.Value, 'timeout', '单次查询超时（秒）',
            '每个探测 DNS 的超时，会依次尝试列表里的服务器。');
        o.datatype = 'range(1,10)';
        o.default = '3';

        o = s.taboption('strategy', form.Flag, 'strict_prefix', '严格前缀校验',
            '开：DDNS 前缀与 LAN 前缀不一致时跳过本轮，等 DDNS 追上。<br />' +
            '关：强行写入，可能把代答指向一个不存在的地址。');
        o.default = '1';
        o.rmempty = false;

        o = s.taboption('strategy', form.Flag, 'keep_stale', '解析失败保留旧条目',
            '开：DNS 全失败时保持现状。<br />关：清空代答条目，内网会立刻不通。');
        o.default = '1';
        o.rmempty = false;

        o = s.taboption('strategy', form.Flag, 'clean_others', '清理无关条目',
            '开：只保留当前解析出的那一个代答。<br />多域名场景应关闭。');
        o.default = '1';
        o.rmempty = false;

        o = s.taboption('strategy', form.Flag, 'manage_lan_addr', '自动补 LAN 地址',
            '开：LAN 没有该前缀地址时，由本脚本补 前缀::1/64。<br />' +
            '有 hotplug 自愈脚本时无需开启。');
        o.default = '0';

        o = s.taboption('advanced', form.Value, 'lan_iface', 'LAN 接口');
        o.default = 'br-lan';
        o.rmempty = false;

        o = s.taboption('advanced', form.Value, 'wan_iface', 'WAN 接口');
        o.default = 'wan';
        o.rmempty = false;

        o = s.taboption('advanced', form.Value, 'upstream_gw', '上游网关',
            '留空则每轮自动取默认路由的 via。');
        o.default = '';

        o = s.taboption('advanced', form.Value, 'log_max_lines', '日志上限（行）',
            '超过后自动轮转，防止 /tmp 占满。');
        o.datatype = 'range(50,5000)';
        o.default = '500';

        m.handleSaveApply = ui.createHandlerFn(this, function() {
            return this.save().then(function() {
                return fs.exec_direct(SYNC_CMD, []);
            }).then(function() {
                window.location.reload();
            });
        });

        return m.render().then(function(node) {
            var first = node.querySelector('.cbi-section');
            if (first)
                node.insertBefore(statusBlock, first);
            else
                node.appendChild(statusBlock);
            node.appendChild(logBlock);

            poll.add(function() {
                return self.refresh(table, logBox);
            }, 10);

            return node;
        });
    },

    fill: function(table, st) {
        var tbody = table.querySelector('tbody');
        while (tbody.firstChild)
            tbody.removeChild(tbody.firstChild);

        var ok = st.resolved && st.proxy && st.resolved === st.proxy;
        var on = st.enabled === '1';
        var route = st.route_dev
            ? ('dev ' + st.route_dev + (st.route_via ? ' via ' + st.route_via : ''))
            : '';
        var state = !on ? '已停用' : (ok ? '正常' : (st.resolved ? '待同步' : '未知'));
        var tone = !on ? 'off' : (ok ? 'ok' : 'warn');

        tbody.appendChild(kvRow('开关', on ? '已启用' : '已停用'));
        tbody.appendChild(kvRow('域名', st.domain));
        tbody.appendChild(kvRow('DDNS 解析', st.resolved));
        tbody.appendChild(kvRow('NDP 代答', st.proxy));
        tbody.appendChild(kvRow('路由走向', route));
        tbody.appendChild(kvRow('LAN 前缀', st.lan_prefix ? st.lan_prefix + '::/64' : ''));
        tbody.appendChild(kvRow('上游网关', st.upstream_gw));
        tbody.appendChild(kvRow('执行间隔', st.interval ? st.interval + ' 分钟' : ''));
        tbody.appendChild(kvRow('上次执行', st.last_run));

        var tr = E('tr', {
            'class': 'tr',
            'style': 'border-bottom:1px solid rgba(0,0,0,.06)'
        }, [
            E('td', {
                'class': 'td',
                'style': 'text-align:left;width:24%;color:#6b7280;font-size:13px;' +
                    'padding:8px 0;vertical-align:top'
            }, [ '状态' ]),
            E('td', {
                'class': 'td',
                'style': 'text-align:left;padding:8px 0'
            }, [ badge(state, tone) ])
        ]);
        tbody.appendChild(tr);
    },

    refresh: function(table, logBox) {
        var self = this;
        return Promise.all([
            L.resolveDefault(fs.exec_direct(STATUS_CMD, []), ''),
            L.resolveDefault(fs.read(LOG_FILE), '')
        ]).then(function(data) {
            self.fill(table, parseKV(data[0]));
            logBox.textContent = data[1] || '(暂无日志)';
        });
    }
});
