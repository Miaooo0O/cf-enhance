# CF Random · 随机跳题

一个轻量的 Chrome 扩展：限定 Codeforces 标签和题目分数，一键随机跳题。纯 JavaScript，无需构建、登录或 API Key。

## 安装（Chrome）

1. 下载本仓库：绿色 **Code → Download ZIP**，解压到一个固定目录。
2. Chrome 地址栏输入 `chrome://extensions/`。
3. 打开右上角的「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择含 `manifest.json` 的文件夹。
5. 在 Chrome 工具栏的拼图菜单中固定 **CF Random · 随机跳题**。

这是从 GitHub 安装的扩展，尚未上架 Chrome 应用商店。不要删除安装时选择的文件夹。

## 使用

- Codeforces 首页右下角会出现「随机跳题 ↗」按钮，点击直接打开筛选面板；设置和记录与工具栏弹窗共用。
- 更新本地版本后，在 `chrome://extensions/` 点击本扩展的重新加载按钮，再刷新 Codeforces 首页即可看到新按钮。

- 设置最低和最高 rating，相同数值表示只抽该分数；两端都包含。
- 标签支持多选、英文或中文搜索；不选标签表示不限。
- 可选择「同时包含所选标签」或「包含任意所选标签」。
- 点击「随机跳一道」，题目会在新的后台标签页打开；点击弹窗下方的题目链接可立即前往。
- 默认不重复抽取已经跳转过的题。抽完后可以重置记录，或关闭不重复选项。
- 分数、标签和抽题记录会保存在当前 Chrome 配置中。

首次打开需要从 Codeforces API 获取题库。题库缓存 24 小时；可手动刷新。刷新失败时优先使用旧缓存；如果没有缓存，请检查网络后重试。

只抽有 rating 的题目。重复排除针对本扩展抽题记录，**不排除账号已经 AC 的题目**。题库以 Codeforces `problemset.problems` API 返回的数据为准，不覆盖整个 Gym。

## 权限与隐私

只申请 `storage` 和 `https://codeforces.com/*` 的访问权限，用于保存本地设置和获取题库。不读取浏览历史、Cookie、提交记录或账户信息；不发送统计数据。题库请求省略账户凭据。

## 开发与验证

无需依赖，修改文件后在扩展管理页点击重新加载。

```sh
node --test core.test.mjs
node --check popup.mjs
```

数据来源：[Codeforces API](https://codeforces.com/apiHelp/methods#problemset.problems)。扩展使用 [Chrome Manifest V3](https://developer.chrome.com/docs/extensions/reference/manifest)。本项目与 Codeforces 无隶属关系。
