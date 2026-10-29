// Local full server; delayed socket peer tests frontend ordering and recovery.
async page => {
  if(new URL(page.url()).hostname!=='127.0.0.1')throw Error('Local server required');
  const check=(ok,m)=>{if(!ok)throw Error(m);},esc=String.fromCharCode(27),enter=String.fromCharCode(13);
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await page.setViewportSize({width:390,height:844});
  let socket,sessionId,delay=180,disconnect=false,connections=0;const frames=[],http=[];
  await page.route('**/api/load_state',r=>r.fulfill({json:{projects:[],activeProjectId:null}}));
  await page.route('**/api/events_ticket',r=>r.fulfill({json:{ticket:null,terminalInput:true}}));
  await page.route('**/api/terminal_*',async r=>{
    const cmd=r.request().url().split('/').pop(),data=r.request().postDataJSON();
    if(cmd==='terminal_start')sessionId=data.sessionId;
    if(cmd==='terminal_write')http.push(data);
    await r.fulfill(cmd==='terminal_start'?{json:{sessionId,shell:'fixture',cwd:'D:/ws-test'}}:{status:204});
  });
  await page.routeWebSocket('**/api/events*',ws=>{
    socket=ws;++connections;
    ws.onMessage(raw=>{
      const frame=JSON.parse(raw);frames.push({...frame,at:Date.now()});
      if(disconnect){disconnect=false;ws.close();return;}
      setTimeout(()=>{try{ws.send(JSON.stringify({type:'terminal-input-ack',id:frame.id,error:null}));}catch{}},delay);
    });
  });
  await page.evaluate(()=>localStorage.setItem('code-terminal-view-mode','terminal'));
  await page.reload();await page.getByLabel('输入内容',{exact:true}).waitFor();
  for(let i=0;i<30&&(!socket||!sessionId);i++)await page.waitForTimeout(100);
  socket.send(JSON.stringify({type:'terminalOutput',payload:{sessionId,data:esc+'[?1049h'+esc+'[?1000h'+esc+'[?1006h'+esc+'[?2004h'+esc+'[2J'+esc+'[HSocket fixture'}}));await page.waitForTimeout(300);
  await page.evaluate(()=>{window.codeTerminalPerf.enable();window.codeTerminalPerf.reset();});
  const start=frames.length;
  for(let i=0;i<3;i++){
    await page.locator('.xterm').evaluate(el=>{const r=el.querySelector('.xterm-screen').getBoundingClientRect();el.dispatchEvent(new WheelEvent('wheel',{deltaY:-1,deltaMode:1,bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));});
    await page.waitForTimeout(15);
  }
  check(frames.length-start===3,'Wheel frames must pipeline before ACK');
  check(frames.at(-1).at-frames[start].at<180,'No one-RTT gating');await page.waitForTimeout(250);
  const input=page.getByLabel('输入内容',{exact:true}),beforePaste=frames.length;
  await input.fill('中文粘贴');await input.press('Enter');await page.waitForTimeout(650);
  const pasted=frames.slice(beforePaste);
  check(pasted.length===2&&pasted[0].data===esc+'[200~中文粘贴'+esc+'[201~'&&pasted[1].data===enter,'Separate paste and Enter');
  check(pasted[1].at-pasted[0].at>=340,'Paste ACK plus delivery gap');
  disconnect=true;await input.fill('must-not-replay');await input.press('Enter');await page.waitForTimeout(1500);
  check(connections>=2,'Disconnected socket must reconnect');
  const failed=frames.filter(f=>f.data.includes('must-not-replay'));
  check(failed.length===1,'Uncertain input must never replay');
  const failedIndex=frames.indexOf(failed[0]);check(!frames.slice(failedIndex+1).some(f=>f.data===enter),'Failed paste must not submit');
  delay=0;await input.press('Enter');await page.waitForTimeout(150);
  check(frames.at(-1).data===enter,'Explicit input works after reconnect');check(http.length===0,'No HTTP replay after socket failure');
  return {pipelineBeforeAck:true,pasteGap:true,disconnectNoReplay:true,reconnect:true,httpWrites:0,diagnostics:await page.evaluate(()=>window.codeTerminalPerf.snapshot())};
}
