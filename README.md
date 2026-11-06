# 南京大学操作系统课程笔记

> 以“程序如何运行”为主线，记录操作系统课程中的核心概念、机制与代码实验。

**在线阅读：** [memorycx.github.io/OS_NOTEBOOK](https://memorycx.github.io/OS_NOTEBOOK/)

## 笔记目录

| 讲次 | 主题 | 关键词 | 画板阅读（在线） | 完整笔记 |
| --- | --- | --- | --- | --- |
| 第五讲 | 程序和进程 | `fork` / `execve` / 进程树 / Fork Bomb / COW | [画板](https://memorycx.github.io/OS_NOTEBOOK/01_程序和进程/) | [笔记](01_程序和进程/01_程序和进程.md) |
| 第六讲 | 进程的地址空间 | 虚拟内存 / MMU / `mmap` / `ptrace` | [画板](https://memorycx.github.io/OS_NOTEBOOK/02_程序的地址空间/) | [笔记](02_程序的地址空间/02_进程的地址空间.md) |

## 画板阅读

在线笔记提供 PPT 式的画板阅读模式：直接读取 Obsidian Excalidraw 画板，按章节自动切分镜头，支持：

- `←` / `→`、空格翻页，`Home` / `End` 跳到首尾；
- 滚轮或双指缩放、拖拽平移画板；
- `Esc` 进入画板概览，点击章节直接跳转；
- 页面地址中的 `#p3` 可直接分享到具体一页。

## 内容简介

### 第五讲：程序和进程

- 操作系统如何通过虚拟化，让每个程序都以为自己独占了计算机。
- 程序是状态机的静态描述，进程是程序运行时的状态机实例。
- UNIX 进程管理的三个核心系统调用：`fork()`、`execve()`、`_exit()`。
- 父子进程、进程树、`SIGCHLD` 信号与 `waitpid()` 回收子进程。
- Fork Bomb、Copy-on-Write、标准输出缓冲，以及经典的 `fork()` 编程题。

### 第 6 讲：进程的地址空间

- 每个进程拥有独立的虚拟地址空间，以及代码、数据、堆、栈的组织方式。
- ELF、ABI、`PT_LOAD` 与操作系统加载器如何建立进程的初始内存状态。
- MMU、页表、TLB 与缺页异常。
- `brk()` / `sbrk()`、`mmap()`、`munmap()`、`mprotect()` 等地址空间管理接口。
- 通过 `ptrace()`、`/proc`、`process_vm_readv()` 观察和修改其他进程的内存。
- 游戏修改器、内存扫描，以及函数调用顺序与副作用。

## 仓库结构

```text
.
├── index.md                     # GitHub Pages 首页
├── 01_程序和进程/
│   ├── 01_程序和进程.md          # 完整 Markdown 笔记
│   ├── 01_梳理.excalidraw.md    # Excalidraw 画板源文件
│   └── index.html               # 画板阅读页（自动生成）
├── 02_程序的地址空间/
│   ├── 02_进程的地址空间.md
│   ├── 02_梳理.excalidraw.md
│   └── index.html
├── 03_访问操作系统对象.md
├── 补充知识/
├── assets/
│   ├── fonts/                   # Excalifont（SIL OFL 1.1）
│   ├── reader/                  # 阅读器样式与脚本
│   └── slides/                  # 画板数据（自动生成）
├── tools/
│   ├── build-slides.mjs         # 从 .excalidraw.md 生成画板数据与阅读页
│   └── vendor/                  # lz-string（MIT）
└── .github/workflows/           # 推送后自动重建画板数据
```

## 更新画板

修改 `.excalidraw.md` 后在仓库根目录运行：

```bash
node tools/build-slides.mjs
```

脚本会解压 Obsidian 的 `compressed-json` 数据、识别画板中的章节框、切分阅读镜头，并重新生成 `assets/slides/*.json` 与对应目录下的 `index.html`。推送到 `main` 后 GitHub Actions 也会自动执行一次并提交生成结果。

## 在线阅读与部署

本仓库通过 GitHub Pages 发布，首页为 `index.md`：

- 在线站点：<https://memorycx.github.io/OS_NOTEBOOK/>
- 如果页面暂时无法访问，可能是 Pages 仍在构建，或尚未在仓库 **Settings → Pages** 中设置：
  - Source：`Deploy from a branch`
  - Branch：`main`
  - Folder：`/ (root)`

## 学习建议

1. 先通读笔记，建立“进程 = 状态机”的整体框架。
2. 对照代码示例，在 Linux 环境中编译、运行并观察系统调用。
3. 结合 `strace`、`/proc`、GDB 验证结论，而不是只凭猜测理解系统行为。
4. 完成每篇笔记末尾的思考题与动手实验。

## 说明

- 笔记基于南京大学操作系统课程（2026）整理，仅供学习交流。
- 代码示例建议在 Linux 环境中编译运行。
- 画板阅读器使用 [Excalifont](https://plus.excalidraw.com/excalifont)（SIL OFL 1.1）渲染画板中的拉丁字符，许可文本见 `assets/fonts/OFL-Excalifont.txt`。
- 如果发现错误或有更好的补充，欢迎通过 Issue 或 PR 指出。

## 相关链接

- [GitHub 仓库](https://github.com/memorycx/OS_NOTEBOOK)
- [GitHub Pages 在线笔记](https://memorycx.github.io/OS_NOTEBOOK/)
- [课程原始资料（JYY Wiki）](https://jyywiki.cn/OS/2026/)
