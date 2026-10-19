import { hasTmux as hostHasTmux, selectSessionHost, type SessionHost } from './session-host.js'

// tmux presence is the primitive we actually depend on, so probe THAT rather than assuming by platform:
// this also catches a bare POSIX box that simply hasn't installed tmux, not only native Windows.
export function hasTmux(): boolean {
  return hostHasTmux()
}

// Host selection is deliberately a runtime capability, not a platform branch. tmux-host is preferred; a host
// without tmux uses process-host and exposes only adapters that do not require an attachable terminal.
export function selectSessionRuntimeHost(): SessionHost {
  return selectSessionHost(hasTmux())
}

// Pure so it is unit-testable without spawning or exiting: null = runtime OK; otherwise the stderr lines.
// The pointer branches on platform because the honest repair differs — WSL2 on Windows (no POSIX analog at
// all), install-tmux on a POSIX host that merely lacks it.
export function sessionRuntimeBlock(env: { hasTmux: boolean; platform: string }): string[] | null {
  if (env.hasTmux) return null
  const lines = ['spex: the session runtime needs a POSIX host (tmux, bash, and unix-domain sockets).']
  if (env.platform === 'win32') {
    lines.push('Native Windows has no analog for these — run SpexCode under WSL2 (a real Linux kernel):')
    lines.push('  wsl --install   # then, in the Ubuntu shell: nvm install 22 && npm i -g spexcode')
  } else {
    lines.push('tmux is not on PATH — install it and retry (e.g. `apt install tmux`, `brew install tmux`).')
  }
  return lines
}

// Called at the top of the session-launching command path (`spex serve`). A tmux-less host is NOT refused:
// process-host carries every headless adapter, so the gate moved from "the OS name" to "the missing
// primitive". What is left here is the honest repair pointer — WSL2 on Windows, install-tmux on a POSIX
// host that merely lacks it — printed once, never an exit. `EX_UNAVAILABLE` (69) belonged to the phase
// where the loud refusal was the sole non-tmux outcome; the process-host landing superseded it.
export function assertSessionRuntime(): void {
  if (hasTmux()) return
  console.error('spex: tmux is unavailable; using process-host (headless adapters only).')
  // sessionRuntimeBlock's first line names the missing primitives; the user needs the repair pointer below.
  const block = sessionRuntimeBlock({ hasTmux: false, platform: process.platform })
  if (block) for (const line of block.slice(1)) console.error(line)
}
