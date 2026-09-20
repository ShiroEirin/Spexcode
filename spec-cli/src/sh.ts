export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

// @@@ posixPath - a path safe to EMBED in a bash command line on every platform.
//
// A Windows path reaches bash as `C:\\Users\\...` and bash eats the backslashes as escapes, so the file
// it looks for is `C:Users...` — never found. Forward slashes are valid in a Windows path AND survive
// bash unchanged, so one spelling works on both platforms. Use this for any path interpolated into a
// shell command; never interpolate a raw `join()` result.
export function posixPath(p: string): string {
  return p.replace(/\\/g, '/')
}
