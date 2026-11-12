// Lightweight 0.4.0 regression: ephemeral Chrome context, no project profile caches.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {VERSION} from '../dist/content/catalog.js';
const base=process.env.GAME_URL||'http://127.0.0.1:5179';
const checks=[],errors=[];
const pass=name=>{checks.push(name);console.log('PASS',name);};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
  const context=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  const ready=async()=>{await page.goto(base);await page.waitForSelector('#scene[data-player-x]');};
  const inView=async selector=>{const box=await page.locator(selector).boundingBox();assert(box,selector);assert(box.y>=0&&box.y+box.height<=page.viewportSize().height,`${selector} outside viewport: ${JSON.stringify(box)}`);};
  for(const size of [{width:375,height:812},{width:320,height:640}]){
    await page.setViewportSize(size);await ready();
    const title=await page.locator('.briefing h1').boundingBox();assert(title.width>=160&&title.height<70);
    await inView('#start-button');assert(await page.locator('.panel-foot').isVisible());
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(size.width===375&&process.env.CAPTURE==='1')await page.screenshot({path:'../artifacts/experience-mobile-0.4.0.png'});
    pass(`${size.width}px menu: readable title, visible start and collision hint, no horizontal overflow`);
    await page.locator('#start-button').click();assert.equal(await page.locator('#state-label').textContent(),'即将起飞');
    assert(await page.locator('#launch-now').isVisible());await page.locator('#launch-now').click();
    await page.waitForFunction(()=>document.body.dataset.state==='playing');
    await inView('#control-pad');await inView('.direction-pad');
    // Input is real CDP touch routed through browser pointer handlers.
    const cdp=await context.newCDPSession(page);const pad=await page.locator('#control-pad').boundingBox();
    const before=Number(await page.locator('#scene').getAttribute('data-player-x'));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pad.x+60,y:pad.y+35}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:pad.x+105,y:pad.y+35}]});
    await page.waitForTimeout(140);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const after=Number(await page.locator('#scene').getAttribute('data-player-x'));assert(after>before);
    await page.waitForTimeout(120);assert.equal(Number(await page.locator('#scene').getAttribute('data-player-x')),after);
    await cdp.detach();pass(`${size.width}px touch movement and release stop; controls in viewport`);
    await page.locator('#pause-button').click();const frozen=await page.locator('#time').textContent();
    await page.waitForTimeout(180);assert.equal(await page.locator('#time').textContent(),frozen);
    await page.locator('#settings-button').click();await page.locator('#motion-setting').check();await page.locator('#quality-setting').check();
    await page.locator('#settings-close').click();assert.equal(await page.locator('#state-label').textContent(),'航行暂停');
    await page.locator('#resume-button').click();
    await page.locator('#result-panel').waitFor({state:'visible',timeout:15000});
    const arena=await page.locator('#arena').boundingBox(),result=await page.locator('#result-panel').boundingBox();
    assert(result.y>=arena.y+arena.height);await inView('#retry-button');
    assert(await page.locator('#scene').getAttribute('data-death-bullet'));
    assert.equal(await page.locator('#scene').getAttribute('data-review'),'true');
    if(size.width===375&&process.env.CAPTURE==='1')await page.screenshot({path:'../artifacts/experience-review-0.4.0.png'});
    pass(`${size.width}px collision evidence shown; result does not cover arena; retry reachable`);
    const start=performance.now();await page.locator('#retry-button').click();
    assert.equal(await page.locator('#scene').getAttribute('data-review'),'false');
    await page.waitForFunction(()=>document.body.dataset.state==='playing');
    assert(performance.now()-start<1700,'quick retry exceeded browser test tolerance (not a performance benchmark)');
    const time=Number((await page.locator('#time').textContent()).replace(/s/g,''));assert(time<.5);
    await page.waitForTimeout(100);assert.equal(await page.locator('#scene').getAttribute('data-player-x'),'256.000');
    pass(`${size.width}px quick retry starts fresh with no residual touch movement`);
    await page.locator('#pause-button').click();await page.locator('#pause-home-button').click();await inView('#start-button');
    await page.locator('#start-button').click();await page.keyboard.press('Escape');
    assert.equal(await page.locator('#state-label').textContent(),'航行暂停');
    await page.locator('#resume-button').click();await page.locator('#launch-now').click();
    await page.waitForFunction(()=>document.body.dataset.state==='playing');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});
    assert.equal(await page.locator('#state-label').textContent(),'航行暂停');
    pass(`${size.width}px menu return, countdown pause/resume and simulated background pause`);
  }
  await page.setViewportSize({width:1280,height:800});await ready();
  const arena=await page.locator('#arena').boundingBox();assert(arena.width>=395);await inView('#start-button');
  if(process.env.CAPTURE==='1')await page.screenshot({path:'../artifacts/experience-desktop-0.4.0.png'});
  pass('Desktop arena enlarged to at least 395px at 1280x800');
  for(const size of [{width:812,height:375},{width:768,height:1024}]){
    await page.setViewportSize(size);await ready();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }pass('Landscape and tablet: no horizontal overflow');
  // A previous-version save is loaded in the isolated context, never the user's browser.
  await page.evaluate(()=>localStorage.setItem('skybound50:save',JSON.stringify({schemaVersion:2,records:{classic:21,adventure:43},totalFlight:90,flights:4,preferences:{sound:false,skin:'spectre',sensitivity:1.6,scene:'city',mode:'adventure'}})));
  await page.setViewportSize({width:375,height:812});await ready();assert.equal(await page.locator('#best').textContent(),'43.00');
  await page.locator('[data-mode="classic"]').click();assert.equal(await page.locator('#best').textContent(),'21.00');
  assert.equal(await page.locator('#sound-button').textContent(),'声音关闭');assert.equal(await page.locator('#equipped-name').textContent(),'幽影');
  await page.locator('#settings-button').click();assert.equal(await page.locator('#sensitivity-setting').inputValue(),'1.6');
  await page.locator('#settings-close').scrollIntoViewIfNeeded();await inView('#settings-close');await page.locator('#settings-close').click();pass('Existing schema2 scores, skin, mute and sensitivity retained; mobile settings reachable');
  await page.locator('#sound-button').click();await page.waitForFunction(()=>document.body.dataset.audioState==='running');
  await page.locator('#start-button').click();await page.locator('#launch-now').click();await page.waitForFunction(()=>document.body.dataset.state==='playing');
  await page.waitForFunction(()=>Number(document.body.dataset.audioScheduled)>0);await page.locator('#pause-button').click();
  await page.waitForFunction(()=>document.body.dataset.audioTimer==='false'||document.body.dataset.audioTimer==='0');
  pass('Audio unlock and scheduling still work; pause clears scheduler');
  assert.deepEqual(errors,[]);pass('No browser page errors or failed assets');
  await writeFile('../artifacts/experience-report-0.4.0.json',JSON.stringify({version:VERSION,at:new Date().toISOString(),base,checks,errors,scope:'Ephemeral desktop Chrome with viewport/touch emulation; not physical mobile, listening or performance certification'},null,2));
  await page.close();await context.close();
}finally{await browser.close();}
