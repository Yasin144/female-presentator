const SCRIPT_LANGUAGES = {
  te: {
    leads: ['అయ్యో,', 'అరెరే,', 'ఓహో,', 'అబ్బో,', 'అయ్యబాబోయ్,'],
    rules: [
      [/\b(sleep(?:s|ing)?|nap(?:s|ping)?|rest|tired|bed|sleepy)\b|నిద్ర|కునుకు|పడుకుంది|పడుకున్న|सोना|नींद|झपकी/i, ['మళ్లీ నిద్రా? ఇంటి మహారాజుగారే!', 'పని ఏమీ లేదు… ఇంకో కునుకు వేయండి మహారాజా!', 'నిద్రలో కూడా రాజసం చూడండి సార్!']],
      [/\b(eat|food|hungry|snack|milk|treat|dinner|breakfast)\b|ఆకలి|తిండి|పాలు|ట్రీట్|తింటున్న|भूख|खाना|दूध|नाश्ता/i, ['తిండి ఇన్‌స్పెక్షనా? పిల్లిగారు ఫుడ్ ఆఫీసరా!', 'ముందు ప్లేట్ ఖాళీ చేయండి సార్, రివ్యూ తర్వాత!', 'ఆకలి ముఖం పెట్టి మొత్తం వంటగదే అడిగేస్తున్నారు!']],
      [/\b(run(?:s|ning)?|jump(?:s|ed|ing)?|chase|zoom|race|fast|climb(?:s|ed|ing)?|leap)\b|పరుగెత్త|దూక|వేగంగా|జంప్|दौड़|कूद|भाग/i, ['సోఫా ఒలింపిక్సా? కాస్త నెమ్మదిగా ఛాంపియన్!', 'అయ్యో, ఫార్ములా వన్ పిల్లి వచ్చేసింది!', 'ఇంత స్పీడా? కరెంటు బిల్లు ఎవరు కడతారు సార్?']],
      [/\b(meow|cry|talk|say|hello|listen|call|yell)\b|మ్యావ్|అరుస్తు|మాట్లాడు|పిలుస్తు|म्याऊँ|बोल|चिल्ला/i, ['సీఈఓ పిల్లిగారి మీటింగ్… ట్రీట్స్ ఇప్పుడే కావాలట!', 'ప్రెస్ మీటింగా? ట్రీట్స్ ఎక్కడో చెప్పండి ముందు!', 'వాల్యూమ్ ఫుల్… అజెండా మాత్రం సున్నా సార్!']],
      [/\b(toy|play|ball|string|mouse|chase|game)\b|బొమ్మ|ఆట|ఆడుతు|खिलौना|खेल/i, ['సీఐడీ దర్యాప్తా? ఆ బొమ్మకు ఇక రక్షణ లేదు!', 'బొమ్మకు వార్నింగ్ ఇచ్చేయండి… బాస్ మూడ్‌లో ఉన్నారు!', 'ఇన్‌స్పెక్టర్ పిల్లిగారు కేసు విచారణలో ఉన్నారు!']],
      [/\b(mess|broke|spill|knock|fall|steal|scratch|destroy|oops)\b|గందరగోళం|చిందరవందర|పగలగొట్ట|పడేసి|ఓప్స్|गड़बड़|गिरा|तोड़|ओह/i, ['పని చేసి అమాయక ముఖమా? క్లాసిక్ పిల్లిగారూ!', 'నేరం చేసి అమాయకంగా చూస్తున్నారు… సీసీటీవీ ఉంది సార్!', 'ఆధారాలన్నీ ఉన్నాయి… నేరం మాత్రం ఒప్పుకోరా?']],
    ],
    general: [
      'ఇంటి అసలు బాస్ వచ్చేశారు—మిగతా వాళ్లం అద్దెదారులమే!',
      'చిన్న ప్యాకెట్… ఓవర్ యాక్షన్ మాత్రం ఇంటర్వెల్ బ్లాక్!',
      'ఆ చూపు చూడండి—విచారణకి లాయర్ కావాలి!',
      'పని మొదలైందా? ఫస్ట్ బ్రేక్ ఎప్పుడు బాస్?',
      'ఎంట్రీ పిల్లిది, సీన్ మొత్తం దానిదే!',
      'ఇది ఆట కాదంట… వీడియో మాత్రం సాక్ష్యం!',
      'ముఖం అమాయకం, ప్లాన్ మాత్రం ఫుల్ రెడీ!',
      'ఇంత రాజసం మా ఇంటి అద్దెకి కూడా లేదు!',
      'చిన్న జంప్, పెద్ద బిల్డప్—పాన్ ఇండియా సినిమా!',
      'నన్ను ఆపేది ఎవరు? మనుషులా? అసాధ్యం!',
      'ట్రీట్ ఇవ్వకపోతే ఇక్కడే ప్రెస్ మీట్!',
      'కెమెరా ఆన్ అయ్యాక అందరూ హీరోలే!',
      'డ్రామా అయింది… ఫీజు మాత్రం ట్రీట్స్‌లో!',
    ],
  },
  hi: {
    leads: ['अरे वाह,', 'अरे बाप रे,', 'ओहो,', 'हाय राम,', 'जनाब,'],
    rules: [
      [/\b(sleep(?:s|ing)?|nap(?:s|ping)?|rest|tired|bed|sleepy)\b|निद्रा|सोना|नींद|झपकी|कुनुकु|నిద్ర/i, ['फिर से नींद? घर के महाराज हैं क्या!', 'काम कुछ नहीं… एक झपकी और ले लीजिए, हुज़ूर!', 'सोते हुए भी नवाबी ठाठ देखिए जनाब!']],
      [/\b(eat|food|hungry|snack|milk|treat|dinner|breakfast)\b|भूख|खाना|दूध|नाश्ता|ट्रीट|తిండి|ఆకలి/i, ['खाने की जांच? बिल्ली जी फूड इंस्पेक्टर हैं!', 'पहले प्लेट साफ़ करो, रिव्यू बाद में जनाब!', 'भूख वाला चेहरा… पूरी रसोई चाहिए क्या?']],
      [/\b(run(?:s|ning)?|jump(?:s|ed|ing)?|chase|zoom|race|fast|climb(?:s|ed|ing)?|leap)\b|दौड़|कूद|भाग|పరుగెత్త|దూక/i, ['सोफ़ा ओलंपिक्स? धीरे, चैंपियन!', 'अरे, फ़ॉर्मूला वन की बिल्ली आ गई!', 'इतनी रफ़्तार? बिजली का बिल कौन भरेगा?']],
      [/\b(meow|cry|talk|say|hello|listen|call|yell)\b|म्याऊँ|बोल|चिल्ला|మ్యావ్|మాట్లాడు/i, ['सीईओ बिल्ली की मीटिंग? ट्रीट्स अभी चाहिए!', 'प्रेस कॉन्फ़्रेंस बाद में, पहले ट्रीट्स बताओ!', 'आवाज़ पूरी… एजेंडा ज़ीरो, जनाब!']],
      [/\b(toy|play|ball|string|mouse|chase|game)\b|खिलौना|खेल|బొమ్మ|ఆట/i, ['सीआईडी जाँच? खिलौने की ख़ैर नहीं!', 'खिलौने को चेतावनी दो, बॉस मूड में हैं!', 'इंस्पेक्टर बिल्ली केस की जाँच में हैं!']],
      [/\b(mess|broke|spill|knock|fall|steal|scratch|destroy|oops)\b|गड़बड़|गिरा|तोड़|ओह|గందరగోళం/i, ['गड़बड़ करके मासूम चेहरा? वाह, कमाल!', 'सबूत सामने… और जनाब बोलें, मैंने कुछ नहीं किया!', 'सीसीटीवी भी देख रहा है, हुज़ूर!']],
    ],
    general: [
      'घर के असली बॉस आ गए—बाकी सब किराएदार हैं!',
      'छोटा पैकेट, मगर ओवरएक्टिंग पूरी फ़िल्मी!',
      'ये नज़र देखो—वकील बुलाना पड़ेगा!',
      'काम शुरू हुआ? पहला ब्रेक कब है, बॉस?',
      'एंट्री बिल्ली की, पूरा सीन उसी का!',
      'कहती है खेल नहीं… वीडियो गवाह है!',
      'चेहरा मासूम, प्लान पूरा तैयार!',
      'इतना नवाबी ठाठ तो घर के किराए में भी नहीं!',
      'छोटी छलांग, बड़ा ड्रामा—पूरी फ़िल्म!',
      'मुझे कौन रोकेगा? इंसान? नामुमकिन!',
      'ट्रीट नहीं मिली तो यहीं प्रेस कॉन्फ़्रेंस!',
      'कैमरा चालू होते ही सब हीरो!',
      'ड्रामा ख़त्म… फ़ीस ट्रीट्स में देना!',
    ],
  },
  en: {
    leads: ['Arre wah,', 'Aiyo,', 'Oho,', 'Haye re,', 'Boss,'],
    rules: [
      [/\b(sleep(?:s|ing)?|nap(?:s|ping)?|rest|tired|bed|sleepy)\b|నిద్ర|कुनुकु|नींद|झपकी/i, ['Nap again? Wah, royal life, boss!', 'Full-time nap minister on duty!', 'Hard work? One more nap, Maharaja!']],
      [/\b(eat|food|hungry|snack|milk|treat|dinner|breakfast)\b|ఆకలి|తిండి|भूख|खाना/i, ['Snack inspection? Food minister on duty!', 'Plate first, review later, boss!', 'That hungry face wants the whole kitchen!']],
      [/\b(run(?:s|ning)?|jump(?:s|ed|ing)?|chase|zoom|race|fast|climb(?:s|ed|ing)?|leap)\b|పరుగెత్త|दौड़|कूद/i, ['Sofa Olympics? Easy there, champion!', 'Mini Formula One has entered the room!', 'That speed? Who is paying the power bill?']],
      [/\b(meow|cry|talk|say|hello|listen|call|yell)\b|మ్యావ్|म्याऊँ/i, ['Cat CEO called a meeting—treats now!', 'Press conference later; where are the treats?', 'Full volume, zero agenda, boss!']],
      [/\b(toy|play|ball|string|mouse|chase|game)\b|బొమ్మ|ఆట|खिलौना/i, ['CID investigation? That toy is doomed!', 'Warn the toy—the boss is in a mood!', 'Inspector Whiskers is on the case!']],
      [/\b(mess|broke|spill|knock|fall|steal|scratch|destroy|oops)\b|గందరగోళం|गड़बड़|तोड़/i, ['Made a mess, then the innocent face—classic!', 'Evidence everywhere, guilt nowhere, boss!', 'Even CCTV is judging this performance!']],
    ],
    general: [
      'The real boss is here; the rest of us pay rent!',
      'Tiny package, full-on movie-star overacting!',
      'Look at that stare—we need a lawyer!',
      'Work started? When is the first break, boss?',
      'Cat made the entrance; the whole scene is theirs!',
      'Not playing, they say. The video is evidence!',
      'Innocent face, fully prepared master plan!',
      'Even our rent does not come with this royal attitude!',
      'Tiny jump, giant buildup—pan-India blockbuster!',
      'Who can stop me? Humans? Please!',
      'No treats? Fine, press conference right here!',
      'Camera on, suddenly everybody is a hero!',
      'Drama is free; payment accepted in treats!',
    ],
  },
};

function tidySource(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function makeComedicNarration(value, index = 0, language = 'te') {
  const source = tidySource(value);
  if (!source) return '';
  const script = SCRIPT_LANGUAGES[language] || SCRIPT_LANGUAGES.te;
  const safeIndex = Math.abs(Number(index) || 0);
  const authoredComedy = {
    te: /కుస్తీ|టికెట్|పంజా|రిఫరీ|యాక్షన్ హీరో|డ్రామా|అమాయక|టెయిల్|గుసగుస|మార్చ్|తీర్పు|ట్రీట్స్|కేవలం పడుకున్నా|ప్రెస్ మీట్|బాస్|మహారాజా|పోజు|నువ్వే మొదలు|ఏం చేయలేదు|మొదలెట్ట|చర్చ/i,
    hi: /ओलंपिक|ट्रीट|बॉस|ड्रामा|मासूम|प्रेस कॉन्फ़्रेंस|हीरो|फ़िल्मी|किराएदार|वकील|नामुमकिन/i,
    en: /\b(olympics|treats?|boss|drama|innocent|press conference|hero|overacting|lawyer|rent|blockbuster|please)\b/i,
  };
  // Preserve a user's authored punchline instead of rewriting it through a
  // small template pool, which caused repeated lines in longer Shorts.
  if ((authoredComedy[language] || authoredComedy.te).test(source)) return source;
  const lead = script.leads[safeIndex % script.leads.length];
  const relevant = script.rules.find(([match]) => match.test(source));
  const gags = relevant?.[1] || script.general;
  return `${lead} ${gags[safeIndex % gags.length]}`;
}

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(Number(seconds) * 1000));
  const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const mm = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${hh}:${mm}:${ss},${String(ms % 1000).padStart(3, '0')}`;
}

export function serializeSrt(segments) {
  return segments.map((segment, index) => `${index + 1}\n${srtTime(segment.start)} --> ${srtTime(segment.end)}\n${segment.narrationText || segment.text}`).join('\n\n');
}
