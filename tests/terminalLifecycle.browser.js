// Dedicated local full-server fixture; no production sessions are created.
// playwright-cli run-code --filename tests/terminalLifecycle.browser.js
async page => {
  if (!['127.0.0.1','localhost'].includes(new URL(page.url()).hostname)) throw Error('Local fixture only');
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await page.setViewportSize({width:390,height:844});
  let socket, lease=true, heartbeatFails=false, stopFails=false, attachCount=0;
  const starts=[],stops=[],beats=[],sessions=new Map();
  const longPath='/srv/'+'continuous_long_project_'.repeat(8);
  sessions.set('background-fixture',{sessionId:'background-fixture',projectId:null,shell:'bash',cwd:longPath,keepAlive:true});
  sessions.set('other-fixture',{sessionId:'other-fixture',projectId:null,shell:'bash',cwd:'/srv/other',keepAlive:true});
  await page.route('**/api/load_state',r=>r.fulfill({json:{projects:[],activeProjectId:null}}));
  await page.route('**/api/events_ticket',r=>r.fulfill({json:{ticket:null,sessionLease:lease}}));
  await page.routeWebSocket('**/api/events*',ws=>{socket=ws;});
  const emit=(sessionId,data,sequence)=>socket.send(JSON.stringify({type:'terminalOutput',payload:{sessionId,data,sequence}}));
  await page.route('**/api/terminal_*',async r=>{
    const cmd=new URL(r.request().url()).pathname.split('/').pop();
    const data=r.request().method()==='GET'?{}:r.request().postDataJSON();
    if(cmd==='terminal_sessions')return r.fulfill({json:[...sessions.values()]});
    if(cmd==='terminal_heartbeat'){
      beats.push(data.sessionIds);
      if(heartbeatFails)return r.fulfill({status:503});
      return r.fulfill({json:{missingSessionIds:data.sessionIds.filter(id=>!sessions.has(id))}});
    }
    if(cmd==='terminal_start'){
      check(lease ? data.lease===true : data.lease===undefined,'Only capability-negotiated clients opt into lease');
      starts.push(data.sessionId);
      const session={sessionId:data.sessionId,projectId:null,shell:'fixture',cwd:'/fixture',...(lease?{keepAlive:false}:{})};
      sessions.set(data.sessionId,session);return r.fulfill({json:session});
    }
    if(cmd==='terminal_background'){
      check(sessions.has(data.sessionId),'Background references an existing PTY');
      sessions.get(data.sessionId).keepAlive=data.keepAlive;return r.fulfill({status:204});
    }
    if(cmd==='terminal_attach'){
      attachCount++;
      if(data.sessionId==='cancel-fixture'){
        await new Promise(resolve=>setTimeout(resolve,500));
        return r.fulfill({json:{...sessions.get(data.sessionId),output:'still running',outputSequence:1}});
      }
      if(data.afterSequence!==undefined){
        emit(data.sessionId,'RECOVERED-DURING-DISCONNECT\r\n',3);
        emit(data.sessionId,'LIVE-AFTER-RECONNECT\r\n',4);
        await new Promise(resolve=>setTimeout(resolve,100));
        return r.fulfill({json:{...sessions.get(data.sessionId),output:'RECOVERED-DURING-DISCONNECT\r\n',outputSequence:3}});
      }
      // Both messages race the HTTP snapshot; replay only the second one.
      emit(data.sessionId,'SNAPSHOT-ONCE\r\n',1);emit(data.sessionId,'LIVE-AFTER-SNAPSHOT\r\n',2);
      await new Promise(resolve=>setTimeout(resolve,100));
      return r.fulfill({json:{...sessions.get(data.sessionId),output:'SNAPSHOT-ONCE\r\n',outputSequence:1}});
    }
    if(cmd==='terminal_stop'){
      if(stopFails)return r.fulfill({status:503,body:'temporary failure'});
      stops.push(data.sessionId);sessions.delete(data.sessionId);
      socket.send(JSON.stringify({type:'terminalExit',payload:{sessionId:data.sessionId}}));
    }
    return r.fulfill({status:204});
  });
  await page.evaluate(()=>{
    localStorage.setItem('opencode-workbench.mobile-chrome-hidden','false');
    localStorage.setItem('code-terminal-view-mode','terminal');
    localStorage.setItem('opencode-workbench.terminal-layout',JSON.stringify({displayMode:'tabs'}));
  });
  await page.reload();
  await page.getByLabel('输入内容',{exact:true}).waitFor();
  await page.waitForTimeout(600);
  check(starts.length===1,'One initial PTY');
  check(beats.length>0&&beats[0].length===1&&beats[0][0]===starts[0],'Heartbeat only owns page PTY');
  const settings=page.getByRole('dialog',{name:'工作区设置',exact:true});
  const openSettings=()=>page.getByRole('button',{name:'设置',exact:true}).click();
  await openSettings();
  const toggle=page.getByRole('checkbox',{name:'后台保留当前会话',exact:true});
  await toggle.waitFor();check(!await toggle.isChecked(),'Ordinary session default');
  await toggle.click();await page.waitForTimeout(150);
  check(sessions.get(starts[0]).keepAlive&&await toggle.isChecked(),'Background enabled');
  await toggle.click();await page.waitForTimeout(150);
  check(!sessions.get(starts[0]).keepAlive&&!await toggle.isChecked(),'Background disabled');
  for(const width of [320,390,884]){
    await page.setViewportSize({width,height:844});
    await page.waitForTimeout(150);
    await page.getByRole('list',{name:'后台保留的会话',exact:true}).scrollIntoViewIfNeeded();
    const bounded=await page.locator('.settings-background-sessions li').evaluateAll(items=>items.every(item=>{
      const text=item.querySelector('span').getBoundingClientRect(),button=item.querySelector('button').getBoundingClientRect();
      const row=item.getBoundingClientRect();return text.right<=button.left&&row.right<=innerWidth&&item.scrollWidth<=item.clientWidth;
    }));
    check(bounded,'Long background names fit at '+width);
    await page.screenshot({path:'output/playwright/lifecycle-settings-'+width+'.png'});
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'打开后台会话 '+longPath,exact:true}).click();
  await page.waitForTimeout(700);
  check(attachCount===1&&starts.length===1,'Attach reuses PTY without starting a replacement');
  const restoredText=await page.locator('.terminal-session.active .xterm-rows').innerText();
  check(restoredText.split('SNAPSHOT-ONCE').length===2&&restoredText.includes('LIVE-AFTER-SNAPSHOT'),'Snapshot race is deduplicated');
  await openSettings();check(await toggle.isChecked(),'Restored background mode');
  await page.getByRole('button',{name:'结束后台会话 /srv/other',exact:true}).click();
  await page.waitForTimeout(150);check(stops.includes('other-fixture'),'Background list stops selected PTY');
  await settings.getByRole('button',{name:'关闭设置',exact:true}).click();
  const previousBeatCount=beats.length;
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(200);
  check(beats.length>previousBeatCount&&beats.at(-1).includes('background-fixture'),'Wake renews attached PTY immediately');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await page.waitForTimeout(100);check(!stops.includes('background-fixture'),'Pagehide must not terminate background session');
  const timerBeatCount=beats.length;
  await page.waitForTimeout(20500);
  check(beats.length>timerBeatCount,'Periodic heartbeat runs without user interaction');
  socket.close();
  await page.waitForTimeout(1900);
  const reconnectText=await page.locator('.terminal-session.active .xterm-rows').innerText();
  check(reconnectText.split('RECOVERED-DURING-DISCONNECT').length===2&&reconnectText.includes('LIVE-AFTER-RECONNECT'),'Reconnect catches up without duplicate output');
  check(starts.length===1,'Reconnect cannot create a fresh PTY');
  heartbeatFails=true;
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(200);
  check(await page.locator('.terminal-session.active .xterm-rows').isVisible(),'Transient heartbeat failure keeps content');
  heartbeatFails=false;sessions.delete('background-fixture');
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(250);
  await openSettings();
  check(await page.getByRole('button',{name:'停止',exact:true}).isDisabled(),'Missing PTY transitions to stopped');
  check(starts.length===1,'Expired session must not silently recreate');
  await settings.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.getByRole('tab').first().click();
  stopFails=true;
  await openSettings();await page.getByRole('button',{name:'停止',exact:true}).click();
  await page.waitForTimeout(150);
  const finalBeatCount=beats.length;
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(200);
  check(beats.length===finalBeatCount,'Failed stop must also stop renewing a closed ordinary session');
  stopFails=false;
  sessions.set('cancel-fixture',{sessionId:'cancel-fixture',projectId:null,shell:'bash',cwd:'/srv/cancel-attach',keepAlive:true});
  await openSettings();
  await page.getByRole('button',{name:'打开后台会话 /srv/cancel-attach',exact:true}).click();
  await page.waitForTimeout(100);
  await page.locator('.terminal-tab.active .terminal-tab-close').click();
  await page.waitForTimeout(650);
  check(sessions.has('cancel-fixture')&&!stops.includes('cancel-fixture'),'Cancelling an in-flight attach must not kill an existing background job');
  const cancelBeatCount=beats.length;
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(150);
  check(beats.length===cancelBeatCount||!beats.at(-1).includes('cancel-fixture'),'Cancelled attachment must release page lease');
  lease=false;
  await page.reload();await page.getByLabel('输入内容',{exact:true}).waitFor();await page.waitForTimeout(400);
  await openSettings();
  check(await page.getByLabel('网页会话保留',{exact:true}).count()===0,'Older server hides unsupported lifecycle controls');
  const oldBeatCount=beats.length;
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(100);check(beats.length===oldBeatCount,'Older server receives no unsupported heartbeats');
  return {passed:true,starts:starts.length,attachCount,heartbeatRequests:beats.length,
    checks:['page-owned and periodic heartbeat','background on/off','320/390/884 long names','attach snapshot race','reconnect catchup','explicit stop','pagehide preserves','wake heartbeat','missing expires without recreate','failed stop releases lease','cancelled attach preserves job','legacy compatibility']};
}
