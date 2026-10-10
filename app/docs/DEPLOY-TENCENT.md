# 交织者 · 腾讯云 2核4G 部署手册（已有域名）

> 目标：把"前端静态站 + 后端 API（SQLite + 用户系统）"部署到一台 **2 核 4G** 的腾讯云服务器上，
> 用你自己的域名访问，**两个来源不同域**（前端与 API 分属两个子域）。
> 本文所有命令都按 **Ubuntu 22.04 / Debian 12** 写（腾讯云最常见），CentOS 用户把 `apt` 换成 `dnf` 即可。

---

## 0. 为什么必须用两个（子）域名

本项目按你的要求"**分开前后端、不再同源**"：

```
https://math.example.com   → 前端静态文件（nginx → 127.0.0.1:5188）
https://api.example.com    → 后端 API（nginx → 127.0.0.1:5189）
```

⚠️ **不要**把两者放在同一个域名下用 `/api` 路径区分 —— 那又变成"同源"了，与你的要求相反。
后端会用**来源白名单**（`API_ORIGINS`）只允许你的前端域名，跨源访问靠 CORS 放行。

---

## 1. 服务器与域名准备

1. **安全组**（腾讯云控制台 → 轻量/CVM → 防火墙）放行：`22`（SSH）、`80`、`443`。**不要**放行 5188/5189。
2. **域名解析**（DNSPod）加两条 A 记录，指向服务器公网 IP：
   ```
   math   A   <你的公网 IP>
   api    A   <你的公网 IP>
   ```
3. 登录服务器：
   ```bash
   ssh root@<你的公网 IP>
   ```

**2核4G 够不够**：够，而且富余。两个 Node 进程常驻约 100–200 MB，nginx 约 10 MB，SQLite 是单文件、
按需读写。4G 内存主要留给系统缓存与将来的 Nginx 并发，CPU 只在保存场景/登录时短暂占用。

---

## 2. 安装 Node（≥ 22.5，必须有 `node:sqlite`）

```bash
# 用 NodeSource 装 Node 22 LTS（自带 node:sqlite；本项目在 v24.20.0 上实测）
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node -v            # 应显示 v22.x 或更高
```
> 本项目**零第三方依赖**：不需要 `npm install`（`puppeteer` 只用于本地核验脚本，服务器上不需要）。
> 因此服务器上**不要**执行 `npm install`，省时间也省空间。

---

## 3. 上传代码

```bash
mkdir -p /opt && cd /opt
# 方式一：git
git clone <你的仓库地址> interweaver && cd interweaver/app
# 方式二：本机打包上传（在 Windows 上执行）
#   tar --exclude=node_modules --exclude=data -czf iw.tgz app
#   scp iw.tgz root@<IP>:/opt/ && ssh root@<IP> "cd /opt && tar xzf iw.tgz"
```
**不要**上传 `app/node_modules`（服务器用不到）与 `app/data`（那是本机测试数据）。

---

## 4. 先手工跑一次（确认能起）

```bash
cd /opt/interweaver/app
API_ORIGINS=https://math.example.com \
API_DB=/var/lib/interweaver/interweaver.db \
npm start          # 起前端 5188 + 后端 5189
# 另开一个终端：
npm run status     # 实时监控：两个服务是否在跑、端口、health、最近事件
```
浏览器打开 `http://<公网IP>:5188` 若打不开是**正常**的（安全组没放行 5188，我们走 nginx）。
关键是 `npm run status` 里两个服务都是"● 运行中"。

按 `Ctrl+C` 停掉，进入下一步（用 systemd 常驻）。

```bash
# 数据目录（SQLite 落盘位置，便于单独备份）
mkdir -p /var/lib/interweaver
```

---

## 5. 用 systemd 常驻（推荐：两个 unit，便于单独重启）

`/etc/systemd/system/interweaver-api.service`
```ini
[Unit]
Description=Interweaver API (SQLite + users)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/interweaver/app
Environment=PORT_API=5189
Environment=API_DB=/var/lib/interweaver/interweaver.db
Environment=API_ORIGINS=https://math.example.com
Environment=API_ALLOW_REGISTER=0
# 关掉 Node 对 node:sqlite 的实验性警告显示（不改变它仍是实验特性这一点）
Environment=NODE_OPTIONS=--disable-warning=ExperimentalWarning
ExecStart=/usr/bin/node server-api.mjs
Restart=always
RestartSec=2
User=www-data

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/interweaver-web.service`
```ini
[Unit]
Description=Interweaver static frontend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/interweaver/app
Environment=PORT=5188
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=2
User=www-data

[Install]
WantedBy=multi-user.target
```

启用：
```bash
chown -R www-data:www-data /opt/interweaver /var/lib/interweaver
systemctl daemon-reload
systemctl enable --now interweaver-api interweaver-web
systemctl status interweaver-api --no-pager
curl -s http://127.0.0.1:5189/api/v1/health   # 应返回 ok:true 的 JSON
```

> `API_ALLOW_REGISTER=0`：**先不要加**，等你在第 8 步注册完第一个账号（它会自动成为管理员）之后再加，
> 然后 `systemctl restart interweaver-api`。公网上线后关闭开放注册更安全。

---

## 6. nginx 反向代理

```bash
apt-get install -y nginx
```

`/etc/nginx/sites-available/interweaver`
```nginx
# 前端
server {
  listen 80;
  server_name math.example.com;
  location / {
    proxy_pass http://127.0.0.1:5188;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}

# 后端 API（必须不同域，保持"不同源"）
server {
  listen 80;
  server_name api.example.com;
  location / {
    proxy_pass http://127.0.0.1:5189;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    # 场景/草稿可能较大，放宽请求体
    client_max_body_size 16m;
  }
}
```
```bash
ln -s /etc/nginx/sites-available/interweaver /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

## 7. HTTPS（两种都行）

**方式 A：certbot（自动续期）**
```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d math.example.com -d api.example.com
```

**方式 B：腾讯云免费证书**：控制台申请 → 下载 nginx 格式 → 放到 `/etc/nginx/ssl/` → 在 server 块里
`listen 443 ssl; ssl_certificate ...; ssl_certificate_key ...;` 并加一条 80 → 443 跳转。

---

## 8. 让前端指向你的 API（**每页一处，共五处**）

**五个页面**里各有一行（`index.html` / `settings.html` / `starmap.html` / `login.html` / `mine.html`）：
```html
<meta name="iw-api" content="https://api.example.com">
```
改完 `systemctl reload nginx`，然后打开 `https://math.example.com`：
1. 根路径 `/` 会 **302 到 `/login.html`**；打开后应该先看到**加载层**（等网络与用户数据），也可以点「离线进入」；
2. 在**登录页** `login.html` 上 **注册第一个账号**（自动成为管理员）——
   ★ 注册/登录**只在登录页**：设置页里**已经没有任何账号面板或登录表单**（「我的」是独立页面 `mine.html`，
   由画布导航栏的「我的」链接进入），别再去设置里找；
3. 注册成功后，本机浏览器里的旧数据会**自动导入**后端（只填空位、不覆盖；且一份旧数据只导一次）；
4. 回到服务器：给 `interweaver-api.service` 加上 `Environment=API_ALLOW_REGISTER=0` 并重启。

---

## 9. 备份（SQLite 单文件，两行搞定）

`/opt/interweaver/backup.sh`
```bash
#!/usr/bin/env bash
set -euo pipefail
D=/var/lib/interweaver
B=/var/backups/interweaver
mkdir -p "$B"
STAMP=$(date +%F-%H%M)
# 用 sqlite3 的 .backup 保证一致性（没有 sqlite3 就退回复制三件套）
if command -v sqlite3 >/dev/null; then
  sqlite3 "$D/interweaver.db" ".backup '$B/iw-$STAMP.db'"
else
  cp "$D/interweaver.db" "$B/iw-$STAMP.db"
  [ -f "$D/interweaver.db-wal" ] && cp "$D/interweaver.db-wal" "$B/iw-$STAMP.db-wal" || true
fi
find "$B" -name 'iw-*.db*' -mtime +7 -delete     # 保留 7 天
```
```bash
chmod +x /opt/interweaver/backup.sh
crontab -e
# 每天 03:30 备份
30 3 * * * /opt/interweaver/backup.sh >> /var/log/iw-backup.log 2>&1
```

---

## 10. 日常运维（用本项目自带的脚本）

```bash
cd /opt/interweaver/app
npm run status     # 实时监控：服务存活/端口/health/最近事件（Ctrl+C 退出）
npm run stop       # 停掉两个服务（systemd 会按 Restart=always 再拉起；要彻底停用 systemctl stop）
```
- **看日志**：`journalctl -u interweaver-api -f` / `journalctl -u interweaver-web -f`
  （另外后端自己会写两份流水：`data/api.log` 请求流水、`data/events.log` 画布动作流水 —— 路径可用
  `API_LOG` / `API_EVENTS_LOG` 改）
- **改了代码**：`cd /opt/interweaver && git pull && systemctl restart interweaver-web interweaver-api`
- **数据在哪**：`/var/lib/interweaver/interweaver.db`（+ `-wal` / `-shm`）—— 升级、回滚都不动它。
- **端口占用报错**（就是你在本机遇到的那个）：服务会打印
  `✗ 后端端口 5189 已被占用 … npm run stop / npm run status`。按提示做即可。
- ★ **跑核验之前必须先让 5189 空闲**：`npm run stop && npm run verify`。
  `npm run verify` 的外壳要在 5189 上起一个**自己的**测试后端（独占端口 + 独占临时库 + 独占临时日志），
  端口上只要已经有人在跑就**直接拒绝运行**（`tests/_own-backend.mjs` 的纪律：绝不复用别人的后端，
  免得把测试账号写进真实库）。单项检查（`node tests/check-api.mjs` 等）都自带独占端口，不受这条影响。
- **端口分配表**（避免再撞号）：5188 前端 / 5189 后端；5199、5209 `check-api`；5286 `check-boot-overlay`；
  5288、5289 `check-deploy-e2e`；5292 `check-telemetry`；5293 `check-frontend-api`；5295 `check-account-isolation`；
  5296 `diag-login-cloud`；5298 `check-account-panel`；5299 `check-mine-page`。

---

## 11. 验收清单（部署完逐条打勾）

```bash
curl -s https://api.example.com/api/v1/health      # ok:true，db=sqlite，users≥1
curl -sI https://math.example.com/ | head -1       # HTTP/2 302（根路径跳登录页 /login.html）
curl -s -o /dev/null -w '%{http_code}\n' https://math.example.com/login.html   # 200（登录页真的在）
curl -s -o /dev/null -w '%{http_code}\n' https://math.example.com/api/v1/health   # 404（前端不含 API ✓ 职责分开）
```
- [ ] 前端能打开：根路径 **302 到登录页**，先出现加载层
- [ ] 在登录页注册第一个账号 → 是管理员（★ 注册入口只在登录页，设置页里没有账号面板）
- [ ] 关掉后端（`systemctl stop interweaver-api`）→ 前端**明确报错**（地址/code/怎么修），点成就页被拦住并说明原因
- [ ] 重新起后端 → **重启后数据仍在**（设置/进度/草稿都还在）
- [ ] 换一台设备登录同一账号 → 数据从服务器取回
- [ ] 备份脚本跑过一次、`/var/backups/interweaver/` 里有文件

---

## 12. 安全须知（如实列出取舍）

- 密码：`node:crypto` 的 **scrypt + 16 字节随机盐 + `timingSafeEqual`**；会话：32 字节随机 token。
- 前端把 token 存在 `localStorage`（跨源 SPA 的常见做法）→ **任何 XSS 都能读到它**，所以页面里不要引入
  不可信脚本；若你更希望用 Cookie，需要 HTTPS + `SameSite=None; Secure` + `Allow-Credentials`（目前**未实现**）。
- 登录/注册有按 IP 限流（12 次/分钟，内存计数）；公网建议在 nginx 层再加 `limit_req`。
- 公网部署后请设 `API_ALLOW_REGISTER=0`；`API_ORIGINS` 只填你的前端域名。
- `node:sqlite` 在 Node 里仍标记为**实验特性**（本文用 `--disable-warning` 只是不显示警告，**不改变**这一点）。
  稳妥做法：固定 Node 大版本、每天备份、升级前在测试目录跑一次 `npm run verify`。
