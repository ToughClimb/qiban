# 栖伴 Android 开发与试用

Android 使用 Capacitor 8 的本地 WebView 和固定方法的 `Qiban` 原生插件。没有 Electron、Node 服务或网页密钥输入框。默认演示聊天离线运行；真人设定及宠物都是虚拟伙伴。首次打开可直接选择“先用演示聊天”。

## 构建

需要 Node 24、JDK 21、Android SDK 平台 36 和 Build Tools 35.0.0（AGP 默认）/36.0.0（签名检查）。最低 Android 7.0/API 24。设置 `JAVA_HOME`、`ANDROID_HOME`，安装依赖后：

```sh
npm ci
npm test
npm run android:sync
npm run android:test
npm run android:unsigned
npm run android:debug
npm run test:android-ui
```

`android:sync` 构建共享前端并复制进应用；只运行 Gradle 不会刷新前端。`tools/cap.mjs` 使用 Node 24 加载 TypeScript 配置，绕过固定版本 Capacitor CLI 8.0.0 与仓库 TypeScript 7 编译接口的差异。升级 Capacitor 时必须复核这个小适配器。Windows 构建配置不受此适配器影响。

unsigned 输出 `app/build/outputs/apk/release/app-release-unsigned.apk`，不可直接安装。debug 输出 `app/build/outputs/apk/debug/app-debug.apk`，使用开发机器生成的测试身份。测试签名已获本次任务授权；私钥、密钥库和密码不提交或上传。CI 只做免费公开仓库 Ubuntu 校验，不上传 APK/密钥、不发布。正式发布必须另行确认受维护者控制的持久签名身份和发布步骤。同一包名升级需要兼容签名；换测试身份可能需要先备份并卸载旧应用。不要规避系统安装提示。

## 数据与连接

- 密钥在 Android 原生对话框输入，不返回 JavaScript。默认仅当前进程保存；“仅在这台手机记住密钥”以 Android Keystore AES-GCM 加密保存连接数据。不可用时失败，不退回明文。没有预置或代购密钥。
- 连接只支持公开 HTTPS 的 OpenAI 风格 `/models`、`/chat/completions`。禁止账号、查询参数、片段、私有地址、混合 DNS 及跳转；不支持 localhost、自签名证书、代理网关登录页面或工具调用。连接会把选定角色和必要聊天内容发给用户选择的服务；服务方可能收费。开发验证不调用付费 API。
- 角色 JSON 与聊天写入 `Context.getFilesDir()` 下应用自有 `qiban-data` 区域。路径由 Android 在运行时提供，不承诺外部可浏览路径。仅规范化系统可信filesDir基路径，以兼容Android用户目录别名；自有子目录、角色目录及文件仍拒绝符号链接。角色通过系统文档选择器导入/导出，保留原始 JSON 扩展字段。无需公共存储权限；远程图片不加载。`openCards` 解释私有目录，并引导导出。
- 编辑仅修改六个人设字段；预览、确认和原子写入保留一份上次有效备份。工具、脚本、提供商/凭据配置被拒绝，卡片的元数据和扩展指令不进入模型上下文。人设素材以低信任用户消息传入，不能覆盖固定原生安全指令。具体 JSON 格式见 [角色卡说明](../docs/CHARACTER_CARDS.md)。
- 自选头像通过原生系统文件选择器导入 PNG/JPEG/WebP：文件最多5 MiB、宽高最多4096，原生按比例缩至512以内，重新编码静态PNG（最多1 MiB），去掉原始元数据。保存到应用内部 `qiban-avatars`，与稳定角色ID关联，不从角色JSON接受图片URL；不联网取图、不发给模型。头像以受验证的PNG data URL交给前端，删除头像恢复内置/默认头像。头像与一份上次有效备份合计最多8 MiB；删除角色/全部本机数据一并删除头像及备份。角色JSON导出不包含头像，卸载前仍需另存原始图片；本版没有完整聊天/头像备份恢复界面。
- 图片聊天桥接支持一次用户消息附带一张本机静态 PNG/JPEG/WebP。原生选择器读取最多5 MiB、宽高最多4096的源文件，拒绝SVG、GIF、APNG及动画WebP；按EXIF方向调整后重新编码JPEG，白底、去掉元数据、最长边1600、每张最多1 MiB。选择和预览不联网；模型请求仅在明确发送聊天时构造，目前只支持DeepSeek兼容配置的 `deepseek-flash`。演示或其他模型返回不支持图片的提示。
- 聊天图片写入应用内部 `qiban-chat-images/<角色ID>/<image-UUID>.jpg`，只由原生创建和解析；JavaScript不能指定路径、图片URL或图片字节。历史只保存 `{id,mimeType,byteLength,width,height}` 五个字段，图片可单独构成用户消息。预览使用受原生验证的有界JPEG/PNG/WebP data URL，不开放Capacitor私有文件路由或远程图片。模型上下文保留最近3张图、合计最多3 MiB原始图片字节；较旧图片只在本次请求中替换为明确的遗漏说明，本地历史引用仍保留。32/48 KiB文本预算仍适用；JSON转义及base64后的原生传输上限为8,439,312字节。
- 本地聊天图片（含草稿）总计最多64 MiB、512个文件。取消选择返回null，取消草稿只删未提交图片；保存历史校验归属和实际文件元数据后清理已不再引用的图片。重启时仅在历史及图片字节全部校验通过后清理遗留草稿。图片缺失或损坏时保留全部文字、图片元数据及其他对话，不自动清理文件；预览返回null，仍可编辑文字、移除或替换图片。保存仅放行同角色、五字段完全相同的已有不可用引用，新建或改动的无效引用仍被拒绝。正常200→199→200条历史轮转保留旧尾部，不按条数减少误判清空；尾部删除/编辑使旧选择器失效。原生待回复请求记录实际输入基准，保存与新替换请求相同的文字/图片时不中止该新请求，仅中止已经失效的旧请求。清空会话、删除角色或全部数据同时删除相应图片，并使较早的选择器结果失效。角色JSON导出不包含聊天图片；本版没有完整聊天/图片备份恢复界面。
- Android“连接与数据”复用共享“外观”控件和主题算法，预设/自选颜色保存在应用固定 `https://localhost` 来源的 `qiban.appearance.v1`，启动时恢复。“删除所有本机数据”在原生侧清除该来源的localStorage/sessionStorage，在返回成功前验证为空，并阻止当前旧页面的后续 `setItem` 写回；重新加载后的新页面恢复默认色且允许正常保存。原生直接删除也覆盖此路径，不依赖设置界面执行清理。
- 单卡 128 KiB、100 个角色、角色与备份合计 8 MiB；结构深度16、节点4096、数组128、单字符串16 KiB，并进一步执行共享人设字段限制。聊天最多100个角色、每个200条、每条8000个UTF-16单元、总计4 MiB；损坏文件报错，不静默覆盖。上下文和请求另有32/48 KiB字节预算；响应最多128 KiB，显示最终文本最多8000字符。原生校验是额外边界，共享解析器仍必须通过。
- 系统自动备份和设备迁移排除应用数据。卸载删除本机数据。先导出需要保留的角色 JSON；本版不提供聊天整包导出/恢复，不把角色导出称为完整备份。“删除密钥”保留聊天，“删除所有本机数据”不可恢复。

## 接口与验收

`src/android/bridge.ts` 的 `AndroidPlugin` 只允许连接状态/模型选择/原生密钥输入、角色 CRUD 与系统导入导出、头像及聊天图片选择/预览/删除、历史读写、诊断、聊天和取消。没有任意路径、URL 请求、shell 或 JavaScript 凭据参数。`createAndroidBridge` 适配现有 `DesktopBridge`，实现已协调的 `importAvatar(id)`、`deleteAvatar(id)`、`pickChatImage(characterId)`、`chatImagePreview(characterId,imageId)`、`discardChatImage(characterId,imageId)`；取消选择返回null，图片草稿返回 `{image,previewUrl}`，预览返回URL或null。`chat()` 传元数据引用给原生并合并受校验的 `omittedImageIds`，不向原生发送预览URL。角色加载期间的取消会在原生调用前再次检查；已取消的原生回复不暴露给UI。原生保留最多128个有界请求ID，避免取消先于后台任务登记时丢失。`cards()` 的 `avatarUrl` 仅来自原生验证后的PNG，不来自卡片源JSON。共享可选头像类型按父线程指定从 `faa19c3`、图片核心从 `8a71072` 单独合入；共享头像/图片聊天UI仍由Windows/视觉工作流负责。外观组件和算法原样复用集成提交 `9db54004` 的版本，Android仅负责挂载和启动时应用已有设置。

WebView 从APK资源直接提供规范路径的 `https://localhost` 文件，拒绝所有编码/歧义路径及 `/_capacitor_file_`、`/_capacitor_content_`、HTTP代理等保留路由，不能读取本机任意路径。禁止远程导航、弹窗、子资源、Service Worker网络；CSP 禁止网页网络连接，仅对打包首页的可信Capacitor启动脚本授予精确SHA256，兼容较旧WebView且不开放任意内联脚本。关闭调试、明文混合资源、文件/内容 URL 访问。仅有联网运行权限，AndroidX另生成应用内部签名权限。

Capacitor内置HTTP、Cookies和WebView插件在原生注册表内替换为明确拒绝操作的实现；原始HTTP/Cookies JavaScript接口被移除。仅设置 `CapacitorHttp.enabled=false` 不构成原生能力边界。固定Qiban操作及必要SystemBars显示功能保留。回归测试通过真实PluginHandle派发调用禁用方法并验证拒绝，也对保留文件/内容/代理路由实际请求验证403。升级Capacitor必须重新审计其自动注册插件、接口和资源服务器。

CI 的push及按需运行可在具有KVM的标准免费Ubuntu24.04公开仓库runner上执行API35模拟器安装、首页可见、原生离线演示切换及真实WebView桥接检查。测试失败时只打印有界JUnit异常栈，不上传报告。仪器测试还覆盖合成图片的选择器回调/预览/持久化/离线请求序列化/清理，以及实际Android外观控件选色、Activity重建后的恢复、原生删除后的主题重置和旧页面写回阻止；合成测试不调用付费模型，不等同真人完成系统文档选择器流程。debug清单仅声明固定合成图片提供商的可见性，给直接注入回调的夹具补上提供商可见性；真实SAF URI授权流程仍需设备验收，release清单不包含该测试查询。没有KVM时明确跳过，不声称验收。模拟器、UI树和日志只留在临时runner，不上传。模拟器成功仍不等于真机、最低API、系统文件选择器或签名升级验收。每个CI构建打印APK哈希与公开证书指纹，不保存私钥或密钥库；不同CI构建的测试身份不保证相同。最终合并SHA获父线程审查后，最快交付路径是按该SHA构建，记录哈希/证书，再仅上传指定APK；未经这个门槛当前流程不会上传。

自动测试覆盖源 JSON 保留、确认与并发编辑、元数据隔离、凭据拒绝、原生 JSON/历史限额和公网地址检查；浏览器测试使用模拟插件。APK 构建、Robolectric 和浏览器通过不等于真机验收。维护者发布前需在真机检查首次离线演示、原生密钥取消/重填、TLS失败、模型切换、聊天取消、系统文件选择器、损坏数据、后台重启、键盘/安全区及升级后的数据保留。

## 官方依据与许可

[Capacitor 8 升级指南](https://capacitorjs.com/docs/updating/8-0)、[原生插件](https://capacitorjs.com/docs/plugins/android)、[Android Keystore](https://developer.android.com/privacy-and-security/keystore)、[系统文档选择器](https://developer.android.com/training/data-storage/shared/documents-files)、[应用签名](https://developer.android.com/studio/publish/app-signing)。Capacitor 为 MIT；OkHttp、AndroidX、Gradle 为 Apache-2.0；各依赖原有许可证必须随发行保留，不能将第三方原生运行库当作栖伴自有代码。当前构建未加入广告、遥测或付费构建服务。
