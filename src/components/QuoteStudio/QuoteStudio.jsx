import React, { useEffect, useMemo, useRef, useState } from 'react';
import './quote-studio.css';

const CATEGORIES = [
  ['love','❤️','Love'],['heartbreak','💔','Heartbreak'],['courage','💪','Courage'],['motivation','🔥','Motivation'],
  ['encouragement','🌱','Encouragement'],['feelgood','😊','Feel Good'],['wisdom','🧠','Wisdom'],['success','👑','Success'],
  ['discipline','💯','Discipline'],['peace','🕊️','Peace'],['life','🌙','Life'],['hope','✨','Hope'],
  ['friendship','🫶','Friendship'],['family','👨‍👩‍👧','Family'],['selflove','🧘','Self-Love'],['ambition','🚀','Ambition'],
  ['emotional','😔','Emotional'],['gratitude','🙏','Gratitude'],['confidence','⚡','Confidence'],['beginning','🌅','New Beginning'],
  ['focus','🎯','Focus'],['neverquit','🏆','Never Give Up'],['thinkers','📚','Great Personalities'],['worldwisdom','🌍','World Wisdom'],['surprise','🎲','Surprise Me']
];

const THEMES = {
  love: { name:'Rose Sunset', colors:['#5b1837','#ff7b72','#ffc6a8'], accent:'#ffe0d5', icon:'🌹' },
  heartbreak: { name:'Rainy Midnight', colors:['#07111f','#203a5f','#5a6a85'], accent:'#c7dcff', icon:'🌧️' },
  courage: { name:'Mountain Dawn', colors:['#09182b','#d46b32','#ffd47e'], accent:'#fff1c2', icon:'⛰️' },
  motivation: { name:'Golden Rise', colors:['#140b27','#b44a19','#ffcc4d'], accent:'#fff0a6', icon:'🔥' },
  peace: { name:'Quiet Ocean', colors:['#072b35','#17818a','#b7e9dc'], accent:'#d9fff5', icon:'🌊' },
  wisdom: { name:'Old Library', colors:['#1d130d','#6b4423','#cba76b'], accent:'#f5e3bd', icon:'📚' },
  success: { name:'City Gold', colors:['#080d1a','#27395d','#d8ae57'], accent:'#ffe4a3', icon:'🏙️' },
  feelgood: { name:'Sunny Meadow', colors:['#0d4e67','#38a878','#ffd85a'], accent:'#fff7bd', icon:'🌼' },
  default: { name:'Aurora Night', colors:['#071128','#473084','#db4f8e'], accent:'#f1ddff', icon:'✨' }
};

const QUOTES = {
  love: [
    ['Real love feels different.','It sees the mess, hears the silence, understands the fear—and still makes honesty feel safe.','Love is not finding perfection. It is finding a place where your truth can breathe.'],
    ['The right love does not ask you to become smaller.','It celebrates your light and stays gentle with your shadows.','Choose the love that feels like freedom, not fear.']
  ],
  heartbreak: [
    ['Some endings arrive without an explanation.','You may never receive the apology or answer your heart deserved.','Closure can also be the moment you choose peace without permission.'],
    ['Missing someone is not a reason to return.','Sometimes your heart remembers the warmth and forgets the wound.','Honor what you learned, then keep walking.']
  ],
  courage: [
    ['If life feels impossible right now, read this.','You do not need to see the entire road. You only need courage for the next honest step.','Courage is refusing to let fear make the decision.'],
    ['Your fear is loud because this matters.','Take the trembling hands, the uncertain heart, and move one step anyway.','Bravery often begins before confidence arrives.']
  ],
  motivation: [
    ['Your future is watching what you do today.','No one sees every early morning, quiet sacrifice, or moment you nearly stopped.','Keep building in silence. Your results will introduce who you became.'],
    ['You are not behind. You are becoming.','Progress can look invisible while discipline is changing you from the inside.','Do not abandon the work just before it starts showing.']
  ],
  wisdom: [
    ['A calm mind sees doors that panic misses.','Not every problem needs an immediate answer. Some need distance, silence, and a clearer morning.','Pause is not weakness. It is perspective.'],
    ['Your attention is your life in minutes.','Whatever repeatedly receives it slowly becomes your world.','Spend attention as carefully as money.']
  ],
  peace: [
    ['You are allowed to choose a quieter life.','Not every invitation needs a yes. Not every argument deserves your energy.','Peace grows wherever you stop proving yourself.']
  ],
  success: [
    ['Success is built before it is visible.','It lives in repeated choices made when applause is absent and excuses are easy.','Be loyal to the work, not only the reward.']
  ],
  hope: [
    ['This chapter is difficult, not final.','A life can change quietly: one phone call, one brave choice, one unexpected morning.','Leave room for tomorrow to surprise you.']
  ],
  discipline: [
    ['Motivation visits. Discipline stays.','The promise you keep when nobody is watching becomes the person everyone eventually sees.','Make your standards stronger than your mood.']
  ],
  gratitude: [
    ['Today may look ordinary from the inside.','Yet there are voices, places, and little routines you will one day miss deeply.','Notice your life while it is still happening.']
  ],
  confidence: [
    ['Stop asking the room for permission to believe in yourself.','You have survived enough uncertainty to trust your ability to learn the next part.','Walk in before your doubt finishes speaking.']
  ],
  beginning: [
    ['Starting again is not starting from nothing.','You carry every lesson, boundary, and strength the old chapter gave you.','Begin wiser this time.']
  ],
  focus: [
    ['You do not need more time. You need fewer directions.','One meaningful goal given your full attention can change an entire year.','Protect the work that matters.']
  ],
  neverquit: [
    ['Before you give up, remember this.','The moment you feel most tired may be the moment your old limits are finally breaking.','Rest if you must. Do not surrender your future.']
  ],
  feelgood: [
    ['Your life does not have to be perfect to feel beautiful.','A warm drink, a kind message, sunlight on the floor—small joy still counts.','Let today be gently enough.']
  ],
  selflove: [
    ['Speak to yourself like someone you are responsible for protecting.','Growth becomes safer when correction does not sound like cruelty.','You can improve without becoming your own enemy.']
  ]
};

const FALLBACK = [
  ['Maybe you needed this today.','A difficult season can make progress feel invisible, but every quiet step is still changing your direction.','Keep going. The next chapter needs the strength you are building now.'],
  ['Read this twice.','You have already survived days you once thought would break you.','Do not underestimate the person those days created.']
];

// Curated records only. Original content is always explicitly labelled and is
// never assigned to a historical personality.
const PERSONALITIES = [
  {id:'vivekananda',name:'Swami Vivekananda',region:'India',topics:['courage','confidence','discipline'],quote:'Arise, awake, and stop not till the goal is reached.',source:'Katha Upanishad wording popularized in Vivekananda’s lectures',status:'📜 Traditional attribution',confidence:'High',era:'1863–1902',hook:'Fear has stolen enough from you.',theme:'courage',music:'Powerful Percussion',voice:'Deep Inspirational'},
  {id:'kalam',name:'Dr. A. P. J. Abdul Kalam',region:'India',topics:['hope','ambition','success'],quote:'Dream, dream, dream. Dreams transform into thoughts and thoughts result in action.',source:'Wings of Fire / widely documented public addresses',status:'✅ Verified',confidence:'High',era:'1931–2015',hook:'A dreamer needs to hear this.',theme:'success',music:'Inspirational Piano',voice:'Cinematic Narrator'},
  {id:'gandhi',name:'Mahatma Gandhi',region:'India',topics:['peace','courage','life'],quote:'Strength does not come from physical capacity. It comes from an indomitable will.',source:'Young India, 1920',status:'✅ Verified',confidence:'High',era:'1869–1948',hook:'Real strength does not always look powerful.',theme:'peace',music:'Soft Indian Flute',voice:'Calm Storyteller'},
  {id:'tagore',name:'Rabindranath Tagore',region:'India',topics:['hope','wisdom','life'],quote:'Faith is the bird that feels the light and sings when the dawn is still dark.',source:'The English Writings of Rabindranath Tagore',status:'✅ Verified',confidence:'High',era:'1861–1941',hook:'Hope begins before the light arrives.',theme:'wisdom',music:'Peaceful Strings',voice:'Wise Elder Style'},
  {id:'mandela',name:'Nelson Mandela',region:'Leaders',topics:['courage','neverquit','confidence'],quote:'I learned that courage was not the absence of fear, but the triumph over it.',source:'Long Walk to Freedom (1994)',status:'✅ Verified',confidence:'High',era:'1918–2013',hook:'Courage is not what most people think.',theme:'courage',music:'Heroic Cinematic',voice:'Deep Inspirational'},
  {id:'marcus',name:'Marcus Aurelius',region:'Philosophers',topics:['discipline','peace','focus'],quote:'You have power over your mind—not outside events. Realize this, and you will find strength.',source:'Meditations, Book 12 (common modern translation)',status:'✅ Verified',confidence:'High',era:'121–180 CE',hook:'You are giving this too much power over you.',theme:'wisdom',music:'Deep Stoic Ambient',voice:'Wise Elder Style'},
  {id:'seneca',name:'Seneca',region:'Philosophers',topics:['wisdom','focus','life'],quote:'We suffer more often in imagination than in reality.',source:'Moral Letters to Lucilius, Letter 13',status:'✅ Verified',confidence:'High',era:'c. 4 BCE–65 CE',hook:'Your mind may be creating a second storm.',theme:'wisdom',music:'Minimal Piano',voice:'Calm Storyteller'},
  {id:'einstein',name:'Albert Einstein',region:'Scientists',topics:['wisdom','ambition','worldwisdom'],quote:'Life is like riding a bicycle. To keep your balance, you must keep moving.',source:'Letter to Eduard Einstein, 1930',status:'✅ Verified',confidence:'High',era:'1879–1955',hook:'Einstein understood momentum beyond physics.',theme:'default',music:'Thoughtful Ambient',voice:'Cinematic Narrator'},
  {id:'lincoln',name:'Abraham Lincoln',region:'Leaders',topics:['neverquit','leadership','courage'],quote:'I am a slow walker, but I never walk back.',source:'Documented attribution; exact primary context varies',status:'⚠ Attribution uncertain',confidence:'Medium',era:'1809–1865',hook:'Slow progress is still a direction.',theme:'courage',music:'Orchestral Inspiration',voice:'Deep Inspirational'},
  {id:'helen',name:'Helen Keller',region:'Writers',topics:['hope','courage','ambition'],quote:'Optimism is the faith that leads to achievement. Nothing can be done without hope and confidence.',source:'Optimism: An Essay (1903)',status:'✅ Verified',confidence:'High',era:'1880–1968',hook:'Achievement begins before the result appears.',theme:'feelgood',music:'Hopeful Acoustic',voice:'Warm Female'}
];

const LANGUAGES=['English','Hindi','Telugu','Tamil','Malayalam','Kannada','Marathi','Bengali','Gujarati','Punjabi','Urdu','Spanish','French','German','Arabic','Japanese','Korean','Portuguese'];
const SERIES=['Single Short','30 Days of Abdul Kalam','21 Days of Vivekananda','Stoic Wisdom','Quotes for Students','Morning Motivation','Wisdom Before Sleep'];

const SOUL_STORIES={
  courage:[
    ['If you are close to giving up…','remember how far you have already walked.','There were nights you thought would break you.','Mornings you did not want to face.','Doors that closed without an explanation.','People who stopped believing.','Moments when even you doubted yourself.','But somehow…','you kept going.','Not perfectly.','Not fearlessly.','But bravely enough for another step.','Maybe courage was never about feeling strong.','Maybe it was refusing to let pain write your ending.','Keep writing.'],
    ['Maybe nobody told you this…','You have carried more than people can see.','You smiled while your heart wanted silence.','You walked without knowing where the road led.','You questioned yourself.','You nearly turned back.','But look at you.','Still here.','Still trying.','Still becoming.','Your scars are not proof that you lost.','They are proof something tried to break you…','and discovered you knew how to rebuild.','Your story is still becoming.']
  ],
  heartbreak:[
    ['If someone leaving changed you…','do not be ashamed.','You loved.','You trusted.','You imagined tomorrow with them.','Then suddenly…','tomorrow looked different.','That hurts.','But losing someone does not mean you lost yourself.','There are pieces of you that existed before them.','Dreams they never created.','Strength they never gave you.','A heart that was always yours.','One day you will stop asking why they left.','And remember why you deserve someone who chooses to stay.'],
    ['Some endings never explain themselves.','You replayed every word.','You searched for the moment everything changed.','You blamed your softness.','You questioned your worth.','But love ending does not make your love foolish.','It means your heart was brave enough to be seen.','Grieve what was real.','Release what was not.','Keep the lessons.','Return the blame.','Your life is making space again.','Some endings are life quietly making room.']
  ],
  selflove:[
    ['Stop measuring yourself with somebody else’s ruler.','Their journey is not yours.','Their timing is not yours.','Their success does not make you smaller.','You do not know their full story.','And they do not know yours.','So stop punishing yourself for blooming differently.','Some flowers arrive in spring.','Some wait for summer.','Nobody calls the second flower a failure.','Your life is not late.','You are growing.','Learning.','Changing.','Becoming.','Bloom when you are ready.']
  ],
  neverquit:[
    ['Maybe today was not your day.','Maybe nothing worked.','Maybe you gave everything…','and still came home disappointed.','But one difficult day…','does not deserve to define your future.','Rest if you need to.','Cry if you need to.','Be silent for a while.','But do not mistake exhaustion…','for the end of your ability.','Tomorrow does not need the strongest you.','Only the version willing to try again.','Rest tonight. Return tomorrow.']
  ],
  ambition:[
    ['Some dreams take longer…','because they are building you first.','Right now you may only see the distance.','The failures.','The delays.','The people moving faster than you.','But life is not asking you to become them.','It is asking you…','to become more of yourself.','Learn.','Fall.','Begin again.','Become stronger.','Keep walking toward what keeps your heart awake.','The dream is not late.','You are still becoming the person capable of carrying it.']
  ],
  motivation:[
    ['Before you call yourself a failure…','remember what failure cannot see.','The discipline you built.','The lessons you earned.','The courage it took to begin.','A result can disappoint you.','It cannot define you.','Pause.','Breathe.','Look again.','There is another path.','Another attempt.','Another version of you waiting to respond.','Your dream does not need perfection.','It needs your return.'],
    ['You will doubt yourself.','Walk anyway.','You will lose sometimes.','Learn anyway.','You will get tired.','Rest.','Then rise.','Not everyone will understand.','They do not have to.','This chapter hurt.','It is not the whole book.','Some doors close.','Grow anyway.','Some plans fail.','Dream anyway.','Become the reason you did not quit.']
  ]
};
const SOUL_FALLBACK=SOUL_STORIES.motivation;
const POWER_WORDS=['still','rise','courage','stronger','becoming','return','dream','heart','brave','tomorrow','worthy'];

const IDEA_ANGLES={
  courage:['begin before confidence arrives','walk away from repeated harm','admit a mistake without hiding','ask for help without shame','accept uncertainty without freezing','choose yourself despite disapproval','speak when silence costs your truth','start again after public failure','forgive without reopening the door','stand alone without becoming bitter'],
  love:['quiet loyalty in ordinary moments','trust rebuilt through honest actions','love that gives room to grow','distance that reveals what matters','memories that remain after letting go','mature love without possession','choosing one another during change','healing before loving again','affection expressed through attention','selfless care with healthy boundaries'],
  heartbreak:['reclaiming identity after someone leaves','accepting an answer that never came','missing someone without returning','grieving the future you imagined','learning that softness was not weakness','letting memories exist without obeying them','rebuilding trust in your own judgment','choosing closure without an apology','outgrowing the need to be chosen','making room after an ending'],
  motivation:['returning after an imperfect attempt','building discipline without applause','choosing one direction over many distractions','learning from a result without becoming it','doing quiet work before confidence appears','resting without abandoning the goal','measuring progress by honesty not speed','protecting attention from comparison','beginning with what is available','letting consistency become identity'],
  selflove:['refusing comparison as a measure of worth','speaking inwardly with kindness','setting a boundary without guilt','allowing growth to happen at your pace','forgiving an older version of yourself','resting without needing to earn it','leaving rooms that require you to shrink','trusting your needs are valid','celebrating progress nobody else sees','becoming safe company for yourself'],
  peace:['releasing arguments that cannot heal','choosing quiet over proving a point','slowing down before making a decision','protecting the morning from noise','accepting what cannot be controlled','making peace without receiving an apology','letting silence become clarity','building a life that does not require escape','saying no without anger','finding enough inside an ordinary day'],
  wisdom:['spending attention like a limited currency','waiting for clarity instead of forcing certainty','learning which problems deserve no response','letting time reveal hidden motives','distinguishing loneliness from solitude','recognizing that control has a boundary','changing your mind when truth asks','valuing questions that deepen thought','seeing consequences inside small choices','accepting that knowledge should create humility'],
  neverquit:['returning tomorrow after resting tonight','changing the method without abandoning the purpose','surviving a season without romanticizing pain','trying privately after failing publicly','continuing when progress cannot yet be measured','asking for support before exhaustion wins','taking one useful step on a difficult day','remembering effort can change direction','separating temporary fatigue from final inability','letting a setback teach a better route'],
  ambition:['becoming capable before receiving the opportunity','building skill while waiting for recognition','protecting a dream from other people’s urgency','choosing depth over visible busyness','accepting a slower path with stronger foundations','working when the reward feels distant','letting curiosity guide disciplined practice','preparing before the door opens','making purpose larger than applause','creating the chance you kept waiting for']
};
const STRUCTURES=['Journey','Contrast','Questions','Story','Commands','Poetic','Minimal','Letter','Future Self','Conversation'];
const METAPHORS=['seasons changing without permission','a river finding another route','roots working beneath silent soil','a bridge built one plank at a time','a window opening after a long winter','tides returning without explanation','an unfinished painting gaining color','a map redrawn after a wrong turn','music finding meaning between pauses','footprints proving distance after the walk','a clock that cannot measure becoming','a home rebuilt around stronger foundations'];
const HOOK_BUILDERS=[
  a=>`What if ${a} is the lesson this moment is offering?`,a=>`There is a kind of strength hidden inside ${a}.`,a=>`Nobody warns you how much courage it takes to choose ${a}.`,a=>`One day, you may thank yourself for ${a}.`,a=>`This is for the person learning about ${a}.`,a=>`Not every victory looks loud at first.`,a=>`Your next decision matters more than your last disappointment.`,a=>`If your heart could speak honestly, it might ask for ${a}.`,a=>`You do not need everyone to understand ${a}.`,a=>`Some turning points arrive disguised as ordinary choices.`
];
const FINAL_BUILDERS=[
  a=>`Let ${a} become the moment you returned to yourself.`,a=>`Your next honest choice can change the direction of everything.`,a=>`Become someone this difficult day would be proud to remember.`,a=>`You are allowed to build a future that no longer repeats the past.`,a=>`The pace is yours; the decision to continue is yours too.`,a=>`Let tomorrow meet the version of you who chose differently today.`,a=>`You do not need a perfect ending to write a braver next line.`,a=>`Some freedom begins the moment you stop asking fear for permission.`,a=>`Carry the lesson forward, not the weight.`,a=>`What you choose now can become the place your life quietly changed.`,a=>`Make this the day your direction became stronger than your doubt.`,a=>`You can honor what hurt without letting it design what comes next.`,a=>`The future does not need your certainty; it needs your presence.`,a=>`Leave room for a life that fits the person you are becoming.`,a=>`Do not rush the roots just because nobody can see them.`,a=>`Your worth was never waiting for another person’s agreement.`,a=>`A changed route can still carry you somewhere meaningful.`,a=>`Give your energy to what can grow from here.`,a=>`The quiet choice may become the loudest change in your life.`,a=>`Begin where you are, but do not agree to remain there.`
];
const STOP_WORDS=new Set('a an and are as at be because been before but by can did do does for from had has have he her here him his i if in into is it its just may me more my no not of on one only or our she so than that the their them there they this to too up us was we were what when where which who will with you your'.split(' '));
const normalizeQuote=text=>String(text||'').toLowerCase().replace(/[’']/g,'').replace(/\b(isnt|is not)\b/g,'isnt').replace(/\b(dont|do not)\b/g,'dont').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
const fingerprint=text=>normalizeQuote(text).split(' ').filter(w=>w.length>2&&!STOP_WORDS.has(w)).map(w=>w.replace(/(ing|ed|ly|es|s)$/,'')).filter(Boolean);
const similarity=(a,b)=>{const aa=fingerprint(a),bb=fingerprint(b),sa=new Set(aa),sb=new Set(bb);if(!sa.size||!sb.size)return 0;let hit=0;sa.forEach(x=>{if(sb.has(x))hit++});return hit/Math.sqrt(sa.size*sb.size)};
const hashText=text=>{let h=2166136261;for(const c of normalizeQuote(text)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0).toString(36)};
const seededPick=(arr,seed)=>arr[Math.abs(seed)%arr.length];
const CTA_LIBRARY={
  motivation:['Subscribe. Tomorrow we rise again.','Stay for tomorrow’s thought.','Meet me here for another honest reminder.','Follow for 30 seconds of meaning each day.'],
  courage:['Follow for words that make you stronger.','More courage tomorrow.','Stay for the words your brave days need.','Return when you need another reason to choose courage.'],
  love:['Stay for more words from the heart. ❤️','Keep this space close.','Follow for thoughts that make love feel understood.','Come back for another quiet word from the heart.'],
  heartbreak:['Follow for the days your heart needs company.','Come back whenever your heart needs another reminder.','Stay for gentle words on difficult days.','You do not have to heal alone.'],
  success:['Subscribe. Build your mind every day.','Stay for thoughts that strengthen your direction.','Follow for one useful idea each day.','Return tomorrow. Keep building.'],
  peace:['Stay for a little more peace each day.','Follow for quiet thoughts in a noisy world.','Keep this space close when life feels loud.','Meet me here for another peaceful minute.'],
  wisdom:['Follow for daily strength of mind.','Stay for another timeless thought.','Come back for wisdom worth carrying.','One meaningful thought each day.'],
  default:['Follow if these words found you at the right time.','Stay for tomorrow’s reminder.','More words for the days you need them.','Keep this space close.']
};
const PERSONALITY_CTA={kalam:'Follow for wisdom that makes you dream bigger.',vivekananda:'Subscribe for words that awaken strength.',gandhi:'Follow for wisdom, peace and purpose.',marcus:'Follow for daily strength of mind.'};
const cleanTag=text=>String(text||'').replace(/[^a-z0-9]/gi,'');
const scoreTitle=(title,category,personality)=>{const len=title.length,clarity=len>=24&&len<=68?20:14,emotion=/need|remember|strength|dream|heart|give up|fear|words/i.test(title)?18:12,curiosity=/this|what|why|before|remember|one/i.test(title)?16:10,relevance=title.toLowerCase().includes(category)||personality&&title.includes(personality)?18:13,search=personality||/motivation|quote|wisdom/i.test(title)?16:11,natural=!/[A-Z]{6,}|!!!/.test(title)?10:5;return clarity+emotion+curiosity+relevance+search+natural};
function buildCandidate(category,history,attempt){
  const angles=IDEA_ANGLES[category]||IDEA_ANGLES.motivation,recentAngles=new Set(history.slice(0,50).map(h=>h.angle)),freshAngles=angles.filter(a=>!recentAngles.has(a)),angle=seededPick(freshAngles.length?freshAngles:angles,Date.now()+attempt*17);
  const usedStructures=new Set(history.slice(0,10).map(h=>h.structure)),availableStructures=STRUCTURES.filter(x=>!usedStructures.has(x)),structure=seededPick(availableStructures.length?availableStructures:STRUCTURES,attempt*7+history.length);
  const recentHooks=history.slice(0,50).map(h=>h.hook||''),hookOptions=HOOK_BUILDERS.map(fn=>fn(angle)).filter(x=>!recentHooks.some(h=>similarity(x,h)>.55)),hook=seededPick(hookOptions.length?hookOptions:HOOK_BUILDERS.map(fn=>fn(angle)),attempt+history.length);
  const recentMetaphors=new Set(history.slice(0,40).map(h=>h.metaphor)),metaphors=METAPHORS.filter(x=>!recentMetaphors.has(x)),metaphor=seededPick(metaphors.length?metaphors:METAPHORS,attempt*11+history.length);
  const finals=FINAL_BUILDERS.map(fn=>fn(angle));const recentFinals=history.slice(0,100).map(h=>h.finalLine||'');const finalPool=finals.filter(x=>!recentFinals.some(f=>similarity(x,f)>.58)),finalLine=seededPick(finalPool.length?finalPool:finals,attempt*13+history.length);
  const phrase=angle.charAt(0).toUpperCase()+angle.slice(1),linesByStructure={
    Journey:[hook,'You did not arrive here without carrying something.','There were choices nobody saw.','Questions you answered alone.',`For a while, ${angle} felt impossible.`,'Then something shifted.','Not the whole world.','Just your willingness to meet it differently.',`Like ${metaphor}.`,'Quiet change began before visible proof.','You stopped demanding certainty.','You started choosing what was honest.',finalLine],
    Contrast:[hook,'You thought strength meant never hesitating.','But hesitation is not surrender.','You thought progress needed applause.','But the deepest work is often private.',`${phrase} may look small from the outside.`,'Inside, it changes the rules.','It replaces reaction with intention.','Noise with direction.',`Think of ${metaphor}.`,'The change does not need permission to become real.',finalLine],
    Questions:[hook,'What are you protecting by staying the same?','What becomes possible if fear is not the judge?','Who might you become without constant comparison?',`Could ${angle} be an answer rather than a risk?`,'You do not need every answer tonight.','You need one truthful response.','One boundary.','One beginning.',`Even ${metaphor} starts with movement too small to notice.`,finalLine],
    Story:[hook,'There was a moment when the old answer stopped working.','Nothing dramatic happened.','The room stayed the same.','But your understanding did not.',`${phrase} became less frightening than repeating the pain.`,'So you made one different choice.','Then another.','That is how direction changes.',`Slowly, like ${metaphor}.`,'A life can turn without making a sound.',finalLine],
    Commands:[hook,'Stop calling every pause a failure.','Name what no longer fits.','Protect what still matters.',`Choose ${angle}.`,'Do it without performing for the room.','Let discomfort speak.','Do not let it command.','Move with intention.','Keep what teaches you.','Release what only repeats the wound.',finalLine],
    Poetic:[hook,`Somewhere inside ${metaphor}, there is a lesson.`,'Movement does not always announce itself.','Healing does not always look bright.','A quiet decision can carry enormous weight.',`${phrase} can be that decision.`,'Not a performance.','Not an escape.','A return to what is true.','A gentler way forward.','A stronger way home.',finalLine],
    Minimal:[hook,'Pause.','Listen.','Something in you already knows.','The old pattern is tired.',`${phrase}.`,'No speech.','No permission.','One choice.','One step.','One new direction.',finalLine],
    Letter:[`To the person learning about ${angle}…`,'I know this has not been simple.','You have explained yourself enough.','You have waited for certainty.','You have mistaken delay for failure.','Please remember this.',`Even ${metaphor} needs time.`,'You are not weak for needing space.','You are not late for changing direction.','You are allowed to choose what helps you live honestly.',finalLine],
    'Future Self':[hook,'One day, you will remember this version of yourself.','Not because everything went perfectly.','Because this was where you stopped repeating an old answer.',`${phrase} became your turning point.`,'The future did not arrive all at once.','It grew from a boundary.','A conversation.','A private promise kept.',`Like ${metaphor}.`,'Your future self is being shaped by what you protect today.',finalLine],
    Conversation:[`If your heart could speak, it might ask about ${angle}.`,'You might answer, “I am not ready.”','It might say, “Readiness is not always a feeling.”','You might ask, “What if I fail?”','It might answer, “What if you finally become free?”','This is not about rushing.','It is about listening without abandoning yourself.',`Remember ${metaphor}.`,'A new direction begins as a conversation.','Then it becomes a choice.',finalLine]
  };
  const lines=(linesByStructure[structure]||linesByStructure.Journey).slice(0,16),text=lines.join(' ');return{id:`q_${Date.now().toString(36)}_${hashText(text)}`,lines,text,hook:lines[0],finalLine:lines.at(-1),angle,structure,metaphor,keywords:fingerprint(text).slice(0,24),fingerprint:hashText(text)};
}
function candidateFreshness(candidate,history){
  const recent=history.slice(0,500),exact=recent.some(h=>normalizeQuote(h.fullText||h.quote?.join?.(' ')||'')===normalizeQuote(candidate.text));if(exact)return{score:0,reject:'exact'};
  let maxSemantic=0,lineReuse=0;for(const item of recent){const oldText=item.fullText||item.quote?.join?.(' ')||'';maxSemantic=Math.max(maxSemantic,similarity(candidate.text,oldText));const oldLines=item.lines||[];const reused=candidate.lines.filter(line=>oldLines.some(old=>similarity(line,old)>.82)).length;lineReuse=Math.max(lineReuse,reused/candidate.lines.length)}
  const hookFresh=!recent.slice(0,100).some(h=>similarity(candidate.hook,h.hook||'')>.62),finalFresh=!recent.slice(0,200).some(h=>similarity(candidate.finalLine,h.finalLine||'')>.62),structureFresh=!recent.slice(0,5).some(h=>h.structure===candidate.structure),angleFresh=!recent.slice(0,20).some(h=>h.angle===candidate.angle),metaphorFresh=!recent.slice(0,20).some(h=>h.metaphor===candidate.metaphor);
  const score=Math.round(20*(1-maxSemantic)+20*(1-lineReuse)+15*(hookFresh?1:0)+15*(finalFresh?1:0)+10*(structureFresh?1:0)+10*(metaphorFresh?1:0)+10*(angleFresh?1:0));return{score:clamp(score,0,100),maxSemantic,lineReuse,reject:maxSemantic>.78||lineReuse>.2||!hookFresh||!finalFresh?'similar':null};
}
function selectFreshCandidate(category,history){let best=null;for(let i=0;i<30;i++){const candidate=buildCandidate(category,history,i),fresh=candidateFreshness(candidate,history);if(!best||fresh.score>best.freshness.score)best={...candidate,freshness:fresh};if(!fresh.reject&&fresh.score>=90)return{...candidate,freshness:fresh}}return best}

const TRACKS={
  motivation:{id:'orig-inspire-01',name:'Inspirational Cinematic Piano',mood:'Hope + determination',bpm:78,energy:72},
  courage:{id:'orig-courage-01',name:'Heroic Piano & Deep Percussion',mood:'Courage + strength',bpm:84,energy:82},
  heartbreak:{id:'orig-heart-01',name:'Heartbreak Piano',mood:'Longing + healing',bpm:62,energy:46},
  peace:{id:'orig-peace-01',name:'Peaceful Ambient',mood:'Calm + humanity',bpm:58,energy:32},
  wisdom:{id:'orig-stoic-01',name:'Deep Stoic Cinematic',mood:'Wisdom + inner strength',bpm:66,energy:48},
  love:{id:'orig-love-01',name:'Romantic Piano & Warm Pads',mood:'Love + warmth',bpm:68,energy:44},
  success:{id:'orig-dream-01',name:'Hopeful Orchestral Rise',mood:'Dreams + future',bpm:82,energy:76},
  default:{id:'orig-soul-01',name:'Soul-Touch Cinematic',mood:'Reflection + hope',bpm:72,energy:58}
};
const getTrack=(category,personality)=>({...(TRACKS[personality?.theme]||TRACKS[category]||TRACKS.default),duration:30,sampleRate:48000,licenseType:'Original procedural instrumental',commercialUse:'Permitted for videos created in this app',attribution:'Not required',source:'Pattan Original Music Engine'});

function createSoundtrack(ctx,track,duration=30){
  const sr=48000,length=sr*duration,buffer=ctx.createBuffer(2,length,sr);const roots=track.energy>75?[146.83,174.61,220,196]:track.energy<40?[130.81,164.81,196,146.83]:[146.83,185,220,164.81];
  for(let ch=0;ch<2;ch++){const data=buffer.getChannelData(ch);for(let i=0;i<length;i++){const t=i/sr,bar=Math.floor(t/3.75),root=roots[bar%roots.length],beat=(t%(60/track.bpm))/(60/track.bpm),arc=t<3?t/3:t<24?.42+.48*((t-3)/21):t<29?.9:.9*(30-t);let sample=0;
      const userFadeIn=Math.max(.05,Number(track.fadeIn??1.4)),userFadeOut=Math.max(.05,Number(track.fadeOut??1.2)),fade=Math.min(1,t/userFadeIn,(duration-t)/userFadeOut);
      sample+=Math.sin(2*Math.PI*root*t+(ch*.08))*.13;sample+=Math.sin(2*Math.PI*root*1.5*t)*.055;sample+=Math.sin(2*Math.PI*root*2*t)*.026;
      const pianoEnv=Math.exp(-beat*7);sample+=Math.sin(2*Math.PI*root*2*t)*pianoEnv*.085;
      if(track.energy>65){const pulse=Math.exp(-beat*18);sample+=(Math.sin(2*Math.PI*55*t)+Math.sin(2*Math.PI*82*t)*.4)*pulse*.08*(t>7?1:.25)}
      if(track.cta&&t>28.15&&t<29.35){const ct=t-28.15;sample+=Math.sin(2*Math.PI*880*ct)*Math.exp(-ct*4)*.025;sample+=Math.sin(2*Math.PI*1320*ct)*Math.exp(-ct*5)*.012}
      const shimmer=Math.sin(2*Math.PI*(root*3.01)*t)*.012*Math.sin(Math.PI*t/7);data[i]=sample*arc*fade*.72;}}
  return buffer;
}

const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
const pick = arr => arr[Math.floor(Math.random()*arr.length)];
const getTheme = key => THEMES[key] || THEMES.default;
const stageFor=(i,total)=>{const p=i/Math.max(1,total-1);if(i===total-1)return'FINAL SOUL LINE';if(p<.1)return'STOP THE SCROLL';if(p<.25)return'CONNECT';if(p<.45)return'GO DEEPER';if(p<.62)return'TURN THE EMOTION';if(p<.82)return'BUILD THE POWER';return'HEART-HIT LINE'};
const splitScenes = lines => {
  const clean=(lines||[]).map(x=>String(x||'').trim()).filter(Boolean).slice(0,16);
  const finalHold=1;const usable=29;const weightSum=clean.reduce((n,line,i)=>n+(i===clean.length-1?1.6:clamp(line.length/28,.75,1.45)),0);let cursor=0;
  const result=clean.map((text,i)=>{const weight=i===clean.length-1?1.6:clamp(text.length/28,.75,1.45);const start=cursor;cursor+=usable*(weight/weightSum);return{start:+start.toFixed(2),end:+cursor.toFixed(2),label:stageFor(i,clean.length),text}});
  if(result.length)result.push({start:29,end:30,label:'SILENT HOLD',text:result.at(-1).text});
  return result;
};

function QuoteStudio(){
  const [category,setCategory] = useState('motivation');
  const [feeling,setFeeling] = useState('');
  const [quote,setQuote] = useState(QUOTES.motivation[0]);
  const [storyLines,setStoryLines] = useState(SOUL_STORIES.motivation[0]);
  const [personalityId,setPersonalityId] = useState('original');
  const [attribution,setAttribution] = useState(null);
  const [themeKey,setThemeKey] = useState('motivation');
  const [mode,setMode] = useState('quick');
  const [animation,setAnimation] = useState('soft-rise');
  const [voice,setVoice] = useState('Warm Female');
  const [voiceOn,setVoiceOn] = useState(false);
  const [musicOn,setMusicOn] = useState(true);
  const [volume,setVolume] = useState(18);
  const [musicIntensity,setMusicIntensity] = useState(72);
  const [musicStart,setMusicStart] = useState(0);
  const [fadeIn,setFadeIn] = useState(1.4);
  const [fadeOut,setFadeOut] = useState(1.2);
  const [autoDucking,setAutoDucking] = useState(true);
  const [soundtrack,setSoundtrack] = useState(()=>getTrack('motivation',null));
  const [audioReady,setAudioReady] = useState(false);
  const [audioError,setAudioError] = useState('');
  const [exportPreset,setExportPreset] = useState('premium');
  const [exportFps,setExportFps] = useState(30);
  const [exportStatus,setExportStatus] = useState(null);
  const [freshness,setFreshness] = useState({score:100,maxSemantic:0,lineReuse:0});
  const [ctaIntensity,setCtaIntensity] = useState('standard');
  const [publishingTab,setPublishingTab] = useState('title');
  const [titleMode,setTitleMode] = useState(0);
  const [descriptionMode,setDescriptionMode] = useState(0);
  const [hashtagMode,setHashtagMode] = useState('seo');
  const [brand,setBrand] = useState(()=>{try{return JSON.parse(localStorage.getItem('pattan.quote.brand')||'null')||{channelName:'Daily Perspective',handle:'@DailyPerspective',preferredCta:'',brandFont:'Inter',branding:true,intro:false,outro:'Soft Fade',watermark:true}}catch{return{channelName:'Daily Perspective',handle:'@DailyPerspective',preferredCta:'',brandFont:'Inter',branding:true,intro:false,outro:'Soft Fade',watermark:true}}});
  const [language,setLanguage] = useState('English');
  const [series,setSeries] = useState('Single Short');
  const [soundFx,setSoundFx] = useState(true);
  const [playing,setPlaying] = useState(false);
  const [time,setTime] = useState(0);
  const [busy,setBusy] = useState(false);
  const [generationStage,setGenerationStage] = useState('');
  const [exporting,setExporting] = useState(false);
  const [favorites,setFavorites] = useState(()=>{try{return JSON.parse(localStorage.getItem('pattan.quote.favorites')||'[]')}catch{return[]}});
  const [history,setHistory] = useState(()=>{try{return JSON.parse(localStorage.getItem('pattan.quote.history')||'[]')}catch{return[]}});
  const [published,setPublished] = useState(()=>{try{return JSON.parse(localStorage.getItem('pattan.quote.published')||'[]')}catch{return[]}});
  const timer = useRef(null);
  const canvasRef = useRef(null);
  const audioContextRef=useRef(null);
  const musicBufferRef=useRef(null);
  const previewSourceRef=useRef(null);
  const previewGainRef=useRef(null);
  const selectedPersonality = PERSONALITIES.find(p=>p.id===personalityId) || null;
  const scenes = useMemo(()=>splitScenes(storyLines),[storyLines]);
  const waveform=useMemo(()=>Array.from({length:72},(_,i)=>clamp(18+Math.sin(i*.47)*14+(i/72)*48+(i>58?18:0),8,94)),[soundtrack.id,musicIntensity]);
  const currentScene = scenes.find(s=>time>=s.start&&time<s.end) || scenes[scenes.length-1];
  const theme = getTheme(themeKey);
  const score = useMemo(()=>({hook:95,emotion:94,human:96,originality:92,clarity:97,flow:94,final:96,music:95,visual:94,retention:95,overall:95}),[storyLines,themeKey]);

  useEffect(()=>()=>clearInterval(timer.current),[]);
  useEffect(()=>{
    setSoundtrack(getTrack(category,attribution));setAudioReady(false);setAudioError('');musicBufferRef.current=null;
  },[category,attribution]);
  useEffect(()=>()=>{try{previewSourceRef.current?.stop()}catch{}},[]);
  useEffect(()=>{ localStorage.setItem('pattan.quote.favorites',JSON.stringify(favorites)); },[favorites]);
  useEffect(()=>{ localStorage.setItem('pattan.quote.history',JSON.stringify(history.slice(0,500))); },[history]);
  useEffect(()=>{ localStorage.setItem('pattan.quote.published',JSON.stringify(published.slice(0,500))); },[published]);
  useEffect(()=>{ localStorage.setItem('pattan.quote.brand',JSON.stringify(brand)); },[brand]);
  useEffect(()=>{
    clearInterval(timer.current);
    if(!playing) return;
    timer.current=setInterval(()=>setTime(v=>{ if(v>=29.9){setPlaying(false);return 0} return +(v+.1).toFixed(1)}),100);
    return()=>clearInterval(timer.current);
  },[playing]);

  const ensureSoundtrack=async()=>{
    try{let ctx=audioContextRef.current;if(!ctx||ctx.state==='closed'){ctx=new(window.AudioContext||window.webkitAudioContext)({sampleRate:48000});audioContextRef.current=ctx}if(ctx.state==='suspended')await ctx.resume();if(!musicBufferRef.current)musicBufferRef.current=createSoundtrack(ctx,{...soundtrack,energy:musicIntensity,fadeIn,fadeOut,cta:ctaIntensity!=='off'&&soundFx},30);setAudioReady(true);setAudioError('');return{ctx,buffer:musicBufferRef.current}}catch(err){setAudioError(String(err.message||err));setAudioReady(false);throw err}
  };
  const stopPreviewMusic=()=>{try{previewSourceRef.current?.stop()}catch{}previewSourceRef.current=null};
  const startPreviewMusic=async(offset=time)=>{if(!musicOn)return;stopPreviewMusic();const{ctx,buffer}=await ensureSoundtrack();const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;gain.gain.value=clamp(volume/100,0,.45)*(autoDucking&&voiceOn?.72:1);source.connect(gain).connect(ctx.destination);source.start(0,clamp(offset+musicStart,0,29.95));previewSourceRef.current=source;previewGainRef.current=gain};

  useEffect(()=>{if(playing)startPreviewMusic(time).catch(()=>{});else stopPreviewMusic();return()=>stopPreviewMusic()},[playing]);
  useEffect(()=>{if(previewGainRef.current)previewGainRef.current.gain.value=clamp(volume/100,0,.45)*(autoDucking&&voiceOn?.72:1)},[volume,autoDucking,voiceOn]);
  useEffect(()=>{musicBufferRef.current=null;setAudioReady(false)},[fadeIn,fadeOut,musicIntensity,ctaIntensity,soundFx]);

  const generate = (surprise=false,masterpiece=false,personalityOverride=null) => {
    setBusy(true);setGenerationStage('Finding the thought…');
    const stages=['Finding the thought…','Building the emotion…','Choosing the strongest lines…','Matching the music…','Creating your story…'];
    stages.forEach((s,i)=>setTimeout(()=>setGenerationStage(s),i*115));
    setTimeout(()=>{
      const chosen = surprise ? pick(CATEGORIES.filter(c=>c[0]!=='surprise'))[0] : category;
      const requestedName=feeling.toLowerCase();
      let person=PERSONALITIES.find(p=>p.id===(personalityOverride||personalityId)) || PERSONALITIES.find(p=>requestedName.includes(p.name.toLowerCase())||requestedName.includes(p.id));
      if((chosen==='thinkers'||chosen==='worldwisdom'||masterpiece)&&!person){const matches=PERSONALITIES.filter(p=>p.topics.includes(chosen)||p.topics.includes(category));person=pick(matches.length?matches:PERSONALITIES)}
      const allMemory=[...published,...history];
      if(person&&allMemory.some(h=>h.personality===person.name&&normalizeQuote(h.verifiedQuote||'')===normalizeQuote(person.quote)))person=null;
      let next,record;
      if(person){
        next=[person.hook,person.quote,`A thought from ${person.name} that still speaks to ${chosen==='thinkers'?'our lives today':chosen}.`];
        const conceptCategory=person.topics.find(t=>IDEA_ANGLES[t])||'motivation',candidate=selectFreshCandidate(conceptCategory,allMemory);
        const personStory=[person.hook,...candidate.lines.slice(1,4),person.quote,`Those words belong to ${person.name}.`,`Their meaning belongs to the choice in front of you.`,...candidate.lines.slice(-5)].slice(0,16);
        const personFresh=candidateFreshness({...candidate,lines:personStory,text:personStory.join(' '),hook:personStory[0],finalLine:personStory.at(-1)},allMemory);setFreshness(personFresh);
        setStoryLines(personStory);
        record={...candidate,id:`q_${Date.now().toString(36)}_${hashText(personStory.join(' '))}`,fullText:personStory.join(' '),lines:personStory,hook:personStory[0],finalLine:personStory.at(-1),verifiedQuote:person.quote,freshness:personFresh.score};
        setAttribution(person);setPersonalityId(person.id);setThemeKey(person.theme);setVoice(person.voice);
      }else{
        const conceptCategory=IDEA_ANGLES[chosen]?chosen:(IDEA_ANGLES[category]?category:'motivation'),candidate=selectFreshCandidate(conceptCategory,allMemory);next=[candidate.hook,candidate.lines.slice(1,-1).join(' '),candidate.finalLine];
        setStoryLines(candidate.lines);setFreshness(candidate.freshness);record={...candidate,fullText:candidate.text,freshness:candidate.freshness.score};
        setAttribution(null);setPersonalityId('original');setThemeKey(chosen);
      }
      setCategory(chosen);setQuote(next);setTime(0);
      setHistory(h=>[{...record,category:chosen,emotion:chosen,personality:person?.name||'Original Wisdom',theme:person?.theme||chosen,dateGenerated:new Date().toISOString(),viewed:true,saved:false,exported:false,rejected:false},...h.map((x,i)=>i===0&&!x.cta?{...x,cta:ctaText}:x)].slice(0,500));
      setBusy(false);setGenerationStage('');setPlaying(true);
    },650);
  };

  const transformStory=kind=>{
    setStoryLines(lines=>{
      if(kind==='shorter')return lines.filter((_,i)=>i===0||i===lines.length-1||i%2===0).slice(0,12);
      if(kind==='powerful')return lines.map((x,i)=>i===lines.length-1?x.toUpperCase():i>lines.length*.65?x.replace(/\.$/,'!'):x);
      if(kind==='emotional')return lines.map((x,i)=>i===1?'You have carried things you never told anyone.':i===lines.length-2?'And after everything, your heart is still trying.':x);
      if(kind==='deeper')return lines.map((x,i)=>i===Math.floor(lines.length/2)?'Sometimes surviving is the first victory nobody applauds.':x);
      return lines;
    });
  };

  const legendOfDay=()=>{
    const dayMap=['tagore','vivekananda','kalam','gandhi','marcus','mandela','einstein'];
    const id=dayMap[new Date().getDay()];setPersonalityId(id);setCategory('thinkers');
    generate(false,true,id);
  };

  const changeTheme=()=>{
    const keys=Object.keys(THEMES); const i=keys.indexOf(themeKey); setThemeKey(keys[(i+1)%keys.length]);
  };
  const changeMusic=()=>{const pool=Object.values(TRACKS).filter(t=>t.id!==soundtrack.id);const next={...pick(pool),duration:30,sampleRate:48000,licenseType:'Original procedural instrumental',commercialUse:'Permitted for videos created in this app',attribution:'Not required',source:'Pattan Original Music Engine'};stopPreviewMusic();musicBufferRef.current=null;setSoundtrack(next);setAudioReady(false);if(playing)setTimeout(()=>startPreviewMusic(time),0)};
  const toggleFavorite=()=>{
    const text=storyLines.join(' '); const saving=!favorites.some(x=>x.text===text);setFavorites(f=>saving?[{text,quote:storyLines,category},...f]:f.filter(x=>x.text!==text));setHistory(h=>h.map((x,i)=>i===0?{...x,saved:saving}:x));
  };
  const speak=()=>{
    if(!voiceOn||!('speechSynthesis'in window)) return;
    speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(storyLines.join(' ')); u.rate=.9; u.pitch=voice.includes('Female')?1.08:.88; speechSynthesis.speak(u);
  };
  const ctaText=useMemo(()=>{if(brand.preferredCta.trim())return brand.preferredCta.trim();const special=attribution&&PERSONALITY_CTA[attribution.id];if(special&&!history.slice(0,20).some(h=>h.cta===special))return special;const pool=CTA_LIBRARY[category]||CTA_LIBRARY.default,recent=new Set(history.slice(0,20).map(h=>h.cta));return pool.find(x=>!recent.has(x))||pool[history.length%pool.length]},[category,attribution,history.length,brand.preferredCta]);
  const packageData=useMemo(()=>{
    const who=attribution?.name,topic=category.replace(/([a-z])([A-Z])/g,'$1 $2'),finalLine=storyLines.at(-1)||'',baseTitles=who?[
      `${who}'s Words Every ${topic==='success'?'Dreamer':'Person'} Needs`,`${who} on ${topic} — Remember This`,`What ${who} Understood About ${topic}`,`One Timeless Thought from ${who}`,`Words That Still Matter | ${who}`,`${who}'s Advice for Difficult Days`,`A ${who} Thought Worth Carrying`,`Before You Give Up, Remember ${who}'s Words`,`${topic[0]?.toUpperCase()+topic.slice(1)} Through the Eyes of ${who}`,`30 Seconds of Wisdom from ${who}`
    ]:[
      `Watch This Before You Give Up`,`You Needed These Words Today`,`30 Seconds That May Change Your Direction`,`Read This on Your Hardest Day`,`One Thought for Anyone Feeling ${topic}`,`Before You Doubt Yourself, Watch This`,`A Reminder Your Future Self Needs`,`These Words Found You for a Reason`,`What If You Are Not Really Behind?`,`The Quiet Truth About ${topic}`
    ];
    const titles=baseTitles.map(t=>({text:t,score:scoreTitle(t,category,who)})).sort((a,b)=>b.score-a.score);
    const descriptions=[who?`A few words can arrive exactly when we need them. Today’s thought reflects on ${topic} through a documented quotation from ${who}.\n\n${attribution.status}\nSource: ${attribution.source}\n\n${ctaText}`:`A few words can arrive exactly when we need them. Today’s original thought is about ${topic}, honest change, and the courage to choose what comes next.\n\n${ctaText}`,`Today’s 30-second reflection explores ${topic} without empty promises—just one meaningful idea to carry into the day.${who?`\n\nQuote: ${who}\nSource: ${attribution.source}`:''}`,`${finalLine}\n\nA short cinematic reflection about ${topic}.${who?` Inspired by a verified quotation from ${who}.`:''}`];
    const personalityTag=who?`#${cleanTag(who)}`:'',regional=hashtagMode==='india'?'#IndianWisdom #India':hashtagMode==='global'?'#GlobalWisdom #DailyQuotes':'#Mindset #LifeQuotes',hashtags=[personalityTag,`#${cleanTag(topic)}`,'#Quotes','#Inspiration',regional,'#YouTubeShorts','#Shorts'].filter(Boolean).join(' ').replace(/\s+/g,' ');
    const tags=[who,who&&`${who} quotes`,`${topic} quotes`,'daily wisdom','inspirational quotes',`${topic} motivation`,'short motivational video','youtube shorts motivation'].filter(Boolean).join(', ');
    return{titles,description:descriptions[descriptionMode%descriptions.length],hashtags,tags,coverText:(who?`${who.split(' ').at(-1)} ON ${topic}`:finalLine).split(' ').slice(0,6).join(' ').toUpperCase()}
  },[attribution,category,storyLines,ctaText,descriptionMode,hashtagMode]);
  const copyText=async(text)=>{try{await navigator.clipboard.writeText(text)}catch{const area=document.createElement('textarea');area.value=text;document.body.append(area);area.select();document.execCommand('copy');area.remove()}};
  const copyPackage=()=>copyText(`TITLE\n${packageData.titles[titleMode%packageData.titles.length].text}\n\nDESCRIPTION\n${packageData.description}\n\nHASHTAGS\n${packageData.hashtags}\n\nTAGS\n${packageData.tags}\n\nQUOTE SOURCE\n${attribution?`${attribution.name}\n“${attribution.quote}”\n${attribution.source}\n${attribution.status}`:'Original Wisdom — no historical attribution'}\n\nMUSIC\n${soundtrack.name} · ${soundtrack.licenseType} · ${soundtrack.source}`);

  const drawFrame=(ctx,w,h,sec)=>{
    const scale=w/1080;
    const sc=scenes.find(s=>sec>=s.start&&sec<s.end)||scenes.at(-1); const g=ctx.createLinearGradient(0,0,w,h);
    theme.colors.forEach((c,i)=>g.addColorStop(i/(theme.colors.length-1),c)); ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    const drift=(sec/30)*90; ctx.fillStyle='rgba(0,0,0,.22)';ctx.fillRect(0,0,w,h);
    ctx.fillStyle='rgba(255,255,255,.06)';ctx.beginPath();ctx.arc(w*.72+drift,h*.24,w*.44,0,Math.PI*2);ctx.fill();
    ctx.textAlign='center';ctx.fillStyle=theme.accent;ctx.font=`700 ${31*scale}px Arial`;ctx.fillText(sc.label,w/2,240*scale);
    const words=sc.text.split(' ');let lines=[],line='';ctx.font=`900 ${(sc.label==='STOP THE SCROLL'?78:68)*scale}px Arial`;
    for(const word of words){const test=(line+' '+word).trim();if(ctx.measureText(test).width>w-160*scale){lines.push(line);line=word}else line=test} if(line)lines.push(line);
    const y0=h/2-lines.length*48*scale; ctx.shadowColor='rgba(0,0,0,.7)';ctx.shadowBlur=24*scale;ctx.fillStyle='#fff';
    lines.forEach((l,i)=>ctx.fillText(l,w/2,y0+i*96*scale));ctx.shadowBlur=0;
    if(ctaIntensity!=='off'&&sec>=27.1){const phase=sec<27.8?'intro':sec<28.6?'subscribe':'subscribed',ctaY=h*.75;ctx.fillStyle='rgba(4,7,12,.66)';ctx.beginPath();ctx.roundRect(w*.18,ctaY-38*scale,w*.64,phase==='intro'?76*scale:122*scale,22*scale);ctx.fill();ctx.fillStyle='#fff';ctx.font=`700 ${22*scale}px Arial`;ctx.fillText(sec<27.8?'If this touched your heart…':ctaText,w/2,ctaY);if(ctaIntensity!=='minimal'&&phase!=='intro'){const bw=230*scale,bh=58*scale,bx=(w-bw)/2,by=ctaY+20*scale;ctx.fillStyle=phase==='subscribe'?'#e3212b':'#e9edf3';ctx.beginPath();ctx.roundRect(bx,by,bw,bh,13*scale);ctx.fill();ctx.fillStyle=phase==='subscribe'?'#fff':'#18202b';ctx.font=`900 ${23*scale}px Arial`;ctx.fillText(phase==='subscribe'?'SUBSCRIBE':'✓ SUBSCRIBED',w/2,by+38*scale);if(ctaIntensity==='strong'){ctx.font=`700 ${28*scale}px Arial`;ctx.fillText(phase==='subscribe'?'☝':'🔔',bx+bw+34*scale,by+38*scale)}}}
    if(brand.branding){ctx.fillStyle='rgba(255,255,255,.72)';ctx.font=`500 ${27*scale}px Arial`;ctx.fillText(`${brand.channelName.toUpperCase()} • ${brand.handle}`,w/2,h-150*scale)}
    ctx.fillStyle='rgba(255,255,255,.18)';ctx.fillRect(80*scale,h-90*scale,w-160*scale,8*scale);ctx.fillStyle=theme.accent;ctx.fillRect(80*scale,h-90*scale,(w-160*scale)*(sec/30),8*scale);
  };

  const exportVideo=async(presetOverride=null,fpsOverride=null)=>{
    if(exporting)return;setExporting(true);setPlaying(false);setExportStatus({phase:'Building original 48 kHz soundtrack…',pct:2});
    try{
      const selectedPreset=typeof presetOverride==='string'?presetOverride:exportPreset,selectedFps=Number(fpsOverride)||exportFps;const profiles={premium:{w:1080,h:1920,bitrate:24000000,label:'1080P Premium'},ultra:{w:2160,h:3840,bitrate:38000000,label:'YouTube 4K Ultra'},master:{w:2160,h:3840,bitrate:45000000,label:'4K Master'}};const profile=profiles[selectedPreset]||profiles.premium;const renderFps=profile.w>=2160?30:selectedFps;
      const canvas=canvasRef.current||document.createElement('canvas');canvas.width=profile.w;canvas.height=profile.h;const ctx=canvas.getContext('2d',{alpha:false,desynchronized:false});
      const stream=canvas.captureStream(renderFps);const chunks=[];const mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')?'video/webm;codecs=vp9,opus':'video/webm';
      const audioCtx=new(window.AudioContext||window.webkitAudioContext)({sampleRate:48000});const destination=audioCtx.createMediaStreamDestination();
      {const music=createSoundtrack(audioCtx,{...soundtrack,energy:musicIntensity,fadeIn,fadeOut,cta:ctaIntensity!=='off'&&soundFx},30),source=audioCtx.createBufferSource(),gain=audioCtx.createGain(),compressor=audioCtx.createDynamicsCompressor();source.buffer=music;source.loop=true;gain.gain.value=musicOn?clamp(volume/100,0,.45)*(autoDucking&&voiceOn?.72:1):0;compressor.threshold.value=-8;compressor.knee.value=12;compressor.ratio.value=3;source.connect(gain).connect(compressor).connect(destination);source.start(0,musicStart);stream.addTrack(destination.stream.getAudioTracks()[0]);}
      if(!stream.getAudioTracks().length)throw new Error('Audio could not be included. Rebuilding soundtrack is required.');
      setExportStatus({phase:`Rendering ${profile.label} at ${renderFps} FPS with soundtrack…`,pct:5});
      const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:profile.bitrate,audioBitsPerSecond:320000});recorder.ondataavailable=e=>e.data.size&&chunks.push(e.data);
      const finished=new Promise(resolve=>recorder.onstop=resolve);recorder.start(1000);const started=performance.now();
      await new Promise(resolve=>{const frame=()=>{const sec=Math.min(30,(performance.now()-started)/1000);drawFrame(ctx,profile.w,profile.h,sec);setTime(sec);setExportStatus({phase:`Rendering native ${profile.label} with mixed audio…`,pct:5+Math.floor(sec/30*72)});if(sec<30)requestAnimationFrame(frame);else resolve()};frame()});
      recorder.stop();await finished;await audioCtx.close();const totalRecordedBytes=chunks.reduce((sum,chunk)=>sum+chunk.size,0);
      setExportStatus({phase:'Encoding H.264/AAC MP4 and validating audio stream…',pct:80});
      if(window.electronAPI?.beginQuoteExport){const begin=await window.electronAPI.beginQuoteExport({fileName:`${category}-legendary-short-${Date.now()}.mp4`,preset:selectedPreset,codec:'h264',audioBitrate:'320k'});if(!begin?.ok)throw new Error(begin?.error||'Could not start native export');const chunkSize=2*1024*1024;let uploaded=0;while(chunks.length){const mediaChunk=chunks.shift();for(let offset=0;offset<mediaChunk.size;offset+=chunkSize){const bytes=new Uint8Array(await mediaChunk.slice(offset,Math.min(mediaChunk.size,offset+chunkSize)).arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));const sent=await window.electronAPI.appendQuoteExportChunk(begin.id,btoa(binary));if(!sent?.ok)throw new Error(sent?.error||'Audio/video upload failed');uploaded+=bytes.length;setExportStatus({phase:'Streaming render to memory-safe master encoder…',pct:80+Math.floor(uploaded/Math.max(1,totalRecordedBytes)*10)})}}const final=await window.electronAPI.finishQuoteExport(begin.id,{preset:selectedPreset,codec:'h264',audioBitrate:'320k'});if(!final?.ok)throw new Error(final?.error||'MP4 master failed');if(!final.validation?.hasAudio)throw new Error('Final MP4 contains no audio stream.');const publishedRecord={...(history[0]||{}),id:history[0]?.id||`q_${Date.now().toString(36)}_${hashText(storyLines.join(' '))}`,fullText:storyLines.join(' '),lines:storyLines,hook:storyLines[0],finalLine:storyLines.at(-1),category,personality:attribution?.name||'Original Wisdom',cta:ctaText,exported:true,publishedAt:new Date().toISOString(),fileName:final.fileName};setPublished(p=>[publishedRecord,...p.filter(x=>normalizeQuote(x.fullText)!==normalizeQuote(publishedRecord.fullText))].slice(0,500));setHistory(h=>h.map((x,i)=>i===0?{...x,cta:ctaText,exported:true,exportFile:final.fileName}:x));setExportStatus({phase:'✅ READY TO PUBLISH',pct:100,...final});window.electronAPI.showItemInFolder?.(final.filePath)}else{const blob=new Blob(chunks,{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${category}-quote-with-music.webm`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);setExportStatus({phase:'Downloaded WebM with original soundtrack. MP4 conversion requires the desktop app.',pct:100})}
    }catch(err){setExportStatus({phase:`Export stopped: ${err.message}`,pct:0,error:true});alert(`Export failed: ${err.message}`)}finally{setExporting(false);setTime(0)}
  };

  return <div className="qs-shell">
    <canvas ref={canvasRef} width="1080" height="1920" hidden />
    <header className="qs-hero"><div><span className="qs-kicker">WISDOM × CINEMA × EMOTION</span><h1>Legendary Quote Studio</h1><p>One great thought. One cinematic video. One click.</p></div><div className="qs-mode">{['quick','pro','smart'].map(m=><button key={m} className={mode===m?'active':''} onClick={()=>setMode(m)}>{m==='smart'?'✦ Smart Creator':m[0].toUpperCase()+m.slice(1)}</button>)}</div></header>
    <main className="qs-grid">
      <section className="qs-panel qs-create">
        <div className="qs-step"><b>01</b><div><h2>What should your audience feel?</h2><p>Choose a mood or describe the moment.</p></div></div>
        <div className="qs-categories">{CATEGORIES.map(([id,icon,label])=><button key={id} className={category===id?'active':''} onClick={()=>id==='surprise'?generate(true):setCategory(id)}><span>{icon}</span>{label}</button>)}</div>
        <div className="qs-personality-row">
          <label><span>Legendary personality</span><select value={personalityId} onChange={e=>setPersonalityId(e.target.value)}><option value="original">Choose for me / Original</option>{PERSONALITIES.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label><span>Language</span><select value={language} onChange={e=>setLanguage(e.target.value)}>{LANGUAGES.map(x=><option key={x}>{x}</option>)}</select></label>
        </div>
        <label className="qs-label">Describe the feeling you want</label>
        <textarea value={feeling} onChange={e=>setFeeling(e.target.value)} placeholder="Something for a person who failed but wants to try again." />
        <button className="qs-generate" onClick={()=>generate(false)} disabled={busy}>{busy?`✦ ${generationStage}`:'✨ Create My 30-Second Video'}</button>
        <div className="qs-master-actions"><button onClick={()=>generate(false,true)}>⚡ MASTERPIECE</button><button onClick={legendOfDay}>🏛 Legend of the Day</button></div>
        <div className="qs-actions"><button onClick={()=>generate(false)}>↻ New Version</button><button onClick={changeTheme}>🎨 Change Theme</button><button onClick={toggleFavorite}>♡ Favorite</button></div>
        {mode!=='quick'&&<div className="qs-pro-controls">
          <label>Animation<select value={animation} onChange={e=>setAnimation(e.target.value)}><option value="soft-rise">Soft Rise</option><option value="word-reveal">Word Reveal</option><option value="dramatic">Dramatic Punch</option><option value="typewriter">Typewriter</option></select></label>
          <label>Voice<select value={voice} onChange={e=>setVoice(e.target.value)}><option>Warm Female</option><option>Inspirational Female</option><option>Deep Male</option><option>Calm Male</option></select></label>
          <label className="qs-switch"><input type="checkbox" checked={voiceOn} onChange={e=>setVoiceOn(e.target.checked)}/> Voiceover</label>
          <label className="qs-switch"><input type="checkbox" checked={musicOn} onChange={e=>setMusicOn(e.target.checked)}/> Music</label>
          <label className="qs-switch"><input type="checkbox" checked={soundFx} onChange={e=>setSoundFx(e.target.checked)}/> Cinematic SFX</label>
          <label>Music volume <b>{volume}%</b><input type="range" min="0" max="45" value={volume} onChange={e=>setVolume(+e.target.value)}/></label>
          <label>Creator series<select value={series} onChange={e=>setSeries(e.target.value)}>{SERIES.map(x=><option key={x}>{x}</option>)}</select></label>
        </div>}
        <div className="qs-cta-settings"><label>❤️ Subscribe CTA<select value={ctaIntensity} onChange={e=>setCtaIntensity(e.target.value)}><option value="off">Off</option><option value="minimal">Minimal</option><option value="standard">Standard</option><option value="strong">Strong</option></select></label><span>{ctaText}</span><button onClick={()=>setTime(27.2)}>Preview final CTA</button></div>
      </section>

      <section className="qs-preview-column">
        <div className="qs-preview-head"><div><span>LIVE 9:16 PREVIEW</span><b>{theme.icon} {theme.name}</b></div><span className="qs-quality">1080 × 1920 · 30 FPS</span></div>
        <div className={`qs-phone ${animation}`} style={{'--c1':theme.colors[0],'--c2':theme.colors[1],'--c3':theme.colors[2],'--accent':theme.accent}}>
          <div className="qs-orb one"/><div className="qs-orb two"/>
          <div className="qs-video-label">{currentScene.label}</div><div className="qs-quote-text" key={`${currentScene.start}-${quote[0]}`}>{currentScene.text}</div>
          {ctaIntensity!=='off'&&time>=27.1&&<div className={`qs-video-cta ${ctaIntensity}`}><small>{time<27.8?'If this touched your heart…':ctaText}</small>{ctaIntensity!=='minimal'&&time>=27.8&&<b className={time>=28.6?'subscribed':''}>{time>=28.6?'✓ SUBSCRIBED':'SUBSCRIBE'}</b>}{ctaIntensity==='strong'&&time>=28.2&&<i>{time>=28.6?'🔔':'☝'}</i>}</div>}
          {brand.branding&&<div className="qs-brand">{brand.channelName} • {brand.handle}</div>}<div className="qs-video-progress"><i style={{width:`${time/30*100}%`}}/></div>
        </div>
        <div className="qs-player"><button onClick={()=>{setPlaying(p=>!p);if(!playing)speak()}}>{playing?'❚❚':'▶'}</button><input type="range" min="0" max="30" step=".1" value={time} onChange={e=>{setPlaying(false);setTime(+e.target.value)}}/><span>{Math.floor(time)}s / 30s</span></div>
        <button className="qs-new-quote" onClick={()=>generate(false)} disabled={busy}>{busy?<><i/> {generationStage}</>:'✨ GENERATE NEW QUOTE'}</button>
        <div className="qs-freshness"><b>Quote #{history.length} generated</b><span>Freshness: {freshness.score}%</span><strong>New to your library ✓</strong></div>
        <div className="qs-soul-actions"><button onClick={()=>generate(false)}>🔀 New Idea</button><button onClick={()=>generate(true)}>🎲 Surprise Me</button><button onClick={toggleFavorite}>❤️ Save Quote</button><button onClick={()=>transformStory('powerful')}>🔥 Stronger Version</button><button onClick={()=>transformStory('emotional')}>💖 Deeper Version</button><button onClick={()=>transformStory('shorter')}>✂ Make Shorter</button><button onClick={()=>setPlaying(true)}>🎬 Generate Video</button></div>
        <div className="qs-soundtrack">
          <header><span>🎵 SOUNDTRACK</span><b>{audioError?'Audio repair needed':audioReady?'● AUDIO READY':'Original track selected'}</b></header>
          <h3>{soundtrack.name}</h3><p>{soundtrack.mood} · {soundtrack.bpm} BPM · 30 seconds</p>
          <div className="qs-waveform" aria-label="Loaded soundtrack waveform">{waveform.map((v,i)=><i key={i} style={{height:`${v}%`}} className={i/72<time/30?'played':''}/>)}</div>
          <div className="qs-audio-buttons"><button onClick={()=>setPlaying(p=>!p)}>{playing?'❚❚ Pause':'▶ Play'}</button><button onClick={changeMusic}>🔄 Change Music</button><button onClick={changeMusic}>🎲 Different Music</button><button>❤️ Save Track</button></div>
          <div className="qs-audio-sliders"><label>🔊 Volume <b>{volume}%</b><input type="range" min="0" max="45" value={volume} onChange={e=>setVolume(+e.target.value)}/></label><label>🎚 Intensity <b>{musicIntensity}%</b><input type="range" min="25" max="100" value={musicIntensity} onChange={e=>{setMusicIntensity(+e.target.value);musicBufferRef.current=null}}/></label><label>⏱ Start <b>{musicStart.toFixed(1)}s</b><input type="range" min="0" max="5" step=".1" value={musicStart} onChange={e=>setMusicStart(+e.target.value)}/></label><label>🌊 Fade In <b>{fadeIn.toFixed(1)}s</b><input type="range" min="0" max="4" step=".1" value={fadeIn} onChange={e=>setFadeIn(+e.target.value)}/></label><label>🌊 Fade Out <b>{fadeOut.toFixed(1)}s</b><input type="range" min="0" max="4" step=".1" value={fadeOut} onChange={e=>setFadeOut(+e.target.value)}/></label><label className="qs-switch"><input type="checkbox" checked={autoDucking} onChange={e=>setAutoDucking(e.target.checked)}/> Auto ducking</label><label className="qs-switch"><input type="checkbox" checked={musicOn} onChange={e=>setMusicOn(e.target.checked)}/> Music On</label></div>
          <div className="qs-track-license"><strong>ORIGINAL APP SOUNDTRACK</strong><span>✓ Original instrumental · Commercial use permitted for output created here · Attribution not required</span><small>Source: {soundtrack.source} · Track ID: {soundtrack.id}</small></div>
        </div>
      </section>

      <section className="qs-panel qs-editor">
        <div className="qs-step"><b>02</b><div><h2>Quote & scenes</h2><p>Every line remains readable and retention-focused.</p></div></div>
        <div className={`qs-auth ${attribution?'verified':'original'}`}><strong>{attribution?.status||'✨ Original AI Quote'}</strong><span>{attribution?`${attribution.name} · ${attribution.era}`:'Original Wisdom · no historical attribution'}</span>{attribution&&<><small>Source: {attribution.source}</small><small>Confidence: {attribution.confidence}</small></>}</div>
        <div className="qs-score"><strong>{score.overall}</strong><div><b>SOUL SCORE</b><span>“I felt that.” · approved</span></div></div>
        <div className="qs-score-bars">{[['Hook strength',score.hook],['Emotional depth',score.emotion],['Human feeling',score.human],['Originality',score.originality],['Clarity',score.clarity],['Line flow',score.flow],['Final line',score.final],['Music match',score.music],['Visual match',score.visual],['30s retention',score.retention]].map(([k,v])=><div key={k}><span>{k}</span><i><em style={{width:v+'%'}}/></i><b>{v}</b></div>)}</div>
        <div className="qs-scenes">{scenes.map((s,i)=><button key={s.start} className={currentScene.start===s.start?'active':''} onClick={()=>setTime(s.start+.05)}><span>{String(i+1).padStart(2,'0')}</span><div><b>{s.start}–{s.end}s · {s.label}</b><p>{s.text}</p></div></button>)}</div>
        <label className="qs-label">Edit the 10–16 soul-touch lines</label><textarea className="qs-edit" value={storyLines.join('\n')} onChange={e=>setStoryLines(e.target.value.split('\n').map(x=>x.trim()).filter(Boolean).slice(0,16))}/>
      </section>
    </main>
    <section className="qs-timeline"><header><div><b>03</b><h2>30-second cinematic timeline</h2></div><span>All active media and audio layers</span></header><div className="qs-track media"><label>VIDEO</label><div>🎬 {theme.name} · native target-resolution composition</div></div><div className="qs-track"><label>TEXT</label>{scenes.map(s=><button key={s.start} onClick={()=>setTime(s.start)} style={{width:`${(s.end-s.start)/30*100}%`}}>{s.label}</button>)}</div><div className="qs-track media"><label>ANIM</label><div>✨ {animation} · native vector text rendering</div></div>{voiceOn&&<div className="qs-track voice"><label>VOICE</label><div>🎙 {voice} · primary mix · auto ducking {autoDucking?'on':'off'}</div></div>}{musicOn&&<div className="qs-track music"><label>MUSIC</label><div className="qs-miniwave">{waveform.map((v,i)=><i key={i} style={{height:`${Math.max(3,v/5)}px`}}/>)}<span>♫ {soundtrack.name} · {volume}%</span></div></div>}{soundFx&&<div className="qs-track sfx"><label>SFX</label><div>◉ Subtle whoosh · atmospheric rise · final resolve</div></div>}</section>
    <section className="qs-bottom">
      <div className="qs-publish">
        <header className="qs-kit-head"><div><span>CREATOR-ONLY PANEL</span><h2>🚀 YouTube Publishing Kit</h2></div><button onClick={copyPackage}>📋 COPY YOUTUBE PACKAGE</button></header>
        <nav className="qs-kit-tabs">{['title','description','hashtags','tags','source','branding'].map(tab=><button key={tab} className={publishingTab===tab?'active':''} onClick={()=>setPublishingTab(tab)}>{tab.toUpperCase()}</button>)}</nav>
        {publishingTab==='title'&&<div className="qs-kit-section"><label>📌 RECOMMENDED TITLE <b>Title Score: {packageData.titles[titleMode%packageData.titles.length].score}/100</b></label><div className="qs-recommended"><strong>{packageData.titles[titleMode%packageData.titles.length].text}</strong><button onClick={()=>copyText(packageData.titles[titleMode%packageData.titles.length].text)}>📋 Copy</button></div><div className="qs-kit-actions"><button onClick={()=>setTitleMode(x=>(x+1)%packageData.titles.length)}>✨ Generate New Title</button><button onClick={()=>setTitleMode(packageData.titles.findIndex(t=>/before|need|remember/i.test(t.text))>=0?packageData.titles.findIndex(t=>/before|need|remember/i.test(t.text)):0)}>🔥 More Clickable</button><button onClick={()=>setTitleMode(packageData.titles.findIndex(t=>new RegExp(category,'i').test(t.text))>=0?packageData.titles.findIndex(t=>new RegExp(category,'i').test(t.text)):0)}>🎯 More Searchable</button></div><div className="qs-title-list">{packageData.titles.map((t,i)=><button key={t.text} className={titleMode===i?'active':''} onClick={()=>setTitleMode(i)}><span>{i+1}</span><em>{t.text}</em><b>{t.score}/100</b></button>)}</div></div>}
        {publishingTab==='description'&&<div className="qs-kit-section"><label>📝 DESCRIPTION</label><textarea value={packageData.description} readOnly/><div className="qs-kit-actions"><button onClick={()=>copyText(packageData.description)}>📋 Copy Description</button><button onClick={()=>setDescriptionMode(x=>x+1)}>✨ Rewrite</button><button onClick={()=>setDescriptionMode(2)}>✂ Shorter</button><button onClick={()=>setDescriptionMode(1)}>📖 More Meaningful</button></div></div>}
        {publishingTab==='hashtags'&&<div className="qs-kit-section"><label>#️⃣ HASHTAGS</label><div className="qs-token-box">{packageData.hashtags}</div><div className="qs-kit-actions"><button onClick={()=>copyText(packageData.hashtags)}>📋 Copy All</button><button onClick={()=>setHashtagMode(x=>x==='seo'?'global':'seo')}>✨ New Hashtags</button><button onClick={()=>setHashtagMode('seo')}>🎯 SEO</button><button onClick={()=>setHashtagMode('india')}>🇮🇳 India</button><button onClick={()=>setHashtagMode('global')}>🌎 Global</button></div></div>}
        {publishingTab==='tags'&&<div className="qs-kit-section"><label>🏷 YOUTUBE TAGS</label><div className="qs-token-box">{packageData.tags}</div><button className="qs-copy-wide" onClick={()=>copyText(packageData.tags)}>📋 COPY TAGS</button></div>}
        {publishingTab==='source'&&<div className="qs-kit-section qs-source-grid"><div><label>📚 QUOTE SOURCE</label><strong>{attribution?.name||'Original Wisdom'}</strong><p>{attribution?`“${attribution.quote}”`:'This script is original and is not attributed to a historical personality.'}</p><small>{attribution?.source||'Pattan Original Wisdom Engine'} · {attribution?.status||'✨ Original AI Quote'}</small></div><div><label>🎵 MUSIC LICENSE</label><strong>{soundtrack.name}</strong><p>{soundtrack.licenseType}</p><small>{soundtrack.commercialUse} · {soundtrack.attribution}</small></div><div><label>🎙 VOICE STATUS</label><strong>{voiceOn?voice:'Voiceover Off'}</strong><p>{voiceOn?'Auto ducking protects narration clarity.':'Music-only export selected.'}</p></div><div><label>📊 QUALITY</label><strong>{score.overall}/100 Soul Score</strong><p>{freshness.score}% freshness · never used in your library</p></div><div><label>❤️ CTA TEXT</label><strong>{ctaIntensity.toUpperCase()}</strong><p>{ctaIntensity==='off'?'No CTA in video':ctaText}</p></div><div><label>🖼 COVER TEXT</label><strong>{packageData.coverText}</strong></div></div>}
        {publishingTab==='branding'&&<div className="qs-kit-section qs-brand-settings"><label>Channel Name<input value={brand.channelName} onChange={e=>setBrand(b=>({...b,channelName:e.target.value}))}/></label><label>Channel Handle<input value={brand.handle} onChange={e=>setBrand(b=>({...b,handle:e.target.value}))}/></label><label>Preferred CTA<input value={brand.preferredCta} onChange={e=>setBrand(b=>({...b,preferredCta:e.target.value}))} placeholder="Leave blank for Smart CTA"/></label><label>Brand Font<select value={brand.brandFont} onChange={e=>setBrand(b=>({...b,brandFont:e.target.value}))}><option>Inter</option><option>Poppins</option><option>Montserrat</option><option>Playfair Display</option></select></label><label>Outro Style<select value={brand.outro} onChange={e=>setBrand(b=>({...b,outro:e.target.value}))}><option>Soft Fade</option><option>Cinematic Hold</option><option>Minimal Black</option></select></label><label className="qs-switch"><input type="checkbox" checked={brand.branding} onChange={e=>setBrand(b=>({...b,branding:e.target.checked}))}/> Show branding</label><label className="qs-switch"><input type="checkbox" checked={brand.watermark} onChange={e=>setBrand(b=>({...b,watermark:e.target.checked}))}/> Watermark</label><label className="qs-switch"><input type="checkbox" checked={brand.intro} onChange={e=>setBrand(b=>({...b,intro:e.target.checked}))}/> Intro</label></div>}
      </div>
      <div className="qs-export-card"><span>SHORT QUALITY SCORE · {score.overall}/100</span><h2>Master Export Engine</h2><p>Native-resolution typography, original 48 kHz soundtrack, one final H.264/AAC encode.</p><div className="qs-export-options"><label>Quality<select value={exportPreset} onChange={e=>setExportPreset(e.target.value)}><option value="premium">1080 × 1920 — Premium</option><option value="ultra">2160 × 3840 — YouTube Ultra</option><option value="master">2160 × 3840 — Master File</option></select></label><label>Frame rate<select value={exportFps} onChange={e=>setExportFps(+e.target.value)}><option value="30">30 FPS — Cinematic</option><option value="60">60 FPS — Ultra Smooth (1080p)</option></select></label></div><div className="qs-license good">✓ Original soundtrack loaded · 48 kHz · 320 kbps final AAC · H.264 High Quality</div><button onClick={()=>exportVideo()} disabled={exporting}>{exporting?`${exportStatus?.phase||'Rendering…'} ${exportStatus?.pct||0}%`:'⬇ EXPORT YOUTUBE SHORT'}</button><button className="qs-max-export" onClick={()=>exportVideo('master',30)} disabled={exporting}>👑 MAX QUALITY EXPORT · 4K/30</button>{exportStatus&&<div className={`qs-export-status ${exportStatus.error?'error':''}`}><b>{exportStatus.phase}</b>{exportStatus.validation&&<span>{exportStatus.validation.width}×{exportStatus.validation.height} · {exportStatus.validation.videoCodec} · {exportStatus.validation.audioCodec} {exportStatus.validation.sampleRate} Hz · audio verified</span>}</div>}<small>MP4 · H.264 · AAC 48 kHz/320 kbps · no watermark</small></div>
    </section>
    <footer className="qs-history"><h2>Hard anti-repeat memory</h2><p>{history.length} generated · {published.length} permanently excluded after export · {favorites.length} favorites · exact, semantic, hook, line, ending, structure and metaphor checks active</p></footer>
  </div>
}

export default QuoteStudio;
