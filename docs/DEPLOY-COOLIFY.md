# 部署到 Coolify（Docker Compose）

> 服务器有公网 IP，流量经服务器上的反向代理进来，不用 Cloudflare Tunnel。反向代理二选一：
> **Coolify 自带的代理**，或者服务器上已经占着 80/443 的 **1Panel（OpenResty）** 等面板，见「给 `app` 配域名」。
> 这一套服务承载 API `capi.nanako.org`（PostgreSQL）、Discord 分享页 `discord.nanako.org` 和 Discord bot。
> `API_HOST` 为空时 API 不启动；把数据从 D1 迁过来、打开 API 的步骤见 [DEPLOY-CUTOVER.md](DEPLOY-CUTOVER.md)，
> bot 见 [DEPLOY-DISCORD.md](DEPLOY-DISCORD.md)。

## 组成

| 部分 | 作用 |
|---|---|
| `Dockerfile` | 一个镜像给所有 Node 服务用。多阶段构建，运行层只有生产依赖和打包后的 `server/dist` |
| `.github/workflows/image.yml` | PR 上只构建（验证 Dockerfile）；合并到 `main` 后推送 `ghcr.io/nanako1900/gamescoreboard:<sha>` 和 `:latest` |
| `compose.yaml` | `postgres` + `migrate`（一次性，跑完退出）+ `app`（API 和分享页，监听 8787）+ `bot`（只往外连 Discord）。`pg-backup` 注释着，见 [DEPLOY-CUTOVER.md](DEPLOY-CUTOVER.md) |

只有 `app` 对外：反向代理把各个域名转到 `app` 的 8787 端口。`app` 另外映射在宿主机的
`127.0.0.1:8787`（`APP_HOST_PORT` 可改），给宿主机上的代理（例如 1Panel）用，只绑本机回环，外网连不到。
`postgres` 和 `bot` 不映射任何端口，只在这套服务自己的内网里。

## 一次性准备

1. **镜像可拉取**：GHCR 上的 `gamescoreboard` 已是 Public，Coolify 直接拉。若以后改回私有，
   在 Coolify 里给 `ghcr.io` 配一个只读 PAT。
2. **服务器防火墙**：80 和 443 对外开放（签证书和接收访问都靠它们）。不需要开别的端口，
   8787 也不用开（它只绑在 `127.0.0.1`）。
3. **Coolify**：项目里 + New → Resource → **Public Repository**：
   - 仓库 `https://github.com/Nanako1900/gameScoreBoard`，Branch `main`，Build Pack 选 **Docker Compose**；
   - Base directory 填 `/`，Compose file 填 `/compose.yaml`（文件名一字不差，不是 `docker-compose.yaml`）；
   - 各服务的域名先都不填，见下一节。
4. **环境变量**（Build Variable 一律不勾）：

   | 变量 | 值 |
   |---|---|
   | `APP_TAG` | 建议固定成某个 git sha（GHCR 上的 tag），回滚时改回旧的 sha。留空则用 `latest` |
   | `JOBS_ENABLED` | `false`。API 打开、数据导入完成之后再改成 `true` |
   | `API_HOST` | 留空。导入数据之后才填，见 [DEPLOY-CUTOVER.md](DEPLOY-CUTOVER.md) |
   | `INVITE_CODE` | 可选：一个**永不过期**的邀请码（`discord.gg/` 后面那段）。留空则用 widget 的轮换邀请 |
   | `SHARE_HOST` / `SITE_URL` / `SITE_NAME` / `GUILD_ID` | 默认值就是现在线上的配置，一般不用改。`SHARE_HOST` 可以逗号分隔多个主机名 |
   | `SERVICE_PASSWORD_POSTGRES` | Coolify 自动生成。**部署后不要再改**：postgres 只在第一次初始化时用它，之后改了就连不上 |
   | `APP_HOST_PORT` | 可选：`app` 在宿主机 `127.0.0.1` 上的端口，默认 `8787`。宿主机上 8787 已被占用时才改 |
   | API 的变量（`OAUTH_CLIENT_SECRET`、`SESSION_SECRET`…） | 打开 API 时才需要，之前留空即可 |
   | `AI_CONFIG_MASTER_KEY` | 开启网页 Key 管理前，用 `openssl rand -base64 32` 一次生成并持久保存；app + bot 必须同值 |
   | `AI_API_KEY` | 可选旧实例兼容；数据库已有设置或清除标记后不再使用 |

5. **Deploy**。预期：
   - `postgres` healthy；
   - `migrate` 跑完 `server/migrations/` 里的迁移后以 0 退出。Coolify 可能把它显示成 exited，这是正常的
     （`compose.yaml` 里不能加 Coolify 专用的 `exclude_from_hc`：标准 `docker compose` 会因此拒绝整个文件，
     而导入数据时要在主机上用它）；
   - `app` healthy；
   - `bot` healthy 但空闲（没填 `DISCORD_TOKEN` 时不连 Discord）。

## 管理页配置 AI

`compose.yaml` 将同一个运行时 `AI_CONFIG_MASTER_KEY` 传入 app 与 bot，两者共用 PostgreSQL 中的已提交配置。主密钥需独立于 `SESSION_SECRET`，只生成一次，存入密码管理器并备份；不能每次部署重新生成。数据库备份需配套保管对应的原主密钥，并分开存放。

1. 在 Coolify 保存主密钥（runtime-only），**Redeploy 整个 stack**，让 app 和 bot 都拿到同一值。
2. 管理员到 `/admin/ai` 录入端点、模型、API Key，并设置启用、温度和三套提示词；这些提供商配置无需另设环境变量。Key 仅以 AES-256-GCM 密文进入现有 `app_settings`，无需 SQL 迁移。
3. 先保存，再网页试跑（使用已保存配置、不改分）；有未保存修改时先保存。随后通过 Discord 测试案件提交陈述，核验 bot 也成功调用。
4. 日常保留、更换、清除 Key 都无需 Redeploy：输入留空保留原值；明确清除会停用 AI，旧环境 Key 不会复活。下一次网页或 bot 调用读取最新提交配置。

迁入前可以继续保留旧 `AI_API_KEY`，完成网页与 bot 验收后再移除；凭据行存在后它不再生效。主密钥缺失、错配或密文损坏时 AI 走既有回退，公开配置仍返回正常响应；恢复原主密钥后可读取同一密文。丢失原主密钥时，只能在管理页重新录入提供商 Key。

## 给 `app` 配域名

看服务器的 80/443 被谁占着，两种方式选一种：

- 只有 Coolify：用 Coolify 自带的代理，见「方式一」。
- 装了 1Panel、宝塔、Nginx Proxy Manager 这类面板（它们的 OpenResty / Nginx 占着 80/443，Coolify 的代理起不来）：
  见「方式二」。这时在 Coolify 里给服务加的域名不会生效，可以删掉。

无论哪种方式，`app` 只回答 `SHARE_HOST` 和 `API_HOST` 里列出的主机名，其余一律 404。加了域名之后，
还要把它写进对应的变量（分享页 → `SHARE_HOST`，API → `API_HOST`），才有内容。

### 方式一：Coolify 自带的代理

每个对外的域名都配在 **`app`** 这个服务上，其他服务不配。

1. **DNS**：Cloudflare → `nanako.org` → DNS，加一条 A 记录，名称是子域（例如 `capi`），内容是服务器公网 IP。
   代理状态先选 **DNS only（灰色云朵）**，让证书顺利签下来。
2. **Coolify**：`app` 服务 → Add domain：

   | 字段 | 填 |
   |---|---|
   | Service | `app` |
   | Protocol | `https` |
   | Domain | 例如 `capi.nanako.org` |
   | Port | **`8787`**（灰字的 3000 只是占位，填错会 502） |
   | Path | 留空 |

3. 保存后 **Redeploy**。DNS 生效后 Coolify 自动签证书，通常一分钟内完成。

**先有 DNS，再加 Coolify 域名**：DNS 还指着别处时就加，Let's Encrypt 验证会失败，连续失败几次会被限流一小时。

以后想打开橙色云朵（例如让分享页走 Cloudflare 缓存），先确认证书已经签好，再把 Cloudflare 的
SSL/TLS 模式设为 **Full (strict)**。

### 方式二：服务器上已有 1Panel（OpenResty）

由 1Panel 转发到 `app` 在宿主机上的端口 `http://127.0.0.1:8787`。`compose.yaml` 已经把它映射出来，
只绑本机回环，外网连不到；1Panel 的 OpenResty 用宿主机网络运行，所以能访问到。宿主机上 8787 被占用时，
在 Coolify 里设 `APP_HOST_PORT`，下面的端口跟着改。

1. **DNS**：Cloudflare → `nanako.org` → DNS 加 A 记录（例如 `capi`）→ 服务器公网 IP。
   橙色云朵、灰色云朵都可以，证书的差别见第 3 步。
2. **1Panel → 网站 → 创建网站 → 反向代理**：

   | 字段 | 填 |
   |---|---|
   | 主域名 | 例如 `capi.nanako.org` |
   | 代理地址 | `http://127.0.0.1:8787` |

   建好后打开这个站点的反向代理设置，确认**发送域名是 `$host`**。`app` 靠 Host 区分 API 和分享页，
   发出去的是 `127.0.0.1` 就只会得到 404。
3. **HTTPS**：在这个站点的 HTTPS 设置里开启，证书二选一：
   - **橙色云朵**：用 Cloudflare 源站证书。Cloudflare → SSL/TLS → Origin Server → Create Certificate，
     在 1Panel 的证书管理里手动上传，站点 HTTPS 选它；Cloudflare 的 SSL/TLS 模式设为 **Full (strict)**。
   - **灰色云朵**：在 1Panel 里给这个域名申请 Let's Encrypt 证书。

   只开 HTTP 不行：橙色云朵在 Full / Full (strict) 模式下按 HTTPS 回源，请求会落到 OpenResty 的默认站点，
   返回它的 404。也不要为此把 Cloudflare 改成 Flexible，那是整个 `nanako.org` 的设置，会影响其他子域。
4. 在服务器上自检（不经过 Cloudflare 和 1Panel，直接问 `app`）：

   ```bash
   curl -s http://127.0.0.1:8787/healthz                                   # ok
   curl -s -H 'Host: capi.nanako.org' http://127.0.0.1:8787/api/config    # API 打开后返回 JSON
   ```

| 从外面看到的 | 原因 |
|---|---|
| openresty 的 404 页面 | 请求没匹配上 1Panel 的站点：多半是只开了 HTTP 而 Cloudflare 按 HTTPS 回源，或者主域名写错 |
| 502 Bad Gateway | 站点匹配上了，但 `127.0.0.1:8787` 上没有服务：`app` 没起来，或者 Coolify 跑的还是没有端口映射的旧 compose（Redeploy 一次） |
| `{"error":"Not found"}`（JSON） | 已经到了 `app`，但这个主机名不在 `API_HOST` / `SHARE_HOST` 里，或者发送域名不是 `$host` |
| 526 | 橙色云朵 + Full (strict)，但源站证书不被 Cloudflare 认可（没装源站证书或 Let's Encrypt 证书） |

## 把 discord.nanako.org 从 Worker 切到 Coolify

1. **预检**：
   - DNS 加 A 记录 `discord-next` → 服务器 IP（DNS only）；
   - `app` 加域名 `https://discord-next.nanako.org`、端口 8787；
   - `SHARE_HOST` 设成 `discord.nanako.org,discord-next.nanako.org`，Redeploy；
   - 打开 https://discord-next.nanako.org 看一遍。
2. 在 DC 仓库（`discord-share`）对应的 Worker：Cloudflare 后台 → Workers & Pages → `discord-share` →
   Settings → Domains & Routes，**删掉 Custom Domain** `discord.nanako.org`；同时在 Builds 里断开仓库连接，
   否则下一次推送又会把域名建回来。
3. DNS 加 A 记录 `discord` → 服务器 IP（DNS only），然后 `app` 加域名 `https://discord.nanako.org`、端口 8787，
   Redeploy。证书签下来之前（约一分钟）HTTPS 会报错。
4. 打开 https://discord.nanako.org ，把链接发到 Discord 里看预览卡片。
5. 收尾：删掉 `discord-next` 的域名和 DNS 记录，`SHARE_HOST` 改回默认值。

用 1Panel（方式二）的话，第 1、3 步里「`app` 加域名」换成在 1Panel 里加对应的反向代理站点
（同样指向 `http://127.0.0.1:8787`、发送域名 `$host`、开 HTTPS），Coolify 里只改 `SHARE_HOST`。

回滚：删掉 `discord` 的 A 记录和 Coolify（或 1Panel）里的这个域名，恢复 Worker 的 Custom Domain。

## 缓存与源站故障

服务把最近一次成功拉到的 Discord 数据写进 `app-data` 卷（`/data/share-snapshot.json`）。
重启、部署、OOM 之后如果 Discord 恰好连不上，页面照样渲染上一次的数据，并显示「数据可能有延迟」。

分享页 HTML 的响应头是 `Cache-Control: public, max-age=0, s-maxage=60, stale-if-error=86400`，
只有前面有 CDN 时才起作用。DNS only 时没有边缘缓存，`app` 停着（包括每次部署的 30–60 秒）页面就打不开。
想要「源站挂了也有旧页面」，就给 `discord` 打开橙色云朵（SSL/TLS 设 Full (strict)），再加一条 Cache Rule：
Hostname 等于 `discord.nanako.org` 且 URI Path 等于 `/` → Eligible for cache，Edge TTL 用源站的 header。
加完实测一次：在 Coolify 里停掉 `app`，确认 Cloudflare 仍返回旧页面。

## 监控

- 外部监控（UptimeRobot / Better Stack）检查 `https://discord.nanako.org/healthz`，API 打开后再加
  `https://capi.nanako.org/status`（关键字 `"ok":true`），告警发 Discord webhook。监控不能依赖这台主机，
  主机挂了才发得出来。
- `/healthz` 只代表进程活着，不检查 Discord 和数据库：它们出问题时容器不会被反复重启。

## 部署与回滚

- Coolify 的 compose 部署是先停后起，每次大约中断 30–60 秒，尽量深夜操作。
- 回滚：把 `APP_TAG` 改回上一个 git sha，重新部署。P3a 之前的镜像没有数据库迁移，`migrate` 会直接跳过；
  但 API 切到 Coolify 之后只能回到 P3a 及以后的镜像，更早的没有 API。
