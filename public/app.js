(function(){
'use strict';
const G=window.CANADIAN_GAME;
const $=id=>document.getElementById(id);
const screens=['home','game','result','final'];
let categoryOrder=[],index=0,score=0,roundAnswers=[],current=null,timer=null,timeLeft=20,submitted=false;
const STORAGE_KEY='canadian-krillion-best-v2';
function best(){return Number(localStorage.getItem(STORAGE_KEY)||0)}
function setBest(v){localStorage.setItem(STORAGE_KEY,String(v))}
function show(name){screens.forEach(s=>$(s).classList.toggle('active',s===name));window.scrollTo({top:0,behavior:'smooth'})}
function shuffle(a){return a.map(x=>[Math.random(),x]).sort((a,b)=>a[0]-b[0]).map(x=>x[1])}
function start(){categoryOrder=shuffle(G.categories.slice());index=0;score=0;roundAnswers=[];$('liveScore').textContent='0';$('bestScore').textContent=best();show('game');loadQuestion()}
function loadQuestion(){clearInterval(timer);submitted=false;current=categoryOrder[index];$('progressText').textContent=(index+1)+' / '+categoryOrder.length;$('progressBar').style.width=((index+1)/categoryOrder.length*100)+'%';$('categoryIcon').textContent=current.icon;$('categoryLabel').textContent='CATEGORY '+(index+1);$('question').textContent='Name a '+current.label.toLowerCase();$('hint').textContent=current.hint;$('answer').value='';$('answer').disabled=false;$('answerForm').querySelector('button').disabled=false;$('gameMessage').textContent='';$('timerRing').className='timer-ring';timeLeft=20;$('timer').textContent=timeLeft;$('answer').focus();timer=setInterval(()=>{timeLeft--;$('timer').textContent=timeLeft;if(timeLeft<=5)$('timerRing').className='timer-ring danger';else if(timeLeft<=10)$('timerRing').className='timer-ring warning';if(timeLeft<=0){clearInterval(timer);if(!submitted){submitted=true;submitAnswer('Time ran out',true)}}},1000)}
async function submitAnswer(raw,timeout){
 if(submitted)return;
 submitted=true;clearInterval(timer);
 const answer=(typeof raw==='string'&&raw!=='Time ran out')?raw:$('answer').value.trim();
 $('answer').disabled=true;$('answerForm').querySelector('button').disabled=true;
 if(timeout&&!answer){showResult({valid:false,points:0,canonicalAnswer:'No answer',explanation:'Time ran out before an answer was submitted.',sourceUrls:[],confidence:'low'});return}
 $('gameMessage').textContent='Checking the internet…';
 try{
   const response=await fetch('/.netlify/functions/verify-answer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({category:current.key,answer})});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(data.error||'Verification is temporarily unavailable.');
   showResult(data,answer);
 }catch(error){
   submitted=false;$('answer').disabled=false;$('answerForm').querySelector('button').disabled=false;$('gameMessage').textContent=error.message||'Could not verify that answer. Please try again.';
 }
}
function showResult(data,fallbackAnswer){
 const answer=data.canonicalAnswer||fallbackAnswer||'No answer';
 const points=Number(data.points||0);
 score+=points;roundAnswers.push({category:current,answer,points,valid:Boolean(data.valid),explanation:data.explanation||'',sourceUrls:data.sourceUrls||[]});$('liveScore').textContent=score;
 $('resultIcon').textContent=current.icon;$('resultAnswer').textContent=answer;$('resultPoints').textContent='+'+points;
 if(data.valid){
   const pct=Number(data.rarityPercent||0);
   $('resultRarity').textContent=pct>0?('Verified online • used by about '+(pct<0.1?pct.toFixed(2):pct.toFixed(1))+'% of recorded answers in this category.'): 'Verified online • first recorded use of this answer.';
   $('rarityBar').style.width=Math.max(4,Math.min(100,100*(1-pct/100)))+'%';
   $('verificationNote').textContent=data.explanation||'Verified with live web research.';
 }else{
   $('resultRarity').textContent='0 points — this answer did not pass online verification.';$('rarityBar').style.width='0%';$('verificationNote').textContent=data.explanation||'The answer could not be verified as fitting this category.';
 }
 show('result');
}
function next(){index++;if(index>=categoryOrder.length)finish();else{show('game');loadQuestion()}}
function finish(){const old=best();const isNew=score>old;if(isNew)setBest(score);$('finalScore').textContent=score;$('finalBest').textContent=Math.max(score,old);$('newBest').classList.toggle('hidden',!isNew);$('finalSubtitle').textContent=score===1?'point':'points';$('answerSummary').innerHTML='';roundAnswers.forEach(r=>{const row=document.createElement('div');row.className='answer-row';row.innerHTML='<span class="icon">'+r.category.icon+'</span><span class="name">'+escapeHtml(r.answer)+'</span><span class="pts">+'+r.points+'</span>'; $('answerSummary').appendChild(row)});show('final')}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
$('startBtn').addEventListener('click',start);$('againBtn').addEventListener('click',start);$('nextBtn').addEventListener('click',next);$('quitBtn').addEventListener('click',()=>{clearInterval(timer);$('bestScore').textContent=best();show('home')});$('homeBtn').addEventListener('click',()=>{clearInterval(timer);$('bestScore').textContent=best();show('home')});$('answerForm').addEventListener('submit',e=>{e.preventDefault();submitAnswer()});$('bestScore').textContent=best();
})();
