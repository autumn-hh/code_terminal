// Run with playwright-cli run-code --filename tests/terminalQuickScroll.browser.js on a local full server.
async (page) => {
  if (!['127.0.0.1','localhost'].includes(new URL(page.url()).hostname)) throw Error('Local server required');
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const writes=[];
  let socket, sessionId;
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/load_state',r=>r.fulfill({json:{projects:[],activeProjectId:null}}));
  await page.routeWebSocket('**/api/events*',ws=>{socket=ws;});
  await page.route('**/api/terminal_*',async r=>{
    const command=r.request().url().split('/').pop(), data=r.request().postDataJSON();
    if(command==='terminal_start')sessionId=data.sessionId;
    if(command==='terminal_write')writes.push(data.data);
    await r.fulfill(command==='terminal_start'?{json:{sessionId,shell:'fixture',cwd:'D:/scroll-check'}}:{status:204});
  });
  await page.evaluate(()=>{localStorage.setItem('code-terminal-view-mode','terminal');localStorage.setItem('opencode-workbench.mobile-chrome-hidden','false');});
  await page.reload();
  await page.getByLabel('输入内容',{exact:true}).waitFor();
  for(let i=0;i<30&&(!socket||!sessionId);i++)await page.waitForTimeout(100);
  const output=async data=>{socket.send(JSON.stringify({type:'terminalOutput',payload:{sessionId,data}}));await page.waitForTimeout(350);};
  const grip=()=>page.locator('.terminal-quick-scroll-grip');
  async function dragTo(fraction, touch=false, cancel=false){
    const g=await grip().boundingBox(), r=await page.locator('.terminal-quick-scroll-track').boundingBox();
    const x=g.x+g.width/2, start=g.y+g.height/2, end=r.y+(r.height-g.height)*fraction+g.height/2;
    if(touch){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:start}]});
      for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:start+(end-start)*i/8}]});
      await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
    }else{
      await page.mouse.move(x,start); await page.mouse.down();
      await page.mouse.move(x,end,{steps:8}); await page.mouse.up();
    }
    await page.waitForTimeout(100);
  }
  check(await grip().count()===0,'Empty history must not offer a fake draggable position');
  await output(Array.from({length:350},(_,i)=>'line-'+i.toString().padStart(3,'0')+'\r\n').join(''));
  await grip().waitFor();
  const tail=await page.locator('.xterm-rows').innerText();
  writes.length=0;
  await dragTo(0,true);
  check(Number(await grip().getAttribute('aria-valuenow'))===0,'Touch drag must reach terminal history top');
  check(tail!==await page.locator('.xterm-rows').innerText(),'Rendered terminal text must change');
  check(writes.length===0,'History drag must never send terminal input');
  check(!await page.locator('.xterm-helper-textarea').evaluate(el=>el===document.activeElement),'Drag must not focus terminal');
  await output('new output while reading\r\n');
  check(Number(await grip().getAttribute('aria-valuenow'))===0,'New output must preserve reading position');
  await dragTo(1);
  check(await grip().getAttribute('aria-valuenow')===await grip().getAttribute('aria-valuemax'),'Mouse drag must reach bottom');
  const atBottom=await grip().getAttribute('aria-valuenow');
  const edge=await grip().boundingBox();
  await page.mouse.move(edge.x+edge.width/2,edge.y+2); await page.mouse.down();
  check(await grip().getAttribute('aria-valuenow')===atBottom,'Grabbing off-center must not jump');
  await page.mouse.move(edge.x-100,0,{steps:10}); await page.mouse.up();
  check(Number(await grip().getAttribute('aria-valuenow'))===0,'Pointer capture must clamp a drag beyond the rail');
  await dragTo(0.4,true,true);
  await dragTo(1,true);
  await grip().press('Home');
  check(Number(await grip().getAttribute('aria-valuenow'))===0,'Home must reach top');
  await grip().press('End');
  await page.screenshot({path:'output/playwright/quick-scroll-terminal-390.png'});
  await output('\x1b[?1049h\x1b[2J\x1b[HFull screen TUI\r\n');
  check(await grip().getAttribute('role')===null,'Program-controlled scroll must not claim absolute progress');
  writes.length=0;
  await dragTo(0.1,true);
  check(writes.some(data=>/\x1b[\[O]A/.test(data)),'TUI drag must send up navigation');
  await output('\x1b[?1000h\x1b[?1006h');
  writes.length=0;
  await dragTo(0.9,true);
  check(writes.some(data=>/\x1b\[<65;/.test(data)),'TUI drag must use mouse protocol');
  await page.screenshot({path:'output/playwright/quick-scroll-tui-390.png'});
  await output('\x1b[?1000l\x1b[?1006l');
  await page.getByRole('button',{name:'对话',exact:true}).click();
  const input=page.getByLabel('输入内容',{exact:true});
  for(let i=0;i<18;i++){await input.fill('长文字-'+i+'-'+'continuous_code_'.repeat(8));await input.press('Enter');}
  const log=page.getByLabel('对话记录',{exact:true});
  await dragTo(0,true);
  check(await log.evaluate(el=>el.scrollTop)===0,'Dialog touch drag must reach top');
  await output('\x1b[3;1H新的思考过程');
  check(await log.evaluate(el=>el.scrollTop)===0,'Dialog output must preserve dragged position');
  await dragTo(1);
  check(await log.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)<2,'Dialog drag must reach bottom');
  async function checkCompact(mode,touch){
    const bounds=await page.evaluate(mode=>{
      const root=document.querySelector('.terminal-quick-scroll');
      const rail=root.querySelector('.terminal-quick-scroll-track');
      const thumb=root.querySelector('.terminal-quick-scroll-grip');
      const control=root.getBoundingClientRect(), g=thumb.getBoundingClientRect();
      const text=document.querySelector(mode==='终端'?'.terminal-host':'.terminal-dialog-log');
      const textRect=text.getBoundingClientRect();
      const content=root.parentElement.getBoundingClientRect();
      const visible=getComputedStyle(thumb,'::before');
      const visibleLeft=g.right-parseFloat(visible.right)-parseFloat(visible.width);
      const transparent=[root,rail,thumb].every(el=>{
        const s=getComputedStyle(el);
        return s.backgroundColor==='rgba(0, 0, 0, 0)'&&parseFloat(s.borderLeftWidth)===0&&s.boxShadow==='none';
      });
      const freeY=g.top>control.top+24?control.top+8:control.bottom-8;
      const target=document.elementFromPoint(g.x+g.width/2,freeY);
      return {
        clear:visibleLeft>=textRect.right-1,inside:g.top>=control.top-1&&g.bottom<=control.bottom+1&&g.right<=innerWidth,
        hitWidth:g.width,visibleWidth:parseFloat(visible.width),visibleHeight:parseFloat(visible.height),
        gutter:content.right-textRect.right,transparent,
        passThrough:!target?.closest('.terminal-quick-scroll'),
        textOverflow:mode==='对话'&&text.scrollWidth>text.clientWidth,
        pageOverflow:document.documentElement.scrollWidth>innerWidth,
      };
    },mode);
    check(bounds.clear&&bounds.inside&&!bounds.textOverflow&&!bounds.pageOverflow,'Text/control bounds: '+JSON.stringify(bounds));
    check(bounds.hitWidth===(touch?32:18)&&bounds.visibleWidth===(touch?8:6)&&bounds.visibleHeight===32,'Compact grip size: '+JSON.stringify(bounds));
    check(Math.abs(bounds.gutter-12)<1&&bounds.transparent&&bounds.passThrough,'Rail must be compact, transparent and pass through: '+JSON.stringify(bounds));
    check(await page.locator('.terminal-quick-scroll-step').count()===0,'Large arrow buttons must not return');
  }
  for(const [width,height,touch] of [[360,740,true],[390,844,true],[884,1104,true],[1180,820,true],[884,420,true],[1280,820,false]]){
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:5});
    await page.setViewportSize({width,height});
    await page.waitForTimeout(200);
    await dragTo(0.4,touch);
    for(const mode of ['对话','终端']){
      await page.getByRole('button',{name:mode,exact:true}).click();
      await checkCompact(mode,touch);
      await page.screenshot({path:'output/playwright/quick-scroll-'+(mode==='终端'?'tui':'dialog')+'-'+width+'x'+height+'.png'});
    }
    await page.getByRole('button',{name:'对话',exact:true}).click();
  }
  await page.route('**/api/set_terminal_appearance',r=>r.fulfill({json:{projects:[],activeProjectId:null,terminalAppearance:r.request().postDataJSON().appearance}}));
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'浅色',exact:true}).click();
  await page.getByRole('spinbutton',{name:'字号',exact:true}).fill('22');
  await page.getByRole('spinbutton',{name:'字号',exact:true}).press('Tab');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  // 1920x1230 physical display at 150% scaling: 1280x820 CSS pixels.
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:820,deviceScaleFactor:1.5,mobile:false});
  for(const mode of ['对话','终端']){
    await page.getByRole('button',{name:mode,exact:true}).click();
    await page.waitForTimeout(200);
    await dragTo(0.4);
    await checkCompact(mode,false);
    await page.mouse.move(200,100);
    await page.screenshot({path:'output/playwright/compact-light-150-'+(mode==='终端'?'tui':'dialog')+'.png'});
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  return {passed:['empty history','touch and mouse history drag','text changes','no focus/input theft','output preserves position','cancel then re-drag','keyboard Home/End','alternate TUI','SGR mouse protocol','dialog drag','phone/tablet/desktop and short-height visual boundaries','transparent rail click-through','12px gutter and slim grip','light theme at 150% display scaling and 22px text']};
}
