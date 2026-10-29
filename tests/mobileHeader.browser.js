// Run with playwright-cli run-code in a dedicated local full-server session.
async page => {
  if (!['127.0.0.1','localhost'].includes(new URL(page.url()).hostname)) throw Error('Local fixture only');
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const projectName = 'hc-platform-sim_' + 'continuous_long_name_'.repeat(5);
  const project = {id:'header-project', name:projectName, path:'/test/hc-platform-sim', sessions:[]};
  const state = {projects:[project], activeProjectId:project.id};
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/load_state',r=>r.fulfill({json:state}));
  await page.route('**/api/set_active_project',r=>r.fulfill({json:state}));
  await page.route('**/api/set_terminal_appearance',r=>r.fulfill({json:{...state,terminalAppearance:r.request().postDataJSON().appearance}}));
  await page.route('**/api/events_ticket',r=>r.fulfill({json:{ticket:null}}));
  await page.route('**/api/list_codex_sessions',r=>r.fulfill({json:[]}));
  let socket;
  const sessions = new Set(), stopped = [];
  await page.routeWebSocket('**/api/events*',ws=>{socket=ws;});
  await page.route('**/api/terminal_*',async r=>{
    const cmd=r.request().url().split('/').pop(), data=r.request().postDataJSON();
    if(cmd==='terminal_start')sessions.add(data.sessionId);
    if(cmd==='terminal_stop')stopped.push(data.sessionId);
    await r.fulfill(cmd==='terminal_start'?{json:{sessionId:data.sessionId,cwd:project.path,shell:'fixture'}}:{status:204});
    if(cmd==='terminal_resize' && socket) socket.send(JSON.stringify({type:'terminalOutput',payload:{sessionId:data.sessionId,data:'\x1b[2J\x1b[HHeader layout fixture\r\nCodex TUI output\r\n中文终端内容'}}));
  });
  await page.evaluate(()=>{
    localStorage.setItem('code-terminal-view-mode','terminal');
    localStorage.setItem('opencode-workbench.mobile-chrome-hidden','false');
    localStorage.setItem('opencode-workbench.terminal-layout',JSON.stringify({displayMode:'tabs'}));
  });
  await page.reload();
  const input=page.getByLabel('输入内容',{exact:true});await input.waitFor();
  const settings=page.getByRole('dialog',{name:'工作区设置',exact:true});
  const openSettings=()=>page.getByRole('button',{name:'设置',exact:true}).click();
  const switchView=async name=>{
    await openSettings();await settings.getByRole('button',{name,exact:true}).click();
    await page.locator('.terminal-session.active.mode-'+(name==='对话'?'dialog':'terminal')).waitFor();
  };
  const results=[];
  for(const [width,height] of [[390,844],[360,740],[320,568],[884,1104],[1180,820]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(400);
    const geometry=await page.evaluate(()=>{
      const bar=document.querySelector('.terminal-bar').getBoundingClientRect();
      const content=document.querySelector('.terminal-session-content').getBoundingClientRect();
      const controls=[...document.querySelectorAll('.terminal-bar button')].filter(el=>el.getClientRects().length);
      return {top:bar.top,height:bar.height,contentTop:content.top,contentHeight:content.height,
        overflow:document.documentElement.scrollWidth>innerWidth,
        touch:controls.every(el=>el.getBoundingClientRect().height>=44),
        inside:controls.every(el=>{const r=el.getBoundingClientRect();return r.top>=bar.top&&r.bottom<=bar.bottom&&r.right<=innerWidth;}),
        names:[...document.querySelectorAll('.terminal-tab')].every(el=>el.querySelector('.terminal-tab-main span:last-child').getBoundingClientRect().right<=el.querySelector('.terminal-tab-close').getBoundingClientRect().left)};
    });
    check(geometry.top===0&&geometry.height===48&&geometry.contentTop<=50,'One header row '+JSON.stringify(geometry));
    check(!geometry.overflow&&geometry.touch&&geometry.inside&&geometry.names,'Boundaries '+JSON.stringify(geometry));
    check(!await page.locator('.terminal-session-toolbar').isVisible(),'No persistent view switch');
    check(!await page.locator('.terminal-cell-header').isVisible(),'No repeated title');
    await page.getByRole('button',{name:'切换项目',exact:true}).click();
    check(await page.locator('.sidebar.mobile-open').isVisible(),'Project entry available');
    await page.locator('.mobile-project-backdrop').click();
    await openSettings();
    check(await settings.isVisible(),'Settings entry available');
    await settings.getByRole('button',{name:'关闭设置',exact:true}).click();
    await page.screenshot({path:'output/playwright/header-'+width+'.png'});
    results.push({width,height,...geometry});
  }
  await page.setViewportSize({width:390,height:844});
  await input.fill('保留对话记录');await input.press('Enter');
  await switchView('对话');
  check(await page.locator('.terminal-session.mode-dialog').count()===1,'Settings selects dialog');
  check((await page.getByLabel('对话记录',{exact:true}).innerText()).includes('保留对话记录'),'Transcript preserved');
  await openSettings();check(await settings.getByRole('button',{name:'对话',exact:true}).getAttribute('aria-pressed')==='true','Settings reflects active view');
  await settings.getByRole('button',{name:'终端',exact:true}).click();
  await page.locator('.terminal-session.active.mode-terminal').waitFor();
  const startedBefore=sessions.size;
  for(let i=0;i<4;i++)await page.getByRole('button',{name:'新建终端',exact:true}).click();
  await page.waitForTimeout(500);
  check(await page.getByRole('tab').count()===5,'Create sessions');
  check(await page.locator('.terminal-cell.visible').count()===1,'Tabs keep one output');
  await page.getByRole('tab').first().click();
  await switchView('对话');check((await page.getByLabel('对话记录',{exact:true}).first().innerText()).includes('保留对话记录'),'Switch session preserves text');
  await page.locator('.terminal-tab').last().getByRole('button',{name:'关闭终端',exact:true}).click();
  check(await page.getByRole('tab').count()===4&&stopped.length>0,'Close reachable through horizontal tabs');
  await page.setViewportSize({width:884,height:1104});
  await openSettings();await settings.getByRole('button',{name:'多瓦片',exact:true}).click();
  await settings.getByRole('button',{name:'关闭设置',exact:true}).click();
  check(await page.locator('.terminal-cell.visible .terminal-cell-header').first().isVisible(),'Multiple panes keep identity and drag handle');
  await page.screenshot({path:'output/playwright/header-tiles.png'});
  await openSettings();await settings.getByRole('button',{name:'单 Tab',exact:true}).click();
  await settings.getByRole('spinbutton',{name:'字号',exact:true}).fill('22');
  await settings.getByRole('spinbutton',{name:'字号',exact:true}).press('Tab');
  await settings.getByRole('button',{name:'隐藏顶部',exact:true}).click();
  check(!await page.locator('.terminal-bar').isVisible(),'Hide row');
  await page.getByRole('button',{name:'显示顶部功能',exact:true}).click();
  check(await page.locator('.terminal-bar').isVisible(),'Restore row');
  await switchView('终端');
  await page.screenshot({path:'output/playwright/header-foldable-22px.png'});
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await page.setViewportSize({width:1280,height:900});await page.waitForTimeout(400);
  check(await page.locator('.workspace-bar').isVisible(),'Desktop header preserved');
  check(await page.locator('.terminal-cell.visible .terminal-view-switch').isVisible(),'Desktop switch preserved');
  await page.screenshot({path:'output/playwright/header-desktop.png'});
  return {passed:true,results,created:sessions.size-startedBefore};
}
