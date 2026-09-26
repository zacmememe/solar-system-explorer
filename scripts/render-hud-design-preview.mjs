import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const root='D:/solar-evidence/hud-directions';await mkdir(root+'/renders',{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:root+'/render-profile-'+process.pid,defaultViewport:{width:1920,height:1200}});
const page=await browser.newPage(),report={errors:[],views:[],interactions:[]},delay=ms=>new Promise(r=>setTimeout(r,ms));page.on('pageerror',e=>report.errors.push(String(e)));
const url=pathToFileURL(root+'/HUD方案对比.html').href;
try{
 await page.goto(url);await page.waitForSelector('.scheme-a');
 await page.click('[data-scheme="b"]');await page.waitForSelector('.scheme-b');await page.click('[data-phase="ground"]');
 await page.click('[data-action="info"]');await page.waitForSelector('.panel');await page.keyboard.press('Escape');if(await page.$('.panel'))throw Error('Escape did not close panel');report.interactions.push('scheme/phase/info/Escape');
 await page.click('#baseline');if(!await page.$('#preview.baseline'))throw Error('baseline unavailable');await page.click('#baseline');report.interactions.push('current HUD same-view toggle');
 await page.keyboard.press('1');await page.keyboard.press('d');await page.waitForSelector('.scheme-a');await page.click('[data-action="hold"]');if(!await page.$eval('[data-action="hold"]',e=>e.textContent.includes('继续下降')))throw Error('hold demonstration failed');report.interactions.push('keyboard and hold demonstration');
 for(const phase of ['orbit','descent','ground']){
  for(const scheme of ['a','b','c']){
   await page.goto(url+`?scheme=${scheme}&phase=${phase}`);await page.setViewport({width:1920,height:1080});
   await page.addStyleTag({content:'.workbench{max-width:none;padding:0}.heading,.toolbar,.caption,.footnote{display:none}.preview-shell{border:0;border-radius:0;width:1920px;height:1080px}'});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await delay(450);
   const boxes=await page.evaluate(()=>{const all=[...document.querySelectorAll('#preview .hud button')];return all.map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,x:r.x,y:r.y,width:r.width,height:r.height};});});
   if(boxes.some(b=>b.x<0||b.x+b.width>1921||b.y<0||b.y+b.height>1081))throw Error(`out of view ${scheme} ${phase}`);
   report.views.push({scheme,phase,buttons:boxes});await page.screenshot({path:`${root}/renders/${scheme}-${phase}.png`});
  }
  await page.goto(url+`?sheet=1&phase=${phase}`);await delay(450);await page.$eval('#sheet',e=>e.scrollIntoView());await (await page.$('#sheet')).screenshot({path:`${root}/renders/compare-${phase}.png`});
 }
}catch(e){report.failure=String(e);process.exitCode=1;}finally{await writeFile(root+'/preview-checks.json',JSON.stringify(report,null,2));await browser.close();}console.log(JSON.stringify({views:report.views.length,interactions:report.interactions,errors:report.errors,failure:report.failure}));
