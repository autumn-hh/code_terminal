// Dedicated local full server; Chromium simulates Android viewport resizing, not a real IME.
// npx --package @playwright/cli playwright-cli -s=keyboard run-code --filename tests/mobileKeyboard.browser.js
async page => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(page.url()).hostname)) throw Error('Local fixture only');
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const switchView = async name => {
    await page.getByRole('button', {name: '设置', exact: true}).click();
    await page.getByRole('dialog', {name: '工作区设置', exact: true}).getByRole('button', {name, exact: true}).click();
  };
  const results = [], writes = [];
  let socket, sessionId, rows = 24, uploads = 0;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
  await page.setViewportSize({width: 390, height: 844});
  await page.route('**/api/load_state', r => r.fulfill({json: {projects: [], activeProjectId: null}}));
  await page.route('**/api/events_ticket', r => r.fulfill({json: {ticket: null}}));
  await page.routeWebSocket('**/api/events*', ws => { socket = ws; });
  const render = () => {
    if (socket && sessionId) socket.send(JSON.stringify({type: 'terminalOutput', payload: {sessionId,
      data: '\x1b[?1049h\x1b[2J\x1b[H' + Array.from({length: rows}, (_, i) => 'TUI output line ' + (i + 1)).join('\r\n')}}));
  };
  await page.route('**/api/terminal_*', async r => {
    const cmd = r.request().url().split('/').pop(), data = r.request().postDataJSON();
    if (cmd === 'terminal_start') { sessionId = data.sessionId; rows = data.rows; }
    if (cmd === 'terminal_resize') rows = data.rows;
    if (cmd === 'terminal_write') writes.push(data.data);
    await r.fulfill(cmd === 'terminal_start' ? {json: {sessionId, shell: 'fixture', cwd: '/keyboard-test'}} : {status: 204});
    if (cmd === 'terminal_resize') render();
  });
  await page.route('**/api/upload_attachment?*', r => r.fulfill({json:
    '/opt/code-terminal-state/uploads/' + (++uploads) + '-01234567-89ab-cdef-0123-456789abcdef/' + new URL(r.request().url()).searchParams.get('name')}));
  await page.evaluate(() => {
    localStorage.setItem('code-terminal-view-mode', 'terminal');
    localStorage.setItem('opencode-workbench.mobile-chrome-hidden', 'false');
  });
  await page.reload();
  const input = page.getByLabel('输入内容', {exact: true});
  await input.waitFor();
  for (let i = 0; i < 40 && (!socket || !sessionId); i++) await page.waitForTimeout(100);
  check(socket && sessionId, 'Fixture must start');
  render();
  const viewport = async (height, scale = 1) => {
    await page.evaluate(({height, scale}) => {
      Object.defineProperty(visualViewport, 'height', {configurable: true, value: height});
      Object.defineProperty(visualViewport, 'scale', {configurable: true, value: scale});
      visualViewport.dispatchEvent(new Event('resize'));
    }, {height, scale});
    await page.waitForTimeout(250);
  };
  const naturalViewport = async () => {
    await page.evaluate(() => {
      delete visualViewport.height; delete visualViewport.scale;
      visualViewport.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(250);
  };
  const compact = () => page.evaluate(() => document.documentElement.classList.contains('touch-keyboard-open'));
  const measure = async (label, minimum) => {
    await page.waitForTimeout(300);
    const value = await page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {top: r.top, bottom: r.bottom, height: r.height}; };
      const chips = [...document.querySelectorAll('.terminal-draft-attachment')];
      return {height: visualViewport.height, content: rect('.terminal-session-content'), composer: rect('.terminal-composer-area'),
        input: rect('.terminal-composer-input'), keys: rect('.terminal-composer-keys'),
        rows: document.querySelector('.xterm-rows').children.length,
        overflow: document.documentElement.scrollWidth > innerWidth,
        boundedNames: chips.every(chip => chip.querySelector('span').getBoundingClientRect().right <= chip.querySelector('button').getBoundingClientRect().left),
        chipRows: new Set(chips.map(chip => chip.getBoundingClientRect().top)).size,
        targets: [...document.querySelectorAll('.terminal-draft-attachment button,.terminal-composer-send,.terminal-composer-keys button')]
          .filter(el => getComputedStyle(el).display !== 'none').every(el => el.getBoundingClientRect().height >= 44)};
    });
    check(value.content.height >= minimum, label + ': insufficient TUI height ' + value.content.height);
    check(value.composer.bottom <= value.height + 1 && value.content.bottom <= value.composer.top + 1, label + ': overlapping/covered composer');
    check(value.input.height >= 44 && value.keys.height >= 44 && value.targets, label + ': touch targets');
    check(!value.overflow && value.boundedNames && value.chipRows <= 1, label + ': overflowing text/attachments');
    results.push({label, ...value});
    await page.screenshot({path: 'output/playwright/keyboard-' + label + '.png', clip: {x: 0, y: 0, width: page.viewportSize().width, height: value.height}});
  };
  await input.focus();
  await viewport(780); check(!await compact(), 'Address bar change must not compact');
  await viewport(420, 2); check(!await compact(), 'Pinch zoom must not compact');
  await viewport(420); await measure('420-empty', 300);
  await input.fill('中文长输入与连续编码_'.repeat(30)); await measure('420-long', 280);
  const names = ['截图_' + 'continuous_code_'.repeat(12) + '.png', 'second.png', 'third.png'];
  await page.getByLabel('选择附件', {exact: true}).setInputFiles(names.map(name => ({name, mimeType: 'image/png', buffer: Buffer.from('fixture')})));
  await page.getByRole('button', {name: '移除附件：third.png', exact: true}).waitFor();
  await measure('420-files', 235);
  await viewport(360); await measure('360-files', 185);
  await viewport(280); await measure('280-files', 115);
  await page.getByRole('button', {name: '移除附件：third.png', exact: true}).click();
  check(!(await input.inputValue()).includes('third.png'), 'Remove must update draft');
  check(await compact(), 'Attachment button focus must preserve compact layout');
  check(await page.getByRole('button', {name: '添加文件或图片', exact: true}).isVisible(), 'Picker remains accessible');
  await naturalViewport();
  check(!await compact(), 'Closing keyboard must restore chrome');
  await page.getByRole('button', {name: '设置', exact: true}).click();
  await page.route('**/api/set_terminal_appearance', r => r.fulfill({json: {projects: [], activeProjectId: null, terminalAppearance: r.request().postDataJSON().appearance}}));
  await page.getByRole('spinbutton', {name: '字号', exact: true}).fill('22');
  await page.getByRole('spinbutton', {name: '字号', exact: true}).press('Tab');
  await page.getByRole('button', {name: '设置', exact: true}).click();
  await input.focus(); await viewport(420); await measure('large-text-420', 235);
  await naturalViewport();
  check(await page.locator('.terminal-bar').isVisible(), 'Navigation restores');
  await switchView('对话');
  const attachmentDraft = await input.inputValue();
  await input.fill('请检查移动端键盘打开后的可读内容');
  await input.press('Enter');
  await input.fill(attachmentDraft);
  await input.focus(); await viewport(420); await measure('dialog-420', 235);
  check((await page.getByLabel('对话记录', {exact: true}).innerText()).includes('请检查移动端'), 'Dialog text must remain visible');
  await naturalViewport();
  await switchView('终端');
  await input.focus();
  await page.setViewportSize({width: 390, height: 420}); await measure('layout-420', 235);
  check(await compact(), 'Layout resize must compact too');
  await page.setViewportSize({width: 390, height: 844}); await page.waitForTimeout(300);
  check(!await compact(), 'Layout restore');
  for (const width of [320, 360, 768, 1024]) {
    await page.setViewportSize({width, height: 844});
    await input.focus(); await viewport(420); await measure('width-' + width, 235);
    await naturalViewport();
  }
  await page.setViewportSize({width: 390, height: 844});
  await input.fill('');
  await input.focus(); await viewport(420);
  writes.length = 0;
  await input.fill('中文');
  await input.evaluate(el => {
    el.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true}));
    el.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', isComposing: true, keyCode: 229, bubbles: true, cancelable: true}));
  });
  check(writes.length === 0, 'IME confirmation cannot send');
  await input.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true, data: '中文'})));
  await input.press('Shift+Enter'); check((await input.inputValue()).includes('\n'), 'Shift+Enter newline');
  await input.press('Enter'); await page.waitForTimeout(200);
  check(writes.length === 1 && writes[0] === '中文\r', 'Enter still sends once');
  await input.press('Enter'); await page.waitForTimeout(100);
  check(writes.at(-1) === '\r', 'Empty Enter forwards');
  await naturalViewport();
  // Persisted hide-chrome preference survives opening and closing the keyboard.
  await page.evaluate(() => localStorage.setItem('opencode-workbench.mobile-chrome-hidden', 'true'));
  await page.reload(); await input.waitFor(); await input.focus(); await viewport(420);
  await naturalViewport();
  check(await page.locator('.shell').evaluate(el => el.classList.contains('mobile-chrome-hidden')), 'Saved hidden preference');
  await page.evaluate(() => localStorage.setItem('opencode-workbench.mobile-chrome-hidden', 'false'));
  await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: false});
  await page.setViewportSize({width: 1280, height: 900});
  await page.reload();
  await page.getByTitle('展开辅助输入区', {exact: true}).click();
  await input.focus(); await viewport(420);
  check(!await compact(), 'Desktop must retain its layout');
  await naturalViewport();
  return {passed: true, results};
}
