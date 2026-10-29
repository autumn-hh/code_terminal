// Dedicated local server only. Real Codex /status, desktop 1440x960. No model calls.
async page => {
  if(new URL(page.url()).hostname!=='127.0.0.1')throw Error('Use a dedicated local server');
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await page.setViewportSize({width:1440,height:960});
  await page.route('**/api/load_state',r=>r.fulfill({json:{projects:[],activeProjectId:null}}));
  await page.evaluate(()=>localStorage.setItem('code-terminal-view-mode','terminal'));
  await page.reload();await page.locator('.xterm-rows').waitFor();await page.waitForTimeout(1000);
  try {
    const composer=page.getByLabel('输入内容',{exact:true});
    if(!await composer.isVisible())await page.getByRole('button',{name:'辅助输入',exact:true}).click();
    await composer.fill('codex');await composer.press('Enter');
    await page.waitForFunction(()=>document.querySelector('.xterm-rows').textContent.includes('OpenAI Codex'));
    for(let i=0;i<8;i++){await composer.fill('/status');await composer.press('Enter');await page.waitForTimeout(650);}
    await composer.blur();
    const result=await page.evaluate(async()=>{
      const rows=document.querySelector('.xterm-rows'),el=document.querySelector('.xterm');
      let lastText=rows.textContent;const changes=[];
      const observer=new MutationObserver(()=>{const text=rows.textContent;if(text!==lastText){lastText=text;requestAnimationFrame(()=>changes.push(performance.now()));}});
      observer.observe(rows,{subtree:true,childList:true,characterData:true});
      const wheel=direction=>{const r=el.querySelector('.xterm-screen').getBoundingClientRect();el.dispatchEvent(new WheelEvent('wheel',{deltaY:direction,deltaMode:1,bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));};
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const summary=values=>{const sorted=values.slice().sort((a,b)=>a-b);return {samples:sorted.length,p50:sorted[Math.floor(sorted.length*.5)]??null,p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]??null};};
      window.codeTerminalPerf.enable();window.codeTerminalPerf.reset();const latency=[];
      for(let i=0;i<16;i++){changes.length=0;const start=performance.now();wheel(i%2?1:-1);await wait(600);if(changes.length)latency.push(changes[0]-start);}
      changes.length=0;let finalInput=0;
      for(let i=0;i<60;i++){finalInput=performance.now();wheel(-1);await wait(16);}
      await wait(800);observer.disconnect();
      return {isolatedWheelTextFrameMs:summary(latency),denseWheelEvents:60,denseTextChanges:changes.length,
        denseTextIntervalMs:summary(changes.slice(1).map((t,i)=>t-changes[i])),
        trailingTextMs:changes.length?changes.at(-1)-finalInput:null,diagnostics:window.codeTerminalPerf.snapshot()};
    });
    await page.screenshot({path:'output/playwright/terminal-latency-desktop.png'});
    return result;
  } finally {await page.getByRole('button',{name:'关闭此终端',exact:true}).click();}
}
