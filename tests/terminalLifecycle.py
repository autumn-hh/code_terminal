"""Linux real PTY regression. Uses only an isolated Docker container and state."""
import json, os, secrets, subprocess, time, urllib.request, urllib.error, uuid
from pathlib import Path
import websocket

root = Path(__file__).resolve().parents[1]
name = 'terminal-lifecycle-' + uuid.uuid4().hex[:8]
origin = 'http://127.0.0.1:18882'
token = secrets.token_urlsafe(32)
env = os.environ.copy(); env['CODE_TERMINAL_TOKEN'] = token
flags = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
args = ['docker','run','--rm','--init','--name',name,'-p','127.0.0.1:18882:8787',
        '-v',str(root/'src-tauri/target-linux/release')+':/app:ro',
        '-v',str(root/'dist')+':/dist:ro','-e','CODE_TERMINAL_TOKEN',
        '-e','CODE_TERMINAL_ADDR=0.0.0.0:8787','-e','CODE_TERMINAL_DIST=/dist',
        '-e','CODE_TERMINAL_STATE=/tmp/test/state.json','-e','CODE_TERMINAL_IDLE_TIMEOUT_SECONDS=3',
        '-e','CODE_TERMINAL_MAX_SESSIONS=3','-e','SHELL=/bin/bash',
        'debian:bookworm-slim','/app/code-terminal-server']
process = subprocess.Popen(args, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **flags)
def api(cmd, body=None, auth=True):
    headers = {'Content-Type':'application/json'}
    if auth: headers['Authorization']='Bearer '+token
    request=urllib.request.Request(origin+'/api/'+cmd, headers=headers,
                                  data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(request, timeout=6) as response:
        return json.load(response) if response.status!=204 else None
def start(sid):
    return api('terminal_start',{'sessionId':sid,'cols':80,'rows':24,'lease':True})
def beat(*ids):
    return api('terminal_heartbeat',{'sessionIds':list(ids)})
def alive(pid):
    cmd=['docker','exec',name,'sh','-c','test -d /proc/'+str(pid)]
    return subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,**flags).returncode==0
def wait_until(fn, timeout=10):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if fn(): return
        time.sleep(.15)
    raise AssertionError('Condition timed out')
def session_ids():
    return {s['sessionId'] for s in api('terminal_sessions')}
try:
    for _ in range(80):
        if process.poll() is not None: raise AssertionError('Server failed to start')
        try:
            urllib.request.urlopen(origin,timeout=.4).close(); break
        except OSError: time.sleep(.15)
    else: raise AssertionError('Startup timed out')
    for cmd,body in [('terminal_sessions',None),('terminal_heartbeat',{'sessionIds':['x']}),
                     ('terminal_background',{'sessionId':'x','keepAlive':True}),('terminal_attach',{'sessionId':'x'})]:
        try: api(cmd,body,auth=False); raise AssertionError('Anonymous accepted')
        except urllib.error.HTTPError as e: assert e.code==401
    ticket=api('events_ticket',{})
    assert ticket['sessionLease'] and ticket['terminalInput']
    ws=websocket.create_connection(origin.replace('http:','ws:')+'/api/events?ticket='+ticket['ticket'],timeout=5)
    start('ordinary');start('kept')
    api('terminal_background',{'sessionId':'kept','keepAlive':True})
    # Foreground jobs have different process groups inside the same PTY session.
    api('terminal_write',{'sessionId':'ordinary','data':"sleep 999 & printf 'OWNED_PIDS=%s,%s\\n' $$ $!\r"})
    output=''
    while 'OWNED_PIDS=' not in output or not any(line.startswith('OWNED_PIDS=') and ',' in line for line in output.splitlines()):
        msg=json.loads(ws.recv())
        if msg.get('type')=='terminal-output' and msg['payload']['sessionId']=='ordinary': output+=msg['payload']['data']
    line=next(line for line in output.splitlines() if line.startswith('OWNED_PIDS=') and ',' in line)
    pids=[int(x) for x in line.split('=')[1].split(',')]
    ws.close() # Simulate tab close; there is no terminal_stop request.
    for _ in range(4):
        beat('ordinary');time.sleep(.9)
    assert 'ordinary' in session_ids(), 'Heartbeat must preserve the same PTY'
    snap=api('terminal_attach',{'sessionId':'ordinary'})
    assert 'OWNED_PIDS=' in snap['output'] and snap['outputSequence']>0
    before=snap['outputSequence']
    api('terminal_write',{'sessionId':'ordinary','data':"printf 'AFTER_%s\\n' 'RECONNECT'\r"})
    time.sleep(.2)
    delta=api('terminal_attach',{'sessionId':'ordinary','afterSequence':before})
    assert 'AFTER_RECONNECT' in delta['output'] and delta['outputSequence']>before
    wait_until(lambda:'ordinary' not in session_ids(),10)
    wait_until(lambda:all(not alive(pid) for pid in pids),5)
    assert 'kept' in session_ids(), 'Other background session must survive cleanup'
    assert beat('ordinary')['missingSessionIds']==['ordinary']
    assert api('terminal_attach',{'sessionId':'kept'})['keepAlive'] is True
    start('two');start('three')
    for sid in ['two','three']: api('terminal_background',{'sessionId':sid,'keepAlive':True})
    try: start('over-capacity');raise AssertionError('Capacity accepted')
    except urllib.error.HTTPError as e: assert e.code==503
    assert urllib.request.urlopen(origin,timeout=2).status==200, 'Web must remain responsive at capacity'
    api('terminal_stop',{'sessionId':'two'})
    assert 'two' not in session_ids()
    start('replacement')
    api('terminal_stop',{'sessionId':'replacement'})
    api('terminal_background',{'sessionId':'kept','keepAlive':False})
    wait_until(lambda:'kept' not in session_ids(),10)
    assert 'three' in session_ids()
    # Repeated create/stop must not grow shells or server threads.
    def threads():
        return int(subprocess.check_output(['docker','exec',name,'sh','-c',"awk '/Threads:/{print $2}' /proc/$(pidof code-terminal-server)/status"],text=True,**flags).strip())
    baseline=threads()
    for i in range(15):
        sid='churn-'+str(i);start(sid);api('terminal_stop',{'sessionId':sid})
    time.sleep(.4)
    assert threads()<=baseline+2
    assert session_ids()=={'three'}
    api('terminal_stop',{'sessionId':'three'})
    # An old cached client has no heartbeat capability. It must not be silently
    # opted into lease expiry until it actually sends a heartbeat/attach.
    api('terminal_start',{'sessionId':'legacy','cols':80,'rows':24})
    time.sleep(6.2)
    assert 'legacy' in session_ids()
    beat('legacy')
    wait_until(lambda:'legacy' not in session_ids(),10)
    subprocess.run(['docker','update','--pids-limit','44',name],check=True,stdout=subprocess.DEVNULL,**flags)
    try: start('task-pressure');raise AssertionError('Task reserve accepted')
    except urllib.error.HTTPError as e: assert e.code==503
    assert urllib.request.urlopen(origin,timeout=2).status==200
    print(json.dumps({'passed':True,'anonymous401':True,'samePtyReconnect':True,
        'leaseExpiryKillsShellAndJob':True,'backgroundSurvives':True,'missingReported':True,
        'capacity503Web200':True,'explicitStop':True,'churn':15,'threadsBefore':baseline,
        'legacyCompatibility':True,'taskPressure503Web200':True}))
finally:
    subprocess.run(['docker','stop','--time','5',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,**flags)
    process.wait(timeout=10)
