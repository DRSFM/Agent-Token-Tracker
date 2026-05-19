# Codex 多账号免重复授权切换实现说明

本文整理自 `jlcodes99/cockpit-tools` 的 Codex 账号管理思路，用于在自己的 agent token 管理目录中复刻“多账号切换时不反复浏览器授权”的能力。

重点：这不是绕过登录或绕过 MFA。它的本质是保存每个账号合法 OAuth 授权后得到的 refresh token，并在切换时把目标账号的登录态写回 Codex 本地认证文件。

## 目标

- 支持导入多个 Codex OAuth 账号。
- 每个账号只需首次授权一次。
- 切换账号时不打开浏览器重新验证。
- access token 过期时自动用 refresh token 静默续期。
- 将目标账号写入 Codex 当前读取的 `auth.json`。
- 可扩展到多实例：不同实例使用不同 `CODEX_HOME` 或用户数据目录。

## 核心原理

Codex 的当前登录态主要存放在：

```text
%USERPROFILE%\.codex\auth.json
```

或由环境变量指定：

```text
CODEX_HOME\auth.json
```

项目把每个账号的 OAuth token 独立保存到自己的账号库中。切换时：

1. 读取目标账号记录。
2. 检查 access token 是否快过期。
3. 如需刷新，用 refresh token 请求 OAuth token endpoint。
4. 生成 Codex 兼容的 `auth.json`。
5. 原子写入 `CODEX_HOME/auth.json`。
6. 更新当前账号索引。

Codex 新会话读取新的 `auth.json` 后，就会以目标账号运行。

## 需要保存的数据

建议账号库按“一份索引 + 多个账号详情文件”保存。

示例目录：

```text
agent-token-store/
  codex_accounts.json
  codex_accounts/
    account_xxx.json
    account_yyy.json
```

索引文件示例：

```json
{
  "version": "1.0",
  "current_account_id": "account_xxx",
  "accounts": [
    {
      "id": "account_xxx",
      "email": "user@example.com",
      "plan_type": "Team",
      "created_at": 1760000000,
      "last_used": 1760001000
    }
  ]
}
```

账号详情示例：

```json
{
  "id": "account_xxx",
  "email": "user@example.com",
  "auth_mode": "oauth",
  "user_id": "chatgpt-user-id",
  "plan_type": "Team",
  "account_id": "chatgpt-account-id",
  "organization_id": "org-id",
  "tokens": {
    "id_token": "eyJ...",
    "access_token": "eyJ...",
    "refresh_token": "rt_..."
  },
  "token_updated_at": 1760000000,
  "requires_reauth": false,
  "created_at": 1760000000,
  "last_used": 1760001000
}
```

## Codex auth.json 格式

写回给 Codex 的文件可以按下面结构生成：

```json
{
  "auth_mode": "oauth",
  "OPENAI_API_KEY": null,
  "tokens": {
    "id_token": "eyJ...",
    "access_token": "eyJ...",
    "refresh_token": "rt_...",
    "account_id": "chatgpt-account-id"
  },
  "last_refresh": 1760001000
}
```

如果你的实现也支持 API Key 账号，可以另行支持：

```json
{
  "auth_mode": "apikey",
  "OPENAI_API_KEY": "sk-...",
  "base_url": "https://api.openai.com/v1"
}
```

但 API Key 账号和 ChatGPT/Codex OAuth 账号是两类登录方式，切换逻辑不要混在一起。

## 首次导入账号

支持三种导入方式即可。

### 1. 从当前 Codex 本机登录导入

读取：

```text
%USERPROFILE%\.codex\auth.json
```

解析其中：

- `tokens.id_token`
- `tokens.access_token`
- `tokens.refresh_token`
- `tokens.account_id`
- `last_refresh`

然后从 `id_token` JWT payload 中提取：

- email
- user id
- plan type
- account id
- organization id

导入后保存为账号详情，并加入索引。

### 2. 从 JSON 文件导入

允许用户选择或粘贴 JSON。兼容两类格式：

- 完整 `auth.json`
- 你自己的账号详情 JSON

导入时做字段归一化即可：

```text
auth.json -> account detail
account detail -> account detail
```

### 3. OAuth 授权导入

流程：

1. 生成 `code_verifier` 和 `code_challenge`，使用 PKCE。
2. 本地启动回调服务，例如 `127.0.0.1:1455/auth/callback`。
3. 打开 OpenAI OAuth 授权 URL。
4. 浏览器回调拿到 `code` 和 `state`。
5. 校验 `state`。
6. 用 `code + code_verifier` 交换 token。
7. 保存账号。

OAuth 关键点：

```text
authorization endpoint: https://auth.openai.com/oauth/authorize
token endpoint:         https://auth.openai.com/oauth/token
scope:                  openid profile email offline_access ...
```

`offline_access` 很关键，它通常用于获取可续期的 refresh token。

## Token 过期判断

access token 通常是 JWT。可以解析 JWT 第二段 payload，读取 `exp`。

伪代码：

```ts
function isJwtExpiredSoon(jwt: string, skewSeconds = 300): boolean {
  const payload = JSON.parse(base64urlDecode(jwt.split(".")[1]));
  const exp = payload.exp;
  if (!exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return exp < now + skewSeconds;
}
```

建议提前 5 分钟刷新，避免切换成功后马上过期。

## 静默刷新 token

当 access token 过期或快过期时，用 refresh token 请求 token endpoint。

请求示例：

```http
POST https://auth.openai.com/oauth/token
Content-Type: application/json

{
  "client_id": "<codex client id>",
  "grant_type": "refresh_token",
  "refresh_token": "rt_..."
}
```

返回后更新：

- `id_token`
- `access_token`
- `refresh_token`
- `token_updated_at`

注意：有时响应里不返回新的 refresh token，可以继续保留旧 refresh token。

刷新失败时：

- 不要覆盖当前 `auth.json`。
- 将账号标记为 `requires_reauth: true`。
- 保存错误原因。
- UI 或 CLI 提示需要重新授权。

## 切换账号流程

伪代码：

```ts
async function switchCodexAccount(accountId: string) {
  const account = loadAccount(accountId);

  if (account.auth_mode === "oauth") {
    if (isJwtExpiredSoon(account.tokens.access_token)) {
      account.tokens = await refreshTokens(account.tokens.refresh_token);
      account.token_updated_at = now();
      account.requires_reauth = false;
      saveAccount(account);
    }
  }

  const authJson = buildCodexAuthJson(account);
  atomicWrite(resolveCodexHome() + "/auth.json", JSON.stringify(authJson, null, 2));

  const index = loadAccountIndex();
  index.current_account_id = account.id;
  updateLastUsed(account);
  saveAccountIndex(index);
  saveAccount(account);
}
```

## CODEX_HOME 解析

按这个优先级：

1. 如果环境变量 `CODEX_HOME` 存在，使用它。
2. 否则使用默认目录：

```text
%USERPROFILE%\.codex
```

这样可以支持多实例：

```powershell
$env:CODEX_HOME="D:\codex-instances\work-account"
codex
```

不同实例只要使用不同 `CODEX_HOME`，就能拥有不同 `auth.json`。

## 原子写入

写 token 文件不要直接覆盖。建议：

1. 写入临时文件。
2. flush。
3. rename 替换目标文件。

伪代码：

```ts
function atomicWrite(path: string, content: string) {
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}
```

Windows 下注意如果目标被占用，rename 可能失败，需要重试或提示关闭 Codex。

## 并发锁

刷新 token 和切换账号需要加锁，避免两个进程同时刷新同一个账号，或者同时写 `auth.json`。

建议锁粒度：

- 每个账号一个刷新锁。
- 全局一个 `auth.json` 写入锁。

```text
locks/
  refresh_account_xxx.lock
  codex_auth_write.lock
```

## 多实例实现

基础版只切全局账号：

```text
%USERPROFILE%\.codex\auth.json
```

增强版支持实例：

```text
instances/
  account-a/
    auth.json
    config.toml
  account-b/
    auth.json
    config.toml
```

启动时设置：

```powershell
$env:CODEX_HOME="D:\agent-token-store\instances\account-a"
codex
```

每个实例目录写自己的 `auth.json`，互不影响。

## 安全注意事项

- refresh token 等同长期登录能力，必须按敏感凭据处理。
- 不要把账号库提交到 Git。
- 账号详情文件权限尽量限制为当前用户可读写。
- 导出 JSON 时默认隐藏或脱敏 token。
- 刷新失败不要打印完整 token。
- 日志只记录账号 id、邮箱、状态，不记录 token。
- 备份目录要加密或至少放在可信磁盘。
- 不要把本地 API 服务暴露到局域网，除非你明确需要并加鉴权。

## 失效场景

以下情况仍然需要重新授权：

- refresh token 被撤销。
- 用户修改密码或 MFA 策略。
- Business/Team 管理员撤销授权。
- 组织 SSO 重新验证。
- OpenAI 改变 Codex OAuth 或本地 auth 文件格式。
- 本地账号详情损坏或丢失。

## 最小实现清单

- `resolveCodexHome()`
- `readCodexAuthJson()`
- `parseAccountFromAuthJson()`
- `saveAccount()`
- `loadAccount()`
- `loadAccountIndex()`
- `saveAccountIndex()`
- `isJwtExpiredSoon()`
- `refreshTokens()`
- `buildCodexAuthJson()`
- `atomicWriteAuthJson()`
- `switchAccount(accountId)`
- `markAccountRequiresReauth(accountId, reason)`

## 推荐命令形态

如果做成 CLI，可以提供：

```bash
agent-token codex import-local
agent-token codex import-json ./auth.json
agent-token codex list
agent-token codex switch <account-id>
agent-token codex refresh <account-id>
agent-token codex reauth <account-id>
agent-token codex export --redact
```

## 参考源码

- OAuth 配置与 PKCE 登录：<https://github.com/jlcodes99/cockpit-tools/blob/main/src-tauri/src/modules/codex_oauth.rs>
- Token 刷新：<https://github.com/jlcodes99/cockpit-tools/blob/main/src-tauri/src/modules/codex_oauth.rs>
- Codex 账号导入/切换/写入：<https://github.com/jlcodes99/cockpit-tools/blob/main/src-tauri/src/modules/codex_account.rs>
- Codex 账号与 auth.json 数据结构：<https://github.com/jlcodes99/cockpit-tools/blob/main/src-tauri/src/models/codex.rs>
