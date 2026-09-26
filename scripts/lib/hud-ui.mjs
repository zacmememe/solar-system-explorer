// Exercise secondary controls through their actual UI entrances.
export async function journeyAction(page,id){
 const selector=`[data-testid="${id}"]`;
 if(!await page.$(selector))await page.click('[data-testid="hud-site-details"]');
 await page.waitForSelector(selector,{visible:true});await page.click(selector);
 if(await page.$('.hud-popover'))await page.keyboard.press('Escape');
}
export async function timePanel(page){
 if(!await page.$('[aria-label="调整时间流速"]'))await page.click('[aria-controls="hud-observe-panel"]');
 await page.click('[aria-label="调整时间流速"]');
}
