// @ts-check
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const instructionInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('instruction-input'));
  const btnRun = /** @type {HTMLButtonElement} */ (document.getElementById('btn-run'));
  const btnStop = /** @type {HTMLButtonElement} */ (document.getElementById('btn-stop'));
  const btnUndoRun = /** @type {HTMLButtonElement} */ (document.getElementById('btn-undo-run'));
  const budgetText = document.getElementById('budget-text');
  const budgetProgress = document.getElementById('budget-progress');
  const planCard = document.getElementById('plan-card');
  const planList = document.getElementById('plan-list');
  const contextCard = document.getElementById('context-card');
  const contextList = document.getElementById('context-list');
  const transcriptBox = document.getElementById('transcript-box');
  const toolTrailList = document.getElementById('tool-trail-list');
  const hunkList = document.getElementById('hunk-list');
  const errorBanner = document.getElementById('error-banner');
  const errorMessage = document.getElementById('error-message');
  const errorDismiss = document.getElementById('error-dismiss');
  const stateBadge = document.getElementById('state-badge');
  const modelBadge = document.getElementById('model-badge');
  const switchNotice = document.getElementById('switch-notice');

  let activeToolElements = new Map();
  let hunkElements = new Map();
  let transcriptText = '';

  // Button actions
  btnRun.addEventListener('click', () => {
    const instruction = instructionInput.value.trim();
    if (!instruction) return;
    vscode.postMessage({ type: 'startRun', instruction });
  });

  btnStop.addEventListener('click', () => {
    vscode.postMessage({ type: 'cancelRun' });
  });

  btnUndoRun.addEventListener('click', () => {
    vscode.postMessage({ type: 'undoRun' });
  });

  errorDismiss.addEventListener('click', () => {
    errorBanner.classList.add('hidden');
  });

  // Handle incoming messages from extension
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || !message.type) return;

    switch (message.type) {
      case 'run.started': {
        btnRun.disabled = true;
        btnStop.disabled = false;
        errorBanner.classList.add('hidden');
        stateBadge.textContent = 'RUNNING';
        stateBadge.className = 'badge state-running';
        if (message.agentName) {
          modelBadge.textContent = `Model: ${message.agentName}`;
        }
        // Clear previous state
        transcriptText = '';
        transcriptBox.textContent = '';
        toolTrailList.innerHTML = '';
        hunkList.innerHTML = '';
        activeToolElements.clear();
        hunkElements.clear();
        planCard.classList.add('hidden');
        planList.innerHTML = '';
        contextCard.classList.add('hidden');
        contextList.innerHTML = '';
        break;
      }

      case 'text.delta': {
        transcriptText += message.text;
        transcriptBox.textContent = transcriptText;
        transcriptBox.scrollTop = transcriptBox.scrollHeight;
        break;
      }

      case 'tool.started': {
        const item = document.createElement('div');
        item.className = 'trail-item';
        const toolName = message.toolName;
        const shortArgs = (message.argsSummary || '').slice(0, 60);
        item.innerHTML = `
          <span><strong>${escapeHtml(toolName)}</strong> <small>(${escapeHtml(shortArgs)})</small></span>
          <span class="trail-status">running...</span>
        `;
        toolTrailList.appendChild(item);
        activeToolElements.set(toolName, item);
        break;
      }

      case 'tool.finished': {
        const item = activeToolElements.get(message.toolName);
        if (item) {
          const statusSpan = item.querySelector('.trail-status');
          if (statusSpan) {
            statusSpan.className = message.ok ? 'trail-status-ok' : 'trail-status-failed';
            statusSpan.textContent = message.ok ? '✓ ok' : '✗ failed';
          }
        }
        break;
      }

      case 'budget.update': {
        const used = message.used ?? 0;
        const max = message.max ?? 12000;
        const pct = Math.min(100, Math.round((used / max) * 100));
        budgetText.textContent = `${used.toLocaleString()} / ${max.toLocaleString()} tokens`;
        budgetProgress.style.width = `${pct}%`;
        budgetProgress.className = 'progress-bar-fill';
        if (pct >= 90) {
          budgetProgress.classList.add('danger');
        } else if (pct >= 70) {
          budgetProgress.classList.add('warning');
        }
        break;
      }

      case 'context.report': {
        const items = message.items || [];
        if (items.length > 0) {
          contextCard.classList.remove('hidden');
          contextList.innerHTML = '';
          for (const item of items) {
            const div = document.createElement('div');
            div.className = 'context-item';
            div.innerHTML = `
              <span class="context-path" title="Open file">${escapeHtml(item.path)}</span>
              <span class="context-reason">${escapeHtml(item.reason)} (~${item.tokens ?? 100}t)</span>
            `;
            const pathLink = div.querySelector('.context-path');
            if (pathLink) {
              pathLink.addEventListener('click', () => {
                vscode.postMessage({ type: 'openFile', path: item.path });
              });
            }
            contextList.appendChild(div);
          }
        }
        break;
      }

      case 'plan.update': {
        const steps = message.steps || [];
        if (steps.length > 0) {
          planCard.classList.remove('hidden');
          planList.innerHTML = '';
          for (const s of steps) {
            const li = document.createElement('li');
            li.textContent = s;
            planList.appendChild(li);
          }
        }
        break;
      }

      case 'review.requested': {
        const req = message.request;
        if (!req) break;
        const item = document.createElement('div');
        item.className = 'hunk-item';
        item.innerHTML = `
          <span><strong>${escapeHtml(req.path)}</strong>: L${req.startLine}-${req.endLine} <small>(${escapeHtml(req.reason)})</small></span>
          <span class="hunk-status pending">PENDING</span>
        `;
        hunkList.appendChild(item);
        hunkElements.set(req.id, item);
        stateBadge.textContent = 'REVIEWING';
        stateBadge.className = 'badge state-awaiting';
        break;
      }

      case 'review.resolved': {
        const item = hunkElements.get(message.id);
        if (item) {
          const statusSpan = item.querySelector('.hunk-status');
          if (statusSpan) {
            statusSpan.className = `hunk-status ${message.decision === 'accept' ? 'accepted' : 'rejected'}`;
            statusSpan.textContent = message.decision === 'accept' ? 'ACCEPTED' : 'REJECTED';
          }
        }
        break;
      }

      case 'model.switched': {
        switchNotice.classList.remove('hidden');
        switchNotice.textContent = `Switched: ${message.to}`;
        modelBadge.textContent = `Model: ${message.to}`;
        break;
      }

      case 'run.cancelled': {
        btnRun.disabled = false;
        btnStop.disabled = true;
        stateBadge.textContent = 'CANCELLED';
        stateBadge.className = 'badge state-idle';
        break;
      }

      case 'run.finished': {
        btnRun.disabled = false;
        btnStop.disabled = true;
        stateBadge.textContent = 'DONE';
        stateBadge.className = 'badge state-idle';
        break;
      }

      case 'run.error': {
        btnRun.disabled = false;
        btnStop.disabled = true;
        stateBadge.textContent = 'ERROR';
        stateBadge.className = 'badge state-idle';
        errorBanner.classList.remove('hidden');
        errorMessage.textContent = message.message || 'An error occurred during execution.';
        break;
      }
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
