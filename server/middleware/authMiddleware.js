const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ message: 'no token' });
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, email, type, iat, exp }
    next();
  } catch (err) {
    return res.status(401).json({ message: 'invalid token' });
  }
};
