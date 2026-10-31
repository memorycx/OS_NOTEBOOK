# 南京大学操作系统课程笔记

> 以“程序如何运行”为主线，记录操作系统课程中的核心概念、机制与代码实验。

**在线阅读：** [memorycx.github.io/OS_NOTEBOOK](https://memorycx.github.io/OS_NOTEBOOK/)

## 笔记目录

| 讲次 | 主题 | 关键词 | 笔记 |
| --- | --- | --- | --- |
| 第五讲 | 程序和进程 | `fork` / `execve` / 进程树 / Fork Bomb / COW | [阅读](01_程序和进程.md) |
| 第 6 讲 | 进程的地址空间 | 虚拟内存 / MMU / `mmap` / `ptrace` | [阅读](02_进程的地址空间.md) |

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
├── index.md                  # GitHub Pages 首页
├── 01_程序和进程.md
└── 02_进程的地址空间.md
```

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
- 如果发现错误或有更好的补充，欢迎通过 Issue 或 PR 指出。

## 相关链接

- [GitHub 仓库](https://github.com/memorycx/OS_NOTEBOOK)
- [GitHub Pages 在线笔记](https://memorycx.github.io/OS_NOTEBOOK/)
- [课程原始资料（JYY Wiki）](https://jyywiki.cn/OS/2026/)
