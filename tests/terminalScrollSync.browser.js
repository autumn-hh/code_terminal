// playwright-cli run-code --filename tests/terminalScrollSync.browser.js
async (page) => {
  if (!['127.0.0.1','localhost'].includes(new URL(page.url()).hostname)) throw Error('Local server required');
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  let socket, sessionId, rows=24, offset=100, frozen=false, active=0, peak=0, requests=0;
  const writes=[];
  await page.setViewportSize({width:1280,height:900});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await page.route('**/api/load_state',r=>r.fulfill({json:{projects:[],activeProjectId:null}}));
  await page.routeWebSocket('**/api/events*',ws=>{socket=ws;});
  const emit=data=>socket.send(JSON.stringify({type:'terminalOutput',payload:{sessionId,data}}));
  const render=()=>emit('\x1b[H'+Array.from({length:rows},(_,i)=>'\x1b[2K'+(i===0?'Fixed header':i===rows-1?'Fixed footer':'content-row-'+String(offset+i).padStart(5,'0'))+(i<rows-1?'\r\n':'')).join(''));
  await page.route('**/api/terminal_*',async r=>{
    const cmd=r.request().url().split('/').pop(), data=r.request().postDataJSON();
    if(cmd==='terminal_start'){sessionId=data.sessionId;rows=data.rows??rows;}
    if(cmd==='terminal_resize')rows=data.rows;
    if(cmd==='terminal_write'){
      ++requests; peak=Math.max(peak,++active); writes.push(data.data);
      await new Promise(resolve=>setTimeout(resolve,180));
      if(!frozen){
        const events=[...data.data.matchAll(/\x1b\[<(64|65);\d+;\d+M/g)];
        for(const match of events)offset=Math.max(0,Math.min(100,offset+(match[1]==='64'?-1:1)));
        if(events.length)render();
      }
      --active;
    }
    await r.fulfill(cmd==='terminal_start'?{json:{sessionId,shell:'fixture',cwd:'D:/scroll-sync'}}:{status:204});
  });
  await page.evaluate(()=>{localStorage.setItem('code-terminal-view-mode','terminal');localStorage.setItem('opencode-workbench.mobile-chrome-hidden','false');});
  await page.reload(); await page.locator('.xterm-rows').waitFor();
  for(let i=0;i<30&&(!socket||!sessionId);i++)await page.waitForTimeout(100);
  rows=await page.locator('.xterm-rows').evaluate(el=>el.children.length);
  emit('\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[2J');render();await page.waitForTimeout(350);
  const grip=page.locator('.terminal-quick-scroll-grip');
  const fraction=()=>grip.evaluate(el=>{const r=el.parentElement.getBoundingClientRect(),g=el.getBoundingClientRect();return (g.y-r.y)/(r.height-g.height);});
  const text=()=>page.locator('.xterm-rows').innerText();
  const wheel=async direction=>{const r=await page.locator('.xterm-screen').boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.wheel(0,direction*120);};
  const initial=await fraction(), initialText=await text();
  await wheel(-1);await page.waitForTimeout(40);
  check(Math.abs(await fraction()-initial)<0.001 && await text()===initialText,'Grip must wait for actual TUI render, even with a 180ms server delay');
  await page.waitForTimeout(300);const up=await fraction();
  check(up<initial && await text()!==initialText,'Confirmed text and grip must move together');
  await wheel(1);await page.waitForTimeout(350);
  check(Math.abs(await fraction()-initial)<0.001,'Actual reverse movement must return grip to original position');
  frozen=true;await wheel(-1);await page.waitForTimeout(350);
  check(Math.abs(await fraction()-initial)<0.001,'Ignored wheel must not move grip');frozen=false;
  await wheel(-1);await page.waitForTimeout(350);
  const beforeDrag=await fraction(), g=await grip.boundingBox();
  await page.mouse.move(g.x+g.width/2,g.y+g.height/2);await page.mouse.down();
  await page.mouse.move(g.x+g.width/2,g.y+g.height/2-100,{steps:12});await page.mouse.up();
  await page.waitForTimeout(2200);
  check(await fraction()<beforeDrag,'Grip drag must move actual content');
  check(peak===1,'Terminal input requests must never overlap: '+peak);
  check(writes.some(data=>(data.match(/\x1b\[<64;/g)||[]).length>1),'Grip steps should share an HTTP request');
  const edge=await grip.boundingBox(), rail=await page.locator('.terminal-quick-scroll-track').boundingBox();
  await page.mouse.move(edge.x+edge.width/2,edge.y+edge.height/2);await page.mouse.down();
  await page.mouse.move(edge.x+edge.width/2,rail.y+1,{steps:5});
  const beforeHold=requests;await page.waitForTimeout(500);
  check(requests>beforeHold,'Holding at the edge must continue sending scroll intent');
  await page.mouse.up();await page.waitForTimeout(650);const released=requests;await page.waitForTimeout(300);
  check(requests===released,'Release must stop scrolling without a stale request backlog');
  const holding=await grip.boundingBox();
  await page.mouse.move(holding.x+holding.width/2,holding.y+holding.height/2);await page.mouse.down();
  await page.mouse.move(holding.x+holding.width/2,rail.y+1,{steps:5});await page.waitForTimeout(120);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();
  await page.waitForTimeout(650);const blurred=requests;await page.waitForTimeout(300);
  check(requests===blurred,'Window blur must cancel the edge repeat');
  const beforeSwitch=await fraction();
  await page.getByRole('button',{name:'对话',exact:true}).click();await page.getByRole('button',{name:'终端',exact:true}).click();await page.waitForTimeout(300);
  check(Math.abs(await fraction()-beforeSwitch)<0.001,'View switch must preserve confirmed TUI position');
  await page.screenshot({path:'output/playwright/scroll-sync-delayed-desktop.png'});
  frozen=true;
  for(const [width,height] of [[390,844],[360,740],[884,1104],[1180,820],[884,420]]){
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await page.setViewportSize({width,height});await page.waitForTimeout(350);
    render();await page.waitForTimeout(250);
    const before=await fraction();await wheel(-1);await page.waitForTimeout(250);
    check(Math.abs(await fraction()-before)<0.001,'Resize or ignored touch-size wheel must not invent progress');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow');
    await page.screenshot({path:'output/playwright/scroll-sync-'+width+'x'+height+'.png'});
  }
  return {delayedRender:true,ignoredWheel:true,actualReverse:true,drag:true,edgeHoldRelease:true,blurCancellation:true,viewSwitch:true,peakRequests:peak,requests,responsive:5};
}
