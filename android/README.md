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
- 角色 JSON 与聊天写入 `Context.getFilesDir()` 下应用自有 `qiban-data` 区域。路径由 Android 在运行时提供，不承诺外部可浏览路径。角色通过系统文档选择器导入/导出，保留原始 JSON 扩展字段。无需公共存储权限；远程图片不加载。`openCards` 解释私有目录，并引导导出。
- 编辑仅修改六个人设字段；预览、确认和原子写入保留一份上次有效备份。工具、脚本、提供商/凭据配置被拒绝，卡片的元数据和扩展指令不进入模型上下文。人设素材以低信任用户消息传入，不能覆盖固定原生安全指令。具体 JSON 格式见 [角色卡说明](../docs/CHARACTER_CARDS.md)。
- 单卡 128 KiB、100 个角色、角色与备份合计 8 MiB；结构深度16、节点4096、数组128、单字符串16 KiB，并进一步执行共享人设字段限制。聊天最多100个角色、每个200条、每条8000个UTF-16单元、总计4 MiB；损坏文件报错，不静默覆盖。上下文和请求另有32/48 KiB字节预算；响应最多128 KiB，显示最终文本最多8000字符。原生校验是额外边界，共享解析器仍必须通过。
- 系统自动备份和设备迁移排除应用数据。卸载删除本机数据。先导出需要保留的角色 JSON；本版不提供聊天整包导出/恢复，不把角色导出称为完整备份。“删除密钥”保留聊天，“删除所有本机数据”不可恢复。

## 接口与验收

`src/android/bridge.ts` 的 `AndroidPlugin` 只允许连接状态/模型选择/原生密钥输入、角色 CRUD 与系统导入导出、历史读写、诊断、聊天和取消。没有任意路径、URL 请求、shell 或 JavaScript 凭据参数。`createAndroidBridge` 适配现有 `DesktopBridge`；共享启动改动只有 `src/main.tsx` 初始化和 `src/App.tsx` 选择 Android 设置面板。

WebView 只允许打包的 `https://localhost` 资源，拒绝远程导航、弹窗和子资源；CSP 禁止网页网络连接，关闭调试、明文混合资源、文件/内容 URL 访问。只申请 INTERNET 权限。

自动测试覆盖源 JSON 保留、确认与并发编辑、元数据隔离、凭据拒绝、原生 JSON/历史限额和公网地址检查；浏览器测试使用模拟插件。APK 构建、Robolectric 和浏览器通过不等于真机验收。维护者发布前需在真机检查首次离线演示、原生密钥取消/重填、TLS失败、模型切换、聊天取消、系统文件选择器、损坏数据、后台重启、键盘/安全区及升级后的数据保留。

## 官方依据与许可

[Capacitor 8 升级指南](https://capacitorjs.com/docs/updating/8-0)、[原生插件](https://capacitorjs.com/docs/plugins/android)、[Android Keystore](https://developer.android.com/privacy-and-security/keystore)、[系统文档选择器](https://developer.android.com/training/data-storage/shared/documents-files)、[应用签名](https://developer.android.com/studio/publish/app-signing)。Capacitor 为 MIT；OkHttp、AndroidX、Gradle 为 Apache-2.0；各依赖原有许可证必须随发行保留，不能将第三方原生运行库当作栖伴自有代码。当前构建未加入广告、遥测或付费构建服务。
