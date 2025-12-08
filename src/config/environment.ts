import { registerAs } from '@nestjs/config';

export default registerAs('config', () => {
  return {
    web_url: process.env.WEB_URL,
    env: process.env.ENV,
    mongo: {
      dbName: process.env.MONGO_DB,
      user: process.env.MONGO_USER,
      password: process.env.MONGO_PASS,
      host: process.env.MONGO_HOST,
    },
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    },
    urls: {
      notifier: process.env.NOTIFIER_URL,
      python_backend: process.env.PYTHON_BACKEND_URL,
    },

    firebase: {
      key: process.env.FIREBASE_API_KEY,
    },
    maintenance: process.env.MAINTENANCE === 'true',
    otherKeys: {
      mykey: process.env.MY_KEY,
    },
  };
});
