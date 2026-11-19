const router = require('express').Router();
const multer = require('multer');
const { enhanceCharm } = require('../lib/enhance');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'File tidak ada' });
    const out = await enhanceCharm(req.file.buffer);
    res.type('image/png').send(out);
  } catch (err) {
    next(err); // ditangani penangan error terpusat di server.js
  }
});

module.exports = router;