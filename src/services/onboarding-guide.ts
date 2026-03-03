/**
 * Onboarding Guide Utility
 * 
 * Sends a comprehensive text + voice feature tour to new sellers
 * after they complete PAN verification or choose guest mode.
 * This is a one-time message showing all Vyapar Vaani features.
 */

/**
 * Send onboarding guide message after PAN verification or guest mode.
 * Sends a clean point-wise TEXT + a longer conversational VOICE message.
 */
export async function sendOnboardingGuide(phone: string, language: string): Promise<void> {
  const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
  const { sendTextMessage, sendVoiceOnly, sendTypingIndicator } = await import('../lambdas/whatsapp-message-sender');

  await sendTypingIndicator(phone);

  // --- CLEAN POINT-WISE TEXT MESSAGE ---
  const textGuide: Record<string, string> = {
    'hi': [
      'Vyapar Vaani - Aapka AI Business Assistant',
      '',
      'Aap ye sab kar sakte hain:',
      '',
      '1. Product Add Karna',
      '   Voice mein boliye: "Tamatar bees rupaye kilo, paanch kilo hai"',
      '   Ya sirf boliye: "Aam bechna hai" - main baaki poochunga',
      '',
      '2. Product Ki Photo',
      '   Jab naam aur daam de denge, main photo maangunga',
      '   Seedha photo bhej dijiye WhatsApp pe',
      '',
      '3. Bazaar Bhav Jaanein',
      '   Boliye: "Tamatar ka aaj ka bhav kya hai?"',
      '   Main live mandi price bata dunga',
      '',
      '4. UPI Setup',
      '   Apna UPI ID bhejiye jaise: name@upi',
      '   Customers seedha payment kar payenge',
      '',
      '5. Marketplace Link',
      '   Aapki apni online dukaan ka link milega',
      '   Share kijiye customers ke saath',
      '',
      '6. Analytics Dekhein',
      '   Boliye: "Meri bikri batao" ya "Top products"',
      '',
      '7. Product Hatana',
      '   Boliye: "Tamatar hatao" - turant hata denge',
      '',
      'Bas voice mein naturally boliye, main samajh jaunga!',
    ].join('\n'),

    'mr': [
      'Vyapar Vaani - Tumcha AI Business Assistant',
      '',
      'Tumhi he sarvh karu shakta:',
      '',
      '1. Product Add Karna',
      '   Voice madhye sangaa: "Tomato vees rupaye kilo, paach kilo aahe"',
      '   Kinva sangaa: "Aam vikaycha aahe" - baaki mi vicharen',
      '',
      '2. Product Cha Photo',
      '   Naav aani kimmat dilya nantar mi photo maagen',
      '   WhatsApp var direct photo pathva',
      '',
      '3. Bazaar Bhav',
      '   Sangaa: "Tomato cha aajcha bhav kay aahe?"',
      '',
      '4. UPI Setup',
      '   Tumcha UPI ID pathva jase: name@upi',
      '',
      '5. Marketplace Link',
      '   Tumchya online dukan cha link milel',
      '',
      '6. Analytics',
      '   Sangaa: "Mazhi vikri sangaa"',
      '',
      '7. Product Kadhna',
      '   Sangaa: "Tomato kadh" - lagech kadhun taakto',
      '',
      'Naturally bolaa, mi samjhen!',
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
      '   Send your UPI ID like: name@upi',
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

  // Send text guide
  await sendTextMessage(phone, textGuide[lang] || textGuide['hi']);

  // Wait a moment before voice
  await new Promise(resolve => setTimeout(resolve, 1500));
  await sendTypingIndicator(phone);

  // --- VOICE MESSAGE (conversational, a bit longer) ---
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
