"""Run: python tests/projectPicker.browser.py (Playwright + psutil, built local server/dist)."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile

import psutil
from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[1]
output = root / 'output/playwright'
output.mkdir(parents=True, exist_ok=True)
sizes = [(1440, 960), (768, 1024), (820, 1180), (1180, 820), (1024, 768),
         (884, 420), (390, 844), (360, 740), (320, 568), (390, 420), (533, 683)]
with tempfile.TemporaryDirectory(prefix='code-terminal-picker-') as folder:
    work = Path(folder) / 'workspaces'
    work.mkdir()
    for i in range(160):
        (work / (f'folder-{i:03}-' + 'continuous_code_' * 8)).mkdir()
    env = os.environ.copy()
    env.update(CODE_TERMINAL_ADDR='127.0.0.1:18878',
               CODE_TERMINAL_STATE=str(Path(folder) / 'state.json'),
               CODE_TERMINAL_DIST=str(root / 'dist'),
               CODE_TERMINAL_TOKEN=secrets.token_urlsafe(32))
    headers = {'Authorization': 'Bearer ' + env['CODE_TERMINAL_TOKEN']}
    sessions, children, errors = [], {}, []
    with open(Path(folder) / 'server.log', 'w') as log:
        process = subprocess.Popen(
            [str(root / 'src-tauri/target/release/code-terminal-server.exe')],
            cwd=work, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                ctx = browser.new_context(viewport={'width': 1440, 'height': 960}, has_touch=True)
                ctx.add_init_script('sessionStorage.setItem("code-terminal.server-token",' +
                                    json.dumps(env['CODE_TERMINAL_TOKEN']) + ');')
                page = ctx.new_page()
                page.on('pageerror', lambda e: errors.append(str(e)))
                def record(response):
                    if '/api/terminal_start' in response.url and response.status == 200:
                        sessions.append(response.json()['sessionId'])
                        for child in psutil.Process(process.pid).children(recursive=True):
                            children[child.pid] = child
                page.on('response', record)
                try:
                    page.goto('http://127.0.0.1:18878/', wait_until='networkidle')
                    page.get_by_title('切换项目', exact=True).click()
                    page.get_by_role('button', name='打开项目', exact=True).click()
                    dlg = page.get_by_role('dialog', name='选择项目目录')
                    path = dlg.get_by_label('当前目录路径')
                    select = dlg.get_by_role('button', name='选择当前目录', exact=True)
                    expect(path).to_have_value(str(work))
                    expect(dlg.locator('.project-picker-entry')).to_have_count(160)
                    def check_footer():
                        bounds = select.evaluate('''el => {
                          const r = el.getBoundingClientRect();
                          return {visible:r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
                            hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),
                            overflow:document.documentElement.scrollWidth>innerWidth};
                        }''')
                        assert bounds['visible'] and bounds['hit'] and not bounds['overflow'], bounds
                    for width, height in sizes:
                        page.set_viewport_size({'width': width, 'height': height})
                        page.wait_for_timeout(100)
                        check_footer()
                        listing = dlg.locator('.project-picker-list')
                        assert listing.evaluate('el => el.scrollHeight > el.clientHeight'), (width, height)
                        listing.evaluate('el => el.scrollTop = el.scrollHeight')
                        check_footer()
                        last = dlg.locator('.project-picker-entry').last
                        last.click()
                        expect(path).to_have_value(str(sorted(work.iterdir())[-1]))
                        check_footer()
                        dlg.get_by_role('button', name='工作目录', exact=True).click()
                        expect(dlg.locator('.project-picker-entry')).to_have_count(160)
                        assert dlg.locator('.project-picker-entry strong').first.evaluate(
                            'el => getComputedStyle(el).textOverflow === "ellipsis" && !!el.closest("button").title')
                        assert listing.evaluate('el => el.scrollWidth <= el.clientWidth')
                        page.screenshot(path=str(output / f'picker-many-{width}x{height}.png'))
                    def blocked(route):
                        if route.request.post_data_json.get('path') == '/blocked-test':
                            route.fulfill(status=500, body='Permission denied (os error 13)')
                        else:
                            route.continue_()
                    page.route('**/api/list_directory', blocked)
                    path.fill('/blocked-test')
                    dlg.get_by_role('button', name='打开', exact=True).click()
                    expect(dlg.get_by_role('alert')).to_contain_text('工作目录')
                    expect(select).to_be_disabled()
                    expect(dlg.locator('.project-picker-entry')).to_have_count(0)
                    for width, height in [(390, 420), (884, 420), (320, 568)]:
                        page.set_viewport_size({'width': width, 'height': height})
                        page.wait_for_timeout(100)
                        check_footer()
                    dlg.get_by_role('button', name='工作目录', exact=True).click()
                    expect(path).to_have_value(str(work))
                    # The footer must perform selection while the list contains 160 folders.
                    select.click()
                    expect(dlg).not_to_be_visible()
                    state = ctx.request.get('http://127.0.0.1:18878/api/load_state', headers=headers).json()
                    assert any(x['path'] == str(work) for x in state['projects'])
                    page.get_by_title('切换项目', exact=True).click()
                    page.get_by_role('button', name='打开项目', exact=True).click()
                    expect(path).to_have_value(str(work))
                    def denied(route):
                        route.fulfill(status=500, body='Read-only file system (os error 30)')
                    page.route('**/api/create_directory', denied)
                    name = dlg.get_by_label('新文件夹名称')
                    name.fill('new-project')
                    dlg.get_by_role('button', name='新建', exact=True).click()
                    expect(dlg.get_by_role('alert')).to_contain_text('新建文件夹失败')
                    expect(name).to_have_value('new-project')
                    page.unroute('**/api/create_directory', denied)
                    dlg.get_by_role('button', name='新建', exact=True).click()
                    expect(path).to_have_value(str(work / 'new-project'))
                    assert (work / 'new-project').is_dir()
                    select.click()
                    expect(dlg).not_to_be_visible()
                    assert not errors, errors
                    print(json.dumps({'folders': 160, 'viewports': sizes, 'footer_selection': 'passed',
                                      'error_recovery': 'passed', 'create_and_enter': 'passed', 'page_errors': errors}))
                finally:
                    for child in psutil.Process(process.pid).children(recursive=True):
                        children[child.pid] = child
                    for sid in set(sessions):
                        ctx.request.post('http://127.0.0.1:18878/api/terminal_stop', headers=headers, data={'sessionId': sid})
                    ctx.close()
                    browser.close()
        finally:
            for child in children.values():
                try:
                    child.kill()
                except psutil.NoSuchProcess:
                    pass
            psutil.wait_procs(list(children.values()), timeout=5)
            process.terminate()
            process.wait(timeout=10)
