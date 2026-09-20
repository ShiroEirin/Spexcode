// @@@ windows-hide-console ([[platform-support]]) - keep a spawned child from flashing its own console
// window on Windows.
//
// WHY: Node's default for `windowsHide` is false, so EVERY child process gets its own console window on
// Windows. SpexCode spawns children constantly (git probes, shims, `bash -lc`, one-shot `node` runs), so a
// Windows operator sees console windows appear and vanish over the desktop for the whole life of a command.
// `windowsHide` is per-call on every child_process entry point; setting it at each of the ~50 spawn sites
// in this package is a change no one can keep honest — the next added call site silently regresses.
//
// HOW: this sets it ONCE, for the whole process, and only on win32 — elsewhere it is a no-op, so POSIX
// behaviour (including the `sh`/`bash` semantics several adapters rely on) is untouched. `child_process`'s
// named exports are LIVE BINDINGS, so patching the module object BEFORE any consumer imports it also
// reaches `import { spawnSync } from 'node:child_process'`. That is why cli.ts imports this module first:
// once a consumer has bound the function, patching is too late.
//
// CONTRACT: an explicit `windowsHide` the caller passed always wins (the spread order below), so a caller
// that deliberately wants a window still gets one. Argument positions follow the Node signatures,
// including the forms that omit `args`:
//   spawn/spawnSync(command[, args][, options])
//   exec/execSync(command[, options][, callback])
//   execFile/execFileSync(file[, args][, options][, callback])
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

if (process.platform === 'win32') {
  const cp = require('node:child_process') as Record<string, (...args: unknown[]) => unknown>
  const HIDDEN = { windowsHide: true }
  const isOptions = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value)

  // spawn/spawnSync: (command[, args][, options])
  const patchCommandArgsFirst = (name: string): void => {
    const original = cp[name]
    cp[name] = function patched(this: unknown, ...args: unknown[]) {
      const a1 = args[1]
      const a2 = args[2]
      if (Array.isArray(a1)) {
        args[2] = isOptions(a2) ? { ...HIDDEN, ...a2 } : { ...HIDDEN }
      } else if (isOptions(a1)) {
        args[1] = { ...HIDDEN, ...a1 }
      } else if (a1 === undefined) {
        if (isOptions(a2)) args[2] = { ...HIDDEN, ...a2 }   // spawn(cmd, undefined, options)
        else if (args.length <= 1) args.push({ ...HIDDEN }) // spawn(cmd) — an object here IS the options
        else args[1] = { ...HIDDEN }                        // spawn(cmd, undefined)
      }
      return original.apply(this, args)
    }
  }

  // exec/execSync: (command[, options][, callback])
  const patchCommandFirst = (name: string): void => {
    const original = cp[name]
    cp[name] = function patched(this: unknown, ...args: unknown[]) {
      const a1 = args[1]
      if (isOptions(a1)) args[1] = { ...HIDDEN, ...a1 }
      else if (typeof a1 === 'function') args.splice(1, 0, { ...HIDDEN })   // exec(cmd, callback)
      else if (a1 === undefined) {
        if (args.length <= 1) args.push({ ...HIDDEN })
        else args[1] = { ...HIDDEN }
      }
      return original.apply(this, args)
    }
  }

  // execFile/execFileSync: (file[, args][, options][, callback])
  const patchFileFirst = (name: string): void => {
    const original = cp[name]
    cp[name] = function patched(this: unknown, ...args: unknown[]) {
      const a1 = args[1]
      const a2 = args[2]
      if (Array.isArray(a1)) {
        if (isOptions(a2)) args[2] = { ...HIDDEN, ...a2 }
        else if (typeof a2 === 'function') args.splice(2, 0, { ...HIDDEN })  // execFile(f, args, callback)
        else if (a2 === undefined) args[2] = { ...HIDDEN }
      } else if (isOptions(a1)) {
        args[1] = { ...HIDDEN, ...a1 }
      } else if (a1 === undefined) {
        if (isOptions(a2)) args[2] = { ...HIDDEN, ...a2 }
        else if (args.length <= 1) args.push({ ...HIDDEN })
        else args[1] = { ...HIDDEN }
      }
      return original.apply(this, args)
    }
  }

  patchCommandArgsFirst('spawn')
  patchCommandArgsFirst('spawnSync')
  patchCommandFirst('exec')
  patchCommandFirst('execSync')
  patchFileFirst('execFile')
  patchFileFirst('execFileSync')
}