# 部署到 Coolify（Docker Compose）

> 适用于 P1 起的 Node 后端（`server/`）。当前这一期只承载 Discord 分享页
> `discord.nanako.org`；API（P3a）和 Discord bot（P4）之后会加进同一个
> `compose.yaml`。整体方案见 [DESIGN-v4-discord-coolify.md](DESIGN-v4-discord-coolify.md)。

## 组成

| 部分 | 作用 |
|---|---|
| `Dockerfile` | 一个镜像给所有 Node 服务用。多阶段构建，运行层只有生产依赖和打包后的 `server/dist` |
| `.github/workflows/image.yml` | PR 上只构建（验证 Dockerfile）；合并到 `main` 后推送 `ghcr.io/nanako1900/gamescoreboard:<sha>` 和 `:latest` |
| `compose.yaml` | Coolify 部署的 stack：`app`（Node）+ `cloudflared`（出站隧道） |

## 一次性准备（需要你在各家后台操作）

1. **GHCR 镜像可拉取**：第一次推送后，到 GitHub → Packages → `gamescoreboard` →
   Package settings，把可见性改成 Public；或者在 Coolify 里给这个 registry 配一个只读 PAT。
2. **Cloudflare Tunnel**：Zero Trust → Networks → Tunnels → Create tunnel，复制 token。
   在 Public Hostnames 里加：`discord.nanako.org` → `http://app:8787`。
   （如果你更想用 Coolify 自带的 Tunnel 集成，就删掉 compose 里的 `cloudflared` 服务。）
3. **Coolify**：New Resource → Docker Compose，指向这个仓库的 `compose.yaml`。
   环境变量（全部标成 runtime-only，不要勾 build variable）：

   | 变量 | 值 |
   |---|---|
   | `CLOUDFLARE_TUNNEL_TOKEN` | 第 2 步的 token |
   | `INVITE_CODE` | 一个**永不过期**的邀请码（`discord.gg/` 后面那段）。留空则用 widget 的轮换邀请 |
   | `APP_TAG` | 可选；默认 `latest`，回滚时填旧的 git sha |
   | `SHARE_HOST` / `SITE_URL` / `SITE_NAME` / `GUILD_ID` | 默认值已经是现在线上的配置，一般不用改 |

## 把 discord.nanako.org 从 Worker 切到 Coolify

1. Coolify 上的 stack 起来后，先确认健康检查是绿的。可以临时给 Tunnel 加一个
   `discord-next.nanako.org` 先访问一遍。
2. 在 DC 仓库（`discord-share`）里：Cloudflare 后台 → Workers & Pages →
   `discord-share` → Settings → Domains & Routes，**删掉 Custom Domain**
   `discord.nanako.org`；同时在 Builds 里断开仓库连接，否则下一次推送又会把域名建回来。
3. 在 Tunnel 的 Public Hostnames 里加上 `discord.nanako.org` → `http://app:8787`。
4. 打开 https://discord.nanako.org 、把链接发到 Discord 里看预览卡片。

回滚：删掉 Tunnel 里的 hostname，恢复 Worker 的 Custom Domain。

## 缓存与源站故障

分享页 HTML 的响应头是 `Cache-Control: public, max-age=0, s-maxage=60, stale-if-error=86400`。
Cloudflare 默认不缓存 HTML，需要加一条 Cache Rule：Hostname 等于 `discord.nanako.org`
且 URI Path 等于 `/` → Eligible for cache，Edge TTL 用源站的 header。
**上线前实测一次**：在 Coolify 里停掉 `app`，确认 Cloudflare 仍返回旧页面。

## 监控

- 外部监控（UptimeRobot / Better Stack）检查 `https://discord.nanako.org/healthz`，
  告警发 Discord webhook。它不能依赖这台主机，主机挂了才发得出来。
- `/healthz` 只代表进程活着，不检查 Discord：Discord 出问题时容器不会被反复重启。

## 部署与回滚

- Coolify 的 compose 部署是先停后起，每次大约中断 30–60 秒，尽量深夜操作。
- 回滚：把 `APP_TAG` 改回上一个 git sha，重新部署。
