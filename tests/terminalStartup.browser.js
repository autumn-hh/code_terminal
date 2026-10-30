// playwright-cli run-code --filename tests/terminalStartup.browser.js
// Run against a dedicated local full server.
// No real Codex processes or model requests: PTY latency/resize are controlled.
async page => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(page.url()).hostname)) throw Error('Local fixture only');
  const check = (value, message) => { if (!value) throw Error(message); };
  const project = { id: 'resume-fixture', name: 'Resume fixture', path: '/fixture', status: 'idle', lastOpenedAt: Date.now() };
  const history = { id: '11111111-2222-3333-4444-555555555555', title: 'Resume fixture history', cwd: '/fixture', updatedAt: Date.now() };
  let socket, scenario = 'initial', resizeCount = 0;
  const events = [], sizes = new Map();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/load_state', r => r.fulfill({ json: { projects: [project], activeProjectId: project.id } }));
  await page.route('**/api/list_codex_sessions', r => r.fulfill({ json: [history] }));
  await page.route('**/api/events_ticket', r => r.fulfill({ json: { ticket: null, sessionLease: true } }));
  await page.routeWebSocket('**/api/events*', ws => { socket = ws; });
  await page.route('**/api/terminal_*', async r => {
    const command = new URL(r.request().url()).pathname.split('/').pop();
    const data = r.request().method() === 'GET' ? {} : r.request().postDataJSON();
    events.push({ command, ...data });
    if (command === 'terminal_start') {
      sizes.set(data.sessionId, { cols: data.cols, rows: data.rows });
      if (scenario !== 'initial') {
        await page.setViewportSize({ width: 1280, height: scenario === 'cancel' ? 680 : 720 });
        await page.waitForTimeout(120);
      }
      return r.fulfill({ json: { sessionId: data.sessionId, shell: 'fixture', cwd: '/fixture', keepAlive: false } });
    }
    if (command === 'terminal_resize') {
      resizeCount++;
      if (scenario === 'failed') return r.fulfill({ status: 503, body: 'fixture resize failure' });
      if (scenario === 'timeout') {
        await page.waitForTimeout(9000);
        return r.fulfill({ status: 204 }).catch(() => undefined);
      }
      if (scenario === 'moving' && resizeCount === 1) await page.setViewportSize({ width: 1280, height: 620 });
      await page.waitForTimeout(scenario === 'cancel' ? 350 : 120);
      sizes.set(data.sessionId, { cols: data.cols, rows: data.rows });
      events.push({ command: 'resize-ack', ...data });
    }
    if (command === 'terminal_write' && data.data?.startsWith('codex resume ')) {
      const size = sizes.get(data.sessionId);
      socket.send(JSON.stringify({ type: 'terminal-output', payload: { sessionId: data.sessionId, sequence: 1,
        data: `\x1b[?1049h\x1b[2J\x1b[${size.rows - 2};1H\x1b[48;2;240;240;240mAsk Codex to do anything${' '.repeat(Math.max(0, size.cols - 23))}\x1b[0m\x1b[${size.rows};1H? for shortcuts` } }));
    }
    if (command === 'terminal_heartbeat') return r.fulfill({ json: { missingSessionIds: [] } });
    return r.fulfill({ status: 204 });
  });
  await page.evaluate(() => {
    localStorage.setItem('code-terminal-view-mode', 'terminal');
    localStorage.setItem('opencode-workbench.terminal-appearance', JSON.stringify({ preset: 'daylight', fontSize: 14, lineHeight: 1.34 }));
  });
  await page.reload();
  const historyButton = page.locator('.project-session-item').filter({ hasText: history.title });
  await historyButton.waitFor();
  await page.waitForTimeout(450);
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (predicate()) return;
      await page.waitForTimeout(25);
    }
    throw Error('Timed out waiting for fixture event: ' + JSON.stringify(events));
  };
  const results = [];
  for (const mode of ['delayed', 'moving']) {
    scenario = 'initial';
    events.length = 0;
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(250);
    scenario = mode;
    resizeCount = 0;
    events.length = 0;
    await historyButton.click();
    await waitFor(() => events.some(e => e.command === 'terminal_write' && e.data?.startsWith('codex resume ')));
    const started = events.find(e => e.command === 'terminal_start');
    const writeIndex = events.findIndex(e => e.command === 'terminal_write' && e.data?.startsWith('codex resume '));
    const acks = events.map((e, i) => ({ ...e, i })).filter(e => e.command === 'resize-ack' && e.sessionId === started.sessionId);
    check(acks.length >= (mode === 'moving' ? 2 : 1), mode + ': final layout was synchronized');
    check(acks.every(e => e.i < writeIndex), mode + ': resize ACK must precede launching Codex');
    await page.waitForTimeout(160);
    const content = await page.locator('.terminal-session.active .xterm-rows').innerText();
    check(content.includes('Ask Codex to do anything') && content.includes('? for shortcuts'), mode + ': first frame includes prompt and footer');
    const paintedColumns = await page.locator('.terminal-session.active .xterm-rows > div').filter({ hasText: 'Ask Codex to do anything' }).evaluate(row =>
      [...row.querySelectorAll('span')].filter(span => getComputedStyle(span).backgroundColor === 'rgb(240, 240, 240)').reduce((sum, span) => sum + span.textContent.length, 0));
    check(paintedColumns === acks.at(-1).cols, mode + ': first-frame prompt background fills the acknowledged width');
    check(!await page.locator('.xterm-helper-textarea').evaluate(e => e === document.activeElement), 'Resume must not focus the software keyboard');
    await page.screenshot({ path: `output/playwright/history-resume-${mode}.png` });
    results.push({ scenario: mode, acknowledgedResizes: acks.length, initialRows: started.rows, finalRows: acks.at(-1).rows });
  }
  for (const mode of ['failed', 'timeout']) {
    scenario = 'initial';
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(250);
    scenario = mode;
    events.length = 0;
    await historyButton.click();
    await page.locator('.error-strip').filter({ hasText: '终端尺寸同步失败，待执行命令未发送' }).waitFor({ timeout: 10000 });
    check(!events.some(e => e.command === 'terminal_write' && e.data?.startsWith('codex resume ')), mode + ': no command after failed synchronization');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    check(await page.getByRole('button', { name: '停止', exact: true }).isEnabled(), mode + ': shell remains controllable');
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    results.push({ scenario: mode, commandSkipped: true, sessionControllable: true });
  }
  scenario = 'initial';
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(250);
  scenario = 'cancel';
  resizeCount = 0;
  events.length = 0;
  await historyButton.click();
  await waitFor(() => events.some(e => e.command === 'terminal_resize'));
  await page.locator('.terminal-tab.active .terminal-tab-close').click();
  await page.waitForTimeout(600);
  check(!events.some(e => e.command === 'terminal_write' && e.data?.startsWith('codex resume ')), 'Cancelled startup must not launch a stale resume command');
  return { passed: true, results, cancelledResizeDoesNotLaunch: true, noKeyboardFocus: true };
}
