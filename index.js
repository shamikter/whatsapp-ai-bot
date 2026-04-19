require('dotenv').config();
const express = require('express');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();
const PORT = process.env.PORT || 3000;
const isRailway = process.env.RAILWAY_ENVIRONMENT !== undefined;

let qrImageDataUrl = null;
let isAuthenticated = false;
const recentMessages = new Map();

const KB = {
  checkin: {
    keywords: ['check in', 'check-in', 'arrival', 'llegada', 'chegada'],
    answer: {
      en: 'Check-in starts at 15:00. If you arrive late, please inform us.',
      es: 'El check-in comienza a las 15:00. Si llega tarde, avísenos.',
      pt: 'O check-in começa às 15:00. Se chegar tarde, avise-nos.'
    }
  },
  checkout: {
    keywords: ['check out', 'check-out', 'departure', 'salida', 'saida'],
    answer: {
      en: 'Check-out is until 11:00. Late check-out depends on availability.',
      es: 'El check-out es hasta las 11:00. El late check-out depende de la disponibilidad.',
      pt: 'O check-out é até as 11:00. O late check-out depende da disponibilidade.'
    }
  },
  breakfast: {
    keywords: ['breakfast', 'desayuno', 'cafe da manha', 'café da manhã'],
    answer: {
      en: 'Breakfast is from 07:00 to 10:00.',
      es: 'El desayuno es de 07:00 a 10:00.',
      pt: 'O café da manhã é das 07:00 às 10:00.'
    }
  },
  wifi: {
    keywords: ['wifi', 'wi-fi', 'internet', 'password'],
    answer: {
      en: 'Wi-Fi is available. Ask reception for the password.',
      es: 'Hay Wi-Fi. Pida la contraseña en recepción.',
      pt: 'Há Wi-Fi. Peça a senha na recepção.'
    }
  },
  kitchen: {
    keywords: ['kitchen', 'cocina', 'cozinha'],
    answer: {
      en: 'Shared kitchen is available. Please keep it clean after use.',
      es: 'Hay cocina compartida. Por favor, déjela limpia después de usarla.',
      pt: 'Há cozinha compartilhada. Por favor, mantenha-a limpa após o uso.'
    }
  },
  laundry: {
    keywords: ['laundry', 'lavanderia', 'lavar roupa', 'wash clothes'],
    answer: {
      en: 'Laundry may be available. Ask reception for details.',
      es: 'La lavandería puede estar disponible. Consulte en recepción.',
      pt: 'A lavanderia pode estar disponível. Consulte a recepção.'
    }
  },
  luggage: {
    keywords: ['luggage', 'bags', 'equipaje', 'bagagem'],
    answer: {
      en: 'You can leave luggage before check-in or after check-out.',
      es: 'Puede dejar su equipaje antes del check-in o después del check-out.',
      pt: 'Você pode deixar sua bagagem antes do check-in ou depois do check-out.'
    }
  },
  parking: {
    keywords: ['parking', 'aparcamiento', 'estacionamento'],
    answer: {
      en: 'Parking depends on availability. Please contact us in advance.',
      es: 'El aparcamiento depende de la disponibilidad. Por favor, contáctenos con antelación.',
      pt: 'O estacionamento depende da disponibilidade. Entre em contato conosco com antecedência.'
    }
  },
  pets: {
    keywords: ['pet', 'dog', 'cat', 'mascota', 'animal'],
    answer: {
      en: 'Pets depend on the property policy. Please ask before arrival.',
      es: 'Las mascotas dependen de la política del alojamiento. Consúltenos antes de llegar.',
      pt: 'Animais de estimação dependem da política da propriedade. Consulte-nos antes da chegada.'
    }
  },
  cancellation: {
    keywords: ['cancel', 'refund', 'cancelacion', 'cancelación', 'cancelamento'],
    answer: {
      en: 'Cancellation depends on your booking conditions.',
      es: 'La cancelación depende de las condiciones de su reserva.',
      pt: 'O cancelamento depende das condições da sua reserva.'
    }
  },
  reception: {
    keywords: ['reception', 'hours', 'recepcion', 'recepción', 'recepcao', 'recepção'],
    answer: {
      en: 'Reception hours may vary. Contact us if needed.',
      es: 'El horario de recepción puede variar. Contáctenos si lo necesita.',
      pt: 'O horário da recepção pode variar. Entre em contato se precisar.'
    }
  },
  earlyCheckin: {
    keywords: ['early check', 'check in early', 'temprano', 'cedo'],
    answer: {
      en: 'Early check-in depends on availability.',
      es: 'El check-in temprano depende de la disponibilidad.',
      pt: 'O check-in antecipado depende da disponibilidade.'
    }
  },
  lateCheckout: {
    keywords: ['late check', 'late checkout', 'salir tarde', 'sair tarde'],
    answer: {
      en: 'Late check-out may be possible for an extra fee.',
      es: 'El late check-out puede tener un cargo adicional.',
      pt: 'O late check-out pode ter um custo adicional.'
    }
  },
  privateRoom: {
    keywords: ['private room', 'habitacion privada', 'habitación privada', 'quarto privado'],
    answer: {
      en: 'Private rooms depend on availability. Send your dates.',
      es: 'Las habitaciones privadas dependen de la disponibilidad. Envíe sus fechas.',
      pt: 'Os quartos privados dependem da disponibilidade. Envie suas datas.'
    }
  }
};

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCommonTypos(text) {
  let t = normalize(text);

  const replacements = [
    [/^helo\b/g, 'hello'],
    [/\bhelo\b/g, 'hello'],
    [/\bwifii\b/g, 'wifi'],
    [/\bwify\b/g, 'wifi'],
    [/\bwi fi\b/g, 'wifi'],
    [/\bchek in\b/g, 'check in'],
    [/\bchek\b/g, 'check'],
    [/\bcheckin\b/g, 'check in'],
    [/\bcheckout\b/g, 'check out'],
    [/\bbagaje\b/g, 'equipaje'],
    [/\bbagage\b/g, 'luggage'],
    [/\bequipage\b/g, 'equipaje'],
    [/\bcozina\b/g, 'cozinha'],
    [/\bcozina compartilhada\b/g, 'cozinha compartilhada'],
    [/\bparquing\b/g, 'parking'],
    [/\bdesayno\b/g, 'desayuno'],
    [/\bcafe da manha\b/g, 'cafe da manha'],
    [/\bposo\b/g, 'posso'],
    [/\bchegar tardee\b/g, 'chegar tarde']
  ];

  for (const [pattern, replacement] of replacements) {
    t = t.replace(pattern, replacement);
  }

  return t;
}

function detectLanguage(text) {
  const t = cleanCommonTypos(text);

  // HARD RULES for short greetings
  if (t === 'oi' || t === 'ola' || t === 'olá') return 'pt';
  if (t === 'hola') return 'es';
  if (t === 'hi' || t === 'hello') return 'en';

  const ptWords = [
    'oi', 'ola', 'olá', 'obrigado', 'obrigada', 'reserva',
    'quarto', 'chegada', 'saida', 'saída', 'bagagem',
    'cozinha', 'recepcao', 'recepção', 'estacionamento',
    'toalha', 'lavanderia', 'posso', 'tem', 'wifi',
    'check in', 'check out', 'chegar tarde'
  ];

  const esWords = [
    'hola', 'gracias', 'reserva', 'habitacion', 'habitación',
    'llegada', 'salida', 'equipaje', 'cocina', 'recepcion',
    'recepción', 'aparcamiento', 'toalla', 'puedo', 'hay',
    'wifi', 'check in', 'check out', 'dejar equipaje'
  ];

  const enWords = [
    'hello', 'hi', 'thanks', 'booking', 'room', 'arrival',
    'departure', 'luggage', 'kitchen', 'reception', 'parking',
    'towel', 'laundry', 'can i', 'do you', 'wifi',
    'check in', 'check out', 'late arrival'
  ];

  let ptScore = 0;
  let esScore = 0;
  let enScore = 0;

  for (const w of ptWords) {
    if (t.includes(w)) {
      ptScore += ['oi', 'ola', 'olá', 'posso', 'tem', 'quarto', 'cozinha', 'bagagem'].includes(w) ? 2 : 1;
    }
  }

  for (const w of esWords) {
    if (t.includes(w)) {
      esScore += ['hola', 'puedo', 'hay', 'habitacion', 'habitación', 'equipaje', 'cocina'].includes(w) ? 2 : 1;
    }
  }

  for (const w of enWords) {
    if (t.includes(w)) {
      enScore += ['hello', 'hi', 'can i', 'do you', 'room', 'luggage', 'kitchen'].includes(w) ? 2 : 1;
    }
  }

  if (ptScore > esScore && ptScore > enScore) return 'pt';
  if (esScore > ptScore && esScore > enScore) return 'es';
  if (enScore > ptScore && enScore > esScore) return 'en';

  if (/\boi\b|\bola\b|\bposso\b|\btem\b/.test(t)) return 'pt';
  if (/\bhola\b|\bpuedo\b|\bhay\b/.test(t)) return 'es';
  if (/\bhello\b|\bhi\b|\bcan i\b|\bdo you\b/.test(t)) return 'en';

  return 'en';
}

function findKBAnswer(text, lang) {
  const t = cleanCommonTypos(text);

  for (const item of Object.values(KB)) {
    if (item.keywords.some(k => t.includes(cleanCommonTypos(k)))) {
      return item.answer[lang] || item.answer.en;
    }
  }

  // extra semantic shortcuts for typo-heavy queries
  if (t.includes('wifi')) {
    return KB.wifi.answer[lang] || KB.wifi.answer.en;
  }

  if (t.includes('equipaje') || t.includes('luggage') || t.includes('bagagem')) {
    return KB.luggage.answer[lang] || KB.luggage.answer.en;
  }

  if (t.includes('cocina') || t.includes('cozinha') || t.includes('kitchen')) {
    return KB.kitchen.answer[lang] || KB.kitchen.answer.en;
  }

  if (t.includes('parking') || t.includes('aparcamiento') || t.includes('estacionamento')) {
    return KB.parking.answer[lang] || KB.parking.answer.en;
  }

  if (t.includes('breakfast') || t.includes('desayuno') || t.includes('cafe da manha')) {
    return KB.breakfast.answer[lang] || KB.breakfast.answer.en;
  }

  if (t.includes('check in') || t.includes('arrival') || t.includes('llegada') || t.includes('chegada')) {
    return KB.checkin.answer[lang] || KB.checkin.answer.en;
  }

  if (t.includes('check out') || t.includes('departure') || t.includes('salida') || t.includes('saida')) {
    return KB.checkout.answer[lang] || KB.checkout.answer.en;
  }

  if (t.includes('late') || t.includes('tarde') || t.includes('chegar tarde') || t.includes('llegar tarde')) {
    return KB.checkin.answer[lang] || KB.checkin.answer.en;
  }

  return null;
}

function isDuplicate(message) {
  const key = `${message.from}:${message.body}`;
  const now = Date.now();
  const last = recentMessages.get(key);

  if (last && now - last < 10000) return true;

  recentMessages.set(key, now);

  for (const [k, ts] of recentMessages.entries()) {
    if (now - ts > 60000) recentMessages.delete(k);
  }

  return false;
}

async function askAI(userText) {
  const prompt = `
You are a professional hotel/hostel WhatsApp assistant.

STRICT RULES:
- ALWAYS reply in the SAME language as the user message.
- NEVER switch language.
- If the user writes in Spanish, reply in Spanish.
- If the user writes in Portuguese, reply in Brazilian Portuguese.
- If the user writes in English, reply in English.

STYLE:
- Short (2 to 4 sentences maximum)
- Friendly and polite
- Natural, not robotic
- Clear and practical

TASK:
- Answer ALL parts of the user's message
- If the user asks about early arrival or early check-in:
  explain that standard check-in is at 15:00,
  mention luggage storage,
  and say early check-in depends on availability
- If the user asks about late arrival:
  confirm it is possible and ask them to inform the reception in advance
- If the user asks about parking, luggage, kitchen, breakfast, Wi-Fi, or check-in/check-out,
  answer specifically and not in a generic way

HOTEL CONTEXT:
- Check-in: 15:00
- Check-out: 11:00
- Wi-Fi available
- Luggage storage available
- Shared kitchen available
- Parking depends on availability

DO NOT:
- invent random hotel policies
- ignore part of the user's question
- answer in the wrong language
- give long generic chatbot answers

User message:
${userText}
`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3
  });

  return completion.choices[0].message.content;
}

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: isRailway ? '/data/wwebjs_auth' : './.wwebjs_auth'
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('qr', async (qr) => {
  try {
    qrImageDataUrl = await QRCode.toDataURL(qr);
    isAuthenticated = false;
    console.log('QR updated');
  } catch (err) {
    console.log('QR render error:', err.message);
  }
});

client.on('authenticated', () => {
  isAuthenticated = true;
  console.log('Authenticated');
});

client.on('ready', () => {
  isAuthenticated = true;
  console.log('Bot is ready');
});

client.on('auth_failure', (msg) => {
  console.log('Auth failure:', msg);
});

client.on('change_state', (state) => {
  console.log('State changed:', state);
});

client.on('disconnected', (reason) => {
  isAuthenticated = false;
  console.log('Disconnected:', reason);
});

client.on('message', async (message) => {
  try {
    if (message.fromMe) return;
    if (!message.body) return;
    if (isDuplicate(message)) return;

    const text = message.body.trim();
    const lang = detectLanguage(text);
    const short = cleanCommonTypos(text);

    if (short === 'oi' || short === 'ola' || short === 'olá') {
      await message.reply('Olá! Como posso ajudar você?');
      return;
    }

    if (short === 'hola') {
      await message.reply('¡Hola! ¿En qué puedo ayudarle?');
      return;
    }

    if (short === 'hi' || short === 'hello') {
      await message.reply('Hello! How can I help you?');
      return;
    }

    console.log('Incoming:', text);

    const cleaned = cleanCommonTypos(text);

    const isSimple =
      cleaned.split(' ').length <= 3 &&
      !cleaned.includes('?');

    const isComplex =
      text.length > 40 ||
      cleaned.includes('?') ||
      cleaned.split(' ').length > 6;

    let kb = null;

    if (isSimple && !isComplex) {
      kb = findKBAnswer(text, lang);
    }

    if (kb) {
      await message.reply(kb);
      return;
    }

    const ai = await askAI(text);
    await message.reply(ai);
  } catch (e) {
    console.log('Error:', e.message);
    await message.reply('Sorry, please try again.');
  }
});

app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.get('/qr', (req, res) => {
  if (isAuthenticated) {
    return res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 40px;">
          <h2>WhatsApp is already connected</h2>
          <p>You can close this page.</p>
        </body>
      </html>
    `);
  }

  if (!qrImageDataUrl) {
    return res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 40px;">
          <h2>QR is not ready yet</h2>
          <p>Refresh this page in a few seconds.</p>
        </body>
      </html>
    `);
  }

  return res.send(`
    <html>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 40px;">
        <h2>Scan this QR with WhatsApp</h2>
        <img src="${qrImageDataUrl}" style="max-width: 320px; width: 100%;" />
        <p>Open WhatsApp → Linked Devices → Link a Device</p>
      </body>
    </html>
  `);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Web server started on 0.0.0.0:' + PORT);
});

client.initialize();
