# 浏览器与 VS Code 联动实现（3.2 预览版）

浏览器插件独立运行；VS Code Companion 为可选组件。本版采用只监听 127.0.0.1 的认证 HTTP 短轮询，而不是永久 WebSocket，配合 MV3 alarm 恢复连接。

## 组件

- vscode/bridge.cjs：一次性配对、长随机凭据、来源与 Host 校验、提交任务状态机。
- vscode/extension.cjs / controller.cjs：可视面板控制器、实时编辑器与选区、文件选择、提交快照、任务树与判题提示。
- vscode/panel.cjs / media/：原生主题侧栏 Webview，CSP 限制为本地资源，元数据使用 textContent 渲染；动作白名单、串行处理，代码与认证凭据不传入 Webview。
- vscode/ports.cjs：系统分配空闲端口，工作区记忆、重启优先复用、EADDRINUSE 自动换端口；旧默认端口迁移。
- vscode/judge-store.cjs：按文件保存用例，导入去重、保留手写修改与版本校验。
- vscode/judge-runner.cjs / media/judge.js：离线 C/C++/Python 评测、输入输出编辑、单例/批量运行、停止、结果及陈旧标记。
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

新任务带有 autoSubmit 标记，由 VS Code 明确点击“提交”授权。Chrome 在后台标签页填入题号、语言和代码，检测到不同草稿时拒绝覆盖。核对表单、代码和语言后，先在 worker 持久记录单次 autoAttempt，再点击原生 Submit。刷新、恢复或断线不重复发送；验证码或校验错误通过 bridgeFailed 反馈到 VS Code。旧任务未带标记时保留原行为。

任务元数据落盘，源码不写入提交历史或日志。重启 VS Code 后已发送任务保留 submitted/judging 状态，仅恢复接收反馈；未发送任务标记 interrupted，需要重新准备。取消任务不撤销已发送给 CF 的提交。

## 结果绑定

准备表单时读取账号提交基线；点击原生 Submit 前记录时间及实际源码摘要。候选必须匹配账号、题号、时间范围，且编号高于基线。原提交标签页的唯一新结果可直接绑定；API 补充路径仍核对时间范围和源码摘要。

网页原生结果优先，支持 contest/my、contest/status、problemset/status 与个人提交页；多候选无法确认时保留手动关联。联动消息与 CF API 查询分开调度，反馈采用持久队列，断线后按顺序补发；网页手动提交通过 observed 事件导入本机反馈列表。绑定后只接受同一 submissionId 的反馈，不将“最近一条”直接当成本次结果。公开 API 和浏览器原生结果行均可更新状态。

源码核对使用正常 CF 登录会话 GET 自己的提交页；不读取 Cookie 的值，不将历史源码传给 VS Code。正式比赛中接口和源码的可见性由 CF 决定，不可确认时保持等待。

## 当前范围与验证

已实现从 VS Code 一键自动提交与反馈、从场次选题、打开网页题目、C++ 本地样例测试。没有正式比赛倒计时切题、VS Code 题面翻译或云同步。

76 项自动化测试包含真实 loopback HTTP、VS Code API 模拟命令与可视提交、面板脚本交互、端口冲突恢复、身份与源码核对、歧义提交绑定、原生表单适配及实际 C++ 编译运行。没有在用户账号上代提交，也没有通过 Chrome/VS Code 真机安装验收。

提交页“我的提交”基线请求限时 6 秒，不等待公共 API。自动新建标签页允许替换站点恢复的旧代码，手动编辑或恢复已有标签页仍保护草稿。45 秒未准备、60 秒未取得编号时提示具体状态，不自动重复发送。导航上下文按标签页保存，AC 后随机和有序前进相互独立。

Companion 0.6.0 测试与提交合并同屏，运行使用独立调度，不阻塞提交。本地动作不等待浏览器连接。用例保存在工作区 Memento，编译使用临时目录和代码快照，不覆盖源文件。Windows 停止时只终止本次拥有的进程树。修改用例按 revision 隐藏旧结果，修改代码按 document.version 标记旧结果。

Chrome 3.3.0 新增题单软删除：canonical trainings 与 trainingTrash 同步更新并清理 legacy training，防止删除后旧版本迁移复活。撤销恢复原顺序、分组与看题记录；不修改 history/drawLog/account。

## 3.4 / Companion 0.6 性能与界面

用例标题栏始终包含独立折叠、运行、删除。前端按用例 ID 复用节点，保存折叠状态，180ms 合并输入，运行前立即 flush。答案有值时自动 compare，清空则关闭；不显示重复输出标题。目标题目和最近任务未变化时不重建节点，编辑器事件合并并缓存文本长度。

compile-cache.cjs 在当前扩展宿主保留一个临时构建。代码、编译器身份、环境与目录组成缓存键，GCC -MD 依赖内容摘要校验头文件；依赖读取失败则下次重新编译。失败与取消清空缓存，deactivate 在停止进程后清理拥有的目录。

i18n-start.js 由 npm run build:i18n 从 i18n.mjs 与 tags.mjs 生成，与 page-start.js 一起 document_start 执行。只将非敏感显示偏好镜像到 CF localStorage，扩展存储是权威来源；解析阶段观察新增 UI 并翻译，不隐藏整页或翻译题面。题单 URL 提前加 class，用早期 CSS 隐藏原生题库，独立题单挂载后显示；初始化并行读取本地信息，不提前拉取完整题库。随机和历史面板各只挂载一次，pagehide 统一清理。
