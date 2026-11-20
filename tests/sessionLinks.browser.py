"""Run with a built Web server/dist and Python Playwright: python tests/sessionLinks.browser.py"""
import json
import os
from pathlib import Path
import secrets
import shlex
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from uuid import uuid4

import psutil
from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[1]
artifacts = root / "output/playwright"
artifacts.mkdir(parents=True, exist_ok=True)
project_id, thread_id, missing_id, foreign_id = (str(uuid4()) for _ in range(4))
title = "流水线验收 · " + "session_code_1234567890" * 3
fixture = """
import json, os, sys
thread = json.loads(os.environ["TEST_THREAD"])
for line in sys.stdin:
    request = json.loads(line)
    if request.get("method") == "thread/list":
        print(json.dumps({"id":1, "result":{"data":[thread]}}), flush=True)
    if request.get("method") == "thread/read":
        requested = request["params"]["threadId"]
        data = dict(thread)
        if requested == os.environ["TEST_FOREIGN"]:
            data.update(id=requested, cwd=os.environ["TEST_FOREIGN_CWD"])
        print(json.dumps({"id":1, "result":{"thread":data}}), flush=True)
"""

with tempfile.TemporaryDirectory(prefix="terminal-session-link-") as directory:
    temporary = Path(directory)
    workspace = temporary / "workspace"
    workspace.mkdir()
    project = dict(id=project_id, name="project-with-long-name", path=str(workspace), status="idle", lastOpenedAt=0)
    state_file = temporary / "state.json"
    state_file.write_text(json.dumps(dict(projects=[project], activeProjectId=project_id)), encoding="utf8")
    script = temporary / "codex_fixture.py"
    script.write_text(fixture, encoding="utf8")
    windows = os.name == "nt"
    if windows:
        (temporary / "codex.cmd").write_text(f'@"{sys.executable}" "{script}" %*\n', encoding="utf8")
    else:
        shim = temporary / "codex"
        shim.write_text(f'#!/bin/sh\nexec {shlex.quote(sys.executable)} {shlex.quote(str(script))} "$@"\n')
        shim.chmod(0o700)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    base = f"http://127.0.0.1:{port}/"
    token = secrets.token_urlsafe(26)
    env = dict(os.environ, CODE_TERMINAL_ADDR=f"127.0.0.1:{port}", CODE_TERMINAL_TOKEN=token,
               CODE_TERMINAL_STATE=str(state_file), CODE_TERMINAL_DIST=str(root / "dist"),
               CODE_TERMINAL_PROJECT_ID="inherited-marker", TEST_FOREIGN=foreign_id,
               TEST_FOREIGN_CWD=str(temporary),
               TEST_THREAD=json.dumps(dict(id=thread_id, name=title, cwd=str(workspace), updatedAt=1)))
    env["PATH"] = str(temporary) + os.pathsep + env["PATH"]
    binary = root / ("src-tauri/target/release/code-terminal-server" + (".exe" if windows else ""))
    proc = subprocess.Popen([str(binary)], cwd=temporary, env=env, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def api(command, body=None):
        req = urllib.request.Request(base + "api/" + command,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=8) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    def url(project, thread):
        return f"{base}?projectId={project}&sessionId={thread}"

    try:
        for _ in range(60):
            try:
                api("load_state")
                break
            except OSError:
                time.sleep(.1)
        for registered in [project_id, None]:
            sid = str(uuid4())
            before = {p.pid for p in psutil.Process(proc.pid).children(recursive=True)}
            api("terminal_start", {"projectId":registered, "sessionId":sid, "cols":80, "rows":24})
            for _ in range(90):
                shells = [p for p in psutil.Process(proc.pid).children(recursive=True)
                          if p.pid not in before and ("powershell" in p.name().lower() if windows else p.name().endswith("sh"))]
                if shells:
                    break
                time.sleep(.1)
            assert shells and shells[0].environ().get("CODE_TERMINAL_PROJECT_ID") == registered
            api("terminal_stop", {"sessionId":sid})
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1280, "height": 820},
                                      permissions=["clipboard-read", "clipboard-write"])
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            # Capture the final resume command at the transport boundary. Real user
            # Codex sessions must never be started by a browser regression test.
            writes, starts = [], []
            page.route("**/api/events_ticket", lambda route: route.fulfill(json={"ticket":None}))
            page.route_web_socket("**/api/events*", lambda ws: None)
            def terminal_route(route):
                command = route.request.url.split("/")[-1]
                body = route.request.post_data_json
                if command == "terminal_start":
                    starts.append(body)
                    route.fulfill(json={"shell":"Test PTY", "cwd":str(workspace), "sessionId":body["sessionId"]})
                elif command == "terminal_write":
                    writes.append(body["data"])
                    route.fulfill(status=204)
                else:
                    route.fulfill(status=204)
            page.route("**/api/terminal_*", terminal_route)
            page.goto(base + "?unused=drop#token=" + token)
            copy = page.get_by_role("button", name="复制会话链接：" + title)
            copy.click()
            expect(page.get_by_role("status").filter(has_text="已复制会话链接")).to_be_visible()
            assert page.evaluate("navigator.clipboard.readText()") == url(project_id, thread_id)
            assert copy.bounding_box()["x"] >= page.locator(".project-session-item").bounding_box()["x"]
            page.screenshot(path=str(artifacts / "session-link-list.png"))
            cdp = ctx.new_cdp_session(page)
            cdp.send("Emulation.setTouchEmulationEnabled", {"enabled":True, "maxTouchPoints":5})
            page.set_viewport_size({"width":360, "height":740})
            page.get_by_role("button", name="切换项目", exact=True).click()
            expect(copy).to_be_visible()
            history_row = page.locator(".project-session-row")
            assert history_row.evaluate("""el => {
                const [title, copy] = el.querySelectorAll("button");
                return title.getBoundingClientRect().right <= copy.getBoundingClientRect().left &&
                    copy.getBoundingClientRect().right <= innerWidth;
            }""")
            copy.focus()
            page.screenshot(path=str(artifacts / "session-link-list-360.png"))
            starts.clear()
            page.goto(url(project_id, thread_id) + "&command=unused")
            enter = page.get_by_role("button", name="进入会话")
            expect(enter).to_be_visible()
            assert not starts and not writes
            for width, height in [(1280,820), (390,844), (360,740)]:
                page.set_viewport_size({"width":width, "height":height})
                expect(page.get_by_role("heading", name=title)).to_be_visible()
                assert page.locator("article").evaluate("(e) => e.scrollWidth <= e.clientWidth && e.getBoundingClientRect().right <= innerWidth")
                page.screenshot(path=str(artifacts / f"session-link-{width}.png"))
            page.evaluate("document.documentElement.style.fontSize = '150%'")
            assert page.locator("article").evaluate("(e) => e.scrollWidth <= e.clientWidth")
            page.screenshot(path=str(artifacts / "session-link-zoom.png"))
            enter.click()
            for _ in range(95):
                if writes:
                    break
                page.wait_for_timeout(100)
            assert [data.strip() for data in writes] == [f"codex resume {thread_id}"], writes
            assert starts and all(start["projectId"] == project_id for start in starts)
            starts.clear()
            for bad, message in [(url(missing_id, thread_id), "未登记"),
                                 (url(project_id, missing_id), "找不到"),
                                 (url(project_id, foreign_id), "找不到"),
                                 (url(project_id, "malformed"), "无效"),
                                 (url(project_id, thread_id) + "&sessionId=" + missing_id, "无效")]:
                page.goto(bad)
                expect(page.get_by_role("alert")).to_contain_text(message)
                assert not enter.count()
            guest = browser.new_context()
            guest_page = guest.new_page()
            guest_page.goto(url(project_id, thread_id))
            expect(guest_page.get_by_role("alert")).to_contain_text("访问权限")
            assert not starts and len(writes) == 1 and not errors
            browser.close()
        print("Session link passed: copied clean URL, exact project/thread, explicit resume, PTY project identity, mobile, errors and authorization")
    finally:
        if proc.poll() is None:
            try:
                for terminal in api("terminal_sessions"):
                    api("terminal_stop", {"sessionId": terminal["sessionId"]})
            finally:
                proc.terminate()
                proc.wait(timeout=10)
