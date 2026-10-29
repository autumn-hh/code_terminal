// Run against a dedicated local full server with playwright-cli run-code.
async (page) => {
  if (!['127.0.0.1','localhost'].includes(new URL(page.url()).hostname)) throw Error('Local fixture required');
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};
  const uploads=[],writes=[];let fail=false,delay=300;
  await page.route('**/api/load_state',r=>r.fulfill({json:{projects:[],activeProjectId:null}}));
  await page.route('**/api/events_ticket',r=>r.fulfill({json:{ticket:null}}));
  await page.routeWebSocket('**/api/events*',()=>{});
  await page.route('**/api/terminal_*',async r=>{
    const cmd=r.request().url().split('/').pop(),data=r.request().postDataJSON();
    if(cmd==='terminal_write')writes.push(data.data);
    await r.fulfill(cmd==='terminal_start'?{json:{sessionId:data.sessionId,shell:'fixture',cwd:'/tmp'}}:{status:204});
  });
  await page.route('**/api/upload_attachment?*',async r=>{
    const name=new URL(r.request().url()).searchParams.get('name');uploads.push(name);
    await new Promise(resolve=>setTimeout(resolve,delay));
    await r.fulfill(fail?{status:500,body:'fixture error'}:{json:'/srv/uploads/unique/file-'+name.replace(/[^a-zA-Z0-9._-]/g,'_')});
  });
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await page.setViewportSize({width:390,height:844});await page.reload();
  const input=page.getByLabel('输入内容',{exact:true}), picker=page.getByLabel('选择附件',{exact:true});
  await input.waitFor();await input.fill('before ');
  await picker.setInputFiles([{name:'first.txt',mimeType:'text/plain',buffer:Buffer.from('hello')},{name:'second.png',mimeType:'image/png',buffer:Buffer.from('image')}]);
  await page.waitForFunction(()=>document.querySelector('form[aria-label="对话输入"]').getAttribute('aria-busy')==='true');
  check(await page.locator('.terminal-composer-send').isDisabled(),'Send is blocked while upload is pending');
  await input.fill('typed during upload ');await input.press('Enter');
  await page.waitForFunction(()=>document.querySelector('form[aria-label="对话输入"]').getAttribute('aria-busy')==='false');
  check((await input.inputValue()).startsWith('typed during upload ')&&(await input.inputValue()).includes('first.txt')&&(await input.inputValue()).includes('second.png'),'Keep draft and all uploaded paths');
  check(writes.length===0,'Upload and pending Enter must not submit');
  fail=true;await picker.setInputFiles({name:'retry.txt',mimeType:'text/plain',buffer:Buffer.from('retry')});
  await page.waitForFunction(()=>document.querySelector('.terminal-upload-status')?.textContent.includes('上传失败'));
  check((await input.inputValue()).includes('first.txt'),'Failure preserves successful attachments');
  fail=false;await picker.setInputFiles({name:'retry.txt',mimeType:'text/plain',buffer:Buffer.from('retry')});
  await page.waitForFunction(()=>document.querySelector('.terminal-composer-input').value.includes('retry.txt'));
  check(uploads.filter(x=>x==='retry.txt').length===2,'Same-file retry works');
  const count=uploads.length;
  await picker.setInputFiles({name:'large.bin',mimeType:'application/octet-stream',buffer:Buffer.alloc(25*1024*1024+1)});
  await page.waitForTimeout(150);check(uploads.length===count,'Oversized file must be rejected before network');
  await input.evaluate(el=>{const dt=new DataTransfer();dt.items.add(new File(['paste'],'pasted.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));});
  await page.waitForFunction(()=>document.querySelector('.terminal-composer-input').value.includes('pasted.png'));
  await input.evaluate(el=>{const dt=new DataTransfer();dt.items.add(new File(['drop'],'dropped.txt'));el.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));});
  await page.waitForFunction(()=>document.querySelector('.terminal-composer-input').value.includes('dropped.txt'));
  check(writes.length===0,'Paste and drop must only populate draft');
  await input.press('Enter');await page.waitForTimeout(300);check(writes.join('').includes('dropped.txt'),'Explicit Enter sends uploaded paths');
  delay=800;
  for(const [width,height,touch] of [[360,740,true],[390,844,true],[884,1104,true],[1180,820,true],[1280,820,false]]){
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:5});await page.setViewportSize({width,height});
    await picker.setInputFiles({name:'很长的截图文件名称_'+ 'continuous_code_'.repeat(12)+'.png',mimeType:'image/png',buffer:Buffer.from('png')});
    await page.waitForTimeout(100);
    const bounds=await page.evaluate(()=>{const b=document.querySelector('.terminal-attachment-button').getBoundingClientRect(),t=document.querySelector('.terminal-composer-toggle').getBoundingClientRect(),s=document.querySelector('.terminal-upload-status');return {clear:t.right<=b.left,inside:b.right<=innerWidth&&s.scrollWidth<=s.clientWidth,page:document.documentElement.scrollWidth<=innerWidth,height:b.height};});
    check(bounds.clear&&bounds.inside&&bounds.page&&(!touch||bounds.height>=44),'Attachment boundaries: '+JSON.stringify(bounds));
    await page.screenshot({path:'output/playwright/attachments-'+width+'x'+height+'.png'});
    await page.waitForFunction(()=>document.querySelector('form[aria-label="对话输入"]').getAttribute('aria-busy')==='false');
  }
  return {picker:true,multiple:true,paste:true,drop:true,draftPreserved:true,noAutoSubmit:true,retry:true,sizeLimit:true,responsive:5};
}
