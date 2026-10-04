import { _electron, expect } from '@playwright/test';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(),'qiban-native-smoke-'));
let application;
const errors=[];
async function launch() {
  application=await _electron.launch({
    ...(process.env.QIBAN_PACKAGED_EXE ? {executablePath:process.env.QIBAN_PACKAGED_EXE,args:[]} : {args:[...(process.platform==='linux'?['--no-sandbox']:[]),'.']}),
    env:{...process.env,QIBAN_TEST_USER_DATA:directory,...(process.env.QIBAN_PACKAGED_EXE?{APPDATA:directory}:{}),XDG_CACHE_HOME:join(directory,'cache')},
  });
  const page=await application.firstWindow();
  page.on('pageerror',error=>errors.push(error.message));
  await expect(page.getByRole('heading',{name:'林野',exact:true})).toBeVisible();
  return page;
}
try {
  let page=await launch();
  await page.getByRole('button',{name:'先用演示聊天'}).click();
  const preferences=await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  for(const [key,value] of Object.entries({sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true})) expect(preferences[key]).toBe(value);
  expect(await page.evaluate(()=>({require:typeof window.require,process:typeof window.process}))).toEqual({require:'undefined',process:'undefined'});
  expect(await page.evaluate(()=>Object.keys(window.qiban))).not.toContain('invoke');
  const cspBlocked=await page.evaluate(async()=>{try{await fetch('https://example.com');return false;}catch{return true;}});
  expect(cspBlocked).toBe(true);
  await page.getByRole('textbox',{name:/发消息/}).fill('native history fixture');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('.message.assistant .bubble')).toHaveCount(2);
  await page.getByRole('button',{name:/豆包/}).click();
  await expect(page.getByText('native history fixture',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/林野/}).click();
  await expect(page.getByText('native history fixture',{exact:true})).toBeVisible();
  const saved=await page.evaluate(async()=>{const result=await window.qiban.loadHistory();return result.ok&&result.value.lin?.length===2;});
  expect(saved).toBe(true);
  await mkdir('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/native-desktop.png'});
  await application.close();application=undefined;
  page=await launch();
  await expect(page.getByText('native history fixture',{exact:true})).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:/清空聊天/}).click();
  await expect(page.getByText('native history fixture',{exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(`PASS ${process.platform} Electron: offline onboarding, demo chat, isolation/reset/restart, narrow bridge, sandbox, no renderer Node, CSP; zero page errors`);
} finally {
  await application?.close();
  await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:250});
}
