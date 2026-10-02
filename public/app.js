const messagesEl = document.getElementById('messages');
const composer = document.getElementById('composer');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const resetBtn = document.getElementById('resetBtn');
const toolsBtn = document.getElementById('toolsBtn');
const toolsModal = document.getElementById('toolsModal');
const closeToolsBtn = document.getElementById('closeToolsBtn');
const toolsList = document.getElementById('toolsList');

function clearEmptyState() {
  const empty = messagesEl.querySelector('.empty-state');
  if (empty) empty.remove();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addUserMessage(text) {
  clearEmptyState();
  const row = document.createElement('div');
  row.className = 'message-row user';
  row.innerHTML = `<div class="bubble"></div>`;
  row.querySelector('.bubble').textContent = text;
  messagesEl.appendChild(row);
  scrollToBottom();
}

function addTypingIndicator() {
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  row.id = 'typingRow';
  row.innerHTML = `<div class="bubble typing"><span></span><span></span><span></span></div>`;
  messagesEl.appendChild(row);
  scrollToBottom();
  return row;
}

function addAssistantMessage(text, toolCalls, isError, model) {
  clearEmptyState();
  const row = document.createElement('div');
  row.className = 'message-row assistant';

  let toolsHtml = '';
  if (toolCalls && toolCalls.length) {
    toolsHtml =
      '<div class="tool-calls">' +
      toolCalls
        .map(
          (c) =>
            `<div class="tool-call"><span class="tool-name">${escapeHtml(c.name)}</span>(${escapeHtml(
              JSON.stringify(c.args),
            )})</div>`,
        )
        .join('') +
      '</div>';
  }

  row.innerHTML = `${toolsHtml}<div class="bubble${isError ? ' error' : ''}"></div>`;
  row.querySelector('.bubble').textContent = text;

  if (model && !isError) {
    const modelTag = document.createElement('div');
    modelTag.className = 'model-tag';
    modelTag.textContent = `via ${model}`;
    row.appendChild(modelTag);
  }

  messagesEl.appendChild(row);
  scrollToBottom();
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function sendMessage(text) {
  addUserMessage(text);
  input.value = '';
  input.style.height = 'auto';
  sendBtn.disabled = true;
  const typingRow = addTypingIndicator();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    typingRow.remove();

    if (!res.ok) {
      addAssistantMessage(data.error || 'Something went wrong.', null, true);
    } else {
      addAssistantMessage(data.text, data.toolCalls, false, data.model);
    }
  } catch (err) {
    typingRow.remove();
    addAssistantMessage(`Network error: ${err.message}`, null, true);
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

composer.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  sendMessage(text);
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    composer.requestSubmit();
  }
});

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
});

document.querySelectorAll('.suggestion').forEach((btn) => {
  btn.addEventListener('click', () => sendMessage(btn.textContent));
});

resetBtn.addEventListener('click', async () => {
  await fetch('/api/reset', { method: 'POST' });
  messagesEl.innerHTML = `
    <div class="empty-state">
      <p>Conversation reset. Ask it to search the web, check the weather, do math, or manage notes.</p>
    </div>`;
});

toolsBtn.addEventListener('click', async () => {
  const res = await fetch('/api/tools');
  const { tools } = await res.json();
  toolsList.innerHTML = tools
    .map((t) => `<li><div class="name">${escapeHtml(t.name)}</div><div class="desc">${escapeHtml(t.description || '')}</div></li>`)
    .join('');
  toolsModal.classList.remove('hidden');
});

closeToolsBtn.addEventListener('click', () => toolsModal.classList.add('hidden'));
toolsModal.addEventListener('click', (e) => {
  if (e.target === toolsModal) toolsModal.classList.add('hidden');
});
