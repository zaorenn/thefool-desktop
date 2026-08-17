export function logError(error: unknown): void {
  if (!process.env.THEFOOL_INK_DEBUG_ERRORS) {
    return
  }

  console.error(error)
}
