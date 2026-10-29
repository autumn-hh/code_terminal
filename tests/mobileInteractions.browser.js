// Run against a local full server in a dedicated Playwright CLI session.
// npx --package @playwright/cli playwright-cli -s=mobile run-code --filename tests/mobileInteractions.browser.js
async (page) => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(page.url()).hostname)) {
    throw new Error('Run this fixture only against a local test server');
  }
  const writes = [];
  let socket;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/load_state', route => route.fulfill({json:{projects:[],activeProjectId:null}}));
  // Exercise compatibility with a server that only accepts HTTP input.
  await page.route('**/api/events_ticket',r=>r.fulfill({json:{ticket:null}}));
  await page.routeWebSocket('**/api/events*', ws => {socket=ws;});
  const input = page.getByRole('textbox',{name:'输入内容',exact:true});
  let startedId;
  await page.route('**/api/terminal_*', async route => {
    const command=route.request().url().split('/').pop();
    const body=route.request().postDataJSON();
    if(command==='terminal_start') startedId=body.sessionId;
    if(command==='terminal_write') writes.push({...body,at:Date.now()});
    await route.fulfill(command==='terminal_start'?{json:{sessionId:body.sessionId,shell:'UI fixture',cwd:'D:/mobile-check'}}:{status:204});
  });
  await page.evaluate(() => {
    localStorage.setItem('code-terminal-view-mode', 'terminal');
    localStorage.setItem('opencode-workbench.mobile-chrome-hidden', 'false');
  });
  await page.reload();
  await input.waitFor();
  for (let attempt=0; attempt<30 && (!socket || !startedId); attempt++) await page.waitForTimeout(100);
  check(socket && startedId, 'Terminal fixture must be ready');
  const output=async(data)=>{socket.send(JSON.stringify({type:'terminalOutput',payload:{sessionId:startedId,data}}));await page.waitForTimeout(300);};
  await output('Mobile terminal fixture\r\n');
  await input.fill('echo 中文输入');
  writes.length=0;
  await input.evaluate(el=>el.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertLineBreak',bubbles:true,cancelable:true})));
  await page.waitForTimeout(100);
  check(writes.length===1 && writes[0].data==='echo 中文输入\r','Mobile beforeinput must send exactly once');
  writes.length=0;
  await input.press('Enter');
  await page.waitForTimeout(30);
  check(writes.length===1 && writes[0].data==='\r','Empty Enter must confirm terminal');
  await input.fill('first');
  writes.length=0;
  await input.press('Shift+Enter');
  check(await input.inputValue()==='first\n' && writes.length===0,'Shift+Enter must insert newline only');
  await input.fill('中文候选');
  await input.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,keyCode:229,bubbles:true,cancelable:true}));});
  await page.waitForTimeout(50);
  check(writes.length===0 && await input.inputValue()==='中文候选','IME confirmation must not submit');
  await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中文候选'})));
  await input.fill('Get-Ch');
  await page.getByRole('button',{name:'补全命令',exact:true}).click();
  await page.waitForTimeout(100);
  check(writes.length===1 && writes[0].data==='Get-Ch\t','Tab must transfer draft without Enter');
  writes.length=0;
  await page.getByRole('button',{name:'回车确认',exact:true}).click();
  await page.waitForTimeout(50);
  check(writes.length===1 && writes[0].data==='\r','Empty send button must confirm terminal');
  await output('\x1b[?2004h');
  writes.length=0;
  await input.fill('中文\nsecond line');
  await input.press('Enter');
  await page.waitForTimeout(300);
  check(writes.length===2 && writes[0].data==='\x1b[200~中文\nsecond line\x1b[201~' && writes[1].data==='\r' && writes[1].at-writes[0].at>=150,'Bracketed paste needs a separate delayed Enter');
  await output('\x1b[?2004l' + Array.from({length:160},(_,i)=>`history-${i.toString().padStart(3,'0')}\r\n`).join(''));
  async function swipe(from,to){
    const rect=await page.locator('.terminal-host').boundingBox();
    const x=rect.x+rect.width/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:from}]});
    for(let step=1;step<=12;step++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:from+(to-from)*step/12}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(80);
  }
  await input.blur();
  const before=await page.locator('.xterm-rows').innerText();
  writes.length=0;
  await swipe(260,550);
  check(before!==await page.locator('.xterm-rows').innerText(),'Swipe must move history');
  check(writes.length===0,'Shell history swipe must not send terminal keys');
  check(!await page.locator('.xterm-helper-textarea').evaluate(el=>el===document.activeElement),'Swipe must not focus keyboard');
  await page.getByRole('button',{name:'↓ 回到最新',exact:true}).click();
  await output('\x1b[?1049h\x1b[2J\x1b[HFull screen TUI\r\n灰色思考过程\r\n');
  writes.length=0;
  await swipe(260,500);
  check(writes.some(w=>/\x1b[\[O]A/.test(w.data)),'Alternate TUI must receive wheel navigation');
  await output('\x1b[?1000h\x1b[?1006h');
  writes.length=0;
  await swipe(500,260);
  check(writes.some(w=>/\x1b\[<65;/.test(w.data)),'Mouse-aware TUI must receive SGR wheel down');
  await output('\x1b[?1000l\x1b[?1006l\x1b[?1h');
  writes.length=0;
  await page.getByRole('button',{name:'上方向键',exact:true}).click();
  await page.waitForTimeout(50);
  check(writes.length===1 && writes[0].data==='\x1bOA','Shortcut must respect application cursor mode');
  await output('\x1b[?1l');
  await page.getByRole('button',{name:'对话',exact:true}).click();
  for(let i=0;i<12;i++){await input.fill(`长命令-${i}-`+'continuous_code_'.repeat(5));await input.press('Enter');}
  const log=page.getByLabel('对话记录',{exact:true});
  await page.waitForTimeout(200);
  await log.evaluate(el=>el.scrollTop=80);
  await page.waitForTimeout(80);
  const position=await log.evaluate(el=>el.scrollTop);
  await output('\x1b[3;1H\x1b[2m新增思考过程，不应打断阅读\x1b[0m');
  check(Math.abs(await log.evaluate(el=>el.scrollTop)-position)<3,'Incoming output must preserve reading position');
  await page.getByRole('button',{name:'终端',exact:true}).click();
  await page.getByRole('button',{name:'对话',exact:true}).click();
  await page.waitForTimeout(200);
  check(Math.abs(await log.evaluate(el=>el.scrollTop)-position)<3,'Switching views must preserve reading position');
  await page.getByRole('button',{name:'↓ 回到最新',exact:true}).click();
  check(await log.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)<3,'Latest must restore follow');
  await output('\x1b[4;1H后续输出继续跟随');
  check(await log.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)<3,'Follow must continue after latest');
  await page.screenshot({path:'output/playwright/mobile-dialog-390.png'});
  const sizes=[[390,844],[360,740],[360,420],[320,568]];
  for(const [width,height] of sizes){
    await page.setViewportSize({width,height});
    await page.waitForTimeout(400);
    const bounds=await page.evaluate(()=>{
      const toolbar=document.querySelector('.terminal-session-toolbar').getBoundingClientRect();
      const content=document.querySelector('.terminal-session-content').getBoundingClientRect();
      const form=document.querySelector('.terminal-composer').getBoundingClientRect();
      return {overlap:toolbar.bottom>content.top+1,overflow:document.documentElement.scrollWidth>innerWidth,formBottom:form.bottom,height:innerHeight,logOverflow:document.querySelector('.terminal-dialog-log').scrollWidth>document.querySelector('.terminal-dialog-log').clientWidth};
    });
    check(!bounds.overlap&&!bounds.overflow&&!bounds.logOverflow&&bounds.formBottom<=bounds.height,`Layout failed ${width}x${height}: ${JSON.stringify(bounds)}`);
    check(await log.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)<3,'Resize must preserve follow at bottom');
    await page.screenshot({path:`output/playwright/mobile-verified-${width}x${height}.png`});
  }
  await page.setViewportSize({width:360,height:740});
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.route('**/api/set_terminal_appearance', route=>route.fulfill({json:{projects:[],activeProjectId:null,terminalAppearance:route.request().postDataJSON().appearance}}));
  await page.getByRole('spinbutton',{name:'字号',exact:true}).fill('22');
  await page.getByRole('spinbutton',{name:'字号',exact:true}).press('Tab');
  await page.screenshot({path:'output/playwright/mobile-settings-360.png'});
  await page.getByRole('button',{name:'隐藏顶部',exact:true}).click();
  check(!await page.locator('.terminal-session-toolbar').isVisible(),'Toolbar must hide');
  await page.screenshot({path:'output/playwright/mobile-hidden-360.png'});
  await page.getByRole('button',{name:'显示顶部功能',exact:true}).click();
  check(await page.locator('.terminal-session-toolbar').isVisible(),'Toolbar must restore');
  await input.fill('长命令'+'abc0123456789'.repeat(30));
  await page.screenshot({path:'output/playwright/mobile-long-input-360.png'});
  await input.fill('');
  await page.getByRole('button',{name:'辅助输入',exact:true}).click();
  check(!await input.isVisible(),'Input must collapse');
  await page.getByRole('button',{name:'辅助输入',exact:true}).click();
  await page.locator('.terminal-composer-keys').evaluate(el=>el.scrollLeft=el.scrollWidth);
  check(await page.getByRole('button',{name:'中断当前命令',exact:true}).isVisible(),'Last shortcut must be reachable');
  await page.screenshot({path:'output/playwright/mobile-shortcuts-end-360.png'});
  // Crossing the phone layout breakpoint must not remove touch input controls.
  for (const [width,height] of [[720,900],[721,900],[768,1024],[884,1104],[1104,884],[820,1180],[1180,820],[1024,1366],[1366,1024],[884,420],[1180,420],[390,844]]) {
    await page.setViewportSize({width,height});
    await page.getByRole('group',{name:'终端快捷键',exact:true}).waitFor({state:'visible'});
    const keys = page.locator('.terminal-composer-keys');
    await keys.evaluate(el=>el.scrollLeft=0);
    writes.length=0;
    await page.getByRole('button',{name:'上方向键',exact:true}).click();
    await page.waitForTimeout(100);
    check(writes.length===1 && writes[0].data==='\x1b[A','Foldable shortcut must work at '+width+'x'+height);
    const bounds=await keys.evaluate(el=>{
      const rect=el.getBoundingClientRect();
      const form=el.closest('form').getBoundingClientRect();
      return {visible:rect.height>=44 && rect.bottom<=innerHeight && rect.left>=0 && rect.right<=innerWidth,
        insideForm:rect.left>=form.left && rect.right<=form.right && rect.bottom<=form.bottom,
        targets:[...el.querySelectorAll('button')].every(button=>button.getBoundingClientRect().height>=44),
        overflow:document.documentElement.scrollWidth>innerWidth};
    });
    check(bounds.visible && bounds.insideForm && bounds.targets && !bounds.overflow,'Foldable bounds failed: '+JSON.stringify(bounds));
    const toolbar=await page.locator('.terminal-session-toolbar').boundingBox();
    const content=await page.locator('.terminal-session-content').boundingBox();
    check(toolbar.y+toolbar.height<=content.y+1,'Touch toolbar must not cover terminal content');
    if(width>720){
      await page.getByRole('button',{name:'切换项目',exact:true}).click();
      await page.locator('.sidebar.mobile-open').waitFor({state:'visible'});
      const drawer=await page.locator('.sidebar.mobile-open').boundingBox();
      check(drawer.x>=0 && drawer.x+drawer.width<width,'Tablet project drawer must leave an accessible backdrop');
      await page.locator('.mobile-project-backdrop').click();
      await page.getByRole('button',{name:'设置',exact:true}).click();
      const settings=page.getByRole('dialog',{name:'工作区设置',exact:true});
      const settingsBounds=await settings.boundingBox();
      check(settingsBounds.width<=680 && settingsBounds.x>=0 && settingsBounds.x+settingsBounds.width<=width && settingsBounds.y+settingsBounds.height<=height,'Tablet settings must fit the viewport');
      const steppers=await settings.locator('.value-stepper').evaluateAll(elements=>elements.map(el=>{
        const rect=el.getBoundingClientRect();
        return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,
          contained:[...el.querySelectorAll('input,button')].every(child=>{const r=child.getBoundingClientRect();return r.left>=rect.left && r.right<=rect.right+1;})};
      }));
      check(steppers.every(rect=>rect.contained) && (steppers[0].right<=steppers[1].left || steppers[0].bottom<=steppers[1].top),'Tablet font/line controls must not overlap');
      await settings.getByRole('textbox',{name:'光标',exact:true}).scrollIntoViewIfNeeded();
      if(height>700) await page.screenshot({path:'output/playwright/tablet-settings-'+width+'x'+height+'.png'});
      await page.getByRole('button',{name:'隐藏顶部',exact:true}).click();
      check(!await page.locator('.terminal-session-toolbar').isVisible(),'Tablet chrome must hide');
      check(await keys.isVisible(),'Hiding tablet chrome must retain shortcuts');
      await page.getByRole('button',{name:'显示顶部功能',exact:true}).click();
    }
    await page.screenshot({path:'output/playwright/foldable-'+width+'x'+height+'.png'});
  }
  // A phone can initially load while unfolded; the composer must start expanded.
  await page.setViewportSize({width:884,height:1104});
  await page.reload();
  await page.getByRole('group',{name:'终端快捷键',exact:true}).waitFor({state:'visible'});
  await page.getByRole('button',{name:'辅助输入',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.setViewportSize({width:884,height:1104});
  check(!await input.isVisible(),'Folding must preserve an explicitly collapsed composer');
  await page.getByRole('button',{name:'辅助输入',exact:true}).click();
  await page.getByRole('group',{name:'终端快捷键',exact:true}).waitFor({state:'visible'});
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await page.setViewportSize({width:1280,height:820});
  check(!await page.locator('.terminal-composer-keys').isVisible(),'Desktop mouse layout must keep touch shortcuts hidden');
  await page.getByRole('button',{name:'终端',exact:true}).click();
  await page.screenshot({path:'output/playwright/mobile-change-desktop-1280.png'});
  return {passed:['mobile beforeinput','empty Enter/button','Shift+Enter','Chinese composition','Tab completion without submit','delayed bracketed paste','touch shell history without keyboard','alternate TUI navigation','SGR mouse wheel','application cursor mode','reading position across output and switches','return to latest','390/360/320 and keyboard-height boundaries','22px text','hide/restore toolbar','long input','collapse/expand','horizontal shortcuts','desktop switch']};
}
