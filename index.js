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
  return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function detectLanguage(text) {
  const t = normalize(text);

  const ptWords = ['ola', 'obrigado', 'reserva', 'quarto', 'chegada', 'saida', 'bagagem', 'cozinha'];
  const esWords = ['hola', 'gracias', 'reserva', 'habitacion', 'llegada', 'salida', 'equipaje', 'cocina'];
  const enWords = ['hello', 'hi', 'thanks', 'booking', 'room', 'arrival', 'departure', 'luggage', 'kitchen'];

  const ptScore = ptWords.filter(w => t.includes(w)).length;
  const esScore = esWords.filter(w => t.includes(w)).length;
  const enScore = enWords.filter(w => t.includes(w)).length;

  if (ptScore > esScore && ptScore >= enScore) return 'pt';
  if (esScore > ptScore && esScore >= enScore) return 'es';
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

async function askAI(text) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a hotel and hostel WhatsApp assistant. Detect the language automatically and reply only in English, Spanish (Castellano), or Portuguese (Brazil). Keep replies short, practical, and specific. Use no more than 3 short sentences.'
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
