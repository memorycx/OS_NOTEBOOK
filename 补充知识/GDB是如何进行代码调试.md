---
title: GDB是如何进行代码调试
tags:
  - 操作系统
  - Linux
  - GDB
  - ptrace
  - 调试
  - 扩展知识
---

# GDB 是如何进行代码调试的

> [!summary] 一句话结论
> GDB 并不像普通进程那样直接去读写另一个普通进程的内存。真正的做法是：GDB 向内核发出请求，内核以“有权访问所有地址空间”的身份代为读取、写入目标进程的内存、寄存器和执行状态。这个由内核提供的调试接口，在 Linux 上就是 `ptrace`。进程隔离是普通进程之间的隔离，而内核本身就有权访问所有进程，GDB 只是拿到了内核的受控授权来执行这类操作。

## 一、调试关系：tracer 与 tracee

进程 A 不能被进程 B 直接访问，但内核可以把 A 变成“被跟踪进程（tracee）”，把 GDB 变成“跟踪者（tracer）”：

```c
// 方式一：让目标进程自己请求被跟踪
ptrace(PTRACE_TRACEME, 0, 0, 0);   // 通常由子进程在 exec 前调用
execve("./a.out", ...);

// 方式二：GDB 主动挂到已运行的进程上
ptrace(PTRACE_ATTACH, pid, 0, 0);  // 目标收到 SIGSTOP 后停下
waitpid(pid, &status, 0);          // GDB 等待内核通知
```

从这一刻起，目标进程的“生杀大权”就交给了 GDB：目标被打断、停止，甚至发生异常，都会先把控制权交回 GDB。

## 二、每个调试操作都对应一条内核请求

| GDB 看到的动作 | 底层机制 |
| --- | --- |
| 读目标内存（包括变量） | `PTRACE_PEEKDATA` / 读 `/proc/<pid>/mem` / `process_vm_readv` |
| 写目标内存 | `PTRACE_POKEDATA` / 写 `/proc/<pid>/mem` |
| 读 / 写寄存器 | `PTRACE_GETREGS` / `PTRACE_SETREGS` |
| 继续运行 | `PTRACE_CONT` |
| 单步执行 | `PTRACE_SINGLESTEP`（内核借助 CPU 的单步陷阱标志 TF） |
| 设置断点 | 往目标代码段写入一个 `int3`（`0xCC`） |
| 监听事件 | `waitpid()`，内核报告 `SIGTRAP`、`SIGSEGV`、进程退出等 |

> [!important] 关键点
> GDB 自己的地址空间里并没有映射目标进程的内存。每次要读一个变量时，它都执行一次系统调用，由内核在目标进程的上下文中把数据拷贝到 GDB 的缓冲区。
>
> 因此隔离并没有被打破，只是中间多了一个内核作为中介并完成拷贝。

## 三、断点是怎么实现的

以最常见的软件断点为例：

1. GDB 先用调试信息（DWARF）把 `b main` 换算成目标进程里的一个虚拟地址；
2. 读出该地址原来的指令字节并保存下来；
3. 通过内核把该地址的首字节改写成 `0xCC`（x86 的 `int3`）；
4. 目标运行到这里时触发陷阱，内核停下目标，通知 GDB；
5. GDB 把原指令写回去，并把 PC 回退一个字节，让你看起来就像“停在源程序那一行”；
6. 继续运行时，再把 `0xCC` 写回，并把 PC 前移，让断点继续生效。

> [!note] 软件断点与硬件断点
> 这就是为什么软件断点的数量可以接近无限；而硬件断点 / 观察点（watchpoint）受 CPU 调试寄存器数量限制（x86 只有 4 个）。

## 四、源码级调试靠什么

- GDB 读取 `/proc/<pid>/maps`、`auxv` 和磁盘上的 ELF 文件，知道各段、共享库被加载到哪里；
- 编译时 `-g` 生成的 DWARF 描述了“变量 X 在哪个寄存器或栈偏移上”“这行源码对应哪条机器码”；
- GDB 按这些信息算出地址，再交给内核去读。

符号、行号、类型全部来自 DWARF 调试信息文件，与运行中的进程本身无关。

## 五、那为什么不等于安全漏洞？

因为内核在 `ptrace` 入口处做了权限检查（`ptrace_may_access`）：

- 通常要求 tracer 与 tracee 的 UID 相同，或有 `CAP_SYS_PTRACE`；
- Linux 的 Yama 模块提供 `kernel.yama.ptrace_scope`：

| 取值 | 含义 |
| --- | --- |
| 0 | 宽松，任意同用户进程都可以 attach |
| 1 | 默认，只能追踪自己的子进程 |
| 2 | 仅 root / `CAP_SYS_PTRACE` |
| 3 | 完全禁止 attach |

- 带 setuid 的程序、`no_new_privs`、容器里的 seccomp 策略都会进一步限制；
- Android 用 SELinux 严格限制 `untrusted_app` 使用 `ptrace`，防止调试器读取其他应用的内存，因此生产环境基本上调不了别人的进程。

所以“能调试”本身就是一种被操作系统明确授予的特权，与“A 不能读 B”并不矛盾：A 之所以不能，是因为 A 没有被授权采用这条通道。

## 六、其他平台同理

| 平台 / 场景 | 机制 |
| --- | --- |
| Windows | `DebugActiveProcess`、`WaitForDebugEvent` 获得调试事件；`ReadProcessMemory`、`WriteProcessMemory` 同样由内核代拷，需要 `PROCESS_VM_READ`、`PROCESS_VM_WRITE` 和调试权限 |
| macOS | `task_for_pid` 拿到 Mach task port，再用 `mach_vm_read`、`mach_vm_write` |
| 远程调试 | GDB ↔ gdbserver 走一套 RSP 协议，真正执行 `ptrace` 的是目标机上的 gdbserver |
| core dump | 没有活进程，GDB 把 core 文件当成 ELF 直接解析 |
| 内核调试 | QEMU 的 gdbstub、KGDB，原理是虚拟机监视器或内核自身提供同样的“读写内存和断点”能力 |

## 七、心智模型

> [!important] 记住这三句话
> - 进程隔离是“平级进程之间”的隔离，内核始终拥有位于所有进程之上的访问权。
> - GDB 的实际做法，是请内核替它完成操作，并非越过隔离。
> - 它每一次“读内存”，在系统调用层面都是一次内核代拷；每一条“断点”，都是目标代码里的 `0xCC` 加内核的陷阱汇报。

## 八、动手验证

在 OS Lab 中可以这样验证：

```bash
strace -f -e trace=ptrace gdb ./a.out
```

就能看到 GDB 满屏的 `ptrace(PTRACE_PEEKDATA / PTRACE_CONT / …)` 调用；也可以自己写一个几十行的 `ptrace` 迷你调试器，读一读子进程的寄存器和内存。

## 相关笔记

- [[02_进程的地址空间]] —— 进程地址空间、MMU、`mmap()` 与 `ptrace()` 的基础
