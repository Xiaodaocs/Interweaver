# 交织者 · 后端与部署说明

> 这份文档对应"**前后端分离**"后的形态：前端是纯静态页面，后端是独立服务（自带数据库与用户系统）。
> 两者**不同源**，通过 HTTP API 通信。全部零第三方依赖（只用 Node 内置模块）。

---

## 一、架构（两个来源）

```
┌─ 前端静态服务（默认 5188）server.mjs ──────────────┐
│  只发静态文件：html / js / css。**不含任何 API**。  │
│  页面里的 <meta name="iw-api"> 指向后端地址。        │
└────────────────────────┬───────────────────────────┘
                         │ 跨源 fetch（带 Bearer token）
                         │ 后端白名单 + OPTIONS 预检
┌────────────────────────▼───────────────────────────┐
│  后端 API（默认 5189）server-api.mjs                │
│  · SQLite（node:sqlite）→ app/data/interweaver.db   │
│  · 用户系统：注册/登录/登出/me（scrypt + 随机盐）    │
│  · 数据：docs(settings/progress/draft) + scenes     │
│  · 每用户数据隔离；错误返回详细 code/hint/details   │
└─────────────────────────────────────────────────────┘
```

**一条命令起两个来源**：`npm start`（内部 `dev.mjs` 同时拉起两者，任一退出则另一个也停）。
也可以分开起：`npm run start:web` / `npm run start:api`。

---

## 二、启动

```bash
cd app
npm start                      # 前端 5188 + 后端 5189
# 或者分开：
npm run start:web              # 只起前端
npm run start:api              # 只起后端
```

打开 <http://localhost:5188/>（部署后就是你的域名）→ `/` **302 到登录页 `login.html`** → 在那里
**注册第一个账号**（**第一个注册的用户自动是管理员**）；登录成功后进画布 `index.html`。
已登录时再访问 `/` 或登录页会**自动回到画布**（登录页上留了「退出登录 / 切换账号」，点它就取消这次跳转并登出）。
登录成功后，本机浏览器里**还没归属任何账号**的旧数据（设置/进度/草稿）
会**自动导入**后端；后端只填空位、**不会覆盖**已有数据，所以重复导入是安全的。
已经归属过某个账号的那一份**不会再导进第二个账号**（否则就是用户报告的那个 bug：
"我用账号 2 可以打开账号 1 的存档和数据"）——归属规则见 `src/userScope.js`，第八节有完整说明。

**未登录、或后端连不上（离线）时**：画布上的「文件 → 云端存储 / 从云端打开」**会直接跳登录页**
（不弹提示、不假装成功、也不退回本地保存）—— 登录页才是唯一能说清"为什么不能存"的地方（连不上后端时
那里有地址 / 原因 / code / 怎么办的完整报错）。「新建 / 打开 / 保存 / 另存为」是**本地**操作，离线照旧可用。

---

## 三、环境变量（部署时改这些）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `5188` | 前端静态服务端口 |
| `PORT_API` | `5189` | 后端 API 端口 |
| `API_DB` | `app/data/interweaver.db` | SQLite 数据库文件路径 |
| `API_ORIGINS` | `http://localhost:5188,http://127.0.0.1:5188` | **允许的前端来源**（逗号分隔）。部署时必须改成真实前端域名，例如 `https://math.example.com` |
| `API_ALLOW_REGISTER` | 开 | 设为 `0` 关闭开放注册（公网部署建议关掉；管理员可在库里直接加用户） |
| `API_SESSION_DAYS` | `30` | 会话有效期（天） |

前端指向后端：改三个页面里的同一行（**只此一处**）：
```html
<meta name="iw-api" content="http://localhost:5189">
```

---

## 四、接口一览（`/api/v1`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 公开：db 类型、用户数、是否开放注册、会话天数、来源白名单 |
| POST | `/auth/register` | 注册（首个用户=管理员）→ 返回 token |
| POST | `/auth/login` | 登录 → 返回 token |
| POST | `/auth/logout` | 登出（该 token 立即失效） |
| GET | `/auth/me` | 当前用户 |
| GET/PUT | `/{settings,progress,draft}` | 单文档读写（按用户隔离） |
| GET/POST | `/scenes` | 场景列表 / 新建 |
| GET/PUT/DELETE | `/scenes/:id` | 取用 / 覆盖 / 删除 |
| POST | `/import` | 旧数据导入（**只填空位，不覆盖**） |

鉴权：`Authorization: Bearer <token>`（token 由注册/登录返回，前端存 `localStorage.interweaver.token`）。

**错误一律是详细的 JSON**（`ok:false`）：
```json
{ "ok": false, "code": "BAD_TOKEN", "error": "token 无效（可能已被登出或服务端换过数据库）",
  "hint": "重新登录", "details": { "tokenPrefix": "ab12cd…" }, "path": "/api/v1/settings", "method": "GET" }
```
常见 `code`：`NO_TOKEN` / `BAD_TOKEN` / `TOKEN_EXPIRED` / `BAD_CREDENTIALS` / `USER_EXISTS` /
`BAD_USERNAME` / `BAD_PASSWORD` / `BAD_JSON` / `BAD_DOC` / `BAD_ID` / `NO_ROUTE` / `SCENE_NOT_FOUND` /
`SCENE_EXISTS` / `METHOD_NOT_ALLOWED` / `BODY_TOO_LARGE` / `RATE_LIMITED` / `ORIGIN_NOT_ALLOWED` /
`REGISTER_DISABLED`。前端连不上后端时是 `BACKEND_UNREACHABLE`（面板会把地址、原因、怎么办都显示出来）。

---

## 五、部署到服务器

1. **放文件**：把 `app/` 目录（不含 `data/`、`node_modules/`）传到服务器，装 Node ≥ 22.5（用到内置 `node:sqlite`；本项目在 **v24.20.0** 上实测）。
2. **选定端口与来源**：
   ```bash
   PORT=5188 PORT_API=5189 \
   API_ORIGINS=https://math.example.com \
   API_ALLOW_REGISTER=0 \
   node dev.mjs
   ```
3. **反向代理**（推荐 nginx）：
   - `https://math.example.com/` → `http://127.0.0.1:5188/`（静态）
   - `https://api.example.com/` → `http://127.0.0.1:5189/`（API）
   - 把 `API_ORIGINS` 设成 `https://math.example.com`；三个页面的 `meta iw-api` 设成 `https://api.example.com`。
   - **不要**给 API 配缓存；`/api/` 关掉 gzip 之外的改写即可（响应已带 `cache-control: no-store`）。
4. **数据与备份**：所有用户数据都在 `app/data/interweaver.db`（SQLite，WAL 模式）。
   备份 = 复制这个文件（连同 `-wal`/`-shm`），或用 `sqlite3 interweaver.db ".backup backup.db"`。
   `app/data/` **不进版本库**（已在 `.gitignore`）。
5. **进程守护**：任选 systemd / pm2 / Windows 服务；`dev.mjs` 在任一子进程退出时会一并退出并返回非 0，便于守护进程重启。
6. **HTTPS**：建议由反向代理终止 TLS。前端与后端跨站时，浏览器要求 API 走 HTTPS。

---

## 六、安全须知（如实列出当前取舍）

- 密码用 `node:crypto` 的 **scrypt + 16 字节随机盐**，比较用 `timingSafeEqual`（不引第三方库）。
- 会话 token 是 **32 字节随机值**，存 `sessions` 表；默认 30 天；登出即删。
- 前端把 token 放在 `localStorage`（跨源 SPA 的常见做法）。**注意**：任何 XSS 都能读到它 ——
  所以页面里不要引入不可信脚本。若你更希望用 Cookie，需要 HTTPS + `SameSite=None; Secure`，
  且后端要加 `Access-Control-Allow-Credentials`（目前**没有**实现，属于后续可选项）。
- 登录/注册有简单的按 IP 限流（12 次/分钟，内存计数）；公网部署建议在反向代理层再加一层限流。
- `API_ALLOW_REGISTER=0` 可关闭开放注册。

---

## 七、验收（怎么证明它是好的）

```bash
cd app && npm run verify        # 全链（含下面几条）
node tests/check-api.mjs        # 后端：37 项（用户系统 / 隔离 / 导入 / 详细错误 / 跨源 / 重启后仍在）
node tests/check-frontend-api.mjs   # 前端出口：21 项（后端在=全通；后端不在=详细报错且不假装成功）
node tests/check-account-panel.mjs  # 设置页面板：15 项（界面注册登录 / 旧数据自动导入 / 详细报错）
node tests/check-deploy-e2e.mjs     # 部署形态：16 项（两个源各自启动 / 跨源写数据 / 重启后端数据仍在）
```

---

## 八、数据存在哪里（本地键 ↔ 后端文档）

**每个账号一份，互不可见** —— 规则只有一处实现：`src/userScope.js`。
登录后本地键名一律写成 `interweaver.u<id>.<原名>`（`<id>` = 用户 id）；未登录（访客 / 离线）
仍用改动前的全局键，行为不变。

**登录 + 在线**时，三类用户文档以**后端为准**，本地只留一份**镜像**
（开屏更快；成就页这类独立页面也要跨页读到同一份）：

| 后端文档（`/api/v1/<kind>`，按 `user_id` 隔离） | 本机镜像键（登录账号） | 访客 / 离线（旧全局键） |
|---|---|---|
| `settings` | `interweaver.u<id>.settings.v1` | `interweaver.settings.v1` |
| `progress` | `interweaver.u<id>.progress.v1` | `interweaver.progress.v1` |
| `draft` | `interweaver.u<id>.draft.v1` | `interweaver.draft.v1` |

每次改动都尝试同步落后端（`PUT /{settings,progress,draft}`）。**未登录时根本不发这个请求**
（本地那份就是全部）；离线时请求会失败，但**绝不假装成功**（不静默当成"已经存到服务器"）——
本地照旧写好，连接状态由 `api.js` 的 `onBackendState` 如实上报给面板。

- **临时界面状态** `live`（"正在使用中"的知识点，60 秒 TTL，成就页跨页读取）只走本地，
  但**同样按账号分键**（`interweaver.u<id>.live.v1`）—— 账号 2 不该看到账号 1 刚刚用过的知识点。
- **浏览器级偏好**也是**一人一份**：主题 `interweaver.theme`、音效开关 `interweaver.sfx`、
  成就拍摄开关 `interweaver.shots`、成就详情卡位置 `interweaver.detailPos`，
  登录后同样落在 `interweaver.u<id>.*`。
- **升级前留在全局键里的旧值会被"认领"**：登录 / 注册成功时 `claimLegacy()` 把它复制进该账号的
  命名空间、打上归属标记（`interweaver.scope.v1`）并清掉全局键；在那之前本人的读路径仍能回退看到它，
  所以不会出现"升级后设置被重置"。一份旧数据**只归一个账号**：数据不会丢，但别的账号与访客从此读不到。
  登录页的"旧数据自动导入"（`POST /import`，只填空位）共用同一份归属标记，因此同一份旧数据只导一次。

- 前端静态服务目前会把整个 `app/` 目录（含 `tests/`）当作静态资源发。若部署到公网，
  建议把静态根目录收窄到"只有页面与 `src/`"（这是 `server.mjs` 的一处改动，随时可做）。
