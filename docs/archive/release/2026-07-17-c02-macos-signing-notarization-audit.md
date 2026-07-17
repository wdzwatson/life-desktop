# C-02 macOS 签名与公证条件检查

日期：2026-07-17
任务：C-02
状态：已完成检查，发布条件阻塞

## 1. 检查结果

| 项目 | 当前证据 | 结论 |
|---|---|---|
| Developer ID Application 证书 | `security find-identity -v -p codesigning` 返回 `0 valid identities found` | 当前机器没有可用签名身份 |
| entitlements 文件 | 仓库未发现 `*.entitlements` | 尚未定义应用权限边界 |
| hardened runtime | `package.json` 未配置 `hardenedRuntime` | 未达到 macOS 公证准备条件 |
| notarization credentials | 未发现 `APPLE_ID`、团队 ID、App-specific password 或 keychain profile 配置 | 无法执行公证提交 |
| notarization history | `xcrun notarytool history` 无可用记录 | 没有历史公证验收证据 |
| electron-builder signing config | 仅配置 macOS dmg/zip 目标，没有证书 identity 或公证参数 | 可以生成未签名/临时产物，不能宣称可分发 |
| native modules | `better-sqlite3` 等原生依赖存在 | 签名时需确认主程序、helper、原生模块和产物内二进制一致签名 |

## 2. 必须补齐的条件

发布负责人需要在安全凭据管理中准备，不应把密钥写入仓库：

1. Apple Developer Program 团队与 Developer ID Application 证书。
2. 应用 Bundle ID 与 `com.wdzwatson.lifedesktop` 的注册和权限确认。
3. `entitlements.mac.plist`，只声明实际需要的权限。
4. hardened runtime 配置。
5. 公证用 Apple ID + team ID + app-specific password，或 App Store Connect API key。
6. CI secret / keychain profile 的安全注入方式。
7. 签名后执行 `codesign --verify --deep --strict --verbose=2`、`spctl --assess` 和 `xcrun stapler validate`。

## 3. 建议的最小配置方向

在获得证书和权限后，再添加最小化配置：

```json
{
  "mac": {
    "hardenedRuntime": true,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist",
    "target": ["dmg", "zip"]
  }
}
```

示例只表达配置方向，不代表当前已经具备可用证书或公证权限。权限文件必须根据 Electron helper、视频工具和原生数据库模块的实际运行情况最小化确认。

## 4. 风险与处理

- 没有有效 identity 时，不执行伪造签名或把未签名包当作正式 RC 发布。
- 没有公证凭据时，可以继续做源码构建和本地启动验证，但 Gatekeeper 验收必须阻塞。
- macOS 视频工具下载、SQLite 原生模块和自动更新都可能触发签名/公证边界问题，必须在真实安装包上验证。
- 证书、密码和 API key 不进入 Git、日志或归档文档；归档只记录是否具备条件。

## 5. 验收状态

- [x] 检查仓库是否存在签名、entitlements 和公证配置。
- [x] 检查当前机器可用签名身份。
- [x] 检查当前机器公证历史。
- [x] 记录最小配置方向和验证命令。
- [ ] 安装 Developer ID 证书，转入发布负责人操作。
- [ ] 配置 hardened runtime 与 entitlements。
- [ ] 完成一次签名包验证。
- [ ] 完成一次公证并 stapler 验证。

## 6. 证据索引

- 应用构建配置：`package.json`
- 更新与 Electron 运行边界：`electron/main.ts`
- C-01 更新配置审计：`docs/archive/release/2026-07-17-c01-production-update-config-audit.md`
- 本次本机检查：`security find-identity`、`xcrun notarytool history`

## 7. 结论

C-02 的检查工作已完成，结果为发布阻塞：当前仓库没有签名/公证配置，本机也没有有效 codesigning identity。后续必须由具备 Apple Developer 权限的发布负责人补齐凭据与配置，完成真实签名、公证和 Gatekeeper 验证后，才能进入正式发布候选阶段。
