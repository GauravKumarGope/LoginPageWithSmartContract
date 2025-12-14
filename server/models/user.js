const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true }, // bcrypt hash
  type: { type: String, enum: ['normal','deaf'], default: 'normal' },
  xrplAddress: { type: String, default: '' },
}, { timestamps: true });

userSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);
