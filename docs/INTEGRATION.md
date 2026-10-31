# 浏览器与 VS Code 联动实现（3.0 预览版）

浏览器插件独立运行；VS Code Companion 为可选组件。本版采用只监听 127.0.0.1 的认证 HTTP 短轮询，而不是永久 WebSocket，配合 MV3 alarm 恢复连接。

## 组件

- vscode/bridge.cjs：一次性配对、长随机凭据、来源与 Host 校验、提交任务状态机。
- vscode/extension.cjs：自由选择编辑器、选区、未保存缓冲区或其他文件；目标题目与语言独立选择；任务树与判题提示。
- vscode/samples.cjs：经用户确认，在临时目录编译 C++ 快照并运行网页样例。
- bridge-worker.mjs：本机连接、任务投递、CF 源码摘要核对、编号绑定和结果反馈。
- companion.mjs：当前题与样例同步、原生提交表单填入、原生结果行读取。
- editor-adapter.js：MAIN world 中仅同步 CodeMirror 与 textarea，不执行收到的代码、不点击 Submit。
- bridge-popup.mjs：Chrome 工具栏弹窗的配对与可选权限请求。

## 配对与调度

VS Code 生成 24 个随机字节的一次性码，5 分钟有效。用户在 Chrome 输入后换取 32 字节随机凭据；VS Code 使用 SecretStorage 保存。服务校验 Host、Origin、扩展 ID 和凭据，不接受普通网页调用，不需要 GitHub token 或 CF API Key。

Chrome 的本机访问权限为可选权限，仅用户点击连接后申请。未配对时不访问本机服务。前台 CF 页面约每 4 秒请求后台检查，alarm 约每 30 秒检查，受 Chrome 调度影响。CF API 始终共用 2.2 秒队列。

## 提交任务

每次任务使用 UUID，并保存代码快照和摘要。文件与题目互不绑定，不创建或覆盖固定题号文件。状态为 queued → opened → prepared → submitted → judging → finished；另有 cancelled、expired、interrupted、error。

Chrome 在目标 CF 提交页填入题号、语言和代码，检测到不同草稿时拒绝覆盖。Submit 由用户点击；验证码、登录和网页语言选择仍由用户确认。不会自动提交或在断线后重发。

任务元数据落盘，源码不写入提交历史或日志。重启 VS Code 后未完成任务标记为 interrupted，用户需重新准备。取消任务不撤销已发送给 CF 的提交。

## 结果绑定

准备表单时读取账号提交基线；用户点击 Submit 时记录时间及实际源码摘要。候选必须匹配账号、题号、时间范围，且编号高于基线。只有唯一候选且可读取 CF 提交源码核对摘要时，才自动绑定。

多个候选、源码不可见或 API 不可用时，用户在 my/status 页面明确选择刚提交的那一行。绑定后只接受同一 submissionId 的反馈，不将“最近一条”直接当成本次结果。公开 API 和浏览器原生结果行均可更新状态。

源码核对使用正常 CF 登录会话 GET 自己的提交页；不读取 Cookie 的值，不将历史源码传给 VS Code。正式比赛中接口和源码的可见性由 CF 决定，不可确认时保持等待。

## 当前范围与验证

已实现自由提交与反馈、从场次选题、打开网页题目、C++ 本地样例测试。没有自动 Submit、正式比赛倒计时切题、VS Code 题面翻译或云同步。

47 项自动化测试包含真实 loopback HTTP、VS Code API 模拟命令、身份与源码核对、歧义提交绑定、原生表单适配及实际 C++ 编译运行。没有在用户账号上代提交，也没有通过 Chrome/VS Code 真机安装验收。
