import { ReviewRequest } from '../shared/contracts';

/**
 * Returns the file text with the proposed hunk applied.
 * Adheres to EOL rules (CRLF matching if original file is CRLF).
 */
export function computeProposedText(currentText: string, request: ReviewRequest): string {
  if (request.kind === 'create') {
    return request.newText;
  }

  const isCrlf = currentText.includes('\r\n');
  const normalizedOld = isCrlf
    ? request.oldText.replace(/\r?\n/g, '\r\n')
    : request.oldText.replace(/\r\n/g, '\n');
  const normalizedNew = isCrlf
    ? request.newText.replace(/\r?\n/g, '\r\n')
    : request.newText.replace(/\r\n/g, '\n');

  if (!normalizedOld) {
    return currentText + normalizedNew;
  }

  const index = currentText.indexOf(normalizedOld);
  if (index === -1) {
    // Return currentText unchanged if match not found
    return currentText;
  }

  return currentText.slice(0, index) + normalizedNew + currentText.slice(index + normalizedOld.length);
}

