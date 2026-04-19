require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: '/data/wwebjs_auth'
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

const recentMessages = new Map();

const KB = {
  checkin: {
    keywords: ['check in','check-in','arrival','llegada','chegada'],
    answer: {
      en: 'Check-in starts at 15:00. If you arrive late, please inform us.',
      es: 'El check-in comienza a las 15:00. Si llega tarde, avísenos.',
      pt: 'O check-in começa às 15:00. Se chegar tarde, avise-nos.'
    }
  },

  checkout: {
    keywords: ['check out','check-out','departure','salida','saida'],
    answer: {
      en: 'Check-out is until 11:00. Late check-out depends on availability.',
      es: 'El check-out es hasta las 11:00.',
      pt: 'O check-out é até às 11:00.'
    }
  },

  breakfast: {
    keywords: ['breakfast','desayuno','cafe da manha','café'],
    answer: {
      en: 'Breakfast is from 07:00 to 10:00.',
      es: 'El desayuno es de 07:00 a 10:00.',
      pt: 'O café da manhã é das 07:00 às 10:00.'
    }
  },

  wifi: {
    keywords: ['wifi','internet','password'],
    answer: {
      en: 'Wi-Fi is available. Ask reception for the password.',
      es: 'Hay Wi-Fi. Pida la contraseña en recepción.',
      pt: 'Há Wi-Fi. Peça a senha na recepção.'
    }
  },

  kitchen: {
    keywords: ['kitchen','cocina','cozinha'],
    answer: {
      en: 'Shared kitchen is available. Please keep it clean after use.',
      es: 'Hay cocina compartida. Manténgala limpia.',
      pt: 'Há cozinha compartilhada. Por favor, mantenha limpa.'
    }
  },

  laundry: {
    keywords: ['laundry','lavanderia','lavar'],
    answer: {
      en: 'Laundry may be available. Ask reception for details.',
      es: 'La lavandería puede estar disponible. Consulte en recepción.',
      pt: 'Lavanderia pode estar disponível. Consulte a recepção.'
    }
  },

  luggage: {
    keywords: ['luggage','bags','equipaje','bagagem'],
    answer: {
      en: 'You can leave luggage before check-in or after check-out.',
      es: 'Puede dejar su equipaje antes o después del check-out.',
      pt: 'Pode deixar sua bagagem antes ou depois do check-out.'
    }
  },

  parking: {
    keywords: ['parking','aparcamiento','estacionamento'],
    answer: {
      en: 'Parking depends on availability. Contact us in advance.',
      es: 'El parking depende de la disponibilidad.',
      pt: 'O estacionamento depende da disponibilidade.'
    }
  },

  pets: {
    keywords: ['pet','dog','cat','mascota','animal'],
    answer: {
      en: 'Pets depend on property policy. Please ask before arrival.',
      es: 'Las mascotas dependen de la política del alojamiento.',
      pt: 'Animais dependem da política da propriedade.'
    }
  },

  cancellation: {
    keywords: ['cancel','refund','cancelacion','cancelamento'],
    answer: {
      en: 'Cancellation depends on your booking conditions.',
      es: 'La cancelación depende de su reserva.',
      pt: 'O cancelamento depende da reserva.'
    }
  },

  reception: {
    keywords: ['reception','hours','recepcion','recepção'],
    answer: {
      en: 'Reception hours may vary. Contact us if needed.',
      es: 'El horario de recepción puede variar.',
      pt: 'O horário da recepção pode variar.'
    }
  },

  earlyCheckin: {
    keywords: ['early check','temprano','cedo'],
    answer: {
      en: 'Early check-in depends on availability.',
      es: 'El check-in temprano depende de disponibilidad.',
      pt: 'Check-in antecipado depende da disponibilidade.'
    }
  },

  lateCheckout: {
    keywords: ['late check','tarde','tarde salida'],
    answer: {
      en: 'Late check-out may be possible for an extra fee.',
      es: 'Late check-out puede tener costo adicional.',
      pt: 'Late check-out pode ter custo adicional.'
    }
  },

  privateRoom: {
    keywords: ['private room','habitacion privada','quarto privado'],
    answer: {
      en: 'Private rooms depend on availability. Send your dates.',
      es: 'Las habitaciones privadas dependen de disponibilidad.',
      pt: 'Quartos privados dependem da disponibilidade.'
    }
  }
};

function normalize(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function detectLanguage(text) {
  const t = normalize(text);

  if (t.includes('hola') || t.includes('gracias')) return 'es';
  if (t.includes('ola') || t.includes('obrigado')) return 'pt';
  return 'en';
}

function findKBAnswer(text, lang) {
  const t = normalize(text);

  for (const item of Object.values(KB)) {
    if (item.keywords.some(k => t.includes(normalize(k)))) {
      return item.answer[lang] || item.answer.en;
    }
  }

  return null;
}

function isDuplicate(message) {
  const key = message.from + message.body;
  const now = Date.now();

  if (recentMessages.has(key) && now - recentMessages.get(key) < 10000) {
    return true;
  }

  recentMessages.set(key, now);
  return false;
}

async function askAI(text) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a hotel assistant. Reply short, clear, max 2-3 sentences.'
      },
      {
        role: 'user',
        content: text
      }
    ],
    temperature: 0.2
  });

  return res.choices[0].message.content;
}

client.on('qr', (qr) => {
  console.log('====== QR LINK ======');
  console.log('https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + qr);
  console.log('=====================');
});
client.on('ready', () => {
  console.log('Bot is ready');
});

client.on('message', async message => {
  try {
    if (message.fromMe) return;
    if (!message.body) return;
    if (isDuplicate(message)) return;

    const text = message.body.trim();
    const lang = detectLanguage(text);

    console.log('Incoming:', text);

    const kb = findKBAnswer(text, lang);

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

client.initialize();
