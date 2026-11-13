/**
 * Answers TrueForge client-side tool calls (`tool.response_required`).
 *
 * TrueForge pauses a turn until EVERY pending call is resolved in one batch. Approval-gated MCP
 * tools (propose_edit, run_command) are resolved with user.tool_approval; client-side tools such as
 * the built-in ask_user_question need a user.tool_response. If one is left unanswered, TrueForge
 * rejects the whole batch with 422 and the user's review decisions are lost (bug R8).
 */

/** Asks the user a question; resolves undefined if they dismiss it. */
export type QuestionAsker = (question: string, options: string[]) => Promise<string | undefined>;

export const NO_ANSWER =
  'The user did not answer this question. Continue with your best judgement and state the assumption you made.';

export function unsupportedClientTool(name: string): string {
  return `ERROR: ForgeTrail cannot run the client-side tool "${name}". Continue without it.`;
}

/** Turns the option list of an ask_user_question call into plain strings. */
function optionLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o: any) => (typeof o === 'string' ? o : o?.label ?? o?.text ?? o?.value ?? ''))
    .map((s: string) => String(s).trim())
    .filter((s: string) => s.length > 0);
}

/** Extracts (question, options) pairs; accepts {question, options} or {questions: [...]}. */
export function parseQuestions(args: any): Array<{ question: string; options: string[] }> {
  if (!args || typeof args !== 'object') return [];
  const list = Array.isArray(args.questions) ? args.questions : [args];
  return list
    .map((q: any) => ({
      question: String(q?.question ?? q?.text ?? q?.prompt ?? '').trim(),
      options: optionLabels(q?.options ?? q?.choices),
    }))
    .filter((q: { question: string }) => q.question.length > 0);
}

/**
 * Builds the tool response for one client-side call.
 * Without an asker (headless runs) questions get NO_ANSWER so the run continues.
 */
export async function answerClientTool(name: string, args: any, ask?: QuestionAsker): Promise<string> {
  if (name !== 'ask_user_question') {
    return unsupportedClientTool(name);
  }
  const questions = parseQuestions(args);
  if (questions.length === 0 || !ask) {
    return NO_ANSWER;
  }
  const answers: string[] = [];
  for (const q of questions) {
    const answer = await ask(q.question, q.options);
    const text = answer && answer.trim() ? answer.trim() : NO_ANSWER;
    answers.push(questions.length > 1 ? `${q.question}\n${text}` : text);
  }
  return answers.join('\n\n');
}

/**
 * VS Code asker: a QuickPick with the model's options plus "Type my own answer…".
 * The token lets cancelRun() close an open question.
 */
export function createVsCodeAsker(vscode: any, token?: any): QuestionAsker {
  const OWN = 'Type my own answer…';
  return async (question: string, options: string[]) => {
    if (options.length > 0) {
      const pick = await vscode.window.showQuickPick([...options, OWN], {
        title: 'ForgeTrail: the agent asks',
        placeHolder: question,
        ignoreFocusOut: true,
      }, token);
      if (pick === undefined) return undefined;
      if (pick !== OWN) return pick;
    }
    return vscode.window.showInputBox({
      title: 'ForgeTrail: the agent asks',
      prompt: question,
      ignoreFocusOut: true,
    }, token);
  };
}
