/**
 * Classification of error conditions per BUILD_api.md A-5.
 */
export type ClassifiedErrorKind =
  | 'unreachable'
  | 'auth'
  | 'model-not-found'
  | 'rate-limit'
  | 'transient'
  | 'tool-mismatch'
  | 'no-edit'
  | 'region'
  | 'cancelled'
  | 'unknown';

/**
 * Classifies an error message into a standard recovery category.
 */
export function classifyError(
  message: string,
  errorKind?: string,
  status?: string
): ClassifiedErrorKind {
  if (status === 'cancelled') {
    return 'cancelled';
  }

  if (
    errorKind === 'tool-mismatch' ||
    message.includes('Auto-deny limit reached') ||
    message.includes('old_text was not found')
  ) {
    return 'tool-mismatch';
  }

  if (
    errorKind === 'no-edit' ||
    message.includes('zero proposals') ||
    message.includes('no edits proposed')
  ) {
    return 'no-edit';
  }

  if (
    errorKind === 'region' ||
    message.includes('outside the selected region')
  ) {
    return 'region';
  }

  if (
    message.includes('Cannot connect') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('fetch failed')
  ) {
    return 'unreachable';
  }

  if (
    message.includes('401') ||
    message.includes('403') ||
    message.toLowerCase().includes('unauthorized') ||
    message.toLowerCase().includes('forbidden')
  ) {
    return 'auth';
  }

  if (message.includes('404')) {
    return 'model-not-found';
  }

  const lower = message.toLowerCase();

  if (message.includes('429') || lower.includes('rate limit') || lower.includes('quota')) {
    return 'rate-limit';
  }

  if (
    /\b5\d{2}\b/.test(message) ||
    message.includes('Headers Timeout') ||
    lower.includes('timeout')
  ) {
    return 'transient';
  }

  return 'unknown';
}
