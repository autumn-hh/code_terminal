"""Real authenticated upload + browser checks against an isolated local server."""
import hashlib, json, os, secrets, socket, subprocess, tempfile, time
import urllib.request, urllib.error, urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='terminal-uploads-') as folder:
    token = secrets.token_urlsafe(32)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    env = os.environ.copy()
    env.update(CODE_TERMINAL_ADDR=f'127.0.0.1:{port}', CODE_TERMINAL_TOKEN=token,
               CODE_TERMINAL_STATE=str(Path(folder)/'state.json'), CODE_TERMINAL_DIST=str(root/'dist'))
    process = subprocess.Popen([str(root/'src-tauri/target/debug/code-terminal-server.exe')], env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
    def upload(name, data, auth=True):
        headers = {'Content-Type':'application/octet-stream'}
        if auth: headers['Authorization'] = 'Bearer '+token
        request = urllib.request.Request(origin+'/api/upload_attachment?'+urllib.parse.urlencode({'name':name}), data=data, headers=headers)
        return json.load(urllib.request.urlopen(request,timeout=15))
    try:
        for _ in range(100):
            try: urllib.request.urlopen(origin,timeout=1); break
            except OSError: time.sleep(.1)
        try: upload('no-auth.txt', b'x', False); raise AssertionError('Anonymous upload accepted')
        except urllib.error.HTTPError as error: assert error.code == 401
        assert not (Path(folder)/'uploads').exists(), 'Unauthorized request must not create files'
        data = bytes(range(256)) * (3 * 4096)
        first = Path(upload('../../中文 $(bad)\n.png', data))
        assert first.resolve().is_relative_to((Path(folder)/'uploads').resolve())
        assert hashlib.sha256(first.read_bytes()).digest() == hashlib.sha256(data).digest()
        second = Path(upload('../../中文 $(bad)\n.png', b'second'))
        assert first != second and first.read_bytes() == data
        assert Path(upload('empty.txt', b'')).stat().st_size == 0
        try: upload('large.bin', b'x'*(25*1024*1024+1)); raise AssertionError('Oversized accepted')
        except urllib.error.HTTPError as error: assert error.code == 413
        try:
            public_data=urllib.request.urlopen(origin+'/uploads/'+second.parent.name+'/'+urllib.parse.quote(second.name),timeout=3).read()
            assert public_data != b'second', 'Static fallback must not expose uploaded bytes'
        except urllib.error.HTTPError as error: assert error.code == 404
        with sync_playwright() as p:
            browser=p.chromium.launch()
            context=browser.new_context(viewport={'width':390,'height':844},has_touch=True)
            context.add_init_script('sessionStorage.setItem("code-terminal.server-token",'+json.dumps(token)+');localStorage.setItem("code-terminal-view-mode","terminal");')
            page=context.new_page(); sessions=[]; errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            def record(request):
                if request.url.endswith('/api/terminal_start'): sessions.append(request.post_data_json['sessionId'])
            page.on('request',record)
            try:
                page.goto(origin); page.locator('.xterm-rows').wait_for();page.wait_for_timeout(1800)
                composer=page.get_by_label('输入内容',exact=True)
                composer.fill('说明 ')
                with page.expect_response(lambda r:'/api/upload_attachment?' in r.url) as response:
                    page.get_by_label('选择附件',exact=True).set_input_files({'name':'中文报告.txt','mimeType':'text/plain','buffer':b'real browser file'})
                path=response.value.json()
                assert Path(path).read_bytes()==b'real browser file'
                page.wait_for_function('() => document.querySelector(".terminal-composer-input").value.includes("file-中文报告.txt")')
                assert composer.input_value().startswith('说明 ')
                assert path not in page.locator('.xterm-rows').inner_text(), 'Upload must not submit terminal input'
                context.grant_permissions(['clipboard-read','clipboard-write'])
                page.evaluate("""async () => {const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;canvas.getContext('2d').fillRect(0,0,16,16);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);}""")
                with page.expect_response(lambda r:'/api/upload_attachment?' in r.url) as response:
                    composer.focus();composer.press('Control+V')
                image_path=response.value.json();assert Path(image_path).read_bytes().startswith(b'\x89PNG')
                page.wait_for_function('(path) => document.querySelector(".terminal-composer-input").value.includes(path)',arg=image_path)
                assert path in composer.input_value() and image_path in composer.input_value()
                page.screenshot(path=str(root/'output/playwright/attachments-real-phone.png'))
                composer.fill("Get-Content -LiteralPath '"+path.replace("'","''")+"'");composer.press('Enter')
                page.wait_for_function('() => document.querySelector(".xterm-rows").textContent.includes("real browser file")')
                composer.fill('codex');composer.press('Enter')
                page.wait_for_function('() => document.querySelector(".xterm-rows").textContent.includes("OpenAI Codex")')
                page.set_viewport_size({'width':1280,'height':900});page.wait_for_timeout(700)
                terminal=page.locator('.xterm-helper-textarea');terminal.focus()
                with page.expect_response(lambda r:'/api/upload_attachment?' in r.url) as direct:terminal.press('Control+V')
                page.wait_for_timeout(1500)
                page.screenshot(path=str(root/'output/playwright/attachments-codex-image.png'))
                direct_path=direct.value.json()
                assert '[Image' in page.locator('.xterm-rows').inner_text(), 'Codex must attach the uploaded image without submitting'
                assert not errors,errors
            finally:
                for session in sessions:context.request.post(origin+'/api/terminal_stop',headers={'Authorization':'Bearer '+token},data={'sessionId':session})
                browser.close()
        print('PASS: auth before bytes, 3MB exact upload, 25MB limit, unique safe paths, non-public storage, real browser picker/paste, draft preservation, PTY reads uploaded file')
    finally:
        process.terminate(); process.wait(timeout=10)
