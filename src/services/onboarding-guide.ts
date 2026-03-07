
export async function sendOnboardingGuide(phone: string, language: string): Promise<void> {
  const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
  const { sendTextMessage, sendVoiceOnly, sendTypingIndicator } = await import('../lambdas/whatsapp-message-sender');

  await sendTypingIndicator(phone);

  const textGuide: Record<string, string> = {
    'hi': [
      '*🙏 व्यापार वाणी में आपका स्वागत है!*',
      '_आपका AI बिज़नेस असिस्टेंट — बस बोलिए, बाकी मैं संभालूँगा_',
      '',
      '*🛒 प्रोडक्ट जोड़ें*',
      'बोलिए: _"टमाटर बीस रुपये किलो, पाँच किलो है"_',
      'या सिर्फ: _"आम बेचना है"_ — बाकी मैं पूछूँगा',
      '',
      '*📸 फोटो भेजें*',
      'WhatsApp पर प्रोडक्ट की फोटो भेजिए',
      'मैं बैकग्राउंड साफ़ करके प्रोफेशनल बना दूँगा',
      '',
      '*💰 बाज़ार भाव*',
      'बोलिए: _"टमाटर का भाव बताओ"_',
      'लाइव मंडी भाव तुरंत मिलेगा',
      '',
      '*📊 बिक्री रिपोर्ट*',
      'बोलिए: _"मेरी बिक्री बताओ"_ या _"रिपोर्ट भेजो"_',
      'PDF रिपोर्ट भी मिलेगी सारी जानकारी के साथ',
      '',
      '*🔗 ऑनलाइन दुकान*',
      'आपकी अपनी मार्केटप्लेस लिंक मिलेगी',
      'कस्टमर्स को शेयर करें — वो ऑर्डर कर पाएँगे',
      '',
      '*💳 UPI पेमेंट*',
      'अपना UPI ID भेजिए: _name@oksbi_',
      'कस्टमर सीधा पेमेंट कर पाएँगे',
      '',
      '*🌤️ रोज़ाना अपडेट*',
      'मौसम + बाज़ार भाव का अपडेट रोज़ सुबह',
      'बोलिए: _"आज का अपडेट बताओ"_',
      '',
      '*✅ ऑर्डर मैनेज करें*',
      'बोलिए: _"ऑर्डर दिखाओ"_ — एक्सेप्ट/रिजेक्ट करें',
      '',
      '*❌ प्रोडक्ट हटाएँ*',
      'बोलिए: _"टमाटर हटाओ"_ — तुरंत हटा देंगे',
      '',
      '🗣️ *बस वॉइस में बोलिए — हिंदी, मराठी, English — मैं समझ जाऊँगा!*',
    ].join('\n'),

    'mr': [
      '*🙏 व्यापार वाणी मध्ये स्वागत आहे!*',
      '_तुमचा AI बिझनेस असिस्टंट — बोला, बाकी मी बघतो_',
      '',
      '*🛒 प्रोडक्ट जोडा*',
      'सांगा: _"टोमॅटो वीस रुपये किलो, पाच किलो"_',
      'किंवा: _"आम विकायचा आहे"_ — बाकी मी विचारेन',
      '',
      '*📸 फोटो पाठवा*',
      'WhatsApp वर प्रोडक्ट चा फोटो पाठवा',
      'मी बॅकग्राउंड साफ करून प्रोफेशनल बनवेन',
      '',
      '*💰 बाजार भाव*',
      'सांगा: _"टोमॅटो चा भाव सांगा"_',
      'लाइव मंडी भाव लगेच मिळेल',
      '',
      '*📊 विक्री रिपोर्ट*',
      'सांगा: _"माझी विक्री सांगा"_ किंवा _"रिपोर्ट पाठवा"_',
      'PDF रिपोर्ट पण मिळेल',
      '',
      '*🔗 ऑनलाइन दुकान*',
      'तुमची मार्केटप्लेस लिंक मिळेल — कस्टमर्सना शेअर करा',
      '',
      '*💳 UPI पेमेंट*',
      'तुमचा UPI ID पाठवा: _name@oksbi_',
      '',
      '*🌤️ रोजचा अपडेट*',
      'हवामान + बाजारभाव रोज सकाळी',
      'सांगा: _"आजचा अपडेट सांगा"_',
      '',
      '*✅ ऑर्डर मॅनेज करा*',
      'सांगा: _"ऑर्डर दाखवा"_',
      '',
      '*❌ प्रोडक्ट काढा*',
      'सांगा: _"टोमॅटो काढ"_ — लगेच काढतो',
      '',
      '🗣️ *सहज बोला — हिंदी, मराठी, English — मी समजेन!*',
    ].join('\n'),

    'en': [
      '*🙏 Welcome to Vyapar Vaani!*',
      '_Your AI Business Assistant — just speak, I will handle the rest_',
      '',
      '*🛒 Add Products*',
      'Say: _"Tomato 20 rupees per kg, 5 kg available"_',
      'Or just: _"I want to sell mangoes"_ — I will ask the rest',
      '',
      '*📸 Send Photos*',
      'Send a product photo on WhatsApp',
      'I will clean the background and make it professional',
      '',
      '*💰 Market Prices*',
      'Ask: _"What is the price of tomato?"_',
      'Get live mandi rates instantly',
      '',
      '*📊 Sales Reports*',
      'Say: _"Show my sales"_ or _"Send me a report"_',
      'Get a PDF report with full business insights',
      '',
      '*🔗 Online Shop*',
      'Get your own marketplace link to share with customers',
      'They can browse and place orders directly',
      '',
      '*💳 UPI Payments*',
      'Send your UPI ID like: _name@oksbi_',
      'Customers can pay you directly',
      '',
      '*🌤️ Daily Updates*',
      'Weather + market prices every morning',
      'Ask: _"Give me today update"_',
      '',
      '*✅ Manage Orders*',
      'Say: _"Show orders"_ — accept or reject them',
      '',
      '*❌ Remove Products*',
      'Say: _"Remove tomato"_ — done instantly',
      '',
      '🗣️ *Just speak naturally — Hindi, Marathi, English — I understand all!*',
    ].join('\n'),
  };

  await sendTextMessage(phone, textGuide[lang] || textGuide['hi']);

  await new Promise(resolve => setTimeout(resolve, 1500));
  await sendTypingIndicator(phone);

  const voiceGuide: Record<string, string> = {
    'hi': 'Namaste! Vyapar Vaani mein aapka swagat hai. Main hoon aapka AI business assistant. '
      + 'Aap mujhse product add kar sakte hain — bas boliye "tamatar bees rupaye kilo, paanch kilo hai". '
      + 'Product ki photo WhatsApp pe bhej dijiye, main background saaf karke professional banaa dunga. '
      + 'Live mandi bhav jaanna ho toh boliye "tamatar ka bhav batao". '
      + 'Bikri ki report chahiye toh boliye "report bhejo", PDF mil jayegi. '
      + 'Aapki apni online dukaan ki link bhi milegi customers ke liye. '
      + 'UPI ID set karenge toh customers seedha pay kar payenge. '
      + 'Roz subah mausam aur bazaar ka update milega. '
      + 'Toh chaliye shuru karte hain — apna pehla product ka naam, daam aur quantity boliye!',

    'mr': 'Namaskar! Vyapar Vaani madhye tumcha swagat aahe. Mi tumcha AI business assistant. '
      + 'Product add karaycha asel tar sangaa "tomato vees rupaye kilo, paach kilo". '
      + 'Photo WhatsApp var pathva, mi background saaf karun professional banven. '
      + 'Mandi bhav jaanun ghyaycha asel tar sangaa "tomato cha bhav sangaa". '
      + 'Vikri chi report pahije tar sangaa "report pathva", PDF milel. '
      + 'Tumchi online dukan chi link bhi milel. '
      + 'UPI ID set kela tar customers direct pay karu shaktat. '
      + 'Roz sakaali havamaan aani bazaar bhav cha update milel. '
      + 'Chalaa shuru karu — tumcha pahila product sangaa!',

    'en': 'Welcome to Vyapar Vaani! I am your AI business assistant. '
      + 'You can add products by just speaking — say "tomato twenty rupees per kilo, five kilos available". '
      + 'Send a product photo on WhatsApp and I will clean the background to make it look professional. '
      + 'Want live market prices? Ask "what is the price of tomato". '
      + 'Need a sales report? Say "send me a report" and you will get a PDF. '
      + 'You will also get your own online shop link that you can share with customers. '
      + 'Set up your UPI ID so customers can pay you directly. '
      + 'Every morning you will get weather and market price updates. '
      + 'So let us get started — tell me your first product name, price and quantity!',
  };

  await sendVoiceOnly(phone, voiceGuide[lang] || voiceGuide['hi'], lang);
  console.log('📋 Onboarding guide sent to', phone);
}
