type HarnessIdentityRow = {
  id: string
  sessionEnvVar: string
  // Ambient facts the harness stamps into its children that name something OTHER than a session: a workspace
  // directory, a platform tag. They are not identities — a pid is not a session — but they are just as foreign
  // to a host, so whoever clears the identities must clear these too.
  sessionEnvScrubs?: readonly string[]
}

// Adapter-neutral identity facts. Full harness adapters project these rows; consumers that only resolve an
// environment identity must not load launchers, runtime transport, or materialization code.
export const HARNESS_IDENTITIES = [
  { id: 'claude', sessionEnvVar: 'CLAUDE_CODE_SESSION_ID' },
  { id: 'codex', sessionEnvVar: 'CODEX_THREAD_ID' },
  { id: 'opencode', sessionEnvVar: 'OPENCODE_SESSION_ID' },
  { id: 'pi', sessionEnvVar: 'PI_SESSION_ID' },
  { id: 'zcode', sessionEnvVar: 'ZCODE_SESSION_ID' },
  // Snow CLI carries its session id in the payload rather than the environment, so its env name follows
  // the same convention as the others (the adapter exports it for tool subprocesses to inherit).
  // It ALSO exports the workspace it was launched in and its own platform tag. Neither names a session, but
  // both survive into every process Snow spawns — which is how a suite that merely HOSTS a Snow session ends
  // up reading the operator's workspace as its own.
  { id: 'snow', sessionEnvVar: 'SNOW_SESSION_ID', sessionEnvScrubs: ['SNOW_CWD', 'SNOW_PLATFORM'] },
  { id: 'claude-headless', sessionEnvVar: 'CLAUDE_CODE_SESSION_ID' },
  { id: 'opencode-headless', sessionEnvVar: 'OPENCODE_SESSION_ID' },
  { id: 'pi-headless', sessionEnvVar: 'PI_SESSION_ID' },
  { id: 'codex-headless', sessionEnvVar: 'CODEX_THREAD_ID' },
] as const satisfies readonly HarnessIdentityRow[]

export type HarnessId = typeof HARNESS_IDENTITIES[number]['id']
export type HarnessIdentity = typeof HARNESS_IDENTITIES[number]

const identityById = new Map(HARNESS_IDENTITIES.map((identity) => [identity.id, identity]))

export function harnessIdentity(id: HarnessId): HarnessIdentity {
  const identity = identityById.get(id)
  if (!identity) throw new Error(`unknown harness identity '${id}'`)
  return identity
}
