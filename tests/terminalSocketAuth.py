"""python tests/terminalSocketAuth.py: real token/ticket boundary, isolated backend."""
import json,os,secrets,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
import websocket
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='terminal-ws-auth-') as folder:
    token=secrets.token_urlsafe(32);env=os.environ.copy()
    env.update(CODE_TERMINAL_ADDR='127.0.0.1:18879',CODE_TERMINAL_TOKEN=token,CODE_TERMINAL_STATE=str(Path(folder)/'state.json'),CODE_TERMINAL_DIST=str(root/'dist'))
    process=subprocess.Popen([str(root/'src-tauri/target/debug/code-terminal-server.exe')],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        origin='http://127.0.0.1:18879';url='ws://127.0.0.1:18879/api/events'
        def ticket(auth=True):
            headers={'Authorization':'Bearer '+token} if auth else {}
            return json.load(urllib.request.urlopen(urllib.request.Request(origin+'/api/events_ticket',data=b'{}',headers=headers),timeout=3))
        for _ in range(50):
            try:t=ticket();break
            except OSError:time.sleep(.1)
        try:ticket(False);raise AssertionError('unauthorized ticket accepted')
        except urllib.error.HTTPError as e:assert e.code==401
        try:websocket.create_connection(url,timeout=3);raise AssertionError('unauthorized websocket accepted')
        except websocket.WebSocketBadStatusException as e:assert e.status_code==401
        assert t['terminalInput'] is True
        ws=websocket.create_connection(url+'?ticket='+t['ticket'],timeout=3)
        try:
            try:websocket.create_connection(url+'?ticket='+t['ticket'],timeout=3);raise AssertionError('ticket replay accepted')
            except websocket.WebSocketBadStatusException as e:assert e.status_code==401
            ws.send(json.dumps({'id':1,'sessionId':'missing','data':'x'}))
            result=json.loads(ws.recv());assert result['type']=='terminal-input-ack' and result['error']
        finally:ws.close()
        print('PASS: authenticated capability, unauthorized ticket/socket 401, single-use ticket, missing-session error')
    finally:process.terminate();process.wait(timeout=10)
