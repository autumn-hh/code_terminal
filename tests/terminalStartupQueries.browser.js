// Run against the production frontend through playwright-cli, on a local server.
async (page) => {
  if (!['127.0.0.1','localhost'].includes(new URL(page.url()).hostname)) throw new Error('Local fixture only');
  const check=(value,message)=>{if(!value)throw new Error(message);};
  const errors=[],writes=[];
  const onError=error=>errors.push(error.message);
  page.on('pageerror',onError);
  let socket,sessionId;
  await page.route('**/api/load_state',r=>r.fulfill({json:{projects:[],activeProjectId:null}}));
  await page.route('**/api/events_ticket',r=>r.fulfill({json:{ticket:null}}));
  await page.routeWebSocket('**/api/events*',ws=>{socket=ws;});
  await page.route('**/api/terminal_*',async r=>{
    const command=r.request().url().split('/').pop(),body=r.request().postDataJSON();
    if(command==='terminal_start')sessionId=body.sessionId;
    if(command==='terminal_write')writes.push(body.data);
    await r.fulfill(command==='terminal_start'?{json:{sessionId,shell:'Startup queries',cwd:'D:/fixture'}}:{status:204});
  });
  try {
    await page.evaluate(()=>localStorage.setItem('code-terminal-view-mode','terminal'));
    await page.reload();await page.locator('.xterm-rows').waitFor();
    for(let i=0;i<50&&(!socket||!sessionId);i++)await page.waitForTimeout(100);
    check(socket&&sessionId,'Fixture ready');
    const esc=String.fromCharCode(27);
    const output=data=>socket.send(JSON.stringify({type:'terminalOutput',payload:{sessionId,data}}));
    // Codex 0.171.0 probes alternate scrolling before drawing its first frame.
    output(esc+'[?1007$p'+esc+'[?2026$p'+esc+'[4$p'+esc+'[c'+esc+'[6n'+esc+']10;?'+esc+'\\'+esc+']11;?'+esc+'\\');
    await page.waitForTimeout(300);
    check(errors.length===0,'Startup queries must not throw: '+errors.join('; '));
    check(writes.includes(esc+'[?1007;0$y'),'Unsupported mode reports unknown');
    check(writes.includes(esc+'[?2026;2$y'),'Synchronized output initially reset');
    check(writes.includes(esc+'[4;2$y'),'ANSI insert mode initially reset');
    check(writes.some(s=>s.includes(esc+'[?1;2c')),'Device attributes reply');
    check(writes.some(s=>s.includes(';')&&s.endsWith('R')),'Cursor position reply');
    check(writes.some(s=>s.startsWith(esc+']10;rgb:'))&&writes.some(s=>s.startsWith(esc+']11;rgb:')),'Theme color replies');
    output(esc+'[?2026h'+esc+'[?2026$p'+esc+'[?1049h'+esc+'[2J'+esc+'[HSTARTUP_FRAME_VISIBLE'+esc+'[?2026l');
    await page.waitForTimeout(400);
    check(writes.includes(esc+'[?2026;1$y'),'Active synchronized output reports set');
    check((await page.locator('.xterm-rows').innerText()).includes('STARTUP_FRAME_VISIBLE'),'First TUI frame renders after queries');
    output(esc+'[2;1HCONTINUED_OUTPUT');
    await page.waitForTimeout(200);
    check((await page.locator('.xterm-rows').innerText()).includes('CONTINUED_OUTPUT'),'Output queue continues');
    check(errors.length===0,'No parser errors');
    await page.screenshot({path:'output/playwright/terminal-startup-queries.png'});
    return {passed:true,queryReplies:writes.length,firstFrame:true,continuedOutput:true};
  } finally {page.off('pageerror',onError);}
}
