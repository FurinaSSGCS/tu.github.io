const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;
// Default to loopback to avoid exposing admin endpoints to LAN/WAN.
// Set HOST=0.0.0.0 explicitly if you really need to expose it.
const HOST = process.env.HOST || '127.0.0.1';

// Serve static site files from project root
app.use(express.static(path.join(__dirname)));
app.use(bodyParser.json({limit: '5mb'}));
// Simple CORS middleware to allow admin UI served from other origins/ports
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Simple request logger for debugging uploads
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.url);
  next();
});

// Upload cover (multipart) -> save as fmi.jpg in project root
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname));
  },
  filename: function (req, file, cb) {
    // preserve extension from original filename or mimetype (png or jpg)
    const ext = path.extname(file.originalname).toLowerCase();
    let safeExt = ext;
    if(!safeExt){
      if(file.mimetype && file.mimetype.includes('png')) safeExt = '.png';
      else safeExt = '.jpg';
    }
    cb(null, 'fmi' + safeExt);
  }
});
const upload = multer({ storage });

app.post('/admin/upload-cover', upload.single('cover'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  return res.json({ ok: true, file: req.file.filename });
});

// Upload event image -> save with provided filename or original name
const eventStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname));
  },
  filename: function (req, file, cb) {
    // prefer requested filename from query param, then body, otherwise use original name
    let raw = (req.query && req.query.filename) ? req.query.filename : (req.body && req.body.filename) ? req.body.filename : file.originalname;
    raw = String(raw || file.originalname);
    // sanitize base name
    let base = raw.replace(/[^a-zA-Z0-9._-]/g, '_');
    let ext = path.extname(base).toLowerCase();
    if(!ext){
      // infer from uploaded file mimetype or originalname
      const origExt = path.extname(file.originalname).toLowerCase();
      if(origExt) ext = origExt;
      else if(file.mimetype && file.mimetype.includes('png')) ext = '.png';
      else ext = '.jpg';
      base = base + ext;
    }
    // ensure extension is acceptable
    if(!ext.match(/\.png|\.jpg|\.jpeg/)){
      // normalize unknown extensions to .jpg
      base = base.replace(/\.[^\.]+$/, '') + '.jpg';
    }
    const safe = base.toLowerCase();
    cb(null, safe);
  }
});
const uploadEvent = multer({ storage: eventStorage });

app.post('/admin/upload-event', uploadEvent.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  // enforce JPEG or PNG
  if (req.file.mimetype && !req.file.mimetype.includes('jpeg') && !req.file.mimetype.includes('jpg') && !req.file.mimetype.includes('png')) {
    return res.status(400).json({ error: 'invalid_type' });
  }
  // log where the file was written for debugging
  try{
    console.log('Uploaded event file:', { path: req.file.path, filename: req.file.filename, mimetype: req.file.mimetype });
  }catch(e){ console.warn('Upload log failed', e); }
  return res.json({ ok: true, file: req.file.filename });
});

// Save site content JSON (overwrite assets/site-content.json)
app.post('/admin/save-config', (req, res) => {
  const dest = path.join(__dirname, 'assets', 'site-content.json');
  try{
    fs.writeFileSync(dest, JSON.stringify(req.body, null, 2), 'utf8');
    return res.json({ ok: true });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error: 'write_failed' });
  }
});

// Provide admin credentials file (base64 passwords expected)
app.get('/admin/creds', (req, res) => {
  const src = path.join(__dirname, 'server-data', 'admins.json');
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'not_found' });
  try{
    const raw = fs.readFileSync(src, 'utf8');
    const data = JSON.parse(raw);
    return res.json(data);
  }catch(e){
    console.error(e);
    return res.status(500).json({ error: 'invalid' });
  }
});

app.listen(PORT, HOST, ()=>{
  console.log(`Admin server listening on http://${HOST}:${PORT}`);
  console.log(`Tip: on this machine you can still use http://localhost:${PORT}`);
});

// expose a simple ping for diagnosis
app.get('/admin/ping', (req, res) => res.json({ ok: true, now: Date.now() }));

// print registered route list for debugging
try{
  const routes = [];
  const stack = app && app._router && app._router.stack;
  if(Array.isArray(stack)){
    stack.forEach(mw => {
      if(mw.route && mw.route.path){
        const methods = Object.keys(mw.route.methods).join(',').toUpperCase();
        routes.push(methods + ' ' + mw.route.path);
      }
    });
    console.log('Registered routes:\n', routes.join('\n'));
  }else{
    console.log('Registered routes: (unavailable)');
  }
}catch(e){ console.warn('Could not list routes', e); }

// 404 logger for unmatched routes
app.use((req, res) => {
  console.warn('No route matched:', req.method, req.url);
  res.status(404).json({ error: 'not_found' });
});

// Notes: run `npm install express multer body-parser` then `node admin-server.js` in project root.
