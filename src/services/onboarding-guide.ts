
export async function sendOnboardingGuide(phone: string, language: string): Promise<void> {
  const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
  const { sendTextMessage, sendVoiceOnly, sendTypingIndicator } = await import('../lambdas/whatsapp-message-sender');

  await sendTypingIndicator(phone);

  const textGuide: Record<string, string> = {
    'hi': [
      'व्यापार वाणी — आपका AI बिज़नेस असिस्टेंट',
      '',
      'आप ये सब कर सकते हैं:',
      '',
      '1. प्रोडक्ट जोड़ें',
      '   वॉइस में बोलिए: "टमाटर बीस रुपये किलो, पाँच किलो है"',
      '   या सिर्फ बोलिए: "आम बेचना है" — बाकी मैं पूछूँगा',
      '',
      '2. प्रोडक्ट की फोटो',
      '   नाम और दाम देंगे तो मैं फोटो माँगूँगा',
      '   सीधा फोटो भेज दीजिए WhatsApp पर',
      '',
      '3. बाज़ार भाव जानें',
      '   बोलिए: "टमाटर का आज का भाव क्या है?"',
      '   मैं लाइव मंडी भाव बता दूँगा',
      '',
      '4. UPI सेटअप',
      '   अपना UPI ID भेजिए जैसे: name@oksbi, phone@paytm, shop@ybl',
      '   कस्टमर सीधा पेमेंट कर पाएँगे',
      '',
      '5. मार्केटप्लेस लिंक',
      '   आपकी अपनी ऑनलाइन दुकान का लिंक मिलेगा',
      '   कस्टमर्स को शेयर कीजिए',
      '',
      '6. बिक्री देखें',
      '   बोलिए: "मेरी बिक्री बताओ" या "टॉप प्रोडक्ट्स"',
      '',
      '7. प्रोडक्ट हटाना',
      '   बोलिए: "टमाटर हटाओ" — तुरंत हटा देंगे',
      '',
      'बस वॉइस में बोलिए, मैं समझ जाऊँगा!',
    ].join('\n'),

    'mr': [
      'व्यापार वाणी — तुमचा AI बिझनेस असिस्टंट',
      '',
      'तुम्ही हे सर्व करू शकता:',
      '',
      '1. प्रोडक्ट जोडा',
      '   व्हॉइस मध्ये सांगा: "टोमॅटो वीस रुपये किलो, पाच किलो आहे"',
      '   किंवा सांगा: "आम विकायचा आहे" — बाकी मी विचारेन',
      '',
      '2. प्रोडक्ट चा फोटो',
      '   नाव आणि किंमत दिल्यानंतर मी फोटो मागेन',
      '   WhatsApp वर डायरेक्ट फोटो पाठवा',
      '',
      '3. बाजार भाव',
      '   सांगा: "टोमॅटो चा आजचा भाव काय आहे?"',
      '',
      '4. UPI सेटअप',
      '   तुमचा UPI ID पाठवा जसे: name@oksbi, phone@paytm, shop@ybl',
      '',
      '5. मार्केटप्लेस लिंक',
      '   तुमच्या ऑनलाइन दुकानाचा लिंक मिळेल',
      '',
      '6. विक्री पहा',
      '   सांगा: "माझी विक्री सांगा"',
      '',
      '7. प्रोडक्ट काढा',
      '   सांगा: "टोमॅटो काढ" — लगेच काढून टाकतो',
      '',
      'सहज बोला, मी समजेन!',
    ].join('\n'),

    'en': [
      'Vyapar Vaani - Your AI Business Assistant',
      '',
      'Here is what you can do:',
      '',
      '1. Add Products',
      '   Say: "Tomato 20 rupees per kg, 5 kg available"',
      '   Or just say: "I want to sell mangoes" - I will ask the rest',
      '',
      '2. Product Photo',
      '   After name and price, I will ask for a photo',
      '   Just send the photo on WhatsApp',
      '',
      '3. Check Market Prices',
      '   Ask: "What is today price of tomato?"',
      '   I will get live mandi prices',
      '',
      '4. UPI Setup',
      '   Send your UPI ID like: name@oksbi, phone@paytm, shop@ybl',
      '   Customers can pay you directly',
      '',
      '5. Marketplace Link',
      '   Get your own online shop link',
      '   Share with customers',
      '',
      '6. Analytics',
      '   Ask: "Show my sales" or "Top products"',
      '',
      '7. Remove Products',
      '   Say: "Remove tomato" - done instantly',
      '',
      'Just speak naturally, I will understand!',
    ].join('\n'),
  };

  await sendTextMessage(phone, textGuide[lang] || textGuide['hi']);

  await new Promise(resolve => setTimeout(resolve, 1500));
  await sendTypingIndicator(phone);

  const voiceGuide: Record<string, string> = {
    'hi': 'Chaliye, ab main aapko bata deta hoon ki Vyapar Vaani se aap kya kya kar sakte hain. '
      + 'Sabse pehle, product add karna. Bas voice mein boliye ki kya bechna hai, kitne ka hai, kitna hai. '
      + 'Jaise boliye "tamatar bees rupaye kilo, paanch kilo hai" aur main turant note kar lunga. '
      + 'Phir main aapse photo maangunga, bus WhatsApp pe seedha bhej dijiye. '
      + 'Agar aapko bazaar ka daam jaanna hai toh boliye "tamatar ka bhav batao" aur main live mandi price de dunga. '
      + 'UPI ID setup karna chahte hain toh apna UPI ID bhej dijiye, customers seedha aapko pay kar payenge. '
      + 'Aapki apni online dukaan ka link bhi milega jo aap customers ko share kar sakte hain. '
      + 'Bikri ka hisaab jaanna hai toh boliye "meri bikri batao". '
      + 'Product hatana hai toh boliye "tamatar hatao". '
      + 'Bas itna yaad rakhiye, aap naturally boliye, main samajh jaunga. '
      + 'Toh chaliye shuru karte hain, apna pehla product add karne ke liye product ka naam, daam aur quantity boliye!',

    'mr': 'Chalaa, aata mi tumhala sangto ki Vyapar Vaani madhye tumhi kay kay karu shakta. '
      + 'Aadhee, product add karna. Voice madhye sangaa ki kay vikaycha aahe, kitya la aahe, kiti aahe. '
      + 'Jase sangaa "tomato vees rupaye kilo, paach kilo" aur mi lagech note karen. '
      + 'Nantar mi photo maagen, WhatsApp var direct pathva. '
      + 'Bazaar cha bhav jaanun ghyaycha asel tar sangaa "tomato cha bhav sangaa". '
      + 'UPI setup karaycha asel tar tumcha UPI ID pathva. '
      + 'Tumchi online dukan cha link bhi milel. '
      + 'Vikri cha hisob janun ghyaycha asel tar sangaa "mazhi vikri sangaa". '
      + 'Naturally bolaa, mi samjhen. Chalaa shuru karu, pahila product add kara!',

    'en': 'Let me tell you what all you can do with Vyapar Vaani. '
      + 'First, adding products. Just say what you want to sell, the price, and quantity. '
      + 'For example, say "tomato twenty rupees per kilo, five kilos available" and I will note it down right away. '
      + 'Then I will ask for a photo, just send it on WhatsApp. '
      + 'If you want to know market prices, just ask "what is the price of tomato today" and I will get live mandi rates. '
      + 'Want to set up UPI? Just send your UPI ID and customers can pay you directly. '
      + 'You will also get your own online shop link to share with customers. '
      + 'Want to see your sales? Just ask "show my sales". '
      + 'Want to remove a product? Say "remove tomato". '
      + 'Just speak naturally and I will understand. '
      + 'So let us get started, tell me your first product name, price and quantity!',
  };

  await sendVoiceOnly(phone, voiceGuide[lang] || voiceGuide['hi'], lang);
  console.log('📋 Onboarding guide sent to', phone);
}
