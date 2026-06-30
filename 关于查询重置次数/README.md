# 查询 Codex rate-limit reset credits

这个目录里的脚本会读取本机 `~/.codex/auth.json` 中的 `tokens.access_token`，请求：

`https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`

脚本只输出：

- `available_count`
- 每个 credit 的 `status`
- 每个 credit 的 `title`
- `granted_at` 转换后的上海时间
- `expires_at` 转换后的上海时间

不会输出 `access_token`、`refresh_token`、cookie 或完整唯一 ID。

## 用法

在 PowerShell 中运行：

```powershell
cd "F:\vscode代码\agent token 记录\关于查询重置次数"
.\query-rate-limit-reset-credits.ps1
```

如果当前 PowerShell 执行策略不允许直接运行脚本，可以用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\query-rate-limit-reset-credits.ps1"
```

输出 JSON：

```powershell
.\query-rate-limit-reset-credits.ps1 -AsJson
```
