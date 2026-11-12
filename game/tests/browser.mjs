import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const base=process.env.GAME_URL||'http://127.0.0.1:5179';
const port=9337;
const profile=path.resolve('.browser-test-profile');
await mkdir(profile,{recursive:true});await mkdir('../artifacts',{recursive:true});
// stdio:ignore avoids named-pipe capture unsupported by the Windows file sandbox.
const chrome=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',[`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--headless=new','--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
let browser;
const checks=[],errors=[];
function pass(name){checks.push(name);console.log('PASS:',name);}
try{
  let endpoint;
  for(let i=0;i<60;i++){try{endpoint=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert(endpoint,'Chrome CDP did not start');
  browser=await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
  const context=browser.contexts()[0];const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
  await page.setViewportSize({width:1440,height:1000});await page.goto(base);await page.evaluate(()=>{localStorage.removeItem('skybound50:save');localStorage.removeItem('skybound50:v0.1.0');});await page.reload();await page.locator('#start-button').waitFor();
  assert.equal(await page.locator('#state-label').textContent(),'等待起飞');
  await page.screenshot({path:'../artifacts/desktop-home-0.4.0.png',fullPage:true});pass('Desktop home renders 0.4.0');
  assert.equal(await page.locator('[data-mode="adventure"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-mode="classic"]').click();
  await page.getByRole('button',{name:'开始飞行'}).click();
  await page.waitForFunction(()=>document.querySelector('#state-label').textContent==='航行中');
  await page.keyboard.down('ArrowLeft');await page.waitForTimeout(600);await page.keyboard.up('ArrowLeft');
  await page.screenshot({path:'../artifacts/desktop-playing.png',fullPage:true});
  await page.getByRole('button',{name:/暂停/}).click();
  const frozen=await page.locator('#time').textContent();await page.waitForTimeout(350);assert.equal(await page.locator('#time').textContent(),frozen);pass('Countdown, keyboard input and pause time freeze');
  await page.getByRole('button',{name:'继续飞行'}).click();await page.waitForTimeout(200);assert.notEqual(await page.locator('#time').textContent(),frozen);pass('Resume advances simulation');
  await page.getByRole('button',{name:'打开设置'}).click();await page.locator('#motion-setting').check();await page.locator('#quality-setting').check();await page.getByRole('button',{name:'保存并返回'}).click();assert.equal(await page.locator('#state-label').textContent(),'航行暂停');pass('Settings preserve pause, motion and quality controls');
  await page.getByRole('button',{name:'结束本局并返回'}).click();
  await page.getByRole('button',{name:'开始飞行'}).click();await page.locator('#result-panel').waitFor({state:'visible',timeout:15000});
  const score=Number(await page.locator('#result-time').textContent());assert(score>0);assert(Number(await page.locator('#best').textContent())>=score);
  const resultTime=await page.locator('#time').textContent();await page.waitForTimeout(250);assert.equal(await page.locator('#time').textContent(),resultTime);
  await page.screenshot({path:'../artifacts/desktop-result.png',fullPage:true});pass('Real collision produces result, best record and frozen final time');
  await page.getByRole('button',{name:'再飞一次'}).click();assert.equal((await page.locator('#time').textContent()).trim(),'00.00 s');pass('Retry resets time');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#state-label').textContent(),'航行暂停');
  await page.reload();assert(Number(await page.locator('#best').textContent())>=score);await page.getByRole('button',{name:'打开设置'}).click();assert(await page.locator('#motion-setting').isChecked());assert(await page.locator('#quality-setting').isChecked());await page.getByRole('button',{name:'保存并返回'}).click();pass('Record and preferences survive reload');
  await page.getByRole('button',{name:'打开设置'}).click();await page.locator('#sound-button').click();assert(await page.locator('#sound-setting').isChecked());await page.locator('#sensitivity-setting').focus();await page.keyboard.press('Escape');assert.equal(await page.locator('#state-label').textContent(),'等待起飞');assert.equal(await page.locator('#sound-button').textContent(),'声音开启');pass('Settings focused Escape and sound synchronization regressions');
  await page.getByRole('button',{name:'操作与版本说明'}).click();assert(await page.locator('#about').isVisible());await page.getByRole('button',{name:'收起说明'}).click();pass('Version and privacy explanation opens and closes');
  for(const size of [{width:375,height:812},{width:320,height:640},{width:812,height:375}]){
    await page.setViewportSize(size);await page.evaluate(()=>window.scrollTo(0,0));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${size.width}`);
    const box=await page.locator('#arena').boundingBox();assert(Math.abs(box.width-box.height)<2);assert(box.width>200);
    await page.screenshot({path:`../artifacts/layout-${size.width}x${size.height}.png`,fullPage:true});
  }pass('375px, 320px and landscape have square arena and no horizontal overflow');
  await page.setViewportSize({width:375,height:812});
  await page.getByRole('button',{name:'开始飞行'}).click();await page.waitForFunction(()=>document.querySelector('#state-label').textContent==='航行中');
  await page.locator('#control-pad').scrollIntoViewIfNeeded();const startX=Number(await page.locator('#scene').getAttribute('data-player-x'));const pad=await page.locator('#control-pad').boundingBox();await page.mouse.move(pad.x+pad.width*.4,pad.y+pad.height*.5);await page.mouse.down();await page.mouse.move(pad.x+pad.width*.7,pad.y+pad.height*.3,{steps:8});await page.waitForTimeout(200);assert(await page.locator('#control-pad').evaluate(el=>el.classList.contains('active')));await page.mouse.up();assert(!(await page.locator('#control-pad').evaluate(el=>el.classList.contains('active'))));const endX=Number(await page.locator('#scene').getAttribute('data-player-x'));assert(endX>startX+5);await page.waitForTimeout(180);assert.equal(Number(await page.locator('#scene').getAttribute('data-player-x')),endX);
  await page.getByRole('button',{name:/暂停/}).click();await page.screenshot({path:'../artifacts/mobile-paused.png',fullPage:true});pass('Relative pointer control captures and releases cleanly');
  // Real touch pointer events via Chromium input, rather than emulated mouse only.
  await page.getByRole('button',{name:'结束本局并返回'}).click();await page.getByRole('button',{name:'开始飞行'}).click();await page.waitForFunction(()=>document.querySelector('#state-label').textContent==='航行中');
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await page.locator('#control-pad').scrollIntoViewIfNeeded();const touch=await page.locator('#control-pad').boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touch.x+70,y:touch.y+30}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x+140,y:touch.y+20}]});assert(await page.locator('#control-pad').evaluate(el=>el.classList.contains('active')));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert(!(await page.locator('#control-pad').evaluate(el=>el.classList.contains('active'))));pass('CDP touch start/move/end reach pointer controls');
  // Headless tabs do not reliably change document.visibilityState when brought forward.
  // Exercise the actual registered visibility handler with an explicitly simulated hidden state.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});
  assert.equal(await page.locator('#state-label').textContent(),'航行暂停');pass('Simulated hidden-document event safely pauses (not a physical device test)');
  await page.getByRole('button',{name:'结束本局并返回'}).click();
  await page.setViewportSize({width:1440,height:1100});
  await page.locator('#hangar-button').click();assert(await page.locator('[data-equip="spectre"]').isDisabled());
  await page.locator('[data-preview="spectre"]').click();await page.waitForTimeout(100);assert.equal(await page.locator('#scene').getAttribute('data-skin'),'spectre');
  await page.locator('#hangar-close').click();await page.waitForTimeout(100);assert.equal(await page.locator('#scene').getAttribute('data-skin'),'porcelain');assert(!(await page.locator('#menu-mode').textContent()).includes('预览'));
  await page.locator('#hangar-button').click();await page.locator('[data-equip="cobalt"]').click();await page.reload();assert.equal(await page.locator('#equipped-name').textContent(),'蓝梭');pass('Locked skins can preview but not equip; selection persists');
  await page.locator('[data-mode="adventure"]').click();assert.equal(await page.locator('#best').textContent(),'00.00');await page.locator('[data-mode="classic"]').click();assert(Number(await page.locator('#best').textContent())>=score);pass('Mode best scores stay isolated');
  for(const scene of ['cloud','orbit','city']){await page.locator('#scene-choice').selectOption(scene);await page.waitForTimeout(1650);assert.equal(await page.locator('#scene').getAttribute('data-scene'),scene);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`../artifacts/scene-${scene}-0.4.0.png`,fullPage:true});}pass('Three distinct selectable environments finish smooth transitions');
  // Progress fixture validates unlock/equip UI; unit tests cover genuine accumulated-flight awards.
  await page.evaluate(()=>{const key='skybound50:save',s=JSON.parse(localStorage.getItem(key));s.totalFlight=90;localStorage.setItem(key,JSON.stringify(s));});await page.reload();await page.locator('#hangar-button').click();assert(await page.locator('[data-equip="ember"]').isEnabled());assert(await page.locator('[data-equip="spectre"]').isEnabled());await page.locator('[data-equip="spectre"]').click();await page.screenshot({path:'../artifacts/hangar-0.4.0.png',fullPage:true});await page.reload();assert.equal(await page.locator('#equipped-name').textContent(),'幽影');pass('Unlock threshold fixture enables advanced skins and saves equipment');
  await page.locator('#settings-button').click();await page.locator('#sensitivity-setting').evaluate(el=>el.value='1.6');await page.locator('#sensitivity-setting').dispatchEvent('input');assert.equal(await page.locator('#sensitivity-value').textContent(),'1.6×');await page.locator('#settings-close').click();await page.reload();await page.locator('#settings-button').click();assert.equal(await page.locator('#sensitivity-setting').inputValue(),'1.6');await page.locator('#settings-close').click();pass('Continuous sensitivity value persists');
  await page.setViewportSize({width:375,height:812});await page.locator('[data-mode="adventure"]').click();await page.locator('#scene-choice').selectOption('auto');await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'../artifacts/mobile-home-0.4.0.png',fullPage:true});
  await page.locator('#start-button').click();await page.waitForFunction(()=>document.querySelector('#state-label').textContent==='航行中');await page.screenshot({path:'../artifacts/mobile-playing-0.4.0.png',fullPage:true});
  const box=await page.locator('#control-pad').boundingBox();assert(box.y+box.height<=812,'control pad should fit on mobile viewport');pass('Mobile active cockpit keeps drag controls within viewport');
  assert.deepEqual(errors,[]);pass('No browser page errors or failed assets');
  await rm('../artifacts/browser-failure.txt',{force:true});
  await writeFile('../artifacts/browser-report.json',JSON.stringify({version:'0.4.0',at:new Date().toISOString(),base,checks,errors,scope:'Desktop Chrome emulation; not physical mobile or mini-game runtime'},null,2));
}catch(error){await writeFile('../artifacts/browser-failure.txt',String(error.stack));throw error;}
finally{if(browser)await browser.close();chrome.kill();}
