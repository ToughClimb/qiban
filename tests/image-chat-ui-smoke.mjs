// Real production renderer; generated PNG and synthetic bridge only. No paid/live calls.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { characters } from '../shared/characters.ts';
const png = await readFile(new URL('./fixtures/chat-image.png', import.meta.url));
const previewUrl = `data:image/png;base64,${png.toString('base64')}`;
const image = { id: 'image-00000000-0000-0000-0000-000000000001', mimeType: 'image/png', byteLength: png.length, width:384, height:240 };
const url='http://127.0.0.1:3116';
const server=spawn(process.execPath,['dist/server/index.js'],{env:{...process.env,NODE_ENV:'production',QIBAN_MODE:'demo',HOST:'127.0.0.1',PORT:'3116'},stdio:'ignore'});
let browser;
const failures=[];
async function scenario(name, exercise, options={}) {
 if(process.env.QIBAN_IMAGE_UI_FILTER&&!name.includes(process.env.QIBAN_IMAGE_UI_FILTER))return;
 const context=await browser.newContext({viewport:options.mobile?{width:390,height:844}:{width:1280,height:800}});
 await context.addInitScript(({characters,previewUrl,image,options})=>{
  const ok=value=>({ok:true,value});
  const seeded=options.history||{};
  if(!localStorage.getItem('synthetic.image.initialized')){
   localStorage.setItem('synthetic.image.initialized','yes');
   localStorage.setItem('synthetic.image.history',JSON.stringify(seeded));
  }
  localStorage.setItem('qiban.onboarded.v1','yes');
  if(options.accent&&!localStorage.getItem('qiban.appearance.v1'))localStorage.setItem('qiban.appearance.v1',JSON.stringify({version:1,accent:options.accent}));
  const fixture=window.imageFixture={picks:[],previews:[],discards:[],requests:[],pickMode:'success',chatMode:options.chatMode??'success',previewMode:options.previewMode??'success',count:0,omittedImageIds:[],cancelled:[]};
  const status={mode:'demo',baseUrl:'https://api.deepseek.com',model:'',models:[],hasKey:false,remembered:false,needsSelection:false};
  window.qiban={
   status:async()=>ok(status),cards:async()=>ok({characters,issues:[]}),dataPath:async()=>ok('Synthetic fixture'),
   loadHistory:async()=>ok(JSON.parse(localStorage.getItem('synthetic.image.history'))),
   saveHistory:async value=>{localStorage.setItem('synthetic.image.history',JSON.stringify(value));return ok();},
   demo:async()=>ok(status),deleteData:async()=>ok(),cancel:id=>fixture.cancelled.push(id),
   pickChatImage:async characterId=>{
    fixture.picks.push(characterId);
    if(fixture.pickMode==='cancel')return ok(null);
    if(fixture.pickMode==='error')return {ok:false,error:'这张图片无法添加，请选择 PNG、JPEG 或 WebP。'};
    const picked={...image,id:`image-00000000-0000-0000-0000-${String(++fixture.count).padStart(12,'0')}`};
    const value={image:picked,previewUrl:fixture.previewMode==='remote'?'https://example.invalid/private.png':previewUrl};
    if(fixture.pickMode==='delay')return new Promise(resolve=>{fixture.finishPick=()=>resolve(ok(value));});
    return ok(value);
   },
   chatImagePreview:async(characterId,id)=>{
    fixture.previews.push({characterId,id});
    if(fixture.previewMode==='missing')return ok(null);
    if(fixture.previewMode==='delay')return new Promise(resolve=>{fixture.finishPreview=value=>resolve(ok(value));});
    if(fixture.previewMode==='remote')return ok('https://example.invalid/private.png');
    return ok(previewUrl);
   },
   discardChatImage:async(characterId,id)=>{fixture.discards.push({characterId,id});return ok();},
   chat:async(request,id)=>{
    fixture.requests.push(structuredClone(request));
    if(fixture.chatMode==='missing')return {ok:false,error:'图片无法读取，请编辑消息后重新选择。'};
    if(fixture.chatMode==='error')return {ok:false,error:'当前模型暂不支持图片，请选择支持图片的模型。'};
    const value={content:'这是一张演示图片。演示模式不会识别图片，我们可以聊聊你想去的地方。',mode:'demo',omittedImageIds:fixture.omittedImageIds};
    if(fixture.chatMode==='delay')return new Promise(resolve=>{fixture.finishChat=()=>resolve(ok(value));});
    return ok(value);
   },
  };
  if(options.unsupported){delete window.qiban.pickChatImage;delete window.qiban.chatImagePreview;delete window.qiban.discardChatImage;}
 },{characters,previewUrl,image,options});
 const page=await context.newPage();const errors=[],remote=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(!request.url().startsWith(url)&&!request.url().startsWith('data:'))remote.push(request.url());});
 try{
  await page.goto(url);
  if(options.history?.lin?.at(-1)?.role==='user')await expect(page.getByRole('button',{name:'编辑消息'})).toBeEnabled();
  else await expect(page.getByRole('textbox',{name:/发消息/})).toBeEnabled();
  await exercise(page);
  expect(errors).toEqual([]); expect(remote).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  console.log(`PASS ${name}`);
 }catch(error){failures.push(name);console.error(`FAIL ${name}: ${error.message}`);}
 finally{await context.close();}
}
const input=page=>page.getByRole('textbox',{name:/发消息/});
const attach=page=>page.getByRole('button',{name:'添加图片'});
const send=page=>page.getByRole('button',{name:'发送',exact:true});
const draft=page=>page.getByRole('img',{name:'待发送的图片'});
async function pick(page){await attach(page).click();await expect(draft(page)).toBeVisible();}
async function change(page,value){await page.evaluate(value=>Object.assign(window.imageFixture,value),value);}
async function fixture(page){return page.evaluate(()=>window.imageFixture);}
async function shot(page,name){await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(250);await page.screenshot({path:`artifacts/image-chat/image-chat-${name}.png`});}
try{
 for(let attempt=0;attempt<40;attempt++){
  try{if((await fetch(`${url}/api/config`)).ok)break;}catch{}
  if(attempt===39)throw Error('Production renderer did not start');
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 await mkdir('artifacts/image-chat',{recursive:true});
 await scenario('select locally, single preview, keyboard remove, picker cancel and unsupported platform',async page=>{
  await pick(page);await expect(send(page)).toBeEnabled();await expect(attach(page)).toBeDisabled();
  expect((await fixture(page)).requests).toHaveLength(0);
  const remove=page.getByRole('button',{name:'移除待发送图片'});await remove.focus();await page.keyboard.press('Enter');
  await expect(draft(page)).toHaveCount(0);await expect(input(page)).toBeFocused();
  expect((await fixture(page)).discards).toEqual([{characterId:'lin',id:image.id}]);
  await change(page,{pickMode:'cancel'});await attach(page).click();await expect(attach(page)).toBeEnabled();
  await expect(draft(page)).toHaveCount(0);expect((await fixture(page)).discards).toHaveLength(1);
 });
 await scenario('unsupported attachment action is visible and text chat stays usable',async page=>{
  await attach(page).click();await expect(page.getByRole('alert')).toHaveText('当前平台暂不支持发送图片。');
  await input(page).fill('普通文本');await send(page).click();await expect(page.locator('.message.user .bubble')).toHaveText('普通文本');
 },{unsupported:true});
 await scenario('picker failures and remote previews do not become image URLs',async page=>{
  await change(page,{pickMode:'error'});await attach(page).click();await expect(page.getByRole('alert')).toHaveText('这张图片无法添加，请选择 PNG、JPEG 或 WebP。');
  await change(page,{pickMode:'success',previewMode:'remote'});await attach(page).click();await expect(page.getByRole('alert')).toHaveText('图片无法显示，请重新选择。');
  await expect(draft(page)).toHaveCount(0);expect((await fixture(page)).discards).toHaveLength(1);
 });
 await scenario('switch discards a staged image and a late picker result for the old character',async page=>{
  await pick(page);const companion=page.getByRole('button',{name:'豆包',exact:true});await companion.click();
  await expect(draft(page)).toHaveCount(0);expect((await fixture(page)).discards[0].characterId).toBe('lin');
  await change(page,{pickMode:'delay'});await attach(page).click();
  const next=page.getByRole('button',{name:'陶陶',exact:true});await next.click();await page.evaluate(()=>window.imageFixture.finishPick());
  await expect.poll(async()=> (await fixture(page)).discards.length).toBe(2);await expect(next).toBeFocused();await expect(draft(page)).toHaveCount(0);
  expect((await fixture(page)).discards[1].characterId).toBe('dou');
 });
 await scenario('reset cancels a draft without sending it',async page=>{
  await pick(page);page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'清空聊天'}).click();
  await expect(draft(page)).toHaveCount(0);expect((await fixture(page)).requests).toHaveLength(0);expect((await fixture(page)).discards).toHaveLength(1);
 });
 await scenario('image-only Send carries the opaque attachment, restores focus, and survives history reload',async page=>{
  await pick(page);await input(page).press('Enter');await expect(page.locator('.message.assistant[data-mode] .bubble')).toHaveCount(1);
  await expect(input(page)).toBeFocused();await expect(page.locator('.message.user .chat-image img')).toBeVisible();await expect(page.locator('.message.user .bubble')).toHaveCount(0);
  expect((await fixture(page)).discards).toHaveLength(0);
  expect(await page.evaluate(()=>localStorage.getItem('synthetic.image.history'))).not.toContain('data:image');
  const outgoing=(await fixture(page)).requests[0].messages.at(-1);
  await page.reload();await expect(page.locator('.message.user .chat-image img')).toBeVisible();
  expect((await fixture(page)).previews[0]).toEqual({characterId:'lin',id:image.id});
  // Reload uses persisted references; independently verify the outgoing request below.
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('synthetic.image.history'))).lin[0].image).toEqual(image);
  expect(outgoing).toEqual({role:'user',content:'',image});
 });
 await scenario('unsupported model failure retains the image for retry and edit',async page=>{
  await change(page,{chatMode:'error'});await pick(page);await send(page).click();
  await expect(page.locator('.chat-error')).toHaveText('当前模型暂不支持图片，请选择支持图片的模型。');
  await shot(page,'desktop-unsupported-model');
  await change(page,{chatMode:'success'});await page.getByRole('button',{name:'重试回复'}).click();
  await expect(page.locator('.message.assistant[data-mode] .bubble')).toHaveCount(1);
  const state=await fixture(page);expect(state.picks).toHaveLength(1);
  await change(page,{chatMode:'error'});await pick(page);await send(page).click();await expect(page.locator('.chat-error')).toBeVisible();
  await page.getByRole('button',{name:'编辑消息'}).click();await expect(draft(page)).toBeVisible();
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('synthetic.image.history'))).lin.at(-1).image.id).toBe('image-00000000-0000-0000-0000-000000000002');
  await input(page).fill('重新说说这张图');
  await change(page,{chatMode:'success'});await send(page).click();await expect(page.locator('.message.assistant[data-mode] .bubble')).toHaveCount(2);
  const completed=await fixture(page);
  expect(completed.discards).toHaveLength(0);
  expect(completed.requests[0].messages.at(-1).image).toEqual(image);
  expect(completed.requests[1].messages.at(-1).image).toEqual(image);
  expect(completed.requests.at(-1).messages.at(-1).image.id).toBe('image-00000000-0000-0000-0000-000000000002');
 });
 await scenario('editing keeps the persisted image until Send; switching does not discard history',async page=>{
  await page.getByRole('button',{name:'编辑消息'}).click();await expect(draft(page)).toBeVisible();
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('synthetic.image.history'))).lin.at(-1).image).toEqual(image);
  await page.getByRole('button',{name:'豆包',exact:true}).click();await expect(draft(page)).toHaveCount(0);expect((await fixture(page)).discards).toHaveLength(0);
  await page.getByRole('button',{name:'林野',exact:true}).click();await expect(page.locator('.message.user .chat-image img')).toBeVisible();
  await page.getByRole('button',{name:'编辑消息'}).click();await page.getByRole('button',{name:'移除待发送图片'}).click();await input(page).fill('改成普通文本');
  await send(page).click();await expect(page.locator('.message.user .bubble')).toHaveText('改成普通文本');await expect(page.locator('.message.user .chat-image')).toHaveCount(0);
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('synthetic.image.history'))).lin[0]).not.toHaveProperty('image');
 },{history:{lin:[{id:'synthetic-user',role:'user',content:'',image}]}});
 const missingImage={...image,id:'image-00000000-0000-0000-0000-000000000009'};
 const earlier=[{id:'earlier-user',role:'user',content:'保留前面的聊天'},{id:'earlier-assistant',role:'assistant',content:'前面的合成回复',mode:'demo'}];
 for(const replace of [false,true])await scenario(`missing pending attachment can be edited and ${replace?'replaced':'removed'} without clearing earlier history`,async page=>{
  await page.getByRole('button',{name:'重试回复'}).click();await expect(page.locator('.chat-error')).toHaveText('图片无法读取，请编辑消息后重新选择。');
  await page.getByRole('button',{name:'编辑消息'}).click();await expect(input(page)).toBeEnabled();await expect(input(page)).toHaveValue('原图片的文字');
  await expect(page.getByRole('alert')).toHaveText('原图片无法读取，已从编辑草稿移除。可以发送文字或重新选图。');
  await expect(draft(page)).toHaveCount(0);await expect(attach(page)).toBeEnabled();await expect(page.locator('.message.user .bubble')).toHaveText('保留前面的聊天');
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('synthetic.image.history'))).lin).toEqual([...earlier,{id:'missing-user',role:'user',content:'原图片的文字',image:missingImage}]);
  await input(page).fill(replace?'换一张新图':'改成纯文字');
  if(replace){await change(page,{previewMode:'success'});await pick(page);}
  await change(page,{chatMode:'success'});await send(page).click();await expect(page.locator('.message.assistant[data-mode] .bubble')).toHaveCount(2);
  const saved=JSON.parse(await page.evaluate(()=>localStorage.getItem('synthetic.image.history'))).lin;
  expect(saved.slice(0,2)).toEqual(earlier);expect(saved).toHaveLength(4);expect(saved[2].id).toBe('missing-user');
  if(replace){expect(saved[2].image).toEqual(image);await expect(page.locator('.message.user .chat-image img')).toBeVisible();}
  else {expect(saved[2]).not.toHaveProperty('image');await expect(page.locator('.message.user .chat-image')).toHaveCount(0);}
  await expect(input(page)).toBeFocused();await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await fixture(page)).discards).toHaveLength(0);
 },{previewMode:'missing',chatMode:'missing',history:{lin:[...earlier,{id:'missing-user',role:'user',content:'原图片的文字',image:missingImage}]}});
 await scenario('missing pending attachment cancellation does not reopen another character editor',async page=>{
  await expect(page.locator('.message.user .chat-image img')).toBeVisible();await change(page,{previewMode:'delay'});
  await page.getByRole('button',{name:'编辑消息'}).click();await page.waitForFunction(()=>typeof window.imageFixture.finishPreview==='function');
  const next=page.getByRole('button',{name:'豆包',exact:true});await next.click();await page.evaluate(()=>window.imageFixture.finishPreview(null));
  await expect(page.getByRole('heading',{name:'豆包',exact:true})).toBeVisible();await expect(input(page)).toBeEnabled();await expect(input(page)).toHaveValue('');
  await expect(next).toBeFocused();await expect(page.getByRole('alert')).toHaveCount(0);await expect(draft(page)).toHaveCount(0);
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('synthetic.image.history'))).lin.at(-1).image).toEqual(missingImage);
 },{history:{lin:[...earlier,{id:'missing-user',role:'user',content:'原图片的文字',image:missingImage}]}});
 const older={...image,id:'image-00000000-0000-0000-0000-000000000009'};
 await scenario('reply omission is visible beside the preserved historical thumbnail',async page=>{
  await change(page,{omittedImageIds:[older.id]});await input(page).fill('继续聊聊');await send(page).click();
  await expect(page.getByText('本次回复未读取这张图片。',{exact:true})).toBeVisible();await expect(page.locator('.message.user .chat-image img')).toBeVisible();
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('synthetic.image.history'))).lin[0].image).toEqual(older);
  await shot(page,'mobile-omitted-image');
 },{mobile:true,history:{lin:[{id:'synthetic-user',role:'user',content:'',image:older},{id:'synthetic-assistant',role:'assistant',content:'合成历史回复',mode:'demo'}]}});
 await scenario('missing and remote history previews show a fallback without network requests',async page=>{
  await change(page,{previewMode:'missing'});await page.getByRole('button',{name:'豆包',exact:true}).click();await page.getByRole('button',{name:'林野',exact:true}).click();
  await expect(page.getByText('图片无法显示。',{exact:true})).toBeVisible();
  await change(page,{previewMode:'remote'});await page.getByRole('button',{name:'豆包',exact:true}).click();await page.getByRole('button',{name:'林野',exact:true}).click();
  await expect(page.getByText('图片无法显示。',{exact:true})).toBeVisible();await expect(page.locator('.chat-image img')).toHaveCount(0);
 },{history:{lin:[{id:'synthetic-user',role:'user',content:'',image},{id:'synthetic-assistant',role:'assistant',content:'合成历史回复',mode:'demo'}]}});
 const manyImages=Array.from({length:4},(_,i)=>({...image,id:`image-00000000-0000-0000-0000-${String(i+9).padStart(12,'0')}`}));
 await scenario('context image limits report omissions while keeping stored references',async page=>{
  await input(page).fill('继续');await send(page).click();await expect(page.locator('.message.assistant[data-mode] .bubble')).toHaveCount(5);
  const request=(await fixture(page)).requests[0];
  expect(request.messages.filter(message=>message.image)).toHaveLength(3);
  expect(request.messages[0].imageOmitted).toBe(true);await expect(page.getByText('本次回复未读取这张图片。',{exact:true})).toBeVisible();
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('synthetic.image.history'))).lin[0].image.id).toBe(manyImages[0].id);
 },{history:{lin:manyImages.flatMap((image,i)=>[{id:`synthetic-u-${i}`,role:'user',content:'',image},{id:`synthetic-a-${i}`,role:'assistant',content:'合成历史回复',mode:'demo'}])}});
 for(const mobile of [false,true])await scenario(`${mobile?'mobile':'desktop'} draft and sent-image composition with preserved theme`,async page=>{
  await pick(page);await input(page).fill('这张图让我想去散步。');await shot(page,`${mobile?'mobile':'desktop'}-draft`);
  await send(page).click();await expect(page.locator('.message.assistant[data-mode] .bubble')).toHaveCount(1);await shot(page,`${mobile?'mobile':'desktop'}-history`);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('qiban.appearance.v1')).accent)).toBe('#46618a');
 },{mobile,accent:'#46618a'});
 if(failures.length)throw Error(`${failures.length} image UI scenarios failed: ${failures.join('; ')}`);
}finally{await browser?.close();server.kill('SIGTERM');}
