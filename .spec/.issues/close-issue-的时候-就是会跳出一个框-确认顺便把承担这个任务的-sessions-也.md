---
concern: Close issue 的时候，就是会跳出一个框，确认顺便把承担这个任务的 sessions 也给 close 掉
by: human
status: open
created: 2026-09-14T02:25:58.791Z
---

它是这样的：可以加一个硬限制，就是必须所有承担这个任务的 session 都处于 close pending 或者已经被 Close 了的状态下，才可以去 Close 掉这个 issue。如果说不满足这个条件的话，可以在跳出的那个确认框里面，选一个叫做“nudge all sessions to enter close pending state”的选项
这里有个点，就是这些 sessions 应该是承担这个任务的 session，而不是所有相关联的 session 都在里面。

就是哪些 session 是承担这个任务的？不知道我们之前的数据结构有没有已经区分了？

---

我觉得或许这样子吧，可以弄得更加自由一点，不是说之前的机制全都不搞了，我们改成这样：

如果有未 close 的、承担这个任务的 session，它会跳出一个多选框，你可以多选那些 session。默认会先选中所有 close pending 的 session，但用户也可以去选那些非 close pending 的 session，这两类是互斥的。

如果用户选择了非 close pending 的 session，底下的操作就不是 close 掉这个 session，而是 nudge this session to be close pending。

懂我意思吧？比如说一开始默认选中了三个 close pending 的，但还有一个状态是 asking。当用户点击选中了那个 asking 的 session，其他三个 close pending 就会被 cancel selection，同时底下的操作选项也会从 close issue 变成 nudge session to close（当然我这个 wording 可能不太好，你可以找一个更好的 wording）

@2499a20b-ae58-4074-87de-3753e02fe63b
