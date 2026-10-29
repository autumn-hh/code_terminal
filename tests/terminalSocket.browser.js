// Local full server. Exercises wire ordering and replay rejection with a real PTY.
async page => {
  if(new URL(page.url()).hostname!=='127.0.0.1')throw Error('Local server required');
  return page.evaluate(async()=>{
    const check=(ok,m)=>{if(!ok)throw Error(m);};
    const headers={'content-type':'application/json'};
    const ticket=await (await fetch('/api/events_ticket',{method:'POST',headers,body:'{}'})).json();
    check(ticket.terminalInput===true,'capability advertised');
    const socket=new WebSocket(location.origin.replace('http','ws')+'/api/events'+(ticket.ticket?'?ticket='+ticket.ticket:''));
    const messages=[];socket.onmessage=e=>messages.push(JSON.parse(e.data));
    await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
    const id='socket-test-'+Date.now();
    const post=(cmd,body)=>fetch('/api/'+cmd,{method:'POST',headers,body:JSON.stringify(body)});
    check((await post('terminal_start',{sessionId:id,cols:80,rows:24})).ok,'PTY start');
    const wait=async f=>{for(let i=0;i<100;i++){if(f())return;await new Promise(r=>setTimeout(r,50));}throw Error('timeout');};
    try {
      await new Promise(r=>setTimeout(r,600));
      ['Write-Output "SOCKET_','ORDER_OK"',String.fromCharCode(13)].forEach((data,i)=>socket.send(JSON.stringify({id:i+1,sessionId:id,data})));
      await wait(()=>messages.filter(m=>m.type==='terminal-input-ack').length===3);
      check(messages.filter(m=>m.type==='terminal-input-ack').every((m,i)=>m.id===i+1&&!m.error),'ordered ACKs');
      // Output rendering is exercised by real Codex UI checks. A raw Windows
      // PTY client has no xterm device-query responses for PSReadLine.
      socket.send(JSON.stringify({id:3,sessionId:id,data:'DO_NOT_REPLAY'}));
      await wait(()=>socket.readyState===3);
      return {realPTY:true,orderedInput:true,orderedAcknowledgement:true,replayClosesConnection:true};
    } finally {await post('terminal_stop',{sessionId:id});socket.close();}
  });
}
