// server/test-mongo.js
require('dotenv').config();
const mongoose = require('mongoose');

(async ()=>{
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/hackathon-auth', { serverSelectionTimeoutMS: 5000 });
    console.log('mongo ok');
    await mongoose.disconnect();
  } catch (e) {
    console.error('mongo err', e);
    process.exit(1);
  }
})();
