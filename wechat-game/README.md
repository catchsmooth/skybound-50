# 极限航域 · 50秒 — 微信 0.5.0

此目录是用户已经导入的小游戏工程，继续使用现有 AppID 和私有配置；不需重新创建项目。原生 Canvas 入口，无 WebView、远程素材或新增运行时依赖。没有上传或提审。

## 本次规则与画面

- 长屏全宽战场：逻辑宽512，高按当前可玩安全区比例计算，飞机、弹与判定采用同一个等比缩放。刘海、微信胶囊、底部指示区以及48px HUD不参与碰撞，避免子弹藏在控件后。没有方框和下方独立拖拽区。
- 任意非按钮区域相对拖拽：按下不瞬移，松手即停；最大移速220、判定半径7，弹半径3。灵敏度和最大移速分离。
- 开局2秒无弹，提前30tick（0.5秒）边缘形状/进度预警；第一波单侧4～6发平行弹。10秒起交替侧向与锁定一次目标的扇射，25秒起加入逐发扫射，50秒后继续无尽并逐步增密。弹发出后直线飞行，不持续追踪。
- 初阶段弹速60逻辑单位/秒；10秒后按发射点到快照目标的几何距离归一为60～120，不按生存时间无限加速。总弹数160封顶，出界移除，不立即回收重瞄。
- 道具 S/H/P 与旧版时序保持；新规则清场真正移除160范围内的弹，不立即补齐。经典模式不产生道具。
- 首次3秒准备可跳过，死亡直接重开0.8秒。暂停内可设置，死亡结算可隐藏以查看真正接触证据。变窗暂停并锁定本局原坐标，需要返回菜单重开，不改写飞行中的弹幕。

## 纪录与版本隔离

- 新微信存档：`skybound50:wechat:skybound50:waves:save`，标记 `ruleset=waves-v1`。
- 旧微信存档：`skybound50:wechat:skybound50:save`，保留原字节与两模式成绩，在菜单显示“旧规则历史”。
- 首次迁移继承累计飞行、局数、已解锁皮肤、静音、音量、灵敏度与画质偏好，新规则纪录从0开始。微信与浏览器存档仍独立。
- 包版本为0.5.0；原 Web 入口保留0.4.0旧规则和显示版本，400种子旧规则快照不变，没有把新规则成绩混入旧版。

## 源码自动构建

源码在相邻 `game/src`。在 `game` 目录执行：

```sh
node tools/watch-wechat.mjs --refresh
# 等价 npm run watch:wechat；停止用 Ctrl+C
```

监听只关注源码TS，250ms合并变更、串行构建。类型错误会先报告诊断，不向runtime写入新代码。构建成功最后更新game.js入口标记，并调用官方simulator_refresh（实际为小游戏编译/重启动作），保留同一个工程窗口。已通过两次源码探针直接读取实际#myCanvas确认画布内容更新。前端simulator_screenshot合成层曾返回陈旧帧，不能用它单独判定源码未生效；不再自动关闭/重开项目窗口。需保持工具服务端口开启，并在首次弹窗确认客户端“Codex”。CLI安装位置不同可设置 `WECHAT_IDE_CLI`。

这是真实重新编译/重启小游戏，不是保留当前对局状态的热替换。构建不会覆盖 AppID、工程配置或私有配置，不会上传发布。

单次构建及回归：

```sh
node tools/build.mjs
node tools/build-wechat.mjs
node --test --test-isolation=none tests/*.test.mjs
node tests/experience-browser.mjs
```

Web回归使用已有 `http://127.0.0.1:5179` 服务，无需再起服务器。音频由原合成器通过微信 WebAudio factory接入；设备接口不支持时降为静音，不阻塞游玩。真实设备听感和性能仍待真机测试。

## 实际工具取证

已在微信开发者工具 Stable 2.02.2609250、基础库3.17.5通过官方接口编译、点击起飞并直接读取真实小游戏屏幕画布。可重复执行 `node tools/capture-wechat-canvas.mjs`：它通过官方evaluate读取当前appservice的#myCanvas，使用临时离屏Canvas等比缩小并保存PNG，不改动可见画布。有效正式菜单为上一级 `artifacts/wechat-live-menu-0.5.0.png`；源码探针为 `artifacts/wechat-live-refresh-probe.png`。已实证正常simulator_refresh使“刷新实测”生效，保存还原源码后再次看到“波次航行”。

官方tap、touchstart、touchmove、touchend返回成功；此轮自动化因既有长帧保护进入暂停，截图为 `artifacts/wechat-live-paused-0.5.0.png`，不将其宣称为持续实战或真机手感验收。早期swipe超时及前端合成截图陈旧也记录在报告中，不作为新画面证据。147项本地测试和15组Web回归再次通过；配置/私有配置/旧核心哈希均未变。详细证据在 `artifacts/wechat-report-0.5.0.json` 与 `artifacts/round1-config-check.json`。Node VM/Web回归不是微信真机结果。console可见 `[Skybound WeChat] 0.5.0` 与实际逻辑边界启动信息，最终错误过滤为空。

官方接口适配脚本为 `game/tools/wechat-ide.mjs`，不读取本机令牌文件；客户端授权由微信工具管理。调试快照 `GameGlobal.__skyboundDebug` 在游戏模块运行上下文只读提供版本、状态、边界、预警、碰撞与按钮矩形；官方evaluate的全局对象可能与模块隔离，不应把返回undefined误认成游戏未运行。
